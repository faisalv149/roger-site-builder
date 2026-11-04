import type { BusinessBrief } from '../schema.js';
import type { DesignTokens, DirectionAxes } from './types.js';

/**
 * Design tokens for a concept, from the brand evidence and the concept's direction. Colours start from the business's
 * own (measured on its website, else its logo); every text-on-colour pair is then adjusted until it reads (WCAG AA),
 * so contrast is computed, never hoped for. Type comes from a small set of pairs by voice, or the business's own
 * fonts when it uses Google Fonts.
 */

// ───────────────────────── colour ─────────────────────────
type RGB = [number, number, number];
const hexToRgb = (h: string): RGB => { const x = h.replace('#', ''); const v = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB; };
const rgbToHex = (c: RGB) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (h: string) => { const [r, g, b] = hexToRgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const mix = (a: string, b: string, t: number) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as RGB); };
const rgbToHsl = ([r, g, b]: RGB): [number, number, number] => {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
};
export const saturation = (h: string) => rgbToHsl(hexToRgb(h))[1];
/** the readable text colour on a fill: near-white or near-black, whichever reads better */
export const inkOn = (bg: string, light = '#FFFFFF', dark = '#14161A') => (contrast(light, bg) >= contrast(dark, bg) ? light : dark);
/** darken or lighten a fill until the given text colour reads on it at the ratio */
export function fitFill(fill: string, text: string, ratio = 4.5): string {
  if (contrast(fill, text) >= ratio) return fill;
  const towards = luminance(text) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.04; t <= 1; t += 0.04) { const c = mix(fill, towards, t); if (contrast(c, text) >= ratio) return c; }
  return towards;
}
/** a text colour of the same hue that reads on the background */
export function fitText(color: string, bg: string, ratio = 4.5): string {
  if (contrast(color, bg) >= ratio) return color;
  const towards = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1; t += 0.05) { const c = mix(color, towards, t); if (contrast(c, bg) >= ratio) return c; }
  return towards;
}

/** The business's colours with where they came from: measured on its site, its logo, or none. */
export function brandColors(brief: BusinessBrief): { primary?: string; accent?: string; button?: string; origin: string } {
  const by = (role: string) => brief.brand.colors.find((c) => c.role === role)?.hex;
  const primary = by('primary'), accent = by('accent'), button = by('button');
  if (primary || button) return { primary: primary ?? button, accent: accent ?? (button !== primary ? button : undefined), button, origin: `measured on the website (confidence ${brief.brand.confidence})` };
  const logo = (brief.brand.logo.value?.colors ?? []).filter((c) => saturation(c) > 0.25);
  if (logo.length) return { primary: logo[0], accent: logo[1], origin: 'taken from the logo' };
  return { origin: 'proposed: no brand colour was found' };
}

function palette(brief: BusinessBrief, strategy: DirectionAxes['colorStrategy']): { colors: DesignTokens['colors']; origin: string } {
  const b = brandColors(brief);
  // with no colour of its own, a quiet slate stands in, marked as proposed
  let brand = b.primary ?? '#2F4858';
  let accent = b.accent ?? b.button ?? mix(brand, '#E0A040', 0.6);
  // a near-black brand (Caliber's #141422) is the page's deep tone; its accent carries the colour
  const brandIsDark = luminance(brand) < 0.03 && saturation(brand) < 0.5;
  if (brandIsDark && b.accent) { const t = brand; brand = accent; accent = t; }
  const deepBase = brandIsDark ? (b.primary as string) : mix(brand, '#0B0D12', 0.72);
  let c: DesignTokens['colors'];
  if (strategy === 'brand-dominant') {
    const bg = mix(brand, '#FFFFFF', 0.94);
    c = { bg, surface: mix(brand, '#FFFFFF', 0.86), ink: '#121417', muted: '#3D434C', line: mix(brand, '#FFFFFF', 0.62), brand, onBrand: '#FFFFFF', brandText: brand, accent, onAccent: '#FFFFFF', action: accent, onAction: '#FFFFFF', deep: deepBase, onDeep: '#FFFFFF' };
  } else if (strategy === 'brand-accent') {
    const bg = '#F6F3EE';
    c = { bg, surface: '#FFFFFF', ink: '#17181C', muted: '#4A4F57', line: '#E2DDD4', brand, onBrand: '#FFFFFF', brandText: brand, accent, onAccent: '#FFFFFF', action: brand, onAction: '#FFFFFF', deep: mix(deepBase, '#1A1C22', 0.35), onDeep: '#FFFFFF' };
  } else {
    c = { bg: '#FFFFFF', surface: '#F4F5F7', ink: '#111316', muted: '#4B5058', line: '#E3E5E9', brand: mix(brand, '#111316', 0.15), onBrand: '#FFFFFF', brandText: brand, accent, onAccent: '#FFFFFF', action: b.button ?? accent, onAction: '#FFFFFF', deep: '#15171B', onDeep: '#FFFFFF' };
  }
  // every text-on-fill pair reads at 4.5:1 or better
  c.onBrand = inkOn(c.brand); c.brand = fitFill(c.brand, c.onBrand);
  c.onAccent = inkOn(c.accent); c.accent = fitFill(c.accent, c.onAccent);
  c.onAction = inkOn(c.action); c.action = fitFill(c.action, c.onAction);
  c.onDeep = inkOn(c.deep); c.deep = fitFill(c.deep, c.onDeep);
  c.muted = fitText(c.muted, c.bg); c.muted = fitText(c.muted, c.surface);
  c.brandText = fitText(fitText(c.brand, c.bg), c.surface);
  return { colors: c, origin: b.origin };
}

// ───────────────────────── type ─────────────────────────
const PAIRS: Record<DirectionAxes['typeVoice'], { heading: string; weight: number; body: string; headingFallback: string }> = {
  grotesk: { heading: 'Space Grotesk', weight: 700, body: 'Public Sans', headingFallback: 'Arial, sans-serif' },
  humanist: { heading: 'Figtree', weight: 800, body: 'Source Sans 3', headingFallback: 'Segoe UI, sans-serif' },
  serif: { heading: 'Fraunces', weight: 600, body: 'Karla', headingFallback: 'Georgia, serif' },
  slab: { heading: 'Zilla Slab', weight: 700, body: 'Work Sans', headingFallback: 'Rockwell, Georgia, serif' },
  display: { heading: 'Bricolage Grotesque', weight: 800, body: 'DM Sans', headingFallback: 'Arial Black, sans-serif' },
};
/** families the business uses that Google Fonts serves, so a concept can use them as they are */
const GOOGLE = new Set(['Manrope', 'Roboto', 'Fraunces', 'Climate Crisis', 'Montserrat', 'Poppins', 'Lato', 'Open Sans', 'Inter', 'Oswald', 'Raleway', 'Playfair Display', 'Merriweather', 'Work Sans', 'DM Sans', 'Nunito', 'Archivo', 'Barlow', 'Rubik', 'Outfit', 'Sora', 'Lora', 'Libre Baskerville', 'Bebas Neue', 'Anton', 'Josefin Sans', 'Quicksand', 'Mulish', 'Karla', 'PT Serif', 'Source Sans 3', 'Space Grotesk', 'Figtree', 'Plus Jakarta Sans', 'Cormorant Garamond', 'Archivo Black', 'Syne', 'Fjalla One', 'Abril Fatface']);
const fam = (f: string) => f.replace(/_\d+pt.*$/i, '').replace(/[-_](light|regular|medium|semibold|bold|black)\d*$/i, '').replace(/\s*\d+$/, '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
/** the brand's own Google font for headings, if it has one (Manrope, Fraunces, Climate Crisis) */
export function brandHeadingFont(brief: BusinessBrief): string | undefined {
  const order = [...brief.brand.fonts.filter((f) => f.role === 'heading'), ...brief.brand.fonts.filter((f) => f.role === 'found'), ...brief.brand.fonts.filter((f) => f.role === 'body')];
  for (const f of order) { const name = [...GOOGLE].find((g) => g.toLowerCase() === fam(f.family).toLowerCase()); if (name) return name; }
  return undefined;
}

export const DISPLAY_ONLY = new Set(['Climate Crisis', 'Bebas Neue', 'Anton', 'Abril Fatface', 'Archivo Black']);
/** about how wide a face sets a capital, in ems: enough to size a headline so its longest word fits its column */
const WIDE: Record<string, number> = { 'Climate Crisis': 1.02, 'Archivo Black': 0.8, 'Abril Fatface': 0.72, 'Bricolage Grotesque': 0.74, Fraunces: 0.74, Manrope: 0.72, 'Space Grotesk': 0.7, Figtree: 0.7, 'Zilla Slab': 0.64, 'Bebas Neue': 0.42, Anton: 0.5 };
export const capWidth = (family: string) => WIDE[family] ?? 0.72;

export function tokensFor(brief: BusinessBrief, axes: DirectionAxes, opts: { useBrandFont: boolean }): DesignTokens {
  const { colors, origin } = palette(brief, axes.colorStrategy);
  const pair = PAIRS[axes.typeVoice];
  const own = opts.useBrandFont ? brandHeadingFont(brief) : undefined;
  const heading = own ?? pair.heading;
  const weight = own ? (DISPLAY_ONLY.has(own) ? 400 : 700) : pair.weight;
  const families = [...new Set([heading, pair.body])];
  const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${f === heading ? `${weight === 400 ? 400 : `400;${weight}`}` : '400;500;700'}`).join('&')}&display=swap`;
  return {
    colors,
    fonts: { heading: { family: heading, weight, css: `'${heading}', ${pair.headingFallback}` }, body: { family: pair.body, css: `'${pair.body}', system-ui, sans-serif` }, href },
    radius: axes.typeVoice === 'grotesk' || axes.typeVoice === 'display' ? 4 : axes.typeVoice === 'serif' ? 2 : 14,
    space: axes.density === 'airy' ? 1.35 : axes.density === 'dense' ? 0.78 : 1,
    headingCase: brief.brand.headingCase === 'upper' || axes.typeVoice === 'display' ? 'uppercase' : 'none',
    origin: { colors: origin, fonts: own ? `${own}: the business's own font (measured on its website)` : `${heading} and ${pair.body}: proposed for the ${axes.typeVoice} voice` },
  };
}
