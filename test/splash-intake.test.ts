// Splash pages in the product: the worker's queue (each job claimed once) and recovery after a stop (once), an update
// that keeps the design and only refreshes the facts (no AI), the iMessage intake making splash pages (blocking
// findings hold a page back; the owner's questions after the first link; answers kept as owner facts; "Update my page"),
// and a quote request's message for the owner. Synthetic business, fake Claude, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-intake-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), ROGER_PUBLIC_ORIGIN: 'https://beta.example.test' });
const { studioDocs } = await import('../src/store.js');
const jobs = await import('../src/splash/jobs.js');
const ci = await import('../src/imessage/custom-intake.js');
const { ownerQuestions } = await import('../src/splash/facts.js');
const { ownerInputs, addOwnerInput } = await import('../src/splash/owner.js');
const { splashFixtures } = await import('./splash-fixtures.js');
const fx = await splashFixtures();
type SplashJob = Awaited<ReturnType<typeof jobs.getSplashJob>> & object;

const opts = (transport = fx.fakeTransport().transport) => ({ transport, review: false as const, images: false as const, collect: async () => fx.plan, prepare: async () => fx.base });
const stub = (id: string, over: Partial<SplashJob> = {}): SplashJob => ({
  id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), placeId: 'PLACEtest', status: 'ready', costUsd: 0.3, attempts: 1,
  plan: { ...fx.plan, questions: [{ field: 'hours', text: 'Your opening hours: your website says "9–5", but your Google listing says "8–5". Which is right?' }, { field: 'website', text: 'Is ridgeline.example still your website?', yes: 'https://ridgeline.example/' }] },
  input: fx.input, code: fx.answer(), review: { at: 'x', pass: true, ran: true, pages: [], problems: [] }, qa: { at: 'x', passed: ['ok'], fixed: [], needs_human: ['Accessibility: a low-contrast label.'], deadLinks: [], blocking: [] }, ...over,
});

test('owner questions: each knows the fact it settles (a disagreement is raised even when the owner value is used)', () => {
  const F = fx.F;
  const sheet = { facts: [], conflicts: [
    { field: 'hours', used: F('hours', 'Mon–Fri 9–5', 'website'), others: [F('hours', 'Mon–Fri 8–5')] },
    { field: 'phone', used: F('phone', '(512) 555-0100', 'owner'), others: [F('phone', '(512) 555-0199')] },
  ] } as unknown as Parameters<typeof ownerQuestions>[0];
  const qs = ownerQuestions(sheet, { tradeUnsure: { words: 'a plumber', id: 'plumber' } });
  assert.deepEqual(qs.map((q) => q.field), ['phone', 'hours', 'trade']);
  assert.equal(qs[2].yes, 'plumber');
});

test('the worker: a queued page is claimed once and run; a stopped page is recovered once (checks again, or made again)', async () => {
  process.env.ROGER_WORKER = 'daemon';
  try {
    delete process.env.ROGER_ROLE;
    const q = await jobs.startSplashJob('PLACEtest');
    assert.equal(q.status, 'queued', 'a web function only queues');
    process.env.ROGER_ROLE = 'worker';
    const f = fx.fakeTransport();
    const [a, b] = await Promise.all([jobs.runQueuedSplashJobs('w1', opts(f.transport)), jobs.runQueuedSplashJobs('w2', opts(f.transport))]);
    assert.deepEqual([...a, ...b], [q.id], 'claimed by exactly one worker');
    assert.equal((await jobs.waitSplashJob(q.id))?.status, 'ready');
    assert.equal(f.calls.length, 1);
    assert.deepEqual(await jobs.runQueuedSplashJobs('w1', opts(f.transport)), [], 'not run twice');
    // stopped mid-run: a page already made has its checks run again (no AI); one not made yet is made again
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    await studioDocs.put('splash-jobs', 'sp_00000000000000c1', stub('sp_00000000000000c1', { status: 'checking', heartbeatAt: old, updatedAt: old }));
    await studioDocs.put('splash-jobs', 'sp_00000000000000c2', stub('sp_00000000000000c2', { status: 'generating', code: undefined, heartbeatAt: old, updatedAt: old, instruction: 'a restart (its own prompt, so no cached answer)' }));
    await studioDocs.put('splash-jobs', 'sp_00000000000000c3', stub('sp_00000000000000c3', { status: 'collecting', code: undefined, heartbeatAt: old, updatedAt: old, recoveries: 1 }));
    await studioDocs.put('splash-jobs', 'sp_00000000000000c4', stub('sp_00000000000000c4', { status: 'generating', code: undefined, heartbeatAt: new Date().toISOString() }));
    const g = fx.fakeTransport();
    const r = await jobs.recoverInterruptedSplashJobs('w1', opts(g.transport));
    assert.deepEqual(r, { rechecked: ['sp_00000000000000c1'], restarted: ['sp_00000000000000c2'], failed: ['sp_00000000000000c3'] }, 'a job still beating is left alone');
    assert.equal((await jobs.waitSplashJob('sp_00000000000000c1'))?.status, 'ready');
    assert.equal((await jobs.waitSplashJob('sp_00000000000000c2'))?.status, 'ready');
    assert.equal(g.calls.length, 1, `only the page not made yet needed Claude: ${g.calls.length}`);
    assert.match((await jobs.getSplashJob('sp_00000000000000c3'))!.error!, /interrupted again/);
    assert.deepEqual(await jobs.recoverInterruptedSplashJobs('w2', opts(g.transport)), { rechecked: [], restarted: [], failed: [] }, 'each recovery once');
  } finally { delete process.env.ROGER_WORKER; delete process.env.ROGER_ROLE; }
});

test('an update keeps the design and refreshes the facts with no AI; a plan that no longer fits gets a new design in the same direction', async () => {
  await studioDocs.put('splash-jobs', 'sp_00000000000000d1', stub('sp_00000000000000d1'));
  const f = fx.fakeTransport();
  const updated = { ...fx.plan, fact_sheet: fx.plan.fact_sheet.map((x) => x.field === 'phone' ? fx.F('phone', '(512) 555-0142', 'owner') : x) };
  const j = await jobs.startSplashJob('PLACEtest', { ...opts(f.transport), collect: async () => updated, refreshFrom: 'sp_00000000000000d1' });
  const done = (await jobs.waitSplashJob(j.id))!;
  assert.equal(done.status, 'ready'); assert.equal(done.reused, true); assert.equal(f.calls.length, 0, 'no AI');
  assert.equal(done.input!.facts.phone, '(512) 555-0142');
  assert.match(await jobs.splashPage(done), /\(512\) 555-0142/);
  // fewer screens now: a new design, told to keep the earlier page's visual direction
  const thin = { ...fx.plan, material: { ...fx.material, offerings: 0 }, screen_plan: (await import('../src/splash/screens.js')).planScreens(fx.row, { ...fx.material, offerings: 0 }) };
  const g = fx.fakeTransport();
  const k = await jobs.startSplashJob('PLACEtest', { ...opts(g.transport), collect: async () => thin, refreshFrom: 'sp_00000000000000d1' });
  await jobs.waitSplashJob(k.id);
  assert.equal(g.calls.length >= 1, true);
  assert.match(g.calls[0], /Keep the visual direction of the page this replaces: Clean pipework lines\./);
});

test('the iMessage intake makes a splash page: blocking findings hold it back; the link, then the owner\'s questions; answers become owner facts; "Update my page"', async () => {
  process.env.ROGER_INTAKE_PAGE = 'splash';
  const saved = { start: ci.intakeDeps.startSplashJob, get: ci.intakeDeps.getSplashJob };
  try {
    const run = { ...ci.newCustomRun({ placeId: 'PLACEtest', name: 'Ridge Line Plumbing', confirmedAt: 'now', from: '+15550001111' }), stage: 'versions' as const, businessKey: 'place-PLACEtest', revision: 1 };
    assert.equal(run.page, 'splash');
    const started: Record<string, unknown>[] = [];
    let n = 0;
    ci.intakeDeps.startSplashJob = (async (_p: string, o: Record<string, unknown>) => {
      started.push(o);
      const id = `sp_00000000000000e${++n}`;
      await studioDocs.put('splash-jobs', id, stub(id, n === 1 ? { qa: { at: 'x', passed: [], fixed: [], needs_human: ['A wrong call link.'], deadLinks: [], blocking: ['A wrong call link.'] } } : {}));
      return { id } as SplashJob;
    }) as typeof ci.intakeDeps.startSplashJob;
    // a page with a blocking finding is never sent
    run.versions.push({ n: 1, requestedAt: 'x', status: 'generating' });
    await ci.advanceCustom(run); await ci.advanceCustom(run);
    assert.equal(run.versions[0].status, 'failed'); assert.match(run.versions[0].error!, /check: A wrong call link/);
    assert.deepEqual(started[0].owner, { from: '+15550001111', runId: run.id }, 'quote requests will reach this owner');
    assert.match(ci.customMessages(run)[0].text, /couldn't finish your preview/, 'the owner is told, plainly');
    // the next one is clean: sent at once, then the first question
    assert.equal(ci.requestCustomVersion(run), 'started');
    await ci.advanceCustom(run); await ci.advanceCustom(run);
    const v = run.versions[1];
    assert.equal(v.status, 'sent'); assert.match(v.url!, /\/v\/sp_00000000000000e2$/);
    assert.ok(await studioDocs.get('customer-links', 'sp_00000000000000e2'));
    const m = ci.customMessages(run);
    assert.equal(m[0].url, v.url);
    assert.match(m[1]?.text ?? JSON.stringify(m), /^One question to get your page right: Your opening hours/);
    assert.deepEqual(ci.customMessages(run), [], 'each once');
    // answers: kept as owner facts; a yes means the question's value; then how to see them on the page
    const store = (field: string, value: string) => addOwnerInput('place-PLACEtest', { field, value, at: 'now', from: '+15550001111' });
    const r1 = await ci.answerQuestion(run, 'Mon–Fri 8am to 5pm', store);
    assert.match(r1[1].text, /Is ridgeline\.example still your website\?/); assert.deepEqual(r1[1].quickReplies, ['Yes', 'Skip']);
    const r2 = await ci.answerQuestion(run, 'yes', store);
    assert.match(r2[0].text, /Reply "Update my page"/);
    assert.deepEqual((await ownerInputs('place-PLACEtest')).map((o) => [o.field, o.value]).sort(), [['hours', 'Mon–Fri 8am to 5pm'], ['website', 'https://ridgeline.example/']]);
    // "Update my page": a new version made from the page last sent
    assert.equal(ci.requestCustomVersion(run, { update: true }), 'started');
    await ci.advanceCustom(run);
    assert.equal(started[2].refreshFrom, 'sp_00000000000000e2');
    await ci.advanceCustom(run);
    assert.match(ci.customMessages(run)[0].text, /your page with your answers/);
  } finally { ci.intakeDeps.startSplashJob = saved.start; ci.intakeDeps.getSplashJob = saved.get; delete process.env.ROGER_INTAKE_PAGE; }
});

test('a quote request\'s message for the owner: who, how to reach them, what they need, their photo', () => {
  const lead = { id: 'ld_1', jobId: 'sp_x', placeId: 'P', at: 'now', fields: { name: 'Test Visitor', phone: '5125550199', need: 'Leaking pipe', zip: '78704' }, photoId: 'lp_0000000000000001' };
  const m = jobs.leadMessage(lead, { origin: 'https://beta.example.test' });
  assert.equal(m.text, 'New quote request from your website: Test Visitor, 5125550199.\nThey need: Leaking pipe\nZIP: 78704\nThey sent a photo.');
  assert.equal(m.image, 'https://beta.example.test/api/splash/lead-photos/lp_0000000000000001');
  assert.match(jobs.leadMessage({ ...lead, fields: { name: 'A', phone: '1', time: 'mornings' }, photoId: undefined }, { appointment: true }).text, /^New appointment request/);
});
