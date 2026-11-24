// The open intake (test-only): brief → references → open DesignSpec concept → full site, each stage its own saved job,
// saved research reused, never turned on by the client flag, and a record of whether the design used the references.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-intake-open-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
delete process.env.ROGER_INTAKE_CONCEPTS;

const { intakeModeOf, newIntake, advanceIntake } = await import('../src/imessage/intake.js');
const { studioDocs } = await import('../src/store.js');
const { getSiteJob } = await import('../src/studio/concepts/site.js');
const { validateSpec } = await import('../src/studio/concepts/designspec.js');

test('the open intake is test-only: asked for per conversation, never turned on by the client flag', () => {
  assert.equal(intakeModeOf(), undefined, 'clients keep the builder preview');
  assert.equal(intakeModeOf('open'), 'open');
  assert.equal(intakeModeOf('concepts'), 'concepts');
  process.env.ROGER_INTAKE_CONCEPTS = '1';
  try {
    assert.equal(intakeModeOf(), 'concepts', 'the flag keeps meaning the directions intake');
    assert.equal(intakeModeOf('open'), 'open');
  } finally { delete process.env.ROGER_INTAKE_CONCEPTS; }
  assert.equal(newIntake({ placeId: 'x' }).mode, undefined);
  assert.equal(newIntake({ placeId: 'x' }, 'open').mode, 'open');
});

const t = (s: number) => new Date(Date.UTC(2026, 10, 13, 10, 0, s)).toISOString();
async function plant() {
  await studioDocs.put('studio-index', 'place-test2', { businessKey: 'place-test2', latest: 3, revisions: [] });
  await studioDocs.put('studio-briefs', 'place-test2--r3', { businessKey: 'place-test2', revision: 3, briefHash: 'h' });
  // a saved reference strategy for this revision, and an older one for another revision (never used)
  await studioDocs.put('studio-reference-jobs', 'rj_saved', { id: 'rj_saved', createdAt: t(0), updatedAt: t(30), status: 'done', input: { businessKey: 'place-test2', revision: 3, keepBrand: true }, stages: [{ name: 'find', status: 'done', attempts: 1, notes: [], startedAt: t(0), finishedAt: t(5) }], work: { calls: [], strategy: { layoutPatterns: [{ pattern: 'Photo-led hero', why: '', from: [] }, { pattern: 'Sticky call bar', why: '', from: [] }] } }, resumes: 0 });
  await studioDocs.put('studio-reference-jobs', 'rj_old', { id: 'rj_old', createdAt: t(40), updatedAt: t(41), status: 'done', input: { businessKey: 'place-test2', revision: 2, keepBrand: true }, stages: [], work: { calls: [], strategy: { layoutPatterns: [] } }, resumes: 0 });
  // a directions set for the same revision (newer) and an open set made with the saved strategy
  const set = (id: string, concepts: unknown[]) => studioDocs.put('studio-concept-sets', id, { id, brief: { businessKey: 'place-test2', revision: 3, briefHash: 'h' }, reviewId: 'rv', concepts });
  await set('cs_dir', [{ id: 'a', name: 'Showcase' }]);
  await set('cs_open', [{ id: 'a', name: 'Open design', designSpecId: 'ds_1' }]);
  const job = (id: string, setId: string, input: object, work: object, created: string) => studioDocs.put('studio-concept-jobs', id, { id, createdAt: created, updatedAt: created, status: 'done', input: { businessKey: 'place-test2', revision: 3, reviewId: 'rv', ...input }, setId, stages: [{ name: 'directions', status: 'done', attempts: 1, notes: [], startedAt: t(50), finishedAt: t(110) }], work: { calls: [], ...work }, resumes: 0 });
  await job('cj_dir', 'cs_dir', {}, {}, t(200));
  await job('cj_open', 'cs_open', { planner: 'open', referenceJobId: 'rj_saved' }, { designSpecId: 'ds_1', design: { id: 'ds_1', source: 'ai', attempts: 1, strategy: 'used', fallback: null, rejected: [], references: { referenceJobId: 'rj_saved', provided: true, applied: ['Photo-led hero'] } } }, t(100));
}

test('each stage reuses saved research for this brief revision; the open path never takes a directions set; references used is recorded', async () => {
  await plant();
  const run = newIntake({ placeId: 'test2' }, 'open');
  await advanceIntake(run);
  assert.equal(run.timings.brief?.reused, true);
  assert.equal(run.referenceJobId, 'rj_saved', 'the saved strategy of this revision, not another revision\'s');
  assert.equal(run.timings.references?.reused, true);
  assert.deepEqual(run.timings.references?.steps, [{ name: 'find', ms: 5000, status: 'done' }]);
  assert.equal(run.conceptJobId, 'cj_open', 'the open set made with this strategy, not the newer directions set');
  assert.equal(run.designSpecId, 'ds_1');
  assert.deepEqual(run.references, { referenceJobId: 'rj_saved', provided: true, applied: ['Photo-led hero'], used: true });
  assert.equal(run.stage, 'site');
  assert.ok(run.siteJobId, 'the site stage is its own job (its checkpoint)');
  // polling again starts nothing twice
  const sj = run.siteJobId;
  await advanceIntake(run);
  assert.equal(run.siteJobId, sj);
  assert.equal(run.referenceJobId, 'rj_saved');
  // the site can't be built here (no real brief): the run names the stage that failed
  for (let i = 0; i < 50 && (await getSiteJob(sj!))?.status !== 'failed'; i++) await new Promise((r) => setTimeout(r, 100));
  await advanceIntake(run);
  assert.equal(run.stage, 'failed');
  assert.match(run.failedStage!, /^site/);
});

test('the directions intake still reuses its own set, never an open one', async () => {
  const run = newIntake({ placeId: 'test2' });
  await advanceIntake(run);
  assert.equal(run.stage === 'site' || run.stage === 'failed', true);
  assert.equal(run.conceptJobId, 'cj_dir');
  assert.equal(run.referenceJobId, undefined);
  assert.equal(run.references, undefined);
});

test('the spec\'s reference claims are checked against the strategy actually given', () => {
  const cat = { business: { name: 'x', summary: null }, ownLines: ['Hi'], services: [], story: null, actions: [], omitted: [], photos: [], address: null, locations: [], area: null } as never;
  const brief = { identity: { status: 'verified' }, brand: { colors: [], fonts: [], logo: { value: null, status: 'unknown' } } } as never;
  const strategy = { layoutPatterns: [{ pattern: 'a' }, { pattern: 'b' }] } as never;
  const errs = (used: number[] | undefined, s: unknown) => validateSpec({ referencesUsed: used } as never, cat, brief, s as never).filter((e) => e.startsWith('referencesUsed'));
  assert.deepEqual(errs([0, 1], strategy), []);
  assert.match(errs([2], strategy)[0], /not one of the strategy's patterns \(0-1\)/);
  assert.match(errs([0], null)[0], /no reference strategy was given/);
  assert.deepEqual(errs([], null), []);
});
