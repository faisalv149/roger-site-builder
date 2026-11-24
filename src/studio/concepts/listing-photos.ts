import { load } from 'cheerio';
import type { ProcessedPhoto } from '../../brand/photos.js';
import { labelPhotos } from '../../design/photos.js';
import { downloadPhoto, liveListingPhotos, livePhotoUri, type LivePhoto } from '../../sources/places.js';
import type { Photo } from './review.js';
import { photoFingerprint, samePhoto, validFingerprint } from '../../design/fingerprint.js';
import { studioDocs } from '../../store.js';

/**
 * Google listing photos in Phase 2 concept previews, within Google Maps Platform's terms (reviewed 2026-11-04:
 * Terms of Service 3.2.3 (a) and (b), last modified 2026-08-26; Service Specific Terms 14.1–14.3, last modified
 * 2026-10-28; Places API "Policies and attributions"; Place Photos (New)):
 *  - Places content may be shown without a Google map (14.1), but not stored, cached or rehosted (3.2.3; 14.3 allows
 *    only latitude/longitude, and place IDs may be kept). Photo names expire and may not be cached; photo URIs neither.
 *  - Every photo shown carries its author attribution, a way to open the source photo on Google Maps, and the
 *    "Google Maps" attribution in the same visual container.
 * So a concept stores no Google photo, name, address or credit: only "listing photo n of place P". The image itself and
 * its credit are fetched fresh each time the page is served. While a concept is made, the photos are looked at once to
 * judge relevance (kept in memory, never written). These photos are preview-only: attribution is not permission, so the
 * publication gate blocks any concept that uses them until the owner supplies their own.
 */
export const LISTING_PREFIX = 'google-listing:';
export const listingUrl = (placeId: string, n: number) => `${LISTING_PREFIX}${placeId}#${n}`;
export function parseListing(url: string): { placeId: string; n: number } | undefined {
  const m = url.match(/^google-listing:([A-Za-z0-9_-]+)#(\d+)$/);
  return m ? { placeId: m[1], n: Number(m[2]) } : undefined;
}
export const isListing = (p: Pick<Photo, 'url'>) => p.url.startsWith(LISTING_PREFIX);

/** A neutral stand-in of the photo's shape: what is saved, measured and screenshotted in place of Google's image. */
export function placeholderSrc(width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#d9dbe0"/></svg>`)}`;
}

/**
 * The listing photo a saved position refers to, if Google still has it: positions move when Google reorders a
 * listing. This selects a CANDIDATE only, never verifies its identity. The caller must check its pixels before use.
 */
export function matchLive<T extends { width: number; height: number }>(live: T[] | null | undefined, n: number, size?: string): T | undefined {
  if (!live) return undefined;
  if (!size) return live[n];
  const [w, h] = size.split('x').map(Number);
  const same = (p: T) => p.width === w && p.height === h;
  if (live[n] && same(live[n])) return live[n];
  const all = live.filter(same);
  return all.length === 1 ? all[0] : undefined;
}

export interface ListingJudgement { n: number; width: number; height: number; kind: string; seen?: string; eligible: boolean; reason?: string; /** the judged image's fingerprint (photoFingerprint): its identity later, wherever Google moves it */ fp?: string }

/** Match a current catalog observation to exactly one saved judgement of the same dimensions. */
export function judgementFor(items: ListingJudgement[] | null | undefined, p: Pick<Photo, 'url' | 'width' | 'height' | 'fp'>): ListingJudgement | undefined {
  if (!parseListing(p.url) || !p.fp) return undefined;
  return samePhoto(p.fp, (items ?? []).filter((x) => x.width === p.width && x.height === p.height));
}

/**
 * What the completed photo checks saw, attached to the catalog's photos: the image check of the business's own photos
 * (by asset id) and the listing judgement of Google photos. A listing photo gets a judgement's description only with
 * that judgement's image fingerprint, and only when no other judged photo has the same fingerprint (unambiguous); the
 * fingerprint travels with the description, so the live page shows the photo only if Google still has that very picture
 * (verifyLivePhoto). A photo judged not to fit, or whose identity cannot be established, gets nothing and stays
 * unverified, with the reason in `unverified`. Returns how many listing photos were described.
 */
export function applyPhotoChecks(photos: Photo[], work: { seen?: Record<string, { kind: string; seen?: string; fp?: string }>; listing?: { items: ListingJudgement[] } | null }, unverified: { id: string; reason: string }[] = []): number {
  let described = 0;
  const judged = work.listing?.items ?? [];
  for (const p of photos) {
    const v = work.seen?.[p.id];
    if (v && !isListing(p)) {
      if (p.fp && samePhoto(p.fp, Object.values(work.seen ?? {})) === v) { p.seenKind = v.kind; if (v.seen) p.seen = v.seen; }
      else { delete p.seen; delete p.seenKind; unverified.push({ id: p.id, reason: 'saved website description has no matching fingerprint' }); }
      continue;
    }
    if (!isListing(p)) continue;
    const j = judgementFor(judged, p);
    if (!j) { unverified.push({ id: p.id, reason: 'no unambiguous fingerprint match for the current candidate' }); delete p.seen; delete p.seenKind; delete p.fp; continue; }
    if (!j.eligible || j.kind === 'unknown') { delete p.seen; delete p.seenKind; delete p.fp; continue; }
    if (!j.fp) { unverified.push({ id: p.id, reason: 'its check recorded no image fingerprint, so its identity cannot be established' }); continue; }
    if (samePhoto(j.fp, judged.filter((x) => x.fp)) !== j) { unverified.push({ id: p.id, reason: 'another judged photo has the same fingerprint, so which one was described is ambiguous' }); continue; }
    p.seenKind = j.kind;
    if (j.seen) p.seen = j.seen;
    p.fp = j.fp;
    described++;
  }
  return described;
}

/** Observe only catalog candidates. Position/size locates a candidate; pixels alone establish identity. */
export async function observeCatalogPhotos(photos: Photo[], deps: { photos?: typeof liveListingPhotos; download?: typeof downloadPhoto } = {}): Promise<void> {
  const listings = new Map<string, LivePhoto[]>();
  for (const p of photos.filter(isListing)) {
    delete p.fp; delete p.seen; delete p.seenKind;
    const at = parseListing(p.url)!;
    if (!listings.has(at.placeId)) listings.set(at.placeId, await (deps.photos ?? liveListingPhotos)(at.placeId).catch(() => []));
    const candidate = matchLive(listings.get(at.placeId), at.n, `${p.width}x${p.height}`);
    if (!candidate) continue;
    try { p.fp = await photoFingerprint(await (deps.download ?? downloadPhoto)(candidate.name, VERIFY_WIDTH_PX)); } catch { /* omitted by applyPhotoChecks */ }
  }
}

/** a listing photo a page shows: its place in the listing, its size, and the fingerprint of the picture it was described from */
export interface LiveRef { placeId: string; n: number; size?: string; fp?: string }
export type LiveVerdict = { ok: true; photo: LivePhoto; uri?: string } | { ok: false; reason: string };
/** a small copy is enough to fingerprint (the fingerprint is taken at 9×8) */
export const VERIFY_WIDTH_PX = 256;

/**
 * Whether the photo Google now has at a page's listing reference is the picture the page described: the candidate at
 * that place and size (matchLive) is fetched and its fingerprint compared with the one recorded. When a display URI
 * resolver is supplied, those exact display bytes are checked and the same URI returned.
 * Only that one candidate is fetched, never the whole listing. No recorded fingerprint, no candidate, a fetch that fails
 * or a different picture: not verified, with the reason; the photo is then left out of the page.
 */
export async function verifyLivePhoto(live: LivePhoto[] | null | undefined, ref: LiveRef, deps: { download?: (name: string, widthPx: number) => Promise<Buffer>; uri?: typeof livePhotoUri; width?: number } = {}): Promise<LiveVerdict> {
  if (!live) return { ok: false, reason: 'the listing could not be read for this view' };
  if (!validFingerprint(ref.fp)) return { ok: false, reason: 'no fingerprint was recorded for this photo, so it cannot be told from another photo of the same size' };
  const candidate = matchLive(live, ref.n, ref.size);
  if (!candidate) return { ok: false, reason: `the listing no longer has a ${ref.size ?? ''} photo at place ${ref.n}`.replace('  ', ' ') };
  // Resolve once, check those exact bytes and use the same URL for display. Never resolve a second image after checking.
  const uri = deps.uri && !candidate.name.startsWith('file:') ? await deps.uri(candidate.name, deps.width ?? 1600).catch(() => undefined) : undefined;
  if (deps.uri && !candidate.name.startsWith('file:') && !uri) return { ok: false, reason: 'the photo URL could not be resolved for this view' };
  const raw = await (deps.download ?? downloadPhoto)(uri ?? candidate.name, uri ? (deps.width ?? 1600) : VERIFY_WIDTH_PX).catch(() => undefined);
  if (!raw) return { ok: false, reason: 'the photo could not be fetched to check it' };
  const fp = await photoFingerprint(raw).catch(() => undefined);
  if (!fp) return { ok: false, reason: 'the photo could not be read to check it' };
  return samePhoto(fp, [{ fp: ref.fp }]) ? { ok: true, photo: candidate, ...(uri ? { uri } : {}) } : { ok: false, reason: 'the photo now at this place is a different picture from the one described' };
}

/**
 * Why a listing photo was left out of a page, kept so it can be looked into (the place, its position and size, the
 * reason and the page; never Google's photo name or image). Recording never delays or breaks the page.
 */
export function recordPhotoOmission(ref: LiveRef, reason: string, page: string): void {
  const at = new Date().toISOString();
  console.info(`[google photos] ${ref.placeId}#${ref.n} left out of ${page}: ${reason}`);
  void studioDocs.put('studio-photo-omissions', `${ref.placeId}-${ref.n}`, { placeId: ref.placeId, n: ref.n, size: ref.size ?? null, reason, page, at }).catch(() => undefined);
}

/**
 * Which of the listing's photos fit the business's page: looked at now (downloaded small, in memory) by the same
 * category-neutral classifier as the live builder. Graphics, text and unrelated scenes are left out, with the reason.
 */
export async function judgeListingPhotos(placeId: string, business: { name: string; category?: string }, deps: { photos?: typeof liveListingPhotos; download?: typeof downloadPhoto; label?: typeof labelPhotos } = {}): Promise<{ items: ListingJudgement[]; labelled: string; note?: string }> {
  const live = await (deps.photos ?? liveListingPhotos)(placeId);
  const got = await Promise.all(live.map(async (p, n) => {
    try { return { n, p, raw: await (deps.download ?? downloadPhoto)(p.name, 512) }; } catch (e) { return { n, p, error: (e as Error).message }; }
  }));
  const ok = got.filter((g): g is { n: number; p: LivePhoto; raw: Buffer } => 'raw' in g && !!g.raw);
  const items = ok.map((g): ProcessedPhoto => ({ raw: g.raw, photo: { ref: g.p.name, width: g.p.width, height: g.p.height, authors: g.p.authors }, image: { publicPath: '', width: g.p.width, height: g.p.height, alt: '', source: 'google' } }));
  const labels = await (deps.label ?? labelPhotos)(items, business);
  // each judged image's fingerprint, so a later step can tell which photo this was (never the image or its name)
  const fps = await Promise.all(ok.map((g) => photoFingerprint(g.raw).catch(() => undefined)));
  const judged: ListingJudgement[] = got.map((g) => {
    if (!('raw' in g) || !g.raw) return { n: g.n, width: g.p.width, height: g.p.height, kind: 'unknown', eligible: false, reason: `could not be looked at (${'error' in g ? g.error : 'no data'})` };
    const i = ok.indexOf(g as never);
    const kind = labels.kinds[i] ?? 'unknown';
    const seen = labels.seen[i];
    const eligible = kind !== 'other';
    return { n: g.n, width: g.p.width, height: g.p.height, kind, ...(seen ? { seen } : {}), ...(fps[i] ? { fp: fps[i] } : {}), eligible, ...(eligible ? {} : { reason: `classified as other${seen ? ` (${seen})` : ''}: graphics, text and unrelated scenes are kept off the page` }) };
  });
  return { items: judged, labelled: labels.source, ...(labels.note ? { note: labels.note } : {}) };
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * At serve time: each listing photo whose identity is verified (verifyLivePhoto: the candidate at its place, fetched
 * small, has the fingerprint the page recorded) becomes Google's image (a fresh, short-lived photoUri) and its credit slot
 * gets the photographer's name (linked when Google gives a profile) and "Google Maps", linking to the photo on Google
 * Maps. A photo that cannot be verified is left out, with its credit and any frame it leaves empty, and the reason is
 * recorded (recordPhotoOmission). Nothing of Google's is kept.
 */
export async function fillListingPhotos(html: string, deps: { photos?: typeof liveListingPhotos; uri?: typeof livePhotoUri; download?: (name: string, widthPx: number) => Promise<Buffer>; page?: string } = {}): Promise<string> {
  if (!html.includes('data-gphoto=')) return html;
  // a whole page is parsed as a document, so its doctype, <html lang>, <head> and <body> survive (a fragment parse drops
  // them, and a page without its doctype renders in quirks mode); a snippet stays a fragment
  const $ = load(html, {}, /^\s*(<!doctype\b|<html[\s>])/i.test(html));
  const listings = new Map<string, LivePhoto[] | null>();
  const verdicts = new Map<string, LiveVerdict>();
  for (const element of $('img[data-gphoto]').toArray()) {
    const img = $(element);
    const at = parseListing(`google-listing:${img.attr('data-gphoto')}`);
    if (!at) { img.remove(); continue; }
    const ref: LiveRef = { ...at, size: img.attr('data-gsize'), fp: img.attr('data-gfp') };
    const key = JSON.stringify(ref); // includes fingerprint: two descriptions at the same slot cannot share a verdict
    if (!listings.has(at.placeId)) listings.set(at.placeId, await (deps.photos ?? liveListingPhotos)(at.placeId).catch(() => null));
    let v = verdicts.get(key);
    if (!v) {
      v = await verifyLivePhoto(listings.get(at.placeId), ref, { ...deps, uri: deps.uri ?? livePhotoUri });
      verdicts.set(key, v);
    }
    // its credit: beside it in its frame, or (moved below the photo) linked to it by id
    const cid = img.attr('data-gcid');
    const credit = cid ? $(`[data-gcredit-for="${cid.replace(/[^a-z0-9]/gi, '')}"]`) : img.siblings('[data-gcredit]');
    if (!v.ok) {
      recordPhotoOmission(ref, v.reason, deps.page ?? 'a concept page');
      if (img.hasClass('hero-bg')) {
        const hero = img.closest('section');
        hero.removeClass('hero-photo').removeAttr('data-bg');
        const colour = hero.attr('data-text-color');
        if (colour && /^#[0-9a-f]{6}$/i.test(colour)) hero.attr('style', (hero.attr('style') ?? '').replace(/color:\s*#FFFFFF/gi, `color:${colour}`));
      }
      credit.remove();
      const parent = img.parent();
      img.replaceWith(`<!-- photo ${at.placeId}#${at.n} omitted: ${v.reason} -->`);
      if (parent.hasClass('gph') && !parent.find('img').length) parent.replaceWith(parent.html() ?? '');
      continue;
    }
    if (v.uri) img.attr('src', v.uri).removeAttr('srcset');
    else img.attr('src', `/gphoto/${at.placeId}/${at.n}?s=${ref.size}&f=${ref.fp}`); // local fixtures
    const p = v.photo;
    const who = p.authors.length ? p.authors.map((a) => a.uri ? `<a href="${escAttr(a.uri)}" target="_blank" rel="noopener">${escAttr(a.name)}</a>` : escAttr(a.name)).join(', ') : 'Google user';
    const maps = p.mapsUri ? `<a href="${escAttr(p.mapsUri)}" target="_blank" rel="noopener" translate="no">Google Maps</a>` : '<span translate="no">Google Maps</span>';
    credit.html(`Photo: ${who} · ${maps}`);
  }
  $('.tile, .hero-aside').each((_, el) => { if (!$(el).find('img').length && !$(el).text().trim()) $(el).remove(); });
  return $.html();
}

/** The credit's look: in the photo's corner, readable on any picture (Roboto or sans-serif, 12px, white on dark). */
export const LISTING_CSS = `.gcredit{position:absolute;right:8px;bottom:8px;z-index:3;max-width:calc(100% - 16px);padding:3px 8px;border-radius:6px;background:rgba(17,17,17,.72);color:#fff;font:400 12px/1.4 Roboto,Arial,sans-serif;white-space:normal;overflow-wrap:break-word}
.gcredit a{color:#fff;text-decoration:underline}
:where(figure,div,a,li,picture):has(> img[data-gphoto]){position:relative}`;
