import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSpeed, parsePsi } from '../src/audit/pagespeed.js';

// A trimmed PageSpeed Insights v5 response (Lighthouse 13 shape): one failing check per category, metrics, field data.
const sample = {
  id: 'https://example.test/',
  loadingExperience: { overall_category: 'SLOW', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4100, category: 'SLOW' }, INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: 'AVERAGE' } } },
  lighthouseResult: {
    lighthouseVersion: '13.6.0', finalDisplayedUrl: 'https://example.test/', fetchTime: '2026-11-02T10:00:00.000Z', runWarnings: [],
    categories: {
      performance: { score: 0.42, auditRefs: [{ id: 'largest-contentful-paint', weight: 25, group: 'metrics' }, { id: 'image-delivery-insight', weight: 0, group: 'insights' }, { id: 'render-blocking-insight', weight: 0, group: 'insights' }, { id: 'bf-cache', weight: 0, group: 'diagnostics' }] },
      accessibility: { score: 0.81, auditRefs: [{ id: 'color-contrast', weight: 7, group: 'a11y-color-contrast' }, { id: 'html-has-lang', weight: 7, group: 'a11y-language' }, { id: 'manual-check', weight: 0 }] },
      'best-practices': { score: 1, auditRefs: [{ id: 'errors-in-console', weight: 1, group: 'best-practices-general' }] },
      seo: { score: 0.83, auditRefs: [{ id: 'meta-description', weight: 1, group: 'seo-content' }, { id: 'link-text', weight: 1, group: 'seo-content' }] },
    },
    audits: {
      'largest-contentful-paint': { score: 0.1, displayValue: '6.2 s', numericValue: 6200, scoreDisplayMode: 'numeric' },
      'cumulative-layout-shift': { score: 0.5, displayValue: '0.31', numericValue: 0.3123, scoreDisplayMode: 'numeric' },
      'image-delivery-insight': { title: 'Improve image delivery', score: 0, scoreDisplayMode: 'metricSavings', displayValue: 'Est savings of 1,240 KiB', metricSavings: { LCP: 2100 }, description: 'Reduce image size. [Learn more](https://example.test)', details: { items: [{}, {}, {}] } },
      'render-blocking-insight': { title: 'Render blocking requests', score: 0.5, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 600 }, description: '' },
      'bf-cache': { title: 'Page prevented back/forward cache restoration', score: 1, scoreDisplayMode: 'binary' },
      'color-contrast': { title: 'Background and foreground colors do not have a sufficient contrast ratio.', score: 0, scoreDisplayMode: 'binary', description: '`contrast` matters', details: { items: [{}, {}] } },
      'html-has-lang': { title: '<html> element has a [lang] attribute', score: 1, scoreDisplayMode: 'binary' },
      'manual-check': { title: 'Manual', score: null, scoreDisplayMode: 'manual' },
      'errors-in-console': { title: 'No browser errors', score: 1, scoreDisplayMode: 'binary' },
      'meta-description': { title: 'Document does not have a meta description', score: 0, scoreDisplayMode: 'binary' },
      'link-text': { title: 'Links do not have descriptive text', score: 0, scoreDisplayMode: 'binary', displayValue: '2 links found' },
    },
  },
};

test('PageSpeed: scores, lab and field metrics, failing checks with savings', () => {
  const r = parsePsi(sample, 'mobile');
  assert.deepEqual(r.scores, { performance: 42, accessibility: 81, 'best-practices': 100, seo: 83 });
  assert.equal(r.lab.lcp, '6.2 s');
  assert.equal(r.lab.clsValue, 0.312);
  assert.deepEqual([r.field?.overall, r.field?.scope, r.field?.lcpMs, r.field?.cls], ['SLOW', 'page', 4100, 0.12]);
  const ids = r.findings.map((f) => f.id);
  assert.deepEqual(ids, ['image-delivery-insight', 'render-blocking-insight', 'color-contrast', 'meta-description', 'link-text']); // metrics, passes and manual checks excluded
  const img = r.findings[0];
  assert.deepEqual([img.savingsMs, img.savingsKb, img.items], [2100, 1240, 3]);
  assert.equal(img.description, 'Reduce image size. Learn more'); // markdown links become plain text
  assert.deepEqual(r.passedCount, { performance: 1, accessibility: 1, 'best-practices': 1, seo: 0 });
});

test('PageSpeed: local addresses and missing keys are skipped, never thrown', async () => {
  const local = await pageSpeed('http://localhost:4000/demo-sites/x/');
  assert.ok(local.error && ['private-url', 'no-key', 'disabled'].includes(local.error.code));
  assert.match(local.reportUrl, /^https:\/\/pagespeed\.web\.dev\/analysis\?url=/);
  const lan = await pageSpeed('http://192.168.1.20/');
  assert.ok(lan.error);
  assert.equal(lan.mobile, undefined);
});
