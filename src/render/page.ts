import type { SiteModel } from '../content/model.js';
import { config } from '../config.js';
import { esc } from '../util/text.js';
import { buildCss } from './css.js';
import { icon } from './icons.js';
import { RENDERERS, type Ctx } from './sections.js';
import { CAROUSEL_JS, DESIGN_RENDERERS } from './design-sections.js';
import { WIDGETS_JS, lightbox, rogerWidget } from './widgets.js';

const NAV: Record<string, [string, string]> = {
  services: ['#services', 'Services'],
  focus: ['#services', 'Services'],
  gallery: ['#work', 'Our work'],
  projects: ['#work', 'Our work'],
  team: ['#team', 'Team'],
  process: ['#process', 'How it works'],
  proof: ['#reviews', 'Reviews'],
  area: ['#area', 'Service area'],
  quote: ['#quote', 'Get a quote'],
};

function jsonLd(m: SiteModel) {
  const b = m.business;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const ohs = m.facts.open24h
    ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: dayNames, opens: '00:00', closes: '23:59' }]
    : m.hours.periods.filter((p) => p.close).map((p) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: dayNames[p.open.day],
        opens: `${pad(p.open.hour)}:${pad(p.open.minute)}`,
        closes: `${pad(p.close.hour)}:${pad(p.close.minute)}`,
      }));
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': m.theme.seo.schemaType,
    name: b.name,
    url: m.urls.site,
    image: m.urls.og,
    telephone: b.phoneE164 || b.phone,
    address: b.street ? { '@type': 'PostalAddress', streetAddress: b.street, addressLocality: b.city, addressRegion: b.state, postalCode: b.zip, addressCountry: b.country || 'US' } : undefined,
    geo: b.lat ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined,
    areaServed: m.areas.length ? m.areas.map((a) => ({ '@type': 'City', name: a })) : undefined,
    openingHoursSpecification: ohs.length ? ohs : undefined,
    sameAs: m.socials.length ? m.socials.map((s) => s.url) : undefined,
    logo: m.brand.logo ? new URL(m.brand.logo.publicPath, m.urls.site).toString() : undefined,
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function fontLinks(m: SiteModel) {
  if (!m.fonts.faces.length) return '';
  // loaded without blocking the first paint: text shows in the fallback font, then swaps (display=swap)
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${m.fonts.faces.map((f) => `<link rel="preload" as="style" href="${esc(f.url)}"><link rel="stylesheet" href="${esc(f.url)}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${esc(f.url)}"></noscript>`).join('')}`;
}

/** Design builds preload the hero crop each screen size actually shows; typography-led heroes have no photo to preload. */
function heroPreload(m: SiteModel) {
  const d = m.design;
  if (!d) return `<link rel="preload" as="image" href="${esc(m.images.hero.publicPath)}" fetchpriority="high">`;
  const lead = d.heroImages || d.slides[0];
  if (!lead) return '';
  return `<link rel="preload" as="image" href="${esc(lead.mobile.publicPath)}" media="(max-width: 899px)" fetchpriority="high"><link rel="preload" as="image" href="${esc(lead.desktop.publicPath)}" media="(min-width: 900px)" fetchpriority="high">`;
}

export const CLIENT_JS = (m: SiteModel) => `
document.documentElement.classList.add('js');
(function(){
  // reveal on scroll
  var els=[].slice.call(document.querySelectorAll('.reveal'));
  if('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}})},{rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){io.observe(el)});
  } else els.forEach(function(el){el.classList.add('in')});
  // open now (business local time from utcOffsetMinutes)
  var periods=${JSON.stringify(m.hours.periods)}, off=${m.hours.utcOffsetMinutes ?? 'null'};
  var el=document.querySelector('[data-open-now]');
  if(el && periods.length && off!==null){
    var now=new Date(Date.now()+off*60000), d=now.getUTCDay(), mins=d*1440+now.getUTCHours()*60+now.getUTCMinutes(), open=false;
    if(periods.length===1 && !periods[0].close) open=true; else periods.forEach(function(p){
      if(!p.close) return; var s=p.open.day*1440+p.open.hour*60+p.open.minute, e=p.close.day*1440+p.close.hour*60+p.close.minute; if(e<=s) e+=7*1440;
      if((mins>=s&&mins<e)||(mins+7*1440>=s&&mins+7*1440<e)) open=true;
    });
    el.textContent=open?'Open now':'Closed now'; if(open) el.classList.add('is-open'); el.hidden=false;
    var names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    [].forEach.call(document.querySelectorAll('tr[data-day]'),function(tr){if(tr.getAttribute('data-day')===names[d]) tr.classList.add('today')});
  }
  // appointment requests: no past dates
  var today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  [].forEach.call(document.querySelectorAll('input[data-min-today]'),function(i){i.min=today});
  // lead forms → JSON POST
  [].forEach.call(document.querySelectorAll('form.lead-form'),function(f){
    f.addEventListener('submit',function(ev){
      ev.preventDefault(); var fd=new FormData(f), body={}; fd.forEach(function(v,k){body[k]=v}); body.page=location.href;
      var btn=f.querySelector('button[type=submit]'); if(btn){btn.disabled=true;}
      fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(function(r){if(!r.ok) throw new Error(r.status); return r.json().catch(function(){return {}});})
        .then(function(d){var p=f.querySelector('.ok'); if(p && d && d.delivered===false && f.getAttribute('data-saved')) p.textContent=f.getAttribute('data-saved'); f.classList.add('sent');})
        .catch(function(){ if(btn) btn.disabled=false; alert('Sorry, that did not go through. Please call or text us instead.'); });
    });
  });
})();`;

export function renderPage(m: SiteModel): string {
  const t = m.theme;
  // personalised plumbing builds draw their sections with the direction renderers; every other theme as before
  const R = m.design ? DESIGN_RENDERERS : RENDERERS;
  const order = t.sections.filter((s) => m.visible[s] !== false && R[s]);
  // Real photos deserve a gallery: themes without one get a carousel before the quote form (or the area/footer)
  const autoGallery = !m.design && !t.sections.includes('gallery') && m.images.gallery.length >= 4;
  if (autoGallery) { const at = ['quote', 'area', 'footer'].map((s) => order.indexOf(s)).find((i) => i >= 0) ?? order.length; order.splice(at, 0, 'gallery'); }
  const sidebar = t.grid.system === 'sidebar-12' && t.grid.sidebar ? t.grid.sidebar : undefined;
  const held = sidebar?.holds && order.includes(sidebar.holds) ? sidebar.holds : undefined;

  // Alternate plain section backgrounds for rhythm (bands like urgent/tint keep their own).
  let alt = false;
  const bgFor = (s: string): Ctx['bg'] => {
    if (['hero', 'urgent', 'footer', 'maintenance', 'actions'].includes(s)) return '';
    if (s === 'proof' && ['pull-quote-band', 'stat-band'].includes(t.sectionLayout.proof?.variant || '')) { alt = false; return ''; }
    alt = !alt;
    return alt ? '' : 'alt';
  };
  const render = (s: string, inSidebarMain = false, bgOverride?: Ctx['bg']) => {
    const l = t.sectionLayout[s] || (s === 'gallery' ? ({ variant: 'carousel', perView: { phone: 1.15, desktop: 3 } } as Ctx['l']) : { variant: '' });
    return R[s]({ m, l, bg: bgOverride ?? bgFor(s), inSidebarMain });
  };

  let body = '';
  if (held) {
    const heroIdx = order.indexOf('hero');
    const before = order.slice(0, heroIdx + 1);
    const footerIdx = order.indexOf('footer');
    const middle = order.filter((s) => !before.includes(s) && s !== 'footer');
    const after = footerIdx >= 0 ? ['footer'] : [];
    const sideCols = sidebar!.desktop;
    const mainCol = sidebar!.side === 'left' ? `${sideCols + 1} / -1` : `1 / span ${12 - sideCols}`;
    const asideCol = sidebar!.side === 'left' ? `1 / span ${sideCols}` : `${12 - sideCols + 1} / -1`;
    body += before.map((s) => render(s)).join('');
    const mainSecs = middle.filter((s) => s !== held);
    body += `<div class="wrap"><div class="layout" style="--main-col:${mainCol};--aside-col:${asideCol}">
      <aside class="aside" style="order:${middle.indexOf(held)}">${render(held, false, '')}</aside>
      <div class="main">${mainSecs.map((s) => `<div style="order:${middle.indexOf(s)}">${render(s, true, '').replace(/<div class="wrap">/, '<div>')}</div>`).join('')}</div>
    </div></div>`;
    body += after.map((s) => render(s)).join('');
  } else {
    body = order.map((s) => render(s)).join('');
  }

  // design builds name sections in the category's words ("Menu", "Treatments and prices", "Visit us")
  const p = m.design?.profile;
  const navLabel = (s: string) => (!p ? NAV[s][1] : s === 'services' || s === 'focus' ? (p.offeringsTitle.length > 14 ? p.offeringsTitle.split(' ')[0] : p.offeringsTitle) : s === 'gallery' ? 'Photos' : s === 'area' ? (p.hoursFirst ? 'Visit' : 'Service area') : NAV[s][1]);
  const nav = order.filter((s) => NAV[s] && s !== 'quote').map((s) => `<a href="${NAV[s][0]}">${esc(navLabel(s))}</a>`).join('');
  const quoteBtn = m.design ? m.design.headerLabel : m.copy.quoteTitle;
  const logo = m.brand.logo
    ? `<img src="${esc(m.brand.logo.publicPath)}" alt="${esc(m.business.name)}" width="${m.brand.logo.width}" height="${m.brand.logo.height}">`
    : `<span class="wordmark${m.copy.wordmark.length > 22 ? ' long' : ''}">${esc(m.copy.wordmark)}</span>`;
  const callBtn = t.roger.headerCallButton && m.contact.tel
    ? `<a class="btn btn-primary hdr-call" href="${m.contact.tel}" data-ev="call" aria-label="Call ${esc(m.contact.phone)}">${icon('phone', { size: 18 })}<span class="num">${esc(m.contact.phone)}</span></a>`
    : `<a class="btn btn-primary hdr-call" href="#quote">${esc(quoteBtn)}</a>`;
  const claim = config.rogerImessage
    ? ` <a href="sms:${esc(config.rogerImessage)}&body=${encodeURIComponent(`Claim my site: ${m.slug}`)}">Claim it</a>`
    : '';
  const preview = m.preview && t.roger.previewBanner
    ? `<div class="preview">Preview: a free website draft Roger made for ${esc(m.business.name.replace(/\.$/, ''))}.${claim}</div>` : '';

  // the Roger widget (Book / Chat / Call) replaces the sticky bar and the text bubble
  const widget = t.roger.widget !== false;
  const sticky = t.roger.stickyBar && !widget
    ? `<nav class="sticky-bar" aria-label="Quick contact">
        ${m.contact.tel ? `<a class="${m.copy.actionKind === 'call' ? 'primary' : ''}" href="${m.contact.tel}" data-ev="call">${icon('phone', { size: 18 })}Call</a>` : ''}
        ${m.contact.sms ? `<a href="${esc(m.contact.sms)}" data-ev="text">${icon('message-circle', { size: 18 })}Text</a>` : ''}
        <a class="${m.copy.actionKind === 'form' || !m.contact.tel ? 'primary' : ''}" href="#quote" data-ev="quote">${icon('clipboard-list', { size: 18 })}Quote</a>
      </nav>` : '';
  const bubble = t.roger.chatBubble && m.contact.sms && !widget
    ? `<a class="bubble" href="${esc(m.contact.sms)}" data-ev="text" aria-label="Text ${esc(m.business.name)}">${icon('message-circle', { size: 22 })}<span class="t">Text us</span></a>` : '';

  const og = esc(m.urls.og);
  return `<!doctype html>
<html lang="${esc(t.locale.split('-')[0])}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.copy.seoTitle)}</title>
<meta name="description" content="${esc(m.copy.seoDescription)}">
${m.preview ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(m.urls.site)}">`}
<meta name="color-scheme" content="${esc(t.colorScheme)}">
<meta name="theme-color" content="${m.brand.brand}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.business.name)}">
<meta property="og:description" content="${esc(m.copy.seoDescription)}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(m.urls.site)}">
<meta property="og:site_name" content="${esc(m.business.name)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
${fontLinks(m)}
${heroPreload(m)}
<style>${buildCss(m)}</style>
${m.design ? `<style id="rg-appearance">${m.design.appearanceCss}</style>` : ''}
<script type="application/ld+json">${jsonLd(m)}</script>
</head>
<body class="${widget ? 'has-rw' : t.roger.stickyBar ? 'has-bar' : ''}" data-theme="${esc(m.themeId)}"${m.design ? ` data-direction="${esc(m.design.plan.direction)}" data-category="${esc(m.design.plan.category)}" data-motion="${esc(m.design.motion)}" data-plan="${esc(m.design.plan.id)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${preview}
<header class="site-header"><div class="wrap hdr">
  <a class="logo" href="#top">${logo}</a>
  <nav class="nav" aria-label="Main">${nav}</nav>
  ${callBtn}
</div></header>
<main id="main">
${body.replace(/<footer[\s\S]*<\/footer>/, '')}
</main>
${(body.match(/<footer[\s\S]*<\/footer>/) || [''])[0]}
${sticky}${bubble}${widget ? rogerWidget(m) : ''}${lightbox(m)}
<script>${CLIENT_JS(m)}${WIDGETS_JS(m)}${m.design?.slides.length ? CAROUSEL_JS : ''}</script>
</body>
</html>`;
}
