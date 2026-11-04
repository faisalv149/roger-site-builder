// Publication and SEO against a fake Vercel provider (no real deployment): the provider stores uploaded files and
// serves each deployment over HTTP by host, applying vercel.json redirects, trailing slashes and 404.html, so
// the tests check real responses, not just a config object.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-publish-'));
const blobs = new Map<string, Buffer>();
const deployments = new Map<string, { id: string; name: string; files: Map<string, string> }>();
const projects = new Map<string, { latest?: string; domains: Map<string, { verified: boolean }> }>();
const verifiedOnVercel = new Set<string>();
const project = (n: string) => projects.get(n) ?? projects.set(n, { domains: new Map() }).get(n)!;

const api = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url!, 'http://x');
  const send = (s: number, j: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.method === 'POST' && url.pathname === '/v2/files') { blobs.set(String(req.headers['x-vercel-digest']), body); return send(200, {}); }
  if (req.method === 'POST' && url.pathname === '/v13/deployments') {
    const j = JSON.parse(body.toString());
    const id = `dpl_${deployments.size + 1}`;
    deployments.set(id, { id, name: j.name, files: new Map(j.files.map((f: any) => [f.file, f.sha])) });
    const p = project(j.name); p.latest = id;
    return send(200, { id, readyState: 'READY', alias: [`${j.name}.vercel.app`, ...[...p.domains.keys()]], url: `${id}.vercel.app` });
  }
  const dep = url.pathname.match(/^\/v13\/deployments\/(.+)$/);
  if (req.method === 'GET' && dep) { const d = deployments.get(dep[1])!; return send(200, { id: d.id, readyState: 'READY', alias: [`${d.name}.vercel.app`, ...project(d.name).domains.keys()] }); }
  const add = url.pathname.match(/^\/v10\/projects\/([^/]+)\/domains$/);
  if (req.method === 'POST' && add) { const n = JSON.parse(body.toString()).name; project(add[1]).domains.set(n, { verified: verifiedOnVercel.has(n) }); return send(200, { name: n }); }
  const dom = url.pathname.match(/^\/v9\/projects\/([^/]+)\/domains\/([^/]+)$/);
  if (req.method === 'GET' && dom) { const v = verifiedOnVercel.has(dom[2]); project(dom[1]).domains.set(dom[2], { verified: v }); return send(200, { name: dom[2], verified: v, verification: v ? [] : [{ type: 'TXT', domain: `_vercel.${dom[2]}`, value: 'vc-domain-verify=...' }] }); }
  send(404, { error: { message: `fake: no route ${req.method} ${url.pathname}` } });
});

/** The fake edge: serves the latest deployment of the project that owns the host, like a static Vercel site. */
const edge = http.createServer((req, res) => {
  const host = String(req.headers['x-host']);
  const url = new URL(req.url!, `https://${host}`);
  const name = [...projects.entries()].find(([n, p]) => host === `${n}.vercel.app` || p.domains.has(host))?.[0];
  if (!name) { res.writeHead(404); return res.end('no such host'); }
  const d = deployments.get(projects.get(name)!.latest!)!;
  const file = (f: string) => (d.files.has(f) ? blobs.get(d.files.get(f)!) : undefined);
  const vj = JSON.parse(file('vercel.json')?.toString() || '{}');
  for (const r of vj.redirects || []) {
    if (r.has?.some((h: any) => h.type === 'host' && h.value !== host)) continue;
    const m = url.pathname.match(new RegExp(`^${r.source.replace('(.*)', '(.*)')}$`));
    if (m) { res.writeHead(r.permanent ? 308 : 307, { location: r.destination.replace('$1', m[1] ?? '') }); return res.end(); }
  }
  let p = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (vj.trailingSlash && p && !p.endsWith('/') && !path.extname(p) && file(`${p}/index.html`)) { res.writeHead(308, { location: `/${p}/` }); return res.end(); }
  if (!p || p.endsWith('/')) p += 'index.html';
  const data = file(p);
  if (!data) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(file('404.html') || 'not found'); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.xml') ? 'application/xml' : 'application/octet-stream' });
  res.end(data);
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
await new Promise<void>((r) => edge.listen(0, '127.0.0.1', () => r()));
const edgeUrl = `http://127.0.0.1:${(edge.address() as any).port}`;
const get = (host: string, p: string) => fetch(`${edgeUrl}${p}`, { headers: { 'x-host': host }, redirect: 'manual' });

Object.assign(process.env, {
  MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', PAGESPEED: '0', VERCEL_TEAM_ID: '',
  VERCEL_TOKEN: 'test-token', VERCEL_API_URL: `http://127.0.0.1:${(api.address() as any).port}`,
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4998',
});
const { buildSite } = await import('../src/pipeline.js');
const D = await import('../src/drafts.js');
const P = await import('../src/publish.js');
const C = await import('../src/design/content.js');
const O = await import('../src/orders.js');
const { getPublish } = await import('../src/store.js');
const { config } = await import('../src/config.js');

const built = await buildSite({ placeId: 'mock-cat-velvet', screenshot: false, audit: false });
const draftId = built.draftId!;
const slug = built.slug;
const hosted = `${P.projectName(slug)}.vercel.app`;

test('preview stays noindex; a Roger preview has no sitemap', () => {
  const html = fs.readFileSync(path.join(config.dirs.sites, slug, 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Preview: a free website draft/);
  assert.ok(!fs.existsSync(path.join(config.dirs.sites, slug, 'sitemap.xml')));
  assert.match(fs.readFileSync(path.join(config.dirs.sites, slug, 'robots.txt'), 'utf8'), /Allow: \//); // crawlers may read the noindex
});

test('publishing is blocked until sample content and claims are reviewed', async () => {
  await assert.rejects(P.publishSite(slug), (e: any) => e.status === 422 && e.blockers.length > 0 && e.blockers.some((b: any) => /sample/i.test(b.message)));
  assert.equal(await getPublish(slug), undefined);
});

test('a simulated domain step never changes the real origin or indexing', async () => {
  const d = (await D.getDraft(draftId))!;
  const { order } = await O.createDemoOrder(d, { idempotencyKey: 'simulated-domain-0001', revision: d.revision, owner: { name: 'Sam', email: 'sam@example.test' }, demoAcknowledged: true });
  const o = await O.updateOnboarding(order, { choice: 'connect', domain: 'velvetandvine.example', provider: 'cloudflare' });
  await O.simulateVerification(o);
  assert.equal(await getPublish(slug), undefined);
  assert.match(fs.readFileSync(path.join(config.dirs.sites, slug, 'index.html'), 'utf8'), /noindex/);
});

test('after review: published pages are indexable, canonical on the primary origin, with robots.txt and a sitemap', async () => {
  // the owner corrects every sample fact, leaves out unverifiable claims, and states their own prices
  let d = (await D.getDraft(draftId))!;
  for (const f of D.contentView(d)!.facts) {
    if (f.key === 'hours' || C.CLAIM_KEYS.includes(f.key as any) || f.key === 'serviceAreas' || f.key === 'description') d.content = C.reviewFact(d.content!, { key: f.key, action: 'omit' });
    else d.content = C.reviewFact(d.content!, { key: f.key, action: 'correct', value: f.value });
  }
  // no test enquiry has arrived yet: that alone blocks publishing
  assert.ok(C.publishReadiness(d.content, d.offerings, { leadTested: false }).some((x) => x.key === 'lead-test' && x.level === 'blocker'));
  d.base.leadTestedAt = new Date().toISOString();
  (config as { leadWebhook: string }).leadWebhook = 'http://127.0.0.1:9/lead'; // a delivery channel is set up (publishing checks it, it does not send)
  // the owner uploads nothing: Google photos stay in the preview; sample photos never publish
  await D.putDraft(d);
  d = (await D.getDraft(draftId))!;
  await D.saveDraft(d, { revision: d.revision, offerings: d.offerings.map((o) => ({ ...o, source: 'owner' })) });
  d = (await D.getDraft(draftId))!;
  assert.deepEqual(C.publishReadiness(d.content, d.offerings).filter((x) => x.level === 'blocker'), []);

  const rec = await P.publishSite(slug);
  assert.equal(rec.domain, hosted);
  assert.equal(rec.draftRevision, d.revision);
  const home = await get(hosted, '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://${hosted}/">`));
  assert.ok(!/Preview: a free website draft/.test(html), 'no draft banner');
  assert.ok(!/aggregateRating|reviewRating/.test(html), 'no self-serving review markup');
  assert.ok(!/Google review/.test(html), 'Google review text stays in the preview');
  assert.match(html, /"@type":"HairSalon"/);
  assert.ok(!/localhost:4998\/sites/.test(html.replace(/\/api\/leads\/[^"]+/g, '')), 'no preview URLs left (except the lead endpoint)');
  // no Google or sample photos were shipped
  const dep = [...deployments.values()].at(-1)!;
  assert.ok(![...dep.files.keys()].some((f) => /^assets\/photo-/.test(f)), [...dep.files.keys()].join(','));
  assert.ok(!dep.files.has('site.json'));
  const robots = await (await get(hosted, '/robots.txt')).text();
  assert.match(robots, new RegExp(`Sitemap: https://${hosted}/sitemap.xml`));
  const sitemap = await (await get(hosted, '/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 1 && locs.every((l) => l.startsWith(`https://${hosted}/`)));
  assert.ok(!locs.some((l) => /404|owner|checkout|report/.test(l)));
  // every page in the sitemap answers 200 and has its own title
  const titles = new Set<string>();
  for (const l of locs) {
    const r = await get(hosted, new URL(l).pathname);
    assert.equal(r.status, 200, l);
    titles.add(((await r.text()).match(/<title>([^<]+)<\/title>/) || [])[1]);
  }
  assert.equal(titles.size, locs.length, 'unique titles');
  // a missing page is a real 404, not the home page
  const missing = await get(hosted, '/no-such-page/');
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Page not found/);
});

test('changing the primary domain: blocked until verified, then canonical moves and the old address redirects', async () => {
  await assert.rejects(P.setPrimaryDomain(slug, 'velvetandvine.example'), (e: any) => e.status === 409 && /isn.t verified/.test(e.message));
  assert.equal((await getPublish(slug))!.domain, hosted);
  verifiedOnVercel.add('velvetandvine.example');
  const rec = await P.setPrimaryDomain(slug, 'https://velvetandvine.example/', { check: async (u) => (await get(new URL(u).host, '/')).status });
  assert.equal(rec.primaryDomain, 'velvetandvine.example');
  assert.deepEqual(rec.previousDomains, [hosted]);
  const html = await (await get('velvetandvine.example', '/')).text();
  assert.match(html, /<link rel="canonical" href="https:\/\/velvetandvine\.example\/">/);
  assert.match(await (await get('velvetandvine.example', '/sitemap.xml')).text(), /<loc>https:\/\/velvetandvine\.example\//);
  const old = await get(hosted, '/some/page/');
  assert.equal(old.status, 308);
  assert.equal(old.headers.get('location'), 'https://velvetandvine.example/some/page/');
  // republishing keeps the domain and the redirect
  await P.publishSite(slug);
  assert.equal((await get(hosted, '/')).status, 308);
  assert.equal((await get('velvetandvine.example', '/')).status, 200);
});

test('sites built before details review existed cannot be published', async () => {
  fs.mkdirSync(path.join(config.dirs.sites, 'legacy-site'), { recursive: true });
  fs.writeFileSync(path.join(config.dirs.sites, 'legacy-site', 'index.html'), '<html></html>');
  await assert.rejects(P.publishSite('legacy-site'), (e: any) => e.status === 422 && /Rebuild it/.test(e.message));
});

test.after(() => { api.close(); edge.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
