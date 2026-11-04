/**
 * Is this picture big enough for where it will be shown? The answer depends on the frame it will fill (its width on
 * the page and its shape), not on one cut-off for every picture. A 783×432 photograph is sharp on a service card about
 * 390 pixels wide, and not big enough for a full-width hero. A picture is never enlarged to fill a frame it doesn't fit.
 */
export type Use = 'hero' | 'card' | 'gallery';
export type FitLevel = 'sharp' | 'acceptable' | 'undersized';

/** the frame each use fills: its widest width on the page (CSS pixels) and its shape (width ÷ height) */
export const FRAMES: Record<Use, { css: number; ratio: number }> = {
  hero: { css: 1200, ratio: 16 / 9 },
  card: { css: 390, ratio: 1.6 },
  gallery: { css: 360, ratio: 4 / 3 },
};

export interface Fit {
  level: FitLevel;
  /** the picture's own pixels per CSS pixel once it is cropped to the frame: ≥1.75 is crisp on phones, ≥1 is sharp on a standard screen */
  density: number;
  /** the largest crop of the frame's shape this picture holds, at its own size */
  crop: { width: number; height: number };
}

export function fitFor(width: number, height: number, use: Use): Fit {
  const f = FRAMES[use];
  const cropW = Math.floor(Math.min(width, height * f.ratio));
  const crop = { width: cropW, height: Math.round(cropW / f.ratio) };
  const density = +(cropW / f.css).toFixed(2);
  return { level: density >= 1.75 ? 'sharp' : density >= 1 ? 'acceptable' : 'undersized', density, crop };
}

/** every use this picture suits, best first */
export const usesOf = (width: number, height: number): Use[] => (['hero', 'card', 'gallery'] as const).filter((u) => fitFor(width, height, u).level !== 'undersized');

/** what the picture is, from its file: icons, avatars, logos, maps and screenshots are not photographs of the business */
export function graphicKind(url: string, opts: { width: number; height: number; places?: string[] }): 'icon' | 'map' | 'graphic' | undefined {
  const file = (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return url; } })().toLowerCase();
  if (/\.svg$/.test(file) || Math.max(opts.width, opts.height) <= 200) return 'icon';
  // a thumbnail size in the file name ("bbb-150x150.png"): an icon or badge, whatever was downloaded
  const named = file.match(/[-_](\d{2,4})x(\d{2,4})(?=[-_.])/);
  if (named && Math.max(Number(named[1]), Number(named[2])) <= 200) return 'icon';
  if (/(^|[\/_-])(map|google-search)/.test(file)) return 'map';
  // a place name as the whole file name, on a screenshot-shaped picture, is a map of that place
  const stem = file.replace(/\.[a-z0-9]+$/, '').replace(/[-_ ]*\d+x\d+$/, '').replace(/[-_]+/g, ' ').trim();
  const aspect = opts.width / opts.height;
  const isPlace = (p: string) => { const q = p.toLowerCase(); return stem === q || (stem.length >= 4 && q.startsWith(stem)) || (stem.startsWith(`${q} `) && stem.split(' ').length <= 3); };
  if (opts.places?.some(isPlace) && aspect > 1.6 && aspect < 2.4 && /\.png$/.test(file)) return 'map';
  if (/(^|[\/_-])(icon|avatar|counter|quality|screenshot|logo|shape|badge)/.test(file)) return 'graphic';
  return undefined;
}
