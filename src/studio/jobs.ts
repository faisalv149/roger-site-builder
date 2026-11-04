import { randomUUID } from 'node:crypto';
import { studioDocs } from '../store.js';
import { IdentityError } from '../sources/website-business.js';
import { assetsStage, brandStage, budgetFromEnv, crawlStage, documentsStage, identityStage, inventoryStage, snapshotFromWork, type StageCtx, type Work } from './stages.js';
import type { Ocr } from './pdf.js';
import { getSnapshot, saveSnapshot, type SourceSnapshot } from './snapshot.js';
import { buildFromSnapshot, businessKeyOf, briefHashOf } from './brief.js';
import { summarize } from './summary.js';
import { runQa, type QaReport } from './qa.js';
import { countsOf } from './report.js';
import { HEARTBEAT_MS, keepAlive, STALE_MS } from './keepalive.js';
import type { BusinessBrief, SiteInventory } from './schema.js';

/**
 * Studio jobs: identity → page inventory → crawl → asset analysis → brand analysis → business brief → QA.
 *
 * A job is saved before it starts and after every step, so it can be watched (the API returns its id at once) and
 * resumed: a stage that finished is not run again, and the crawl continues from the pages it already has. Locally
 * the stages run in this process; on start-up, jobs that were running when the process stopped resume
 * (resumeInterruptedJobs). Production needs a worker instead: see docs/studio-worker-migration.md.
 */
export const STAGES = ['identity', 'page_inventory', 'crawl', 'documents', 'assets', 'brand', 'brief', 'qa'] as const;
export type StageName = (typeof STAGES)[number];
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StageState {
  name: StageName;
  status: StageStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  progress?: { done: number; total: number; note?: string };
  notes: string[];
  error?: string;
}
export interface StudioJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  input: { website?: string; google?: string; fromSnapshot?: string };
  stages: StageState[];
  businessKey?: string;
  snapshotId?: string;
  revision?: number;
  briefHash?: string;
  qa?: QaReport;
  error?: string;
  /** how many times the job was picked up again after stopping */
  resumes: number;
}

/** Thrown by a test hook to stop a job the way a crashed process would: the job stays "running". */
export class JobInterrupted extends Error {}
export interface JobHooks { afterPage?: (count: number) => void | Promise<void>; beforeStage?: (stage: StageName) => void | Promise<void>; /** tests: an OCR engine to use instead of Tesseract */ ocr?: Ocr }

const active = new Map<string, Promise<StudioJob>>();
const now = () => new Date().toISOString();
const saveJob = (j: StudioJob) => studioDocs.put('studio-jobs', j.id, { ...j, updatedAt: now() });
export const getStudioJob = (id: string) => studioDocs.get<StudioJob>('studio-jobs', id);
export const listStudioJobs = async () => (await studioDocs.list<StudioJob>('studio-jobs')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const getWork = (id: string) => studioDocs.get<Work>('studio-work', id);

export function newJob(input: StudioJob['input']): StudioJob {
  const t = now();
  return { id: `sj_${randomUUID().replace(/-/g, '').slice(0, 12)}`, createdAt: t, updatedAt: t, status: 'queued', input, stages: STAGES.map((name) => ({ name, status: 'pending', attempts: 0, notes: [] })), resumes: 0 };
}

/** Create the job, save it, start it in the background, and return it at once. */
export async function startStudioJob(input: StudioJob['input'], hooks: JobHooks = {}): Promise<StudioJob> {
  if (!input.website?.trim() && !input.google?.trim() && !input.fromSnapshot) throw new IdentityError('Give a website address, or a Google Business Profile link or address.');
  const job = newJob({ website: input.website?.trim() || undefined, google: input.website?.trim() ? undefined : input.google?.trim() || undefined, fromSnapshot: input.fromSnapshot });
  await saveJob(job);
  await studioDocs.put('studio-work', job.id, { jobId: job.id, input: job.input, budget: budgetFromEnv(), discovery: [], pages: {}, stylesheets: {}, assets: {} } satisfies Work);
  void keepAlive(runStudioJob(job.id, hooks));
  return job;
}

/** Run (or resume) a job until it finishes, fails, or is interrupted. Only one run per job at a time. */
export function runStudioJob(id: string, hooks: JobHooks = {}): Promise<StudioJob> {
  const running = active.get(id);
  if (running) return running;
  const p = run(id, hooks).finally(() => active.delete(id));
  active.set(id, p);
  return p;
}

/** A job that stopped (failed, or interrupted part-way): continue from its first unfinished stage. */
export async function resumeStudioJob(id: string, hooks: JobHooks = {}): Promise<StudioJob | undefined> {
  const job = await getStudioJob(id);
  if (!job) return undefined;
  if (job.status === 'done') return job;
  job.resumes++;
  for (const s of job.stages) if (s.status === 'failed' || s.status === 'running') { s.status = 'pending'; s.error = undefined; }
  job.status = 'queued';
  job.error = undefined;
  await saveJob(job);
  void keepAlive(runStudioJob(id, hooks));
  return job;
}

/**
 * A job that is meant to be running but has not been touched for STALE_MS is running nowhere (its server instance was
 * stopped, as a serverless function is at its time limit): the poll that notices picks it up again.
 */
export async function resumeIfStale(job: StudioJob): Promise<StudioJob> {
  if ((job.status === 'running' || job.status === 'queued') && !active.has(job.id) && Date.now() - Date.parse(job.updatedAt) > STALE_MS()) return (await resumeStudioJob(job.id)) ?? job;
  return job;
}

/** On start-up: jobs that were running when the process stopped are picked up again. */
export async function resumeInterruptedJobs(opts: { staleMs?: number } = {}): Promise<string[]> {
  // a job another process saved a moment ago is still running there: only jobs that have gone quiet are taken over
  const staleMs = opts.staleMs ?? Number(process.env.STUDIO_STALE_MS ?? 90_000);
  const stale = (await listStudioJobs()).filter((j) => (j.status === 'running' || j.status === 'queued') && !active.has(j.id) && Date.now() - Date.parse(j.updatedAt) > staleMs);
  for (const j of stale) await resumeStudioJob(j.id);
  return stale.map((j) => j.id);
}

/** Wait for a running job (tests and scripts). */
export async function waitForStudioJob(id: string, timeoutMs = 600_000): Promise<StudioJob> {
  const started = Date.now();
  for (;;) {
    const p = active.get(id);
    if (p) await p.catch(() => undefined);
    const j = await getStudioJob(id);
    if (j && !active.has(id) && (j.status === 'done' || j.status === 'failed' || j.status === 'running')) return j;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${id} did not finish in time`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function run(id: string, hooks: JobHooks): Promise<StudioJob> {
  const job = (await getStudioJob(id))!;
  const work = (await getWork(id)) ?? { jobId: id, input: job.input, budget: budgetFromEnv(), discovery: [], pages: {}, stylesheets: {}, assets: {} };
  job.status = 'running';
  await saveJob(job);
  let snapshot: SourceSnapshot | undefined = job.snapshotId ? await getSnapshot(job.snapshotId) : undefined;
  let built: { inventory: SiteInventory; brief: BusinessBrief; evidenceText: string } | undefined;

  for (const st of job.stages) {
    if (st.status === 'done' || st.status === 'skipped') continue;
    await hooks.beforeStage?.(st.name);
    st.status = 'running';
    const beat = setInterval(() => { void saveJob(job); }, HEARTBEAT_MS);
    st.attempts++;
    st.startedAt = now();
    st.error = undefined;
    await saveJob(job);
    let lastSave = 0;
    const ctx: StageCtx = {
      work,
      save: async () => { await studioDocs.put('studio-work', id, work); if (Date.now() - lastSave > 400) { lastSave = Date.now(); await saveJob(job); } },
      progress: (done, total, note) => { st.progress = { done, total, note }; },
      note: (text) => { if (!st.notes.includes(text)) st.notes.push(text); },
      afterPage: hooks.afterPage,
    };
    try {
      if (job.input.fromSnapshot && ['identity', 'page_inventory', 'crawl', 'documents', 'assets', 'brand'].includes(st.name)) {
        // rebuilding from a saved snapshot: nothing is fetched again
        snapshot ??= await getSnapshot(job.input.fromSnapshot);
        if (!snapshot) throw new Error(`No saved snapshot ${job.input.fromSnapshot}`);
        st.status = 'skipped';
        st.notes = [`reusing snapshot ${snapshot.id} (captured ${snapshot.capturedAt})`];
      } else switch (st.name) {
        case 'identity': await identityStage(ctx); break;
        case 'page_inventory': await inventoryStage(ctx); break;
        case 'crawl': await crawlStage(ctx); break;
        case 'documents': await documentsStage(ctx, { ocr: hooks.ocr }); break;
        case 'assets': await assetsStage(ctx); break;
        case 'brand': {
          await brandStage(ctx);
          snapshot = snapshotFromWork(work, job.createdAt);
          await saveSnapshot(snapshot);
          ctx.note(`snapshot ${snapshot.id}: ${snapshot.pages.length} pages, ${snapshot.documents?.length ?? 0} PDFs, ${snapshot.assets.length} picture downloads`);
          break;
        }
        case 'brief': {
          snapshot ??= job.snapshotId ? await getSnapshot(job.snapshotId) : undefined;
          if (!snapshot) { snapshot = snapshotFromWork(work, job.createdAt); await saveSnapshot(snapshot); }
          built = await buildFromSnapshot(snapshot);
          built.brief.summary = await summarize(built.brief, built.evidenceText);
          const saved = await saveBrief(built.brief, built.inventory, job.id);
          job.revision = saved.revision;
          job.briefHash = built.brief.briefHash;
          job.businessKey = built.brief.businessKey;
          ctx.note(`${saved.created ? 'new revision' : 'same content as revision'} ${saved.revision} of ${built.brief.businessKey}: ${built.brief.services.items.length} services, ${built.brief.offerings.items.length} menu items, ${built.brief.conflicts.length} conflicts, ${built.brief.ownerQuestions.length} owner questions`);
          // the counts, as the inventory has them (the one source every report uses)
          const k = countsOf(built.inventory, built.brief);
          ctx.note(`pages: ${k.pages.found} found, ${k.pages.read + k.pages.rendered} read, ${k.pages.skipped} skipped, ${k.pages.failed} failed · PDFs: ${k.documents.found} found, ${k.documents.read} read · pictures: ${k.pictures.usable} usable of ${k.pictures.total} (${k.pictures.downloaded} downloaded, ${k.pictures.downloadFailed} failed, ${k.pictures.notDownloaded} judged without download, ${k.pictures.overBudget} over budget)`);
          break;
        }
        case 'qa': {
          if (!built) { snapshot ??= await getSnapshot(job.snapshotId!); built = await buildFromSnapshot(snapshot!); }
          job.qa = await runQa(snapshot!, built.inventory, built.brief);
          ctx.note(`QA: ${job.qa.status} (${job.qa.checks.filter((c) => c.level !== 'pass').length} to look at)`);
          break;
        }
      }
      clearInterval(beat);
      if (snapshot) job.snapshotId = snapshot.id;
      if (st.status === 'running') st.status = 'done';
      st.finishedAt = now();
      await studioDocs.put('studio-work', id, work);
      await saveJob(job);
    } catch (e) {
      clearInterval(beat);
      if (e instanceof JobInterrupted) {
        // as if the process stopped: the stage stays "running", the job stays "running"; resume continues it
        await studioDocs.put('studio-work', id, work);
        await saveJob(job);
        return job;
      }
      st.status = 'failed';
      st.error = (e as Error).message.slice(0, 400);
      st.finishedAt = now();
      job.status = 'failed';
      job.error = `${st.name}: ${st.error}`;
      await studioDocs.put('studio-work', id, work);
      await saveJob(job);
      console.warn(`[studio ${id}] ${job.error}`);
      return job;
    }
  }
  job.status = 'done';
  await saveJob(job);
  return job;
}

// ───────────────────────── saved briefs ─────────────────────────
export interface BriefIndex { businessKey: string; latest: number; revisions: { revision: number; briefHash: string; snapshotId: string; jobId: string; at: string; /** later snapshots whose content gave the same brief */ alsoFrom?: string[] }[] }

/** Save a brief and its inventory as a revision of the business; the same content keeps the same revision. */
export async function saveBrief(brief: BusinessBrief, inventory: SiteInventory, jobId: string): Promise<{ revision: number; created: boolean }> {
  const key = brief.businessKey;
  const idx = (await studioDocs.get<BriefIndex>('studio-index', key)) ?? { businessKey: key, latest: 0, revisions: [] };
  const same = idx.revisions.find((r) => r.briefHash === brief.briefHash);
  if (same) {
    brief.revision = same.revision;
    // the same content: the revision stays. Rebuilt from the same snapshot, the saved copy is refreshed (its summary may be new)
    if (same.snapshotId === brief.snapshotId) await studioDocs.put('studio-briefs', `${key}--r${same.revision}`, brief);
    else { (same.alsoFrom ??= []).includes(brief.snapshotId) || same.alsoFrom.push(brief.snapshotId); await studioDocs.put('studio-index', key, idx); }
    return { revision: same.revision, created: false };
  }
  const revision = idx.latest + 1;
  brief.revision = revision;
  if (briefHashOf(brief) !== brief.briefHash) throw new Error('brief hash mismatch');
  await studioDocs.put('studio-briefs', `${key}--r${revision}`, brief);
  await studioDocs.put('studio-inventories', `${key}--r${revision}`, inventory);
  idx.revisions.push({ revision, briefHash: brief.briefHash, snapshotId: brief.snapshotId, jobId, at: now() });
  idx.latest = revision;
  await studioDocs.put('studio-index', key, idx);
  return { revision, created: true };
}
export async function getBrief(businessKey: string, revision?: number): Promise<{ brief?: BusinessBrief; inventory?: SiteInventory; index?: BriefIndex }> {
  const index = await studioDocs.get<BriefIndex>('studio-index', businessKey);
  const rev = revision ?? index?.latest;
  if (!rev) return { index };
  return { index, brief: await studioDocs.get<BusinessBrief>('studio-briefs', `${businessKey}--r${rev}`), inventory: await studioDocs.get<SiteInventory>('studio-inventories', `${businessKey}--r${rev}`) };
}
void businessKeyOf;
