import { z } from 'zod';
import type { ActorInput } from './types.js';

export const DEFAULT_INDICATORS = ['RSI', 'MACD', 'EMA', 'SMA', 'BB'] as const;

export const DEFAULT_PREFERRED_EXCHANGES = [
    'NASDAQ',
    'NYSE',
    'AMEX',
    'ARCA',
    'BATS',
    'TSX',
    'LSE',
    'BINANCE',
    'COINBASE',
    'FX',
];

const indicatorEnum = z.enum([
    'RSI',
    'MACD',
    'EMA',
    'SMA',
    'BB',
    'STOCH',
    'ATR',
    'ADX',
    'VWAP',
    'OBV',
    'CCI',
    'ROC',
]);

const intervalEnum = z.enum([
    '1m',
    '3m',
    '5m',
    '15m',
    '30m',
    '45m',
    '1h',
    '2h',
    '3h',
    '4h',
    '1d',
    '1w',
    '1M',
    '1',
    '3',
    '5',
    '15',
    '30',
    '45',
    '60',
    '120',
    '180',
    '240',
    '1D',
    '1W',
]);

const indicatorParamsSchema = z
    .object({
        rsiPeriod: z.number().int().min(2).max(200).default(14),
        macdFast: z.number().int().min(2).max(200).default(12),
        macdSlow: z.number().int().min(3).max(400).default(26),
        macdSignal: z.number().int().min(2).max(200).default(9),
        emaPeriods: z.array(z.number().int().min(2).max(500)).min(1).max(10).default([20, 50, 200]),
        smaPeriods: z.array(z.number().int().min(2).max(500)).min(1).max(10).default([20, 50, 200]),
        bbPeriod: z.number().int().min(2).max(200).default(20),
        bbStdDev: z.number().min(0.5).max(5).default(2),
        stochK: z.number().int().min(2).max(200).default(14),
        stochSmoothK: z.number().int().min(1).max(50).default(3),
        stochD: z.number().int().min(1).max(50).default(3),
        atrPeriod: z.number().int().min(2).max(200).default(14),
        adxPeriod: z.number().int().min(2).max(200).default(14),
        cciPeriod: z.number().int().min(2).max(200).default(20),
        rocPeriod: z.number().int().min(1).max(200).default(9),
    })
    .default({});

export const actorInputSchema = z.object({
    symbols: z
        .array(z.string().trim().min(1))
        .min(1, 'At least one stock/ticker symbol must be provided in "symbols".')
        .max(200),
    interval: intervalEnum.default('1d'),
    barsCount: z.number().int().min(1).max(5000).default(100),
    fromDate: z.string().trim().optional(),
    toDate: z.string().trim().optional(),
    indicators: z.array(indicatorEnum).default([...DEFAULT_INDICATORS]),
    indicatorParams: indicatorParamsSchema,
    includeHistoricalBars: z.boolean().default(true),
    includePerBarIndicators: z.boolean().default(true),
    includeScannerSnapshot: z.boolean().default(true),
    searchType: z
        .enum(['stock', 'etf', 'crypto', 'forex', 'index', 'futures', 'all'])
        .default('stock'),
    preferredExchanges: z.array(z.string().trim().min(1)).default([...DEFAULT_PREFERRED_EXCHANGES]),
    session: z.enum(['regular', 'extended']).default('regular'),
    adjustment: z.enum(['splits', 'dividends']).default('splits'),
    maxConcurrency: z.number().int().min(1).max(15).default(5),
    requestTimeoutMs: z.number().int().min(3000).max(120000).default(25000),
    proxyConfiguration: z
        .object({
            useApifyProxy: z.boolean().optional(),
            apifyProxyGroups: z.array(z.string()).optional(),
            apifyProxyCountry: z.string().optional(),
            proxyUrls: z.array(z.string()).optional(),
        })
        .optional(),
});

export function parseActorInput(rawInput: unknown): ActorInput {
    const rawObj = (typeof rawInput === 'object' && rawInput !== null ? rawInput : {}) as Record<string, unknown>;
    const normalizedRaw =
        rawObj.fromDate !== undefined && rawObj.barsCount === undefined
            ? { ...rawObj, barsCount: 5000 }
            : rawObj;
    const parsed = actorInputSchema.parse(normalizedRaw);

    if (parsed.indicatorParams.macdFast >= parsed.indicatorParams.macdSlow) {
        throw new Error(
            `indicatorParams.macdFast (${parsed.indicatorParams.macdFast}) must be less than indicatorParams.macdSlow (${parsed.indicatorParams.macdSlow}).`,
        );
    }

    if (parsed.fromDate) {
        const fromMs = Date.parse(parsed.fromDate);
        if (Number.isNaN(fromMs)) {
            throw new Error(`Invalid fromDate "${parsed.fromDate}". Provide a valid ISO 8601 date string.`);
        }
    }
    if (parsed.toDate) {
        const toMs = Date.parse(parsed.toDate);
        if (Number.isNaN(toMs)) {
            throw new Error(`Invalid toDate "${parsed.toDate}". Provide a valid ISO 8601 date string.`);
        }
    }
    if (parsed.fromDate && parsed.toDate && Date.parse(parsed.fromDate) > Date.parse(parsed.toDate)) {
        throw new Error(`fromDate (${parsed.fromDate}) must be earlier than or equal to toDate (${parsed.toDate}).`);
    }

    if (!parsed.includeHistoricalBars && !parsed.includeScannerSnapshot) {
        throw new Error('At least one of "includeHistoricalBars" or "includeScannerSnapshot" must be true.');
    }

    return parsed;
}
