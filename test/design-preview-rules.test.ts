// The four shared preview rules and the open planner inside a concept set: an undated seasonal promotion may not lead
// the hero; crawler debris is stripped; text-only items get a text layout, never empty image space; a one-photo strip
// fills a phone. Then an open concept is rendered into a set and passes the existing checks (real browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-preview-rules-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { config } = await import('../src/config.js');
const { stripUiDebris, undatedSeasonal } = await import('../src/util/text.js');
const D = await import('../src/studio/concepts/designspec.js');
const { renderSpec, renderSpecSet, specConcept } = await import('../src/studio/concepts/spec-render.js');
const { checkConcept, previewRules } = await import('../src/studio/concepts/validate.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Catalog = import('../src/studio/concepts/review.js').Catalog;

// ── a synthetic bakery: own lines (one seasonal, one with debris already stripped by the catalog), photos, actions ──
const ownLines = ['Baking Up Cake & Community!', 'Pre-order Thanksgiving Favorites for 11/24 and 11/25', 'Cupcakes', 'James', 'Angelina', 'Beckett', 'Strawberry Love', 'Visit us at 1905 South 1st Street, Austin, TX 78704', 'Our Menu'];
const photo = (id: string, seen: string) => ({ id, url: `https://example.com/${id}.jpg`, width: 800, height: 800, orientation: 'square', uses: ['gallery'], alt: '', services: [], seen, seenKind: 'work' });
const cat = {
  business: { name: "Sugar Loaf Bakeshop", category: 'Bakery', website: 'https://sugarloaf.example.com', summary: null },
  ownLines, services: [], story: { heading: 'About us', text: 'We bake every morning for our neighbors.' },
  actions: [{ id: 'call', label: 'Call (512) 555-0147', href: 'tel:+15125550147', kind: 'call', factId: 'phone' }, { id: 'email', label: 'Email us', href: 'mailto:hello@sugarloaf.example.com', kind: 'email', factId: 'email' }],
  omitted: [], photos: [photo('p1', 'Carrot cupcake'), photo('p2', 'Vanilla cupcake'), photo('p3', 'Bakeshop storefront')],
  logo: null, email: 'hello@sugarloaf.example.com', phone: { display: '(512) 555-0147', href: 'tel:+15125550147' },
  address: { id: 'loc-1', formatted: '1905 South 1st Street, Austin, TX 78704' }, locations: [{ id: 'loc-1', street: '1905 South 1st Street', cityLine: 'Austin, TX 78704', formatted: '1905 South 1st Street, Austin, TX 78704', directions: '' }],
  area: null, claims: [], items: [], facts: {}, sectionImages: {}, forbidden: { phones: [], hrefs: [], prices: [] },
  allowedText: [...ownLines, '(512) 555-0147', '1905 South 1st Street Austin, TX 78704'].join(' '),
} as unknown as Catalog;
const brief = { businessKey: 'site-sugarloaf.example.com', revision: 1, identity: { status: 'website-only' }, brand: { colors: [{ role: 'primary', hex: '#3F7C7D' }, { role: 'accent', hex: '#AD0000' }], fonts: [{ family: 'Teko' }, { family: 'Quicksand' }], logo: { value: null, status: 'unknown' } } } as unknown as import('../src/studio/schema.js').BusinessBrief;

const spec = (): Spec => ({
  thesis: 'A neighborhood bakery led by its own cupcakes.',
  palette: { ground: 'paper', surface: 'tint:#3F7C7D:8', ink: 'ink', inverse: '#3F7C7D', accent: '#AD0000', onAccent: 'white' },
  type: { heading: 'Teko', body: 'Quicksand', mono: null, base: 17, scale: 1.35, headingWeight: 600, headingCase: 'uppercase', tracking: 0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 24, margin: 40 }, shape: { radius: 6, rule: 'hairline' },
  header: { style: 'split', links: ['cupcakes', 'visit'], action: 'call', sticky: true },
  hero: { composition: 'Name-led headline beside a cupcake', background: 'ground', backgroundPhoto: null, minHeight: 64, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 6, headlineSize: 4.4, kicker: { ownLine: 8 }, headline: { ownLine: 0 }, lede: null, actions: ['call', 'email'], aside: { kind: 'image', start: 8, span: 5, items: [], photoId: 'p1' } },
  sections: [
    { id: 'cupcakes', purpose: 'the cupcake names', kind: 'work', heading: { ownLine: 2 }, intro: null, layout: { arrangement: 'stack', headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 4, itemStyle: 'card', density: 'regular' }, background: 'ground', items: [{ title: { ownLine: 3 }, body: null, photoId: 'p1' }, { title: { ownLine: 4 }, body: null, photoId: 'p2' }, { title: { ownLine: 5 }, body: null, photoId: null }, { title: { ownLine: 6 }, body: null, photoId: null }], actions: [], media: { placement: 'band', photoIds: ['p2'] } },
    { id: 'about', purpose: 'the story', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout: { arrangement: 'stack', headingStart: 2, headingSpan: 10, contentStart: 2, contentSpan: 10, itemColumns: 1, itemStyle: 'plain', density: 'regular' }, background: 'inverse', items: [], actions: [] },
    { id: 'visit', purpose: 'where to find it', kind: 'contact', heading: { label: 'Visit' }, intro: { ownLine: 7 }, layout: { arrangement: 'side-by-side', headingStart: 1, headingSpan: 5, contentStart: 7, contentSpan: 6, itemColumns: 1, itemStyle: 'plain', density: 'regular' }, background: 'surface', items: [], actions: ['call'], media: { placement: 'beside', photoIds: ['p3'] } },
  ],
  imagery: { approach: 'Own photos of the cupcakes and the shop.', roles: [] },
  mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: 'call', headingScale: 0.62, itemColumns: 2 },
});

test('crawler debris is stripped from own lines and story text', () => {
  assert.equal(stripUiDebris('Visit us at 1905 South 1st Street, Austin, TX 78704map marker pin'), 'Visit us at 1905 South 1st Street, Austin, TX 78704');
  assert.equal(stripUiDebris('Find us chevron-right'), 'Find us');
  assert.equal(stripUiDebris('Our marker pens are on sale'), 'Our marker pens are on sale', 'real words stay');
  assert.equal(stripUiDebris('Baking Up Cake & Community!'), 'Baking Up Cake & Community!');
});

test('an undated seasonal promotion cannot lead the hero', () => {
  assert.equal(undatedSeasonal('Pre-order Thanksgiving Favorites for 11/24 and 11/25'), 'Pre-order');
  assert.equal(undatedSeasonal('Sugar Mama\'s Has You Covered for Thanksgiving!'), 'Thanksgiving');
  assert.equal(undatedSeasonal('Orders close Nov 24'), 'Nov 24');
  assert.equal(undatedSeasonal('Thanksgiving 2026 pre-orders close November 24, 2026'), undefined, 'dated: may be checked against today');
  assert.equal(undatedSeasonal('Baking Up Cake & Community!'), undefined);
  const s = spec(); s.hero.headline = { ownLine: 1 };
  assert.match(D.validateSpec(s, cat, brief).join(' | '), /hero.headline: .* is a seasonal promotion with no year/);
  s.hero.headline = { ownLine: 0 }; s.hero.lede = { ownLine: 1 };
  assert.match(D.validateSpec(s, cat, brief).join(' | '), /hero.lede: .* seasonal promotion/);
  // lower on the page it is allowed
  const lower = spec(); lower.sections[1].intro = { ownLine: 1 };
  assert.deepEqual(D.validateSpec(lower, cat, brief), []);
});

test('text-only items get an intentional text layout; photo cards never leave empty image space', () => {
  const html = renderSpec(spec(), cat, brief);
  const sec = html.match(/<section id="cupcakes"[\s\S]*?<\/section>/)![0];
  assert.match(sec, /<ul class="items photo-items style-card" style="--cols:4">(<li class="item has-photo">[\s\S]*?<\/li>){2}<\/ul>/);
  assert.match(sec, /<ul class="items text-items style-ruled" style="--cols:4"><li class="item"><h3>Beckett<\/h3><\/li><li class="item"><h3>Strawberry Love<\/h3><\/li><\/ul>/);
  assert.ok(!/<li class="item">(?!<h3>)/.test(sec.match(/text-items[\s\S]*?<\/ul>/)![0]), 'no image slot in a text item');
});

test('a one-photo strip fills a phone without a gap; two fill it in halves; more scroll', () => {
  const html = renderSpec(spec(), cat, brief);
  assert.match(html, /<div class="band" data-n="1">/);
  assert.match(html, /\.band\[data-n="1"\]\{grid-auto-columns:100%;overflow:visible\}/);
  assert.match(html, /\.band\[data-n="2"\]\{grid-auto-columns:calc\(50% - 3px\);overflow:visible\}/);
});

test('an open concept rendered into a set passes the existing checks', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const s = spec();
  const concept = specConcept(s, 'ds_test', cat, brief);
  assert.deepEqual(concept.images.sort(), ['p1', 'p2', 'p3']);
  assert.equal(concept.designSpecId, 'ds_test');
  // the set's own photo copies, as preparePhotos leaves them
  const dir = path.join(tmp, 'out', 'studio-concepts', 'cs_test', 'img');
  fs.mkdirSync(dir, { recursive: true });
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  for (const id of ['p1', 'p2', 'p3']) fs.writeFileSync(path.join(dir, `${id}.jpg`), jpg);
  const [r] = await renderSpecSet([{ concept, spec: s }], cat, brief, 'cs_test');
  const html = fs.readFileSync(r.html, 'utf8');
  assert.match(html, /src="img\/p1.jpg" data-asset="p1"/);
  assert.match(html, /data-action="call"/);
  const checks = checkConcept(concept, r, cat);
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  for (const id of ['preview-rules', 'grounding', 'links', 'rights', 'photos', 'imagery']) assert.equal(by[id]?.level, 'pass', `${id}: ${by[id]?.message} ${(by[id]?.details ?? []).slice(0, 4).join(' | ')}`);
  assert.equal(by.accessibility.level, 'pass', (by.accessibility.details ?? []).slice(0, 6).join(' | '));
  // and the shared rule catches a seasonal hero on any rendered page
  const seasonal = { ...r, html: path.join(tmp, 'seasonal.html') };
  fs.writeFileSync(seasonal.html, '<main><section data-kind="hero"><h1>Pre-order Thanksgiving Favorites for 11/24</h1></section></main>');
  assert.match(previewRules(seasonal, fs.readFileSync(seasonal.html, 'utf8')).details!.join(' '), /undated seasonal promotion/);
});

test('a single photo beside a heading fills a phone too', () => {
  const html = renderSpec(spec(), cat, brief);
  assert.match(html, /<div class="beside" data-n="1">/);
  assert.match(html, /\.beside\[data-n="1"\]\{grid-template-columns:1fr\}/);
});
