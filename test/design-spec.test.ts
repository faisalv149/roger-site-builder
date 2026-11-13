// The open design planner: a DesignSpec composed from the business's own words and brand, checked for evidence,
// repaired at most once, rendered by a generic interpreter of layout primitives. One synthetic consultancy; Claude is
// replaced; the last test renders in a real browser at 390px.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-design-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { config } = await import('../src/config.js');
const D = await import('../src/studio/concepts/designspec.js');
const { renderSpec, renderDesignFiles } = await import('../src/studio/concepts/spec-render.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type AiTransport = import('../src/studio/concepts/ai.js').AiTransport;

// ── a synthetic consultancy: own lines, two services, a story, email + contact page, no phone, no photos ──
const cat = {
  business: { name: 'Northline Systems, LLC', category: null, website: 'https://northline.example.com', summary: 'A systems consultancy.' },
  ownLines: ['Systems that talk to each other.', 'Integration', 'Migration', 'The person you talk to does the work.', 'Tell me what needs to connect.'],
  services: [{ id: 'svc-int', name: 'Integration', description: 'Connect your ERP to the tools around it.' }, { id: 'svc-mig', name: 'Migration', description: 'Move from the old system without losing history.' }],
  story: { heading: 'About', text: 'I combine business operations experience with engineering.' },
  actions: [{ id: 'cta-primary', label: 'Discuss your project', href: 'https://northline.example.com/contact', kind: 'site', factId: 'cta-primary' }, { id: 'email', label: 'Email us', href: 'mailto:hello@northline.example.com', kind: 'email', factId: 'email' }],
  omitted: [{ what: 'phone number and every call button', reason: 'no phone number found' }],
  photos: [], logo: { url: 'https://northline.example.com/og.png', colors: [] }, email: 'hello@northline.example.com',
  claims: [], items: [], facts: {}, allowedText: '',
} as unknown as import('../src/studio/concepts/review.js').Catalog;
const brief = {
  businessKey: 'site-northline.example.com', revision: 1, identity: { status: 'website-only' },
  brand: { colors: [{ role: 'primary', hex: '#000018' }, { role: 'accent', hex: '#005BEA' }], fonts: [{ family: 'Outfit' }, { family: 'Manrope' }, { family: 'JetBrains Mono' }], logo: { value: { url: 'https://northline.example.com/og.png', width: 1200, height: 630 }, status: 'needs_review' } },
} as unknown as import('../src/studio/schema.js').BusinessBrief;

const good = (): Spec => ({
  thesis: 'A quiet, engineered page: one strong sentence, then the work laid out like a ledger.',
  palette: { ground: 'white', surface: 'tint:#005BEA:6', ink: '#000018', inverse: '#000018', accent: '#005BEA', onAccent: 'white' },
  type: { heading: 'Outfit', body: 'Manrope', mono: 'JetBrains Mono', base: 17, scale: 1.333, headingWeight: 500, headingCase: 'none', tracking: -0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 28, margin: 48 },
  shape: { radius: 4, rule: 'hairline' },
  header: { style: 'split', links: ['work', 'about'], action: 'cta-primary', sticky: true },
  hero: { composition: 'Headline across seven columns, the services as an index on the right.', background: 'ground', minHeight: 72, verticalAlign: 'end', align: 'start', textStart: 1, textSpan: 7, headlineSize: 4.6, kicker: { label: 'Systems consultancy' }, headline: { ownLine: 0 }, lede: { ownLine: 3 }, actions: ['cta-primary', 'email'], aside: { kind: 'service-index', start: 9, span: 4, items: [{ service: 'svc-int', field: 'name' }, { service: 'svc-mig', field: 'name' }], photoId: null } },
  sections: [
    { id: 'work', purpose: 'what the firm does', kind: 'services', heading: { label: 'What I do' }, intro: null, layout: { arrangement: 'side-by-side', headingStart: 1, headingSpan: 4, contentStart: 6, contentSpan: 7, itemColumns: 1, itemStyle: 'numbered', density: 'airy' }, background: 'surface', items: [{ title: { service: 'svc-int', field: 'name' }, body: { service: 'svc-int', field: 'description' } }, { title: { service: 'svc-mig', field: 'name' }, body: { service: 'svc-mig', field: 'description' } }], actions: [] },
    { id: 'about', purpose: 'who does the work', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout: { arrangement: 'stack', headingStart: 3, headingSpan: 8, contentStart: 3, contentSpan: 8, itemColumns: 1, itemStyle: 'large-type', density: 'regular' }, background: 'inverse', items: [{ title: { ownLine: 3 }, body: null }], actions: [] },
    { id: 'contact', purpose: 'one clear next step', kind: 'contact', heading: { ownLine: 4 }, intro: null, layout: { arrangement: 'stack', headingStart: 1, headingSpan: 12, contentStart: 1, contentSpan: 12, itemColumns: 1, itemStyle: 'plain', density: 'regular' }, background: 'ground', items: [], actions: ['cta-primary', 'email'] },
  ],
  imagery: { approach: 'No photos are verified: type, rules and space carry the page.', roles: [] },
  mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: 'cta-primary', headingScale: 0.62, itemColumns: 1 },
});
function fakeTransport(answers: unknown[]): AiTransport & { prompts: string[] } {
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', prompts: [] as string[], async call(req: { prompt: string }) { t.prompts.push(req.prompt); return { data: answers[Math.min(t.prompts.length - 1, answers.length - 1)], usage: { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 6000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.05, costBasis: 'computed' as const } }; } };
  return t;
}

test('a well-grounded spec passes', () => {
  assert.deepEqual(D.validateSpec(good(), cat, brief), []);
});

test('evidence: unsupported actions, invented claims, missing references, off-brand colours and fonts, unverified photos are refused', () => {
  const errs = (mut: (s: Spec) => void) => { const s = good(); mut(s); return D.validateSpec(s, cat, brief).join(' | '); };
  assert.match(errs((s) => { s.hero.actions = ['call']; }), /action "call" is not supported/);
  assert.match(errs((s) => { s.mobile.stickyAction = 'book'; }), /mobile.stickyAction: action "book" is not supported/);
  assert.match(errs((s) => { s.hero.kicker = { label: 'Trusted by 200 clients' }; }), /may not contain numbers/);
  assert.match(errs((s) => { s.hero.kicker = { label: 'Award winning experts' }; }), /may not make a claim/);
  assert.match(errs((s) => { s.hero.headline = { ownLine: 99 }; }), /points at nothing/);
  assert.match(errs((s) => { s.sections[0].items[0].title = { service: 'svc-ai', field: 'name' }; }), /points at nothing/);
  assert.match(errs((s) => { s.palette.accent = '#FF3366'; }), /not a brand colour/);
  assert.match(errs((s) => { s.palette.ink = 'mist'; }), /ink on ground has contrast/);
  assert.match(errs((s) => { s.type.heading = 'Playfair Display'; }), /not one of the brand's fonts/);
  assert.match(errs((s) => { s.hero.aside = { kind: 'image', start: 9, span: 4, items: [], photoId: 'img_stock' }; }), /not one of the business's verified photos/);
  assert.match(errs((s) => { s.hero.aside.start = 6; }), /overlap/);
  assert.match(errs((s) => { s.sections[0].layout.contentSpan = 9; }), /do not fit the 12-column grid/);
  assert.match(errs((s) => { s.header.links = ['pricing']; }), /not a section id/);
});

test('one repair pass at most: a rejected spec is sent back once; two failures fall back to the directions', async () => {
  const bad = (() => { const s = good(); s.hero.actions = ['call']; return s; })();
  const fixed = await D.generateDesignSpec(cat, brief, null, { transport: fakeTransport([bad, good()]), fallback: () => 'Showcase' });
  assert.equal(fixed.source, 'ai');
  assert.equal(fixed.attempts, 2);
  assert.match(fixed.rejected[0].errors.join(' '), /"call" is not supported/);
  assert.equal(fixed.strategy, 'none saved');
  // (another business summary, so the answer cache, keyed by the prompt, does not replay the first run)
  const t = fakeTransport([bad, bad, good()]);
  const failed = await D.generateDesignSpec({ ...cat, business: { ...cat.business, summary: 'A systems consultancy in a second test.' } }, brief, null, { transport: t, fallback: () => 'Showcase' });
  assert.equal(t.prompts.length, 2, 'never a third attempt');
  assert.equal(failed.source, 'fallback');
  assert.equal(failed.spec, null);
  assert.deepEqual(failed.fallback?.direction, 'Showcase');
  // the prompt offers the business's words and actions, says what is unsupported, and asks for a composition, not a pick
  assert.match(t.prompts[0], /ownLines: \["0: Systems that talk to each other\./);
  assert.match(t.prompts[0], /Not supported, never suggest: phone number and every call button/);
  assert.match(t.prompts[0], /none — design a type-led site/);
  assert.ok(!/Showcase|Storyteller|Reputation|front page|Plan your visit/.test(t.prompts[0]), 'the five directions are not offered');
});

test('rendering: every word comes from the brief through the spec; positions and colours come from the spec', () => {
  const s = good();
  const html = renderSpec(s, cat, brief);
  const visible = html.replace(/<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/g, '').replace(/<[^>]+>/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  const allowed = new Set([...cat.ownLines, ...cat.services.flatMap((x) => [x.name, x.description!]), cat.story!.heading, cat.story!.text, ...cat.actions.map((a) => a.label), cat.email!, 'Northline Systems', 'Menu', '01', '02', 'Systems consultancy', 'What I do', 'About', 'Services', 'Capabilities', 'Work', 'Approach', 'Contact', 'Skip to content']); // + the renderer's fixed, non-factual nav names and skip link
  for (const v of visible) assert.ok(allowed.has(v), `"${v}" is not from the brief or the spec's labels`);
  assert.ok(!html.includes('tel:'), 'no call link without a phone');
  assert.match(html, /class="wordmark">Northline Systems</, 'the unverified logo image is replaced by a wordmark');
  assert.ok(!html.includes('og.png'));
  assert.match(html, /class="hero-text" style="grid-column:1 \/ span 7"/);
  assert.match(html, /aside-service-index" style="grid-column:9 \/ span 4"/);
  assert.match(html, /class="sec-body" style="grid-column:6 \/ span 7"/);
  assert.match(html, /--accent:#005BEA/);
  assert.match(html, /background:#000018;color:#FFFFFF/, 'the inverse section gets readable white text');
  assert.match(html, /class="sticky-bar"><a class="btn btn-primary" href="https:\/\/northline.example.com\/contact" data-action="cta-primary">Discuss your project/);
  // nav links name the section, never a cut-off heading; a primary button on the accent band inverts so it stays visible
  assert.match(html, /<a href="#work">Services<\/a><a href="#about">About<\/a>/);
  assert.ok(!/…/.test(html));
  const onAccent = good();
  onAccent.sections[2].background = 'accent';
  assert.match(renderSpec(onAccent, cat, brief), /\.on-accent \.btn-primary\{background:var\(--on-accent\);color:var\(--accent\)/);
  assert.match(renderSpec(onAccent, cat, brief), /class="sec density-regular stack on-accent"/);
  // a different spec is a different page, not a renamed one
  const other = good();
  other.hero = { ...other.hero, textStart: 3, textSpan: 8, align: 'center', aside: { kind: 'none', start: 1, span: 0, items: [], photoId: null } };
  other.sections[0].layout = { ...other.sections[0].layout, arrangement: 'stack', headingStart: 1, headingSpan: 12, contentStart: 1, contentSpan: 12, itemColumns: 2, itemStyle: 'card' };
  const html2 = renderSpec(other, cat, brief);
  assert.match(html2, /class="hero-text" style="grid-column:3 \/ span 8"/);
  assert.match(html2, /items style-card" style="--cols:2"/);
  assert.ok(!html2.includes('aside-service-index'));
});

test('the rendered page fits a 390px phone without sideways scrolling', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const r = await renderDesignFiles('test-northline', renderSpec(good(), cat, brief));
  assert.deepEqual(r.overflow, { desktop: false, mobile: false });
  assert.ok(fs.statSync(r.desktop).size > 10_000 && fs.statSync(r.mobile).size > 10_000);
});

// ── shared content rules ──
const { completeExcerpt } = await import('../src/util/text.js');

test('a visible place label must match a verified location fact; research-only places are refused and omitted', () => {
  // the research summary mentions a city, but the brief has no verified location
  const researchOnly = { ...cat, business: { ...cat.business, summary: 'A consultancy in Charleston, SC.' }, address: null, locations: [], area: null } as typeof cat;
  assert.match(D.locationProblem('Charleston, SC', researchOnly)!, /no verified location/);
  assert.match(D.locationProblem('Charleston', researchOnly)!, /Charleston/, 'a city the summary names is a place even without its state');
  assert.match(D.locationProblem('Proudly South Carolina', researchOnly)!, /South Carolina/);
  assert.equal(D.locationProblem('Systems consultancy', researchOnly), undefined, 'no place, no problem');
  const s = good(); s.hero.kicker = { label: 'Charleston, SC' };
  assert.match(D.validateSpec(s, researchOnly, brief).join(' | '), /hero.kicker: the label "Charleston, SC" names .* no verified location.*omit it/);
  // the renderer omits it rather than show it
  const html = renderSpec(s, researchOnly, brief);
  assert.ok(!html.includes('Charleston'));
  assert.ok(!html.includes('class="kicker"'));
  // a verified address allows its own city and state (code or name), and nothing else
  const verified = { ...researchOnly, address: { id: 'loc-1', formatted: '1905 South 1st Street, Austin, TX 78704' } } as typeof cat;
  assert.equal(D.locationProblem('Austin, TX', verified), undefined);
  assert.equal(D.locationProblem('South Austin, Texas', verified), undefined);
  assert.match(D.locationProblem('Round Rock, TX', verified)!, /not a verified location/);
});

test('descriptions are never cut mid-word: whole sentences only, or the whole phrase', () => {
  // a source cut at 240 characters loses its unfinished sentence ("…SQL-based pro")
  const cut = 'Connect Business Central with ecommerce and marketplaces such as Amazon, Shopify, and TikTok, EDI trading partners, payments, warehouses, portals, and custom applications. Standard connectors where they fit; .NET middleware, SQL-based pro';
  assert.equal(completeExcerpt(cut), 'Connect Business Central with ecommerce and marketplaces such as Amazon, Shopify, and TikTok, EDI trading partners, payments, warehouses, portals, and custom applications.');
  // ".NET" and "2.5" are not sentence ends
  assert.equal(completeExcerpt('Standard connectors; .NET middleware and 2.5 hour turnarounds. More text that was cut mid wor' + 'x'.repeat(150)), 'Standard connectors; .NET middleware and 2.5 hour turnarounds.');
  // a short phrase without a full stop is complete, not cut
  assert.equal(completeExcerpt('Chocolate cake with buttercream'), 'Chocolate cake with buttercream');
  // a long text with no complete sentence has nothing safe to show
  assert.equal(completeExcerpt('word '.repeat(60).trim()), undefined);
  // a limit keeps whole sentences (the first one whole even when longer than the limit)
  assert.equal(completeExcerpt('One sentence here. Two sentence here. Three.', 30), 'One sentence here.');
  assert.equal(completeExcerpt('A very long first sentence that alone is longer than the limit given. Second.', 20), 'A very long first sentence that alone is longer than the limit given.');
  for (const out of [completeExcerpt(cut), completeExcerpt('Standard connectors; .NET middleware. Cut mi' + 'x'.repeat(200))]) assert.match(out!, /[.!?]$/);
});

test('photos render eagerly (a full-page preview shows every one) and a photo band has a capped height', () => {
  const withPhotos = { ...cat, photos: [{ id: 'p1', url: 'https://northline.example.com/a.jpg', width: 800, height: 800, orientation: 'square', uses: [], alt: '', services: [], seen: 'Server rack' }] } as unknown as typeof cat;
  const s = good();
  s.sections[0].media = { placement: 'band', photoIds: ['p1'] };
  const html = renderSpec(s, withPhotos, brief);
  assert.match(html, /<div class="band" data-n="1"><img class="" src="https:\/\/northline.example.com\/a.jpg" data-asset="p1" alt="Server rack"/);
  assert.ok(!html.includes('loading="lazy"'));
  assert.match(html, /\.band img\{width:100%;height:clamp\(220px,26vw,380px\)/);
  s.sections[0].media = { placement: 'mosaic', photoIds: ['stock'] };
  assert.match(D.validateSpec(s, withPhotos, brief).join(' | '), /media: photo "stock" is not one of the business's verified photos/);
});
