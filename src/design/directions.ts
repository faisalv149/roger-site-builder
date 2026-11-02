import type { Theme } from '../theme/schema.js';
import type { Density, Direction, TypePreset } from './schema.js';

/**
 * The three plumbing directions. Each one sets the surfaces, type, spacing, shape and button style the page is
 * rendered with; brand colours still come from the business (logo → website → default) and pass the same
 * contrast rules (src/brand/brand.ts) against these surfaces.
 */
export interface DirectionPreset {
  label: string;
  palette: { ink: string; inkMuted: string; surface: string; surfaceAlt: string };
  /** dark band behind contact strips, stats, the bold hero (never pure black: reads harsh next to photos) */
  band: string;
  radius: { sm: number; md: number; lg: number };
  shadow: string;
  sectionY: { phone: number; desktop: number };
  density: 'compact' | 'comfortable' | 'spacious';
  grid: { maxWidth: number; gutter: number; margin: { phone: number; desktop: number } };
  buttons: { radius: string; height: number; case: 'none' | 'uppercase'; weight: number };
  overlay: { style: 'solid' | 'gradient-left' | 'gradient-bottom'; alpha: number };
}

export const DIRECTION_PRESETS: Record<Direction, DirectionPreset> = {
  // crisp white and cool greys, balanced sans type, gentle shadows: fits any business
  'clean-professional': {
    label: 'Clean professional',
    palette: { ink: '#101828', inkMuted: '#475467', surface: '#FFFFFF', surfaceAlt: '#F5F7FA' },
    band: '#101828',
    radius: { sm: 8, md: 12, lg: 18 },
    shadow: '0 1px 2px rgba(16,24,40,.05), 0 10px 28px -14px rgba(16,24,40,.2)',
    sectionY: { phone: 56, desktop: 96 },
    density: 'comfortable',
    grid: { maxWidth: 1200, gutter: 24, margin: { phone: 20, desktop: 40 } },
    buttons: { radius: '10px', height: 50, case: 'none', weight: 600 },
    overlay: { style: 'gradient-left', alpha: 0.55 },
  },
  // warm neutral surfaces, soft rounded shapes, comfortable spacing
  'local-trusted': {
    label: 'Local & trusted',
    palette: { ink: '#2B2521', inkMuted: '#6A5D54', surface: '#FBF8F3', surfaceAlt: '#F2ECE3' },
    band: '#3A302A',
    radius: { sm: 8, md: 14, lg: 24 },
    shadow: '0 1px 2px rgba(43,37,33,.06), 0 12px 32px -16px rgba(43,37,33,.28)',
    sectionY: { phone: 56, desktop: 96 },
    density: 'comfortable',
    grid: { maxWidth: 1160, gutter: 28, margin: { phone: 20, desktop: 40 } },
    buttons: { radius: '999px', height: 52, case: 'none', weight: 600 },
    overlay: { style: 'gradient-left', alpha: 0.55 },
  },
  // crisp white, near-black bands, square shapes, tight rhythm
  'bold-direct': {
    label: 'Bold & direct',
    palette: { ink: '#0D1117', inkMuted: '#46505C', surface: '#FFFFFF', surfaceAlt: '#F1F2F4' },
    band: '#11161D',
    radius: { sm: 2, md: 4, lg: 6 },
    shadow: 'none',
    sectionY: { phone: 40, desktop: 72 },
    density: 'compact',
    grid: { maxWidth: 1240, gutter: 20, margin: { phone: 16, desktop: 32 } },
    buttons: { radius: '4px', height: 56, case: 'uppercase', weight: 800 },
    overlay: { style: 'solid', alpha: 0.62 },
  },
  // off-white, hairlines instead of shadows, generous whitespace
  'modern-premium': {
    label: 'Modern & premium',
    palette: { ink: '#171717', inkMuted: '#5E5C57', surface: '#FAFAF7', surfaceAlt: '#F0EEE8' },
    band: '#1C1B19',
    radius: { sm: 0, md: 2, lg: 4 },
    shadow: 'none',
    sectionY: { phone: 72, desktop: 136 },
    density: 'spacious',
    grid: { maxWidth: 1280, gutter: 32, margin: { phone: 20, desktop: 56 } },
    buttons: { radius: '999px', height: 52, case: 'none', weight: 500 },
    overlay: { style: 'gradient-bottom', alpha: 0.5 },
  },
};

/** Curated type pairs. Only the selected pair's two families (and only the weights used) are loaded. */
export interface TypePresetDef {
  label: string;
  heading: { family: string; weights: number[]; fallback: string };
  body: { family: string; weights: number[]; fallback: string };
  headingWeight: number;
  headingCase: 'none' | 'uppercase';
  tracking: string;
  lineHeight: { heading: number; body: number };
  measure: number;
  scale: { xs: number; sm: number; md: number; lg: number; xl: number; '2xl': number; '3xl': number; '4xl': { phone: number; desktop: number } };
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const CONDENSED = "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";

export const TYPE_PRESET_DEFS: Record<TypePreset, TypePresetDef> = {
  'clean-sans': {
    label: 'Manrope + Inter',
    heading: { family: 'Manrope', weights: [700], fallback: SANS },
    body: { family: 'Inter', weights: [400, 500], fallback: SANS },
    headingWeight: 700, headingCase: 'none', tracking: '-0.02em', lineHeight: { heading: 1.1, body: 1.6 }, measure: 64,
    scale: { xs: 13, sm: 15, md: 17, lg: 20, xl: 24, '2xl': 32, '3xl': 44, '4xl': { phone: 38, desktop: 62 } },
  },
  'clean-geometric': {
    label: 'Plus Jakarta Sans',
    heading: { family: 'Plus Jakarta Sans', weights: [700], fallback: SANS },
    body: { family: 'Plus Jakarta Sans', weights: [400, 500], fallback: SANS },
    headingWeight: 700, headingCase: 'none', tracking: '-0.025em', lineHeight: { heading: 1.1, body: 1.6 }, measure: 64,
    scale: { xs: 13, sm: 15, md: 17, lg: 20, xl: 24, '2xl': 32, '3xl': 44, '4xl': { phone: 38, desktop: 60 } },
  },
  'warm-serif': {
    label: 'Fraunces + Source Sans 3',
    heading: { family: 'Fraunces', weights: [600], fallback: SERIF },
    body: { family: 'Source Sans 3', weights: [400, 600], fallback: SANS },
    headingWeight: 600, headingCase: 'none', tracking: '-0.01em', lineHeight: { heading: 1.12, body: 1.6 }, measure: 64,
    scale: { xs: 13, sm: 15, md: 17, lg: 20, xl: 24, '2xl': 32, '3xl': 42, '4xl': { phone: 38, desktop: 58 } },
  },
  'friendly-sans': {
    label: 'Nunito + Nunito Sans',
    heading: { family: 'Nunito', weights: [800], fallback: SANS },
    body: { family: 'Nunito Sans', weights: [400, 600], fallback: SANS },
    headingWeight: 800, headingCase: 'none', tracking: '-0.015em', lineHeight: { heading: 1.12, body: 1.6 }, measure: 64,
    scale: { xs: 13, sm: 15, md: 17, lg: 20, xl: 24, '2xl': 32, '3xl': 42, '4xl': { phone: 38, desktop: 56 } },
  },
  'compact-grotesk': {
    label: 'Barlow Condensed + Barlow',
    heading: { family: 'Barlow Condensed', weights: [700], fallback: CONDENSED },
    body: { family: 'Barlow', weights: [400, 600], fallback: SANS },
    headingWeight: 700, headingCase: 'uppercase', tracking: '0.005em', lineHeight: { heading: 0.98, body: 1.5 }, measure: 62,
    scale: { xs: 13, sm: 15, md: 17, lg: 21, xl: 28, '2xl': 38, '3xl': 54, '4xl': { phone: 46, desktop: 96 } },
  },
  'heavy-grotesk': {
    label: 'Archivo',
    heading: { family: 'Archivo', weights: [800], fallback: SANS },
    body: { family: 'Archivo', weights: [400, 600], fallback: SANS },
    headingWeight: 800, headingCase: 'uppercase', tracking: '-0.01em', lineHeight: { heading: 1, body: 1.5 }, measure: 62,
    scale: { xs: 13, sm: 15, md: 17, lg: 20, xl: 26, '2xl': 34, '3xl': 46, '4xl': { phone: 40, desktop: 76 } },
  },
  editorial: {
    label: 'Playfair Display + Inter',
    heading: { family: 'Playfair Display', weights: [500], fallback: SERIF },
    body: { family: 'Inter', weights: [400, 500], fallback: SANS },
    headingWeight: 500, headingCase: 'none', tracking: '-0.02em', lineHeight: { heading: 1.06, body: 1.7 }, measure: 60,
    scale: { xs: 13, sm: 15, md: 17, lg: 21, xl: 26, '2xl': 36, '3xl': 52, '4xl': { phone: 42, desktop: 84 } },
  },
  'editorial-sans': {
    label: 'Inter Tight + Inter',
    heading: { family: 'Inter Tight', weights: [400], fallback: SANS },
    body: { family: 'Inter', weights: [400, 500], fallback: SANS },
    headingWeight: 400, headingCase: 'none', tracking: '-0.035em', lineHeight: { heading: 1.04, body: 1.7 }, measure: 60,
    scale: { xs: 13, sm: 15, md: 17, lg: 21, xl: 26, '2xl': 36, '3xl': 52, '4xl': { phone: 42, desktop: 86 } },
  },
};

/** One Google Fonts request for the pair (families merged when the pair uses one family). */
export function fontsUrl(p: TypePresetDef): string {
  const fams = new Map<string, Set<number>>();
  for (const f of [p.heading, p.body]) for (const w of f.weights) (fams.get(f.family) || fams.set(f.family, new Set()).get(f.family)!).add(w);
  const q = [...fams].map(([fam, ws]) => `family=${fam.replace(/ /g, '+')}:wght@${[...ws].sort((a, b) => a - b).join(';')}`).join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
export const fontStack = (f: TypePresetDef['heading']) => `'${f.family}', ${f.fallback}`;

/**
 * Restyle a theme clone for a direction + type preset, before the brand colour is resolved against it.
 * Only presentation tokens change; copy, services and SEO patterns stay the theme's.
 */
export const DENSITY_K: Record<Density, number> = { compact: 0.78, comfortable: 1, spacious: 1.25 };

export function applyDirectionTokens(t: Theme, direction: Direction, preset: TypePreset, density?: Density): void {
  const d = DIRECTION_PRESETS[direction];
  const ty = TYPE_PRESET_DEFS[preset];
  const k = DENSITY_K[density || d.density];
  t.palette = { ...t.palette, ...d.palette };
  t.radius = { ...t.radius, ...d.radius };
  t.shadow = { ...t.shadow, card: d.shadow };
  t.spacing = { ...t.spacing, sectionY: { phone: Math.round(d.sectionY.phone * k), desktop: Math.round(d.sectionY.desktop * k) }, density: density || d.density };
  t.grid = { ...t.grid, system: '12-col', columns: 12, maxWidth: d.grid.maxWidth, gutter: d.grid.gutter, margin: d.grid.margin, sidebar: undefined };
  t.overlayStyle = d.overlay.style;
  t.overlayAlpha = d.overlay.alpha;
  const btn = (fill: string, ink: string, border: string) => ({ ...t.buttons.primary, fill, ink, border, radius: d.buttons.radius, height: d.buttons.height, case: d.buttons.case, weight: d.buttons.weight });
  t.buttons = { ...t.buttons, primary: btn('brand', 'brand-ink', 'none'), secondary: btn('transparent', 'brand', 'brand'), minTapTarget: 48, focusRing: '3px solid shade-1' };
  t.type = { ...t.type, scale: ty.scale, measure: ty.measure, headingWeight: ty.headingWeight, headingCase: ty.headingCase, headingTracking: ty.tracking, lineHeight: ty.lineHeight, bodyWeight: 400 };
  t.fontPairs = [{ id: preset, label: ty.label, heading: fontStack(ty.heading), body: fontStack(ty.body) }];
  t.defaultPair = preset;
  t.fontFaces = [];
  t.motion = 'subtle';
}
