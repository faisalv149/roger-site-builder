// Business-agnostic photos, offerings and addresses, on both build paths. Offline: sample listings written for the
// test (a restaurant, a bakery, a barber, a plumber and a roofer, each Google-only: no website), generated photos,
// and stand-ins for Google and Claude. The finished pages are opened in Chrome at desktop and phone width.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-agnostic-'));
Object.assign(process.env, {
  MOCK: '1', BRAND_MEASURE: '0', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', PAGESPEED: '0', RESCORE: '0', STUDIO_RENDER: '0', STUDIO_SUMMARY: '0',
  STUDIO_BACKOFF_MS: '5', STUDIO_PAGE_DELAY_MS: '0', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4994',
});

const sharp = (await import('sharp')).default;
const { ROOT, config } = await import('../src/config.js');
const { buildSite } = await import('../src/pipeline.js');
const { findDraft, putDraft } = await import('../src/drafts.js');
const { cityFromComponents } = await import('../src/sources/places.js');
const { labelPhotos, LABEL_SYSTEM } = await import('../src/design/photos.js');
const { startStudioJob, waitForStudioJob } = await import('../src/studio/jobs.js');
const { startConceptJob, waitForConceptJob, getConceptSet } = await import('../src/studio/concepts/jobs.js');
const { setDir } = await import('../src/studio/concepts/render.js');
const { fillListingPhotos, judgeListingPhotos } = await import('../src/studio/concepts/listing-photos.js');
const { screenshotsAvailable } = await import('../src/render/og.js');

// ───────────────────────── sample listings, written for this test and removed after ─────────────────────────
const PHOTO_DIR = path.join(ROOT, 'out', 'test-agnostic-photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
/** the tones of a photograph: a gradient, shapes and fine grain (flat artwork would be set aside as a graphic) */
async function photo(n: number, w: number, h: number) {
  const shapes = Array.from({ length: 7 }, (_, i) => `<circle cx="${(n * 97 + i * 211) % w}" cy="${(n * 53 + i * 131) % h}" r="${80 + ((n + i) * 37) % 200}" fill="rgb(${(n * 61 + i * 40) % 255},${(n * 29 + i * 70) % 255},${(n * 83 + i * 25) % 255})" opacity="0.8"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${(n * 40) % 255},${(n * 90) % 255},${(n * 20) % 255})"/><stop offset="1" stop-color="rgb(${(n * 70 + 120) % 255},${(n * 30 + 60) % 255},${(n * 110 + 30) % 255})"/></linearGradient><filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="${n}"/></filter></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<rect width="${w}" height="${h}" filter="url(#t)" opacity="0.6"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

interface Case { id: string; name: string; primaryType: string; label: string; city: string; review: string; offering: RegExp }
const CASES: Case[] = [
  { id: 'restaurant', name: 'Rooftop Tribe Kitchen', primaryType: 'afghani_restaurant', label: 'Afghan restaurant', city: 'Lahore', review: 'The Shinwari Karahi and the Kabuli Pulao were superb.', offering: /Shinwari Karahi|Kabuli Pulao/ },
  { id: 'bakery', name: 'Crumb & Crust Bakery', primaryType: 'bakery', label: 'Bakery', city: 'Portland', review: 'Their sourdough loaf and almond croissant are the best.', offering: /sourdough loaf|almond croissant/i },
  { id: 'barber', name: 'Sharp Edge Barbers', primaryType: 'barber_shop', label: 'Barber shop', city: 'Leeds', review: 'Got a skin fade and a beard trim, spot on.', offering: /skin fade|beard trim/i },
  { id: 'plumber', name: 'Clearflow Plumbing', primaryType: 'plumber', label: 'Plumber', city: 'Denver', review: 'They fixed our tankless water heater and a burst pipe fast.', offering: /tankless water heater|burst pipe/i },
  { id: 'roofer', name: 'Summit Ridge Roofing', primaryType: 'roofing_contractor', label: 'Roofing contractor', city: 'Austin', review: 'Great metal roof installation and gutter guards.', offering: /metal roof installation|gutter guards/i },
];
const placeId = (c: Case) => `test-gonly-${c.id}`;
const fixtureFile = (c: Case) => path.join(config.dirs.fixtures, 'places', `_test-gonly-${c.id}.json`);
// each listing: four photos of the business itself, its storefront, and one menu-board graphic
const KINDS = ['work', 'work', 'storefront', 'work', 'work', 'other'] as const;
for (const [ci, c] of CASES.entries()) {
  const photos = [];
  for (const [k, kind] of KINDS.entries()) {
    const [w, h] = k === 3 ? [1067, 1600] : [1600, 1067];
    const file = path.join(PHOTO_DIR, `${c.id}-${k}.jpg`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, await photo(ci * 10 + k + 1, w, h));
    photos.push({ ref: `file:${path.relative(ROOT, file).split(path.sep).join('/')}`, width: w, height: h, authors: [{ name: `Guest ${k + 1}`, uri: `https://maps.google.com/contrib/${k + 1}` }], isOwner: false, source: 'google', analysis: { kind } });
  }
  const periods = Array.from({ length: 7 }, (_, d) => ({ open: { day: d, hour: 9, minute: 0 }, close: { day: d, hour: 21, minute: 0 } }));
  fs.writeFileSync(fixtureFile(c), JSON.stringify({
    placeId: placeId(c), name: c.name, primaryType: c.primaryType, primaryTypeLabel: c.label, types: [c.primaryType, 'point_of_interest', 'establishment'],
    formattedAddress: `12 Main Road, ${c.city}`, shortAddress: `12 Main Road, ${c.city}`, street: '12 Main Road', city: c.city, phone: '(555) 010-2030', phoneE164: '+15550102030',
    mapsUrl: `https://maps.google.com/?cid=${ci + 1}`, rating: 4.7, reviewCount: 212,
    reviews: [{ author: 'A. Guest', rating: 5, text: c.review, relativeTime: '2 weeks ago' }, { author: 'B. Guest', rating: 5, text: `Friendly people at ${c.name}.`, relativeTime: '1 month ago' }],
    photos, hours: { periods }, businessStatus: 'OPERATIONAL', nearbyTowns: ['Neighbourtown', 'Othertown'], source: 'places',
  }, null, 2));
}
test.after(() => { for (const c of CASES) fs.rmSync(fixtureFile(c), { force: true }); fs.rmSync(PHOTO_DIR, { recursive: true, force: true }); });

/** the finished page in Chrome at desktop and phone width: pictures actually visible, no sideways scroll */
async function inBrowser(file: string) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: config.chromiumPath });
  const out: Record<string, { images: number; overflow: boolean; h1: string; headings: string[]; text: string }> = {};
  try {
    for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]] as const) {
      const page = await browser.newPage(opts);
      await page.goto(`file://${file.split(path.sep).join('/')}`, { waitUntil: 'load' });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(300);
      out[label] = await page.evaluate(() => ({
        images: [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 60 && r.height > 60 && i.complete && i.naturalWidth > 0 && getComputedStyle(i).visibility !== 'hidden'; }).length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        h1: document.querySelector('h1')?.textContent?.trim() ?? '',
        headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent!.trim()),
        text: document.body.innerText,
      }));
      await page.close();
    }
  } finally { await browser.close(); }
  return out;
}

// ───────────────────────── the live builder ─────────────────────────
for (const c of CASES) {
  test(`live builder, Google-only ${c.id}: relevant photos shown, the graphic kept off with its reason, nothing from reviews listed as an offering`, { timeout: 180_000 }, async () => {
    const r = await buildSite({ placeId: placeId(c), audit: false, screenshot: false });
    const t = r.photoTrace!;
    assert.deepEqual({ found: t.counts.found, downloaded: t.counts.downloaded, eligible: t.counts.eligible }, { found: 6, downloaded: 6, eligible: 5 }, JSON.stringify(t.counts));
    assert.ok(t.counts.rendered >= 3, `${c.id}: ${t.counts.rendered} photos on the page`);
    const graphic = t.items.find((x) => x.kind === 'other')!;
    assert.equal(graphic.stage, 'classified');
    assert.match(graphic.reason!, /classified as other/);
    for (const x of t.items.filter((i) => i.stage !== 'rendered')) assert.ok(x.reason, `${x.id} stopped at ${x.stage} without a reason`);
    assert.ok(!r.review!.checks.some((x) => x.id === 'photos-unshown'));
    // reviews and the listing don't establish offerings: none listed, and the build says what to ask the owner
    assert.deepEqual(r.services, [], `${c.id}: ${r.services.join(', ')}`);
    assert.ok(r.review!.checks.some((x) => x.id === 'offerings-unverified'));
    assert.ok(r.review!.checks.some((x) => x.id === 'brand-unknown'));
    assert.notEqual(r.review!.status, 'ready');
    // nearby towns aren't service areas, and the city is the listing's city
    assert.equal(r.facts.city, c.city);
    assert.deepEqual(r.facts.serviceAreas, []);
    const html = fs.readFileSync(path.join(r.siteDir, 'index.html'), 'utf8');
    assert.ok(!/Neighbourtown|Othertown/.test(html), 'a nearby town appears on the page');
    if (c.primaryType !== 'plumber' && c.primaryType !== 'roofing_contractor') assert.ok(!/Nothing is booked until you agree/.test(html), 'trade wording on a non-trade page');
    if (screenshotsAvailable()) {
      const b = await inBrowser(path.join(r.siteDir, 'index.html'));
      for (const [label, m] of Object.entries(b)) {
        assert.ok(m.images >= 3, `${c.id} ${label}: ${m.images} visible photos`);
        assert.equal(m.overflow, false, `${c.id} ${label} scrolls sideways`);
        assert.ok(m.h1.length > 0);
        // the dish, cut or job a review mentions is not a heading, menu item or form choice
        assert.ok(!m.headings.some((h) => c.offering.test(h)), `${c.id} ${label}: a review's offering became a heading`);
        assert.ok(!/\b(Menu|Services|Treatments and prices)\b/.test(m.headings.join(' | ')), `${c.id} ${label}: an offerings section without a business-owned source: ${m.headings.join(' | ')}`);
      }
    }
  });
}

test('live builder: a saved plan from the old classifier with no photos is reconsidered on rebuild', { timeout: 180_000 }, async () => {
  const c = CASES[0];
  const first = await buildSite({ placeId: placeId(c), audit: false, screenshot: false });
  const d = (await findDraft({ slug: first.slug }))!;
  // what the plumbing-only classifier left: every photo "other", a typography-led page with no gallery
  d.plan = { ...d.plan, hero: { variant: 'type-led' }, images: { hero: null, slides: [], team: null, gallery: [] }, sections: d.plan.sections.filter((s) => s.id !== 'gallery').map((s) => (s.id === 'hero' ? { ...s, variant: 'type-led' } : s)) };
  d.plan.copy = { headline: 'Shinwari Karahi on the Rooftop', subline: 'Come for the Shinwari Karahi.', source: 'claude' };
  await putDraft(d);
  const again = await buildSite({ placeId: placeId(c), audit: false, screenshot: false });
  assert.ok(again.photoTrace!.counts.rendered >= 3, `${again.photoTrace!.counts.rendered} photos after the rebuild`);
  assert.ok(!/Shinwari Karahi/.test(`${again.design!.copy.headline} ${again.design!.copy.subline}`), 'the review-only dish headline survived the rebuild');
  if (screenshotsAvailable()) {
    const b = await inBrowser(path.join(again.siteDir, 'index.html'));
    assert.ok(b.desktop.images >= 3 && b.mobile.images >= 3, JSON.stringify({ d: b.desktop.images, m: b.mobile.images }));
  }
});

test('a build with usable photos and none on the page gets a finding, never a clean success', async () => {
  const { photoFindings, tracePhotos } = await import('../src/design/photo-trace.js');
  const raw = await photo(3, 1600, 1067);
  const found = [0, 1].map((n) => ({ ref: `places/x/photos/${n}`, width: 1600, height: 1067, authors: [] }));
  const items = found.map((p, n) => ({ photo: p, raw, image: { publicPath: `assets/photo-${n + 1}.webp`, width: 1200, height: 800, alt: '', source: 'google' as const } }));
  const t = tracePhotos({ found, processed: { rejected: [], items, gallery: [] }, labels: { kinds: ['other', 'other'], seen: ['a plate of food', 'a dining room'], source: 'vision' }, html: '<main></main>' });
  assert.equal(t.counts.rendered, 0);
  const f = photoFindings(t);
  assert.equal(f[0]?.id, 'photos-unshown');
  assert.match(f[0].message, /2 photos were downloaded but the page shows none/);
});

// ───────────────────────── classification ─────────────────────────
test('the photo classifier is the same for every business: food, interiors and haircuts count as the business\'s own work', async () => {
  assert.ok(!/plumbing business|plumbing work|a trade's|contractor/i.test(LABEL_SYSTEM), 'trade-specific instructions');
  assert.match(LABEL_SYSTEM, /meal/);
  assert.match(LABEL_SYSTEM, /haircut/);
  const raw = await photo(5, 800, 600);
  const items = [0, 1, 2].map((n) => ({ raw, photo: { ref: `r${n}`, width: 800, height: 600, authors: [] }, image: { publicPath: '', width: 800, height: 600, alt: '', source: 'google' as const } }));
  let seenPrompt = '';
  const vision = async <T,>(o: { prompt: string }) => { seenPrompt = o.prompt; return { data: { photos: [{ index: 0, kind: 'work', seen: 'a plate of karahi' }, { index: 1, kind: 'other', seen: 'a printed menu board' }, { index: 2, kind: 'storefront' }] } as T, ms: 1 }; };
  const r = await labelPhotos(items, { name: 'Rooftop Tribe Kitchen', category: 'Afghan restaurant' }, vision as never);
  assert.match(seenPrompt, /Rooftop Tribe Kitchen.*Afghan restaurant/);
  assert.deepEqual(r.kinds, ['work', 'other', 'storefront']);
  assert.deepEqual(r.seen, ['a plate of karahi', 'a printed menu board', undefined]);
  const none = await labelPhotos(items, undefined, (async () => null) as never);
  assert.equal(none.source, 'none');
  assert.ok(none.note);
});

// ───────────────────────── addresses ─────────────────────────
test('the city comes from structured address parts: a district (Gulberg III) is never the city', () => {
  // what Google returns for a rooftop restaurant on MM Alam Road, Lahore (2026-11-04): "III" filed as the locality
  const lahore = [
    { types: ['street_number'], longText: '96 Mall' }, { types: ['route'], longText: 'MM Alam Road' }, { types: ['neighborhood', 'political'], longText: 'Block B2' },
    { types: ['sublocality_level_2', 'sublocality', 'political'], longText: 'Block B 2' }, { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Gulberg' },
    { types: ['locality', 'political'], longText: 'III' }, { types: ['administrative_area_level_3', 'political'], longText: 'Lahore Cantt' },
    { types: ['administrative_area_level_2', 'political'], longText: 'Lahore' }, { types: ['administrative_area_level_1', 'political'], longText: 'Punjab' }, { types: ['country', 'political'], longText: 'Pakistan' },
  ];
  assert.equal(cityFromComponents(lahore), 'Lahore');
  assert.equal(cityFromComponents([{ types: ['sublocality'], longText: 'Gulberg III' }, { types: ['administrative_area_level_2'], longText: 'Lahore' }]), 'Lahore');
  assert.equal(cityFromComponents([{ types: ['sublocality'], longText: 'Gulberg III' }]), undefined);
  assert.equal(cityFromComponents([{ types: ['locality'], longText: 'Austin' }, { types: ['administrative_area_level_2'], longText: 'Travis County' }]), 'Austin');
  assert.equal(cityFromComponents([{ types: ['postal_town'], longText: 'Leeds' }, { types: ['administrative_area_level_2'], longText: 'West Yorkshire' }]), 'Leeds');
  assert.equal(cityFromComponents([{ types: ['administrative_area_level_2'], longText: 'Travis County' }]), undefined, 'a county is not a city');
});

// ───────────────────────── Phase 2 Studio ─────────────────────────
test('Phase 2, Google-only restaurant: listing photos judged for relevance, shown live with credit (never copied), and the gate blocks them', { timeout: 300_000 }, async () => {
  const c = CASES[0];
  const job = await waitForStudioJob((await startStudioJob({ google: placeId(c) })).id);
  assert.equal(job.status, 'done', job.error ?? '');
  const judge: typeof judgeListingPhotos = (pid, business) => judgeListingPhotos(pid, business, {
    label: async (items) => ({ kinds: items.map((_, i) => (i === 5 ? 'other' : 'work')), seen: items.map((_, i) => (i === 5 ? 'a printed menu board' : 'a plate of food')), source: 'vision' }),
  });
  const cj = await waitForConceptJob((await startConceptJob({ businessKey: job.businessKey! }, { transport: null, judgeListing: judge })).id);
  assert.equal(cj.status, 'done', cj.error ?? '');
  const set = (await getConceptSet(cj.setId))!;
  assert.equal(set.photos!.website, 0);
  assert.equal(set.photos!.listing!.found, 6);
  assert.equal(set.photos!.listing!.fit, 5);
  assert.match(set.photos!.listing!.items.find((x) => !x.eligible)!.reason!, /classified as other \(a printed menu board\)/);
  for (const concept of set.concepts) {
    assert.ok(set.photos!.shown[concept.id].google >= 1, `${concept.id}: no listing photo shown`);
    assert.equal(concept.checks.find((x) => x.id === 'rights')!.level, 'pass', JSON.stringify(concept.checks.find((x) => x.id === 'rights')));
    assert.equal(concept.checks.find((x) => x.id === 'photos')!.level, 'pass');
    // nothing of Google's is in the saved page: stand-ins and empty credit slots only
    const html = fs.readFileSync(path.join(setDir(set.id), concept.preview!.html), 'utf8');
    assert.ok(!/googleusercontent|places\.googleapis|Guest \d/.test(html), 'Google content saved in the concept');
    assert.match(html, /data-gphoto="test-gonly-restaurant#\d"/);
    // served: the image and its credit are filled in for that view (photographer link, Google Maps link)
    const served = await fillListingPhotos(html, { uri: async (name) => `https://lh3.example/photo/${encodeURIComponent(name)}` });
    assert.ok(!/src="data:image\/svg\+xml[^"]*"[^>]*data-gphoto/.test(served), 'a stand-in was not filled');
    assert.match(served, /<span class="gcredit" data-gcredit="test-gonly-restaurant#\d">Photo: <a href="https:\/\/maps\.google\.com\/contrib\/\d"[^>]*>Guest \d<\/a> · <span translate="no">Google Maps<\/span><\/span>/);
    assert.ok(fs.existsSync(path.join(setDir(set.id), concept.preview!.desktop)) && fs.existsSync(path.join(setDir(set.id), concept.preview!.mobile)), 'desktop and mobile renders');
  }
  assert.ok(set.gate.blockers.some((b) => b.kind === 'google-photos'), 'the gate lets Google photos through');
  assert.equal(set.gate.publishable, false);
  // a photo Google no longer returns stays a stand-in, credited as unavailable
  const gone = await fillListingPhotos('<img src="data:image/svg+xml,x" data-gphoto="test-gonly-restaurant#9"><span class="gcredit" data-gcredit="test-gonly-restaurant#9"></span>');
  assert.match(gone, /data:image\/svg\+xml,x/);
  assert.match(gone, /Photo unavailable/);
});

test('Phase 2 with no usable photo at all: the concepts say so (review), never a clean "finished" concept', { timeout: 300_000 }, async () => {
  const c = CASES[1];
  const job = await waitForStudioJob((await startStudioJob({ google: placeId(c) })).id);
  const judge: typeof judgeListingPhotos = (pid, business) => judgeListingPhotos(pid, business, { label: async (items) => ({ kinds: items.map(() => 'other'), seen: items.map(() => 'printed text'), source: 'vision' }) });
  const cj = await waitForConceptJob((await startConceptJob({ businessKey: job.businessKey! }, { transport: null, judgeListing: judge })).id);
  assert.equal(cj.status, 'done', cj.error ?? '');
  const set = (await getConceptSet(cj.setId))!;
  assert.equal(set.photos!.listing!.fit, 0);
  for (const concept of set.concepts) assert.equal(concept.checks.find((x) => x.id === 'photos')!.level, 'review', `${concept.id}: a photo-free concept is presented as finished`);
});
