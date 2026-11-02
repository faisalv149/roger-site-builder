import type { Business } from '../types.js';
import { scanWebsite } from '../sources/website.js';
import { auditWebsite, type AuditResult } from './audit.js';
import { localLighthouseAvailable, isPublicUrl, scoreSite } from './lighthouse-local.js';
import { config } from '../config.js';
import { writeReport } from './report.js';

/**
 * The new site scored with the same checks as the owner's current site (Roger's website check plus Google's
 * Lighthouse categories), so the two can be shown side by side. Needs the site to be reachable: this server
 * serving the preview (local Lighthouse) or a public URL (Google PageSpeed Insights).
 */
export const canScoreNewSite = (siteUrl: string) => localLighthouseAvailable() || (isPublicUrl(siteUrl) && !!config.pagespeedKey && config.pagespeed);

export async function scoreNewSite(siteUrl: string, b?: Business, opts: { preview?: boolean } = {}): Promise<AuditResult> {
  const s = await scanWebsite(siteUrl);
  if (!s.ok) throw new Error(`the new site didn't load (${s.status || s.error})`);
  const preview = opts.preview !== false;
  return auditWebsite(s, b, { scores: (u) => scoreSite(u, { preview }), preview, summarize: false });
}

/** The phone run when Google scored it, else the computer run. */
export const mainRun = (a?: AuditResult) => a?.metrics.pagespeed?.mobile || a?.metrics.pagespeed?.desktop;

/** What the owner sees about both sites (editor, messages): the headline numbers only. */
export function scoreSummary(oldA: AuditResult | undefined, newA: AuditResult | undefined) {
  const pick = (a?: AuditResult) => {
    if (!a) return undefined;
    const r = mainRun(a);
    return { score: a.score, performance: r?.scores.performance ?? a.metrics.pagespeed?.performance, accessibility: r?.scores.accessibility, bestPractices: r?.scores['best-practices'], seo: r?.scores.seo, lcp: r?.lab.lcp, device: r?.strategy, issues: a.issues.length };
  };
  return { old: pick(oldA), new: pick(newA), source: newA?.metrics.pagespeed?.source };
}

/** The text Roger sends once the new site is scored. */
export function scoreMessage(oldA: AuditResult | undefined, newA: AuditResult, reportUrl?: string): string {
  const s = scoreSummary(oldA, newA);
  const speed = s.new?.performance !== undefined
    ? s.old?.performance !== undefined ? ` Google speed on phones: ${s.old.performance} → ${s.new.performance}.` : ` Google speed on phones: ${s.new.performance}/100.`
    : '';
  const head = s.old
    ? `Score check: your current website scores ${s.old.score}/100, your new site scores ${s.new!.score}/100 on the same checks.`
    : `Score check: your new site scores ${s.new!.score}/100 on our website check.`;
  return `${head}${speed}${reportUrl ? ` Side by side: ${reportUrl}` : ''}`;
}

/** Rewrite the owner's current-site report with the new site's scores, at the same link. */
export async function addComparisonToReport(oldA: AuditResult & { reportUrl?: string }, newA: AuditResult, opts: { businessName?: string; siteUrl?: string }): Promise<string | undefined> {
  const slug = oldA.reportUrl?.match(/\/reports\/([^/]+)\/?$/)?.[1];
  if (!slug) return undefined;
  const { reportUrl: _r, image: _i, ...plain } = oldA as AuditResult & { reportUrl?: string; image?: string };
  const rep = await writeReport(slug, plain, { ...opts, newSite: newA });
  return rep.url;
}
