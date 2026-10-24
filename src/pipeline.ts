import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Business, Step, WebsiteScan } from './types.js';
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
import { writeReport } from './audit/report.js';
import { auditCard, noWebsiteCard, siteCard, type IMessageCard } from './imessage/cards.js';
import { slugify } from './util/text.js';
import { claudeEnabled, claudeVia } from './content/claude.js';
import { estimateBuild } from './estimate.js';
import { persistDir } from './files.js';

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

export async function resolveBusiness(input: { google?: string; placeId?: string }): Promise<Business> {
  if (input.placeId) return getBusiness(input.placeId);
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

  // 3) Theme
  let entry: ThemeEntry;
  let themeReason: string;
  if (input.theme) {
    const v = validateTheme(input.theme);
    if (!v.ok || !v.theme || !v.id) throw new Error(`Invalid theme.json: ${v.errors.slice(0, 5).join('; ')}`);
    entry = { id: v.id, vertical: v.theme.meta.vertical, variant: v.theme.meta.variant, name: v.theme.meta.name, file: '(upload)', origin: 'custom', theme: v.theme, warnings: v.warnings };
    themeReason = 'Uploaded theme.json';
    warnings.push(...v.warnings);
  } else {
    const prelim = heuristicFacts(b, scan);
    const any = getTheme(input.themeId || '') || [...(await import('./theme/load.js')).loadThemes().values()][0];
    const usable = b.photos.filter((p) => p.width >= any.theme.images.minWidth && p.height >= any.theme.images.minHeight).length;
    const pick = selectTheme(b, prelim, usable, { themeId: input.themeId, vertical: input.vertical, variant: input.variant });
    entry = pick.entry;
    themeReason = pick.reason;
    if (entry.vertical === 'general' && !input.themeId && !input.vertical) warnings.push(`No trade theme for Google category "${b.primaryTypeLabel || b.primaryType || 'unknown'}"; built with the general theme.`);
  }
  const theme = cloneTheme(entry.theme); // pulled colors are applied to this copy only
  emit({ type: 'step', step: `Theme: ${entry.name}`, status: 'done', note: themeReason });

  const slug = input.slug ? slugify(input.slug) : slugify(`${b.name} ${b.city || ''}`);
  const siteDir = path.join(config.dirs.sites, slug);
  const assetDir = path.join(siteDir, 'assets');
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(assetDir, { recursive: true });

  // 4) In parallel: photos, logo, facts (Claude), audit
  const doAudit = input.audit !== false && !!scan;
  const [photos, logoRes, factsRes, audit] = await Promise.all([
    timed(steps, emit, 'Process Google photos', () => processPhotos(b, theme, { outDir: assetDir, publicPrefix: 'assets' }), (r) => `${r.usable} usable · ${r.rejected.length} rejected`),
    timed(steps, emit, 'Find logo', () => pickLogo(scan, { outDir: assetDir, publicPrefix: 'assets', band: theme.palette.surface, maxHeightPx: theme.logo.maxHeight.desktop, minChroma: theme.brandColor.minChroma }), (r) => (r.logo ? `from ${r.logo.sourceUrl.split('/').pop()}` : 'none, using wordmark')),
    timed(steps, emit, claudeEnabled() ? 'Extract facts (Claude)' : 'Extract facts', () => extractFacts(b, theme, scan), (r) => [r.facts.years && `${r.facts.years} yrs`, r.facts.licensed && 'licensed', r.facts.insured && 'insured', r.facts.emergency && 'emergency', r.facts.open24h && '24h'].filter(Boolean).join(', ') || 'no stated facts'),
    doAudit ? timed(steps, emit, 'Audit existing website', () => auditWebsite(scan!, b), (r) => `score ${r.score}/100 · ${r.issues.length} issues`) : Promise.resolve(undefined),
  ]);
  for (const r of logoRes.rejected) warnings.push(`Logo candidate rejected: ${r.reason}`);
  for (const r of photos.rejected) warnings.push(`Photo rejected: ${r.reason}`);

  // 5) Brand color (logo → website → theme default), fonts
  const brand = resolveBrand(theme, { logo: logoRes.logo, scan, override: input.brandColor });
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

  // 6) Content model
  const services = pickServices(theme, b, scan, factsRes.servicesMentioned, factsRes.serviceBlurbs, { emergencyOk: factsRes.facts.emergency || factsRes.facts.open24h, own: factsRes.services });
  emit({ type: 'step', step: 'Services', status: 'done', note: services.source === 'business' ? `${services.items.length} from the business's own website/reviews` : services.hidden ? 'none stated, section hidden' : `theme's standard list (${factsRes.services.length} own services found, need ${(theme.sectionRules.services as any)?.min ?? 3})` });
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
  const model = buildModel({
    slug, themeId: entry.id, theme, business: b, facts: factsRes.facts, brand, brandText: brandTextOnSurface(brand, theme),
    services, hero, gallery: photos.gallery, fonts, socials: scan?.socials || [],
    email: scan?.emails.find((e) => !/example|sentry|wixpress/.test(e)), baseUrl: config.publicBaseUrl, preview: input.preview !== false,
  });
  if (!photos.hero) model.images.heroIsStock = true;
  warnings.push(...model.warnings);

  // 7) Render + share assets
  await timed(steps, emit, 'Render site', async () => {
    const html = renderPage(model);
    fs.writeFileSync(path.join(siteDir, 'index.html'), html);
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

  // 8) Audit report + iMessage cards
  const cards: IMessageCard[] = [];
  let auditOut: BuildResult['audit'];
  if (audit) {
    const rep = await writeReport(slug, audit, { businessName: b.name, siteUrl: model.urls.site });
    auditOut = { ...audit, reportUrl: rep.url, image: rep.image };
    cards.push(auditCard(audit, rep.url, rep.image));
  } else if (!websiteUrl) {
    cards.push(noWebsiteCard(b.name, (await estimateBuild({ website: false, audit: false })).label));
  }
  cards.push(siteCard({ name: b.name, url: model.urls.site, image: shot ? `${model.urls.site}preview.jpg` : model.urls.og, hadWebsite: !!websiteUrl }));
  if (shot && model.preview) {
    // For preview links sent to the owner, show the real design in the iMessage rich card.
    const f = path.join(siteDir, 'index.html');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(`content="${model.urls.og}"`, `content="${model.urls.site}preview.jpg"`));
  }

  await persistDir(siteDir); // on Vercel: copy the finished site to Redis so any server instance can serve it
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
