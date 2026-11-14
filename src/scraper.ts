import { calculatePerBarIndicators, getRequiredWarmupBars } from './indicators.js';
import { normalizeInterval, type NormalizedInterval } from './intervals.js';
import { fetchScannerSnapshots } from './scanner-client.js';
import { resolveSymbol } from './symbol-resolver.js';
import type {
    ActorInput,
    EnrichedOhlcvBar,
    OhlcvBar,
    ResolvedSymbol,
    ScannerSnapshot,
    ScrapedStockResult,
} from './types.js';
import { fetchHistoricalBars } from './ws-history-client.js';

export interface ScrapeDependencies {
    wsUrl?: string;
    proxyUrlProvider?: () => Promise<string | undefined>;
    logger?: {
        info: (msg: string, data?: Record<string, unknown>) => void;
        warning: (msg: string, data?: Record<string, unknown>) => void;
        error: (msg: string, data?: Record<string, unknown>) => void;
    };
}

async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const current = nextIndex++;
            results[current] = await worker(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
    await Promise.all(workers);
    return results;
}

function estimateTotalBarsToFetch(
    input: ActorInput,
    normalizedInterval: NormalizedInterval,
    warmupBars: number,
): number {
    if (!input.fromDate) {
        return Math.min(input.barsCount + warmupBars, 10_000);
    }

    const fromSec = Math.floor(Date.parse(input.fromDate) / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const spanSeconds = Math.max(0, nowSec - fromSec);

    // Account for market non-trading hours/weekends with a conservative 1.8x multiplier for intraday/daily
    const estimatedBarsSinceFrom = Math.ceil((spanSeconds / normalizedInterval.secondsPerBar) * 1.8) + 25;
    const requested = Math.max(input.barsCount, estimatedBarsSinceFrom);
    return Math.min(requested + warmupBars, 10_000);
}

function filterBarsByDateAndCount(
    bars: EnrichedOhlcvBar[],
    input: ActorInput,
): EnrichedOhlcvBar[] {
    let filtered = bars;

    if (input.fromDate) {
        const fromSec = Math.floor(Date.parse(input.fromDate) / 1000);
        filtered = filtered.filter((b) => b.timestamp >= fromSec);
    }
    if (input.toDate) {
        const toDateRaw = input.toDate.trim();
        // If user passes date-only YYYY-MM-DD, include the entire UTC day
        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toDateRaw);
        const toSec = isDateOnly
            ? Math.floor(Date.parse(`${toDateRaw}T23:59:59.999Z`) / 1000)
            : Math.floor(Date.parse(toDateRaw) / 1000);
        filtered = filtered.filter((b) => b.timestamp <= toSec);
    }

    if (filtered.length > input.barsCount) {
        filtered = filtered.slice(-input.barsCount);
    }
    return filtered;
}

export async function scrapeTradingView(
    input: ActorInput,
    deps: ScrapeDependencies = {},
): Promise<ScrapedStockResult[]> {
    const log = deps.logger ?? {
        info: (msg, data) => console.log(msg, data ?? ''),
        warning: (msg, data) => console.warn(msg, data ?? ''),
        error: (msg, data) => console.error(msg, data ?? ''),
    };

    const normalizedInterval = normalizeInterval(input.interval);
    const isIntraday = normalizedInterval.secondsPerBar < 86400;
    const scrapedAt = new Date().toISOString();

    // 1. Resolve all requested symbols concurrently (only requested stocks -> zero noise)
    const resolutionOutcomes = await runWithConcurrency(
        input.symbols,
        input.maxConcurrency,
        async (rawSymbol) => {
            try {
                const proxyUrl = await deps.proxyUrlProvider?.();
                const resolved = await resolveSymbol(rawSymbol, {
                    searchType: input.searchType,
                    preferredExchanges: input.preferredExchanges,
                    timeoutMs: input.requestTimeoutMs,
                    proxyUrl,
                });
                return { ok: true as const, rawSymbol, resolved };
            } catch (err) {
                return {
                    ok: false as const,
                    rawSymbol,
                    error: (err as Error).message,
                };
            }
        },
    );

    // Deduplicate canonical tickers while preserving input order
    const seenTickers = new Set<string>();
    const resolvedEntries: ResolvedSymbol[] = [];
    const failedResults: ScrapedStockResult[] = [];

    for (const outcome of resolutionOutcomes) {
        if (!outcome.ok) {
            failedResults.push({
                requestedSymbol: outcome.rawSymbol,
                ticker: outcome.rawSymbol.toUpperCase(),
                exchange: '',
                symbol: outcome.rawSymbol.toUpperCase(),
                description: null,
                assetType: null,
                currency: null,
                interval: normalizedInterval.canonical,
                tvResolution: normalizedInterval.tvResolution,
                scrapedAt,
                barsCount: 0,
                latestBar: null,
                scannerSnapshot: null,
                historicalBars: [],
                warnings: [],
                error: outcome.error,
            });
            continue;
        }
        if (seenTickers.has(outcome.resolved.ticker)) {
            log.info(`Skipping duplicate symbol ${outcome.resolved.ticker} (from "${outcome.rawSymbol}")`);
            continue;
        }
        seenTickers.add(outcome.resolved.ticker);
        resolvedEntries.push(outcome.resolved);
    }

    log.info(`Resolved ${resolvedEntries.length} unique symbols for interval ${normalizedInterval.canonical}`, {
        tickers: resolvedEntries.map((r) => r.ticker),
    });

    // 2. Fetch TradingView Scanner snapshots in batch (if enabled)
    let scannerMap = new Map<string, ScannerSnapshot>();
    let scannerGlobalWarning: string | null = null;
    if (input.includeScannerSnapshot && resolvedEntries.length > 0) {
        try {
            const proxyUrl = await deps.proxyUrlProvider?.();
            scannerMap = await fetchScannerSnapshots(
                resolvedEntries.map((r) => r.ticker),
                normalizedInterval,
                { timeoutMs: input.requestTimeoutMs, proxyUrl },
            );
        } catch (err) {
            scannerGlobalWarning = `Scanner snapshot fetch failed: ${(err as Error).message}`;
            log.warning(scannerGlobalWarning);
        }
    }

    // 3. Fetch historical OHLCV bars + compute per-bar indicators concurrently
    const warmupBars = input.includePerBarIndicators
        ? getRequiredWarmupBars(input.indicators, input.indicatorParams)
        : 0;
    const totalBarsToFetch = estimateTotalBarsToFetch(input, normalizedInterval, warmupBars);

    const stockResults = await runWithConcurrency(
        resolvedEntries,
        input.maxConcurrency,
        async (resolved): Promise<ScrapedStockResult> => {
            const warnings: string[] = [];
            if (scannerGlobalWarning) warnings.push(scannerGlobalWarning);

            const snapshot = scannerMap.get(resolved.ticker) ?? null;
            if (input.includeScannerSnapshot && !snapshot && !scannerGlobalWarning) {
                warnings.push(`No TradingView Scanner snapshot returned for ${resolved.ticker}`);
            }
            if (snapshot && !snapshot.scannerResolutionExact) {
                warnings.push(
                    `TradingView Scanner API does not support exact "${normalizedInterval.canonical}" resolution; snapshot uses "${snapshot.intervalUsed}". Per-bar indicators are computed directly on "${normalizedInterval.canonical}" OHLCV bars.`,
                );
            }

            let historicalBars: EnrichedOhlcvBar[] = [];
            let historyError: string | null = null;

            if (input.includeHistoricalBars) {
                try {
                    const proxyUrl = await deps.proxyUrlProvider?.();
                    const rawBars: OhlcvBar[] = await fetchHistoricalBars({
                        ticker: resolved.ticker,
                        tvResolution: normalizedInterval.tvResolution,
                        barsCount: totalBarsToFetch,
                        session: input.session,
                        adjustment: input.adjustment,
                        timeoutMs: input.requestTimeoutMs,
                        proxyUrl,
                        wsUrl: deps.wsUrl,
                    });

                    let enriched: EnrichedOhlcvBar[] = rawBars;
                    if (input.includePerBarIndicators && input.indicators.length > 0 && rawBars.length > 0) {
                        const perBarIndicators = calculatePerBarIndicators(
                            rawBars,
                            input.indicators,
                            input.indicatorParams,
                            isIntraday,
                        );
                        enriched = rawBars.map((bar, idx) => ({
                            ...bar,
                            indicators: perBarIndicators[idx],
                        }));
                    }

                    historicalBars = filterBarsByDateAndCount(enriched, input);
                    if (historicalBars.length === 0) {
                        warnings.push(`No historical bars returned for ${resolved.ticker} in the requested range.`);
                    }
                } catch (err) {
                    const msg = `Historical OHLCV fetch failed: ${(err as Error).message}`;
                    log.warning(`${resolved.ticker}: ${msg}`);
                    if (snapshot) {
                        warnings.push(msg);
                    } else {
                        historyError = msg;
                    }
                }
            }

            const latestBar =
                historicalBars.length > 0 ? historicalBars[historicalBars.length - 1] : null;

            return {
                requestedSymbol: resolved.requestedSymbol,
                ticker: resolved.ticker,
                exchange: snapshot?.exchange ?? resolved.exchange,
                symbol: snapshot?.name ?? resolved.symbol,
                description: snapshot?.description ?? resolved.description ?? null,
                assetType: snapshot?.type ?? resolved.type ?? null,
                currency: snapshot?.currency ?? resolved.currency ?? null,
                interval: normalizedInterval.canonical,
                tvResolution: normalizedInterval.tvResolution,
                scrapedAt,
                barsCount: historicalBars.length,
                latestBar,
                scannerSnapshot: snapshot,
                historicalBars,
                warnings,
                error: historyError,
            };
        },
    );

    return [...stockResults, ...failedResults];
}
