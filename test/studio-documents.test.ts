// Design studio, phase 1 regressions: linked PDFs (text layer, poster grids, OCR fallback, every failure recorded),
// conflicts that leave a fact without a chosen value, and one count of pictures behind every report. A local fixture
// restaurant site and PDFs written here stand in for the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4988;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-studio-docs-'));
Object.assign(process.env, {
  MOCK: '1', BRAND_MEASURE: '0', STUDIO_RENDER: '0', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', STUDIO_SUMMARY: '0', STUDIO_BACKOFF_MS: '5', STUDIO_PAGE_DELAY_MS: '0',
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`, CRAWL_PAGES: '0', PAGESPEED: '0', RESCORE: '0',
  STUDIO_MAX_PDFS: '7', STUDIO_MAX_PDF_BYTES: '2000000', STUDIO_MAX_ASSETS: '3',
});

const sharp = (await import('sharp')).default;
const mupdf = await import('mupdf');
const { startStudioJob, waitForStudioJob, getBrief } = await import('../src/studio/jobs.js');
const { buildFromSnapshot } = await import('../src/studio/brief.js');
const { getSnapshot } = await import('../src/studio/snapshot.js');
const { readPdf, itemsFromPdf, seenInOcr, tesseractOcr, pdfKind } = await import('../src/studio/pdf.js');
const { runQa } = await import('../src/studio/qa.js');
const { documentLimits } = await import('../src/studio/stages.js');
const { coverageReport, conflictReport, summaryTable } = await import('../src/studio/report.js');
type Ocr = import('../src/studio/pdf.js').Ocr;

test('serverless PDF work is bounded while local OCR coverage remains available', () => {
  const serverless = documentLimits(true);
  const local = documentLimits(false);
  assert.equal(serverless.fetchTimeoutMs, 15_000);
  assert.equal(serverless.fetchAttempts, 2);
  assert.ok(serverless.maxPages <= 8);
  assert.equal(serverless.ocrPages, 0);
  assert.equal(local.fetchTimeoutMs, 60_000);
  assert.equal(local.ocrPages, 6);
});

// ───────────────────────── PDFs, written by hand ─────────────────────────
interface Line { t: string; size: number; x: number; y: number; bold?: boolean }
/** a text line centred on x (Helvetica is about half an em wide per character) */
const centred = (t: string, size: number, cx: number, y: number, bold = false): Line => ({ t, size, x: Math.round(cx - (t.length * size * 0.5) / 2), y, bold });
const show = (lines: Line[]) => lines.map((l) => `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${l.x} ${792 - l.y} Td (${l.t.replace(/[\\()]/g, (m) => `\\${m}`)}) Tj ET`).join('\n');

/** A minimal PDF: Helvetica text, and optionally one full-page JPEG (a scanned page, with no text layer). */
function makePdf(pages: { lines?: Line[]; jpeg?: { data: Buffer; w: number; h: number } }[], pad = 0): Buffer {
  const objs: (string | Buffer)[] = [];
  const add = (o: string | Buffer) => objs.push(o);
  add(''); add(''); // catalog, pages: filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const p of pages) {
    let xobj = '';
    let content = show(p.lines ?? []);
    if (p.jpeg) {
      const n = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.jpeg.w} /Height ${p.jpeg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.data.length} >>\nstream\n`, 'latin1'), p.jpeg.data, Buffer.from('\nendstream', 'latin1')]));
      xobj = `/XObject << /Im1 ${n} 0 R >>`;
      content = `q 612 0 0 792 0 0 cm /Im1 Do Q\n${content}`;
    }
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobj} >> /Contents ${c} 0 R >>`));
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts = [Buffer.from(`%PDF-1.4\n%${'âãÏÓ'}\n${pad ? `%${'x'.repeat(pad)}\n` : ''}`, 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(offset); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]); parts.push(b); offset += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

/** A list menu: sections, item names, their lines (description, price, tags), and a footer on every page. */
const footer = (n: number): Line[] => [{ t: 'tacohouse.example | Order online for pickup', size: 9, x: 72, y: 760 }, { t: String(n), size: 9, x: 300, y: 776 }];
const item = (y: number, name: string, desc: string, price: string, tags?: string): Line[] => [
  { t: name, size: 14, x: 72, y, bold: true }, { t: desc, size: 10, x: 72, y: y + 16 }, { t: price, size: 10, x: 72, y: y + 30 }, ...(tags ? [{ t: tags, size: 10, x: 72, y: y + 44 }] : []),
];
const FOOD_MENU = makePdf([
  { lines: [{ t: 'TACO HOUSE', size: 28, x: 72, y: 70, bold: true }, { t: 'Breakfast Tacos', size: 20, x: 72, y: 110, bold: true },
    ...item(150, 'Migas Taco', 'Eggs scrambled with tortilla strips, pico de gallo and cheese', '$6.50', 'Vegetarian | Gluten-free'),
    ...item(220, 'Bean and Cheese', 'Refried black beans and melted cheddar on a flour tortilla', '$4.25'),
    ...item(280, 'Potato & Egg', 'Roasted potatoes and scrambled eggs with salsa verde', '$4.50', 'Vegetarian'),
    ...footer(1)] },
  { lines: [{ t: 'Drinks', size: 20, x: 72, y: 110, bold: true },
    ...item(150, 'Horchata', 'Rice milk with cinnamon and vanilla, made each morning', '16oz - $4.00 | 32oz - $6.00'),
    ...item(220, 'Agua Fresca', 'Seasonal fruit water, ask for today\'s flavour', '$4.00'),
    ...item(280, 'Mexican Coke', 'Made with cane sugar, in a glass bottle', '$3.75'),
    ...footer(2)] },
]);
const FOOD_ITEMS = ['Migas Taco', 'Bean and Cheese', 'Potato & Egg', 'Horchata', 'Agua Fresca', 'Mexican Coke'];

/** A poster: tiles in three columns, each a price above a name (one name wraps; one tile has no price). */
const tile = (cx: number, y: number, name: string[], price?: string, desc = 'Made fresh every day'): Line[] => [
  ...(price ? [centred(price, 14, cx, y, true)] : []),
  ...name.map((n, i) => centred(n, 22, cx, y + 34 + i * 24, true)),
  centred(desc, 9, cx, y + 40 + name.length * 24),
];
const POSTER = makePdf([{ lines: [centred('DRINKS AND MORE', 40, 306, 80, true),
  ...tile(110, 200, ['Horchata'], '4.00'), ...tile(306, 200, ['Cafe de Olla'], '3.50'), ...tile(502, 200, ['El Breakfast', 'Taco'], '4.50'),
  ...tile(110, 450, ['Agua Fresca'], '4.50'), ...tile(306, 450, ['Jamaica Tea'], '3.25'), ...tile(502, 450, ['Salsa Bar'])] }]);
const POSTER_ITEMS: Record<string, string | undefined> = { Horchata: '4.00', 'Cafe de Olla': '3.50', 'El Breakfast Taco': '4.50', 'Agua Fresca': '4.50', 'Jamaica Tea': '3.25', 'Salsa Bar': undefined };

/** a page of the food menu rendered to a JPEG: a scan, with no text layer */
const scan = (pdf: Buffer, page = 0) => {
  const pix = mupdf.Document.openDocument(new Uint8Array(pdf), 'application/pdf').loadPage(page).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  return { data: Buffer.from(pix.asJPEG(90)), w: pix.getWidth(), h: pix.getHeight() };
};
const SCANNED = makePdf([{ jpeg: scan(FOOD_MENU, 0) }]);
const ALLERGENS = makePdf([{ lines: [{ t: 'Allergen List', size: 22, x: 72, y: 80, bold: true }, ...item(130, 'Migas Taco', 'Contains: egg, milk', 'n/a'), ...item(200, 'Horchata', 'Contains: milk, tree nuts', 'n/a')] }]);

// ───────────────────────── reading PDFs ─────────────────────────
test('a list menu: items are the heading lines, each with its own price, tags and description; titles, footers and page numbers are not items', async () => {
  const x = await readPdf(new Uint8Array(FOOD_MENU), { maxPages: 12, ocrBudget: { pages: 0 } });
  assert.deepEqual(x.pages.map((p) => p.method), ['text', 'text']);
  const items = itemsFromPdf(x);
  assert.deepEqual(items.map((i) => i.name), FOOD_ITEMS);
  const migas = items.find((i) => i.name === 'Migas Taco')!;
  assert.equal(migas.section, 'Breakfast Tacos');
  assert.equal(migas.price, '$6.50');
  assert.equal(migas.priceBy, 'item-lines');
  assert.deepEqual(migas.tags, ['Vegetarian', 'Gluten-free']);
  assert.match(migas.description!, /tortilla strips/);
  assert.equal(items.find((i) => i.name === 'Horchata')!.section, 'Drinks');
  assert.equal(items.find((i) => i.name === 'Horchata')!.price, '16oz - $4.00 | 32oz - $6.00');
  assert.ok(items.every((i) => i.layout === 'list' && !/order online/i.test(i.description ?? '')));
});

test('a poster menu: names in a grid of tiles get the price printed in their own tile, and a tile without a price gets none', async () => {
  const items = itemsFromPdf(await readPdf(new Uint8Array(POSTER), { maxPages: 12, ocrBudget: { pages: 0 } }));
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.name, i.price])), POSTER_ITEMS);
  assert.ok(items.every((i) => i.layout === 'grid'));
  assert.ok(items.filter((i) => i.price).every((i) => i.priceBy === 'same-tile'));
});

test('a scanned page: read by OCR as evidence, never turned into items; without OCR or over its budget, the page is recorded as unread', async () => {
  const engine = await tesseractOcr();
  try {
    const x = await readPdf(new Uint8Array(SCANNED), { maxPages: 12, ocrBudget: { pages: 1 }, ocr: engine.ocr });
    assert.equal(x.pages[0].method, 'ocr');
    assert.match(x.pages[0].reason!, /no text layer/);
    assert.ok(x.pages[0].ocrConfidence! >= 60, `OCR confidence ${x.pages[0].ocrConfidence}`);
    const text = x.pages[0].ocrLines!.map((l) => l.text).join(' ');
    for (const name of ['Migas Taco', 'Bean and Cheese', 'Mexican Coke'].slice(0, 2)) assert.ok(seenInOcr(name, text), `OCR read "${name}": ${text.slice(0, 200)}`);
    assert.deepEqual(itemsFromPdf(x), [], 'OCR text never makes an item');
  } finally { await engine.close(); }
  const none = await readPdf(new Uint8Array(SCANNED), { maxPages: 12, ocrBudget: { pages: 1 } });
  assert.equal(none.pages[0].method, 'skipped');
  assert.match(none.pages[0].reason!, /OCR is not available/);
  const spent = await readPdf(new Uint8Array(SCANNED), { maxPages: 12, ocrBudget: { pages: 0 }, ocr: async () => { throw new Error('must not be called'); } });
  assert.match(spent.pages[0].reason!, /OCR page budget/);
  // the page limit: pages beyond it are not read, and the extraction says so
  const capped = await readPdf(new Uint8Array(FOOD_MENU), { maxPages: 1, ocrBudget: { pages: 0 } });
  assert.equal(capped.truncated, true);
  assert.equal(capped.pages.length, 1);
});

test('what a linked PDF is, from its address and its link text', () => {
  assert.equal(pdfKind('https://x.com/wp-content/uploads/2024/05/MENU-compressed.pdf'), 'menu');
  assert.equal(pdfKind('https://x.com/files/doc-118.pdf', 'Our prices'), 'price-list');
  assert.equal(pdfKind('https://x.com/files/Allergen-List.pdf'), 'allergen');
  assert.equal(pdfKind('https://x.com/files/newsletter-june.pdf', 'June news'), 'other');
});

// ───────────────────────── the fixture restaurant ─────────────────────────
async function photo(n: number, w = 1200, h = 800) {
  const shapes = Array.from({ length: 7 }, (_, i) => `<circle cx="${(n * 97 + i * 211) % w}" cy="${(n * 53 + i * 131) % h}" r="${60 + ((n + i) * 37) % 160}" fill="rgb(${(n * 61 + i * 40) % 255},${(n * 29 + i * 70) % 255},${(n * 83 + i * 25) % 255})" opacity="0.8"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${(n * 40) % 255},${(n * 90) % 255},${(n * 20) % 255})"/><stop offset="1" stop-color="rgb(${(n * 70 + 120) % 255},${(n * 30 + 60) % 255},${(n * 110 + 30) % 255})"/></linearGradient><filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed="${n}"/></filter></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<rect width="${w}" height="${h}" filter="url(#t)" opacity="0.6"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
const FILES = new Map<string, { type: string; body: Buffer }>();
for (let n = 1; n <= 5; n++) FILES.set(`/img/dish-${n}.jpg`, { type: 'image/jpeg', body: await photo(n + 10) });
FILES.set('/img/badge-yelp.png', { type: 'image/png', body: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#c00' } }).png().toBuffer() });
FILES.set('/files/food-menu.pdf', { type: 'application/pdf', body: FOOD_MENU });
FILES.set('/files/drinks-poster.pdf', { type: 'application/pdf', body: POSTER });
FILES.set('/files/brunch-menu.pdf', { type: 'application/pdf', body: SCANNED });
FILES.set('/files/allergens.pdf', { type: 'application/pdf', body: ALLERGENS });
FILES.set('/files/newsletter.pdf', { type: 'application/pdf', body: makePdf([{ lines: [{ t: 'June news', size: 20, x: 72, y: 80 }] }]) });
FILES.set('/files/catering-menu.pdf', { type: 'text/html', body: Buffer.from('<html><body>Page moved</body></html>') });
FILES.set('/files/price-list.pdf', { type: 'application/pdf', body: Buffer.from('%PDF-1.4\nthis is not really a PDF at all') });
FILES.set('/files/big-menu.pdf', { type: 'application/pdf', body: makePdf([{ lines: [{ t: 'Big menu', size: 20, x: 72, y: 80 }] }], 2_100_000) });

const HOME = `<!doctype html><html><head><title>Taco House | Breakfast tacos in East Austin</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Taco House","telephone":"(512) 482-7710","address":{"@type":"PostalAddress","streetAddress":"1200 E 6th St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78702"}}</script></head>
<body><header><a href="/"><img src="/img/dish-5.jpg" alt="Taco House" class="logo" width="300" height="100"></a><nav><ul>
<li><a href="/files/food-menu.pdf">Food Menu</a></li><li><a href="/files/drinks-poster.pdf">Drinks</a></li><li><a href="/files/brunch-menu.pdf">Brunch Menu</a></li>
<li><a href="/files/allergens.pdf">Allergen List</a></li><li><a href="/files/old-menu.pdf">Old Menu</a></li><li><a href="/files/catering-menu.pdf">Catering Menu</a></li>
<li><a href="/files/price-list.pdf">Price List</a></li><li><a href="/files/big-menu.pdf">Full Menu</a></li><li><a href="/files/newsletter.pdf">News</a></li></ul></nav></header>
<main><section class="hero"><img src="/img/a-kitchen-missing.jpg" alt="Our kitchen" width="1600" height="900"><h1>Breakfast tacos in East Austin</h1><p>Handmade tortillas and salsas since 2009.</p>
<a class="btn" href="tel:5124827710">Call (512) 482-7710</a> <a class="btn" href="https://maps.google.com/?q=1200+E+6th+St+Austin+TX+78702">Get directions</a></section>
<section><h2>From the kitchen</h2>${[1, 2, 3, 4].map((n) => `<img src="/img/dish-${n}.jpg" alt="Dish ${n}" width="1200" height="800">`).join('')}<img src="/img/badge-yelp.png" alt="Yelp" width="300" height="300"></section>
<section><h2>Visit</h2><p>1200 E 6th St, Austin, TX 78702</p><p>Open daily 7am - 2pm</p></section></main>
<footer><a href="tel:5124827710">(512) 482-7710</a></footer></body></html>`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url!, 'http://x').pathname;
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HOME); }
  const f = FILES.get(p);
  if (f) { res.writeHead(200, { 'content-type': f.type, 'content-length': String(f.body.length) }); return res.end(f.body); }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>');
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
test.after(() => server.close());
const SITE = `http://127.0.0.1:${PORT}/`;

/** a stand-in OCR engine for the job: it reads one dish the menus do not list, which must not become an item */
let ocrCalls = 0;
const fakeOcr: Ocr = async () => { ocrCalls++; return { lines: [{ text: 'BRUNCH', y: 40 }, { text: 'Chilaquiles Verdes $9.00', y: 80 }], confidence: 71 }; };

let run: { jobId: string; snapshotId: string; businessKey: string; revision: number } | undefined;
const getRun = async () => {
  if (!run) {
    const done = await waitForStudioJob((await startStudioJob({ website: SITE }, { ocr: fakeOcr })).id);
    assert.equal(done.status, 'done', done.error ?? '');
    run = { jobId: done.id, snapshotId: done.snapshotId!, businessKey: done.businessKey!, revision: done.revision! };
  }
  return run;
};

test('linked PDFs in a job: read within the budget, every one accounted for with how it was read or why not', async () => {
  const r = await getRun();
  const { inventory, brief } = await getBrief(r.businessKey, r.revision);
  const doc = (f: string) => inventory!.documents.find((d) => d.url.endsWith(f))!;
  assert.equal(doc('food-menu.pdf').status, 'read');
  assert.deepEqual(doc('food-menu.pdf').pages.map((p) => p.method), ['text', 'text']);
  assert.equal(doc('food-menu.pdf').items, 6);
  assert.equal(doc('food-menu.pdf').layout, 'list');
  assert.equal(doc('drinks-poster.pdf').layout, 'grid');
  assert.equal(doc('brunch-menu.pdf').status, 'read');
  assert.equal(doc('brunch-menu.pdf').pages[0].method, 'ocr');
  assert.equal(doc('brunch-menu.pdf').pages[0].ocrConfidence, 71);
  assert.equal(doc('brunch-menu.pdf').items, 0);
  assert.equal(ocrCalls, 1);
  assert.equal(doc('old-menu.pdf').status, 'failed');
  assert.equal(doc('old-menu.pdf').httpStatus, 404);
  assert.match(doc('catering-menu.pdf').reason!, /not a PDF \(text\/html\)/);
  assert.match(doc('price-list.pdf').reason!, /could not open the PDF/);
  assert.equal(doc('big-menu.pdf').status, 'skipped');
  assert.match(doc('big-menu.pdf').reason!, /larger than the 2 MB document limit/);
  assert.equal(doc('allergens.pdf').status, 'skipped');
  assert.match(doc('allergens.pdf').reason!, /over the document budget \(7 PDFs\)/);
  assert.match(doc('newsletter.pdf').reason!, /does not look like a menu/);
  assert.deepEqual(inventory!.coverage.documents, { found: 9, read: 3, failed: 3, skipped: 3 });
  // PDFs are documents, not pages
  assert.ok(inventory!.pages.every((p) => !/\.pdf$/.test(p.url)));
  // the reports and the QA say the same
  assert.match(coverageReport(inventory!, brief), /Linked PDFs: 9 found, 3 read, 3 failed, 3 not read/);
  const job = await (await import('../src/studio/jobs.js')).getStudioJob(r.jobId);
  assert.equal(job!.qa!.checks.find((c) => c.id === 'documents')!.level, 'review');
  assert.equal(job!.qa!.checks.find((c) => c.id === 'offerings')!.level, 'pass');
});

test('the menu in the brief: exactly the items the PDFs print, each with its page; prices tied by layout or disputed are for review; nothing from OCR', async () => {
  const r = await getRun();
  const { brief } = await getBrief(r.businessKey, r.revision);
  const o = brief!.offerings;
  assert.equal(o.status, 'known');
  const expected = [...new Set([...FOOD_ITEMS, ...Object.keys(POSTER_ITEMS)])];
  assert.deepEqual(o.items.map((i) => i.name).sort(), expected.sort(), 'no item invented, none lost');
  assert.ok(!o.items.some((i) => /chilaquiles|brunch|allergen|taco house|drinks and more/i.test(i.name)));
  const by = (n: string) => o.items.find((i) => i.name === n)!;
  // a price on the item's own lines is the business's own statement
  assert.deepEqual([by('Migas Taco').price!.text, by('Migas Taco').price!.status], ['$6.50', 'verified']);
  assert.match(by('Migas Taco').sources[0].locator!, /PDF page 1, "Breakfast Tacos"/);
  // the same item on the list and the poster, at the same price: both sources, still verified
  assert.equal(by('Horchata').sources.length, 2);
  assert.equal(by('Horchata').price!.status, 'verified');
  // priced differently by the two documents: kept for review, with both prices named
  assert.equal(by('Agua Fresca').price!.status, 'needs_review');
  assert.match(by('Agua Fresca').price!.how, /drinks-poster\.pdf prints 4\.50/);
  // a poster-only item: its price is tied by layout, for review; a tile with no price has none
  assert.deepEqual([by('Jamaica Tea').price!.text, by('Jamaica Tea').price!.status], ['3.25', 'needs_review']);
  assert.equal(by('Salsa Bar').price, undefined);
  // the owner is asked to confirm the menu, blocking while any price needs a check
  const q = brief!.ownerQuestions.find((x) => x.id === 'q-offerings')!;
  assert.ok(q.blocking);
  assert.ok(!brief!.unknowns.some((u) => u.field === 'services'), 'what the business sells is known from its menu');
});

// ───────────────────────── conflicts ─────────────────────────
const listing = (over: Record<string, unknown>) => ({
  placeId: 'ChIJtacohouse', name: 'Taco House', primaryType: 'mexican_restaurant', primaryTypeLabel: 'Mexican restaurant', types: ['restaurant'],
  formattedAddress: '1200 E 6th St, Austin, TX 78702, USA', street: '1200 E 6th St', city: 'Austin', state: 'TX', zip: '78702',
  phone: '(512) 482-7710', website: SITE, mapsUrl: 'https://maps.google.com/?cid=1', businessStatus: 'OPERATIONAL', photos: [], ...over,
});
const withListing = async (over: Record<string, unknown>) => {
  const snap = (await getSnapshot((await getRun()).snapshotId))!;
  return { ...snap, listing: listing(over) as never, identity: { ...snap.identity, status: 'verified' as const, placeId: 'ChIJtacohouse', evidence: ['phone', 'address'] } };
};

test('the sources agree: one address, one main location, the call and directions buttons are used', async () => {
  const { brief } = await buildFromSnapshot(await withListing({}));
  assert.equal(brief.contact.phone.value, '(512) 482-7710');
  assert.equal(brief.contact.phone.candidates, undefined);
  assert.equal(brief.contact.address.value!.street, '1200 E 6th St');
  assert.equal(brief.locations.primaryId, brief.locations.items.find((l) => l.listing)!.id);
  assert.equal(brief.callsToAction.primary!.href, 'tel:5124827710');
  assert.match(brief.callsToAction.secondary!.href, /maps\.google/);
  assert.deepEqual(brief.callsToAction.held, []);
});

test('phone conflict: both numbers kept with their sources, neither chosen, and the call button held until the owner answers', async () => {
  const snap = await withListing({ phone: '(512) 482-7799' });
  const { brief, inventory } = await buildFromSnapshot(snap);
  const ph = brief.contact.phone;
  assert.equal(ph.value, null);
  assert.equal(ph.status, 'conflicting');
  assert.deepEqual(ph.candidates!.map((c) => c.value).sort(), ['(512) 482-7710', '(512) 482-7799']);
  assert.ok(ph.candidates!.find((c) => c.value === '(512) 482-7799')!.sources.some((s) => s.sourceType === 'google'));
  assert.ok(ph.candidates!.find((c) => c.value === '(512) 482-7710')!.sources.every((s) => s.sourceType === 'website'));
  assert.equal(ph.questionId, 'q-contact-phone');
  assert.ok(brief.ownerQuestions.find((q) => q.id === 'q-contact-phone')!.blocking);
  assert.match(brief.conflicts.find((c) => c.id === 'c-phone')!.resolution, /Neither number/);
  // no public action dials either number; the address is agreed, so directions stay
  assert.equal(brief.callsToAction.primary, null);
  assert.deepEqual(brief.callsToAction.held.map((h) => [h.href, h.questionId]), [['tel:5124827710', 'q-contact-phone']]);
  assert.match(brief.callsToAction.secondary!.href, /maps\.google/);
  assert.ok(brief.locations.primaryId);
  const qa = await runQa(snap, inventory, brief);
  assert.equal(qa.checks.find((c) => c.id === 'disputed')!.level, 'pass');
  assert.equal(qa.checks.find((c) => c.id === 'provenance')!.level, 'pass');
  assert.match(conflictReport(brief), /Held: "Call \(512\) 482-7710" → tel:5124827710/);
});

test('location conflict: the listing\'s address is not on the website; no address and no main location are chosen, directions are held', async () => {
  const snap = await withListing({ street: '4500 Duval St', zip: '78751', formattedAddress: '4500 Duval St, Austin, TX 78751, USA' });
  const { brief, inventory } = await buildFromSnapshot(snap);
  const ad = brief.contact.address;
  assert.equal(ad.value, null);
  assert.equal(ad.status, 'conflicting');
  assert.deepEqual(ad.candidates!.map((c) => c.value.street).sort(), ['1200 E 6th St', '4500 Duval St']);
  assert.equal(brief.locations.primaryId, null);
  assert.equal(brief.locations.items.length, 2, 'both places kept, each with its sources');
  assert.ok(brief.conflicts.some((c) => c.id === 'c-address'));
  assert.equal(brief.callsToAction.secondary, null);
  assert.deepEqual(brief.callsToAction.held.map((h) => h.questionId), ['q-contact-address']);
  assert.equal(brief.contact.phone.value, '(512) 482-7710', 'the phone is agreed');
  assert.equal((await runQa(snap, inventory, brief)).checks.find((c) => c.id === 'disputed')!.level, 'pass');
  assert.match(conflictReport(brief), /main location: none chosen/);
});

// ───────────────────────── one count of pictures ─────────────────────────
test('pictures are counted once: how each was examined and how it came out add up to the same total in the inventory, the brief, the reports and the job notes', async () => {
  const r = await getRun();
  const { inventory, brief } = await getBrief(r.businessKey, r.revision);
  const s = inventory!.assetSummary.website;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(s.total, inventory!.assets.filter((a) => a.origin === 'website').length);
  assert.equal(sum(s.examined), s.total);
  assert.equal(sum(s.outcomes), s.total);
  // a budget of 3 downloads: the broken hero and two dishes; the rest are over the budget; the badge is judged by its name
  assert.deepEqual([s.examined.downloaded, s.examined.downloadFailed, s.examined.overBudget], [2, 1, 2]);
  assert.equal(s.outcomes.broken, 1);
  assert.equal(s.outcomes.notProbed, s.examined.overBudget);
  assert.ok(s.examined.byFileName >= 1);
  assert.equal(brief!.assets.website.total, s.total);
  assert.equal(brief!.assets.website.usable, s.outcomes.usable);
  const report = coverageReport(inventory!, brief);
  assert.match(report, new RegExp(`Pictures: ${s.total} on the website`));
  assert.match(report, new RegExp(`${s.examined.downloaded} downloaded and measured, ${s.examined.downloadFailed} download failed`));
  assert.match(summaryTable([{ inventory: inventory!, brief: brief! }]), new RegExp(`\\| ${s.outcomes.usable} of ${s.total} \\(${s.examined.downloaded}, ${s.examined.downloadFailed}, `));
  const job = await (await import('../src/studio/jobs.js')).getStudioJob(r.jobId);
  const notes = job!.stages.flatMap((x) => x.notes).join('\n');
  assert.match(notes, new RegExp(`downloaded ${s.examined.downloaded} pictures \\(${s.examined.downloadFailed} downloads failed\\)`));
  assert.match(notes, new RegExp(`pictures: ${s.outcomes.usable} usable of ${s.total}`));
  assert.equal(job!.qa!.checks.find((c) => c.id === 'counts')!.level, 'pass');
});
