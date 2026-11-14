import https from 'node:https';
import http from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function resolveProxyUrl(explicitProxyUrl?: string): string | undefined {
    if (explicitProxyUrl && explicitProxyUrl.trim().length > 0) {
        return explicitProxyUrl.trim();
    }
    const envProxy =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy;
    return envProxy && envProxy.trim().length > 0 ? envProxy.trim() : undefined;
}

export function createWsProxyAgent(proxyUrl?: string): HttpsProxyAgent<string> | undefined {
    const resolved = resolveProxyUrl(proxyUrl);
    if (!resolved) return undefined;
    return new HttpsProxyAgent(resolved);
}

export interface HttpJsonOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    proxyUrl?: string;
}

export async function httpJsonRequest<T>(urlStr: string, options: HttpJsonOptions = {}): Promise<T> {
    const url = new URL(urlStr);
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? 20_000;
    const proxyUrl = resolveProxyUrl(options.proxyUrl);
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    const headers: Record<string, string> = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json',
        ...options.headers,
    };
    if (payload !== undefined) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    return new Promise<T>((resolve, reject) => {
        const transport = url.protocol === 'http:' ? http : https;
        const req = transport.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'http:' ? 80 : 443),
                path: `${url.pathname}${url.search}`,
                method,
                headers,
                agent,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const statusCode = res.statusCode ?? 0;
                    if (statusCode < 200 || statusCode >= 300) {
                        reject(
                            new Error(
                                `HTTP ${statusCode} from ${url.hostname}${url.pathname}: ${text.slice(0, 300)}`,
                            ),
                        );
                        return;
                    }
                    try {
                        resolve(JSON.parse(text) as T);
                    } catch (err) {
                        reject(
                            new Error(
                                `Failed to parse JSON from ${url.hostname}${url.pathname}: ${(err as Error).message}`,
                            ),
                        );
                    }
                });
            },
        );

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms for ${urlStr}`));
        });
        req.on('error', reject);
        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
}
