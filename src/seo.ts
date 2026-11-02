import type { SiteModel } from './content/model.js';
import type { SitePage, SitePlan } from './design/siteplan.js';
import { OFFERINGS_ROUTE } from './design/siteplan.js';
import type { Category } from './design/categories.js';

/**
 * One SEO configuration for every renderer and the publishing flow. A page is indexable only when the site is
 * really published (after the publish checks) on its primary origin; drafts, share previews, owner pages,
 * checkout and simulated launches stay noindex. Canonical, social and structured-data URLs always use the actual
 * primary origin: the verified custom domain, otherwise the deliberately chosen hosted address. A simulated
 * domain step never changes it. Structured data only states what the page shows and the owner confirmed.
 */
export interface SeoContext {
  /** where the site lives, absolute, no trailing slash ("https://example.com", "http://localhost:4000/sites/x") */
  base: string;
  state: 'preview' | 'published';
  /** true only for a published revision that passed the publish checks */
  indexable: boolean;
  lang: string;
  /** when the published revision was saved (sitemap lastmod) */
  lastmod?: string;
}

export interface PageSeo {
  title: string;
  description: string;
  canonical: string;
  robots: 'noindex' | 'index, follow';
  ogImage?: string;
  lang: string;
  jsonLd: Record<string, unknown>[];
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const kindOf = (m: SiteModel) => (m.business.primaryTypeLabel && !/establishment|point of interest/i.test(m.business.primaryTypeLabel) ? m.business.primaryTypeLabel : m.design?.profile.label || 'Local business');
export const absolute = (ctx: SeoContext, route: string) => `${ctx.base}/${route}`;

/** Most specific schema.org type the Google category supports; a truthful LocalBusiness otherwise. */
const TYPE_MAP: [RegExp, string][] = [
  [/^plumber$/, 'Plumber'], [/^electrician$/, 'Electrician'], [/^roofing_contractor$/, 'RoofingContractor'], [/^(hvac_contractor|air_conditioning_contractor)$/, 'HVACBusiness'],
  [/^general_contractor$/, 'GeneralContractor'], [/^locksmith$/, 'Locksmith'], [/^painter$/, 'HousePainter'], [/^moving_company$/, 'MovingCompany'],
  [/^(hair_salon|hair_care|barber_shop)$/, 'HairSalon'], [/^nail_salon$/, 'NailSalon'], [/^(beauty_salon|beautician|makeup_artist)$/, 'BeautySalon'], [/^spa$/, 'DaySpa'],
  [/^(cafe|coffee_shop|tea_house)$/, 'CafeOrCoffeeShop'], [/^bakery$/, 'Bakery'], [/^(bar|pub)$/, 'BarOrPub'], [/^ice_cream_shop$/, 'IceCreamShop'], [/restaurant$|^meal_takeaway$|^brunch/, 'Restaurant'],
  [/^(gym|fitness_center|boxing_gym)$/, 'ExerciseGym'], [/^(yoga_studio|pilates_studio|dance_school|martial_arts_school)$/, 'SportsActivityLocation'],
  [/^(accounting|bookkeeper|tax_preparer)$/, 'AccountingService'], [/^lawyer$/, 'LegalService'], [/^insurance_agency$/, 'InsuranceAgency'], [/^real_estate_agency$/, 'RealEstateAgent'],
  [/^(consultant|business_consultant|marketing_agency|architect)$/, 'ProfessionalService'], [/^travel_agency$/, 'TravelAgency'], [/^employment_agency$/, 'EmploymentAgency'],
  [/^book_store$/, 'BookStore'], [/^florist$/, 'Florist'], [/^clothing_store$/, 'ClothingStore'], [/^hardware_store$/, 'HardwareStore'], [/^(furniture_store|home_goods_store)$/, 'HomeGoodsStore'], [/_store$|^store$/, 'Store'],
];
export function schemaType(primaryType?: string, category?: Category): string {
  for (const [re, t] of TYPE_MAP) if (primaryType && re.test(primaryType)) return t;
  return category === 'trades' ? 'HomeAndConstructionBusiness' : 'LocalBusiness';
}

/** Title and description for a page: the owner's override first, then a template filled with page-specific facts. */
export function pageMeta(m: SiteModel, sp: SitePlan, page: SitePage): { title: string; description: string; h1?: string } {
  const b = m.business;
  const city = m.facts.city;
  const o = sp.overrides[page.id] || {};
  const d = m.design!;
  const offer = page.offeringId ? d.offerings.find((x) => x.id === page.offeringId) : undefined;
  const label = OFFERINGS_ROUTE[d.plan.category].label;
  let title: string;
  let description: string;
  switch (page.type) {
    case 'offerings':
      title = `${d.profile.offeringsTitle} | ${b.name}`;
      description = `${d.profile.offeringsTitle} at ${b.name}${city ? ` in ${city}` : ''}: ${d.offerings.slice(0, 3).map((x) => x.name.toLowerCase()).join(', ')}${d.offerings.length > 3 ? ' and more' : ''}.${d.offerings.some((x) => x.priced) ? ' Prices included.' : ''} ${d.actionLabel}.`;
      break;
    case 'offering':
      title = `${offer?.name ?? label}${city ? ` in ${city}` : ''} | ${b.name}`;
      description = `${offer?.description ?? offer?.name ?? ''}${offer?.priced ? ` ${offer.price}.` : ''} ${b.name}${city ? `, ${city}` : ''}.`;
      break;
    case 'about':
      title = `About ${b.name}`;
      description = d.intro || `About ${b.name}${city ? ` in ${city}` : ''}.`;
      break;
    case 'contact':
      title = `Contact ${b.name}${city ? ` in ${city}` : ''}`;
      description = `Opening hours, address and how to reach ${b.name}${city ? ` in ${city}` : ''}. ${d.actionLabel} online${d.phoneOk && m.contact.phone ? ` or call ${m.contact.phone}` : ''}.`;
      break;
    default: {
      const full = `${b.name} | ${kindOf(m)}${city ? ` in ${city}` : ''}`;
      title = full.length <= 62 ? full : `${b.name}${city ? ` | ${city}` : ''}`;
      description = m.copy.subline || `${b.name}, ${kindOf(m).toLowerCase()}${city ? ` in ${city}` : ''}.`;
    }
  }
  return { title: clip(o.title || title, 70), description: clip((o.description || description).replace(/\s+/g, ' ').trim(), 165) };
}

/** Everything a page's <head> needs. */
export function pageSeo(m: SiteModel, sp: SitePlan, page: SitePage, ctx: SeoContext, opts: { ogImage?: string; images?: string[] } = {}): PageSeo {
  const meta = pageMeta(m, sp, page);
  const canonical = absolute(ctx, page.route);
  return {
    ...meta,
    canonical,
    robots: ctx.indexable ? 'index, follow' : 'noindex',
    ogImage: opts.ogImage,
    lang: ctx.lang,
    jsonLd: structuredData(m, sp, page, ctx, opts.images ?? []),
  };
}

/** Structured data that matches what the page shows. No self-serving review ratings; no address the business keeps private. */
export function structuredData(m: SiteModel, sp: SitePlan, page: SitePage, ctx: SeoContext, images: string[]): Record<string, unknown>[] {
  const b = m.business;
  const d = m.design!;
  const home = absolute(ctx, '');
  const id = `${home}#business`;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = m.facts.open24h
    ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: dayNames, opens: '00:00', closes: '23:59' }]
    : m.hours.periods.filter((p: any) => p.close).map((p: any) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayNames[p.open.day], opens: `${pad(p.open.hour)}:${pad(p.open.minute)}`, closes: `${pad(p.close.hour)}:${pad(p.close.minute)}` }));
  const out: Record<string, unknown>[] = [];
  const business: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType(b.primaryType, d.plan.category),
    '@id': id,
    name: b.name,
    url: home,
    telephone: m.contact.phone && d.phoneOk ? (b.phoneE164 || m.contact.phone) : undefined,
    // a street address only when the page shows one (service-area businesses often keep theirs private)
    address: b.street && m.contact.address ? { '@type': 'PostalAddress', streetAddress: b.street, addressLocality: b.city, addressRegion: b.state, postalCode: b.zip, addressCountry: b.country || undefined } : undefined,
    areaServed: !b.street && m.areas.length ? m.areas.map((a) => ({ '@type': 'City', name: a })) : undefined,
    openingHoursSpecification: hours.length ? hours : undefined,
    logo: m.brand.logo ? `${home}${m.brand.logo.publicPath}` : undefined,
    image: images.length ? images.map((i) => (/^https?:/.test(i) ? i : `${home}${i}`)) : undefined,
    sameAs: m.socials.length ? m.socials.map((s) => s.url) : undefined,
  };
  if (page.type === 'home' || page.type === 'contact' || page.type === 'about') out.push(business);
  const priced = d.offerings.filter((o) => o.priced && !o.sample);
  if (page.type === 'offerings' || (page.type === 'home' && sp.mode === 'single')) {
    if (priced.length) out.push({ '@context': 'https://schema.org', '@type': 'OfferCatalog', name: d.profile.offeringsTitle, url: absolute(ctx, page.route), provider: { '@id': id }, itemListElement: priced.map((o) => offerLd(o, m)) });
  }
  if (page.type === 'offering') {
    const o = d.offerings.find((x) => x.id === page.offeringId);
    if (o) out.push({ '@context': 'https://schema.org', '@type': 'Service', name: o.name, description: o.description, provider: { '@type': schemaType(b.primaryType, d.plan.category), name: b.name, url: home }, areaServed: m.facts.city || undefined, offers: o.priced && !o.sample ? offerLd(o, m) : undefined, url: absolute(ctx, page.route) });
  }
  if (page.type !== 'home') {
    const trail: { name: string; route: string }[] = [{ name: 'Home', route: '' }];
    if (page.type === 'offering') { const parent = sp.pages.find((p) => p.type === 'offerings'); if (parent) trail.push({ name: d.profile.offeringsTitle, route: parent.route }); }
    trail.push({ name: pageMeta(m, sp, page).title.split(' | ')[0], route: page.route });
    out.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: absolute(ctx, t.route) })) });
  }
  return out.map(strip);
}

function offerLd(o: { name: string; description?: string; priceData?: { kind: string; amount?: number; max?: number; currency: string; unit?: string } }, _m: SiteModel) {
  const p = o.priceData;
  const spec = !p ? undefined : p.kind === 'range'
    ? { '@type': 'PriceSpecification', minPrice: p.amount, maxPrice: p.max, priceCurrency: p.currency }
    : p.kind === 'from' ? { '@type': 'PriceSpecification', minPrice: p.amount, priceCurrency: p.currency }
      : p.kind === 'unit' ? { '@type': 'UnitPriceSpecification', price: p.amount, priceCurrency: p.currency, unitText: p.unit }
        : { '@type': 'PriceSpecification', price: p.amount, priceCurrency: p.currency };
  return { '@type': 'Offer', itemOffered: { '@type': 'Service', name: o.name, description: o.description }, priceSpecification: spec };
}

const strip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** robots.txt for a published site: everything public may be crawled, including assets needed to render. */
export function robotsTxt(ctx: SeoContext): string {
  if (!ctx.indexable) return 'User-agent: *\nAllow: /\n'; // pages carry noindex; crawlers must be able to read it
  return `User-agent: *\nAllow: /\n\nSitemap: ${absolute(ctx, 'sitemap.xml')}\n`;
}

/** sitemap.xml: canonical, indexable pages of the published revision only (no drafts, redirects or retired routes). */
export function sitemapXml(ctx: SeoContext, sp: SitePlan): string {
  if (!ctx.indexable) return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const urls = sp.pages.map((p) => `  <url><loc>${esc(absolute(ctx, p.route))}</loc>${ctx.lastmod ? `<lastmod>${ctx.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Readiness problems the owner's SEO panel lists (technical checks, not a ranking promise). */
export function seoIssues(m: SiteModel, sp: SitePlan): { page: string; issue: string }[] {
  const out: { page: string; issue: string }[] = [];
  const titles = new Map<string, string>();
  for (const p of sp.pages) {
    const meta = pageMeta(m, sp, p);
    if (titles.has(meta.title)) out.push({ page: p.id, issue: `Same title as ${titles.get(meta.title)}` });
    titles.set(meta.title, p.id);
    if (meta.title.length < 15) out.push({ page: p.id, issue: 'Title is very short' });
    if (meta.description.length < 50) out.push({ page: p.id, issue: 'Description is short: say what you offer and where' });
  }
  if (!m.contact.phone && !m.contact.address) out.push({ page: 'home', issue: 'No phone number or address: visitors and search engines can\'t tell how to reach you' });
  if (!m.facts.city) out.push({ page: 'home', issue: 'No town or city: local searches can\'t match you' });
  return out;
}
