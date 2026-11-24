import test from 'node:test';
import assert from 'node:assert/strict';
import { stripSeasonal } from '../src/splash/build.js';
import type { SplashCode } from '../src/splash/prompt.js';

const code = (html: string) => ({ html, css: '', idea: '', fonts: [], design_tokens: {}, meta_description: '' }) as unknown as SplashCode;

test('an undated seasonal label in the designer\'s text is removed by Roger; bound facts and dated mentions stay', () => {
  const c = code('<ul class="rk-marquee__track"><li>Sourdough</li><li>Holiday baking</li></ul><p>Fresh bread. <a data-action="order">Order</a> Christmas cookies are back.</p><p data-fact="service-1">Holiday baking</p><p>Holiday menu 2026</p>');
  const removed = stripSeasonal(c);
  assert.deepEqual(removed, ['Holiday baking', 'Christmas cookies are back.']);
  assert.ok(!c.html.includes('<li>Holiday baking</li>'), 'the label goes');
  assert.ok(c.html.includes('<li>Sourdough</li>'));
  assert.ok(c.html.includes('<a data-action="order">Order</a>'), 'an element holding an action keeps it; only the words go');
  assert.ok(c.html.includes('<p data-fact="service-1">Holiday baking</p>'), 'a bound fact is the business\'s own and is not touched');
  assert.ok(c.html.includes('Holiday menu 2026'), 'a dated mention stays');
});
