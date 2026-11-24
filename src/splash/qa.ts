/**
 * Step 9 of the spec: the checks a splash page passes before it is returned, reported as {passed, fixed, needs_human}.
 * Checks of the served HTML (facts, photos, Google attribution, phone links, JSON-LD, watch-outs, focus styles), checks
 * in a real browser (the first screen at 390 x 844, JavaScript off, reduced motion, layout shift, dock target sizes)
 * and every link-out. What Roger can fix it fixes (a dead link to the business's own page is removed); what it cannot
 * goes to needs_human, in words staff can act on. The rendered review's findings are folded in.
 */
import { load, type CheerioAPI } from 'cheerio';
import { launchBrowser, screenshotsAvailable } from '../render/og.js';
import { fetchRaw, type FetchOpts, type FetchResult } from '../util/http.js';
import { cityOf, NEVER_INFER_COPY, SUPERLATIVE } from './build.js';
import { isPublicUrl } from './images.js';
import { tradeRow } from './playbook.js';
import type { SplashJob } from './jobs.js';

export interface SplashQa {
  at: string; passed: string[]; fixed: string[]; needs_human: string[];
  /** link-outs that did not resolve (removed from the page where Roger can) */
  deadLinks: string[];
  /** of needs_human, what makes the page wrong or non-compliant (an unsourced fact or claim, a wrong phone link, missing
   *  Google attribution, invalid JSON-LD, an image that is not the business's): such a page is never sent to a customer.
   *  Everything else in needs_human is for staff to improve over time and never holds a preview back. */
  blocking?: string[];
}
export interface QaOpts { browser?: false; links?: false; fetch?: (url: string, opts: FetchOpts) => Promise<FetchResult> }

type Browser = Awaited<ReturnType<typeof launchBrowser>>;
const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const factText = (job: SplashJob, field: string) => { const v = job.plan?.fact_sheet.find((f) => f.field === field)?.value; return Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]; };
/** a check's result: its line in passed, or (made only then) its line in needs_human */
const check = (qa: SplashQa) => (cond: boolean, pass: string, fail: string | (() => string), blocks = false) => {
  if (cond) { qa.passed.push(pass); return; }
  const why = typeof fail === 'function' ? fail() : fail;
  qa.needs_human.push(why);
  if (blocks) (qa.blocking ??= []).push(why);
};
const BLOCK = 'p,li,dd,dt,td,th,div,figcaption,blockquote,h1,h2,h3,h4,h5,h6,section,header,footer,aside,article,main';

/** the page's own words: not facts, Google content, Roger's dock, sheet, footer links, credits or scripts */
function ownWords($: CheerioAPI): string {
  const c = $('body').clone();
  c.find('[data-fact],[data-google],.rg-dock,.rg-sheet,.rg-footer-links,.rk-footer,.rg-ribbon,.g-reviews,.g-src,.gcredit,script,style,noscript').remove();
  return c.text().replace(/\s+/g, ' ').trim();
}

export async function splashQa(job: SplashJob, html: string, opts: QaOpts = {}): Promise<SplashQa> {
  const qa: SplashQa = { at: new Date().toISOString(), passed: [], fixed: [], needs_human: [], deadLinks: [] };
  const ok = check(qa);
  const $ = load(html);
  const row = tradeRow(job.plan?.trade.row ?? 'generic');
  const own = ownWords($);

  // ── what Roger fixed on the way ──
  for (const r of job.repairs ?? []) qa.fixed.push(`The first draft was repaired: ${r.slice(0, 220)}`);
  for (const r of job.motionRepairs ?? []) qa.fixed.push(`Motion: ${r}`);
  for (const r of job.copyRepairs ?? []) qa.fixed.push(r);
  const mo = job.code?.motion;
  if (mo?.hero) qa.passed.push(`Motion chosen: hero ${mo.hero.treatment}${mo.section ? `, #${mo.section.screen} ${mo.section.treatment}` : ''}${mo.hero.reason ? ` (${mo.hero.reason.slice(0, 160)})` : ''}.`);
  for (const m of job.plan?.screen_plan.merged ?? []) qa.fixed.push(`The ${m.screen} screen was folded into ${m.into} (${m.reason}).`);
  for (const d of job.plan?.screen_plan.dropped ?? []) qa.fixed.push(`The ${d.screen} screen was left out (${d.reason}).`);
  const held = (job.withheld ?? []).filter((d) => d.action === 'withhold'), flagged = (job.withheld ?? []).filter((d) => d.action === 'review');
  if (held.length) qa.fixed.push(`${held.length} photo(s) held back by the photo rules (${[...new Set(held.map((d) => d.reason))].slice(0, 3).join('; ')}).`);
  for (const d of flagged) qa.needs_human.push(`Photo ${d.id} needs a look before it is used: ${d.reason}.`);
  if (job.fonts?.missing.length) qa.fixed.push(`Font(s) not available to serve: ${job.fonts.missing.join(', ')}; the page uses its fallback font stack.`);
  if (job.photosUnavailable?.length) qa.needs_human.push(`Roger could not fetch ${job.photosUnavailable.length} photo(s) from the business's website; visitors' browsers load them from the website directly. Check they appear: ${job.photosUnavailable.join(', ')}.`);

  // ── facts ──
  const bound = $('[data-fact]').toArray().map((e) => $(e).attr('data-fact')!);
  const unknown = bound.filter((k) => !(k in (job.input?.facts ?? {})));
  const numbers = own.match(/[^.!?]{0,30}\d[^.!?]{0,30}/);
  ok(!unknown.length && !numbers, `Every fact on the page comes from the fact sheet (${new Set(bound).size} bound facts; no numbers in the page's own words).`,
    () => unknown.length ? `Facts on the page with no fact-sheet entry: ${unknown.join(', ')}.` : `A number in the page's own words, not from the fact sheet: "${numbers![0].trim()}".`, true);

  // ── photos: the business's own, or Google's with credit ──
  const imgs = $('body img').toArray().filter((e) => !$(e).closest('.rg-dock,.g-review').length);
  const unbound = imgs.filter((e) => !['data-photo', 'data-gphoto', 'data-logo'].some((a) => $(e).attr(a) !== undefined));
  const website = imgs.filter((e) => $(e).attr('data-photo') !== undefined).length, google = $('img[data-gphoto]').length;
  ok(!unbound.length, `No stock or generated images: ${website} photo(s) from the business's own website, ${google} from its Google listing.`, `${unbound.length} image(s) are not the business's own photos.`, true);

  // ── reviews and Google attribution ──
  const reviews = $('.g-review').toArray();
  const reviewProblems: string[] = [];
  if (reviews.length) {
    if (!/Selected reviews/.test($('.g-reviews__label').text())) reviewProblems.push('the reviews are not labelled "Selected reviews"');
    if (reviews.some((r) => !$(r).find('[data-google$=".author"]').text().trim())) reviewProblems.push('a review has no author');
    if (reviews.some((r) => !$(r).find('a[data-google$=".maps_uri"]').length)) reviewProblems.push('a review has no link to Google Maps');
    if (!/Google Maps/.test($('.g-reviews__how').text())) reviewProblems.push('the reviews have no Google attribution');
  }
  const slots = $('[data-google="rating"],[data-google="review_count"],[data-google="open_now"],[data-google="hours_today"]').toArray();
  const bare = slots.filter((s) => !$(s).closest('.g-reviews').length && !$(s).parent().closest(BLOCK).find('.g-src').length);
  if (bare.length) reviewProblems.push(`${bare.length} piece(s) of Google content without attribution`);
  const uncredited = $('img[data-gphoto]').toArray().filter((e) => { const c = $(`[data-gcredit-for="${$(e).attr('data-gcid') ?? ''}"]`).add($(e).siblings('.gcredit')); return !/Google Maps/.test(c.text()); });
  if (uncredited.length) reviewProblems.push(`${uncredited.length} Google photo(s) without the photographer's credit`);
  ok(!reviewProblems.length, `Reviews are verbatim, attributed and labelled (${reviews.length} shown); Google attribution is beside every piece of Google content.`, `Google content: ${reviewProblems.join('; ')}.`, true);

  // ── phone links ──
  const phone = digits(factText(job, 'phone')[0] ?? '');
  const phoneLinks = $('a[href^="tel:"],a[href^="sms:"]').toArray().map((e) => $(e).attr('href')!);
  const wrong = phoneLinks.filter((h) => digits(h.replace(/^(tel|sms):/, '').split('?')[0]) !== phone);
  ok(!wrong.length, phoneLinks.length ? `${phoneLinks.length} call and text link(s) go to the business's number (no Roger number exists yet).` : 'No call or text links (no phone number).', `Call or text links that do not match the business's number: ${wrong.join(', ')}.`, true);

  // ── JSON-LD and indexing ──
  const ldProblems: string[] = [];
  let ld: Record<string, unknown> | undefined;
  try { ld = JSON.parse($('script[type="application/ld+json"]').first().text()); } catch { ldProblems.push('it is not valid JSON'); }
  if (ld) {
    if (ld['@context'] !== 'https://schema.org') ldProblems.push('no schema.org context');
    if (ld['@type'] !== row.schemaType) ldProblems.push(`its type is ${String(ld['@type'])}, not ${row.schemaType}`);
    if (!ld.name) ldProblems.push('no name');
    if ('aggregateRating' in ld || 'review' in ld) ldProblems.push('it marks up the business\'s own reviews');
  }
  const preview = $('.rg-ribbon').length > 0;
  if (preview && !/noindex/.test($('meta[name="robots"]').attr('content') ?? '')) ldProblems.push('the preview is not noindex');
  if (preview && $('link[rel="canonical"]').length) ldProblems.push('the preview has a canonical link');
  ok(!ldProblems.length, `JSON-LD is valid (${row.schemaType}, no review markup)${preview ? '; the preview is noindex with no canonical' : ''}.`, `JSON-LD and indexing: ${ldProblems.join('; ')}.`, true);

  // ── watch-outs ──
  const stated = new Set(job.plan?.fact_sheet.map((f) => f.field) ?? []);
  const claims = [own.match(SUPERLATIVE)?.[0], ...NEVER_INFER_COPY.filter(([f]) => !stated.has(f)).map(([, re]) => own.match(re)?.[0])].filter(Boolean);
  ok(!claims.length, `The trade's watch-outs are honoured (${row.label}: no superlatives, nothing claimed that the business has not stated).`, `Claims the business never made, in the page's own words: ${claims.map((c) => `"${c}"`).join(', ')}.`, true);
  const css = $('style').text();
  ok(!/outline\s*:\s*(none|0)\b/i.test(job.code?.css ?? '') || /:focus-visible/.test(job.code?.css ?? ''), 'Focus is visible on every control.', 'The page\'s styles remove the focus outline without a :focus-visible replacement.');
  ok(/prefers-reduced-transparency/.test(css) && !$('video').length, 'Reduced transparency is respected (the dock turns solid); there is no video.', 'The dock\'s reduced-transparency rule is missing.');

  // ── the rendered review (1440 and 390) ──
  for (const p of job.review?.problems ?? []) qa.needs_human.push(`Rendered check: ${p}.`);
  for (const n of job.review?.notes ?? []) qa.needs_human.push(`Accessibility: ${n}.`);
  if (job.review?.ran && !job.review.problems.length) qa.passed.push('The page renders cleanly at 1440 and 390 px: photo credits visible, no overflow, no broken images, one h1.');

  // ── in a browser ──
  if (opts.browser !== false && screenshotsAvailable()) {
    const browser = await launchBrowser();
    try {
      const limit = new Promise<'late'>((r) => setTimeout(() => r('late'), 180_000));
      if (await Promise.race([browserChecks(browser, job, html, row, qa), limit]) === 'late') qa.needs_human.push('The in-browser checks did not finish within 3 minutes; check the page by hand.');
    } finally { await browser.close().catch(() => undefined); }
  }

  // ── link-outs ──
  if (opts.links !== false) await linkChecks($, qa, opts);
  return qa;
}

const KEY_PARTS: [RegExp, string, string][] = [
  [/hours|open now/i, '[data-google="open_now"],[data-google="hours_today"],[data-fact="hours"]', "today's hours"],
  [/call/i, 'a[href^="tel:"]', 'a call button'],
  [/appointment|booking|book/i, 'a[data-action="book"],a[data-event="dock_book"]', 'a booking button'],
  [/order/i, 'a[data-action="order"],a[data-event="dock_order"]', 'an order button'],
  [/directions/i, 'a[data-action="directions"],a[data-event="dock_directions"]', 'directions'],
];

async function browserChecks(browser: Browser, job: SplashJob, html: string, row: ReturnType<typeof tradeRow>, qa: SplashQa) {
  const ok = check(qa);
  const open = async (o: { width: number; height?: number; js?: boolean; reducedMotion?: 'reduce' }) => {
    const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height ?? 844 }, javaScriptEnabled: o.js !== false, reducedMotion: o.reducedMotion ?? 'no-preference' });
    await ctx.addInitScript('window.__name = (f) => f; window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}');
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 45000 }).catch(() => undefined);
    await page.waitForTimeout(1600); // the hero's entrance has finished
    return { page, close: () => ctx.close() };
  };

  // the first screen at 390 x 844
  {
    const { page, close } = await open({ width: 390, height: 844 });
    const city = cityOf(factText(job, 'address')[0] ?? '');
    const towns = [city, ...(factText(job, 'service_area')[0] ?? '').split(/,|\n/).map((t) => t.trim())].filter(Boolean);
    const keys = KEY_PARTS.filter(([re]) => re.test(row.firstScreen));
    const r = await page.evaluate(`(() => {
      const dock = document.querySelector('.rg-dock'); const dockTop = dock ? dock.getBoundingClientRect().top : innerHeight;
      const seen = (el) => { if (!el) return false; const b = el.getBoundingClientRect(), cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight && cs.visibility !== 'hidden' && +cs.opacity > 0.5; };
      const above = (el) => seen(el) && el.getBoundingClientRect().bottom <= dockTop;
      const headline = document.querySelector('[data-copy="headline"]') || document.querySelector('h1');
      const text = [...document.querySelectorAll('header *, #hero *')].filter((e) => !e.children.length && above(e)).map((e) => e.textContent).join(' ');
      const main = (document.querySelector('.rg-main') || {}).dataset?.event?.replace('dock_', '');
      const heroMain = main && [...document.querySelectorAll('#hero a[data-action="' + main + '"]')].some(above);
      const keys = ${JSON.stringify(keys.map(([, sel, what]) => [sel, what]))}.map(([sel, what]) => [what, [...document.querySelectorAll(sel)].some((e) => e.closest('.rg-dock') ? seen(e) : above(e))]);
      return { headline: above(headline), text, main, heroMain, dockMain: seen(document.querySelector('.rg-main')), keys };
    })()`) as { headline: boolean; text: string; main?: string; heroMain: boolean; dockMain: boolean; keys: [string, boolean][] };
    const where = !towns.length || towns.some((t) => r.text.toLowerCase().includes(t.toLowerCase()));
    const missing = [!r.headline && 'what they do (the headline)', !where && `where (${towns[0]})`, !(r.heroMain || r.dockMain) && 'the main action', ...r.keys.filter(([, s]) => !s).map(([w]) => w)].filter(Boolean);
    ok(!missing.length, `At 390 x 844 the first screen shows what they do, where, ${r.keys.map(([w]) => w).join(', ') || 'the key answer'} and the main action (${r.main ?? 'none'}${r.heroMain ? ', on the page and in the dock' : ', in the dock'}).`,
      `At 390 x 844 the first screen does not show: ${missing.join(', ')}.`);
    await close();
  }

  // the first screen on a desktop (1440 x 900): the headline and the hero's own main action above the fold
  {
    const { page, close } = await open({ width: 1440, height: 900 });
    const r = await page.evaluate(`(() => {
      const fits = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= innerHeight; };
      const main = (document.querySelector('.rg-main') || {}).dataset?.event?.replace('dock_', '');
      const acts = [...document.querySelectorAll('#hero a[data-action]')];
      return { headline: fits(document.querySelector('[data-copy="headline"]') || document.querySelector('h1')), action: acts.length ? acts.some(fits) : null, main };
    })()`) as { headline: boolean; action: boolean | null; main?: string };
    const missing = [!r.headline && 'the headline', r.action === false && 'the hero\'s buttons'].filter(Boolean);
    ok(!missing.length, 'At 1440 x 900 the first screen shows the headline and the hero\'s buttons.', `At 1440 x 900 the first screen cuts off: ${missing.join(' and ')} (below the fold).`);
    await close();
  }

  // JavaScript off: every screen readable, the form and the actions work without it
  {
    const { page, close } = await open({ width: 390, js: false });
    // (no timers run in a page without JavaScript: the scrolling is done from here, and each read is immediate)
    const hidden: string[] = [];
    const sections = page.locator('main section[data-screen]');
    for (let i = 0, n = await sections.count(); i < n; i++) {
      const s = sections.nth(i);
      await s.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      const r = await s.evaluate(`(s) => { const h = s.querySelector('h1,h2'); if (!h) return ''; const cs = getComputedStyle(h), b = h.getBoundingClientRect(); return b.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.9 ? '' : s.dataset.screen; }`, undefined, { timeout: 5000 }).catch(() => '(unreadable)') as string;
      if (r) hidden.push(r);
    }
    if (!(await page.locator('#quote form[action]').count()) && (await page.locator('#quote').count())) hidden.push('the quote form');
    ok(!hidden.length, 'The page reads fully with JavaScript off (every screen visible; the quote form posts without it).', `With JavaScript off, not readable: ${hidden.join(', ')}.`);
    await close();
  }

  // reduced motion: nothing moves, everything shows
  {
    const { page, close } = await open({ width: 390, reducedMotion: 'reduce' });
    const r = await page.evaluate(`(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      const moving = document.getAnimations().filter((a) => a.playState === 'running').length;
      const hidden = [...document.querySelectorAll('main section[data-screen] :is(h1,h2)')].filter((h) => +getComputedStyle(h).opacity < 0.9).length;
      return { moving, hidden };
    })()`) as { moving: number; hidden: number };
    ok(!r.moving && !r.hidden, 'Reduced motion is respected: nothing moves and every screen shows.', `With reduced motion: ${r.moving} animation(s) still run, ${r.hidden} heading(s) hidden.`);
    await close();
  }

  // layout shift (images and fonts) and dock targets, at both widths
  const shifts: string[] = [], small: string[] = [];
  for (const width of [390, 1440]) {
    const { page, close } = await open({ width, height: width === 390 ? 844 : 900 });
    const r = await page.evaluate(`(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
      await new Promise((r) => setTimeout(r, 500));
      const targets = [...document.querySelectorAll('.rg-dock a, .rg-dock button')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none'; })
        .map((e) => { const b = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.trim() || e.className, Math.round(Math.min(b.width, b.height))]; });
      return { cls: window.__cls || 0, targets };
    })()`) as { cls: number; targets: [string, number][] };
    if (r.cls >= 0.1) shifts.push(`${width} px: ${r.cls.toFixed(3)}`);
    for (const [name, size] of r.targets) if (size < 44) small.push(`${name} (${size} px at ${width})`);
    await close();
  }
  ok(!shifts.length, 'Images and fonts cause no layout shift (CLS under 0.1 at 390 and 1440 px).', `Layout shift above 0.1: ${shifts.join('; ')}.`);
  ok(!small.length, 'Every dock target is 44 px or larger.', `Dock targets under 44 px: ${small.join(', ')}.`);
}

/** every link-out: dead links to the business's own pages are removed; dead action links go to a human */
async function linkChecks($: CheerioAPI, qa: SplashQa, opts: QaOpts) {
  const SKIP = /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.apple\.com|www\.google\.com\/search)/;
  const links = new Map<string, string>();
  $('a[href^="http"]').each((_, e) => {
    const href = $(e).attr('href')!;
    if (SKIP.test(href) || $(e).closest('.g-reviews,.gcredit,.g-src').length) return;
    links.set(href, $(e).closest('.rg-footer-links').length ? 'footer' : $(e).hasClass('rg-svc-link') ? 'service' : $(e).attr('data-action') || $(e).attr('data-event') || 'link');
  });
  const dead: [string, string, string][] = [];
  const queue = [...links];
  await Promise.all([0, 1, 2, 3].map(async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [url, kind] = item;
      const get = () => (opts.fetch ?? fetchRaw)(url, { timeoutMs: 10000, maxBytes: 60_000, allow: (u) => isPublicUrl(u) });
      let r = await get();
      if (r.status === 0) r = await get();
      // a server that answers at all, even "forbidden" to a robot, is there; missing pages and failures are not
      if (r.status === 0 || r.status === 404 || r.status === 410 || r.status >= 500) dead.push([url, kind, r.status ? `HTTP ${r.status}` : (r.error ?? 'no answer')]);
    }
  }));
  for (const [url, kind, why] of dead) {
    if (kind === 'footer' || kind === 'service') { qa.deadLinks.push(url); qa.fixed.push(`Removed a dead link to ${url} (${why}).`); }
    else qa.needs_human.push(`The ${kind.replace(/^(cta|dock)_/, '')} link ${url} does not resolve (${why}).`);
  }
  if (!dead.length) qa.passed.push(`Every link-out resolves (${links.size} checked).`);
  else if (dead.length < links.size) qa.passed.push(`${links.size - dead.length} of ${links.size} link-outs resolve.`);
}
