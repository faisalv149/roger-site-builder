// Local saves on Windows: a document is written to its own temp file and renamed over the old one. While another
// process holds the target (an antivirus or indexer scan), Windows refuses the rename with EPERM for a moment: the save
// waits and retries instead of failing the job. Other errors still fail at once, without leaving a temp file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-store-'));
Object.assign(process.env, { MOCK: '1', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { replaceFile, studioDocs } = await import('../src/store.js');

test('a target held for a moment is waited for, then replaced', { skip: process.platform !== 'win32' && 'Windows only (a held target is refused with EPERM there)' }, async () => {
  const file = path.join(tmp, 'doc.json');
  // a directory in the target's place stands in for a file another process holds: renaming onto it is refused (EPERM)
  fs.mkdirSync(file); fs.writeFileSync(path.join(file, 'x'), '');
  assert.throws(() => fs.renameSync(path.join(tmp, 'nothing'), file));
  fs.writeFileSync(`${file}.1.tmp`, '{"v":2}');
  setTimeout(() => fs.rmSync(file, { recursive: true, force: true }), 60); // released after 60 ms
  await replaceFile(`${file}.1.tmp`, file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":2}');
  assert.ok(!fs.existsSync(`${file}.1.tmp`));
});

test('a target held too long, or any other error, fails without leaving a temp file', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const file = path.join(tmp, 'held.json');
  fs.mkdirSync(file); fs.writeFileSync(path.join(file, 'x'), '');
  fs.writeFileSync(`${file}.2.tmp`, '{}');
  await assert.rejects(replaceFile(`${file}.2.tmp`, file, [5, 5]), (e: NodeJS.ErrnoException) => ['EPERM', 'EACCES', 'EBUSY'].includes(e.code ?? ''));
  assert.ok(!fs.existsSync(`${file}.2.tmp`), 'the temp file is removed');
  await assert.rejects(replaceFile(path.join(tmp, 'missing.tmp'), path.join(tmp, 'x.json')), /ENOENT/);
});

test('many saves of one document in a row all land, and leave no temp files', async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => studioDocs.put('studio-work', 'sj_test', { n: i })));
  const dir = path.join(tmp, 'data', 'studio-work');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  assert.equal(typeof (await studioDocs.get<{ n: number }>('studio-work', 'sj_test'))!.n, 'number');
});
