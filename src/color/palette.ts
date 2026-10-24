import type { Theme } from '../theme/schema.js';
import { contrast, hexToOklch, oklchToHex, parseHex, type OKLCH } from './oklch.js';

const WHITE = '#FFFFFF';

export interface BrandCheck {
  ok: boolean;
  hex: string;
  ink: string;
  reason?: string;
  adjusted?: string;
}

/**
 * Apply theme.brandColor + theme.derive rules to a pulled color.
 * - reject near-gray (chroma < minChroma) and neon (chroma > maxChroma)
 * - pick white or dark ink automatically (brandInkAuto)
 * - darken (in OKLCH, keeping hue) until the button passes minButtonContrast
 */
export function checkBrandColor(hex: string, theme: Theme): BrandCheck {
  const rules = theme.brandColor;
  const min = theme.derive.minButtonContrast;
  const darkInk = theme.palette.ink;
  if (!parseHex(hex)) return { ok: false, hex, ink: WHITE, reason: 'not a valid color' };
  const c0 = hexToOklch(hex);
  if (rules.rejectNearGray && c0.c < rules.minChroma) return { ok: false, hex, ink: WHITE, reason: `near-gray (chroma ${c0.c.toFixed(3)} < ${rules.minChroma})` };
  if (rules.rejectNeon && c0.c > rules.maxChroma) return { ok: false, hex, ink: WHITE, reason: `neon (chroma ${c0.c.toFixed(3)} > ${rules.maxChroma})` };

  const cw = contrast(hex, WHITE);
  const cd = contrast(hex, darkInk);
  if (cw >= min) return { ok: true, hex, ink: WHITE };
  // Light, warm brand colors (yellow/amber/lime) read best with dark text.
  if (theme.derive.brandInkAuto && cd >= min && c0.l >= 0.72) return { ok: true, hex, ink: darkInk };

  if (rules.darkenUntilContrast) {
    let cur: OKLCH = { ...c0 };
    for (let i = 0; i < 60 && cur.l > 0.2; i++) {
      cur = { ...cur, l: cur.l - 0.01 };
      const h = oklchToHex(cur);
      if (contrast(h, WHITE) >= min) return { ok: true, hex: h, ink: WHITE, adjusted: `darkened from ${hex.toUpperCase()}` };
    }
  }
  if (theme.derive.brandInkAuto && cd >= min) return { ok: true, hex, ink: darkInk };
  return { ok: false, hex, ink: WHITE, reason: `cannot reach ${min}:1 button contrast` };
}

/** Tints (light backgrounds) and shades (dark accents) from the brand color, in OKLCH. */
export function deriveScale(brandHex: string, theme: Theme): { tints: string[]; shades: string[] } {
  const b = hexToOklch(brandHex);
  const tints = theme.derive.tints.map((t, i) => oklchToHex({ l: t / 100, c: Math.min(b.c, 0.12) * (0.12 + i * 0.1), h: b.h }));
  const shades = theme.derive.shades.map((s, i) => oklchToHex({ l: s / 100, c: b.c * (1 - i * 0.1), h: b.h }));
  return { tints, shades };
}

/** Brand color safe to use as *text/icon* on the surface (links, secondary buttons, eyebrows). */
export function brandTextColor(brandHex: string, surface: string, shades: string[], min = 4.5): string {
  if (contrast(brandHex, surface) >= min) return brandHex;
  for (const s of shades) if (contrast(s, surface) >= min) return s;
  return shades[shades.length - 1] || '#111111';
}
