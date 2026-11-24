// An open DesignSpec concept handed to the full site: undated seasonal promotions come off every page (and are recorded),
// the inner pages join the design's menu and take its header, footer and styles, an About page is kept for a design with
// a verified story, and the five directions' handoff keeps its own styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-handoff-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { handoffSpec } = await import('../src/studio/concepts/designspec.js');
const { renderSpec, specConcept } = await import('../src/studio/concepts/spec-render.js');
const { stripSeasonalHtml } = await import('../src/util/text.js');
const { buildSitePlan } = await import('../src/design/siteplan.js');
const { applyConceptShell } = await import('../src/studio/concepts/shell.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Catalog = import('../src/studio/concepts/review.js').Catalog;

const ownLines = ['Baking Up Cake & Community!', 'Sugar Loaf Has You Covered for Thanksgiving!', 'Pre-order Thanksgiving Favorites for 11/24 and 11/25', 'Dutch Apple Pie', '5 Full Sized Pie Flavors Available All Month!', 'Cupcakes', 'James', 'Holiday Cookie Boxes 2026', 'Our Menu'];
const cat = {
  business: { name: 'Sugar Loaf Bakeshop', category: 'Bakery', website: null, summary: null }, ownLines, services: [],
  story: { heading: 'About us', text: 'We bake every morning for our neighbors on South 1st, and we have for years.' },
  actions: [{ id: 'call', label: 'Call (512) 555-0147', href: 'tel:+15125550147', kind: 'call', factId: 'phone' }],
  omitted: [], photos: [], logo: null, email: null, phone: null, address: null, locations: [], area: null, claims: [], items: [], facts: {}, sectionImages: {}, forbidden: { phones: [], hrefs: [], prices: [] }, allowedText: '',
} as unknown as Catalog;
const brief = { businessKey: 'k', revision: 1, identity: { status: 'website-only' }, brand: { colors: [{ role: 'primary', hex: '#3F7C7D' }, { role: 'accent', hex: '#AD0000' }], fonts: [{ family: 'Teko' }, { family: 'Quicksand' }], logo: { value: null, status: 'unknown' } } } as unknown as import('../src/studio/schema.js').BusinessBrief;
const layout = { arrangement: 'stack' as const, headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 2, itemStyle: 'plain' as const, density: 'regular' as const };
const spec = (): Spec => ({
  thesis: 't', palette: { ground: 'paper', surface: 'tint:#3F7C7D:8', ink: 'ink', inverse: '#3F7C7D', accent: '#AD0000', onAccent: 'white' },
  type: { heading: 'Teko', body: 'Quicksand', mono: null, base: 17, scale: 1.35, headingWeight: 600, headingCase: 'uppercase', tracking: 0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 24, margin: 40 }, shape: { radius: 6, rule: 'hairline' },
  header: { style: 'split', links: ['menu', 'thanksgiving', 'about'], action: 'call', sticky: true },
  hero: { composition: 'c', background: 'ground', backgroundPhoto: null, minHeight: 64, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 7, headlineSize: 4.4, kicker: { ownLine: 2 }, headline: { ownLine: 0 }, lede: null, actions: ['call'], aside: { kind: 'none', start: 1, span: 0, items: [], photoId: null } },
  sections: [
    { id: 'menu', purpose: 'p', kind: 'work', heading: { ownLine: 8 }, intro: { ownLine: 2 }, layout, background: 'ground', items: [{ title: { ownLine: 5 }, body: null }, { title: { ownLine: 3 }, body: { ownLine: 4 } }, { title: { ownLine: 7 }, body: null }], actions: [] },
    { id: 'thanksgiving', purpose: 'p', kind: 'work', heading: { ownLine: 1 }, intro: null, layout, background: 'surface', items: [{ title: { ownLine: 3 }, body: null }], actions: [] },
    { id: 'about', purpose: 'p', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout, background: 'inverse', items: [], actions: [] },
  ],
  imagery: { approach: 'a', roles: [] }, mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: null, headingScale: 0.62, itemColumns: 1 },
});

test('handoff: undated seasonal promotions come off every place in the design, each recorded with why; lasting and dated content stays', () => {
  const { spec: live, omitted } = handoffSpec(spec(), cat);
  assert.deepEqual(live.sections.map((x) => x.id), ['menu', 'about'], 'the section led by a Thanksgiving promotion goes, with its items');
  assert.deepEqual(live.header.links, ['menu', 'about'], 'and its menu link');
  assert.equal(live.hero.kicker, null, 'the pre-order line above the headline goes');
  assert.equal(live.sections[0].intro, null);
  assert.equal(live.sections[0].items[1].body, null, '"All Month" under the pie goes; the pie stays');
  assert.deepEqual(live.sections[0].items.map((i) => 'ownLine' in i.title ? i.title.ownLine : -1), [5, 3, 7], 'a dated promotion (2026) stays');
  assert.equal(omitted.length, 4);
  assert.ok(omitted.every((o) => /undated seasonal promotion .* out of date/.test(o.reason)));
  assert.ok(omitted.some((o) => /section "Sugar Loaf Has You Covered for Thanksgiving!" \(1 item\(s\)\)/.test(o.what)));
  const html = renderSpec(live, cat, brief);
  assert.ok(!/Thanksgiving|Pre-order|All Month/.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
});

test('builder pages: an undated seasonal paragraph, list item or sub-heading is removed and recorded; the page structure stays', () => {
  const page = '<main><section><h2>Our Menu</h2><ul><li>Cupcakes</li><li>Pre-order Thanksgiving pies by 11/24</li></ul><p>Fresh every morning.</p><h3>Holiday Specials</h3><p>Christmas cookie boxes this week!</p></section></main>';
  const r = stripSeasonalHtml(page);
  assert.deepEqual(r.removed, ['Pre-order Thanksgiving pies by 11/24', 'Holiday Specials', 'Christmas cookie boxes this week!']);
  assert.equal(r.html, '<main><section><h2>Our Menu</h2><ul><li>Cupcakes</li></ul><p>Fresh every morning.</p></section></main>');
  assert.equal(stripSeasonalHtml('<p>Holiday cookie boxes for December 2026</p>').removed.length, 0, 'dated: stays');
});

test('site plan: a design with a verified story keeps an About page; without it, the old rule decides', () => {
  const base = { category: 'general' as never, offerings: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `o${n}`, name: `Item ${n}` })), about: { intro: 'We bake every morning for our neighbors on South 1st, and we have for years and years.', team: false, years: undefined, trust: 0, reviews: 0 }, contact: { address: true, hours: true, phone: true } };
  assert.ok(!buildSitePlan(base).pages.some((p) => p.type === 'about'), 'old rule: a short story alone is no About page');
  assert.ok(buildSitePlan({ ...base, aboutWanted: true }).pages.some((p) => p.type === 'about' && p.route === 'about/'));
  assert.ok(!buildSitePlan({ ...base, aboutWanted: true, about: { ...base.about, intro: 'Short.' } }).pages.some((p) => p.type === 'about'), 'too short for its own page even so');
});

test('the design menu lists the inner pages; a section link with the same name goes to the page', () => {
  const html = renderSpec(handoffSpec(spec(), cat).spec, cat, brief, { pages: [{ label: 'Menu', href: 'menu/' }, { label: 'About', href: 'about/' }, { label: 'Contact', href: 'contact/' }] });
  const nav = html.match(/<nav class="links">([\s\S]*?)<\/nav>/)![1];
  assert.equal(nav, '<a href="menu/">Menu</a><a href="about/">About</a><a href="contact/">Contact</a>', '"Our Menu" (2 words) and "About us" sections → their pages');
});

test('inner pages take the open design\'s header, footer and styles; a direction\'s concept keeps the library\'s', () => {
  const s = handoffSpec(spec(), cat).spec;
  const home = renderSpec(s, cat, brief, { pages: [{ label: 'Menu', href: 'menu/' }, { label: 'Contact', href: 'contact/' }] });
  const own = home.match(/<style>([\s\S]*?)<\/style>/)![1];
  const concept = specConcept(s, 'ds_x', cat, brief);
  const site = path.join(tmp, 'site');
  fs.mkdirSync(path.join(site, 'menu'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), home);
  const inner = '<html><head><title>Menu</title></head><body><header class="fw-head x">builder head</header><main><h1>Menu</h1><p>Cupcakes</p></main><footer class="fw-foot">builder foot</footer></body></html>';
  fs.writeFileSync(path.join(site, 'menu', 'index.html'), inner);
  const r = applyConceptShell(site, path.join(site, 'index.html'), home, concept.tokens, undefined, own);
  assert.deepEqual(r, { pages: 1, shelled: 1 });
  const out = fs.readFileSync(path.join(site, 'menu', 'index.html'), 'utf8');
  assert.match(out, /<div class="cx cx-head"><header class="site-header site-head style-split sticky">/);
  assert.match(out, /<nav class="links"><a href="\.\.\/menu\/">Menu<\/a><a href="\.\.\/#about">About us<\/a><a href="\.\.\/contact\/">Contact<\/a><\/nav>/, 'links rebased one folder down ("Our Menu" is the Menu page; no About page here, so the section link stays)');
  assert.match(out, /<div class="cx cx-foot"><footer class="site-footer">/);
  assert.ok(!out.includes('builder head') && !out.includes('builder foot'));
  assert.match(out, /href="https:\/\/fonts.googleapis.com\/css2\?family=Teko[^"]*" data-concept-tokens/, 'the same fonts');
  assert.match(out, /<style id="concept-shell">[^<]*\.cx:not\(#cx-own\) \.site-header\{/, 'the design\'s own header styles, scoped (above any builder class selector)');
  assert.match(out, /--brand:#AD0000/, 'the same colours on the builder\'s content');
  assert.match(out, /<main><h1>Menu<\/h1><p>Cupcakes<\/p><\/main>/, 'the page\'s own content untouched');
  // a direction's concept: no own stylesheet, the library's shell styles as before
  fs.writeFileSync(path.join(site, 'menu', 'index.html'), inner);
  applyConceptShell(site, path.join(site, 'index.html'), home, concept.tokens);
  const old = fs.readFileSync(path.join(site, 'menu', 'index.html'), 'utf8');
  assert.ok(!old.match(/<style id="concept-shell">[^<]*\.cx \.site-header\.sticky/), 'the library styles, not the open design\'s');
});
