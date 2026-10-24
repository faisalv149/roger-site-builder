import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { getPublish, savePublish, type PublishRecord } from './store.js';

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

function siteFiles(slug: string, domain: string): { file: string; data: Buffer }[] {
  const root = path.join(config.dirs.sites, slug);
  const out: { file: string; data: Buffer }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const file = path.relative(root, p).split(path.sep).join('/');
      if (SKIP.has(file) || file.endsWith('.tmp')) continue;
      const raw = fs.readFileSync(p);
      out.push({ file, data: TEXT.test(file) ? Buffer.from(rewriteForPublish(raw.toString('utf8'), slug, domain)) : raw });
    }
  };
  walk(root);
  return out;
}

async function vercel(route: string, init: RequestInit = {}): Promise<any> {
  const team = config.vercelTeamId ? `${route.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(config.vercelTeamId)}` : '';
  const r = await fetch(`${config.vercelApi}${route}${team}`, {
    ...init,
    headers: { authorization: `Bearer ${config.vercelToken}`, ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(60_000),
  });
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

export async function publishSite(slug: string): Promise<PublishRecord> {
  if (!publishEnabled()) throw new Error('Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).');
  if (!/^[a-z0-9-]{1,100}$/.test(slug) || !fs.existsSync(path.join(config.dirs.sites, slug, 'index.html'))) throw Object.assign(new Error(`No built site "${slug}"`), { status: 404 });
  const name = projectName(slug);
  let domain = getPublish(slug)?.domain || `${name}.vercel.app`; // best guess before the first deployment
  let d = await deploy(name, siteFiles(slug, domain));
  const actual = productionDomain(d, name);
  if (actual !== domain) { // Vercel picked another domain: fix the self-links (only index.html changes, the rest dedupes)
    domain = actual;
    d = await deploy(name, siteFiles(slug, domain));
  }
  const rec: PublishRecord = { slug, project: name, domain, url: `https://${domain}/`, deploymentId: d.id, publishedAt: new Date().toISOString() };
  savePublish(rec);
  return rec;
}
