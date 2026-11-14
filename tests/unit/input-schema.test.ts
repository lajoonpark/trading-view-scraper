import { describe, expect, it } from 'vitest';
import { parseActorInput } from '../../src/input-schema.js';

describe('input-schema', () => {
    it('applies sensible defaults for minimal input', () => {
        const parsed = parseActorInput({ symbols: ['NASDAQ:AAPL'] });
        expect(parsed.interval).toBe('1d');
        expect(parsed.barsCount).toBe(100);
        expect(parsed.indicators).toEqual(['RSI', 'MACD', 'EMA', 'SMA', 'BB']);
        expect(parsed.includeHistoricalBars).toBe(true);
        expect(parsed.includePerBarIndicators).toBe(true);
        expect(parsed.includeScannerSnapshot).toBe(true);
        expect(parsed.maxConcurrency).toBe(15);
    });

    it('rejects empty symbols list', () => {
        expect(() => parseActorInput({ symbols: [] })).toThrow();
    });

    it('rejects macdFast >= macdSlow', () => {
        expect(() =>
            parseActorInput({
                symbols: ['AAPL'],
                indicatorParams: { macdFast: 26, macdSlow: 12 },
            }),
        ).toThrow(/macdFast/);
    });

    it('rejects invalid date range', () => {
        expect(() =>
            parseActorInput({
                symbols: ['AAPL'],
                fromDate: '2026-10-01',
                toDate: '2026-09-01',
            }),
        ).toThrow(/fromDate/);
    });

    it('defaults barsCount to 5000 when fromDate is provided without explicit barsCount', () => {
        const withFromDate = parseActorInput({
            symbols: ['AAPL'],
            fromDate: '2026-01-01',
        });
        expect(withFromDate.barsCount).toBe(5000);

        const withBoth = parseActorInput({
            symbols: ['AAPL'],
            fromDate: '2026-01-01',
            barsCount: 25,
        });
        expect(withBoth.barsCount).toBe(25);
    });
});
