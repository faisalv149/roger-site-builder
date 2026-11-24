import fs from 'node:fs';
import { fitFor } from '../design/image-fit.js';
import path from 'node:path';
import sharp from 'sharp';
import type { SourceService } from './site-content.js';
import { fetchPatiently, sizedUrl } from './site-images.js';
import { nameKey } from './site-content.js';

/**
 * The picture on each service's own card, kept with that service: fetched, cropped to one shape (16:10) around the
 * part that matters, and stored with its focal point so the crop can be redone. A service with no picture, or whose
 * picture can't be fetched or is too small, simply has none: the card falls back to an icon panel.
 */
export interface ServiceImage {
  path: string;
  width: number;
  height: number;
  /** where the subject is, 0..1 from the top-left: the crop is centred on it and a re-crop can start from it */
  focal: { x: number; y: number };
  /** empty when the picture is decorative (the heading beside it already names the service) */
  alt: string;
  source: 'website';
  /** the uncropped copy, for re-cropping */
  original?: string;
  sourceUrl?: string;
}

export interface ServiceImageRecord { service: string; url: string; ok: boolean; status?: number; error?: string; width?: number; height?: number; skipped?: 'undersized' | 'unreadable'; /** pixels per CSS pixel on the card, once cropped */ density?: number; focal?: { x: number; y: number }; method?: 'page crop' | 'attention' }

export const SERVICE_RATIO = { w: 900, h: 562 }; // 16:10

/** The page's own crop (Wix-style `crop/x_0,y_20,w_1365,h_2009`), centred, when its address carries one. */
export function pageCrop(seen: string, full: { w: number; h: number }): { x: number; y: number } | undefined {
  const m = seen.match(/crop\/x_(\d+),y_(\d+),w_(\d+),h_(\d+)/);
  if (!m) return undefined;
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x: Math.min(1, Math.max(0, (x + w / 2) / full.w)), y: Math.min(1, Math.max(0, (y + h / 2) / full.h)) };
}

export async function fetchServiceImages(services: SourceService[], opts: { outDir: string; publicPrefix: string; minWidth?: number }): Promise<{ byService: Map<string, ServiceImage>; records: ServiceImageRecord[] }> {
  const byService = new Map<string, ServiceImage>();
  const records: ServiceImageRecord[] = [];
  fs.mkdirSync(opts.outDir, { recursive: true });
  let n = 0;
  for (const s of services) {
    if (!s.image) continue;
    const rec: ServiceImageRecord = { service: s.name, url: s.image.url, ok: false };
    records.push(rec);
    const r = await fetchPatiently([...new Set([sizedUrl(s.image.url), s.image.url, s.image.seen])], { timeoutMs: 20_000, maxBytes: 20_000_000 });
    rec.status = r.status;
    if (!r.ok) { rec.error = r.status === 0 ? `the host kept resetting the connection (${r.error || 'network error'}), likely a rate limit` : r.error || `HTTP ${r.status}`; continue; }
    try {
      const meta = await sharp(r.body).rotate().metadata();
      const w = meta.width || 0, h = meta.height || 0;
      rec.width = w; rec.height = h;
      // the card frame decides: the largest 16:10 crop this picture holds must still fill the card at its own size
      const fit = fitFor(w, h, 'card');
      rec.density = fit.density;
      if (fit.level === 'undersized') { rec.skipped = 'undersized'; continue; }
      // the page's own crop says what its designer framed; otherwise the most visually prominent region
      const own = pageCrop(s.image.seen, { w, h });
      // never enlarge a small picture to fill the card: a 510-pixel original stays at its own size, so it stays sharp
      const TW = Math.min(SERVICE_RATIO.w, Math.floor(Math.min(w, h * 1.6))), TH = TW === SERVICE_RATIO.w ? SERVICE_RATIO.h : Math.round(TW / 1.6);
      const scale = Math.max(TW / w, TH / h);
      const sw = Math.round(w * scale), sh = Math.round(h * scale);
      let left: number, top: number;
      if (own) {
        left = Math.round(Math.min(sw - TW, Math.max(0, own.x * sw - TW / 2)));
        top = Math.round(Math.min(sh - TH, Math.max(0, own.y * sh - TH / 2)));
        rec.method = 'page crop';
      } else {
        const probe = await sharp(r.body).rotate().resize(TW, TH, { fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
        left = Math.max(0, (probe.info as { cropOffsetLeft?: number }).cropOffsetLeft ?? Math.round((sw - TW) / 2));
        top = Math.max(0, (probe.info as { cropOffsetTop?: number }).cropOffsetTop ?? Math.round((sh - TH) / 2));
        // the crop offsets are reported as negative numbers by some versions
        left = Math.abs(left); top = Math.abs(top);
        rec.method = 'attention';
      }
      const focal = { x: +Math.min(1, Math.max(0, (left + TW / 2) / sw)).toFixed(3), y: +Math.min(1, Math.max(0, (top + TH / 2) / sh)).toFixed(3) };
      const cropped = await sharp(r.body).rotate().resize(sw, sh).extract({ left, top, width: TW, height: TH }).webp({ quality: 80 }).toBuffer();
      const original = await sharp(r.body).rotate().resize({ width: Math.min(w, 1600), withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      n++;
      const file = `svc-${n}.webp`, orig = `svc-${n}-src.webp`;
      fs.writeFileSync(path.join(opts.outDir, file), cropped);
      fs.writeFileSync(path.join(opts.outDir, orig), original);
      rec.ok = true; rec.focal = focal;
      byService.set(nameKey(s.name), { path: `${opts.publicPrefix}/${file}`, width: TW, height: TH, focal, alt: cardAlt(s.name, s.image.alt), source: 'website', original: `${opts.publicPrefix}/${orig}`, sourceUrl: s.image.url });
    } catch (e) {
      rec.skipped = 'unreadable';
      rec.error = `could not decode the image: ${(e as Error).message.slice(0, 80)}`;
    }
  }
  return { byService, records };
}

/** A picture's alt beside its heading: empty (decorative) when it only restates the heading ("A massage chair session" by "Massage Chair Session"). */
export function cardAlt(heading: string, alt: string | undefined): string {
  const a = (alt || '').trim();
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !['a', 'an', 'the', 'of', 'our', 'and'].includes(w));
  const h = new Set(words(heading));
  return a && words(a).every((w) => h.has(w)) ? '' : a;
}
