import { describe, expect, it } from 'vitest';
import { getEffectiveScannerSuffix, normalizeInterval } from '../../src/intervals.js';

describe('intervals', () => {
    it('normalizes user-friendly intervals and TradingView native codes', () => {
        expect(normalizeInterval('1m')).toMatchObject({ canonical: '1m', tvResolution: '1', scannerSuffix: '|1', secondsPerBar: 60 });
        expect(normalizeInterval('4h')).toMatchObject({ canonical: '4h', tvResolution: '240', scannerSuffix: '|240', secondsPerBar: 14400 });
        expect(normalizeInterval('240')).toMatchObject({ canonical: '4h', tvResolution: '240' });
        expect(normalizeInterval('1d')).toMatchObject({ canonical: '1d', tvResolution: '1D', scannerSuffix: '', secondsPerBar: 86400 });
        expect(normalizeInterval('1D')).toMatchObject({ canonical: '1d', tvResolution: '1D', scannerSuffix: '' });
        expect(normalizeInterval('1w')).toMatchObject({ canonical: '1w', tvResolution: '1W', scannerSuffix: '|1W' });
        expect(normalizeInterval('1M')).toMatchObject({ canonical: '1M', tvResolution: '1M', scannerSuffix: '|1M' });
    });

    it('falls back cleanly for intervals without exact scanner suffix', () => {
        const norm3m = normalizeInterval('3m');
        expect(getEffectiveScannerSuffix(norm3m)).toEqual({ suffix: '|1', exact: false });

        const norm4h = normalizeInterval('4h');
        expect(getEffectiveScannerSuffix(norm4h)).toEqual({ suffix: '|240', exact: true });
    });

    it('throws a descriptive error for unsupported intervals', () => {
        expect(() => normalizeInterval('7m')).toThrow(/Unsupported interval/);
    });
});
