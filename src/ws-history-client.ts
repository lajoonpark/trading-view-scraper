import crypto from 'node:crypto';
import WebSocket from 'ws';
import { createWsProxyAgent } from './proxy-utils.js';
import type { ChartSessionType, OhlcvBar, PriceAdjustment } from './types.js';

const DEFAULT_TV_WS_URL = 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart';

export interface TvPacket {
    m?: string;
    p?: unknown[];
    session_id?: string;
    [key: string]: unknown;
}

export function encodeTvPacket(payload: string | Record<string, unknown>): string {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return `~m~${raw.length}~m~${raw}`;
}

export function decodeTvFrames(rawMessage: string): Array<{ type: 'heartbeat'; raw: string } | { type: 'json'; data: TvPacket }> {
    const results: Array<{ type: 'heartbeat'; raw: string } | { type: 'json'; data: TvPacket }> = [];
    let cursor = 0;

    while (cursor < rawMessage.length) {
        if (!rawMessage.startsWith('~m~', cursor)) {
            break;
        }
        const lenStart = cursor + 3;
        const lenEnd = rawMessage.indexOf('~m~', lenStart);
        if (lenEnd === -1) break;

        const length = Number.parseInt(rawMessage.slice(lenStart, lenEnd), 10);
        if (!Number.isFinite(length) || length < 0) break;

        const payloadStart = lenEnd + 3;
        const payloadEnd = payloadStart + length;
        const payload = rawMessage.slice(payloadStart, payloadEnd);
        cursor = payloadEnd;

        if (payload.startsWith('~h~')) {
            results.push({ type: 'heartbeat', raw: payload });
        } else if (payload.length > 0) {
            try {
                const parsed = JSON.parse(payload) as TvPacket;
                results.push({ type: 'json', data: parsed });
            } catch {
                // Ignore malformed non-JSON control payloads
            }
        }
    }

    return results;
}

function randomSessionId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export interface FetchHistoricalBarsOptions {
    ticker: string;
    tvResolution: string;
    barsCount: number;
    session?: ChartSessionType;
    adjustment?: PriceAdjustment;
    timeoutMs?: number;
    proxyUrl?: string;
    wsUrl?: string;
    maxRetries?: number;
}

function isRetryableWsError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    // Do not retry deterministic symbol/permission errors
    if (
        msg.includes('symbol_error') ||
        msg.includes('invalid symbol') ||
        msg.includes('no such symbol') ||
        msg.includes('websocket upgrades are not allowed')
    ) {
        return false;
    }
    return true;
}

async function fetchHistoricalBarsOnce(options: FetchHistoricalBarsOptions): Promise<OhlcvBar[]> {
    const {
        ticker,
        tvResolution,
        barsCount,
        session = 'regular',
        adjustment = 'splits',
        timeoutMs = 25_000,
        proxyUrl,
        wsUrl = DEFAULT_TV_WS_URL,
    } = options;

    const targetCount = Math.max(1, Math.min(barsCount, 10_000));
    const isLocalWs = wsUrl.startsWith('ws://127.0.0.1') || wsUrl.startsWith('ws://localhost');
    const agent = isLocalWs ? undefined : createWsProxyAgent(proxyUrl);

    const chartSession = randomSessionId('cs');
    const quoteSession = randomSessionId('qs');
    const seriesId = 'sds_1';
    const symbolId = 'sds_sym_1';

    return new Promise<OhlcvBar[]>((resolve, reject) => {
        const barsByTimestamp = new Map<number, OhlcvBar>();
        let settled = false;
        let moreDataRequests = 0;
        let lastCountBeforeMore = 0;
        const maxMoreDataRequests = 10;

        const ws = new WebSocket(wsUrl, {
            agent,
            origin: 'https://www.tradingview.com',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        });

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                try {
                    ws.terminate();
                } catch {
                    // ignore
                }
                if (barsByTimestamp.size > 0) {
                    resolve(sortBars(barsByTimestamp));
                } else {
                    reject(new Error(`Timed out after ${timeoutMs}ms waiting for TradingView historical data for ${ticker}`));
                }
            }
        }, timeoutMs);

        const cleanupAndResolve = (bars: OhlcvBar[]) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(encodeTvPacket({ m: 'chart_delete_session', p: [chartSession] }));
                    ws.send(encodeTvPacket({ m: 'quote_delete_session', p: [quoteSession] }));
                    ws.close();
                }
            } catch {
                // ignore
            }
            resolve(bars);
        };

        const cleanupAndReject = (err: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.terminate();
            } catch {
                // ignore
            }
            reject(err);
        };

        const send = (method: string, params: unknown[]) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(encodeTvPacket({ m: method, p: params }));
            }
        };

        ws.on('unexpected-response', (_req, res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8').trim();
                cleanupAndReject(
                    new Error(
                        `WebSocket unexpected HTTP ${res.statusCode ?? 0} for ${ticker}${body ? `: ${body}` : ''}`,
                    ),
                );
            });
        });

        ws.on('open', () => {
            send('set_auth_token', ['unauthorized_user_token']);
            send('set_locale', ['en', 'US']);
            send('chart_create_session', [chartSession, '']);
            send('quote_create_session', [quoteSession]);

            const symbolConfig: Record<string, string> = {
                adjustment,
                symbol: ticker,
            };
            if (session === 'extended') {
                symbolConfig.session = 'extended';
            }

            send('resolve_symbol', [
                chartSession,
                symbolId,
                `=${JSON.stringify(symbolConfig)}`,
            ]);

            const initialBatch = Math.min(targetCount, 5000);
            send('create_series', [
                chartSession,
                seriesId,
                's1',
                symbolId,
                tvResolution,
                initialBatch,
                '',
            ]);
        });

        ws.on('message', (rawBuf) => {
            const rawStr = rawBuf.toString('utf8');
            const frames = decodeTvFrames(rawStr);

            for (const frame of frames) {
                if (frame.type === 'heartbeat') {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(encodeTvPacket(frame.raw));
                    }
                    continue;
                }

                const pkt = frame.data;
                if (!pkt.m) continue;

                if (pkt.m === 'symbol_error') {
                    const reason = Array.isArray(pkt.p) ? String(pkt.p[2] ?? pkt.p[1] ?? 'Unknown symbol error') : 'Unknown symbol error';
                    cleanupAndReject(new Error(`symbol_error for ${ticker}: ${reason}`));
                    return;
                }

                if (pkt.m === 'series_error') {
                    const reason = Array.isArray(pkt.p) ? String(pkt.p[2] ?? pkt.p[1] ?? 'Unknown series error') : 'Unknown series error';
                    cleanupAndReject(new Error(`series_error for ${ticker}: ${reason}`));
                    return;
                }

                if (pkt.m === 'critical_error' || pkt.m === 'protocol_error') {
                    const reason = Array.isArray(pkt.p) ? JSON.stringify(pkt.p) : pkt.m;
                    cleanupAndReject(new Error(`${pkt.m} for ${ticker}: ${reason}`));
                    return;
                }

                if (pkt.m === 'timescale_update' || pkt.m === 'du') {
                    const payload = Array.isArray(pkt.p) ? (pkt.p[1] as Record<string, unknown> | undefined) : undefined;
                    const seriesObj = payload?.[seriesId] as { s?: Array<{ v?: number[] }> } | undefined;
                    const rows = seriesObj?.s;
                    if (Array.isArray(rows)) {
                        for (const item of rows) {
                            const v = item?.v;
                            if (!Array.isArray(v) || v.length < 5) continue;
                            const ts = Number(v[0]);
                            const open = Number(v[1]);
                            const high = Number(v[2]);
                            const low = Number(v[3]);
                            const close = Number(v[4]);
                            const volume = v.length >= 6 && Number.isFinite(Number(v[5])) ? Number(v[5]) : 0;
                            if (
                                Number.isFinite(ts) &&
                                Number.isFinite(open) &&
                                Number.isFinite(high) &&
                                Number.isFinite(low) &&
                                Number.isFinite(close)
                            ) {
                                barsByTimestamp.set(ts, {
                                    timestamp: ts,
                                    datetime: new Date(ts * 1000).toISOString(),
                                    open,
                                    high,
                                    low,
                                    close,
                                    volume,
                                });
                            }
                        }
                    }
                }

                if (pkt.m === 'series_completed') {
                    const currentCount = barsByTimestamp.size;
                    const madeProgress = currentCount > lastCountBeforeMore;
                    if (
                        currentCount < targetCount &&
                        moreDataRequests < maxMoreDataRequests &&
                        (moreDataRequests === 0 || madeProgress)
                    ) {
                        const remaining = Math.min(targetCount - currentCount, 5000);
                        lastCountBeforeMore = currentCount;
                        moreDataRequests++;
                        send('request_more_data', [chartSession, seriesId, remaining]);
                    } else {
                        cleanupAndResolve(sortBars(barsByTimestamp).slice(-targetCount));
                        return;
                    }
                }
            }
        });

        ws.on('error', (err) => {
            cleanupAndReject(err);
        });

        ws.on('close', () => {
            if (!settled) {
                if (barsByTimestamp.size > 0) {
                    cleanupAndResolve(sortBars(barsByTimestamp).slice(-targetCount));
                } else {
                    cleanupAndReject(new Error(`WebSocket closed before receiving bars for ${ticker}`));
                }
            }
        });
    });
}

function sortBars(map: Map<number, OhlcvBar>): OhlcvBar[] {
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchHistoricalBars(options: FetchHistoricalBarsOptions): Promise<OhlcvBar[]> {
    const maxRetries = options.maxRetries ?? 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fetchHistoricalBarsOnce(options);
        } catch (err) {
            lastError = err as Error;
            if (!isRetryableWsError(lastError) || attempt === maxRetries) {
                throw lastError;
            }
            const delayMs = 500 * 2 ** attempt;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    throw lastError ?? new Error(`Failed to fetch historical bars for ${options.ticker}`);
}
