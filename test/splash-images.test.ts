// Website photos on a splash page at the size the screen needs: public addresses only, the host's own smaller copy
// asked for first, a master kept once, sized copies in the browser's best format, cached; the page's src/srcset.
// Synthetic images (made here), fake fetches: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-images-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { privateAddress, isPublicUrl, upstreamUrl, imageSet, sizedImage, formatFor, ImageError } = await import('../src/splash/images.js');
import type { FetchResult } from '../src/util/http.js';

const publicDns = async () => ['93.184.216.34'];
const photo = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: '#3a6ea5' } }).jpeg().toBuffer();
const answer = (body: Buffer, over: Partial<FetchResult> = {}): FetchResult => ({ ok: true, status: 200, url: 'https://shop.example/photo.jpg', redirects: [], headers: { 'content-type': 'image/jpeg' }, body, ttfbMs: 1, totalMs: 1, ...over });

test('only public addresses: private, loopback, link-local and internal names are refused', async () => {
  for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(privateAddress(ip), false, ip);
  assert.equal(await isPublicUrl('https://shop.example/a.jpg', publicDns), true);
  assert.equal(await isPublicUrl('https://shop.example/a.jpg', async () => ['10.1.2.3']), false, 'a name that resolves inside');
  assert.equal(await isPublicUrl('http://localhost/a.jpg', publicDns), false);
  assert.equal(await isPublicUrl('http://169.254.169.254/latest', publicDns), false);
  assert.equal(await isPublicUrl('file:///etc/passwd', publicDns), false);
  assert.equal(await isPublicUrl('https://user:pw@shop.example/a.jpg', publicDns), false);
});

test('the host\'s own smaller copy is asked for first (Wix, Squarespace); others as found', () => {
  assert.equal(upstreamUrl('https://static.wixstatic.com/media/01808a_abc~mv2.jpg'), 'https://static.wixstatic.com/media/01808a_abc~mv2.jpg/v1/fit/w_2400,h_2400,q_90/01808a_abc~mv2.jpg');
  assert.match(upstreamUrl('https://images.squarespace-cdn.com/content/v1/x/photo.jpg'), /\?format=2500w$/);
  assert.equal(upstreamUrl('https://caliber.example/wp-content/uploads/roof.jpg'), 'https://caliber.example/wp-content/uploads/roof.jpg');
});

test('src, srcset and sizes: every served width up to the photo\'s own, the default at most 1200', () => {
  const s = imageSet('https://roger.example', 'sp_0000000000000001', 'img_1', 1700);
  assert.equal(s.src, 'https://roger.example/api/splash/sp_0000000000000001/img/img_1/1200');
  assert.equal(s.srcset, ['480', '800', '1200', '1600'].map((w) => `https://roger.example/api/splash/sp_0000000000000001/img/img_1/${w} ${w}w`).join(', '));
  assert.ok(s.sizes);
  assert.deepEqual(imageSet('https://roger.example', 'sp_0000000000000001', 'img_2', 300), { src: 'https://roger.example/api/splash/sp_0000000000000001/img/img_2/480' }, 'a small photo: one copy at its own size');
  assert.equal(formatFor('image/avif,image/webp,*/*'), 'avif'); assert.equal(formatFor('image/webp,*/*'), 'webp'); assert.equal(formatFor('*/*'), 'jpeg');
});

test('a sized copy: fetched once (the host\'s smaller copy first), turned into the format asked for, cached', async () => {
  const asked: string[] = [];
  const fetch = async (u: string) => { asked.push(u); return answer(photo, { url: u }); };
  const a = await sizedImage('https://shop.example/big.jpg', 800, 'webp', { fetch, resolve: publicDns });
  assert.equal(a.type, 'image/webp');
  const meta = await sharp(a.body).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 800); assert.equal(meta.height, 533);
  const b = await sizedImage('https://shop.example/big.jpg', 1600, 'avif', { fetch, resolve: publicDns });
  assert.equal((await sharp(b.body).metadata()).width, 1600);
  await sizedImage('https://shop.example/big.jpg', 800, 'webp', { fetch, resolve: publicDns });
  assert.equal(asked.length, 1, 'the original is fetched once; every size comes from the master or the cache');
  // a small original is never enlarged
  const small = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#aa3300' } }).png().toBuffer();
  const c = await sizedImage('https://shop.example/small.png', 1200, 'jpeg', { fetch: async (u) => answer(small, { url: u, headers: { 'content-type': 'image/png' } }), resolve: publicDns });
  assert.equal((await sharp(c.body).metadata()).width, 600);
  // the host's smaller copy fails: the original as found
  const wix: string[] = [];
  await sizedImage('https://static.wixstatic.com/media/x~mv2.jpg', 480, 'jpeg', { fetch: async (u) => { wix.push(u); return /\/v1\/fit\//.test(u) ? answer(Buffer.alloc(0), { ok: false, status: 404, url: u }) : answer(photo, { url: u }); }, resolve: publicDns });
  assert.equal(wix.length, 2); assert.match(wix[0], /\/v1\/fit\//); assert.equal(wix[1], 'https://static.wixstatic.com/media/x~mv2.jpg');
});

test('refused: a private address, a redirect inside, an SVG or page, a width that is not served, a file that is not a photo', async () => {
  const fetch = async (u: string) => answer(photo, { url: u });
  await assert.rejects(sizedImage('https://shop.example/inside.jpg', 800, 'webp', { fetch, resolve: async () => ['10.0.0.9'] }), (e: unknown) => e instanceof ImageError && e.status === 403);
  await assert.rejects(sizedImage('https://shop.example/redirected.jpg', 800, 'webp', { fetch: async () => answer(photo, { url: 'http://127.0.0.1/x.jpg' }), resolve: publicDns }), (e: unknown) => e instanceof ImageError && e.status === 502);
  await assert.rejects(sizedImage('https://shop.example/logo.svg', 800, 'webp', { fetch: async (u) => answer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { url: u, headers: { 'content-type': 'image/svg+xml' } }), resolve: publicDns }), (e: unknown) => e instanceof ImageError && e.status === 502);
  await assert.rejects(sizedImage('https://shop.example/big.jpg', 999, 'webp', { fetch, resolve: publicDns }), (e: unknown) => e instanceof ImageError && e.status === 400);
  await assert.rejects(sizedImage('https://shop.example/not-a-photo.jpg', 800, 'webp', { fetch: async (u) => answer(Buffer.from('not an image at all'), { url: u }), resolve: publicDns }), (e: unknown) => e instanceof ImageError && e.status === 502);
});

test('a host that resets plain requests (Wix): the browser\'s request instead, each of its requests checked', async () => {
  const { warmImages } = await import('../src/splash/images.js');
  const reset = async (u: string) => answer(Buffer.alloc(0), { ok: false, status: 0, url: u, error: 'fetch failed', headers: {} });
  const viaBrowser: string[] = [];
  const browser = async (u: string, allow: (x: string) => Promise<boolean>) => {
    viaBrowser.push(u);
    assert.equal(await allow('http://10.0.0.1/inside'), false, 'the browser is held to public addresses too');
    return { ok: true, status: 200, url: u, type: 'image/jpeg', body: photo };
  };
  const a = await sizedImage('https://static.wixstatic.com/media/reset~mv2.jpg', 480, 'webp', { fetch: reset, browser, resolve: publicDns });
  assert.equal((await sharp(a.body).metadata()).width, 480);
  assert.equal(viaBrowser.length, 1); assert.match(viaBrowser[0], /\/v1\/fit\//, 'the host\'s smaller copy, through the browser');
  // every hop of a plain request is checked before it is made
  let hopCheck: ((u: string) => Promise<boolean>) | undefined;
  await sizedImage('https://shop.example/hops.jpg', 480, 'jpeg', { fetch: async (u, o) => { hopCheck = o.allow; return answer(photo, { url: u }); }, resolve: async (h) => h === 'inside.example' ? ['192.168.0.2'] : ['93.184.216.34'] });
  assert.equal(await hopCheck!('https://inside.example/x.jpg'), false); assert.equal(await hopCheck!('https://cdn.example/x.jpg'), true);
  // warming: each photo once, failures listed
  const w = await warmImages(['https://shop.example/w1.jpg', 'https://shop.example/w1.jpg', 'https://shop.example/w2.jpg'], { fetch: async (u) => /w2/.test(u) ? answer(Buffer.alloc(0), { ok: false, status: 404, url: u }) : answer(photo, { url: u }), browser: false, resolve: publicDns });
  assert.deepEqual(w, { ok: 1, failed: ['https://shop.example/w2.jpg'] });
});

test('the page: website photos from Roger at sized widths; Google listing photos untouched', async () => {
  const { compileSplash } = await import('../src/splash/build.js');
  const { tradeRow } = await import('../src/splash/playbook.js');
  const { planScreens } = await import('../src/splash/screens.js');
  const { splashInput } = await import('../src/splash/build.js');
  const at = '2026-11-23T10:00:00Z';
  const F = (field: string, value: string) => ({ field, value, source: 'google' as const, source_ref: `google:${field}`, retrieved_at: at });
  const row = tradeRow('plumber');
  const material = { reviews: 0, credentials: 0, offerings: 0, photos: 2, processStated: false, aboutName: false, aboutStory: false, faqs: 0 };
  const plan = { placeId: 'P', businessKey: 'place-P', revision: 1, trade: { row: 'plumber', confidence: 1, via: 'owner' as const }, fact_sheet: [F('name', 'Ridge Line Plumbing'), F('phone', '(512) 555-0100'), F('address', '1 Test Rd, Austin, TX 78701')], conflicts: [], open_questions: [], reviews: { selected: [], skipped: [], howChosen: '' }, material, screen_plan: planScreens(row, material), injection: [] };
  const ph = (id: string, url: string, width: number) => ({ id, url, width, height: Math.round(width * 0.66), orientation: 'landscape' as const, uses: ['hero'], alt: 'A plumber at work', seen: 'A plumber at work', services: [], fp: id });
  const base = { business: { name: 'Ridge Line Plumbing', category: 'Plumber', website: 'https://ridgeline.example/', summary: null }, colours: ['#0B5FAD'], facts: { name: 'Ridge Line Plumbing' }, actions: [{ id: 'call', label: 'Call', href: 'tel:+15125550100', kind: 'call' as const, factId: 'phone' }],
    photos: [ph('w1', 'https://ridgeline.example/big.jpg', 1700), ph('g1', 'google-listing:P#1', 1600)], ownLines: [], services: [], items: [], story: null, notes: [] };
  const input = splashInput(plan, base, row);
  const secs = plan.screen_plan.screens.map((s) => s.screen).map((id) => `<section id="${id}" data-screen="${id}">${id === 'hero' ? '<h1 data-copy="headline">Plumbing in Austin</h1><p data-copy="subline">Leaks fixed.</p><a data-action="call">Call</a><div class="f"><img data-photo="w1"></div>' : `<h2>${id}</h2>${id === 'where' ? '<p data-fact="address"></p><p data-fact="phone"></p><div class="f"><img data-photo="g1"></div>' : ''}`}</section>`).join('');
  const code = { idea: 'x', design_tokens: { primary: '#0B5FAD' }, meta_description: 'Plumbing repairs in Austin.', fonts: [], css: 'body{margin:0}', html: `<header><span data-fact="name"></span></header><main>${secs}</main><footer></footer>` };
  const { load } = await import('cheerio');
  const $ = load(compileSplash(code, plan, input, { id: 'sp_0000000000000009', mode: 'preview', imageBase: 'https://roger.example' }));
  const w1 = $('img[data-photo="w1"]');
  assert.equal(w1.attr('src'), 'https://roger.example/api/splash/sp_0000000000000009/img/w1/1200');
  assert.match(w1.attr('srcset')!, /\/w1\/1600 1600w$/); assert.equal(w1.attr('fetchpriority'), 'high');
  assert.doesNotMatch($.html(), /ridgeline\.example\/big\.jpg/, 'the website\'s own file is not linked');
  assert.doesNotMatch($('img[data-gphoto]').attr('src') ?? '', /api\/splash/, 'Google photos stay with Google');
});
