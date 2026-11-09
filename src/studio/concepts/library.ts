import type { Catalog, Photo } from './review.js';
import type { ComposedSection, Concept, ConceptAction, DesignTokens, FooterStyle, HeaderStyle } from './types.js';
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
const firstSentences = (t: string, max: number) => { const s = t.replace(/\s+/g, ' ').trim().match(/(?:[^.!?]|[.!?](?=\S))+[.!?]+(?=\s|$)/g) ?? [t]; let out = ''; for (const x of s) { if ((out + x).length > max && out) break; out += x; } return out.trim(); };

// ───────────────────────── header and footer ─────────────────────────
/** the header's action: the concept's primary one, with a one-word label for a phone (or none: the hero carries it) */
function headAction(c: RenderCtx, cls: string) {
  const p = action(c, 'primary');
  if (!p) return '';
  const kind = p.actionId === 'find-location' ? 'locations' : c.cat.actions.find((a) => a.id === p.actionId)?.kind;
  const short = kind === 'call' ? 'Call' : kind === 'book' ? 'Book' : kind === 'menu' ? 'View menu' : kind === 'directions' ? 'Directions' : kind === 'locations' ? 'Locations' : '';
  return `<a class="btn ${cls} btn--small" href="${esc(p.href)}"${ext(p.href)} data-action="${esc(p.actionId)}" aria-label="${esc(p.label)}"${short ? '' : ' data-hide-sm'}><span class="lbl-l">${esc(p.label)}</span><span class="lbl-s">${esc(short)}</span></a>`;
}
const brandMark = (c: RenderCtx, bg: string) => {
  const logoOk = !!c.cat.logo && c.img('logo') !== undefined && (c.cat.logo.colors.length ? Math.max(...c.cat.logo.colors.slice(0, 2).map((x) => contrast(x, bg))) >= 3 : true);
  return logoOk ? image(c, 'logo', 'brand__logo') : `<span class="brand__word">${esc(c.cat.business.name)}</span>`;
};
const navList = (nav: { href: string; label: string }[]) => `<nav id="site-menu" aria-label="Sections"><ul>${nav.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('')}</ul></nav>`;
const menuBtn = '<button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-menu">Menu</button>';
/** the first line of the opening hours that isn't "closed": what a dateline or a top strip shows */
const openLine = (c: RenderCtx) => (c.cat.hours ? c.cat.hours.find((h) => !/closed/i.test(h)) ?? c.cat.hours[0] : '');
const placeLine = (c: RenderCtx) => (c.cat.locations.length > 1 ? `${c.cat.locations.length} locations` : c.cat.locations[0]?.cityLine.replace(/\s\d{5}(-\d{4})?$/, '') ?? c.cat.area?.slice(0, 3).join(', ') ?? '');

/** A newspaper's top: a slim row (what it is, where), the name centred between rules, the sections below it. */
function headMasthead(c: RenderCtx, nav: { href: string; label: string }[]) {
  // the place only: the front page's dateline below carries what the business is and when it opens
  const line = placeLine(c);
  return `<header class="site-head site-head--masthead"><div class="wrap"><div class="site-head__in"><p class="mh__line">${esc(line)}</p><a class="brand" href="#top" aria-label="${esc(c.cat.business.name)}, top of the page">${brandMark(c, c.concept.tokens.colors.bg)}</a>${menuBtn}${headAction(c, 'btn--primary')}</div>${navList(nav)}</div></header>`;
}
/** A front desk's top: a strip of when and how to reach the business, then the brand, the sections and the action. */
function headUtility(c: RenderCtx, nav: { href: string; label: string }[]) {
  const cat = c.cat;
  const strip = [
    openLine(c) ? `<li data-fact="hours"><span class="u__k">Hours</span> ${esc(openLine(c))}</li>` : '',
    cat.phone ? `<li data-fact="phone"><a href="${cat.phone.href}">${esc(cat.phone.display)}</a></li>` : '',
    cat.address ? `<li data-fact="${esc(cat.address.id)}">${esc(cat.address.formatted.replace(/,\s*(USA|United States)$/, ''))}</li>` : cat.locations.length > 1 ? `<li data-fact="locations"><a href="#visit">${cat.locations.length} locations</a></li>` : '',
  ].filter(Boolean).join('');
  return `<header class="site-head site-head--utility">${strip ? `<div class="u__strip"><ul class="wrap">${strip}</ul></div>` : ''}<div class="wrap site-head__in"><a class="brand" href="#top" aria-label="${esc(cat.business.name)}, top of the page">${brandMark(c, c.concept.tokens.colors.surface)}</a>${menuBtn}${navList(nav)}${headAction(c, 'btn--primary')}</div></header>`;
}

export function siteHeader(c: RenderCtx, style: HeaderStyle, nav: { href: string; label: string }[]) {
  if (style === 'masthead') return headMasthead(c, nav);
  if (style === 'utility') return headUtility(c, nav);
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
  const short = kind === 'call' ? 'Call' : kind === 'book' ? 'Book' : kind === 'menu' ? 'View menu' : kind === 'directions' ? 'Directions' : kind === 'locations' ? 'Locations' : '';
  return `<header class="site-head site-head--${style}"${scrim}><div class="wrap site-head__in"><a class="brand" href="#top" aria-label="${esc(c.cat.business.name)}, top of the page">${brand}</a><button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-menu">Menu</button><nav id="site-menu" aria-label="Sections"><ul>${nav.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('')}</ul></nav>${p ? `<a class="btn btn--${style === 'overlay' ? 'invert-light' : style === 'center' ? 'deep' : 'primary'} btn--small" href="${esc(p.href)}"${ext(p.href)} data-action="${esc(p.actionId)}" aria-label="${esc(p.label)}"${short ? '' : ' data-hide-sm'}><span class="lbl-l">${esc(p.label)}</span><span class="lbl-s">${esc(short)}</span></a>` : ''}</div></header>`;
}

export function siteFooter(c: RenderCtx, style: FooterStyle = 'standard', nav: { href: string; label: string }[] = []) {
  const cat = c.cat;
  const where = cat.address ? esc(cat.address.formatted) : cat.locations.length > 1 ? `${cat.locations.length} locations` : cat.locations[0] ? esc(cat.locations[0].formatted) : '';
  const contact = [cat.phone ? `<a href="${cat.phone.href}">${esc(cat.phone.display)}</a>` : '', cat.email ? `<a href="mailto:${esc(cat.email)}">${esc(cat.email)}</a>` : ''].filter(Boolean).join(' · ');
  const site = cat.business.website ? new URL(cat.business.website).hostname.replace(/^www\./, '') : '';
  const note = `<p class="site-foot__note">A concept preview by Roger, not a published site. Its facts come from ${esc(site || 'the business')}${cat.rating ? ' and its Google listing' : ''}.</p>`;
  if (style === 'colophon') {
    // a newspaper's last page: the name set large across the page, then visit, contact and the page's own index
    return `<footer class="site-foot site-foot--colophon"><div class="wrap"><p class="cf__name">${esc(cat.business.name)}</p><div class="cf__cols">
      ${where || openLine(c) ? `<div><p class="cf__h">Visit</p>${where ? `<p>${where}</p>` : ''}${openLine(c) ? `<p data-fact="hours">${esc(openLine(c))}</p>` : ''}</div>` : ''}
      <div><p class="cf__h">Contact</p>${contact ? `<p>${contact}</p>` : `<p>${esc(cat.business.category ?? '')}</p>`}</div>
      ${nav.length ? `<div><p class="cf__h">On this page</p><ul>${nav.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('')}</ul></div>` : ''}
    </div>${note}</div></footer>`;
  }
  if (style === 'utility') {
    // a front desk's last word: the actions again, large, then the week's hours and where to find it
    const acts = [btn(action(c, 'primary'), 'invert'), btn(action(c, 'secondary'), 'ghost')].join('');
    return `<footer class="site-foot site-foot--utility"><div class="wrap">${acts.trim() ? `<div class="uf__acts"><p class="uf__ask">${esc(cat.business.name)}</p><div class="actions">${acts}</div></div>` : ''}<div class="uf__cols">
      ${cat.hours ? `<div data-fact="hours"><p class="cf__h">Hours</p><ul class="hours">${cat.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      <div><p class="cf__h">Find us</p>${where ? `<p>${where}</p>` : ''}${contact ? `<p>${contact}</p>` : ''}</div>
    </div>${note}</div></footer>`;
  }
  return `<footer class="site-foot"><div class="wrap site-foot__in"><div><p class="site-foot__name">${esc(cat.business.name)}</p>${cat.business.category ? `<p>${esc(cat.business.category)}</p>` : ''}</div><div>${where ? `<p>${where}</p>` : ''}${contact ? `<p>${contact}</p>` : ''}</div>${note}</div></footer>`;
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
  const pic = image(c, s.imageIds[0], '', true);
  return `<section class="hero hs${pic ? '' : ' hs--type'}" id="top" data-kind="hero" data-variant="split"><div class="wrap hs__grid"><div class="hs__text"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1><p class="lede">${esc(copyOf(c, 'hero.subline'))}</p>
  <div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}</div>${facts ? `<dl class="hs__facts">${facts}</dl>` : ''}</div>
  ${pic ? `<figure class="hs__media">${pic}</figure>` : ''}</div></section>`;
}
/** the business's own menu art (an image of its menu, never a lead image), above the menu it shows */
function menuArtHtml(c: RenderCtx, s: ComposedSection) {
  if (s.kind !== 'offer' || !c.cat.items.length) return '';
  const figs = s.imageIds.map((id) => image(c, id)).filter(Boolean);
  return figs.length ? `<div class="menu-art">${figs.map((f) => `<figure>${f}</figure>`).join('')}</div>` : '';
}
function heroTypeCollage(c: RenderCtx, s: ComposedSection) {
  const names = c.cat.items.length ? c.cat.items.map((i) => i.name) : c.cat.services.map((x) => x.name);
  const ticker = names.length ? `<div class="ht__ticker"><p>${[...names, ...names].slice(0, 18).map((n) => `<span>${esc(n)}</span>`).join('')}</p></div>` : '';
  const pics = s.imageIds.slice(0, 3).map((id, i) => `<figure class="ht__pic ht__pic--${i + 1}">${image(c, id, '', i === 0)}</figure>`).join('');
  return `<section class="hero ht" id="top" data-kind="hero" data-variant="type-collage"><div class="wrap ht__grid${pics ? "" : " ht__grid--type"}"><div class="ht__text"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1>
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
/**
 * A service layout shows the services' own verified photos (the website's picture for that service, or the owner's
 * choice) when most of them have one; each shows only its own, and the rest keep a text treatment, never a stand-in.
 */
function servicePhotosShown(c: RenderCtx, svc: { imageId?: string }[]) {
  const own = svc.filter((x) => fresh(c, [x.imageId])).length;
  return own >= 2 && own * 2 >= svc.length;
}
function offerCards(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const items = ordered(cat.items, s.factIds).slice(0, 9);
    return `<section class="sec offer oc" id="offer" data-kind="offer" data-variant="cards"><div class="wrap">${head(s)}${menuArtHtml(c, s)}<ul class="oc__grid">${items.map((i) => `<li class="oc__card oc__card--menu" data-fact="${esc(i.id)}"><div class="oc__top"><h3>${esc(i.name)}</h3>${price(i)}</div>${i.description ? `<p>${esc(i.description)}</p>` : ''}${tags(i.tags)}</li>`).join('')}</ul>${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  const pictured = servicePhotosShown(c, svc);
  return `<section class="sec offer oc" id="offer" data-kind="offer" data-variant="cards"><div class="wrap">${head(s)}<ul class="oc__grid">${svc.map((x, i) => `<li class="oc__card" data-fact="${esc(x.id)}">${pictured && fresh(c, [x.imageId]) ? `<div class="oc__img">${image(c, x.imageId)}</div>` : `<div class="oc__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div>`}<h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 220))}</p>` : ''}${serviceAction(c, x)}</li>`).join('')}</ul></div></section>`;
}
function offerBoard(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const sections = [...new Set(cat.items.map((i) => i.section ?? ''))];
    return `<section class="sec offer ob ob--menu" id="offer" data-kind="offer" data-variant="board"><div class="wrap">${head(s)}${menuArtHtml(c, s)}<div class="ob__cols">${sections.map((sec) => `<div class="ob__group">${sec ? `<h3>${esc(sec)}</h3>` : ''}<ul>${cat.items.filter((i) => (i.section ?? '') === sec).map((i) => `<li data-fact="${esc(i.id)}"><div class="ob__row"><span class="ob__name">${esc(i.name)}</span><span class="ob__dots" aria-hidden="true"></span>${price(i)}</div>${i.description ? `<p>${esc(firstSentences(i.description, 140))}</p>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  return `<section class="sec offer ob" id="offer" data-kind="offer" data-variant="board"><div class="wrap">${head(s)}<ol class="ob__index">${svc.map((x, i) => `<li data-fact="${esc(x.id)}"><span class="ob__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 180))}</p>` : ''}${serviceAction(c, x)}</div></li>`).join('')}</ol></div></section>`;
}
function offerRows(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const groups = [...new Set(cat.items.map((i) => i.section ?? ''))];
    return `<section class="sec offer or or--menu" id="offer" data-kind="offer" data-variant="rows"><div class="wrap">${head(s)}${menuArtHtml(c, s)}${groups.map((g, gi) => {
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
const STOP = new Set(['closer', 'the', 'and', 'for', 'from', 'with', 'our', 'your', 'around', 'recent', 'latest', 'work', 'photos', 'photo', 'pictures', 'gallery', 'look', 'take', 'inside', 'see', 'some', 'what', 'we', 'do', 'done', 'jobs', 'projects', 'here', 'more', 'a', 'of', 'in', 'on', 'at', 'to', 'by', 'up', 'out']);
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
/** a gallery with too few photos that fit is left off the page (and out of the menu), never shown as an empty section */
const MIN_GALLERY = 3;
/** a gallery shows photos not already on the page (the hero's, the story's, a service's own) */
const unseen = (c: RenderCtx, s: ComposedSection) => s.imageIds.filter((id) => c.img(id) && !c.used.has(id));
function galleryMosaic(c: RenderCtx, s: ComposedSection) {
  const ids = galleryFits(c, s, unseen(c, s));
  if (ids.length < MIN_GALLERY) return '';
  const n = ids.length >= 8 ? 8 : Math.min(5, ids.length);
  return `<section class="sec gallery gm gm--${n}" id="gallery" data-kind="gallery" data-variant="mosaic"><div class="wrap">${head(s)}<div class="gm__grid">${ids.slice(0, n).map((id, i) => `<figure class="gm__i gm__i--${i + 1}">${image(c, id)}</figure>`).join('')}</div></div></section>`;
}
function galleryFilmstrip(c: RenderCtx, s: ComposedSection) {
  const ids = galleryFits(c, s, unseen(c, s));
  if (ids.length < MIN_GALLERY) return '';
  return `<section class="sec gallery gf" id="gallery" data-kind="gallery" data-variant="filmstrip"><div class="wrap">${head(s)}</div><div class="gf__strip" role="region" aria-label="Photos" tabindex="0">${ids.slice(0, 8).map((id) => `<figure>${image(c, id)}</figure>`).join('')}</div></section>`;
}
function galleryFeature(c: RenderCtx, s: ComposedSection) {
  const ids = galleryFits(c, s, unseen(c, s));
  if (ids.length < MIN_GALLERY) return '';
  return `<section class="sec gallery gg" id="gallery" data-kind="gallery" data-variant="feature-grid"><div class="wrap">${head(s)}<div class="gg__grid">${ids.slice(0, 5).map((id, i) => `<figure class="gg__i${i === 0 ? ' gg__i--big' : ''}">${image(c, id)}</figure>`).join('')}</div></div></section>`;
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

// ───────────────────────── the front page (masthead) and the front desk ─────────────────────────
/**
 * A newspaper front page: a dateline between rules (what the business is, where, when it opens), the headline as the
 * masthead across the page, then the lead photograph beside the opening column and the page's own index.
 */
function heroMasthead(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  // what it is and when it opens (the header's line already says where)
  const dateline = [copyOf(c, 'hero.eyebrow') ? `<span>${esc(copyOf(c, 'hero.eyebrow'))}</span>` : '', openLine(c) ? `<span data-fact="hours">${esc(openLine(c))}</span>` : ''].filter(Boolean).join('');
  const toc = c.concept.sections.filter((x) => x.kind !== 'hero' && x.title).map((x) => `<li><a href="#${x.id}">${esc(x.title)}</a></li>`).join('');
  const lead = image(c, s.imageIds[0], '', true);
  return `<section class="hero hm" id="top" data-kind="hero" data-variant="masthead"><div class="wrap">${dateline ? `<p class="hm__dateline">${dateline}</p>` : ''}<h1 class="hm__title"${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1>
  <div class="hm__grid${lead ? '' : ' hm__grid--text'}">${lead ? `<figure class="hm__lead">${lead}</figure>` : ''}<div class="hm__col">${copyOf(c, 'hero.subline') ? `<p class="hm__deck">${esc(copyOf(c, 'hero.subline'))}</p>` : ''}
  ${cat.rating ? `<p class="hm__rating" data-fact="rating">${stars(cat.rating.value)} ${ratingLine(c)}</p>` : ''}<div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}</div>
  ${toc ? `<div class="hm__toc"><p class="hm__toc-h">On this page</p><ol>${toc}</ol></div>` : ''}</div></div></div></section>`;
}
/**
 * A front desk: the headline and the main action beside a panel of what a visitor needs first (when it opens, where it
 * is, how to reach it), with at most one photograph as a band below.
 */
function heroDesk(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  const dir = cat.address ? cat.actions.find((a) => a.id === `dir-${cat.address!.id}`) : undefined;
  const rows = [
    cat.hours ? `<div data-fact="hours"><dt>Hours</dt><dd><ul class="hours">${cat.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></dd></div>` : '',
    cat.address ? `<div data-fact="${esc(cat.address.id)}"><dt>Address</dt><dd>${esc(cat.address.formatted)}${dir ? `<br>${linkTo(dir)}` : ''}</dd></div>` : cat.locations.length > 1 ? `<div data-fact="locations"><dt>Locations</dt><dd>${cat.locations.length} locations. <a class="link" href="#visit">Find a location</a></dd></div>` : '',
    cat.phone ? `<div data-fact="phone"><dt>Phone</dt><dd><a class="link" href="${cat.phone.href}">${esc(cat.phone.display)}</a></dd></div>` : '',
    cat.area ? `<div data-fact="area"><dt>Serving</dt><dd>${esc(cat.area.join(', '))}</dd></div>` : '',
  ].filter(Boolean).join('');
  const band = s.imageIds[0] ? image(c, s.imageIds[0]) : '';
  return `<section class="hero hd" id="top" data-kind="hero" data-variant="desk"><div class="wrap hd__grid"><div class="hd__text"><p class="eyebrow">${esc(copyOf(c, 'hero.eyebrow'))}</p><h1${fit(c)}>${esc(copyOf(c, 'hero.headline'))}</h1>${copyOf(c, 'hero.subline') ? `<p class="lede">${esc(copyOf(c, 'hero.subline'))}</p>` : ''}
  <div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}</div>${cat.rating ? `<p class="hd__rating" data-fact="rating">${stars(cat.rating.value)} ${ratingLine(c)}</p>` : ''}</div>
  ${rows ? `<aside class="hd__desk" aria-label="Visit details"><p class="hd__desk-h">Before you come</p><dl>${rows}</dl></aside>` : ''}</div>${band ? `<figure class="hd__band">${band}</figure>` : ''}</section>`;
}

/** A ruled ledger: each service or dish on its own line (name, description, price or next step), grouped under rules. */
function offerLedger(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const groups = [...new Set(cat.items.map((i) => i.section ?? ''))];
    return `<section class="sec offer lg" id="offer" data-kind="offer" data-variant="ledger"><div class="wrap">${head(s)}${menuArtHtml(c, s)}${groups.map((g) => `<div class="lg__group">${g ? `<h3 class="lg__sec">${esc(g)}</h3>` : ''}<ol class="lg__list">${ordered(cat.items.filter((i) => (i.section ?? '') === g), s.factIds).map((i) => `<li data-fact="${esc(i.id)}"><span class="lg__name">${esc(i.name)}</span><span class="lg__desc">${i.description ? esc(firstSentences(i.description, 160)) : ''}</span>${price(i) || '<span></span>'}</li>`).join('')}</ol></div>`).join('')}${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  return `<section class="sec offer lg lg--svc" id="offer" data-kind="offer" data-variant="ledger"><div class="wrap">${head(s)}<ol class="lg__list">${svc.map((x, i) => `<li data-fact="${esc(x.id)}"><span class="lg__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 200))}</p>` : ''}</div>${serviceAction(c, x)}</li>`).join('')}</ol></div></section>`;
}
/** Quick tiles: a row of chips to jump to each menu section, then compact tiles; services as tiles with their next step. */
function offerTiles(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  if (cat.items.length) {
    const groups = [...new Set(cat.items.map((i) => i.section ?? ''))];
    const jump = groups.length > 1 && groups.every(Boolean) ? `<nav class="tl__jump" aria-label="${esc(s.title || 'Menu')} sections"><ul>${groups.map((g, gi) => `<li><a href="#tl-${gi}">${esc(g)}</a></li>`).join('')}</ul></nav>` : '';
    return `<section class="sec offer tl" id="offer" data-kind="offer" data-variant="tiles"><div class="wrap">${head(s)}${menuArtHtml(c, s)}${jump}${groups.map((g, gi) => `<div class="tl__group" id="tl-${gi}">${g ? `<h3>${esc(g)}</h3>` : ''}<ul class="tl__grid">${ordered(cat.items.filter((i) => (i.section ?? '') === g), s.factIds).map((i) => `<li class="tl__tile" data-fact="${esc(i.id)}"><div class="tl__top"><span class="tl__name">${esc(i.name)}</span>${price(i)}</div>${i.description ? `<p>${esc(firstSentences(i.description, 90))}</p>` : ''}</li>`).join('')}</ul></div>`).join('')}${menuMore(c)}</div></section>`;
  }
  const svc = ordered(cat.services, s.factIds);
  const pictured = servicePhotosShown(c, svc);
  return `<section class="sec offer tl" id="offer" data-kind="offer" data-variant="tiles"><div class="wrap">${head(s)}<ul class="tl__grid tl__grid--svc">${svc.map((x) => `<li class="tl__tile${pictured && fresh(c, [x.imageId]) ? " tl__tile--pic" : ""}" data-fact="${esc(x.id)}">${pictured && fresh(c, [x.imageId]) ? `<div class="tl__img">${image(c, x.imageId)}</div>` : ""}<h3>${esc(x.name)}</h3>${x.description ? `<p>${esc(firstSentences(x.description, 120))}</p>` : ''}${serviceAction(c, x)}</li>`).join('')}</ul></div></section>`;
}
/** The week's opening hours as a large timetable beside where the business is, how to reach it, and its actions. */
function contactTimetable(c: RenderCtx, s: ComposedSection) {
  const cat = c.cat;
  // "Monday: 9:00 AM – 5:00 PM" → Monday | 9:00 AM – 5:00 PM (the day never holds a digit, so a time's colon is never split)
  const week = (cat.hours ?? []).map((h) => { const m = h.match(/^([^:\d]{2,24}):\s*(.+)$/); return m ? `<div><dt>${esc(m[1])}</dt><dd>${esc(m[2])}</dd></div>` : `<div><dd>${esc(h)}</dd></div>`; }).join('');
  const rows = contactRows(c).replace(/<div data-fact="hours">[\s\S]*?<\/ul><\/dd><\/div>/, '');
  const more = others(c, ['menu', 'book', 'email', 'site']);
  return `<section class="sec contact tt" id="visit" data-kind="contact" data-variant="timetable"><div class="wrap">${head(s)}<div class="tt__grid">${week ? `<div class="tt__week" data-fact="hours"><p class="tt__h">Opening hours</p><dl>${week}</dl></div>` : ''}
  <div class="tt__info">${rows ? `<dl class="tt__dl">${rows}</dl>` : ''}${!cat.address && cat.locations.length > 1 ? locationCards(c) : ''}<div class="actions">${btn(action(c, 'primary'), 'primary')}${btn(action(c, 'secondary'), 'ghost')}${more.slice(0, 2).map((a) => linkTo(a, 'btn btn--ghost')).join('')}</div></div></div></div></section>`;
}

export const RENDERERS: Record<string, (c: RenderCtx, s: ComposedSection) => string> = {
  'hero:full-bleed': heroFullBleed, 'hero:split': heroSplit, 'hero:type-collage': heroTypeCollage, 'hero:masthead': heroMasthead, 'hero:desk': heroDesk,
  'offer:cards': offerCards, 'offer:board': offerBoard, 'offer:rows': offerRows, 'offer:ledger': offerLedger, 'offer:tiles': offerTiles,
  'proof:rating-band': proofRatingBand, 'proof:pledges': proofPledges, 'proof:stat-strip': proofStats,
  'gallery:mosaic': galleryMosaic, 'gallery:filmstrip': galleryFilmstrip, 'gallery:feature-grid': galleryFeature,
  'story:columns': storyColumns, 'story:portrait': storyPortrait,
  'contact:panel': contactPanel, 'contact:locations': contactLocations, 'contact:band': contactBand, 'contact:timetable': contactTimetable,
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
@media (max-width:760px){.site-head nav{display:none}.menu-btn{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:0 14px;margin-left:auto;border:2px solid currentColor;border-radius:var(--r);background:transparent;color:inherit;font:700 .95rem/1 var(--bf);cursor:pointer}.site-head[data-menu=open] nav{display:block;position:absolute;left:0;right:0;top:100%;background:var(--surface);color:var(--ink);border-bottom:1px solid var(--line);box-shadow:0 14px 28px rgba(0,0,0,.14)}.site-head[data-menu=open] nav ul{flex-direction:column;padding:8px clamp(20px,4vw,48px) 16px}.site-foot__in{grid-template-columns:1fr}.site-head .lbl-l{display:none}.site-head .lbl-s{display:inline}.site-head [data-hide-sm]{display:none}
/* a wide logo gives way on a phone; the menu button and the action never shrink under their labels */
.site-head .menu-btn,.site-head__in>.btn{flex-shrink:0}.site-head .brand{min-width:0;flex:0 1 auto}.brand__logo{max-width:100%}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}`;
}

export const VARIANT_CSS: Record<string, string> = {
  'svc-go': `.menu-art{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 calc(32px*var(--sp))}.menu-art figure{position:relative;flex:1 1 240px;max-width:380px}.menu-art img{width:100%;height:auto;border-radius:var(--r)}
.svc-go{margin-top:auto;padding-top:6px;font-weight:700;color:var(--brandText);text-decoration:underline;text-underline-offset:3px;min-height:44px;display:inline-flex;align-items:center}`,
  'hero:full-bleed': `.hb{position:relative;min-height:clamp(600px,94vh,900px);display:flex;align-items:flex-end;color:#fff;overflow:hidden;isolation:isolate}
.hb__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.hb__scrim{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(11,12,16,.66) 0%,rgba(11,12,16,.6) 45%,rgba(11,12,16,.84) 100%)}
.hb__body{padding-block:150px calc(76px*var(--sp))}.hb h1{font-size:min(clamp(2.7rem,6.6vw,6.2rem),calc(min(860px,92vw) / var(--fit,8)));max-width:max(13ch,calc(var(--fit,8) * 1em));line-height:.98}.hb .lede{margin-top:22px;color:#F1F2F4}
@media (max-width:760px){.hb{min-height:88vh}.hb__body{padding-block:120px 48px}}`,
  'hero:split': `.hs{background:var(--surface);padding-block:calc(56px*var(--sp)) calc(88px*var(--sp))}.hs__grid{display:grid;grid-template-columns:1.08fr .92fr;gap:clamp(32px,6vw,88px);align-items:center}
.hs h1{font-size:min(clamp(2.5rem,5.2vw,4.8rem),calc(min(620px,88vw) / var(--fit,8)));color:var(--ink)}.hs .eyebrow{color:var(--brandText)}.hs .lede{margin-top:20px;color:var(--muted)}
.hs__facts{display:grid;gap:14px;margin-top:36px;padding-top:24px;border-top:1px solid var(--line)}.hs__facts div{display:grid;grid-template-columns:130px 1fr;gap:12px}.hs__facts dt{font-weight:700;color:var(--muted);font-size:.9rem;text-transform:uppercase;letter-spacing:.08em}
.hs--type .hs__grid{grid-template-columns:minmax(0,1fr);max-width:980px}.hs--type h1{font-size:min(clamp(2.6rem,6vw,5.6rem),calc(min(980px,100vw - 40px) / var(--fit,8)))}.hs--type .lede{max-width:60ch}
.hs__media{position:relative}.hs__media::before{content:"";position:absolute;inset:22px -22px -22px 22px;background:var(--brand);border-radius:var(--r);z-index:0}.hs__media img{position:relative;z-index:1;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}
@media (max-width:860px){.hs__grid{grid-template-columns:1fr}.hs__media{margin:28px 22px 0 0}.hs__media img{aspect-ratio:16/10}.hs__facts div{grid-template-columns:1fr;gap:2px}}`,
  'hero:type-collage': `.ht{background:var(--brand);color:var(--onBrand);padding-top:calc(40px*var(--sp));overflow:hidden}.ht__grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(340px,.9fr);gap:48px;align-items:center;padding-bottom:calc(72px*var(--sp))}.ht__grid--type{grid-template-columns:minmax(0,1fr)}.ht__grid--type .ht__text{max-width:980px}.ht .ht__grid--type h1{font-size:min(clamp(2.6rem,8.4vw,8.4rem),calc(min(980px,100vw - 48px) / var(--fit,8)))}
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
  'hero:masthead': `.hm{background:var(--bg);padding-block:calc(20px*var(--sp)) calc(64px*var(--sp))}
.hm__dateline{display:flex;flex-wrap:wrap;gap:4px 24px;justify-content:space-between;border-block:1px solid var(--ink);padding:10px 0;margin:0 0 clamp(14px,2vw,24px);font:600 .8rem/1.4 var(--bf);letter-spacing:.12em;text-transform:uppercase}
.hm__title{font-size:min(clamp(2.6rem,8.6vw,8.2rem),calc(min(1200px,100vw - 2*clamp(20px,4vw,48px)) / var(--fit,8)));line-height:.9;letter-spacing:-.03em;text-align:center;margin:0 0 clamp(18px,2.4vw,28px);padding-bottom:clamp(16px,2vw,26px);border-bottom:6px solid var(--ink)}
.hm__grid{display:grid;grid-template-columns:1.55fr 1fr;gap:clamp(24px,4vw,56px);align-items:start}.hm__grid--text{grid-template-columns:1fr;max-width:760px}
.hm__lead{position:relative}.hm__lead img{width:100%;aspect-ratio:3/2;object-fit:cover}
.hm__col{border-left:1px solid var(--line);padding-left:clamp(20px,3vw,40px)}.hm__col .eyebrow{color:var(--brandText)}
.hm__deck{font-size:clamp(1.2rem,1.7vw,1.45rem);line-height:1.45;margin:0 0 6px}.hm__rating{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-weight:600;margin:18px 0 0}
.hm__toc{margin-top:30px;border-top:2px solid var(--ink);padding-top:12px}.hm__toc-h{font:700 .78rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px}
.hm__toc ol{counter-reset:t}.hm__toc li{counter-increment:t;border-bottom:1px solid var(--line)}
.hm__toc a{display:flex;gap:14px;align-items:center;min-height:44px;color:inherit;text-decoration:none;font-weight:600}.hm__toc a::before{content:counter(t,decimal-leading-zero);font:var(--hw) .95rem/1 var(--hf);color:var(--brandText);min-width:2ch}.hm__toc a:hover{text-decoration:underline}
@media (max-width:860px){.hm__grid{grid-template-columns:1fr}.hm__col{border-left:0;padding-left:0}.hm__title{text-align:left}}`,
  'hero:desk': `.hd{background:var(--bg);padding-top:calc(48px*var(--sp))}
.hd__grid{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(28px,5vw,72px);align-items:start;padding-bottom:calc(52px*var(--sp))}
.hd h1{font-size:min(clamp(2.4rem,5vw,4.4rem),calc(min(600px,100vw - 40px) / var(--fit,8)))}.hd .eyebrow{color:var(--brandText)}.hd .lede{margin-top:18px;color:var(--muted)}
.hd__rating{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:26px 0 0;font-weight:600}
.hd__desk{background:var(--brand);color:var(--onBrand);border-radius:var(--r);padding:clamp(22px,3vw,34px)}
.hd__desk-h{font:700 .8rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;margin:0 0 16px}
.hd__desk dl{display:grid;gap:14px}.hd__desk dl>div{display:grid;grid-template-columns:96px 1fr;gap:12px;padding-bottom:14px;border-bottom:1px solid color-mix(in srgb,var(--onBrand) 30%,transparent)}.hd__desk dl>div:last-child{border-bottom:0;padding-bottom:0}
.hd__desk dt{font-weight:700}.hd__desk .link{color:inherit}.hd__desk .hours li{padding:1px 0}
.hd__band{position:relative;height:clamp(200px,28vw,360px);overflow:hidden}.hd__band img{width:100%;height:100%;object-fit:cover}
@media (max-width:860px){.hd__grid{grid-template-columns:1fr}.hd__desk dl>div{grid-template-columns:1fr;gap:2px}}`,
  'offer:ledger': `.lg .sec-head{border-bottom:6px solid var(--ink);max-width:none;padding-bottom:14px}
.lg__group{margin-bottom:calc(40px*var(--sp))}.lg__sec{font-size:clamp(1.4rem,2.2vw,1.9rem);border-bottom:2px solid var(--ink);padding:18px 0 8px}
.lg__list li{display:grid;grid-template-columns:minmax(150px,1fr) 2fr auto;gap:6px 28px;padding:14px 0;border-bottom:1px solid var(--line);align-items:baseline}
.lg__name{font-weight:700}.lg__desc{color:var(--muted)}
.lg--svc .lg__list li{grid-template-columns:56px minmax(0,1fr) auto;padding:20px 0}.lg__n{font:var(--hw) 1.5rem/1 var(--hf);color:var(--brandText)}.lg--svc h3{font-size:clamp(1.2rem,1.8vw,1.5rem)}.lg--svc p{margin:.4em 0 0;color:var(--muted);max-width:70ch}.lg--svc .svc-go{margin-top:0}
@media (max-width:760px){.lg__list li{grid-template-columns:minmax(0,1fr) auto}.lg__desc{grid-column:1/-1;grid-row:2}.lg--svc .lg__list li{grid-template-columns:40px minmax(0,1fr)}.lg--svc .svc-go{grid-column:2}}`,
  'offer:tiles': `.tl__jump ul{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
.tl__jump a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:var(--brand);color:var(--onBrand);font-weight:700;text-decoration:none}.tl__jump a:hover{filter:brightness(1.08)}
.tl__group{margin-bottom:32px;scroll-margin-top:16px}.tl__group h3{font-size:1.35rem;margin-bottom:12px}
.tl__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.tl__grid--svc{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.tl__tile{min-width:0;background:var(--surface);border:1px solid var(--line);border-top:4px solid var(--brand);border-radius:var(--r);padding:16px 18px;display:flex;flex-direction:column;gap:6px}.sec:nth-of-type(even) .tl__tile{background:var(--bg)}
.tl__img{position:relative;margin:-16px -18px 8px;overflow:hidden}.tl__img img{width:100%;aspect-ratio:3/2;object-fit:cover}
.tl__top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.tl__name{font-weight:700;min-width:0}.tl__tile p{margin:0;color:var(--muted);font-size:.95rem}.tl__tile h3{font-size:1.15rem}
@media (max-width:760px){.tl__grid{grid-template-columns:1fr 1fr}.tl__grid--svc{grid-template-columns:1fr}.tl__top{flex-direction:column;gap:2px}}`,
  'contact:timetable': `.tt__grid{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(28px,5vw,64px);align-items:start}
.tt__week{background:var(--deep);color:var(--onDeep);border-radius:var(--r);padding:clamp(22px,3vw,36px)}.tt__h{font:700 .8rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px}
.tt__week dl>div{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--onDeep) 25%,transparent);font-size:clamp(1rem,1.4vw,1.15rem)}.tt__week dl>div:last-child{border-bottom:0}.tt__week dt{font-weight:700}.tt__week dd{text-align:right}
.tt__dl{display:grid;gap:16px}.tt__dl div{padding-bottom:16px;border-bottom:1px solid var(--line)}.tt__dl dt{font-weight:700;margin-bottom:4px}.hours li{padding:2px 0}
.tt .loc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:20px}.tt .loc__grid li{border:1px solid var(--line);border-radius:var(--r);padding:16px}.tt .loc__grid p{margin:0 0 4px}
@media (max-width:860px){.tt__grid{grid-template-columns:1fr}}`,
};

/** The site shell's own styles: a direction's header and footer, on the homepage and every inner page. */
export const SHELL_CSS: Record<string, string> = {
  'head:masthead': `.site-head--masthead{background:var(--bg);color:var(--ink);border-bottom:4px double var(--ink)}
.site-head--masthead .site-head__in{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:72px;gap:16px}
.mh__line{margin:0;font:600 .76rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.site-head--masthead .brand{margin:0;justify-self:center}.site-head--masthead .brand__word{font-size:1.5rem}.site-head--masthead .site-head__in>.btn{justify-self:end}
.site-head--masthead nav{border-top:1px solid var(--ink)}.site-head--masthead nav ul{justify-content:center;flex-wrap:wrap}.site-head--masthead nav a{text-transform:uppercase;letter-spacing:.12em;font-size:.8rem}
@media (max-width:760px){.site-head--masthead .site-head__in{grid-template-columns:minmax(0,1fr) auto auto}.mh__line{display:none}.site-head--masthead .brand{justify-self:start}.site-head--masthead nav{border-top:0}.site-head--masthead .menu-btn{margin-left:0}}`,
  'head:utility': `.site-head--utility{background:var(--surface);color:var(--ink);border-bottom:1px solid var(--line)}
.u__strip{background:var(--deep);color:var(--onDeep);font-size:.9rem}.u__strip ul{display:flex;flex-wrap:wrap;align-items:center;gap:0 28px;min-height:44px}
.u__strip li{display:flex;align-items:center}.u__strip a{color:inherit;font-weight:700;display:inline-flex;align-items:center;min-height:44px;min-width:44px}.u__k{font-weight:700;margin-right:6px}
.site-head--utility nav{margin-left:auto}.site-head--utility .brand{margin-right:0}
@media (max-width:760px){.u__strip li:nth-child(n+3){display:none}.u__strip ul{gap:0 16px}}`,
  'foot:colophon': `.site-foot--colophon{background:var(--bg);color:var(--ink);border-top:4px double var(--ink);padding:48px 0 32px}
.cf__name{font:var(--hw) clamp(2.2rem,7vw,6rem)/.95 var(--hf);text-transform:var(--case);letter-spacing:-.02em;margin:0 0 26px;overflow-wrap:break-word}
.cf__cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;border-top:1px solid var(--ink);padding-top:18px}
.cf__h{font:700 .76rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;margin:0 0 8px}
.site-foot--colophon a{color:inherit}.site-foot--colophon li a{display:inline-flex;align-items:center;min-height:44px;min-width:44px}
.site-foot--colophon .site-foot__note{border-top:1px solid var(--line);color:var(--muted);padding-top:18px;margin-top:24px}`,
  'foot:utility': `.site-foot--utility .uf__acts{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px 32px;padding-bottom:30px;margin-bottom:26px;border-bottom:1px solid color-mix(in srgb,var(--onDeep) 30%,transparent)}
.uf__ask{font:var(--hw) clamp(1.6rem,3.4vw,2.6rem)/1.1 var(--hf);text-transform:var(--case);margin:0}.uf__acts .actions{margin-top:0}.site-foot--utility .btn--invert{color:#111316}
.uf__cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}.site-foot--utility .cf__h{font:700 .76rem/1.3 var(--bf);letter-spacing:.14em;text-transform:uppercase;margin:0 0 8px}
.site-foot--utility .site-foot__note{border-top:1px solid color-mix(in srgb,var(--onDeep) 30%,transparent);padding-top:18px;margin-top:24px}`,
};
/** the CSS for a shell's header and footer (the bar, overlay and centred headers and the standard footer are in baseCss) */
export const shellCss = (s: { header: string; footer: string }) => `${SHELL_CSS[`head:${s.header}`] ?? ''}\n${SHELL_CSS[`foot:${s.footer}`] ?? ''}`;

/** The header's phone menu: the button opens and closes it, a chosen link or Escape closes it (aria-expanded kept in step). */
export const MENU_JS = "document.querySelectorAll('.site-head').forEach(function(h){var b=h.querySelector('.menu-btn'),n=h.querySelector('nav');if(!b||!n)return;function set(o){h.setAttribute('data-menu',o?'open':'closed');b.setAttribute('aria-expanded',String(o))}b.addEventListener('click',function(){set(b.getAttribute('aria-expanded')!=='true')});n.addEventListener('click',function(e){if(e.target.closest('a'))set(false)});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&b.getAttribute('aria-expanded')==='true'){set(false);b.focus()}})});";
