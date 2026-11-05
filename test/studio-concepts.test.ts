// Design studio, phase 2: three homepage concepts from a pinned, reviewed brief. A local fixture business (a website
// with photos, services, a story) is read by Phase 1, then a Google listing is added to its snapshot to make the
// sources agree or disagree. Claude is replaced by a stand-in transport, so every test is offline and costs nothing;
// the renders use the local Chrome (they are skipped where there is none).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const PORT = 4989;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-concepts-'));
Object.assign(process.env, {
  MOCK: '1', BRAND_MEASURE: '0', STUDIO_RENDER: '0', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', STUDIO_SUMMARY: '0', STUDIO_BACKOFF_MS: '5', STUDIO_PAGE_DELAY_MS: '0',
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`, CRAWL_PAGES: '0', PAGESPEED: '0', RESCORE: '0',
  STUDIO_CONCEPT_FONTS: '0', STUDIO_CONCEPT_RETRIES: '5', STUDIO_OCR: '0',
});

const sharp = (await import('sharp')).default;
const express = (await import('express')).default;
const { startStudioJob, waitForStudioJob, getBrief, saveBrief } = await import('../src/studio/jobs.js');
const { buildFromSnapshot } = await import('../src/studio/brief.js');
const { getSnapshot } = await import('../src/studio/snapshot.js');
const { resolveCatalog, emptyReview, saveReview, withId, publicationGate, StaleBrief } = await import('../src/studio/concepts/review.js');
const { checkCopy } = await import('../src/studio/concepts/copy.js');
const { fallbackPlans, validatePlans, compose, fromAnswer } = await import('../src/studio/concepts/plan.js');
const { aiJson, CostLedger, CostCapExceeded } = await import('../src/studio/concepts/ai.js');
const { startConceptJob, runConceptJob, resumeConceptJob, waitForConceptJob, getConceptSet, getConceptJob } = await import('../src/studio/concepts/jobs.js');
const { renderSet, preparePhotos, setDir } = await import('../src/studio/concepts/render.js');
const { grounding, rights, links, imagery, accessibility, similarity, THRESHOLDS } = await import('../src/studio/concepts/validate.js');
const { studioRoutes } = await import('../src/studio/routes.js');
const { shareRoutes } = await import('../src/studio/concepts/share.js');
const { studioDocs } = await import('../src/store.js');
const { screenshotsAvailable } = await import('../src/render/og.js');
type DirectionPlan = import('../src/studio/concepts/types.js').DirectionPlan;
type AiTransport = import('../src/studio/concepts/ai.js').AiTransport;
type PageMetrics = import('../src/studio/concepts/render.js').PageMetrics;
type BusinessBrief = import('../src/studio/schema.js').BusinessBrief;
type SiteInventory = import('../src/studio/schema.js').SiteInventory;
const chrome = screenshotsAvailable();

// ───────────────────────── the fixture business ─────────────────────────
async function photo(n: number, w: number, h: number) {
  const shapes = Array.from({ length: 7 }, (_, i) => `<circle cx="${(n * 97 + i * 211) % w}" cy="${(n * 53 + i * 131) % h}" r="${60 + ((n + i) * 37) % 160}" fill="rgb(${(n * 61 + i * 40) % 255},${(n * 29 + i * 70) % 255},${(n * 83 + i * 25) % 255})" opacity="0.8"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${(n * 40) % 255},${(n * 90) % 255},${(n * 20) % 255})"/><stop offset="1" stop-color="rgb(${(n * 70 + 120) % 255},${(n * 30 + 60) % 255},${(n * 110 + 30) % 255})"/></linearGradient><filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed="${n}"/></filter></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<rect width="${w}" height="${h}" filter="url(#t)" opacity="0.6"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toBuffer();
}
const IMGS = new Map<string, Buffer>();
for (let n = 1; n <= 6; n++) IMGS.set(`/img/job-${n}.jpg`, await photo(n, 1600, 1000));
for (let n = 7; n <= 9; n++) IMGS.set(`/img/team-${n}.jpg`, await photo(n, 1000, 1400));
const nav = '<header><a href="/"><span class="logo">Cedar Lane Plumbing</span></a><nav><ul><li><a href="/services/">Services</a></li><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li></ul></nav></header>';
const foot = '<footer><p>Cedar Lane Plumbing · <a href="tel:5127410188">(512) 741-0188</a> · 2200 Cedar Lane, Austin, TX 78745</p></footer>';
const page = (title: string, body: string, extra = '') => `<!doctype html><html><head><title>${title} | Cedar Lane Plumbing</title>${extra}<style>.btn{background:#1F6F5C;color:#fff}body{font-family:"Work Sans",sans-serif}</style></head><body>${nav}<main>${body}</main>${foot}</body></html>`;
const card = (name: string, slug: string, n: number, text: string) => `<div class="service-card"><img src="/img/job-${n}.jpg" alt="${name} job in Austin" width="800" height="500"><h3>${name}</h3><p>${text}</p><a href="/services/${slug}/">Learn more</a></div>`;
const PAGES: Record<string, string> = {
  '/': page('Plumber in Austin', `<section class="hero"><h1>Plumbing repairs and water heaters in South Austin</h1><p>Plumbers serving Austin homes, on time and tidy.</p><a class="btn" href="/contact/#quote">Request a quote</a></section>
    <section class="services"><h2>Our services</h2>${card('Drain Cleaning', 'drain-cleaning', 1, 'Kitchen, bath and main-line drains cleared and camera-checked.')}${card('Water Heater Repair', 'water-heaters', 2, 'Tank and tankless water heaters repaired or replaced.')}${card('Leak Detection', 'leak-detection', 3, 'Hidden leaks found without tearing up your walls.')}</section>
    <section><h2>On the job</h2><img src="/img/job-4.jpg" alt="Copper pipes replaced under a kitchen sink" width="1600" height="1000"><img src="/img/job-5.jpg" alt="A new tankless water heater on a garage wall" width="1600" height="1000"><img src="/img/job-6.jpg" alt="A cleared main line, seen by camera" width="1600" height="1000"><img src="/img/team-8.jpg" alt="Our plumber Rosa at work" width="1000" height="1400"><img src="/img/team-9.jpg" alt="Tools laid out before a repipe" width="1000" height="1400"></section>`,
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Cedar Lane Plumbing","telephone":"(512) 741-0188","address":{"@type":"PostalAddress","streetAddress":"2200 Cedar Lane","addressLocality":"Austin","addressRegion":"TX","postalCode":"78745"}}</script>'),
  '/services/': page('Services', `<h1>Plumbing services</h1>${card('Drain Cleaning', 'drain-cleaning', 1, 'Kitchen, bath and main-line drains cleared and camera-checked.')}${card('Water Heater Repair', 'water-heaters', 2, 'Tank and tankless water heaters repaired or replaced.')}${card('Leak Detection', 'leak-detection', 3, 'Hidden leaks found without tearing up your walls.')}`),
  '/about/': page('About', '<section class="about"><h2>About us</h2><p>Cedar Lane Plumbing started with one van and a promise to show up when we say we will. We fix the problem in front of us, explain what we found, and leave the house cleaner than we found it.</p><p>Our plumbers live in South Austin, and most of our work comes from neighbours who called us once and kept our number.</p><img src="/img/team-7.jpg" alt="The Cedar Lane team beside the van" width="1000" height="1400"></section>'),
  '/contact/': page('Contact', '<h1>Contact</h1><form id="quote" action="/send" method="post"><label for="n">Name</label><input id="n" name="name" required><button type="submit">Request a quote</button></form><p>2200 Cedar Lane, Austin, TX 78745</p>'),
  '/services/drain-cleaning/': page('Drain Cleaning', '<h1>Drain Cleaning</h1><p>Drains cleared, then checked with a camera so the clog does not come back.</p>'),
  '/services/water-heaters/': page('Water Heater Repair', '<h1>Water Heater Repair</h1><p>Tank and tankless water heaters repaired the same day, or replaced.</p>'),
  '/services/leak-detection/': page('Leak Detection', '<h1>Leak Detection</h1><p>Hidden leaks found with listening equipment, without tearing up your walls.</p>'),
};
const server = http.createServer((req, res) => {
  const p = new URL(req.url!, 'http://x').pathname;
  if (IMGS.has(p)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(IMGS.get(p)); }
  if (PAGES[p]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES[p]); }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>');
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
test.after(() => server.close());
const SITE = `http://127.0.0.1:${PORT}/`;

// Phase 1, once; then two more revisions of the same business with a Google listing added to the snapshot
const listing = (phone: string) => ({ placeId: 'ChIJcedarlane', name: 'Cedar Lane Plumbing', primaryType: 'plumber', primaryTypeLabel: 'Plumber', types: ['plumber'], formattedAddress: '2200 Cedar Lane, Austin, TX 78745, USA', street: '2200 Cedar Lane', city: 'Austin', state: 'TX', zip: '78745', phone, website: SITE, mapsUrl: 'https://maps.google.com/?cid=4242', businessStatus: 'OPERATIONAL', rating: 4.8, reviewCount: 126, hours: ['Monday: 7:00 AM – 6:00 PM', 'Tuesday: 7:00 AM – 6:00 PM', 'Wednesday: 7:00 AM – 6:00 PM', 'Thursday: 7:00 AM – 6:00 PM', 'Friday: 7:00 AM – 6:00 PM', 'Saturday: Closed', 'Sunday: Closed'], photos: [] });
let briefs: { agreed: BusinessBrief; disputed: BusinessBrief; inventory: SiteInventory } | undefined;
async function getBriefs() {
  if (briefs) return briefs;
  const done = await waitForStudioJob((await startStudioJob({ website: SITE })).id);
  assert.equal(done.status, 'done', done.error ?? '');
  const snap = (await getSnapshot(done.snapshotId!))!;
  const make = async (phone: string) => {
    const s = { ...snap, listing: listing(phone) as never, identity: { ...snap.identity, status: 'verified' as const, placeId: 'ChIJcedarlane', evidence: ['phone', 'address'] } };
    const built = await buildFromSnapshot(s);
    const saved = await saveBrief(built.brief, built.inventory, done.id);
    return { brief: (await getBrief(built.brief.businessKey, saved.revision)).brief!, inventory: built.inventory };
  };
  const a = await make('(512) 741-0188');
  const d = await make('(512) 741-0999');
  briefs = { agreed: a.brief, disputed: d.brief, inventory: a.inventory };
  return briefs;
}
const refOf = (b: BusinessBrief) => ({ businessKey: b.businessKey, revision: b.revision, briefHash: b.briefHash });

test('a render restores only the concept pictures it needs', async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const own = cat.photos.filter((p) => !p.url.startsWith('listing-photo:'));
  assert.ok(own.length > 2);
  const id = `cs_subset_${Date.now()}`;
  const wanted = new Set([own[0].id]);
  const result = await preparePhotos(cat, id, async () => IMGS.values().next().value!, wanted);
  assert.ok(result.ok.includes(own[0].id));
  assert.ok(!result.ok.includes(own[1].id));
  assert.ok(fs.existsSync(path.join(setDir(id), 'img', `${own[0].id}.jpg`)));
  assert.ok(!fs.existsSync(path.join(setDir(id), 'img', `${own[1].id}.jpg`)));
});

test('single-process Chromium (as on Vercel): a concept renders at desktop and phone size, one browser per page', { skip: !chrome && 'no Chrome here' }, async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const setId = 'cs_single_process';
  const ok = await preparePhotos(cat, setId);
  cat.photos = cat.photos.filter((p) => ok.ok.includes(p.id));
  const [A] = fallbackPlans(cat, agreed).map((p, i) => compose(p, (['a', 'b', 'c'] as const)[i], 'fallback', cat, agreed, i === 0));
  const steps: string[] = [];
  process.env.STUDIO_SINGLE_PROCESS = '1';
  try {
    const [r] = await renderSet([A], cat, setId, { onStep: (s) => steps.push(s) });
    assert.ok(r.desktop.metrics.height > 0 && r.mobile.metrics.height > 0, 'both sizes rendered');
    assert.ok(fs.existsSync(r.mobile.full) && fs.existsSync(r.desktop.full));
    assert.deepEqual(steps.filter((s) => /browser start/.test(s)), ['a desktop browser start', 'a mobile browser start'], 'a fresh browser for each page');
  } finally { delete process.env.STUDIO_SINGLE_PROCESS; }
});

test('a bounded render checkpoints one concept and resumes with the next', async () => {
  const { agreed } = await getBriefs();
  const batches: string[] = [];
  let failB = true;
  const hooks: import('../src/studio/concepts/jobs.js').ConceptHooks = {
    transport: null, chunkRender: true,
    fetchImage: async () => IMGS.values().next().value!,
    render: async (concepts, _cat, setId) => {
      assert.equal(concepts.length, 1);
      const id = concepts[0].id;
      batches.push(id);
      if (id === 'b' && failB) { failB = false; throw new Error('browser closed'); }
      const dir = setDir(setId);
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
      const html = path.join(dir, `${id}.html`);
      const hero = path.join(dir, 'shots', `${id}-hero.png`);
      fs.writeFileSync(html, `<h1>${id}</h1>`);
      fs.writeFileSync(hero, await photo(1, 32, 32));
      const page = { full: hero, hero, metrics: { height: 900 } as PageMetrics };
      return [{ conceptId: id, html, desktop: page, mobile: page }];
    },
  };
  const started = await startConceptJob({ businessKey: agreed.businessKey, revision: agreed.revision }, hooks);
  const first = await runConceptJob(started.id, hooks);
  assert.equal(first.status, 'queued');
  assert.equal(first.stages.find((s) => s.name === 'render')?.status, 'pending');
  assert.deepEqual(first.work.rendered?.map((r) => r.conceptId), ['a']);
  const interrupted = await runConceptJob(started.id, hooks);
  assert.equal(interrupted.status, 'failed');
  assert.deepEqual(interrupted.work.rendered?.map((r) => r.conceptId), ['a']);
  await resumeConceptJob(started.id, hooks);
  const second = await runConceptJob(started.id, hooks);
  assert.equal(second.status, 'queued');
  assert.deepEqual(second.work.rendered?.map((r) => r.conceptId), ['a', 'b']);
  assert.deepEqual(batches, ['a', 'b', 'b']);
  assert.equal(await getConceptSet(second.setId), undefined, 'no incomplete set is published');
});

// ───────────────────────── facts, review and the publication gate ─────────────────────────
test('a disputed phone number is left out of previews with every call button; the owner\'s answer brings it back; publishing is a separate gate', async () => {
  const { agreed, disputed, inventory } = await getBriefs();
  const open = resolveCatalog(disputed, inventory, emptyReview(refOf(disputed)));
  assert.equal(open.phone, null);
  assert.ok(!open.actions.some((a) => a.kind === 'call'));
  assert.deepEqual(open.forbidden.phones.sort(), ['(512) 741-0188', '(512) 741-0999']);
  assert.ok(open.omitted.some((o) => /phone/.test(o.what) && o.questionId === 'q-contact-phone'));
  // the owner chooses: that number, and only it, comes back
  const answered = withId({ ...emptyReview(refOf(disputed), 'owner'), answers: { 'q-contact-phone': { choice: '(512) 741-0999' } } });
  const cat = resolveCatalog(disputed, inventory, answered);
  assert.equal(cat.phone?.display, '(512) 741-0999');
  assert.equal(cat.actions.find((a) => a.kind === 'call')?.href, 'tel:+15127410999');
  assert.deepEqual(cat.forbidden.phones, ['(512) 741-0188']);
  assert.ok(cat.facts.phone.sources.some((s) => s.sourceType === 'owner'));
  // publishing needs every blocking question answered and every photo approved, however the previews look
  const agreedCat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const shown = [{ images: agreedCat.photos.slice(0, 3).map((p) => p.id), sections: [] }];
  const gate = publicationGate(agreed, agreedCat, emptyReview(refOf(agreed)), shown);
  assert.equal(gate.publishable, false);
  assert.ok(gate.blockers.some((b) => b.kind === 'unconfirmed-rights'));
  const approved = withId({ ...emptyReview(refOf(agreed), 'owner'), answers: Object.fromEntries(agreed.ownerQuestions.filter((q) => q.blocking).map((q) => [q.id, { choice: q.options?.[0] ?? 'yes' }])), approvedAssets: [...agreedCat.photos.map((p) => p.id), 'logo'], approvedClaims: agreedCat.claims.map((c) => c.text) });
  // without a chosen concept, that is still a blocker; with one, only publishing itself (not built) remains
  assert.deepEqual(publicationGate(agreed, agreedCat, approved, shown).blockers.map((b) => b.kind), ['no-concept', 'not-built']);
  const chosen = withId({ ...approved, selectedConcept: { setId: 'cs_x', conceptId: 'a' } });
  const gate2 = publicationGate(agreed, agreedCat, chosen, shown, { id: 'cs_x', conceptIds: ['a'] });
  assert.deepEqual(gate2.blockers.map((b) => b.kind), ['not-built']);
  assert.equal(gate2.publishable, false);
  // a review of another revision is refused: the brief it describes is not this one
  assert.throws(() => resolveCatalog(agreed, inventory, emptyReview(refOf(disputed))), StaleBrief);
});

test('written copy frames the facts and adds none: invented numbers, names and claims are caught', async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  assert.deepEqual(checkCopy('Plumbing repairs for homes across Austin', 'hero.headline', cat), []);
  assert.deepEqual(checkCopy('Rated 4.8 from 126 reviews on Google', 'proof.intro', cat), []);
  assert.match(checkCopy('Serving Austin for 25 years', 'hero.subline', cat).join(), /"25" is not a fact/);
  assert.match(checkCopy('Plumbing repairs in Round Rock', 'hero.headline', cat).join(), /"Round" is not a name/);
  assert.match(checkCopy('The best plumbers in town', 'hero.headline', cat).join(), /"best" is a claim/);
  assert.match(checkCopy('Licensed plumbers, on time', 'hero.headline', cat).join(), /"Licensed" is a claim/);
  assert.match(checkCopy('x'.repeat(120), 'hero.headline', cat).join(), /at most 90/);
  // a claim in the business's own words passes however it is spelled; one only the AI summary makes does not
  const owned = { ...cat, story: { heading: 'About', text: 'We are a family-owned shop.' } };
  assert.deepEqual(checkCopy('Family owned and on time', 'hero.headline', owned), []);
  const summarised = { ...cat, business: { ...cat.business, summary: 'A family-owned plumber in Austin.' } };
  assert.match(checkCopy('Family owned and on time', 'hero.headline', summarised).join(), /claim the business does not make/);
});

// ───────────────────────── plans and distinctness rules ─────────────────────────
test('three directions must differ in hero, offer layout, structure, voice and colour: the fallback planner passes; colour swaps and reordered copies do not', async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const plans = fallbackPlans(cat, agreed);
  assert.deepEqual(validatePlans(plans, cat), []);
  assert.equal(new Set(plans.map((p) => p.sections[0].variant)).size, 3);
  const colourSwaps: DirectionPlan[] = (['brand-dominant', 'brand-accent', 'neutral-with-brand-action'] as const).map((c, i) => ({ ...plans[0], name: `copy ${i}`, axes: { ...plans[0].axes, colorStrategy: c, typeVoice: (['grotesk', 'serif', 'display'] as const)[i] } }));
  const errs = validatePlans(colourSwaps, cat);
  assert.ok(errs.some((e) => /same hero variant/.test(e)) && errs.some((e) => /same offer variant/.test(e)) && errs.some((e) => /same structure/.test(e)), errs.join('\n'));
  const reordered: DirectionPlan[] = [plans[0], { ...plans[0], name: 'reordered', sections: [plans[0].sections[0], ...plans[0].sections.slice(1).reverse()] }, plans[2]];
  assert.ok(validatePlans(reordered, cat).some((e) => /same hero variant/.test(e)));
  // ids must exist: a photo, action or fact Claude invents is caught
  const invented = plans.map((p, i) => (i ? p : { ...p, hero: { ...p.hero, imageIds: ['img_doesnotexist'] }, primaryAction: 'call-now' }));
  const e2 = validatePlans(invented, cat);
  assert.ok(e2.some((e) => /"img_doesnotexist" is not a photo id/.test(e)) && e2.some((e) => /"call-now" is not an action id/.test(e)));
});

// ───────────────────────── the AI client: cap, cache, retries, usage ─────────────────────────
function fakeTransport(answers: unknown[], cost = 0.04): AiTransport & { calls: number } {
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', calls: 0, async call() { const a = answers[Math.min(t.calls, answers.length - 1)]; t.calls++; return { data: a, usage: { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 5000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost, costBasis: 'computed' as const } }; } };
  return t;
}
const req = (stage: string) => ({ stage, system: 'system', prompt: `prompt for ${stage}`, schema: { type: 'object' }, maxOutputTokens: 8000 });

test('the AI client retries a rejected answer at most twice, caches what it accepts, logs every call, and never sends a request whose worst case would break the cap', async () => {
  // rejected, then accepted: two calls, both logged with their cost
  const t1 = fakeTransport([{ ok: false }, { ok: true }]);
  const l1 = new CostLedger(3, 'cs_test1');
  const r1 = await aiJson<{ ok: boolean }>(req('a'), { transport: t1, ledger: l1, validate: (d) => (d.ok ? [] : ['not ok']) });
  assert.deepEqual([r1.data, r1.attempts, t1.calls, r1.rejected.length], [{ ok: true }, 2, 2, 1]);
  assert.equal(l1.spentUsd, 0.08);
  // the same request again replays from the cache (the rejected answer, then the accepted one), at no cost
  const t2 = fakeTransport([{ ok: true }]);
  const l2 = new CostLedger(3, 'cs_test2');
  const r2 = await aiJson<{ ok: boolean }>(req('a'), { transport: t2, ledger: l2, validate: (d) => (d.ok ? [] : ['not ok']) });
  assert.deepEqual([r2.data, t2.calls, l2.spentUsd, l2.calls.length, l2.calls.every((c) => c.cacheHit)], [{ ok: true }, 0, 0, 2, true]);
  // always wrong: three calls at most, whatever STUDIO_CONCEPT_RETRIES says (it is set to 5 here)
  const t3 = fakeTransport([{ ok: false }]);
  const r3 = await aiJson<{ ok: boolean }>(req('b'), { transport: t3, ledger: new CostLedger(3, 'cs_test3'), validate: () => ['still wrong'] });
  assert.deepEqual([r3.data, t3.calls, r3.attempts], [null, 3, 3]);
  // the cap: a call whose worst case (8000 output tokens at $10/M = $0.08, plus input) exceeds what is left is not sent
  const t4 = fakeTransport([{ ok: true }]);
  const l4 = new CostLedger(0.05, 'cs_test4');
  await assert.rejects(aiJson(req('c'), { transport: t4, ledger: l4, validate: () => [] }), CostCapExceeded);
  assert.equal(t4.calls, 0);
  assert.match(l4.calls[0].error!, /worst case/);
  // every call is logged to studio-ai-usage
  const usage = fs.readdirSync(path.join(process.env.DATA_DIR!, 'studio-ai-usage'));
  assert.ok(usage.some((f) => f.startsWith('u_cs_test1_01')) && usage.some((f) => f.startsWith('u_cs_test4_01')));
});

// ───────────────────────── validators on what was rendered ─────────────────────────
const metrics = (over: Partial<PageMetrics>): PageMetrics => ({ width: 1440, height: 3000, overflowX: 0, lang: 'en', h1: 1, headingLevels: [1, 2, 3], skipLink: true, text: '', spills: [], brokenWords: [], contrast: [], targets: [], images: [], links: [], ids: ['main', 'top', 'offer'], prices: [], sections: [], ...over });

test('grounding, rights, links and accessibility catch fabricated numbers, borrowed photos, held actions and unreadable text', async () => {
  const { disputed, inventory } = await getBriefs();
  const cat = resolveCatalog(disputed, inventory, emptyReview(refOf(disputed)));
  const own = cat.photos[0].id;
  assert.equal(grounding(metrics({ text: 'Rated 4.8 from 126 reviews. 2200 Cedar Lane, Austin, TX 78745' }), cat).level, 'pass');
  const g = grounding(metrics({ text: 'Call (512) 741-0188 today. 20% off since 1998. 9 Elm St, Austin, TX 78701' }), cat);
  assert.equal(g.level, 'fail');
  assert.ok(g.details!.some((d) => /741-0188/.test(d)) && g.details!.some((d) => /"20%?"|"1998"/.test(d)) && g.details!.some((d) => /9 Elm St/.test(d)), g.details!.join('\n'));
  assert.equal(rights(metrics({ images: [{ src: `img/${own}.jpg`, alt: 'x', asset: own, ok: true, fact: null }] }), cat, { images: [own] } as never).level, 'pass');
  const r = rights(metrics({ images: [{ src: 'https://lh3.googleusercontent.com/p/abc', alt: 'x', asset: null, ok: true, fact: null }, { src: 'img/img_other.jpg', alt: 'x', asset: 'img_other', ok: false, fact: null }] }), cat, { images: [] } as never);
  assert.equal(r.level, 'fail');
  assert.ok(r.details!.some((d) => /Google photo was copied or linked/.test(d)) && r.details!.some((d) => /not one of the business's own/.test(d)));
  const l = links(metrics({ links: [{ href: 'tel:+15127410188', text: 'Call', action: 'call', fact: null, where: 'hero' }, { href: '#nowhere', text: 'Jump', action: null, fact: null, where: 'body' }, { href: 'https://example.com/promo', text: 'Promo', action: null, fact: null, where: 'body' }] }), cat);
  assert.equal(l.level, 'fail');
  assert.ok(l.details!.some((d) => /not the business's agreed number/.test(d)) && l.details!.some((d) => /#nowhere/.test(d)) && l.details!.some((d) => /not one of the business's actions/.test(d)));
  const a = accessibility(metrics({ contrast: [{ text: 'Pale text', ratio: 2.1, required: 4.5 }], targets: [{ text: 'Tiny', w: 30, h: 20 }], h1: 2, images: [{ src: 'img/x.jpg', alt: '', asset: 'x', ok: true, fact: null }] }), metrics({ overflowX: 24, brokenWords: ['SMOOTHIES'] }));
  assert.equal(a.level, 'fail');
  for (const re of [/contrast 2.1:1/, /30×20px/, /2 h1/, /sideways by 24px/, /no alt text/, /breaks the word "SMOOTHIES"/]) assert.ok(a.details!.some((d) => re.test(d)), String(re));
});

test('the in-page measuring itself: a word broken across lines, text unreadable over a photo, a small tap target and sideways scroll are seen', { skip: !chrome && 'no Chrome here' }, async () => {
  const { measureHtml } = await import('../src/studio/concepts/render.js');
  const m = await measureHtml(`<!doctype html><html lang="en"><body style="margin:0;background:#fff"><a class="skip" href="#main">Skip</a><main id="main">
    <h1 style="width:120px;font-size:40px;overflow-wrap:anywhere">Smoothies</h1>
    <div style="display:grid;grid-template-columns:100px 100px"><p style="font-size:60px;white-space:nowrap;margin:0">3,444</p><p style="margin:0">8</p></div>
    <section data-bg="#000000:0.2" style="color:#fff"><p>Light text over a thin scrim</p></section>
    <p style="color:#777">Grey on white</p><a href="#main" style="display:inline-block;width:30px;height:20px">x</a>
    <div style="width:1500px;height:10px"></div></main></body></html>`);
  assert.deepEqual(m.brokenWords, ['Smoothies']);
  assert.deepEqual(m.spills, ['3,444']);
  const thin = m.contrast.find((c) => c.text === 'Light text over a thin scrim')!;
  assert.ok(thin.ratio < 4.5, `worst case over a photo: ${thin.ratio}`);
  assert.ok(m.contrast.find((c) => c.text === 'Grey on white')!.ratio < 4.6);
  assert.ok(m.targets.some((t) => t.w === 30 && t.h === 20));
  assert.ok(m.overflowX > 0);
  assert.equal(accessibility(m, m).level, 'fail');
});

// ───────────────────────── end to end ─────────────────────────
/** the answer a planner would give: the fallback plans, with written copy */
const answerOf = (plans: DirectionPlan[]) => ({ concepts: plans.map((p, i) => ({
  name: p.name, thesis: p.thesis, evidence: p.evidence, structure: p.axes.structure, density: p.axes.density, imageryRole: p.axes.imageryRole, typeVoice: p.axes.typeVoice, colorStrategy: p.axes.colorStrategy,
  sections: p.sections, hero: { ...p.hero, headline: ['Plumbing repairs for Austin homes','Water heaters and drains, done tidy', 'Leaks found without tearing up walls'][i], subline: 'Drain cleaning, water heater repair and leak detection.' },
  titles: [{ kind: 'offer', title: 'What we fix', intro: 'Drains, water heaters and hidden leaks.' }], primaryAction: p.primaryAction ?? '', secondaryAction: p.secondaryAction ?? '', featureIds: p.featureIds, galleryImageIds: p.galleryImageIds, storyImageId: p.storyImageId ?? '', storyText: '',
})) });

test('a concept set end to end: three rendered concepts that pass every check, are distinct on screen, and say what the preview left out', { skip: !chrome && 'no Chrome here' }, async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const t = fakeTransport([answerOf(fallbackPlans(cat, agreed))], 0.06);
  const job = await startConceptJob({ businessKey: agreed.businessKey, revision: agreed.revision, briefHash: agreed.briefHash }, { transport: t });
  const done = await waitForConceptJob(job.id);
  assert.equal(done.status, 'done', done.error ?? '');
  const set = (await getConceptSet(done.setId))!;
  assert.equal(set.concepts.length, 3);
  assert.ok(set.concepts.every((c) => c.planSource === 'ai'));
  for (const c of set.concepts) for (const k of c.checks) assert.equal(k.level, 'pass', `${c.id} ${k.id}: ${k.message} ${(k.details ?? []).join('; ')}`);
  assert.ok(set.distinctness.pairs.every((p) => p.pass), JSON.stringify(set.distinctness.pairs));
  assert.equal(new Set(set.concepts.map((c) => c.axes.heroComposition)).size, 3);
  assert.deepEqual([set.cost.calls.length, set.cost.spentUsd, set.cost.capUsd], [1, 0.06, 3], done.stages.find((s) => s.name === 'directions')!.notes.join('\n'));
  for (const c of set.concepts) for (const f of [c.preview!.html, c.preview!.desktop, c.preview!.mobile]) assert.ok(fs.existsSync(path.join(setDir(set.id), f)), f);
  assert.equal(set.gate.publishable, false, 'a preview is not a publication');
  assert.ok(set.concepts[0].copy.some((x) => x.slot === 'hero.headline' && x.origin === 'generated'));
  // the same brief, review and plan give the same set (the plan now comes from the cache, at no cost)
  const again = await waitForConceptJob((await startConceptJob({ businessKey: agreed.businessKey, revision: agreed.revision, reviewId: set.reviewId }, { transport: fakeTransport([{}]) })).id);
  const set2 = (await getConceptSet(again.setId))!;
  assert.equal(set2.setHash, set.setHash);
  assert.equal(set2.cost.spentUsd, 0);
});

test('with the phone number disputed, no concept shows either number or offers a call; the gate names the question', { skip: !chrome && 'no Chrome here' }, async () => {
  const { disputed } = await getBriefs();
  const done = await waitForConceptJob((await startConceptJob({ businessKey: disputed.businessKey, revision: disputed.revision }, { transport: null })).id);
  assert.equal(done.status, 'done', done.error ?? '');
  const set = (await getConceptSet(done.setId))!;
  assert.ok(set.concepts.every((c) => c.planSource === 'fallback'));
  for (const c of set.concepts) {
    const html = fs.readFileSync(path.join(setDir(set.id), c.preview!.html), 'utf8');
    assert.ok(!/tel:/.test(html) && !/741-0188|741-0999/.test(html), `${c.id} shows a disputed number`);
    assert.ok(c.omitted.some((o) => /phone/.test(o.what)));
    assert.equal(c.checks.find((k) => k.id === 'grounding')!.level, 'pass');
  }
  assert.ok(set.gate.blockers.some((b) => b.questionId === 'q-contact-phone'));
});

test('distinctness is measured on the screenshots: a recoloured copy and a reordered copy of one concept are caught', { skip: !chrome && 'no Chrome here' }, async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const setId = 'cs_calibration';
  const ok = await preparePhotos(cat, setId);
  cat.photos = cat.photos.filter((p) => ok.ok.includes(p.id));
  const plans = fallbackPlans(cat, agreed);
  const [A, B, C] = plans.map((p, i) => compose(p, (['a', 'b', 'c'] as const)[i], 'fallback', cat, agreed, i === 0));
  const recoloured = { ...A, tokens: B.tokens };
  const reordered = { ...A, sections: [A.sections[0], ...A.sections.slice(1).reverse()] };
  const real = await renderSet([A, B, C], cat, setId);
  const [rc] = await renderSet([recoloured], cat, setId, { suffix: '-recolour' });
  const [ro] = await renderSet([reordered], cat, setId, { suffix: '-reorder' });
  const passes = (s: { heroDesktop: number; heroMobile: number; page: number }) => s.heroDesktop < THRESHOLDS.heroDesktop && s.heroMobile < THRESHOLDS.heroMobile && s.page < THRESHOLDS.page;
  const sRecolour = await similarity(real[0], rc), sReorder = await similarity(real[0], ro);
  assert.equal(passes(sRecolour), false, `recoloured copy: ${JSON.stringify(sRecolour)}`);
  assert.equal(passes(sReorder), false, `reordered copy: ${JSON.stringify(sReorder)}`);
  assert.ok(sReorder.heroDesktop > 0.9);
  for (const [x, y] of [[0, 1], [0, 2], [1, 2]]) { const s = await similarity(real[x], real[y]); assert.ok(passes(s), `${x}-${y}: ${JSON.stringify(s)}`); }
});

// ───────────────────────── regressions from the Phase 2 review ─────────────────────────
// a second fixture business: three locations on its website, no Google listing, so none is the main one
const PORT2 = PORT + 1;
const SITE2 = `http://127.0.0.1:${PORT2}/`;
const page2 = (title: string, body: string) => `<!doctype html><html><head><title>${title} | Linden Bakery</title></head><body><header><a href="/">Linden Bakery</a><nav><a href="/locations/">Locations</a><a href="/about/">About</a></nav></header><main>${body}</main><footer><a href="tel:5124410077">(512) 441-0077</a></footer></body></html>`;
const PAGES2: Record<string, string> = {
  '/': page2('Bakery in Austin', `<section class="hero"><h1>Bread and pastries baked every morning</h1><p>Three Linden Bakery shops around Austin.</p></section><section class="services"><h2>What we bake</h2><div class="service-card"><img src="/img/b-1.jpg" alt="Sourdough loaves" width="800" height="500"><h3>Sourdough</h3><p>Long-fermented loaves baked before dawn.</p></div><div class="service-card"><img src="/img/b-2.jpg" alt="Croissants on a tray" width="800" height="500"><h3>Pastries</h3><p>Croissants and buns from butter dough.</p></div><div class="service-card"><img src="/img/b-3.jpg" alt="A layered cake" width="800" height="500"><h3>Celebration Cakes</h3><p>Cakes made to order for birthdays.</p></div></section><section><img src="/img/b-4.jpg" alt="The bakery counter in the morning" width="1600" height="1000"><img src="/img/b-5.jpg" alt="Flour on the work bench" width="1600" height="1000"><img src="/img/b-6.jpg" alt="Loaves cooling on racks" width="1600" height="1000"></section>`),
  '/locations/': page2('Locations', '<h1>Our shops</h1><h3>South Lamar</h3><p>1801 S Lamar Blvd<br>Austin, TX 78704</p><h3>Mueller</h3><p>1900 Aldrich St<br>Austin, TX 78723</p><h3>Burnet</h3><p>5400 Burnet Rd<br>Austin, TX 78756</p>'),
  '/about/': page2('About', '<section class="about"><h2>About us</h2><p>Linden Bakery began as a single oven in a shared kitchen. We still bake every loaf by hand, starting before dawn, and our three shops sell what came out of the oven that morning.</p></section>'),
};
const IMGS2 = new Map<string, Buffer>();
for (let n = 1; n <= 6; n++) IMGS2.set(`/img/b-${n}.jpg`, await photo(n + 20, 1600, 1000));
const server2 = http.createServer((req, res) => {
  const p = new URL(req.url!, 'http://x').pathname;
  if (IMGS2.has(p)) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(IMGS2.get(p)); }
  if (PAGES2[p]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES2[p]); }
  res.writeHead(404); res.end('Not found');
});
await new Promise<void>((ok) => server2.listen(PORT2, '127.0.0.1', () => ok()));
test.after(() => server2.close());

test('the Veracruz C case: several locations, none chosen, and a plan that picks one location\'s Directions: the header and hero open the list of locations, and each card keeps its own directions', { skip: !chrome && 'no Chrome here' }, async () => {
  const done = await waitForStudioJob((await startStudioJob({ website: SITE2 })).id);
  assert.equal(done.status, 'done', done.error ?? '');
  const { brief, inventory } = await getBrief(done.businessKey!, done.revision);
  const b = brief!;
  const cat = resolveCatalog(b, inventory!, emptyReview(refOf(b)));
  assert.equal(cat.locations.length, 3);
  assert.equal(cat.address, null, 'no main location');
  assert.ok(cat.chooser);
  const setId = 'cs_veracruz_c_case';
  const ok = await preparePhotos(cat, setId);
  cat.photos = cat.photos.filter((p) => ok.ok.includes(p.id));
  // the plan does what Claude did for Veracruz C: its primary action is directions to one of the locations
  const first = cat.locations[0];
  const plans = fallbackPlans(cat, b).map((p) => ({ ...p, primaryAction: first.directions }));
  const concept = compose(plans[2], 'c', 'ai', cat, b, false);
  assert.deepEqual(concept.actions.find((a) => a.slot === 'primary'), { slot: 'primary', actionId: 'find-location', label: 'Find a location', href: '#visit', factId: 'locations' });
  assert.match(concept.notes!.join(), /no main location is chosen/);
  const [r] = await renderSet([concept], cat, setId);
  for (const m of [r.desktop.metrics, r.mobile.metrics]) {
    const top = m.links.filter((l) => l.where === 'head' || l.where === 'hero');
    assert.ok(top.some((l) => l.href === '#visit'), 'the header or hero opens the list of locations');
    assert.ok(!top.some((l) => /maps\/search/.test(l.href)), 'no header or hero link gives directions to one address');
    for (const loc of cat.locations) {
      const own = m.links.filter((l) => l.fact === loc.id && /maps\/search/.test(l.href));
      assert.equal(own.length, 1, `${loc.street} has its own directions`);
      assert.ok(own[0].href.includes(encodeURIComponent(loc.formatted)), `${loc.street}'s directions go to ${loc.street}`);
    }
    assert.equal(links(m, cat).level, 'pass', JSON.stringify(links(m, cat).details));
  }
  // the old behaviour, rendered: the check catches it
  const old = { ...concept, actions: [{ slot: 'primary' as const, actionId: first.directions, label: 'Directions', href: cat.actions.find((a) => a.id === first.directions)!.href, factId: first.id }] };
  const [bad] = await renderSet([old], cat, setId, { suffix: '-old' });
  const l = links(bad.desktop.metrics, cat);
  assert.equal(l.level, 'fail');
  assert.ok(l.details!.some((d) => d.includes(first.street) && /no main location is chosen/.test(d)), l.details!.join('\n'));
});

test('the Lakeside C case: a service whose own photo is missing shows no photo, never another one; the owner can tie one in review', { skip: !chrome && 'no Chrome here' }, async () => {
  const { agreed, inventory } = await getBriefs();
  const cat = resolveCatalog(agreed, inventory, emptyReview(refOf(agreed)));
  const heater = cat.services.find((s) => s.name === 'Water Heater Repair')!;
  const drain = cat.services.find((s) => s.name === 'Drain Cleaning')!;
  assert.ok(heater.imageId && drain.imageId && heater.imageFrom === 'website', 'each service has its own photo on the website');
  // the heater's own photo cannot be downloaded (as Lakeside's Decompression Therapy photo could not)
  // (the shared photo cache may already hold it, so it is taken out of this set directly)
  const setId = 'cs_lakeside_c_case';
  const ok = await preparePhotos(cat, setId);
  fs.rmSync(path.join(setDir(setId), 'img', `${heater.imageId}.jpg`), { force: true });
  cat.photos = cat.photos.filter((p) => ok.ok.includes(p.id) && p.id !== heater.imageId);
  const plan = fallbackPlans(cat, agreed).find((p) => p.sections.some((s) => s.kind === 'offer' && s.variant === 'rows'))!;
  const concept = compose({ ...plan, featureIds: [heater.id, drain.id] }, 'c', 'ai', cat, agreed, false);
  const [r] = await renderSet([concept], cat, setId);
  const m = r.desktop.metrics;
  assert.deepEqual(m.images.filter((i) => i.fact === heater.id), [], 'no photo beside Water Heater Repair');
  assert.deepEqual(m.images.filter((i) => i.fact === drain.id).map((i) => i.asset), [drain.imageId], 'Drain Cleaning shows its own photo');
  assert.equal(imagery(m, cat).level, 'pass', JSON.stringify(imagery(m, cat).details));
  const html = fs.readFileSync(r.html, 'utf8');
  assert.match(html, new RegExp(`<article class="or__row or__row--text" data-fact="${heater.id}"><div class="or__text">`), 'a tinted text row takes the place of the photo');
  // the old behaviour, rendered (a stand-in photo beside the service): the check catches it
  const stand = cat.photos.find((p) => p.id !== drain.imageId && !concept.sections[0].imageIds.includes(p.id))!.id;
  const swapped = { ...cat, services: cat.services.map((s) => (s.id === heater.id ? { ...s, imageId: stand } : s)) };
  const [bad] = await renderSet([concept], swapped, setId, { suffix: '-old' });
  const im = imagery(bad.desktop.metrics, cat);
  assert.equal(im.level, 'fail');
  assert.ok(im.details!.some((d) => d.includes('Water Heater Repair')), im.details!.join('\n'));
  // the owner ties a photo to the service in review, or takes one away
  const tied = resolveCatalog(agreed, inventory, withId({ ...emptyReview(refOf(agreed), 'owner'), serviceImages: { [heater.id]: stand, [drain.id]: null } }));
  assert.deepEqual([tied.services.find((s) => s.id === heater.id)!.imageId, tied.services.find((s) => s.id === heater.id)!.imageFrom], [stand, 'owner']);
  assert.equal(tied.services.find((s) => s.id === drain.id)!.imageId, undefined);
});

test('the API: a concept job id comes back at once; a stale brief or review is refused', async () => {
  const { agreed } = await getBriefs();
  const app = express();
  app.use(express.json());
  app.use('/api/studio', studioRoutes);
  app.use('/p', shareRoutes);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/studio`;
  try {
    const biz = (await (await fetch(`${base}/businesses`)).json()) as { businesses: { businessKey: string; revision: number }[] };
    assert.ok(biz.businesses.some((b) => b.businessKey === agreed.businessKey));
    const stale = await fetch(`${base}/concepts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessKey: agreed.businessKey, revision: agreed.revision, briefHash: 'not-the-hash' }) });
    assert.equal(stale.status, 409);
    const badReview = await fetch(`${base}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: { ...refOf(agreed), briefHash: 'old' }, reviewedBy: 'owner' }) });
    assert.equal(badReview.status, 409);
    const review = await fetch(`${base}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: refOf(agreed), reviewedBy: 'owner', answers: { 'q-claims': { choice: 'yes' } } }) });
    assert.equal(review.status, 201);
    const { id: reviewId } = (await review.json()) as { id: string };
    const r = await fetch(`${base}/concepts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessKey: agreed.businessKey, revision: agreed.revision, reviewId }) });
    assert.equal(r.status, 202);
    const { id, setId } = (await r.json()) as { id: string; setId: string };
    assert.match(id, /^cj_/);
    assert.match(setId, /^cs_/);
    const j = (await (await fetch(`${base}/concept-jobs/${id}`)).json()) as { stages: { name: string }[]; input: { reviewId: string } };
    assert.deepEqual(j.stages.map((s) => s.name), ['resolve', 'photos', 'directions', 'compose', 'render', 'validate']);
    assert.equal(j.input.reviewId, reviewId);
    const done = await waitForConceptJob(id);
    // the owner review screen: what it loads, what it saves, and the gate it shows
    const rd = (await (await fetch(`${base}/review-data/${agreed.businessKey}?revision=${agreed.revision}`)).json()) as { questions: unknown[]; photos: { id: string }[]; services: { id: string; name: string; websiteImageId: string | null }[]; sets: { id: string }[] };
    assert.ok(rd.questions.length && rd.photos.length);
    const heater = rd.services.find((s) => s.name === 'Water Heater Repair')!;
    assert.ok(heater.websiteImageId);
    if (done.status === 'done') {
      assert.equal(rd.sets[0].id, setId);
      const chose = await fetch(`${base}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: refOf(agreed), reviewedBy: 'owner', answers: {}, approvedAssets: rd.photos.map((p) => p.id), serviceImages: { [heater.id]: null }, selectedConcept: { setId, conceptId: 'b' } }) });
      assert.equal(chose.status, 201);
      const { id: rid } = (await chose.json()) as { id: string };
      const gate = (await (await fetch(`${base}/concept-sets/${setId}/gate?reviewId=${rid}`)).json()) as { publishable: boolean; blockers: { kind: string }[] };
      assert.equal(gate.publishable, false);
      assert.ok(!gate.blockers.some((b) => b.kind === 'no-concept' || b.kind === 'unconfirmed-rights'), JSON.stringify(gate.blockers));
      assert.ok(gate.blockers.some((b) => b.kind === 'not-built'));
      const after = (await (await fetch(`${base}/review-data/${agreed.businessKey}?revision=${agreed.revision}&reviewId=${rid}`)).json()) as { services: { id: string; imageId: string | null }[] };
      assert.equal(after.services.find((s) => s.id === heater.id)!.imageId, null, 'the owner took the heater picture away');
      // the client's preview link for the chosen concept: no password, that concept only, its own pictures, noindex
      const site = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const sh = await fetch(`${base}/concept-sets/${setId}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conceptId: 'b' }) });
      assert.equal(sh.status, 201);
      const { token, url, kind } = (await sh.json()) as { token: string; url: string; kind: string };
      assert.match(token, /^[a-f0-9]{32}$/);
      assert.ok(url.endsWith(`/p/${token}/`));
      assert.match(kind, /not a published website/);
      const again = (await (await fetch(`${base}/concept-sets/${setId}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conceptId: 'b' }) })).json()) as { token: string };
      assert.equal(again.token, token, 'one link per concept');
      const bare = await fetch(`${site}/p/${token}`, { redirect: 'manual' });
      assert.equal(bare.status, 301);
      const page = await fetch(`${site}/p/${token}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('x-robots-tag') ?? '', /noindex/);
      const html = await page.text();
      assert.match(html, /not a published website/);
      const set = (await getConceptSet(setId))!;
      assert.match(html, new RegExp(set.concepts.find((c) => c.id === 'b')!.copy.find((x) => x.slot === 'hero.headline')!.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const img = html.match(/src="(img\/[^"]+)"/)![1];
      assert.equal((await fetch(`${site}/p/${token}/${img}`)).status, 200);
      assert.equal((await fetch(`${site}/p/${token}/set.json`)).status, 404, 'only the page and its pictures');
      assert.equal((await fetch(`${site}/p/${'0'.repeat(32)}/`)).status, 404);
      // a job left running nowhere (its instance stopped): the next poll of its status picks it up again
      const stuck = (await getConceptJob(id))!;
      const v = stuck.stages.find((s) => s.name === 'validate')!;
      v.status = 'running';
      await studioDocs.put('studio-concept-jobs', id, { ...stuck, status: 'running', updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
      const polled = (await (await fetch(`${base}/concept-jobs/${id}`)).json()) as { status: string; resumes: number };
      assert.equal(polled.resumes, 1);
      const resumed = await waitForConceptJob(id);
      assert.equal(resumed.status, 'done', resumed.error ?? '');
    }
  } finally { srv.close(); }
});
void fromAnswer; void saveReview;
