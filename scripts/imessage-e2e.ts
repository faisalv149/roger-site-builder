// End-to-end check of the iMessage demo page (server must be running):  npm run e2e:imessage
// Walks the Summit Peak conversation (mock data) to the site preview, screenshots desktop / phone / dark,
// and fails on page errors, "Not Delivered", or a "something went wrong" reply.
import { chromium, type Page } from 'playwright-core';
import { config } from '../src/config.js';
const out = process.argv[2] || 'out/qa/imessage';
const base = 'http://localhost:4000/imessage/';
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
const problems: string[] = [];

async function say(page: Page, how: { chip?: string; type?: string }) {
  if (how.chip) await page.click(`#suggest button:text-is("${how.chip}")`);
  else { await page.fill('#text', how.type!); await page.press('#text', 'Enter'); }
  await page.waitForSelector('body:not([data-busy])', { timeout: 180_000 });
}

async function run(name: string, opts: { viewport: { width: number; height: number }; colorScheme: 'light' | 'dark'; isMobile?: boolean }) {
  const ctx = await browser.newContext({ ...opts, hasTouch: !!opts.isMobile, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`));
  await page.goto(base, { waitUntil: 'load' });
  const t0 = Date.now();
  await say(page, { chip: 'Hi Roger' });
  await say(page, { type: 'Summit Peak Roofing 78704' });
  await say(page, { chip: "Yes, that's me" });
  await say(page, { chip: 'Show me the new site' });
  const ms = Date.now() - t0;
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10_000 }).catch(() => {});
  const log = await page.$eval('#log', (el) => (el as HTMLElement).innerText);
  if (/Not Delivered/.test(log)) problems.push(`${name}: a message was Not Delivered`);
  if (/something went wrong/i.test(log)) problems.push(`${name}: Roger replied with an error: ${log.match(/.*something went wrong.*/i)?.[0]}`);
  const links = await page.$$eval('.bubble.link', (els) => els.map((e) => `${e.querySelector('b')?.textContent} <${(e as HTMLAnchorElement).href}> img:${!!e.querySelector('img')}`));
  console.log(`${name}: ${ms}ms, ${links.length} link previews\n  ${links.join('\n  ')}`);
  await page.screenshot({ path: `${out}-${name}.png` });
  await ctx.close();
}

await run('desktop', { viewport: { width: 1280, height: 920 }, colorScheme: 'light' });
await run('phone', { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true });
await run('dark', { viewport: { width: 1280, height: 920 }, colorScheme: 'dark' });
await browser.close();
console.log('problems:', problems.length ? problems : 'none');
if (problems.length) process.exit(1);
