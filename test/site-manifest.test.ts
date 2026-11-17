// The site manifest: the business's own website, ingested by Roger's crawler (the Studio brief job) into one compact
// record the open planner can read — page text, services, brand, pictures and videos, each with its source page,
// duplicates removed, uncertain facts marked for review. A local fixture site; no network, no Google, no Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = 4991;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-manifest-'));
Object.assign(process.env, {
  MOCK: '1', BRAND_MEASURE: '0', STUDIO_RENDER: '0', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', STUDIO_SUMMARY: '0', STUDIO_BACKOFF_MS: '5', STUDIO_PAGE_DELAY_MS: '0',
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`, CRAWL_PAGES: '0', PAGESPEED: '0', RESCORE: '0', STUDIO_OCR: '0',
});
const sharp = (await import('sharp')).default;
const M = await import('../src/studio/manifest.js');
const { startStudioJob, waitForStudioJob, getBrief } = await import('../src/studio/jobs.js');
const { resolveCatalog, emptyReview, ownLineSources } = await import('../src/studio/concepts/review.js');

// ── a fixture bakery: three pages, a paragraph repeated on all three, one photo under two addresses, one video embedded two ways ──
/** a photo-like picture (varied pixels, not a flat graphic) */
const jpg = (r: number, g: number, b: number) => { const w = 1600, h = 1000, px = Buffer.alloc(w * h * 3); let x = r * 7919 + g * 104729 + b; for (let i = 0; i < px.length; i += 3) { x = (x * 1103515245 + 12345) & 0x7fffffff; const n = x % 90; const k = Math.floor(i / 3); px[i] = (r + n + (k % w) / 16) % 256; px[i + 1] = (g + n + k / w / 8) % 256; px[i + 2] = (b + n) % 256; } return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer(); };
const IMGS = new Map<string, Buffer>([['/img/cake.jpg', await jpg(200, 80, 60)], ['/img/shop.jpg', await jpg(40, 120, 160)]]);
IMGS.set('/img/cake-copy.jpg', IMGS.get('/img/cake.jpg')!); // the same photo, another address
IMGS.set('/img/lemon.jpg', await jpg(230, 210, 90)); // a menu item's own photo, loaded lazily
const LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#7A2E2E"/><text x="20" y="50" fill="#fff">Oak Street Bakery</text></svg>');
const ABOUT = 'Oak Street Bakery has baked bread and cakes on Oak Street since we opened our doors, by hand, every morning before six.';
const VISIT = 'Come by the shop for a slice, a coffee and a loaf to take home; we keep a few tables by the window for friends.';
const page = (title: string, body: string) => `<!doctype html><html><head><title>${title} | Oak Street Bakery</title><style>body{color:#2B1D14}.btn{background:#7A2E2E;color:#fff}</style></head><body><header><a href="/"><img class="logo" src="/logo.svg" alt="Oak Street Bakery logo"></a><nav><a href="/">Home</a> <a href="/cakes/">Cakes</a> <a href="/about/">About</a> <a href="/our-menu/">Menu</a></nav></header><main>${body}<p>${VISIT}</p></main><footer><p>Oak Street Bakery · <a href="tel:5125550142">(512) 555-0142</a> · 14 Oak Street, Austin, TX 78704</p></footer></body></html>`;
const PAGES: Record<string, string> = {
  '/': page('Bakery in Austin', `<section class="hero"><h1>Bread and cakes, baked by hand</h1><h2>Voted best bakery in the Readers' Poll</h2><a class="btn" href="/cakes/">See our cakes</a><img src="/img/shop.jpg" alt="The shop front" width="1600" height="1000"></section><section class="services"><h2>Our services</h2><div class="service-card"><img src="/img/cake.jpg" alt="A layer cake" width="800" height="500"><h3>Custom Cakes</h3><p>Birthday and wedding cakes made to order.</p><a href="/cakes/">Learn more</a></div><div class="service-card"><h3>Sourdough Bread</h3><p>Loaves baked fresh every morning.</p></div></section><iframe src="https://www.youtube.com/embed/abcdefghijk" title="A morning at the bakery"></iframe>`),
  '/cakes/': page('Cakes', `<h1>Custom Cakes</h1><p>Every cake starts with a conversation about what you would like, and is finished by hand on the day.</p><img src="/img/cake-copy.jpg" alt="A layer cake" width="1600" height="1000"><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0" title="A morning at the bakery"></iframe>`),
  '/our-menu/': page('Menu', '<h1>Our Menu</h1><h2>Cakes</h2><div class="item"><div class="photo"><img src="/img/placeholder.png" data-src="//127.0.0.1:4991/img/lemon.jpg" alt=""></div><div class="title"><h3>Lemon Layer Cake</h3></div><p>Three layers with lemon curd. $45</p></div><div class="item"><h3>Chocolate Torte</h3><p>Flourless, dense and dark.</p></div><h2>Breads</h2><div class="item"><h3>Country Sourdough</h3><p>A long, slow rise.</p></div>'),
  '/about/': page('About', `<section class="about"><h2>About us</h2><p>${ABOUT}</p></section><video src="/media/oven.mp4" title="The oven at dawn" controls></video>`),
};
const server = http.createServer((req, res) => {
  const p = new URL(req.url!, 'http://x').pathname;
  if (IMGS.has(p)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(IMGS.get(p)); }
  if (p === '/logo.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(LOGO); }
  if (PAGES[p]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES[p]); }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>');
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
test.after(() => server.close());
const SITE = `http://127.0.0.1:${PORT}/`;

test('a menu page is recognised by its address, title or main heading, and its items are read from its headings', () => {
  assert.ok(M.isMenuPage({ type: 'other', url: 'https://x.example/austin-food-menu', headings: [] }));
  assert.ok(M.isMenuPage({ type: 'other', url: 'https://x.example/p', title: 'Dinner Menu', headings: [] }));
  assert.ok(!M.isMenuPage({ type: 'other', url: 'https://x.example/about', title: 'About', headings: [{ level: 1, text: 'Our story' }] }));
  const items = M.menuOfPage('<header><h3>Nav heading</h3></header><h1>Menu</h1><h2>Pies</h2><h3>Pumpkin Pie</h3><p>Spiced, with whipped cream. $32.00</p><h3>Pecan Pie</h3><h2>Cakes</h2><h3>Cookie Cake</h3><footer><h3>Footer heading</h3></footer>');
  assert.deepEqual(items, [{ name: 'Pumpkin Pie', section: 'Pies', description: 'Spiced, with whipped cream.', price: '$32.00', at: 'h3' }, { name: 'Pecan Pie', section: 'Pies', at: 'h3' }, { name: 'Cookie Cake', section: 'Cakes', at: 'h3' }]);
  assert.deepEqual(M.menuOfPage('<h2>Only one</h2><h3>Item</h3>'), [], 'one heading is not a menu');
  // an item in its own nested container, with several sizes: each price stays with its size, nothing run together
  const sized = M.menuOfPage('<h1>Menu</h1><h2>Cakes</h2>' + ['Party Cake', 'Plain Cake'].map((n, i) => '<div class="holder"><div class="photo"><img src="x.jpg"></div><div class="title"><h3>' + n + '</h3></div>' + (i ? '<div class="price">$20.00</div>' : '<div class="price">$30.00/4" Round</div><div class="price">$54.00/6" Round</div>') + '<div class="desc">Vanilla sponge, buttercream.</div></div>').join(''));
  assert.deepEqual(sized, [
    { name: 'Party Cake', section: 'Cakes', description: 'Vanilla sponge, buttercream.', options: [{ label: '4" Round', price: '$30.00' }, { label: '6" Round', price: '$54.00' }], images: ['x.jpg'], at: 'h3' },
    { name: 'Plain Cake', section: 'Cakes', description: 'Vanilla sponge, buttercream.', price: '$20.00', images: ['x.jpg'], at: 'h3' },
  ]);
});

test('one video whatever its embed address; readable paragraphs without the page chrome', () => {
  assert.equal(M.videoKey('https://www.youtube.com/embed/abcdefghijk'), 'youtube:abcdefghijk');
  assert.equal(M.videoKey('https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0'), 'youtube:abcdefghijk');
  assert.equal(M.videoKey('https://youtu.be/abcdefghijk'), 'youtube:abcdefghijk');
  assert.equal(M.videoKey('https://player.vimeo.com/video/123456?h=1'), 'vimeo:123456');
  assert.equal(M.videoKey('https://cdn.example.com/media/oven.mp4?sig=abc'), 'cdn.example.com/media/oven.mp4');
  const ps = M.paragraphsOf(`<header><p>${'Header text that should not count at all. '.repeat(2)}</p></header><main><p>${ABOUT}</p><p>Short.</p><ul><li>${VISIT}</li></ul></main><footer><p>${'Footer text that should not count either, ever. '.repeat(2)}</p></footer>`);
  assert.deepEqual(ps, [ABOUT, VISIT]);
});

test('the crawl becomes a compact manifest: every item with its source page, duplicates merged, uncertain facts for review', async () => {
  const job = await waitForStudioJob((await startStudioJob({ website: SITE })).id);
  assert.equal(job.status, 'done', job.error ?? '');
  const m = await M.saveManifest(job.businessKey!);
  assert.equal(m.schema, 'roger.site-manifest');
  assert.deepEqual(await M.getManifest(m.businessKey, m.revision), m, 'saved per brief revision');
  const pageIds = new Set(m.pages.map((p) => p.id));
  assert.deepEqual(m.pages.map((p) => new URL(p.url).pathname).sort(), ['/', '/about/', '/cakes/', '/our-menu/']);

  // every item says where it came from: a page id the manifest lists, and its URL
  for (const it of [...m.text, ...m.services, ...m.images, ...m.videos]) for (const s of it.src) { assert.ok(s.url, JSON.stringify(it).slice(0, 80)); if (s.page) assert.ok(pageIds.has(s.page), s.page); }
  // page text: headings and paragraphs; the paragraph on every page is kept once, marked site-wide, with all three pages
  assert.ok(m.text.some((t) => t.kind === 'heading' && t.text === 'Bread and cakes, baked by hand' && t.src[0].page === m.pages.find((p) => new URL(p.url).pathname === '/')!.id));
  const visit = m.text.filter((t) => t.text === VISIT);
  assert.equal(visit.length, 1);
  assert.equal(visit[0].siteWide, true);
  assert.equal(visit[0].src.length, 4, 'on all four pages');
  assert.ok(m.text.some((t) => t.kind === 'paragraph' && t.text === ABOUT));
  // services, with the pages that show them
  assert.deepEqual(m.services.map((s) => s.name).sort(), ['Custom Cakes', 'Sourdough Bread']);
  // pictures: the photo under two addresses is one picture, shown on both pages
  const cake = m.images.filter((i) => /cake/.test(i.url));
  assert.equal(cake.length, 1, `one cake photo, not ${cake.length}`);
  assert.deepEqual(cake[0].src.map((s) => new URL(s.url).pathname).sort(), ['/', '/cakes/']);
  assert.ok(m.counts.duplicatesMerged >= 1);
  // videos: the YouTube video embedded two ways is one video on two pages; the file video is its own
  const yt = m.videos.filter((v) => M.videoKey(v.url) === 'youtube:abcdefghijk');
  assert.equal(yt.length, 1);
  assert.equal(yt[0].src.length, 2);
  assert.ok(m.videos.some((v) => /oven\.mp4/.test(v.url)), JSON.stringify(m.videos));
  // a menu set out as a web page: sections and items from its headings; a price read from the layout is for review
  assert.deepEqual(m.menu.map((x) => [x.section, x.name, x.price?.text ?? null, x.price?.status ?? null]), [['Cakes', 'Lemon Layer Cake', '$45', 'review'], ['Cakes', 'Chocolate Torte', null, null], ['Breads', 'Country Sourdough', null, null]]);
  assert.equal(m.menu[0].description, 'Three layers with lemon curd.');
  assert.equal(new URL(m.menu[0].src[0].url).pathname, '/our-menu/');
  assert.ok(m.review.some((r) => /^prices on/.test(r.item)));
  // brand: the logo and the measured colours
  assert.ok(m.brand.logo && /logo\.svg/.test(m.brand.logo.url), JSON.stringify(m.brand.logo));
  // uncertain facts are listed for review, never assumed: the pictures' use and the videos
  assert.ok(m.review.some((r) => /website picture/.test(r.item) && /not confirmed/.test(r.why)));
  assert.ok(m.review.some((r) => /video/.test(r.item)));
  // compact
  assert.ok(JSON.stringify(m).length < 40_000, `${JSON.stringify(m).length} characters`);

  // the planner's own lines are unchanged by keeping their pages
  const { brief, inventory } = await getBrief(m.businessKey);
  const cat = resolveCatalog(brief!, inventory!, emptyReview({ businessKey: brief!.businessKey, revision: brief!.revision, briefHash: brief!.briefHash }));
  assert.deepEqual(cat.ownLines, [...new Set(ownLineSources(inventory!).map((x) => x.text))]);
});

// ───────────────────────── the open planner reads a selection of the manifest ─────────────────────────
test('the planner gets a small selection with source ids; menu details only on request; claims and prices never as fact', async () => {
  const I = await import('../src/studio/concepts/manifest-input.js');
  const D = await import('../src/studio/concepts/designspec.js');
  const R = await import('../src/studio/concepts/director.js');
  const job = await waitForStudioJob((await startStudioJob({ website: SITE })).id);
  const m = await M.saveManifest(job.businessKey!);
  const { brief, inventory } = await getBrief(m.businessKey);
  const cat = resolveCatalog(brief!, inventory!, emptyReview({ businessKey: brief!.businessKey, revision: brief!.revision, briefHash: brief!.briefHash }));

  // the manifest: a photo in a menu item's own block is that item's; an award line is flagged for review
  const lemon = m.menu.find((x) => x.name === 'Lemon Layer Cake')!;
  assert.equal(lemon.images?.length, 1, JSON.stringify(lemon));
  assert.ok(/lemon\.jpg$/.test(m.images.find((i) => i.id === lemon.images![0])!.url));
  assert.deepEqual(m.images.find((i) => i.id === lemon.images![0])!.items, [lemon.id]);
  const award = m.text.find((t) => /Voted best bakery/.test(t.text))!;
  assert.equal(award.flag, 'award-claim');
  assert.equal(award.status, 'review');
  assert.ok(m.review.some((r) => r.item.startsWith(`award claim ${award.id}`) && /never present it as confirmed/.test(r.why)));

  // the selection: small, with ids; no descriptions and no prices
  const sel = I.plannerSelection(m, cat);
  const json = JSON.stringify(sel);
  assert.ok(json.length < 2500, `${json.length} characters`);
  assert.ok(!json.includes('Three layers with lemon curd') && !json.includes('$45'), 'menu details stay out');
  assert.ok(sel.lines.every((l) => cat.ownLines[l.line] === l.text), 'lines carry their ownLine index');
  assert.ok(!sel.lines.some((l) => /Voted best bakery|Lemon Layer Cake/.test(l.text)), 'claims and menu names are not offered as lines');
  const cakes = sel.offerings.menu.find((x) => x.section === 'Cakes')!;
  assert.deepEqual(cakes.examples[0], { id: lemon.id, name: 'Lemon Layer Cake', ...(cat.ownLines.indexOf('Lemon Layer Cake') >= 0 ? { line: cat.ownLines.indexOf('Lemon Layer Cake') } : {}), photo: lemon.images![0] }, 'an item with its own photo leads its section');
  assert.ok(sel.photos.length <= I.SELECTION_LIMITS.photos && sel.photos.every((p) => cat.photos.some((c) => c.id === p.id)), 'only photos the planner may place');
  assert.ok(sel.photos.some((p) => p.item === lemon.id));
  assert.ok(sel.review.claims.some((c) => c.id === award.id));
  assert.match(sel.review.prices ?? '', /never show or state a price as confirmed/);

  // details on request: only the items asked for, prices labelled unconfirmed
  const details = I.menuDetails(m, [lemon.id], cat);
  assert.equal(details.length, 1);
  assert.equal(details[0].description, 'Three layers with lemon curd.');
  assert.equal(details[0].price, "$45 (for the owner's review; not confirmed)");

  // a flagged claim may never be shown
  const flagged = I.flaggedLines(m, cat);
  const at = cat.ownLines.findIndex((l) => /Voted best bakery/.test(l));
  assert.ok(at >= 0 && flagged.has(at));
  const spec = { hero: { kicker: null, headline: { ownLine: at }, lede: null, aside: { items: [] } }, sections: [] } as unknown as import('../src/studio/concepts/designspec.js').DesignSpec;
  assert.match(I.claimProblems(spec, cat, flagged).join(), /hero\.headline: ownLine \d+ \("Voted best bakery[^"]*"\) is an award claim the owner has not confirmed/);

  // in the planner: the direction gets the selection (not every line and photo); the spec gets only the details asked for
  const prompts: Record<string, string[]> = {};
  const usage = { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costBasis: 'computed' as const };
  const idea = { summary: 'Cakes first.', palette: { ground: 'white', surface: 'paper', ink: 'ink', accent: D.brandColors(brief!)[0] ?? 'ink' }, type: { heading: D.brandFonts(brief!)[0] ?? 'Inter', body: D.brandFonts(brief!)[0] ?? 'Inter', treatment: 'Plain.' }, hero: { textSide: 'left', aside: 'image', photoBehindText: false, note: 'A cake beside the name.' }, sections: [{ content: 'the menu', arrangement: 'stack', itemStyle: 'plain', background: 'surface', media: 'none' }], boldElement: 'The cake photo.', alignment: 'left' };
  const direction = { audience: 'Neighbours.', mainJob: { text: 'Visit.', action: null }, characteristic: { text: 'Its cakes.', evidence: [{ kind: 'service', id: cat.services[0]?.id ?? 'x' }] }, idea, critique: [], revised: null, changes: null, menuNeeded: [lemon.id] };
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', async call(req: { stage: string; prompt: string }) { (prompts[req.stage] ??= []).push(req.prompt); return { data: req.stage === 'design:direction' ? direction : {}, usage }; } };
  await D.generateDesignSpec(cat, brief!, null, { transport: t, manifest: m, fallback: () => 'none' });
  const dp = prompts['design:direction'][0];
  assert.ok(dp.includes('From the business\'s website (selected') && !dp.includes('Its own lines (cite as ownLine'), 'the direction reads the selection');
  assert.ok(!dp.includes('Three layers with lemon curd'), 'no menu details before they are asked for');
  const sp = prompts['design:spec'][0];
  assert.ok(sp.includes('Menu details you asked for') && sp.includes('Three layers with lemon curd') && sp.includes('not confirmed'));
  assert.ok(!sp.includes('Flourless, dense and dark'), 'only the item asked for');
});

test('a promotion with a date but no year is not offered to the planner as a line', async () => {
  const I = await import('../src/studio/concepts/manifest-input.js');
  const m = { businessKey: 'k', revision: 1, text: [], menu: [], images: [], services: [], brand: { logo: null, colours: [], fonts: [] } } as unknown as import('../src/studio/manifest.js').SiteManifest;
  const cat = { ownLines: ['Baked by hand every morning', 'Pre-order pies for 11/24 and 11/25', 'Pre-order pies for 11/24/2026'], photos: [] } as unknown as import('../src/studio/concepts/review.js').Catalog;
  assert.deepEqual(I.plannerSelection(m, cat).lines, [{ line: 0, text: 'Baked by hand every morning' }, { line: 2, text: 'Pre-order pies for 11/24/2026' }]);
});

test('the selection leaves out review labels and undated seasonal sections, and ranks photos with a verified subject first', async () => {
  const I = await import('../src/studio/concepts/manifest-input.js');
  type Man = import('../src/studio/manifest.js').SiteManifest;
  type Cat = import('../src/studio/concepts/review.js').Catalog;
  const photo = (id: string, w: number, h: number, alt = '') => ({ id, url: `https://x.example/${id}.jpg`, width: w, height: h, orientation: w > h ? 'landscape' : 'square', uses: w >= 1600 ? ['hero', 'card'] : ['card'], alt, services: [] });
  const img = (id: string, w: number, uses: string[]) => ({ id, url: `https://x.example/${id}.jpg`, w, h: 800, uses, services: [], src: [{ page: 'p1', url: 'https://x.example/' }] });
  const menu = [
    { id: 'm1', name: 'Pumpkin Pie', section: 'Thanksgiving Favorites', images: ['i-pie'], status: 'verified', src: [] },
    { id: 'm2', name: 'Carrot Cake', section: 'Cakes', images: ['i-carrot'], status: 'verified', src: [] },
    { id: 'm3', name: 'Lemon Cake', section: 'Cakes', status: 'verified', src: [] },
  ];
  const m = { businessKey: 'k', revision: 1, text: [], menu, services: [], brand: { logo: null, colours: [], fonts: [] },
    images: [img('i-slide1', 1900, ['hero', 'card']), img('i-slide2', 1800, ['hero', 'card']), img('i-pie', 800, ['card']), img('i-carrot', 800, ['card']), img('i-shop', 1000, ['card'])] } as unknown as Man;
  const cat = {
    ownLines: ['Baked by hand', 'Reviews', 'Review by - Yelp', 'five star review by Jef R.:', 'What our customers say', 'Our cakes', 'Newsletter', 'Hours', 'Find us on...', 'Contact us', 'Events'],
    photos: [photo('i-slide1', 1900, 1200, 'slideshow photo number 1'), photo('i-slide2', 1800, 1200, ''), photo('i-pie', 800, 800), photo('i-carrot', 800, 800), photo('i-shop', 1000, 800, 'The shop counter with cakes on display')],
  } as unknown as Cat;
  const sel = I.plannerSelection(m, cat);
  // review labels and attributions without their text, and empty navigation labels, are not offered
  assert.deepEqual(sel.lines.map((l) => l.text), ['Baked by hand', 'Our cakes']);
  // the undated seasonal section is left out, with its item's photo
  assert.deepEqual(sel.offerings.menu.map((x) => x.section), ['Cakes']);
  assert.ok(!sel.photos.some((p) => p.id === 'i-pie'));
  // verified subjects (an item link, a real description) only; an undescribed photo never leads the page: with no
  // verified photo that fits the hero, the hero is type-led
  assert.deepEqual(sel.photos.map((p) => [p.id, p.role, p.undescribed ?? false]), [['i-carrot', 'card', false], ['i-shop', 'card', false]]);
  assert.equal(sel.photos.find((p) => p.id === 'i-carrot')!.shows, 'Carrot Cake');
  assert.match(sel.hero, /^type-led/);
  // a spec or a direction that puts a photo in the hero anyway is refused
  const spec = (bg: string | null, aside: string | null) => ({ hero: { backgroundPhoto: bg, aside: { kind: aside ? 'image' : 'none', photoId: aside } } }) as unknown as import('../src/studio/concepts/designspec.js').DesignSpec;
  assert.match(I.heroProblems(spec('i-slide1', null), sel).join(), /photo "i-slide1" may not lead the page: no verified photo fits the hero, so make it type-led/);
  assert.match(I.heroProblems(spec(null, 'i-carrot'), sel).join(), /photo "i-carrot" may not lead the page/);
  assert.deepEqual(I.heroProblems(spec(null, null), sel), []);
  const plan = (aside: string, behind: boolean) => ({ idea: { hero: { aside, photoBehindText: behind } }, revised: null });
  assert.match(I.directionHeroProblems(plan('image', false), sel).join(), /idea\.hero: no verified photo fits the hero, so plan it type-led/);
  assert.deepEqual(I.directionHeroProblems(plan('statement', false), sel), []);
  // with a verified hero-sized photo (an image check saw its subject), it may lead, and only it
  const withHero = { ...(cat as object), photos: cat.photos.map((p) => (p.id === 'i-slide2' ? { ...p, seen: 'A tiered wedding cake on a stand' } : p)) } as unknown as Cat;
  const sel2 = I.plannerSelection(m, withHero);
  assert.ok(!sel2.photos.some((p) => p.undescribed));
  assert.deepEqual([sel2.photos[0].id, sel2.photos[0].role, sel2.photos[0].shows], ['i-slide2', 'hero', 'A tiered wedding cake on a stand']);
  assert.match(sel2.hero, /verified photo may lead/);
  assert.deepEqual(I.heroProblems(spec('i-slide2', null), sel2), []);
  assert.match(I.heroProblems(spec('i-slide1', null), sel2).join(), /use one of the verified hero photos \(i-slide2\)/);
});

// ───────────────────────── a business with no website: the Google listing ─────────────────────────
test('no website: the planner reads the listing facts, live attributed reviews and verified photos, and what is missing', async () => {
  const I = await import('../src/studio/concepts/manifest-input.js');
  const D = await import('../src/studio/concepts/designspec.js');
  const R = await import('../src/studio/concepts/director.js');
  type Cat = import('../src/studio/concepts/review.js').Catalog;
  type Brief = import('../src/studio/schema.js').BusinessBrief;
  const brief = { businessKey: 'place-X', revision: 1, identity: { website: { value: null }, listing: { placeId: 'X' } }, services: { items: [{ id: 's1', name: 'Tacos', evidence: [] }] }, brand: { colors: [], fonts: [], logo: { value: null, status: 'unknown' } } } as unknown as Brief;
  const gp = (id: string, w: number, seen?: string) => ({ id, url: `google-listing:X/${id}`, width: w, height: 1000, orientation: 'landscape', uses: w >= 1600 ? ['hero', 'card'] : ['card'], alt: 'Photo of Corner Taqueria from Google Maps', services: [], ...(seen ? { seen } : {}) });
  const cat = {
    business: { name: 'Corner Taqueria', category: 'Mexican Restaurant', website: null, summary: 'Casual spot for tacos.' },
    ownLines: [], services: [{ id: 's1', name: 'Tacos' }], items: [], story: null, logo: null, email: null,
    address: { id: 'loc-1', formatted: '12 Oak St, Austin, TX 78702' }, phone: { display: '(512) 555-0190', href: 'tel:+15125550190' }, hours: ['Mon–Sun: 9:00 AM – 9:00 PM'], area: null,
    rating: { value: 4.8, count: 304, href: null, scope: null },
    photos: [gp('g1', 1800, 'Three tacos on a plate with lime'), gp('g2', 1800), gp('g3', 1200, 'Storefront with a painted sign')],
  } as unknown as Cat;
  const long = 'Great tacos and friendly staff. '.repeat(12);
  const sel = I.listingSelection(brief, cat, [{ author: 'Ana P.', rating: 5, text: 'Best al pastor I have had.', when: 'a month ago' }, { author: 'Joe', rating: 4, text: long }, { author: 'Kim', rating: 5, text: 'Lovely.' }, { author: 'Extra', rating: 5, text: 'Not shown.' }]);
  assert.equal(sel.source, 'its Google listing (there is no website)');
  assert.deepEqual(sel.facts?.rating, '4.8 from 304 Google reviews');
  assert.match(String(sel.facts?.googleSummary), /Google's words, not the business's: never quote it/);
  // reviews: attributed, at most three, long ones quoted short
  assert.deepEqual(sel.reviews?.map((r) => r.author), ['Ana P.', 'Joe', 'Kim']);
  assert.ok(sel.reviews![1].text.length <= 221 && sel.reviews![1].text.endsWith('…'));
  // services only where sourced: "Tacos" has no evidence, so none; the missing list says so
  assert.deepEqual(sel.offerings.services, []);
  for (const m of ['website', 'services (none sourced', 'menu items', 'story', 'brand colours (proposed here)', 'brand fonts (proposed here)', 'logo', 'email']) assert.ok(sel.missing!.some((x) => x.startsWith(m)), m);
  assert.ok(!sel.missing!.some((x) => /phone|opening hours|verified photos/.test(x)), 'what is known is not listed as missing');
  // photos: verified first; an undescribed listing photo never leads (g2 is left out: the verified g1 fills the hero)
  assert.deepEqual(sel.photos.map((p) => [p.id, p.role]), [['g1', 'hero'], ['g3', 'card']]);
  assert.match(sel.photos[0].src ?? '', /google listing \(preview only, credited\)/);
  assert.match(sel.hero, /verified photo may lead/);
  assert.match(String(sel.brand.proposed), /proposals/);

  // proposed brand: with no brand colour any colour may be proposed; fonts from the vetted list; both recorded as proposed
  assert.equal(D.resolveColor('#C2410C', []), '#C2410C');
  assert.equal(D.resolveColor('#C2410C', ['#000018']), null, 'with a brand, only the brand');
  assert.ok(D.PROPOSAL_FONTS.includes('Fraunces') && D.PROPOSAL_FONTS.length >= 10);
  const ds = R.directionSchema([], ['call']) as unknown as { properties: { idea: { properties: { type: { properties: { heading: { enum: string[] } } } } } } };
  assert.deepEqual(ds.properties.idea.properties.type.properties.heading.enum, D.PROPOSAL_FONTS);
  assert.match(D.brandLine([], [], false), /no colours known \(no website\): propose a palette; no fonts known: propose a heading and a body font from Manrope, Inter/);
  const spec = { palette: { ground: 'white', surface: 'tint:#C2410C:8', ink: 'ink', inverse: '#1C1917', accent: '#C2410C', onAccent: 'white' }, type: { heading: 'Fraunces', body: 'Inter' } } as unknown as import('../src/studio/concepts/designspec.js').DesignSpec;
  assert.deepEqual(D.brandOf(spec, brief), { colours: 'proposed', fonts: 'proposed', proposed: { colours: ['#C2410C', '#1C1917'], fonts: ['Fraunces', 'Inter'] } });
});

test('a Google-only brief made from its listing by place id may be designed; one from a search may not', async () => {
  const D = await import('../src/studio/concepts/designspec.js');
  type Brief = import('../src/studio/schema.js').BusinessBrief;
  const b = (route: string, status: string, evidence: string[], placeId = 'X') => ({ route, identity: { status, evidence, listing: placeId ? { placeId } : null } }) as unknown as Brief;
  assert.ok(D.identityKnown(b('google', 'probable', ['the link names this Google listing'])));
  assert.ok(!D.identityKnown(b('google', 'unverified', ['Google\'s best match for "tacos 78702"'])));
  assert.ok(!D.identityKnown(b('google', 'probable', ['Google\'s best match for "tacos 78702"'])));
  assert.ok(D.identityKnown(b('website', 'verified', [])) && D.identityKnown(b('website', 'website-only', [])));
  assert.ok(!D.identityKnown(b('website', 'probable', ['the link names this Google listing'])));
});
