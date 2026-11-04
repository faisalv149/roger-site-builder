import express, { type NextFunction, type Request, type Response } from 'express';
import { getBrief, getStudioJob, listStudioJobs, resumeIfStale, resumeStudioJob, startStudioJob } from './jobs.js';
import { getSnapshot } from './snapshot.js';
import { studioDocs } from '../store.js';
import type { BriefIndex } from './jobs.js';
import { ownerReview } from './concepts/types.js';
import { checkPinned, emptyReview, getReview, publicationGate, resolveCatalog, saveReview, StaleBrief } from './concepts/review.js';
import type { ConceptSet } from './concepts/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getConceptJob, getConceptSet, resumeConceptIfStale, startConceptJob } from './concepts/jobs.js';
import { createShare, shareUrl } from './concepts/share.js';
import { IdentityError } from '../sources/website-business.js';

/**
 * The design studio's API (Phase 1: business brief).
 *   POST /api/studio/jobs                  { website } or { google } → 202 { id }: the job runs in the background
 *   GET  /api/studio/jobs                  recent jobs
 *   GET  /api/studio/jobs/:id              the job: each stage's status, progress, notes and errors
 *   POST /api/studio/jobs/:id/resume       continue a failed or stopped job from its first unfinished stage
 *   POST /api/studio/jobs/:id/rebuild      a new job that rebuilds the brief from this job's snapshot (no fetching)
 *   GET  /api/studio/briefs/:key[?revision=n]   the saved brief and inventory
 *   GET  /api/studio/snapshots/:id         the saved snapshot (page bodies are referenced by hash)
 */
export const studioRoutes = express.Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

studioRoutes.post('/jobs', wrap(async (req, res) => {
  const b = (req.body || {}) as { website?: string; google?: string };
  try {
    const job = await startStudioJob({ website: typeof b.website === 'string' ? b.website : undefined, google: typeof b.google === 'string' ? b.google : undefined });
    res.status(202).json({ id: job.id, status: job.status, stages: job.stages, url: `/api/studio/jobs/${job.id}` });
  } catch (e) {
    if (e instanceof IdentityError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));
studioRoutes.get('/jobs', wrap(async (_req, res) => {
  res.json({ jobs: (await listStudioJobs()).slice(0, 50).map((j) => ({ id: j.id, createdAt: j.createdAt, updatedAt: j.updatedAt, status: j.status, input: j.input, businessKey: j.businessKey, revision: j.revision, error: j.error })) });
}));
studioRoutes.get('/jobs/:id', wrap(async (req, res) => {
  const found = await getStudioJob(String(req.params.id));
  if (!found) return res.status(404).json({ error: 'No such job' });
  // a job running nowhere (its instance stopped) is picked up again by the poll that notices
  const job = await resumeIfStale(found);
  res.json(job);
}));
studioRoutes.post('/jobs/:id/resume', wrap(async (req, res) => {
  const job = await resumeStudioJob(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'No such job' });
  res.status(202).json({ id: job.id, status: job.status });
}));
studioRoutes.post('/jobs/:id/rebuild', wrap(async (req, res) => {
  const job = await getStudioJob(String(req.params.id));
  if (!job?.snapshotId) return res.status(409).json({ error: 'That job has no saved snapshot yet.' });
  const again = await startStudioJob({ fromSnapshot: job.snapshotId });
  res.status(202).json({ id: again.id, status: again.status });
}));
studioRoutes.get('/briefs/:key', wrap(async (req, res) => {
  const r = await getBrief(String(req.params.key), req.query.revision ? Number(req.query.revision) : undefined);
  if (!r.brief) return res.status(404).json({ error: 'No brief for that business' });
  res.json(r);
}));
studioRoutes.get('/snapshots/:id', wrap(async (req, res) => {
  const s = await getSnapshot(String(req.params.id));
  if (!s) return res.status(404).json({ error: 'No such snapshot' });
  res.json(s);
}));

// ───────────────────────── phase 2: owner reviews and concept sets ─────────────────────────
/**
 *   GET  /api/studio/businesses                 every business with a brief: its latest revision, name and hash
 *   POST /api/studio/reviews                    an owner review of one pinned brief revision → 201 { id }; 409 if the brief has moved on
 *   GET  /api/studio/reviews/:id
 *   POST /api/studio/concepts                   { businessKey, revision?, briefHash?, reviewId? } → 202 { id, setId }: three homepage concepts (preview)
 *   GET  /api/studio/concept-jobs/:id           the concept job: its stages, notes and errors
 *   GET  /api/studio/concept-sets/:id           the concept set: concepts, checks, distinctness, cost, publication gate
 *   Previews (HTML and screenshots): /studio-previews/<setId>/...
 */
studioRoutes.get('/businesses', wrap(async (_req, res) => {
  const idx = await studioDocs.list<BriefIndex>('studio-index');
  const out = await Promise.all(idx.map(async (i) => { const { brief } = await getBrief(i.businessKey); return brief ? { businessKey: i.businessKey, revision: brief.revision, briefHash: brief.briefHash, name: brief.identity.name.value, category: brief.identity.category.value } : null; }));
  res.json({ businesses: out.filter(Boolean).sort((a, b) => String(a!.name).localeCompare(String(b!.name))) });
}));
studioRoutes.post('/reviews', wrap(async (req, res) => {
  const parsed = ownerReview.omit({ id: true }).safeParse({ schema: 'roger.owner-review', version: 1, answers: {}, approvedAssets: [], approvedClaims: [], reviewedAt: new Date().toISOString(), ...(req.body || {}) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const { brief } = await getBrief(parsed.data.brief.businessKey, parsed.data.brief.revision);
  if (!brief) return res.status(404).json({ error: 'No such brief revision' });
  try { checkPinned(brief, { ...parsed.data, id: '' }); } catch (e) { return res.status(409).json({ error: (e as Error).message }); }
  const saved = await saveReview({ ...parsed.data, id: '' });
  res.status(201).json({ id: saved.id, review: saved });
}));
studioRoutes.get('/reviews/:id', wrap(async (req, res) => {
  const r = await getReview(String(req.params.id));
  if (!r) return res.status(404).json({ error: 'No such review' });
  res.json(r);
}));
studioRoutes.post('/concepts', wrap(async (req, res) => {
  const b = (req.body || {}) as { businessKey?: string; revision?: number; briefHash?: string; reviewId?: string };
  if (!b.businessKey) return res.status(400).json({ error: 'businessKey is required' });
  try {
    const job = await startConceptJob({ businessKey: b.businessKey, revision: b.revision, briefHash: b.briefHash, reviewId: b.reviewId });
    res.status(202).json({ id: job.id, setId: job.setId, url: `/api/studio/concept-jobs/${job.id}` });
  } catch (e) {
    if (e instanceof StaleBrief) return res.status(409).json({ error: e.message });
    throw e;
  }
}));
studioRoutes.get('/concept-jobs/:id', wrap(async (req, res) => {
  const found = await getConceptJob(String(req.params.id));
  if (!found) return res.status(404).json({ error: 'No such concept job' });
  const j = await resumeConceptIfStale(found);
  res.json({ ...j, work: { planSource: j.work.planSource, calls: j.work.calls } });
}));
studioRoutes.get('/concept-sets/:id', wrap(async (req, res) => {
  const s = await getConceptSet(String(req.params.id));
  if (!s) return res.status(404).json({ error: 'No such concept set' });
  res.json(s);
}));

/**
 *   GET  /api/studio/review-data/:key[?revision=n][&reviewId=]   what the owner review screen needs for one brief revision:
 *        its questions, disputed facts, photos, service pictures, claims, menu, and the concept sets made from it
 *   GET  /api/studio/concept-sets/:id/gate[?reviewId=]           the set's publication gate under a review (blocked until
 *        everything is settled, and publishing itself is not built yet)
 */
const previewRoot = () => path.join(config.dirs.out, 'studio-concepts');
/** a photo the studio already copied (the shared cache, else a set's folder), else the business's own address for it */
function photoSrc(id: string, url: string, setIds: string[]) {
  try {
    const cached = fs.readdirSync(path.join(previewRoot(), '_photos')).find((f) => f.startsWith(`${id}-`));
    if (cached) return `/studio-previews/_photos/${cached}`;
  } catch { /* no cache yet */ }
  for (const sid of setIds) if (fs.existsSync(path.join(previewRoot(), sid, 'img', `${id}.jpg`))) return `/studio-previews/${sid}/img/${id}.jpg`;
  // not on this disk: the newest set has a copy in the remote store (on Vercel), else the website's own address
  return setIds[0] && process.env.VERCEL ? `/studio-previews/${setIds[0]}/img/${id}.jpg` : url;
}
studioRoutes.get('/review-data/:key', wrap(async (req, res) => {
  const { brief, inventory } = await getBrief(String(req.params.key), req.query.revision ? Number(req.query.revision) : undefined);
  if (!brief || !inventory) return res.status(404).json({ error: 'No brief for that business' });
  const ref = { businessKey: brief.businessKey, revision: brief.revision, briefHash: brief.briefHash };
  const review = req.query.reviewId ? await getReview(String(req.query.reviewId)) : undefined;
  if (review && (review.brief.revision !== brief.revision || review.brief.briefHash !== brief.briefHash)) return res.status(409).json({ error: `That review is of revision ${review.brief.revision}, not ${brief.revision}.` });
  const base = resolveCatalog(brief, inventory, emptyReview(ref));
  const cat = review ? resolveCatalog(brief, inventory, review) : base;
  const sets = (await studioDocs.list<ConceptSet>('studio-concept-sets')).filter((x) => x.brief.businessKey === brief.businessKey && x.brief.revision === brief.revision).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const setIds = sets.map((x) => x.id);
  const at = (sid: string, p?: string) => (p ? `/studio-previews/${encodeURIComponent(sid)}/${p}` : null);
  res.json({
    brief: { ...ref, name: brief.identity.name.value, category: brief.identity.category.value },
    review: review ?? null,
    questions: brief.ownerQuestions,
    disputed: (['phone', 'address'] as const).flatMap((k) => { const fct = brief.contact[k]; return fct.candidates?.length ? [{ field: k, note: fct.note, questionId: fct.questionId, candidates: fct.candidates.map((c) => ({ value: typeof c.value === 'string' ? c.value : c.value.formatted, sources: c.sources.map((x) => (x.sourceType === 'google' ? 'Google listing' : x.url)) })) }] : []; }),
    photos: base.photos.map((p) => ({ id: p.id, src: photoSrc(p.id, p.url, setIds), width: p.width, height: p.height, alt: p.alt, services: p.services })),
    logo: base.logo ? { src: base.logo.url } : null,
    services: base.services.map((x) => ({ id: x.id, name: x.name, websiteImageId: x.imageId ?? null, imageId: cat.services.find((y) => y.id === x.id)?.imageId ?? null, imageFrom: cat.services.find((y) => y.id === x.id)?.imageFrom ?? null })),
    sections: [...new Set(base.items.map((i) => i.section).filter(Boolean))],
    claims: base.claims,
    offerings: base.items.length ? { items: base.items.length, pricesToCheck: base.forbidden.prices.length } : null,
    omitted: cat.omitted,
    sets: sets.map((x) => ({ id: x.id, createdAt: x.createdAt, reviewId: x.reviewId, concepts: x.concepts.map((c) => ({ id: c.id, name: c.name, thesis: c.thesis, passes: c.checks.every((k) => k.level === 'pass'), notes: c.notes ?? [], html: at(x.id, c.preview?.html), desktopHero: at(x.id, c.preview?.desktopHero), mobileHero: at(x.id, c.preview?.mobileHero) })) })),
  });
}));
studioRoutes.get('/concept-sets/:id/gate', wrap(async (req, res) => {
  const set = await getConceptSet(String(req.params.id));
  if (!set) return res.status(404).json({ error: 'No such concept set' });
  const review = await getReview(String(req.query.reviewId || set.reviewId));
  if (!review) return res.status(404).json({ error: 'No such review' });
  const { brief, inventory } = await getBrief(set.brief.businessKey, set.brief.revision);
  if (!brief || !inventory) return res.status(404).json({ error: 'The brief of that set is gone' });
  try {
    const cat = resolveCatalog(brief, inventory, review);
    res.json(publicationGate(brief, cat, review, set.concepts, { id: set.id, conceptIds: set.concepts.map((c) => c.id) }));
  } catch (e) {
    if (e instanceof StaleBrief) return res.status(409).json({ error: e.message });
    throw e;
  }
}));

/**
 *   POST /api/studio/concept-sets/:id/share   { conceptId } → { url, token }: the client's preview link for that concept
 *        (one per concept; the same link comes back on a second call). Publishing is not involved.
 */
studioRoutes.post('/concept-sets/:id/share', wrap(async (req, res) => {
  const set = await getConceptSet(String(req.params.id));
  if (!set) return res.status(404).json({ error: 'No such concept set' });
  const conceptId = String((req.body || {}).conceptId || '');
  if (!set.concepts.some((c) => c.id === conceptId)) return res.status(400).json({ error: 'conceptId must be a, b or c of this set' });
  const share = await createShare({ setId: set.id, conceptId, businessKey: set.brief.businessKey, revision: set.brief.revision });
  res.status(201).json({ url: shareUrl(share.token), token: share.token, setId: set.id, conceptId, kind: 'homepage preview (not a published website)' });
}));
