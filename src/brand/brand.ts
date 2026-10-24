import type { Theme } from '../theme/schema.js';
import type { BrandResult, WebsiteScan } from '../types.js';
import { brandTextColor, checkBrandColor, deriveScale } from '../color/palette.js';
import { hexToOklch } from '../color/oklch.js';
import type { LogoPick } from './logo.js';

/**
 * Resolve the color the site is rendered with, following theme.brandColor.source order
 * (logo → website → default). The theme file itself is never modified.
 */
export function resolveBrand(theme: Theme, inputs: { logo?: LogoPick; scan?: WebsiteScan; override?: string }): BrandResult {
  const rejected: BrandResult['rejected'] = [];
  const tryList: { source: BrandResult['source']; hex: string }[] = [];

  if (inputs.override) tryList.push({ source: 'logo', hex: inputs.override });
  for (const src of theme.brandColor.source) {
    if (src === 'logo' && inputs.logo) for (const hex of inputs.logo.colors.slice(0, 3)) tryList.push({ source: 'logo', hex });
    if (src === 'website' && inputs.scan?.ok) {
      if (inputs.scan.themeColor) tryList.push({ source: 'website', hex: inputs.scan.themeColor });
      const chromatic = inputs.scan.cssColors.filter((c) => {
        const o = hexToOklch(c.hex);
        return o.c >= theme.brandColor.minChroma && o.l > 0.15 && o.l < 0.93;
      });
      for (const c of chromatic.slice(0, 3)) tryList.push({ source: 'website', hex: c.hex });
    }
    if (src === 'default') tryList.push({ source: 'default', hex: theme.palette.brand });
  }
  if (!tryList.some((t) => t.source === 'default')) tryList.push({ source: 'default', hex: theme.palette.brand });

  for (const cand of tryList) {
    const check = checkBrandColor(cand.hex, theme);
    if (check.ok) {
      const { tints, shades } = deriveScale(check.hex, theme);
      return {
        brand: check.hex,
        brandInk: check.ink,
        source: cand.source,
        rejected,
        tints,
        shades,
        logo: inputs.logo ? { publicPath: inputs.logo.publicPath, width: inputs.logo.width, height: inputs.logo.height, sourceUrl: inputs.logo.sourceUrl } : undefined,
      };
    }
    rejected.push({ source: cand.source, hex: cand.hex, reason: check.reason || 'rejected' });
  }
  // Theme default failed its own rules (shouldn't happen) — use it anyway.
  const { tints, shades } = deriveScale(theme.palette.brand, theme);
  return { brand: theme.palette.brand, brandInk: '#FFFFFF', source: 'default', rejected, tints, shades };
}

export function brandTextOnSurface(b: BrandResult, theme: Theme) {
  return brandTextColor(b.brand, theme.palette.surface, b.shades);
}
