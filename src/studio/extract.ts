import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { extractSiteContent, imageKey, ldNodes, platformOf, plausiblePhone, type ParsedAddress, type SiteContent } from '../sources/site-content.js';
import { findAddresses, spacedHtml } from './address.js';
import { cardServices } from '../sources/page-structure.js';
import { pageTypeOf, summarisePage, type CrawledPage } from '../sources/crawl.js';
import { colorsFromCss, fontsFromCss, googleFontFamilies } from '../sources/website.js';
import { canonicalUrl, isLegal, isPost, urlKey } from './discover.js';
import { sha256 } from './snapshot.js';
import type { PageRecord } from './schema.js';

/**
 * What one page holds, read from its HTML alone: a pure function, so the same HTML always gives the same record.
 * Uses the site extractors Roger already has (identity, services, story, images, videos, hours, hero, claims) and adds
 * what the studio needs on top: headings, forms, calls to action, offers, locations, links, fonts and colours.
 */

const clean = (s: string | undefined) => (s || '').replace(/[​-‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
const CHROME = 'nav, header, footer, .menu, .navbar, .site-header, .site-footer, #header, #footer';

export const assetIdOf = (url: string) => `img_${sha256(imageKey(url)).slice(0, 12)}`;

export interface ExtractedPage {
  record: Omit<PageRecord, 'url' | 'status' | 'reason' | 'httpStatus' | 'attempts' | 'discoveredVia' | 'depth' | 'linkedFrom' | 'finalUrl' | 'bodyHash'>;
  content: SiteContent;
  crawled: Omit<CrawledPage, 'ok' | 'status' | 'error'>;
  /** pictures with what the page says about them, for the asset records */
  images: { id: string; url: string; role: string; alt?: string; context?: string; service?: string }[];
  stylesheets: string[];
  /** families the page loads from Google Fonts */
  googleFonts: string[];
  locations: { address: ParsedAddress; locator: string }[];
  /** the page's own paragraphs (not the menu, header or footer), for an about page's story */
  paragraphs: { heading?: string; text: string[] };
}

const OFFER = /(?:\bfree\s+(?:estimates?|inspections?|consultations?|quotes?|assessments?|delivery|shipping|trial|class|session|exam|evaluation)\b|\d{1,3}\s?% off\b|\$\d+\s?off\b|\b(?:discount|coupon|promo(?:tion)?|special offer|financing|gift cards?)\b|\bfirst (?:visit|class|session) free\b|\bnew (?:patient|client|customer) special\b)/i;
const termsOf = (t: string) => (/\bfree\b/i.test(t) ? 'free' : /financ/i.test(t) ? 'financing' : /% off|\$\d+\s?off|discount|coupon|promo|special/i.test(t) ? 'discount' : /gift card/i.test(t) ? 'gift-card' : 'other');
const VERB = /^(get|request|book|schedule|call|contact|order|reserve|start|see|view|learn|shop|buy|apply|claim|find|visit|email|text|chat|join|sign up|subscribe)\b/i;

function classify(url: URL, home: string, h1: string | undefined, content: SiteContent, text: string, title?: string): PageRecord['type'] {
  const path = url.pathname.toLowerCase();
  if (urlKey(url.href) === urlKey(home) || path === '/' || path === '') return 'home';
  if (isLegal(path) || isLegal(title || '')) return 'legal';
  if (isPost(path)) return 'post';
  if (/\/(blog|news|articles?)\/?$/.test(path)) return 'blog';
  if (/(^|\/)(locations?|find-us|our-locations|stores?|visit-us)(\/|$)/.test(path) || findAddresses(text).length >= 3) return 'locations';
  if (/(^|\/)(menu|our-menu|food|drinks)(\/|$)/.test(path)) return 'menu';
  if (/(^|\/)(book|booking|schedule|appointments?|reserve|reservations?)(\/|$)/.test(path)) return 'booking';
  const t = pageTypeOf(url.href, h1);
  if (t === 'services') return /services?\/?$/.test(path) || content.services.length >= 3 ? 'services' : 'service';
  return t;
}

function formsOf($: cheerio.CheerioAPI, base: string): PageRecord['forms'] {
  const out: PageRecord['forms'] = [];
  $('form').each((_, f) => {
    const fields: PageRecord['forms'][number]['fields'] = [];
    $(f).find('input, select, textarea').each((__, el) => {
      const type = (el.tagName === 'input' ? $(el).attr('type') || 'text' : el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
      const name = $(el).attr('name') || $(el).attr('id') || '';
      const id = $(el).attr('id');
      const label = clean((id ? $(`label[for="${id}"]`).first().text() : '') || $(el).closest('label').text() || $(el).attr('placeholder') || $(el).attr('aria-label')).slice(0, 60) || undefined;
      fields.push({ name: name.slice(0, 60), type, required: $(el).is('[required]') || $(el).attr('aria-required') === 'true', label });
    });
    const submit = clean($(f).find('button[type="submit"], input[type="submit"], button:not([type])').first().text() || $(f).find('input[type="submit"]').attr('value'));
    const hay = `${$(f).attr('id') || ''} ${$(f).attr('class') || ''} ${submit} ${fields.map((x) => `${x.name} ${x.label || ''}`).join(' ')}`.toLowerCase();
    const purpose: PageRecord['forms'][number]['purpose'] = /search/.test(hay) && fields.length <= 2 ? 'search'
      : /password|login|sign in/.test(hay) ? 'login'
        : /newsletter|subscribe/.test(hay) && fields.length <= 3 ? 'newsletter'
          : /book|appointment|schedule|reserv/.test(hay) ? 'booking'
            : /quote|estimate|inspection/.test(hay) ? 'quote'
              : /message|contact|phone|email|name/.test(hay) ? 'contact' : 'other';
    let action = $(f).attr('action') || '';
    try { action = action ? new URL(action, base).toString() : base; } catch { /* keep as written */ }
    out.push({ action, method: ($(f).attr('method') || 'get').toLowerCase(), purpose, submitLabel: submit.slice(0, 60) || undefined, fields: fields.slice(0, 20) });
  });
  // forms a third-party script draws in the browser: the HTML holds only a container or an iframe
  const embeds: [string, RegExp][] = [['HubSpot', /hsforms|hbspt/i], ['JotForm', /jotform/i], ['Typeform', /typeform/i], ['Google Forms', /docs\.google\.com\/forms/i], ['Wix Forms', /wixforms|wix-forms/i], ['Gravity Forms', /gform_wrapper/i], ['WPForms', /wpforms-container/i], ['Formstack', /formstack/i], ['Jotform', /form\.jotform/i]];
  const html = $.html();
  for (const [name, re] of embeds) if (re.test(html) && !out.some((f) => f.embedded === name)) {
    if (!out.length || name === 'Google Forms' || name === 'Typeform' || name === 'HubSpot') out.push({ action: '', method: 'script', purpose: 'contact', fields: [], embedded: name });
  }
  return out;
}

function ctasOf($: cheerio.CheerioAPI, base: string, origin: string): PageRecord['ctas'] {
  const out: PageRecord['ctas'] = [];
  const seen = new Set<string>();
  $('a[href], button').each((_, el) => {
    const label = clean($(el).text() || $(el).attr('aria-label') || $(el).attr('title')).slice(0, 80);
    if (!label || label.length > 60) return;
    const cls = `${$(el).attr('class') || ''} ${$(el).attr('role') || ''}`;
    const styled = /btn|button|cta/i.test(cls) || el.tagName === 'button';
    if (!styled && !VERB.test(label)) return;
    const raw = $(el).attr('href') || '';
    if (el.tagName === 'button' && !raw && !/book|call|quote|estimate|order|schedule|contact|get/i.test(label)) return;
    let href = raw;
    let kind: PageRecord['ctas'][number]['kind'] = 'page';
    if (/^tel:/i.test(raw)) kind = 'phone';
    else if (/^mailto:/i.test(raw)) kind = 'email';
    else if (raw.startsWith('#')) kind = /form|quote|estimate|contact|book|inspection/i.test(raw + label) ? 'form' : 'anchor';
    else if (raw) {
      try {
        const u = new URL(raw, base);
        href = u.toString();
        kind = platformOf(u.href) ? 'booking' : u.origin === origin ? (u.hash && /form|quote|book|contact/i.test(u.hash + label) ? 'form' : 'page') : 'external';
      } catch { return; }
    } else kind = 'form';
    const key = `${label.toLowerCase()}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    const where = $(el).closest(CHROME).length ? ($(el).closest('footer, .site-footer, #footer').length ? 'footer' : 'header') : $(el).closest('section, main, article, div').first().attr('class')?.split(/\s+/)[0] || 'body';
    out.push({ label, href: href || '(button)', kind, terms: /\bfree\b|financ|% off|\$\d+\s?off|discount/i.test(label) ? termsOf(label) : undefined, locator: `${el.tagName} in ${where}` });
  });
  return out.slice(0, 40);
}

function locationsOf($: cheerio.CheerioAPI, text: string): { address: ParsedAddress; locator: string }[] {
  const out: { address: ParsedAddress; locator: string }[] = [];
  const key = (a: ParsedAddress) => `${a.zip}|${a.street.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const add = (a: ParsedAddress, locator: string) => { if (!out.some((x) => key(x.address) === key(a))) out.push({ address: a, locator }); };
  for (const n of ldNodes($)) {
    for (const ad of [].concat(n.address || []) as any[]) {
      if (!ad || typeof ad !== 'object' || !ad.streetAddress || !ad.postalCode) continue;
      const street = clean(String(ad.streetAddress));
      const zip = String(ad.postalCode).slice(0, 5);
      const city = clean(String(ad.addressLocality || ''));
      const state = clean(String(ad.addressRegion || ''));
      add({ street, city, state, zip, formatted: `${street}, ${city}, ${state} ${zip}`.replace(/\s+,/g, ',') }, `json-ld ${[].concat(n['@type'] || []).join('/') || 'node'} address`);
    }
  }
  for (const a of findAddresses(text)) add(a, 'page text');
  return out;
}

function offersOf($: cheerio.CheerioAPI, ctas: PageRecord['ctas']): PageRecord['offers'] {
  const out: PageRecord['offers'] = [];
  const seen = new Set<string>();
  const push = (raw: string, locator: string) => {
    const t = clean(raw);
    if (t.length < 4 || t.length > 140 || !OFFER.test(t)) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, terms: termsOf(t), locator });
  };
  for (const c of ctas) push(c.label, `call to action (${c.locator})`);
  $('h1, h2, h3, h4, strong, .banner, .promo, .offer, .special').each((_, el) => { if (!$(el).closest('nav').length) push($(el).text(), el.tagName === 'strong' ? 'bold text' : `${el.tagName} heading`); });
  // an offer stated in a sentence ("$50 off any water heater install this month."): that sentence
  $('p, li').each((_, el) => {
    if ($(el).closest(`${CHROME}, form`).length) return;
    for (const sentence of clean($(el).text()).match(/[^.!?]+[.!?]?/g) ?? []) if (OFFER.test(sentence)) push(sentence, `${el.tagName === 'li' ? 'list item' : 'paragraph'}`);
  });
  return out.slice(0, 12);
}

const SOCIAL = /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com|nextdoor\.com/i;
const REVIEW = /yelp\.com|google\.com\/maps|g\.page|bbb\.org|angi\.com|homeadvisor|thumbtack|houzz|tripadvisor/i;
const MAP = /maps\.google|google\.com\/maps|goo\.gl\/maps|maps\.apple\.com/i;

/** One page, from its HTML. `stylesheets` holds the CSS of linked stylesheets Roger fetched, by address. */
export function extractPage(html: string, url: string, opts: { home: string; origin: string; rendered?: boolean; stylesheets?: Map<string, string> }): ExtractedPage {
  const content = extractSiteContent(html, url, { rendered: opts.rendered });
  const crawled = summarisePage(html, url);
  const $ = cheerio.load(html);
  const body = cheerio.load(spacedHtml(html));
  body('script, style, noscript, svg, iframe, template').remove();
  const text = clean(body('body').text());
  const u = new URL(url);
  const h1 = clean($('h1').first().text()) || undefined;
  const headings: PageRecord['headings'] = [];
  $('h1, h2, h3').each((_, el) => {
    if ($(el).closest(CHROME).length) return;
    const t = clean($(el).text());
    if (t && t.length <= 120 && headings.length < 40) headings.push({ level: Number(el.tagName[1]), text: t });
  });

  const internal = new Set<string>();
  const external: PageRecord['externalLinks'] = [];
  $('a[href]').each((_, a) => {
    const raw = ($(a).attr('href') || '').trim();
    if (!raw || /^(#|tel:|mailto:|javascript:|sms:)/i.test(raw)) return;
    const c = canonicalUrl(raw, url, opts.origin);
    if (c) { internal.add(c.toString()); return; }
    try {
      const x = new URL(raw, url);
      if (!/^https?:$/.test(x.protocol)) return;
      const kind = platformOf(x.href) ? 'booking' : SOCIAL.test(x.host) ? 'social' : MAP.test(x.href) ? 'map' : REVIEW.test(x.href) ? 'review' : 'other';
      if (!external.some((e) => e.url === x.href)) external.push({ url: x.href, kind });
    } catch { /* not a link */ }
  });

  const ctas = ctasOf($, url, opts.origin);
  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_, a) => { const p = plausiblePhone(decodeURIComponent(($(a).attr('href') || '').slice(4))); if (p) phones.add(p); });
  if (content.phones.primary) phones.add(content.phones.primary);
  for (const o of content.phones.others) { const p = plausiblePhone(o.number); if (p) phones.add(p); }
  const emails = new Set<string>([...content.emails]);
  $('a[href^="mailto:"]').each((_, a) => { const e = ($(a).attr('href') || '').slice(7).split('?')[0].trim(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) emails.add(e.toLowerCase()); });

  // fonts and colours: the page's own styles and the stylesheets it links
  const colors = new Map<string, number>();
  const fonts = new Map<string, number>();
  const gFonts: string[] = [];
  $('style').each((_, el) => { colorsFromCss($(el).text(), colors); fontsFromCss($(el).text(), fonts); });
  $('[style]').each((_, el) => { const css = $(el).attr('style') || ''; colorsFromCss(css, colors, 2); fontsFromCss(css, fonts); });
  $('link[href*="fonts.googleapis.com"]').each((_, el) => { gFonts.push(...googleFontFamilies($(el).attr('href') || '')); });
  const stylesheets = $('link[rel="stylesheet"]').map((_, el) => { try { return new URL($(el).attr('href') || '', url).toString(); } catch { return ''; } }).get()
    .filter((h: string) => h && !/fonts\.googleapis|font-awesome|fontawesome|bootstrap(\.min)?\.css|jquery|dashicons/i.test(h));
  for (const sheet of stylesheets) {
    const css = opts.stylesheets?.get(sheet);
    if (!css) continue;
    colorsFromCss(css, colors);
    fontsFromCss(css, fonts);
    for (const m of css.matchAll(/@import\s+url\(["']?([^"')]+fonts\.googleapis[^"')]+)/g)) gFonts.push(...googleFontFamilies(m[1]));
  }

  // pictures: what the page shows, with the heading it sits under and the service card it is on
  const cards = cardServices($, url);
  const cardImage = new Map(cards.filter((c) => c.image).map((c) => [imageKey(c.image!.url), c.name]));
  for (const s of content.services) if (s.image) cardImage.set(imageKey(s.image.url), s.name);
  const contextOf = new Map<string, string>();
  $('img').each((_, im) => {
    const src = $(im).attr('src') || $(im).attr('data-src') || '';
    if (!src) return;
    let key: string;
    try { key = imageKey(new URL(src, url).toString()); } catch { return; }
    const h = $(im).closest('section, article, div').find('h1, h2, h3, h4').first().text();
    if (clean(h)) contextOf.set(key, clean(h).slice(0, 80));
  });
  const images = content.images.filter((i) => i.role !== 'icon').map((i) => ({ id: assetIdOf(i.url), url: i.url, role: i.role, alt: i.alt, context: contextOf.get(i.key), service: cardImage.get(i.key) }));

  const services: PageRecord['services'] = [];
  for (const s of content.services) services.push({ name: s.name, description: s.description, href: s.href || s.pageUrl, image: s.image ? assetIdOf(s.image.url) : undefined, locator: s.locator || `${s.method}: ${s.name}` });
  for (const c of cards) if (!services.some((s) => s.name.toLowerCase() === c.name.toLowerCase())) services.push({ name: c.name, description: c.description, href: c.href, image: c.image ? assetIdOf(c.image.url) : undefined, locator: c.locator });

  const locations = locationsOf($, text);
  const record: ExtractedPage['record'] = {
    type: classify(u, opts.home, h1, content, text, clean($('title').first().text()).split(/[|–-]/)[0]),
    title: clean($('title').first().text()) || undefined,
    description: clean($('meta[name="description"]').attr('content')) || undefined,
    canonical: $('link[rel="canonical"]').attr('href') || undefined,
    headings,
    services: services.slice(0, 30),
    locations,
    phones: [...phones].sort(),
    emails: [...emails].sort(),
    offers: offersOf($, ctas),
    forms: formsOf($, url),
    ctas,
    internalLinks: [...internal].sort(),
    externalLinks: external.slice(0, 40),
    images: [...new Set(images.map((i) => i.id))],
    videos: content.videos.map((v) => ({ provider: v.kind, url: v.url, title: v.title })),
    fonts: [...new Set([...gFonts, ...[...fonts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f)])].slice(0, 8),
    colors: [...colors.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)).slice(0, 16),
    textLength: text.length,
  };
  const paras: string[] = [];
  body('p').each((_, p) => { if (body(p).closest(CHROME).length || body(p).closest('form').length) return; const t = clean(body(p).text()); if (t.length >= 60 && !paras.includes(t)) paras.push(t); });
  const lead = headings.find((h) => h.level <= 2)?.text;
  return { record, content, crawled, images, stylesheets, googleFonts: [...new Set(gFonts)].sort(), locations, paragraphs: { heading: lead, text: paras.slice(0, 10) } };
}

/** Script-built pages: little text, many scripts; worth reading again in a browser. */
export function looksScriptBuilt(html: string): boolean {
  const $ = cheerio.load(html);
  const scripts = $('script').length;
  $('script, style, noscript, svg, template').remove();
  const text = clean($('body').text());
  return text.length < 400 || (scripts > 12 && text.length < 1500) || /<div id="(root|app|__next)"><\/div>/.test(html);
}
void (null as unknown as Element);
