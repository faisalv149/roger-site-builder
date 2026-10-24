import { searchCandidates } from '../sources/places.js';
import type { BusinessCandidate } from '../types.js';
import { parseLookupInput } from '../sources/maps-url.js';
import { runAudit, type BuildResult } from '../pipeline.js';
import { getJob, queueDepth, startBuild, waitForJob } from '../jobs.js';
import { estimateBuild, friendlyDuration } from '../estimate.js';
import { config } from '../config.js';
import { getConversation, saveConversation, type Conversation } from '../store.js';
import { confirmBusinessCard, noWebsiteCard, type IMessageCard } from './cards.js';

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
  if (!config.imessageOutboundUrl) return;
  await fetch(config.imessageOutboundUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, replies }), signal: AbortSignal.timeout(10_000) })
    .then((r) => { if (!r.ok) console.warn(`[imessage] outbound ${r.status} for ${from}`); })
    .catch((e) => console.warn(`[imessage] outbound failed for ${from}: ${(e as Error).message}`));
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
    }));
    if (ctx.async) {
      ctx.pending = { jobId: job.id, seconds: eta.seconds, label: eta.label };
      const delivered = finished.then((f) => deliverLater(from, job.id, f.replies, f.siteUrl)).catch((e) => console.error(`[imessage] delivering ${job.id} failed`, e));
      await keepAlive(delivered);
      return [ack];
    }
    const f = await finished;
    s.state = 'done';
    if (f.siteUrl) s.lastSiteUrl = f.siteUrl;
    return [ack, ...f.replies];
  }

  if (/build|preview/i.test(msg) && s.chosen) { s.state = 'offer'; return respond(from, 'yes', ctx); }
  return [{ text: s.lastSiteUrl ? `Your preview is here: ${s.lastSiteUrl}\nText "restart" to begin again.` : 'Text "restart" to begin again.' }];
}

/** Start the flow over for this sender. The saved messages stay; only the flow state is cleared. */
export async function resetSession(from: string) {
  const c = await getConversation(from);
  if (c) { c.session = undefined; c.updatedAt = new Date().toISOString(); await saveConversation(c); }
}
