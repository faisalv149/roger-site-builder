import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildInfo, versionLabel } from '../src/version.js';

test('the repo carries the dev build: no version label, and the stamp script writes the same shape', () => {
  assert.equal(buildInfo().version, 'dev');
  assert.equal(versionLabel(), '');
  const script = fs.readFileSync(new URL('../scripts/stamp-build.ts', import.meta.url), 'utf8');
  assert.match(script, /export const BUILD = \$\{JSON\.stringify\(info\)\}/);
  assert.match(script, /\{ version, commit: commit\.slice\(0, 7\), builtAt:/);
});

test('every staff page and the iMessage page load the version badge', () => {
  for (const f of ['app/index.html', 'app/frontend.html', 'app/leads.html', 'app/review.html', 'app/brief.html', 'app/concepts.html', 'app/compare.html', 'app/imessage-reviews.html', 'imessage/index.html']) {
    assert.match(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'), /<script src="\/app\/version\.js" defer><\/script>/, f);
  }
});
