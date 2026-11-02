import { screenshotsAvailable, launchBrowser } from '../render/og.js';
import { BRAND_SAMPLER, type RawBrand } from './brand-profile.js';

/**
 * A page as visitors see it once its scripts have run: for sites that build their content in the browser, or load
 * photos only as they scroll into view. Needs the same Chromium the screenshots use; reports why it can't run.
 */
export async function renderPage(url: string, opts: { timeoutMs?: number } = {}): Promise<{ ok: boolean; html?: string; ms: number; error?: string }> {
  const started = Date.now();
  if (!screenshotsAvailable()) return { ok: false, ms: 0, error: 'no browser available on this server' };
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    // pictures and scripts are needed (lazy photos load on scroll); fonts and media streams are not
    await page.route('**/*', (r) => (['font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 25_000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    // scroll through the page so lazy images and sections are requested
    await page.evaluate(async () => {
      const step = Math.max(400, window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight && y < 30_000; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 140));
      }
      window.scrollTo(0, 0);
      // write the address the browser chose for each image back into the markup
      for (const img of Array.from(document.images)) if (img.currentSrc) img.setAttribute('src', img.currentSrc);
    });
    await page.waitForTimeout(400);
    return { ok: true, html: await page.content(), ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: (e as Error).message.split('\n')[0] };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** What a phone-sized browser sees on a page: measured, not guessed from the HTML. */
export interface PageMeasure { h1: number; innerWidth: number; scrollWidth: number; imagesWithoutSize: number; images: number; analytics: boolean; ms: number }

/** Open the page at phone width and measure it. undefined when no browser is available or the page can't be opened. */
export async function measurePage(url: string, opts: { timeoutMs?: number } = {}): Promise<PageMeasure | undefined> {
  if (!screenshotsAvailable()) return undefined;
  const started = Date.now();
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const scripts: string[] = [];
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
    await page.route('**/*', (r) => (['font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 25_000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    const m = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      images: document.images.length,
      imagesWithoutSize: Array.from(document.images).filter((i) => !i.getAttribute('width') && !i.getAttribute('height') && !i.style.width && !i.style.aspectRatio).length,
    }));
    const analytics = scripts.some((u) => /googletagmanager|google-analytics|gtag|plausible|clarity\.ms|connect\.facebook|fbevents|hotjar|segment|mixpanel|wix\.com\/.*(analytics|bi)|\/wix-analytics|frog\.wix/i.test(u));
    return { ...m, analytics, ms: Date.now() - started };
  } catch {
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** How the page is styled as a browser renders it (colours by use, buttons, typefaces). undefined without a browser. */
export async function measureBrand(url: string, opts: { timeoutMs?: number } = {}): Promise<RawBrand | undefined> {
  if (!screenshotsAvailable()) return undefined;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (['media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 25_000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    await page.evaluate('(async()=>{for(let y=0;y<document.documentElement.scrollHeight&&y<30000;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,90))}window.scrollTo(0,0)})()');
    return (await page.evaluate(BRAND_SAMPLER)) as RawBrand;
  } catch {
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
