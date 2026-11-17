// The custom-site rehearsal's refinements, on synthetic examples: neutral holiday-hours caveats beside verified hours
// (allowed) versus seasonal promotions and holiday schedules (blocked); claim repairs that quote the sentence, its page and
// a neutral rewrite; references to pages the site does not have; a Visit page without the verified address or hours;
// text covered by a photo; and CSS masks that hide essential content (while a shaped photo frame passes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-refine-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { undatedSeasonal } = await import('../src/util/text.js');
const { checkCode, pageReferenceProblems, PIPELINE_REV } = await import('../src/studio/frontend/page.js');
const { inferenceProblems } = await import('../src/studio/frontend/media-gate.js');
const { presendProblems } = await import('../src/imessage/custom-intake.js');
const { reviewPages } = await import('../src/studio/frontend/review.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
import type { FrontendCode, FrontendInput } from '../src/studio/frontend/page.js';
import type { FrontendJob } from '../src/studio/frontend/jobs.js';

test('a neutral holiday-hours caveat is allowed beside verified hours; promotions, holiday schedules and changed hours are not', () => {
  const allowed = ['Hours may vary on holidays.', 'Hours can change around holidays, so a quick call before you head over never hurts.', 'On public holidays, hours may vary.', 'Holiday hours may differ, so call ahead.', 'Opening hours might be different during holidays.'];
  for (const t of allowed) {
    assert.equal(undatedSeasonal(t, { hoursCaveat: true }), undefined, `allowed: ${t}`);
    assert.ok(undatedSeasonal(t), `without verified hours beside it, still blocked: ${t}`);
  }
  const blocked = ['Closed on Christmas Day.', 'Holiday hours: open until noon.', 'Our hours have changed for the holidays.', 'Hours have changed over the holidays.', 'Holiday specials all month.', 'Pre-order your holiday cakes.', 'Hours may vary on Christmas Eve.', 'Open late on Dec 24.', 'Hours may vary on holidays. Pre-order your pies now.', 'We are closed for the holidays.'];
  for (const t of blocked) assert.ok(undatedSeasonal(t, { hoursCaveat: true }), `blocked: ${t}`);
});

const input = (facts: Record<string, string> = { name: 'Test Gym', address: '1 Road', hours: 'Mon–Sat: 7 AM – 11 PM' }): FrontendInput => ({
  business: { name: 'Test Gym', category: 'Fitness center', website: null, summary: 'A fitness center for local people to work out.' }, colours: [], facts, actions: [{ id: 'dir', factId: 'address', kind: 'directions', label: 'Directions', href: 'https://maps.example/d' }],
  photos: [{ id: 'p1', url: 'https://img.test/p1.jpg', width: 800, height: 600, orientation: 'landscape', uses: [], alt: 'Gym floor', seen: 'Gym floor', services: [] }], ownLines: [], services: [], items: [], story: null, notes: [],
});
const visitCode = (extra: string): FrontendCode => ({ idea: 'v', fonts: [], css: '', html: `<header><a data-page="home">Home</a><a data-page="visit">Visit</a></header><main><h1>Visit</h1><p data-fact="name"></p><p data-fact="address"></p><p data-fact="hours"></p>${extra}<a data-action="dir">Directions</a></main>` });
const pages = [{ slug: 'visit', title: 'Visit' }];

test('in the page checks, the caveat passes only where the business has verified hours', () => {
  const c = visitCode('<p>Hours can change around holidays, so a quick call before you head over never hurts.</p>');
  const opts = { pages, required: ['name'], minPhotos: 0, page: 'visit' };
  assert.deepEqual(checkCode(c, input(), opts).filter((e) => /seasonal/.test(e)), []);
  const noHours = checkCode({ ...c, html: c.html.replace('<p data-fact="hours"></p>', '') }, input({ name: 'Test Gym', address: '1 Road' }), opts).join(' ');
  assert.match(noHours, /Leave undated seasonal promotions out: "holidays" in "[^"]*Hours can change around holidays/);
  const promo = checkCode(visitCode('<p>Hours may vary on holidays.</p><p>Holiday specials while supplies last.</p>'), input(), opts).join(' ');
  assert.match(promo, /Leave undated seasonal promotions out: "Holiday" in "[^"]*Holiday specials/, 'the promotion is quoted, not the caveat');
});

test('a claim repair quotes the sentence and its page, and says what to write instead (the rule is not relaxed)', () => {
  const [m] = inferenceProblems('Machines and turf | Members training across the floor.', input(), 'photos');
  assert.match(m, /^On the photos page/);
  assert.match(m, /"Members training across the floor\." uses "Members", which infers membership\. Rewrite it as "People training across the floor\."/);
  const [r] = inferenceProblems('Read what members have written about the club.', input(), 'home');
  assert.match(r, /Rewrite it as "Read what reviewers have written about the club\."/);
  const [o] = inferenceProblems("The club's own photos show the floor.", input(), 'home');
  assert.match(o, /Rewrite it as "Photos from the Google listing show the floor\."/);
  const [k] = inferenceProblems('Kids corner', input(), 'photos');
  assert.match(k, /Remove it: the business's own text does not mention a kids/);
  assert.equal(inferenceProblems('People training across the floor.', input(), 'photos').length, 0);
});

test('references to pages the site does not have are refused (revision 3); real pages and outside pages are fine', () => {
  const site = [{ slug: 'about', title: 'About' }, { slug: 'visit', title: 'Visit' }];
  assert.match(pageReferenceProblems("Two cafes | Each location's page lists the details.", site, 'home').join(), /"Each location's page lists the details\." refers to a location page/);
  assert.match(pageReferenceProblems('Prices are on our menu page.', site).join(), /refers to a menu page/);
  assert.deepEqual(pageReferenceProblems('Prices are on our menu page.', [...site, { slug: 'menu', title: 'Menu' }]), []);
  for (const ok of ['See the Visit page for directions.', 'More on our About page.', 'Read the reviews on our Google page.', 'Everything on this page.']) assert.deepEqual(pageReferenceProblems(ok, site), [], ok);
  assert.equal(PIPELINE_REV, 3);
  const c = visitCode("<p>Each location's page lists the details.</p>");
  const opts = { pages, required: ['name'], minPhotos: 0, page: 'visit' };
  assert.match(checkCode(c, input(), opts).join(), /location page/);
  assert.deepEqual(checkCode(c, input(), { ...opts, rev: 2 }).filter((e) => /location page/.test(e)), [], 'a revision 2 version is unchanged');
});

test('before sending: a Visit page needs the verified address and hours, and no page may point to a missing page', () => {
  const job = (facts: Record<string, string>, visit: string, home = '<main><h1>Home</h1></main>'): FrontendJob => ({ input: input(facts), pages: [{ slug: 'visit', title: 'Visit', purpose: '', required: [], minPhotos: 0, requireAction: true }], code: { idea: '', fonts: [], css: '', html: home }, site: { css: '', pages: [{ slug: 'visit', html: visit }] } } as unknown as FrontendJob);
  const full = '<main><h1>Visit</h1><p data-fact="address"></p><p data-fact="hours"></p></main>';
  assert.deepEqual(presendProblems(job({ name: 'X', address: 'A', hours: 'H' }, full)), []);
  const elizabeth = presendProblems(job({ name: 'X', phone: 'P', rating: 'R' }, '<main><h1>Visit</h1><p data-fact="phone"></p></main>', "<main><h1>Home</h1><p>Each location's page has its menus.</p></main>"));
  assert.ok(elizabeth.some((p) => /no verified address/.test(p)));
  assert.ok(elizabeth.some((p) => /no verified hours/.test(p)));
  assert.ok(elizabeth.some((p) => /On the home page: "Each location's page has its menus\." refers to a location page/.test(p)));
  assert.ok(presendProblems(job({ name: 'X', address: 'A', hours: 'H' }, '<main><h1>Visit</h1><p data-fact="address"></p></main>')).some((p) => /does not show the verified hours/.test(p)));
});

const doc = (body: string, css: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{margin:0;font:16px/1.5 sans-serif;background:#fff;color:#111}main{max-width:900px;margin:auto;padding:20px}${css}</style></head><body><main><h1>Test</h1>${body}</main></body></html>`;
const photo = (id: string) => `<img data-photo="${id}" src="https://img.test/${id}.jpg" width="800" height="600" alt="Cake">`;
const skip = screenshotsAvailable() ? false : 'no browser here';

test('the rendered review: text covered by a photo fails; text beside or over a photo does not', { skip }, async () => {
  const browser = await launchBrowser();
  try {
    const coveredCss = '.pair{position:relative;height:420px}.a{position:absolute;left:0;top:0;width:360px}.a img,.b img{display:block;width:100%;height:auto}.b{position:absolute;left:120px;top:200px;width:360px}';
    const covered = doc(`<div class="pair"><figure class="a">${photo('p1')}<figcaption>From the cafe archive</figcaption></figure><figure class="b">${photo('p2')}</figure></div>`, coveredCss);
    const r = await reviewPages([{ slug: 'home', html: covered }], { offline: true, browser, links: [], widths: [1440] });
    assert.ok(r.problems.some((p) => /the text "From the cafe archive" is covered by photo p2/.test(p)), r.problems.join(' | '));
    const fine = doc(`<figure class="a">${photo('p1')}<figcaption>From the cafe archive</figcaption></figure><div class="hero"><img data-photo="p2" src="https://img.test/p2.jpg" width="800" height="600" alt="x"><h2>Over the photo</h2></div>`, '.a img{width:360px;height:auto;display:block}.hero{position:relative}.hero img{width:100%;height:auto;display:block}.hero h2{position:absolute;left:20px;bottom:20px;margin:0;color:#fff;background:#000}');
    const f = await reviewPages([{ slug: 'home', html: fine }], { offline: true, browser, links: [], widths: [1440, 390] });
    assert.deepEqual(f.problems.filter((p) => /covered by photo/.test(p)), []);
  } finally { await browser.close(); }
});

test('the rendered review: a mask that hides a photo card fails the version; a round or arched photo frame passes', { skip }, async () => {
  const browser = await launchBrowser();
  try {
    const card = (cls: string) => `<ul class="tickets"><li class="ticket"><div class="${cls}"><div class="frame">${photo('p1')}</div><p class="name">Plant Love Cake</p></div></li></ul>`;
    const base = '.tickets{list-style:none;padding:0}.ticket{width:320px;padding:16px;background:#3c7b7b}.paper{background:#fdf6ec;padding:16px}.frame{aspect-ratio:1}.frame img{width:100%;height:100%;object-fit:cover;display:block}.name{margin:8px 0 0}';
    // Sugar Mama's version 2: the card's notch mask was a fully transparent gradient, so the whole card disappeared
    const hidden = await reviewPages([{ slug: 'home', html: doc(card('paper'), `${base}.paper{-webkit-mask:radial-gradient(circle at 50% 100%,transparent 0 0);mask:radial-gradient(circle at 50% 100%,transparent 0 0)}`) }], { offline: true, browser, links: [], widths: [1440] });
    assert.ok(hidden.problems.some((p) => /essential content is hidden by a CSS mask or clip path: div\.paper \(photo p1\)/.test(p)), hidden.problems.join(' | '));
    const shaped = await reviewPages([{ slug: 'home', html: doc(card('paper'), `${base}.frame{clip-path:ellipse(50% 50% at 50% 50%)}.paper .frame + .name{clip-path:inset(0)}`) }], { offline: true, browser, links: [], widths: [1440] });
    assert.deepEqual(shaped.problems.filter((p) => /mask or clip path/.test(p)), [], 'a shaped photo still shows its photo');
  } finally { await browser.close(); }
});
