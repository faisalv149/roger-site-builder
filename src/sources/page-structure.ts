import * as cheerio from 'cheerio';
import { largestFromSrcset } from './site-content.js';
import { completeExcerpt } from '../util/text.js';
import type { AnyNode, Element } from 'domhandler';

/**
 * Page structure beyond a labelled list: services shown as repeated cards (with the photo that sits in each card),
 * the navigation's service hierarchy, the hero (its headline, its calls to action and picture), the places a
 * business says it serves, testimonials with their names, and the claims it makes about itself. Everything is read
 * from the page's own markup and keeps where it was found; nothing is inferred from the business's category.
 */
type $ = cheerio.CheerioAPI;
type Cheer = cheerio.Cheerio<AnyNode>;

const clean = (s: string | undefined) => (s || '').replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
/** text with a space where tags end, so "Roofing for<br>Storm Damage" reads as words */
export const spacedText = ($: $, el: Cheer) => clean(cheerio.load(`<div>${($.html(el) || '').replace(/<\/?(?:br|p|div|li|h[1-6]|span|strong|b|em|i|a|button|section|small)\b[^>]*>/gi, ' $& ')}</div>`)('div').text());

const CHROME = 'nav, header, footer, [role=navigation], form';
const PERSON = /^[A-Z][a-z]+(?:\s[A-Z]\.?)?\s[A-Z][a-z]+$/;
const DECOR = /shape|icon|sprite|counter|pattern|decor|bullet|arrow|quote|badge|logo|bg[-_]|background|placeholder|spinner|avatar|star|check|\bimg\b$/i;
const SERVICE_WORDS = /\b(repair|replacement|install|installation|inspection|damage|restoration|mitigation|claim|service|removal|cleaning|treatment|therapy|maintenance|remodel|construction|design|consult|paint|plumb|electric|hvac|roof|gutter|siding|window|door|floor|landscap)/i;
const NOT_A_PERSON = /quality|workmanship|experts?|attention|customer|approach|materials|inspection|service|team|care|solutions|experience|detail|trusted|local|family|craftsmanship|products?|premium|professional/i;
const NOT_SERVICE_CARD = /^(?:home|menu|search|contact|about|read more|learn more|get a|call|book|quick links|our services|follow|subscribe|newsletter|why|what|who|how)\b/i;

// ───────────────────────── services as cards ─────────────────────────
export interface CardService {
  name: string;
  description?: string;
  /** where the card goes: another page, an anchor on this page, or a phone number */
  href?: string;
  /** a photograph that sits in the card (decoration and icons are not pictures of the service) */
  image?: { url: string; seen: string; alt?: string };
  /** the card's place on the page: its container's tag and first class, and the heading's text */
  locator: string;
}

function isDecor(src: string, alt: string | undefined, w?: number): boolean {
  if (!src || /^data:/.test(src)) return true;
  if (/\.svg(\?|$)/i.test(src)) return true;
  if (DECOR.test(src.split('/').pop() || '') || (alt !== undefined && /^(icon|img|image|logo|shape)$/i.test(clean(alt)))) return true;
  if (/themeholy\.com|\/plugins\/|\/themes\//i.test(src)) return true;
  if (w && w < 80) return true;
  return false;
}

/** The photograph in a card: the first real raster picture in the card's block, looking a few levels up. */
function cardPhoto($: $, container: Element, others: Element[], base: string): CardService['image'] {
  let box = $(container);
  for (let up = 0; up < 4 && box.length; up++, box = box.parent()) {
    const node = box.get(0) as Element;
    if (up > 0 && others.some((o) => o !== container && $.contains(node, o))) return undefined; // the block holds another card
    for (const im of box.find('img').toArray()) {
      // the biggest version the page offers (its srcset), then the lazy-load address, then the plain src
      const src = largestFromSrcset($(im).attr('srcset') || $(im).attr('data-srcset')) || $(im).attr('data-src') || $(im).attr('data-lazy-src') || $(im).attr('data-orig-src') || $(im).attr('src') || '';
      if (isDecor(src, $(im).attr('alt'), Number($(im).attr('width')) || undefined)) continue;
      try { const seen = new URL(src, base).toString(); return { url: seen, seen, alt: $(im).attr('alt') }; } catch { /* next */ }
    }
    const bg = box.find('[style*="background-image"]').first().attr('style')?.match(/url\((['"]?)([^)'"]+)\1\)/)?.[2];
    if (bg && !isDecor(bg, undefined)) { try { const seen = new URL(bg, base).toString(); return { url: seen, seen }; } catch { /* none */ } }
  }
  return undefined;
}

/**
 * Repeated blocks of "name, a sentence, a link" are how many sites show what they offer. The cluster that looks most
 * like services (links to other pages, service-like names, descriptions) wins; people's names (testimonials) and
 * feature lists (no links) lose. Returns [] when nothing fits.
 */
export function cardServices($: $, base: string): CardService[] {
  const heads = $('h2, h3, h4').filter((_, h) => {
    if ($(h).closest(CHROME).length) return false;
    const t = clean($(h).text());
    return t.length >= 4 && t.length <= 48 && !NOT_SERVICE_CARD.test(t) && !/^\d/.test(t);
  }).toArray() as Element[];
  // each heading's card: the nearest ancestor with a link and some text that holds no other heading of the same level
  type Card = { h: Element; box: Element; text: string; link?: string; sig: string };
  const cards: Card[] = [];
  for (const h of heads) {
    let box = $(h).parent();
    for (let up = 0; up < 5 && box.length; up++, box = box.parent()) {
      const node = box.get(0) as Element;
      const sameLevel = heads.filter((o) => o.tagName === h.tagName && $.contains(node, o));
      if (sameLevel.length > 1) break;
      const text = clean(box.text()).replace(clean($(h).text()), '').trim();
      const link = box.find('a[href]').filter((_, a) => !/^(tel|mailto):/.test($(a).attr('href') || '')).first().attr('href');
      if (text.length >= 20 && (link || up >= 1)) { cards.push({ h, box: node, text, link, sig: `${h.tagName}|${node.tagName}.${String((node.attribs?.class || '').split(/\s+/)[0]).slice(0, 24)}` }); break; }
    }
  }
  const bySig = new Map<string, Card[]>();
  for (const c of cards) bySig.set(c.sig, [...(bySig.get(c.sig) ?? []), c]);
  let best: { cards: Card[]; score: number } | undefined;
  for (const group of bySig.values()) {
    if (group.length < 3 || group.length > 14) continue;
    const names = group.map((c) => clean($(c.h).text()));
    if (names.filter((n) => PERSON.test(n) && !SERVICE_WORDS.test(n)).length > names.length / 2) continue; // testimonials
    const linked = group.filter((c) => c.link && !/^#?$/.test(c.link)).length / group.length;
    const serviceLike = names.filter((n) => SERVICE_WORDS.test(n)).length / names.length;
    const described = group.filter((c) => c.text.length >= 25 && c.text.length <= 260).length / group.length;
    const score = group.length * (0.3 + linked) * (0.3 + serviceLike) * (0.4 + described);
    if (!best || score > best.score) best = { cards: group, score };
  }
  if (!best || best.score < 1.2) return [];
  const others = best.cards.map((c) => c.h);
  return best.cards.map((c) => {
    const name = clean($(c.h).text());
    // the card's sentence is its text without the link labels ("Read More")
    const linkLabels = $(c.box).find('a').map((_, a) => clean($(a).text())).get();
    let desc = c.text; for (const l of linkLabels) if (l) desc = desc.split(l).join(' ');
    desc = clean(desc.replace(/\bRead More\b|\bLearn More\b|\bView More\b/gi, ' '));
    let href: string | undefined;
    if (c.link) { try { href = new URL(c.link, base).toString(); } catch { /* none */ } }
    return { name, description: desc.length >= 12 ? completeExcerpt(desc, 400) : undefined, href, image: cardPhoto($, c.h, others, base), locator: `${(c.box.tagName)}.${String((c.box.attribs?.class || '').split(/\s+/)[0]).slice(0, 24)} > ${c.h.tagName.toLowerCase()} "${name}"` };
  });
}

// ───────────────────────── navigation ─────────────────────────
export interface NavItem { name: string; href: string; parent?: string }
/** Menu links with their parent in the menu: "Roofing Services" over "Roof Replacement", "Roof Repair". */
export function navMenu($: $, base: string): NavItem[] {
  const out: NavItem[] = [];
  const abs = (h: string) => { try { return new URL(h, base).toString(); } catch { return ''; } };
  $('nav li, header li').each((_, li) => {
    const own = $(li).children('a').first();
    const name = clean(own.text());
    const href = abs(own.attr('href') || '');
    if (!name || !href || name.length > 40) return;
    const parentLi = $(li).parent().closest('li');
    const parent = parentLi.length ? clean(parentLi.children('a').first().text()) : undefined;
    out.push({ name, href, parent: parent || undefined });
  });
  if (!out.length) $('header a[href], nav a[href]').each((_, a) => { const name = clean($(a).text()); const href = abs($(a).attr('href') || ''); if (name && href && name.length <= 40 && !/^(tel|mailto):/i.test($(a).attr('href') || '')) out.push({ name, href }); });
  const seen = new Set<string>();
  return out.filter((i) => { const k = `${i.name.toLowerCase()}|${i.parent ?? ''}|${i.href}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ───────────────────────── hero ─────────────────────────
export interface HeroCta { label: string; href: string; kind: 'phone' | 'form' | 'page' | 'external' | 'anchor'; terms?: 'free' }
export interface SourceHero {
  headline: string;
  subline?: string;
  primary?: HeroCta;
  secondary?: HeroCta;
  image?: { url: string; seen: string; alt?: string; origin: 'img' | 'css' };
}

const sentenceCase = (s: string) => { const t = clean(s); return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

/** The first H1's block: its headline, the buttons beside it (primary first), and the picture behind or beside it. */
export function heroOf($: $, base: string): SourceHero | undefined {
  const h1 = $('h1').filter((_, e) => !$(e).closest('nav, footer').length).first();
  if (!h1.length) return undefined;
  const headline = spacedText($, h1).replace(/\s+([,.])/g, '$1').replace(/(\w)&/g, '$1 &').replace(/&(?=\S)/g, '& ').replace(/\s{2,}/g, ' ');
  let box = h1.parent();
  for (let up = 0; up < 6 && box.length; up++, box = box.parent()) {
    const node = box.get(0) as Element;
    if ($(node).find('h2').length > 1 || node.tagName === 'body') break;
    if ($(node).find('a[href]').length >= 2 || up >= 3) break;
  }
  const abs = (h: string) => { try { return new URL(h, base).toString(); } catch { return ''; } };
  const ctas: HeroCta[] = [];
  box.find('a[href]').each((_, a) => {
    const raw = $(a).attr('href') || '';
    const label = sentenceCase(spacedText($, $(a)));
    if (!label || label.length > 48 || /^(home|menu)$/i.test(label)) return;
    const cls = String($(a).attr('class') || '');
    if (!/btn|button|cta/i.test(cls) && label.length > 32) return;
    const href = raw.startsWith('#') ? raw : abs(raw);
    if (!href) return;
    const kind: HeroCta['kind'] = /^tel:/i.test(raw) ? 'phone' : /^#|wpcf7|\/#/.test(raw) || (href.split('#')[0] === base.split('#')[0] && href.includes('#')) ? (/form|wpcf7|book|quote|estimate|contact|inspection/i.test(raw + label) ? 'form' : 'anchor') : new URL(href, base).origin === new URL(base).origin ? 'page' : 'external';
    if (!ctas.some((c) => c.label === label)) ctas.push({ label, href, kind, terms: /\bfree\b/i.test(label) ? 'free' : undefined });
  });
  const sub = box.find('p').filter((_, p) => clean($(p).text()).length >= 30).first();
  // the picture: an <img> in the block, or a background on the block or its ancestors
  let image: SourceHero['image'];
  const im = box.find('img').filter((_, i) => !isDecor($(i).attr('src') || '', $(i).attr('alt'), Number($(i).attr('width')) || undefined)).first();
  if (im.length) { const src = largestFromSrcset($(im).attr('srcset') || $(im).attr('data-srcset')) || $(im).attr('data-src') || $(im).attr('src') || ''; try { const seen = new URL(src, base).toString(); image = { url: seen, seen, alt: $(im).attr('alt'), origin: 'img' }; } catch { /* none */ } }
  if (!image) {
    let a = h1; for (let up = 0; up < 8 && a.length && !image; up++, a = a.parent()) {
      const u = (a.attr('style') || '').match(/url\((['"]?)([^)'"]+)\1\)/)?.[2];
      if (u && !isDecor(u, undefined)) { try { const seen = new URL(u, base).toString(); image = { url: seen, seen, origin: 'css' }; } catch { /* none */ } }
    }
  }
  return { headline, subline: sub.length ? clean(sub.text()).slice(0, 220) : undefined, primary: ctas[0], secondary: ctas[1], image };
}

// ───────────────────────── areas, testimonials, claims ─────────────────────────
export interface ServiceAreas { region?: string; places: string[]; sources: string[] }
export function areasOf(ld: any[], text: string): ServiceAreas | undefined {
  const places: string[] = [];
  const sources: string[] = [];
  for (const n of ld) {
    for (const a of [].concat(n.areaServed || [])) { const name = typeof a === 'string' ? a : (a as any)?.name; if (typeof name === 'string') { const parts = name.split(/,|\||;/).map(clean).filter(Boolean); places.push(...parts); } }
    if (n.areaServed) sources.push('json-ld areaServed');
  }
  const m = text.match(/\bServing\s+([A-Z][A-Za-z ]{3,40}?)\s*[:\-–]\s*((?:[A-Z][A-Za-z. ]{2,24}\s*[|•·,]\s*){2,}[A-Z][A-Za-z. ]{2,24})/);
  let region: string | undefined;
  if (m) { region = clean(m[1]); places.push(...m[2].split(/[|•·,]/).map(clean).filter(Boolean)); sources.push('"Serving …" line'); }
  const uniq = [...new Set(places.filter((p) => p.length >= 3 && p.length <= 30 && !/^(texas|tx|usa|united states)$/i.test(p)))];
  return uniq.length || region ? { region, places: uniq.slice(0, 24), sources: [...new Set(sources)] } : undefined;
}

export interface Testimonial { author: string; text: string; locator: string }
/** "What clients say": a person's name (a short heading) and the words beside it, as the page shows them. */
export function testimonialsOf($: $): Testimonial[] {
  const out: Testimonial[] = [];
  $('h3, h4, h5, strong, .name, [class*="author"], [class*="name"]').each((_, e) => {
    if ($(e).closest(CHROME).length) return;
    const name = clean($(e).text());
    if (!PERSON.test(name) || SERVICE_WORDS.test(name) || NOT_A_PERSON.test(name)) return;
    let around = $(e); let aboutClients = false;
    for (let up = 0; up < 9 && around.length && !aboutClients; up++, around = around.parent()) aboutClients = around.find('h1,h2,h3,h4,span,p').filter((_, x) => /what .{0,24}say|testimonial|reviews?\b|clients say|customers say|patients say/i.test(clean($(x).text())) && clean($(x).text()).length < 60).length > 0;
    if (!aboutClients) return;
    let box = $(e).parent();
    for (let up = 0; up < 4 && box.length; up++, box = box.parent()) {
      const body = clean(box.find('p, blockquote, [class*="text"], [class*="desc"]').map((_, p) => clean($(p).text())).get().filter((t) => t.length >= 40 && !t.includes(name)).sort((a, b) => b.length - a.length)[0] || '');
      if (body) { out.push({ author: name, text: body.slice(0, 700), locator: `${(box.get(0) as Element).tagName}.${String((box.get(0) as Element).attribs?.class || '').split(/\s+/)[0].slice(0, 24)} > "${name}"` }); break; }
    }
  });
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t.author) ? false : (seen.add(t.author), true))).slice(0, 8);
}

export interface SourceClaim { key: 'warranty' | 'licensed' | 'insured' | 'experience' | 'ownership' | 'guarantee'; text: string; locator: string }
const CLAIM_RULES: [SourceClaim['key'], RegExp][] = [
  ['warranty', /warrant(?:y|ies)/i], ['guarantee', /guarantee/i], ['licensed', /\blicensed\b/i], ['insured', /\binsured\b/i],
  ['ownership', /(?:family|locally|veteran|woman|minority)[ -]?(?:&|and)?\s*(?:family[ -])?owned/i], ['experience', /\b\d{1,2}\+?\s+years\b/i],
];
/** Claims the business makes about itself, with the words it uses (a heading or short line), not our paraphrase. */
export function claimsOf($: $): SourceClaim[] {
  const out: SourceClaim[] = [];
  $('h1,h2,h3,h4,li,strong').each((_, e) => {
    if ($(e).closest('nav, footer script').length) return;
    const t = clean($(e).text());
    if (t.length < 6 || t.length > 90) return;
    for (const [key, re] of CLAIM_RULES) if (re.test(t) && !out.some((c) => c.key === key)) out.push({ key, text: t, locator: `${(e as Element).tagName.toLowerCase()} "${t.slice(0, 40)}"` });
  });
  return out;
}
