import { studioDocs } from '../../store.js';
import { phoneKey } from '../../sources/site-content.js';
import { sha256, stableStringify } from '../snapshot.js';
import type { BusinessBrief, SiteInventory, SourceRef } from '../schema.js';
import { seasonOf } from './seasonal.js';
import { ownerReview, type BriefRef, type Concept, type OwnerReview, type PublicationGate } from './types.js';
import { stateName } from '../address.js';
import { completeExcerpt, stripUiDebris } from '../../util/text.js';

/**
 * The owner review and the fact catalog. The catalog is what a preview may show: the brief's facts with the review
 * applied (a chosen phone number, a chosen location, approved prices). A fact whose value is still open (disputed,
 * unknown, or uncertain like a price tied to its item only by layout) is left out of the preview, with the reason and
 * the question that settles it; so is every call to action that would act on it. Publishing is a separate gate
 * (`publicationGate`): every blocking question answered, and every picture, claim and price the page shows approved.
 */

export class StaleBrief extends Error {}

/** A review with no answers yet: previews can still be made, with every open fact left out. */
export function emptyReview(brief: BriefRef, reviewedBy = 'not reviewed yet'): OwnerReview {
  return withId({ schema: 'roger.owner-review', version: 1, id: '', brief, reviewedBy, reviewedAt: '', answers: {}, approvedAssets: [], approvedClaims: [] });
}
export function withId(r: OwnerReview): OwnerReview {
  const body = { ...r, id: undefined, reviewedAt: undefined };
  return ownerReview.parse({ ...r, id: `rv_${sha256(stableStringify(body)).slice(0, 16)}` });
}
export async function saveReview(r: OwnerReview): Promise<OwnerReview> {
  const v = withId(r);
  await studioDocs.put('studio-reviews', v.id, v);
  return v;
}
export const getReview = (id: string) => studioDocs.get<OwnerReview>('studio-reviews', id);

/** The review must be of this exact brief: its revision and its content hash. */
export function checkPinned(brief: BusinessBrief, review: OwnerReview) {
  if (review.brief.businessKey !== brief.businessKey || review.brief.revision !== brief.revision || review.brief.briefHash !== brief.briefHash) {
    throw new StaleBrief(`The review is of ${review.brief.businessKey} revision ${review.brief.revision} (${review.brief.briefHash.slice(0, 12)}); the brief is revision ${brief.revision} (${brief.briefHash.slice(0, 12)}).`);
  }
}

// ───────────────────────── the catalog ─────────────────────────
export interface Fact { id: string; kind: string; label: string; text: string; sources: SourceRef[] }
export interface ActionDef { id: string; label: string; href: string; kind: 'call' | 'email' | 'book' | 'site' | 'menu' | 'directions' | 'reviews'; factId: string; /** time-limited: never the main action */ seasonal?: string }
export interface Photo { id: string; url: string; width: number; height: number; orientation: 'landscape' | 'portrait' | 'square'; uses: string[]; alt: string; services: string[]; /** the website pages it appears on */ pages?: string[]; /** what an image check saw in it (when it has no description) */ seen?: string; seenKind?: string }
export interface Catalog {
  brief: BriefRef;
  business: { name: string; category: string | null; website: string | null; summary: string | null };
  facts: Record<string, Fact>;
  /** the business's own short lines: its website's headings (home and about pages first), in its own words */
  ownLines: string[];
  /**
   * a service's picture: the one the website itself shows on that service's card or page (and on no other service's),
   * or the one the owner tied to it in review. Never a stand-in: a service with neither has no picture.
   */
  services: { id: string; name: string; description?: string; imageId?: string; imageFrom?: 'website' | 'owner' }[];
  /** pictures the owner tied to a menu section ("section:Drinks" → asset id); a section has none otherwise */
  sectionImages: Record<string, string>;
  items: { id: string; name: string; section?: string; description?: string; tags: string[]; price?: string }[];
  locations: { id: string; street: string; cityLine: string; formatted: string; directions: string }[];
  /** the business's own address, when the sources agree on one place */
  address: { id: string; formatted: string } | null;
  phone: { display: string; href: string } | null;
  email: string | null;
  hours: string[] | null;
  area: string[] | null;
  rating: { value: number; count: number; href: string | null; scope: string | null } | null;
  claims: { id: string; text: string }[];
  pledges: { id: string; text: string }[];
  story: { heading: string; text: string } | null;
  photos: Photo[];
  logo: { url: string; colors: string[] } | null;
  actions: ActionDef[];
  /**
   * several locations and none chosen as the business's own: a page-level "Directions" cannot pick one, so it goes to
   * the page's list of locations instead; directions to one address belong on that location's card
   */
  chooser: { id: 'find-location'; label: string; href: '#visit' } | null;
  omitted: { what: string; reason: string; questionId?: string }[];
  /** every value the preview may show, as text: the corpus grounding checks rendered numbers against */
  allowedText: string;
  /** values that must not appear on a preview: disputed numbers, held actions, prices left out */
  forbidden: { phones: string[]; hrefs: string[]; prices: { itemId: string; text: string }[] };
}

const web = (url: string, locator?: string): SourceRef => ({ url, sourceType: 'website', locator });
const owner = (q: string): SourceRef => ({ url: `owner:${q}`, sourceType: 'owner', locator: 'owner review' });
const digits = (s: string) => s.replace(/\D/g, '');
const absolute = (href: string, base: string | null) => { try { return new URL(href, base ?? undefined).toString(); } catch { return href; } };
/** "Monday: 7:00 AM – 10:00 PM" lines, with runs of days that keep the same hours joined ("Mon–Fri: …") */
export function compactHours(lines: string[]): string[] {
  const rows = lines.map((l) => { const m = l.match(/^([A-Za-z]+)\s*:\s*(.+)$/); return m ? { day: m[1].slice(0, 3), t: m[2].trim() } : { day: '', t: l }; });
  if (rows.some((r) => !r.day)) return lines;
  const out: string[] = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].t === rows[i].t) j++;
    out.push(`${rows[i].day}${j > i ? `–${rows[j].day}` : ''}: ${rows[i].t}`);
    i = j + 1;
  }
  return out;
}
/** an alt text that says something (not "DSC04423.JPG", "service", "Why") */
const meaningful = (s?: string) => !!s && s.length > 6 && !/^(dsc|img|image|photo|pic|untitled)[\s_-]*\d+/i.test(s) && !/\.(jpe?g|png|webp|gif)$/i.test(s) && !/^(service|services|why|about|project details\d*|service details)$/i.test(s.trim());

export function resolveCatalog(brief: BusinessBrief, inventory: SiteInventory, review: OwnerReview): Catalog {
  checkPinned(brief, review);
  const A = review.answers;
  const site = brief.identity.website.value;
  const facts: Record<string, Fact> = {};
  const omitted: Catalog['omitted'] = [];
  const forbidden: Catalog['forbidden'] = { phones: [], hrefs: brief.callsToAction.held.map((h) => absolute(h.href, site)), prices: [] };
  const add = (f: Fact) => { facts[f.id] = f; return f; };
  const name = brief.identity.name.value ?? 'This business';
  add({ id: 'name', kind: 'identity', label: 'name', text: name, sources: brief.identity.name.sources });
  if (brief.identity.category.value) add({ id: 'category', kind: 'identity', label: 'category', text: brief.identity.category.value, sources: brief.identity.category.sources });

  // phone: the agreed number, or the one the owner chose; a disputed number is left out, with every call button
  let phone: Catalog['phone'] = null;
  const ph = brief.contact.phone;
  const chosenPhone = A['q-contact-phone']?.choice;
  if (ph.candidates?.length && chosenPhone && ph.candidates.some((c) => phoneKey(c.value) === phoneKey(chosenPhone))) {
    const c = ph.candidates.find((x) => phoneKey(x.value) === phoneKey(chosenPhone))!;
    phone = { display: c.value, href: `tel:+1${digits(c.value).slice(-10)}` };
    add({ id: 'phone', kind: 'contact', label: 'phone', text: c.value, sources: [...c.sources, owner('q-contact-phone')] });
    forbidden.phones.push(...ph.candidates.filter((x) => x !== c).map((x) => x.value));
  } else if (ph.value) {
    phone = { display: ph.value, href: `tel:+1${digits(ph.value).slice(-10)}` };
    add({ id: 'phone', kind: 'contact', label: 'phone', text: ph.value, sources: ph.sources });
  } else {
    if (ph.candidates?.length) forbidden.phones.push(...ph.candidates.map((x) => x.value));
    omitted.push({ what: 'phone number and every call button', reason: ph.note ?? 'no phone number', questionId: ph.questionId });
  }
  const email = brief.contact.email.value;
  if (email) add({ id: 'email', kind: 'contact', label: 'email', text: email, sources: brief.contact.email.sources });

  // locations: every website location is a fact; which one is the business's address is the owner's call when disputed
  const items = brief.locations.items;
  const webLocs = items.filter((l) => l.sources.some((s) => s.sourceType === 'website'));
  let shown = items;
  let primaryId = brief.locations.primaryId;
  const scope = A['q-locations']?.choice;
  const chosenAddr = A['q-contact-address']?.choice;
  if (chosenAddr) { const l = items.find((x) => x.address.formatted === chosenAddr); if (l) { primaryId = l.id; shown = [l]; } }
  else if (scope && /this location/i.test(scope)) { const l = items.find((x) => x.listing); if (l) { primaryId = l.id; shown = [l]; } }
  else if (brief.contact.address.candidates?.length && brief.conflicts.some((c) => c.id === 'c-address')) {
    // the listing's address is not on the website: the preview shows the website's own locations, none as the main one
    shown = webLocs;
    omitted.push({ what: "the Google listing's address, and any directions to it", reason: brief.contact.address.note ?? 'the sources disagree on the address', questionId: brief.contact.address.questionId });
  }
  if (!primaryId && items.length > 1) omitted.push({ what: 'a main location (the page lists every location, none as the main one)', reason: brief.contact.address.note ?? 'several locations', questionId: brief.contact.address.questionId });
  const locations: Catalog['locations'] = shown.map((l) => {
    const f = add({ id: l.id, kind: 'location', label: 'location', text: `${l.address.formatted} ${l.address.city}, ${stateName(l.address.state)}`, sources: l.sources });
    return { id: f.id, street: [l.address.street, l.address.unit].filter(Boolean).join(', '), cityLine: `${l.address.city}, ${l.address.state} ${l.address.zip}`, formatted: l.address.formatted, directions: `dir-${l.id}` };
  });
  const address = primaryId ? { id: primaryId, formatted: items.find((l) => l.id === primaryId)!.address.formatted } : null;

  // hours: one place's hours; several places with no main one have no single set of hours to show
  let hours: string[] | null = null;
  const hl = brief.hours.listing, hw = brief.hours.website;
  const hoursPick = A['q-hours']?.choice;
  if ((hl.status === 'conflicting' || hw.status === 'conflicting') && !hoursPick) omitted.push({ what: 'opening hours', reason: 'the website and the Google listing give different hours', questionId: hl.questionId ?? hw.questionId });
  else if (!primaryId && items.length > 1) omitted.push({ what: 'opening hours', reason: 'the hours differ by location, and no main location is chosen', questionId: brief.contact.address.questionId });
  else {
    const lines = hoursPick === 'Website' ? hw.value : hoursPick === 'Google' ? hl.value : hl.value ?? hw.value;
    if (lines?.length) { hours = compactHours(lines); add({ id: 'hours', kind: 'hours', label: 'opening hours', text: `${hours.join('; ')} ${lines.join('; ')}`, sources: (hoursPick === 'Website' || !hl.value ? hw : hl).sources }); }
  }
  const area = brief.serviceArea.value?.places.length ? [...brief.serviceArea.value.places] : null;
  if (area) add({ id: 'area', kind: 'area', label: 'service area', text: area.join(', '), sources: brief.serviceArea.sources });

  // the Google rating: of the listing, so of its one location when there are several
  let rating: Catalog['rating'] = null;
  const rv = brief.reviews.value;
  if (rv) {
    const listingLoc = items.find((l) => l.listing);
    const ratingScope = items.length > 1 && listingLoc ? `${listingLoc.address.street} location` : null;
    rating = { value: rv.rating, count: rv.count, href: brief.identity.listing?.mapsUrl ?? null, scope: ratingScope };
    add({ id: 'rating', kind: 'rating', label: 'Google rating', text: `${rv.rating} ${rv.count} ${rv.count.toLocaleString('en-US')}${ratingScope ? ` ${ratingScope}` : ''}`, sources: brief.reviews.sources });
  }

  const claims = brief.claims.filter((c) => c.value).map((c, i) => { const f = add({ id: `claim-${i + 1}`, kind: 'claim', label: 'claim', text: c.value!, sources: c.sources }); return { id: f.id, text: f.text }; });
  // an offer worded as a statement ("Free estimates, honest advice"), not a button label ("Get a free estimate")
  const pledges = brief.offers.filter((o) => o.terms && o.label.length <= 90 && !/^(get|book|call|request|schedule|claim|order|buy|shop|start|contact|see|view)\b/i.test(o.label.trim())).map((o) => { const f = add({ id: o.id, kind: 'offer', label: 'offer', text: o.label.replace(/\s+/g, ' ').trim(), sources: o.sources }); return { id: f.id, text: f.text }; });

  // what the business sells: its services, or its menu (services get their pictures below, once the photos are known)
  const services: Catalog['services'] = brief.services.items.map((s) => {
    add({ id: s.id, kind: 'service', label: 'service', text: `${s.name}${s.description?.value ? ` ${s.description.value}` : ''}`, sources: s.evidence.map((e) => web(e.url, e.locator ?? e.kind)) });
    const description = completeExcerpt(s.description?.value?.replace(/^\s*0?\d{1,2}[.)]?\s*(?=[A-Z])/, ''));
    return { id: s.id, name: s.name, ...(description ? { description } : {}) };
  });
  const pricesApproved = !!review.offerings?.pricesApproved;
  let heldPrices = 0;
  const menu = brief.offerings.items.map((it) => {
    const priceOk = it.price && (it.price.status === 'verified' || pricesApproved);
    if (it.price && !priceOk) { heldPrices++; forbidden.prices.push({ itemId: it.id, text: it.price.text }); }
    add({ id: it.id, kind: 'item', label: 'menu item', text: [it.name, it.section, it.description, priceOk ? it.price!.text : '', ...it.tags].filter(Boolean).join(' '), sources: it.sources });
    return { id: it.id, name: it.name, ...(it.section ? { section: it.section } : {}), ...(completeExcerpt(it.description) ? { description: completeExcerpt(it.description) } : {}), tags: it.tags.filter((t) => !/^\d+\s?oz$|sold separately/i.test(t)), ...(priceOk ? { price: it.price!.text } : {}) };
  });
  if (heldPrices) omitted.push({ what: `${heldPrices} menu price(s) tied to their item only by the poster's layout`, reason: 'a price matched by layout needs the owner to confirm it', questionId: brief.ownerQuestions.find((q) => q.id === 'q-offerings')?.id });

  const storyAnswer = A['q-story']?.text;
  const story = storyAnswer ? { heading: 'Our story', text: storyAnswer } : brief.story.value ? { heading: stripUiDebris(brief.story.value.heading), text: stripUiDebris(brief.story.value.text) } : null;
  if (story) add({ id: 'story', kind: 'story', label: 'story', text: story.text, sources: storyAnswer ? [owner('q-story')] : brief.story.sources });

  // pictures: the website's own photographs (their use is confirmed at publishing); Google's photos are not used
  // a picture whose own words call it a diagram, chart or graphic is not a photograph of the business
  const NOT_PHOTO = /\b(diagram|infographic|chart|illustration|graphic|logo|badge|icon|screenshot|map|flyer|poster|coupon|certificate)\b/i;
  const photos: Photo[] = inventory.assets.filter((a) => a.origin === 'website' && a.outcome === 'usable' && a.width && a.height && !['poster', 'logo', 'social', 'icon'].includes(a.role) && !NOT_PHOTO.test(`${a.alt ?? ''} ${a.context ?? ''}`))
    .map((a) => ({ id: a.id, url: a.url, width: a.width!, height: a.height!, orientation: a.width! / a.height! > 1.15 ? 'landscape' as const : a.height! / a.width! > 1.15 ? 'portrait' as const : 'square' as const, uses: a.uses, alt: meaningful(a.alt) ? a.alt! : meaningful(a.context) ? a.context! : '', services: a.services, pages: a.pages }));
  // too few of the business's own photos: the Google listing's photos may fill the preview (shown live with their
  // credits, never copied; preview-only, see listing-photos.ts). The concept job keeps only those that fit the business.
  if (photos.length < 3) {
    for (const a of inventory.assets.filter((x) => x.origin === 'google' && x.outcome === 'usable' && x.width && x.height && /^google-listing:/.test(x.url))) {
      photos.push({ id: a.id, url: a.url, width: a.width!, height: a.height!, orientation: a.width! / a.height! > 1.15 ? 'landscape' : a.height! / a.width! > 1.15 ? 'portrait' : 'square', uses: a.uses, alt: `Photo of ${name} from Google Maps`, services: [] });
    }
  }
  const logo = brief.brand.logo.value ? { url: brief.brand.logo.value.url, colors: brief.brand.logo.value.colors ?? [] } : null;

  // a service's picture is evidence, not decoration: the website's own picture for that service alone, or the owner's choice
  const own = new Map(photos.map((p) => [p.id, p]));
  const tied = review.serviceImages ?? {};
  for (const s of services) {
    const set = Object.prototype.hasOwnProperty.call(tied, s.id) ? tied[s.id] : undefined;
    if (set === null) continue; // the owner said: no picture
    if (set && own.has(set)) { s.imageId = set; s.imageFrom = 'owner'; continue; }
    const evidence = brief.services.items.find((x) => x.id === s.id)!.assets.find((id) => own.get(id)?.services.length === 1);
    if (evidence) { s.imageId = evidence; s.imageFrom = 'website'; }
  }
  const sectionImages = Object.fromEntries(Object.entries(tied).filter(([k, v]) => k.startsWith('section:') && v && own.has(v)) as [string, string][]);

  // actions a page may offer, each tied to a fact
  const actions: ActionDef[] = [];
  if (phone) actions.push({ id: 'call', label: `Call ${phone.display}`, href: phone.href, kind: 'call', factId: 'phone' });
  if (brief.callsToAction.booking) { add({ id: 'booking', kind: 'contact', label: 'booking', text: brief.callsToAction.booking, sources: [web(site ?? brief.callsToAction.booking, 'booking link')] }); actions.push({ id: 'book', label: 'Book online', href: brief.callsToAction.booking, kind: 'book', factId: 'booking' }); }
  for (const slot of ['primary', 'secondary'] as const) {
    const c = brief.callsToAction[slot];
    if (!c || c.kind === 'phone' || /^tel:/i.test(c.href)) continue;
    const href = absolute(c.href, site);
    if (actions.some((a) => a.href === href)) continue;
    // a seasonal offer whose season or date has passed is not offered; one still running is never the main action
    // a label that only names an icon ("map marker pin", "arrow right") says nothing a visitor can act on
    if (/^(?:[a-z]+ )?(?:icon|marker|pin|arrow|chevron|caret|svg|glyph)(?: [a-z]+)?$/i.test(c.label.trim()) || /\b(?:icon|svg|glyph)\b/i.test(c.label)) { omitted.push({ what: `the "${c.label}" link`, reason: 'its label is an icon name, not an action' }); continue; }
    const season = seasonOf(c.label);
    if (season.expired) { omitted.push({ what: `the "${c.label}" link`, reason: season.why ?? 'its season has passed' }); continue; }
    add({ id: `cta-${slot}`, kind: 'action', label: 'call to action', text: c.label, sources: [web(site ?? href, c.locator)] });
    actions.push({ id: `cta-${slot}`, label: c.label, href, kind: 'site', factId: `cta-${slot}`, ...(season.seasonal ? { seasonal: season.why } : {}) });
  }
  if (email) actions.push({ id: 'email', label: 'Email us', href: `mailto:${email}`, kind: 'email', factId: 'email' });
  brief.offerings.documents.filter((d) => d.items > 0).forEach((d, i) => {
    const doc = inventory.documents.find((x) => x.url === d.url);
    const words = (doc?.anchor || decodeURIComponent(new URL(d.url).pathname.split('/').pop() || '').replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(new RegExp(name.replace(/[^a-z0-9 ]/gi, '').split(' ').join('|'), 'gi'), '')).replace(/\b(compressed|final|v\d+)\b/gi, '').replace(/\s+/g, ' ').trim();
    const label = /menu/i.test(words) ? `${words} (PDF)` : `${words || 'Full'} menu (PDF)`;
    add({ id: `doc-${i + 1}`, kind: 'document', label: 'menu PDF', text: label, sources: [web(d.url, 'linked PDF')] });
    actions.push({ id: `menu-${i + 1}`, label: label.replace(/^\w/, (c) => c.toUpperCase()), href: d.url, kind: 'menu', factId: `doc-${i + 1}` });
  });
  for (const l of locations) actions.push({ id: l.directions, label: 'Directions', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.formatted)}`, kind: 'directions', factId: l.id });
  if (rating?.href) actions.push({ id: 'reviews', label: 'Read the reviews on Google', href: rating.href, kind: 'reviews', factId: 'rating' });

  // derived counts a page may state ("8 locations", "7 towns")
  const counts = [locations.length, area?.length ?? 0, services.length, menu.length].filter((n) => n > 1).join(' ');
  // the website's own address is named in the footer ("Its facts come from …"), digits and all
  const host = site ? (() => { try { return new URL(site).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
  const ownLines = ownLinesOf(inventory);
  const allowedText = [...ownLines, ...Object.values(facts).map((f) => f.text), hours?.join(' ') ?? '', locations.map((l) => `${l.street} ${l.cityLine}`).join(' '), counts, phone?.display ?? '', host].join('\n');
  return {
    brief: review.brief,
    business: { name, category: brief.identity.category.value, website: site, summary: brief.summary.status === 'written' ? brief.summary.text : null },
    facts, ownLines, services, sectionImages, items: menu, locations, address, phone, email, hours, area, rating, claims, pledges, story, photos, logo, actions,
    chooser: locations.length > 1 && !address ? { id: 'find-location', label: 'Find a location', href: '#visit' } : null,
    omitted, allowedText, forbidden,
  };
}

// ───────────────────────── publication gate ─────────────────────────
/**
 * What stands between a preview and a published site, for these concepts: every blocking question answered, and
 * every picture, claim and price shown approved by the owner. Previews do not need this; publishing does.
 */
export function publicationGate(brief: BusinessBrief, catalog: Catalog, review: OwnerReview, concepts: Pick<Concept, 'images' | 'sections'>[], set?: { id: string; conceptIds: string[] }): PublicationGate {
  const blockers: PublicationGate['blockers'] = [];
  // a site is published from one concept the owner chose; until then every concept counts
  const chosen = review.selectedConcept && set && review.selectedConcept.setId === set.id ? set.conceptIds.indexOf(review.selectedConcept.conceptId) : -1;
  if (chosen < 0) blockers.push({ kind: 'no-concept', what: 'no concept is chosen yet' });
  else concepts = [concepts[chosen]];
  for (const q of brief.ownerQuestions.filter((x) => x.blocking && !review.answers[x.id])) blockers.push({ kind: 'open-question', what: q.question, questionId: q.id });
  const used = new Set(concepts.flatMap((c) => c.images));
  // Google listing photos: shown in the preview with their credit, never published. Credit is not permission, and the
  // owner approving one doesn't change that: the owner's own photo file replaces it before publishing
  const google = [...used].filter((id) => catalog.photos.some((p) => p.id === id && p.url.startsWith('google-listing:')));
  if (google.length) blockers.push({ kind: 'google-photos', what: `${google.length} photo(s) shown come from the Google listing: preview only, with their photographers' credit. Upload your own photos to replace them before publishing.`, questionId: 'q-photos-google' });
  const unapproved = [...used].filter((id) => !google.includes(id) && !review.approvedAssets.includes(id));
  if (unapproved.length) blockers.push({ kind: 'unconfirmed-rights', what: `${unapproved.length} website photo(s) shown are not yet approved by the owner`, questionId: 'q-photos-rights' });
  const shownFacts = new Set(concepts.flatMap((c) => c.sections.flatMap((s) => s.factIds)));
  const claims = catalog.claims.filter((c) => shownFacts.has(c.id) && !review.approvedClaims.includes(c.text));
  if (claims.length) blockers.push({ kind: 'unconfirmed-claim', what: `claims not yet confirmed: ${claims.map((c) => `"${c.text}"`).join(', ')}`, questionId: 'q-claims' });
  if (catalog.items.some((i) => i.price && shownFacts.has(i.id)) && !review.offerings?.pricesApproved) blockers.push({ kind: 'prices', what: 'menu prices are shown but not yet approved', questionId: 'q-offerings' });
  if (catalog.logo && !review.approvedAssets.includes('logo')) blockers.push({ kind: 'logo', what: 'the logo is not yet confirmed as current' });
  // and publishing itself: a chosen concept goes on to inner pages and a full build first
  blockers.push({ kind: 'not-built', what: 'publishing is not built yet: a chosen concept goes on to inner pages and a full build first' });
  return { publishable: false, blockers };
}

/**
 * The business's own short lines: the headings of its website (home and about pages first), with a heading split over
 * two lines joined back ("The Story Behind Austin's" + "Most Iconic Tacos") and words run together by extraction
 * separated ("forStorm" → "for Storm").
 */
function ownLinesOf(inventory: SiteInventory): string[] {
  const order = (u: string) => { try { const p = new URL(u).pathname; return p === '/' || /home/i.test(p) ? 0 : /about|story/i.test(p) ? 1 : 2; } catch { return 3; } };
  const clean = (t: string) => stripUiDebris(t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])&/g, '$1 &').replace(/\s+/g, ' ').trim());
  const out: string[] = [];
  for (const p of [...inventory.pages].filter((x) => x.headings?.length).sort((a, b) => order(a.url) - order(b.url))) {
    const hs = p.headings.filter((h) => h.level <= 3).map((h) => ({ level: h.level, text: clean(h.text) }));
    for (let i = 0; i < hs.length; i++) {
      let t = hs[i].text;
      // a heading set over two lines: the first ends mid-phrase ("… Austin's", "… for")
      while (i + 1 < hs.length && hs[i + 1].level === hs[i].level && /(?:['\u2019]s|\b(?:the|of|for|and|behind|in|to|a|an|with|from|our))$/i.test(t)) { t = `${t} ${hs[i + 1].text}`; i++; }
      out.push(t);
    }
  }
  return [...new Set(out)];
}
