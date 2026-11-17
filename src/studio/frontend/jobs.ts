import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { studioDocs } from '../../store.js';
import { config } from '../../config.js';
import { keepAlive } from '../keepalive.js';
import { getBrief } from '../jobs.js';
import { emptyReview, getReview, resolveCatalog, type Catalog } from '../concepts/review.js';
import { getConceptJob, type ConceptJob } from '../concepts/jobs.js';
import { CostLedger, aiJson, defaultTransport, type AiTransport } from '../concepts/ai.js';
import { applyPhotoChecks, observeCatalogPhotos, isListing, fillListingPhotos, judgeListingPhotos, parseListing } from '../concepts/listing-photos.js';
import { photoFingerprint } from '../../design/fingerprint.js';
import { identityKnown } from '../concepts/designspec.js';
import { undatedSeasonal } from '../../util/text.js';
import { CODE_SCHEMA, FRONTEND_PROMPT, PIPELINE_REV, checkCode, compilePage, editProblems, editableText, type FrontendCode, type FrontendInput } from './page.js';
import { gatePhotos, type PhotoDecision } from './media-gate.js';
import { reviewPages, type SiteReview } from './review.js';
import { checkSite, compileSite, generateSitePages, planPages, type SiteCode, type SitePage } from './site.js';
import type { ReferenceJob } from '../concepts/references.js';
import type { BusinessBrief } from '../schema.js';

export interface FrontendJob {
  id: string; createdAt: string; updatedAt: string;
  sourceJobId?: string; businessKey: string; revision: number; instruction: string;
  status: 'queued' | 'generating' | 'needs-review' | 'failed';
  input: FrontendInput; code?: FrontendCode; attempts: number; costUsd: number; calls: CostLedger['calls'];
  error?: string; previewUrl?: string;
  checks: { static: 'pending' | 'passed'; browser: 'pending' | 'passed' | 'failed'; copy: 'owner-review-required'; publication: 'disabled' };
  /** the pipeline revision this version was made under (rules and rendering); absent = 1, the original */
  rev?: number;
  /** photos kept off this version by the media gate or by staff, each with its rule and reason; never shown again */
  withheldPhotos?: PhotoDecision[];
  /** the rendered-page review (every page at desktop and phone widths) */
  review?: SiteReview;
  /** whether the preview may go to the customer without a staff decision, and if not, why */
  delivery?: { auto: boolean; reasons: string[] };
  /** the site's inner pages (chosen from its content) and their code, written in the homepage's visual language */
  pages?: SitePage[]; site?: SiteCode;
  /** which part is being written while generating */
  /** 'checks': built, its rendered review still running (not finished until the review is recorded) */
  stage?: 'homepage' | 'pages' | 'checks';
  /** this version of the business's site: its number, and the version it was edited from (a version never changes) */
  version?: { n: number; parentId?: string };
  /** owner text edits by edit key, applied when the version's pages are compiled */
  edits?: Record<string, string>;
  /** recoveries after the server stopped mid-run: who claimed it, when, and from which stage (each continues once) */
  recoveries?: { by: string; at: string; stage: 'homepage' | 'pages' }[];
  /** handed to the background worker (ROGER_WORKER=daemon): when it was queued, and an inner-pages resume to run */
  queuedAt?: string; pendingResume?: { earlier?: string; at: string };
  /** a staff re-check of the rendered review, queued for the worker */
  recheckRequestedAt?: string;
  /** the running generation's heartbeat: a job whose heartbeat stops was interrupted (another worker may be draining it) */
  heartbeatAt?: string;
  /** resumes at a stage (the inner pages), each with its time, cost and outcome */
  resumes?: { at: string; stage: 'pages'; ms: number; costUsd: number; ok: boolean }[];
  /** a staff refinement: which pages were replaced, whether CSS was added, and why */
  refinement?: { note: string; pages: string[]; css: boolean; withheldPhotos?: string[] };
}
/** a version's address: each page of a version is served at its own link, which never changes */
export const pagePath = (id: string, slug: string) => (slug === 'home' ? `/api/studio/frontend-jobs/${id}/preview` : `/api/studio/frontend-jobs/${id}/preview/${slug}`);
/** the next version number for a business (versions are numbered in the order they were made) */
async function nextVersion(businessKey: string): Promise<number> {
  return (await studioDocs.list<FrontendJob>('studio-frontend-jobs')).filter((j) => j.businessKey === businessKey && j.version).reduce((n, j) => Math.max(n, j.version!.n), 0) + 1;
}
const active = new Map<string, Promise<void>>();
/**
 * The beta on Vercel (ROGER_WORKER=daemon): the web functions only queue generations; the background worker (a Vercel
 * Daemon running src/worker.ts, ROGER_ROLE=worker) claims and runs them, so no generation depends on a request.
 */
const handOff = () => process.env.ROGER_WORKER === 'daemon' && process.env.ROGER_ROLE !== 'worker';
/** generations this process is running (the worker drains them before it stops) */
export const runningFrontendJobs = () => active.size;
const HEARTBEAT_MS = 30_000, STALE_HEARTBEAT_MS = 120_000;
function heartbeat(job: FrontendJob): () => void {
  const t = setInterval(() => { job.heartbeatAt = new Date().toISOString(); void save(job).catch(() => undefined); }, HEARTBEAT_MS);
  t.unref?.();
  return () => clearInterval(t);
}
export const getFrontendJob = (id: string) => studioDocs.get<FrontendJob>('studio-frontend-jobs', id);
const save = (j: FrontendJob) => studioDocs.put('studio-frontend-jobs', j.id, { ...j, updatedAt: new Date().toISOString() });
const revOf = (j: Pick<FrontendJob, 'rev'>) => j.rev ?? 1;

/** a version's photo set with every recorded withheld photo removed (so none can come back through an edit) */
function withoutWithheld(input: FrontendInput, withheld: PhotoDecision[] = []): FrontendInput {
  const out = new Set(withheld.map((w) => w.id));
  return out.size ? { ...input, photos: input.photos.filter((p) => !out.has(p.id)) } : input;
}
/** the media gate over a new version's photos, merged with what earlier versions already withheld */
function gated(input: FrontendInput, earlier: PhotoDecision[] = []): { input: FrontendInput; withheld: PhotoDecision[] } {
  const once = [...new Map(earlier.map((w) => [w.id, w])).values()];
  const g = gatePhotos(withoutWithheld(input, once));
  return { input: g.input, withheld: [...once, ...g.decisions] };
}
/**
 * Every photo withheld anywhere in a version's lineage, oldest first: the recorded decisions, and photos a staff
 * refinement withheld before decisions were recorded (kept then only in that refinement's note), with that note as the
 * reason. A new version carries all of them, so a withheld photo can never return through a later version.
 */
async function lineageWithheld(job: FrontendJob): Promise<PhotoDecision[]> {
  const chain: FrontendJob[] = [];
  for (let j: FrontendJob | undefined = job; j && chain.length < 100; j = j.version?.parentId ? await getFrontendJob(j.version.parentId) : undefined) chain.unshift(j);
  return chain.flatMap((j) => [
    ...(j.refinement?.withheldPhotos ?? []).map((id): PhotoDecision => ({ id, action: 'withhold', rule: 'staff', reason: j.refinement!.note, at: j.createdAt })),
    ...(j.withheldPhotos ?? []),
  ]);
}
/** whether the preview may be sent to the customer automatically: never while a photo or the rendered review needs staff */
export function deliveryOf(job: Pick<FrontendJob, 'withheldPhotos' | 'review' | 'checks'>): { auto: boolean; reasons: string[] } {
  const reasons = [
    ...(job.withheldPhotos ?? []).filter((w) => w.action === 'review').map((w) => `photo ${w.id} needs staff review: ${w.reason}`),
    ...(!job.review?.ran ? ['the rendered-page review has not run'] : job.review.pass ? [] : job.review.problems.map((p) => `rendered review: ${p}`)),
    ...(job.review?.notes ?? []).map((n) => `staff review: ${n}`),
  ];
  return { auto: !reasons.length, reasons };
}
/** the standard rendered-page review of a finished version, recorded on it with the delivery decision */
export async function reviewVersion(job: FrontendJob, opts: { offline?: boolean; fill?: Parameters<typeof frontendPreview>[2] } = {}): Promise<FrontendJob> {
  const slugs = ['home', ...(job.site ? (job.pages ?? []).map((p) => p.slug) : [])];
  const pages = await Promise.all(slugs.map(async (slug) => ({ slug, html: await frontendPreview(job, slug, opts.fill) })));
  job.review = await reviewPages(pages, { version: job.id, offline: opts.offline, links: slugs.map((slug) => pagePath(job.id, slug)) });
  job.checks.browser = !job.review.ran ? 'pending' : job.review.pass ? 'passed' : 'failed';
  job.delivery = deliveryOf(job);
  return job;
}
/**
 * Run a finished version's rendered review again and record it (staff, after a failure that may have been transient,
 * such as an image host dropping requests). The version's content and links never change; only its check record does.
 */
export async function recheckVersion(id: string): Promise<FrontendJob> {
  const job = await getFrontendJob(id);
  if (!job || job.status !== 'needs-review') throw new Error('Only a finished version can be checked again.');
  // the worker runs it (a browser review of every page can outlast a web request): marked as in its checks until done
  if (handOff()) { job.stage = 'checks'; job.recheckRequestedAt = new Date().toISOString(); await save(job); return job; }
  await reviewVersion(job);
  await save(job);
  return job;
}
/** test and tooling hooks for a version's checks */
export interface CheckHooks { review?: false | { offline?: boolean; fill?: Parameters<typeof frontendPreview>[2] } }
async function finishChecks(job: FrontendJob, hooks: CheckHooks = {}) {
  if (hooks.review === false) { job.delivery = deliveryOf(job); return; }
  try { await reviewVersion(job, hooks.review || {}); }
  catch (e) { job.review = { at: new Date().toISOString(), pass: false, ran: false, pages: [], problems: [`the rendered review failed to run: ${(e as Error).message}`] }; job.checks.browser = 'pending'; job.delivery = deliveryOf(job); }
}

/** Reuse a pinned brief and its own completed photo job. No crawl, reference search or vision call. */
export async function frontendInput(source: ConceptJob): Promise<FrontendInput> {
  const { brief, inventory } = await getBrief(source.input.businessKey, source.input.revision);
  const review = await getReview(source.input.reviewId);
  if (!brief || !inventory || !review || !identityKnown(brief)) throw new Error('A saved, identified business brief and its pinned review are required.');
  if (source.status !== 'done') throw new Error('Use a completed source concept job so the business and photo checks are already available.');
  const cat = resolveCatalog(brief, inventory, review);
  cat.photos = cat.photos.filter((p) => source.work.photos?.includes(p.id));
  await observeCatalogPhotos(cat.photos);
  for (const p of cat.photos.filter((p) => !isListing(p))) {
    const file = path.join(config.dirs.out, 'studio-concepts', source.setId, 'img', `${p.id}.jpg`);
    if (fs.existsSync(file)) p.fp = await photoFingerprint(fs.readFileSync(file)).catch(() => undefined);
  }
  const omitted: { id: string; reason: string }[] = [];
  applyPhotoChecks(cat.photos, source.work, omitted);
  return preparedInput(cat, brief, omitted);
}

/** The normal demo path consumes the completed brief directly. It never starts the old concept planner. */
export async function frontendInputFromBrief(businessKey: string, revision?: number,
  deps: { judge?: typeof judgeListingPhotos; observe?: typeof observeCatalogPhotos; load?: typeof getBrief; catalog?: typeof resolveCatalog } = {}): Promise<FrontendInput> {
  const { brief, inventory } = await (deps.load ?? getBrief)(businessKey, revision);
  if (!brief || !inventory || !identityKnown(brief)) throw new Error('Research must finish and the business identity must be confirmed first.');
  const ref = { businessKey: brief.businessKey, revision: brief.revision, briefHash: brief.briefHash };
  const cat = (deps.catalog ?? resolveCatalog)(brief, inventory, emptyReview(ref));
  const omitted: { id: string; reason: string }[] = [];
  const listing = cat.photos.filter(isListing);
  if (listing.length) {
    const placeId = parseListing(listing[0].url)?.placeId;
    if (placeId) {
      try {
        const previous = (await studioDocs.list<FrontendJob>('studio-frontend-jobs'))
          .filter((j) => j.businessKey === brief.businessKey && j.revision === brief.revision && j.input?.photos?.some((p) => isListing(p) && p.fp && p.seen))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const checked = previous?.input.photos.filter((p) => isListing(p) && p.fp && p.seen).map((p) => ({
          n: parseListing(p.url)!.n, width: p.width, height: p.height, kind: p.seenKind ?? 'work',
          seen: p.seen, fp: p.fp, eligible: true,
        })) ?? [];
        const judged = checked.length ? { items: checked } : await (deps.judge ?? judgeListingPhotos)(placeId, { name: cat.business.name, category: cat.business.category ?? undefined });
        await (deps.observe ?? observeCatalogPhotos)(listing);
        applyPhotoChecks(listing, { listing: judged }, omitted);
      } catch (e) { omitted.push({ id: 'Google photos', reason: `photo check unavailable: ${(e as Error).message}` }); }
    }
  }
  for (const p of cat.photos.filter((p) => !isListing(p) && !p.alt?.trim())) {
    omitted.push({ id: p.id, reason: 'the website photo has no description' });
  }
  return preparedInput(cat, brief, omitted);
}

const safeStory = (t: string) => !undatedSeasonal(t) && t.length <= 4000;
async function preparedInput(cat: Catalog, brief: BusinessBrief, omitted: { id: string; reason: string }[]): Promise<FrontendInput> {
  const photos = cat.photos.filter((p) => isListing(p) ? !!p.fp && !!p.seen : !!p.seen || !!p.alt);
  const facts: Record<string, string> = { name: cat.business.name };
  if (cat.address) facts.address = cat.address.formatted;
  if (cat.hours?.length) facts.hours = cat.hours.join('\n');
  if (cat.phone) facts.phone = cat.phone.display;
  if (cat.email) facts.email = cat.email;
  if (cat.rating) facts.rating = `${cat.rating.value}★ from ${cat.rating.count} Google reviews`;
  // the business's own story, verbatim, for an About page (bound, so its own numbers and words are shown as they are)
  if (cat.story?.text && safeStory(cat.story.text)) facts.story = cat.story.text;
  const actions = cat.actions.filter((a) => !a.seasonal && /^(https?:|mailto:|tel:)/.test(a.href));
  // A destination inferred from a different dialling convention is not verified by the display number.
  // Omit it for this pilot; never guess a country prefix from a business name or a layout prompt.
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].kind !== 'call') continue;
    const shown = cat.phone?.display.replace(/\D/g, '') ?? '';
    const dialled = actions[i].href.slice(4).replace(/\D/g, '');
    // the dialled number is the shown number, with at most its country code in front ("(512) 448-3727" is dialled
    // +1 512 448 3727); anything else is a different number
    const sameNumber = !!shown && (dialled === shown || (dialled.endsWith(shown) && dialled.length - shown.length <= 3 && actions[i].href.startsWith('tel:+')));
    if (!sameNumber) {
      omitted.push({ id: actions[i].id, reason: 'saved call destination differs from the sourced phone number; confirm its international format before using this action' });
      actions.splice(i, 1);
    }
  }
  const safeLine = (t: string) => !undatedSeasonal(t) && !/\b(best|award|review by|five star review)\b/i.test(t);
  const services = cat.services.slice(0, 20), items = cat.items.filter((i) => safeLine(`${i.section ?? ''} ${i.name}`)).slice(0, 32);
  for (const s of services) facts[`service-${s.id}`] = [s.name, s.description].filter(Boolean).join(' — ');
  for (const i of items) facts[`item-${i.id}`] = [i.name, i.description].filter(Boolean).join(' — ');
  const references = (await studioDocs.list<ReferenceJob>('studio-reference-jobs')).filter((j) => j.status === 'done' && j.input.businessKey === brief.businessKey && j.input.revision === brief.revision && j.work.strategy).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    business: cat.business, logo: brief.brand.logo.status === 'verified' ? brief.brand.logo.value ?? undefined : undefined, colours: brief.brand.colors.map((c) => c.hex), facts, actions, photos: photos.slice(0, 16),
    ownLines: cat.ownLines.filter(safeLine).slice(0, 20), services, items, story: cat.story,
    reference: references[0]?.work.strategy ?? null,
    notes: omitted.map((p) => `${p.id}: ${p.reason}`),
  };
}

export async function generateFrontend(input: FrontendInput, instruction: string, ledger: CostLedger, transport: AiTransport, recentIdeas: string[] = [], pages: SitePage[] = [], version?: number) {
  // URLs/resource details stay out of the model request. The compiler owns factual destinations and photo credits.
  const brief = { ...input, photos: input.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, subject: p.seen || p.alt })), actions: input.actions.map((a) => ({ id: a.id, label: a.label, kind: a.kind })) };
  return aiJson<FrontendCode>({
    stage: 'frontend:code-v1', system: FRONTEND_PROMPT, output: 'json', schema: CODE_SCHEMA, maxOutputTokens: 12000,
    prompt: `Design brief:\n${JSON.stringify(brief)}\nStaff direction: ${instruction || 'Create a strong, business-specific design. Choose a composition that suits the content.'}\nRecently shown concepts (avoid repeating their composition or visual thesis, while following this business's evidence): ${JSON.stringify(recentIdeas.slice(0, 5))}\n${pages.length ? `\nSite pages (the header navigation links each with <a data-page="slug">; home is "home"): ${JSON.stringify([{ slug: 'home', title: 'Home' }, ...pages.map((p) => ({ slug: p.slug, title: p.title }))])}. The inner pages are written next, in this homepage's visual language: give the header and footer markup every page can share.` : ''}${version ? `\nThis is version ${version} of this business's site: a fresh design, not a copy of an earlier version.` : ''}\nWrite the complete custom HTML/CSS homepage now.`,
  }, { transport, ledger, retries: 1, fieldRepair: false, validate: (code) => checkCode(code, input, pages.length ? { pages } : {}) });
}

/** Authenticated staff-only pilot. Explicit start; polls never start a new generation. */
/** a job still being written, or one finished in the last ten minutes: a repeated start returns it instead of paying again */
export const REPEAT_WINDOW_MS = 10 * 60_000;
const STALE_MS = 15 * 60_000;
export async function sameRecentJob(businessKey: string, revision: number, instruction: string): Promise<FrontendJob | undefined> {
  const now = Date.now();
  return (await studioDocs.list<FrontendJob>('studio-frontend-jobs'))
    .filter((j) => j.businessKey === businessKey && j.revision === revision && (j.instruction ?? '') === instruction.slice(0, 2000) && !j.version?.parentId)
    .filter((j) => ((j.status === 'queued' || j.status === 'generating') && now - Date.parse(j.updatedAt) < STALE_MS) || (j.status === 'needs-review' && now - Date.parse(j.createdAt) < REPEAT_WINDOW_MS))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function startFrontendJob(source: string | { businessKey: string; revision: number }, instruction = '', hooks: { transport?: AiTransport; input?: FrontendInput; /** another version on purpose: skips the repeat guard */ again?: boolean } & CheckHooks = {}): Promise<FrontendJob & { reused?: boolean }> {
  const concept = typeof source === 'string' ? await getConceptJob(source) : undefined;
  if (typeof source === 'string' && !concept) throw new Error('No such source concept job.');
  // a second submission of the same business, brief revision and direction returns the job already under way (or just
  // finished): a resubmitted form never starts another paid generation by accident
  const key = concept?.input.businessKey ?? (source as { businessKey: string }).businessKey, rev = concept?.input.revision ?? (source as { revision: number }).revision;
  if (!hooks.again) { const same = await sameRecentJob(key, rev, instruction); if (same) return { ...same, reused: true }; }
  const transport = hooks.transport ?? defaultTransport();
  if (!transport) throw new Error('Claude is not configured. No theme fallback will be used.');
  // the media gate runs before any page is written: withheld photos are never offered to the generator
  const g = gated(hooks.input ?? (typeof source === 'string' ? await frontendInput(concept!) : await frontendInputFromBrief(source.businessKey, source.revision)));
  const input = g.input;
  const id = `fe_${randomUUID().replace(/-/g, '').slice(0, 16)}`, at = new Date().toISOString();
  const pages = planPages(input);
  const job: FrontendJob = { id, createdAt: at, updatedAt: at, ...(concept ? { sourceJobId: concept.id } : {}), businessKey: key, revision: rev, instruction: instruction.slice(0, 2000), status: 'queued', input, attempts: 0, costUsd: 0, calls: [], checks: { static: 'pending', browser: 'pending', copy: 'owner-review-required', publication: 'disabled' }, pages, version: { n: await nextVersion(key) }, rev: PIPELINE_REV, withheldPhotos: g.withheld };
  if (handOff()) { job.queuedAt = new Date().toISOString(); await save(job); return job; }
  await save(job);
  launch(job, transport, hooks);
  return job;
}

/**
 * Generate a job's homepage, then its inner pages, then its checks. Calls and spend are saved at each checkpoint (the
 * accepted homepage), so a stop loses neither the homepage nor the record of what it cost. Spend already recorded on the
 * job (an earlier, interrupted run) is kept and added to.
 */
function launch(job: FrontendJob, transport: AiTransport, hooks: CheckHooks = {}) {
  const id = job.id, input = job.input, pages = job.pages ?? [];
  const priorCalls = job.calls ?? [], priorCost = job.costUsd ?? 0;
  const run = async () => {
    const ledger = new CostLedger(2, id);
    const book = () => { job.calls = [...priorCalls, ...ledger.calls]; job.costUsd = priorCost + ledger.spentUsd; };
    job.heartbeatAt = new Date().toISOString();
    const stopBeat = heartbeat(job);
    try {
      job.status = 'generating'; job.stage = 'homepage'; await save(job);
      const recent = (await studioDocs.list<FrontendJob>('studio-frontend-jobs'))
        .filter((j) => j.id !== id && j.code?.idea).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5).map((j) => j.code!.idea.slice(0, 300));
      const result = await generateFrontend(input, job.instruction, ledger, transport, recent, pages, job.version?.n);
      job.attempts += result.attempts;
      if (!result.data) throw new Error(`Custom frontend failed after ${result.attempts} attempts: ${result.errors.join('; ')}`);
      job.code = result.data; // kept for inspection even if the pages fail
      // the checkpoint: the accepted homepage and what it cost are saved before the inner pages start
      job.stage = 'pages'; book(); await save(job);
      const site = await generateSitePages(input, result.data, pages, ledger, transport);
      job.attempts += site.attempts;
      if (!site.data) throw new Error(`Custom inner pages failed after ${site.attempts} attempts: ${site.errors.join('; ')}`);
      job.site = site.data;
      compileSite(job.code, job.site, input, pages, { pageHref: (slug) => pagePath(id, slug), version: id, rev: revOf(job) }); // every page must compile before a preview is exposed
      job.status = 'needs-review'; job.checks.static = 'passed'; job.stage = 'checks';
      job.previewUrl = pagePath(id, 'home');
      await finishChecks(job, hooks);
      delete job.stage;
    } catch (e) { job.status = 'failed'; job.error = (e as Error).message; }
    finally { stopBeat(); book(); await save(job); }
  };
  const promise = run().finally(() => active.delete(id)); active.set(id, promise); void keepAlive(promise);
}

/**
 * The worker's queue: each job queued for it is claimed once (an atomic create in the datastore, so two workers, or an
 * old and a new one during a rollout, never both run it) and run: a new generation, or an inner-pages resume.
 */
export async function runQueuedFrontendJobs(owner: string, hooks: { transport?: AiTransport } & CheckHooks = {}): Promise<string[]> {
  const started: string[] = [];
  for (const j of await studioDocs.list<FrontendJob>('studio-frontend-jobs')) {
    // a staff re-check of a finished version: its rendered review runs again here, once per request (no AI)
    if (j.status === 'needs-review' && j.recheckRequestedAt && !active.has(j.id)) {
      if (!(await studioDocs.create('job-claims', `${j.id}-k-${j.recheckRequestedAt.replace(/\D/g, '')}`, { by: owner, at: new Date().toISOString() }))) continue;
      const job = (await getFrontendJob(j.id))!;
      const p = (async () => { const stop = heartbeat(job); try { await finishChecks(job, hooks); } finally { stop(); delete job.stage; delete job.recheckRequestedAt; await save(job); } })();
      active.set(job.id, p.finally(() => active.delete(job.id)));
      started.push(job.id);
      continue;
    }
    if (j.status !== 'queued' || !j.queuedAt || active.has(j.id)) continue;
    if (!(await studioDocs.create('job-claims', `${j.id}-q-${j.queuedAt.replace(/\D/g, '')}`, { by: owner, at: new Date().toISOString() }))) continue;
    const job = await getFrontendJob(j.id);
    if (!job || job.status !== 'queued' || active.has(job.id)) continue;
    const transport = hooks.transport ?? defaultTransport();
    if (!transport) { job.status = 'failed'; job.error = 'Claude is not configured on the worker'; await save(job); continue; }
    if (job.pendingResume) { const earlier = job.pendingResume.earlier; delete job.pendingResume; runResume(job, earlier, transport, hooks); }
    else launch(job, transport, hooks);
    started.push(job.id);
  }
  return started;
}

/**
 * Durable recovery, run when the server starts: every job saved as generating that no server is running (it was stopped
 * mid-run) is claimed, then continued from its saved stage exactly once. An accepted homepage is kept and only the
 * inner pages are written again; with no homepage yet, the homepage stage runs again in the same job. The claim is
 * written before anything starts and checked after, so a second recovery (another start, a poll) never runs it twice; a
 * job already recovered once that stops again is failed rather than retried without end.
 */
let recovering: Promise<unknown> = Promise.resolve();
/** one recovery at a time in this process (a second waits, then finds the job already claimed and running) */
export function recoverInterruptedFrontendJobs(owner: string, hooks: { transport?: AiTransport } & CheckHooks = {}): Promise<{ resumed: string[]; restarted: string[]; failed: string[] }> {
  const p = recovering.catch(() => undefined).then(() => recoverOnce(owner, hooks));
  recovering = p;
  return p;
}
async function recoverOnce(owner: string, hooks: { transport?: AiTransport } & CheckHooks = {}): Promise<{ resumed: string[]; restarted: string[]; failed: string[] }> {
  const out = { resumed: [] as string[], restarted: [] as string[], failed: [] as string[] };
  for (const j of await studioDocs.list<FrontendJob>('studio-frontend-jobs')) {
    // built, but its worker stopped during the rendered review: the checks run again (no AI), once per stop
    if (j.status === 'needs-review' && j.stage === 'checks' && !active.has(j.id) && Date.now() - Date.parse(j.heartbeatAt ?? j.updatedAt) >= STALE_HEARTBEAT_MS) {
      if (await studioDocs.create('job-claims', `${j.id}-c-${(j.heartbeatAt ?? j.updatedAt).replace(/\D/g, '')}`, { by: owner, at: new Date().toISOString() })) {
        const job = (await getFrontendJob(j.id))!;
        await finishChecks(job, hooks); delete job.stage; await save(job); out.resumed.push(job.id);
      }
      continue;
    }
    if (j.status !== 'generating' || active.has(j.id)) continue;
    const job = await getFrontendJob(j.id);
    if (!job || job.status !== 'generating' || active.has(job.id)) continue;
    // still beating: another process (a worker draining during a rollout) is running it
    if (Date.now() - Date.parse(job.heartbeatAt ?? job.updatedAt) < STALE_HEARTBEAT_MS) continue;
    const prior = job.recoveries ?? [];
    if (prior.length >= 1 && prior[prior.length - 1].stage === (job.stage ?? 'homepage')) {
      job.status = 'failed'; job.error = `interrupted again at the ${job.stage ?? 'homepage'} after a recovery: not retried automatically`;
      await save(job); out.failed.push(job.id); continue;
    }
    // the claim: an atomic create in the datastore (one per recovery of this job); only the process that created it continues
    const claim = { by: owner, at: new Date().toISOString(), stage: (job.code ? 'pages' : 'homepage') as 'pages' | 'homepage' };
    if (!(await studioDocs.create('job-claims', `${job.id}-r-${prior.length}`, claim))) continue;
    job.recoveries = [...prior, claim];
    await save(job);
    const back = (await getFrontendJob(job.id))!;
    if (active.has(back.id)) continue;
    const transport = hooks.transport ?? defaultTransport();
    if (!transport) { back.status = 'failed'; back.error = 'interrupted, and Claude is not configured to continue it'; await save(back); out.failed.push(back.id); continue; }
    if (claim.stage === 'pages') {
      back.status = 'failed'; back.stage = 'pages'; back.error = 'interrupted: the server stopped during the inner pages'; await save(back);
      try { await resumeFrontendJob(back.id, { ...hooks, transport }); out.resumed.push(back.id); } catch (e) { out.failed.push(back.id); console.warn(`[frontend] ${back.id} could not resume: ${(e as Error).message}`); }
    } else {
      back.status = 'queued'; delete back.error; await save(back);
      launch(back, transport, hooks); out.restarted.push(back.id);
    }
  }
  return out;
}

export async function waitFrontendJob(id: string) { await active.get(id); return getFrontendJob(id); }
/** is this server running the job's generation now? (a job saved as generating that is not running was interrupted) */
export const frontendJobRunning = (id: string) => active.has(id);
/**
 * A generation whose server stopped mid-run (a restart): recorded as interrupted, keeping its accepted homepage, so its
 * inner pages can resume from that checkpoint. Its calls made before the stop were not saved (they are saved at the end).
 */
export async function markInterrupted(id: string): Promise<FrontendJob | undefined> {
  const job = await getFrontendJob(id);
  if (!job || (job.status !== 'generating' && job.status !== 'queued') || active.has(id)) return job;
  job.status = 'failed'; job.error = `interrupted: the server stopped during the ${job.stage === 'pages' ? 'inner pages' : 'homepage'}`;
  job.stage = job.code ? 'pages' : 'homepage';
  await save(job);
  return job;
}

/**
 * A staff refinement of a finished version: some inner pages replaced and/or CSS appended to the pages' own stylesheet,
 * as a NEW version (the version refined never changes). The homepage and every page not named are reused exactly; the
 * result passes the same inner-page checks and compiles on every page before it is saved. No AI call.
 */
export async function refinedVersion(id: string, change: { pages?: { slug: string; html: string }[]; homeHtml?: string; appendHomeCss?: string; appendCss?: string; withheldPhotos?: string[]; note: string }, hooks: CheckHooks = {}): Promise<FrontendJob> {
  const parent = await getFrontendJob(id);
  if (!parent?.code || !parent.site || !parent.pages?.length || parent.status !== 'needs-review') throw new Error('Only a finished full-site version can be refined.');
  for (const p of change.pages ?? []) if (!parent.pages.some((x) => x.slug === p.slug)) throw new Error(`No ${p.slug} page in this version.`);
  // photos withheld by staff (unsuitable for the client's site): gone from this version's photo set, so any page that still
  // shows one fails the checks; each page's photo minimum is capped at what remains
  const withheld = change.withheldPhotos ?? [];
  for (const w of withheld) if (!parent.input.photos.some((p) => p.id === w)) throw new Error(`No photo ${w} in this version.`);
  // a new version is made under the current pipeline revision: staff withholds and the media gate both apply, and every
  // photo an earlier version withheld stays withheld
  const at0 = new Date().toISOString();
  const staff: PhotoDecision[] = withheld.map((w) => ({ id: w, action: 'withhold', rule: 'staff', reason: change.note, at: at0 }));
  const g = gated(parent.input, [...await lineageWithheld(parent), ...staff]);
  const input = g.input, rev = PIPELINE_REV;
  const pages: SitePage[] = input.photos.length < parent.input.photos.length ? parent.pages.map((p) => ({ ...p, minPhotos: Math.min(p.minPhotos, input.photos.length) })) : parent.pages;
  // the homepage's own HTML may be replaced too (its design, CSS and fonts stay); it must pass the homepage checks again
  const code: FrontendCode = { ...parent.code, html: change.homeHtml ?? parent.code.html, css: change.appendHomeCss ? `${parent.code.css}
${change.appendHomeCss}` : parent.code.css };
  {
    const homeErrors = checkCode(code, input, { pages, rev });
    if (homeErrors.length) throw new Error(`The refined homepage does not pass the checks: ${homeErrors.join('; ')}`);
  }
  const site: SiteCode = {
    css: change.appendCss ? `${parent.site.css}\n${change.appendCss}` : parent.site.css,
    pages: parent.site.pages.map((p) => change.pages?.find((x) => x.slug === p.slug) ?? p),
  };
  const problems = checkSite(site, code, input, pages, rev);
  if (problems.length) throw new Error(`The refinement does not pass the checks: ${problems.join('; ')}`);
  const nid = `fe_${randomUUID().replace(/-/g, '').slice(0, 16)}`, at = new Date().toISOString();
  const job: FrontendJob = { ...structuredClone(parent), id: nid, createdAt: at, updatedAt: at, attempts: 0, costUsd: 0, calls: [], code: structuredClone(code), input: structuredClone(input), pages: structuredClone(pages), site, rev, withheldPhotos: g.withheld, version: { n: await nextVersion(parent.businessKey), parentId: parent.id }, previewUrl: pagePath(nid, 'home'), refinement: { note: change.note, pages: [...(change.homeHtml || change.appendHomeCss ? ['home'] : []), ...(change.pages ?? []).map((p) => p.slug)], css: !!change.appendCss, ...(withheld.length ? { withheldPhotos: withheld } : {}) } };
  delete job.resumes; delete job.review; job.checks = { ...job.checks, browser: 'pending' };
  compileSite(job.code!, job.site, job.input, job.pages, { pageHref: (s) => pagePath(nid, s), edits: job.edits, version: nid, rev });
  await finishChecks(job, hooks);
  await save(job);
  return job;
}

/**
 * The inner-page checkpoint: a job whose homepage was accepted but whose inner pages failed resumes at the pages stage.
 * It reuses that job's accepted homepage, its brief and photo checks (job.input) and its page plan; only the pages are
 * written again, with the earlier rejection quoted. The homepage is never regenerated. One resume runs at a time; each
 * is recorded (time, cost, outcome) and its calls and cost are added to the same job.
 */
export async function resumeFrontendJob(id: string, hooks: { transport?: AiTransport } & CheckHooks = {}): Promise<FrontendJob> {
  const job = await getFrontendJob(id);
  if (!job) throw new Error('No such frontend job.');
  if (active.has(id)) throw new Error('This job is already running; wait for it instead of starting it again.');
  if (job.status !== 'failed' || job.stage !== 'pages' || !job.code || !job.pages?.length) throw new Error('Only a job that failed at its inner pages, with an accepted homepage, can resume there.');
  // a job that never produced a version is finished under the current rules (nothing was ever shown under its old ones)
  if (!job.site && revOf(job) < PIPELINE_REV) job.rev = PIPELINE_REV;
  const homeErrors = checkCode(job.code, job.input, { pages: job.pages, rev: revOf(job) });
  if (homeErrors.length) throw new Error(`The saved homepage no longer passes the checks, so it cannot be reused: ${homeErrors.join('; ')}`);
  const transport = hooks.transport ?? defaultTransport();
  if (!transport) throw new Error('Claude is not configured. No theme fallback will be used.');
  // (an interruption is not a rejection: there is nothing to quote)
  const earlier = /^interrupted:/.test(job.error ?? '') ? undefined : (job.error ?? '').replace(/^Custom inner pages failed after \d+ attempts: /, '');
  if (handOff()) { job.status = 'queued'; job.queuedAt = new Date().toISOString(); job.pendingResume = { ...(earlier ? { earlier } : {}), at: job.queuedAt }; delete job.error; await save(job); return job; }
  runResume(job, earlier, transport, hooks);
  return job;
}
/** write the inner pages again from a job's accepted homepage (the earlier rejection, if any, quoted) */
function runResume(job: FrontendJob, earlier: string | undefined, transport: AiTransport, hooks: CheckHooks) {
  const id = job.id;
  const started = Date.now(), at = new Date().toISOString();
  job.status = 'generating'; job.stage = 'pages'; delete job.error; job.heartbeatAt = at;
  void save(job);
  const run = async () => {
    const ledger = new CostLedger(2, id);
    const before = job.costUsd;
    let ok = false;
    const stopBeat = heartbeat(job);
    try {
      const site = await generateSitePages(job.input, job.code!, job.pages!, ledger, transport, earlier, revOf(job));
      job.attempts += site.attempts;
      if (!site.data) throw new Error(`Custom inner pages failed after ${site.attempts} attempts: ${site.errors.join('; ')}`);
      job.site = site.data;
      compileSite(job.code!, job.site, job.input, job.pages, { pageHref: (slug) => pagePath(id, slug), version: id, rev: revOf(job) });
      job.status = 'needs-review'; job.checks.static = 'passed'; job.stage = 'checks';
      job.previewUrl = pagePath(id, 'home');
      ok = true;
      await finishChecks(job, hooks);
      delete job.stage;
    } catch (e) { job.status = 'failed'; job.stage = 'pages'; job.error = (e as Error).message; }
    finally {
      stopBeat();
      job.calls = [...job.calls, ...ledger.calls]; job.costUsd = before + ledger.spentUsd;
      job.resumes = [...(job.resumes ?? []), { at, stage: 'pages', ms: Date.now() - started, costUsd: ledger.spentUsd, ok }];
      await save(job);
    }
  };
  const promise = run().finally(() => active.delete(id)); active.set(id, promise); void keepAlive(promise);
}
export async function frontendPreview(job: FrontendJob, slug = 'home', fill: Parameters<typeof fillListingPhotos>[1] = {}, /** where page links go (default: the staff preview links) */ href: (slug: string) => string = (s) => pagePath(job.id, s)): Promise<string> {
  if (!job.code || job.status !== 'needs-review') throw new Error('No compiled frontend preview for this job.');
  // a homepage-only job made before full sites keeps its single page
  if (!job.pages?.length || !job.site) { if (slug !== 'home') throw new Error('No such page.'); return fillListingPhotos(compilePage(job.code, job.input, { rev: revOf(job) }), { ...fill, page: job.previewUrl }); }
  if (slug !== 'home' && !job.pages.some((p) => p.slug === slug)) throw new Error('No such page.');
  const pages = compileSite(job.code, job.site, job.input, job.pages, { pageHref: href, edits: job.edits, version: job.id, rev: revOf(job) });
  return fillListingPhotos(pages[slug], { ...fill, page: href(slug) });
}

/** each page's editable text in a version, by edit key (what the owner sees and may change) */
export function versionText(job: FrontendJob): Record<string, { key: string; text: string }[]> {
  if (!job.code) return {};
  const out: Record<string, { key: string; text: string }[]> = { home: editableText(job.code, 'home', job.edits) };
  for (const p of job.pages ?? []) { const html = job.site?.pages.find((x) => x.slug === p.slug)?.html; if (html) out[p.slug] = editableText({ ...job.code, html }, p.slug, job.edits); }
  return out;
}

/**
 * An owner's text edits make a NEW version (the version edited is never changed): the same code and research, the
 * edits merged in, checked by the same copy rules and compiled on every page before it is saved. No AI call.
 */
export async function editedVersion(id: string, edits: Record<string, string>, hooks: CheckHooks = {}): Promise<FrontendJob> {
  const parent = await getFrontendJob(id);
  if (!parent?.code || parent.status !== 'needs-review') throw new Error('Only a finished version can be edited.');
  const known = new Set(Object.values(versionText(parent)).flat().map((t) => t.key));
  const unknown = Object.keys(edits).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`Unknown edit key(s): ${unknown.join(', ')}`);
  const problems = editProblems(edits);
  if (problems.length) throw new Error(problems.join('; '));
  const nid = `fe_${randomUUID().replace(/-/g, '').slice(0, 16)}`, at = new Date().toISOString();
  const g = gated(parent.input, await lineageWithheld(parent));
  const job: FrontendJob = { ...structuredClone(parent), id: nid, createdAt: at, updatedAt: at, attempts: 0, costUsd: 0, calls: [], input: g.input, rev: PIPELINE_REV, withheldPhotos: g.withheld, edits: { ...(parent.edits ?? {}), ...edits }, version: { n: await nextVersion(parent.businessKey), parentId: parent.id }, previewUrl: pagePath(nid, 'home') };
  delete job.review; delete job.resumes; job.checks = { ...job.checks, browser: 'pending' };
  if (job.pages && g.input.photos.length < parent.input.photos.length) job.pages = job.pages.map((p) => ({ ...p, minPhotos: Math.min(p.minPhotos, g.input.photos.length) }));
  compileSite(job.code!, job.site, job.input, job.pages, { pageHref: (s) => pagePath(nid, s), edits: job.edits, version: nid, rev: PIPELINE_REV });
  await finishChecks(job, hooks);
  await save(job);
  return job;
}
