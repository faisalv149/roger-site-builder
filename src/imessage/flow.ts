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
// Sessions live in memory and are mirrored to data/conversations/ (src/store.ts) with every message.
const sessions = new Map<string, Session>();
const fresh = (): Session => ({ state: 'start', candidates: [], idx: 0 });

function getSession(from: string): Session {
  let s = sessions.get(from);
  if (!s) {
    s = (getConversation(from)?.session as Session | undefined) || fresh();
    sessions.set(from, s);
  }
  return s;
}

function record(from: string, add: Conversation['messages'], s: Session) {
  const now = new Date().toISOString();
  const c: Conversation = getConversation(from) || { from, startedAt: now, updatedAt: now, messages: [], buildIds: [] };
  c.messages.push(...add);
  c.updatedAt = now;
  c.business = s.chosen?.name || c.business;
  if (s.lastBuildId && !c.buildIds.includes(s.lastBuildId)) c.buildIds.push(s.lastBuildId);
  c.session = s;
  try { saveConversation(c); } catch (e) { console.error(`[imessage] could not save conversation ${from}`, e); }
}

export interface Reply { text: string; url?: string; image?: string; title?: string; quickReplies?: string[] }
const fromCard = (c: IMessageCard): Reply => ({ text: c.text, url: c.url, image: c.image, title: c.title, quickReplies: c.quickReplies });

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
interface Ctx { async: boolean; pending?: InboundResult['pending'] }

/**
 * One inbound text → Roger's replies. Both are saved as they happen.
 * async: reply "On it, about 20 seconds" right away and send the preview when the build finishes
 * (saved to the conversation and POSTed to IMESSAGE_OUTBOUND_URL). Otherwise everything comes back in one go.
 */
export async function handleInbound(from: string, text: string, opts: { async?: boolean } = {}): Promise<InboundResult> {
  record(from, [{ dir: 'in', at: new Date().toISOString(), text }], getSession(from));
  const ctx: Ctx = { async: !!opts.async };
  const replies = await respond(from, text, ctx);
  const at = new Date().toISOString();
  record(from, replies.map((r) => ({ dir: 'out' as const, at, ...r })), getSession(from));
  return { replies, pending: ctx.pending, messageCount: getConversation(from)?.messages.length ?? 0 };
}

/** Is a preview build running for this conversation? (the clients keep showing "typing" until it lands) */
export function isPending(from: string): boolean {
  const s = getSession(from);
  return s.state === 'building' && !!s.lastBuildId && !!getJob(s.lastBuildId);
}

function deliverLater(from: string, replies: Reply[]) {
  const at = new Date().toISOString();
  record(from, replies.map((r) => ({ dir: 'out' as const, at, ...r })), getSession(from));
  if (!config.imessageOutboundUrl) return;
  fetch(config.imessageOutboundUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, replies }), signal: AbortSignal.timeout(10_000) })
    .then((r) => { if (!r.ok) console.warn(`[imessage] outbound ${r.status} for ${from}`); })
    .catch((e) => console.warn(`[imessage] outbound failed for ${from}: ${(e as Error).message}`));
}

async function respond(from: string, text: string, ctx: Ctx): Promise<Reply[]> {
  const s = getSession(from);
  const msg = text.trim();
  if (/^(restart|reset|start over)$/i.test(msg)) { sessions.set(from, fresh()); return respond(from, 'hi', ctx); }

  if (s.state === 'building') {
    if (isPending(from)) {
      const left = s.buildEta ? s.buildEta.seconds - (Date.now() - s.buildEta.startedAt) / 1000 : 0;
      return [{ text: left > 8 ? `Still working on your preview. ${friendlyDuration(left).label.replace(/^about /, 'About ')} to go.` : 'Almost done. It will be here in a moment.' }];
    }
    s.state = 'offer'; // the server restarted mid-build
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
    return [fromCard(noWebsiteCard(s.chosen.name, estimateBuild({ website: false, audit: false, queue: queueDepth() }).label))];
  }

  if (s.state === 'offer') {
    if (NO.test(msg)) { s.state = 'done'; return [{ text: "No worries. If you change your mind, just text me \"build my site\"." }]; }
    if (!YES.test(msg) && !/build|preview|new site/i.test(msg)) return [{ text: 'Want me to build the free preview? Reply yes or no.' }];
    const eta = estimateBuild({ website: !!s.website, audit: false, queue: queueDepth() }); // the audit already ran
    const job = startBuild({ placeId: s.chosen!.placeId, website: s.website, audit: false }, { source: 'imessage', from, audit: s.audit });
    s.lastBuildId = job.id;
    s.state = 'building';
    s.buildEta = { startedAt: Date.now(), seconds: eta.seconds };
    const ack: Reply = { text: `On it. Your preview will be ready in ${eta.label}.` };
    const finished = waitForJob(job).then((): Reply[] => {
      s.state = 'done';
      if (job.status !== 'done' || !job.result) return [{ text: `Sorry, something went wrong building the preview (${job.error}). I'll have a person look at it.` }];
      s.lastSiteUrl = job.result.siteUrl;
      return [fromCard(job.result.cards.find((c) => c.kind === 'site-preview')!)];
    });
    if (ctx.async) {
      ctx.pending = { jobId: job.id, seconds: eta.seconds, label: eta.label };
      void finished.then((replies) => deliverLater(from, replies));
      return [ack];
    }
    return [ack, ...(await finished)];
  }

  if (/build|preview/i.test(msg) && s.chosen) { s.state = 'offer'; return respond(from, 'yes', ctx); }
  return [{ text: s.lastSiteUrl ? `Your preview is here: ${s.lastSiteUrl}\nText "restart" to begin again.` : 'Text "restart" to begin again.' }];
}

/** Start the flow over for this sender. The saved messages stay; only the flow state is cleared. */
export function resetSession(from: string) {
  sessions.delete(from);
  const c = getConversation(from);
  if (c) { c.session = undefined; c.updatedAt = new Date().toISOString(); saveConversation(c); }
}
