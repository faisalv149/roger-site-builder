// QA: build every theme in the library and check phone/desktop for horizontal overflow and JS errors (server must be running).
import { buildSite } from '../src/pipeline.js';
import { loadThemes } from '../src/theme/load.js';
import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
const ctxs = { phone: await browser.newContext({ viewport: { width: 390, height: 844 } }), desk: await browser.newContext({ viewport: { width: 1366, height: 900 } }) };
const biz = { roofing: 'Summit Peak Roofing 78704', plumbing: 'BlueLine Plumbing Denver', landscaping: 'Greenway Lawn Landscape Charlotte', hvac: 'ComfortPro Heating Air Tempe', electrical: 'BlueLine Plumbing Denver', general: 'Greenway Lawn Landscape Charlotte' } as Record<string, string>;
const bad: string[] = [];
for (const e of loadThemes().values()) {
  const r = await buildSite({ google: biz[e.vertical], themeId: e.id, audit: false, screenshot: false, slug: `sweep-${e.id}` });
  for (const [n, ctx] of Object.entries(ctxs)) {
    const p = await ctx.newPage();
    const errs: string[] = [];
    p.on('pageerror', (x) => errs.push(x.message));
    await p.route('**/*', (rt) => (rt.request().url().startsWith('http://localhost') ? rt.continue() : rt.abort()));
    await p.goto(r.siteUrl, { waitUntil: 'load' });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    const vw = n === 'phone' ? 390 : 1366;
    if (sw > vw || errs.length) bad.push(`${e.id} ${n}: scrollWidth=${sw} ${errs.join('|')}`);
    await p.close();
  }
  process.stdout.write(`${e.id}(${r.totalMs}ms) `);
}
console.log('\nproblems:', bad.length ? bad : 'none');
await browser.close();
