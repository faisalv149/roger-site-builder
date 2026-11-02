import sharp from 'sharp';
import type { Photo } from '../types.js';
import { fetchRaw } from '../util/http.js';
import type { SiteContent, SourceImage } from './site-content.js';
import { extractorResult, type ExtractorResult } from '../content/extraction.js';

/**
 * The pictures a business shows on its own website, fetched at full size, measured, and de-duplicated, with every
 * failure recorded (what was asked for, what came back) instead of silently dropped. The downloads are kept so the
 * photo pipeline (which also accepts plain URLs) doesn't fetch them a second time.
 */
const prefetched = new Map<string, Buffer>();
export const takePrefetched = (url: string): Buffer | undefined => { const b = prefetched.get(url); prefetched.delete(url); return b; };

export interface ImageRecord {
  url: string;
  role: SourceImage['role'];
  alt?: string;
  ok: boolean;
  /** why a picture that downloaded was still not used */
  skipped?: 'too small' | 'duplicate' | 'not a photo' | 'unreadable';
  status?: number;
  error?: string;
  width?: number;
  height?: number;
  kb?: number;
  duplicateOf?: string;
}

/** A 9×8 brightness fingerprint: the same picture at another size or crop lands within a few bits. */
async function fingerprint(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] < px[y * 9 + x + 1] ? 1n : 0n);
  return bits;
}
const distance = (a: bigint, b: bigint) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/** A full-size original can be 18 MB; image CDNs serve a right-sized copy of the same picture. */
export function sizedUrl(original: string): string {
  try {
    const u = new URL(original);
    if (/static\.wixstatic\.com$/.test(u.hostname) && /^\/media\/[^/]+$/.test(u.pathname)) return `${u.origin}${u.pathname}/v1/fit/w_2000,h_2000,q_85/file.jpg`;
  } catch { /* use the address as given */ }
  return original;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Image hosts reset connections when too many arrive at once. Ask politely: spaced requests, and a pause then another
 * try when the connection is reset (status 0), which is what a rate limit looks like. A real 404 is not retried.
 */
export async function fetchPatiently(urls: string[], opts: { timeoutMs: number; maxBytes: number }, attempts = 4) {
  let last = await fetchRaw(urls[0], opts);
  for (let i = 0; i < attempts && !last.ok; i++) {
    const u = urls[i % urls.length];
    // a rate limit lasts longer than a blip: wait a little, then a lot
    if (i > 0 || last.status === 0) await sleep([900, 2500, 6000, 15000][Math.min(i, 3)]);
    last = await fetchRaw(u, opts);
    if (last.ok || (last.status >= 400 && last.status !== 429)) break;
  }
  return last;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

export async function fetchSiteImages(content: SiteContent, opts: { pageUrl: string; minWidth: number; minHeight: number; max?: number }): Promise<{ photos: Photo[]; posters: Map<string, Buffer>; records: ImageRecord[]; report: ExtractorResult }> {
  const wanted = content.images.filter((i) => i.role === 'content' || i.role === 'team').slice(0, opts.max ?? 24);
  const posterUrls = content.images.filter((i) => i.role === 'poster');
  const records: ImageRecord[] = [];
  const kept: { img: SourceImage; buf: Buffer; width: number; height: number; fp: bigint }[] = [];

  const got = await mapLimit(wanted, 2, async (img) => {
    await sleep(150);
    const r = await fetchPatiently([...new Set([sizedUrl(img.url), img.url, img.seen])], { timeoutMs: 20_000, maxBytes: 20_000_000 });
    if (!r.ok) return { img, rec: { url: img.url, role: img.role, alt: img.alt, ok: false, status: r.status, error: r.status === 0 ? `the host kept resetting the connection (${r.error || 'network error'}), likely a rate limit` : r.error || `HTTP ${r.status}` } as ImageRecord };
    try {
      const meta = await sharp(r.body).metadata();
      const width = meta.width || 0, height = meta.height || 0;
      const rec: ImageRecord = { url: img.url, role: img.role, alt: img.alt, ok: true, status: r.status, width, height, kb: Math.round(r.body.length / 1024) };
      if (width < opts.minWidth || height < opts.minHeight) return { img, rec: { ...rec, skipped: 'too small' as const } };
      return { img, rec, buf: r.body, width, height, fp: await fingerprint(r.body) };
    } catch (e) {
      return { img, rec: { url: img.url, role: img.role, alt: img.alt, ok: false, skipped: 'unreadable' as const, status: r.status, error: `could not decode the image: ${(e as Error).message.slice(0, 80)}` } as ImageRecord };
    }
  });
  for (const g of got) {
    records.push(g.rec);
    if (!('buf' in g) || !g.buf) continue;
    const twin = kept.find((k) => distance(k.fp, g.fp!) <= 5);
    if (twin) {
      g.rec.skipped = 'duplicate';
      g.rec.duplicateOf = twin.img.url;
      // keep the larger of the two
      if (g.width! * g.height! > twin.width * twin.height) { twin.img = g.img; twin.buf = g.buf; twin.width = g.width!; twin.height = g.height!; twin.fp = g.fp!; }
      continue;
    }
    kept.push({ img: g.img, buf: g.buf, width: g.width!, height: g.height!, fp: g.fp! });
  }

  const posters = new Map<string, Buffer>();
  await mapLimit(posterUrls, 2, async (p) => {
    await sleep(150);
    const r = await fetchPatiently([...new Set([sizedUrl(p.url), p.seen, p.url])], { timeoutMs: 15_000, maxBytes: 8_000_000 });
    if (r.ok) posters.set(p.key, r.body);
    records.push({ url: p.url, role: 'poster', alt: p.alt, ok: r.ok, status: r.status, error: r.ok ? undefined : r.error || `HTTP ${r.status}` });
  });

  const photos: Photo[] = kept.map((k) => {
    prefetched.set(k.img.url, k.buf); // the address the pipeline will ask for
    return { ref: k.img.url, width: k.width, height: k.height, authors: [], isOwner: true, source: 'website', origin: { pageUrl: opts.pageUrl, alt: k.img.altKind === 'descriptive' ? k.img.alt : undefined, role: k.img.role } };
  });
  const failed = records.filter((r) => !r.ok).length;
  const small = records.filter((r) => r.skipped === 'too small').length;
  const dup = records.filter((r) => r.skipped === 'duplicate').length;
  const report = !wanted.length
    ? extractorResult('photos', 'skipped', 'the page shows no photographs to import', 0)
    : extractorResult('photos', photos.length && !failed ? 'success' : photos.length ? 'partial' : 'failed',
      `${photos.length} of ${wanted.length} usable${failed ? `; ${failed} failed to download (${records.filter((r) => !r.ok).slice(0, 2).map((r) => r.error).join('; ')})` : ''}${small ? `; ${small} too small` : ''}${dup ? `; ${dup} duplicate${dup > 1 ? 's' : ''} of another picture` : ''}`, photos.length, wanted.length);
  return { photos, posters, records, report };
}
