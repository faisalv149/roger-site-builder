import type { Catalog, Photo } from './review.js';
import type { ComposedSection, Concept, ConceptAction, DesignTokens } from './types.js';
import { capWidth, contrast, DISPLAY_ONLY } from './tokens.js';

/**
 * The shared section library. Every business's concepts are built from these variants; a new variant is added here
 * for everyone, never written for one site. A renderer gets the concept's composed section (its facts and pictures by
 * id, its title and intro) and the fact catalog, and returns HTML; the CSS of every variant used goes in one sheet.
 *
 * Facts are printed from the catalog, never from free text: a price, phone number, address or rating can only appear
 * through the catalog entry it belongs to. Backdrops that sit behind text over a photograph declare their worst case
 * (`data-bg="#rrggbb:alpha"`, a scrim of that colour over a white or black pixel) so contrast is checked, not guessed.
 */

export interface RenderCtx {
  cat: Catalog;
  concept: Concept;
  img: (id: string) => { src: string; width: number; height: number; alt: string; photo: Photo } | undefined;
  /** pictures already on the page: a photo is shown once */
  used: Set<string>;
  /** a service's own page on the finished site (the full-site handoff), by service id */
  serviceLinks?: Record<string, { href: string; label: string }>;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ext = (href: string) => (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '');
const btn = (a: ConceptAction | undefined, kind: 'primary' | 'ghost' | 'invert' | 'deep') => (a ? `<a class="btn btn--${kind}" href="${esc(a.href)}"${ext(a.href)} data-action="${esc(a.actionId)}">${esc(a.label)}</a>` : '');
const action = (c: RenderCtx, slot: 'primary' | 'secondary') => c.concept.actions.find((a) => a.slot === slot);
const others = (c: RenderCtx, kinds: string[]) => c.cat.actions.filter((a) => kinds.includes(a.kind) && !c.concept.actions.some((x) => x.actionId === a.id));
const linkTo = (a: { id: string; label: string; href: string }, cls = 'link') => `<a class="${cls}" href="${esc(a.href)}"${ext(a.href)} data-action="${esc(a.id)}">${esc(a.label)}</a>`;
function image(c: RenderCtx, id: string | undefined, cls = '', eager = false) {
  const im = id ? c.img(id) : undefined;
  if (!im) return '';
  c.used.add(id!);
  // a Google listing photo: its image and its credit (photographer, Google Maps) are filled in each time it is served
  const g = im.photo.url.match(/^google-listing:([A-Za-z0-9_-]+#\d+)$/)?.[1];
  return `<img class="${cls}" src="${esc(im.src)}" width="${im.width}" height="${im.height}" alt="${esc(im.alt)}"${eager ? ' fetchpriority="high"' : ''} data-asset="${esc(id!)}"${g ? ` data-gphoto="${g}" data-gsize="${im.photo.width}x${im.photo.height}"` : ''}>${g ? `<span class="gcredit" data-gcredit="${g}"></span>` : ''}`;
}
const stars = (v: number) => `<span class="stars" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 15l-5.4 3 1.2-6L1.3 7.8l6.1-.7z" fill="${i + 0.5 <= v ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.2"/></svg>`).join('')}</span>`;
const fmt = (n: number) => n.toLocaleString('en-US');
const head = (s: ComposedSection, cls = '') => `<header class="sec-head ${cls}">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ''}</header>`;
const ratingLine = (c: RenderCtx) => { const r = c.cat.rating!; return `${r.value} on Google from ${fmt(r.count)} reviews${r.scope ? ` (${esc(r.scope)})` : ''}`; };
/** the first of these pictures not yet on the page */
const fresh = (c: RenderCtx, ids: (string | undefined)[]) => ids.find((id) => id && c.img(id) && !c.used.has(id));
const firstSentences = (t: string, max: number) => { const s = t.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [t]; let out = ''; for (const x of s) { if ((out + x).length > max && out) break; out += x; } return out.trim(); };

// ───────────────────────── header and footer ─────────────────────────
export function siteHeader(c: RenderCtx, style: 'overlay' | 'bar' | 'center', nav: { href: string; label: string }[]) {
  const t = c.concept.tokens;
  const t0 = c.concept.tokens.colors;
  const headBg = style === 'center' ? t0.brand : t0.surface;
  const logoOk = !!c.cat.logo && style !== 'overlay' && c.img('logo') !== undefined && (c.cat.logo.colors.length ? Math.max(...c.cat.logo.colors.slice(0, 2).map((x) => contrast(x, headBg))) >= 3 : true);
  const brand = logoOk ? image(c, 'logo', 'brand__logo') : `<span class="brand__word">${esc(c.cat.business.name)}</span>`;
  const p = action(c, 'primary');
  const scrim = style === 'overlay' ? ` data-bg="#0B0C10:0.6"` : '';
  void t;
  const kind = p ? (p.actionId === 'find-location' ? 'locations' : c.cat.actions.find((a) => a.id === p.actionId)?.kind) : undefined;
  // on a phone the header keeps a one-word action, or none (the hero carries it)
  const short = kind === 'call' ? 'Call' : kind === 'book' ? 'Book' : kind === 'menu' ? 'Menu' : kind === 'directions' ? 'Directions' : kind === 'locations' ? 'Locations' : '';
  return `<header class="site-head site-head--${style}"${scrim}><div class="wrap site-head__in"><a class="brand" href="#top" aria-label="${esc(c.cat.business.name)}, top of the page">${brand}</a><button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-menu">Menu</button><nav id="site-menu" aria-label="Sections"><ul>${nav.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('')}</ul></nav>${p ? `<a class="btn btn--${style === 'overlay' ? 'invert-light' : style === 'center' ? 'deep' : 'primary'} btn--small" href="${esc(p.href)}"${ext(p.href)} data-action="${esc(p.actionId)}" aria-label="${esc(p.label)}"${short ? '' : ' data-hide-sm'}><span class="lbl-l">${esc(p.label)}</span><span class="lbl-s">${esc(short)}</span></a>` : ''}</div></header>`;
}

export function siteFooter(c: RenderCtx) {
  const cat = c.cat;
  const where = cat.address ? esc(cat.address.formatted) : cat.locations.length > 1 ? `${cat.locations.length} locations` : cat.locations[0] ? esc(cat.locations[0].formatted) : '';
  const contact = [cat.phone ? `<a href="${cat.phone.href}">${esc(cat.phone.display)}</a>` : '', cat.email ? `<a href="mailto:${esc(cat.email)}">${esc(cat.email)}</a>` : ''].filter(Boolean).join(' · ');
  const site = cat.business.website ? new URL(cat.business.website).hostname.replace(/^www\./, '') : '';
  return `<footer class="site-foot"><div class="wrap site-foot__in"><div><p class="site-foot__name">${esc(cat.business.name)}</p>${cat.business.category ? `<p>${esc(cat.business.category)}</p>` : ''}</div><div>${where ? `<p>${where}</p>` : ''}${contact ? `<p>${contact}</p>` : ''}</div><p class="site-foot__note">A concept preview by Roger, not a published site. Its facts come from ${esc(site || 'the business')}${cat.rating ? ' and its Google listing' : ''}.</p></div></footer>`;
}

// ───────────────────────── hero ─────────────────────────
function heroChips(c: RenderCtx, light: boolean) {
  const cat = c.cat;
  const chips = [
    cat.rating ? `<li data-fact="rating">${stars(cat.rating.value)}<span>${cat.rating.value} · ${fmt(cat.rating.count)} Google reviews</span></li>` : '',
    cat.area ? `<li data-fact="area">Serving ${esc(cat.area.slice(0, 4).join(', '))}${cat.area.length > 4 ? '…' : ''}</li>` : cat.locations.length > 1 ? `<li data-fact="locations">${cat.locations.length} locations</li>` : cat.locations[0] ? `<li data-fact="${cat.locations[0].id}">${esc(cat.locations[0].cityLine.replace(/\s\d{5}$/, ''))}</li>` : '',
  ].filter(Boolean);
  return chips.length ? `<ul class="chips${light ? ' chips--light' : ''}">${chips.join('')}</ul>` : '';
}
const copyOf = (c: RenderCtx, slot: string) => c.concept.copy.find((x) => x.slot === slot)?.text ?? '';
/** the longest word of the headline, in ems at this face and case: the hero CSS divides the column by it */
function fit(c: RenderCtx) {
  const t = c.concept.tokens;
  const longest = Math.max(4, ...copyOf(c, 'hero.headline').split(/\s+/).map((w) => w.length));
  const em = capWidth(t.fonts.heading.family) * (t.headingCase === 'uppercase' || DISPLAY_ONLY.has(t.fonts.heading.family) ? 1 : 0.82);
  return ` style="--fit:${(longest * em * 1.08).toFixed(2)}"`;
}

function heroFullBleed(c: RenderCtx, s: ComposedSection) {
  return `<section class="hero hb" id="top" data-kind="hero" data-variant="full-bleed" data-bg="#0B0C10:0.6">${image(c, s.imageIds[0], 'hb__img', true)}<div class="hb__scrim" aria-hidden="true"></div>
  <div class="wrap hb__body"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1><p class="lede">${esc(copyOf(c, 'hero.subline'))}</p>
  <div class="actions">${btn(action(c, 'primary'), 'invert')}${btn(action(c, 'secondary'), 'ghost')}</div>${heroChips(c, true)}</div></section>`;
}
function heroSplit(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  const facts = [
    cat.rating ? `<div><dt>Google rating</dt><dd>${stars(cat.rating.value)} ${cat.rating.value} from ${fmt(cat.rating.count)} reviews</dd></div>` : '',
    cat.area ? `<div><dt>Serving</dt><dd>${esc(cat.area.join(', '))}</dd></div>` : cat.locations.length > 1 ? `<div><dt>Locations</dt><dd>${cat.locations.length} around ${esc([...new Set(cat.locations.map((l) => l.cityLine.split(',')[0]))].slice(0, 3).join(', '))}</dd></div>` : cat.address ? `<div><dt>Find us</dt><dd>${esc(cat.address.formatted)}</dd></div>` : '',
    cat.hours ? (() => { const open = cat.hours!.find((h) => !/closed/i.test(h)) ?? cat.hours![0]; return `<div><dt>Hours</dt><dd>${esc(open)}${cat.hours!.length > 1 ? '…' : ''}</dd></div>`; })() : '',
  ].filter(Boolean).join('');
  return `<section class="hero hs" id="top" data-kind="hero" data-variant="split"><div class="wrap hs__grid"><div class="hs__text"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1><p class="lede">${esc(copyOf(c, 'hero.subline'))}</p>
  <div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}</div>${facts ? `<dl class="hs__facts">${facts}</dl>` : ''}</div>
  <figure class="hs__media">${image(c, s.imageIds[0], '', true)}</figure></div></section>`;
}
function heroTypeCollage(c: RenderCtx, s: ComposedSection) {
  const names = c.cat.items.length ? c.cat.items.map((i) => i.name) : c.cat.services.map((x) => x.name);
  const ticker = names.length ? `<div class="ht__ticker"><p>${[...names, ...names].slice(0, 18).map((n) => `<span>${esc(n)}</span>`).join('')}</p></div>` : '';
  const pics = s.imageIds.slice(0, 3).map((id, i) => `<figure class="ht__pic ht__pic--${i + 1}">${image(c, id, '', i === 0)}</figure>`).join('');
  return `<section class="hero ht" id="top" data-kind="hero" data-variant="type-collage"><div class="wrap ht__grid"><div class="ht__text"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1>
  <p class="lede">${esc(copyOf(c, 'hero.subline'))}</p><div class="actions">${btn(action(c, 'primary'), 'deep')}${btn(action(c, 'secondary'), 'ghost')}</div></div>${pics ? `<div class="ht__collage">${pics}</div>` : ''}</div>${ticker}</section>`;
}

// ───────────────────────── offerings and services ─────────────────────────
function menuMore(c: RenderCtx) {
  const docs = c.cat.actions.filter((a) => a.kind === 'menu');
  return docs.length ? `<p class="more">${docs.map((d) => linkTo(d, 'btn btn--ghost')).join(' ')}</p>` : '';
}
function ordered<T extends { id: string }>(list: T[], first: string[]) { const f = first.map((id) => list.find((x) => x.id === id)).filter(Boolean) as T[]; return [...f, ...list.filter((x) => !f.includes(x))]; }
const price = (it: { id: string; price?: string }) => (it.price ? `<span class="price" data-price="${esc(it.id)}">${esc(it.price.replace(/\s*\|\s*/g, ' · '))}</span>` : '');
const tags = (t: string[]) => (t.length ? `<ul class="tags">${t.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

/**
 * A service's next step, only where one exists: its own page on the finished site; else the business's booking
 * destination; else the page's own contact section. Nothing is invented (no offer, no link Roger hasn't verified).
 */
function serviceAction(c: RenderCtx, x: { id: string; name: string }) {
  const own = c.serviceLinks?.[x.id];
  if (own) return `<a class="svc-go" href="${esc(own.href)}">${esc(own.label)}</a>`;
  const book = c.cat.actions.find((a) => a.kind === 'book');
  if (book) return `<a class="svc-go" href="${esc(book.href)}"${ext(book.href)} data-action="${esc(book.id)}">${esc(book.label)}</a>`;
  if (c.concept.sections.some((sec) => sec.kind === 'contact')) return `<a class="svc-go" href="#visit">Ask about ${esc(x.name)}</a>`;
  return '';
}
function offerCards(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const items = ordered(cat.items, s.factIds).slice(0, 9);
    return `<section class="sec offer oc" id="offer" data-kind="offer" data-variant="cards"><div class="wrap">${head(s)}<ul class="oc__grid">${items.map((i) => `<li class="oc__card oc__card--menu" data-fact="${esc(i.id)}"><div class="oc__top"><h3>${esc(i.name)}</h3>${price(i)}</div>${i.description ? `<p>${esc(i.description)}</p>` : ''}${tags(i.tags)}</li>`).join('')}</ul>${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  const pictured = svc.every((x) => fresh(c, [x.imageId]));
  return `<section class="sec offer oc" id="offer" data-kind="offer" data-variant="cards"><div class="wrap">${head(s)}<ul class="oc__grid">${svc.map((x, i) => `<li class="oc__card" data-fact="${esc(x.id)}">${pictured ? `<div class="oc__img">${image(c, x.imageId)}</div>` : `<div class="oc__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div>`}<h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 220))}</p>` : ''}${serviceAction(c, x)}</li>`).join('')}</ul></div></section>`;
}
function offerBoard(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const sections = [...new Set(cat.items.map((i) => i.section ?? ''))];
    return `<section class="sec offer ob ob--menu" id="offer" data-kind="offer" data-variant="board"><div class="wrap">${head(s)}<div class="ob__cols">${sections.map((sec) => `<div class="ob__group">${sec ? `<h3>${esc(sec)}</h3>` : ''}<ul>${cat.items.filter((i) => (i.section ?? '') === sec).map((i) => `<li data-fact="${esc(i.id)}"><div class="ob__row"><span class="ob__name">${esc(i.name)}</span><span class="ob__dots" aria-hidden="true"></span>${price(i)}</div>${i.description ? `<p>${esc(firstSentences(i.description, 140))}</p>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  return `<section class="sec offer ob" id="offer" data-kind="offer" data-variant="board"><div class="wrap">${head(s)}<ol class="ob__index">${svc.map((x, i) => `<li data-fact="${esc(x.id)}"><span class="ob__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 180))}</p>` : ''}${serviceAction(c, x)}</div></li>`).join('')}</ol></div></section>`;
}
function offerRows(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const groups = [...new Set(cat.items.map((i) => i.section ?? ''))];
    return `<section class="sec offer or or--menu" id="offer" data-kind="offer" data-variant="rows"><div class="wrap">${head(s)}${groups.map((g, gi) => {
      const its = ordered(cat.items.filter((i) => (i.section ?? '') === g), s.factIds);
      const tied = fresh(c, [cat.sectionImages[`section:${g}`]]);
      return `<article class="or__row${tied ? (gi % 2 ? ' or__row--flip' : '') : ' or__row--text'}" data-fact="section:${esc(g)}">${tied ? `<div class="or__media">${image(c, tied)}</div>` : ''}<div class="or__text">${g ? `<h3>${esc(g)}</h3>` : ''}<ul class="or__list">${its.slice(0, 8).map((i) => `<li data-fact="${esc(i.id)}"><span>${esc(i.name)}</span>${price(i)}</li>`).join('')}</ul>${its.length > 8 ? '<p class="or__more">More on the full menu.</p>' : ''}</div></article>`;
    }).join('')}${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  const top = svc.slice(0, 3), rest = svc.slice(3);
  return `<section class="sec offer or" id="offer" data-kind="offer" data-variant="rows"><div class="wrap">${head(s)}${top.map((x, i) => `${(() => { const pic = fresh(c, [x.imageId]); return `<article class="or__row${pic ? (i % 2 ? ' or__row--flip' : '') : ' or__row--text'}" data-fact="${esc(x.id)}">${pic ? `<div class="or__media">${image(c, x.imageId)}</div>` : ''}<div class="or__text">${pic ? '' : `<p class="or__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>`}<h3>`; })()}${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 320))}</p>` : ''}</div></article>`).join('')}${rest.length ? `<div class="or__also"><h3>Also</h3><ul>${rest.map((x) => `<li data-fact="${esc(x.id)}">${esc(x.name)}</li>`).join('')}</ul></div>` : ''}</div></section>`;
}

// ───────────────────────── proof ─────────────────────────
function proofRatingBand(c: RenderCtx, s: ComposedSection) {
  const r = c.cat.rating;
  const reviews = c.cat.actions.find((a) => a.kind === 'reviews');
  const claims = [...c.cat.claims, ...c.cat.pledges].filter((x) => s.factIds.includes(x.id));
  return `<section class="sec proof pr tone-deep" id="proof" data-kind="proof" data-variant="rating-band"><div class="wrap pr__grid"><div>${head(s)}${reviews ? `<p>${linkTo(reviews, 'btn btn--invert')}</p>` : ''}</div>
  ${r ? `<div class="pr__score" data-fact="rating"><p class="pr__num">${r.value}</p>${stars(r.value)}<p class="pr__of">${ratingLine(c)}</p></div>` : ''}
  ${claims.length ? `<ul class="pr__claims">${claims.map((x) => `<li data-fact="${esc(x.id)}">${esc(x.text)}</li>`).join('')}</ul>` : ''}</div></section>`;
}
function proofPledges(c: RenderCtx, s: ComposedSection) {
  const items = [...c.cat.claims, ...c.cat.pledges].filter((x) => s.factIds.includes(x.id));
  const r = c.cat.rating;
  return `<section class="sec proof pp" id="proof" data-kind="proof" data-variant="pledges"><div class="wrap">${head(s)}${r ? `<p class="pp__rating" data-fact="rating">${stars(r.value)} ${ratingLine(c)}</p>` : ''}
  <ul class="pp__grid">${items.map((x, i) => `<li data-fact="${esc(x.id)}"><span class="pp__mark" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><p>${esc(x.text)}</p></li>`).join('')}</ul></div></section>`;
}
function proofStats(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  const stats = [
    cat.rating ? { n: String(cat.rating.value), l: 'Google rating', f: 'rating' } : null,
    cat.rating ? { n: fmt(cat.rating.count), l: cat.rating.scope ? `Google reviews of the ${cat.rating.scope}` : 'Google reviews', f: 'rating' } : null,
    cat.locations.length > 1 ? { n: String(cat.locations.length), l: 'locations', f: 'locations' } : cat.area && cat.area.length > 1 ? { n: String(cat.area.length), l: 'towns served', f: 'area' } : null,
    cat.items.length > 1 ? { n: String(cat.items.length), l: 'dishes and drinks on the menu', f: 'menu' } : cat.services.length > 1 ? { n: String(cat.services.length), l: 'services', f: 'services' } : null,
  ].filter(Boolean) as { n: string; l: string; f: string }[];
  return `<section class="sec proof ps" id="proof" data-kind="proof" data-variant="stat-strip"><div class="wrap">${head(s)}<dl class="ps__row">${stats.map((x) => `<div data-fact="${x.f}"><dt>${esc(x.l)}</dt><dd style="--n:${x.n.length}">${esc(x.n)}</dd></div>`).join('')}</dl></div></section>`;
}

// ───────────────────────── gallery ─────────────────────────
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'our', 'your', 'around', 'recent', 'latest', 'work', 'photos', 'photo', 'pictures', 'gallery', 'look', 'take', 'inside', 'see', 'some', 'what', 'we', 'do', 'done', 'jobs', 'projects', 'here', 'more', 'a', 'of', 'in', 'on', 'at', 'to', 'by', 'up', 'out']);
const stem = (w: string) => w.toLowerCase().replace(/(ing|ings|ed|es|s)$/, '');
const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));
/**
 * Photos under a gallery heading must fit what it says. A generic heading ("Photos", "Take a look around") takes any of
 * the business's photos; a specific one ("Recent roofing work") only those whose own evidence (alt text, the service
 * the website ties them to) shares its subject. Unclear: left out, never placed under a misleading heading.
 */
export function galleryFits(c: RenderCtx, s: ComposedSection, ids: string[]): string[] {
  const where = new Set([...words(c.cat.business.name), ...(c.cat.area ?? []).flatMap((a) => [...words(a)]), ...words(c.cat.address?.formatted ?? '')]);
  const kind = words(c.cat.business.category ?? '');
  const topic = [...words(`${s.title ?? ''} ${s.intro ?? ''}`)].filter((w) => !where.has(w));
  // a heading that only names the business or what it is ("Inside the bakery") is generic: any of its photos fit
  if (!topic.length || topic.every((w) => kind.has(w))) return ids;
  return ids.filter((id) => {
    const p = c.img(id)?.photo;
    if (!p) return false;
    // the services the website ties it to (recorded by id or by name)
    const ev = words([p.alt, ...p.services.map((sid) => c.cat.services.find((x) => x.id === sid)?.name ?? sid)].join(' '));
    return topic.some((w) => ev.has(w));
  });
}
function galleryMosaic(c: RenderCtx, s: ComposedSection) {
  const ids = galleryFits(c, s, s.imageIds.filter((id) => c.img(id)));
  const n = ids.length >= 8 ? 8 : Math.min(5, ids.length);
  return `<section class="sec gallery gm gm--${n}" id="gallery" data-kind="gallery" data-variant="mosaic"><div class="wrap">${head(s)}<div class="gm__grid">${ids.slice(0, n).map((id, i) => `<figure class="gm__i gm__i--${i + 1}">${image(c, id)}</figure>`).join('')}</div></div></section>`;
}
function galleryFilmstrip(c: RenderCtx, s: ComposedSection) {
  return `<section class="sec gallery gf" id="gallery" data-kind="gallery" data-variant="filmstrip"><div class="wrap">${head(s)}</div><div class="gf__strip" role="region" aria-label="Photos" tabindex="0">${galleryFits(c, s, s.imageIds).slice(0, 8).map((id) => `<figure>${image(c, id)}</figure>`).join('')}</div></section>`;
}
function galleryFeature(c: RenderCtx, s: ComposedSection) {
  return `<section class="sec gallery gg" id="gallery" data-kind="gallery" data-variant="feature-grid"><div class="wrap">${head(s)}<div class="gg__grid">${galleryFits(c, s, s.imageIds).slice(0, 5).map((id, i) => `<figure class="gg__i${i === 0 ? ' gg__i--big' : ''}">${image(c, id)}</figure>`).join('')}</div></div></section>`;
}

// ───────────────────────── story ─────────────────────────
function storyColumns(c: RenderCtx, s: ComposedSection) {
  const text = copyOf(c, 'story.text');
  const first = firstSentences(text, 180);
  const rest = text.slice(first.length).trim();
  return `<section class="sec story sc" id="story" data-kind="story" data-variant="columns"><div class="wrap">${head(s)}<blockquote class="sc__pull" data-fact="story"><p>${esc(first)}</p></blockquote>${rest ? `<div class="sc__cols" data-fact="story">${rest.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}</div></section>`;
}
function storyPortrait(c: RenderCtx, s: ComposedSection) {
  const text = copyOf(c, 'story.text');
  return `<section class="sec story sp" id="story" data-kind="story" data-variant="portrait"><div class="wrap sp__grid"><figure class="sp__media">${image(c, s.imageIds[0])}</figure><div>${head(s)}<div class="sp__text" data-fact="story">${text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div></div></div></section>`;
}

// ───────────────────────── contact ─────────────────────────
function contactRows(c: RenderCtx) {
  const cat = c.cat;
  return [
    cat.address ? `<div data-fact="${esc(cat.address.id)}"><dt>Address</dt><dd>${esc(cat.address.formatted)}${(() => { const d = cat.actions.find((a) => a.id === `dir-${cat.address!.id}`); return d ? `<br>${linkTo(d)}` : ''; })()}</dd></div>` : '',
    cat.phone ? `<div data-fact="phone"><dt>Phone</dt><dd><a class="link" href="${cat.phone.href}">${esc(cat.phone.display)}</a></dd></div>` : '',
    cat.email ? `<div data-fact="email"><dt>Email</dt><dd><a class="link" href="mailto:${esc(cat.email)}">${esc(cat.email)}</a></dd></div>` : '',
    cat.hours ? `<div data-fact="hours"><dt>Hours</dt><dd><ul class="hours">${cat.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></dd></div>` : '',
    cat.area ? `<div data-fact="area"><dt>Serving</dt><dd>${esc(cat.area.join(', '))}</dd></div>` : '',
  ].filter(Boolean).join('');
}
function locationCards(c: RenderCtx) {
  return `<ul class="loc__grid">${c.cat.locations.map((l) => { const d = c.cat.actions.find((a) => a.id === l.directions); return `<li data-fact="${esc(l.id)}"><p class="loc__street">${esc(l.street)}</p><p>${esc(l.cityLine)}</p>${d ? linkTo(d, 'btn btn--ghost btn--small') : ''}</li>`; }).join('')}</ul>`;
}
function contactPanel(c: RenderCtx, s: ComposedSection) {
  const rows = contactRows(c);
  const more = others(c, ['menu', 'book', 'email', 'site']);
  return `<section class="sec contact cp" id="visit" data-kind="contact" data-variant="panel"><div class="wrap cp__grid"><div>${head(s)}${rows ? `<dl class="cp__dl">${rows}</dl>` : ''}${!c.cat.address && c.cat.locations.length > 1 ? locationCards(c) : ''}</div>
  <aside class="cp__card"><p class="cp__name">${esc(c.cat.business.name)}</p>${c.cat.business.category ? `<p>${esc(c.cat.business.category)}</p>` : ''}<div class="actions actions--stack">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}${more.slice(0, 2).map((a) => linkTo(a, 'btn btn--ghost')).join('')}</div></aside></div></section>`;
}
function contactLocations(c: RenderCtx, s: ComposedSection) {
  const rows = contactRows(c);
  return `<section class="sec contact cl" id="visit" data-kind="contact" data-variant="locations"><div class="wrap">${head(s)}${c.cat.locations.length ? locationCards(c) : ''}${rows ? `<dl class="cl__dl">${rows}</dl>` : ''}<div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}</div></div></section>`;
}
function contactBand(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  const big = cat.phone ? `<p class="cb__big" data-fact="phone"><a href="${cat.phone.href}">${esc(cat.phone.display)}</a></p>` : '';
  return `<section class="sec contact cb tone-deep" id="visit" data-kind="contact" data-variant="band"><div class="wrap">${head(s)}${big}<div class="actions">${btn(action(c, 'primary'), 'invert')}${btn(action(c, 'secondary'), 'ghost')}</div>
  <dl class="cb__dl">${contactRows(c).replace(/<div data-fact="phone">.*?<\/div>/, cat.phone && big ? '' : '$&')}</dl>${!cat.address && cat.locations.length > 1 ? locationCards(c) : ''}</div></section>`;
}

export const RENDERERS: Record<string, (c: RenderCtx, s: ComposedSection) => string> = {
  'hero:full-bleed': heroFullBleed, 'hero:split': heroSplit, 'hero:type-collage': heroTypeCollage,
  'offer:cards': offerCards, 'offer:board': offerBoard, 'offer:rows': offerRows,
  'proof:rating-band': proofRatingBand, 'proof:pledges': proofPledges, 'proof:stat-strip': proofStats,
  'gallery:mosaic': galleryMosaic, 'gallery:filmstrip': galleryFilmstrip, 'gallery:feature-grid': galleryFeature,
  'story:columns': storyColumns, 'story:portrait': storyPortrait,
  'contact:panel': contactPanel, 'contact:locations': contactLocations, 'contact:band': contactBand,
};

// ───────────────────────── styles ─────────────────────────
export function baseCss(t: DesignTokens) {
  const c = t.colors;
  return `:root{--cw:${capWidth(t.fonts.heading.family).toFixed(2)};--bg:${c.bg};--surface:${c.surface};--ink:${c.ink};--muted:${c.muted};--line:${c.line};--brand:${c.brand};--onBrand:${c.onBrand};--brandText:${c.brandText};--accent:${c.accent};--onAccent:${c.onAccent};--action:${c.action};--onAction:${c.onAction};--deep:${c.deep};--onDeep:${c.onDeep};--r:${t.radius}px;--sp:${t.space};--hf:${t.fonts.heading.css};--bf:${t.fonts.body.css};--hw:${t.fonts.heading.weight};--case:${t.headingCase}}
*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.6 var(--bf);-webkit-font-smoothing:antialiased}
img{display:block;max-width:100%;height:auto}figure{margin:0}ul,ol,dl,dd{margin:0;padding:0;list-style:none}p{margin:0 0 1em}
h1,h2,h3{font-family:var(--hf);font-weight:var(--hw);line-height:1.04;margin:0;text-transform:var(--case);letter-spacing:-.012em;text-wrap:balance;overflow-wrap:break-word;hyphens:manual}
/* a wide display face or a long price never pushes a grid column past the page */
.oc__card,.or__text,.or__media,.loc__grid li,.pp__grid li,.ob__index li,.ob__group,.cp__grid>*,.hs__grid>*,.ht__grid>*,.sp__grid>*{min-width:0}
h2{font-size:clamp(2rem,4.2vw,3.4rem);margin-bottom:.45em}h3{font-size:1.3rem;line-height:1.2}${DISPLAY_ONLY.has(t.fonts.heading.family) ? '/* (body-prefixed: it must win over the variant styles that come after it) */body h3,body .brand__word,body .pp__grid p,body .sc__pull,body .loc__street,body .cp__name,body .site-foot__name,body .ob__n,body .oc__num{font-family:var(--bf);font-weight:700}' : ''}
.wrap{width:min(1200px,100% - 2*clamp(20px,4vw,48px));margin-inline:auto}
.sec{padding-block:calc(clamp(64px,8.5vw,120px)*var(--sp))}.sec:nth-of-type(even):not(.tone-deep){background:var(--surface)}
.sec-head{max-width:760px;margin-bottom:calc(40px*var(--sp))}.intro{color:var(--muted);font-size:1.15rem;max-width:62ch}
.tone-deep{background:var(--deep);color:var(--onDeep)}.tone-deep .intro{color:var(--onDeep)}
.eyebrow{font:700 .8rem/1.3 var(--bf);letter-spacing:.16em;text-transform:uppercase;margin:0 0 1.1rem}
.lede{font-size:clamp(1.1rem,1.5vw,1.3rem);max-width:48ch}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.actions--stack{flex-direction:column;align-items:stretch}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.7rem 1.35rem;border-radius:var(--r);font:700 1rem/1.2 var(--bf);text-decoration:none;border:2px solid transparent;transition:background-color .2s,color .2s,border-color .2s;text-align:center}
.btn--small{min-height:44px;padding:.5rem 1rem;font-size:.92rem}
.btn--primary{background:var(--action);color:var(--onAction)}.btn--primary:hover{filter:brightness(1.06)}
.btn--ghost{border-color:currentColor;color:inherit;background:transparent}.btn--ghost:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.btn--invert{background:#FFFFFF;color:#111316}.btn--invert-light{background:#FFFFFF;color:#111316}.btn--deep{background:var(--deep);color:var(--onDeep)}
.link{color:var(--brandText);font-weight:600;text-underline-offset:3px}.tone-deep .link{color:var(--onDeep)}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip{position:absolute;left:-9999px;top:8px;background:#fff;color:#000;padding:12px 16px;z-index:50}.skip:focus{left:8px}
.stars{display:inline-flex;gap:2px;vertical-align:-3px;color:#F2B01E}.tone-deep .stars{color:#FFD15C}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.chips li{display:inline-flex;align-items:center;gap:8px;padding:.45rem .85rem;border:1px solid var(--line);border-radius:999px;font-size:.95rem}.chips--light li{border-color:rgba(255,255,255,.55)}
.more{margin-top:32px;display:flex;flex-wrap:wrap;gap:12px}
/* header */
.site-head{position:relative;z-index:5}.site-head__in{display:flex;align-items:center;gap:24px;min-height:76px}.brand{display:inline-flex;align-items:center;min-height:44px;color:inherit;text-decoration:none;margin-right:auto}
.brand__word{font:var(--hw) 1.25rem/1 var(--hf);text-transform:var(--case)}.brand__logo{height:44px;width:auto;max-width:200px;object-fit:contain}
.site-head nav ul{display:flex;gap:4px}.site-head nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;color:inherit;text-decoration:none;font-weight:600}.site-head nav a:hover{text-decoration:underline}
.site-head--overlay{position:absolute;inset:0 0 auto 0;color:#fff}.site-head--bar{background:var(--surface);border-bottom:1px solid var(--line)}
.site-head--center .site-head__in{justify-content:space-between}.site-head--center{background:var(--brand);color:var(--onBrand)}
/* footer */
.site-foot{background:var(--deep);color:var(--onDeep);padding:56px 0 40px;font-size:.95rem}.site-foot__in{display:grid;grid-template-columns:1fr 1fr;gap:24px}.site-foot a{color:inherit}.site-foot__name{font:var(--hw) 1.35rem/1.1 var(--hf);text-transform:var(--case)}.site-foot__note{grid-column:1/-1;border-top:1px solid color-mix(in srgb,var(--onDeep) 30%,transparent);padding-top:20px;margin:8px 0 0}
.lbl-s{display:none}
.menu-btn{display:none}
@media (max-width:760px){.site-head nav{display:none}.menu-btn{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:0 14px;margin-left:auto;border:2px solid currentColor;border-radius:var(--r);background:transparent;color:inherit;font:700 .95rem/1 var(--bf);cursor:pointer}.site-head[data-menu=open] nav{display:block;position:absolute;left:0;right:0;top:100%;background:var(--surface);color:var(--ink);border-bottom:1px solid var(--line);box-shadow:0 14px 28px rgba(0,0,0,.14)}.site-head[data-menu=open] nav ul{flex-direction:column;padding:8px clamp(20px,4vw,48px) 16px}.site-foot__in{grid-template-columns:1fr}.site-head .lbl-l{display:none}.site-head .lbl-s{display:inline}.site-head [data-hide-sm]{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}`;
}

export const VARIANT_CSS: Record<string, string> = {
  'svc-go': `.svc-go{margin-top:auto;padding-top:6px;font-weight:700;color:var(--brandText);text-decoration:underline;text-underline-offset:3px;min-height:44px;display:inline-flex;align-items:center}`,
  'hero:full-bleed': `.hb{position:relative;min-height:clamp(600px,94vh,900px);display:flex;align-items:flex-end;color:#fff;overflow:hidden;isolation:isolate}
.hb__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.hb__scrim{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(11,12,16,.66) 0%,rgba(11,12,16,.6) 45%,rgba(11,12,16,.84) 100%)}
.hb__body{padding-block:150px calc(76px*var(--sp))}.hb h1{font-size:min(clamp(2.7rem,6.6vw,6.2rem),calc(min(860px,92vw) / var(--fit,8)));max-width:max(13ch,calc(var(--fit,8) * 1em));line-height:.98}.hb .lede{margin-top:22px;color:#F1F2F4}
@media (max-width:760px){.hb{min-height:88vh}.hb__body{padding-block:120px 48px}}`,
  'hero:split': `.hs{background:var(--surface);padding-block:calc(56px*var(--sp)) calc(88px*var(--sp))}.hs__grid{display:grid;grid-template-columns:1.08fr .92fr;gap:clamp(32px,6vw,88px);align-items:center}
.hs h1{font-size:min(clamp(2.5rem,5.2vw,4.8rem),calc(min(620px,88vw) / var(--fit,8)));color:var(--ink)}.hs .eyebrow{color:var(--brandText)}.hs .lede{margin-top:20px;color:var(--muted)}
.hs__facts{display:grid;gap:14px;margin-top:36px;padding-top:24px;border-top:1px solid var(--line)}.hs__facts div{display:grid;grid-template-columns:130px 1fr;gap:12px}.hs__facts dt{font-weight:700;color:var(--muted);font-size:.9rem;text-transform:uppercase;letter-spacing:.08em}
.hs__media{position:relative}.hs__media::before{content:"";position:absolute;inset:22px -22px -22px 22px;background:var(--brand);border-radius:var(--r);z-index:0}.hs__media img{position:relative;z-index:1;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}
@media (max-width:860px){.hs__grid{grid-template-columns:1fr}.hs__media{margin:28px 22px 0 0}.hs__media img{aspect-ratio:16/10}.hs__facts div{grid-template-columns:1fr;gap:2px}}`,
  'hero:type-collage': `.ht{background:var(--brand);color:var(--onBrand);padding-top:calc(40px*var(--sp));overflow:hidden}.ht__grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(340px,.9fr);gap:48px;align-items:center;padding-bottom:calc(72px*var(--sp))}
.ht h1{font-size:min(clamp(3rem,7.2vw,7rem),calc(min(640px,50vw) / var(--fit,8)));line-height:.92;letter-spacing:-.025em}
@media (max-width:860px){.ht h1{font-size:min(clamp(2.6rem,11vw,4.5rem),calc((100vw - 48px) / var(--fit,8)))}}.ht .lede{margin-top:26px}
.ht__collage{display:grid;grid-template-columns:1.1fr .9fr;grid-template-rows:210px 210px;gap:16px}.ht__pic{overflow:hidden;border:6px solid var(--bg);border-radius:var(--r)}.ht__pic img{width:100%;height:100%;object-fit:cover}
.ht__pic--1{grid-row:1/3;transform:rotate(-2.5deg)}.ht__pic--2{transform:rotate(2deg) translateY(18px)}.ht__pic--3{transform:rotate(-1deg)}
.ht__ticker{background:var(--deep);color:var(--onDeep);overflow:hidden;white-space:nowrap;padding:18px 0}.ht__ticker p{margin:0;font:var(--hw) clamp(1.2rem,2.2vw,1.75rem)/1 var(--hf);text-transform:uppercase}.ht__ticker span{margin:0 18px}.ht__ticker span::after{content:"\\2022";margin-left:36px}
@media (max-width:860px){.ht__grid{grid-template-columns:1fr}.ht__collage{grid-template-columns:repeat(3,1fr);grid-template-rows:150px}.ht__pic--1{grid-row:auto}.ht__pic--2{transform:rotate(2deg)}}`,
  'offer:cards': `.oc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}.oc__card{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:22px;display:flex;flex-direction:column;gap:10px}
.sec:nth-of-type(odd) .oc__card{background:var(--surface)}.oc__img{margin:-22px -22px 6px;overflow:hidden;border-radius:var(--r) var(--r) 0 0}.oc__img img{width:100%;aspect-ratio:4/3;object-fit:cover}
.oc__num{font:var(--hw) 2.6rem/1 var(--hf);color:var(--brandText)}.oc__card p{color:var(--muted);margin:0}.oc__top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;align-items:baseline}.price{font-weight:700}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tags li{font-size:.8rem;font-weight:700;padding:.2rem .6rem;border-radius:999px;background:var(--brand);color:var(--onBrand)}`,
  'offer:board': `.ob__index{display:grid;grid-template-columns:repeat(2,1fr);gap:0 56px}.ob__index li{display:grid;grid-template-columns:72px 1fr;gap:18px;padding:26px 0;border-top:2px solid var(--ink)}
.ob__n{font:var(--hw) 2.4rem/1 var(--hf);color:var(--brandText)}.ob__index p{color:var(--muted);margin:.5em 0 0}
.ob__cols{columns:2 320px;column-gap:64px}.ob__group{break-inside:avoid;margin-bottom:40px}.ob__group h3{font-size:1.6rem;border-bottom:3px solid var(--ink);padding-bottom:10px;margin-bottom:8px}
.ob__group li{padding:12px 0;border-bottom:1px solid var(--line);break-inside:avoid}.ob__row{display:flex;align-items:baseline;gap:10px}.ob__name{font-weight:700}.ob__dots{flex:1;border-bottom:2px dotted var(--muted);transform:translateY(-4px)}.ob__group p{color:var(--muted);font-size:.95rem;margin:.3em 0 0}
@media (max-width:760px){.ob__index{grid-template-columns:1fr}}`,
  'offer:rows': `.or__row{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,72px);align-items:center;margin-bottom:calc(64px*var(--sp))}.or__row--flip .or__media{order:2}
.or__media img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--r)}
/* a service or menu section with no picture of its own: a tinted text row, never a stand-in photo */
.or__row--text{grid-template-columns:1fr;background:color-mix(in srgb,var(--brand) 7%,var(--bg));border-left:6px solid var(--brand);border-radius:var(--r);padding:clamp(24px,4vw,44px);margin-bottom:calc(40px*var(--sp))}.or__row--text+.or__row--text{margin-top:calc(-20px*var(--sp))}
.or__row--text .or__text{max-width:72ch}.or__row--text .or__list{columns:2 240px;column-gap:40px}.or__row--text .or__list li{break-inside:avoid}
.or__num{font:var(--hw) 1rem/1 var(--hf);letter-spacing:.12em;color:var(--brandText);margin:0 0 10px}.or__text h3{font-size:clamp(1.6rem,2.6vw,2.3rem);margin-bottom:14px}.or__text p{color:var(--muted)}
.or__list li{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-weight:600}.or__more{color:var(--muted);margin-top:12px}
.or__also{border-top:2px solid var(--ink);padding-top:22px}.or__also ul{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.or__also li{padding:.5rem 1rem;border:1px solid var(--line);border-radius:999px;font-weight:600}
@media (max-width:760px){.or__row{grid-template-columns:1fr}.or__row--flip .or__media{order:0}}`,
  'proof:rating-band': `.pr__grid{display:grid;grid-template-columns:1.2fr 1fr;gap:40px 72px;align-items:center}.pr__score{text-align:left}.pr__num{font:var(--hw) clamp(5rem,12vw,9rem)/.85 var(--hf);margin:0 0 12px}.pr__score .stars svg{width:30px;height:30px}.pr__of{margin-top:12px;font-size:1.1rem}
.pr__claims{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px 32px;border-top:1px solid color-mix(in srgb,var(--onDeep) 35%,transparent);padding-top:28px;font-weight:700;font-size:1.1rem}.pr__claims li::before{content:"\\2713";margin-right:10px}
@media (max-width:760px){.pr__grid{grid-template-columns:1fr}}`,
  'proof:pledges': `.pp__rating{display:flex;align-items:center;gap:10px;font-weight:700;margin-bottom:32px}.pp__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.pp__grid li{border:2px solid var(--ink);border-radius:var(--r);padding:26px;background:var(--bg)}.pp__mark{display:block;font:var(--hw) 1rem/1 var(--hf);color:var(--brandText);margin-bottom:16px}.pp__grid p{font:var(--hw) 1.35rem/1.25 var(--hf);margin:0;text-transform:var(--case)}`,
  'proof:stat-strip': `.ps__row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));border-top:2px solid var(--ink)}.ps__row div{padding:28px 24px 8px 0;display:flex;flex-direction:column-reverse;gap:8px}
.ps__row div{container-type:inline-size}.ps__row dd{font:var(--hw) min(clamp(3rem,6vw,5rem),calc(100cqi / (var(--n,3) * var(--cw) * 1.05)))/.9 var(--hf);color:var(--brandText);white-space:nowrap}.ps__row dt{color:var(--muted);font-weight:600;max-width:24ch}`,
  'gallery:mosaic': `.gm__grid{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:190px;grid-auto-flow:dense;gap:12px}.gm__i{overflow:hidden;border-radius:var(--r)}.gm__i img{width:100%;height:100%;object-fit:cover}
.gm__i--1{grid-column:span 2;grid-row:span 2}.gm--8 .gm__i--4{grid-row:span 2}
@media (max-width:760px){.gm__grid{grid-template-columns:1fr 1fr;grid-auto-rows:140px}}`,
  'gallery:filmstrip': `.gf__strip{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 max(20px,calc((100% - 1200px)/2)) 18px;scrollbar-width:thin}.gf__strip figure{flex:0 0 auto;scroll-snap-align:start}
.gf__strip img{height:440px;width:auto;max-width:none;aspect-ratio:auto;object-fit:cover;border-radius:var(--r)}@media (max-width:760px){.gf__strip img{height:320px}}`,
  'gallery:feature-grid': `.gg__grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:260px 260px;gap:14px}.gg__i{overflow:hidden;border-radius:var(--r)}.gg__i img{width:100%;height:100%;object-fit:cover}.gg__i--big{grid-column:span 2;grid-row:span 2}
.gg__i:nth-child(n+4){display:none}@media (max-width:760px){.gg__grid{grid-template-columns:1fr 1fr;grid-template-rows:240px 160px}.gg__i--big{grid-column:1/-1;grid-row:auto}}`,
  'story:columns': `.sc__pull{margin:0 0 32px;font:var(--hw) clamp(1.6rem,3vw,2.5rem)/1.2 var(--hf);max-width:28ch;border-left:6px solid var(--brand);padding-left:24px}.sc__pull p{margin:0}.sc__cols{columns:2 300px;column-gap:56px;color:var(--muted)}`,
  'story:portrait': `.sp__grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:clamp(32px,6vw,80px);align-items:center}.sp__media img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:calc(var(--r)*2)}.sp__text{color:var(--muted);font-size:1.1rem}
@media (max-width:760px){.sp__grid{grid-template-columns:1fr}}`,
  'contact:panel': `.cp__grid{display:grid;grid-template-columns:1.3fr .7fr;gap:48px;align-items:start}.cp__dl{display:grid;gap:18px}.cp__dl div{display:grid;grid-template-columns:120px 1fr;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--line)}.cp__dl dt{font-weight:700}
.cp__card{background:var(--deep);color:var(--onDeep);border-radius:var(--r);padding:28px;position:sticky;top:24px}.cp__name{font:var(--hw) 1.6rem/1.1 var(--hf);text-transform:var(--case)}.hours li{padding:2px 0}
.loc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:24px}.loc__grid li{border:1px solid var(--line);border-radius:var(--r);padding:18px;background:var(--bg)}.loc__street{font-weight:700;margin:0}
@media (max-width:860px){.cp__grid{grid-template-columns:1fr}.cp__dl div{grid-template-columns:1fr;gap:4px}}`,
  'contact:locations': `.loc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}.loc__grid li{border-radius:var(--r);padding:22px;background:var(--brand);color:var(--onBrand)}.loc__grid li p{margin:0 0 4px}.loc__street{font:var(--hw) 1.25rem/1.2 var(--hf)}.loc__grid .btn{margin-top:14px}
.cl__dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-top:36px}.cl__dl dt{font-weight:700;margin-bottom:6px}.hours li{padding:2px 0}`,
  'contact:band': `.cb .cb__big{font:var(--hw) clamp(2.6rem,7vw,5.5rem)/1 var(--hf);margin:6px 0 10px}.cb__big a{color:inherit;text-decoration:none}.cb__dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-top:40px;border-top:1px solid color-mix(in srgb,var(--onDeep) 35%,transparent);padding-top:28px}.cb__dl dt{font-weight:700;margin-bottom:6px}
.cb .loc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:28px}.cb .loc__grid li{border:1px solid color-mix(in srgb,var(--onDeep) 40%,transparent);border-radius:var(--r);padding:18px}.cb .loc__grid p{margin:0 0 4px}.loc__street{font-weight:700}`,
};

/** The header's phone menu: the button opens and closes it, a chosen link or Escape closes it (aria-expanded kept in step). */
export const MENU_JS = "document.querySelectorAll('.site-head').forEach(function(h){var b=h.querySelector('.menu-btn'),n=h.querySelector('nav');if(!b||!n)return;function set(o){h.setAttribute('data-menu',o?'open':'closed');b.setAttribute('aria-expanded',String(o))}b.addEventListener('click',function(){set(b.getAttribute('aria-expanded')!=='true')});n.addEventListener('click',function(e){if(e.target.closest('a'))set(false)});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&b.getAttribute('aria-expanded')==='true'){set(false);b.focus()}})});";
