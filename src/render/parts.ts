import type { SiteModel } from '../content/model.js';
import { esc } from '../util/text.js';
import { icon } from './icons.js';

/** Grid item: span N columns on desktop; an offset pins the start line, otherwise items flow side by side. */
export const gi = (span?: number, offset?: number) =>
  `class="gi" style="${span ? `--s:${span};` : ''}${offset ? `--start:${offset + 1};` : ''}"`;

export const colsVar = (c?: { phone?: number; desktop?: number }, fallback = { phone: 1, desktop: 3 }) =>
  `--cp:${c?.phone ?? fallback.phone};--cd:${c?.desktop ?? fallback.desktop}`;

export function ic(m: SiteModel, name: string, size?: number) {
  return icon(name, { size: size ?? m.theme.icons.size, stroke: m.theme.icons.stroke });
}

const DEFAULT_TITLES: Record<string, string> = {
  services: 'What we do',
  proof: 'Why neighbors choose us',
  gallery: 'Recent work',
  area: 'Where we work',
  quoteSub: 'Tell us what you need. We usually reply the same day.',
};

export function title(m: SiteModel, key: string): string {
  const custom = (m.theme.copy as any).titles?.[key];
  if (custom) return custom;
  if (key === 'area' && m.facts.city) return `Serving ${m.facts.city} and nearby`;
  if (key === 'proof' && m.facts.city && m.proof.showRating) return `Trusted in ${m.facts.city}`;
  return DEFAULT_TITLES[key] || key;
}

export function head(id: string, h: string, sub?: string, center = false) {
  return `<div class="sec-head${center ? ' center' : ''}"><h2 id="${id}-h">${esc(h)}</h2>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>`;
}

export function stars(n: number, size = 16) {
  if (!n) return ''; // a testimonial with no rating shows no stars
  const full = Math.round(n);
  return `<span class="stars" role="img" aria-label="${n} out of 5 stars">${Array.from({ length: 5 }, (_, i) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${i < full ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`).join('')}</span>`;
}

export function primaryCta(m: SiteModel, extraCls = '') {
  if (m.copy.actionKind === 'call' && m.contact.tel) {
    return `<a class="btn btn-primary ${extraCls}" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 20 })}<span>${esc(m.copy.action)}</span></a>`;
  }
  return `<a class="btn btn-primary ${extraCls}" href="#quote" data-ev="quote">${esc(m.copy.action)}</a>`;
}

export function secondaryCta(m: SiteModel, extraCls = '') {
  if (m.copy.actionKind === 'call') return `<a class="btn btn-secondary ${extraCls}" href="#quote">${esc(m.copy.quoteTitle)}</a>`;
  if (m.contact.tel) return `<a class="btn btn-secondary ${extraCls}" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 18 })}<span>${esc(m.contact.phone)}</span></a>`;
  return '';
}

export function ratingBadge(m: SiteModel) {
  if (!m.proof.showRating) return '';
  return `<span class="badge-rating">${stars(m.proof.rating || 0)}<span>${m.proof.rating?.toFixed(1)} · ${m.proof.reviewCount} Google reviews</span></span>`;
}

export function trustRow(m: SiteModel) {
  if (!m.trust.length) return '';
  return `<ul class="trust-row">${m.trust.map((t) => `<li>${icon('badge-check', { size: 18 })}${esc(t)}</li>`).join('')}</ul>`;
}

let formSeq = 0;
/** Lead form. Posts JSON to the builder's /api/leads/:slug (falls back to a normal POST without JS). */
export function leadForm(m: SiteModel, opts: { compact?: boolean; title?: string; light?: boolean } = {}) {
  const id = `f${++formSeq}`;
  const svc = m.services.items.map((s) => `<option>${esc(s.label)}</option>`).join('');
  const consent = m.theme.roger.consentCopy ? `<p class="consent">${esc(m.theme.roger.consentCopy)}</p>` : '';
  // personalised builds say what the form is for; an appointment is a request until the business confirms it
  const goal = m.design?.plan.goal;
  const appt = goal === 'appointment';
  const kind = goal ? `<input type="hidden" name="kind" value="${appt ? 'appointment-request' : goal === 'call' ? 'message' : goal === 'order' ? 'order-enquiry' : goal === 'enquiry' ? 'enquiry' : 'quote-request'}">` : '';
  const noun = m.design?.profile.noun ?? 'service';
  const trades = !m.design || m.design.plan.category === 'trades';
  const when = appt ? `<div class="row2"><label for="${id}-day">Preferred day<input id="${id}-day" name="preferredDate" type="date" data-min-today></label>
    <label for="${id}-time">Time of day<select id="${id}-time" name="preferredTime"><option value="">Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select></label></div>` : '';
  const submit = appt ? 'Send appointment request' : goal === 'order' ? 'Send order enquiry' : goal === 'enquiry' ? 'Send enquiry' : m.copy.actionKind === 'form' ? m.copy.action : m.copy.quoteTitle;
  // shown only when a delivery channel has acknowledged the enquiry; otherwise the page says what is known (it was saved) and how to be sure
  const ok = appt
    ? `Request sent. ${m.business.name} will contact you to confirm a time; nothing is booked until they do.`
    : `Thanks! Your request was sent to ${m.business.name}, who will reach out shortly.`;
  const saved = `Your request was saved, but we could not confirm that ${m.business.name} received it.${m.contact.phone ? ` Please call ${m.contact.phone} to be sure.` : ' Please contact them directly to be sure.'}`;
  return `<form class="form lead-form" method="post" action="${esc(m.urls.leadEndpoint)}" data-business="${esc(m.business.name)}" data-saved="${esc(saved)}">
  ${opts.title ? `<h3 class="form-title h">${esc(opts.title)}</h3>` : ''}
  <div class="fields">
    <div class="row2">
      <label for="${id}-name">Name<input id="${id}-name" name="name" autocomplete="name" required></label>
      <label for="${id}-phone">Mobile phone<input id="${id}-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label>
    </div>
    ${opts.compact ? '' : `<div class="row2"><label for="${id}-email"><span>Email <span class="muted">(optional)</span></span><input id="${id}-email" name="email" type="email" autocomplete="email"></label>
    ${trades ? `<label for="${id}-zip">ZIP code<input id="${id}-zip" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10"></label>` : ''}</div>`}
    ${svc ? `<label for="${id}-svc">What do you need?<select id="${id}-svc" name="service"><option value="">Choose ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${esc(noun)}</option>${svc}<option>Something else</option></select></label>` : ''}
    ${when}
    ${opts.compact ? '' : `<label for="${id}-msg"><span>Details <span class="muted">(optional)</span></span><textarea id="${id}-msg" name="message" rows="3"></textarea></label>`}
    ${kind}
    <div class="hp" aria-hidden="true"><input type="text" name="company_website" tabindex="-1" autocomplete="off"></div>
    <button class="btn btn-primary btn-block" type="submit">${esc(submit)}</button>
    ${consent}
  </div>
  <p class="ok" role="status">${esc(ok)}</p>
</form>`;
}

export function nextSteps(m: SiteModel) {
  const steps = [
    ['Tell us what you need', 'A few details about the job and where you are.'],
    [m.copy.actionKind === 'call' ? 'We call or text you back' : 'We text you back', 'Usually the same business day.'],
    ['Get a clear estimate', 'Straight answers before any work starts.'],
  ];
  return `<ol class="steps">${steps.map(([a, b], i) => `<li><span class="n">${i + 1}</span><div><b>${esc(a)}</b><p class="muted small">${esc(b)}</p></div></li>`).join('')}</ol>`;
}

export function hoursTable(m: SiteModel) {
  if (!m.hours.rows.length) return '';
  const open = m.hours.showOpenNow ? `<p class="open-now" data-open-now hidden></p>` : '';
  if (m.hours.compact.length === 1) return `${open}<table class="hours"><tbody><tr><td>${esc(m.hours.compact[0].days)}</td><td>${esc(m.hours.compact[0].time)}</td></tr></tbody></table>`;
  return `${open}<table class="hours"><tbody>${m.hours.rows.map((r) => `<tr data-day="${esc(r.day)}"><td>${esc(r.day)}</td><td>${esc(r.time)}</td></tr>`).join('')}</tbody></table>`;
}

export function mapEmbed(m: SiteModel) {
  if (!m.showMap) return '';
  const q = m.business.formattedAddress || `${m.business.lat},${m.business.lng}`;
  return `<iframe class="map" title="Map showing ${esc(m.business.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(`${m.business.name}, ${q}`)}&output=embed"></iframe>`;
}

export function img(i: { publicPath: string; width: number; height: number; alt: string }, opts: { eager?: boolean; cls?: string; sizes?: string } = {}) {
  return `<img src="${esc(i.publicPath)}" width="${i.width}" height="${i.height}" alt="${esc(i.alt)}"${opts.cls ? ` class="${opts.cls}"` : ''} ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"${opts.sizes ? ` sizes="${opts.sizes}"` : ''}>`;
}
