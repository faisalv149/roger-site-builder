import { load } from 'cheerio';
import { aiJson, type AiTransport, type CostLedger } from '../concepts/ai.js';
import { FRONTEND_PROMPT, checkCode, compilePage, cssProblems, type CompileOptions, type FrontendCode, type FrontendInput, type PageLink } from './page.js';

/**
 * The custom full site: the homepage Claude designed, plus inner pages chosen from the business's own sourced content and
 * written in the same visual language (the homepage's CSS, header and footer). Each page goes through the same factual,
 * media, link and safety checks as the homepage, with the facts that page exists to show, and every page links every
 * page. No theme, category template or old renderer is involved.
 */

/** an inner page: why it exists (the content behind it), the facts it must show, and how many verified photos */
export interface SitePage extends PageLink { purpose: string; required: string[]; minPhotos: number; requireAction: boolean }
export interface SiteCode { css: string; pages: { slug: string; html: string }[] }

/**
 * Which inner pages the business's content supports, at most four, in this order: its offerings (every one it lists),
 * its own story, its checked photos, and how to visit. A page with nothing sourced behind it is not made.
 */
export function planPages(input: FrontendInput): SitePage[] {
  const pages: SitePage[] = [];
  const offerings = Object.keys(input.facts).filter((k) => k.startsWith('item-') || k.startsWith('service-'));
  if (offerings.length >= 4) {
    const menu = input.items.length >= input.services.length;
    pages.push({ slug: menu ? 'menu' : 'services', title: menu ? 'Menu' : 'Services', purpose: `every offering the business lists (${offerings.length}), grouped the way its source groups them`, required: ['name', ...offerings], minPhotos: 0, requireAction: false });
  }
  if (input.facts.story || input.ownLines.length >= 4) pages.push({ slug: 'about', title: 'About', purpose: "the business's own story and words", required: ['name', ...(input.facts.story ? ['story'] : [])], minPhotos: input.photos.length ? 1 : 0, requireAction: false });
  if (input.photos.length >= 6) pages.push({ slug: 'photos', title: 'Photos', purpose: 'its checked photos, each a deliberate part of the page (credits are added by Roger)', required: ['name'], minPhotos: Math.min(input.photos.length, 12), requireAction: false });
  pages.push({ slug: 'visit', title: 'Visit', purpose: 'how to find, reach and visit the business', required: ['name', ...['address', 'hours', 'phone', 'rating'].filter((k) => input.facts[k])], minPhotos: 0, requireAction: true });
  return pages.slice(0, 4);
}

export const SITE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['css', 'pages'],
  properties: {
    css: { type: 'string', maxLength: 20000 },
    pages: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['slug', 'html'], properties: { slug: { type: 'string', maxLength: 24 }, html: { type: 'string', maxLength: 50000 } } } },
  },
};

export const SITE_PROMPT = `You are completing a business website whose homepage has already been designed and coded. Write the listed inner pages in the SAME visual language: reuse the homepage's CSS classes, typography, palette, spacing and details. Add only the CSS these pages need, in css (it is appended after the homepage CSS; do not restate it).
Each page's html is a body fragment: the same header and navigation as the homepage, then one main with exactly one h1 suited to that page, then the same footer. The navigation links every page, including home. Give each page a composition that suits its content (a menu is not a gallery); do not repeat the homepage's hero.
Return JSON {css, pages:[{slug, html}]}, one entry per listed page, in the listed order, without code fences.
` + FRONTEND_PROMPT.slice(FRONTEND_PROMPT.indexOf('DATA BINDINGS'));

/** the homepage's header and footer, which every inner page repeats */
export function siteFrame(home: FrontendCode): { header: string; footer: string } {
  const $ = load(home.html, {}, false);
  return { header: $.html($('header').first()) ?? '', footer: $.html($('footer').last()) ?? '' };
}

/** every problem with the inner pages: the listed pages, the shared CSS, and each page's own checks */
export function checkSite(site: SiteCode, home: FrontendCode, input: FrontendInput, plan: SitePage[], rev?: number): string[] {
  const errors: string[] = [];
  const slugs = site.pages.map((p) => p.slug);
  if (slugs.join() !== plan.map((p) => p.slug).join()) errors.push(`Return exactly these pages, in this order: ${plan.map((p) => p.slug).join(', ')} (got ${slugs.join(', ') || 'none'}).`);
  errors.push(...cssProblems(site.css));
  for (const page of plan) {
    const html = site.pages.find((p) => p.slug === page.slug)?.html;
    if (!html) continue;
    errors.push(...checkCode({ idea: '', html, css: '', fonts: home.fonts }, input, { pages: plan, required: page.required, minPhotos: page.minPhotos, requireAction: page.requireAction, page: page.slug, ...(rev ? { rev } : {}) }).map((e) => `${page.slug} page: ${e}`));
  }
  return [...new Set(errors)];
}

/** one call (and at most one repair) for every inner page, given the homepage as the visual language to keep */
export async function generateSitePages(input: FrontendInput, home: FrontendCode, plan: SitePage[], ledger: CostLedger, transport: AiTransport, earlier?: string, rev?: number) {
  const brief = { ...input, photos: input.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, subject: p.seen || p.alt })), actions: input.actions.map((a) => ({ id: a.id, label: a.label, kind: a.kind })) };
  const frame = siteFrame(home);
  return aiJson<SiteCode>({
    stage: 'frontend:pages-v1', system: SITE_PROMPT, output: 'json', schema: SITE_SCHEMA, maxOutputTokens: 16000,
    prompt: [
      `Design brief:\n${JSON.stringify(brief)}`,
      `Pages to write (slug, navigation label, what it is for, facts it must show with data-fact, verified photos it must use, whether it needs an action):\n${JSON.stringify(plan)}`,
      `The homepage's visual idea: ${home.idea}`,
      `The homepage's header (repeat it on every page):\n${frame.header}`,
      `The homepage's footer (repeat it on every page):\n${frame.footer}`,
      `The homepage's CSS (reuse its classes; add only what is new):\n${home.css}`,
      // a resumed attempt: what the last run's pages were rejected for, quoted (this also makes it a new request, so a
      // cached failed answer is never replayed)
      ...(earlier ? [`An earlier attempt at these pages was rejected:\n${earlier}\nDo not repeat that text; follow the instructions in the rejection.`] : []),
      'Write the inner pages now.',
    ].join('\n\n'),
  }, { transport, ledger, retries: 1, fieldRepair: false, validate: (site) => checkSite(site, home, input, plan, rev) });
}

/**
 * Every page of a version, compiled: the homepage and each inner page with the shared CSS, page links resolved with
 * pageHref, the owner's edits applied by key, and the version stamped on each page.
 */
export function compileSite(home: FrontendCode, site: SiteCode | undefined, input: FrontendInput, plan: SitePage[] | undefined, opts: Pick<CompileOptions, 'pageHref' | 'edits' | 'version' | 'rev'> = {}): Record<string, string> {
  const pages = plan?.length ? plan : undefined;
  const out: Record<string, string> = { home: compilePage(home, input, { ...opts, ...(pages ? { pages } : {}), page: 'home' }) };
  for (const page of pages ?? []) {
    const html = site?.pages.find((p) => p.slug === page.slug)?.html;
    if (!html) throw new Error(`The ${page.slug} page is missing from this version.`);
    out[page.slug] = compilePage({ idea: home.idea, html, css: home.css, fonts: home.fonts }, input, { ...opts, pages, page: page.slug, title: page.title, required: page.required, minPhotos: page.minPhotos, requireAction: page.requireAction, extraCss: site!.css });
  }
  return out;
}
