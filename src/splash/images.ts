/**
 * Website and owner photos on a splash page, served at the size the screen needs. A business's website often holds
 * the original upload (a Wix photo 11,174 px wide), which a phone cannot load. Roger fetches it once, keeps a master
 * no larger than 2400 px, and serves sized copies (AVIF, WebP or JPEG, as the browser accepts) from
 * /api/splash/<job>/img/<photo>/<width>, cached in "splash-images". Only the job's own photos are served, and only from
 * public addresses. Google listing photos never come here: they stay live from Google, with their credits.
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import sharp from 'sharp';
import { studioDocs } from '../store.js';
import { fetchRaw, type FetchOpts, type FetchResult } from '../util/http.js';

export const IMAGE_WIDTHS = [480, 800, 1200, 1600, 2000] as const;
const MASTER = 2400;
export type ImageFormat = 'avif' | 'webp' | 'jpeg';
const TYPES: Record<ImageFormat, string> = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' };

export class ImageError extends Error { constructor(public status: number, message: string) { super(message); } }

/** the best format the browser says it accepts */
export const formatFor = (accept = ''): ImageFormat => /image\/avif/i.test(accept) ? 'avif' : /image\/webp/i.test(accept) ? 'webp' : 'jpeg';

/** a loopback, private, link-local or otherwise internal address */
export function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

/** an http(s) address whose host resolves only to public addresses */
export async function isPublicUrl(u: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<boolean> {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  const addrs = net.isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  return addrs.length > 0 && !addrs.some(privateAddress);
}

/** where to ask first: hosts that can make a smaller copy themselves, so an 11,000 px original is never downloaded */
export function upstreamUrl(src: string): string {
  try {
    const u = new URL(src);
    const file = u.pathname.split('/').pop() ?? '';
    if (u.hostname === 'static.wixstatic.com' && /^\/media\/[^/]+$/.test(u.pathname)) return `${src.split('?')[0]}/v1/fit/w_${MASTER},h_${MASTER},q_90/${file}`;
    if (/(^|\.)squarespace-cdn\.com$/.test(u.hostname)) { u.searchParams.set('format', '2500w'); return u.toString(); }
  } catch { /* not a URL: asked as given, and refused there */ }
  return src;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
interface Stored { key: string; src: string; type: string; data: string }
const inflight = new Map<string, Promise<Buffer>>();

/** what came back from the image host */
export interface Fetched { ok: boolean; status: number; url: string; type: string; body: Buffer; truncated?: boolean; error?: string }
export interface ImageDeps {
  fetch?: (url: string, opts: FetchOpts) => Promise<FetchResult>;
  resolve?: (host: string) => Promise<string[]>;
  /** the browser's own request, for hosts that reset anything else (Wix); false: none */
  browser?: false | ((url: string, allow: (u: string) => Promise<boolean>) => Promise<Fetched>);
}

/** Chromium asks for the image as a visitor's browser would; every request it makes is checked first */
export async function browserFetch(url: string, allow: (u: string) => Promise<boolean>): Promise<Fetched> {
  const { launchBrowser } = await import('../render/og.js');
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.route('**/*', async (route) => (await allow(route.request().url())) ? route.continue() : route.abort('blockedbyclient'));
    // a camera original is larger than the inspector keeps by default
    const cdp = await page.context().newCDPSession(page).catch(() => undefined);
    await cdp?.send('Network.enable', { maxResourceBufferSize: 60_000_000, maxTotalBufferSize: 120_000_000 }).catch(() => undefined);
    const r = await page.goto(url, { timeout: 30000 });
    if (!r) return { ok: false, status: 0, url, type: '', body: Buffer.alloc(0), error: 'no response' };
    return { ok: r.ok(), status: r.status(), url: r.url(), type: r.headers()['content-type'] ?? '', body: await r.body() };
  } catch (e) {
    return { ok: false, status: 0, url, type: '', body: Buffer.alloc(0), error: (e as Error).message.slice(0, 200) };
  } finally { await browser.close().catch(() => undefined); }
}

/** the image from its host: a plain request (every hop checked), else the browser's when the host resets plain ones */
async function fetchImage(u: string, deps: ImageDeps): Promise<Fetched> {
  const allow = (x: string) => isPublicUrl(x, deps.resolve);
  const r = await (deps.fetch ?? fetchRaw)(u, { timeoutMs: 25000, maxBytes: 40_000_000, allow, headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' } });
  const plain: Fetched = { ok: r.ok, status: r.status, url: r.url, type: r.headers['content-type'] ?? '', body: r.body, truncated: r.truncated, error: r.error };
  if (r.status !== 0 || r.error === 'address not allowed' || deps.browser === false) return plain;
  return (deps.browser ?? browserFetch)(u, allow);
}

/** the master: the original, fetched once, turned upright and kept no larger than 2400 px */
async function master(src: string, deps: ImageDeps): Promise<Buffer> {
  const key = `m-${hash(src)}`;
  const doc = await studioDocs.get<Stored>('splash-images', key);
  if (doc) return Buffer.from(doc.data, 'base64');
  const running = inflight.get(key);
  if (running) return running;
  // a photo that could not be fetched moments ago is not tried again for ten minutes (the page falls back at once)
  if ((failedAt.get(key) ?? 0) > Date.now() - 10 * 60_000) throw new ImageError(502, 'The photo could not be fetched from the website.');
  const work = (async () => {
    if (!(await isPublicUrl(src, deps.resolve))) throw new ImageError(403, 'The photo is not at a public address.');
    let body: Buffer | undefined;
    for (const u of [...new Set([upstreamUrl(src), src])]) {
      const res = await fetchImage(u, deps);
      if (!res.ok || res.truncated || /svg|html|text\//i.test(res.type) || !(await isPublicUrl(res.url, deps.resolve))) continue;
      body = res.body;
      break;
    }
    if (!body?.length) throw new ImageError(502, 'The photo could not be fetched from the website.');
    const out = await sharp(body, { limitInputPixels: 150_000_000 }).rotate().resize({ width: MASTER, height: MASTER, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
      .catch(() => { throw new ImageError(502, 'The website returned something that is not a photo.'); });
    await studioDocs.put('splash-images', key, { key, src, type: 'image/webp', data: out.toString('base64') } satisfies Stored);
    return out;
  })().catch((e) => { if (e instanceof ImageError && e.status === 502) failedAt.set(key, Date.now()); throw e; }).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}
const failedAt = new Map<string, number>();

/** a job's website photos fetched and kept before anyone asks (two at a time); failures are left for the page's check */
export async function warmImages(srcs: string[], deps: ImageDeps = {}): Promise<{ ok: number; failed: string[] }> {
  const queue = [...new Set(srcs)], failed: string[] = [];
  let ok = 0;
  await Promise.all([0, 1].map(async () => { for (let s = queue.shift(); s; s = queue.shift()) await master(s, deps).then(() => ok++, () => failed.push(s)); }));
  return { ok, failed };
}

/** one sized copy of a photo, from the cache or made now */
export async function sizedImage(src: string, width: number, format: ImageFormat, deps: ImageDeps = {}): Promise<{ body: Buffer; type: string }> {
  if (!(IMAGE_WIDTHS as readonly number[]).includes(width)) throw new ImageError(400, `Width must be one of ${IMAGE_WIDTHS.join(', ')}.`);
  const key = `${hash(src)}-${width}.${format}`;
  const doc = await studioDocs.get<Stored>('splash-images', key);
  if (doc) return { body: Buffer.from(doc.data, 'base64'), type: doc.type };
  const img = sharp(await master(src, deps)).resize({ width, withoutEnlargement: true });
  const body = format === 'avif' ? await img.avif({ quality: 55, effort: 3 }).toBuffer() : format === 'webp' ? await img.webp({ quality: 78 }).toBuffer() : await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  await studioDocs.put('splash-images', key, { key, src, type: TYPES[format], data: body.toString('base64') } satisfies Stored);
  return { body, type: TYPES[format] };
}

/**
 * The src, srcset and sizes for a photo of `width` px: every served width up to the photo's own (a photo narrower than
 * the smallest is served at its own size). The default src is the largest up to 1200.
 */
export function imageSet(base: string, jobId: string, photoId: string, width: number): { src: string; srcset?: string; sizes?: string } {
  const at = (w: number) => `${base}/api/splash/${jobId}/img/${encodeURIComponent(photoId)}/${w}`;
  const fit = IMAGE_WIDTHS.filter((w) => w <= width);
  if (fit.length < 2) return { src: at(fit[0] ?? IMAGE_WIDTHS[0]) };
  const def = [...fit].reverse().find((w) => w <= 1200) ?? fit[0];
  return { src: at(def), srcset: fit.map((w) => `${at(w)} ${w}w`).join(', '), sizes: '(min-width: 1024px) 66vw, 100vw' };
}
