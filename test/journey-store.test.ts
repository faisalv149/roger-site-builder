// Drafts, owner access, saves, demo orders and domain onboarding against the real local store, in a throwaway
// DATA_DIR / OUT_DIR (set before anything reads the config). Mock Google data, no Claude, no lead webhook.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-journey-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', VERCEL_TOKEN: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4999', DEMO_PACKAGE_PRICE: '29' });

const { buildSite } = await import('../src/pipeline.js');
const D = await import('../src/drafts.js');
const O = await import('../src/orders.js');
const { draftDocs } = await import('../src/store.js');
const { config } = await import('../src/config.js');

/** Count outgoing requests while fn runs: edits, saves, orders and domain steps must not call Google, Claude or anything else. */
async function noNetwork<T>(fn: () => Promise<T>): Promise<{ r: T; calls: string[] }> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (u: unknown) => { calls.push(String(u)); throw new Error('network disabled in this test'); }) as typeof fetch;
  try { return { r: await fn(), calls }; } finally { globalThis.fetch = real; }
}
const html = (slug: string) => fs.readFileSync(path.join(config.dirs.sites, slug, 'index.html'), 'utf8');

const built = await buildSite({ placeId: 'mock-cat-velvet', screenshot: false, audit: false });
const fresh = async () => (await D.getDraft(built.draftId!))!;

test('a build creates a draft with the plan, offerings and photos, and the page is noindex', async () => {
  const d = await fresh();
  assert.ok(d && d.revision === 1);
  assert.equal(d.category, 'salon');
  assert.ok(d.offerings.some((o) => o.source === 'sample' && o.price.kind !== 'quote'));
  assert.ok(d.base.photos.length >= 3 && !('raw' in d.base.photos[0]));
  const page = html(d.slug);
  assert.match(page, /noindex/);
  assert.match(page, /Sample prices for this demo business/);
  assert.match(page, /\$180–\$260/);
});

test('owner capability: scoped to one draft, wrong and revoked keys refused, key never stored', async () => {
  const d = await fresh();
  const key = D.issueOwnerKey(d);
  await D.putDraft(d);
  const stored = JSON.stringify(await draftDocs.get('drafts', d.id));
  assert.ok(!stored.includes(key));
  assert.ok(D.verifyOwnerKey(await fresh(), key));
  assert.equal(D.verifyOwnerKey(await fresh(), `${key}x`), false);
  assert.equal(D.verifyOwnerKey(await fresh(), undefined), false);
  const other = await buildSite({ placeId: 'mock-cat-lantern', screenshot: false, audit: false });
  const o = (await D.getDraft(other.draftId!))!;
  D.issueOwnerKey(o); await D.putDraft(o);
  assert.equal(D.verifyOwnerKey(o, key), false); // another draft's key
  const state = JSON.stringify(D.ownerState(await fresh()));
  assert.ok(!/keyHash|rk_/.test(state));
  const r = await fresh(); r.owner!.revokedAt = new Date().toISOString(); await D.putDraft(r);
  assert.equal(D.verifyOwnerKey(await fresh(), key), false);
});

test('colour, font, layout and price edits re-render from stored data: no Google, Claude or other requests', async () => {
  const d = await fresh();
  const { r, calls } = await noNetwork(async () => {
    const tok = D.previewTokens(d, { appearance: { color: { mode: 'gradient', gradient: { preset: 'ocean', angle: 90 } }, font: 'clean-geometric', motion: 'expressive' } });
    const w = await D.renderWorking(d, { layout: { arrangement: 'b' }, offerings: d.offerings.map((o, i) => (i === 0 ? { ...o, source: 'owner', price: { kind: 'fixed', amount: 70, currency: 'USD' } } : o)) });
    return { tok, w };
  });
  assert.deepEqual(calls, []);
  assert.match(r.tok.css, /linear-gradient\(90deg/);
  assert.match(r.tok.fonts!.url, /Plus\+Jakarta/);
  assert.equal(r.w.plan.arrangement, 'b');
  assert.match(r.w.html, /\$70/);
  assert.match(r.w.html, /<base href="\/drafts\/[a-z0-9-]+\/">/); // the editor frame resolves assets and links at the draft's own preview address (never a pinned public link)
  assert.equal((await fresh()).revision, d.revision); // nothing saved
});

test('save: stale revisions are refused, the saved design is restored on reopen, old records still load', async () => {
  const d = await fresh();
  await assert.rejects(D.saveDraft(d, { revision: d.revision - 1, appearance: {} }), (e: InstanceType<typeof D.DraftError>) => e.status === 409);
  await assert.rejects(D.saveDraft(d, { revision: d.revision, offerings: [{ id: 'x', name: 'X', price: { kind: 'fixed', amount: -1, currency: 'USD' }, source: 'owner' }] }), (e: InstanceType<typeof D.DraftError>) => e.status === 400);
  await assert.rejects(D.saveDraft(d, { revision: d.revision, appearance: { color: { accent: 'javascript:alert(1)' } } }), (e: InstanceType<typeof D.DraftError>) => e.status === 400);
  const g = await D.generateAnother(d, {});
  const rev = d.revision;
  const oldPlan = d.plan.id;
  const { r: saved, calls } = await noNetwork(() => D.saveDraft(d, { revision: rev, planId: g.plan.id, appearance: { color: { mode: 'solid', preset: 'forest' }, buttons: 'pill' }, offerings: d.offerings.map((o, i) => (i === 0 ? { ...o, name: 'Signature cut <script>', source: 'owner', price: { kind: 'from', amount: 72, currency: 'USD' } } : o)) }));
  assert.ok(calls.every((u) => !/googleapis|anthropic/.test(u)));
  assert.equal(saved.revision, rev + 1);
  const re = await fresh();
  assert.equal(re.plan.id, g.plan.id);
  assert.equal(re.appearance.buttons, 'pill');
  assert.equal(re.history[0].id, oldPlan);
  const page = html(re.slug);
  assert.match(page, /From \$72/);
  assert.ok(!page.includes('<script>alert') && !/Signature cut <script>/.test(page));
  assert.match(page, /--btn-r:999px/);
  // the same plan renders again on reopen (no re-planning)
  assert.equal((await D.renderWorking(re, {})).plan.id, re.plan.id);
  // an older record without the newer fields still loads
  const raw = JSON.parse(JSON.stringify(re));
  delete raw.appearance; delete raw.history; delete raw.candidates; delete raw.v; delete raw.offerings;
  const up = D.upgradeDraft(raw)!;
  assert.deepEqual([up.appearance, up.history, up.candidates, up.offerings], [{}, [], [], []]);
});

test('demo purchase: needs the saved revision, is idempotent, freezes the design, takes no payment', async () => {
  const d = await fresh();
  const owner = { name: 'Sam Owner', email: 'sam@example.test' };
  await assert.rejects(O.createDemoOrder(d, { idempotencyKey: 'k'.repeat(20), revision: d.revision - 1, owner, demoAcknowledged: true }), (e: InstanceType<typeof D.DraftError>) => e.status === 409);
  await assert.rejects(O.createDemoOrder(d, { idempotencyKey: 'k'.repeat(20), revision: d.revision, owner, demoAcknowledged: false }), (e: InstanceType<typeof D.DraftError>) => e.status === 400);
  await assert.rejects(O.createDemoOrder(d, { idempotencyKey: 'k'.repeat(20), revision: d.revision, owner, demoAcknowledged: true, card: '4242424242424242' }), (e: InstanceType<typeof D.DraftError>) => e.status === 400); // no card fields accepted
  const key = 'idem-0123456789abcdef';
  const { r: a, calls } = await noNetwork(() => O.createDemoOrder(d, { idempotencyKey: key, revision: d.revision, owner, demoAcknowledged: true }));
  assert.ok(calls.every((u) => !/stripe|vercel|googleapis|anthropic/i.test(u)), calls.join());
  const b = await O.createDemoOrder(d, { idempotencyKey: key, revision: d.revision, owner, demoAcknowledged: true });
  assert.equal(a.replay, false); assert.equal(b.replay, true); assert.equal(a.order.id, b.order.id);
  assert.equal((await O.listOrders(d.id)).length, 1);
  const o = a.order;
  assert.equal(o.mode, 'demo');
  assert.deepEqual(o.payment, { status: 'simulated', method: 'demo-card', label: 'Demo payment', last4: '4242', charged: false });
  assert.deepEqual(o.real, { entitlement: false, published: false });
  assert.equal(o.package.demoPrice, true);
  assert.equal(o.snapshot.revision, d.revision);
  assert.match(o.reference, /^RGR-[0-9A-F]{6}$/);
  const frozen = fs.readFileSync(path.join(config.dirs.orders, o.id, 'index.html'), 'utf8');
  // later edits don't change what was bought
  await D.saveDraft(await fresh(), { revision: d.revision, appearance: { color: { mode: 'solid', preset: 'plum' } } });
  assert.equal(fs.readFileSync(path.join(config.dirs.orders, o.id, 'index.html'), 'utf8'), frozen);
  assert.equal((await O.getOrder(o.id))!.snapshot.revision, d.revision);
  // the view the editor gets has no idempotency key
  assert.ok(!('idempotencyKey' in (await O.orderView(o))));
});

test('domain onboarding: guidance and simulated verification never touch real flags or the network', async () => {
  const d = await fresh();
  const o = (await O.listOrders(d.id))[0];
  await assert.rejects(O.simulateVerification(o), (e: InstanceType<typeof D.DraftError>) => e.status === 400); // no domain yet
  await assert.rejects(O.updateOnboarding(o, { choice: 'connect', domain: 'nope' }), (e: InstanceType<typeof D.DraftError>) => e.status === 400);
  await assert.rejects(O.updateOnboarding(o, { provider: 'evilcorp' }), (e: InstanceType<typeof D.DraftError>) => e.status === 400);
  const { r, calls } = await noNetwork(async () => {
    const a = await O.updateOnboarding(o, { choice: 'connect', domain: 'velvetandvine.com', provider: 'namecheap', registrar: 'Namecheap', done: [0, 1] });
    const b = await O.simulateVerification(a);
    return { a, b };
  });
  assert.deepEqual(calls, []);
  assert.equal(r.a.onboarding.status, 'in-progress');
  assert.deepEqual(r.a.onboarding.done, [0, 1]);
  assert.equal(r.b.onboarding.status, 'demo-complete');
  assert.equal(r.b.onboarding.demo.verified, true);
  assert.deepEqual(r.b.onboarding.real, { domainVerified: false, certificateReady: false, published: false });
  assert.deepEqual(r.b.real, { entitlement: false, published: false });
  // "Do this later" keeps progress for a later visit
  const later = await O.updateOnboarding((await O.listOrders((await fresh()).id))[0], { choice: 'later' });
  assert.equal(later.onboarding.status, 'demo-complete'); // a finished demo stays finished
  assert.equal(later.onboarding.domain?.apex, 'velvetandvine.com');
});

test('clean output: the public site has no editor, checkout, keys or owner API', async () => {
  const d = await fresh();
  for (const f of ['index.html', 'site.json']) {
    const t = fs.readFileSync(path.join(config.dirs.sites, d.slug, f), 'utf8');
    assert.ok(!/owner\.js|o-dock|rk_[A-Za-z0-9_-]{20}|\/api\/owner|keyHash|Demo checkout|idempotency/.test(t), f);
  }
});

test('a rebuild of the same business keeps the owner\'s saved appearance, prices and orders', async () => {
  const before = await fresh();
  const again = await buildSite({ placeId: 'mock-cat-velvet', screenshot: false, audit: false });
  assert.equal(again.draftId, before.id);
  const after = await fresh();
  assert.deepEqual(after.appearance, before.appearance);
  assert.ok(after.offerings.some((o) => o.source === 'owner'));
  assert.equal(after.plan.id, before.plan.id); // the saved design, not a new one
  assert.equal((await O.listOrders(after.id)).length, 1);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
