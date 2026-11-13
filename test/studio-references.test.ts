// Reference research for the design engine: a verified brief → candidates from a real search source (never Claude's
// memory) → each URL verified → measured at desktop and phone sizes → a short design strategy whose suggested actions
// the brief supports. One synthetic business; search, network, Claude and (except in the last test) the browser are
// replaced. References are inspiration only: the job keeps measurements, never a reference's words or pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-refs-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });

const { studioDocs } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const R = await import('../src/studio/concepts/references.js');
type Metrics = import('../src/studio/concepts/references.js').ViewMetrics;
type AiTransport = import('../src/studio/concepts/ai.js').AiTransport;

// ── the synthetic business: a verified bakery with a measured brand, a verified phone and address, no ordering ──
const fact = <T,>(value: T, status = 'verified') => ({ value, status, confidence: 0.9, sources: [] });
function briefOf(key: string, o: { status?: string; primary?: unknown; booking?: string | null } = {}) {
  return {
    businessKey: key, revision: 1, briefHash: 'h',
    identity: { status: o.status ?? 'verified', evidence: [], name: fact('Copper Kettle Bakery'), alternateNames: [], category: fact('Bakery'), website: fact('https://copperkettle.example.com'), listing: { placeId: 'ChIJcopper' } },
    contact: { phone: fact('(512) 555-0147'), otherPhones: [], email: fact(null, 'unknown'), address: fact({ street: '1 Main St', city: 'Austin', state: 'TX', zip: '78704', formatted: '1 Main St, Austin, TX 78704' }) },
    serviceArea: fact(null), reviews: fact({ rating: 4.8, count: 312, restrictions: '' }),
    services: { status: 'known', items: [{ name: 'Sourdough' }, { name: 'Custom cakes' }], proposals: [] },
    offers: [], claims: [fact('Baked fresh every morning')],
    callsToAction: { primary: o.primary ?? { label: 'Call us', href: 'tel:+15125550147', kind: 'phone', locator: 'header' }, secondary: null, booking: o.booking ?? null, held: [] },
    brand: { status: 'measured', confidence: 'high', colors: [{ role: 'primary', hex: '#B5532A', confidence: 'high', evidence: 'logo' }, { role: 'background', hex: '#FFF8F0', confidence: 'medium', evidence: 'css' }], fonts: [{ role: 'heading', family: 'Fraunces', source: 'css' }], headingCase: null, logo: fact({ url: 'https://copperkettle.example.com/logo.svg', colors: ['#B5532A'] }) },
  };
}
async function saveBrief(key: string, o: Parameters<typeof briefOf>[1] = {}) {
  await studioDocs.put('studio-index', key, { businessKey: key, latest: 1, revisions: [] });
  await studioDocs.put('studio-briefs', `${key}--r1`, briefOf(key, o));
}
const view = (o: Partial<Metrics> = {}): Metrics => ({
  textLength: 4000, viewportMeta: true, overflowX: false, pageScreens: 5,
  header: { sticky: true, navLinks: 5, menuButton: false }, hero: { heightRatio: 0.8, media: 'image', textOverMedia: true, ctas: 2 },
  type: { headingFamily: 'Playfair Display', headingPx: 56, headingWeight: 600, headingCase: 'none', bodyFamily: 'Inter', bodyPx: 17, lineHeight: 1.6, families: 2 },
  sections: 7, images: { count: 12, coverShare: 0.8, roundedShare: 0.2, wideShare: 0.3 }, buttons: { radiusPx: 999 },
  interactions: { carousel: true, accordion: false, stickyBottomBar: true, video: false, forms: 1 }, ...o,
});
function fakeTransport(answers: unknown[]): AiTransport & { prompts: string[] } {
  const t = { via: 'fake' as const, model: 'claude-sonnet-5-5', prompts: [] as string[], async call(req: { prompt: string }) { t.prompts.push(req.prompt); const a = answers[Math.min(t.prompts.length - 1, answers.length - 1)]; return { data: a, usage: { via: 'fake' as const, model: 'claude-sonnet-5-5', inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.02, costBasis: 'computed' as const } }; } };
  return t;
}
const strategy = (from: string[], extra: { interactions?: string[]; mobile?: string } = {}) => ({
  summary: 'Warm, photo-led and easy to reach on a phone.',
  layoutPatterns: [{ pattern: 'Full-width photo hero with one clear action', why: 'shows the bread first', from }, { pattern: 'Product highlights in a short card row', why: 'scannable on phones', from }],
  typography: { headings: 'A characterful serif for headings', body: 'A plain sans at 17px', notes: 'Two families at most' },
  imagery: ['Close, warm product photos cropped to fill'], navigation: { desktop: 'Sticky header with five links', mobile: extra.mobile ?? 'Menu button plus a tap-to-call button' },
  interactions: extra.interactions ?? ['Swipeable reviews', 'A sticky bottom bar with Call and Directions'], avoid: ['Online ordering until the bakery offers it'],
});
const page = (body = '<html><body><main>Fresh bread and more</main></body></html>') => ({ status: 200, contentType: 'text/html; charset=utf-8', body });

test('only public website addresses can be references', () => {
  for (const ok of ['https://www.example.com', 'http://bakery.example.org/menu']) assert.equal(R.isPublicReference(ok), true, ok);
  for (const bad of ['http://localhost:4000', 'http://127.0.0.1', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5', 'http://[::1]/', 'http://8.8.8.8', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com', 'http://intranet']) assert.equal(R.isPublicReference(bad), false, bad);
});

test('search results become candidates when they have their own site and are not this business; a Google rating is no cutoff', () => {
  const r = R.placesToCandidates('Bakery in Chicago, IL', [
    { id: 'p1', displayName: { text: 'Small Loaf' }, websiteUri: 'https://smallloaf.example.com', rating: 3.9, userRatingCount: 120 },
    { id: 'p2', displayName: { text: 'Big Bake' }, websiteUri: 'https://bigbake.example.com/', rating: 4.7, userRatingCount: 2400 },
    { id: 'p3', displayName: { text: 'Order Only' }, websiteUri: 'https://www.toasttab.com/orderonly', rating: 4.8, userRatingCount: 900 },
    { id: 'ChIJcopper', displayName: { text: 'Copper Kettle' }, websiteUri: 'https://copperkettle.example.com', rating: 4.8, userRatingCount: 900 },
    { id: 'p5', displayName: { text: 'No Site' }, rating: 4.9, userRatingCount: 5000 },
  ], { excludeHosts: ['copperkettle.example.com'], excludePlaceIds: ['ChIJcopper'] });
  // a 3.9★ bakery is still a candidate (its site is judged by the verify and inspect stages); review count only orders
  assert.deepEqual(r.candidates.map((c) => c.url), ['https://bigbake.example.com/', 'https://smallloaf.example.com']);
  assert.match(r.candidates[0].why, /Google Places "Bakery in Chicago, IL": Big Bake, 2,400 reviews/);
  assert.ok(r.candidates.every((c) => !/★/.test(c.why)), 'no rating shown as a quality signal');
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['a platform page (toasttab.com), not the business\'s own site', 'this business itself'].sort());
});

test('every URL is verified before inspection: redirects re-checked, errors, parked pages and platforms rejected', async () => {
  const net: Record<string, ReturnType<typeof page> & { location?: string }> = {
    'https://good.example.com/': page(),
    'https://moved.example.com/': { status: 301, location: 'https://www.moved.example.com/', contentType: '', body: '' },
    'https://www.moved.example.com/': page(),
    'https://sneaky.example.com/': { status: 302, location: 'http://169.254.169.254/latest', contentType: '', body: '' },
    'https://gone.example.com/': { status: 404, contentType: 'text/html', body: '' },
    'https://parked.example.com/': page('<html><body>This domain is for sale! Buy this domain today.</body></html>'),
    'https://ordering.example.com/': { status: 302, location: 'https://order.toasttab.com/x', contentType: '', body: '' },
    'https://pdf.example.com/': { status: 200, contentType: 'application/pdf', body: '%PDF' },
  };
  const fetchPage = async (u: string) => { const r = net[u]; if (!r) throw new Error('getaddrinfo ENOTFOUND'); return r; };
  const v = (u: string) => R.verifyUrl(u, R.isPublicReference, fetchPage);
  assert.deepEqual(await v('https://good.example.com/'), { ok: true, url: 'https://good.example.com/' });
  assert.deepEqual(await v('https://moved.example.com/'), { ok: true, url: 'https://www.moved.example.com/' });
  assert.match((await v('https://sneaky.example.com/') as { reason: string }).reason, /redirects to an address that is not allowed/);
  assert.match((await v('https://gone.example.com/') as { reason: string }).reason, /HTTP 404/);
  assert.match((await v('https://parked.example.com/') as { reason: string }).reason, /parked/);
  assert.match((await v('https://ordering.example.com/') as { reason: string }).reason, /redirects to a platform page/);
  assert.match((await v('https://pdf.example.com/') as { reason: string }).reason, /not a web page/);
  assert.match((await v('https://nowhere.example.com/') as { reason: string }).reason, /ENOTFOUND/);
});

test('the actions a strategy may suggest come from the verified brief', () => {
  const b = (o: Parameters<typeof briefOf>[1]) => briefOf('k', o) as unknown as Parameters<typeof R.supportedActions>[0];
  const base = R.supportedActions(b({}));
  assert.deepEqual({ ...base, evidence: undefined }, { order: false, booking: false, delivery: false, call: true, directions: true, evidence: undefined });
  assert.equal(R.supportedActions(b({ primary: { label: 'Order online', href: 'https://copperkettle.square.site', kind: 'external', locator: 'hero' } })).order, true);
  assert.equal(R.supportedActions(b({ booking: 'https://calendly.com/copper' })).booking, true);
  // grounded: call and directions may be suggested, ordering and delivery may not; "avoid" may name them
  const hosts = ['bigbake.example.com'];
  assert.deepEqual(R.validateStrategy(strategy(hosts), hosts, base), []);
  const bad = R.validateStrategy(strategy(hosts, { interactions: ['An order-ahead button and delivery tracking'] }), hosts, base);
  assert.ok(bad.some((e) => /suggests order/.test(e)) && bad.some((e) => /suggests delivery/.test(e)), bad.join('; '));
  // no supported action: no sticky action bar either
  const none = { order: false, booking: false, delivery: false, call: false, directions: false, evidence: [] };
  assert.ok(R.validateStrategy(strategy(hosts, { interactions: ['A sticky bottom bar with the menu'], mobile: 'Menu button' }), hosts, none).some((e) => /sticky action bar/.test(e)));
});

test('a reference job needs a verified brief and a public staff reference', async () => {
  await saveBrief('place-unverified', { status: 'probable' });
  await assert.rejects(R.startReferenceJob({ businessKey: 'place-unverified' }, { transport: null }), R.ReferenceInputError);
  await saveBrief('place-copper');
  await assert.rejects(R.startReferenceJob({ businessKey: 'place-copper', referenceUrl: 'http://169.254.169.254/' }, { transport: null }), /public/);
});

test('the job: search → verify → inspect → a grounded strategy; Claude never names a URL; one cap covers search and Claude', async () => {
  await saveBrief('place-copper');
  const searched: unknown[] = [];
  const search = async (q: unknown) => {
    searched.push(q);
    return { candidates: [{ url: 'https://gone.example.com/', why: 'search', source: 'search' as const }, { url: 'https://bigbake.example.com/', why: 'search', source: 'search' as const }, { url: 'https://tiny.example.com/', why: 'search', source: 'search' as const }], rejected: [{ url: 'https://www.toasttab.com/x', source: 'search' as const, stage: 'find' as const, reason: 'a platform page' }], queries: [{ query: 'Bakery in Chicago, IL', results: 10, ms: 300 }], costUsd: 0.105 };
  };
  const fetchPage = async (u: string) => (u.includes('gone') ? { status: 404, contentType: 'text/html', body: '' } : page());
  const opened: string[] = [];
  const inspect = async (url: string) => { opened.push(url); return { desktop: view(url.includes('tiny') ? { sections: 2 } : {}), mobile: view(), screenshots: { desktop: 'd.png', mobile: 'm.png' } }; };
  // the first answer suggests ordering, which this bakery's brief does not support: rejected, then a grounded answer
  const t = fakeTransport([strategy(['staffpick.example.com', 'bigbake.example.com'], { interactions: ['An order-ahead button in the header'] }), strategy(['staffpick.example.com', 'bigbake.example.com', 'tiny.example.com'])]);
  const started = await R.startReferenceJob({ businessKey: 'place-copper', referenceUrl: 'https://staffpick.example.com/' }, { transport: t, search, fetchPage, inspect });
  const job = await R.waitForReferenceJob(started.id);
  assert.equal(job.status, 'done', job.error ?? '');
  assert.deepEqual(job.stages.map((s) => s.name), ['resolve', 'find', 'verify', 'inspect', 'strategy']);
  assert.deepEqual(searched, [{ category: 'Bakery', city: 'Austin', excludeHosts: ['copperkettle.example.com'], excludePlaceIds: ['ChIJcopper'] }]);
  assert.deepEqual(opened, ['https://staffpick.example.com/', 'https://bigbake.example.com/', 'https://tiny.example.com/'], 'staff first; the 404 is never opened');
  assert.deepEqual(job.work.rejected!.map((r) => `${r.stage}: ${r.url}`), ['find: https://www.toasttab.com/x', 'verify: https://gone.example.com/']);
  // a two-section page is measured, not rejected
  const tiny = job.work.inspected!.find((x) => x.host === 'tiny.example.com')!;
  assert.equal(tiny.ok, true);
  assert.equal(tiny.desktop!.sections, 2);
  // Claude was asked once per strategy attempt and never for URLs; its prompts name the allowed and banned actions
  assert.equal(t.prompts.length, 2);
  assert.ok(t.prompts.every((p) => !/name .*websites|homepage URL/i.test(p)));
  assert.match(t.prompts[0], /verifiably offers: call, directions\. Actions it does NOT verifiably offer: order, booking, delivery/);
  const s = job.work.strategy!;
  assert.equal(s.source, 'ai');
  assert.deepEqual({ order: s.actions.order, call: s.actions.call }, { order: false, call: true });
  assert.ok(!/order/i.test(JSON.stringify({ ...s, avoid: [], actions: undefined })), 'no ordering suggestion survived');
  assert.deepEqual(s.brand.colors, [{ role: 'primary', hex: '#B5532A' }, { role: 'background', hex: '#FFF8F0' }]);
  assert.equal(job.work.search!.costUsd, 0.105);
  assert.ok(job.work.search!.costUsd + job.work.calls.reduce((n, c) => n + c.costUsd, 0) <= 1, 'search and Claude within the one cap');
});

test('without a search source or Claude: the staff reference alone, and the fallback adds a sticky bar only for supported actions', async () => {
  await saveBrief('place-copper');
  const inspect = async () => ({ desktop: view(), mobile: view(), screenshots: { desktop: 'd.png', mobile: 'm.png' } });
  const started = await R.startReferenceJob({ businessKey: 'place-copper', referenceUrl: 'https://staffpick.example.com/' }, { transport: null, fetchPage: async () => page(), inspect });
  const job = await R.waitForReferenceJob(started.id);
  assert.equal(job.status, 'done', job.error ?? '');
  assert.match(job.stages[1].notes.join(' '), /no search source here/);
  const s = job.work.strategy!;
  assert.equal(s.source, 'fallback');
  assert.ok(s.interactions.includes('A fixed action bar at the bottom on mobile (call, directions)'));
});

test('the real inspector measures a page at both sizes and keeps none of its words', { skip: !config.chromiumPath && 'no Chromium here' }, async () => {
  const SECRET = 'Grandmother Ottoline kneads every loaf at dawn';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:17px/1.6 Georgia,serif}header{position:sticky;top:0;display:flex;gap:16px;padding:16px}h1{font:600 56px Arial,sans-serif;text-transform:uppercase}section{min-height:300px;padding:40px}.hero{min-height:80vh;background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) center/cover}img{width:300px;height:200px;object-fit:cover;border-radius:12px}@media(max-width:600px){header a{display:none}}</style></head><body><header><a href="#">Menu</a><a href="#">Cakes</a><a href="#">Visit</a><button aria-label="Open menu">☰</button></header><main><section class="hero"><h1>Fresh bread</h1><a class="btn" href="#">Visit</a></section>${[1, 2, 3, 4].map(() => `<section><p>${SECRET} ${'and much more besides. '.repeat(20)}</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></section>`).join('')}<details><summary>FAQ</summary>Yes</details></main></body></html>`;
  const server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    const dir = path.join(tmp, 'out', 'studio-references', 'real');
    fs.mkdirSync(dir, { recursive: true });
    const m = await R.inspectPage(base, dir, (u) => u.startsWith(base));
    assert.equal(m.desktop.header.sticky, true);
    assert.equal(m.desktop.header.navLinks, 3);
    assert.equal(m.mobile.header.navLinks, 0, 'links hidden on the phone');
    assert.equal(m.mobile.header.menuButton, true);
    assert.equal(m.desktop.hero.media, 'image');
    assert.equal(m.desktop.type.headingFamily, 'Arial');
    assert.equal(m.desktop.type.bodyFamily, 'Georgia');
    assert.equal(m.desktop.interactions.accordion, true);
    assert.ok((m.desktop.sections ?? 0) >= 5, "a page with several blocks gets a real count");
    assert.ok(fs.existsSync(path.join(tmp, 'out', m.screenshots.desktop)) && fs.existsSync(path.join(tmp, 'out', m.screenshots.mobile)));
    assert.ok(!JSON.stringify(m).includes('Ottoline'), 'no words of the reference are kept');
  } finally { server.close(); }
});
