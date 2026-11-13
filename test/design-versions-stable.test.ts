// Stable open-design versions: empty content suppressed by its type, a structure rule that lets necessary sections stay,
// immutable version links (a second conversation for the same business never touches them), pinned links that never
// move, and copies that must be the version's own design.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-stable-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { config } = await import('../src/config.js');
const { renderSpec, contentKind } = await import('../src/studio/concepts/spec-render.js');
const { structuralChange, differenceProblems } = await import('../src/studio/concepts/designspec.js');
const { snapshotVersion, versionSlug } = await import('../src/imessage/intake.js');
const { pinSiteLink, pinnedPath, getSitePin } = await import('../src/site-pins.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;

const ownLines = ['Sweetest treats in town!', 'Reviews', 'Review by - Yelp', 'five star review by Jef R.:', 'five star review by Maha B.:', 'Contact us', 'Find us on...', 'Hours', 'Cupcakes', 'James', 'Location', 'Visit us at 1905 South 1st Street, Austin, TX 78704', 'Our Menu', 'Events', 'We are updating our events'];
const cat = { business: { name: 'Sugar Loaf Bakeshop', summary: null }, ownLines, services: [], story: null, omitted: [], photos: [], logo: null, email: null, address: null, locations: [], area: null, hours: ['Tue–Sat: 10:00 AM – 7:00 PM'],
  actions: [{ id: 'reviews', label: 'Read the reviews on Google', href: 'https://maps.google.com/x', kind: 'reviews', factId: 'rating' }] } as never;
const brief = { brand: { colors: [{ hex: '#3F7C7D' }, { hex: '#AD0000' }], fonts: [], logo: { value: null, status: 'unknown' } } } as never;
const L = (o: object = {}) => ({ arrangement: 'stack' as const, headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 3, itemStyle: 'card' as const, density: 'regular' as const, ...o });
const i = (n: number, b?: number) => ({ title: { ownLine: n }, body: b === undefined ? null : { ownLine: b } });
const spec = (): Spec => ({
  thesis: 't', palette: { ground: 'paper', surface: 'tint:#3F7C7D:8', ink: 'ink', inverse: '#3F7C7D', accent: '#AD0000', onAccent: 'white' },
  type: { heading: 'Teko', body: 'Quicksand', mono: null, base: 17, scale: 1.35, headingWeight: 600, headingCase: 'uppercase', tracking: 0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 24, margin: 40 }, shape: { radius: 6, rule: 'hairline' },
  header: { style: 'split', links: ['menu', 'reviews', 'events', 'visit'], action: null, sticky: true },
  hero: { composition: 'c', background: 'ground', backgroundPhoto: null, minHeight: 64, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 6, headlineSize: 4.4, kicker: null, headline: { ownLine: 0 }, lede: null, actions: [], aside: { kind: 'line-list', start: 8, span: 5, items: [{ ownLine: 8 }, { ownLine: 5 }], photoId: null } },
  sections: [
    { id: 'menu', purpose: 'p', kind: 'work', heading: { ownLine: 12 }, intro: null, layout: L(), background: 'ground', items: [i(8), i(9)], actions: [] },
    { id: 'reviews', purpose: 'p', kind: 'statement', heading: { ownLine: 1 }, intro: { ownLine: 2 }, layout: L({ itemStyle: 'ruled' }), background: 'inverse', items: [i(3), i(4)], actions: ['reviews'] },
    { id: 'events', purpose: 'p', kind: 'statement', heading: { ownLine: 13 }, intro: null, layout: L(), background: 'ground', items: [i(14)], actions: [] },
    { id: 'visit', purpose: 'p', kind: 'contact', heading: { ownLine: 10 }, intro: null, layout: L(), background: 'surface', items: [i(10, 11), i(7), i(5), i(6)], actions: [] },
  ],
  imagery: { approach: 'a', roles: [] }, mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: null, headingScale: 0.62, itemColumns: 1 },
});

test('content types: a review needs its text, a label needs its content, a menu or service name stands alone', () => {
  assert.equal(contentKind('five star review by Jef R.:'), 'review-attribution');
  assert.equal(contentKind('Review by - Yelp'), 'review-attribution');
  assert.equal(contentKind('Contact us'), 'label');
  assert.equal(contentKind('Find us on...'), 'label');
  assert.equal(contentKind('Cupcakes'), 'name');
  assert.equal(contentKind('James'), 'name');
  assert.equal(contentKind('Strawberry Love'), 'name');
  const html = renderSpec(spec(), cat, brief);
  const body = html.replace(/<style[\s\S]*?<\/style>/, '');
  for (const gone of ['five star review by', 'Review by - Yelp', '>Contact us<', '>Find us on...<', 'We are updating our events']) assert.ok(!body.includes(gone), `"${gone}" is not shown`);
  assert.match(body, /<h3>Cupcakes<\/h3>/, 'a menu item name stands alone');
  assert.match(body, /<h3>James<\/h3>/);
  assert.match(body, /<h3>Hours<\/h3><p>Tue–Sat: 10:00 AM – 7:00 PM<\/p>/, 'Hours shows the verified hours');
  assert.match(body, /<h3>Location<\/h3><p>Visit us at 1905 South 1st Street/, 'a label with its content stays');
  // no fake review; with no review text and no verified rating, the reviews band (heading and button only) is left out;
  // the events section has nothing left either: both gone, with their menu links
  assert.ok(!body.includes('id="reviews"'));
  assert.ok(!/href="#reviews"/.test(body));
  assert.ok(!body.includes('id="events"'));
  assert.ok(!/href="#events"/.test(body));
  // the hero list keeps the name and drops the label
  assert.match(body, /<li>Cupcakes<\/li>/);
  assert.ok(!/<li>Contact us<\/li>/.test(body));
});

test('a new version may keep necessary sections as they are; it still needs enough structural change, and order never counts', () => {
  const page = ['work/stack/card/no-media', 'capabilities/side-by-side/ruled/mosaic', 'story/side-by-side/plain/beside', 'statement/stack/large-type/no-media', 'contact/side-by-side/ruled/no-media', 'work/stack/plain/band'];
  // menu, story, statement and contact stay; capabilities set out differently; a gallery added instead of the band
  const next = ['work/stack/card/no-media', 'capabilities/stack/numbered/no-media', 'story/side-by-side/plain/beside', 'statement/stack/large-type/no-media', 'contact/side-by-side/ruled/no-media', 'gallery/stack/plain/mosaic'];
  const d = structuralChange(next, page);
  assert.ok(d.changed >= d.needed, `${d.changed} ≥ ${d.needed}: ${d.detail}`);
  assert.match(d.detail, /capabilities set out differently/);
  assert.deepEqual(structuralChange([...page].reverse(), page), { changed: 0, needed: 2, detail: '', meaningful: 5 }, 'reordering is no change');
  assert.equal(structuralChange([page[0], page[1], page[2], page[3], page[4], 'work/stack/plain/mosaic'], page).changed, 1, 'one restyled section is not enough');
  // and through the spec rule: a reskin of the same structure is refused
  const s = spec();
  const reskin = { ...s, palette: { ...s.palette, ground: 'white' as const }, sections: [...s.sections].reverse() };
  assert.match(differenceProblems(reskin, [s]).join(' | '), /hero: too close[\s\S]*page structure: too close/);
});

test('version links are immutable and unique per conversation; a copy must be the version\'s own design', async () => {
  const base = path.join(config.dirs.sites, 'sugar-loaf');
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'index.html'), '<meta name="roger-design" content="ds_a"><h1>A</h1>');
  const url = `${config.publicBaseUrl}/sites/sugar-loaf/`;
  // two conversations for the same business: their first versions have different links
  const first = versionSlug('sugar-loaf', 'in_conv1', 1), second = versionSlug('sugar-loaf', 'in_conv2', 1);
  assert.notEqual(first, second);
  assert.equal(await snapshotVersion(url, first, { designId: 'ds_a' }), `${config.publicBaseUrl}/sites/sugar-loaf-inconv1-v1/`);
  // the second conversation's build replaces the draft's own folder; it cannot be copied under the first one's link
  fs.writeFileSync(path.join(base, 'index.html'), '<meta name="roger-design" content="ds_b"><h1>B</h1>');
  await assert.rejects(snapshotVersion(url, first, { designId: 'ds_b' }), /already holds a version; a version's link never changes/);
  await assert.rejects(snapshotVersion(url, versionSlug('sugar-loaf', 'in_conv1', 2), { designId: 'ds_a' }), /the built site is design ds_b, not ds_a/);
  await snapshotVersion(url, second, { designId: 'ds_b' });
  assert.match(fs.readFileSync(path.join(config.dirs.sites, first, 'index.html'), 'utf8'), /<h1>A<\/h1>/, 'conversation 1\'s link still shows its version');
  assert.match(fs.readFileSync(path.join(config.dirs.sites, second, 'index.html'), 'utf8'), /<h1>B<\/h1>/);
  // re-applying the same saved design to its own link is the one allowed rewrite
  fs.writeFileSync(path.join(base, 'index.html'), '<meta name="roger-design" content="ds_a"><h1>A, fixed</h1>');
  await snapshotVersion(url, first, { designId: 'ds_a', replace: true });
  assert.match(fs.readFileSync(path.join(config.dirs.sites, first, 'index.html'), 'utf8'), /A, fixed/);
});

test('an unversioned link pinned to a version keeps serving it, and the pin never moves', async () => {
  await pinSiteLink('sugar-loaf', 'sugar-loaf-inconv1-v1', 'first sent unversioned', 'in_conv1-v1');
  assert.equal(await pinnedPath('/sugar-loaf/'), '/sugar-loaf-inconv1-v1/');
  assert.equal(await pinnedPath('/sugar-loaf/menu/'), '/sugar-loaf-inconv1-v1/menu/');
  assert.equal(await pinnedPath('/sugar-loaf/assets/concept/a.jpg'), '/sugar-loaf-inconv1-v1/assets/concept/a.jpg');
  assert.equal(await pinnedPath('/sugar-loaf-inconv2-v1/'), '/sugar-loaf-inconv2-v1/', 'other links are untouched');
  await assert.rejects(pinSiteLink('sugar-loaf', 'sugar-loaf-inconv2-v1', 'later'), /already pinned .* a pinned link never changes/);
  assert.equal((await getSitePin('sugar-loaf'))?.to, 'sugar-loaf-inconv1-v1');
  await pinSiteLink('sugar-loaf', 'sugar-loaf-inconv1-v1', 'again');
});
