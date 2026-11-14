import type {
    IndicatorName,
    IndicatorParams,
    OhlcvBar,
    PerBarIndicators,
} from './types.js';

function roundValue(value: number | null, decimals = 6): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

export function computeSma(values: (number | null)[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    if (period <= 0) return out;

    // Collect valid contiguous sequences starting from first non-null
    let sum = 0;
    let validCount = 0;
    const window: number[] = [];

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || !Number.isFinite(v)) {
            sum = 0;
            validCount = 0;
            window.length = 0;
            continue;
        }
        window.push(v);
        sum += v;
        validCount++;
        if (window.length > period) {
            sum -= window.shift()!;
        }
        if (validCount >= period) {
            out[i] = sum / period;
        }
    }
    return out;
}

export function computeEma(values: (number | null)[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    if (period <= 0) return out;

    const k = 2 / (period + 1);
    let seedSum = 0;
    let seedCount = 0;
    let prevEma: number | null = null;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || !Number.isFinite(v)) {
            seedSum = 0;
            seedCount = 0;
            prevEma = null;
            continue;
        }
        if (prevEma === null) {
            seedSum += v;
            seedCount++;
            if (seedCount === period) {
                prevEma = seedSum / period;
                out[i] = prevEma;
            }
        } else {
            prevEma = v * k + prevEma * (1 - k);
            out[i] = prevEma;
        }
    }
    return out;
}

export function computeRma(values: (number | null)[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length).fill(null);
    if (period <= 0) return out;

    let seedSum = 0;
    let seedCount = 0;
    let prevRma: number | null = null;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || !Number.isFinite(v)) {
            seedSum = 0;
            seedCount = 0;
            prevRma = null;
            continue;
        }
        if (prevRma === null) {
            seedSum += v;
            seedCount++;
            if (seedCount === period) {
                prevRma = seedSum / period;
                out[i] = prevRma;
            }
        } else {
            prevRma = (prevRma * (period - 1) + v) / period;
            out[i] = prevRma;
        }
    }
    return out;
}

export function computeRsi(closes: number[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(closes.length).fill(null);
    if (period <= 0 || closes.length <= period) return out;

    const gains: (number | null)[] = new Array(closes.length).fill(null);
    const losses: (number | null)[] = new Array(closes.length).fill(null);

    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains[i] = diff > 0 ? diff : 0;
        losses[i] = diff < 0 ? -diff : 0;
    }

    const avgGain = computeRma(gains, period);
    const avgLoss = computeRma(losses, period);

    for (let i = 0; i < closes.length; i++) {
        const g = avgGain[i];
        const l = avgLoss[i];
        if (g === null || l === null) continue;
        if (l === 0) {
            out[i] = g === 0 ? 50 : 100;
        } else {
            const rs = g / l;
            out[i] = 100 - 100 / (1 + rs);
        }
    }
    return out;
}

export function computeMacd(
    closes: number[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
): {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
} {
    const fast = computeEma(closes, fastPeriod);
    const slow = computeEma(closes, slowPeriod);
    const macd: (number | null)[] = closes.map((_, i) =>
        fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null,
    );
    const signal = computeEma(macd, signalPeriod);
    const histogram: (number | null)[] = closes.map((_, i) =>
        macd[i] !== null && signal[i] !== null ? macd[i]! - signal[i]! : null,
    );
    return { macd, signal, histogram };
}

export function computeBollingerBands(
    closes: number[],
    period: number,
    stdDevMultiplier: number,
): {
    upper: (number | null)[];
    basis: (number | null)[];
    lower: (number | null)[];
} {
    const basis = computeSma(closes, period);
    const upper: (number | null)[] = new Array(closes.length).fill(null);
    const lower: (number | null)[] = new Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i++) {
        const mean = basis[i];
        if (mean === null) continue;
        let sqSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const d = closes[j] - mean;
            sqSum += d * d;
        }
        const stdev = Math.sqrt(sqSum / period);
        upper[i] = mean + stdDevMultiplier * stdev;
        lower[i] = mean - stdDevMultiplier * stdev;
    }

    return { upper, basis, lower };
}

export function computeStochastic(
    bars: OhlcvBar[],
    kPeriod: number,
    smoothK: number,
    dPeriod: number,
): {
    k: (number | null)[];
    d: (number | null)[];
} {
    const rawK: (number | null)[] = new Array(bars.length).fill(null);
    for (let i = kPeriod - 1; i < bars.length; i++) {
        let lowest = Infinity;
        let highest = -Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (bars[j].low < lowest) lowest = bars[j].low;
            if (bars[j].high > highest) highest = bars[j].high;
        }
        const range = highest - lowest;
        rawK[i] = range === 0 ? 50 : ((bars[i].close - lowest) / range) * 100;
    }
    const k = smoothK > 1 ? computeSma(rawK, smoothK) : rawK;
    const d = computeSma(k, dPeriod);
    return { k, d };
}

export function computeAtr(bars: OhlcvBar[], period: number): (number | null)[] {
    if (bars.length === 0) return [];
    const tr: number[] = new Array(bars.length);
    tr[0] = bars[0].high - bars[0].low;
    for (let i = 1; i < bars.length; i++) {
        const prevClose = bars[i - 1].close;
        tr[i] = Math.max(
            bars[i].high - bars[i].low,
            Math.abs(bars[i].high - prevClose),
            Math.abs(bars[i].low - prevClose),
        );
    }
    return computeRma(tr, period);
}

export function computeAdx(
    bars: OhlcvBar[],
    period: number,
): {
    adx: (number | null)[];
    plusDI: (number | null)[];
    minusDI: (number | null)[];
} {
    const len = bars.length;
    const empty = new Array<number | null>(len).fill(null);
    if (len < 2 || period <= 0) {
        return { adx: empty, plusDI: [...empty], minusDI: [...empty] };
    }

    const tr: (number | null)[] = new Array(len).fill(null);
    const plusDm: (number | null)[] = new Array(len).fill(null);
    const minusDm: (number | null)[] = new Array(len).fill(null);

    tr[0] = bars[0].high - bars[0].low;
    for (let i = 1; i < len; i++) {
        const prevClose = bars[i - 1].close;
        tr[i] = Math.max(
            bars[i].high - bars[i].low,
            Math.abs(bars[i].high - prevClose),
            Math.abs(bars[i].low - prevClose),
        );
        const up = bars[i].high - bars[i - 1].high;
        const down = bars[i - 1].low - bars[i].low;
        plusDm[i] = up > down && up > 0 ? up : 0;
        minusDm[i] = down > up && down > 0 ? down : 0;
    }

    const smoothTr = computeRma(tr, period);
    const smoothPlusDm = computeRma(plusDm, period);
    const smoothMinusDm = computeRma(minusDm, period);

    const plusDI: (number | null)[] = new Array(len).fill(null);
    const minusDI: (number | null)[] = new Array(len).fill(null);
    const dx: (number | null)[] = new Array(len).fill(null);

    for (let i = 0; i < len; i++) {
        const sTr = smoothTr[i];
        const sPlus = smoothPlusDm[i];
        const sMinus = smoothMinusDm[i];
        if (sTr === null || sPlus === null || sMinus === null || sTr === 0) continue;
        const pdi = (100 * sPlus) / sTr;
        const mdi = (100 * sMinus) / sTr;
        plusDI[i] = pdi;
        minusDI[i] = mdi;
        const denom = pdi + mdi;
        dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
    }

    const adx = computeRma(dx, period);
    return { adx, plusDI, minusDI };
}

export function computeVwap(bars: OhlcvBar[], resetDaily: boolean): (number | null)[] {
    const out: (number | null)[] = new Array(bars.length).fill(null);
    let cumPv = 0;
    let cumVol = 0;
    let currentDay = '';

    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (resetDaily) {
            const day = bar.datetime.slice(0, 10);
            if (day !== currentDay) {
                currentDay = day;
                cumPv = 0;
                cumVol = 0;
            }
        }
        const typicalPrice = (bar.high + bar.low + bar.close) / 3;
        const vol = Math.max(0, bar.volume);
        cumPv += typicalPrice * vol;
        cumVol += vol;
        out[i] = cumVol > 0 ? cumPv / cumVol : typicalPrice;
    }
    return out;
}

export function computeObv(bars: OhlcvBar[]): (number | null)[] {
    const out: (number | null)[] = new Array(bars.length).fill(null);
    if (bars.length === 0) return out;
    let obv = 0;
    out[0] = 0;
    for (let i = 1; i < bars.length; i++) {
        if (bars[i].close > bars[i - 1].close) {
            obv += bars[i].volume;
        } else if (bars[i].close < bars[i - 1].close) {
            obv -= bars[i].volume;
        }
        out[i] = obv;
    }
    return out;
}

export function computeCci(bars: OhlcvBar[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(bars.length).fill(null);
    if (period <= 0) return out;
    const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
    const smaTp = computeSma(tp, period);

    for (let i = period - 1; i < bars.length; i++) {
        const mean = smaTp[i];
        if (mean === null) continue;
        let devSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            devSum += Math.abs(tp[j] - mean);
        }
        const meanDev = devSum / period;
        out[i] = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
    }
    return out;
}

export function computeRoc(closes: number[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(closes.length).fill(null);
    if (period <= 0) return out;
    for (let i = period; i < closes.length; i++) {
        const prev = closes[i - period];
        out[i] = prev === 0 ? null : ((closes[i] - prev) / prev) * 100;
    }
    return out;
}

export function calculatePerBarIndicators(
    bars: OhlcvBar[],
    enabledIndicators: IndicatorName[],
    params: IndicatorParams,
    isIntraday: boolean,
): PerBarIndicators[] {
    const enabled = new Set(enabledIndicators);
    const closes = bars.map((b) => b.close);

    const rsi = enabled.has('RSI') ? computeRsi(closes, params.rsiPeriod) : null;
    const macd = enabled.has('MACD')
        ? computeMacd(closes, params.macdFast, params.macdSlow, params.macdSignal)
        : null;
    const emas = enabled.has('EMA')
        ? Object.fromEntries(params.emaPeriods.map((p) => [`ema${p}`, computeEma(closes, p)]))
        : null;
    const smas = enabled.has('SMA')
        ? Object.fromEntries(params.smaPeriods.map((p) => [`sma${p}`, computeSma(closes, p)]))
        : null;
    const bb = enabled.has('BB')
        ? computeBollingerBands(closes, params.bbPeriod, params.bbStdDev)
        : null;
    const stoch = enabled.has('STOCH')
        ? computeStochastic(bars, params.stochK, params.stochSmoothK, params.stochD)
        : null;
    const atr = enabled.has('ATR') ? computeAtr(bars, params.atrPeriod) : null;
    const adx = enabled.has('ADX') ? computeAdx(bars, params.adxPeriod) : null;
    const vwap = enabled.has('VWAP') ? computeVwap(bars, isIntraday) : null;
    const obv = enabled.has('OBV') ? computeObv(bars) : null;
    const cci = enabled.has('CCI') ? computeCci(bars, params.cciPeriod) : null;
    const roc = enabled.has('ROC') ? computeRoc(closes, params.rocPeriod) : null;

    return bars.map((_, i) => {
        const entry: PerBarIndicators = {};
        if (rsi) entry.rsi = roundValue(rsi[i], 4);
        if (macd) {
            entry.macd = {
                macd: roundValue(macd.macd[i], 6),
                signal: roundValue(macd.signal[i], 6),
                histogram: roundValue(macd.histogram[i], 6),
            };
        }
        if (emas) {
            entry.ema = Object.fromEntries(
                Object.entries(emas).map(([k, arr]) => [k, roundValue(arr[i], 6)]),
            );
        }
        if (smas) {
            entry.sma = Object.fromEntries(
                Object.entries(smas).map(([k, arr]) => [k, roundValue(arr[i], 6)]),
            );
        }
        if (bb) {
            entry.bb = {
                upper: roundValue(bb.upper[i], 6),
                basis: roundValue(bb.basis[i], 6),
                lower: roundValue(bb.lower[i], 6),
            };
        }
        if (stoch) {
            entry.stoch = {
                k: roundValue(stoch.k[i], 4),
                d: roundValue(stoch.d[i], 4),
            };
        }
        if (atr) entry.atr = roundValue(atr[i], 6);
        if (adx) {
            entry.adx = {
                adx: roundValue(adx.adx[i], 4),
                plusDI: roundValue(adx.plusDI[i], 4),
                minusDI: roundValue(adx.minusDI[i], 4),
            };
        }
        if (vwap) entry.vwap = roundValue(vwap[i], 6);
        if (obv) entry.obv = roundValue(obv[i], 2);
        if (cci) entry.cci = roundValue(cci[i], 4);
        if (roc) entry.roc = roundValue(roc[i], 4);
        return entry;
    });
}

export function getRequiredWarmupBars(
    enabledIndicators: IndicatorName[],
    params: IndicatorParams,
): number {
    let maxWarmup = 50;
    const enabled = new Set(enabledIndicators);
    if (enabled.has('EMA') && params.emaPeriods.length > 0) {
        maxWarmup = Math.max(maxWarmup, Math.max(...params.emaPeriods) + 60);
    }
    if (enabled.has('SMA') && params.smaPeriods.length > 0) {
        maxWarmup = Math.max(maxWarmup, Math.max(...params.smaPeriods) + 10);
    }
    if (enabled.has('MACD')) {
        maxWarmup = Math.max(maxWarmup, params.macdSlow + params.macdSignal + 60);
    }
    if (enabled.has('RSI')) {
        maxWarmup = Math.max(maxWarmup, params.rsiPeriod * 4 + 30);
    }
    if (enabled.has('ADX')) {
        maxWarmup = Math.max(maxWarmup, params.adxPeriod * 4 + 30);
    }
    if (enabled.has('ATR')) {
        maxWarmup = Math.max(maxWarmup, params.atrPeriod * 3 + 20);
    }
    if (enabled.has('BB')) {
        maxWarmup = Math.max(maxWarmup, params.bbPeriod + 10);
    }
    if (enabled.has('CCI')) {
        maxWarmup = Math.max(maxWarmup, params.cciPeriod + 10);
    }
    if (enabled.has('STOCH')) {
        maxWarmup = Math.max(maxWarmup, params.stochK + params.stochSmoothK + params.stochD + 10);
    }
    return Math.min(maxWarmup, 400);
}
