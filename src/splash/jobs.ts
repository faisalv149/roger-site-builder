/**
 * A splash page job: collect and plan (steps 1–4), prepare the generator's input (checked photos, the media gate),
 * generate the page with Claude (one repair at most), compile it, and run the rendered review. Saved in
 * "splash-jobs"; the page is compiled again each time it is served, with Google content filled live.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { load } from 'cheerio';
import { config } from '../config.js';
import { studioDocs } from '../store.js';
import { claudeVia } from '../content/claude.js';
import { aiJson, apiTransport, cliTransport, CostLedger, type AiTransport } from '../studio/concepts/ai.js';
import { frontendInputFromBrief } from '../studio/frontend/jobs.js';
import { gatePhotos, type PhotoDecision } from '../studio/frontend/media-gate.js';
import { reviewPages, type SiteReview } from '../studio/frontend/review.js';
import { fillListingPhotos } from '../studio/concepts/listing-photos.js';
import type { FrontendInput } from '../studio/frontend/page.js';
import { collectSplash, isSiteOnly, type SplashPlan } from './collect.js';
import { DIRECTIONS, directionText, pickDirection } from './directions.js';
import { compileSplash, settleMotion, splashCodeProblems, splashInput, stripSeasonal } from './build.js';
import { SPLASH_PROMPT, SPLASH_SCHEMA, type SplashCode } from './prompt.js';
import { fillGoogleSlots, liveListing } from './slots.js';
import { warmImages } from './images.js';
import { selfHostFonts, type SplashFontFace } from './fonts.js';
import { splashQa, type SplashQa } from './qa.js';
import { isCalm, minimalContact, tradeRow, watchOuts } from './playbook.js';
import { planScreens } from './screens.js';

export interface SplashJob {
  id: string; createdAt: string; updatedAt: string; placeId: string;
  status: 'queued' | 'collecting' | 'generating' | 'checking' | 'ready' | 'failed' | 'stopped';
  /** the beta: queued for the worker at; the running job's last beat; how often it was recovered after a stop */
  queuedAt?: string; heartbeatAt?: string; recoveries?: number;
  /** staff asked for the checks to run again on the page as it is (no AI): the worker runs them in the beta */
  recheckRequestedAt?: string;
  /** an update of this earlier page: its design kept, the facts collected again (the owner's answers); no AI when the
   *  design still fits the new plan; reused: whether it did */
  refreshFrom?: string; reused?: boolean;
  /** made with the Roger kit: 1 its CSS, motion and big footer; 2 with a hero sequence; 3 with motion treatments and
   *  their recorded reasons. Pages made before the kit keep their own look. */
  kit?: number;
  /** motion choices Roger changed because the page's markup could not carry them (reported with the checks) */
  motionRepairs?: string[];
  /** who the page is for: the iMessage run and the owner's conversation (quote requests go to them) */
  owner?: { from: string; runId: string };
  stage?: string; error?: string; instruction?: string;
  /** the visual direction the page was designed to (src/splash/directions.ts) */
  direction?: string;
  /** copy Roger took out of the designer's text (undated seasonal mentions), reported to staff */
  copyRepairs?: string[];
  plan?: SplashPlan; input?: FrontendInput; withheld?: PhotoDecision[];
  code?: SplashCode; costUsd: number; attempts: number; review?: SiteReview; model?: string;
  /** website photos Roger could not fetch from the website (the page's check reports them as not loading) */
  photosUnavailable?: string[];
  /** what the generator's checks made Claude repair (each rejected draft's problems) */
  repairs?: string[];
  /** step 9: the page's checks, as the spec reports them */
  qa?: SplashQa;
  /** the page's fonts as Roger serves them; families Google does not have fall back to the page's font stack */
  fonts?: { faces: SplashFontFace[]; missing: string[] };
}

export const splashModel = () => process.env.SPLASH_MODEL || 'claude-opus-5-5';
export const splashCapUsd = () => Number(process.env.SPLASH_CAP_USD ?? 6);
export function splashTransport(): AiTransport | null { const via = claudeVia(); return !via ? null : via === 'api' ? apiTransport(splashModel()) : cliTransport(splashModel()); }

export const getSplashJob = (id: string) => studioDocs.get<SplashJob>('splash-jobs', id);
const save = (j: SplashJob) => studioDocs.put('splash-jobs', j.id, { ...j, updatedAt: new Date().toISOString() });
export const splashPreviewPath = (id: string) => `/api/studio/splash/${id}/preview`;

/** what Claude is given: the plan, the trade's rules, the facts, actions and photos (no URLs, no Google content) */
export function splashBrief(plan: SplashPlan, input: FrontendInput, instruction = '', direction = ''): string {
  const row = tradeRow(plan.trade.row);
  const brief = {
    business: input.business,
    trade: { label: row.label, family: row.family, calm: isCalm(row), first_screen_must_answer: row.firstScreen, main_action: row.mainAction, contact_form: minimalContact(row) ? 'name, phone and preferred time only' : 'quote request', watch_outs: watchOuts(row), also: plan.trade.secondary ?? null, confidence: plan.trade.confidence },
    screen_plan: plan.screen_plan.screens,
    facts: input.facts,
    actions: input.actions.map((a) => ({ id: a.id, label: a.label })),
    photos: input.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, shape: p.width > p.height * 1.15 ? 'landscape' : p.height > p.width * 1.15 ? 'portrait' : 'square', subject: p.seen || p.alt, fits: p.uses })),
    hero_layouts_that_fit: heroLayouts(input),
    motion_cues: { visitor_task: row.firstScreen, own_words: input.ownLines.slice(0, 3), photo_subjects: input.photos.slice(0, 3).map((p) => ({ id: p.id, subject: p.seen || p.alt })), choose: 'Pick a hero sequence, a hero treatment and one section treatment from these actual materials, and record why in motion. Motion should reveal the business, not repeat a generic effect set.' },
    google: { rating: plan.fact_sheet.some((f) => f.field === 'rating'), review_count: plan.fact_sheet.some((f) => f.field === 'review_count'), selected_reviews: plan.material.reviews, open_now: plan.fact_sheet.some((f) => f.field === 'open_now'), hours_today: plan.fact_sheet.some((f) => f.field === 'hours') },
    brand: { colours: input.colours, logo: input.logo ? 'given (data-logo="brand")' : 'none: set the name as text' },
    own_lines: input.ownLines,
  };
  return `Business data:\n${JSON.stringify(brief)}\n${direction ? `DESIGN DIRECTION for this page (follow it; it overrides the default look): ${direction}\n` : ''}${instruction ? `Staff direction: ${instruction}\n` : ''}Write the complete splash page now.`;
}

/**
 * Where a job runs. Locally (and in tests) in this process. In the Vercel beta (ROGER_WORKER=daemon) a web function only
 * queues it, and the background worker (src/worker.ts) claims and runs it, so no page depends on a request staying
 * alive. A running job beats every 30 s; one whose beat stops for 2 minutes was interrupted and is recovered once.
 */
const handOff = () => process.env.ROGER_WORKER === 'daemon' && process.env.ROGER_ROLE !== 'worker';
const active = new Map<string, Promise<unknown>>();
export const runningSplashJobs = () => active.size;
export const splashJobRunning = (id: string) => active.has(id);
const HEARTBEAT_MS = 30_000, STALE_MS = 120_000;
const inProgress = (j: SplashJob) => j.status === 'collecting' || j.status === 'generating' || j.status === 'checking';
const stale = (j: SplashJob) => Date.now() - Date.parse(j.heartbeatAt ?? j.updatedAt) >= STALE_MS;

/** run a job in this process, beating while it runs; a failure is saved on the job, never thrown */
function launch(job: SplashJob, work: () => Promise<unknown>): void {
  job.heartbeatAt = new Date().toISOString();
  const beat = setInterval(() => { job.heartbeatAt = new Date().toISOString(); void save(job).catch(() => undefined); }, HEARTBEAT_MS);
  beat.unref?.();
  const p = work().catch(async (e) => { job.status = 'failed'; job.error = (e as Error).message.slice(0, 600); await save(job); })
    .finally(() => { clearInterval(beat); active.delete(job.id); });
  active.set(job.id, p);
}
/** tests: wait for a job running in this process */
export const waitSplashJob = async (id: string) => { await active.get(id); return getSplashJob(id); };

/** the hero layouts the photos can carry (the kit's rules: a full hero needs a large landscape photo, a collage three) */
export function heroLayouts(input: FrontendInput): string[] {
  const ps = input.photos, big = ps.filter((p) => p.width >= 1400 && p.width > p.height * 1.15);
  return [...(big.length ? ['full'] : []), ...(ps.length ? ['split', 'marquee'] : []), ...(ps.length >= 3 ? ['collage'] : []), 'type'];
}

/** start a job for a Google place: queued for the worker in the beta, else run here in the background */
export async function startSplashJob(placeId: string, opts: { instruction?: string; owner?: SplashJob['owner']; refreshFrom?: string } & SplashJobOpts = {}): Promise<SplashJob> {
  const at = new Date().toISOString();
  const job: SplashJob = { id: `sp_${randomBytes(8).toString('hex')}`, createdAt: at, updatedAt: at, placeId, status: 'collecting', costUsd: 0, attempts: 0, instruction: opts.instruction?.slice(0, 1000), ...(opts.owner ? { owner: opts.owner } : {}), ...(opts.refreshFrom ? { refreshFrom: opts.refreshFrom } : {}) };
  if (handOff()) { job.status = 'queued'; job.queuedAt = at; await save(job); return job; }
  await save(job);
  launch(job, () => runSplashJob(job, opts));
  return job;
}

/** the worker's queue: each queued job claimed once (an atomic create, so two workers never both run it) and run */
export async function runQueuedSplashJobs(owner: string, opts: SplashJobOpts = {}): Promise<string[]> {
  const started: string[] = [];
  for (const j of await studioDocs.list<SplashJob>('splash-jobs')) {
    // a staff re-check: the checks again on the page as it is (no AI), once per request
    if (j.recheckRequestedAt && j.code && !active.has(j.id)) {
      if (!(await studioDocs.create('job-claims', `${j.id}-k-${j.recheckRequestedAt.replace(/\D/g, '')}`, { by: owner, at: new Date().toISOString() }))) continue;
      const job = await getSplashJob(j.id);
      if (!job?.recheckRequestedAt || active.has(job.id)) continue;
      delete job.recheckRequestedAt;
      launch(job, () => finishSplashChecks(job, opts));
      started.push(job.id);
      continue;
    }
    if (j.status !== 'queued' || !j.queuedAt || active.has(j.id)) continue;
    if (!(await studioDocs.create('job-claims', `${j.id}-q-${j.queuedAt.replace(/\D/g, '')}`, { by: owner, at: new Date().toISOString() }))) continue;
    const job = await getSplashJob(j.id);
    if (!job || job.status !== 'queued' || active.has(job.id)) continue;
    job.status = 'collecting';
    launch(job, () => runSplashJob(job, opts));
    started.push(job.id);
  }
  return started;
}

/**
 * Jobs whose beat stopped (the process running them was stopped): each is recovered once. A page already made only has
 * its checks run again (no AI); one stopped before that is made again. A job that stops a second time is failed.
 */
export async function recoverInterruptedSplashJobs(owner: string, opts: SplashJobOpts = {}): Promise<{ rechecked: string[]; restarted: string[]; failed: string[] }> {
  const out = { rechecked: [] as string[], restarted: [] as string[], failed: [] as string[] };
  for (const j of await studioDocs.list<SplashJob>('splash-jobs')) {
    if (!inProgress(j) || active.has(j.id) || !stale(j)) continue;
    const n = j.recoveries ?? 0;
    if (!(await studioDocs.create('job-claims', `${j.id}-r-${n}`, { by: owner, at: new Date().toISOString() }))) continue;
    const job = await getSplashJob(j.id);
    if (!job || !inProgress(job) || active.has(job.id)) continue;
    if (n >= 1) { job.status = 'failed'; job.error = `interrupted again (${job.stage ?? job.status}) after a recovery: not retried automatically`; await save(job); out.failed.push(job.id); continue; }
    job.recoveries = n + 1;
    if (job.code && job.plan && job.input) { launch(job, () => finishSplashChecks(job, opts)); out.rechecked.push(job.id); }
    else { job.status = 'collecting'; delete job.error; launch(job, () => runSplashJob(job, opts)); out.restarted.push(job.id); }
  }
  return out;
}

export interface SplashJobOpts {
  transport?: AiTransport; review?: false | { offline?: boolean };
  /** tests: the plan and the generator's base input without Places or a saved brief */
  collect?: (placeId: string) => Promise<SplashPlan>; prepare?: (plan: SplashPlan) => Promise<FrontendInput>;
  /** tests: no photo fetching (false), or a stand-in */
  images?: false; warm?: typeof warmImages; fonts?: typeof selfHostFonts;
}

export async function runSplashJob(job: SplashJob, opts: SplashJobOpts = {}): Promise<SplashJob> {
  // 1-4: collect and plan
  job.stage = 'collecting the business'; await save(job);
  let plan = await (opts.collect ?? ((id: string) => collectSplash(id)))(job.placeId);
  job.plan = plan;
  if (plan.stop) { job.status = 'stopped'; job.error = plan.stop; await save(job); return job; }
  // the generator's input: the brief's checked photos (Google photos described and fingerprinted), the media gate
  job.stage = 'checking photos'; await save(job);
  const base = await (opts.prepare ?? ((p: SplashPlan) => frontendInputFromBrief(p.businessKey!, p.revision)))(plan);
  const gated = gatePhotos(base);
  job.withheld = gated.decisions;
  const row = tradeRow(plan.trade.row);
  // the plan counted the research's usable photos; the page gets only those that passed the checks and the gate
  if (gated.input.photos.length !== plan.material.photos) {
    const material = { ...plan.material, photos: gated.input.photos.length };
    plan = job.plan = { ...plan, material, screen_plan: planScreens(row, material) };
  }
  const input = splashInput(plan, gated.input, row);
  job.input = input;
  // an update: the earlier page's design with the facts as they are now, when it still fits (the same screens, every
  // binding still a known fact, every check of an answer passed); otherwise a new design in the same direction
  const before = job.refreshFrom ? await getSplashJob(job.refreshFrom) : undefined;
  if (before?.code) {
    const sameScreens = before.plan?.screen_plan.screens.map((s) => s.screen).join() === plan.screen_plan.screens.map((s) => s.screen).join();
    if (sameScreens && !splashCodeProblems(before.code, plan, input, { kit: !!before.kit, motionDirection: (before.kit ?? 0) >= 2, treatments: (before.kit ?? 0) >= 3 }).length) {
      job.code = before.code; job.fonts = before.fonts; job.model = before.model; job.reused = true; job.kit = before.kit; job.motionRepairs = before.motionRepairs;
      job.stage = 'updating the facts'; await save(job);
      const warmed = opts.images === false ? undefined : await warmImages(input.photos.filter((p) => /^https?:\/\//.test(p.url)).map((p) => p.url)).catch(() => undefined);
      if (warmed?.failed.length) job.photosUnavailable = input.photos.filter((p) => warmed.failed.includes(p.url)).map((p) => p.id);
      return finishSplashChecks(job, opts);
    }
    job.instruction = [job.instruction, `Keep the visual direction of the page this replaces: ${before.code.idea}`].filter(Boolean).join(' ').slice(0, 1000);
    if (before.direction) job.direction = before.direction;
  }
  // a visual direction of its own, so pages differ from each other (an update keeps the page's direction)
  if (!job.direction) {
    const others = (await studioDocs.list<SplashJob>('splash-jobs')).filter((j) => j.id !== job.id && j.direction);
    const recent = others.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map((j) => j.direction!);
    const earlier = others.filter((j) => j.placeId === job.placeId).map((j) => j.direction!);
    job.direction = pickDirection(heroLayouts(input), recent, earlier).id;
  }
  const dir = DIRECTIONS.find((d) => d.id === job.direction);
  // 5-6: the page
  job.status = 'generating'; job.stage = 'designing the page'; await save(job);
  // the website photos fetched and sized while Claude designs (the page is checked, and served, from Roger's copies)
  const warming = opts.images === false ? Promise.resolve(undefined)
    : (opts.warm ?? warmImages)(input.photos.filter((p) => /^https?:\/\//.test(p.url)).map((p) => p.url)).catch(() => undefined);
  const transport = opts.transport ?? splashTransport();
  if (!transport) throw new Error('Claude is not available on this server.');
  job.model = transport.model;
  const ledger = new CostLedger(splashCapUsd(), job.id);
  const seasonal: string[] = [];
  const r = await aiJson<SplashCode>({ stage: 'splash:page-v1', system: SPLASH_PROMPT, output: 'json', schema: SPLASH_SCHEMA, maxOutputTokens: 24000, prompt: splashBrief(plan, input, job.instruction, dir ? directionText(dir, heroLayouts(input)) : '') },
    // an undated seasonal word in the designer's own text is removed by Roger, not a reason to fail the page
    { transport, ledger, retries: 1, fieldRepair: false, validate: (code) => { seasonal.push(...stripSeasonal(code, { hoursCaveat: !!input.facts.hours })); return splashCodeProblems(code, plan, input, { kit: true, motionDirection: true, treatments: true }); } });
  job.copyRepairs = [...new Set(seasonal)].map((t) => `Removed an undated seasonal mention from the page: "${t}"`);
  job.kit = 3;
  job.costUsd = ledger.spentUsd; job.attempts = r.attempts; job.repairs = r.rejected.flatMap((x) => x.errors).slice(0, 12);
  if (!r.data) { job.status = 'failed'; job.error = `The page did not pass its checks after ${r.attempts} attempt(s): ${r.errors.join('; ').slice(0, 900)}`; if (r.last) job.code = r.last; await save(job); return job; }
  // the motion choices settled with the markup: one the page cannot carry becomes the subtle reveal (reported)
  const settled = settleMotion(r.data, { calm: isCalm(row) });
  job.code = settled.code; job.motionRepairs = settled.repairs;
  if (opts.images !== false) job.fonts = await (opts.fonts ?? selfHostFonts)(r.data.fonts).catch(() => undefined);
  const warmed = await warming;
  if (warmed?.failed.length) job.photosUnavailable = input.photos.filter((p) => warmed.failed.includes(p.url)).map((p) => p.id);
  return finishSplashChecks(job, opts);
}

/** staff: run the checks again on a page already made (no AI): on the worker in the beta, else here in the background */
export async function recheckSplashJob(id: string): Promise<SplashJob | undefined> {
  const job = await getSplashJob(id);
  if (!job?.code || !job.plan || !job.input || active.has(id)) return undefined;
  job.status = 'checking'; job.stage = 'checks requested again'; delete job.error;
  if (handOff()) { job.recheckRequestedAt = new Date().toISOString(); await save(job); return job; }
  await save(job);
  launch(job, () => finishSplashChecks(job));
  return job;
}

/** 9: the rendered review and the spec's checks on the page as served (no AI); then the job is ready */
export async function finishSplashChecks(job: SplashJob, opts: SplashJobOpts = {}): Promise<SplashJob> {
  if (opts.review !== false) {
    job.status = 'checking'; job.stage = 'checking at desktop and phone width'; await save(job);
    const html = await splashPage(job);
    try { job.review = await reviewPages([{ slug: 'home', html }], { version: job.id, offline: opts.review?.offline, links: [splashPreviewPath(job.id)] }); }
    catch (e) { job.review = { at: new Date().toISOString(), pass: false, ran: false, pages: [], problems: [`the rendered review failed to run: ${(e as Error).message}`] }; }
    // the spec's step 9 (fixes what Roger can: a dead link to the business's own page is removed)
    job.stage = 'running the final checks'; await save(job);
    job.qa = await splashQa(job, html, { links: opts.review?.offline ? false : undefined }).catch((e) => ({ at: new Date().toISOString(), passed: [], fixed: [], needs_human: [`The final checks failed to run: ${(e as Error).message}`], deadLinks: [] }));
  }
  job.status = 'ready'; job.stage = undefined; await save(job);
  return job;
}

/**
 * What keeps a finished splash page from a customer: a failed or stopped job, a rendered review that did not run or found
 * broken output, and the checks' blocking findings (wrong or non-compliant content). Missing facts, accessibility notes
 * and design notes are for staff and never hold a preview back.
 */
export function splashBlocking(job: SplashJob): string[] {
  if (job.status === 'failed' || job.status === 'stopped') return [`generation ${job.status}: ${job.error ?? 'unknown'}`];
  if (job.status !== 'ready') return [`not finished (${job.status})`];
  const out: string[] = [];
  if (!job.review?.ran) out.push('the rendered review (credits, links, overflow) did not run');
  else out.push(...job.review.problems.map((p) => `rendered review: ${p}`));
  if (!job.qa) out.push('the final checks did not run');
  else out.push(...(job.qa.blocking ?? []).map((b) => `check: ${b}`));
  return out;
}

/** the page as served: compiled, then Google photos (with credits) and Google content filled live */
export async function splashPage(job: SplashJob, opts: { mode?: 'preview' | 'live'; canonical?: string; imageBase?: string } = {}): Promise<string> {
  if (!job.code || !job.plan || !job.input) throw new Error('This splash page has not been made yet.');
  const html = compileSplash(job.code, job.plan, job.input, { id: job.id, mode: opts.mode ?? 'preview', canonical: opts.canonical, quoteAction: `/api/splash/${job.id}/quote`, imageBase: opts.imageBase ?? config.publicBaseUrl, fontFaces: job.fonts?.faces, deadLinks: job.qa?.deadLinks, kit: !!job.kit });
  const withPhotos = await fillListingPhotos(html, { page: splashPreviewPath(job.id) });
  const team = (job.plan.fact_sheet.find((f) => f.field === 'team')?.value as string[] | undefined)?.map((t) => t.split(' | ')[0]) ?? [];
  const live = isSiteOnly(job.placeId) ? null : await liveListing(job.placeId).catch(() => null);
  return fillGoogleSlots(withPhotos, live, { names: team, hideReviews: job.plan.trade.row === 'counseling' });
}

/** the spec's output for a finished page: the page as served now (Google content filled live) and its checks */
export async function splashOutput(job: SplashJob, opts: { mode?: 'preview' | 'live'; canonical?: string } = {}) {
  if (!job.code || !job.plan) throw new Error('This splash page has not been made yet.');
  const html = await splashPage(job, opts);
  const ld = load(html)('script[type="application/ld+json"]').first().text();
  return {
    trade: { row: job.plan.trade.row, confidence: job.plan.trade.confidence },
    fact_sheet: job.plan.fact_sheet,
    open_questions: job.plan.open_questions,
    screen_plan: job.plan.screen_plan.screens.map((s) => ({ screen: s.screen, content: s.content })),
    design_tokens: job.code.design_tokens,
    html,
    jsonld: ld ? JSON.parse(ld) : {},
    qa: { passed: job.qa?.passed ?? [], fixed: job.qa?.fixed ?? [], needs_human: job.qa?.needs_human ?? (job.qa ? [] : ['The final checks have not run on this page.']) },
  };
}

/** a quote or appointment request from a splash page: kept for the owner and the Roger dashboard */
export interface SplashLead {
  id: string; jobId: string; placeId: string; at: string; fields: Record<string, string>; photoId?: string; photoNote?: string;
  /** sent to the owner's conversation (delivered: it left this server through their channel) */
  owner?: { from: string; at: string; delivered: boolean; note?: string };
}
export const getSplashLead = (id: string) => studioDocs.get<SplashLead>('splash-leads', id);
export const leadPhotoPath = (photoId: string) => `/api/splash/lead-photos/${photoId}`;

/** the owner's message for a quote or appointment request: who, how to reach them, what they need */
export function leadMessage(lead: SplashLead, opts: { origin?: string; appointment?: boolean } = {}): { text: string; image?: string } {
  const f = lead.fields;
  const lines = [
    `New ${opts.appointment ? 'appointment request' : 'quote request'} from your website: ${f.name}, ${f.phone}.`,
    f.need ? `They need: ${f.need}` : '', f.time ? `Preferred time: ${f.time}` : '', f.zip ? `ZIP: ${f.zip}` : '',
    lead.photoId ? 'They sent a photo.' : '',
  ].filter(Boolean);
  return { text: lines.join('\n'), ...(lead.photoId && opts.origin ? { image: `${opts.origin}${leadPhotoPath(lead.photoId)}` } : {}) };
}
/**
 * The visitor's photo of the job (quote requests only, never for a health trade): turned upright, at most 1600 px,
 * re-encoded so nothing of the camera's metadata (location, device) is kept, and stored apart from the lead.
 */
export async function saveSplashLead(jobId: string, body: Record<string, unknown>, photo?: { buffer: Buffer; mimetype: string }): Promise<SplashLead | undefined> {
  const job = await getSplashJob(jobId);
  if (!job) return undefined;
  const fields: Record<string, string> = {};
  for (const k of ['name', 'phone', 'zip', 'need', 'time']) if (typeof body[k] === 'string' && body[k]) fields[k] = String(body[k]).slice(0, 1000);
  if (!fields.name || !fields.phone) return undefined;
  const lead: SplashLead = { id: `ld_${randomBytes(8).toString('hex')}`, jobId, placeId: job.placeId, at: new Date().toISOString(), fields };
  if (photo?.buffer.length) {
    if (job.plan && minimalContact(tradeRow(job.plan.trade.row))) lead.photoNote = 'a photo was sent and not kept (health trade)';
    else {
      const data = /^image\//.test(photo.mimetype) ? await sharp(photo.buffer, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer().catch(() => undefined) : undefined;
      if (data) { lead.photoId = `lp_${randomBytes(8).toString('hex')}`; await studioDocs.put('splash-lead-photos', lead.photoId, { id: lead.photoId, leadId: lead.id, type: 'image/jpeg', data: data.toString('base64') }); }
      else lead.photoNote = 'the file sent was not a photo';
    }
  }
  await studioDocs.put('splash-leads', lead.id, lead);
  return lead;
}
