import { z } from 'zod';
import type { ServiceItem } from '../types.js';
import { slugify } from '../util/text.js';
import { profileFor, type Category } from './categories.js';

/**
 * What a business offers (services, treatments, menu items, memberships, products) with an explicit price state.
 * Prices only come from a reliable source: the business's own website (Claude reads it), the owner (the preview
 * editor), or clearly labelled sample data in fictional fixtures. Unknown → "Request a quote" / "Price on request".
 */
export const PRICE_KINDS = ['fixed', 'from', 'range', 'unit', 'quote'] as const;
export const PRICE_UNITS = ['hour', 'session', 'class', 'visit', 'month', 'year', 'week', 'person', 'item', 'day'] as const;
export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'PKR', 'INR', 'AED', 'ZAR', 'SGD'] as const;
export const SOURCES = ['owner', 'website', 'business', 'sample', 'theme'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export type Source = (typeof SOURCES)[number];

const TEXT = (min: number, max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().min(min).max(max));
const money = z.number().finite().min(0, 'amounts can\'t be negative').max(10_000_000, 'amount too large');

export const priceSchema = z.object({
  kind: z.enum(PRICE_KINDS),
  amount: money.optional(),
  max: money.optional(),
  currency: z.enum(CURRENCIES).default('USD'),
  unit: z.enum(PRICE_UNITS).optional(),
}).strict().superRefine((p, ctx) => {
  if (p.kind !== 'quote' && p.amount == null) ctx.addIssue({ code: 'custom', message: 'this price needs an amount', path: ['amount'] });
  if (p.kind === 'range' && (p.max == null || p.max <= (p.amount ?? 0))) ctx.addIssue({ code: 'custom', message: 'the top of the range must be higher than the bottom', path: ['max'] });
  if (p.kind === 'unit' && !p.unit) ctx.addIssue({ code: 'custom', message: 'choose what the price is per', path: ['unit'] });
});
export type Price = z.infer<typeof priceSchema>;

/** Where a visitor goes to book or ask about one offering when it differs from the business's main booking address. */
export const contactSchema = z.object({
  kind: z.enum(['online', 'phone', 'email', 'page']),
  url: z.string().max(400).regex(/^(https?:\/\/|tel:|mailto:)/i),
  label: TEXT(2, 40),
}).strict();
export type OfferingContact = z.infer<typeof contactSchema>;

/** The picture on a service's own card, with its crop focus: kept together with the service. */
export const serviceImageSchema = z.object({
  path: z.string().max(200),
  width: z.number().int().min(1).max(8000),
  height: z.number().int().min(1).max(8000),
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  alt: TEXT(0, 160),
  source: z.enum(['website', 'owner']),
  original: z.string().max(200).optional(),
  sourceUrl: z.string().max(600).optional(),
}).strict();
export type ServiceImage = z.infer<typeof serviceImageSchema>;

export const offeringSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: TEXT(2, 60),
  description: TEXT(0, 160).optional(),
  duration: TEXT(0, 24).optional(),
  /** a short condition the source states ("By appointment only") */
  note: TEXT(0, 80).optional(),
  /** a booking or contact destination for this offering alone */
  contact: contactSchema.optional(),
  /** the picture on this offering's own card */
  image: serviceImageSchema.optional(),
  price: priceSchema,
  source: z.enum(SOURCES),
  icon: z.string().max(30).optional(),
}).strict();
export type Offering = z.infer<typeof offeringSchema>;
export const offeringsSchema = z.array(offeringSchema).max(24);

export function validateOfferings(raw: unknown): { ok: true; offerings: Offering[] } | { ok: false; errors: string[] } {
  const r = offeringsSchema.safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const ids = new Set<string>();
  for (const o of r.data) { if (ids.has(o.id)) return { ok: false, errors: [`duplicate offering ${o.id}`] }; ids.add(o.id); }
  return { ok: true, offerings: r.data };
}

const LOCALE: Record<string, string> = { USD: 'en-US', CAD: 'en-CA', GBP: 'en-GB', EUR: 'en-IE', AUD: 'en-AU', NZD: 'en-NZ', PKR: 'en-PK', INR: 'en-IN', AED: 'en-AE', ZAR: 'en-ZA', SGD: 'en-SG' };
export function formatMoney(amount: number, currency: string): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(LOCALE[currency] || 'en-US', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}

/** "$45", "From $45", "$45–$80", "$49 / month", or the category's wording for unknown prices. */
export function formatPrice(p: Price, category?: Category | string): string {
  const m = (n?: number) => formatMoney(n ?? 0, p.currency);
  switch (p.kind) {
    case 'fixed': return m(p.amount);
    case 'from': return `From ${m(p.amount)}`;
    case 'range': return `${m(p.amount)}–${m(p.max)}`;
    case 'unit': return `${m(p.amount)} / ${p.unit}`;
    default: return profileFor(category).unknownPrice;
  }
}

/** A price as stated by a source, before validation. */
type LoosePrice = { kind?: string; amount?: number; max?: number; unit?: string; currency?: string };

/** Offerings for a build: the business's own list (with any stated prices), else the theme's services as quote-only. */
export function offeringsFrom(opts: {
  business?: { name: string; description?: string; duration?: string; price?: LoosePrice; source?: Source }[];
  own?: { name: string; description: string; icon: string; price?: LoosePrice | null; note?: string; contact?: { kind: string; url: string; label: string } | null; image?: ServiceImage | null; fromWebsite?: boolean }[];
  services: ServiceItem[];
  currency?: string;
}): Offering[] {
  const currency = (CURRENCIES as readonly string[]).includes(opts.currency || '') ? (opts.currency as Price['currency']) : 'USD';
  const out: Offering[] = [];
  const ids = new Set<string>();
  const push = (name: string, o: Omit<Offering, 'id' | 'name'>) => {
    let id = slugify(name).slice(0, 50) || 'offering';
    while (ids.has(id)) id += '-2';
    const cand = { id, name, ...o };
    const r = offeringSchema.safeParse(cand);
    // an invalid stated price becomes "on request" rather than dropping the offering
    let v = r.success ? r : offeringSchema.safeParse({ ...cand, price: { kind: 'quote', currency } });
    // an offering the source lists is never dropped for an optional field: retry without them, then with only the name
    if (!v.success) v = offeringSchema.safeParse({ ...cand, price: { kind: 'quote', currency }, description: (cand.description || '').slice(0, 157) || undefined, note: undefined, contact: undefined, image: undefined });
    if (!v.success) v = offeringSchema.safeParse({ id, name: String(name).slice(0, 60), price: { kind: 'quote', currency }, source: cand.source });
    if (v.success) { ids.add(id); out.push(v.data); }
  };
  if (opts.business?.length) {
    for (const s of opts.business) push(s.name, { description: s.description || undefined, duration: s.duration || undefined, price: { kind: 'quote', currency, ...(s.price || {}) } as unknown as Price, source: s.source || 'business' });
    return out.slice(0, 24);
  }
  const own = opts.own || [];
  if (own.length) {
    for (const s of own) push(s.name, { description: s.description || undefined, note: s.note || undefined, contact: s.contact ? (s.contact as OfferingContact) : undefined, image: s.image || undefined, price: s.price?.kind ? ({ currency, ...s.price } as unknown as Price) : { kind: 'quote', currency }, source: s.fromWebsite || (s.price?.kind && s.price.kind !== 'quote') ? 'website' : 'business', icon: s.icon });
  }
  for (const s of opts.services) {
    if (out.some((o) => o.name.toLowerCase() === s.label.toLowerCase())) continue;
    push(s.label, { description: s.description || undefined, price: { kind: 'quote', currency }, source: own.length ? 'business' : 'theme', icon: s.icon });
  }
  return out.slice(0, 24);
}

/** Back to the service items the regular renderers and the lead form use. */
export const toServiceItems = (o: Offering[]): ServiceItem[] => o.map((x) => ({ id: x.id, label: x.name, icon: x.icon || 'circle-check', hits: x.source === 'theme' ? 0 : 1, description: x.description }));

export const hasSamplePrices = (o: Offering[]) => o.some((x) => x.source === 'sample' && x.price.kind !== 'quote');
