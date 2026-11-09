import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { studioDocs } from '../../store.js';
import { config } from '../../config.js';
import { getBrief } from '../jobs.js';
import { sha256, stableStringify } from '../snapshot.js';
import { aiJson, conceptCapUsd, conceptModel, CostCapExceeded, CostLedger, defaultTransport, type AiTransport } from './ai.js';
import { compose, fromAnswer, PLAN_SCHEMA, planPrompt, PROMPT_VERSION, validatePlans } from './plan.js';
import { conceptLetter, photoRole, rankDirections, rankPlans } from './directions.js';
import { renderSet, preparePhotos, setDir, type Rendered } from './render.js';
import { emptyReview, getReview, publicationGate, resolveCatalog, saveReview, StaleBrief, type Catalog } from './review.js';
import { checkConcept, distinctness } from './validate.js';
import { HEARTBEAT_MS, keepAlive, STALE_MS } from '../keepalive.js';
import { persistDir, restoreDir } from '../../files.js';
import { isListing, judgeListingPhotos, matchLive, parseListing, type ListingJudgement } from './listing-photos.js';
import { labelPhotos, LABEL_LIMIT } from '../../design/photos.js';
import type { Concept, ConceptSet, DirectionPlan, DirectionRanking, UsageRecord } from './types.js';

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
  work: { photos?: string[]; /** what an image check saw in each undescribed photo, by id */ seen?: Record<string, { kind: string; seen?: string }>; listing?: { labelled: string; note?: string; items: ListingJudgement[] }; plans?: DirectionPlan[]; ranking?: DirectionRanking; planSource?: 'ai' | 'fallback'; concepts?: Concept[]; calls: UsageRecord[]; rendered?: Rendered[] };
  error?: string;
  resumes: number;
}
export interface ConceptHooks { /** the image check (vision) for undescribed photos; null: none */ label?: typeof labelPhotos | null; transport?: AiTransport | null; fetchImage?: (url: string) => Promise<Buffer | null>; judgeListing?: typeof judgeListingPhotos; render?: typeof renderSet; chunkRender?: boolean }

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
  // A Vercel render yields after each concept. The next status poll gives it a
  // fresh function invocation; the completed concepts are already in storage.
  if (job.status === 'queued' && job.stages.find((s) => s.name === 'render')?.status === 'pending' && job.work.rendered?.length && !active.has(job.id)) {
    void keepAlive(runConceptJob(job.id));
    return job;
  }
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
      // what the image check saw in undescribed photos (saved with the job, so a resumed stage or a re-render uses the same)
      if (job.work.seen) for (const p of cat.photos) { const v = job.work.seen[p.id]; if (v) { p.seenKind = v.kind; if (v.seen) p.seen = v.seen; } }
      switch (st.name) {
        case 'resolve':
          note(`${Object.keys(cat.facts).length} facts usable in previews; ${cat.omitted.length} left out until the owner answers: ${cat.omitted.map((o) => o.what).join('; ') || 'none'}`);
          note(`${cat.actions.length} actions: ${cat.actions.map((a) => a.label).join(', ')}`);
          break;
        case 'photos': {
          const r = await preparePhotos(cat, job.setId, hooks.fetchImage);
          await persistDir(setDir(job.setId)); // the render may start on a different Vercel instance
          const own = r.ok.filter((x) => x !== 'logo');
          note(`${own.length} of the business's photos copied into the preview${r.failed.length ? `; ${r.failed.length} could not be: ${r.failed.map((f) => `${f.id} (${f.reason})`).join(', ')}` : ''}`);
          // the Google listing's photos (only when the website gives too few): looked at once for relevance, never stored
          const listed = cat.photos.filter(isListing);
          let fits: string[] = [];
          if (listed.length) {
            const placeId = parseListing(listed[0].url)!.placeId;
            const j = await (hooks.judgeListing ?? judgeListingPhotos)(placeId, { name: cat.business.name, category: cat.business.category ?? undefined }).catch((e) => { note(`the Google listing's photos could not be looked at (${(e as Error).message}); none are used`); return undefined; });
            if (j) {
              const byN = new Map(j.items.map((x) => [x.n, x]));
              fits = listed.filter((p) => matchLive(j.items, parseListing(p.url)!.n, `${p.width}x${p.height}`)?.eligible).map((p) => p.id);
              job.work.listing = { labelled: j.labelled, ...(j.note ? { note: j.note } : {}), items: j.items };
              const out = j.items.filter((x) => !x.eligible);
              note(`${j.items.length} Google listing photo(s) looked at (${j.labelled === 'vision' ? 'by Claude' : j.labelled === 'fixture' ? 'sample labels' : 'not labelled: ranked by size only'}): ${fits.length} fit the business${out.length ? `; left out: ${out.map((x) => `#${x.n} ${x.reason}`).join('; ')}` : ''}. Shown live with credit; preview only.`);
            }
          }
          job.work.photos = [...own, ...fits];
          // the business's own photos with no description: an image check says what each shows, so a photo's subject is
          // verified before it can lead a page (never guessed from its size or position)
          const label = hooks.label === undefined ? labelPhotos : hooks.label;
          const blind = cat.photos.filter((p) => own.includes(p.id) && !isListing(p) && photoRole(p, cat!).role === 'unknown');
          if (label && blind.length) {
            const seen: NonNullable<ConceptJob['work']['seen']> = {};
            for (let i = 0; i < blind.length; i += LABEL_LIMIT) {
              const chunk = blind.slice(i, i + LABEL_LIMIT).filter((p) => fs.existsSync(path.join(setDir(job.setId), 'img', `${p.id}.jpg`)));
              if (!chunk.length) continue;
              const items = chunk.map((p) => ({ raw: fs.readFileSync(path.join(setDir(job.setId), 'img', `${p.id}.jpg`)), photo: { ref: p.id, width: p.width, height: p.height, authors: [] }, image: { publicPath: '', width: p.width, height: p.height, alt: '', source: 'website' as const } }));
              // one retry: a vision call can fail transiently (the photos then simply stay unverified)
              const ask = () => label(items as never, { name: cat!.business.name, category: cat!.business.category ?? undefined }).catch(() => undefined);
              let r = await ask();
              if (r?.source !== 'vision') r = await ask();
              if (r?.source === 'vision') chunk.forEach((p, k) => { if (r.kinds[k] !== 'unknown') seen[p.id] = { kind: r.kinds[k], ...(r.seen[k] ? { seen: r.seen[k] } : {}) }; });
            }
            job.work.seen = seen;
            const n = Object.keys(seen).length;
            note(n ? `image check: ${n} of ${blind.length} undescribed photo(s) identified (${Object.values(seen).map((v) => v.seen ?? v.kind).slice(0, 6).join('; ')}${n > 6 ? '; …' : ''})` : `image check: none of ${blind.length} undescribed photo(s) could be identified (vision unavailable or no answer); they will not lead a page`);
          }
          if (!job.work.photos.length) note('no usable photos: the concepts will say so and need the owner\'s photos');
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
              if (r.data) { plans = fromAnswer(r.data); note(`Claude (${transport.model}, via ${transport.via}) proposed ${plans.length} direction(s) that pass every rule, after ${r.attempts} attempt(s)`); }
              else if (!plans) note(`Claude's directions still broke ${r.errors.length} rule(s) after ${r.attempts} attempts (${r.errors.slice(0, 3).join('; ')}); the deterministic planner is used instead`);
            } catch (e) {
              if (!(e instanceof CostCapExceeded)) throw e;
              note(`${e.message} The deterministic planner is used instead.`);
            }
          } else note('Claude is off here: the deterministic planner assigns the library variants');
          job.work.planSource = plans ? 'ai' : 'fallback';
          // ranked either way: the library's recipes for this business, or Claude's directions in the library's order of strength
          const ranked = plans ? rankPlans(plans, cat, brief) : rankDirections(cat, brief);
          plans = ranked.plans;
          job.work.ranking = ranked.ranking;
          for (const c of ranked.ranking.considered) note(`${c.status === 'kept' ? `${c.conceptId!.toUpperCase()} kept` : `left out (${c.status})`}: "${c.name}" (${c.directionId}, fit ${c.score})${c.reasons.length ? ` — ${c.reasons.slice(0, 2).join('; ')}` : ''}`);
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
          job.work.concepts = plans.map((p, i) => compose(p, conceptLetter(i), job.work.planSource ?? 'fallback', cat!, brief, i === brandIdx));
          for (const c of job.work.concepts) note(`${c.id.toUpperCase()} "${c.name}": ${c.sections.map((s) => `${s.kind}:${s.variant}`).join(' → ')} · ${c.axes.typeVoice}, ${c.axes.colorStrategy} (${c.tokens.fonts.heading.family})`);
          break;
        }
        case 'render': {
          const dir = setDir(job.setId);
          // A resumed function may land on a fresh instance. Restore the images
          // and screenshots before making another page or validating the set.
          const started = Date.now();
          await restoreDir(path.relative(config.dirs.out, dir).split(path.sep).join('/'));
          note(`restored saved photos in ${Date.now() - started} ms`);
          const completed = job.work.rendered ?? [];
          const next = job.work.concepts!.filter((c) => !completed.some((r) => r.conceptId === c.id));
          // Each Vercel invocation owns one fresh browser and one concept. A
          // timeout can then only restart that concept, never erase A or B.
          const batch = process.env.VERCEL || hooks.chunkRender ? next.slice(0, 1) : next;
          const photosAt = Date.now();
          await preparePhotos(cat, job.setId, hooks.fetchImage, new Set(batch.flatMap((c) => c.images)));
          note(`prepared ${batch.map((c) => c.id.toUpperCase()).join(', ')} photos in ${Date.now() - photosAt} ms`);
          const rendered = batch.length ? await (hooks.render ?? renderSet)(batch, cat, job.setId, {
            onStep: (label, ms) => { const line = `${label}: ${ms} ms`; note(line); console.info(`[concepts ${id}] ${line}`); },
          }) : [];
          const savedAt = Date.now();
          await persistDir(dir); // persist files before recording their checkpoint
          note(`saved render files in ${Date.now() - savedAt} ms`);
          job.work.rendered = [...completed, ...rendered];
          await save(job);
          for (const r of job.work.rendered) note(`${r.conceptId.toUpperCase()}: desktop ${r.desktop.metrics.height}px tall, mobile ${r.mobile.metrics.height}px`);
          if (job.work.rendered.length < job.work.concepts!.length) {
            clearInterval(beat);
            st.status = 'pending'; st.finishedAt = now();
            job.status = 'queued';
            await save(job);
            return job;
          }
          break;
        }
        case 'validate': {
          const all = job.work.concepts!, rendered = job.work.rendered!;
          if (!fs.existsSync(rendered[0].desktop.hero)) await restoreDir(path.relative(config.dirs.out, setDir(job.setId)).split(path.sep).join('/'));
          for (const c of all) {
            const r = rendered.find((x) => x.conceptId === c.id)!;
            c.checks = checkConcept(c, r, cat, cat.photos.length);
            const rel = (f: string) => path.relative(setDir(job.setId), f).replace(/\\/g, '/');
            c.preview = { html: rel(r.html), desktop: rel(r.desktop.full), mobile: rel(r.mobile.full), desktopHero: rel(r.desktop.hero), mobileHero: rel(r.mobile.hero), desktopHeight: r.desktop.metrics.height, mobileHeight: r.mobile.metrics.height };
          }
          const measured = await distinctness(all, all.map((c) => rendered.find((x) => x.conceptId === c.id)!));
          // a direction whose rendered pages come out too close to a stronger one is dropped (the set gets smaller,
          // never weaker): pairs run strongest-first, so the second of a failing pair is the lower-ranked one
          const dropped = new Map<string, string>();
          for (const p of measured.pairs) if (!p.pass && !dropped.has(p.a) && !dropped.has(p.b) && all.length - dropped.size > 1) dropped.set(p.b, p.a);
          const concepts = all.filter((c) => !dropped.has(c.id));
          for (const [id, by] of dropped) {
            note(`${id.toUpperCase()} left out: its rendered pages are too close to ${by.toUpperCase()}'s`);
            const entry = job.work.ranking?.considered.find((x) => x.conceptId === id);
            if (entry) { entry.status = 'duplicate'; entry.reasons = [`rendered too close to ${by.toUpperCase()} (screenshot structure)`, ...entry.reasons]; delete entry.conceptId; }
          }
          const dist = { pairs: measured.pairs.filter((p) => !dropped.has(p.a) && !dropped.has(p.b)), thresholds: measured.thresholds };
          const gate = publicationGate(brief, cat, review, concepts, { id: job.setId, conceptIds: concepts.map((c) => c.id) });
          const failing = concepts.flatMap((c) => c.checks.filter((x) => x.level === 'fail').map((x) => `${c.id.toUpperCase()} ${x.id}`));
          const checks = [
            { id: 'distinct', level: dist.pairs.every((p) => p.pass) ? 'pass' as const : 'fail' as const, message: dist.pairs.map((p) => `${p.a.toUpperCase()}–${p.b.toUpperCase()}: ${p.plan.length} plan differences; screenshot structure similarity ${p.heroDesktop} desktop first screen, ${p.heroMobile} mobile, ${p.page} whole page${p.pass ? '' : ' (too similar)'}`).join(' · ') },
            { id: 'concepts', level: failing.length ? 'fail' as const : 'pass' as const, message: failing.length ? `failing: ${failing.join(', ')}` : `All ${concepts.length} concept(s) pass grounding, rights, links and accessibility.` },
            { id: 'cost', level: ledger.spentUsd <= ledger.capUsd ? 'pass' as const : 'fail' as const, message: `$${ledger.spentUsd.toFixed(4)} spent of the $${ledger.capUsd} cap in ${ledger.calls.length} call(s)` },
          ];
          const set: Omit<ConceptSet, 'setHash'> = {
            schema: 'roger.concept-set', version: 1, id: job.setId, brief: review.brief, reviewId: review.id, mode: 'preview', model: transport?.model ?? conceptModel(), promptVersion: PROMPT_VERSION, createdAt: job.createdAt,
            concepts, ...(job.work.ranking ? { ranking: job.work.ranking } : {}), distinctness: dist, checks, cost: { capUsd: ledger.capUsd, spentUsd: ledger.spentUsd, calls: ledger.calls }, gate,
            photos: photoTraceOf(cat, job.work.listing, concepts, rendered),
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

/**
 * The set's photo trace: what the website and the Google listing offered, what fitted, and what each concept shows
 * (counted on the rendered page). Google photos are recorded by their place in the listing only.
 */
function photoTraceOf(cat: Catalog, listing: ConceptJob['work']['listing'], concepts: Concept[], rendered: Rendered[]): NonNullable<ConceptSet['photos']> {
  const website = cat.photos.filter((p) => !isListing(p)).length;
  const fit = cat.photos.filter(isListing).length;
  return {
    website,
    listing: listing ? { found: listing.items.length, fit, labelled: listing.labelled, items: listing.items.map((x) => ({ n: x.n, size: `${x.width}×${x.height}`, kind: x.kind, ...(x.seen ? { seen: x.seen } : {}), eligible: x.eligible, ...(x.reason ? { reason: x.reason } : {}) })) } : undefined,
    shown: Object.fromEntries(concepts.map((c) => {
      const r = rendered.find((x) => x.conceptId === c.id)!;
      const ids = new Set(r.desktop.metrics.images.map((i) => i.asset).filter((x): x is string => !!x && x !== 'logo'));
      return [c.id, { total: ids.size, google: [...ids].filter((id) => cat.photos.some((p) => p.id === id && isListing(p))).length }];
    })),
  };
}
