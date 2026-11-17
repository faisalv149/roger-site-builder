// A listing that still says http:// for a site that only answers over https: the brief reads the https address
// instead of failing at "identity". An http address that answers with an error, or an https one, is not retried.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-https-home-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), STUDIO_RENDER: '0' });
const { readHome } = await import('../src/studio/stages.js');

type Fetcher = NonNullable<Parameters<typeof readHome>[2]>;
const answer = (url: string, ok: boolean, status: number, error?: string) => ({
  res: { ok, status, url, redirects: [], headers: ok ? { 'content-type': 'text/html' } : {}, body: Buffer.from(ok ? '<html><head><title>Zubair Plumbing</title></head><body><h1>Zubair Plumbing</h1></body></html>' : ''), ttfbMs: 1, totalMs: 1, ...(error ? { error } : {}) },
  attempts: 3,
});
function ctxOf() {
  const notes: string[] = [];
  return { notes, ctx: { work: { pages: {} } as never, save: async () => {}, progress: () => {}, note: (t: string) => notes.push(t) } };
}

test('an http address that does not answer is read over https', async () => {
  const asked: string[] = [];
  const fetcher = (async (u: string) => { asked.push(u); return u.startsWith('https:') ? answer(u, true, 200) : answer(u, false, 0, 'fetch failed'); }) as unknown as Fetcher;
  const { ctx, notes } = ctxOf();
  const r = await readHome(ctx as never, 'http://zplumbings.online/', fetcher);
  assert.deepEqual(asked, ['http://zplumbings.online/', 'https://zplumbings.online/']);
  assert.equal(r.home, 'https://zplumbings.online/');
  assert.equal(r.page.status, 'read');
  assert.match(notes.join(' '), /https address is read/);
  // resuming the job finds the https page under the same key, with no new fetch
  const again = await readHome(ctx as never, 'http://zplumbings.online/', fetcher);
  assert.equal(again.page.status, 'read');
  assert.equal(asked.length, 2);
});

test('an http address that answers with an error, or fails both ways, keeps its own failure', async () => {
  const asked: string[] = [];
  const err404 = (async (u: string) => { asked.push(u); return answer(u, false, 404); }) as unknown as Fetcher;
  const a = await readHome(ctxOf().ctx as never, 'http://example.test/', err404);
  assert.equal(a.page.status, 'failed');
  assert.deepEqual(asked, ['http://example.test/'], 'an HTTP answer is not retried over https');

  asked.length = 0;
  const down = (async (u: string) => { asked.push(u); return answer(u, false, 0, 'fetch failed'); }) as unknown as Fetcher;
  const { ctx } = ctxOf();
  const b = await readHome(ctx as never, 'http://down.test/', down);
  assert.equal(b.page.status, 'failed');
  assert.equal(b.home, 'http://down.test/');
  assert.equal(b.page.url, 'http://down.test/', 'the original failure is what is reported');
  assert.deepEqual(asked, ['http://down.test/', 'https://down.test/']);

  asked.length = 0;
  await readHome(ctxOf().ctx as never, 'https://secure-down.test/', down);
  assert.deepEqual(asked, ['https://secure-down.test/'], 'an https address is not retried');
});
