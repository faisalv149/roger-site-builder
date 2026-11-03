import { createHash } from 'node:crypto';
import { fitFor } from './image-fit.js';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ProcessedPhoto, SiteImage } from '../brand/photos.js';
import type { PhotoKind } from '../types.js';
import { claudeVisionJson } from '../content/claude.js';
import type { HeroVariant } from './schema.js';

/**
 * Photo roles for the design plan: one hero, one team photo, project photos, each a different image where
 * possible. Ranked by usable resolution, sharpness and exposure; what a photo shows comes from the vision step
 * (Claude API), from sample fixtures (pre-filled stand-in), or is unknown (CLI / no Claude: ranking only, no
 * team section, since nothing confirms people in the photo work there).
 */
export interface PhotoInfo {
  key: string;
  image: SiteImage;
  /** the downloaded original (build time); re-renders load the stored image instead */
  raw?: Buffer;
  width: number;
  height: number;
  aspect: number;
  owner: boolean;
  /** the picture the business's own website puts in its hero */
  siteHero?: boolean;
  kind: PhotoKind | 'unknown';
  /** 0..1 */
  sharpness: number;
  exposure: number;
  resolution: number;
  quality: number;
}

/** What a draft keeps about each photo (no image bytes). */
export type PhotoMeta = Omit<PhotoInfo, 'raw'>;
export const toMeta = ({ raw: _r, ...m }: PhotoInfo): PhotoMeta => m;

export const photoKey = (ref: string) => `p_${createHash('sha1').update(ref).digest('hex').slice(0, 10)}`;

export async function measure(raw: Buffer): Promise<{ sharpness: number; exposure: number; width: number; height: number }> {
  const meta = await sharp(raw).metadata();
  const { data, info } = await sharp(raw).rotate().resize(160, 160, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let sq = 0;
  for (const v of data) sq += (v - mean) ** 2;
  const sd = Math.sqrt(sq / data.length);
  // Laplacian energy: blurry photos have little of it
  const w = info.width;
  let lap = 0;
  let n = 0;
  for (let y = 1; y < info.height - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
    lap += l * l;
    n++;
  }
  const sharpness = Math.min(1, Math.sqrt(lap / Math.max(1, n)) / 36);
  // only real extremes count against a photo (bright bathrooms and white fixtures are normal); flat images too
  const exposure = Math.max(0, 1 - Math.max(0, Math.abs(mean - 128) - 70) / 58) * Math.min(1, sd / 32);
  const rotated = (meta.orientation || 1) >= 5;
  return { sharpness, exposure, width: rotated ? meta.height || 0 : meta.width || 0, height: rotated ? meta.width || 0 : meta.height || 0 };
}

const KINDS: PhotoKind[] = ['team', 'work', 'vehicle', 'storefront', 'other'];

/** What each photo shows. Fixture labels win (sample data); otherwise one vision call (API only) or unknown. */
export async function labelPhotos(items: ProcessedPhoto[]): Promise<{ kinds: (PhotoKind | 'unknown')[]; source: 'fixture' | 'vision' | 'none'; ms?: number }> {
  if (!items.length) return { kinds: [], source: 'none' };
  if (items.some((i) => i.photo.analysis?.kind)) return { kinds: items.map((i) => i.photo.analysis?.kind ?? 'unknown'), source: 'fixture' };
  const list = items.slice(0, 10);
  const thumbs = await Promise.all(list.map((i) => sharp(i.raw).rotate().resize(384, 384, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()));
  const r = await claudeVisionJson<{ photos?: { index: number; kind: string }[] }>({
    system:
      'You label photos from a plumbing business\'s Google Business profile so its website can place them. Describe only what is visible. ' +
      'team: one or more people who appear to work for the business (uniforms, posing as a crew, at work). ' +
      'work: plumbing work itself: fixtures, pipes, water heaters, installations, a job in progress or finished. ' +
      'vehicle: a work van or truck. storefront: the building, shopfront or office. ' +
      'other: anything else (logos, flyers, text, screenshots, receipts, unrelated scenes).',
    prompt: 'Label every photo above by its number.',
    images: thumbs,
    toolName: 'label_photos',
    toolDescription: 'Record what each photo shows.',
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, kind: { type: 'string', enum: KINDS } }, required: ['index', 'kind'] } } },
      required: ['photos'],
    },
  });
  if (!r) return { kinds: items.map(() => 'unknown'), source: 'none' };
  const kinds = items.map((_, i) => {
    const hit = r.data.photos?.find((p) => p.index === i);
    return hit && KINDS.includes(hit.kind as PhotoKind) ? (hit.kind as PhotoKind) : 'unknown';
  });
  return { kinds, source: 'vision', ms: r.ms };
}

export async function analyzePhotos(items: ProcessedPhoto[], kinds: (PhotoKind | 'unknown')[]): Promise<PhotoInfo[]> {
  return Promise.all(items.map(async (it, i) => {
    const m = await measure(it.raw);
    const width = m.width || it.photo.width;
    const height = m.height || it.photo.height;
    const resolution = Math.min(1, Math.min(width / 1600, height / 1000));
    return {
      key: photoKey(it.photo.ref),
      image: it.image,
      raw: it.raw,
      width,
      height,
      aspect: width / Math.max(1, height),
      owner: !!it.photo.isOwner,
      siteHero: it.photo.origin?.role === 'hero',
      kind: kinds[i] ?? 'unknown',
      sharpness: m.sharpness,
      exposure: m.exposure,
      resolution,
      quality: Math.round((resolution * 0.4 + m.sharpness * 0.3 + m.exposure * 0.3) * 1000) / 1000,
    };
  }));
}

const aspectFit = (a: number) => (a >= 1.3 ? 1 : a >= 1 ? 0.6 : 0.25);
export function heroScore(p: PhotoInfo): number {
  // the work itself leads; a van or shopfront only when nothing better is there
  const kindBonus = p.kind === 'work' ? 0.12 : p.kind === 'storefront' || p.kind === 'vehicle' ? 0.02 : p.kind === 'team' ? -0.25 : 0;
  // the business's own hero picture is relevant by definition: it ranks first when it is good enough to lead
  // a picture too small for a hero frame is not stretched to fill one: another that fits leads
  const small = fitFor(p.width, p.height, 'hero').level === 'undersized' ? -0.3 : 0;
  return p.quality * 0.7 + aspectFit(p.aspect) * 0.2 + (p.owner ? 0.1 : 0) + kindBonus + small + (p.siteHero && p.quality >= 0.45 ? 0.35 : 0);
}
/** Strong enough to carry a full-width photograph-led hero. */
export const photoLedOk = (p?: PhotoInfo) => !!p && p.width >= 1400 && p.aspect >= 1.3 && p.quality >= 0.55;

export interface PhotoRoles { hero?: PhotoInfo; team?: PhotoInfo; projects: PhotoInfo[]; /** carousel candidates, best first (hero first) */ slides: PhotoInfo[] }

/**
 * Hero, team and projects, each a different photo. saved: keys from the saved plan, reused when the photos are
 * still there (ordinary rebuilds keep the same images).
 */
export function assignPhotos(infos: PhotoInfo[], saved?: { hero: string | null; team: string | null; projects: string[] }): PhotoRoles {
  const slidesOf = (hero?: PhotoInfo, team?: PhotoInfo) => [hero, ...infos.filter((p) => p !== hero && p !== team && p.kind !== 'other' && p.kind !== 'team' && p.aspect >= 1.2 && p.quality >= 0.45 && p.width >= 1200).sort((a, b) => heroScore(b) - heroScore(a))].filter(Boolean).slice(0, 5) as PhotoInfo[];
  const byKey = new Map(infos.map((p) => [p.key, p]));
  const usable = infos.filter((p) => p.kind !== 'other');
  if (saved) {
    const hero = saved.hero ? byKey.get(saved.hero) : undefined;
    const team = saved.team ? byKey.get(saved.team) : undefined;
    const projects = saved.projects.map((k) => byKey.get(k)).filter(Boolean) as PhotoInfo[];
    const stillThere = (!saved.hero || hero) && (!saved.team || team) && projects.length === saved.projects.length;
    if (stillThere) return { hero, team, projects, slides: slidesOf(hero, team) };
  }
  const team: PhotoInfo | undefined = usable.filter((p) => p.kind === 'team').sort((a, b) => b.quality - a.quality)[0];
  let hero: PhotoInfo | undefined = usable.filter((p) => p !== team).sort((a, b) => heroScore(b) - heroScore(a))[0];
  let t: PhotoInfo | undefined = team;
  if (!hero && team) { hero = team; t = undefined; } // only a team photo: it leads the page instead
  const projects = usable
    .filter((p) => p !== hero && p !== t && (p.kind === 'work' || p.kind === 'unknown'))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 6);
  return { hero, team: t, projects, slides: slidesOf(hero, t) };
}

// Art-directed crops: desktop and mobile frames differ, and the subject is kept in frame (sharp's attention
// strategy finds the most salient region).
export interface CropSpec { desktop: [number, number]; mobile: [number, number] }
/** Desktop and mobile frames per use. The bold direction keeps the phone photo short so the contact buttons stay high. */
export function cropSpec(use: HeroVariant | 'team', direction?: string): CropSpec | undefined {
  if (use === 'team') return { desktop: [1400, 1050], mobile: [1000, 750] };
  if (use === 'carousel') return { desktop: [1600, 900], mobile: [1200, 900] };
  // premium phones: a tall frame the headline sits on (see design-css); bold phones: short, text below
  if (use === 'photo-led') return direction === 'bold-direct' ? { desktop: [1920, 1080], mobile: [1080, 720] } : { desktop: [1920, 1080], mobile: [900, 1350] };
  if (use === 'split') return direction === 'modern-premium' ? { desktop: [1400, 1050], mobile: [1200, 900] } : { desktop: [1200, 1500], mobile: [1200, 900] };
  return undefined;
}

/** focal: the owner's chosen point of interest (0..1); otherwise sharp's attention strategy finds the subject */
async function cropTo(p: PhotoInfo, raw: Buffer, w: number, h: number, maxKb: number, focal?: { x: number; y: number }): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(raw).rotate().metadata();
  const rw = (meta.orientation || 1) >= 5 ? meta.height || p.height : meta.width || p.width;
  const rh = (meta.orientation || 1) >= 5 ? meta.width || p.width : meta.height || p.height;
  const scale = Math.min(1, rw / w, rh / h); // never upscale: keep the frame, shrink the size
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  for (const q of [80, 70, 60, 50, 42]) {
    let img = sharp(raw).rotate();
    if (focal) {
      // the largest box of the target shape that fits, centred on the focal point as far as the edges allow
      const s = Math.min(rw / w, rh / h);
      const bw = Math.round(w * s), bh = Math.round(h * s);
      const left = Math.max(0, Math.min(rw - bw, Math.round(focal.x * rw - bw / 2)));
      const top = Math.max(0, Math.min(rh - bh, Math.round(focal.y * rh - bh / 2)));
      img = sharp(await img.toBuffer()).extract({ left, top, width: bw, height: bh });
    }
    const out = await img.resize(tw, th, { fit: 'cover', position: focal ? 'centre' : sharp.strategy.attention }).webp({ quality: q }).toBuffer();
    if (out.length <= maxKb * 1024 || q === 42) return { data: out, width: tw, height: th };
  }
  throw new Error('unreachable');
}

/**
 * Desktop + phone crops of a photo. Files are named by photo and frame, so a re-render (another hero, another
 * design) reuses crops it already made. raw: the original, or the stored image when re-rendering a draft.
 */
export async function writeCrops(p: PhotoInfo, spec: CropSpec, opts: { outDir: string; publicPrefix: string; name: string; maxKb: number; alt: string; raw: () => Promise<Buffer | undefined>; focal?: { x: number; y: number } }): Promise<{ desktop: SiteImage; mobile: SiteImage } | undefined> {
  const out = {} as { desktop: SiteImage; mobile: SiteImage };
  let raw: Buffer | undefined;
  for (const which of ['desktop', 'mobile'] as const) {
    const [w, h] = spec[which];
    const fp = opts.focal ? `-f${Math.round(opts.focal.x * 100)}x${Math.round(opts.focal.y * 100)}` : '';
    const file = `${opts.name}-${p.key.slice(2, 8)}-${w}x${h}${fp}.webp`;
    const abs = path.join(opts.outDir, file);
    let c: { width: number; height: number; data?: Buffer };
    if (fs.existsSync(abs)) { const m = await sharp(abs).metadata(); c = { width: m.width || w, height: m.height || h }; }
    else {
      raw ??= p.raw ?? (await opts.raw());
      if (!raw) return undefined;
      c = await cropTo(p, raw, w, h, opts.maxKb, opts.focal);
      fs.writeFileSync(abs, c.data!);
    }
    const kb = c.data ? Math.round(c.data.length / 1024) : Math.round(fs.statSync(abs).size / 1024);
    out[which] = { publicPath: `${opts.publicPrefix}/${file}`, width: c.width, height: c.height, alt: opts.alt, credit: p.image.credit, source: p.image.source === 'owner' ? 'owner' : 'google', kb };
  }
  return out;
}
