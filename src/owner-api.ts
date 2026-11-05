import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { queueRescore, scoreStatus } from './rescore.js';
import { config } from './config.js';
import { ContentError, editMedia, reviewFact } from './design/content.js';
import { confirmServiceImages } from './design/offerings.js';
import { pageMeta, seoIssues } from './seo.js';
import { addUpload } from './uploads.js';
import { contentView, ensureLocalSite, refreshSavedSite, DraftError, findDraft, generateAnother, getDraft, issueOwnerKey, ownerState, ownerUrl, previewTokens, putDraft, renderWorking, resolvePlan, saveDraft, summarisePlan, verifyOwnerKey, withDraftLock, type DraftRecord } from './drafts.js';
import { applyConcept, nextConcept } from './studio/concepts/site.js';
import { allOrders, createDemoOrder, domainIdeas, DNS_PROVIDERS, getOrder, listOrders, orderView, simulateVerification, updateOnboarding } from './orders.js';
import { layoutOptions } from './design/planner.js';
import { latestBuildFor, listLeads } from './store.js';
import { scoreSummary } from './audit/compare.js';

/**
 * The owner's editor API (/api/owner/:draftId/...). Every request carries the draft's owner key as a Bearer token;
 * it works for that draft only, for editing, saving, demo orders and domain onboarding. The Studio password is
 * not involved (and does not open these routes without the key). Studio routes to issue or revoke a key are in
 * studioDraftRoutes, behind the Studio password like the rest of the API.
 */
type Locals = { draft: DraftRecord };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// a few wrong keys are typos; many are guessing
const failures = new Map<string, { n: number; at: number }>();
function tooMany(ip: string): boolean {
  const f = failures.get(ip);
  if (!f || Date.now() - f.at > 10 * 60_000) return false;
  return f.n >= 30;
}
function fail(ip: string) {
  const f = failures.get(ip);
  failures.set(ip, !f || Date.now() - f.at > 10 * 60_000 ? { n: 1, at: Date.now() } : { n: f.n + 1, at: f.at });
}

async function ownerAuth(req: Request, res: Response, next: NextFunction) {
  res.set({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
  const ip = req.ip || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const id = String(req.params.draftId || '');
  const [scheme, key] = (req.headers.authorization || '').split(' ');
  const d = /^drf_[a-f0-9]{12}$/.test(id) ? await getDraft(id) : undefined;
  if (!d || scheme !== 'Bearer' || !verifyOwnerKey(d, key)) {
    fail(ip);
    return res.status(401).json({ error: 'This editor link is not valid any more. Ask Roger for a new link.' });
  }
  (res.locals as Locals).draft = d;
  next();
}

const json = (req: Request) => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

export const ownerRoutes = express.Router({ mergeParams: true });
ownerRoutes.use('/:draftId', ownerAuth);

ownerRoutes.get('/:draftId', wrap(async (_req, res) => {
  const d = (res.locals as Locals).draft;
  const orders = await Promise.all((await listOrders(d.id)).map(orderView));
  // the owner's current website against the new site, scored with the same checks (when both were measured)
  const last = await latestBuildFor(d.slug);
  const audit = last?.result?.audit as (import('./audit/audit.js').AuditResult & { reportUrl?: string }) | undefined;
  const scores = audit || last?.result?.newSite ? { ...scoreSummary(audit, last?.result?.newSite), reportUrl: audit?.reportUrl, measuredAt: last?.result?.newSite?.generatedAt } : null;
  res.json({ ...ownerState(d), content: contentView(d), scores, siteScores: scoreStatus(d), orders, providers: DNS_PROVIDERS.map(({ id, label }) => ({ id, label })), ideas: domainIdeas(d.businessName, d.base.facts.city) });
}));

// the saved page for the editor's preview frame
// the current revision's score, a previous one, or pending (for polling while a re-check runs)
ownerRoutes.get('/:draftId/scores', wrap(async (_req, res) => { res.json(scoreStatus((res.locals as Locals).draft)); }));

ownerRoutes.get('/:draftId/preview', wrap(async (_req, res) => {
  const d = (res.locals as Locals).draft;
  const r = await renderWorking(d, {});
  res.json({ html: r.html, plan: summarisePlan(r.plan) });
}));

// colours, fonts, sizes, motion: validated CSS variables, applied to the preview without re-rendering
ownerRoutes.post('/:draftId/tokens', wrap(async (req, res) => {
  const d = (res.locals as Locals).draft;
  const body = json(req);
  const plan = body.planId ? resolvePlan(d, { planId: String(body.planId) }) : undefined;
  res.json(previewTokens(d, body, plan));
}));

// layout and price changes: re-rendered from the stored data (no Google or Claude requests), not saved
ownerRoutes.post('/:draftId/render', wrap(async (req, res) => {
  const d = (res.locals as Locals).draft;
  const r = await renderWorking(d, json(req));
  res.json({ html: r.html, plan: summarisePlan(r.plan), planId: r.plan.id, options: layoutOptions(r.plan, d.base.photos, { offerings: r.offerings, category: d.category, services: d.base.services.items }) });
}));

ownerRoutes.post('/:draftId/generate', wrap(async (req, res) => {
  const d = (res.locals as Locals).draft;
  // a site made from a concept set: "another design" is the set's next concept (three to choose from, saved as chosen)
  if (d.concept) {
    const next = await nextConcept(d.concept);
    if (next) {
      const saved = await applyConcept(d.id, d.concept.setId, next);
      const r = await renderWorking(saved, {});
      return res.json({ html: r.html, plan: summarisePlan(r.plan), planId: r.plan.id, concept: { id: next.id, name: next.name }, saved: true, revision: saved.revision, options: layoutOptions(r.plan, saved.base.photos, { offerings: saved.offerings, category: saved.category, services: saved.base.services.items }) });
    }
  }
  const r = await withDraftLock(d.id, async () => generateAnother((await getDraft(d.id))!, json(req)));
  res.json({ html: r.html, plan: summarisePlan(r.plan), planId: r.plan.id, options: layoutOptions(r.plan, d.base.photos, { offerings: d.offerings, category: d.category, services: d.base.services.items }) });
}));

ownerRoutes.put('/:draftId', wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const saved = await withDraftLock(id, async () => saveDraft((await getDraft(id))!, json(req)));
  queueRescore(saved.id, saved.revision, saved.slug); // measured in the background; nothing waits for it
  res.json({ ...ownerState(saved), saved: true, siteScores: scoreStatus(saved) });
}));

ownerRoutes.get('/:draftId/orders', wrap(async (_req, res) => {
  const d = (res.locals as Locals).draft;
  res.json({ orders: await Promise.all((await listOrders(d.id)).map(orderView)) });
}));

ownerRoutes.post('/:draftId/orders', wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const r = await withDraftLock(id, async () => createDemoOrder((await getDraft(id))!, json(req)));
  res.status(r.replay ? 200 : 201).json({ order: await orderView(r.order), replay: r.replay });
}));

async function ownOrder(req: Request, res: Response) {
  const d = (res.locals as Locals).draft;
  const o = await getOrder(String(req.params.orderId || ''));
  if (!o || o.draftId !== d.id) throw new DraftError(404, 'No such order');
  return o;
}
ownerRoutes.put('/:draftId/orders/:orderId/onboarding', wrap(async (req, res) => {
  const o = await withDraftLock((res.locals as Locals).draft.id, async () => updateOnboarding(await ownOrder(req, res), json(req)));
  res.json({ order: await orderView(o) });
}));
ownerRoutes.post('/:draftId/orders/:orderId/simulate-verification', wrap(async (req, res) => {
  const o = await withDraftLock((res.locals as Locals).draft.id, async () => simulateVerification(await ownOrder(req, res)));
  res.json({ order: await orderView(o) });
}));

// ── business details: confirm, correct or leave out each fact (bound to the exact value) ──
ownerRoutes.post('/:draftId/facts', wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const d = await withDraftLock(id, async () => {
    const x = (await getDraft(id))!;
    if (!x.content) throw new DraftError(409, 'This site has no business details to review yet. Rebuild it first.');
    x.content = reviewFact(x.content, json(req));
    x.updatedAt = new Date().toISOString();
    await refreshSavedSite(x);
    await putDraft(x);
    return x;
  });
  res.json({ content: contentView(d) });
}));

// ── media: roles (hero / gallery / team / leave out), order, alt text, focal point ──
ownerRoutes.post('/:draftId/media/edit', wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const d = await withDraftLock(id, async () => {
    const x = (await getDraft(id))!;
    if (!x.content) throw new DraftError(409, 'No media library for this site yet. Rebuild it first.');
    const edits = Array.isArray(json(req).edits) ? (json(req).edits as unknown[]) : [json(req)];
    for (const e of edits.slice(0, 60)) x.content = editMedia(x.content, e);
    x.updatedAt = new Date().toISOString();
    await refreshSavedSite(x);
    await putDraft(x);
    return x;
  });
  res.json({ content: contentView(d) });
}));

// ── the owner's inbox: enquiries from the site, with whether each one was passed on ──
ownerRoutes.get('/:draftId/leads', wrap(async (_req, res) => {
  const d = (res.locals as Locals).draft;
  const leads = (await listLeads(d.slug)).filter((l) => !l.test).slice(0, 100);
  res.json({ leads: leads.map((l) => ({ at: l.at, name: l.name, phone: l.phone, email: l.email, service: l.service, message: l.message, kind: l.kind, delivered: !!l.delivery?.confirmed, delivery: l.delivery?.attempts ?? [] })) });
}));

// ── rights: the owner confirms the pictures from their website (on service cards) are theirs to publish ──
ownerRoutes.post('/:draftId/media/confirm-service-images', wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const ids = Array.isArray(json(req).services) ? (json(req).services as unknown[]).map(String) : undefined;
  const d = await withDraftLock(id, async () => {
    const x = (await getDraft(id))!;
    x.offerings = confirmServiceImages(x.offerings, ids);
    x.updatedAt = new Date().toISOString();
    await putDraft(x);
    return x;
  });
  res.json({ content: contentView(d) });
}));

// ── uploads: the owner's photos and logo (type and size checked, re-encoded, stored under the site's own assets) ──
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
ownerRoutes.post('/:draftId/media', (req, res, next) => uploader.single('file')(req, res, (err?: unknown) => {
  if (err) return res.status(err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big (12 MB at most).' : (err as Error).message });
  next();
}), wrap(async (req, res) => {
  const id = (res.locals as Locals).draft.id;
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new DraftError(400, 'Choose a photo to upload');
  const kind = req.query.kind === 'logo' ? 'logo' : 'photo';
  const d = await withDraftLock(id, async () => {
    const x = (await getDraft(id))!;
    if (!x.content) throw new DraftError(409, 'No media library for this site yet. Rebuild it first.');
    await ensureLocalSite(x.slug);
    await addUpload(x, file.buffer, kind, String(req.body?.alt || ''));
    x.updatedAt = new Date().toISOString();
    await refreshSavedSite(x);
    await putDraft(x);
    return x;
  });
  res.status(201).json({ content: contentView(d) });
}));

// ── pages and search: titles, descriptions, a search preview approximation and readiness issues ──
ownerRoutes.post('/:draftId/seo', wrap(async (req, res) => {
  const d = (res.locals as Locals).draft;
  const r = await renderWorking(d, { ...json(req), page: '' });
  if (!r.sitePlan) return res.json({ supported: false, reason: 'This design was made before multi-page sites. Update the design family to edit pages and search details.' });
  const sp = r.sitePlan;
  res.json({
    supported: true, mode: sp.mode, modeSource: sp.modeSource,
    pages: sp.pages.map((p) => ({ id: p.id, type: p.type, route: p.route, url: `${d.slug ? `${config.publicBaseUrl}/sites/${d.slug}/` : ''}${p.route}`, ...pageMeta(r.model, sp, p), override: sp.overrides[p.id] || {} })),
    issues: seoIssues(r.model, sp),
    note: 'Search engines decide what they show; this is an approximation of a typical result.',
    indexable: false,
  });
}));

ownerRoutes.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof DraftError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err instanceof ContentError) return res.status(400).json({ error: err.message });
  next(err);
});

// ── Studio: owner links (behind the Studio password) ──
export const studioDraftRoutes = express.Router();
studioDraftRoutes.get('/drafts', wrap(async (req, res) => {
  const d = await findDraft({ slug: req.query.slug ? String(req.query.slug) : undefined, businessKey: req.query.place ? String(req.query.place) : undefined });
  if (!d) return res.status(404).json({ error: 'No draft for that site' });
  const orders = await listOrders(d.id);
  res.json({ id: d.id, slug: d.slug, revision: d.revision, savedAt: d.savedAt, plan: summarisePlan(d.plan), ownerLink: d.owner ? { createdAt: d.owner.createdAt, revoked: !!d.owner.revokedAt } : null, orders: orders.length });
}));
studioDraftRoutes.post('/drafts/:id/owner-link', wrap(async (req, res) => {
  const url = await withDraftLock(String(req.params.id), async () => {
    const d = await getDraft(String(req.params.id));
    if (!d) return undefined;
    const key = issueOwnerKey(d);
    await putDraft(d);
    return ownerUrl(d, key);
  });
  if (!url) return res.status(404).json({ error: 'No such draft' });
  res.set('cache-control', 'no-store').json({ url, note: 'This link replaces any earlier one for this site.' });
}));
studioDraftRoutes.delete('/drafts/:id/owner-link', wrap(async (req, res) => {
  const ok = await withDraftLock(String(req.params.id), async () => {
    const d = await getDraft(String(req.params.id));
    if (!d?.owner) return false;
    d.owner.revokedAt = new Date().toISOString();
    await putDraft(d);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'No owner link to revoke' });
  res.json({ revoked: true });
}));
// internal comparison: the same business, prices, main action and photo pool rendered in each page family
studioDraftRoutes.get('/drafts/:id/compare/:family', wrap(async (req, res) => {
  const d = await getDraft(String(req.params.id));
  if (!d) return res.status(404).json({ error: 'No such draft' });
  const family = String(req.params.family);
  if (!['editorial-showcase', 'warm-local', 'bold-practical'].includes(family)) return res.status(400).json({ error: 'Unknown family' });
  const r = await renderWorking(d, { layout: { family }, page: typeof req.query.page === 'string' ? req.query.page : '' });
  res.type('html').set('cache-control', 'no-store').send(r.html);
}));
studioDraftRoutes.get('/drafts-list', wrap(async (_req, res) => {
  const { draftDocs } = await import('./store.js');
  const all = await draftDocs.list<any>('drafts');
  res.json({ drafts: all.map((x) => ({ id: x.id, name: x.businessName, slug: x.slug, category: x.category, family: x.plan?.family?.id ?? x.plan?.direction, updatedAt: x.updatedAt })).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')) });
}));
studioDraftRoutes.get('/orders', wrap(async (_req, res) => {
  res.json({ orders: (await allOrders()).map(({ idempotencyKey: _k, ...o }) => o) });
}));
