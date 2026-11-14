import type { SupportedInterval } from './types.js';

export interface NormalizedInterval {
    canonical: string;
    tvResolution: string;
    scannerSuffix: string | null;
    scannerIntervalLabel: string;
    secondsPerBar: number;
}

const INTERVAL_MAP: Record<string, NormalizedInterval> = {
    '1m': { canonical: '1m', tvResolution: '1', scannerSuffix: '|1', scannerIntervalLabel: '1m', secondsPerBar: 60 },
    '1': { canonical: '1m', tvResolution: '1', scannerSuffix: '|1', scannerIntervalLabel: '1m', secondsPerBar: 60 },

    '3m': { canonical: '3m', tvResolution: '3', scannerSuffix: null, scannerIntervalLabel: '1m (nearest scanner)', secondsPerBar: 180 },
    '3': { canonical: '3m', tvResolution: '3', scannerSuffix: null, scannerIntervalLabel: '1m (nearest scanner)', secondsPerBar: 180 },

    '5m': { canonical: '5m', tvResolution: '5', scannerSuffix: '|5', scannerIntervalLabel: '5m', secondsPerBar: 300 },
    '5': { canonical: '5m', tvResolution: '5', scannerSuffix: '|5', scannerIntervalLabel: '5m', secondsPerBar: 300 },

    '15m': { canonical: '15m', tvResolution: '15', scannerSuffix: '|15', scannerIntervalLabel: '15m', secondsPerBar: 900 },
    '15': { canonical: '15m', tvResolution: '15', scannerSuffix: '|15', scannerIntervalLabel: '15m', secondsPerBar: 900 },

    '30m': { canonical: '30m', tvResolution: '30', scannerSuffix: '|30', scannerIntervalLabel: '30m', secondsPerBar: 1800 },
    '30': { canonical: '30m', tvResolution: '30', scannerSuffix: '|30', scannerIntervalLabel: '30m', secondsPerBar: 1800 },

    '45m': { canonical: '45m', tvResolution: '45', scannerSuffix: null, scannerIntervalLabel: '30m (nearest scanner)', secondsPerBar: 2700 },
    '45': { canonical: '45m', tvResolution: '45', scannerSuffix: null, scannerIntervalLabel: '30m (nearest scanner)', secondsPerBar: 2700 },

    '1h': { canonical: '1h', tvResolution: '60', scannerSuffix: '|60', scannerIntervalLabel: '1h', secondsPerBar: 3600 },
    '60': { canonical: '1h', tvResolution: '60', scannerSuffix: '|60', scannerIntervalLabel: '1h', secondsPerBar: 3600 },

    '2h': { canonical: '2h', tvResolution: '120', scannerSuffix: '|120', scannerIntervalLabel: '2h', secondsPerBar: 7200 },
    '120': { canonical: '2h', tvResolution: '120', scannerSuffix: '|120', scannerIntervalLabel: '2h', secondsPerBar: 7200 },

    '3h': { canonical: '3h', tvResolution: '180', scannerSuffix: null, scannerIntervalLabel: '2h (nearest scanner)', secondsPerBar: 10800 },
    '180': { canonical: '3h', tvResolution: '180', scannerSuffix: null, scannerIntervalLabel: '2h (nearest scanner)', secondsPerBar: 10800 },

    '4h': { canonical: '4h', tvResolution: '240', scannerSuffix: '|240', scannerIntervalLabel: '4h', secondsPerBar: 14400 },
    '240': { canonical: '4h', tvResolution: '240', scannerSuffix: '|240', scannerIntervalLabel: '4h', secondsPerBar: 14400 },

    '1d': { canonical: '1d', tvResolution: '1D', scannerSuffix: '', scannerIntervalLabel: '1d', secondsPerBar: 86400 },
    '1D': { canonical: '1d', tvResolution: '1D', scannerSuffix: '', scannerIntervalLabel: '1d', secondsPerBar: 86400 },

    '1w': { canonical: '1w', tvResolution: '1W', scannerSuffix: '|1W', scannerIntervalLabel: '1w', secondsPerBar: 604800 },
    '1W': { canonical: '1w', tvResolution: '1W', scannerSuffix: '|1W', scannerIntervalLabel: '1w', secondsPerBar: 604800 },

    '1M': { canonical: '1M', tvResolution: '1M', scannerSuffix: '|1M', scannerIntervalLabel: '1M', secondsPerBar: 2592000 },
};

const NEAREST_SCANNER_FALLBACK: Record<string, string> = {
    '3m': '|1',
    '45m': '|30',
    '3h': '|120',
};

export function normalizeInterval(interval: SupportedInterval | string): NormalizedInterval {
    const trimmed = interval.trim();
    const mapped = INTERVAL_MAP[trimmed];
    if (!mapped) {
        throw new Error(
            `Unsupported interval "${interval}". Supported values: 1m, 3m, 5m, 15m, 30m, 45m, 1h, 2h, 3h, 4h, 1d, 1w, 1M (or TradingView codes 1, 3, 5, 15, 30, 45, 60, 120, 180, 240, 1D, 1W, 1M).`,
        );
    }
    return mapped;
}

export function getEffectiveScannerSuffix(normalized: NormalizedInterval): {
    suffix: string;
    exact: boolean;
} {
    if (normalized.scannerSuffix !== null) {
        return { suffix: normalized.scannerSuffix, exact: true };
    }
    return {
        suffix: NEAREST_SCANNER_FALLBACK[normalized.canonical] ?? '',
        exact: false,
    };
}
