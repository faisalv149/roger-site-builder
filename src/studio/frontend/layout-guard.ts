/**
 * Layout guards the compiler applies from pipeline revision 4, whatever the design (business-agnostic):
 *
 *   PAGE_CLIP     every top-level part of the page clips what pokes out sideways (overflow-x: clip, which does not make
 *                 a scroll box, so sticky headers and vertical overhangs still work): a decoration wider than the window,
 *                 such as a rotated rule or a bleed shape, can no longer make the page scroll sideways. Zero specificity:
 *                 the design's own overflow rules win, and the rendered review still checks what a page shows.
 *   photo strips  a rule that scrolls a box sideways (overflow auto/scroll), where that box holds Google listing photos,
 *                 shows one photo, cuts the next one (and its credit) at the box edge and hides the rest until swiped.
 *                 Such a rule is rewritten in place (same selector, same media query, so the design's other rules and
 *                 specificity are untouched) to a wrapping layout: every photo and credit in view, the cards keep their
 *                 own shape, size ratio and styling.
 */
import type { CheerioAPI } from 'cheerio';

export const PAGE_CLIP = ':where(body>*){overflow-x:clip}';

interface StyleRule { selector: string; bodyStart: number; bodyEnd: number }

/** the style rules of a stylesheet at any @media/@supports/@container/@layer depth, with where each body sits */
export function styleRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
  let i = 0, preludeStart = 0;
  const skipString = (q: string) => { i++; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; } };
  const matching = (open: number) => { // the index of the brace that closes the block opened at `open`
    let depth = 0;
    for (let k = open; k < css.length; k++) {
      const ch = css[k];
      if (ch === '/' && css[k + 1] === '*') { const e = css.indexOf('*/', k + 2); k = e < 0 ? css.length : e + 1; continue; }
      if (ch === '"' || ch === "'") { const q = ch; k++; while (k < css.length && css[k] !== q) { if (css[k] === '\\') k++; k++; } continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return k;
    }
    return css.length;
  };
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 2; continue; }
    if (ch === '"' || ch === "'") { skipString(ch); i++; continue; }
    if (ch === ';' || ch === '}') { i++; preludeStart = i; continue; }
    if (ch === '{') {
      const prelude = css.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/^@(media|supports|container|layer|document)\b/i.test(prelude)) { i++; preludeStart = i; continue; } // its rules are read in turn
      const end = matching(i);
      // a style rule (not @font-face, @keyframes, @page…); a body with nested rules (CSS nesting) is left as written
      if (prelude && !prelude.startsWith('@') && !css.slice(i + 1, end).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').includes('{')) rules.push({ selector: prelude, bodyStart: i + 1, bodyEnd: end });
      i = end + 1; preludeStart = i;
      continue;
    }
    i++;
  }
  return rules;
}

/** split on a separator outside parentheses and strings */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', from = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (quote) { if (ch === '\\') k++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) { out.push(s.slice(from, k)); from = k + 1; }
  }
  out.push(s.slice(from));
  return out;
}

const SCROLLS = /^(auto|scroll)$/i;
/** does this declaration list scroll its box sideways? (overflow-x/overflow-inline, or the overflow shorthand's first value) */
function scrollsSideways(decls: { prop: string; value: string }[]): boolean {
  let x = '';
  for (const d of decls) {
    const v = d.value.replace(/!important/i, '').trim();
    if (d.prop === 'overflow') x = v.split(/\s+/)[0];
    else if (d.prop === 'overflow-x' || d.prop === 'overflow-inline') x = v;
  }
  return SCROLLS.test(x);
}

/** the elements a selector matches in the page (state pseudo-classes and pseudo-elements set aside); none if it can't be read */
function matches($: CheerioAPI, selector: string) {
  const plain = selector.replace(/::?(before|after|marker|placeholder|selection|first-line|first-letter|backdrop|-webkit-[a-z-]+)\b/gi, '')
    .replace(/:(hover|focus|focus-visible|focus-within|active|visited|link|target)\b/gi, '').trim();
  if (!plain) return [];
  try { return $(plain).toArray(); } catch { return []; }
}

export interface StripFix { selector: string; was: string }
/**
 * Photo strips in a stylesheet (see the file comment), rewritten. `holdsListingPhoto` says whether an element (in the
 * page as written, before photos are wrapped) contains a Google listing photo.
 */
export function unstripPhotos(css: string, $: CheerioAPI, holdsListingPhoto: (el: unknown) => boolean, opts: { strips?: Set<unknown> } = {}): { css: string; fixed: StripFix[]; strips: Set<unknown> } {
  const fixed: StripFix[] = [];
  const rules = styleRules(css).map((r) => {
    const body = css.slice(r.bodyStart, r.bodyEnd);
    const decls = splitTop(body, ';').map((d) => { const k = d.indexOf(':'); return k < 0 ? { prop: '', value: '', raw: d } : { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim(), raw: d }; });
    return { ...r, body, decls, els: splitTop(r.selector, ',').flatMap((sel) => matches($, sel)) };
  });
  // 1. the strips: boxes that scroll sideways and hold a Google listing photo (also those found in another stylesheet
  //    of the same page, such as the homepage CSS for an inner page)
  const strips = new Set<unknown>(opts.strips ?? []);
  for (const r of rules) if (scrollsSideways(r.decls)) for (const el of r.els) if (holdsListingPhoto(el)) strips.add(el);
  // 2. every rule that lays a strip out sideways (its scrolling, its column flow or its unwrapped row), rewritten
  let out = '', last = 0;
  for (const r of rules) {
    const { body, decls } = r;
    if (!r.els.some((el) => strips.has(el))) continue;
    const columnFlow = decls.some((d) => d.prop === 'grid-auto-flow' && /column/i.test(d.value));
    // (a flex row is a single line unless it says it wraps)
    const flexRow = decls.some((d) => d.prop === 'display' && /flex/i.test(d.value)) && !decls.some((d) => (d.prop === 'flex-direction' || d.prop === 'flex-flow') && /column/i.test(d.value));
    const sideways = scrollsSideways(decls) || columnFlow || flexRow || decls.some((d) => d.prop === 'grid-auto-columns' || (d.prop === 'flex-wrap' && /nowrap/i.test(d.value)) || (d.prop === 'white-space' && /nowrap/i.test(d.value)));
    if (!sideways) continue;
    const kept = decls.filter((d) => d.raw.trim()).flatMap((d) => {
      switch (d.prop) {
        case 'overflow': case 'overflow-x': case 'overflow-inline': return [`${d.prop}:visible`];
        case 'scroll-snap-type': return [];
        case 'grid-auto-flow': return [`grid-auto-flow:${d.value.replace(/column/i, 'row')}`];
        case 'grid-auto-columns': return [];
        case 'grid-template-columns': return columnFlow ? [] : [d.raw.trim()];
        case 'flex-wrap': return ['flex-wrap:wrap'];
        case 'flex-flow': return [`flex-flow:${d.value.replace(/\bnowrap\b/i, 'wrap')}${/\bwrap\b/i.test(d.value) ? '' : ' wrap'}`];
        case 'white-space': return /nowrap/i.test(d.value) ? ['white-space:normal'] : [d.raw.trim()];
        default: return [d.raw.trim()];
      }
    });
    // a sideways grid becomes a wrapping grid of cards; a sideways flex row wraps
    if (columnFlow) kept.push('grid-template-columns:repeat(auto-fill,minmax(min(100%,9.5rem),1fr))');
    if (decls.some((d) => d.prop === 'display' && /flex/i.test(d.value)) && !decls.some((d) => d.prop === 'flex-wrap' || d.prop === 'flex-flow')) kept.push('flex-wrap:wrap');
    fixed.push({ selector: r.selector.trim(), was: body.trim() });
    out += css.slice(last, r.bodyStart) + kept.join(';');
    last = r.bodyEnd;
  }
  return { css: out + css.slice(last), fixed, strips };
}
