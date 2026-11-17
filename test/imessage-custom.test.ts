// The custom full-site intake's rules, offline: what blocks a version from review (homepage only, failed checks), each
// customer message sent once, staff sending a link once, a rejection or failure keeping the earlier preview, one new
// version at a time, and approval recording the exact version last shown. Synthetic jobs; no AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-imsg-custom-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), ROGER_PUBLIC_ORIGIN: 'https://beta.example.test' });
const { studioDocs } = await import('../src/store.js');
const ci = await import('../src/imessage/custom-intake.js');
import type { FrontendJob } from '../src/studio/frontend/jobs.js';

const job = (id: string, over: Partial<FrontendJob> = {}): FrontendJob => ({
  id, createdAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-16T10:05:00.000Z', businessKey: 'place-X', revision: 1, instruction: '', status: 'needs-review',
  input: { business: { name: 'Test', category: null, website: null, summary: null }, colours: [], facts: { name: 'Test', address: '1 Road', hours: 'Mon: 9 AM – 5 PM' }, actions: [], photos: [], ownLines: [], services: [], items: [], story: null, notes: [] },
  code: { idea: 'i', html: '', css: '', fonts: [] }, attempts: 2, costUsd: 0.4, calls: [],
  checks: { static: 'passed', browser: 'passed', copy: 'owner-review-required', publication: 'disabled' },
  pages: [{ slug: 'visit', title: 'Visit', purpose: '', required: [], minPhotos: 0, requireAction: true }], site: { css: '', pages: [{ slug: 'visit', html: '<main><h1>Visit</h1><p data-fact="address"></p><p data-fact="hours"></p></main>' }] },
  rev: 2, review: { at: 'x', pass: true, ran: true, pages: [], problems: [], notes: [] }, ...over,
});
const run = (): ReturnType<typeof ci.newCustomRun> => ({ ...ci.newCustomRun({ placeId: 'X', name: 'Test Bakery', confirmedAt: 'now' }), stage: 'versions', businessKey: 'place-X', revision: 1 });

test('what keeps a version from staff review: a homepage-only result, unpassed checks, a failed or unrun rendered review', () => {
  assert.deepEqual(ci.blockingProblems(job('fe_a')), []);
  assert.match(ci.blockingProblems(job('fe_a', { site: undefined, pages: [] })).join(), /homepage only/);
  assert.match(ci.blockingProblems(job('fe_a', { checks: { static: 'pending', browser: 'passed', copy: 'owner-review-required', publication: 'disabled' } })).join(), /checks have not passed/);
  assert.match(ci.blockingProblems(job('fe_a', { review: undefined })).join(), /did not run/);
  assert.match(ci.blockingProblems(job('fe_a', { review: { at: 'x', pass: false, ran: true, pages: [], problems: ['home at 390px: photo p#1: credit is clipped'] } })).join(), /credit is clipped/);
  assert.match(ci.blockingProblems(job('fe_a', { status: 'failed', error: 'Custom frontend failed after 2 attempts' })).join(), /generation failed/);
});

test('staff send a reviewed version once; the customer hears nothing about the internal review, then one link; a repeat changes nothing', async () => {
  await studioDocs.put('studio-frontend-jobs', 'fe_aaaaaaaaaaaaaaaa', job('fe_aaaaaaaaaaaaaaaa'));
  const r = run(); r.versions.push({ n: 1, requestedAt: 'x', status: 'review', jobId: 'fe_aaaaaaaaaaaaaaaa' });
  assert.deepEqual(ci.customMessages(r), [], 'no message while it waits for its final check (the review is internal)');
  assert.match(ci.statusText(r), /^Your preview is built, and I'm checking it now\. I'll send the link here when it's ready\.$/);
  const sent = await ci.staffSend(r, 1, 'tester');
  assert.equal(sent.sent, true); assert.match(sent.url!, /\/v\/fe_aaaaaaaaaaaaaaaa$/);
  assert.ok(await studioDocs.get('customer-links', 'fe_aaaaaaaaaaaaaaaa'), 'the link is served only once it was sent');
  const m = ci.customMessages(r);
  assert.equal(m.length, 1); assert.equal(m[0].url, sent.url); assert.deepEqual(m[0].quickReplies, ['Approve and publish', 'Request another version']);
  assert.deepEqual(await ci.staffSend(r, 1, 'tester'), { sent: false, reason: 'already sent', url: sent.url });
  assert.deepEqual(ci.customMessages(r), [], 'no second link');
  // approval records exactly the version shown; nothing is published
  assert.deepEqual(ci.recordApproval(r), { n: 1, jobId: 'fe_aaaaaaaaaaaaaaaa', url: sent.url!, at: r.approved!.at });
});

test('a version with a blocking problem cannot be sent, even if it was marked for review', async () => {
  await studioDocs.put('studio-frontend-jobs', 'fe_bbbbbbbbbbbbbbbb', job('fe_bbbbbbbbbbbbbbbb', { site: undefined, pages: [] }));
  const r = run(); r.versions.push({ n: 1, requestedAt: 'x', status: 'review', jobId: 'fe_bbbbbbbbbbbbbbbb' });
  const s = await ci.staffSend(r, 1, 'tester');
  assert.equal(s.sent, false); assert.match(s.reason!, /homepage only/);
  assert.equal(await studioDocs.get('customer-links', 'fe_bbbbbbbbbbbbbbbb'), undefined);
});

test('one new version at a time; a failed or rejected new version keeps the earlier preview in the reply', async () => {
  const r = run(); r.versions.push({ n: 1, requestedAt: 'x', status: 'sent', jobId: 'fe_c', url: 'http://x/v/fe_c', told: ['review', 'sent'] }); r.shown = 1;
  assert.equal(ci.requestCustomVersion(r), 'started');
  assert.equal(ci.requestCustomVersion(r), 'busy', 'a repeated request while one is being made starts nothing');
  assert.equal(r.versions.length, 2);
  r.versions[1].status = 'failed'; r.versions[1].error = 'Custom inner pages failed after 2 attempts';
  const fail = ci.customMessages(r);
  assert.equal(fail.length, 1); assert.match(fail[0].text, /^Sorry, I couldn't make another version this time\. Your current preview is still here: http:\/\/x\/v\/fe_c$/); assert.equal(fail[0].url, 'http://x/v/fe_c');
  assert.equal(ci.requestCustomVersion(r), 'started');
  r.versions[2].status = 'review'; r.versions[2].told = ['review'];
  assert.deepEqual(ci.staffReject(r, 3, 'tester', 'hero photo crops the sign'), { ok: true });
  const rej = ci.customMessages(r);
  assert.match(rej[0].text, /^I wasn't happy with how the new version came out, so I haven't sent it\. Your current preview is still here: http:\/\/x\/v\/fe_c$/);
  // approval still records the version actually shown (1), not the rejected one
  assert.equal(ci.recordApproval(r)!.n, 1);
});

test('a first version that fails tells the customer plainly and offers a retry; a failed research does too', () => {
  const r = run(); r.versions.push({ n: 1, requestedAt: 'x', status: 'failed', error: 'x' });
  assert.match(ci.customMessages(r)[0].text, /^Sorry, I couldn't finish your preview this time\. Reply "try again" and I'll build a new one\.$/);
  const f = ci.newCustomRun({ placeId: 'Y', name: 'Y', confirmedAt: 'now' }); f.stage = 'failed'; f.error = 'research failed';
  assert.match(ci.customMessages(f)[0].text, /^Sorry, I couldn't finish researching your business this time\. Reply "try again" and I'll start again\.$/);
  assert.deepEqual(ci.customMessages(f), []);
});
