import { lookupCandidates } from '../sources/resolve.js';
import type { BusinessCandidate } from '../types.js';
import { parseLookupInput } from '../sources/maps-url.js';
import { runAudit, type BuildResult } from '../pipeline.js';
import { getJob, startBuild, waitForJob } from '../jobs.js';
import { getBuild, getConversation, saveConversation, type BuildRecord, type Conversation } from '../store.js';
import { confirmBusinessCard, noWebsiteCard, type IMessageCard } from './cards.js';
import { DIRECTION_LABEL, type DesignPreferences } from '../design/schema.js';
import { parseGoal, parseService, parseStyle, parseYesNo, type Step } from '../design/answers.js';
import { personaliseInfo, startRefinement } from '../design/refine.js';
import { profileFor, type Category } from '../design/categories.js';
import { getDraft, issueOwnerKey, ownerUrl, putDraft, withDraftLock } from '../drafts.js';
import { channelFor } from '../channels.js';
import { applyConcept, nextConcept } from '../studio/concepts/site.js';
import { addComparisonToReport, canScoreNewSite, scoreMessage, scoreNewSite } from '../audit/compare.js';
import { saveBuild } from '../store.js';
import type { Job } from '../jobs.js';

/**
 * Reference conversation for the Roger iMessage flow. Your iMessage gateway posts each
 * inbound text here and sends back the replies (text + optional URL → iMessage renders
 * the rich card from the page's og:image).
 *
 *  start → (website / name+ZIP / maps link) → confirm "Is this you?" → audit or no-website → build → preview
 *
 * Roger never promises how long a build takes: the preview is sent when it is ready, however long that is.
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
  /** when the running build started (ms) */
  buildStartedAt?: number;
  /** sessions saved before buildStartedAt carried the start time here */
  buildEta?: { startedAt: number; seconds: number };
  /** the owner's private editor link for the latest preview, kept so it can be sent again without replacing it */
  ownerUrl?: string;
  /** the owner asked for a person: a call, or help going live (shown in the Studio) */
  followUp?: { at: string; reason: 'call' | 'publish' };
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
  if (s.followUp) c.followUp = s.followUp;
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
const ZIP_RE = /\b\d{5}\b/;
// what people say that isn't an answer to the question in front of them
const GREETING = /^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening))( roger)?[\s!.,]*$/i;
const HELP = /^(help|info|\?)[\s!?.]*$|\b(what is (this|roger)|what's (this|roger)|who (are|is) (you|this)|how does (this|it) work|what do you do)\b/i;
const PRICE = /\b(how much|pricing|what does (it|this) cost|what('s| is) the (price|cost)|is (it|this|that) free|do you charge|any (costs?|fees?))\b/i;
const CALL = /^call me\b|\bcall me( back)?[\s!.]*$|\b(talk|speak) (to|with) (a |an )?(person|human|someone|real person|agent)\b/i;
const PUBLISH = /\b(publish|go live|put it live|launch it|buy (it|this|the site)|purchase|i'?ll take it|sign me up)\b/i;
const CHECK = /\bcheck the details\b|\bwhat needs (checking|my check|to be checked)\b/i;
const RETRY = /\b(try again|retry)\b/i;
const THANKS = /^(thanks|thank you|thx|ty|great|awesome|perfect|cool|nice|love it|ok|okay)[\s!.]*$/i;
const HAVE_SITE = /^(yes|yeah|yep|yup|i do|we do)[\s!.]*$/i;
const NO_SITE = /^(no|nope|i don'?t|we don'?t|no website|don'?t have one|not yet)[\s!.]*$/i;

export interface InboundResult {
  replies: Reply[];
  /** async mode: a build is running and its preview will follow as a later message */
  pending?: { jobId: string };
  /** saved messages in this conversation so far; later replies are the ones after this */
  messageCount: number;
}
interface Ctx { async: boolean; s: Session; pending?: InboundResult['pending'] }

/**
 * One inbound text → Roger's replies. Both are saved as they happen.
 * async: reply "On it" right away and send the preview when the build finishes
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
 * The longest a build can be running. Not a promise to the owner, only the point past which a build that never
 * reported back must have died (a serverless function has been stopped by then). BUILD_LIMIT_SECONDS overrides it.
 */
const buildLimitMs = () => Number(process.env.BUILD_LIMIT_SECONDS || 900) * 1000;

/**
 * Is a preview build still running? Locally this server ran it, so its job list knows. On Vercel another
 * instance may be running it: a finished build has a saved record; until then it counts as running.
 */
async function pending(s: Session): Promise<boolean> {
  if (s.state !== 'building' || !s.lastBuildId) return false;
  if (getJob(s.lastBuildId)) return true;
  if (!process.env.VERCEL) return false; // single server: no job here means it restarted mid-build
  if (await getBuild(s.lastBuildId).catch(() => undefined)) return false; // finished: its record is saved at the end
  const started = s.buildStartedAt ?? s.buildEta?.startedAt;
  return !!started && Date.now() - started < buildLimitMs();
}
export async function isPending(from: string): Promise<boolean> {
  return pending(await loadSession(from));
}

interface Finished { siteUrl?: string; ownerUrl?: string; replies: Reply[] }

/** The build finished after "On it": update the saved session (if it's still about this build) and send the preview. */
async function deliverLater(from: string, jobId: string, f: Finished) {
  const s = await loadSession(from);
  if (s.lastBuildId === jobId && s.state === 'building') {
    s.state = 'done';
    if (f.siteUrl) s.lastSiteUrl = f.siteUrl;
    if (f.ownerUrl) s.ownerUrl = f.ownerUrl;
  }
  await record(from, outgoing(f.replies), s);
  await channelFor(from).deliver(from, f.replies);
}

/**
 * The owner's private editor link for a draft: customise, save, buy and domain setup. Each new link replaces the
 * previous one (src/drafts.ts), so it is issued once per preview and kept in the session; the Studio can issue or
 * revoke links too.
 */
async function issueOwnerLink(draftId: string | undefined): Promise<string | undefined> {
  if (!draftId) return undefined;
  return withDraftLock(draftId, async () => {
    const d = await getDraft(draftId);
    if (!d) return undefined;
    const key = issueOwnerKey(d);
    await putDraft(d);
    return ownerUrl(d, key);
  });
}
const editorReply = (url: string): Reply => ({ text: `Want to change colors, fonts, photos or prices? Here's your private editor. It's just for you, so please don't share it: ${url}`, url, title: 'Customize your website' });

/** A finished build → what Roger sends: the preview card and the editor link, or an apology (the error goes to the log). */
async function finishedReplies(job: Job, kind: 'build' | 'update', s: Session): Promise<Finished> {
  if (job.status !== 'done' || !job.result) {
    console.error(`[imessage] ${kind} ${job.id} failed: ${job.error}`);
    return kind === 'build'
      ? { replies: [{ text: 'Sorry, something went wrong while building your preview. I\'ve flagged it for the team. Reply "try again" and I\'ll give it another go.', quickReplies: ['Try again'] }] }
      : { replies: [{ text: `Sorry, something went wrong while updating your preview.${s.lastSiteUrl ? ` Your earlier preview still works: ${s.lastSiteUrl}` : ''}` }] };
  }
  const owner = await issueOwnerLink(job.result.draftId).catch(() => undefined);
  const card = kind === 'build' ? fromCard(job.result.cards.find((c) => c.kind === 'site-preview')!) : updatedCard(job);
  return { siteUrl: job.result.siteUrl, ownerUrl: owner, replies: [card, ...(owner ? [editorReply(owner)] : [])] };
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

const host = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).host.replace(/^www\./, ''); } catch { return u; } };
const DONE_CHOICES = ['Personalize it', 'Try a different design', 'Publish it'];

/** The question in front of the owner, asked again after Roger answers something else. */
function nextStep(s: Session): Reply | undefined {
  if (s.state === 'start' || s.state === 'need-business') return { text: 'To get started, send me your website, or your business name and ZIP code.' };
  if (s.state === 'confirm' && s.candidates[s.idx]) return { text: `Is ${s.candidates[s.idx].name} your business?`, quickReplies: ['Yes, that\'s me', 'No, not us'] };
  if (s.state === 'offer') return { text: 'Want me to build your free website preview?', quickReplies: ['Yes, build it', 'Not now'] };
  if (s.state === 'done' && s.lastSiteUrl) return { text: `Your preview is here: ${s.lastSiteUrl}`, quickReplies: DONE_CHOICES };
  return undefined;
}
const andThen = (s: Session, first: Reply): Reply[] => { const n = nextStep(s); return n ? [first, n] : [first]; };

async function respond(from: string, text: string, ctx: Ctx): Promise<Reply[]> {
  const msg = text.trim();
  if (/^(restart|reset|start over)$/i.test(msg)) { ctx.s = fresh(); return respond(from, 'hi', ctx); }
  const s = ctx.s;

  if (s.state === 'building') {
    if (await pending(s)) return [{ text: 'Still building your preview. I\'ll text you the link as soon as it\'s ready.' }];
    // the build finished but its delivery didn't reach this conversation: send it now
    const rec = s.lastBuildId ? await getBuild(s.lastBuildId).catch(() => undefined) : undefined;
    const card = rec?.status === 'done' ? rec.result?.cards.find((c) => c.kind === 'site-preview') : undefined;
    if (rec?.result && card) {
      s.state = 'done';
      s.lastSiteUrl = rec.result.siteUrl;
      return [{ ...fromCard(card), text: `It's ready! ${card.text}` }];
    }
    s.state = 'offer'; // the server restarted (or the function stopped) mid-build
    return [{ text: 'Sorry, your preview didn\'t finish building. Want me to try again?', quickReplies: ['Yes, try again', 'Not now'] }];
  }

  // personalising the preview: the three optional questions, one per message
  if (s.state === 'done' && s.personalise) return personaliseStep(from, msg, ctx);

  // questions that can come at any point: answer, then go back to where the owner was
  const searching = URL_RE.test(msg) || ZIP_RE.test(msg);
  if (HELP.test(msg) && !searching) {
    return andThen(s, { text: 'I\'m Roger. I build free website previews for local businesses. You send me your website, or your business name and ZIP code, I find your Google listing, check your current site, and build you a new one to look at.' });
  }
  if (PRICE.test(msg) && !searching) {
    return andThen(s, { text: 'The preview is free, and there\'s nothing to sign up for. If you decide you want the site, you\'ll see the price before you buy anything.' });
  }
  if (CALL.test(msg) && !searching) {
    s.followUp = { at: new Date().toISOString(), reason: 'call' };
    return andThen(s, { text: 'Sure. I\'ve asked someone from the team to give you a call.' });
  }

  if (s.state === 'start' && !searching) {
    s.state = 'need-business';
    return [{ text: 'Hi, I\'m Roger! I build free website previews for local businesses, so you can see what a better site would look like before you spend anything.\n\nWhat\'s your website? If you don\'t have one, send me your business name and ZIP code.' }];
  }

  if (s.state === 'need-business' && !searching) {
    if (GREETING.test(msg)) return [{ text: 'Hi! Send me your website, or your business name and ZIP code, and I\'ll find you on Google.' }];
    if (HAVE_SITE.test(msg)) return [{ text: 'Great, send me the link.' }];
    if (NO_SITE.test(msg)) return [{ text: 'No problem. What\'s your business name and ZIP code? I\'ll find you on Google.' }];
  }

  if (s.state === 'start' || s.state === 'need-business') return findBusiness(msg, s);

  if (s.state === 'confirm') {
    if (NO.test(msg)) {
      s.idx++;
      if (s.idx < s.candidates.length) {
        const next = fromCard(await confirmBusinessCard(s.candidates[s.idx]));
        return [{ ...next, text: next.text.replace(/^Is this you\?/, 'How about this one?') }];
      }
      s.state = 'need-business';
      return [{ text: 'Sorry about that. Could you send a Google Maps link to your business? Or the name and ZIP code exactly as they appear on Google.' }];
    }
    if (searching && !YES.test(msg)) return findBusiness(msg, s); // they sent a different business instead of yes or no
    if (!YES.test(msg)) return [{ text: 'Is this your business? Just reply yes or no.', quickReplies: ['Yes, that\'s me', 'No, not us'] }];
    s.chosen = s.candidates[s.idx];
    s.state = 'offer';
    const site = s.website || s.chosen.website;
    if (site) {
      s.website = site;
      const a = await runAudit({ website: site, placeId: s.chosen.placeId });
      s.audit = { ...a.audit, reportUrl: a.reportUrl, image: a.image };
      return [
        { text: `Thanks! I just took a look at ${host(site)}. Here's what I found.` },
        fromCard(a.card),
      ];
    }
    return [fromCard(noWebsiteCard(s.chosen.name))];
  }

  if (s.state === 'offer') {
    if (NO.test(msg)) { s.state = 'done'; return [{ text: 'No problem. If you change your mind, just text me "build my site" anytime.' }]; }
    if (!YES.test(msg) && !/build|preview|new site|try again/i.test(msg)) return [{ text: 'Want me to build your free website preview? Just reply yes or no.', quickReplies: ['Yes, build it', 'Not now'] }];
    return build(from, ctx);
  }

  if (s.state === 'done' && s.lastBuildId && s.lastSiteUrl) {
    if (ALTERNATIVE.test(msg) || RETRY.test(msg)) {
      // a site made from a concept set: the next of its three concepts, never a random fourth
      const rec = await getBuild(s.lastBuildId);
      const d = rec?.result?.draftId ? await getDraft(rec.result.draftId) : undefined;
      const next = d?.concept ? await nextConcept(d.concept) : undefined;
      if (d?.concept && next) {
        await applyConcept(d.id, d.concept.setId, next);
        return [{ text: `Here's design ${next.id.toUpperCase()}, "${next.name}": ${s.lastSiteUrl}`, url: s.lastSiteUrl, quickReplies: DONE_CHOICES }];
      }
      return refine(from, ctx, s.lastBuildId, {}, true);
    }
    if (PERSONALISE.test(msg)) return startPersonalise(s);
    if (PUBLISH.test(msg)) return goLive(s);
    if (CHECK.test(msg)) return checkDetails(s);
    if (THANKS.test(msg)) return [{ text: `${/thank|thx|^ty\b/i.test(msg) ? 'You\'re welcome!' : 'Sounds good!'} Text me anytime if you'd like changes.`, quickReplies: DONE_CHOICES }];
  }

  if (s.chosen && (/build|preview/i.test(msg) || RETRY.test(msg))) { s.state = 'offer'; return respond(from, 'yes', ctx); }
  if (s.lastSiteUrl) return [{ text: `Here's your preview again: ${s.lastSiteUrl}\n\nI can personalize it, try a different design, or help you put it live. Text "restart" to start over with a different business.`, quickReplies: DONE_CHOICES }];
  return [{ text: 'Sorry, I didn\'t catch that. Send me your website, or your business name and ZIP code, and I\'ll find you on Google. Text "restart" anytime to start over.' }];
}

/** A website, a Google Maps link, or a name and ZIP → "Is this you?" */
async function findBusiness(msg: string, s: Session): Promise<Reply[]> {
  const url = msg.match(URL_RE)?.[0];
  let query = msg;
  let sentWebsite = false;
  if (url) {
    const isGoogle = /google\.|goo\.gl|g\.page/.test(url) || parseLookupInput(url).kind !== 'text';
    if (!isGoogle) { s.website = url; sentWebsite = true; query = msg.replace(url, '').replace(/^[\s,.;-]+|[\s,.;-]+$/g, '').trim(); }
    else query = url;
  }
  // a ZIP alone finds a postal code, not a business: with a website, Roger reads it and looks the business up by what it says
  if (!query && !s.website) {
    s.state = 'need-business';
    return [{ text: 'What\'s your business name and ZIP code? I\'ll use them to find your Google listing.' }];
  }
  let candidates: BusinessCandidate[];
  try {
    ({ candidates } = await lookupCandidates(query, { website: s.website, limit: 5 }));
  } catch (e) {
    console.warn(`[imessage] lookup of "${msg}" failed: ${(e as Error).message}`);
    s.state = 'need-business';
    return [{ text: url && !sentWebsite
      ? 'Sorry, I couldn\'t open that Google link. Could you send your business name and ZIP code instead?'
      : 'Sorry, I couldn\'t reach Google just now. Could you send that again in a minute?' }];
  }
  if (!candidates.length) {
    s.state = 'need-business';
    if (sentWebsite && !query) return [{ text: `I couldn't match ${host(url!)} to a Google listing. What's your business name and ZIP code? I'll look you up that way.` }];
    return [{ text: 'I couldn\'t find that on Google. Could you send the business name and ZIP code exactly as they appear on Google? A Google Maps link to your listing works too.' }];
  }
  s.candidates = candidates;
  s.idx = 0;
  s.state = 'confirm';
  return [fromCard(await confirmBusinessCard(candidates[0]))];
}

/** "Yes, build it": start the build and send the preview when it is ready. */
async function build(from: string, ctx: Ctx): Promise<Reply[]> {
  const s = ctx.s;
  const job = startBuild({ placeId: s.chosen!.placeId, website: s.website, audit: false }, { source: 'imessage', from, audit: s.audit }); // the audit already ran
  s.lastBuildId = job.id;
  s.state = 'building';
  s.buildStartedAt = Date.now();
  s.buildEta = undefined;
  const ack: Reply = { text: 'On it! I\'m building your preview now. I\'ll text you the link as soon as it\'s ready.' };
  return deliver(from, ctx, job, 'build', ack);
}

/** Wait for a build (or send "On it" now and the result later) and hand over what it produced. */
async function deliver(from: string, ctx: Ctx, job: Job, kind: 'build' | 'update', ack: Reply): Promise<Reply[]> {
  const s = ctx.s;
  const finished = waitForJob(job).then(() => finishedReplies(job, kind, s));
  if (ctx.async) {
    ctx.pending = { jobId: job.id };
    const delivered = finished.then((f) => deliverLater(from, job.id, f)).catch((e) => console.error(`[imessage] delivering ${job.id} failed`, e)).then(() => scoreFollowUp(from, job));
    await keepAlive(delivered);
    return [ack];
  }
  const f = await finished;
  void scoreFollowUp(from, job); // the scores follow as their own message
  s.state = 'done';
  if (f.siteUrl) s.lastSiteUrl = f.siteUrl;
  if (f.ownerUrl) s.ownerUrl = f.ownerUrl;
  return [ack, ...f.replies];
}

/* ── after the preview: going live, and what still needs the owner's check ── */
const openChecks = (rec: BuildRecord | undefined) => (rec?.result?.review?.checks ?? []).filter((c) => (c.level === 'block' || c.level === 'review') && !c.recovered).map((c) => c.message.replace(/\.$/, ''));

async function editorLink(s: Session, rec: BuildRecord | undefined): Promise<string | undefined> {
  if (!s.ownerUrl) s.ownerUrl = await issueOwnerLink(rec?.result?.draftId).catch(() => undefined);
  return s.ownerUrl;
}

async function goLive(s: Session): Promise<Reply[]> {
  const rec = await getBuild(s.lastBuildId!);
  const link = await editorLink(s, rec);
  const checks = openChecks(rec);
  if (!link) {
    s.followUp = { at: new Date().toISOString(), reason: 'publish' };
    return [{ text: 'Glad you like it! I\'ve asked someone from the team to get in touch and help you put it live.' }];
  }
  if (checks.length) {
    return [{ text: `Glad you like it! Before it goes live, ${checks.length === 1 ? 'one thing needs' : 'a few things need'} your OK:\n${checks.slice(0, 4).map((c) => `• ${c}`).join('\n')}\n\nYou can sort ${checks.length === 1 ? 'it' : 'them'} out in your private editor, then tap "Buy this website" to choose your web address: ${link}`, url: link, title: 'Your website editor' }];
  }
  return [{ text: `Glad you like it! To put it live, open your private editor and tap "Buy this website". You'll choose your web address there: ${link}`, url: link, title: 'Your website editor' }];
}

async function checkDetails(s: Session): Promise<Reply[]> {
  const rec = await getBuild(s.lastBuildId!);
  const checks = openChecks(rec);
  const link = await editorLink(s, rec);
  const where = link ? ` You can change any of it in your private editor: ${link}` : '';
  if (!checks.length) return [{ text: `Everything on your preview checked out, so there's nothing waiting on you.${where}`, quickReplies: DONE_CHOICES }];
  return [{ text: `Here's what I'd like you to check before it goes live:\n${checks.slice(0, 6).map((c) => `• ${c}`).join('\n')}\n${where}`.trim(), quickReplies: DONE_CHOICES }];
}

/* ── personalising a preview: same preferences and rebuild path as the Studio ── */
async function startPersonalise(s: Session): Promise<Reply[]> {
  const rec = await getBuild(s.lastBuildId!);
  if (!rec?.result) return [{ text: 'I can personalize your site once the preview is built. Text "build my site" to start.' }];
  const info = personaliseInfo(rec);
  if (!info.eligible) return [{ text: `${info.reason || 'Personalizing isn\'t available for this site yet'}. Your preview stays as it is.` }];
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
  const r = await startRefinement(buildId, { preferences: prefs, alternative }, { source: 'imessage' });
  if (!r.ok) {
    console.warn(`[imessage] could not refine ${buildId}: ${r.error}`);
    return [{ text: `Sorry, I can't change this preview right now.${s.lastSiteUrl ? ` It's still here: ${s.lastSiteUrl}` : ''}` }];
  }
  const job = r.job;
  s.lastBuildId = job.id;
  s.state = 'building';
  s.buildStartedAt = Date.now();
  s.buildEta = undefined;
  s.ownerUrl = undefined; // the new preview gets its own editor link
  const ack: Reply = { text: alternative ? 'On it! I\'m putting together a different design. I\'ll text you when it\'s ready.' : 'Thanks! I\'m updating your preview with your answers. I\'ll text you when it\'s ready.' };
  return deliver(from, ctx, job, 'update', ack);
}

function updatedCard(job: Job): Reply {
  const card = job.result!.cards.find((c) => c.kind === 'site-preview')!;
  const p = job.result!.design;
  return {
    ...fromCard(card),
    text: p ? `Here's your updated preview: ${DIRECTION_LABEL[p.direction]}, leading with ${p.service.label.toLowerCase()}, main button "${profileFor(p.category).actions[p.goal]}".` : card.text,
    quickReplies: ['Looks great, publish it', 'Try a different design', 'Personalize it'],
  };
}

/** Start the flow over for this sender. The saved messages stay; only the flow state is cleared. */
export async function resetSession(from: string) {
  const c = await getConversation(from);
  if (c) { c.session = undefined; c.updatedAt = new Date().toISOString(); await saveConversation(c); }
}
