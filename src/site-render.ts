import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { SiteModel } from './content/model.js';
import { renderPage } from './render/page.js';
import { isFamilyV2, renderFamilyPage, renderNotFound } from './render/families.js';
import { buildSitePlan, routeDepth, validateSitePlan, type SitePlan } from './design/siteplan.js';
import { pageSeo, robotsTxt, sitemapXml, type SeoContext } from './seo.js';

/**
 * Writing a site's pages: every route of the SitePlan as <route>/index.html, a real 404.html, and robots.txt.
 * sitemap.xml only exists for an indexable publication. Version 1 families and legacy themes stay one page
 * (src/render/page.ts). The same function serves builds, owner saves and publishing (with a different SeoContext).
 */
export interface SiteFile { file: string; content: string }

/** The SitePlan for a composed model: deterministic from what the business actually has. */
export function sitePlanFor(m: SiteModel, opts: { previous?: unknown; mode?: 'single' | 'multi' } = {}): SitePlan {
  const prev = opts.previous ? validateSitePlan(opts.previous) : undefined;
  const d = m.design!;
  return buildSitePlan({
    category: d.plan.category,
    offerings: d.offerings.map((o) => ({ id: o.id, name: o.name, description: o.description })),
    about: { intro: d.intro, team: !!d.team, years: m.facts.years, trust: m.trust.length, reviews: m.proof.quotes.length },
    contact: { address: !!m.contact.address, hours: m.hours.rows.length > 0, phone: !!m.contact.phone },
    mode: opts.mode,
    previous: prev?.ok ? prev.plan : undefined,
  });
}

/** Where a preview lives on this server. */
export const previewContext = (slug: string, lang = 'en'): SeoContext => ({ base: `${config.publicBaseUrl}/sites/${slug}`, state: 'preview', indexable: false, lang });

export function renderSiteFiles(m: SiteModel, sp: SitePlan | undefined, ctx: SeoContext, opts: { ogImage?: string | null } = {}): SiteFile[] {
  if (!m.design || !isFamilyV2(m) || !sp) {
    // a single-page (version 1 or theme) site: the same robots/sitemap rules
    const out: SiteFile[] = [{ file: 'index.html', content: renderPage(m) }, { file: 'robots.txt', content: robotsTxt(ctx) }];
    const one = sitemapXml(ctx, { version: 1, mode: 'single', modeSource: 'auto', pages: [{ id: 'home', type: 'home', route: '' }], overrides: {}, redirects: [] });
    if (one) out.push({ file: 'sitemap.xml', content: one });
    return out;
  }
  const images = [m.images.hero?.publicPath].filter((p) => p && !m.images.heroIsStock) as string[];
  const og = opts.ogImage === null ? undefined : opts.ogImage ?? `${ctx.base}/og.jpg`;
  const files: SiteFile[] = sp.pages.map((p) => ({ file: `${p.route}index.html`, content: renderFamilyPage(m, sp, p, pageSeo(m, sp, p, ctx, { ogImage: og, images })) }));
  files.push({ file: '404.html', content: renderNotFound(m, sp, { ...pageSeo(m, sp, sp.pages[0], ctx), robots: 'noindex' }) });
  files.push({ file: 'robots.txt', content: robotsTxt(ctx) });
  const sitemap = sitemapXml(ctx, sp);
  if (sitemap) files.push({ file: 'sitemap.xml', content: sitemap });
  return files;
}

/** Write the files into a site folder, removing routes (and a sitemap) the new plan no longer has. */
export function writeSiteFiles(dir: string, files: SiteFile[], previous?: SitePlan): void {
  const keep = new Set(files.map((f) => f.file));
  for (const p of previous?.pages ?? []) {
    if (!p.route || keep.has(`${p.route}index.html`)) continue;
    fs.rmSync(path.join(dir, p.route), { recursive: true, force: true });
  }
  if (!keep.has('sitemap.xml')) fs.rmSync(path.join(dir, 'sitemap.xml'), { force: true });
  for (const f of files) {
    const abs = path.join(dir, f.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
}

export const pageDepth = routeDepth;
