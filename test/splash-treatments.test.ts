// Motion treatments on a splash page: the choices settled with the markup (kept when it can carry them, repaired to the
// subtle reveal when it cannot, one section only, calm trades still), the recorded reasons required, the compiled page
// (spread frames moving inside still slots that keep their photo credits, panels for unveil and track), and the
// rendered review's narrowed marquee rule. Synthetic business; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-treat-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { settleMotion, kitProblems, compileSplash } = await import('../src/splash/build.js');
const { TREATMENTS, KIT_JS } = await import('../src/splash/kit.js');
const { MEASURE } = await import('../src/studio/frontend/review.js');
const { splashFixtures } = await import('./splash-fixtures.js');
const fx = await splashFixtures();

const HERO = '<div class="rk-container rk-hero__inner"><div class="rk-hero__copy"><h1 class="rk-display" data-copy="headline">Plumbing repairs across Austin</h1><p class="rk-lead" data-copy="subline">Leaks, drains and water heaters, fixed by a licensed local plumber.</p><div class="rk-hero__actions"><a class="rk-btn" data-action="call">Call</a></div></div><div class="rk-hero__media"><div class="rk-frame"><img data-photo="g1"></div></div></div>';
const COLLAGE = '<div class="rk-container rk-hero__inner"><div class="rk-hero__copy"><h1 data-copy="headline">Plumbing repairs across Austin</h1><p data-copy="subline">Leaks fixed by a local plumber.</p><a data-action="call">Call</a></div><div class="rk-hero__media rk-collage" data-rk-anim="stagger"><div class="rk-frame"><img data-photo="g1"></div><div class="rk-frame"><img data-photo="g2"></div><div class="rk-frame"><img data-photo="g3"></div></div></div>';
const TRACK = '<h2>Recent jobs</h2><div class="rk-track"><figure><div class="rk-frame"><img data-photo="g2"></div><figcaption>One</figcaption></figure><figure><div class="rk-frame"><img data-photo="g3"></div><figcaption>Two</figcaption></figure><figure><div class="rk-frame"><img data-photo="g4"></div><figcaption>Three</figcaption></figure></div>';
const WHY = 'The reason names this business\'s own material.';
/** the fixture's answer with this hero and this work section */
const page = (hero: string, heroAttrs: string, work: string, workAttrs = '') => {
  const a = fx.answer();
  return { ...a, html: a.html
    .replace(/<section id="hero"[^>]*>[\s\S]*?<\/section>/, `<section id="hero" data-screen="hero" ${heroAttrs}>${hero}</section>`)
    .replace(/<section id="work"[^>]*>[\s\S]*?<\/section>/, `<section id="work" data-screen="work"${workAttrs}>${work}</section>`) };
};

test('treatments: compatible choices kept (their scope\'s own animations give way); the rest repaired to the subtle reveal', () => {
  assert.deepEqual(TREATMENTS, ['subtle', 'spread', 'unveil', 'track']);
  const good = settleMotion({ ...page(COLLAGE, 'data-rk-hero="collage" data-rk-treatment="spread"', TRACK, ' data-rk-treatment="track"'), motion: { hero: { treatment: 'spread', reason: WHY }, section: { screen: 'work', treatment: 'track', reason: WHY } } });
  assert.equal(good.motion.hero.treatment, 'spread');
  assert.deepEqual(good.motion.section, { screen: 'work', treatment: 'track', reason: WHY });
  assert.match(good.repairs.join(), /1 element animation\(s\) inside the spread gave way to it/);
  assert.doesNotMatch(good.code.html, /rk-collage" data-rk-anim/);
  // a spread with no collage, a row of two: the subtle reveal, each reported
  const bad = settleMotion({ ...page(HERO, 'data-rk-hero="split" data-rk-treatment="spread"', '<h2>Jobs</h2><div class="rk-track"><div><div class="rk-frame"><img data-photo="g2"></div></div><div>x</div></div>', ' data-rk-treatment="track"'), motion: { hero: { treatment: 'spread', reason: WHY }, section: { screen: 'work', treatment: 'track', reason: WHY } } });
  assert.equal(bad.motion.hero.treatment, 'subtle'); assert.equal(bad.motion.section?.treatment, 'subtle');
  assert.match(bad.repairs.join('\n'), /Hero: spread needs a collage of three or more photos \(found 0\), so it uses the subtle reveal/);
  assert.match(bad.repairs.join('\n'), /#work: track needs a \.rk-track row of three or more items \(found 2\)/);
  assert.match(settleMotion(page(COLLAGE, 'data-rk-hero="collage" data-rk-treatment="track"', TRACK)).repairs.join(), /track is for a work or product section, not the hero/);
  // the recorded choice fills a missing mark
  const filled = settleMotion({ ...page(COLLAGE, 'data-rk-hero="collage"', TRACK), motion: { hero: { treatment: 'spread', reason: WHY }, section: { screen: 'work', treatment: 'track', reason: WHY } } });
  assert.match(filled.code.html, /id="hero"[^>]*data-rk-treatment="spread"/); assert.match(filled.code.html, /id="work"[^>]*data-rk-treatment="track"/);
});

test('treatments: one important section only; a calm trade stays still', () => {
  const marked = page(HERO, 'data-rk-hero="split"', TRACK, ' data-rk-treatment="track"');
  const two = settleMotion({ ...marked, html: marked.html.replace('<section id="expect" data-screen="expect"', '<section id="expect" data-screen="expect" data-rk-treatment="unveil"'), motion: { section: { screen: 'work', treatment: 'track', reason: WHY } } });
  assert.match(two.repairs.join(), /Only one section gets its own treatment: #expect uses the subtle reveal/);
  assert.doesNotMatch(two.code.html, /id="expect"[^>]*data-rk-treatment/);
  const calm = settleMotion(page(COLLAGE, 'data-rk-hero="collage" data-rk-treatment="spread"', TRACK, ' data-rk-treatment="track"'), { calm: true });
  assert.doesNotMatch(calm.code.html, /data-rk-treatment/); assert.match(calm.repairs.join(), /calm trade/);
  assert.equal(calm.motion.section, null);
});

test('the record is required on new pages: each treatment with a reason, a planned section', () => {
  const screens = fx.plan.screen_plan.screens.map((x) => x.screen);
  const bare = { ...fx.answer(), motion: undefined };
  assert.match(kitProblems(bare, fx.input, false, false, screens).join(), /Record the hero's motion/);
  assert.match(kitProblems({ ...fx.answer(), motion: { hero: { treatment: 'subtle', reason: WHY }, section: { screen: 'hero', treatment: 'subtle', reason: WHY } } }, fx.input, false, false, screens).join(), /must be one of the planned screens other than the hero/);
  assert.match(kitProblems({ ...fx.answer(), motion: { hero: { treatment: 'subtle', reason: 'short' }, section: { screen: 'work', treatment: 'subtle', reason: WHY } } }, fx.input, false, false, screens).join(), /Record the hero's motion/);
  assert.deepEqual(kitProblems(fx.answer(), fx.input, false, false, screens), []);
  assert.deepEqual(kitProblems(bare, fx.input, true, false, screens).filter((e) => /motion/.test(e)), [], 'a calm trade records none');
  assert.match(kitProblems(page(HERO, 'data-rk-hero="split" data-rk-treatment="swirl"', TRACK), fx.input).join(), /data-rk-treatment="swirl" must be one of/);
});

test('compiled: spread frames move inside still slots that keep their photo credits; unveil and track get panels', () => {
  const code = settleMotion(page(COLLAGE, 'data-rk-hero="collage" data-rk-treatment="spread"', TRACK, ' data-rk-treatment="track"')).code;
  const $ = load(compileSplash(code, fx.plan, fx.input, { id: 'sp_0000000000000001', mode: 'preview', kit: true }));
  const slots = $('#hero .rk-collage > .rk-slot');
  assert.equal(slots.length, 3, 'each frame in a still slot');
  slots.each((_, s) => {
    const credit = $(s).children('.gcredit'), img = $(s).find('.rk-frame img');
    assert.equal(credit.length, 1, 'the credit belongs to the slot, outside the moving frame');
    assert.equal($(s).find('.rk-frame .gcredit').length, 0);
    assert.ok(img.attr('data-gcid')); assert.equal(credit.attr('data-gcredit-for'), img.attr('data-gcid'), 'still linked to its photo');
  });
  assert.equal($('#work .rk-track .rk-frame > .rk-veil[aria-hidden="true"]').length, 3, 'a panel over each track photo');
  assert.equal($('#hero .rk-veil').length, 0, 'none where nothing is unveiled');
  assert.equal($('#work .rk-track .rk-frame .gcredit').length, 3, 'track credits stay in their still frames');
  const css = $('#rk-kit').text();
  assert.match(css, /\.rk-veil\{display:none\}/); assert.match(css, /\.rk-js \.rk-veil\{display:block/, 'panels only while the script can take them away');
  assert.match(css, /\.rk-frame>\.gcredit\{z-index:3\}/, 'credits above the panels');
  assert.match(KIT_JS, /k==='spread'/); assert.match(KIT_JS, /k==='unveil'\|\|k==='track'/);
});

test('the rendered review: text in an intentional marquee may run past the window; other overflow still counts', () => {
  const src = fs.readFileSync(new URL('../src/studio/frontend/review.ts', import.meta.url), 'utf8');
  assert.equal(typeof MEASURE, 'function');
  assert.match(src, /closest\('\.rk-marquee__track'\)\?\.closest\('\.rk-marquee'\)/);
  assert.match(src, /\(hidden\|clip\)/, 'only a band that clips its track counts as a marquee');
  assert.match(src, /if \(!scrolls && !marquee\) cut\.push/);
});
