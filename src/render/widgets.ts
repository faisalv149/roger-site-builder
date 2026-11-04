import type { SiteModel } from '../content/model.js';
import { esc } from '../util/text.js';
import { icon } from './icons.js';
import { stars } from './parts.js';

/**
 * Interactive parts every generated site gets, whatever the theme, chosen from the business's data at build time:
 *  - review slider: 2+ Google reviews → a carousel (W3C APG carousel pattern: rotation pauses on hover/focus,
 *    a visible stop/start control first, labelled slides, swipe/arrows, Read more for long reviews)
 *  - photo lightbox: every gallery photo opens full screen (swipe, arrow keys, Esc, counter, credit)
 *  - Roger widget: Book / Chat / Call dock, bottom right. Demo content for now (a booking calendar, a scripted chat,
 *    the business number); bookings, chats and callback requests are sent to Roger as leads.
 * Plain inline CSS and JS: generated sites load nothing extra. Motion respects prefers-reduced-motion.
 */

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/* ───────────── review slider ───────────── */
/** summary: false when the section already shows the rating (stat row, badges) */
export function reviewSlider(m: SiteModel, opts: { big?: boolean; summary?: boolean } = {}): string {
  const rs = m.proof.reviews;
  const n = rs.length;
  const sum = m.proof.showRating && opts.summary !== false
    ? `<p class="rv-sum">${stars(m.proof.rating || 0, 18)}<b>${m.proof.rating?.toFixed(1)}</b><span>from ${m.proof.reviewCount} Google reviews</span></p>`
    : '<span></span>';
  const cards = rs.map((r, i) => `<figure class="rv-card" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}">
    ${stars(r.rating, opts.big ? 20 : 16)}
    <blockquote class="rv-text"><p>${esc(r.text)}</p></blockquote>
    <button type="button" class="rv-more" hidden>Read more</button>
    <figcaption class="rv-who"><span class="rv-av" aria-hidden="true" style="--h:${hue(r.author)}">${esc((r.author.trim()[0] || '?').toUpperCase())}</span><span><b>${esc(r.author)}</b><small>${r.when ? `${esc(r.when)} · ` : ''}Google review</small></span></figcaption>
  </figure>`).join('');
  return `<div class="rv${opts.big ? ' rv-big' : ''}" data-rv aria-roledescription="carousel" aria-label="Reviews from Google">
  <div class="rv-bar">${sum}<div class="rv-ctl">
    <button type="button" class="rv-btn" data-rv-play aria-label="Stop automatic slide show">${icon('pause', { size: 18 })}</button>
    <button type="button" class="rv-btn" data-rv-prev aria-label="Previous review">${icon('chevron-left', { size: 20 })}</button>
    <button type="button" class="rv-btn" data-rv-next aria-label="Next review">${icon('chevron-right', { size: 20 })}</button>
  </div></div>
  <div class="rv-track" data-rv-track>${cards}</div>
  <div class="rv-dots" aria-hidden="true">${rs.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
</div>`;
}

/* ───────────── photo lightbox ───────────── */
export function lightbox(m: SiteModel): string {
  if (!m.images.gallery.length) return '';
  const photos = m.images.gallery.map((p) => ({ src: p.publicPath, alt: p.alt, credit: p.credit || '' }));
  return `<dialog class="lb" data-lb aria-label="Photos">
  <script type="application/json" data-lb-photos>${JSON.stringify(photos).replace(/</g, '\\u003c')}</script>
  <figure class="lb-fig"><img alt="" data-lb-img><figcaption data-lb-cap></figcaption></figure>
  <p class="lb-count" data-lb-count aria-live="polite"></p>
  <button type="button" class="lb-btn lb-x" data-lb-close aria-label="Close">${icon('x', { size: 24 })}</button>
  <button type="button" class="lb-btn lb-prev" data-lb-prev aria-label="Previous photo">${icon('chevron-left', { size: 28 })}</button>
  <button type="button" class="lb-btn lb-next" data-lb-next aria-label="Next photo">${icon('chevron-right', { size: 28 })}</button>
</dialog>`;
}

/* ───────────── Roger widget ───────────── */

export function rogerWidget(m: SiteModel): string {
  if (m.theme.roger.widget === false) return '';
  const name = esc(m.business.name);
  // no phone on Google: no number is invented; the call panel offers a call back instead
  const phone = m.contact.phone && m.contact.tel ? { display: m.contact.phone, tel: m.contact.tel } : undefined;
  // the business's own online booking page (from its website), when there is one
  const booking = m.source?.booking && m.source.booking.kind === 'online' ? m.source.booking : undefined;
  const field = (id: string, label: string, type: string, auto: string) => `<label class="rw-f" for="${id}">${label}<input id="${id}" name="${type === 'tel' ? 'phone' : 'name'}" type="${type}" autocomplete="${auto}" required${type === 'tel' ? ' inputmode="tel"' : ''}></label>`;
  const panelHead = (id: string, title: string, sub = '') => `<header class="rw-ph"><span class="rw-ava" aria-hidden="true">R</span><span class="rw-pt"><b id="${id}">${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><button type="button" class="rw-x" data-rw-close aria-label="Close">${icon('x', { size: 20 })}</button></header>`;
  return `<div class="rw" data-rw data-state="min">
  ${booking ? `<section class="rw-panel" data-panel="book" role="dialog" aria-labelledby="rw-book-h" hidden>
    ${panelHead('rw-book-h', booking ? 'Book an appointment' : 'Request an appointment', `with ${name}`)}
    <div class="rw-pb">
      ${booking ? `<a class="rw-cta" href="${esc(booking.url)}" target="_blank" rel="noopener" data-ev="book">${icon('calendar-days', { size: 18 })} ${esc(booking.label)}</a><p class="rw-status">Opens ${name}'s own ${booking.platform ? `${esc(booking.platform)} ` : ''}booking page.</p><p class="rw-step">Or send a request</p>` : `<p class="rw-status">Tell ${name} when suits you. This is a request, not a booking: the business contacts you to confirm a time.</p>`}
      <form class="rw-form" data-rw-form="booking">
        ${field('rw-bn', 'Your name', 'text', 'name')}${field('rw-bp', 'Mobile phone', 'tel', 'tel')}
        <label class="rw-f" for="rw-bd">Preferred day<input id="rw-bd" name="day" type="text" placeholder="For example: any weekday" maxlength="60"></label>
        <label class="rw-f" for="rw-bt">Time of day<select id="rw-bt" name="time"><option>Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select></label>
        <button class="rw-cta${booking ? ' ghost' : ''}" type="submit">Send request</button>
      </form>
      <div class="rw-ok" data-rw-ok hidden>${icon('circle-check', { size: 40 })}<b>Request sent</b><span>${name} will contact you to confirm a time. Nothing is booked until they do.</span></div>
    </div>
  </section>` : ''}
  <section class="rw-panel" data-panel="chat" role="dialog" aria-labelledby="rw-chat-h" hidden>
    ${panelHead('rw-chat-h', 'Message', `Leave a message for ${name}`)}
    <div class="rw-msgs" data-rw-msgs aria-live="polite"></div>
    <div class="rw-quick" data-rw-quick></div>
    <form class="rw-say" data-rw-say><input name="t" type="text" placeholder="Type a message…" aria-label="Message" autocomplete="off"><button type="submit" aria-label="Send">${icon('send', { size: 18 })}</button></form>
  </section>
  <section class="rw-panel" data-panel="call" role="dialog" aria-labelledby="rw-call-h" hidden>
    ${panelHead('rw-call-h', `Call ${name}`)}
    <div class="rw-pb rw-call">
      ${phone ? `<a class="rw-num" href="${esc(phone.tel)}" data-ev="call">${icon('phone-call', { size: 22 })}${esc(phone.display)}</a>
      <p class="rw-status" data-rw-status></p>
      <a class="rw-cta" href="${esc(phone.tel)}" data-ev="call">${icon('phone', { size: 18 })} Call now</a>` : `<p class="rw-status">Leave your number and ${name} will call you back.</p>`}
      ${m.contact.sms ? `<a class="rw-cta ghost" href="${esc(m.contact.sms)}" data-ev="text">${icon('message-square', { size: 18 })} Text instead</a>` : ''}
      <details class="rw-cb"${phone ? '' : ' open'}><summary>${phone ? 'Prefer a call back?' : 'Request a call back'}</summary>
        <form class="rw-form" data-rw-form="callback">${field('rw-cn', 'Your name', 'text', 'name')}${field('rw-cp', 'Mobile phone', 'tel', 'tel')}<button class="rw-cta" type="submit">Call me back</button></form>
        <div class="rw-ok" data-rw-ok hidden>${icon('circle-check', { size: 36 })}<b>Got it</b><span>${name} will call you back shortly.</span></div>
      </details>
    </div>
  </section>
  <div class="rw-dock" role="toolbar" aria-label="Contact ${name}">
    ${booking ? `<button type="button" class="rw-btn" data-open="book" aria-expanded="false">${icon('calendar-days', { size: 24 })}<span>Book</span></button>` : ''}
    <button type="button" class="rw-btn" data-open="chat" aria-expanded="false">${icon('message-circle-more', { size: 24 })}<span>Chat</span><i class="rw-dot" aria-hidden="true"></i></button>
    <button type="button" class="rw-btn" data-open="call" aria-expanded="false">${icon('phone-call', { size: 24 })}<span>${phone ? 'Call' : 'Call back'}</span></button>
    <button type="button" class="rw-min" data-rw-min aria-label="Minimize">${icon('minus', { size: 16 })}</button>
  </div>
  <button type="button" class="rw-launch" data-rw-max aria-label="${booking ? 'Book, chat or call' : 'Chat with or call'} ${name}">${icon('message-circle-more', { size: 26 })}<i class="rw-dot" aria-hidden="true"></i></button>
</div>`;
}

/* ───────────── CSS ───────────── */
export const WIDGETS_CSS = (DESK: number) => `
/* review slider */
.rv{--per:1.08;--gapx:16px;margin-top:var(--sp-5,24px)}
@media (min-width:640px){.rv{--per:2}}
@media (min-width:${DESK}px){.rv{--per:3}}
.rv.rv-big{--per:1}
.rv-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.rv-sum{display:flex;align-items:center;gap:8px;margin:0;color:var(--ink-muted);font-size:var(--fs-sm)}
.rv-sum b{color:var(--ink);font-size:var(--fs-lg)}
.rv-ctl{display:flex;gap:8px}
.rv-btn{width:44px;height:44px;display:grid;place-items:center;border-radius:999px;border:1px solid rgba(0,0,0,.14);background:var(--surface);color:var(--ink);cursor:pointer;transition:border-color .2s,color .2s,transform .2s}
.rv-btn:hover{border-color:var(--brand);color:var(--brand-text)}
.rv-btn:active{transform:scale(.94)}
.rv-btn:focus-visible,.rv-more:focus-visible,.lb-open:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
.rv.rv-static .rv-ctl,.rv.rv-static .rv-dots{display:none}
.rv-track{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - (var(--per) - 1) * var(--gapx)) / var(--per));gap:var(--gapx);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;padding:4px 2px 14px}
.rv-track::-webkit-scrollbar{display:none}
.rv-card{scroll-snap-align:start;margin:0;display:flex;flex-direction:column;gap:12px;background:var(--surface);border:1px solid rgba(0,0,0,.07);border-radius:var(--r-md);box-shadow:var(--shadow);padding:var(--pad);transition:transform .25s,box-shadow .25s}
.rv-card .stars{color:#F5A524}
.rv-text{margin:0;font-size:var(--fs-md);line-height:1.6;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.rv-text p{margin:0}
.rv-card.open .rv-text{display:block;-webkit-line-clamp:unset}
.rv-more{align-self:flex-start;background:none;border:0;padding:0;color:var(--brand-text);font:inherit;font-size:var(--fs-sm);font-weight:700;cursor:pointer}
.rv-who{margin-top:auto;display:flex;align-items:center;gap:12px;font-size:var(--fs-sm)}
.rv-who small{display:block;color:var(--ink-muted)}
.rv-av{flex:none;width:40px;height:40px;display:grid;place-items:center;border-radius:50%;background:hsl(var(--h) 42% 40%);color:#fff;font-weight:700}
.rv-dots{display:flex;justify-content:center;gap:6px}
.rv-dots i{width:8px;height:8px;border-radius:99px;background:rgba(0,0,0,.18);transition:width .3s,background .3s}
.rv-dots i.on{width:24px;background:var(--brand)}
.rv-big .rv-card{align-items:center;text-align:center;padding:clamp(24px,5vw,56px)}
.rv-big .rv-text{font-family:var(--font-heading);font-size:var(--fs-xl);line-height:1.45;-webkit-line-clamp:5}
.rv-big .rv-who{margin-top:8px}
@media (hover:hover){.rv-card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,.12)}}

/* gallery: open full screen, arrows on scrollers, +N more */
.lb-open{display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:zoom-in;border-radius:var(--r-md);overflow:hidden;position:relative}
.lb-open img{transition:transform .5s cubic-bezier(.2,.8,.2,1)}
@media (hover:hover){.lb-open:hover img{transform:scale(1.04)}}
.gal-more{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.52);color:#fff;font-weight:800;font-size:clamp(28px,4vw,44px);letter-spacing:-.01em;border-radius:var(--r-md);pointer-events:none}
.bento{grid-auto-flow:dense}
@media (min-width:${DESK}px){.bento .fill{grid-column:span var(--span)}}
.gal-wrap{position:relative}
.gal-arrow{position:absolute;top:50%;z-index:2;width:48px;height:48px;margin-top:-28px;display:none;place-items:center;border:0;border-radius:999px;background:rgba(255,255,255,.92);color:var(--ink);box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;transition:opacity .2s,transform .2s}
.gal-arrow:hover{transform:scale(1.06)}
.gal-arrow[disabled]{opacity:0;pointer-events:none}
.gal-arrow.l{left:-12px}.gal-arrow.r{right:-12px}
@media (min-width:${DESK}px){.gal-wrap .gal-arrow{display:grid}}
.scroller{scroll-behavior:smooth}
.scroller figure{scroll-snap-align:start}
.lb{width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(10,12,16,.94);color:#fff}
.lb::backdrop{background:rgba(10,12,16,.94)}
.lb-fig{margin:0;height:100%;display:grid;place-items:center;padding:56px 16px 72px}
.lb-fig img{max-width:100%;max-height:calc(100vh - 140px);object-fit:contain;border-radius:8px;transition:opacity .25s}
.lb-fig img.loading{opacity:0}
.lb-fig figcaption{position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:13px;color:rgba(255,255,255,.75)}
.lb-count{position:absolute;top:18px;left:20px;margin:0;font-size:14px;color:rgba(255,255,255,.8)}
.lb-btn{position:absolute;display:grid;place-items:center;width:52px;height:52px;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;transition:background .2s}
.lb-btn:hover{background:rgba(255,255,255,.24)}
.lb-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}
.lb-x{top:10px;right:10px}.lb-prev{left:12px;top:50%;margin-top:-26px}.lb-next{right:12px;top:50%;margin-top:-26px}
html.lb-lock{overflow:hidden}

/* Roger widget */
.rw{--rw-bg:var(--ink);--rw-bg:color-mix(in oklab,var(--ink) 80%,var(--brand));position:fixed;right:20px;bottom:20px;z-index:60;font-size:15px}
.has-rw .sticky-bar,.has-rw .bubble{display:none}
.rw-dock{position:relative;display:flex;align-items:stretch;gap:4px;padding:8px 10px;border-radius:22px;background:var(--rw-bg);color:#fff;box-shadow:0 18px 40px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.18)}
.rw-btn{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:84px;min-height:64px;padding:8px 14px;border:0;border-radius:16px;background:transparent;color:inherit;font:inherit;font-weight:700;letter-spacing:.01em;cursor:pointer;transition:background .2s}
.rw-btn:hover,.rw-btn[aria-expanded=true]{background:rgba(255,255,255,.12)}
.rw-btn .ic{transition:transform .25s cubic-bezier(.3,1.6,.5,1)}
.rw-btn:hover .ic{transform:translateY(-3px) rotate(-6deg)}
.rw-btn:focus-visible,.rw-min:focus-visible,.rw-launch:focus-visible,.rw-x:focus-visible{outline:3px solid #fff;outline-offset:2px}
.rw-dot{position:absolute;top:12px;right:22px;width:9px;height:9px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 2px var(--rw-bg)}
.rw-dot::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid #22C55E;opacity:0;animation:rw-ping 2.4s ease-out infinite}
.rw-min{position:absolute;top:-12px;right:-12px;width:30px;height:30px;display:grid;place-items:center;border:2px solid var(--surface);border-radius:50%;background:var(--rw-bg);color:#fff;cursor:pointer;transition:transform .2s}
.rw-min:hover{transform:scale(1.1)}
.rw-launch{display:none;position:relative;width:62px;height:62px;place-items:center;border:0;border-radius:50%;background:var(--rw-bg);color:#fff;cursor:pointer;box-shadow:0 14px 32px rgba(0,0,0,.3)}
.rw-launch .rw-dot{top:10px;right:10px}
.rw[data-state=min] .rw-dock{display:none}
.rw[data-state=min] .rw-launch{display:grid;animation:rw-pop .35s cubic-bezier(.2,.9,.3,1.2) both}
.rw-panel{position:absolute;right:0;bottom:calc(100% + 14px);width:min(370px,calc(100vw - 32px));max-height:min(580px,calc(100vh - 150px));display:flex;flex-direction:column;overflow:hidden;border-radius:20px;background:var(--surface);color:var(--ink);box-shadow:0 28px 70px rgba(0,0,0,.28);transform-origin:bottom right;animation:rw-pop .28s cubic-bezier(.2,.9,.3,1.1) both}
.rw-panel[hidden]{display:none}
.rw-ph{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;background:var(--rw-bg);color:#fff}
.rw-ava{flex:none;width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:var(--brand);color:var(--brand-ink);font-weight:800}
.rw-pt{flex:1;min-width:0}.rw-pt b{display:block;font-size:16px}.rw-pt small{display:block;opacity:.75;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rw-x{width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}
.rw-pb{padding:16px;overflow-y:auto;display:grid;gap:10px}
.rw-step{margin:2px 0 0;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-muted)}
.rw-quick{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.rw-chip{flex:none;min-height:44px;padding:6px 12px;border:1px solid rgba(0,0,0,.14);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.rw-chip small{display:block;font-weight:500;font-size:11.5px;color:var(--ink-muted)}
.rw-chip:hover{border-color:var(--brand)}
.rw-chip[aria-pressed=true]{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
.rw-chip[aria-pressed=true] small{color:inherit;opacity:.85}
.rw-chip:focus-visible,.rw-cta:focus-visible,.rw-say input:focus-visible,.rw-f input:focus-visible,.rw-f select:focus-visible{outline:3px solid var(--brand);outline-offset:1px}
.rw-form{display:grid;gap:10px}
.rw-form[hidden],.rw-ok[hidden]{display:none}
.rw-pick{margin:4px 0 0;font-weight:700}
.rw-f{display:grid;gap:4px;font-size:13px;font-weight:600}
.rw-f input,.rw-f select,.rw-say input{width:100%;min-height:44px;padding:8px 12px;border:1px solid rgba(0,0,0,.18);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;font-size:16px}
.rw-cta{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:10px 16px;border:0;border-radius:14px;background:var(--brand);color:var(--brand-ink);font:inherit;font-weight:700;text-decoration:none;cursor:pointer;transition:filter .2s,transform .15s}
.rw-cta:hover{filter:brightness(1.06)}.rw-cta:active{transform:scale(.98)}
.rw-cta.ghost{background:transparent;color:var(--ink);border:1px solid rgba(0,0,0,.18)}
.rw-ok{display:grid;justify-items:center;gap:4px;padding:18px 8px;text-align:center}
.rw-ok .ic{color:#16A34A;animation:rw-pop .4s cubic-bezier(.2,.9,.3,1.4) both}
.rw-ok span{color:var(--ink-muted);font-size:14px}
.rw-call{justify-items:stretch}
.rw-num{display:flex;align-items:center;justify-content:center;gap:10px;padding:6px 0 0;font-size:24px;font-weight:800;color:var(--ink);text-decoration:none}
.rw-status{margin:0 0 4px;text-align:center;font-size:14px;color:var(--ink-muted)}
.rw-status.open{color:#16A34A;font-weight:700}
.rw-cb summary{cursor:pointer;font-size:14px;font-weight:600;color:var(--brand-text);padding:8px 0}
.rw-cb .rw-form{margin-top:6px}
.rw-msgs{flex:1;min-height:200px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:var(--surface-alt)}
.rw-m{max-width:84%;padding:9px 13px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-line;animation:rw-msg .25s ease-out both}
.rw-m.r{align-self:flex-start;background:var(--surface);border:1px solid rgba(0,0,0,.07);border-bottom-left-radius:6px}
.rw-m.u{align-self:flex-end;background:var(--brand);color:var(--brand-ink);border-bottom-right-radius:6px}
.rw-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;border-radius:16px;background:var(--surface);border:1px solid rgba(0,0,0,.07)}
.rw-typing i{width:7px;height:7px;border-radius:50%;background:var(--ink-muted);opacity:.5;animation:rw-blink 1.1s infinite}
.rw-typing i:nth-child(2){animation-delay:.15s}.rw-typing i:nth-child(3){animation-delay:.3s}
.rw-quick{padding:10px 12px 0;background:var(--surface)}
.rw-quick:empty{display:none}
.rw-msgs .rw-form{align-self:stretch;padding:12px;border-radius:14px;background:var(--surface);border:1px solid rgba(0,0,0,.07)}
.rw-say{display:flex;gap:8px;padding:10px 12px 12px;background:var(--surface);border-top:1px solid rgba(0,0,0,.07)}
.rw-say button{flex:none;width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:12px;background:var(--brand);color:var(--brand-ink);cursor:pointer}
@keyframes rw-in{from{opacity:0;transform:translateY(26px) scale(.96)}}
@keyframes rw-pop{from{opacity:0;transform:translateY(10px) scale(.94)}}
@keyframes rw-msg{from{opacity:0;transform:translateY(6px)}}
@keyframes rw-ping{0%{transform:scale(.6);opacity:.9}80%,100%{transform:scale(2.2);opacity:0}}
@keyframes rw-blink{0%,80%,100%{opacity:.3;transform:none}40%{opacity:1;transform:translateY(-2px)}}
.rw{animation:rw-in .55s .9s cubic-bezier(.2,.8,.2,1) both}
@media (max-width:${DESK - 1}px){
  .rw{left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom))}
  .rw-dock{justify-content:space-around;padding:6px}
  .rw-btn{flex:1;min-width:0;min-height:58px;padding:6px}
  .rw[data-state=min]{left:auto}
  .rw-panel{width:100%;max-height:calc(100vh - 120px)}
  .has-rw{padding-bottom:96px}
}
@media (prefers-reduced-motion:reduce){.rw,.rw-panel,.rw-m,.rw-ok .ic,.rw[data-state=min] .rw-launch{animation:none}.rw-dot::after,.rw-typing i{animation:none}.rv-card,.lb-open img,.rw-btn .ic{transition:none}}
`;

/* ───────────── JS ───────────── */
export const WIDGETS_JS = (m: SiteModel) => {
  const phone = m.contact.phone || '';
  const cfg = {
    name: m.business.name,
    phone,
    endpoint: m.urls.leadEndpoint,
    hours: m.hours.compact.map((h) => `${h.days}: ${h.time}`),
    services: m.services.items.slice(0, 4).map((s) => s.label),
    // appointments are offered only when the business takes bookings online (its own booking page)
    book: !!(m.source?.booking && m.source.booking.kind === 'online'),
  };
  return `
(function(){
  'use strict'; // block-level helpers stay in their block (a sloppy-mode 'close' in the lightbox used to replace the widget's)
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $=function(s,el){return (el||document).querySelector(s)}, $$=function(s,el){return [].slice.call((el||document).querySelectorAll(s))};
  var PAUSE=${JSON.stringify(icon('pause', { size: 18 }))}, PLAY=${JSON.stringify(icon('play', { size: 18 }))};

  /* review slider */
  $$('[data-rv]').forEach(function(rv){
    var track=$('[data-rv-track]',rv), cards=$$('.rv-card',track), dots=$$('.rv-dots i',rv), play=$('[data-rv-play]',rv);
    var auto=!reduce, hold=false, seen=false, timer;
    function at(){var x=track.scrollLeft,best=0,d=1e9;cards.forEach(function(c,i){var dd=Math.abs(c.offsetLeft-x);if(dd<d){d=dd;best=i}});return best}
    function go(i){var n=cards.length;i=(i+n)%n;track.scrollTo({left:cards[i].offsetLeft,behavior:reduce?'auto':'smooth'})}
    function atEnd(){return track.scrollLeft+track.clientWidth>=track.scrollWidth-6}
    function next(){ if(atEnd()) go(0); else go(at()+1) }
    function prev(){ if(track.scrollLeft<=6) go(cards.length-1); else go(at()-1) }
    function sync(){var i=at();dots.forEach(function(d,k){d.classList.toggle('on',k===i)})}
    var raf;track.addEventListener('scroll',function(){cancelAnimationFrame(raf);raf=requestAnimationFrame(sync)},{passive:true});
    $('[data-rv-next]',rv).addEventListener('click',next);
    $('[data-rv-prev]',rv).addEventListener('click',prev);
    function setPlay(on){auto=on;play.innerHTML=on?PAUSE:PLAY;play.setAttribute('aria-label',on?'Stop automatic slide show':'Start automatic slide show')}
    play.addEventListener('click',function(){setPlay(!auto)});
    if(reduce) setPlay(false);
    rv.addEventListener('mouseenter',function(){hold=true}); rv.addEventListener('mouseleave',function(){hold=false});
    rv.addEventListener('focusin',function(){hold=true}); rv.addEventListener('focusout',function(e){if(!rv.contains(e.relatedTarget)) hold=false});
    track.addEventListener('touchstart',function(){hold=true},{passive:true});
    if('IntersectionObserver' in window) new IntersectionObserver(function(es){seen=es[0].isIntersecting},{threshold:.35}).observe(rv); else seen=true;
    timer=setInterval(function(){ if(auto&&!hold&&seen&&!document.hidden) next() },6500);
    function fit(){ rv.classList.toggle('rv-static',track.scrollWidth<=track.clientWidth+4) }
    cards.forEach(function(c){var t=$('.rv-text',c),b=$('.rv-more',c);
      if(t.scrollHeight>t.clientHeight+4){b.hidden=false;b.addEventListener('click',function(){var o=c.classList.toggle('open');b.textContent=o?'Show less':'Read more'})}});
    fit(); addEventListener('resize',fit);
  });

  /* gallery: arrows on scrollers */
  $$('.gal-wrap').forEach(function(w){
    var sc=$('.scroller',w), l=$('.gal-arrow.l',w), r=$('.gal-arrow.r',w); if(!sc||!l) return;
    function step(){var f=sc.querySelector('figure');return f?f.getBoundingClientRect().width+12:sc.clientWidth*.8}
    function upd(){l.disabled=sc.scrollLeft<=4;r.disabled=sc.scrollLeft+sc.clientWidth>=sc.scrollWidth-4}
    l.addEventListener('click',function(){sc.scrollBy({left:-step(),behavior:reduce?'auto':'smooth'})});
    r.addEventListener('click',function(){sc.scrollBy({left:step(),behavior:reduce?'auto':'smooth'})});
    sc.addEventListener('scroll',upd,{passive:true}); addEventListener('resize',upd); upd();
  });

  /* lightbox */
  var lb=$('[data-lb]');
  if(lb && lb.showModal){
    var photos=JSON.parse($('[data-lb-photos]',lb).textContent), img=$('[data-lb-img]',lb), cap=$('[data-lb-cap]',lb), count=$('[data-lb-count]',lb), cur=0, opener=null;
    function lbShow(i){cur=(i+photos.length)%photos.length;var p=photos[cur];img.classList.add('loading');img.onload=function(){img.classList.remove('loading')};img.src=p.src;img.alt=p.alt||'';cap.textContent=p.credit||'';count.textContent=(cur+1)+' / '+photos.length}
    function lbClose(){lb.close()}
    $$('[data-lb-i]').forEach(function(b){b.addEventListener('click',function(){opener=b;lbShow(+b.getAttribute('data-lb-i'));document.documentElement.classList.add('lb-lock');lb.showModal()})});
    lb.addEventListener('close',function(){document.documentElement.classList.remove('lb-lock');if(opener) opener.focus()});
    $('[data-lb-close]',lb).addEventListener('click',lbClose);
    $('[data-lb-prev]',lb).addEventListener('click',function(){lbShow(cur-1)});
    $('[data-lb-next]',lb).addEventListener('click',function(){lbShow(cur+1)});
    lb.addEventListener('click',function(e){if(e.target===lb||e.target.classList.contains('lb-fig')) lbClose()});
    lb.addEventListener('keydown',function(e){if(e.key==='ArrowLeft') lbShow(cur-1); if(e.key==='ArrowRight') lbShow(cur+1)});
    var sx=null;lb.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});
    lb.addEventListener('touchend',function(e){if(sx===null) return;var dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>50) lbShow(cur+(dx<0?1:-1));sx=null});
  }

  /* the business's videos: nothing loads until a visitor presses play */
  $$('[data-video]').forEach(function(box){
    var btn=$('.f-video-play',box); if(!btn) return;
    function fail(){ box.classList.add('is-failed'); var p=document.createElement('p'); p.className='f-video-fail'; p.innerHTML='This video can\u2019t play here right now. <a target="_blank" rel="noopener"></a>'; var a=$('a',p); a.href=box.dataset.page; a.textContent='Watch it on '+box.dataset.host; box.appendChild(p); btn.hidden=true }
    btn.addEventListener('click',function(){
      var kind=box.dataset.kind, src=box.dataset.src, el;
      if(kind==='youtube'||kind==='vimeo'||kind==='embed'){ el=document.createElement('iframe'); el.src=src.replace('youtube.com','youtube-nocookie.com')+(src.indexOf('?')>-1?'&':'?')+'autoplay=1'; el.allow='autoplay; encrypted-media; picture-in-picture'; el.allowFullscreen=true; el.title=box.dataset.title; el.loading='lazy'; box.appendChild(el); btn.hidden=true; return }
      el=document.createElement('video'); el.controls=true; el.playsInline=true; el.autoplay=true; el.setAttribute('aria-label',box.dataset.title);
      if(kind==='hls'&&!el.canPlayType('application/vnd.apple.mpegurl')){ fail(); return }
      el.addEventListener('error',fail); el.src=src; box.appendChild(el); btn.hidden=true; var pr=el.play(); if(pr&&pr.catch) pr.catch(function(){}) });
  });

  /* Roger widget */
  var rw=$('[data-rw]'); if(!rw) return;
  var C=${JSON.stringify(cfg).replace(/</g, '\\u003c')}, KEY='roger-widget:'+location.pathname, opened=null, trigger=null;
  try{ if(localStorage.getItem(KEY)==='open') rw.setAttribute('data-state','closed') }catch(e){}
  function remember(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  function panel(n){return $('[data-panel="'+n+'"]',rw)}
  function open(n,from){ /* a booking panel needs no setup */ if(opened===n){close();return} close(true); opened=n; trigger=from||null; var p=panel(n); p.hidden=false;
    $$('.rw-btn',rw).forEach(function(b){b.setAttribute('aria-expanded',String(b.getAttribute('data-open')===n))});
    rw.setAttribute('data-state','open'); if(n==='chat') chatStart();  if(n==='call') callStatus();
    var f=$(n==='chat'?'.rw-say input':'button,a,input',$('.rw-pb,.rw-say',p)||p); if(f&&matchMedia('(min-width:${900}px)').matches) f.focus() }
  function close(quiet){ if(!opened) return; panel(opened).hidden=true; opened=null; $$('.rw-btn',rw).forEach(function(b){b.setAttribute('aria-expanded','false')}); rw.setAttribute('data-state','closed'); if(!quiet&&trigger) trigger.focus() }
  $$('.rw-btn',rw).forEach(function(b){b.addEventListener('click',function(){open(b.getAttribute('data-open'),b)})});
  $$('[data-rw-close]',rw).forEach(function(b){b.addEventListener('click',function(){close()})});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&opened) close()});
  document.addEventListener('click',function(e){if(opened&&!rw.contains(e.target)) close(true)});
  $('[data-rw-min]',rw).addEventListener('click',function(){close(true);rw.setAttribute('data-state','min');remember('min');$('[data-rw-max]',rw).focus()});
  $('[data-rw-max]',rw).addEventListener('click',function(){rw.setAttribute('data-state','closed');remember('open');$('.rw-btn',rw).focus()});

  function send(kind,fields,extra){
    var body={name:fields.name,phone:fields.phone,service:kind,message:extra||'',page:location.href};
    return fetch(C.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){if(!r.ok) throw new Error(r.status)});
  }
  function wire(form,kind,extra,onOk){
    form.addEventListener('submit',function(ev){ev.preventDefault();var fd=new FormData(form),btn=form.querySelector('button[type=submit]');btn.disabled=true;
      send(kind,{name:fd.get('name'),phone:fd.get('phone')},typeof extra==='function'?extra():extra)
        .then(function(){onOk(fd.get('name'))})
        .catch(function(){btn.disabled=false;btn.textContent=C.phone?'Could not send. Call '+C.phone:'Could not send. Please try again'})});
  }

  /* open now (shared with the hours section) */
  function openNow(){var el=document.querySelector('[data-open-now]');return el&&!el.hidden?el.classList.contains('is-open'):null}
  function callStatus(){var s=$('[data-rw-status]',rw),o=openNow();s.className='rw-status'+(o?' open':'');s.textContent=o===null?'':o?'Open now.':'Closed right now. Leave a message or ask for a call back.'}

  /* book: an appointment request (no calendar: availability isn't known); it reaches the business as a lead */
  var bf=$('[data-rw-form=booking]',rw);
  if(bf) wire(bf,'Appointment request',function(){var fd=new FormData(bf);var d=String(fd.get('day')||'').trim();return 'Appointment request. Preferred day: '+(d||'any')+'. Time of day: '+(fd.get('time')||'any')+'.'},function(){bf.hidden=true;var ok=$('[data-rw-ok]',panel('book'));ok.hidden=false;var st=$('.rw-status',panel('book'));if(st) st.hidden=true;var cta=$('a.rw-cta',panel('book'));if(cta) cta.hidden=true;var sp=$('.rw-step',panel('book'));if(sp) sp.hidden=true});
  var cb=$('[data-rw-form=callback]',rw); wire(cb,'Call back request','',function(){cb.hidden=true;cb.nextElementSibling.hidden=false});

  /* chat: a scripted Roger (demo); what the visitor asks for is sent to Roger as a lead */
  var msgs=$('[data-rw-msgs]',rw), quick=$('[data-rw-quick]',rw), talk=[], chatReady=false, asked=false;
  function bubble(t,who){var b=document.createElement('div');b.className='rw-m '+who;b.textContent=t;msgs.appendChild(b);msgs.scrollTop=1e9;talk.push((who==='u'?'Visitor: ':'Roger: ')+t)}
  function roger(t,then){var ty=document.createElement('div');ty.className='rw-typing';ty.innerHTML='<i></i><i></i><i></i>';msgs.appendChild(ty);msgs.scrollTop=1e9;
    setTimeout(function(){ty.remove();bubble(t,'r');if(then) then()},reduce?150:700+Math.min(900,t.length*12))}
  function chips(list){quick.innerHTML='';list.forEach(function(l){var b=document.createElement('button');b.type='button';b.className='rw-chip';b.textContent=l;b.addEventListener('click',function(){userSays(l)});quick.appendChild(b)})}
  function askContact(){ if(asked) return; asked=true; chips([]);
    roger('What is your name and the best number to reach you? '+C.name+' will get back to you shortly.',function(){
      var f=document.createElement('form');f.className='rw-form';f.innerHTML='<label class="rw-f">Your name<input name="name" autocomplete="name" required></label><label class="rw-f">Mobile phone<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label><button class="rw-cta" type="submit">Send to '+C.name.replace(/[<&>"]/g,'')+'</button>';
      msgs.appendChild(f);msgs.scrollTop=1e9;f.querySelector('input').focus();
      wire(f,'Chat',function(){return talk.join('\\n')},function(n){f.remove();bubble('Sent','u');roger('Thanks '+String(n).split(' ')[0]+'! '+C.name+' has your message and will reach out soon.')})})}
  function userSays(t){bubble(t,'u');var s=t.toLowerCase();
    if(/hour|open|close/.test(s)) roger(C.hours.length?'The hours listed are:\\n'+C.hours.join('\\n'):C.phone?'No hours are listed here. Call '+C.phone+' to ask.':'No hours are listed here. Leave your number and the business will tell you.',function(){chips(C.book?['Request an appointment','Send a message','Call me back']:['Send a message','Call me back'])});
    else if(C.book&&/book|visit|appoint|schedul/.test(s)) roger('I can open the appointment request. The business confirms the time with you.',function(){setTimeout(function(){open('book')},500)});
    else if(/quote|price|cost|estimate/.test(s)&&!asked) roger('Happy to help. What do you need?',function(){chips(C.services.concat(['Something else']))});
    else if(/call|phone|ring/.test(s)) roger(C.phone?'You can call us at '+C.phone+', or I can have someone call you back.':'Leave your number and someone will call you back.',askContact);
    else askContact();
  }
  function chatStart(){ if(chatReady) return; chatReady=true;
    roger("Hi, I'm Roger, an assistant on "+C.name+"'s website. I can pass a message to the business, show the hours it has listed"+(C.book?", or send an appointment request":"")+". What would you like?",function(){chips(C.book?['Send a message','Request an appointment','Hours','Call me back']:['Send a message','Hours','Call me back'])}) }
  $('[data-rw-say]',rw).addEventListener('submit',function(e){e.preventDefault();var i=$('input',e.currentTarget),t=i.value.trim();if(!t) return;i.value='';userSays(t)});
})();`;
};
