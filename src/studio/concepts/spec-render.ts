import { writeStoredFile } from '../../google-names.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { browserGone, launchBrowser } from '../../render/og.js';
import type { Concept, ComposedSection, SectionKind } from './types.js';
import { MEASURE_SCRIPT, setDir, singleProcessChrome, type PageMetrics, type Rendered } from './render.js';
import type { Catalog } from './review.js';
import { LABEL_ONLY, REVIEW_ATTRIBUTION } from './labels.js';
import { decorativeFont } from './font-kind.js';
import { heroColumns, sectionColumns } from './geometry.js';
import { LISTING_CSS, isListing, parseListing, placeholderSrc } from './listing-photos.js';
import type { BusinessBrief } from '../schema.js';
import { brandColors, factValues, resolveColor, resolveText, textOn, visibleText, type DesignSpec, type FactKind, type ItemSpec, type Role, type SectionSpec, type TextRef } from './designspec.js';

/**
 * Renders a DesignSpec as one static homepage. This is an interpreter of layout primitives, not a set of templates:
 * every position comes from the spec's column ranges, every colour from its palette roles, every size from its type
 * scale, and every word from the catalog through the spec's text references. Sections share one generic renderer —
 * heading, intro, items, actions — arranged as the spec says.
 */

// what a line of the business's own text is (shared with the planner's selection): see labels.ts
export { LABEL_ONLY, REVIEW_ATTRIBUTION } from './labels.js';
/** the smallest size an item title in a decorative face is set at (a handwriting or script face has a small x-height) */
export const DECORATIVE_MIN_PX = 26;
/** the smallest sizes for menu and item text in any face: an item's name, and the line under it */
export const ITEM_TITLE_MIN_PX = 20;
export const ITEM_TEXT_MIN_PX = 16;
/** on desktop, the photos beside a heading in a stacked section stay this wide at most (4:3), not the full text column */
export const STACKED_PHOTO_MAX_PX = 520;
export { decorativeFont } from './font-kind.js';

/** an item's description long enough to fill a column on its own */
export const SUBSTANTIAL_ITEM_CHARS = 80;
/**
 * The arrangement a section is drawn with, decided by what actually renders in it. Side by side needs a second column
 * with something in it: two or more items, a photo mosaic, or one item with a substantial description. Buttons alone, or
 * a rating line alone, are too little: the section is stacked instead (heading, then its content), with the renderer's
 * stacked columns. `sec.items` are the ones that render (after the renderer's own cleaning).
 */
export function arrangedFor(sec: SectionSpec, cat: Catalog): SectionSpec['layout'] {
  const L = sec.layout;
  if (L.arrangement !== 'side-by-side') return L;
  const verified = (id: string) => cat.photos.some((p) => p.id === id);
  const mosaic = sec.media?.placement === 'mosaic' && sec.media.photoIds.some(verified);
  const one = sec.items.length === 1 ? `${visibleText(sec.items[0].title, cat) ?? ''} ${visibleText(sec.items[0].body, cat) ?? ''}`.trim() : '';
  const values = factValues(cat);
  const facts = (sec.facts ?? []).filter((k) => k !== 'rating' && values[k]);
  const enough = sec.items.length >= 2 || mosaic || one.length >= SUBSTANTIAL_ITEM_CHARS || facts.includes('hours') || facts.length >= 2;
  return enough ? L : { ...L, arrangement: 'stack', ...sectionColumns('stack') };
}

/**
 * A photo gallery's tiles, balanced: up to four photos in one row; more in rows of near-equal size (the shorter rows
 * first, so their larger tiles lead), each row the same height. On a phone, two columns, and an odd count opens with one
 * full-width tile, so no photo is left alone on the last row. Spans are on a 12-column grid.
 */
export function mosaicLayout(n: number): { span: number; ar: string; mSpan: number; mAr: string }[] {
  if (n <= 0) return [];
  const rowSizes = n <= 4 ? [n] : (() => { const rows = Math.ceil(n / 4), base = Math.floor(n / rows), extra = n % rows; return Array.from({ length: rows }, (_, i) => (i < rows - extra ? base : base + 1)); })();
  const widest = Math.max(...rowSizes);
  const ratio = (a: number, b: number) => { const g = (x: number, y: number): number => (y ? g(y, x % y) : x); const d = g(a, b); return `${a / d}/${b / d}`; };
  return rowSizes.flatMap((k) => Array.from({ length: k }, () => ({ span: 12 / k, ar: n <= 4 ? '1' : ratio(widest, k) }))).map((t, i) => ({ ...t, ...(n === 1 ? { mSpan: 2, mAr: '4/3' } : n % 2 && i === 0 ? { mSpan: 2, mAr: '2/1' } : { mSpan: 1, mAr: '1' }) }));
}

/** A sparse section (no photos, at most one item, little text) gets compact spacing whatever its planned density. */
export const SPARSE_TEXT_CHARS = 160;
export function isSparse(sec: SectionSpec, cat: Catalog): boolean {
  const verified = (id?: string | null) => !!id && cat.photos.some((p) => p.id === id);
  if (sec.items.some((it) => verified(it.photoId)) || (sec.media && sec.media.placement !== 'none' && sec.media.photoIds.some(verified))) return false;
  if (sec.items.length > 1) return false;
  const text = [sec.intro, ...sec.items.flatMap((it) => [it.title, it.body])].map((r) => visibleText(r, cat) ?? '').join(' ').trim();
  return text.length < SPARSE_TEXT_CHARS;
}

/** what kind of content a line is, for deciding whether it may stand alone */

export function contentKind(text: string):'review-attribution' | 'label' | 'name' {
  const t = text.trim();
  return REVIEW_ATTRIBUTION.test(t) ? 'review-attribution' : LABEL_ONLY.test(t) ? 'label' : 'name';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface SpecRenderOptions {
  /** where a photo is served from: a concept set serves its own copy (img/<id>.jpg); default its source address */
  photoSrc?: (id: string, url: string) => string;
  /** the full site's inner pages: in the menu after the sections; a section link with the same name goes to the page */
  pages?: { label: string; href: string }[];
  /** the DesignSpec id, stamped on the page so a saved copy of it can be checked */
  designId?: string;
}
/** the stylesheet address for a spec's fonts (the inner pages load the same) */
export function specFontHref(spec: DesignSpec): string {
  const fonts = [...new Set([spec.type.heading, spec.type.body, spec.type.mono].filter(Boolean) as string[])];
  return `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`).join('&')}&display=swap`;
}
export function renderSpec(spec: DesignSpec, cat: Catalog, brief: BusinessBrief, opts: SpecRenderOptions = {}): string {
  const src = (id: string, url: string) => (opts.photoSrc ? opts.photoSrc(id, url) : url);
  const brand = brandColors(brief);
  const c = (v: string) => resolveColor(v, brand) ?? '#000000';
  const P = { ground: c(spec.palette.ground), surface: c(spec.palette.surface), ink: c(spec.palette.ink), inverse: c(spec.palette.inverse), accent: c(spec.palette.accent), onAccent: c(spec.palette.onAccent) };
  const bg: Record<Role, string> = { ground: P.ground, surface: P.surface, inverse: P.inverse, accent: P.accent };
  const fg = (r: Role) => (r === 'accent' ? P.onAccent : textOn(bg[r], P.ink));
  const T = spec.type;
  const size = (step: number) => +(T.base * T.scale ** step).toFixed(2);
  // a decorative heading face (script, hand-lettering, marker…) reads small: item titles never go below a readable minimum
  const itemSize = (step: number) => Math.max(size(step), decorativeFont(T.heading) ? DECORATIVE_MIN_PX : ITEM_TITLE_MIN_PX);
  const t = (r: TextRef | null | undefined) => esc(visibleText(r, cat) ?? '');
  const photo = (id: string | null | undefined, cls = '') => {
    const p = id ? cat.photos.find((x) => x.id === id) : undefined;
    if (!p) return '';
    // a Google listing photo is never copied: a stand-in of its shape, with its credit slot in the same box (the photo and
    // its photographer's credit and Google Maps attribution are filled in when the page is served; preview only)
    const g = isListing(p) ? parseListing(p.url) : undefined;
    if (g) return `<span class="gph"><img class="${cls}" src="${esc(placeholderSrc(p.width, p.height))}" data-asset="${esc(p.id)}" alt="${esc(p.seen ?? p.alt ?? '')}" data-gphoto="${g.placeId}#${g.n}" data-gsize="${p.width}x${p.height}"${p.fp ? ` data-gfp="${p.fp}"` : ''}><span class="gcredit" data-gcredit="${g.placeId}#${g.n}"></span></span>`;
    return `<img class="${cls}" src="${esc(src(p.id, p.url))}" data-asset="${esc(p.id)}" alt="${esc(p.seen ?? p.alt ?? '')}">`; // eager, decoded before capture: a preview's full-page capture must show every photo
  };
  // verified facts, from the catalog's data (named by the spec's `facts`, never by a heading): a labelled list
  const values = factValues(cat);
  const FACT_LABEL: Record<FactKind, string> = { hours: 'Hours', address: 'Address', phone: 'Phone', rating: 'Google rating' };
  const factHtml = (k: FactKind) => (k === 'phone' && cat.phone ? `<a href="${esc(cat.phone.href)}">${esc(cat.phone.display)}</a>` : (values[k] ?? []).map(esc).join('<br>'));
  const factList = (kinds: FactKind[] = []) => { const rows = [...new Set(kinds)].filter((k) => values[k]).map((k) => `<div data-fact="${k}"><dt>${FACT_LABEL[k]}</dt><dd>${factHtml(k)}</dd></div>`); return rows.length ? `<dl class="facts">${rows.join('')}</dl>` : ''; };
  const action = (id: string, primary: boolean) => { const a = cat.actions.find((x) => x.id === id); return a ? `<a class="btn${primary ? ' btn-primary' : ''}" href="${esc(a.href)}" data-action="${esc(a.id)}">${esc(a.label)}</a>` : ''; };
  const actions = (ids: string[]) => (ids.length ? `<div class="actions">${ids.map((id, i) => action(id, i === 0)).join('')}</div>` : '');
  const col = (start: number, span: number) => `grid-column:${start} / span ${span}`;
  const logoOk = brief.brand.logo.status === 'verified' && cat.logo;
  const mark = logoOk ? `<img class="logo" src="${esc(cat.logo!.url)}" alt="${esc(cat.business.name)}">` : `<span class="wordmark">${esc(cat.business.name.replace(/,?\s+(LLC|Inc\.?|Ltd\.?)$/i, ''))}</span>`;
  // a nav link names what the section is (its kind), not a cut-off heading; a heading short enough is used as it is
  // (a kind name such as "Work", "Capabilities" or "Approach" says nothing about what the section shows: the heading does)
  const KIND_LABEL: Record<SectionSpec['kind'], string> = { services: 'Services', capabilities: '', work: '', principles: '', story: 'About', contact: 'Contact', statement: '' };
  // ── empty content out, by type: a review without its text, a label with nothing under it (an Hours label shows the
  // verified hours instead, if any), and a section left with nothing to show (with its menu link) ──
  const textOf = (r: TextRef | null | undefined) => (r ? visibleText(r, cat) ?? '' : '');
  const isHours = (title: string) => /^(opening |business |store |our )?hours:?$/i.test(title.trim());
  const hoursByFacts = spec.sections.some((x) => (x.facts ?? []).includes('hours')) || (spec.hero.aside.kind === 'contact-card' && (spec.hero.aside.facts ?? []).includes('hours'));
  const keepItem = (it: ItemSpec) => {
    const title = textOf(it.title), body = textOf(it.body);
    if (!title.trim()) return false;
    if (contentKind(title) === 'review-attribution') return false;
    if (body && contentKind(body) === 'review-attribution' && body.length < 60) return false;
    // (a design that shows the hours by its facts needs no such label: they would show twice)
    if (!body && isHours(title)) return !!cat.hours?.length && !hoursByFacts;
    if (!body && contentKind(title) === 'label') return false;
    return true;
  };
  const cleanSection = (sec: SectionSpec): SectionSpec => ({ ...sec, intro: sec.intro && contentKind(textOf(sec.intro)) !== 'name' ? null : sec.intro, items: sec.items.filter(keepItem) });
  // a reviews band (its heading says so, or everything in it was a review attribution) must show real reviews: a
  // review's own text, or the business's verified rating; a heading, an attribution, a claim or a button is not enough
  const reviewsBand = new Set(spec.sections.filter((sec) => /\b(reviews?|testimonials?|what (people|guests|customers|clients) say)\b/i.test(textOf(sec.heading)) || (sec.items.length > 0 && sec.items.every((it) => contentKind(textOf(it.title)) === 'review-attribution'))).map((sec) => sec.id));
  const ratingLine = cat.rating && cat.rating.count > 0 ? `${cat.rating.value}★ from ${cat.rating.count.toLocaleString('en-US')} Google reviews` : null;
  const hasReviewText = (sec: SectionSpec) => sec.items.some((it) => { const t = textOf(it.title), b = textOf(it.body); return (b.length >= 40 && contentKind(b) === 'name') || (t.length >= 60 && contentKind(t) === 'name'); });
  const hasContent = (sec: SectionSpec) => (reviewsBand.has(sec.id)
    ? hasReviewText(sec) || !!ratingLine
    : sec.items.length > 0 || !!textOf(sec.intro) || sec.actions.length > 0 || (sec.facts ?? []).some((k) => values[k]) || (!!sec.media && sec.media.placement !== 'none' && sec.media.photoIds.some((id) => cat.photos.some((p) => p.id === id))));
  // the rating and the link to the reviews are one block: sections that hold nothing but them are merged into the first
  // section that shows the rating (or the first of them), and the rating line shows only there
  const reviewActs = new Set(cat.actions.filter((a) => a.kind === 'reviews').map((a) => a.id));
  const showsRating = (sec: SectionSpec) => !!ratingLine && ((sec.facts ?? []).includes('rating') || (reviewsBand.has(sec.id) && !hasReviewText(sec)));
  const reviewsOnly = (sec: SectionSpec) => !sec.items.length && !textOf(sec.intro) && !(sec.media && sec.media.placement !== 'none' && sec.media.photoIds.length) && (sec.facts ?? []).every((k) => k === 'rating') && sec.actions.every((a) => reviewActs.has(a)) && (showsRating(sec) || sec.actions.length > 0);
  let liveSections = spec.sections.map(cleanSection).filter(hasContent);
  const carriers = liveSections.filter((sec) => showsRating(sec) || reviewsOnly(sec));
  const ratingHome = carriers.find((sec) => !reviewsOnly(sec)) ?? carriers[0];
  if (ratingHome) {
    const merged = carriers.filter((sec) => sec !== ratingHome && reviewsOnly(sec));
    const acts = [...new Set([...ratingHome.actions, ...merged.flatMap((sec) => sec.actions)])];
    liveSections = liveSections.filter((sec) => !merged.includes(sec)).map((sec) => (sec === ratingHome ? { ...sec, actions: acts } : sec));
  }
  const live = new Set(liveSections.map((x) => x.id));
  const sectionLabel = (id: string) => { const s = spec.sections.find((x) => x.id === id); if (!s) return id; const h = resolveText(s.heading, cat) ?? ''; return h && h.split(/\s+/).length <= 2 ? h.replace(/[.:]$/, '') : KIND_LABEL[s.kind] || shortLabel(h); };
  const pages = opts.pages ?? [];
  // a section and an inner page are the same destination when the page's name is a word of the section's ("Our Menu" →
  // Menu) or their kinds match (a story section → About, a contact section → Contact): one link, to the page
  const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const KIND_PAGE: Partial<Record<SectionSpec['kind'], string>> = { story: 'about', contact: 'contact' };
  const pageFor = (id: string, label: string) => { const sec = spec.sections.find((x) => x.id === id); return pages.find((p) => { const pw = words(p.label); return (pw.length > 0 && pw.every((w) => words(label).includes(w))) || (!!sec && KIND_PAGE[sec.kind] === pw.join(' ')); }); };
  const sectionLinks = spec.header.links.filter((id) => live.has(id)).map((id) => { const label = sectionLabel(id); const page = pageFor(id, label); return page ? { label: page.label, href: page.href } : { label, href: `#${id}` }; })
    .filter((l, i, all) => all.findIndex((x) => x.href === l.href) === i);
  const navLinks = [...sectionLinks, ...pages.filter((p) => !sectionLinks.some((l) => l.href === p.href))].map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('');

  // ── hero ──
  const h = spec.hero;
  const asideItems = (h.aside.items ?? []).filter((r) => textOf(r).trim() && contentKind(textOf(r)) === 'name').map((r) => `<li>${t(r)}</li>`).join('');
  const asideLines = (h.aside.items ?? []).filter((r) => textOf(r).trim()).map((r) => `<p>${t(r)}</p>`).join('');
  const asideInner = h.aside.kind === 'none' || !h.aside.span ? ''
    : h.aside.kind === 'image' ? photo(h.aside.photoId)
      : h.aside.kind === 'statement' ? asideLines
        : h.aside.kind === 'contact-card' ? `${asideLines}${factList(h.aside.facts)}${cat.email ? `<p class="mono"><a href="mailto:${esc(cat.email)}">${esc(cat.email)}</a></p>` : ''}`
          : asideItems;
  const asideCols = col(h.aside.start, h.aside.span);
  const aside = !asideInner ? '' : h.aside.kind === 'image'
    ? `<figure class="hero-aside" style="${asideCols}">${asideInner}</figure>`
    : h.aside.kind === 'statement' || h.aside.kind === 'contact-card'
      ? `<div class="hero-aside ${h.aside.kind === 'statement' ? 'aside-statement' : 'aside-card'}" style="${asideCols}">${asideInner}</div>`
      : `<ol class="hero-aside aside-${h.aside.kind}" style="${asideCols}">${asideInner}</ol>`;
  const textCols = !aside && h.aside.kind !== 'none' && h.textSide && h.textWidth ? heroColumns(h.textSide, h.textWidth, 'none') : { textStart: h.textStart, textSpan: h.textSpan };
  const heroPhoto = h.backgroundPhoto ? cat.photos.find((p) => p.id === h.backgroundPhoto) : undefined;
  const hero = `<section class="hero${heroPhoto ? ' hero-photo' : ''}" data-kind="hero" data-variant="open"${heroPhoto ? ` data-bg="#000000:0.5" data-text-color="${fg(h.background)}"` : ''} style="background:${bg[h.background]};color:${heroPhoto ? '#FFFFFF' : fg(h.background)}">${heroPhoto ? photo(heroPhoto.id, 'hero-bg') : ''}
  <div class="grid hero-grid">
    <div class="hero-text" style="${col(textCols.textStart, textCols.textSpan)}">
      ${t(h.kicker) ? `<p class="kicker">${t(h.kicker)}</p>` : ''}
      <h1>${t(h.headline)}</h1>
      ${h.lede ? `<p class="lede">${t(h.lede)}</p>` : ''}
      ${actions(h.actions)}
    </div>
    ${aside}
  </div>
</section>`;

  // ── sections ──
  // an "Hours" label with nothing under it shows the verified hours, or is left out when there are none (never an empty heading)
  const hoursLabel = (it: ItemSpec) => !it.body && isHours(visibleText(it.title, cat) ?? '');
  const hoursBody = (it: ItemSpec) => (hoursLabel(it) && cat.hours?.length && !hoursByFacts ? `<p>${cat.hours.map(esc).join('<br>')}</p>` : '');
  const item = (it: ItemSpec, i: number, style: SectionSpec['layout']['itemStyle']) => `<li class="item${it.photoId ? ' has-photo' : ''}">${photo(it.photoId, 'item-photo')}${style === 'numbered' ? `<span class="num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>` : ''}<h3>${t(it.title)}</h3>${it.body ? `<p>${t(it.body)}</p>` : hoursBody(it)}</li>`;
  const section = (sec: SectionSpec) => {
    const s = sec; // already cleaned (liveSections)
    const L = arrangedFor(s, cat);
    const media = s.media && s.media.placement !== 'none' ? s.media : undefined;
    const head = `<div class="sec-head" style="${col(L.headingStart, L.headingSpan)}"><h2>${t(s.heading)}</h2>${s.intro ? `<p class="intro">${t(s.intro)}</p>` : ''}${media?.placement === 'beside' ? `<div class="beside" data-n="${Math.min(2, media.photoIds.length)}">${media.photoIds.map((id) => photo(id)).join('')}</div>` : ''}</div>`;
    const tiles = media?.placement === 'mosaic' ? media.photoIds.map((id) => photo(id)).filter(Boolean) : [];
    const mosaic = tiles.length ? `<div class="mosaic" data-n="${tiles.length}">${mosaicLayout(tiles.length).map((t, i) => `<div class="tile" style="--span:${t.span};--ar:${t.ar};--m-span:${t.mSpan};--m-ar:${t.mAr}">${tiles[i]}</div>`).join('')}</div>` : '';
    const withPhoto = s.items.filter((it) => it.photoId && cat.photos.some((p) => p.id === it.photoId));
    const textOnly = s.items.filter((it) => !withPhoto.includes(it));
    const list = (items: ItemSpec[], cls: string, style: SectionSpec['layout']['itemStyle'], cols: number) => (items.length ? `<ul class="items${cls ? ` ${cls}` : ''} style-${style}" style="--cols:${cols}">${items.map((it) => item(it, s.items.indexOf(it), style)).join('')}</ul>` : '');
    const items = withPhoto.length && textOnly.length
      // mixed: the photo items as a photo row, the rest as an intentional text list (names in columns, ruled), never cards with empty image space
      ? list(withPhoto, 'photo-items', L.itemStyle === 'numbered' ? 'plain' : L.itemStyle, Math.min(Math.max(L.itemColumns, withPhoto.length), 4)) + list(textOnly, 'text-items', 'ruled', Math.min(4, Math.max(2, L.itemColumns)))
      : list(s.items, '', L.itemStyle, L.itemColumns);
    const rating = s.id === ratingHome?.id && ratingLine ? `<p class="rating" data-fact="rating">${esc(ratingLine)}</p>` : '';
    const facts = factList((s.facts ?? []).filter((k) => k !== 'rating'));
    const body = `<div class="sec-body" style="${col(L.contentStart, L.contentSpan)}">${rating}${facts}${items}${mosaic}${actions(s.actions)}</div>`;
    const band = media?.placement === 'band' ? `<div class="band" data-n="${Math.min(3, media.photoIds.filter((id) => cat.photos.some((p) => p.id === id)).length)}">${media.photoIds.map((id) => photo(id)).join('')}</div>` : '';
    return `<section id="${esc(s.id)}" data-kind="${esc(s.kind)}" data-variant="open"${L.arrangement !== s.layout.arrangement ? ` data-planned="${s.layout.arrangement}"` : ''} class="sec density-${L.density} ${L.arrangement}${isSparse(s, cat) ? ' sparse' : ''}${s.background === 'accent' ? ' on-accent' : ''}" style="background:${bg[s.background]};color:${fg(s.background)}"><div class="grid">${head}${body}</div>${band}</section>`;
  };

  const m = spec.mobile;
  const sticky = m.stickyAction ? cat.actions.find((a) => a.id === m.stickyAction) : undefined;
  const fontHref = specFontHref(spec);
  const rule = spec.shape.rule === 'none' ? 'none' : `${spec.shape.rule === 'heavy' ? 3 : 1}px solid currentColor`;
  const header = `<a class="skip" href="#main">Skip to content</a><header class="site-header site-head style-${spec.header.style}${spec.header.sticky ? ' sticky' : ''}"><div class="grid header-grid">${mark}<nav class="links">${navLinks}</nav>${spec.header.action ? action(spec.header.action, true) : ''}
  <details class="menu"><summary aria-label="Menu">Menu</summary><nav>${navLinks}${spec.header.action ? action(spec.header.action, true) : ''}</nav></details></div></header>`;
  const footer = `<footer class="site-footer"><div class="grid"><div style="${col(1, 6)}">${mark}</div><div style="${col(7, 6)}" class="foot-actions">${cat.email ? `<a class="mono" href="mailto:${esc(cat.email)}">${esc(cat.email)}</a>` : ''}${cat.actions.filter((a) => a.kind !== 'email').map((a) => action(a.id, false)).join('')}</div></div></footer>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cat.business.name)} — design preview</title><meta name="robots" content="noindex">${opts.designId ? `<meta name="roger-design" content="${esc(opts.designId)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${fontHref}">
<style>
:root{--ground:${P.ground};--surface:${P.surface};--ink:${P.ink};--accent:${P.accent};--on-accent:${P.onAccent};--radius:${spec.shape.radius}px;--gutter:${spec.grid.gutter}px;--margin:${spec.grid.margin}px;--max:${spec.grid.maxWidth}px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ground);color:var(--ink);font:400 ${T.base}px/1.6 '${T.body}',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:'${T.heading}',system-ui,sans-serif;font-weight:${T.headingWeight};letter-spacing:${T.tracking}em;text-transform:${T.headingCase};margin:0;line-height:1.08;text-wrap:balance}
h1{font-size:clamp(${(size(3) * 0.9).toFixed(1)}px,${(h.headlineSize * 1.1).toFixed(2)}vw,${(T.base * h.headlineSize).toFixed(1)}px)}
h2{font-size:${size(3)}px}h3{font-size:${itemSize(1)}px;line-height:1.25}
p{max-width:${T.measure}ch;margin:0}.mono{font-family:'${T.mono ?? T.body}',ui-monospace,monospace;font-size:.9em}
a{color:inherit}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--gutter);row-gap:${(T.base * 2).toFixed(0)}px;max-width:calc(var(--max) + 2*var(--margin));margin:0 auto;padding-inline:var(--margin)}
.site-header{background:var(--ground);border-bottom:${rule === 'none' ? '0' : '1px solid color-mix(in srgb,var(--ink) 14%,transparent)'}}.site-header.sticky{position:sticky;top:0;z-index:10}
.header-grid{align-items:center;padding-block:18px}.wordmark{font-family:'${T.heading}',sans-serif;font-weight:${Math.max(T.headingWeight, 600)};font-size:${size(1)}px;letter-spacing:${T.tracking}em;grid-column:1 / span 4}.logo{max-height:40px;grid-column:1 / span 3}
.links{grid-column:${spec.header.style === 'split' ? '5 / span 5' : '6 / span 5'};display:flex;gap:28px;justify-content:${spec.header.style === 'minimal' ? 'flex-end' : 'center'};font-size:.94em}.links a{text-decoration:none;opacity:.8}.links a:hover{opacity:1}
.site-header .btn{grid-column:11 / span 2;justify-self:end}.menu{display:none}
.btn{display:inline-flex;align-items:center;min-height:46px;padding:0 22px;border-radius:var(--radius);border:1.5px solid currentColor;text-decoration:none;font-weight:600;font-size:.95em}.btn-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:${(T.base * 2).toFixed(0)}px}
.on-accent .btn-primary{background:var(--on-accent);color:var(--accent);border-color:var(--on-accent)}
.hero{min-height:${h.minHeight}vh;display:flex;align-items:${({ start: 'flex-start', center: 'center', end: 'flex-end' })[h.verticalAlign]};padding-block:${(T.base * 5).toFixed(0)}px}.hero-grid{width:100%;align-items:${h.verticalAlign === 'end' ? 'end' : h.verticalAlign};grid-auto-flow:row dense}
.hero-text{text-align:${h.align === 'center' ? 'center' : 'left'}}.hero-text p{${h.align === 'center' ? 'margin-inline:auto' : ''}}.hero-text .actions{justify-content:${h.align === 'center' ? 'center' : 'flex-start'}}
.kicker{font-family:'${T.mono ?? T.body}',monospace;font-size:.82em;letter-spacing:.08em;text-transform:uppercase;opacity:.75;margin-bottom:${T.base}px}.lede{font-size:${size(1)}px;line-height:1.5;margin-top:${(T.base * 1.5).toFixed(0)}px;opacity:.88}
.hero-aside{margin:0;padding:0;list-style:none;align-self:${h.verticalAlign === 'end' ? 'end' : 'center'}}.hero-aside li{padding:14px 0;border-top:${rule};font-family:'${T.heading}',sans-serif;font-size:${size(1)}px}.hero-aside li:last-child{border-bottom:${rule}}
.aside-card{background:color-mix(in srgb,currentColor 6%,transparent);border-radius:var(--radius);padding:28px}.aside-card p+p{margin-top:12px}.aside-statement p{font-family:'${T.heading}',sans-serif;font-size:${size(2)}px;line-height:1.25}.hero-aside img{width:100%;border-radius:var(--radius)}
.sec{padding-block:var(--pad)}.density-compact{--pad:${(T.base * 3.5).toFixed(0)}px}.density-regular{--pad:${(T.base * 5.5).toFixed(0)}px}.density-airy{--pad:${(T.base * 8).toFixed(0)}px}.sec.sparse{--pad:${(T.base * 3.5).toFixed(0)}px}
.sec.side-by-side .grid{align-items:start}.sec.side-by-side .sec-head{position:sticky;top:96px}.intro{margin-top:${T.base}px;font-size:${size(0.5)}px;opacity:.85}
.items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:${(T.base * 2).toFixed(0)}px var(--gutter)}.item p{margin-top:10px;opacity:.85;font-size:${Math.max(T.base, ITEM_TEXT_MIN_PX)}px}
.style-ruled .item{border-top:${rule === 'none' ? '1px solid currentColor' : rule};padding-top:20px}.style-card .item{background:color-mix(in srgb,currentColor 5%,transparent);border-radius:var(--radius);padding:28px}
.style-numbered .item{border-top:${rule === 'none' ? '1px solid currentColor' : rule};padding-top:18px}.num{display:block;font-family:'${T.mono ?? T.heading}',monospace;font-size:.85em;opacity:.6;margin-bottom:12px}
.style-large-type .item h3{font-size:${size(2.5)}px;line-height:1.15}.style-large-type .item{padding-block:8px}
.site-footer{padding-block:${(T.base * 4).toFixed(0)}px;border-top:1px solid color-mix(in srgb,var(--ink) 14%,transparent)}.foot-actions{display:flex;gap:20px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.hero-photo{position:relative;overflow:hidden}.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero-photo::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.62),rgba(0,0,0,.22));z-index:1}.hero-photo .hero-grid{position:relative;z-index:2}
.item-photo{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius);margin-bottom:16px}
.beside{display:grid;gap:12px;margin-top:28px}.beside img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}@media (min-width:761px){.sec.stack .beside{max-width:${STACKED_PHOTO_MAX_PX}px}.sec.stack .beside img{aspect-ratio:4/3}}
.mosaic{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;margin-top:32px}.mosaic>.tile{grid-column:span var(--span);min-width:0}.mosaic img{display:block;width:100%;aspect-ratio:var(--ar);object-fit:cover;border-radius:var(--radius)}
.band{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px;margin-top:var(--pad)}.band img{width:100%;height:clamp(220px,26vw,380px);object-fit:cover;display:block}
.links a,.foot-actions a,.aside-card a,.menu nav a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}
.menu:not([open]) nav{display:none}.menu nav a{justify-content:flex-start;white-space:nowrap}
.skip{position:absolute;left:-9999px;top:8px;background:var(--ground);color:var(--ink);padding:12px 16px;z-index:30}.skip:focus{left:16px}
.items{align-items:start}.text-items{margin-top:28px}.text-items .item{border-top:1px solid color-mix(in srgb,currentColor 35%,transparent);padding-top:14px}.text-items h3{font-size:${itemSize(0.5)}px}
.rating{font-family:'${T.heading}',system-ui,sans-serif;font-size:${size(1.5)}px;letter-spacing:${T.tracking}em;margin:0 0 18px}
.facts{margin:0;display:grid;gap:18px}.facts dt{font-family:'${T.mono ?? T.body}',monospace;font-size:.82em;letter-spacing:.08em;text-transform:uppercase;opacity:.75}.facts dd{margin:4px 0 0;font-size:${size(0.5)}px;line-height:1.5}.facts+.items,.facts+.actions{margin-top:${(T.base * 2).toFixed(0)}px}.aside-card .facts+p{margin-top:12px}
${cat.photos.some(isListing) ? `${LISTING_CSS}\n.gph{position:relative;display:block;min-width:0}.hero-photo>.gph{position:absolute;inset:0}` : ''}
.sticky-bar{display:none}
@media (max-width:760px){
  :root{--margin:20px;--gutter:16px}
  .grid>*{grid-column:1 / -1 !important}
  h1{font-size:min(${(T.base * h.headlineSize * m.headingScale).toFixed(1)}px,11.5vw);overflow-wrap:normal}h2{font-size:${(size(3) * Math.max(m.headingScale, 0.7)).toFixed(1)}px}
  .links,.site-header .header-grid>.btn{display:none}
  ${m.navigation === 'menu-button' ? `.menu{display:block;grid-column:auto !important;justify-self:end;position:relative}.menu summary{list-style:none;cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}.menu summary::-webkit-details-marker{display:none}.menu nav{position:absolute;right:0;top:48px;background:var(--ground);color:var(--ink);padding:16px;display:grid;gap:14px;min-width:220px;border-radius:var(--radius);box-shadow:0 12px 32px rgba(0,0,0,.18)}.header-grid{grid-template-columns:1fr auto}.header-grid>.wordmark,.header-grid>.logo{grid-column:1 !important;min-width:0}`
    : m.navigation === 'inline-links' ? '.links{display:flex;grid-column:1 / -1 !important;justify-content:flex-start;gap:18px;overflow-x:auto;padding-top:8px}' : `.site-header .header-grid>.btn{display:inline-flex;grid-column:auto !important}.header-grid{grid-template-columns:1fr auto}.header-grid>.wordmark,.header-grid>.logo{grid-column:1 !important;min-width:0}`}
  .hero{min-height:auto;padding-block:${(T.base * 3).toFixed(0)}px}
  ${m.heroOrder === 'aside-hidden' ? '.hero-aside{display:none}' : m.heroOrder === 'aside-first' ? '.hero-aside{order:-1}' : ''}
  .items{grid-template-columns:repeat(${m.itemColumns},minmax(0,1fr))}.mosaic{grid-template-columns:repeat(2,minmax(0,1fr))}.mosaic>.tile{grid-column:span var(--m-span)}.mosaic img{aspect-ratio:var(--m-ar)}.sec.sparse{--pad:${(T.base * 2.5).toFixed(0)}px}.band{grid-auto-columns:42%;overflow-x:auto;scroll-snap-type:x mandatory}.band[data-n="1"]{grid-auto-columns:100%;overflow:visible}.band[data-n="2"]{grid-auto-columns:calc(50% - 3px);overflow:visible}.text-items{grid-template-columns:repeat(2,minmax(0,1fr))}.band img{scroll-snap-align:start}.beside{grid-template-columns:repeat(2,minmax(0,1fr))}.beside[data-n="1"]{grid-template-columns:1fr}
  .hero-photo{min-height:70vh}.sec.side-by-side .sec-head{position:static}
  .foot-actions{justify-content:flex-start}
  ${sticky ? `.sticky-bar{display:flex;position:fixed;left:0;right:0;bottom:0;padding:12px 20px calc(12px + env(safe-area-inset-bottom,0px));background:var(--ground);box-shadow:0 -6px 20px rgba(0,0,0,.12);z-index:20}.sticky-bar .btn{flex:1;justify-content:center}body{padding-bottom:76px}` : ''}
}
</style></head><body>
${header}
<main id="main">
${hero}
${liveSections.map(section).join('\n')}
</main>
${footer}
${sticky ? `<div class="sticky-bar">${action(sticky.id, true)}</div>` : ''}
</body></html>`;
}
/** a nav label from a section heading: the first few words */
function shortLabel(s: string) { const w = s.replace(/[.:]$/, '').split(/\s+/); return w.length <= 3 ? w.join(' ') : w.slice(0, 3).join(' ') + '…'; }

export const designDir = (id: string) => path.join(config.dirs.out, 'studio-designs', id);

/** Write the page and take full-page screenshots at 1440px and 390px; report whether either scrolls sideways. */
export async function renderDesignFiles(id: string, html: string): Promise<{ html: string; desktop: string; mobile: string; overflow: { desktop: boolean; mobile: boolean } }> {
  const dir = designDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  writeStoredFile(file, html);
  const browser = await launchBrowser();
  try {
    const shot = async (mobile: boolean) => {
      const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
      try {
        const page = await ctx.newPage();
        await page.goto(`file:///${file.replace(/\\/g, '/')}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => undefined);
        await page.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
        // every photo loaded before the capture: scroll the page through once, then wait (up to 20 s) for all images
        // (instant scrolling: the page's smooth scroll would still be moving at capture time, leaving sticky bars mid-page)
        await page.evaluate("(async () => { document.documentElement.style.scrollBehavior = 'auto'; for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 150)); } scrollTo({ top: 0, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 300)); })()").catch(() => undefined);
        await page.waitForFunction('[...document.images].every((i) => i.complete && i.naturalWidth > 0)', undefined, { timeout: 20_000 }).catch(() => undefined);
        const overflow = (await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')) as boolean;
        const out = path.join(dir, mobile ? 'mobile.png' : 'desktop.png');
        await page.screenshot({ path: out, fullPage: true });
        return { out, overflow };
      } finally { await ctx.close().catch(() => undefined); }
    };
    const d = await shot(false);
    const m = await shot(true);
    return { html: file, desktop: d.out, mobile: m.out, overflow: { desktop: d.overflow, mobile: m.overflow } };
  } finally { await browser.close().catch(() => undefined); }
}

// ───────────────────────── the concept job's side: one concept from a spec, rendered and measured ─────────────────────────

const KIND_OF: Record<SectionSpec['kind'], SectionKind> = { services: 'offer', capabilities: 'offer', work: 'offer', principles: 'story', statement: 'story', story: 'story', contact: 'contact' };
/** every photo a spec places */
export function specPhotos(spec: DesignSpec): string[] {
  return [...new Set([spec.hero.backgroundPhoto, spec.hero.aside.kind === 'image' ? spec.hero.aside.photoId : null, ...spec.sections.flatMap((s) => [...s.items.map((i) => i.photoId), ...(s.media?.photoIds ?? [])])].filter((x): x is string => !!x))];
}
/**
 * The concept a DesignSpec becomes in a concept set: the same record the directions produce (so the set, the checks and
 * the Studio read it the same way), with the spec's id. The full-site handoff does not read open concepts yet.
 */
export function specConcept(spec: DesignSpec, designSpecId: string, cat: Catalog, brief: BusinessBrief, id = 'a'): Concept {
  const brand = brandColors(brief);
  const c = (v: string) => resolveColor(v, brand) ?? '#000000';
  const P = { ground: c(spec.palette.ground), surface: c(spec.palette.surface), ink: c(spec.palette.ink), inverse: c(spec.palette.inverse), accent: c(spec.palette.accent), onAccent: c(spec.palette.onAccent) };
  const actionOf = (aid: string, slot: 'primary' | 'secondary') => { const a = cat.actions.find((x) => x.id === aid)!; return { slot, actionId: a.id, label: a.label, href: a.href, factId: a.factId }; };
  const sections: ComposedSection[] = [
    { kind: 'hero', variant: 'open', id: 'hero', title: resolveText(spec.hero.headline, cat) ?? '', intro: resolveText(spec.hero.lede, cat) ?? '', factIds: [], imageIds: [spec.hero.backgroundPhoto, spec.hero.aside.photoId].filter((x): x is string => !!x) },
    ...spec.sections.map((s) => ({ kind: KIND_OF[s.kind], variant: 'open', id: s.id, title: resolveText(s.heading, cat) ?? '', intro: resolveText(s.intro, cat) ?? '', factIds: s.items.flatMap((i) => ('service' in i.title ? [i.title.service] : [])), imageIds: [...s.items.map((i) => i.photoId), ...(s.media?.photoIds ?? [])].filter((x): x is string => !!x) })),
  ];
  return {
    id, name: 'Open design', thesis: spec.thesis, evidence: [...new Set(sections.flatMap((s) => s.factIds))],
    axes: { structure: 'offer-first', heroComposition: 'split' as never, density: 'balanced', imageryRole: specPhotos(spec).length ? 'lead' : 'minimal', typeVoice: 'display', colorStrategy: 'brand-accent' },
    planSource: 'ai',
    tokens: { colors: { bg: P.ground, surface: P.surface, ink: P.ink, muted: P.ink, line: P.ink, brand: P.accent, onBrand: P.onAccent, brandText: P.accent, accent: P.accent, onAccent: P.onAccent, action: P.accent, onAction: P.onAccent, deep: P.inverse, onDeep: textOn(P.inverse, P.ink) }, fonts: { heading: { family: spec.type.heading, weight: spec.type.headingWeight, css: `'${spec.type.heading}', system-ui, sans-serif` }, body: { family: spec.type.body, css: `'${spec.type.body}', system-ui, sans-serif` }, href: specFontHref(spec) }, radius: spec.shape.radius, space: 1, headingCase: spec.type.headingCase, origin: { colors: 'brand', fonts: 'brand' } },
    sections, copy: [],
    actions: spec.hero.actions.map((a, i) => actionOf(a, i ? 'secondary' : 'primary')),
    images: specPhotos(spec), omitted: cat.omitted, notes: [`composed by the open planner (DesignSpec ${designSpecId})`], checks: [], designSpecId,
  };
}

/** Render open concepts into their set the way renderSet does: HTML beside its photo copies, first-screen and full screenshots, the checks' measurements. */
export async function renderSpecSet(items: { concept: Concept; spec: DesignSpec }[], cat: Catalog, brief: BusinessBrief, setId: string, onStep?: (step: string, ms: number) => void): Promise<Rendered[]> {
  const dir = setDir(setId);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  let started = Date.now();
  const step = (label: string) => { onStep?.(label, Date.now() - started); started = Date.now(); };
  const perPage = singleProcessChrome();
  const shared = perPage ? undefined : await launchBrowser();
  const out: Rendered[] = [];
  try {
    for (const { concept, spec } of items) {
      const html = path.join(dir, `${concept.id}.html`);
      writeStoredFile(html, renderSpec(spec, cat, brief, { photoSrc: (id) => `img/${id}.jpg` }));
      step(`${concept.id} HTML (open planner)`);
      const shoot = async (kind: 'desktop' | 'mobile') => {
        const browser = shared ?? await launchBrowser();
        const ctx = await browser.newContext(kind === 'desktop' ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        try {
          const page = await ctx.newPage();
          await page.goto(`file:///${html.split(path.sep).join('/').replace(/^\//, '')}`, { waitUntil: 'load', timeout: 30_000 });
          await settle(page);
          const hero = path.join(dir, 'shots', `${concept.id}-${kind}-hero.png`);
          const full = path.join(dir, 'shots', `${concept.id}-${kind}.jpg`);
          await page.screenshot({ path: hero, clip: { x: 0, y: 0, width: kind === 'desktop' ? 1440 : 390, height: kind === 'desktop' ? 900 : 844 } });
          // measured on the real page; then, for the full-page image only, sticky and fixed bars are laid in place (a
          // full-page capture otherwise repeats a sticky header at the bottom and drops a fixed bar mid-page)
          const metrics = (await page.evaluate(MEASURE_SCRIPT)) as PageMetrics;
          // (nothing that changes the page's height: a height change mid-capture makes the stitched image repeat content;
          // the fixed phone bar shows in the first-screen shot)
          await page.addStyleTag({ content: '.site-header.sticky{position:relative!important}.sticky-bar{display:none!important}' });
          // at CSS scale: a long phone page at 2x passes Chromium's 16,384px texture limit, and past it the capture wraps
          // round to the top of the page (the first screen painted over the true bottom)
          await page.screenshot({ path: full, fullPage: true, type: 'jpeg', quality: 82, scale: 'css' });
          step(`${concept.id} ${kind}`);
          return { full, hero, metrics };
        } finally { await ctx.close().catch(() => undefined); if (!shared) await browser.close().catch(() => undefined); }
      };
      // a browser that crashed under the page (serverless Chromium) gets one retry with a fresh browser
      const again = async (kind: 'desktop' | 'mobile') => { try { return await shoot(kind); } catch (e) { if (!perPage || !browserGone(e)) throw e; step(`${concept.id} ${kind}: browser closed, one retry`); return shoot(kind); } };
      out.push({ conceptId: concept.id, html, desktop: await again('desktop'), mobile: await again('mobile') });
    }
  } finally { await shared?.close().catch(() => undefined); }
  return out;
}
/**
 * Fonts loaded and every image loaded and decoded, before a capture. No scrolling: images are eager, and on mobile
 * emulation a scroll back to the top does not always settle before a full-page capture (sticky bars land mid-page).
 */
async function settle(page: import('playwright-core').Page) {
  await page.evaluate('Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))])').catch(() => undefined);
  await page.waitForFunction('[...document.images].every((i) => i.complete && i.naturalWidth > 0)', undefined, { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate('Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)))').catch(() => undefined);
}
