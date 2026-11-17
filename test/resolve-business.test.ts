// Business name and address inputs → one confirmed Google place ID (Roger's existing lookup), then the Google-only open
// design flow. Name, name + ZIP, name + address and the place ID itself resolve to the same business; several matches
// mean the user chooses; a ZIP, street or town alone is never a confirmed business. Synthetic businesses only (no
// Google content in the repository); the search is stubbed, so nothing is fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-resolve-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
delete process.env.ROGER_INTAKE_CONCEPTS;
const { resolveBusiness, parseBusinessInput, locationOnly } = await import('../src/studio/resolve-business.js');
const { newIntake, advanceIntake } = await import('../src/imessage/intake.js');
const { studioDocs } = await import('../src/store.js');

type Candidate = { placeId: string; name: string; address: string; types: string[] };
const CORNER: Candidate = { placeId: 'ChIJcorner000000000001', name: 'Corner Taqueria', address: '12 Oak St, Austin, TX 78702, USA', types: ['restaurant'] };
const CORNER_NORTH: Candidate = { placeId: 'ChIJcorner000000000002', name: 'Corner Taqueria', address: '880 Lamar Blvd, Austin, TX 78756, USA', types: ['restaurant'] };
const NEIGHBOUR: Candidate = { placeId: 'ChIJneighbour000000003', name: 'Oak Street Laundry', address: '14 Oak St, Austin, TX 78702, USA', types: ['laundry'] };
/** Google as the stub sees it: what a text search for each input returns (businesses only, as searchCandidates gives them) */
function stub(results: Record<string, Candidate[]>) {
  const calls: string[] = [];
  const search = async (q: string) => {
    calls.push(q);
    if (/^ChIJ[\w-]+$/.test(q)) { const c = [CORNER, CORNER_NORTH, NEIGHBOUR].find((x) => x.placeId === q); return { intent: { kind: 'placeId', placeId: q }, candidates: c ? [c] : [], rejected: [] }; }
    return { intent: { kind: 'text', query: q }, candidates: results[q] ?? [], rejected: [] };
  };
  return { search: search as never, calls };
}
const GOOGLE = {
  'Corner Taqueria': [CORNER, CORNER_NORTH],
  'Corner Taqueria 78702': [CORNER, CORNER_NORTH],
  'Corner Taqueria, 12 Oak St, Austin, TX 78702': [CORNER, NEIGHBOUR],
  '12 Oak St, Austin, TX 78702': [CORNER, NEIGHBOUR],
  '78702': [],
  'Austin, TX': [],
  'Corner Taqueria, 99 Elm St, Austin, TX 78702': [CORNER],
};

test('the input is read as a name and an address; a ZIP, a street or a town alone is only a place', () => {
  assert.deepEqual(parseBusinessInput({ text: 'Corner Taqueria, 12 Oak St, Austin, TX 78702' }), { name: 'Corner Taqueria', address: '12 Oak St, Austin, TX 78702', zip: '78702', streetNumber: '12', query: 'Corner Taqueria, 12 Oak St, Austin, TX 78702', locationOnly: false });
  assert.equal(parseBusinessInput({ text: 'Corner Taqueria 78702' }).name, 'Corner Taqueria');
  assert.equal(parseBusinessInput({ text: 'Corner Taqueria 78702' }).zip, '78702');
  assert.equal(parseBusinessInput({ text: 'Corner Taqueria 12 Oak St Austin TX' }).name, 'Corner Taqueria');
  assert.equal(parseBusinessInput({ name: 'Corner Taqueria', address: '12 Oak St, Austin, TX 78702' }).query, 'Corner Taqueria, 12 Oak St, Austin, TX 78702');
  for (const place of ['78702', '78702-1234', '12 Oak St, Austin, TX 78702', '3409 E 5th St', 'Austin, TX', 'Austin, TX 78702']) assert.ok(locationOnly(place), place);
  for (const business of ['Corner Taqueria', 'Corner Taqueria 78702', 'Corner Taqueria, 12 Oak St, Austin, TX 78702']) assert.ok(!locationOnly(business), business);
  assert.equal(parseBusinessInput({ address: '78702' }).locationOnly, true, 'an address field with no name');
});

test('name + address, name + ZIP, separate fields and the place ID all resolve to the same business', async () => {
  const { search } = stub(GOOGLE);
  const ids = new Set<string>();
  for (const input of [{ text: 'Corner Taqueria, 12 Oak St, Austin, TX 78702' }, { text: 'Corner Taqueria 78702' }, { name: 'Corner Taqueria', address: '12 Oak St, Austin, TX 78702' }, { placeId: CORNER.placeId }]) {
    const r = await resolveBusiness(input, { search });
    assert.equal(r.status, 'confirmed', JSON.stringify(input));
    if (r.status === 'confirmed') ids.add(r.placeId);
  }
  assert.deepEqual([...ids], [CORNER.placeId], 'one business, whichever way it was given');
  const r = await resolveBusiness({ text: 'Corner Taqueria, 12 Oak St, Austin, TX 78702' }, { search });
  assert.equal(r.status === 'confirmed' && r.via, 'name-and-address');
  assert.match(r.status === 'confirmed' ? r.evidence[0] : '', /only Google business named "Corner Taqueria" at the address given \(ZIP 78702, street number 12\)/);
});

test('several businesses match: the user chooses (never the first by default)', async () => {
  const { search } = stub(GOOGLE);
  const r = await resolveBusiness({ text: 'Corner Taqueria' }, { search });
  assert.equal(r.status, 'choose');
  assert.deepEqual(r.status === 'choose' ? r.candidates.map((c) => c.placeId) : [], [CORNER.placeId, CORNER_NORTH.placeId]);
  assert.match(r.status === 'choose' ? r.reason : '', /2 businesses match/);
  // the name matches but the address does not: choose (or correct it), never confirmed
  const wrong = await resolveBusiness({ text: 'Corner Taqueria, 99 Elm St, Austin, TX 78702' }, { search });
  assert.equal(wrong.status, 'choose');
  assert.match(wrong.status === 'choose' ? wrong.reason : '', /not at the address given|is at the address given/);
});

test('a ZIP, a street address or a town alone is never a confirmed business', async () => {
  const { search } = stub(GOOGLE);
  const street = await resolveBusiness({ text: '12 Oak St, Austin, TX 78702' }, { search });
  assert.equal(street.status, 'need-name');
  assert.deepEqual('candidates' in street ? street.candidates.map((c) => c.placeId) : [], [CORNER.placeId, NEIGHBOUR.placeId], 'the businesses at that address are offered to choose from');
  const onlyOne = await resolveBusiness({ address: '12 Oak St, Austin, TX 78702' }, { search: stub({ '12 Oak St, Austin, TX 78702': [CORNER] }).search });
  assert.equal(onlyOne.status, 'need-name', 'even one business at the address is not confirmed by the address alone');
  for (const text of ['78702', 'Austin, TX']) {
    const r = await resolveBusiness({ text }, { search });
    assert.equal(r.status, 'need-name', text);
    assert.match('reason' in r ? r.reason : '', /is an address, not a business/);
  }
  assert.equal((await resolveBusiness({ text: 'Nowhere Diner' }, { search })).status, 'not-found');
});

// ── the handoff to the Google-only open design flow ──
const t = (s: number) => new Date(Date.UTC(2026, 10, 15, 10, 0, s)).toISOString();
async function plantGoogleOnly(key: string, sets: { id: string; checks: { id: string; level: string }[]; created: number }[]) {
  await studioDocs.put('studio-index', key, { businessKey: key, latest: 1, revisions: [] });
  await studioDocs.put('studio-briefs', `${key}--r1`, { businessKey: key, revision: 1, briefHash: 'h', identity: { website: { value: null } } });
  for (const s of sets) {
    await studioDocs.put('studio-concept-sets', s.id, { id: s.id, brief: { businessKey: key, revision: 1, briefHash: 'h' }, reviewId: 'rv', concepts: [{ id: 'a', name: 'Open design', designSpecId: `ds_${s.id}`, checks: s.checks }] });
    await studioDocs.put('studio-concept-jobs', `cj_${s.id}`, { id: `cj_${s.id}`, createdAt: t(s.created), updatedAt: t(s.created), status: 'done', input: { businessKey: key, revision: 1, reviewId: 'rv', planner: 'open' }, setId: s.id, stages: [], work: { calls: [], designSpecId: `ds_${s.id}`, design: { id: `ds_${s.id}`, source: 'ai', attempts: 1, strategy: 'none saved', fallback: null, rejected: [] } }, resumes: 0 });
  }
}

test('no website: the intake goes from the saved brief straight to the open design (no reference research) and reuses only a set that passed', async () => {
  // the newest saved set failed the required photo check (made before it failed jobs); an older one passed
  await plantGoogleOnly('place-ChIJgoogleonly00001', [
    { id: 'cs_good', checks: [{ id: 'photos', level: 'pass' }, { id: 'facts', level: 'pass' }], created: 10 },
    { id: 'cs_nophotos', checks: [{ id: 'photos', level: 'fail' }], created: 20 },
  ]);
  const run = newIntake({ placeId: 'ChIJgoogleonly00001' }, 'open');
  await advanceIntake(run);
  assert.equal(run.timings.brief?.reused, true, 'the saved brief');
  assert.equal(run.referenceJobId, undefined, 'no reference job started');
  assert.deepEqual(run.timings.references?.steps, [{ name: 'no website: designed from the Google listing, no reference research', ms: 0, status: 'skipped' }]);
  assert.equal(run.conceptJobId, 'cj_cs_good', 'the set that passed, not the newer one that showed no photos');
  assert.equal(run.timings.concepts?.reused, true);
  assert.equal(run.stage, 'site');
});

test('no website and no passing saved set: a new open design is started for the confirmed listing', async () => {
  await plantGoogleOnly('place-ChIJgoogleonly00002', [{ id: 'cs_failed', checks: [{ id: 'facts', level: 'fail' }], created: 10 }]);
  const run = newIntake({ placeId: 'ChIJgoogleonly00002' }, 'open');
  await advanceIntake(run);
  assert.equal(run.referenceJobId, undefined);
  assert.ok(run.conceptJobId && run.conceptJobId !== 'cj_cs_failed', 'a new concept job');
  const job = await studioDocs.get<{ input: { planner?: string; referenceJobId?: string } }>('studio-concept-jobs', run.conceptJobId!);
  assert.equal(job?.input.planner, 'open');
  assert.equal(job?.input.referenceJobId, undefined);
});

// ── the conversation (the open intake, test-only): the owner confirms or chooses the listing the intake designs from ──
const { handleInbound } = await import('../src/imessage/flow.js');
const chat = (from: string) => async (t: string) => (await handleInbound(from, t, { intake: 'open' })).replies.map((x) => x.text).join('\n');

test('open intake: one matching business is offered to confirm; several are offered to choose from, one at a time', async () => {
  const one = chat('open-one');
  await one('hi');
  assert.match(await one('Larkspur Plumbing 53703'), /^Is this you\?\nLarkspur Plumbing/);
  const several = chat('open-several');
  await several('hi');
  const first = await several('Juniper');
  assert.match(first, /^I found 2 businesses that match\. Let's find yours\.\nIs this you\?\nJuniper/);
  const second = await several('No, not us');
  assert.match(second, /^How about this one\?\nJuniper/);
  assert.notEqual(first.split('\n')[2], second.split('\n')[1], 'the other one');
});

test('open intake: a ZIP or a street address alone is never taken as the business', async () => {
  const street = chat('open-street');
  await street('hi');
  const r = await street('25 W Main St, Madison, WI 53703');
  assert.match(r, /^That's an address, so I looked for the businesses there(?: and found \d+)?\.\nIs this you\?\nLarkspur Plumbing/, 'offered to confirm, not assumed');
  const none = chat('open-zip');
  await none('hi');
  assert.match(await none('99999'), /That looks like an address, not a business name\. What's the business called\?/);
});
