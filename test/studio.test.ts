// Design studio, phase 1: business brief jobs. A local fixture website (with a page that always fails, one that fails
// once, a robots.txt rule and a sitemap) and the sample Google listings stand in for the network, so every test is
// offline and repeatable.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const PORT = 4987;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-studio-'));
Object.assign(process.env, {
  MOCK: '1', BRAND_MEASURE: '0', STUDIO_RENDER: '0', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', STUDIO_SUMMARY: '0', STUDIO_BACKOFF_MS: '5', STUDIO_PAGE_DELAY_MS: '0',
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`, CRAWL_PAGES: '0', PAGESPEED: '0', RESCORE: '0',
});

const sharp = (await import('sharp')).default;
const express = (await import('express')).default;
const { startStudioJob, waitForStudioJob, resumeInterruptedJobs, getBrief, getStudioJob, JobInterrupted } = await import('../src/studio/jobs.js');
const { buildFromSnapshot } = await import('../src/studio/brief.js');
const { getSnapshot } = await import('../src/studio/snapshot.js');
const { businessBrief, siteInventory } = await import('../src/studio/schema.js');
const { findAddresses } = await import('../src/studio/address.js');
const { studioRoutes } = await import('../src/studio/routes.js');

// ───────────────────────── the fixture website ─────────────────────────
/** a picture with the tones of a photograph: a colour gradient, shapes and fine grain (flat artwork would be set aside) */
async function photo(n: number, w = 1200, h = 800) {
  const shapes = Array.from({ length: 7 }, (_, i) => `<circle cx="${(n * 97 + i * 211) % w}" cy="${(n * 53 + i * 131) % h}" r="${60 + ((n + i) * 37) % 160}" fill="rgb(${(n * 61 + i * 40) % 255},${(n * 29 + i * 70) % 255},${(n * 83 + i * 25) % 255})" opacity="0.8"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${(n * 40) % 255},${(n * 90) % 255},${(n * 20) % 255})"/><stop offset="1" stop-color="rgb(${(n * 70 + 120) % 255},${(n * 30 + 60) % 255},${(n * 110 + 30) % 255})"/></linearGradient><filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed="${n}"/></filter></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<rect width="${w}" height="${h}" filter="url(#t)" opacity="0.6"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
const imgs = new Map<string, Buffer>();
for (let n = 1; n <= 5; n++) imgs.set(`/img/photo-${n}.jpg`, await photo(n));
imgs.set('/img/logo.png', await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 10, g: 70, b: 160, alpha: 1 } } }).png().toBuffer());

const nav = `<header><a href="/"><img src="/img/logo.png" alt="Harbor Light Plumbing logo" class="logo"></a><nav><ul>
  <li><a href="/services/">Services</a></li><li><a href="/about/">About</a></li><li><a href="/locations/">Locations</a></li>
  <li><a href="/contact/">Contact</a></li><li><a href="/flaky/">Specials</a></li><li><a href="/broken/">Careers</a></li></ul></nav></header>`;
const foot = '<footer><p>Harbor Light Plumbing · <a href="tel:5124820142">(512) 482-0142</a> · <a href="/privacy-policy/">Privacy</a></p></footer>';
const page = (title: string, body: string, extra = '') => `<!doctype html><html><head><title>${title} | Harbor Light Plumbing</title><meta name="description" content="${title} from Harbor Light Plumbing in Austin, TX.">${extra}<style>.btn{background:#0a46a0;color:#fff}body{font-family:"Work Sans",sans-serif}</style></head><body>${nav}<main>${body}</main>${foot}</body></html>`;
const card = (name: string, slug: string, n: number, text: string) => `<div class="service-card"><img src="/img/photo-${n}.jpg" alt="${name}" width="600" height="400"><h3>${name}</h3><p>${text}</p><a href="/services/${slug}/">Learn more</a></div>`;
const PAGES: Record<string, string> = {
  '/': page('Plumber in Austin', `<section class="hero"><h1>Plumbing repairs and water heaters in Austin</h1><p>Licensed plumbers serving Austin homes since 2004, on time and tidy.</p><a class="btn" href="/contact/#quote">Get a free estimate</a> <a class="btn" href="/about/">See our work</a></section>
    <section class="services"><h2>Our services</h2>${card('Drain Cleaning', 'drain-cleaning', 1, 'Kitchen, bath and main-line drains cleared and camera-checked.')}${card('Water Heater Repair', 'water-heaters', 2, 'Tank and tankless water heaters repaired or replaced.')}${card('Leak Detection', 'leak-detection', 3, 'Hidden leaks found without tearing up your walls.')}</section>
    <section><h2>Why Harbor Light</h2><h3>Licensed and insured</h3><p>Every plumber on our team is licensed and insured.</p></section>`,
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Harbor Light Plumbing","telephone":"(512) 482-0142","address":{"@type":"PostalAddress","streetAddress":"410 Congress Ave","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script>'),
  '/services/': page('Services', `<h1>Plumbing services</h1>${card('Drain Cleaning', 'drain-cleaning', 1, 'Kitchen, bath and main-line drains cleared and camera-checked.')}${card('Water Heater Repair', 'water-heaters', 2, 'Tank and tankless water heaters repaired or replaced.')}${card('Leak Detection', 'leak-detection', 3, 'Hidden leaks found without tearing up your walls.')}`),
  '/about/': page('About', '<section class="about"><h2>About us</h2><p>Harbor Light Plumbing was started in 2004 by two brothers who wanted a plumbing company that shows up when it says it will and leaves the house cleaner than it found it.</p><p>Today our team of eight licensed plumbers works across Austin, and most of our customers find us through a neighbour.</p><img src="/img/photo-4.jpg" alt="Our team at work" width="1200" height="800"></section>'),
  '/locations/': page('Locations', '<h1>Our locations</h1><h3>Downtown</h3><p>410 Congress Ave<br>Austin, TX 78701</p><h3>North</h3><p>9500 Burnet Rd<br>Austin, TX 78758</p>'),
  '/contact/': page('Contact', '<h1>Contact</h1><form id="quote" action="/send" method="post"><label for="n">Name</label><input id="n" name="name" required><label for="p">Phone</label><input id="p" name="phone" type="tel" required><textarea name="message" placeholder="How can we help?"></textarea><button type="submit">Request a quote</button></form><p>410 Congress Ave, Austin, TX 78701</p>'),
  '/services/drain-cleaning/': page('Drain Cleaning', '<h1>Drain Cleaning</h1><p>Kitchen, bath and main-line drains cleared, then checked with a camera so the clog does not come back.</p>'),
  '/services/water-heaters/': page('Water Heater Repair', '<h1>Water Heater Repair</h1><p>Tank and tankless water heaters repaired the same day, or replaced with a model sized for your home.</p>'),
  '/services/leak-detection/': page('Leak Detection', '<h1>Leak Detection</h1><p>Hidden leaks found with listening equipment and thermal cameras, without tearing up your walls.</p>'),
  '/flaky/': page('Specials', '<h1>Specials</h1><p>$50 off any water heater install this month. Ask about financing on new systems when you book.</p>'),
  '/privacy-policy/': page('Privacy policy', '<h1>Privacy</h1><p>We keep your details private.</p>'),
  '/private/staff/': page('Staff', '<h1>Staff only</h1>'),
  '/blog/2024/01/winter-pipes/': page('Winter pipes', '<h1>Protect your pipes in winter</h1><p>Some advice.</p>'),
};
const ROBOTS = `User-agent: *\nDisallow: /private/\nSitemap: http://127.0.0.1:${PORT}/sitemap.xml\n`;
const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/services/', '/about/', '/locations/', '/contact/', '/private/staff/', '/privacy-policy/', '/blog/2024/01/winter-pipes/'].map((p) => `<url><loc>http://127.0.0.1:${PORT}${p}</loc></url>`).join('')}</urlset>`;

const hits = new Map<string, number>();
let flakyFailed = false;
const server = http.createServer((req, res) => {
  const p = new URL(req.url!, 'http://x').pathname;
  hits.set(p, (hits.get(p) ?? 0) + 1);
  if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(ROBOTS); }
  if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(SITEMAP); }
  if (p === '/broken/') { res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<h1>Server error</h1>'); }
  if (p === '/flaky/' && !flakyFailed) { flakyFailed = true; res.writeHead(503, { 'content-type': 'text/html' }); return res.end('busy'); }
  if (imgs.has(p)) { res.writeHead(200, { 'content-type': p.endsWith('.png') ? 'image/png' : 'image/jpeg' }); return res.end(imgs.get(p)); }
  if (PAGES[p]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES[p]); }
  if (p.startsWith('/demo-sites/')) {
    const file = path.join(process.cwd(), 'fixtures', 'sites', decodeURIComponent(p.slice('/demo-sites/'.length)), p.endsWith('/') ? 'index.html' : '');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : /\.(jpe?g)$/.test(file) ? 'image/jpeg' : /\.png$/.test(file) ? 'image/png' : /\.css$/.test(file) ? 'text/css' : 'application/octet-stream' }); return res.end(fs.readFileSync(file)); }
  }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>');
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
const SITE = `http://127.0.0.1:${PORT}/`;
test.after(() => server.close());

const statusOf = (inv: any, p: string) => inv.pages.find((x: any) => new URL(x.url).pathname === p);
let first: { jobId: string; snapshotId: string; businessKey: string; revision: number; briefHash: string } | undefined;

test('website route: the site is discovered (menu, sitemap, links), read within its budget, and every page accounted for', async () => {
  const job = await startStudioJob({ website: SITE });
  assert.equal(job.status, 'queued'); // the id comes back before any work is done
  const done = await waitForStudioJob(job.id);
  assert.equal(done.status, 'done', done.error ?? '');
  assert.deepEqual(done.stages.map((s) => s.status), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done']);
  const { brief, inventory } = await getBrief(done.businessKey!, done.revision);
  assert.ok(siteInventory.safeParse(inventory).success && businessBrief.safeParse(brief).success);
  first = { jobId: done.id, snapshotId: done.snapshotId!, businessKey: done.businessKey!, revision: done.revision!, briefHash: done.briefHash! };

  const inv = inventory!;
  for (const p of ['/', '/services/', '/about/', '/locations/', '/contact/']) assert.equal(statusOf(inv, p)?.status, 'read', `${p} read`);
  assert.deepEqual(statusOf(inv, '/').discoveredVia.sort(), ['input', 'link', 'nav', 'sitemap']); // the logo links home from the header
  assert.ok(statusOf(inv, '/services/').discoveredVia.includes('nav') && statusOf(inv, '/services/').discoveredVia.includes('sitemap'));
  assert.match(statusOf(inv, '/private/staff/').reason, /robots\.txt/);
  assert.match(statusOf(inv, '/privacy-policy/').reason, /legal/);
  // what each page holds
  const home = statusOf(inv, '/');
  assert.equal(home.type, 'home');
  assert.ok(home.ctas.some((c: any) => c.label === 'Get a free estimate' && c.kind === 'form' && c.terms === 'free'));
  assert.ok(home.headings.some((h: any) => h.level === 1 && /Plumbing repairs/.test(h.text)));
  assert.ok(home.fonts.includes('Work Sans'));
  assert.ok(home.colors.some((c: any) => c.hex.toUpperCase() === '#0A46A0'));
  const contact = statusOf(inv, '/contact/');
  assert.equal(contact.forms[0].purpose, 'quote');
  assert.deepEqual(contact.forms[0].fields.filter((f: any) => f.required).map((f: any) => f.name), ['name', 'phone']);
  assert.equal(statusOf(inv, '/locations/').type, 'locations');
  assert.ok(inv.links.some((l: any) => l.from === SITE && new URL(l.to).pathname === '/services/'));
  // pictures with their pages and services; none approved without the owner
  const drain = inv.assets.find((a: any) => a.services.includes('Drain Cleaning'));
  assert.ok(drain && drain.outcome === 'usable' && drain.rights === 'unconfirmed' && drain.pages.length >= 2);

  // the brief: facts with sources, nothing invented
  const b = brief!;
  assert.equal(b.route, 'website');
  assert.equal(b.identity.name.value, 'Harbor Light Plumbing');
  assert.equal(b.contact.phone.value, '(512) 482-0142');
  assert.deepEqual(b.services.items.filter((s) => s.primary).map((s) => s.name), ['Drain Cleaning', 'Water Heater Repair', 'Leak Detection']);
  assert.ok(b.services.items.every((s) => s.evidence.length > 0));
  assert.equal(b.locations.status, 'multiple');
  // two addresses and no listing: neither is chosen as the business's address until the owner says
  assert.equal(b.contact.address.value, null);
  assert.equal(b.contact.address.candidates!.length, 2);
  assert.equal(b.locations.primaryId, null);
  assert.ok(b.ownerQuestions.some((q) => q.id === 'q-locations' && q.blocking));
  assert.equal(b.story.status, 'verified');
  assert.match(b.story.value!.text, /two brothers/);
  assert.ok(b.offers.some((o) => o.label === 'Get a free estimate' && o.terms === 'free'));
  assert.ok(b.claims.some((c) => /licensed and insured/i.test(c.value!)));
  assert.equal(b.callsToAction.primary?.label, 'Get a free estimate');
  assert.ok(b.ownerQuestions.some((q) => q.id === 'q-photos-rights' && q.blocking));
  assert.equal(done.qa!.checks.find((c) => c.id === 'deterministic')!.level, 'pass');
  assert.equal(done.qa!.checks.find((c) => c.id === 'provenance')!.level, 'pass');
});

test('partial crawl failure: a page that keeps failing is retried, recorded with why, and the brief is still built', async () => {
  const { inventory } = await getBrief(first!.businessKey, first!.revision);
  const broken = statusOf(inventory, '/broken/');
  assert.equal(broken.status, 'failed');
  assert.equal(broken.httpStatus, 500);
  assert.equal(broken.attempts, 3);
  assert.match(broken.reason, /500/);
  const flaky = statusOf(inventory, '/flaky/');
  assert.equal(flaky.status, 'read'); // failed once (503), read on the second try
  assert.equal(flaky.attempts, 2);
  assert.ok(flaky.offers.some((o: any) => o.terms === 'discount'));
  assert.equal(inventory!.coverage.partial, true);
  assert.equal(inventory!.coverage.failed, 1);
  const job = await getStudioJob(first!.jobId);
  assert.equal(job!.status, 'done');
  assert.equal(job!.qa!.checks.find((c) => c.id === 'coverage')!.level, 'review');
  assert.match(job!.qa!.checks.find((c) => c.id === 'coverage')!.message, /broken/);
});

test('deterministic: the same snapshot gives the same inventory and brief, and keeps the same revision', async () => {
  const snap = (await getSnapshot(first!.snapshotId))!;
  const a = await buildFromSnapshot(snap);
  const b = await buildFromSnapshot(snap);
  assert.deepEqual(a.inventory, b.inventory);
  assert.deepEqual(a.brief, b.brief);
  assert.equal(a.brief.briefHash, first!.briefHash);
  // a rebuild job from the snapshot fetches nothing and lands on the same revision
  const before = [...hits.values()].reduce((x, y) => x + y, 0);
  const re = await waitForStudioJob((await startStudioJob({ fromSnapshot: first!.snapshotId })).id);
  assert.equal(re.status, 'done', re.error ?? '');
  assert.deepEqual(re.stages.slice(0, 6).map((s) => s.status), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal([...hits.values()].reduce((x, y) => x + y, 0), before, 'nothing fetched');
  assert.equal(re.briefHash, first!.briefHash);
  assert.equal(re.revision, first!.revision);
  // a full rerun against the unchanged site: a new snapshot (the flaky page now loads at once), the same brief, the same revision
  const again = await waitForStudioJob((await startStudioJob({ website: SITE })).id);
  assert.equal(again.status, 'done', again.error ?? '');
  assert.notEqual(again.snapshotId, first!.snapshotId);
  assert.equal(again.briefHash, first!.briefHash);
  assert.equal(again.revision, first!.revision);
});

test('interrupted job: it resumes from where it stopped, without fetching finished pages again', async () => {
  const hitsAt = () => new Map(hits);
  const startAt = hitsAt();
  let stopAt: Map<string, number> | undefined;
  const job = await startStudioJob({ website: SITE }, { afterPage: (n) => { if (n >= 4 && !stopAt) { stopAt = hitsAt(); throw new JobInterrupted('stop'); } } });
  const stopped = await waitForStudioJob(job.id);
  assert.equal(stopped.status, 'running'); // as a crashed process leaves it
  const crawl = stopped.stages.find((s) => s.name === 'crawl')!;
  assert.equal(crawl.status, 'running');
  assert.deepEqual(stopped.stages.filter((s) => s.status === 'done').map((s) => s.name), ['identity', 'page_inventory']);
  // the pages this job read before it stopped
  const readBefore = new Set([...stopAt!.entries()].filter(([p, n]) => PAGES[p] && n > (startAt.get(p) ?? 0)).map(([p]) => p));
  assert.ok(readBefore.size >= 3);

  // on start-up, jobs that went quiet are picked up again
  const resumed = await resumeInterruptedJobs({ staleMs: 0 });
  assert.ok(resumed.includes(job.id));
  const done = await waitForStudioJob(job.id);
  assert.equal(done.status, 'done', done.error ?? '');
  assert.equal(done.resumes, 1);
  assert.equal(done.stages.find((s) => s.name === 'identity')!.attempts, 1);
  assert.equal(done.stages.find((s) => s.name === 'crawl')!.attempts, 2);
  // the pages read before the stop were not fetched again (robots and sitemap neither: their stage had finished)
  const after = hitsAt();
  const refetched = [...readBefore].filter((p) => (after.get(p) ?? 0) > (stopAt!.get(p) ?? 0));
  const pagesRead = (await getBrief(done.businessKey!, done.revision)).inventory!.pages.filter((p) => p.status === 'read').length;
  assert.ok(pagesRead >= 6);
  assert.equal(after.get('/robots.txt'), stopAt!.get('/robots.txt'));
  // the pages it had already read before the stop were not read again (images are measured in a later stage)
  assert.deepEqual(refetched.filter((p) => !p.startsWith('/img/')), []);
  assert.equal(done.briefHash, first!.briefHash, 'the same brief as an uninterrupted run');
});

test('Google route, no website: listing facts only; services, brand and story are unknown with owner questions; Google photos kept apart', async () => {
  const done = await waitForStudioJob((await startStudioJob({ google: 'BlueLine Plumbing & Drain Denver' })).id);
  assert.equal(done.status, 'done', done.error ?? '');
  const { brief, inventory } = await getBrief(done.businessKey!, done.revision);
  // the same two documents as the website route
  assert.ok(siteInventory.safeParse(inventory).success && businessBrief.safeParse(brief).success);
  const b = brief!;
  assert.equal(b.route, 'google');
  assert.equal(b.identity.name.value, 'BlueLine Plumbing & Drain');
  assert.equal(b.identity.name.sources[0].sourceType, 'google');
  assert.ok(b.contact.phone.value);
  assert.equal(inventory!.pages.length, 0);
  assert.equal(b.services.status, 'unknown');
  assert.deepEqual(b.services.items, []);
  assert.equal(b.brand.status, 'unknown');
  assert.deepEqual(b.brand.colors, []);
  assert.equal(b.story.status, 'unknown');
  assert.equal(b.story.value, null);
  for (const id of ['q-services', 'q-brand', 'q-story']) assert.ok(b.ownerQuestions.some((q) => q.id === id), id);
  assert.ok(b.unknowns.some((u) => u.field === 'services'));
  // Google photos: references, preview only, credited, never mixed with owner-approved pictures
  const g = inventory!.assets.filter((a) => a.origin === 'google');
  assert.ok(g.length > 0);
  assert.ok(g.every((a) => a.rights === 'google-restricted' && /^google-listing:[A-Za-z0-9_-]+#\d+$/.test(a.url) && !a.attribution.length), 'a Google photo is kept as its place in the listing only: no photo name and no credit is stored');
  assert.equal(b.assets.website.usable, 0);
  assert.ok(b.ownerQuestions.some((q) => q.id === 'q-photos-google'));
  assert.equal(done.qa!.checks.find((c) => c.id === 'rights')!.level, 'pass');
});

test('Google route with a website on the listing: the listing is checked against the site and the site is read', async () => {
  const done = await waitForStudioJob((await startStudioJob({ google: 'Summit Peak Roofing Austin' })).id);
  assert.equal(done.status, 'done', done.error ?? '');
  const { brief, inventory } = await getBrief(done.businessKey!, done.revision);
  assert.equal(brief!.route, 'google');
  assert.ok(inventory!.pages.length >= 1, 'the listing\'s website was read');
  assert.ok(['verified', 'probable'].includes(brief!.identity.status));
});

test('the API returns a job id at once and the job can be watched', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/studio', studioRoutes);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/studio`;
  try {
    const r = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ website: SITE }) });
    assert.equal(r.status, 202);
    const { id } = (await r.json()) as { id: string };
    assert.match(id, /^sj_/);
    const j = (await (await fetch(`${base}/jobs/${id}`)).json()) as { stages: { name: string }[] };
    assert.deepEqual(j.stages.map((s) => s.name), ['identity', 'page_inventory', 'crawl', 'documents', 'assets', 'brand', 'brief', 'qa']);
    await waitForStudioJob(id);
    const bad = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 400);
  } finally { srv.close(); }
});

test('addresses as sites write them: no comma before the city, suites, numbered roads, run-together blocks', () => {
  const t = 'Tarrytown 2401 Winsted Lane Austin, TX 78703 Mon - Wed ORDER NOW Line Hotel 111 E Cesar Chavez Austin, TX 78701 Round Rock 2711 La Frontera Blvd, Ste 320 Round Rock, TX 78681 Located at 20900 FM 1431, Unit #205, Lago Vista, TX 78645';
  assert.deepEqual(findAddresses(t).map((a) => a.formatted), ['2401 Winsted Lane, Austin, TX 78703', '111 E Cesar Chavez, Austin, TX 78701', '2711 La Frontera Blvd, Suite 320, Round Rock, TX 78681', '20900 FM 1431, Unit 205, Lago Vista, TX 78645']);
});
