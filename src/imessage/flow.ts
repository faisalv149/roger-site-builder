import { searchCandidates } from '../sources/places.js';
import type { BusinessCandidate } from '../types.js';
import { parseLookupInput } from '../sources/maps-url.js';
import { runAudit, type BuildResult } from '../pipeline.js';
import { getJob, queueDepth, startBuild, waitForJob } from '../jobs.js';
import { estimateBuild, friendlyDuration } from '../estimate.js';
import { config } from '../config.js';
import { getBuild, getConversation, saveConversation, type Conversation } from '../store.js';
import { confirmBusinessCard, noWebsiteCard, type IMessageCard } from './cards.js';
import { DIRECTION_LABEL, GOAL_LABEL, type DesignPreferences } from '../design/schema.js';
import { parseGoal, parseService, parseStyle, parseYesNo, type Step } from '../design/answers.js';
import { personaliseInfo, startRefinement } from '../design/refine.js';
import { profileFor, type Category } from '../design/categories.js';
import { getDraft, issueOwnerKey, ownerUrl, putDraft, withDraftLock } from '../drafts.js';
import { channelFor } from '../channels.js';
import { addComparisonToReport, canScoreNewSite, scoreMessage, scoreNewSite } from '../audit/compare.js';
import { saveBuild } from '../store.js';
import type { Job } from '../jobs.js';

/**
 * Reference conversation for the Roger iMessage flow. Your iMessage gateway posts each
 * inbound text here and sends back the replies (text + optional URL → iMessage renders
 * the rich card from the page's og:image).
 *
 *  start → (website / name+ZIP / maps link) → confirm "Is this you?" → audit or no-website → build → preview
 */
type State = 'start' | 'need-business' | 'confirm' | 'offer' | 'building' | 'done';
interface Session {
  state: State;
  website?: string;
  candidates: BusinessCandidate[];
  idx: number;
  chosen?: BusinessCandidate;
  lastSiteUrl?: string;
  lastBuildId?: string;
  /** when the running build started and how long Roger said it would take */
  buildEta?: { startedAt: number; seconds: number };
  /** the website audit from this conversation, attached to the build so the Studio can show it */
  audit?: BuildResult['audit'];
  /** personalising the preview: which question is next and the answers so far (saved, so a restart resumes here) */
  personalise?: { step: Step; buildId: string; prefs: DesignPreferences; suggestions: string[]; phoneOk: boolean; emergencyVerified: boolean; category?: Category };
}
const fresh = (): Session => ({ state: 'start', candidates: [], idx: 0 });

// The session is saved with the conversation (src/store.ts) and loaded on every message: on Vercel the next
// message can reach a different server instance, so memory can't be trusted between messages.
async function loadSession(from: string): Promise<Session> {
  return ((await getConversation(from))?.session as Session | undefined) || fresh();
}

async function record(from: string, add: Conversation['messages'], s: Session): Promise<Conversation> {
  const now = new Date().toISOString();
  const c: Conversation = (await getConversation(from)) || { from, startedAt: now, updatedAt: now, messages: [], buildIds: [] };
  c.messages.push(...add);
  c.updatedAt = now;
  c.business = s.chosen?.name || c.business;
  if (s.lastBuildId && !c.buildIds.includes(s.lastBuildId)) c.buildIds.push(s.lastBuildId);
  c.session = s;
  try { await saveConversation(c); } catch (e) { console.error(`[imessage] could not save conversation ${from}`, e); }
  return c;
}

export interface Reply { text: string; url?: string; image?: string; title?: string; quickReplies?: string[] }
const fromCard = (c: IMessageCard): Reply => ({ text: c.text, url: c.url, image: c.image, title: c.title, quickReplies: c.quickReplies });
const outgoing = (replies: Reply[]): Conversation['messages'] => { const at = new Date().toISOString(); return replies.map((r) => ({ dir: 'out' as const, at, ...r })); };

const PERSONALISE = /\b(personali[sz]e|customi[sz]e|change (something|it|the (style|design|look|layout))|tweak|make it (more )?mine)\b/i;
const ALTERNATIVE = /\b(different|another|other|new) (design|look|style|layout)\b|\btry (a|another) design\b/i;
const YES = /^(y|yes|yep|yeah|yup|sure|correct|that'?s (me|us|it)|ok|okay|please|do it|build it|let'?s go|sounds good|go ahead|show me)\b/i;
const NO = /^(n|no|nope|not (me|us|really|now)|wrong)\b/i;
const URL_RE = /(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+\.(?:com|net|org|biz|us|co|io|pro|info|services|site)(?:\/[^\s]*)?)/i;

export interface InboundResult {
  replies: Reply[];
  /** async mode: a build is running and its preview will follow as a later message */
  pending?: { jobId: string; seconds: number; label: string };
  /** saved messages in this conversation so far; later replies are the ones after this */
  messageCount: number;
}
interface Ctx { async: boolean; s: Session; pending?: InboundResult['pending'] }

/**
 * One inbound text → Roger's replies. Both are saved as they happen.
 * async: reply "On it, about 20 seconds" right away and send the preview when the build finishes
 * (saved to the conversation and POSTed to IMESSAGE_OUTBOUND_URL). Otherwise everything comes back in one go.
 */
export async function handleInbound(from: string, text: string, opts: { async?: boolean } = {}): Promise<InboundResult> {
  const ctx: Ctx = { async: !!opts.async, s: await loadSession(from) };
  await record(from, [{ dir: 'in', at: new Date().toISOString(), text }], ctx.s);
  const replies = await respond(from, text, ctx);
  const c = await record(from, outgoing(replies), ctx.s);
  return { replies, pending: ctx.pending, messageCount: c.messages.length };
}

/**
 * Is a preview build still running? Locally this server ran it, so its job list knows. On Vercel another
 * instance may be running it, so go by the start time: well past the estimate means the build died.
 */
function pending(s: Session): boolean {
  if (s.state !== 'building' || !s.lastBuildId || !s.buildEta) return false;
  if (getJob(s.lastBuildId)) return true;
  if (!process.env.VERCEL) return false; // single server: no job here means it restarted mid-build
  return Date.now() - s.buildEta.startedAt < Math.min(10 * 60_000, Math.max(120_000, s.buildEta.seconds * 4000));
}
export async function isPending(from: string): Promise<boolean> {
  return pending(await loadSession(from));
}

/** The build finished after "On it": update the saved session (if it's still about this build) and send the preview. */
async function deliverLater(from: string, jobId: string, replies: Reply[], siteUrl?: string) {
  const s = await loadSession(from);
  if (s.lastBuildId === jobId && s.state === 'building') { s.state = 'done'; if (siteUrl) s.lastSiteUrl = siteUrl; }
  await record(from, outgoing(replies), s);
  await channelFor(from).deliver(from, replies);
}

/**
 * The owner's private editor link for a finished build: customise, save, demo purchase and domain setup. Each
 * new link replaces the previous one (src/drafts.ts); the Studio can issue or revoke links too.
 */
async function ownerLinkReply(job: Job): Promise<Reply[]> {
  const id = job.result?.draftId;
  if (!id) return [];
  const url = await withDraftLock(id, async () => {
    const d = await getDraft(id);
    if (!d) return undefined;
    const key = issueOwnerKey(d);
    await putDraft(d);
    return ownerUrl(d, key);
  });
  return url ? [{ text: `Want to change colours, fonts, layout or prices? Open your private editor (it's only for you, so please don't share it): ${url}`, url, title: 'Customise your website' }] : [];
}

/**
 * After the preview is delivered: score the new site with the same checks as the owner's current site, add the
 * comparison to their website report (same link), and text both scores. Runs in the background so the preview
 * never waits for it; anything that fails just means no score message.
 */
async function scoreFollowUp(from: string, job: Job): Promise<void> {
  const r = job.result;
  if (job.status !== 'done' || !r || r.newSite || !canScoreNewSite(r.siteUrl)) return;
  try {
    const business = r.draftId ? (await getDraft(r.draftId))?.base.business : undefined; // stored with the draft: no new Places request
    const newSite = await scoreNewSite(r.siteUrl, business);
    const rec = await getBuild(job.id);
    if (rec?.result) { rec.result.newSite = newSite; await saveBuild(rec); }
    const old = r.audit as (typeof r.audit & { reportUrl?: string }) | undefined;
    const reportUrl = old ? await addComparisonToReport(old, newSite, { businessName: r.business.name, siteUrl: r.siteUrl }) : undefined;
    const replies: Reply[] = [{ text: scoreMessage(old, newSite, reportUrl), ...(reportUrl ? { url: reportUrl } : {}) }];
    const s = await loadSession(from);
    await record(from, outgoing(replies), s);
    await channelFor(from).deliver(from, replies);
  } catch (e) {
    console.warn(`[imessage] scoring the new site for ${from} failed: ${(e as Error).message}`);
  }
}

/** On Vercel the function would stop after the response; waitUntil keeps it alive until the build is delivered. */
async function keepAlive(p: Promise<unknown>) {
  if (!process.env.VERCEL) return;
  const { waitUntil } = await import('@vercel/functions');
  waitUntil(p);
}

async function respond(from: string, text: string, ctx: Ctx): Promise<Reply[]> {
  const msg = text.trim();
  if (/^(restart|reset|start over)$/i.test(msg)) { ctx.s = fresh(); return respond(from, 'hi', ctx); }
  const s = ctx.s;

  if (s.state === 'building') {
    if (pending(s)) {
      const left = s.buildEta ? s.buildEta.seconds - (Date.now() - s.buildEta.startedAt) / 1000 : 0;
      return [{ text: left > 8 ? `Still working on your preview. ${friendlyDuration(left).label.replace(/^about /, 'About ')} to go.` : 'Almost done. It will be here in a moment.' }];
    }
    s.state = 'offer'; // the server restarted (or the function stopped) mid-build
    return [{ text: 'Sorry, building your preview got interrupted. Want me to try again?', quickReplies: ['Yes, build it', 'Not now'] }];
  }

  // personalising the preview: the three optional questions, one per message
  if (s.state === 'done' && s.personalise) return personaliseStep(from, msg, ctx);

  if (s.state === 'start' && !URL_RE.test(msg) && !/\d{5}/.test(msg)) {
    s.state = 'need-business';
    return [{ text: "Hi, I'm Roger. I help local businesses get more calls from their website.\n\nDo you have a website? Send me the link. If not, send your business name and ZIP code and I'll find you on Google." }];
  }

  if (s.state === 'start' || s.state === 'need-business') {
    const url = msg.match(URL_RE)?.[0];
    let query = msg;
    if (url) {
      const isGoogle = /google\.|goo\.gl|g\.page/.test(url) || parseLookupInput(url).kind !== 'text';
      if (!isGoogle) { s.website = url; query = msg.replace(url, '').replace(/^[\s,.;-]+|[\s,.;-]+$/g, '').trim(); }
      else query = url;
    }
    if (!query) {
      s.state = 'need-business';
      return [{ text: 'Thanks, got your website. What is the business name and ZIP code, so I can match your Google Business Profile?' }];
    }
    const { candidates } = await searchCandidates(query, { limit: 5 });
    if (!candidates.length) {
      s.state = 'need-business';
      return [{ text: "I couldn't find that on Google. Can you send the exact business name and ZIP, or a Google Maps link to your listing?" }];
    }
    s.candidates = candidates;
    s.idx = 0;
    s.state = 'confirm';
    return [fromCard(await confirmBusinessCard(candidates[0]))];
  }

  if (s.state === 'confirm') {
    if (NO.test(msg)) {
      s.idx++;
      if (s.idx < s.candidates.length) return [fromCard(await confirmBusinessCard(s.candidates[s.idx]))];
      s.state = 'need-business';
      return [{ text: 'No problem. Send me a Google Maps link to your business, or the name and ZIP code exactly as it shows on Google.' }];
    }
    if (!YES.test(msg)) return [{ text: 'Is that your business? Reply yes or no.' }];
    s.chosen = s.candidates[s.idx];
    s.state = 'offer';
    const site = s.website || s.chosen.website;
    if (site) {
      s.website = site;
      const a = await runAudit({ website: site, placeId: s.chosen.placeId });
      s.audit = { ...a.audit, reportUrl: a.reportUrl, image: a.image };
      return [
        { text: `Great. I just checked your website.` },
        fromCard(a.card),
      ];
    }
    return [fromCard(noWebsiteCard(s.chosen.name, (await estimateBuild({ website: false, audit: false, queue: queueDepth() })).label))];
  }

  if (s.state === 'offer') {
    if (NO.test(msg)) { s.state = 'done'; return [{ text: "No worries. If you change your mind, just text me \"build my site\"." }]; }
    if (!YES.test(msg) && !/build|preview|new site/i.test(msg)) return [{ text: 'Want me to build the free preview? Reply yes or no.' }];
    const eta = await estimateBuild({ website: !!s.website, audit: false, queue: queueDepth() }); // the audit already ran
    const job = startBuild({ placeId: s.chosen!.placeId, website: s.website, audit: false }, { source: 'imessage', from, audit: s.audit });
    s.lastBuildId = job.id;
    s.state = 'building';
    s.buildEta = { startedAt: Date.now(), seconds: eta.seconds };
    const ack: Reply = { text: `On it. Your preview will be ready in ${eta.label}.` };
    const finished = waitForJob(job).then(() => ({
      siteUrl: job.result?.siteUrl,
      replies: job.status === 'done' && job.result
        ? [fromCard(job.result.cards.find((c) => c.kind === 'site-preview')!)]
        : [{ text: `Sorry, something went wrong building the preview (${job.error}). I'll have a person look at it.` }],
    })).then(async (f) => (job.status === 'done' ? { ...f, replies: [...f.replies, ...(await ownerLinkReply(job))] } : f));
    if (ctx.async) {
      ctx.pending = { jobId: job.id, seconds: eta.seconds, label: eta.label };
      const delivered = finished.then((f) => deliverLater(from, job.id, f.replies, f.siteUrl)).catch((e) => console.error(`[imessage] delivering ${job.id} failed`, e)).then(() => scoreFollowUp(from, job));
      await keepAlive(delivered);
      return [ack];
    }
    const f = await finished;
    void scoreFollowUp(from, job); // the scores follow as their own message
    s.state = 'done';
    if (f.siteUrl) s.lastSiteUrl = f.siteUrl;
    return [ack, ...f.replies];
  }

  if (s.state === 'done' && s.lastBuildId) {
    if (ALTERNATIVE.test(msg)) return refine(from, ctx, s.lastBuildId, {}, true);
    if (PERSONALISE.test(msg)) return startPersonalise(s);
  }

  if (/build|preview/i.test(msg) && s.chosen) { s.state = 'offer'; return respond(from, 'yes', ctx); }
  return [{ text: s.lastSiteUrl ? `Your preview is here: ${s.lastSiteUrl}\nText "restart" to begin again.` : 'Text "restart" to begin again.' }];
}

/* ── personalising a preview: same preferences and rebuild path as the Studio ── */
async function startPersonalise(s: Session): Promise<Reply[]> {
  const rec = await getBuild(s.lastBuildId!);
  if (!rec?.result) return [{ text: 'I can personalise your site once the preview is built. Text "build my site" to start.' }];
  const info = personaliseInfo(rec);
  if (!info.eligible) return [{ text: `${info.reason || 'Personalising isn\'t available for this site yet'}. Your preview stays as it is.` }];
  const category = rec.result.design?.category ?? 'trades';
  s.personalise = { step: 'service', buildId: rec.id, prefs: {}, suggestions: info.suggestions.slice(0, 3), phoneOk: info.phoneOk, emergencyVerified: info.emergencyVerified, category };
  return [ask(s)];
}

function ask(s: Session): Reply {
  const p = s.personalise!;
  const keep = 'Keep recommended';
  const prof = profileFor(p.category);
  if (p.step === 'service') return { text: `Three quick questions, all optional. Say "keep" to leave any as it is.\n\n1. Which ${prof.noun} should your website feature first?${p.suggestions.length ? ' Pick one or type your own.' : ' Tell me in a few words.'}`, quickReplies: [...p.suggestions, keep] };
  if (p.step === 'goal') return { text: `2. What should visitors do?${p.phoneOk ? '' : ' (Your Google profile has no phone number, so calling isn\'t an option yet.)'}`, quickReplies: [...prof.goals.filter((g) => g !== 'call' || p.phoneOk).map((g) => (g === 'call' ? 'Call' : prof.actions[g])), keep] };
  if (p.step === 'style') return { text: '3. How should your business feel?', quickReplies: ['Clean professional', 'Warm local', 'Bold practical', 'Editorial showcase', keep] };
  return { text: 'Do you offer emergency call-outs? I\'ll only mention it on your site if you do.', quickReplies: ['Yes', 'No'] };
}

async function personaliseStep(from: string, msg: string, ctx: Ctx): Promise<Reply[]> {
  const s = ctx.s;
  const p = s.personalise!;
  if (/^(cancel|stop|never ?mind|quit)\.?$/i.test(msg)) { s.personalise = undefined; return [{ text: 'No problem, your preview stays as it is.' }]; }
  const extra: Reply[] = [];
  const retry = (error: string): Reply[] => [{ text: error, quickReplies: ask(s).quickReplies }];
  if (p.step === 'service') {
    const a = parseService(msg, p.suggestions);
    if ('error' in a) return retry(a.error);
    if ('value' in a) p.prefs.service = a.value;
    p.step = 'goal';
    return [ask(s)];
  }
  if (p.step === 'goal') {
    const a = parseGoal(msg, p.phoneOk);
    if ('error' in a) return retry(a.error);
    if ('value' in a) p.prefs.goal = a.value;
    p.step = 'style';
    if (p.prefs.goal === 'appointment') extra.push({ text: 'Got it. Visitors will send an appointment request and you confirm the time; there\'s no live booking calendar yet.' });
    return [...extra, ask(s)];
  }
  if (p.step === 'style') {
    const a = parseStyle(msg);
    if ('error' in a) return retry(a.error);
    if ('value' in a) p.prefs.style = a.value;
    // a bold style doesn't make a business an emergency service: ask, unless the business already says so
    if (p.prefs.style === 'bold-direct' && !p.emergencyVerified && (p.category ?? 'trades') === 'trades') { p.step = 'emergency'; return [ask(s)]; }
  } else {
    const a = parseYesNo(msg);
    if ('error' in a) return retry(a.error);
    if ('value' in a) p.prefs.emergencyConfirmed = a.value;
  }
  const { buildId, prefs } = p;
  s.personalise = undefined;
  return refine(from, ctx, buildId, prefs, false);
}

/** Rebuild with the answers (or as an alternative design); the updated preview follows like a first build. */
async function refine(from: string, ctx: Ctx, buildId: string, prefs: DesignPreferences, alternative: boolean): Promise<Reply[]> {
  const s = ctx.s;
  const eta = await estimateBuild({ website: !!s.website, audit: false, queue: queueDepth() });
  const r = await startRefinement(buildId, { preferences: prefs, alternative }, { source: 'imessage' });
  if (!r.ok) return [{ text: `I couldn't update the site: ${r.error}` }];
  const job = r.job;
  s.lastBuildId = job.id;
  s.state = 'building';
  s.buildEta = { startedAt: Date.now(), seconds: eta.seconds };
  const ack: Reply = { text: alternative ? `On it: a different design. It will be ready in ${eta.label}.` : `Thanks. Updating your preview now; it will be ready in ${eta.label}.` };
  const finished = waitForJob(job).then(() => ({
    siteUrl: job.result?.siteUrl,
    replies: job.status === 'done' && job.result ? [updatedCard(job)] : [{ text: `Sorry, something went wrong updating the preview (${job.error}). Your earlier preview still works.` }],
  })).then(async (f) => (job.status === 'done' ? { ...f, replies: [...f.replies, ...(await ownerLinkReply(job))] } : f));
  if (ctx.async) {
    ctx.pending = { jobId: job.id, seconds: eta.seconds, label: eta.label };
    const delivered = finished.then((f) => deliverLater(from, job.id, f.replies, f.siteUrl)).catch((e) => console.error(`[imessage] delivering ${job.id} failed`, e)).then(() => scoreFollowUp(from, job));
    await keepAlive(delivered);
    return [ack];
  }
  const f = await finished;
  void scoreFollowUp(from, job); // the scores follow as their own message
  s.state = 'done';
  if (f.siteUrl) s.lastSiteUrl = f.siteUrl;
  return [ack, ...f.replies];
}

function updatedCard(job: Job): Reply {
  const card = job.result!.cards.find((c) => c.kind === 'site-preview')!;
  const p = job.result!.design;
  return {
    ...fromCard(card),
    text: p ? `Here's your updated preview: ${DIRECTION_LABEL[p.direction]}, leading with ${p.service.label.toLowerCase()}, main button "${profileFor(p.category).actions[p.goal]}".` : card.text,
    quickReplies: ['Looks great, publish it', 'Try a different design', 'Personalise it'],
  };
}

/** Start the flow over for this sender. The saved messages stay; only the flow state is cleared. */
export async function resetSession(from: string) {
  const c = await getConversation(from);
  if (c) { c.session = undefined; c.updatedAt = new Date().toISOString(); await saveConversation(c); }
}
