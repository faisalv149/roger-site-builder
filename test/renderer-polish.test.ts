// Shared renderer rules (no business-specific overrides): photo credits wrap in full, a gallery is balanced (no photo
// alone on a row), navigation names a section by what it shows rather than a generic kind, the phone header keeps the
// name and the Menu button on one row, and sparse sections get compact spacing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-polish-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { renderSpec, mosaicLayout, isSparse } = await import('../src/studio/concepts/spec-render.js');
const { LISTING_CSS } = await import('../src/studio/concepts/listing-photos.js');
const { cat, brief, good } = await import('./helpers/northline-spec.js');
type Catalog = import('../src/studio/concepts/review.js').Catalog;

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, url: `https://northline.example.com/p${i}.jpg`, width: 1200, height: 900, orientation: 'landscape', uses: [], alt: '', services: [], seen: `Photo ${i}` }));
const withPhotos = (n: number) => ({ ...cat, photos: photos(n) }) as unknown as Catalog;

test('a gallery is balanced: up to four in a row, then rows of near-equal size, never one photo alone', () => {
  const spans = (n: number) => mosaicLayout(n).map((t) => t.span);
  assert.deepEqual(spans(4), [3, 3, 3, 3]);
  assert.deepEqual(mosaicLayout(4).map((t) => t.ar), ['1', '1', '1', '1'], 'up to four: as before');
  assert.deepEqual(spans(5), [6, 6, 4, 4, 4], 'two, then three');
  assert.deepEqual(mosaicLayout(5).map((t) => t.ar), ['3/2', '3/2', '1/1', '1/1', '1/1'], 'every row the same height');
  assert.deepEqual(spans(7), [4, 4, 4, 3, 3, 3, 3]);
  assert.deepEqual(spans(10), [4, 4, 4, 4, 4, 4, 3, 3, 3, 3]);
  for (let n = 1; n <= 12; n++) {
    const row = mosaicLayout(n).reduce<number[]>((acc, t) => { const last = acc.length ? acc[acc.length - 1] : 12; if (last + t.span > 12) acc.push(t.span); else acc[acc.length - 1] = last + t.span; return acc; }, []);
    assert.ok(row.every((w) => w === 12), `${n}: every desktop row is full`);
    const phone = mosaicLayout(n).reduce((sum, t) => sum + t.mSpan, 0);
    assert.equal(phone % 2, 0, `${n}: every phone row is full`);
  }
  assert.deepEqual(mosaicLayout(5).map((t) => t.mSpan), [2, 1, 1, 1, 1], 'phone: one wide photo, then two rows of two');
});

test('the rendered gallery uses the balanced tiles', () => {
  const s = good();
  s.sections[1].media = { placement: 'mosaic', photoIds: ['p0', 'p1', 'p2', 'p3', 'p4'] };
  const html = renderSpec(s, withPhotos(5), brief);
  assert.match(html, /<div class="mosaic" data-n="5"><div class="tile" style="--span:6;--ar:3\/2;--m-span:2;--m-ar:2\/1"><img/);
  assert.equal((html.match(/<div class="tile"/g) ?? []).length, 5);
  assert.match(html, /\.mosaic>\.tile\{grid-column:span var\(--span\)/);
  // an unverified photo is not a tile (the count is what renders)
  s.sections[1].media = { placement: 'mosaic', photoIds: ['p0', 'stock'] };
  assert.match(renderSpec(s, withPhotos(1), brief), /data-n="1"/);
});

test('photo credits wrap in full: the photographer and "Google Maps" are never cut off', () => {
  assert.doesNotMatch(LISTING_CSS, /ellipsis|nowrap/);
  assert.match(LISTING_CSS, /\.gcredit\{[^}]*white-space:normal/);
});

test('navigation names a section by its heading, not a generic kind ("Work", "Capabilities", "Approach")', () => {
  const s = good();
  s.header.links = ['work', 'about', 'contact'];
  s.sections[0] = { ...s.sections[0], kind: 'work', heading: { label: 'From the workshop' } };
  const nav = (html: string) => html.match(/<nav class="links">([\s\S]*?)<\/nav>/)![1];
  const html = renderSpec(s, cat, brief);
  assert.match(nav(html), />From the workshop</);
  assert.doesNotMatch(nav(html), />Work</);
  for (const kind of ['capabilities', 'principles'] as const) {
    s.sections[0] = { ...s.sections[0], kind, heading: { label: 'How we build' } };
    assert.match(nav(renderSpec(s, cat, brief)), />How we build</);
  }
  // plain kind names stay where they are plain to any visitor
  assert.match(nav(html), />About</);
});

test('on a phone the name and the Menu button share one row', () => {
  const s = good();
  s.mobile.navigation = 'menu-button';
  const html = renderSpec(s, cat, brief);
  const phone = html.slice(html.indexOf('@media (max-width:760px)'));
  assert.match(phone, /\.header-grid\{grid-template-columns:1fr auto\}\.header-grid>\.wordmark,\.header-grid>\.logo\{grid-column:1 !important;min-width:0\}/);
  s.mobile.navigation = 'action-only';
  assert.match(renderSpec(s, cat, brief).slice(html.indexOf('@media (max-width:760px)')), /\.header-grid>\.wordmark,\.header-grid>\.logo\{grid-column:1 !important/);
});

test('a sparse section gets compact spacing; one with photos or several items keeps its own', () => {
  const s = good();
  const contact = s.sections.find((x) => x.id === 'contact')!;
  assert.equal(isSparse(contact, cat), true, 'a heading and two buttons');
  assert.equal(isSparse(s.sections[0], cat), false, 'two services');
  const pictured = { ...contact, media: { placement: 'beside' as const, photoIds: ['p0'] } };
  assert.equal(isSparse(pictured, withPhotos(1)), false);
  const html = renderSpec(s, cat, brief);
  assert.match(html, /<section id="contact"[^>]*class="sec density-regular stack sparse"/);
  assert.doesNotMatch(html, /<section id="work"[^>]*sparse/);
  assert.match(html, /\.sec\.sparse\{--pad:60px\}/);
});
