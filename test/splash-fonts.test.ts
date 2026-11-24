// A splash page's fonts served by Roger: Google's stylesheet read (latin and latin-ext only, a variable font as one
// face), the WOFF2 files kept once, @font-face rules with swap and a preload, and no request to Google from the page.
// Synthetic stylesheet and font bytes: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-splash-fonts-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { parseFaces, selfHostFonts, fontFaceCss, fontFile } = await import('../src/splash/fonts.js');
import type { FetchResult } from '../src/util/http.js';

const face = (subset: string, weight: number, file: string, style = 'normal') => `/* ${subset} */\n@font-face {\n  font-family: 'Test Sans';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/testsans/v1/${file}.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131;\n}\n`;
const CSS = [400, 500, 700].flatMap((w) => [face('cyrillic', w, 'cyr'), face('latin-ext', w, 'ext'), face('latin', w, 'lat')]).join('') + face('latin', 400, 'lat-italic', 'italic');
const res = (body: Buffer | string, over: Partial<FetchResult> = {}): FetchResult => ({ ok: true, status: 200, url: '', redirects: [], headers: {}, body: Buffer.isBuffer(body) ? body : Buffer.from(body), ttfbMs: 1, totalMs: 1, ...over });
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 1)]);

test('Google\'s stylesheet: latin and latin-ext faces only; a variable font\'s repeated file is one face for its range', () => {
  const faces = parseFaces(CSS, 'Test Sans');
  assert.deepEqual(faces.map((f) => `${f.subset}/${f.style}/${f.weight}`), ['latin-ext/normal/400 700', 'latin/normal/400 700', 'latin/italic/400']);
  assert.equal(faces[1].unicodeRange, 'U+0000-00FF, U+0131');
  assert.equal(parseFaces(CSS.replace(/fonts\.gstatic\.com/g, 'evil.example'), 'Test Sans').length, 0, 'font files only from Google\'s font host');
});

test('fonts kept once and served as WOFF2; a family Google does not have is reported; the page\'s rules and preload', async () => {
  const asked: string[] = [];
  const fetch = async (u: string) => { asked.push(u); return /googleapis/.test(u) ? (/Missing/.test(u) ? res('<html>', { ok: false, status: 400 }) : res(CSS)) : res(WOFF2, { url: u }); };
  const a = await selfHostFonts(['Test Sans', 'Missing Font'], { fetch });
  assert.deepEqual(a.missing, ['Missing Font']);
  assert.equal(a.faces.length, 3);
  assert.equal(asked.filter((u) => /gstatic/.test(u)).length, 3, 'three files');
  assert.deepEqual(await fontFile(a.faces[0].key), WOFF2);
  await selfHostFonts(['Test Sans'], { fetch });
  assert.equal(asked.filter((u) => /gstatic/.test(u)).length, 3, 'kept: not fetched again');
  assert.equal(await fontFile('../../etc/passwd'), undefined);
  const f = fontFaceCss(a.faces, 'https://roger.example');
  assert.match(f.css, /@font-face\{font-family:'Test Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url\(https:\/\/roger\.example\/api\/splash\/fonts\/[a-f0-9]{24}\.woff2\) format\('woff2'\);unicode-range:U\+0000-00FF, U\+0131\}/);
  assert.equal(f.preload, `https://roger.example/api/splash/fonts/${a.faces[1].key}.woff2`, 'the latin normal face');
  // a file that is not a font is not kept
  const bad = await selfHostFonts(['Test Sans'], { fetch: async (u) => /googleapis/.test(u) ? res(CSS.replace(/v1/g, 'v2')) : res('<html>not a font</html>', { url: u }) });
  assert.deepEqual(bad.missing, ['Test Sans']);
});
