// In-memory Supabase stand-in. No network, credentials, designs or existing records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-photo-remote-'));
Object.assign(process.env, { MOCK: '1', REMOTE_STORAGE: '1', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '' });
const calls: { url: string; method: string; body: any }[] = [];
const name = 'places/SyntheticPlace/photos/ResourceNeverStored';
const files = new Map<string, Buffer>();
const docs = new Map<string, any>();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: RequestInit) => {
  const url = new URL(String(input));
  assert.equal(url.host, 'synthetic.invalid', 'no real service may be called');
  let body: any = init?.body;
  if (typeof body === 'string') body = JSON.parse(body);
  const method = init?.method ?? 'GET'; calls.push({ url: url.pathname, method, body });
  if (url.pathname === '/rest/v1/roger_docs') {
    if (method === 'POST') { docs.set(body.collection, body.data); return Response.json({}); }
    const col = url.searchParams.get('collection')?.slice(3)!;
    return Response.json(docs.has(col) ? [{ data: docs.get(col) }] : []);
  }
  if (url.pathname === '/storage/v1/bucket') return Response.json({});
  if (url.pathname === '/storage/v1/object/list/roger') {
    return Response.json(body.prefix === '' ? [{ name: 'sites', id: null }] : body.prefix === 'sites' ? [...files.keys()].filter((k) => k.startsWith('sites/')).map((k) => ({ name: k.slice(6), id: 'file' })) : []);
  }
  const read = '/storage/v1/object/authenticated/roger/';
  if (url.pathname.startsWith(read)) return new Response(new Uint8Array(files.get(url.pathname.slice(read.length))!));
  const write = '/storage/v1/object/roger/';
  if (url.pathname.startsWith(write) && method === 'POST') { files.set(url.pathname.slice(write.length), Buffer.from(body)); return Response.json({}); }
  throw new Error(`Unexpected operation: ${method} ${url.pathname}`);
};
const { studioDocs } = await import('../src/store.js');
const { persistDir } = await import('../src/files.js');
const { auditGooglePhotoNames } = await import('../src/maintenance/google-names-audit.js');
test.after(() => { globalThis.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

test('remote document and file writes sanitize before upload', async () => {
  await studioDocs.put('studio-snapshots', 'snapshot', { photos: [{ ref: name }] });
  assert.ok(!JSON.stringify(docs.get('studio-snapshots')).includes('ResourceNeverStored'));
  const dir = path.join(tmp, 'out', 'sites'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'page.html'), name);
  await persistDir(dir);
  assert.ok(!files.get('sites/page.html')!.toString().includes('ResourceNeverStored'));
  assert.equal(fs.readFileSync(path.join(dir, 'page.html'), 'utf8'), name, 'upload does not clean up an existing local record');
});

test('dry-run includes remote-only files and collections without any storage mutation', async () => {
  docs.set('conversations', { id: 'old', candidate: { photoRef: name } });
  files.set('sites/old.html', Buffer.from(name));
  const before = JSON.stringify({ docs: [...docs], files: [...files].map(([k, v]) => [k, v.toString()]) });
  calls.length = 0;
  const report = await auditGooglePhotoNames();
  assert.equal(report.store.find((r) => r.where === 'conversations')?.affected, 1);
  assert.equal(report.files.find((r) => r.where === 'remote files (supabase)')?.affected, 1);
  assert.ok(calls.every((c) => c.method === 'GET' || c.url === '/storage/v1/object/list/roger'), 'only read endpoints, never create bucket/upload/upsert/delete');
  assert.equal(JSON.stringify({ docs: [...docs], files: [...files].map(([k, v]) => [k, v.toString()]) }), before);
});
