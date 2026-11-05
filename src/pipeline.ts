import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Business, Facts, Step, WebsiteScan } from './types.js';
import type { Theme } from './theme/schema.js';
import { scanWebsite } from './sources/website.js';
import { identifyBusiness, type IdentifyInput } from './sources/resolve.js';
import { formatDuration, imageKey, nameKey } from './sources/site-content.js';
import { fetchServiceImages, type ServiceImageRecord } from './sources/service-images.js';
import { buildBrandProfile, dominantColors, profileColors, type BrandProfile } from './sources/brand-profile.js';
import { extractorResult } from './content/extraction.js';
import { featuredService, buildAssets, buildEvidenceModel, headlineRelevant, reconcileServices, reviewEvidence, serviceKey, type EvidenceModel } from './evidence.js';
import { iconFor, shorten, splitNote } from './content/facts.js';
import { IdentityError } from './sources/website-business.js';
import { fetchSiteImages, type ImageRecord } from './sources/site-images.js';
import { claudeNotRun, describeExtractors, type ClaudeRun, type ExtractionReport } from './content/extraction.js';
import { checkBuild, checkOutput, statusOf, type BuildCheck, type BuildReview } from './content/validate.js';
import { previewMessage } from './content/summary.js';
import { usesOf } from './design/image-fit.js';
import { editStory, type EditedStory } from './content/story.js';
import { factStates, type FactStates } from './content/facts.js';
import type { SourceBundle } from './content/model.js';
import sharp from 'sharp';
import { cloneTheme, getTheme, validateTheme, type ThemeEntry } from './theme/load.js';
import { selectTheme } from './theme/select.js';
import { extractFacts, heuristicFacts } from './content/facts.js';
import { pickServices } from './content/services.js';
import { buildModel, type SiteModel } from './content/model.js';
import { pickLogo } from './brand/logo.js';
import { processPhotos } from './brand/photos.js';
import { resolveBrand, brandTextOnSurface } from './brand/brand.js';
import { renderPage } from './render/page.js';
import { screenshot, screenshotsAvailable, writeIcons, writeOgCard } from './render/og.js';
import { auditWebsite, type AuditResult } from './audit/audit.js';
import { canScoreNewSite, scoreNewSite } from './audit/compare.js';
import { isFamilyV2 } from './render/families.js';
import { contentFromBuild, mergeMedia } from './design/content.js';
import { previewContext, renderSiteFiles, sitePlanFor, writeSiteFiles } from './site-render.js';
import { writeReport } from './audit/report.js';
import { auditCard, noWebsiteCard, siteCard, type IMessageCard } from './imessage/cards.js';
import { slugify } from './util/text.js';
import { claudeEnabled, claudeVia } from './content/claude.js';
import { persistDir } from './files.js';
import { detectVertical } from './theme/select.js';
import { findSavedPlan } from './store.js';
import { DIRECTION_LABEL, GOAL_LABEL, HERO_LABEL, validatePlan, type DesignPlan, type DesignPreferences, type Direction, type Goal } from './design/schema.js';
import { analyzePhotos, labelPhotos, type PhotoLabels } from './design/photos.js';
import { photoFindings, tracePhotos, traceLine, type PhotoTrace } from './design/photo-trace.js';
import { designApplies, planDesign, validPhone, type Evidence, type PlanOutput } from './design/planner.js';
import { detectCategory, profileFor } from './design/categories.js';
import { offeringsFrom, type Offering } from './design/offerings.js';
import { toMeta, type PhotoInfo } from './design/photos.js';
import type { Appearance } from './design/schema.js';
import { withLiveReviews } from './sources/google-live.js';
import { phoneKey } from './sources/site-content.js';
import { composeModel, findDraft, newDraftId, putDraft, tokensFor, type DraftBase, type DraftRecord } from './drafts.js';

export interface BuildInput {
  /** Google Maps link, maps.app.goo.gl short link, place ID, or "Business name 78704" */
  google?: string;
  placeId?: string;
  /** keep an existing site's address when its identity is re-resolved (src/repair.ts) */
  repair?: boolean;
  /** Override / supply the business website (otherwise taken from Google) */
  website?: string;
  /** An uploaded theme.json (raw object). Takes precedence over themeId. */
  theme?: unknown;
  themeId?: string;
  vertical?: string;
  variant?: string;
  fonts?: 'theme' | 'business';
  brandColor?: string;
  preview?: boolean;
  audit?: boolean;
  screenshot?: boolean;
  /** Output folder name under out/sites (default: business name + city) */
  slug?: string;
  /**
   * Score the new site after it's built, with the same checks as the old-site audit (Roger's checks plus
   * Lighthouse / Google PageSpeed), for a before-and-after comparison. Adds about 20-30 s; the Studio turns it on.
   */
  scoreNew?: boolean;
  /** Personalisation pilot (plumbing): the owner's answers, a request for an alternative design, the saved plan. */
  design?: {
    preferences?: DesignPreferences;
    alternative?: boolean;
    /** a manually themed build being personalised: Roger's plumbing composition replaces the chosen theme */
    optIn?: boolean;
    /** the plan to stay consistent with (otherwise the newest saved plan for this business) */
    previous?: DesignPlan;
  };
}

/** Whether this build can be personalised, and what the questions should offer (Studio + iMessage). */
export interface PersonaliseInfo {
  eligible: boolean;
  reason?: string;
  /** built with a chosen or uploaded theme: personalising replaces it (needs the operator's opt-in) */
  manualTheme: boolean;
  /** services the business data supports, for the main-service question */
  suggestions: string[];
  /** what "Keep recommended" resolves to */
  recommended?: { style: Direction; goal: Goal; service: string };
  phoneOk: boolean;
  /** 24h / emergency stated by the business; otherwise only the owner can confirm it */
  emergencyVerified: boolean;
}

export interface BuildResult {
  slug: string;
  siteUrl: string;
  siteDir: string;
  themeId: string;
  themeReason: string;
  business: Pick<Business, 'placeId' | 'name' | 'formattedAddress' | 'phone' | 'website' | 'rating' | 'reviewCount' | 'primaryTypeLabel'> & { source?: Business['source']; identity?: Business['identity'] };
  brand: SiteModel['brand'];
  /** only what the page or Google establishes: true when stated, null when unknown (never an invented "no") */
  facts: FactStates & { city?: string; state?: string; zip?: string; serviceAreas: string[]; source: 'claude' | 'heuristic' };
  /** what each extractor found (success / partial / failed / skipped), whether Claude ran, and what the site kept of it */
  extraction?: ExtractionReport & { photos: ImageRecord[] };
  /** the pre-delivery checks: ready, needs review, or blocked, with every finding */
  review?: BuildReview;
  /** the brand as the business's website shows it: colour roles, button style, typefaces, with where each was seen */
  brandProfile?: BrandProfile;
  /** each service's own picture: fetched, cropped (16:10) and kept with the service, or why it wasn't */
  serviceImages?: ServiceImageRecord[];
  services: string[];
  hiddenSections: Record<string, string>;
  audit?: AuditResult & { reportUrl: string; image: string };
  cards: IMessageCard[];
  steps: Step[];
  totalMs: number;
  warnings: string[];
  /** what this build ran with; also what src/estimate.ts matches past builds on */
  mode: { mock: boolean; claude: boolean; claudeVia?: 'api' | 'cli' | null; screenshot: boolean; website?: boolean; audit?: boolean };
  /** the resolved design plan (personalised plumbing builds only) */
  design?: DesignPlan;
  personalise?: PersonaliseInfo;
  /** the owner's editable draft (design builds); owner links are issued for it separately */
  draftId?: string;
  /** the new site scored like the old one (BuildInput.scoreNew) */
  newSite?: AuditResult;
  /** the routes written ("" is the home page) */
  pages?: string[];
  /** every photo found, followed to the page (found → downloaded → classified → eligible → selected → rendered), with why each stopped */
  photoTrace?: PhotoTrace;
}

export type Emit = (e: { type: 'step'; step: string; status: 'start' | 'done' | 'error'; ms?: number; note?: string }) => void;

async function timed<T>(steps: Step[], emit: Emit, name: string, fn: () => Promise<T>, note?: (r: T) => string | undefined): Promise<T> {
  const t0 = Date.now();
  emit({ type: 'step', step: name, status: 'start' });
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    const n = note?.(r);
    steps.push({ name, ms, ok: true, note: n });
    emit({ type: 'step', step: name, status: 'done', ms, note: n });
    return r;
  } catch (e) {
    const ms = Date.now() - t0;
    steps.push({ name, ms, ok: false, note: (e as Error).message });
    emit({ type: 'step', step: name, status: 'error', ms, note: (e as Error).message });
    throw e;
  }
}

/** Prices show in the business's currency; sample fixtures set their own. */
const COUNTRY_CURRENCY: Record<string, string> = { US: 'USD', CA: 'CAD', GB: 'GBP', UK: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', AU: 'AUD', NZ: 'NZD', PK: 'PKR', IN: 'INR', AE: 'AED', ZA: 'ZAR', SG: 'SGD' };

/** What the page may claim, with the same thresholds the content model uses (src/content/model.ts). */
function evidenceFor(theme: Theme, b: Business, facts: Facts, sourceAreas?: string[]): Evidence {
  const pr = (theme.sectionRules.proof || {}) as { minRating?: number; minReviews?: number };
  const ar = (theme.sectionRules.area || {}) as { maxPlaces?: number };
  return {
    showRating: (b.rating || 0) >= (pr.minRating ?? 4) && (b.reviewCount || 0) >= (pr.minReviews ?? 5),
    rating: b.rating,
    reviewCount: b.reviewCount,
    trust: facts.licensed || facts.insured || !!facts.years || facts.warranty,
    // the places the business itself says it serves come first, and alone when it names any
    areas: sourceAreas?.length ? [...new Set(sourceAreas)].slice(0, 12) : [...new Set([facts.city, ...facts.serviceAreas].filter(Boolean) as string[])].slice(0, ar.maxPlaces ?? 8),
    address: b.formattedAddress,
  };
}

/** The business a build or audit is about: a Google listing that checks out, or the website's own information (src/sources/resolve.ts). */
export async function resolveBusiness(input: IdentifyInput, opts: { scan?: WebsiteScan } = {}): Promise<Business> {
  if (!input.placeId && !input.google && !input.website) throw new Error('Provide a Google Business link, place ID, business name + ZIP, or a website.');
  return (await identifyBusiness(input, opts)).business;
}

const identityNote = (b: Business) => {
  const i = b.identity;
  const how = !i ? '' : i.status === 'website-only' ? 'from the website (no matching Google listing)' : i.status === 'unverified' ? 'Google listing, not checked against a website' : `Google listing ${i.status}${i.googleListsWebsite ? ' (Google lists the same website)' : ''}`;
  return `${b.name} · ${how}${b.source === 'website' ? '' : ` · ${b.photos.length} photos · ${b.reviews.length} reviews`}`;
};

/** a service's destination when it is a page of the business's own site other than the home page (not an anchor, a form or a phone) */
function ownPage(dest: string | undefined, home: string): string | undefined {
  try {
    if (!dest) return undefined;
    const u = new URL(dest), h = new URL(home);
    if (!/^https?:$/.test(u.protocol) || u.origin !== h.origin) return undefined;
    if (u.pathname.replace(/\/$/, '') === h.pathname.replace(/\/$/, '')) return undefined; // the same page: an anchor or form on it
    u.hash = '';
    return u.toString();
  } catch { return undefined; }
}

export async function buildSite(input: BuildInput, emit: Emit = () => {}): Promise<BuildResult> {
  const started = Date.now();
  const steps: Step[] = [];
  const warnings: string[] = [];

  // 1) Who is this business? The website is read first and the Google result is checked against it (a postal
  // code is never a business; a result nothing ties to the website is turned down). Nothing reliable on Google:
  // the build goes on from the website itself, or stops with what to send.
  const identified = await timed(steps, emit, 'Identify business', () => identifyBusiness(input), (r) => identityNote(r.business));
  const b = identified.business;
  const websiteUrl = identified.websiteUrl;
  const scan: WebsiteScan | undefined = identified.scan;
  warnings.push(...identified.notes);
  if (scan) {
    const note = scan.ok ? `${scan.status} · ${Math.round(scan.bytes / 1024)} KB · ${scan.logoCandidates.length} logo candidates${scan.rendered ? ' · read after running scripts' : ''}` : `unreachable: ${scan.error || scan.status}`;
    steps.push({ name: 'Scan existing website', ms: scan.timing.totalMs, ok: scan.ok, note });
    emit({ type: 'step', step: 'Scan existing website', status: scan.ok ? 'done' : 'error', ms: scan.timing.totalMs, note });
  }
  const content = scan?.ok ? scan.content : undefined;
  const checks: BuildCheck[] = [];
  const recovered: string[] = [];
  // fill in what Google lacks from what the website states (recovery, with the source named)
  if (content && b.source !== 'mock') {
    if (!b.phone && content.phones.primary) { b.phone = content.phones.primary; b.phoneE164 = `+1${content.phones.primary.replace(/\D/g, '')}`; recovered.push(`phone ${b.phone} from the website`); }
    if (!b.formattedAddress && content.address) { const a = content.address; b.formattedAddress = `${a.formatted}, USA`; b.street = `${a.street}${a.unit ? `, ${a.unit}` : ''}`; b.city ||= a.city; b.state ||= a.state; b.zip ||= a.zip; b.country ||= 'US'; recovered.push(`address ${a.formatted} from the website`); }
    if (!b.primaryTypeLabel && content.identity.typeHint) { b.primaryTypeLabel = content.identity.typeHint.label; b.primaryType ||= content.identity.typeHint.googleType; b.types = [...new Set([...(b.types || []), content.identity.typeHint.googleType])]; recovered.push(`business type "${b.primaryTypeLabel}" from the website`); }
  }
  if (recovered.length) warnings.push(`Filled in from the website: ${recovered.join('; ')}.`);
  // the website and Google disagree on the phone or the address: neither is chosen for visitors (no call or directions
  // button, no number or map shown) until the owner settles it; the conflict stays in the review, the request form stays
  const google = { phone: b.phone, phoneE164: b.phoneE164, formattedAddress: b.formattedAddress, street: b.street, lat: b.lat, lng: b.lng };
  const held = content && b.source !== 'mock' ? heldContacts(b, content) : {};
  if (held.phone) { b.phone = undefined; b.phoneE164 = undefined; warnings.push(`Phone held for the owner: Google lists ${held.phone.google}, the website ${held.phone.website}.`); }
  if (held.address) { b.formattedAddress = undefined; b.street = undefined; b.lat = undefined; b.lng = undefined; warnings.push(`Address held for the owner: Google lists ${held.address.google}, the website ${held.address.website}.`); }
  // the website's own photographs (fetched at full size, measured, de-duplicated; failures recorded)
  let siteImages: Awaited<ReturnType<typeof fetchSiteImages>> | undefined;
  if (content && scan && b.source !== 'mock') {
    siteImages = await timed(steps, emit, 'Fetch website photos', () => fetchSiteImages(content, { pageUrl: scan.finalUrl, places: content.areas?.places }), (r) => r.report.reason);
    const heroKey = content.hero?.image ? imageKey(content.hero.image.seen) : undefined;
    for (const p of siteImages.photos) if (heroKey && imageKey(p.ref) === heroKey) p.origin = { ...p.origin, role: 'hero' };
    b.photos = [...siteImages.photos, ...b.photos];
    for (const r of siteImages.records.filter((x) => !x.ok)) warnings.push(`Website photo not retrieved: ${r.url.split('/').pop()} (${r.error})`);
  }

  // 3) Theme. A chosen or uploaded theme is authoritative; only an explicit opt-in (refining that build) replaces it
  // with the personalised plumbing composition.
  const manualTheme = !!(input.theme || input.themeId || input.vertical || input.variant);
  const optIn = config.designPilot && !!input.design?.optIn;
  let entry: ThemeEntry;
  let themeReason: string;
  if (input.theme && !optIn) {
    const v = validateTheme(input.theme);
    if (!v.ok || !v.theme || !v.id) throw new Error(`Invalid theme.json: ${v.errors.slice(0, 5).join('; ')}`);
    entry = { id: v.id, vertical: v.theme.meta.vertical, variant: v.theme.meta.variant, name: v.theme.meta.name, file: '(upload)', origin: 'custom', theme: v.theme, warnings: v.warnings };
    themeReason = 'Uploaded theme.json';
    warnings.push(...v.warnings);
  } else {
    const prelim = heuristicFacts(b, scan);
    const any = getTheme(input.themeId || '') || [...(await import('./theme/load.js')).loadThemes().values()][0];
    const usable = b.photos.filter((p) => usesOf(p.width, p.height).length > 0).length;
    const pick = selectTheme(b, prelim, usable, optIn ? {} : { themeId: input.themeId, vertical: input.vertical, variant: input.variant });
    entry = pick.entry;
    themeReason = optIn ? 'Personalised: Roger\'s design plan replaces the chosen theme (opted in)' : pick.reason;
    if (entry.vertical === 'general' && !input.themeId && !input.vertical) warnings.push(`No trade theme for Google category "${b.primaryTypeLabel || b.primaryType || 'unknown'}"; built with the general theme.`);
  }
  const theme = cloneTheme(entry.theme); // pulled colors are applied to this copy only
  const designOn = designApplies({ pilot: config.designPilot, manualTheme, optIn });
  const prefs = input.design?.preferences;
  emit({ type: 'step', step: `Theme: ${entry.name}`, status: 'done', note: themeReason });

  const slug = input.slug ? slugify(input.slug) : slugify(b.city && !slugify(b.name).includes(slugify(b.city)) ? `${b.name} ${b.city}` : b.name);
  const siteDir = path.join(config.dirs.sites, slug);
  const assetDir = path.join(siteDir, 'assets');
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(assetDir, { recursive: true });

  // 4) In parallel: photos (+ what they show, for design builds), logo, facts (Claude), audit
  const doAudit = input.audit !== false && !!scan;
  const photosP = timed(steps, emit, 'Process photos', () => processPhotos(b, theme, { outDir: assetDir, publicPrefix: 'assets' }), (r) => `${r.usable} usable · ${r.rejected.length} rejected`);
  // design builds: what each photo shows (vision / sample labels), while Claude reads the facts
  const labelsP = designOn
    ? photosP.then((p) => timed(steps, emit, 'Read photos', () => labelPhotos(p.items, { name: b.name, category: b.primaryTypeLabel || b.primaryType }).catch((e): PhotoLabels => ({ kinds: p.items.map(() => 'unknown' as const), seen: p.items.map(() => undefined), source: 'none', note: `labelling failed: ${(e as Error).message}` })),
        (r) => (r.source === 'vision' ? `${r.kinds.filter((k) => k !== 'unknown').length} labelled by Claude` : r.source === 'fixture' ? 'sample-data labels' : 'no labels: ranking by quality only')))
    : Promise.resolve(undefined);
  const designAsk = designOn ? { design: { style: prefs?.style, service: prefs?.service, goal: prefs?.goal } } : {};
  const [photos, logoRes, factsRes, audit, labels] = await Promise.all([
    photosP,
    timed(steps, emit, 'Find logo', () => pickLogo(scan, { outDir: assetDir, publicPrefix: 'assets', band: theme.palette.surface, maxHeightPx: theme.logo.maxHeight.desktop, minChroma: theme.brandColor.minChroma }), (r) => (r.logo ? `from ${r.logo.sourceUrl.split('/').pop()}` : 'none, using wordmark')),
    timed(steps, emit, claudeEnabled() ? 'Extract facts (Claude)' : 'Extract facts', () => extractFacts(b, theme, scan, designAsk), (r) => `${r.claude.ran ? (r.claude.validated ? `Claude read the page (${r.claude.ms} ms)${r.claude.dropped.length ? `, dropped ${r.claude.dropped.length} unsupported` : ''}` : `Claude ${r.claude.error ? 'failed' : 'was rejected'}: ${r.claude.fallbackReason}`) : `Claude did not run: ${r.claude.fallbackReason}`} · ${[r.facts.years && `${r.facts.years} yrs`, r.facts.licensed && 'licensed', r.facts.insured && 'insured', r.facts.emergency && 'emergency', r.facts.open24h && '24h'].filter(Boolean).join(', ') || 'no stated facts (unknown, not absent)'} · ${r.services.length} services`),
    doAudit ? timed(steps, emit, 'Audit existing website', () => auditWebsite(scan!, b), (r) => `score ${r.score}/100 · ${r.issues.length} issues`) : Promise.resolve(undefined),
    labelsP,
  ]);
  // Google's review text, authors and ages are not kept: from here on they are markers filled when a page is served
  b.reviews = withLiveReviews(b).reviews;
  for (const r of logoRes.rejected) warnings.push(`Logo candidate rejected: ${r.reason}`);
  for (const r of photos.rejected) warnings.push(`Photo rejected: ${r.reason}`);

  // the picture on each service's own card, kept with that service
  let serviceImgs: Awaited<ReturnType<typeof fetchServiceImages>> | undefined;
  if (content && b.source !== 'mock' && content.services.some((x) => x.image)) {
    serviceImgs = await timed(steps, emit, 'Fetch service pictures', () => fetchServiceImages(content.services.map((x) => (x.image && !serviceImageFits(x.name, x.image) ? { ...x, image: undefined } : x)), { outDir: assetDir, publicPrefix: 'assets' }), (r) => `${r.byService.size} of ${r.records.length} cropped to 16:10`);
    for (const s of factsRes.services) { const im = serviceImgs.byService.get(nameKey(s.name)); if (im) s.image = im; }
    for (const r of serviceImgs.records.filter((x) => !x.ok)) warnings.push(`Service picture not used: ${r.service} (${r.skipped ?? r.error})`);
  }
  // the brand as the website shows it (measured in a browser), with the logo as supporting evidence
  let brandProfile: BrandProfile | undefined;
  if (scan?.ok && b.source !== 'mock') {
    const logoColors = logoRes.logo?.file ? await dominantColors(logoRes.logo.file) : [];
    brandProfile = buildBrandProfile(scan.brandRaw, { logoColors, logoUrl: logoRes.logo?.sourceUrl, sourceUrl: scan.finalUrl, cssColors: scan.cssColors });
    emit({ type: 'step', step: 'Brand profile', status: 'done', note: brandProfile.primary ? `${brandProfile.method}: ${brandProfile.primary.hex}${brandProfile.secondary ? ` + ${brandProfile.secondary.hex}` : ''} (${brandProfile.primary.confidence})` : 'no brand colours found' });
    for (const n of brandProfile.notes) warnings.push(`Brand: ${n}`);
  }

  // the evidence model: the service inventory reconciled across the home page, menu and service pages, pictures with their
  // provenance, claims with where they were read. The site shows what this verifies; proposals wait for review.
  let evModel: EvidenceModel | undefined;
  let storyEdit: EditedStory | undefined;
  if (content && scan && b.source !== 'mock') {
    const crawlPages = scan.crawl?.pages ?? [];
    const recs = reconcileServices({ homeUrl: scan.finalUrl, content, crawl: crawlPages, textServices: factsRes.services.map((x) => ({ name: x.name, description: x.description })), inferred: (factsRes.claudeServices ?? []).map((x) => ({ name: x.name, description: x.description })) });
    const built = buildAssets({ homeUrl: scan.finalUrl, content, crawl: crawlPages, services: recs, imageRecords: siteImages?.records, serviceImageRecords: serviceImgs?.records, logoUrl: logoRes.logo?.sourceUrl, googlePhotos: b.photos.filter((p) => p.source !== 'website').length });
    evModel = buildEvidenceModel({ scan, business: b, services: recs, assets: built.assets, projectsVerified: built.projectsVerified, brand: brandProfile });
    // emergency service stated in the website's own text (read by the facts step) counts as stated on the website
    if (factsRes.facts.emergency && !evModel.claims.emergencyResponse?.value) evModel.claims.emergencyResponse = { value: 'stated on the website', sourceUrl: scan.finalUrl, sourceType: 'website', observedAt: new Date().toISOString(), confidence: 0.7, status: 'verified' };
    const verified = recs.filter((r) => r.status === 'verified').sort((a, z) => a.priority - z.priority);
    if (verified.length) {
      factsRes.services = verified.map((r) => {
        const src = content.services.find((x) => serviceKey(x.name) === serviceKey(r.canonicalName));
        const { description, note } = splitNote(r.description?.value);
        const contact = src?.booking && !(src.booking.kind === 'phone' && held.phone) ? { kind: src.booking.kind, url: src.booking.url, label: src.booking.kind === 'phone' ? 'Call to book' : src.booking.kind === 'online' ? src.booking.label : requestLabel(src.booking.label) } : null;
        return { name: r.canonicalName, description: shorten(description ?? '', 150), icon: iconFor(r.canonicalName), note, contact, image: serviceImgs?.byService.get(nameKey(r.canonicalName)) ?? null, fromWebsite: true, secondary: !r.isPrimary, page: ownPage(r.destination, scan.finalUrl), price: factsRes.services.find((x) => serviceKey(x.name) === serviceKey(r.canonicalName))?.price ?? undefined };
      });
    }
    if (content.areas?.places.length) factsRes.facts.serviceAreas = content.areas.places;
  }

  // 5) Services (before the design plan, which leads with one of them)
  factsRes.services = factsRes.services.filter((x) => !vagueService(x.name));
  const services = pickServices(theme, b, scan, factsRes.servicesMentioned, factsRes.serviceBlurbs, { emergencyOk: factsRes.facts.emergency || factsRes.facts.open24h, own: factsRes.services, ownFromWebsite: factsRes.services.some((x) => x.fromWebsite) });
  emit({ type: 'step', step: 'Services', status: 'done', note: services.source === 'business' ? `${services.items.length} from the business's own website` : services.hidden ? 'none verified, section hidden' : `theme's standard list (${factsRes.services.length} own services found, need ${(theme.sectionRules.services as any)?.min ?? 3})` });
  const evidence = evidenceFor(theme, b, factsRes.facts, content?.areas?.places);
  const personalise: PersonaliseInfo = {
    eligible: config.designPilot,
    reason: config.designPilot ? undefined : 'Personalisation is turned off (DESIGN_PILOT=0)',
    manualTheme: manualTheme && !optIn,
    suggestions: [...new Set(services.items.filter((s) => services.source === 'business' || (s.hits ?? 0) > 0).map((s) => s.label))].slice(0, 4),
    phoneOk: validPhone(b),
    // emergency service is what the business says it offers; opening hours on a listing don't promise dispatch
    emergencyVerified: factsRes.facts.emergency,
  };

  // the stock placeholder hero when Google has no usable photo (legacy themes show it; design plans go type-led)
  let hero = photos.hero;
  if (!hero && theme.stock.hero[0]) {
    const stock = theme.stock.hero[0];
    const src = path.join(config.dirs.public, stock.url.replace(/^\//, ''));
    // on Vercel public/ is on its CDN, not next to the server: fetch the placeholder from the public URL instead
    const data = fs.existsSync(src)
      ? fs.readFileSync(src)
      : await fetch(`${config.publicBaseUrl}${stock.url}`, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.arrayBuffer() : undefined)).then((b) => (b ? Buffer.from(b) : undefined)).catch(() => undefined);
    if (data) {
      fs.writeFileSync(path.join(assetDir, path.basename(src)), data);
      hero = { publicPath: `assets/${path.basename(src)}`, width: stock.width || 1920, height: stock.height || 1080, alt: stock.alt || '', source: 'stock' };
    }
  }
  const socials = scan?.socials || [];
  const email = content?.emails[0] ?? scan?.emails.find((e) => !/example|sentry|wixpress|mysite.com/.test(e));

  // the website's other content: where it takes bookings, its story, and its videos (with a poster picture each)
  let sourceBundle: SourceBundle | undefined;
  if (content && b.source !== 'mock') {
    const videos: SourceBundle['videos'] = [];
    let posterN = 0;
    for (const v of content.videos) {
      const buf = v.poster ? siteImages?.posters.get(imageKey(v.poster)) : undefined;
      let poster: SourceBundle['videos'][number]['poster'];
      if (buf) {
        try {
          const out = await sharp(buf).rotate().resize({ width: 960, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
          const file = `video-${++posterN}.webp`;
          fs.writeFileSync(path.join(assetDir, file), out.data);
          poster = { publicPath: `assets/${file}`, width: out.info.width, height: out.info.height };
        } catch { /* the poster picture is optional: the video still shows as a titled link */ }
      }
      videos.push({ title: v.title, duration: formatDuration(v.duration), kind: v.kind, url: v.url, pageUrl: v.pageUrl, poster, note: v.note });
    }
    const primary = content.booking.primary;
    storyEdit = content.story ? await editStory({ name: b.name, heading: content.story.heading, text: content.story.text }) : undefined;
    const heroCta = content.hero?.primary;
    const second = content.hero?.secondary;
    const projects = !!evModel?.projectsVerified;
    sourceBundle = {
      cta: heroCta || second ? {
        primary: heroCta ? { ...ctaFor(heroCta, !!primary && heroCta.href === primary.url, !!held.phone), terms: heroCta.terms, eligibleServices: (evModel?.offers[0]?.eligible ?? []).map((e) => serviceKey(e.service)), featuredService: featuredService(evModel?.offers[0], evModel?.services ?? []) } : undefined,
        // "See our work" goes to the photo section of this site when the work is shown there; a link to a page that exists only on the old site would be dead
        secondary: second && (projects || /work|project|gallery|photo/i.test(second.label)) ? { label: second.label, to: 'gallery' } : undefined,
      } : undefined,
      galleryTitle: projects ? 'Recent work' : 'Photos',
      region: content.areas?.region,
      claims: content.claims.map((c) => ({ key: c.key, text: c.text })),
      testimonials: content.testimonials.map((t) => ({ author: t.author, text: t.text })),
      evidence: evModel,
      website: scan?.finalUrl,
      booking: primary ? { url: primary.url, label: 'Book online', platform: primary.platform, kind: primary.kind } : undefined,
      story: content.story ? { heading: storyEdit?.heading ?? content.story.heading, text: content.story.text, paragraphs: storyEdit?.paragraphs, edited: storyEdit?.method === 'edited' } : undefined,
      videos,
    };
  }

  // 6) Design plan (every category): direction, goal, focus offering, hero, sections, photo roles, offerings with prices
  let planOut: PlanOutput | undefined;
  let base: DraftBase | undefined;
  let offerings: Offering[] = [];
  let appearance: Appearance | undefined;
  let draft: DraftRecord | undefined;
  let infos: PhotoInfo[] = [];
  let draftContent: import('./design/content.js').SiteContent | undefined;
  if (designOn) {
    const t0 = Date.now();
    emit({ type: 'step', step: 'Design plan', status: 'start' });
    const category = detectCategory(b, entry.vertical);
    draft = await findDraft({ slug });
    const savedDraft = draft && draft.businessKey === b.placeId ? draft : await findDraft({ businessKey: b.placeId });
    const saved = input.design?.previous ?? savedDraft?.plan ?? (await findSavedPlan(b.placeId));
    const previous = saved ? validatePlan(saved) : undefined;
    if (previous && !previous.ok) warnings.push(`Saved design plan ignored: ${previous.errors[0]}`);
    infos = await analyzePhotos(photos.items, labels?.kinds ?? photos.items.map(() => 'unknown'));
    const currency = b.currency || (b.country && COUNTRY_CURRENCY[b.country]) || 'USD';
    offerings = offeringsFrom({ business: b.offerings, own: factsRes.services, services: services.items, currency });
    // the owner's saved prices and appearance survive a rebuild
    if (savedDraft?.offerings.some((o) => o.source === 'owner')) offerings = savedDraft.offerings;
    appearance = savedDraft?.appearance;
    base = {
      slug, themeId: entry.id, themeName: entry.name, theme: cloneTheme(entry.theme), business: b, facts: factsRes.facts, category,
      logo: logoRes.logo, scanBrand: scan ? { ok: scan.ok, themeColor: scan.themeColor, cssColors: scan.cssColors } : undefined, brandOverride: input.brandColor,
      services: { ...services }, hero, heroIsStock: !photos.hero, gallery: photos.gallery, socials, email, preview: input.preview !== false,
      photos: infos.map(toMeta), evidence, advice: factsRes.design, currency, source: sourceBundle, brandProfile,
    };
    planOut = planDesign({
      sourceText: [scan?.ok ? scan.text : '', sourceBundle?.booking ? `book online ${sourceBundle.booking.url}` : ''].join('\n'),
      businessKey: b.placeId, business: b, facts: factsRes.facts, category, services: services.items, servicesSource: services.source, offerings, photos: infos, evidence,
      preferences: prefs, previous: previous?.ok ? previous.plan : undefined, alternative: input.design?.alternative, recent: savedDraft?.history, advice: factsRes.design, story: !!sourceBundle?.story,
      tokens: tokensFor(base),
    });
    const plan = planOut.plan;
    // the headline: the website's own, when it says what the business does; otherwise what it is, its main services and where
    if (evModel?.hero && content?.hero) {
      const ctx = { typeLabel: b.primaryTypeLabel, services: evModel.services.filter((s) => s.isPrimary).map((s) => s.canonicalName) };
      const own = tidyHeadline(content.hero.headline);
      const subOk = content.hero.subline && content.hero.subline.length >= 40;
      const where = content.areas?.region || b.city;
      const composed = `${b.primaryTypeLabel ? b.primaryTypeLabel.replace(/ contractor$/i, '') : 'Local'} ${ctx.services.slice(0, 3).map((x) => x.toLowerCase()).join(', ')}${where ? ` in ${where}` : ''}`.replace(/\s+/g, ' ').trim();
      const headline = own.length >= 8 && own.length <= 90 && headlineRelevant(own, ctx) ? own : composed.slice(0, 90);
      plan.copy = { headline, subline: subOk ? content.hero.subline!.slice(0, 220) : plan.copy.subline, source: 'source' };
    }
    themeReason = `${themeReason}. Page layout, type and spacing come from the design plan (${DIRECTION_LABEL[plan.direction]}, ${profileFor(category).label.toLowerCase()}); the theme supplies copy patterns and services`;
    warnings.push(...planOut.warnings);
    personalise.recommended = { style: planOut.recommended.direction, goal: planOut.recommended.goal, service: planOut.recommended.service };
    const note = `${DIRECTION_LABEL[plan.direction]} · ${HERO_LABEL[plan.hero.variant].toLowerCase()} hero · ${plan.service.label} · ${profileFor(category).actions[plan.goal]}`;
    steps.push({ name: 'Design plan', ms: Date.now() - t0, ok: true, note });
    emit({ type: 'step', step: 'Design plan', status: 'done', ms: Date.now() - t0, note });
  }

  // 7 + 8) Brand colour, fonts and the content model. Design builds compose from the stored data (src/drafts.ts),
  // exactly as the owner's later edits re-render; other themes as before.
  let brand: SiteModel['brand'];
  let model: SiteModel;
  if (planOut && base) {
    // the owner's reviewed facts and photo choices from an earlier build of this site carry over
    const previousContent = draft?.content && draft.businessKey === b.placeId ? mergeMedia(draft.content, contentFromBuild(b, factsRes.facts, base.photos, { sample: b.source === 'mock', fetchedAt: new Date().toISOString() })) : undefined;
    if (previousContent) { draftContent = previousContent; for (const m of previousContent.media) if (m.source === 'owner' && !infos.some((p) => p.key === m.key)) { const meta = draft!.base.photos.find((p) => p.key === m.key); if (meta) { base.photos.push(meta); infos.push(meta as PhotoInfo); } } }
    model = await composeModel(base, planOut.plan, { appearance, offerings, photos: infos, content: previousContent });
    brand = model.brand;
    for (const r of brand.rejected) warnings.push(`Brand color ${r.hex} (${r.source}) rejected: ${r.reason}`);
    const gFont = scan?.fonts.find((f) => f.source === 'google');
    if (gFont) warnings.push(`Website uses Google Font "${gFont.family}"; the design plan uses its own type pairing (the owner can change it in the preview).`);
  } else {
    brand = resolveBrand(theme, { logo: logoRes.logo, scan, override: input.brandColor });
    for (const r of brand.rejected) warnings.push(`Brand color ${r.hex} (${r.source}) rejected: ${r.reason}`);
    const pair = theme.fontPairs.find((p) => p.id === theme.defaultPair) || theme.fontPairs[0];
    const fonts: SiteModel['fonts'] = { heading: pair.heading, body: pair.body, faces: [] };
    for (const f of theme.fontFaces) if ((f as any).url) fonts.faces.push({ family: f.family, url: (f as any).url });
    const gFont = scan?.fonts.find((f) => f.source === 'google');
    if (input.fonts === 'business' && gFont) {
      fonts.heading = `'${gFont.family}', ${pair.heading}`;
      fonts.faces.push({ family: gFont.family, url: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(gFont.family)}:wght@500;700&display=swap` });
      brand.fonts = { heading: gFont.family, from: 'website' };
    } else {
      brand.fonts = { heading: pair.label || pair.id, from: 'theme' };
      if (gFont) warnings.push(`Website uses Google Font "${gFont.family}". Pass fonts=business to use it for headings.`);
    }
    model = buildModel({
      slug, themeId: entry.id, theme, business: b, facts: factsRes.facts, brand, brandText: brandTextOnSurface(brand, theme),
      services, hero, gallery: photos.gallery, fonts, socials, email, baseUrl: config.publicBaseUrl, preview: input.preview !== false,
    });
    if (!photos.hero) model.images.heroIsStock = true;
  }
  warnings.push(...model.warnings);

  // 9) Render + share assets
  // design builds: the pages of the SitePlan (one page, or Home + offerings + about + contact when the content supports it)
  const sitePlan = planOut && isFamilyV2(model) ? sitePlanFor(model, { previous: (draft ?? undefined)?.sitePlan }) : undefined;
  let renderedAll = '';
  await timed(steps, emit, 'Render site', async () => {
    const files = renderSiteFiles(model, sitePlan, previewContext(slug, model.theme.locale.split('-')[0]));
    writeSiteFiles(siteDir, files);
    renderedAll = files.filter((x) => x.file.endsWith('.html')).map((x) => x.content).join('\n');
    const html = files.find((f) => f.file === 'index.html')!.content;
    await writeIcons(siteDir, { name: b.name, brand: brand.brand, ink: brand.brandInk, logoFile: logoRes.logo?.file });
    const heroFile = path.join(siteDir, model.images.hero.publicPath);
    const city = [b.city, b.state].filter(Boolean).join(', ');
    await writeOgCard(path.join(siteDir, 'og.jpg'), {
      heroFile,
      name: b.name,
      line2: model.proof.showRating ? `★ ${b.rating?.toFixed(1)} · ${b.reviewCount} Google reviews` : b.primaryTypeLabel,
      line3: [b.primaryTypeLabel, city].filter(Boolean).join(' · '),
      brand: brand.brand,
      ink: brand.brandInk,
    });
    const { theme: _t, ...dump } = model;
    fs.writeFileSync(path.join(siteDir, 'site.json'), JSON.stringify({ ...dump, themeName: entry.name }, null, 2));
    return html.length;
  }, (n) => `${Math.round(n / 1024)} KB html`);

  // the pre-delivery checks: what the source showed against what the site kept, and against the finished page
  const claude: ClaudeRun = factsRes.claude ?? claudeNotRun(false, null, 'not run');
  const websitePhotoCount = photos.items.filter((p) => p.photo.source === 'website').length;
  const review0 = checkBuild({
    business: { ...b, ...google }, scan,
    servicesKept: model.services.items.map((x) => x.label),
    photos: { discovered: siteImages ? siteImages.records.filter((r) => r.role === 'content' || r.role === 'team').length : 0, kept: websitePhotoCount, failures: siteImages ? siteImages.records.filter((r) => !r.ok).length : 0 },
    videos: { discovered: content?.videos.length ?? 0, kept: sourceBundle?.videos.length ?? 0 },
    booking: sourceBundle?.booking,
    hidden: model.hidden,
    claude,
    serviceImages: serviceImgs ? { discovered: serviceImgs.records.length, usable: serviceImgs.byService.size, failures: serviceImgs.records.filter((x) => !x.ok).length } : undefined,
    brand: brandProfile && brandProfile.method === 'rendered' ? { found: profileColors(brandProfile) } : undefined,
  });
  const outputChecks = b.source === 'mock' ? [] : checkOutput(renderedAll, {
    services: content?.services.map((x) => x.name) ?? [],
    bookingUrl: sourceBundle?.booking?.url,
    ctaLabel: sourceBundle?.cta?.primary?.label,
    phone: b.phone,
    street: b.formattedAddress?.split(',')[0] ?? content?.address?.street,
    name: b.name,
    brandColors: brandProfile && brandProfile.method === 'rendered' ? profileColors(brandProfile) : undefined,
    serviceImages: serviceImgs?.byService.size,
  });
  const evFindings = evModel ? reviewEvidence(evModel, {
    servicesShown: offerings.length ? offerings.map((o) => o.name) : model.services.items.map((x) => x.label),
    headline: model.copy.hero, typeLabel: b.primaryTypeLabel,
    primaryCtaLabel: model.design ? (sourceBundle?.cta?.primary?.label ? sourceBundle.cta.primary.label : undefined) : undefined,
    galleryTitle: sourceBundle?.galleryTitle, storyChars: storyEdit?.method === "edited" ? 0 : model.design?.intro?.length,
    serviceCardImages: (renderedAll.match(/class="f-svc-media"><img/g) || []).length,
  }) : [];
  if (storyEdit && storyEdit.method === 'extracted' && (content?.story?.text.length ?? 0) >= 200) evFindings.push({ id: 'story-unedited', level: 'review', message: "The About text is the website's own sentences, not an edited summary: read it before publishing." });
  // every photo followed to the finished pages: usable photos and none on the page is a finding, never a clean success
  const photoTrace = tracePhotos({ found: b.photos, processed: photos, labels, infos: planOut ? infos : undefined, plan: planOut?.plan, html: renderedAll, planReasons: planOut?.plan.reasons });
  steps.push({ name: 'Photo trace', ms: 0, ok: true, note: traceLine(photoTrace) });
  emit({ type: 'step', step: 'Photo trace', status: 'done', note: traceLine(photoTrace) });
  const selectionChecks: BuildCheck[] = photoFindings(photoTrace);
  // offerings (a menu, a price list, services) come only from a source the business owns: its website, its own
  // documents or the owner. Reviews and Google's listing don't establish them, so without one the section is left out
  const prof = profileFor(planOut?.plan.category ?? detectCategory(b, entry.vertical));
  if (!scan?.ok && !b.offerings?.length && b.source !== 'mock') {
    selectionChecks.push({ id: 'offerings-unverified', level: 'review', message: `No ${prof.offeringsTitle.toLowerCase()} from a source the business owns (website, menu or price list, or the owner), so the page doesn't list any. Ask the owner for their ${prof.offeringsTitle.toLowerCase()}.` });
  }
  // without a website (or the owner's input) the brand is unknown: say so, rather than present a palette as theirs
  if (!scan?.ok && !input.brandColor && b.source !== 'mock') {
    selectionChecks.push({ id: 'brand-unknown', level: 'review', message: `No website or owner-provided brand: the logo and brand colours are unknown, so the preview uses a text wordmark and ${planOut ? 'the design plan\'s' : 'the theme\'s'} default colours. Ask the owner for their logo and colours.` });
  }
  const reviewChecks = [...review0.checks, ...selectionChecks, ...outputChecks, ...evFindings.map((f): BuildCheck => ({ id: f.id, level: f.level, message: f.message })), ...recovered.map((m): BuildCheck => ({ id: 'recovered', level: 'info', message: `Filled in ${m}.`, recovered: true }))];
  const review: BuildReview = { status: statusOf(reviewChecks), checks: reviewChecks };
  for (const c of review.checks.filter((x) => x.level !== 'info')) warnings.push(`Check: ${c.message}`);
  const extractors = [...(content?.report ?? []), ...(siteImages ? [siteImages.report] : []), ...(serviceImgs ? [extractorResult('service pictures', serviceImgs.byService.size === serviceImgs.records.length ? 'success' : serviceImgs.byService.size ? 'partial' : 'failed', `${serviceImgs.byService.size} of ${serviceImgs.records.length} service pictures fetched and cropped to 16:10${serviceImgs.records.some((r) => !r.ok) ? `; ${serviceImgs.records.filter((r) => !r.ok).map((r) => `${r.service}: ${r.skipped ?? r.error}`).slice(0, 2).join('; ')}` : ''}`, serviceImgs.byService.size, serviceImgs.records.length)] : []), ...(brandProfile ? [extractorResult('brand', brandProfile.method === 'rendered' && brandProfile.primary ? 'success' : brandProfile.primary ? 'partial' : 'failed', brandProfile.primary ? `${brandProfile.method}: primary ${brandProfile.primary.hex} (${brandProfile.primary.confidence})${brandProfile.secondary ? `, secondary ${brandProfile.secondary.hex} (${brandProfile.secondary.confidence})` : ''}${brandProfile.button ? `, buttons ${brandProfile.button.fill} with ${brandProfile.button.text} lettering` : ''}` : 'no brand colours could be read from the page or the logo')] : [])];
  const extraction: BuildResult['extraction'] = {
    extractors,
    claude,
    retention: [
      ...(content ? [{ what: 'services', discovered: content.services.length, kept: model.services.items.length }] : []),
      ...(siteImages ? [{ what: 'photos', discovered: siteImages.records.filter((r) => r.role === 'content' || r.role === 'team').length, kept: websitePhotoCount }] : []),
      ...(content ? [{ what: 'videos', discovered: content.videos.length, kept: sourceBundle?.videos.length ?? 0 }] : []),
    ],
    photos: siteImages?.records ?? [],
  };
  for (const l of describeExtractors(extractors)) if (/: (failed|partial)/.test(l)) warnings.push(`Extraction ${l}`);
  if (sourceBundle) { sourceBundle.extraction = { extractors, claude, retention: extraction.retention }; sourceBundle.review = review; }

  let shot = false;
  if (input.screenshot !== false && screenshotsAvailable()) {
    shot = await timed(steps, emit, 'Screenshot preview', () => screenshot(path.join(siteDir, 'index.html'), path.join(siteDir, 'preview.jpg'), { width: 1200, height: 630 }), (ok) => (ok ? 'preview.jpg' : 'skipped'));
  }

  // 9b) Score the new site the same way as the old one (needs this server to be serving it: Studio builds)
  let newSite: AuditResult | undefined;
  if (input.scoreNew && canScoreNewSite(model.urls.site)) {
    newSite = await timed(steps, emit, 'Score new site', () => scoreNewSite(model.urls.site, b, { preview: model.preview }), (r) => `${r.score}/100${r.metrics.pagespeed?.mobile?.scores.performance !== undefined ? ` · mobile speed ${r.metrics.pagespeed.mobile.scores.performance}` : ''}`).catch((e) => {
      warnings.push(`New site wasn't scored: ${(e as Error).message}`);
      return undefined;
    });
  }

  // 10) Audit report + iMessage cards
  const cards: IMessageCard[] = [];
  let auditOut: BuildResult['audit'];
  if (audit) {
    const rep = await writeReport(slug, audit, { businessName: b.name, siteUrl: model.urls.site, newSite });
    auditOut = { ...audit, reportUrl: rep.url, image: rep.image };
    cards.push(auditCard(audit, rep.url, rep.image));
  } else if (!websiteUrl) {
    cards.push(noWebsiteCard(b.name));
  }
  cards.push(siteCard({
    name: b.name, url: model.urls.site, image: shot ? `${model.urls.site}preview.jpg` : model.urls.og, hadWebsite: !!websiteUrl, personalisable: personalise.eligible && !personalise.manualTheme,
    // what the message says comes from what the build obtained and checked
    text: previewMessage({
      name: b.name, identitySource: b.source === 'website' ? 'website' : b.source === 'mock' ? 'mock' : 'google',
      googlePhotos: photos.items.filter((p) => p.photo.source !== 'website').length, websitePhotos: websitePhotoCount, googleReviews: b.reviews.length,
      hoursKnown: !!b.hours?.periods?.length, services: content?.services.length ? model.services.items.length : 0, videos: sourceBundle?.videos.length ?? 0,
      hasStory: !!sourceBundle?.story, bookingLinked: !!sourceBundle?.booking, hadWebsite: !!websiteUrl, auditIssues: audit?.issues.length,
    }, review),
    needsReview: review.status !== 'ready',
  }));
  if (shot && model.preview) {
    // For preview links sent to the owner, show the real design in the iMessage rich card.
    for (const p of sitePlan?.pages.map((x) => `${x.route}index.html`) ?? ['index.html']) {
      const f = path.join(siteDir, p);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(`content="${model.urls.og}"`).join(`content="${model.urls.site}preview.jpg"`).split(`content="${previewContext(slug).base}/og.jpg"`).join(`content="${model.urls.site}preview.jpg"`));
    }
  }

  await persistDir(siteDir); // on Vercel: copy the finished site to Redis so any server instance can serve it

  // the draft the owner previews, customises and can buy (src/drafts.ts); a rebuild of the same site updates it
  let draftId: string | undefined;
  if (planOut && base) {
    const now = new Date().toISOString();
    const plan = planOut.plan;
    const d: DraftRecord = draft
      ? { ...draft, content: draftContent ?? draft.content ?? contentFromBuild(b, factsRes.facts, base.photos, { description: b.editorialSummary, goal: plan.goal, sample: b.source === 'mock', fetchedAt: now }), base, plan, appearance: appearance ?? {}, offerings, sitePlan, businessKey: b.placeId, businessName: b.name, category: base.category, revision: draft.revision + 1, savedAt: now, updatedAt: now, candidates: [],
          history: plan.id !== draft.plan.id ? [draft.plan, ...draft.history.filter((p) => p.id !== plan.id)].slice(0, 5) : draft.history }
      : { content: contentFromBuild(b, factsRes.facts, base.photos, { description: b.editorialSummary, goal: plan.goal, sample: b.source === 'mock', fetchedAt: now }), v: 1, id: newDraftId(), slug, businessKey: b.placeId, businessName: b.name, category: base.category, base, plan, appearance: appearance ?? {}, offerings, sitePlan, revision: 1, savedAt: now, createdAt: now, updatedAt: now, history: [], candidates: [] };
    await putDraft(d);
    draftId = d.id;
  }
  const totalMs = Date.now() - started;
  emit({ type: 'step', step: 'Done', status: 'done', ms: totalMs, note: model.urls.site });
  return {
    slug,
    siteUrl: model.urls.site,
    siteDir,
    themeId: entry.id,
    themeReason,
    business: { placeId: b.placeId, name: b.name, formattedAddress: b.formattedAddress, phone: b.phone, website: websiteUrl, rating: b.rating, reviewCount: b.reviewCount, primaryTypeLabel: b.primaryTypeLabel, source: b.source, identity: b.identity },
    brand,
    facts: { ...factStates(model.facts, { hoursKnown: !!b.hours?.periods?.length }), city: model.facts.city, state: model.facts.state, zip: model.facts.zip, serviceAreas: model.facts.serviceAreas, source: model.facts.source },
    extraction,
    review,
    brandProfile,
    serviceImages: serviceImgs?.records,
    services: model.services.items.map((s) => s.label),
    hiddenSections: model.hidden,
    audit: auditOut,
    cards,
    steps,
    totalMs,
    warnings: [...new Set(warnings)],
    mode: { mock: config.mock, claude: claudeEnabled(), claudeVia: claudeVia(), screenshot: shot, website: !!websiteUrl, audit: doAudit },
    design: planOut?.plan,
    personalise,
    draftId,
    newSite,
    pages: sitePlan?.pages.map((p) => p.route) ?? [''],
    photoTrace,
  };
}

/** Audit only (Roger step 2 when the client already has a site). */
export async function runAudit(input: { website: string; google?: string; placeId?: string }): Promise<{ audit: AuditResult; reportUrl: string; image: string; card: IMessageCard }> {
  // the site is read once and the business is identified from it, so the audit judges the site against the right name and town
  const scan = await scanWebsite(input.website);
  const b = await resolveBusiness({ google: input.google, placeId: input.placeId, website: input.website }, { scan }).catch(() => undefined);
  const audit = await auditWebsite(scan, b);
  const slug = slugify(`${b?.name || new URL(scan.finalUrl || scan.url).host} audit`);
  const rep = await writeReport(slug, audit, { businessName: b?.name });
  return { audit, reportUrl: rep.url, image: rep.image, card: auditCard(audit, rep.url, rep.image) };
}

/**
 * A website's own headline as a heading: its words unchanged, without the separators a page layout leaves at the ends
 * ("- Just Call Radiant -" → "Just Call Radiant"), which read as a typo once the words stand alone.
 */
export const tidyHeadline = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/^[\s\-–—|:•·~*]+|[\s\-–—|:•·~*]+$/g, '').trim();

/** The website and Google disagree: the phone (by number) or the address (by ZIP). Both values, for the owner. */
export function heldContacts(b: Pick<Business, 'phone' | 'formattedAddress'>, c: { phones: { primary?: string }; address?: { zip: string; formatted: string } }): { phone?: { google: string; website: string }; address?: { google: string; website: string } } {
  const out: ReturnType<typeof heldContacts> = {};
  if (c.phones.primary && b.phone && phoneKey(c.phones.primary) !== phoneKey(b.phone)) out.phone = { google: b.phone, website: c.phones.primary };
  if (c.address && b.formattedAddress && !b.formattedAddress.includes(c.address.zip)) out.address = { google: b.formattedAddress, website: c.address.formatted };
  return out;
}

const SCHEDULING = /\b(schedul\w*|book\w*|appointments?|reserv\w*)\b/i;
/** A button that opens the request form says so: scheduling words promise a booking flow it doesn't have. */
export const requestLabel = (label: string) => (SCHEDULING.test(label) ? 'Request an appointment' : label);

/** The website's main action on this site: its own words, unless they promise what the button can't do here. */
export function ctaFor(c: { label: string; kind: string; href: string }, verifiedBooking: boolean, phoneHeld: boolean): { label: string; to: 'phone' | 'form' | 'booking' | 'url'; href?: string } {
  if (c.kind === 'phone') return phoneHeld ? { label: 'Send a request', to: 'form' } : { label: c.label, to: 'phone' };
  if (verifiedBooking) return { label: c.label, to: 'booking' };
  if (c.kind === 'form' || c.kind === 'anchor') return { label: requestLabel(c.label), to: 'form' };
  // a link to a page on the old site that promises scheduling: the request form instead
  if (SCHEDULING.test(c.label)) return { label: 'Request an appointment', to: 'form' };
  return { label: c.label, to: 'url', href: c.kind === 'external' || c.kind === 'page' ? c.href : undefined };
}

/** A one-word label that names no service on its own ("Installation", "Maintenance", "Tankless"). */
const VAGUE = new Set(['installation', 'installations', 'install', 'installs', 'maintenance', 'repair', 'repairs', 'replacement', 'replacements', 'service', 'services', 'inspection', 'inspections', 'cleaning', 'tankless', 'upgrades', 'upgrade', 'emergency', 'commercial', 'residential', 'other', 'more', 'misc', 'general', 'consultation', 'estimates', 'estimate']);
export const vagueService = (name: string) => { const w = name.toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean); return w.length === 1 && VAGUE.has(w[0]); };

/** A service's picture fits when its own words (alt text, file name) name what the service is about. */
export function serviceImageFits(service: string, image: { alt?: string; url: string }): boolean {
  const generic = new Set(['service', 'services', 'repair', 'repairs', 'installation', 'replacement', 'maintenance', 'and', 'the', 'for', 'your']);
  const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !generic.has(w));
  const want = words(service);
  const have = words(`${image.alt ?? ''} ${decodeURIComponent(image.url.split('/').pop() ?? '').replace(/\.[a-z]+$/, '')}`);
  const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
  return want.some((w) => have.some((h) => near(w, h)));
}
