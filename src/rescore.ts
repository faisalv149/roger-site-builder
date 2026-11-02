import { config } from './config.js';
import { getDraft, putDraft, withDraftLock, type DraftRecord } from './drafts.js';
import { canScoreNewSite, mainRun, scoreNewSite } from './audit/compare.js';

/**
 * Scores tied to the exact revision they measured. A save queues a re-check (debounced, so several quick saves
 * cost one run) that runs in the background: the preview and the customiser never wait for Lighthouse. Each
 * result records the draft revision, URL, device, tool and version, environment and time; the editor shows the
 * latest result for the current revision, or labels an older one "previous" while a refresh is pending.
 */
export interface ScoreRecord {
  revision: number;
  /** what was measured: the shared preview of the draft, or the published site */
  target: 'draft' | 'published';
  url: string;
  status: 'pending' | 'done' | 'failed';
  queuedAt: string;
  measuredAt?: string;
  /** lab measurement on this server (local Lighthouse) or Google's PageSpeed Insights */
  env?: 'local' | 'google';
  tool?: string;
  device?: 'mobile' | 'desktop';
  score?: number;
  scores?: { performance?: number; accessibility?: number; bestPractices?: number; seo?: number };
  lcp?: string;
  error?: string;
}

const timers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = Number(process.env.RESCORE_DEBOUNCE_MS || 20_000);

/** Queue a re-check of a draft's saved revision (no-op where the site can't be measured, e.g. no Chrome). */
export function queueRescore(draftId: string, revision: number, slug: string): void {
  const url = `${config.publicBaseUrl}/sites/${slug}/`;
  if (!canScoreNewSite(url) || process.env.RESCORE === '0') return;
  clearTimeout(timers.get(draftId));
  void withDraftLock(draftId, async () => {
    const d = await getDraft(draftId);
    if (!d) return;
    d.scores = [{ revision, target: 'draft' as const, url, status: 'pending' as const, queuedAt: new Date().toISOString() }, ...(d.scores ?? []).filter((s) => !(s.status === 'pending' && s.target === 'draft'))].slice(0, 10);
    await putDraft(d);
  }).catch(() => undefined);
  timers.set(draftId, setTimeout(() => { timers.delete(draftId); void runRescore(draftId); }, DEBOUNCE_MS).unref());
}

export async function runRescore(draftId: string): Promise<ScoreRecord | undefined> {
  const d0 = await getDraft(draftId);
  if (!d0) return undefined;
  const revision = d0.revision;
  const url = `${config.publicBaseUrl}/sites/${d0.slug}/`;
  let rec: ScoreRecord = { revision, target: 'draft', url, status: 'pending', queuedAt: new Date().toISOString() };
  try {
    const a = await scoreNewSite(url, d0.base.business, { preview: true });
    const r = mainRun(a);
    rec = {
      ...rec, status: 'done', measuredAt: a.generatedAt, env: a.metrics.pagespeed?.source === 'google' ? 'google' : 'local',
      tool: `Lighthouse ${r?.lighthouseVersion ?? ''}`.trim(), device: r?.strategy, score: a.score,
      scores: r ? { performance: r.scores.performance, accessibility: r.scores.accessibility, bestPractices: r.scores['best-practices'], seo: r.scores.seo } : undefined, lcp: r?.lab.lcp,
    };
  } catch (e) {
    rec = { ...rec, status: 'failed', measuredAt: new Date().toISOString(), error: (e as Error).message.slice(0, 200) };
  }
  await withDraftLock(draftId, async () => {
    const d = await getDraft(draftId);
    if (!d) return;
    d.scores = [rec, ...(d.scores ?? []).filter((s) => !(s.status === 'pending' && s.revision <= revision && s.target === 'draft'))].slice(0, 10);
    await putDraft(d);
  });
  return rec;
}

/** What the editor shows: the current revision's result, or the latest older one marked as previous. */
export function scoreStatus(d: DraftRecord) {
  const list = d.scores ?? [];
  const pending = list.find((s) => s.status === 'pending' && s.target === 'draft');
  const current = list.find((s) => s.status === 'done' && s.revision === d.revision && s.target === 'draft');
  const previous = current ? undefined : list.find((s) => s.status === 'done' && s.target === 'draft');
  const failed = list[0]?.status === 'failed' ? list[0] : undefined;
  return { revision: d.revision, current, previous, pending: !!pending, failed };
}
