import { serviceKey } from '../evidence.js';
import type { SiteModel } from '../content/model.js';
import type { SiteImage } from '../brand/photos.js';
import type { OfferingView } from '../design/compose.js';
import type { SitePage, SitePlan } from '../design/siteplan.js';
import { relLink, routeDepth } from '../design/siteplan.js';
import type { PageSeo } from '../seo.js';
import { esc, truncateWords } from '../util/text.js';
import { icon } from './icons.js';
import { hoursTable, leadForm, mapEmbed, stars } from './parts.js';
import { apptNote, carousel, credit, fig, picture, reqEv, CAROUSEL_JS } from './design-sections.js';
import { WIDGETS_JS, lightbox, rogerWidget } from './widgets.js';
import { buildCss } from './css.js';
import { CLIENT_JS } from './page.js';

/**
 * Page families, version 2: three complete, authored page designs. Each defines its own header, hero, section
 * treatments, offerings, proof, imagery, closing action, footer and inner-page header; the shell below adds the
 * SEO head, navigation, widget and scripts. Sections come from the saved design plan (order, variants) and
 * content that isn't there is left out rather than shown empty. Version 1 sites keep the earlier renderer
 * (src/render/page.ts + design-sections.ts) until the owner upgrades.
 */
export interface FCtx {
  m: SiteModel;
  sp: SitePlan;
  page: SitePage;
  /** a link to another page of this site (relative), with an optional #anchor */
  link: (route: string, hash?: string) => string;
  multi: boolean;
}
type Section = (c: FCtx, variant: string) => string;
interface Family {
  header: (c: FCtx) => string;
  hero: Section;
  intro: (c: FCtx) => string;
  offerings: (c: FCtx, variant: string, mode: 'full' | 'teaser') => string;
  proof: (c: FCtx) => string;
  gallery: Section;
  cta: (c: FCtx) => string;
  contact: (c: FCtx) => string;
  visit: (c: FCtx, mode: 'full' | 'teaser') => string;
  pageHero: (c: FCtx, h1: string, lead: string, crumbs: { label: string; route: string }[]) => string;
  footer: (c: FCtx) => string;
}

// ── shared helpers ──
const D = (m: SiteModel) => m.design!;
const P = (m: SiteModel) => D(m).profile;
const tel = (m: SiteModel) => (m.contact.tel && D(m).phoneOk ? m.contact.tel : undefined);
const kind = (m: SiteModel) => (m.business.primaryTypeLabel && !/establishment|point of interest/i.test(m.business.primaryTypeLabel) ? m.business.primaryTypeLabel : P(m).label);
const offersRoute = (c: FCtx) => c.sp.pages.find((p) => p.type === 'offerings')?.route;
/** the website's own booking page, when the plan's main action is an appointment */
const bookingUrl = (m: SiteModel) => (D(m).plan.goal === 'appointment' ? m.source?.booking?.url : undefined);
const contactHref = (c: FCtx) => (c.multi ? c.link(c.sp.pages.find((p) => p.type === 'contact')?.route ?? '', bookingUrl(c.m) ? '#visit' : '#quote') : bookingUrl(c.m) ? '#visit' : '#quote');
const offerHref = (c: FCtx, o: OfferingView) => { const p = c.sp.pages.find((x) => x.offeringId === o.id); return p ? c.link(p.route) : undefined; };
const todayHours = (m: SiteModel) => (m.facts.open24h ? 'Open 24 hours' : m.hours.compact.find((r) => !/closed/i.test(r.time)) ? `${m.hours.compact.find((r) => !/closed/i.test(r.time))!.days}: ${m.hours.compact.find((r) => !/closed/i.test(r.time))!.time}` : '');
const sourceCta = (m: SiteModel) => m.source?.cta?.primary;
const primaryHref = (c: FCtx) => {
  const p = sourceCta(c.m);
  if (p) return p.to === 'phone' && tel(c.m) ? tel(c.m)! : (p.to === 'url' || p.to === 'booking') && (p.href || bookingUrl(c.m)) ? (p.href || bookingUrl(c.m))! : contactHref(c);
  return D(c.m).plan.goal === 'call' && tel(c.m) ? tel(c.m)! : bookingUrl(c.m) ?? contactHref(c);
};
const primaryLabel = (m: SiteModel) => sourceCta(m)?.label || (D(m).plan.goal === 'call' && tel(m) ? `Call ${m.contact.phone}` : D(m).actionLabel);
/**
 * Does the website's main offer ("Get a free roof inspection") apply to this service? Only when the business shows it
 * there: on the service's own page or in its description of it. A shared word ("roof") proves nothing. A site with no
 * such evidence puts the offer in the hero and gives each card its own action.
 */
const ctaFits = (m: SiteModel, o: OfferingView): boolean => {
  const p = sourceCta(m);
  if (!p) return true; // no source offer: the generic action is the same for every card
  // the evidence may support the offer on several services; one card carries the button, the others link to their service
  return p.featuredService ? p.featuredService === serviceKey(o.name) : !!p.eligibleServices?.includes(serviceKey(o.name)) && p.eligibleServices.length === 1;
};
/** the website's second action ("See our work") goes to this site's photo section, when there is one */
const secondaryAction = (c: FCtx) => {
  const s = c.m.source?.cta?.secondary;
  if (!s || D(c.m).gallery.length < 2) return '';
  return `<a class="btn btn-secondary f-cta-2" href="${esc(c.multi ? `${c.link('')}#work` : '#work')}">${esc(s.label)}</a>`;
};
/** insert the second action right after the hero's primary button */
const withSecondary = (html: string, c: FCtx) => { const s = secondaryAction(c); return s ? html.replace(/(<a class="btn btn-primary[^"]*"[^>]*>[^<]*<\/a>)/, `$1${s}`) : html; };
const galleryTitle = (m: SiteModel) => m.source?.galleryTitle === 'Photos' ? 'Photos' : m.source?.galleryTitle || P(m).galleryTitle;
const areaTitle = (m: SiteModel) => (m.source?.region ? `Serving ${m.source.region}` : P(m).areaTitle(m.facts.city));
const facts = (m: SiteModel): string[] => [
  m.proof.showRating ? `${m.proof.rating?.toFixed(1)}★ from ${m.proof.reviewCount} Google reviews` : '',
  m.facts.years ? `${m.facts.years} years in business` : '',
  m.facts.licensed && m.facts.insured ? 'Licensed and insured' : m.facts.licensed ? 'Licensed' : '',
].filter(Boolean);
const logo = (m: SiteModel, cls: string) => (m.brand.logo
  ? `<img class="${cls}-logo-img" src="${esc(m.brand.logo.publicPath)}" alt="${esc(m.business.name)}" width="${m.brand.logo.width}" height="${m.brand.logo.height}">`
  : `<span class="${cls}-word">${esc(m.business.name)}</span>`);
const sampleNote = (m: SiteModel) => (D(m).samplePrices ? `<p class="f-sample">${icon('info', { size: 16 })}<span>Sample prices for this demo business. Real prices come from the business.</span></p>` : '');
/** how to book one offering: its own destination, else the business's booking page */
const rowAction = (m: SiteModel | undefined, o: OfferingView): { href: string; label: string } | undefined => (o.contact ? { href: o.contact.url, label: o.contact.label } : m && bookingUrl(m) ? { href: bookingUrl(m)!, label: m.source!.booking!.label } : undefined);
const priceTag = (o: OfferingView, cls = 'f-price', c?: FCtx) => {
  // "Request a quote" is a call to action: it is a link to the main action, never loose text
  // when nothing on the list has a price, "Ask in store" on every row says nothing: rows show no price at all (an action such as "Request a quote" stays)
  if (c && !o.priced && !D(c.m).offerings.some((x) => x.priced) && !/^(request|get|book|call)\b/i.test(o.price) && !rowAction(c.m, o)) return '';
  const act = !o.priced && c ? (rowAction(c.m, o) ?? { href: primaryHref(c), label: o.price }) : undefined;
  return act ? `<a class="${cls} is-quote f-book" href="${esc(act.href)}" data-ev="book" aria-label="${esc(`${act.label}: ${o.name}`)}">${esc(act.label)}</a>` : `<span class="${cls}${o.priced ? '' : ' is-quote'}">${esc(o.price)}</span>`;
};
/** the About text: one paragraph each, so a longer story reads as paragraphs, not a block */
const introHtml = (d: { intro?: string; introParas?: string[] }) => (d.introParas?.length ? d.introParas : [d.intro ?? '']).map((p) => `<p>${esc(p)}</p>`).join('');
const introHeading = (m: SiteModel, fallback: string) => m.source?.story?.heading || fallback;
const offerName = (c: FCtx, o: OfferingView) => { const h = offerHref(c, o); return h ? `<a href="${esc(h)}">${esc(o.name)}</a>` : esc(o.name); };
/** what the offerings list shows: the focus item first, then the rest (teaser: the first few) */
const offerList = (m: SiteModel, mode: 'full' | 'teaser') => (mode === 'teaser' ? D(m).offerings.slice(0, 4) : D(m).offerings);
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

/** navigation: anchors on a single page, pages on a multi-page site */
function navItems(c: FCtx, sections: string[]): { label: string; href: string; current?: boolean }[] {
  const m = c.m;
  if (c.multi) return c.sp.pages.filter((p) => p.navLabel).map((p) => ({ label: p.type === 'offerings' ? P(m).offeringsTitle.split(' ')[0] : p.navLabel!, href: c.link(p.route), current: c.page.route === p.route || (c.page.type === 'offering' && p.type === 'offerings') }));
  const out: { label: string; href: string }[] = [];
  if (sections.includes('services') || sections.includes('focus')) out.push({ label: P(m).offeringsTitle.split(' ')[0], href: '#services' });
  if (sections.includes('gallery') && D(m).gallery.length) out.push({ label: 'Photos', href: '#work' });
  if (sections.includes('intro') || sections.includes('team')) out.push({ label: 'About', href: sections.includes('intro') ? '#about' : '#team' });
  if (sections.includes('proof')) out.push({ label: 'Reviews', href: '#reviews' });
  if (sections.includes('area')) out.push({ label: P(m).hoursFirst ? 'Visit' : 'Contact', href: '#visit' });
  return out;
}
const navHtml = (items: ReturnType<typeof navItems>) => items.map((i) => `<a href="${esc(i.href)}"${(i as any).current ? ' aria-current="page"' : ''}>${esc(i.label)}</a>`).join('');
const mobileMenu = (items: ReturnType<typeof navItems>, cta: string) => (items.length ? `<details class="f-menu"><summary>${icon('menu', { size: 20 })}<span>Menu</span></summary><nav class="f-menu-nav" aria-label="Menu">${navHtml(items)}${cta}</nav></details>` : '');

// sections shared by every family (each family styles them)
/** booking and phone, together, at the head of the contact/visit section */
function visitAction(c: FCtx): string {
  const m = c.m;
  const url = bookingUrl(m);
  if (!url && !m.source?.booking) return '';
  const b = m.source?.booking;
  const call = tel(m) ? `<a class="btn btn-secondary" href="${tel(m)}" data-ev="call">${icon('phone', { size: 18 })}<span>${esc(m.contact.phone)}</span></a>` : '';
  return `<div class="f-visit-act"><div class="btn-row">${url ? `<a class="btn btn-primary" href="${esc(url)}" data-ev="book">${esc(b!.label)}</a>` : ''}${call}</div>${b ? `<p class="f-note">${b.platform ? `Online booking opens the business's own ${esc(b.platform)} booking page.` : 'Online booking opens the business\'s own booking page.'}</p>` : ''}</div>`;
}

/**
 * Image-led service cards: used when the services have pictures of their own (two or more). Every service is a card
 * of the same shape: a 16:10 picture (or an icon panel when that one has none), the name, what the source says about
 * it, and the way to book it. Colours and type come from the page's variables, so they follow the business's brand.
 */
const hasServiceCards = (m: SiteModel) => D(m).offerings.filter((o) => o.image && !o.secondary).length >= 2;
function serviceCards(c: FCtx, mode: 'full' | 'teaser'): string {
  const m = c.m;
  const list = (mode === 'teaser' ? D(m).offerings : offerList(m, mode)).filter((o) => !o.secondary).slice(0, 8);
  const also = D(m).offerings.filter((o) => o.secondary);
  if (!list.length) return '';
  const more = mode === 'teaser' && offersRoute(c) ? `<a class="f-more" href="${esc(c.link(offersRoute(c)!))}">See all ${esc(P(m).offeringsTitle.toLowerCase())} ${icon('arrow-right', { size: 16 })}</a>` : '';
  // each card's action: the website's main offer on the one service it is featured on; a walk-in service gets directions, not
  // a booking button; the others link to their service (this site's page for it, else the business's own page), quietly
  type Act = { href: string; label: string; quiet?: boolean; external?: boolean };
  const WALK_IN = /\b(no appointment (?:is )?(?:necessary|needed|required)|walk[- ]?ins?(?: welcome| only)?)\b/i;
  const actOf = (o: OfferingView): Act => {
    const own = offerHref(c, o);
    if (WALK_IN.test(`${o.note ?? ''} ${o.description ?? ''}`)) return m.contact.directionsUrl ? { href: m.contact.directionsUrl, label: 'Get directions', quiet: true, external: true } : { href: contactHref(c), label: 'Visit us', quiet: true };
    return rowAction(m, o) ?? (ctaFits(m, o) ? { href: primaryHref(c), label: primaryLabel(m) } : own ? { href: own, label: 'Learn more', quiet: true } : o.page ? { href: o.page, label: 'Learn more', quiet: true, external: true } : { href: primaryHref(c), label: 'Ask about this service', quiet: true });
  };
  const acts = new Map(list.map((o) => [o.id, actOf(o)]));
  // the same button on three or more cards is noise, not a choice: the hero carries it, the cards keep it as a quiet link
  const same = new Map<string, number>();
  for (const x of acts.values()) if (!x.quiet) same.set(`${x.label}|${x.href}`, (same.get(`${x.label}|${x.href}`) ?? 0) + 1);
  for (const x of acts.values()) if (!x.quiet && (same.get(`${x.label}|${x.href}`) ?? 0) >= 3) x.quiet = true;
  const card = (o: OfferingView) => {
    const act = acts.get(o.id)!;
    const media = o.image
      ? `<div class="f-svc-media"><img src="${esc(o.image.path)}" width="${o.image.width}" height="${o.image.height}" alt="${esc(o.image.alt)}" loading="lazy" decoding="async" style="object-position:${Math.round(o.image.focal.x * 100)}% ${Math.round(o.image.focal.y * 100)}%"></div>`
      : `<div class="f-svc-media is-icon" aria-hidden="true">${icon(o.icon || 'circle-check', { size: 44 })}</div>`;
    const text = [o.description, o.duration].filter(Boolean).join(' · ');
    return `<li class="f-svc-card">${media}<div class="f-svc-body"><h3>${offerName(c, o)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${o.note ? `<p class="f-svc-note">${esc(o.note)}</p>` : ''}${o.priced ? `<p class="f-svc-price">${esc(o.price)}</p>` : ''}${act.quiet ? `<a class="f-svc-link" href="${esc(act.href)}"${act.external ? ' target="_blank" rel="noopener"' : ''} data-ev="${o.contact || act.href === bookingUrl(m) ? 'book' : 'link'}" aria-label="${esc(act.label === 'Learn more' ? `Learn more about ${o.name}${act.external ? ` on ${m.business.name}'s website (opens in a new tab)` : ''}` : `${act.label}: ${o.name}${act.external ? ' (opens in a new tab)' : ''}`)}">${esc(act.label)} ${icon('arrow-right', { size: 16 })}</a>` : `<a class="btn btn-primary f-svc-btn" href="${esc(act.href)}" data-ev="${o.contact || bookingUrl(m) ? 'book' : reqEv(m)}" aria-label="${esc(`${act.label}: ${o.name}`)}">${esc(act.label)}</a>`}</div></li>`;
  };
  return `<section class="f-svc" id="services" aria-labelledby="services-h"><div class="wrap"><div class="f-svc-head"><h2 id="services-h">${esc(P(m).offeringsTitle)}</h2>${more}</div><ul class="f-svc-grid">${list.map(card).join('')}</ul>${also.length ? `<div class="f-svc-also"><h3>Also offered</h3><ul>${also.map((o) => `<li><a href="${esc(offerHref(c, o) ?? contactHref(c))}">${esc(o.name)}</a></li>`).join('')}</ul></div>` : ''}${sampleNote(m)}</div></section>`;
}

/** the business's own videos: a poster picture and a clear play button; nothing loads until a visitor asks for it */
function videos(c: FCtx): string {
  const numbered = (v: { title?: string }) => Number((v.title || '').match(/(\d+)\s*$/)?.[1] ?? NaN);
  const raw = c.m.source?.videos ?? [];
  const vs = raw.every((v) => Number.isFinite(numbered(v))) ? [...raw].sort((a, b) => numbered(a) - numbered(b)) : raw;
  if (!vs.length) return '';
  const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = (t: string | undefined, i: number) => { const raw = (t || '').trim(); const [head, ...rest] = raw.split(/\s+[-–:|]\s+/); return rest.length && (nk(c.m.business.name).startsWith(nk(head)) || nk(head).startsWith(nk(c.m.business.name))) ? rest.join(' - ') : raw; };
  const cleanOld = (t: string | undefined, i: number) => (t || '').replace(new RegExp(`^${c.m.business.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-:–|]\\s*`, 'i'), '').trim() || `Video ${i + 1}`;
  const testimonials = vs.every((v) => /testimonial/i.test(v.title || ''));
  const host = (() => { try { return new URL(vs[0].pageUrl).hostname.replace(/^www\./, ''); } catch { return 'the business\'s website'; } })();
  return `<section class="f-videos" id="videos" aria-labelledby="videos-h"><div class="wrap"><h2 id="videos-h">${testimonials ? 'Patient testimonials' : 'Watch'}</h2><div class="f-video-grid">${vs.map((v, i) => {
    const title = clean(v.title, i);
    const label = `${title}${v.duration ? ` (${v.duration})` : ''}`;
    return `<article class="f-video"><div class="f-video-frame" data-video data-kind="${esc(v.kind)}" data-src="${esc(v.url)}" data-page="${esc(v.pageUrl)}" data-host="${esc(host)}" data-title="${esc(label)}">${v.poster ? `<img src="${esc(v.poster.publicPath)}" width="${v.poster.width}" height="${v.poster.height}" alt="" loading="lazy" decoding="async">` : ''}<button type="button" class="f-video-play" aria-label="Play video: ${esc(label)}">${icon('play', { size: 28 })}</button></div><h3>${esc(title)}</h3>${v.duration ? `<p class="f-note">${esc(v.duration)}</p>` : ''}</article>`;
  }).join('')}</div><p class="f-note f-video-note">These videos are hosted on the business's website. If one doesn't start here, watch it on <a href="${esc(vs[0].pageUrl)}" target="_blank" rel="noopener">${esc(host)}</a>.</p></div></section>`;
}
function team(c: FCtx): string {
  const d = D(c.m);
  if (!d.team) return '';
  const lines = [`The people behind ${c.m.business.name}${c.m.facts.city ? ` in ${c.m.facts.city}` : ''}.`, c.m.facts.years ? `In business for ${c.m.facts.years} years.` : ''].filter(Boolean);
  return `<section class="f-team" id="team" aria-labelledby="team-h"><div class="wrap f-team-grid"><figure class="f-team-img">${picture(d.team)}${credit(d.team.desktop)}</figure><div class="f-team-text"><h2 id="team-h">Meet the team</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${c.m.trust.length ? `<ul class="f-checks">${c.m.trust.map((t) => `<li>${icon('circle-check', { size: 18 })}${esc(t)}</li>`).join('')}</ul>` : ''}</div></div></section>`;
}
function process(c: FCtx): string {
  return `<section class="f-process" id="process" aria-labelledby="process-h"><div class="wrap"><h2 id="process-h">How it works</h2><ol class="f-steps">${D(c.m).steps.map((s, i) => `<li><span class="f-step-n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol></div></section>`;
}
function urgent(c: FCtx): string {
  const d = D(c.m);
  if (!d.emergencyLine || !tel(c.m)) return '';
  return `<section class="f-urgent" aria-label="Emergency service"><div class="wrap f-urgent-in"><p>${icon('siren', { size: 22 })}<span>${esc(d.emergencyLine)}</span></p><a class="btn btn-light" href="${tel(c.m)}" data-ev="call">${icon('phone', { size: 18 })}<span>Call ${esc(c.m.contact.phone)}</span></a></div></section>`;
}
function offeringDetail(c: FCtx, cls: string): string {
  const d = D(c.m);
  const o = d.offerings.find((x) => x.id === c.page.offeringId)!;
  const siblings = d.offerings.filter((x) => x.id !== o.id).slice(0, 6);
  return `<section class="${cls}-detail"><div class="wrap ${cls}-detail-grid"><div class="${cls}-detail-main">${o.description ? `<p class="${cls}-detail-text">${esc(o.description)}</p>` : ''}
    <dl class="f-facts">${o.priced ? `<div><dt>Price</dt><dd>${esc(o.price)}</dd></div>` : `<div><dt>Price</dt><dd>${esc(o.price)}</dd></div>`}${o.duration ? `<div><dt>Time</dt><dd>${esc(o.duration)}</dd></div>` : ''}${c.m.facts.city ? `<div><dt>Where</dt><dd>${esc(c.m.areas.slice(0, 3).join(', ') || c.m.facts.city)}</dd></div>` : ''}</dl>
    ${sampleNote(c.m)}<div class="btn-row"><a class="btn btn-primary" href="${esc(primaryHref(c))}" data-ev="${reqEv(c.m)}">${esc(primaryLabel(c.m))}</a></div></div>
    ${siblings.length ? `<nav class="${cls}-related" aria-label="Other ${esc(P(c.m).noun)}s"><h2>Also from ${esc(c.m.business.name)}</h2><ul>${siblings.map((s) => `<li>${offerName(c, s)} ${priceTag(s, 'f-price', c)}</li>`).join('')}</ul>${offersRoute(c) ? `<a class="f-more" href="${esc(c.link(offersRoute(c)!))}">All ${esc(P(c.m).offeringsTitle.toLowerCase())} ${icon('arrow-right', { size: 16 })}</a>` : ''}</nav>` : ''}
  </div></section>`;
}
const gridGallery = (ps: SiteImage[], cls: string, max: number) => `<div class="${cls}">${ps.slice(0, max).map((p, i) => fig(p, i, ps.length, i === 0 ? 'lead' : '')).join('')}</div>`;
function reviewQuotes(m: SiteModel, n: number) { return m.proof.quotes.slice(0, n); }
/** published pages can't copy Google's review text: they point visitors to the reviews on Google */
const reviewsLink = (m: SiteModel, cls: string) => (D(m).reviewsLink ? `<p class="${cls}"><a class="f-more" href="${esc(D(m).reviewsLink!)}" target="_blank" rel="noopener">Read our reviews on Google ${icon('arrow-up-right', { size: 16 })}</a></p>` : '');

/* ══════════════════ Editorial Showcase ══════════════════ */
const editorial: Family = {
  header(c) {
    const items = navItems(c, D(c.m).plan.sections.map((s) => s.id));
    const cta = `<a class="fe-head-cta" href="${esc(primaryHref(c))}" data-ev="${reqEv(c.m)}">${esc(D(c.m).headerLabel)} ${icon('arrow-right', { size: 16 })}</a>`;
    return `<header class="fe-head"><div class="wrap fe-head-in"><a class="fe-logo" href="${esc(c.link(''))}" aria-label="${esc(c.m.business.name)}, home">${logo(c.m, 'fe')}</a><nav class="fe-nav" aria-label="Main">${navHtml(items)}</nav>${cta}${mobileMenu(items, cta)}</div></header>`;
  },
  hero(c, v) {
    const m = c.m;
    const d = D(m);
    const kicker = `<p class="fe-kicker">${esc(kind(m))}${m.facts.city ? ` · ${esc(m.facts.city)}` : ''}</p>`;
    const actions = `<div class="fe-actions"><a class="btn btn-primary" href="${esc(primaryHref(c))}" data-ev="${reqEv(m)}">${esc(primaryLabel(m))}</a>${d.plan.goal !== 'call' && tel(m) ? `<a class="fe-textlink" href="${tel(m)}" data-ev="call">or call ${esc(m.contact.phone)}</a>` : d.plan.goal === 'call' ? `<a class="fe-textlink" href="${esc(contactHref(c))}">or ${esc(d.actionLabel.toLowerCase())}</a>` : ''}</div>`;
    const text = `${kicker}<h1 id="top-h">${esc(m.copy.hero)}</h1><p class="fe-lede">${esc(m.copy.subline)}</p>${actions}${apptNote(m)}`;
    const strip = facts(m).length ? `<ul class="fe-facts">${facts(m).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
    if (v === 'photo-led' && d.heroImages) return `<section class="fe-hero fe-hero-full" id="top" aria-labelledby="top-h"><figure class="fe-hero-bleed">${picture(d.heroImages, true)}${credit(d.heroImages.desktop)}</figure><div class="wrap"><div class="fe-hero-panel">${text}</div>${strip}</div></section>`;
    if ((v === 'split' && d.heroImages) || (v === 'carousel' && d.slides.length >= 2)) {
      const media = v === 'carousel' ? carousel(d.slides) : `<figure class="fe-hero-img">${picture(d.heroImages!, true)}${credit(d.heroImages!.desktop)}</figure>`;
      return `<section class="fe-hero" id="top" aria-labelledby="top-h"><div class="wrap fe-hero-grid"><div class="fe-hero-text">${text}</div>${media}</div><div class="wrap">${strip}</div></section>`;
    }
    return `<section class="fe-hero fe-hero-type" id="top" aria-labelledby="top-h"><div class="wrap"><div class="fe-hero-text">${text}</div>${strip}</div></section>`;
  },
  intro(c) {
    const d = D(c.m);
    if (!d.intro) return '';
    return `<section class="fe-intro" id="about" aria-labelledby="about-h"><div class="wrap fe-intro-grid"><h2 class="fe-label" id="about-h">${esc(introHeading(c.m, `About ${c.m.business.name}`))}</h2><div class="fe-intro-text">${introHtml(d)}</div></div></section>`;
  },
  offerings(c, v, mode) {
    const m = c.m;
    const list = offerList(m, mode);
    if (!list.length) return '';
    const more = mode === 'teaser' && offersRoute(c) ? `<a class="f-more" href="${esc(c.link(offersRoute(c)!))}">All ${esc(P(m).offeringsTitle.toLowerCase())} ${icon('arrow-right', { size: 16 })}</a>` : '';
    const rows = list.map((o, i) => `<li><span class="fe-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div class="fe-li-main"><h3>${offerName(c, o)}</h3>${o.description || o.note ? `<p>${esc([o.description, o.note].filter(Boolean).join(' · '))}</p>` : ''}${o.duration ? `<p class="fe-dur">${esc(o.duration)}</p>` : ''}</div>${priceTag(o, 'fe-li-price', c)}</li>`).join('');
    return `<section class="fe-offers${v === 'plans' ? ' is-plans' : ''}" id="services" aria-labelledby="services-h"><div class="wrap fe-offers-grid"><div class="fe-sec-head"><p class="fe-label">${esc(P(m).offeringsTitle)}</p><h2 id="services-h">${esc(m.design!.plan.category === 'food' ? 'From the menu' : m.design!.plan.category === 'trades' ? 'What we do' : `Our ${P(m).noun}s`)}</h2>${more}</div><div><ol class="fe-list">${rows}</ol>${sampleNote(m)}</div></div></section>`;
  },
  proof(c) {
    const m = c.m;
    const q = reviewQuotes(m, 3);
    if (!q.length && !m.trust.length && !m.proof.showRating && !D(m).reviewsLink) return '';
    const [lead, ...rest] = q;
    return `<section class="fe-proof" id="reviews" aria-labelledby="reviews-h"><div class="wrap"><h2 class="fe-label" id="reviews-h">${esc(m.proof.showRating ? 'In their words' : 'Good to know')}</h2>
      ${lead ? `<figure class="fe-pull"><blockquote><p>“${esc(lead.text)}”</p></blockquote><figcaption>${esc(lead.author)} · ${esc((lead as { from?: string }).from ?? 'Google review')}</figcaption></figure>` : ''}
      ${rest.length ? `<div class="fe-quotes">${rest.map((r) => `<figure><blockquote><p>“${esc(r.text)}”</p></blockquote><figcaption>${esc(r.author)} · ${esc((r as { from?: string }).from ?? 'Google review')}</figcaption></figure>`).join('')}</div>` : ''}
      ${reviewsLink(m, 'fe-proof-link')}<p class="fe-proof-meta">${m.proof.showRating ? `${stars(m.proof.rating || 0, 14)} ${m.proof.rating?.toFixed(1)} from ${m.proof.reviewCount} Google reviews` : ''}${m.trust.length ? `${m.proof.showRating ? ' · ' : ''}${esc(m.trust.join(' · '))}` : ''}</p></div></section>`;
  },
  gallery(c, v) {
    const ps = D(c.m).gallery;
    if (ps.length < 2) return '';
    return `<section class="fe-gallery" id="work" aria-labelledby="work-h"><div class="wrap"><div class="fe-sec-head fe-sec-head-row"><p class="fe-label">${esc(galleryTitle(c.m))}</p><h2 id="work-h">${esc(c.m.source?.galleryTitle === 'Photos' ? 'From the business' : c.m.design!.plan.category === 'trades' ? 'Selected work' : 'A closer look')}</h2></div>${v === 'masonry' ? gridGallery(ps, 'gal fe-masonry', 7) : gridGallery(ps, `gal fe-feature${ps.length < 3 ? ' is-pair' : ''}`, ps.length >= 5 ? 5 : ps.length >= 3 ? 3 : 2)}</div></section>`;
  },
  cta(c) {
    const m = c.m;
    const h = { trades: 'Let\'s talk about your project', salon: 'Book your visit', food: 'Come and see us', fitness: 'Start training with us', professional: 'Let\'s talk', shop: 'Visit the shop', health: 'Book your visit', general: 'Get in touch' }[D(m).plan.category];
    return `<section class="fe-cta" aria-labelledby="cta-h"><div class="wrap fe-cta-grid"><h2 id="cta-h">${esc(h)}</h2><div><p>${esc(todayHours(m) || `${m.business.name}${m.facts.city ? `, ${m.facts.city}` : ''}`)}</p><div class="fe-actions"><a class="btn btn-primary" href="${esc(primaryHref(c))}" data-ev="${reqEv(m)}">${esc(primaryLabel(m))}</a>${tel(m) && D(m).plan.goal !== 'call' ? `<a class="fe-textlink" href="${tel(m)}" data-ev="call">or call ${esc(m.contact.phone)}</a>` : ''}</div></div></div></section>`;
  },
  contact(c) {
    const m = c.m;
    return `<section class="fe-contact" id="quote" aria-labelledby="quote-h"><div class="wrap fe-contact-grid"><div><p class="fe-label">Contact</p><h2 id="quote-h">${esc(m.copy.quoteTitle)}</h2>
      <dl class="f-facts">${tel(m) ? `<div><dt>Phone</dt><dd><a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a></dd></div>` : ''}${m.contact.address ? `<div><dt>Address</dt><dd>${esc(m.contact.address)}</dd></div>` : ''}${todayHours(m) ? `<div><dt>Hours</dt><dd>${esc(todayHours(m))}</dd></div>` : ''}</dl>${apptNote(m)}</div><div class="fe-form">${leadForm(m)}</div></div></section>`;
  },
  visit(c, mode) {
    const m = c.m;
    if (!m.contact.address && !m.hours.rows.length && !m.areas.length) return '';
    return `<section class="fe-visit" id="visit" aria-labelledby="visit-h"><div class="wrap fe-visit-grid"><div><p class="fe-label">${esc(P(m).areaTitle(m.facts.city))}</p><h2 id="visit-h">${esc(m.contact.address ? 'Where to find us' : 'Where we work')}</h2>${visitAction(c)}${m.contact.address ? `<p>${esc(m.contact.address)}${m.contact.directionsUrl ? ` · <a href="${esc(m.contact.directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</p>` : ''}${!P(m).hoursFirst && m.areas.length ? `<p>Serving ${esc(m.areas.slice(0, 6).join(', '))}${m.areas.length > 6 ? ' and nearby' : ''}.</p>` : ''}${mode === 'teaser' && c.multi ? `<a class="f-more" href="${esc(contactHref(c).replace('#quote', ''))}">Hours and contact ${icon('arrow-right', { size: 16 })}</a>` : ''}</div><div>${hoursTable(m)}</div></div></section>`;
  },
  pageHero(c, h1, lead, crumbs) {
    return `<section class="fe-page-hero" id="top" aria-labelledby="top-h"><div class="wrap">${breadcrumbs(c, crumbs)}<h1 id="top-h">${esc(h1)}</h1>${lead ? `<p class="fe-lede">${esc(lead)}</p>` : ''}</div></section>`;
  },
  footer(c) {
    const m = c.m;
    return `<footer class="fe-foot"><div class="wrap"><p class="fe-foot-name">${esc(m.business.name)}</p><div class="fe-foot-grid">
      <div><h2>Visit</h2><p>${esc(m.contact.address || m.areas.slice(0, 3).join(', ') || m.facts.city || '')}</p></div>
      <div><h2>Hours</h2>${m.hours.compact.length ? `<ul>${m.hours.compact.slice(0, 4).map((r) => `<li>${esc(r.days)}: ${esc(r.time)}</li>`).join('')}</ul>` : '<p>By appointment</p>'}</div>
      <div><h2>Contact</h2>${tel(m) ? `<p><a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a></p>` : ''}<p><a href="${esc(contactHref(c))}">${esc(D(m).actionLabel)}</a></p></div></div>
      <p class="fe-foot-small">© ${new Date().getFullYear()} ${esc(m.business.name)}</p></div></footer>`;
  },
};

/* ══════════════════ Warm Local ══════════════════ */
const warm: Family = {
  header(c) {
    const m = c.m;
    const items = navItems(c, D(m).plan.sections.map((s) => s.id));
    const strip = [todayHours(m) && `${icon('clock', { size: 15 })}<span>${esc(todayHours(m))}</span>`, tel(m) && `${icon('phone', { size: 15 })}<a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a>`, m.facts.city && `${icon('map-pin', { size: 15 })}<span>${esc(m.facts.city)}</span>`].filter(Boolean);
    const cta = `<a class="btn btn-primary fw-head-cta" href="${esc(primaryHref(c))}" data-ev="${reqEv(m)}">${esc(D(m).headerLabel)}</a>`;
    return `${strip.length ? `<div class="fw-strip"><div class="wrap fw-strip-in">${strip.map((s) => `<span class="fw-strip-item">${s}</span>`).join('')}</div></div>` : ''}<header class="fw-head"><div class="wrap fw-head-in"><a class="fw-logo" href="${esc(c.link(''))}" aria-label="${esc(m.business.name)}, home">${logo(m, 'fw')}</a><nav class="fw-nav" aria-label="Main">${navHtml(items)}</nav>${cta}${mobileMenu(items, '')}</div></header>`;
  },
  hero(c, v) {
    const m = c.m;
    const d = D(m);
    const badge = m.proof.showRating ? `<p class="fw-badge">${stars(m.proof.rating || 0, 15)}<span>${m.proof.rating?.toFixed(1)} · ${m.proof.reviewCount} Google reviews</span></p>` : `<p class="fw-badge"><span>Welcome to ${esc(m.business.name)}</span></p>`;
    const actions = `<div class="btn-row fw-actions"><a class="btn btn-primary" href="${esc(primaryHref(c))}" data-ev="${reqEv(m)}">${esc(primaryLabel(m))}</a>${d.plan.goal !== 'call' && tel(m) ? `<a class="btn btn-secondary" href="${tel(m)}" data-ev="call">${icon('phone', { size: 18 })}<span>${esc(m.contact.phone)}</span></a>` : ''}</div>`;
    const text = `${badge}<h1 id="top-h">${esc(m.copy.hero)}</h1><p class="fw-lede">${esc(m.copy.subline)}</p>${actions}${apptNote(m)}`;
    const card = todayHours(m) || m.contact.address ? `<div class="fw-card">${todayHours(m) ? `<p><b>${esc(P(m).hoursFirst ? 'Open' : 'Hours')}</b><span>${esc(todayHours(m))}</span></p>` : ''}${m.contact.address ? `<p><b>Find us</b><span>${esc(m.contact.address.split(',').slice(0, 2).join(','))}</span></p>` : ''}</div>` : '';
    const second = d.gallery[0];
    if (((v === 'split' || v === 'photo-led') && d.heroImages) || (v === 'carousel' && d.slides.length >= 2)) {
      const main = v === 'carousel' ? carousel(d.slides) : `<figure class="fw-frame">${picture(d.heroImages!, true)}${credit(d.heroImages!.desktop)}</figure>`;
      return `<section class="fw-hero" id="top" aria-labelledby="top-h"><div class="wrap fw-hero-grid"><div class="fw-hero-text">${text}</div><div class="fw-collage">${main}${v !== 'carousel' && second ? `<figure class="fw-polaroid" aria-hidden="true"><img src="${esc(second.publicPath)}" width="${second.width}" height="${second.height}" alt="" loading="lazy" decoding="async"></figure>` : ''}${card}</div></div></section>`;
    }
    return `<section class="fw-hero fw-hero-type" id="top" aria-labelledby="top-h"><div class="wrap"><div class="fw-hero-text fw-center">${text}</div>${card ? `<div class="fw-cards">${card}</div>` : ''}</div></section>`;
  },
  intro(c) {
    const d = D(c.m);
    if (!d.intro) return '';
    return `<section class="fw-intro" id="about" aria-labelledby="about-h"><div class="wrap"><div class="fw-intro-card"><h2 id="about-h">${esc(introHeading(c.m, c.m.design!.plan.category === 'trades' ? 'About us' : `Welcome to ${c.m.business.name}`))}</h2>${introHtml(d)}${facts(c.m).length ? `<ul class="fw-chips">${facts(c.m).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div></div></section>`;
  },
  offerings(c, _v, mode) {
    const m = c.m;
    const list = offerList(m, mode);
    if (!list.length) return '';
    const more = mode === 'teaser' && offersRoute(c) ? `<a class="f-more" href="${esc(c.link(offersRoute(c)!))}">See all ${esc(P(m).offeringsTitle.toLowerCase())} ${icon('arrow-right', { size: 16 })}</a>` : '';
    return `<section class="fw-offers" id="services" aria-labelledby="services-h"><div class="wrap"><div class="fw-sec-head"><h2 id="services-h">${esc(P(m).offeringsTitle)}</h2>${more}</div><div class="fw-menu-card"><ul class="fw-menu">${list.map((o) => `<li><div class="fw-row"><h3>${offerName(c, o)}</h3><span class="fw-dots" aria-hidden="true"></span>${priceTag(o, 'fw-price', c)}</div>${o.description || o.duration || o.note ? `<p>${esc([o.description, o.duration, o.note].filter(Boolean).join(' · '))}</p>` : ''}</li>`).join('')}</ul>${sampleNote(m)}</div></div></section>`;
  },
  proof(c) {
    const m = c.m;
    const q = reviewQuotes(m, 3);
    if (!q.length && !m.trust.length && !D(m).reviewsLink) return '';
    return `<section class="fw-proof" id="reviews" aria-labelledby="reviews-h"><div class="wrap"><div class="fw-sec-head"><h2 id="reviews-h">${esc(m.proof.showRating ? P(m).proofTitle(m.facts.city) : 'Good to know')}</h2>${m.proof.showRating ? `<p class="fw-badge">${stars(m.proof.rating || 0, 15)}<span>${m.proof.rating?.toFixed(1)} from ${m.proof.reviewCount} Google reviews</span></p>` : ''}</div>
      ${q.length ? `<div class="fw-quotes">${q.map((r) => `<figure class="fw-quote"><span class="fw-avatar" aria-hidden="true">${esc(initials(r.author))}</span>${stars(r.rating, 14)}<blockquote><p>${esc(r.text)}</p></blockquote><figcaption>${esc(r.author)} · ${esc(r.from ?? 'Google review')}</figcaption></figure>`).join('')}</div>` : ''}
      ${m.trust.length ? `<ul class="fw-chips">${m.trust.map((t) => `<li>${icon('badge-check', { size: 16 })}${esc(t)}</li>`).join('')}</ul>` : ''}${reviewsLink(m, 'fw-proof-link')}</div></section>`;
  },
  gallery(c) {
    const ps = D(c.m).gallery;
    if (ps.length < 2) return '';
    return `<section class="fw-gallery" id="work" aria-labelledby="work-h"><div class="wrap"><div class="fw-sec-head"><h2 id="work-h">${esc(galleryTitle(c.m))}</h2></div><div class="gal fw-grid">${ps.slice(0, ps.length >= 6 ? 6 : ps.length >= 3 ? 3 : 2).map((p, i) => fig(p, i, ps.length)).join('')}</div></div></section>`;
  },
  cta(c) {
    const m = c.m;
    return `<section class="fw-cta" aria-labelledby="cta-h"><div class="wrap"><div class="fw-cta-card"><div><h2 id="cta-h">${esc(P(m).hoursFirst ? `See you soon at ${m.business.name}` : `Talk to ${m.business.name}`)}</h2><p>${esc(todayHours(m) || D(m).steps[0]?.text || '')}</p></div><div class="btn-row"><a class="btn btn-primary" href="${esc(primaryHref(c))}" data-ev="${reqEv(m)}">${esc(primaryLabel(m))}</a>${tel(m) && D(m).plan.goal !== 'call' ? `<a class="btn btn-secondary" href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a>` : ''}</div></div></div></section>`;
  },
  contact(c) {
    const m = c.m;
    return `<section class="fw-contact" id="quote" aria-labelledby="quote-h"><div class="wrap fw-contact-grid"><div class="fw-contact-info"><h2 id="quote-h">${esc(m.copy.quoteTitle)}</h2><ol class="fw-steps">${D(m).steps.map((s, i) => `<li><span>${i + 1}</span><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div></li>`).join('')}</ol>${tel(m) ? `<p class="fw-call">Prefer to talk? <a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a></p>` : ''}</div><div class="fw-form-card">${leadForm(m)}</div></div></section>`;
  },
  visit(c, mode) {
    const m = c.m;
    if (!m.contact.address && !m.hours.rows.length && !m.areas.length) return '';
    return `<section class="fw-visit" id="visit" aria-labelledby="visit-h"><div class="wrap fw-visit-grid${mode === 'teaser' || !mapEmbed(m) ? ' is-single' : ''}"><div class="fw-visit-card"><h2 id="visit-h">${esc(P(m).areaTitle(m.facts.city))}</h2>${visitAction(c)}${m.contact.address ? `<p class="fw-addr">${icon('map-pin', { size: 18 })}<span>${esc(m.contact.address)}${m.contact.directionsUrl ? `<br><a href="${esc(m.contact.directionsUrl)}" target="_blank" rel="noopener">Get directions</a>` : ''}</span></p>` : ''}${!P(m).hoursFirst && m.areas.length ? `<ul class="fw-chips">${m.areas.slice(0, 8).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}${hoursTable(m)}${mode === 'teaser' && c.multi ? `<a class="f-more" href="${esc(contactHref(c).replace('#quote', ''))}">Contact and directions ${icon('arrow-right', { size: 16 })}</a>` : ''}</div>${mode === 'full' && mapEmbed(m) ? `<div class="fw-map">${mapEmbed(m)}</div>` : ''}</div></section>`;
  },
  pageHero(c, h1, lead, crumbs) {
    return `<section class="fw-page-hero" id="top" aria-labelledby="top-h"><div class="wrap">${breadcrumbs(c, crumbs)}<h1 id="top-h">${esc(h1)}</h1>${lead ? `<p class="fw-lede">${esc(lead)}</p>` : ''}</div></section>`;
  },
  footer(c) {
    const m = c.m;
    return `<footer class="fw-foot"><div class="wrap fw-foot-grid"><div><p class="fw-foot-name">${esc(m.business.name)}</p><p>${esc(D(m).intro ? truncateWords(D(m).intro!, 140) : `${kind(m)}${m.facts.city ? ` in ${m.facts.city}` : ''}`)}</p></div>
      <div><h2>Hours</h2>${m.hours.rows.length ? `<ul>${m.hours.compact.map((r) => `<li><span>${esc(r.days)}</span><span>${esc(r.time)}</span></li>`).join('')}</ul>` : '<p>Contact us for times</p>'}</div>
      <div><h2>Contact</h2>${tel(m) ? `<p><a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a></p>` : ''}${m.contact.address ? `<p>${esc(m.contact.address)}</p>` : ''}<p><a href="${esc(contactHref(c))}">${esc(D(m).actionLabel)}</a></p></div></div>
      <div class="wrap fw-foot-small"><p>© ${new Date().getFullYear()} ${esc(m.business.name)}</p></div></footer>`;
  },
};

/* ══════════════════ Bold Practical ══════════════════ */
const bold: Family = {
  header(c) {
    const m = c.m;
    const items = navItems(c, D(m).plan.sections.map((s) => s.id));
    const call = tel(m) ? `<a class="fb-phone" href="${tel(m)}" data-ev="call" aria-label="Call ${esc(m.contact.phone)}"><span class="fb-phone-l">Call</span><span class="fb-phone-n">${esc(m.contact.phone)}</span><span class="fb-phone-ic">${icon('phone', { size: 20 })}</span></a>` : '';
    const cta = `<a class="btn btn-primary fb-head-cta" href="${esc(primaryHref(c) === tel(m) ? contactHref(c) : primaryHref(c))}" data-ev="${reqEv(m)}">${esc(sourceCta(m)?.label ?? (D(m).plan.goal === 'call' ? D(m).headerLabel : D(m).actionLabel))}</a>`;
    return `<header class="fb-head"><div class="wrap fb-head-in"><a class="fb-logo" href="${esc(c.link(''))}" aria-label="${esc(m.business.name)}, home">${logo(m, 'fb')}</a><nav class="fb-nav" aria-label="Main">${navHtml(items)}</nav>${call}${cta}${mobileMenu(items, '')}</div></header>`;
  },
  hero(c, v) {
    const m = c.m;
    const d = D(m);
    const checks = facts(m);
    const panel = `<aside class="fb-panel" aria-label="${esc(d.actionLabel)}"><p class="fb-panel-h">${esc(d.plan.goal === 'call' && tel(m) ? 'Call now' : d.actionLabel)}</p>${tel(m) ? `<a class="fb-panel-phone" href="${tel(m)}" data-ev="call">${icon('phone', { size: 24 })}<span>${esc(m.contact.phone)}</span></a>` : ''}<a class="btn btn-primary btn-block" href="${esc(sourceCta(m) ? primaryHref(c) : d.plan.goal === 'call' && tel(m) ? contactHref(c) : primaryHref(c))}" data-ev="${reqEv(m)}">${esc(sourceCta(m)?.label ?? (d.plan.goal === 'call' && tel(m) ? 'Send a request' : d.actionLabel))}</a>${todayHours(m) && !/24 hours/i.test(todayHours(m)!) ? `<p class="fb-panel-hours">${icon('clock', { size: 16 })}${esc(todayHours(m))}</p>` : ''}${checks.length ? `<ul class="fb-checks">${checks.map((f) => `<li>${icon('check', { size: 16 })}${esc(f)}</li>`).join('')}</ul>` : ''}</aside>`;
    const text = `<p class="fb-kicker">${esc(m.business.name)}${m.facts.city ? ` · ${esc(m.facts.city)}` : ''}</p><h1 id="top-h"${m.copy.hero.length > 36 ? ' class="is-long"' : ''}>${esc(m.copy.hero)}</h1><p class="fb-lede">${esc(m.copy.subline)}</p>${apptNote(m)}`;
    const photo = (v === 'split' || v === 'photo-led') && d.heroImages ? `<figure class="fb-photo">${picture(d.heroImages, true)}${credit(d.heroImages.desktop)}</figure>` : v === 'carousel' && d.slides.length >= 2 ? `<div class="fb-photo">${carousel(d.slides)}</div>` : '';
    // photo-free: big verified numbers instead of a picture
    const nums = [m.facts.years && [String(m.facts.years), 'years in business'], m.proof.showRating && [m.proof.rating!.toFixed(1), `rating, ${m.proof.reviewCount} reviews`], m.areas.length > 1 && [String(m.areas.length), 'towns served'], d.offerings.length >= 3 && [String(d.offerings.length), `${P(m).noun}s`]].filter(Boolean) as [string, string][];
    const numbers = !photo && nums.length ? `<ul class="fb-nums">${nums.slice(0, 4).map(([n, l]) => `<li><b>${esc(n)}</b><span>${esc(l)}</span></li>`).join('')}</ul>` : '';
    return `<section class="fb-hero${photo ? '' : ' fb-hero-type'}" id="top" aria-labelledby="top-h"><div class="wrap fb-hero-grid"><div class="fb-hero-text">${text}</div>${panel}</div>${numbers ? `<div class="wrap">${numbers}</div>` : ''}${photo ? `<div class="wrap fb-photo-wrap">${photo}</div>` : ''}</section>`;
  },
  intro(c) {
    const d = D(c.m);
    if (!d.intro) return '';
    return `<section class="fb-intro" id="about" aria-labelledby="about-h"><div class="wrap fb-intro-grid"><h2 id="about-h">${esc(introHeading(c.m, 'About'))}</h2><div class="fb-intro-text">${introHtml(d)}</div></div></section>`;
  },
  offerings(c, v, mode) {
    const m = c.m;
    const list = offerList(m, mode);
    if (!list.length) return '';
    const more = mode === 'teaser' && offersRoute(c) ? `<a class="f-more" href="${esc(c.link(offersRoute(c)!))}">All ${esc(P(m).offeringsTitle.toLowerCase())} ${icon('arrow-right', { size: 16 })}</a>` : '';
    const body = v === 'plans'
      ? `<div class="fb-plans">${list.slice(0, 4).map((o, i) => `<article class="fb-plan${i === 0 ? ' is-first' : ''}"><h3>${offerName(c, o)}</h3><p class="fb-plan-price${o.priced ? '' : ' is-quote'}">${esc(o.price)}</p>${o.description ? `<p>${esc(o.description)}</p>` : ''}<a class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}" href="${esc(contactHref(c))}" data-ev="${reqEv(m)}">${esc(D(m).actionLabel)}<span class="visually-hidden"> about ${esc(o.name)}</span></a></article>`).join('')}</div>`
      : `<ul class="fb-table">${list.map((o) => `<li><div><h3>${offerName(c, o)}</h3>${o.description || o.duration || o.note ? `<p>${esc([o.description, o.duration, o.note].filter(Boolean).join(' · '))}</p>` : ''}</div>${priceTag(o, 'fb-price', c)}</li>`).join('')}</ul>`;
    return `<section class="fb-offers" id="services" aria-labelledby="services-h"><div class="wrap"><div class="fb-sec-head"><h2 id="services-h">${esc(P(m).offeringsTitle)}</h2>${more}</div>${body}${sampleNote(m)}</div></section>`;
  },
  proof(c) {
    const m = c.m;
    const q = reviewQuotes(m, 1)[0];
    if (!q && !m.proof.showRating && !m.trust.length && !D(m).reviewsLink) return '';
    return `<section class="fb-proof" id="reviews" aria-labelledby="reviews-h"><div class="wrap fb-proof-grid"><div><h2 id="reviews-h">${esc(m.proof.showRating ? 'Rated by customers' : 'Good to know')}</h2>${m.proof.showRating ? `<p class="fb-rating"><b>${m.proof.rating?.toFixed(1)}</b><span>${stars(m.proof.rating || 0, 18)}<br>${m.proof.reviewCount} Google reviews</span></p>` : ''}${m.trust.length ? `<ul class="fb-checks">${m.trust.map((t) => `<li>${icon('check', { size: 16 })}${esc(t)}</li>`).join('')}</ul>` : ''}${reviewsLink(m, 'fb-proof-link')}</div>${q ? `<figure class="fb-quote"><blockquote><p>“${esc(q.text)}”</p></blockquote><figcaption>${esc(q.author)} · ${esc((q as { from?: string }).from ?? 'Google review')}</figcaption></figure>` : ''}</div></section>`;
  },
  gallery(c) {
    const ps = D(c.m).gallery;
    if (ps.length < 2) return '';
    return `<section class="fb-gallery" id="work" aria-labelledby="work-h"><div class="wrap"><div class="fb-sec-head"><h2 id="work-h">${esc(galleryTitle(c.m))}</h2></div><div class="gal fb-grid">${ps.slice(0, ps.length >= 4 ? 4 : 2).map((p, i) => fig(p, i, ps.length)).join('')}</div></div></section>`;
  },
  cta(c) {
    const m = c.m;
    return `<section class="fb-cta" aria-labelledby="cta-h"><div class="wrap fb-cta-in"><h2 id="cta-h">${esc(D(m).plan.goal === 'call' && tel(m) ? 'Call us now' : D(m).actionLabel)}</h2><div class="btn-row">${tel(m) ? `<a class="btn btn-light" href="${tel(m)}" data-ev="call">${icon('phone', { size: 18 })}<span>${esc(m.contact.phone)}</span></a>` : ''}<a class="btn fb-btn-outline" href="${esc(contactHref(c))}" data-ev="${reqEv(m)}">${esc(D(m).plan.goal === 'call' ? 'Send a request' : D(m).actionLabel)}</a></div></div></section>`;
  },
  contact(c) {
    const m = c.m;
    return `<section class="fb-contact" id="quote" aria-labelledby="quote-h"><div class="wrap fb-contact-grid"><div><h2 id="quote-h">${esc(m.copy.quoteTitle)}</h2>${tel(m) ? `<a class="fb-panel-phone" href="${tel(m)}" data-ev="call">${icon('phone', { size: 24 })}<span>${esc(m.contact.phone)}</span></a>` : ''}<ol class="fb-steps">${D(m).steps.map((s, i) => `<li><b>${i + 1}</b><span>${esc(s.title)}</span></li>`).join('')}</ol>${apptNote(m)}</div><div>${leadForm(m)}</div></div></section>`;
  },
  visit(c, mode) {
    const m = c.m;
    if (!m.contact.address && !m.hours.rows.length && !m.areas.length) return '';
    return `<section class="fb-visit" id="visit" aria-labelledby="visit-h"><div class="wrap fb-visit-grid"><div><h2 id="visit-h">${esc(P(m).areaTitle(m.facts.city))}</h2>${visitAction(c)}${m.contact.address ? `<p class="fb-addr">${esc(m.contact.address)}${m.contact.directionsUrl ? ` · <a href="${esc(m.contact.directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</p>` : ''}${!P(m).hoursFirst && m.areas.length ? `<ul class="fb-areas">${m.areas.slice(0, 10).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}${mode === 'teaser' && c.multi ? `<a class="f-more" href="${esc(contactHref(c).replace('#quote', ''))}">Contact ${icon('arrow-right', { size: 16 })}</a>` : ''}</div><div>${hoursTable(m)}</div></div></section>`;
  },
  pageHero(c, h1, lead, crumbs) {
    return `<section class="fb-page-hero" id="top" aria-labelledby="top-h"><div class="wrap">${breadcrumbs(c, crumbs)}<h1 id="top-h">${esc(h1)}</h1>${lead ? `<p class="fb-lede">${esc(lead)}</p>` : ''}</div></section>`;
  },
  footer(c) {
    const m = c.m;
    return `<footer class="fb-foot"><div class="wrap fb-foot-grid"><div><p class="fb-foot-name">${esc(m.business.name)}</p>${tel(m) ? `<p><a href="${tel(m)}" data-ev="call">${esc(m.contact.phone)}</a></p>` : ''}${m.contact.address ? `<p>${esc(m.contact.address)}</p>` : ''}</div>
      <div><h2>Hours</h2>${m.hours.compact.length ? `<ul>${m.hours.compact.slice(0, 4).map((r) => `<li>${esc(r.days)} ${esc(r.time)}</li>`).join('')}</ul>` : '<p>Call for times</p>'}</div>
      <div><h2>${esc(P(m).hoursFirst ? 'Visit' : 'Areas')}</h2><p>${esc(P(m).hoursFirst ? (m.facts.city || '') : m.areas.slice(0, 6).join(' · '))}</p></div></div><div class="wrap fb-foot-small"><p>© ${new Date().getFullYear()} ${esc(m.business.name)}</p></div></footer>`;
  },
};

function breadcrumbs(c: FCtx, crumbs: { label: string; route: string }[]) {
  return `<nav class="f-crumbs" aria-label="Breadcrumb"><ol>${crumbs.map((x, i) => `<li>${i === crumbs.length - 1 ? `<span aria-current="page">${esc(x.label)}</span>` : `<a href="${esc(c.link(x.route))}">${esc(x.label)}</a>`}</li>`).join('')}</ol></nav>`;
}

export const FAMILY_RENDERERS: Record<string, Family> = { 'editorial-showcase': editorial, 'warm-local': warm, 'bold-practical': bold };
export const isFamilyV2 = (m: SiteModel) => !!m.design && (m.design.plan.family?.version ?? 1) >= 2 && !!FAMILY_RENDERERS[m.design.plan.family.id];

/** The main content of one page: plan sections on Home, page-type compositions elsewhere. */
function pageBody(f: Family, c: FCtx): string {
  const m = c.m;
  const d = D(m);
  const plan = d.plan;
  const variant = (id: string) => plan.sections.find((s) => s.id === id)?.variant ?? '';
  const offerVariant = variant('services') || 'cards';
  if (c.page.type === 'home') {
    const out: string[] = [];
    let videosDone = false;
    for (const s of plan.sections) {
      switch (s.id) {
        case 'hero': out.push(withSecondary(f.hero(c, s.variant), c)); break;
        case 'intro': out.push(f.intro(c)); break;
        case 'urgent': out.push(urgent(c)); break;
        case 'services': case 'focus': out.push(hasServiceCards(m) ? serviceCards(c, c.multi ? 'teaser' : 'full') : f.offerings(c, offerVariant, c.multi ? 'teaser' : 'full')); break;
        case 'team': if (!c.multi || !c.sp.pages.some((p) => p.type === 'about')) out.push(team(c)); break;
        case 'gallery': out.push(f.gallery(c, s.variant)); if (!videosDone) { out.push(videos(c)); videosDone = true; } break;
        case 'process': out.push(process(c)); break;
        case 'proof': out.push(f.proof(c)); break;
        case 'quote': out.push(c.multi ? f.cta(c) : bookingUrl(m) ? '' : f.contact(c)); break; // a site with its own booking page needs no second form
        case 'area': if (!videosDone) { out.push(videos(c)); videosDone = true; } out.push(f.visit(c, c.multi ? 'teaser' : 'full')); break;
        default: break; // actions: part of each family's hero; footer: the shell
      }
    }
    return out.join('');
  }
  const home = { label: 'Home', route: '' };
  if (c.page.type === 'offerings') return f.pageHero(c, d.profile.offeringsTitle, `${m.business.name}${m.facts.city ? `, ${m.facts.city}` : ''}. ${d.offerings.some((o) => o.priced) ? 'Prices are shown where they are set.' : `Ask for a price on any ${d.profile.noun}.`}`, [home, { label: d.profile.offeringsTitle, route: c.page.route }]) + (hasServiceCards(m) ? serviceCards(c, 'full') : f.offerings(c, offerVariant, 'full')) + f.cta(c);
  if (c.page.type === 'offering') {
    const o = d.offerings.find((x) => x.id === c.page.offeringId)!;
    const parent = c.sp.pages.find((p) => p.type === 'offerings');
    return f.pageHero(c, o.name, `${o.priced ? `${o.price} · ` : ''}${m.business.name}${m.facts.city ? `, ${m.facts.city}` : ''}`, [home, ...(parent ? [{ label: d.profile.offeringsTitle, route: parent.route }] : []), { label: o.name, route: c.page.route }]) + offeringDetail(c, 'f') + f.cta(c);
  }
  if (c.page.type === 'about') return f.pageHero(c, `About ${m.business.name}`, facts(m).join(' · '), [home, { label: 'About', route: c.page.route }]) + f.intro(c) + videos(c) + team(c) + f.proof(c) + f.gallery(c, variant('gallery') || 'grid') + f.cta(c);
  return f.pageHero(c, `Contact ${m.business.name}`, todayHours(m), [home, { label: 'Contact', route: c.page.route }]) + f.contact(c) + f.visit(c, 'full');
}

/** Relative asset paths for a page below the root ("assets/x" → "../assets/x"). */
export function relocate(html: string, depth: number): string {
  if (!depth) return html;
  const up = '../'.repeat(depth);
  return html
    .replace(/(src|srcset|href)="(assets\/|favicon\.svg|apple-touch-icon\.png|og\.jpg|preview\.jpg)/g, (_m, a, p) => `${a}="${up}${p}`)
    .replace(/"src":"assets\//g, `"src":"${up}assets/`);
}

/** One complete page of a family (version 2) site. */
export function renderFamilyPage(m: SiteModel, sp: SitePlan, page: SitePage, seo: PageSeo): string {
  const f = FAMILY_RENDERERS[m.design!.plan.family.id];
  const c: FCtx = { m, sp, page, multi: sp.mode === 'multi', link: (r, h = '') => relLink(page.route, r, h) };
  const body = pageBody(f, c);
  const t = m.theme;
  const d = m.design!;
  const fonts = m.fonts.faces.length ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${m.fonts.faces.map((x) => `<link rel="preload" as="style" href="${esc(x.url)}"><link rel="stylesheet" href="${esc(x.url)}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${esc(x.url)}"></noscript>`).join('')}` : '';
  const lead = page.type === 'home' ? d.heroImages || d.slides[0] : undefined;
  const preload = lead ? `<link rel="preload" as="image" href="${esc(lead.mobile.publicPath)}" media="(max-width: 899px)" fetchpriority="high"><link rel="preload" as="image" href="${esc(lead.desktop.publicPath)}" media="(min-width: 900px)" fetchpriority="high">` : '';
  const banner = m.preview && t.roger.previewBanner ? `<div class="preview">Preview: a free website draft Roger made for ${esc(m.business.name.replace(/\.$/, ''))}.</div>` : '';
  const widget = t.roger.widget !== false;
  const html = `<!doctype html>
<html lang="${esc(seo.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(seo.title)}</title>
<meta name="description" content="${esc(seo.description)}">
<meta name="robots" content="${seo.robots}">
<link rel="canonical" href="${esc(seo.canonical)}">
<meta name="theme-color" content="${m.brand.brand}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(seo.title)}"><meta property="og:description" content="${esc(seo.description)}"><meta property="og:url" content="${esc(seo.canonical)}"><meta property="og:site_name" content="${esc(m.business.name)}">${seo.ogImage ? `<meta property="og:image" content="${esc(seo.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="apple-touch-icon.png">
${fonts}${preload}
<style>${buildCss(m)}${familyCss()}</style>
<style id="rg-brand">${d.brandCss ?? ''}</style>
<style id="rg-appearance">${d.appearanceCss}</style>
${seo.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}
</head>
<body class="${widget ? 'has-rw' : ''}" data-family="${esc(d.plan.family.id)}" data-family-version="${d.plan.family.version}" data-category="${esc(d.plan.category)}" data-motion="${esc(d.motion)}" data-plan="${esc(d.plan.id)}" data-page="${esc(page.type)}">
<a class="skip" href="#main">Skip to content</a>
${banner}${f.header(c)}
<main id="main">${body}</main>
${f.footer(c)}
${widget ? rogerWidget(m) : ''}${lightbox(m)}
<script>${CLIENT_JS(m)}${WIDGETS_JS(m)}${d.slides.length && page.type === 'home' ? CAROUSEL_JS : ''}</script>
</body>
</html>`;
  return relocate(externalLinks(html, m.urls.base), routeDepth(page.route));
}

/** Links that leave the site (a booking page, directions) open in a new tab without handing over the opener. */
export function externalLinks(html: string, own: string): string {
  return html.replace(/<a ([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/g, (m, a, href, z) => (/target=/.test(a + z) || href.startsWith(own) ? m : `<a ${a}href="${href}" target="_blank" rel="noopener"${z}>`));
}

/** A real 404 page in the site's family (served with status 404). */
export function renderNotFound(m: SiteModel, sp: SitePlan, seo: PageSeo): string {
  const page: SitePage = { id: 'not-found', type: 'contact', route: '' };
  const f = FAMILY_RENDERERS[m.design!.plan.family.id];
  const c: FCtx = { m, sp, page, multi: sp.mode === 'multi', link: (r, h = '') => `/${r}${h}` };
  return `<!doctype html><html lang="${esc(seo.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | ${esc(m.business.name)}</title><meta name="robots" content="noindex"><style>${buildCss(m)}${familyCss()}</style><style>${m.design!.appearanceCss}</style></head>
<body data-family="${esc(m.design!.plan.family.id)}" data-page="not-found">${f.header(c)}<main id="main">${f.pageHero(c, 'Page not found', 'This page doesn\'t exist or has moved.', [{ label: 'Home', route: '' }])}<section class="f-404"><div class="wrap"><a class="btn btn-primary" href="/">Go to the home page</a></div></section></main>${f.footer(c)}</body></html>`;
}

export { familyCss } from './family-css.js';
import { familyCss } from './family-css.js';
