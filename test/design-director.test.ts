// The design director: before a DesignSpec, the planner states the audience, the page's main job and a visual idea
// grounded in the brand and real content; critiques it for generic AI-design defaults; revises once. The guidance may
// never add content (services, claims, prices, actions, photos) and keeps the brand. Claude is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-director-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const R = await import('../src/studio/concepts/director.js');
const D = await import('../src/studio/concepts/designspec.js');
const { cat, brief, good, goodDirection, answer } = await import('./helpers/northline-spec.js');
const asAnswer = (x: unknown) => (x && typeof x === 'object' && 'hero' in x && (x as import('../src/studio/concepts/designspec.js').DesignSpec).hero.textStart !== undefined ? answer(x as never) : x);
/** what the planner makes of a fixture spec: Claude's answer, assembled with the renderer's columns and the services */
const assembled = (s: import('../src/studio/concepts/designspec.js').DesignSpec) => D.assembleSpec(answer(s), cat);
type Direction = import('../src/studio/concepts/director.js').Direction;
type AiTransport = import('../src/studio/concepts/ai.js').AiTransport;

const errs = (mut: (d: Direction) => void) => { const d = goodDirection(); mut(d); return R.validateDirection(d, cat, brief).join(' | '); };
const usage = { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 3000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, costBasis: 'computed' as const };
/** accepted answers are cached by request: each scenario starts without them */
const fresh = () => fs.rmSync(path.join(tmp, 'data', 'studio-ai'), { recursive: true, force: true });
function fake(direction: unknown, spec: unknown = good()): AiTransport & { stages: string[] } {
  fresh();
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', stages: [] as string[], async call(req: { stage: string }) { t.stages.push(req.stage); return { data: req.stage === 'design:direction' ? direction : asAnswer(spec), usage }; } };
  return t;
}

test('a grounded direction passes; one that adds content, leaves the brand or points at nothing is refused', () => {
  assert.deepEqual(R.validateDirection(goodDirection(), cat, brief), []);
  assert.match(errs((d) => { d.idea.summary = 'A pricing band: projects from $2,500.'; }), /idea\.summary: "\$2,500" states a price/);
  assert.match(errs((d) => { d.revised!.hero.note = 'An award-winning hero.'; }), /revised\.hero\.note: "award-winning" states a price, figure or claim/);
  assert.match(errs((d) => { d.audience = 'Firms that want 30% faster integrations.'; }), /audience: "30%" states/);
  assert.match(errs((d) => { d.mainJob.action = 'call'; }), /mainJob\.action: "call" is not a supported action/);
  assert.match(errs((d) => { d.characteristic.evidence = [{ kind: 'service', id: 'svc-cloud' }]; }), /evidence\[0\]: service "svc-cloud" is not in the brief/);
  assert.match(errs((d) => { d.characteristic.evidence = [{ kind: 'photo', id: 'stock-1' }]; }), /evidence\[0\]: photo "stock-1" is not in the brief/);
  assert.match(errs((d) => { d.characteristic.evidence = [{ kind: 'ownLine', id: '9' }]; }), /ownLine "9" is not in the brief/);
  assert.match(errs((d) => { d.revised!.palette.accent = '#D97757'; }), /revised\.palette\.accent: "#D97757" is not a brand colour/);
  assert.match(errs((d) => { d.idea.palette = { ground: 'paper', surface: 'mist', ink: 'ink', accent: 'slate' }; }), /idea\.palette: the brand colours are not used/);
  assert.match(errs((d) => { d.idea.type.heading = 'Playfair Display'; }), /idea\.type\.heading: "Playfair Display" is not one of the brand's fonts/);
  // a seasonal promotion is guidance here (the preview leaves an undated one out), not a refusal
  assert.equal(errs((d) => { d.mainJob.text = 'Get orders in, from Thanksgiving pies to custom cakes.'; }), '');
  assert.match(R.directionRequest(cat, brief, null, null).prompt, /date or season but no year .* is left out of the preview until the owner confirms it/);
});

test('the director plans only with what the renderer can build; anything else is revised before a spec is asked for', () => {
  // the capabilities come from the DesignSpec schema itself, so they follow the renderer
  const caps = R.capabilities();
  for (const k of ['service-index | statement | line-list | contact-card | image', 'plain | ruled | numbered | card | large-type', 'none | beside | mosaic | band', 'Not available: overlapping or layered elements, tilted or rotated items']) assert.ok(caps.includes(k), k);
  assert.ok(R.directionRequest(cat, brief, null, null).system.includes(caps), 'the capabilities sit with the guide');
  // the plan's layout is exact options; prose naming a treatment it cannot build is refused
  const s = R.directionSchema(['Outfit'], ['cta-primary']) as unknown as { properties: { idea: { properties: { hero: { properties: Record<string, { enum?: string[] }> }; sections: { items: { properties: Record<string, { enum?: string[] }> } } } } } };
  assert.deepEqual(s.properties.idea.properties.hero.properties.aside.enum, ['none', 'service-index', 'statement', 'line-list', 'contact-card', 'image']);
  assert.deepEqual(s.properties.idea.properties.sections.items.properties.media.enum, ['none', 'beside', 'mosaic', 'band']);
  assert.match(errs((d) => { d.revised!.hero.note = 'The photo tilted over the headline.'; }), /revised\.hero\.note: "tilted" is not something the renderer can build; revise it/);
  assert.match(errs((d) => { d.revised!.type.treatment = 'Names overlapping the photos like stickers.'; }), /revised\.type\.treatment: "overlapping" is not something the renderer can build/);
  assert.match(errs((d) => { d.revised!.sections[0].content = 'a collage of the services'; }), /sections\[0\]\.content: "collage" is not something/);
  // photos only where the business has verified photos (this one has none)
  assert.match(errs((d) => { d.revised!.hero.aside = 'image'; }), /revised: the plan places photos, but the business has no verified photos/);
});

test('every field\'s limit is stated beside it, and the prose is short', () => {
  const p = R.directionRequest(cat, brief, null, null).prompt;
  for (const f of ['"audience": string ≤160', '"text": string ≤120', '"summary": string ≤160', '"treatment": string ≤120', '"note": string ≤120', '"boldElement": string ≤120', '"why": string ≤160', '"changes": string ≤200 | null']) assert.ok(p.includes(f), f);
  assert.ok(!/"rhythm"/.test(p), 'the long rhythm prose is now a section plan');
});

test('fonts and the main action are exact choices from the brief, so a font is named and never described', () => {
  const s = R.directionSchema(['Teko', 'Quicksand'], ['order', 'call']) as unknown as { properties: { idea: { properties: { type: { properties: Record<string, { enum?: string[] }> } } }; mainJob: { properties: { action: { anyOf: { enum?: string[] }[] } } } } };
  assert.deepEqual(s.properties.idea.properties.type.properties.heading.enum, ['Teko', 'Quicksand']);
  assert.deepEqual(s.properties.idea.properties.type.properties.body.enum, ['Teko', 'Quicksand']);
  assert.ok('treatment' in s.properties.idea.properties.type.properties, 'size, case and spacing have their own field');
  assert.deepEqual(s.properties.mainJob.properties.action.anyOf[0].enum, ['order', 'call']);
  // a brand with no fonts or actions: any font name, and no action
  const none = R.directionSchema([], []) as unknown as { properties: { mainJob: { properties: { action: { type: string } } } } };
  assert.equal(none.properties.mainJob.properties.action.type, 'null');
});

test('the critique decides the revision: a default marked "revise" is revised once and explained; one kept needs its reason', () => {
  assert.match(errs((d) => { d.revised = null; }), /critique: 1 default\(s\) marked "revise" \(numbered markers on content that is not a sequence\) but "revised" is null/);
  assert.match(errs((d) => { d.changes = null; }), /changes: say what the revision changed/);
  assert.match(errs((d) => { d.critique = []; }), /revised: no default is marked "revise", so there is nothing to revise/);
  assert.deepEqual(errs((d) => { d.critique = []; d.revised = null; d.changes = null; }), '');
  // a default the brand justifies may be kept, with its reason, and then nothing is revised
  const kept = { trait: 'alternating tinted bands', where: 'the section rhythm', verdict: 'keep' as const, why: 'the teal band is the brand\'s own structural colour' };
  assert.deepEqual(errs((d) => { d.critique = [kept]; d.revised = null; d.changes = null; }), '');
  assert.match(errs((d) => { d.critique = [{ ...kept, why: ' ' }]; d.revised = null; d.changes = null; }), /critique\[0\]: a default kept needs its reason/);
  assert.match(errs((d) => { d.critique = [kept]; }), /no default is marked "revise"/);
  assert.equal(R.finalIdea(goodDirection()).summary, goodDirection().revised!.summary, 'the revision is what the spec follows');
});

test('the guide is short, versioned, attributed, and holds no themes or category layouts', () => {
  assert.equal(R.DIRECTOR_VERSION, 'director-1');
  assert.ok(R.DIRECTOR_GUIDE.length < 5000, `${R.DIRECTOR_GUIDE.length} characters`);
  for (const step of ['Audience', 'Main job', 'most characteristic thing', 'Critique the idea', 'revise that part once', 'Design guidance never adds content', 'Keep the verified logo and the brand colours']) assert.ok(R.DIRECTOR_GUIDE.includes(step), step);
  assert.doesNotMatch(R.DIRECTOR_GUIDE, /\b(bakery|bakeries|cafe|restaurant|plumb\w*|roof\w*|salon|dentist|lawyer|hvac|landscap\w*|consult\w*)\b/i, 'no business categories');
  assert.doesNotMatch(R.DIRECTOR_GUIDE, /\btheme\b(?!s, presets)/i);
  const src = fs.readFileSync(path.join(import.meta.dirname, '../src/studio/concepts/director.ts'), 'utf8');
  assert.match(src, /Adapted from the "frontend-design" skill by Anthropic[\s\S]*Apache License 2\.0[\s\S]*Modified by Roger/);
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '../licenses/anthropic-skills-frontend-design.LICENSE.txt'), 'utf8'), /Apache License\s+Version 2\.0/);
});

test('the direction request carries the guide once; the spec request carries only the final idea', () => {
  const req = R.directionRequest(cat, brief, null, null);
  assert.equal(req.stage, 'design:direction');
  assert.ok(req.system.startsWith(R.DIRECTOR_GUIDE));
  assert.match(req.prompt, /Supported actions \(cite by id; the only ones allowed\): \[\{"id":"cta-primary"/);
  assert.match(req.prompt, /Brand \(keep\): colours #000018, #005BEA; fonts Outfit, Manrope, JetBrains Mono/);
  const spec = D.specRequest(cat, brief, null, [], goodDirection());
  assert.ok(!spec.prompt.includes(R.DIRECTOR_GUIDE.slice(0, 80)), 'the guide is not pasted into the spec request');
  assert.match(spec.prompt, /Design direction \(director-1; decided before this spec — follow it; it adds no content/);
  assert.ok(spec.prompt.includes('An engineered index') && !spec.prompt.includes('numbered rows.'), 'the revised idea, not the first one');
  assert.ok(spec.prompt.endsWith(D.SPEC_CONTRACT), 'the contract still closes the request');
});

test('the planner states the direction first; an invalid one stops the design before any spec is asked for', async () => {
  const ok = fake(goodDirection());
  const r = await D.generateDesignSpec(cat, brief, null, { transport: ok, fallback: () => 'none' });
  assert.equal(r.source, 'ai', r.fallback?.reason ?? '');
  assert.deepEqual(ok.stages, ['design:direction', 'design:spec']);
  assert.equal(r.direction?.version, 'director-1');
  assert.equal(r.direction?.data.changes, goodDirection().changes, 'the direction is saved with the design');

  const invented = goodDirection(); invented.characteristic.evidence = [{ kind: 'service', id: 'svc-ai' }];
  const bad = fake(invented);
  const r2 = await D.generateDesignSpec(cat, brief, null, { transport: bad, fallback: () => 'none' });
  assert.equal(r2.spec, null);
  assert.deepEqual(bad.stages, ['design:direction', 'design:direction'], 'one repair, then no spec request at all');
  assert.match(r2.fallback!.reason, /^no valid design direction after 2 attempt\(s\): characteristic\.evidence\[0\]: service "svc-ai" is not in the brief/);

  // QA comparison only: with the director off, the spec is composed without a direction
  process.env.STUDIO_DESIGN_DIRECTOR = '0';
  try {
    const off = fake(goodDirection());
    await D.generateDesignSpec(cat, brief, null, { transport: off, fallback: () => 'none' });
    assert.deepEqual(off.stages, ['design:spec']);
  } finally { delete process.env.STUDIO_DESIGN_DIRECTOR; }
});

// ───────────────────────── only the invalid fields are rewritten ─────────────────────────
/** a transport that answers the direction soundly, the spec from `specs` in turn, and each shorten request from `short` */
function lengths(specs: unknown[], short: (at: string, limit: number) => string) {
  fresh();
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', stages: [] as string[], async call(req: { stage: string; prompt: string; schema: Record<string, unknown> }) {
    t.stages.push(req.stage);
    if (req.stage === 'design:direction') return { data: goodDirection(), usage };
    if (req.stage.endsWith(':shorten')) {
      const asked = [...req.prompt.matchAll(/^(\$\S+) \(at most (\d+);/gm)].map((m) => [m[1], +m[2]] as const);
      return { data: { fields: asked.map(([at, limit]) => ({ at, text: short(at, limit) })) }, usage };
    }
    return { data: asAnswer(specs[Math.min(t.stages.filter((s) => s === 'design:spec').length - 1, specs.length - 1)]), usage };
  } };
  return t;
}

test('texts over their limits are rewritten field by field, never cut; the rest of the answer is kept as it was', async () => {
  const long = good();
  long.thesis = `${'A quiet, engineered page that lets the work speak, '.repeat(6)}end.`; // ~300 characters, invisible
  long.hero.kicker = { label: 'Systems consultancy for growing operations teams' }; // 48 characters, visible
  const t = lengths([long], (at) => (at === '$.thesis' ? 'A quiet, engineered page: one line, then the work.' : 'Systems consultancy'));
  const r = await D.generateDesignSpec(cat, brief, null, { transport: t, fallback: () => 'none' });
  assert.equal(r.source, 'ai', r.fallback?.reason ?? '');
  assert.deepEqual(t.stages, ['design:direction', 'design:spec', 'design:spec:shorten'], 'one small rewrite, no second full spec');
  assert.equal(r.spec!.thesis, 'A quiet, engineered page: one line, then the work.');
  assert.deepEqual(r.spec!.hero.kicker, { label: 'Systems consultancy' }, 'the visible label was rewritten, not truncated');
  assert.deepEqual({ ...r.spec!, thesis: '', hero: { ...r.spec!.hero, kicker: null } }, { ...assembled(good()), thesis: '', hero: { ...assembled(good()).hero, kicker: null } }, 'nothing else changed');
  assert.match(r.rejected[0].errors.join(' | '), /\$\.thesis: text is \d+ characters, over the limit of 240 \| .*2 field\(s\) rewritten within their limits: \$\.thesis, \$\.hero\.kicker\.label/);

  // a rewrite still over the limit is not used (nothing is cut): the normal repair asks again in full
  const t2 = lengths([long, good()], (_at, limit) => 'x'.repeat(limit + 5));
  const r2 = await D.generateDesignSpec(cat, brief, null, { transport: t2, fallback: () => 'none' });
  assert.deepEqual(t2.stages, ['design:direction', 'design:spec', 'design:spec:shorten', 'design:spec']);
  assert.equal(r2.attempts, 2);
  assert.deepEqual(r2.spec, assembled(good()));

  // a length problem mixed with any other problem is a full repair, as before
  const mixed = structuredClone(long); mixed.hero.actions = ['call'];
  const t3 = lengths([mixed, good()], () => 'short');
  await D.generateDesignSpec(cat, brief, null, { transport: t3, fallback: () => 'none' });
  assert.deepEqual(t3.stages, ['design:direction', 'design:spec', 'design:spec']);
});

// ───────────────────────── the preview: readable decorative type, no undated promotions ─────────────────────────
test('item titles in a decorative face are never set below the readable minimum; other faces have their own minimum', async () => {
  const { renderSpec, DECORATIVE_MIN_PX, decorativeFont } = await import('../src/studio/concepts/spec-render.js');
  assert.equal(DECORATIVE_MIN_PX, 26);
  assert.ok(decorativeFont('Just Another Hand') && decorativeFont('Dancing Script') && !decorativeFont('Teko') && !decorativeFont('Quicksand'));
  const small = (heading: string) => { const s = good(); s.type = { ...s.type, heading, base: 15, scale: 1.1 }; return renderSpec(s, cat, brief); };
  const hand = small('Just Another Hand');
  assert.match(hand, /h3\{font-size:26px;/);
  assert.match(hand, /\.text-items h3\{font-size:26px\}/);
  const plain = small('Outfit');
  assert.match(plain, /h3\{font-size:20px;/, 'a text face is held at the item minimum (20px), not 16.5px');
});

test('a promotion with a date but no year is left out of the preview, wherever it sits; with a year it stays', () => {
  const promo = { ...(cat as object), ownLines: [...cat.ownLines, 'Pre-order pies for 11/24 and 11/25', 'Pre-order pies for 11/24/2026'] } as typeof cat;
  const s = good();
  s.sections[0].intro = { ownLine: 5 };
  s.sections[1].items.push({ title: { ownLine: 6 }, body: null, photoId: null });
  const { spec, omitted } = D.handoffSpec(s, promo);
  assert.equal(spec.sections[0].intro, null, 'the undated pre-order is left out');
  assert.match(omitted.map((o) => o.what).join(' | '), /Pre-order pies for 11\/24 and 11\/25/);
  assert.ok(spec.sections[1].items.some((it) => 'ownLine' in it.title && it.title.ownLine === 6), 'the dated one stays');
});

test('"hand-drawn" is allowed for the look of a verified decorative font, and refused for anything to be drawn', () => {
  const brand = ['Teko', 'Quicksand', 'Just Another Hand'];
  assert.equal(R.unsupportedIn('A teal and cherry-red page lettered in hand-drawn type, like icing on a cake box', brand), undefined);
  assert.equal(R.unsupportedIn('Headings in Just Another Hand, hand-drawn and loose', brand), undefined);
  assert.equal(R.unsupportedIn('Hand-drawn illustrations of cupcakes around the menu', brand), 'Hand-drawn');
  assert.equal(R.unsupportedIn('hand-drawn icons beside each item', brand), 'hand-drawn');
  assert.equal(R.unsupportedIn('A hand drawn border around the hero', brand), 'hand drawn');
  // without a decorative brand font there is no font to describe: refused
  assert.equal(R.unsupportedIn('lettered in hand-drawn type', ['Teko', 'Quicksand']), 'hand-drawn');
  // other treatments are refused as before
  assert.equal(R.unsupportedIn('a photo tilted over the headline', brand), 'tilted');
});

test('a planner-only note over its limit is cut locally at a word boundary (no AI call, original kept), after every check', async () => {
  const { shortenAtWord } = await import('../src/studio/concepts/schema-compat.js');
  // the exact note that failed cj_6cac7df8577e: 122 characters against a limit of 120
  const NOTE = "Line 'Baking Up Cake & Community!' with 'From cupcakes to wedding cakes'; order button; tiered cupcake stand photo beside.";
  assert.equal(NOTE.length, 122);
  const cut = shortenAtWord(NOTE, 120);
  assert.equal(cut, "Line 'Baking Up Cake & Community!' with 'From cupcakes to wedding cakes'; order button; tiered cupcake stand photo…");
  assert.ok(cut.length <= 120 && NOTE.startsWith(cut.slice(0, -1)), 'a prefix of the original, cut between words');

  // in the planner: the direction is accepted on its first answer, with no rewrite call, and the original is kept
  const d = goodDirection(); d.revised!.hero.note = NOTE;
  const t = fake(d);
  const r = await D.generateDesignSpec(cat, brief, null, { transport: t, fallback: () => 'none' });
  assert.equal(r.source, 'ai', r.fallback?.reason ?? '');
  assert.deepEqual(t.stages, ['design:direction', 'design:spec'], 'no rewrite request: the note was cut locally');
  assert.equal(r.direction?.attempts, 1);
  assert.deepEqual(r.direction?.shortened, [{ at: '$.revised.hero.note', original: NOTE, shortened: cut }]);
  assert.equal(r.direction?.data.revised?.hero.note, cut);

  // checks read the original: a treatment the renderer cannot build in the part that would be cut is still refused
  const hidden = goodDirection(); hidden.revised!.hero.note = `${NOTE.slice(0, 104)} the photo tilted`;
  assert.ok(hidden.revised!.hero.note.length > 120 && hidden.revised!.hero.note.indexOf('tilted') > 110);
  const t2 = fake(hidden);
  const r2 = await D.generateDesignSpec(cat, brief, null, { transport: t2, fallback: () => 'none' });
  assert.equal(r2.spec, null);
  assert.match(r2.fallback!.reason, /revised\.hero\.note: "tilted" is not something the renderer can build/);
  assert.equal(r2.direction?.shortened, undefined, 'nothing was cut to hide it');

  // only planner notes: source ids, exact choices and visible labels are never cut
  assert.ok(R.isDirectionNote(['revised', 'hero', 'note']) && R.isDirectionNote(['idea', 'summary']));
  assert.ok(!R.isDirectionNote(['characteristic', 'evidence', 0, 'id']) && !R.isDirectionNote(['idea', 'type', 'heading']) && !R.isDirectionNote(['mainJob', 'action']));
  assert.ok(D.isSpecNote(['thesis']) && D.isSpecNote(['hero', 'composition']) && D.isSpecNote(['sections', 0, 'purpose']));
  assert.ok(!D.isSpecNote(['hero', 'kicker', 'label']) && !D.isSpecNote(['sections', 0, 'id']) && !D.isSpecNote(['hero', 'aside', 'photoId']));
});
