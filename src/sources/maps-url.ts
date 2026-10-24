import { fetchRaw } from '../util/http.js';

export type LookupIntent =
  | { kind: 'placeId'; placeId: string; name?: string; lat?: number; lng?: number }
  | { kind: 'text'; query: string; lat?: number; lng?: number; cid?: string }
  | { kind: 'short'; url: string };

const PLACE_ID_RE = /^(ChIJ|GhIJ|EiI|Ej|Ei)[A-Za-z0-9_-]{10,}$/;
const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.page', 'g.co', 'share.google'];

export function isPlaceId(s: string) {
  return PLACE_ID_RE.test(s.trim());
}

const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' ')).trim();

/**
 * Turn whatever the client sends ("Joe's Roofing 78701", a Google Maps link,
 * a maps.app.goo.gl short link, a place ID) into something the Places API can resolve.
 */
export function parseLookupInput(input: string): LookupIntent {
  const raw = input.trim();
  if (isPlaceId(raw)) return { kind: 'placeId', placeId: raw };
  const pid = raw.match(/place_id[:=]([A-Za-z0-9_-]{20,})/);
  if (pid) return { kind: 'placeId', placeId: pid[1] };

  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes('.') || /\s/.test(raw)) url = null;
  } catch {
    url = null;
  }
  if (!url) return { kind: 'text', query: raw };

  const host = url.hostname.replace(/^www\./, '');
  if (SHORT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) && !url.pathname.startsWith('/maps/place')) {
    return { kind: 'short', url: url.toString() };
  }
  if (!/google\./.test(host)) return { kind: 'text', query: raw }; // not a Google link; treat as text (maybe a website)

  const q = url.searchParams;
  const qpid = q.get('query_place_id') || q.get('place_id');
  if (qpid) return { kind: 'placeId', placeId: qpid };

  // Coordinates: /@lat,lng,zoom  or  !3dLAT!4dLNG in the data blob (more precise: the pin itself)
  let lat: number | undefined, lng: number | undefined;
  const pin = url.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (pin) { lat = Number(pin[1]); lng = Number(pin[2]); } else if (at) { lat = Number(at[1]); lng = Number(at[2]); }

  // Place ID sometimes appears as !19sChIJ... in the data blob
  const dataPid = url.href.match(/!19s(ChIJ[A-Za-z0-9_-]+)/);
  const name = url.pathname.match(/\/maps\/place\/([^/@]+)/)?.[1];
  if (dataPid) return { kind: 'placeId', placeId: dataPid[1], name: name ? decode(name) : undefined, lat, lng };

  const cidHex = url.href.match(/!1s0x[0-9a-f]+:(0x[0-9a-f]+)/i)?.[1];
  const cid = q.get('cid') || (cidHex ? BigInt(cidHex).toString() : undefined);

  if (name) return { kind: 'text', query: decode(name), lat, lng, cid };
  const search = url.pathname.match(/\/maps\/search\/([^/@]+)/)?.[1];
  if (search) return { kind: 'text', query: decode(search), lat, lng, cid };
  const qq = q.get('q') || q.get('query');
  if (qq) return { kind: 'text', query: qq.trim(), lat, lng, cid };
  if (cid) return { kind: 'text', query: '', lat, lng, cid };
  return { kind: 'text', query: raw, lat, lng };
}

/** Follow a short link (maps.app.goo.gl/…) to the long Google Maps URL, then parse it. */
export async function resolveLookupInput(input: string): Promise<LookupIntent> {
  let intent = parseLookupInput(input);
  for (let i = 0; i < 2 && intent.kind === 'short'; i++) {
    const res = await fetchRaw(intent.url, { timeoutMs: 8000, maxBytes: 200_000 });
    let target = res.url;
    if (target === intent.url) {
      // Some short links use a JS/meta redirect instead of a 30x
      const html = res.body.toString('utf8');
      const m = html.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps[^"'\s<>]+/);
      if (m) target = m[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    }
    if (target === intent.url) throw new Error(`Could not expand short link ${intent.url}${res.error ? `: ${res.error}` : ''}`);
    intent = parseLookupInput(target);
  }
  return intent;
}
