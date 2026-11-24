import { createHash } from 'node:crypto';
import type { Business, WebsiteScan } from './types.js';
import type { SiteContent, SourceImage, SourceService } from './sources/site-content.js';
import { imageKey, nameKey, phoneKey } from './sources/site-content.js';
import type { CrawledPage } from './sources/crawl.js';
import type { BrandProfile } from './sources/brand-profile.js';
import type { ImageRecord } from './sources/site-images.js';
import type { ServiceImageRecord } from './sources/service-images.js';

/**
 * The evidence behind a generated site. Every business fact, service and picture is stored with where it was seen
 * (page, element or listing field), when, how sure the reading is and whether it holds up, instead of only the final
 * words. The site is composed from this model; the review and publication rules read it. Unknown is null, never false.
 */
export type EvStatus = 'verified' | 'conflicting' | 'needs_review' | 'rejected';
export type SourceType = 'website' | 'business_profile' | 'owner' | 'inference';

export interface Evidence<T> {
  value: T;
  sourceUrl: string;
  sourceType: SourceType;
  /** the page heading, DOM element or listing field it came from */
  locator?: string;
  observedAt: string;
  confidence: number;
  status: EvStatus;
  note?: string;
}

export interface ServiceMention { kind: 'home-card' | 'menu' | 'service-page' | 'page-text' | 'inferred'; url: string; locator?: string }
export interface ServiceRecord {
  id: string;
  canonicalName: string;
  aliases: string[];
  description?: Evidence<string>;
  /** 1 is the first service the business shows; the primary services are shown as cards */
  priority: number;
  sourcePages: string[];
  destination?: string;
  imageIds: string[];
  isPrimary: boolean;
  /** a service whose page covers several (a hail-damage page for "Hail & Wind Damage" and "Insurance Claim Assistance") */
  group?: string;
  /** verified: the business shows it itself; needs_review: only a keyword or a model suggested it */
  status: EvStatus;
  mentions: ServiceMention[];
}

export type AssetKind = 'logo' | 'hero' | 'service' | 'project' | 'team' | 'stock' | 'other';
export interface AssetRecord {
  id: string;
  sourceUrl: string;
  localPath?: string;
  kind: AssetKind;
  subject: string;
  serviceIds: string[];
  pageContext: string;
  provenance: 'first_party' | 'business_profile' | 'stock' | 'unknown';
  /** the business's own page presents it as its work (a projects page with the picture in it) */
  projectVerified: boolean;
  usable: boolean;
  rejectionReason?: string;
  /** whether it may be shown: the business's own website pictures, in a preview or with the owner's confirmation */
  permission: 'business_site' | 'google_preview_only' | 'unknown';
  confidence: number;
  alt?: string;
  fetch?: { status?: number; width?: number; height?: number; error?: string };
}

/**
 * An offer the business makes ("Get a free roof inspection"): where it came from, where it goes, its terms, and the
 * services it is explicitly offered for. A shared word ("roof") does not make an offer apply to a service: only the
 * business showing the offer on that service's own page, or in its own description of it, does.
 */
export interface Offer {
  id: string;
  label: string;
  destination: { kind: string; href: string };
  terms?: string;
  source: Evidence<string>;
  eligible: { service: string; evidenceUrl: string; locator: string }[];
}

export interface EvidenceModel {
  version: 1;
  buildVersion: string;
  sourceSnapshot: { id: string; at: string; url: string; pages: string[] };
  identity: Evidence<{ name: string; phone?: string; address?: string }>;
  brand: { colors: Record<string, string>; fonts: string[]; sources: string[]; confidence: 'high' | 'medium' | 'low' | 'none' };
  services: ServiceRecord[];
  assets: AssetRecord[];
  claims: Record<string, Evidence<unknown> | undefined>;
  /** where the website and the business listing disagree */
  conflicts: { field: string; values: { source: string; value: string }[] }[];
  offers: Offer[];
  hero?: { headline: string; sourceUrl: string; primaryCta?: { label: string; href: string; kind: string; terms?: string }; secondaryCta?: { label: string; href: string; kind: string } };
  /** projects the business shows as its own work */
  projectsVerified: boolean;
}

export const BUILD_VERSION = 'evidence-1';
const now = () => new Date().toISOString();

// ───────────────────────── services ─────────────────────────
/** words that make "Hail & Wind Damage" and "Wind and Hail Damage" the same service */
const tokenKey = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !['and', 'the', 'of', 'services', 'service'].includes(t)).map((t) => t.replace(/s$/, '')).sort().join(' ');
const NAV_NOT_SERVICE = /^(?:home|about(?: us)?|contact(?: us)?|recent projects?|projects?|our work|see our work|gallery|blog|news|get a free (?:estimate|quote|inspection)|call(?: us)?(?: today)?|reviews?|faq|careers|services|our services|roofing services|menu|search|book(?: now)?|financing|areas? we serve|service areas?)$/i;
const SERVICE_HINT = /(repair|replace|install|inspect|damage|restor|mitigat|claim|assist|remov|clean|treat|therap|maint|remodel|construct|paint|plumb|electr|hvac|roof|gutter|siding|window|door|floor|landscap|cabinet|kitchen|bath)/i;
const idOf = (name: string) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'service';

export interface ServiceInputs {
  homeUrl: string;
  content: SiteContent;
  crawl?: CrawledPage[];
  /** services the business's own page text names (read from the page and checked against it): shown, but marked as read from prose, not from a list */
  textServices?: { name: string; description?: string }[];
  /** services a model or keyword rules suggested: kept only as proposals */
  inferred?: { name: string; description?: string }[];
}

/**
 * One deduplicated service inventory from the home page's cards, the menu and the service pages. The cards the
 * business leads with are its primary services, in its order; menu-only services are secondary; anything only
 * inferred stays a proposal for review and is not shown.
 */
export function reconcileServices(i: ServiceInputs): ServiceRecord[] {
  const out: ServiceRecord[] = [];
  const at = now();
  const find = (name: string) => out.find((s) => tokenKey(s.canonicalName) === tokenKey(name) || s.aliases.some((a) => tokenKey(a) === tokenKey(name)));
  const add = (name: string, init: Partial<ServiceRecord> & { mention: ServiceMention }) => {
    const hit = find(name);
    if (hit) { hit.mentions.push(init.mention); if (!hit.aliases.includes(name) && name !== hit.canonicalName) hit.aliases.push(name); if (init.destination && !hit.destination) hit.destination = init.destination; if (init.mention.url && !hit.sourcePages.includes(init.mention.url)) hit.sourcePages.push(init.mention.url); return hit; }
    const rec: ServiceRecord = { id: idOf(name), canonicalName: name, aliases: [], priority: 0, sourcePages: [init.mention.url], destination: init.destination, imageIds: [], isPrimary: false, status: 'verified', mentions: [init.mention], ...init };
    delete (rec as Partial<ServiceRecord> & { mention?: unknown }).mention;
    out.push(rec);
    return rec;
  };
  // 1) what the home page leads with, in its order
  i.content.services.forEach((s, n) => {
    const r = add(s.name, { mention: { kind: 'home-card', url: i.homeUrl, locator: s.locator ?? `${s.method}: ${s.name}` }, destination: s.href || s.pageUrl, priority: n + 1, isPrimary: true });
    if (s.description) r.description = { value: s.description, sourceUrl: i.homeUrl, sourceType: 'website', locator: s.locator, observedAt: at, confidence: 0.9, status: 'verified' };
  });
  const primaryCount = out.length;
  // 2) the menu: services the home page doesn't lead with are secondary; shared destinations make a group
  const crawl = i.crawl ?? [];
  let secondary = 100;
  for (const n of i.content.nav) {
    if (NAV_NOT_SERVICE.test(n.name.trim()) || n.name.length < 4) continue;
    const page = crawl.find((p) => p.url.replace(/\/$/, '') === n.href.replace(/[#?].*$/, '').replace(/\/$/, ''));
    const serviceish = SERVICE_HINT.test(n.name) || page?.type === 'services';
    if (!serviceish) continue;
    const hit = find(n.name);
    if (hit) { hit.mentions.push({ kind: 'menu', url: i.homeUrl, locator: `menu: ${n.parent ? `${n.parent} > ` : ''}${n.name}` }); continue; }
    // a menu entry whose page the cards already point at is the group those cards belong to ("Storm Damage")
    const sharing = out.filter((s) => s.isPrimary && s.destination && s.destination.replace(/[#?].*$/, '').replace(/\/$/, '') === n.href.replace(/[#?].*$/, '').replace(/\/$/, ''));
    if (sharing.length >= 2) { for (const s of sharing) s.group ||= n.name; continue; }
    if (/^(roofing|services?)$/i.test(n.name.trim())) continue; // a menu heading, not a service
    add(n.name, { mention: { kind: 'menu', url: i.homeUrl, locator: `menu: ${n.parent ? `${n.parent} > ` : ''}${n.name}` }, destination: n.href, priority: ++secondary, isPrimary: false });
  }
  // 3) service pages confirm what they are about and can show more
  for (const p of crawl.filter((x) => x.ok && x.type === 'services')) {
    const hit = (p.h1 && find(p.h1)) || out.find((s) => s.destination && s.destination.replace(/[#?].*$/, '').replace(/\/$/, '') === p.url.replace(/\/$/, ''));
    if (hit) { hit.mentions.push({ kind: 'service-page', url: p.url, locator: `h1 "${p.h1 ?? ''}"` }); if (!hit.sourcePages.includes(p.url)) hit.sourcePages.push(p.url); if (!hit.description && p.description) hit.description = { value: p.description, sourceUrl: p.url, sourceType: 'website', locator: 'meta description', observedAt: at, confidence: 0.7, status: 'verified' }; }
    // a service listed on a service page is explicitly offered when it has a page of its own that is about it; a name that only
    // appears in a list, or whose page was not read, is a mention: it is kept for the owner to confirm and not shown
    for (const c of p.cards) {
      if (find(c.name)) continue;
      const own = c.href ? crawl.find((x) => x.ok && x.url.replace(/[#?].*$/, '').replace(/\/$/, '') === c.href!.replace(/[#?].*$/, '').replace(/\/$/, '')) : undefined;
      const about = !!own?.h1 && (tokenKey(own.h1) === tokenKey(c.name) || tokenKey(own.h1).includes(tokenKey(c.name)) || tokenKey(c.name).includes(tokenKey(own.h1)));
      add(c.name, { mention: { kind: 'service-page', url: p.url, locator: c.locator }, destination: c.href, priority: ++secondary, isPrimary: false, status: about ? 'verified' : 'needs_review' });
    }
  }
  // 3b) a site with no list of services (a restaurant's page, a one-page practice) names them in its text: those are its services
  const structured = i.content.services.length > 0;
  // a name carrying the business's own name ("Veracruz Fonda & Bar") is a sister business or another location, not something it offers: for review
  const GENERIC = new Set(['natural', 'local', 'family', 'company', 'services', 'service', 'restaurant', 'studio', 'center', 'centre', 'clinic', 'group']);
  const brand = new Set((i.content.identity?.name ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !GENERIC.has(w)));
  const ownName = (name: string) => name.toLowerCase().split(/[^a-z]+/).some((w) => brand.has(w));
  for (const s of i.textServices ?? []) {
    if (find(s.name)) continue;
    const sister = ownName(s.name);
    const r = add(s.name, { mention: { kind: sister ? 'inferred' : 'page-text', url: i.homeUrl, locator: sister ? "named like the business itself: another location or a sister business, not a service" : "named in the page's own text" }, priority: structured || sister ? ++secondary : out.length + 1, isPrimary: !structured && !sister, status: sister ? 'needs_review' : 'verified' });
    if (s.description) r.description = { value: s.description, sourceUrl: i.homeUrl, sourceType: 'website', observedAt: at, confidence: 0.6, status: 'verified' };
  }
  // 4) proposals only: nothing the business shows itself
  for (const s of i.inferred ?? []) {
    if (find(s.name)) continue;
    const r = add(s.name, { mention: { kind: 'inferred', url: i.homeUrl, locator: 'suggested from the business category or reviews' }, priority: ++secondary, isPrimary: false, status: 'needs_review' });
    if (s.description) r.description = { value: s.description, sourceUrl: i.homeUrl, sourceType: 'inference', observedAt: at, confidence: 0.3, status: 'needs_review' };
  }
  void primaryCount;
  return out;
}

// ───────────────────────── assets ─────────────────────────
const STOCK = /pexels|shutterstock|istock|unsplash|gettyimages|stock[-_ ]?photo|depositphotos|adobestock/i;
const subjectOf = (alt: string | undefined, url: string) => {
  const a = (alt ?? '').trim();
  if (a && !/^(img|image|service|icon|photo|picture)$/i.test(a) && !/\.(jpe?g|png|webp)$/i.test(a)) return a;
  const f = decodeURIComponent(url.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\d{2,4}x\d{2,4}\b|\bscaled\b|\be\d{6,}\b/gi, '').trim();
  return f.slice(0, 80);
};
const aid = (url: string) => `a_${createHash('sha1').update(imageKey(url)).digest('hex').slice(0, 8)}`;

export interface AssetInputs {
  homeUrl: string;
  content: SiteContent;
  crawl?: CrawledPage[];
  services: ServiceRecord[];
  imageRecords?: ImageRecord[];
  serviceImageRecords?: ServiceImageRecord[];
  logoUrl?: string;
  googlePhotos?: number;
}

export function buildAssets(i: AssetInputs): { assets: AssetRecord[]; projectsVerified: boolean } {
  const assets = new Map<string, AssetRecord>();
  const put = (a: AssetRecord) => { const k = imageKey(a.sourceUrl); const prior = assets.get(k); if (!prior || (prior.kind === 'other' && a.kind !== 'other')) assets.set(k, a); };
  const fetched = new Map((i.imageRecords ?? []).map((r) => [imageKey(r.url), r]));
  const svcFetched = new Map((i.serviceImageRecords ?? []).map((r) => [imageKey(r.url), r]));
  const provenanceOf = (url: string): AssetRecord['provenance'] => (STOCK.test(url) ? 'stock' : 'first_party');
  const fromFetch = (url: string): Pick<AssetRecord, 'usable' | 'rejectionReason' | 'fetch'> => {
    const r = fetched.get(imageKey(url)) ?? svcFetched.get(imageKey(url));
    if (!r) return { usable: true };
    const reason = !r.ok ? ('error' in r && r.error ? String(r.error) : 'download failed') : 'skipped' in r && r.skipped ? String(r.skipped) : undefined;
    return { usable: r.ok && !('skipped' in r && r.skipped), rejectionReason: reason, fetch: { status: r.status, width: r.width, height: r.height, error: 'error' in r ? r.error : undefined } };
  };
  if (i.logoUrl) put({ id: aid(i.logoUrl), sourceUrl: i.logoUrl, kind: 'logo', subject: 'logo', serviceIds: [], pageContext: i.homeUrl, provenance: 'first_party', projectVerified: false, usable: true, permission: 'business_site', confidence: 0.9 });
  const hero = i.content.hero?.image;
  if (hero) put({ id: aid(hero.url), sourceUrl: hero.url, kind: 'hero', subject: subjectOf(hero.alt, hero.url), serviceIds: [], pageContext: `${i.homeUrl} (the picture in the hero)`, provenance: provenanceOf(hero.url), projectVerified: false, ...fromFetch(hero.url), permission: 'business_site', confidence: 0.85, alt: hero.alt });
  for (const s of i.services) {
    const src = i.content.services.find((x) => nameKey(x.name) === nameKey(s.canonicalName) || tokenKey(x.name) === tokenKey(s.canonicalName));
    if (!src?.image) continue;
    const rec: AssetRecord = { id: aid(src.image.url), sourceUrl: src.image.url, kind: 'service', subject: subjectOf(src.image.alt, src.image.url), serviceIds: [s.id], pageContext: `${i.homeUrl} (the picture on the "${src.name}" card)`, provenance: provenanceOf(src.image.url), projectVerified: false, ...fromFetch(src.image.url), permission: 'business_site', confidence: 0.85, alt: src.image.alt };
    put(rec);
    s.imageIds.push(rec.id);
  }
  // a projects page's own pictures are the business's presented work
  let projectsVerified = false;
  for (const p of (i.crawl ?? []).filter((x) => x.ok && x.type === 'projects')) {
    for (const im of p.images.slice(0, 30)) {
      const prov = provenanceOf(im.url);
      const verified = prov === 'first_party' && !!(im.alt || im.caption);
      if (verified) projectsVerified = true;
      put({ id: aid(im.url), sourceUrl: im.url, kind: verified ? 'project' : prov === 'stock' ? 'stock' : 'other', subject: subjectOf(im.alt || im.caption, im.url), serviceIds: [], pageContext: `${p.url} (${p.h1 ?? 'projects page'})`, provenance: prov, projectVerified: verified, usable: true, permission: 'business_site', confidence: verified ? 0.8 : 0.4, alt: im.alt });
    }
  }
  for (const im of i.content.images as SourceImage[]) {
    if (im.role === 'logo' || im.role === 'icon' || im.role === 'social' || im.role === 'service' || im.role === 'poster') continue;
    const prov = provenanceOf(im.url);
    put({ id: aid(im.url), sourceUrl: im.url, kind: im.role === 'team' ? 'team' : prov === 'stock' ? 'stock' : 'other', subject: subjectOf(im.alt, im.url), serviceIds: [], pageContext: `${i.homeUrl} (${im.origin})`, provenance: prov, projectVerified: false, ...fromFetch(im.url), permission: 'business_site', confidence: 0.6, alt: im.alt });
  }
  if (i.googlePhotos) put({ id: 'a_google', sourceUrl: 'business-profile:photos', kind: 'other', subject: `${i.googlePhotos} photos on the business listing`, serviceIds: [], pageContext: 'business profile', provenance: 'business_profile', projectVerified: false, usable: true, permission: 'google_preview_only', confidence: 0.6 });
  return { assets: [...assets.values()], projectsVerified };
}

// ───────────────────────── the model ─────────────────────────
export interface ModelInputs {
  scan: WebsiteScan;
  business: Business;
  services: ServiceRecord[];
  assets: AssetRecord[];
  projectsVerified: boolean;
  brand?: BrandProfile;
}

const ev = <T,>(value: T, sourceUrl: string, sourceType: SourceType, extra: Partial<Evidence<T>> = {}): Evidence<T> => ({ value, sourceUrl, sourceType, observedAt: now(), confidence: 0.8, status: 'verified', ...extra });

const phraseKey = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Of the services an offer is shown on, the one whose card carries the offer button: the service the business itself
 * sends to the offer's booking form, else the one whose name is most like what the offer is for. Every other eligible
 * service keeps the association in the data but its card links to the service. One button, not one per card.
 */
export function featuredService(offer: Offer | undefined, services: ServiceRecord[]): string | undefined {
  if (!offer?.eligible.length) return undefined;
  const core = new Set(tokenKey(offer.label).split(' ').filter((t) => t.length > 3));
  const score = (name: string) => {
    const s = services.find((x) => x.canonicalName === name);
    const toForm = s?.destination?.includes('#') && ['form', 'anchor'].includes(offer.destination.kind) ? 10 : 0;
    const alike = tokenKey(name).split(' ').filter((t) => core.has(t)).length;
    return toForm + alike - (s?.priority ?? 0) / 1000;
  };
  return serviceKey([...offer.eligible].sort((a, b) => score(b.service) - score(a.service))[0].service);
}

/** The hero's main action as an offer, with the services it is shown for on the business's own pages. */
export function buildOffers(i: { homeUrl: string; hero?: { primary?: { label: string; href: string; kind: string; terms?: string } }; crawl: CrawledPage[]; services: ServiceRecord[] }): Offer[] {
  const p = i.hero?.primary;
  if (!p) return [];
  const label = phraseKey(p.label);
  // the offer itself, without its verb ("get a free roof inspection" → "free roof inspection"): how a page names it
  const core = label.replace(/^(?:(?:get|request|book|schedule|claim|start|your|my|a|an|our|now|today)\s+)+/, '') || label;
  const mentions = (t: string) => t.split(core).length - 1;
  const eligible: Offer['eligible'] = [];
  for (const s of i.services.filter((x) => x.status === 'verified')) {
    const dest = s.destination?.replace(/[#?].*$/, '').replace(/\/$/, '');
    const page = dest ? i.crawl.find((c) => c.ok && c.url.replace(/[#?].*$/, '').replace(/\/$/, '') === dest) : undefined;
    const cta = page?.ctas?.find((c) => phraseKey(c.label).includes(core));
    if (page && cta) { eligible.push({ service: s.canonicalName, evidenceUrl: page.url, locator: `button "${cta.label}" in the service page's content` }); continue; }
    if (page?.text && mentions(phraseKey(page.text)) >= 2) { eligible.push({ service: s.canonicalName, evidenceUrl: page.url, locator: `"${core}" named ${mentions(phraseKey(page.text))} times in the service page's own text` }); continue; }
    // the business sends this service's own link to the same booking form as the offer
    if (s.destination?.includes('#') && s.destination.replace(/#.*$/, '').replace(/\/$/, '') === i.homeUrl.replace(/\/$/, '') && ['form', 'anchor'].includes(p.kind)) { eligible.push({ service: s.canonicalName, evidenceUrl: i.homeUrl, locator: `the service's own link (${s.destination.replace(i.homeUrl, '')}) goes to the booking form` }); continue; }
    if (s.description && phraseKey(s.description.value).includes(core)) eligible.push({ service: s.canonicalName, evidenceUrl: i.homeUrl, locator: `"${p.label}" in the home page's description of the service` });
  }
  return [{ id: 'primary', label: p.label, destination: { kind: p.kind, href: p.href }, terms: p.terms, source: ev(p.label, i.homeUrl, 'website', { locator: `hero button "${p.label}"`, confidence: 0.9 }), eligible }];
}

export function buildEvidenceModel(i: ModelInputs): EvidenceModel {
  const c = i.scan.content!;
  const home = i.scan.finalUrl;
  const b = i.business;
  const conflicts: EvidenceModel['conflicts'] = [];
  if (c.phones.primary && b.phone && b.source !== 'website' && phoneKey(c.phones.primary) !== phoneKey(b.phone)) conflicts.push({ field: 'phone', values: [{ source: 'website', value: c.phones.primary }, { source: 'business listing', value: b.phone }] });
  if (c.address && b.formattedAddress && b.source !== 'website' && !b.formattedAddress.includes(c.address.zip)) conflicts.push({ field: 'address', values: [{ source: 'website', value: c.address.formatted }, { source: 'business listing', value: b.formattedAddress }] });
  const claims: EvidenceModel['claims'] = {};
  for (const cl of c.claims) claims[cl.key] = ev(cl.text, home, 'website', { locator: cl.locator, confidence: 0.85 });
  if (c.hero?.primary?.terms === 'free') claims.freeOffer = ev(c.hero.primary.label, home, 'website', { locator: `hero button "${c.hero.primary.label}"`, confidence: 0.9 });
  if (c.areas) claims.serviceArea = ev({ region: c.areas.region, places: c.areas.places }, home, 'website', { locator: c.areas.sources.join(', '), confidence: 0.85 });
  // hours on the business listing are office hours: they say nothing about phone answering or emergency dispatch
  if (b.hours?.weekdayText?.length) claims.listingHours = ev(b.hours.weekdayText, 'business-profile', 'business_profile', { locator: 'regularOpeningHours', confidence: 0.7 });
  claims.emergencyResponse = c.claims.some((x) => /emergency|24/i.test(x.text)) ? ev('stated on the website', home, 'website', { confidence: 0.7 }) : ev(null, home, 'website', { status: 'needs_review', confidence: 0, note: 'not stated on the website: unknown, not "no"' });
  claims.rating = b.rating ? ev({ rating: b.rating, count: b.reviewCount }, 'business-profile', 'business_profile', { locator: 'rating', confidence: 0.7 }) : undefined;
  claims.reviews = c.testimonials.length ? ev(c.testimonials.map((t) => ({ author: t.author })), home, 'website', { locator: c.testimonials[0].locator, confidence: 0.8 }) : undefined;
  const br = i.brand;
  return {
    version: 1,
    buildVersion: BUILD_VERSION,
    sourceSnapshot: { id: createHash('sha1').update(`${home}|${c.identity.name}|${c.services.map((s) => s.name).join(',')}|${new Date().toISOString().slice(0, 13)}`).digest('hex').slice(0, 10), at: now(), url: home, pages: [home, ...((i.scan.crawl?.pages ?? []).filter((p) => p.ok).map((p) => p.url))] },
    identity: ev({ name: b.name, phone: b.phone, address: b.formattedAddress }, home, b.source === 'website' ? 'website' : 'business_profile', { locator: b.identity?.evidence.join('; '), status: b.identity?.status === 'verified' || b.identity?.status === 'website-only' ? 'verified' : 'needs_review', confidence: b.identity?.status === 'verified' ? 0.95 : 0.7 }),
    brand: { colors: Object.fromEntries([['primary', br?.primary?.hex], ['secondary', br?.secondary?.hex], ['buttonFill', br?.button?.fill], ['buttonText', br?.button?.text]].filter(([, v]) => v) as [string, string][]), fonts: [br?.typography?.heading?.family, br?.typography?.body?.family].filter(Boolean) as string[], sources: br?.primary?.evidence.map((e) => `${e.where}: ${e.detail}`) ?? [], confidence: br?.primary?.confidence ?? 'none' },
    services: i.services,
    assets: i.assets,
    claims,
    conflicts,
    offers: buildOffers({ homeUrl: home, hero: c.hero, crawl: i.scan.crawl?.pages ?? [], services: i.services }),
    hero: c.hero ? { headline: c.hero.headline, sourceUrl: home, primaryCta: c.hero.primary, secondaryCta: c.hero.secondary } : undefined,
    projectsVerified: i.projectsVerified,
  };
}

// ───────────────────────── review rules ─────────────────────────
export interface EvidenceFinding { id: string; level: 'block' | 'review'; message: string }

/** Headline relevance: does it say what the business is or does? A business type or a service it offers must appear. */
export function headlineRelevant(headline: string, ctx: { typeLabel?: string; services: string[] }): boolean {
  const h = headline.toLowerCase();
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !['service', 'services', 'damage', 'central', 'local'].includes(w));
  const hits = new Set<string>();
  // a word's stem, so "Chiropractor" (the listing's type) and "chiropractic" (the headline) are the same word
  const stem = (w: string) => w.replace(/(?:ors?|ers?|ics?|ies|s)$/, '');
  for (const w of [...words(ctx.typeLabel ?? ''), ...ctx.services.flatMap(words)]) if (h.includes(stem(w))) hits.add(w);
  // a whole service name in the headline ("Tacos in Austin") says what the business does on its own
  if (ctx.services.some((s) => { const w = words(s); return w.length > 0 && w.every((x) => h.includes(x.replace(/s$/, ''))); })) return true;
  return hits.size >= 1 && (ctx.services.length < 2 || hits.size >= 2 || (ctx.typeLabel ? words(ctx.typeLabel).some((w) => h.includes(stem(w))) : false));
}

/** A one-word label that names no service on its own ("Installation", "Maintenance", "Tankless"). */
const VAGUE = new Set(['installation', 'installations', 'install', 'installs', 'maintenance', 'repair', 'repairs', 'replacement', 'replacements', 'service', 'services', 'inspection', 'inspections', 'cleaning', 'tankless', 'upgrades', 'upgrade', 'emergency', 'commercial', 'residential', 'other', 'more', 'misc', 'general', 'consultation', 'estimates', 'estimate']);
export const vagueService = (name: string) => { const w = name.toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean); return w.length === 1 && VAGUE.has(w[0]); };
/** A menu link to a list, not a service: "Every plumbing service we offer", "All indoor air quality services". */
const MENU_PHRASE = /^(?:every|all|other|more)\b.*\b(?:services?|we offer|options)$/i;
/** Rooms and places in a home: where work happens, not what the work is ("Bathrooms", "Kitchens"). */
const ROOMS = new Set(['bathroom', 'bathrooms', 'kitchen', 'kitchens', 'basement', 'basements', 'attic', 'attics', 'garage', 'garages', 'outdoor', 'outdoors', 'indoor', 'indoors', 'exterior', 'interior', 'home', 'homes', 'business', 'businesses']);
/** The trade named as people: "Austin Plumbers", "San Antonio Electricians" are location pages, not services. */
const PEOPLE = /\b(?:plumbers?|electricians?|contractors?|roofers?|dentists?|technicians?|landscapers?|painters?|cleaners?|movers?|lawyers?|attorneys?|doctors?|chiropractors?|mechanics?|experts?|specialists?|pros?|company|companies)$/i;
/** Words that make "<word> Plumbers" an offering ("Emergency Plumbers"), not a place. */
const OFFER_MODIFIERS = new Set(['emergency', 'commercial', 'residential', 'licensed', 'local', 'certified', 'master', 'affordable', 'same', 'day', 'hour', 'night', 'weekend', 'family', 'pediatric', 'cosmetic', 'general']);
/** What a customer notices, not what the business sells: "Rusty hot water", "Water at the base of the tank". */
const SYMPTOM_WORDS = /\b(?:rusty|leaking|leaky|dripping|rumbling|popping|banging|gurgling|smelly|smells?|odou?rs?|never|won'?t|doesn'?t|isn'?t|not working|stopped|broken|base of|this year|last year|years? old)\b/i;

/**
 * Why a label is not a distinct service the business offers (undefined when it is one).
 * Shared by the site's service lists and the owner's review, so neither lists a category, a place, a vague word or a symptom.
 */
export function notAService(name: string, places: string[] = []): 'vague' | 'menu' | 'location' | 'symptom' | undefined {
  const t = name.trim();
  const words = t.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'vague';
  if (vagueService(t) || (words.length === 1 && ROOMS.has(words[0]))) return 'vague';
  if (MENU_PHRASE.test(t)) return 'menu';
  // a place the business serves, named in the label with the trade ("Plumbing in Austin", "Austin Plumbers")
  const placeHit = places.some((p) => p.length > 2 && new RegExp(`\\b${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t.toLowerCase()));
  if (/\b(?:in|near|serving)\s+[A-Z][a-z]+/.test(t) && (placeHit || PEOPLE.test(t))) return 'location';
  if (PEOPLE.test(t)) {
    const lead = t.replace(PEOPLE, '').trim().split(/\s+/).filter(Boolean);
    if (placeHit || (lead.length >= 1 && lead.length <= 3 && lead.every((w) => /^[A-Z][a-z]+\.?$/.test(w) && !OFFER_MODIFIERS.has(w.toLowerCase())))) return 'location';
  }
  // symptom phrases: a sentence about the customer's problem, a list of noises, or a phrase opening with an article
  // …or a clause about what happens to the customer ("Gums that bleed when you brush")
  // ("Running water you cannot find", "Slower recovery than it used to have"): a service name never speaks of "you", "it" or "than"
  const clause = words.length >= 4 && (/\b(?:when|whenever) (?:you|it|they|the|your)\b/i.test(t) || /^\w+ (?:that|which) \w+/i.test(t) || /\b(?:you|it|they|than|used to|cannot|can'?t)\b/i.test(t));
  if (clause || SYMPTOM_WORDS.test(t) ||/^(?:the|a|an|past|when|if|your|my)\s/i.test(t) || (/,/.test(t) && /\bor\b/i.test(t))) return 'symptom';
  return undefined;
}

/** A label already covered by a service the site shows: a category ("Electrical" beside "Electrical (Austin)"), or the same words ("Cleaner Air" ~ "Clean Air & Water"). */
export function coveredBy(name: string, shown: string[]): boolean {
  const stem = (w: string) => w.replace(/(?:ers?|ing|s)$/, '');
  const toks = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== 'and').map(stem);
  const want = toks(name);
  return want.length > 0 && shown.some((s) => { const have = new Set(toks(s)); return want.every((w) => have.has(w)); });
}

/** What the model says about whether the site may be published as built. Used by the build review and the publish gate. */
export function reviewEvidence(m: EvidenceModel, built: { servicesShown: string[]; places?: string[]; headline?: string; typeLabel?: string; primaryCtaLabel?: string; galleryTitle?: string; storyChars?: number; serviceCardImages: number }): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  const shown = new Set(built.servicesShown.map(tokenKey));
  const primary = m.services.filter((s) => s.isPrimary && s.status === 'verified');
  const missing = primary.filter((s) => !shown.has(tokenKey(s.canonicalName)) && !s.aliases.some((a) => shown.has(tokenKey(a))));
  if (missing.length) out.push({ id: 'primary-services-missing', level: 'block', message: `The business's own services are missing from the site: ${missing.map((s) => s.canonicalName).join(', ')}.` });
  // vague labels, menu wording, location pages, symptoms and categories already covered are not services the site left out
  const secondary = m.services.filter((s) => !s.isPrimary && s.status === 'verified' && !shown.has(tokenKey(s.canonicalName)) && !notAService(s.canonicalName, built.places) && !coveredBy(s.canonicalName, built.servicesShown));
  if (secondary.length) out.push({ id: 'secondary-services-missing', level: 'review', message: `Services listed in the website's menu are not on the site: ${secondary.map((s) => s.canonicalName).join(', ')}.` });
  const fromText = m.services.filter((s) => s.status === 'verified' && s.mentions.length > 0 && s.mentions.every((x) => x.kind === 'page-text') && shown.has(tokenKey(s.canonicalName)));
  if (fromText.length) out.push({ id: 'services-from-text', level: 'review', message: `${fromText.length} service${fromText.length > 1 ? 's were' : ' was'} read from the website's wording, not from a list of services: ${fromText.map((s) => s.canonicalName).slice(0, 5).join(', ')}. Confirm ${fromText.length > 1 ? 'them' : 'it'}.` });
  const proposed = m.services.filter((s) => s.status === 'needs_review' && !notAService(s.canonicalName, built.places));
  if (proposed.length) out.push({ id: 'services-unverified', level: 'review', message: `Not shown, because the website doesn't list ${proposed.length === 1 ? 'it' : 'them'} itself: ${proposed.map((s) => s.canonicalName).slice(0, 5).join(', ')}. Confirm before adding.` });
  if (m.hero?.primaryCta && built.primaryCtaLabel && nameKey(m.hero.primaryCta.label) !== nameKey(built.primaryCtaLabel)) out.push({ id: 'primary-cta-changed', level: 'block', message: `The website's main action "${m.hero.primaryCta.label}" is replaced by "${built.primaryCtaLabel}".${/^(Request an appointment|Send a request)$/.test(built.primaryCtaLabel) ? ' It opens the request form, because no verified booking or confirmed phone number is available yet. Confirm, or give the booking link.' : ''}` });
  if (built.headline && !headlineRelevant(built.headline, { typeLabel: built.typeLabel, services: m.services.filter((s) => s.isPrimary).map((s) => s.canonicalName) })) out.push({ id: 'hero-relevance', level: 'review', message: `The headline "${built.headline}" doesn't say what the business does.` });
  if (built.serviceCardImages < 1 && m.assets.some((a) => a.kind === 'service')) out.push({ id: 'service-images-unused', level: 'review', message: 'The website shows pictures on its services but none are on the service cards.' });
  if (!m.assets.some((a) => a.kind === 'service' && a.usable)) out.push({ id: 'no-service-images', level: 'review', message: 'No usable picture on any service: the services use a designed text pattern.' });
  if (built.galleryTitle && /recent work|our work|projects/i.test(built.galleryTitle) && !m.projectsVerified) out.push({ id: 'project-attribution', level: 'review', message: `The photo section is titled "${built.galleryTitle}" but the website doesn't show these as its projects.` });
  for (const c of m.conflicts) out.push({ id: `conflict-${c.field}`, level: 'review', message: `The website and the business listing disagree about the ${c.field}: ${c.values.map((v) => `${v.source} says ${v.value}`).join('; ')}.` });
  if (m.claims.listingHours && !m.claims.emergencyResponse?.value && /open 24 hours/i.test(String((m.claims.listingHours.value as string[] | undefined)?.join(' ')))) out.push({ id: 'emergency-ambiguous', level: 'review', message: 'The business listing shows 24-hour opening, but the website doesn\'t promise emergency response: the site says only what is listed.' });
  if (m.brand.confidence === 'none') out.push({ id: 'brand-low-confidence', level: 'review', message: 'The brand colours could not be read with confidence from the website.' });
  if ((built.storyChars ?? 0) > 520) out.push({ id: 'copied-prose', level: 'review', message: 'A long paragraph from the website is shown as it is: summarise it.' });
  return out;
}
export const serviceKey = tokenKey;
export type { SourceService };
