/**
 * Category QA: builds the ten fictional category fixtures (scripts/make-category-fixtures.ts) in an isolated store,
 * checks each page at 1440px and 390px, and renders one business in three generated designs (same content and
 * photos) for comparison. Refuses a store that already has data, so saved plans can't skew results.
 *   DATA_DIR=/tmp/q/data OUT_DIR=/tmp/q/out MOCK=1 LEAD_WEBHOOK_URL= npx tsx scripts/category-qa.ts
 * Writes screenshots, sheets and report.md to out/qa/categories (or QA_OUT).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, type Page } from 'playwright-core';
import { config } from '../src/config.js';
import { buildSite } from '../src/pipeline.js';
import { composeModel, getDraft, generateAnother, saveDraft, summarisePlan } from '../src/drafts.js';
import { renderPage } from '../src/render/page.js';

if (fs.existsSync(path.join(config.dirs.data, 'drafts')) && fs.readdirSync(path.join(config.dirs.data, 'drafts')).length) {
  console.error('This store already has drafts. Run with an empty DATA_DIR / OUT_DIR.');
  process.exit(1);
}
if (config.leadWebhook) { console.error('Unset LEAD_WEBHOOK_URL for QA.'); process.exit(1); }
const OUT = process.env.QA_OUT || path.join(config.dirs.out, 'qa', 'categories');
fs.mkdirSync(OUT, { recursive: true });

const IDS = ['cat-brightline', 'cat-velvet', 'cat-lumen', 'cat-lantern', 'cat-juniper', 'cat-bellacasa', 'cat-forge', 'cat-northpoint', 'cat-thimble', 'cat-marlow'];
const EXPECT: Record<string, { title?: RegExp; price?: RegExp; sample?: boolean; noPhone?: boolean; action: RegExp }> = {
  'cat-brightline': { price: /\$1,800–\$3,200/, sample: true, action: /Request a quote|Call/ },
  'cat-velvet': { price: /\$180–\$260/, sample: true, action: /Request an appointment/ },
  'cat-lumen': { price: /Price on request/, sample: false, action: /Request an appointment/ },
  'cat-lantern': { price: /£22/, sample: true, action: /Request an appointment/ },
  'cat-juniper': { title: /Menu/, price: /\$4\.50/, sample: true, action: /Call us|Order enquiry/ },
  'cat-bellacasa': { title: /Menu/, price: /\$65 \/ person/, sample: true, action: /Call us|Order enquiry/ },
  'cat-forge': { price: /\$59 \/ month/, sample: true, action: /Ask about membership/ },
  'cat-northpoint': { price: /\$1,200 \/ month/, sample: true, action: /Send an enquiry|Request a consultation/ },
  'cat-thimble': { price: /From \$28/, sample: true, action: /Ask about an item/ },
  'cat-marlow': { noPhone: true, action: /Send an enquiry/ },
};

const problems: string[] = [];
const rows: string[] = [];
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });

async function shoot(file: string, out: string, width: number, height: number, mobile: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  await page.goto(`file://${file.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.evaluate(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: out });
  return { page, close: () => ctx.close() };
}

async function checkPage(id: string, file: string, tag: string) {
  const e = EXPECT[id];
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]] as const) {
    const { page, close } = await shoot(file, path.join(OUT, `${id}-${tag}-${w}.png`), w, h, mobile);
    const r = await page.evaluate(() => ({
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      broken: [...document.images].filter((i) => i.getAttribute('src') && i.complete && !i.naturalWidth).map((i) => i.src),
      h1: document.querySelectorAll('h1').length,
      kind: (document.querySelector('form.lead-form input[name=kind]') as HTMLInputElement | null)?.value,
      tel: !!document.querySelector('a[href^="tel:"]'),
      cta: (document.querySelector('.dh-ctas .btn-primary') as HTMLElement | null)?.innerText || '',
      ctaTop: (document.querySelector('.dh-ctas .btn-primary') as HTMLElement | null)?.getBoundingClientRect().top ?? 9999,
      carousel: !!document.querySelector('[data-cz]'),
    }));
    const p = (ok: unknown, msg: string) => { if (!ok) problems.push(`${id} ${tag} @${w}: ${msg}`); };
    p(r.h1 === 1, `${r.h1} h1 elements`);
    p(r.overflow <= 1, `horizontal scroll ${r.overflow}px`);
    p(!r.broken.length, `broken images ${r.broken.join(', ')}`);
    p(!/\bundefined\b|\bnull\b|NaN/.test(r.text), 'undefined/null/NaN in the text');
    p(e.action.test(r.cta) || new RegExp(e.action.source, 'i').test(r.cta) || (/^\(?\d/.test(r.cta.replace(/^Call\s*/, '')) && /Call/.test(String(e.action))), `main action "${r.cta}"`);
    if (e.price) p(e.price.test(r.text), `price ${e.price} not shown`);
    if (e.title) p(e.title.test(r.text), `title ${e.title} missing`);
    if (e.sample !== undefined) p(/Sample prices for this demo business/.test(r.text) === e.sample, `sample-price note ${e.sample ? 'missing' : 'shown'}`);
    if (e.noPhone) p(!r.tel, 'tel: link without a phone');
    if (mobile) p(r.ctaTop < 844, `main action below the first screen (${Math.round(r.ctaTop)}px)`);
    if (r.carousel) {
      // carousel controls work by keyboard
      await page.focus('.cz-track');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      const cur = await page.evaluate(() => document.querySelector('.cz-dot[aria-current=true]')?.getAttribute('data-cz-go'));
      p(cur === '1', `carousel arrow key → slide ${cur}`);
      p(await page.evaluate(() => !!document.querySelector('[aria-roledescription=carousel] [aria-roledescription=slide][aria-label="1 of 3"], [aria-roledescription=slide]')), 'carousel slides labelled');
    }
    await close();
  }
}

for (const id of IDS) {
  const t0 = Date.now();
  const r = await buildSite({ placeId: `mock-${id}`, screenshot: false, audit: false });
  const ms = Date.now() - t0;
  const d = (await getDraft(r.draftId!))!;
  const s = summarisePlan(d.plan);
  rows.push(`| ${r.business.name} | ${d.category} | ${s.directionLabel} | ${s.heroLabel} | ${s.offerings ?? '—'} | ${s.gallery ?? '—'} | ${d.offerings.filter((o) => o.price.kind !== 'quote').length}/${d.offerings.length} | ${ms} ms |`);
  await checkPage(id, path.join(r.siteDir, 'index.html'), 'd1');
  console.log(`${id}: ${s.directionLabel}, ${s.heroLabel}, ${ms} ms`);
}

// one business, three generated designs, same content and photos
const COMPARE = 'cat-velvet';
const base = (await getDraft((await buildSite({ placeId: `mock-${COMPARE}`, screenshot: false, audit: false })).draftId!))!;
const designs = [base.plan];
let cur = base;
for (let n = 0; n < 2; n++) {
  const g = await generateAnother(cur, {});
  cur = await saveDraft((await getDraft(cur.id))!, { revision: (await getDraft(cur.id))!.revision, planId: g.plan.id });
  designs.push(cur.plan);
}
const sheets: Record<number, string[]> = { 1440: [], 390: [] };
for (const [i, plan] of designs.entries()) {
  const model = await composeModel(cur.base, plan, { appearance: {}, offerings: cur.offerings });
  const file = path.join(config.dirs.sites, cur.slug, `qa-design-${i + 1}.html`);
  fs.writeFileSync(file, renderPage(model));
  await checkPage(COMPARE, file, `design${i + 1}`);
  for (const w of [1440, 390]) sheets[w].push(path.join(OUT, `${COMPARE}-design${i + 1}-${w}.png`));
}
for (const w of [1440, 390] as const) {
  const imgs = await Promise.all(sheets[w].map((f) => sharp(f).resize({ width: w === 1440 ? 960 : 390 }).toBuffer({ resolveWithObject: true })));
  const gap = 24, W = imgs.reduce((a, x) => a + x.info.width, 0) + gap * (imgs.length + 1), H = Math.max(...imgs.map((x) => x.info.height)) + gap * 2;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#e9ebee' } })
    .composite(imgs.map((x, i) => ({ input: x.data, left: gap + imgs.slice(0, i).reduce((a, y) => a + y.info.width + gap, 0), top: gap })))
    .png().toFile(path.join(OUT, `compare-${COMPARE}-${w}.png`));
}
const dims = designs.map(summarisePlan);
await browser.close();

const report = `# Category QA\n\n| Business | Category | Style | Hero | Offerings | Gallery | Priced | Build |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## ${COMPARE}: three generated designs (same content and photos)\n\n| # | Style | Hero | Type | Order | Density | Offerings | Gallery |\n|---|---|---|---|---|---|---|---|\n${dims.map((p, i) => `| ${i + 1} | ${p.directionLabel} | ${p.heroLabel} | ${p.typography} | ${p.arrangement} | ${p.density} | ${p.offerings} | ${p.gallery ?? '—'} |`).join('\n')}\n\nSheets: compare-${COMPARE}-1440.png, compare-${COMPARE}-390.png\n\n## Problems\n\n${problems.length ? problems.map((p) => `- ${p}`).join('\n') : 'None.'}\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), report);
console.log(report);
process.exit(problems.length ? 1 : 0);
