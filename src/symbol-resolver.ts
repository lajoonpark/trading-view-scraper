import { httpJsonRequest } from './proxy-utils.js';
import type { ResolvedSymbol, SearchAssetType } from './types.js';

interface TvSearchResultItem {
    symbol: string;
    description?: string;
    type?: string;
    exchange?: string;
    currency_code?: string;
    is_primary_listing?: boolean;
    typespecs?: string[];
}

interface TvSearchResponse {
    symbols?: TvSearchResultItem[];
}

const SEARCH_TYPE_PARAM: Record<SearchAssetType, string> = {
    stock: 'stocks',
    etf: 'funds',
    crypto: 'crypto',
    forex: 'forex',
    index: 'index',
    futures: 'futures',
    all: '',
};

function stripHtmlTags(raw: string): string {
    return raw.replace(/<[^>]+>/g, '').trim();
}

export async function resolveSymbol(
    rawInput: string,
    options: {
        searchType: SearchAssetType;
        preferredExchanges: string[];
        timeoutMs?: number;
        proxyUrl?: string;
    },
): Promise<ResolvedSymbol> {
    const cleaned = rawInput.trim().toUpperCase();
    if (!cleaned) {
        throw new Error('Symbol cannot be empty');
    }

    // Explicit EXCHANGE:SYMBOL provided by user
    if (cleaned.includes(':')) {
        const [exchange, ...rest] = cleaned.split(':');
        const symbol = rest.join(':').trim();
        if (!exchange || !symbol) {
            throw new Error(`Invalid EXCHANGE:SYMBOL format: "${rawInput}"`);
        }
        return {
            requestedSymbol: rawInput,
            ticker: `${exchange}:${symbol}`,
            exchange,
            symbol,
        };
    }

    const searchTypeParam = SEARCH_TYPE_PARAM[options.searchType] ?? '';
    const params = new URLSearchParams({
        text: cleaned,
        hl: '0',
        exchange: '',
        lang: 'en',
        search_type: searchTypeParam,
        domain: 'production',
    });

    const url = `https://symbol-search.tradingview.com/symbol_search/v3/?${params.toString()}`;
    const data = await httpJsonRequest<TvSearchResponse>(url, {
        headers: {
            Origin: 'https://www.tradingview.com',
            Referer: 'https://www.tradingview.com/',
        },
        timeoutMs: options.timeoutMs ?? 15_000,
        proxyUrl: options.proxyUrl,
    });

    const candidates = (data.symbols ?? []).map((item) => ({
        ...item,
        cleanSymbol: stripHtmlTags(item.symbol).toUpperCase(),
        cleanExchange: (item.exchange ?? '').toUpperCase(),
    }));

    if (candidates.length === 0) {
        throw new Error(`Symbol "${rawInput}" was not found on TradingView.`);
    }

    const preferredOrder = options.preferredExchanges.map((e) => e.toUpperCase());

    const scoreCandidate = (item: (typeof candidates)[number]): number => {
        let score = 0;
        if (item.cleanSymbol === cleaned) score += 1000;
        if (item.is_primary_listing) score += 250;

        const prefIdx = preferredOrder.indexOf(item.cleanExchange);
        if (prefIdx !== -1) {
            score += 500 - prefIdx * 20;
        }

        if (item.type === 'stock' && (options.searchType === 'stock' || options.searchType === 'all')) {
            score += 100;
        }
        if (item.typespecs?.includes('common')) {
            score += 50;
        }
        // Deprioritize depositary receipts / structured products when common stock exists
        if (item.type === 'dr') {
            score -= 150;
        }
        return score;
    };

    candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    const best = candidates[0];

    if (!best.cleanExchange || !best.cleanSymbol) {
        throw new Error(`Resolved candidate for "${rawInput}" is missing exchange or symbol.`);
    }

    return {
        requestedSymbol: rawInput,
        ticker: `${best.cleanExchange}:${best.cleanSymbol}`,
        exchange: best.cleanExchange,
        symbol: best.cleanSymbol,
        description: best.description,
        type: best.type,
        currency: best.currency_code,
    };
}
