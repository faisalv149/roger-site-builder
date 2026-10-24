import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Theme } from '../theme/schema.js';
import type { Business, Photo } from '../types.js';
import { downloadPhoto } from '../sources/places.js';

export interface SiteImage {
  publicPath: string;
  width: number;
  height: number;
  alt: string;
  credit?: string; // shown when the photo was not uploaded by the business
  source: 'google' | 'stock';
  kb?: number;
}

/** Cheap "is this a flyer/screenshot?" test: mostly pure white + pure black pixels. */
async function looksTextHeavy(buf: Buffer): Promise<boolean> {
  const { data } = await sharp(buf).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let extreme = 0, edges = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 235 || data[i] < 40) extreme++;
    if (i % 64 && Math.abs(data[i] - data[i - 1]) > 90) edges++;
    if (i >= 64 && Math.abs(data[i] - data[i - 64]) > 90) edges++;
  }
  // Flyers/screenshots: lots of hard black/white edges. Photos sit well under 0.1 edge density at this size.
  return extreme / data.length > 0.4 && edges / data.length > 0.15;
}

async function encodeUnder(buf: Buffer, maxW: number, maxKb: number): Promise<{ data: Buffer; width: number; height: number }> {
  let width = maxW;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const q of [80, 70, 60, 50]) {
      const out = await sharp(buf).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: q }).toBuffer({ resolveWithObject: true });
      if (out.data.length <= maxKb * 1024) return { data: out.data, width: out.info.width, height: out.info.height };
    }
    width = Math.round(width * 0.8);
  }
  const out = await sharp(buf).resize({ width }).webp({ quality: 45 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function processPhotos(
  b: Business,
  theme: Theme,
  opts: { outDir: string; publicPrefix: string },
): Promise<{ hero?: SiteImage; gallery: SiteImage[]; rejected: { ref: string; reason: string }[]; usable: number }> {
  const rules = theme.images;
  const rejected: { ref: string; reason: string }[] = [];
  const sized = b.photos.filter((p) => {
    const ok = p.width >= rules.minWidth && p.height >= rules.minHeight;
    if (!ok) rejected.push({ ref: p.ref, reason: `below ${rules.minWidth}×${rules.minHeight} (${p.width}×${p.height})` });
    return ok;
  });
  // Business-uploaded photos first; customer photos after (they need a visible credit).
  const ordered = [...sized.filter((p) => p.isOwner), ...sized.filter((p) => !p.isOwner)].slice(0, rules.maxGallery + 3);
  fs.mkdirSync(opts.outDir, { recursive: true });

  const processed = await mapLimit(ordered, 4, async (p: Photo, i) => {
    try {
      const raw = await downloadPhoto(p.ref, 1920);
      if (rules.rejectTextHeavy && (await looksTextHeavy(raw))) { rejected.push({ ref: p.ref, reason: 'text-heavy (flyer/graphic)' }); return null; }
      return { p, raw, i };
    } catch (e) {
      rejected.push({ ref: p.ref, reason: `download failed: ${(e as Error).message}` });
      return null;
    }
  });
  const good = processed.filter(Boolean) as { p: Photo; raw: Buffer; i: number }[];

  // Hero: prefer a wide owner photo.
  const heroIdx = Math.max(0, good.findIndex((g) => g.p.isOwner && g.p.width / g.p.height >= 1.25));
  const images: SiteImage[] = [];
  let hero: SiteImage | undefined;
  let n = 0;
  for (let k = 0; k < good.length; k++) {
    const g = good[k];
    const isHero = k === heroIdx;
    if (!isHero) n++;
    const enc = await encodeUnder(g.raw, isHero ? 1920 : 1200, rules.maxFileKb);
    const name = `${isHero ? 'hero' : `photo-${n}`}.webp`;
    fs.writeFileSync(path.join(opts.outDir, name), enc.data);
    const img: SiteImage = {
      publicPath: `${opts.publicPrefix}/${name}`,
      width: enc.width,
      height: enc.height,
      alt: isHero ? `${b.name} at work` : `Project photo from ${b.name}`,
      credit: g.p.isOwner ? undefined : g.p.authors[0]?.name ? `Photo: ${g.p.authors[0].name} via Google` : 'Photo via Google',
      source: 'google',
      kb: Math.round(enc.data.length / 1024),
    };
    if (isHero) hero = img; else images.push(img);
  }
  // If the gallery would fall short of its minimum, let the hero photo appear there too.
  const minPhotos = ((theme.sectionRules.gallery || {}) as { minPhotos?: number }).minPhotos ?? 3;
  if (hero && images.length < minPhotos && images.length + 1 >= minPhotos) images.unshift({ ...hero, alt: `Project photo from ${b.name}` });
  return { hero, gallery: images.slice(0, rules.maxGallery), rejected, usable: good.length };
}
