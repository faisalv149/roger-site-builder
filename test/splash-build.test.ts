// The splash page from plan to served page (no network, no AI): the generator's input and actions, the splash checks
// of an answer (screens, headline, template tells, motion), the compiled page (head, JSON-LD, dock, quote sheet,
// Google attribution, preview ribbon), Google slots filled live, and the rendered review at 1440 and 390.
// Synthetic business; the answer stands in for Claude's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-build-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { splashInput, splashActions, dockActions, splashCodeProblems, compileSplash, splashJsonLd, cityOf } = await import('../src/splash/build.js');
const { fillGoogleSlots, hoursToday } = await import('../src/splash/slots.js');
const { tradeRow } = await import('../src/splash/playbook.js');
const { planScreens } = await import('../src/splash/screens.js');
const { reviewPages } = await import('../src/studio/frontend/review.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
import type { SplashPlan } from '../src/splash/collect.js';
import type { FrontendInput } from '../src/studio/frontend/page.js';
import type { SplashCode } from '../src/splash/prompt.js';

const at = '2026-11-23T10:00:00Z';
const F = (field: string, value: string | string[] | number | boolean, source: 'google' | 'website' | 'owner' = 'google') => ({ field, value, source, source_ref: `${source}:${field}`, retrieved_at: at });
const row = tradeRow('plumber');
const material = { reviews: 3, credentials: 1, offerings: 4, photos: 6, processStated: false, aboutName: false, aboutStory: false, faqs: 0 };
const plan: SplashPlan = {
  placeId: 'PLACEtest', businessKey: 'place-PLACEtest', revision: 1, trade: { row: 'plumber', confidence: 0.95, via: 'primary-type' },
  fact_sheet: [F('name', 'Ridge Line Plumbing'), F('category', 'Plumber'), F('address', '1 Test Rd, Austin, TX 78701, USA'), F('geo', '30.1,-97.7'), F('phone', '(512) 555-0100'),
    F('hours', ['Monday: 8:00 AM – 5:00 PM', 'Tuesday: 8:00 AM – 5:00 PM', 'Saturday: Closed']), F('maps_url', 'https://maps.example/p'), F('rating', 4.8), F('review_count', 120), F('open_now', true),
    F('licence', 'Licensed master plumber', 'website'), F('service_area', ['Austin', 'Round Rock'], 'website'), F('services', ['Drain clearing | https://ridgeline.example/drains', 'Water heaters'], 'website'),
    F('site_pages', ['Drains | https://ridgeline.example/drains', 'About us | https://ridgeline.example/about'], 'website'), F('same_as', ['https://www.facebook.com/ridgeline.example'], 'website')],
  conflicts: [], open_questions: [], reviews: { selected: [], skipped: [], howChosen: '' }, material, screen_plan: planScreens(row, material), injection: [],
};
const listing = (n: number) => ({ id: `g${n}`, url: `google-listing:PLACEtest#${n}`, width: 1600, height: 1200, orientation: 'landscape' as const, uses: ['hero', 'card'], alt: 'Photo from Google Maps', seen: 'A plumber fitting a copper pipe under a sink', seenKind: 'work', services: [], fp: `fp${n}` });
const base: FrontendInput = {
  business: { name: 'Ridge Line Plumbing', category: 'Plumber', website: 'https://ridgeline.example/', summary: null }, colours: ['#0B5FAD'],
  facts: { name: 'Ridge Line Plumbing', rating: '4.8★ from 120 Google reviews', 'service-drains': 'Drain clearing', 'service-heaters': 'Water heaters', 'service-leaks': 'Leak repair', 'service-fixtures': 'Fixture installs' },
  actions: [{ id: 'call', label: 'Call', href: 'tel:+15125550100', kind: 'call', factId: 'phone' }], photos: [1, 2, 3, 4].map(listing), ownLines: [], services: [], items: [], story: null, notes: [],
};
const input = splashInput(plan, base, row);
const screens = plan.screen_plan.screens.map((s) => s.screen);

/** an answer as Claude would give it: every planned screen, bindings only for facts */
function answer(over: Partial<SplashCode> = {}, hero = ''): SplashCode {
  const sec = (id: string, inner: string) => `<section id="${id}" data-screen="${id}"${id === 'hero' ? ' data-rk-hero="split" data-rk-sequence="direct"' : ''}>${inner}</section>`;
  const body: Record<string, string> = {
    hero: hero || '<h1 data-copy="headline">Plumbing repairs across Austin</h1><p data-copy="subline">Leaks, drains and water heaters, fixed by a licensed local plumber.</p><p><span data-google="rating"></span> from <span data-google="review_count"></span> reviews</p><a data-action="call">Call</a><div class="ph"><img data-photo="g1"></div>',
    proof: '<h2>What people say</h2><div data-google="reviews"></div><p data-fact="licence"></p>',
    offer: '<h2>What we fix</h2><ul><li data-fact="service-drains"></li><li data-fact="service-heaters"></li><li data-fact="service-leaks"></li><li data-fact="service-fixtures"></li></ul>',
    work: '<h2>Recent jobs</h2><div class="g"><div class="ph"><img data-photo="g2"></div><div class="ph"><img data-photo="g3"></div><div class="ph"><img data-photo="g4"></div></div>',
    expect: '<h2>How it works</h2><ol><li>Call or send the job details.</li><li>We confirm what is needed.</li><li>We fix it and walk you through it.</li></ol>',
    where: '<h2>Find us</h2><p data-fact="address"></p><p data-fact="hours"></p><p><span data-google="open_now"></span> <span data-google="hours_today"></span></p><p data-fact="phone"></p><p data-fact="service_area"></p><a data-action="directions">Directions</a>',
    cta: '<h2>Need a plumber?</h2><a data-action="call">Call</a> <a data-action="quote">Quote</a>',
  };
  return {
    motion: { hero: { treatment: 'subtle', reason: 'The headline names the trade and town; nothing needs staging.' }, section: { screen: screens[1], treatment: 'subtle', reason: 'The reviews carry the proof; a quiet reveal suits them.' } },
    idea: 'Clean pipework lines.', design_tokens: { primary: '#0B5FAD', accent: '#F2A900', background: '#FFFFFF', text: '#111827' }, meta_description: 'Plumbing repairs, drains and water heaters in Austin from a licensed local plumber.', fonts: ['Inter'],
    css: 'body{margin:0;font:18px/1.6 Inter,system-ui}section{padding:48px 20px}.ph{aspect-ratio:4/3;overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover}.g{display:grid;gap:12px}@media (min-width:768px){.g{grid-template-columns:repeat(3,1fr)}}',
    html: `<header><span data-fact="name"></span></header><main>${screens.map((s) => sec(s, body[s])).join('')}</main><footer><p data-fact="name"></p></footer>`, ...over,
  };
}

test('actions: verified destinations and labels that say what happens; the trade\'s main action, else call', () => {
  const acts = splashActions(plan, base, row);
  assert.deepEqual(acts.map((a) => a.kind), ['call', 'text', 'directions', 'quote', 'menu']);
  assert.equal(acts[1].href, 'sms:+15125550100?&body=Hi%2C%20I%20found%20you%20on%20your%20website.');
  assert.match(acts[2].href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=1%20Test%20Rd.*&destination_place_id=PLACEtest$/);
  const d = dockActions(acts, row)!;
  assert.equal(d.main.kind, 'call'); assert.deepEqual(d.secondary.map((a) => a.kind), ['quote', 'text', 'directions']);
  assert.equal(cityOf('1905 S 1st St, Austin, TX 78704, USA'), 'Austin');
  assert.equal(cityOf('Plaza 01, Paragon City, Lahore, 54000, Pakistan'), 'Lahore');
  assert.equal(input.facts.rating, undefined, 'the rating is never a written fact: it is a live slot');
  assert.equal(input.facts.service_area, 'Austin, Round Rock');
});

test('the splash checks: planned screens in order, headline and sub-line lengths, template tells, motion rules', () => {
  assert.deepEqual(splashCodeProblems(answer(), plan, input), []);
  const p = (code: SplashCode) => splashCodeProblems(code, plan, input).join('\n');
  assert.match(p(answer({ html: answer().html.replace('<section id="faq"', '<section id="x"').replace(/<section id="work"[\s\S]*?<\/section>/, '') })), /must be exactly, in order: hero, proof, offer, work, expect, where, cta/);
  assert.match(p(answer({}, '<h1 data-copy="headline">The friendly plumbing repairs team serving all of Austin</h1><p data-copy="subline">x</p><a data-action="call">Call</a>')), /more than 8 words/);
  assert.match(p(answer({ css: `${answer().css}.k{text-transform:uppercase}` })), /uppercase/);
  assert.match(p(answer({ css: `${answer().css}.h{animation:in .4s}` })), /prefers-reduced-motion/);
  assert.match(p(answer({}, '<h1 data-copy="headline">Plumbing <em>done</em> right</h1><p data-copy="subline">x</p><a data-action="call">Call</a>')), /italic word/);
  assert.match(p(answer({ html: answer().html.replace('<a data-action="directions">Directions</a>', '<a data-action="directions">Directions →</a>') })), /arrow/);
  assert.match(p(answer({ meta_description: 'Serving Austin since 1998.' })), /no digits/);
  assert.match(p(answer({ html: answer().html.replace('<h2>Recent jobs</h2>', '<h2>Recent jobs</h2><p>Photos from our Google listing.</p>') })), /mention Google/);
});

test('the compiled page: title, meta, JSON-LD (no ratings), Google attribution, dock, quote sheet, footer links, preview ribbon', () => {
  const html = compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'preview', quoteAction: '/api/splash/sp_0000000000000001/quote' });
  const $ = load(html);
  assert.equal($('title').text(), 'Ridge Line Plumbing | Plumber in Austin');
  assert.equal($('meta[name="robots"]').attr('content'), 'noindex, nofollow');
  assert.equal($('link[rel="canonical"]').length, 0, 'no canonical in preview');
  const ld = JSON.parse($('script[type="application/ld+json"]').text());
  assert.equal(ld['@type'], 'Plumber'); assert.equal(ld.telephone, '(512) 555-0100');
  assert.deepEqual(ld.openingHoursSpecification[0], { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' });
  assert.equal(ld.aggregateRating, undefined); assert.equal(ld.review, undefined);
  assert.equal(ld.hasOfferCatalog.itemListElement.length, 2);
  assert.equal($('#hero .g-src').length, 1, 'the Google Maps attribution beside the rating');
  assert.ok($('nav.rg-dock[aria-label="Quick actions"]').length);
  assert.equal($('.rg-main').attr('href'), 'tel:+15125550100'); assert.equal($('.rg-main').attr('data-event'), 'dock_call');
  assert.ok($('#quote.rg-sheet form[action="/api/splash/sp_0000000000000001/quote"] textarea[name="need"]').length, 'a quote form');
  assert.equal($('#cta a[data-action="quote"]').attr('href'), '#quote');
  assert.equal($('#cta a[data-action="call"]').attr('data-event'), 'cta_call'); assert.equal($('#cta a[data-action="call"]').attr('data-screen'), 'cta');
  assert.match($('footer .rg-footer-links').text(), /Drains\s+About us/);
  assert.equal($('.rg-ribbon').text(), 'Preview');
  const live = compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'live', canonical: 'https://ridgeline.example/' });
  assert.equal(load(live)('link[rel="canonical"]').attr('href'), 'https://ridgeline.example/');
  assert.equal(load(live)('.rg-ribbon').length, 0); assert.equal(load(live)('meta[name="robots"]').length, 0);
  // a health trade: an appointment request (name, phone, preferred time)
  const dental = { ...plan, trade: { ...plan.trade, row: 'dentist' } };
  const h = load(compileSplash(answer({ html: answer().html.replace('<a data-action="quote">Quote</a>', '<a data-action="book">Book</a>') }), dental, splashInput(dental, base, tradeRow('dentist')), { id: 'sp_0000000000000002', mode: 'preview' }));
  assert.deepEqual(h('#quote input, #quote textarea').toArray().map((e) => h(e).attr('name')), ['name', 'phone', 'time']);
});

test('Google slots filled live: rating, count, open now, today\'s hours, the selected reviews; nothing live, nothing shown', () => {
  const html = compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'preview' });
  const r = (rating: number, text: string, author: string) => ({ author, authorUri: `https://maps.example/u/${author}`, avatar: `https://img.example/${author}.png`, text, rating, mapsUri: `https://maps.example/r/${author}` });
  const live = { rating: 4.8, userRatingCount: 1234, openNow: true, utcOffsetMinutes: 0, weekday: ['Monday: 8:00 AM – 5:00 PM', 'Sunday: Closed'], mapsUri: 'https://maps.example/p',
    reviews: [r(5, 'Came the same afternoon and fixed the leak under our sink. Clear price before starting.', 'Ana'), r(2, 'Late and expensive, would not use again for any job.', 'Bo'), r(5, 'Tidy, quick and explained everything about the new water heater.', 'Cy')] };
  const $ = load(fillGoogleSlots(html, live, { now: new Date('2026-11-22T10:00:00Z') }));
  assert.equal($('#hero [data-google="rating"]').text(), '4.8'); assert.equal($('#hero [data-google="review_count"]').text(), '1,234');
  assert.equal($('[data-google="open_now"]').text(), 'Open now');
  assert.equal($('[data-google="hours_today"]').text(), 'Today: Closed', '22 Nov 2026 is a Sunday');
  assert.deepEqual($('[data-google$=".author"]').toArray().map((e) => $(e).text()), ['Ana', 'Cy'], 'the complaint is skipped');
  assert.match($('.g-reviews__label').text(), /^Selected reviews · 4\.8★ from 1,234 Google reviews$/);
  assert.match($('.g-reviews__how').text(), /Selected from recent 4- and 5-star Google reviews\. Reviews from Google Maps\./);
  assert.equal($('[data-google="review.1.maps_uri"]').attr('href'), 'https://maps.example/r/Ana');
  const none = load(fillGoogleSlots(html, null));
  assert.equal(none('[data-google]').length, 0, 'no live data: the slots go');
  assert.equal(none('#hero .g-src').length, 0, 'and their attribution with them');
  assert.equal(hoursToday(['Monday: 9 AM – 5 PM'], -300, new Date('2026-11-24T03:00:00Z')), 'Today: 9 AM – 5 PM', 'the business\'s own time zone');
});

test('the rendered review: the compiled page passes at 1440 and 390 (credits, links, overflow, accessibility)', { skip: screenshotsAvailable() ? false : 'no browser here' }, async () => {
  const filled = (html: string) => { const $ = load(html); $('img[data-gphoto]').each((_, el) => { $(el).attr('src', `https://img.test/${$(el).attr('data-gphoto')!.replace('#', '-')}.jpg`); }); $('.gcredit').html('Photo: <a href="https://maps.example/u">Test Person</a> · <a href="https://maps.example/p">Google Maps</a>'); return $.html(); };
  const html = fillGoogleSlots(filled(compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'preview' })), { rating: 4.8, userRatingCount: 120, openNow: true, weekday: [], reviews: [], mapsUri: 'https://maps.example/p' });
  const browser = await launchBrowser();
  try {
    const r = await reviewPages([{ slug: 'home', html }], { offline: true, browser, version: 'sp_0000000000000001', links: [] });
    assert.deepEqual(r.problems, [], r.problems.join('\n'));
  } finally { await browser.close(); }
});

test('the job: plan, input, one repair when the answer fails its checks, then ready; a stopped listing makes no page', async () => {
  const { runSplashJob, getSplashJob, splashBrief } = await import('../src/splash/jobs.js');
  const requests: string[] = [];
  const answers = [answer({}, '<h1 data-copy="headline">The friendly plumbing repairs team serving all of Austin</h1><p data-copy="subline">x</p><a data-action="call">Call</a>'), answer()];
  const transport = { via: 'fake' as const, model: 'claude-opus-5-5', async call(req: { prompt: string }) {
    requests.push(req.prompt);
    return { data: answers[Math.min(requests.length - 1, 1)], usage: { via: 'fake' as const, model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.05, costBasis: 'reported' as const } };
  } };
  const at = new Date().toISOString();
  const job = await runSplashJob({ id: 'sp_00000000000000aa', createdAt: at, updatedAt: at, placeId: 'PLACEtest', status: 'collecting', costUsd: 0, attempts: 0 },
    { transport, review: false, collect: async () => plan, prepare: async () => base });
  assert.equal(job.status, 'ready', job.error ?? ''); assert.equal(job.attempts, 2); assert.equal(requests.length, 2);
  assert.match(requests[1] ?? '', /more than 8 words/, 'the repair names the problem');
  assert.equal(job.model, 'claude-opus-5-5'); assert.ok(job.costUsd >= 0.1);
  assert.equal((await getSplashJob(job.id))?.status, 'ready', 'saved');
  // what Claude is given: no phone or map links, no Google content
  const brief = splashBrief(plan, job.input!);
  assert.doesNotMatch(brief, /tel:|sms:|google-listing:|maps\.|place_id/);
  assert.match(brief, /"main_action":"call"/);
  assert.match(brief, /"motion_cues":\{"visitor_task"/);
  const stopped = await runSplashJob({ id: 'sp_00000000000000ab', createdAt: at, updatedAt: at, placeId: 'PLACEtest', status: 'collecting', costUsd: 0, attempts: 0 },
    { transport, review: false, collect: async () => ({ ...plan, stop: 'the listing\'s status is CLOSED_PERMANENTLY' }), prepare: async () => base });
  assert.equal(stopped.status, 'stopped'); assert.equal(requests.length, 2, 'no AI call for a stopped listing');
});

test('footer links to the business\'s own pages: readable labels, the home page as "Full website", builder leftovers skipped', async () => {
  const { footerPages } = await import('../src/splash/build.js');
  const labels = footerPages([
    'Roofing Contractor Round Rock TX | Ridge Line Roofing | https://ridgeline.example/',
    'Ridge Line Roofing | Central Texas Roofing & Restoration | https://ridgeline.example/ridge-line-roofing-about-us/',
    'Refund Policy | Ridge Line Roofi | https://ridgeline.example/blank-3',
    'Elementor #4131 - Ridge Line Roofing | https://ridgeline.example/elementor-4131/',
    'Blog - Ridge Line Roofing | https://ridgeline.example/blog/',
    'Exterior Restoration Services | Central Texas | Ridge Line | https://ridgeline.example/exterior-restoration-services/',
    'FAQ’s - Ridge Line Roofing | https://ridgeline.example/faqs/',
  ], 'Ridge Line Roofing').map((p) => p.label);
  assert.deepEqual(labels, ['Full website', 'About Us', 'Refund Policy', 'Blog', 'Exterior Restoration Services', 'FAQ’s']);
});

test('Google slots in one line share one attribution; a page that labels "Today:" gets the bare hours', () => {
  const html = compileSplash(answer({}, '<h1 data-copy="headline">Plumbing repairs across Austin</h1><p data-copy="subline">Leaks fixed.</p><p class="t"><span data-google="open_now"></span> · <span>Today: <span data-google="hours_today"></span></span></p><a data-action="call">Call</a>'), plan, input, { id: 'sp_0000000000000001', mode: 'preview' });
  const $ = load(fillGoogleSlots(html, { openNow: false, utcOffsetMinutes: 0, weekday: ['Sunday: Closed'], reviews: [] }, { now: new Date('2026-11-22T10:00:00Z') }));
  assert.equal($('#hero .t .g-src').length, 1);
  assert.equal($('#hero [data-google="hours_today"]').text(), 'Closed');
  assert.doesNotMatch($('#hero .t').text(), /Today:\s*Today/);
});

test('a "Today" label in its own element still gets the bare hours; the reviews list has no bullets', () => {
  const html = compileSplash(answer({}, '<h1 data-copy="headline">Plumbing repairs across Austin</h1><p data-copy="subline">Leaks fixed.</p><p class="t"><b>Today</b> <span data-google="hours_today"></span></p><a data-action="call">Call</a>'), plan, input, { id: 'sp_0000000000000001', mode: 'preview' });
  const $ = load(fillGoogleSlots(html, { utcOffsetMinutes: 0, weekday: ['Sunday: Closed'], reviews: [] }, { now: new Date('2026-11-22T10:00:00Z') }));
  assert.equal($('#hero [data-google="hours_today"]').text(), 'Closed');
  assert.match($('head style').text(), /\.g-reviews__list\{list-style:none/);
});

test('fonts served by Roger: no request to Google; the display face preloaded; without them, Google\'s stylesheet as before', () => {
  const faces = [{ family: 'Inter', style: 'normal', weight: '400 800', subset: 'latin', unicodeRange: 'U+0000-00FF', key: 'a'.repeat(24) }];
  const $ = load(compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'preview', imageBase: 'https://roger.example', fontFaces: faces }));
  assert.equal($('link[href*="fonts.googleapis.com"]').length, 0);
  assert.equal($('link[rel="preload"][as="font"]').attr('href'), `https://roger.example/api/splash/fonts/${'a'.repeat(24)}.woff2`);
  assert.match($('head style').first().text(), /@font-face\{font-family:'Inter'/);
  const g = load(compileSplash(answer(), plan, input, { id: 'sp_0000000000000001', mode: 'preview' }));
  assert.equal(g('link[href*="fonts.googleapis.com"]').length, 1);
});

test('a quote request\'s photo: upright, at most 1600 px, no camera metadata, kept apart; none kept for a health trade', async () => {
  const sharp = (await import('sharp')).default;
  const { saveSplashLead, runSplashJob } = await import('../src/splash/jobs.js');
  const { studioDocs } = await import('../src/store.js');
  const at = new Date().toISOString();
  const transport = { via: 'fake' as const, model: 'claude-opus-5-5', async call() { return { data: answer(), usage: { via: 'fake' as const, model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costBasis: 'reported' as const } }; } };
  await runSplashJob({ id: 'sp_00000000000000ac', createdAt: at, updatedAt: at, placeId: 'PLACEtest', status: 'collecting', costUsd: 0, attempts: 0 }, { transport, review: false, images: false, collect: async () => plan, prepare: async () => base });
  const camera = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#556677' } }).withExif({ IFD0: { Make: 'TestCam', Model: 'Phone 1' } }).jpeg().toBuffer();
  assert.ok((await sharp(camera).metadata()).exif, 'the test photo carries camera metadata');
  const lead = await saveSplashLead('sp_00000000000000ac', { name: 'Test Visitor', phone: '5125550199', need: 'Leaking pipe under the sink' }, { buffer: camera, mimetype: 'image/jpeg' });
  assert.ok(lead?.photoId);
  const stored = await studioDocs.get<{ data: string; leadId: string }>('splash-lead-photos', lead!.photoId!);
  assert.equal(stored?.leadId, lead!.id);
  const m = await sharp(Buffer.from(stored!.data, 'base64')).metadata();
  assert.equal(m.width, 1600); assert.equal(m.height, 1200); assert.equal(m.exif, undefined, 'no camera metadata kept');
  const notPhoto = await saveSplashLead('sp_00000000000000ac', { name: 'Test Visitor', phone: '5125550199', need: 'x' }, { buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf' });
  assert.equal(notPhoto?.photoId, undefined); assert.match(notPhoto?.photoNote ?? '', /not a photo/);
  // a health trade: no photo field, and a photo sent anyway is not kept
  const dental = { ...plan, trade: { ...plan.trade, row: 'dentist' } };
  await runSplashJob({ id: 'sp_00000000000000ad', createdAt: at, updatedAt: at, placeId: 'PLACEtest', status: 'collecting', costUsd: 0, attempts: 0 }, { transport, review: false, images: false, collect: async () => dental, prepare: async () => base });
  const h = await saveSplashLead('sp_00000000000000ad', { name: 'Test Visitor', phone: '5125550199', time: 'mornings' }, { buffer: camera, mimetype: 'image/jpeg' });
  assert.equal(h?.photoId, undefined); assert.match(h?.photoNote ?? '', /health/);
  const q = load(compileSplash(answer(), plan, input, { id: 'sp_00000000000000ac', mode: 'preview', quoteAction: '/q' }));
  assert.equal(q('#quote input[name="photo"][type="file"][accept="image/*"]').length, 1); assert.equal(q('#quote form').attr('enctype'), 'multipart/form-data');
  assert.equal(q('a[data-action="directions"]').attr('data-apple'), 'https://maps.apple.com/?daddr=1%20Test%20Rd%2C%20Austin%2C%20TX%2078701%2C%20USA');
});

test('step 9 checks: passed on a clean page; a claim, a wrong number and dead links reported; dead own-site links removed', async () => {
  const { splashQa } = await import('../src/splash/qa.js');
  type Job = Parameters<typeof splashQa>[0];
  const r = (rating: number, text: string, author: string) => ({ author, authorUri: `https://maps.example/u/${author}`, avatar: '', text, rating, mapsUri: `https://maps.example/r/${author}` });
  const live = { rating: 4.8, userRatingCount: 120, openNow: true, utcOffsetMinutes: 0, weekday: ['Sunday: Closed'], mapsUri: 'https://maps.example/p', reviews: [r(5, 'Came the same afternoon and fixed the leak under our sink. Clear price before starting.', 'Ana')] };
  const credited = (html: string) => { const $ = load(html); $('.gcredit').html('Photo: <a href="https://maps.example/u">Test Person</a> · <a href="https://maps.example/p">Google Maps</a>'); return $.html(); };
  const page = (code: SplashCode, dead: string[] = []) => fillGoogleSlots(credited(compileSplash(code, plan, input, { id: 'sp_0000000000000001', mode: 'preview', deadLinks: dead })), live, { now: new Date('2026-11-22T10:00:00Z') });
  const job = (code: SplashCode): Job => ({ id: 'sp_0000000000000001', createdAt: '', updatedAt: '', placeId: 'PLACEtest', status: 'ready', costUsd: 0, attempts: 2, plan, input, code, repairs: ['The headline "x" has more than 8 words.'] });
  const fetchOk = async (u: string) => ({ ok: true, status: 200, url: u, redirects: [], headers: {}, body: Buffer.alloc(0), ttfbMs: 1, totalMs: 1 });
  const clean = await splashQa(job(answer()), page(answer()), { browser: false, fetch: fetchOk });
  assert.deepEqual(clean.needs_human, [], clean.needs_human.join('\n'));
  for (const want of [/comes from the fact sheet/, /No stock or generated images/, /Reviews are verbatim/, /go to the business's number/, /JSON-LD is valid \(Plumber/, /watch-outs are honoured/, /Every link-out resolves \(\d+ checked\)/]) assert.ok(clean.passed.some((p) => want.test(p)), `${want}\n${clean.passed.join('\n')}`);
  assert.match(clean.fixed.join('\n'), /first draft was repaired/);
  // a claim the business never made, a call link to another number, a dead footer page and a dead booking link
  const bad = answer({ html: answer().html.replace('<h2>Need a plumber?</h2>', '<h2>Need a plumber?</h2><p>We offer financing on bigger jobs.</p>') });
  const fetchDead = async (u: string) => ({ ...(await fetchOk(u)), ok: !/drains/.test(u), status: /drains/.test(u) ? 404 : 200 });
  // (the compiler refuses a typed phone link: this one stands for a page changed after it was made)
  const q = await splashQa(job(bad), page(bad).replace('</main>', '<a href="tel:+15125559999">Call</a></main>'), { browser: false, fetch: fetchDead });
  assert.match(q.needs_human.join('\n'), /"financing"/);
  assert.match(q.needs_human.join('\n'), /do not match the business's number: tel:\+15125559999/);
  assert.deepEqual(q.deadLinks, ['https://ridgeline.example/drains']);
  assert.match(q.fixed.join('\n'), /Removed a dead link to https:\/\/ridgeline\.example\/drains \(HTTP 404\)/);
  // served again: the dead link is gone from the footer
  const $ = load(page(answer(), q.deadLinks));
  assert.equal($('.rg-footer-links a[href="https://ridgeline.example/drains"]').length, 0);
  assert.equal($('.rg-footer-links a').length, 1);
});

test('step 9 in a browser: the first screen at 390 x 844, JavaScript off, reduced motion, layout shift, dock targets', { skip: screenshotsAvailable() ? false : 'no browser here' }, async () => {
  const { splashQa } = await import('../src/splash/qa.js');
  type Job = Parameters<typeof splashQa>[0];
  const code = answer({ css: `${answer().css}@media (prefers-reduced-motion:no-preference){@supports (animation-timeline:view()){.g{animation:rv .4s both;animation-timeline:view()}}@keyframes rv{from{opacity:0}}}` });
  const html = fillGoogleSlots(compileSplash(code, plan, input, { id: 'sp_0000000000000001', mode: 'preview' }), { rating: 4.8, userRatingCount: 120, openNow: true, weekday: [], reviews: [], mapsUri: 'https://maps.example/p' });
  const job: Job = { id: 'sp_0000000000000001', createdAt: '', updatedAt: '', placeId: 'PLACEtest', status: 'ready', costUsd: 0, attempts: 1, plan, input, code };
  const q = await splashQa(job, html, { links: false });
  const all = q.passed.join('\n');
  assert.match(all, /At 390 x 844 the first screen shows what they do, where, a call button and the main action \(call, on the page and in the dock\)/);
  assert.match(all, /reads fully with JavaScript off/);
  assert.match(all, /Reduced motion is respected/);
  assert.match(all, /no layout shift/);
  assert.match(all, /Every dock target is 44 px or larger/);
});
