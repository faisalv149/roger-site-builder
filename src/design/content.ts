import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Business, Facts } from '../types.js';
import type { Offering } from './offerings.js';
import type { PhotoMeta } from './photos.js';
import { GOALS, type Goal } from './categories.js';

/**
 * Business details the site states, each with where it came from (provenance) kept separate from what the owner
 * said about it (review). A scraped or Google-sourced statement is not verified until the owner confirms it;
 * a confirmation is bound to the exact value (a hash), so changing a confirmed fact makes it unreviewed again,
 * while a colour or layout change never does. Sample (QA/demo) content is marked and can never be published.
 *
 * Media keep their source, attribution, usage permission, alt text, focal point and role. Google Places photos
 * and review text are shown in previews with attribution but are not copied into a published site: Google's
 * Maps Platform terms restrict storing Places content (only place IDs may be kept indefinitely) and the owner's
 * confirmation doesn't change that. Owners replace them with their own uploads, or they are left out.
 */
export const CONTENT_VERSION = 1;
export const FACT_SOURCES = ['google', 'website', 'claude', 'owner', 'sample'] as const;
export const REVIEW_STATES = ['unreviewed', 'confirmed', 'corrected', 'omitted'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];

const provenance = z.object({ source: z.enum(FACT_SOURCES), ref: z.string().max(300).optional(), fetchedAt: z.string().max(40).optional(), confidence: z.number().min(0).max(1).optional() }).strict();
const review = z.object({ status: z.enum(REVIEW_STATES), valueHash: z.string().max(20).optional(), contentRevision: z.number().int().min(0).optional(), at: z.string().max(40).optional() }).strict();
export type Provenance = z.infer<typeof provenance>;
export type Review = z.infer<typeof review>;

const text = (max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().max(max));
const factOf = <T extends z.ZodTypeAny>(value: T) => z.object({ value, provenance, review }).strict();
export const FACT_KEYS = ['name', 'phone', 'email', 'address', 'hours', 'serviceAreas', 'primaryAction', 'description', 'years', 'licensed', 'insured', 'warranty', 'open24h', 'emergency'] as const;
export type FactKey = (typeof FACT_KEYS)[number];
/** statements that must be confirmed or left out before a site is published */
export const CLAIM_KEYS: FactKey[] = ['years', 'licensed', 'insured', 'warranty', 'open24h', 'emergency'];

export const factsSchema = z.object({
  name: factOf(text(120)),
  phone: factOf(text(30)).optional(),
  email: factOf(z.string().max(120)).optional(),
  address: factOf(text(200)).optional(),
  /** hours as Google lists them ("Monday: 7:00 AM – 5:00 PM"); owners confirm or leave them out */
  hours: factOf(z.array(text(80)).max(14)).optional(),
  serviceAreas: factOf(z.array(text(60)).max(20)).optional(),
  primaryAction: factOf(z.enum(GOALS)).optional(),
  description: factOf(text(400)).optional(),
  years: factOf(z.number().int().min(1).max(200)).optional(),
  licensed: factOf(z.boolean()).optional(),
  insured: factOf(z.boolean()).optional(),
  warranty: factOf(z.boolean()).optional(),
  open24h: factOf(z.boolean()).optional(),
  emergency: factOf(z.boolean()).optional(),
}).strict();
export type ContentFacts = z.infer<typeof factsSchema>;

export const MEDIA_ROLES = ['hero', 'gallery', 'team', 'logo', 'omit'] as const;
export const mediaSchema = z.object({
  /** the photo key (p_...) used by the design plan */
  key: z.string().regex(/^p_[a-f0-9]{6,12}$/),
  source: z.enum(['google', 'owner', 'website', 'sample']),
  /** who took it / where it is from, shown where required */
  attribution: z.object({ name: text(120), uri: z.string().max(300).optional() }).strict().optional(),
  /** may it appear on a published site? google: no (preview only); owner uploads: yes; sample: never */
  publishable: z.boolean(),
  alt: text(160),
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(),
  /** the owner's choice; absent = Roger decides */
  role: z.enum(MEDIA_ROLES).optional(),
  order: z.number().int().min(0).max(999),
  publicPath: z.string().max(200),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  uploadedAt: z.string().max(40).optional(),
}).strict();
export type MediaItem = z.infer<typeof mediaSchema>;

export const contentSchema = z.object({
  version: z.literal(CONTENT_VERSION),
  /** increases whenever a fact, an offering or media changes (not for appearance or layout) */
  revision: z.number().int().min(1),
  facts: factsSchema,
  media: z.array(mediaSchema).max(60),
  /** the content revision the owner last reviewed as a whole */
  reviewedRevision: z.number().int().min(0).optional(),
}).strict();
export type SiteContent = z.infer<typeof contentSchema>;

export const valueHash = (v: unknown) => createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
const fresh = (): Review => ({ status: 'unreviewed' });

/** text a schema limits in length, cut at a word so a long caption never invalidates the whole saved record */
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`.slice(0, max); };
/** Initial content from what the build found. Sample fixtures mark everything as sample. */
export function contentFromBuild(b: Business, f: Facts, photos: PhotoMeta[], opts: { description?: string; goal?: Goal; sample: boolean; fetchedAt: string }): SiteContent {
  // a business known only from its own website has no Google record behind its name, phone or address
  const listed: FactSource = b.source === 'website' ? 'website' : 'google';
  const src = (s: FactSource): Provenance => ({ source: opts.sample ? 'sample' : s === 'google' ? listed : s, ref: s === 'google' && listed === 'google' ? `place:${b.placeId}` : s === 'google' ? b.website : undefined, fetchedAt: opts.fetchedAt });
  const claim = (s: FactSource, conf: number): Provenance => ({ ...src(s), confidence: conf });
  const fromSite: FactSource = f.source === 'claude' ? 'claude' : 'website';
  const facts: ContentFacts = { name: { value: b.name, provenance: src('google'), review: fresh() } };
  if (b.phone) facts.phone = { value: b.phone, provenance: src('google'), review: fresh() };
  if (b.formattedAddress) facts.address = { value: b.formattedAddress, provenance: src('google'), review: fresh() };
  if (b.hours?.weekdayText?.length) facts.hours = { value: b.hours.weekdayText.slice(0, 14), provenance: src('google'), review: fresh() };
  const areas = [...new Set([f.city, ...f.serviceAreas, ...b.nearbyTowns].filter(Boolean) as string[])].slice(0, 20);
  if (areas.length) facts.serviceAreas = { value: areas, provenance: src(f.serviceAreas.length ? fromSite : 'google'), review: fresh() };
  if (opts.goal) facts.primaryAction = { value: opts.goal, provenance: { source: opts.sample ? 'sample' : 'owner', fetchedAt: opts.fetchedAt }, review: fresh() };
  if (opts.description) facts.description = { value: opts.description.slice(0, 400), provenance: src(b.editorialSummary ? 'google' : 'claude'), review: fresh() };
  if (f.years) facts.years = { value: f.years, provenance: claim(fromSite, 0.7), review: fresh() };
  for (const k of ['licensed', 'insured', 'warranty', 'open24h', 'emergency'] as const) {
    const v = k === 'open24h' ? f.open24h : f[k];
    if (v) facts[k] = { value: true, provenance: claim(k === 'open24h' ? 'google' : fromSite, 0.7), review: fresh() };
  }
  const media: MediaItem[] = photos.map((p, i) => ({
    key: p.key, source: opts.sample ? 'sample' : p.image.source === 'google' ? 'google' : 'website',
    attribution: p.image.credit ? { name: p.image.credit.replace(/^Photo:\s*/i, '') } : undefined,
    publishable: false, alt: clip(p.image.alt || `${b.name}, photo ${i + 1}`, 160), order: i, publicPath: p.image.publicPath, width: p.width, height: p.height,
  }));
  return { version: CONTENT_VERSION, revision: 1, facts, media };
}

/** A fact's effective state: a confirmation only counts for the value that was confirmed. */
export function factState<T>(f?: { value: T; review: Review }): ReviewState | 'missing' {
  if (!f) return 'missing';
  if ((f.review.status === 'confirmed' || f.review.status === 'corrected') && f.review.valueHash !== valueHash(f.value)) return 'unreviewed';
  return f.review.status;
}
export const isOmitted = (f?: { review: Review }) => f?.review.status === 'omitted';

const reviewEditSchema = z.object({
  key: z.enum(FACT_KEYS),
  action: z.enum(['confirm', 'correct', 'omit', 'restore']),
  value: z.unknown().optional(),
}).strict();

/**
 * Apply the owner's review of one fact. confirm: the current value is right; correct: a new value (validated) that
 * the owner states; omit: leave it off the site; restore: back to unreviewed.
 */
export function reviewFact(c: SiteContent, raw: unknown, now = new Date().toISOString()): SiteContent {
  const r = reviewEditSchema.safeParse(raw);
  if (!r.success) throw new ContentError(r.error.issues[0]?.message || 'invalid review');
  const { key, action } = r.data;
  const facts = { ...c.facts } as Record<string, any>;
  const cur = facts[key];
  let next: any;
  if (action === 'correct') {
    const shape = (factsSchema.shape as any)[key];
    const inner = (shape._def.innerType ?? shape).shape.value;
    const v = inner.safeParse(r.data.value);
    if (!v.success) throw new ContentError(`${key}: ${v.error.issues[0]?.message}`);
    next = { value: v.data, provenance: { source: 'owner', fetchedAt: now }, review: { status: 'corrected', valueHash: valueHash(v.data), contentRevision: c.revision + 1, at: now } };
  } else {
    if (!cur) throw new ContentError(`There is no ${key} to review`);
    if (cur.provenance.source === 'sample' && action === 'confirm') throw new ContentError('Sample content can\'t be confirmed as a real business fact. Correct it instead.');
    const status: ReviewState = action === 'confirm' ? 'confirmed' : action === 'omit' ? 'omitted' : 'unreviewed';
    next = { ...cur, review: { status, valueHash: valueHash(cur.value), contentRevision: c.revision + 1, at: now } };
  }
  if (key === 'name' && action === 'omit') throw new ContentError('The business name can\'t be left out');
  facts[key] = next;
  const parsed = factsSchema.safeParse(facts);
  if (!parsed.success) throw new ContentError(parsed.error.issues[0]?.message || 'invalid fact');
  return { ...c, facts: parsed.data, revision: c.revision + 1 };
}

const mediaEditSchema = z.object({
  key: z.string().regex(/^p_[a-f0-9]{6,12}$/),
  role: z.enum(MEDIA_ROLES).nullable().optional(),
  alt: text(160).optional(),
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().nullable().optional(),
  order: z.number().int().min(0).max(999).optional(),
  /** "this photo is mine to publish": only for pictures taken from the owner's current website */
  ownership: z.literal('mine').optional(),
}).strict();

export function editMedia(c: SiteContent, raw: unknown): SiteContent {
  const r = mediaEditSchema.safeParse(raw);
  if (!r.success) throw new ContentError(r.error.issues[0]?.message || 'invalid media change');
  const i = c.media.findIndex((m) => m.key === r.data.key);
  if (i < 0) throw new ContentError('No such photo');
  const m = { ...c.media[i] };
  if (r.data.role !== undefined) { if (r.data.role === null) delete m.role; else m.role = r.data.role; }
  if (r.data.alt !== undefined) m.alt = r.data.alt || m.alt;
  if (r.data.focal !== undefined) { if (r.data.focal === null) delete m.focal; else m.focal = r.data.focal; }
  if (r.data.order !== undefined) m.order = r.data.order;
  if (r.data.ownership === 'mine') {
    if (m.source !== 'website') throw new ContentError('Only photos taken from your current website can be confirmed this way. Upload your own photo instead.');
    m.publishable = true;
  }
  const media = c.media.slice();
  media[i] = m;
  // one hero and one team photo at a time
  if (m.role === 'hero' || m.role === 'team') for (const x of media) if (x !== m && x.role === m.role) delete x.role;
  return { ...c, media, revision: c.revision + 1 };
}

export class ContentError extends Error {}

/** After a rebuild: keep the owner's choices for photos still there and their uploads; add newly found photos. */
export function mergeMedia(c: SiteContent, fresh: SiteContent): SiteContent {
  const old = new Map(c.media.map((m) => [m.key, m]));
  const kept = fresh.media.map((m) => ({ ...m, ...(old.get(m.key) ? { role: old.get(m.key)!.role, alt: old.get(m.key)!.alt, focal: old.get(m.key)!.focal, order: old.get(m.key)!.order } : {}) }));
  const uploads = c.media.filter((m) => m.source === 'owner' && !kept.some((k) => k.key === m.key));
  return { ...c, media: [...uploads, ...kept] };
}

/** Older drafts without content get it from their stored build data. */
export function upgradeContent(raw: unknown): SiteContent | undefined {
  const r = contentSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

/**
 * Corrections and omissions applied to the data the page is composed from. Omitted claims are removed; corrected
 * values replace the scraped ones. Returns copies (the stored business data is never modified).
 */
export function applyContent(b: Business, f: Facts, c: SiteContent | undefined): { business: Business; facts: Facts } {
  if (!c) return { business: b, facts: f };
  const business: Business = { ...b };
  const facts: Facts = { ...f };
  const F = c.facts;
  if (F.name && factState(F.name) === 'corrected') business.name = F.name.value;
  if (F.phone) { if (isOmitted(F.phone)) { business.phone = undefined; business.phoneE164 = undefined; } else if (factState(F.phone) === 'corrected') { business.phone = F.phone.value; business.phoneE164 = undefined; } }
  if (F.address) { if (isOmitted(F.address)) { business.formattedAddress = undefined; business.street = undefined; } else if (factState(F.address) === 'corrected') { business.formattedAddress = F.address.value; business.street = F.address.value.split(',')[0]; } }
  if (F.hours && isOmitted(F.hours)) business.hours = undefined;
  if (F.serviceAreas) { if (isOmitted(F.serviceAreas)) { facts.serviceAreas = []; business.nearbyTowns = []; } else if (factState(F.serviceAreas) === 'corrected') { facts.serviceAreas = F.serviceAreas.value; business.nearbyTowns = []; } }
  if (F.description) { if (isOmitted(F.description)) business.editorialSummary = undefined; else if (factState(F.description) === 'corrected') business.editorialSummary = F.description.value; }
  if (F.years) facts.years = isOmitted(F.years) ? undefined : F.years.value;
  for (const k of ['licensed', 'insured', 'warranty', 'open24h', 'emergency'] as const) {
    const x = F[k];
    if (!x) continue;
    if (isOmitted(x)) (facts as any)[k] = false;
    else if (factState(x) === 'corrected') (facts as any)[k] = x.value;
  }
  return { business, facts };
}

export interface ReadinessItem { key: string; level: 'blocker' | 'warning'; message: string }

/**
 * What stops a real publication. Optional things (no photos, prices on request) are not blockers; unconfirmed
 * claims, sample content and unreviewed contact details are.
 */
export function publishReadiness(c: SiteContent | undefined, offerings: Offering[], review?: { checks?: { id: string; level: string; message: string }[]; leadTested?: boolean; leadNotified?: boolean }): ReadinessItem[] {
  const out: ReadinessItem[] = [];
  // what the build itself found: blocks stop a publication, items for review are shown to the owner first
  for (const k of review?.checks ?? []) {
    if (k.level === 'block') out.push({ key: `build:${k.id}`, level: 'blocker', message: k.message });
    else if (k.level === 'review') out.push({ key: `build:${k.id}`, level: 'warning', message: k.message });
  }
  if (review && review.leadTested === false) out.push({ key: 'lead-test', level: 'blocker', message: 'Send a test enquiry: a visitor\'s message must reach you before the site is published.' });
  // a saved enquiry that reaches nobody is a lost customer: without a delivery channel the site can't be published
  if (review && review.leadNotified === false) out.push({ key: 'lead-delivery', level: 'blocker', message: 'Enquiries would be saved but nobody would be told: set up where they are sent (an email address, or a webhook) before publishing.' });
  if (!c) return [{ key: 'content', level: 'blocker', message: 'The business details haven\'t been reviewed yet.' }];
  const F = c.facts as Record<string, { value: unknown; provenance: Provenance; review: Review } | undefined>;
  for (const [k, f] of Object.entries(F)) {
    if (!f) continue;
    if (f.provenance.source === 'sample' && factState(f as any) !== 'corrected' && factState(f as any) !== 'omitted') out.push({ key: k, level: 'blocker', message: `"${k}" is sample data: correct it or leave it out.` });
  }
  const mustReview: FactKey[] = ['name', 'phone', 'address', 'hours', 'primaryAction', ...CLAIM_KEYS];
  for (const k of mustReview) {
    const f = F[k];
    if (!f) continue;
    const s = factState(f as any);
    if (s === 'unreviewed') out.push({ key: k, level: 'blocker', message: `${LABEL[k]}: confirm, correct or leave it out.` });
  }
  if (!F.phone && !F.address && !F.email) out.push({ key: 'contact', level: 'blocker', message: 'Add at least one way to reach you (phone, address or email).' });
  for (const o of offerings) {
    if (o.source === 'sample') out.push({ key: `offering:${o.id}`, level: 'blocker', message: `"${o.name}" is a sample ${o.price.kind === 'quote' ? 'item' : 'price'}: replace or remove it.` });
    else if (o.price.kind !== 'quote' && o.source !== 'owner') out.push({ key: `offering:${o.id}`, level: 'blocker', message: `Confirm the price of "${o.name}" (${o.source === 'website' ? 'from your website' : 'not from you'}).` });
  }
  for (const m of c.media) if (m.source === 'sample' && m.role !== 'omit') out.push({ key: `media:${m.key}`, level: 'warning', message: 'A sample photo will be left out of the published site.' });
  // a picture shown in the preview is not thereby cleared for publication: "found on your website" and "via Google" are where it came from, not proof it may be published
  const unconfirmed = (src: MediaItem['source']) => c.media.filter((m) => m.source === src && !m.publishable && m.role !== 'omit');
  const web = unconfirmed('website'), goog = unconfirmed('google');
  if (web.length) out.push({ key: 'media-website', level: 'blocker', message: `${web.length} photo${web.length > 1 ? 's' : ''} from your current website ${web.length > 1 ? 'are' : 'is'} not confirmed as yours to publish. Confirm each one, leave it out, or upload your own.` });
  if (goog.length) out.push({ key: 'media', level: 'blocker', message: `${goog.length} photo${goog.length > 1 ? 's' : ''} from Google can't be published without the photographer's permission. Leave ${goog.length > 1 ? 'them' : 'it'} out or upload your own.` });
  const svc = offerings.filter((o) => o.image && o.image.source === 'website' && !o.image.confirmed);
  if (svc.length) out.push({ key: 'service-images', level: 'blocker', message: `${svc.length} service picture${svc.length > 1 ? 's' : ''} came from your website and ${svc.length > 1 ? 'are' : 'is'} not confirmed as yours to publish: ${svc.slice(0, 4).map((o) => o.name).join(', ')}.` });
  if (!c.media.some((m) => m.publishable && m.role !== 'omit')) out.push({ key: 'media-none', level: 'warning', message: 'No photos of your own yet: the published site will use a text-only design.' });
  return out;
}

const LABEL: Record<string, string> = {
  name: 'Business name', phone: 'Phone', email: 'Email', address: 'Address', hours: 'Opening hours', serviceAreas: 'Service areas', primaryAction: 'Main action',
  description: 'Description', years: 'Years in business', licensed: 'Licensed', insured: 'Insured', warranty: 'Warranty', open24h: 'Open 24 hours', emergency: 'Emergency service',
};
export const factLabel = (k: string) => LABEL[k] || k;
