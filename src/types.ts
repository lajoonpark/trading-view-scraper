export type SupportedInterval =
    | '1m'
    | '3m'
    | '5m'
    | '15m'
    | '30m'
    | '45m'
    | '1h'
    | '2h'
    | '3h'
    | '4h'
    | '1d'
    | '1w'
    | '1M'
    | '1'
    | '3'
    | '5'
    | '15'
    | '30'
    | '45'
    | '60'
    | '120'
    | '180'
    | '240'
    | '1D'
    | '1W';

export type IndicatorName =
    | 'RSI'
    | 'MACD'
    | 'EMA'
    | 'SMA'
    | 'BB'
    | 'STOCH'
    | 'ATR'
    | 'ADX'
    | 'VWAP'
    | 'OBV'
    | 'CCI'
    | 'ROC'
    | 'SMC';

export type SearchAssetType =
    | 'stock'
    | 'etf'
    | 'crypto'
    | 'forex'
    | 'index'
    | 'futures'
    | 'all';

export type ChartSessionType = 'regular' | 'extended';
export type PriceAdjustment = 'splits' | 'dividends';

export interface IndicatorParams {
    rsiPeriod: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    emaPeriods: number[];
    smaPeriods: number[];
    bbPeriod: number;
    bbStdDev: number;
    stochK: number;
    stochSmoothK: number;
    stochD: number;
    atrPeriod: number;
    adxPeriod: number;
    cciPeriod: number;
    rocPeriod: number;
    smcSwingLength: number;
    smcInternalLength: number;
}

export interface ActorInput {
    symbols: string[];
    interval: SupportedInterval;
    barsCount: number;
    fromDate?: string;
    toDate?: string;
    indicators: IndicatorName[];
    indicatorParams: IndicatorParams;
    includeHistoricalBars: boolean;
    includePerBarIndicators: boolean;
    includeScannerSnapshot: boolean;
    searchType: SearchAssetType;
    preferredExchanges: string[];
    session: ChartSessionType;
    adjustment: PriceAdjustment;
    maxConcurrency: number;
    requestTimeoutMs: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
        proxyUrls?: string[];
    };
}

export interface ResolvedSymbol {
    requestedSymbol: string;
    ticker: string; // Canonical EXCHANGE:SYMBOL e.g. NASDAQ:AAPL
    exchange: string;
    symbol: string;
    description?: string;
    type?: string;
    currency?: string;
}

export interface OhlcvBar {
    timestamp: number; // Unix seconds (UTC)
    datetime: string;  // ISO 8601 UTC string
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export type SmcTrend = 'bullish' | 'bearish' | 'neutral';
export type SmcBreakTag = 'BOS' | 'CHoCH';
export type SmcZone = 'discount' | 'equilibrium' | 'premium' | 'neutral';

export interface SmcStructureEvent {
    tag: SmcBreakTag;
    direction: 'bullish' | 'bearish';
    level: number;
    pivotDatetime: string;
    breakDatetime: string;
}

export interface SmcStructureSnapshot {
    trend: SmcTrend;
    signal: {
        tag: SmcBreakTag;
        direction: 'bullish' | 'bearish';
        level: number;
    } | null;
    lastBreak: SmcStructureEvent | null;
    strongHigh: number | null;
    weakHigh: number | null;
    strongLow: number | null;
    weakLow: number | null;
    trailingHigh: number | null;
    trailingLow: number | null;
    equilibrium: number | null;
    zone: SmcZone;
}

export interface SmcPerBarIndicator {
    swing: SmcStructureSnapshot;
    internal: SmcStructureSnapshot;
}

export interface PerBarIndicators {
    rsi?: number | null;
    macd?: {
        macd: number | null;
        signal: number | null;
        histogram: number | null;
    };
    ema?: Record<string, number | null>;
    sma?: Record<string, number | null>;
    bb?: {
        upper: number | null;
        basis: number | null;
        lower: number | null;
    };
    stoch?: {
        k: number | null;
        d: number | null;
    };
    atr?: number | null;
    adx?: {
        adx: number | null;
        plusDI: number | null;
        minusDI: number | null;
    };
    vwap?: number | null;
    obv?: number | null;
    cci?: number | null;
    roc?: number | null;
    smc?: SmcPerBarIndicator;
}

export interface EnrichedOhlcvBar extends OhlcvBar {
    indicators?: PerBarIndicators;
}

export type RecommendationSignal =
    | 'STRONG_BUY'
    | 'BUY'
    | 'NEUTRAL'
    | 'SELL'
    | 'STRONG_SELL'
    | null;

export interface ScannerSnapshot {
    intervalUsed: string;
    scannerResolutionExact: boolean;
    name: string | null;
    description: string | null;
    exchange: string | null;
    type: string | null;
    currency: string | null;
    sector: string | null;
    industry: string | null;
    updateMode: string | null;
    price: {
        open: number | null;
        high: number | null;
        low: number | null;
        close: number | null;
        volume: number | null;
        changePercent: number | null;
        changeAbs: number | null;
    };
    fundamentals: {
        marketCap: number | null;
        peRatioTtm: number | null;
        epsBasicTtm: number | null;
    };
    recommendations: {
        overallScore: number | null;
        overallSignal: RecommendationSignal;
        oscillatorsScore: number | null;
        oscillatorsSignal: RecommendationSignal;
        movingAveragesScore: number | null;
        movingAveragesSignal: RecommendationSignal;
    };
    indicators: {
        rsi14: number | null;
        rsi14Prev: number | null;
        macd: number | null;
        macdSignal: number | null;
        macdHistogram: number | null;
        stochK: number | null;
        stochD: number | null;
        cci20: number | null;
        adx14: number | null;
        adxPlusDI: number | null;
        adxMinusDI: number | null;
        awesomeOscillator: number | null;
        momentum10: number | null;
        atr14: number | null;
        vwap: number | null;
        bbUpper: number | null;
        bbBasis: number | null;
        bbLower: number | null;
        ichimokuBaseLine: number | null;
        ichimokuConversionLine: number | null;
        ema: Record<string, number | null>;
        sma: Record<string, number | null>;
    };
}

export interface ScrapedStockResult {
    requestedSymbol: string;
    ticker: string;
    exchange: string;
    symbol: string;
    description: string | null;
    assetType: string | null;
    currency: string | null;
    interval: string;
    tvResolution: string;
    scrapedAt: string;
    barsCount: number;
    latestBar: EnrichedOhlcvBar | null;
    scannerSnapshot: ScannerSnapshot | null;
    historicalBars: EnrichedOhlcvBar[];
    warnings: string[];
    error: string | null;
}
