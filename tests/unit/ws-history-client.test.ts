import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { decodeTvFrames, encodeTvPacket, fetchHistoricalBars } from '../../src/ws-history-client.js';

describe('ws-history-client', () => {
    let wss: WebSocketServer;
    let wsUrl: string;
    let receivedHeartbeats = 0;

    beforeAll(async () => {
        wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise<void>((resolve) => wss.once('listening', resolve));
        const addr = wss.address();
        if (!addr || typeof addr === 'string') {
            throw new Error('Failed to bind mock WebSocketServer');
        }
        wsUrl = `ws://127.0.0.1:${addr.port}`;

        wss.on('connection', (socket) => {
            socket.send(encodeTvPacket({ session_id: 'mock_session_1', timestamp: 1_700_000_000 }));
            let symbol = 'NASDAQ:AAPL';
            let sentInitial = false;

            socket.on('message', (buf) => {
                const frames = decodeTvFrames(buf.toString('utf8'));
                for (const frame of frames) {
                    if (frame.type === 'heartbeat') {
                        receivedHeartbeats++;
                        continue;
                    }
                    const pkt = frame.data;
                    if (pkt.m === 'resolve_symbol' && Array.isArray(pkt.p)) {
                        const rawConfig = String(pkt.p[2] ?? '').replace(/^=/, '');
                        const parsed = JSON.parse(rawConfig) as { symbol: string };
                        symbol = parsed.symbol;
                        if (symbol === 'INVALID:NOPE') {
                            socket.send(
                                encodeTvPacket({
                                    m: 'symbol_error',
                                    p: [pkt.p[0], pkt.p[1], 'unknown symbol'],
                                }),
                            );
                            return;
                        }
                    }
                    if (pkt.m === 'create_series' && !sentInitial) {
                        sentInitial = true;
                        const cs = pkt.p?.[0];
                        // Send heartbeat + initial 3 bars concatenated in a single WebSocket message
                        const bars = [1, 2, 3].map((i) => ({
                            i,
                            v: [1_700_000_000 + (i + 2) * 3600, 100 + i, 105 + i, 99 + i, 102 + i, 5000 * i],
                        }));
                        const combined =
                            encodeTvPacket('~h~1') +
                            encodeTvPacket({
                                m: 'timescale_update',
                                p: [cs, { sds_1: { s: bars } }],
                            }) +
                            encodeTvPacket({
                                m: 'series_completed',
                                p: [cs, 'sds_1', 'streaming', 's1'],
                            });
                        socket.send(combined);
                    }
                    if (pkt.m === 'request_more_data') {
                        const cs = pkt.p?.[0];
                        // Send 2 older bars
                        const olderBars = [-1, 0].map((i) => ({
                            i,
                            v: [1_700_000_000 + (i + 2) * 3600, 95 + i, 98 + i, 94 + i, 97 + i, 4000],
                        }));
                        socket.send(
                            encodeTvPacket({
                                m: 'timescale_update',
                                p: [cs, { sds_1: { s: olderBars } }],
                            }) +
                                encodeTvPacket({
                                    m: 'series_completed',
                                    p: [cs, 'sds_1', 'streaming', 's1'],
                                }),
                        );
                    }
                }
            });
        });
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it('parses concatenated frames, echoes heartbeats, paginates older bars, and sorts ascending', async () => {
        const bars = await fetchHistoricalBars({
            ticker: 'NASDAQ:AAPL',
            tvResolution: '60',
            barsCount: 5,
            wsUrl,
            timeoutMs: 5000,
        });

        expect(receivedHeartbeats).toBeGreaterThanOrEqual(1);
        expect(bars).toHaveLength(5);
        expect(bars[0].timestamp).toBeLessThan(bars[4].timestamp);
        expect(bars[0].close).toBe(96);
        expect(bars[4].close).toBe(105);
    });

    it('rejects deterministically on symbol_error', async () => {
        await expect(
            fetchHistoricalBars({
                ticker: 'INVALID:NOPE',
                tvResolution: '1D',
                barsCount: 10,
                wsUrl,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/symbol_error/);
    });
});
