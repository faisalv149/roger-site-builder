import { z } from 'zod';
import type { Category } from './categories.js';

/**
 * SitePlan: which pages a site has, their routes, page types and the owner's metadata overrides. A sparse
 * business gets one complete page; a business with enough distinct content gets Home, an offerings overview,
 * individual offering pages where they have something real to say, About and Contact. Every extra page must
 * serve a distinct visitor need: no empty About pages, no thin service pages, no town-name substitutions.
 * Routes are relative ("", "services/", "services/drain-cleaning/") so the same files work under the preview
 * path and at a domain root.
 */
export const SITE_PLAN_VERSION = 1;
export const PAGE_TYPES = ['home', 'offerings', 'offering', 'about', 'contact'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

const route = z.string().max(120).regex(/^([a-z0-9-]+\/)*$/);
const metaText = (max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().max(max));
export const pageOverrideSchema = z.object({ title: metaText(70).optional(), description: metaText(170).optional() }).strict();

export const sitePageSchema = z.object({
  id: z.string().regex(/^[a-z0-9:-]{1,90}$/),
  type: z.enum(PAGE_TYPES),
  route,
  navLabel: z.string().max(40).optional(),
  offeringId: z.string().max(60).optional(),
}).strict();
export type SitePage = z.infer<typeof sitePageSchema>;

export const sitePlanSchema = z.object({
  version: z.literal(SITE_PLAN_VERSION),
  mode: z.enum(['single', 'multi']),
  /** auto: Roger decides from the content; owner: the owner chose single or multi */
  modeSource: z.enum(['auto', 'owner']),
  pages: z.array(sitePageSchema).min(1).max(30),
  overrides: z.record(z.string(), pageOverrideSchema).default({}),
  /** routes that existed before and now redirect (old route → new route), kept across changes */
  redirects: z.array(z.object({ from: route, to: route }).strict()).max(200).default([]),
}).strict();
export type SitePlan = z.infer<typeof sitePlanSchema>;

/** Where a category's offerings live ("Menu" at menu/, "Treatments" at treatments/). */
export const OFFERINGS_ROUTE: Record<Category, { route: string; label: string; itemPages: boolean }> = {
  trades: { route: 'services', label: 'Services', itemPages: true },
  professional: { route: 'services', label: 'Services', itemPages: true },
  general: { route: 'services', label: 'Services', itemPages: true },
  salon: { route: 'treatments', label: 'Treatments', itemPages: true },
  food: { route: 'menu', label: 'Menu', itemPages: false },
  fitness: { route: 'memberships', label: 'Memberships', itemPages: false },
  shop: { route: 'products', label: 'Products', itemPages: false },
};

export interface SitePlanInput {
  category: Category;
  offerings: { id: string; name: string; description?: string; omitted?: boolean }[];
  /** something real to say on an About page: a story/summary plus people or facts */
  about: { intro?: string; team: boolean; years?: number; trust: number; reviews: number };
  /** a public address or opening hours to put on a Contact page */
  contact: { address: boolean; hours: boolean; phone: boolean };
  mode?: 'single' | 'multi';
  previous?: SitePlan;
}

/** an offering earns its own page with a real description (not just a name and a price) */
export const MIN_OFFERING_TEXT = 60;

export function buildSitePlan(i: SitePlanInput): SitePlan {
  const o = OFFERINGS_ROUTE[i.category];
  const offerings = i.offerings.filter((x) => !x.omitted);
  const itemPages = o.itemPages ? offerings.filter((x) => (x.description?.length ?? 0) >= MIN_OFFERING_TEXT).slice(0, 8) : [];
  const aboutUseful = !!i.about.intro && i.about.intro.length >= 80 && (i.about.team || !!i.about.years || i.about.trust > 0 || i.about.reviews >= 2);
  const contactUseful = i.contact.address || i.contact.hours;
  // enough distinct content for more than one page: a real offerings list plus somewhere to visit or more to say
  const autoMulti = offerings.length >= 4 && contactUseful && (itemPages.length >= 2 || aboutUseful || offerings.length >= 6);
  const mode = i.mode ?? (i.previous?.modeSource === 'owner' ? i.previous.mode : autoMulti ? 'multi' : 'single');
  const pages: SitePage[] = [{ id: 'home', type: 'home', route: '' }];
  if (mode === 'multi') {
    if (offerings.length) pages.push({ id: 'offerings', type: 'offerings', route: `${o.route}/`, navLabel: o.label });
    for (const x of itemPages) pages.push({ id: `offering:${x.id}`, type: 'offering', route: `${o.route}/${x.id}/`, offeringId: x.id });
    if (aboutUseful) pages.push({ id: 'about', type: 'about', route: 'about/', navLabel: 'About' });
    pages.push({ id: 'contact', type: 'contact', route: 'contact/', navLabel: 'Contact' });
  }
  // a page that existed in the previous plan and no longer does redirects to its closest replacement
  const redirects = [...(i.previous?.redirects ?? [])];
  for (const p of i.previous?.pages ?? []) {
    if (pages.some((n) => n.route === p.route) || redirects.some((r) => r.from === p.route)) continue;
    const to = p.type === 'offering' ? (pages.find((n) => n.type === 'offerings')?.route ?? '') : '';
    if (p.route) redirects.push({ from: p.route, to });
  }
  return {
    version: SITE_PLAN_VERSION, mode, modeSource: i.mode ? 'owner' : i.previous?.modeSource === 'owner' ? 'owner' : 'auto', pages,
    overrides: i.previous?.overrides ?? {}, redirects: redirects.filter((r) => !pages.some((p) => p.route === r.from)),
  };
}

export function validateSitePlan(raw: unknown): { ok: true; plan: SitePlan } | { ok: false; errors: string[] } {
  const r = sitePlanSchema.safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) };
  const routes = r.data.pages.map((p) => p.route);
  if (new Set(routes).size !== routes.length) return { ok: false, errors: ['two pages share a route'] };
  if (r.data.pages[0].type !== 'home' || r.data.pages[0].route !== '') return { ok: false, errors: ['the first page must be home at the root'] };
  return { ok: true, plan: r.data };
}

/** depth of a route ("" → 0, "services/" → 1, "services/x/" → 2) */
export const routeDepth = (r: string) => r.split('/').filter(Boolean).length;
/** a relative link from one route to another ("services/x/" → "" is "../../") */
export const relLink = (from: string, to: string, hash = '') => `${'../'.repeat(routeDepth(from)) || (to ? '' : './')}${to}${hash}`;
