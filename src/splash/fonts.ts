/**
 * A splash page's fonts, served by Roger: the families Claude chose (Google Fonts, open licences) are fetched once as
 * WOFF2, latin and latin-ext only, kept in "splash-fonts" and served from /api/splash/fonts/<key>.woff2 with inline
 * @font-face rules (font-display: swap) and the display face preloaded. Visitors never contact Google for a font.
 */
import { createHash } from 'node:crypto';
import { studioDocs } from '../store.js';
import { fetchRaw, type FetchOpts, type FetchResult } from '../util/http.js';

/** one face of a family: a weight range, a style and the characters it covers */
export interface SplashFontFace { family: string; style: string; weight: string; subset: string; unicodeRange?: string; key: string }
export interface FontDeps { fetch?: (url: string, opts: FetchOpts) => Promise<FetchResult> }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'; // WOFF2 is served to modern browsers
const SUBSETS = new Set(['latin', 'latin-ext']);
const key = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24);
const fontHost = (u: string) => { try { return new URL(u).hostname === 'fonts.gstatic.com'; } catch { return false; } };

/** Google's stylesheet for a family: at weights 400–800 where it has them, else as it comes */
async function familyCss(family: string, deps: FontDeps): Promise<string | undefined> {
  const f = encodeURIComponent(family).replace(/%20/g, '+');
  for (const q of [`family=${f}:wght@400;500;600;700;800`, `family=${f}:wght@400;700`, `family=${f}`]) {
    const r = await (deps.fetch ?? fetchRaw)(`https://fonts.googleapis.com/css2?${q}&display=swap`, { timeoutMs: 10000, maxBytes: 300_000, headers: { 'user-agent': UA, accept: 'text/css' } });
    if (r.ok) return r.body.toString('utf8');
  }
  return undefined;
}

/** the faces in Google's stylesheet ("/* latin *\/ @font-face {…}"), latin and latin-ext only */
export function parseFaces(css: string, family: string): (SplashFontFace & { url: string })[] {
  const out: (SplashFontFace & { url: string })[] = [];
  for (const m of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = m;
    if (!SUBSETS.has(subset)) continue;
    const url = body.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
    if (!url || !fontHost(url)) continue;
    out.push({ family, subset, url, key: key(url), style: body.match(/font-style:\s*([a-z]+)/)?.[1] ?? 'normal', weight: body.match(/font-weight:\s*([0-9 ]+)/)?.[1].trim() ?? '400', unicodeRange: body.match(/unicode-range:\s*([^;]+)/)?.[1].trim() });
  }
  // a variable font repeats one file per weight: one face for the whole range
  const seen = new Map<string, SplashFontFace & { url: string }>();
  for (const f of out) {
    const k = `${f.url}|${f.style}`, prev = seen.get(k);
    if (!prev) { seen.set(k, { ...f }); continue; }
    const ws = [...prev.weight.split(' '), ...f.weight.split(' ')].map(Number);
    prev.weight = `${Math.min(...ws)} ${Math.max(...ws)}`;
  }
  return [...seen.values()].map((f) => ({ ...f, weight: f.weight.split(' ')[0] === f.weight.split(' ')[1] ? f.weight.split(' ')[0] : f.weight }));
}

/** fetch and keep a page's fonts; a family Google does not have is reported, and the page falls back to its stack */
export async function selfHostFonts(families: string[], deps: FontDeps = {}): Promise<{ faces: SplashFontFace[]; missing: string[] }> {
  const faces: SplashFontFace[] = [], missing: string[] = [];
  for (const family of [...new Set(families)].slice(0, 3)) {
    const css = await familyCss(family, deps);
    const found = css ? parseFaces(css, family) : [];
    if (!found.length) { missing.push(family); continue; }
    for (const f of found) {
      if (!(await studioDocs.get('splash-fonts', f.key))) {
        const r = await (deps.fetch ?? fetchRaw)(f.url, { timeoutMs: 15000, maxBytes: 2_000_000, allow: async (u) => fontHost(u) });
        if (!r.ok || !r.body.length || r.body.subarray(0, 4).toString('latin1') !== 'wOF2') { missing.push(family); continue; }
        await studioDocs.put('splash-fonts', f.key, { key: f.key, family, url: f.url, data: r.body.toString('base64') });
      }
      const { url: _url, ...face } = f;
      faces.push(face);
    }
  }
  return { faces, missing: [...new Set(missing)] };
}

/** a stored font file */
export async function fontFile(k: string): Promise<Buffer | undefined> {
  if (!/^[a-f0-9]{24}$/.test(k)) return undefined;
  const d = await studioDocs.get<{ data: string }>('splash-fonts', k);
  return d ? Buffer.from(d.data, 'base64') : undefined;
}

export const fontUrl = (base: string, k: string) => `${base}/api/splash/fonts/${k}.woff2`;

/** the page's @font-face rules, and the display face's latin file to preload */
export function fontFaceCss(faces: SplashFontFace[], base: string): { css: string; preload?: string } {
  const q = (s: string) => `'${s.replace(/'/g, '')}'`;
  const css = faces.map((f) => `@font-face{font-family:${q(f.family)};font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${fontUrl(base, f.key)}) format('woff2')${f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ''}}`).join('\n');
  const first = faces.find((f) => f.subset === 'latin' && f.style === 'normal');
  return { css, preload: first ? fontUrl(base, first.key) : undefined };
}
