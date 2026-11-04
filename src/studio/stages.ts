import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { config } from '../config.js';
import type { Business, BusinessCandidate } from '../types.js';
import { getBusiness, searchCandidates } from '../sources/places.js';
import { candidateOf, identityQueries, matchCandidate, sourceView, type Match } from '../sources/identity.js';
import { rankCandidates } from '../sources/resolve.js';
import { extractSiteContent, imageKey } from '../sources/site-content.js';
import { normalizeUrl } from '../util/http.js';
import { measureBrand, renderPage } from '../sources/render-page.js';
import { screenshotsAvailable } from '../render/og.js';
import { fetchPatiently, fingerprint, looksLikeArtwork, sizedUrl } from '../sources/site-images.js';
import { logoCandidatesOf } from '../sources/website.js';
import { dominantColors } from '../sources/brand-profile.js';
import { canonicalUrl, fetchWithRetry, isDisallowed, isLegal, isPost, priorityOf, readRobots, readSitemaps, skipReason, urlKey } from './discover.js';
import { looksScriptBuilt } from './extract.js';
import { graphicKind } from '../design/image-fit.js';
import { getBody, putBody, sha256, snapshotIdOf, type AssetProbe, type DiscoveredUrl, type DocumentSnapshot, type IdentitySnapshot, type ListingSnapshot, type LogoProbe, type SnapshotPage, type SourceSnapshot } from './snapshot.js';
import { PDF_PRIORITY, isBusinessCritical, pdfKind, readPdf, tesseractOcr, type Ocr } from './pdf.js';

/**
 * The fetching stages of a studio job. Each one reads and writes the job's work document (what has been fetched so
 * far), so a job that stops part-way resumes where it was: pages already read are not fetched again.
 */
export interface Work {
  jobId: string;
  input: { website?: string; google?: string; fromSnapshot?: string };
  identity?: IdentitySnapshot;
  listing?: ListingSnapshot;
  robots?: SourceSnapshot['robots'];
  sitemaps?: SourceSnapshot['sitemaps'];
  budget: SourceSnapshot['budget'];
  discovery: DiscoveredUrl[];
  pages: Record<string, SnapshotPage>;
  stylesheets: Record<string, SourceSnapshot['stylesheets'][number]>;
  documents?: Record<string, DocumentSnapshot>;
  assets: Record<string, AssetProbe>;
  brand?: SourceSnapshot['brand'];
  snapshotId?: string;
}
export interface StageCtx {
  work: Work;
  save(): Promise<void>;
  progress(done: number, total: number, note?: string): void;
  note(text: string): void;
  /** tests: called after each page is saved (throwing here simulates the process stopping) */
  afterPage?(count: number): void | Promise<void>;
}

export const budgetFromEnv = (): Work['budget'] => ({ maxPages: Number(process.env.STUDIO_MAX_PAGES ?? 20), maxDepth: Number(process.env.STUDIO_MAX_DEPTH ?? 2) });
const MAX_RENDERS = () => Number(process.env.STUDIO_MAX_RENDERS ?? 3);
const MAX_ASSETS = () => Number(process.env.STUDIO_MAX_ASSETS ?? 40);

function listingOf(b: Business): ListingSnapshot {
  return {
    placeId: b.placeId, name: b.name, primaryType: b.primaryType, primaryTypeLabel: b.primaryTypeLabel, types: b.types, formattedAddress: b.formattedAddress,
    street: b.street, city: b.city, state: b.state, zip: b.zip, phone: b.phone, website: b.website, mapsUrl: b.mapsUrl, rating: b.rating, reviewCount: b.reviewCount,
    businessStatus: b.businessStatus, editorialSummary: b.editorialSummary, lat: b.lat, lng: b.lng, hours: b.hours?.weekdayText,
    // Google's photo names expire and may not be stored, nor may their credits (Maps Platform terms): only each photo's
    // place in the listing and its size are kept; the image and its credit are fetched fresh when a preview is shown
    photos: (b.photos || []).filter((p) => p.source !== 'website').map((p, n) => ({ ref: `#${n}`, width: p.width, height: p.height, authors: [], isOwner: !!p.isOwner })),
  };
}

/** Saves one fetched page (its body content-addressed) into the work document. */
async function recordPage(ctx: StageCtx, url: string, r: Awaited<ReturnType<typeof fetchWithRetry>>, opts: { allowRender?: boolean } = {}): Promise<SnapshotPage> {
  const { res, attempts } = r;
  const type = res.headers['content-type'] || '';
  let page: SnapshotPage;
  if (!res.ok) page = { url, finalUrl: res.url, status: 'failed', httpStatus: res.status || undefined, attempts, error: res.error || `HTTP ${res.status}` };
  else if (type && !/html|xml/i.test(type)) page = { url, finalUrl: res.url, status: 'skipped', httpStatus: res.status, attempts, contentType: type.split(';')[0], error: `not a web page (${type.split(';')[0]})` };
  else {
    let html = res.body.toString('utf8');
    let rendered = false;
    const renders = Object.values(ctx.work.pages).filter((p) => p.rendered).length;
    if (opts.allowRender !== false && looksScriptBuilt(html) && renders < MAX_RENDERS() && screenshotsAvailable() && process.env.STUDIO_RENDER !== '0') {
      const out = await renderPage(res.url).catch((e) => ({ ok: false, html: undefined, ms: 0, error: (e as Error).message }));
      if (out.ok && out.html && out.html.length > html.length) { html = out.html; rendered = true; }
      else if (!out.ok) ctx.note(`Could not run the scripts of ${url}: ${out.error}`);
    }
    page = { url, finalUrl: res.url, status: rendered ? 'rendered' : 'read', httpStatus: res.status, attempts, contentType: type.split(';')[0] || 'text/html', bodyHash: await putBody(html), bytes: Buffer.byteLength(html), rendered: rendered || undefined };
  }
  ctx.work.pages[urlKey(url)] = page;
  await ctx.save();
  return page;
}

// ───────────────────────── 1. identity ─────────────────────────
export async function identityStage(ctx: StageCtx): Promise<void> {
  const w = ctx.work;
  const notes: string[] = [];
  const rejected: IdentitySnapshot['rejected'] = [];
  if (w.input.website) {
    const home = normalizeUrl(w.input.website);
    const page = w.pages[urlKey(home)] ?? (await recordPage(ctx, home, await fetchWithRetry(home), { allowRender: true }));
    if (page.status === 'failed') throw new Error(`The website did not load (${page.error}) after ${page.attempts} attempts.`);
    const html = (await getBody(page.bodyHash))!;
    const content = extractSiteContent(html, page.finalUrl || home);
    const src = content.identity.name ? sourceView(content) : undefined;
    let listing: Business | undefined;
    let match: Match | undefined;
    if (src) {
      const seen = new Set<string>();
      for (const q of identityQueries(src, content.address?.zip)) {
        let found: Awaited<ReturnType<typeof searchCandidates>>;
        try { found = await searchCandidates(q, { limit: 5 }); } catch (e) { notes.push(`Google search failed (${(e as Error).message.slice(0, 80)}).`); break; }
        const fresh = found.candidates.filter((c) => !seen.has(c.placeId));
        fresh.forEach((c) => seen.add(c.placeId));
        const ranked = rankCandidates(fresh, src);
        for (const r of [...found.rejected, ...ranked.rejected]) if (!rejected.some((x) => x.placeId === r.placeId)) rejected.push(r);
        const best = ranked.ranked.find((c) => c.match.verdict === 'verified') ?? ranked.ranked.find((c) => c.match.verdict === 'probable');
        if (best) { listing = await getBusiness(best.placeId, { skipTowns: true }); match = best.match; break; }
      }
    } else notes.push('The website names no business, so no Google listing could be matched to it.');
    w.listing = listing ? listingOf(listing) : undefined;
    w.identity = {
      route: 'website', status: listing ? (match!.verdict === 'verified' ? 'verified' : 'probable') : 'website-only',
      evidence: listing ? match!.evidence : [`the website names the business "${content.identity.name || 'unknown'}"`],
      rejected, notes: listing ? notes : [...notes, 'No Google listing matched the website; the brief uses the website alone.'],
      homeUrl: page.finalUrl || home, placeId: listing?.placeId,
    };
  } else if (w.input.google) {
    const found = await searchCandidates(w.input.google, { limit: 5 });
    rejected.push(...found.rejected);
    const pick: BusinessCandidate | undefined = found.candidates[0];
    if (!pick) throw new Error(found.rejected[0] ? `Google's result "${found.rejected[0].name}" is not a business: ${found.rejected[0].reason}.` : 'Google found no business for that link or address.');
    const listing = await getBusiness(pick.placeId, { skipTowns: true });
    w.listing = listingOf(listing);
    const evidence = [found.intent.kind === 'placeId' ? 'the link names this Google listing' : `Google's best match for "${w.input.google}"`];
    let status: IdentitySnapshot['status'] = found.intent.kind === 'placeId' ? 'probable' : 'unverified';
    let homeUrl: string | undefined;
    if (listing.website) {
      // the listing names a website: read its home page and hold the listing to it, as on the website route
      let home: string | undefined;
      try { home = normalizeUrl(listing.website); } catch { notes.push(`The listing's website "${listing.website}" is not a valid address.`); }
      if (home) {
        const page = w.pages[urlKey(home)] ?? (await recordPage(ctx, home, await fetchWithRetry(home), { allowRender: true }));
        if (page.status === 'failed') notes.push(`The listing's website (${home}) did not load: ${page.error}.`);
        else {
          const content = extractSiteContent((await getBody(page.bodyHash))!, page.finalUrl || home);
          const src = content.identity.name ? sourceView(content) : undefined;
          const m = matchCandidate(candidateOf(listing), src);
          if (m.verdict === 'rejected') notes.push(`The listing's website does not match the listing (${m.reason}); it is not read.`);
          else { homeUrl = page.finalUrl || home; status = m.verdict === 'verified' ? 'verified' : 'probable'; evidence.push(...m.evidence); }
        }
      }
    } else notes.push('The Google listing names no website: services, brand and story are unknown until the owner answers.');
    w.identity = { route: 'google', status, evidence, rejected, notes, homeUrl, placeId: listing.placeId };
  } else throw new Error('Give a website address, or a Google Business Profile link or address.');
  for (const n of w.identity.notes) ctx.note(n);
  await ctx.save();
}

// ───────────────────────── 2. page inventory ─────────────────────────
const linksOf = (html: string, base: string, origin: string) => {
  const $ = cheerio.load(html);
  const nav = new Set<string>();
  const all = new Set<string>();
  const anchors = new Map<string, string>();
  $('a[href]').each((_, a) => {
    const c = canonicalUrl($(a).attr('href') || '', base, origin);
    if (!c) return;
    all.add(c.toString());
    const words = ($(a).text() || $(a).attr('aria-label') || $(a).attr('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (words && !anchors.has(c.toString())) anchors.set(c.toString(), words);
    if ($(a).closest('nav, header, .menu, .navbar, #menu').length) nav.add(c.toString());
  });
  return { nav: [...nav], all: [...all], anchors };
};

function addCandidate(w: Work, raw: string, via: DiscoveredUrl['via'][number], depth: number, from: string | undefined, origin: string, disallow: string[], anchor?: string) {
  const c = canonicalUrl(raw, origin, origin);
  if (!c) return;
  const key = urlKey(c.toString());
  let d = w.discovery.find((x) => urlKey(x.url) === key);
  if (d) {
    if (!d.via.includes(via)) d.via.push(via);
    if (from && !d.linkedFrom.includes(from)) d.linkedFrom.push(from);
    if (anchor && !d.anchor) d.anchor = anchor;
    d.depth = Math.min(d.depth, depth);
    d.priority = Math.min(d.priority, priorityOf(c, d.via));
    return;
  }
  // a linked PDF is a document: the documents stage decides whether to read it, within its own budget
  const pdf = /\.pdf$/i.test(c.pathname) && !isDisallowed(c.pathname, disallow);
  const skip = pdf ? undefined : skipReason(c) ?? (isDisallowed(c.pathname, disallow) ? 'robots.txt asks crawlers not to read it' : undefined);
  d = { url: c.toString(), via: [via], depth, linkedFrom: from ? [from] : [], ...(anchor ? { anchor } : {}), decision: pdf ? 'document' : skip ? 'skip' : 'crawl', reason: skip, priority: priorityOf(c, [via]) };
  w.discovery.push(d);
}

/** Decide which of the discovered pages are read: by priority within the page budget; posts and legal pages are capped. */
function applyBudget(w: Work) {
  const crawlable = w.discovery.filter((d) => d.decision !== 'document' && (!d.reason || /budget|posts|legal page/.test(d.reason))).sort((a, b) => a.depth - b.depth || a.priority - b.priority || a.url.localeCompare(b.url));
  let n = 0, posts = 0;
  for (const d of crawlable) {
    const path = new URL(d.url).pathname;
    if (d.depth > w.budget.maxDepth) { d.decision = 'skip'; d.reason = `deeper than ${w.budget.maxDepth} links from the home page`; continue; }
    if (isLegal(path)) { d.decision = 'skip'; d.reason = 'a legal page (privacy, terms): not business content'; continue; }
    if (isPost(path) && ++posts > 3) { d.decision = 'skip'; d.reason = 'a blog post beyond the first 3 (posts say little about the business itself)'; continue; }
    if (w.pages[urlKey(d.url)]) { d.decision = 'crawl'; d.reason = undefined; n++; continue; }
    if (n >= w.budget.maxPages) { d.decision = 'skip'; d.reason = `over the page budget (${w.budget.maxPages} pages)`; continue; }
    d.decision = 'crawl'; d.reason = undefined; n++;
  }
}

export async function inventoryStage(ctx: StageCtx): Promise<void> {
  const w = ctx.work;
  const home = w.identity?.homeUrl;
  if (!home) { w.robots = { found: false, disallow: [], sitemaps: [] }; w.sitemaps = []; ctx.note('No website to read.'); await ctx.save(); return; }
  const origin = new URL(home).origin;
  w.robots = await readRobots(origin);
  const sm = await readSitemaps(origin, w.robots.sitemaps);
  w.sitemaps = sm.read;
  const homePage = w.pages[urlKey(home)] ?? Object.values(w.pages).find((p) => p.finalUrl === home);
  addCandidate(w, home, w.identity!.route === 'google' ? 'listing' : 'input', 0, undefined, origin, w.robots.disallow);
  const homeHtml = homePage ? await getBody(homePage.bodyHash) : undefined;
  if (homeHtml) {
    const l = linksOf(homeHtml, home, origin);
    for (const u of l.nav) addCandidate(w, u, 'nav', 1, home, origin, w.robots.disallow, l.anchors.get(u));
    for (const u of l.all) addCandidate(w, u, 'link', 1, home, origin, w.robots.disallow, l.anchors.get(u));
  }
  for (const u of sm.urls) addCandidate(w, u, 'sitemap', 1, undefined, origin, w.robots.disallow);
  applyBudget(w);
  const toRead = w.discovery.filter((d) => d.decision === 'crawl').length;
  ctx.note(`${w.discovery.length} addresses found (${sm.urls.length} from ${sm.read.filter((s) => s.status === 'read').length} sitemap(s)); ${toRead} to read within the budget of ${w.budget.maxPages}.`);
  await ctx.save();
}

// ───────────────────────── 3. crawl ─────────────────────────
export async function crawlStage(ctx: StageCtx): Promise<void> {
  const w = ctx.work;
  const home = w.identity?.homeUrl;
  if (!home) { ctx.note('No website to read.'); return; }
  const origin = new URL(home).origin;
  let count = Object.keys(w.pages).length;
  for (;;) {
    const next = w.discovery.filter((d) => d.decision === 'crawl' && !w.pages[urlKey(d.url)]).sort((a, b) => a.depth - b.depth || a.priority - b.priority || a.url.localeCompare(b.url));
    const total = w.discovery.filter((d) => d.decision === 'crawl').length;
    ctx.progress(total - next.length, total, next[0] ? `reading ${new URL(next[0].url).pathname}` : undefined);
    if (!next.length) break;
    const batch = next.slice(0, 2);
    await Promise.all(batch.map(async (d) => {
      const page = await recordPage(ctx, d.url, await fetchWithRetry(d.url));
      if ((page.status === 'read' || page.status === 'rendered') && d.depth < w.budget.maxDepth) {
        const html = await getBody(page.bodyHash);
        if (html) { const l = linksOf(html, page.finalUrl || d.url, origin); for (const u of l.all) addCandidate(w, u, 'link', d.depth + 1, d.url, origin, w.robots?.disallow ?? [], l.anchors.get(u)); }
      }
    }));
    applyBudget(w);
    await ctx.save();
    count += batch.length;
    await ctx.afterPage?.(count);
    await new Promise((r) => setTimeout(r, Number(process.env.STUDIO_PAGE_DELAY_MS ?? 150)));
  }
  // the stylesheets the pages link (for fonts and colours), each fetched once
  const sheets = new Set<string>();
  for (const p of Object.values(w.pages)) {
    if (p.status !== 'read' && p.status !== 'rendered') continue;
    const $ = cheerio.load((await getBody(p.bodyHash)) || '');
    $('link[rel="stylesheet"]').each((_, el) => { try { const u = new URL($(el).attr('href') || '', p.finalUrl || p.url).toString(); if (!/fonts\.googleapis|font-awesome|fontawesome|bootstrap(\.min)?\.css|jquery|dashicons/i.test(u)) sheets.add(u); } catch { /* skip */ } });
  }
  for (const u of [...sheets].sort().slice(0, 8)) {
    if (w.stylesheets[u]) continue;
    const { res } = await fetchWithRetry(u, { timeoutMs: 8000, maxBytes: 1_500_000, attempts: 2 });
    w.stylesheets[u] = { url: u, ok: res.ok, status: res.status || undefined, bodyHash: res.ok ? await putBody(res.body.toString('utf8')) : undefined };
  }
  // what this stage did; the coverage counts (read, skipped, failed) are the inventory's, reported by the brief stage
  const pages = Object.values(w.pages);
  ctx.note(`fetched ${pages.length} pages (${pages.filter((p) => p.rendered).length} read again after running their scripts)`);
  await ctx.save();
}

// ───────────────────────── 3b. documents ─────────────────────────
const MAX_PDFS = () => Number(process.env.STUDIO_MAX_PDFS ?? 4);
const MAX_PDF_BYTES = () => Number(process.env.STUDIO_MAX_PDF_BYTES ?? 25_000_000);
const MAX_PDF_PAGES = () => Number(process.env.STUDIO_MAX_PDF_PAGES ?? 12);
const MAX_OCR_PAGES = () => Number(process.env.STUDIO_MAX_OCR_PAGES ?? 6);

/**
 * Linked PDFs that say what the business sells or costs (menus, price lists, service brochures), read within a budget:
 * at most STUDIO_MAX_PDFS documents, STUDIO_MAX_PDF_BYTES each, STUDIO_MAX_PDF_PAGES pages each, and
 * STUDIO_MAX_OCR_PAGES pages of OCR across the job. Every PDF found is recorded, read or not, with the reason.
 */
export async function documentsStage(ctx: StageCtx, opts: { ocr?: Ocr } = {}): Promise<void> {
  const w = ctx.work;
  w.documents ??= {};
  const found = w.discovery.filter((d) => d.decision === 'document');
  if (!found.length) { ctx.note('No linked PDFs.'); await ctx.save(); return; }
  const ranked = found.map((d) => ({ d, kind: pdfKind(d.url, d.anchor) }))
    .sort((a, b) => PDF_PRIORITY[a.kind] - PDF_PRIORITY[b.kind] || b.d.linkedFrom.length - a.d.linkedFrom.length || a.d.url.localeCompare(b.d.url));
  const chosen = ranked.filter((r) => isBusinessCritical(r.kind)).slice(0, MAX_PDFS());
  const base = (r: (typeof ranked)[number]): DocumentSnapshot => ({ url: r.d.url, kind: r.kind, anchor: r.d.anchor, linkedFrom: [...r.d.linkedFrom].sort(), status: 'skipped', attempts: 0 });
  for (const r of ranked) if (!chosen.includes(r) && !w.documents[r.d.url]) w.documents[r.d.url] = { ...base(r), reason: isBusinessCritical(r.kind) ? `over the document budget (${MAX_PDFS()} PDFs)` : 'a PDF that does not look like a menu, price list or service document' };
  const ocrBudget = { pages: MAX_OCR_PAGES() - Object.values(w.documents).reduce((s, x) => s + (x.methods ? x.methods.ocr + x.methods.textAndOcr : 0), 0) };
  let engine: Awaited<ReturnType<typeof tesseractOcr>> | undefined;
  const ocr: Ocr | undefined = opts.ocr ?? (process.env.STUDIO_OCR === '0' ? undefined : async (png) => { engine ??= await tesseractOcr(); return engine.ocr(png); });
  try {
    let done = 0;
    for (const r of chosen) {
      ctx.progress(done, chosen.length, `reading ${decodeURIComponent(r.d.url.split('/').pop() || '')}`);
      const prev = w.documents[r.d.url];
      if (prev && prev.status !== 'skipped') { done++; continue; } // read (or failed) before a resume
      const { res, attempts } = await fetchWithRetry(r.d.url, { timeoutMs: 60_000, maxBytes: MAX_PDF_BYTES() + 1, attempts: 3 });
      const doc: DocumentSnapshot = { ...base(r), attempts, httpStatus: res.status || undefined };
      const declared = Number(res.headers['content-length'] || 0);
      if (!res.ok) Object.assign(doc, { status: 'failed', reason: res.error || `HTTP ${res.status}` });
      else if (declared > MAX_PDF_BYTES() || res.truncated || res.body.length > MAX_PDF_BYTES()) Object.assign(doc, { status: 'skipped', reason: `larger than the ${Math.round(MAX_PDF_BYTES() / 1e6)} MB document limit`, ...(declared ? { bytes: declared } : {}) });
      else if (res.body.subarray(0, 5).toString('latin1') !== '%PDF-') Object.assign(doc, { status: 'failed', reason: `not a PDF (${(res.headers['content-type'] || 'unknown type').split(';')[0]})` });
      else {
        try {
          const x = await readPdf(new Uint8Array(res.body), { maxPages: MAX_PDF_PAGES(), ocrBudget, ocr });
          const m = { text: 0, ocr: 0, textAndOcr: 0, unread: 0 };
          for (const p of x.pages) { if (p.method === 'text') m.text++; else if (p.method === 'ocr') m.ocr++; else if (p.method === 'text+ocr') m.textAndOcr++; else m.unread++; }
          const confs = x.pages.filter((p) => p.ocrConfidence !== undefined).map((p) => p.ocrConfidence!);
          Object.assign(doc, {
            status: 'read', bytes: res.body.length, sha256: sha256(res.body), totalPages: x.totalPages, pagesRead: x.pages.length, methods: m,
            ...(confs.length ? { ocrConfidence: Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) } : {}),
            extractionHash: await putBody(JSON.stringify(x)),
            reason: x.truncated ? `only the first ${x.pages.length} of ${x.totalPages} pages were read (page limit)` : m.unread ? `${m.unread} page(s) without a usable text layer were not read (${ocr ? 'OCR budget' : 'OCR unavailable'})` : undefined,
          });
        } catch (e) { Object.assign(doc, { status: 'failed', reason: `could not open the PDF: ${(e as Error).message.slice(0, 120)}`, bytes: res.body.length }); }
      }
      w.documents[r.d.url] = doc;
      await ctx.save();
      done++;
    }
    ctx.progress(chosen.length, chosen.length);
  } finally { await engine?.close(); }
  const docs = Object.values(w.documents);
  ctx.note(`${docs.length} linked PDF(s): ${docs.filter((x) => x.status === 'read').length} read, ${docs.filter((x) => x.status === 'failed').length} failed, ${docs.filter((x) => x.status === 'skipped').length} not read`);
}

// ───────────────────────── 4. assets ─────────────────────────
export async function assetsStage(ctx: StageCtx): Promise<void> {
  const w = ctx.work;
  const wanted = new Map<string, { url: string; rank: number }>();
  for (const p of Object.values(w.pages).sort((a, b) => a.url.localeCompare(b.url))) {
    if (p.status !== 'read' && p.status !== 'rendered') continue;
    const c = extractSiteContent((await getBody(p.bodyHash)) || '', p.finalUrl || p.url, { rendered: p.rendered });
    const serviceImgs = new Set(c.services.filter((s) => s.image).map((s) => imageKey(s.image!.url)));
    for (const im of c.images) {
      if (im.role === 'icon' || im.role === 'social' || im.role === 'logo') continue;
      // icons and graphics recognisable by their file name are not worth a download
      if (graphicKind(im.url, { width: 999, height: 999 })) continue;
      const rank = serviceImgs.has(im.key) ? 0 : im.role === 'hero' ? 1 : im.role === 'content' || im.role === 'team' ? 2 : 3;
      const cur = wanted.get(im.key);
      if (!cur || rank < cur.rank) wanted.set(im.key, { url: im.url, rank });
    }
  }
  const list = [...wanted.values()].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url)).slice(0, MAX_ASSETS());
  let done = 0;
  for (const it of list) {
    ctx.progress(done, list.length, `measuring ${it.url.split('/').pop()?.slice(0, 40)}`);
    if (!w.assets[it.url]) {
      const r = await fetchPatiently([...new Set([sizedUrl(it.url), it.url])], { timeoutMs: 15000, maxBytes: 20_000_000 }, 3);
      let probe: AssetProbe = { url: it.url, ok: false, status: r.status || undefined, error: r.ok ? undefined : r.error || `HTTP ${r.status}` };
      if (r.ok) {
        try {
          const meta = await sharp(r.body).metadata();
          probe = { url: it.url, ok: true, status: r.status, width: meta.width, height: meta.height, format: meta.format, bytes: r.body.length, sha256: sha256(r.body), artwork: await looksLikeArtwork(r.body), dhash: (await fingerprint(r.body)).toString(16).padStart(16, '0') };
        } catch (e) { probe = { url: it.url, ok: false, status: r.status, error: `could not decode: ${(e as Error).message.slice(0, 60)}` }; }
      }
      w.assets[it.url] = probe;
      await ctx.save();
    }
    done++;
  }
  ctx.progress(list.length, list.length);
  // what this stage did; how the pictures came out (usable, icons, over budget) is the inventory's count
  ctx.note(`downloaded ${Object.values(w.assets).filter((a) => a.ok).length} pictures (${Object.values(w.assets).filter((a) => !a.ok).length} downloads failed); budget ${MAX_ASSETS()}`);
}

// ───────────────────────── 5. brand ─────────────────────────
export async function brandStage(ctx: StageCtx): Promise<void> {
  const w = ctx.work;
  const home = w.identity?.homeUrl;
  if (!home) { w.brand = { status: 'skipped', reason: 'no website: the brand is unknown until the owner answers', logo: [] }; await ctx.save(); return; }
  const homePage = w.pages[urlKey(home)];
  const html = homePage ? await getBody(homePage.bodyHash) : undefined;
  const logo: LogoProbe[] = [];
  if (html) {
    for (const cand of logoCandidatesOf(cheerio.load(html), home).filter((c) => !/\.ico(\?|$)/i.test(c.url)).slice(0, 4)) {
      const r = await fetchPatiently([cand.url], { timeoutMs: 8000, maxBytes: 4_000_000 }, 2);
      if (!r.ok) { logo.push({ url: cand.url, ok: false, reason: r.error || `HTTP ${r.status}`, colors: [] }); continue; }
      try {
        const meta = await sharp(r.body, { density: 150 }).metadata();
        logo.push({ url: cand.url, ok: true, reason: cand.reason, width: meta.width, height: meta.height, format: meta.format, colors: await dominantColors(r.body).catch(() => []) });
        if (logo.filter((l) => l.ok).length >= 2) break;
      } catch (e) { logo.push({ url: cand.url, ok: false, reason: `could not decode: ${(e as Error).message.slice(0, 60)}`, colors: [] }); }
    }
  }
  let raw: SourceSnapshot['brand']['raw'];
  let status: SourceSnapshot['brand']['status'] = 'skipped';
  let reason: string | undefined;
  if (process.env.BRAND_MEASURE === '0' || !screenshotsAvailable()) reason = 'no browser here: colours come from the stylesheets and the logo';
  else {
    raw = await measureBrand(home).catch(() => undefined);
    status = raw ? 'measured' : 'failed';
    if (!raw) reason = 'the page could not be measured in a browser';
  }
  w.brand = { status, reason, raw, logo };
  if (reason) ctx.note(reason);
  await ctx.save();
}

/** The snapshot from the finished fetching stages: sorted, so the same content always gives the same id. */
export function snapshotFromWork(w: Work, capturedAt: string): SourceSnapshot {
  const body: Omit<SourceSnapshot, 'id' | 'capturedAt'> = {
    schema: 'roger.source-snapshot', version: 1,
    input: { website: w.input.website, google: w.input.google },
    identity: w.identity!,
    listing: w.listing,
    robots: w.robots ?? { found: false, disallow: [], sitemaps: [] },
    sitemaps: [...(w.sitemaps ?? [])].sort((a, b) => a.url.localeCompare(b.url)),
    budget: w.budget,
    discovery: [...w.discovery].map((d) => ({ ...d, via: [...d.via].sort(), linkedFrom: [...d.linkedFrom].sort() })).sort((a, b) => a.url.localeCompare(b.url)),
    pages: Object.values(w.pages).sort((a, b) => a.url.localeCompare(b.url)),
    stylesheets: Object.values(w.stylesheets).sort((a, b) => a.url.localeCompare(b.url)),
    documents: Object.values(w.documents ?? {}).sort((a, b) => a.url.localeCompare(b.url)),
    assets: Object.values(w.assets).sort((a, b) => a.url.localeCompare(b.url)),
    brand: w.brand ?? { status: 'skipped', reason: 'not measured', logo: [] },
  };
  return { ...body, id: snapshotIdOf(body), capturedAt };
}
void config;
