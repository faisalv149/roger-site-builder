import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { persistDir, restoreDir } from '../files.js';
import { studioDocs } from '../store.js';
import { getBrief, getStudioJob, resumeIfStale, startStudioJob } from '../studio/jobs.js';
import { getConceptJob, getConceptSet, resumeConceptIfStale, startConceptJob, type ConceptJob } from '../studio/concepts/jobs.js';
import { getSiteJob, resumeSiteIfStale, startSiteJob, type SiteJob } from '../studio/concepts/site.js';
import { getReferenceJob, resumeReferenceIfStale, startReferenceJob, type ReferenceJob } from '../studio/concepts/references.js';

/**
 * The concept intake: the client's first preview made by the design engine instead of the plain builder.
 *
 *   brief (Phase 1 research)  →  ranked concepts (render + checks)  →  chosen site (the top-ranked concept, built)
 *
 * Each stage is its own saved, resumable job (Studio job, concept job, site job). This record only says which stage
 * is current and which job holds it, so a Vercel time limit can stop at most the stage that was running: the next poll
 * resumes that stage's job from its own checkpoint (a concept render continues from the next unrendered concept).
 * Saved research is reused: an existing brief for the business, and a finished concept set for that brief.
 *
 * Behind a flag: ROGER_INTAKE_CONCEPTS=1 for every conversation, or per conversation by an authenticated test intake
 * (the inbound API's `intake: "concepts"`). Off by default, so clients keep the builder's preview.
 *
 * The open path, test-only (`intake: "open"` on the authenticated inbound API; never from the flag):
 *
 *   brief  →  references (a saved strategy for this brief revision, else one reference job)  →  open DesignSpec concept
 *          →  full site
 *
 * Each stage is again its own saved job. The run records whether the final design applied the reference strategy.
 */

export type IntakeStage = 'brief' | 'references' | 'concepts' | 'site' | 'done' | 'failed';
export type IntakeMode = 'concepts' | 'open';
type TimedStage = 'brief' | 'references' | 'concepts' | 'site';
export interface IntakeRun {
  id: string;
  input: { placeId: string; website?: string };
  /** 'open': brief → references → open DesignSpec concept → site (test-only); default: the ranked directions */
  mode?: IntakeMode;
  stage: IntakeStage;
  referenceJobId?: string;
  /** the open design: its spec, and whether it used the reference strategy (given to the planner, and patterns it applied) */
  designSpecId?: string;
  references?: { referenceJobId: string | null; provided: boolean; applied: string[]; used: boolean };
  /** the versions made for this conversation (the first is the run's own site), each with its own stable link */
  versions?: IntakeVersion[];
  /** the version being made for one 'Request another version' */
  next?: IntakeNext;
  /** the version the client was last sent (its link), and the one they approved */
  shownVersion?: string;
  approved?: { versionId: string; n: number; designSpecId: string; siteUrl: string; at: string };
  businessKey?: string;
  studioJobId?: string;
  conceptJobId?: string;
  setId?: string;
  conceptId?: string;
  siteJobId?: string;
  siteUrl?: string;
  draftId?: string;
  /** the site job's open review checks, for "check the details" and the approval reply */
  checks?: string[];
  startedAt: string;
  /** per stage: when it started and finished, and whether saved research was reused */
  timings: Partial<Record<TimedStage, { startedAt: string; finishedAt?: string; ms?: number; reused?: boolean; job?: string; steps?: { name: string; ms?: number; status: string }[] }>>;
  error?: string;
  failedStage?: string;
}

export const conceptIntakeEnabled = (requested?: string) => process.env.ROGER_INTAKE_CONCEPTS === '1' || requested === 'concepts';
/** which intake a conversation gets: 'open' only when an authenticated test intake asks for it; the flag never turns it on */
export const intakeModeOf = (requested?: string): IntakeMode | undefined => (requested === 'open' ? 'open' : conceptIntakeEnabled(requested) ? 'concepts' : undefined);

const now = () => new Date().toISOString();
const ms = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : undefined);

export function newIntake(input: IntakeRun['input'], mode?: IntakeMode): IntakeRun {
  return { id: `in_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, input, ...(mode === 'open' ? { mode } : {}), stage: 'brief', startedAt: now(), timings: {} };
}

function begin(run: IntakeRun, stage: TimedStage, extra: { reused?: boolean; job?: string } = {}) {
  run.timings[stage] = { startedAt: now(), ...extra };
}
function finish(run: IntakeRun, stage: TimedStage, steps?: { name: string; ms?: number; status: string }[]) {
  const t = run.timings[stage];
  if (!t) return;
  t.finishedAt = now();
  t.ms = ms(t.startedAt, t.finishedAt);
  if (steps) t.steps = steps;
}
function fail(run: IntakeRun, stage: string, error: string) {
  run.stage = 'failed';
  run.failedStage = stage;
  run.error = error;
}

/** the latest finished concept job for this brief revision (of the same kind): its set is reused instead of rendering again */
async function savedSet(businessKey: string, revision: number, open?: { referenceJobId?: string }): Promise<ConceptJob | undefined> {
  const jobs = await studioDocs.list<ConceptJob>('studio-concept-jobs');
  const kind = (x: ConceptJob) => (open ? x.input.planner === 'open' && !!x.work.designSpecId && (x.input.referenceJobId ?? undefined) === open.referenceJobId : x.input.planner !== 'open');
  for (const j of jobs.filter((x) => x.status === 'done' && x.input.businessKey === businessKey && x.input.revision === revision && kind(x)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const set = await getConceptSet(j.setId);
    if (set?.concepts.length) return j;
  }
  return undefined;
}

/**
 * Move the intake forward as far as it can go right now: resume a stalled stage, start the next one when the current
 * one finished. Safe to call on every poll: it starts nothing that is already running.
 */
export async function advanceIntake(run: IntakeRun): Promise<IntakeRun> {
  // a version requested after the first preview: only that one moves (the first run is finished)
  if (run.next) return versionBusy(run) ? advanceVersion(run) : run;
  for (let step = 0; step < 5; step++) {
    const before = run.stage;
    if (run.stage === 'brief') {
      if (!run.studioJobId && !run.businessKey) {
        // saved research: a brief this business already has
        const key = `place-${run.input.placeId}`;
        const saved = (await getBrief(key).catch(() => ({ brief: undefined }))).brief;
        if (saved) {
          begin(run, 'brief', { reused: true });
          run.businessKey = saved.businessKey;
          finish(run, 'brief');
          run.stage = run.mode === 'open' ? 'references' : 'concepts';
          continue;
        }
        const job = await startStudioJob({ google: run.input.placeId, website: run.input.website });
        run.studioJobId = job.id;
        begin(run, 'brief', { job: job.id });
        return run;
      }
      const job = run.studioJobId ? await getStudioJob(run.studioJobId) : undefined;
      if (!job) { fail(run, 'brief', 'the research job is missing'); return run; }
      const j = await resumeIfStale(job);
      if (j.status === 'failed') { fail(run, `brief: ${j.stages.find((s) => s.status === 'failed')?.name ?? 'research'}`, j.error ?? 'the research failed'); return run; }
      if (j.status !== 'done' || !j.businessKey) return run;
      run.businessKey = j.businessKey;
      finish(run, 'brief', j.stages.map((s) => ({ name: s.name, ms: ms(s.startedAt, s.finishedAt), status: s.status })));
      run.stage = run.mode === 'open' ? 'references' : 'concepts';
    } else if (run.stage === 'references') {
      if (!run.referenceJobId) {
        const { brief } = await getBrief(run.businessKey!);
        if (!brief) { fail(run, 'references', `no brief for ${run.businessKey}`); return run; }
        // saved research: a finished strategy for this brief revision
        const saved = (await studioDocs.list<ReferenceJob>('studio-reference-jobs')).filter((j) => j.status === 'done' && j.work.strategy && j.input.businessKey === brief.businessKey && j.input.revision === brief.revision).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (saved) { begin(run, 'references', { reused: true, job: saved.id }); run.referenceJobId = saved.id; }
        else {
          const job = await startReferenceJob({ businessKey: brief.businessKey, revision: brief.revision }).catch((e: Error) => { fail(run, 'references: start', e.message); return undefined; });
          if (!job) return run;
          run.referenceJobId = job.id;
          begin(run, 'references', { job: job.id });
          return run;
        }
      }
      const found = await getReferenceJob(run.referenceJobId);
      if (!found) { fail(run, 'references', 'the reference job is missing'); return run; }
      const j = await resumeReferenceIfStale(found);
      if (j.status === 'failed') { const st = j.stages.find((s) => s.status === 'failed'); fail(run, `references: ${st?.name ?? 'unknown stage'}`, st?.error ?? j.error ?? 'the reference research failed'); return run; }
      if (j.status !== 'done') return run;
      finish(run, 'references', j.stages.map((s) => ({ name: s.name, ms: ms(s.startedAt, s.finishedAt), status: s.status })));
      run.stage = 'concepts';
    } else if (run.stage === 'concepts') {
      if (!run.conceptJobId) {
        const { brief } = await getBrief(run.businessKey!);
        if (!brief) { fail(run, 'concepts', `no brief for ${run.businessKey}`); return run; }
        const open = run.mode === 'open' ? { referenceJobId: run.referenceJobId } : undefined;
        const saved = await savedSet(brief.businessKey, brief.revision, open);
        if (saved) {
          begin(run, 'concepts', { reused: true, job: saved.id });
          run.conceptJobId = saved.id;
        } else {
          const job = await startConceptJob({ businessKey: brief.businessKey, revision: brief.revision, ...(open ? { planner: 'open' as const, ...(run.referenceJobId ? { referenceJobId: run.referenceJobId } : {}) } : {}) });
          run.conceptJobId = job.id;
          begin(run, 'concepts', { job: job.id });
          return run;
        }
      }
      const found = await getConceptJob(run.conceptJobId);
      if (!found) { fail(run, 'concepts', 'the concept job is missing'); return run; }
      const j = await resumeConceptIfStale(found);
      if (j.status === 'failed') { const st = j.stages.find((s) => s.status === 'failed'); fail(run, `concepts: ${st?.name ?? 'unknown stage'}`, st?.error ?? j.error ?? 'the concept job failed'); return run; }
      if (j.status !== 'done') return run;
      const set = await getConceptSet(j.setId);
      if (!set?.concepts.length) { fail(run, 'concepts', 'the concept set has no concepts'); return run; }
      run.setId = set.id;
      if (run.mode === 'open') {
        // the open planner gave no valid spec: the job fell back to the directions; this intake reports it rather than hide it
        if (!j.work.designSpecId) { fail(run, 'concepts: open planner', `no valid DesignSpec (${j.work.design?.fallback?.reason ?? 'unknown'}); the directions' fallback is not this test path`); return run; }
        run.designSpecId = j.work.designSpecId;
        const r = j.work.design?.references;
        run.references = { referenceJobId: r?.referenceJobId ?? null, provided: !!r?.provided, applied: r?.applied ?? [], used: !!r?.provided && (r?.applied.length ?? 0) > 0 };
      }
      // the client sees the top-ranked concept first; "another version" walks the rest of the saved set
      run.conceptId = set.concepts[0].id;
      finish(run, 'concepts', j.stages.map((s) => ({ name: s.name, ms: ms(s.startedAt, s.finishedAt), status: s.status })));
      run.stage = 'site';
    } else if (run.stage === 'site') {
      if (!run.siteJobId) {
        const job = await startSiteJob(run.setId!, run.conceptId!);
        run.siteJobId = job.id;
        begin(run, 'site', { job: job.id });
        return run;
      }
      const found = await getSiteJob(run.siteJobId);
      if (!found) { fail(run, 'site', 'the site job is missing'); return run; }
      const j: SiteJob = await resumeSiteIfStale(found);
      if (j.status === 'failed') { const st = j.stages.find((s) => s.status === 'failed'); fail(run, `site: ${st?.name ?? 'build'}`, j.error ?? 'the site build failed'); return run; }
      if (j.status !== 'done' || !j.siteUrl) return run;
      run.siteUrl = j.siteUrl;
      run.draftId = j.draftId;
      run.checks = (j.review?.checks ?? []).filter((c) => c.level === 'block' || c.level === 'review').map((c) => c.message.replace(/\.$/, ''));
      finish(run, 'site', j.stages.map((s) => ({ name: s.name, ms: s.ms, status: s.status })));
      run.stage = 'done';
      // the open path: the first version gets its own stable link at once (later versions rebuild the draft's site)
      if (run.mode === 'open') { await ensureFirstVersion(run, true); if (run.versions?.[0]) run.siteUrl = run.versions[0].siteUrl; }
    }
    if (run.stage === before) return run;
  }
  return run;
}

// ───────────────────────── another version (open intake) ─────────────────────────
/**
 * "Request another version" on the open intake: one new DesignSpec from the same saved brief, photos and reference
 * strategy, meaningfully different from every version already shown, built into the same draft, then copied to its own
 * stable link (/sites/<slug>-v<n>/). One request makes one version: the request is recorded as the run's `next`, and
 * every poll only moves that one forward.
 */
export interface IntakeVersion { id: string; n: number; designSpecId: string; setId: string; conceptJobId?: string; siteJobId?: string; siteUrl: string; createdAt: string; references?: IntakeRun['references']; note?: string }
export interface IntakeNext {
  id: string; n: number; requestedAt: string; stage: 'concepts' | 'site' | 'done' | 'failed';
  conceptJobId?: string; setId?: string; designSpecId?: string; siteJobId?: string; versionId?: string;
  timings: Partial<Record<'concepts' | 'site', { startedAt: string; finishedAt?: string; ms?: number; job?: string }>>;
  error?: string; failedStage?: string;
}
export const versionBusy = (run: IntakeRun) => !!run.next && run.next.stage !== 'done' && run.next.stage !== 'failed';
export const intakeBusy = (run: IntakeRun) => versionBusy(run) || (!run.next && run.stage !== 'done' && run.stage !== 'failed');

/** the draft's own site folder, named in its link (/sites/<slug>/) */
export function siteSlugOf(siteUrl: string): string {
  const base = new URL(siteUrl, config.publicBaseUrl).pathname.match(/\/sites\/([a-z0-9-]+)\/?$/i)?.[1];
  if (!base) throw new Error(`not a site link: ${siteUrl}`);
  return base;
}
/** a version's own folder: the business's slug, this conversation's intake and the version number (unique, never reused) */
export const versionSlug = (base: string, runId: string, n: number) => `${base}-${runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}-v${n}`;

/**
 * Copy the draft's built site to a version's own folder. A version's copy is immutable: it is made once (a second copy
 * to the same folder is refused) unless the same saved design is deliberately re-applied (replace). The built site must
 * be this version's design (its homepage carries the design's id), so a build for another conversation in between can
 * never be copied under this version's link.
 */
export async function snapshotVersion(siteUrl: string, slug: string, opts: { designId?: string; replace?: boolean } = {}): Promise<string> {
  const from = path.join(config.dirs.sites, siteSlugOf(siteUrl));
  const to = path.join(config.dirs.sites, slug);
  if (!fs.existsSync(from)) await restoreDir(path.relative(config.dirs.out, from).split(path.sep).join('/')).catch(() => undefined);
  if (opts.designId) {
    const home = fs.existsSync(path.join(from, 'index.html')) ? fs.readFileSync(path.join(from, 'index.html'), 'utf8') : '';
    const built = home.match(/<meta name="roger-design" content="([^"]+)">/)?.[1];
    if (built !== opts.designId) throw new Error(`the built site is design ${built ?? 'unknown'}, not ${opts.designId}: another build replaced it, so it is not copied under this version's link`);
  }
  if (fs.existsSync(to)) {
    if (!opts.replace) throw new Error(`/sites/${slug}/ already holds a version; a version's link never changes`);
    fs.rmSync(to, { recursive: true, force: true });
  }
  fs.cpSync(from, to, { recursive: true });
  await persistDir(to);
  return `${config.publicBaseUrl}/sites/${slug}/`;
}

/**
 * Re-apply a saved version's design to its own link (a fix to the shared rules, say): the version's saved concept is
 * built into the draft again from its saved DesignSpec (no AI, no research) and copied over that version's copy only.
 */
export async function reapplyVersion(run: IntakeRun, versionId: string, wait = 120_000): Promise<IntakeVersion> {
  const v = run.versions?.find((x) => x.id === versionId);
  if (!v) throw new Error(`no version ${versionId}`);
  const job = await startSiteJob(v.setId, 'a');
  const started = Date.now();
  let j = await getSiteJob(job.id);
  while (j && j.status !== 'done' && j.status !== 'failed' && Date.now() - started < wait) { await new Promise((r) => setTimeout(r, 300)); j = await getSiteJob(job.id); }
  if (!j || j.status !== 'done' || !j.siteUrl) throw new Error(`re-applying ${versionId} failed: ${j?.error ?? j?.status ?? 'no job'}`);
  await snapshotVersion(j.siteUrl, siteSlugOf(v.siteUrl), { designId: v.designSpecId, replace: true });
  return v;
}

/** record the first version (the run's own site) under its stable link, once */
async function ensureFirstVersion(run: IntakeRun, fresh = false): Promise<void> {
  if (run.versions?.length || !run.designSpecId || !run.siteUrl || !run.setId) return;
  const url = await snapshotVersion(run.siteUrl, versionSlug(siteSlugOf(run.siteUrl), run.id, 1), { designId: run.designSpecId });
  // a conversation from before versions existed was sent the draft's own link: noted, since that link now follows the latest version
  run.versions = [{ id: `${run.id}-v1`, n: 1, designSpecId: run.designSpecId, setId: run.setId, conceptJobId: run.conceptJobId, siteJobId: run.siteJobId, siteUrl: url, createdAt: now(), references: run.references, ...(!fresh && run.siteUrl && run.siteUrl !== url ? { note: `first sent as ${run.siteUrl} (the draft's own link, which shows the latest version)` } : {}) }];
  run.shownVersion ??= run.versions[0].id;
}

/** "Request another version": records one new version request (never a second while one is being made) */
export async function requestVersion(run: IntakeRun): Promise<'started' | 'busy' | 'unavailable'> {
  if (run.mode !== 'open' || run.stage !== 'done') return 'unavailable';
  if (versionBusy(run)) return 'busy';
  await ensureFirstVersion(run);
  const n = (run.versions?.length ?? 0) + 1;
  run.next = { id: `${run.id}-v${n}`, n, requestedAt: now(), stage: 'concepts', timings: {} };
  return 'started';
}

async function advanceVersion(run: IntakeRun): Promise<IntakeRun> {
  const v = run.next!;
  const failV = (stage: string, error: string) => { v.stage = 'failed'; v.failedStage = stage; v.error = error; };
  for (let step = 0; step < 3 && versionBusy(run); step++) {
    if (v.stage === 'concepts') {
      if (!v.conceptJobId) {
        const { brief } = await getBrief(run.businessKey!);
        if (!brief) { failV('concepts', `no brief for ${run.businessKey}`); break; }
        const job = await startConceptJob({ businessKey: brief.businessKey, revision: brief.revision, planner: 'open', ...(run.referenceJobId ? { referenceJobId: run.referenceJobId } : {}), avoidSpecIds: (run.versions ?? []).map((x) => x.designSpecId) });
        v.conceptJobId = job.id;
        v.timings.concepts = { startedAt: now(), job: job.id };
        break;
      }
      const found = await getConceptJob(v.conceptJobId);
      if (!found) { failV('concepts', 'the concept job is missing'); break; }
      const j = await resumeConceptIfStale(found);
      if (j.status === 'failed') { const st = j.stages.find((s) => s.status === 'failed'); failV(`concepts: ${st?.name ?? 'unknown stage'}`, st?.error ?? j.error ?? 'the concept job failed'); break; }
      if (j.status !== 'done') break;
      if (!j.work.designSpecId) { failV('concepts: open planner', `no meaningfully different DesignSpec (${j.work.design?.fallback?.reason ?? 'unknown'})`); break; }
      const vis = j.work.design?.visual;
      if (vis?.pass === false) { failV('concepts: visual distinctness', `the new version's pages look too close to a version already shown (${vis.pairs.filter((p) => p.pass === false).map((p) => `${p.against}: first screen ${p.heroDesktop}/${p.heroMobile}, page ${p.page}`).join('; ')})`); break; }
      v.setId = j.setId; v.designSpecId = j.work.designSpecId;
      const t = v.timings.concepts; if (t) { t.finishedAt = now(); t.ms = ms(t.startedAt, t.finishedAt); }
      v.stage = 'site';
    } else if (v.stage === 'site') {
      if (!v.siteJobId) {
        const job = await startSiteJob(v.setId!, 'a');
        v.siteJobId = job.id;
        v.timings.site = { startedAt: now(), job: job.id };
        break;
      }
      const found = await getSiteJob(v.siteJobId);
      if (!found) { failV('site', 'the site job is missing'); break; }
      const j: SiteJob = await resumeSiteIfStale(found);
      if (j.status === 'failed') { const st = j.stages.find((s) => s.status === 'failed'); failV(`site: ${st?.name ?? 'build'}`, j.error ?? 'the site build failed'); break; }
      if (j.status !== 'done' || !j.siteUrl) break;
      const url = await snapshotVersion(j.siteUrl, versionSlug(siteSlugOf(j.siteUrl), run.id, v.n), { designId: v.designSpecId });
      const cj = await getConceptJob(v.conceptJobId!);
      const r = cj?.work.design?.references;
      run.versions = [...(run.versions ?? []), { id: v.id, n: v.n, designSpecId: v.designSpecId!, setId: v.setId!, conceptJobId: v.conceptJobId, siteJobId: v.siteJobId, siteUrl: url, createdAt: now(), references: { referenceJobId: r?.referenceJobId ?? null, provided: !!r?.provided, applied: r?.applied ?? [], used: !!r?.provided && (r?.applied.length ?? 0) > 0 } }];
      run.checks = (j.review?.checks ?? []).filter((c) => c.level === 'block' || c.level === 'review').map((c) => c.message.replace(/\.$/, ''));
      v.versionId = v.id;
      const t = v.timings.site; if (t) { t.finishedAt = now(); t.ms = ms(t.startedAt, t.finishedAt); }
      v.stage = 'done';
    }
  }
  return run;
}
