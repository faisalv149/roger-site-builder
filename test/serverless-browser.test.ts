// Serverless robustness: one browser at a time in a process (two single-process Chromiums side by side crash each
// other on Vercel), the reference inspector using a fresh browser per view there, and a temporary Claude service error
// waited out instead of counted as a failed design attempt. Runs Chromium in its serverless single-process mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-serverless-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), STUDIO_SINGLE_PROCESS: '1' });
const { config } = await import('../src/config.js');
const { launchBrowser, browserGone } = await import('../src/render/og.js');
const { inspectPage } = await import('../src/studio/concepts/references.js');
const { transientError } = await import('../src/studio/concepts/ai.js');

test('temporary Claude service errors are waited out; real errors are not', () => {
  assert.equal(transientError({ status: 503, message: '503 credential validation failed' }), true);
  assert.equal(transientError({ status: 529, message: 'overloaded' }), true);
  assert.equal(transientError({ status: 429, message: 'rate limited' }), true);
  assert.equal(transientError(new Error('socket hang up')), true);
  assert.equal(transientError({ status: 400, message: 'invalid request' }), false);
  assert.equal(transientError({ status: 401, message: 'invalid x-api-key' }), false);
  assert.equal(browserGone(new Error('a desktop render: page.waitForTimeout: Target page, context or browser has been closed')), true);
  assert.equal(browserGone(new Error('net::ERR_NAME_NOT_RESOLVED')), false);
});

test('in single-process mode a second browser waits until the first is closed', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const order: string[] = [];
  const a = await launchBrowser();
  order.push('a open');
  a.on('disconnected', () => order.push('a gone'));
  const bPending = launchBrowser().then((b) => { order.push('b open'); return b; });
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(order, ['a open'], 'b waits while a is open');
  await a.close();
  const b = await bPending;
  try {
    assert.deepEqual(order, ['a open', 'a gone', 'b open'], 'b opens only after a has gone');
    // the browser still works after the wait
    const page = await (await b.newContext()).newPage();
    await page.setContent('<h1>ok</h1>');
    assert.equal(await page.textContent('h1'), 'ok');
  } finally { await b.close(); }
});

test('the reference inspector works with one single-process browser per view', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header><a href="#">Menu</a><a href="#">About</a></header><main>${[1, 2, 3, 4].map(() => `<section style="min-height:300px"><h2>Section</h2><p>${'Words about the bakery and its cakes. '.repeat(20)}</p></section>`).join('')}</main></body></html>`;
  const server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    const dir = path.join(tmp, 'out', 'refs'); fs.mkdirSync(dir, { recursive: true });
    const m = await inspectPage(base, dir, (u) => u.startsWith(base));
    assert.ok(m.desktop.textLength > 300 && m.mobile.textLength > 300, 'both views measured');
    assert.ok(fs.existsSync(path.join(tmp, 'out', m.screenshots.desktop)) && fs.existsSync(path.join(tmp, 'out', m.screenshots.mobile)));
  } finally { server.close(); }
});
