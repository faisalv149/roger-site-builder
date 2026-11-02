import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Business, Facts, Step, WebsiteScan } from './types.js';
import type { Theme } from './theme/schema.js';
import { getBusiness, searchCandidates } from './sources/places.js';
import { scanWebsite } from './sources/website.js';
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
import { estimateBuild } from './estimate.js';
import { persistDir } from './files.js';
import { detectVertical } from './theme/select.js';
import { findSavedPlan } from './store.js';
import { DIRECTION_LABEL, GOAL_LABEL, HERO_LABEL, validatePlan, type DesignPlan, type DesignPreferences, type Direction, type Goal } from './design/schema.js';
import { analyzePhotos, labelPhotos } from './design/photos.js';
import { designApplies, planDesign, validPhone, type Evidence, type PlanOutput } from './design/planner.js';
import { detectCategory, profileFor } from './design/categories.js';
import { offeringsFrom, type Offering } from './design/offerings.js';
import { toMeta, type PhotoInfo } from './design/photos.js';
import type { Appearance } from './design/schema.js';
import { composeModel, findDraft, newDraftId, putDraft, tokensFor, type DraftBase, type DraftRecord } from './drafts.js';

export interface BuildInput {
  /** Google Maps link, maps.app.goo.gl short link, place ID, or "Business name 78704" */
  google?: string;
  placeId?: string;
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
  business: Pick<Business, 'placeId' | 'name' | 'formattedAddress' | 'phone' | 'website' | 'rating' | 'reviewCount' | 'primaryTypeLabel'>;
  brand: SiteModel['brand'];
  facts: SiteModel['facts'];
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
function evidenceFor(theme: Theme, b: Business, facts: Facts): Evidence {
  const pr = (theme.sectionRules.proof || {}) as { minRating?: number; minReviews?: number };
  const ar = (theme.sectionRules.area || {}) as { maxPlaces?: number };
  return {
    showRating: (b.rating || 0) >= (pr.minRating ?? 4) && (b.reviewCount || 0) >= (pr.minReviews ?? 5),
    rating: b.rating,
    reviewCount: b.reviewCount,
    trust: facts.licensed || facts.insured || !!facts.years || facts.warranty,
    areas: [...new Set([facts.city, ...facts.serviceAreas, ...b.nearbyTowns].filter(Boolean) as string[])].slice(0, ar.maxPlaces ?? 8),
    address: b.formattedAddress,
  };
}

export async function resolveBusiness(input: { google?: string; placeId?: string }): Promise<Business> {
  if (input.placeId) {
    try {
      return await getBusiness(input.placeId);
    } catch (e) {
      // sample-data mode (MOCK=1) only knows the fixtures: a site built from live Google data can still be
      // rebuilt from the business data its draft saved; otherwise say what's going on
      if (!config.mock || input.placeId.startsWith('mock-')) throw e;
      const saved = await findDraft({ businessKey: input.placeId });
      if (saved?.base.business) return saved.base.business;
      throw new Error('This site was built from live Google data, but Roger is running on sample data (MOCK=1), so it cannot look the business up. Restart the server without MOCK=1 to rebuild it.');
    }
  }
  if (!input.google) throw new Error('Provide a Google Business link, place ID, or business name + ZIP.');
  const { candidates } = await searchCandidates(input.google, { limit: 1 });
  if (!candidates.length) throw new Error(`No Google Business match for "${input.google}"`);
  return getBusiness(candidates[0].placeId);
}

export async function buildSite(input: BuildInput, emit: Emit = () => {}): Promise<BuildResult> {
  const started = Date.now();
  const steps: Step[] = [];
  const warnings: string[] = [];

  // 1) Google Business
  const b = await timed(steps, emit, 'Google Business profile', () => resolveBusiness(input), (r) => `${r.name} · ${r.photos.length} photos · ${r.reviews.length} reviews`);
  const websiteUrl = input.website || b.website;

  // 2) Website scan (if any)
  let scan: WebsiteScan | undefined;
  if (websiteUrl) {
    scan = await timed(steps, emit, 'Scan existing website', () => scanWebsite(websiteUrl), (r) => (r.ok ? `${r.status} · ${Math.round(r.bytes / 1024)} KB · ${r.logoCandidates.length} logo candidates` : `unreachable: ${r.error || r.status}`));
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
    const usable = b.photos.filter((p) => p.width >= any.theme.images.minWidth && p.height >= any.theme.images.minHeight).length;
    const pick = selectTheme(b, prelim, usable, optIn ? {} : { themeId: input.themeId, vertical: input.vertical, variant: input.variant });
    entry = pick.entry;
    themeReason = optIn ? 'Personalised: Roger\'s design plan replaces the chosen theme (opted in)' : pick.reason;
    if (entry.vertical === 'general' && !input.themeId && !input.vertical) warnings.push(`No trade theme for Google category "${b.primaryTypeLabel || b.primaryType || 'unknown'}"; built with the general theme.`);
  }
  const theme = cloneTheme(entry.theme); // pulled colors are applied to this copy only
  const designOn = designApplies({ pilot: config.designPilot, manualTheme, optIn });
  const prefs = input.design?.preferences;
  emit({ type: 'step', step: `Theme: ${entry.name}`, status: 'done', note: themeReason });

  const slug = input.slug ? slugify(input.slug) : slugify(`${b.name} ${b.city || ''}`);
  const siteDir = path.join(config.dirs.sites, slug);
  const assetDir = path.join(siteDir, 'assets');
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(assetDir, { recursive: true });

  // 4) In parallel: photos (+ what they show, for design builds), logo, facts (Claude), audit
  const doAudit = input.audit !== false && !!scan;
  const photosP = timed(steps, emit, 'Process Google photos', () => processPhotos(b, theme, { outDir: assetDir, publicPrefix: 'assets' }), (r) => `${r.usable} usable · ${r.rejected.length} rejected`);
  // design builds: what each photo shows (vision / sample labels), while Claude reads the facts
  const labelsP = designOn
    ? photosP.then((p) => timed(steps, emit, 'Read photos', () => labelPhotos(p.items).catch(() => ({ kinds: p.items.map(() => 'unknown' as const), source: 'none' as const })),
        (r) => (r.source === 'vision' ? `${r.kinds.filter((k) => k !== 'unknown').length} labelled by Claude` : r.source === 'fixture' ? 'sample-data labels' : 'no labels: ranking by quality only')))
    : Promise.resolve(undefined);
  const designAsk = designOn ? { design: { style: prefs?.style, service: prefs?.service, goal: prefs?.goal } } : {};
  const [photos, logoRes, factsRes, audit, labels] = await Promise.all([
    photosP,
    timed(steps, emit, 'Find logo', () => pickLogo(scan, { outDir: assetDir, publicPrefix: 'assets', band: theme.palette.surface, maxHeightPx: theme.logo.maxHeight.desktop, minChroma: theme.brandColor.minChroma }), (r) => (r.logo ? `from ${r.logo.sourceUrl.split('/').pop()}` : 'none, using wordmark')),
    timed(steps, emit, claudeEnabled() ? 'Extract facts (Claude)' : 'Extract facts', () => extractFacts(b, theme, scan, designAsk), (r) => [r.facts.years && `${r.facts.years} yrs`, r.facts.licensed && 'licensed', r.facts.insured && 'insured', r.facts.emergency && 'emergency', r.facts.open24h && '24h'].filter(Boolean).join(', ') || 'no stated facts'),
    doAudit ? timed(steps, emit, 'Audit existing website', () => auditWebsite(scan!, b), (r) => `score ${r.score}/100 · ${r.issues.length} issues`) : Promise.resolve(undefined),
    labelsP,
  ]);
  for (const r of logoRes.rejected) warnings.push(`Logo candidate rejected: ${r.reason}`);
  for (const r of photos.rejected) warnings.push(`Photo rejected: ${r.reason}`);

  // 5) Services (before the design plan, which leads with one of them)
  const services = pickServices(theme, b, scan, factsRes.servicesMentioned, factsRes.serviceBlurbs, { emergencyOk: factsRes.facts.emergency || factsRes.facts.open24h, own: factsRes.services });
  emit({ type: 'step', step: 'Services', status: 'done', note: services.source === 'business' ? `${services.items.length} from the business's own website/reviews` : services.hidden ? 'none stated, section hidden' : `theme's standard list (${factsRes.services.length} own services found, need ${(theme.sectionRules.services as any)?.min ?? 3})` });
  const evidence = evidenceFor(theme, b, factsRes.facts);
  const personalise: PersonaliseInfo = {
    eligible: config.designPilot,
    reason: config.designPilot ? undefined : 'Personalisation is turned off (DESIGN_PILOT=0)',
    manualTheme: manualTheme && !optIn,
    suggestions: [...new Set(services.items.filter((s) => services.source === 'business' || (s.hits ?? 0) > 0).map((s) => s.label))].slice(0, 4),
    phoneOk: validPhone(b),
    emergencyVerified: factsRes.facts.open24h || factsRes.facts.emergency,
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
  const email = scan?.emails.find((e) => !/example|sentry|wixpress/.test(e));

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
      photos: infos.map(toMeta), evidence, advice: factsRes.design, currency,
    };
    planOut = planDesign({
      businessKey: b.placeId, business: b, facts: factsRes.facts, category, services: services.items, servicesSource: services.source, offerings, photos: infos, evidence,
      preferences: prefs, previous: previous?.ok ? previous.plan : undefined, alternative: input.design?.alternative, recent: savedDraft?.history, advice: factsRes.design,
      tokens: tokensFor(base),
    });
    const plan = planOut.plan;
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
    const previousContent = draft?.content ? mergeMedia(draft.content, contentFromBuild(b, factsRes.facts, base.photos, { sample: b.source === 'mock', fetchedAt: new Date().toISOString() })) : undefined;
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
  await timed(steps, emit, 'Render site', async () => {
    const files = renderSiteFiles(model, sitePlan, previewContext(slug, model.theme.locale.split('-')[0]));
    writeSiteFiles(siteDir, files);
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
    cards.push(noWebsiteCard(b.name, (await estimateBuild({ website: false, audit: false })).label));
  }
  cards.push(siteCard({ name: b.name, url: model.urls.site, image: shot ? `${model.urls.site}preview.jpg` : model.urls.og, hadWebsite: !!websiteUrl, personalisable: personalise.eligible && !personalise.manualTheme }));
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
    business: { placeId: b.placeId, name: b.name, formattedAddress: b.formattedAddress, phone: b.phone, website: websiteUrl, rating: b.rating, reviewCount: b.reviewCount, primaryTypeLabel: b.primaryTypeLabel },
    brand,
    facts: model.facts,
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
  };
}

/** Audit only (Roger step 2 when the client already has a site). */
export async function runAudit(input: { website: string; google?: string; placeId?: string }): Promise<{ audit: AuditResult; reportUrl: string; image: string; card: IMessageCard }> {
  const b = input.google || input.placeId ? await resolveBusiness(input).catch(() => undefined) : undefined;
  const scan = await scanWebsite(input.website);
  const audit = await auditWebsite(scan, b);
  const slug = slugify(`${b?.name || new URL(scan.finalUrl || scan.url).host} audit`);
  const rep = await writeReport(slug, audit, { businessName: b?.name });
  return { audit, reportUrl: rep.url, image: rep.image, card: auditCard(audit, rep.url, rep.image) };
}
