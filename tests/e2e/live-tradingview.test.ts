import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { parseActorInput } from '../../src/input-schema.js';
import { normalizeInterval } from '../../src/intervals.js';
import { fetchScannerSnapshots } from '../../src/scanner-client.js';
import { scrapeTradingView } from '../../src/scraper.js';
import { resolveSymbol } from '../../src/symbol-resolver.js';
import { decodeTvFrames, encodeTvPacket } from '../../src/ws-history-client.js';

const execFileAsync = promisify(execFile);

describe('TradingView Live & Actor E2E', () => {
    let wss: WebSocketServer;
    let mockWsUrl: string;

    beforeAll(async () => {
        // Local WebSocket mock server mimicking TradingView historical bars for deterministic testing
        // when the sandbox proxy disallows WebSocket HTTP upgrades.
        wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise<void>((resolve) => wss.once('listening', resolve));
        const addr = wss.address();
        if (!addr || typeof addr === 'string') throw new Error('Mock WS server failed');
        mockWsUrl = `ws://127.0.0.1:${addr.port}`;

        wss.on('connection', (socket) => {
            socket.send(encodeTvPacket({ session_id: 'e2e_sess', timestamp: 1_760_000_000 }));
            socket.on('message', (buf) => {
                for (const frame of decodeTvFrames(buf.toString('utf8'))) {
                    if (frame.type !== 'json') continue;
                    const pkt = frame.data;
                    if (pkt.m === 'create_series' && Array.isArray(pkt.p)) {
                        const cs = pkt.p[0];
                        const count = Number(pkt.p[5] ?? 50);
                        const baseTs = 1_750_000_000;
                        const bars = Array.from({ length: count }, (_, idx) => {
                            const close = 200 + idx * 0.5 + Math.sin(idx / 3) * 3;
                            return {
                                i: idx,
                                v: [baseTs + idx * 14400, close - 1, close + 2, close - 2, close, 1_000_000 + idx * 10_000],
                            };
                        });
                        socket.send(
                            encodeTvPacket({
                                m: 'timescale_update',
                                p: [cs, { sds_1: { s: bars } }],
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

    it('resolves live bare stock symbols to canonical EXCHANGE:SYMBOL without noise', async () => {
        const aapl = await resolveSymbol('AAPL', {
            searchType: 'stock',
            preferredExchanges: ['NASDAQ', 'NYSE'],
        });
        expect(aapl.ticker).toBe('NASDAQ:AAPL');

        const nvda = await resolveSymbol('NVDA', {
            searchType: 'stock',
            preferredExchanges: ['NASDAQ', 'NYSE'],
        });
        expect(nvda.ticker).toBe('NASDAQ:NVDA');
    });

    it('fetches live TradingView Scanner snapshots with 4h RSI and MACD for requested stocks only', async () => {
        const norm4h = normalizeInterval('4h');
        const map = await fetchScannerSnapshots(['NASDAQ:AAPL', 'NASDAQ:NVDA'], norm4h);

        expect(map.size).toBe(2);
        const aapl = map.get('NASDAQ:AAPL')!;
        expect(aapl).toBeDefined();
        expect(aapl.scannerResolutionExact).toBe(true);
        expect(aapl.price.close).toBeTypeOf('number');
        expect(aapl.indicators.rsi14).toBeTypeOf('number');
        expect(aapl.indicators.macd).toBeTypeOf('number');
        expect(aapl.indicators.macdSignal).toBeTypeOf('number');
        expect(aapl.recommendations.overallSignal).toMatch(/BUY|SELL|NEUTRAL/);
    });

    it('runs full scrapeTradingView pipeline combining live Scanner + historical OHLCV + per-bar indicators', async () => {
        const input = parseActorInput({
            symbols: ['AAPL', 'NASDAQ:AAPL', 'NASDAQ:MSFT'], // includes intentional duplicate to verify deduplication
            interval: '4h',
            barsCount: 40,
            indicators: ['RSI', 'MACD', 'EMA', 'SMA', 'BB', 'ATR'],
        });

        const results = await scrapeTradingView(input, { wsUrl: mockWsUrl });
        expect(results).toHaveLength(2); // Deduplicated AAPL + MSFT

        for (const item of results) {
            expect(item.error).toBeNull();
            expect(item.barsCount).toBe(40);
            expect(item.historicalBars).toHaveLength(40);
            expect(item.scannerSnapshot).not.toBeNull();
            expect(item.latestBar?.indicators?.rsi).toBeTypeOf('number');
            expect(item.latestBar?.indicators?.macd?.macd).toBeTypeOf('number');
            expect(item.latestBar?.indicators?.ema?.ema200).toBeTypeOf('number'); // warmed up!
            expect(item.latestBar?.indicators?.bb?.upper).toBeTypeOf('number');
        }
    });

    it('executes compiled Apify Actor entrypoint (dist/main.js) writing Dataset & OUTPUT KV store', async () => {
        const tmpStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-apify-e2e-'));
        const kvDir = path.join(tmpStorage, 'key_value_stores', 'default');
        await fs.mkdir(kvDir, { recursive: true });
        await fs.writeFile(
            path.join(kvDir, 'INPUT.json'),
            JSON.stringify({
                symbols: ['NASDAQ:AAPL', 'NASDAQ:NVDA'],
                interval: '4h',
                barsCount: 30,
                indicators: ['RSI', 'MACD', 'EMA'],
                includeHistoricalBars: false,
                includeScannerSnapshot: true,
            }),
            'utf8',
        );

        try {
            const { stdout, stderr } = await execFileAsync('node', ['dist/main.js'], {
                cwd: path.resolve('.'),
                env: {
                    ...process.env,
                    CRAWLEE_STORAGE_DIR: tmpStorage,
                },
                timeout: 30_000,
            });

            expect(stdout + stderr).toContain('TradingView scrape completed');

            const datasetDir = path.join(tmpStorage, 'datasets', 'default');
            const files = (await fs.readdir(datasetDir)).filter((f) => f.endsWith('.json'));
            expect(files).toHaveLength(2);

            const firstItem = JSON.parse(
                await fs.readFile(path.join(datasetDir, files[0]), 'utf8'),
            );
            expect(['NASDAQ:AAPL', 'NASDAQ:NVDA']).toContain(firstItem.ticker);
            expect(firstItem.scannerSnapshot?.indicators?.rsi14).toBeTypeOf('number');
            expect(firstItem.scannerSnapshot?.indicators?.macd).toBeTypeOf('number');

            const outputSummary = JSON.parse(
                await fs.readFile(path.join(kvDir, 'OUTPUT.json'), 'utf8'),
            );
            expect(outputSummary.succeeded).toBe(2);
            expect(outputSummary.failed).toBe(0);
        } finally {
            await fs.rm(tmpStorage, { recursive: true, force: true });
        }
    });
});
