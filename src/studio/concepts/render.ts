import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config.js';
import { fetchWithRetry } from '../discover.js';
import { sha256 } from '../snapshot.js';
import { launchBrowser } from '../../render/og.js';
import type { Catalog } from './review.js';
import { RENDERERS, VARIANT_CSS, baseCss, esc, siteFooter, siteHeader, type RenderCtx } from './library.js';
import type { Concept } from './types.js';
import { LISTING_CSS, isListing, placeholderSrc } from './listing-photos.js';

/**
 * Rendering a concept set: the photos copied once into the set's folder (so a preview is local and does not hotlink
 * the business's site), each concept written as one HTML file from the shared library, then opened in Chrome at
 * desktop (1440×900) and mobile (390×844) size for full-page screenshots, a first-screen screenshot, and the
 * measurements the validators need (text and its contrast, links, tap targets, pictures, headings, overflow).
 */

export const setDir = (setId: string) => path.join(config.dirs.out, 'studio-concepts', setId);
const MAX_PHOTOS = () => Number(process.env.STUDIO_CONCEPT_MAX_PHOTOS ?? 24);

/** Copy the catalog's photos (and logo) into the set folder; returns the ids that could be copied. */
export async function preparePhotos(cat: Catalog, setId: string, fetchImage: (url: string) => Promise<Buffer | null> = defaultFetch): Promise<{ ok: string[]; failed: { id: string; reason: string }[] }> {
  const dir = path.join(setDir(setId), 'img');
  fs.mkdirSync(dir, { recursive: true });
  const ok: string[] = [], failed: { id: string; reason: string }[] = [];
  // Google listing photos are never copied (Maps Platform terms): they are shown live at serve time (listing-photos.ts)
  const photos = [...cat.photos].filter((p) => !isListing(p)).sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id)).slice(0, MAX_PHOTOS());
  const jobs: { id: string; url: string; max: number }[] = [...photos.map((p) => ({ id: p.id, url: p.url, max: p.uses.includes('hero') ? 2000 : 1400 })), ...(cat.logo ? [{ id: 'logo', url: cat.logo.url, max: 600 }] : [])];
  // one copy per picture and address across every set: a later set reuses it instead of downloading again
  const cache = path.join(config.dirs.out, 'studio-concepts', '_photos');
  fs.mkdirSync(cache, { recursive: true });
  for (const j of jobs) {
    const ext = j.id === 'logo' ? 'png' : 'jpg';
    const file = path.join(dir, `${j.id}.${ext}`);
    // logos are trimmed (v2): an untrimmed copy from before is not reused
    const cached = path.join(cache, `${j.id === 'logo' ? 'logo-v2' : j.id}-${sha256(j.url).slice(0, 10)}-${j.max}.${ext}`);
    if (fs.existsSync(file)) { ok.push(j.id); continue; }
    if (fs.existsSync(cached)) { fs.copyFileSync(cached, file); ok.push(j.id); continue; }
    let body: Buffer | null = null, why = 'download failed after 3 tries';
    try { body = await fetchImage(j.url); } catch (e) { why = (e as Error).message; }
    if (!body) { failed.push({ id: j.id, reason: why }); continue; }
    try {
      // a logo is often a square with the mark in the middle: trim the empty margin so it reads at header size
      const img = j.id === 'logo' ? sharp(await sharp(body, { failOn: 'none' }).trim({ threshold: 12 }).png().toBuffer()).resize({ width: j.max, withoutEnlargement: true }) : sharp(body, { failOn: 'none' }).rotate().resize({ width: j.max, withoutEnlargement: true });
      await (j.id === 'logo' ? img.png() : img.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true })).toFile(cached);
      fs.copyFileSync(cached, file);
      ok.push(j.id);
    } catch (e) { failed.push({ id: j.id, reason: `could not decode: ${(e as Error).message.slice(0, 60)}` }); }
  }
  return { ok, failed };
}
/** image hosts rate-limit bursts: up to three tries, backing off */
async function defaultFetch(url: string): Promise<Buffer | null> {
  const { res, attempts } = await fetchWithRetry(url, { timeoutMs: 25_000, maxBytes: 25_000_000, attempts: 3, backoffMs: 1500 });
  if (res.ok && res.body.length && !res.truncated) return res.body;
  throw new Error(`download failed after ${attempts} tries: ${res.error || `HTTP ${res.status}`}${res.truncated ? ' (too large)' : ''}`);
}

const NAV: Record<string, (cat: Catalog) => string> = { offer: (c) => (c.items.length ? 'Menu' : 'Services'), story: () => 'Story', gallery: () => 'Photos', proof: (c) => (c.rating ? 'Reviews' : 'Why us'), contact: (c) => (c.locations.length > 1 ? 'Locations' : 'Visit') };

/** The concept as one HTML document (relative image paths: img/<id>.jpg). */
export function conceptHtml(concept: Concept, cat: Catalog, setId: string, opts: { serviceLinks?: RenderCtx["serviceLinks"] } = {}): string {
  const dir = path.join(setDir(setId), 'img');
  const photo = new Map(cat.photos.map((p) => [p.id, p]));
  const ctx: RenderCtx = {
    cat, concept, used: new Set(), serviceLinks: opts.serviceLinks,
    img: (id) => {
      if (id === 'logo') { const f = path.join(dir, 'logo.png'); return cat.logo && fs.existsSync(f) ? { src: 'img/logo.png', width: 200, height: 44, alt: `${cat.business.name} logo`, photo: { id: 'logo', url: cat.logo.url, width: 200, height: 44, orientation: 'landscape', uses: [], alt: '', services: [] } } : undefined; }
      const p = photo.get(id);
      // a Google listing photo: a stand-in of its shape, filled with Google's image and its credit when served
      if (p && isListing(p)) return { src: placeholderSrc(p.width, p.height), width: p.width, height: p.height, alt: p.alt, photo: p };
      if (!p || !fs.existsSync(path.join(dir, `${id}.jpg`))) return undefined;
      return { src: `img/${id}.jpg`, width: p.width, height: p.height, alt: p.alt || `Photo from ${cat.business.name}`, photo: p };
    },
  };
  const hero = concept.sections[0]?.variant;
  const nav = concept.sections.filter((s) => s.kind !== 'hero').map((s) => ({ href: `#${s.id}`, label: NAV[s.kind](cat) }));
  const body = concept.sections.map((s) => RENDERERS[`${s.kind}:${s.variant}`](ctx, s)).join('\n');
  const css = baseCss(concept.tokens) + VARIANT_CSS['svc-go'] + concept.sections.map((s) => VARIANT_CSS[`${s.kind}:${s.variant}`] ?? '').join('\n') + (cat.photos.some(isListing) ? `\n${LISTING_CSS}` : '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(cat.business.name)}: concept ${concept.id.toUpperCase()}, ${esc(concept.name)} (preview)</title>
${process.env.STUDIO_CONCEPT_FONTS === '0' ? '' : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${esc(concept.tokens.fonts.href)}">`}
<style>${css}</style></head>
<body><a class="skip" href="#main">Skip to content</a>
${siteHeader(ctx, hero === 'full-bleed' ? 'overlay' : hero === 'split' ? 'bar' : 'center', nav)}
<main id="main">
${body}
</main>
${siteFooter(ctx)}
</body></html>`;
}

// ───────────────────────── measuring the rendered page ─────────────────────────
export interface PageMetrics {
  width: number; height: number; overflowX: number; lang: string; h1: number; headingLevels: number[]; skipLink: boolean;
  text: string;
  /** text that spills out of its own box ("3,444" running into the next column) */
  spills: string[];
  /** words a heading breaks across two lines ("SMOOT" / "HIES") */
  brokenWords: string[];
  contrast: { text: string; ratio: number; required: number }[];
  targets: { text: string; w: number; h: number }[];
  /** fact: the [data-fact] the picture sits in (a service, a menu section), if any */
  images: { src: string; alt: string; asset: string | null; ok: boolean; fact: string | null }[];
  /** fact: the [data-fact] the link sits in (a location's card); where: the header, the hero, the footer or the body */
  links: { href: string; text: string; action: string | null; fact: string | null; where: 'head' | 'hero' | 'foot' | 'body' }[];
  ids: string[];
  prices: { item: string; text: string }[];
  sections: { kind: string; variant: string; top: number; height: number }[];
}

/** Runs inside the page (a string, so the bundler adds nothing to it). */
const MEASURE = `(() => {
  const parse = (c) => { const m = c && c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hexA = (s) => { const [hex, a] = s.split(':'); const h = hex.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: Number(a) }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  // the backdrops a text could sit on: the first opaque background up the tree; over a photograph, its scrim over a white or a black pixel
  const backdrops = (el) => {
    const layers = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.dataset && n.dataset.bg) { const s = hexA(n.dataset.bg); return [{ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }].map((px) => layers.reduceRight((acc, l) => over(l, acc), over(s, px))); }
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) return [layers.slice(0, -1).reduceRight((acc, l) => over(l, acc), c)]; }
    }
    const page = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return [layers.reduceRight((acc, l) => over(l, acc), page)];
  };
  const hidden = (el) => !!el.closest('[aria-hidden="true"]');
  // a box that clips or scrolls on purpose (a ticker, a filmstrip) is not a spill
  const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).overflowX !== 'visible') return true; return false; };
  const spills = [];
  const contrast = []; const seen = new Set(); let text = '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const s = t.textContent.replace(/\\s+/g, ' ').trim(); const el = t.parentElement;
    if (!s || !el || ['SCRIPT', 'STYLE'].includes(el.tagName) || hidden(el) || !visible(el)) continue;
    text += ' ' + s;
    if (seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && !clipped(el)) spills.push(s.slice(0, 40));
    const fg = parse(cs.color); if (!fg) continue;
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const worst = Math.min(...backdrops(el).map((b) => ratio(over(fg, b), b)));
    contrast.push({ text: s.slice(0, 60), ratio: Math.round(worst * 100) / 100, required });
  }
  const brokenWords = [];
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    const w2 = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let t = w2.nextNode(); t; t = w2.nextNode()) {
      for (const m of t.textContent.matchAll(/\\S+/g)) {
        const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        if (tops.size > 1) brokenWords.push(m[0]);
      }
    }
  }
  const targets = [...document.querySelectorAll('a[href], button')].filter((a) => visible(a) && getComputedStyle(a).display !== 'inline' && !a.classList.contains('skip')).map((a) => { const r = a.getBoundingClientRect(); return { text: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height) }; });
  return {
    width: innerWidth, height: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth - innerWidth, lang: document.documentElement.lang,
    h1: document.querySelectorAll('h1').length, headingLevels: [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1])), skipLink: !!document.querySelector('a.skip[href="#main"]'),
    text: text.trim(), spills, brokenWords, contrast, targets,
    images: [...document.images].map((i) => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '', asset: i.dataset.asset || null, ok: i.complete && i.naturalWidth > 0, fact: i.closest('[data-fact]')?.dataset.fact || null })),
    links: [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 60), action: a.dataset.action || null, fact: a.closest('[data-fact]')?.dataset.fact || null, where: a.closest('header.site-head') ? 'head' : a.closest('section[data-kind="hero"]') ? 'hero' : a.closest('footer') ? 'foot' : 'body' })),
    ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
    prices: [...document.querySelectorAll('[data-price]')].map((e) => ({ item: e.dataset.price, text: e.textContent })),
    sections: [...document.querySelectorAll('main > section')].map((s) => ({ kind: s.dataset.kind, variant: s.dataset.variant, top: s.offsetTop, height: s.offsetHeight })),
  };
})()`;

export interface Rendered { conceptId: string; html: string; desktop: { full: string; hero: string; metrics: PageMetrics }; mobile: { full: string; hero: string; metrics: PageMetrics } }

/** Write each concept's HTML and screenshot it at desktop and mobile size. */
/** The same measurements on any HTML (the validators' tests use it to check the measuring itself). */
export async function measureHtml(html: string, viewport = { width: 1440, height: 900 }): Promise<PageMetrics> {
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return (await page.evaluate(MEASURE)) as PageMetrics;
  } finally { await browser.close(); }
}
/** The measurements of a saved page (its pictures load from beside it): re-checking an older render with today's checks. */
export async function measureFile(file: string, viewport = { width: 1440, height: 900 }): Promise<PageMetrics> {
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.goto(`file:///${path.resolve(file).replace(/\\/g, '/')}`, { waitUntil: 'load' });
    return (await page.evaluate(MEASURE)) as PageMetrics;
  } finally { await browser.close(); }
}

export async function renderSet(concepts: Concept[], cat: Catalog, setId: string, opts: { suffix?: string } = {}): Promise<Rendered[]> {
  const dir = setDir(setId);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  const browser = await launchBrowser();
  const out: Rendered[] = [];
  try {
    for (const concept of concepts) {
      const name = `${concept.id}${opts.suffix ?? ''}`;
      const html = path.join(dir, `${name}.html`);
      fs.writeFileSync(html, conceptHtml(concept, cat, setId));
      const url = `file:///${html.replace(/\\/g, '/').replace(/^\//, '')}`;
      const shoot = async (kind: 'desktop' | 'mobile') => {
        const ctx = await browser.newContext(kind === 'desktop' ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.evaluate('document.fonts.ready.then(() => true)');
        await page.waitForTimeout(150);
        const hero = path.join(dir, 'shots', `${name}-${kind}-hero.png`);
        const full = path.join(dir, 'shots', `${name}-${kind}.jpg`);
        await page.screenshot({ path: hero, clip: { x: 0, y: 0, width: kind === 'desktop' ? 1440 : 390, height: kind === 'desktop' ? 900 : 844 } });
        await page.screenshot({ path: full, fullPage: true, type: 'jpeg', quality: 82 });
        const metrics = (await page.evaluate(MEASURE)) as PageMetrics;
        await ctx.close();
        return { full, hero, metrics };
      };
      const desktop = await shoot('desktop');
      const mobile = await shoot('mobile');
      out.push({ conceptId: concept.id, html, desktop, mobile });
    }
  } finally { await browser.close(); }
  return out;
}
