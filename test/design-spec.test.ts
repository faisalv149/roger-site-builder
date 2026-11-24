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

const { cat, brief, good, goodDirection, answer } = await import('./helpers/northline-spec.js');
/** a fixture spec as Claude answers it (no columns, services left to Roger); anything else as it is */
const asAnswer = (x: unknown) => (x && typeof x === 'object' && 'hero' in x && (x as Spec).hero.textStart !== undefined ? answer(x as Spec) : x);
/** `answers` are the DesignSpec answers in order (`prompts` their prompts); the design direction is answered soundly first */
function fakeTransport(answers: unknown[], direction: unknown = goodDirection()): AiTransport & { prompts: string[]; directionPrompts: string[] } {
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', prompts: [] as string[], directionPrompts: [] as string[], async call(req: { stage: string; prompt: string }) { if (req.stage === 'design:direction') { t.directionPrompts.push(req.prompt); return { data: direction, usage: { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 3000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.014, costBasis: 'computed' as const } }; } t.prompts.push(req.prompt); return { data: asAnswer(answers[Math.min(t.prompts.length - 1, answers.length - 1)]), usage: { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 6000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.05, costBasis: 'computed' as const } }; } };
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
  assert.match(renderSpec(onAccent, cat, brief), /class="sec density-regular stack sparse on-accent"/);
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

// ───────────────────────── geometry from the renderer, offerings from the catalog ─────────────────────────
test('Claude chooses positions, never column numbers: every combination fits the grid and never overlaps', async () => {
  const G = await import('../src/studio/concepts/geometry.js');
  for (const side of ['left', 'right', 'centre'] as const) for (const width of ['narrow', 'mid', 'wide'] as const) for (const aside of ['none', 'image', 'service-index']) {
    const c = G.heroColumns(side, width, aside);
    assert.ok(c.textStart >= 1 && c.textStart + c.textSpan - 1 <= 12, `${side}/${width}/${aside}: text fits`);
    if (aside !== 'none') {
      assert.ok(c.asideStart >= 1 && c.asideStart + c.asideSpan - 1 <= 12 && c.asideSpan >= 4, `${side}/${width}/${aside}: aside fits`);
      const [a0, a1, b0, b1] = [c.textStart, c.textStart + c.textSpan - 1, c.asideStart, c.asideStart + c.asideSpan - 1];
      assert.ok(a1 < b0 || b1 < a0, `${side}/${width}/${aside}: no overlap`);
    }
    // and the existing column checks pass on whatever the renderer derives
    const s = answer(good()); s.hero.textSide = side; s.hero.textWidth = width; s.hero.aside = { ...s.hero.aside, kind: aside as never, items: aside === 'service-index' ? s.hero.aside.items : [], photoId: null };
    assert.doesNotMatch(D.validateSpec(D.assembleSpec(s, cat), cat, brief).join(' | '), /columns|overlap/, `${side}/${width}/${aside}`);
  }
  for (const arr of ['stack', 'side-by-side'] as const) { const c = G.sectionColumns(arr); assert.ok(arr === 'stack' || c.headingStart + c.headingSpan - 1 < c.contentStart, arr); }
  // the contract asks for the choices, not the numbers
  assert.ok(D.SPEC_CONTRACT.includes('"textSide": "left"|"right"|"centre"') && D.SPEC_CONTRACT.includes('"textWidth": "narrow"|"mid"|"wide"'));
  assert.doesNotMatch(D.SPEC_CONTRACT, /textStart|textSpan|headingStart|contentSpan|"start": int|"span": int/);
  // a text on the right with an image on the left stays on one row (the renderer packs the hero grid densely)
  const right = answer(good()); right.hero.textSide = 'right';
  const html = (await import('../src/studio/concepts/spec-render.js')).renderSpec(D.assembleSpec(right, cat), cat, brief);
  assert.match(html, /\.hero-grid\{[^}]*grid-auto-flow:row dense/);
});

test('a services section lists every verified service, from the catalog, whatever the answer put in it', () => {
  const withPics = { ...(cat as object), photos: [{ id: 'p1', url: 'https://x/p1.jpg', width: 1200, height: 800, orientation: 'landscape', uses: [], alt: '', services: [] }], services: [{ ...cat.services[0], imageId: 'p1' }, { ...cat.services[1], imageId: 'stock-9' }] } as unknown as typeof cat;
  const a = answer(good());
  a.sections[0].items = [{ title: { label: 'Our offer' }, body: null, photoId: null }]; // Claude's own list is not used
  const s = D.assembleSpec(a, withPics);
  assert.deepEqual(s.sections[0].items, [
    { title: { service: 'svc-int', field: 'name' }, body: { service: 'svc-int', field: 'description' }, photoId: 'p1' },
    { title: { service: 'svc-mig', field: 'name' }, body: { service: 'svc-mig', field: 'description' }, photoId: null },
  ], 'every service, in the catalog\'s order; only a verified picture');
  assert.doesNotMatch(D.validateSpec(s, withPics, brief).join(' | '), /services section must list/);
  assert.ok(D.specRequest(cat, brief, null).prompt.includes('Roger fills its items from the verified list, so give it "items": []'));
});

// ───────────────────────── layout from what renders; readable item text ─────────────────────────
test('a side-by-side section is stacked when its second column would hold too little; kept when it has real content', async () => {
  const { renderSpec, arrangedFor, SUBSTANTIAL_ITEM_CHARS } = await import('../src/studio/concepts/spec-render.js');
  const planned = D.assembleSpec(answer(good()), cat);
  const sec = (mut: (x: Spec['sections'][number]) => void) => { const x = structuredClone(planned.sections[0]); x.layout.arrangement = 'side-by-side'; Object.assign(x.layout, { headingStart: 1, headingSpan: 4, contentStart: 6, contentSpan: 7 }); mut(x); return x; };
  // two items: side by side, as planned
  assert.equal(arrangedFor(sec(() => {}), cat).arrangement, 'side-by-side');
  // buttons alone: stacked, with the stacked columns
  assert.deepEqual(arrangedFor(sec((x) => { x.items = []; x.actions = ['cta-primary']; }), cat), { ...planned.sections[0].layout, arrangement: 'stack', headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12 });
  // one short item: stacked; one item whose description fills a column: side by side
  assert.equal(arrangedFor(sec((x) => { x.items = [{ title: { label: 'Integration' }, body: null, photoId: null }]; }), cat).arrangement, 'stack');
  const long = { ...(cat as object), services: [{ id: 'svc-int', name: 'Integration', description: 'x'.repeat(SUBSTANTIAL_ITEM_CHARS) }] } as unknown as typeof cat;
  assert.equal(arrangedFor(sec((x) => { x.items = [{ title: { service: 'svc-int', field: 'name' }, body: { service: 'svc-int', field: 'description' }, photoId: null }]; }), long).arrangement, 'side-by-side');
  // a photo mosaic counts only with a verified photo
  const pics = { ...(cat as object), photos: [{ id: 'p1', url: 'https://x/p1.jpg', width: 1200, height: 800, orientation: 'landscape', uses: [], alt: '', services: [] }] } as unknown as typeof cat;
  assert.equal(arrangedFor(sec((x) => { x.items = []; x.media = { placement: 'mosaic', photoIds: ['p1'] }; }), pics).arrangement, 'side-by-side');
  assert.equal(arrangedFor(sec((x) => { x.items = []; x.media = { placement: 'mosaic', photoIds: ['stock-1'] }; }), pics).arrangement, 'stack');
  // in the page: the stacked section says it was planned side by side; the saved spec is not changed
  const s = structuredClone(planned); s.sections[2].layout = { ...s.sections[2].layout, arrangement: 'side-by-side', headingStart: 1, headingSpan: 4, contentStart: 6, contentSpan: 7 };
  const html = renderSpec(s, cat, brief);
  assert.match(html, /<section id="contact"[^>]*data-planned="side-by-side" class="sec [^"]*\bstack\b/);
  assert.match(html, /<section id="work"[^>]*class="sec [^"]*\bside-by-side\b/);
  assert.equal(s.sections[2].layout.arrangement, 'side-by-side');
});

test('menu and item text has a readable minimum in any face; larger sizes are kept', async () => {
  const { renderSpec, ITEM_TITLE_MIN_PX, ITEM_TEXT_MIN_PX } = await import('../src/studio/concepts/spec-render.js');
  assert.deepEqual([ITEM_TITLE_MIN_PX, ITEM_TEXT_MIN_PX], [20, 16]);
  const at = (base: number, scale: number, heading = 'Outfit') => { const s = good(); s.type = { ...s.type, heading, base, scale }; return renderSpec(s, cat, brief); };
  const small = at(15, 1.1);
  assert.match(small, /h3\{font-size:20px;/, 'an item name: 16.5px by the scale, held at 20px');
  assert.match(small, /\.text-items h3\{font-size:20px\}/, 'a name in a text list: 15.7px, held at 20px');
  assert.match(small, /\.item p\{[^}]*font-size:16px\}/, 'the line under it: 15px, held at 16px');
  const roomy = at(17, 1.5);
  assert.match(roomy, /h3\{font-size:25\.5px;/, 'a larger size is kept');
  assert.match(roomy, /\.text-items h3\{font-size:20\.82px\}/);
  assert.match(roomy, /\.item p\{[^}]*font-size:17px\}/);
});

test('photos beside a heading in a stacked section are capped on desktop; phones are unchanged', async () => {
  const { renderSpec, STACKED_PHOTO_MAX_PX } = await import('../src/studio/concepts/spec-render.js');
  assert.equal(STACKED_PHOTO_MAX_PX, 520);
  const html = renderSpec(D.assembleSpec(answer(good()), cat), cat, brief);
  assert.match(html, /@media \(min-width:761px\)\{\.sec\.stack \.beside\{max-width:520px\}\.sec\.stack \.beside img\{aspect-ratio:4\/3\}\}/);
  assert.doesNotMatch(html, /\.sec\.side-by-side \.beside\{max-width/, 'side-by-side photos keep their column');
  // the desktop rule must sit outside the phone block (inside it, min-width:761px could never match)
  assert.ok(html.indexOf('.sec.stack .beside{max-width') < html.indexOf('@media (max-width:760px){'), 'the cap is not nested in the phone media query');
});
