import * as cheerio from 'cheerio';
import { fetchRaw, type FetchResult } from '../util/http.js';
import { registrableHost } from '../sources/site-content.js';

/**
 * Finding a website's pages: the home page's menu and links, the sitemap(s) robots.txt names (or /sitemap.xml), and
 * the links on the pages read after that. Bounded: a page budget and a link depth. Every address found is kept with
 * how it was found and what Roger decided (crawl, or skip and why), so the coverage report can say what was not read.
 */

/** a fetch that tries again when the host resets the connection, rate-limits or fails on its side; a 404 is final */
export async function fetchWithRetry(url: string, opts: { timeoutMs?: number; maxBytes?: number; attempts?: number; backoffMs?: number } = {}): Promise<{ res: FetchResult; attempts: number }> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs ?? Number(process.env.STUDIO_BACKOFF_MS ?? 700);
  let res = await fetchRaw(url, { timeoutMs: opts.timeoutMs ?? 12000, maxBytes: opts.maxBytes ?? 5_000_000 });
  let n = 1;
  while (n < attempts && !res.ok && (res.status === 0 || res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500)) {
    await new Promise((r) => setTimeout(r, backoff * n));
    res = await fetchRaw(url, { timeoutMs: opts.timeoutMs ?? 12000, maxBytes: opts.maxBytes ?? 5_000_000 });
    n++;
  }
  return { res, attempts: n };
}

// ───────────────────────── robots and sitemaps ─────────────────────────
export interface Robots { url: string; found: boolean; disallow: string[]; sitemaps: string[] }

/** The wildcard group's Disallow lines and every Sitemap line. */
export function parseRobots(text: string): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let star = false;
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).replace(/#.*$/, '').trim();
    if (key === 'user-agent') star = val === '*';
    else if (key === 'disallow' && star && val) disallow.push(val);
    else if (key === 'sitemap' && val) sitemaps.push(val);
  }
  return { disallow, sitemaps };
}
export async function readRobots(origin: string): Promise<Robots> {
  const url = `${origin}/robots.txt`;
  const { res } = await fetchWithRetry(url, { timeoutMs: 6000, maxBytes: 200_000, attempts: 2 });
  if (!res.ok || /<html/i.test(res.body.toString('utf8').slice(0, 300))) return { url, found: false, disallow: [], sitemaps: [] };
  return { url, found: true, ...parseRobots(res.body.toString('utf8')) };
}
export const isDisallowed = (pathname: string, disallow: string[]) => disallow.some((d) => {
  if (d.includes('*') || d.endsWith('$')) {
    const re = new RegExp(`^${d.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    return re.test(pathname);
  }
  return pathname.startsWith(d);
});

/** <loc> entries of a sitemap or sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls = $('urlset > url > loc').map((_, e) => $(e).text().trim()).get().filter(Boolean);
  const sitemaps = $('sitemapindex > sitemap > loc').map((_, e) => $(e).text().trim()).get().filter(Boolean);
  return { urls, sitemaps };
}
export async function readSitemaps(origin: string, named: string[], opts: { maxSitemaps?: number; maxUrls?: number } = {}): Promise<{ urls: string[]; read: { url: string; status: 'read' | 'failed'; urls: number; error?: string }[] }> {
  const queue = named.length ? [...named] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const tried = new Set<string>();
  const urls: string[] = [];
  const read: { url: string; status: 'read' | 'failed'; urls: number; error?: string }[] = [];
  const max = opts.maxSitemaps ?? 6;
  while (queue.length && tried.size < max && urls.length < (opts.maxUrls ?? 500)) {
    const u = queue.shift()!;
    if (tried.has(u)) continue;
    tried.add(u);
    const { res } = await fetchWithRetry(u, { timeoutMs: 8000, maxBytes: 3_000_000, attempts: 2 });
    const body = res.ok ? res.body.toString('utf8') : '';
    if (!res.ok || !/<(urlset|sitemapindex)\b/i.test(body)) {
      // the guessed addresses are only guesses: a missing one is not a failure worth reporting
      if (named.includes(u) || res.ok) read.push({ url: u, status: 'failed', urls: 0, error: res.ok ? 'not a sitemap' : res.error || `HTTP ${res.status}` });
      continue;
    }
    const p = parseSitemap(body);
    read.push({ url: u, status: 'read', urls: p.urls.length });
    urls.push(...p.urls);
    // a sitemap index: the page sitemaps first (posts, tags and authors last)
    queue.push(...p.sitemaps.sort((a, b) => sitemapRank(a) - sitemapRank(b)));
    if (!named.length && p.urls.length) break; // one guessed sitemap that works is enough
  }
  return { urls: [...new Set(urls)].slice(0, opts.maxUrls ?? 500), read };
}
const sitemapRank = (u: string) => (/page|service|location|product/i.test(u) ? 0 : /post|blog|news|tag|categor|author|attachment/i.test(u) ? 2 : 1);

// ───────────────────────── which pages ─────────────────────────
const SKIP: [RegExp, string][] = [
  [/\.(pdf|jpe?g|png|gif|webp|svg|zip|xml|mp4|mov|mp3|docx?|xlsx?|css|js|ico)(\?|$)/i, 'not a web page (a file)'],
  [/\/(wp-admin|wp-json|wp-login|xmlrpc|cgi-bin|feed|rss|cart|checkout|my-account|account|login|signin|sign-in|register|search)(\/|$|\?)/i, 'not content (admin, account, cart or search)'],
  [/\/(tag|category|author|page\/\d+|attachment)(\/|$)/i, 'an archive listing, not a page'],
  [/[?&](replytocom|share|utm_|fbclid|s=)/i, 'a tracking or sharing variant of a page'],
];
export function skipReason(u: URL): string | undefined {
  for (const [re, why] of SKIP) if (re.test(u.pathname + u.search)) return why;
  return undefined;
}
/** a blog post: dated paths and /blog/<slug> */
export const isPost = (path: string) => /\/(20\d\d)\/(\d\d)\//.test(path) || /\/(blog|news|posts?|articles?)\/[^/]+\/?$/i.test(path);
export const isLegal = (path: string) => /(privacy|terms|cookie|accessibility|disclaimer|legal)/i.test(path);

/** the order pages are read in: services and locations before blog posts */
export function priorityOf(u: URL, via: string[]): number {
  const p = u.pathname.toLowerCase();
  if (p === '/' || p === '') return 0;
  let s = via.includes('nav') ? 10 : via.includes('link') ? 30 : 40;
  if (/service|treatment|menu|product|what-we-do|roof|repair|install|clean|therap|care/.test(p)) s -= 6;
  if (/location|area|visit|contact|about|our-story|team|gallery|project|work|portfolio|review|testimonial|book|schedule|faq|pricing/.test(p)) s -= 4;
  if (isPost(p)) s += 30;
  if (isLegal(p)) s += 40;
  s += Math.min(10, p.split('/').filter(Boolean).length * 2);
  return s;
}

/** An address on the same site, without its fragment, query noise or trailing slash differences. */
export function canonicalUrl(href: string, base: string, origin: string): URL | undefined {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    if (u.origin !== origin && registrableHost(u.href) !== registrableHost(origin)) return undefined;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    return u;
  } catch { return undefined; }
}
export const urlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase();
