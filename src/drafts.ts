import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { configuredChannels, ownerEmailOf } from './lead-delivery.js';
import type { Business, Facts, ServiceItem, WebsiteScan } from './types.js';
import type { Theme } from './theme/schema.js';
import type { SiteImage } from './brand/photos.js';
import type { LogoPick } from './brand/logo.js';
import { cloneTheme } from './theme/load.js';
import { resolveBrand, brandTextOnSurface } from './brand/brand.js';
import { buildModel, type SiteModel, type SourceBundle } from './content/model.js';
import { brandCss } from './sources/brand-profile.js';
import { leadOf } from './design/compose.js';
import { renderPage } from './render/page.js';
import { isFamilyV2, renderFamilyPage } from './render/families.js';
import { previewContext, renderSiteFiles, sitePlanFor, writeSiteFiles } from './site-render.js';
import { pageOverrideSchema, validateSitePlan, type SitePlan } from './design/siteplan.js';
import { pageSeo } from './seo.js';
import { applyContent, CLAIM_KEYS, factLabel, factState, publishReadiness, type SiteContent, upgradeContent } from './design/content.js';
import { applyMediaRoles, mediaExcluded } from './design/media.js';
import { listOut, persistDir, readOut } from './files.js';
import { draftDocs } from './store.js';
import { applyDirectionTokens, TYPE_PRESET_DEFS } from './design/directions.js';
import { composeTheme, designFonts, finishModel } from './design/compose.js';
import { PlanChoiceError, layoutOptions, planDesign, type DesignAdvice, type Evidence } from './design/planner.js';
import { FAMILY_CURRENT, FAMILY_LABEL, COLOR_PRESETS, DIRECTION_LABEL, GRADIENT_PRESETS, HERO_LABEL, TYPE_PRESETS, validateAppearance, validatePlan, layoutSchema, type Appearance, type DesignPlan, type Direction, type LayoutChoice, type TypePreset } from './design/schema.js';
import { CURRENCIES, PRICE_KINDS, PRICE_UNITS, validateOfferings, type Offering } from './design/offerings.js';
import { profileFor, type Category } from './design/categories.js';
import { resolveAppearance, appearanceCss } from './design/appearance.js';
import type { PhotoInfo, PhotoMeta } from './design/photos.js';

/**
 * Drafts: a generated site the owner can preview, customise, save and buy. The draft keeps everything the page is
 * composed from (the business data Roger already fetched, the analysed photos, the theme), so colour, font, layout
 * and price changes re-render here without new Google Places or Claude requests. Saved under drafts/<id> in the
 * same document store as builds (local JSON or Supabase/Redis).
 *
 * The owner reaches a draft with a capability link (/owner/?d=<id>#k=<key>): a random key whose hash is stored
 * here, scoped to this draft's editing and demo-order operations, revocable from the Studio. The Studio password
 * is separate and still protects everything else.
 */
export const DRAFT_VERSION = 1;

export interface DraftBase {
  /** when a test enquiry last reached the lead inbox (and webhook): publishing needs one */
  leadTestedAt?: string;
  /** how that test enquiry was passed on: one entry per channel, with the receiver's answer */
  leadDelivery?: { channel: string; status: string; at: string; detail?: string }[];
  slug: string;
  themeId: string;
  themeName: string;
  /** the selected theme before any direction was applied */
  theme: Theme;
  business: Business;
  facts: Facts;
  category: Category;
  logo?: LogoPick;
  /** what brand colour resolution reads from the website scan */
  scanBrand?: Pick<WebsiteScan, 'ok' | 'themeColor' | 'cssColors'>;
  brandOverride?: string;
  services: { items: ServiceItem[]; matched: number; overflow: boolean; hidden: boolean; source: 'business' | 'theme' };
  hero?: SiteImage;
  heroIsStock: boolean;
  gallery: SiteImage[];
  socials: { network: string; url: string }[];
  email?: string;
  preview: boolean;
  photos: PhotoMeta[];
  evidence: Evidence;
  advice?: DesignAdvice;
  currency: string;
  /** from the business's own website: booking page, story, videos, and how well they were read */
  source?: SourceBundle;
  /** the business's brand as its website shows it: colour roles, button style, typefaces (src/sources/brand-profile.ts) */
  brandProfile?: import('./sources/brand-profile.js').BrandProfile;
}

export interface DraftRecord {
  /** the Phase 2 concept this draft's design comes from: "Try another design" switches among its set's concepts */
  concept?: { setId: string; conceptId: string };
  v: number;
  id: string;
  slug: string;
  businessKey: string;
  businessName: string;
  category: Category;
  base: DraftBase;
  /** the saved design: what the shared preview shows and what a demo purchase freezes */
  plan: DesignPlan;
  appearance: Appearance;
  offerings: Offering[];
  revision: number;
  savedAt: string;
  createdAt: string;
  updatedAt: string;
  /** recent saved plans, newest first ("Generate another design" differs from these) */
  history: DesignPlan[];
  /** generated but not yet saved, newest first */
  candidates: DesignPlan[];
  owner?: { keyHash: string; createdAt: string; revokedAt?: string; lastUsedAt?: string };
  /** the site's pages (single or multi-page), routes and the owner's page metadata (src/design/siteplan.ts) */
  sitePlan?: SitePlan;
  /** business facts with provenance and owner review, and the media library (src/design/content.ts) */
  content?: SiteContent;
  /** scores per revision, newest first (src/rescore.ts) */
  scores?: import('./rescore.js').ScoreRecord[];
  buildId?: string;
}

/** Old or partial records: fill what later versions added, validate what the page depends on. */
export function upgradeDraft(raw: unknown): DraftRecord | undefined {
  const d = raw as DraftRecord;
  if (!d || typeof d !== 'object' || !d.id || !d.base) return undefined;
  const plan = validatePlan(d.plan);
  if (!plan.ok) return undefined;
  const ap = validateAppearance(d.appearance ?? {});
  const of = validateOfferings(d.offerings ?? []);
  return {
    ...d, v: DRAFT_VERSION, plan: plan.plan, appearance: ap.ok ? ap.appearance : {}, offerings: of.ok ? of.offerings : [],
    history: (d.history || []).map((p) => validatePlan(p)).filter((r) => r.ok).map((r) => (r as { plan: DesignPlan }).plan),
    candidates: (d.candidates || []).map((p) => validatePlan(p)).filter((r) => r.ok).map((r) => (r as { plan: DesignPlan }).plan),
    revision: Number.isInteger(d.revision) ? d.revision : 1,
    sitePlan: d.sitePlan ? (validateSitePlan(d.sitePlan) as { ok: boolean; plan?: SitePlan }).plan : undefined,
    content: d.content ? upgradeContent(d.content) : undefined,
  };
}

export const getDraft = async (id: string) => upgradeDraft(await draftDocs.get('drafts', id));
export const putDraft = (d: DraftRecord) => draftDocs.put('drafts', d.id, d);
export async function findDraft(q: { slug?: string; businessKey?: string }): Promise<DraftRecord | undefined> {
  const all = (await draftDocs.list<DraftRecord>('drafts')).filter((d) => (q.slug ? d.slug === q.slug : true) && (q.businessKey ? d.businessKey === q.businessKey : true));
  all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return all[0] ? upgradeDraft(all[0]) : undefined;
}

// ── one change at a time per draft (saves, generation, orders) ──
const locks = new Map<string, Promise<unknown>>();
export function withDraftLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  // the chain itself never rejects (callers get the error from `next`), so a failed change can't crash the server
  const tail = next.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return next;
}

// ── owner capability ──
const hashKey = (k: string) => createHash('sha256').update(`roger-owner|${k}`).digest('hex');
export function issueOwnerKey(d: DraftRecord): string {
  const key = `rk_${randomBytes(24).toString('base64url')}`;
  d.owner = { keyHash: hashKey(key), createdAt: new Date().toISOString() };
  return key;
}
export function verifyOwnerKey(d: DraftRecord, key: string | undefined): boolean {
  if (!key || !d.owner || d.owner.revokedAt || !/^rk_[A-Za-z0-9_-]{20,64}$/.test(key)) return false;
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(d.owner.keyHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const ownerUrl = (d: DraftRecord, key: string) => `${config.publicBaseUrl}/owner/?d=${encodeURIComponent(d.id)}#k=${encodeURIComponent(key)}`;
export const newDraftId = () => `drf_${randomBytes(6).toString('hex')}`;

// ── composing from the stored data ──
const siteDirOf = (slug: string) => path.join(config.dirs.sites, slug);

/** On a fresh server instance the site's files live only in the remote store: bring them back before re-rendering. */
export async function ensureLocalSite(slug: string): Promise<void> {
  const dir = siteDirOf(slug);
  if (fs.existsSync(path.join(dir, 'index.html'))) return;
  for (const f of await listOut(`sites/${slug}`)) {
    const abs = path.join(dir, f.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
  }
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
}

/** Brand tokens for a direction: the brand colour resolved against that direction's surfaces. */
export function tokensFor(base: Pick<DraftBase, 'theme' | 'logo' | 'scanBrand' | 'brandOverride'>) {
  return (d: Direction, ty: TypePreset): DesignPlan['tokens'] => {
    const tc = cloneTheme(base.theme);
    applyDirectionTokens(tc, d, ty);
    const br = resolveBrand(tc, { logo: base.logo, scan: base.scanBrand as WebsiteScan | undefined, override: base.brandOverride });
    return { brand: br.brand, brandInk: br.brandInk, brandText: brandTextOnSurface(br, tc), surface: tc.palette.surface, surfaceAlt: tc.palette.surfaceAlt, ink: tc.palette.ink, inkMuted: tc.palette.inkMuted };
  };
}

/**
 * The page model for a plan + the owner's appearance and offerings, from stored data only. photos: the build
 * passes the analysed photos with their originals; re-renders read the stored images for any new crop.
 */
export async function composeModel(base: DraftBase, plan0: DesignPlan, opts: { appearance?: Appearance; offerings: Offering[]; photos?: (PhotoInfo | PhotoMeta)[]; content?: SiteContent; publishing?: boolean }): Promise<SiteModel> {
  const siteDir = siteDirOf(base.slug);
  // the owner's reviewed facts and photo choices; a publication leaves out what may not be published
  const { business, facts } = applyContent(base.business, base.facts, opts.content);
  const plan = applyMediaRoles(plan0, opts.content, mediaExcluded(opts.content, !!opts.publishing));
  const assetDir = path.join(siteDir, 'assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const theme = cloneTheme(base.theme);
  applyDirectionTokens(theme, plan.direction, plan.typography, plan.density);
  composeTheme(theme, plan, base.business);
  const brand = resolveBrand(theme, { logo: base.logo, scan: base.scanBrand as WebsiteScan | undefined, override: base.brandOverride });
  brand.fonts = { heading: TYPE_PRESET_DEFS[plan.typography].label, from: 'theme' };
  const model = buildModel({
    slug: base.slug, themeId: base.themeId, theme, business, facts, brand, brandText: brandTextOnSurface(brand, theme),
    services: base.services, hero: base.hero, gallery: base.gallery, fonts: designFonts(plan.typography), socials: base.socials,
    email: base.email, baseUrl: config.publicBaseUrl, preview: base.preview,
  });
  if (base.heroIsStock) model.images.heroIsStock = true;
  if (base.source) {
    const s = base.source;
    model.source = { website: s.website, booking: s.booking, story: s.story, videos: s.videos, cta: s.cta, galleryTitle: s.galleryTitle, region: s.region, claims: s.claims, testimonials: s.testimonials };
    // claims in the business's own words replace the generic trust chips
    if (s.claims?.length) model.trust = [...new Set(s.claims.filter((c) => ['warranty', 'guarantee', 'licensed', 'insured', 'ownership', 'experience'].includes(c.key)).map((c) => c.text))].slice(0, 4);
    // testimonials the business shows itself, with their authors and whole sentences
    if (s.testimonials && s.testimonials.length >= 2) {
      const host = (() => { try { return new URL(s.website || '').hostname.replace(/^www\./, ''); } catch { return 'its website'; } })();
      model.proof = { ...model.proof, quotes: s.testimonials.slice(0, 3).map((t) => ({ text: leadOf(t.text, 340), author: t.author, rating: 0, from: `Review on ${host}` })), reviews: [] };
    }
  }
  if (opts.publishing) {
    // Google's review text and rating stay with Google: a published page links to them instead
    // (the business's own testimonials stay: they are first-party)
    model.proof = { ...model.proof, quotes: model.source?.testimonials && model.source.testimonials.length >= 2 ? model.proof.quotes : [], reviews: [], showRating: false, stats: model.proof.stats.filter((s) => !/★|review/i.test(`${s.value} ${s.label}`)) };
    model.preview = false;
  }
  const raw = async (p: PhotoMeta) => {
    const local = path.join(siteDir, p.image.publicPath);
    if (fs.existsSync(local)) return fs.readFileSync(local);
    return readOut(`sites/${base.slug}/${p.image.publicPath}`);
  };
  model.design = await finishModel(model, plan, {
    facts, outDir: assetDir, publicPrefix: 'assets', maxKb: theme.images.maxFileKb, photos: opts.photos ?? base.photos, raw,
    offerings: opts.offerings, appearance: opts.appearance,
    media: new Map((opts.content?.media ?? []).map((m) => [m.key, { focal: m.focal, alt: m.alt }])),
    reviewsLink: opts.publishing && base.business.mapsUrl && (base.business.reviewCount ?? 0) > 0 ? base.business.mapsUrl : undefined,
  });
  // the business's own brand: its colours in their roles and its typeface (or one named substitute), unless the owner chose their own
  if (base.brandProfile && base.brandProfile.method !== 'none') {
    const bc = brandCss(base.brandProfile, { logoColors: base.brandProfile.logo?.colors });
    if (bc.css) {
      model.design.brandCss = bc.css;
      model.design.brandNotes = bc.notes;
      model.brand = { ...model.brand, brand: bc.tokens['--brand'], brandInk: bc.tokens['--brand-ink'] };
      if (bc.fonts && !opts.appearance?.font) model.fonts = { heading: bc.fonts.heading, body: bc.fonts.body, faces: [{ family: 'Brand', url: bc.fonts.url }] };
    }
  }
  // a typography-led hero shows no photo, so the stock placeholder warning doesn't apply
  if (plan.hero.variant === 'type-led') model.warnings = model.warnings.filter((w) => !w.startsWith('No usable Google photo for the hero'));
  return model;
}

/** Write the composed page as the draft's site (the shared, read-only preview) and keep the remote copy in sync. */
export async function writeSite(base: DraftBase, model: SiteModel, opts: { persist?: boolean; sitePlan?: SitePlan; previousSitePlan?: SitePlan } = {}): Promise<string> {
  const dir = siteDirOf(base.slug);
  const files = renderSiteFiles(model, opts.sitePlan, previewContext(base.slug, model.theme.locale.split('-')[0]));
  const prevOg = path.join(dir, 'preview.jpg');
  // the rich card image stays the saved preview screenshot when there is one
  if (fs.existsSync(prevOg) && model.preview) for (const f of files) if (f.file.endsWith('.html')) f.content = f.content.split(`content="${model.urls.og}"`).join(`content="${model.urls.site}preview.jpg"`).split(`content="${previewContext(base.slug).base}/og.jpg"`).join(`content="${model.urls.site}preview.jpg"`);
  writeSiteFiles(dir, files, opts.previousSitePlan);
  const out = files.find((f) => f.file === 'index.html')!.content;
  const { theme: _t, ...dump } = model;
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ ...dump, themeName: base.themeName }, null, 2));
  if (opts.persist !== false) await persistDir(dir);
  return out;
}

/** The plan for a change: a generated candidate, a layout choice (validated against the content), or the saved one. */
export function resolvePlan(d: DraftRecord, change: { planId?: string; layout?: unknown }): DesignPlan {
  let plan = d.plan;
  if (change.planId && change.planId !== d.plan.id) {
    const c = d.candidates.find((p) => p.id === change.planId) || d.history.find((p) => p.id === change.planId);
    if (!c) throw new DraftError(400, 'That design is no longer available. Generate another design.');
    plan = c;
  }
  if (change.layout && Object.keys(change.layout as object).length) {
    const l = layoutSchema.safeParse(change.layout);
    if (!l.success) throw new DraftError(400, `Invalid layout: ${l.error.issues[0]?.message}`);
    plan = planFor(d, { previous: plan, layout: l.data });
  }
  return plan;
}

function planFor(d: DraftRecord, o: { previous: DesignPlan; layout?: LayoutChoice; alternative?: boolean; offerings?: Offering[] }): DesignPlan {
  const b = d.base;
  try {
    return planDesign({
      businessKey: d.businessKey, business: b.business, facts: b.facts, category: d.category, services: b.services.items, servicesSource: b.services.source,
      offerings: o.offerings ?? d.offerings, photos: b.photos, evidence: b.evidence, previous: o.previous, layout: o.layout, alternative: o.alternative,
      recent: d.history, advice: b.advice, tokens: tokensFor(b),
    }).plan;
  } catch (e) {
    if (e instanceof PlanChoiceError) throw new DraftError(400, e.message);
    throw e;
  }
}

export class DraftError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

/** Validated owner edits (appearance, offerings). Unknown fields, bad colours and impossible prices are rejected. */
export function readEdits(body: Record<string, unknown>, d: DraftRecord): { appearance: Appearance; offerings: Offering[] } {
  const ap = validateAppearance(body.appearance ?? d.appearance);
  if (!ap.ok) throw new DraftError(400, ap.errors[0], { errors: ap.errors });
  const of = validateOfferings(body.offerings ?? d.offerings);
  if (!of.ok) throw new DraftError(400, of.errors[0], { errors: of.errors });
  return { appearance: ap.appearance, offerings: of.offerings };
}

/** Rewrite the page's relative asset paths so it renders inside the editor (an iframe srcdoc, no navigation). */
/**
 * The page inside the editor's frame (an iframe srcdoc): a <base> at the page's real address makes its assets
 * and links resolve; the editor handles link clicks itself (anchors scroll, other pages render in place).
 */
export function forEditor(html: string, slug: string, route = ''): string {
  // asset paths are also made absolute: the browser can start fetching images before it has read the <base>
  const abs = html.replace(/(["'(])(?:\.\.\/)*assets\//g, `$1/sites/${slug}/assets/`);
  return abs.replace(/<head>/i, `<head><base href="/sites/${slug}/${route}">`);
}

/** The pages for a model and the owner's choices, from what the content supports. */
function sitePlanOf(d: DraftRecord, model: SiteModel, body: Record<string, unknown>): SitePlan | undefined {
  if (!isFamilyV2(model)) return undefined;
  const mode = body.siteMode === 'single' || body.siteMode === 'multi' ? body.siteMode : undefined;
  const sp = sitePlanFor(model, { previous: d.sitePlan, mode });
  const seo = body.seo as Record<string, unknown> | undefined;
  if (seo && typeof seo === 'object') {
    for (const [pageId, v] of Object.entries(seo)) {
      if (!sp.pages.some((p) => p.id === pageId)) continue;
      const r = pageOverrideSchema.safeParse(v);
      if (!r.success) throw new DraftError(400, `SEO for ${pageId}: ${r.error.issues[0]?.message}`);
      const clean = Object.fromEntries(Object.entries(r.data).filter(([, x]) => x));
      if (Object.keys(clean).length) sp.overrides[pageId] = clean; else delete sp.overrides[pageId];
    }
  }
  return sp;
}

/** One page of the working state, as the editor shows it. */
function editorPage(d: DraftRecord, model: SiteModel, sp: SitePlan | undefined, route: string): { html: string; route: string } {
  if (!sp) return { html: forEditor(renderPage(model), d.slug), route: '' };
  const page = sp.pages.find((p) => p.route === route) ?? sp.pages[0];
  const html = renderFamilyPage(model, sp, page, pageSeo(model, sp, page, previewContext(d.slug)));
  return { html: forEditor(html, d.slug, page.route), route: page.route };
}

/** Render a working (unsaved) state for the editor. Nothing is written except crops it needs. */
export async function renderWorking(d: DraftRecord, body: Record<string, unknown>): Promise<{ html: string; plan: DesignPlan; appearance: Appearance; offerings: Offering[]; sitePlan?: SitePlan; route: string; model: SiteModel }> {
  const { appearance, offerings } = readEdits(body, d);
  const plan = resolvePlan(d, { planId: body.planId as string | undefined, layout: body.layout });
  await ensureLocalSite(d.slug);
  const model = await composeModel(d.base, plan, { appearance, offerings, content: d.content });
  const sp = sitePlanOf(d, model, body);
  const pg = editorPage(d, model, sp, typeof body.page === 'string' ? body.page : '');
  return { html: pg.html, route: pg.route, plan, appearance, offerings, sitePlan: sp, model };
}

/** "Generate another design": a new seeded plan that keeps locked choices, the owner's answers and all content. */
export async function generateAnother(d: DraftRecord, body: Record<string, unknown>) {
  const { appearance, offerings } = readEdits(body, d);
  // unsaved layout choices count as the owner's choices: the new design keeps them
  const current = resolvePlan(d, { planId: body.planId as string | undefined, layout: body.layout });
  const plan = planFor(d, { previous: current, alternative: true, offerings });
  d.candidates = [plan, ...d.candidates.filter((p) => p.id !== plan.id)].slice(0, 6);
  d.updatedAt = new Date().toISOString();
  await putDraft(d);
  await ensureLocalSite(d.slug);
  const model = await composeModel(d.base, plan, { appearance, offerings, content: d.content });
  const pg = editorPage(d, model, sitePlanOf(d, model, body), '');
  return { html: pg.html, plan };
}

/** Save: the stale-revision guard, then the page is re-rendered and becomes the shared preview. */
export async function saveDraft(d: DraftRecord, body: Record<string, unknown>) {
  const rev = Number(body.revision);
  if (!Number.isInteger(rev)) throw new DraftError(400, 'revision is required');
  if (rev !== d.revision) throw new DraftError(409, 'This design was changed somewhere else. Reload to see the latest version; your changes are kept here until you do.', { revision: d.revision });
  const { appearance, offerings } = readEdits(body, d);
  const plan = resolvePlan(d, { planId: body.planId as string | undefined, layout: body.layout });
  await ensureLocalSite(d.slug);
  const model = await composeModel(d.base, plan, { appearance, offerings, content: d.content });
  const sp = sitePlanOf(d, model, body);
  await writeSite(d.base, model, { sitePlan: sp, previousSitePlan: d.sitePlan });
  // a site made from a concept: its homepage stays the concept (src/studio/concepts/site.ts)
  if (d.concept) await (await import("./studio/concepts/site.js")).writeConceptHome({ ...d, sitePlan: sp, appearance, offerings });
  d.sitePlan = sp;
  const now = new Date().toISOString();
  if (plan.id !== d.plan.id) d.history = [d.plan, ...d.history.filter((p) => p.id !== d.plan.id && p.id !== plan.id)].slice(0, 5);
  d.plan = plan;
  d.appearance = appearance;
  d.offerings = offerings;
  d.candidates = d.candidates.filter((p) => p.id !== plan.id);
  d.revision += 1;
  d.savedAt = now;
  d.updatedAt = now;
  await putDraft(d);
  return d;
}

/**
 * Re-render the saved design after a content change (facts, media): the shared preview shows the owner's
 * reviewed details at once; the design itself is unchanged, so its revision stays the same.
 */
export async function refreshSavedSite(d: DraftRecord): Promise<void> {
  await ensureLocalSite(d.slug);
  const model = await composeModel(d.base, d.plan, { appearance: d.appearance, offerings: d.offerings, content: d.content });
  const sp = isFamilyV2(model) ? sitePlanFor(model, { previous: d.sitePlan }) : undefined;
  await writeSite(d.base, model, { sitePlan: sp, previousSitePlan: d.sitePlan });
  if (d.concept) await (await import("./studio/concepts/site.js")).writeConceptHome({ ...d, sitePlan: sp });
  d.sitePlan = sp;
}

/** The owner's view of the business details: values, where they came from, and their review state. */
export function contentView(d: DraftRecord) {
  const c = d.content;
  if (!c) return null;
  const facts = Object.entries(c.facts).filter(([, f]) => f).map(([key, f]) => ({
    key, label: factLabel(key), value: (f as any).value, source: (f as any).provenance.source, fetchedAt: (f as any).provenance.fetchedAt,
    confidence: (f as any).provenance.confidence, state: factState(f as any), claim: CLAIM_KEYS.includes(key as any),
  }));
  return {
    revision: c.revision, facts,
    media: c.media.slice().sort((a, b) => a.order - b.order).map((m) => ({ ...m, url: `/sites/${d.slug}/${m.publicPath}` })),
    readiness: publishReadiness(c, d.offerings, { checks: d.base.source?.review?.checks, leadTested: !!d.base.leadTestedAt, leadNotified: configuredChannels(ownerEmailOf(d.content)).length > 0 }),
  };
}

/** Live appearance tokens for the editor: validated, contrast-checked CSS variables (no re-render). */
export function previewTokens(d: DraftRecord, body: Record<string, unknown>, plan?: DesignPlan) {
  const ap = validateAppearance(body.appearance ?? {});
  if (!ap.ok) throw new DraftError(400, ap.errors[0], { errors: ap.errors });
  const p = plan ?? d.plan;
  const r = resolveAppearance(ap.appearance, { brand: p.tokens.brand, surface: p.tokens.surface, ink: p.tokens.ink });
  return { css: appearanceCss(r), vars: r.vars, fonts: r.fonts, motion: r.motion, notes: r.notes, swatch: r.swatch };
}

/** The editor's state: never includes the key hash, the stored business data or anything the page doesn't show. */
export function ownerState(d: DraftRecord, plan: DesignPlan = d.plan) {
  const p = profileFor(d.category);
  return {
    draft: { id: d.id, revision: d.revision, savedAt: d.savedAt, siteUrl: `${config.publicBaseUrl}/sites/${d.slug}/`, slug: d.slug },
    business: { name: d.businessName, category: d.category, categoryLabel: p.label, city: d.base.facts.city, phone: d.base.business.phone, hasPhone: !!d.base.business.phone, currency: d.base.currency },
    plan: summarisePlan(plan),
    appearance: d.appearance,
    offerings: d.offerings,
    options: {
      ...layoutOptions(plan, d.base.photos, { offerings: d.offerings, category: d.category, services: d.base.services.items }),
      colors: COLOR_PRESETS, gradients: GRADIENT_PRESETS, fonts: TYPE_PRESETS.map((t) => ({ id: t, label: TYPE_PRESET_DEFS[t].label, heading: TYPE_PRESET_DEFS[t].heading.family, body: TYPE_PRESET_DEFS[t].body.family })),
      priceKinds: PRICE_KINDS, priceUnits: PRICE_UNITS, currencies: CURRENCIES, noun: p.noun, offeringsTitle: p.offeringsTitle,
    },
    demo: config.demoCheckout ? { package: config.demoPackage } : null,
  };
}

export function summarisePlan(p: DesignPlan) {
  const v = (id: string) => p.sections.find((s) => s.id === id)?.variant;
  return {
    id: p.id, variation: p.variation, direction: p.direction, directionLabel: DIRECTION_LABEL[p.direction], hero: p.hero.variant, heroLabel: HERO_LABEL[p.hero.variant],
    arrangement: p.arrangement, density: p.density, typography: p.typography, gallery: v('gallery') ?? null, offerings: v('services') ?? (v('focus') ? 'featured' : null),
    locks: p.locks, sections: p.sections.map((s) => s.id), brand: p.tokens.brand,
    family: p.family.id, familyLabel: FAMILY_LABEL[p.family.id], familyVersion: p.family.version, familyCurrent: FAMILY_CURRENT[p.family.id],
  };
}
