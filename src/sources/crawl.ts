import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchRaw } from '../util/http.js';
import { extractorResult, type ExtractorResult } from '../content/extraction.js';
import { cardServices, spacedText, type CardService } from './page-structure.js';
import { registrableHost } from './site-content.js';

/**
 * A small, polite crawl of the pages a business's own site links to from its menu and its service cards: what each
 * page is for, its headline and description, the services it lists (cards), and its pictures with their captions.
 * It stays on the site's own origin, honours robots.txt, and has a page budget. It is run once per build, never per visit.
 */
export type PageType = 'services' | 'about' | 'projects' | 'contact' | 'reviews' | 'faq' | 'other';
export interface CrawledPage {
  url: string;
  type: PageType;
  ok: boolean;
  status: number;
  error?: string;
  title?: string;
  h1?: string;
  description?: string;
  headings: string[];
  /** services this page lists as cards (name, description, link, picture) */
  cards: CardService[];
  /** pictures in the page's content (not icons or decoration) with what the page says about each */
  images: { url: string; alt?: string; caption?: string }[];
  /** the buttons and calls to action the page itself shows (label and where each goes) */
  ctas?: { label: string; href: string }[];
  /** the page's own words (main content, trimmed), to see what it actually offers or only mentions */
  text?: string;
}

const SKIP = /\/(wp-admin|wp-json|feed|cart|checkout|my-account|login|privacy|terms|sitemap|tag|category|author|page\/\d+)(\/|$)|\.(pdf|jpe?g|png|webp|zip|xml)$/i;
const TYPE_RULES: [PageType, RegExp][] = [
  ['projects', /see-our-work|our-work|projects?|gallery|portfolio|recent-work|case-stud/i],
  ['about', /about|our-story|who-we-are|team/i],
  ['contact', /contact|get-in-touch|location/i],
  ['reviews', /reviews?|testimonials?/i],
  ['faq', /faq|questions/i],
  ['services', /service|roof|repair|replace|install|restor|mitigat|damage|inspect|treatment|therapy|plumb|electric|hvac|clean|remodel|paint|landscap|solutions/i],
];
export const pageTypeOf = (url: string, h1?: string): PageType => {
  let path = '';
  try { path = new URL(url).pathname; } catch { /* none */ }
  for (const [t, re] of TYPE_RULES) if (re.test(path)) return t;
  for (const [t, re] of TYPE_RULES) if (h1 && re.test(h1)) return t;
  return 'other';
};

/** Disallowed paths for every crawler from robots.txt (a simple reading: the wildcard group's Disallow lines). */
async function disallowed(origin: string): Promise<string[]> {
  const r = await fetchRaw(`${origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 60_000 }).catch(() => null);
  if (!r?.ok) return [];
  const out: string[] = [];
  let star = false;
  for (const line of r.body.toString('utf8').split(/\r?\n/)) {
    const [k, ...v] = line.split(':');
    const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') star = val === '*';
    else if (star && key === 'disallow' && val) out.push(val);
  }
  return out;
}

function summarise(html: string, url: string): Omit<CrawledPage, 'ok' | 'status' | 'error'> {
  const $ = cheerio.load(html);
  const h1 = spacedText($, $('h1').first()).replace(/(\w)&/g, '$1 &');
  const headings = $('h2, h3').filter((_, e) => !$(e).closest('nav, footer, header, form').length).map((_, e) => spacedText($, $(e))).get().filter((t) => t.length >= 3 && t.length <= 80).slice(0, 24);
  const images: CrawledPage['images'] = [];
  $('main img, article img, .entry-content img, section img, figure img').each((_, im) => {
    const src = $(im).attr('data-src') || $(im).attr('data-lazy-src') || $(im).attr('src') || '';
    if (!src || /^data:|\.svg(\?|$)|icon|logo|sprite|shape|avatar|badge|counter/i.test(src)) return;
    try {
      const abs = new URL(src, url).toString();
      if (images.some((x) => x.url === abs)) return;
      const cap = $(im).closest('figure').find('figcaption').text().replace(/\s+/g, ' ').trim();
      images.push({ url: abs, alt: $(im).attr('alt')?.trim() || undefined, caption: cap || undefined });
    } catch { /* skip */ }
  });
  const ctas: { label: string; href: string }[] = [];
  $('main a[href], article a[href], section a[href], .entry-content a[href]').each((_, a) => {
    if ($(a).closest('nav, footer, header').length) return;
    const label = spacedText($, $(a)).replace(/\s+/g, ' ').trim();
    const cls = String($(a).attr('class') || '');
    if (!label || label.length > 56 || !(/btn|button|cta/i.test(cls) || /^(get|request|book|schedule|call|contact|learn|see|view)\b/i.test(label))) return;
    try { const href = new URL($(a).attr('href') || '', url).toString(); if (!ctas.some((c) => c.label === label && c.href === href)) ctas.push({ label, href }); } catch { /* skip */ }
  });
  // the page's own content: not the menu, header, footer or sidebar that every page repeats
  const body = cheerio.load($.html());
  body('header, nav, footer, aside, script, style, noscript, form').remove();
  const text = (body('main, article, .entry-content').first().text() || body('body').text()).replace(/\s+/g, ' ').trim().slice(0, 12000);
  return { url, type: pageTypeOf(url, h1), ctas: ctas.slice(0, 30), text, title: $('title').first().text().replace(/\s+/g, ' ').trim() || undefined, h1: h1 || undefined, description: $('meta[name="description"]').attr('content')?.trim() || undefined, headings, cards: cardServices($, url), images: images.slice(0, 40) };
}

export async function crawlSite(homeUrl: string, links: string[], opts: { pages?: number } = {}): Promise<{ pages: CrawledPage[]; report: ExtractorResult }> {
  const budget = opts.pages ?? Number(process.env.CRAWL_PAGES ?? 12);
  if (budget <= 0) return { pages: [], report: extractorResult('crawl', 'skipped', 'turned off', 0) };
  const home = new URL(homeUrl);
  const block = await disallowed(home.origin);
  const seen = new Set<string>([home.href.replace(/\/$/, '')]);
  const queue: { url: string; rank: number }[] = [];
  for (const l of links) {
    let u: URL;
    try { u = new URL(l, home); } catch { continue; }
    if (u.origin !== home.origin && registrableHost(u.href) !== registrableHost(home.href)) continue;
    u.hash = ''; u.search = '';
    const key = u.href.replace(/\/$/, '');
    if (seen.has(key) || SKIP.test(u.pathname) || block.some((d) => u.pathname.startsWith(d))) continue;
    seen.add(key);
    const t = pageTypeOf(u.href);
    queue.push({ url: u.href, rank: t === 'services' ? 0 : t === 'projects' ? 1 : t === 'about' ? 2 : t === 'contact' ? 3 : 4 });
  }
  queue.sort((a, b) => a.rank - b.rank);
  const todo = queue.slice(0, budget);
  const pages: CrawledPage[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, async () => {
    while (next < todo.length) {
      const t = todo[next++];
      const r = await fetchRaw(t.url, { timeoutMs: 9000, maxBytes: 3_000_000 });
      if (!r.ok) { pages.push({ url: t.url, type: pageTypeOf(t.url), ok: false, status: r.status, error: r.error || `HTTP ${r.status}`, headings: [], cards: [], images: [] }); continue; }
      try { pages.push({ ...summarise(r.body.toString('utf8'), r.url), ok: true, status: r.status }); }
      catch (e) { pages.push({ url: t.url, type: pageTypeOf(t.url), ok: false, status: r.status, error: (e as Error).message.slice(0, 80), headings: [], cards: [], images: [] }); }
      await new Promise((res) => setTimeout(res, 150));
    }
  }));
  pages.sort((a, b) => todo.findIndex((t) => t.url === a.url) - todo.findIndex((t) => t.url === b.url));
  const ok = pages.filter((p) => p.ok).length;
  const skipped = queue.length - todo.length;
  return { pages, report: pages.length ? extractorResult('crawl', ok === pages.length ? 'success' : ok ? 'partial' : 'failed', `${ok} of ${pages.length} linked pages read (${[...new Set(pages.filter((p) => p.ok).map((p) => p.type))].join(', ')})${skipped > 0 ? `; ${skipped} more links left unread (page budget ${budget})` : ''}${pages.some((p) => !p.ok) ? `; failed: ${pages.filter((p) => !p.ok).slice(0, 2).map((p) => `${new URL(p.url).pathname} ${p.error}`).join('; ')}` : ''}`, ok, pages.length) : extractorResult('crawl', 'skipped', 'no other pages of the site are linked from its menu or service cards', 0) };
}
void (null as unknown as AnyNode);
