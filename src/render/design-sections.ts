import type { SiteModel } from '../content/model.js';
import type { SiteImage } from '../brand/photos.js';
import type { OfferingView } from '../design/compose.js';
import { esc } from '../util/text.js';
import { icon } from './icons.js';
import { reviewSlider } from './widgets.js';
import { hoursTable, ic, tileSrc, leadForm, mapEmbed, ratingBadge, stars, trustRow } from './parts.js';
import { footer as legacyFooter, type Ctx } from './sections.js';

/**
 * Section renderers for the design directions (src/design). Each section id has the variants listed in COMPAT
 * (src/design/schema.ts); the plan picks them, these draw them, with the business category's wording
 * (src/design/categories.ts). Legacy themes keep using src/render/sections.ts.
 */
const D = (m: SiteModel) => m.design!;
const dir = (m: SiteModel) => D(m).plan.direction;
const goal = (m: SiteModel) => D(m).plan.goal;
const P = (m: SiteModel) => D(m).profile;
const trades = (m: SiteModel) => D(m).plan.category === 'trades';

export function picture(set: { desktop: SiteImage; mobile: SiteImage }, eager = false): string {
  const { desktop: d, mobile: p } = set;
  return `<picture><source media="(max-width: 899px)" srcset="${esc(p.publicPath)}" width="${p.width}" height="${p.height}"><img src="${esc(d.publicPath)}" width="${d.width}" height="${d.height}" alt="${esc(d.alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}
export const credit = (i?: SiteImage) => (i?.credit ? `<span class="d-credit">${esc(i.credit)}</span>` : '');
/** the request event the lead form records for the goal */
export const reqEv = (m: SiteModel) => ({ appointment: 'appointment', order: 'order', enquiry: 'enquiry', quote: 'quote', call: 'quote' }[goal(m)]);

/** Calls to action that match the goal: Call needs a valid phone; every other goal goes to the request form. */
export function ctas(m: SiteModel, cls = ''): string {
  const d = D(m);
  const phone = m.contact.tel && d.phoneOk ? m.contact.phone : undefined;
  // "Call" is visually dropped on phones (the number is the label there) but stays in the accessible name
  const call = (primary: boolean) => (phone ? `<a class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 20 })}<span>${dir(m) === 'bold-direct' && primary ? '' : '<span class="cw">Call </span>'}${esc(phone)}</span></a>` : '');
  const req = (primary: boolean) => `<a class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" href="#quote" data-ev="${reqEv(m)}">${esc(d.actionLabel)}</a>`;
  return `<div class="btn-row ${cls}">${goal(m) === 'call' && phone ? call(true) + req(false) : req(true) + call(false)}</div>`;
}
export const apptNote = (m: SiteModel) => (goal(m) === 'appointment' && !m.source?.booking ? `<p class="d-note">${icon('info', { size: 16 })}<span>Appointment requests are confirmed by ${esc(m.business.name)} before anything is booked.</span></p>` : '');

/* ───────────── hero: split · photo-led · type-led · carousel ───────────── */
export function hero({ m, l }: Ctx): string {
  const d = D(m);
  const v = l.variant;
  const eyebrow = dir(m) === 'local-trusted'
    ? ratingBadge(m) || `<span class="eyebrow">${esc(m.business.name)}</span>`
    : `<span class="eyebrow">${esc((dir(m) === 'modern-premium' || dir(m) === 'clean-professional') && m.facts.city ? `${m.business.name} · ${m.facts.city}` : m.business.name)}</span>`;
  const text = `${eyebrow}<h1 id="top-h">${esc(m.copy.hero)}</h1><p class="sub">${esc(m.copy.subline)}</p>${ctas(m, 'dh-ctas')}${dir(m) === 'local-trusted' ? trustRow(m) : ''}${apptNote(m)}`;
  if (v === 'split' && d.heroImages) {
    return `<section id="top" class="dh dh-split" aria-labelledby="top-h"><div class="wrap dh-grid"><div class="dh-text">${text}</div><div class="dh-media">${picture(d.heroImages, true)}${credit(d.heroImages.desktop)}</div></div></section>`;
  }
  if (v === 'photo-led' && d.heroImages) {
    return `<section id="top" class="dh dh-photo" aria-labelledby="top-h"><div class="dh-bg">${picture(d.heroImages, true)}${credit(d.heroImages.desktop)}</div><div class="wrap dh-in"><div class="dh-text">${text}</div></div></section>`;
  }
  if (v === 'carousel' && d.slides.length >= 2) {
    return `<section id="top" class="dh dh-carousel" aria-labelledby="top-h"><div class="wrap dh-grid"><div class="dh-text">${text}</div>${carousel(d.slides)}</div></section>`;
  }
  const aside = typeAside(m);
  return `<section id="top" class="dh dh-type" aria-labelledby="top-h"><div class="wrap dh-grid"><div class="dh-text">${text}</div>${aside ? `<aside class="dh-aside" aria-label="At a glance">${aside}</aside>` : ''}</div></section>`;
}

/**
 * Photo carousel (WAI-ARIA APG carousel pattern): a labelled region, previous/next buttons, slide picker, each slide
 * labelled "n of N". Manual by default: no autoplay. Without JavaScript the slides are a sideways-scrolling row.
 */
export function carousel(slides: { desktop: SiteImage; mobile: SiteImage }[]): string {
  const n = slides.length;
  const items = slides.map((s, i) => `<div class="cz-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}" id="cz-s${i}" data-cz-slide="${i}">${picture(s, i === 0)}${credit(s.desktop)}</div>`).join('');
  const dots = slides.map((_, i) => `<button type="button" class="cz-dot" data-cz-go="${i}" aria-label="Show photo ${i + 1} of ${n}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  return `<div class="dh-media cz" role="region" aria-roledescription="carousel" aria-label="Photos" data-cz>
    <div class="cz-track" id="cz-track" aria-live="polite" tabindex="0">${items}</div>
    <div class="cz-ctl"><button type="button" class="cz-btn" data-cz-prev aria-controls="cz-track" aria-label="Previous photo">${icon('chevron-left', { size: 22 })}</button><div class="cz-dots">${dots}</div><button type="button" class="cz-btn" data-cz-next aria-controls="cz-track" aria-label="Next photo">${icon('chevron-right', { size: 22 })}</button></div>
  </div>`;
}

/** The type-led hero's side panel: verified details only. */
function typeAside(m: SiteModel): string {
  const d = D(m);
  const tel = m.contact.tel && d.phoneOk;
  const hours = m.hours.compact.length ? `<ul class="dh-hours">${m.hours.compact.slice(0, 3).map((r) => `<li><span>${esc(r.days)}</span><span>${esc(r.time)}</span></li>`).join('')}</ul>` : '';
  if (dir(m) === 'bold-direct') {
    if (!tel) return hours ? `<p class="dh-label">Hours</p>${hours}` : '';
    return `<p class="dh-label">Call now</p><a class="dh-phone" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 30 })}<span>${esc(m.contact.phone)}</span></a>${m.hours.showOpenNow ? '<p class="open-now" data-open-now hidden></p>' : ''}${hours}`;
  }
  const rows: [string, string][] = [];
  if (m.proof.showRating) rows.push(['Google rating', `${m.proof.rating?.toFixed(1)}★ · ${m.proof.reviewCount} reviews`]);
  if (m.facts.years) rows.push(['In business', `${m.facts.years} years`]);
  if (m.facts.licensed) rows.push(['Licence', m.facts.licenseNumber ? `#${m.facts.licenseNumber}` : 'Licensed']);
  const openRow = m.hours.compact.find((r) => !/closed/i.test(r.time));
  if (P(m).hoursFirst && openRow) rows.push(['Open', `${openRow.days}: ${openRow.time}`]);
  else if (m.areas.length) rows.push(['Serving', m.areas.slice(0, 3).join(', ') + (m.areas.length > 3 ? ' and nearby' : '')]);
  if (tel) rows.push(['Phone', m.contact.phone!]);
  if (!rows.length) return hours ? `<p class="dh-label">Hours</p>${hours}` : '';
  return `<dl class="dh-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${k === 'Phone' ? `<a href="${m.contact.tel}" data-ev="call">${esc(v)}</a>` : esc(v)}</dd></div>`).join('')}</dl>`;
}

/* ───────────── intro: lead · split ───────────── */
export function intro({ m, l, bg }: Ctx): string {
  const d = D(m);
  if (!d.intro) return '';
  const facts = [m.proof.showRating && `${m.proof.rating?.toFixed(1)}★ from ${m.proof.reviewCount} Google reviews`, m.facts.years && `${m.facts.years} years in business`, P(m).hoursFirst && (() => { const r = m.hours.compact.find((x) => !/closed/i.test(x.time)); return r ? `Open ${r.days}, ${r.time}` : ''; })(), m.contact.address && P(m).hoursFirst && m.contact.address].filter(Boolean) as string[];
  const list = facts.length ? `<ul class="d-intro-facts">${facts.map((f) => `<li>${icon('circle-check', { size: 18 })}<span>${esc(f)}</span></li>`).join('')}</ul>` : '';
  if (l.variant === 'split' && list) {
    return `<section id="about" class="section ${bg} d-intro d-intro-split" aria-labelledby="about-h"><div class="wrap d-intro-grid"><div><p class="eyebrow">About</p><h2 id="about-h">${esc(m.business.name)}</h2></div><div><p class="d-lead">${esc(d.intro)}</p>${list}</div></div></section>`;
  }
  return `<section id="about" class="section ${bg} d-intro" aria-labelledby="about-h"><div class="wrap d-narrow"><h2 id="about-h" class="visually-hidden">About ${esc(m.business.name)}</h2><p class="d-intro-lead">${esc(d.intro)}</p>${list}</div></section>`;
}

/* ───────────── bold: contact band + emergency band ───────────── */
export function actions({ m }: Ctx): string {
  const d = D(m);
  const tel = m.contact.tel && d.phoneOk;
  const req = `<a class="btn btn-light" href="#quote" data-ev="${reqEv(m)}">${esc(d.actionLabel)}</a>`;
  const left = tel
    ? `<h2 id="contact-h" class="d-band-h">Call now</h2><a class="d-band-phone" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 28 })}<span>${esc(m.contact.phone)}</span></a>${m.hours.compact[0] ? `<p class="d-band-sub">${esc(m.hours.compact.map((r) => `${r.days}: ${r.time}`).slice(0, 2).join(' · '))}</p>` : ''}`
    : `<h2 id="contact-h" class="d-band-h">Tell us what you need</h2><p class="d-band-sub">Send a request and ${esc(m.business.name)} will get back to you.</p>`;
  return `<section id="contact" class="d-band" aria-labelledby="contact-h"><div class="wrap d-band-in"><div>${left}</div><div class="btn-row">${req}</div></div></section>`;
}

export function urgent({ m }: Ctx): string {
  const d = D(m);
  if (!d.emergencyLine || !m.contact.tel) return '';
  return `<section id="urgent" class="d-urgent" aria-label="Emergency service"><div class="wrap in"><p>${icon('siren', { size: 26 })}<span>${esc(d.emergencyLine)}</span></p><a class="btn btn-light" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 18 })}<span>Call ${esc(m.contact.phone)}</span></a></div></section>`;
}

/* ───────────── offerings: cards · checklist · dense-list · price-list · plans · index ───────────── */
const svcText = (m: SiteModel, s: { label: string; description?: string }) =>
  s.description || (trades(m) ? (m.facts.city ? `${s.label} for homes in ${m.facts.city}.` : `${s.label} for your home.`) : '');
const askLink = (m: SiteModel, label: string) => `<a class="link-arrow" href="#quote" data-ev="${reqEv(m)}">${esc(goal(m) === 'call' ? 'Ask about it' : D(m).actionLabel)}<span class="visually-hidden"> for ${esc(label.toLowerCase())}</span> ${icon('arrow-right', { size: 18 })}</a>`;
const offerOf = (m: SiteModel, id: string) => D(m).offerings.find((o) => o.id === id);
const priceTag = (o?: OfferingView) => (o ? `<span class="d-price${o.priced ? '' : ' is-quote'}">${esc(o.price)}</span>` : '');
const sampleNote = (m: SiteModel) => (D(m).samplePrices ? `<p class="d-sample">${icon('info', { size: 16 })}<span>Sample prices for this demo business. Real prices come from the business.</span></p>` : '');

export function services({ m, l, bg }: Ctx): string {
  const d = D(m);
  const f = d.focus;
  const others = d.others;
  const all = [f, ...others];
  const headTitle = dir(m) === 'bold-direct' && trades(m) ? 'Services' : P(m).offeringsTitle;
  let body = '';
  if (l.variant === 'price-list') {
    const rows = d.offerings.length ? d.offerings : all.map((s) => ({ id: s.id, name: s.label, description: s.description, price: P(m).unknownPrice, priced: false } as OfferingView));
    body = `<ul class="d-prices">${rows.map((o) => `<li><div class="d-pl-name"><h3>${esc(o.name)}</h3>${o.duration ? `<span class="d-dur">${icon('clock', { size: 15 })}${esc(o.duration)}</span>` : ''}</div><span class="d-pl-dots" aria-hidden="true"></span>${priceTag(o)}${o.description ? `<p class="muted small">${esc(o.description)}</p>` : ''}</li>`).join('')}</ul>${sampleNote(m)}`;
  } else if (l.variant === 'plans') {
    const rows = d.offerings.slice(0, 4);
    body = `<div class="d-plans" style="--n:${Math.max(1, rows.length)}">${rows.map((o, i) => `<article class="card d-plan${i === 0 ? ' is-focus' : ''}"><h3>${esc(o.name)}</h3><p class="d-plan-price${o.priced ? '' : ' is-quote'}">${esc(o.price)}</p>${o.description ? `<p class="muted">${esc(o.description)}</p>` : ''}${o.duration ? `<p class="small muted">${esc(o.duration)}</p>` : ''}<a class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}" href="#quote" data-ev="${reqEv(m)}">${esc(d.actionLabel)}<span class="visually-hidden"> about ${esc(o.name)}</span></a></article>`).join('')}</div>${sampleNote(m)}`;
  } else if (l.variant === 'index') {
    body = `<ol class="d-index d-index-lg">${all.map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="d-ix-name">${esc(s.label)}</span>${priceTag(offerOf(m, s.id))}</li>`).join('')}</ol>${sampleNote(m)}`;
  } else if (l.variant === 'dense-list') {
    body = `<ul class="d-dense">${all.map((s, i) => `<li${i === 0 ? ' class="is-focus"' : ''}><span class="svc-ic">${ic(m, s.icon)}</span><div><h3>${esc(s.label)}${i === 0 ? ` <span class="d-tag">Main ${esc(P(m).noun)}</span>` : ''}</h3>${svcText(m, s) ? `<p class="muted small">${esc(svcText(m, s))}</p>` : ''}${priceTag(offerOf(m, s.id))}</div></li>`).join('')}</ul>${sampleNote(m)}`;
  } else if (l.variant === 'checklist') {
    body = `<div class="d-feat-row"><article class="d-feat card"><span class="d-tag">Main ${esc(P(m).noun)}</span><h3>${esc(f.label)}</h3>${svcText(m, f) ? `<p>${esc(svcText(m, f))}</p>` : ''}${priceTag(offerOf(m, f.id))}${askLink(m, f.label)}</article>
      ${others.length ? `<ul class="checklist d-check">${others.map((s) => `<li>${icon('circle-check', { size: 22 })}<div><b>${esc(s.label)}</b>${s.description ? `<p class="muted small">${esc(s.description)}</p>` : ''}${priceTag(offerOf(m, s.id))}</div></li>`).join('')}</ul>` : ''}</div>${sampleNote(m)}`;
  } else {
    body = `<article class="card d-feat d-feat-wide"><span class="svc-ic">${ic(m, f.icon, 30)}</span><div class="d-feat-body"><span class="d-tag">Main ${esc(P(m).noun)}</span><h3>${esc(f.label)}</h3>${svcText(m, f) ? `<p>${esc(svcText(m, f))}</p>` : ''}${priceTag(offerOf(m, f.id))}</div>${askLink(m, f.label)}</article>
      ${others.length ? `<div class="d-svc-grid" style="--n:${others.length === 4 ? 2 : 3}">${others.map((s) => `<article class="card d-svc-card"><span class="svc-ic">${ic(m, s.icon)}</span><h3>${esc(s.label)}</h3>${svcText(m, s) ? `<p class="muted small">${esc(svcText(m, s))}</p>` : ''}${priceTag(offerOf(m, s.id))}</article>`).join('')}</div>` : ''}${sampleNote(m)}`;
  }
  return `<section id="services" class="section ${bg} d-svc d-svc-${esc(l.variant)}" aria-labelledby="services-h"><div class="wrap"><div class="sec-head"><h2 id="services-h">${esc(headTitle)}</h2></div>${body}</div></section>`;
}

/* ───────────── premium: featured offering (editorial) ───────────── */
export function focus({ m, bg }: Ctx): string {
  const d = D(m);
  const f = d.focus;
  const idx = d.others.length
    ? `<div class="d-index-wrap"><h3 class="d-index-h">Also</h3><ol class="d-index">${d.others.map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="d-ix-name">${esc(s.label)}</span>${priceTag(offerOf(m, s.id))}</li>`).join('')}</ol></div>`
    : '';
  const fo = offerOf(m, f.id);
  return `<section id="services" class="section ${bg} d-focus" aria-labelledby="services-h"><div class="wrap d-focus-grid${idx ? '' : ' single'}">
    <div><p class="eyebrow">${esc(trades(m) ? 'Main service' : `Featured ${P(m).noun}`)}</p><h2 id="services-h">${esc(f.label)}</h2>${svcText(m, f) ? `<p class="d-lead">${esc(svcText(m, f))}</p>` : ''}${fo ? `<p class="d-focus-price">${priceTag(fo)}</p>` : ''}${askLink(m, f.label)}</div>${idx}
  </div>${d.samplePrices ? `<div class="wrap">${sampleNote(m)}</div>` : ''}</section>`;
}

/* ───────────── team: portrait-split · strip ───────────── */
export function team({ m, l, bg }: Ctx): string {
  const d = D(m);
  if (!d.team) return '';
  const city = m.facts.city;
  // the trust row below already lists years / licence / insurance when the business states them
  const lines = [trades(m) ? `${m.business.name} works with homes${city ? ` in ${city}` : ''}${m.areas.length > 1 ? ' and nearby towns' : ''}.` : `The people at ${m.business.name}${city ? ` in ${city}` : ''}.`];
  if (m.facts.years && !m.trust.length) lines.push(`In business for ${m.facts.years} years.`);
  const h = dir(m) === 'modern-premium' ? 'The people behind it' : dir(m) === 'bold-direct' && trades(m) ? 'Our crew' : 'Meet the team';
  if (l.variant === 'strip') {
    return `<section id="team" class="section ${bg} d-team d-team-strip" aria-labelledby="team-h"><div class="wrap d-team-row"><div class="d-team-img">${picture(d.team)}${credit(d.team.desktop)}</div><div><h2 id="team-h">${esc(h)}</h2><p class="muted">${esc(lines.join(' '))}</p></div></div></section>`;
  }
  return `<section id="team" class="section ${bg} d-team" aria-labelledby="team-h"><div class="wrap d-team-grid"><div class="d-team-img">${picture(d.team)}${credit(d.team.desktop)}</div>
    <div class="stack"><h2 id="team-h">${esc(h)}</h2>${lines.map((t) => `<p class="d-lead">${esc(t)}</p>`).join('')}${trustRow(m)}</div></div></section>`;
}

/* ───────────── gallery: grid · masonry · strip · large (photos open the full-screen viewer) ───────────── */
export function fig(p: SiteImage, i: number, total: number, cls = '') {
  return `<figure class="${cls}"><button type="button" class="lb-open" data-lb-i="${i}" aria-label="Open photo ${i + 1} of ${total}"><img ${tileSrc(p.publicPath)} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" loading="lazy" decoding="async"></button>${p.credit ? `<figcaption>${esc(p.credit)}</figcaption>` : ''}</figure>`;
}
export function gallery({ m, l, bg }: Ctx): string {
  const ps = D(m).gallery;
  if (!ps.length) return '';
  const h = `<div class="sec-head"><h2 id="work-h">${esc(P(m).galleryTitle)}</h2></div>`;
  let body = '';
  if (l.variant === 'strip' && ps.length <= 3) {
    // too few to scroll: a plain row reads better than a mostly empty strip
    body = `<div class="gal cols d-grid" style="--cp:${Math.min(2, ps.length)};--cd:${ps.length}">${ps.map((p, i) => fig(p, i, ps.length)).join('')}</div>`;
  } else if (l.variant === 'strip') {
    body = `<div class="gal-wrap"><button type="button" class="gal-arrow l" aria-label="Previous photos">${icon('chevron-left', { size: 22 })}</button><div class="gal scroller" style="--pvp:1.25;--pvd:3.2" tabindex="0" aria-label="Photos, scroll sideways">${ps.map((p, i) => fig(p, i, ps.length)).join('')}</div><button type="button" class="gal-arrow r" aria-label="More photos">${icon('chevron-right', { size: 22 })}</button></div>`;
  } else if (l.variant === 'large') {
    body = `<div class="gal d-large">${ps.slice(0, 5).map((p, i) => fig(p, i, ps.length, i === 0 ? 'lead' : '')).join('')}</div>`;
  } else if (l.variant === 'masonry') {
    body = `<div class="gal d-masonry">${ps.slice(0, 7).map((p, i) => fig(p, i, ps.length)).join('')}</div>`;
  } else {
    const n = ps.length >= 6 ? 6 : 3;
    body = `<div class="gal cols d-grid" style="--cp:2;--cd:3">${ps.slice(0, n).map((p, i) => fig(p, i, ps.length)).join('')}</div>`;
  }
  return `<section id="work" class="section ${bg} d-proj d-proj-${esc(l.variant)}" aria-labelledby="work-h"><div class="wrap">${h}${body}</div></section>`;
}

/* ───────────── how it works ───────────── */
export function process({ m, bg }: Ctx): string {
  return `<section id="process" class="section ${bg} d-process" aria-labelledby="process-h"><div class="wrap"><div class="sec-head"><h2 id="process-h">How it works</h2></div>
    <ol class="d-steps">${D(m).steps.map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3><p class="muted">${esc(s.text)}</p></li>`).join('')}</ol></div></section>`;
}

/* ───────────── proof: review-cards · stat-band · pull-quote ───────────── */
const attrib = (m: SiteModel) => (m.proof.showRating ? `<p class="attrib">Ratings and reviews from Google.</p>` : '');
const chips = (m: SiteModel) => (m.trust.length ? `<ul class="chips">${m.trust.map((t) => `<li class="chip">${icon('badge-check', { size: 16 })} ${esc(t)}</li>`).join('')}</ul>` : '');
function quoteCards(m: SiteModel, max = 2) {
  if (!m.proof.quotes.length) return '';
  return `<div class="cols d-quotes" style="--cp:1;--cd:${Math.min(max, m.proof.quotes.length)}">${m.proof.quotes.slice(0, max).map((q) => `<figure class="card quote-card">${stars(q.rating)}<blockquote><p>“${esc(q.text)}”</p></blockquote><figcaption>${esc(q.author)} · Google review</figcaption></figure>`).join('')}</div>`;
}
export function proof({ m, l, bg }: Ctx): string {
  const p = m.proof;
  const t = p.showRating ? P(m).proofTitle(m.facts.city) : 'Good to know';
  if (l.variant === 'stat-band') {
    const stats = p.stats.length ? `<div class="cols d-stats" style="--cp:2;--cd:${Math.min(4, p.stats.length)}">${p.stats.map((s) => `<div class="stat"><span class="v${/^[\d.]+[★+]?$/.test(s.value) ? '' : ' word'}">${esc(s.value)}</span><span class="l">${esc(s.label)}</span></div>`).join('')}</div>` : chips(m);
    return `<section id="reviews" class="section d-stat-band" aria-labelledby="reviews-h"><div class="wrap"><div class="sec-head"><h2 id="reviews-h">${esc(p.showRating ? P(m).proofTitle() : t)}</h2></div>${stats}${quoteCards(m)}${attrib(m)}</div></section>`;
  }
  if (l.variant === 'pull-quote') {
    const meta = [p.showRating ? `<span>${stars(p.rating || 0, 15)} ${p.rating?.toFixed(1)} · ${p.reviewCount} Google reviews</span>` : '', ...m.trust.map((x) => `<span>${esc(x)}</span>`)].filter(Boolean).join('');
    const quote = p.reviews.length >= 2 ? reviewSlider(m, { big: true }) : p.quotes[0] ? `<figure class="d-pull"><blockquote><p>“${esc(p.quotes[0].text)}”</p></blockquote><figcaption>${esc(p.quotes[0].author)} · Google review</figcaption></figure>` : '';
    return `<section id="reviews" class="section ${bg} d-proof-pull" aria-labelledby="reviews-h"><div class="wrap"><div class="sec-head"><h2 id="reviews-h">${esc(p.showRating ? 'In their words' : t)}</h2></div>${quote}${meta ? `<div class="d-meta">${meta}</div>` : ''}${attrib(m)}</div></section>`;
  }
  const summary = p.showRating ? `<p class="badge-rating">${stars(p.rating || 0)} <span>${p.rating?.toFixed(1)} average from ${p.reviewCount} Google reviews</span></p>` : '';
  const cards = p.reviews.length >= 2 ? reviewSlider(m, { summary: false }) : quoteCards(m);
  return `<section id="reviews" class="section ${bg} d-proof-cards" aria-labelledby="reviews-h"><div class="wrap"><div class="sec-head"><h2 id="reviews-h">${esc(t)}</h2>${summary}</div>${chips(m)}${cards}${attrib(m)}</div></section>`;
}

/* ───────────── area / visit: coverage · chips · compact ───────────── */
export function area({ m, l, bg }: Ctx): string {
  const visit = P(m).hoursFirst;
  const towns = !visit && m.areas.length ? `<ul class="chips">${m.areas.map((a) => `<li class="chip">${icon('map-pin', { size: 15 })}${esc(a)}</li>`).join('')}</ul>` : '';
  const addr = m.contact.address ? `<p class="addr">${ic(m, 'building-2', 20)}<span>${esc(m.contact.address)}${m.contact.directionsUrl ? ` · <a href="${esc(m.contact.directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</span></p>` : '';
  const h = `<div class="sec-head"><h2 id="area-h">${esc(m.source?.region ? `Serving ${m.source.region}` : P(m).areaTitle(m.facts.city))}</h2></div>`;
  if (l.variant === 'compact') {
    const line = !visit && m.areas.length ? `<p class="d-lead">Serving ${esc(m.areas.slice(0, 6).join(', '))}${m.areas.length > 6 ? ' and nearby' : ''}.</p>` : '';
    return `<section id="area" class="section ${bg} d-area-compact" aria-labelledby="area-h"><div class="wrap d-area-cols"><div>${h}${line}${addr}</div><div>${hoursTable(m)}</div></div></section>`;
  }
  if (l.variant === 'chips') {
    return `<section id="area" class="section ${bg} d-area-chips" aria-labelledby="area-h"><div class="wrap">${h}<div class="d-area-cols"><div class="stack">${towns}${addr}</div><div>${hoursTable(m)}</div></div></div></section>`;
  }
  return `<section id="area" class="section ${bg} d-area-cover" aria-labelledby="area-h"><div class="wrap">${h}<div class="d-area-cols"><div class="stack">${towns}${addr}${hoursTable(m)}</div><div>${mapEmbed(m)}</div></div></div></section>`;
}

/* ───────────── request: split · inline · consultation ───────────── */
export function quote({ m, l, bg }: Ctx): string {
  const d = D(m);
  const tel = m.contact.tel && d.phoneOk;
  const sub = goal(m) === 'appointment'
    ? `Choose a preferred day and time. This sends a request: ${m.business.name} contacts you to confirm before anything is booked.`
    : goal(m) === 'call'
      ? `Prefer to write? Send a request and ${m.business.name} will get back to you.`
      : goal(m) === 'order'
        ? `Tell us what you would like and when. ${m.business.name} confirms what is available; nothing is charged online.`
        : goal(m) === 'enquiry'
          ? `Send a short message and ${m.business.name} will get back to you.`
          : `Tell us what you need${tel ? '' : ' and where you are'}.`;
  const callLine = tel && goal(m) !== 'call' ? `<p class="muted">Prefer to talk? Call <a href="${m.contact.tel}" data-ev="call">${esc(m.contact.phone)}</a>.</p>` : tel ? `<p class="muted">Or call <a href="${m.contact.tel}" data-ev="call">${esc(m.contact.phone)}</a>.</p>` : '';
  const h = `<h2 id="quote-h">${esc(m.copy.quoteTitle)}</h2>`;
  if (l.variant === 'split') {
    const steps = `<ol class="steps">${d.steps.map((s, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(s.title)}</b><p class="muted small">${esc(s.text)}</p></div></li>`).join('')}</ol>`;
    return `<section id="quote" class="section ${bg} d-quote d-quote-split" aria-labelledby="quote-h"><div class="wrap d-quote-grid"><div class="stack">${h}<p class="d-lead">${esc(sub)}</p>${callLine}${steps}</div><div class="card">${leadForm(m)}</div></div></section>`;
  }
  if (l.variant === 'inline') {
    return `<section id="quote" class="section ${bg} d-quote d-quote-inline" aria-labelledby="quote-h"><div class="wrap"><div class="sec-head">${h}<p class="muted">${esc(sub)}</p>${callLine}</div>${leadForm(m)}</div></section>`;
  }
  return `<section id="quote" class="section ${bg} d-quote d-quote-consult" aria-labelledby="quote-h"><div class="wrap d-narrow"><div class="sec-head center">${h}<p class="d-lead">${esc(sub)}</p>${callLine}</div>${leadForm(m)}</div></section>`;
}

/* ───────────── footer (the regular footer, styled per direction) ───────────── */
const FOOTER_VARIANT: Record<string, string> = { warm: 'four-col', dark: 'three-col', minimal: 'minimal-two-col', clean: 'four-col' };
export function footer(ctx: Ctx): string {
  return legacyFooter({ ...ctx, l: { ...ctx.l, variant: FOOTER_VARIANT[ctx.l.variant] || 'four-col' } });
}

/** Carousel behaviour (only on pages with a carousel hero): buttons, picker, arrow keys, swipe via native scroll. */
export const CAROUSEL_JS = `
(function(){var cz=document.querySelector('[data-cz]');if(!cz)return;
var track=cz.querySelector('.cz-track'),slides=[].slice.call(cz.querySelectorAll('[data-cz-slide]')),dots=[].slice.call(cz.querySelectorAll('[data-cz-go]')),cur=0;
cz.classList.add('cz-js');
function show(i,focus){cur=(i+slides.length)%slides.length;slides.forEach(function(s,k){var on=k===cur;s.hidden=false;s.setAttribute('aria-hidden',on?'false':'true');s.classList.toggle('is-on',on);[].forEach.call(s.querySelectorAll('a,button'),function(x){x.tabIndex=on?0:-1})});
track.scrollTo({left:slides[cur].offsetLeft-track.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.dataset.motion==='off'?'auto':'smooth'});
dots.forEach(function(d,k){if(k===cur)d.setAttribute('aria-current','true');else d.removeAttribute('aria-current')});if(focus)slides[cur].focus&&track.focus()}
cz.querySelector('[data-cz-prev]').addEventListener('click',function(){show(cur-1)});
cz.querySelector('[data-cz-next]').addEventListener('click',function(){show(cur+1)});
dots.forEach(function(d){d.addEventListener('click',function(){show(+d.getAttribute('data-cz-go'))})});
track.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){e.preventDefault();show(cur+1)}else if(e.key==='ArrowLeft'){e.preventDefault();show(cur-1)}});
var t;track.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){var w=track.clientWidth||1,i=Math.round(track.scrollLeft/w);if(i!==cur&&slides[i]){cur=i;dots.forEach(function(d,k){if(k===cur)d.setAttribute('aria-current','true');else d.removeAttribute('aria-current')});slides.forEach(function(s,k){s.setAttribute('aria-hidden',k===cur?'false':'true')})}},120)},{passive:true});
show(0);})();`;

export const DESIGN_RENDERERS: Record<string, (c: Ctx) => string> = { hero, intro, actions, urgent, services, focus, team, gallery, projects: gallery, process, proof, area, quote, footer };
