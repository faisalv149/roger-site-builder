/**
 * From a collected plan to a page: the generator's input (facts from the fact sheet, the page's actions, the checked
 * photos), the splash-specific checks of Claude's answer, the JSON-LD, and the page itself (the compiled body, Roger's
 * head, footer links, dock, quote sheet and preview ribbon). Google content is left as slots, filled when served.
 */
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { checkCode, compilePage, PIPELINE_REV, type FrontendInput } from '../studio/frontend/page.js';
import { isSiteOnly, type SplashPlan } from './collect.js';
import type { Fact } from './facts.js';
import { ACTION_LABELS, isCalm, minimalContact, tradeRow, type Action, type TradeRow } from './playbook.js';
import type { SplashCode } from './prompt.js';
import { attributeGoogleSlots } from './slots.js';
import { imageSet } from './images.js';
import { fontFaceCss, type SplashFontFace } from './fonts.js';
import { HERO_VARIANTS, HERO_SEQUENCES, KIT_CSS, KIT_HEAD_JS, kitScripts, kitTokens, TREATMENTS, type Treatment } from './kit.js';
import { versionLabel } from '../version.js';
import { DOCK_JS, dockCss, dockHtml, sheetHtml, type DockAction, type DockKind } from './dock.js';

const factOf = (plan: SplashPlan, field: string) => plan.fact_sheet.find((f) => f.field === field);
const listOf = (f: Fact | undefined) => (Array.isArray(f?.value) ? f!.value.map(String) : f?.value !== undefined && f?.value !== '' ? [String(f!.value)] : []);
const textOf = (f: Fact | undefined) => (f ? (Array.isArray(f.value) ? f.value.join('\n') : String(f.value)) : '');

/** the city or town in an address: the part beside the postcode ("1905 S 1st St, Austin, TX 78704, USA" → Austin;
 *  "Plaza 01, Paragon City, Lahore, 54000, Pakistan" → Lahore; "…, Austin TX 78704" → Austin) */
export function cityOf(address: string): string {
  const parts = address.split(',').map((s) => s.trim()).filter((s) => s && !/^(usa|united states|pakistan|uk|united kingdom|canada|australia)$/i.test(s));
  const ZIP = /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b|\b\d{5,6}\b/;
  for (let i = parts.length - 1; i > 0; i--) {
    if (!ZIP.test(parts[i])) continue;
    const rest = parts[i].replace(ZIP, '').trim();
    return rest && !/^[A-Z]{2}$/.test(rest) ? rest : parts[i - 1];
  }
  // no postcode: a trailing state code points at the part before it
  if (parts.length >= 2) return /^[A-Z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : parts[parts.length - 1];
  return parts[0] ?? '';
}
const digits = (s: string) => s.replace(/[^\d+]/g, '');
export const SUPERLATIVE = /\b(best|top[- ]rated|#1|number one|leading|premier|unmatched|unbeatable|world[- ]class)\b/i;
/** claims Claude may not make in its own words unless the business stated them (the fact field that would hold it) */
export const NEVER_INFER_COPY: [string, RegExp, string][] = [
  ['emergency', /\b(24\/7|around the clock|emergency|same[- ]day|within the hour|fast response|rapid response|on call)\b/i, 'emergency or round-the-clock service'],
  ['free_estimate', /\bfree (estimate|quote|inspection|consultation|diagnostic)s?\b/i, 'anything free'],
  ['family_owned', /\bfamily[- ](owned|run)\b/i, 'that it is family owned'],
  ['licence', /\blicen[cs]ed\b/i, 'a licence'],
  ['insurance', /\binsured\b|\bbonded\b|\binsurance (accepted|plans)\b/i, 'insurance'],
  ['warranty', /\bwarrant(y|ies|ied)\b|\bguarantee/i, 'a warranty or guarantee'],
  ['financing', /\bfinanc(e|ing)\b/i, 'financing'],
  ['years_in_business', /\b(decades?|years) of (experience|service)\b|\bestablished\b/i, 'how long it has been in business'],
  ['award', /\baward/i, 'an award'],
  ['accepting_new_patients', /\baccepting new (patients|clients)\b/i, 'that it is accepting new patients'],
];
/** the reviews block's baseline (Claude styles the rest): a list without bullets, the quote without browser indents */
const REVIEWS_BASE_CSS = '.rg-svc-link{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}.g-reviews__list{list-style:none;padding:0;margin:0}.g-review{list-style:none}.g-review__text{margin:0}.g-review__text p{margin:0}.g-review__avatar{border-radius:50%;vertical-align:middle}.g-src,.g-src a,.g-reviews__how a,.g-review__by a{color:inherit}.g-src a,.g-reviews__how a,.g-review__by a{display:inline-flex;align-items:center;min-height:24px}';

/** each service's page on the business's site, by name ("Roof Repair | https://…/roofing-services/"); home-page anchors are not service pages */
export function serviceLinks(plan: SplashPlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of [...listOf(factOf(plan, 'services')), ...listOf(factOf(plan, 'menu_items'))]) {
    const parts = v.split(' | '), url = parts.find((x) => /^https?:\/\//.test(x));
    if (!url) continue;
    try { if (new URL(url).pathname.replace(/\/+$/, '') === '') continue; } catch { continue; }
    out.set(parts[0].trim().toLowerCase(), url);
  }
  return out;
}

/**
 * The footer's links to the business's own pages ("Title | … | https://url", from the saved research). A page's
 * title often carries the business name and search phrases ("Roofing Contractor Round Rock TX"), so the label is the
 * title's first segment that isn't the business name, unless it has nothing in common with the address, when the
 * address names it better ("/caliber-restoration-about-us" → "About us"). The home page is "Full website"; builder
 * leftovers ("Elementor #4131", "/blank-3" with no usable title) are skipped. At most eight.
 */
export function footerPages(entries: string[], business: string): { label: string; url: string }[] {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const biz = norm(business);
  const isName = (s: string) => { const n = norm(s); return !!n && (biz.startsWith(n) || n.startsWith(biz)); };
  const bizWords = new Set(biz.split(' '));
  const JUNK = /^(blank|untitled|page|copy of|elementor|new page)\b|^\d+$|#\d+/i;
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const segs = e.split(/\s+\|\s+/);
    const url = [...segs].reverse().find((s) => /^https?:\/\//i.test(s));
    if (!url) continue;
    let path = '';
    try { path = new URL(url).pathname.replace(/\/+$/, ''); } catch { continue; }
    let label: string;
    if (!path) label = 'Full website';
    else {
      const title = segs.filter((s) => s !== url).flatMap((s) => s.split(/\s+[-–—]\s+/)).map((s) => s.trim()).find((s) => s && !isName(s) && !JUNK.test(s)) ?? '';
      const slugWords = norm(decodeURIComponent(path.split('/').pop() ?? '').replace(/[-_]+/g, ' ')).split(' ').filter((w) => w && !bizWords.has(w));
      const slug = slugWords.join(' ');
      const shares = title && norm(title).split(' ').some((w) => w.length > 2 && slugWords.includes(w));
      label = title && (shares || !slug || JUNK.test(slug)) ? title : slug && !JUNK.test(slug) ? slug.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : '';
    }
    label = label.slice(0, 40).trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ label, url });
    if (out.length === 8) break;
  }
  return out;
}

/** the page's actions, each with its verified destination and a label that says what happens */
export function splashActions(plan: SplashPlan, input: FrontendInput, row: TradeRow): DockAction[] {
  const out: DockAction[] = [];
  const phone = textOf(factOf(plan, 'phone'));
  // the dialled number: the catalog's verified call destination (its international format), else the number shown
  const tel = input.actions.find((a) => a.kind === 'call')?.href ?? (phone ? `tel:${digits(phone)}` : '');
  if (tel) {
    out.push({ kind: 'call', label: 'Call now', short: 'Call', href: tel });
    out.push({ kind: 'text', label: 'Send a text', short: 'Text', href: `sms:${tel.slice(4)}?&body=${encodeURIComponent('Hi, I found you on your website.')}` });
  }
  const address = textOf(factOf(plan, 'address'));
  if (address) out.push({ kind: 'directions', label: 'Get directions', short: 'Directions', href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}${isSiteOnly(plan.placeId) ? '' : `&destination_place_id=${encodeURIComponent(plan.placeId)}`}`, external: true });
  const link = (field: string) => textOf(factOf(plan, field));
  const health = minimalContact(row);
  if (link('book_url')) out.push({ kind: 'book', label: health ? 'Book an appointment' : row.family === 'beauty' ? 'Book online' : 'Book now', short: 'Book', href: link('book_url'), external: true });
  else if (health) out.push({ kind: 'book', label: 'Request an appointment', short: 'Book', href: '#quote' });
  if (link('order_url')) out.push({ kind: 'order', label: 'Order online', short: 'Order', href: link('order_url'), external: true });
  if (link('reserve_url')) out.push({ kind: 'reserve', label: 'Reserve a table', short: 'Reserve', href: link('reserve_url'), external: true });
  if (!health) out.push({ kind: 'quote', label: plan.fact_sheet.some((f) => f.field === 'free_estimate') ? 'Get a free quote' : 'Get a quote', short: 'Quote', href: '#quote' });
  if (plan.screen_plan.screens.some((s) => s.screen === 'offer')) out.push({ kind: 'menu', label: row.family === 'food' ? 'See the menu' : 'See services', short: row.family === 'food' ? 'Menu' : 'Services', href: '#offer' });
  return out;
}
/** the main action (the trade's, when this business has it; else call, else directions) and the dock's others in order */
export function dockActions(actions: DockAction[], row: TradeRow): { main: DockAction; secondary: DockAction[] } | undefined {
  const by = (k: Action) => actions.find((a) => a.kind === k);
  const main = by(row.mainAction) ?? by('call') ?? by('directions') ?? actions[0];
  if (!main) return undefined;
  const order = [...row.dock, 'call', 'directions', 'text'] as Action[];
  const secondary = [...new Set(order)].map(by).filter((a): a is DockAction => !!a && a !== main).slice(0, 4);
  return { main, secondary };
}

/** the generator's input: the brief's checked photos and offerings, with the fact sheet's facts (Google content excluded) */
export function splashInput(plan: SplashPlan, base: FrontendInput, row: TradeRow): FrontendInput {
  const facts: Record<string, string> = {};
  for (const field of ['name', 'address', 'phone', 'email', 'story', 'service_area', 'emergency', 'licence', 'insurance', 'years_in_business', 'award', 'warranty', 'financing', 'free_estimate', 'family_owned', 'accepting_new_patients', 'attributes', 'prices']) {
    const v = textOf(factOf(plan, field)).trim();
    if (v) facts[field] = field === 'service_area' ? v.split('\n').join(', ') : field === 'attributes' ? v.split('\n').join(' · ') : v;
  }
  const hours = listOf(factOf(plan, 'hours'));
  if (hours.length) facts.hours = hours.join('\n');
  // offerings: the brief's own services and menu items (their ids), named as the business writes them
  for (const [k, v] of Object.entries(base.facts)) if (/^(service|item)-/.test(k)) facts[k] = v;
  listOf(factOf(plan, 'faqs')).slice(0, 8).forEach((qa, i) => { const [q, ...a] = qa.split(' | '); facts[`faq-${i + 1}-q`] = q; facts[`faq-${i + 1}-a`] = a.join(' | '); });
  listOf(factOf(plan, 'team')).slice(0, 8).forEach((t, i) => { const [name, role] = t.split(' | '); facts[`team-${i + 1}-name`] = name; if (role) facts[`team-${i + 1}-role`] = role; });
  const actions = splashActions(plan, base, row).map((a) => ({ id: a.kind, label: a.label, href: a.href, kind: (a.kind === 'directions' ? 'directions' : a.kind === 'call' ? 'call' : 'site') as 'call', factId: a.kind === 'call' ? 'phone' : a.kind === 'directions' ? 'address' : 'name' }));
  return { ...base, facts, actions };
}

/** the splash-specific checks of Claude's answer (besides the compiler's own: facts, photos, copy, safety) */
export function splashProblems(code: SplashCode, plan: SplashPlan, row: TradeRow): string[] {
  const errors: string[] = [];
  const $ = load(code.html, {}, false);
  const want = plan.screen_plan.screens.map((s) => s.screen);
  const got = $('section[data-screen]').toArray().map((el) => $(el).attr('data-screen'));
  if (got.join() !== want.join()) errors.push(`The <section data-screen> elements must be exactly, in order: ${want.join(', ')} (found: ${got.join(', ') || 'none'}).`);
  for (const el of $('section[data-screen]').toArray()) if ($(el).attr('id') !== $(el).attr('data-screen')) errors.push(`Give the ${$(el).attr('data-screen')} section id="${$(el).attr('data-screen')}".`);
  const own = (sel: string) => { const n = $(sel).first(); if (!n.length) return null; const c = n.clone(); c.find('[data-fact],[data-google]').remove(); return c.text().replace(/\s+/g, ' ').trim(); };
  const head = own('#hero [data-copy="headline"]'), sub = own('#hero [data-copy="subline"]');
  if (head === null) errors.push('Mark the hero headline with data-copy="headline".');
  else if (head.split(' ').filter(Boolean).length > 8) errors.push(`The headline "${head}" has more than 8 words.`);
  // the trade's watch-outs: no superlatives, and nothing the business has not stated (24/7, free estimates, licences…)
  const ownAll = (() => { const c = $.root().clone(); c.find('[data-fact],[data-google]').remove(); return c.text().replace(/\s+/g, ' '); })();
  const superl = ownAll.match(SUPERLATIVE);
  if (superl) errors.push(`Your own words say "${superl[0]}": no superlatives (only a quoted review or a sourced award may). Remove it.`);
  const stated = new Set(plan.fact_sheet.map((f) => f.field));
  for (const [field, re, what] of NEVER_INFER_COPY) {
    const m = ownAll.match(re);
    if (m && !stated.has(field)) errors.push(`Your own words claim "${m[0]}", but the business never stated ${what}: remove it.`);
  }
  // where things come from is Roger's to say (attributions, credits): Claude's own words never name Google
  const all = $.root().clone(); all.find('[data-fact],[data-google]').remove();
  const google = all.text().replace(/\s+/g, ' ').match(/[^.!?]*\bgoogle\b[^.!?]*/i);
  if (google) errors.push(`Your own words mention Google ("${google[0].trim().slice(0, 120)}"): leave sources to Roger's attributions and say nothing about where photos come from.`);
  if (sub === null) errors.push('Mark the hero sub-line with data-copy="subline".');
  else if (sub.split(' ').filter(Boolean).length > 20) errors.push(`The sub-line "${sub}" has more than 20 words.`);
  if (!$('#hero a[data-action]').length) errors.push('Put the main action in the hero (an <a data-action>).');
  if (want.includes('proof') && plan.material.reviews >= 3 && !$('#proof [data-google="reviews"]').length) errors.push('Put <div data-google="reviews"></div> in the proof section.');
  // template tells
  if (/text-transform\s*:\s*uppercase/i.test(code.css)) errors.push('No text-transform: uppercase (an all-caps label is a template tell).');
  if ($('h1 em, h1 i, h2 em, h2 i, [data-copy] em, [data-copy] i').length) errors.push('No italic word inside a headline.');
  $('a').each((_, el) => { if (/[→›»➔➜↗⟶]\s*$/.test($(el).text().trim())) errors.push(`No arrow appended to the link "${$(el).text().trim()}".`); });
  // motion
  const moves = /@keyframes|animation\s*:|animation-name|transition\s*:/i.test(code.css);
  if (isCalm(row) && moves) errors.push(`${row.label} is a calm trade: no motion at all (no animation, transition or @keyframes).`);
  if (moves && !/prefers-reduced-motion/i.test(code.css)) errors.push('Wrap all motion in @media (prefers-reduced-motion: no-preference) and keep the page complete without it.');
  if (/\b(parallax|background-attachment\s*:\s*fixed)\b/i.test(code.css)) errors.push('No background-attachment: fixed; parallax only on the hero image with a CSS scroll timeline, 10% or less.');
  if (/\d/.test(code.meta_description)) errors.push('The meta description has no digits.');
  return errors;
}

/** the facts every page must show (when the business has them) */
export const requiredFacts = (input: FrontendInput) => ['name', 'address', 'phone', 'hours'].filter((k) => input.facts[k]);

/** schema.org JSON-LD: the trade's LocalBusiness type, from the fact sheet only (no rating or review markup) */
export function splashJsonLd(plan: SplashPlan, row: TradeRow, url?: string): Record<string, unknown> {
  const t = (f: string) => textOf(factOf(plan, f)) || undefined;
  const geo = t('geo')?.split(',').map(Number);
  const hours = listOf(factOf(plan, 'hours'));
  const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const to24 = (s: string) => { const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i); if (!m) return undefined; let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12; return `${String(h).padStart(2, '0')}:${m[2]}`; };
  const spec = hours.flatMap((line) => {
    const m = line.match(/^(\w+):\s*(.+)$/); if (!m || !DAY.includes(m[1])) return [];
    if (/open 24 hours/i.test(m[2])) return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: m[1], opens: '00:00', closes: '23:59' }];
    return m[2].split(',').flatMap((range) => { const [a, b] = range.split(/[–-]/).map((x) => x.trim()); const opens = a && to24(/[AP]M/i.test(a) ? a : `${a} ${b?.slice(-2)}`), closes = b && to24(b); return opens && closes ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: m[1], opens, closes }] : []; });
  });
  const offers = [...listOf(factOf(plan, 'services')), ...listOf(factOf(plan, 'menu_items'))].map((s) => s.split(' | ').filter((x) => !/^https?:/.test(x)).join(' ').trim()).filter(Boolean).slice(0, 30);
  const price = { PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' }[t('price_level') ?? ''];
  const ld: Record<string, unknown> = { '@context': 'https://schema.org', '@type': row.schemaType, name: t('name') };
  if (url ?? t('website')) ld.url = url ?? t('website');
  if (t('phone')) ld.telephone = t('phone');
  if (t('address')) ld.address = t('address');
  if (geo?.length === 2 && geo.every(Number.isFinite)) ld.geo = { '@type': 'GeoCoordinates', latitude: geo[0], longitude: geo[1] };
  if (spec.length) ld.openingHoursSpecification = spec;
  if (price) ld.priceRange = price;
  const same = listOf(factOf(plan, 'same_as'));
  if (same.length) ld.sameAs = same;
  if (offers.length) ld.hasOfferCatalog = { '@type': 'OfferCatalog', name: row.family === 'food' ? 'Menu' : 'Services', itemListElement: offers.map((name) => ({ '@type': 'Offer', itemOffered: { '@type': row.family === 'food' ? 'MenuItem' : 'Service', name } })) };
  return ld;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SplashPageOpts {
  id: string; mode: 'preview' | 'live'; quoteAction?: string; canonical?: string;
  /** the origin Roger serves sized website photos and fonts from (none: the website's own files and Google Fonts) */
  imageBase?: string;
  /** the page's fonts as Roger serves them (none: Google Fonts' stylesheet) */
  fontFaces?: SplashFontFace[];
  /** link-outs the checks found dead: links to the business's own pages are dropped (their text stays) */
  deadLinks?: string[];
  /** a page made with the Roger kit (its CSS, motion and big footer); pages made before it keep their own look */
  kit?: boolean;
}
/** the whole page (Google content as slots, filled when served) */
export function compileSplash(code: SplashCode, plan: SplashPlan, input: FrontendInput, o: SplashPageOpts): string {
  const row = tradeRow(plan.trade.row);
  const body = compilePage({ idea: code.idea, html: code.html, css: code.css, fonts: code.fonts }, input, { rev: PIPELINE_REV, version: o.id, required: requiredFacts(input), minPhotos: Math.min(1, input.photos.length), requireAction: true, page: 'home' });
  const $ = load(body);
  const name = textOf(factOf(plan, 'name'));
  const what = textOf(factOf(plan, 'category')) || row.label;
  const city = cityOf(textOf(factOf(plan, 'address')));
  $('title').text(`${name} | ${what}${city ? ` in ${city}` : ''}`);
  $('head meta[name="robots"]').remove();
  const head = [
    o.mode === 'preview' ? '<meta name="robots" content="noindex, nofollow">' : '',
    `<meta name="description" content="${esc(code.meta_description)}">`,
    `<meta property="og:title" content="${esc($('title').text())}">`, `<meta property="og:description" content="${esc(code.meta_description)}">`, '<meta property="og:type" content="website">',
    o.mode === 'live' && o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : '',
    code.design_tokens.primary ? `<meta name="theme-color" content="${esc(code.design_tokens.primary)}">` : '',
    `<script type="application/ld+json">${JSON.stringify(splashJsonLd(plan, row, o.mode === 'live' ? o.canonical : undefined)).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('');
  $('head').append(head);
  // every in-page action says where it was clicked
  $('a[data-action]').each((_, el) => { const a = $(el); a.attr('data-event', `cta_${a.attr('data-action')}`).attr('data-screen', a.closest('section[data-screen]').attr('data-screen') ?? 'page'); });
  attributeGoogleSlots($, textOf(factOf(plan, 'maps_url')) || undefined);
  // loading: the hero's photo first and at once; every other photo when it comes near the screen
  $('main img[data-photo], main img[data-gphoto]').each((i, el) => {
    const img = $(el), hero = img.closest('#hero').length > 0;
    img.removeAttr('loading').removeAttr('fetchpriority').attr('decoding', 'async');
    if (hero && i === 0) img.attr('fetchpriority', 'high'); else if (!hero) img.attr('loading', 'lazy');
  });
  // fonts from Roger: inline @font-face rules, the display face preloaded, no request to Google
  if (o.imageBase && o.fontFaces?.length) {
    const f = fontFaceCss(o.fontFaces, o.imageBase);
    $('link[href^="https://fonts.googleapis.com"]').remove();
    $('head').prepend(`${f.preload ? `<link rel="preload" href="${esc(f.preload)}" as="font" type="font/woff2" crossorigin>` : ''}<style>${f.css}</style>`);
  }
  // website photos at the size the screen needs, from Roger (the website's file can be the camera original)
  if (o.imageBase) {
    const byId = new Map(input.photos.filter((p) => /^https?:\/\//.test(p.url)).map((p) => [p.id, p]));
    $('img[data-photo]').each((_, el) => {
      const p = byId.get($(el).attr('data-photo') ?? '');
      if (!p) return;
      const set = imageSet(o.imageBase!, o.id, p.id, p.width);
      $(el).attr('src', set.src);
      // a full-screen hero photo is cropped to a portrait screen's height: it needs a copy wider than the screen
      const full = o.kit && $(el).closest('#hero[data-rk-hero="full"]').length > 0;
      if (set.srcset) $(el).attr('srcset', set.srcset).attr('sizes', full ? '(orientation: portrait) 230vw, 100vw' : set.sizes!); else $(el).removeAttr('srcset').removeAttr('sizes');
    });
  }
  // the footer: the business's own top-level pages, its privacy policy (the owner's) and Roger's terms
  const pages = footerPages(listOf(factOf(plan, 'site_pages')), name).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.label)}</a>`);
  const privacy = textOf(factOf(plan, 'privacy_url'));
  const actions = splashActions(plan, input, row), dock = dockActions(actions, row);
  if (o.kit) {
    // the kit's big footer, built from the facts (Claude's footer is replaced)
    const big = kitFooter(plan, input, { name, pages, privacy, main: dock?.main, call: actions.find((a) => a.kind === 'call'), directions: actions.find((a) => a.kind === 'directions') });
    if ($('footer').first().length) $('footer').first().replaceWith(big); else $('body').append(big);
  } else {
    const footer = $('footer').first().length ? $('footer').first() : $('body').append('<footer></footer>').find('footer');
    // inside the footer's own content column when it has one (a wrap or container), so the links line up with the rest
    const column = footer.children('[class*="wrap"],[class*="container"],[class*="inner"],[class*="col"]').last();
    (column.length ? column : footer.addClass('rg-footer-pad')).append(`<nav class="rg-footer-links" aria-label="More">${pages.join(' ')}${privacy ? ` <a href="${esc(privacy)}" target="_blank" rel="noopener">Privacy policy</a>` : ''}</nav>`);
  }
  if (dock) {
    const opts = { ...dock, brand: code.design_tokens.primary ?? input.colours[0] ?? '#1F2937', calm: isCalm(row), minimalContact: minimalContact(row), quoteAction: o.quoteAction, privacyUrl: privacy || undefined, businessName: name };
    $('head').append(`<style>${dockCss(opts)}.rg-footer-links{display:flex;flex-wrap:wrap;gap:0 16px;margin-top:16px;font-size:14px}.rg-footer-links a{display:inline-flex;align-items:center;min-height:44px}footer.rg-footer-pad>.rg-footer-links{padding:0 max(20px,calc((100% - 1200px) / 2))}.rg-footer-links{flex:1 0 100%;grid-column:1/-1}:has(>.rg-footer-links){flex-wrap:wrap}${REVIEWS_BASE_CSS}</style>`);
    $('body').append(dockHtml(opts)).append(sheetHtml(opts)).append(`<script>${DOCK_JS}</script>`);
  }
  // each service names its page on the business's own site (a page of its own, not the home page)
  const pageOf = serviceLinks(plan);
  if (pageOf.size) $('main [data-fact^="service-"], main [data-fact^="item-"]').each((_, el) => {
    const e = $(el), text = e.text(), name = text.split(/\s+[—–-]\s+/)[0].trim(), url = pageOf.get(name.toLowerCase());
    if (!url || e.closest('a').length || e.find('a').length) return;
    e.html(`<a class="rg-svc-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>${esc(text.slice(text.indexOf(name) + name.length))}`);
  });
  // dead links to the business's own pages: a footer link goes, a service keeps its name without the link
  for (const url of o.deadLinks ?? []) $('a').filter((_, e) => $(e).attr('href') === url).each((_, e) => {
    const a = $(e);
    if (a.closest('.rg-footer-links, .rk-footer__links').length) a.closest('li').length ? a.closest('li').remove() : a.remove(); else if (a.hasClass('rg-svc-link')) a.replaceWith(esc(a.text()));
  });
  // directions: Google Maps by default (and with JavaScript off); Apple Maps on an iPhone, iPad or Mac
  const address = textOf(factOf(plan, 'address'));
  if (address) $('a[data-action="directions"], a[data-event="dock_directions"]').attr('data-apple', `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`);
  if (o.kit) {
    // the kit's CSS first (Claude's own rules, later in the head, refine it), and the head's motion flag
    $('head').prepend(`<script>${KIT_HEAD_JS}</script><style id="rk-kit">${kitTokens(code.design_tokens, code.fonts)}${KIT_CSS}</style>`);
    if (isCalm(row)) $('body').attr('data-rk-calm', '1');
    // spread: a collage frame that carries a photo credit moves inside a still slot that keeps its place (with the
    // frame's own classes, so the page's placement still applies) and holds the credit below it; a frame without a
    // credit moves itself
    let slotN = 0;
    $('#hero[data-rk-treatment="spread"] .rk-collage, main section[data-rk-treatment="spread"] .rk-collage').each((_, box) => {
      $(box).children('.rk-frame').each((__, f) => {
        const frame = $(f);
        const credit = frame.find('.gcredit').first();
        if (!credit.length) return;
        const own = (frame.attr('class') ?? '').split(/\s+/).filter((c) => c && c !== 'rk-frame').join(' ');
        frame.wrap(`<div class="rk-slot${own ? ` ${own}` : ''}"></div>`);
        const img = frame.find('img').first();
        const cid = img.attr('data-gcid') ?? `rks${++slotN}`;
        img.attr('data-gcid', cid);
        credit.attr('data-gcredit-for', cid);
        frame.after(credit);
      });
    });
    // unveil and track: a panel over each photo, taken away by the script (none without it)
    $('#hero[data-rk-treatment="unveil"] .rk-frame, main section[data-rk-treatment="unveil"] .rk-frame, main section[data-rk-treatment="track"] .rk-track .rk-frame').each((_, f) => {
      if (!$(f).children('.rk-veil').length && $(f).find('img').length) $(f).append('<span class="rk-veil" aria-hidden="true"></span>');
    });
    // a marquee loops seamlessly: its words twice (the copy hidden from assistive technology), no script needed
    $('.rk-marquee__track').each((_, el) => { const t = $(el); t.append(t.children().clone().attr('aria-hidden', 'true')); });
    $('body').append(kitScripts());
  }
  // the preview ribbon carries this deployment's version at its right end (none on a local run, never on a live page)
  const ver = versionLabel(false);
  if (o.mode === 'preview') $('body').prepend(`<div class="rg-ribbon" aria-hidden="true">${ver ? `<span class="rg-ver">${ver}</span>` : ''}Preview</div>`);
  return $.html();
}

const SOCIAL: [RegExp, string][] = [[/instagram\./, 'Instagram'], [/facebook\./, 'Facebook'], [/tiktok\./, 'TikTok'], [/(twitter|x)\.com/, 'X'], [/linkedin\./, 'LinkedIn'], [/youtube\./, 'YouTube'], [/yelp\./, 'Yelp'], [/pinterest\./, 'Pinterest']];
/**
 * The kit's big footer, from the facts: where (the address and directions), when (the hours), how to reach them (the
 * phone, email and the main action), more (the business's own pages and profiles), then the name set large and the
 * legal line. Every value is a bound fact; the column names are Roger's.
 */
export function kitFooter(plan: SplashPlan, input: FrontendInput, o: { name: string; pages: string[]; privacy?: string; main?: DockAction; call?: DockAction; directions?: DockAction }): string {
  const f = input.facts;
  const btn = (a: DockAction | undefined, style: string) => a ? `<a class="rk-btn" data-rk-style="${style}" data-rk-hover="lift" href="${esc(a.href)}" data-event="footer_${a.kind}"${a.external ? ' target="_blank" rel="noopener"' : ''}>${esc(a.label)}</a>` : '';
  const socials = listOf(factOf(plan, 'same_as')).map((u) => { const label = SOCIAL.find(([re]) => re.test(u))?.[1]; return label ? `<li><a class="rk-link" data-rk-underline="draw" href="${esc(u)}" target="_blank" rel="noopener">${label}</a></li>` : ''; }).filter(Boolean);
  const cols = [
    f.address || o.directions ? `<div><h2>Visit</h2>${f.address ? `<p data-fact="address">${esc(f.address)}</p>` : ''}${o.directions ? `<p><a class="rk-link" data-rk-underline="draw" href="${esc(o.directions.href)}" data-event="footer_directions" target="_blank" rel="noopener">${esc(o.directions.label)}</a></p>` : ''}</div>` : '',
    f.hours ? `<div><h2>Hours</h2><p data-fact="hours">${esc(f.hours)}</p></div>` : '',
    f.phone || f.email || o.main ? `<div><h2>Contact</h2>${f.phone ? `<p data-fact="phone">${esc(f.phone)}</p>` : ''}${f.email ? `<p data-fact="email">${esc(f.email)}</p>` : ''}<div class="rk-footer__actions">${btn(o.main, 'solid')}${o.call && o.call !== o.main ? btn(o.call, 'outline') : ''}</div></div>` : '',
    o.pages.length || socials.length ? `<div><h2>More</h2><ul class="rk-footer__links">${o.pages.map((p) => `<li>${p.replace('<a ', '<a class="rk-link" data-rk-underline="draw" ')}</li>`).join('')}${socials.join('')}</ul></div>` : '',
  ].filter(Boolean).join('');
  return `<footer class="rk-footer"><div class="rk-container"><div class="rk-footer__cols">${cols}</div><p class="rk-footer__wordmark" data-fact="name" aria-hidden="true">${esc(o.name)}</p><div class="rk-footer__legal"><p data-fact="name">${esc(o.name)}</p><nav aria-label="Legal">${o.privacy ? `<a href="${esc(o.privacy)}" target="_blank" rel="noopener">Privacy policy</a>` : ''}<a href="#hero">Back to top</a></nav></div></div></footer>`;
}

/** every check Claude's answer must pass: the compiler's (facts, photos, copy, safety) and the splash page's */
export function splashCodeProblems(code: SplashCode, plan: SplashPlan, input: FrontendInput, o: { kit?: boolean; motionDirection?: boolean; treatments?: boolean } = {}): string[] {
  const row = tradeRow(plan.trade.row);
  return [...checkCode({ idea: code.idea, html: code.html, css: code.css, fonts: code.fonts }, input, { required: requiredFacts(input), minPhotos: Math.min(1, input.photos.length), requireAction: true, page: 'home' }), ...splashProblems(code, plan, row),
    ...(o.kit ? kitProblems(code, input, isCalm(row), o.motionDirection, o.treatments ? plan.screen_plan.screens.map((x) => x.screen) : undefined) : [])];
}

/** the motion choices recorded with a page: the hero's treatment and one important section's, each with its reason */
export interface MotionChoice { hero: { treatment: Treatment; reason: string }; section: { screen: string; treatment: Treatment; reason: string } | null }

/** why a treatment cannot run on this markup (undefined: it can) */
function treatmentMisfit($: CheerioAPI, scope: Cheerio<AnyNode>, k: string, isHero: boolean): string | undefined {
  if (!(TREATMENTS as readonly string[]).includes(k)) return `"${k}" is not a treatment`;
  const framed = (sel: string) => scope.find(sel).filter((_, f) => $(f).find('img[data-photo],img[data-gphoto]').length > 0).length;
  if (k === 'spread') { const n = framed('.rk-collage > .rk-frame, .rk-collage > .rk-slot > .rk-frame'); if (n < 3) return `spread needs a collage of three or more photos (found ${n})`; }
  if (k === 'unveil' && !framed('.rk-frame')) return 'unveil needs a photo in a frame';
  if (k === 'track') {
    if (isHero) return 'track is for a work or product section, not the hero';
    const n = scope.find('.rk-track').first().children().length;
    if (n < 3) return `track needs a .rk-track row of three or more items (found ${n})`;
  }
  return undefined;
}

/**
 * Settles a page's motion choices with its markup. The markup decides (data-rk-treatment on #hero and on at most one
 * other section); the recorded choice fills a missing attribute. A choice the markup cannot carry becomes the subtle
 * reveal, and each such repair is reported. A calm trade's page stays still. Inside a moving scope the elements'
 * own data-rk-anim give way to the treatment (two motions never fight over one photo).
 */
export function settleMotion(code: SplashCode, opts: { calm?: boolean } = {}): { code: SplashCode; motion: MotionChoice; repairs: string[] } {
  const $ = load(code.html, {}, false);
  const repairs: string[] = [];
  const rec = code.motion;
  const hero = $('#hero');
  if (opts.calm) {
    if ($('[data-rk-treatment]').length) repairs.push('Motion treatments removed: this is a calm trade, so the page stays still.');
    $('[data-rk-treatment]').removeAttr('data-rk-treatment');
    return { code: { ...code, html: $.html(), motion: { hero: { treatment: 'subtle', reason: 'A calm trade: no motion.' }, section: null } }, motion: { hero: { treatment: 'subtle', reason: 'A calm trade: no motion.' }, section: null }, repairs };
  }
  const settle = (scope: Cheerio<AnyNode>, chosen: string, isHero: boolean, where: string): Treatment => {
    const misfit = treatmentMisfit($, scope, chosen, isHero);
    if (misfit) { repairs.push(`${where}: ${misfit}, so it uses the subtle reveal.`); scope.attr('data-rk-treatment', 'subtle'); return 'subtle'; }
    scope.attr('data-rk-treatment', chosen);
    // the treatment moves these: their own animations give way
    const owned = chosen === 'spread' ? scope.find('.rk-collage, .rk-collage *') : chosen === 'unveil' ? scope.find('.rk-frame, .rk-frame *') : chosen === 'track' ? scope.find('.rk-track, .rk-track *') : $();
    const own = owned.filter('[data-rk-anim]');
    if (own.length) { own.removeAttr('data-rk-anim').removeAttr('data-rk-delay'); repairs.push(`${where}: ${own.length} element animation(s) inside the ${chosen} gave way to it.`); }
    return chosen as Treatment;
  };
  const heroChoice = hero.attr('data-rk-treatment') ?? rec?.hero?.treatment ?? 'subtle';
  const heroT = hero.length ? settle(hero, heroChoice, true, 'Hero') : 'subtle';
  // one important section: the one marked (or the one recorded); others lose the mark
  const marked = $('main section[data-rk-treatment]').not('#hero');
  let section = rec?.section?.screen ? marked.filter((_, e) => $(e).attr('id') === rec.section!.screen) : $();
  if (!section.length) section = marked.first();
  if (!section.length && rec?.section?.screen) section = $(`main section#${rec.section.screen.replace(/[^a-z0-9_-]/gi, '')}`).not('#hero');
  marked.not(section).each((_, e) => { repairs.push(`Only one section gets its own treatment: #${$(e).attr('id')} uses the subtle reveal.`); $(e).removeAttr('data-rk-treatment'); });
  let sectionChoice: MotionChoice['section'] = null;
  if (section.length) {
    const id = section.attr('id') ?? '';
    const t = settle(section.first(), section.attr('data-rk-treatment') ?? rec?.section?.treatment ?? 'subtle', false, `#${id}`);
    sectionChoice = { screen: id, treatment: t, reason: rec?.section?.reason ?? '' };
  }
  if (rec?.hero?.treatment && rec.hero.treatment !== heroT && !repairs.some((r) => r.startsWith('Hero'))) repairs.push(`Hero: recorded as ${rec.hero.treatment}, marked ${heroT} in the page: the page's mark is used.`);
  const motion: MotionChoice = { hero: { treatment: heroT, reason: rec?.hero?.reason ?? '' }, section: sectionChoice };
  return { code: { ...code, html: $.html(), motion }, motion, repairs };
}

const KIT_VALUES: Record<string, readonly string[]> = {
  'data-rk-hero': HERO_VARIANTS, 'data-rk-style': ['solid', 'outline', 'glass', 'light'], 'data-rk-hover': ['sweep', 'lift', 'fill', 'glow', 'shine', 'arrow', 'magnetic'],
  'data-rk-underline': ['draw', 'slide', 'highlight'], 'data-rk-depth': ['1', '2', '3'], 'data-rk-tilt': ['', 'true'], 'data-rk-nav': ['glass', 'over'], 'data-rk-cols': ['2', '3', '4'],
  'data-rk-anim': ['fade-up', 'fade', 'scale', 'slide-left', 'slide-right', 'stagger', 'words', 'parallax', 'count'], 'data-rk-sequence': HERO_SEQUENCES, 'data-rk-treatment': TREATMENTS, 'data-rk-speed': [],
};
/** the kit used as the kit expects: known values, a hero layout that suits the photos it has, no scripts of Claude's own */
export function kitProblems(code: SplashCode, input: FrontendInput, calm = false, requireSequence = false, screens?: string[]): string[] {
  const errors: string[] = [];
  const $ = load(code.html, {}, false);
  // the motion choices, recorded with their reasons (a page made with treatments)
  if (screens && !calm) {
    const m = code.motion;
    const why = (r?: string) => (r ?? '').trim().length >= 20;
    if (!m?.hero?.treatment || !why(m.hero.reason)) errors.push(`Record the hero's motion in "motion": {"hero": {"treatment": "${TREATMENTS.join('|')}", "reason": "…"}} with a reason from this business's words, photo subjects or visitor task.`);
    if (!m?.section?.screen || !m.section.treatment || !why(m.section.reason)) errors.push(`Record one important section's motion in "motion": {"section": {"screen": "<a planned screen>", "treatment": "${TREATMENTS.join('|')}", "reason": "…"}}.`);
    else if (m.section.screen === 'hero' || !screens.includes(m.section.screen)) errors.push(`motion.section.screen "${m.section.screen}" must be one of the planned screens other than the hero: ${screens.filter((x) => x !== 'hero').join(', ')}.`);
  }
  if (calm && $('[data-rk-anim]').length) errors.push('This is a calm trade: no data-rk-anim motion; let the page be still.');
  if (calm && $('[data-rk-hover="magnetic"],[data-rk-tilt]').length) errors.push('This is a calm trade: quiet hovers only (lift or fill), no magnetic buttons or tilting cards.');
  $('*').each((_, el) => {
    if (!('attribs' in el)) return;
    for (const [a, v] of Object.entries(el.attribs)) {
      if (!a.startsWith('data-rk-')) continue;
      if (a === 'data-rk-delay') { if (!/^(0|0?\.\d{1,2}|1(\.[0-5])?)$/.test(v)) errors.push(`data-rk-delay="${v}" must be a number of seconds from 0 to 1.5.`); continue; }
      if (a === 'data-rk-speed') { if (!/^(slow|normal|fast)$/.test(v)) errors.push(`data-rk-speed="${v}" must be slow, normal or fast.`); continue; }
      const allowed = KIT_VALUES[a];
      if (!allowed) errors.push(`${a} is not part of the kit.`);
      else if (allowed.length && !allowed.includes(v)) errors.push(`${a}="${v}" must be one of: ${allowed.join(', ')}.`);
    }
  });
  const hero = $('#hero');
  const variant = hero.attr('data-rk-hero');
  if (!variant) errors.push(`Give the hero section a layout: data-rk-hero="${HERO_VARIANTS.join('|')}".`);
  if (requireSequence && !calm && !hero.attr('data-rk-sequence')) errors.push(`Choose the hero's business-specific motion order: data-rk-sequence="${HERO_SEQUENCES.join('|')}".`);
  if (calm && hero.attr('data-rk-sequence')) errors.push('This is a calm trade: leave data-rk-sequence off the hero.');
  if (requireSequence && hero.find('.rk-hero__copy[data-rk-anim],.rk-hero__actions[data-rk-anim],.rk-hero__actions [data-rk-anim]').length) errors.push('Keep the hero actions visible immediately: animate the headline or media, not the whole copy or actions.');
  if ($('[data-rk-anim="count"]').filter((_, el) => {
    const e = $(el);
    return e.is('[data-google],[data-fact]') || !!e.closest('[data-google],[data-fact]').length || !!e.find('[data-google],[data-fact]').length;
  }).length) errors.push('Keep verified numbers still: do not count up Google ratings, review counts or bound facts.');
  const heroPhotos = hero.find('img[data-photo]').length;
  if (variant === 'full' && heroPhotos !== 1) errors.push('A full hero has exactly one photo, in .rk-hero__media.');
  if (variant === 'collage' && heroPhotos < 3) errors.push(`A collage hero needs at least three photos (it has ${heroPhotos}); with fewer, choose split, full or type.`);
  if (variant === 'collage' && input.photos.length < 3) errors.push('There are fewer than three photos: choose split, full or type for the hero.');
  if ((variant === 'full' || variant === 'split' || variant === 'marquee') && !input.photos.length) errors.push('There are no photos: choose the type hero.');
  if (variant === 'marquee' && !hero.find('.rk-marquee__track').length) errors.push('A marquee hero has a .rk-marquee > .rk-marquee__track of .rk-marquee__item words.');
  if (hero.find('[data-rk-anim="words"]').find('[data-fact],[data-google],a,img').length) errors.push('data-rk-anim="words" goes on plain text only (a headline of your own words), never around bindings.');
  return errors;
}
export type { DockKind };
