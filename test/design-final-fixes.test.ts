// Final fixes: the owner editor previews its draft at its own address (never through a public link pinned to a saved
// version); a Reviews band needs real reviews or the verified rating; alternate designs for a sparse Google-only
// business are judged by what it has, within a bounded number of attempts, with a plain report when it can't be done.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-final-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
delete process.env.ROGER_INTAKE_CONCEPTS;
const { config } = await import('../src/config.js');
const { forEditor } = await import('../src/drafts.js');
const { pinSiteLink, pinnedPath } = await import('../src/site-pins.js');
const { renderSpec } = await import('../src/studio/concepts/spec-render.js');
const D = await import('../src/studio/concepts/designspec.js');
const { pollIntake } = await import('../src/imessage/flow.js');
const { studioDocs, saveConversation, getConversation } = await import('../src/store.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Run = import('../src/imessage/intake.js').IntakeRun;
type AiTransport = import('../src/studio/concepts/ai.js').AiTransport;

test('the owner editor previews its draft at /drafts/<slug>/, which a pin on the public link never intercepts', async () => {
  await pinSiteLink('sugar-loaf', 'sugar-loaf-inx-v1', 'first sent unversioned', 'in_x-v1');
  const html = forEditor('<html><head><title>x</title></head><body><img src="assets/photo-1.webp"><img src="../assets/hero.webp"></body></html>', 'sugar-loaf', 'menu/');
  assert.match(html, /<base href="\/drafts\/sugar-loaf\/menu\/">/);
  assert.match(html, /src="\/drafts\/sugar-loaf\/assets\/photo-1\.webp"/);
  assert.match(html, /src="\/drafts\/sugar-loaf\/assets\/hero\.webp"/);
  assert.ok(!html.includes('/sites/'), 'nothing in the editor goes through the public (pinned) link');
  // the public link stays pinned to the version that was sent; the owner's address is not a /sites path at all
  assert.equal(await pinnedPath('/sugar-loaf/'), '/sugar-loaf-inx-v1/');
  const src = fs.readFileSync(path.resolve('src/server.ts'), 'utf8');
  assert.ok(src.indexOf("app.use('/drafts'") < src.indexOf("app.use('/sites', (req, _res, next) => { pinnedPath"), 'the owner mount is separate from (and ahead of) the pinned public mount');
  assert.match(fs.readFileSync(path.resolve('public/owner/owner.js'), 'utf8'), /location\.origin \+ '\/drafts\/' \+ S\.info\.draft\.slug/);
});

// ── a sparse Google-only business: a name, a category, a phone, an address, hours, a rating and two listing photos ──
const sparse = {
  business: { name: 'Corner Taqueria', category: 'Restaurant', website: null, summary: null },
  ownLines: [], services: [], story: null, items: [], claims: [], facts: {}, sectionImages: {}, omitted: [], allowedText: '4.6 212 (512) 555-0190',
  actions: [{ id: 'call', label: 'Call (512) 555-0190', href: 'tel:+15125550190', kind: 'call', factId: 'phone' }, { id: 'dir', label: 'Directions', href: 'https://maps.google.com/?q=x', kind: 'directions', factId: 'loc-1' }],
  photos: [{ id: 'g1', url: 'https://example.com/g1.jpg', width: 1600, height: 1067, orientation: 'landscape', uses: [], alt: '', services: [], seen: 'Tacos on a plate' }, { id: 'g2', url: 'https://example.com/g2.jpg', width: 1600, height: 1067, orientation: 'landscape', uses: [], alt: '', services: [], seen: 'Storefront' }],
  logo: null, email: null, phone: { display: '(512) 555-0190', href: 'tel:+15125550190' }, address: { id: 'loc-1', formatted: '12 Oak St, Austin, TX 78702' }, locations: [], area: null, hours: ['Mon–Sun: 9:00 AM – 9:00 PM'],
  rating: { value: 4.6, count: 212, href: null, scope: null }, forbidden: { phones: [], hrefs: [], prices: [] },
} as never;
const brief = { identity: { status: 'verified' }, brand: { colors: [], fonts: [], logo: { value: null, status: 'unknown' } } } as never;
const L = (o: object = {}) => ({ arrangement: 'stack' as const, headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 1, itemStyle: 'plain' as const, density: 'regular' as const, ...o });
const sparseV1 = (): Spec => ({
  thesis: 't', palette: { ground: 'white', surface: 'paper', ink: 'ink', inverse: 'ink', accent: 'ink', onAccent: 'white' },
  type: { heading: 'Inter', body: 'Inter', mono: null, base: 17, scale: 1.3, headingWeight: 700, headingCase: 'none', tracking: 0, measure: 62 },
  grid: { maxWidth: 1100, gutter: 24, margin: 32 }, shape: { radius: 8, rule: 'hairline' },
  header: { style: 'bar', links: ['visit'], action: 'call', sticky: true },
  hero: { composition: 'c', background: 'ground', backgroundPhoto: null, minHeight: 60, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 6, headlineSize: 4, kicker: null, headline: { label: 'Corner Taqueria' }, lede: null, actions: ['call', 'dir'], aside: { kind: 'image', start: 8, span: 5, items: [], photoId: 'g1' } },
  sections: [{ id: 'visit', purpose: 'p', kind: 'contact', heading: { label: 'Visit' }, intro: null, layout: L({ arrangement: 'side-by-side', headingSpan: 4, contentStart: 6, contentSpan: 7 }), background: 'surface', items: [{ title: { label: 'Hours' }, body: null }], actions: ['dir'] }],
  imagery: { approach: 'a', roles: [] }, mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: 'call', headingScale: 0.7, itemColumns: 1 },
});

test('a Reviews band needs a real review or the verified rating; a heading and a button alone are left out', () => {
  const band = (s: Spec): Spec => ({ ...s, header: { ...s.header, links: ['visit', 'reviews'] }, sections: [...s.sections, { id: 'reviews', purpose: 'p', kind: 'statement', heading: { label: 'Reviews' }, intro: null, layout: L(), background: 'inverse', items: [], actions: ['dir'] }] });
  const withRating = renderSpec(band(sparseV1()), sparse, brief);
  assert.match(withRating, /<section id="reviews"[\s\S]*?<p class="rating">4\.6★ from 212 Google reviews<\/p>/, 'the verified rating is real review content');
  const noRating = renderSpec(band(sparseV1()), { ...(sparse as object), rating: null } as never, brief);
  assert.ok(!noRating.includes('id="reviews"'), 'heading and button only: no band');
  assert.ok(!/href="#reviews"/.test(noRating), 'and no menu link to it');
  // a review's own text keeps the band (no rating needed)
  const quoted = band(sparseV1());
  quoted.sections[1].items = [{ title: { label: 'Maria' }, body: { label: 'Best tacos' } }];
  const cat2 = { ...(sparse as object), rating: null, ownLines: ['The best breakfast tacos on the east side, every single morning.'] } as never;
  quoted.sections[1].items = [{ title: { ownLine: 0 }, body: null }];
  assert.match(renderSpec(quoted, cat2, brief), /<section id="reviews"/);
});

test('a sparse business: one section is a valid page, and alternate designs are judged by what it has', () => {
  assert.deepEqual(D.validateSpec(sparseV1(), sparse, brief).filter((e) => e.startsWith('sections')), [], 'one section is enough');
  // only a contact section: no section change can be required; a different hero is
  const v2 = sparseV1();
  v2.hero = { ...v2.hero, backgroundPhoto: 'g2', align: 'center', textStart: 3, textSpan: 8, minHeight: 85, aside: { kind: 'none', start: 1, span: 0, items: [], photoId: null } };
  assert.deepEqual(D.differenceProblems(v2, [sparseV1()]), []);
  const reskin = { ...sparseV1(), palette: { ...sparseV1().palette, ground: 'paper' as const } };
  assert.match(D.differenceProblems(reskin, [sparseV1()]).join(' | '), /hero: too close/);
  assert.ok(!D.differenceProblems(reskin, [sparseV1()]).some((e) => e.startsWith('page structure')), 'no section change required with one meaningful section');
  // two meaningful sections: one change is enough; three or more: at least two
  assert.equal(D.structuralChange(['work/stack/card/no-media', 'contact/stack/plain/no-media'], ['work/stack/plain/band', 'contact/stack/plain/no-media']).needed, 0, 'one meaningful section besides contact');
  assert.equal(D.structuralChange(['work/stack/card/no-media', 'story/stack/plain/no-media', 'contact/stack/plain/no-media'], ['work/stack/plain/band', 'story/stack/plain/no-media', 'contact/stack/plain/no-media']).needed, 1);
  assert.equal(D.structuralChange(['a/x/y/z', 'b/x/y/z', 'c/x/y/z', 'contact/x/y/z'], ['a/x/y/z', 'b/x/y/z', 'c/x/y/z', 'contact/x/y/z']).needed, 2);
});

test('within the bounded attempts, a version that stays too close is reported plainly, never retried further', async () => {
  let calls = 0;
  const same: AiTransport = { via: 'fake', model: 'claude-sonnet-5-5', async call() { calls++; return { data: sparseV1(), usage: { via: 'fake', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, costBasis: 'computed' } }; } };
  const r = await D.generateDesignSpec(sparse, { ...(brief as object), businessKey: 'k', revision: 1 } as never, null, { transport: same, previous: [sparseV1()], fallback: () => 'none' });
  assert.equal(calls, 2, 'one attempt and one repair, no more');
  assert.equal(r.spec, null);
  assert.match(D.versionFailure(r), /^no visibly different version within 2 attempt\(s\): hero: too close to version 1/);
  assert.match(D.versionFailure({ attempts: 1, rejected: [], fallback: { direction: 'x', reason: 'generation failed: API down' } }), /^no valid version within 1 attempt\(s\): generation failed/);
});

test('the client is told plainly when no different-enough version could be made, and keeps the current preview', async () => {
  const FROM = 'qa-final-sparse';
  await studioDocs.put('studio-concept-jobs', 'cj_failed', { id: 'cj_failed', createdAt: '', updatedAt: new Date().toISOString(), status: 'failed', input: { businessKey: 'k', revision: 1, reviewId: 'r', planner: 'open', avoidSpecIds: ['ds_1'] }, setId: 'cs_x', stages: [{ name: 'directions', status: 'failed', attempts: 1, notes: [], error: 'no visibly different version within 2 attempt(s): hero: too close to version 1' }], work: { calls: [] }, resumes: 0 });
  const url = `${config.publicBaseUrl}/sites/corner-taqueria-inx-v1/`;
  const run: Run = { id: 'in_x', input: { placeId: 'x' }, mode: 'open', stage: 'done', startedAt: '', timings: {}, businessKey: 'k', designSpecId: 'ds_1', siteUrl: url, versions: [{ id: 'in_x-v1', n: 1, designSpecId: 'ds_1', setId: 'cs_1', siteUrl: url, createdAt: '' }], shownVersion: 'in_x-v1', next: { id: 'in_x-v2', n: 2, requestedAt: '', stage: 'concepts', conceptJobId: 'cj_failed', timings: {} } };
  await saveConversation({ from: FROM, startedAt: '', updatedAt: '', messages: [], buildIds: [], session: { state: 'building', candidates: [], idx: 0, intake: run, intakeMode: 'open', lastSiteUrl: url } } as never);
  await pollIntake(FROM);
  await pollIntake(FROM);
  const c = (await getConversation(FROM))!;
  const out = c.messages.filter((m) => m.dir === 'out') as { text?: string; url?: string; quickReplies?: string[] }[];
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'I couldn\'t make a version that looks different enough from the one you\'ve seen. Your current preview is still here.');
  assert.equal(out[0].url, url, 'the version they saw');
  assert.deepEqual(out[0].quickReplies, ['Approve and publish', 'Request another version']);
  const s = c.session as { intake: Run; state: string };
  assert.equal(s.state, 'done');
  assert.equal(s.intake.next?.stage, 'failed');
  assert.match(s.intake.next!.failedStage!, /^concepts: directions/);
  assert.equal(s.intake.shownVersion, 'in_x-v1', 'approval would still name the version they saw');
});
