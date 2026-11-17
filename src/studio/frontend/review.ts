/**
 * The standard rendered-page review of a custom site version: every page at desktop (1440px) and phone (390px) widths in
 * a real browser. Counting credit elements is not enough: each Google photo's credit must have text, be displayed, sit
 * inside the photo's visible frame (the photo's box cut by every clipping ancestor and the viewport), and not be covered
 * by anything else. Also: no horizontal overflow, no broken images, the version's identity on the page, no page errors.
 *
 * Live by default (the page's real photos); `offline` answers every image request locally with a picture of the size the
 * page declares, so tests and checks run without the network.
 */
import { load } from 'cheerio';
import sharp from 'sharp';
import { launchBrowser, screenshotsAvailable } from '../../render/og.js';

export const REVIEW_WIDTHS = [1440, 390] as const;
export interface PageReview { page: string; width: number; pass: boolean; problems: string[]; /** accessibility findings for staff review (not blocking) */ notes?: string[]; credits: { required: number; visible: number }; overflow: boolean; brokenImages: number; version: string | null; pageErrors: number }
export interface SiteReview { at: string; pass: boolean; ran: boolean; pages: PageReview[]; problems: string[]; /** findings for staff review, not blocking: low contrast, skipped heading levels, small tap targets */ notes?: string[] }

type Browser = Awaited<ReturnType<typeof launchBrowser>>;

/** in the page: every Google photo's credit, and whether it can actually be seen inside its photo */
export const MEASURE = async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const clips = (el: Element) => { const cs = getComputedStyle(el); return /(hidden|clip|auto|scroll)/.test(`${cs.overflow} ${cs.overflowX} ${cs.overflowY}`) || cs.contain.includes('paint'); };
  document.documentElement.style.scrollBehavior = 'auto';
  const out: { photo: string; problem: string }[] = [];
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-gphoto]'));
  for (const img of imgs) {
    const photo = img.dataset.gphoto!;
    const credit = img.parentElement?.querySelector<HTMLElement>(':scope > .gcredit') ?? null;
    if (!credit || !(credit.textContent ?? '').trim()) { out.push({ photo, problem: 'has no credit' }); continue; }
    // bring the credit to the middle of the window by scrolling the window only: scrollIntoView would also scroll a
    // clipping frame (overflow:hidden boxes scroll programmatically) and reveal the very credit the frame hides
    scrollTo(0, Math.max(0, scrollY + credit.getBoundingClientRect().top - innerHeight / 2)); await sleep(30);
    // hidden by style anywhere up the tree
    let hiddenBy = '';
    for (let a: Element | null = credit; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.6) { hiddenBy = label(a); break; } }
    if (hiddenBy) { out.push({ photo, problem: `credit is hidden (by ${hiddenBy})` }); continue; }
    const c = credit.getBoundingClientRect(), i = img.getBoundingClientRect();
    if (c.width < 2 || c.height < 2) { out.push({ photo, problem: 'credit has no size' }); continue; }
    // the photo's visible frame: its box, cut by each clipping ancestor and the viewport's width
    let box = { l: i.left, t: i.top, r: i.right, b: i.bottom }, cutBy = '';
    for (let a = img.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (!clips(a)) continue;
      const r = a.getBoundingClientRect();
      const nb = { l: Math.max(box.l, r.left), t: Math.max(box.t, r.top), r: Math.min(box.r, r.right), b: Math.min(box.b, r.bottom) };
      if (nb.l !== box.l || nb.t !== box.t || nb.r !== box.r || nb.b !== box.b) cutBy ||= label(a);
      box = nb;
    }
    box = { ...box, l: Math.max(box.l, 0), r: Math.min(box.r, innerWidth) };
    if (box.r - box.l < 2 || box.b - box.t < 2) { out.push({ photo, problem: 'the photo itself is not visible' }); continue; }
    const tol = 1.5;
    if (c.left < box.l - tol || c.top < box.t - tol || c.right > box.r + tol || c.bottom > box.b + tol) {
      const inside = c.right > box.l && c.left < box.r && c.bottom > box.t && c.top < box.b;
      out.push({ photo, problem: inside ? `credit is clipped at the edge of the photo's visible frame${cutBy ? ` (cut by ${cutBy})` : ''}` : `credit is outside the photo's visible frame${cutBy ? ` (frame cut by ${cutBy})` : ''}` });
      continue;
    }
    // covered: what is actually on top at points along the credit's centre line (a tilted photo's credit is tilted too:
    // the corners of its bounding box lie outside the credit itself, on the photo, but its centre line stays inside it)
    const pts = [0.12, 0.3, 0.5, 0.7, 0.88].map((x) => [c.left + c.width * x, c.top + c.height / 2]);
    const over = pts.map(([x, y]) => document.elementFromPoint(x, y)).find((hit) => hit && hit !== credit && !credit.contains(hit));
    if (over) out.push({ photo, problem: `credit is covered by ${label(over)}` });
  }
  scrollTo(0, 0);
  return {
    credits: imgs.length, creditProblems: out,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    broken: Array.from(document.images).filter((im) => im.complete && im.naturalWidth === 0).length,
    version: document.querySelector('meta[name="roger-version"]')?.getAttribute('content') ?? null,
  };
};

/**
 * In the page: its links and accessibility. Blocking: a link that goes nowhere known (not this version's pages, an anchor
 * on the page, https, tel: or mailto:), a link without a name, an image without alt, no page language, not exactly one h1.
 * For staff review: text contrast under WCAG AA (4.5:1, or 3:1 for large text), skipped heading levels, and small tap
 * targets on a phone (under 24px tall, outside running text).
 */
export const AUDIT = (allowed: string[]) => {
  const problems: string[] = [], notes: string[] = [];
  const ids = new Set(Array.from(document.querySelectorAll('[id]')).map((e) => e.id));
  const short = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))) {
    const href = a.getAttribute('href') ?? '';
    const ok = /^(https:\/\/|tel:\+?[\d\s()-]+$|mailto:)/i.test(href) || (href.startsWith('#') && (href === '#' ? false : ids.has(decodeURIComponent(href.slice(1))))) || allowed.includes(href);
    if (!ok) problems.push(`link "${short(a.textContent) || href}" goes to ${href ? `"${href}", which is not a page of this version or a verified destination` : 'nothing (no address)'}`);
    if (!short(a.textContent) && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) problems.push(`a link to "${href}" has no name a screen reader can read`);
  }
  const noAlt = document.querySelectorAll('img:not([alt])').length;
  if (noAlt) problems.push(`${noAlt} image(s) have no alt text`);
  if (!document.documentElement.lang) problems.push('the page has no language set');
  const h1 = document.querySelectorAll('h1').length;
  if (h1 !== 1) problems.push(`the page has ${h1} h1 headings (one expected)`);
  const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => Number(h.tagName[1]));
  const skips = levels.filter((l, i) => i > 0 && l > levels[i - 1] + 1).length;
  if (skips) notes.push(`${skips} heading level(s) skipped`);
  // contrast: own text on the nearest solid background (text on a photo or gradient is not measured)
  const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const bgOf = (el: Element | null): number[] | null => {
    for (; el; el = el.parentElement) { const cs = getComputedStyle(el); if (/url\(/.test(cs.backgroundImage)) return null; const c = rgba(cs.backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.9) return c.slice(0, 3); /* (a gradient such as ruled lines over a solid colour reads as that colour) */ }
    return [255, 255, 255];
  };
  const low = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (el.closest('.gcredit,script,style') || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) < 0.6) continue;
    const bg = bgOf(el), fg = rgba(cs.color); if (!bg || fg.length < 3 || (fg[3] ?? 1) < 0.9) continue;
    const [a, b] = [lum(fg.slice(0, 3)), lum(bg)], ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) { const k = `"${short(el.textContent)}" ${ratio.toFixed(2)}:1`; low.set(k, (low.get(k) ?? 0) + 1); }
  }
  if (low.size) notes.push(`text below WCAG AA contrast: ${[...low.keys()].slice(0, 4).join('; ')}${low.size > 4 ? ` and ${low.size - 4} more` : ''}`);
  // text covered by a photo (a caption under an overlapping frame): sampled along each text's centre line, in view
  const y0 = scrollY;
  const covered = new Map<string, string>();
  const texts = Array.from(document.querySelectorAll<HTMLElement>('main *, header *, footer *')).filter((el) => !el.closest('.gcredit') && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())).slice(0, 500);
  for (const el of texts) {
    const r0 = el.getBoundingClientRect();
    if (r0.width < 2 || r0.height < 2 || getComputedStyle(el).visibility === 'hidden') continue;
    scrollTo(0, Math.max(0, scrollY + r0.top - innerHeight / 2));
    const r = el.getBoundingClientRect();
    for (const x of [0.25, 0.5, 0.75]) {
      const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height / 2);
      const photo = hit && !el.contains(hit) ? (hit.closest('img[data-photo]') as HTMLImageElement | null) ?? (hit.tagName === 'IMG' ? hit as HTMLImageElement : null) : null;
      if (photo) { covered.set(short(el.textContent), photo.dataset.photo ?? 'an image'); break; }
    }
  }
  scrollTo(0, y0);
  for (const [t, ph] of covered) problems.push(`the text "${t}" is covered by photo ${ph}`);
  if (innerWidth < 600) {
    const small = Array.from(document.querySelectorAll<HTMLElement>('a,button,summary')).filter((a) => { if (a.closest('.gcredit,p,li')) return false; const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 24; }).map((a) => `"${short(a.textContent)}" ${Math.round(a.getBoundingClientRect().height)}px`);
    if (small.length) notes.push(`tap targets under 24px tall on a phone: ${small.slice(0, 4).join('; ')}`);
  }
  return { problems, notes };
};

/**
 * Essential content (a photo, a name, an offering, text or an action) inside an element with a CSS mask or clip path:
 * each such element is rendered as it is and with its mask removed. If the content shows only without the mask, the
 * mask hides it. A shaped photo (a round or arched frame) still shows its photo, so it passes. Returns what is hidden.
 */
async function masksHidingContent(page: import('playwright-core').Page): Promise<string[]> {
  const found: { i: number; label: string }[] = await page.evaluate(() => {
    const out: { i: number; label: string }[] = [];
    const essential = 'img[data-photo], [data-fact], a[data-action], a[data-page], h1, h2, h3, h4, li, p, figcaption';
    let i = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const st = getComputedStyle(el);
      const masked = (st.maskImage && st.maskImage !== 'none') || ((st as unknown as Record<string, string>).webkitMaskImage ?? 'none') !== 'none' || st.clipPath !== 'none';
      if (!masked || el.tagName === 'IMG' && !el.matches('img[data-photo]')) continue;
      if (!el.matches(essential) && !el.querySelector(essential)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      el.setAttribute('data-roger-mask', String(i));
      const what = el.querySelector<HTMLImageElement>('img[data-photo]')?.dataset.photo ?? (el as HTMLImageElement).dataset?.photo;
      out.push({ i: i++, label: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0] || ''}${what ? ` (photo ${what})` : ''}: "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"` });
      if (i >= 30) break;
    }
    return out;
  });
  const hidden: string[] = [];
  // the same box three ways: as rendered, with the element hidden (only what is behind it), and with its mask removed.
  // Rendered like the background, while the unmasked element clearly differs from it: the mask hides the content.
  const raw = async (b: Buffer) => sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const diff = (x: { data: Buffer }, y: { data: Buffer }) => { if (x.data.length !== y.data.length) return Infinity; let d = 0; for (let k = 0; k < x.data.length; k++) d += Math.abs(x.data[k] - y.data[k]); return d / x.data.length; };
  const set = (loc: ReturnType<typeof page.locator>, props: Record<string, string> | null) => loc.evaluate((el: HTMLElement, p: Record<string, string> | null) => { for (const k of ['mask', '-webkit-mask', 'clip-path', 'visibility']) el.style.removeProperty(k); if (p) for (const [k, v] of Object.entries(p)) el.style.setProperty(k, v, 'important'); }, props);
  for (const f of found) {
    const loc = page.locator(`[data-roger-mask="${f.i}"]`);
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
      // one region of the window, measured once (an element screenshot would wait for a hidden element to show)
      const box = await loc.boundingBox();
      const vp = page.viewportSize();
      if (!box || !vp) continue;
      const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, vp.width - Math.max(0, box.x)), height: Math.min(box.height, vp.height - Math.max(0, box.y)) };
      if (clip.width < 8 || clip.height < 8) continue;
      const shot = async () => raw(await page.screenshot({ clip, timeout: 5000 }));
      const asIs = await shot();
      await set(loc, { visibility: 'hidden' });
      const behind = await shot();
      await set(loc, { mask: 'none', '-webkit-mask': 'none', 'clip-path': 'none' });
      const unmasked = await shot();
      await set(loc, null);
      if (diff(asIs, behind) < 3 && diff(unmasked, behind) > 12) hidden.push(f.label);
    } catch { /* an element that cannot be captured is left to staff review */ }
  }
  await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('[data-roger-mask]').forEach((e) => e.removeAttribute('data-roger-mask')); });
  return hidden;
}

/** load each image that failed again, and count those still broken */
export const RETRY_BROKEN = async () => {
  const bad = Array.from(document.images).filter((im) => im.complete && im.naturalWidth === 0);
  await Promise.all(bad.map((im) => new Promise((done) => {
    const t = setTimeout(done, 12000);
    im.addEventListener('load', () => { clearTimeout(t); done(0); }, { once: true });
    im.addEventListener('error', () => { clearTimeout(t); done(0); }, { once: true });
    const src = im.src; im.removeAttribute('src'); im.src = src;
  })));
  return Array.from(document.images).filter((im) => im.complete && im.naturalWidth === 0).length;
};

/** an image of the declared size, for offline checks (the layout depends only on its size) */
const blank = new Map<string, Buffer>();
async function imageOf(w: number, h: number): Promise<Buffer> {
  const k = `${w}x${h}`;
  if (!blank.has(k)) { const s = Math.min(1, 1600 / Math.max(w, h)); blank.set(k, await sharp({ create: { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), channels: 3, background: '#8a7' } }).jpeg().toBuffer()); }
  return blank.get(k)!;
}

export async function reviewPages(pages: { slug: string; html: string }[], opts: { version?: string; offline?: boolean; browser?: Browser; widths?: readonly number[]; /** this version's page addresses: the only internal links a page may have (unchecked when absent) */ links?: string[] } = {}): Promise<SiteReview> {
  const at = new Date().toISOString();
  if (!opts.browser && !screenshotsAvailable()) return { at, pass: false, ran: false, pages: [], problems: ['the rendered review could not run: no browser on this machine'] };
  const browser = opts.browser ?? await launchBrowser();
  const results: PageReview[] = [];
  try {
    for (const { slug, html } of pages) {
      // each image's declared size by its address, to answer requests offline
      const sizes = new Map<string, [number, number]>();
      const $ = load(html);
      $('img[src]').each((_, el) => { const w = Number($(el).attr('width')), h = Number($(el).attr('height')); if (w && h) sizes.set($(el).attr('src')!, [w, h]); });
      for (const width of opts.widths ?? REVIEW_WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await context.addInitScript('window.__name = (f) => f'); // a bundler's keep-names helper, absent in the page
        const page = await context.newPage();
        let pageErrors = 0; page.on('pageerror', () => pageErrors++);
        if (opts.offline) await page.route('**/*', async (route) => {
          const url = route.request().url(), size = sizes.get(url) ?? [...sizes].find(([u]) => url.endsWith(u))?.[1];
          if (route.request().resourceType() === 'image' && size) return route.fulfill({ contentType: 'image/jpeg', body: await imageOf(size[0], size[1]) });
          return route.abort();
        });
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: 45000 }).catch(() => undefined);
          await Promise.race([page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((im) => im.decode().catch(() => undefined))); }), new Promise((r) => setTimeout(r, 15000))]);
          const m = await page.evaluate(MEASURE);
          // an image that failed to load is asked for again (twice, up to 12 s each) before it counts as broken: a busy
          // image host drops some requests, and a version must not fail for that
          for (let t = 0; t < 2 && m.broken; t++) m.broken = await page.evaluate(RETRY_BROKEN);
          const audit = opts.links ? await page.evaluate(AUDIT, opts.links) : { problems: [], notes: [] };
          // essential content hidden by a CSS mask or clip path rejects the version
          if (opts.links) for (const h of await masksHidingContent(page)) audit.problems.push(`essential content is hidden by a CSS mask or clip path: ${h}`);
          const problems = [
            ...audit.problems,
            ...m.creditProblems.map((c) => `photo ${c.photo}: ${c.problem}`),
            ...(m.overflow ? ['the page scrolls sideways (horizontal overflow)'] : []),
            ...(m.broken ? [`${m.broken} image(s) did not load`] : []),
            ...(opts.version && m.version !== opts.version ? [`the page is not stamped with this version (${m.version ?? 'none'})`] : []),
            ...(pageErrors ? [`${pageErrors} script error(s) on the page`] : []),
          ];
          results.push({ page: slug, width, pass: !problems.length, problems, notes: audit.notes, credits: { required: m.credits, visible: m.credits - m.creditProblems.length }, overflow: m.overflow, brokenImages: m.broken, version: m.version, pageErrors });
        } catch (e) {
          results.push({ page: slug, width, pass: false, problems: [`the page could not be reviewed: ${(e as Error).message.split('\n')[0]}`], credits: { required: 0, visible: 0 }, overflow: false, brokenImages: 0, version: null, pageErrors });
        } finally { await context.close(); }
      }
    }
  } finally { if (!opts.browser) await browser.close(); }
  const problems = results.flatMap((r) => r.problems.map((p) => `${r.page} at ${r.width}px: ${p}`));
  const notes = [...new Set(results.flatMap((r) => (r.notes ?? []).map((n) => `${r.page} at ${r.width}px: ${n}`)))];
  return { at, pass: !problems.length, ran: true, pages: results, problems, notes };
}
