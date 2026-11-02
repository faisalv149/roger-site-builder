import { config } from '../config.js';
import { pageSpeed, parsePsi, reportUrlFor, type PageSpeedResult, type PsiReport, type Strategy } from './pagespeed.js';

/**
 * Scores for a site Google can't reach yet (a local or private preview): the same Lighthouse version and
 * categories Google's PageSpeed Insights runs, in the Chrome this server already uses for screenshots. Numbers
 * from this machine are close to Google's but not identical (different hardware and network), so results say
 * where they came from. Public URLs go to Google's PageSpeed Insights instead (src/audit/pagespeed.ts).
 */
export type ScoreSource = 'google' | 'local';
export type SiteScores = PageSpeedResult & { source: ScoreSource }; // source is required here

// one Lighthouse run at a time: parallel runs compete for CPU and make each other's scores worse
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

export const localLighthouseAvailable = () => !!config.chromiumPath && config.pagespeed;

/**
 * preview: the page carries noindex on purpose (drafts stay out of Google until published), so Lighthouse's
 * "page is blocked from indexing" check is left out instead of counting against the SEO score.
 */
export async function localLighthouse(url: string, opts: { strategies?: Strategy[]; preview?: boolean } = {}): Promise<SiteScores> {
  const reportUrl = reportUrlFor(url);
  if (!localLighthouseAvailable()) return { reportUrl, source: 'local', error: { code: 'disabled', message: 'No Chrome on this server for Lighthouse.' } };
  return serial(async () => {
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([import('lighthouse'), import('chrome-launcher')]);
    const chrome = await chromeLauncher.launch({ chromePath: config.chromiumPath, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
    const out: SiteScores = { reportUrl, source: 'local' };
    try {
      for (const s of opts.strategies ?? (['mobile', 'desktop'] as Strategy[])) {
        const flags = { port: chrome.port, output: 'json' as const, logLevel: 'error' as const, onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], skipAudits: opts.preview ? ['is-crawlable'] : undefined };
        const cfg = s === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
        const r = await lighthouse(url, flags, cfg);
        if (!r?.lhr) throw new Error('Lighthouse returned no result');
        if (r.lhr.runtimeError) throw new Error(r.lhr.runtimeError.message);
        const rep: PsiReport = parsePsi({ lighthouseResult: r.lhr }, s);
        if (opts.preview) rep.warnings.unshift('Scored on Roger\'s server: Google can\'t reach a private preview. Search visibility is checked once the site is published (previews are hidden from Google on purpose).');
        out[s] = rep;
      }
    } catch (e) {
      out.error = { code: 'failed', message: `Lighthouse: ${(e as Error).message.slice(0, 200)}` };
      console.warn(`[lighthouse] ${url}: ${out.error.message}`);
    } finally {
      await chrome.kill();
    }
    return out;
  });
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?|.*\.local$|.*\.localhost$|.*\.internal$|.*\.test$)/i;
export const isPublicUrl = (url: string) => { try { return !PRIVATE_HOST.test(new URL(url).hostname); } catch { return false; } };

/** Google's PageSpeed Insights for public sites, local Lighthouse for previews Google can't reach. */
export async function scoreSite(url: string, opts: { preview?: boolean } = {}): Promise<SiteScores> {
  if (isPublicUrl(url) && config.pagespeedKey) {
    const g = await pageSpeed(url);
    if (g.mobile || g.desktop) return { ...g, source: 'google' };
  }
  return localLighthouse(url, opts);
}
