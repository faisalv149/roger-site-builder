import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { remote } from './remote.js';
import type { BuildResult } from './pipeline.js';

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
}

/** A site published to Vercel (src/publish.ts) */
export interface PublishRecord {
  slug: string;
  project: string;
  domain: string;
  url: string;
  deploymentId: string;
  publishedAt: string;
}

type Collection = 'builds' | 'conversations' | 'publishes' | 'leads';

// One tiny document store, two backends: JSON files (local) or Redis keys "<collection>:<id>" (Vercel).
const docs = {
  file: (col: Collection, id: string) => path.join(config.dirs.data, col, `${id}.json`),
  async get<T>(col: Collection, id: string): Promise<T | undefined> {
    if (remote) { const v = await remote.getDoc(col, id); return v ? (JSON.parse(v) as T) : undefined; }
    try { return JSON.parse(fs.readFileSync(this.file(col, id), 'utf8')) as T; } catch { return undefined; }
  },
  async put(col: Collection, id: string, data: unknown): Promise<void> {
    if (remote) { await remote.putDoc(col, id, JSON.stringify(data)); return; }
    const file = this.file(col, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2)); // temp file first: a crash never leaves half a JSON file
    fs.renameSync(`${file}.tmp`, file);
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
const safeId = (id: string) => /^[a-z0-9-]{1,64}$/i.test(id);

export async function saveBuild(rec: BuildRecord) {
  await docs.put('builds', rec.id, rec);
  timings = null; // estimates pick up the new build
}

export async function getBuild(id: string): Promise<BuildRecord | undefined> {
  return safeId(id) ? docs.get<BuildRecord>('builds', id) : undefined;
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
      slug: x?.slug, siteUrl: x?.siteUrl, themeId: x?.themeId, auditScore: x?.audit?.score, totalMs: x?.totalMs, replaced,
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

export async function listConversations() {
  const all = await docs.list<Conversation>('conversations');
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all.map((c) => {
    const last = c.messages[c.messages.length - 1];
    return { from: c.from, startedAt: c.startedAt, updatedAt: c.updatedAt, business: c.business, messages: c.messages.length, last: last?.text || last?.title || '', buildIds: c.buildIds };
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
export interface Lead { slug: string; at: string; name: string; phone: string; email?: string; zip?: string; service?: string; message?: string; page?: unknown }

export async function saveLead(lead: Lead) {
  await docs.put('leads', `${lead.slug}--${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, lead);
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
