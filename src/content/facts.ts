import type { Theme } from '../theme/schema.js';
import type { Business, Facts, WebsiteScan } from '../types.js';
import { is24h } from '../sources/places.js';
import { claudeJson } from './claude.js';
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
export interface OwnService { name: string; description: string; icon: string; price?: { kind: 'fixed' | 'from' | 'range' | 'unit'; amount: number; max?: number; unit?: string; currency?: string } | null }

export interface FactsResult {
  facts: Facts;
  /** The business's real services, in its own wording. Preferred over the theme's standard list when there are enough. */
  services: OwnService[];
  servicesMentioned: string[];
  serviceBlurbs: Record<string, string>;
  claudeMs?: number;
  design?: DesignAdvice;
}

const DESIGN_SYSTEM =
  ' Also suggest a website design (design): style is one of local-trusted (warm, reviews, team, service area), bold-direct ' +
  '(fast contact, practical; right for urgent work), modern-premium (editorial, large project photos, workmanship); mainService is the ' +
  'one service the site should lead with, copied from your services list or themeServices; headline (max 9 words) names that service and ' +
  'the city; subline (max 28 words) says plainly what the business does. Headline and subline may only use facts from the inputs: no ' +
  'superlatives, prices, phone numbers, "free", "best", "family-owned", "same-day", and no 24/7, emergency, licensed, insured, warranty ' +
  'or years unless those are stated. When designPreferences is given, follow it.';

/**
 * Facts the site is allowed to state. Rule from the theme package: only show facts the business states.
 * Claude reads the website + reviews when a key is configured; regex heuristics otherwise (and as a floor).
 */
export async function extractFacts(b: Business, theme: Theme, scan?: WebsiteScan, opts: { design?: { style?: string; service?: string; goal?: string } } = {}): Promise<FactsResult> {
  const h = heuristicFacts(b, scan);
  const services = theme.services.defaults.map((s) => ({ id: s.id, label: s.label }));
  const ai = await claudeJson<ClaudeFacts>({
    system: (opts.design ? DESIGN_SYSTEM : '') +
      'You extract verifiable facts about a local business for its website. Never invent facts. ' +
      'License, insurance, warranty and years in business must be explicitly stated on the business\'s OWN website text; otherwise return null. ' +
      'Emergency service and maintenance plans may also be inferred from the business hours or customer reviews. ' +
      'services: the services or offerings the business itself lists on its own website, using its own names for them (short, 1-5 words). ' +
      'If there is no website text, include only services that customer reviews explicitly say this business provides. ' +
      'Never add services that are merely typical for the category, and return an empty list when none are stated. Most important first, at most 8. ' +
      'Each description is one plain sentence (max 14 words) about the service itself, written as copy for the business\'s own website: ' +
      'never mention reviews, reviewers or "the website". Use only details from the inputs; if they give none, return an empty description. ' +
      'Service blurbs (for themeServices): one plain sentence (max 14 words) per service. ' +
      'All sentences: concrete, no hype, no prices, no claims not supported by the inputs.',
    prompt: JSON.stringify({
      business: { name: b.name, category: b.primaryTypeLabel, city: b.city, state: b.state, hours: b.hours?.weekdayText, summary: b.editorialSummary },
      websiteText: scan?.ok ? scan.text.slice(0, 9000) : null,
      reviews: b.reviews.map((r) => ({ rating: r.rating, text: r.text })),
      themeServices: services,
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
          description: 'The business\'s own services, from its website (or explicit mentions in reviews). Empty if none are stated.',
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
  if (!ai) return { facts: h, services: [], servicesMentioned: [], serviceBlurbs: {} };
  const d = ai.data;
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
  const own = (d.services || [])
    .map((s) => ({ name: String(s.name || '').trim().slice(0, 60), description: String(s.description || '').trim().slice(0, 160), icon: String(s.icon || ''), price: s.price && typeof s.price === 'object' && Number.isFinite(s.price.amount) ? s.price : undefined }))
    .filter((s) => s.name && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
    .slice(0, 8);
  const design = opts.design && d.design && typeof d.design === 'object' ? d.design : undefined;
  return { facts, services: own, servicesMentioned: d.servicesMentioned || [], serviceBlurbs: blurbs, claudeMs: ai.ms, design };
}
