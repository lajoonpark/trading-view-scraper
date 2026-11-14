# TradingView Stock & Indicator Scraper (Apify Actor)

An Apify Actor built with TypeScript and Apify SDK v3 for scraping **only the specific stocks/tickers you request** (zero screener noise), along with **historical OHLCV price bars** across configurable timeframes (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`, `1M`, etc.) and **technical indicators** (`MACD`, `RSI`, `EMA`, `SMA`, `Bollinger Bands`, `Stochastic`, `ATR`, `ADX`, `VWAP`, `OBV`, `CCI`, `ROC`).

## Features

- **Targeted Stock Scraping (Zero Noise)**: Accepts explicit `EXCHANGE:SYMBOL` pairs (e.g. `NASDAQ:AAPL`, `NYSE:TSLA`, `BINANCE:BTCUSDT`) or bare tickers (e.g. `AAPL`, `NVDA`) automatically resolved via TradingView Symbol Search with configurable exchange priority.
- **Historical OHLCV Bars at Any Interval**: Fetches historical candlesticks via TradingView's Chart WebSocket protocol (`wss://data.tradingview.com/socket.io/websocket`) with automatic warmup bars, pagination (`request_more_data`), and optional `fromDate`/`toDate` filtering.
- **Per-Bar Technical Indicators**: Computes TradingView-aligned indicators (Wilder's RMA for RSI/ATR/ADX, EMA, SMA, MACD, Bollinger Bands, Stochastic, VWAP, OBV, CCI, ROC) on warmed-up series and attaches them to every historical bar.
- **Live TradingView Scanner Snapshot**: Enriches each ticker with TradingView's official Scanner technical snapshot for the selected interval (RSI, MACD, Moving Averages, Oscillators, `Recommend.All` Buy/Sell/Neutral signals, market cap, P/E, EPS, sector, and industry).

## Supported Intervals

| Input | TradingView Resolution | Scanner Exact Match |
|---|---|---|
| `1m`, `3m`, `5m`, `15m`, `30m`, `45m` | `1`, `3`, `5`, `15`, `30`, `45` | `1m`, `5m`, `15m`, `30m` |
| `1h`, `2h`, `3h`, `4h` | `60`, `120`, `180`, `240` | `1h`, `2h`, `4h` |
| `1d`, `1w`, `1M` | `1D`, `1W`, `1M` | `1d`, `1w`, `1M` |

## Supported Per-Bar Indicators

Pass any subset in `indicators`:

- `RSI` (default period: `14`)
- `MACD` (default: `12`, `26`, `9` — returns `macd`, `signal`, `histogram`)
- `EMA` (default periods: `[20, 50, 200]`)
- `SMA` (default periods: `[20, 50, 200]`)
- `BB` (Bollinger Bands, default: `20`, `2` std dev — returns `upper`, `basis`, `lower`)
- `STOCH` (Stochastic, default: `14`, `3`, `3` — returns `k`, `d`)
- `ATR` (Average True Range, default: `14`)
- `ADX` (Average Directional Index, default: `14` — returns `adx`, `plusDI`, `minusDI`)
- `VWAP` (Session-anchored daily reset for intraday intervals)
- `OBV` (On-Balance Volume)
- `CCI` (Commodity Channel Index, default: `20`)
- `ROC` (Rate of Change, default: `9`)

## Example Input

```json
{
  "symbols": ["NASDAQ:AAPL", "NASDAQ:NVDA", "MSFT"],
  "interval": "4h",
  "barsCount": 100,
  "indicators": ["RSI", "MACD", "EMA", "SMA", "BB"],
  "includeHistoricalBars": true,
  "includePerBarIndicators": true,
  "includeScannerSnapshot": true
}
```

## Example Output Item (Dataset)

Each requested ticker produces one clean dataset item:

```json
{
  "requestedSymbol": "NASDAQ:AAPL",
  "ticker": "NASDAQ:AAPL",
  "exchange": "NASDAQ",
  "symbol": "AAPL",
  "description": "Apple Inc.",
  "assetType": "stock",
  "currency": "USD",
  "interval": "4h",
  "tvResolution": "240",
  "scrapedAt": "2026-11-14T03:00:00.000Z",
  "barsCount": 100,
  "latestBar": {
    "timestamp": 1763053200,
    "datetime": "2026-11-13T17:00:00.000Z",
    "open": 358.02,
    "high": 358.66,
    "low": 355.75,
    "close": 356.4,
    "volume": 7412378,
    "indicators": {
      "rsi": 60.47,
      "macd": { "macd": 3.55, "signal": 2.51, "histogram": 1.04 },
      "ema": { "ema20": 346.55, "ema50": 338.75, "ema200": 327.22 },
      "sma": { "sma20": 346.15, "sma50": 339.04, "sma200": 326.57 },
      "bb": { "upper": 357.78, "basis": 346.15, "lower": 334.52 }
    }
  },
  "scannerSnapshot": {
    "intervalUsed": "4h",
    "scannerResolutionExact": true,
    "recommendations": {
      "overallScore": 0.4,
      "overallSignal": "BUY"
    }
  },
  "historicalBars": [ ... ],
  "warnings": [],
  "error": null
}
```

## Local Development & Testing

```bash
npm install
npm run build
npm test         # Unit tests
npm run test:e2e # Live TradingView Scanner/Search + Actor storage E2E tests
```