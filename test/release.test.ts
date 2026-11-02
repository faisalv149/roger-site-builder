// Design families, version pinning, SitePlan, SEO metadata, content review and uploads, in a throwaway store.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-release-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', PAGESPEED: '0', RESCORE: '0', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4997' });

const sharp = (await import('sharp')).default;
const { buildSite } = await import('../src/pipeline.js');
const D = await import('../src/drafts.js');
const S = await import('../src/design/schema.js');
const SP = await import('../src/design/siteplan.js');
const C = await import('../src/design/content.js');
const SEO = await import('../src/seo.js');
const { addUpload } = await import('../src/uploads.js');
const { config } = await import('../src/config.js');

const rich = await buildSite({ placeId: 'mock-demo-copperleaf', screenshot: false, audit: false });
const sparse = await buildSite({ placeId: 'mock-cat-marlow', screenshot: false, audit: false });
const read = (slug: string, f: string) => fs.readFileSync(path.join(config.dirs.sites, slug, f), 'utf8');

test('new plans pin the current family version; older plans migrate pinned to version 1', async () => {
  const d = (await D.getDraft(rich.draftId!))!;
  assert.equal(d.plan.version, 3);
  assert.equal(d.plan.family.version, S.FAMILY_CURRENT[d.plan.family.id]);
  assert.match(read(rich.slug, 'index.html'), new RegExp(`data-family="${d.plan.family.id}" data-family-version="2"`));
  // a version 2 plan (before families) keeps rendering with the earlier renderer
  const old = structuredClone(d.plan) as any;
  delete old.family; old.version = 2;
  const m = S.validatePlan(old);
  assert.ok(m.ok);
  assert.deepEqual(m.ok && m.plan.family, { id: S.familyForDirection(d.plan.direction), version: 1 });
  const v1 = await D.composeModel(d.base, (m as any).plan, { appearance: {}, offerings: d.offerings, content: d.content });
  const html = (await import('../src/render/page.js')).renderPage(v1);
  assert.match(html, /data-direction=/); // the version 1 renderer
  assert.ok(!/data-family=/.test(html));
});

test('editing content keeps the family, version, layout and locks; upgrading is explicit', async () => {
  let d = (await D.getDraft(rich.draftId!))!;
  const pinned = structuredClone(d.plan);
  pinned.family = { ...pinned.family, version: 1 };
  d.plan = pinned; await D.putDraft(d);
  d = (await D.getDraft(rich.draftId!))!;
  await D.saveDraft(d, { revision: d.revision, offerings: d.offerings.map((o, i) => (i ? o : { ...o, name: 'Water heater repair', source: 'owner' as const })) });
  d = (await D.getDraft(rich.draftId!))!;
  assert.equal(d.plan.family.version, 1, 'a content edit never upgrades the family');
  assert.equal(d.plan.id, pinned.id);
  await D.saveDraft(d, { revision: d.revision, layout: { upgradeFamily: true } });
  d = (await D.getDraft(rich.draftId!))!;
  assert.equal(d.plan.family.version, S.FAMILY_CURRENT[d.plan.family.id]);
  // the owner's family choice locks the direction: another design keeps it
  await D.saveDraft(d, { revision: d.revision, layout: { family: 'bold-practical' } });
  d = (await D.getDraft(rich.draftId!))!;
  assert.equal(d.plan.family.id, 'bold-practical');
  assert.ok(d.plan.locks.includes('direction'));
  const g = await D.generateAnother(d, {});
  assert.equal(g.plan.family.id, 'bold-practical');
});

test('site plan: a sparse business is one page; a rich one gets distinct pages with crawlable links', async () => {
  const s = (await D.getDraft(sparse.draftId!))!;
  assert.equal(s.sitePlan?.mode, 'single');
  assert.deepEqual(s.sitePlan?.pages.map((p) => p.route), ['']);
  const r = (await D.getDraft(rich.draftId!))!;
  assert.equal(r.sitePlan?.mode, 'multi');
  const routes = r.sitePlan!.pages.map((p) => p.route);
  assert.ok(routes.includes('services/') && routes.includes('contact/'));
  for (const p of r.sitePlan!.pages) {
    const html = read(r.slug, `${p.route}index.html`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${p.route}: one H1`);
    assert.match(html, /<html lang="en">/);
    if (p.route) assert.match(html, /"@type":"BreadcrumbList"/);
    // plain links to the other pages (crawlable), relative to this page
    for (const q of r.sitePlan!.pages.filter((x) => x.navLabel)) assert.ok(html.includes(`href="${SP.relLink(p.route, q.route)}"`), `${p.route} links to ${q.route}`);
  }
  // no empty or thin pages: every offering page has a real description
  for (const p of r.sitePlan!.pages.filter((x) => x.type === 'offering')) assert.ok((r.offerings.find((o) => o.id === p.offeringId)?.description?.length ?? 0) >= SP.MIN_OFFERING_TEXT);
  // the owner can choose one page; removed routes are recorded as redirects
  await D.saveDraft(r, { revision: r.revision, siteMode: 'single' });
  const one = (await D.getDraft(rich.draftId!))!;
  assert.equal(one.sitePlan!.mode, 'single');
  assert.ok(one.sitePlan!.redirects.some((x) => x.from === 'services/'));
  assert.ok(!fs.existsSync(path.join(config.dirs.sites, r.slug, 'services', 'index.html')), 'retired route removed from the preview');
  await D.saveDraft(one, { revision: one.revision, siteMode: 'multi' });
});

test('SEO metadata: unique per page, owner overrides validated, preview noindex, structured data truthful', async () => {
  const d = (await D.getDraft(rich.draftId!))!;
  const w = await D.renderWorking(d, {});
  const titles = w.sitePlan!.pages.map((p) => SEO.pageMeta(w.model, w.sitePlan!, p).title);
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(titles.every((t) => t.length <= 70));
  await assert.rejects(D.renderWorking(d, { seo: { home: { title: 'x'.repeat(200) } } }), (e: any) => e.status === 400);
  const o = await D.renderWorking(d, { seo: { home: { title: 'Copperleaf <b>Plumbing</b> Portland', description: 'Repairs and water heaters.' } } });
  assert.ok(o.sitePlan!.overrides.home.title && !/[<>]/.test(o.sitePlan!.overrides.home.title) && /Plumbing/.test(o.sitePlan!.overrides.home.title));
  const html = read(d.slug, 'index.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const biz = ld.find((x) => x['@id']?.endsWith('#business'));
  assert.ok(biz);
  assert.ok(!('aggregateRating' in biz) && !('review' in biz));
  assert.equal(biz.name, 'Copperleaf Plumbing Co.');
  // only real (non-sample) prices become offers
  assert.ok(!ld.some((x) => x['@type'] === 'OfferCatalog' && x.itemListElement.some((i: any) => i.priceSpecification === undefined)));
  assert.equal(SEO.schemaType('plumber', 'trades'), 'Plumber');
  assert.equal(SEO.schemaType('hair_salon', 'salon'), 'HairSalon');
  assert.equal(SEO.schemaType('establishment', 'general'), 'LocalBusiness');
});

test('facts: provenance kept apart from review; a changed value needs confirming again; sample can\'t be confirmed', async () => {
  const d = (await D.getDraft(rich.draftId!))!;
  let c = d.content!;
  assert.equal(c.facts.phone!.provenance.source, 'sample'); // fictional fixture
  assert.equal(C.factState(c.facts.phone), 'unreviewed');
  assert.throws(() => C.reviewFact(c, { key: 'phone', action: 'confirm' }), /Sample/);
  c = C.reviewFact(c, { key: 'phone', action: 'correct', value: '(503) 555-0199' });
  assert.equal(C.factState(c.facts.phone), 'corrected');
  assert.equal(c.facts.phone!.provenance.source, 'owner');
  // the stored value changes underneath (e.g. a later edit): the confirmation no longer counts
  const changed = structuredClone(c); changed.facts.phone!.value = '(503) 555-0100';
  assert.equal(C.factState(changed.facts.phone), 'unreviewed');
  // leave out a claim the page states (years in business, here)
  const claim = C.CLAIM_KEYS.find((k) => (c.facts as any)[k]) ?? 'years';
  if (!(c.facts as any)[claim]) c = C.reviewFact(c, { key: 'years', action: 'correct', value: 12 });
  const shownBefore = claim === 'years' ? /12 years|\d+ years in business/ : /Licensed|Insured|warrant|24 hours|Emergency/i;
  d.content = c; await D.putDraft(d); await D.refreshSavedSite(d);
  assert.match(read(d.slug, 'index.html'), shownBefore);
  c = C.reviewFact(c, { key: claim, action: 'omit' });
  d.content = c; await D.putDraft(d); await D.refreshSavedSite(d);
  const html = read(d.slug, 'index.html');
  assert.match(html, /555-0199/);
  if (claim === 'years') assert.ok(!/years in business/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'an omitted claim is not shown');
  assert.throws(() => C.reviewFact(c, { key: 'years', action: 'correct', value: -3 }));
  assert.throws(() => C.reviewFact(c, { key: 'name', action: 'omit' }));
  // a colour change is not a content change
  const before = (await D.getDraft(rich.draftId!))!.content!.revision;
  const dd = (await D.getDraft(rich.draftId!))!;
  await D.saveDraft(dd, { revision: dd.revision, appearance: { color: { mode: 'solid', preset: 'ocean' } } });
  assert.equal((await D.getDraft(rich.draftId!))!.content!.revision, before);
});

test('uploads: real images only, re-encoded under the site, publishable; media roles and focal point apply', async () => {
  let d = (await D.getDraft(rich.draftId!))!;
  await assert.rejects(addUpload(d, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'photo', ''), (e: any) => e.status === 400);
  await assert.rejects(addUpload(d, Buffer.from('not an image at all'), 'photo', ''), (e: any) => e.status === 400);
  const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#888' } }).jpeg().toBuffer();
  await assert.rejects(addUpload(d, small, 'photo', ''), /too small/);
  const photo = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#4a7' } }).jpeg().withMetadata({ exif: { IFD0: { Artist: 'secret' } } }).toBuffer();
  const file = await addUpload(d, photo, 'photo', 'Our <b>new</b> van');
  assert.match(file, /^up-[a-f0-9]{12}\.webp$/);
  const meta = await sharp(path.join(config.dirs.sites, d.slug, 'assets', file)).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined, 'metadata dropped');
  const item = d.content!.media.find((m) => m.source === 'owner')!;
  assert.equal(item.publishable, true);
  assert.ok(!/[<>]/.test(item.alt));
  d.content = C.editMedia(d.content!, { key: item.key, role: 'hero', focal: { x: 0.2, y: 0.3 } });
  await D.putDraft(d);
  d = (await D.getDraft(rich.draftId!))!;
  // a publication render uses only publishable photos: the owner's upload leads, Google/sample photos are out
  const pub = await D.composeModel(d.base, d.plan, { appearance: d.appearance, offerings: d.offerings, content: d.content, publishing: true });
  const used = [pub.design!.plan.images.hero, ...pub.design!.plan.images.gallery, pub.design!.plan.images.team].filter(Boolean);
  assert.deepEqual(used, [item.key]);
  assert.match(pub.design!.heroImages?.desktop.publicPath || '', /-f20x30\.webp$/, 'focal point crop');
  assert.equal(pub.proof.quotes.length, 0, 'no Google review text on a published page');
});

test('a real 404 page exists and nothing in the preview leaks editor code or keys', async () => {
  const d = (await D.getDraft(rich.draftId!))!;
  const nf = read(d.slug, '404.html');
  assert.match(nf, /Page not found/);
  assert.match(nf, /noindex/);
  for (const f of ['index.html', '404.html', 'robots.txt']) assert.ok(!/owner\.js|rk_[A-Za-z0-9_-]{20}|\/api\/owner|keyHash/.test(read(d.slug, f)), f);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
