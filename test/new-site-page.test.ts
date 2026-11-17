// The staff New site page (public/app/frontend.*) in a real browser, with the Studio APIs answered locally (synthetic
// businesses; no network, no AI). An address search returns businesses to choose from: none is selected for staff, and
// neither research nor generation can start until staff press "Select this business" on the right one. Research that
// lands on another listing is not used. The page fits a phone without sideways scrolling.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');

const C = (placeId: string, name: string, address: string, extra: Record<string, unknown> = {}) => ({ placeId, name, address, primaryTypeLabel: 'Restaurant', types: ['restaurant'], mapsUrl: `https://maps.example/${placeId}`, rating: 4.6, reviewCount: 88, ...extra });
const AT_ADDRESS = [
  C('ChIJsynthNeighbour000001', 'Oak Street Laundry', '14 Oak St, Austin, TX 78702, USA'),
  C('ChIJsynthCorner000000002', 'Corner Taqueria', '12 Oak St, Austin, TX 78702, USA', { googleWebsite: 'https://corner-taqueria.example/' }),
  C('ChIJsynthPlot00000000003', '12 Oak St', '12 Oak St, Austin, TX 78702, USA', { primaryTypeLabel: 'Premise' }),
];
const dir = path.resolve('public/app');

async function open(width = 1440, over: { research?: 'match' | 'elsewhere' } = {}) {
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname.startsWith('/app/')) { const f = path.join(dir, u.pathname.replace('/app/', '')); return fs.existsSync(f) ? route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404 }); }
    if (req.method() === 'POST') posts.push({ path: u.pathname, body: JSON.parse(req.postData() || '{}') });
    if (u.pathname === '/api/studio/resolve') {
      const b = JSON.parse(req.postData() || '{}');
      // an address alone: the businesses there, never confirmed; a name: the one listing that matches it
      if (!b.name && b.address) return route.fulfill({ json: { status: 'need-name', candidates: AT_ADDRESS, reason: 'an address, not a business', query: b.address } });
      return route.fulfill({ json: { status: 'confirmed', placeId: AT_ADDRESS[1].placeId, candidate: AT_ADDRESS[1], via: 'name-and-address', evidence: [], query: b.name } });
    }
    if (u.pathname === '/api/studio/businesses') return route.fulfill({ json: { businesses: [] } });
    if (u.pathname === '/api/studio/jobs' && req.method() === 'POST') return route.fulfill({ status: 202, json: { id: 'sj_test1', status: 'queued' } });
    if (u.pathname === '/api/studio/jobs/sj_test1') {
      const key = over.research === 'elsewhere' ? 'site-corner-taqueria.example' : `place-${AT_ADDRESS[1].placeId}`;
      return route.fulfill({ json: { id: 'sj_test1', status: 'done', createdAt: new Date(Date.now() - 60000).toISOString(), updatedAt: new Date().toISOString(), businessKey: key, revision: 1, stages: [{ name: 'identity', status: 'done' }, { name: 'brief', status: 'done' }] } });
    }
    if (u.pathname.startsWith('/api/studio/briefs/')) return route.fulfill({ json: { brief: { revision: 1, capturedAt: new Date().toISOString(), route: 'google', identity: { status: 'verified', name: { value: 'Corner Taqueria', status: 'verified' }, category: { value: 'Restaurant', status: 'verified' }, website: { value: null, status: 'unknown' } }, contact: { phone: { value: '(512) 555-0100', status: 'verified' } }, locations: { items: [{ address: { formatted: '12 Oak St, Austin, TX 78702' } }] }, hours: { listing: { value: ['Mon: 9 AM – 5 PM'], status: 'verified' } }, reviews: { value: { rating: 4.6, count: 88 } }, story: { value: null, status: 'unknown' }, assets: { website: { usable: 0, total: 0 }, google: { count: 6 } }, unknowns: [{ field: 'story', why: 'no story found' }] } } });
    if (u.pathname === '/api/studio/frontend-jobs' && req.method() === 'POST') return route.fulfill({ status: 202, json: { id: 'fe_0000000000000001', status: 'queued' } });
    if (u.pathname === '/api/studio/frontend-jobs/fe_0000000000000001') return route.fulfill({ json: { id: 'fe_0000000000000001', status: 'generating', stage: 'homepage', attempts: 1, costUsd: 0.12, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    return route.fulfill({ status: 404, json: { error: 'not part of this test' } });
  });
  await page.goto('http://studio.test/app/frontend.html');
  await page.evaluate('localStorage.clear()');
  return { browser, page, posts };
}
const paidStarts = (posts: { path: string; body: Record<string, unknown> }[]) => posts.filter((p) => p.path === '/api/studio/jobs' || p.path === '/api/studio/frontend-jobs');
const skip = screenshotsAvailable() ? false : 'no browser here';

test('an address search shows the businesses there; none is selected, and research and generation stay closed', { skip }, async () => {
  const { browser, page, posts } = await open();
  try {
    await page.fill('#f-where', '12 Oak St, Austin, TX 78702');
    await page.click('#find-btn');
    await page.waitForSelector('.biz');
    assert.equal(await page.locator('.biz').count(), 3, 'every business at the address is a card');
    assert.match(await page.textContent('#find-status') ?? '', /looks like an address, not a business name\. 3 businesses found there: select the right one/);
    // each card: name, complete address, category, website status and the Maps link
    const card = page.locator('.biz').nth(1);
    assert.match(await card.textContent() ?? '', /Corner Taqueria[\s\S]*12 Oak St, Austin, TX 78702, USA[\s\S]*Restaurant[\s\S]*corner-taqueria\.example[\s\S]*ChIJsynthCorner000000002/);
    assert.match(await page.locator('.biz').nth(0).textContent() ?? '', /None on the listing/);
    assert.equal(await card.locator('a', { hasText: 'Open in Google Maps' }).getAttribute('href'), 'https://maps.example/ChIJsynthCorner000000002');
    // nothing chosen: no selected business, steps 2 and 3 locked, their buttons not on screen
    assert.equal(await page.locator('.biz[aria-current="true"]').count(), 0);
    assert.equal(await page.isHidden('#selected'), true);
    assert.equal(await page.getAttribute('#s-sources', 'data-locked'), '');
    assert.equal(await page.getAttribute('#s-generate', 'data-locked'), '');
    assert.equal(await page.isVisible('#research-btn'), false);
    assert.equal(await page.isVisible('#generate-btn'), false);
    assert.equal(await page.getAttribute('#step-find', 'data-state'), 'current');
    assert.deepEqual(posts.map((p) => p.path), ['/api/studio/resolve'], 'only the search was sent');
    assert.deepEqual(paidStarts(posts), []);
  } finally { await browser.close(); }
});

test('even a single confirmed match is not selected for staff', { skip }, async () => {
  const { browser, page, posts } = await open();
  try {
    await page.fill('#f-name', 'Corner Taqueria'); await page.fill('#f-where', 'Austin, TX');
    await page.click('#find-btn');
    await page.waitForSelector('.biz');
    assert.match(await page.textContent('#find-status') ?? '', /One listing matches\. Check the name and full address, then select it\./);
    assert.equal(await page.isHidden('#selected'), true);
    assert.equal(await page.getAttribute('#s-sources', 'data-locked'), '');
    assert.deepEqual(paidStarts(posts), []);
  } finally { await browser.close(); }
});

test('staff select the right card: its Place ID stays visible; research starts only from its button, for that listing; generation only after the brief', { skip }, async () => {
  const { browser, page, posts } = await open();
  try {
    await page.fill('#f-where', '12 Oak St, Austin, TX 78702');
    await page.click('#find-btn');
    await page.waitForSelector('.biz');
    await page.locator('.biz').nth(1).locator('[data-select]').click();
    assert.match(await page.textContent('#selected') ?? '', /Selected\s*Corner Taqueria[\s\S]*Place ID ChIJsynthCorner000000002/);
    assert.equal(await page.getAttribute('#s-sources', 'data-locked'), null, 'step 2 opens');
    assert.equal(await page.getAttribute('#s-generate', 'data-locked'), '', 'step 3 waits for the brief');
    assert.equal(await page.inputValue('#site-url'), 'https://corner-taqueria.example/', 'the listing\'s website, for staff to check or correct');
    assert.deepEqual(paidStarts(posts), [], 'selecting starts nothing');
    // research for the selected listing (no website: from its Place ID)
    await page.check('#site-none');
    await page.click('#research-btn');
    await page.waitForSelector('.facts');
    assert.deepEqual(paidStarts(posts).map((p) => [p.path, p.body]), [['/api/studio/jobs', { google: 'ChIJsynthCorner000000002' }]]);
    assert.equal(await page.getAttribute('#s-generate', 'data-locked'), null, 'step 3 opens with the brief');
    assert.match(await page.textContent('#brief-out') ?? '', /Verified facts[\s\S]*Corner Taqueria[\s\S]*Missing information[\s\S]*story/);
    // generation from its own button, with that brief
    await page.click('#generate-btn');
    await page.waitForSelector('#generate-meter:not([hidden])');
    assert.deepEqual(paidStarts(posts).map((p) => p.path), ['/api/studio/jobs', '/api/studio/frontend-jobs']);
    assert.deepEqual(posts.find((p) => p.path === '/api/studio/frontend-jobs')?.body, { businessKey: 'place-ChIJsynthCorner000000002', revision: 1, instruction: '' });
    assert.match(await page.textContent('#generate-meter') ?? '', /AI cost\$0\.120/);
  } finally { await browser.close(); }
});

test('research that lands on a different listing (a website pointing elsewhere) is not used; generation stays closed', { skip }, async () => {
  const { browser, page, posts } = await open(1440, { research: 'elsewhere' });
  try {
    await page.fill('#f-where', '12 Oak St, Austin, TX 78702');
    await page.click('#find-btn');
    await page.waitForSelector('.biz');
    await page.locator('.biz').nth(1).locator('[data-select]').click();
    await page.click('#research-btn');
    await page.waitForSelector('#research-listing');
    assert.match(await page.textContent('#brief-out') ?? '', /The website led to a different business record[\s\S]*site-corner-taqueria\.example[\s\S]*not the selected listing place-ChIJsynthCorner000000002\. It is not used\./);
    assert.equal(await page.getAttribute('#s-generate', 'data-locked'), '');
    assert.deepEqual(paidStarts(posts).map((p) => p.path), ['/api/studio/jobs'], 'no generation');
  } finally { await browser.close(); }
});

test('at 390px: the cards and the steps fit without sideways scrolling', { skip }, async () => {
  const { browser, page } = await open(390);
  try {
    await page.fill('#f-where', '12 Oak St, Austin, TX 78702');
    await page.click('#find-btn');
    await page.waitForSelector('.biz');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false);
    const buttons = await page.locator('[data-select]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(buttons.every((h) => h >= 32), `tap targets: ${buttons.join(', ')}`);
  } finally { await browser.close(); }
});
