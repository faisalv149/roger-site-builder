import { randomUUID } from 'node:crypto';
import { aiJson, ApiRequestError, CostLedger, defaultTransport, type AiTransport } from './ai.js';
import { contractOf } from './schema-compat.js';
import { TYPE_PRESET_DEFS } from '../../design/directions.js';
import { heroColumns, sectionColumns, type TextSide, type TextWidth } from './geometry.js';
import { directionForSpec, directionRequest, directorOn, DIRECTOR_VERSION, isDirectionNote, validateDirection, type Direction } from './director.js';
import { claimProblems, directionHeroProblems, flaggedLines, heroProblems, menuDetails, plannerSelection, type PlannerSelection } from './manifest-input.js';
import type { SiteManifest } from '../manifest.js';
import { rankDirections } from './directions.js';
import type { Catalog } from './review.js';
import { stateName } from '../address.js';
import { undatedSeasonal } from '../../util/text.js';
import type { BusinessBrief } from '../schema.js';
import type { DesignStrategy } from './references.js';
import type { UsageRecord } from './types.js';

/**
 * The open design planner (first slice): from a verified brief's catalog (and a saved reference strategy when there is
 * one), Claude composes a DesignSpec — hero composition, section order, grid, typography, imagery roles and mobile
 * behaviour — out of layout primitives (column spans, arrangements, item styles, palette roles), not by picking one of
 * the five directions. The directions stay only as the fallback when no valid spec comes back after one repair pass.
 *
 * Evidence rules, enforced by validateSpec (an answer that breaks one is sent back once with the errors):
 *   - every visible sentence is the business's own: one of its own lines, a service's name or description, its story;
 *     Claude may add only short connective labels (≤ 5 words, no numbers, no claims)
 *   - actions only from the catalog (which already holds back unsupported or disputed ones: no call without a phone)
 *   - colours only from the brand plus neutrals and tints of brand colours; fonts only the brand's own
 *   - photos only the catalog's (verified) photos; the logo only when the brief verified it, else a type wordmark
 */

// ───────────────────────── the spec ─────────────────────────
/** a piece of visible text, by reference to the business's own words; `label` is the only free text (short, no claims) */
export type TextRef = { ownLine: number } | { service: string; field: 'name' | 'description' } | { story: 'heading' | 'text' } | { label: string };
export type PaletteValue = string; // a brand hex, a neutral name, or "tint:<brand hex>:<5-30>"
export type Role = 'ground' | 'surface' | 'inverse' | 'accent';
/** a verified fact Roger shows from the catalog's own data (never as text Claude writes) */
export const FACT_KINDS = ['hours', 'address', 'phone', 'rating'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export interface ItemSpec { title: TextRef; body?: TextRef | null; /** a verified photo shown with the item */ photoId?: string | null }
export interface SectionSpec {
  id: string; purpose: string;
  kind: 'services' | 'story' | 'principles' | 'statement' | 'work' | 'contact' | 'capabilities';
  heading: TextRef; intro: TextRef | null;
  layout: { arrangement: 'stack' | 'side-by-side'; headingStart: number; headingSpan: number; contentStart: number; contentSpan: number; itemColumns: number; itemStyle: 'plain' | 'ruled' | 'numbered' | 'card' | 'large-type'; density: 'compact' | 'regular' | 'airy' };
  background: Role;
  items: ItemSpec[];
  actions: string[];
  /** verified photos for the section: beside the heading, a mosaic after the items, or an edge-to-edge band */
  media?: { placement: 'none' | 'beside' | 'mosaic' | 'band'; photoIds: string[] };
  /** the verified facts the section shows, rendered from the catalog's data (absent on designs made before them) */
  facts?: FactKind[];
}
export interface DesignSpec {
  thesis: string;
  palette: { ground: PaletteValue; surface: PaletteValue; ink: PaletteValue; inverse: PaletteValue; accent: PaletteValue; onAccent: PaletteValue };
  type: { heading: string; body: string; mono: string | null; base: number; scale: number; headingWeight: number; headingCase: 'none' | 'uppercase'; tracking: number; measure: number };
  grid: { maxWidth: number; gutter: number; margin: number };
  shape: { radius: number; rule: 'none' | 'hairline' | 'heavy' };
  header: { style: 'bar' | 'minimal' | 'split'; links: string[]; action: string | null; sticky: boolean };
  hero: {
    composition: string;
    background: Role; minHeight: number;
    /** a verified photo behind the whole hero (text over it, with a scrim), or null */
    backgroundPhoto?: string | null; verticalAlign: 'start' | 'center' | 'end'; align: 'start' | 'center';
    textStart: number; textSpan: number; headlineSize: number;
    /** the choices the columns are derived from (the renderer's geometry); absent on designs made before them */
    textSide?: 'left' | 'right' | 'centre'; textWidth?: 'narrow' | 'mid' | 'wide';
    kicker: TextRef | null; headline: TextRef; lede: TextRef | null; actions: string[];
    aside: { kind: 'none' | 'service-index' | 'statement' | 'line-list' | 'contact-card' | 'image'; start: number; span: number; items: TextRef[]; photoId: string | null; /** a contact card's verified facts, from the catalog's data */ facts?: FactKind[] };
  };
  sections: SectionSpec[];
  imagery: { approach: string; roles: { photoId: string; use: string; treatment: 'full-bleed' | 'framed' | 'inset' }[] };
  mobile: { heroOrder: 'text-first' | 'aside-first' | 'aside-hidden'; navigation: 'menu-button' | 'inline-links' | 'action-only'; stickyAction: string | null; headingScale: number; itemColumns: number };
  /** the reference strategy's layout patterns (by index) this design applies; empty when none, or when no strategy was given */
  referencesUsed?: number[];
}
export interface DesignResult {
  id: string; createdAt: string; businessKey: string; revision: number;
  source: 'ai' | 'fallback';
  spec: DesignSpec | null;
  /** when no valid spec came back: the top-ranked direction, for the existing concept renderer */
  fallback: { direction: string; reason: string } | null;
  attempts: number; rejected: { attempt: number; errors: string[] }[];
  strategy: 'used' | 'none saved';
  /** the reference job whose strategy was given to the planner, and the patterns the design says it applied (empty: given, not applied) */
  references?: { referenceJobId: string | null; provided: boolean; applied: string[] };
  /** the design direction the spec followed (audience, main job, idea, its critique and revision), with the guide's version */
  direction?: { version: string; data: Direction; attempts: number; rejected: { attempt: number; errors: string[] }[]; /** its planner notes cut locally, with the originals */ shortened?: { at: string; original: string; shortened: string }[] } | null;
  /** whose colours and fonts these are: the brand's own, or proposed (no brand known), with the proposals */
  brand?: ReturnType<typeof brandOf>;
  /** the spec's planner notes cut locally to their limits, with the originals (for debugging) */
  shortened?: { at: string; original: string; shortened: string }[];
  calls: UsageRecord[]; ms: number;
}

// ───────────────────────── what the business allows ─────────────────────────
export const NEUTRALS: Record<string, string> = { white: '#FFFFFF', paper: '#F7F8FA', mist: '#EEF1F5', line: '#DDE2EA', slate: '#4A5361', ink: '#0B0D12' };
const HEX = /^#[0-9a-f]{6}$/i;
export function brandColors(brief: BusinessBrief): string[] { return [...new Set(brief.brand.colors.map((c) => c.hex.toUpperCase()).filter((h) => HEX.test(h)))]; }
export function brandFonts(brief: BusinessBrief): string[] { return [...new Set(brief.brand.fonts.map((f) => f.family).filter(Boolean))]; }
/** a palette value as a hex, or null when it is not allowed */
export function resolveColor(v: string, brand: string[]): string | null {
  if (NEUTRALS[v]) return NEUTRALS[v];
  // no brand colour known (no website): any colour is a proposal, labelled as such (see brandOf); else only the brand's
  if (HEX.test(v)) return !brand.length || brand.includes(v.toUpperCase()) ? v.toUpperCase() : null;
  const m = v.match(/^tint:(#[0-9a-f]{6}):(\d{1,2})$/i);
  if (m && (!brand.length || brand.includes(m[1].toUpperCase())) && +m[2] >= 4 && +m[2] <= 30) return mix(m[1], '#FFFFFF', +m[2] / 100);
  return null;
}
/** fonts that may be proposed when the brand's own are unknown: the vetted web fonts of Roger's type presets */
export const PROPOSAL_FONTS = [...new Set(Object.values(TYPE_PRESET_DEFS).flatMap((p) => [p.heading.family, p.body.family]))];
/** the brand line of a request: the business's own colours and fonts (kept), or none known, so a labelled proposal */
export function brandLine(brand: string[], fonts: string[], logoVerified: boolean): string {
  const logo = `logo ${logoVerified ? 'verified' : 'not verified (the header shows the name as a wordmark)'}`;
  if (brand.length && fonts.length) return `Brand (keep): colours ${brand.join(', ')}; fonts ${fonts.join(', ')}; ${logo}.`;
  return `Brand: ${brand.length ? `colours ${brand.join(', ')} (keep)` : 'no colours known (no website): propose a palette'}; ${fonts.length ? `fonts ${fonts.join(', ')} (keep)` : `no fonts known: propose a heading and a body font from ${PROPOSAL_FONTS.join(', ')}`}; ${logo}. Proposed colours and fonts are recorded as proposals for the owner, not as the business's brand.`;
}
/**
 * Whether the brief knows which business it is, for designing: verified, website-only, or (a business with no website)
 * the Google listing it was made from, named by its place id ("probable" only because no website corroborates it). A
 * Google brief from a search or an address is not enough.
 */
export function identityKnown(brief: BusinessBrief): boolean {
  if (['verified', 'website-only'].includes(brief.identity.status)) return true;
  return brief.route === 'google' && brief.identity.status === 'probable' && !!brief.identity.listing?.placeId && brief.identity.evidence.includes('the link names this Google listing');
}
/** what of a spec's colours and fonts is the brand's own and what is proposed (no brand known) */
export function brandOf(spec: DesignSpec, brief: BusinessBrief): { colours: 'brand' | 'proposed'; fonts: 'brand' | 'proposed'; proposed: { colours: string[]; fonts: string[] } } {
  const brand = brandColors(brief), fonts = brandFonts(brief);
  const hexes = [...new Set(Object.values(spec.palette).flatMap((v) => (String(v).match(/#[0-9a-f]{6}/gi) ?? []).map((h) => h.toUpperCase())))];
  return {
    colours: brand.length ? 'brand' : 'proposed', fonts: fonts.length ? 'brand' : 'proposed',
    proposed: { colours: brand.length ? [] : hexes, fonts: fonts.length ? [] : [...new Set([spec.type.heading, spec.type.body].filter(Boolean))] },
  };
}
function mix(a: string, b: string, t: number) { const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return `#${x.map((c, i) => Math.round(c * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('').toUpperCase()}`; }
export function contrast(a: string, b: string) {
  const L = (h: string) => { const [r, g, bl] = [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(a), L(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** the text colour a background gets: whichever of the spec's ink or white reads better */
export function textOn(bg: string, ink: string) { return contrast(bg, ink) >= contrast(bg, '#FFFFFF') ? ink : '#FFFFFF'; }

/** the business's own words, resolved; undefined when a reference points at nothing */
export function resolveText(r: TextRef | null | undefined, cat: Catalog): string | undefined {
  if (!r) return undefined;
  if ('ownLine' in r) return cat.ownLines[r.ownLine];
  if ('service' in r) { const s = cat.services.find((x) => x.id === r.service); return s ? (r.field === 'name' ? s.name : s.description) : undefined; }
  if ('story' in r) return cat.story ? cat.story[r.story] : undefined;
  if ('label' in r) return r.label;
  return undefined;
}
/** what a page may show for a text reference: a label naming an unverified place shows nothing (omitted) */
export function visibleText(r: TextRef | null | undefined, cat: Catalog): string | undefined {
  if (r && 'label' in r && locationProblem(r.label, cat)) return undefined;
  return resolveText(r, cat);
}
// ───────────────────────── places: only verified location facts may be named ─────────────────────────
const STATE_CODES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
const STATE_NAMES = STATE_CODES.map((c) => stateName(c));
const CITY_STATE = /\b([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)*),\s*([A-Z]{2})\b/g;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** the verified location facts the catalog holds: the business's own address, its locations, its service area */
export function verifiedPlaces(cat: Catalog): string[] {
  return [cat.address?.formatted, ...(cat.locations ?? []).flatMap((l) => [l.formatted, l.cityLine]), ...(cat.area ?? [])].filter((x): x is string => !!x);
}
/** place names this text mentions: "City, ST" pairs, state names, and places named anywhere about the business */
function placesIn(text: string, cat: Catalog): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CITY_STATE)) if (STATE_CODES.includes(m[2])) { out.add(m[1]); out.add(m[2]); }
  for (const n of STATE_NAMES) if (new RegExp(`\\b${n}\\b`, 'i').test(text)) out.add(n);
  // places the research mentions (the summary, unverified) and the verified ones: a label naming any of them is a place label
  const known = [cat.business.summary ?? '', ...verifiedPlaces(cat)].join(' ');
  for (const m of known.matchAll(CITY_STATE)) if (STATE_CODES.includes(m[2]) && new RegExp(`\\b${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) out.add(m[1]);
  return [...out];
}
/** why a visible label may not name its place, or undefined when it names none or only verified ones */
export function locationProblem(label: string, cat: Catalog): string | undefined {
  const places = placesIn(label, cat);
  if (!places.length) return undefined;
  const verified = norm(verifiedPlaces(cat).map((p) => `${p} ${p.replace(/\b([A-Z]{2})\b/g, (c) => (STATE_CODES.includes(c) ? stateName(c) : c))}`).join(' | '));
  const unverified = places.filter((p) => !verified.includes(norm(p)));
  if (!unverified.length) return undefined;
  return verifiedPlaces(cat).length
    ? `names ${unverified.join(', ')}, which is not a verified location of the business (${verifiedPlaces(cat).join('; ')})`
    : `names ${unverified.join(', ')}, but the brief has no verified location (only research mentions it)`;
}

const CLAIM = /\b(award|awards|certified|certification|leading|leader|best|top|#1|number one|guarantee|guaranteed|trusted|expert|experts|proven|fastest|cheapest|only|premier|world-class|years?|decades?|clients?|customers?|partners?|official)\b/i;

// ───────────────────────── validation ─────────────────────────
export function validateSpec(s: DesignSpec, cat: Catalog, brief: BusinessBrief, strategy?: DesignStrategy | null): string[] {
  const errs: string[] = [];
  if (!s || typeof s !== 'object') return ['no spec'];
  for (const i of s.referencesUsed ?? []) if (!strategy || !Number.isInteger(i) || i < 0 || i >= strategy.layoutPatterns.length) errs.push(strategy ? `referencesUsed: ${i} is not one of the strategy's patterns (0-${strategy.layoutPatterns.length - 1})` : 'referencesUsed: no reference strategy was given, so none can be applied');
  const brand = brandColors(brief);
  const fonts = brandFonts(brief);
  const actions = new Set(cat.actions.map((a) => a.id));
  const photos = new Set(cat.photos.map((p) => p.id));
  const sectionIds = new Set((s.sections ?? []).map((x) => x.id));
  const text = (r: TextRef | null | undefined, where: string, required = true) => {
    if (!r) { if (required) errs.push(`${where}: text is missing`); return; }
    if ('label' in r) {
      const l = String(r.label ?? '').trim();
      if (!l || l.split(/\s+/).length > 5) errs.push(`${where}: a label must be 1-5 words ("${l}")`);
      if (/\d/.test(l)) errs.push(`${where}: a label may not contain numbers ("${l}"); use the business's own line instead`);
      const claim = l.match(CLAIM);
      if (claim) errs.push(`${where}: a label may not make a claim ("${claim[0]}" in "${l}"); use the business's own words`);
      const place = locationProblem(l, cat);
      if (place) errs.push(`${where}: the label "${l}" ${place}; omit it`);
      return;
    }
    if (resolveText(r, cat) === undefined) errs.push(`${where}: ${JSON.stringify(r)} points at nothing in the brief`);
  };
  const act = (ids: string[] | undefined, where: string) => { for (const a of ids ?? []) if (!actions.has(a)) errs.push(`${where}: action "${a}" is not supported by the brief (allowed: ${[...actions].join(', ') || 'none'})`); };
  const span = (start: number, n: number, where: string) => { if (!Number.isInteger(start) || !Number.isInteger(n) || start < 1 || n < 1 || start + n - 1 > 12) errs.push(`${where}: columns ${start}..${start + n - 1} do not fit the 12-column grid`); };

  // palette: brand colours, neutrals and brand tints only; readable pairs
  const pal: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.palette ?? {})) { const hex = resolveColor(String(v), brand); if (!hex) errs.push(`palette.${k}: "${v}" is not a brand colour (${brand.join(', ')}), a neutral (${Object.keys(NEUTRALS).join(', ')}) or a brand tint`); else pal[k] = hex; }
  for (const k of ['ground', 'surface', 'ink', 'inverse', 'accent', 'onAccent']) if (!(k in (s.palette ?? {}))) errs.push(`palette.${k} is missing`);
  if (pal.ground && pal.ink && contrast(pal.ground, pal.ink) < 7) errs.push(`palette: ink on ground has contrast ${contrast(pal.ground, pal.ink).toFixed(1)}, below 7`);
  if (pal.accent && pal.onAccent && contrast(pal.accent, pal.onAccent) < 4.5) errs.push(`palette: onAccent on accent has contrast ${contrast(pal.accent, pal.onAccent).toFixed(1)}, below 4.5`);
  if (pal.inverse && pal.ink && Math.max(contrast(pal.inverse, pal.ink), contrast(pal.inverse, '#FFFFFF')) < 4.5) errs.push('palette: no readable text colour on inverse');
  if (brand.length && !Object.values(s.palette ?? {}).some((v) => brand.some((b) => String(v).toUpperCase().includes(b)))) errs.push('palette: the brand colours are not used at all');
  // type: the brand's own fonts
  for (const k of ['heading', 'body', 'mono'] as const) { const f = s.type?.[k]; if (f && fonts.length && !fonts.includes(f)) errs.push(`type.${k}: "${f}" is not one of the brand's fonts (${fonts.join(', ')})`); else if (f && !fonts.length && !PROPOSAL_FONTS.includes(f)) errs.push(`type.${k}: "${f}" is not one of the fonts that may be proposed (${PROPOSAL_FONTS.join(', ')})`); }
  if (!(s.type?.base >= 15 && s.type?.base <= 20)) errs.push('type.base must be 15-20px');
  if (!(s.type?.scale >= 1.1 && s.type?.scale <= 1.6)) errs.push('type.scale must be 1.1-1.6');
  if (!(s.grid?.maxWidth >= 880 && s.grid?.maxWidth <= 1480)) errs.push('grid.maxWidth must be 880-1480');
  // header
  for (const l of s.header?.links ?? []) if (!sectionIds.has(l)) errs.push(`header.links: "${l}" is not a section id`);
  act(s.header?.action ? [s.header.action] : [], 'header.action');
  // hero
  const h = s.hero;
  if (!h) errs.push('hero is missing');
  else {
    text(h.headline, 'hero.headline');
    for (const [k, r] of [['headline', h.headline], ['kicker', h.kicker], ['lede', h.lede]] as const) { const season = undatedSeasonal(visibleText(r, cat)); if (season) errs.push(`hero.${k}: "${visibleText(r, cat)}" is a seasonal promotion with no year ("${season}"); it may be out of date, so it cannot lead the hero — lead with something lasting and place it lower, if at all`); }
    if (h.backgroundPhoto && !photos.has(h.backgroundPhoto)) errs.push(`hero.backgroundPhoto: "${h.backgroundPhoto}" is not one of the business's verified photos`);
    text(h.kicker, 'hero.kicker', false); text(h.lede, 'hero.lede', false);
    act(h.actions, 'hero.actions');
    span(h.textStart, h.textSpan, 'hero.text');
    if (h.aside?.kind && h.aside.kind !== 'none') {
      span(h.aside.start, h.aside.span, 'hero.aside');
      const a = [h.textStart, h.textStart + h.textSpan - 1], b = [h.aside.start, h.aside.start + h.aside.span - 1];
      if (a[0] <= b[1] && b[0] <= a[1]) errs.push(`hero: the text (columns ${a.join('-')}) and the aside (columns ${b.join('-')}) overlap`);
      (h.aside.items ?? []).forEach((r, i) => text(r, `hero.aside.items[${i}]`));
      if (h.aside.kind === 'image' && (!h.aside.photoId || !photos.has(h.aside.photoId))) errs.push(`hero.aside: photo "${h.aside.photoId}" is not one of the business's verified photos (${[...photos].join(', ') || 'none'})`);
    }
  }
  // sections
  if (!Array.isArray(s.sections) || s.sections.length < 1 || s.sections.length > 8) errs.push('sections: 1-8 are needed (as many as the business has content for)');
  for (const [i, x] of (s.sections ?? []).entries()) {
    const w = `sections[${i}] (${x.id})`;
    text(x.heading, `${w}.heading`); text(x.intro, `${w}.intro`, false);
    act(x.actions, `${w}.actions`);
    const L = x.layout;
    if (!L) { errs.push(`${w}: layout is missing`); continue; }
    span(L.headingStart, L.headingSpan, `${w}.heading`); span(L.contentStart, L.contentSpan, `${w}.content`);
    if (L.arrangement === 'side-by-side') { const a = [L.headingStart, L.headingStart + L.headingSpan - 1], b = [L.contentStart, L.contentStart + L.contentSpan - 1]; if (a[0] <= b[1] && b[0] <= a[1]) errs.push(`${w}: side-by-side heading and content overlap`); }
    if (!(L.itemColumns >= 1 && L.itemColumns <= 4)) errs.push(`${w}: itemColumns must be 1-4`);
    x.items?.forEach((it, j) => { text(it.title, `${w}.items[${j}].title`); text(it.body, `${w}.items[${j}].body`, false); if (it.photoId && !photos.has(it.photoId)) errs.push(`${w}.items[${j}]: photo "${it.photoId}" is not one of the business's verified photos`); });
    for (const p of x.media?.photoIds ?? []) if (!photos.has(p)) errs.push(`${w}.media: photo "${p}" is not one of the business's verified photos`);
    if (x.media && x.media.placement !== 'none' && !x.media.photoIds.length) errs.push(`${w}.media: placement "${x.media.placement}" needs photos`);
    if (x.kind === 'services' && !(x.items ?? []).some((it) => 'service' in it.title)) errs.push(`${w}: a services section must list the brief's services`);
  }
  if (new Set((s.sections ?? []).map((x) => x.id)).size !== (s.sections ?? []).length) errs.push('sections: ids must be unique');
  // imagery and mobile
  for (const r of s.imagery?.roles ?? []) if (!photos.has(r.photoId)) errs.push(`imagery: photo "${r.photoId}" is not one of the business's verified photos`);
  act(s.mobile?.stickyAction ? [s.mobile.stickyAction] : [], 'mobile.stickyAction');
  if (!(s.mobile?.headingScale >= 0.5 && s.mobile?.headingScale <= 1)) errs.push('mobile.headingScale must be 0.5-1');
  if (!(s.mobile?.itemColumns >= 1 && s.mobile?.itemColumns <= 2)) errs.push('mobile.itemColumns must be 1 or 2');
  errs.push(...completeness(s, cat));
  return errs;
}

/** the verified facts the catalog holds, for a page to show (an address: the business's own, or its only location) */
export function factValues(cat: Catalog): Record<FactKind, string[] | null> {
  const address = cat.address?.formatted ?? (cat.locations?.length === 1 ? cat.locations[0].formatted : null);
  return {
    hours: cat.hours?.length ? cat.hours : null,
    address: address ? [address] : null,
    phone: cat.phone ? [cat.phone.display] : null,
    rating: cat.rating && cat.rating.count > 0 ? [`${cat.rating.value}★ from ${cat.rating.count.toLocaleString('en-US')} Google reviews`] : null,
  };
}
const ASIDE_LISTS = ['service-index', 'statement', 'line-list', 'contact-card'];
/** every photo a spec places */
export const specPhotos = (s: DesignSpec) => [s.hero?.backgroundPhoto, s.hero?.aside?.kind === 'image' ? s.hero.aside.photoId : null, ...(s.sections ?? []).flatMap((x) => [...(x.items ?? []).map((i) => i.photoId), ...(x.media && x.media.placement !== 'none' ? x.media.photoIds : [])])].filter((x): x is string => !!x);
/**
 * What a finished page must show, and nothing it may show empty or twice: the verified hours and address (by the explicit
 * `facts` fields, whatever the headings say), at least one verified photo when there are any, the rating and the reviews
 * link in one block, and no hero aside with nothing in it. Facts the brief does not verify cannot be asked for.
 */
export function completeness(s: DesignSpec, cat: Catalog): string[] {
  const errs: string[] = [];
  const values = factValues(cat);
  const sections = s.sections ?? [];
  const aside = s.hero?.aside;
  const shown = (k: FactKind) => sections.some((x) => (x.facts ?? []).includes(k)) || (aside?.kind === 'contact-card' && (aside.facts ?? []).includes(k));
  const lists: [string, FactKind[]][] = [...sections.map((x, i): [string, FactKind[]] => [`sections[${i}] (${x.id}).facts`, x.facts ?? []]), ['hero.aside.facts', aside?.facts ?? []]];
  for (const [where, facts] of lists) {
    for (const k of facts) if (!values[k]) errs.push(`${where}: "${k}" is not verified in the brief, so it cannot be shown`);
    if (new Set(facts).size !== facts.length) errs.push(`${where}: a fact is listed twice`);
  }
  if (aside && aside.kind !== 'contact-card' && aside.facts?.length) errs.push(`hero.aside.facts: only a contact-card aside shows facts (this one is "${aside.kind}")`);
  if (values.hours && !shown('hours')) errs.push('facts: the verified opening hours are not shown; add "hours" to the "facts" of the section (or contact-card aside) where visitors look for them');
  if (values.address && !shown('address')) errs.push('facts: the verified address is not shown; add "address" to the "facts" of the section (or contact-card aside) where visitors find the business');
  // the rating and the link to the reviews: one block
  const reviewActions = new Set(cat.actions.filter((a) => a.kind === 'reviews').map((a) => a.id));
  // (a band headed as reviews with nothing of its own shows the rating too)
  const reviewsHeading = (x: SectionSpec) => !(x.items ?? []).length && /\b(reviews?|testimonials?|what (people|guests|customers|clients) say)\b/i.test(resolveText(x.heading, cat) ?? '');
  const ratingHomes = sections.filter((x) => (x.facts ?? []).includes('rating') || (x.actions ?? []).some((a) => reviewActions.has(a)) || (values.rating && reviewsHeading(x)));
  if (ratingHomes.length > 1) errs.push(`sections: the rating and the reviews link are spread over ${ratingHomes.length} sections (${ratingHomes.map((x) => x.id).join(', ')}); show them once, in one section (its "facts" ["rating"] and the reviews action)`);
  const asideFilled = (aside?.items ?? []).length > 0 || (aside?.kind === 'contact-card' && ((aside.facts ?? []).some((k) => values[k]) || !!cat.email));
  if (aside && ASIDE_LISTS.includes(aside.kind) && !asideFilled) errs.push(`hero.aside: a "${aside.kind}" with nothing in it would render as an empty box; give it items${aside.kind === 'contact-card' ? ' or verified facts' : ''}, or choose "none"`);
  if (cat.photos.length && !specPhotos(s).some((id) => cat.photos.some((p) => p.id === id))) errs.push(`photos: ${cat.photos.length} verified photo(s) are offered but the page shows none; place at least one (hero, an item, or section media)`);
  return errs;
}

// ───────────────────────── Claude ─────────────────────────
const str = (max: number) => ({ type: 'string', maxLength: max });
const int = (min: number, max: number) => ({ type: 'integer', minimum: min, maximum: max });
const num = (min: number, max: number) => ({ type: 'number', minimum: min, maximum: max });
const en = (...v: string[]) => ({ type: 'string', enum: v });
const TEXTREF = { anyOf: [
  { type: 'object', additionalProperties: false, required: ['ownLine'], properties: { ownLine: { type: 'integer' } } },
  { type: 'object', additionalProperties: false, required: ['service', 'field'], properties: { service: { type: 'string' }, field: en('name', 'description') } },
  { type: 'object', additionalProperties: false, required: ['story'], properties: { story: en('heading', 'text') } },
  { type: 'object', additionalProperties: false, required: ['label'], properties: { label: str(40) } },
] };
const NULLABLE = (s: object) => ({ anyOf: [s, { type: 'null' }] });
const ROLE = en('ground', 'surface', 'inverse', 'accent');
const FACTS = { type: 'array', maxItems: 4, items: en(...FACT_KINDS) };
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
export const SPEC_SCHEMA = obj({
  thesis: str(240),
  palette: obj({ ground: str(30), surface: str(30), ink: str(30), inverse: str(30), accent: str(30), onAccent: str(30) }),
  type: obj({ heading: str(40), body: str(40), mono: NULLABLE(str(40)), base: num(15, 20), scale: num(1.1, 1.6), headingWeight: int(200, 900), headingCase: en('none', 'uppercase'), tracking: num(-0.06, 0.12), measure: int(40, 80) }),
  grid: obj({ maxWidth: int(880, 1480), gutter: int(12, 48), margin: int(16, 120) }),
  shape: obj({ radius: int(0, 24), rule: en('none', 'hairline', 'heavy') }),
  header: obj({ style: en('bar', 'minimal', 'split'), links: { type: 'array', maxItems: 5, items: { type: 'string' } }, action: NULLABLE({ type: 'string' }), sticky: { type: 'boolean' } }),
  hero: obj({
    composition: str(240), background: ROLE, backgroundPhoto: NULLABLE({ type: 'string' }), minHeight: int(40, 100), verticalAlign: en('start', 'center', 'end'), align: en('start', 'center'),
    textSide: en('left', 'right', 'centre'), textWidth: en('narrow', 'mid', 'wide'), headlineSize: num(2, 7),
    kicker: NULLABLE(TEXTREF), headline: TEXTREF, lede: NULLABLE(TEXTREF), actions: { type: 'array', maxItems: 2, items: { type: 'string' } },
    aside: obj({ kind: en('none', 'service-index', 'statement', 'line-list', 'contact-card', 'image'), items: { type: 'array', maxItems: 8, items: TEXTREF }, photoId: NULLABLE({ type: 'string' }), facts: FACTS }),
  }),
  sections: { type: 'array', minItems: 1, maxItems: 8, items: obj({
    id: str(24), purpose: str(160), kind: en('services', 'story', 'principles', 'statement', 'work', 'contact', 'capabilities'),
    heading: TEXTREF, intro: NULLABLE(TEXTREF),
    layout: obj({ arrangement: en('stack', 'side-by-side'), itemColumns: int(1, 4), itemStyle: en('plain', 'ruled', 'numbered', 'card', 'large-type'), density: en('compact', 'regular', 'airy') }),
    background: ROLE,
    items: { type: 'array', maxItems: 12, items: obj({ title: TEXTREF, body: NULLABLE(TEXTREF), photoId: NULLABLE({ type: 'string' }) }) },
    actions: { type: 'array', maxItems: 2, items: { type: 'string' } },
    media: obj({ placement: en('none', 'beside', 'mosaic', 'band'), photoIds: { type: 'array', maxItems: 8, items: { type: 'string' } } }),
    facts: FACTS,
  }) },
  imagery: obj({ approach: str(240), roles: { type: 'array', maxItems: 8, items: obj({ photoId: { type: 'string' }, use: str(80), treatment: en('full-bleed', 'framed', 'inset') }) } }),
  mobile: obj({ heroOrder: en('text-first', 'aside-first', 'aside-hidden'), navigation: en('menu-button', 'inline-links', 'action-only'), stickyAction: NULLABLE({ type: 'string' }), headingScale: num(0.5, 1), itemColumns: int(1, 2) }),
  referencesUsed: { type: 'array', maxItems: 8, items: { type: 'integer', minimum: 0 } },
});

/**
 * The DesignSpec contract Claude is given. The spec is asked for as ordinary JSON, not constrained output: its schema
 * compiles to a grammar larger than the API accepts ("The compiled grammar is too large"). The answer is parsed and
 * then checked against the full SPEC_SCHEMA (schemaErrors, in aiJson) and every grounding, rights and design check.
 */
export const SPEC_CONTRACT = contractOf(SPEC_SCHEMA, { TextRef: TEXTREF, Role: ROLE });

/**
 * Claude's answer: a DesignSpec without geometry. It chooses where the hero text sits and how wide, and each section's
 * arrangement; the renderer's geometry derives the column ranges. A services section's items are not Claude's either.
 */
export type SpecAnswer = Omit<DesignSpec, 'hero' | 'sections'> & {
  hero: Omit<DesignSpec['hero'], 'textStart' | 'textSpan' | 'aside' | 'textSide' | 'textWidth'> & { textSide: TextSide; textWidth: TextWidth; aside: Omit<DesignSpec['hero']['aside'], 'start' | 'span'> };
  sections: (Omit<SectionSpec, 'layout'> & { layout: Omit<SectionSpec['layout'], 'headingStart' | 'headingSpan' | 'contentStart' | 'contentSpan'> })[];
};

/**
 * The full DesignSpec from Claude's answer: columns from the renderer's geometry, and every services section's items
 * assembled from the verified catalog (each service by reference, name and description, with its verified picture),
 * so a services section always lists the business's real offerings and nothing else.
 */
export function assembleSpec(a: SpecAnswer, cat: Catalog): DesignSpec {
  const photos = new Set(cat.photos.map((p) => p.id));
  const h = heroColumns(a.hero.textSide, a.hero.textWidth, a.hero.aside.kind);
  const offerings: ItemSpec[] = cat.services.map((s) => ({ title: { service: s.id, field: 'name' }, body: s.description ? { service: s.id, field: 'description' } : null, photoId: s.imageId && photos.has(s.imageId) ? s.imageId : null }));
  let listed = false;
  return {
    ...structuredClone(a),
    hero: { ...structuredClone(a.hero), textStart: h.textStart, textSpan: h.textSpan, aside: { ...structuredClone(a.hero.aside), start: h.asideStart, span: h.asideSpan } },
    sections: a.sections.map((x) => {
      const sec: SectionSpec = { ...structuredClone(x), layout: { ...x.layout, ...sectionColumns(x.layout.arrangement) } };
      // the first services section lists every service; a later one keeps what it chose (checked like any section)
      if (x.kind === 'services' && !listed && offerings.length) { sec.items = structuredClone(offerings); listed = true; }
      return sec;
    }),
  };
}

/** the planner's line about the verified facts: what Roger shows from data, and where it must appear */
export function factsLine(cat: Catalog): string {
  const v = factValues(cat);
  const have = FACT_KINDS.filter((k) => v[k]);
  const reviews = cat.actions.find((a) => a.kind === 'reviews');
  const must = [v.hours ? '"hours"' : '', v.address ? '"address"' : ''].filter(Boolean);
  return [
    `Verified facts Roger shows from its own data: ${have.length ? have.map((k) => `${k} (${v[k]!.join('; ')})`).join(', ') : 'none'}. Never write them as text or labels: list a fact's name in the "facts" of the section that shows it (or of a contact-card hero aside), and Roger renders it; "facts" is [] elsewhere.`,
    must.length ? `${must.join(' and ')} must each appear once.` : '',
    v.rating ? `The rating may appear once; ${reviews ? `put it and the "${reviews.id}" action in the same section (one block, never two sections about the reviews)` : 'in one section'}.` : '',
    'A hero aside must have something in it (items, or a contact card\'s facts); otherwise choose "none".',
    cat.photos.length ? 'The page must show at least one of the verified photos.' : '',
  ].filter(Boolean).join(' ');
}

/**
 * `selection`: from the site manifest (existing-website businesses): it replaces the full lists of own lines and photos;
 * `details`: the menu items the direction asked for, and only those.
 */
export function specRequest(cat: Catalog, brief: BusinessBrief, strategy?: DesignStrategy | null, previous: DesignSpec[] = [], direction?: Direction | null, selection?: PlannerSelection | null, details: ReturnType<typeof menuDetails> = []) {
  const brand = brandColors(brief);
  const fonts = brandFonts(brief);
  return {
    stage: 'design:spec', schema: SPEC_SCHEMA, output: 'json' as const, maxOutputTokens: 9000,
    system: 'You are a senior art director composing a small-business website from first principles. You design the layout yourself from the primitives offered; you do not pick a template. Answer only with the JSON asked for.',
    prompt: [
      `Business: ${cat.business.name}${cat.business.category ? ` (${cat.business.category})` : ''}. ${cat.business.summary ?? ''}`,
      '',
      'Its own words: you may show ONLY these, by reference. Visible text is {"ownLine": i}, {"service": id, "field": "name"|"description"}, {"story": "heading"|"text"}, or a short {"label"} of at most 5 words with no numbers and no claims (no "trusted", "expert", "years", "best", "clients"...).',
      ...(selection
        ? [`From ${selection.source ?? "the business's website"} (selected; ids are sources; "line" is the ownLine index to cite; cite only lines given here, in "lines", the menu examples or the details): ${JSON.stringify(selection)}`, ...(details.length ? [`Menu details you asked for (descriptions are the business's own; a price is for the owner's review and may never be shown or stated as confirmed): ${JSON.stringify(details)}`] : []), 'Award claims listed under review may not be shown: they are for the owner to confirm.']
        : [`ownLines: ${JSON.stringify(cat.ownLines.map((t, i) => `${i}: ${t}`))}`]),
      `services: ${JSON.stringify(cat.services.map((x) => ({ id: x.id, name: x.name, description: x.description ?? null })))}`,
      `story: ${cat.story ? JSON.stringify(cat.story) : 'none'}`,
      `Actions it supports (use only these ids): ${JSON.stringify(cat.actions.map((a) => ({ id: a.id, label: a.label, kind: a.kind })))}${cat.omitted.length ? `. Not supported, never suggest: ${cat.omitted.map((o) => o.what).join('; ')}` : ''}.`,
      ...(selection ? [`Place photos only from the selection above (by id) with hero.backgroundPhoto, hero.aside image, item photoId, or section media (beside / mosaic / band); never put one where its content would be misdescribed.`] : [`Verified photos (the business's own; "shows" is what an image check saw): ${cat.photos.length ? JSON.stringify(cat.photos.map((p) => ({ id: p.id, orientation: p.orientation, width: p.width, shows: p.seen ?? (p.alt || 'unknown'), kind: p.seenKind ?? null }))) : 'none — design a type-led site; no image slots'}. Place photos with hero.backgroundPhoto, hero.aside image, item photoId, or section media (beside / mosaic / band); prefer photos whose content is known, and never put one where its content would be misdescribed.`]),
      `Verified location: ${verifiedPlaces(cat).join('; ') || 'none'}. A label may name a place only if it is in that verified location; places the summary mentions are research, not verified, and must not be shown.`,
      factsLine(cat),
      brandLine(brand, fonts, brief.brand.logo.status === 'verified' && !!cat.logo),
      brand.length
        ? `Palette values must be a brand hex, a neutral (${Object.keys(NEUTRALS).join(', ')}) or "tint:<brand hex>:<4-30>" (that brand colour at that % over white). Ink on ground needs contrast ≥ 7, onAccent on accent ≥ 4.5.${fonts.length ? " Fonts: only the brand's own." : ''}`
        : `Palette values: a hex you propose, a neutral (${Object.keys(NEUTRALS).join(', ')}) or "tint:<hex>:<4-30>". Ink on ground needs contrast ≥ 7, onAccent on accent ≥ 4.5.`,
      strategy ? `Reference strategy (inspiration only, measured from other sites): ${JSON.stringify({ summary: strategy.summary, layoutPatterns: strategy.layoutPatterns.map((p, i) => `${i}: ${p.pattern}`), typography: strategy.typography, navigation: strategy.navigation, avoid: strategy.avoid })}. In "referencesUsed", list the numbers of the layout patterns this design actually applies (an empty list if it applies none); never claim one it does not apply.` : 'No reference strategy is saved for this business: compose from the brief alone, and leave "referencesUsed" empty.',
      '',
      ...(previous.length ? [`Versions already shown to the client: ${previousForPrompt(previous)}. This is another version: compose it differently, not as a variation — a different hero composition (change at least two of: aside kind, photo background, text side, text width, hero height) and a different page structure (at least a third of the sections, and at least two, added, removed or set out differently — or one, when the business has only two sections worth showing besides how to reach it, and none beyond the hero when it has one; necessary sections such as the menu or the visit block may stay as they are). The pages must look different, not only be specified differently. Changing colours, fonts or section order alone does not count. Keep the same brand colours, fonts and verified content.`] : []),
      'A promotion with a date or season but no year (a holiday, a pre-order date) is left out of the preview until the owner confirms it: do not lead with it or build a section on it. ' +
      'Decide the hero composition (where the text sits: "textSide"; how wide: "textWidth"; what sits beside it and why), the section order and each section\'s arrangement, the type scale and weight, the palette roles, the imagery roles, and how it changes on a 390px phone. Roger places the columns on its 12-column grid from these choices (a centred text has nothing beside it). Make choices that follow from this business\'s content and voice, and say why in "thesis", "hero.composition" and each section\'s "purpose". A section of kind "services" lists every service: Roger fills its items from the verified list, so give it "items": [].',
      ...(direction ? ['', directionForSpec(direction)] : []),
      '',
      'Answer with one JSON object and nothing else (no prose, no code fence), following this contract exactly: every key is required, use null only where it is allowed, use [] for an empty list, and add no other keys. "string ≤N" is at most N characters; "int a–b" and "number a–b" are inclusive ranges; "(≤N)" is the most items a list may have. Ids, not names: "header.links" lists the "id" of sections in this spec; "header.action", "hero.actions", each section\'s "actions" and "mobile.stickyAction" use action ids from the list above. The ≤240 texts ("thesis", "hero.composition", "imagery.approach") are one or two short sentences: the limit is hard.',
      SPEC_CONTRACT,
    ].join('\n'),
  };
}

export interface DesignHooks { /** the business's saved site manifest (existing-website businesses): the planner reads a selection of it */ manifest?: SiteManifest | null; /** a business with no website: its listing selection (listingSelection), used when there is no manifest */ selection?: PlannerSelection | null; /** the reference job the strategy came from (recorded) */ referenceJobId?: string | null; /** versions already shown: this one must differ meaningfully from each */ previous?: DesignSpec[]; transport?: AiTransport | null; fallback?: (cat: Catalog, brief: BusinessBrief) => string; capUsd?: number; /** a concept job's ledger: the planner spends from the job's cap */ ledger?: CostLedger }
const capUsd = () => Number(process.env.STUDIO_DESIGN_CAP_USD ?? 1.5);

/**
 * One generated design: Claude composes (ordinary JSON), the full schema and the validator check, at most one repair
 * pass. With no valid spec the result says why (`fallback.reason`); the concept job reports that as its failure and
 * never uses the fixed directions instead.
 */
export async function generateDesignSpec(cat: Catalog, brief: BusinessBrief, strategy: DesignStrategy | null, hooks: DesignHooks = {}): Promise<DesignResult> {
  const t0 = Date.now();
  const id = `ds_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const base = { id, createdAt: new Date().toISOString(), businessKey: brief.businessKey, revision: brief.revision, strategy: strategy ? 'used' as const : 'none saved' as const };
  const fallbackFor = (reason: string, rest: Partial<DesignResult>): DesignResult => ({
    ...base, source: 'fallback', spec: null, attempts: 0, rejected: [], calls: [], ms: Date.now() - t0, ...rest,
    // the name is a record only (the open planner never uses the directions); it can never hide the reason
    fallback: { direction: (() => { try { return (hooks.fallback ?? ((c, b) => rankDirections(c, b, 1).plans[0]?.name ?? 'none'))(cat, brief); } catch { return 'none'; } })(), reason },
  });
  if (!identityKnown(brief)) throw new Error(`The brief's identity is ${brief.identity.status}: settle who the business is first.`);
  const transport = hooks.transport !== undefined ? hooks.transport : defaultTransport();
  if (!transport) return fallbackFor('no Claude transport here', {});
  const ledger = hooks.ledger ?? new CostLedger(hooks.capUsd ?? capUsd(), id);
  const before = ledger.calls.length;
  try {
    // an existing website's manifest: the planner reads a short selection of it; its award claims are never shown
    const selection = hooks.manifest ? plannerSelection(hooks.manifest, cat) : hooks.selection ?? null;
    const flagged = hooks.manifest ? flaggedLines(hooks.manifest, cat) : new Set<number>();
    // the design director first: audience, main job, a grounded idea, its critique and one revision (one repair at most)
    let direction: DesignResult['direction'] = null;
    if (directorOn()) {
      const d = await aiJson<Direction>(directionRequest(cat, brief, strategy, hooks.previous?.length ? previousForPrompt(hooks.previous) : null, selection, hooks.manifest?.menu.map((x) => x.id) ?? []), { transport, ledger, retries: 1, validate: (x) => [...validateDirection(x, cat, brief), ...(selection ? directionHeroProblems(x, selection) : [])], localShorten: isDirectionNote });
      direction = { version: DIRECTOR_VERSION, data: (d.data ?? d.last)!, attempts: d.attempts, rejected: d.rejected, ...(d.shortened.length ? { shortened: d.shortened } : {}) };
      if (!d.data) return fallbackFor(`no valid design direction after ${d.attempts} attempt(s): ${d.errors.slice(0, 3).join('; ')}`, { calls: ledger.calls.slice(before), direction });
    }
    // Claude's answer has no geometry and no services list: both are assembled before every check, which sees the full spec
    // menu details only for the items the direction asked for
    const details = hooks.manifest && direction?.data.menuNeeded?.length ? menuDetails(hooks.manifest, direction.data.menuNeeded, cat) : [];
    const r = await aiJson<SpecAnswer>(specRequest(cat, brief, strategy, hooks.previous ?? [], direction?.data ?? null, selection, details), { transport, ledger, retries: 1, validate: (a) => { const d = assembleSpec(a, cat); return [...validateSpec(d, cat, brief, strategy), ...differenceProblems(d, hooks.previous ?? []), ...claimProblems(d, cat, flagged), ...(selection ? heroProblems(d, selection) : [])]; }, localShorten: isSpecNote });
    if (!r.data) return fallbackFor(`no valid spec after ${r.attempts} attempt(s): ${r.errors.slice(0, 3).join('; ')}`, { attempts: r.attempts, rejected: r.rejected, calls: ledger.calls.slice(before), direction });
    const spec = assembleSpec(r.data, cat);
    const applied = (spec.referencesUsed ?? []).map((i) => strategy!.layoutPatterns[i]?.pattern).filter((x): x is string => !!x);
    return { ...base, source: 'ai', spec, fallback: null, brand: brandOf(spec, brief), ...(r.shortened.length ? { shortened: r.shortened } : {}), attempts: r.attempts, rejected: r.rejected, calls: ledger.calls.slice(before), ms: Date.now() - t0, references: { referenceJobId: hooks.referenceJobId ?? null, provided: !!strategy, applied }, direction };
  } catch (e) {
    // the API refusing the request (an invalid schema, a bad key) is a fault to report at this stage, never a reason to
    // quietly show an older kind of design
    if (e instanceof ApiRequestError) throw e;
    return fallbackFor(`generation failed: ${(e as Error).message.slice(0, 200)}`, { calls: ledger.calls.slice(before) });
  }
}

// ───────────────────────── handoff: what goes onto the live site ─────────────────────────
/**
 * The spec as the full site shows it: undated seasonal promotions removed from every place they appear (a section led
 * by one goes, with its items; an intro, item or line that is one goes alone), each recorded with why. A promotion
 * with a year stays (it can be checked against today); everything lasting stays exactly where the design put it.
 */
export function handoffSpec(spec: DesignSpec, cat: Catalog): { spec: DesignSpec; omitted: { what: string; reason: string }[] } {
  const s: DesignSpec = structuredClone(spec);
  const omitted: { what: string; reason: string }[] = [];
  const why = (text: string, season: string) => `an undated seasonal promotion ("${season}") — it may be out of date, so it is left off the site until the owner gives a date`;
  const season = (r: TextRef | null | undefined) => { const t = visibleText(r, cat); const m = undatedSeasonal(t); return m ? { t: t!, m } : undefined; };
  for (const k of ['kicker', 'lede'] as const) { const x = season(s.hero[k]); if (x) { omitted.push({ what: `hero ${k}: "${x.t}"`, reason: why(x.t, x.m) }); s.hero[k] = null; } }
  s.hero.aside.items = s.hero.aside.items.filter((r) => { const x = season(r); if (x) omitted.push({ what: `hero list: "${x.t}"`, reason: why(x.t, x.m) }); return !x; });
  s.sections = s.sections.filter((sec) => {
    const h = season(sec.heading);
    if (h) { omitted.push({ what: `section "${h.t}" (${sec.items.length} item(s))`, reason: why(h.t, h.m) }); return false; }
    const i = season(sec.intro);
    if (i) { omitted.push({ what: `intro of "${visibleText(sec.heading, cat)}": "${i.t}"`, reason: why(i.t, i.m) }); sec.intro = null; }
    sec.items = sec.items.filter((it) => {
      const t = season(it.title);
      if (t) { omitted.push({ what: `item "${t.t}"`, reason: why(t.t, t.m) }); return false; }
      const b = season(it.body);
      if (b) { omitted.push({ what: `line under "${visibleText(it.title, cat)}": "${b.t}"`, reason: why(b.t, b.m) }); it.body = null; }
      return true;
    });
    return true;
  });
  const ids = new Set(s.sections.map((x) => x.id));
  s.header.links = s.header.links.filter((l) => ids.has(l));
  return { spec: s, omitted };
}

// ───────────────────────── another version: meaningfully different structure ─────────────────────────
/**
 * A spec's structure, without colour, type or order: the hero's composition and the page's sections as a set. Two
 * versions that differ only in palette, fonts or section order have the same structure.
 */
export interface StructureSig {
  hero: { aside: string; photoBg: boolean; textSide: 'left' | 'centre' | 'right'; width: 'narrow' | 'mid' | 'wide'; height: 'short' | 'tall' };
  sections: string[];
}
export function structureOf(s: DesignSpec): StructureSig {
  const h = s.hero;
  const mid = h.textStart + h.textSpan / 2;
  return {
    hero: {
      aside: h.aside.kind === 'none' || !h.aside.span ? 'none' : h.aside.kind,
      photoBg: !!h.backgroundPhoto,
      textSide: h.align === 'center' || (mid > 4.5 && mid < 8.5) ? 'centre' : mid <= 4.5 ? 'left' : 'right',
      width: h.textSpan <= 5 ? 'narrow' : h.textSpan <= 8 ? 'mid' : 'wide',
      height: h.minHeight >= 75 ? 'tall' : 'short',
    },
    sections: s.sections.map((x) => `${x.kind}/${x.layout.arrangement}/${x.layout.itemStyle}/${x.media && x.media.placement !== 'none' ? x.media.placement : 'no-media'}`).sort(),
  };
}
/** why this spec is not meaningfully different from a version already shown (empty: it is) */
export function differenceProblems(s: DesignSpec, previous: DesignSpec[]): string[] {
  const errs: string[] = [];
  const a = structureOf(s);
  previous.forEach((p, i) => {
    const b = structureOf(p);
    const heroDiff = (Object.keys(a.hero) as (keyof StructureSig['hero'])[]).filter((k) => a.hero[k] !== b.hero[k]);
    if (heroDiff.length < 2) errs.push(`hero: too close to version ${i + 1} (only ${heroDiff.join(', ') || 'nothing'} differs; change at least two of aside, photo background, text side, text width, hero height)`);
    const d = structuralChange(a.sections, b.sections);
    if (d.changed < d.needed) errs.push(`page structure: too close to version ${i + 1} (${d.changed} structural change(s): ${d.detail || 'none'}; at least ${d.needed} needed for ${d.meaningful} meaningful section(s) — a section added, removed, or set out differently; necessary sections may stay as they were, and reordering does not count)`);
  });
  return errs;
}

/**
 * How much a page's structure changed, section by section: sections are matched by kind (a menu, a visit block may
 * stay); a matched section counts as changed when its arrangement, item style or media differ; one with no match is
 * an added section, and an unmatched old one a removed section. Order never counts. Needed: a third of the larger
 * page, and at least two.
 */
export function structuralChange(now: string[], before: string[]): { changed: number; needed: number; detail: string; meaningful: number } {
  const kind = (x: string) => x.split('/')[0];
  const rest = [...before];
  let same = 0;
  const notes: string[] = [];
  const unmatched: string[] = [];
  for (const x of now) { const j = rest.indexOf(x); if (j >= 0) { same++; rest.splice(j, 1); } else unmatched.push(x); }
  for (const x of unmatched) {
    const j = rest.findIndex((y) => kind(y) === kind(x));
    if (j >= 0) { notes.push(`${kind(x)} set out differently`); rest.splice(j, 1); } else notes.push(`${kind(x)} added`);
  }
  for (const y of rest) notes.push(`${kind(y)} removed`);
  const changed = notes.length;
  // a sparse business (a Google-only listing) may have only one or two sections worth showing besides how to reach it:
  // with one, the hero and the rendered pages carry the difference; with two, one changed section is enough
  const meaningful = Math.max(now.filter((x) => kind(x) !== 'contact').length, before.filter((x) => kind(x) !== 'contact').length);
  const needed = meaningful <= 1 ? 0 : meaningful <= 2 ? 1 : Math.max(2, Math.ceil(Math.max(now.length, before.length) / 3));
  return { changed, needed, detail: notes.join(', '), meaningful };
}
/** why no other version could be made: the bounded attempts used, and what each last broke (reported, never retried further) */
export function versionFailure(r: Pick<DesignResult, 'attempts' | 'rejected' | 'fallback'>): string {
  const last = r.rejected[r.rejected.length - 1]?.errors ?? [];
  const why = last.slice(0, 3).join('; ') || r.fallback?.reason || 'unknown';
  // "different" only when closeness to a version shown was the reason (the client is told so); otherwise the plain failure
  return last.some((e) => /too close/.test(e)) ? `no visibly different version within ${r.attempts} attempt(s): ${why}` : `no valid version within ${r.attempts || 'its'} attempt(s): ${why}`;
}

/** how the prompt describes versions already shown */
export function previousForPrompt(previous: DesignSpec[]): string {
  return previous.map((p, i) => `version ${i + 1}: ${JSON.stringify(structureOf(p))}`).join('; ');
}

/**
 * The DesignSpec's planner-only notes: why the design is as it is, never shown on a site. An over-long one is cut
 * locally (see aiJson). Never a visible label, a section id, a photo id or any exact choice.
 */
const SPEC_NOTES = new Set(['thesis', 'composition', 'purpose', 'approach', 'use']);
export const isSpecNote = (path: (string | number)[]) => typeof path[path.length - 1] === 'string' && SPEC_NOTES.has(path[path.length - 1] as string);
