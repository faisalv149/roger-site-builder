/**
 * The splash page's dock and quote sheet: Roger's own component (never written by the AI), the same on every page.
 *
 *  under 1024px  a floating glass capsule, bottom centre, 12px above the safe area, 64px tall: up to three secondary
 *                tiles (44px app-icon squares, short label) and the main action as a brand-filled capsule at the right.
 *                Scrolling down shrinks it to the main action and a round "more" button; scrolling up or tapping
 *                restores it.
 *  1024px+       a vertical glass capsule on the right edge, 16px in, centred: up to five 52px tiles, the main action
 *                on top in the brand colour, Mac-style magnification on hover (1.25×, neighbours 1.1×), labels in a
 *                glass tooltip on hover and keyboard focus.
 *
 * Works without JavaScript (links, and a quote sheet opened as the page's #quote target); the script (well under
 * 30 KB) only shrinks and restores the dock, magnifies on desktop, and sends the quote form in place. Reduced motion:
 * no animation. Reduced transparency (or no backdrop blur): solid surfaces. Calm trades: no motion at all.
 */
export type DockKind = 'call' | 'text' | 'book' | 'order' | 'reserve' | 'quote' | 'directions' | 'menu';
export interface DockAction { kind: DockKind; label: string; short: string; href: string; external?: boolean }

const ICON: Record<DockKind | 'more', string> = {
  call: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
  text: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"/>',
  book: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  order: '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  reserve: '<path d="M4 10h16M6 10v9M18 10v9M8 6h8"/>',
  quote: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  directions: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
};
const icon = (k: DockKind | 'more') => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** relative luminance and contrast (WCAG) */
function lum(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** the brand colour darkened until white text on it reaches 4.5:1 */
export function onBrand(hex: string): { bg: string; fg: string } {
  let h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#1F2937';
  for (let i = 0; i < 20 && contrast(h, '#ffffff') < 4.5; i++) h = `#${h.slice(1).match(/../g)!.map((x) => Math.max(0, Math.round(parseInt(x, 16) * 0.9)).toString(16).padStart(2, '0')).join('')}`;
  return { bg: h, fg: '#ffffff' };
}

export interface DockOpts { main: DockAction; secondary: DockAction[]; brand: string; calm: boolean; minimalContact: boolean; quoteAction?: string; privacyUrl?: string; businessName: string }

const tile = (a: DockAction, cls: string) => `<a class="${cls}" href="${esc(a.href)}" data-event="dock_${a.kind}" data-screen="dock"${a.external ? ' target="_blank" rel="noopener"' : ''}><span class="rg-ic">${icon(a.kind)}</span><span class="rg-lb">${esc(a.short)}</span></a>`;

/** the mobile capsule's label: a long one ("Book an appointment") gives way to a shorter one on narrow phones */
function mainLabel(a: DockAction): string {
  if (a.label.length <= 12) return `<span>${esc(a.label)}</span>`;
  const mid = a.href.startsWith('#') ? 'Request' : ({ book: 'Book now', order: 'Order now', reserve: 'Reserve', call: 'Call now', text: 'Text us', directions: 'Directions', quote: 'Get a quote', menu: a.short } as Record<string, string>)[a.kind] ?? a.short;
  return `<span class="rg-ml">${esc(a.label)}</span><span class="rg-ms" aria-hidden="true">${esc(mid)}</span>`;
}

export function dockHtml(o: DockOpts): string {
  const mobileSecondary = o.secondary.slice(0, 3), desktop = [o.main, ...o.secondary].slice(0, 5);
  return `<nav class="rg-dock" aria-label="Quick actions" data-calm="${o.calm ? 1 : 0}">
<div class="rg-dock__bar">${mobileSecondary.map((a) => tile(a, 'rg-tile rg-sec')).join('')}<button type="button" class="rg-tile rg-more" aria-label="More actions" hidden><span class="rg-ic">${icon('more')}</span></button><a class="rg-main" href="${esc(o.main.href)}" data-event="dock_${o.main.kind}" data-screen="dock"${o.main.external ? ' target="_blank" rel="noopener"' : ''}>${icon(o.main.kind)}${mainLabel(o.main)}</a></div>
<div class="rg-dock__rail">${desktop.map((a, i) => `<a class="rg-rt${i === 0 ? ' rg-rt--main' : ''}" href="${esc(a.href)}" data-event="dock_${a.kind}" data-screen="dock"${a.external ? ' target="_blank" rel="noopener"' : ''} aria-label="${esc(a.label)}">${icon(a.kind)}<span class="rg-tip" aria-hidden="true">${esc(a.label)}</span></a>`).join('')}</div>
</nav>`;
}

/** the quote sheet: name, phone, ZIP, what's needed (health trades: name, phone, preferred time only) */
export function sheetHtml(o: DockOpts): string {
  const fields = o.minimalContact
    ? `<label>Your name<input name="name" autocomplete="name" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" required></label><label>Preferred time<input name="time" placeholder="e.g. weekday mornings"></label>`
    : `<label>Your name<input name="name" autocomplete="name" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" required></label><label>ZIP or postcode<input name="zip" autocomplete="postal-code"></label><label>What do you need?<textarea name="need" rows="3" required></textarea></label><label>Add a photo (optional)<input name="photo" type="file" accept="image/*"></label>`;
  return `<span id="rg-closed"></span><div id="quote" class="rg-sheet" role="dialog" aria-modal="true" aria-labelledby="rg-sheet-h"><div class="rg-sheet__panel">
<a class="rg-sheet__x" href="#rg-closed" aria-label="Close">×</a><h2 id="rg-sheet-h">${o.minimalContact ? 'Request an appointment' : 'Get a quote'}</h2>
<form method="post" action="${esc(o.quoteAction ?? '#rg-closed')}"${o.minimalContact ? '' : ' enctype="multipart/form-data"'} class="rg-form">${fields}
<p class="rg-consent">By sending, you agree that ${esc(o.businessName)} may call or text you about this request. Message and data rates may apply; reply STOP to opt out.${o.privacyUrl ? ` <a href="${esc(o.privacyUrl)}" target="_blank" rel="noopener">Privacy policy</a>` : ''}</p>
<button type="submit" class="rg-send" data-event="dock_quote_send" data-screen="sheet">Send</button><p class="rg-done" role="status" hidden>Thanks. Your request was sent.</p></form></div></div>`;
}

export function dockCss(o: DockOpts): string {
  const b = onBrand(o.brand);
  return `:root{--rg-brand:${b.bg};--rg-on:${b.fg}}
.rg-dock{position:fixed;z-index:2147483000;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.rg-dock a,.rg-dock button{color:#111827;text-decoration:none;-webkit-tap-highlight-color:transparent}
.rg-dock a:focus-visible,.rg-dock button:focus-visible,.rg-sheet a:focus-visible,.rg-sheet button:focus-visible,.rg-sheet input:focus-visible,.rg-sheet textarea:focus-visible{outline:3px solid var(--rg-brand);outline-offset:2px}
.rg-glass{}
.rg-dock__bar,.rg-dock__rail{background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8);border:1px solid rgba(255,255,255,.7);box-shadow:0 0 0 .5px rgba(0,0,0,.08),0 12px 32px -8px rgba(0,0,0,.28)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.rg-dock__bar,.rg-dock__rail{background:#fff}}
@media (prefers-reduced-transparency:reduce){.rg-dock__bar,.rg-dock__rail{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}}
.rg-ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:rgba(17,24,39,.06)}
.rg-dock__rail{display:none}
@media (max-width:1023.98px){
  body{padding-bottom:calc(64px + 12px + 24px + env(safe-area-inset-bottom))}
  .rg-dock{left:50%;bottom:calc(12px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100vw - 24px)}
  .rg-dock__bar{height:64px;display:flex;align-items:center;gap:6px;padding:0 8px;border-radius:32px;transition:padding .25s ease,gap .25s ease}
  .rg-tile{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:52px;padding:0;border:0;background:none;font:inherit;cursor:pointer}
  .rg-tile .rg-lb{font-size:10.5px;color:#1f2937;white-space:nowrap}
  .rg-sec .rg-ic{width:36px;height:36px}
  .rg-main{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 18px;border-radius:24px;background:var(--rg-brand);color:var(--rg-on)!important;font-size:15px;white-space:nowrap}
  .rg-main svg{flex:none}
  .rg-ms{display:none}
  @media (max-width:430px){.rg-ml{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.rg-ms{display:inline}}
  .rg-dock.is-small .rg-sec{display:none}
  .rg-more{display:none}
  .rg-dock.is-small .rg-more{display:flex}
  .rg-more .rg-ic{width:44px;height:44px;border-radius:50%}
}
@media (min-width:1024px){
  .rg-dock{right:16px;top:50%;transform:translateY(-50%)}
  .rg-dock__bar{display:none}
  .rg-dock__rail{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px;border-radius:34px}
  .rg-rt{position:relative;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:rgba(17,24,39,.06);transition:transform .18s ease}
  .rg-rt--main{background:var(--rg-brand);color:var(--rg-on)!important}
  .rg-rt:hover,.rg-rt:focus-visible{transform:scale(1.25);z-index:2}
  .rg-rt:hover+.rg-rt,.rg-rt:has(+.rg-rt:hover){transform:scale(1.1)}
  .rg-tip{position:absolute;right:calc(100% + 14px);top:50%;transform:translateY(-50%);padding:6px 10px;border-radius:10px;white-space:nowrap;font-size:13px;color:#111827;background:rgba(255,255,255,.82);-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8);box-shadow:0 6px 18px -6px rgba(0,0,0,.3);opacity:0;pointer-events:none;transition:opacity .15s}
  .rg-rt:hover .rg-tip,.rg-rt:focus-visible .rg-tip{opacity:1}
  body{padding-right:0}
  /* photo credits sit bottom-left on desktop, clear of the rail on the right edge */
  .gcredit:not(.gcredit--below){right:auto;left:8px}
}
@media (prefers-reduced-motion:reduce){.rg-dock *,.rg-sheet *{transition:none!important;animation:none!important}.rg-rt:hover,.rg-rt:focus-visible,.rg-rt:hover+.rg-rt,.rg-rt:has(+.rg-rt:hover){transform:none}}
.rg-dock[data-calm="1"] *{transition:none!important;animation:none!important}
.rg-dock[data-calm="1"] .rg-rt:hover,.rg-dock[data-calm="1"] .rg-rt:focus-visible,.rg-dock[data-calm="1"] .rg-rt:hover+.rg-rt{transform:none}
.rg-sheet{position:fixed;inset:0;z-index:2147483001;display:none;align-items:flex-end;justify-content:center;background:rgba(17,24,39,.45)}
.rg-sheet:target{display:flex}
body:has(.rg-sheet:target) .rg-dock,body.rg-typing .rg-dock{display:none}
.rg-sheet__panel{position:relative;width:min(100%,520px);max-height:92vh;overflow:auto;background:#fff;color:#111827;border-radius:20px 20px 0 0;padding:24px 20px calc(24px + env(safe-area-inset-bottom));font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (min-width:640px){.rg-sheet{align-items:center}.rg-sheet__panel{border-radius:20px}}
.rg-sheet h2{margin:0 0 12px;font-size:20px}
.rg-sheet__x{position:absolute;right:12px;top:10px;width:44px;height:44px;display:grid;place-items:center;font-size:26px;color:#111827;text-decoration:none}
.rg-form{display:grid;gap:12px}
.rg-form label{display:grid;gap:4px;font-weight:600;font-size:15px}
.rg-form input,.rg-form textarea{font:inherit;padding:10px 12px;min-height:44px;border:1px solid #cbd5e1;border-radius:10px}
.rg-consent{font-size:13px;color:#475569;margin:0}
.rg-send{min-height:48px;border:0;border-radius:24px;background:var(--rg-brand);color:var(--rg-on);font:600 16px system-ui,sans-serif;cursor:pointer}
.rg-ribbon{display:block;padding:3px 12px;background:#111827;color:#fff;font:600 12px/1.6 system-ui,sans-serif;letter-spacing:.02em;text-align:center}
.rg-ribbon .rg-ver{float:right;font-weight:500;opacity:.75}`;
}

/** the dock's script: shrink and restore on scroll (phones), the quote form sent in place, the screen on each click */
export const DOCK_JS = `(()=>{const d=document.querySelector('.rg-dock');if(!d)return;const more=d.querySelector('.rg-more');
const calm=d.dataset.calm==='1'||matchMedia('(prefers-reduced-motion: reduce)').matches;let y=scrollY,t=0;
addEventListener('scroll',()=>{if(t)return;t=requestAnimationFrame(()=>{t=0;const dy=scrollY-y;y=scrollY;if(Math.abs(dy)<6)return;const s=dy>0&&scrollY>120;d.classList.toggle('is-small',s);if(more)more.hidden=!s;});},{passive:true});
more&&more.addEventListener('click',()=>{d.classList.remove('is-small');more.hidden=true;});
const screens=[...document.querySelectorAll('[data-screen]')].filter(e=>e.tagName==='SECTION');
d.addEventListener('click',e=>{const a=e.target.closest('[data-event]');if(!a)return;const mid=innerHeight/2;const s=screens.find(x=>{const r=x.getBoundingClientRect();return r.top<=mid&&r.bottom>=mid;});if(s)a.dataset.screen=s.dataset.screen;});
document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea'))document.body.classList.add('rg-typing');});
document.addEventListener('focusout',()=>document.body.classList.remove('rg-typing'));
const f=document.querySelector('.rg-form');if(f&&f.action&&!f.getAttribute('action').startsWith('#'))f.addEventListener('submit',async e=>{e.preventDefault();const b=f.querySelector('.rg-send');b.disabled=true;
const fd=new FormData(f),p=fd.get('photo');
if(p&&p.size){if(p.size>1.5e6&&window.createImageBitmap)try{const m=await createImageBitmap(p),k=Math.min(1,1600/Math.max(m.width,m.height)),c=document.createElement('canvas');c.width=Math.round(m.width*k);c.height=Math.round(m.height*k);c.getContext('2d').drawImage(m,0,0,c.width,c.height);const j=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));if(j)fd.set('photo',j,'photo.jpg');}catch{}}else fd.delete('photo');
try{const r=await fetch(f.action,{method:'POST',body:p!==null?fd:new URLSearchParams(fd),headers:{'accept':'application/json'}});if(!r.ok)throw 0;f.querySelectorAll('label,.rg-consent,.rg-send').forEach(x=>x.hidden=true);f.querySelector('.rg-done').hidden=false;}catch{b.disabled=false;}});
if(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent))document.querySelectorAll('a[data-apple]').forEach(a=>{a.href=a.dataset.apple;});
if(calm)d.querySelectorAll('*').forEach(x=>x.style.transition='none');})();`;
