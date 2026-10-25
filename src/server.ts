// first: fonts for the generated images must be set up before sharp draws anything (src/fonts.ts)
import { textRendering } from './fonts.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { loadThemes, saveCustomTheme, validateTheme, getTheme } from './theme/load.js';
import { SUPPORTED_VARIANTS } from './theme/schema.js';
import { searchCandidates } from './sources/places.js';
import { confirmBusinessCard } from './imessage/cards.js';
import { runAudit, type BuildInput } from './pipeline.js';
import { getJob, queueDepth, startBuild, waitForJob } from './jobs.js';
import { deleteBuildsForSlug, deleteFailedBuild, deletePublish, getBuild, getConversation, getPublish, listBuilds, listConversations, listLeads, saveLead } from './store.js';
import { handleInbound, isPending, resetSession } from './imessage/flow.js';
import { estimateBuild } from './estimate.js';
import { screenshotsAvailable } from './render/og.js';
import { publishEnabled, publishSite, unpublishSite } from './publish.js';
import { deleteOut, readOut } from './files.js';
import { remote } from './remote.js';
import { claudeEnabled, claudeKeyStatus, claudeVia } from './content/claude.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
// With memory storage multer only fails on bad client input (oversized file, malformed multipart): answer 4xx, not 500.
const themeUpload = (req: Request, res: Response, next: NextFunction) => upload.single('theme')(req, res, (err?: unknown) => {
  if (!err) return next();
  res.status(err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: (err as Error).message });
});
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// ── password (STUDIO_PASSWORD) on the Studio, the API and the iMessage page. Generated sites, cards, reports and
// stock images stay public (owners, site visitors and iMessage link previews fetch them), as do the lead form
// endpoint the sites post to and the health check the host pings.
const OPEN = /^\/(sites|cards|reports|stock|demo-sites)\/|^\/api\/health$/;
// sites post their quote form here from any origin; reading leads (GET) still needs the password
const isLeadPost = (req: Request) => /^\/api\/leads\/[^/]+$/.test(req.path) && (req.method === 'POST' || req.method === 'OPTIONS');
const sha = (s: string) => createHash('sha256').update(s).digest();
app.use((req, res, next) => {
  if (!config.studioPassword || OPEN.test(req.path) || isLeadPost(req)) return next();
  const [scheme, b64] = (req.headers.authorization || '').split(' ');
  const given = scheme === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
  if (given && timingSafeEqual(sha(given), sha(`${config.studioUser}:${config.studioPassword}`))) return next();
  res.set('WWW-Authenticate', 'Basic realm="Roger Studio", charset="UTF-8"').status(401).send('Password required');
});

// ── static ──
app.use('/app', express.static(path.join(config.dirs.public, 'app')));
app.use('/imessage', express.static(path.join(config.dirs.public, 'imessage'))); // stand-in iMessage UI for local demos (no gateway)
app.use('/stock', express.static(path.join(config.dirs.public, 'stock'), { maxAge: '7d' }));
app.use('/sites', express.static(config.dirs.sites));
app.use('/reports', express.static(config.dirs.reports));
app.use('/cards', express.static(config.dirs.cards));
app.use('/demo-sites', express.static(path.join(config.dirs.fixtures, 'sites'))); // the deliberately outdated demo site
app.get('/', (_req, res) => res.redirect('/app/')); // on Vercel public/ is served by its CDN, not by Express
// generated files, also when they were built on another server instance (src/files.ts)
app.get(/^\/(sites|cards|reports)\/.*/, wrap(async (req, res) => {
  let rel = decodeURIComponent(req.path).slice(1);
  if (rel.split('/').includes('..')) return res.status(400).end();
  if (rel.endsWith('/')) rel += 'index.html';
  else if (!path.extname(rel)) return res.redirect(301, `${req.path}/`);
  const data = await readOut(rel);
  if (!data) return res.status(404).send('Not found');
  res.type(path.extname(rel)).set('cache-control', 'public, max-age=60').send(data);
}));

// ── meta ──
app.get('/api/health', wrap(async (_req, res) => {
  res.json({ ok: true, mock: config.mock, claude: claudeEnabled(), claudeVia: claudeVia(), model: config.anthropicModel, screenshots: screenshotsAvailable(), themes: loadThemes().size, publicBaseUrl: config.publicBaseUrl, publish: publishEnabled() ? 'vercel' : null, vercel: !!process.env.VERCEL, storage: remote?.name ?? 'disk', fonts: await textRendering(), claudeKey: claudeVia() === 'api' ? await claudeKeyStatus() : undefined });
}));
// how long a build will take: ?website=1 (the business has a site to scan) &audit=1 (audit it during the build)
app.get('/api/estimate', (req, res, next) => {
  const on = (v: unknown) => v === '1' || v === 'true';
  estimateBuild({ website: on(req.query.website), audit: on(req.query.audit), queue: queueDepth() }).then((e) => res.json(e), next);
});

// ── themes ──
app.get('/api/themes', (_req, res) => {
  const list = [...loadThemes().values()].map((e) => ({
    id: e.id, name: e.name, vertical: e.vertical, variant: e.variant, origin: e.origin,
    brand: e.theme.palette.brand, grid: e.theme.grid.system, sections: e.theme.sections, description: e.theme.meta.description, warnings: e.warnings,
  }));
  list.sort((a, b) => a.vertical.localeCompare(b.vertical) || a.variant.localeCompare(b.variant));
  res.json({ themes: list, supportedVariants: SUPPORTED_VARIANTS });
});
app.get('/api/themes/:id', (req, res) => {
  const e = getTheme(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(e.theme);
});
function readThemeBody(req: Request): unknown {
  const f = (req as any).file as Express.Multer.File | undefined;
  if (f) return JSON.parse(f.buffer.toString('utf8'));
  return req.body?.theme ?? req.body;
}
app.post('/api/themes/validate', themeUpload, (req, res) => {
  try { const { theme: _t, ...v } = validateTheme(readThemeBody(req)); res.json(v); } catch (e) { res.status(400).json({ ok: false, errors: [`Not valid JSON: ${(e as Error).message}`], warnings: [] }); }
});
app.post('/api/themes', themeUpload, (req, res) => {
  try {
    const r = saveCustomTheme(readThemeBody(req));
    res.status(r.ok ? 201 : 400).json(r);
  } catch (e) { res.status(400).json({ ok: false, errors: [`Not valid JSON: ${(e as Error).message}`], warnings: [] }); }
});

// ── Roger step 1: find the business + "Is this you?" card ──
app.post('/api/lookup', wrap(async (req, res) => {
  const input = String(req.body.input || req.body.query || '').trim();
  if (!input) return res.status(400).json({ error: 'input is required (business name + ZIP, Google Maps link, or place ID)' });
  const { intent, candidates } = await searchCandidates(input, { zip: req.body.zip, limit: Number(req.body.limit) || 5 });
  const card = candidates[0] ? await confirmBusinessCard(candidates[0]) : null;
  res.json({ intent, candidates, card });
}));

// ── Roger step 2a: audit an existing website ──
app.post('/api/audit', wrap(async (req, res) => {
  const website = String(req.body.website || '').trim();
  if (!website) return res.status(400).json({ error: 'website is required' });
  res.json(await runAudit({ website, google: req.body.google, placeId: req.body.placeId }));
}));

// ── Roger step 3: build a site (JSON or multipart with a theme file) ──
app.post('/api/build', themeUpload, wrap(async (req, res) => {
  const body = req.body || {};
  const input: BuildInput = {
    google: body.google || undefined,
    placeId: body.placeId || undefined,
    website: body.website || undefined,
    themeId: body.themeId || undefined,
    vertical: body.vertical || undefined,
    variant: body.variant || undefined,
    fonts: body.fonts === 'business' ? 'business' : 'theme',
    brandColor: body.brandColor || undefined,
    preview: body.preview !== 'false' && body.preview !== false,
    audit: body.audit !== 'false' && body.audit !== false,
    slug: body.slug || undefined,
  };
  const file = (req as any).file as Express.Multer.File | undefined;
  if (file) {
    try { input.theme = JSON.parse(file.buffer.toString('utf8')); } catch (e) { return res.status(400).json({ error: `theme.json is not valid JSON: ${(e as Error).message}` }); }
  } else if (body.theme && typeof body.theme === 'object') input.theme = body.theme;
  if (!input.google && !input.placeId) return res.status(400).json({ error: 'google (link, place ID, or name + ZIP) or placeId is required' });
  const job = startBuild(input, { source: body.source === 'studio' ? 'studio' : 'api' });
  if (req.query.wait === '1' || body.wait === true) {
    await waitForJob(job);
    if (job.status === 'error') return res.status(500).json({ jobId: job.id, error: job.error, events: job.events });
    return res.json({ jobId: job.id, ...job.result });
  }
  res.status(202).json({ jobId: job.id, status: job.status, events: `/api/jobs/${job.id}/events` });
}));

app.get('/api/jobs/:id', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'not found' });
  res.json({ id: j.id, status: j.status, events: j.events, result: j.result, error: j.error });
});
app.get('/api/jobs/:id/events', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const e of j.events) send('step', e);
  if (j.status === 'done' || j.status === 'error') { send('end', { status: j.status, result: j.result, error: j.error }); return res.end(); }
  const onEv = (e: unknown) => send('step', e);
  const onEnd = () => { send('end', { status: j.status, result: j.result, error: j.error }); res.end(); };
  j.bus.on('event', onEv);
  j.bus.once('end', onEnd);
  req.on('close', () => { j.bus.off('event', onEv); j.bus.off('end', onEnd); });
});

// ── leads from generated sites ──
app.options('/api/leads/:slug', (_req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }).sendStatus(204); });
app.post('/api/leads/:slug', wrap(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const slug = req.params.slug.replace(/[^a-z0-9-]/g, '');
  const b = req.body || {};
  if (b.company_website) return res.json({ ok: true }); // honeypot
  if (!b.name || !b.phone) return res.status(400).json({ error: 'name and phone are required' });
  const lead = { slug, at: new Date().toISOString(), name: String(b.name).slice(0, 120), phone: String(b.phone).slice(0, 40), email: b.email ? String(b.email).slice(0, 160) : undefined, zip: b.zip ? String(b.zip).slice(0, 10) : undefined, service: b.service ? String(b.service).slice(0, 120) : undefined, message: b.message ? String(b.message).slice(0, 2000) : undefined, page: b.page };
  await saveLead(lead); // data/leads locally, Supabase/Redis on Vercel
  // awaited (with a timeout): on Vercel the function may stop right after the response
  if (config.leadWebhook) await fetch(config.leadWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead), signal: AbortSignal.timeout(8000) }).catch((e) => console.warn('[lead webhook]', e.message));
  if (req.is('application/json')) return res.json({ ok: true });
  res.redirect(303, `${String(req.get('referer') || `/sites/${slug}/`).split('#')[0]}#quote`);
}));
// reading leads (names, phone numbers) needs the Studio password; only sending one is open
app.get('/api/leads/:slug', wrap(async (req, res) => {
  res.json({ leads: await listLeads(String(req.params.slug).replace(/[^a-z0-9-]/g, '')) });
}));

// ── iMessage reference flow (your gateway posts inbound texts here) ──
app.post('/api/imessage/inbound', wrap(async (req, res) => {
  const from = String(req.body.from || 'demo');
  const text = String(req.body.text || '');
  // async: true → "On it, about 20 seconds" now, the preview later (see handleInbound)
  res.json(await handleInbound(from, text, { async: req.body.async === true || req.body.async === 'true' }));
}));
app.post('/api/imessage/reset', wrap(async (req, res) => { await resetSession(String(req.body.from || 'demo')); res.json({ ok: true }); }));

// ── saved history (data/builds, data/conversations). No auth: fine locally, add it before this is public. ──
app.get('/api/builds', wrap(async (_req, res) => res.json({ builds: await listBuilds() })));
// put a built site live on Vercel as its own static project (VERCEL_TOKEN); re-publishing updates it
app.post('/api/sites/:slug/publish', wrap(async (req, res) => {
  if (!publishEnabled()) return res.status(400).json({ error: 'Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).' });
  res.json(await publishSite(String(req.params.slug)));
}));
// take it offline again: deletes that site's Vercel project (the live URL stops working)
app.delete('/api/sites/:slug/publish', wrap(async (req, res) => {
  if (!publishEnabled()) return res.status(400).json({ error: 'Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).' });
  res.json(await unpublishSite(String(req.params.slug)));
}));
// is it on Vercel? (the Studio's build summary shows Publish / Live / Unpublish from this)
app.get('/api/sites/:slug/publish', wrap(async (req, res) => {
  const p = await getPublish(String(req.params.slug));
  res.json(p ? { published: true, url: p.url, publishedAt: p.publishedAt, project: p.project } : { published: false });
}));
// delete a site from Roger: takes it off Vercel first (if published), then its pages, audit report and build history.
// The iMessage conversation that produced it and any leads from its widget are kept.
app.delete('/api/sites/:slug', wrap(async (req, res) => {
  const slug = String(req.params.slug);
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return res.status(400).json({ error: 'bad site name' });
  let unpublished = false;
  if (await getPublish(slug)) {
    if (publishEnabled()) { await unpublishSite(slug); unpublished = true; } // fails → nothing deleted yet
    else await deletePublish(slug);
  }
  const builds = await deleteBuildsForSlug(slug);
  const files = (await deleteOut(`sites/${slug}`)) + (await deleteOut(`reports/${slug}`));
  if (!builds && !files && !unpublished) return res.status(404).json({ error: `No site "${slug}"` });
  res.json({ slug, builds, files, unpublished });
}));
// remove a failed build from the Sites list (finished builds are removed with their site: DELETE /api/sites/:slug)
app.delete('/api/builds/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!/^[\w-]{1,120}$/.test(id)) return res.status(400).json({ error: 'bad build id' }); // ids name files in data/builds
  const r = await deleteFailedBuild(id);
  if (r === 'missing') return res.status(404).json({ error: 'No such build' });
  if (r === 'finished') return res.status(400).json({ error: 'This build made a site: delete the site instead' });
  res.json({ deleted: true });
}));
app.get('/api/builds/:id', wrap(async (req, res) => {
  const b = await getBuild(String(req.params.id));
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
}));
app.get('/api/conversations', wrap(async (_req, res) => res.json({ conversations: await listConversations() })));
app.get('/api/conversations/:from', wrap(async (req, res) => {
  const c = await getConversation(String(req.params.from));
  if (!c) return res.status(404).json({ error: 'not found' });
  const { session: _s, ...rest } = c; // flow internals stay server-side
  res.json({ ...rest, pending: await isPending(c.from) });
}));

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser marks client errors (bad JSON, body too large) with a 4xx status
  if (err.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Vercel runs the exported app as a function; everywhere else this is a normal server
export default app;
if (!process.env.VERCEL) app.listen(config.port, () => {
  console.log(`Roger Site Builder on ${config.publicBaseUrl}  (mock=${config.mock}, claude=${claudeVia() ?? 'off'}, screenshots=${screenshotsAvailable()}, themes=${loadThemes().size}, password=${config.studioPassword ? 'on' : 'off'}, publish=${config.vercelToken ? 'vercel' : 'off'})`);
  if (!config.studioPassword && !/\/\/(localhost|127\.0\.0\.1)\b/.test(config.publicBaseUrl)) console.warn('[security] STUDIO_PASSWORD is not set: anyone who finds this URL can run builds on your API keys and read conversations.');
});
