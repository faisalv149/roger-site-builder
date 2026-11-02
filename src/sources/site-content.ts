import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { extractorResult, type ExtractorResult } from '../content/extraction.js';
import { digits } from '../util/text.js';

/**
 * What a business's own website says about it, read from the page itself: who it is, where, how to reach and book it,
 * what it offers, its story, and the photographs and videos it shows. Nothing here is made up: every value comes from
 * the page (or is absent), and each extractor reports what it found so a thin result is visible, not silent.
 *
 * Generic by design: it looks for structure (a "Services" label followed by headed blocks, "Book" links, JSON-LD,
 * copyright lines, address patterns), not for any one business or site builder.
 */

type $ = cheerio.CheerioAPI;

export interface ParsedAddress { street: string; unit?: string; city: string; state: string; zip: string; formatted: string }
export interface BookingDest {
  url: string;
  kind: 'online' | 'phone' | 'email' | 'page';
  label: string;
  platform?: string;
  scope: 'primary' | 'service';
  /** the service this destination belongs to, when the page ties them together */
  service?: string;
  basis?: string;
}
export interface SourceService {
  name: string;
  description?: string;
  pageUrl?: string;
  booking?: BookingDest;
  /** the picture on this service's own card on the page: the relationship is kept with the service */
  image?: { url: string; seen: string; alt?: string; key: string };
  position: number;
  method: 'headings' | 'list' | 'json-ld';
}
export interface SourceImage {
  /** the address to download (the original, not a thumbnail) */
  url: string;
  /** the address the page used */
  seen: string;
  alt?: string;
  /** alt="" is a deliberate "decorative" mark: it is respected, never reported as missing */
  altKind: 'descriptive' | 'filename' | 'empty' | 'missing';
  width?: number;
  height?: number;
  role: 'logo' | 'hero' | 'content' | 'team' | 'poster' | 'icon' | 'social' | 'service';
  origin: 'img' | 'srcset' | 'lazy' | 'css' | 'json-ld' | 'og' | 'video-poster';
  /** the same picture at another size or crop shares a key */
  key: string;
}
export interface SourceVideo {
  kind: 'file' | 'hls' | 'youtube' | 'vimeo' | 'embed';
  /** where the video plays from (can be a signed, expiring link) */
  url: string;
  title?: string;
  poster?: string;
  duration?: string;
  uploadDate?: string;
  /** the page it was found on */
  pageUrl: string;
  /** what visitors can rely on: a link that may expire, an embed that works */
  note?: string;
}
export interface SourceIdentity {
  /** names found, with where each appeared; truncated copies are folded into the full one */
  names: { name: string; sources: string[]; weight: number }[];
  name?: string;
  domain: string;
  /** the kind of business the page says it is ("Chiropractor"), when it says so */
  typeHint?: { label: string; googleType: string; category?: string };
  description?: string;
}
export interface SiteContent {
  identity: SourceIdentity;
  address?: ParsedAddress;
  phones: { primary?: string; others: { number: string; context: string; service?: string }[] };
  emails: string[];
  booking: { primary?: BookingDest; others: BookingDest[] };
  services: SourceService[];
  story?: { heading: string; text: string; method: 'section' | 'meta' };
  images: SourceImage[];
  videos: SourceVideo[];
  hours?: { lines: string[]; method: 'json-ld' | 'text' };
  socials: { network: string; url: string }[];
  report: ExtractorResult[];
}

// ───────────────────────── helpers ─────────────────────────
const clean = (s: string | undefined) => (s || '').replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
const TWO_PART_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;
export function registrableHost(input: string): string {
  let host = input;
  try { host = new URL(/^https?:/i.test(input) ? input : `https://${input}`).hostname; } catch { /* keep input */ }
  host = host.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  return parts.length <= 2 ? host : TWO_PART_TLD.test(host) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}
/** "Lakeside Chiropractic, LLC" and "LAKESIDE CHIROPRACTIC" compare equal. */
export const nameKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\b(llc|l\.l\.c|inc|incorporated|co|corp|company|pllc|pc|ltd|the)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const PLACEHOLDER_EMAIL = /@(mysite|example|yourdomain|domain|email|test|sentry|wixpress|sentry-next)\.|^(email|name|your)@|noreply|no-reply|\.(png|jpe?g|gif|webp|svg)$/i;
export const isPlaceholderEmail = (e: string) => PLACEHOLDER_EMAIL.test(e);

/** NANP number that could be real: area code and exchange don't start with 0/1, and 555-01xx is reserved for fiction. */
export function plausiblePhone(raw: string | undefined): string | undefined {
  const d = digits(raw).replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10 || /^[01]/.test(d) || /^.{3}[01]/.test(d)) return undefined;
  if (d.slice(3, 6) === '555' && /^01\d\d$/.test(d.slice(6))) return undefined;
  if (/^(\d)\1{9}$/.test(d)) return undefined;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
export const phoneKey = (s: string | undefined) => digits(s).replace(/^1(?=\d{10}$)/, '').slice(-10);

const BUSINESS_TYPES: [RegExp, string, string, string?][] = [
  [/\bchiropract(?:or|ic|ors)\b/i, 'Chiropractor', 'chiropractor', 'health'],
  [/\bdent(?:ist|al|istry)\b/i, 'Dentist', 'dentist', 'health'],
  [/\borthodont/i, 'Orthodontist', 'dentist', 'health'],
  [/\bphysical therap/i, 'Physical therapist', 'physiotherapist', 'health'],
  [/\b(?:optometr|eye care|vision center)/i, 'Optometrist', 'doctor', 'health'],
  [/\b(?:veterinar|animal hospital|vet clinic)/i, 'Veterinarian', 'veterinary_care', 'health'],
  [/\b(?:medical clinic|family medicine|primary care|urgent care|physician|doctor)\b/i, 'Medical clinic', 'doctor', 'health'],
  [/\b(?:acupunctur|naturopath|wellness clinic)/i, 'Wellness center', 'wellness_center', 'health'],
  [/\bmassage\b/i, 'Massage therapist', 'massage', 'salon'],
  [/\b(?:hair salon|barber|beauty salon|hairstylist)/i, 'Hair salon', 'hair_salon', 'salon'],
  [/\b(?:nail salon|day spa|med ?spa)\b/i, 'Spa', 'spa', 'salon'],
  [/\b(?:plumb(?:er|ing)|drain cleaning)\b/i, 'Plumber', 'plumber', 'trades'],
  [/\belectric(?:ian|al contractor)\b/i, 'Electrician', 'electrician', 'trades'],
  [/\b(?:hvac|heating and (?:cooling|air)|air conditioning)\b/i, 'HVAC contractor', 'hvac_contractor', 'trades'],
  [/\broof(?:er|ing)\b/i, 'Roofing contractor', 'roofing_contractor', 'trades'],
  [/\b(?:landscap|lawn care|tree service)/i, 'Landscaper', 'landscaper', 'trades'],
  [/\b(?:attorney|law (?:firm|office)|lawyer)\b/i, 'Lawyer', 'lawyer', 'professional'],
  [/\b(?:accountant|accounting|cpa|tax prep)/i, 'Accountant', 'accounting', 'professional'],
  [/\b(?:real estate|realtor)\b/i, 'Real estate agency', 'real_estate_agency', 'professional'],
  [/\b(?:restaurant|bistro|trattoria|eatery|grill)\b/i, 'Restaurant', 'restaurant', 'food'],
  [/\b(?:coffee|café|cafe|bakery)\b/i, 'Cafe', 'cafe', 'food'],
  [/\b(?:gym|fitness|crossfit|yoga|pilates)\b/i, 'Gym', 'gym', 'fitness'],
  [/\b(?:auto repair|mechanic|body shop)\b/i, 'Auto repair shop', 'car_repair', 'trades'],
];
export function inferBusinessType(text: string): SourceIdentity['typeHint'] {
  for (const [re, label, googleType, category] of BUSINESS_TYPES) if (re.test(text)) return { label, googleType, category };
  return undefined;
}

/**
 * Page builders cut long site names in titles and meta tags ("Lakeside Chiropracti"), and that cut copy ends up in
 * descriptions. When the full name is known, the cut form is put back to it.
 */
export function restoreName(text: string, name: string | undefined): string {
  if (!text || !name || name.length < 10) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = text;
  for (let k = 1; k <= 3; k++) {
    const cut = name.slice(0, -k);
    out = out.replace(new RegExp(`${esc(cut)}(?![A-Za-z])`, 'g'), name);
  }
  return out;
}

// ───────────────────────── address ─────────────────────────
const ADDRESS_RE = /(\d{1,6}\s+[A-Za-z0-9.'’# -]{2,45}?)(?:\s*,?\s*((?:Unit|Suite|Ste\.?|Apt\.?|Bldg\.?|#)\s*#?\s*[A-Za-z0-9-]+))?\s*,?\s+([A-Z][A-Za-z.'’ -]{1,30}?)\s*,?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?/g;
const STREET_WORD = /\b(st|street|rd|road|blvd|boulevard|ave|avenue|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|fm|rr|cr|loop|trail|trl|pl|place|cir|circle|sq|square|route|rte|us|sh|state|farm|ranch)\b/i;
export function parseAddresses(text: string): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  for (const m of text.matchAll(ADDRESS_RE)) {
    const street = clean(m[1]).replace(/[,\s]+$/, '');
    if (!STREET_WORD.test(street)) continue;
    const city = clean(m[3]);
    if (/\b(unit|suite|ste)\b/i.test(city)) continue;
    const unit = m[2] ? clean(m[2]).replace(/^#\s*/, 'Unit #').replace(/^(unit|suite|ste\.?|apt\.?|bldg\.?)\s*#?\s*/i, (x) => (/unit/i.test(x) ? 'Unit ' : /suite|ste/i.test(x) ? 'Suite ' : 'Apt ')).replace(/^(Unit|Suite|Apt) (?!#)/, '$1 #') : undefined;
    out.push({ street, unit, city, state: m[4], zip: m[5], formatted: `${street}${unit ? `, ${unit}` : ''}, ${city}, ${m[4]} ${m[5]}` });
  }
  return out;
}
const sameAddress = (a: ParsedAddress, b: ParsedAddress) => a.zip === b.zip && nameKey(a.street) === nameKey(b.street);

// ───────────────────────── JSON-LD ─────────────────────────
function ldNodes($: $): any[] {
  const out: any[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    out.push(n);
    for (const k of ['@graph', 'itemListElement', 'item', 'hasOfferCatalog', 'makesOffer', 'department', 'subOrganization']) if (n[k]) visit(n[k]);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { visit(JSON.parse($(el).contents().text())); } catch { /* malformed JSON-LD is common; skip it */ }
  });
  return out;
}
const ldTypes = (n: any): string[] => [].concat(n['@type'] || []).map(String);

// ───────────────────────── identity ─────────────────────────
const GENERIC_NAME = /^(home|homepage|welcome|untitled|index|just another|my (blog|site|website)|coming soon|under construction|wix|site)\b/i;
function pushName(map: Map<string, { name: string; sources: Set<string>; weight: number }>, raw: string | undefined, source: string, weight: number) {
  const name = clean(raw).replace(/^["'“”]+|["'“”.|:,]+$/g, '').trim();
  if (!name || name.length < 3 || name.length > 60 || GENERIC_NAME.test(name) || /^https?:/i.test(name) || /^\d+$/.test(name)) return;
  const key = nameKey(name);
  if (!key) return;
  const hit = map.get(key) || { name, sources: new Set<string>(), weight: 0 };
  hit.sources.add(source);
  hit.weight += weight;
  if (name.length > hit.name.length) hit.name = name;
  // a name shown in title case beats the same name shouted in capitals
  if (hit.name === hit.name.toUpperCase() && name !== name.toUpperCase()) hit.name = name;
  map.set(key, hit);
}
function titleSegments($: $): string[] {
  return clean($('title').first().text()).split(/\s+[|–—]\s+|\s+-\s+|\s*·\s*|\s*\|\s*/).map(clean).filter(Boolean);
}
function identityOf($: $, baseUrl: string, text: string): SourceIdentity {
  const names = new Map<string, { name: string; sources: Set<string>; weight: number }>();
  const segs = titleSegments($);
  if (segs[0]) pushName(names, segs[0], 'title', 1.5);
  pushName(names, $('meta[property="og:site_name"]').attr('content'), 'og:site_name', 1);
  pushName(names, titleSegments(cheerio.load(`<title>${$('meta[property="og:title"]').attr('content') || ''}</title>`))[0], 'og:title', 1);
  for (const n of ldNodes($)) {
    const t = ldTypes(n);
    if (t.some((x) => /Business|Organization|Clinic|Physician|Dentist|Store|Restaurant|Salon|Service|Practice|WebSite|Contractor|Plumber|Electrician|Lawyer|Attorney|Accountant|Hospital|Pharmacy|Spa|Gym|Cafe/i.test(x)) && typeof n.name === 'string') pushName(names, n.name, `json-ld ${t[0]}`, t.includes('WebSite') ? 0.75 : 1.25);
  }
  const copyright = text.match(/(?:©|&copy;|copyright)\s*(?:19|20)\d\d(?:\s*[-–]\s*(?:19|20)\d\d)?\s*(?:by\s+)?([A-Z0-9][A-Za-z0-9&'’,\- ]{2,58}?)(?:\.(?=\s|$)|\s*\||\s+all rights|\s{2,}|$)/i);
  if (copyright) pushName(names, copyright[1], 'copyright', 1.5);
  const home = $('header a, nav a, .header a').filter((_, a) => { const h = $(a).attr('href') || ''; try { return new URL(h, baseUrl).pathname.replace(/\/$/, '') === '' ; } catch { return false; } }).first();
  pushName(names, clean(home.text()) || home.find('img').attr('alt'), 'header link', 1);
  $('img').each((_, im) => { if (/logo|brand/i.test([$(im).attr('class'), $(im).attr('id'), $(im).attr('src')].join(' '))) pushName(names, $(im).attr('alt'), 'logo alt', 0.5); });
  // truncated copies ("Lakeside Chiropracti") fold into the full name
  const list = [...names.entries()];
  for (const [k, v] of list) {
    const longer = list.find(([k2]) => k2 !== k && k2.startsWith(k) && k2.length - k.length <= 8);
    if (longer) { longer[1].weight += v.weight; v.sources.forEach((s) => longer[1].sources.add(s)); names.delete(k); }
  }
  const domainKey = nameKey(registrableHost(baseUrl).split('.')[0]);
  const ranked = [...names.values()].map((v) => ({ name: v.name, sources: [...v.sources], weight: v.weight + (domainKey.includes(nameKey(v.name)) && nameKey(v.name).length >= 5 ? 1 : 0) })).sort((a, b) => b.weight - a.weight || b.name.length - a.name.length);
  const description = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content')) || undefined;
  const typeHint = inferBusinessType(`${segs.slice(1).join(' ')} ${description || ''}`) || inferBusinessType(segs[0] || '');
  return { names: ranked, name: ranked[0]?.name, domain: registrableHost(baseUrl), typeHint, description };
}

// ───────────────────────── contact ─────────────────────────
const BOOK_TEXT = /\b(book(?:ing)?|schedule|appointment|reserve|reservation|request (?:a |an )?(?:visit|time|appointment)|new patient)\b/i;
const BOOKING_HOSTS: [RegExp, string][] = [
  [/chirotouch/i, 'ChiroTouch'], [/acuityscheduling|as\.me$/i, 'Acuity'], [/calendly/i, 'Calendly'], [/squareup\.com|square\.site/i, 'Square'], [/setmore/i, 'Setmore'], [/simplybook/i, 'SimplyBook.me'],
  [/booksy/i, 'Booksy'], [/vagaro/i, 'Vagaro'], [/mindbodyonline|mindbody/i, 'Mindbody'], [/janeapp/i, 'Jane'], [/fresha/i, 'Fresha'], [/schedulicity/i, 'Schedulicity'], [/zocdoc/i, 'Zocdoc'],
  [/opentable/i, 'OpenTable'], [/resy\.com/i, 'Resy'], [/exploretock|tock\.com/i, 'Tock'], [/housecallpro/i, 'Housecall Pro'], [/jobber/i, 'Jobber'], [/glossgenius/i, 'GlossGenius'], [/joinblvd|boulevard/i, 'Boulevard'],
  [/simplepractice/i, 'SimplePractice'], [/healthie|solutionreach|patientpop|nextech|clinicsense/i, 'online scheduling'],
];
const platformOf = (url: string) => BOOKING_HOSTS.find(([re]) => re.test(url))?.[1];
function normaliseLink(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol === 'tel:' || u.protocol === 'mailto:' || u.protocol === 'sms:') return u.toString();
    if (!/^https?:$/.test(u.protocol)) return undefined;
    if (u.hash === '#' || u.hash === '#/') u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid|^gclid/.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '');
  } catch { return undefined; }
}
const sameLink = (a: string, b: string) => a.replace(/#.*$/, '').replace(/\/$/, '') === b.replace(/#.*$/, '').replace(/\/$/, '');

interface Anchor { href: string; text: string; el: Element; where: 'header' | 'footer' | 'body' }
function anchors($: $, base: string): Anchor[] {
  const out: Anchor[] = [];
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw || raw === '#' || /^javascript:/i.test(raw)) return;
    const href = normaliseLink(raw, base);
    if (!href) return;
    const where = $(el).closest('header, nav, [role=navigation], [id*=header i]').length ? 'header' : $(el).closest('footer, [id*=footer i]').length ? 'footer' : 'body';
    out.push({ href, text: clean($(el).text() || $(el).attr('aria-label') || $(el).attr('title')), el: el as Element, where });
  });
  return out;
}

// ───────────────────────── services ─────────────────────────
const SERVICE_LABEL = /^(?:our |the |my )?(?:services?|treatments?|what we (?:do|offer)|offerings|specialt(?:y|ies)|programs?|practice areas|therapies|solutions|menu)(?: (?:we offer|list|menu|overview|information))?:?$/i;
const STOP_LABEL = /^(?:our )?(?:story|about(?: us)?|who we are|contact(?: us)?|get in touch|testimon\w*|patient testimon\w*|reviews?|gallery|our work|team|meet\b.*|faq\w*|hours|location|visit us|news|blog|newsletter|book(?: now| online| an appointment)?|schedule\b.*|follow us)$/i;
const NOT_A_SERVICE = /^(?:book|schedule|call|contact|learn more|read more|view|get started|get in touch|submit|subscribe|home|menu|close|search|play|share|more)\b/i;
const INSIDE_CHROME = 'nav, header, footer, [role=navigation], a, button, label';

/**
 * The line under a service's name. Often a sibling paragraph, but page builders wrap the heading in links and
 * containers, so look in the nearest enclosing block that holds only this service's heading.
 */
function headingDescription($: $, h: Element, all: Element[]): string | undefined {
  const name = clean($(h).text()).toLowerCase();
  const usable = (t: string) => t.length >= 3 && t.length <= 240 && t.toLowerCase() !== name && !NOT_A_SERVICE.test(t);
  const sib = $(h).nextAll('p, div, span').filter((_, e) => !$(e).is('a, button') && !$(e).find('h1,h2,h3,h4,h5,h6').length).first();
  const own = clean(sib.text());
  if (usable(own)) return own;
  let anc = $(h).parent();
  for (let up = 0; up < 4 && anc.length; up++, anc = anc.parent()) {
    if (all.some((o) => o !== h && $.contains(anc.get(0) as Element, o))) break; // reached a block holding another service
    const hit = anc.find('p, span, div').filter((_, e) => {
      if ($(e).closest('a, button, h1, h2, h3, h4, h5, h6').length) return false;
      const t = clean($(e).clone().children().remove().end().text());
      return usable(t);
    }).first();
    const t = clean(hit.clone().children().remove().end().text());
    if (hit.length && usable(t)) return t;
  }
  return undefined;
}

/**
 * The picture on a service's own card: the nearest enclosing block that holds this service's heading and none of the
 * others, and a picture. Page builders nest cards deeply, so this climbs until the block would hold two services.
 */
function cardImage($: $, h: Element, all: Element[], base: string): SourceService['image'] {
  let box = $(h);
  for (let up = 0; up < 12 && box.length; up++) {
    box = box.parent();
    const node = box.get(0) as Element | undefined;
    if (!node) break;
    if (all.some((o) => o !== h && $.contains(node, o))) return undefined; // the block now holds another service: no picture of its own
    const img = box.find('img').filter((_, im) => !/logo|icon|sprite/i.test($(im).attr('src') || '') && !$(im).closest('a[href^="mailto:"], a[href^="tel:"]').length).first();
    const bgEl = box.find('[style*="background-image"], [data-bg]').first();
    const src = img.attr('data-src') || img.attr('data-lazy-src') || largestFromSrcset(img.attr('srcset') || img.attr('data-srcset')) || img.attr('src') || (bgEl.attr('style') || '').match(/url\((['"]?)([^)'"]+)\1\)/)?.[2] || bgEl.attr('data-bg');
    if (src && !/^data:/.test(src)) {
      try {
        const seen = new URL(src, base).toString();
        return { url: originalImageUrl(seen), seen, alt: img.length ? img.attr('alt') : undefined, key: imageKey(seen) };
      } catch { return undefined; }
    }
  }
  return undefined;
}

function servicesOf($: $, base: string, links: Anchor[]): { items: SourceService[]; container?: Element; method?: SourceService['method'] } {
  // 1) a "Services" label followed by headed blocks
  const labels = $('h1,h2,h3,h4,h5,h6,p,span,div,strong,b').filter((_, e) => {
    const t = clean($(e).text());
    return t.length <= 40 && SERVICE_LABEL.test(t) && !$(e).closest(INSIDE_CHROME).length && !$(e).children().filter((__, c) => SERVICE_LABEL.test(clean($(c).text()))).length;
  }).toArray() as Element[];
  for (const label of labels) {
    const labelTag = label.tagName.toLowerCase();
    const labelLevel = /^h[1-6]$/.test(labelTag) ? Number(labelTag[1]) : 1;
    let box: cheerio.Cheerio<AnyNode> = $(label);
    for (let up = 0; up < 8; up++) {
      box = box.parent();
      const heads = box.find('h2,h3,h4,h5,h6').filter((_, h) => Number((h as Element).tagName[1]) > labelLevel && !$(h).closest('nav, footer, header').length).toArray() as Element[];
      if (heads.length < 2) continue;
      // keep headings after the label, up to the next section's label, all at the first heading's level
      const after: Element[] = [];
      const all = box.find('*').toArray();
      const start = all.indexOf(label);
      const level = (heads.find((h) => all.indexOf(h) > start) as Element | undefined)?.tagName;
      for (const h of heads) {
        if (all.indexOf(h) <= start || h.tagName !== level) continue;
        const text = clean($(h).text());
        if (STOP_LABEL.test(text)) break;
        after.push(h);
      }
      const seen = new Set<string>();
      const items: SourceService[] = [];
      for (const h of after) {
        const name = clean($(h).text());
        if (name.length < 2 || name.length > 70 || NOT_A_SERVICE.test(name) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const link = $(h).closest('a').attr('href') || $(h).find('a').attr('href') || links.find((a) => clean(a.text).toLowerCase() === name.toLowerCase() && a.href !== base && !/^(tel|mailto|sms):/.test(a.href) && !/#$/.test(a.href))?.href;
        const pageUrl = link && /^https?:/.test(link) && new URL(link, base).origin === new URL(base).origin && new URL(link, base).pathname !== new URL(base).pathname ? normaliseLink(link, base) : undefined;
        items.push({ name, description: headingDescription($, h, after), pageUrl, image: cardImage($, h, after, base), position: items.length, method: 'headings' });
      }
      if (items.length >= 2) return { items, container: box.get(0) as Element, method: 'headings' };
      break;
    }
  }
  // 2) schema.org Service / Offer items
  const ld: SourceService[] = [];
  for (const n of ldNodes($)) {
    if (ldTypes(n).some((t) => /^(Service|Product|MedicalProcedure|MedicalTherapy)$/.test(t)) && typeof n.name === 'string') ld.push({ name: clean(n.name), description: clean(n.description) || undefined, position: ld.length, method: 'json-ld' });
  }
  if (ld.length >= 2) return { items: ld.slice(0, 24), method: 'json-ld' };
  // 3) a list after a "Services" label
  for (const label of labels) {
    let box: cheerio.Cheerio<AnyNode> = $(label);
    for (let up = 0; up < 6; up++) {
      box = box.parent();
      const lis = box.find('li').filter((_, li) => !$(li).closest('nav, footer, header').length).toArray();
      if (lis.length >= 2 && lis.length <= 24) {
        const items = [...new Set(lis.map((li) => clean($(li).children('a, strong, b').first().text() || $(li).text()).slice(0, 70)).filter((t) => t.length >= 3 && !NOT_A_SERVICE.test(t)))].map((name, position) => ({ name, position, method: 'list' as const }));
        if (items.length >= 2) return { items, container: box.get(0) as Element, method: 'list' };
      }
    }
  }
  return { items: [] };
}

// ───────────────────────── story ─────────────────────────
const STORY_LABEL = /^(?:our |the )?(?:story|about(?: us)?(?: [\w&' -]{2,30})?|who we are|our mission|our practice|meet (?:the )?[\w&' .-]{2,40}|welcome)$/i;
function storyOf($: $, description?: string): SiteContent['story'] {
  const labels = $('h1,h2,h3,h4,h5,h6,p,span,div,strong').filter((_, e) => { const t = clean($(e).text()); return t.length <= 40 && STORY_LABEL.test(t) && !$(e).closest(INSIDE_CHROME).length && !/^welcome$/i.test(t); }).toArray() as Element[];
  for (const label of labels) {
    let box: cheerio.Cheerio<AnyNode> = $(label);
    for (let up = 0; up < 6; up++) {
      box = box.parent();
      const blocks = box.find('p, span, div').filter((_, e) => {
        const own = clean($(e).clone().children().remove().end().text());
        return own.length >= 80 && own.length <= 1600 && !$(e).closest('nav, footer, header, form, button, a').length;
      }).toArray();
      if (!blocks.length) continue;
      const best = blocks.map((b) => clean($(b).clone().children().remove().end().text())).sort((a, c) => c.length - a.length)[0];
      return { heading: clean($(label).text()), text: best, method: 'section' };
    }
  }
  if (description && description.length >= 80) return { heading: 'About', text: description, method: 'meta' };
  return undefined;
}

// ───────────────────────── images ─────────────────────────
const SOCIAL_NAME = /^(instagram|facebook|twitter|x|tiktok|youtube|linkedin|yelp|pinterest|google|email|phone)\b/i;
export function originalImageUrl(u: string): string {
  try {
    const url = new URL(u);
    if (/static\.wixstatic\.com$/.test(url.hostname)) {
      const m = url.pathname.match(/^(\/media\/[^/]+)(?:\/v1\/.*)?$/);
      if (m) return `${url.origin}${m[1]}`;
    }
    url.pathname = url.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp|gif)$)/i, '').replace(/_\d{2,4}x(?:\d{2,4})?(?=\.(?:jpe?g|png|webp)$)/i, '');
    for (const k of ['w', 'h', 'width', 'height', 'resize', 'fit', 'quality', 'q', 'crop', 'format', 'auto', 'dpr']) url.searchParams.delete(k);
    return url.toString();
  } catch { return u; }
}
export const imageKey = (u: string) => { try { const x = new URL(originalImageUrl(u)); return `${x.hostname}${x.pathname}`.toLowerCase(); } catch { return u; } };
/** The largest address in a srcset. Image CDNs put commas inside addresses (w_735,h_226), so split on the descriptors. */
export function largestFromSrcset(srcset: string | undefined): string | undefined {
  const tokens = (srcset || '').trim().split(/\s+(\d+(?:\.\d+)?[wx])\s*,?\s*/);
  const entries: { url: string; weight: number }[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const url = (tokens[i] || '').replace(/^,\s*/, '').trim();
    if (url) entries.push({ url, weight: parseFloat(tokens[i + 1] || '0') || 0 });
  }
  entries.sort((a, b) => b.weight - a.weight);
  return entries[0]?.url;
}
const sizeHint = (u: string) => { const m = u.match(/[,/_]w_(\d+)[,_]h_(\d+)/) || u.match(/[?&]w=(\d+).*?[?&]h=(\d+)/); return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined; };

function imagesOf($: $, base: string, posters: Set<string>, ldImages: string[]): SourceImage[] {
  const found = new Map<string, SourceImage>();
  const add = (seen: string | undefined, origin: SourceImage['origin'], extra: Partial<SourceImage> & { el?: Element; alt?: string | undefined } = {}) => {
    if (!seen || /^data:/.test(seen)) return;
    let abs: string;
    try { abs = new URL(seen, base).toString(); } catch { return; }
    if (/\.(svg|ico|gif)(\?|$)/i.test(abs) && !/\.svg/.test(abs)) return;
    const url = originalImageUrl(abs);
    const key = imageKey(abs);
    const rawAlt = extra.alt;
    const altKind: SourceImage['altKind'] = rawAlt === undefined ? 'missing' : !clean(rawAlt) ? 'empty' : /\.(jpe?g|png|webp|gif)$|^(dsc|img|image|photo|screenshot|pxl)[-_ ]?\d|^[\w-]+\s?\(\d+\)$/i.test(clean(rawAlt)) ? 'filename' : 'descriptive';
    const el = extra.el;
    const declaredW = el ? Number($(el).attr('width')) || undefined : undefined;
    const declaredH = el ? Number($(el).attr('height')) || undefined : undefined;
    const hint = sizeHint(abs);
    const inHeader = el ? $(el).closest('header, nav, [role=navigation], [id*=header i]').length > 0 : false;
    const inFooter = el ? $(el).closest('footer, [id*=footer i]').length > 0 : false;
    const classes = el ? [$(el).attr('class'), $(el).attr('id'), $(el).parent().attr('class'), $(el).attr('src')].join(' ') : '';
    const width = declaredW ?? hint?.width;
    const height = declaredH ?? hint?.height;
    let role: SourceImage['role'] = 'content';
    if (posters.has(key) || /testimonial|video thumbnail|poster/i.test(rawAlt || '')) role = 'poster';
    else if (SOCIAL_NAME.test(clean(rawAlt)) || (inFooter && Math.max(width || 0, height || 0) <= 140 && Math.max(width || 0, height || 0) > 0)) role = 'social';
    else if (/logo|brand/i.test(`${classes} ${rawAlt || ''}`) || (inHeader && (!width || width <= 900))
      // page builders draw the header from plain divs: a wide, short picture among the first few images is the logo
      || (el && origin !== 'css' && $('img').index(el) < 3 && !!width && !!height && width / height >= 2 && width <= 900)) role = 'logo';
    else if (/\b(team|staff|doctor|dr\.|our (people|family))\b/i.test(`${rawAlt || ''} ${classes}`)) role = 'team';
    const img: SourceImage = { url, seen: abs, alt: rawAlt === undefined ? undefined : clean(rawAlt), altKind, width, height, role, origin, key };
    const prior = found.get(key);
    // the same picture shown several ways is one image: keep the version with the most to say
    if (!prior || (prior.altKind !== 'descriptive' && altKind === 'descriptive') || (prior.role === 'content' && role === 'logo' && origin === 'img')) found.set(key, prior ? { ...img, width: Math.max(prior.width || 0, width || 0) || undefined, height: Math.max(prior.height || 0, height || 0) || undefined } : img);
  };
  $('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('data-image') || $(el).attr('src');
    const set = largestFromSrcset($(el).attr('srcset') || $(el).attr('data-srcset'));
    const lazy = !!($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('loading') === 'lazy');
    add(set || src, set ? 'srcset' : lazy ? 'lazy' : 'img', { el: el as Element, alt: $(el).attr('alt') });
  });
  $('picture source').each((_, el) => add(largestFromSrcset($(el).attr('srcset') || $(el).attr('data-srcset')), 'srcset', { el: el as Element, alt: $(el).closest('picture').find('img').attr('alt') }));
  $('noscript').each((_, el) => { const inner = cheerio.load($(el).text()); inner('img').each((__, im) => add(inner(im).attr('src'), 'lazy', { alt: inner(im).attr('alt') })); });
  $('[style*="background"], [data-bg], [data-background], [data-background-image]').each((_, el) => {
    const u = ($(el).attr('style') || '').match(/url\((['"]?)([^)'"]+)\1\)/)?.[2] || $(el).attr('data-bg') || $(el).attr('data-background') || $(el).attr('data-background-image');
    if (u && /\.(jpe?g|png|webp)/i.test(u)) add(u, 'css', { el: el as Element });
  });
  const og = $('meta[property="og:image"]').attr('content');
  if (og) add(og, 'og', { alt: $('meta[property="og:image:alt"]').attr('content') });
  for (const u of ldImages) add(u, 'json-ld');
  for (const [k] of [...found]) if (posters.has(k) && found.get(k)!.role !== 'poster') found.get(k)!.role = 'poster';
  return [...found.values()];
}

/** ISO 8601 duration (PT1M7S) as 1:07. */
export function formatDuration(iso: string | undefined): string | undefined {
  const m = (iso || '').match(/^PT(?:(d+)H)?(?:(d+)M)?(?:(d+(?:.d+)?)S)?$/);
  if (!m) return undefined;
  const h = Number(m[1] || 0), min = Number(m[2] || 0), sec = Math.round(Number(m[3] || 0));
  return h ? `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${min}:${String(sec).padStart(2, '0')}`;
}

// ───────────────────────── videos ─────────────────────────
function videosOf($: $, base: string): SourceVideo[] {
  const out: SourceVideo[] = [];
  const add = (v: Omit<SourceVideo, 'pageUrl'>) => { const key = v.url.replace(/[?#].*$/, ''); if (!out.some((o) => o.url.replace(/[?#].*$/, '') === key)) out.push({ ...v, pageUrl: base }); };
  const kindOf = (u: string): SourceVideo['kind'] => (/\.m3u8/i.test(u) ? 'hls' : /youtube\.com|youtu\.be|youtube-nocookie/i.test(u) ? 'youtube' : /vimeo\.com/i.test(u) ? 'vimeo' : /\.(mp4|webm|mov)(\?|$)/i.test(u) ? 'file' : 'embed');
  for (const n of ldNodes($)) {
    if (!ldTypes(n).includes('VideoObject')) continue;
    const url = n.contentUrl || n.embedUrl;
    if (typeof url !== 'string') continue;
    const thumb = [].concat(n.thumbnailUrl || [])[0] as string | undefined;
    const k = kindOf(url);
    add({ kind: k, url, title: clean(n.name) || undefined, poster: thumb, duration: typeof n.duration === 'string' ? n.duration : undefined, uploadDate: typeof n.uploadDate === 'string' ? n.uploadDate : undefined, note: k === 'hls' ? 'stream link that may expire' : undefined });
  }
  $('video').each((_, el) => {
    const src = $(el).attr('src') || $(el).find('source').first().attr('src');
    if (src) add({ kind: kindOf(src), url: new URL(src, base).toString(), poster: $(el).attr('poster'), title: clean($(el).attr('title') || $(el).attr('aria-label')) || undefined });
  });
  $('iframe[src], iframe[data-src]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (/youtube|youtu\.be|vimeo|wistia|loom/i.test(src)) add({ kind: kindOf(src), url: src.startsWith('//') ? `https:${src}` : src, title: clean($(el).attr('title')) || undefined });
  });
  $('a[href]').each((_, el) => { const h = $(el).attr('href') || ''; if (/(?:youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d)/i.test(h)) add({ kind: kindOf(h), url: h, title: clean($(el).text()) || undefined }); });
  return out;
}

// ───────────────────────── hours ─────────────────────────
function hoursOf($: $, text: string): SiteContent['hours'] {
  for (const n of ldNodes($)) {
    const spec = [].concat(n.openingHoursSpecification || []) as any[];
    if (spec.length) return { lines: spec.map((s) => `${[].concat(s.dayOfWeek || []).map((d: string) => String(d).replace(/^.*\//, '')).join(', ')}: ${s.opens}-${s.closes}`), method: 'json-ld' };
    const oh = [].concat(n.openingHours || []) as string[];
    if (oh.length) return { lines: oh.map(String), method: 'json-ld' };
  }
  const lines = [...text.matchAll(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?(?:\s*(?:[-–to&,]+)\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?)*\s*:?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:[-–]|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi)].map((m) => clean(m[0]));
  return lines.length ? { lines: [...new Set(lines)].slice(0, 8), method: 'text' } : undefined;
}

// ───────────────────────── entry ─────────────────────────
export function extractSiteContent(html: string, baseUrl: string, opts: { socials?: { network: string; url: string }[]; rendered?: boolean } = {}): SiteContent {
  const $page = cheerio.load(html);
  const report: ExtractorResult[] = [];
  const links = anchors($page, baseUrl);
  const ld = ldNodes($page);

  // text with scripts and styles out, and a space where a block ends so neighbouring items don't run together
  const $t = cheerio.load(html.replace(/<\/?(?:br|p|div|li|td|th|h[1-6]|tr|section|header|footer|a|span|strong|b|button|label)\b[^>]*>/gi, ' $& '));
  $t('script, style, noscript, svg, iframe').remove();
  const text = clean($t('body').text());
  const footerText = clean($t('footer, [id*=footer i]').text());

  // identity
  const identity = identityOf($page, baseUrl, `${footerText} ${text.slice(-400)}`);
  report.push(identity.name
    ? extractorResult('identity', identity.names[0].sources.length >= 2 ? 'success' : 'partial', `name "${identity.name}" seen in ${identity.names[0].sources.join(', ')}${identity.names[0].sources.length < 2 ? ' only (a single source)' : ''}${identity.names.length > 1 ? `; ${identity.names.length - 1} other name${identity.names.length > 2 ? 's' : ''} found` : ''}${identity.typeHint ? `; the page says it is a ${identity.typeHint.label.toLowerCase()}` : ''}`, identity.names.length)
    : extractorResult('identity', 'failed', 'no business name found in the title, JSON-LD, copyright line or header', 0));

  // address
  const addrs: ParsedAddress[] = [];
  for (const n of ld) {
    const a = n.address;
    if (a && typeof a === 'object' && a.streetAddress && a.postalCode) addrs.push({ street: clean(a.streetAddress), city: clean(a.addressLocality), state: clean(a.addressRegion), zip: clean(a.postalCode), formatted: `${clean(a.streetAddress)}, ${clean(a.addressLocality)}, ${clean(a.addressRegion)} ${clean(a.postalCode)}` });
  }
  addrs.push(...parseAddresses(text));
  const tally: { addr: ParsedAddress; n: number }[] = [];
  for (const a of addrs) { const hit = tally.find((t) => sameAddress(t.addr, a)); if (hit) { hit.n++; if (a.unit && !hit.addr.unit) hit.addr = { ...hit.addr, unit: a.unit, formatted: a.formatted }; } else tally.push({ addr: a, n: 1 }); }
  const address = tally.sort((a, b) => b.n - a.n)[0]?.addr;
  report.push(address ? extractorResult('address', 'success', `${address.formatted} (seen ${tally[0].n}x)`, 1) : extractorResult('address', 'skipped', 'no street address with city, state and ZIP on the page', 0));

  // phones: a number people call is not the same as a number on a "Book now" button for one service
  const phoneSeen = new Map<string, { number: string; contact: number; booking: number; first: number }>();
  const note = (raw: string, kind: 'contact' | 'booking', at: number) => {
    const n = plausiblePhone(raw);
    if (!n) return;
    const k = phoneKey(n);
    const hit = phoneSeen.get(k) || { number: n, contact: 0, booking: 0, first: at };
    hit[kind]++;
    phoneSeen.set(k, hit);
  };
  links.filter((a) => /^tel:/i.test(a.href)).forEach((a, i) => note(decodeURIComponent(a.href.slice(4)), BOOK_TEXT.test(a.text) ? 'booking' : 'contact', i));
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g)) note(`${m[1]}${m[2]}${m[3]}`, 'contact', 100 + (m.index || 0));
  for (const n of ld) if (typeof n.telephone === 'string') note(n.telephone, 'contact', 0);
  const phoneList = [...phoneSeen.values()];
  const primaryPhone = phoneList.filter((p) => p.contact > 0).sort((a, b) => b.contact - a.contact || a.first - b.first)[0];
  const phones: SiteContent['phones'] = { primary: primaryPhone?.number, others: phoneList.filter((p) => p !== primaryPhone).map((p) => ({ number: p.number, context: p.booking && !p.contact ? 'a booking button' : 'elsewhere on the page' })) };
  report.push(phones.primary ? extractorResult('phone', 'success', `${phones.primary}${phones.others.length ? `; ${phones.others.length} other number${phones.others.length > 1 ? 's' : ''} kept separate` : ''}`, phoneList.length) : extractorResult('phone', 'skipped', 'no phone number on the page', 0));

  const emails = [...new Set([...links.filter((a) => /^mailto:/i.test(a.href)).map((a) => a.href.slice(7).split('?')[0].trim()), ...[...text.matchAll(/(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0])].map((e) => e.toLowerCase()))].filter((e) => !isPlaceholderEmail(e));

  // booking
  const bookLinks = links.filter((a) => {
    if (/^https?:/.test(a.href)) return BOOK_TEXT.test(a.text) || !!platformOf(a.href);
    if (/^tel:|^mailto:/.test(a.href)) return BOOK_TEXT.test(a.text);
    return false;
  });
  const tallyUrl = new Map<string, { url: string; n: number; score: number; text: string }>();
  for (const a of bookLinks.filter((x) => /^https?:/.test(x.href) && !sameLink(x.href, baseUrl))) {
    const hit = tallyUrl.get(a.href.replace(/#.*$/, '')) || { url: a.href.replace(/#.*$/, ''), n: 0, score: 0, text: a.text };
    hit.n++; hit.score += 1 + (a.where === 'header' ? 2 : 0);
    tallyUrl.set(hit.url, hit);
  }
  const ranked = [...tallyUrl.values()].sort((a, b) => b.score - a.score);
  const label = (u: string, t: string) => (platformOf(u) && /^(book|schedule)/i.test(t) ? clean(t) : 'Book online');
  const primary: BookingDest | undefined = ranked[0] ? { url: ranked[0].url, kind: 'online', label: label(ranked[0].url, ranked[0].text), platform: platformOf(ranked[0].url), scope: 'primary', basis: `used by ${ranked[0].n} booking link${ranked[0].n > 1 ? 's' : ''} on the page` } : undefined;
  const others: BookingDest[] = [
    ...ranked.slice(1).map((r): BookingDest => ({ url: r.url, kind: 'online', label: label(r.url, r.text), platform: platformOf(r.url), scope: 'service', basis: 'a different booking address on the page' })),
    ...bookLinks.filter((a) => /^tel:/.test(a.href) && phoneKey(decodeURIComponent(a.href.slice(4))) !== phoneKey(phones.primary)).map((a): BookingDest => ({ url: a.href, kind: 'phone', label: a.text || 'Call to book', scope: 'service', basis: 'a phone number used only on a booking button' })),
  ];
  const bookingReport = primary
    ? extractorResult('booking', 'success', `${primary.platform ? `${primary.platform} ` : ''}${primary.url}${others.length ? `; ${others.length} separate destination${others.length > 1 ? 's' : ''} kept apart` : ''}`, 1 + others.length)
    : extractorResult('booking', 'skipped', 'no online booking or scheduling link found', 0);
  report.push(bookingReport);

  // services
  const svc = servicesOf($page, baseUrl, links);
  let services = svc.items;
  if (svc.container && services.length) {
    // one booking button per service, in order: a different destination belongs to that service, not to the clinic
    const inBox = links.filter((a) => $page(a.el).closest(svc.container!).length && bookLinks.includes(a));
    if (inBox.length === services.length) {
      services = services.map((s, i) => {
        const a = inBox[i];
        const dest = /^tel:/.test(a.href) ? phoneKey(decodeURIComponent(a.href.slice(4))) !== phoneKey(phones.primary) : primary ? !sameLink(a.href, primary.url) : false;
        const booking: BookingDest | undefined = dest ? { url: a.href.replace(/#.*$/, ''), kind: /^tel:/.test(a.href) ? 'phone' : 'online', label: a.text || 'Book', platform: platformOf(a.href), scope: 'service', service: s.name, basis: 'the booking button beside this service' } : undefined;
        return booking ? { ...s, booking } : s;
      });
      for (const s of services) if (s.booking) { const o = others.find((x) => sameLink(x.url, s.booking!.url) || x.url === s.booking!.url); if (o) o.service = s.name; }
    }
  }
  if (identity.name) services = services.map((s) => ({ ...s, description: s.description ? restoreName(s.description, identity.name) : s.description }));
  report.push(services.length
    ? extractorResult('services', 'success', `${services.length} from ${svc.method === 'headings' ? 'a headed list on the page' : svc.method === 'json-ld' ? 'structured data' : 'a list'}${services.some((s) => !s.description) ? '; some have no description on the page' : ''}`, services.length)
    : extractorResult('services', 'failed', 'no list of services found (no "Services" section with headed items, no structured data)', 0));

  const story0 = storyOf($page, identity.description);
  const story = story0 && identity.name ? { ...story0, text: restoreName(story0.text, identity.name) } : story0;
  report.push(story ? extractorResult('story', story.method === 'section' ? 'success' : 'partial', story.method === 'section' ? `"${story.heading}" section, ${story.text.length} characters` : 'only the page description, no story section', 1) : extractorResult('story', 'skipped', 'no story or about text', 0));

  // media
  const videos = videosOf($page, baseUrl);
  const posters = new Set(videos.map((v) => v.poster).filter(Boolean).map((p) => imageKey(p!)));
  const ldImages: string[] = [];
  for (const n of ld) { for (const k of ['image', 'logo']) for (const v of [].concat(n[k] || [])) { const u = typeof v === 'string' ? v : (v as any)?.url; if (typeof u === 'string') ldImages.push(u); } }
  const images = imagesOf($page, baseUrl, posters, ldImages);
  const serviceKeys = new Set(services.map((x) => x.image?.key).filter(Boolean));
  for (const im of images) if (serviceKeys.has(im.key)) im.role = 'service';
  for (const v of videos) if (v.poster && !images.some((i) => i.key === imageKey(v.poster!))) images.push({ url: originalImageUrl(v.poster), seen: v.poster, altKind: 'missing', role: 'poster', origin: 'video-poster', key: imageKey(v.poster) });
  const usable = images.filter((i) => i.role !== 'icon' && i.role !== 'social');
  report.push(usable.length ? extractorResult('images', 'success', `${usable.length} distinct pictures (${images.filter((i) => i.role === 'content').length} content, ${images.filter((i) => i.role === 'poster').length} video posters${images.some((i) => i.role === 'logo') ? ', logo' : ''}); ${images.length - usable.length} icons skipped`, usable.length) : extractorResult('images', 'skipped', 'no photographs found in the page HTML', 0));
  const playButtons = $page('*').filter((_, e) => /^play video$/i.test(clean($page(e).clone().children().remove().end().text()))).length;
  // page builders draw each player twice (desktop and phone layouts), so up to two buttons per video is expected
  report.push(videos.length
    ? extractorResult('videos', playButtons > videos.length * 2 ? 'partial' : 'success', `${videos.length} video reference${videos.length > 1 ? 's' : ''} (${[...new Set(videos.map((v) => v.kind))].join(', ')})${playButtons > videos.length ? `; ${playButtons} play buttons on the page${playButtons > videos.length * 2 ? ', more than the videos found' : ' (one per layout)'}` : ''}`, videos.length, playButtons > videos.length * 2 ? playButtons : undefined)
    : playButtons ? extractorResult('videos', 'failed', `the page shows ${playButtons} "Play video" buttons but no video address was found in its HTML`, 0, playButtons) : extractorResult('videos', 'skipped', 'no videos on the page', 0));

  const hours = hoursOf($page, text);
  report.push(hours ? extractorResult('hours', hours.method === 'json-ld' ? 'success' : 'partial', hours.method === 'json-ld' ? 'from structured data' : 'read from page text, not confirmed', hours.lines.length) : extractorResult('hours', 'skipped', 'no opening hours on the page: hours stay unknown', 0));

  return { identity, address, phones, emails, booking: { primary, others }, services, story, images, videos, hours, socials: opts.socials || [], report };
}
