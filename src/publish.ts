import { createHash } from 'node:crypto';
import { config } from './config.js';
import { deletePublish, getPublish, savePublish, type PublishRecord } from './store.js';
import { listOut } from './files.js';

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

export async function publishSite(slug: string): Promise<PublishRecord> {
  if (!publishEnabled()) throw new Error('Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).');
  const exists = /^[a-z0-9-]{1,100}$/.test(slug) && (await siteFiles(slug, 'x')).some((f) => f.file === 'index.html');
  if (!exists) throw Object.assign(new Error(`No built site "${slug}"`), { status: 404 });
  const name = projectName(slug);
  let domain = (await getPublish(slug))?.domain || `${name}.vercel.app`; // best guess before the first deployment
  let d = await deploy(name, await siteFiles(slug, domain));
  const actual = productionDomain(d, name);
  if (actual !== domain) { // Vercel picked another domain: fix the self-links (only index.html changes, the rest dedupes)
    domain = actual;
    d = await deploy(name, await siteFiles(slug, domain));
  }
  const rec: PublishRecord = { slug, project: name, domain, url: `https://${domain}/`, deploymentId: d.id, publishedAt: new Date().toISOString() };
  await savePublish(rec);
  return rec;
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
