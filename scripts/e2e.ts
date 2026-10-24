// End-to-end check of the Studio UI (server must be running):  npm run e2e  (or: npx tsx scripts/e2e.ts out/qa/studio)

import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:4000/', { waitUntil: 'load' });
// the Studio opens on Sites when there is saved history: let that settle, then go to Progress
await page.waitForFunction(() => !document.querySelector('#sitesList')?.textContent?.includes('Loading'));
await page.click('[data-tab="progress"]');
// type the business like a user would (the sample chips hide once a saved site is loaded into the tabs)
await page.fill('#q', 'Summit Peak Roofing 78704');
await page.click('#findBtn');
await page.waitForSelector('.cand.sel');
await page.click('#buildBtn');
await page.waitForSelector('.sum', { timeout: 30000 });
await page.screenshot({ path: `${out}-progress.png` });
await page.click('[data-tab="preview"]'); await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-preview.png` });
await page.click('[data-tab="audit"]'); await page.screenshot({ path: `${out}-audit.png` });
await page.click('[data-tab="imessage"]'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}-cards.png` });
await page.click('[data-tab="sim"]'); await page.waitForSelector('.sim-log .bub.in');
for (const t of ['Summit Peak Roofing 78704', "Yes, that's me", 'Show me the new site']) {
  await page.fill('#simText', t); await page.click('#simForm button');
  await page.waitForFunction(() => !document.getElementById('typing'), null, { timeout: 30000 });
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-sim.png`, fullPage: true });
// a failed build comes back as a normal chat reply, not a console error
const failed = await page.$$eval('.sim-log .bub.in', (els) => els.map((e) => e.textContent || '').filter((t) => /something went wrong|^Error:/i.test(t)));
errors.push(...failed);
console.log('errors:', errors);
await browser.close();
if (errors.length) process.exit(1);
