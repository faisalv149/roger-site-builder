import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { studioDocs } from '../../store.js';
import { config } from '../../config.js';
import { getBrief } from '../jobs.js';
import { sha256, stableStringify } from '../snapshot.js';
import { aiJson, conceptCapUsd, conceptModel, CostCapExceeded, CostLedger, defaultTransport, type AiTransport } from './ai.js';
import { compose, fallbackPlans, fromAnswer, PLAN_SCHEMA, planPrompt, PROMPT_VERSION, validatePlans } from './plan.js';
import { renderSet, preparePhotos, setDir, type Rendered } from './render.js';
import { emptyReview, getReview, publicationGate, resolveCatalog, saveReview, StaleBrief, type Catalog } from './review.js';
import { checkConcept, distinctness } from './validate.js';
import { HEARTBEAT_MS, keepAlive, STALE_MS } from '../keepalive.js';
import { persistDir, restoreDir } from '../../files.js';
import type { Concept, ConceptSet, DirectionPlan, UsageRecord } from './types.js';

/**
 * Concept jobs: resolve → photos → directions → compose → render → validate. Like Phase 1's jobs, each is saved
 * before it starts and after every stage, so it can be watched and resumed from its first unfinished stage; the AI's
 * spending so far travels with it, so a resumed job keeps to the same cap.
 */

export const CONCEPT_STAGES = ['resolve', 'photos', 'directions', 'compose', 'render', 'validate'] as const;
type Stage = (typeof CONCEPT_STAGES)[number];
export interface ConceptJob {
  id: string; createdAt: string; updatedAt: string; status: 'queued' | 'running' | 'done' | 'failed';
  input: { businessKey: string; revision: number; reviewId: string };
  setId: string;
  stages: { name: Stage; status: 'pending' | 'running' | 'done' | 'failed'; attempts: number; notes: string[]; error?: string; startedAt?: string; finishedAt?: string }[];
  work: { photos?: string[]; plans?: DirectionPlan[]; planSource?: 'ai' | 'fallback'; concepts?: Concept[]; calls: UsageRecord[]; rendered?: Rendered[] };
  error?: string;
  resumes: number;
}
export interface ConceptHooks { transport?: AiTransport | null; fetchImage?: (url: string) => Promise<Buffer | null> }

const now = () => new Date().toISOString();
const save = (j: ConceptJob) => studioDocs.put('studio-concept-jobs', j.id, { ...j, updatedAt: now() });
export const getConceptJob = (id: string) => studioDocs.get<ConceptJob>('studio-concept-jobs', id);
export const getConceptSet = (id: string) => studioDocs.get<ConceptSet>('studio-concept-sets', id);
const active = new Map<string, Promise<ConceptJob>>();

/** Start a concept set for a pinned brief revision and a review of it (an empty review when none is given). */
export async function startConceptJob(input: { businessKey: string; revision?: number; briefHash?: string; reviewId?: string }, hooks: ConceptHooks = {}): Promise<ConceptJob> {
  const { brief } = await getBrief(input.businessKey, input.revision);
  if (!brief) throw new StaleBrief(`No brief for ${input.businessKey}${input.revision ? ` revision ${input.revision}` : ''}.`);
  if (input.briefHash && input.briefHash !== brief.briefHash) throw new StaleBrief(`Revision ${brief.revision} of ${brief.businessKey} has hash ${brief.briefHash.slice(0, 12)}, not ${input.briefHash.slice(0, 12)}.`);
  let reviewId = input.reviewId;
  if (reviewId) { const r = await getReview(reviewId); if (!r) throw new StaleBrief(`No review ${reviewId}.`); }
  else reviewId = (await saveReview(emptyReview({ businessKey: brief.businessKey, revision: brief.revision, briefHash: brief.briefHash }))).id;
  const t = now();
  const job: ConceptJob = {
    id: `cj_${randomUUID().replace(/-/g, '').slice(0, 12)}`, createdAt: t, updatedAt: t, status: 'queued',
    input: { businessKey: brief.businessKey, revision: brief.revision, reviewId }, setId: `cs_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    stages: CONCEPT_STAGES.map((name) => ({ name, status: 'pending', attempts: 0, notes: [] })), work: { calls: [] }, resumes: 0,
  };
  await save(job);
  void keepAlive(runConceptJob(job.id, hooks));
  return job;
}

export function runConceptJob(id: string, hooks: ConceptHooks = {}): Promise<ConceptJob> {
  const running = active.get(id);
  if (running) return running;
  const p = run(id, hooks).finally(() => active.delete(id));
  active.set(id, p);
  return p;
}
export async function resumeConceptJob(id: string, hooks: ConceptHooks = {}) {
  const job = await getConceptJob(id);
  if (!job || job.status === 'done') return job;
  job.resumes++;
  for (const s of job.stages) if (s.status !== 'done') { s.status = 'pending'; s.error = undefined; }
  job.status = 'queued'; job.error = undefined;
  await save(job);
  void keepAlive(runConceptJob(id, hooks));
  return job;
}
/** picked up again by the poll that finds it running nowhere (see src/studio/keepalive.ts) */
export async function resumeConceptIfStale(job: ConceptJob): Promise<ConceptJob> {
  if ((job.status === 'running' || job.status === 'queued') && !active.has(job.id) && Date.now() - Date.parse(job.updatedAt) > STALE_MS()) return (await resumeConceptJob(job.id)) ?? job;
  return job;
}
export async function waitForConceptJob(id: string, timeoutMs = 900_000): Promise<ConceptJob> {
  const started = Date.now();
  for (;;) {
    const p = active.get(id);
    if (p) await p.catch(() => undefined);
    const j = await getConceptJob(id);
    if (j && !active.has(id) && (j.status === 'done' || j.status === 'failed')) return j;
    if (Date.now() - started > timeoutMs) throw new Error(`concept job ${id} did not finish in time`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function run(id: string, hooks: ConceptHooks): Promise<ConceptJob> {
  const job = (await getConceptJob(id))!;
  job.status = 'running';
  await save(job);
  const { brief, inventory } = await getBrief(job.input.businessKey, job.input.revision);
  const review = await getReview(job.input.reviewId);
  const ledger = new CostLedger(conceptCapUsd(), job.setId);
  const logged = (await studioDocs.list<UsageRecord>('studio-ai-usage')).filter((u) => u.setId === job.setId);
  ledger.calls = logged.length >= job.work.calls.length ? logged.sort((a, b) => a.at.localeCompare(b.at)) : [...job.work.calls];
  let cat: Catalog | undefined;
  const transport = hooks.transport !== undefined ? hooks.transport : defaultTransport();
  for (const st of job.stages) {
    if (st.status === 'done') continue;
    st.status = 'running'; st.attempts++; st.startedAt = now(); st.error = undefined;
    await save(job);
    const beat = setInterval(() => { void save(job); }, HEARTBEAT_MS);
    const note = (s: string) => { if (!st.notes.includes(s)) st.notes.push(s); };
    try {
      if (!brief || !inventory || !review) throw new Error('the brief, inventory or review is missing');
      cat = resolveCatalog(brief, inventory, review);
      if (job.work.photos) cat.photos = cat.photos.filter((p) => job.work.photos!.includes(p.id));
      switch (st.name) {
        case 'resolve':
          note(`${Object.keys(cat.facts).length} facts usable in previews; ${cat.omitted.length} left out until the owner answers: ${cat.omitted.map((o) => o.what).join('; ') || 'none'}`);
          note(`${cat.actions.length} actions: ${cat.actions.map((a) => a.label).join(', ')}`);
          break;
        case 'photos': {
          const r = await preparePhotos(cat, job.setId, hooks.fetchImage);
          job.work.photos = r.ok.filter((x) => x !== 'logo');
          note(`${job.work.photos.length} of the business's photos copied into the preview${r.failed.length ? `; ${r.failed.length} could not be: ${r.failed.map((f) => `${f.id} (${f.reason})`).join(', ')}` : ''}`);
          break;
        }
        case 'directions': {
          let plans: DirectionPlan[] | null = null;
          if (transport) {
            const { system, prompt } = planPrompt(cat, brief);
            try {
              const r = await aiJson<{ concepts: Record<string, unknown>[] }>({ stage: 'directions', system, prompt, schema: PLAN_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 24_000 }, { transport, ledger, validate: (d) => validatePlans(fromAnswer(d), cat!) });
              for (const x of r.rejected) note(`attempt ${x.attempt} rejected (${x.errors.length} problem(s)): ${x.errors.slice(0, 4).join('; ')}${x.errors.length > 4 ? '; …' : ''}`);
              // the last answer is sound apart from some wording: keep it, with those lines back to the plain default copy
              if (!r.data && r.last && !validatePlans(fromAnswer(r.last), cat, { copy: false }).length) {
                plans = fromAnswer(r.last);
                note(`Claude's last answer was kept: its structure passes every rule; ${r.errors.length} line(s) of copy that did not (${r.errors.slice(0, 3).join('; ')}) use the default wording instead`);
              }
              if (r.data) { plans = fromAnswer(r.data); note(`Claude (${transport.model}, via ${transport.via}) proposed three directions that pass every rule, after ${r.attempts} attempt(s)`); }
              else if (!plans) note(`Claude's directions still broke ${r.errors.length} rule(s) after ${r.attempts} attempts (${r.errors.slice(0, 3).join('; ')}); the deterministic planner is used instead`);
            } catch (e) {
              if (!(e instanceof CostCapExceeded)) throw e;
              note(`${e.message} The deterministic planner is used instead.`);
            }
          } else note('Claude is off here: the deterministic planner assigns the library variants');
          job.work.planSource = plans ? 'ai' : 'fallback';
          plans ??= fallbackPlans(cat, brief);
          const errs = validatePlans(plans, cat);
          if (errs.length) note(`the plans break ${errs.length} rule(s): ${errs.slice(0, 4).join('; ')}`);
          job.work.plans = plans;
          job.work.calls = ledger.calls;
          note(`AI spend: $${ledger.spentUsd.toFixed(4)} of the $${ledger.capUsd} cap, ${ledger.calls.length} call(s) (${ledger.calls.filter((c) => c.cacheHit).length} from the cache)`);
          break;
        }
        case 'compose': {
          const plans = job.work.plans!;
          const brandIdx = Math.max(0, plans.findIndex((p) => p.axes.colorStrategy === 'brand-dominant'));
          job.work.concepts = plans.map((p, i) => compose(p, (['a', 'b', 'c'] as const)[i], job.work.planSource ?? 'fallback', cat!, brief, i === brandIdx));
          for (const c of job.work.concepts) note(`${c.id.toUpperCase()} "${c.name}": ${c.sections.map((s) => `${s.kind}:${s.variant}`).join(' → ')} · ${c.axes.typeVoice}, ${c.axes.colorStrategy} (${c.tokens.fonts.heading.family})`);
          break;
        }
        case 'render': {
          await preparePhotos(cat, job.setId, hooks.fetchImage); // a no-op when this instance already has them
          job.work.rendered = await renderSet(job.work.concepts!, cat, job.setId);
          await persistDir(setDir(job.setId)); // previews outlive this instance (Supabase Storage on Vercel)
          for (const r of job.work.rendered) note(`${r.conceptId.toUpperCase()}: desktop ${r.desktop.metrics.height}px tall, mobile ${r.mobile.metrics.height}px`);
          break;
        }
        case 'validate': {
          const concepts = job.work.concepts!, rendered = job.work.rendered!;
          if (!fs.existsSync(rendered[0].desktop.hero)) await restoreDir(path.relative(config.dirs.out, setDir(job.setId)).split(path.sep).join('/'));
          for (const c of concepts) {
            const r = rendered.find((x) => x.conceptId === c.id)!;
            c.checks = checkConcept(c, r, cat);
            const rel = (f: string) => path.relative(setDir(job.setId), f).replace(/\\/g, '/');
            c.preview = { html: rel(r.html), desktop: rel(r.desktop.full), mobile: rel(r.mobile.full), desktopHero: rel(r.desktop.hero), mobileHero: rel(r.mobile.hero), desktopHeight: r.desktop.metrics.height, mobileHeight: r.mobile.metrics.height };
          }
          const dist = await distinctness(concepts, rendered);
          const gate = publicationGate(brief, cat, review, concepts, { id: job.setId, conceptIds: concepts.map((c) => c.id) });
          const failing = concepts.flatMap((c) => c.checks.filter((x) => x.level === 'fail').map((x) => `${c.id.toUpperCase()} ${x.id}`));
          const checks = [
            { id: 'distinct', level: dist.pairs.every((p) => p.pass) ? 'pass' as const : 'fail' as const, message: dist.pairs.map((p) => `${p.a.toUpperCase()}–${p.b.toUpperCase()}: ${p.plan.length} plan differences; screenshot structure similarity ${p.heroDesktop} desktop first screen, ${p.heroMobile} mobile, ${p.page} whole page${p.pass ? '' : ' (too similar)'}`).join(' · ') },
            { id: 'concepts', level: failing.length ? 'fail' as const : 'pass' as const, message: failing.length ? `failing: ${failing.join(', ')}` : 'All three concepts pass grounding, rights, links and accessibility.' },
            { id: 'cost', level: ledger.spentUsd <= ledger.capUsd ? 'pass' as const : 'fail' as const, message: `$${ledger.spentUsd.toFixed(4)} spent of the $${ledger.capUsd} cap in ${ledger.calls.length} call(s)` },
          ];
          const set: Omit<ConceptSet, 'setHash'> = {
            schema: 'roger.concept-set', version: 1, id: job.setId, brief: review.brief, reviewId: review.id, mode: 'preview', model: transport?.model ?? conceptModel(), promptVersion: PROMPT_VERSION, createdAt: job.createdAt,
            concepts, distinctness: dist, checks, cost: { capUsd: ledger.capUsd, spentUsd: ledger.spentUsd, calls: ledger.calls }, gate,
          };
          const setHash = sha256(stableStringify({ brief: set.brief, reviewId: set.reviewId, concepts: concepts.map((c) => ({ ...c, checks: undefined, preview: undefined })) }));
          await studioDocs.put('studio-concept-sets', job.setId, { ...set, setHash });
          fs.writeFileSync(path.join(setDir(job.setId), 'set.json'), JSON.stringify({ ...set, setHash }, null, 2));
          await persistDir(setDir(job.setId));
          note(checks.map((c) => `${c.id}: ${c.level}`).join(' · '));
          note(`publication gate: ${gate.publishable ? 'clear' : `${gate.blockers.length} blocker(s)`}`);
          break;
        }
      }
      clearInterval(beat);
      st.status = 'done'; st.finishedAt = now();
      job.work.calls = ledger.calls;
      await save(job);
    } catch (e) {
      clearInterval(beat);
      st.status = 'failed'; st.error = (e as Error).message.slice(0, 400); st.finishedAt = now();
      job.status = 'failed'; job.error = `${st.name}: ${st.error}`;
      job.work.calls = ledger.calls;
      await save(job);
      console.warn(`[concepts ${id}] ${job.error}`);
      return job;
    }
  }
  job.status = 'done';
  await save(job);
  return job;
}
