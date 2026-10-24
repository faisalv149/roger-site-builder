import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { WebsiteScan } from '../types.js';
import { fetchRaw } from '../util/http.js';
import { contrast, rgbToOklch, toHex, deltaE, type RGB } from '../color/oklch.js';

export interface LogoPick {
  publicPath: string;
  file: string;
  width: number;
  height: number;
  sourceUrl: string;
  colors: string[]; // chromatic colors found in the logo, most prominent first
}

interface PixelStats {
  opaque: number;
  transparentRatio: number;
  colors: { rgb: RGB; count: number }[];
  uniqueBuckets: number;
  lowContrastRatio: number; // share of opaque pixels nearly invisible on the header band
}

async function pixelStats(buf: Buffer, band: string): Promise<PixelStats> {
  const { data, info } = await sharp(buf).ensureAlpha().resize(120, 120, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let opaque = 0, transparent = 0, lowContrast = 0;
  const bandRgb: RGB = [parseInt(band.slice(1, 3), 16), parseInt(band.slice(3, 5), 16), parseInt(band.slice(5, 7), 16)];
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3];
    if (a < 128) { transparent++; continue; }
    opaque++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (contrast([r, g, b], bandRgb) < 1.35) lowContrast++;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += r; e.g += g; e.b += b; e.n++;
    buckets.set(key, e);
  }
  const colors = [...buckets.values()].map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as RGB, count: e.n })).sort((a, b) => b.count - a.count);
  const total = opaque + transparent || 1;
  return { opaque, transparentRatio: transparent / total, colors, uniqueBuckets: buckets.size, lowContrastRatio: opaque ? lowContrast / opaque : 1 };
}

/** Prominent chromatic colors (clustered), skipping white/black/gray. */
export function chromaticColors(stats: PixelStats, minChroma = 0.04): string[] {
  const clusters: { rgb: RGB; weight: number }[] = [];
  for (const c of stats.colors.slice(0, 400)) {
    const o = rgbToOklch(c.rgb);
    if (o.l > 0.95 || o.l < 0.14 || o.c < minChroma) continue;
    const hit = clusters.find((k) => deltaE(k.rgb, c.rgb) < 0.08);
    // Weight by area, nudged by chroma so a strong brand hue beats a large muted fill.
    const w = c.count * (0.6 + Math.min(o.c, 0.25) * 2);
    if (hit) hit.weight += w; else clusters.push({ rgb: c.rgb, weight: w });
  }
  return clusters.sort((a, b) => b.weight - a.weight).slice(0, 5).map((k) => toHex(k.rgb));
}

/**
 * Try the website's logo candidates in order and keep the first usable one.
 * Usable = decodable, big enough, not a photo, and visible on the theme's header band.
 */
export async function pickLogo(
  scan: WebsiteScan | undefined,
  opts: { outDir: string; publicPrefix: string; band: string; maxHeightPx: number; minChroma: number },
): Promise<{ logo?: LogoPick; rejected: { url: string; reason: string }[] }> {
  const rejected: { url: string; reason: string }[] = [];
  if (!scan?.ok) return { rejected };
  for (const cand of scan.logoCandidates.slice(0, 6)) {
    if (/\.ico(\?|$)/i.test(cand.url)) { rejected.push({ url: cand.url, reason: '.ico favicons are too small for a header logo' }); continue; }
    const res = await fetchRaw(cand.url, { timeoutMs: 8000, maxBytes: 4_000_000 });
    if (!res.ok || !res.body.length) { rejected.push({ url: cand.url, reason: `download failed (${res.status || res.error})` }); continue; }
    try {
      const img = sharp(res.body, { density: 300 });
      const meta = await img.metadata();
      const isSvg = meta.format === 'svg';
      const w = meta.width || 0, h = meta.height || 0;
      if (!isSvg && (h < 40 || w < 60)) { rejected.push({ url: cand.url, reason: `too small (${w}×${h})` }); continue; }
      const stats = await pixelStats(res.body, opts.band);
      const looksLikePhoto = stats.uniqueBuckets > 900 && stats.transparentRatio < 0.02;
      if (looksLikePhoto && cand.score < 7) { rejected.push({ url: cand.url, reason: 'looks like a photo, not a logo' }); continue; }
      if (stats.lowContrastRatio > 0.85) { rejected.push({ url: cand.url, reason: 'would be invisible on the light header band (white/light logo)' }); continue; }
      // Trim empty borders, render at 2x the theme's desktop max height.
      const targetH = opts.maxHeightPx * 2;
      const out = await sharp(res.body, { density: 300 })
        .trim({ threshold: 12 })
        .resize({ height: targetH, withoutEnlargement: !isSvg })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      fs.mkdirSync(opts.outDir, { recursive: true });
      const file = path.join(opts.outDir, 'logo.png');
      fs.writeFileSync(file, out.data);
      return {
        logo: {
          file,
          publicPath: `${opts.publicPrefix}/logo.png`,
          width: out.info.width,
          height: out.info.height,
          sourceUrl: cand.url,
          colors: chromaticColors(stats, opts.minChroma),
        },
        rejected,
      };
    } catch (e) {
      rejected.push({ url: cand.url, reason: `not a readable image (${(e as Error).message.slice(0, 60)})` });
    }
  }
  return { rejected };
}
