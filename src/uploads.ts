import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.js';
import type { DraftRecord } from './drafts.js';
import { DraftError } from './drafts.js';
import { measure, photoKey, type PhotoMeta } from './design/photos.js';

/**
 * Owner uploads (photos and logo). The file's real format is read from its content (not its name or the
 * browser's type); only JPEG, PNG and WebP of a sensible size are accepted. Every upload is re-encoded (which
 * also drops metadata such as GPS), stored under the draft's own site folder with a generated name, and added
 * to the media library as the owner's own, publishable photo.
 */
const MAX_PIXELS = 50_000_000;
const FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function addUpload(d: DraftRecord, buf: Buffer, kind: 'photo' | 'logo', alt: string): Promise<string> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try { meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { throw new DraftError(400, 'That file isn\'t a photo we can use. Upload a JPEG, PNG or WebP image.'); }
  if (!meta.format || !FORMATS.has(meta.format)) throw new DraftError(400, 'Upload a JPEG, PNG or WebP image.');
  if (!meta.width || !meta.height || meta.width < 300 || meta.height < 200) throw new DraftError(400, 'That image is too small: use one at least 300 × 200 pixels.');
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 12);
  const assets = path.join(config.dirs.sites, d.slug, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  if (kind === 'logo') {
    const out = await sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate().trim().resize({ width: 640, height: 240, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    const file = `logo-owner-${hash}.png`;
    fs.writeFileSync(path.join(assets, file), out.data);
    d.base.logo = { publicPath: `assets/${file}`, file: path.join(assets, file), width: out.info.width, height: out.info.height, sourceUrl: 'owner-upload', colors: d.base.logo?.colors ?? [] };
    return file;
  }
  const out = await sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const file = `up-${hash}.webp`;
  fs.writeFileSync(path.join(assets, file), out.data);
  const key = photoKey(`upload:${hash}`);
  if (d.base.photos.some((p) => p.key === key)) throw new DraftError(409, 'That photo is already in your library.');
  const m = await measure(out.data);
  const resolution = Math.min(1, Math.min(out.info.width / 1600, out.info.height / 1000));
  const cleanAlt = alt.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || `${d.businessName}`;
  const photo: PhotoMeta = {
    key, image: { publicPath: `assets/${file}`, width: out.info.width, height: out.info.height, alt: cleanAlt, source: 'owner', kb: Math.round(out.data.length / 1024) },
    width: out.info.width, height: out.info.height, aspect: out.info.width / out.info.height, owner: true, kind: 'unknown',
    sharpness: m.sharpness, exposure: m.exposure, resolution, quality: Math.round((resolution * 0.4 + m.sharpness * 0.3 + m.exposure * 0.3) * 1000) / 1000,
  };
  d.base.photos.push(photo);
  const order = Math.min(...(d.content!.media.map((x) => x.order).concat([1]))) - 1;
  d.content!.media.push({ key, source: 'owner', publishable: true, alt: cleanAlt, order: Math.max(0, order), publicPath: `assets/${file}`, width: out.info.width, height: out.info.height, uploadedAt: new Date().toISOString() });
  d.content!.revision += 1;
  return file;
}
