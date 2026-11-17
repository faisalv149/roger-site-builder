// The Level Up refinement (version 3, fe_5a5bd12944694f38, via version 2 from version 1, fe_e1e9ac19cdf04669): no implied
// results claim, no identifiable before-and-after or selfie photos, no unverified kids' area, honest photo wording, and every
// Google photo credit visible inside its frame at 1440 and 390. Reads the saved versions from this machine's data/ (skipped
// where absent); photo requests are answered locally with images of each photo's real size, so the browser check is offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const V1 = 'fe_e1e9ac19cdf04669', V2 = 'fe_a3e8fba9f6384a91', V3 = 'fe_5a5bd12944694f38';
const WITHHELD = ['gph_a1ea6adcc84e', 'gph_f4991b62726f', 'gph_bd1f9dbc193e'];
const have = [V1, V2, V3].every((id) => fs.existsSync(path.resolve('data', 'studio-frontend-jobs', `${id}.json`)));
const { getFrontendJob, frontendPreview, refinedVersion } = await import('../src/studio/frontend/jobs.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
const skip = have ? false : 'the saved Level Up versions are not on this machine';

test('Level Up version 3: unsuitable photos withheld everywhere, unverified sections and wording gone, version 1 unchanged', { skip }, async () => {
  const v1 = (await getFrontendJob(V1))!, v2 = (await getFrontendJob(V2))!, v3 = (await getFrontendJob(V3))!;
  assert.equal(v2.version?.parentId, V1); assert.equal(v3.version?.parentId, V2);
  for (const v of [v2, v3]) { assert.equal(v.costUsd, 0); assert.equal(v.calls.length, 0); }
  assert.deepEqual(v2.refinement?.withheldPhotos, WITHHELD);
  for (const slug of ['home', 'photos', 'visit']) {
    const html = await frontendPreview(v3, slug);
    for (const w of WITHHELD) assert.ok(!html.includes(w), `${slug} still shows ${w}`);
    assert.ok(!/Kids corner|Results<|before and after|before-and-after|club's own photos|Members training/i.test(html), `${slug} keeps unverified wording`);
  }
  for (const w of WITHHELD) assert.ok(!v3.input.photos.some((p) => p.id === w));
  assert.match(await frontendPreview(v3, 'home'), /Photos on the club's Google listing show/);
  // version 1 is exactly as generated
  assert.ok((await frontendPreview(v1, 'photos')).includes('Kids corner'));
  assert.ok(v1.input.photos.some((p) => p.id === WITHHELD[0]));
});

test('a refinement cannot bring a withheld photo back', { skip }, async () => {
  const v3 = (await getFrontendJob(V3))!;
  const home = v3.code!.html.replace('data-photo="gph_51429cecfc6e"', `data-photo="${WITHHELD[0]}"`);
  await assert.rejects(refinedVersion(V3, { homeHtml: home, note: 'test' }), /does not pass the checks/);
});

for (const width of [1440, 390]) {
  test(`Level Up version 3 at ${width}px: every Google photo credit is visible inside its frame`, { skip: skip || (!screenshotsAvailable() ? 'no browser here' : false) }, async () => {
    const job = (await getFrontendJob(V3))!;
    const sizes = new Map(job.input.photos.map((p) => [p.url, p]));
    const browser = await launchBrowser();
    try {
      for (const slug of ['home', 'photos']) {
        const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
        await page.route('**/*', async (route) => {
          const p = sizes.get(route.request().url());
          if (p) return route.fulfill({ contentType: 'image/jpeg', body: await sharp({ create: { width: p.width, height: p.height, channels: 3, background: '#c86' } }).jpeg().toBuffer() });
          return route.abort();
        });
        await page.setContent(await frontendPreview(job, slug), { waitUntil: 'load' });
        const hidden = await page.evaluate(() => Array.from(document.querySelectorAll('.gcredit')).filter((c) => {
          const r = c.getBoundingClientRect(); let a = c.parentElement;
          while (a && a !== document.body) {
            const cs = getComputedStyle(a);
            if (/(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const b = a.getBoundingClientRect(); if (r.bottom > b.bottom + 1 || r.right > b.right + 1) return true; }
            a = a.parentElement;
          }
          return false;
        }).length);
        assert.equal(hidden, 0, `${slug}: ${hidden} credits clipped`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      }
    } finally { await browser.close(); }
  });
}

// version 5 (fe_c01e31bc743d4c00, from version 3): made under pipeline revision 2; it carries every photo withheld in
// its lineage (version 2 recorded them only in its refinement note) with a reason, and passed the rendered review
const V5 = 'fe_c01e31bc743d4c00';
test('Level Up version 5 (revision 2): the withheld photos and their reasons are carried from version 2, and the rendered review passed', { skip: have && fs.existsSync(path.resolve('data', 'studio-frontend-jobs', `${V5}.json`)) ? false : 'the saved Level Up versions are not on this machine' }, async () => {
  const v5 = (await getFrontendJob(V5))!, v3 = (await getFrontendJob(V3))!;
  assert.equal(v5.rev, 2); assert.equal(v3.rev, undefined, 'version 3 keeps revision 1');
  assert.deepEqual(v5.withheldPhotos!.map((w) => w.id).sort(), [...WITHHELD].sort());
  assert.ok(v5.withheldPhotos!.every((w) => w.reason.includes('before-and-after') && w.rule === 'staff'));
  assert.equal(v5.checks.browser, 'passed'); assert.deepEqual(v5.delivery, { auto: true, reasons: [] });
  assert.ok(v5.review!.pages.every((p) => p.pass && p.credits.visible === p.credits.required));
  assert.ok(!/members/i.test(v5.code!.html), 'no membership inferred from Google reviewers');
});
