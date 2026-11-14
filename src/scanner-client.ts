import { getEffectiveScannerSuffix, type NormalizedInterval } from './intervals.js';
import { httpJsonRequest } from './proxy-utils.js';
import type { RecommendationSignal, ScannerSnapshot } from './types.js';

interface TvScannerResponse {
    totalCount?: number;
    data?: Array<{
        s: string;
        d: Array<string | number | null>;
    }>;
}

const METADATA_COLUMNS = [
    'name',
    'description',
    'exchange',
    'type',
    'currency',
    'sector',
    'industry',
    'update_mode',
    'market_cap_basic',
    'price_earnings_ttm',
    'earnings_per_share_basic_ttm',
] as const;

const INTERVAL_COLUMNS = [
    'open',
    'high',
    'low',
    'close',
    'volume',
    'change',
    'change_abs',
    'Recommend.All',
    'Recommend.Other',
    'Recommend.MA',
    'RSI',
    'RSI[1]',
    'MACD.macd',
    'MACD.signal',
    'Stoch.K',
    'Stoch.D',
    'CCI20',
    'ADX',
    'ADX+DI',
    'ADX-DI',
    'AO',
    'Mom',
    'ATR',
    'VWAP',
    'BB.upper',
    'BB.basis',
    'BB.lower',
    'Ichimoku.BLine',
    'Ichimoku.CLine',
    'EMA5',
    'EMA10',
    'EMA20',
    'EMA30',
    'EMA50',
    'EMA100',
    'EMA200',
    'SMA5',
    'SMA10',
    'SMA20',
    'SMA30',
    'SMA50',
    'SMA100',
    'SMA200',
] as const;

export function classifyRecommendation(score: number | null): RecommendationSignal {
    if (score === null || !Number.isFinite(score)) return null;
    if (score >= 0.5) return 'STRONG_BUY';
    if (score >= 0.1) return 'BUY';
    if (score > -0.1) return 'NEUTRAL';
    if (score > -0.5) return 'SELL';
    return 'STRONG_SELL';
}

function asNumber(val: string | number | null | undefined): number | null {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    return null;
}

function asString(val: string | number | null | undefined): string | null {
    if (typeof val === 'string' && val.length > 0) return val;
    return null;
}

export async function fetchScannerSnapshots(
    tickers: string[],
    normalizedInterval: NormalizedInterval,
    options: { timeoutMs?: number; proxyUrl?: string } = {},
): Promise<Map<string, ScannerSnapshot>> {
    const result = new Map<string, ScannerSnapshot>();
    if (tickers.length === 0) return result;

    const { suffix, exact } = getEffectiveScannerSuffix(normalizedInterval);
    const columns = [
        ...METADATA_COLUMNS,
        ...INTERVAL_COLUMNS.map((col) => `${col}${suffix}`),
    ];

    // Batch in chunks of 50 tickers to stay well below any request payload limits
    const batchSize = 50;
    for (let start = 0; start < tickers.length; start += batchSize) {
        const chunk = tickers.slice(start, start + batchSize);
        const response = await httpJsonRequest<TvScannerResponse>(
            'https://scanner.tradingview.com/global/scan',
            {
                method: 'POST',
                headers: {
                    Origin: 'https://www.tradingview.com',
                    Referer: 'https://www.tradingview.com/',
                },
                body: {
                    symbols: {
                        tickers: chunk,
                        query: { types: [] },
                    },
                    columns,
                },
                timeoutMs: options.timeoutMs ?? 20_000,
                proxyUrl: options.proxyUrl,
            },
        );

        for (const row of response.data ?? []) {
            const values = new Map<string, string | number | null>();
            columns.forEach((colName, idx) => {
                values.set(colName, row.d[idx] ?? null);
            });

            const getNum = (base: string) => asNumber(values.get(`${base}${suffix}`));
            const macdVal = getNum('MACD.macd');
            const macdSig = getNum('MACD.signal');
            const macdHist =
                macdVal !== null && macdSig !== null ? macdVal - macdSig : null;

            const overallScore = getNum('Recommend.All');
            const oscScore = getNum('Recommend.Other');
            const maScore = getNum('Recommend.MA');

            const snapshot: ScannerSnapshot = {
                intervalUsed: normalizedInterval.scannerIntervalLabel,
                scannerResolutionExact: exact,
                name: asString(values.get('name')),
                description: asString(values.get('description')),
                exchange: asString(values.get('exchange')),
                type: asString(values.get('type')),
                currency: asString(values.get('currency')),
                sector: asString(values.get('sector')),
                industry: asString(values.get('industry')),
                updateMode: asString(values.get('update_mode')),
                price: {
                    open: getNum('open'),
                    high: getNum('high'),
                    low: getNum('low'),
                    close: getNum('close'),
                    volume: getNum('volume'),
                    changePercent: getNum('change'),
                    changeAbs: getNum('change_abs'),
                },
                fundamentals: {
                    marketCap: asNumber(values.get('market_cap_basic')),
                    peRatioTtm: asNumber(values.get('price_earnings_ttm')),
                    epsBasicTtm: asNumber(values.get('earnings_per_share_basic_ttm')),
                },
                recommendations: {
                    overallScore,
                    overallSignal: classifyRecommendation(overallScore),
                    oscillatorsScore: oscScore,
                    oscillatorsSignal: classifyRecommendation(oscScore),
                    movingAveragesScore: maScore,
                    movingAveragesSignal: classifyRecommendation(maScore),
                },
                indicators: {
                    rsi14: getNum('RSI'),
                    rsi14Prev: getNum('RSI[1]'),
                    macd: macdVal,
                    macdSignal: macdSig,
                    macdHistogram: macdHist,
                    stochK: getNum('Stoch.K'),
                    stochD: getNum('Stoch.D'),
                    cci20: getNum('CCI20'),
                    adx14: getNum('ADX'),
                    adxPlusDI: getNum('ADX+DI'),
                    adxMinusDI: getNum('ADX-DI'),
                    awesomeOscillator: getNum('AO'),
                    momentum10: getNum('Mom'),
                    atr14: getNum('ATR'),
                    vwap: getNum('VWAP'),
                    bbUpper: getNum('BB.upper'),
                    bbBasis: getNum('BB.basis'),
                    bbLower: getNum('BB.lower'),
                    ichimokuBaseLine: getNum('Ichimoku.BLine'),
                    ichimokuConversionLine: getNum('Ichimoku.CLine'),
                    ema: {
                        ema5: getNum('EMA5'),
                        ema10: getNum('EMA10'),
                        ema20: getNum('EMA20'),
                        ema30: getNum('EMA30'),
                        ema50: getNum('EMA50'),
                        ema100: getNum('EMA100'),
                        ema200: getNum('EMA200'),
                    },
                    sma: {
                        sma5: getNum('SMA5'),
                        sma10: getNum('SMA10'),
                        sma20: getNum('SMA20'),
                        sma30: getNum('SMA30'),
                        sma50: getNum('SMA50'),
                        sma100: getNum('SMA100'),
                        sma200: getNum('SMA200'),
                    },
                },
            };

            result.set(row.s.toUpperCase(), snapshot);
        }
    }

    return result;
}
