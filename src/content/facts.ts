import type { Theme } from '../theme/schema.js';
import type { Business, Facts, WebsiteScan } from '../types.js';
import { is24h } from '../sources/places.js';
import { claudeEnabled, claudeJsonDetailed, claudeVia } from './claude.js';
import { claudeNotRun, type ClaudeRun } from './extraction.js';
import type { SourceService } from '../sources/site-content.js';
import { nameKey } from '../sources/site-content.js';
import { SERVICE_ICONS } from './services.js';

const EMERGENCY_RE = /\b(emergenc(y|ies)|24\/7|24-7|24 hours?|24hr|around the clock|after[- ]hours|same[- ]day service)\b/i;
const MAINTENANCE_RE = /\b(maintenance|tune[- ]?ups?|service plans?|care plans?|seasonal (care|plans?|service)|annual (service|inspection))\b/i;

function yearsFromText(text: string, now = new Date().getFullYear()): number | undefined {
  const since = text.match(/\b(?:since|established|est\.?|founded(?: in)?|serving [\w\s,]{0,40}? since)\s*(19[5-9]\d|20[0-2]\d)\b/i);
  if (since) { const y = now - Number(since[1]); if (y > 0 && y < 80) return y; }
  const n = text.match(/\b(\d{1,2})\+?\s+years\s+(?:of\s+experience|in\s+business|serving|of\s+service)/i);
  if (n) { const y = Number(n[1]); if (y > 0 && y < 80) return y; }
  return undefined;
}

function areasFromText(text: string): string[] {
  const m = text.match(/\b(?:serving|service areas?:?|we serve|proudly serving)\s+((?:[A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?(?:,\s*|\s+and\s+|\s*&\s*)){1,12}[A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?)/);
  if (!m) return [];
  return m[1].split(/,\s*|\s+and\s+|\s*&\s*/).map((s) => s.trim()).filter((s) => s.length > 2 && !/^(The|All|Our)$/.test(s));
}

export function heuristicFacts(b: Business, scan?: WebsiteScan): Facts {
  const site = scan?.ok ? scan.text : '';
  const reviews = b.reviews.map((r) => r.text).join('\n');
  const own = `${b.name}\n${b.editorialSummary || ''}\n${site}`;
  const lic = site.match(/\b(?:license|lic\.?)\s*(?:#|no\.?|number)?\s*:?\s*([A-Z]{0,4}[- ]?\d[\dA-Z-]{3,})/i);
  return {
    city: b.city,
    state: b.state,
    zip: b.zip,
    years: yearsFromText(site),
    licensed: /\blicensed\b/i.test(site),
    licenseNumber: lic?.[1],
    insured: /\b(fully\s+)?insured\b/i.test(site),
    warranty: /\b(warrant(y|ies)|guarantee[ds]?)\b/i.test(site),
    open24h: is24h(b.hours?.periods),
    emergency: EMERGENCY_RE.test(own) || EMERGENCY_RE.test(reviews) || (b.hours?.weekdayText || []).some((t) => /24 hours/i.test(t)),
    maintenance: MAINTENANCE_RE.test(own) || MAINTENANCE_RE.test(reviews),
    serviceAreas: areasFromText(site),
    notes: [],
    source: 'heuristic',
  };
}

interface ClaudeFacts {
  foundedYear?: number | null;
  yearsInBusiness?: number | null;
  licensed?: boolean | null;
  licenseNumber?: string | null;
  insured?: boolean | null;
  warranty?: boolean | null;
  emergencyService?: boolean | null;
  maintenancePlans?: boolean | null;
  serviceAreas?: string[];
  servicesMentioned?: string[];
  serviceBlurbs?: { id: string; blurb: string }[];
  services?: OwnService[];
  design?: DesignAdvice;
}

/** Claude's constrained design suggestion (plumbing pilot). The planner validates it; rules decide without it. */
export interface DesignAdvice { style?: string | null; mainService?: string | null; headline?: string | null; subline?: string | null }

/** A service the business itself lists (its website, or failing that, what reviews say it provides). */
export interface OwnService {
  name: string;
  description: string;
  icon: string;
  price?: { kind: 'fixed' | 'from' | 'range' | 'unit'; amount: number; max?: number; unit?: string; currency?: string } | null;
  /** a condition the source states beside it ("By appointment only") */
  note?: string;
  /** a booking or contact destination for this service alone */
  contact?: { kind: 'online' | 'phone' | 'email' | 'page'; url: string; label: string } | null;
  /** the picture on this service's own card on the website, cropped and stored with it */
  image?: import('../sources/service-images.js').ServiceImage | null;
  /** listed in the website's menu but not led with: shown after the main services */
  secondary?: boolean;
  /** the business's own page about this service */
  page?: string;
  /** read from the business's own website (as opposed to reviews or the theme) */
  fromWebsite?: boolean;
}

export interface FactsResult {
  facts: Facts;
  /** The business's real services, in its own wording. Preferred over the theme's standard list when there are enough. */
  services: OwnService[];
  servicesMentioned: string[];
  serviceBlurbs: Record<string, string>;
  claudeMs?: number;
  design?: DesignAdvice;
  /** what Claude suggested before the page's own list took over: proposals for review, never shown by themselves */
  claudeServices?: OwnService[];
  /** whether Claude read the content, whether its answer held up, and why a fallback answered instead */
  claude: ClaudeRun;
  /** what the page and Google establish: true when stated, null when unknown (never an invented "no") */
  states: FactStates;
}

export type FactStates = Record<'licensed' | 'insured' | 'warranty' | 'years' | 'emergency' | 'open24h' | 'maintenance', boolean | number | null>;

/** A fact is true when the business states it; otherwise it is unknown, not false. Hours-based facts are known only when hours are. */
export function factStates(f: Facts, ctx: { hoursKnown: boolean }): FactStates {
  return { licensed: f.licensed || null, insured: f.insured || null, warranty: f.warranty || null, years: f.years ?? null, emergency: f.emergency || null, open24h: ctx.hoursKnown ? f.open24h : null, maintenance: f.maintenance || null };
}

const DESIGN_SYSTEM =
  ' Also suggest a website design (design): style is one of local-trusted (warm, reviews, people, location), bold-direct ' +
  '(fast contact, practical), modern-premium (editorial, large relevant photos); mainService is the ' +
  'one verified offering the site should lead with, copied from sourceServices or the business website; headline (max 9 words) names that offering when verified, otherwise the business category and location, and ' +
  'the city; subline (max 28 words) says plainly what the business does. Headline and subline may only use facts from the inputs: no ' +
  'superlatives, prices, phone numbers, "free", "best", "family-owned", "same-day", and no 24/7, emergency, licensed, insured, warranty ' +
  'or years unless those are stated, and nothing about appointments, walk-ins or availability. When designPreferences is given, follow it.';

const NOTE_PATTERNS: [RegExp, string][] = [
  [/\b(?:available\s+)?by appointment(?: only)?\b/i, 'By appointment only'],
  [/\bno appointment (?:is )?(?:necessary|needed|required)\b/i, 'No appointment necessary'],
  [/\bwalk-?ins? (?:welcome|accepted|available)\b/i, 'Walk-ins welcome'],
];
/** "VivaWell Massage Therapy By Appointment Only" is a name and a condition: keep them apart. */
export function splitNote(text: string | undefined): { description?: string; note?: string } {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return {};
  let note: string | undefined;
  for (const [re, label] of NOTE_PATTERNS) if (re.test(t)) { note = label; t = t.replace(re, ' ').replace(/\s+available\s*$/i, '').replace(/\s+/g, ' ').replace(/[\s,.;:-]+$/, '').trim(); break; }
  return { description: t.length >= 3 ? t : undefined, note };
}

/** Cut at a word boundary: the offering model allows 160 characters. */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[,.;:\s-]+$/, '')}…`;
}

const ICON_BY_WORD: [RegExp, string][] = [
  [/massage|chair|relax/i, 'waves'], [/skin|facial|wellness|beauty|cosmetic|glow/i, 'sparkles'], [/adjust|spine|spinal|chiropract|align|back|neck/i, 'stethoscope'],
  [/decompress|therapy|rehab|recovery|pain|physio|injury/i, 'heart-pulse'], [/consult|exam|assess|evaluat|screen|check/i, 'clipboard-check'], [/fit|train|strength|exercise|yoga/i, 'dumbbell'],
  [/child|kid|pediatric|family|baby/i, 'baby'], [/pet|dog|vet|groom/i, 'dog'], [/clean|repair|install|fix/i, 'wrench'],
];
export const iconFor = (name: string) => { const i = ICON_BY_WORD.find(([re]) => re.test(name))?.[1]; return i && SERVICE_ICONS.includes(i) ? i : 'circle-check'; };

/**
 * The services the page itself lists are the services. Claude may add a one-line description and an icon to those, but
 * it does not decide which services exist and it does not replace what the page says. When the page lists none, what
 * Claude returned is used only if the business's own page text supports each name.
 */
export function mergeServices(source: SourceService[], claude: OwnService[], opts: { siteText: string; reviewText: string }): OwnService[] {
  const key = nameKey;
  if (source.length) {
    return source.map((s) => {
      const c = claude.find((x) => key(x.name) === key(s.name) || (key(s.name).length >= 6 && (key(x.name).includes(key(s.name)) || key(s.name).includes(key(x.name)))));
      const { description, note } = splitNote(s.description);
      const contact = s.booking ? { kind: s.booking.kind, url: s.booking.url, label: s.booking.kind === 'phone' ? 'Call to book' : s.booking.label } : null;
      return { name: s.name, description: shorten(description || (note ? '' : c?.description) || '', 150), icon: c?.icon && SERVICE_ICONS.includes(c.icon) ? c.icon : iconFor(s.name), note, contact, fromWebsite: true, price: undefined };
    });
  }
  const haystack = key(opts.siteText);
  return claude.filter((c) => haystack.includes(key(c.name)));
}

/** Claude's answer, checked against the text it was given: anything the page doesn't support is dropped and listed. */
function validateClaude(d: ClaudeFacts, h: Facts, text: { site: string; reviews: string; hours: string[] }, dropped: string[]): ClaudeFacts {
  const site = text.site.toLowerCase();
  const out: ClaudeFacts = { ...d };
  const need = (label: string, ok: boolean, key: keyof ClaudeFacts) => { if (d[key] && !ok) { (out as Record<string, unknown>)[key] = null; dropped.push(label); } };
  need('licensed (not stated on the website)', /\blicens/i.test(site), 'licensed');
  need('insured (not stated on the website)', /\binsur/i.test(site), 'insured');
  need('warranty (not stated on the website)', /warrant|guarantee/i.test(site), 'warranty');
  need('emergency service (no hours, review or website mention)', EMERGENCY_RE.test(`${site} ${text.reviews}`) || text.hours.some((t) => /24 hours/i.test(t)), 'emergencyService');
  need('maintenance plans (not mentioned)', MAINTENANCE_RE.test(`${site} ${text.reviews}`), 'maintenancePlans');
  if (d.foundedYear && !site.includes(String(d.foundedYear))) { out.foundedYear = null; dropped.push(`founded ${d.foundedYear} (year not on the website)`); }
  if (d.yearsInBusiness && h.years !== d.yearsInBusiness && !new RegExp(`\\b${d.yearsInBusiness}\\+?\\s+years`, 'i').test(site)) { out.yearsInBusiness = null; dropped.push(`${d.yearsInBusiness} years in business (not stated)`); }
  if (d.serviceAreas?.length) {
    const kept = d.serviceAreas.filter((a) => site.includes(a.toLowerCase()));
    if (kept.length !== d.serviceAreas.length) dropped.push(`${d.serviceAreas.length - kept.length} service area(s) not on the website`);
    out.serviceAreas = kept;
  }
  return out;
}

/**
 * Facts the site is allowed to state. Rule from the theme package: only show facts the business states.
 * Claude reads the website + reviews when a key is configured; regex heuristics otherwise (and as a floor).
 * The result says whether Claude actually ran and whether its answer held up, so a template answer is never
 * mistaken for a model one, and facts nobody stated stay unknown.
 */
export async function extractFacts(b: Business, theme: Theme, scan?: WebsiteScan, opts: { design?: { style?: string; service?: string; goal?: string } } = {}): Promise<FactsResult> {
  const h = heuristicFacts(b, scan);
  const themeServices = theme.services.defaults.map((s) => ({ id: s.id, label: s.label }));
  const siteText = scan?.ok ? scan.text : '';
  const reviewText = b.reviews.map((r) => r.text).join('\n');
  const sourceServices = scan?.content?.services ?? [];
  const hoursKnown = !!b.hours?.periods?.length;
  const states = (f: Facts) => factStates(f, { hoursKnown });
  const via = claudeVia();
  const noInputs = !siteText && !reviewText && !b.editorialSummary;
  const fallbackOnly = (run: ClaudeRun): FactsResult => ({ facts: h, services: mergeServices(sourceServices, [], { siteText, reviewText }), servicesMentioned: [], serviceBlurbs: {}, claude: run, states: states(h) });
  if (!claudeEnabled()) return fallbackOnly(claudeNotRun(false, null, 'Claude is not configured (no ANTHROPIC_API_KEY and no local Claude CLI), so rules read the page'));
  if (noInputs) return fallbackOnly(claudeNotRun(true, via, 'there was no website text, reviews or summary to read'));

  const ai = await claudeJsonDetailed<ClaudeFacts>({
    system: (opts.design ? DESIGN_SYSTEM : '') +
      'You extract verifiable facts about a local business for its website. Never invent facts. ' +
      'License, insurance, warranty and years in business must be explicitly stated on the business\'s OWN website text; otherwise return null. ' +
      'Emergency service and maintenance plans may also be inferred from the business hours or customer reviews. ' +
      'services: the services or offerings the business itself lists on its own website, using its own names for them (short, 1-5 words). ' +
      'sourceServices, when given, are the services the page lists: return exactly those, in that order, and only add a description. ' +
      'If there is no website text or listed sourceServices, return no services. Customer reviews are opinions, not a verified catalogue of offerings. ' +
      'Never add services that are merely typical for the category, and return an empty list when none are stated. Most important first, at most 8. ' +
      'Each description is one plain sentence (max 14 words) about the service itself, written as copy for the business\'s own website: ' +
      'never mention reviews, reviewers or "the website". Use only details from the inputs; if they give none, return an empty description. ' +
      'Service blurbs (for themeServices): one plain sentence (max 14 words) per service. ' +
      'All sentences: concrete, no hype, no prices, no claims not supported by the inputs.',
    prompt: JSON.stringify({
      business: { name: b.name, category: b.primaryTypeLabel, city: b.city, state: b.state, hours: b.hours?.weekdayText, summary: b.editorialSummary },
      websiteText: siteText ? siteText.slice(0, 9000) : null,
      sourceServices: sourceServices.length ? sourceServices.map((s) => ({ name: s.name, pageSays: s.description || null })) : undefined,
      reviews: b.reviews.map((r) => ({ rating: r.rating, text: r.text })),
      themeServices,
      ...(opts.design ? { designPreferences: opts.design } : {}),
    }),
    toolName: 'record_facts',
    toolDescription: 'Record the facts found about the business.',
    schema: {
      type: 'object',
      properties: {
        foundedYear: { type: ['integer', 'null'] },
        yearsInBusiness: { type: ['integer', 'null'] },
        licensed: { type: ['boolean', 'null'] },
        licenseNumber: { type: ['string', 'null'] },
        insured: { type: ['boolean', 'null'] },
        warranty: { type: ['boolean', 'null'] },
        emergencyService: { type: ['boolean', 'null'] },
        maintenancePlans: { type: ['boolean', 'null'] },
        serviceAreas: { type: 'array', items: { type: 'string' }, description: 'Towns/cities the website says they serve' },
        servicesMentioned: { type: 'array', items: { type: 'string' }, description: 'ids from themeServices that the website or reviews mention' },
        serviceBlurbs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, blurb: { type: 'string' } }, required: ['id', 'blurb'] } },
        services: {
          type: 'array',
          maxItems: 8,
          description: 'Offerings listed on the business website. Empty when no business-owned source lists them.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The business\'s own name for the service, 1-5 words' },
              description: { type: 'string', description: 'One plain sentence, max 14 words, from what the inputs say' },
              icon: { type: 'string', enum: SERVICE_ICONS, description: 'Closest matching outline icon' },
              price: {
                type: ['object', 'null'],
                description: 'Only when the website states this exact price in writing; otherwise null. Never estimate or infer a price.',
                properties: {
                  kind: { type: 'string', enum: ['fixed', 'from', 'range', 'unit'] },
                  amount: { type: 'number' },
                  max: { type: 'number', description: 'top of a range' },
                  unit: { type: 'string', enum: ['hour', 'session', 'class', 'visit', 'month', 'year', 'week', 'person', 'item', 'day'] },
                  currency: { type: 'string', description: 'ISO code, e.g. USD' },
                },
                required: ['kind', 'amount'],
              },
            },
            required: ['name', 'description', 'icon'],
          },
        },
        ...(opts.design ? {
          design: {
            type: 'object',
            properties: {
              style: { type: ['string', 'null'], enum: ['clean-professional', 'local-trusted', 'bold-direct', 'modern-premium', null] },
              mainService: { type: ['string', 'null'] },
              headline: { type: ['string', 'null'] },
              subline: { type: ['string', 'null'] },
            },
          },
        } : {}),
      },
      required: ['servicesMentioned', 'serviceBlurbs', 'services'],
    },
  });
  if (!ai.ok) return fallbackOnly({ enabled: true, via: ai.via, ran: true, validated: false, ms: ai.ms, dropped: [], fallbackReason: 'the request to Claude failed, so rules read the page instead', error: ai.error });
  // the answer must be an object with the arrays the rest of the build relies on
  if (!ai.data || typeof ai.data !== 'object' || !Array.isArray(ai.data.services ?? [])) return fallbackOnly({ enabled: true, via: ai.via, ran: true, validated: false, ms: ai.ms, dropped: [], fallbackReason: 'Claude answered, but not in the required shape, so rules read the page instead', error: 'answer did not match the schema' });

  const dropped: string[] = [];
  const d = validateClaude(ai.data, h, { site: siteText || '', reviews: reviewText, hours: b.hours?.weekdayText || [] }, dropped);
  const now = new Date().getFullYear();
  const years = d.yearsInBusiness ?? (d.foundedYear ? now - d.foundedYear : undefined) ?? h.years;
  const facts: Facts = {
    ...h,
    years: years && years > 0 && years < 80 ? years : undefined,
    licensed: d.licensed ?? h.licensed,
    licenseNumber: d.licenseNumber ?? h.licenseNumber,
    insured: d.insured ?? h.insured,
    warranty: d.warranty ?? h.warranty,
    emergency: (d.emergencyService ?? false) || h.emergency,
    maintenance: (d.maintenancePlans ?? false) || h.maintenance,
    serviceAreas: d.serviceAreas?.length ? d.serviceAreas : h.serviceAreas,
    source: 'claude',
  };
  const blurbs: Record<string, string> = {};
  for (const s of d.serviceBlurbs || []) if (s.id && s.blurb) blurbs[s.id] = s.blurb.trim();
  const seen = new Set<string>();
  const claudeOwn: OwnService[] = (d.services || [])
    .map((s) => ({ name: String(s.name || '').trim().slice(0, 60), description: String(s.description || '').trim().slice(0, 160), icon: String(s.icon || ''), price: s.price && typeof s.price === 'object' && Number.isFinite(s.price.amount) ? s.price : undefined }))
    .filter((s) => s.name && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
    .slice(0, 8);
  const own = mergeServices(sourceServices, claudeOwn, { siteText, reviewText });
  if (!sourceServices.length && own.length < claudeOwn.length) dropped.push(`${claudeOwn.length - own.length} service(s) not on the website`);
  const design = opts.design && d.design && typeof d.design === 'object' ? d.design : undefined;
  return { facts, services: own, claudeServices: claudeOwn, servicesMentioned: d.servicesMentioned || [], serviceBlurbs: blurbs, claudeMs: ai.ms, design, claude: { enabled: true, via: ai.via, ran: true, validated: true, ms: ai.ms, dropped }, states: states(facts) };
}
