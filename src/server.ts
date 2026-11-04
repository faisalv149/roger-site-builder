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
import { lookupCandidates } from './sources/resolve.js';
import { confirmBusinessCard } from './imessage/cards.js';
import { runAudit, type BuildInput } from './pipeline.js';
import { getJob, queueDepth, startBuild, waitForJob } from './jobs.js';
import { deleteBuildsForSlug, deleteFailedBuild, deletePublish, getBuild, getConversation, getPublish, listBuilds, listConversations, listLeads, saveLead, recordLeadDelivery } from './store.js';
import { deliverLead, ownerEmailOf, configuredChannels } from './lead-delivery.js';
import { handleInbound, isPending, resetSession } from './imessage/flow.js';
import { estimateBuild } from './estimate.js';
import { normalizeLead } from './leads.js';
import { personaliseState, startRefinement } from './design/refine.js';
import { screenshotsAvailable } from './render/og.js';
import { publishEnabled, publishSite, setPrimaryDomain, unpublishSite } from './publish.js';
import { findDraft, putDraft } from './drafts.js';
import { publishReadiness } from './design/content.js';
import { deleteOut, readOut } from './files.js';
import { remote } from './remote.js';
import { ownerRoutes, studioDraftRoutes } from './owner-api.js';
import { studioRoutes } from './studio/routes.js';
import { resumeInterruptedJobs } from './studio/jobs.js';
import { shareRoutes } from './studio/concepts/share.js';
import { fillListingPhotos } from './studio/concepts/listing-photos.js';
import { fillGoogleContent, googlePhotoRoute } from './sources/google-live.js';
import { claudeEnabled, claudeKeyStatus, claudeToolMode, claudeVia } from './content/claude.js';

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
// the owner editor (/owner) and its API (/api/owner) use the owner's own key per draft, not the Studio password
// /p/<token>/: a client's preview link for one chosen concept (src/studio/concepts/share.ts)
const OPEN = /^\/(sites|cards|reports|stock|demo-sites|owner|p|gphoto)\/|^\/p\/[a-f0-9]{32}$|^\/api\/health$|^\/api\/owner\/|^\/robots\.txt$/;
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
app.use('/owner', (_req, res, next) => { res.set({ 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN' }); next(); }, express.static(path.join(config.dirs.public, 'owner')));
app.use('/stock', express.static(path.join(config.dirs.public, 'stock'), { maxAge: '7d' }));
// Google listing photos for the page being viewed (never stored), and the page's Google credits and reviews filled
// per view (src/sources/google-live.ts)
app.get('/gphoto/:placeId/:n', wrap(googlePhotoRoute));
app.use('/sites', async (req, res, next) => {
  if (!/(\.html|\/)$/.test(req.path)) return next();
  const rel = decodeURIComponent(req.path) + (req.path.endsWith('/') ? 'index.html' : '');
  if (rel.includes('..')) return next();
  const file = path.join(config.dirs.sites, rel);
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : (await readOut(`sites${rel}`).catch(() => undefined))?.toString('utf8');
  if (!html || !html.includes('⟦g:')) return next();
  res.set({ 'cache-control': 'private, no-store' }).type('html').send(await fillGoogleContent(html));
});
app.use('/sites', express.static(config.dirs.sites));
app.use('/reports', express.static(config.dirs.reports));
app.use('/cards', express.static(config.dirs.cards));
app.use('/demo-sites', express.static(path.join(config.dirs.fixtures, 'sites'))); // the deliberately outdated demo site
app.get('/', (_req, res) => res.redirect('/app/')); // on Vercel public/ is served by its CDN, not by Express
// the builder's own robots.txt: tools and APIs stay out; previews and reports may be fetched so crawlers see their noindex
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /app/\nDisallow: /api/\nDisallow: /owner/\nDisallow: /imessage/\nAllow: /sites/\nAllow: /reports/\n'));
// generated files, also when they were built on another server instance (src/files.ts)
app.get(/^\/(sites|cards|reports)\/.*/, wrap(async (req, res) => {
  let rel = decodeURIComponent(req.path).slice(1);
  if (rel.split('/').includes('..')) return res.status(400).end();
  if (rel.endsWith('/')) rel += 'index.html';
  else if (!path.extname(rel)) return res.redirect(301, `${req.path}/`);
  const data = await readOut(rel);
  if (!data) {
    // a site's own 404 page, with a real 404 status (never the home page with a 200)
    const slug = rel.match(/^sites\/([a-z0-9-]+)\//)?.[1];
    const page = slug ? await readOut(`sites/${slug}/404.html`) : undefined;
    if (page) return res.status(404).type('html').send(page.toString('utf8').replace(/href="\//g, `href="/sites/${slug}/`));
    return res.status(404).send('Not found');
  }
  res.type(path.extname(rel)).set('cache-control', 'public, max-age=60').send(data);
}));

// ── meta ──
app.get('/api/health', wrap(async (_req, res) => {
  res.json({ ok: true, mock: config.mock, claude: claudeEnabled(), claudeVia: claudeVia(), claudeTools: claudeToolMode(), model: config.anthropicModel, screenshots: screenshotsAvailable(), themes: loadThemes().size, publicBaseUrl: config.publicBaseUrl, publish: publishEnabled() ? 'vercel' : null, vercel: !!process.env.VERCEL, storage: remote?.name ?? 'disk', pagespeed: !config.pagespeed ? 'off' : process.env.PAGESPEED_API_KEY ? 'key' : config.pagespeedKey ? 'maps-key' : 'no-key', fonts: await textRendering(), claudeKey: claudeVia() === 'api' ? await claudeKeyStatus() : undefined });
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
  // a website, when given, is read first so a ZIP code or a name can't be matched to the wrong place
  const { intent, candidates, rejected, notes } = await lookupCandidates(input, { website: req.body.website || undefined, zip: req.body.zip, limit: Number(req.body.limit) || 5 });
  const card = candidates[0] ? await confirmBusinessCard(candidates[0]) : null;
  res.json({ intent, candidates, card, rejected, notes });
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
    // Studio builds score the new site for a before/after comparison (scoreNew=false skips the extra ~25 s)
    scoreNew: body.scoreNew !== false && body.scoreNew !== 'false',
  };
  const file = (req as any).file as Express.Multer.File | undefined;
  if (file) {
    try { input.theme = JSON.parse(file.buffer.toString('utf8')); } catch (e) { return res.status(400).json({ error: `theme.json is not valid JSON: ${(e as Error).message}` }); }
  } else if (body.theme && typeof body.theme === 'object') input.theme = body.theme;
  if (!input.google && !input.placeId && !input.website) return res.status(400).json({ error: 'google (link, place ID, or name + ZIP), placeId or website is required' });
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
  const n = normalizeLead(slug, b);
  if (!n.ok) return res.status(400).json({ error: n.error });
  const lead = n.lead;
  const leadId = await saveLead(lead); // data/leads locally, Supabase/Redis on Vercel
  // saved is not delivered: pass it on (awaited, with timeouts: on Vercel the function may stop right after the response) and record the result
  const draft = await findDraft({ slug }).catch(() => undefined);
  const delivery = await deliverLead(lead, { business: draft?.base.business.name || slug, ownerEmail: ownerEmailOf(draft?.content) });
  await recordLeadDelivery(leadId, lead, { attempts: delivery.attempts, confirmed: delivery.confirmed }).catch((e) => console.warn('[lead delivery record]', e.message));
  for (const a of delivery.attempts.filter((x) => x.status === 'failed')) console.warn(`[lead ${a.channel}] ${slug}: ${a.detail}`);
  if (req.is('application/json')) return res.json({ ok: true, saved: true, delivered: delivery.confirmed });
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

// ── owner editor API (own key per draft) and the Studio's owner-link controls ──
app.use('/api/owner', ownerRoutes);
app.use('/api/studio', studioRoutes); // design studio: business briefs (phase 1) and concept sets (phase 2), src/studio
// concept previews: each set's HTML, photos and screenshots (noindex; previews are never published from here)
app.use('/studio-previews', (_req, res, next) => { res.set({ 'x-robots-tag': 'noindex' }); next(); },
  // a concept page: its Google listing photos and their credits are fetched for this view (never stored), see listing-photos.ts
  async (req, res, next) => {
    if (!/^\/[A-Za-z0-9_-]+\/[a-c]\.html$/.test(req.path)) return next();
    const local = path.join(config.dirs.out, 'studio-concepts', req.path);
    const html = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : (await readOut(`studio-concepts${req.path}`).catch(() => undefined))?.toString('utf8');
    if (!html) return next();
    res.set({ 'cache-control': 'private, no-store' }).type('html').send(await fillListingPhotos(html));
  },
  express.static(path.join(config.dirs.out, 'studio-concepts')),
  // on a serverless host the files may be on another instance: the remote store has every finished set
  async (req, res, next) => { const data = await readOut(`studio-concepts${decodeURIComponent(req.path)}`).catch(() => undefined); if (!data) return next(); res.type(path.extname(req.path) || 'html').send(data); });
app.use('/p', shareRoutes);
app.use('/api', studioDraftRoutes);

// ── saved history (data/builds, data/conversations). No auth: fine locally, add it before this is public. ──
app.get('/api/builds', wrap(async (_req, res) => res.json({ builds: await listBuilds() })));
// put a built site live on Vercel as its own static project (VERCEL_TOKEN); re-publishing updates it
app.post('/api/sites/:slug/publish', wrap(async (req, res) => {
  if (!publishEnabled()) return res.status(400).json({ error: 'Publishing is off: set VERCEL_TOKEN (vercel.com/account/tokens).' });
  res.json(await publishSite(String(req.params.slug)));
}));
// send a test enquiry through the same path a visitor's form uses; the site can't be published until one arrives
app.post('/api/sites/:slug/test-lead', wrap(async (req, res) => {
  const slug = String(req.params.slug).replace(/[^a-z0-9-]/g, '');
  const d = await findDraft({ slug });
  if (!d) return res.status(404).json({ error: 'No such site' });
  const n = normalizeLead(slug, { name: 'Roger test enquiry', phone: '(000) 000-0000', message: 'Test enquiry sent by Roger before publishing. Safe to ignore.', kind: 'enquiry', page: 'test' });
  if (!n.ok) return res.status(400).json({ error: n.error });
  n.lead.test = true;
  const leadId = await saveLead(n.lead);
  const delivery = await deliverLead(n.lead, { business: d.base.business.name, ownerEmail: ownerEmailOf(d.content), test: true });
  await recordLeadDelivery(leadId, n.lead, { attempts: delivery.attempts, confirmed: delivery.confirmed });
  // the gate opens only when a channel acknowledged the test: a saved enquiry that reaches nobody is not delivery
  if (delivery.confirmed) { d.base.leadTestedAt = new Date().toISOString(); d.base.leadDelivery = delivery.attempts; await putDraft(d); }
  res.status(delivery.confirmed ? 200 : 502).json({ ok: delivery.confirmed, saved: true, delivered: delivery.confirmed, channels: delivery.configured, attempts: delivery.attempts, error: delivery.confirmed ? undefined : delivery.configured.length ? 'The test enquiry was saved, but no channel confirmed delivery.' : 'No delivery channel is set up: set LEAD_WEBHOOK_URL, or RESEND_API_KEY and LEAD_FROM_EMAIL (with the business\'s email or LEAD_NOTIFY_EMAIL).' });
}));
// what stops this site being published (Studio): reviewed facts, sample content, unconfirmed prices
// Re-resolve a site whose saved business identity isn't a business (a postal code, a town) and rebuild its pages in place
app.post('/api/sites/:slug/re-resolve', wrap(async (req, res) => {
  const { repairIdentity } = await import('./repair.js');
  const r = await repairIdentity({ slug: req.params.slug }, { force: req.body?.force === true });
  res.status(r.repaired || !r.problem ? 200 : 422).json({ slug: r.slug, problem: r.problem, repaired: r.repaired, message: r.message, siteUrl: r.build?.siteUrl, business: r.build?.business, review: r.build?.review });
}));

app.get('/api/sites/:slug/readiness', wrap(async (req, res) => {
  const d = await findDraft({ slug: String(req.params.slug) });
  if (!d) return res.json({ ready: false, items: [{ key: 'content', level: 'blocker', message: 'This site was built before business details could be reviewed. Rebuild it to publish.' }] });
  const items = publishReadiness(d.content, d.offerings, { checks: d.base.source?.review?.checks, leadTested: !!d.base.leadTestedAt, leadNotified: configuredChannels(ownerEmailOf(d.content)).length > 0 });
  res.json({ ready: !items.some((i) => i.level === 'blocker'), items, draftId: d.id });
}));
// make a verified custom domain the primary address (real Vercel domain verification; the demo step never calls this)
app.post('/api/sites/:slug/domain', wrap(async (req, res) => {
  if (!publishEnabled()) return res.status(400).json({ error: 'Publishing is off: set VERCEL_TOKEN.' });
  res.json(await setPrimaryDomain(String(req.params.slug), String((req.body || {}).domain || '')));
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
// personalisation pilot: what the questions offer for a build, and rebuilding it with the owner's answers
app.get('/api/builds/:id/personalise', wrap(async (req, res) => {
  const s = await personaliseState(String(req.params.id));
  if (!s) return res.status(404).json({ error: 'No finished build with that id' });
  res.json(s);
}));
app.post('/api/builds/:id/personalise', wrap(async (req, res) => {
  const body = req.body || {};
  const r = await startRefinement(String(req.params.id), { preferences: body.preferences, alternative: body.alternative === true, optIn: body.optIn === true }, { source: 'studio' });
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  if (req.query.wait === '1' || body.wait === true) {
    await waitForJob(r.job);
    if (r.job.status === 'error') return res.status(500).json({ jobId: r.job.id, error: r.job.error, events: r.job.events });
    return res.json({ jobId: r.job.id, ...r.job.result });
  }
  res.status(202).json({ jobId: r.job.id, status: r.job.status, events: `/api/jobs/${r.job.id}/events` });
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
  if (err.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message, ...((err as any).blockers ? { blockers: (err as any).blockers } : {}), ...((err as any).verification ? { verification: (err as any).verification } : {}) });
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Vercel runs the exported app as a function; everywhere else this is a normal server
export default app;
if (!process.env.VERCEL) app.listen(config.port, () => {
  console.log(`Roger Site Builder on ${config.publicBaseUrl}  (mock=${config.mock}, claude=${claudeVia() ?? 'off'}, screenshots=${screenshotsAvailable()}, themes=${loadThemes().size}, password=${config.studioPassword ? 'on' : 'off'}, publish=${config.vercelToken ? 'vercel' : 'off'})`);
  // studio jobs that were running when the server stopped continue where they were
  resumeInterruptedJobs().then((ids) => { if (ids.length) console.log(`[studio] resuming ${ids.length} interrupted job(s): ${ids.join(', ')}`); }).catch((e) => console.warn('[studio] resume failed', e));
  if (!config.studioPassword && !/\/\/(localhost|127\.0\.0\.1)\b/.test(config.publicBaseUrl)) console.warn('[security] STUDIO_PASSWORD is not set: anyone who finds this URL can run builds on your API keys and read conversations.');
});
