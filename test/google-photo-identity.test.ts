// Google listing photos, consistently across the concept catalog, the live concept page and the builder's live photos:
// a description travels only with the fingerprint of the picture it describes, and a page shows a listing photo only
// when the one candidate at its place, fetched small, is that picture. Otherwise the photo is left out and why is
// recorded. No Google photo name is ever written. Synthetic images and listings; nothing is fetched from Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-photo-identity-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), IMESSAGE_OUTBOUND_URL: '', LEAD_WEBHOOK_URL: '' });
const { fillListingPhotos, verifyLivePhoto, applyPhotoChecks, observeCatalogPhotos, VERIFY_WIDTH_PX } = await import('../src/studio/concepts/listing-photos.js');
const { fillGoogleContent, googlePhotoRoute, photoCreditMarker, livePhotoPath } = await import('../src/sources/google-live.js');
const { photoFingerprint } = await import('../src/design/fingerprint.js');
const { studioDocs, saveConversation, getConversation } = await import('../src/store.js');
const { searchCandidates } = await import('../src/sources/places.js');
const { auditGooglePhotoNames } = await import('../src/maintenance/google-names-audit.js');
const { scrubGooglePhotoNames } = await import('../src/google-names.js');

const PLACE = 'ChIJsyntheticplace0001';
const picture = (seed: number) => {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const w = 300, h = 400, bw = 25, cols = w / bw, cells = Array.from({ length: cols * (h / bw) }, () => [rnd(), rnd(), rnd()].map((v) => Math.round(v * 255)));
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x2 = 0; x2 < w; x2++) cells[Math.floor(y / bw) * cols + Math.floor(x2 / bw)].forEach((v, c) => { px[(y * w + x2) * 3 + c] = v; });
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
};
const IMG = { a: await picture(7), b: await picture(11), c: await picture(23), d: await picture(31) };
const FP = { a: await photoFingerprint(IMG.a), b: await photoFingerprint(IMG.b), c: await photoFingerprint(IMG.c) };
/** a synthetic live listing: every photo the same size; `order` is how Google lists them now */
const listing = (order: (keyof typeof IMG)[]) => order.map((k) => ({ name: `places/${PLACE}/photos/${k}-name`, width: 300, height: 400, authors: [{ name: `Author ${k.toUpperCase()}` }], mapsUri: `https://maps.example/${k}` }));
const fetcher = () => { const fetched: { name: string; width: number }[] = []; return { fetched, download: async (name: string, width = 1600) => { fetched.push({ name, width }); return IMG[name.split('/').pop()!.split('-')[0] as keyof typeof IMG]; } }; };
const page = (refs: { n: number; fp?: string; cls?: string }[]) => `<section class="hero hero-photo" data-kind="hero" data-variant="open" data-bg="#000000:0.5" data-text-color="#10243F" style="background:#F7F8FA;color:#FFFFFF">${refs.filter((r) => r.cls === 'hero-bg').map((r) => tag(r)).join('')}</section><div class="mosaic" data-n="3">${refs.filter((r) => r.cls !== 'hero-bg').map((r) => `<div class="tile" style="--span:4">${tag(r)}</div>`).join('')}</div>`;
const tag = (r: { n: number; fp?: string; cls?: string }) => `<span class="gph"><img class="${r.cls ?? ''}" src="data:image/svg+xml,stand-in" data-asset="gph_${r.n}" alt="described ${r.n}" data-gphoto="${PLACE}#${r.n}" data-gsize="300x400"${r.fp ? ` data-gfp="${r.fp}"` : ''}><span class="gcredit" data-gcredit="${PLACE}#${r.n}"></span></span>`;
const omissions = async () => (await studioDocs.list<{ placeId: string; n: number; reason: string; page: string }>('studio-photo-omissions')).sort((x, y) => x.n - y.n);

test('live concept page: photos in their described order are shown with their credits; only the candidates are fetched at the exact display URL', async () => {
  const f = fetcher();
  const html = await fillListingPhotos(page([{ n: 0, fp: FP.a, cls: 'hero-bg' }, { n: 1, fp: FP.b }, { n: 2, fp: FP.c }]), { photos: async () => [...listing(['a', 'b', 'c']), ...listing(['d', 'd', 'd', 'd', 'd', 'd', 'd'])], download: f.download, uri: async (name) => `https://img.example/${name.split('/').pop()}` });
  assert.equal(f.fetched.length, 3, 'one candidate per photo on the page, not the 10-photo listing');
  assert.ok(f.fetched.every((x) => x.width === 1600 && x.name.startsWith('https://img.example/')));
  assert.match(html, /src="https:\/\/img\.example\/a-name"[^>]*data-gphoto="ChIJsyntheticplace0001#0"/);
  assert.match(html, /data-gcredit="ChIJsyntheticplace0001#1">Photo: Author B · /);
  assert.match(html, /class="hero hero-photo"/, 'the hero keeps its photo');
});

test('live concept page: reordered photos of the same size and photos with no fingerprint are left out, and why is recorded', async () => {
  const f = fetcher();
  // Google now lists b, a, c: places 0 and 1 hold each other's pictures; place 2 is still c but the page recorded no fingerprint
  const html = await fillListingPhotos(page([{ n: 0, fp: FP.a, cls: 'hero-bg' }, { n: 1, fp: FP.b }, { n: 2 }]), { photos: async () => listing(['b', 'a', 'c']), download: f.download, uri: async (name) => `https://img.example/${name.split('/').pop()}`, page: '/sites/synthetic/' });
  assert.equal(f.fetched.length, 2, 'no fetch for a photo with no fingerprint to compare');
  assert.ok(!/data-gphoto=/.test(html), 'all three left out');
  assert.ok(!/Author [ABC]/.test(html), 'no credit for a photo not shown');
  assert.ok(!/<div class="tile"/.test(html), 'no empty tiles');
  assert.match(html, /<section class="hero" data-kind="hero" data-variant="open" data-text-color="#10243F" style="background:#F7F8FA;color:#10243F">/, 'the hero without its photo: no scrim, its own text colour');
  assert.match(html, /<!-- photo ChIJsyntheticplace0001#0 omitted: the photo now at this place is a different picture from the one described -->/);
  await new Promise((r) => setTimeout(r, 50));
  const rec = await omissions();
  assert.deepEqual(rec.map((r) => [r.n, r.reason, r.page]), [
    [0, 'the photo now at this place is a different picture from the one described', '/sites/synthetic/'],
    [1, 'the photo now at this place is a different picture from the one described', '/sites/synthetic/'],
    [2, 'no fingerprint was recorded for this photo, so it cannot be told from another photo of the same size', '/sites/synthetic/'],
  ]);
  assert.ok(!JSON.stringify(rec).includes('-name'), 'the record keeps no Google photo name');
});

test('builder pages: a credit is given only for a verified photo; the image route serves only the picture described', async () => {
  const f = fetcher();
  const html = `<figure>${photoCreditMarker(PLACE, 0, 300, 400, FP.a)}</figure><figure>${photoCreditMarker(PLACE, 1, 300, 400, FP.a)}</figure><figure>${photoCreditMarker(PLACE, 2, 300, 400)}</figure>`;
  const out = await fillGoogleContent(html, { photos: async () => listing(['a', 'b', 'c']), reviews: async () => ({ reviews: [] }), download: f.download, uri: async (name) => `https://img.example/${name.split('/').pop()}` });
  assert.equal(out, '<figure>Photo: Author A · <a href="https://maps.example/a" target="_blank" rel="noopener" translate="no">Google Maps</a></figure>');
  assert.equal(livePhotoPath(PLACE, 3, 300, 400, 800, FP.b), `/gphoto/${PLACE}/3?s=300x400&f=${FP.b}&w=800`);
  const call = async (n: number, fp?: string) => {
    const sent: any = { status: 200, headers: {} };
    const res = { set(h: any) { Object.assign(sent.headers, h); return res; }, status(n: number) { sent.status = n; return res; }, end() { return res; }, type(t: string) { sent.type = t; return res; }, send(b: unknown) { sent.body = b; return res; }, redirect(c: number, u: string) { sent.status = c; sent.redirect = u; return res; } };
    const fetch = fetcher(); let resolutions = 0;
    await googlePhotoRoute({ params: { placeId: PLACE, n: String(n) }, query: { s: '300x400', f: fp }, headers: {} } as never, res as never, {
      photos: async () => listing(['a', 'b']), download: fetch.download,
      uri: async (name) => { resolutions++; return `https://img.example/${name.split('/').pop()}`; },
    });
    return { ...sent, fetched: fetch.fetched, resolutions };
  };
  const ok = await call(0, FP.a);
  assert.equal(ok.status, 302);
  assert.equal(ok.fetched[0].name, ok.redirect, 'redirect is the exact URL whose bytes were checked');
  assert.equal(ok.resolutions, 1);
  const swapped = await call(1, FP.a);
  assert.equal(swapped.status, 404);
  assert.equal(swapped.body, undefined, 'no grey placeholder');
  assert.match(swapped.headers['x-photo-omitted'], /different picture/);
  const missing = await call(0);
  assert.equal(missing.fetched.length, 0);
  assert.equal(missing.resolutions, 0);

});

test('the concept catalog: a description only with an unambiguous fingerprint, and the page carries that fingerprint', async () => {
  const photo = (n: number) => ({ id: `gph_${n}`, url: `google-listing:${PLACE}#${n}`, width: 300, height: 400, orientation: 'portrait' as const, uses: [], alt: '', services: [] });
  const photos = [photo(0), photo(1), photo(2), photo(3)];
  await observeCatalogPhotos(photos, { photos: async () => listing(['a', 'b', 'c', 'c']), download: fetcher().download });
  const unverified: { id: string; reason: string }[] = [];
  const n = applyPhotoChecks(photos as never, { listing: { items: [
    { n: 0, width: 300, height: 400, kind: 'work', seen: 'Tacos', eligible: true, fp: FP.a },
    { n: 1, width: 300, height: 400, kind: 'work', seen: 'Bowl', eligible: true }, // a check from before fingerprints
    { n: 2, width: 300, height: 400, kind: 'work', seen: 'Chips', eligible: true, fp: FP.c },
    { n: 3, width: 300, height: 400, kind: 'storefront', seen: 'Chips again', eligible: true, fp: FP.c }, // the same picture twice
  ] } }, unverified);
  assert.equal(n, 1);
  assert.deepEqual(photos.map((p) => [(p as { seen?: string }).seen ?? null, (p as { fp?: string }).fp ?? null]), [['Tacos', FP.a], [null, null], [null, null], [null, null]]);
  assert.deepEqual(unverified.map((u) => u.id), ['gph_1', 'gph_2', 'gph_3']);
  assert.match(unverified[0].reason, /no unambiguous fingerprint/);
  assert.match(unverified[1].reason, /unambiguous/);
  // verifying the catalog's photo on the live listing: the fingerprint it carries, nothing else
  const f = fetcher();
  assert.equal((await verifyLivePhoto(listing(['a']), { placeId: PLACE, n: 0, size: '300x400', fp: FP.a }, f)).ok, true);
  assert.equal((await verifyLivePhoto(null, { placeId: PLACE, n: 0, fp: FP.a }, f)).ok, false);
  assert.equal((await verifyLivePhoto(listing(['a']), { placeId: PLACE, n: 0, size: '640x480', fp: FP.a }, f)).ok, false, 'no photo of that size there');
});

test('no Google photo name is written: the store scrubs any that reach it, lookups carry none, and conversations keep none', async () => {
  const name = `places/${PLACE}/photos/AVsyntheticName123`;
  const warnings: string[] = [];
  const warn = console.warn; console.warn = (m: string) => { warnings.push(String(m)); };
  try { await studioDocs.put('studio-work', 'leaky', { listing: { photos: [{ ref: name, width: 1, height: 1 }] }, note: `see ${name}` }); } finally { console.warn = warn; }
  const raw = fs.readFileSync(path.join(tmp, 'data', 'studio-work', 'leaky.json'), 'utf8');
  assert.ok(!raw.includes('AVsyntheticName123'));
  assert.ok(raw.includes(`places/${PLACE}/photos/(not kept)`), 'cut back to the place');
  assert.match(warnings.join(' '), /studio-work: Google photo names reached a written file/);
  // the lookup's candidates carry no photo name, so a conversation that saves them keeps none
  const found = await searchCandidates('BlueLine Plumbing Denver');
  assert.ok(found.candidates.length && found.candidates.every((c) => !('photoRef' in c)));
  await saveConversation({ from: 'synthetic', messages: [], session: { candidates: [{ placeId: PLACE, name: 'X', photoRef: name }] } } as never);
  assert.ok(!JSON.stringify(await getConversation('synthetic')).includes('AVsyntheticName123'));
  assert.deepEqual(scrubGooglePhotoNames({ a: 'nothing here' }).found, []);
});

test('the dry-run cleanup reports affected collections, fields and counts, and changes nothing', async () => {
  // records an earlier version wrote (planted on disk directly: the store would no longer let them through)
  const plant = (col: string, id: string, doc: unknown) => { fs.mkdirSync(path.join(tmp, 'data', col), { recursive: true }); fs.writeFileSync(path.join(tmp, 'data', col, `${id}.json`), JSON.stringify(doc)); };
  const n = (i: number) => `places/${PLACE}/photos/old${i}`;
  plant('drafts', 'drf_old', { id: 'drf_old', base: { business: { photos: [{ ref: n(1) }, { ref: n(2) }] } } });
  plant('studio-inventories', 'place-old--r1', { businessKey: 'place-old', assets: [{ url: `google-photo:${n(3)}` }] });
  plant('conversations', 'old-convo', { from: 'old-convo', session: { chosen: { photoRef: n(4) } } });
  fs.mkdirSync(path.join(tmp, 'out', 'sites', 'old-site'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'out', 'sites', 'old-site', 'site.json'), JSON.stringify({ business: { photos: [{ ref: n(5) }] } }));
  const before = fs.readdirSync(path.join(tmp, 'data'), { recursive: true }).map((f) => { const p = path.join(tmp, 'data', String(f)); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, 'utf8')}` : ''; }).join('|');
  const a = await auditGooglePhotoNames();
  assert.equal(a.dryRun, true);
  const row = (w: string) => a.store.find((r) => r.where === w)!;
  assert.deepEqual([row('drafts').affected, row('drafts').names, row('drafts').fields], [1, 2, ['.base.business.photos[].ref']]);
  assert.deepEqual([row('studio-inventories').affected, row('studio-inventories').fields], [1, ['.assets[].url']]);
  assert.deepEqual([row('conversations').affected, row('conversations').fields], [1, ['.session.chosen.photoRef']]);
  assert.equal(row('studio-work').affected, 0, 'the scrubbed write above holds no name');
  assert.deepEqual(a.files.find((r) => r.where.startsWith('out ('))!.examples, ['sites/old-site/site.json']);
  assert.equal(a.totals.names, 5);
  const after = fs.readdirSync(path.join(tmp, 'data'), { recursive: true }).map((f) => { const p = path.join(tmp, 'data', String(f)); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, 'utf8')}` : ''; }).join('|');
  assert.equal(after, before, 'nothing changed');
});


test('catalog follows actual pixels after same-size reorder; missing observations cannot borrow descriptions', async () => {
  const photos: any[] = [0, 1].map((n) => ({ id: `gph_${n}`, url: `google-listing:${PLACE}#${n}`, width: 300, height: 400 }));
  const work = { listing: { items: [
    { n: 0, width: 300, height: 400, fp: FP.a, kind: 'work', seen: 'A tacos', eligible: true },
    { n: 1, width: 300, height: 400, fp: FP.b, kind: 'work', seen: 'B trailer', eligible: true },
  ] } };
  await observeCatalogPhotos(photos, { photos: async () => listing(['b', 'a']), download: fetcher().download });
  assert.equal(applyPhotoChecks(photos, work), 2);
  assert.deepEqual(photos.map((p) => p.seen), ['B trailer', 'A tacos']);
  delete photos[0].fp;
  const omitted: any[] = [];
  applyPhotoChecks(photos, work, omitted);
  assert.equal(photos[0].seen, undefined);
  assert.equal(omitted[0].id, 'gph_0');
});

test('same slot with conflicting fingerprints is checked independently; a failed URL leaves no image or credit', async () => {
  const f = fetcher();
  const out = await fillListingPhotos(page([{ n: 0, fp: FP.a }, { n: 0, fp: FP.b }]), {
    photos: async () => listing(['a']), download: f.download, uri: async () => 'https://img.example/a-name',
  });
  assert.equal((out.match(/<img /g) ?? []).length, 1);
  const gone = await fillListingPhotos(page([{ n: 0, fp: FP.a }]), {
    photos: async () => listing(['a']), download: f.download, uri: async () => undefined,
  });
  assert.ok(!gone.includes('<img ') && !gone.includes('Photo:'));
  const invalid = await verifyLivePhoto(listing(['a']), { placeId: PLACE, n: 0, fp: 'bad-fingerprint' }, f);
  assert.equal(invalid.ok, false);
});

test('builder removes omitted images, responsive sources and lightbox entries; one candidate fetch serves image and credit', async () => {
  const a = livePhotoPath(PLACE, 0, 300, 400, 1600, FP.a);
  const b = livePhotoPath(PLACE, 1, 300, 400, 1600, FP.a);
  const html = `<figure><picture><source srcset="${a}"><img src="${a}" alt="A"></picture>${photoCreditMarker(PLACE, 0, 300, 400, FP.a)}</figure><figure><img src="${b}" alt="Wrong">${photoCreditMarker(PLACE, 1, 300, 400, FP.a)}</figure><script type="application/json">${JSON.stringify([{ src: a }, { src: b }])}</script>`;
  const f = fetcher();
  const out = await fillGoogleContent(html, { photos: async () => listing(['a', 'b']), download: f.download, uri: async (name) => `https://img.example/${name.split('/').pop()}` });
  assert.equal(f.fetched.length, 2);
  assert.ok(!out.includes('alt="Wrong"'));
  assert.ok(!out.includes('/gphoto/'));
  assert.ok(!out.includes('Author B'));
  assert.match(out, /src="https:\/\/img.example\/a-name"/);
  assert.match(out, /\[\{"src":"https:\/\/img.example\/a-name"\}\]/);
});

test('all collections and generated text writes scrub nested strings, keys and encoded photo resource names', async () => {
  const { ALL_COLLECTIONS, draftDocs } = await import('../src/store.js');
  const { writeStoredFile, copyStoredTree, storedBytes, hasGooglePhotoName } = await import('../src/google-names.js');
  const name = `places/${PLACE}/photos/SecretResource`;
  const data = { [name]: name, encoded: encodeURIComponent(name), escaped: name.replaceAll('/', '\\/'), nested: JSON.stringify({ photo: name }) };
  for (const col of ALL_COLLECTIONS.filter((c) => c.startsWith('studio-') || c === 'site-pins')) {
    await studioDocs.put(col as any, 'synthetic-persistence', data);
    assert.ok(!fs.readFileSync(path.join(tmp, 'data', col, 'synthetic-persistence.json'), 'utf8').includes('SecretResource'));
  }
  await draftDocs.put('drafts', 'synthetic', data);
  const dir = path.join(tmp, 'new-files'); fs.mkdirSync(dir);
  for (const ext of ['html', 'json', 'js', 'css', 'svg']) {
    writeStoredFile(path.join(dir, `a.${ext}`), Buffer.from(JSON.stringify(data)));
    assert.ok(!fs.readFileSync(path.join(dir, `a.${ext}`), 'utf8').includes('SecretResource'));
  }
  const clean = storedBytes('a.html', Buffer.from(name));
  assert.ok(!hasGooglePhotoName(clean.toString()));
  const binary = Buffer.from([0, 255, 4]);
  assert.deepEqual(storedBytes('a.jpg', binary), binary);
  // Old content copied to a NEW version is sanitized without mutating the old source.
  const old = path.join(tmp, 'old-file.html'); fs.writeFileSync(old, name);
  copyStoredTree(old, path.join(dir, 'copy.html'));
  assert.equal(fs.readFileSync(old, 'utf8'), name);
  assert.ok(!fs.readFileSync(path.join(dir, 'copy.html'), 'utf8').includes('SecretResource'));
});

test('dry-run fails explicitly on unreadable JSON instead of reporting a clean collection', async () => {
  const dir = path.join(tmp, 'data', 'studio-snapshots'); fs.mkdirSync(dir, { recursive: true });
  const bad = path.join(dir, 'corrupt.json'); fs.writeFileSync(bad, '{broken');
  await assert.rejects(auditGooglePhotoNames(), SyntaxError);
  assert.equal(fs.readFileSync(bad, 'utf8'), '{broken');
  fs.unlinkSync(bad); // synthetic fixture only
});

test('website catalog descriptions require the observed fingerprint and reject duplicate matching checks', () => {
  const photos: any[] = [{ id: 'a', url: 'https://business.example/a.jpg', fp: FP.a }, { id: 'b', url: 'https://business.example/b.jpg', fp: FP.b }];
  const work = { seen: { a: { fp: FP.a, kind: 'work', seen: 'A' }, b: { fp: FP.b, kind: 'work', seen: 'B' } } };
  applyPhotoChecks(photos, work);
  assert.deepEqual(photos.map((p) => p.seen), ['A', 'B']);
  photos[0].fp = FP.b;
  applyPhotoChecks(photos, work);
  assert.equal(photos[0].seen, undefined, 'a changed image at the same URL cannot borrow old text');
  photos[0].fp = FP.a;
  work.seen.b.fp = FP.a;
  applyPhotoChecks(photos, work);
  assert.equal(photos[0].seen, undefined, 'two matching checks are ambiguous');
});

test('a whole page keeps its doctype, <html lang>, <head> and <body> when its Google photos are filled or left out', async () => {
  const doc = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
  const shape = (h: string) => ({ doctype: /^<!doctype html>/i.test(h), lang: /<html lang="en">/.test(h), head: /<head>[\s\S]*<title>t<\/title>[\s\S]*<\/head>/.test(h), body: /<body>[\s\S]*<\/body>/.test(h) });
  const all = { doctype: true, lang: true, head: true, body: true };
  // builder page: one /gphoto image with no fingerprint (left out); the page around it stays a document
  const builder = await fillGoogleContent(doc(`<main><img src="/gphoto/${PLACE}/0?s=300x400" alt=""><p>kept</p></main>`), { photos: async () => listing(['a']), reviews: async () => ({ reviews: [] }), download: async () => IMG.a });
  assert.deepEqual(shape(builder), all);
  assert.ok(builder.includes('<p>kept</p>') && !builder.includes('/gphoto/'));
  // concept page: one listing photo with no fingerprint (left out)
  const concept = await fillListingPhotos(doc(`<div class="mosaic">${'<span class="gph"><img src="data:image/svg+xml,x" data-gphoto="' + PLACE + '#0" data-gsize="300x400"><span class="gcredit" data-gcredit="' + PLACE + '#0"></span></span>'}</div><p>kept</p>`), { photos: async () => listing(['a']), download: async () => IMG.a });
  assert.deepEqual(shape(concept), all);
  assert.ok(concept.includes('<p>kept</p>') && !concept.includes('data-gphoto'));
  // a snippet stays a snippet (no document wrapper added)
  const snippet = await fillGoogleContent(`<figure>${photoCreditMarker(PLACE, 0, 300, 400, FP.a)}</figure>`, { photos: async () => listing(['a']), reviews: async () => ({ reviews: [] }), download: async () => IMG.a, uri: async () => 'https://img.example/a' });
  assert.ok(!/<html|<body/.test(snippet));
});
