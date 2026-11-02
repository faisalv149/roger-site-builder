import { contrast, hexToOklch, oklchToHex } from '../color/oklch.js';
import { TYPE_PRESET_DEFS, fontsUrl, fontStack } from './directions.js';
import type { Appearance } from './schema.js';

/**
 * The owner's appearance choices (preview customiser) → CSS variables. Server-side and validated: the editor asks
 * for these on every change (no regeneration), and the saved site renders the same block. Text stays readable:
 * button text against every gradient stop, the accent as text against the page surface.
 */
export interface AppearanceContext { brand: string; surface: string; ink: string; shades?: string[] }
export interface ResolvedAppearance {
  vars: Record<string, string>;
  fonts?: { heading: string; body: string; url: string };
  motion: 'off' | 'subtle' | 'expressive';
  /** what was adjusted for readability, shown in the editor */
  notes: string[];
  /** the swatch the dock shows (solid colour or gradient) */
  swatch: string;
}

const WHITE = '#FFFFFF';
export const COLOR_PRESET_HEX: Record<string, (c: Required<AppearanceContext>) => string> = {
  brand: (c) => c.brand, 'brand-deep': (c) => c.shades[0] || c.brand, ink: (c) => c.ink,
  forest: () => '#166534', ocean: () => '#0369A1', plum: () => '#7E22CE', terracotta: () => '#C2410C', gold: () => '#B45309',
};
export const GRADIENT_PRESET_HEX: Record<string, (c: Required<AppearanceContext>) => [string, string]> = {
  'brand-fade': (c) => [c.brand, c.shades[1] || c.shades[0] || c.ink], sunset: () => ['#EA580C', '#BE185D'], ocean: () => ['#0284C7', '#4338CA'],
  forest: () => ['#15803D', '#0F766E'], plum: () => ['#7C3AED', '#BE185D'], slate: () => ['#334155', '#0F172A'],
};

/** Darken (OKLCH, keeping hue) until `fg` reads on it at 4.5:1. */
function darkenFor(bg: string, fg: string): { hex: string; changed: boolean } {
  if (contrast(bg, fg) >= 4.5) return { hex: bg.toUpperCase(), changed: false };
  let o = hexToOklch(bg);
  for (let i = 0; i < 80 && o.l > 0.12; i++) {
    o = { ...o, l: o.l - 0.01 };
    const h = oklchToHex(o);
    if (contrast(h, fg) >= 4.5) return { hex: h.toUpperCase(), changed: true };
  }
  return { hex: oklchToHex({ ...o, l: 0.2 }).toUpperCase(), changed: true };
}
const scale = (hex: string) => {
  const o = hexToOklch(hex);
  return {
    tints: [0.97, 0.94, 0.9].map((l, i) => oklchToHex({ l, c: Math.min(o.c, 0.12) * (0.12 + i * 0.1), h: o.h })),
    shades: [0.45, 0.35, 0.25].map((l, i) => oklchToHex({ l, c: o.c * (1 - i * 0.1), h: o.h })),
  };
};

export function resolveAppearance(a: Appearance, ctx: AppearanceContext): ResolvedAppearance {
  const c = { ...ctx, shades: ctx.shades && ctx.shades.length >= 2 ? ctx.shades : scale(ctx.brand).shades };
  const vars: Record<string, string> = {};
  const notes: string[] = [];
  const col = a.color || { mode: 'solid' as const };
  let swatch = c.brand;
  // solid accent: a preset or the owner's own colour, adjusted only as far as readability needs
  const raw = col.accent || (col.preset ? COLOR_PRESET_HEX[col.preset]?.(c) : undefined);
  if (col.mode === 'gradient') {
    const g: { preset?: keyof typeof GRADIENT_PRESET_HEX; from?: string; to?: string; angle?: number } = col.gradient || {};
    const [f0, t0] = g.preset ? GRADIENT_PRESET_HEX[g.preset](c) : [g.from || raw || c.brand, g.to || c.shades[0] || c.ink];
    const f = darkenFor(f0, WHITE);
    const t = darkenFor(t0, WHITE);
    if (f.changed || t.changed) notes.push('The gradient was deepened slightly so white button text stays readable.');
    const angle = g.angle ?? 135;
    const grad = `linear-gradient(${angle}deg, ${f.hex}, ${t.hex})`;
    const text = darkenFor(f.hex, c.surface);
    const s = scale(f.hex);
    Object.assign(vars, { '--brand': f.hex, '--brand-ink': WHITE, '--brand-text': text.hex, '--btn-bg': grad, '--band-bg': grad, '--tint-1': s.tints[0], '--tint-2': s.tints[1], '--tint-3': s.tints[2], '--shade-1': s.shades[0], '--shade-2': s.shades[1], '--shade-3': s.shades[2] });
    swatch = grad;
  } else if (raw) {
    // white text when it can be made readable without turning the colour muddy; dark text for light colours
    const light = hexToOklch(raw).l >= 0.72 && contrast(raw, c.ink) >= 4.5;
    const ink = light ? c.ink : WHITE;
    const fill = light ? { hex: raw.toUpperCase(), changed: false } : darkenFor(raw, WHITE);
    if (fill.changed) notes.push(`${raw.toUpperCase()} was deepened to ${fill.hex} so button text stays readable.`);
    const text = darkenFor(fill.hex, c.surface);
    if (text.changed && !fill.changed) notes.push('Links use a deeper shade of the colour so they read on the page background.');
    const s = scale(fill.hex);
    Object.assign(vars, { '--brand': fill.hex, '--brand-ink': ink, '--brand-text': text.hex, '--btn-bg': fill.hex, '--band-bg': fill.hex, '--tint-1': s.tints[0], '--tint-2': s.tints[1], '--tint-3': s.tints[2], '--shade-1': s.shades[0], '--shade-2': s.shades[1], '--shade-3': s.shades[2] });
    swatch = fill.hex;
  }
  let fonts: ResolvedAppearance['fonts'];
  if (a.font) {
    const p = TYPE_PRESET_DEFS[a.font];
    fonts = { heading: fontStack(p.heading), body: fontStack(p.body), url: fontsUrl(p) };
    Object.assign(vars, { '--font-heading': fonts.heading, '--font-body': fonts.body, '--hw': String(p.headingWeight), '--h-track': p.tracking, '--lh-h': String(p.lineHeight.heading), '--h-case': p.headingCase });
  }
  if (a.textSize) vars['--tk'] = a.textSize === 'compact' ? '0.93' : '1';
  if (a.buttons) vars['--btn-r'] = { rounded: '10px', pill: '999px', square: '3px' }[a.buttons];
  if (a.corners) Object.assign(vars, { sharp: { '--r-sm': '2px', '--r-md': '3px', '--r-lg': '4px' }, soft: { '--r-sm': '6px', '--r-md': '10px', '--r-lg': '16px' }, round: { '--r-sm': '12px', '--r-md': '18px', '--r-lg': '28px' } }[a.corners]);
  if (a.spacing) vars['--density'] = { compact: '0.8', comfortable: '1', spacious: '1.22' }[a.spacing];
  return { vars, fonts, motion: a.motion || 'subtle', notes, swatch };
}

/** The saved appearance as a CSS block (static output) */
export const appearanceCss = (r: ResolvedAppearance) => (Object.keys(r.vars).length ? `:root{${Object.entries(r.vars).map(([k, v]) => `${k}:${v}`).join(';')}}` : '');
