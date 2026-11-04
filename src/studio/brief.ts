import { buildBrandProfile } from '../sources/brand-profile.js';
import { nameKey, phoneKey, type ParsedAddress, type SiteContent } from '../sources/site-content.js';
import { nameSimilarity } from '../sources/identity.js';
import { buildOffers, reconcileServices, type ServiceRecord } from '../evidence.js';
import type { CrawledPage } from '../sources/crawl.js';
import { graphicKind, usesOf } from '../design/image-fit.js';
import { pageTypeOf } from '../sources/crawl.js';
import { assetIdOf, extractPage, type ExtractedPage } from './extract.js';
import { isLegal, isPost, urlKey } from './discover.js';
import { getBody, sha256, stableStringify, type DocumentSnapshot, type SourceSnapshot } from './snapshot.js';
import { itemsFromPdf, type PdfExtraction, type PdfItem } from './pdf.js';
import { stateName } from './address.js';
import { BRIEF_SCHEMA, INVENTORY_SCHEMA, SCHEMA_VERSION, businessBrief, siteInventory, type AssetRecord, type AssetSummary, type BusinessBrief, type Conflict, type DocumentRecord, type Fact, type OwnerQuestion, type PageRecord, type SiteInventory, type SourceRef } from './schema.js';

/**
 * The inventory and the brief, built from a saved snapshot and nothing else: no network, no clock, no model. The same
 * snapshot always gives the same two documents (the brief's hash proves it). An AI summary may be added afterwards
 * (src/studio/summary.ts), outside the hashed content: it cannot change the facts or the service inventory.
 */

export const businessKeyOf = (s: Pick<SourceSnapshot, 'identity' | 'listing'>): string => {
  if (s.listing?.placeId) return `place-${s.listing.placeId}`.replace(/[^A-Za-z0-9_.-]/g, '-');
  const home = s.identity.homeUrl;
  return home ? `site-${urlKey(home).split('/')[0]}`.replace(/[^A-Za-z0-9_.-]/g, '-') : 'unknown';
};

const GOOGLE = (s: SourceSnapshot): SourceRef => ({ url: `google:${s.listing?.placeId}`, sourceType: 'google', locator: 'Google Business Profile' });
const web = (url: string, locator?: string): SourceRef => ({ url, sourceType: 'website', locator });
const unknown = <T>(note: string, questionId?: string): Fact<T> => ({ value: null, status: 'unknown', confidence: 0, sources: [], note, questionId });
const known = <T>(value: T, sources: SourceRef[], confidence: number, status: Fact<T>['status'] = 'verified', note?: string): Fact<T> => ({ value, status, confidence, sources, ...(note ? { note } : {}) });
/** sources disagree: no value is chosen; every candidate is kept with its sources until the owner answers */
const disputed = <T>(candidates: { value: T; sources: SourceRef[] }[], questionId: string, note: string, status: Fact<T>['status'] = 'conflicting'): Fact<T> => ({
  value: null, status, confidence: 0, note, questionId, candidates,
  sources: [...new Map(candidates.flatMap((c) => c.sources).map((x) => [`${x.url}|${x.locator ?? ''}`, x])).values()],
});
/** the same place however the street is written ("Heritage Center Cir" and "Heritage Center Circle"): ZIP, street number, first street word */
// a numbered road is the same road however its kind is written ("RM 1431", "FM 1431", "Ranch Road 1431"): the number is what identifies it
const ROAD_KIND = new Set(['fm', 'rm', 'rr', 'cr', 'sh', 'us', 'hwy', 'highway', 'route', 'rte', 'state', 'county', 'farm', 'ranch', 'road', 'to', 'market', 'interstate', 'i']);
const addrKey = (a: Pick<ParsedAddress, 'street' | 'zip'>) => {
  const t = a.street.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const num = /^\d+[a-z]?$/.test(t[0] || '') ? t.shift()! : '';
  while (t[0] && /^(n|s|e|w|north|south|east|west)$/.test(t[0])) t.shift();
  if (t[0] && ROAD_KIND.has(t[0])) { const n = t.find((x) => /^\d+$/.test(x)); if (n) return `${a.zip}|${num}|road-${n}`; }
  return num && t[0] ? `${a.zip}|${num}|${t[0]}` : `${a.zip}|${nameKey(a.street)}`;
};
/** a site builder's sample address left in a template ("info@mysite.com" on Wix), or a tracking address: not the business's */
export const isPlaceholderEmail = (e: string) => /@(?:[a-z0-9-]+\.)*(?:example|domain|yourdomain|mysite|yoursite|website|email|company|test|sentry|wixpress)\.(?:com|org|net|io)$|^(?:you|your(?:name|email)?|name|user|email)@/i.test(e);
/** an offer however it is worded ("GET A FREE ESTIMATE", "Get Free Estimate") */
const offerKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\b(get|request|book|schedule|claim|your|a|an|the|our|now|today)\b/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

interface Loaded { page: SourceSnapshot['pages'][number]; x: ExtractedPage }

/** The pages of the snapshot, read again from their saved HTML. */
async function load(s: SourceSnapshot): Promise<Loaded[]> {
  const sheets = new Map<string, string>();
  for (const st of s.stylesheets) { const css = st.ok ? await getBody(st.bodyHash) : undefined; if (css) sheets.set(st.url, css); }
  const home = s.identity.homeUrl ?? '';
  const origin = home ? new URL(home).origin : '';
  const out: Loaded[] = [];
  for (const page of s.pages) {
    if (page.status !== 'read' && page.status !== 'rendered') continue;
    const html = await getBody(page.bodyHash);
    if (html === undefined) throw new Error(`The snapshot ${s.id} is missing the saved HTML of ${page.url}`);
    out.push({ page, x: extractPage(html, page.finalUrl || page.url, { home, origin, rendered: page.rendered, stylesheets: sheets }) });
  }
  return out;
}

interface LoadedDoc { doc: DocumentSnapshot; x?: PdfExtraction; items: PdfItem[] }
/** documents that only list allergens or nutrition say what is in a dish, not what is sold: no items from them */
const SELLS = new Set(['menu', 'price-list', 'services', 'brochure']);

/** The linked PDFs of the snapshot, read again from their saved extractions. */
async function loadDocs(s: SourceSnapshot): Promise<LoadedDoc[]> {
  const out: LoadedDoc[] = [];
  for (const doc of s.documents ?? []) {
    if (doc.status !== 'read' || !doc.extractionHash) { out.push({ doc, items: [] }); continue; }
    const raw = await getBody(doc.extractionHash);
    if (raw === undefined) throw new Error(`The snapshot ${s.id} is missing the saved extraction of ${doc.url}`);
    const x = JSON.parse(raw) as PdfExtraction;
    out.push({ doc, x, items: SELLS.has(doc.kind) ? itemsFromPdf(x) : [] });
  }
  return out;
}

// ───────────────────────── inventory ─────────────────────────
function bareType(url: string): PageRecord['type'] {
  const p = new URL(url).pathname.toLowerCase();
  if (/\.[a-z0-9]{2,4}$/.test(p) && !/\.(html?|php|aspx?)$/.test(p)) return 'other';
  if (p === '/' || p === '') return 'home';
  if (isLegal(p)) return 'legal';
  if (isPost(p)) return 'post';
  const t = pageTypeOf(url);
  return t === 'services' ? 'service' : t;
}
const empty = (): Pick<PageRecord, 'headings' | 'services' | 'locations' | 'phones' | 'emails' | 'offers' | 'forms' | 'ctas' | 'internalLinks' | 'externalLinks' | 'images' | 'videos' | 'fonts' | 'colors'> => ({ headings: [], services: [], locations: [], phones: [], emails: [], offers: [], forms: [], ctas: [], internalLinks: [], externalLinks: [], images: [], videos: [], fonts: [], colors: [] });

/** The one count of pictures: how each website picture was examined and how it came out. Reports read this, never their own tallies. */
export function summarizeAssets(assets: AssetRecord[]): AssetSummary {
  const w = assets.filter((a) => a.origin === 'website');
  const n = (f: (a: AssetRecord) => boolean) => w.filter(f).length;
  return {
    website: {
      total: w.length,
      examined: { downloaded: n((a) => a.examined === 'downloaded'), downloadFailed: n((a) => a.examined === 'download-failed'), byFileName: n((a) => a.examined === 'by-file-name'), byRole: n((a) => a.examined === 'by-role'), overBudget: n((a) => a.examined === 'over-budget') },
      outcomes: { usable: n((a) => a.outcome === 'usable'), icon: n((a) => a.outcome === 'icon'), map: n((a) => a.outcome === 'map'), graphic: n((a) => a.outcome === 'graphic'), undersized: n((a) => a.outcome === 'undersized'), duplicate: n((a) => a.outcome === 'duplicate'), broken: n((a) => a.outcome === 'broken'), notProbed: n((a) => a.outcome === 'not-probed') },
    },
    google: { total: assets.filter((a) => a.origin === 'google').length },
  };
}

function buildInventoryFrom(s: SourceSnapshot, loaded: Loaded[], docs: LoadedDoc[], businessKey: string): SiteInventory {
  const byKey = new Map(loaded.map((l) => [urlKey(l.page.url), l]));
  const pages: PageRecord[] = [];
  // linked PDFs are documents, counted on their own (below), not pages
  const pageDisc = s.discovery.filter((d) => d.decision !== 'document');
  const disc = new Map(pageDisc.map((d) => [urlKey(d.url), d]));
  const keys = new Set([...pageDisc.map((d) => urlKey(d.url)), ...s.pages.map((p) => urlKey(p.url))]);
  for (const key of [...keys].sort()) {
    const d = disc.get(key);
    const p = s.pages.find((x) => urlKey(x.url) === key);
    const l = byKey.get(key);
    const url = d?.url ?? p!.url;
    const base = { url, discoveredVia: d?.via ?? ['input'], depth: d?.depth ?? 0, linkedFrom: d?.linkedFrom ?? [], attempts: p?.attempts ?? 0 };
    if (l) pages.push({ ...base, ...l.x.record, finalUrl: p!.finalUrl !== url ? p!.finalUrl : undefined, status: p!.status === 'rendered' ? 'rendered' : 'read', httpStatus: p!.httpStatus, bodyHash: p!.bodyHash });
    else if (p && (p.status === 'failed' || p.status === 'skipped')) pages.push({ ...base, ...empty(), type: bareType(url), status: p.status, reason: p.error, httpStatus: p.httpStatus, textLength: 0 });
    else pages.push({ ...base, ...empty(), type: bareType(url), status: 'skipped', reason: d?.reason ?? 'not reached before the job finished', textLength: 0 });
  }
  // relationships: which known page links to which
  const known = new Set(pages.map((p) => urlKey(p.url)));
  const links: SiteInventory['links'] = [];
  for (const p of pages) for (const to of p.internalLinks) if (known.has(urlKey(to)) && urlKey(to) !== urlKey(p.url)) links.push({ from: p.url, to: pages.find((x) => urlKey(x.url) === urlKey(to))!.url });
  const linksSorted = [...new Map(links.map((x) => [`${x.from}>${x.to}`, x])).values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // pictures: one record per picture, with every page it is on and the services it is shown with
  const assets = new Map<string, AssetRecord>();
  const places = loaded.flatMap((l) => l.x.content.areas?.places ?? []);
  for (const l of [...loaded].sort((a, b) => a.page.url.localeCompare(b.page.url))) {
    for (const im of l.x.images) {
      const a = assets.get(im.id) ?? { id: im.id, url: im.url, origin: 'website' as const, role: im.role, alt: im.alt || undefined, pages: [], services: [], context: im.context, outcome: 'not-probed' as const, examined: 'over-budget' as const, uses: [], rights: 'unconfirmed' as const, attribution: [] };
      if (!a.pages.includes(l.page.url)) a.pages.push(l.page.url);
      if (im.service && !a.services.includes(im.service)) a.services.push(im.service);
      if (!a.context && im.context) a.context = im.context;
      assets.set(im.id, a);
    }
  }
  // a probe belongs to the picture, whichever of its addresses (sizes, crops) was downloaded
  const probes = new Map(s.assets.map((p) => [assetIdOf(p.url), p]));
  const kept: { id: string; dhash: bigint }[] = [];
  const ranked = [...assets.values()].sort((a, b) => (b.services.length - a.services.length) || a.url.localeCompare(b.url));
  for (const a of ranked) {
    const p = probes.get(a.id);
    if (!p) {
      // not downloaded: an icon or graphic by its file name, a logo or social badge by its role, else over the download budget
      const byName = graphicKind(a.url, { width: 999, height: 999, places });
      if (byName) { a.outcome = byName; a.examined = 'by-file-name'; a.reason = 'an icon or graphic, by its file name (not downloaded)'; }
      else if (a.role === 'logo' || a.role === 'social') { a.outcome = a.role === 'logo' ? 'graphic' : 'icon'; a.examined = 'by-role'; a.reason = `a ${a.role === 'logo' ? 'logo' : 'social media badge'}, by its place on the page (not downloaded)`; }
      else { a.outcome = 'not-probed'; a.examined = 'over-budget'; a.reason = 'not measured (over the download budget)'; }
      continue;
    }
    Object.assign(a, { width: p.width, height: p.height, format: p.format, bytes: p.bytes, sha256: p.sha256 });
    if (!p.ok) { a.outcome = 'broken'; a.examined = 'download-failed'; a.reason = p.error; continue; }
    a.examined = 'downloaded';
    const kind = graphicKind(a.url, { width: p.width || 0, height: p.height || 0, places });
    if (kind) { a.outcome = kind; a.reason = kind === 'map' ? 'a map, not a photograph' : kind === 'icon' ? 'an icon or avatar' : 'a graphic, not a photograph'; continue; }
    if (p.artwork) { a.outcome = 'graphic'; a.reason = 'artwork (a logo, badge, sticker or illustration), not a photograph'; continue; }
    a.uses = usesOf(p.width || 0, p.height || 0);
    if (!a.uses.length) { a.outcome = 'undersized'; a.reason = `too small for any frame (${p.width}×${p.height})`; continue; }
    const dh = p.dhash ? BigInt(`0x${p.dhash}`) : undefined;
    const twin = dh !== undefined ? kept.find((k) => { let x = k.dhash ^ dh, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n <= 5; }) : undefined;
    if (twin) { a.outcome = 'duplicate'; a.duplicateOf = twin.id; a.reason = 'the same picture as another one, at another size or crop'; continue; }
    if (dh !== undefined) kept.push({ id: a.id, dhash: dh });
    a.outcome = 'usable';
  }
  // Google listing photos: references only (not downloaded); Google's terms limit their use
  // the photo's reference changes on every request to Google, so its id comes from what does not: its credit, size and order
  const seenPhoto = new Map<string, number>();
  for (const [order, ph] of (s.listing?.photos ?? []).entries()) {
    const base = `${s.listing!.placeId}|${ph.authors.join('|')}|${ph.width}x${ph.height}`;
    const n = (seenPhoto.get(base) ?? 0) + 1;
    seenPhoto.set(base, n);
    const id = `gph_${sha256(`${base}|${n}`).slice(0, 12)}`;
    assets.set(id, { id, url: `google-listing:${s.listing!.placeId}#${order}`, origin: 'google', role: 'listing-photo', pages: [], services: [], outcome: usesOf(ph.width, ph.height).length ? 'usable' : 'undersized', examined: 'listing-reference', width: ph.width, height: ph.height, uses: usesOf(ph.width, ph.height), rights: 'google-restricted', attribution: ph.authors });
  }
  const assetList = [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)).map((a) => ({ ...a, pages: [...a.pages].sort(), services: [...a.services].sort() }));
  const assetSummary = summarizeAssets(assetList);

  // linked PDFs: how each was read, page by page, and how many items its text layer gave
  const documents: DocumentRecord[] = docs.map(({ doc, x, items }) => {
    const layouts = new Set(items.map((i) => i.layout));
    return {
      url: doc.url, kind: doc.kind, ...(doc.anchor ? { anchor: doc.anchor } : {}), linkedFrom: doc.linkedFrom, status: doc.status, ...(doc.reason ? { reason: doc.reason } : {}),
      ...(doc.httpStatus ? { httpStatus: doc.httpStatus } : {}), attempts: doc.attempts, ...(doc.bytes ? { bytes: doc.bytes } : {}), ...(doc.sha256 ? { sha256: doc.sha256 } : {}), ...(doc.totalPages ? { totalPages: doc.totalPages } : {}),
      pages: (x?.pages ?? []).map((p) => ({ page: p.page, method: p.method, chars: p.chars, garbled: p.garbled, ...(p.ocrConfidence !== undefined ? { ocrConfidence: p.ocrConfidence } : {}), ...(p.reason ? { reason: p.reason } : {}) })),
      items: items.length,
      layout: layouts.size === 2 ? 'mixed' : layouts.has('grid') ? 'grid' : layouts.has('list') ? 'list' : 'none',
    };
  });

  // fonts and colours across the site
  const fontCount = new Map<string, { n: number; google: boolean }>();
  const MONO = /^(menlo|monaco|consolas|courier|courier new|lucida console|source code pro|sf mono|dejavu sans mono)$/i;
  for (const l of loaded) for (const f of l.x.record.fonts.filter((x) => !MONO.test(x))) { const c = fontCount.get(f) ?? { n: 0, google: l.x.googleFonts.includes(f) }; c.n++; c.google ||= l.x.googleFonts.includes(f); fontCount.set(f, c); }
  const fonts: SiteInventory['fonts'] = [...fontCount.entries()].map(([family, c]) => ({ family, source: c.google ? 'google-fonts' as const : 'stylesheet' as const, pages: c.n }));
  const raw = s.brand.raw;
  if (raw) for (const role of ['heading', 'body'] as const) for (const fam of Object.keys(raw.fonts[role] || {})) if (!fonts.some((f) => f.family.toLowerCase() === fam.toLowerCase())) fonts.push({ family: fam, source: 'rendered', pages: 1 });
  const colorSum = new Map<string, number>();
  for (const l of loaded) for (const c of l.x.record.colors) colorSum.set(c.hex, (colorSum.get(c.hex) ?? 0) + c.count);

  const count = (st: PageRecord['status']) => pages.filter((p) => p.status === st).length;
  const skippedReasons: Record<string, number> = {};
  for (const p of pages.filter((x) => x.status === 'skipped')) skippedReasons[p.reason || 'skipped'] = (skippedReasons[p.reason || 'skipped'] ?? 0) + 1;
  const inv: SiteInventory = {
    schema: INVENTORY_SCHEMA, version: SCHEMA_VERSION, businessKey, snapshotId: s.id, capturedAt: s.capturedAt, route: s.identity.route,
    site: {
      origin: s.identity.homeUrl ? new URL(s.identity.homeUrl).origin : null,
      home: s.identity.homeUrl ?? null,
      robots: { found: s.robots.found, disallow: s.robots.disallow, sitemaps: s.robots.sitemaps },
      sitemaps: s.sitemaps,
      budget: s.budget,
    },
    pages,
    coverage: {
      discovered: pages.length, read: count('read'), rendered: count('rendered'), skipped: count('skipped'), failed: count('failed'),
      partial: count('failed') > 0 || pages.some((p) => p.status === 'skipped' && /not reached/.test(p.reason || '')),
      skippedReasons: Object.fromEntries(Object.entries(skippedReasons).sort(([a], [b]) => a.localeCompare(b))),
      documents: { found: documents.length, read: documents.filter((d) => d.status === 'read').length, failed: documents.filter((d) => d.status === 'failed').length, skipped: documents.filter((d) => d.status === 'skipped').length },
    },
    links: linksSorted,
    documents,
    assets: assetList,
    assetSummary,
    fonts: fonts.sort((a, b) => b.pages - a.pages || a.family.localeCompare(b.family)).slice(0, 12),
    colors: [...colorSum.entries()].map(([hex, n]) => ({ hex, count: n })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)).slice(0, 24),
  };
  return siteInventory.parse(inv);
}

// ───────────────────────── brief ─────────────────────────
const timesOf = (lines: string[]) => [...new Set(lines.join(' ').toLowerCase().replace(/\s+/g, '').match(/\d{1,2}(:\d\d)?(am|pm)/g) || [])].sort().join(',');

function q(list: OwnerQuestion[], x: OwnerQuestion): string {
  if (!list.some((y) => y.id === x.id)) list.push(x);
  return x.id;
}

type Offering = BusinessBrief['offerings']['items'][number];
const itemKey = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** the amounts a price states ("16oz - $4.00 | 32oz - $6.00" is 4.00 and 6.00; sizes are not amounts) */
const amounts = (p: string) => (p.match(/\$\s?\d+(?:[.,]\d{2})?|\d+[.,]\d{2}/g) || []).map((x) => Number(x.replace(/[$\s]/g, '').replace(',', '.')).toFixed(2));

/**
 * What the business sells, from the text layer of its menus and price lists. Items are merged by name across
 * documents: a list page gives the description, tags and a price printed on the item's own lines (verified); a poster
 * grid adds a price printed in the same tile (needs review). Two documents that price an item differently leave the
 * price for review. OCR text never makes an item.
 */
function offeringsFrom(docs: LoadedDoc[]): BusinessBrief['offerings'] {
  const read = docs.filter((d) => d.doc.status === 'read' && d.x && SELLS.has(d.doc.kind));
  const documents = read.map((d) => {
    const pages = d.x!.pages, n = (m: string) => pages.filter((p) => p.method === m).length;
    const method = [n('text') && `text layer (${n('text')} page${n('text') > 1 ? 's' : ''})`, n('text+ocr') && `text layer and OCR (${n('text+ocr')})`, n('ocr') && `OCR only (${n('ocr')} page${n('ocr') > 1 ? 's' : ''}, evidence only)`, n('skipped') && `${n('skipped')} unread`].filter(Boolean).join(', ');
    return { url: d.doc.url, kind: d.doc.kind, method, items: d.items.length };
  });
  const byKey = new Map<string, Offering>();
  const order = (it: PdfItem) => (it.layout === 'list' ? 0 : 1);
  const all = read.flatMap((d) => d.items.map((it) => ({ d, it }))).sort((a, b) => order(a.it) - order(b.it) || a.d.doc.url.localeCompare(b.d.doc.url) || a.it.page - b.it.page);
  const ids = new Set<string>();
  for (const { d, it } of all) {
    const src = web(d.doc.url, `PDF page ${it.page}${it.section ? `, "${it.section}"` : ''}${it.layout === 'grid' ? ' (poster tile)' : ''}`);
    const price = it.price ? { text: it.price, status: it.priceBy === 'item-lines' ? 'verified' as const : 'needs_review' as const, how: it.priceBy === 'item-lines' ? "printed on the item's own lines" : 'printed in the same poster tile as the name', source: src } : undefined;
    const k = itemKey(it.name);
    const e = byKey.get(k);
    if (!e) {
      let id = `item-${slug(it.name)}`;
      for (let i = 2; ids.has(id); i++) id = `item-${slug(it.name)}-${i}`;
      ids.add(id);
      byKey.set(k, { id, name: it.name, ...(it.section ? { section: it.section } : {}), ...(it.description ? { description: it.description } : {}), tags: [...new Set(it.tags)], ...(price ? { price } : {}), sources: [src] });
      continue;
    }
    if (!e.sources.some((x) => x.url === src.url && x.locator === src.locator)) e.sources.push(src);
    if (!e.description && it.description) e.description = it.description;
    e.tags = [...new Set([...e.tags, ...it.tags])];
    if (price && !e.price) e.price = price;
    // another document agrees when every amount it prints is one this price states (a poster may show one size of several)
    else if (price && e.price && !amounts(price.text).every((x) => amounts(e.price!.text).includes(x))) e.price = { ...e.price, status: 'needs_review', how: `${e.price.how}; ${new URL(src.url).pathname.split('/').pop()} prints ${price.text}` };
  }
  const items = [...byKey.values()];
  return { status: items.length ? 'known' : 'unknown', documents, items };
}

function buildBriefFrom(s: SourceSnapshot, inv: SiteInventory, loaded: Loaded[], docs: LoadedDoc[], businessKey: string): BusinessBrief {
  const questions: OwnerQuestion[] = [];
  const conflicts: Conflict[] = [];
  const unknowns: BusinessBrief['unknowns'] = [];
  const L = s.listing;
  const home = s.identity.homeUrl;
  const homeL = home ? loaded.find((l) => urlKey(l.page.url) === urlKey(home) || urlKey(l.page.finalUrl || '') === urlKey(home)) : undefined;
  const hc: SiteContent | undefined = homeL?.x.content;
  const site = (l: Loaded) => l.page.finalUrl || l.page.url;
  const markUnknown = (field: string, why: string, question: OwnerQuestion) => { const id = q(questions, question); unknowns.push({ field, why, questionId: id }); return id; };

  // identity
  const webName = hc?.identity.name;
  let name: Fact<string>;
  if (webName && L) {
    const same = nameSimilarity(webName, L.name) >= 0.85 || nameKey(L.name).startsWith(nameKey(webName));
    if (same) name = known(webName, [web(site(homeL!), hc!.identity.names[0]?.sources.join(', ')), GOOGLE(s)], 0.95);
    else {
      const qid = q(questions, { id: 'q-identity-name', topic: 'identity', question: `Which name should the site use: "${webName}" (your website) or "${L.name}" (Google)?`, why: 'The website and the Google listing name the business differently.', options: [webName, L.name], blocking: true });
      conflicts.push({ id: 'c-name', field: 'name', summary: 'The website and the Google listing use different names.', values: [{ value: webName, sources: [web(site(homeL!))] }, { value: L.name, sources: [GOOGLE(s)] }], resolution: `Roger uses "${webName}" (the website's own) until the owner chooses.`, questionId: qid });
      name = { ...known(webName, [web(site(homeL!))], 0.6, 'conflicting'), questionId: qid };
    }
  } else if (webName) name = known(webName, [web(site(homeL!), hc!.identity.names[0]?.sources.join(', '))], 0.85);
  else if (L) name = known(L.name, [GOOGLE(s)], 0.85);
  else name = unknown('no source names the business', markUnknown('identity.name', 'no source names the business', { id: 'q-identity-name', topic: 'identity', question: 'What is the business called?', why: 'Neither a website nor a Google listing gave a name.', blocking: true }));
  const alternateNames = [...new Set([...(hc?.identity.names.map((n) => n.name) ?? []), ...(L ? [L.name] : [])])].filter((n) => n !== name.value).sort();
  const category: Fact<string> = L?.primaryTypeLabel ? known(L.primaryTypeLabel, [GOOGLE(s)], 0.85) : hc?.identity.typeHint ? known(hc.identity.typeHint.label, [web(site(homeL!), 'the page says what it is')], 0.6, 'needs_review') : unknown('no category stated', markUnknown('identity.category', 'no category stated', { id: 'q-identity-category', topic: 'identity', question: 'What kind of business is it (for example: roofer, chiropractor, Mexican restaurant)?', why: 'Neither source states a category.', blocking: false }));
  const website: Fact<string> = home ? known(home, [s.identity.route === 'google' ? GOOGLE(s) : { url: home, sourceType: 'owner', locator: 'the address given' }], s.identity.route === 'google' && s.identity.status !== 'verified' ? 0.6 : 0.95) : unknown('no website', undefined);
  if (L?.website && s.input.website) {
    const a = urlKey(L.website).split('/')[0], b = urlKey(s.input.website).split('/')[0];
    if (a !== b) {
      const qid = q(questions, { id: 'q-identity-website', topic: 'identity', question: `Is ${b} your website? Google's listing names ${a}.`, why: 'The address given and the Google listing name different websites.', options: [b, a], blocking: true });
      conflicts.push({ id: 'c-website', field: 'website', summary: 'The listing names a different website.', values: [{ value: b, sources: [{ url: s.input.website, sourceType: 'owner', locator: 'the address given' }] }, { value: a, sources: [GOOGLE(s)] }], resolution: `Roger reads ${b}, the address given.`, questionId: qid });
    }
  }
  if (s.identity.status === 'probable' || s.identity.status === 'unverified') q(questions, { id: 'q-identity-listing', topic: 'identity', question: L ? `Is this your Google listing: "${L.name}", ${L.formattedAddress}?` : 'Do you have a Google Business Profile? Send its link.', why: s.identity.status === 'unverified' ? 'Nothing independent confirms the listing is this business.' : `The listing matched on: ${s.identity.evidence.join(', ')}.`, blocking: s.identity.status === 'unverified' });

  // contact: phone
  const webPhones = new Map<string, { value: string; pages: string[] }>();
  for (const l of loaded) for (const p of l.x.record.phones) { const k = phoneKey(p); if (!k) continue; const e = webPhones.get(k) ?? { value: p, pages: [] }; if (!e.pages.includes(site(l))) e.pages.push(site(l)); webPhones.set(k, e); }
  const webPrimary = hc?.phones.primary;
  let phone: Fact<string>;
  if (webPrimary && L?.phone && phoneKey(webPrimary) !== phoneKey(L.phone)) {
    const listed = webPhones.get(phoneKey(L.phone));
    const qid = q(questions, { id: 'q-contact-phone', topic: 'contact', question: `Which number should customers call: ${L.phone} (Google listing) or ${webPrimary} (your website's main number)?`, why: listed ? `Both numbers appear; the website leads with ${webPrimary}.` : `Your website's main number is not the one on Google.`, options: [L.phone, webPrimary], blocking: true });
    const candidates = [
      { value: webPrimary, sources: (webPhones.get(phoneKey(webPrimary))?.pages ?? [site(homeL!)]).map((u) => web(u, 'phone number')) },
      { value: L.phone, sources: [GOOGLE(s), ...(listed?.pages ?? []).map((u) => web(u, 'phone number'))] },
    ];
    conflicts.push({ id: 'c-phone', field: 'phone', summary: 'The website and the Google listing give different main phone numbers.', values: candidates, resolution: 'Neither number is shown as the main number or used for a call button until the owner chooses; both are kept with their sources.', questionId: qid });
    phone = disputed(candidates, qid, 'the website and the Google listing give different main numbers');
  } else if (webPrimary || L?.phone) {
    const v = (webPrimary || L!.phone)!;
    phone = known(v, [...(webPrimary ? [web(site(homeL!), 'phone number')] : []), ...(L?.phone && phoneKey(L.phone) === phoneKey(v) ? [GOOGLE(s)] : [])], webPrimary && L?.phone ? 0.95 : 0.8);
  } else phone = unknown('no phone number found', markUnknown('contact.phone', 'no phone number found', { id: 'q-contact-phone', topic: 'contact', question: 'What phone number should customers call?', why: 'No phone number was found.', blocking: true }));
  const otherPhones = [...webPhones.entries()].filter(([k]) => k !== phoneKey(phone.value || '') && !(L?.phone && k === phoneKey(L.phone)) && !(webPrimary && k === phoneKey(webPrimary))).sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => known(e.value, e.pages.sort().map((u) => web(u, 'phone number')), 0.7, 'needs_review', 'another number on the website (a location, a department, or a provider who works there)'));
  const emails = [...new Set(loaded.flatMap((l) => l.x.record.emails))].filter((e) => !isPlaceholderEmail(e)).sort();
  const email: Fact<string> = emails[0] ? known(emails[0], loaded.filter((l) => l.x.record.emails.includes(emails[0])).map((l) => web(site(l), 'email link')), 0.8) : unknown('no email address on the website', undefined);

  // locations
  const locs = new Map<string, { address: ParsedAddress; sources: SourceRef[] }>();
  for (const l of [...loaded].sort((a, b) => a.page.url.localeCompare(b.page.url))) for (const loc of l.x.locations) {
    const k = addrKey(loc.address);
    const e = locs.get(k) ?? { address: loc.address, sources: [] };
    if (!e.sources.some((x) => x.url === site(l))) e.sources.push(web(site(l), loc.locator));
    locs.set(k, e);
  }
  const listingAddr: ParsedAddress | undefined = L?.street && L.zip ? { street: L.street, city: L.city || '', state: L.state || '', zip: L.zip, formatted: (L.formattedAddress || '').replace(/, USA$/, '') } : undefined;
  if (listingAddr) { const k = addrKey(listingAddr); const e = locs.get(k) ?? { address: listingAddr, sources: [] }; e.sources.push(GOOGLE(s)); locs.set(k, e); }
  const items = [...locs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => ({ id: `loc-${sha256(k).slice(0, 8)}`, address: e.address, sources: e.sources, listing: !!listingAddr && addrKey(listingAddr) === k }));
  const webLocs = items.filter((i) => i.sources.some((x) => x.sourceType === 'website'));
  const multi = webLocs.length >= 2;
  const candidateOf = (i: (typeof items)[number]) => ({ value: i.address, sources: i.sources });
  // the business's address and main location: chosen only when the sources agree on one place
  let address: Fact<ParsedAddress>;
  let primaryId: string | null = null;
  if (listingAddr && webLocs.length && !webLocs.some((i) => i.listing)) {
    const qid = q(questions, { id: 'q-contact-address', topic: 'contact', question: `Which address is this business: ${listingAddr.formatted} (Google) or ${webLocs[0].address.formatted} (your website)?`, why: "The listing's address is not among the addresses on the website.", options: [listingAddr.formatted, ...webLocs.slice(0, 3).map((i) => i.address.formatted)], blocking: true });
    conflicts.push({ id: 'c-address', field: 'address', summary: "The Google listing's address does not appear on the website.", values: [{ value: listingAddr.formatted, sources: [GOOGLE(s)] }, ...webLocs.slice(0, 4).map((i) => ({ value: i.address.formatted, sources: i.sources.filter((x) => x.sourceType === 'website') }))], resolution: 'Neither address is shown as the business\'s address, and no directions link is offered, until the owner chooses; every address is kept with its sources.', questionId: qid });
    address = disputed([items.find((i) => i.listing)!, ...webLocs].map(candidateOf), qid, "the Google listing's address is not on the website");
  } else if (multi) {
    const qid = q(questions, L
      ? { id: 'q-locations', topic: 'locations', question: `Your website lists ${webLocs.length} addresses; Google's listing is one location (${listingAddr?.formatted ?? L.formattedAddress}). Should the site cover every location, or this one?`, why: 'One Google listing describes one place; the website describes several.', options: ['All locations', 'This location only'], blocking: true }
      : { id: 'q-locations', topic: 'locations', question: `Your website lists ${webLocs.length} addresses. Should the site present them all equally, or is one the main location?`, why: 'Roger does not choose a main location for the business.', options: ['All locations equally', ...webLocs.slice(0, 3).map((i) => i.address.formatted)], blocking: true });
    address = disputed(webLocs.map(candidateOf), qid, `the website lists ${webLocs.length} addresses; none is chosen as the business's address`, L ? 'conflicting' : 'needs_review');
  } else if (listingAddr) { const it = items.find((i) => i.listing)!; address = known(listingAddr, it.sources, webLocs.some((i) => i.listing) ? 0.95 : 0.85); primaryId = it.id; }
  else if (webLocs[0]) { address = known(webLocs[0].address, webLocs[0].sources, 0.8); primaryId = webLocs[0].id; }
  else address = unknown('no street address found', markUnknown('contact.address', 'no street address found', { id: 'q-contact-address', topic: 'contact', question: 'Do customers visit you at an address? If so, which one?', why: 'No street address was found.', blocking: false }));
  if (multi && L) {
    const qid = q(questions, { id: 'q-locations', topic: 'locations', question: `Your website lists ${webLocs.length} addresses; Google's listing is one location (${listingAddr?.formatted ?? L.formattedAddress}). Should the site cover every location, or this one?`, why: 'One Google listing describes one place; the website describes several.', options: ['All locations', 'This location only'], blocking: true });
    conflicts.push({ id: 'c-locations', field: 'locations', summary: `The website lists ${webLocs.length} addresses; the Google listing is a single location.`, values: [{ value: `${webLocs.length} addresses: ${webLocs.map((i) => `${i.address.street}, ${i.address.city}`).join('; ')}`, sources: [...new Map(webLocs.flatMap((i) => i.sources.filter((x) => x.sourceType === 'website')).map((x) => [x.url, x])).values()] }, { value: `one location: ${listingAddr?.formatted ?? L.formattedAddress}`, sources: [GOOGLE(s)] }], resolution: 'No location is presented as the main one until the owner decides; every location is listed with its sources.', questionId: qid });
  }
  // service area
  const areaL = loaded.find((l) => l.x.content.areas?.places.length);
  const serviceArea: BusinessBrief['serviceArea'] = areaL ? known({ region: areaL.x.content.areas!.region, places: [...areaL.x.content.areas!.places] }, [web(site(areaL), areaL.x.content.areas!.sources.join(', '))], 0.8)
    : unknown('the website names no service area', markUnknown('serviceArea', 'no service area stated', { id: 'q-service-area', topic: 'service-area', question: 'Which towns or areas do you serve?', why: 'No service area is stated.', blocking: false }));

  // hours
  const hoursListing: Fact<string[]> = L?.hours?.length ? known([...L.hours], [GOOGLE(s)], 0.8) : unknown('the listing has no hours', undefined);
  const hoursL = loaded.find((l) => l.x.content.hours?.lines.length);
  const hoursWebsite: Fact<string[]> = hoursL ? known([...hoursL.x.content.hours!.lines], [web(site(hoursL), hoursL.x.content.hours!.method)], hoursL.x.content.hours!.method === 'json-ld' ? 0.85 : 0.7) : unknown('the website states no hours', undefined);
  // several locations: the website's hours are per location, so they are not compared with one listing's
  if (webLocs.length >= 2 && hoursWebsite.value) hoursWebsite.note = `hours of ${webLocs.length} locations, as the website lists them`;
  if (webLocs.length < 2 && hoursListing.value && hoursWebsite.value && timesOf(hoursListing.value) !== timesOf(hoursWebsite.value) && timesOf(hoursWebsite.value)) {
    const qid = q(questions, { id: 'q-hours', topic: 'hours', question: 'Which opening hours are right: the ones on Google or the ones on your website?', why: 'The two disagree.', options: ['Google', 'Website'], blocking: false });
    conflicts.push({ id: 'c-hours', field: 'hours', summary: 'The website and the Google listing give different hours.', values: [{ value: hoursWebsite.value.join('; '), sources: hoursWebsite.sources }, { value: hoursListing.value.join('; '), sources: [GOOGLE(s)] }], resolution: 'Roger shows the Google hours until the owner chooses.', questionId: qid });
    hoursListing.status = 'conflicting'; hoursWebsite.status = 'conflicting'; hoursListing.questionId = qid; hoursWebsite.questionId = qid;
  }
  if (!hoursListing.value && !hoursWebsite.value) markUnknown('hours', 'no opening hours stated', { id: 'q-hours', topic: 'hours', question: 'What are your opening hours?', why: 'No opening hours were found.', blocking: false });

  // emergency / after-hours: only what the business says
  const emergencyL = loaded.find((l) => /\b(24\/7|24 hours a day|emergency (?:service|services|repairs?|response|calls?)|after[- ]hours (?:service|calls))\b/i.test(l.x.content.claims.map((c) => c.text).join(' ') + ' ' + l.x.record.headings.map((h) => h.text).join(' ') + ' ' + l.x.record.ctas.map((c) => c.label).join(' ')));
  const open24 = !!L?.hours?.length && L.hours.every((h) => /open 24 hours/i.test(h));
  const emergency: Fact<string> = emergencyL ? known('stated on the website', [web(site(emergencyL), 'heading, claim or call to action')], 0.75) : unknown(open24 ? 'the listing shows "Open 24 hours", which says nothing about dispatch; the website does not state emergency service' : 'not stated', open24 ? q(questions, { id: 'q-emergency', topic: 'claims', question: 'Google shows you open 24 hours. Do you take emergency calls or send someone out after hours?', why: 'Opening hours on a listing are not a promise of emergency response.', options: ['Yes, emergency calls and dispatch', 'Calls answered, no dispatch', 'No'], blocking: false }) : undefined);

  // services
  const crawled: CrawledPage[] = loaded.filter((l) => l !== homeL).map((l) => ({ ...l.x.crawled, url: site(l), ok: true, status: l.page.httpStatus ?? 200 }));
  let records: ServiceRecord[] = [];
  if (hc && home) records = reconcileServices({ homeUrl: site(homeL!), content: hc, crawl: crawled, textServices: [], inferred: [] });
  const assetsByService = new Map<string, string[]>();
  for (const a of inv.assets) for (const n of a.services) assetsByService.set(n.toLowerCase(), [...(assetsByService.get(n.toLowerCase()) ?? []), a.id]);
  const verified = records.filter((r) => r.status === 'verified').sort((a, b) => a.priority - b.priority || a.canonicalName.localeCompare(b.canonicalName));
  const svcItems = verified.map((r) => ({
    id: `svc-${slug(r.canonicalName)}`, name: r.canonicalName, primary: r.isPrimary, status: 'verified' as const,
    evidence: r.mentions.map((m) => ({ kind: m.kind, url: m.url, ...(m.locator ? { locator: m.locator } : {}) })),
    ...(r.description ? { description: known(r.description.value, [{ url: r.description.sourceUrl, sourceType: 'website' as const, locator: r.description.locator }], r.description.confidence) } : {}),
    ...(r.destination ? { page: r.destination } : {}), ...(r.group ? { group: r.group } : {}),
    assets: [...new Set([...(assetsByService.get(r.canonicalName.toLowerCase()) ?? []), ...r.aliases.flatMap((x) => assetsByService.get(x.toLowerCase()) ?? [])])].sort(),
  }));
  const proposals = records.filter((r) => r.status !== 'verified').sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)).map((r) => ({ name: r.canonicalName, why: r.mentions.some((m) => m.kind === 'service-page') ? 'listed on a service page, but without a page or card of its own' : 'suggested, not shown by the business', evidence: r.mentions.map((m) => ({ kind: m.kind, url: m.url, ...(m.locator ? { locator: m.locator } : {}) })) }));
  const offerings = offeringsFrom(docs);
  if (offerings.items.length) {
    const review = offerings.items.filter((i) => i.price?.status === 'needs_review').length;
    q(questions, { id: 'q-offerings', topic: 'services', question: `Roger read ${offerings.items.length} items${offerings.items.some((i) => i.price) ? ` and ${offerings.items.filter((i) => i.price).length} prices` : ''} from ${offerings.documents.filter((d) => d.items).map((d) => decodeURIComponent(new URL(d.url).pathname.split('/').pop() || d.url)).join(', ')}. Is this menu current, and may the site show these prices?`, why: `Menus and prices change; the PDFs on the website may be out of date.${review ? ` ${review} price(s) were matched to their item by layout and need a check.` : ''}`, blocking: review > 0 });
  }
  const unreadDoc = docs.find((d) => SELLS.has(d.doc.kind) && d.doc.status !== 'read');
  if (!svcItems.length && !offerings.items.length) markUnknown('services', home ? (unreadDoc ? `the website shows no list of services or products; its ${unreadDoc.doc.kind} is a PDF (${new URL(unreadDoc.doc.url).pathname}) that was not read: ${unreadDoc.doc.reason ?? unreadDoc.doc.status}` : docs.some((d) => d.doc.status === 'read' && SELLS.has(d.doc.kind)) ? 'the website shows no list of services, and its PDFs gave no items Roger could read with confidence' : 'the website shows no list of services Roger could read') : 'no website: services are not on a Google listing', { id: 'q-services', topic: 'services', question: 'What are the main services or products you offer? List the ones customers ask for most.', why: home ? 'No list of services could be read from the website.' : 'A Google listing does not list services.', blocking: true });
  if (proposals.length) q(questions, { id: 'q-services-proposals', topic: 'services', question: `Do you also offer these: ${proposals.slice(0, 6).map((p) => p.name).join(', ')}${proposals.length > 6 ? ` and ${proposals.length - 6} more` : ''}?`, why: 'They appear on the website but not as services of their own.', blocking: false });

  // offers and calls to action
  const ctaOf = (c: NonNullable<SiteContent['hero']>['primary']): NonNullable<BusinessBrief['callsToAction']['primary']> | null => (c ? { label: c.label, href: c.href, kind: c.kind === 'external' ? 'external' : c.kind, ...(c.terms ? { terms: c.terms } : {}), locator: 'home page hero' } : null);
  const offers: BusinessBrief['offers'] = [];
  if (hc?.hero?.primary && home) for (const o of buildOffers({ homeUrl: site(homeL!), hero: hc.hero, crawl: crawled, services: records })) if (o.terms) offers.push({ id: `offer-${slug(o.label)}`, label: o.label, terms: o.terms, destination: o.destination.href, sources: [web(site(homeL!), o.source.locator)], services: o.eligible.map((e) => e.service).sort() });
  const seenOffer = new Set(offers.map((o) => offerKey(o.label)));
  for (const l of [...loaded].sort((a, b) => a.page.url.localeCompare(b.page.url))) for (const o of l.x.record.offers) {
    const k = offerKey(o.text);
    if (seenOffer.has(k)) { const e = offers.find((x) => offerKey(x.label) === k); if (e && !e.sources.some((x) => x.url === site(l))) e.sources.push(web(site(l), o.locator)); continue; }
    if (offers.length >= 10) continue;
    seenOffer.add(k);
    offers.push({ id: `offer-${slug(o.text)}`, label: o.text, terms: o.terms, destination: '', sources: [web(site(l), o.locator)], services: [] });
  }
  // a call button for a disputed number, or directions to a disputed place, is held until the owner answers
  const held: BusinessBrief['callsToAction']['held'] = [];
  const phoneQ = phone.candidates ? phone.questionId : undefined;
  const placeQ = address.candidates ? address.questionId : undefined;
  const DIRECTIONS = /maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|bing\.com\/maps|waze\.com|\/directions\b/i;
  const hold = <C extends { label: string; href: string; kind?: string } | null>(c: C): C | null => {
    if (!c) return c;
    if (phoneQ && (c.kind === 'phone' || /^tel:/i.test(c.href))) { held.push({ label: c.label, href: c.href, reason: 'it calls a phone number the website and the Google listing disagree on', questionId: phoneQ }); return null; }
    if (placeQ && DIRECTIONS.test(c.href)) { held.push({ label: c.label, href: c.href, reason: 'it gives directions to a location the sources disagree on', questionId: placeQ }); return null; }
    return c;
  };
  const bookingUrl = hc?.booking.primary?.url ?? null;
  const callsToAction = { primary: hold(ctaOf(hc?.hero?.primary)), secondary: hold(ctaOf(hc?.hero?.secondary)), booking: bookingUrl && hold({ label: hc?.booking.primary?.label || 'Book', href: bookingUrl }) ? bookingUrl : null, held };

  // claims, testimonials, reviews, story
  const claimMap = new Map<string, Fact<string>>();
  for (const l of [...loaded].sort((a, b) => a.page.url.localeCompare(b.page.url))) for (const c of l.x.content.claims) {
    const k = `${c.key}|${c.text.toLowerCase()}`;
    const f = claimMap.get(k) ?? known(c.text, [], 0.8, 'verified', `${c.key}: in the business's own words; confirm before it is published`);
    if (!f.sources.some((x) => x.url === site(l))) f.sources.push(web(site(l), c.locator));
    claimMap.set(k, f);
  }
  const claims = [...claimMap.values()];
  if (claims.length) q(questions, { id: 'q-claims', topic: 'claims', question: `Can the new site repeat these claims: ${claims.slice(0, 4).map((c) => `"${c.value}"`).join(', ')}?`, why: 'Claims about warranties, licences and experience are published only when the owner confirms them.', blocking: true });
  const testimonials: BusinessBrief['testimonials'] = [];
  for (const l of loaded) for (const t of l.x.content.testimonials) if (!testimonials.some((x) => x.author === t.author && x.text === t.text)) testimonials.push({ author: t.author, text: t.text, source: web(site(l), t.locator) });
  testimonials.sort((a, b) => a.author.localeCompare(b.author));
  const reviews: BusinessBrief['reviews'] = L?.rating && L.reviewCount ? known({ rating: L.rating, count: L.reviewCount, restrictions: "Google review text can be shown only as Google supplies it, with each author's name; the site links to the reviews rather than copying them." }, [GOOGLE(s)], 0.9) : unknown('no Google rating', undefined);
  const storyL = loaded.find((l) => l === homeL && l.x.content.story?.method === 'section') ?? loaded.find((l) => l.x.content.story?.method === 'section' && /about|story/i.test(l.page.url)) ?? loaded.find((l) => l.x.content.story?.method === 'section');
  // no story section: an about page's own paragraphs are its story, held for the owner to check
  const aboutL = storyL ? undefined : loaded.filter((l) => l.x.record.type === 'about' && l.x.paragraphs.text.join(' ').length >= 200).sort((a, b) => a.page.url.localeCompare(b.page.url))[0];
  const story: BusinessBrief['story'] = storyL ? known({ heading: storyL.x.content.story!.heading, text: storyL.x.content.story!.text }, [web(site(storyL), `"${storyL.x.content.story!.heading}" section`)], 0.8)
    : aboutL ? known({ heading: aboutL.x.paragraphs.heading || 'About', text: aboutL.x.paragraphs.text.join('\n\n').slice(0, 2400) }, [web(site(aboutL), 'the about page\'s paragraphs')], 0.65, 'needs_review', 'read from the about page as written; it will be edited down, faithfully')
    : unknown(home ? 'the website has no about or story section' : 'no website', markUnknown('story', 'no story found', { id: 'q-story', topic: 'story', question: 'In two or three sentences: how did the business start, and what do customers value about it?', why: home ? 'The website has no about section Roger could read.' : 'A Google listing has no story.', blocking: false }));

  // brand
  const logoOk = s.brand.logo.find((x) => x.ok);
  const profile = home ? buildBrandProfile(s.brand.raw, { logoColors: logoOk?.colors, logoUrl: logoOk?.url, sourceUrl: home, cssColors: inv.colors }) : undefined;
  const colors: BusinessBrief['brand']['colors'] = [];
  if (profile?.primary) colors.push({ role: 'primary', hex: profile.primary.hex, confidence: profile.primary.confidence, evidence: profile.primary.evidence[0] ? `${profile.primary.evidence[0].where}: ${profile.primary.evidence[0].detail}` : '' });
  if (profile?.secondary) colors.push({ role: 'accent', hex: profile.secondary.hex, confidence: profile.secondary.confidence, evidence: profile.secondary.evidence[0] ? `${profile.secondary.evidence[0].where}: ${profile.secondary.evidence[0].detail}` : '' });
  if (profile?.button) colors.push({ role: 'button', hex: profile.button.fill, confidence: profile.button.confidence, evidence: `text ${profile.button.text}, corners ${profile.button.radius}px ("${profile.button.label}")` });
  const fontsB: BusinessBrief['brand']['fonts'] = [];
  if (profile?.typography?.heading) fontsB.push({ role: 'heading', family: profile.typography.heading.family, source: profile.typography.heading.evidence });
  if (profile?.typography?.body) fontsB.push({ role: 'body', family: profile.typography.body.family, source: profile.typography.body.evidence });
  for (const f of inv.fonts.slice(0, 3)) if (!fontsB.some((x) => x.family.toLowerCase() === f.family.toLowerCase())) fontsB.push({ role: 'found', family: f.family, source: `${f.source}, ${f.pages} page(s)` });
  const brandStatus: BusinessBrief['brand']['status'] = !profile || profile.method === 'none' ? 'unknown' : profile.method === 'rendered' ? 'measured' : 'stylesheet-only';
  const conf = profile?.primary?.confidence ?? (profile?.method === 'none' || !profile ? 'none' : 'low');
  if (brandStatus === 'unknown' || conf === 'low' || conf === 'none') markUnknown('brand', home ? 'the brand colours could not be read with confidence' : 'no website: the brand is unknown', { id: 'q-brand', topic: 'brand', question: 'Do you have a logo and brand colours? Upload the logo, or name the colours you use.', why: home ? 'The brand colours could not be read with confidence.' : 'Without a website there is nothing to read the brand from.', blocking: false });
  const logo: BusinessBrief['brand']['logo'] = logoOk ? known({ url: logoOk.url, width: logoOk.width, height: logoOk.height, colors: logoOk.colors }, [web(home!, logoOk.reason)], 0.75, 'needs_review', 'confirm this is the current logo') : unknown(home ? 'no usable logo found' : 'no website', home ? undefined : q(questions, { id: 'q-brand', topic: 'brand', question: 'Do you have a logo and brand colours? Upload the logo, or name the colours you use.', why: 'Without a website there is nothing to read the brand from.', blocking: false }));

  // pictures and their rights
  // every count comes from the inventory's asset summary
  const webAssets = inv.assets.filter((a) => a.origin === 'website');
  const googleAssets = inv.assets.filter((a) => a.origin === 'google');
  const nUsable = inv.assetSummary.website.outcomes.usable, nGoogle = inv.assetSummary.google.total;
  if (nUsable) q(questions, { id: 'q-photos-rights', topic: 'photos', question: `Are the ${nUsable} photos on your website yours to publish (taken by you, or licensed for this use)?`, why: 'A picture on a website is not proof it may be reused; each needs the owner\'s confirmation.', blocking: true });
  if (nGoogle) q(questions, { id: 'q-photos-google', topic: 'photos', question: `The ${nGoogle} photos on your Google listing can only be previewed. Upload your own photos for the published site?`, why: "Google's listing photos belong to their photographers; Roger shows them in the preview with credit, never on a published site.", blocking: false });
  if (!nUsable && !nGoogle) markUnknown('photos', 'no photos found', { id: 'q-photos-upload', topic: 'photos', question: 'Do you have photos of your work, your team or your place? Upload a few.', why: 'No usable photos were found.', blocking: false });

  const brief: BusinessBrief = {
    schema: BRIEF_SCHEMA, version: SCHEMA_VERSION, businessKey, revision: 1, snapshotId: s.id, capturedAt: s.capturedAt, route: s.identity.route, briefHash: '',
    identity: { status: s.identity.status, evidence: s.identity.evidence, name, alternateNames, category, website, listing: L ? { placeId: L.placeId, mapsUrl: L.mapsUrl, businessStatus: L.businessStatus } : null },
    contact: { phone, otherPhones, email, address },
    locations: { status: !items.length ? 'unknown' : multi ? 'multiple' : 'single', items, primaryId },
    serviceArea,
    hours: { listing: hoursListing, website: hoursWebsite },
    availability: { emergency, note: 'Opening hours on a listing say nothing about phone answering or emergency dispatch; Roger states emergency service only when the business does.' },
    services: { status: svcItems.length ? 'known' : 'unknown', items: svcItems, proposals },
    offerings,
    offers,
    callsToAction,
    claims,
    testimonials,
    reviews,
    story,
    brand: { status: brandStatus, confidence: conf, colors, fonts: fontsB, headingCase: profile?.headingCase ?? null, logo },
    assets: {
      website: { usable: inv.assetSummary.website.outcomes.usable, total: inv.assetSummary.website.total, ids: webAssets.map((a) => a.id).sort() },
      google: { count: inv.assetSummary.google.total, ids: googleAssets.map((a) => a.id).sort(), restriction: 'Google listing photos: preview only, with the photographer credited; never published, never mixed with the owner\'s approved pictures.' },
    },
    conflicts: conflicts.sort((a, b) => a.id.localeCompare(b.id)),
    unknowns: unknowns.sort((a, b) => a.field.localeCompare(b.field)),
    ownerQuestions: questions.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.id.localeCompare(b.id)),
    summary: { status: 'unavailable', text: null, reason: 'not written yet', inputHash: '' },
  };
  brief.briefHash = briefHashOf(brief);
  return brief;
}

/**
 * The brief's content hash: what it says, without its revision, the snapshot it came from, when that was captured, or
 * the AI summary. The same snapshot gives the same brief; a new snapshot whose content says the same gives the same hash,
 * so it keeps the same revision.
 */
export const briefHashOf = (b: BusinessBrief) => sha256(stableStringify({ ...b, revision: undefined, briefHash: undefined, summary: undefined, snapshotId: undefined, capturedAt: undefined }));

/** Inventory and brief from a snapshot: deterministic. */
export async function buildFromSnapshot(s: SourceSnapshot): Promise<{ inventory: SiteInventory; brief: BusinessBrief; evidenceText: string }> {
  const loaded = await load(s);
  const docs = await loadDocs(s);
  const businessKey = businessKeyOf(s);
  const inventory = buildInventoryFrom(s, loaded, docs, businessKey);
  const brief = businessBrief.parse(buildBriefFrom(s, inventory, loaded, docs, businessKey));
  // the evidence an AI summary may draw on: what the business says about itself, nothing else
  const homeL = loaded.find((l) => urlKey(l.page.url) === urlKey(s.identity.homeUrl || ''));
  const evidenceText = [
    brief.identity.name.value && `Name: ${brief.identity.name.value}`, brief.identity.category.value && `Category: ${brief.identity.category.value}`,
    brief.services.items.length && `Services: ${brief.services.items.map((x) => x.name).join(', ')}`,
    brief.offerings.items.length && `Menu items (from the business's PDFs): ${brief.offerings.items.slice(0, 40).map((x) => x.name).join(', ')}`,
    brief.story.value && `Story: ${brief.story.value.text}`, homeL?.x.content.identity.description && `Website description: ${homeL.x.content.identity.description}`,
    s.listing?.editorialSummary && `Google summary: ${s.listing.editorialSummary}`,
    brief.serviceArea.value && `Area: ${[brief.serviceArea.value.region, ...brief.serviceArea.value.places].filter(Boolean).join(', ')}`,
    brief.locations.items.length && `Locations in: ${[...new Set(brief.locations.items.map((l) => `${l.address.city}, ${l.address.state} (${stateName(l.address.state)})`))].join('; ')}`,
  ].filter(Boolean).join('\n');
  return { inventory, brief, evidenceText };
}
