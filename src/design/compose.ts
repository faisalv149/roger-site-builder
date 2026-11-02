import type { Theme } from '../theme/schema.js';
import type { Business, Facts, ServiceItem } from '../types.js';
import type { SiteImage } from '../brand/photos.js';
import type { SiteModel } from '../content/model.js';
import { slugify } from '../util/text.js';
import { DIRECTION_PRESETS, TYPE_PRESET_DEFS, fontsUrl } from './directions.js';
import { cropSpec, writeCrops, type PhotoInfo, type PhotoMeta } from './photos.js';
import type { Appearance, DesignPlan, Goal, TypePreset } from './schema.js';
import { matchService, validPhone } from './planner.js';
import { profileFor, type CategoryProfile } from './categories.js';
import { formatPrice, hasSamplePrices, toServiceItems, type Offering } from './offerings.js';
import { appearanceCss, resolveAppearance, type ResolvedAppearance } from './appearance.js';

/** One offering as the page shows it: escaped at render time like all text. */
export interface OfferingView { id: string; name: string; description?: string; duration?: string; price: string; priced: boolean; sample: boolean; icon: string; unit?: string; /** the price itself, for structured data */ priceData?: { kind: string; amount?: number; max?: number; currency: string; unit?: string } }

/** What the design renderers (src/render/design-sections.ts) need beyond the regular site model. */
export interface DesignModel {
  plan: DesignPlan;
  profile: CategoryProfile;
  heroImages?: { desktop: SiteImage; mobile: SiteImage };
  /** carousel hero: each slide's desktop + phone crop */
  slides: { desktop: SiteImage; mobile: SiteImage }[];
  team?: { desktop: SiteImage; mobile: SiteImage };
  gallery: SiteImage[];
  focus: ServiceItem;
  others: ServiceItem[];
  offerings: OfferingView[];
  /** fictional sample data: prices are labelled as samples */
  samplePrices: boolean;
  intro?: string;
  steps: { title: string; text: string }[];
  band: string;
  phoneOk: boolean;
  /** the emergency band's line, only when the plan allows emergency messaging */
  emergencyLine?: string;
  /** short label for the header button */
  headerLabel: string;
  /** the main action's label for this category ("Request an appointment", "Order enquiry") */
  actionLabel: string;
  /** where visitors can read the reviews when the page can't show Google's review text (published sites) */
  reviewsLink?: string;
  /** the owner's saved appearance, as CSS variables (empty when nothing was customised) */
  appearance?: ResolvedAppearance;
  appearanceCss: string;
  motion: 'off' | 'subtle' | 'expressive';
}

/** Page structure + calls to action from the plan (tokens were applied earlier, see applyDirectionTokens). */
export function composeTheme(t: Theme, plan: DesignPlan, b: Business): void {
  const profile = profileFor(plan.category);
  t.sections = plan.sections.map((s) => s.id);
  t.sectionLayout = Object.fromEntries(plan.sections.map((s) => [s.id, { variant: s.variant }]));
  const phoneOk = validPhone(b);
  t.copy = {
    ...t.copy,
    action: profile.actions[plan.goal],
    actionKind: plan.goal === 'call' && phoneOk ? 'call' : 'form',
    quoteTitle: requestTitle(plan.goal, profile),
  };
  t.roger = { ...t.roger, headerCallButton: plan.goal === 'call' && phoneOk };
}

/** Title of the request section for the goal (a call-first page still offers a written request). */
export const requestTitle = (goal: Goal, p: CategoryProfile) => (goal === 'call' ? 'Send a request' : p.actions[goal]);

/** The steps of the request path for the chosen goal: what the visitor does, never claims about the work. */
export function processSteps(goal: Goal, name: string, phone: string | undefined, p: CategoryProfile): { title: string; text: string }[] {
  if (goal === 'call' && phone) return [
    { title: `Call ${phone}`, text: `Talk to ${name} about what you need.` },
    { title: 'Agree the details', text: 'Pick a time that suits you.' },
    { title: 'Nothing is booked until you agree', text: 'The details are settled with you first.' },
  ];
  if (goal === 'appointment') return [
    { title: 'Request a time', text: 'Choose a preferred day and time of day.' },
    { title: `${name} confirms`, text: 'Your request is confirmed by text or phone; it isn\'t booked until then.' },
    { title: p.id === 'trades' ? 'The visit' : 'Your appointment', text: 'At the time you agreed together.' },
  ];
  return p.process(name);
}

/** A short introduction from verified data only: Google's own summary, or what and where the business is. */
function introText(b: Business, f: Facts, p: CategoryProfile): string | undefined {
  if (b.editorialSummary) return b.editorialSummary;
  const kind = b.primaryTypeLabel && !/establishment|point of interest/i.test(b.primaryTypeLabel) ? b.primaryTypeLabel.toLowerCase() : p.label.toLowerCase();
  const where = f.city ? ` in ${f.city}` : '';
  const years = f.years ? `, in business for ${f.years} years` : '';
  return `${b.name} is a ${kind}${where}${years}.`;
}

export interface FinishOpts {
  facts: Facts;
  outDir: string;
  publicPrefix: string;
  maxKb: number;
  /** every analysed photo of the business (the plan refers to them by key) */
  photos: (PhotoInfo | PhotoMeta)[];
  /** the original or stored image of a photo, for crops that don't exist yet */
  raw: (p: PhotoMeta) => Promise<Buffer | undefined>;
  offerings: Offering[];
  appearance?: Appearance;
  /** the owner's per-photo choices: focal point for crops, alt text */
  media?: Map<string, { focal?: { x: number; y: number }; alt?: string }>;
  /** a link to the business's Google reviews, shown where review text can't be (published sites) */
  reviewsLink?: string;
}

/**
 * After buildModel: copy, visibility, image roles, offerings with prices and the focus item from the plan.
 * Owner-entered names that aren't on the list are added (escaped like all text when rendered).
 */
export async function finishModel(m: SiteModel, plan: DesignPlan, opts: FinishOpts): Promise<DesignModel> {
  const b = m.business;
  const profile = profileFor(plan.category);
  m.copy.hero = plan.copy.headline;
  m.copy.subline = plan.copy.subline;
  m.visible = Object.fromEntries(plan.sections.map((s) => [s.id, true]));
  m.hidden = {};

  // offerings replace the theme's service list (the lead form's choices too); the focus item comes first
  const items = opts.offerings.length ? toServiceItems(opts.offerings) : m.services.items;
  let focus = matchService(plan.service.label, items, plan.service.source === 'owner') as ServiceItem | undefined;
  if (!focus) focus = { id: slugify(plan.service.label) || 'service', label: plan.service.label, icon: plan.category === 'trades' ? 'wrench' : 'sparkles', hits: 0 };
  const others = items.filter((s) => s.id !== focus!.id).slice(0, 11);
  m.services = { ...m.services, items: [focus, ...others], overflow: false };
  const order = [focus.id, ...others.map((o) => o.id)];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : 999);
  const offerings: OfferingView[] = opts.offerings
    .slice()
    .sort((a, c) => rank(a.id) - rank(c.id))
    .map((o) => ({ id: o.id, name: o.name, description: o.description, duration: o.duration, price: formatPrice(o.price, plan.category), priced: o.price.kind !== 'quote', sample: o.source === 'sample', icon: o.icon || 'circle-check', unit: o.price.unit, priceData: o.price.kind !== 'quote' ? o.price : undefined }));

  const byKey = new Map(opts.photos.map((p) => [p.key, p]));
  const crop = async (key: string | null, use: Parameters<typeof cropSpec>[0], name: string, alt: string) => {
    const p = key ? byKey.get(key) : undefined;
    const spec = cropSpec(use, plan.direction);
    const own = key ? opts.media?.get(key) : undefined;
    return p && spec ? writeCrops(p as PhotoInfo, spec, { ...opts, name, alt: own?.alt || alt, raw: () => opts.raw(p), focal: own?.focal }) : undefined;
  };
  const altFor = plan.category === 'trades' ? `${b.name}: ${plan.service.label.toLowerCase()}` : `${b.name}${opts.facts.city ? `, ${opts.facts.city}` : ''}`;
  const heroImages = plan.hero.variant === 'carousel' ? undefined : await crop(plan.images.hero, plan.hero.variant, 'hero', altFor);
  const slides = plan.hero.variant === 'carousel'
    ? (await Promise.all(plan.images.slides.map((k, i) => crop(k, 'carousel', `slide${i}`, `${b.name}: photo ${i + 1} of ${plan.images.slides.length}`)))).filter(Boolean) as { desktop: SiteImage; mobile: SiteImage }[]
    : [];
  const lead = heroImages || slides[0];
  if (lead) m.images.hero = lead.desktop; // share card, preload, JSON-LD
  const team = await crop(plan.images.team, 'team', 'team', `The ${b.name} team`);
  const galleryAlt = profile.id === 'trades' ? `Recent work by ${b.name}` : profile.id === 'food' ? `From ${b.name}` : `${b.name}`;
  const gallery = plan.images.gallery.map((k) => byKey.get(k)).filter(Boolean).map((p, i) => ({ ...p!.image, alt: opts.media?.get(p!.key)?.alt || `${galleryAlt}, photo ${i + 1}` }));
  m.images.gallery = gallery; // the photo viewer pages through these

  const phoneOk = validPhone(b);
  const f = opts.facts;
  const emergencyLine = plan.emergency && phoneOk && plan.category === 'trades'
    ? f.open24h ? 'Open 24 hours. Something urgent?' : 'Emergency call-outs. Something urgent?'
    : undefined;
  const appearance = opts.appearance && Object.keys(opts.appearance).length
    ? resolveAppearance(opts.appearance, { brand: plan.tokens.brand, surface: plan.tokens.surface, ink: plan.tokens.ink, shades: m.brand.shades })
    : undefined;
  if (appearance?.fonts) m.fonts = { heading: appearance.fonts.heading, body: appearance.fonts.body, faces: [{ family: TYPE_PRESET_DEFS[opts.appearance!.font!].label, url: appearance.fonts.url }] };
  return {
    plan,
    profile,
    heroImages,
    slides,
    team,
    gallery,
    focus,
    others,
    offerings,
    samplePrices: hasSamplePrices(opts.offerings),
    intro: introText(b, f, profile),
    steps: processSteps(plan.goal, b.name, phoneOk ? m.contact.phone : undefined, profile),
    band: DIRECTION_PRESETS[plan.direction].band,
    phoneOk,
    emergencyLine,
    headerLabel: plan.goal === 'call' ? 'Send a request' : profile.actions[plan.goal].replace(/^Request an? /, 'Request '),
    actionLabel: profile.actions[plan.goal === 'call' ? (profile.goals.find((g) => g !== 'call') ?? 'enquiry') : plan.goal],
    appearance,
    appearanceCss: appearance ? appearanceCss(appearance) : '',
    motion: appearance?.motion ?? opts.appearance?.motion ?? 'subtle',
    reviewsLink: opts.reviewsLink,
  };
}

/** Only the selected pair's families are requested (one stylesheet), with system fallbacks in the stacks. */
export function designFonts(typography: TypePreset): SiteModel['fonts'] {
  const p = TYPE_PRESET_DEFS[typography];
  return { heading: `'${p.heading.family}', ${p.heading.fallback}`, body: `'${p.body.family}', ${p.body.fallback}`, faces: [{ family: p.label, url: fontsUrl(p) }] };
}
