/**
 * Release QA: builds the 12 QA profiles in an isolated store, takes full-page screenshots at 1440 / 768 / 390 px,
 * runs automated checks (overflow, broken images, axe accessibility rules, primary action vs. widget overlap,
 * one H1, working in-page links) and records timing, plan/family and the git state. Writes report.json,
 * report.md and a contact sheet. Use the same command before and after a change to compare.
 *
 *   DATA_DIR=<tmp>/data OUT_DIR=<tmp>/out MOCK=1 LEAD_WEBHOOK_URL= npx tsx scripts/release-qa.ts --label baseline
 *   options: --label <name>  --out <dir>  --only id,id  --families (also render each profile in every family)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { chromium, type Browser, type Page } from 'playwright-core';
import { config, ROOT } from '../src/config.js';
import { buildSite } from '../src/pipeline.js';
import { getDraft, renderWorking, summarisePlan } from '../src/drafts.js';
import { renderFamilyPage } from '../src/render/families.js';
import { pageSeo } from '../src/seo.js';
import { previewContext } from '../src/site-render.js';

export const QA_PROFILES = [
  'mock-demo-copperleaf', 'mock-demo-rapidrooter', 'mock-cat-brightline', 'mock-cat-riverside', 'mock-cat-velvet', 'mock-cat-lantern',
  'mock-cat-juniper', 'mock-cat-bellacasa', 'mock-cat-forge', 'mock-cat-northpoint', 'mock-cat-thimble', 'mock-cat-marlow',
];
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const LABEL = arg('label') || 'run';
const OUT = path.resolve(arg('out') || path.join(ROOT, 'out', 'qa', 'release', LABEL));
const ONLY = arg('only')?.split(',');
const FAMILIES = process.argv.includes('--families') ? ['editorial-showcase', 'warm-local', 'bold-practical'] : [];

if (!config.mock) { console.error('Run with MOCK=1 (fictional QA profiles only).'); process.exit(1); }
if (config.leadWebhook) { console.error('Unset LEAD_WEBHOOK_URL for QA.'); process.exit(1); }
if (fs.existsSync(path.join(config.dirs.data, 'builds')) && fs.readdirSync(path.join(config.dirs.data, 'builds')).length) { console.error('Use an empty DATA_DIR / OUT_DIR.'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const git = (() => {
  try {
    const cwd = ROOT;
    return { head: execSync('git rev-parse --short HEAD', { cwd }).toString().trim(), branch: execSync('git branch --show-current', { cwd }).toString().trim(), changedFiles: execSync('git status --short', { cwd }).toString().trim().split('\n').filter(Boolean).length };
  } catch { return undefined; }
})();

const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const WIDTHS: [number, number, boolean][] = [[1440, 900, false], [768, 1024, true], [390, 844, true]];

export interface PageChecks { width: number; overflow: number; wide?: string[]; brokenImages: string[]; h1: number; axe: { id: string; impact: string; nodes: number; help: string; target?: string }[]; ctaCovered: boolean; ctaAboveFold: boolean; deadLinks: string[]; height: number }

export async function checkPage(page: Page, width: number): Promise<PageChecks> {
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  // lazy images only load near the viewport: scroll through the page so screenshots show them
  await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // full-page captures can paint asynchronously decoded images blank: load and decode every image first
  await page.evaluate(() => { document.querySelectorAll('img').forEach((i) => { i.setAttribute('loading', 'eager'); i.setAttribute('decoding', 'sync'); }); });
  await page.evaluate(() => Promise.race([Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 4000))]));
  await page.evaluate(() => Promise.race([Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 3000))]));
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const cta = document.querySelector('.dh-ctas .btn-primary, .fe-actions .btn-primary, .fw-actions .btn-primary, .fb-panel .btn-primary, .hero .btn-primary, main .btn-primary') as HTMLElement | null;
    const rb = cta?.getBoundingClientRect();
    const widget = document.querySelector('.rw') as HTMLElement | null;
    const wb = widget?.getBoundingClientRect();
    const covered = !!(rb && wb && wb.width && !(rb.right < wb.left || rb.left > wb.right || rb.bottom < wb.top || rb.top > wb.bottom));
    const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
    const dead = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')!).filter((h) => h.length > 1 && !ids.has(h.slice(1)));
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      wide: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`),
      brokenImages: [...document.images].filter((i) => i.getAttribute('src') && i.complete && !i.naturalWidth).map((i) => i.getAttribute('src')!),
      h1: document.querySelectorAll('h1').length,
      ctaCovered: covered, ctaAboveFold: !!rb && rb.top > 0 && rb.bottom < window.innerHeight - (window.innerWidth < 900 ? 96 : 0), deadLinks: [...new Set(dead)], height: document.documentElement.scrollHeight,
    };
  });
  await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => {
    // @ts-expect-error axe is injected
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, target: v.nodes.slice(0, 2).map((n: any) => `${n.target.join(' ')}${n.any?.[0]?.data?.contrastRatio ? ` (${n.any[0].data.contrastRatio}:1 ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor})` : ''}`).join(' | ') }));
  });
  return { width, ...r, axe };
}

export async function shootAll(browser: Browser, url: string, base: string): Promise<{ checks: PageChecks[]; files: string[] }> {
  const checks: PageChecks[] = [];
  const files: string[] = [];
  for (const [w, h, mobile] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript('window.__name = (f) => f');
    await page.goto(url, { waitUntil: 'load' });
    const c = await checkPage(page, w);
    checks.push(c);
    const file = `${base}-${w}.png`;
    await page.screenshot({ path: file, fullPage: true });
    files.push(file);
    await ctx.close();
  }
  return { checks, files };
}

/** A grid of page tops (desktop) with the phone view beside each, labelled. */
export async function contactSheet(items: { label: string; desktop: string; phone: string }[], out: string, cols = 3) {
  const cellW = 640, phoneW = 180, cellH = 520, pad = 18, labelH = 34;
  const tiles = await Promise.all(items.map(async (it) => {
    const d = await sharp(it.desktop).resize({ width: cellW - phoneW - 10 }).extract({ left: 0, top: 0, width: cellW - phoneW - 10, height: cellH - labelH }).toBuffer().catch(async () => sharp(it.desktop).resize({ width: cellW - phoneW - 10, height: cellH - labelH, fit: 'cover', position: 'top' }).toBuffer());
    const p = await sharp(it.phone).resize({ width: phoneW }).extract({ left: 0, top: 0, width: phoneW, height: cellH - labelH }).toBuffer().catch(async () => sharp(it.phone).resize({ width: phoneW, height: cellH - labelH, fit: 'cover', position: 'top' }).toBuffer());
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${labelH}"><text x="2" y="23" font-family="Arial" font-size="17" font-weight="700" fill="#111">${it.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
    return { d, p, label };
  }));
  const rows = Math.ceil(items.length / cols);
  const W = cols * cellW + (cols + 1) * pad, H = rows * cellH + (rows + 1) * pad;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#e6e8eb' } }).composite(tiles.flatMap((t, i) => {
    const x = pad + (i % cols) * (cellW + pad), y = pad + Math.floor(i / cols) * (cellH + pad);
    return [{ input: t.label, left: x, top: y }, { input: t.d, left: x, top: y + labelH }, { input: t.p, left: x + cellW - phoneW, top: y + labelH }];
  })).png().toFile(out);
}

if (process.argv[1] && /release-qa\.ts$/.test(process.argv[1])) {
  const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
  const rows: any[] = [];
  const sheet: { label: string; desktop: string; phone: string }[] = [];
  for (const id of QA_PROFILES.filter((p) => !ONLY || ONLY.includes(p))) {
    const t0 = Date.now();
    const r = await buildSite({ placeId: id, screenshot: false, audit: false });
    const ms = Date.now() - t0;
    const d = r.draftId ? await getDraft(r.draftId) : undefined;
    const plan = d ? summarisePlan(d.plan) : undefined;
    const base = path.join(OUT, id.replace(/^mock-/, ''));
    const { checks, files } = await shootAll(browser, `file://${path.join(r.siteDir, 'index.html').replace(/\\/g, '/')}`, base);
    const family = (d?.plan as any)?.family?.id || plan?.direction;
    rows.push({ id, name: r.business.name, category: d?.category, family, familyVersion: (d?.plan as any)?.family?.version, plan, buildMs: ms, pages: (r as any).pages?.length ?? 1, checks });
    sheet.push({ label: `${r.business.name} · ${family}`, desktop: files[0], phone: files[2] });
    // the same business, prices, action and photos in every family
    const famRows: { family: string; checks: PageChecks[]; files: string[] }[] = [];
    for (const fam of FAMILIES) {
      const w = await renderWorking(d!, { layout: { family: fam } });
      if (!w.sitePlan) continue;
      const html = renderFamilyPage(w.model, w.sitePlan, w.sitePlan.pages[0], pageSeo(w.model, w.sitePlan, w.sitePlan.pages[0], previewContext(d!.slug)));
      const file = path.join(r.siteDir, `qa-family-${fam}.html`);
      fs.writeFileSync(file, html);
      const shot = await shootAll(browser, `file://${file.split(path.sep).join('/')}`, `${base}-${fam}`);
      famRows.push({ family: fam, ...shot });
      fs.rmSync(file, { force: true });
    }
    if (famRows.length) {
      rows[rows.length - 1].families = famRows.map((x) => ({ family: x.family, checks: x.checks }));
      for (const w of [1440, 390]) {
        const strip = famRows.map((x) => x.files[w === 1440 ? 0 : 2]);
        const W = w === 1440 ? 560 : 300;
        const imgs = await Promise.all(strip.map(async (f) => { const im = await sharp(f).resize({ width: W }).toBuffer({ resolveWithObject: true }); return sharp(im.data).extract({ left: 0, top: 0, width: W, height: Math.min(im.info.height, w === 1440 ? 2600 : 2400) }).toBuffer({ resolveWithObject: true }); }));
        const gap = 18, H = Math.max(...imgs.map((i) => i.info.height)) + gap * 2 + 30;
        const labels = famRows.map((x, k) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="28"><text x="0" y="20" font-family="Arial" font-size="18" font-weight="700">${x.family}</text></svg>`), left: gap + k * (W + gap), top: 8 }));
        await sharp({ create: { width: imgs.length * (W + gap) + gap, height: H, channels: 3, background: '#e6e8eb' } })
          .composite([...labels, ...imgs.map((im, k) => ({ input: im.data, left: gap + k * (W + gap), top: 40 }))]).png().toFile(`${base}-families-${w}.png`);
      }
    }
    console.log(`${id}: ${family} · ${ms} ms · axe ${checks.map((c) => c.axe.length).join('/')} · overflow ${checks.map((c) => c.overflow).join('/')}`);
  }
  await browser.close();
  await contactSheet(sheet, path.join(OUT, 'contact-sheet.png'));
  const report = { label: LABEL, at: new Date().toISOString(), git, mock: config.mock, profiles: rows };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const allChecks = (r: any) => [...r.checks.map((c: PageChecks) => ({ c, tag: '' })), ...(r.families || []).flatMap((f: any) => f.checks.map((c: PageChecks) => ({ c, tag: ` [${f.family}]` })))];
  const issues = rows.flatMap((r) => allChecks(r).flatMap(({ c, tag }: { c: PageChecks; tag: string }) => [
    ...(c.overflow > 1 ? [`${r.id}${tag} @${c.width}: horizontal overflow ${c.overflow}px (${(c.wide || []).join(', ')})`] : []),
    ...c.brokenImages.map((s) => `${r.id}${tag} @${c.width}: broken image ${s}`),
    ...(c.h1 !== 1 ? [`${r.id}${tag} @${c.width}: ${c.h1} H1`] : []),
    ...c.axe.map((a) => `${r.id}${tag} @${c.width}: axe ${a.id} (${a.impact}, ${a.nodes}) ${a.help}: ${a.target || ''}`),
    ...(c.ctaCovered ? [`${r.id}${tag} @${c.width}: primary action under the widget`] : []),
    ...(c.width === 390 && !c.ctaAboveFold ? [`${r.id}${tag} @390: main action is not on the first screen`] : []),
    ...c.deadLinks.map((l) => `${r.id}${tag} @${c.width}: in-page link ${l} has no target`),
  ]));
  const md = `# Release QA: ${LABEL}\n\n${new Date().toISOString()} · git ${git?.branch}@${git?.head} (+${git?.changedFiles} uncommitted files) · mock data\n\n| Profile | Category | Family/direction | Hero | Offerings | Build | Height 1440/390 |\n|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r.name} | ${r.category} | ${r.family}${r.familyVersion ? ` v${r.familyVersion}` : ''} | ${r.plan?.hero} | ${r.plan?.offerings ?? '—'} | ${r.buildMs} ms | ${r.checks[0].height}/${r.checks[2].height} |`).join('\n')}\n\nMedian build: ${[...rows.map((r) => r.buildMs)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]} ms\n\n## Automated findings (${issues.length})\n\n${issues.length ? issues.map((i) => `- ${i}`).join('\n') : 'None.'}\n`;
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(md);
  process.exit(0);
}
