import { config } from '../config.js';

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string; // final URL
  redirects: string[];
  headers: Record<string, string>;
  body: Buffer;
  ttfbMs: number;
  totalMs: number;
  error?: string;
  /** the body was cut off at maxBytes */
  truncated?: boolean;
}

/** Some CDNs (Wix, Squarespace) reset connections from unknown clients; a browser's identity is what a visitor's request looks like. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** fetch with timeout, size cap, and a recorded redirect chain. A connection that is reset is retried once as a browser. */
export async function fetchRaw(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; method?: string; headers?: Record<string, string>; body?: string; asBrowser?: boolean } = {},
): Promise<FetchResult> {
  const first = await fetchOnce(url, opts);
  if (first.status === 0 && !opts.asBrowser && !opts.headers?.['user-agent'] && /fetch failed|ECONNRESET|socket|terminated/i.test(first.error || '')) {
    const again = await fetchOnce(url, { ...opts, asBrowser: true });
    if (again.ok || again.status) return again;
  }
  return first;
}

async function fetchOnce(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; method?: string; headers?: Record<string, string>; body?: string; asBrowser?: boolean },
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxBytes = opts.maxBytes ?? 6_000_000;
  const started = Date.now();
  const redirects: string[] = [];
  let current = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 8; hop++) {
      const res = await fetch(current, {
        method: opts.method || 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': opts.asBrowser ? BROWSER_UA : config.userAgent, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', ...(opts.headers || {}) },
        body: opts.body,
      });
      const ttfbMs = Date.now() - started;
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        redirects.push(current);
        current = new URL(loc, current).toString();
        continue;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > maxBytes) { truncated = true; break; }
          chunks.push(Buffer.from(chunk));
        }
      }
      return { ok: res.ok, status: res.status, url: current, redirects, headers, body: Buffer.concat(chunks), ttfbMs, totalMs: Date.now() - started, ...(truncated ? { truncated } : {}) };
    }
    return { ok: false, status: 0, url: current, redirects, headers: {}, body: Buffer.alloc(0), ttfbMs: 0, totalMs: Date.now() - started, error: 'too many redirects' };
  } catch (e) {
    const err = e as Error;
    return { ok: false, status: 0, url: current, redirects, headers: {}, body: Buffer.alloc(0), ttfbMs: 0, totalMs: Date.now() - started, error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  u.hash = '';
  return u.toString();
}
