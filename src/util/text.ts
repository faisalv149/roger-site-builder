export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
}

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'llc', 'inc']);
export function titleCase(s: string): string {
  // Keep words that are already mixed/upper case (acronyms like HVAC, LLC brand styling)
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (/[A-Z].*[A-Z]/.test(w) || /\d/.test(w)) return w;
      const lw = w.toLowerCase();
      if (i > 0 && SMALL.has(lw)) return lw === 'llc' || lw === 'inc' ? w : lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

/**
 * A complete excerpt of descriptive text: whole sentences only, never a cut word or a half sentence.
 *  - text that ends a sentence and fits `max` is returned whole;
 *  - longer text keeps its leading whole sentences up to `max` (the first sentence whole even when it alone is longer);
 *  - text that stops mid-sentence (as a source that was cut at a fixed length does: "…SQL-based pro") loses that
 *    unfinished sentence; with no complete sentence at all there is nothing safe to show, so it returns undefined.
 */
const SENTENCE_END = /[.!?…]["'”’)\]]?$/;
const LIKELY_CUT = 200;
export function completeExcerpt(s: string | undefined | null, max = Infinity): string | undefined {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  if (SENTENCE_END.test(clean) && clean.length <= max) return clean;
  // a short phrase without a full stop ("Chocolate cake with buttercream") is complete, not cut: sources were cut at
  // 220-240 characters, so only text that long and unfinished is treated as cut
  if (clean.length < LIKELY_CUT && clean.length <= max) return clean;
  // sentence ends: punctuation followed by a space and a capital, digit or quote, or the end ("2.5 hours", "e.g. the"
  // and ".NET" are not ends); what follows the last end is an unfinished sentence and is dropped
  const complete: string[] = [];
  let from = 0;
  for (const m of clean.matchAll(/[.!?…]+["'”’)\]]?(?=\s+["'“‘(]?[A-Z0-9]|$)/g)) {
    const end = m.index! + m[0].length;
    complete.push(clean.slice(from, end).trim());
    from = end;
  }
  if (!complete.length) return undefined;
  let out = '';
  for (const x of complete) {
    if (out && `${out} ${x}`.length > max) break;
    out = out ? `${out} ${x}` : x;
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Crawler debris: the names of icons and widgets a page's markup carries as text ("map marker pin", "chevron-right"),
 * which run into real words when a crawler joins text ("78704map marker pin"). Never content.
 */
const UI_WORDS = String.raw`map[- ]?marker(?:[- ]pin)?|marker[- ]pin|location[- ]pin|chevron[- ]?(?:right|left|up|down)|caret[- ]?(?:right|left|up|down)|arrow[- ]?(?:right|left|up|down|forward|back)|angle[- ]?(?:right|left|up|down)|hamburger(?:[- ]menu)?|close[- ]icon|search[- ]icon|phone[- ]icon|envelope[- ]icon|fa[- ][a-z]+(?:[- ][a-z]+)?|icon[- ][a-z]+|play[- ]button|external[- ]link[- ]icon`;
export const UI_DEBRIS = new RegExp(String.raw`(?:(?<=\d)|\b)(?:${UI_WORDS})\b`, 'gi');
export function stripUiDebris(s: string): string {
  return s.replace(UI_DEBRIS, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * A seasonal or time-limited promotion with no year ("Pre-order Thanksgiving Favorites for 11/24 and 11/25"): a crawl
 * keeps it after the date has passed, so it may not lead a page. Returns what makes it seasonal, or undefined. A text
 * with an explicit year (2026) is dated, and can be checked against today by whoever shows it.
 */
const SEASONAL = /\b(thanksgiving|christmas|xmas|holiday(?:s)?|halloween|valentine(?:'s|s)?|easter|mother'?s day|father'?s day|new year'?s?|hanukkah|black friday|cyber monday|fourth of july|july 4th|labor day|memorial day|st\.? patrick'?s|back[- ]to[- ]school|pre-?orders?|limited[- ]time|this (?:week|weekend|month)|all month|seasonal|while supplies last)\b/i;
const DAY_NO_YEAR = /\b(?:\d{1,2}\/\d{1,2}(?!\/\d)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?(?!,? ?\d{4}))\b/i;
export function undatedSeasonal(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  if (/\b20\d{2}\b/.test(s)) return undefined;
  const m = s.match(SEASONAL) ?? s.match(DAY_NO_YEAR);
  return m ? m[0] : undefined;
}

/** Truncate at a word boundary and add an ellipsis. */
export function truncateWords(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,.;:!\-–—\s]+$/, '')}…`;
}

export function digits(s: string | undefined): string {
  return (s || '').replace(/\D/g, '');
}

/** Fill only the placeholders the theme declares. Unknown/empty tokens are reported, not silently left in. */
export function fillPlaceholders(tpl: string, values: Record<string, string | number | undefined>, allowed: string[]): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl.replace(/\{(\w+)\}/g, (m, key) => {
    if (!allowed.includes(m)) return m;
    const v = values[key];
    if (v === undefined || v === null || v === '') {
      missing.push(key);
      return m;
    }
    return String(v);
  });
  return { text, missing };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Undated seasonal promotions out of a built page: a paragraph, list item or sub-heading (h2–h4) whose text is one is
 * removed, and recorded. The page's structure and everything lasting stay.
 */
export function stripSeasonalHtml(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  const out = html.replace(/<(p|li|h2|h3|h4)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (whole, _tag, _attrs, inner: string) => {
    if (/<(p|li|h[1-6]|ul|ol|section|div)\b/i.test(inner)) return whole; // only leaf blocks
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
    const season = undatedSeasonal(text);
    if (!season) return whole;
    removed.push(text.slice(0, 120));
    return '';
  });
  return { html: out, removed };
}

/**
 * Crawler debris out of a built page: a link, button or list item whose whole text is debris (a "map marker pin"
 * button) is removed; debris inside other text ("…78704map marker pin") loses just those words. An icon-only control
 * (no text at all) is never touched, and attributes, scripts and styles are left alone.
 */
export function stripDebrisHtml(html: string): { html: string; removed: number } {
  let removed = 0;
  const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  let out = html.replace(/<(a|button|li)\b[^>]*>((?:(?!<\/?(?:a|button|li)\b)[\s\S])*?)<\/\1>/g, (all, _tag: string, inner: string) => {
    const t = textOf(inner);
    if (!t || t.replace(new RegExp(UI_DEBRIS.source, 'gi'), '').trim()) return all;
    removed++;
    return '';
  });
  out = out.replace(/(<(script|style)\b[\s\S]*?<\/\2>)|>([^<]+)</g, (all, block: string | undefined, _t: string, text: string | undefined) => {
    if (block || text === undefined) return all;
    const clean = text.replace(new RegExp(UI_DEBRIS.source, 'gi'), () => { removed++; return ''; });
    return clean === text ? all : `>${clean.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1')}<`;
  });
  return { html: removed ? out : html, removed };
}
