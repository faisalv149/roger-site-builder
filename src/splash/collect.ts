/**
 * Step 1 to 4 of the splash page: collect what is known about a business (its Google listing with every field the
 * page can use, its own website through Roger's research, and what the owner said), build the fact sheet, classify
 * the trade, choose the reviews and plan the screens. No AI writes anything here; nothing is generated.
 *
 * Only Google's Places API and the business's own website are read (never Google Maps, Search or Yelp pages).
 */
import { config } from '../config.js';
import type { BusinessBrief, SiteInventory } from '../studio/schema.js';
import type { LiveReview } from '../sources/places.js';
import { liveReviews } from '../sources/places.js';
import { getBrief, startStudioJob, runStudioJob } from '../studio/jobs.js';
import { getBody } from '../studio/snapshot.js';
import { classifyTrade, type TradeChoice } from './classify.js';
import { buildFactSheet, ownerQuestions, type Fact, type FactSheet, type OwnerQuestion } from './facts.js';
import { extractExtras, linkKind, type Extras } from './extras.js';
import { ownerInputs, type OwnerInput } from './owner.js';
import { selectReviews, type ReviewChoice } from './reviews.js';
import { planScreens, type Material, type ScreenPlan } from './screens.js';

/** every Places field the splash page can use (the attributes are the ones Google defines for places) */
export const ATTRIBUTE_FIELDS = ['dineIn', 'takeout', 'delivery', 'curbsidePickup', 'reservable', 'outdoorSeating', 'goodForChildren', 'goodForGroups', 'allowsDogs', 'servesBreakfast', 'servesLunch', 'servesDinner', 'servesBrunch', 'servesVegetarianFood', 'servesCoffee', 'servesDessert', 'servesBeer', 'servesWine', 'servesCocktails', 'liveMusic', 'restroom', 'menuForChildren'] as const;
export const PLACE_FIELDS = ['id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'formattedAddress', 'location', 'nationalPhoneNumber', 'websiteUri', 'regularOpeningHours', 'currentOpeningHours', 'businessStatus', 'rating', 'userRatingCount', 'reviews', 'photos', 'priceLevel', 'editorialSummary', 'googleMapsUri', 'paymentOptions', 'parkingOptions', 'accessibilityOptions', ...ATTRIBUTE_FIELDS];

export interface PlaceDetails {
  id: string; displayName?: { text: string }; primaryType?: string; primaryTypeDisplayName?: { text: string }; types?: string[];
  formattedAddress?: string; location?: { latitude: number; longitude: number }; nationalPhoneNumber?: string; websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] }; currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  businessStatus?: string; rating?: number; userRatingCount?: number; reviews?: unknown[]; photos?: unknown[]; priceLevel?: string;
  editorialSummary?: { text: string }; googleMapsUri?: string;
  paymentOptions?: Record<string, boolean>; parkingOptions?: Record<string, boolean>; accessibilityOptions?: Record<string, boolean>;
  [attribute: string]: unknown;
}

/** places_details: the listing with every field above (Places API only) */
export async function placesDetails(placeId: string): Promise<PlaceDetails> {
  if (!config.googleKey) throw new Error('No Google key: the listing cannot be read.');
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': config.googleKey, 'X-Goog-FieldMask': PLACE_FIELDS.join(',') } });
  if (!r.ok) throw new Error(`Google Places ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as PlaceDetails;
}

const words = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
/** the attributes the listing states as true, in plain words ("dine in", "outdoor seating", "parking: free lot") */
export function attributesOf(p: PlaceDetails): string[] {
  const out = ATTRIBUTE_FIELDS.filter((k) => p[k] === true).map((k) => ATTRIBUTE_WORDS[k] ?? words(k));
  const yes = (group: 'paymentOptions' | 'parkingOptions' | 'accessibilityOptions', names: Record<string, string>) =>
    Object.entries(p[group] ?? {}).filter(([k, v]) => v === true && names[k]).map(([k]) => names[k]);
  const pay = yes('paymentOptions', { acceptsCreditCards: 'credit cards', acceptsDebitCards: 'debit cards', acceptsNfc: 'tap to pay' });
  if ((p.paymentOptions as Record<string, unknown> | undefined)?.acceptsCashOnly === true) out.push('Cash only');
  else if (pay.length) out.push(`Accepts ${and(pay)}`);
  const park = yes('parkingOptions', { freeParkingLot: 'free lot', paidParkingLot: 'paid lot', freeStreetParking: 'free street parking', paidStreetParking: 'paid street parking', valetParking: 'valet', freeGarageParking: 'free garage', paidGarageParking: 'paid garage' });
  if (park.length) out.push(`Parking: ${and(park)}`);
  const access = yes('accessibilityOptions', { wheelchairAccessibleEntrance: 'entrance', wheelchairAccessibleParking: 'parking', wheelchairAccessibleRestroom: 'restroom', wheelchairAccessibleSeating: 'seating' });
  if (access.length) out.push(`Wheelchair-accessible ${and(access)}`);
  return out;
}
const and = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
/** Google's attributes in plain words, as a visitor would say them */
const ATTRIBUTE_WORDS: Record<string, string> = {
  dineIn: 'Dine-in', takeout: 'Takeout', delivery: 'Delivery', curbsidePickup: 'Curbside pickup', reservable: 'Takes reservations', outdoorSeating: 'Outdoor seating',
  goodForChildren: 'Good for kids', goodForGroups: 'Good for groups', allowsDogs: 'Dogs welcome', servesBreakfast: 'Breakfast', servesLunch: 'Lunch', servesDinner: 'Dinner',
  servesBrunch: 'Brunch', servesVegetarianFood: 'Vegetarian options', servesCoffee: 'Coffee', servesDessert: 'Dessert', servesBeer: 'Beer', servesWine: 'Wine',
  servesCocktails: 'Cocktails', liveMusic: 'Live music', restroom: 'Restroom', menuForChildren: "Kids' menu",
};

/** a claim the business makes, sorted by what it claims (each is a fact only because the business states it) */
export const CLAIM_KINDS: [string, RegExp][] = [
  ['licence', /\blicen[cs]ed?\b|\blic(?:ense)?\.? ?#/i], ['insurance', /\binsured\b|\binsurance\b|\bbonded\b/i],
  // a warranty before years ("fixed for free for 10 years" is a warranty, not an age)
  ['warranty', /\bwarrant(?:y|ies)\b|\bguarantee|\bfixed for free\b|\bfree (?:repair|re-?fix)/i],
  ['years_in_business', /\bsince (?:19|20)\d{2}\b|\b\d+\+? years\b|\bestablished\b|\best\. ?(?:19|20)\d{2}/i], ['award', /\baward|\bwinner\b|\bvoted\b/i],
  ['financing', /\bfinanc(?:e|ing)\b/i], ['free_estimate', /\bfree (?:estimate|quote|consultation|inspection|diagnostic)s?\b/i],
  ['family_owned', /\bfamily[- ](?:owned|run)\b/i], ['accepting_new_patients', /\baccepting new patients\b/i],
];
export const claimKind = (text: string) => CLAIM_KINDS.find(([, re]) => re.test(text))?.[0] ?? 'claim';

export interface CollectInput { places: PlaceDetails; brief?: BusinessBrief; inventory?: SiteInventory; extras?: Extras; owner?: OwnerInput[]; at: string }
/** every candidate fact, with its source: Google (places:<field>), the website (page and locator), the owner */
export function candidateFacts({ places: p, brief: b, inventory, extras, owner = [], at }: CollectInput): Fact[] {
  const out: Fact[] = [];
  const g = (field: string, value: Fact['value'] | undefined, ref: string) => { if (value !== undefined && value !== null && value !== '') out.push({ field, value, source: 'google', source_ref: `places:${ref}`, retrieved_at: at }); };
  g('name', p.displayName?.text, 'displayName');
  g('category', p.primaryTypeDisplayName?.text, 'primaryTypeDisplayName');
  g('address', p.formattedAddress, 'formattedAddress');
  if (p.location) g('geo', `${p.location.latitude},${p.location.longitude}`, 'location');
  g('phone', p.nationalPhoneNumber, 'nationalPhoneNumber');
  g('website', p.websiteUri, 'websiteUri');
  g('hours', p.regularOpeningHours?.weekdayDescriptions, 'regularOpeningHours');
  g('maps_url', p.googleMapsUri, 'googleMapsUri');
  g('price_level', p.priceLevel, 'priceLevel');
  g('editorial_summary', p.editorialSummary?.text, 'editorialSummary');
  const attrs = attributesOf(p);
  if (attrs.length) g('attributes', attrs, 'attributes');
  // Google content: known to exist, shown only through live slots (never written into the page)
  if (p.rating) g('rating', p.rating, 'rating');
  if (p.userRatingCount) g('review_count', p.userRatingCount, 'userRatingCount');
  if (p.photos?.length) g('google_photos', p.photos.length, 'photos');
  if (p.currentOpeningHours) g('open_now', true, 'currentOpeningHours');

  if (b) {
    const ref = (sources: { url: string; sourceType: string; locator?: string }[] | undefined) => sources?.find((s) => s.sourceType === 'website');
    const w = (field: string, value: Fact['value'] | undefined | null, sources: { url: string; sourceType: string; locator?: string }[] | undefined) => {
      const s = ref(sources);
      if (s && value !== undefined && value !== null && value !== '') out.push({ field, value, source: 'website', source_ref: `${s.url}${s.locator ? ` (${s.locator})` : ''}`, retrieved_at: b.capturedAt });
    };
    w('name', b.identity.name.value, b.identity.name.sources);
    w('phone', b.contact.phone.value, b.contact.phone.sources);
    w('email', b.contact.email.value, b.contact.email.sources);
    w('address', b.contact.address.value?.formatted, b.contact.address.sources);
    w('hours', b.hours.website.value, b.hours.website.sources);
    w('service_area', b.serviceArea.value?.places?.length ? b.serviceArea.value.places : null, b.serviceArea.sources);
    w('story', b.story.value?.text, b.story.sources);
    w('emergency', b.availability.emergency.value, b.availability.emergency.sources);
    w('logo', /^https?:\/\//i.test(b.brand.logo.value?.url ?? '') ? b.brand.logo.value?.url : null, b.brand.logo.sources); // a real image, not a placeholder
    const site = b.identity.website.value;
    if (b.brand.colors.length && site) out.push({ field: 'brand_colors', value: b.brand.colors.map((c) => `${c.role}:${c.hex}`), source: 'website', source_ref: `${site} (stylesheets)`, retrieved_at: b.capturedAt });
    // services, with their page on the site; menu items and prices exactly as written
    const services = b.services.items.filter((s) => s.status === 'verified');
    if (services.length) out.push({ field: 'services', value: services.map((s) => (s.page ? `${s.name} | ${s.page}` : s.name)), source: 'website', source_ref: services[0].evidence[0]?.url ?? site ?? '', retrieved_at: b.capturedAt });
    const items = b.offerings.items;
    if (items.length) out.push({ field: 'menu_items', value: items.map((i) => [i.section, i.name, i.price?.status === 'verified' ? i.price.text : ''].filter(Boolean).join(' | ')), source: 'website', source_ref: items[0].sources[0]?.url ?? '', retrieved_at: b.capturedAt });
    // the business's own claims, each by what it claims
    for (const c of b.claims) w(claimKind(String(c.value ?? '')), c.value, c.sources);
    // its own action links: booking, ordering, reserving, quotes
    const links = new Map<string, string>();
    const seen = (href: string, label?: string) => { const k = linkKind(href, label); if (k && !links.has(k) && /^https?:/i.test(href)) links.set(k, href); };
    if (b.callsToAction.booking) seen(b.callsToAction.booking, 'book');
    for (const c of [b.callsToAction.primary, b.callsToAction.secondary]) if (c) seen(c.href, c.label);
    for (const page of inventory?.pages ?? []) { for (const l of page.externalLinks) seen(l.url); for (const c of page.ctas) seen(c.href, c.label); }
    for (const [kind, href] of links) out.push({ field: `${kind}_url`, value: href, source: 'website', source_ref: site ?? href, retrieved_at: b.capturedAt });
    // profiles only: a link to a site's front page ("http://facebook.com/") is a theme placeholder, not the business
    const profile = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, '').length > 1; } catch { return false; } };
    const socials = [...new Set([...(inventory?.pages ?? []).flatMap((p2) => p2.externalLinks.filter((l) => l.kind === 'social' || l.kind === 'review').map((l) => l.url)), ...(extras?.sameAs ?? [])])].filter(profile);
    if (socials.length && site) out.push({ field: 'same_as', value: socials, source: 'website', source_ref: site, retrieved_at: b.capturedAt });
    const pages = (inventory?.pages ?? []).filter((p2) => p2.status === 'read' || p2.status === 'rendered').filter((p2) => p2.depth <= 1 && !/legal|post/.test(p2.type)).map((p2) => `${p2.title ?? p2.type} | ${p2.finalUrl ?? p2.url}`);
    if (pages.length && site) out.push({ field: 'site_pages', value: pages.slice(0, 12), source: 'website', source_ref: site, retrieved_at: b.capturedAt });
  }
  if (extras) {
    const site = b?.identity.website.value ?? '';
    if (extras.faqs.length) out.push({ field: 'faqs', value: extras.faqs.map((f) => `${f.q} | ${f.a}`), source: 'website', source_ref: extras.faqs[0].url, retrieved_at: at });
    if (extras.team.length) out.push({ field: 'team', value: extras.team.map((t) => (t.role ? `${t.name} | ${t.role}` : t.name)), source: 'website', source_ref: extras.team[0].url || site, retrieved_at: at });
  }
  for (const o of owner) out.push({ field: o.field, value: o.value, source: 'owner', source_ref: `imessage:${o.from}:${o.at}`, retrieved_at: o.at });
  return out;
}

/** how much real material each screen has (for the screen plan) */
export function materialOf(sheet: FactSheet, reviews: ReviewChoice, websitePhotos: number): Material {
  const list = (field: string) => { const v = sheet.facts.find((f) => f.field === field)?.value; return Array.isArray(v) ? v : v ? [String(v)] : []; };
  const has = (field: string) => sheet.facts.some((f) => f.field === field);
  const googlePhotos = Number(sheet.facts.find((f) => f.field === 'google_photos')?.value ?? 0);
  return {
    reviews: reviews.selected.length,
    credentials: ['licence', 'insurance', 'years_in_business', 'award'].filter(has).length,
    offerings: Math.max(list('services').length, list('menu_items').length),
    photos: websitePhotos + googlePhotos,
    processStated: has('process'),
    aboutName: list('team').length > 0 || has('owner_name'),
    aboutStory: has('story'),
    faqs: list('faqs').length,
  };
}

/** a business known from its website alone: its research record ("site-<host>") is used where a Place ID would be */
export const isSiteOnly = (id: string) => /^site-[A-Za-z0-9_.-]+$/.test(id);

export interface SplashPlan {
  /** the Google Place ID, or for a business with no listing its research record ("site-<host>") */
  placeId: string; businessKey?: string; revision?: number;
  stop?: string;
  trade: { row: string; confidence: number; via: TradeChoice['via']; secondary?: string };
  fact_sheet: Fact[]; conflicts: FactSheet['conflicts']; open_questions: string[];
  /** the same questions, each with the fact its answer settles (asked in the owner's conversation) */
  questions?: OwnerQuestion[];
  reviews: ReviewChoice; material: Material; screen_plan: ScreenPlan;
  injection: Extras['injection'];
}
export interface CollectDeps { places?: typeof placesDetails; reviews?: typeof liveReviews; now?: () => string }

/**
 * Collect and plan one business: its listing, its research (the saved brief for this listing, or new research of up to
 * 25 pages), the owner's inputs, then the fact sheet, trade, reviews and screen plan. A business that is not operating
 * stops here for a human.
 */
export async function collectSplash(placeId: string, opts: { research?: boolean } = {}, deps: CollectDeps = {}): Promise<SplashPlan> {
  const at = (deps.now ?? (() => new Date().toISOString()))();
  // a business with no Google listing, known from its website alone: its research record ("site-<host>") stands in for
  // the Place ID, and nothing is asked of Google (no listing, reviews or live hours)
  const siteOnly = isSiteOnly(placeId);
  const places: PlaceDetails = siteOnly ? { id: '' } : await (deps.places ?? placesDetails)(placeId);
  const empty = { trade: { row: 'generic', confidence: 0, via: 'fallback' as const }, fact_sheet: [], conflicts: [], open_questions: [], reviews: { selected: [], skipped: [], howChosen: '' }, material: { reviews: 0, credentials: 0, offerings: 0, photos: 0, processStated: false, aboutName: false, aboutStory: false, faqs: 0 }, screen_plan: { screens: [], merged: [], dropped: [] }, injection: [] };
  if (places.businessStatus && places.businessStatus !== 'OPERATIONAL') return { placeId, stop: `the listing's status is ${places.businessStatus}: a human must check before any page is made`, ...empty };

  const businessKey = siteOnly ? placeId : `place-${placeId}`;
  let { brief, inventory } = await getBrief(businessKey);
  if (siteOnly && !brief) return { placeId, businessKey, stop: 'this website has not been researched yet: research it first, then make the page', ...empty };
  // a saved brief made from the listing alone is researched again once the listing has a website
  const stale = !siteOnly && brief && places.websiteUri && brief.route !== 'website';
  let siteDown = '';
  if (!siteOnly && (!brief || stale) && opts.research !== false) {
    const job = await startStudioJob(places.websiteUri ? { website: places.websiteUri } : { google: placeId }, {}, { maxPages: 25 });
    const done = await runStudioJob(job.id);
    if (done.status === 'done' && done.businessKey === businessKey) ({ brief, inventory } = await getBrief(businessKey, done.revision));
    // the website on the listing could not be read: the page is built from the listing, and the owner is asked
    else if (places.websiteUri && done.status === 'failed') siteDown = places.websiteUri;
  }
  const pages = (await Promise.all((inventory?.pages ?? []).filter((p) => p.bodyHash).map(async (p) => ({ url: p.finalUrl ?? p.url, html: (await getBody(p.bodyHash)) ?? '' })))).filter((p) => p.html);
  const extras = extractExtras(pages);
  const owner = await ownerInputs(businessKey);
  const sheet = buildFactSheet(candidateFacts({ places, brief, inventory, extras, owner, at }));

  const choice = classifyTrade({ ownerTrade: owner.find((o) => o.field === 'trade')?.value as string | undefined, primaryType: places.primaryType, types: places.types, category: places.primaryTypeDisplayName?.text, name: places.displayName?.text, websiteText: pages.slice(0, 5).map((p) => p.html.replace(/<[^>]+>/g, ' ')).join(' ').slice(0, 20000) });
  const row = choice.row;
  const live: { reviews: LiveReview[] } = siteOnly ? { reviews: [] } : await (deps.reviews ?? liveReviews)(placeId).catch(() => ({ reviews: [] }));
  const team = (sheet.facts.find((f) => f.field === 'team')?.value as string[] | undefined)?.map((t) => t.split(' | ')[0]) ?? [];
  const reviews = selectReviews(live.reviews, { names: team, hide: row.id === 'counseling' });
  const material = materialOf(sheet, reviews, brief?.assets.website.usable ?? 0);
  const notes: OwnerQuestion[] = [
    ...(choice.askOwner && !choice.guess ? [{ field: 'trade', text: 'What kind of business is it, in a few words?' }] : []),
    ...(siteDown ? [{ field: 'website', text: `Your Google listing links to ${siteDown}, but it didn't load when I checked. Is that still your website?`, yes: siteDown }] : []),
    ...extras.injection.map((i) => ({ field: 'note', text: `A page on your website (${i.url}) has text addressed to an AI assistant. I ignored it; is it meant to be there?` })),
  ];
  const questions = ownerQuestions(sheet, { tradeUnsure: choice.askOwner && choice.guess ? { words: `a ${choice.guess.label.toLowerCase()}`, id: choice.guess.id } : undefined, notes });
  return {
    placeId, businessKey, revision: brief?.revision,
    trade: { row: row.id, confidence: choice.confidence, via: choice.via, ...(choice.secondary ? { secondary: choice.secondary.id } : {}) },
    fact_sheet: sheet.facts, conflicts: sheet.conflicts,
    open_questions: questions.map((q) => q.text), questions,
    reviews, material, screen_plan: planScreens(row, material), injection: extras.injection,
  };
}
