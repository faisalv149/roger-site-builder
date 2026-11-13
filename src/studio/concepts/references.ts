import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { studioDocs } from '../../store.js';
import { config } from '../../config.js';
import { getBrief } from '../jobs.js';
import { HEARTBEAT_MS, keepAlive, STALE_MS } from '../keepalive.js';
import { persistDir } from '../../files.js';
import { launchBrowser } from '../../render/og.js';
import { aiJson, CostLedger, defaultTransport, type AiTransport } from './ai.js';
import type { BusinessBrief } from '../schema.js';
import type { UsageRecord } from './types.js';

/**
 * Reference research: for a verified brief, find a few well-regarded websites in the business's category (plus one a
 * staff member may supply), measure their desktop and mobile design, and save a short design strategy the planner can
 * draw on: layout patterns, typography, imagery treatment, navigation and interactions.
 *
 *   resolve → find → verify → inspect → strategy      (saved after every stage; resumable, like concept jobs)
 *
 * Candidates come only from a real search source (Google Places text search: established, highly rated businesses of
 * the same category in other cities, with the website their Google profile lists) and from staff. Claude never names a
 * URL. Every URL is fetched and checked (each redirect hop, HTML, not parked, not a directory or ordering platform)
 * before a browser opens it. Search spending counts against the job's one cap, with Claude's.
 *
 * Actions (ordering, booking, delivery, calling, directions, a sticky action bar) appear in the strategy only when the
 * verified brief supports them; an answer that suggests an unsupported one is rejected and retried.
 *
 * References are inspiration only. By construction nothing of theirs can reach a site: the inspector keeps measurements
 * (sizes, counts, positions, font names), never their words or pictures, and the strategy is written from those
 * measurements alone. Screenshots stay in out/studio-references/<job>/ for staff to look at and are never served to
 * clients. The business's own logo and colours are kept unless staff ask for a brand refresh (keepBrand: false).
 */

export const REFERENCE_STAGES = ['resolve', 'find', 'verify', 'inspect', 'strategy'] as const;
type Stage = (typeof REFERENCE_STAGES)[number];
const MAX_REFERENCES = 3;
const capUsd = () => Number(process.env.STUDIO_REFERENCE_CAP_USD ?? 1);

export interface ViewMetrics {
  textLength: number; viewportMeta: boolean; overflowX: boolean; pageScreens: number;
  header: { sticky: boolean; navLinks: number; menuButton: boolean };
  hero: { heightRatio: number; media: 'image' | 'video' | 'none'; textOverMedia: boolean; ctas: number };
  type: { headingFamily: string; headingPx: number; headingWeight: number; headingCase: string; bodyFamily: string; bodyPx: number; lineHeight: number; families: number };
  /** top-level content blocks; null ("unknown") when the page wraps everything in one block, so the count says nothing */
  sections: number | null;
  images: { count: number; coverShare: number; roundedShare: number; wideShare: number };
  buttons: { radiusPx: number };
  interactions: { carousel: boolean; accordion: boolean; stickyBottomBar: boolean; video: boolean; forms: number };
}
export type ReferenceSource = 'staff' | 'search';
export interface Candidate { url: string; why: string; source: ReferenceSource; evidence?: { query: string; name: string; rating?: number; reviews?: number; placeId?: string } }
export interface Rejected { url: string; source: ReferenceSource; stage: 'find' | 'verify' | 'inspect'; reason: string }
/** what the verified brief lets a strategy suggest; anything false must not appear */
export interface SupportedActions { order: boolean; booking: boolean; delivery: boolean; call: boolean; directions: boolean; evidence: string[] }
export interface InspectedReference { url: string; host: string; why: string; source: ReferenceSource; ok: boolean; reason?: string; desktop?: ViewMetrics; mobile?: ViewMetrics; screenshots?: { desktop: string; mobile: string } }
export interface DesignStrategy {
  summary: string;
  layoutPatterns: { pattern: string; why: string; from: string[] }[];
  typography: { headings: string; body: string; notes: string };
  imagery: string[];
  navigation: { desktop: string; mobile: string };
  interactions: string[];
  avoid: string[];
  /** the business's identity, kept as it is by default; never taken from a reference */
  brand: { keep: boolean; logo: string | null; colors: { role: string; hex: string }[]; fonts: string[] };
  references: { host: string; why: string; source: ReferenceSource }[];
  /** the actions the strategy was allowed to suggest, and why */
  actions: SupportedActions;
  source: 'ai' | 'fallback';
}
export interface ReferenceJob {
  id: string; createdAt: string; updatedAt: string; status: 'queued' | 'running' | 'done' | 'failed';
  input: { businessKey: string; revision: number; referenceUrl?: string; keepBrand: boolean };
  stages: { name: Stage; status: 'pending' | 'running' | 'done' | 'failed'; attempts: number; notes: string[]; error?: string; startedAt?: string; finishedAt?: string }[];
  work: {
    search?: { queries: { query: string; results: number; ms: number }[]; costUsd: number };
    candidates?: Candidate[]; verified?: Candidate[]; rejected?: Rejected[];
    inspected?: InspectedReference[]; strategy?: DesignStrategy; calls: UsageRecord[];
  };
  error?: string;
  resumes: number;
}
export interface ReferenceHooks {
  transport?: AiTransport | null;
  /** measure one page at both sizes (tests replace the browser) */
  inspect?: (url: string, dir: string, allow: (u: string) => boolean) => Promise<{ desktop: ViewMetrics; mobile: ViewMetrics; screenshots: { desktop: string; mobile: string } }>;
  /** which addresses may be opened (tests allow a local server) */
  allowUrl?: (url: string) => boolean;
  /** the search source (default: Google Places text search) */
  search?: (q: SearchQuery) => Promise<SearchOutcome>;
  /** one HTTP request without following redirects (tests replace the network) */
  fetchPage?: (url: string) => Promise<{ status: number; location?: string; contentType: string; body: string }>;
}
export interface SearchQuery { category: string; city?: string; excludeHosts: string[]; excludePlaceIds: string[] }
export interface SearchOutcome { candidates: Candidate[]; rejected: Rejected[]; queries: { query: string; results: number; ms: number }[]; costUsd: number }
export class ReferenceInputError extends Error {}

// ───────────────────────── addresses ─────────────────────────
// stricter than the audit's check: link-local (cloud metadata), IPv6 private ranges and bare IPs are refused too
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[|.*\.local$|.*\.localhost$|.*\.internal$|.*\.test$|.*\.lan$|.*\.home\.arpa$)/i;
export function isPublicReference(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password) return false;
    if (/^\d+(\.\d+){3}$/.test(u.hostname)) return false; // a bare IP is never a design reference
    return !PRIVATE_HOST.test(u.hostname) && u.hostname.includes('.');
  } catch { return false; }
}
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ───────────────────────── job lifecycle (the concept jobs' pattern) ─────────────────────────
const now = () => new Date().toISOString();
const save = (j: ReferenceJob) => studioDocs.put('studio-reference-jobs', j.id, { ...j, updatedAt: now() });
export const getReferenceJob = (id: string) => studioDocs.get<ReferenceJob>('studio-reference-jobs', id);
const active = new Map<string, Promise<ReferenceJob>>();
export const referenceDir = (id: string) => path.join(config.dirs.out, 'studio-references', id);

export async function startReferenceJob(input: { businessKey: string; revision?: number; referenceUrl?: string; keepBrand?: boolean }, hooks: ReferenceHooks = {}): Promise<ReferenceJob> {
  const { brief } = await getBrief(input.businessKey, input.revision);
  if (!brief) throw new ReferenceInputError(`No brief for ${input.businessKey}.`);
  if (brief.identity.status !== 'verified') throw new ReferenceInputError(`The brief's identity is ${brief.identity.status}, not verified: settle who the business is first.`);
  const ref = input.referenceUrl?.trim();
  if (ref && !(hooks.allowUrl ?? isPublicReference)(ref)) throw new ReferenceInputError('The reference must be a public http(s) website address.');
  const t = now();
  const job: ReferenceJob = {
    id: `rj_${randomUUID().replace(/-/g, '').slice(0, 12)}`, createdAt: t, updatedAt: t, status: 'queued',
    input: { businessKey: brief.businessKey, revision: brief.revision, ...(ref ? { referenceUrl: ref } : {}), keepBrand: input.keepBrand !== false },
    stages: REFERENCE_STAGES.map((name) => ({ name, status: 'pending', attempts: 0, notes: [] })), work: { calls: [] }, resumes: 0,
  };
  await save(job);
  void keepAlive(runReferenceJob(job.id, hooks));
  return job;
}
export function runReferenceJob(id: string, hooks: ReferenceHooks = {}): Promise<ReferenceJob> {
  const running = active.get(id);
  if (running) return running;
  const p = run(id, hooks).finally(() => active.delete(id));
  active.set(id, p);
  return p;
}
export async function resumeReferenceIfStale(job: ReferenceJob): Promise<ReferenceJob> {
  if ((job.status !== 'running' && job.status !== 'queued') || active.has(job.id) || Date.now() - Date.parse(job.updatedAt) <= STALE_MS()) return job;
  job.resumes++;
  for (const s of job.stages) if (s.status !== 'done') { s.status = 'pending'; s.error = undefined; }
  job.status = 'queued';
  await save(job);
  void keepAlive(runReferenceJob(job.id));
  return job;
}
export async function waitForReferenceJob(id: string, timeoutMs = 300_000): Promise<ReferenceJob> {
  const started = Date.now();
  for (;;) {
    const p = active.get(id);
    if (p) await p.catch(() => undefined);
    const j = await getReferenceJob(id);
    if (j && !active.has(id) && (j.status === 'done' || j.status === 'failed')) return j;
    if (Date.now() - started > timeoutMs) throw new Error(`reference job ${id} did not finish in time`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function run(id: string, hooks: ReferenceHooks): Promise<ReferenceJob> {
  const job = (await getReferenceJob(id))!;
  job.status = 'running';
  await save(job);
  const { brief } = await getBrief(job.input.businessKey, job.input.revision);
  const transport = hooks.transport !== undefined ? hooks.transport : defaultTransport();
  const allow = hooks.allowUrl ?? isPublicReference;
  // one cap for the job: what the search spent is taken off what Claude may spend
  const ledgerFor = () => { const l = new CostLedger(Math.max(0, capUsd() - (job.work.search?.costUsd ?? 0)), job.id); l.calls = [...job.work.calls]; return l; };
  let ledger = ledgerFor();
  for (const st of job.stages) {
    if (st.status === 'done') continue;
    st.status = 'running'; st.attempts++; st.startedAt = now(); st.error = undefined;
    await save(job);
    const beat = setInterval(() => { void save(job); }, HEARTBEAT_MS);
    const note = (s: string) => { if (!st.notes.includes(s)) st.notes.push(s); };
    try {
      if (!brief) throw new Error('the brief is missing');
      if (st.name === 'resolve') note(`${brief.identity.name.value} · ${brief.identity.category.value ?? 'no category'} · ${audienceOf(brief)}`);
      if (st.name === 'find') {
        const staff: Candidate[] = job.input.referenceUrl ? [{ url: job.input.referenceUrl, why: 'supplied by staff', source: 'staff' }] : [];
        const category = brief.identity.category.value;
        const search = hooks.search ?? (config.googleKey && !config.mock ? placesReferenceSearch : null);
        let found: SearchOutcome = { candidates: [], rejected: [], queries: [], costUsd: 0 };
        if (!category) note('the brief has no category, so nothing was searched');
        else if (!search) note('no search source here (no Google key): only a staff-supplied reference is used');
        else found = await search({ category, city: brief.contact.address.value?.city, excludeHosts: [hostOf(brief.identity.website.value ?? '')].filter(Boolean), excludePlaceIds: [brief.identity.listing?.placeId ?? ''].filter(Boolean) });
        job.work.search = { queries: found.queries, costUsd: found.costUsd };
        const seen = new Set<string>();
        job.work.candidates = [...staff, ...found.candidates].filter((c) => { const h = hostOf(c.url); if (!h || seen.has(h)) return false; seen.add(h); return true; });
        job.work.rejected = [...found.rejected];
        ledger = ledgerFor();
        note(`${found.queries.length} search(es), $${found.costUsd.toFixed(3)}: ${job.work.candidates.length} candidate(s): ${job.work.candidates.map((c) => hostOf(c.url)).join(', ') || 'none'}; ${found.rejected.length} search result(s) left out`);
      }
      if (st.name === 'verify') {
        // every address is fetched and checked before a browser opens it; staff first, then search order
        const fetchPage = hooks.fetchPage ?? fetchOnce;
        job.work.verified = [];
        for (const c of job.work.candidates ?? []) {
          if (job.work.verified.length >= MAX_REFERENCES + 3) break; // enough spares for pages the browser cannot use
          const v = await verifyUrl(c.url, allow, fetchPage);
          if (v.ok) job.work.verified.push({ ...c, url: v.url });
          else job.work.rejected = [...(job.work.rejected ?? []), { url: c.url, source: c.source, stage: 'verify', reason: v.reason }];
        }
        note(`${job.work.verified.length} verified: ${job.work.verified.map((c) => hostOf(c.url)).join(', ') || 'none'}`);
        for (const r of (job.work.rejected ?? []).filter((x) => x.stage === 'verify')) note(`${hostOf(r.url)}: ${r.reason}`);
      }
      if (st.name === 'inspect') {
        const dir = referenceDir(job.id);
        fs.mkdirSync(dir, { recursive: true });
        const inspect = hooks.inspect ?? inspectPage;
        const out: InspectedReference[] = [];
        // in order (staff first), until three good references; a page that fails is recorded with why and skipped
        for (const c of job.work.verified ?? []) {
          if (out.filter((x) => x.ok).length >= MAX_REFERENCES) break;
          const base = { url: c.url, host: hostOf(c.url), why: c.why, source: c.source };
          try {
            const m = await inspect(c.url, dir, allow);
            const reason = qualityProblem(m.desktop, m.mobile);
            out.push(reason ? { ...base, ok: false, reason } : { ...base, ok: true, ...m });
          } catch (e) { out.push({ ...base, ok: false, reason: `could not be opened: ${(e as Error).message.split('\n')[0].slice(0, 160)}` }); }
        }
        job.work.inspected = out;
        job.work.rejected = [...(job.work.rejected ?? []), ...out.filter((x) => !x.ok).map((x) => ({ url: x.url, source: x.source, stage: 'inspect' as const, reason: x.reason! }))];
        await persistDir(dir).catch(() => undefined);
        for (const x of out) note(`${x.host}: ${x.ok ? `inspected (sections: ${x.desktop!.sections ?? 'unknown'} desktop, ${x.mobile!.sections ?? 'unknown'} mobile)` : x.reason}`);
      }
      if (st.name === 'strategy') {
        const good = (job.work.inspected ?? []).filter((x) => x.ok);
        const actions = supportedActions(brief);
        let strategy: StrategyBody | null = null;
        if (transport && good.length) {
          const r = await aiJson<StrategyBody>(strategyRequest(brief, good, job.input.keepBrand, actions), { transport, ledger, validate: (d) => validateStrategy(d, good.map((g) => g.host), actions) });
          strategy = r.data;
          if (!r.data) note(`the AI strategy was rejected (${r.errors.slice(0, 2).join('; ')}); measured fallback used`);
          else if (r.attempts > 1) note(`the first answer was rejected (${r.rejected[0]?.errors.slice(0, 2).join('; ')}); attempt ${r.attempts} accepted`);
        }
        job.work.strategy = { ...(strategy ?? fallbackStrategy(brief, good, actions)), brand: brandOf(brief, job.input.keepBrand), references: good.map((g) => ({ host: g.host, why: g.why, source: g.source })), actions, source: strategy ? 'ai' : 'fallback' };
        note(`strategy from ${good.length} reference(s) (${job.work.strategy.source}); brand ${job.input.keepBrand ? 'kept' : 'open to refresh'}; actions allowed: ${allowedNames(actions).join(', ') || 'none'}`);
      }
      st.status = 'done';
    } catch (e) {
      st.status = 'failed'; st.error = (e as Error).message.slice(0, 400);
      job.status = 'failed'; job.error = `${st.name}: ${st.error}`;
    } finally {
      clearInterval(beat);
      st.finishedAt = now();
      job.work.calls = ledger.calls;
      await save(job);
    }
    if (job.status === 'failed') return job;
  }
  job.status = 'done';
  await save(job);
  return job;
}

// ───────────────────────── the business, briefly ─────────────────────────
function audienceOf(b: BusinessBrief): string {
  const where = b.serviceArea.value?.region ?? b.contact.address.value?.city ?? 'its area';
  const reviews = b.reviews.value ? `, ${b.reviews.value.count} Google reviews` : '';
  return `local customers in ${where} looking for ${String(b.identity.category.value ?? 'its services').toLowerCase()}${reviews}`;
}
function brandOf(b: BusinessBrief, keep: boolean): DesignStrategy['brand'] {
  return { keep, logo: b.brand.logo.value?.url ?? null, colors: b.brand.colors.map((c) => ({ role: c.role, hex: c.hex })), fonts: b.brand.fonts.map((f) => f.family) };
}

// ───────────────────────── search: a real source, never Claude's memory ─────────────────────────
/** hosts that are not a business's own design: social, directories, maps, ordering and booking platforms, link pages */
const NOT_A_SITE = /(^|\.)(facebook|instagram|tiktok|twitter|x|youtube|pinterest|linkedin|yelp|tripadvisor|google|goo|g|maps\.app|linktr|linktree|beacons|toasttab|square|squareup|clover|chownow|doordash|ubereats|grubhub|postmates|seamless|order\.online|menufy|slicelife|ezcater|opentable|resy|exploretock|tock|sevenrooms|booksy|vagaro|fresha|styleseat|mindbodyonline|business\.site|wixsite|carrd|godaddysites|weebly|blogspot)\.(com|co|ee|me|app|site|io|online|net|gl)$/i;
export const isPlatformHost = (host: string) => NOT_A_SITE.test(host) || /^(order|menu|shop)\./i.test(host);
const SEARCH_CITIES = () => (process.env.STUDIO_REFERENCE_CITIES ?? 'New York, NY|San Francisco, CA|Chicago, IL').split('|').map((s) => s.trim()).filter(Boolean);
/** Google's Text Search (Enterprise fields: website, rating) per request; counted against the job's cap */
const SEARCH_COST_USD = () => Number(process.env.STUDIO_REFERENCE_SEARCH_COST_USD ?? 0.035);

/** Places results → candidates: with their own website, not this business, not a platform. No rating cutoff: a rating
 * says nothing about a website. Review count only orders them (better-known businesses first); the verify and inspect
 * stages judge the site itself. */
export function placesToCandidates(query: string, places: { id?: string; displayName?: { text?: string }; websiteUri?: string; rating?: number; userRatingCount?: number }[], q: Pick<SearchQuery, 'excludeHosts' | 'excludePlaceIds'>): { candidates: Candidate[]; rejected: Rejected[] } {
  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  for (const p of [...places].sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))) {
    const name = p.displayName?.text ?? 'unnamed';
    const url = p.websiteUri ?? '';
    const reject = (reason: string) => rejected.push({ url: url || `(no website) ${name}`, source: 'search', stage: 'find', reason });
    if (!url) continue; // nothing to inspect; not worth listing
    const host = hostOf(url);
    if (p.id && q.excludePlaceIds.includes(p.id)) { reject('this business itself'); continue; }
    if (q.excludeHosts.includes(host)) { reject('this business\'s own site'); continue; }
    if (isPlatformHost(host)) { reject(`a platform page (${host}), not the business's own site`); continue; }
    candidates.push({ url, why: `Google Places "${query}": ${name}${p.userRatingCount ? `, ${p.userRatingCount.toLocaleString("en-US")} reviews` : ""}`, source: 'search', evidence: { query, name, rating: p.rating, reviews: p.userRatingCount, placeId: p.id } });
  }
  return { candidates, rejected };
}

/** The default search: the category in a few large cities other than the business's own, best-reviewed first. */
export async function placesReferenceSearch(q: SearchQuery): Promise<SearchOutcome> {
  const cities = SEARCH_CITIES().filter((c) => !q.city || !c.toLowerCase().startsWith(q.city.toLowerCase())).slice(0, 3);
  const perCity: Candidate[][] = [];
  const out: SearchOutcome = { candidates: [], rejected: [], queries: [], costUsd: 0 };
  for (const city of cities) {
    if (out.costUsd + SEARCH_COST_USD() > capUsd()) break;
    const query = `${q.category} in ${city}`;
    const t = Date.now();
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount' },
      body: JSON.stringify({ textQuery: query, pageSize: 10 }),
    });
    out.costUsd = +(out.costUsd + SEARCH_COST_USD()).toFixed(4);
    if (!res.ok) { out.queries.push({ query, results: 0, ms: Date.now() - t }); continue; }
    const places = ((await res.json()) as { places?: Parameters<typeof placesToCandidates>[1] }).places ?? [];
    out.queries.push({ query, results: places.length, ms: Date.now() - t });
    const r = placesToCandidates(query, places, q);
    perCity.push(r.candidates);
    out.rejected.push(...r.rejected);
  }
  // one from each city in turn, so the references are not all from one place
  for (let i = 0; perCity.some((c) => c[i]); i++) for (const c of perCity) if (c[i]) out.candidates.push(c[i]);
  out.candidates = out.candidates.slice(0, 9);
  return out;
}

// ───────────────────────── verify: fetch each address before a browser opens it ─────────────────────────
async function fetchOnce(url: string) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; RogerDesignResearch/1.0)', accept: 'text/html' } });
  const body = (res.status >= 200 && res.status < 300 ? await res.text() : '').slice(0, 300_000);
  return { status: res.status, location: res.headers.get('location') ?? undefined, contentType: res.headers.get('content-type') ?? '', body };
}
const PARKED = /domain (is |may be )?for sale|buy this domain|this domain is parked|parked free|domain parking|website coming soon|under construction|account (has been )?suspended/i;
export async function verifyUrl(url: string, allow: (u: string) => boolean, fetchPage: NonNullable<ReferenceHooks['fetchPage']>): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  let at = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (!allow(at)) return { ok: false, reason: hop ? `redirects to an address that is not allowed (${at.slice(0, 80)})` : 'not a public http(s) address' };
    if (isPlatformHost(hostOf(at))) return { ok: false, reason: `${hop ? 'redirects to' : 'is'} a platform page (${hostOf(at)})` };
    let r: Awaited<ReturnType<NonNullable<ReferenceHooks['fetchPage']>>>;
    try { r = await fetchPage(at); } catch (e) { return { ok: false, reason: `could not be fetched: ${(e as Error).message.split('\n')[0].slice(0, 120)}` }; }
    if (r.status >= 300 && r.status < 400 && r.location) { at = new URL(r.location, at).toString(); continue; }
    if (r.status >= 400 || r.status < 200) return { ok: false, reason: `HTTP ${r.status}` };
    if (!/html/i.test(r.contentType)) return { ok: false, reason: `not a web page (${r.contentType || 'no content type'})` };
    const text = r.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (PARKED.test(text)) return { ok: false, reason: 'a parked or placeholder page' };
    if (!/<html|<body/i.test(r.body)) return { ok: false, reason: 'no HTML document' };
    return { ok: true, url: at };
  }
  return { ok: false, reason: 'too many redirects' };
}

// ───────────────────────── actions the verified brief supports ─────────────────────────
const ORDER = /\b(order|ordering|shop|cart|checkout)\b|toasttab|square\.site|squareup|chownow|clover|menufy|slicelife/i;
const BOOK = /\b(book|booking|reserve|reservation|appointment|schedule)\b|opentable|resy|tock|calendly|booksy|vagaro|fresha|mindbody/i;
const DELIVER = /\b(deliver|delivery|deliveries)\b|doordash|ubereats|grubhub|postmates|seamless/i;
export function supportedActions(b: BusinessBrief): SupportedActions {
  const held = new Set(b.callsToAction.held.map((h) => h.href));
  const ctas = [b.callsToAction.primary, b.callsToAction.secondary].filter((c): c is NonNullable<typeof c> => !!c && !held.has(c.href));
  const offers = b.offers.map((o) => `${o.label} ${o.destination}`);
  const claims = b.claims.filter((c) => c.status === 'verified' && c.value).map((c) => c.value!);
  const evidence: string[] = [];
  const has = (re: RegExp, texts: string[], what: string) => { const hit = texts.find((t) => re.test(t)); if (hit) evidence.push(`${what}: "${hit.slice(0, 80)}"`); return !!hit; };
  const ctaTexts = ctas.map((c) => `${c.label} ${c.href}`);
  const order = has(ORDER, [...ctaTexts, ...offers], 'order');
  const booking = (b.callsToAction.booking ? (evidence.push(`booking: ${b.callsToAction.booking.slice(0, 80)}`), true) : false) || ctas.some((c) => c.kind === 'booking') || has(BOOK, ctaTexts, 'booking');
  const delivery = has(DELIVER, [...ctaTexts, ...offers, ...claims], 'delivery');
  const phoneHeld = b.callsToAction.held.some((h) => h.href.startsWith('tel:'));
  const call = !!b.contact.phone.value && b.contact.phone.status === 'verified' && !phoneHeld;
  if (call) evidence.push('call: verified phone');
  const directions = !!b.contact.address.value && b.contact.address.status !== 'conflicting';
  if (directions) evidence.push('directions: address on file');
  return { order, booking, delivery, call, directions, evidence };
}
const allowedNames = (a: SupportedActions) => (['order', 'booking', 'delivery', 'call', 'directions'] as const).filter((k) => a[k]);
/** words that suggest an action, by action; "call to action" and "in order to" are not actions */
const ACTION_WORDS: Record<'order' | 'booking' | 'delivery' | 'call' | 'directions', RegExp> = {
  order: /\b(order(s|ing|ed)?|pre-?orders?|checkout|add to cart|buy online|shop online)\b/i,
  booking: /\b(book(ing|ings)?|reserv(e|ation|ations)|appointments?)\b/i,
  delivery: /\b(deliver(y|ies|s|ed)?)\b/i,
  call: /\b(call(ing|s)?|tap-to-call|click-to-call|phone)\b/i,
  directions: /\b(directions|get directions)\b/i,
};
const STICKY_BAR = /\b(sticky|fixed|persistent)\b[^.;]{0,40}\b(bar|footer|bottom|button)\b|\bbottom (action )?bar\b/i;

type StrategyBody = Omit<DesignStrategy, 'brand' | 'references' | 'actions' | 'source'>;
const S = (max: number) => ({ type: 'string', maxLength: max });
const STRATEGY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'layoutPatterns', 'typography', 'imagery', 'navigation', 'interactions', 'avoid'],
  properties: {
    summary: S(320),
    layoutPatterns: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['pattern', 'why', 'from'], properties: { pattern: S(200), why: S(200), from: { type: 'array', items: { type: 'string' } } } } },
    typography: { type: 'object', additionalProperties: false, required: ['headings', 'body', 'notes'], properties: { headings: S(200), body: S(200), notes: S(240) } },
    imagery: { type: 'array', maxItems: 5, items: S(200) },
    navigation: { type: 'object', additionalProperties: false, required: ['desktop', 'mobile'], properties: { desktop: S(200), mobile: S(200) } },
    interactions: { type: 'array', maxItems: 5, items: S(200) },
    avoid: { type: 'array', maxItems: 5, items: S(200) },
  },
};
function strategyRequest(b: BusinessBrief, refs: InspectedReference[], keepBrand: boolean, actions: SupportedActions) {
  const brand = brandOf(b, keepBrand);
  const allowed = allowedNames(actions);
  const banned = (['order', 'booking', 'delivery', 'call', 'directions'] as const).filter((k) => !actions[k]);
  return {
    stage: 'references:strategy', schema: STRATEGY_SCHEMA, maxOutputTokens: 3000,
    system: 'You are a senior web designer writing a short design strategy for a small business website. Use only the measurements and facts given; answer only with the JSON asked for.',
    prompt: [
      `Business: ${b.identity.name.value} — ${b.identity.category.value ?? 'local business'}. Audience: ${audienceOf(b)}.`,
      keepBrand
        ? `Its brand is fixed: logo ${brand.logo ? 'kept' : '(none on file)'}; colours ${brand.colors.map((c) => `${c.role} ${c.hex}`).join(', ') || '(none measured)'}; fonts on its site: ${brand.fonts.join(', ') || 'unknown'}. Work within these; never propose new brand colours or a new logo.`
        : 'Staff asked for a brand refresh: colours and fonts may be proposed.',
      `Actions the business verifiably offers: ${allowed.join(', ') || 'none'}. Actions it does NOT verifiably offer: ${banned.join(', ') || 'none'}. Suggest buttons, bars or flows only for the offered actions; outside "avoid", never mention the others${allowed.length ? '' : ', and suggest no sticky or fixed action bar'}.`,
      '',
      'Design measurements of established reference sites in this category (desktop and 390px mobile):',
      JSON.stringify(refs.map((r) => ({ host: r.host, desktop: r.desktop, mobile: r.mobile }))),
      '',
      'Write the strategy: which layout patterns, typography approach, imagery treatment, navigation and interactions suit this business, and what to avoid. Cite the reference hosts each pattern is drawn from. Describe patterns in general design terms: the references are inspiration only, so never ask to copy a reference\'s wording, pictures or whole layout.',
    ].join('\n'),
  };
}
export function validateStrategy(d: StrategyBody, hosts: string[], actions: SupportedActions): string[] {
  const errs: string[] = [];
  if (!d?.summary?.trim()) errs.push('summary is empty');
  for (const p of d?.layoutPatterns ?? []) {
    if (!p.from?.length) errs.push(`pattern "${p.pattern}" cites no reference`);
    for (const h of p.from ?? []) if (!hosts.includes(hostOf(`https://${h.replace(/^https?:\/\//, '')}`))) errs.push(`pattern "${p.pattern}" cites ${h}, which was not inspected (${hosts.join(', ')})`);
  }
  // everything except "avoid" (which may name an action to stay away from)
  const { avoid: _avoid, ...rest } = d ?? ({} as StrategyBody);
  const text = JSON.stringify(rest).replace(/calls?[- ]to[- ]action/gi, 'cta').replace(/in order to/gi, 'to');
  if (/\b(copy|replicate|clone)\b/i.test(text)) errs.push('the strategy must not ask to copy, replicate or clone a reference');
  for (const k of ['order', 'booking', 'delivery', 'call', 'directions'] as const) {
    const m = !actions[k] && text.match(ACTION_WORDS[k]);
    if (m) errs.push(`it suggests ${k} ("${m[0]}"), which the verified brief does not support`);
  }
  if (!allowedNames(actions).length && STICKY_BAR.test(text)) errs.push('it suggests a sticky action bar, but the brief supports no action to put on it');
  return errs;
}

/** Without Claude (or when its answer is rejected): the patterns most references share, read off the measurements. */
function fallbackStrategy(b: BusinessBrief, refs: InspectedReference[], actions: SupportedActions): StrategyBody {
  const hosts = refs.map((r) => r.host);
  const most = (f: (r: InspectedReference) => boolean) => refs.length > 0 && refs.filter(f).length * 2 >= refs.length;
  const avg = (f: (r: InspectedReference) => number) => (refs.length ? refs.reduce((s, r) => s + f(r), 0) / refs.length : 0);
  const allowed = allowedNames(actions);
  const patterns: DesignStrategy['layoutPatterns'] = [];
  if (refs.length) {
    patterns.push(most((r) => r.desktop!.hero.media !== 'none') ? { pattern: `Photo-led hero about ${Math.round(avg((r) => r.desktop!.hero.heightRatio) * 100)}% of the first screen`, why: 'most references open with a large picture', from: hosts } : { pattern: 'Type-led hero with the main heading first', why: 'most references open with words, not a picture', from: hosts });
    const counted = refs.filter((r) => r.desktop!.sections !== null);
    if (counted.length) patterns.push({ pattern: `About ${Math.round(counted.reduce((n, r) => n + r.desktop!.sections!, 0) / counted.length)} clearly separated sections`, why: 'measured section count across references whose sections could be counted', from: counted.map((r) => r.host) });
  }
  return {
    summary: refs.length ? `Measured from ${refs.length} reference site(s) for ${b.identity.category.value ?? 'this category'}; a starting point for staff, not a finished direction.` : 'No reference could be inspected; supply a reference URL or rerun when search is available.',
    layoutPatterns: patterns,
    typography: { headings: refs.length ? `Headings around ${Math.round(avg((r) => r.desktop!.type.headingPx))}px on desktop, ${Math.round(avg((r) => r.mobile!.type.headingPx))}px on mobile` : 'Keep the existing site\'s heading style', body: refs.length ? `Body around ${Math.round(avg((r) => r.mobile!.type.bodyPx))}px on mobile, line height ${avg((r) => r.mobile!.type.lineHeight).toFixed(1)}` : 'At least 16px body text on mobile', notes: refs.length ? `References use ${Math.round(avg((r) => r.desktop!.type.families))} font families on average` : '' },
    imagery: refs.length ? [most((r) => r.desktop!.images.coverShare >= 0.5) ? 'Photos cropped to fill their frames' : 'Photos shown whole, at their own proportions', most((r) => r.desktop!.images.roundedShare >= 0.5) ? 'Rounded image corners' : 'Square image corners'] : [],
    navigation: { desktop: refs.length ? (most((r) => r.desktop!.header.sticky) ? 'Sticky header' : 'Header that scrolls away') + ` with about ${Math.round(avg((r) => r.desktop!.header.navLinks))} links` : 'Simple header', mobile: most((r) => r.mobile!.header.menuButton) ? 'Menu button that opens the links' : 'A few links visible in the header' },
    // a fixed bar only when the references use one AND the brief has actions to put on it
    interactions: refs.length ? [most((r) => r.mobile!.interactions.stickyBottomBar) && allowed.length ? `A fixed action bar at the bottom on mobile (${allowed.join(', ')})` : '', most((r) => r.desktop!.interactions.carousel) ? 'A swipeable gallery or review row' : '', most((r) => r.desktop!.interactions.accordion) ? 'Expandable answers for common questions' : ''].filter(Boolean) : [],
    avoid: ['Taking any reference\'s words, pictures or exact layout'],
  };
}

// ───────────────────────── the inspector ─────────────────────────
/** obviously unsuitable: a parked or empty page, or one that does not work on a phone (section count is a measurement, not a test) */
function qualityProblem(d: ViewMetrics, m: ViewMetrics): string | undefined {
  if (d.textLength < 300) return 'too little on the page (parked, empty or blocked)';
  if (!m.viewportMeta) return 'not built for phones (no viewport meta)';
  if (m.overflowX) return 'scrolls sideways on a phone';
  return undefined;
}

// a string, not a function: the bundler's helpers would not exist inside the page
const MEASURE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const fam = (s) => (s.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
  const vh = innerHeight, vw = innerWidth;
  const header = document.querySelector('header, [role=banner]') || document.querySelector('nav')?.parentElement || null;
  const hs = header ? getComputedStyle(header) : null;
  const navLinks = header ? [...header.querySelectorAll('a')].filter(vis).length : 0;
  const menuButton = header ? [...header.querySelectorAll('button, [aria-controls], [aria-expanded]')].some((b) => vis(b) && /menu|nav|☰/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '') + (b.className || ''))) : false;
  const main = document.querySelector('main') || document.body;
  const blocks = [...main.children].filter((e) => vis(e) && e.getBoundingClientRect().height > 120 && e !== header);
  const hero = blocks.find((e) => e.getBoundingClientRect().bottom > 0) || null;
  const heroBg = hero ? [hero, ...hero.querySelectorAll('*')].slice(0, 60).some((e) => /url\\(/.test(getComputedStyle(e).backgroundImage)) : false;
  const heroVideo = hero ? !!hero.querySelector('video') : false;
  const heroImg = hero ? [...hero.querySelectorAll('img, picture')].some((i) => vis(i) && i.getBoundingClientRect().width > vw * 0.3) : false;
  const h1 = document.querySelector('h1') || document.querySelector('h2');
  const h1s = h1 ? getComputedStyle(h1) : getComputedStyle(document.body);
  const p = [...document.querySelectorAll('p')].find((x) => vis(x) && (x.textContent || '').trim().length > 40) || document.body;
  const ps = getComputedStyle(p);
  const families = new Set([...document.querySelectorAll('h1,h2,h3,p,a,button,li')].slice(0, 300).map((e) => fam(getComputedStyle(e))));
  const imgs = [...document.querySelectorAll('img')].filter((i) => vis(i) && i.getBoundingClientRect().width > 80);
  const share = (f) => (imgs.length ? imgs.filter(f).length / imgs.length : 0);
  const btns = [...document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button]')].filter(vis);
  const radii = btns.map((b) => parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0).sort((a, b) => a - b);
  const ctas = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.top < vh && r.bottom > 0; }).length;
  const fixedBottom = [...document.querySelectorAll('body *')].slice(0, 3000).some((e) => { const s = getComputedStyle(e); if (s.position !== 'fixed' && s.position !== 'sticky') return false; const r = e.getBoundingClientRect(); return r.bottom >= vh - 4 && r.top > vh * 0.7 && r.width > vw * 0.6; });
  return {
    textLength: (document.body.innerText || '').length,
    viewportMeta: !!document.querySelector('meta[name=viewport]'),
    overflowX: document.documentElement.scrollWidth > vw + 4,
    pageScreens: Math.round(document.documentElement.scrollHeight / vh * 10) / 10,
    header: { sticky: !!hs && (hs.position === 'sticky' || hs.position === 'fixed'), navLinks, menuButton },
    hero: { heightRatio: hero ? Math.round(Math.min(hero.getBoundingClientRect().height, vh * 2) / vh * 100) / 100 : 0, media: heroVideo ? 'video' : heroBg || heroImg ? 'image' : 'none', textOverMedia: !!(hero && heroBg && hero.querySelector('h1,h2')), ctas },
    type: { headingFamily: fam(h1s), headingPx: parseFloat(h1s.fontSize), headingWeight: +h1s.fontWeight || 400, headingCase: h1s.textTransform, bodyFamily: fam(ps), bodyPx: parseFloat(ps.fontSize), lineHeight: Math.round((parseFloat(ps.lineHeight) / parseFloat(ps.fontSize) || 1.2) * 100) / 100, families: families.size },
    sections: blocks.length > 1 ? blocks.length : null,
    images: { count: imgs.length, coverShare: share((i) => getComputedStyle(i).objectFit === 'cover'), roundedShare: share((i) => parseFloat(getComputedStyle(i).borderTopLeftRadius) > 0), wideShare: share((i) => i.getBoundingClientRect().width > vw * 0.6) },
    buttons: { radiusPx: radii.length ? radii[Math.floor(radii.length / 2)] : 0 },
    interactions: { carousel: !!document.querySelector('[class*=carousel],[class*=slider],[class*=swiper],[class*=slick]') || [...document.querySelectorAll('body *')].slice(0, 3000).some((e) => getComputedStyle(e).scrollSnapType !== 'none'), accordion: !!document.querySelector('details, [aria-expanded]'), stickyBottomBar: fixedBottom, video: !!document.querySelector('video'), forms: document.querySelectorAll('form').length },
  };
})()`;

/** Open a page at desktop and phone sizes, measure its design and take screenshots for staff. Keeps no text or images. */
export async function inspectPage(url: string, dir: string, allow: (u: string) => boolean): Promise<{ desktop: ViewMetrics; mobile: ViewMetrics; screenshots: { desktop: string; mobile: string } }> {
  const browser = await launchBrowser();
  try {
    const host = hostOf(url).replace(/[^a-z0-9.-]/gi, '_');
    const view = async (mobile: boolean) => {
      const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
      try {
        // every request the page makes is checked too: a public page cannot make the server fetch a private address
        await ctx.route('**/*', (r) => (allow(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
        const page = await ctx.newPage();
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status() ?? 'no response'}`);
        if (!allow(page.url())) throw new Error('redirected to an address that is not allowed');
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
        const metrics = (await page.evaluate(MEASURE)) as ViewMetrics;
        const shot = path.join(dir, `${host}-${mobile ? 'mobile' : 'desktop'}.png`);
        await page.screenshot({ path: shot, timeout: 15_000 });
        return { metrics, shot: path.relative(config.dirs.out, shot).replace(/\\/g, '/') };
      } finally { await ctx.close().catch(() => undefined); }
    };
    const d = await view(false);
    const m = await view(true);
    return { desktop: d.metrics, mobile: m.metrics, screenshots: { desktop: d.shot, mobile: m.shot } };
  } finally { await browser.close().catch(() => undefined); }
}
