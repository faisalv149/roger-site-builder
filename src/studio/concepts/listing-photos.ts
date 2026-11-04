import type { ProcessedPhoto } from '../../brand/photos.js';
import { labelPhotos } from '../../design/photos.js';
import { downloadPhoto, liveListingPhotos, livePhotoUri, type LivePhoto } from '../../sources/places.js';
import type { Photo } from './review.js';

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
 * listing, so the photo at position n is used only when its size matches the one judged and placed; otherwise the
 * one photo of that exact size is used; otherwise none (never a different photo shown in its place).
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

export interface ListingJudgement { n: number; width: number; height: number; kind: string; seen?: string; eligible: boolean; reason?: string }

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
  const judged: ListingJudgement[] = got.map((g) => {
    if (!('raw' in g) || !g.raw) return { n: g.n, width: g.p.width, height: g.p.height, kind: 'unknown', eligible: false, reason: `could not be looked at (${'error' in g ? g.error : 'no data'})` };
    const i = ok.indexOf(g as never);
    const kind = labels.kinds[i] ?? 'unknown';
    const seen = labels.seen[i];
    const eligible = kind !== 'other';
    return { n: g.n, width: g.p.width, height: g.p.height, kind, ...(seen ? { seen } : {}), eligible, ...(eligible ? {} : { reason: `classified as other${seen ? ` (${seen})` : ''}: graphics, text and unrelated scenes are kept off the page` }) };
  });
  return { items: judged, labelled: labels.source, ...(labels.note ? { note: labels.note } : {}) };
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * At serve time: each listing photo's stand-in becomes Google's image (a fresh, short-lived photoUri) and its credit
 * slot gets the photographer's name (linked when Google gives a profile) and "Google Maps", linking to the photo on
 * Google Maps. A photo Google no longer returns stays a neutral stand-in, credited as unavailable. Nothing is kept.
 */
export async function fillListingPhotos(html: string, deps: { photos?: typeof liveListingPhotos; uri?: typeof livePhotoUri } = {}): Promise<string> {
  const refs = [...html.matchAll(/data-gphoto="([A-Za-z0-9_-]+)#(\d+)"(?: data-gsize="(\d+x\d+)")?/g)].map((m) => ({ placeId: m[1], n: Number(m[2]), size: m[3] }));
  const sizeOf = new Map(refs.map((r) => [`${r.placeId}#${r.n}`, r.size]));
  if (!refs.length) return html;
  const byPlace = new Map<string, LivePhoto[] | null>();
  for (const placeId of new Set(refs.map((r) => r.placeId))) byPlace.set(placeId, await (deps.photos ?? liveListingPhotos)(placeId).catch(() => null));
  const uris = new Map<string, string | undefined>();
  for (const r of refs) {
    const k = `${r.placeId}#${r.n}`;
    if (uris.has(k)) continue;
    const p = matchLive(byPlace.get(r.placeId), r.n, r.size);
    uris.set(k, p ? await (deps.uri ?? livePhotoUri)(p.name, 1600).catch(() => undefined) : undefined);
  }
  let out = html.replace(/(<img\b[^>]*?)\ssrc="data:image\/svg\+xml[^"]*"([^>]*?data-gphoto="([A-Za-z0-9_-]+)#(\d+)"[^>]*>)/g, (all, a: string, b: string, placeId: string, n: string) => {
    const u = uris.get(`${placeId}#${n}`);
    return u ? `${a} src="${escAttr(u)}"${b}` : all;
  });
  out = out.replace(/<span class="gcredit" data-gcredit="([A-Za-z0-9_-]+)#(\d+)"><\/span>/g, (_all, placeId: string, n: string) => {
    const p = matchLive(byPlace.get(placeId), Number(n), sizeOf.get(`${placeId}#${n}`));
    if (!p) return `<span class="gcredit" data-gcredit="${placeId}#${n}">Photo unavailable · Google Maps</span>`;
    const who = p.authors.length ? p.authors.map((a) => (a.uri ? `<a href="${escAttr(a.uri)}" target="_blank" rel="noopener">${escAttr(a.name)}</a>` : escAttr(a.name))).join(', ') : 'Google user';
    const maps = p.mapsUri ? `<a href="${escAttr(p.mapsUri)}" target="_blank" rel="noopener" translate="no">Google Maps</a>` : '<span translate="no">Google Maps</span>';
    return `<span class="gcredit" data-gcredit="${placeId}#${n}">Photo: ${who} · ${maps}</span>`;
  });
  return out;
}

/** The credit's look: in the photo's corner, readable on any picture (Roboto or sans-serif, 12px, white on dark). */
export const LISTING_CSS = `.gcredit{position:absolute;right:8px;bottom:8px;z-index:3;max-width:calc(100% - 16px);padding:3px 8px;border-radius:6px;background:rgba(17,17,17,.72);color:#fff;font:400 12px/1.4 Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcredit a{color:#fff;text-decoration:underline}
:where(figure,div,a,li,picture):has(> img[data-gphoto]){position:relative}`;
