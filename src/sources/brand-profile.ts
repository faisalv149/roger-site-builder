import sharp from 'sharp';
import { contrast, deltaE, parseHex, rgbToOklch, toHex } from '../color/oklch.js';

/**
 * A business's brand as its own website shows it: which colours carry the page (backgrounds, headings, buttons, the
 * header), the button style, and the typefaces, measured from the page as a browser renders it. The logo adds colours
 * but does not define the palette on its own. Every colour records where it was seen and how sure the reading is.
 * Nothing here is specific to a business: the roles come from how the colours are used.
 */

export interface RawBrand {
  bg: Record<string, { w: number; ex: string[] }>;
  text: { heading: Record<string, { w: number; ex: string[] }>; body: Record<string, { w: number; ex: string[] }> };
  fonts: { heading: Record<string, { w: number; ex: string[] }>; body: Record<string, { w: number; ex: string[] }> };
  buttons: { bg: string; text: string; radius: number; label: string; where: string; border?: string }[];
  header?: { bg: string; where: string };
  footer?: { bg: string; where: string };
  elements: number;
}

/** Runs inside the page (plain JavaScript, kept as a string so no build step rewrites it). */
export const BRAND_SAMPLER = `(() => {
  const out = { bg: {}, text: { heading: {}, body: {} }, fonts: { heading: {}, body: {} }, buttons: [], elements: 0 };
  const rgba = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const sel = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id.slice(0, 24) : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(/\\s+/)[0].slice(0, 28) : '');
  const add = (map, k, w, ex) => { const m = map[k] || (map[k] = { w: 0, ex: [] }); m.w += w; if (ex && m.ex.length < 3 && m.ex.indexOf(ex) < 0) m.ex.push(ex); };
  const all = Array.prototype.slice.call(document.querySelectorAll('body *'), 0, 9000);
  const vw = window.innerWidth;
  const opaque = (e) => { const c = rgba(getComputedStyle(e).backgroundColor); return c && c.a >= 0.9 ? c : null; };
  let header = null, footer = null;
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    out.elements++;
    const bg = rgba(cs.backgroundColor);
    if (bg && bg.a >= 0.9) {
      add(out.bg, hex(bg), Math.min(r.width * r.height, 4e6), sel(e));
      if (r.top + scrollY < 140 && r.width >= vw * 0.9 && r.height >= 30 && r.height <= 220 && (!header || r.top < header.top)) header = { bg: hex(bg), where: sel(e), top: r.top };
      const docH = document.documentElement.scrollHeight;
      if (r.bottom + scrollY > docH - 400 && r.width >= vw * 0.9 && r.height >= 40 && (!footer || r.bottom > footer.bottom)) footer = { bg: hex(bg), where: sel(e), bottom: r.bottom };
    }
    let t = '';
    for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent;
    t = t.trim();
    if (t.length > 1) {
      const col = rgba(cs.color);
      const fs = parseFloat(cs.fontSize);
      const isHead = /^H[1-6]$/.test(e.tagName) || fs >= 22;
      if (col && col.a > 0.5) add(isHead ? out.text.heading : out.text.body, hex(col), t.length, sel(e) + ' "' + t.slice(0, 24) + '"');
      const stack = cs.fontFamily;
      const fam = stack.split(',')[0].replace(/["']/g, '').trim();
      const kind = /sans-serif/i.test(stack) ? 'sans' : /serif/i.test(stack) ? 'serif' : /monospace/i.test(stack) ? 'mono' : '?';
      add(isHead ? out.fonts.heading : out.fonts.body, fam + '|' + kind, t.length, sel(e));
    }
    if (/^(A|BUTTON)$/.test(e.tagName) || e.getAttribute('role') === 'button') {
      const label = (e.textContent || '').trim();
      if (label.length < 1 || label.length > 32) continue;
      // the coloured shape behind the label: the element itself or a nearby container
      let host = null, h = e;
      for (let i = 0; i < 5 && h && h !== document.body; i++, h = h.parentElement) {
        const c = opaque(h);
        const hr = h.getBoundingClientRect();
        if (c && hr.width * hr.height <= 130000 && hr.height <= 130) { host = h; break; }
      }
      if (!host) continue;
      let te = e;
      const deepest = e.querySelector('span, div');
      if (deepest && (deepest.textContent || '').trim() === label) te = deepest;
      const hs = getComputedStyle(host);
      out.buttons.push({ bg: hex(opaque(host)), text: hex(rgba(getComputedStyle(te).color) || { r: 0, g: 0, b: 0 }), radius: parseFloat(hs.borderTopLeftRadius) || 0, label: label.slice(0, 24), where: sel(host), border: hs.borderTopWidth !== '0px' ? hs.borderTopColor : undefined });
    }
  }
  if (header) out.header = { bg: header.bg, where: header.where };
  if (footer) out.footer = { bg: footer.bg, where: footer.where };
  out.buttons = out.buttons.slice(0, 40);
  return out;
})()`;

// ───────────────────────── analysis ─────────────────────────
export type Confidence = 'high' | 'medium' | 'low';
export interface Evidence { where: string; detail: string }
export interface BrandColor { hex: string; role: string; confidence: Confidence; evidence: Evidence[] }
export interface FontReading { family: string; kind: 'sans' | 'serif' | 'mono' | 'unknown'; evidence: string }
export interface FontSubstitution { from: string; to: string; kind: 'sans' | 'serif'; reason: string }

export interface BrandProfile {
  /** rendered: measured in a browser; css: read from the page's stylesheets; logo: from the logo alone; none: nothing found */
  method: 'rendered' | 'css' | 'logo' | 'none';
  sourceUrl?: string;
  /** the colour that carries the page (large panels, headings, the header) */
  primary?: BrandColor;
  /** the accent: what buttons and highlights are filled with */
  secondary?: BrandColor;
  backgrounds: BrandColor[];
  text: BrandColor[];
  headingText?: BrandColor;
  button?: { fill: string; text: string; radius: number; label: string; confidence: Confidence; evidence: Evidence[] };
  header?: { background: string; where: string };
  footer?: { background: string; where: string };
  typography?: { heading?: FontReading; body?: FontReading; substitution?: { heading?: FontSubstitution; body?: FontSubstitution } };
  logo?: { colors: string[]; url?: string };
  notes: string[];
}

const hexOf = (h: string) => h.toUpperCase();
const rgb = (h: string) => parseHex(h)!;
/** chroma and lightness in OKLCH: neutrals have almost no chroma */
const chroma = (h: string) => rgbToOklch(rgb(h)).c;
const lightness = (h: string) => rgbToOklch(rgb(h)).l;
const isNeutral = (h: string) => chroma(h) < 0.05;
/** OKLab distance: under about 0.06 the eye reads two colours as the same */
const near = (a: string, b: string) => deltaE(rgb(a), rgb(b)) < 0.06;

function topEntries(map: Record<string, { w: number; ex: string[] }>, n = 6) {
  return Object.entries(map).sort((a, b) => b[1].w - a[1].w).slice(0, n).map(([hex, v]) => ({ hex: hexOf(hex), w: v.w, ex: v.ex }));
}

/** A close family of the page's own typeface, among families the site can load. Explicit, so nothing is substituted silently. */
const KNOWN_SANS = ['Inter', 'Nunito Sans', 'Lato', 'Open Sans', 'Roboto', 'Montserrat', 'Poppins', 'Source Sans 3', 'Work Sans', 'DM Sans', 'Jost', 'Raleway', 'Manrope'];
const KNOWN_SERIF = ['Fraunces', 'Playfair Display', 'Lora', 'Merriweather', 'Source Serif 4', 'Cormorant Garamond'];
export function substituteFont(family: string, kind: 'sans' | 'serif', role: 'heading' | 'body'): FontSubstitution {
  const f = family.toLowerCase();
  const exact = [...KNOWN_SANS, ...KNOWN_SERIF].find((k) => f === k.toLowerCase() || f.replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, ''));
  if (exact) return { from: family, to: exact, kind, reason: `${family} is available as a web font, so it is used as is` };
  const pick = (to: string, why: string): FontSubstitution => ({ from: family, to, kind, reason: why });
  if (kind === 'serif') return pick(f.includes('garamond') ? 'Cormorant Garamond' : f.includes('didot') || f.includes('bodoni') ? 'Playfair Display' : 'Lora', 'a proprietary or system serif; the closest free serif is used');
  if (/avenir|proxima|nunito|gotham|circular|sofia/.test(f)) return pick('Nunito Sans', `${family} is a licensed typeface; Nunito Sans is the closest free humanist sans`);
  if (/futura|jost|century gothic|josefin/.test(f)) return pick('Jost', `${family} is a licensed typeface; Jost is the closest free geometric sans`);
  if (/madefor|helvetica|neue|arial|segoe|sf pro|system|ui-sans|din|akzidenz|univers|frutiger|myriad|calibri|verdana|tahoma|trebuchet/.test(f)) return pick('Inter', `${family} is a system or licensed sans; Inter is the closest free neutral sans`);
  return pick(role === 'heading' ? 'Inter' : 'Nunito Sans', `${family} is a custom typeface that can't be loaded from another site; a free sans is used for every ${role} on the page`);
}

function readFont(map: Record<string, { w: number; ex: string[] }>): FontReading | undefined {
  const top = Object.entries(map).filter(([k]) => !/^(Arial|Helvetica|Times|serif|sans-serif)\|/.test(k)).sort((a, b) => b[1].w - a[1].w)[0] ?? Object.entries(map).sort((a, b) => b[1].w - a[1].w)[0];
  if (!top) return undefined;
  const [family, kind] = top[0].split('|');
  return { family: family.replace(/^(wf_|wfont_)[\w-]*$/i, 'custom web font'), kind: kind === 'sans' ? 'sans' : kind === 'serif' ? 'serif' : kind === 'mono' ? 'mono' : 'unknown', evidence: `${top[1].ex[0] ?? 'page text'} (${top[1].w} characters)` };
}

/**
 * Roles from use: the primary colour carries large panels, the header and headings; the secondary is what buttons are
 * filled with. Colours that are black, white or grey are backgrounds and text, not brand colours. The logo's colours
 * back up what the page shows; they never replace it.
 */
export function buildBrandProfile(raw: RawBrand | undefined, opts: { logoColors?: string[]; logoUrl?: string; sourceUrl?: string; cssColors?: { hex: string; count: number }[] } = {}): BrandProfile {
  const notes: string[] = [];
  const logoColors = (opts.logoColors ?? []).map(hexOf).filter((h) => !isNeutral(h));
  const profile: BrandProfile = { method: 'none', sourceUrl: opts.sourceUrl, backgrounds: [], text: [], notes, logo: opts.logoColors?.length ? { colors: opts.logoColors.map(hexOf), url: opts.logoUrl } : undefined };

  if (!raw || !raw.elements) {
    // no browser reading: the page's stylesheet colours (named brand/primary variables count most), then the logo
    const css = (opts.cssColors ?? []).map((c) => ({ hex: hexOf(c.hex), w: c.count })).filter((c) => !isNeutral(c.hex)).slice(0, 6);
    if (css.length) {
      profile.method = 'css';
      profile.primary = { hex: css[0].hex, role: 'primary', confidence: 'low', evidence: [{ where: 'stylesheet', detail: `most used chromatic colour (${css[0].w} uses)` }] };
      const second = css.find((c) => !near(c.hex, css[0].hex));
      if (second) profile.secondary = { hex: second.hex, role: 'secondary', confidence: 'low', evidence: [{ where: 'stylesheet', detail: `next chromatic colour (${second.w} uses)` }] };
      notes.push('The page was not measured in a browser: colours come from its stylesheets and are low confidence.');
    } else if (logoColors.length) {
      profile.method = 'logo';
      profile.primary = { hex: logoColors[0], role: 'primary', confidence: 'low', evidence: [{ where: 'logo', detail: 'dominant colour of the logo' }] };
      notes.push('No page colours could be read; only the logo was used, which is low confidence.');
    }
    return profile;
  }

  profile.method = 'rendered';
  const bgs = topEntries(raw.bg, 10);
  const headText = topEntries(raw.text.heading, 6);
  const bodyText = topEntries(raw.text.body, 6);
  const total = bgs.reduce((s, b) => s + b.w, 0) || 1;

  // candidate scores per chromatic colour
  const score: Record<string, { primary: number; accent: number; ev: Evidence[] }> = {};
  const touch = (hex: string) => (score[hexOf(hex)] ||= { primary: 0, accent: 0, ev: [] });
  for (const b of bgs) if (!isNeutral(b.hex)) { const s = touch(b.hex); s.primary += (b.w / total) * 6; s.ev.push({ where: b.ex[0] ?? 'background', detail: `background over ${Math.round((b.w / total) * 100)}% of coloured area` }); }
  const headTotal = headText.reduce((s, t) => s + t.w, 0) || 1;
  for (const t of headText) if (!isNeutral(t.hex)) { const s = touch(t.hex); s.primary += (t.w / headTotal) * 3; s.ev.push({ where: t.ex[0] ?? 'heading', detail: 'heading or large text colour' }); }
  if (raw.header && !isNeutral(raw.header.bg)) { const s = touch(raw.header.bg); s.primary += 3; s.ev.push({ where: raw.header.where, detail: 'header background' }); }
  if (raw.footer && !isNeutral(raw.footer.bg)) { const s = touch(raw.footer.bg); s.primary += 1; s.ev.push({ where: raw.footer.where, detail: 'footer background' }); }
  // buttons: the style that is used most (a call to action repeats)
  const btnKey = (b: RawBrand['buttons'][number]) => `${b.bg}|${b.text}|${Math.round(b.radius / 4)}`;
  const btnGroups = new Map<string, { n: number; b: RawBrand['buttons'][number]; labels: string[] }>();
  for (const b of raw.buttons) { if (isNeutral(b.bg) && lightness(b.bg) > 0.9) continue; const g = btnGroups.get(btnKey(b)) ?? { n: 0, b, labels: [] }; g.n++; g.labels.push(b.label); btnGroups.set(btnKey(b), g); }
  const btnRanked = [...btnGroups.values()].sort((a, b) => b.n - a.n);
  // a button needs a label that reads as an action or a visible fill; hamburger and close controls are not the brand's button
  const action = btnRanked.find((g) => !isNeutral(g.b.bg) && g.labels.some((l) => /book|schedule|call|contact|get|start|request|order|shop|buy|submit|visit|learn|appointment|quote|reserve/i.test(l))) ?? btnRanked.find((g) => !isNeutral(g.b.bg));
  if (action) {
    const s = touch(action.b.bg); s.accent += 4 + Math.min(action.n, 6) * 0.4; s.ev.push({ where: action.b.where, detail: `button fill (${action.n} buttons: ${[...new Set(action.labels)].slice(0, 3).join(', ')})` });
    const t = touch(action.b.text); if (!isNeutral(action.b.text)) t.primary += 1.5;
  }
  for (const lc of logoColors.slice(0, 3)) { const s = touch(lc); s.primary += 0.8; s.accent += 0.8; s.ev.push({ where: 'logo', detail: 'colour in the logo' }); }

  const ranked = Object.entries(score).map(([hex, v]) => ({ hex, ...v }));
  const byPrimary = [...ranked].sort((a, b) => b.primary - a.primary);
  const primary = byPrimary[0];
  const fill = action ? hexOf(action.b.bg) : undefined;
  const accent = fill && !isNeutral(fill) ? ranked.find((r) => r.hex === fill) : [...ranked].filter((r) => !primary || !near(r.hex, primary.hex)).sort((a, b) => b.accent - a.accent || b.primary - a.primary)[0];
  const conf = (r: { ev: Evidence[] } | undefined): Confidence => (!r ? 'low' : r.ev.length >= 3 || new Set(r.ev.map((e) => e.detail.split(' ')[0])).size >= 3 ? 'high' : r.ev.length >= 2 ? 'medium' : 'low');
  if (primary) profile.primary = { hex: primary.hex, role: 'primary', confidence: conf(primary), evidence: primary.ev.slice(0, 5) };
  if (accent && (!primary || !near(accent.hex, primary.hex))) profile.secondary = { hex: accent.hex, role: 'secondary', confidence: conf(accent), evidence: accent.ev.slice(0, 5) };
  else if (accent && primary) notes.push('Primary and secondary are the same colour on this page.');

  profile.backgrounds = bgs.slice(0, 4).map((b) => ({ hex: b.hex, role: isNeutral(b.hex) ? (lightness(b.hex) > 0.9 ? 'surface' : 'neutral') : 'panel', confidence: 'high' as Confidence, evidence: [{ where: b.ex[0] ?? 'background', detail: `${Math.round((b.w / total) * 100)}% of coloured area` }] }));
  profile.text = bodyText.slice(0, 6).map((t) => ({ hex: t.hex, role: 'body text', confidence: 'high' as Confidence, evidence: [{ where: t.ex[0] ?? 'text', detail: `${t.w} characters` }] }));
  const hc = headText.find((t) => primary && near(t.hex, primary.hex)) ?? headText.find((t) => !isNeutral(t.hex)) ?? headText[0];
  if (hc) profile.headingText = { hex: hc.hex, role: 'heading text', confidence: 'medium', evidence: [{ where: hc.ex[0] ?? 'heading', detail: `${hc.w} characters of large text` }] };
  if (action) {
    // every button filled this way, then the lettering a designer chose on purpose: the brand colour over a default black
    const same = raw.buttons.filter((b) => near(b.bg, action.b.bg));
    const lettered = same.find((b) => primary && near(b.text, primary.hex) && /book|schedule|call|contact|get|start|request|order|appointment|quote/i.test(b.label)) ?? same.find((b) => primary && near(b.text, primary.hex)) ?? action.b;
    profile.button = { fill: hexOf(action.b.bg), text: hexOf(lettered.text), radius: Math.round(lettered.radius), label: lettered.label, confidence: same.length >= 3 ? 'high' : 'medium', evidence: [{ where: action.b.where, detail: `${same.length} buttons filled this colour: ${[...new Set(same.map((b) => b.label))].slice(0, 4).join(', ')}` }, { where: lettered.where, detail: `lettering ${hexOf(lettered.text)}, corners ${Math.round(lettered.radius)}px ("${lettered.label}")` }] };
  }
  if (raw.header) profile.header = { background: hexOf(raw.header.bg), where: raw.header.where };
  if (raw.footer) profile.footer = { background: hexOf(raw.footer.bg), where: raw.footer.where };

  const h = readFont(raw.fonts.heading), b = readFont(raw.fonts.body);
  if (h || b) {
    profile.typography = { heading: h, body: b, substitution: {} };
    // one explicit substitution per role, applied everywhere on the page
    for (const [role, f] of [['heading', h], ['body', b]] as const) if (f && f.kind !== 'mono') profile.typography.substitution![role] = substituteFont(f.family === 'custom web font' ? 'custom typeface' : f.family, f.kind === 'serif' ? 'serif' : 'sans', role);
  }
  if (primary && logoColors.length && !logoColors.some((l) => near(l, primary.hex)) && !(accent && logoColors.some((l) => near(l, accent.hex)))) notes.push('The logo\'s colours do not appear among the page\'s main colours; the page colours were used.');
  return profile;
}

/** Hex colours the profile asks the design to keep, for the "was the brand lost?" check. */
export const profileColors = (p: BrandProfile | undefined) => [p?.primary, p?.secondary].filter((c): c is BrandColor => !!c && c.confidence !== 'low').map((c) => c.hex);

// ───────────────────────── applying it ─────────────────────────
const pickInk = (bg: string, preferred: string[]): string => {
  for (const c of preferred) if (contrast(c, bg) >= 4.5) return c;
  return contrast('#FFFFFF', bg) >= contrast('#111111', bg) ? '#FFFFFF' : '#111111';
};

/**
 * CSS variables that put the business's own roles back: headings and bands in the primary colour, buttons filled with
 * the accent and lettered as the page does, white surfaces. Text colours are checked for contrast (4.5:1) and
 * adjusted only as far as needed; the changes are listed in `notes` so they are visible.
 */
export function brandCss(p: BrandProfile, opts: { sans?: boolean; logoColors?: string[] } = {}): { css: string; tokens: Record<string, string>; notes: string[]; fonts?: { heading: string; body: string; url: string } } {
  const notes: string[] = [];
  const t: Record<string, string> = {};
  const primary = p.primary && p.primary.confidence !== 'low' ? p.primary.hex : undefined;
  const secondary = p.secondary && p.secondary.confidence !== 'low' ? p.secondary.hex : undefined;
  if (!primary && !secondary) return { css: '', tokens: t, notes: ['No brand colours with enough confidence to apply.'] };
  const fill = p.button?.fill ?? secondary ?? primary!;
  let btnText = p.button?.text ?? pickInk(fill, [primary ?? '#111111']);
  if (contrast(btnText, fill) < 4.5) { const fixed = pickInk(fill, [primary ?? '#111111', '#111111', '#FFFFFF']); notes.push(`Button text ${btnText} on ${fill} is ${contrast(btnText, fill).toFixed(1)}:1; ${fixed} is used instead.`); btnText = fixed; }
  t['--brand'] = fill;
  t['--brand-ink'] = btnText;
  const headingBase = primary ?? p.headingText?.hex ?? '#111111';
  let heading = headingBase;
  if (contrast(heading, '#FFFFFF') < 4.5) { heading = pickInk('#FFFFFF', [headingBase, '#111111']); notes.push(`Heading colour ${headingBase} is ${contrast(headingBase, '#FFFFFF').toFixed(1)}:1 on white; ${heading} is used.`); }
  t['--heading'] = heading;
  t['--brand-text'] = heading;
  t['--band'] = primary && contrast('#FFFFFF', primary) >= 4.5 ? primary : '#14213D';
  if (t['--band'] !== primary && primary) notes.push(`The primary colour ${primary} is too light for white text, so bands use a dark navy.`);
  t['--surface'] = '#FFFFFF';
  t['--surface-alt'] = primary ? mix(primary, '#FFFFFF', 0.06) : '#F5F6F8';
  // body text: a dark neutral the page uses, else the primary deepened: long text stays easy to read
  const body = p.text.find((x) => isNeutral(x.hex) && contrast(x.hex, '#FFFFFF') >= 7)?.hex ?? (primary ? mix(primary, '#000000', 0.55) : '#1B2033');
  t['--ink'] = body;
  t['--ink-muted'] = mix(body, '#FFFFFF', 0.7);
  t['--radius-btn'] = `${Math.max(0, Math.min(999, p.button?.radius ?? 999))}px`;

  const sub = p.typography?.substitution;
  const sansFonts = !opts.sans && !sub ? undefined : sub;
  let fonts: { heading: string; body: string; url: string } | undefined;
  if (sansFonts && (sansFonts.heading || sansFonts.body)) {
    const hf = sansFonts.heading ?? sansFonts.body!, bf = sansFonts.body ?? sansFonts.heading!;
    const fam = (f: FontSubstitution) => `'${f.to}', ${f.kind === 'serif' ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"}`;
    const q = (f: FontSubstitution, w: string) => `family=${encodeURIComponent(f.to).replace(/%20/g, '+')}:wght@${w}`;
    const families = hf.to === bf.to ? [q(hf, '400;600;700')] : [q(hf, '500;600;700'), q(bf, '400;600')];
    fonts = { heading: fam(hf), body: fam(bf), url: `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` };
    t['--font-heading'] = fonts.heading;
    t['--font-body'] = fonts.body;
    t['--hw'] = '700';
    t['--h-track'] = '0';
    notes.push(...[sansFonts.heading, sansFonts.body].filter((x): x is FontSubstitution => !!x).map((x) => `Typeface: ${x.from} is shown as ${x.to} (${x.reason}).`));
  }
  // a logo drawn in a light colour (gold, white) is lost on a white header: the header takes the band colour, as it does on the site
  const logoCols = (opts.logoColors ?? p.logo?.colors ?? []).filter((c) => !isNeutral(c));
  const headerOnBand = logoCols.length > 0 && logoCols.every((c) => contrast(c, '#FFFFFF') < 3) && contrast(logoCols[0], t['--band']) >= 3;
  if (headerOnBand) notes.push(`The logo (${logoCols[0]}) is too light for a white header, so the header uses the brand colour ${t['--band']}, as the website does.`);
  const dark = ['.fw-foot', '.fw-strip', '.fb-head', '.fb-hero', '.fb-cta', '.fb-foot', '.fb-panel', '.fe-cta', '.fe-foot', '.f-urgent'].join(',');
  const css = `:root{${Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';')}}
body[data-family] main :is(h1,h2,h3){color:var(--heading)}
body[data-family] :is(${dark}) :is(h1,h2,h3,h4,p,li,span,a){color:inherit}
body[data-family] .btn{border-radius:var(--radius-btn)}
body[data-family] .btn-primary{background:var(--brand);color:var(--brand-ink)}
body[data-family] .btn-secondary{color:var(--heading);border-color:var(--heading)}
${headerOnBand
    ? `body[data-family] :is(.fw-head,.fe-head){background:var(--band)}
body[data-family] :is(.fw-nav,.fe-nav) a,body[data-family] :is(.fw-head,.fe-head) .f-menu summary{color:#fff}
body[data-family] :is(.fw-nav,.fe-nav) a:hover,body[data-family] :is(.fw-nav,.fe-nav) a[aria-current]{color:var(--brand)}
body[data-family] .fw-strip{background:var(--surface-alt);color:var(--ink)}
body[data-family] .fw-strip a{color:var(--heading)}`
    : `body[data-family] :is(.fw-head,.fe-head){background:var(--surface)}
body[data-family] .fw-strip{background:var(--band);color:#fff}
body[data-family] .fw-strip a{color:#fff}`}
body[data-family] .fw-foot{background:var(--band);color:#fff}
body[data-family] .fw-foot h2,body[data-family] .fw-foot a{color:#fff}`;
  return { css, tokens: t, notes, fonts };
}

/** Linear blend of two hex colours (amount of the first, 0..1). */
function mix(a: string, b: string, keep: number): string {
  const x = rgb(a), y = rgb(b);
  const c = (i: number) => Math.round(x[i] * keep + y[i] * (1 - keep)).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`.toUpperCase();
}

/** The most used non-neutral colours of an image (a logo): what the logo is drawn in. */
export async function dominantColors(file: string | Buffer, n = 3): Promise<string[]> {
  try {
    const { data, info } = await sharp(file).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 200) continue;
      const q = [data[i], data[i + 1], data[i + 2]].map((v) => Math.round(v / 24) * 24);
      const hex = toHex(q.map((v) => Math.min(255, v)) as [number, number, number]);
      if (isNeutral(hex)) continue;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    const out: string[] = [];
    for (const [hex] of [...counts.entries()].sort((a, b) => b[1] - a[1])) if (!out.some((o) => near(o, hex))) { out.push(hexOf(hex)); if (out.length >= n) break; }
    return out;
  } catch { return []; }
}
