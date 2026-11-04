import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { Business, BusinessCandidate, OpeningPeriod, Photo } from '../types.js';
import { fetchJson, fetchRaw } from '../util/http.js';
import { resolveLookupInput, type LookupIntent } from './maps-url.js';
import { geographicReason } from './identity.js';
import { takePrefetched } from './site-images.js';

// Google Places API (New) — https://developers.google.com/maps/documentation/places/web-service
// Note what Places does NOT return: a logo, brand colors, fonts, or a services list.
// Those come from the business website (brand/logo.ts) or the theme defaults.

const BASE = 'https://places.googleapis.com/v1';

const SEARCH_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount',
  'places.primaryTypeDisplayName', 'places.primaryType', 'places.types', 'places.nationalPhoneNumber', 'places.websiteUri', 'places.googleMapsUri', 'places.photos',
].join(',');

const DETAIL_FIELDS = [
  'id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'formattedAddress', 'shortFormattedAddress',
  'addressComponents', 'location', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri',
  'regularOpeningHours', 'utcOffsetMinutes', 'rating', 'userRatingCount', 'reviews', 'photos', 'businessStatus', 'editorialSummary',
].join(',');

function headers(fieldMask: string) {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleKey, 'X-Goog-FieldMask': fieldMask };
}

// ───────────────────────── mock mode ─────────────────────────
const MOCK_DIR = path.join(config.dirs.fixtures, 'places');
function mockBusinesses(): Business[] {
  if (!fs.existsSync(MOCK_DIR)) return [];
  return fs
    .readdirSync(MOCK_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(MOCK_DIR, f), 'utf8').replaceAll('{{BASE}}', config.publicBaseUrl)) as Business);
}
function score(b: Business, q: string): number {
  const hay = `${b.name} ${b.formattedAddress} ${b.zip} ${b.city} ${b.website || ''} ${b.placeId}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .reduce((s, w) => s + (hay.includes(w) ? (w.length > 3 ? 2 : 1) : 0), 0);
}
const toCandidate = (b: Business): BusinessCandidate => ({
  placeId: b.placeId, name: b.name, address: b.formattedAddress, rating: b.rating, reviewCount: b.reviewCount,
  primaryTypeLabel: b.primaryTypeLabel, primaryType: b.primaryType, types: b.types, phone: b.phone, googleWebsite: b.website, website: b.website, mapsUrl: b.mapsUrl, photoRef: b.photos[0]?.ref,
});

// ───────────────────────── search ─────────────────────────
export interface SearchResult {
  intent: LookupIntent;
  /** businesses only: places that are just a postal code, a town or a street are left out */
  candidates: BusinessCandidate[];
  /** results that were turned down, and why */
  rejected: { placeId: string; name: string; reason: string }[];
}

/** Keep businesses; set aside the postal codes, towns and streets Google also returns for a name or ZIP. */
function onlyBusinesses(all: BusinessCandidate[]): Pick<SearchResult, 'candidates' | 'rejected'> {
  const candidates: BusinessCandidate[] = [];
  const rejected: SearchResult['rejected'] = [];
  for (const c of all) {
    const why = geographicReason({ name: c.name, types: c.types, primaryType: c.primaryType, primaryTypeLabel: c.primaryTypeLabel, address: c.address });
    if (why) rejected.push({ placeId: c.placeId, name: c.name, reason: why }); else candidates.push(c);
  }
  return { candidates, rejected };
}

export async function searchCandidates(input: string, opts: { zip?: string; limit?: number } = {}): Promise<SearchResult> {
  const intent = await resolveLookupInput(input);
  const limit = opts.limit ?? 5;

  if (config.mock) {
    const all = mockBusinesses();
    if (intent.kind === 'placeId') {
      const hit = all.find((b) => b.placeId === intent.placeId);
      return { intent, ...onlyBusinesses(hit ? [toCandidate(hit)] : []) };
    }
    const q = intent.kind === 'text' ? `${intent.query} ${opts.zip || ''}` : input;
    const ranked = all.map((b) => ({ b, s: score(b, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return { intent, ...onlyBusinesses(ranked.slice(0, limit).map((x) => toCandidate(x.b))) };
  }

  if (intent.kind === 'placeId') {
    const b = await getBusiness(intent.placeId, { skipTowns: true });
    return { intent, ...onlyBusinesses([toCandidate(b)]) };
  }
  if (intent.kind !== 'text') throw new Error('Unresolved short link');
  const textQuery = [intent.query, opts.zip].filter(Boolean).join(' ').trim();
  if (!textQuery) throw new Error('Nothing to search for. Send a business name, a zip code, or a Google Maps link.');
  const body: Record<string, unknown> = { textQuery, pageSize: limit };
  if (intent.lat !== undefined && intent.lng !== undefined) {
    body.locationBias = { circle: { center: { latitude: intent.lat, longitude: intent.lng }, radius: 2000 } };
  }
  const res = await fetchJson<{ places?: any[] }>(`${BASE}/places:searchText`, { method: 'POST', headers: headers(SEARCH_FIELDS), body: JSON.stringify(body) });
  const all = (res.places || []).map(
    (p): BusinessCandidate => ({
      placeId: p.id,
      name: p.displayName?.text,
      address: p.formattedAddress,
      rating: p.rating,
      reviewCount: p.userRatingCount,
      primaryTypeLabel: p.primaryTypeDisplayName?.text,
      primaryType: p.primaryType,
      types: p.types || [],
      phone: p.nationalPhoneNumber,
      googleWebsite: p.websiteUri,
      website: p.websiteUri,
      mapsUrl: p.googleMapsUri,
      photoRef: p.photos?.[0]?.name,
    }),
  );
  return { intent, ...onlyBusinesses(all) };
}

// ───────────────────────── details ─────────────────────────
function comp(components: any[], type: string, short = false): string | undefined {
  const c = components?.find((x) => x.types?.includes(type));
  return c ? (short ? c.shortText : c.longText) : undefined;
}

/**
 * A part of an address that can't be a town on its own: a bare numeral or block letter. Google sometimes splits a
 * district's name and files its tail as the locality ("Gulberg" + "III" for Gulberg III, Lahore).
 */
const notAPlaceName = (s?: string) => !s || /^(?:[ivxlcdm]+|\d+[a-z]?|[a-z])\.?$/i.test(s.trim());
/** administrative areas that are not a town: a county, district, division, cantonment... */
const ADMIN_UNIT = /\b(county|district|division|parish|borough|region|province|department|municipality|prefecture|tehsil|cantt|cantonment|governorate|oblast)\b/i;

/**
 * The town or city of an address, from its structured parts: the locality (or postal town), never a sublocality or
 * neighbourhood (a district such as Gulberg III is not the city). When the locality is missing or isn't a place name,
 * the nearest administrative area named like a town is used ("Lahore"); a county or region never is. Unknown otherwise.
 */
export function cityFromComponents(components: { types?: string[]; longText?: string }[]): string | undefined {
  for (const t of ['locality', 'postal_town']) { const v = comp(components, t); if (!notAPlaceName(v)) return v; }
  for (const t of ['administrative_area_level_3', 'administrative_area_level_2']) { const v = comp(components, t); if (!notAPlaceName(v) && !ADMIN_UNIT.test(v!)) return v; }
  return undefined;
}

export function is24h(periods: OpeningPeriod[] | undefined): boolean {
  if (!periods?.length) return false;
  if (periods.length === 1 && !periods[0].close && periods[0].open.hour === 0 && periods[0].open.minute === 0) return true;
  // 7 periods each open 00:00 → 23:59/24:00
  return periods.length >= 7 && periods.every((p) => p.open.hour === 0 && p.open.minute === 0 && (!p.close || (p.close.hour === 23 && p.close.minute >= 59) || (p.close.hour === 0 && p.close.minute === 0)));
}

export async function getBusiness(placeId: string, opts: { skipTowns?: boolean } = {}): Promise<Business> {
  if (config.mock) {
    const hit = mockBusinesses().find((b) => b.placeId === placeId);
    if (!hit) throw new Error(`Mock place ${placeId} not found (add a fixture in fixtures/places/)`);
    return hit;
  }
  const p = await fetchJson<any>(`${BASE}/places/${encodeURIComponent(placeId)}`, { headers: headers(DETAIL_FIELDS) });
  const ac = p.addressComponents || [];
  const streetNo = comp(ac, 'street_number');
  const route = comp(ac, 'route');
  const name: string = p.displayName?.text || 'Business';
  const photos: Photo[] = (p.photos || []).map((ph: any) => {
    const authors = (ph.authorAttributions || []).map((a: any) => ({ name: a.displayName, uri: a.uri }));
    return {
      ref: ph.name,
      width: ph.widthPx,
      height: ph.heightPx,
      authors,
      isOwner: authors.some((a: any) => sameName(a.name, name)),
    };
  });
  const b: Business = {
    placeId: p.id,
    name,
    primaryType: p.primaryType,
    primaryTypeLabel: p.primaryTypeDisplayName?.text,
    types: p.types || [],
    formattedAddress: p.formattedAddress,
    shortAddress: p.shortFormattedAddress,
    street: [streetNo, route].filter(Boolean).join(' ') || undefined,
    // Sublocalities are districts (e.g. Gulberg III), not city names.
    city: cityFromComponents(ac),
    state: comp(ac, 'administrative_area_level_1', true),
    zip: comp(ac, 'postal_code'),
    country: comp(ac, 'country', true),
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: p.nationalPhoneNumber,
    phoneE164: p.internationalPhoneNumber?.replace(/[^\d+]/g, ''),
    website: p.websiteUri,
    mapsUrl: p.googleMapsUri,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    reviews: (p.reviews || []).map((r: any) => ({
      author: r.authorAttribution?.displayName || 'Google user',
      authorUri: r.authorAttribution?.uri,
      rating: r.rating,
      text: r.text?.text || r.originalText?.text || '',
      relativeTime: r.relativePublishTimeDescription,
      publishTime: r.publishTime,
    })),
    photos,
    hours: p.regularOpeningHours
      ? { periods: p.regularOpeningHours.periods || [], weekdayText: p.regularOpeningHours.weekdayDescriptions || [] }
      : undefined,
    utcOffsetMinutes: p.utcOffsetMinutes,
    businessStatus: p.businessStatus,
    editorialSummary: p.editorialSummary?.text,
    nearbyTowns: [],
    source: 'places',
  };
  // Proximity is not a business-stated service area. Do not fetch nearby towns for website copy.
  return b;
}

/** Towns around the business (for the service-area section). Places has no service-area field. */
export async function nearbyTowns(lat: number, lng: number, radiusM = 25000): Promise<string[]> {
  const res = await fetchJson<{ places?: any[] }>(`${BASE}/places:searchNearby`, {
    method: 'POST',
    headers: headers('places.displayName'),
    body: JSON.stringify({
      includedTypes: ['locality'],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
    }),
  });
  return [...new Set((res.places || []).map((p) => p.displayName?.text).filter(Boolean))] as string[];
}

/** Download a photo (Places media endpoint, local fixture, or plain URL). */
export async function downloadPhoto(ref: string, maxWidthPx = 1600): Promise<Buffer> {
  const already = takePrefetched(ref); // a website photo that was already fetched and measured
  if (already) return already;
  if (ref.startsWith('file:')) return fs.readFileSync(path.resolve(config.dirs.fixtures, '..', ref.slice(5)));
  const url = /^https?:/.test(ref) ? ref : `${BASE}/${ref}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(config.googleKey)}`;
  const res = await fetchRaw(url, { timeoutMs: 15000, maxBytes: 15_000_000 });
  if (!res.ok) throw new Error(`photo ${res.status} ${res.error || ''}`);
  return res.body;
}

/**
 * A listing's photos as Google returns them now, for showing on a page being served now: Google's photo names expire
 * and may not be cached (Maps Platform terms 3.2.3, Service Specific Terms 14.3), so these are fetched per view and
 * never stored. Order is the listing's own; mapsUri opens the photo on Google Maps (required access to the source).
 */
export interface LivePhoto { name: string; width: number; height: number; authors: { name: string; uri?: string }[]; mapsUri?: string }
export async function liveListingPhotos(placeId: string): Promise<LivePhoto[]> {
  if (config.mock) {
    const hit = mockBusinesses().find((b) => b.placeId === placeId);
    return (hit?.photos ?? []).filter((p) => p.source !== 'website').map((p) => ({ name: p.ref, width: p.width, height: p.height, authors: p.authors }));
  }
  const p = await fetchJson<any>(`${BASE}/places/${encodeURIComponent(placeId)}`, { headers: headers('photos') });
  return (p.photos || []).map((ph: any) => ({ name: ph.name, width: ph.widthPx, height: ph.heightPx, authors: (ph.authorAttributions || []).map((a: any) => ({ name: a.displayName, uri: a.uri })), mapsUri: ph.googleMapsUri }));
}
/** The image's own short-lived address (Place Photos photoUri), for the response being sent now; never stored. */
export async function livePhotoUri(name: string, maxWidthPx = 1600): Promise<string | undefined> {
  if (config.mock || /^(file:|https?:)/.test(name)) return undefined;
  const r = await fetchJson<{ photoUri?: string }>(`${BASE}/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true&key=${encodeURIComponent(config.googleKey)}`);
  return r.photoUri;
}

export function sameName(a: string | undefined, b: string | undefined): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\b(llc|inc|co|company|the)\b/g, '').replace(/[^a-z0-9]/g, '');
  if (!a || !b) return false;
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
