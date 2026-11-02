import { config } from '../config.js';

/**
 * Google PageSpeed Insights (Lighthouse run by Google, plus real-visitor Chrome UX Report data when Google has
 * enough traffic for the site). One request per strategy (mobile, desktop) with all four categories. Needs
 * PAGESPEED_API_KEY with the PageSpeed Insights API enabled; a Maps-only key is refused by Google (403).
 * Google can't reach local or private addresses, so those are skipped.
 * API: https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed
 */
export type Strategy = 'mobile' | 'desktop';
export const PSI_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type PsiCategory = (typeof PSI_CATEGORIES)[number];

export interface PsiFinding {
  id: string;
  category: PsiCategory;
  title: string;
  /** Lighthouse's own value, e.g. "Potential savings of 1,240 KiB" or "3 elements" */
  displayValue?: string;
  /** 0..1, null for checks without a score */
  score: number | null;
  /** estimated time saved on load (performance) */
  savingsMs?: number;
  savingsKb?: number;
  /** how much this check counts towards its category score */
  weight: number;
  /** plain-text explanation (Lighthouse's markdown links removed) */
  description: string;
  /** how many elements or resources are affected, when Lighthouse lists them */
  items?: number;
}

export interface PsiReport {
  strategy: Strategy;
  finalUrl: string;
  lighthouseVersion?: string;
  fetchedAt: string;
  /** 0-100 per category */
  scores: Partial<Record<PsiCategory, number>>;
  /** lab metrics from this run */
  lab: { fcp?: string; lcp?: string; tbt?: string; cls?: string; si?: string; lcpMs?: number; clsValue?: number; tbtMs?: number };
  /** real visitors over the last 28 days (Chrome UX Report); absent for most small sites */
  field?: { overall?: 'FAST' | 'AVERAGE' | 'SLOW'; scope: 'page' | 'origin'; lcpMs?: number; inpMs?: number; cls?: number; fcpMs?: number; ttfbMs?: number; lcp?: string; inp?: string; clsCategory?: string };
  /** every check that didn't pass, worst first per category */
  findings: PsiFinding[];
  /** checks Google ran and passed, per category */
  passedCount: Partial<Record<PsiCategory, number>>;
  /** Lighthouse notes such as "the page loaded too slowly to finish" */
  warnings: string[];
}

export interface PageSpeedResult {
  mobile?: PsiReport;
  desktop?: PsiReport;
  /** why Google's check didn't run or failed; the rest of the audit still runs */
  error?: { code: 'no-key' | 'disabled' | 'private-url' | 'key-not-enabled' | 'quota' | 'unreachable' | 'timeout' | 'failed'; message: string };
  /** link to the same check on Google's site */
  reportUrl: string;
  /** google: PageSpeed Insights; local: Lighthouse on this server (a preview Google can't reach) */
  source?: 'google' | 'local';
}

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?|.*\.local$|.*\.localhost$|.*\.internal$|.*\.test$)/i;

export const reportUrlFor = (url: string) => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`;
const plain = (md: string) => md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ').trim();

/** Turn one PSI API response into the parts the audit and the report use. Exported for tests. */
export function parsePsi(json: any, strategy: Strategy): PsiReport {
  const lr = json.lighthouseResult || {};
  const audits: Record<string, any> = lr.audits || {};
  const cats: Record<string, any> = lr.categories || {};
  const scores: PsiReport['scores'] = {};
  const findings: PsiFinding[] = [];
  const passedCount: PsiReport['passedCount'] = {};
  for (const c of PSI_CATEGORIES) {
    const cat = cats[c];
    if (!cat) continue;
    if (typeof cat.score === 'number') scores[c] = Math.round(cat.score * 100);
    let passed = 0;
    for (const ref of cat.auditRefs || []) {
      const a = audits[ref.id];
      if (!a) continue;
      // metric audits are shown as metrics, not as things to fix; hidden ones are internal
      if (ref.group === 'metrics' || ref.group === 'hidden' || /^(manual|notApplicable|error)$/.test(a.scoreDisplayMode)) continue;
      const informative = a.scoreDisplayMode === 'informative';
      const savingsMs = Math.round(a.metricSavings?.LCP ?? a.metricSavings?.FCP ?? a.details?.overallSavingsMs ?? 0) || undefined;
      // Lighthouse 13 insights state byte savings only in their display text ("Est savings of 35 KiB")
      const kibText = String(a.displayValue || '').match(/([\d,.]+)\s*(KiB|MiB)/);
      const savingsKb = a.details?.overallSavingsBytes ? Math.round(a.details.overallSavingsBytes / 1024)
        : kibText ? Math.round(Number(kibText[1].replace(/,/g, '')) * (kibText[2] === 'MiB' ? 1024 : 1)) : undefined;
      const failing = typeof a.score === 'number' ? a.score < 0.9 : informative && c === 'performance' && (savingsMs || savingsKb);
      if (!failing) { if (typeof a.score === 'number') passed++; continue; }
      findings.push({
        id: ref.id, category: c, title: plain(a.title || ref.id), displayValue: a.displayValue ? plain(a.displayValue) : undefined,
        score: typeof a.score === 'number' ? a.score : null, savingsMs, savingsKb, weight: ref.weight || 0,
        description: plain(a.description || '').slice(0, 400), items: Array.isArray(a.details?.items) && a.details.items.length ? a.details.items.length : undefined,
      });
    }
    passedCount[c] = passed;
  }
  // worst first: biggest weight, then lowest score, then biggest saving
  findings.sort((x, y) => PSI_CATEGORIES.indexOf(x.category) - PSI_CATEGORIES.indexOf(y.category) || y.weight - x.weight || (x.score ?? 1) - (y.score ?? 1) || (y.savingsMs ?? 0) - (x.savingsMs ?? 0));
  const num = (id: string) => (typeof audits[id]?.numericValue === 'number' ? audits[id].numericValue : undefined);
  const lab: PsiReport['lab'] = {
    fcp: audits['first-contentful-paint']?.displayValue, lcp: audits['largest-contentful-paint']?.displayValue, tbt: audits['total-blocking-time']?.displayValue,
    cls: audits['cumulative-layout-shift']?.displayValue, si: audits['speed-index']?.displayValue,
    lcpMs: num('largest-contentful-paint') && Math.round(num('largest-contentful-paint')!), tbtMs: num('total-blocking-time') && Math.round(num('total-blocking-time')!),
    clsValue: num('cumulative-layout-shift') !== undefined ? Math.round(num('cumulative-layout-shift')! * 1000) / 1000 : undefined,
  };
  // real-visitor data for this page, else for the whole site (origin)
  const le = json.loadingExperience?.metrics ? { d: json.loadingExperience, scope: 'page' as const } : json.originLoadingExperience?.metrics ? { d: json.originLoadingExperience, scope: 'origin' as const } : undefined;
  let field: PsiReport['field'];
  if (le) {
    const m = le.d.metrics;
    const p = (k: string) => m[k]?.percentile as number | undefined;
    field = {
      overall: le.d.overall_category, scope: le.scope, lcpMs: p('LARGEST_CONTENTFUL_PAINT_MS'), inpMs: p('INTERACTION_TO_NEXT_PAINT'),
      cls: p('CUMULATIVE_LAYOUT_SHIFT_SCORE') !== undefined ? p('CUMULATIVE_LAYOUT_SHIFT_SCORE')! / 100 : undefined,
      fcpMs: p('FIRST_CONTENTFUL_PAINT_MS'), ttfbMs: p('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
      lcp: m.LARGEST_CONTENTFUL_PAINT_MS?.category, inp: m.INTERACTION_TO_NEXT_PAINT?.category, clsCategory: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category,
    };
  }
  return {
    strategy, finalUrl: lr.finalDisplayedUrl || lr.finalUrl || json.id || '', lighthouseVersion: lr.lighthouseVersion, fetchedAt: lr.fetchTime || new Date().toISOString(),
    scores, lab, field, findings, passedCount, warnings: (lr.runWarnings || []).map((w: string) => plain(String(w))).slice(0, 5),
  };
}

// recent results, so re-auditing the same site (Studio, then iMessage) doesn't spend quota or 30 seconds again
const cache = new Map<string, { at: number; p: Promise<PsiReport> }>();
const TTL = 30 * 60_000;

class PsiError extends Error { constructor(public code: NonNullable<PageSpeedResult['error']>['code'], message: string) { super(message); } }

async function runOne(url: string, strategy: Strategy): Promise<PsiReport> {
  const key = `${strategy}|${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const q = new URLSearchParams({ url, strategy, key: config.pagespeedKey });
  for (const c of PSI_CATEGORIES) q.append('category', c.toUpperCase().replace('-', '_'));
  const p = (async () => {
    let r: Response;
    try {
      r = await fetch(`${API}?${q}`, { signal: AbortSignal.timeout(config.pagespeedTimeoutMs) });
    } catch (e) {
      throw new PsiError((e as Error).name === 'TimeoutError' ? 'timeout' : 'failed', (e as Error).name === 'TimeoutError' ? `Google's check took longer than ${Math.round(config.pagespeedTimeoutMs / 1000)}s` : (e as Error).message);
    }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(j?.error?.message || r.status);
      if (r.status === 403) throw new PsiError('key-not-enabled', 'The PageSpeed Insights API isn\'t enabled for this key (set PAGESPEED_API_KEY to a key that has it).');
      if (r.status === 429) throw new PsiError('quota', 'PageSpeed Insights daily quota is used up for this key.');
      if (r.status === 400 || r.status === 500) throw new PsiError('unreachable', `Google couldn't load the page: ${msg.replace(/^Lighthouse returned error:\s*/i, '').slice(0, 160)}`);
      throw new PsiError('failed', msg.slice(0, 200));
    }
    return parsePsi(j, strategy);
  })();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key)); // failures aren't cached
  return p;
}

/** Mobile and desktop in parallel. Never throws: problems come back as `error`, with whatever succeeded. */
export async function pageSpeed(url: string, strategies: Strategy[] = ['mobile', 'desktop']): Promise<PageSpeedResult> {
  const reportUrl = reportUrlFor(url);
  if (!config.pagespeed) return { reportUrl, error: { code: 'disabled', message: 'Google PageSpeed checks are turned off (PAGESPEED=0).' } };
  if (!config.pagespeedKey) return { reportUrl, error: { code: 'no-key', message: 'No PageSpeed Insights key (PAGESPEED_API_KEY).' } };
  let host = '';
  try { host = new URL(url).hostname; } catch { /* invalid */ }
  if (!host || PRIVATE_HOST.test(host)) return { reportUrl, error: { code: 'private-url', message: 'Google can only check public websites, not local addresses.' } };
  const runs = await Promise.allSettled(strategies.map((s) => runOne(url, s)));
  const out: PageSpeedResult = { reportUrl, source: 'google' };
  runs.forEach((r, i) => { if (r.status === 'fulfilled') out[strategies[i]] = r.value; });
  const failed = runs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) {
    const e = failed.reason;
    out.error = e instanceof PsiError ? { code: e.code, message: e.message } : { code: 'failed', message: String(e?.message || e).slice(0, 200) };
    console.warn(`[pagespeed] ${url}: ${out.error.message}`);
  }
  return out;
}
