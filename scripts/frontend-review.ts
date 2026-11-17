/** Read-only local review. No AI, regeneration or publication. Screenshots stay outside the project. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { launchBrowser } from '../src/render/og.js';
import { getFrontendJob } from '../src/studio/frontend/jobs.js';

const id = process.argv[2];
if (!/^fe_[a-z0-9]+$/.test(id ?? '')) throw new Error('Usage: node --import tsx scripts/frontend-review.ts fe_<id>');
const job = await getFrontendJob(id);
if (!job?.previewUrl || job.status !== 'needs-review') throw new Error('No completed custom homepage for this job.');
const base = new URL(process.env.FRONTEND_REVIEW_ORIGIN || 'http://localhost:4000');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('This pilot review is local-only.');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-frontend-review-'));
const browser = await launchBrowser();
const reports: unknown[] = [];
let failed = false;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1,
      ...(config.studioPassword ? { httpCredentials: { username: config.studioUser, password: config.studioPassword } } : {}) });
    const page = await context.newPage();
    let pageErrors = 0; page.on('pageerror', () => pageErrors++);
    const response = await page.goto(new URL(job.previewUrl, base).href, { waitUntil: 'networkidle', timeout: 60000 });
    if (!response?.ok()) throw new Error(`Preview returned HTTP ${response?.status()}`);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {}))); });
    const metrics = await page.evaluate(({ facts, photoCount, actionCount }) => {
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; };
      const missingFacts = facts.filter((key) => !Array.from(document.querySelectorAll('[data-fact]')).some((el) => el.getAttribute('data-fact') === key && visible(el) && !!el.textContent?.trim()));
      const photos = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-photo]'));
      const brokenImages = Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).length;
      const badAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).filter((a) => !document.getElementById(a.hash.slice(1))).length;
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, missingFacts, brokenImages, badAnchors,
        missingPhotos: photoCount > 0 && !photos.some((img) => visible(img) && img.naturalWidth > 0),
        missingActions: actionCount > 0 && !Array.from(document.querySelectorAll('a[data-action]')).some(visible),
        height: document.documentElement.scrollHeight };
    }, { facts: ['name', 'address', 'hours', 'rating'].filter((k) => !!job.input.facts[k]), photoCount: job.input.photos.length, actionCount: job.input.actions.length });
    const pass = !metrics.overflow && !metrics.missingFacts.length && !metrics.brokenImages && !metrics.badAnchors && !metrics.missingPhotos && !metrics.missingActions && !pageErrors;
    failed ||= !pass;
    // Tiled captures avoid Chromium's long-page screenshot height limit.
    const tiles = Math.ceil(metrics.height / 900);
    for (let tile = 0; tile < tiles; tile++) {
      await page.evaluate((y) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, y); }, tile * 900);
      await page.screenshot({ path: path.join(folder, `${width}-${tile + 1}.png`) });
    }
    reports.push({ width, pass, ...metrics, pageErrors, screenshotTiles: tiles });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ id, screenshots: folder, reports, note: 'Review the screenshots, copy, contrast, logo/colour preservation and actions manually. These checks do not approve visual quality or publication. Delete temporary screenshots after review.' }, null, 2));
if (failed) process.exitCode = 1;
