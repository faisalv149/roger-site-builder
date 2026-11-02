import type { Theme } from '../theme/schema.js';
import type { BrandResult, Business, Facts, ServiceItem } from '../types.js';
import type { SiteImage } from '../brand/photos.js';
import { digits, fillPlaceholders, titleCase, truncateWords } from '../util/text.js';
import type { DesignModel } from '../design/compose.js';

/** What the business's own website contributes beyond Google: its booking page, story and videos, with how well each was read. */
export interface SourceBundle {
  /** the website everything here was read from */
  website?: string;
  booking?: { url: string; label: string; platform?: string; kind: 'online' | 'phone' | 'email' | 'page' };
  story?: { heading: string; text: string };
  videos: { title?: string; duration?: string; kind: 'file' | 'hls' | 'youtube' | 'vimeo' | 'embed'; url: string; pageUrl: string; poster?: { publicPath: string; width: number; height: number }; note?: string }[];
  /** the extractors' results and the pre-delivery checks (kept with the draft, not rendered) */
  extraction?: import('./extraction.js').ExtractionReport;
  review?: import('./validate.js').BuildReview;
}

export interface SiteModel {
  slug: string;
  themeId: string;
  theme: Theme;
  business: Business;
  facts: Facts;
  brand: BrandResult;
  brandText: string;
  fonts: { heading: string; body: string; faces: { family: string; url: string }[] };
  copy: {
    hero: string;
    subline: string;
    urgent: string;
    action: string;
    actionKind: 'call' | 'form';
    quoteTitle: string;
    maintenance?: string;
    seoTitle: string;
    seoDescription: string;
    wordmark: string;
  };
  services: { items: ServiceItem[]; overflow: boolean; overflowLabel?: string };
  trust: string[];
  proof: {
    showRating: boolean;
    rating?: number;
    reviewCount?: number;
    quotes: { text: string; author: string; rating: number }[];
    /** every review good enough to show, for the review slider (src/render/widgets.ts) */
    reviews: { text: string; author: string; rating: number; when?: string }[];
    stats: { value: string; label: string }[];
  };
  areas: string[];
  showMap: boolean;
  hours: { rows: { day: string; time: string }[]; compact: { days: string; time: string }[]; periods: any[]; utcOffsetMinutes?: number; showOpenNow: boolean };
  images: { hero: SiteImage; heroIsStock: boolean; gallery: SiteImage[] };
  visible: Record<string, boolean>;
  hidden: Record<string, string>;
  contact: { phone?: string; tel?: string; sms?: string; email?: string; address?: string; mapsUrl?: string; directionsUrl?: string };
  socials: { network: string; url: string }[];
  urls: { site: string; og: string; leadEndpoint: string; base: string };
  preview: boolean;
  generatedAt: string;
  warnings: string[];
  /** personalisation pilot: the design plan and what its renderers need (src/design/compose.ts) */
  design?: DesignModel;
  /** the website's booking page, story and videos (src/sources/site-content.ts) */
  source?: SourceBundle;
}

export interface ModelInputs {
  slug: string;
  themeId: string;
  theme: Theme;
  business: Business;
  facts: Facts;
  brand: BrandResult;
  brandText: string;
  services: { items: ServiceItem[]; matched: number; overflow: boolean; hidden: boolean };
  hero?: SiteImage;
  gallery: SiteImage[];
  fonts: SiteModel['fonts'];
  socials: { network: string; url: string }[];
  email?: string;
  baseUrl: string;
  preview: boolean;
}

/** Group consecutive days with identical hours: "Mon–Fri: 7:00 AM – 6:00 PM". */
export function compactHours(rows: { day: string; time: string }[]): { days: string; time: string }[] {
  const out: { from: string; to: string; time: string }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.time === r.time) last.to = r.day; else out.push({ from: r.day, to: r.day, time: r.time });
  }
  const short = (d: string) => d.slice(0, 3);
  if (out.length === 1 && rows.length === 7) return [{ days: 'Every day', time: out[0].time }];
  return out.map((g) => ({ days: g.from === g.to ? short(g.from) : `${short(g.from)}–${short(g.to)}`, time: g.time }));
}

/** Remove clauses that still contain unresolved tokens, e.g. " in {city}, {state}". */
function dropUnresolved(s: string): string {
  return s
    .replace(/\s*(?:in|serving|near|across)\s+\{\w+\}(?:,\s*\{\w+\})?/g, '')
    .replace(/\s*[|·,-]?\s*\{\w+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function buildModel(i: ModelInputs): SiteModel {
  const { theme: t, business: b, facts } = i;
  const warnings: string[] = [];
  const vals = {
    business: b.name,
    city: facts.city,
    state: facts.state,
    zip: facts.zip,
    rating: b.rating?.toFixed(1),
    reviewCount: b.reviewCount,
    years: facts.years,
    category: b.primaryTypeLabel || 'Local business', // Google's label, e.g. "Fitness center"; only themes that declare {category} use it
  };
  const fill = (tpl: string) => {
    const r = fillPlaceholders(tpl, vals, t.placeholders);
    return r.missing.length ? dropUnresolved(r.text) : r.text;
  };

  // ── copy (theme copy is the source of truth; only placeholders are filled) ──
  const hero = facts.city ? fill(t.copy.hero) : fill(t.copy.heroNoCity); // filled too: the general theme's is "{business}"
  const subline = fill(i.services.matched > 0 ? t.copy.subline : t.copy.sublineNoServices);
  let actionKind: 'call' | 'form' = t.copy.actionKind === 'call' ? 'call' : 'form';
  let action = t.copy.action;
  if (actionKind === 'call' && !b.phone) {
    actionKind = 'form';
    action = t.copy.quoteTitle;
    warnings.push('Theme leads with a call button but the business has no phone; switched to the quote form.');
  }

  // ── trust (only facts the business states) ──
  const trust: string[] = [];
  const tt = t.trust.templates;
  const pushT = (key: string, cond: boolean) => {
    if (!cond || !tt[key]) return;
    const r = fillPlaceholders(tt[key], vals, t.placeholders);
    if (!r.missing.length) trust.push(r.text);
  };
  pushT('licensed', facts.licensed);
  pushT('insured', facts.insured);
  pushT('years', !!facts.years);
  pushT('warranty', facts.warranty);
  trust.splice(t.trust.max);

  // ── proof ──
  const pr = (t.sectionRules.proof || {}) as { minRating?: number; minReviews?: number; showQuotes?: boolean; maxQuotes?: number; maxQuoteChars?: number };
  const showRating = (b.rating || 0) >= (pr.minRating ?? 4) && (b.reviewCount || 0) >= (pr.minReviews ?? 5);
  const quotes = showRating && pr.showQuotes !== false
    ? b.reviews
        .filter((r) => r.rating >= 4 && r.text.length >= 40)
        .sort((a, c) => c.rating - a.rating || Math.abs(a.text.length - 140) - Math.abs(c.text.length - 140))
        .slice(0, pr.maxQuotes ?? 2)
        .map((r) => ({ text: truncateWords(r.text, pr.maxQuoteChars ?? 160), author: r.author, rating: r.rating }))
    : [];
  // the slider shows all of them (Google returns up to 5); long ones are clamped with a Read more
  const reviews = showRating && pr.showQuotes !== false
    ? b.reviews
        .filter((r) => r.rating >= 4 && r.text.trim().length >= 40)
        .sort((a, c) => c.rating - a.rating || c.text.length - a.text.length)
        .slice(0, 8)
        .map((r) => ({ text: truncateWords(r.text.trim(), 700), author: r.author, rating: r.rating, when: r.relativeTime }))
    : [];
  const stats: SiteModel['proof']['stats'] = [];
  if (showRating) {
    stats.push({ value: `${b.rating!.toFixed(1)}★`, label: 'Google rating' });
    stats.push({ value: `${b.reviewCount}`, label: 'Google reviews' });
  }
  if (facts.years) stats.push({ value: `${facts.years}+`, label: 'Years in business' });
  if (facts.licensed && facts.insured) stats.push({ value: 'Licensed', label: 'and fully insured' });
  else if (facts.licensed) stats.push({ value: 'Licensed', label: facts.state ? `in ${facts.state}` : 'contractor' });
  else if (facts.insured) stats.push({ value: 'Insured', label: 'fully covered work' });
  if (facts.warranty && stats.length < 4) stats.push({ value: 'Warranty', label: 'on workmanship' });

  // ── areas ──
  const ar = (t.sectionRules.area || {}) as { maxPlaces?: number; showMap?: boolean };
  const areas = [...new Set([facts.city, ...facts.serviceAreas, ...b.nearbyTowns].filter(Boolean) as string[])].slice(0, ar.maxPlaces ?? 8);

  // ── hours ──
  const hr = (t.sectionRules.hours || {}) as { showOpenNow?: boolean };
  const rows = (b.hours?.weekdayText || []).map((line) => {
    const [day, ...rest] = line.split(': ');
    return { day, time: rest.join(': ').replace(/ | /g, ' ') };
  });

  // ── visibility rules ──
  const visible: Record<string, boolean> = {};
  const hidden: Record<string, string> = {};
  const hide = (s: string, why: string) => { visible[s] = false; hidden[s] = why; };
  for (const s of t.sections) visible[s] = true;
  const urgentWhen = ((t.sectionRules.urgent || {}) as { showWhen?: string[] }).showWhen;
  if (urgentWhen && !urgentWhen.some((c) => (c === 'open24h' && facts.open24h) || (c === 'emergencyKeyword' && facts.emergency))) {
    hide('urgent', 'Not open 24h and no emergency language found');
  }
  if (!b.phone && visible.urgent) hide('urgent', 'No phone number to call');
  const maintWhen = ((t.sectionRules.maintenance || {}) as { showWhen?: string[] }).showWhen;
  if (maintWhen && !maintWhen.some((c) => c === 'maintenanceKeyword' && facts.maintenance)) hide('maintenance', 'No maintenance/plan language found');
  if (i.services.hidden) hide('services', 'Fewer services than sectionRules.services.min');
  const minPhotos = ((t.sectionRules.gallery || {}) as { minPhotos?: number }).minPhotos ?? 3;
  if (i.gallery.length < minPhotos) hide('gallery', `Only ${i.gallery.length} usable photos (need ${minPhotos})`);
  if (!showRating && !trust.length && !stats.length) hide('proof', 'Rating/reviews below threshold and no stated trust facts');
  if (!areas.length && !b.formattedAddress) hide('area', 'No location or service area');

  const heroImg: SiteImage = i.hero || {
    publicPath: t.stock.hero[0]?.url || '',
    width: t.stock.hero[0]?.width || 1920,
    height: t.stock.hero[0]?.height || 1080,
    alt: t.stock.hero[0]?.alt || '',
    source: 'stock',
  };
  if (!i.hero) warnings.push('No usable Google photo for the hero; using the theme stock placeholder.');

  const e164 = b.phoneE164 || (b.phone ? `+1${digits(b.phone)}` : undefined);
  const site = `${i.baseUrl}/sites/${i.slug}/`;
  return {
    slug: i.slug,
    themeId: i.themeId,
    theme: t,
    business: b,
    facts,
    brand: i.brand,
    brandText: i.brandText,
    fonts: i.fonts,
    copy: {
      hero,
      subline,
      urgent: t.copy.urgent,
      action,
      actionKind,
      quoteTitle: t.copy.quoteTitle,
      maintenance: t.copy.maintenance,
      seoTitle: fill(t.seo.titlePattern),
      seoDescription: fill(t.seo.descriptionPattern),
      wordmark: t.logo.wordmark.case === 'title' ? titleCase(b.name) : b.name,
    },
    services: { items: i.services.items, overflow: i.services.overflow, overflowLabel: (t.sectionRules.services as any)?.overflowLink },
    trust,
    proof: { showRating, rating: b.rating, reviewCount: b.reviewCount, quotes, reviews, stats: stats.slice(0, 4) },
    areas,
    showMap: ar.showMap !== false && !!(b.formattedAddress || (b.lat && b.lng)),
    hours: { rows, compact: compactHours(rows), periods: b.hours?.periods || [], utcOffsetMinutes: b.utcOffsetMinutes, showOpenNow: hr.showOpenNow !== false },
    images: { hero: heroImg, heroIsStock: !i.hero, gallery: i.gallery },
    visible,
    hidden,
    contact: {
      phone: b.phone,
      tel: e164 ? `tel:${e164}` : undefined,
      sms: e164 ? `sms:${e164}?&body=${encodeURIComponent(t.roger.textPrefill || '')}` : undefined,
      email: i.email,
      address: b.formattedAddress?.replace(/, USA$/, ''),
      mapsUrl: b.mapsUrl,
      directionsUrl: b.formattedAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.formattedAddress)}${b.placeId && !b.placeId.startsWith('mock') ? `&destination_place_id=${b.placeId}` : ''}` : undefined,
    },
    socials: i.socials,
    urls: { site, og: `${site}og.jpg`, leadEndpoint: `${i.baseUrl}/api/leads/${i.slug}`, base: i.baseUrl },
    preview: i.preview,
    generatedAt: new Date().toISOString(),
    warnings,
  };
}
