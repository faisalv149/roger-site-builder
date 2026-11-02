import fs from 'node:fs';
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

export interface ServiceImageRecord { service: string; url: string; ok: boolean; status?: number; error?: string; width?: number; height?: number; skipped?: 'too small' | 'unreadable'; focal?: { x: number; y: number }; method?: 'page crop' | 'attention' }

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
      if (w < (opts.minWidth ?? 400) || h < 250) { rec.skipped = 'too small'; continue; }
      // the page's own crop says what its designer framed; otherwise the most visually prominent region
      const own = pageCrop(s.image.seen, { w, h });
      const scale = Math.max(SERVICE_RATIO.w / w, SERVICE_RATIO.h / h);
      const sw = Math.round(w * scale), sh = Math.round(h * scale);
      let left: number, top: number;
      if (own) {
        left = Math.round(Math.min(sw - SERVICE_RATIO.w, Math.max(0, own.x * sw - SERVICE_RATIO.w / 2)));
        top = Math.round(Math.min(sh - SERVICE_RATIO.h, Math.max(0, own.y * sh - SERVICE_RATIO.h / 2)));
        rec.method = 'page crop';
      } else {
        const probe = await sharp(r.body).rotate().resize(SERVICE_RATIO.w, SERVICE_RATIO.h, { fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
        left = Math.max(0, (probe.info as { cropOffsetLeft?: number }).cropOffsetLeft ?? Math.round((sw - SERVICE_RATIO.w) / 2));
        top = Math.max(0, (probe.info as { cropOffsetTop?: number }).cropOffsetTop ?? Math.round((sh - SERVICE_RATIO.h) / 2));
        // the crop offsets are reported as negative numbers by some versions
        left = Math.abs(left); top = Math.abs(top);
        rec.method = 'attention';
      }
      const focal = { x: +Math.min(1, Math.max(0, (left + SERVICE_RATIO.w / 2) / sw)).toFixed(3), y: +Math.min(1, Math.max(0, (top + SERVICE_RATIO.h / 2) / sh)).toFixed(3) };
      const cropped = await sharp(r.body).rotate().resize(sw, sh).extract({ left, top, width: SERVICE_RATIO.w, height: SERVICE_RATIO.h }).webp({ quality: 80 }).toBuffer();
      const original = await sharp(r.body).rotate().resize({ width: Math.min(w, 1600), withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      n++;
      const file = `svc-${n}.webp`, orig = `svc-${n}-src.webp`;
      fs.writeFileSync(path.join(opts.outDir, file), cropped);
      fs.writeFileSync(path.join(opts.outDir, orig), original);
      rec.ok = true; rec.focal = focal;
      byService.set(nameKey(s.name), { path: `${opts.publicPrefix}/${file}`, width: SERVICE_RATIO.w, height: SERVICE_RATIO.h, focal, alt: (s.image.alt || '').trim(), source: 'website', original: `${opts.publicPrefix}/${orig}`, sourceUrl: s.image.url });
    } catch (e) {
      rec.skipped = 'unreadable';
      rec.error = `could not decode the image: ${(e as Error).message.slice(0, 80)}`;
    }
  }
  return { byService, records };
}
