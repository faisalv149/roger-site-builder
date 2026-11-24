/**
 * What a splash page needs from the business's own pages beyond the research brief, read from the pages research
 * already fetched (robots.txt obeyed there; no other site is ever read): questions the business answers, its team,
 * the business data in its JSON-LD, and text that addresses an AI (ignored, and noted for the owner).
 * Also: the business's own action links sorted into book, order, reserve and quote.
 */
import { load, type CheerioAPI } from 'cheerio';

export interface Faq { q: string; a: string; url: string }
export interface TeamMember { name: string; role?: string; url: string }
export interface Extras { faqs: Faq[]; team: TeamMember[]; jsonld: Record<string, unknown>[]; sameAs: string[]; injection: { url: string; text: string }[] }

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** two or three capitalised words: a person's name (no business words) */
const PERSON = /^(?:Dr\.?\s+)?[A-Z][a-z'’-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z'’-]+){1,2}$/;
const NOT_PERSON = /\b(Team|Services?|Our|Meet|About|Contact|Book|Hours|Company|Group|Inc|LLC|Ltd|Plumbing|Roofing|Salon|Clinic|Studio|Shop|Cafe|Bakery|Restaurant|Kitchen|Dental|Repair|Home|Care)\b/;
const INJECTION = /\b(ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|prompts)|disregard (?:the |all |any )?(?:previous |prior )?instructions|you are (?:an? )?(?:ai|assistant|language model|chatgpt|claude|gpt)|as an ai\b|system prompt|(?:dear|hello|hi),? (?:ai|assistant|chatgpt|claude)\b|instructions? (?:to|for) (?:the )?(?:ai|assistant|model))/i;

function flat(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) { for (const n of node) flat(n, out); return out; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o['@type']) out.push(o);
    if (o['@graph']) flat(o['@graph'], out);
    for (const k of ['mainEntity', 'employee', 'founder', 'member', 'hasPart']) if (o[k]) flat(o[k], out);
  }
  return out;
}
const types = (o: Record<string, unknown>) => ([] as unknown[]).concat(o['@type'] ?? []).map(String);
const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : '');

function faqsOf($: CheerioAPI, url: string, ld: Record<string, unknown>[]): Faq[] {
  const out: Faq[] = [];
  for (const o of ld) if (types(o).includes('Question') && o.name) out.push({ q: clean(String(o.name)), a: clean(load(text(o.acceptedAnswer)).text()), url });
  $('details').each((_, el) => {
    const q = clean($(el).children('summary').first().text());
    const a = clean($(el).clone().children('summary').remove().end().text());
    if (q.endsWith('?') && a.length > 10) out.push({ q, a, url });
  });
  // a question as a heading, answered by the paragraphs after it (on a page about questions, or in a FAQ section)
  const faqPage = /faq|question/i.test(url) || /faq|frequently asked/i.test($('h1,h2').first().text());
  $('h2,h3,h4,dt').each((_, el) => {
    const q = clean($(el).text());
    if (!q.endsWith('?') || q.length > 160) return;
    const inFaq = faqPage || /faq|frequently asked/i.test(clean($(el).closest('section,div').find('h1,h2').first().text()));
    if (!inFaq) return;
    const a = clean(el.tagName === 'dt' ? $(el).next('dd').text() : $(el).nextUntil('h1,h2,h3,h4').filter('p,ul,ol,div').text());
    if (a.length > 10) out.push({ q, a: a.slice(0, 600), url });
  });
  return out;
}

function teamOf($: CheerioAPI, url: string, ld: Record<string, unknown>[]): TeamMember[] {
  const out: TeamMember[] = [];
  for (const o of ld) if (types(o).includes('Person') && typeof o.name === 'string' && PERSON.test(clean(o.name))) out.push({ name: clean(o.name), role: typeof o.jobTitle === 'string' ? clean(o.jobTitle) : undefined, url });
  // a team section: its heading names the team; each member is a short heading that reads as a name, its role beside it
  $('h1,h2,h3').filter((_, h) => /\b(our team|the team|meet\b|our staff|our people|our (?:doctors|dentists|stylists|barbers|technicians|attorneys|lawyers))\b/i.test($(h).text())).each((_, h) => {
    const section = $(h).closest('section').length ? $(h).closest('section') : $(h).parent();
    section.find('h3,h4,h5,strong').each((_, n) => {
      const name = clean($(n).text());
      if (!PERSON.test(name) || NOT_PERSON.test(name)) return;
      const next = clean($(n).next('p,span,small,em,div').first().text());
      out.push({ name, role: next && next.length <= 60 ? next : undefined, url });
    });
  });
  return out;
}

/** the extras from the business's own pages ({url, html}), deduplicated */
export function extractExtras(pages: { url: string; html: string }[]): Extras {
  const faqs: Faq[] = [], team: TeamMember[] = [], jsonld: Record<string, unknown>[] = [], sameAs = new Set<string>(), injection: Extras['injection'] = [];
  for (const { url, html } of pages) {
    const $ = load(html);
    const ld: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => { try { flat(JSON.parse($(el).contents().text()), ld); } catch { /* malformed JSON-LD is common */ } });
    for (const o of ld) {
      if (types(o).some((t) => /Business|Organization|Store|Restaurant|Salon|Contractor|Plumber|Electrician|Dentist|Clinic|Attorney|Service/i.test(t))) {
        jsonld.push(o);
        for (const s of ([] as unknown[]).concat(o.sameAs ?? [])) if (typeof s === 'string' && /^https:\/\//.test(s)) sameAs.add(s);
      }
    }
    faqs.push(...faqsOf($, url, ld));
    team.push(...teamOf($, url, ld));
    $('script,style,noscript').remove();
    const body = clean($('body').text());
    const m = INJECTION.exec(body);
    if (m) injection.push({ url, text: body.slice(Math.max(0, m.index - 40), m.index + m[0].length + 60) });
  }
  const seenQ = new Set<string>(), seenN = new Set<string>();
  return {
    faqs: faqs.filter((f) => { const k = f.q.toLowerCase(); if (seenQ.has(k)) return false; seenQ.add(k); return true; }).slice(0, 12),
    team: team.filter((t) => { const k = t.name.toLowerCase(); if (seenN.has(k)) return false; seenN.add(k); return true; }).slice(0, 12),
    jsonld, sameAs: [...sameAs], injection,
  };
}

/** the business's own action links, sorted: where a visitor books, orders, reserves or asks for a quote */
export type LinkKind = 'book' | 'order' | 'reserve' | 'quote';
const HOSTS: [LinkKind, RegExp][] = [
  ['order', /(doordash|ubereats|grubhub|postmates|toasttab|chownow|slicelife|order\.online|menufy|clover\.com\/online|square\.site|ordering\.app|beyondmenu|seamless)\b/i],
  ['reserve', /(opentable|resy|sevenrooms|exploretock|tock\.com|yelp\.com\/reservations|quandoo|thefork)\b/i],
  ['book', /(booksy|vagaro|fresha|book\.squareup|squareup\.com\/appointments|calendly|acuityscheduling|mindbodyonline|schedulicity|zocdoc|glossgenius|setmore|styleseat|simplybook|janeapp|localmed|nexhealth|housecallpro\.com\/book|getjobber\.com.*\/request)/i],
];
export function linkKind(href: string, label = ''): LinkKind | undefined {
  for (const [kind, re] of HOSTS) if (re.test(href)) return kind;
  const l = label.toLowerCase();
  if (/\border\b/.test(l)) return 'order';
  if (/\b(reserve|reservation|book a table)\b/.test(l)) return 'reserve';
  if (/\b(quote|estimate)\b/.test(l)) return 'quote';
  if (/\b(book|appointment|schedule)\b/.test(l)) return 'book';
  return undefined;
}
