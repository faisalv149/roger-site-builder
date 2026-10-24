// Minimal color science: sRGB <-> OKLab/OKLCH, WCAG contrast, gamut mapping.

export type RGB = [number, number, number]; // 0..255
export type OKLCH = { l: number; c: number; h: number }; // l 0..1, c ~0..0.4, h degrees

export function parseHex(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Parse #hex, rgb()/rgba(), or a few named colors. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) return parseHex(s);
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null; // mostly transparent: not a brand color
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const named: Record<string, RGB> = { red: [255, 0, 0], navy: [0, 0, 128], green: [0, 128, 0], blue: [0, 0, 255], orange: [255, 165, 0], maroon: [128, 0, 0], teal: [0, 128, 128], purple: [128, 0, 128] };
  return named[s] || null;
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const x = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return x * 255;
};

export function rgbToOklch(rgb: RGB): OKLCH {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: OKLCH): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (lin: number[]) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

/** Convert to sRGB, reducing chroma (keeping L and H) until the color fits the gamut. */
export function oklchToRgb(col: OKLCH): RGB {
  let lin = oklchToLinear(col);
  if (!inGamut(lin)) {
    let lo = 0, hi = col.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...col, c: mid }))) lo = mid; else hi = mid;
    }
    lin = oklchToLinear({ ...col, c: lo });
  }
  return lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as RGB;
}

export const hexToOklch = (hex: string) => rgbToOklch(parseHex(hex)!);
export const oklchToHex = (c: OKLCH) => toHex(oklchToRgb(c));

export function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string | RGB, b: string | RGB): number {
  const A = typeof a === 'string' ? parseHex(a)! : a;
  const B = typeof b === 'string' ? parseHex(b)! : b;
  const la = luminance(A), lb = luminance(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Perceptual distance in OKLab, used to de-duplicate palette candidates. */
export function deltaE(a: RGB, b: RGB): number {
  const x = rgbToOklch(a), y = rgbToOklch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180), bx = x.c * Math.sin((x.h * Math.PI) / 180);
  const ay = y.c * Math.cos((y.h * Math.PI) / 180), by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.sqrt((x.l - y.l) ** 2 + (ax - ay) ** 2 + (bx - by) ** 2);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)!;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
