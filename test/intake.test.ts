// The concept intake coordinator: off by default, reuses saved research, checkpoints each stage in its own job, and
// names the exact stage when one fails. (The full brief → concepts → site run is exercised on Vercel, not here.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-intake-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
delete process.env.ROGER_INTAKE_CONCEPTS;

const { conceptIntakeEnabled, newIntake, advanceIntake } = await import('../src/imessage/intake.js');
const { studioDocs } = await import('../src/store.js');
const { getSiteJob } = await import('../src/studio/concepts/site.js');

test('the concept intake is off unless a test intake asks for it or the flag is set', () => {
  assert.equal(conceptIntakeEnabled(), false, 'clients keep the builder preview by default');
  assert.equal(conceptIntakeEnabled('builder'), false);
  assert.equal(conceptIntakeEnabled('concepts'), true, 'an authenticated test intake');
  process.env.ROGER_INTAKE_CONCEPTS = '1';
  try { assert.equal(conceptIntakeEnabled(), true); } finally { delete process.env.ROGER_INTAKE_CONCEPTS; }
});

test('a finished concept set is reused, the top-ranked concept is chosen, and each stage keeps its own job as a checkpoint', async () => {
  // saved research: a finished concept job and its set for this brief revision
  const set = { id: 'cs_saved', brief: { businessKey: 'place-test1', revision: 2, briefHash: 'h' }, reviewId: 'rv', concepts: [{ id: 'a', name: 'Top' }, { id: 'b', name: 'Second' }] };
  await studioDocs.put('studio-concept-sets', set.id, set);
  await studioDocs.put('studio-concept-jobs', 'cj_saved', { id: 'cj_saved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'done', input: { businessKey: 'place-test1', revision: 2, reviewId: 'rv' }, setId: set.id, stages: [{ name: 'render', status: 'done', attempts: 1, notes: [], startedAt: '2026-11-10T10:00:00.000Z', finishedAt: '2026-11-10T10:00:42.000Z' }], work: { calls: [] }, resumes: 0 });
  await studioDocs.put('studio-index', 'place-test1', { businessKey: 'place-test1', latest: 2, revisions: [] });
  await studioDocs.put('studio-briefs', 'place-test1--r2', { businessKey: 'place-test1', revision: 2, briefHash: 'h' });
  const run = newIntake({ placeId: 'test1' });
  await advanceIntake(run);
  assert.equal(run.timings.brief?.reused, true, 'the saved brief: no new research');
  assert.equal(run.timings.concepts?.reused, true, 'the saved concept set: no new render');
  assert.equal(run.conceptJobId, 'cj_saved');
  assert.equal(run.setId, 'cs_saved');
  assert.equal(run.conceptId, 'a', 'the top-ranked concept first');
  assert.equal(run.stage, 'site');
  assert.ok(run.siteJobId, 'the site stage has its own job (its checkpoint)');
  assert.deepEqual(run.timings.concepts?.steps, [{ name: 'render', ms: 42_000, status: 'done' }], 'stage timings come from the job');
  // calling again starts nothing twice
  const siteJob = run.siteJobId;
  await advanceIntake(run);
  assert.equal(run.siteJobId, siteJob);
  // the site build cannot run here (no real brief): the intake reports the exact stage that failed
  for (let i = 0; i < 50 && (await getSiteJob(siteJob!))?.status !== 'failed'; i++) await new Promise((r) => setTimeout(r, 100));
  await advanceIntake(run);
  assert.equal(run.stage, 'failed');
  assert.match(run.failedStage!, /^site/);
  assert.ok(run.error);
});
