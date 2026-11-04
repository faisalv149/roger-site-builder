import fs from 'node:fs';
import sharp from 'sharp';
import { findAddresses } from '../address.js';
import type { Catalog } from './review.js';
import type { PageMetrics, Rendered } from './render.js';
import { isListing } from './listing-photos.js';
import type { Check, Concept } from './types.js';

/**
 * Checks on rendered concepts, from what Chrome actually drew:
 *   grounding  every phone number, email, address, price and number on the page is a fact the catalog allows;
 *              nothing the preview must leave out (a disputed number, a held action, an unconfirmed price) appears
 *   rights     every picture is one of the business's own website photos copied into the set, or a Google listing photo
 *              as a stand-in with its credit slot, filled live when served (never copied)
 *   photos     usable photos and none shown fails; none usable at all needs review (the owner's photos are needed)
 *   links      every link goes to a catalog action, a section on the page, or the business's phone or email
 *   a11y       text contrast (worst case over photographs), tap targets, alt text, one h1, heading order, no sideways scroll
 *   distinct   (for the set) the first screens and the whole pages differ, measured on the screenshots' structure
 */

const digits = (s: string) => s.replace(/\D/g, '');
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MONEY = /\$\s?\d+(?:[.,]\d{2})?|\b\d{1,3}\.\d{2}\b/g;
const amounts = (s: string) => (s.match(/\$\s?\d+(?:[.,]\d{2})?|\d+[.,]\d{2}/g) ?? []).map((x) => Number(x.replace(/[$\s]/g, '').replace(',', '.')).toFixed(2));

export function grounding(m: PageMetrics, cat: Catalog): Check {
  const errs: string[] = [];
  let text = m.text;
  const allowedPhone = cat.phone ? digits(cat.phone.display).slice(-10) : null;
  for (const p of text.match(PHONE) ?? []) if (digits(p).slice(-10) !== allowedPhone) errs.push(`phone number "${p}" is not the business's agreed number`);
  for (const f of cat.forbidden.phones) if (digits(text).includes(digits(f).slice(-10))) errs.push(`the disputed number ${f} appears`);
  text = text.replace(PHONE, ' ');
  for (const e of text.match(EMAIL) ?? []) if (e.replace(/[.,]$/, '') !== cat.email) errs.push(`email "${e}" is not the business's`);
  text = text.replace(EMAIL, ' ');
  // prices: each printed against its item, and only where the catalog allows one
  const allowedPrices = new Set(cat.items.filter((i) => i.price).flatMap((i) => amounts(i.price!)));
  for (const p of m.prices) {
    const it = cat.items.find((i) => i.id === p.item);
    if (!it?.price) errs.push(`a price is shown for ${it?.name ?? p.item}, which has no confirmed price`);
    else if (amounts(p.text).join() !== amounts(it.price).join()) errs.push(`${it.name} shows "${p.text}"; its price is "${it.price}"`);
  }
  for (const f of cat.forbidden.prices) if (m.prices.some((p) => p.item === f.itemId)) errs.push(`an unconfirmed price is shown (${f.itemId})`);
  for (const p of text.match(MONEY) ?? []) if (!amounts(p).every((a) => allowedPrices.has(a))) errs.push(`price "${p}" is not a confirmed price`);
  text = text.replace(MONEY, ' ');
  // an address is one of the business's when its ZIP and street number are one location's (page text runs together, so the street may carry words before it)
  for (const a of findAddresses(text)) if (!cat.locations.some((l) => l.cityLine.endsWith(a.zip) && a.street.split(/\s+/).includes(l.street.split(/\s+/)[0]))) errs.push(`address "${a.formatted}" is not one of the business's locations`);
  // every other number must be one the catalog states (a rating, a count, a time, a street number)
  const corpus = cat.allowedText.replace(/\s+/g, ' ');
  for (const raw of text.match(/\d[\d,.:]*/g) ?? []) { const n = raw.replace(/[.,:]+$/, ''); if (!corpus.includes(n) && !corpus.includes(n.replace(/,/g, ''))) errs.push(`the number "${n}" is not a fact in the brief`); }
  const out = [...new Set(errs)];
  return { id: 'grounding', level: out.length ? 'fail' : 'pass', message: out.length ? `${out.length} statement(s) on the page are not grounded` : 'Every number, phone, email, address and price on the page is a fact the catalog allows; nothing left out appears.', ...(out.length ? { details: out.slice(0, 20) } : {}) };
}

export function rights(m: PageMetrics, cat: Catalog, concept: Concept, html = ''): Check {
  const errs: string[] = [];
  const own = new Set(cat.photos.map((p) => p.id));
  const listing = new Set(cat.photos.filter(isListing).map((p) => p.id));
  for (const i of m.images) {
    // Google's photos may not be stored or rehosted: a saved page carries only a stand-in, filled in when served
    if (/google-photo:|googleusercontent|maps\.googleapis|places\.googleapis/.test(i.src)) errs.push(`a Google photo was copied or linked into the saved page (${i.src.slice(0, 60)})`);
    else if (i.asset && listing.has(i.asset)) {
      if (!/^data:image\/svg/.test(i.src)) errs.push(`Google listing photo ${i.asset} is not a stand-in filled at serve time`);
    } else if (!i.asset || (i.asset !== 'logo' && !own.has(i.asset))) errs.push(`picture ${i.src} is not one of the business's own website photos`);
    else if (!/^img\//.test(i.src)) errs.push(`picture ${i.asset} is not served from the set's own copy`);
    if (!i.ok) errs.push(`picture ${i.src.slice(0, 60)} did not load`);
  }
  // each Google photo has its credit slot beside it (photographer and Google Maps, filled when served)
  for (const m2 of html.matchAll(/data-gphoto="([^"]+)"/g)) if (!html.includes(`data-gcredit="${m2[1]}"`)) errs.push(`Google photo ${m2[1]} has no credit beside it`);
  const used = new Set(m.images.map((i) => i.asset).filter((x): x is string => !!x && x !== 'logo'));
  for (const id of used) if (!concept.images.includes(id) && !cat.services.some((s) => s.imageId === id)) errs.push(`picture ${id} is on the page but not recorded in the concept`);
  const g = [...used].filter((id) => listing.has(id)).length;
  return { id: 'rights', level: errs.length ? 'fail' : 'pass', message: errs.length ? `${errs.length} picture problem(s)` : `${used.size - g} of the business's own website photos (copied into the preview; to be approved by the owner before publishing)${g ? `; ${g} Google listing photo(s) shown live with their photographers' credit and Google Maps attribution (preview only, never published)` : '; no Google photos'}.`, ...(errs.length ? { details: errs } : {}) };
}

/**
 * Photos available and none on the page is a failure, never a clean success; no usable photos at all is a warning
 * (the concept is not finished: the owner's photos are needed).
 */
export function photosShown(m: PageMetrics, cat: Catalog, available: number): Check {
  const shown = new Set(m.images.map((i) => i.asset).filter((x): x is string => !!x && x !== 'logo')).size;
  if (!available) return { id: 'photos', level: 'review', message: 'No usable photos: neither the website nor the Google listing gave one that fits. This concept needs photos from the owner before it is finished.' };
  if (!shown) return { id: 'photos', level: 'fail', message: `${available} usable photo(s) available, but this concept shows none.` };
  return { id: 'photos', level: 'pass', message: `${shown} of ${available} usable photo(s) shown.` };
}

export function links(m: PageMetrics, cat: Catalog): Check {
  const errs: string[] = [];
  const ids = new Set(m.ids);
  const actions = new Map(cat.actions.map((a) => [a.id, a]));
  for (const l of m.links) {
    if (l.href.startsWith('#')) { if (l.href.length > 1 && !ids.has(l.href.slice(1))) errs.push(`"${l.text}" points to #${l.href.slice(1)}, which is not on the page`); continue; }
    if (cat.forbidden.hrefs.includes(l.href)) { errs.push(`"${l.text}" is an action held until the owner answers (${l.href})`); continue; }
    if (/^tel:/.test(l.href)) { if (l.href !== cat.phone?.href) errs.push(`"${l.text}" calls ${l.href}, not the business's agreed number`); continue; }
    if (/^mailto:/.test(l.href)) { if (l.href !== `mailto:${cat.email}`) errs.push(`"${l.text}" emails ${l.href}`); continue; }
    const a = l.action ? actions.get(l.action) : undefined;
    if (a?.kind === 'directions' && a.factId !== cat.address?.id && l.fact !== a.factId) {
      const where = cat.locations.find((x) => x.id === a.factId)?.street ?? a.factId;
      errs.push(`"${l.text}" in the ${l.where === 'body' ? 'page' : l.where === 'head' ? 'header' : l.where} sends visitors to one location (${where}) though no main location is chosen; it belongs on that location's card, and a page-level action opens the list of locations`);
      continue;
    }
    if (!a) errs.push(`"${l.text}" (${l.href}) is not one of the business's actions`);
    else if (a.href !== l.href) errs.push(`"${l.text}" should go to ${a.href}, not ${l.href}`);
  }
  return { id: 'links', level: errs.length ? 'fail' : 'pass', message: errs.length ? `${errs.length} link problem(s)` : `${m.links.length} links, each to a section of the page or one of the business's own actions.`, ...(errs.length ? { details: [...new Set(errs)] } : {}) };
}

/** A picture shown with a service or a menu section must be the one tied to it: the website's own picture for that service, or the owner's choice. */
export function imagery(m: PageMetrics, cat: Catalog): Check {
  const errs: string[] = [];
  let paired = 0;
  for (const i of m.images.filter((x) => x.fact)) {
    const svc = cat.services.find((s) => s.id === i.fact);
    const sec = i.fact!.startsWith('section:') ? cat.sectionImages[i.fact!] : undefined;
    const allowed = svc ? svc.imageId : sec;
    const label = svc ? svc.name : i.fact!.replace(/^section:/, '') || i.fact!;
    if (!allowed) errs.push(`${label} shows a picture (${i.asset}) though nothing ties a picture to it`);
    else if (i.asset !== allowed) errs.push(`${label} shows ${i.asset}, not its own picture (${allowed})`);
    else paired++;
  }
  return { id: 'imagery', level: errs.length ? 'fail' : 'pass', message: errs.length ? `${errs.length} picture(s) shown with content they are not tied to` : `${paired} picture(s) shown with a service or menu section, each its own (from the website or the owner); the rest have none`, ...(errs.length ? { details: errs } : {}) };
}

export function accessibility(d: PageMetrics, mob: PageMetrics): Check {
  const errs: string[] = [];
  for (const [label, m] of [['desktop', d], ['mobile', mob]] as const) {
    for (const c of m.contrast.filter((x) => x.ratio < x.required)) errs.push(`${label}: "${c.text}" has contrast ${c.ratio}:1 (needs ${c.required}:1)`);
    for (const t of m.targets.filter((x) => x.h < 44 || x.w < 44)) errs.push(`${label}: "${t.text}" is ${t.w}×${t.h}px (tap targets need 44×44)`);
    if (m.h1 !== 1) errs.push(`${label}: ${m.h1} h1 headings (one expected)`);
    if (m.overflowX > 0) errs.push(`${label}: the page scrolls sideways by ${m.overflowX}px`);
    for (const w of m.spills ?? []) errs.push(`${label}: "${w}" spills out of its box`);
    for (const w of m.brokenWords ?? []) errs.push(`${label}: a heading breaks the word "${w}" across two lines`);
  }
  for (const i of d.images.filter((x) => !x.alt.trim())) errs.push(`picture ${i.src} has no alt text`);
  for (let i = 1; i < d.headingLevels.length; i++) if (d.headingLevels[i] > d.headingLevels[i - 1] + 1) { errs.push(`heading levels skip from h${d.headingLevels[i - 1]} to h${d.headingLevels[i]}`); break; }
  if (d.lang !== 'en') errs.push('the page has no language');
  if (!d.skipLink) errs.push('no skip link');
  const out = [...new Set(errs)];
  const n = d.contrast.length + mob.contrast.length;
  return { id: 'accessibility', level: out.length ? 'fail' : 'pass', message: out.length ? `${out.length} accessibility problem(s)` : `${n} text runs meet WCAG AA contrast (worst case over photos); every tap target is at least 44×44; alt text, one h1, heading order and no sideways scroll on mobile.`, ...(out.length ? { details: out.slice(0, 20) } : {}) };
}

export function checkConcept(concept: Concept, r: Rendered, cat: Catalog, availablePhotos = cat.photos.length): Check[] {
  const html = fs.existsSync(r.html) ? fs.readFileSync(r.html, 'utf8') : '';
  return [grounding(r.desktop.metrics, cat), grounding(r.mobile.metrics, cat), rights(r.desktop.metrics, cat, concept, html), links(r.desktop.metrics, cat), links(r.mobile.metrics, cat), imagery(r.desktop.metrics, cat), photosShown(r.desktop.metrics, cat, availablePhotos), accessibility(r.desktop.metrics, r.mobile.metrics)]
    .reduce<Check[]>((acc, c) => { const prev = acc.find((x) => x.id === c.id); if (!prev) acc.push(c); else if (c.level === 'fail') { prev.level = 'fail'; prev.message = c.message; prev.details = [...new Set([...(prev.details ?? []), ...(c.details ?? [])])]; } return acc; }, []);
}

// ───────────────────────── visual distinctness from the screenshots ─────────────────────────
/**
 * Structure, not colour: each screenshot is reduced to greyscale, then to an edge map (where things start and stop:
 * text blocks, photo edges, panels). Two pages built from the same template in different colours keep their edges in
 * the same places, so their maps correlate strongly; different compositions do not.
 */
async function edges(file: string, w: number, h: number, crop?: { width: number; height: number }): Promise<Float64Array> {
  let img = sharp(file);
  if (crop) {
    // only the first screen's own composition (header and hero), not the next section peeking in below it
    const m = await sharp(file).metadata();
    const scale = m.width! / crop.width;
    img = sharp(file).extract({ left: 0, top: 0, width: m.width!, height: Math.max(1, Math.min(m.height!, Math.round(crop.height * scale))) });
  }
  const { data } = await img.greyscale().resize(w, h, { fit: 'fill' }).blur(0.6).raw().toBuffer({ resolveWithObject: true });
  const g = (x: number, y: number) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) + g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
    const gy = -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) + g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
    out[y * w + x] = Math.hypot(gx, gy);
  }
  return out;
}
const pearson = (a: Float64Array, b: Float64Array) => {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 1;
};
/**
 * Calibrated on negative controls (out/qa/studio-phase2/calibrate.mts, and the tests): concept A with its sections
 * reordered scores 0.998 / 1.0 on the first screens; A recoloured with another concept's tokens 0.57 / 0.92 and 0.59
 * on the whole page. Real pairs from the library score 0.05–0.42. A pair is distinct only if all three are below.
 */
export const THRESHOLDS = { heroDesktop: 0.5, heroMobile: 0.55, page: 0.5 };
/** the first screen down to the end of the hero: the shorter of the two, so both crops cover the same rows */
const heroBox = (a: Rendered, b: Rendered, kind: 'desktop' | 'mobile') => {
  const end = (r: Rendered) => { const s = r[kind].metrics.sections[0]; return s ? s.top + s.height : r[kind].metrics.height; };
  return { width: kind === 'desktop' ? 1440 : 390, height: Math.min(kind === 'desktop' ? 900 : 844, end(a), end(b)) };
};
export async function similarity(a: Rendered, b: Rendered) {
  const hdBox = heroBox(a, b, 'desktop'), hmBox = heroBox(a, b, 'mobile');
  const [hd, hm, pg] = await Promise.all([
    Promise.all([edges(a.desktop.hero, 96, 60, hdBox), edges(b.desktop.hero, 96, 60, hdBox)]),
    Promise.all([edges(a.mobile.hero, 39, 84, hmBox), edges(b.mobile.hero, 39, 84, hmBox)]),
    Promise.all([edges(a.desktop.full, 48, 200), edges(b.desktop.full, 48, 200)]),
  ]);
  return { heroDesktop: +pearson(...hd).toFixed(3), heroMobile: +pearson(...hm).toFixed(3), page: +pearson(...pg).toFixed(3) };
}

/** Pairwise: the plans differ (hero, offer, structure, voice, colour), and the screenshots differ in structure. */
export async function distinctness(concepts: Concept[], rendered: Rendered[]) {
  const pairs: { a: string; b: string; plan: string[]; heroDesktop: number; heroMobile: number; page: number; pass: boolean }[] = [];
  for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length; j++) {
    const A = concepts[i], B = concepts[j];
    const axes = (Object.keys(A.axes) as (keyof Concept['axes'])[]).filter((k) => A.axes[k] !== B.axes[k]);
    const offer = (c: Concept) => c.sections.find((s) => s.kind === 'offer')?.variant;
    const plan = [...axes, ...(offer(A) !== offer(B) ? ['offer layout'] : []), ...(A.sections.map((s) => s.kind).join() !== B.sections.map((s) => s.kind).join() ? ['section order'] : [])];
    const s = await similarity(rendered[i], rendered[j]);
    const pass = axes.includes('heroComposition') && plan.length >= 4 && s.heroDesktop < THRESHOLDS.heroDesktop && s.heroMobile < THRESHOLDS.heroMobile && s.page < THRESHOLDS.page;
    pairs.push({ a: A.id, b: B.id, plan, ...s, pass });
  }
  return { pairs, thresholds: { ...THRESHOLDS } };
}
