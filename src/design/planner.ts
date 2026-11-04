import { createHash } from 'node:crypto';
import type { Business, Facts, ServiceItem } from '../types.js';
import { digits } from '../util/text.js';
import {
  ACTIVE_FAMILIES, FAMILY_CURRENT, FAMILY_DIRECTION, FAMILY_LABEL, familyForDirection, type FamilyId,
  COMPAT, DENSITIES, DESIGN_PLAN_VERSION, DIRECTIONS, DIRECTION_LABEL, GOAL_LABEL, HERO_LABEL, MIN_GALLERY_PHOTOS, MIN_SLIDES, cleanText, validatePlan,
  type Arrangement, type Category, type Density, type DesignPlan, type DesignPreferences, type Direction, type Goal, type HeroVariant, type LayoutChoice, type Lockable, type TypePreset,
} from './schema.js';
import { profileFor } from './categories.js';
import type { Offering } from './offerings.js';
import { assignPhotos, photoLedOk, type PhotoInfo, type PhotoMeta, type PhotoRoles } from './photos.js';

/**
 * Resolves the design plan for any local business: owner choices first, then the saved plan (ordinary rebuilds and
 * reopening are stable), then recommendations from the business data. A seed, set when the plan is created and on
 * "Generate another design", picks among the valid options; every choice has a deterministic rule, so the plan
 * never depends on Claude. Claude's advice (facts call, src/content/facts.ts) is used only when it validates.
 */
export interface DesignAdvice { style?: string | null; mainService?: string | null; headline?: string | null; subline?: string | null }

/** What the page may claim, from verified data. */
export interface Evidence {
  showRating: boolean;
  rating?: number;
  reviewCount?: number;
  /** stated licence / insurance / years / warranty */
  trust: boolean;
  areas: string[];
  address?: string;
}

export interface PlanInput {
  businessKey: string;
  business: Business;
  facts: Facts;
  category: Category;
  /** services the site will list (src/content/services.ts) */
  services: ServiceItem[];
  servicesSource: 'business' | 'theme';
  /** offerings with their price state (src/design/offerings.ts) */
  offerings?: Offering[];
  photos: (PhotoInfo | PhotoMeta)[];
  evidence: Evidence;
  /** present when the owner answered (a refinement); absent for an ordinary build, which reuses the saved answers */
  preferences?: DesignPreferences;
  previous?: DesignPlan;
  /** "Generate another design": a new seed, keeping locked dimensions, different from these recent plans */
  alternative?: boolean;
  recent?: DesignPlan[];
  /** owner layout choices from the preview (each one locks its dimension) */
  layout?: LayoutChoice;
  advice?: DesignAdvice;
  /** the business's own story, read from its website: it always gets a section, whatever the arrangement */
  story?: boolean;
  /** brand tokens for a direction (the brand colour resolved against that direction's surfaces) */
  tokens: (direction: Direction, typography: TypePreset) => DesignPlan['tokens'];
  now?: string;
}

export interface PlanOutput {
  plan: DesignPlan;
  roles: PhotoRoles;
  warnings: string[];
  /** what "Keep recommended" means for this business, for the questions */
  recommended: { direction: Direction; goal: Goal; service: string };
}

/**
 * Does a build get a design plan? Automatic builds do, for any kind of business. A chosen or uploaded theme stays
 * authoritative unless the operator explicitly opts in (refining that build).
 */
export const designApplies = (o: { pilot: boolean; manualTheme: boolean; optIn: boolean }) => o.pilot && (o.optIn || !o.manualTheme);

export const validPhone = (b: Business) => /^\+\d{10,15}$/.test(b.phoneE164 || '') || digits(b.phone || '').length >= 10;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Match a service to one the site lists. exact: the owner's own wording only matches the same name ("Tankless water
 * heaters" stays the owner's service, not the broader "Water heaters"); otherwise containment either way (Claude).
 */
export function matchService(label: string, services: { id: string; label: string }[], exact = false) {
  const n = norm(label);
  if (!n) return undefined;
  return services.find((s) => norm(s.label) === n) || (exact ? undefined : services.find((s) => norm(s.label).includes(n) || n.includes(norm(s.label))));
}

/**
 * Words a headline or subline may only use when the data backs them. Returns the unsupported claims found.
 * Owner-typed service names are not checked (the owner states them), only generated copy.
 */
export function claimProblems(text: string, ctx: { facts: Facts; emergency: boolean; evidence: Evidence }): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/(24\/7|24-7|24 hours|around the clock|emergenc)/.test(t) && !ctx.emergency) out.push('emergency / 24h');
  if (/\blicen[sc]ed\b/.test(t) && !ctx.facts.licensed) out.push('licensed');
  if (/\binsured\b/.test(t) && !ctx.facts.insured) out.push('insured');
  if (/(warrant|guarantee)/.test(t) && !ctx.facts.warranty) out.push('warranty');
  const yrs = t.match(/(\d+)\+?\s*(years|yrs)/);
  if (yrs && Number(yrs[1]) !== ctx.facts.years) out.push('years');
  const rating = t.match(/\b([1-5]\.\d)\b/);
  if (rating && (!ctx.evidence.showRating || Number(rating[1]) !== Number(ctx.evidence.rating?.toFixed(1)))) out.push('rating');
  if (/(#\s?1\b|number one|\bbest\b|top[- ]rated|award|cheapest|lowest|\bfree\b|family[- ]owned|same[- ]day|\$\s?\d|£\s?\d|€\s?\d)/.test(t)) out.push('superlative / price / unverifiable');
  if (/https?:|www\.|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(t)) out.push('links or phone numbers');
  return out;
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the business is, in a few words ("Hair salon", "Café"), from Google's category label. */
const kindOf = (b: Business, category: Category) => (b.primaryTypeLabel && !/^point of interest|establishment$/i.test(b.primaryTypeLabel) ? b.primaryTypeLabel : profileFor(category).label);

/** Headline + subline from verified data only. Each direction phrases it differently; trades lead with the service. */
export function rulesCopy(direction: Direction, goal: Goal, service: string, i: Pick<PlanInput, 'business' | 'facts' | 'evidence' | 'services' | 'offerings'> & { emergency: boolean; category?: Category }): { headline: string; subline: string } {
  const b = i.business;
  const category = i.category ?? 'trades';
  const city = i.facts.city;
  const trades = category === 'trades';
  // trades lead with the main service; other businesses with what they are ("Hair salon in Austin")
  const subject = trades ? service : kindOf(b, category);
  const S = cap(subject);
  const s = subject.toLowerCase();
  const backed = i.services.filter((x) => (x.hits ?? 0) > 0 || x.description).map((x) => x.label.toLowerCase()).filter((x) => x !== service.toLowerCase()).slice(0, 2);
  const facts: string[] = [];
  if (i.emergency && direction === 'bold-direct' && trades) facts.push('Emergency call-outs');
  if (i.facts.licensed && i.facts.insured) facts.push('Licensed and insured');
  else if (i.facts.licensed) facts.push('Licensed');
  if (i.facts.years) facts.push(`${i.facts.years} years in business`);
  if (i.evidence.showRating) facts.push(`${i.evidence.rating?.toFixed(1)}★ from ${i.evidence.reviewCount} Google reviews`);
  const next = {
    call: 'Call to talk it through.', quote: 'Request a quote online.', appointment: 'Request an appointment and the time is confirmed with you.',
    order: 'Send an order enquiry and it is confirmed with you.', enquiry: 'Send an enquiry online.',
  }[goal];
  // what the business offers, in its own list's words (offerings first: they carry the owner's and website's names)
  const named = (i.offerings?.length ? i.offerings.filter((o) => o.source !== 'theme').map((o) => o.name) : i.services.map((x) => x.label)).slice(0, 3).map((x) => x.toLowerCase());
  const offers = trades ? listJoin([service.toLowerCase(), ...backed]) : listJoin(named);
  // an unknown kind of business: its own name says more than "Local business"
  const generic = category === 'general' && kindOf(b, category) === profileFor(category).label;
  if (generic) return { headline: city && direction !== 'bold-direct' ? `${b.name}, ${city}` : b.name, subline: `${b.name}${city ? ` in ${city}` : ''}. ${next}` };
  if (direction === 'bold-direct') {
    return { headline: city ? `${city} ${s}` : S, subline: facts.length ? facts.slice(0, 3).join(' · ') : `${b.name}. ${next}` };
  }
  if (direction === 'modern-premium') {
    return {
      headline: city ? `${S}, ${city}` : S,
      subline: trades
        ? `${b.name}${backed.length ? ` also handles ${listJoin(backed)}` : ''}${city && i.evidence.areas.length > 1 ? ` across ${city} and nearby towns` : ''}. ${next}`
        : `${b.name}${city ? ` in ${city}` : ''}${offers ? `: ${offers}` : ''}. ${next}`,
    };
  }
  if (direction === 'clean-professional') {
    return {
      headline: city ? `${S} in ${city}` : `${S} from ${b.name}`,
      subline: `${b.name}${offers ? ` offers ${offers}` : ''}${city ? `${offers ? '' : ' is'} in ${city}` : ''}. ${next}`,
    };
  }
  return {
    headline: trades ? (city ? `${S} for ${city} homes` : `${S} from ${b.name}`) : city ? `Your local ${s} in ${city}` : `${S} from ${b.name}`,
    subline: trades
      ? `${b.name} handles ${offers}${city ? ` in ${city}${i.evidence.areas.length > 1 ? ' and nearby towns' : ''}` : ''}. ${next}`
      : `${b.name}${offers ? ` offers ${offers}` : ''}${city ? `${offers ? '' : ' is'} in ${city}` : ''}. ${next}`,
  };
}

// ── seeded choices ──
const hex8 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);
export const seedFor = (businessKey: string, variation: number, attempt = 0) => hex8(`${businessKey}|${variation}|${attempt}`);
export const planId = (businessKey: string, seed: string) => `dp_${createHash('sha1').update(`${businessKey}|${seed}`).digest('hex').slice(0, 10)}`;
/** mulberry32: a small deterministic generator, so a seed always gives the same choices */
function rng(seed: string) {
  let a = parseInt(seed, 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The dimensions "Generate another design" varies, for comparing plans. */
export const planDims = (p: DesignPlan) => ({
  direction: p.direction, hero: p.hero.variant, typography: p.typography, arrangement: p.arrangement, density: p.density,
  gallery: p.sections.find((s) => s.id === 'gallery')?.variant ?? 'none', offerings: p.sections.find((s) => s.id === 'services' || s.id === 'focus')?.variant ?? 'none',
});
export function planDifference(a: DesignPlan, b: DesignPlan): number {
  const x = planDims(a);
  const y = planDims(b);
  return (Object.keys(x) as (keyof typeof x)[]).filter((k) => x[k] !== y[k]).length;
}

function recommendDirection(i: PlanInput, emergencyVerified: boolean, roles: PhotoRoles): { d: Direction; why: string } {
  const photoCount = roles.projects.length + (roles.hero ? 1 : 0);
  const standout = (i.evidence.showRating && (i.evidence.rating || 0) >= 4.8) || (i.facts.years || 0) >= 15;
  const strongPhotos = photoCount >= 4 && photoLedOk(roles.hero);
  switch (i.category) {
    case 'trades':
      if (emergencyVerified) return { d: 'bold-direct', why: i.facts.open24h ? 'open 24 hours, so fast contact leads' : 'emergency service is stated, so fast contact leads' };
      if (strongPhotos && standout) return { d: 'modern-premium', why: `${photoCount} strong project photos and ${i.facts.years && i.facts.years >= 15 ? `${i.facts.years} years in business` : `a ${i.evidence.rating?.toFixed(1)}★ rating`}` };
      break;
    case 'salon':
      return strongPhotos ? { d: 'modern-premium', why: 'a salon with strong photos: an editorial look' } : { d: 'local-trusted', why: 'a salon: warm and welcoming' };
    case 'food':
      return strongPhotos ? { d: 'modern-premium', why: 'strong food photos lead the page' } : { d: 'local-trusted', why: 'a local café or restaurant: warm and welcoming' };
    case 'fitness':
      return { d: 'bold-direct', why: 'a gym or studio: energetic, with clear actions' };
    case 'professional':
      if (strongPhotos) return { d: 'modern-premium', why: 'professional services with strong photos: an editorial look' };
      return roles.hero ? { d: 'local-trusted', why: 'professional services where the people matter: warm and credible' } : { d: 'bold-direct', why: 'professional services without photos: a clear, type-led page' };
    case 'health':
      return { d: 'local-trusted', why: 'a health clinic: warm, clear and reassuring, with booking up front' };
    case 'shop':
      return strongPhotos ? { d: 'modern-premium', why: 'a shop with strong product photos' } : { d: 'local-trusted', why: 'a local shop: welcoming, with hours and location up front' };
    case 'general':
      return roles.hero ? { d: 'local-trusted', why: 'a local business: welcoming, with the practical details up front' } : { d: 'bold-direct', why: 'no usable photos: a clear, type-led page with the main action first' };
  }
  if (!roles.hero) return { d: 'bold-direct', why: 'no usable photos: a clear, type-led page with the main action first' };
  const why = [i.evidence.showRating && 'good Google reviews', roles.team && 'a team photo', i.evidence.areas.length > 1 && 'a clear service area'].filter(Boolean);
  return { d: 'local-trusted', why: why.length ? listJoin(why as string[]) : 'a local business with modest photos and reviews' };
}

function recommendGoal(category: Category, phoneOk: boolean, emergency: boolean, direction: Direction): Goal {
  const p = profileFor(category);
  if (category === 'trades') return phoneOk && (emergency || direction === 'bold-direct') ? 'call' : 'quote';
  if (category === 'general' || category === 'food') return phoneOk ? 'call' : 'enquiry';
  return p.goals.find((g) => g !== 'call' || phoneOk) ?? 'enquiry';
}

function recommendService(i: PlanInput): { label: string; id?: string; source: DesignPlan['service']['source'] } {
  const list = i.offerings?.length ? i.offerings.map((o) => ({ id: o.id, label: o.name, hits: o.source === 'theme' ? 0 : 1 })) : i.services;
  const advised = i.advice?.mainService ? matchService(cleanText(i.advice.mainService), list) : undefined;
  if (advised) return { label: advised.label, id: advised.id, source: 'claude' };
  if ((i.servicesSource === 'business' || i.offerings?.some((o) => o.source !== 'theme')) && list[0]) return { label: list[0].label, id: list[0].id, source: 'business' };
  const hit = [...i.services].filter((s) => (s.hits ?? 0) > 0).sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0))[0];
  if (hit) return { label: hit.label, id: hit.id, source: 'mentioned' };
  const fallback = i.category === 'trades' ? i.services[0]?.label : kindOf(i.business, i.category);
  const label = cleanText(fallback || '');
  return { label: label.length >= 2 ? label : 'Our services', source: 'default' };
}

/** Offering presentations that suit the content: price lists need prices (or a menu-like business), plans need memberships. */
function offeringsFit(variant: string, i: PlanInput): boolean {
  const o = i.offerings || [];
  const priced = o.filter((x) => x.price.kind !== 'quote').length;
  if (variant === 'price-list') return priced >= 2 || ['salon', 'food'].includes(i.category);
  if (variant === 'plans') return o.length >= 2 && o.length <= 6 && (i.category === 'fitness' || o.some((x) => x.price.kind === 'unit' && ['month', 'year', 'week'].includes(x.price.unit || '')));
  if (variant === 'index') return o.length >= 3 || i.services.length >= 3;
  return true;
}

export function planDesign(i: PlanInput): PlanOutput {
  if (i.alternative) return generateAnother(i);
  return planOnce(i);
}

/**
 * "Generate another design": a bounded number of seeded candidates; the first that differs from each recent plan in
 * at least two dimensions wins, otherwise the one that differs most. Locked dimensions and the owner's answers stay.
 */
function generateAnother(i: PlanInput): PlanOutput {
  const prev = i.previous;
  const variation = Math.min(999, (prev?.variation ?? 0) + 1);
  const recent = [prev, ...(i.recent || [])].filter(Boolean).slice(0, 3) as DesignPlan[];
  let best: { out: PlanOutput; score: number } | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    const out = planOnce({ ...i, alternative: false }, { seed: seedFor(i.businessKey, variation, attempt), variation, generated: true });
    const score = recent.length ? Math.min(...recent.map((r) => planDifference(out.plan, r))) : 9;
    if (!best || score > best.score) best = { out, score };
    if (score >= 2 && (!prev || out.plan.direction !== prev.direction || score >= 3)) break;
  }
  const out = best!.out;
  out.plan.reasons.unshift(`Another design (${variation}): differs from the last design in ${recent[0] ? planDifference(out.plan, recent[0]) : 'all'} ways`);
  return out;
}

function planOnce(i: PlanInput, gen?: { seed: string; variation: number; generated: boolean }): PlanOutput {
  const now = i.now ?? new Date().toISOString();
  const prev = i.previous && i.previous.businessKey === i.businessKey ? i.previous : undefined;
  const prefs: DesignPreferences = i.preferences ?? prev?.preferences ?? {};
  const layout = i.layout || {};
  // each layout choice locks its dimension; choosing a family locks the direction
  const chosen = (Object.keys(layout) as (keyof LayoutChoice)[]).filter((k) => layout[k] != null && k !== 'upgradeFamily').map((k) => (k === 'family' ? 'direction' : k)) as Lockable[];
  const locks = new Set<Lockable>([...(prev?.locks || []), ...chosen]);
  if (prefs.style) locks.add('direction');
  const generated = !!gen?.generated;
  const seed = gen?.seed ?? prev?.seed ?? seedFor(i.businessKey, 0);
  const variation = gen?.variation ?? prev?.variation ?? 0;
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
  // keep: an ordinary rebuild or a reopened draft reuses the saved choice; a generated design keeps only locked ones
  const keep = (dim: Lockable) => !!prev && (!generated || locks.has(dim));
  const reasons: string[] = [];
  const warnings: string[] = [];
  const category = i.category;
  const profile = profileFor(category);
  const phoneOk = validPhone(i.business);
  // emergency service is what the business says it offers; opening hours on a listing don't promise dispatch
  const emergencyVerified = category === 'trades' && !!i.facts.emergency;
  const emergency = category === 'trades' && (prefs.emergencyConfirmed === false ? false : emergencyVerified || prefs.emergencyConfirmed === true);
  const roles = assignPhotos(i.photos as PhotoInfo[], prev && !generated ? { hero: prev.images.hero, team: prev.images.team, projects: prev.images.gallery } : undefined);

  // ── direction ──
  const rec = recommendDirection(i, emergencyVerified, roles);
  const advisedStyle = DIRECTIONS.find((d) => d === i.advice?.style);
  // Claude may pick the style when the rules only fell back to a default, and only one the photos can carry
  const fallbackRec = rec.d === 'local-trusted';
  // Claude may only choose among the current families, and the editorial one only with photos that can carry it
  const recDirection: Direction = fallbackRec && advisedStyle && advisedStyle !== 'clean-professional' && (advisedStyle !== 'modern-premium' || (photoLedOk(roles.hero) && roles.projects.length >= 2)) ? advisedStyle : rec.d;
  let direction: Direction;
  let dSrc: DesignPlan['sources']['direction'];
  const layoutDirection = layout.family ? FAMILY_DIRECTION[layout.family] : layout.direction;
  if (layoutDirection) { direction = layoutDirection; dSrc = 'owner'; }
  else if (prefs.style) { direction = prefs.style; dSrc = 'owner'; }
  else if (keep('direction')) { direction = prev!.direction; dSrc = prev!.sources.direction === 'owner' ? 'owner' : 'saved'; }
  else if (generated) {
    // a generated design uses a current family the content suits: editorial needs photos that can lead
    const suitable = ACTIVE_FAMILIES.filter((f) => f !== 'editorial-showcase' || (!!roles.hero && roles.projects.length >= 2));
    direction = FAMILY_DIRECTION[pick(suitable)] as Direction; dSrc = 'alternative';
  }
  else { direction = recDirection; dSrc = 'recommended'; }
  reasons.push(`Style: ${DIRECTION_LABEL[direction]} (${dSrc === 'owner' ? 'owner\'s choice' : dSrc === 'saved' ? 'kept from the saved plan' : dSrc === 'alternative' ? `generated design ${variation}` : recDirection === rec.d ? rec.why : 'Claude\'s suggestion'})`);
  const C = COMPAT[direction];
  const sameDirection = !!prev && prev.direction === direction;
  // the family and its version: a kept direction keeps the pinned version; any new choice gets the current version
  const familyId: FamilyId = familyForDirection(direction);
  const familyVersion = layout.upgradeFamily ? FAMILY_CURRENT[familyId] : sameDirection && dSrc !== 'alternative' && prev!.family ? prev!.family.version : FAMILY_CURRENT[familyId];
  reasons.push(`Family: ${FAMILY_LABEL[familyId]} v${familyVersion}${familyVersion < FAMILY_CURRENT[familyId] ? ` (pinned; v${FAMILY_CURRENT[familyId]} is available)` : ''}`);
  const first = !prev && !generated && variation === 0; // the first design: the direction's signature choices

  // ── goal ──
  let goal: Goal;
  let gSrc: DesignPlan['sources']['goal'];
  if (prefs.goal) { goal = prefs.goal; gSrc = 'owner'; }
  else if (prev && prev.sources.goal !== 'owner') { goal = prev.goal; gSrc = 'saved'; }
  else { goal = recommendGoal(category, phoneOk, emergency, direction); gSrc = 'recommended'; }
  if (goal === 'call' && !phoneOk) {
    goal = profile.goals.find((g) => g !== 'call') ?? 'enquiry';
    warnings.push(`Call was chosen but the Google profile has no valid phone number; the site leads with ${profile.actions[goal]}.`);
  }
  reasons.push(`Main action: ${profile.actions[goal]}${gSrc === 'owner' ? ' (owner\'s choice)' : ''}${goal === 'appointment' ? '; sent as a request, the business confirms the time' : ''}`);

  // ── service focus ──
  const recService = recommendService(i);
  const listed = i.offerings?.length ? i.offerings.map((o) => ({ id: o.id, label: o.name })) : i.services;
  let service: DesignPlan['service'];
  let sSrc: DesignPlan['sources']['service'];
  if (prefs.service) {
    const m = matchService(prefs.service, listed, true);
    service = m ? { label: m.label, id: m.id, source: 'owner' } : { label: prefs.service, source: 'owner' };
    sSrc = 'owner';
  } else if (prev && prev.sources.service !== 'owner' && (prev.service.source === 'default' || matchService(prev.service.label, listed, true))) {
    service = prev.service;
    sSrc = 'saved';
  } else { service = recService; sSrc = 'recommended'; }
  reasons.push(`Main ${profile.noun}: ${service.label} (${sSrc === 'owner' ? 'owner\'s choice' : sSrc === 'saved' ? 'kept from the saved plan' : service.source === 'business' ? 'listed first by the business' : service.source === 'mentioned' ? 'most mentioned in the website and reviews' : service.source === 'claude' ? 'Claude, from the website and reviews' : 'nothing stands out, general wording'})`);

  // ── typography, hero, arrangement, density ──
  const typography: TypePreset = keep('typography') && sameDirection && C.typography.includes(prev!.typography) ? prev!.typography : first ? C.typography[0] : pick(C.typography);
  const slidesOk = roles.slides.length >= MIN_SLIDES;
  const feasible = C.heroes.filter((v) => v === 'type-led' || (v === 'photo-led' ? photoLedOk(roles.hero) : v === 'carousel' ? slidesOk : splitOk(roles.hero)));
  let heroVariant: HeroVariant;
  if (layout.hero) {
    if (!feasible.includes(layout.hero)) throw new PlanChoiceError(`The ${HERO_LABEL[layout.hero].toLowerCase()} hero needs ${layout.hero === 'carousel' ? `${MIN_SLIDES} good landscape photos` : layout.hero === 'photo-led' ? 'a large, sharp landscape photo' : 'a photo'}.`);
    heroVariant = layout.hero;
  } else if (keep('hero') && feasible.includes(prev!.hero.variant)) heroVariant = prev!.hero.variant;
  else if (first) heroVariant = feasible.find((v) => v !== 'carousel') ?? 'type-led';
  else heroVariant = feasible.length ? pick(feasible) : 'type-led';
  if (!roles.hero) reasons.push('Hero: typography-led, no usable photo');
  else if (heroVariant === 'type-led') reasons.push(`Hero: typography-led${photoLedOk(roles.hero) ? '' : ', the best photo is too small or soft to lead'}`);
  else reasons.push(`Hero: ${HERO_LABEL[heroVariant].toLowerCase()}${heroVariant === 'carousel' ? `, ${Math.min(5, roles.slides.length)} photos` : ' with the strongest photo'}`);
  const arrangement: Arrangement = layout.arrangement ?? (keep('arrangement') ? prev!.arrangement : first ? 'a' : pick(['a', 'b'] as Arrangement[]));
  const density: Density = keep('density') && prev ? prev.density : first || !generated ? C.density : pick([C.density, C.density, ...DENSITIES]);

  // ── photos for the page ──
  const slideKeys = heroVariant === 'carousel' ? roles.slides.slice(0, 5).map((p) => p.key) : [];
  let pool = roles.projects;
  if (heroVariant === 'type-led' && roles.hero && roles.hero.kind !== 'team') pool = [roles.hero, ...pool]; // the photo isn't in the hero: show it with the rest
  pool = pool.filter((p) => !slideKeys.includes(p.key)).slice(0, 8);

  // ── sections ──
  const ev = i.evidence;
  const proofOk = ev.showRating || ev.trust;
  const areaOk = ev.areas.length > 0 || !!ev.address || (i.business.hours?.periods?.length ?? 0) > 0;
  const S = (id: DesignPlan['sections'][number]['id'], variant: string) => ({ id, variant });
  const savedVariant = (id: string) => (keep(id === 'gallery' ? 'gallery' : id === 'services' ? 'offerings' : 'arrangement') && sameDirection ? prev!.sections.find((s) => s.id === id)?.variant : undefined);
  const choose = (id: DesignPlan['sections'][number]['id'], opts: string[], fixed?: string): string => {
    const allowed = opts.filter((v) => (C.sections[id] || []).includes(v)); // in the caller's order of preference
    if (fixed) {
      if (!allowed.includes(fixed)) throw new PlanChoiceError(`${fixed} isn't available for this ${id === 'services' ? 'list' : id} with the ${DIRECTION_LABEL[direction]} style.`);
      return fixed;
    }
    const was = savedVariant(id);
    if (was && allowed.includes(was)) return was;
    return first ? allowed[0] : pick(allowed);
  };
  const galleryOpts = (C.sections.gallery || []).filter((v) => pool.length >= (MIN_GALLERY_PHOTOS[v] ?? 2));
  const galleryVariant = galleryOpts.length && pool.length >= 2 ? choose('gallery', galleryOpts, layout.gallery) : undefined;
  if (layout.gallery && !galleryVariant) throw new PlanChoiceError('There aren\'t enough photos for a gallery.');
  const offerOpts = (C.sections.services || []).filter((v) => offeringsFit(v, i));
  // the category's usual presentation first (a salon's price list, a gym's plans) when this direction has it
  const offerFirst = offerOpts.includes(profile.offeringsVariant) ? [profile.offeringsVariant, ...offerOpts.filter((v) => v !== profile.offeringsVariant)] : offerOpts;
  const offeringsVariant = choose('services', offerFirst, layout.offerings);
  const introVariant = C.sections.intro ? choose('intro', C.sections.intro) : 'lead';
  const hasIntro = !!(i.business.editorialSummary || category !== 'trades');
  const quote = S('quote', C.sections.quote![0]);
  const early = goal !== 'call';
  // nothing real to list (no offerings, no services): no offerings section rather than a lone generic item
  const hasOfferings = (i.offerings?.length ?? 0) > 0 || i.services.length > 0;
  const services = hasOfferings && S('services', offeringsVariant);
  // the editorial layout features one service for trades; a priced menu or price list is shown whole
  const featureOne = category === 'trades' || !(i.offerings || []).some((o) => o.price.kind !== 'quote');
  const gallery = galleryVariant ? S('gallery', galleryVariant) : false;
  const team = !!roles.team && C.sections.team ? S('team', C.sections.team[0]) : false;
  const proof = proofOk && S('proof', C.sections.proof![0]);
  const area = areaOk && S('area', C.sections.area![0] === 'coverage' && profile.hoursFirst && C.sections.area!.includes('compact') ? 'compact' : C.sections.area![0]);
  const intro = hasIntro && S('intro', introVariant);
  // a restaurant has no "how it works": its steps (call, agree the details) are a trade's, so it shows none unless it takes orders
  const process = category === 'food' && goal !== 'order' ? false : S('process', 'steps');
  let sections: (DesignPlan['sections'][number] | false)[];
  if (direction === 'clean-professional') {
    sections = arrangement === 'a'
      ? [S('hero', heroVariant), intro, services, gallery, proof, team, process, quote, area, S('footer', 'clean')]
      : [S('hero', heroVariant), services, proof, gallery, intro, team, area, quote, S('footer', 'clean')];
  } else if (direction === 'local-trusted') {
    sections = arrangement === 'a'
      ? [S('hero', heroVariant), services, team, proof, gallery, early && quote, area, !early && quote, S('footer', 'warm')]
      : [S('hero', heroVariant), intro, gallery, services, proof, team, area, quote, S('footer', 'warm')];
  } else if (direction === 'bold-direct') {
    const urgent = emergency && phoneOk && S('urgent', 'band');
    sections = arrangement === 'a'
      ? [S('hero', heroVariant), S('actions', 'contact-band'), urgent, services, early && quote, gallery, proof, team, !early && quote, area, S('footer', 'dark')]
      : [S('hero', heroVariant), S('actions', 'contact-band'), urgent, gallery, services, proof, quote, team, area, S('footer', 'dark')];
  } else {
    sections = arrangement === 'a'
      ? [S('hero', heroVariant), !hasOfferings ? intro : featureOne ? S('focus', 'editorial') : services, gallery, process, team, proof, quote, area, S('footer', 'minimal')]
      : [S('hero', heroVariant), intro, services, gallery, proof, team, process, quote, area, S('footer', 'minimal')];
  }
  const list = sections.filter(Boolean) as DesignPlan['sections'];
  // the business's own words are content to keep: if the arrangement left out the introduction, it goes after the offerings
  if (i.story && C.sections.intro && !list.some((s) => s.id === 'intro')) {
    const at = list.findIndex((s) => s.id === 'services' || s.id === 'focus');
    list.splice(at >= 0 ? at + 1 : 1, 0, S('intro', introVariant));
  }
  const ids = new Set(list.map((s) => s.id));
  if (!roles.team) reasons.push('No team section: no photo is confirmed to show the team');
  if (!ids.has('gallery')) reasons.push(`No gallery: ${pool.length} photo${pool.length === 1 ? '' : 's'} left for it`);
  if (!proofOk) reasons.push('No reviews section: rating under 4.0 or fewer than 5 reviews, and no stated licence, insurance or years');
  else if (!ev.showRating) reasons.push('No rating shown: under 4.0 or fewer than 5 Google reviews');
  if (direction === 'bold-direct' && category === 'trades' && !ids.has('urgent')) reasons.push(emergency ? 'No emergency band: no phone number to call' : 'No emergency messaging: not stated by the business or confirmed by the owner');

  // ── copy ──
  const rules = rulesCopy(direction, goal, service.label, { ...i, emergency, category });
  const ctx = { facts: i.facts, emergency, evidence: ev };
  let copy: DesignPlan['copy'] = { ...rules, source: 'rules' };
  const a = i.advice;
  // saved copy is kept so a rebuild doesn't rewrite what the owner saw; but copy the rules wrote because Claude was unavailable is replaced once Claude's suggestion exists
  const keepCopy = prev && prev.service.label === service.label && prev.direction === direction && prev.goal === goal && (!generated || locks.has('direction')) && !(a?.headline && prev.copy.source === 'rules');
  const ah = a?.headline ? cleanText(a.headline, 90) : '';
  const as = a?.subline ? cleanText(a.subline, 220) : '';
  const mentions = (t: string) => category !== 'trades' || norm(t).includes(norm(service.label).split(' ')[0]);
  if (keepCopy) copy = { ...prev!.copy, source: 'saved' };
  else if (!generated && ah && as && ah.split(/\s+/).length <= 10 && mentions(ah) && !claimProblems(`${ah} ${as}`, ctx).length && sSrc !== 'owner' && direction === recDirection) {
    copy = { headline: ah, subline: as, source: 'claude' };
  } else if (ah && !generated) {
    const p = claimProblems(`${ah} ${as}`, ctx);
    if (p.length) warnings.push(`Claude's headline was not used (unsupported: ${p.join(', ')})`);
  }

  // ── images ──
  const used = new Set<string>(slideKeys);
  const heroKey = heroVariant !== 'type-led' && roles.hero ? roles.hero.key : null;
  if (heroKey) used.add(heroKey);
  const teamKey = ids.has('team') && roles.team && !used.has(roles.team.key) ? roles.team.key : null;
  if (teamKey) used.add(teamKey);
  const galleryKeys = ids.has('gallery') ? pool.map((p) => p.key).filter((k) => !used.has(k)).slice(0, galleryVariant === 'masonry' ? 7 : 6) : [];

  const id = planId(i.businessKey, seed);
  const plan: DesignPlan = {
    version: DESIGN_PLAN_VERSION,
    family: { id: familyId, version: familyVersion },
    id,
    businessKey: i.businessKey,
    seed,
    variation,
    category,
    vertical: i.business.primaryType ? cleanText(i.business.primaryType, 40) || category : category,
    direction,
    goal,
    service,
    hero: { variant: heroVariant },
    arrangement,
    density,
    sections: list,
    typography,
    tokens: i.tokens(direction, typography),
    images: { hero: heroKey, slides: slideKeys, team: teamKey, gallery: galleryKeys },
    copy,
    emergency,
    sources: { direction: dSrc, goal: gSrc, service: sSrc },
    preferences: prefs,
    locks: [...locks].filter((l) => ['direction', 'typography', 'hero', 'arrangement', 'gallery', 'offerings', 'density'].includes(l)),
    planner: copy.source === 'claude' || service.source === 'claude' || recDirection !== rec.d ? 'claude+rules' : 'rules',
    reasons,
    createdAt: prev && prev.id === id ? prev.createdAt : now,
    updatedAt: now,
  };
  const recommended = { direction: recDirection, goal: recommendGoal(category, phoneOk, emergency, recDirection), service: recService.label };
  const v = validatePlan(plan);
  if (!v.ok) {
    // never ship an invalid composition: fall back to the simplest valid page for the direction
    warnings.push(`Design plan failed validation (${v.errors.join('; ')}); using the basic layout.`);
    const basic: DesignPlan = {
      ...plan, hero: { variant: 'type-led' }, images: { hero: null, slides: [], team: null, gallery: [] },
      sections: [S('hero', 'type-led'), ...(hasOfferings ? [direction === 'modern-premium' ? S('focus', 'editorial') : S('services', C.sections.services![0])] : []), quote, S('footer', C.sections.footer![0])],
    };
    return { plan: basic, roles, warnings, recommended };
  }
  return { plan: v.plan, roles, warnings, recommended };
}

/** An owner layout choice that this business's content can't support (shown in the editor). */
export class PlanChoiceError extends Error {}

/** What the editor's Layout panel can offer for the current plan and photos. */
/** Big enough to fill half the first screen without looking soft. */
const splitOk = (p?: { width: number; height: number }) => !!p && Math.max(p.width, p.height) >= 1000;

export function layoutOptions(plan: DesignPlan, photos: (PhotoInfo | PhotoMeta)[], i: Pick<PlanInput, 'offerings' | 'category' | 'services'>) {
  const roles = assignPhotos(photos as PhotoInfo[]);
  const C = COMPAT[plan.direction];
  const heroes = C.heroes.filter((v) => v === 'type-led' || (v === 'photo-led' ? photoLedOk(roles.hero) : v === 'carousel' ? roles.slides.length >= MIN_SLIDES : splitOk(roles.hero)));
  const n = roles.projects.length + (roles.hero ? 1 : 0);
  const gallery = (C.sections.gallery || []).filter((v) => n - 1 >= (MIN_GALLERY_PHOTOS[v] ?? 2));
  const offerings = (C.sections.services || []).filter((v) => offeringsFit(v, { ...i, offerings: i.offerings } as PlanInput));
  return { directions: [...DIRECTIONS], heroes, arrangements: ['a', 'b'], gallery, offerings: plan.direction === 'modern-premium' && plan.arrangement === 'a' ? [] : offerings };
}

export { GOAL_LABEL };
