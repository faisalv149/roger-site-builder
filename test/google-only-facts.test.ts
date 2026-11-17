// The Google-only data-to-render path, against the saved Taqueria Fenix records (a business with no website): listing
// photo descriptions attached by photo identity, verified hours and address rendered from explicit fact fields, no
// empty hero box, one rating block, and completion checks that catch each omission. The saved records are read from
// this machine's data/ folder and never copied into the repository (Google listing content is not stored there); the
// tests are skipped where they are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const SAVED = path.resolve('data');
const KEY = 'place-ChIJaaLYD7y1RIYRasTSJSFdFrc';
const FILES = { job: ['studio-concept-jobs', 'cj_98060b8613a6'], brief: ['studio-briefs', `${KEY}--r1`], inventory: ['studio-inventories', `${KEY}--r1`], review: ['studio-reviews', 'rv_f40242cf376debbc'], design: ['studio-design-specs', 'ds_2f80db921851'] } as const;
const file = ([col, id]: readonly [string, string]) => path.join(SAVED, col, `${id}.json`);
const have = Object.values(FILES).every((f) => fs.existsSync(file(f)));
const skip = have ? false : 'the saved Taqueria Fenix records are not on this machine';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const saved: Record<keyof typeof FILES, any> = have ? Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(file(f), 'utf8'))])) as never : ({} as never);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'google-facts-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { resolveCatalog } = await import('../src/studio/concepts/review.js');
const { applyPhotoChecks, judgementFor, parseListing, isListing } = await import('../src/studio/concepts/listing-photos.js');
const D = await import('../src/studio/concepts/designspec.js');
const { renderSpec } = await import('../src/studio/concepts/spec-render.js');
const { factsShown } = await import('../src/studio/concepts/validate.js');
const { requiredFailures } = await import('../src/studio/concepts/jobs.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Catalog = import('../src/studio/concepts/review.js').Catalog;

const catalog = (): Catalog => resolveCatalog(saved.brief, saved.inventory, saved.review);
/**
 * The saved judgement (cj_98060b8613a6) predates image fingerprints, so its descriptions can no longer be attached. The
 * render and completeness tests below use the same judgement with a synthetic fingerprint for each photo (a distinct
 * 128-bit value per position), as a judgement made now records.
 */
const synthFp = (n: number) => `${createHash('sha256').update(`taqueria-${n}`).digest('hex').slice(0, 32)}-808080`;
const fingerprinted = () => ({ ...saved.job.work, listing: { ...saved.job.work.listing, items: saved.job.work.listing.items.map((x: { n: number }) => ({ ...x, fp: synthFp(x.n) })) } });
/**
 * A concept job first observes each catalog photo (observeCatalogPhotos: the picture now at its place, fingerprinted).
 * Here every observation finds the same picture that was judged at that place: catalog photo #n observes synthFp(n).
 */
const observed = (cat: Catalog, fpAt: (n: number) => string = synthFp) => { for (const p of cat.photos.filter(isListing)) p.fp = fpAt(parseListing(p.url)!.n); return cat; };
/** the planner's catalog: the photos the (fingerprinted) listing judgement found fitting, with what it saw in each */
const planned = (): Catalog => { const cat = observed(catalog()); applyPhotoChecks(cat.photos, fingerprinted()); return { ...cat, photos: cat.photos.filter((p) => !!p.seen) }; };
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<br>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const metrics = (html: string) => ({ text: textOf(html) }) as never;
const sectionsWith = (html: string, re: RegExp) => [...html.matchAll(/<section id="([^"]+)"[\s\S]*?<\/section>/g)].filter((m) => re.test(m[0])).map((m) => m[1]);

test('saved listing descriptions attach only with a fingerprint: none from the old judgement, each with its own once fingerprinted', { skip }, () => {
  const old = observed(catalog());
  const unverified: { id: string; reason: string }[] = [];
  assert.equal(applyPhotoChecks(old.photos, saved.job.work, unverified), 0, 'the saved judgement records no fingerprints: identity cannot be established');
  assert.equal(unverified.length, 10);
  assert.ok(unverified.every((u) => /no unambiguous fingerprint match/.test(u.reason)));
  assert.equal(applyPhotoChecks(catalog().photos, fingerprinted()), 0, 'no observation of the current photos: nothing is attached');
  const cat = observed(catalog());
  const listed = cat.photos.filter(isListing);
  assert.equal(listed.length, 10);
  assert.equal(applyPhotoChecks(cat.photos, fingerprinted()), 10);
  for (const p of listed) {
    const n = parseListing(p.url)!.n;
    const j = saved.job.work.listing.items.find((x: { n: number }) => x.n === n);
    assert.equal(`${j.width}x${j.height}`, `${p.width}x${p.height}`, `#${n}: same size`);
    assert.equal(p.seen, j.seen, `#${n}: its own description`);
    assert.equal(p.seenKind, j.kind);
    assert.equal(p.fp, synthFp(n), `#${n}: the description travels with the fingerprint of the picture it describes`);
  }
  assert.equal(cat.photos.find((p) => p.url.endsWith('#1'))!.seenKind, 'storefront');
});

test('a description is never attached by listing position alone: it follows the picture, wherever it was judged', { skip }, () => {
  // when the photos were judged, each picture sat one place later than it does now (its judgement records that place)
  const items = (fingerprinted().listing.items) as { n: number; width: number; height: number; kind: string; seen?: string; eligible: boolean; fp: string }[];
  const moved = items.map((x) => ({ ...x, n: (x.n + 1) % items.length }));
  const cat = observed(catalog());
  applyPhotoChecks(cat.photos, { listing: { items: moved } });
  for (const p of cat.photos.filter(isListing)) {
    const n = parseListing(p.url)!.n;
    const own = items.find((x) => x.n === n)!;
    if (!own.eligible) { assert.equal(p.seen, undefined); continue; }
    assert.equal(p.seen, own.seen, `#${n}: the description of the picture observed there, not of the judgement now recorded at #${n}`);
    assert.equal(p.fp, own.fp);
  }
  assert.equal(cat.photos.find((p) => p.url.endsWith('#1'))!.seenKind, 'storefront');
  // the same places observing other pictures: nothing is attached by position
  const other = observed(catalog(), (n) => synthFp(n + 100));
  const unverified: { id: string; reason: string }[] = [];
  assert.equal(applyPhotoChecks(other.photos, fingerprinted(), unverified), 0);
  assert.ok(other.photos.every((p) => !p.seen));
  assert.equal(unverified.length, 10);
  // a photo judged not to fit gets nothing
  const out = observed(catalog());
  applyPhotoChecks(out.photos, { listing: { items: items.map((x) => ({ ...x, eligible: false })) } });
  assert.ok(out.photos.every((p) => !p.seen));
  assert.equal(judgementFor(items, { url: 'google-listing:X#1', width: 4000, height: 3001, fp: synthFp(1) }), undefined, 'a different size is a different photo');
});

test('the saved Taqueria design: every omission is caught at planning', { skip }, () => {
  const errs = D.validateSpec(saved.design.spec, planned(), saved.brief).join(' | ');
  assert.match(errs, /the verified opening hours are not shown/);
  assert.match(errs, /the verified address is not shown/);
  assert.match(errs, /hero.aside: a "contact-card" with nothing in it/);
  assert.match(errs, /the rating and the reviews link are spread over 2 sections \(reviews, rating\)/);
  assert.match(errs, /photos: 10 verified photo\(s\) are offered but the page shows none/);
});

test('the saved Taqueria design renders with no empty hero box and one rating block; the render check flags the missing facts', { skip }, () => {
  const cat = planned();
  const html = renderSpec(saved.design.spec, cat, saved.brief);
  assert.ok(!html.includes('class="hero-aside'), 'the empty contact card is left out');
  assert.match(html, /<div class="hero-text" style="grid-column:1 \/ span \d+">/);
  assert.deepEqual(sectionsWith(html, /data-fact="rating"|data-action="reviews"/), ['reviews'], 'one block: the rating line with the reviews link');
  assert.match(html, /<section id="reviews"[\s\S]*?4\.8★ from 304 Google reviews[\s\S]*?data-action="reviews"[\s\S]*?<\/section>/);
  assert.ok(!html.includes('id="rating"'), 'the second rating section is merged away');
  const check = factsShown(html, metrics(html), cat);
  assert.equal(check.level, 'fail');
  assert.deepEqual(check.details, ['the verified hours are not on the page', 'the verified address is not on the page']);
});

/** the saved design with its facts named, a photo placed, and one rating block: what a corrected planner answer looks like */
const corrected = (cat: Catalog): Spec => {
  const s: Spec = structuredClone(saved.design.spec);
  const storefront = cat.photos.find((p) => p.seenKind === 'storefront')!.id;
  s.hero.backgroundPhoto = storefront;
  s.hero.aside = { ...s.hero.aside, facts: ['address', 'phone'] };
  s.sections = s.sections.filter((x) => x.id !== 'reviews').map((x) => ({ ...x, facts: x.id === 'hours' ? ['hours'] : x.id === 'find' ? ['address'] : x.id === 'rating' ? ['rating'] : [] }));
  s.sections.find((x) => x.id === 'hours')!.media = { placement: 'mosaic', photoIds: cat.photos.filter((p) => p.seenKind === 'work').slice(0, 4).map((p) => p.id) };
  return s;
};

test('a corrected design shows the verified hours, address and photos from data, and passes every completion check', { skip }, () => {
  const cat = planned();
  const s = corrected(cat);
  assert.deepEqual(D.completeness(s, cat), []);
  const html = renderSpec(s, cat, saved.brief);
  const text = textOf(html);
  for (const line of cat.hours!) assert.ok(text.includes(line.replace(/\s+/g, ' ')), `hours line "${line}"`);
  assert.ok(text.includes('3409 E 5th St., Austin, TX 78702'));
  assert.match(html, /<section id="hours"[\s\S]*?data-fact="hours"/, 'hours by the facts field, not by the heading');
  // the same facts under any heading
  const renamed = structuredClone(s);
  renamed.sections.find((x) => x.id === 'hours')!.heading = { label: 'When we cook' };
  renamed.sections.find((x) => x.id === 'find')!.heading = { label: 'On East 5th' };
  assert.equal(factsShown(renderSpec(renamed, cat, saved.brief), metrics(renderSpec(renamed, cat, saved.brief)), cat).level, 'pass');
  assert.equal(factsShown(html, metrics(html), cat).level, 'pass');
  // listing photos: a stand-in with its credit slot in the same box, the saved description as alt text; never copied
  const imgs = [...html.matchAll(/<span class="gph"><img [^>]*src="(data:image\/svg[^"]*)"[^>]*alt="([^"]*)" data-gphoto="([^"]+)"[^>]*><span class="gcredit" data-gcredit="\3"><\/span><\/span>/g)];
  assert.equal(imgs.length, 5, 'the hero photo and the mosaic of four');
  assert.ok(imgs.every((m) => m[2].length > 0));
  assert.ok(!/googleusercontent|places\.googleapis|img\/gph_/.test(html), 'no Google image copied or linked');
  assert.match(html, /\.gcredit\{/, 'the credit style is on the page');
  assert.deepEqual(sectionsWith(html, /data-fact="rating"|data-action="reviews"/), ['rating']);
});

test('a failed required photo or facts check fails the job; a review-level photo note does not', () => {
  assert.deepEqual(requiredFailures([{ id: 'a', checks: [{ id: 'photos', level: 'review', message: 'no usable photos' }, { id: 'facts', level: 'pass', message: '' }] }] as never), []);
  assert.match(requiredFailures([{ id: 'a', checks: [{ id: 'photos', level: 'fail', message: '10 usable photo(s) available, but this concept shows none.' }] }] as never).join(), /^A photos: 10 usable photo/);
  assert.match(requiredFailures([{ id: 'a', checks: [{ id: 'facts', level: 'fail', message: '1 problem', details: ['the verified hours are not on the page'] }] }] as never).join(), /A facts: .*hours are not on the page/);
});
