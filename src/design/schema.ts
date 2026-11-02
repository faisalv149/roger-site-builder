import { z } from 'zod';
import { CATEGORIES, GOALS, type Category, type Goal } from './categories.js';
export { GOALS, type Goal, type Category };

/**
 * The design plan (version 2): which direction, hero, type, section order, offering and gallery presentation a site
 * uses, plus the owner's answers, locks and appearance choices. Saved with the build and the draft, validated on
 * every read. Compatibility rules: docs/design-directions.md; enforced by planProblems(). Version 1 plans
 * (plumbing pilot) are migrated on read.
 */
export const DESIGN_PLAN_VERSION = 3;

/**
 * Page families: complete, authored page designs (header, hero, section rhythm, offerings, proof, imagery, contact,
 * footer, inner pages). A plan pins the family AND its version, so updating a family never silently redesigns a
 * customer's site; the owner can upgrade deliberately. Version 1 is the earlier direction-based renderer
 * (src/render/design-sections.ts) that existing sites were built with; version 2 is the authored family
 * (src/render/families/). Clean professional exists only as version 1 (kept working for existing sites).
 */
export const FAMILIES = ['editorial-showcase', 'warm-local', 'bold-practical', 'clean-professional'] as const;
export type FamilyId = (typeof FAMILIES)[number];
export const FAMILY_CURRENT: Record<FamilyId, number> = { 'editorial-showcase': 2, 'warm-local': 2, 'bold-practical': 2, 'clean-professional': 1 };
/** families new plans may choose */
export const ACTIVE_FAMILIES: FamilyId[] = ['editorial-showcase', 'warm-local', 'bold-practical'];
export const FAMILY_LABEL: Record<FamilyId, string> = { 'editorial-showcase': 'Editorial Showcase', 'warm-local': 'Warm Local', 'bold-practical': 'Bold Practical', 'clean-professional': 'Clean Professional (earlier design)' };
/** each family is built on one direction's tokens (surfaces, type pairs, shapes) */
export const FAMILY_DIRECTION: Record<FamilyId, 'modern-premium' | 'local-trusted' | 'bold-direct' | 'clean-professional'> = { 'editorial-showcase': 'modern-premium', 'warm-local': 'local-trusted', 'bold-practical': 'bold-direct', 'clean-professional': 'clean-professional' };
export const familyForDirection = (d: string): FamilyId => (FAMILIES.find((f) => FAMILY_DIRECTION[f] === d) ?? 'warm-local');

export const DIRECTIONS = ['clean-professional', 'local-trusted', 'bold-direct', 'modern-premium'] as const;
export const HERO_VARIANTS = ['split', 'photo-led', 'type-led', 'carousel'] as const;
export const TYPE_PRESETS = ['clean-sans', 'clean-geometric', 'warm-serif', 'friendly-sans', 'compact-grotesk', 'heavy-grotesk', 'editorial', 'editorial-sans'] as const;
export const DESIGN_SECTIONS = ['hero', 'intro', 'actions', 'urgent', 'focus', 'services', 'team', 'gallery', 'process', 'proof', 'area', 'quote', 'footer'] as const;
export const ARRANGEMENTS = ['a', 'b'] as const;
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export const LOCKABLE = ['direction', 'typography', 'hero', 'arrangement', 'gallery', 'offerings', 'density'] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type HeroVariant = (typeof HERO_VARIANTS)[number];
export type TypePreset = (typeof TYPE_PRESETS)[number];
export type DesignSectionId = (typeof DESIGN_SECTIONS)[number];
export type Arrangement = (typeof ARRANGEMENTS)[number];
export type Density = (typeof DENSITIES)[number];
export type Lockable = (typeof LOCKABLE)[number];

export const DIRECTION_LABEL: Record<Direction, string> = { 'clean-professional': 'Clean professional', 'local-trusted': 'Warm local', 'bold-direct': 'Bold practical', 'modern-premium': 'Editorial showcase' };
export const GOAL_LABEL: Record<Goal, string> = { call: 'Call', quote: 'Request a quote', appointment: 'Request an appointment', order: 'Order enquiry', enquiry: 'Send an enquiry' };
export const HERO_LABEL: Record<HeroVariant, string> = { split: 'Split text and photo', 'photo-led': 'Large photograph', 'type-led': 'Typography-led', carousel: 'Photo carousel' };

/** Hero, type and section variants each direction may use. hero and footer are first and last; one request section. */
export const COMPAT: Record<Direction, { heroes: HeroVariant[]; typography: TypePreset[]; density: Density; sections: Partial<Record<DesignSectionId, string[]>> }> = {
  'clean-professional': {
    heroes: ['split', 'carousel', 'photo-led', 'type-led'], typography: ['clean-sans', 'clean-geometric'], density: 'comfortable',
    sections: { intro: ['lead', 'split'], services: ['cards', 'price-list', 'plans'], team: ['portrait-split'], gallery: ['grid', 'masonry', 'strip'], process: ['steps'], proof: ['review-cards'], area: ['coverage', 'compact'], quote: ['split', 'inline'], footer: ['clean'] },
  },
  'local-trusted': {
    heroes: ['split', 'carousel', 'type-led', 'photo-led'], typography: ['warm-serif', 'friendly-sans'], density: 'comfortable',
    sections: { intro: ['lead', 'split'], services: ['cards', 'checklist', 'price-list', 'plans'], team: ['portrait-split'], gallery: ['grid', 'masonry', 'strip'], process: ['steps'], proof: ['review-cards'], area: ['coverage'], quote: ['split'], footer: ['warm'] },
  },
  'bold-direct': {
    heroes: ['photo-led', 'type-led', 'split', 'carousel'], typography: ['compact-grotesk', 'heavy-grotesk'], density: 'compact',
    sections: { intro: ['lead'], actions: ['contact-band'], urgent: ['band'], services: ['dense-list', 'checklist', 'price-list', 'plans', 'cards'], team: ['strip'], gallery: ['strip', 'grid', 'masonry'], process: ['steps'], proof: ['stat-band'], area: ['chips'], quote: ['inline'], footer: ['dark'] },
  },
  'modern-premium': {
    heroes: ['photo-led', 'split', 'carousel', 'type-led'], typography: ['editorial', 'editorial-sans'], density: 'spacious',
    sections: { intro: ['lead', 'split'], focus: ['editorial'], services: ['index', 'price-list', 'plans', 'cards'], gallery: ['large', 'masonry', 'grid'], process: ['steps'], team: ['portrait-split'], proof: ['pull-quote'], area: ['compact'], quote: ['consultation'], footer: ['minimal'] },
  },
};
/** photos a gallery variant needs; the carousel hero needs 3 slides */
export const MIN_GALLERY_PHOTOS: Record<string, number> = { grid: 3, masonry: 4, strip: 2, large: 2 };
export const MIN_SLIDES = 3;

// ── owner answers (the three optional questions) ──
const SERVICE_TEXT = /^[\p{L}\p{N}][\p{L}\p{N} &'/,.+-]{1,58}$/u;
export const cleanText = (s: unknown, max = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const preferencesSchema = z.object({
  service: z.preprocess((v) => (v == null || v === '' ? undefined : cleanText(v)), z.string().regex(SERVICE_TEXT, 'use 2-60 letters, numbers and simple punctuation').refine((s) => !/https?:|www\.|@/.test(s), 'no links or emails').optional()),
  goal: z.enum(GOALS).optional(),
  style: z.enum(DIRECTIONS).optional(),
  emergencyConfirmed: z.boolean().optional(),
}).strict();
export type DesignPreferences = z.infer<typeof preferencesSchema>;

// ── owner appearance (the preview customiser): applied through CSS variables, no regeneration ──
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const COLOR_PRESETS = ['brand', 'brand-deep', 'ink', 'forest', 'ocean', 'plum', 'terracotta', 'gold'] as const;
export const GRADIENT_PRESETS = ['brand-fade', 'sunset', 'ocean', 'forest', 'plum', 'slate'] as const;
export const appearanceSchema = z.object({
  color: z.object({
    mode: z.enum(['solid', 'gradient']).default('solid'),
    preset: z.enum(COLOR_PRESETS).optional(),
    accent: hex.optional(),
    gradient: z.object({ preset: z.enum(GRADIENT_PRESETS).optional(), from: hex.optional(), to: hex.optional(), angle: z.union([z.literal(90), z.literal(135), z.literal(180)]).default(135) }).strict().optional(),
  }).strict().optional(),
  font: z.enum(TYPE_PRESETS).optional(),
  textSize: z.enum(['compact', 'comfortable']).optional(),
  buttons: z.enum(['rounded', 'pill', 'square']).optional(),
  corners: z.enum(['sharp', 'soft', 'round']).optional(),
  spacing: z.enum(DENSITIES).optional(),
  motion: z.enum(['off', 'subtle', 'expressive']).optional(),
}).strict();
export type Appearance = z.infer<typeof appearanceSchema>;

/** owner layout choices (need a re-render, still no Places/Claude): each one also locks that dimension */
export const layoutSchema = z.object({
  /** the page family (current families only); a deliberate choice, so it also gets the family's current version */
  family: z.enum(['editorial-showcase', 'warm-local', 'bold-practical']).optional(),
  /** move a pinned site to its family's current version */
  upgradeFamily: z.boolean().optional(),
  hero: z.enum(HERO_VARIANTS).optional(),
  arrangement: z.enum(ARRANGEMENTS).optional(),
  gallery: z.enum(['grid', 'masonry', 'strip', 'large']).optional(),
  offerings: z.enum(['cards', 'price-list', 'plans', 'dense-list', 'checklist', 'index']).optional(),
  direction: z.enum(DIRECTIONS).optional(),
}).strict();
export type LayoutChoice = z.infer<typeof layoutSchema>;

// ── the plan ──
const sectionEntry = z.object({ id: z.enum(DESIGN_SECTIONS), variant: z.string().min(1).max(40) }).strict();
const decisionSource = z.enum(['owner', 'recommended', 'saved', 'alternative']);

export const designPlanSchema = z.object({
  version: z.literal(DESIGN_PLAN_VERSION),
  /** the page family and the exact version this site renders with (see FAMILY_CURRENT) */
  family: z.object({ id: z.enum(FAMILIES), version: z.number().int().min(1).max(99) }).strict(),
  /** stable for this business + seed: rebuilds and reopening reuse it */
  id: z.string().regex(/^dp_[a-f0-9]{10}$/),
  businessKey: z.string().min(1).max(200),
  /** chosen at creation and on "Generate another design"; drives the minor choices */
  seed: z.string().regex(/^[a-f0-9]{8}$/),
  variation: z.number().int().min(0).max(999),
  category: z.enum(CATEGORIES),
  vertical: z.string().min(1).max(40),
  direction: z.enum(DIRECTIONS),
  goal: z.enum(GOALS),
  service: z.object({ label: z.string().min(2).max(60), id: z.string().max(60).optional(), source: z.enum(['owner', 'business', 'mentioned', 'claude', 'default']) }).strict(),
  hero: z.object({ variant: z.enum(HERO_VARIANTS) }).strict(),
  arrangement: z.enum(ARRANGEMENTS),
  density: z.enum(DENSITIES),
  sections: z.array(sectionEntry).min(3).max(DESIGN_SECTIONS.length),
  typography: z.enum(TYPE_PRESETS),
  tokens: z.object({ brand: hex, brandInk: hex, brandText: hex, surface: hex, surfaceAlt: hex, ink: hex, inkMuted: hex }).strict(),
  images: z.object({ hero: z.string().nullable(), slides: z.array(z.string()).max(6), team: z.string().nullable(), gallery: z.array(z.string()).max(12) }).strict(),
  copy: z.object({ headline: z.string().min(3).max(90), subline: z.string().max(220), source: z.enum(['claude', 'rules', 'saved']) }).strict(),
  emergency: z.boolean(),
  sources: z.object({ direction: decisionSource, goal: decisionSource, service: decisionSource }).strict(),
  preferences: preferencesSchema,
  /** dimensions the owner chose in the preview: "Generate another design" keeps them */
  locks: z.array(z.enum(LOCKABLE)).max(LOCKABLE.length),
  planner: z.enum(['rules', 'claude+rules']),
  reasons: z.array(z.string().max(200)).max(20),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type DesignPlan = z.infer<typeof designPlanSchema>;

/**
 * Older plans → the current version, on read. Version 2 plans were rendered by the direction renderer, so they are
 * pinned to family version 1 (they look exactly as before until the owner upgrades).
 */
export function migratePlan(raw: unknown): unknown {
  const v2 = migrateV1(raw) as Record<string, any>;
  if (!v2 || typeof v2 !== 'object' || v2.version !== 2) return v2;
  return { ...v2, version: 3, family: { id: familyForDirection(v2.direction), version: 1 } };
}

/** Version 1 (plumbing pilot) → version 2. */
function migrateV1(raw: unknown): unknown {
  const p = raw as Record<string, any>;
  if (!p || typeof p !== 'object' || p.version !== 1) return raw;
  const sections = (p.sections || []).map((s: any) => (s.id === 'projects' ? { id: 'gallery', variant: s.variant } : s));
  const { projects, ...images } = p.images || {};
  return {
    ...p, version: 2, seed: String(p.id || 'dp_00000000').slice(3, 11).padEnd(8, '0'), category: 'trades', vertical: p.vertical || 'plumbing',
    arrangement: 'a', density: COMPAT[p.direction as Direction]?.density || 'comfortable', sections,
    images: { hero: images.hero ?? null, slides: [], team: images.team ?? null, gallery: projects || [] }, locks: [],
  };
}

/** Structure rules every plan must follow. Empty = valid. */
export function planProblems(p: DesignPlan): string[] {
  const out: string[] = [];
  const c = COMPAT[p.direction];
  if (FAMILY_DIRECTION[p.family.id] !== p.direction) out.push(`family ${p.family.id} uses the ${FAMILY_DIRECTION[p.family.id]} direction, not ${p.direction}`);
  if (p.family.version > FAMILY_CURRENT[p.family.id]) out.push(`family ${p.family.id} has no version ${p.family.version}`);
  if (!c.heroes.includes(p.hero.variant)) out.push(`hero "${p.hero.variant}" is not used by ${p.direction}`);
  if (!c.typography.includes(p.typography)) out.push(`typography "${p.typography}" is not used by ${p.direction}`);
  if (p.sections[0]?.id !== 'hero' || p.sections[0]?.variant !== p.hero.variant) out.push('the first section must be the hero, with the plan\'s hero variant');
  if (p.sections[p.sections.length - 1]?.id !== 'footer') out.push('the last section must be the footer');
  const ids = p.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push('a section appears twice');
  if (ids.filter((i) => i === 'quote').length !== 1) out.push('the page needs exactly one request section');
  for (const s of p.sections) {
    if (s.id === 'hero') continue;
    const allowed = c.sections[s.id];
    if (!allowed) out.push(`section "${s.id}" is not part of ${p.direction}`);
    else if (!allowed.includes(s.variant)) out.push(`section "${s.id}" variant "${s.variant}" is not part of ${p.direction}`);
  }
  if ((p.hero.variant === 'photo-led' || p.hero.variant === 'split') && !p.images.hero) out.push(`a ${p.hero.variant} hero needs a hero photo`);
  if (p.hero.variant === 'carousel' && p.images.slides.length < MIN_SLIDES) out.push(`a carousel hero needs ${MIN_SLIDES} photos`);
  if (ids.includes('team') && !p.images.team) out.push('the team section needs a team photo');
  const gal = p.sections.find((s) => s.id === 'gallery');
  if (gal && p.images.gallery.length < (MIN_GALLERY_PHOTOS[gal.variant] ?? 2)) out.push(`the gallery (${gal.variant}) needs at least ${MIN_GALLERY_PHOTOS[gal.variant] ?? 2} photos`);
  if (ids.includes('urgent') && !p.emergency) out.push('emergency messaging needs verified facts or the owner\'s confirmation');
  if (ids.includes('urgent') && p.category !== 'trades') out.push('the emergency band is for trades only');
  const used = [...(p.hero.variant === 'carousel' ? p.images.slides : [p.images.hero]), p.images.team, ...p.images.gallery].filter(Boolean);
  if (p.hero.variant === 'carousel' && p.images.hero && p.images.slides[0] !== p.images.hero) out.push('the carousel starts with the hero photo');
  if (new Set(used).size !== used.length) out.push('one photo is assigned to two roles');
  return out;
}

export function validatePlan(raw: unknown): { ok: true; plan: DesignPlan } | { ok: false; errors: string[] } {
  const r = designPlanSchema.safeParse(migratePlan(raw));
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`) };
  const problems = planProblems(r.data);
  return problems.length ? { ok: false, errors: problems } : { ok: true, plan: r.data };
}

export function validatePreferences(raw: unknown): { ok: true; prefs: DesignPreferences } | { ok: false; errors: string[] } {
  const r = preferencesSchema.safeParse(raw ?? {});
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'preferences'}: ${i.message}`) };
  return { ok: true, prefs: Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined)) as DesignPreferences };
}

export function validateAppearance(raw: unknown): { ok: true; appearance: Appearance } | { ok: false; errors: string[] } {
  const r = appearanceSchema.safeParse(raw ?? {});
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `appearance.${i.path.join('.')}: ${i.message}`) };
  return { ok: true, appearance: r.data };
}
