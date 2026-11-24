// The beta with no staff password and no public HTTPS origin: staff pages and every review action are closed (not open),
// no customer link can be sent (never a localhost link), customers' existing links still open; and the per-invite caps
// on businesses, one job at a time, versions per business and spend, plus the daily cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-closed-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), ROGER_NO_LISTEN: '1', ROGER_BETA: '1', STUDIO_PASSWORD: '', ROGER_PUBLIC_ORIGIN: '', PUBLIC_BASE_URL: 'http://localhost:4000', ROGER_BETA_DAILY_USD: '4' });
const { default: app } = await import('../src/server.js');
const { config } = await import('../src/config.js');
const { createInvite, capProblem, recordCharge, RESERVE_USD } = await import('../src/beta.js');
const ci = await import('../src/imessage/custom-intake.js');
const { studioDocs } = await import('../src/store.js');
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());

test('no staff password in the beta: staff pages and actions are closed; no public origin: no customer link, never localhost', async () => {
  assert.equal(config.publicOrigin, '', 'a localhost base URL is not a public origin');
  for (const p of ['/app/imessage-reviews.html', '/api/studio/imessage-reviews']) assert.equal((await fetch(BASE + p)).status, 503, p);
  assert.equal((await fetch(`${BASE}/app/`, { redirect: 'manual' })).headers.get('location'), '/app/frontend.html', '/app/ is the beta staff app');
  assert.equal((await fetch(`${BASE}/app/frontend.html`)).status, 503, 'the New site page is closed without a staff password');
  assert.equal((await fetch(`${BASE}/api/conversations`)).status, 404, 'the old Studio API is not part of the beta');
  assert.equal((await fetch(`${BASE}/api/studio/imessage-reviews/x/1/send`, { method: 'POST' })).status, 503);
  assert.deepEqual(await (await fetch(`${BASE}/api/staff/me`)).json(), { staff: false }, 'even a local request is not staff in the beta');
  assert.equal((await fetch(`${BASE}/api/imessage/inbound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'z', text: 'Hi', intake: 'custom' }) })).status, 503, 'no invite: closed');
  const { token } = await createInvite('T');
  assert.equal((await fetch(`${BASE}/api/imessage/inbound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'z1', text: 'Hi', intake: 'custom', invite: token }) })).status, 200, 'an invited tester still gets the simulator');
  // sending a link needs the public origin
  await studioDocs.put('studio-frontend-jobs', 'fe_noorigin0000001', { id: 'fe_noorigin0000001', status: 'needs-review', input: { facts: {}, notes: [] }, checks: { static: 'passed' }, pages: [], site: { pages: [] }, code: { html: '' }, review: { ran: true, pass: true, problems: [] } });
  const run = { ...ci.newCustomRun({ placeId: 'p', name: 'X', confirmedAt: 'now' }), stage: 'versions' as const, versions: [{ n: 1, requestedAt: 'x', status: 'review' as const, jobId: 'fe_noorigin0000001' }] };
  const r = await ci.staffSend(run, 1, 'staff');
  assert.equal(r.sent, false); assert.match(r.reason!, /no public HTTPS origin is configured/);
  assert.equal(await studioDocs.get('customer-links', 'fe_noorigin0000001'), undefined);
});

test('caps per invite: businesses, one job at a time, versions per business, spend; and the daily cap', async () => {
  const { invite } = await createInvite('Capped', { businesses: 1, versionsPerBusiness: 2, spendUsd: 3 });
  const costs = new Map<string, number | undefined>();
  const costOf = async (c: { jobId?: string; runId: string; kind: string }) => costs.get(c.jobId ?? `${c.kind}:${c.runId}`);
  assert.equal(await capProblem(invite.id, 'research', { runId: 'r1' }, costOf), undefined);
  await recordCharge(invite.id, { kind: 'research', from: 'a', runId: 'r1' });
  assert.match((await capProblem(invite.id, 'research', { runId: 'r2' }, costOf))!, /still being made/, 'one job at a time');
  costs.set('research:r1', 0.1);
  assert.match((await capProblem(invite.id, 'research', { runId: 'r2' }, costOf))!, /limit of 1 business/);
  assert.equal(await capProblem(invite.id, 'version', { runId: 'r1', n: 1 }, costOf), undefined, "the run's own research does not block its first version");
  await recordCharge(invite.id, { kind: 'version', from: 'a', runId: 'r1', n: 1, jobId: 'fe_1' }); costs.set('fe_1', 1.2);
  await recordCharge(invite.id, { kind: 'version', from: 'a', runId: 'r1', n: 2, jobId: 'fe_2' }); costs.set('fe_2', 1.1);
  assert.match((await capProblem(invite.id, 'version', { runId: 'r1', n: 3 }, costOf))!, /limit of 2 version/);
  const { invite: spender } = await createInvite('Spender', { businesses: 5, versionsPerBusiness: 5, spendUsd: 2 });
  await recordCharge(spender.id, { kind: 'version', from: 'b', runId: 's1', n: 1, jobId: 'fe_s1' }); costs.set('fe_s1', 1.0);
  assert.match((await capProblem(spender.id, 'version', { runId: 's1', n: 2 }, costOf))!, new RegExp(`spend cap of \\$2 would be passed \\(\\$1\\.00 so far\\)`), `1.00 + reserve ${RESERVE_USD.version} > 2`);
  // the day's spend across invites: 0.1 + 1.2 + 1.1 + 1.0 = 3.4 today, cap 4
  const { invite: fresh } = await createInvite('Fresh');
  assert.match((await capProblem(fresh.id, 'version', { runId: 'f1', n: 1 }, costOf))!, /daily AI spend cap of \$4/);
});
