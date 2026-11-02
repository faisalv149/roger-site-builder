import { createHash } from 'node:crypto';
import { config } from './config.js';
import { deletePublish, getPublish, savePublish, type PublishRecord } from './store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listOut } from './files.js';
import { composeModel, ensureLocalSite, findDraft, type DraftRecord } from './drafts.js';
import { isFamilyV2 } from './render/families.js';
import { renderSiteFiles, sitePlanFor } from './site-render.js';
import { writeOgCard } from './render/og.js';
import { publishReadiness } from './design/content.js';
import type { SeoContext } from './seo.js';

/**
 * Publish a finished site (out/sites/<slug>/) to Vercel as its own static project, e.g. roger-baked-lahore.vercel.app.
 * Vercel's REST flow: upload each file by SHA-1 (POST /v2/files), create a production deployment that lists the files
 * (POST /v13/deployments), wait until it's READY. Re-publishing only uploads files Vercel doesn't already have.
 * The builder keeps running elsewhere: the published site's lead form still posts to it.
 */
const TEXT = /\.(html|css|js|json|svg|txt|xml|webmanifest)$/i;
const SKIP = new Set(['site.json']); // the builder's own record (raw Google data); not part of the site
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const publishEnabled = () => !!config.vercelToken;

/** Vercel project names: lowercase letters, digits, ".", "_", "-", up to 100 characters, no "---". */
export function projectName(slug: string): string {
  return `${config.vercelProjectPrefix}${slug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').slice(0, 100).replace(/^[-._]+|[-._]+$/g, '');
}

/** Links the site makes to itself point at the builder; on Vercel they point at the published domain. The lead form endpoint (builder /api/leads) is left alone. */
export function rewriteForPublish(text: string, slug: string, domain: string): string {
  return text.split(`${config.publicBaseUrl}/sites/${slug}/`).join(`https://${domain}/`);
}

// the site's files from this disk or, on Vercel, from Redis (it may have been built on another instance)
async function siteFiles(slug: string, domain: string): Promise<{ file: string; data: Buffer }[]> {
  return (await listOut(`sites/${slug}`))
    .filter((f) => !SKIP.has(f.file))
    .map((f) => (TEXT.test(f.file) ? { file: f.file, data: Buffer.from(rewriteForPublish(f.data.toString('utf8'), slug, domain)) } : f));
}

async function vercel(route: string, init: RequestInit = {}): Promise<any> {
  const team = config.vercelTeamId ? `${route.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(config.vercelTeamId)}` : '';
  let r: Response | undefined;
  for (let attempt = 1; !r; attempt++) {
    try {
      r = await fetch(`${config.vercelApi}${route}${team}`, {
        ...init,
        headers: { authorization: `Bearer ${config.vercelToken}`, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      // retry only when the connection never opened (nothing reached Vercel, so even a POST is safe to repeat)
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (attempt >= 3 || !['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code || '')) throw new Error(`Could not reach Vercel: ${code || (e as Error).message}`);
      await sleep(1000 * attempt);
    }
  }
  const body = await r.text();
  let j: any = {};
  try { j = body ? JSON.parse(body) : {}; } catch { j = { message: body.slice(0, 200) }; }
  if (!r.ok) throw new Error(`Vercel ${r.status}: ${j?.error?.message || j?.message || 'request failed'}`);
  return j;
}

async function deploy(name: string, files: { file: string; data: Buffer }[]): Promise<any> {
  const refs: { file: string; sha: string; size: number }[] = [];
  for (let i = 0; i < files.length; i += 6) { // a few uploads at a time
    await Promise.all(files.slice(i, i + 6).map(async (f) => {
      const sha = createHash('sha1').update(f.data).digest('hex');
      await vercel('/v2/files', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-vercel-digest': sha }, body: new Uint8Array(f.data) });
      refs.push({ file: f.file, sha, size: f.data.length });
    }));
  }
  const created = await vercel('/v13/deployments?skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // plain static files: no framework, no build step
    body: JSON.stringify({ name, files: refs, target: 'production', projectSettings: { framework: null, buildCommand: null, installCommand: null, devCommand: null, outputDirectory: null } }),
  });
  let d = created;
  const t0 = Date.now();
  while (d.readyState !== 'READY' || d.aliasAssigned === false) {
    if (d.readyState === 'ERROR' || d.readyState === 'CANCELED') throw new Error(`Vercel deployment ${d.readyState.toLowerCase()}${d.errorMessage ? `: ${d.errorMessage}` : ''}`);
    if (Date.now() - t0 > 180_000) throw new Error('Vercel deployment did not finish within 3 minutes');
    await sleep(1500);
    d = await vercel(`/v13/deployments/${encodeURIComponent(created.id)}`);
  }
  return d;
}

// The production domain (name.vercel.app or a custom domain). The deployment's own URL can sit behind Vercel's
// deployment protection, so it is only the last resort.
function productionDomain(d: any, name: string): string {
  const aliases: string[] = Array.isArray(d.alias) ? d.alias : [];
  return aliases.find((a) => a === `${name}.vercel.app`) || aliases.find((a) => !a.endsWith('.vercel.app')) || aliases[0] || d.url;
}

export class PublishBlocked extends Error {
  status = 422;
  constructor(message: string, public blockers: { key: string; message: string }[]) { super(message); }
}

/**
 * The files of a publication: rendered for the primary origin, indexable, without the draft banner, with Google's
 * photos and review text left out (they stay in the preview), robots.txt, sitemap.xml, a 404 page and vercel.json
 * (trailing-slash URLs, permanent redirects for retired routes and earlier domains). Only assets the pages
 * actually reference are included.
 */
export async function publicationFiles(d: DraftRecord, origin: string, rec?: PublishRecord): Promise<{ file: string; data: Buffer }[]> {
  await ensureLocalSite(d.slug);
  const model = await composeModel(d.base, d.plan, { appearance: d.appearance, offerings: d.offerings, content: d.content, publishing: true });
  model.urls = { ...model.urls, site: `${origin}/`, og: `${origin}/og.jpg` };
  const sp = isFamilyV2(model) ? (d.sitePlan ?? sitePlanFor(model)) : undefined;
  const ctx: SeoContext = { base: origin, state: 'published', indexable: true, lang: model.theme.locale.split('-')[0], lastmod: d.savedAt };
  const siteDir = path.join(config.dirs.sites, d.slug);
  // the share image: the published hero (the owner's own photo) or none
  const heroPath = model.design?.heroImages?.desktop.publicPath ?? model.design?.slides[0]?.desktop.publicPath;
  let og: Buffer | undefined;
  if (heroPath && fs.existsSync(path.join(siteDir, heroPath))) {
    const tmp = path.join(os.tmpdir(), `og-${d.id}-${Date.now()}.jpg`);
    await writeOgCard(tmp, { heroFile: path.join(siteDir, heroPath), name: model.business.name, line2: model.business.primaryTypeLabel, line3: [model.business.city, model.business.state].filter(Boolean).join(', '), brand: model.brand.brand, ink: model.brand.brandInk });
    og = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
  }
  const rendered = renderSiteFiles(model, sp, ctx, { ogImage: og ? `${origin}/og.jpg` : null });
  const vercelJson = {
    trailingSlash: true,
    redirects: [
      ...(sp?.redirects ?? []).map((r) => ({ source: `/${r.from}`, destination: `/${r.to}`, permanent: true })),
      ...(rec?.primaryDomain ? (rec.previousDomains ?? []).filter((h) => h !== rec.primaryDomain).map((h) => ({ source: '/(.*)', has: [{ type: 'host', value: h }], destination: `${origin}/$1`, permanent: true })) : []),
    ],
  };
  const files: { file: string; data: Buffer }[] = rendered.map((f) => ({ file: f.file, data: Buffer.from(f.content) }));
  files.push({ file: 'vercel.json', data: Buffer.from(JSON.stringify(vercelJson, null, 2)) });
  if (og) files.push({ file: 'og.jpg', data: og });
  // only what the pages use: assets referenced in the HTML, plus the icons
  const referenced = new Set<string>(['favicon.svg', 'apple-touch-icon.png']);
  for (const f of rendered) for (const m of f.content.matchAll(/(?:\.\.\/)*(assets\/[A-Za-z0-9._-]+)/g)) referenced.add(m[1]);
  for (const rel of referenced) {
    const abs = path.join(siteDir, rel);
    if (fs.existsSync(abs)) files.push({ file: rel, data: fs.readFileSync(abs) });
  }
  return files;
}

/** The hosted address Vercel gives a project, used as the primary origin until a custom domain is verified. */
const hostedOrigin = (name: string) => `https://${name}.vercel.app`;

/**
 * Publish a site. Sites with a draft go through the publication checks (reviewed facts, no sample content,
 * confirmed prices) and are rendered for the primary origin; the files are kept per revision.
 */
export async function publishSite(slug: string): Promise<PublishRecord> {
  if (!publishEnabled()) throw new Error('Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).');
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) throw Object.assign(new Error(`No built site "${slug}"`), { status: 404 });
  const d = await findDraft({ slug });
  if (!d) {
    const exists = (await siteFiles(slug, 'x')).some((f) => f.file === 'index.html');
    if (!exists) throw Object.assign(new Error(`No built site "${slug}"`), { status: 404 });
    throw new PublishBlocked('This site was built before business details could be reviewed. Rebuild it, have the owner review the details, then publish.', [{ key: 'content', message: 'No reviewed business details' }]);
  }
  const blockers = publishReadiness(d.content, d.offerings).filter((x) => x.level === 'blocker');
  if (blockers.length) throw new PublishBlocked(`Not ready to publish: ${blockers.length} item${blockers.length === 1 ? '' : 's'} to review.`, blockers);
  const name = projectName(slug);
  const rec = await getPublish(slug);
  let origin = rec?.primaryDomain ? `https://${rec.primaryDomain}` : rec?.domain ? `https://${rec.domain}` : hostedOrigin(name);
  let files = await publicationFiles(d, origin, rec);
  let dep = await deploy(name, files);
  const actual = productionDomain(dep, name);
  if (!rec?.primaryDomain && `https://${actual}` !== origin) { // Vercel picked another hosted address: canonical URLs follow it
    origin = `https://${actual}`;
    files = await publicationFiles(d, origin, rec);
    dep = await deploy(name, files);
  }
  const host = origin.replace(/^https:\/\//, '');
  const dir = path.join(config.dirs.out, 'publish', slug, `r${d.revision}`);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) { const abs = path.join(dir, f.file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.data); }
  const out: PublishRecord = {
    ...(rec || {}), slug, project: name, domain: host, url: `${origin}/`, deploymentId: dep.id, publishedAt: new Date().toISOString(),
    draftRevision: d.revision, contentRevision: d.content?.revision, files: `publish/${slug}/r${d.revision}`, pages: files.filter((f) => f.file.endsWith('index.html')).length,
  };
  await savePublish(out);
  return out;
}

/**
 * Make a verified custom domain the primary address. The domain must be added to the site's Vercel project and
 * verified there (real DNS); the site is then re-rendered for the new origin (canonical URLs, sitemap, structured
 * data), earlier addresses redirect permanently, and the switch is recorded only after the new address answers.
 * Roger's simulated domain step never calls this.
 */
export async function setPrimaryDomain(slug: string, domain: string, opts: { check?: (url: string) => Promise<number> } = {}): Promise<PublishRecord> {
  if (!publishEnabled()) throw new Error('Publishing is off: set VERCEL_TOKEN.');
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw Object.assign(new Error('Enter a domain like yourbusiness.com'), { status: 400 });
  const rec = await getPublish(slug);
  if (!rec) throw Object.assign(new Error('Publish the site before connecting a domain'), { status: 409 });
  if (rec.primaryDomain === host) return rec;
  // attach (idempotent) and read Vercel's verification state
  await vercel(`/v10/projects/${encodeURIComponent(rec.project)}/domains`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: host }) }).catch((e) => { if (!/already|409/.test((e as Error).message)) throw e; });
  const info = await vercel(`/v9/projects/${encodeURIComponent(rec.project)}/domains/${encodeURIComponent(host)}`);
  if (!info.verified) throw Object.assign(new Error(`${host} isn't verified on Vercel yet. Add the DNS records Vercel shows for it, then try again.`), { status: 409, verification: info.verification });
  const previous = [...new Set([...(rec.previousDomains ?? []), rec.primaryDomain ?? rec.domain].filter((h): h is string => !!h && h !== host))];
  const d = await findDraft({ slug });
  if (!d) throw Object.assign(new Error('No draft for this site'), { status: 404 });
  const next: PublishRecord = { ...rec, primaryDomain: host, previousDomains: previous };
  const files = await publicationFiles(d, `https://${host}`, next);
  const dep = await deploy(rec.project, files);
  // switch only once the new primary serves the site
  const status = await (opts.check ?? ((u) => fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).then((r) => r.status, () => 0)))(`https://${host}/`);
  if (status !== 200) throw Object.assign(new Error(`https://${host}/ isn't serving the site yet (status ${status || 'no answer'}). The previous address stays primary.`), { status: 409 });
  const out: PublishRecord = { ...next, domain: host, url: `https://${host}/`, deploymentId: dep.id, publishedAt: new Date().toISOString(), draftRevision: d.revision, contentRevision: d.content?.revision };
  await savePublish(out);
  return out;
}

/**
 * Take a published site offline: delete its Vercel project (the live URL stops working) and forget the publish.
 * Only the project Roger recorded for this site is touched, and only if it carries Roger's name for it.
 */
export async function unpublishSite(slug: string): Promise<{ slug: string; project: string; removed: boolean }> {
  if (!publishEnabled()) throw new Error('Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).');
  const rec = /^[a-z0-9-]{1,100}$/.test(slug) ? await getPublish(slug) : undefined;
  if (!rec) throw Object.assign(new Error(`"${slug}" is not published`), { status: 404 });
  if (rec.project !== projectName(slug)) throw Object.assign(new Error(`Refusing to delete Vercel project "${rec.project}": it isn't Roger's project for "${slug}"`), { status: 400 });
  let removed = true;
  try {
    await vercel(`/v9/projects/${encodeURIComponent(rec.project)}`, { method: 'DELETE' });
  } catch (e) {
    if (!/^Vercel 404/.test((e as Error).message)) throw e; // already gone on Vercel's side: just forget it
    removed = false;
  }
  await deletePublish(slug);
  return { slug, project: rec.project, removed };
}
