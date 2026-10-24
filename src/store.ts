import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import type { BuildResult } from './pipeline.js';

/**
 * Saved history, so nothing is lost on a page reload or server restart:
 *  data/builds/<id>.json          every build the server runs (Studio, iMessage, API), with its full result
 *  data/conversations/<from>.json every iMessage conversation: the messages plus the flow's session state
 * Plain JSON files; swap for a database when running more than one server.
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

const buildsDir = () => path.join(config.dirs.data, 'builds');
const convosDir = () => path.join(config.dirs.data, 'conversations');
for (const d of [buildsDir(), convosDir()]) fs.mkdirSync(d, { recursive: true });

const readJson = <T>(file: string): T | undefined => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; }
};
// write to a temp file first so a crash mid-write never leaves half a JSON file
const writeJson = (file: string, data: unknown) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
};
const safeId = (id: string) => /^[a-z0-9-]{1,64}$/i.test(id);

export function saveBuild(rec: BuildRecord) {
  writeJson(path.join(buildsDir(), `${rec.id}.json`), rec);
  const t = timingOf(rec);
  if (t && timings) timings.push(t);
}

const readAllBuilds = () => fs.readdirSync(buildsDir()).filter((f) => f.endsWith('.json')).map((f) => readJson<BuildRecord>(path.join(buildsDir(), f))).filter(Boolean) as BuildRecord[];

/** How long finished builds took and what they ran with (src/estimate.ts). Imported builds have no timing. */
export interface BuildTiming { createdAt: string; totalMs: number; mode: BuildResult['mode']; website: boolean; audit: boolean }
let timings: BuildTiming[] | null = null;
function timingOf(r: BuildRecord): BuildTiming | undefined {
  const x = r.result;
  if (r.status !== 'done' || !x || !(x.totalMs > 0)) return undefined;
  // older records lack mode.website/audit: fall back to what the result shows
  return { createdAt: r.createdAt, totalMs: x.totalMs, mode: x.mode, website: x.mode.website ?? !!x.business.website, audit: x.mode.audit ?? (!!x.audit && r.source !== 'imessage') };
}
export function buildTimings(): BuildTiming[] {
  if (!timings) timings = readAllBuilds().map(timingOf).filter(Boolean) as BuildTiming[];
  return timings;
}

export function getBuild(id: string): BuildRecord | undefined {
  return safeId(id) ? readJson<BuildRecord>(path.join(buildsDir(), `${id}.json`)) : undefined;
}

export function listBuilds(): BuildSummary[] {
  const recs = readAllBuilds();
  recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seen = new Set<string>();
  return recs.map((r) => {
    const x = r.result;
    const replaced = !!x?.slug && seen.has(x.slug);
    if (x?.slug) seen.add(x.slug);
    const pub = x?.slug ? getPublish(x.slug) : undefined;
    return {
      id: r.id, createdAt: r.createdAt, source: r.source, from: r.from, status: r.status, error: r.error,
      name: x?.business.name, category: x?.business.primaryTypeLabel, address: x?.business.formattedAddress,
      slug: x?.slug, siteUrl: x?.siteUrl, themeId: x?.themeId, auditScore: x?.audit?.score, totalMs: x?.totalMs, replaced,
      published: pub && !replaced ? { url: pub.url, at: pub.publishedAt, stale: r.createdAt > pub.publishedAt } : undefined,
    };
  });
}

// `from` is whatever the gateway sends (a phone number, an email): keep file names safe and unique
const convoFile = (from: string) => path.join(convosDir(), `${from.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${createHash('sha1').update(from).digest('hex').slice(0, 8)}.json`);

export function getConversation(from: string): Conversation | undefined {
  return readJson<Conversation>(convoFile(from));
}

export function saveConversation(c: Conversation) {
  writeJson(convoFile(c.from), c);
}

export function listConversations() {
  const all = fs.readdirSync(convosDir()).filter((f) => f.endsWith('.json')).map((f) => readJson<Conversation>(path.join(convosDir(), f))).filter(Boolean) as Conversation[];
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all.map((c) => {
    const last = c.messages[c.messages.length - 1];
    return { from: c.from, startedAt: c.startedAt, updatedAt: c.updatedAt, business: c.business, messages: c.messages.length, last: last?.text || last?.title || '', buildIds: c.buildIds };
  });
}

/** A site published to Vercel (src/publish.ts): data/publishes/<slug>.json */
export interface PublishRecord {
  slug: string;
  project: string;
  domain: string;
  url: string;
  deploymentId: string;
  publishedAt: string;
}
const publishesDir = () => path.join(config.dirs.data, 'publishes');
fs.mkdirSync(publishesDir(), { recursive: true });

export function savePublish(p: PublishRecord) {
  writeJson(path.join(publishesDir(), `${p.slug}.json`), p);
}

export function getPublish(slug: string): PublishRecord | undefined {
  return /^[a-z0-9-]{1,100}$/.test(slug) ? readJson<PublishRecord>(path.join(publishesDir(), `${slug}.json`)) : undefined;
}
