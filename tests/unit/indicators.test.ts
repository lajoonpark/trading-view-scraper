import { describe, expect, it } from 'vitest';
import {
    calculatePerBarIndicators,
    computeAdx,
    computeAtr,
    computeBollingerBands,
    computeCci,
    computeEma,
    computeMacd,
    computeObv,
    computeRoc,
    computeRsi,
    computeSma,
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
});
