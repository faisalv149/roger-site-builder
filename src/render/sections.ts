import type { SiteModel } from '../content/model.js';
import type { SectionLayout } from '../theme/schema.js';
import { esc } from '../util/text.js';
import { icon } from './icons.js';
import {
  colsVar, gi, head, hoursTable, ic, img, leadForm, mapEmbed, nextSteps, primaryCta, ratingBadge, secondaryCta, stars, title, trustRow,
} from './parts.js';

// Brand spellings for the footer (network ids come from sources/website.ts)
const NETWORK_LABEL: Record<string, string> = { linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', bbb: 'BBB', x: 'X' };

export interface Ctx {
  m: SiteModel;
  l: SectionLayout;
  bg: '' | 'alt';
  inSidebarMain: boolean;
}

const wrapSec = (id: string, cls: string, body: string, labelled = true) =>
  `<section id="${id}" class="section reveal ${cls}"${labelled ? ` aria-labelledby="${id}-h"` : ''}><div class="wrap">${body}</div></section>`;

/* ───────────────────────────── HERO ───────────────────────────── */
export function hero({ m, l }: Ctx): string {
  const v = l.variant;
  const h = m.images.hero;
  const eyebrow = ratingBadge(m) || `<span class="eyebrow">${esc(m.business.name)}</span>`;
  const text = `${eyebrow}<h1 id="top-h">${esc(m.copy.hero)}</h1><p class="sub">${esc(m.copy.subline)}</p>
    <div class="btn-row">${primaryCta(m)}${secondaryCta(m)}</div>${trustRow(m)}`;

  if (v === 'full-bleed-center') {
    return `<section id="top" class="hero hero-fb on-dark" aria-labelledby="top-h">
      <div class="bg-photo">${img(h, { eager: true })}</div>
      <div class="wrap content stack">${text}</div></section>`;
  }
  if (v === 'split') {
    const [a, b] = l.split?.desktop || [6, 6];
    const mediaLeft = (l as any).mediaSide === 'left';
    if ((l as any).mediaBleed) {
      const cols = mediaLeft ? `--fa:${b}fr;--fb:${a}fr` : `--fa:${a}fr;--fb:${b}fr`;
      const t = `<div class="text stack">${text}</div>`;
      const md = `<div class="media">${img(h, { eager: true })}</div>`;
      return `<section id="top" class="hero hero-bleed${mediaLeft ? ' media-left' : ''}" style="${cols}" aria-labelledby="top-h">${mediaLeft ? md + t : t + md}</section>`;
    }
    const textSpan = mediaLeft ? b : a;
    const mediaSpan = mediaLeft ? a : b;
    const t = `<div ${gi(textSpan)}><div class="stack">${text}</div></div>`;
    const md = `<div ${gi(mediaSpan)}><div class="media">${img(h, { eager: true })}</div></div>`;
    return `<section id="top" class="hero hero-split" aria-labelledby="top-h"><div class="wrap"><div class="grid">${mediaLeft ? md + t : t + md}</div></div></section>`;
  }
  if (v === 'split-form') {
    const [a, b] = l.split?.desktop || [7, 5];
    const formRight = (l as any).formSide !== 'left';
    const photoBg = (l as any).background === 'photo';
    const t = `<div class="gi${photoBg ? ' on-dark' : ''}" style="--s:${a}"><div class="stack">${text}</div></div>`;
    const f = `<div class="gi" style="--s:${b}"><div class="card">${leadForm(m, { compact: true, title: m.copy.quoteTitle })}</div></div>`;
    return `<section id="top" class="hero hero-form${photoBg ? '' : ' alt'}" aria-labelledby="top-h">
      ${photoBg ? `<div class="bg-photo">${img(h, { eager: true })}</div>` : ''}
      <div class="wrap"><div class="grid">${formRight ? t + f : f + t}</div></div></section>`;
  }
  // stacked (centered) and text-only (left) — image inset below the text
  const center = v === 'stacked' || l.align === 'center';
  const imgBelow = (l as any).imagePosition !== 'none';
  return `<section id="top" class="hero hero-stack${center ? ' center' : ''}" aria-labelledby="top-h"><div class="wrap">
    <div class="grid"><div ${center ? gi(Math.min(m.theme.grid.columns, 8), Math.max(0, Math.floor((m.theme.grid.columns - 8) / 2))) : gi()}><div class="text">${text}</div></div></div>
    ${imgBelow ? `<div class="inset">${img(h, { eager: true })}</div>` : ''}
  </div></section>`;
}

/* ───────────────────────────── URGENT ───────────────────────────── */
export function urgent({ m, l }: Ctx): string {
  const call = m.contact.tel ? `<a class="btn btn-light" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 20 })}<span>Call ${esc(m.contact.phone)}</span></a>` : '';
  if (l.variant === 'callout-box') {
    return `<section id="urgent" class="section reveal" aria-label="Emergency service"><div class="wrap"><div class="grid"><div ${gi(l.span?.desktop, l.span?.offset)}>
      <div class="callout"><p>${ic(m, 'siren')}${esc(m.copy.urgent)}</p>${m.contact.tel ? `<a class="btn btn-primary" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 18 })}<span>${esc(m.contact.phone)}</span></a>` : ''}</div>
    </div></div></div></section>`;
  }
  return `<section id="urgent" class="urgent-bar" aria-label="Emergency service"><div class="wrap in"><p>${icon('siren', { size: 28 })}${esc(m.copy.urgent)}</p>${call}</div></section>`;
}

/* ───────────────────────────── SERVICES ───────────────────────────── */
function svcDesc(m: SiteModel, s: SiteModel['services']['items'][number]) {
  return s.description || (m.facts.city ? `${s.label} for homes in ${m.facts.city}.` : `${s.label} for your home.`);
}

export function services(ctx: Ctx): string {
  const { m, l, bg } = ctx;
  const items = m.services.items;
  const overflow = m.services.overflow && m.services.overflowLabel
    ? `<p class="overflow"><a class="link-arrow" href="#quote">${esc(m.services.overflowLabel)} ${icon('arrow-right', { size: 18 })}</a></p>` : '';
  const sub = undefined;
  let body = '';
  switch (l.variant) {
    case 'icon-tiles':
      body = `<div class="cols" style="${colsVar(l.columns, { phone: 2, desktop: 4 })}">${items.map((s) => `<div class="tile">${ic(m, s.icon, 28)}<b>${esc(s.label)}</b></div>`).join('')}</div>`;
      break;
    case 'cards':
      body = `<div class="cols" style="${colsVar(l.columns, { phone: 1, desktop: 3 })}">${items.map((s) => `<article class="card svc-card"><span class="svc-ic">${ic(m, s.icon)}</span><h3>${esc(s.label)}</h3><p class="muted small">${esc(svcDesc(m, s))}</p></article>`).join('')}</div>`;
      break;
    case 'card-list':
      body = `<div class="cols" style="${colsVar(l.columns, { phone: 1, desktop: 2 })}">${items.map((s) => `<article class="card svc-row"><span class="svc-ic">${ic(m, s.icon)}</span><div><h3>${esc(s.label)}</h3><p class="muted small">${esc(svcDesc(m, s))}</p></div></article>`).join('')}</div>`;
      break;
    case 'checklist':
      body = `<ul class="checklist cols" style="${colsVar(l.columns, { phone: 1, desktop: 2 })};column-gap:var(--gutter)">${items.map((s) => `<li>${icon('circle-check', { size: 22 })}<div><b>${esc(s.label)}</b>${s.description ? `<p class="muted small">${esc(s.description)}</p>` : ''}</div></li>`).join('')}</ul>`;
      break;
    case 'numbered-list':
      body = `<ol class="numbered">${items.map((s, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(s.label)}</h3><p class="muted small">${esc(svcDesc(m, s))}</p></div></li>`).join('')}</ol>`;
      break;
    case 'zigzag': {
      const [a, b] = l.split?.desktop || [6, 6];
      const pics = m.images.gallery.length ? m.images.gallery : [m.images.hero];
      const rows = items.slice(0, 3);
      const rest = items.slice(3);
      body = rows.map((s, i) => {
        const p = pics[i % pics.length];
        const flip = (l as any).alternate !== false && i % 2 === 1;
        return `<div class="zig${flip ? ' flip' : ''}" style="--za:${a}fr;--zb:${b}fr"><div class="zmedia">${img(p)}</div><div class="ztext"><span class="svc-ic">${ic(m, s.icon)}</span><h3>${esc(s.label)}</h3><p class="muted">${esc(svcDesc(m, s))}</p><a class="link-arrow" href="#quote">Ask about ${esc(s.label.toLowerCase())} ${icon('arrow-right', { size: 18 })}</a></div></div>`;
      }).join('') + (rest.length ? `<ul class="also">${rest.map((s) => `<li class="chip">${ic(m, s.icon, 18)}${esc(s.label)}</li>`).join('')}</ul>` : '');
      break;
    }
    default:
      body = `<div class="cols" style="--cp:1;--cd:3">${items.map((s) => `<div class="tile">${ic(m, s.icon)}<b>${esc(s.label)}</b></div>`).join('')}</div>`;
  }
  const inner = `${head('services', title(m, 'services'), sub)}${body}${overflow}`;
  const content = l.span?.desktop ? `<div class="grid"><div ${gi(l.span.desktop, l.span.offset)}>${inner}</div></div>` : inner;
  return wrapSec('services', bg, content);
}

/* ───────────────────────────── PROOF ───────────────────────────── */
function quoteCards(m: SiteModel, cols?: { phone?: number; desktop?: number }) {
  if (!m.proof.quotes.length) return '';
  return `<div class="cols quotes" style="${colsVar(cols, { phone: 1, desktop: 2 })}">${m.proof.quotes.map((q) => `<figure class="card quote-card">${stars(q.rating)}<blockquote><p>“${esc(q.text)}”</p></blockquote><figcaption>${esc(q.author)} · Google review</figcaption></figure>`).join('')}</div>`;
}
const googleAttrib = (m: SiteModel) => (m.proof.showRating ? `<p class="attrib">Ratings and reviews from Google.</p>` : '');

export function proof(ctx: Ctx): string {
  const { m, l, bg } = ctx;
  const p = m.proof;
  let body = '';
  switch (l.variant) {
    case 'stat-row':
      body = `${head('reviews', title(m, 'proof'))}<div class="cols" style="${colsVar(l.columns, { phone: 2, desktop: 4 })}">${p.stats.map((s) => `<div class="stat"><span class="v${/^[\d.]+[★+]?$/.test(s.value) ? '' : ' word'}">${esc(s.value)}</span><span class="l">${esc(s.label)}</span></div>`).join('')}</div>${quoteCards(m)}${googleAttrib(m)}`;
      break;
    case 'inline-badges': {
      const chips = [
        ...(p.showRating ? [`<li class="chip">${stars(p.rating || 0, 14)} ${p.rating?.toFixed(1)} on Google</li>`, `<li class="chip">${icon('message-square', { size: 16 })} ${p.reviewCount} reviews</li>`] : []),
        ...m.trust.map((t) => `<li class="chip">${icon('badge-check', { size: 16 })} ${esc(t)}</li>`),
      ].join('');
      body = `${head('reviews', title(m, 'proof'))}<ul class="chips">${chips}</ul>${quoteCards(m, { phone: 1, desktop: m.theme.grid.columns <= 6 ? 1 : 2 })}${googleAttrib(m)}`;
      break;
    }
    case 'pull-quote-band': {
      const q = p.quotes[0];
      const meta = [
        p.showRating ? `<span>${stars(p.rating || 0, 15)} ${p.rating?.toFixed(1)} · ${p.reviewCount} Google reviews</span>` : '',
        ...m.trust.map((t) => `<span>${icon('badge-check', { size: 16 })} ${esc(t)}</span>`),
      ].join('');
      const inner = q
        ? `<h2 id="reviews-h" class="visually-hidden">${esc(title(m, 'proof'))}</h2><figure class="pull"><blockquote><p>“${esc(q.text)}”</p></blockquote><figcaption>${esc(q.author)} · Google review</figcaption><div class="meta">${meta}</div></figure>`
        : `${head('reviews', title(m, 'proof'), undefined, true)}<div class="pull"><div class="meta">${meta}</div></div>`;
      return `<section id="reviews" class="section tint reveal" aria-labelledby="reviews-h"><div class="wrap"><div class="grid"><div ${gi(l.span?.desktop, l.span?.offset)}>${inner}${googleAttrib(m)}</div></div></div></section>`;
    }
    case 'review-cards':
    default: {
      const summary = p.showRating ? `<p class="badge-rating">${stars(p.rating || 0)} <span>${p.rating?.toFixed(1)} average from ${p.reviewCount} Google reviews</span></p>` : '';
      const cards = p.quotes.length ? quoteCards(m, l.columns) : '';
      body = `<div class="sec-head"><h2 id="reviews-h">${esc(title(m, 'proof'))}</h2>${summary}</div>${m.trust.length ? `<ul class="chips">${m.trust.map((t) => `<li class="chip">${icon('badge-check', { size: 16 })} ${esc(t)}</li>`).join('')}</ul>` : ''}${cards}${googleAttrib(m)}`;
    }
  }
  const content = l.span?.desktop ? `<div class="grid"><div ${gi(l.span.desktop, l.span.offset)}>${body}</div></div>` : body;
  return wrapSec('reviews', bg, content);
}

/* ───────────────────────────── QUOTE ───────────────────────────── */
export function quote(ctx: Ctx): string {
  const { m, l, bg } = ctx;
  const sub = `<p class="muted">Tell us what you need. ${m.contact.phone ? `Prefer to talk? Call <a href="${m.contact.tel}">${esc(m.contact.phone)}</a>.` : ''}</p>`;
  switch (l.variant) {
    case 'sticky-sidebar':
      return `<div id="quote" class="card" aria-labelledby="quote-h"><h2 id="quote-h" class="h" style="font-size:var(--fs-xl)">${esc(m.copy.quoteTitle)}</h2><div style="margin:8px 0 16px">${sub}</div>${leadForm(m, {})}</div>`;
    case 'split': {
      const [a, b] = l.split?.desktop || [6, 6];
      const formLeft = (l as any).formSide === 'left';
      const form = `<div class="card">${leadForm(m)}</div>`;
      const text = `<div class="stack"><h2 id="quote-h">${esc(m.copy.quoteTitle)}</h2>${sub}${nextSteps(m)}</div>`;
      const cells = formLeft ? `<div ${gi(a)}>${form}</div><div ${gi(b)}>${text}</div>` : `<div ${gi(a)}>${text}</div><div ${gi(b)}>${form}</div>`;
      return wrapSec('quote', bg, `<div class="grid" style="align-items:start">${cells}</div>`);
    }
    case 'inline-form':
      return wrapSec('quote', bg, `${head('quote', m.copy.quoteTitle)}${sub.replace('<p class="muted">', '<p class="muted" style="margin:-12px 0 24px">')}${leadForm(m)}`);
    case 'inset-card':
    case 'centered-card':
    default: {
      const span = l.span?.desktop ?? 6;
      const offset = l.span?.offset ?? Math.floor((m.theme.grid.columns - span) / 2);
      return wrapSec('quote', bg, `<div class="grid"><div ${gi(span, offset)}><div class="card"><h2 id="quote-h" style="font-size:var(--fs-2xl)">${esc(m.copy.quoteTitle)}</h2><div style="margin:8px 0 20px">${sub}</div>${leadForm(m)}</div></div></div>`);
    }
  }
}

/* ───────────────────────────── GALLERY ───────────────────────────── */
function fig(p: SiteModel['images']['gallery'][number], cls = '') {
  return `<figure class="${cls}">${img(p)}${p.credit ? `<figcaption>${esc(p.credit)}</figcaption>` : ''}</figure>`;
}
export function gallery(ctx: Ctx): string {
  const { m, l, bg } = ctx;
  const photos = m.images.gallery;
  let body = '';
  switch (l.variant) {
    case 'bento': {
      const pattern: string[] = (l as any).pattern || ['2x2', '1x1', '1x1', '2x1', '1x1', '1x1'];
      body = `<div class="gal bento" style="${colsVar(l.columns, { phone: 2, desktop: 4 })}">${photos.slice(0, pattern.length).map((p, i) => fig(p, `s${pattern[i % pattern.length]}`)).join('')}</div>`;
      break;
    }
    case 'carousel': {
      const pv = (l as any).perView || { phone: 1.2, desktop: 2.5 };
      body = `<div class="gal scroller" style="--pvp:${pv.phone};--pvd:${pv.desktop}" tabindex="0" aria-label="Photo gallery, scroll sideways">${photos.map((p) => fig(p)).join('')}</div>`;
      break;
    }
    case 'filmstrip':
      body = `<div class="gal scroller" style="--pvp:${l.columns?.phone ?? 2};--pvd:${l.columns?.desktop ?? 4}" tabindex="0" aria-label="Photo gallery, scroll sideways">${photos.map((p) => fig(p)).join('')}</div>`;
      break;
    case 'uniform-grid':
    default: {
      // Avoid a lonely last row: trim to a multiple of the desktop column count.
      const cd = l.columns?.desktop ?? 3;
      const n = photos.length > cd ? photos.length - (photos.length % cd) : photos.length;
      body = `<div class="gal cols" style="${colsVar(l.columns, { phone: 2, desktop: 3 })}">${photos.slice(0, n).map((p) => fig(p)).join('')}</div>`;
    }
  }
  const inner = `${head('work', title(m, 'gallery'))}${body}`;
  const content = l.span?.desktop ? `<div class="grid"><div ${gi(l.span.desktop, l.span.offset)}>${inner}</div></div>` : inner;
  return wrapSec('work', bg, content);
}

/* ───────────────────────────── AREA ───────────────────────────── */
export function area(ctx: Ctx): string {
  const { m, l, bg } = ctx;
  const towns = (cols = 2) => `<ul class="towns cols" style="--cp:${Math.min(2, cols)};--cd:${cols}">${m.areas.map((a) => `<li>${icon('map-pin', { size: 18 })}${esc(a)}</li>`).join('')}</ul>`;
  const chips = `<ul class="chips">${m.areas.map((a) => `<li class="chip">${icon('map-pin', { size: 15 })}${esc(a)}</li>`).join('')}</ul>`;
  const addr = m.contact.address ? `<p class="addr">${ic(m, 'building-2', 20)}<span>${esc(m.contact.address)}${m.contact.directionsUrl ? ` · <a href="${esc(m.contact.directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</span></p>` : '';
  const hrs = hoursTable(m);
  const map = mapEmbed(m);
  let body = '';
  switch (l.variant) {
    case 'chips': {
      const two = (l.columns?.desktop ?? 1) > 1;
      body = two
        ? `<div class="cols" style="--cp:1;--cd:2;align-items:stretch"><div class="stack">${chips}${addr}${hrs}</div><div>${map}</div></div>`
        : `<div class="stack">${chips}${addr}${map}${hrs}</div>`;
      break;
    }
    case 'two-col-list':
      body = `<div class="cols" style="${colsVar(l.columns, { phone: 1, desktop: 2 })};align-items:start"><div class="stack">${towns(2)}${addr}${hrs}</div><div style="height:100%">${map}</div></div>`;
      break;
    case 'split-list': {
      const [a, b] = l.split?.desktop || [4, 8];
      body = `<div class="grid" style="align-items:stretch"><div ${gi(a)}><div class="stack">${towns(1)}${addr}${hrs}</div></div><div ${gi(b)}>${map}</div></div>`;
      break;
    }
    case 'card':
    default:
      body = `<div class="card stack">${chips}${addr}${hrs}${map}</div>`;
  }
  const inner = `${head('area', title(m, 'area'))}${body}`;
  const content = l.span?.desktop ? `<div class="grid"><div ${gi(l.span.desktop, l.span.offset)}>${inner}</div></div>` : inner;
  return wrapSec('area', bg, content);
}

/* ───────────────────────────── MAINTENANCE ───────────────────────────── */
export function maintenance({ m, l }: Ctx): string {
  return `<section id="plans" class="section reveal" aria-labelledby="plans-h"><div class="wrap"><div class="grid"><div ${gi(l.span?.desktop, l.span?.offset)}>
    <div class="plan"><div class="stack" style="max-width:60ch">${ic(m, 'calendar-check', 32)}<h2 id="plans-h">${esc(m.copy.maintenance || 'Maintenance plans')}</h2><p class="muted">Regular service catches small problems before they turn into big repairs. Ask how a plan works for your home.</p></div>
    <a class="btn btn-primary" href="#quote">Ask about plans</a></div>
  </div></div></div></section>`;
}

/* ───────────────────────────── FOOTER ───────────────────────────── */
export function footer({ m, l }: Ctx): string {
  const year = new Date().getFullYear();
  const brandBlock = m.brand.logo
    ? `<a class="logo-chip" href="#top"><img src="${esc(m.brand.logo.publicPath)}" alt="${esc(m.business.name)}" height="36"></a>`
    : `<a class="wordmark" href="#top" style="text-decoration:none">${esc(m.copy.wordmark)}</a>`;
  const contact = `<ul>
    ${m.contact.tel ? `<li><a href="${m.contact.tel}">${icon('phone', { size: 16 })} ${esc(m.contact.phone)}</a></li>` : ''}
    ${m.contact.sms && m.theme.roger.chatBubble ? `<li><a href="${esc(m.contact.sms)}">${icon('message-circle', { size: 16 })} Text us</a></li>` : ''}
    ${m.contact.email ? `<li><a href="mailto:${esc(m.contact.email)}">${icon('mail', { size: 16 })} ${esc(m.contact.email)}</a></li>` : ''}
    ${m.contact.address ? `<li>${icon('map-pin', { size: 16 })} ${esc(m.contact.address)}</li>` : ''}
  </ul>`;
  const svc = `<ul>${m.services.items.map((s) => `<li><a href="#services" style="text-decoration:none">${esc(s.label)}</a></li>`).join('')}</ul>`;
  const hours = m.hours.compact.length ? `<ul>${m.hours.compact.map((r) => `<li>${esc(r.days)}: ${esc(r.time)}</li>`).join('')}</ul>` : '<p>Call for hours</p>';
  const socials = m.socials.length ? `<div class="socials">${m.socials.slice(0, 5).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(NETWORK_LABEL[s.network] || s.network[0].toUpperCase() + s.network.slice(1))}</a>`).join('')}</div>` : '';
  const tagline = `<p style="margin-top:12px">${esc(m.business.primaryTypeLabel || 'Local service')}${m.facts.city ? ` in ${esc(m.facts.city)}${m.facts.state ? `, ${esc(m.facts.state)}` : ''}` : ''}.</p>`;
  const credit = m.theme.roger.footerCredit ? `<span class="credit">Website by Roger</span>` : '';
  const bottom = `<div class="f-bottom"><span>© ${year} ${esc(m.business.name)}</span>${m.facts.licenseNumber ? `<span>License #${esc(m.facts.licenseNumber)}</span>` : ''}${credit}</div>`;
  let cols = '';
  switch (l.variant) {
    case 'four-col':
      cols = `<div class="cols" style="--cp:1;--cd:4"><div>${brandBlock}${tagline}${socials}</div><div><h3>Services</h3>${svc}</div><div><h3>Contact</h3>${contact}</div><div><h3>Hours</h3>${hours}</div></div>`;
      break;
    case 'three-col':
      cols = `<div class="cols" style="--cp:1;--cd:3"><div>${brandBlock}${tagline}${socials}</div><div><h3>Contact</h3>${contact}</div><div><h3>Hours</h3>${hours}</div></div>`;
      break;
    case 'minimal-two-col':
      cols = `<div class="cols" style="--cp:1;--cd:2;align-items:end"><div>${brandBlock}${tagline}</div><div style="justify-self:end">${contact}${socials}</div></div>`;
      break;
    case 'centered-stack':
    default:
      cols = `<div class="f-center">${brandBlock}${tagline}<div class="inline">${m.contact.tel ? `<a href="${m.contact.tel}">${esc(m.contact.phone)}</a>` : ''}${m.contact.email ? `<a href="mailto:${esc(m.contact.email)}">${esc(m.contact.email)}</a>` : ''}${m.contact.address ? `<span>${esc(m.contact.address)}</span>` : ''}</div>${socials}</div>`;
  }
  return `<footer class="site-footer"><div class="wrap">${cols}${bottom}</div></footer>`;
}

export const RENDERERS: Record<string, (c: Ctx) => string> = { hero, urgent, services, proof, quote, gallery, area, maintenance, footer };
