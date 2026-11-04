import { z } from 'zod';

/**
 * Design studio, phase 2: three homepage concepts from a pinned, reviewed brief.
 *
 * A concept is data: an ordered list of sections from the shared library (each a kind and a variant), the facts each
 * section shows (by id, from the resolved fact catalog), design tokens, copy and actions. One renderer turns any
 * concept into HTML; nothing is written for one business. See docs/studio-phase2.md.
 */

export const SECTION_KINDS = ['hero', 'offer', 'proof', 'gallery', 'story', 'contact'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** the shared library: every variant of every section kind */
export const VARIANTS = {
  hero: ['full-bleed', 'split', 'type-collage'],
  offer: ['cards', 'board', 'rows'],
  proof: ['rating-band', 'pledges', 'stat-strip'],
  gallery: ['mosaic', 'filmstrip', 'feature-grid'],
  story: ['columns', 'portrait'],
  contact: ['panel', 'locations', 'band'],
} as const satisfies Record<SectionKind, readonly string[]>;
export type Variant<K extends SectionKind = SectionKind> = (typeof VARIANTS)[K][number];

export const STRUCTURES = ['offer-first', 'story-first', 'proof-first', 'visit-first', 'gallery-first'] as const;
export const TYPE_VOICES = ['grotesk', 'humanist', 'serif', 'slab', 'display'] as const;
export const COLOR_STRATEGIES = ['brand-dominant', 'brand-accent', 'neutral-with-brand-action'] as const;
export const DENSITIES = ['airy', 'balanced', 'dense'] as const;
export const IMAGERY = ['lead', 'supporting', 'minimal'] as const;

export const directionAxes = z.object({
  structure: z.enum(STRUCTURES),
  heroComposition: z.enum(VARIANTS.hero),
  density: z.enum(DENSITIES),
  imageryRole: z.enum(IMAGERY),
  typeVoice: z.enum(TYPE_VOICES),
  colorStrategy: z.enum(COLOR_STRATEGIES),
}).strict();
export type DirectionAxes = z.infer<typeof directionAxes>;

// ───────────────────────── owner review ─────────────────────────
export const briefRef = z.object({ businessKey: z.string(), revision: z.number().int(), briefHash: z.string() }).strict();
export type BriefRef = z.infer<typeof briefRef>;

export const ownerReview = z.object({
  schema: z.literal('roger.owner-review'),
  version: z.literal(1),
  /** sha256 of the content (without the id) */
  id: z.string(),
  brief: briefRef,
  reviewedBy: z.string(),
  reviewedAt: z.string(),
  answers: z.record(z.string(), z.object({ choice: z.string().optional(), text: z.string().optional() }).strict()),
  /** website asset ids the owner may publish ("logo" for the logo) */
  approvedAssets: z.array(z.string()),
  /** claim texts the owner confirmed */
  approvedClaims: z.array(z.string()),
  offerings: z.object({ current: z.boolean(), pricesApproved: z.boolean() }).strict().optional(),
  /**
   * pictures the owner ties to a service or a menu section ("section:Drinks"): an asset id, or null for "no picture".
   * Without one, a service shows only the picture the website itself puts on its card or page; a menu section shows none.
   */
  serviceImages: z.record(z.string(), z.string().nullable()).optional(),
  /** the concept the owner chose to take forward */
  selectedConcept: z.object({ setId: z.string(), conceptId: z.enum(['a', 'b', 'c']) }).strict().optional(),
  notes: z.string().optional(),
}).strict();
export type OwnerReview = z.infer<typeof ownerReview>;

// ───────────────────────── the AI's plan for one direction ─────────────────────────
export interface DirectionPlan {
  name: string;
  thesis: string;
  /** fact ids the direction leans on */
  evidence: string[];
  axes: Omit<DirectionAxes, 'heroComposition'>;
  /** in page order; the hero first */
  sections: { kind: SectionKind; variant: string }[];
  hero: { eyebrow: string; headline: string; subline: string; imageIds: string[] };
  titles: { kind: SectionKind; title: string; intro: string }[];
  primaryAction: string | null;
  secondaryAction: string | null;
  /** services or menu items to show first */
  featureIds: string[];
  galleryImageIds: string[];
  storyImageId: string | null;
  /** a shortened version of the business's story, in its own facts */
  storyText: string | null;
}

// ───────────────────────── a composed concept ─────────────────────────
export interface CopyBlock { slot: string; origin: 'bound' | 'paraphrase' | 'generated' | 'default'; text: string; refs: string[] }
export interface ComposedSection { kind: SectionKind; variant: string; id: string; title: string; intro: string; factIds: string[]; imageIds: string[]; note?: string }
export interface ConceptAction { slot: 'primary' | 'secondary'; actionId: string; label: string; href: string; factId: string }
export interface Check { id: string; level: 'pass' | 'fail' | 'review'; message: string; details?: string[] }

export interface DesignTokens {
  colors: Record<'bg' | 'surface' | 'ink' | 'muted' | 'line' | 'brand' | 'onBrand' | 'brandText' | 'accent' | 'onAccent' | 'action' | 'onAction' | 'deep' | 'onDeep', string>;
  fonts: { heading: { family: string; weight: number; css: string }; body: { family: string; css: string }; href: string };
  radius: number;
  /** a multiplier on section spacing */
  space: number;
  headingCase: 'none' | 'uppercase';
  origin: { colors: string; fonts: string };
}

export interface Concept {
  id: 'a' | 'b' | 'c';
  name: string;
  thesis: string;
  evidence: string[];
  axes: DirectionAxes;
  planSource: 'ai' | 'fallback';
  tokens: DesignTokens;
  sections: ComposedSection[];
  copy: CopyBlock[];
  actions: ConceptAction[];
  /** asset ids shown on the page */
  images: string[];
  /** facts the preview leaves out, and why */
  omitted: { what: string; reason: string; questionId?: string }[];
  /** where a shared rule changed what the plan asked for ("Directions to one location" became "Find a location") */
  notes?: string[];
  preview?: { html: string; desktop: string; mobile: string; desktopHero: string; mobileHero: string; desktopHeight: number; mobileHeight: number };
  checks: Check[];
}

export interface UsageRecord {
  setId: string; stage: string; attempt: number; via: 'api' | 'cli' | 'fake'; model: string; cacheHit: boolean;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  costUsd: number; costBasis: 'reported' | 'computed' | 'cached'; worstCaseUsd: number; ms: number; ok: boolean; error?: string; at: string;
}

export interface PublicationGate { publishable: boolean; blockers: { kind: string; what: string; questionId?: string }[] }

export interface ConceptSet {
  schema: 'roger.concept-set';
  version: 1;
  id: string;
  brief: BriefRef;
  reviewId: string;
  mode: 'preview';
  model: string;
  promptVersion: string;
  createdAt: string;
  concepts: Concept[];
  distinctness: { pairs: { a: string; b: string; plan: string[]; heroDesktop: number; heroMobile: number; page: number; pass: boolean }[]; thresholds: Record<string, number> };
  checks: Check[];
  cost: { capUsd: number; spentUsd: number; calls: UsageRecord[] };
  gate: PublicationGate;
  /** sha256 of what the set says (concepts, plans, tokens), not of when it ran or what it cost */
  setHash: string;
}
