// With the beta switch off (production as it is): the old Studio, its builder and the normal simulator path work exactly
// as before; the beta's staff app routing does not apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-betaoff-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), ROGER_NO_LISTEN: '1', ROGER_BETA: '', STUDIO_PASSWORD: 'staff-secret', PUBLIC_BASE_URL: 'http://localhost:4000' });
const { default: app } = await import('../src/server.js');
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());

/** a request with exactly these headers (Node's fetch always adds Sec-Fetch-Mode: cors, so it cannot act as a page navigation) */
const raw = (url: string, headers: Record<string, string>) => new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((done, fail) => {
  http.get(url, { headers }, (r) => { r.resume(); r.on('end', () => done({ status: r.statusCode ?? 0, headers: r.headers })); }).on('error', fail);
});
const STAFF = { authorization: `Basic ${Buffer.from('roger:staff-secret').toString('base64')}` };

test('beta off: / and /app/ are the Studio; the normal simulator path answers as before; pages still ask for the password', async () => {
  assert.equal((await fetch(`${BASE}/`, { headers: STAFF, redirect: 'manual' })).headers.get('location'), '/app/');
  const studio = await fetch(`${BASE}/app/`, { headers: STAFF });
  assert.equal(studio.status, 200); assert.match(await studio.text(), /Build website/);
  assert.match(String((await raw(`${BASE}/app/`, { 'sec-fetch-mode': 'navigate', accept: 'text/html' })).headers['www-authenticate'] ?? ''), /^Basic/, 'a page still asks for the password');
  const n = await (await fetch(`${BASE}/api/imessage/inbound`, { method: 'POST', headers: { ...STAFF, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'imsg-n1', text: 'Hi', async: true }) })).json();
  assert.match(n.replies[0].text, /What's your website\? If you don't have one, send me your business name and ZIP code\./);
  assert.equal((await fetch(`${BASE}/api/conversations`, { headers: STAFF })).status, 200);
});
