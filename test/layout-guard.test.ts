// Layout guards (pipeline revision 4), on synthetic pages: generated CSS can no longer make a page scroll sideways or
// hide Google photos (and their credits) in a sideways-scrolling strip. Two layouts: the failure shape of a saved roofing
// version (a rotated chalk line across a hero; a photo grid that becomes a 72%-wide scroll strip on phones, on the home
// page and, through the site CSS, on an inner page), and a different one (a flex strip whose scrolling and row are set in
// separate rules; a 120vw bleed band). A version made before revision 4 renders exactly as it did; a version never sent
// can be checked again under revision 4 without any new generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-layout-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { compilePage, PIPELINE_REV } = await import('../src/studio/frontend/page.js');
const { compileSite } = await import('../src/studio/frontend/site.js');
const { unstripPhotos, styleRules, PAGE_CLIP } = await import('../src/studio/frontend/layout-guard.js');
const { reviewPages } = await import('../src/studio/frontend/review.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
import type { FrontendCode, FrontendInput } from '../src/studio/frontend/page.js';
import type { Photo } from '../src/studio/concepts/review.js';

const listing = (n: number, w = 1600, h = 1200): Photo => ({ id: `g${n}`, url: `google-listing:PLACEtest#${n}`, width: w, height: h, orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square', uses: [], alt: 'Photo from Google Maps', seen: 'A pitched shingle roof', seenKind: 'work', services: [], fp: `fp${n}` });
const own: Photo = { id: 'w1', url: 'https://img.test/w1.jpg', width: 800, height: 600, orientation: 'landscape', uses: [], alt: 'A roof', seen: 'A roof', services: [] };
const input: FrontendInput = {
  business: { name: 'Ridge Line Roofing', category: 'Roofing contractor', website: null, summary: 'Ridge Line Roofing is a roofing contractor. It repairs and replaces roofs for local homes.' }, colours: [],
  facts: { name: 'Ridge Line Roofing', address: '1 Test Road', hours: 'Mon–Sun: Open 24 hours', rating: '4.8★ from 120 Google reviews' },
  actions: [{ id: 'dir', factId: 'address', kind: 'directions', label: 'Directions', href: 'https://maps.example/dir' }],
  photos: [1, 2, 3, 4, 5, 6, 7].map((n) => listing(n)).concat(own), ownLines: [], services: [], items: [], story: null, notes: [],
};
/** what the live page does (each photo's address and its credit), done locally */
const filled = (html: string) => { const $ = load(html); $('img[data-gphoto]').each((_, el) => { $(el).attr('src', `https://img.test/${$(el).attr('data-gphoto')!.replace('#', '-')}.jpg`); }); $('.gcredit').html('Photo: <a href="https://maps.example/u">Test Person</a> · <a href="https://maps.example/p">Google Maps</a>'); return $.html(); };

// ── layout 1: the saved roofing version's failure shape ──
const NAV = '<nav><a data-page="home">Home</a> <a data-page="photos">Photos</a></nav>';
const roofing = (): FrontendCode => ({ idea: 'Laid in courses: each section is a course of shingle.', fonts: [], css: `
body{margin:0;font-family:system-ui}
.course{position:relative;padding:4rem 0}
.c-hero{background:#1c1f23;color:#f2ede4;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr)}
.hero-photo .ph{height:100%}
.ph{overflow:hidden;background:#3a4048}
.ph img{width:100%;height:100%;object-fit:cover}
.chalk{position:absolute;left:-2%;right:-2%;top:16%;height:2px;background:#6cb2ff;transform:rotate(-3.5deg);pointer-events:none}
.wrap{max-width:1200px;margin:0 auto;padding:0 1.25rem}
.aerials{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}
.aerials li:nth-child(even){margin-top:2.5rem}
.aerials .ph{aspect-ratio:4/5}
@media (max-width:900px){
.c-hero{grid-template-columns:1fr}
.chalk{top:auto;bottom:38%}
.aerials{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:72%;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:1rem}
.aerials li{scroll-snap-align:start}
.aerials li:nth-child(even){margin-top:0}
}`,
  html: `<header><span data-fact="name"></span>${NAV}</header><main>
<section class="course c-hero"><div class="hero-copy wrap"><h1 data-fact="name"></h1><p>Shingle by shingle, course by course.</p><a data-action="dir">Directions</a></div><div class="hero-photo"><div class="ph"><img data-photo="g1"></div></div><span class="chalk" aria-hidden="true"></span></section>
<section class="course"><div class="wrap"><h2>From above</h2><ul class="aerials">${[2, 3, 4, 5].map((n) => `<li><div class="ph"><img data-photo="g${n}"></div><p>Roof seen from above</p></li>`).join('')}</ul></div></section>
<section class="course"><div class="wrap"><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p></div></section></main>` });
const roofingSite = { css: `.plan-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.plan-grid .ph{aspect-ratio:1/1}
@media (max-width:900px){.plan-grid{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:78%;overflow-x:auto;scroll-snap-type:x mandatory}}`,
  pages: [{ slug: 'photos', html: `<header><span data-fact="name"></span>${NAV}</header><main><section class="course"><div class="wrap"><h1>Photos</h1><ul class="plan-grid">${[5, 6, 7].map((n) => `<li><div class="ph"><img data-photo="g${n}"></div><p>A finished roof</p></li>`).join('')}</ul></div></section></main>` }] };
const plan = [{ slug: 'photos', title: 'Photos', purpose: 'Every roof photo', required: ['name'], minPhotos: 3, requireAction: false }];

// ── layout 2: a different shape: a flex strip set in two rules, and a bleed band wider than the window ──
const gallery = (): FrontendCode => ({ idea: 'A contact sheet that runs across the page.', fonts: [], css: `
body{margin:0;font-family:system-ui}
.band{width:120vw;margin-left:-10vw;height:40px;background:repeating-linear-gradient(90deg,#222 0 20px,#d8692e 20px 40px)}
.sheet{display:flex;gap:12px;padding:0 16px}
.sheet{overflow-x:scroll}
.sheet>figure{flex:0 0 80%;margin:0}
.sheet .frame{aspect-ratio:3/2;overflow:hidden}
.sheet img{width:100%;height:100%;object-fit:cover}
.reviews{display:flex;overflow-x:auto;gap:12px}.reviews>p{flex:0 0 70%}`,
  html: `<header><span data-fact="name"></span></header><main><h1>Ridge Line Roofing</h1><div class="band" aria-hidden="true"></div>
<div class="sheet">${[1, 2, 3].map((n) => `<figure><div class="frame"><img data-photo="g${n}"></div><figcaption>A roof we finished</figcaption></figure>`).join('')}</div>
<div class="reviews"><p>Rated by local homeowners</p><p>Read the reviews on Google</p></div>
<p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="dir">Directions</a></main>` });

test('revision 4 is current; a version made before it compiles exactly as it did', () => {
  assert.equal(PIPELINE_REV, 4);
  const v3 = compilePage(roofing(), input, { rev: 3, pages: plan });
  assert.ok(!v3.includes(PAGE_CLIP), 'no page clip before revision 4');
  assert.ok(v3.includes('grid-auto-columns:72%;overflow-x:auto'), 'the strip as written');
});

test('the compiler: a sideways strip of Google photos wraps, in its own rule and media query; nothing else changes', () => {
  const html = compilePage(roofing(), input, { pages: plan });
  assert.ok(html.includes(PAGE_CLIP), 'the top-level parts of the page clip sideways overflow');
  const css = load(html)('style').text();
  // the phone rule of .aerials, rewritten where it stands (inside its media query, same selector)
  const phone = styleRules(css).filter((r) => r.selector === '.aerials').map((r) => css.slice(r.bodyStart, r.bodyEnd));
  assert.deepEqual(phone, ['list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:1rem', 'grid-auto-flow:row;overflow-x:visible;padding-bottom:1rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,9.5rem),1fr))']);
  assert.match(css, /@media \(max-width:900px\)\{[^@]*\.aerials\{grid-auto-flow:row;/, 'still inside its media query');
  // the design's other rules are untouched: the photo frames still crop (overflow:hidden), the chalk line still crosses
  assert.ok(css.includes('.ph{overflow:hidden;background:#3a4048}'));
  assert.ok(css.includes('transform:rotate(-3.5deg)'));
  // the inner page: its strip comes from the site CSS
  const pages = compileSite(roofing(), roofingSite, input, plan);
  assert.match(load(pages.photos)('style').text(), /\.plan-grid\{grid-auto-flow:row;overflow-x:visible;grid-template-columns:repeat\(auto-fill/);
  // a scrolling box without Google photos (a row of review quotes) is the design's choice and stays
  const g = load(compilePage(gallery(), input))('style').text();
  assert.ok(g.includes('.reviews{display:flex;overflow-x:auto;gap:12px}'), 'a strip of text is left alone');
  // layout 2: the flex strip's scrolling and its row are in separate rules; both are rewritten
  assert.ok(g.includes('.sheet{display:flex;gap:12px;padding:0 16px;flex-wrap:wrap}'), g.match(/\.sheet\{[^}]*\}/g)?.join(' ') ?? '');
  assert.ok(g.includes('.sheet{overflow-x:visible}'));
});

test('the rule reader: nested at-rules, comments, strings and keyframes', () => {
  const css = `/* a { } comment */ .a{content:"}{";color:red} @media (min-width:1px){@supports (display:grid){.b{overflow:auto}}} @keyframes k{from{opacity:0}to{opacity:1}} @font-face{font-family:x}`;
  assert.deepEqual(styleRules(css).map((r) => [r.selector, css.slice(r.bodyStart, r.bodyEnd)]), [['.a', 'content:"}{";color:red'], ['.b', 'overflow:auto']]);
  // a selector the page can't match, or a state selector, never breaks compilation
  const $ = load('<ul class="s"><li><img data-photo="g1"></li></ul>');
  const r = unstripPhotos('.s:hover{overflow-x:auto}.s::after{content:""}:nth-child(2n of .x){overflow:auto}', $, () => true);
  assert.equal(r.fixed.length, 1);
});

test('the rendered review: both layouts fail before revision 4 and pass after, at 1440 and 390', { skip: screenshotsAvailable() ? false : 'no browser here' }, async () => {
  const browser = await launchBrowser();
  try {
    // layout 1, as the saved version failed: the page scrolls sideways, photos are hidden in the strip, credits are cut
    const before = await reviewPages(Object.entries(compileSite(roofing(), roofingSite, input, plan, { rev: 3 })).map(([slug, html]) => ({ slug, html: filled(html) })), { offline: true, browser });
    const homeP = before.pages.find((p) => p.page === 'home' && p.width === 390)!.problems.join('\n');
    assert.match(homeP, /the page scrolls sideways/);
    assert.match(homeP, /cut by ul\.aerials|the photo itself is not visible/);
    assert.match(before.pages.find((p) => p.page === 'home' && p.width === 1440)!.problems.join('\n'), /the page scrolls sideways/, 'the rotated chalk line, at desktop width too');
    assert.match(before.pages.find((p) => p.page === 'photos' && p.width === 390)!.problems.join('\n'), /plan-grid|the photo itself is not visible/);
    const after = await reviewPages(Object.entries(compileSite(roofing(), roofingSite, input, plan)).map(([slug, html]) => ({ slug, html: filled(html) })), { offline: true, browser });
    assert.deepEqual(after.problems, [], after.problems.join('\n'));
    for (const p of after.pages) assert.equal(p.credits.visible, p.credits.required, `${p.page} ${p.width}`);
    // layout 2
    const g3 = await reviewPages([{ slug: 'home', html: filled(compilePage(gallery(), input, { rev: 3 })) }], { offline: true, browser });
    assert.match(g3.problems.join('\n'), /scrolls sideways/);
    assert.match(g3.pages.find((p) => p.width === 390)!.problems.join('\n'), /div\.sheet|the photo itself is not visible/);
    const g4 = await reviewPages([{ slug: 'home', html: filled(compilePage(gallery(), input)) }], { offline: true, browser });
    assert.deepEqual(g4.problems, [], g4.problems.join('\n'));
    // the page clip never hides content: text pushed past the window's side is still reported
    const wide = gallery(); wide.css += '\nh1{white-space:nowrap;font-size:160px}';
    const cut = await reviewPages([{ slug: 'home', html: filled(compilePage(wide, input)) }], { offline: true, browser, widths: [390] });
    assert.match(cut.problems.join('\n'), /text runs past the side of the window: "Ridge Line Roofing" \(h1\)/);
  } finally { await browser.close(); }
});

test('a version never sent is checked again under revision 4 (no new generation); older revisions and sent versions keep theirs', async () => {
  const { recheckVersion, getFrontendJob } = await import('../src/studio/frontend/jobs.js');
  const { staffRecheck } = await import('../src/imessage/custom-intake.js');
  const { studioDocs } = await import('../src/store.js');
  const saved = (id: string, rev: number) => studioDocs.put('studio-frontend-jobs', id, { id, createdAt: 'x', updatedAt: 'x', businessKey: 'place-PLACEtest', revision: 1, instruction: '', status: 'needs-review', input, code: roofing(), attempts: 1, costUsd: 0.5, calls: [], checks: { static: 'passed', browser: 'failed', copy: 'owner-review-required', publication: 'disabled' }, rev });
  // queued to the worker (as on Vercel), so no browser runs here: only what the recheck records is checked
  const was = process.env.ROGER_WORKER; process.env.ROGER_WORKER = 'daemon';
  try {
    await saved('fe_layoutrev3a', 3); await saved('fe_layoutrev2a', 2); await saved('fe_layoutrev3b', 3);
    const up = await recheckVersion('fe_layoutrev3a', { upgrade: true });
    assert.equal(up.rev, 4); assert.equal(up.rerendered?.from, 3); assert.equal(up.stage, 'checks');
    assert.equal((await getFrontendJob('fe_layoutrev3a'))?.rev, 4, 'saved');
    assert.equal((await recheckVersion('fe_layoutrev2a', { upgrade: true })).rev, 2, 'an older revision keeps its own rules');
    assert.equal((await recheckVersion('fe_layoutrev3b')).rev, 3, 'without the upgrade (a plain recheck), the version is checked as it was made');
    // staff "check again" on a failed (never sent) version upgrades it; a sent version is never checked again this way
    await saved('fe_layoutrev3c', 3);
    const run = { versions: [{ n: 1, status: 'failed', jobId: 'fe_layoutrev3c' }, { n: 2, status: 'sent', jobId: 'fe_layoutrev3b', url: 'https://x/v/fe_layoutrev3b' }] } as never;
    assert.equal((await staffRecheck(run, 1)).ok, true);
    assert.equal((await getFrontendJob('fe_layoutrev3c'))?.rev, 4);
    assert.match((await staffRecheck(run, 2)).reason ?? '', /version 2 is sent/);
    assert.equal((await getFrontendJob('fe_layoutrev3b'))?.rev, 3);
  } finally { if (was === undefined) delete process.env.ROGER_WORKER; else process.env.ROGER_WORKER = was; }
});
