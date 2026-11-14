# TradingView Multi-Timeframe Scan Playbook

This playbook defines the exact workflow to follow whenever the user asks for a market-wide stock scan and trade-worthiness brief.

> **Core Strictness Rule**
> - **Only recommend stocks with a bullish (rising) $\text{RSI}(14) \le 30$.**
> - Never relax rules silently to force picks. If `0` stocks satisfy all strict rules, report **0 recommendations** (optionally listing top non-recommended near-misses separately for watchlist tracking).
> - Never create scheduled automations unless explicitly asked; run scans on demand when prompted.

---

## Stage 1: Market-Wide Pre-Screen (TradingView Scanner API)

Run a local pre-screen against TradingView's Scanner API (`https://scanner.tradingview.com/america/scan`) to narrow thousands of tickers down to high-probability candidates before invoking the Apify Actor (minimizing cost and avoiding `HTTP 429` rate limits).

### Universe & Liquidity Filters
- **Exchanges:** `NASDAQ`, `NYSE`, `AMEX` (`type: stock`, exclude preferreds/OTC where possible).
- **Market Cap:** $\ge \$500\text{M}$ (`market_cap_basic >= 500000000`).
- **Share Price:** $\ge \$5.00$ (`close >= 5`).
- **Daily Dollar Liquidity:** Average daily dollar volume $\ge \$5\text{M}$ (`close * average_volume_10d_calc >= 5000000`) to exclude illiquid ADRs/thin stocks.
- **Session:** Evaluate **closed bars** (note delayed/live update mode and whether pre/post-market is excluded).

### Pre-Screen Columns (`60` = 1h, `120` = 2h, `240` = 4h, `1D` = Daily)
- `RSI|60`, `RSI[1]|60`, `RSI|120`, `RSI[1]|120`, `RSI|240`, `RSI[1]|240`, `RSI|1D`
- `MACD.macd|60`, `MACD.signal|60`, `MACD.macd|120`, `MACD.signal|120`, `MACD.macd|240`, `MACD.signal|240`
- `relative_volume_10d_calc|60`, `relative_volume_10d_calc|120`, `relative_volume_10d_calc|240`, `relative_volume_10d_calc` (Daily)
- `EMA200`, `SMA200`, `EMA200|240`, `ADX|60`, `ADX|240`
- Select top candidates (`<= 15` tickers per run) matching `RSI <= 35` across multiple timeframes for deep historical verification.

---

## Stage 2: Deep Multi-Timeframe Scrape (`imissmyac/trading-view-scraper`)

Run the deployed Apify Actor (`imissmyac/trading-view-scraper`) across **`1h`**, **`2h`**, and **`4h`** (plus **`1d`** on shortlisted candidates for Daily trend/EMA200 context):

```json
{
  "symbols": ["EXCHANGE:TICKER"],
  "interval": "1h",
  "barsCount": 200,
  "indicators": ["RSI", "MACD", "EMA", "SMA", "BB", "ATR", "ADX", "STOCH", "SMC"],
  "indicatorParams": {
    "smcSwingLength": 20,
    "smcInternalLength": 5
  },
  "includeHistoricalBars": true,
  "includePerBarIndicators": true,
  "includeScannerSnapshot": true,
  "maxConcurrency": 4
}
```

- Keep `maxConcurrency` at **`4`–`5`** (avoid `> 5` to prevent TradingView WebSocket `HTTP 429` rejections; Actor runs cleanly at `256 MB` memory).
- Request `barsCount: 200` (with `smcSwingLength: 20` and `smcInternalLength: 5` computed natively by the Actor on automatically warmed-up bars).

---

## Stage 3: Quantitative Filter Rules (1h + 2h + 4h Combined)

Every candidate must be evaluated on **all three** intraday timeframes (`1h`, `2h`, `4h`) plus **Daily** structure:

### 1. Strict Bullish RSI $\le 30$ (Hard Gate)
- **Strict 3x Rule (Locked):** Current closed-bar $\text{RSI}(14) \le 30$ and **rising** ($\text{RSI}[t] > \text{RSI}[t-1]$) on **all three** intervals (`1h`, `2h`, and `4h`).
- **Zero-Relaxation Policy:** Never recommend stocks whose `1h`, `2h`, or `4h` RSI is $> 30$ or falling. Near-misses (e.g., `2h`/`4h` $\le 30$ with `1h` popped above `30`) may be listed in a separate **"Watchlist / Non-Recommended Near-Misses"** section clearly marked as not qualifying.
- **Bonus Confirmation:** Prefer **2+ consecutive rising RSI bars** or a **bullish RSI divergence** (price prints a lower/equal low while RSI prints a higher low).

### 2. MACD Convergence / Intertwine Cascade
- **`1h` MACD:** Intertwined or fresh bullish cross (`|macd - signal| / close <= 0.35%` or histogram flipped positive within `1–3` bars).
- **`2h` & `4h` MACD:** Histogram **contracting toward zero** (`hist[t] > hist[t-1]`). Reject setups where `2h` or `4h` MACD is still *accelerating downward* (`hist[t] < hist[t-1]`).

### 3. Same-Session-Hour Volume & Liquidity
- Compare latest closed bar volume against the **same UTC session hour's 10-day average** (prevents US closing-auction `20:00–21:00 UTC` or opening-bell `14:30 UTC` volume distortion) as well as 20-bar average volume.
- Target **$\ge 1.2\times$** same-hour volume on `1h` and/or `4h` confirming buyer absorption, alongside **$\ge \$5\text{M}$** daily dollar volume.

### 4. Crash / Falling-Knife Guard
- **Shock Filter:** Flag/reject stocks with a single-bar drop $> 3.5\times \text{ATR}(14)$ or $> 10\%$ within the last `10` bars unless specifically evaluating post-earnings overreaction.
- **Trend Exhaustion Guard:** Note if `ADX(14) > 40` with `DI- > DI+` and full bearish EMA stack (`close < EMA20 < EMA50 < EMA200`) across all 3 timeframes.
- **Higher-Timeframe Anchor:** Check `Daily` `EMA200` / `SMA200` distance and check whether earnings/major news fell within **$\pm 3$ days**.
- **Candle Structure:** Prefer closing bars with a green body or lower-wick rejection closing in the **upper 50%** of the bar's range.

---

## Stage 4: Smart Money Concepts (`LuxAlgo` SMC) Confirmation

The `trading-view-scraper` Actor computes LuxAlgo-style Smart Money Concepts natively (`indicators: ["SMC"]`) on **`1h`**, **`2h`**, and **`4h`** using two lookbacks:
- **Internal Structure (`smcInternalLength = 5`)**: Fast tactical shifts and entry timing (`latestBar.indicators.smc.internal`).
- **Swing Structure (`smcSwingLength = 20` on `barsCount: 200` + Actor warmup)**: Primary structural trend and liquidity boundaries (`latestBar.indicators.smc.swing`).

### Algorithm Summary (`Smart Money Concepts [LuxAlgo]`)
1. **Pivot Leg Detection (`leg(size)`):** At bar `i`, compare bar `i - size`:
   - If `high[i - size] > max(high[i - size + 1 ... i])` $\rightarrow$ bearish leg (`0`), confirms a **Pivot High** at `i - size`.
   - Else if `low[i - size] < min(low[i - size + 1 ... i])` $\rightarrow$ bullish leg (`1`), confirms a **Pivot Low** at `i - size`.
2. **BOS & CHoCH (Close Breaks):**
   - `close` crosses above last uncrossed Pivot High:
     - If prior `trend === -1` (Bearish) $\rightarrow$ **Bullish `CHoCH`** (Change of Character, potential reversal).
     - If prior `trend === +1` (Bullish) $\rightarrow$ **Bullish `BOS`** (Break of Structure, trend continuation).
   - `close` crosses below last uncrossed Pivot Low:
     - If prior `trend === +1` (Bullish) $\rightarrow$ **Bearish `CHoCH`**.
     - If prior `trend === -1` (Bearish) $\rightarrow$ **Bearish `BOS`**.
3. **Strong / Weak High & Low (Trailing Extremes):**
   - **Bullish Trend (`trend = +1`):** Trailing Low = **Strong Low** (defended structural floor); Trailing High = **Weak High** (upside liquidity target).
   - **Bearish Trend (`trend = -1`):** Trailing High = **Strong High** (defended ceiling); Trailing Low = **Weak Low** (vulnerable liquidity floor likely to be swept/broken).
4. **Premium / Discount Zones:**
   - Compute swing range position `(close - trailingLow) / (trailingHigh - trailingLow)`. Oversold long setups should sit in **Discount (`< 47.5%`)**.

### How SMC Gives Proof of Rise vs Fall
- **High-Conviction Rise Proof (Long):**
  - Higher TF (`4h`/`2h`) trend is **`BULL`** pulling back into **Discount** near its **`Strong Low`** (`<= 1.5 ATR`), **OR** `4h`/`2h` swept a `Weak Low` and **`1h` Internal/Swing printed a fresh Bullish `CHoCH`** reclaiming structure with rising volume.
- **High-Risk Fall / Liquidity Sweep Warning (Avoid or Wait):**
  - All timeframes (`1h/2h/4h`) remain **`BEAR`** after a recent `Bearish BOS`/`CHoCH`, price sits right above an un-swept **`Weak Low`** (`< 1.5 ATR`) with **no bullish `CHoCH`** yet, or bounces directly into a nearby **`Strong High`** (`<= 1.0 ATR`).

---

## Stage 5: Output Brief Format

For every scan request, present:
1. **Market Funnel Summary:** Pre-screen count $\rightarrow$ strict qualifiers count (explicitly `0` if none pass).
2. **Recommended Picks** *(only strict qualifiers)*, or **Explicit Zero-Match Notice** + optional **Near-Miss Watchlist** (clearly marked **NOT RECOMMENDED — Trigger Conditions Not Met**).
3. **Per-Ticker Proof Card:**
   - Price, Market Cap, Dollar Volume, Earnings/News risk.
   - `1h / 2h / 4h` table: `RSI (prev -> curr)`, `MACD & Signal & Hist trend`, `Same-Hour Volume Ratio`, `EMA20/50/200` + `ATR` shock check.
   - **LuxAlgo SMC Readout (`1h / 2h / 4h`):** Swing & Internal trend, latest **`BOS` / `CHoCH`** level & timestamp, **`Strong/Weak Low`** distance (% & ATR), **`Strong/Weak High`** distance (% & ATR), Premium/Discount zone.
   - **Verdict:** Clear bullish proof vs bearish invalidation trigger (exact price level where a Weak Low breaks or a Bullish `CHoCH` confirms).
