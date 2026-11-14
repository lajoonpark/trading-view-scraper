import { Actor, log } from 'apify';
import { parseActorInput } from './input-schema.js';
import { scrapeTradingView } from './scraper.js';

await Actor.init();

try {
    const rawInput = await Actor.getInput();
    if (!rawInput) {
        throw new Error(
            'Actor input is empty. Please provide at least { "symbols": ["NASDAQ:AAPL"] }.',
        );
    }

    const input = parseActorInput(rawInput);

    log.info('Starting TradingView Scraper Actor', {
        symbolsCount: input.symbols.length,
        interval: input.interval,
        barsCount: input.barsCount,
        indicators: input.indicators,
        includeHistoricalBars: input.includeHistoricalBars,
        includeScannerSnapshot: input.includeScannerSnapshot,
    });

    const shouldUseProxy = Boolean(
        input.proxyConfiguration?.useApifyProxy ||
            (input.proxyConfiguration?.proxyUrls && input.proxyConfiguration.proxyUrls.length > 0),
    );
    const proxyConfiguration = shouldUseProxy
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    const results = await scrapeTradingView(input, {
        proxyUrlProvider: proxyConfiguration ? () => proxyConfiguration.newUrl() : undefined,
        logger: {
            info: (msg, data) => log.info(msg, data),
            warning: (msg, data) => log.warning(msg, data),
            error: (msg, data) => log.error(msg, data),
        },
    });

    await Actor.pushData(results);

    const succeeded = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => Boolean(r.error)).length;
    const totalBars = results.reduce((sum, r) => sum + r.barsCount, 0);

    const summary = {
        scrapedAt: new Date().toISOString(),
        interval: input.interval,
        totalSymbolsRequested: input.symbols.length,
        totalRecordsOutput: results.length,
        succeeded,
        failed,
        totalHistoricalBars: totalBars,
        tickers: results.map((r) => ({
            ticker: r.ticker,
            barsCount: r.barsCount,
            close: r.latestBar?.close ?? r.scannerSnapshot?.price.close ?? null,
            rsi: r.latestBar?.indicators?.rsi ?? r.scannerSnapshot?.indicators.rsi14 ?? null,
            recommendation: r.scannerSnapshot?.recommendations.overallSignal ?? null,
            error: r.error,
        })),
    };

    await Actor.setValue('OUTPUT', summary);
    log.info('TradingView scrape completed', { succeeded, failed, totalBars });

    if (succeeded === 0 && failed > 0) {
        throw new Error(`All ${failed} symbol(s) failed to scrape. Check dataset items for details.`);
    }

    await Actor.exit({ statusMessage: `Scraped ${succeeded} symbol(s), ${totalBars} bars.` });
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('TradingView Scraper Actor failed', { error: message });
    await Actor.fail(message);
}
