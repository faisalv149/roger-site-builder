// The open design's inner pages: the same typography, colours, header and footer as its homepage even under the
// builder's colliding styles; pictures only where their files exist; no crawler debris; no blank reviews; and a built
// draft re-rendered only for exactly the business record it was built for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-handoff-pages-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { config } = await import('../src/config.js');
const { renderSpec, specConcept } = await import('../src/studio/concepts/spec-render.js');
const { applyConceptShell, ownContentCss } = await import('../src/studio/concepts/shell.js');
const { dropMissingImages, draftMatches, startSiteJob } = await import('../src/studio/concepts/site.js');
const { stripDebrisHtml } = await import('../src/util/text.js');
const { fillGoogleContent } = await import('../src/sources/google-live.js');
const { launchBrowser } = await import('../src/render/og.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Catalog = import('../src/studio/concepts/review.js').Catalog;

const cat = {
  business: { name: 'Sugar Loaf Bakeshop', category: 'Bakery', website: null, summary: null }, ownLines: ['Baking Up Cake & Community!', 'Our Menu'], services: [],
  story: { heading: 'About us', text: 'We bake every morning for our neighbors.' },
  actions: [{ id: 'call', label: 'Call (512) 555-0147', href: 'tel:+15125550147', kind: 'call', factId: 'phone' }],
  omitted: [], photos: [], logo: null, email: 'hello@sugarloaf.example.com', phone: null, address: null, locations: [], area: null, claims: [], items: [], facts: {}, sectionImages: {}, forbidden: { phones: [], hrefs: [], prices: [] }, allowedText: '',
} as unknown as Catalog;
const brief = { businessKey: 'k', revision: 1, identity: { status: 'website-only' }, brand: { colors: [{ role: 'primary', hex: '#3F7C7D' }, { role: 'accent', hex: '#AD0000' }], fonts: [{ family: 'Teko' }, { family: 'Quicksand' }], logo: { value: null, status: 'unknown' } } } as unknown as import('../src/studio/schema.js').BusinessBrief;
const layout = { arrangement: 'stack' as const, headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 2, itemStyle: 'plain' as const, density: 'regular' as const };
const spec: Spec = {
  thesis: 't', palette: { ground: 'paper', surface: 'tint:#3F7C7D:8', ink: 'ink', inverse: '#3F7C7D', accent: '#AD0000', onAccent: 'white' },
  type: { heading: 'Teko', body: 'Quicksand', mono: null, base: 17, scale: 1.35, headingWeight: 600, headingCase: 'uppercase', tracking: 0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 24, margin: 40 }, shape: { radius: 6, rule: 'hairline' },
  header: { style: 'split', links: ['menu', 'about'], action: 'call', sticky: true },
  hero: { composition: 'c', background: 'ground', backgroundPhoto: null, minHeight: 64, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 7, headlineSize: 4.4, kicker: null, headline: { ownLine: 0 }, lede: null, actions: ['call'], aside: { kind: 'none', start: 1, span: 0, items: [], photoId: null } },
  sections: [
    { id: 'menu', purpose: 'p', kind: 'work', heading: { ownLine: 1 }, intro: null, layout, background: 'ground', items: [], actions: [] },
    { id: 'about', purpose: 'p', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout, background: 'inverse', items: [], actions: [] },
  ],
  imagery: { approach: 'a', roles: [] }, mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: null, headingScale: 0.62, itemColumns: 1 },
};

// a builder page with the class names and rules that collided: .site-header, .site-footer, .btn, h1 face and case
const BUILDER_CSS = `:root{--font-heading:'Archivo',sans-serif;--heading:#3F7C7D;--hw:800}body{margin:0;font-family:Arial}h1,h2,h3{font-family:var(--font-heading);font-weight:var(--hw);color:var(--heading);text-transform:none}.site-header{padding:20px;background:#eee;border-bottom:3px solid #000}.site-footer{background:#480000;color:#fff;padding:80px}.btn{padding:30px 60px;border-radius:40px}.grid{display:block}nav a{padding:12px;font-size:22px}.fw-sec-head h2{text-transform:none;letter-spacing:0}`;
const builderPage = `<!doctype html><html lang="en"><head><title>Menu</title><style>${BUILDER_CSS}</style></head><body><div class="fw-strip"><div class="wrap fw-strip-in"><span>Tue–Sat 10–7</span></div></div><header class="fw-head">builder</header><main><h1>Menu</h1><div class="fw-sec-head"><h2>Cupcakes</h2></div></main><footer class="fw-foot">builder</footer></body></html>`;

test('inner pages get the design\'s tokens, typography and strong-scoped header/footer styles; the builder strip goes', () => {
  const tokens = specConcept(spec, 'ds_x', cat, brief).tokens;
  assert.match(tokens.fonts.href, /family=Teko.*family=Quicksand/, 'tokens from the saved spec carry its font stylesheet');
  const home = renderSpec(spec, cat, brief, { pages: [{ label: 'Menu', href: 'menu/' }] });
  const site = path.join(tmp, 'site1'); fs.mkdirSync(path.join(site, 'menu'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), home); fs.writeFileSync(path.join(site, 'menu', 'index.html'), builderPage);
  applyConceptShell(site, path.join(site, 'index.html'), home, tokens, undefined, home.match(/<style>([\s\S]*?)<\/style>/)![1], { contentCss: ownContentCss(tokens, { tracking: 0.02, headingColor: tokens.colors.ink }) });
  const out = fs.readFileSync(path.join(site, 'menu', 'index.html'), 'utf8');
  assert.ok(!out.includes('fw-strip'), 'the builder strip above the header is gone');
  assert.match(out, /\.cx:not\(#cx-own\),\.cx:not\(#cx-own\) \*\{all:revert\}/, 'builder styles reset inside the shared header and footer');
  assert.match(out, /\.cx:not\(#cx-own\) \.site-footer\{/);
  assert.match(out, /--heading:#0B0D12;--hw:600;--h-track:0\.02em\}:is\(h1,h2,h3,\.h\):not\(#cx-own\)\{text-transform:uppercase;letter-spacing:0\.02em\}/);
});

test('in a browser: header height, footer, heading face, case and colour match the homepage despite colliding builder CSS', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const site = path.join(tmp, 'site1');
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const measure = async (file: string) => {
      await page.goto('file:///' + file.split(path.sep).join('/'), { waitUntil: 'load' });
      return page.evaluate(`(() => { const h = document.querySelector('header.site-head'), f = document.querySelector('footer.site-foot, footer.site-footer'), wm = document.querySelector('.wordmark'), btn = h.querySelector('.btn'), h1 = document.querySelector('main h1') || document.querySelector('h1');
        const c = (e, p) => getComputedStyle(e)[p];
        return { headerH: Math.round(h.getBoundingClientRect().height), headerBg: c(h, 'backgroundColor'), footerBg: c(f, 'backgroundColor'), footerColor: c(f, 'color'), footerPad: c(f, 'paddingTop'), wordmark: c(wm, 'fontFamily'), btnPad: c(btn, 'paddingLeft'), btnRadius: c(btn, 'borderTopLeftRadius'), h1Face: c(h1, 'fontFamily'), h1Case: c(h1, 'textTransform'), h1Color: c(h1, 'color') }; })()`) as Promise<Record<string, string | number>>;
    };
    const home = await measure(path.join(site, 'index.html'));
    const inner = await measure(path.join(site, 'menu', 'index.html'));
    for (const k of ['headerH', 'headerBg', 'footerColor', 'footerPad', 'wordmark', 'btnPad', 'btnRadius', 'h1Case', 'h1Color']) assert.equal(inner[k], home[k], `${k}: inner ${inner[k]} vs home ${home[k]}`);
    assert.notEqual(inner.footerBg, 'rgb(72, 0, 0)', 'the builder\'s dark footer does not leak in');
    assert.match(String(inner.h1Face), /Teko/);
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.fw-sec-head h2')).textTransform"), 'uppercase', 'a builder section heading takes the design\'s case despite its own rule');
  } finally { await browser.close(); }
});

test('pictures show only where their files exist: missing tiles go, a gallery left empty goes, remote pictures stay', () => {
  const dir = path.join(tmp, 'site2', 'about'); fs.mkdirSync(path.join(tmp, 'site2', 'assets'), { recursive: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'site2', 'assets', 'here.webp'), 'x');
  const html = `<section class="fw-gallery"><figure><button><img src="../assets/here.webp" alt="a"></button></figure><figure><button><img src="../assets/gone.webp" alt="b"></button></figure></section>`
    + `<section class="fw-gallery" id="g2"><figure><img src="../assets/gone2.webp" alt="c"></figure></section><p><img src="https://example.com/x.jpg" alt="remote"><img src="../assets/gone3.webp" alt="d"></p><img alt="" data-lb-img>`;
  const r = dropMissingImages(html, dir);
  assert.deepEqual(r.dropped.sort(), ['../assets/gone.webp', '../assets/gone2.webp', '../assets/gone3.webp']);
  assert.match(r.html, /here\.webp/);
  assert.ok(!r.html.includes('id="g2"'), 'the gallery with no picture left is removed');
  assert.match(r.html, /https:\/\/example\.com\/x\.jpg/);
  assert.match(r.html, /<img alt="" data-lb-img>/, 'a lightbox template with no src is not a missing file');
});

test('crawler debris: a debris-only button goes, debris in text is cut, icon-only links and attributes stay', () => {
  const html = '<div class="cta"><a class="btn" href="https://maps.google.com/x">map marker pin</a><a href="https://instagram.com/x" aria-label="Instagram"><svg viewBox="0 0 1 1"></svg></a></div><p>Visit us at 1905 South 1st Street, Austin, TX 78704map marker pin</p><span aria-label="map marker pin">Austin</span>';
  const r = stripDebrisHtml(html);
  assert.equal(r.html, '<div class="cta"><a href="https://instagram.com/x" aria-label="Instagram"><svg viewBox="0 0 1 1"></svg></a></div><p>Visit us at 1905 South 1st Street, Austin, TX 78704</p><span aria-label="map marker pin">Austin</span>');
  assert.equal(stripDebrisHtml('<p>Nothing to clean.</p>').removed, 0);
});

test('a review Google no longer returns is removed, not left as an empty card', async () => {
  const html = '<div class="fw-quotes"><figure class="fw-quote"><blockquote><p>⟦g:t:PLACE1:0:5⟧</p></blockquote><figcaption>⟦g:a:PLACE1:0⟧ · Google review</figcaption></figure><figure class="fw-quote"><blockquote><p>⟦g:t:PLACE1:1:5⟧</p></blockquote><figcaption>⟦g:a:PLACE1:1⟧ · Google review</figcaption></figure></div>';
  const out = await fillGoogleContent(html, { reviews: async () => ({ reviews: [{ rating: 5, author: 'Ana', text: 'Lovely cakes.' }] }) as never });
  assert.equal((out.match(/<figure/g) ?? []).length, 1);
  assert.match(out, /Lovely cakes\./);
  assert.ok(!/hidden><\/figure>/.test(out));
});

test('a built draft is re-rendered only for exactly its business record, never for another record sharing a website', async () => {
  assert.equal(draftMatches({ businessKey: 'site-sugarloaf.example.com', revision: 1 }, { businessKey: 'site-sugarloaf.example.com', revision: 1 }), true);
  assert.equal(draftMatches({ businessKey: 'place-ChIJabc', revision: 1 }, { businessKey: 'site-sugarloaf.example.com', revision: 1 }), false, 'same website, different record');
  assert.equal(draftMatches({ businessKey: 'site-sugarloaf.example.com', revision: 1 }, { businessKey: 'site-sugarloaf.example.com', revision: 2 }), false, 'another revision');
  await assert.rejects(startSiteJob('cs_missing', 'a', { reuse: { businessKey: 'k', revision: 1 } }), /No such concept set/);
});

test('a page already in an earlier design takes the new design\'s header and footer (never keeps the old ones)', () => {
  const site = path.join(tmp, 'site3'); fs.mkdirSync(path.join(site, 'menu'), { recursive: true });
  const tokens = specConcept(spec, 'ds_x', cat, brief).tokens;
  const first = renderSpec(spec, cat, brief, { pages: [{ label: 'Menu', href: 'menu/' }] });
  fs.writeFileSync(path.join(site, 'index.html'), first); fs.writeFileSync(path.join(site, 'menu', 'index.html'), builderPage);
  applyConceptShell(site, path.join(site, 'index.html'), first, tokens, undefined, first.match(/<style>([\s\S]*?)<\/style>/)![1]);
  // another design (other sections) applied to the same pages, which the builder did not rewrite in between
  const next: Spec = { ...spec, header: { ...spec.header, links: ['about'] }, sections: [spec.sections[1]] };
  const second = renderSpec(next, cat, brief, { pages: [{ label: 'Menu', href: 'menu/' }, { label: 'Contact', href: 'contact/' }] });
  fs.writeFileSync(path.join(site, 'index.html'), second);
  const r = applyConceptShell(site, path.join(site, 'index.html'), second, tokens, undefined, second.match(/<style>([\s\S]*?)<\/style>/)![1]);
  assert.equal(r.shelled, 1);
  const out = fs.readFileSync(path.join(site, 'menu', 'index.html'), 'utf8');
  assert.equal((out.match(/class="cx cx-head"/g) ?? []).length, 1, 'one shared header, not two');
  assert.match(out, /<nav class="links"><a href="\.\.\/#about">About us<\/a><a href="\.\.\/menu\/">Menu<\/a><a href="\.\.\/contact\/">Contact<\/a><\/nav>/, 'the new design\'s menu');
  assert.ok(!out.includes('../#menu'), 'nothing of the old menu');
  assert.equal((out.match(/<style id="concept-shell">/g) ?? []).length, 1, 'styles replaced, not stacked');
});
