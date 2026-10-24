// QA helper: full-page desktop + phone screenshots of a URL.  npx tsx scripts/shots.ts <url> <outPrefix>
import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
for (const [name, vp, mobile] of [['desktop', { width: 1366, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]] as const) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('http://localhost') ? r.continue() : r.abort()));
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}' });
  // scroll through so lazy images load, then back to top
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-${name}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
