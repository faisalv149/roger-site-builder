import fs from 'node:fs';
import { forStorageText } from './google-names.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { remote } from './remote.js';
import type { BuildResult } from './pipeline.js';
import type { DesignPreferences } from './design/schema.js';

/**
 * Saved history, so nothing is lost on a page reload or server restart:
 *  builds/<id>             every build the server runs (Studio, iMessage, API), with its full result
 *  conversations/<from>    every iMessage conversation: the messages plus the flow's session state
 *  publishes/<slug>        sites published to Vercel
 * Locally these are JSON files under data/ (DATA_DIR). On Vercel they go to Supabase or Redis (src/remote.ts),
 * because every server instance there starts with an empty disk.
 */
export type BuildSource = 'studio' | 'imessage' | 'api' | 'imported';

export interface BuildRecord {
  id: string;
  createdAt: string;
  finishedAt?: string;
  source: BuildSource;
  /** iMessage sender (phone / Apple ID, or the demo page's id) when the build came from a conversation */
  from?: string;
  status: 'done' | 'error';
  error?: string;
  result?: BuildResult;
  /** what the build was asked for, so a refinement can rebuild it the same way (absent on older records) */
  input?: BuildInputSummary;
  /** the owner's personalisation answers this build used (absent on older records and unpersonalised builds) */
  preferences?: DesignPreferences;
}

export interface BuildInputSummary {
  placeId?: string;
  google?: string;
  website?: string;
  themeId?: string;
  themeSource: 'auto' | 'manual' | 'upload';
  preview: boolean;
  fonts?: 'theme' | 'business';
  brandColor?: string;
  alternative?: boolean;
  optIn?: boolean;
}

export interface BuildSummary {
  id: string;
  createdAt: string;
  source: BuildSource;
  from?: string;
  status: BuildRecord['status'];
  error?: string;
  name?: string;
  category?: string;
  address?: string;
  slug?: string;
  siteUrl?: string;
  themeId?: string;
  auditScore?: number;
  /** the new site scored with the same checks (Studio builds) */
  newSiteScore?: number;
  totalMs?: number;
  /** a newer build of the same site replaced these files */
  replaced?: boolean;
  /** live on Vercel; stale = this build is newer than what's published */
  published?: { url: string; at: string; stale: boolean };
}

export interface ConvoMessage {
  dir: 'in' | 'out';
  at: string;
  text?: string;
  url?: string;
  image?: string;
  title?: string;
  /** a card's second line (a listing's address, rating and photo credit) */
  subtitle?: string;
  /** a card the customer can choose: the reply its button sends (the simulator; a real gateway uses the quick replies) */
  choice?: string;
  quickReplies?: string[];
}

export interface Conversation {
  from: string;
  startedAt: string;
  updatedAt: string;
  business?: string;
  messages: ConvoMessage[];
  buildIds: string[];
  /** the iMessage flow's state (src/imessage/flow.ts) so a restart picks up where it left off */
  session?: unknown;
  /** the owner asked for a person in iMessage: a call back, or help putting the site live */
  followUp?: { at: string; reason: 'call' | 'publish' };
}

/** A site published to Vercel (src/publish.ts) */
export interface PublishRecord {
  slug: string;
  project: string;
  /** the domain the site is served on now (custom primary domain, or the hosted address) */
  domain: string;
  url: string;
  deploymentId: string;
  publishedAt: string;
  /** a verified custom domain chosen as primary (absent: the hosted project address is primary) */
  primaryDomain?: string;
  /** domains that served the site before and now redirect permanently to the primary */
  previousDomains?: string[];
  /** the draft and content revisions this publication was built from (drafts only) */
  draftRevision?: number;
  contentRevision?: number;
  /** where the published revision's files are kept (out/publish/<slug>/r<revision>) */
  files?: string;
  pages?: number;
}

/** the design studio's jobs, their work in progress, source snapshots, page bodies, briefs and inventories (src/studio) */
export type StudioCollection = 'studio-frontend-jobs' | 'studio-photo-omissions' | 'studio-jobs' | 'studio-work' | 'studio-snapshots' | 'studio-bodies' | 'studio-briefs' | 'studio-inventories' | 'studio-index' | 'studio-ai'
  | 'studio-reviews' | 'studio-concept-jobs' | 'studio-concept-sets' | 'studio-ai-usage' | 'studio-shares' | 'studio-site-jobs' | 'studio-reference-jobs' | 'studio-design-specs' | 'site-pins' | 'studio-manifests'
  /** the custom-site versions staff sent to a customer (only those are served at /v/) */
  | 'customer-links'
  /** invite-only beta testers: token hashes, their conversations, and the jobs charged to them */
  | 'beta-invites'
  /** claims: one record per run of a job, created once, so two workers never run the same thing */
  | 'job-claims'
  /** short-lived locks shared by every process (a conversation changed by one process at a time) */
  | 'locks'
  /** what owners told Roger about their business (splash pages: the highest-ranked source), by business key */
  | 'splash-owner-inputs'
  /** splash page jobs, and the quote requests their pages send */
  | 'splash-jobs'
  | 'splash-leads'
  /** website and owner photos for splash pages: a master per photo and its sized copies (never Google photos) */
  | 'splash-images'
  /** the fonts splash pages use (Google Fonts, open licences), as WOFF2 files */
  | 'splash-fonts'
  /** photos visitors attach to a splash page's quote request (re-encoded, no camera metadata) */
  | 'splash-lead-photos';
type Collection = 'builds' | 'conversations' | 'publishes' | 'leads' | 'drafts' | 'orders' | StudioCollection;
/** every collection (the compiler checks none is missing): what an audit of stored documents reads */
const COLLECTION_SET = { 'splash-lead-photos': 1, 'splash-fonts': 1, 'splash-images': 1, 'splash-jobs': 1, 'splash-leads': 1, 'splash-owner-inputs': 1, 'locks': 1, 'job-claims': 1, 'beta-invites': 1, 'customer-links': 1, 'studio-frontend-jobs': 1, builds: 1, conversations: 1, publishes: 1, leads: 1, drafts: 1, orders: 1, 'studio-photo-omissions': 1, 'studio-jobs': 1, 'studio-work': 1, 'studio-snapshots': 1, 'studio-bodies': 1, 'studio-briefs': 1, 'studio-inventories': 1, 'studio-index': 1, 'studio-ai': 1, 'studio-reviews': 1, 'studio-concept-jobs': 1, 'studio-concept-sets': 1, 'studio-ai-usage': 1, 'studio-shares': 1, 'studio-site-jobs': 1, 'studio-reference-jobs': 1, 'studio-design-specs': 1, 'site-pins': 1, 'studio-manifests': 1 } satisfies Record<Collection, 1>;
export const ALL_COLLECTIONS = Object.keys(COLLECTION_SET) as Collection[];

let tmpSeq = 0;
/** errors Windows gives while another process (an antivirus or indexer scan, a sync tool) briefly holds the target open */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
/**
 * Move the temp file over the document. On Windows, the rename fails while anything else has the target open, which
 * lasts milliseconds: it is retried with short waits (about 1.5 s in all), as graceful-fs does. Any other error, or a
 * target still held after that, is thrown, and the temp file is removed.
 */
export async function replaceFile(tmp: string, file: string, waitsMs: number[] = [10, 20, 40, 80, 150, 250, 400, 600]): Promise<void> {
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || i >= waitsMs.length) { fs.rmSync(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, waitsMs[i]));
    }
  }
}

// One tiny document store, two backends: JSON files (local) or Redis keys "<collection>:<id>" (Vercel).
const docs = {
  file: (col: Collection, id: string) => path.join(config.dirs.data, col, `${id}.json`),
  async get<T>(col: Collection, id: string): Promise<T | undefined> {
    if (remote) { const v = await remote.getDoc(col, id); return v ? (JSON.parse(v) as T) : undefined; }
    try { return JSON.parse(fs.readFileSync(this.file(col, id), 'utf8')) as T; } catch { return undefined; }
  },
  async put(col: Collection, id: string, data: unknown): Promise<void> {
    // the last guard on every write (local file or remote store): no Google photo name is ever kept (src/google-names.ts)
    const json = forStorageText(JSON.stringify(data, null, 2), col);
    if (remote) { await remote.putDoc(col, id, json); return; }
    const file = this.file(col, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // temp file first: a crash never leaves half a JSON file. Each write has its own temp name, so two saves of one
    // document never share one
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
    fs.writeFileSync(tmp, json);
    await replaceFile(tmp, file);
  },
  /** create only if absent: true when this call created it (atomic on Supabase and on the local disk) */
  async create(col: Collection, id: string, data: unknown): Promise<boolean> {
    const json = forStorageText(JSON.stringify(data, null, 2), col);
    if (remote) return remote.createDoc(col, id, json);
    const file = this.file(col, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, json, { flag: 'wx' }); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  },
  async del(col: Collection, id: string): Promise<void> {
    if (remote) { await remote.delDoc(col, id); return; }
    fs.rmSync(this.file(col, id), { force: true });
  },
  async list<T>(col: Collection): Promise<T[]> {
    if (remote) return (await remote.listDocs(col)).map((v) => JSON.parse(v) as T);
    const dir = path.join(config.dirs.data, col);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T; } catch { return undefined; }
    }).filter(Boolean) as T[];
  },
};
/** read-only: every stored document of a collection, as stored (an audit; never written back) */
export async function readCollection(col: Collection): Promise<unknown[]> {
  if (remote) return (await remote.listDocs(col)).map((v) => JSON.parse(v));
  const dir = path.join(config.dirs.data, col);
  if (!fs.existsSync(dir)) return [];
  // An unreadable record makes a dry-run incomplete; never silently count it as clean.
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
const safeId = (id: string) => /^[a-z0-9-]{1,64}$/i.test(id);

/** Raw document access for the draft and demo-order modules (src/drafts.ts, src/orders.ts), which validate on read. */
export const draftDocs = {
  get: <T>(col: 'drafts' | 'orders', id: string) => (/^[a-z0-9_-]{1,80}$/i.test(id) ? docs.get<T>(col, id) : Promise.resolve(undefined)),
  put: (col: 'drafts' | 'orders', id: string, data: unknown) => docs.put(col, id, data),
  del: (col: 'drafts' | 'orders', id: string) => docs.del(col, id),
  list: <T>(col: 'drafts' | 'orders') => docs.list<T>(col),
};

/**
 * Run fn while holding a lock every process sees (the web functions and the worker on Vercel; one process locally): an
 * atomic create in the datastore. A lock older than its ttl (a process that died holding it) is taken over.
 */
export async function withSharedLock<T>(name: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const id = name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 150), ttl = opts.ttlMs ?? 120_000, until = Date.now() + (opts.waitMs ?? 60_000);
  for (;;) {
    if (await docs.create('locks', id, { at: Date.now(), until: Date.now() + ttl })) break;
    const held = await docs.get<{ until: number }>('locks', id);
    if (held && held.until < Date.now()) { await docs.del('locks', id); continue; } // its holder died: taken over
    if (Date.now() > until) throw new Error(`busy: ${name} is locked by another process`);
    await new Promise((r) => setTimeout(r, 250));
  }
  try { return await fn(); } finally { await docs.del('locks', id).catch(() => undefined); }
}

/** Raw document access for the design studio (src/studio); ids are file-name safe. */
const studioId = (id: string) => /^[A-Za-z0-9_.-]{1,160}$/.test(id);
export const studioDocs = {
  get: <T>(col: StudioCollection, id: string) => (studioId(id) ? docs.get<T>(col, id) : Promise.resolve(undefined)),
  put: (col: StudioCollection, id: string, data: unknown) => { if (!studioId(id)) throw new Error(`Bad studio document id: ${id}`); return docs.put(col, id, data); },
  /** create only if absent (a claim): true when this call created it */
  create: (col: StudioCollection, id: string, data: unknown) => { if (!studioId(id)) throw new Error(`Bad studio document id: ${id}`); return docs.create(col, id, data); },
  del: (col: StudioCollection, id: string) => docs.del(col, id),
  list: <T>(col: StudioCollection) => docs.list<T>(col),
};

export async function saveBuild(rec: BuildRecord) {
  await docs.put('builds', rec.id, rec);
  timings = null; // estimates pick up the new build
}

export async function getBuild(id: string): Promise<BuildRecord | undefined> {
  return safeId(id) ? docs.get<BuildRecord>('builds', id) : undefined;
}

/** The newest finished build of a site (full record), e.g. for its scores. */
export async function latestBuildFor(slug: string): Promise<BuildRecord | undefined> {
  return (await docs.list<BuildRecord>('builds')).filter((r) => r.status === 'done' && r.result?.slug === slug).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** The newest saved design plan for a business (Google place ID), so rebuilds stay consistent. Unvalidated. */
export async function findSavedPlan(businessKey: string): Promise<unknown | undefined> {
  if (!businessKey) return undefined;
  const recs = (await docs.list<BuildRecord>('builds'))
    .filter((r) => r.status === 'done' && r.result?.design && r.result.business?.placeId === businessKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return recs[0]?.result?.design;
}

/** How long finished builds took and what they ran with (src/estimate.ts). Imported builds have no timing. */
export interface BuildTiming { createdAt: string; totalMs: number; mode: BuildResult['mode']; website: boolean; audit: boolean }
let timings: { at: number; list: BuildTiming[] } | null = null;
function timingOf(r: BuildRecord): BuildTiming | undefined {
  const x = r.result;
  if (r.status !== 'done' || !x || !(x.totalMs > 0)) return undefined;
  // older records lack mode.website/audit: fall back to what the result shows
  return { createdAt: r.createdAt, totalMs: x.totalMs, mode: x.mode, website: x.mode.website ?? !!x.business.website, audit: x.mode.audit ?? (!!x.audit && r.source !== 'imessage') };
}
export async function buildTimings(): Promise<BuildTiming[]> {
  // cached for a minute: other server instances add builds too
  if (!timings || Date.now() - timings.at > 60_000) timings = { at: Date.now(), list: (await docs.list<BuildRecord>('builds')).map(timingOf).filter(Boolean) as BuildTiming[] };
  return timings.list;
}

export async function listBuilds(): Promise<BuildSummary[]> {
  const recs = await docs.list<BuildRecord>('builds');
  recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pubs = new Map((await docs.list<PublishRecord>('publishes')).map((p) => [p.slug, p]));
  const seen = new Set<string>();
  return recs.map((r) => {
    const x = r.result;
    const replaced = !!x?.slug && seen.has(x.slug);
    if (x?.slug) seen.add(x.slug);
    const pub = x?.slug ? pubs.get(x.slug) : undefined;
    return {
      id: r.id, createdAt: r.createdAt, source: r.source, from: r.from, status: r.status, error: r.error,
      name: x?.business.name, category: x?.business.primaryTypeLabel, address: x?.business.formattedAddress,
      slug: x?.slug, siteUrl: x?.siteUrl, themeId: x?.themeId, auditScore: x?.audit?.score, newSiteScore: x?.newSite?.score, totalMs: x?.totalMs, replaced,
      published: pub && !replaced ? { url: pub.url, at: pub.publishedAt, stale: r.createdAt > pub.publishedAt } : undefined,
    };
  });
}

// `from` is whatever the gateway sends (a phone number, an email): keep ids safe and unique
const convoId = (from: string) => `${from.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${createHash('sha1').update(from).digest('hex').slice(0, 8)}`;

export async function getConversation(from: string): Promise<Conversation | undefined> {
  return docs.get<Conversation>('conversations', convoId(from));
}

export async function saveConversation(c: Conversation) {
  await docs.put('conversations', convoId(c.from), c);
}

/** every conversation in full, with its saved flow state (server-side only: the staff review screen) */
export async function listConversationRecords(): Promise<Conversation[]> {
  return docs.list<Conversation>('conversations');
}
export async function listConversations() {
  const all = await docs.list<Conversation>('conversations');
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all.map((c) => {
    const last = c.messages[c.messages.length - 1];
    return { from: c.from, startedAt: c.startedAt, updatedAt: c.updatedAt, business: c.business, messages: c.messages.length, last: last?.text || last?.title || '', buildIds: c.buildIds, followUp: c.followUp };
  });
}

export async function savePublish(p: PublishRecord) {
  await docs.put('publishes', p.slug, p);
}

export async function deletePublish(slug: string) {
  if (/^[a-z0-9-]{1,100}$/.test(slug)) await docs.del('publishes', slug);
}

export async function getPublish(slug: string): Promise<PublishRecord | undefined> {
  return /^[a-z0-9-]{1,100}$/.test(slug) ? docs.get<PublishRecord>('publishes', slug) : undefined;
}

/** A quote-form submission from a generated site */
export interface Lead {
  slug: string; at: string; name: string; phone: string; email?: string; zip?: string; service?: string; message?: string; page?: unknown;
  /** quote-request / appointment-request / message (personalised sites); absent on older forms and the widget */
  kind?: 'quote-request' | 'appointment-request' | 'message' | 'order-enquiry' | 'enquiry';
  /** appointment requests: what the visitor would like; the business confirms (status stays "requested" until then) */
  preferredDate?: string;
  preferredTime?: string;
  status?: 'requested';
  /** what happened when Roger tried to pass this enquiry to the business, separately from saving it (src/lead-delivery.ts) */
  delivery?: { attempts: { channel: string; status: string; at: string; detail?: string }[]; confirmed: boolean };
  /** a test enquiry sent from the Studio before publishing */
  test?: boolean;
}

/** Saves the enquiry and returns its id, so the delivery result can be recorded on it afterwards. */
export async function saveLead(lead: Lead): Promise<string> {
  const id = `${lead.slug}--${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await docs.put('leads', id, lead);
  return id;
}
export async function recordLeadDelivery(id: string, lead: Lead, delivery: NonNullable<Lead['delivery']>) {
  await docs.put('leads', id, { ...lead, delivery });
}

export async function listLeads(slug: string): Promise<Lead[]> {
  return (await docs.list<Lead>('leads')).filter((l) => l.slug === slug).sort((a, b) => b.at.localeCompare(a.at));
}

/** Delete every saved build of a site (its history in the Studio). Returns how many. */
export async function deleteBuildsForSlug(slug: string): Promise<number> {
  const recs = (await docs.list<BuildRecord>('builds')).filter((r) => r.result?.slug === slug);
  for (const r of recs) await docs.del('builds', r.id);
  timings = null;
  return recs.length;
}

/** Remove a failed build from the history (a finished one goes with its site: deleteBuildsForSlug). */
export async function deleteFailedBuild(id: string): Promise<'deleted' | 'missing' | 'finished'> {
  const rec = await docs.get<BuildRecord>('builds', id);
  if (!rec) return 'missing';
  if (rec.status === 'done') return 'finished';
  await docs.del('builds', id);
  return 'deleted';
}
