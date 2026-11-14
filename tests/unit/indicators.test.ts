import { describe, expect, it } from 'vitest';
import {
    calculatePerBarIndicators,
    computeAdx,
    computeAtr,
    computeBollingerBands,
    computeCci,
    computeEma,
    computeFairValueGaps,
    computeMacd,
    computeObv,
    computeRoc,
    computeRsi,
    computeSma,
    computeSmc,
    computeSmcStructure,
    computeStochastic,
    computeVwap,
} from '../../src/indicators.js';
import type { IndicatorParams, OhlcvBar } from '../../src/types.js';

function makeBars(closes: number[], intraday = false): OhlcvBar[] {
    const baseTs = 1_700_000_000;
    return closes.map((c, idx) => {
        const ts = intraday ? baseTs + idx * 3600 : baseTs + idx * 86400;
        return {
            timestamp: ts,
            datetime: new Date(ts * 1000).toISOString(),
            open: c - 0.5,
            high: c + 1.5,
            low: c - 1.5,
            close: c,
            volume: 1000 + idx * 100,
        };
    });
}

const DEFAULT_PARAMS: IndicatorParams = {
    rsiPeriod: 14,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    emaPeriods: [5, 10],
    smaPeriods: [5, 10],
    bbPeriod: 5,
    bbStdDev: 2,
    stochK: 5,
    stochSmoothK: 3,
    stochD: 3,
    atrPeriod: 5,
    adxPeriod: 5,
    cciPeriod: 5,
    rocPeriod: 3,
    smcSwingLength: 10,
    smcInternalLength: 3,
};

describe('indicators', () => {
    it('computes SMA and EMA accurately', () => {
        const closes = [10, 11, 12, 13, 14, 15];
        const sma3 = computeSma(closes, 3);
        expect(sma3).toEqual([null, null, 11, 12, 13, 14]);

        const ema3 = computeEma(closes, 3);
        expect(ema3[0]).toBeNull();
        expect(ema3[1]).toBeNull();
        expect(ema3[2]).toBeCloseTo(11, 6);
        expect(ema3[3]).toBeCloseTo(12, 6);
        expect(ema3[4]).toBeCloseTo(13, 6);
    });

    it('computes RSI within [0, 100] and handles pure uptrend / downtrend', () => {
        const up = Array.from({ length: 30 }, (_, i) => 100 + i);
        const rsiUp = computeRsi(up, 14);
        expect(rsiUp[13]).toBeNull();
        expect(rsiUp[14]).toBe(100);
        expect(rsiUp[29]).toBe(100);

        const down = Array.from({ length: 30 }, (_, i) => 200 - i);
        const rsiDown = computeRsi(down, 14);
        expect(rsiDown[14]).toBe(0);

        const oscillating = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 2) * 5);
        const rsiOsc = computeRsi(oscillating, 14);
        const last = rsiOsc[rsiOsc.length - 1]!;
        expect(last).toBeGreaterThan(20);
        expect(last).toBeLessThan(80);
    });

    it('computes MACD line, signal, and histogram consistently', () => {
        const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.8 + Math.sin(i / 3) * 2);
        const { macd, signal, histogram } = computeMacd(closes, 12, 26, 9);
        expect(macd[24]).toBeNull();
        expect(macd[25]).not.toBeNull();
        expect(signal[32]).toBeNull();
        expect(signal[33]).not.toBeNull();
        const lastIdx = closes.length - 1;
        expect(histogram[lastIdx]).toBeCloseTo(macd[lastIdx]! - signal[lastIdx]!, 6);
    });

    it('computes Bollinger Bands, Stochastic, ATR, ADX, VWAP, OBV, CCI, ROC', () => {
        const closes = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i / 2) * 4 + i * 0.3);
        const bars = makeBars(closes, true);

        const bb = computeBollingerBands(closes, 5, 2);
        expect(bb.upper[39]!).toBeGreaterThan(bb.basis[39]!);
        expect(bb.lower[39]!).toBeLessThan(bb.basis[39]!);

        const stoch = computeStochastic(bars, 5, 3, 3);
        expect(stoch.k[39]!).toBeGreaterThanOrEqual(0);
        expect(stoch.k[39]!).toBeLessThanOrEqual(100);
        expect(stoch.d[39]!).not.toBeNull();

        const atr = computeAtr(bars, 5);
        expect(atr[39]!).toBeGreaterThan(0);

        const adx = computeAdx(bars, 5);
        expect(adx.adx[39]!).toBeGreaterThan(0);
        expect(adx.plusDI[39]!).toBeGreaterThanOrEqual(0);
        expect(adx.minusDI[39]!).toBeGreaterThanOrEqual(0);

        const vwap = computeVwap(bars, true);
        expect(vwap[39]!).toBeGreaterThan(0);

        const obv = computeObv(bars);
        expect(obv[0]).toBe(0);
        expect(typeof obv[39]).toBe('number');

        const cci = computeCci(bars, 5);
        expect(cci[39]).not.toBeNull();

        const roc = computeRoc(closes, 3);
        expect(roc[2]).toBeNull();
        expect(roc[3]).toBeCloseTo(((closes[3] - closes[0]) / closes[0]) * 100, 6);
    });

    it('attaches only selected indicators in calculatePerBarIndicators', () => {
        const bars = makeBars(Array.from({ length: 45 }, (_, i) => 100 + i * 0.5), false);
        const out = calculatePerBarIndicators(bars, ['RSI', 'MACD'], DEFAULT_PARAMS, false);
        const last = out[out.length - 1];
        expect(last.rsi).not.toBeUndefined();
        expect(last.macd).not.toBeUndefined();
        expect(last.ema).toBeUndefined();
        expect(last.sma).toBeUndefined();
        expect(last.bb).toBeUndefined();
    });

    it('computes LuxAlgo SMC BOS, CHoCH, Strong/Weak levels, and zones', () => {
        // Construct a clean wave: rally -> pivot high -> pullback -> bullish break (BOS/CHoCH) -> breakdown below pivot low (CHoCH)
        const pattern = [
            100, 102, 105, 108, 106, 103, 101, 99, // pivot high ~109.5 at idx 3
            102, 106, 111, 113, 112, 109, 105, 100, 96, // breaks above 109.5 -> bullish BOS, then pivot low around 94.5
            98, 95, 92, 90, 94, 99, 104, 108, // breaks below pivot low -> bearish CHoCH
        ];
        const bars = makeBars(pattern, true);
        const structure = computeSmcStructure(bars, 3);

        const signals = structure.map((s) => s.signal).filter((s) => s !== null);
        expect(signals.some((s) => s!.direction === 'bullish')).toBe(true);
        expect(signals.some((s) => s!.tag === 'CHoCH' && s!.direction === 'bearish')).toBe(true);

        const last = structure[structure.length - 1];
        expect(last.trend).toBe('bearish');
        expect(last.strongHigh).not.toBeNull();
        expect(last.weakLow).not.toBeNull();
        expect(last.weakHigh).toBeNull();
        expect(last.strongLow).toBeNull();
        expect(['discount', 'equilibrium', 'premium']).toContain(last.zone);

        const perBar = calculatePerBarIndicators(bars, ['SMC'], DEFAULT_PARAMS, true);
        const lastPerBar = perBar[perBar.length - 1];
        expect(lastPerBar.atr).toBeUndefined();
        expect(lastPerBar.smc?.swing).toBeDefined();
        expect(lastPerBar.smc?.internal).toBeDefined();

        const smcSeries = computeSmc(bars, 6, 3);
        expect(smcSeries).toHaveLength(bars.length);
    });

    it('detects LuxAlgo SMC Order Blocks, FVGs, Equal Lows, and Bullish Liquidity Sweeps', () => {
        const baseTs = 1_700_000_000;
        const bar = (idx: number, o: number, h: number, l: number, c: number): OhlcvBar => ({
            timestamp: baseTs + idx * 3600,
            datetime: new Date((baseTs + idx * 3600) * 1000).toISOString(),
            open: o,
            high: h,
            low: l,
            close: c,
            volume: 1000,
        });

        // Build clean FVG + Pivot High + Bullish BOS (Order Block) + Equal Lows + Liquidity Sweep bar
        const bars: OhlcvBar[] = [
            bar(0, 100, 101, 99, 100.5),
            bar(1, 100.5, 104, 100, 103.5), // impulse candle -> FVG between idx 0 high (101) and idx 2 low (102)
            bar(2, 103.5, 106, 102, 105),
            bar(3, 105, 105.5, 102.5, 103),
            bar(4, 103, 103.5, 100, 101),
            bar(5, 101, 102, 100, 101.5), // low ~100 (first pivot low candidate)
            bar(6, 101.5, 104, 101.2, 103.5),
            bar(7, 103.5, 107, 103, 106.8), // breaks above pivot high (106) -> bullish BOS + bullish OB near 100
            bar(8, 106.8, 107.2, 102.5, 102.8),
            bar(9, 102.8, 102.9, 100.05, 101.2), // second pivot low ~100.05 -> forms EQL with idx 5
            bar(10, 101.2, 103.2, 100.5, 102.5),
            bar(11, 102.5, 103.2, 100.8, 102.8),
            bar(12, 102.8, 103.5, 101.1, 102.9),
            bar(13, 102.9, 103.2, 99.6, 102.2), // sweeps below EQL (~100) and closes back above -> bullish sweep
        ];

        const fvg = computeFairValueGaps(bars);
        expect(fvg.bullishFvg[2]).toEqual({
            top: 102,
            bottom: 101,
            datetime: bars[1].datetime,
        });

        const smc = computeSmcStructure(bars, 2);
        // Bullish OB created when idx 7 closed > 106
        expect(smc[7].bullishOb).not.toBeNull();
        expect(smc[7].bullishOb?.bottom).toBe(100);
        // EQL detected by idx 11/12, swept with bullish reclaim on idx 13
        expect(smc[12].eql?.kind).toBe('EQL');
        expect(smc[13].liquiditySweep?.direction).toBe('bullish');
        expect(smc[13].liquiditySweep?.kind).toBe('EQL');
        expect(smc[13].lastSweep?.direction).toBe('bullish');
    });
});
