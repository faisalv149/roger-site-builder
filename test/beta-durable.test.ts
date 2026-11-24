// Durable generation: a job stopped mid-run (a server restart) continues from its saved stage exactly once, even when two
// recoveries race (two server starts, or a start and a poll); an accepted homepage is never regenerated; spend recorded
// before the stop is kept; a job that stops again at the same stage is failed, not retried without end. Fake Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-durable-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { recoverInterruptedFrontendJobs, waitFrontendJob, getFrontendJob, frontendJobRunning, startFrontendJob, runQueuedFrontendJobs } = await import('../src/studio/frontend/jobs.js');
const { planPages } = await import('../src/studio/frontend/site.js');
const { PIPELINE_REV } = await import('../src/studio/frontend/page.js');
const { studioDocs, withSharedLock } = await import('../src/store.js');
import type { FrontendCode, FrontendInput } from '../src/studio/frontend/page.js';
import type { AiTransport, AiRequest } from '../src/studio/concepts/ai.js';

const input: FrontendInput = {
  business: { name: 'Example Studio', category: 'Studio', website: null, summary: null }, colours: ['#134531'],
  facts: { name: 'Example Studio', address: 'Example Road', hours: 'Monday: 9–5', rating: '4.6★ from 22 reviews' },
  actions: [{ id: 'directions', factId: 'address', kind: 'directions', label: 'Directions', href: 'https://example.com/maps' }],
  photos: [{ id: 'p1', url: 'https://example.com/photo.jpg', width: 1200, height: 800, orientation: 'landscape', uses: [], alt: 'Studio entrance', seen: 'Studio entrance', services: [] }],
  ownLines: [], services: [], items: [], story: null, notes: [],
};
const nav = '<nav><a data-page="home">Home</a><a data-page="visit">Visit</a></nav>';
const home = (idea: string): FrontendCode => ({ idea, fonts: [], css: '.cover{display:grid}',
  html: `<header><span data-fact="name"></span>${nav}</header><main><section class="cover"><h1>Make room for something new.</h1><figure><img data-photo="p1"></figure></section><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="directions">Find us</a></main><footer>See you soon.</footer>` });
const visit = { css: '.v{display:grid}', pages: [{ slug: 'visit', html: `<header><span data-fact="name"></span>${nav}</header><main><h1>Find the studio</h1><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="directions">Directions</a></main><footer>See you soon.</footer>` }] };
function fake(answer: (req: AiRequest) => unknown) {
  const calls: string[] = [];
  const transport: AiTransport = { via: 'fake', model: 'claude-sonnet-5-5', async call(req) {
    calls.push(req.stage); await new Promise((r) => setTimeout(r, 30));
    return { data: answer(req), usage: { via: 'fake', model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.2, costBasis: 'reported' } };
  } };
  return { transport, calls };
}
/** a job as saved when the server stopped: generating, at a stage, with what it had paid for so far */
async function stopped(id: string, stage: 'homepage' | 'pages', idea: string) {
  // last heard from five minutes ago: its heartbeat has stopped
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  await studioDocs.put('studio-frontend-jobs', id, { id, createdAt: at, updatedAt: at, businessKey: `k-${id}`, revision: 1, instruction: '', status: 'generating', stage, input, attempts: 1, costUsd: stage === 'pages' ? 0.45 : 0, calls: stage === 'pages' ? [{ stage: 'frontend:code-v1', costUsd: 0.45 }] : [], checks: { static: 'pending', browser: 'pending', copy: 'owner-review-required', publication: 'disabled' }, pages: planPages(input), version: { n: 1 }, rev: PIPELINE_REV, ...(stage === 'pages' ? { code: home(idea) } : {}) });
}

test('stopped during the inner pages: two racing recoveries resume it once, from the accepted homepage; its spend is kept', async () => {
  await stopped('fe_durablepages0001', 'pages', 'Durable pages homepage');
  const f = fake((req) => (req.stage === 'frontend:pages-v1' ? visit : home('should never be asked for')));
  const [a, b] = await Promise.all([recoverInterruptedFrontendJobs('server-A', { transport: f.transport, review: false }), recoverInterruptedFrontendJobs('server-B', { transport: f.transport, review: false })]);
  assert.equal(a.resumed.length + b.resumed.length, 1, 'exactly one recovery continues it');
  const done = (await waitFrontendJob('fe_durablepages0001'))!;
  assert.equal(done.status, 'needs-review', done.error ?? '');
  assert.deepEqual(f.calls, ['frontend:pages-v1'], 'only the inner pages, once; the accepted homepage is not regenerated');
  assert.equal(done.code!.idea, 'Durable pages homepage');
  assert.equal(done.recoveries?.length, 1);
  assert.ok(Math.abs(done.costUsd - 0.65) < 1e-9, `the spend before the stop is kept and added to (${done.costUsd})`);
  // a later start finds nothing to do
  const again = await recoverInterruptedFrontendJobs('server-C', { transport: f.transport, review: false });
  assert.deepEqual(again, { resumed: [], restarted: [], failed: [] });
  assert.equal(f.calls.length, 1);
});

test('stopped during the homepage: the homepage stage runs again in the same job, once; a second stop at the same stage fails it', async () => {
  await stopped('fe_durablehome00001', 'homepage', '');
  const f = fake((req) => (req.stage === 'frontend:pages-v1' ? visit : home('Recovered homepage idea')));
  const r = await recoverInterruptedFrontendJobs('server-A', { transport: f.transport, review: false });
  assert.deepEqual(r.restarted, ['fe_durablehome00001']);
  const done = (await waitFrontendJob('fe_durablehome00001'))!;
  assert.equal(done.status, 'needs-review', done.error ?? '');
  assert.deepEqual(f.calls, ['frontend:code-v1', 'frontend:pages-v1']);
  // the same job stopping again at the homepage after its recovery: failed, no new spend
  const job = (await getFrontendJob('fe_durablehome00001'))!;
  await studioDocs.put('studio-frontend-jobs', job.id, { ...job, status: 'generating', stage: 'homepage', code: undefined, heartbeatAt: new Date(Date.now() - 5 * 60_000).toISOString() });
  const second = await recoverInterruptedFrontendJobs('server-B', { transport: f.transport, review: false });
  assert.deepEqual(second.failed, ['fe_durablehome00001']);
  assert.equal(f.calls.length, 2, 'no further paid call');
  assert.match((await getFrontendJob('fe_durablehome00001'))!.error!, /interrupted again at the homepage after a recovery/);
  assert.equal(frontendJobRunning('fe_durablehome00001'), false);
});

test('a generation still beating (a worker draining it during a rollout) is left alone', async () => {
  await stopped('fe_durablebeating01', 'pages', 'Beating');
  const job = (await getFrontendJob('fe_durablebeating01'))!;
  await studioDocs.put('studio-frontend-jobs', job.id, { ...job, heartbeatAt: new Date().toISOString() });
  const f = fake(() => visit);
  assert.deepEqual(await recoverInterruptedFrontendJobs('server-new', { transport: f.transport, review: false }), { resumed: [], restarted: [], failed: [] });
  assert.equal(f.calls.length, 0);
});

test('the web side only queues (ROGER_WORKER=daemon); two workers racing for the queue run the generation once', async () => {
  process.env.ROGER_WORKER = 'daemon';
  try {
    const f = fake((req) => (req.stage === 'frontend:pages-v1' ? visit : home('Queued homepage idea')));
    const queued = await startFrontendJob({ businessKey: 'k-queued', revision: 1 }, '', { input, transport: f.transport, again: true, review: false });
    assert.equal(queued.status, 'queued'); assert.ok(queued.queuedAt);
    assert.equal(f.calls.length, 0, 'nothing runs in the request');
    process.env.ROGER_ROLE = 'worker';
    const [a, b] = await Promise.all([runQueuedFrontendJobs('worker-A', { transport: f.transport, review: false }), runQueuedFrontendJobs('worker-B', { transport: f.transport, review: false })]);
    assert.equal(a.length + b.length, 1, 'one worker claims it');
    const done = (await waitFrontendJob(queued.id))!;
    assert.equal(done.status, 'needs-review', done.error ?? '');
    assert.deepEqual(f.calls, ['frontend:code-v1', 'frontend:pages-v1']);
    assert.deepEqual(await runQueuedFrontendJobs('worker-C', { transport: f.transport, review: false }), [], 'nothing left to claim');
  } finally { delete process.env.ROGER_WORKER; delete process.env.ROGER_ROLE; }
});

test('built, but the worker stopped during its rendered review: only the checks run again (no AI), once', async () => {
  await stopped('fe_durablechecks001', 'pages', 'Checked homepage');
  const job = (await getFrontendJob('fe_durablechecks001'))!;
  await studioDocs.put('studio-frontend-jobs', job.id, { ...job, status: 'needs-review', stage: 'checks', site: visit });
  const f = fake(() => visit);
  const [a, b] = await Promise.all([recoverInterruptedFrontendJobs('w-A', { transport: f.transport, review: false }), recoverInterruptedFrontendJobs('w-B', { transport: f.transport, review: false })]);
  assert.deepEqual([...a.resumed, ...b.resumed], ['fe_durablechecks001']);
  assert.equal(f.calls.length, 0, 'no paid call: the build is kept');
  const done = (await getFrontendJob('fe_durablechecks001'))!;
  assert.equal(done.status, 'needs-review'); assert.equal(done.stage, undefined, 'finished: its checks are recorded');
  assert.ok(done.delivery, 'the delivery decision is recorded');
});

test('a conversation changes in one process at a time: the shared lock serializes holders and takes over a dead one', async () => {
  const order: string[] = [];
  const slow = (tag: string) => withSharedLock('conv-test', async () => { order.push(`${tag}+`); await new Promise((r) => setTimeout(r, 120)); order.push(`${tag}-`); });
  await Promise.all([slow('a'), slow('b')]);
  assert.ok(order.join() === 'a+,a-,b+,b-' || order.join() === 'b+,b-,a+,a-', `no overlap: ${order.join()}`);
  // a lock left behind by a process that died is taken over once it expires
  await studioDocs.put('locks', 'conv-dead', { at: Date.now() - 300_000, until: Date.now() - 1000 });
  assert.equal(await withSharedLock('conv-dead', async () => 'ran', { waitMs: 2000 }), 'ran');
  // a live lock makes a waiter give up after its wait (it never runs alongside)
  await studioDocs.put('locks', 'conv-live', { at: Date.now(), until: Date.now() + 60_000 });
  await assert.rejects(withSharedLock('conv-live', async () => 'ran', { waitMs: 600 }), /busy/);
});
