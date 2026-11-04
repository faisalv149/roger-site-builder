import { z } from 'zod';

/**
 * The design studio's first two documents, built from one saved source snapshot:
 *
 *  SiteInventory  what Roger read: every page it found, what it did with each (read, rendered, skipped, failed, and
 *                 why), and what each page holds (headings, services, locations, offers, forms, calls to action,
 *                 links, images, videos, fonts, colours), with the relationships between them.
 *  BusinessBrief  what Roger knows about the business from that inventory and the Google listing: each fact with
 *                 where it was read and how sure Roger is, the conflicts between sources, what is unknown, and the
 *                 questions the owner must answer. Nothing is filled in: a gap is recorded as unknown.
 *
 * Both are versioned. Both are pure functions of the snapshot: building them again from the same snapshot gives the
 * same documents (see src/studio/brief.ts). A website and a Google listing produce the same two documents; what a
 * route could not see is marked unknown.
 */

export const INVENTORY_SCHEMA = 'roger.site-inventory';
export const BRIEF_SCHEMA = 'roger.business-brief';
/**
 * 2: linked PDFs (documents, offerings), conflict candidates (a conflicting fact has no chosen value), one asset
 * summary that every count is taken from.
 */
export const SCHEMA_VERSION = 2;

// ───────────────────────── shared ─────────────────────────
export const SOURCE_TYPES = ['website', 'google', 'owner', 'inference'] as const;
export const sourceRef = z.object({
  /** a page of the website, or "google:<placeId>" for the listing */
  url: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  /** where on that source: a heading, a JSON-LD field, a listing field */
  locator: z.string().optional(),
}).strict();
export type SourceRef = z.infer<typeof sourceRef>;

/**
 * A fact, with where it was read and how sure Roger is. "verified": stated by a source Roger trusts for this field;
 * "conflicting": sources disagree (see conflicts); "needs_review": read, but only weakly (a keyword, a single
 * mention); "unknown": nothing says it, value is null and a question asks the owner.
 */
export const FACT_STATUS = ['verified', 'conflicting', 'needs_review', 'unknown'] as const;
export const fact = <T extends z.ZodTypeAny>(value: T) => z.object({
  value: value.nullable(),
  status: z.enum(FACT_STATUS),
  confidence: z.number().min(0).max(1),
  sources: z.array(sourceRef),
  /** why it is unknown or needs review */
  note: z.string().optional(),
  /** the owner question that settles it */
  questionId: z.string().optional(),
  /** when sources conflict: every candidate, each with its sources. The value stays null until the owner chooses */
  candidates: z.array(z.object({ value, sources: z.array(sourceRef) }).strict()).optional(),
}).strict();
export type Fact<T> = { value: T | null; status: (typeof FACT_STATUS)[number]; confidence: number; sources: SourceRef[]; note?: string; questionId?: string; candidates?: { value: T; sources: SourceRef[] }[] };

export const addressSchema = z.object({ street: z.string(), unit: z.string().optional(), city: z.string(), state: z.string(), zip: z.string(), formatted: z.string() }).strict();

// ───────────────────────── inventory ─────────────────────────
export const PAGE_TYPES = ['home', 'services', 'service', 'about', 'projects', 'contact', 'locations', 'menu', 'reviews', 'faq', 'booking', 'blog', 'post', 'legal', 'other'] as const;
export const PAGE_STATUS = ['read', 'rendered', 'skipped', 'failed'] as const;
export const DISCOVERY = ['input', 'listing', 'nav', 'sitemap', 'link'] as const;

export const ctaSchema = z.object({
  label: z.string(),
  href: z.string(),
  kind: z.enum(['phone', 'email', 'form', 'page', 'booking', 'external', 'anchor']),
  /** "free", "discount", "financing" when the label states terms */
  terms: z.string().optional(),
  locator: z.string(),
}).strict();

export const formSchema = z.object({
  action: z.string(),
  method: z.string(),
  purpose: z.enum(['contact', 'quote', 'booking', 'newsletter', 'search', 'login', 'other']),
  submitLabel: z.string().optional(),
  fields: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean(), label: z.string().optional() }).strict()),
  /** a form a third-party script draws in the browser (the HTML holds only its container) */
  embedded: z.string().optional(),
}).strict();

export const pageRecord = z.object({
  url: z.string(),
  /** where the address ended up after redirects */
  finalUrl: z.string().optional(),
  status: z.enum(PAGE_STATUS),
  /** why it was skipped, or what failed */
  reason: z.string().optional(),
  httpStatus: z.number().int().optional(),
  attempts: z.number().int().min(0),
  discoveredVia: z.array(z.enum(DISCOVERY)),
  depth: z.number().int().min(0),
  /** pages that link here */
  linkedFrom: z.array(z.string()),
  type: z.enum(PAGE_TYPES),
  title: z.string().optional(),
  description: z.string().optional(),
  canonical: z.string().optional(),
  headings: z.array(z.object({ level: z.number().int().min(1).max(6), text: z.string() }).strict()),
  services: z.array(z.object({ name: z.string(), description: z.string().optional(), href: z.string().optional(), image: z.string().optional(), locator: z.string() }).strict()),
  locations: z.array(z.object({ address: addressSchema, locator: z.string() }).strict()),
  phones: z.array(z.string()),
  emails: z.array(z.string()),
  offers: z.array(z.object({ text: z.string(), terms: z.string(), locator: z.string() }).strict()),
  forms: z.array(formSchema),
  ctas: z.array(ctaSchema),
  internalLinks: z.array(z.string()),
  externalLinks: z.array(z.object({ url: z.string(), kind: z.enum(['social', 'booking', 'review', 'map', 'other']) }).strict()),
  /** asset ids (see assets) of the pictures this page shows */
  images: z.array(z.string()),
  videos: z.array(z.object({ provider: z.string(), url: z.string(), title: z.string().optional() }).strict()),
  fonts: z.array(z.string()),
  colors: z.array(z.object({ hex: z.string(), count: z.number() }).strict()),
  textLength: z.number().int().min(0),
  /** sha256 of the HTML Roger read (rendered HTML when the page was rendered) */
  bodyHash: z.string().optional(),
}).strict();
export type PageRecord = z.infer<typeof pageRecord>;

export const ASSET_OUTCOMES = ['usable', 'icon', 'map', 'graphic', 'undersized', 'duplicate', 'broken', 'not-probed'] as const;
/** website: the business's own site (use not yet confirmed); google: Google listing photos (preview only, attribution required) */
export const ASSET_RIGHTS = ['owner-approved', 'unconfirmed', 'google-restricted'] as const;
export const assetRecord = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(['website', 'google']),
  role: z.string(),
  alt: z.string().optional(),
  /** the pages it appears on */
  pages: z.array(z.string()),
  /** the services it is shown with (a picture on a service's own card, or on that service's own page) */
  services: z.array(z.string()),
  context: z.string().optional(),
  outcome: z.enum(ASSET_OUTCOMES),
  /**
   * how Roger looked at it: downloaded and measured; download failed; judged by its file name or by its role on the page
   * (a logo, a social badge), not downloaded; not reached (over the download budget); a listing photo (a reference only)
   */
  examined: z.enum(['downloaded', 'download-failed', 'by-file-name', 'by-role', 'over-budget', 'listing-reference']),
  reason: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  format: z.string().optional(),
  bytes: z.number().int().optional(),
  sha256: z.string().optional(),
  /** frames it is big enough for: hero, card, gallery */
  uses: z.array(z.string()),
  duplicateOf: z.string().optional(),
  rights: z.enum(ASSET_RIGHTS),
  attribution: z.array(z.string()),
}).strict();
export type AssetRecord = z.infer<typeof assetRecord>;

/** the one count of pictures every report, the brief and the UI use */
export const assetSummary = z.object({
  website: z.object({
    total: z.number().int(),
    examined: z.object({ downloaded: z.number().int(), downloadFailed: z.number().int(), byFileName: z.number().int(), byRole: z.number().int(), overBudget: z.number().int() }).strict(),
    outcomes: z.object({ usable: z.number().int(), icon: z.number().int(), map: z.number().int(), graphic: z.number().int(), undersized: z.number().int(), duplicate: z.number().int(), broken: z.number().int(), notProbed: z.number().int() }).strict(),
  }).strict(),
  google: z.object({ total: z.number().int() }).strict(),
}).strict();
export type AssetSummary = z.infer<typeof assetSummary>;

export const documentRecord = z.object({
  url: z.string(),
  kind: z.enum(['menu', 'price-list', 'services', 'brochure', 'allergen', 'other']),
  anchor: z.string().optional(),
  linkedFrom: z.array(z.string()),
  status: z.enum(['read', 'failed', 'skipped']),
  reason: z.string().optional(),
  httpStatus: z.number().int().optional(),
  attempts: z.number().int(),
  bytes: z.number().int().optional(),
  sha256: z.string().optional(),
  totalPages: z.number().int().optional(),
  pages: z.array(z.object({ page: z.number().int(), method: z.enum(['text', 'ocr', 'text+ocr', 'skipped']), chars: z.number().int(), garbled: z.number(), ocrConfidence: z.number().optional(), reason: z.string().optional() }).strict()),
  /** items read from it (names, sections, prices): only from its text layer */
  items: z.number().int(),
  layout: z.enum(['list', 'grid', 'mixed', 'none']),
}).strict();
export type DocumentRecord = z.infer<typeof documentRecord>;

export const siteInventory = z.object({
  schema: z.literal(INVENTORY_SCHEMA),
  version: z.literal(SCHEMA_VERSION),
  businessKey: z.string(),
  snapshotId: z.string(),
  capturedAt: z.string(),
  route: z.enum(['website', 'google']),
  site: z.object({
    origin: z.string().nullable(),
    home: z.string().nullable(),
    robots: z.object({ found: z.boolean(), disallow: z.array(z.string()), sitemaps: z.array(z.string()) }).strict(),
    sitemaps: z.array(z.object({ url: z.string(), status: z.enum(['read', 'failed']), urls: z.number().int(), error: z.string().optional() }).strict()),
    budget: z.object({ maxPages: z.number().int(), maxDepth: z.number().int() }).strict(),
  }).strict(),
  pages: z.array(pageRecord),
  coverage: z.object({
    discovered: z.number().int(), read: z.number().int(), rendered: z.number().int(), skipped: z.number().int(), failed: z.number().int(),
    /** some pages that should have been read were not */
    partial: z.boolean(),
    skippedReasons: z.record(z.string(), z.number().int()),
    documents: z.object({ found: z.number().int(), read: z.number().int(), failed: z.number().int(), skipped: z.number().int() }).strict(),
  }).strict(),
  /** page → page links among the pages Roger knows */
  links: z.array(z.object({ from: z.string(), to: z.string() }).strict()),
  documents: z.array(documentRecord),
  assets: z.array(assetRecord),
  assetSummary,
  fonts: z.array(z.object({ family: z.string(), source: z.enum(['google-fonts', 'stylesheet', 'rendered']), pages: z.number().int() }).strict()),
  colors: z.array(z.object({ hex: z.string(), count: z.number() }).strict()),
}).strict();
export type SiteInventory = z.infer<typeof siteInventory>;

// ───────────────────────── brief ─────────────────────────
export const conflictSchema = z.object({
  id: z.string(),
  field: z.string(),
  summary: z.string(),
  values: z.array(z.object({ value: z.string(), sources: z.array(sourceRef) }).strict()),
  /** what Roger shows until the owner decides */
  resolution: z.string(),
  questionId: z.string(),
}).strict();
export type Conflict = z.infer<typeof conflictSchema>;

export const questionSchema = z.object({
  id: z.string(),
  topic: z.enum(['identity', 'services', 'locations', 'contact', 'hours', 'brand', 'story', 'photos', 'offers', 'claims', 'service-area']),
  question: z.string(),
  why: z.string(),
  /** choices when the answer is one of a few (the conflicting values) */
  options: z.array(z.string()).optional(),
  blocking: z.boolean(),
}).strict();
export type OwnerQuestion = z.infer<typeof questionSchema>;

export const serviceItem = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  status: z.enum(['verified', 'needs_review']),
  /** where the business shows it: home-card, menu, service-page */
  evidence: z.array(z.object({ kind: z.string(), url: z.string(), locator: z.string().optional() }).strict()),
  description: fact(z.string()).optional(),
  page: z.string().optional(),
  group: z.string().optional(),
  assets: z.array(z.string()),
}).strict();

export const locationItem = z.object({
  id: z.string(),
  address: addressSchema,
  sources: z.array(sourceRef),
  /** the location the Google listing describes */
  listing: z.boolean(),
}).strict();

export const businessBrief = z.object({
  schema: z.literal(BRIEF_SCHEMA),
  version: z.literal(SCHEMA_VERSION),
  businessKey: z.string(),
  /** increases when the brief's content changes; the same snapshot keeps the same revision */
  revision: z.number().int().min(1),
  snapshotId: z.string(),
  capturedAt: z.string(),
  route: z.enum(['website', 'google']),
  /** sha256 of the brief's content (everything except revision, snapshot id, capture time, the hash and the AI summary) */
  briefHash: z.string(),
  identity: z.object({
    status: z.enum(['verified', 'probable', 'unverified', 'website-only']),
    evidence: z.array(z.string()),
    name: fact(z.string()),
    alternateNames: z.array(z.string()),
    category: fact(z.string()),
    website: fact(z.string()),
    listing: z.object({ placeId: z.string(), mapsUrl: z.string().optional(), businessStatus: z.string().optional() }).strict().nullable(),
  }).strict(),
  contact: z.object({
    phone: fact(z.string()),
    otherPhones: z.array(fact(z.string())),
    email: fact(z.string()),
    address: fact(addressSchema),
  }).strict(),
  locations: z.object({
    status: z.enum(['single', 'multiple', 'unknown']),
    items: z.array(locationItem),
    /** the location the site presents as the business's own; null while sources conflict on it (see conflicts) */
    primaryId: z.string().nullable(),
  }).strict(),
  serviceArea: fact(z.object({ region: z.string().optional(), places: z.array(z.string()) }).strict()),
  hours: z.object({ listing: fact(z.array(z.string())), website: fact(z.array(z.string())) }).strict(),
  availability: z.object({
    /** emergency or after-hours service, only when the business says so */
    emergency: fact(z.string()),
    /** opening hours on a listing say nothing about phone answering or dispatch */
    note: z.string(),
  }).strict(),
  services: z.object({
    status: z.enum(['known', 'unknown']),
    items: z.array(serviceItem),
    /** names that appear on the site but are not shown as services until the owner confirms */
    proposals: z.array(z.object({ name: z.string(), why: z.string(), evidence: z.array(z.object({ kind: z.string(), url: z.string(), locator: z.string().optional() }).strict()) }).strict()),
  }).strict(),
  offers: z.array(z.object({ id: z.string(), label: z.string(), terms: z.string().optional(), destination: z.string(), sources: z.array(sourceRef), services: z.array(z.string()) }).strict()),
  callsToAction: z.object({
    primary: ctaSchema.nullable(),
    secondary: ctaSchema.nullable(),
    booking: z.string().nullable(),
    /** actions not used publicly until a conflict is settled (a call button while the phone number is disputed) */
    held: z.array(z.object({ label: z.string(), href: z.string(), reason: z.string(), questionId: z.string() }).strict()),
  }).strict(),
  /** what the business sells, read from its menus and price lists (linked PDFs): text-layer items only, each with its page */
  offerings: z.object({
    status: z.enum(['known', 'unknown']),
    documents: z.array(z.object({ url: z.string(), kind: z.string(), method: z.string(), items: z.number().int() }).strict()),
    items: z.array(z.object({
      id: z.string(),
      name: z.string(),
      section: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()),
      price: z.object({ text: z.string(), status: z.enum(['verified', 'needs_review']), how: z.string(), source: sourceRef }).strict().optional(),
      sources: z.array(sourceRef),
    }).strict()),
  }).strict(),
  claims: z.array(fact(z.string())),
  testimonials: z.array(z.object({ author: z.string(), text: z.string(), source: sourceRef }).strict()),
  reviews: fact(z.object({ rating: z.number(), count: z.number(), restrictions: z.string() }).strict()),
  story: fact(z.object({ heading: z.string(), text: z.string() }).strict()),
  brand: z.object({
    status: z.enum(['measured', 'stylesheet-only', 'unknown']),
    confidence: z.enum(['high', 'medium', 'low', 'none']),
    colors: z.array(z.object({ role: z.string(), hex: z.string(), confidence: z.string(), evidence: z.string() }).strict()),
    fonts: z.array(z.object({ role: z.string(), family: z.string(), source: z.string() }).strict()),
    headingCase: z.string().nullable(),
    logo: fact(z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional(), colors: z.array(z.string()) }).strict()),
  }).strict(),
  assets: z.object({
    /** taken from the inventory's asset summary (the one count) */
    website: z.object({ usable: z.number().int(), total: z.number().int(), ids: z.array(z.string()) }).strict(),
    google: z.object({ count: z.number().int(), ids: z.array(z.string()), restriction: z.string() }).strict(),
  }).strict(),
  conflicts: z.array(conflictSchema),
  unknowns: z.array(z.object({ field: z.string(), why: z.string(), questionId: z.string() }).strict()),
  ownerQuestions: z.array(questionSchema),
  /** an AI summary of the evidence, cached per snapshot; it never changes the facts or the services above */
  summary: z.object({
    status: z.enum(['written', 'unavailable', 'rejected']),
    text: z.string().nullable(),
    reason: z.string().optional(),
    model: z.string().optional(),
    inputHash: z.string(),
  }).strict(),
}).strict();
export type BusinessBrief = z.infer<typeof businessBrief>;
