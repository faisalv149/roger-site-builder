// The invite-only beta's routes and access control, against the real server (in-process, on a free port) with a staff
// password, a public HTTPS origin and the beta on. Customer links use the Sugar Mama's version that was already sent
// (copied into this test's own data folder; nothing is paid for). Covered: /v/ pages (home, every inner page, refresh,
// direct navigation, the old sent link), link previews from the public origin only, unsent and rejected versions closed,
// staff authentication on every review page and action, invited testers limited to their own conversation, the Studio
// and simulator links, the normal /imessage/ path, and one link delivered however often staff click or the page polls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
const REAL = path.resolve('data');
const SUGAR = 'fe_64c456736e7b4c45', SUGAR_V2 = 'fe_8d8d82b0be8444d2';
const have = [SUGAR, SUGAR_V2].every((id) => fs.existsSync(path.join(REAL, 'studio-frontend-jobs', `${id}.json`)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-beta-'));
const DATA = path.join(tmp, 'data');
if (have) {
  for (const [col, id] of [['studio-frontend-jobs', SUGAR], ['studio-frontend-jobs', SUGAR_V2], ['customer-links', SUGAR]]) {
    fs.mkdirSync(path.join(DATA, col), { recursive: true });
    const f = fs.readdirSync(path.join(REAL, col)).find((x) => x.startsWith(id));
    if (f) fs.copyFileSync(path.join(REAL, col, f), path.join(DATA, col, f));
  }
}
const ORIGIN = 'https://beta.example.test';
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: DATA, OUT_DIR: path.join(tmp, 'out'), ROGER_NO_LISTEN: '1', ROGER_BETA: '1', ROGER_PUBLIC_ORIGIN: ORIGIN, STUDIO_PASSWORD: 'staff-secret', PUBLIC_BASE_URL: 'http://localhost:4000' });
const { default: app } = await import('../src/server.js');
const { createInvite } = await import('../src/beta.js');
const { saveConversation, getConversation, studioDocs } = await import('../src/store.js');
const { advanceAllCustom } = await import('../src/imessage/flow.js');
const { screenshotsAvailable } = await import('../src/render/og.js');
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());
const STAFF = { authorization: `Basic ${Buffer.from('roger:staff-secret').toString('base64')}` };
const get = (p: string, headers: Record<string, string> = {}) => fetch(BASE + p, { headers, redirect: 'manual' });
const post = (p: string, body: unknown, headers: Record<string, string> = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'manual' });
const skip = have ? false : 'the sent Sugar Mama\'s version is not on this machine';
/** a request with exactly these headers (Node's fetch always adds Sec-Fetch-Mode: cors, so it cannot act as a page navigation) */
const raw = (url: string, headers: Record<string, string>) => new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((done, fail) => {
  http.get(url, { headers }, (r) => { r.resume(); r.on('end', () => done({ status: r.statusCode ?? 0, headers: r.headers })); }).on('error', fail);
});


test('/v/: the sent version, its home and every inner page, refresh and direct navigation, and the old sent link', { skip }, async () => {
  const home = await get(`/v/${SUGAR}`);
  assert.equal(home.status, 200);
  const html = await home.text();
  const links = [...new Set([...html.matchAll(/href="(\/v\/[^"#]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(links.sort(), [`/v/${SUGAR}`, `/v/${SUGAR}/about`, `/v/${SUGAR}/photos`, `/v/${SUGAR}/visit`].sort(), 'navigation stays on this version');
  for (const l of links) {
    const a = await get(l), b = await get(l); // direct navigation, then a refresh
    assert.equal(a.status, 200, l); const ta = await a.text(); assert.equal(ta, await b.text(), `${l}: the same page every time`);
    assert.doesNotMatch(ta, /localhost|127\.0\.0\.1|\/api\/studio\//, `${l}: no internal host or staff URL`);
    assert.match(ta, new RegExp(`<meta name="roger-version" content="${SUGAR}">`));
  }
  // the link the customer was actually sent (an old localhost link): the same path still opens the same version
  const sent = JSON.parse(fs.readFileSync(path.join(REAL, 'customer-links', `${SUGAR}.json`), 'utf8'));
  assert.equal(sent.jobId, SUGAR);
  assert.equal((await get(new URL(`http://localhost:4000/v/${SUGAR}`).pathname)).status, 200);
  assert.equal((await get(`/v/${SUGAR}/nope`)).status, 404);
});

test('link previews: a meaningful title and image, from the public HTTPS origin only', { skip }, async () => {
  const html = await (await get(`/v/${SUGAR}/about`)).text();
  assert.match(html, /<meta property="og:title" content="Sugar Mama&#39;s Bakeshop · website preview">|<meta property="og:title" content="Sugar Mama's Bakeshop · website preview">/);
  assert.match(html, new RegExp(`<meta property="og:url" content="${ORIGIN}/v/${SUGAR}/about">`));
  assert.match(html, new RegExp(`<meta property="og:image" content="${ORIGIN}/v/${SUGAR}/preview.png">`));
  if (screenshotsAvailable()) {
    const png = await get(`/v/${SUGAR}/preview.png`);
    assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png');
    assert.ok((await png.arrayBuffer()).byteLength > 10_000);
  }
});

test('unsent and rejected versions stay closed to customers', { skip }, async () => {
  assert.equal((await get(`/v/${SUGAR_V2}`)).status, 404, 'the rejected version 2 was never sent');
  assert.equal((await get(`/v/${SUGAR_V2}/preview.png`)).status, 404);
  assert.equal((await get('/v/fe_0000000000000000')).status, 404);
  assert.equal((await get(`/api/studio/frontend-jobs/${SUGAR_V2}/preview`)).status, 401, 'the staff preview needs staff authentication');
});

test('staff authentication on the review page and every review, send, reject, check and invite action', async () => {
  for (const p of ['/app/imessage-reviews.html', '/app/imessage-reviews.js', '/api/studio/imessage-reviews', '/api/studio/beta-invites']) assert.equal((await get(p)).status, 401, p);
  assert.equal((await get('/app/')).headers.get('location'), '/app/frontend.html', '/app/ is the beta staff app (New site)');
  for (const p of ['/app/frontend.html', '/api/studio/businesses', '/api/studio/frontend-jobs/fe_0000000000000000']) assert.equal((await get(p)).status, 401, `${p} needs staff`);
  assert.match(await (await get('/api/studio/imessage-reviews')).text(), /Staff authentication is required/, 'an API refusal is plain (no browser password box)');
  assert.equal((await get('/api/studio/imessage-reviews')).headers.get('www-authenticate'), null);
  for (const d of ['send', 'reject', 'recheck', 'resume']) assert.equal((await post(`/api/studio/imessage-reviews/someone/1/${d}`, {})).status, 401, d);
  assert.equal((await post('/api/studio/beta-invites', { label: 'x' })).status, 401);
  assert.equal((await get('/app/imessage-reviews.html', STAFF)).status, 200);
  assert.equal((await get('/api/studio/imessage-reviews', STAFF)).status, 200);
  assert.deepEqual(await (await get('/api/staff/me')).json(), { staff: false });
  assert.deepEqual(await (await get('/api/staff/me', STAFF)).json(), { staff: true });
  const inv = await (await post('/api/studio/beta-invites', { label: 'Tester A' }, STAFF)).json();
  assert.match(inv.url, new RegExp(`^${ORIGIN}/imessage/\\?intake=custom&invite=[A-Za-z0-9_-]{30,}$`), 'the invite link uses the public origin');
});

test('invited testers: the custom simulator and their own conversation only, never staff pages or other conversations', async () => {
  const { token } = await createInvite('Tester B');
  const { token: other } = await createInvite('Tester C');
  assert.equal((await get('/imessage/')).status, 200, 'the simulator page itself');
  const hi = await post('/api/imessage/inbound', { from: 'imsg-b1', text: 'Hi', async: true, intake: 'custom', invite: token });
  assert.equal(hi.status, 200);
  assert.match((await hi.json()).replies[0].text, /What's your business called, and where is it\?/);
  // without the invite, or without the custom intake, or with a revoked or wrong token: no access
  assert.equal((await post('/api/imessage/inbound', { from: 'imsg-x', text: 'Hi', async: true, intake: 'custom' })).status, 401);
  assert.equal((await post('/api/imessage/inbound', { from: 'imsg-x', text: 'Hi', async: true, invite: token })).status, 404, 'the normal (paid) builder is not part of the beta');
  assert.equal((await post('/api/imessage/inbound', { from: 'imsg-x', text: 'Hi', async: true, intake: 'custom', invite: 'not-a-real-token-at-all-xxxxxx' })).status, 401);
  // their own conversation, with the invite; not another tester's
  assert.equal((await get('/api/conversations/imsg-b1', { 'x-roger-invite': token })).status, 200);
  assert.equal((await get('/api/conversations/imsg-b1', { 'x-roger-invite': other })).status, 401);
  assert.equal((await get('/api/conversations/imsg-b1')).status, 401);
  assert.equal((await post('/api/imessage/inbound', { from: 'imsg-b1', text: 'Hi', async: true, intake: 'custom', invite: other })).status, 403, 'a conversation belongs to one invite');
  // no staff page or API with an invite
  for (const p of ['/api/studio/imessage-reviews', '/app/imessage-reviews.html']) assert.equal((await get(p, { 'x-roger-invite': token })).status, 401, p);
  for (const p of ['/api/conversations', '/app/index.html.bak', '/api/build', '/api/themes']) assert.equal((await get(p, { 'x-roger-invite': token })).status, 404, p);
  const conv = await (await get('/api/conversations/imsg-b1', { 'x-roger-invite': token })).json();
  assert.equal(conv.session, undefined, 'no flow internals');
});

test('beta: the staff app (New site, Reviews, Invites) replaces the old Studio; the old builder and its APIs are off', async () => {
  const studio = fs.readFileSync(path.resolve('public/app/index.html'), 'utf8');
  assert.match(studio, /href="\/imessage\/\?intake=custom"/);
  assert.match(studio, /href="\/imessage\/"/, 'the normal simulator entry is still there');
  const sim = fs.readFileSync(path.resolve('public/imessage/index.html'), 'utf8');
  assert.match(sim, /<a class="btn ghost" href="\/app\/" id="openStudio" hidden>Open Studio<\/a>/, 'Open Studio goes to /app/ and shows for staff only');
  assert.match(fs.readFileSync(path.resolve('public/imessage/imessage.js'), 'utf8'), /href="\/app\/imessage-reviews\.html"/);
  assert.equal((await get('/', STAFF)).headers.get('location'), '/app/frontend.html');
  for (const p of ['/app/studio.js', '/app/index.js', '/api/conversations', '/api/builds/x', '/api/studio/briefs', '/api/studio/concept-jobs']) assert.equal((await get(p, STAFF)).status, 404, p);
  // the New site page and the APIs it uses
  const page = await (await get('/app/frontend.html', STAFF)).text();
  assert.match(page, /<title>Roger · New site<\/title>/); assert.match(page, /href="\/app\/imessage-reviews\.html">Reviews/);
  assert.equal((await get('/api/studio/businesses', STAFF)).status, 200);
  assert.equal((await get('/api/studio/frontend-jobs/fe_0000000000000000', STAFF)).status, 404, 'its API answers (no such job)');
  // the normal simulator flow is not part of the beta, even for staff
  assert.equal((await post('/api/imessage/inbound', { from: 'imsg-n1', text: 'Hi', async: true }, STAFF)).status, 404);
  const app = await (await get('/app/imessage-reviews.html', STAFF)).text();
  assert.match(app, /href="\/imessage\/\?intake=custom"/); assert.match(app, /id="invites"/);
});

test('one link to the customer however often staff click send or the server and page poll at once', { skip }, async () => {
  const id = 'fe_dupsend000000001';
  const job = JSON.parse(fs.readFileSync(path.join(DATA, 'studio-frontend-jobs', `${SUGAR}.json`), 'utf8'));
  await studioDocs.put('studio-frontend-jobs', id, { ...job, id });
  const now = new Date().toISOString();
  await saveConversation({ from: 'imsg-dup1', startedAt: now, updatedAt: now, messages: [], buildIds: [], business: "Sugar Mama's Bakeshop", session: { state: 'building', candidates: [], idx: 0, intakeMode: 'custom', custom: { id: 'ci_dup', mode: 'custom', placeId: 'p', name: "Sugar Mama's Bakeshop", confirmedAt: now, stage: 'versions', businessKey: 'k', revision: 1, versions: [{ n: 1, requestedAt: now, status: 'review', jobId: id, told: ['review'] }], startedAt: now } } } as never);
  const sends = await Promise.all([1, 2, 3].map(() => post('/api/studio/imessage-reviews/imsg-dup1/1/send', {}, STAFF).then((r) => r.json())));
  assert.equal(sends.filter((r) => r.ok).length, 1, JSON.stringify(sends));
  assert.ok(sends.filter((r) => !r.ok).every((r) => r.reason === 'already sent'));
  assert.equal(sends.find((r) => r.ok).url, `${ORIGIN}/v/${id}`, 'the customer link uses the public HTTPS origin');
  await Promise.all([advanceAllCustom(), get('/api/conversations/imsg-dup1', STAFF), advanceAllCustom()]);
  const links = (await getConversation('imsg-dup1'))!.messages.filter((m) => m.dir === 'out' && m.url);
  assert.equal(links.length, 1, 'one link message');
  assert.equal(links[0].url, `${ORIGIN}/v/${id}`);
  assert.equal((links[0] as { title?: string }).title, "Sugar Mama's Bakeshop · website preview");
  assert.equal((await get(`/v/${id}`)).status, 200);
});

test('opening a staff page asks for the password (staff preview links too); a page script calling the API is refused plainly', async () => {
  const nav = await raw(`${BASE}/api/studio/frontend-jobs/fe_0000000000000000/preview`, { 'sec-fetch-mode': 'navigate', accept: 'text/html' });
  assert.equal(nav.status, 401); assert.match(String(nav.headers['www-authenticate'] ?? ''), /^Basic/);
  const call = await get('/api/studio/imessage-reviews', { 'sec-fetch-mode': 'cors', accept: '*/*' });
  assert.equal(call.status, 401); assert.equal(call.headers.get('www-authenticate'), null);
});
