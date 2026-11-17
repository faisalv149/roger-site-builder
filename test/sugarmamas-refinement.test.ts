// The Sugar Mama's refinement (version 4, fe_72de48f5273e4fb7, via version 3 from version 2, fe_c246505de9814456): the Photos board
// gallery keeps each photo's own shape at 1440 and 390 in balanced rows, About no longer repeats Home's menu display and
// custom-orders section, and Home and Visit are exactly as accepted. Reads the saved versions from this machine's data/
// (skipped where they are absent); photo requests are answered locally with images of each photo's real size, so the
// browser checks run offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// version 3 fixed the board and About; version 4 (from 3) fixed the framed photos on the inner pages too: the result tested
const V2 = 'fe_c246505de9814456', V3 = 'fe_72de48f5273e4fb7';
const have = [V2, V3].every((id) => fs.existsSync(path.resolve('data', 'studio-frontend-jobs', `${id}.json`)));
const { getFrontendJob, frontendPreview } = await import('../src/studio/frontend/jobs.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
const skip = !have ? 'the saved Sugar Mama\'s versions are not on this machine' : !screenshotsAvailable() ? 'no browser here' : false;

type Box = { w: number; h: number; cardW: number; cardH: number; natural: number; top: number; left: number; right: number };
/** the board gallery's photos as rendered at a width (photos served locally at their real size) */
async function board(id: string, width: number, slug = 'photos'): Promise<{ boxes: Box[]; all: { photo: string; shown: number; natural: number }[]; overflow: boolean; vw: number }> {
  const job = (await getFrontendJob(id))!;
  const html = await frontendPreview(job, slug);
  const sizes = new Map(job.input.photos.map((p) => [p.url, p]));
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
    await page.route('**/*', async (route) => {
      const p = sizes.get(route.request().url());
      if (p) return route.fulfill({ contentType: 'image/jpeg', body: await sharp({ create: { width: p.width, height: p.height, channels: 3, background: '#c86' } }).jpeg().toBuffer() });
      return route.abort(); // fonts and anything else: not needed to measure the layout
    });
    await page.setContent(html, { waitUntil: 'load' });
    return await page.evaluate(() => ({
      vw: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      all: Array.from(document.querySelectorAll<HTMLImageElement>('main img[data-photo]')).map((img) => { const r = img.getBoundingClientRect(); return { photo: img.dataset.photo!, shown: r.width / r.height, natural: img.naturalWidth / img.naturalHeight }; }),
      boxes: Array.from(document.querySelectorAll<HTMLImageElement>('.ph-grid img[data-photo]')).map((img) => {
        const r = img.getBoundingClientRect(), c = img.closest('li')!.getBoundingClientRect();
        return { w: r.width, h: r.height, cardW: c.width, cardH: c.height, natural: img.naturalWidth / img.naturalHeight, top: Math.round(c.top + scrollY), left: c.left, right: c.right };
      }),
    }));
  } finally { await browser.close(); }
}
const rowsOf = (boxes: Box[]) => [...boxes.reduce((m, b) => m.set([...m.keys()].find((t) => Math.abs(t - b.top) < 40) ?? b.top, [...(m.get([...m.keys()].find((t) => Math.abs(t - b.top) < 40) ?? b.top) ?? []), b]), new Map<number, Box[]>()).values()];

for (const width of [1440, 390]) {
  test(`Photos board gallery at ${width}px: each photo keeps its own shape, its card fits it, and the rows are balanced`, { skip }, async () => {
    const before = await board(V2, width);
    assert.ok(before.boxes.some((b) => b.w / b.h < 0.7), 'version 2 shows the fault: photos stretched far taller than they are');
    const { boxes, all, overflow, vw } = await board(V3, width);
    // every photo on the page (window panes, cake stands, the board): its frame's shape, never a stretched slice
    assert.equal(all.length, 13);
    for (const p of all) assert.ok(Math.abs(p.shown - p.natural) / p.natural < 0.1, `${p.photo} shown ${p.shown.toFixed(2)} vs its own ${p.natural.toFixed(2)}`);
    const aboutPhoto = (await board(V3, width, 'about')).all;
    assert.equal(aboutPhoto.length, 1);
    assert.ok(Math.abs(aboutPhoto[0].shown - aboutPhoto[0].natural) / aboutPhoto[0].natural < 0.1, "About's photo keeps its shape");
    assert.equal(boxes.length, 7);
    assert.equal(overflow, false);
    for (const b of boxes) {
      assert.ok(Math.abs(b.w / b.h - b.natural) < 0.02, `shown ${(b.w / b.h).toFixed(2)} vs the photo's own ${b.natural.toFixed(2)}`);
      assert.ok(b.cardH <= b.h + 60, `card ${Math.round(b.cardH)}px tall around a ${Math.round(b.h)}px photo: no empty space below it`);
      assert.ok(b.h <= (width === 390 ? 360 : 300), `${Math.round(b.h)}px tall at ${width}px`);
    }
    const rows = rowsOf(boxes);
    if (width === 1440) {
      assert.deepEqual(rows.map((r) => r.length), [4, 3]);
      const last = rows[1], gapL = Math.min(...last.map((b) => b.left)) - Math.min(...rows[0].map((b) => b.left)), gapR = Math.max(...rows[0].map((b) => b.right)) - Math.max(...last.map((b) => b.right));
      assert.ok(Math.abs(gapL - gapR) < 30, 'the short last row is centred');
    } else {
      assert.deepEqual(rows.map((r) => r.length), [1, 2, 2, 2], 'the first photo full width, then pairs: no photo alone on a row');
      assert.ok(rows[0][0].cardW > vw * 0.8);
    }
  });
}

test('About is compact and its own: the verified story, no repeat of Home\'s menu display or custom-orders section', { skip: have ? false : 'the saved versions are not here' }, async () => {
  const v2 = (await getFrontendJob(V2))!, v3 = (await getFrontendJob(V3))!;
  const about2 = await frontendPreview(v2, 'about'), about3 = await frontendPreview(v3, 'about'), home = await frontendPreview(v3, 'home');
  const main = (h: string) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
  // version 2 repeated both blocks; version 3 has neither
  for (const repeated of ['class="case ab-case"', 'class="ab-more"', '>Cupcakes<', '>Mini-pies<', 'We do custom orders!', 'Chocolate Bourbon Pecan Pie']) {
    assert.ok(main(about2).includes(repeated), `version 2's About had ${repeated}`);
    assert.ok(!main(about3).includes(repeated), `version 3's About repeats ${repeated}`);
  }
  assert.match(main(home), /We do custom orders!/, 'the custom-orders section stays on Home');
  assert.match(main(about3), /<p data-fact="story"[^>]*>Sugar Mama's Bakeshop is grateful to continue to bring Austin the sweetest baked goods around\./);
  assert.match(main(about3), /<img data-photo="img_fbc72519a4ec"/, 'its photo stays');
  assert.match(main(about3), new RegExp(`<a class="btn btn-line" data-page="visit" href="/api/studio/frontend-jobs/${V3}/preview/visit"`));
  assert.ok(!/vintage-style|a few seats/i.test(main(about3)), 'no unverified detail in the intro');
  assert.ok(main(about3).length < main(about2).length * 0.6, 'shorter');
});

test('Home and Visit are exactly as accepted in version 2; only the version they belong to differs', { skip: have ? false : 'the saved versions are not here' }, async () => {
  const v2 = (await getFrontendJob(V2))!, v3 = (await getFrontendJob(V3))!;
  // the lineage: version 4 from version 3, version 3 from version 2, numbered in order
  const mid = (await getFrontendJob(v3.version!.parentId!))!;
  assert.equal(mid.id, 'fe_ed021ad74ae14143'); assert.equal(mid.version?.parentId, V2);
  assert.equal(mid.version?.n, (v2.version?.n ?? 0) + 1); assert.equal(v3.version?.n, (v2.version?.n ?? 0) + 2);
  assert.equal(mid.costUsd, 0); assert.equal(mid.calls.length, 0);
  assert.equal(v3.costUsd, 0); assert.equal(v3.calls.length, 0);
  assert.deepEqual(v3.code, v2.code, 'the accepted homepage code, reused');
  assert.equal(v3.site!.pages.find((p) => p.slug === 'visit')!.html, v2.site!.pages.find((p) => p.slug === 'visit')!.html);
  for (const slug of ['home', 'visit']) {
    // the photos page's CSS is shared by every page's stylesheet; set it aside, then the pages must match exactly
    const strip = (h: string, id: string) => h.split(id).join('VERSION').replace(/<style>[\s\S]*?<\/style>/, '');
    assert.equal(strip(await frontendPreview(v3, slug), V3), strip(await frontendPreview(v2, slug), V2), `${slug} changed`);
  }
  assert.ok((await frontendPreview(v2, 'about')).includes('class="ab-more"'), 'version 2 itself is unchanged');
});
