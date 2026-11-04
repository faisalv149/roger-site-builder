import fs from 'node:fs';
import { FRAMES, fitFor, usesOf } from '../design/image-fit.js';
import path from 'node:path';
import sharp from 'sharp';
import type { Theme } from '../theme/schema.js';
import type { Business, Photo } from '../types.js';
import { downloadPhoto } from '../sources/places.js';
import { livePhotoPath, photoCreditMarker } from '../sources/google-live.js';

export interface SiteImage {
  publicPath: string;
  width: number;
  height: number;
  alt: string;
  /** the photographer's credit; Google requires it on every Places photo, the business's own included */
  credit?: string;
  source: 'google' | 'stock' | 'owner' | 'website';
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
): Promise<{ hero?: SiteImage; gallery: SiteImage[]; rejected: { ref: string; reason: string }[]; skipped: { ref: string; reason: string }[]; usable: number; items: ProcessedPhoto[] }> {
  const rules = theme.images;
  const rejected: { ref: string; reason: string }[] = [];
  const sized = b.photos.filter((p) => {
    // big enough for some frame it could fill (a gallery tile, a service card, a hero)? The frame decides, not one cut-off
    const ok = usesOf(p.width, p.height).length > 0;
    if (!ok) rejected.push({ ref: p.ref, reason: `too small for any frame (${p.width}×${p.height}: under ${FRAMES.gallery.css}px across once cropped)` });
    return ok;
  });
  // Business-uploaded photos first; customer photos after (they need a visible credit).
  const all = [...sized.filter((p) => p.isOwner), ...sized.filter((p) => !p.isOwner)];
  const limit = rules.maxGallery + 3;
  const ordered = all.slice(0, limit);
  // not a judgement on the photo: only the first ones are downloaded (recorded for the photo trace, not as a warning)
  const skipped = all.slice(limit).map((p) => ({ ref: p.ref, reason: `not downloaded: the first ${limit} usable photos are enough for this layout` }));
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
  // a listing photo's place among the listing's own photos (Google's order): how /gphoto/ finds it again
  const googleOnly = b.photos.filter((p) => p.source !== 'website');

  // Hero: prefer a wide owner photo.
  // (only a picture big enough for a hero frame leads; otherwise no picture is stretched to fill it)
  const heroFits = (g: { p: Photo }) => fitFor(g.p.width, g.p.height, 'hero').level !== 'undersized';
  const heroIdx = good.findIndex((g) => g.p.isOwner && g.p.width / g.p.height >= 1.25 && heroFits(g));
  const images: SiteImage[] = [];
  const items: ProcessedPhoto[] = [];
  let hero: SiteImage | undefined;
  let n = 0;
  for (let k = 0; k < good.length; k++) {
    const g = good[k];
    const isHero = k === heroIdx;
    if (!isHero) n++;
    // a Google listing photo is never copied (Maps Platform terms): the page links to /gphoto/, which fetches Google's
    // image for each view, and its credit is filled in when the page is served (src/sources/google-live.ts)
    const listingN = g.p.source !== 'website' && b.source === 'places' ? googleOnly.indexOf(g.p) : -1;
    if (listingN >= 0) {
      const img: SiteImage = { publicPath: livePhotoPath(b.placeId, listingN, g.p.width, g.p.height), width: g.p.width, height: g.p.height, alt: `Photo of ${b.name}`, credit: photoCreditMarker(b.placeId, listingN, g.p.width, g.p.height), source: 'google' };
      if (isHero) hero = img; else images.push(img);
      items.push({ image: img, photo: g.p, raw: g.raw });
      continue;
    }
    const enc = await encodeUnder(g.raw, isHero ? 1920 : 1200, rules.maxFileKb);
    const name = `${isHero ? 'hero' : `photo-${n}`}.webp`;
    fs.writeFileSync(path.join(opts.outDir, name), enc.data);
    const img: SiteImage = {
      publicPath: `${opts.publicPrefix}/${name}`,
      width: enc.width,
      height: enc.height,
      alt: g.p.source === 'website' ? (g.p.origin?.alt || `${b.name}${b.city ? `, ${b.city}` : ''}: photo ${isHero ? 1 : n + 1}`) : `Photo of ${b.name}`,
      // the business's own website photos are its own; Google requires a credit on every Places photo
      credit: g.p.source === 'website' ? undefined : g.p.authors[0]?.name ? `Photo: ${g.p.authors[0].name} via Google` : 'Photo via Google',
      source: g.p.source === 'website' ? 'website' : 'google',
      kb: Math.round(enc.data.length / 1024),
    };
    if (isHero) hero = img; else images.push(img);
    items.push({ image: img, photo: g.p, raw: g.raw });
  }
  // If the gallery would fall short of its minimum, let the hero photo appear there too.
  const minPhotos = ((theme.sectionRules.gallery || {}) as { minPhotos?: number }).minPhotos ?? 3;
  if (hero && images.length < minPhotos && images.length + 1 >= minPhotos) images.unshift({ ...hero, alt: `Photo of ${b.name}` });
  return { hero, gallery: images.slice(0, rules.maxGallery), rejected, skipped, usable: good.length, items };
}

/** A kept photo with its downloaded original, for the design planner's ranking and art-directed crops (src/design/photos.ts). */
export interface ProcessedPhoto { image: SiteImage; photo: Photo; raw: Buffer }
