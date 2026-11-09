import { studioDocs } from '../store.js';
import { getBrief, getStudioJob, resumeIfStale, startStudioJob } from '../studio/jobs.js';
import { getConceptJob, getConceptSet, resumeConceptIfStale, startConceptJob, type ConceptJob } from '../studio/concepts/jobs.js';
import { getSiteJob, resumeSiteIfStale, startSiteJob, type SiteJob } from '../studio/concepts/site.js';

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
 */

export type IntakeStage = 'brief' | 'concepts' | 'site' | 'done' | 'failed';
export interface IntakeRun {
  id: string;
  input: { placeId: string; website?: string };
  stage: IntakeStage;
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
  timings: Partial<Record<'brief' | 'concepts' | 'site', { startedAt: string; finishedAt?: string; ms?: number; reused?: boolean; job?: string; steps?: { name: string; ms?: number; status: string }[] }>>;
  error?: string;
  failedStage?: string;
}

export const conceptIntakeEnabled = (requested?: string) => process.env.ROGER_INTAKE_CONCEPTS === '1' || requested === 'concepts';

const now = () => new Date().toISOString();
const ms = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : undefined);

export function newIntake(input: IntakeRun['input']): IntakeRun {
  return { id: `in_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, input, stage: 'brief', startedAt: now(), timings: {} };
}

function begin(run: IntakeRun, stage: 'brief' | 'concepts' | 'site', extra: { reused?: boolean; job?: string } = {}) {
  run.timings[stage] = { startedAt: now(), ...extra };
}
function finish(run: IntakeRun, stage: 'brief' | 'concepts' | 'site', steps?: { name: string; ms?: number; status: string }[]) {
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

/** the latest finished concept job for this brief revision: its set is reused instead of rendering again */
async function savedSet(businessKey: string, revision: number): Promise<ConceptJob | undefined> {
  const jobs = await studioDocs.list<ConceptJob>('studio-concept-jobs');
  for (const j of jobs.filter((x) => x.status === 'done' && x.input.businessKey === businessKey && x.input.revision === revision).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
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
  for (let step = 0; step < 4; step++) {
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
          run.stage = 'concepts';
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
      run.stage = 'concepts';
    } else if (run.stage === 'concepts') {
      if (!run.conceptJobId) {
        const { brief } = await getBrief(run.businessKey!);
        if (!brief) { fail(run, 'concepts', `no brief for ${run.businessKey}`); return run; }
        const saved = await savedSet(brief.businessKey, brief.revision);
        if (saved) {
          begin(run, 'concepts', { reused: true, job: saved.id });
          run.conceptJobId = saved.id;
        } else {
          const job = await startConceptJob({ businessKey: brief.businessKey, revision: brief.revision });
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
    }
    if (run.stage === before) return run;
  }
  return run;
}
