import type {
    IndicatorName,
    IndicatorParams,
    OhlcvBar,
    PerBarIndicators,
    SmcBreakTag,
    SmcEqualLevel,
    SmcPerBarIndicator,
    SmcStructureEvent,
    SmcStructureSnapshot,
    SmcSweepEvent,
    SmcTrend,
    SmcZone,
    SmcZoneBox,
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

interface SmcPivot {
    idx: number;
    level: number;
    datetime: string;
    crossed: boolean;
}

function roundSmcBox(box: SmcZoneBox): SmcZoneBox {
    return {
        top: roundValue(box.top, 6) ?? box.top,
        bottom: roundValue(box.bottom, 6) ?? box.bottom,
        datetime: box.datetime,
    };
}

function pickNearestZoneBox(
    boxes: SmcZoneBox[],
    close: number,
    side: 'bullish' | 'bearish',
): SmcZoneBox | null {
    let best: SmcZoneBox | null = null;
    for (const box of boxes) {
        if (side === 'bullish') {
            if (box.bottom <= close && (!best || box.top > best.top)) {
                best = box;
            }
        } else if (box.top >= close && (!best || box.bottom < best.bottom)) {
            best = box;
        }
    }
    return best ? roundSmcBox(best) : null;
}

function findOrderBlockCandle(
    bars: OhlcvBar[],
    startIdx: number,
    endIdx: number,
    direction: 'bullish' | 'bearish',
): SmcZoneBox | null {
    const lo = Math.max(0, startIdx);
    const hi = Math.min(bars.length - 1, endIdx);
    if (lo > hi) return null;

    let bestIdx = lo;
    for (let k = lo + 1; k <= hi; k++) {
        if (direction === 'bullish') {
            if (bars[k].low < bars[bestIdx].low) bestIdx = k;
        } else if (bars[k].high > bars[bestIdx].high) {
            bestIdx = k;
        }
    }

    const chosen = bars[bestIdx];
    return {
        top: chosen.high,
        bottom: chosen.low,
        datetime: chosen.datetime,
    };
}

function classifySmcZone(close: number, low: number, high: number): SmcZone {
    const range = high - low;
    if (!Number.isFinite(range) || range <= 0) return 'neutral';
    const pos = (close - low) / range;
    if (pos < 0.475) return 'discount';
    if (pos > 0.525) return 'premium';
    return 'equilibrium';
}

/**
 * Compute LuxAlgo-style Smart Money Concepts structure (leg pivots, BOS/CHoCH,
 * Strong/Weak High & Low trailing extremes, Order Blocks, EQH/EQL, Liquidity Sweeps,
 * and Premium/Discount zones) for a given lookback size.
 */
export function computeSmcStructure(
    bars: OhlcvBar[],
    size: number,
    atrSeries?: (number | null)[],
): SmcStructureSnapshot[] {
    const out: SmcStructureSnapshot[] = new Array(bars.length);
    if (bars.length === 0) return out;

    let leg: 0 | 1 = 0; // 0 = bearish leg (swing high), 1 = bullish leg (swing low)
    let trendNum: -1 | 0 | 1 = 0;
    let lastHigh: SmcPivot | null = null;
    let lastLow: SmcPivot | null = null;
    let prevHigh: SmcPivot | null = null;
    let prevLow: SmcPivot | null = null;
    let activeEqh: SmcEqualLevel | null = null;
    let activeEql: SmcEqualLevel | null = null;
    let lastBreak: SmcStructureEvent | null = null;
    let lastSweep: SmcSweepEvent | null = null;
    let bullishObs: SmcZoneBox[] = [];
    let bearishObs: SmcZoneBox[] = [];
    let trailingTop = bars[0].high;
    let trailingBottom = bars[0].low;

    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const barAtr = atrSeries?.[i] ?? null;
        const eqTolerance = barAtr !== null && barAtr > 0 ? barAtr * 0.15 : bar.close * 0.002;

        // Mitigate active Order Blocks and Equal Highs/Lows before checking new breaks/sweeps
        bullishObs = bullishObs.filter((ob) => bar.low >= ob.bottom);
        bearishObs = bearishObs.filter((ob) => bar.high <= ob.top);

        let barSweep: SmcSweepEvent | null = null;

        // Check Bullish Liquidity Sweep (wick below EQL / Weak Low / lastLow, closes back above)
        if (activeEql && bar.low < activeEql.level) {
            if (bar.close > activeEql.level) {
                barSweep = {
                    direction: 'bullish',
                    kind: 'EQL',
                    level: roundValue(activeEql.level, 6) ?? activeEql.level,
                    sweepDatetime: bar.datetime,
                };
            }
            activeEql = null;
        } else if (trendNum === -1 && i > 0 && bar.low < trailingBottom && bar.close > trailingBottom) {
            barSweep = {
                direction: 'bullish',
                kind: 'low',
                level: roundValue(trailingBottom, 6) ?? trailingBottom,
                sweepDatetime: bar.datetime,
            };
        } else if (lastLow && !lastLow.crossed && bar.low < lastLow.level && bar.close > lastLow.level) {
            barSweep = {
                direction: 'bullish',
                kind: 'low',
                level: roundValue(lastLow.level, 6) ?? lastLow.level,
                sweepDatetime: bar.datetime,
            };
        }

        // Check Bearish Liquidity Sweep (wick above EQH / Weak High / lastHigh, closes back below)
        if (activeEqh && bar.high > activeEqh.level) {
            if (!barSweep && bar.close < activeEqh.level) {
                barSweep = {
                    direction: 'bearish',
                    kind: 'EQH',
                    level: roundValue(activeEqh.level, 6) ?? activeEqh.level,
                    sweepDatetime: bar.datetime,
                };
            }
            activeEqh = null;
        } else if (!barSweep && trendNum === 1 && i > 0 && bar.high > trailingTop && bar.close < trailingTop) {
            barSweep = {
                direction: 'bearish',
                kind: 'high',
                level: roundValue(trailingTop, 6) ?? trailingTop,
                sweepDatetime: bar.datetime,
            };
        } else if (!barSweep && lastHigh && !lastHigh.crossed && bar.high > lastHigh.level && bar.close < lastHigh.level) {
            barSweep = {
                direction: 'bearish',
                kind: 'high',
                level: roundValue(lastHigh.level, 6) ?? lastHigh.level,
                sweepDatetime: bar.datetime,
            };
        }

        if (barSweep) {
            lastSweep = barSweep;
        }

        if (bar.high > trailingTop) trailingTop = bar.high;
        if (bar.low < trailingBottom) trailingBottom = bar.low;

        if (size > 0 && i >= size) {
            const candIdx = i - size;
            const cand = bars[candIdx];
            let maxFollowingHigh = -Infinity;
            let minFollowingLow = Infinity;
            for (let j = candIdx + 1; j <= i; j++) {
                if (bars[j].high > maxFollowingHigh) maxFollowingHigh = bars[j].high;
                if (bars[j].low < minFollowingLow) minFollowingLow = bars[j].low;
            }

            let newLeg: 0 | 1 = leg;
            if (cand.high > maxFollowingHigh) {
                newLeg = 0;
            } else if (cand.low < minFollowingLow) {
                newLeg = 1;
            }

            if (newLeg !== leg) {
                leg = newLeg;
                if (leg === 1) {
                    prevLow = lastLow;
                    lastLow = { idx: candIdx, level: cand.low, datetime: cand.datetime, crossed: false };
                    if (prevLow && Math.abs(lastLow.level - prevLow.level) <= eqTolerance) {
                        activeEql = {
                            kind: 'EQL',
                            level: roundValue(Math.min(lastLow.level, prevLow.level), 6) ?? lastLow.level,
                            datetime: cand.datetime,
                        };
                    }
                    trailingBottom = cand.low;
                    let localTop = cand.high;
                    for (let j = candIdx + 1; j <= i; j++) {
                        if (bars[j].high > localTop) localTop = bars[j].high;
                        if (bars[j].low < trailingBottom) trailingBottom = bars[j].low;
                    }
                    trailingTop = localTop;
                } else {
                    prevHigh = lastHigh;
                    lastHigh = { idx: candIdx, level: cand.high, datetime: cand.datetime, crossed: false };
                    if (prevHigh && Math.abs(lastHigh.level - prevHigh.level) <= eqTolerance) {
                        activeEqh = {
                            kind: 'EQH',
                            level: roundValue(Math.max(lastHigh.level, prevHigh.level), 6) ?? lastHigh.level,
                            datetime: cand.datetime,
                        };
                    }
                    trailingTop = cand.high;
                    let localBot = cand.low;
                    for (let j = candIdx + 1; j <= i; j++) {
                        if (bars[j].low < localBot) localBot = bars[j].low;
                        if (bars[j].high > trailingTop) trailingTop = bars[j].high;
                    }
                    trailingBottom = localBot;
                }
            }
        }

        let barSignal: { tag: SmcBreakTag; direction: 'bullish' | 'bearish'; level: number } | null = null;

        if (lastHigh && !lastHigh.crossed && bar.close > lastHigh.level) {
            const tag: SmcBreakTag = trendNum === -1 ? 'CHoCH' : 'BOS';
            trendNum = 1;
            lastHigh.crossed = true;
            const level = roundValue(lastHigh.level, 6) ?? lastHigh.level;
            barSignal = { tag, direction: 'bullish', level };
            lastBreak = {
                tag,
                direction: 'bullish',
                level,
                pivotDatetime: lastHigh.datetime,
                breakDatetime: bar.datetime,
            };
            const ob = findOrderBlockCandle(bars, lastHigh.idx, i - 1, 'bullish');
            if (ob && bar.low >= ob.bottom) {
                bullishObs.push(ob);
                if (bullishObs.length > 20) bullishObs.shift();
            }
        }

        if (lastLow && !lastLow.crossed && bar.close < lastLow.level) {
            const tag: SmcBreakTag = trendNum === 1 ? 'CHoCH' : 'BOS';
            trendNum = -1;
            lastLow.crossed = true;
            const level = roundValue(lastLow.level, 6) ?? lastLow.level;
            barSignal = { tag, direction: 'bearish', level };
            lastBreak = {
                tag,
                direction: 'bearish',
                level,
                pivotDatetime: lastLow.datetime,
                breakDatetime: bar.datetime,
            };
            const ob = findOrderBlockCandle(bars, lastLow.idx, i - 1, 'bearish');
            if (ob && bar.high <= ob.top) {
                bearishObs.push(ob);
                if (bearishObs.length > 20) bearishObs.shift();
            }
        }

        const trend: SmcTrend = trendNum === 1 ? 'bullish' : trendNum === -1 ? 'bearish' : 'neutral';
        const roundedHigh = roundValue(trailingTop, 6);
        const roundedLow = roundValue(trailingBottom, 6);
        const equilibrium = roundValue((trailingTop + trailingBottom) / 2, 6);

        out[i] = {
            trend,
            signal: barSignal,
            lastBreak,
            strongHigh: trend === 'bearish' ? roundedHigh : null,
            weakHigh: trend === 'bullish' ? roundedHigh : null,
            strongLow: trend === 'bullish' ? roundedLow : null,
            weakLow: trend === 'bearish' ? roundedLow : null,
            trailingHigh: roundedHigh,
            trailingLow: roundedLow,
            equilibrium,
            zone: classifySmcZone(bar.close, trailingBottom, trailingTop),
            bullishOb: pickNearestZoneBox(bullishObs, bar.close, 'bullish'),
            bearishOb: pickNearestZoneBox(bearishObs, bar.close, 'bearish'),
            eqh: activeEqh,
            eql: activeEql,
            liquiditySweep: barSweep,
            lastSweep,
        };
    }

    return out;
}

/**
 * Compute nearest active unmitigated Bullish and Bearish Fair Value Gaps (FVG) per bar.
 */
export function computeFairValueGaps(
    bars: OhlcvBar[],
    atrSeries?: (number | null)[],
): { bullishFvg: (SmcZoneBox | null)[]; bearishFvg: (SmcZoneBox | null)[] } {
    const bullishOut: (SmcZoneBox | null)[] = new Array(bars.length).fill(null);
    const bearishOut: (SmcZoneBox | null)[] = new Array(bars.length).fill(null);
    let activeBullish: SmcZoneBox[] = [];
    let activeBearish: SmcZoneBox[] = [];

    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        activeBullish = activeBullish.filter((fvg) => bar.low > fvg.bottom);
        activeBearish = activeBearish.filter((fvg) => bar.high < fvg.top);

        if (i >= 2) {
            const left = bars[i - 2];
            const mid = bars[i - 1];
            const barAtr = atrSeries?.[i] ?? null;
            const minGap = barAtr !== null && barAtr > 0 ? barAtr * 0.1 : 0;

            if (bar.low > left.high && mid.close > left.high && bar.low - left.high >= minGap) {
                activeBullish.push({ top: bar.low, bottom: left.high, datetime: mid.datetime });
                if (activeBullish.length > 20) activeBullish.shift();
            }
            if (bar.high < left.low && mid.close < left.low && left.low - bar.high >= minGap) {
                activeBearish.push({ top: left.low, bottom: bar.high, datetime: mid.datetime });
                if (activeBearish.length > 20) activeBearish.shift();
            }
        }

        bullishOut[i] = pickNearestZoneBox(activeBullish, bar.close, 'bullish');
        bearishOut[i] = pickNearestZoneBox(activeBearish, bar.close, 'bearish');
    }

    return { bullishFvg: bullishOut, bearishFvg: bearishOut };
}

/**
 * Compute dual-horizon LuxAlgo SMC indicators (`swing` and `internal`) plus FVG zones per bar.
 */
export function computeSmc(
    bars: OhlcvBar[],
    swingLength: number,
    internalLength: number,
    atrSeries?: (number | null)[],
): SmcPerBarIndicator[] {
    const resolvedAtr = atrSeries ?? computeAtr(bars, 14);
    const swing = computeSmcStructure(bars, swingLength, resolvedAtr);
    const internal = computeSmcStructure(bars, internalLength, resolvedAtr);
    const { bullishFvg, bearishFvg } = computeFairValueGaps(bars, resolvedAtr);
    return bars.map((_, i) => ({
        swing: swing[i],
        internal: internal[i],
        bullishFvg: bullishFvg[i],
        bearishFvg: bearishFvg[i],
    }));
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
    const atr = enabled.has('ATR') || enabled.has('SMC') ? computeAtr(bars, params.atrPeriod) : null;
    const adx = enabled.has('ADX') ? computeAdx(bars, params.adxPeriod) : null;
    const vwap = enabled.has('VWAP') ? computeVwap(bars, isIntraday) : null;
    const obv = enabled.has('OBV') ? computeObv(bars) : null;
    const cci = enabled.has('CCI') ? computeCci(bars, params.cciPeriod) : null;
    const roc = enabled.has('ROC') ? computeRoc(closes, params.rocPeriod) : null;
    const smc = enabled.has('SMC')
        ? computeSmc(bars, params.smcSwingLength, params.smcInternalLength, atr ?? undefined)
        : null;

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
        if (atr && enabled.has('ATR')) entry.atr = roundValue(atr[i], 6);
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
        if (smc) entry.smc = smc[i];
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
    if (enabled.has('SMC')) {
        maxWarmup = Math.max(maxWarmup, Math.max(params.smcSwingLength, params.smcInternalLength) * 4 + 30);
    }
    return Math.min(maxWarmup, 400);
}
