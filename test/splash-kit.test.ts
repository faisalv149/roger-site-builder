// The Roger kit on a splash page: Claude's kit choices checked (known values, a hero the photos can carry, calm trades
// still), and the compiled page (tokens and kit CSS before Claude's own, the motion flag and Motion, the big footer from
// bound facts, marquee loops repeated). Pages made before the kit keep their own look. Synthetic business; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-kit-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { kitProblems, compileSplash, splashCodeProblems } = await import('../src/splash/build.js');
const { kitTokens, onColour, KIT_JS, HERO_SEQUENCES } = await import('../src/splash/kit.js');
const { heroLayouts } = await import('../src/splash/jobs.js');
const { splashFixtures } = await import('./splash-fixtures.js');
const fx = await splashFixtures();

const withHero = (hero: string, attrs = 'data-rk-hero="split"') => {
  const a = fx.answer();
  return { ...a, html: a.html.replace(/<section id="hero"[^>]*>[\s\S]*?<\/section>/, `<section id="hero" data-screen="hero" ${attrs}>${hero}</section>`) };
};
const HERO = '<div class="rk-container rk-hero__inner"><div class="rk-hero__copy"><h1 class="rk-display" data-copy="headline" data-rk-anim="words">Plumbing repairs across Austin</h1><p class="rk-lead" data-copy="subline">Leaks, drains and water heaters, fixed by a licensed local plumber.</p><div class="rk-hero__actions"><a class="rk-btn" data-rk-hover="magnetic" data-action="call">Call</a></div></div><div class="rk-hero__media"><div class="rk-frame" data-rk-anim="parallax"><img data-photo="g1"></div></div></div>';

test('kit choices: known values only; a hero layout the photos can carry; calm trades stay still', () => {
  assert.deepEqual(kitProblems(withHero(HERO), fx.input), []);
  assert.match(kitProblems(withHero(HERO, ''), fx.input).join(), /Give the hero section a layout/);
  assert.match(kitProblems(withHero(HERO.replace('data-rk-hover="magnetic"', 'data-rk-hover="wobble"')), fx.input).join(), /data-rk-hover="wobble" must be one of/);
  assert.match(kitProblems(withHero(HERO.replace('class="rk-display"', 'class="rk-display" data-rk-bounce="1"')), fx.input).join(), /data-rk-bounce is not part of the kit/);
  assert.match(kitProblems(withHero(HERO, 'data-rk-hero="collage"'), fx.input).join(), /collage hero needs at least three photos \(it has 1\)/);
  assert.match(kitProblems(withHero(HERO.replace('<img data-photo="g1">', '<img data-photo="g1"></div><div class="rk-frame"><img data-photo="g2">'), 'data-rk-hero="full"'), fx.input).join(), /full hero has exactly one photo/);
  assert.match(kitProblems(withHero(HERO, 'data-rk-hero="marquee"'), fx.input).join(), /marquee hero has a \.rk-marquee/);
  assert.match(kitProblems(withHero(HERO.replace('data-rk-anim="words">Plumbing', 'data-rk-anim="words"><span data-fact="name"></span> Plumbing')), fx.input).join(), /words" goes on plain text only/);
  assert.match(kitProblems(withHero(HERO), fx.input, true).join(), /calm trade: no data-rk-anim[\s\S]*no magnetic buttons/);
  assert.match(kitProblems(withHero(HERO.replace('data-rk-anim="words"', 'data-rk-anim="words" data-rk-delay="3"')), fx.input).join(), /data-rk-delay="3" must be a number of seconds/);
  // the generator's checks include the kit's only for kit pages
  assert.deepEqual(splashCodeProblems(fx.answer(), fx.plan, fx.input).filter((p) => /data-rk/.test(p)), []);
  assert.deepEqual(heroLayouts(fx.input), ['full', 'split', 'marquee', 'collage', 'type']);
  assert.deepEqual(heroLayouts({ ...fx.input, photos: [] }), ['type']);
});

test('new pages choose a hero sequence; older pages stay valid and verified numbers stay still', () => {
  assert.deepEqual(HERO_SEQUENCES, ['editorial', 'scene-first', 'direct']);
  assert.match(kitProblems(withHero(HERO), fx.input, false, true).join(), /business-specific motion order/);
  const directed = withHero(HERO, 'data-rk-hero="split" data-rk-sequence="scene-first"');
  assert.deepEqual(kitProblems(directed, fx.input, false, true), []);
  assert.match(kitProblems(withHero(HERO, 'data-rk-hero="split" data-rk-sequence="random"'), fx.input).join(), /must be one of/);
  assert.match(kitProblems(directed, fx.input, true).join(), /calm trade: leave data-rk-sequence off/);
  assert.match(kitProblems(withHero(HERO + '<p data-rk-anim="count"><span data-google="rating"></span></p>'), fx.input).join(), /Keep verified numbers still/);
  assert.match(KIT_JS, /seq==='scene-first'/);
  assert.match(KIT_JS, /seq==='editorial'/);
  assert.match(KIT_JS, /el\.querySelector\('\[data-google\],\[data-fact\]'\)/);
});

test('tokens: safe values only, sensible defaults, readable text on the brand colours', () => {
  const t = kitTokens({ primary: '#0B5FAD', accent: '#F2C14E', background: 'url(evil)', mood: 'dark', radius: 'round', display_font: 'Fraunces', text_font: 'Inter;}body{' }, ['Fraunces', 'Inter']);
  assert.match(t, /--rk-primary:#0B5FAD;--rk-on-primary:#ffffff;--rk-accent:#F2C14E;--rk-on-accent:#111111/);
  assert.match(t, /--rk-bg:#0e0f11/, 'a bad background falls back to the mood\'s');
  assert.match(t, /--rk-radius:28px/); assert.match(t, /--rk-display:'Fraunces',/);
  assert.match(t, /--rk-body:'Inter',/, 'an unsafe font name is ignored for the font list');
  assert.doesNotMatch(t, /evil|\}body\{/);
  assert.equal(onColour('#FFFFFF'), '#111111');
});

test('the compiled kit page: kit CSS before Claude\'s, the motion flag and Motion, the big footer from facts, marquee loops', () => {
  const code = withHero(HERO + '<div class="rk-marquee"><div class="rk-marquee__track"><span class="rk-marquee__item" data-fact="service-drains"></span><span class="rk-marquee__item" data-fact="service-heaters"></span></div></div>', 'data-rk-hero="marquee"');
  const html = compileSplash(code, fx.plan, fx.input, { id: 'sp_0000000000000001', mode: 'preview', kit: true });
  const $ = load(html);
  const styles = $('head style').toArray().map((e) => $(e).attr('id') ?? $(e).text().slice(0, 30));
  assert.equal(styles[0], 'rk-kit', 'the kit first, so the page\'s own rules refine it');
  assert.match($('head script').first().text(), /classList\.add\('rk-js'\)/);
  assert.match($('body').html()!, /Motion 14\.14\.0 \| MIT License/);
  assert.equal($('.rk-marquee__item').length, 4); assert.equal($('.rk-marquee__item[aria-hidden="true"]').length, 2);
  const f = $('footer.rk-footer');
  assert.equal(f.length, 1); assert.equal($('footer').length, 1, 'Claude\'s footer was replaced');
  assert.equal(f.find('[data-fact="address"]').text(), '1 Test Rd, Austin, TX 78701, USA');
  assert.equal(f.find('[data-fact="phone"]').text(), '(512) 555-0100');
  assert.equal(f.find('.rk-footer__wordmark').text(), 'Ridge Line Plumbing');
  assert.equal(f.find('a[data-event="footer_call"]').attr('href'), 'tel:+15125550100');
  assert.deepEqual(f.find('h2').toArray().map((e) => $(e).text()), ['Visit', 'Hours', 'Contact']);
  // a page made before the kit: none of it
  const old = load(compileSplash(fx.answer(), fx.plan, fx.input, { id: 'sp_0000000000000001', mode: 'preview' }));
  assert.equal(old('#rk-kit').length, 0); assert.equal(old('.rk-footer').length, 0); assert.doesNotMatch(old.html(), /RogerMotion/);
});
