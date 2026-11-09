import type { BusinessBrief } from '../schema.js';
import type { Catalog, Photo } from './review.js';
import { STRUCTURES, type DirectionAxes, type DirectionPlan, type DirectionRanking, type HeaderStyle, type FooterStyle, type Recipe, type SectionKind, type Shell } from './types.js';

/**
 * The direction library: whole-site design directions, each a recipe over the section library (its own hero, offer
 * treatment, header, footer and page order) with what it needs from a business and how well a business fits it.
 * The planner ranks the directions a business can support, drops weak ones and near-duplicates, and keeps up to
 * maxDirections(): adding a direction here is how the choice grows; nothing counts to three.
 *
 * Every recipe is checked against the same verified catalog: a direction that needs a story, a strong landscape photo
 * or opening hours the business doesn't have is left out with the reason, never faked.
 */

export const LIBRARY_VERSION = 'directions-2';

/** How many directions a set may hold: STUDIO_MAX_DIRECTIONS (default 5), never more than the library has. */
export const maxDirections = () => Math.max(1, Math.min(DIRECTIONS.length, 26, Number(process.env.STUDIO_MAX_DIRECTIONS) || 5));
/** a concept's id by rank: a, b, c, d, e, … */
export const conceptLetter = (i: number) => String.fromCharCode(97 + i);

/** The header and footer each hero belongs with: a direction is a whole site, so its shell follows its hero. */
const SHELLS: Record<string, Shell> = {
  'full-bleed': { header: 'overlay', footer: 'standard' },
  split: { header: 'bar', footer: 'standard' },
  'type-collage': { header: 'center', footer: 'standard' },
  masthead: { header: 'masthead', footer: 'colophon' },
  desk: { header: 'utility', footer: 'utility' },
};
export const shellFor = (hero: string | undefined): Shell => SHELLS[hero ?? ''] ?? { header: 'bar', footer: 'standard' };
/** a concept's shell: its recipe's, or (for concepts from before recipes) the one its hero belongs with */
export const shellOf = (c: { recipe?: { shell: Shell }; sections: { kind: string; variant: string }[] }): { header: HeaderStyle; footer: FooterStyle } => c.recipe?.shell ?? shellFor(c.sections.find((s) => s.kind === 'hero')?.variant);

// ───────────────────────── what the business has content for ─────────────────────────
export function available(cat: Catalog): Record<SectionKind, boolean> {
  return {
    hero: true,
    offer: cat.services.length > 0 || cat.items.length > 0,
    proof: !!cat.rating || cat.claims.length + cat.pledges.length > 0,
    gallery: cat.photos.length >= 6,
    story: !!cat.story,
    contact: true,
  };
}
type Structure = (typeof STRUCTURES)[number];
export const LEAD: Record<Structure, SectionKind> = { 'offer-first': 'offer', 'story-first': 'story', 'proof-first': 'proof', 'visit-first': 'contact', 'gallery-first': 'gallery' };

// ───────────────────────── lead evidence: what a photo shows, what the customer came to do, where ─────────────────────────
/**
 * The customer's likely task. A business that lists a service area works at the customer's property: people ask it for
 * work ('on-site'). Otherwise people come to it, to eat, be treated or shop ('visit').
 */
export type Journey = 'visit' | 'on-site';
/**
 * Evidence that the business works at the customer's property, in its own words: an on-site phrase in its services,
 * claims, story or actions ("your roof", "free roof inspection", "we come to you", "house calls"). A service area alone
 * is not evidence: a bakery that delivers or a shop with a catchment area lists one too.
 */
const ON_SITE = /\b(?:on[- ]site|in[- ]home|at your (?:home|house|property|door|business|office)|your (?:home|house|property|roof|yard|lawn|driveway|gutters?|attic|crawl ?space)|we come to you|come to you|house calls?|mobile (?:service|repair|detailing|mechanic)|service calls?|free (?:roof |home |in-home )?(?:inspection|estimate|quote|assessment)s?|roof (?:inspection|replacement|repair)s?)\b/i;
export function onSiteEvidence(cat: Catalog): string | undefined {
  const sources: [string, string][] = [
    ...cat.actions.map((a): [string, string] => [a.label, `its action "${a.label}"`]),
    ...cat.services.map((v): [string, string] => [`${v.name} ${v.description ?? ''}`, `its service "${v.name}"`]),
    ...[...cat.claims, ...cat.pledges].map((c): [string, string] => [c.text, `its claim "${c.text}"`]),
    [cat.story?.text ?? '', 'its story'],
  ];
  for (const [text, where] of sources) { const m = text.match(ON_SITE); if (m) return `${where} says "${m[0]}"`; }
  return undefined;
}
export const journeyOf = (cat: Catalog): Journey => (cat.area?.length && onSiteEvidence(cat) ? 'on-site' : 'visit');

const GENERIC = new Set(['img', 'jpg', 'jpeg', 'png', 'webp', 'preview', 'scaled', 'picture', 'photo', 'image', 'optimized', 'main', 'the', 'and', 'with', 'from', 'for', 'during', 'project', 'details', 'detail', 'service', 'services', 'gallery', 'portfolio', 'work', 'before', 'after', 'new', 'our', 'your', 'repair', 'repairs', 'repairing', 'replacement', 'installation', 'install', 'inspection', 'inspections', 'maintenance', 'cleaning', 'assistance', 'session', 'general', 'residential', 'commercial', 'slideshow', 'slide', 'number', 'banner', 'header', 'untitled', 'copy', 'final', 'edit', 'edited', 'web', 'site', 'website', 'home', 'page']);
// plural -es only after s, x, z, ch, sh ("dishes", "boxes"); "cakes" and "cake" stay one word
const stem = (w: string) => w.replace(/(?:ings|ing|ers|er|ors|or|ics|ic)$/, '').replace(/(ss|sh|ch|x|z)es$/, '$1').replace(/([^s])s$/, '$1');
const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !GENERIC.has(w)).map(stem).filter((w) => w.length >= 3);
/** what a visitor comes to: the place itself is the subject of a photo for a business people visit */
const PLACE = new Set(['location', 'interior', 'patio', 'dining', 'storefront', 'shop', 'trailer', 'truck', 'bus', 'van', 'counter', 'lobby', 'office', 'clinic', 'studio', 'salon', 'restaurant', 'cafe', 'bar', 'room', 'entrance', 'front'].map(stem));

/**
 * The business's subject: what its category says it is, and the services that share the category's words (a roofing
 * contractor's roof services, a chiropractor's chiropractic adjustment). For a menu business, the menu's own words.
 */
function subjectOf(cat: Catalog) {
  const category = new Set(words(cat.business.category ?? ''));
  const core = cat.services.filter((s) => words(s.name).some((w) => category.has(w)));
  const coreNames = new Set(core.map((s) => s.name));
  // a menu's subject is what its dishes are (each name's head noun: "taco", "juice") and its sections, never the words
  // that name them ("La Reyna Taco"), which may also be a person's name in a photo's description
  const heads = cat.items.map((i) => words(i.name).at(-1)).filter((w): w is string => !!w);
  const dishes = heads.filter((w, i) => heads.indexOf(w) !== i);
  // a category that names none of the services ("Plumber" beside "Drain Cleaning"): every service is the subject, in the
  // words of its own verified description ("main-line drains cleared", "under a kitchen sink")
  const described = core.length ? [] : cat.services.flatMap((s) => [...words(s.name), ...words(s.description ?? '')]);
  const tiedOfferings = cat.services.length ? [] : cat.photos.flatMap((p) => p.services.flatMap((n) => words(n)));
  const subject = new Set([...category, ...core.flatMap((s) => words(s.name)), ...described, ...tiedOfferings, ...dishes, ...cat.items.flatMap((i) => words(i.section ?? ''))]);
  // the brand: the name's first distinctive word ("Veracruz", "Caliber"); a photo that names it shows the business itself
  const brand = words(cat.business.name).find((w) => !category.has(w));
  return { subject, coreNames, brand, anyCore: core.length > 0, dishes: new Set(dishes) };
}
export type PhotoRole = { role: 'subject' | 'unknown' | 'off'; why: string; food?: boolean };
const onMenuPage = (u: string) => { try { return /\bmenus?\b/i.test(new URL(u).pathname); } catch { return false; } };
/**
 * Menu art: an undescribed image that appears only on the business's menu page and is named for what the menu holds
 * ("VAN+Tacos3" beside a "Tacos" menu). It shows the menu, not the place or a dish being served: it belongs in the
 * menu section and never leads the page.
 */
export function menuArt(p: Photo, cat: Catalog): boolean {
  if (!cat.items.length || p.alt.trim() || !p.pages?.length || !p.pages.every(onMenuPage)) return false;
  const file = decodeURIComponent(p.url.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  const s = subjectOf(cat);
  return words(file).some((w) => s.subject.has(w));
}
/**
 * A photo's role as a lead image, from its own evidence (the service the website ties it to, its alt text, its file name):
 * 'subject' shows what the business is; 'off' shows something else (another service, a scene); 'unknown' says nothing.
 * A lead image is a subject photo, or an unknown one when there is none; an off-subject photo never leads.
 */
export function photoRole(p: Photo, cat: Catalog, journey: Journey = journeyOf(cat)): PhotoRole {
  const s = subjectOf(cat);
  if (p.services.length) {
    const core = p.services.find((x) => s.coreNames.has(x) || cat.services.find((v) => v.id === x && s.coreNames.has(v.name)));
    if (core || !s.anyCore) return { role: 'subject', why: `tied to the service ${core ?? p.services[0]}` };
    return { role: 'off', why: `tied to ${p.services.join(', ')}, not the business's core service` };
  }
  const file = decodeURIComponent(p.url.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  const said = words(`${p.alt} ${file}`);
  const quote = (p.alt || file).slice(0, 70);
  if (menuArt(p, cat)) return { role: 'off', why: `menu art ("${quote}", only on the menu page): it goes in the menu section` };
  // a menu business's dish in a photo ("tacos") is food: the strongest lead for a restaurant
  if (said.some((w) => s.dishes.has(w))) return { role: 'subject', why: `a food photo ("${quote}")`, food: true };
  if (said.some((w) => s.subject.has(w))) return { role: 'subject', why: `described as "${quote}"` };
  if (s.brand && said.includes(s.brand)) return { role: 'subject', why: `shows the business itself ("${quote}")` };
  if (journey === 'visit' && said.some((w) => PLACE.has(w))) return { role: 'subject', why: `shows the place people visit ("${quote}")` };
  if (said.length >= 2) return { role: 'off', why: `described as something else ("${quote}")` };
  // no description: what an image check saw in it decides (work, the storefront or a vehicle show the business;
  // people are a story photo, never a lead; anything else stays off the page's lead)
  if (p.seenKind) {
    const seen = p.seen ?? p.seenKind;
    if (['work', 'storefront', 'vehicle'].includes(p.seenKind)) return { role: 'subject', why: `the image check saw "${seen}" (${p.seenKind})`, ...(words(seen).some((w) => s.dishes.has(w)) ? { food: true } : {}) };
    return { role: 'off', why: `the image check saw "${seen}" (${p.seenKind}): not a lead photo` };
  }
  return { role: 'unknown', why: 'no description (the best available)' };
}
/** two photos of the same people or thing: they share two or more distinctive described words ("Reyna", "Maritza") */
export function sameSubject(a: Photo, b: Photo): boolean {
  const x = new Set(words(a.alt)), y = words(b.alt);
  return y.filter((w) => x.has(w)).length >= 2;
}
/** a place a headline may name: the one city every location is in; several cities name none */
export function scopedCity(cat: Catalog): string | undefined {
  const cities = [...new Set(cat.locations.map((l) => l.cityLine.split(',')[0].trim()))];
  if (cities.length === 1) return cities[0];
  if (!cities.length) return cat.area?.[0];
  return undefined;
}

// ───────────────────────── the directions ─────────────────────────
interface Ctx {
  cat: Catalog; brief: BusinessBrief; has: Record<SectionKind, boolean>;
  /** lead candidates: off-subject photos never, subject photos before undescribed ones */
  land: Photo[]; wide: Photo[]; portrait: Photo[]; menu: boolean; multi: boolean; city?: string; offers: number;
  /** how many practical visit facts the business has: hours, an address or locations, a phone, a booking link */
  visitFacts: string[];
  journey: Journey;
  role: (p: Photo) => PhotoRole;
}
interface Fit { score: number; reasons: string[]; facts: string[]; unsupported?: string }
interface DirectionDef {
  id: string;
  name: (x: Ctx) => string;
  hero: string; offer: string; proof: (x: Ctx) => string; gallery: string; story: (x: Ctx) => string; contact: (x: Ctx) => string;
  /** page orders in preference: the first one the business can support and no stronger direction already took */
  structures: (x: Ctx) => Structure[];
  /** the other sections, in order, after the lead */
  rest: SectionKind[];
  voice: DirectionAxes['typeVoice']; color: DirectionAxes['colorStrategy']; density: DirectionAxes['density']; imagery: DirectionAxes['imageryRole'];
  /** the hero's pictures; [] when it takes none; null when the business has none that fit */
  heroPhotos: (x: Ctx, used: Set<string>) => string[] | null;
  headline: (x: Ctx) => string;
  thesis: (x: Ctx, fit: Fit) => string;
  fit: (x: Ctx) => Fit;
}
const take = (pool: Photo[], used: Set<string>) => { const p = pool.find((x) => !used.has(x.id)); if (p) used.add(p.id); return p ? [p.id] : null; };
const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

export const DIRECTIONS: DirectionDef[] = [
  {
    // a full-bleed photograph and the offer right under it: for a business whose best photo and services say it all.
    // With no services or menu (a business known only from its Google listing) the photo leads and what customers say,
    // or how to reach it, follows: the photograph is the direction, not the list
    id: 'showcase', name: (x) => (x.has.offer ? `${x.menu ? 'Menu' : 'Services'} up front` : 'Photo first'),
    hero: 'full-bleed', offer: 'cards', proof: () => 'rating-band', gallery: 'mosaic', story: () => 'columns', contact: () => 'panel',
    structures: () => ['offer-first', 'gallery-first', 'proof-first', 'visit-first'], rest: ['proof', 'gallery', 'story', 'contact'],
    voice: 'grotesk', color: 'brand-dominant', density: 'balanced', imagery: 'lead',
    heroPhotos: (x, used) => take(x.land, used),
    headline: (x) => x.cat.business.name,
    thesis: (x, f) => `The business's own photograph fills the first screen${x.has.offer ? ` and its ${x.menu ? 'menu' : 'services'} follow straight away` : ''}: ${f.reasons.slice(0, 2).join('; ')}.`,
    fit: (x) => {
      if (!x.land.length) return { score: 0, reasons: [], facts: [], unsupported: 'no verified landscape photo strong enough to fill the screen' };
      if (!x.has.offer) {
        if (!x.cat.rating && !x.has.gallery) return { score: 0, reasons: [], facts: [], unsupported: 'no services, menu, rating or gallery to follow the photo' };
        return { score: 50 + (x.cat.rating ? 5 : 0) + (x.has.gallery ? 5 : 0), reasons: [`a ${x.land[0].width}px-wide landscape photo for the hero`, 'no services or menu: the photo leads, then what customers say'], facts: x.cat.rating ? ['rating'] : [] };
      }
      const pictured = x.cat.services.filter((s) => s.imageId).length;
      const reasons = [`a ${x.land[0].width}px-wide landscape photo for the hero`, `${n(x.offers, x.menu ? 'menu item' : 'service')} to show first`, ...(pictured >= 2 ? [`${pictured} services have their own photos`] : [])];
      return { score: 60 + Math.min(15, x.offers * 3) + (pictured >= 2 ? 10 : 0) + (x.cat.rating ? 5 : 0), reasons, facts: [...x.cat.services.map((s) => s.id).slice(0, 6), ...(x.cat.rating ? ['rating'] : [])] };
    },
  },
  {
    // a framed photo beside the words, then the business's own story: for a business with a story worth telling
    id: 'storyteller', name: (x) => (x.has.story ? 'The story first' : 'A closer look'),
    hero: 'split', offer: 'board', proof: () => 'stat-strip', gallery: 'filmstrip', story: (x) => (x.portrait.length ? 'portrait' : 'columns'), contact: (x) => (x.multi ? 'locations' : 'panel'),
    structures: () => ['story-first', 'gallery-first', 'offer-first'], rest: ['gallery', 'offer', 'proof', 'contact'],
    voice: 'serif', color: 'brand-accent', density: 'airy', imagery: 'supporting',
    // no verified photo: the story's own words lead, set in type (never an unverified photo)
    heroPhotos: (x, used) => take(x.wide, used) ?? [],
    headline: (x) => ownLine(x.cat) ?? (x.cat.business.category && x.city ? `${x.cat.business.category} in ${x.city}` : x.cat.business.category ?? x.cat.business.name),
    thesis: (x, f) => `The business's own words lead: ${f.reasons.slice(0, 2).join('; ')}.`,
    fit: (x) => {
      if (!x.wide.length && !x.has.story) return { score: 0, reasons: [], facts: [], unsupported: 'no verified photo at least 900px wide to frame beside the headline, and no story to lead with instead' };
      if (!x.wide.length) return { score: 55, reasons: [`its own story ("${x.cat.story!.heading}") leads in type: no verified photo to frame beside it`], facts: ['story'] };
      const reasons = [x.has.story ? `its own story ("${x.cat.story!.heading}", ${x.cat.story!.text.length} characters)` : 'no story: it would lead with photos instead', ...(x.portrait.length ? ['a portrait photo for the story'] : [])];
      return { score: 45 + (x.has.story ? 25 : -15) + (x.portrait.length ? 5 : 0) + (x.has.gallery ? 5 : 0), reasons, facts: x.has.story ? ['story'] : [] };
    },
  },
  {
    // oversized type on the brand colour, three photos and the business's reputation: for a well-reviewed business
    id: 'reputation', name: (x) => (x.multi ? 'Every location' : 'Reputation first'),
    hero: 'type-collage', offer: 'rows', proof: (x) => (x.cat.claims.length + x.cat.pledges.length ? 'pledges' : 'stat-strip'), gallery: 'feature-grid', story: () => 'columns', contact: (x) => (x.multi ? 'locations' : 'band'),
    structures: (x) => (x.multi ? ['visit-first', 'proof-first', 'gallery-first'] : ['proof-first', 'gallery-first', 'offer-first']), rest: ['offer', 'proof', 'gallery', 'contact'],
    voice: 'display', color: 'neutral-with-brand-action', density: 'dense', imagery: 'minimal',
    // three photos, portraits first, none off-subject (they are the hero); a service's own photo stays with its service
    // unless nothing else is left
    heroPhotos: (x) => { const own = new Set(x.cat.services.map((s) => s.imageId).filter(Boolean)); const pool = [...x.portrait, ...x.cat.photos.filter((p) => p.orientation === 'landscape')].filter((p) => x.role(p).role === 'subject').sort((a, b) => (own.has(a.id) ? 1 : 0) - (own.has(b.id) ? 1 : 0) || (a.orientation === 'landscape' ? 1 : 0) - (b.orientation === 'landscape' ? 1 : 0)); return pool.length >= 3 ? pool.slice(0, 3).map((p) => p.id) : []; },
    // the business's name, set huge; one service as the whole page's headline undersells the rest
    headline: (x) => (x.menu ? `The ${x.cat.business.name} menu` : x.cat.business.name),
    thesis: (x, f) => `What customers say comes first, set in big type on the brand colour: ${f.reasons.slice(0, 2).join('; ')}.`,
    fit: (x) => {
      const r = x.cat.rating, claims = x.cat.claims.length + x.cat.pledges.length;
      if (!r && !claims) return { score: 0, reasons: [], facts: [], unsupported: 'no Google rating and no claims of its own: nothing customers say to lead with' };
      const reasons = [r ? `${r.value} on Google from ${r.count} reviews` : 'no Google rating', ...(claims ? [`${n(claims, 'claim')} of its own`] : [])];
      return { score: 40 + (r ? 10 + (r.count >= 50 ? 10 : 0) : -20) + (claims >= 2 ? 10 : 0) + (x.multi ? 5 : 0), reasons, facts: [...(r ? ['rating'] : []), ...x.cat.claims.map((c) => c.id)] };
    },
  },
  {
    // a newspaper-style masthead (the name as the front page), a lead photograph, then the offer as a ruled ledger:
    // for a business with a long menu or many services and the photos to fill a feature page
    id: 'editorial', name: () => 'The front page',
    hero: 'masthead', offer: 'ledger', proof: () => 'stat-strip', gallery: 'mosaic', story: () => 'columns', contact: () => 'panel',
    structures: () => ['gallery-first', 'offer-first', 'story-first'], rest: ['offer', 'story', 'proof', 'contact'],
    voice: 'slab', color: 'neutral-with-brand-action', density: 'balanced', imagery: 'lead',
    heroPhotos: (x, used) => take([...x.land, ...x.wide.filter((p) => p.orientation !== 'portrait')], used) ?? [],
    headline: (x) => x.cat.business.name,
    thesis: (x, f) => `The business's name runs as a front-page masthead over its lead photograph, and its ${x.menu ? 'menu' : 'services'} read as a ruled ledger: ${f.reasons.slice(0, 2).join('; ')}.`,
    fit: (x) => {
      if (x.offers < 4 && !x.has.story) return { score: 0, reasons: [], facts: [], unsupported: 'too little to fill a front page (fewer than four services or menu items, and no story)' };
      const reasons = [...(x.offers ? [`${n(x.offers, x.menu ? 'menu item' : 'service')} for the ledger`] : []), ...(x.has.gallery ? [`${x.cat.photos.length} photos for a photo-led page`] : []), ...(x.has.story ? ['a story for the second column'] : [])];
      return { score: 40 + (x.menu && x.offers >= 8 ? 20 : x.offers >= 4 ? 10 : 0) + (x.has.gallery ? 10 : 0) + (x.has.story ? 5 : 0), reasons, facts: [...(x.menu ? x.cat.items.map((i) => i.id).slice(0, 8) : x.cat.services.map((s) => s.id).slice(0, 8)), ...(x.has.story ? ['story'] : [])] };
    },
  },
  {
    // a front desk: when, where and how to reach the business before anything else, the offer as quick tiles: for a
    // business people visit or book (a clinic, a restaurant, a shop), or one whose photos can't carry a page
    id: 'visit-desk', name: (x) => (x.multi ? 'Find your nearest' : 'Plan your visit'),
    hero: 'desk', offer: 'tiles', proof: () => 'rating-band', gallery: 'mosaic', story: () => 'columns', contact: () => 'timetable',
    structures: () => ['visit-first', 'offer-first', 'proof-first'], rest: ['offer', 'proof', 'gallery', 'story'],
    voice: 'humanist', color: 'brand-dominant', density: 'dense', imagery: 'supporting',
    heroPhotos: (x, used) => { const p = [...x.cat.photos].filter((y) => !used.has(y.id) && y.width >= 1200 && y.width / y.height >= 1.4 && x.role(y).role === 'subject').sort((a, b) => (x.role(a).role === 'subject' ? 0 : 1) - (x.role(b).role === 'subject' ? 0 : 1))[0]; if (p) used.add(p.id); return p ? [p.id] : []; },
    headline: (x) => x.cat.business.name,
    thesis: (x, f) => `The practical facts lead, the way a front desk would: ${f.reasons.slice(0, 2).join('; ')}.`,
    fit: (x) => {
      if (x.journey === 'on-site') return { score: 0, reasons: [], facts: [], unsupported: `its customers request work at their own property (${onSiteEvidence(x.cat)}): leading with opening hours and office directions answers the wrong task` };
      if (x.visitFacts.length < 2) return { score: 0, reasons: [], facts: [], unsupported: 'not enough visit facts (hours, an address, a phone or a booking link) to lead with' };
      const reasons = [`${x.visitFacts.join(', ')} to show first`, ...(x.multi ? [`${x.cat.locations.length} locations`] : []), ...(x.cat.photos.length < 4 ? ['works with few photos'] : [])];
      return { score: 40 + Math.min(20, x.visitFacts.length * 5) + (x.cat.hours ? 5 : 0) + (x.multi ? 10 : 0) + (x.cat.photos.length < 4 ? 10 : 0), reasons, facts: [...(x.cat.hours ? ['hours'] : []), ...(x.cat.address ? [x.cat.address.id] : []), ...(x.cat.phone ? ['phone'] : []), ...x.cat.locations.map((l) => l.id)] };
    },
  },
];

/** below this a direction is weak for this business: it is left out rather than shown to make up a number */
export const WEAK_SCORE = 45;

// ───────────────────────── near-duplicates ─────────────────────────
/** the plan dimensions two directions are compared on: a near-duplicate differs in fewer than DISTINCT_DIMENSIONS of them */
export function planDims(p: DirectionPlan): Record<string, string> {
  const v = (k: SectionKind) => p.sections.find((s) => s.kind === k)?.variant ?? '-';
  const shell = p.recipe?.shell ?? shellFor(v('hero'));
  return { hero: v('hero'), offer: v('offer'), proof: v('proof'), gallery: v('gallery'), contact: v('contact'), structure: p.axes.structure, header: shell.header, footer: shell.footer, voice: p.axes.typeVoice, color: p.axes.colorStrategy, density: p.axes.density, imagery: p.axes.imageryRole };
}
export const DISTINCT_DIMENSIONS = 6;
export function planDifferences(a: DirectionPlan, b: DirectionPlan): string[] {
  const x = planDims(a), y = planDims(b);
  return Object.keys(x).filter((k) => x[k] !== y[k]);
}
/** a near-duplicate: the same hero, or too few differences (colour or type alone never make a direction) */
export const nearDuplicate = (a: DirectionPlan, b: DirectionPlan) => planDims(a).hero === planDims(b).hero || planDifferences(a, b).length < DISTINCT_DIMENSIONS;

// ───────────────────────── ranking ─────────────────────────
function context(cat: Catalog, brief: BusinessBrief): Ctx {
  const menu = cat.items.length > 0;
  const journey = journeyOf(cat);
  const roles = new Map(cat.photos.map((p) => [p.id, photoRole(p, cat, journey)]));
  const role = (p: Photo) => roles.get(p.id) ?? { role: 'unknown' as const, why: '' };
  // a lead image shows the headline's subject: off-subject photos are out; subject photos come before undescribed ones
  const rank = { subject: 0, unknown: 1, off: 2 };
  // a hero shows a verified subject: never an undescribed photo; for a restaurant, its food before its place
  const lead = (ps: Photo[]) => ps.filter((p) => role(p).role === 'subject').sort((a, b) => (role(a).food ? 0 : 1) - (role(b).food ? 0 : 1) || rank[role(a).role] - rank[role(b).role]);
  return {
    cat, brief, has: available(cat), menu, multi: cat.locations.length > 1, journey, role,
    land: lead(cat.photos.filter((p) => p.orientation === 'landscape' && p.uses.includes('hero') && p.width >= 1400).sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id))),
    wide: lead(cat.photos.filter((p) => p.width >= 900).sort((a, b) => (a.orientation === 'portrait' ? -1 : 0) - (b.orientation === 'portrait' ? -1 : 0) || b.width - a.width || a.id.localeCompare(b.id))),
    // the story's and the collage's photos: people and scenes may tell a story, so these stay unfiltered here
    portrait: cat.photos.filter((p) => p.orientation !== 'landscape'),
    city: scopedCity(cat),
    offers: menu ? cat.items.length : cat.services.length,
    visitFacts: [cat.hours ? 'opening hours' : '', cat.address ? 'an address' : cat.locations.length ? 'locations' : '', cat.phone ? 'a phone number' : '', cat.actions.some((a) => a.kind === 'book') ? 'online booking' : ''].filter(Boolean),
  };
}

/**
 * Rank the library's directions for this business and make a plan of each one kept: unsupported, weak and
 * near-duplicate directions are left out (with the reason), and at most `max` are kept. Fewer is the right answer
 * when the business's content or photos can't carry more.
 */
/** the direction a business with nothing else gets: it needs no photos, and its page says what is missing */
const LAST_RESORT = 'visit-desk';

export function rankDirections(cat: Catalog, brief: BusinessBrief, max = maxDirections(), minScore = WEAK_SCORE, force?: string): { plans: DirectionPlan[]; ranking: DirectionRanking } {
  const x = context(cat, brief);
  const considered: DirectionRanking['considered'] = [];
  const scored = DIRECTIONS.map((d, order) => {
    const fit = d.fit(x);
    // the last resort, forced: its missing requirement becomes its recorded weakness, never a fabricated fact
    return { d, order, fit: d.id === force && fit.unsupported ? { score: 0, reasons: [`kept as the last resort: ${fit.unsupported}`], facts: [] } : fit };
  }).sort((a, b) => b.fit.score - a.fit.score || a.order - b.order);
  const plans: DirectionPlan[] = [];
  const usedHero = new Set<string>();
  const takenStructures = new Set<string>();
  for (const { d, fit } of scored) {
    const name = d.name(x);
    const out = (status: DirectionRanking['considered'][number]['status'], why: string[]) => considered.push({ directionId: d.id, name, status, score: fit.score, reasons: why });
    if (fit.unsupported) { out('unsupported', [fit.unsupported]); continue; }
    if (fit.score < minScore) { out('weak', [`fit ${fit.score} is below ${WEAK_SCORE}`, ...fit.reasons]); continue; }
    if (plans.length >= max) { out('over-limit', [`the set already holds ${max} stronger direction(s)`, ...fit.reasons]); continue; }
    const structure = d.structures(x).find((s) => !takenStructures.has(s) && x.has[LEAD[s]]);
    if (!structure) { out('unsupported', ['no page order left that this business can support and no stronger direction already uses']); continue; }
    const tryUsed = new Set(usedHero);
    const heroIds = d.heroPhotos(x, tryUsed);
    if (heroIds === null) { out('unsupported', ['no photo left for its hero that a stronger direction is not already using']); continue; }
    const lead = LEAD[structure];
    const kinds = ['hero' as SectionKind, lead, ...d.rest.filter((k) => k !== lead)].filter((k) => x.has[k]);
    if (!kinds.includes('contact')) kinds.push('contact');
    const variants: Record<SectionKind, string> = { hero: d.hero, offer: d.offer, proof: d.proof(x), gallery: d.gallery, story: d.story(x), contact: d.contact(x) };
    const rank = plans.length + 1;
    const recipe: Recipe = { directionId: d.id, libraryVersion: LIBRARY_VERSION, rank, score: fit.score, reasons: fit.reasons, evidence: { facts: fit.facts, photos: heroIds }, shell: shellFor(d.hero) };
    const rest = cat.photos.filter((p) => !heroIds.includes(p.id));
    const offset = plans.length * 2;
    const plan: DirectionPlan = {
      name, thesis: d.thesis(x, fit), evidence: fit.facts.slice(0, 6),
      axes: { structure, density: d.density, imageryRole: d.imagery, typeVoice: d.voice, colorStrategy: d.color },
      sections: kinds.map((k) => ({ kind: k, variant: variants[k] })),
      // the deck under the headline: the business's own line, when the headline is not already it
      hero: { eyebrow: cat.business.category ?? '', headline: d.headline(x), subline: ownLine(cat) && ownLine(cat) !== d.headline(x) ? ownLine(cat)! : '', imageIds: heroIds },
      titles: [], primaryAction: leadAction(cat, d.id, x.journey).id, secondaryAction: null, featureIds: [],
      galleryImageIds: [...rest.slice(offset), ...rest.slice(0, offset)].slice(0, 7).map((p) => p.id),
      storyImageId: variants.story === 'portrait' ? x.portrait.find((p) => !heroIds.includes(p.id) && !heroIds.some((h) => { const hp = cat.photos.find((y) => y.id === h); return !!hp && sameSubject(hp, p); }))?.id ?? null : null, storyText: null,
      recipe,
    };
    plan.secondaryAction = cat.actions.find((a) => a.id !== plan.primaryAction && !a.seasonal && ['menu', 'site', 'book', 'call', 'reviews'].includes(a.kind))?.id ?? null;
    // the headline, lead image and main action are chosen together; a direction whose three disagree is rejected,
    // whatever its layout's fit or distinctness
    const conflicts = leadConflicts(plan, cat, x);
    if (conflicts.length) { out('unsupported', conflicts); continue; }
    recipe.lead = leadRecord(plan, cat, x);
    const dup = plans.find((p) => nearDuplicate(p, plan));
    if (dup) { out('duplicate', [`too close to "${dup.name}" (differs in ${planDifferences(dup, plan).length} of ${Object.keys(planDims(plan)).length} dimensions)`]); continue; }
    for (const id of heroIds) usedHero.add(id);
    takenStructures.add(structure);
    plans.push(plan);
    considered.push({ directionId: d.id, name, status: 'kept', score: fit.score, reasons: fit.reasons, conceptId: conceptLetter(plans.length - 1) });
  }
  // never an empty set: when every direction is weak, the strongest one the business can support at all is kept alone,
  // its weakness on record (its reasons say why), so the preview still says what's missing instead of failing
  if (!plans.length && minScore > -Infinity && scored.some((s) => !s.fit.unsupported)) {
    const one = rankDirections(cat, brief, 1, -Infinity);
    for (const c of one.ranking.considered) if (c.status === 'kept') c.reasons = [`kept alone although weak (fit ${c.score}): no direction reached ${WEAK_SCORE}`, ...c.reasons];
    return { plans: one.plans, ranking: { ...one.ranking, max } };
  }
  // nothing this business can support at all (no photos, no services, no story): the front desk alone, never an empty set
  if (!plans.length && !force) {
    const one = rankDirections(cat, brief, 1, -Infinity, LAST_RESORT);
    return { plans: one.plans, ranking: { ...one.ranking, max } };
  }
  return { plans, ranking: { max, libraryVersion: LIBRARY_VERSION, considered } };
}

/**
 * The page's main action, from the customer's likely task: a business that works at the customer's property gets asked
 * for work (its own request link, else a call); one people visit is booked, eaten at (its whole menu) or called.
 */
export function leadAction(cat: Catalog, _direction: string, journey: Journey = journeyOf(cat)): { id: string | null; why: string } {
  // a seasonal offer never becomes the page's main action
  const find = (k: string) => cat.actions.find((a) => a.kind === k && !a.seasonal);
  if (journey === 'on-site') {
    const req = cat.actions.find((a) => a.kind === 'site' && !a.seasonal && /quote|estimate|inspection|request|consult|appointment/i.test(a.label)) ?? find('book');
    if (req) return { id: req.id, why: `customers request work at their property (${onSiteEvidence(cat) ?? 'its own words say so'}): the business's own request link "${req.label}"` };
    const call = find('call');
    if (call) return { id: call.id, why: 'customers request work at their property; no request link, so a call' };
  } else {
    const book = find('book');
    if (book) return { id: book.id, why: `people come to it and it takes bookings online ("${book.label}")` };
    const menus = cat.actions.filter((a) => a.kind === 'menu' && !a.seasonal);
    const menu = menus.find((a) => /^(full |our |the )?menu\b/i.test(a.label)) ?? menus.find((a) => /food/i.test(a.label)) ?? menus[0];
    if (menu) return { id: menu.id, why: `people come to eat: the whole menu ("${menu.label}") rather than one part of it` };
    const call = find('call');
    if (call) return { id: call.id, why: 'people come to it; no booking or menu, so a call' };
  }
  const site = find('site');
  return site ? { id: site.id, why: 'the business\'s own website link' } : { id: null, why: 'no verified action' };
}

/** where the headline, lead image and main action disagree with the evidence (empty when they agree) */
export function leadConflicts(plan: DirectionPlan, cat: Catalog, x: Pick<Ctx, 'role' | 'journey'>): string[] {
  const out: string[] = [];
  // every hero photo shows the subject (a collage's tiles are part of the hero too)
  for (const id of plan.hero.imageIds) {
    const p = cat.photos.find((y) => y.id === id);
    if (p && x.role(p).role !== 'subject') out.push(`its lead photo ${id} is ${x.role(p).role === 'off' ? x.role(p).why : 'undescribed (its subject cannot be verified)'}, not what the headline names`);
  }
  const cities = [...new Set(cat.locations.map((l) => l.cityLine.split(',')[0].trim()))];
  if (cities.length > 1 && !(cat.ownLines ?? []).includes(plan.hero.headline ?? '')) for (const c of cities) if (new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(plan.hero.headline ?? '')) out.push(`the headline names ${c}, but the business has ${cat.locations.length} locations in ${cities.length} places`);
  const a = cat.actions.find((y) => y.id === plan.primaryAction);
  if (a && x.journey === 'on-site' && (a.kind === 'directions' || a.kind === 'menu')) out.push(`its main action "${a.label}" sends customers somewhere, though they request work at their property`);
  return out;
}
function leadRecord(plan: DirectionPlan, cat: Catalog, x: Pick<Ctx, 'role' | 'journey'>): NonNullable<Recipe['lead']> {
  const p = cat.photos.find((y) => y.id === plan.hero.imageIds[0]);
  const a = cat.actions.find((y) => y.id === plan.primaryAction);
  const multi = cat.locations.length > 1;
  return {
    headline: plan.hero.headline ?? '',
    headlineEvidence: (cat.ownLines ?? []).includes(plan.hero.headline ?? '') ? 'the business\'s own words: a heading on its website' : (plan.hero.headline ?? '').includes(cat.business.name) ? `the business's name${/menu/i.test(plan.hero.headline ?? '') ? ' and its menu' : ''}` : multi && !scopedCity(cat) ? `its category and its ${cat.locations.length} locations (no single city covers them)` : 'its category and the one place it is in',
    image: p?.id ?? null,
    imageEvidence: !p ? 'no verified photo: a type-led hero' : p ? `${x.role(p).why}${plan.hero.imageIds.length > 1 ? ` (+${plan.hero.imageIds.length - 1} more)` : ''}` : 'this hero takes no photo',
    action: a?.label ?? null,
    actionEvidence: leadAction(cat, '', x.journey).why,
    journey: x.journey,
  };
}

/**
 * Directions Claude proposed, put in the library's order of strength: each is scored as the library direction its hero
 * belongs to, near-duplicates of a stronger one are dropped, and at most `max` are kept.
 */
export function rankPlans(plans: DirectionPlan[], cat: Catalog, brief: BusinessBrief, max = maxDirections()): { plans: DirectionPlan[]; ranking: DirectionRanking } {
  const x = context(cat, brief);
  const considered: DirectionRanking['considered'] = [];
  const scored = plans.map((p, order) => {
    const d = DIRECTIONS.find((y) => y.hero === p.sections[0]?.variant);
    const fit = d ? d.fit(x) : { score: WEAK_SCORE, reasons: [], facts: [] };
    return { p, d, order, score: fit.unsupported ? WEAK_SCORE : fit.score, reasons: fit.reasons, facts: fit.facts };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const kept: DirectionPlan[] = [];
  for (const s of scored) {
    const id = s.d?.id ?? s.p.sections[0]?.variant ?? 'custom';
    const conflicts = leadConflicts(s.p, cat, x);
    if (conflicts.length) { considered.push({ directionId: id, name: s.p.name, status: 'unsupported', score: s.score, reasons: conflicts }); continue; }
    const dup = kept.find((k) => nearDuplicate(k, s.p));
    if (dup) { considered.push({ directionId: id, name: s.p.name, status: 'duplicate', score: s.score, reasons: [`too close to "${dup.name}"`] }); continue; }
    if (kept.length >= max) { considered.push({ directionId: id, name: s.p.name, status: 'over-limit', score: s.score, reasons: [`the set already holds ${max} stronger direction(s)`] }); continue; }
    const recipe: Recipe = { directionId: id, libraryVersion: LIBRARY_VERSION, rank: kept.length + 1, score: s.score, reasons: s.reasons, evidence: { facts: s.p.evidence, photos: s.p.hero.imageIds }, shell: shellFor(s.p.sections[0]?.variant), lead: leadRecord(s.p, cat, x) };
    kept.push({ ...s.p, recipe });
    considered.push({ directionId: id, name: s.p.name, status: 'kept', score: s.score, reasons: s.reasons, conceptId: conceptLetter(kept.length - 1) });
  }
  return { plans: kept, ranking: { max, libraryVersion: LIBRARY_VERSION, considered } };
}

const UI_LINE = /^(?:learn more|read more|see more|services?|our services|menu|our menu|about(?: us)?|contact(?: us)?|come find us!?|find us|locations?|our locations|our story|the story|gallery|photos|reviews?|testimonials?|faq|get in touch|book now|order now|.*polic(?:y|ies)|terms.*)$/i;
/**
 * A concise headline in the business's own words: one of its own website headings, three to ten words, naming what
 * it is or serves (a word of its category, core services or dishes), with no numbers and no menu or service name on its own.
 */
export function ownLine(cat: Catalog): string | undefined {
  const s = subjectOf(cat);
  const names = new Set([...cat.services.map((v) => v.name.toLowerCase()), ...cat.items.map((i) => i.name.toLowerCase())]);
  return (cat.ownLines ?? []).find((t) => {
    const n = t.split(/\s+/).length;
    return n >= 3 && n <= 10 && t.length <= 80 && !/\d/.test(t) && !UI_LINE.test(t.trim()) && !names.has(t.toLowerCase()) && words(t).some((w) => s.subject.has(w) || s.dishes.has(w));
  });
}
