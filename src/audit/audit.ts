import * as cheerio from 'cheerio';
import { config } from '../config.js';
import type { Business, WebsiteScan } from '../types.js';
import { fetchJson, fetchRaw } from '../util/http.js';
import { digits } from '../util/text.js';
import { claudeJson } from '../content/claude.js';
import { pageSpeed, type PageSpeedResult, type PsiFinding, type PsiReport } from './pagespeed.js';
import { measurePage } from '../sources/render-page.js';

export type Category = 'security' | 'speed' | 'mobile' | 'seo' | 'accessibility' | 'conversion' | 'trust';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * How sure the audit is. measured: observed directly (a request, a browser, Google's test). heuristic: a risk inferred from
 * the page source that wasn't confirmed by a test, so it is worded as "may" and counts half. suggestion: advice, not a fault, and
 * doesn't change the score. What couldn't be determined at all goes in AuditResult.unknowns, never in the issues.
 */
export type Basis = 'measured' | 'heuristic' | 'suggestion';

export interface AuditIssue {
  id: string;
  category: Category;
  severity: Severity;
  basis: Basis;
  title: string; // owner-friendly, short
  detail: string; // evidence
  fix: string; // what Roger will do
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  reachable: boolean;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  categories: Record<Category, number>;
  issues: AuditIssue[];
  passed: string[];
  /** what the audit could not determine, and why */
  unknowns: { id: string; title: string; detail: string }[];
  metrics: { ttfbMs: number; htmlKb: number; imageKb: number; pageKb: number; images: number; requestsSampled: number; /** images downloaded for the weight figure, of images found */ imagesMeasured?: number; /** the page was opened in a phone-sized browser */ measuredInBrowser?: boolean; pagespeed?: PageSpeed };
  summary: { headline: string; bullets: string[]; pitch: string; source: 'claude' | 'template' };
  generatedAt: string;
}

/** Google PageSpeed Insights (src/audit/pagespeed.ts). Older saved audits have only the legacy mobile fields. */
export type PageSpeed = Partial<PageSpeedResult> & { performance?: number; lcp?: string; cls?: string; tbt?: string; fcp?: string };

const PENALTY: Record<Severity, number> = { critical: 25, high: 12, medium: 6, low: 2 };
/** a risk that wasn't tested counts half; advice counts nothing */
const WEIGHT: Record<Basis, number> = { measured: 1, heuristic: 0.5, suggestion: 0 };
const CATS: Category[] = ['security', 'speed', 'mobile', 'seo', 'accessibility', 'conversion', 'trust'];

async function imageWeight(scan: WebsiteScan): Promise<{ kb: number; sampled: number; fetched: number; biggest?: { src: string; kb: number } }> {
  const srcs = [...new Set(scan.images.map((i) => i.src).filter((s) => s && !s.startsWith('data:')))].slice(0, 10);
  let total = 0;
  let fetched = 0;
  let biggest: { src: string; kb: number } | undefined;
  await Promise.all(srcs.map(async (src) => {
    const r = await fetchRaw(src, { timeoutMs: 8000, maxBytes: 12_000_000 }).catch(() => null);
    if (!r?.ok) return;
    const kb = Math.round(r.body.length / 1024);
    fetched++;
    total += kb;
    if (!biggest || kb > biggest.kb) biggest = { src, kb };
  }));
  return { kb: total, sampled: srcs.length, fetched, biggest };
}

const FREE_EMAIL = /@(yahoo|gmail|aol|hotmail|outlook|msn|comcast|sbcglobal|att|icloud)\./i;
const STREET_RE = /\b(\d{2,6})\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:St|Street|Rd|Road|Blvd|Boulevard|Ave|Avenue|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court)\b/g;

export interface AuditOptions {
  /** how to get Google-style scores (default: Google's PageSpeed Insights) */
  scores?: (url: string) => Promise<PageSpeed>; // e.g. scoreSite (src/audit/lighthouse-local.ts) for previews
  /**
   * a Roger preview: it is hidden from Google on purpose and lives under a path of this server, so the noindex
   * tag and the domain's robots.txt / sitemap.xml aren't held against it
   */
  preview?: boolean;
  /** the owner-facing summary (Claude); off for internal comparisons */
  summarize?: boolean;
  /** open the page in a phone-sized browser to measure layout (default: yes, when a browser is available) */
  measure?: boolean;
}

export async function auditWebsite(scan: WebsiteScan, b?: Business, opts: AuditOptions = {}): Promise<AuditResult> {
  const issues: AuditIssue[] = [];
  const passed: string[] = [];
  const unknowns: AuditResult['unknowns'] = [];
  const add = (i: Omit<AuditIssue, 'basis'> & { basis?: Basis }) => issues.push({ basis: 'measured', ...i });
  const ok = (s: string) => passed.push(s);
  const unknown = (id: string, title: string, detail: string) => unknowns.push({ id, title, detail });

  // Google's Lighthouse run takes 10-40 s, so it starts first and runs alongside the checks below
  const psP: Promise<PageSpeed | undefined> = scan.ok ? (opts.scores ? opts.scores(scan.finalUrl) : pageSpeed(scan.finalUrl)) : Promise.resolve(undefined);
  // and the page is opened in a phone-sized browser, so layout facts are measured where a browser is available
  const measureP = scan.ok && opts.measure !== false ? measurePage(scan.finalUrl).catch(() => undefined) : Promise.resolve(undefined);

  if (!scan.ok) {
    add({ id: 'down', category: 'security', severity: 'critical', title: 'Your website is not loading', detail: `${scan.url} returned ${scan.status || scan.error || 'no response'}.`, fix: 'We will put a fast, reliable site live on secure hosting.' });
    return finalize(scan, issues, passed, unknowns, { ttfbMs: 0, htmlKb: 0, imageKb: 0, pageKb: 0, images: 0, requestsSampled: 0 }, b, opts.summarize);
  }

  const $ = cheerio.load(scan.html);
  const html = scan.html;
  const text = scan.text;
  const year = new Date().getFullYear();

  // ── security ──
  const localPreview = opts.preview && /^http:\/\/(localhost|127\.)/.test(scan.finalUrl);
  if (localPreview) ok('HTTPS comes with publishing (this is a local preview)');
  else if (scan.finalUrl.startsWith('http:')) add({ id: 'https', category: 'security', severity: 'high', title: 'Browsers mark your site "Not Secure"', detail: `The site loads over plain HTTP (${scan.finalUrl}).`, fix: 'Free HTTPS certificate on every page.' });
  else ok('Uses HTTPS');
  if (scan.finalUrl.startsWith('https:') && /\s(src|href)=["']http:\/\//i.test(html)) add({ id: 'mixed', category: 'security', severity: 'medium', title: 'Some files load insecurely', detail: 'The page pulls images or scripts over http:// (mixed content).', fix: 'Serve every asset over HTTPS.' });
  const jq = html.match(/jquery[-.]?(1\.\d+(\.\d+)?|2\.\d+(\.\d+)?)(\.min)?\.js/i);
  if (jq) add({ id: 'jquery', category: 'security', severity: 'low', title: 'Outdated code with known security holes', detail: `Uses jQuery ${jq[1]} (no longer supported).`, fix: 'Modern, dependency-free code.' });

  // ── mobile ──
  const viewport = $('meta[name="viewport"]').attr('content');
  if (!viewport) add({ id: 'viewport', category: 'mobile', severity: 'critical', title: 'Not built for phones', detail: 'No mobile viewport tag, so phones show a shrunken desktop page.', fix: 'Mobile-first layout with big tap targets.' });
  else ok('Has a mobile viewport');
  const fixedTables = $('table[width]').filter((_, el) => Number($(el).attr('width')) >= 600).length;
  // A bare desktop `width:` locks the page. `max-width: 1100px` and rules inside @media blocks are how
  // responsive sites are built, so neither counts (they made live sites look broken).
  const unscopedCss = html.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '');
  const fixedWidth = fixedTables > 0 || /(?<![-\w])width\s*:\s*(9\d\d|1[0-2]\d\d)px/i.test(unscopedCss);
  const measured = await measureP;
  if (measured) {
    // a phone-sized browser says whether the page really scrolls sideways
    if (measured.scrollWidth > measured.innerWidth + 8) add({ id: 'fixed-layout', category: 'mobile', severity: 'high', title: 'The page scrolls sideways on a phone', detail: `Opened at phone width (${measured.innerWidth}px), the page is ${measured.scrollWidth}px wide.`, fix: 'Responsive grid that fits any screen.' });
    else ok(`Fits a phone-sized screen without sideways scrolling (${measured.innerWidth}px)`);
  } else if (fixedWidth) add({ id: 'fixed-layout', category: 'mobile', severity: 'medium', basis: 'heuristic', title: 'The layout may be locked to a desktop width', detail: fixedTables ? `${fixedTables} fixed-width tables are used for layout. This was read from the page source, not tested on a phone.` : 'The page CSS sets a fixed desktop width. This was read from the page source, not tested on a phone.', fix: 'Responsive grid that fits any screen.' });

  // ── speed ──
  const img = await imageWeight(scan);
  const htmlKb = Math.round(scan.bytes / 1024);
  const pageKb = htmlKb + img.kb;
  const distinctImages = new Set(scan.images.map((i) => i.src).filter((s) => s && !s.startsWith('data:'))).size;
  const partial = img.sampled < distinctImages || img.fetched < img.sampled;
  if (scan.timing.ttfbMs > 1800) add({ id: 'ttfb', category: 'speed', severity: 'high', title: 'Server is slow to respond', detail: `First byte took ${(scan.timing.ttfbMs / 1000).toFixed(1)}s.`, fix: 'Fast CDN hosting (pages load in under a second).' });
  else if (scan.timing.ttfbMs > 800) add({ id: 'ttfb', category: 'speed', severity: 'medium', title: 'Server is a bit slow', detail: `First byte took ${scan.timing.ttfbMs}ms.`, fix: 'Fast CDN hosting.' });
  // the figure counts the HTML plus the images that were downloaded: scripts, styles and fonts, and any image not sampled, are not in it.
  // So a total is only claimed as "at least", and the verdict rests on what was actually counted.
  const counted = `${htmlKb >= 1024 ? `${(htmlKb / 1024).toFixed(1)} MB` : `${htmlKb} KB`} of HTML${img.fetched ? ` plus ${img.kb} KB from ${img.fetched} of ${distinctImages} images` : ''}`;
  if (htmlKb > 1000) add({ id: 'html-weight', category: 'speed', severity: 'medium', title: 'The page itself is unusually large', detail: `The page's HTML alone is ${(htmlKb / 1024).toFixed(1)} MB (most pages are under 100 KB), before any pictures or scripts load.`, fix: 'Lean pages with only the code each page needs.' });
  if (img.biggest && img.biggest.kb > 1500) add({ id: 'weight', category: 'speed', severity: 'medium', title: 'A photo is much larger than it needs to be', detail: `The largest image measured is ${(img.biggest.kb / 1024).toFixed(1)} MB (${img.biggest.src.split('/').pop()?.slice(0, 40)}).`, fix: 'Compressed, right-sized images (each under 250 KB).' });
  else if (pageKb > 3000) add({ id: 'weight', category: 'speed', severity: 'medium', title: 'The page downloads a lot of data', detail: `At least ${(pageKb / 1024).toFixed(1)} MB: ${counted}.${partial ? ' This is a lower bound.' : ''}`, fix: 'Compressed, right-sized images (each under 250 KB).' });
  else if (htmlKb <= 1000) ok(`${counted} (page weight is not fully measured)`);
  if (partial) unknown('page-weight', 'Total download size', `Not measured in full: only ${counted} were counted. Scripts, styles, fonts and ${Math.max(0, distinctImages - img.fetched)} image${distinctImages - img.fetched === 1 ? '' : 's'} were not. Google's PageSpeed result is the measure of total weight.`);
  const noDims = scan.images.filter((i) => !i.width || !i.height).length;
  // missing size attributes are a risk for layout shift, not layout shift: it is reported only if Google's test didn't measure it
  const dimsRisk = noDims >= 2 ? { id: 'img-dims', category: 'speed' as const, severity: 'low' as const, basis: 'heuristic' as const, title: 'Photos may shift the page as they load', detail: `${noDims} images don't declare their size, which can cause layout shift. Actual layout shift wasn't measured.`, fix: 'Reserved image space, no layout shift.' } : undefined;

  // ── SEO ──
  const titleTxt = (scan.title || '').trim();
  if (!titleTxt || /^(home|welcome|untitled|index|homepage)\b/i.test(titleTxt)) add({ id: 'title', category: 'seo', severity: 'high', title: 'Google sees a generic page title', detail: titleTxt ? `Title is just "${titleTxt}".` : 'The page has no title.', fix: `Title like "${b?.name || 'Business'} | ${b?.primaryTypeLabel || 'Service'} in ${b?.city || 'your city'}".` });
  else if (titleTxt.length > 65) add({ id: 'title-long', category: 'seo', severity: 'low', basis: 'suggestion', title: 'A shorter page title may display better in Google', detail: `The title is ${titleTxt.length} characters; Google usually shows about 60 and may rewrite longer ones. This is advice, not an error.`, fix: 'A title of about 50-60 characters.' });
  else ok('Has a descriptive title');
  if (!scan.description) add({ id: 'meta-desc', category: 'seo', severity: 'medium', title: 'No description for Google results', detail: 'Missing meta description, so Google picks random text.', fix: 'A clear one-line description with your city and services.' });
  else ok('Has a meta description');
  const h1s = $('h1');
  const h1Count = measured ? measured.h1 : h1s.length;
  if (!h1Count) add({ id: 'h1', category: 'seo', severity: 'medium', basis: measured ? 'measured' : 'heuristic', title: 'No main headline', detail: measured ? 'The page has no H1, even after its scripts ran.' : 'No H1 in the page source; if scripts add one after loading, this may not apply.', fix: 'One clear headline that says what you do and where.' });
  else if (/^welcome\b/i.test(h1s.first().text().trim())) add({ id: 'h1-generic', category: 'seo', severity: 'low', title: 'Headline doesn\'t say what you do', detail: `Headline is "${h1s.first().text().trim().slice(0, 60)}".`, fix: 'Headline with your service and city.' });
  const city = b?.city;
  if (city && !new RegExp(`\\b${city}\\b`, 'i').test(`${titleTxt} ${h1s.text()}`)) add({ id: 'local-seo', category: 'seo', severity: 'medium', title: `Google can't tell you work in ${city}`, detail: `"${city}" isn't in the title or headline.`, fix: `${city} in the title, headline and service-area section.` });
  // Many sites use a generic Organization but still give Google the address and hours; that counts.
  const hasSchema = /"@type"\s*:\s*"(LocalBusiness|HomeAndConstructionBusiness|RoofingContractor|Plumber|Electrician|HVACBusiness|GeneralContractor|ProfessionalService|PostalAddress|OpeningHoursSpecification)"/i.test(html);
  if (!hasSchema) add({ id: 'schema', category: 'seo', severity: 'medium', title: 'Missing local business data for Google', detail: 'No LocalBusiness structured data (schema.org).', fix: 'Structured data with your hours, address, phone and service area.' });
  else ok('Has LocalBusiness structured data');
  if (!opts.preview && /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) add({ id: 'noindex', category: 'seo', severity: 'critical', title: 'Your site is hidden from Google', detail: 'A noindex tag tells Google not to list it.', fix: 'Indexable pages and a sitemap.' });
  const origin = new URL(scan.finalUrl).origin;
  const [robots, sitemap] = opts.preview
    ? [{ ok: true, body: Buffer.from('') }, { ok: true, body: Buffer.from('<urlset>') }]
    : await Promise.all([fetchRaw(`${origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 50_000 }), fetchRaw(`${origin}/sitemap.xml`, { timeoutMs: 5000, maxBytes: 200_000 })]);
  if (!sitemap.ok || !/<urlset|<sitemapindex/i.test(sitemap.body.toString('utf8'))) add({ id: 'sitemap', category: 'seo', severity: 'low', title: 'No sitemap for Google', detail: '/sitemap.xml not found.', fix: 'Auto-generated sitemap.' });
  if (!robots.ok) add({ id: 'robots', category: 'seo', severity: 'low', title: 'No robots.txt', detail: '/robots.txt not found.', fix: 'Standard robots.txt pointing to the sitemap.' });
  // alt="" is how a page marks a decorative picture, and that is correct: only a missing alt attribute is a gap
  const noAlt = scan.images.filter((i) => i.alt === undefined && i.src && !/^data:/.test(i.src)).length;
  const decorative = scan.images.filter((i) => i.alt !== undefined && !i.alt.trim()).length;
  if (noAlt >= 1) add({ id: 'alt', category: 'seo', severity: 'low', title: 'Some photos have no alt text', detail: `${noAlt} of ${scan.images.length} images have no alt attribute at all${decorative ? ` (${decorative} more are marked decorative with an empty alt, which is fine)` : ''}.`, fix: 'Descriptive alt text on every informative photo.' });
  else if (decorative) ok(`Pictures that carry no information are marked decorative (${decorative} with an empty alt)`);
  const ogImg = $('meta[property="og:image"]').attr('content');
  if (!ogImg) add({ id: 'og', category: 'seo', severity: 'low', title: 'Links to your site look blank when shared', detail: 'No preview image (og:image) for iMessage, Facebook or texts.', fix: 'A branded share image so links show a rich preview.' });

  // ── conversion ──
  const tel = $('a[href^="tel:"]').length;
  if (!tel) add({ id: 'tel', category: 'conversion', severity: 'high', title: 'Phone number isn\'t tap-to-call', detail: 'No tel: link, so phone visitors have to copy the number.', fix: 'Tap-to-call button in the header and a sticky call bar on phones.' });
  else ok('Phone number is tap-to-call');
  const forms = $('form').filter((_, el) => $(el).find('input, textarea').length >= 2).length;
  const booking = /calendly|housecallpro|jobber|servicetitan|book(ing)?\s+(now|online)|schedule\s+(service|online|now)/i.test(html)
    // or a link to a quote / estimate / booking page ("Get a roof quote" → /roof-quote/, booking.example.com)
    || $('a[href]').filter((_, el) => /quote|estimate|\bbook(ing)?\b|schedul/i.test(`${$(el).attr('href')} ${$(el).text()}`)).length > 0; // \b: not facebook.com
  if (!forms && !booking) add({ id: 'form', category: 'conversion', severity: 'medium', title: 'No way to request a quote online', detail: 'No contact or estimate form found.', fix: 'Short quote form that texts you every new lead.' });
  else ok('Has a contact form or booking');
  const ctaRe = /\b(call now|get a (free )?(quote|estimate)|free (quote|estimate|inspection)|request (a )?(quote|estimate|service)|book|schedule)\b/i;
  const ctaEls = $('a, button').filter((_, el) => ctaRe.test($(el).text())).length;
  if (!ctaEls) add({ id: 'cta', category: 'conversion', severity: 'medium', title: 'No clear "call" or "get a quote" button', detail: 'Visitors aren\'t told what to do next.', fix: 'One obvious action button above the fold.' });
  if (!$('a[href^="sms:"]').length) add({ id: 'sms', category: 'conversion', severity: 'low', basis: 'suggestion', title: 'A "Text us" button could make contact easier', detail: 'The page has no text/SMS link. Many customers prefer texting.', fix: 'A "Text us" button that opens Messages.' });
  // analytics tools often load after the page opens, so not finding one in the HTML is not the same as there being none
  if (/googletagmanager|gtag\(|google-analytics|analytics\.js|plausible|fbq\(|clarity\.ms/i.test(html) || measured?.analytics) ok('Visitor analytics detected');
  else unknown('analytics', 'Visitor analytics', measured ? 'No analytics script loaded in a test visit. Some tools only load after a visitor accepts cookies, so this does not prove there is none.' : 'No analytics script was found in the page HTML. Tools that load after the page opens are not visible this way, so this could not be confirmed.');

  // ── trust / local consistency (vs Google Business) ──
  // a business known only from its own website has no separate Google record to compare against
  if (b && b.source !== 'website') {
    const gPhone = digits(b.phone).slice(-10);
    const sitePhones = scan.phones.map((p) => digits(p).slice(-10)).filter((p) => p.length === 10);
    if (gPhone && sitePhones.length && !sitePhones.includes(gPhone)) add({ id: 'nap-phone', category: 'trust', severity: 'high', title: 'Phone number doesn\'t match Google', detail: `Website shows ${scan.phones[0]}, Google shows ${b.phone}. Mismatches confuse customers and hurt local ranking.`, fix: 'Same name, address and phone everywhere.' });
    else if (gPhone && sitePhones.includes(gPhone)) ok('Phone matches Google');
    const gNum = b.street?.match(/^\d+/)?.[0];
    const siteStreets = [...text.matchAll(STREET_RE)].map((m) => m[0]);
    if (gNum && siteStreets.length && !siteStreets.some((s) => s.startsWith(gNum))) add({ id: 'nap-address', category: 'trust', severity: 'high', title: 'Address doesn\'t match Google', detail: `Website lists "${siteStreets[0]}", Google lists "${b.street}".`, fix: 'Address synced from your Google Business Profile.' });
    if ((b.rating || 0) >= 4.3 && (b.reviewCount || 0) >= 10 && !/\breview|testimonial|★|stars?\b/i.test(text)) add({ id: 'reviews', category: 'trust', severity: 'medium', title: `Your ${b.rating}★ Google rating isn't on your site`, detail: `${b.reviewCount} Google reviews, none shown on the website.`, fix: 'Your best Google reviews shown on the homepage.' });
    if (b.hours?.weekdayText?.length && !/\b(mon(day)?|hours|open)\b/i.test(text)) add({ id: 'hours', category: 'trust', severity: 'low', title: 'Business hours aren\'t listed', detail: 'Visitors can\'t tell when you\'re open.', fix: 'Hours with a live "Open now" badge.' });
  }
  const copy = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d\d|19\d\d)/gi)].map((m) => Number(m[1]));
  const lastYear = copy.length ? Math.max(...copy) : undefined;
  if (lastYear && lastYear < year - 1) add({ id: 'stale', category: 'trust', severity: 'medium', title: 'Site looks out of date', detail: `Footer says © ${lastYear}.`, fix: 'Fresh design that stays current automatically.' });
  const freeMail = scan.emails.find((e) => FREE_EMAIL.test(e));
  if (freeMail) add({ id: 'email', category: 'trust', severity: 'low', basis: 'suggestion', title: 'A business email address can look more established', detail: `The page shows ${freeMail}. That is common and not an error; some customers read it as less established.`, fix: 'A contact form, so customers never need your personal email.' });
  if (!$('link[rel~="icon"]').length) add({ id: 'favicon', category: 'trust', severity: 'low', title: 'No browser icon', detail: 'Missing favicon.', fix: 'Favicon from your logo.' });

  const ps = await psP;
  if (ps?.reportUrl) pageSpeedIssues(ps as PageSpeedResult, add, ok);
  const clsMeasured = (ps?.mobile ?? ps?.desktop)?.lab.clsValue;
  if (dimsRisk && clsMeasured === undefined) add(dimsRisk);
  else if (dimsRisk && clsMeasured !== undefined && clsMeasured <= 0.1) ok(`Google measured low layout shift (${clsMeasured}) although ${noDims} images don't declare a size`);
  if (!ps?.mobile && !ps?.desktop) unknown('pagespeed', 'Google speed and accessibility scores', ps?.error?.message || 'Google PageSpeed did not run for this page, so speed and accessibility are not measured here.');
  return finalize(scan, issues, passed, unknowns, { ttfbMs: scan.timing.ttfbMs, htmlKb, imageKb: img.kb, pageKb, images: scan.images.length, requestsSampled: img.sampled, imagesMeasured: img.fetched, measuredInBrowser: !!measured, pagespeed: ps }, b, opts.summarize);
}


/** Our own checks already cover these Lighthouse findings in owner-friendly words; don't list them twice. */
const COVERED = new Set(['document-title', 'meta-description', 'image-alt', 'robots-txt', 'is-crawlable', 'viewport', 'is-on-https', 'redirects-http', 'tap-targets']);
const titles = (fs: PsiFinding[], n = 3) => fs.slice(0, n).map((f) => `${f.title}${f.displayValue ? ` (${f.displayValue})` : ''}`).join('; ');
const sec = (ms?: number) => (ms ? `${(ms / 1000).toFixed(1)} s` : '');

/** Google's scores and failing checks, as issues in the owner's terms (mobile first: most visitors are on phones). */
function pageSpeedIssues(ps: PageSpeedResult, add: (i: Omit<AuditIssue, 'basis'> & { basis?: Basis }) => void, ok: (s: string) => void) {
  const m = ps.mobile;
  const d = ps.desktop;
  if (!m && !d) return;
  // each area uses the phone run when Google scored it there, otherwise the computer run
  const runFor = (c: PsiFinding['category']): PsiReport => (m?.scores[c] !== undefined ? m : d?.scores[c] !== undefined ? d : (m || d)!);
  const failingIn = (r: PsiReport, c: PsiFinding['category']) => r.findings.filter((f) => f.category === c && !COVERED.has(f.id));
  // ── speed ──
  let main = runFor('performance');
  let label = main.strategy;
  let failing = (c: PsiFinding['category']) => failingIn(main, c);
  const perf = main.scores.performance;
  if (perf !== undefined) {
    const savings = failing('performance').filter((f) => f.savingsMs || f.savingsKb).sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsKb ?? 0) - (a.savingsKb ?? 0));
    const field = main.field && main.field.overall === 'SLOW' ? ` Real visitors over the last 28 days also see it load slowly${main.field.lcpMs ? ` (main content after ${sec(main.field.lcpMs)})` : ''}.` : '';
    const detail = `Google PageSpeed ${perf}/100 on ${label}${label === 'mobile' && d?.scores.performance !== undefined ? `, ${d.scores.performance}/100 on desktop` : ''}${label === 'desktop' && m ? ' (Google could not score phones for this page)' : ''}${main.lab.lcp ? `; main content appears after ${main.lab.lcp}` : ''}.${field}${savings.length ? ` Biggest fixes: ${titles(savings)}.` : ''}`;
    if (perf < 50) add({ id: 'psi', category: 'speed', severity: 'high', title: `Google rates your ${label} speed as poor`, detail, fix: 'Lightweight pages that score 90+ on Google PageSpeed.' });
    else if (perf < 90) add({ id: 'psi', category: 'speed', severity: 'medium', title: `${label === 'mobile' ? 'Mobile' : 'Desktop'} speed could be better`, detail, fix: 'Lightweight pages that score 90+ on Google PageSpeed.' });
    else ok(`Google PageSpeed ${perf}/100 on ${label}`);
    if (main.lab.clsValue !== undefined && main.lab.clsValue > 0.25) add({ id: 'psi-cls', category: 'speed', severity: 'medium', title: 'The page jumps around while it loads', detail: `Layout shift ${main.lab.cls} (Google wants under 0.1). Visitors tap the wrong thing.`, fix: 'Reserved space for images and fonts, so nothing moves.' });
  }
  // ── accessibility ──
  main = runFor('accessibility'); label = main.strategy; failing = (c) => failingIn(main, c);
  const a11y = main.scores.accessibility;
  if (a11y !== undefined) {
    const f = failing('accessibility');
    const detail = `Google accessibility score ${a11y}/100.${f.length ? ` ${f.length} check${f.length === 1 ? '' : 's'} failed: ${titles(f)}.` : ''}`;
    if (a11y < 70) add({ id: 'psi-a11y', category: 'accessibility', severity: 'high', title: 'Hard to use for people with low vision or screen readers', detail, fix: 'Readable contrast, labelled buttons and forms, proper headings.' });
    else if (a11y < 90) add({ id: 'psi-a11y', category: 'accessibility', severity: 'medium', title: 'Some visitors will struggle to use your site', detail, fix: 'Readable contrast, labelled buttons and forms, proper headings.' });
    else ok(`Google accessibility ${a11y}/100`);
  }
  // ── best practices (security, browser errors, outdated code) ──
  main = runFor('best-practices'); label = main.strategy; failing = (c) => failingIn(main, c);
  const bp = main.scores['best-practices'];
  if (bp !== undefined) {
    const f = failing('best-practices');
    if (bp < 80) add({ id: 'psi-bp', category: 'security', severity: 'medium', title: 'Google flags problems with how the site is built', detail: `Best-practices score ${bp}/100.${f.length ? ` ${titles(f)}.` : ''}`, fix: 'Modern, secure code without browser errors.' });
    else if (bp < 100 && f.length) add({ id: 'psi-bp', category: 'security', severity: 'low', title: 'A few technical warnings from Google', detail: `Best-practices score ${bp}/100. ${titles(f)}.`, fix: 'Modern, secure code without browser errors.' });
    else ok(`Google best practices ${bp}/100`);
  }
  // ── search (only what our own SEO checks don't already say) ──
  main = runFor('seo'); label = main.strategy; failing = (c) => failingIn(main, c);
  const seo = main.scores.seo;
  if (seo !== undefined) {
    const f = failing('seo');
    if (seo < 90 && f.length) add({ id: 'psi-seo', category: 'seo', severity: seo < 70 ? 'high' : 'medium', title: 'Google\'s search check found problems', detail: `Google SEO score ${seo}/100. ${titles(f)}.`, fix: 'Pages built to Google\'s search guidelines.' });
    else if (seo >= 90) ok(`Google SEO ${seo}/100`);
  }
}

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

async function finalize(scan: WebsiteScan, issues: AuditIssue[], passed: string[], unknowns: AuditResult['unknowns'], metrics: AuditResult['metrics'], b?: Business, withSummary = true): Promise<AuditResult> {
  // measured faults first, then untested risks, then advice
  const BASIS_ORDER: Basis[] = ['measured', 'heuristic', 'suggestion'];
  issues.sort((a, c) => BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(c.basis) || SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(c.severity));
  // Exponential decay: a few small issues barely move the score; many serious ones push it down without hitting zero.
  // A risk that wasn't tested counts half, and advice counts nothing.
  const pen = (list: AuditIssue[]) => list.reduce((s, i) => s + PENALTY[i.severity] * WEIGHT[i.basis], 0);
  const score = Math.max(5, Math.round(100 * Math.exp(-pen(issues) / 110)));
  const categories = Object.fromEntries(CATS.map((c) => [c, Math.round(100 * Math.exp(-pen(issues.filter((i) => i.category === c)) / 40))])) as Record<Category, number>;
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  const summary = withSummary ? await summarize(scan, issues, passed, score, b) : { headline: `Scores ${score}/100.`, bullets: issues.filter((i) => i.basis !== 'suggestion').slice(0, 3).map((i) => i.title), pitch: '', source: 'template' as const };
  return { url: scan.url, finalUrl: scan.finalUrl, reachable: scan.ok, score, grade, categories, issues, passed, unknowns, metrics, summary, generatedAt: new Date().toISOString() };
}

function domainOf(u: string) {
  try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; }
}

async function summarize(scan: WebsiteScan, issues: AuditIssue[], passed: string[], score: number, b?: Business): Promise<AuditResult['summary']> {
  // advice isn't a finding: the message talks about measured faults and flagged risks only
  const found = issues.filter((i) => i.basis !== 'suggestion');
  const top = found.slice(0, 3);
  const built = b?.source === 'website' ? 'from your website' : 'from your Google profile and website';
  const ai = await claudeJson<{ headline: string; bullets: string[]; pitch: string }>({
    system:
      'You are Roger, a friendly assistant texting a small home-services business owner over iMessage. ' +
      'Write like a helpful person, not a marketer: short, specific, plain words, no jargon (say "tap-to-call" not "tel: link"), no emojis, no exclamation marks. ' +
      'Only mention problems present in the issues list. Never invent numbers. An issue with basis "heuristic" was not tested: say it "may" be a problem, never that it is one. Never mention suggestions. ' +
      'The offer to build a preview says it is built from the sources given in builtFrom, nothing else.',
    prompt: JSON.stringify({ business: b?.name, website: domainOf(scan.finalUrl), score, builtFrom: built, issues: found.slice(0, 8).map((i) => ({ title: i.title, detail: i.detail, severity: i.severity, basis: i.basis, fix: i.fix })), passed }),
    toolName: 'imessage_audit',
    toolDescription: 'The audit summary Roger will send in iMessage.',
    schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One sentence, under 110 characters, includes the score out of 100.' },
        // the score-card image lists issues[0..2], so the text must cover the same three in the same order
        bullets: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'The first 3 issues in the list, in the same order, each rewritten owner-friendly in under 80 characters.' },
        pitch: { type: 'string', description: 'One or two sentences offering to fix it with a new site, under 200 characters.' },
      },
      required: ['headline', 'bullets', 'pitch'],
    },
    maxTokens: 600,
  });
  if (ai) return { ...ai.data, bullets: ai.data.bullets.slice(0, 3), source: 'claude' };
  const dom = domainOf(scan.finalUrl);
  return {
    headline: scan.ok ? `I checked ${dom}. It scores ${score}/100.` : `I tried to open ${dom}, but it isn't loading right now.`,
    bullets: top.map((i) => (i.basis === 'heuristic' ? `${i.title} (not tested)` : i.title)),
    pitch: top.length ? `We can fix ${top.length > 1 ? 'all of this' : 'that'} with a fast new site built ${built}. Want to see a free preview?` : 'Your site is in good shape. Want a free preview of a refreshed version anyway?',
    source: 'template',
  };
}
