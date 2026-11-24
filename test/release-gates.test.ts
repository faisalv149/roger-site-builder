// The three release gates for custom sites, on synthetic examples (Level Up's failure cases, a normal usable gym photo
// and others):
//  1. versioned photo rendering: revision 2 sizes photos by their CSS frame and keeps credits inside it; a version made
//     before (revision 1) renders exactly as it did;
//  2. the rendered-page review fails a credit that is clipped, covered, hidden or outside its photo, at 1440 and 390;
//  3. the media and claim gate withholds unsuitable photos with a recorded reason, flags uncertain ones for staff, holds
//     the preview from automatic delivery, and refuses copy that infers what a photo cannot show.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-gates-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { checkCode, compilePage, PIPELINE_REV, PHOTO_CSS_REV2 } = await import('../src/studio/frontend/page.js');
const { gatePhotos, photoVerdict, inferenceProblems } = await import('../src/studio/frontend/media-gate.js');
const { reviewPages } = await import('../src/studio/frontend/review.js');
const { startFrontendJob, waitFrontendJob, refinedVersion, editedVersion, versionText, deliveryOf } = await import('../src/studio/frontend/jobs.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
import type { FrontendCode, FrontendInput } from '../src/studio/frontend/page.js';
import type { Photo } from '../src/studio/concepts/review.js';
import type { AiTransport } from '../src/studio/concepts/ai.js';

const listing = (n: number, seen: string | undefined, w = 2304, h = 4096): Photo => ({ id: `g${n}`, url: `google-listing:PLACEtest#${n}`, width: w, height: h, orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square', uses: [], alt: 'Photo of Test Gym from Google Maps', services: [], fp: `fp${n}`, ...(seen ? { seen, seenKind: 'work' } : {}) });
// Level Up's photo checks, as saved (subjects verbatim), plus other cases
const LEVEL_UP = {
  row: listing(1, 'Plate-loaded row machine with weights'), // a normal usable gym photo
  floor: listing(2, 'Gym floor with weights and treadmills', 4800, 2700),
  people: listing(3, 'Gym interior with machines, turf, people training', 4608, 3456), // people incidental to the scene
  collage: listing(4, 'Before and after body transformation collage', 3853, 3853),
  kids: listing(5, 'Indoor kids play area with slide', 4800, 2699),
  selfie: listing(6, 'Man taking mirror selfie in gym', 1200, 1600),
};
const base = (photos: Photo[], extra: Partial<FrontendInput> = {}): FrontendInput => ({
  business: { name: 'Test Gym', category: 'Fitness center', website: null, summary: 'Test Gym is a fitness center. It is a place for local people to work out and train.' }, colours: [],
  facts: { name: 'Test Gym', address: '1 Test Road', hours: 'Mon–Fri: 7 AM – 11 PM', rating: '4.7★ from 176 Google reviews' },
  actions: [{ id: 'dir', factId: 'address', kind: 'directions', label: 'Directions', href: 'https://maps.example/dir' }],
  photos, ownLines: [], services: [], items: [], story: null, notes: [], ...extra,
});

test('media gate: Level Up\'s failure cases are withheld with a reason; normal gym photos pass', () => {
  const input = base(Object.values(LEVEL_UP));
  const v = (p: Photo) => photoVerdict(p, input);
  assert.equal(v(LEVEL_UP.row), undefined, 'a plate-loaded machine is a normal usable gym photo');
  assert.equal(v(LEVEL_UP.floor), undefined);
  assert.equal(v(LEVEL_UP.people), undefined, 'people training in a wide shot of the floor are incidental, not the subject');
  assert.deepEqual([v(LEVEL_UP.collage)?.action, v(LEVEL_UP.collage)?.rule], ['withhold', 'before-after']);
  assert.deepEqual([v(LEVEL_UP.kids)?.action, v(LEVEL_UP.kids)?.rule], ['withhold', 'unverified-facility']);
  assert.match(v(LEVEL_UP.kids)!.reason, /"kids"/);
  assert.deepEqual([v(LEVEL_UP.selfie)?.action, v(LEVEL_UP.selfie)?.rule], ['withhold', 'selfie']);
  const g = gatePhotos(input, 'T');
  assert.deepEqual(g.input.photos.map((p) => p.id), ['g1', 'g2', 'g3']);
  assert.deepEqual(g.decisions.map((d) => [d.id, d.rule]), [['g4', 'before-after'], ['g5', 'unverified-facility'], ['g6', 'selfie']]);
  assert.ok(g.decisions.every((d) => d.reason && d.seen && d.at === 'T'), 'each withheld photo is recorded with its reason and what was seen');
});

test('media gate: other unsuitable or uncertain photos; a facility the business itself states is allowed', () => {
  const input = base([]);
  const cases: [string | undefined, string | undefined, string | undefined][] = [
    ['Shirtless man flexing in front of a mirror', 'withhold', 'body'],
    ['Smiling woman portrait at the front desk', 'withhold', 'portrait'],
    ['Trophy shelf at the reception desk', 'withhold', 'unverified-outcome'],
    ['Yoga class in a studio room', 'withhold', 'unverified-service'],
    ['Swimming pool with lane ropes', 'withhold', 'unverified-facility'],
    // people incidental to a view of the place (a saved Jalal Sons photo the first rule set flagged by mistake)
    ['Lit shopfront sign, parked cars, two men', undefined, undefined],
    ['Workers on shingle roof of brick house', undefined, undefined],
    ['Woman lifting a barbell', 'review', 'person-subject'],
    [undefined, 'review', 'undescribed'],
    ['Dumbbell racks on artificial turf', undefined, undefined],
    ['Cardio machines by large windows', undefined, undefined],
  ];
  for (const [seen, action, rule] of cases) { const r = photoVerdict(listing(9, seen), input); assert.deepEqual([r?.action, r?.rule], [action, rule], String(seen)); }
  // the business's own words make the facility verified
  const own = base([], { ownLines: ['Kids play area while you train'] });
  assert.equal(photoVerdict(LEVEL_UP.kids, own), undefined);
  const pool = base([], { services: [{ id: 's1', name: 'Swimming pool access' }] });
  assert.equal(photoVerdict(listing(9, 'Swimming pool with lane ropes'), pool), undefined);
});

test('claim gate: copy may not infer ownership, membership, results, amenities, classes or trainers from photos', () => {
  const input = base([LEVEL_UP.row]);
  for (const [text, word] of [["The club's own photos show free weights.", "The club's own photos"], ['Members training on the floor', 'Members'], ['What members say', 'members'], ['The part that goes in the log: results', 'results'], ['Kids corner', 'Kids'], ['Before-and-after stories', 'Before-and-after'], ['Book a class with a trainer', 'class']] as const) {
    const p = inferenceProblems(text, input); assert.equal(p.length, 1, text); assert.ok(p[0].includes(`"${word}"`), `${text}: ${p[0]}`);
  }
  for (const ok of ['Rated by the people who train here', 'Training on the floor', 'Photos on the club\'s Google listing show free weights', 'A world-class welcome', 'Read the reviews on Google']) assert.deepEqual(inferenceProblems(ok, input), [], ok);
  // the business's own words allow the term; "own photos" is never allowed
  const members = base([], { ownLines: ['Members get unlimited access'] });
  assert.deepEqual(inferenceProblems('What members say', members), []);
  assert.equal(inferenceProblems("Our own photos of the floor", members).length, 1);
});

// a homepage in Level Up's style: polaroid frames with a set shape and hidden overflow, a full-bleed band of fixed
// height, a website photo given a 16:10 shape by its own CSS, and a grid card with a photo and its caption
const code = (): FrontendCode => ({ idea: 'Logbook', fonts: [], css: `main{max-width:1200px;margin:auto}figure{margin:0}
.frame{overflow:hidden;background:#111}.frame img{width:100%;height:100%;object-fit:cover}
.hero .frame{aspect-ratio:9/14;max-height:78vh;width:min(26rem,90vw)}
.band{margin:0;height:clamp(260px,46vw,560px);overflow:hidden}.band img{width:100%;height:100%;object-fit:cover}
.pane img{width:100%;aspect-ratio:16/10;object-fit:cover}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;list-style:none;padding:0}.cards img{width:100%;aspect-ratio:4/3;object-fit:cover}`,
  html: `<header><span data-fact="name"></span></header><main><h1>Test Gym</h1>
<figure class="hero"><div class="frame"><img data-photo="g1"></div><figcaption>The row machine</figcaption></figure>
<figure class="band"><img data-photo="g2"></figure>
<div class="pane"><img data-photo="w1"></div>
<ul class="cards"><li><img data-photo="g3"><p>Training on the floor</p></li><li><img data-photo="g1"><p>Rows</p></li></ul>
<p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="dir">Directions</a></main>` });
const site = base([LEVEL_UP.row, LEVEL_UP.floor, LEVEL_UP.people, { id: 'w1', url: 'https://img.test/w1.jpg', width: 800, height: 1600, orientation: 'portrait', uses: [], alt: 'Weights', seen: 'Weights', services: [] }]);
/** what the live page does (the photo's address and its credit), done locally */
const filled = (html: string) => { const $ = load(html); $('img[data-gphoto]').each((_, el) => { $(el).attr('src', `https://img.test/${$(el).attr('data-gphoto')!.replace('#', '-')}.jpg`); }); $('.gcredit').html('Photo: <a href="https://maps.example/u">Test Person</a> · <a href="https://maps.example/p">Google Maps</a>'); return $.html(); };

test('rendering is versioned: revision 1 keeps the old output; revision 2 adds frame-true photos', () => {
  assert.ok(PIPELINE_REV >= 2);
  const v1 = compilePage(code(), site, { rev: 1 }), v2 = compilePage(code(), site);
  assert.ok(v1.includes('.roger-photo{position:relative;display:block}.roger-photo>img{display:block;width:100%;height:100%;object-fit:cover}'));
  assert.ok(!v1.includes('roger-fill') && !v1.includes(PHOTO_CSS_REV2));
  assert.ok(v2.includes(PHOTO_CSS_REV2) && v2.indexOf(PHOTO_CSS_REV2) < v2.indexOf('.frame{overflow:hidden'), 'revision 2 rules come before the design\'s CSS, so the design wins');
  // a photo alone in its frame is wrapped so it lays out as if unwrapped; one beside its caption is not
  const $ = load(v2);
  assert.equal($('.frame > .roger-fill > img[data-photo="g1"]').length, 1);
  assert.equal($('.band > .roger-fill > img').length, 1);
  assert.equal($('.cards li > .roger-photo:not(.roger-fill) > img').length, 2);
  // revision 1 never applied the new copy rule: an old version's copy still compiles
  const old = code(); old.html = old.html.replace('Training on the floor', 'Members training on the floor');
  assert.doesNotThrow(() => compilePage(old, site, { rev: 1 }));
  assert.throws(() => compilePage(old, site), /infers membership/);
});

const skipBrowser = screenshotsAvailable() ? false : 'no browser here';
test('rendered review at 1440 and 390: revision 1 clips credits in shaped frames; revision 2 keeps every credit visible and every photo its CSS shape', { skip: skipBrowser }, async () => {
  const browser = await launchBrowser();
  try {
    const before = await reviewPages([{ slug: 'home', html: filled(compilePage(code(), site, { rev: 1, version: 'v1' })) }], { offline: true, browser, version: 'v1' });
    assert.equal(before.pass, false);
    for (const width of [1440, 390]) {
      const r = before.pages.find((p) => p.width === width)!;
      assert.ok(r.problems.some((p) => /photo PLACEtest#1: credit is (clipped|outside)/.test(p)), `${width}: ${r.problems.join(' | ')}`);
      assert.ok(r.credits.visible < r.credits.required, 'counting credit elements alone would have passed this page');
    }
    const after = await reviewPages([{ slug: 'home', html: filled(compilePage(code(), site, { version: 'v2' })) }], { offline: true, browser, version: 'v2' });
    assert.deepEqual(after.problems, []);
    assert.deepEqual(after.pages.map((p) => [p.width, p.credits.required, p.credits.visible]), [[1440, 4, 4], [390, 4, 4]]);
    // each photo has the shape its CSS gives it (the website photo's 16:10 is no longer overridden by its height attribute)
    for (const width of [1440, 390]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      await page.route('**/*', (r) => r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"/>' }) : r.abort());
      for (const [rev, ratio] of [[1, 'old'], [2, 'new']] as const) {
        await page.setContent(filled(compilePage(code(), site, { rev })), { waitUntil: 'load' });
        await page.evaluate('window.__name = (f) => f'); // a bundler's keep-names helper, absent in the page
        const m = await page.evaluate(() => { const box = (s: string) => { const r = document.querySelector(s)!.getBoundingClientRect(); return r.width / r.height; }; return { pane: box('.pane img'), hero: box('.hero img'), heroFrame: box('.hero .frame') }; });
        if (ratio === 'new') { assert.ok(Math.abs(m.pane - 1.6) < 0.02, `pane ${m.pane}`); assert.ok(Math.abs(m.hero - m.heroFrame) < 0.02, 'the hero photo is exactly its frame'); }
        else assert.ok(m.pane < 1, 'revision 1 stretched the website photo to its height attribute (unchanged for old versions)');
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

test('rendered review fails a credit that is covered, hidden or outside its photo, even though it exists', { skip: skipBrowser }, async () => {
  const variants: [string, string, RegExp][] = [
    ['covered', '.frame{position:relative}.frame::after{content:"";position:absolute;inset:0;z-index:9;background:rgba(0,0,0,.01)}', /credit is covered by/],
    ['hidden', '.gcredit{display:none}', /credit is hidden/],
    ['outside', '.hero .frame img{height:40%}', /credit is (outside|clipped)/],
  ];
  // a tilted polaroid (its credit tilts with it) is not mistaken for a covered credit
  {
    const c = code(); c.css += '.hero{transform:rotate(-3deg)}.band{transform:rotate(2deg)}';
    const browser0 = await launchBrowser();
    try { const r = await reviewPages([{ slug: 'home', html: filled(compilePage(c, site)) }], { offline: true, browser: browser0 }); assert.deepEqual(r.problems.filter((p) => /credit/.test(p)), [], 'tilted frames: no credit reported covered'); }
    finally { await browser0.close(); }
  }
  const browser = await launchBrowser();
  try {
    for (const [name, css, expected] of variants) {
      const c = code(); c.css += css;
      const r = await reviewPages([{ slug: 'home', html: filled(compilePage(c, site)) }], { offline: true, browser, widths: [1440] });
      assert.equal(r.pass, false, name);
      assert.ok(r.problems.some((p) => expected.test(p)), `${name}: ${r.problems.join(' | ')}`);
    }
    // a credit with no text is a missing credit
    const r = await reviewPages([{ slug: 'home', html: compilePage(code(), site) }], { offline: true, browser, widths: [390] });
    assert.ok(r.problems.some((p) => /has no credit/.test(p)));
  } finally { await browser.close(); }
});

// a fake Claude: the homepage, then the inner photos page
function fakeClaude(home: FrontendCode, pagesHtml: string): AiTransport {
  let n = 0;
  return { via: 'fake', model: 'claude-sonnet-5-5', async call() {
    const data = n++ === 0 ? home : { css: '', pages: [{ slug: 'photos', html: pagesHtml }, { slug: 'visit', html: '<header><a data-page="home">Home</a><a data-page="photos">Photos</a><a data-page="visit">Visit</a></header><main><h1>Visit</h1><p data-fact="name"></p><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="dir">Directions</a></main>' }] };
    return { data, usage: { via: 'fake', model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, costBasis: 'reported' } };
  } };
}

test('a new job withholds Level Up\'s unsuitable photos before writing, records them, and an edit cannot restore them', async () => {
  const photos = [LEVEL_UP.row, LEVEL_UP.floor, LEVEL_UP.people, LEVEL_UP.collage, LEVEL_UP.kids, LEVEL_UP.selfie, listing(7, 'Cable machine and benches'), listing(8, 'Weight plates on a rack'), listing(10, 'Squat racks along a mirrored wall'), listing(11, 'Row of treadmills by the windows')];
  const nav = '<header><span data-fact="name"></span><nav><a data-page="home">Home</a><a data-page="photos">Photos</a><a data-page="visit">Visit</a></nav></header>';
  const home: FrontendCode = { idea: 'Gate test homepage', fonts: [], css: '.frame{overflow:hidden;aspect-ratio:4/5}.frame img{width:100%;height:100%;object-fit:cover}', html: `${nav}<main><h1>Test Gym</h1><div class="frame"><img data-photo="g1"></div><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="dir">Directions</a><p>Rated by the people who train here.</p></main>` };
  const photosPage = `${nav}<main><h1>Photos</h1>${['g1', 'g2', 'g3', 'g7', 'g8', 'g10', 'g11'].map((id) => `<div class="frame"><img data-photo="${id}"></div>`).join('')}</main>`;
  const job = await startFrontendJob({ businessKey: 'gate-test', revision: 1 }, 'gate test', { transport: fakeClaude(home, photosPage), input: base(photos), again: true, review: false });
  const done = (await waitFrontendJob(job.id))!;
  assert.equal(done.status, 'needs-review', done.error ?? '');
  assert.equal(done.rev, PIPELINE_REV);
  assert.deepEqual(done.input.photos.map((p) => p.id), ['g1', 'g2', 'g3', 'g7', 'g8', 'g10', 'g11'], 'the generator was never offered the withheld photos');
  assert.deepEqual(done.withheldPhotos!.map((w) => [w.id, w.action, w.rule]), [['g4', 'withhold', 'before-after'], ['g5', 'withhold', 'unverified-facility'], ['g6', 'withhold', 'selfie']]);
  assert.equal(done.pages!.find((p) => p.slug === 'photos')!.minPhotos, 7, 'the photos page asks for the 7 photos that remain, not 10');
  // a later refinement cannot bring a withheld photo back
  await assert.rejects(refinedVersion(done.id, { homeHtml: home.html.replace('data-photo="g1"', 'data-photo="g4"'), note: 'try to restore' }, { review: false }), /Unknown photo g4/);
  const edited = await editedVersion(done.id, { [versionText(done).home[0].key]: 'Test Gym' }, { review: false });
  assert.deepEqual(edited.withheldPhotos!.map((w) => w.id), ['g4', 'g5', 'g6'], 'carried to every later version');
  assert.ok(!edited.input.photos.some((p) => ['g4', 'g5', 'g6'].includes(p.id)));
  // the rendered review did not run here, so the preview is not sent automatically
  assert.equal(done.delivery?.auto, false);
});

test('an uncertain photo is flagged for staff review and the preview is held from automatic delivery', () => {
  const at = 'T';
  const flagged = { withheldPhotos: [{ id: 'g9', action: 'review' as const, rule: 'person-subject', reason: 'a person is the main subject; staff must confirm the photo is suitable', at }], checks: { static: 'passed' as const, browser: 'passed' as const, copy: 'owner-review-required' as const, publication: 'disabled' as const }, review: { at, pass: true, ran: true, pages: [], problems: [] } };
  assert.deepEqual(deliveryOf(flagged), { auto: false, reasons: ['photo g9 needs staff review: a person is the main subject; staff must confirm the photo is suitable'] });
  assert.deepEqual(deliveryOf({ ...flagged, withheldPhotos: [{ ...flagged.withheldPhotos[0], action: 'withhold' as const }] }), { auto: true, reasons: [] }, 'a clear withhold needs no staff decision');
  assert.equal(deliveryOf({ ...flagged, withheldPhotos: [], review: { ...flagged.review, pass: false, problems: ['home at 390px: photo x: credit is clipped'] } }).auto, false);
});

test('the copy gate runs in the homepage checks of a new version', () => {
  const c = code(); c.html = c.html.replace('<h1>Test Gym</h1>', '<h1>Test Gym</h1><p>The club\'s own photos show the floor.</p>');
  assert.match(checkCode(c, site).join(' '), /own photos/);
  assert.deepEqual(checkCode(c, site, { rev: 1 }).filter((e) => /own photos/.test(e)), []);
});
