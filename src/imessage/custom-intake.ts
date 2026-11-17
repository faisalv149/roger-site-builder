/**
 * The custom full-site intake (test-only: `intake: "custom"` on the simulator's inbound API; never for normal clients).
 *
 *   confirmed business  →  research (or the saved brief, when its identity matches)  →  custom full site (one version)
 *   →  every page, fact, photo, credit, claim, accessibility and link check  →  staff review  →  one link to the customer
 *
 * No fixed theme and no old renderer: a generation that fails is a failure, said plainly. Each version is an immutable
 * frontend job with its own link; the customer sees a version only after staff approve it, and only once. "Request another
 * version" makes one new version (never a second while one is being made or reviewed). "Approve and publish" records the
 * exact version last shown; this rehearsal never publishes.
 *
 * Duplicates: repeated messages and polls move the same run forward and start nothing twice (one advance at a time per
 * run; a version records its job before anything else can start one; the frontend job's own repeat guard too).
 */
import { config } from '../config.js';
import { capProblem, recordCharge, type BetaCharge } from '../beta.js';
import { listConversationRecords } from '../store.js';
import { studioDocs } from '../store.js';
import { onClaudeCall } from '../content/claude.js';
import { getBrief, getStudioJob, resumeIfStale, startStudioJob } from '../studio/jobs.js';
import { identityKnown } from '../studio/concepts/designspec.js';
import { load } from 'cheerio';
import { pageReferenceProblems } from '../studio/frontend/page.js';
import { frontendJobRunning, getFrontendJob, markInterrupted, recheckVersion, resumeFrontendJob, startFrontendJob, type FrontendJob } from '../studio/frontend/jobs.js';

/** the jobs a run starts and reads (tests replace them to count starts; production uses these) */
export const intakeDeps = { getBrief, startStudioJob, getStudioJob, resumeIfStale, startFrontendJob, getFrontendJob, frontendJobRunning, markInterrupted, resumeFrontendJob, capProblem, recordCharge };

/** what a job charged to a beta invite has cost: its actual cost once finished (undefined while it runs: the reserve counts) */
export async function chargeCost(c: BetaCharge): Promise<number | undefined> {
  if (c.kind === 'version') { const j = c.jobId ? await intakeDeps.getFrontendJob(c.jobId) : undefined; return j && j.status !== 'generating' && j.status !== 'queued' ? j.costUsd : undefined; }
  const run = (await listConversationRecords()).map((x) => (x.session as { custom?: CustomRun } | undefined)?.custom).find((r) => r?.id === c.runId);
  return run?.research?.finishedAt ? run.research.costUsd ?? 0 : run?.stage === 'failed' ? 0.05 : undefined;
}

export type VersionStatus = 'generating' | 'review' | 'sent' | 'rejected' | 'failed';
export interface CustomVersion {
  n: number; requestedAt: string; status: VersionStatus;
  jobId?: string; reused?: boolean;
  finishedAt?: string; ms?: number; costUsd?: number; attempts?: number;
  /** why it failed (checks, generation), for staff; the customer gets a plain message */
  error?: string;
  /** staff decision */
  reviewedAt?: string; reviewer?: string; note?: string;
  /** the customer link, once sent (one per version, never changed) */
  url?: string; sentAt?: string;
  /** where its generation is (from the saved job), for a status answer */
  stage?: 'homepage' | 'pages';
  /** which customer message this version has had: each is sent once */
  told?: ('review' | 'failed' | 'sent' | 'rejected')[];
}
export interface CustomRun {
  id: string; mode: 'custom';
  placeId: string; name: string; website?: string; confirmedAt: string;
  /** the beta invite it is charged to (none: a staff run) */
  inviteId?: string; from?: string;
  stage: 'research' | 'versions' | 'failed';
  businessKey?: string; revision?: number; studioJobId?: string;
  research?: { reused: boolean; reason: string; startedAt: string; finishedAt?: string; ms?: number; job?: string; costUsd?: number };
  versions: CustomVersion[];
  /** the version last sent to the customer, and the one they approved (recorded only; nothing is published here) */
  shown?: number;
  approved?: { n: number; jobId: string; url: string; at: string };
  startedAt: string; error?: string;
  told?: ('failed')[];
}

const now = () => new Date().toISOString();
const msBetween = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : undefined);
const host = (u?: string | null) => { try { return u ? new URL(/^https?:/i.test(u) ? u : `https://${u}`).host.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
/** a generation not heard from for this long has stopped (the server restarted mid-generation) */
const STALE_MS = 25 * 60_000;

export function newCustomRun(i: { placeId: string; name: string; website?: string; confirmedAt: string; inviteId?: string; from?: string }): CustomRun {
  return { id: `ci_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, mode: 'custom', ...i, stage: 'research', versions: [], startedAt: now() };
}
export const customBusy = (r: CustomRun) => r.stage === 'research' || r.versions.some((v) => v.status === 'generating' || v.status === 'review');
export const versionInFlight = (r: CustomRun) => r.versions.find((v) => v.status === 'generating' || v.status === 'review');
/** the customer's link to a version (served only after staff sent it: src/server.ts /v/) */
export const customerLink = (jobId: string, slug = 'home') => `${config.publicOrigin}/v/${jobId}${slug === 'home' ? '' : `/${slug}`}`;

// research spend: Claude calls made while a run's research job is running (the research job has no ledger of its own)
const calls: { at: number; costUsd: number }[] = [];
onClaudeCall((c) => { if (c.costUsd) { calls.push({ at: Date.parse(c.at), costUsd: c.costUsd }); if (calls.length > 5000) calls.splice(0, 1000); } });
const spentBetween = (a: string, b: string) => calls.filter((c) => c.at >= Date.parse(a) && c.at <= Date.parse(b)).reduce((s, c) => s + c.costUsd, 0);

/** one advance at a time per run: a repeated poll or message waits for it and sees its result */
const running = new Map<string, Promise<CustomRun>>();
export function advanceCustom(run: CustomRun): Promise<CustomRun> {
  const busy = running.get(run.id);
  if (busy) return busy;
  const p = step(run).finally(() => running.delete(run.id));
  running.set(run.id, p);
  return p;
}

async function step(run: CustomRun): Promise<CustomRun> {
  if (run.stage === 'research') await research(run);
  if (run.stage === 'versions') for (const v of run.versions.filter((x) => x.status === 'generating')) await generate(run, v);
  return run;
}

/** the saved brief, reused only when it is this business: the confirmed listing, and the website the customer gave */
async function research(run: CustomRun) {
  if (!run.studioJobId && !run.businessKey) {
    const saved = (await intakeDeps.getBrief(`place-${run.placeId}`).catch(() => ({ brief: undefined }))).brief;
    const sameSite = !run.website || host(saved?.identity.website?.value) === host(run.website);
    if (saved && identityKnown(saved) && sameSite) {
      run.businessKey = saved.businessKey; run.revision = saved.revision;
      run.research = { reused: true, reason: `saved brief r${saved.revision} for this Google listing${run.website ? ` and ${host(run.website)}` : ''}`, startedAt: now(), finishedAt: now(), ms: 0, costUsd: 0 };
      return toVersions(run);
    }
    const reason = !saved ? 'no saved research for this listing' : !identityKnown(saved) ? 'the saved brief\'s identity is not confirmed' : `the saved brief is for ${host(saved.identity.website?.value) || 'no website'}, not ${host(run.website)}`;
    try {
      const job = await intakeDeps.startStudioJob({ google: run.placeId, website: run.website });
      run.studioJobId = job.id;
      run.research = { reused: false, reason, startedAt: now(), job: job.id };
    } catch (e) { return failRun(run, `research could not start: ${(e as Error).message}`); }
    return;
  }
  if (!run.studioJobId) return toVersions(run);
  const found = await intakeDeps.getStudioJob(run.studioJobId);
  if (!found) return failRun(run, 'the research job is missing');
  const j = await intakeDeps.resumeIfStale(found);
  if (j.status === 'failed') return failRun(run, `research failed at ${j.stages.find((s) => s.status === 'failed')?.name ?? 'research'}: ${j.error ?? 'unknown'}`);
  if (j.status !== 'done' || !j.businessKey) return;
  // the research must be about the listing the customer confirmed (a website can point at another listing)
  if (j.businessKey !== `place-${run.placeId}`) return failRun(run, `the research identified ${j.businessKey}, not the confirmed listing place-${run.placeId}; held for staff`);
  run.businessKey = j.businessKey; run.revision = j.revision;
  const r = run.research!; r.finishedAt = now(); r.ms = msBetween(r.startedAt, r.finishedAt); r.costUsd = spentBetween(r.startedAt, r.finishedAt);
  toVersions(run);
}
function toVersions(run: CustomRun) {
  run.stage = 'versions';
  if (!run.versions.length) run.versions.push({ n: 1, requestedAt: now(), status: 'generating' });
}
function failRun(run: CustomRun, error: string) { run.stage = 'failed'; run.error = error; }

/** one version: its custom full site, then the checks; it waits for staff only when every blocking check passed */
async function generate(run: CustomRun, v: CustomVersion) {
  if (!v.jobId) {
    const shown = run.versions.filter((x) => x.n < v.n && x.jobId).length;
    if (run.inviteId) {
      const cap = await intakeDeps.capProblem(run.inviteId, 'version', { runId: run.id, n: v.n }, chargeCost);
      if (cap) { v.status = 'failed'; v.error = `cap: ${cap}`; v.finishedAt = now(); return; }
    }
    try {
      // the first version may be one just made for this business, brief and direction (the generator's repeat guard);
      // a later one is always new, and is told to differ from the versions already made
      const job = await intakeDeps.startFrontendJob({ businessKey: run.businessKey!, revision: run.revision! }, v.n === 1 ? '' : `Version ${v.n} for this customer: a fresh design, clearly different in composition and visual idea from the ${shown} version(s) already made.`, { again: v.n > 1 });
      v.jobId = job.id; v.reused = !!(job as { reused?: boolean }).reused;
      if (run.inviteId && !v.reused) await intakeDeps.recordCharge(run.inviteId, { kind: 'version', from: run.from ?? '', runId: run.id, n: v.n, jobId: job.id });
    } catch (e) { v.status = 'failed'; v.error = `generation could not start: ${(e as Error).message}`; v.finishedAt = now(); }
    return;
  }
  const job = await intakeDeps.getFrontendJob(v.jobId);
  if (!job) { v.status = 'failed'; v.error = 'the generation job is missing'; v.finishedAt = now(); return; }
  // still running: being generated, or built with its rendered review still under way
  if (job.status === 'needs-review' && job.stage === 'checks') { v.stage = 'pages'; return; }
  if (job.status === 'queued' || job.status === 'generating') {
    v.stage = job.stage === 'checks' ? 'pages' : job.stage ?? 'homepage';
    // this server is not running it: the server restarted mid-generation. An accepted homepage is kept and only the inner
    // pages are written again; with no homepage yet, this version's generation starts again.
    if (!process.env.VERCEL && !intakeDeps.frontendJobRunning(job.id)) {
      const j = await intakeDeps.markInterrupted(job.id);
      if (j?.code && j.pages?.length) {
        try { await intakeDeps.resumeFrontendJob(j.id); v.note = `${v.note ? `${v.note}; ` : ''}the server restarted during the inner pages: resumed them from the accepted homepage`; }
        catch (e) { v.status = 'failed'; v.error = `interrupted, and the inner pages could not resume: ${(e as Error).message}`; v.finishedAt = now(); }
        return;
      }
      v.note = `${v.note ? `${v.note}; ` : ''}the server restarted during the homepage (job ${job.id}): started again`;
      v.jobId = undefined;
      return generate(run, v);
    }
    if (Date.now() - Date.parse(job.updatedAt) > STALE_MS) { v.status = 'failed'; v.error = `the generation stopped at ${job.stage ?? 'the start'} (no progress for ${Math.round(STALE_MS / 60000)} minutes)`; v.finishedAt = now(); }
    return;
  }
  v.finishedAt = now(); v.ms ??= msBetween(job.createdAt, job.updatedAt); v.costUsd = job.costUsd; v.attempts = job.attempts;
  const blocking = blockingProblems(job);
  if (blocking.length) { v.status = 'failed'; v.error = blocking.join('; '); return; }
  v.status = 'review';
}

/** what keeps a version from staff approval at all: a failed generation, a homepage-only result, any failed check */
export function blockingProblems(job: FrontendJob): string[] {
  if (job.status === 'failed') return [`generation failed: ${job.error ?? 'unknown'}`];
  const out: string[] = [];
  if (!job.site || !job.pages?.length) out.push('homepage only: the inner pages are missing');
  if (job.checks.static !== 'passed') out.push('the page, fact and photo checks have not passed');
  if (!job.review?.ran) out.push('the rendered review (credits, links, accessibility, overflow) did not run');
  else if (!job.review.pass) out.push(...job.review.problems.map((p) => `rendered review: ${p}`));
  out.push(...presendProblems(job));
  return out;
}

/**
 * What a customer must never be sent, checked on every version whatever rules it was made under: a Visit page without
 * the business's verified address and hours, and words that send the reader to a page this site does not have.
 */
export function presendProblems(job: FrontendJob): string[] {
  const out: string[] = [];
  const pages = job.pages ?? [];
  if (pages.some((p) => p.slug === 'visit')) {
    const visit = job.site?.pages.find((p) => p.slug === 'visit')?.html ?? '';
    for (const k of ['address', 'hours'] as const) {
      if (!job.input.facts[k]) out.push(`the Visit page has no verified ${k}: the research found none for this listing, so it cannot show one`);
      else if (!new RegExp(`data-fact="${k}"`).test(visit)) out.push(`the Visit page does not show the verified ${k}`);
    }
  }
  const all = [{ slug: 'home', html: job.code?.html ?? '' }, ...(job.site?.pages ?? [])];
  for (const p of all) {
    const $ = load(p.html, {}, false);
    $('[data-fact], [data-action]').remove();
    const own = $.root().find('*').addBack().contents().toArray().filter((n) => n.type === 'text').map((n) => (n as unknown as { data: string }).data).join(' | ');
    out.push(...pageReferenceProblems(own, pages, p.slug));
  }
  return out;
}

/** a version's checks for the staff screen: what blocks it, and what staff must look at before approving */
export function versionChecks(job: FrontendJob) {
  return {
    blocking: blockingProblems(job),
    staff: [
      ...(job.withheldPhotos ?? []).map((w) => `${w.action === 'review' ? 'photo needs staff review' : 'photo withheld'}: ${w.id} (${w.seen ?? 'no description'}): ${w.reason}`),
      ...(job.review?.notes ?? []).map((n) => `accessibility: ${n}`),
      ...job.input.notes.map((n) => `research note: ${n}`),
      'copy: new wording is Claude\'s draft; the owner reviews it before anything is published',
    ],
  };
}

// ───────────────────────── the customer's messages ─────────────────────────
export interface CustomReply { text: string; url?: string; title?: string; quickReplies?: string[] }
export const DONE_CHOICES = ['Approve and publish', 'Request another version'];

/** a short answer from the saved run while it works (nothing is started by asking) */
export function statusText(run: CustomRun): string {
  if (run.stage === 'research') return 'I\'m still researching your business. I\'ll send the link here when your preview is ready.';
  const v = versionInFlight(run);
  const other = run.versions.some((x) => x.status === 'sent');
  if (v?.status === 'review') return `${other ? 'Your new version is' : 'Your preview is'} built, and I'm checking it now. I'll send the link here when it's ready.`;
  const where = v?.stage === 'pages' ? ' I\'m on the inner pages now.' : v ? ' I\'m on the homepage now.' : '';
  return `${other ? 'Still making your other version.' : 'Still building your preview.'}${where} I'll send the link here when it's ready.`;
}

/** messages the customer has not had yet about this run (each is recorded on the run, so it is sent once) */
export function customMessages(run: CustomRun): CustomReply[] {
  const out: CustomReply[] = [];
  const latestSent = [...run.versions].reverse().find((v) => v.status === 'sent');
  if (run.stage === 'failed' && !run.told?.includes('failed')) {
    run.told = [...(run.told ?? []), 'failed'];
    out.push({ text: 'Sorry, I couldn\'t finish researching your business this time. Reply "try again" and I\'ll start again.', quickReplies: ['Try again'] });
  }
  for (const v of run.versions) {
    const told = (k: NonNullable<CustomVersion['told']>[number]) => { if (v.told?.includes(k)) return true; v.told = [...(v.told ?? []), k]; return false; };
    // a version waiting for its final check gets no message: the customer hears when the link is ready
    if (v.status === 'review') told('review');
    if (v.status === 'failed' && v.error?.startsWith('cap:') && !told('failed')) {
      const earlier = run.versions.filter((x) => x.n !== v.n && x.status === 'sent').pop();
      out.push({ text: `I can't make another version on this beta invite.${earlier ? ` Your current preview is still here: ${earlier.url}` : ''} I'll be in touch about next steps.`, ...(earlier ? { url: earlier.url, title: `${run.name} · website preview`, quickReplies: DONE_CHOICES } : {}) });
      continue;
    }
    if (v.status === 'failed' && !told('failed')) {
      const earlier = run.versions.filter((x) => x.n !== v.n && x.status === 'sent').pop();
      out.push(earlier
        ? { text: `Sorry, I couldn't make another version this time. Your current preview is still here: ${earlier.url}`, url: earlier.url, title: `${run.name} · website preview`, quickReplies: DONE_CHOICES }
        : { text: 'Sorry, I couldn\'t finish your preview this time. Reply "try again" and I\'ll build a new one.', quickReplies: ['Try again'] });
    }
    if (v.status === 'rejected' && !told('rejected')) {
      const earlier = run.versions.filter((x) => x.n !== v.n && x.status === 'sent').pop();
      out.push(earlier
        ? { text: `I wasn't happy with how the new version came out, so I haven't sent it. Your current preview is still here: ${earlier.url}`, url: earlier.url, title: `${run.name} · website preview`, quickReplies: DONE_CHOICES }
        : { text: 'I wasn\'t happy with how your preview came out, so I haven\'t sent it. Reply "try again" and I\'ll build a new one.', quickReplies: ['Try again'] });
    }
    if (v.status === 'sent' && v === latestSent && !told('sent')) out.push({ text: v.n === 1 ? `Here's a preview of a new site for ${run.name}.` : `Here's another version of your site.`, url: v.url, title: `${run.name} · website preview`, quickReplies: DONE_CHOICES });
  }
  return out;
}

/** "Request another version" / "try again": one new version, never a second while one is being made or reviewed */
export function requestCustomVersion(run: CustomRun): 'started' | 'busy' | 'unavailable' {
  if (run.stage !== 'versions') return 'unavailable';
  if (versionInFlight(run)) return 'busy';
  run.versions.push({ n: run.versions.length + 1, requestedAt: now(), status: 'generating' });
  return 'started';
}

/** "Approve and publish": records the exact version last shown. Publishing is not part of this rehearsal. */
export function recordApproval(run: CustomRun): CustomRun['approved'] | undefined {
  const v = run.versions.find((x) => x.n === run.shown && x.status === 'sent');
  if (!v) return undefined;
  run.approved = { n: v.n, jobId: v.jobId!, url: v.url!, at: now() };
  return run.approved;
}

/** staff: send a reviewed version to the customer (once; a second approval changes nothing) */
export async function staffSend(run: CustomRun, n: number, reviewer: string, note?: string): Promise<{ sent: boolean; reason?: string; url?: string }> {
  const v = run.versions.find((x) => x.n === n);
  if (!v) return { sent: false, reason: `no version ${n}` };
  if (v.status === 'sent') return { sent: false, reason: 'already sent', url: v.url };
  if (v.status !== 'review') return { sent: false, reason: `version ${n} is ${v.status}, not waiting for review` };
  if (!config.publicOrigin) return { sent: false, reason: 'no public HTTPS origin is configured (ROGER_PUBLIC_ORIGIN): a customer link is never sent from localhost or an internal address' };
  const job = await getFrontendJob(v.jobId!);
  const blocking = job ? blockingProblems(job) : ['the generation job is missing'];
  if (blocking.length) return { sent: false, reason: `it cannot be sent: ${blocking.join('; ')}` };
  v.url = customerLink(v.jobId!);
  await studioDocs.put('customer-links', v.jobId!, { jobId: v.jobId, runId: run.id, n, sentAt: now(), reviewer });
  v.status = 'sent'; v.sentAt = now(); v.reviewedAt = v.sentAt; v.reviewer = reviewer; if (note) v.note = note;
  run.shown = n;
  return { sent: true, url: v.url };
}
/**
 * staff: run the checks again on a version that failed only its checks (its generation finished): no new generation.
 * If nothing blocks it now, it waits for review like any other version.
 */
export async function staffRecheck(run: CustomRun, n: number): Promise<{ ok: boolean; reason?: string }> {
  const v = run.versions.find((x) => x.n === n);
  if (!v?.jobId || v.status !== 'failed') return { ok: false, reason: v ? `version ${n} is ${v.status}` : `no version ${n}` };
  const before = await getFrontendJob(v.jobId);
  if (before?.status !== 'needs-review') return { ok: false, reason: 'its generation failed, so there is nothing to check again' };
  const job = await recheckVersion(v.jobId);
  // queued for the worker: the version waits for its checks like a new one (the intake picks up the result)
  if (job.stage === 'checks') { v.status = 'generating'; v.error = undefined; v.note = `checks re-run requested ${now()}`; return { ok: true }; }
  const blocking = blockingProblems(job);
  if (blocking.length) { v.error = blocking.join('; '); return { ok: false, reason: `still blocked: ${v.error}` }; }
  v.status = 'review'; v.error = undefined; v.note = `checks re-run ${now()} after: ${v.note ?? 'a failed check'}`;
  return { ok: true };
}
/**
 * staff: one recovery of a version whose inner pages failed after its homepage was accepted: the saved homepage, brief
 * and photo checks are reused (no research, no new homepage); only the inner pages are written again, once.
 */
export async function staffResume(run: CustomRun, n: number): Promise<{ ok: boolean; reason?: string }> {
  const v = run.versions.find((x) => x.n === n);
  if (!v?.jobId || v.status !== 'failed') return { ok: false, reason: v ? `version ${n} is ${v.status}` : `no version ${n}` };
  if (versionInFlight(run)) return { ok: false, reason: 'another version is being made or reviewed' };
  const job = await getFrontendJob(v.jobId);
  if (job?.status !== 'failed' || job.stage !== 'pages' || !job.code) return { ok: false, reason: 'it has no accepted homepage to resume from' };
  try { await resumeFrontendJob(v.jobId); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  v.status = 'generating'; v.note = `inner pages resumed by staff ${now()} after: ${v.error ?? 'a failure'}`; v.error = undefined; v.finishedAt = undefined;
  return { ok: true };
}
/** staff: reject a version; the customer keeps any earlier preview */
export function staffReject(run: CustomRun, n: number, reviewer: string, note: string): { ok: boolean; reason?: string } {
  const v = run.versions.find((x) => x.n === n);
  if (!v || v.status !== 'review') return { ok: false, reason: v ? `version ${n} is ${v.status}` : `no version ${n}` };
  v.status = 'rejected'; v.reviewedAt = now(); v.reviewer = reviewer; v.note = note;
  return { ok: true };
}
