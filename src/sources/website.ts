import * as cheerio from 'cheerio';
import type { WebsiteScan } from '../types.js';
import { fetchRaw, normalizeUrl } from '../util/http.js';
import { parseColor, toHex } from '../color/oklch.js';
import { extractSiteContent, restoreName, type SiteContent } from './site-content.js';
import { extractorResult } from '../content/extraction.js';
import { measureBrand, renderPage } from './render-page.js';
import { crawlSite } from './crawl.js';

const SOCIAL: [string, RegExp][] = [
  ['facebook', /facebook\.com\//i], ['instagram', /instagram\.com\//i], ['x', /(twitter|x)\.com\//i],
  ['linkedin', /linkedin\.com\//i], ['youtube', /youtube\.com\//i], ['tiktok', /tiktok\.com\//i],
  ['yelp', /yelp\.com\/biz/i], ['nextdoor', /nextdoor\.com\//i], ['bbb', /bbb\.org\//i],
];

const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-rounded', 'inherit', 'initial',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'arial', 'helvetica', 'helvetica neue', 'times new roman', 'times', 'georgia',
  'verdana', 'tahoma', 'trebuchet ms', 'courier new', 'roboto', 'apple color emoji', 'segoe ui emoji', 'fontawesome', 'font awesome 5 free',
  'font awesome 6 free', 'dashicons', 'icomoon', 'eicons', 'var(--font)', 'unset',
]);

function colorsFromCss(css: string, into: Map<string, number>, weight = 1) {
  const re = /(--[\w-]*(?:primary|brand|main|accent|theme)[\w-]*\s*:\s*)?(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const rgb = parseColor(m[2]);
    if (!rgb) continue;
    const hex = toHex(rgb);
    // Brand-named custom properties count much more than incidental colors.
    into.set(hex, (into.get(hex) || 0) + (m[1] ? 25 : weight));
  }
}

function fontsFromCss(css: string, into: Map<string, number>) {
  const re = /font-family\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const first = m[1].split(',')[0].trim().replace(/["']/g, '').replace(/\s*!important/, '');
    if (first && !GENERIC_FONTS.has(first.toLowerCase()) && !first.startsWith('var(')) into.set(first, (into.get(first) || 0) + 1);
  }
}

export function googleFontFamilies(href: string): string[] {
  try {
    const u = new URL(href, 'https://x');
    if (!/fonts\.googleapis\.com/.test(u.hostname)) return [];
    const fams = u.searchParams.getAll('family').flatMap((f) => f.split('|'));
    return fams.map((f) => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function scanWebsite(input: string, opts: { extraPages?: number; render?: 'auto' | 'never' | 'always'; brand?: boolean; crawl?: boolean } = {}): Promise<WebsiteScan> {
  const url = normalizeUrl(input);
  const res = await fetchRaw(url, { timeoutMs: 15000, maxBytes: 5_000_000 });
  const html = res.body.toString('utf8');
  const scan: WebsiteScan = {
    url, finalUrl: res.url, ok: res.ok && html.length > 0, status: res.status, error: res.error,
    timing: { ttfbMs: res.ttfbMs, totalMs: res.totalMs }, bytes: res.body.length, html, headers: res.headers, redirects: res.redirects,
    text: '', logoCandidates: [], cssColors: [], fonts: [], phones: [], emails: [], socials: [], images: [],
  };
  if (!scan.ok) return scan;

  const $ = cheerio.load(html);
  const abs = (h?: string) => {
    if (!h) return undefined;
    try { return new URL(h, res.url).toString(); } catch { return undefined; }
  };

  scan.title = $('title').first().text().trim() || undefined;
  scan.description = $('meta[name="description"]').attr('content')?.trim() || undefined;
  const tc = $('meta[name="theme-color"]').attr('content');
  if (tc) { const rgb = parseColor(tc); if (rgb) scan.themeColor = toHex(rgb); }

  // ── logo candidates ──
  const cands: WebsiteScan['logoCandidates'] = [];
  const isLogo = (el: any) => /logo|brand/i.test([$(el).attr('src'), $(el).attr('alt'), $(el).attr('class'), $(el).attr('id'), $(el).parent().attr('class'), $(el).parent().attr('id')].join(' '));
  $('img').each((i, el) => {
    const src = abs($(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src'));
    if (!src || src.startsWith('data:image/gif')) return;
    const inHeader = $(el).closest('header, nav, .header, #header, .navbar, .site-header').length > 0;
    if (isLogo(el)) cands.push({ url: src, score: inHeader ? 10 : 7, reason: inHeader ? 'logo <img> in header' : 'logo <img>' });
    else if (inHeader && i < 5) cands.push({ url: src, score: 4, reason: 'first image in header' });
  });
  $('script[type="application/ld+json"]').each((_, el) => {
    const m = $(el).text().match(/"logo"\s*:\s*(?:\{[^}]*"url"\s*:\s*)?"([^"]+)"/);
    if (m) { const u = abs(m[1]); if (u) cands.push({ url: u, score: 8, reason: 'JSON-LD logo' }); }
  });
  $('link[rel~="apple-touch-icon"]').each((_, el) => { const u = abs($(el).attr('href')); if (u) cands.push({ url: u, score: 4, reason: 'apple-touch-icon' }); });
  $('link[rel~="icon"]').each((_, el) => {
    const u = abs($(el).attr('href'));
    if (!u) return;
    const size = Number(($(el).attr('sizes') || '').split('x')[0]) || 0;
    cands.push({ url: u, score: u.endsWith('.svg') ? 3.5 : size >= 96 ? 3 : 1.5, reason: `favicon${size ? ` ${size}px` : ''}` });
  });
  const og = abs($('meta[property="og:image"]').attr('content'));
  if (og) cands.push({ url: og, score: 1, reason: 'og:image' });
  cands.push({ url: new URL('/favicon.ico', res.url).toString(), score: 0.5, reason: '/favicon.ico' });
  const seen = new Set<string>();
  scan.logoCandidates = cands.sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  // ── images (for audit) ──
  $('img').each((_, el) => {
    scan.images.push({ src: abs($(el).attr('src') || $(el).attr('data-src')) || '', alt: $(el).attr('alt'), width: $(el).attr('width'), height: $(el).attr('height') });
  });

  // ── contact + socials ──
  $('a[href^="tel:"]').each((_, el) => { scan.phones.push(decodeURIComponent($(el).attr('href')!.slice(4)).trim()); });
  $('a[href^="mailto:"]').each((_, el) => { scan.emails.push($(el).attr('href')!.slice(7).split('?')[0].trim()); });
  $('a[href]').each((_, el) => {
    const h = $(el).attr('href')!;
    for (const [net, re] of SOCIAL) if (re.test(h) && !scan.socials.find((s) => s.network === net)) scan.socials.push({ network: net, url: h });
  });

  // ── colors + fonts ──
  const colors = new Map<string, number>();
  const fontCount = new Map<string, number>();
  const gFonts: string[] = [];
  $('style').each((_, el) => { const css = $(el).text(); colorsFromCss(css, colors); fontsFromCss(css, fontCount); });
  $('[style]').each((_, el) => { const css = $(el).attr('style') || ''; colorsFromCss(css, colors, 2); fontsFromCss(css, fontCount); });
  $('link[href*="fonts.googleapis.com"]').each((_, el) => { gFonts.push(...googleFontFamilies($(el).attr('href') || '')); });
  const sheets = $('link[rel="stylesheet"]').map((_, el) => abs($(el).attr('href'))).get().filter((h: string) => h && !/fonts\.googleapis|font-awesome|fontawesome|bootstrap(\.min)?\.css|jquery/i.test(h)).slice(0, 3);
  const sheetRes = await Promise.all(sheets.map((h: string) => fetchRaw(h, { timeoutMs: 6000, maxBytes: 800_000 }).catch(() => null)));
  for (const s of sheetRes) {
    if (!s?.ok) continue;
    const css = s.body.toString('utf8');
    colorsFromCss(css, colors);
    fontsFromCss(css, fontCount);
    for (const m of css.matchAll(/@import\s+url\(["']?([^"')]+fonts\.googleapis[^"')]+)/g)) gFonts.push(...googleFontFamilies(m[1]));
  }
  scan.cssColors = [...colors.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count).slice(0, 24);
  const gSet = [...new Set(gFonts)];
  scan.fonts = [
    ...gSet.map((family) => ({ family, source: 'google' as const })),
    ...[...fontCount.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family).filter((f) => !gSet.includes(f)).slice(0, 4).map((family) => ({ family, source: 'css' as const })),
  ];

  // ── visible text (+ a couple of internal pages for better service matching) ──
  const textOf = (doc: cheerio.CheerioAPI) => {
    doc('script, style, noscript, svg, iframe').remove();
    return doc('body').text().replace(/\s+/g, ' ').trim();
  };
  const internal = $('a[href]')
    .map((_, el) => abs($(el).attr('href')))
    .get()
    .filter((h: string) => {
      try { const u = new URL(h); return u.host === new URL(res.url).host && /service|about|what-we-do|areas?|roof|plumb|hvac|electric|landscap/i.test(u.pathname); } catch { return false; }
    });
  const pages = [...new Set(internal)].slice(0, opts.extraPages ?? 2) as string[];
  const spaced = (h: string) => h.replace(/<(br|\/p|\/div|\/li|\/td|\/th|\/h[1-6]|\/tr|\/section|\/header|\/footer|\/a|\/span|\/strong|\/b)\b[^>]*>/gi, ' $&');
  const mainText = textOf(cheerio.load(spaced(html)));
  const extra = await Promise.all(pages.map((p) => fetchRaw(p, { timeoutMs: 6000, maxBytes: 1_500_000 }).then((r) => (r.ok ? textOf(cheerio.load(spaced(r.body.toString('utf8')))) : '')).catch(() => '')));
  scan.text = [mainText, ...extra].join('\n').slice(0, 30000);

  const phoneRe = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
  for (const m of mainText.matchAll(phoneRe)) scan.phones.push(`(${m[1]}) ${m[2]}-${m[3]}`);
  for (const m of mainText.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) scan.emails.push(m[0]);
  scan.phones = [...new Set(scan.phones)].slice(0, 6);
  scan.emails = [...new Set(scan.emails)].slice(0, 4);

  // what the page says about the business (identity, services, booking, story, media), read from the HTML as delivered
  scan.content = extractSiteContent(html, res.url, { socials: scan.socials });
  await recoverContent(scan, opts.render ?? 'auto');
  await enrichServicePages(scan);
  // the pages the menu and the service cards link to (budgeted, same site, robots honoured)
  if (opts.crawl ?? process.env.CRAWL_PAGES !== '0') {
    const links = [...scan.content!.nav.map((n) => n.href), ...scan.content!.services.map((s) => s.href || s.pageUrl || ''), ...(scan.content!.hero ? [scan.content!.hero.secondary?.href || ''] : [])].filter(Boolean);
    const crawl = await crawlSite(scan.finalUrl, links);
    scan.crawl = { pages: crawl.pages };
    scan.content!.report.push(crawl.report);
  }
  // how the page is styled, measured in a browser (colours by use, buttons, typefaces)
  if (opts.brand ?? process.env.BRAND_MEASURE !== '0') scan.brandRaw = await measureBrand(scan.finalUrl);
  return scan;
}

/** Few things found, or a page that is mostly script: read it again after its scripts have run, and keep the fuller result. */
function thin(c: SiteContent, scan: WebsiteScan) {
  const photos = c.images.filter((i) => i.role === 'content' || i.role === 'team').length;
  const scripts = (scan.html.match(/<script\b/gi) || []).length;
  return (!c.services.length && scan.text.length < 1500) || (photos === 0 && scripts > 6) || scan.text.length < 250;
}
async function recoverContent(scan: WebsiteScan, mode: 'auto' | 'never' | 'always') {
  const c = scan.content!;
  if (mode === 'never' || (mode === 'auto' && !thin(c, scan))) {
    c.report.push(extractorResult('rendered page', 'skipped', mode === 'never' ? 'turned off' : 'the page HTML already held the content, so no browser was needed'));
    return;
  }
  const r = await renderPage(scan.finalUrl);
  if (!r.ok || !r.html) { c.report.push(extractorResult('rendered page', 'failed', `could not run the page's scripts: ${r.error}`)); return; }
  const rendered = extractSiteContent(r.html, scan.finalUrl, { socials: scan.socials, rendered: true });
  const score = (x: SiteContent) => x.services.length * 3 + x.images.length + x.videos.length * 2 + (x.story ? 2 : 0) + (x.phones.primary ? 1 : 0) + (x.address ? 1 : 0);
  if (score(rendered) > score(c)) {
    rendered.report.push(extractorResult('rendered page', 'success', `read after running the page's scripts (${r.ms} ms): found more than the HTML alone`));
    scan.content = rendered;
    scan.rendered = true;
    scan.text = cheerio.load(r.html)('body').text().replace(/\s+/g, ' ').trim().slice(0, 30000) || scan.text;
  } else c.report.push(extractorResult('rendered page', 'success', `read after running the page's scripts (${r.ms} ms): nothing more than the HTML held`));
}

/** A service with its own page on the site: take that page's description when the home page gave none. */
async function enrichServicePages(scan: WebsiteScan) {
  const c = scan.content!;
  const targets = c.services.filter((s) => s.pageUrl && !s.description).slice(0, 5);
  if (!targets.length) return;
  let filled = 0;
  await Promise.all(targets.map(async (s) => {
    const r = await fetchRaw(s.pageUrl!, { timeoutMs: 7000, maxBytes: 2_000_000 }).catch(() => null);
    if (!r?.ok) return;
    const d = cheerio.load(r.body.toString('utf8'));
    const meta = (d('meta[name="description"]').attr('content') || d('meta[property="og:description"]').attr('content') || '').replace(/\s+/g, ' ').trim();
    if (meta.length >= 30 && meta !== c.identity.description) { s.description = restoreName(meta, c.identity.name).slice(0, 240); filled++; }
  }));
  c.report.push(extractorResult('service pages', filled === targets.length ? 'success' : filled ? 'partial' : 'failed', `${filled} of ${targets.length} service page${targets.length > 1 ? 's' : ''} gave a description`, filled, targets.length));
}
