// Regression: a ZIP search returned a postal code, and the build went on as if "78645" were the business. Covers
// geographic-result rejection, identity checked against the website (a typed URL is not Google's confirmation),
// the website-only fallback, recovery of the website's content, contact accuracy, truthful messages, visible
// extraction failures, the audit's honesty, and re-resolving a saved invalid identity.
// The website is a local fixture that mirrors the structure of the real page that exposed the bug; nothing here is
// specific to that business in the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-identity-'));
Object.assign(process.env, { BRAND_MEASURE: '0', MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', PAGESPEED: '0', RESCORE: '0', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4996' });

const sharp = (await import('sharp')).default;
const { buildSite } = await import('../src/pipeline.js');
const { identifyBusiness } = await import('../src/sources/resolve.js');
const { geographicReason, matchCandidate, sourceView } = await import('../src/sources/identity.js');
const { extractSiteContent, restoreName } = await import('../src/sources/site-content.js');
const { scanWebsite } = await import('../src/sources/website.js');
const { auditWebsite } = await import('../src/audit/audit.js');
const { previewMessage } = await import('../src/content/summary.js');
const { repairIdentity } = await import('../src/repair.js');
const { saveBuild } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const { screenshotsAvailable } = await import('../src/render/og.js');
const { buildBrandProfile, brandCss, profileColors } = await import('../src/sources/brand-profile.js');
const { checkOutput } = await import('../src/content/validate.js');
const { measureBrand } = await import('../src/sources/render-page.js');

const template = fs.readFileSync(new URL('../fixtures/websites/lakeside-clinic.html', import.meta.url), 'utf8');

/** A picture that differs from every other one (so duplicate detection keeps them apart). */
async function picture(n: number, w = 1200, h = 800) {
  const shapes = Array.from({ length: 6 }, (_, i) => `<circle cx="${(n * 97 + i * 211) % w}" cy="${(n * 53 + i * 131) % h}" r="${60 + ((n + i) * 37) % 160}" fill="rgb(${(n * 61 + i * 40) % 255},${(n * 29 + i * 70) % 255},${(n * 83 + i * 25) % 255})"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="rgb(${(n * 40) % 255},${(n * 90) % 255},${(n * 20) % 255})"/>${shapes}<filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed="${n}"/></filter><rect width="${w}" height="${h}" filter="url(#t)" opacity="0.6"/></svg>`)).jpeg({ quality: 80 }).toBuffer();
}
const images = new Map<string, Buffer>();
for (let n = 1; n <= 5; n++) images.set(`/img/photo-${n}.jpg`, await picture(n));
images.set('/img/photo-1-small.jpg', await sharp(images.get('/img/photo-1.jpg')!).resize(1000, 667).jpeg({ quality: 70 }).toBuffer()); // the same picture at another size
for (let n = 1; n <= 5; n++) images.set(`/img/svc-${n}.jpg`, await picture(40 + n, 1200, 900));
for (let n = 1; n <= 3; n++) images.set(`/img/poster-${n}.jpg`, await picture(20 + n, 640, 360));
images.set('/img/logo.png', await sharp({ create: { width: 735, height: 226, channels: 4, background: '#E3B500' } }).png().toBuffer());

let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url!, 'http://x');
  const variant = u.pathname.startsWith('/broken/') ? 'broken' : u.pathname.startsWith('/nophone/') ? 'nophone' : 'main';
  const p = u.pathname.replace(/^\/(broken|nophone)/, '') || '/';
  if (p === '/' || p === '/index.html') {
    let html = template.replaceAll('{{BASE}}', `${base}${variant === 'main' ? '' : `/${variant}`}`);
    // a page whose pictures are gone, and one without any phone number
    if (variant === 'broken') html = html.replace(/\/img\/(photo|poster|svc)-/g, '/gone/$1-');
    if (variant === 'nophone') html = html.replace(/<a href="tel:512-296-3519">512-296-3519<\/a>/g, '').replace(/\| 512-296-3519/g, '').replace(/<span>512-296-3519<\/span>/g, '').replace(/<a href="tel:1-512-630-3723">/g, '<a href="https://example.test/massage">');
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html);
  }
  if (p === '/service-page/skincare-wellness') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><head><meta name="description" content="At Lakeside Chiropracti, we believe in enhancing your wellness journey through holistic care and beauty services, offered by appointment alongside chiropractic care."></head><body><h1>Skincare</h1></body></html>'); }
  if (u.pathname === '/js/') {
    // a page that builds its content in the browser: the HTML as delivered holds none of it
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Harbor Dental | Dentist in Austin</title><div id="app"></div><script>setTimeout(function(){document.getElementById("app").innerHTML="<section><h2>Our Services</h2><div><h3>Cleanings</h3><p>Routine cleaning and exams</p></div><div><h3>Whitening</h3><p>In-office whitening</p></div><div><h3>Implants</h3><p>Replace missing teeth</p></div></section><footer>12 Oak St, Austin TX 78701 512-555-0142</footer>"},50)</script>');
  }
  const img = images.get(p);
  if (img) { res.writeHead(200, { 'content-type': p.endsWith('.png') ? 'image/png' : 'image/jpeg' }); return res.end(img); }
  res.writeHead(404); res.end('not found');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${(server.address() as any).port}`;
server.unref(); // closes with the process: a top-level hook would close it before the tests that need it

const read = (slug: string, f = 'index.html') => fs.readFileSync(path.join(config.dirs.sites, slug, f), 'utf8');
const SERVICES = ['Massage Chair Session', 'Decompression Therapy', 'Chiropractic Adjustment', 'Skincare & Wellness', 'Massage Therapy'];

test('a postal code, town or street is a place, not a business', () => {
  assert.match(geographicReason({ name: '78645', types: ['postal_code', 'political'], primaryType: 'postal_code' })!, /place/);
  assert.match(geographicReason({ name: 'Leander', types: ['locality', 'political'] })!, /place/);
  assert.match(geographicReason({ name: '78645', primaryTypeLabel: 'Postal Code' })!, /Postal Code|postal code/);
  assert.ok(geographicReason({ name: '78645' }), 'a bare postal code name is not a business even without types');
  assert.ok(geographicReason({ name: 'Leander', address: 'Leander, TX 78645, USA' }), 'a name that is just the town it is in is not a business');
  assert.equal(geographicReason({ name: 'Lakeside Chiropractic', types: ['chiropractor', 'health', 'point_of_interest', 'establishment'], primaryType: 'chiropractor' }), undefined);
  assert.equal(geographicReason({ name: 'Joe\'s Plumbing', types: ['plumber', 'establishment', 'locality'] }), undefined, 'a business that also lists a place type is still a business');
});

test('a Google result is accepted on evidence Google reports, and a typed website address is not that evidence', () => {
  const src = sourceView(extractSiteContent(template.replaceAll('{{BASE}}', 'https://www.lagolakesidechiropractic.com'), 'https://www.lagolakesidechiropractic.com/'));
  // the postal code: rejected outright, whatever else is said about it
  assert.equal(matchCandidate({ name: '78645', types: ['postal_code'], address: 'Leander, TX 78645, USA' }, src).verdict, 'rejected');
  // another business in the same town: nothing ties it to the website. (The user's URL is not on the candidate: it is what is being checked.)
  const other = matchCandidate({ name: 'Lago Vista Dental', types: ['dentist'], address: '1 Main St, Lago Vista, TX 78645, USA' }, src);
  assert.equal(other.verdict, 'rejected');
  // Google lists a different website for it: rejected even if the name is close
  assert.equal(matchCandidate({ name: 'Lakeside Fitness', types: ['gym'], googleWebsite: 'https://lakesidefitness.example/' }, src).verdict, 'rejected');
  // the real listing: Google's own website for it, its phone and its address agree. It has no photos or reviews, and that doesn't matter.
  const real = matchCandidate({ name: 'Lakeside Chiropractic Lago Vista', types: ['chiropractor'], phone: '(512) 296-3519', googleWebsite: 'https://www.lagolakesidechiropractic.com/', address: '20900 RM 1431 Ste 205, Lago Vista, TX 78645, USA' }, src);
  assert.equal(real.verdict, 'verified');
  assert.ok(real.evidence.some((e) => /Google lists/.test(e)) && real.evidence.some((e) => /phone/.test(e)));
  // a name alone, with nothing from Google backing it, is not enough
  assert.equal(matchCandidate({ name: 'Lakeside Chiropractic', types: ['chiropractor'] }, src).verdict, 'rejected');
});

test('website-led: the postal code is turned down and the website\'s own details are used', async () => {
  const r = await identifyBusiness({ placeId: 'mock-geo-78645', website: `${base}/` });
  const b = r.business;
  assert.equal(b.source, 'website');
  assert.equal(b.name, 'Lakeside Chiropractic'); // not "78645", and not the truncated "Lakeside Chiropracti" from the og:site_name tag
  assert.equal(b.phone, '(512) 296-3519');
  assert.match(b.formattedAddress!, /20900 FM 1431, Unit #205, Lago Vista, TX 78645/);
  assert.equal(b.city, 'Lago Vista');
  assert.equal(b.identity?.status, 'website-only');
  assert.equal(b.identity?.googleListsWebsite, false);
  assert.ok(b.identity?.rejected.some((x) => x.name === '78645' && /place/.test(x.reason)), 'the postal code is recorded as turned down, with why');
  assert.deepEqual(b.reviews, []); // nothing invented
  assert.equal(b.hours, undefined);
  assert.equal(b.rating, undefined);
});

test('with no website and only a postal code, the build stops and says what to send', async () => {
  await assert.rejects(identifyBusiness({ placeId: 'mock-geo-78645' }), /couldn't confirm which business|postal code|Send the business name/i);
});

const built = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/`, audit: false, screenshot: false });

test('content from the website is recovered and kept: all five services, the booking page, the story, the photographs and the videos', () => {
  assert.equal(built.business.name, 'Lakeside Chiropractic');
  assert.equal(built.business.source, 'website');
  assert.deepEqual([...built.services].sort(), [...SERVICES].sort());
  const html = read(built.slug);
  for (const s of SERVICES) assert.ok(html.includes(s.replace('&', '&amp;')), `${s} is on the page`);
  assert.match(html, /is dedicated to providing comprehensive chiropractic care/); // the clinic's own story, led by its first sentence
  assert.equal((html.match(/data-video /g) || []).length, 3, 'three videos');
  assert.ok(!/Chiropracti[,s]/.test(html), 'no name cut short by the page builder appears');
  assert.equal(restoreName('At Lakeside Chiropracti, we believe in', 'Lakeside Chiropractic'), 'At Lakeside Chiropractic, we believe in');
  assert.equal(restoreName('Lakeside Chiropractic is open', 'Lakeside Chiropractic'), 'Lakeside Chiropractic is open'); // a full name is left alone
  // the line under each service comes from the page, even when the page wraps the heading in a link
  assert.match(html, /Relief and alignment|Relief and Alignment/i);
  assert.match(html, /Patient testimonials/);
  // photographs from the website itself, de-duplicated (the smaller copy of photo 1 is not a sixth picture), with no Google credit
  const files = fs.readdirSync(path.join(config.dirs.sites, built.slug, 'assets'));
  assert.ok(files.some((f) => /^hero|^photo-/.test(f)));
  assert.ok(!/via Google/.test(html));
  const photoRecords = built.extraction!.photos.filter((r) => r.role === 'content');
  assert.ok(photoRecords.some((r) => r.skipped === 'duplicate'), 'the duplicate was noticed and recorded');
  assert.equal(built.extraction!.retention.find((r) => r.what === 'services')!.kept, 5);
  assert.deepEqual(built.review!.checks.filter((c) => c.level !== 'info' && c.id !== 'story-unedited'), []);
});

test('contact details are accurate: the clinic\'s phone, the full address, the main booking page; service destinations stay separate', () => {
  const html = read(built.slug);
  assert.match(html, /tel:\+15122963519/);
  assert.match(html, /\(512\) 296-3519/);
  assert.match(html, /20900 FM 1431, Unit #205, Lago Vista, TX 78645/);
  assert.match(html, /https:\/\/practice\.chirotouch\.com\/portal\/LakesideChiropractic/);
  // the number on one service's own booking button belongs to that service and is not the clinic's phone
  assert.ok(html.includes('tel:1-512-630-3723'));
  assert.ok(!/tel:\+15126303723/.test(html), 'the massage line is not promoted to the main phone');
  const header = html.slice(0, html.indexOf('<main'));
  assert.ok(!header.includes('630-3723'));
  // no placeholder number anywhere, and no invented calendar
  assert.ok(!/\(555\)|555-01\d\d|555\s*010/.test(html), 'no placeholder phone number');
  assert.ok(!/Pick a day|Pick a time|rw-slots|rw-days/.test(html), 'no demo availability');
  assert.match(html, /not a booking|Nothing is booked until/);
  assert.match(html, /Book an appointment|Book online/);
});

test('a business with no phone number gets no invented one: the call panel offers a call back', async () => {
  const r = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/nophone/`, audit: false, screenshot: false, slug: 'no-phone-clinic' });
  assert.equal(r.business.phone, undefined);
  const html = read(r.slug);
  assert.ok(!/tel:/.test(html.replace(/tel:1-512-630-3723/g, '')) || !/tel:\+1\d{10}/.test(html), 'no tel: link for a number that does not exist');
  assert.ok(!/\(555\)|555-01\d\d/.test(html));
  assert.match(html, /Leave your number and .* will call you back|Request a call back/);
});

test('extraction failures are visible, not silent: a page whose pictures are gone is reported and flagged for review', async () => {
  const r = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/broken/`, audit: false, screenshot: false, slug: 'broken-pictures' });
  const photos = r.extraction!.extractors.find((e) => e.name === 'photos')!;
  assert.equal(photos.status, 'failed');
  assert.match(photos.reason, /failed|0 of/i);
  assert.ok(r.extraction!.photos.some((x) => !x.ok && x.error), 'each retrieval failure has a reason');
  assert.equal(r.review!.status, 'needs-review');
  assert.ok(r.review!.checks.some((c) => c.id === 'photos-none'));
  // the services were still read: only what failed is reported as failed
  assert.equal(r.extraction!.extractors.find((e) => e.name === 'services')!.status, 'success');
  // Claude didn't run here (no key): the report says so and why, rather than pretending
  assert.equal(r.extraction!.claude.ran, false);
  assert.match(r.extraction!.claude.fallbackReason!, /not configured/);
  // unknown is not false
  assert.equal(r.facts.licensed, null);
  assert.equal(r.facts.insured, null);
  assert.equal(r.facts.open24h, null); // no hours known: not "false"
});

test('preview messages are written from what was obtained', () => {
  const none = { name: 'Acme', identitySource: 'website' as const, googlePhotos: 0, websitePhotos: 0, googleReviews: 0, hoursKnown: false, services: 0, videos: 0, hasStory: false, bookingLinked: false, hadWebsite: true };
  const m = previewMessage(none, { status: 'ready', checks: [] });
  assert.ok(!/Google photos|Google reviews|reviews and hours/.test(m.replace(/couldn't find[^.]*\./, '')), 'it does not claim what it did not get');
  assert.match(m, /couldn't find photos, reviews and opening hours/);
  assert.match(m, /no Google listing/i);
  const full = previewMessage({ ...none, identitySource: 'google', googlePhotos: 4, googleReviews: 10, hoursKnown: true, services: 5, videos: 2, hasStory: true, bookingLinked: true }, { status: 'ready', checks: [] });
  assert.match(full, /5 services/);
  assert.match(full, /4 photos from your Google profile/);
  assert.match(full, /2 videos/);
  assert.match(full, /existing online booking page/);
  assert.ok(!/couldn't find/.test(full));
  // what the real build said
  const card = built.cards.find((c) => c.kind === 'site-preview')!;
  assert.ok(!/reviews/.test(card.text.replace(/couldn't find[^.]*\./, '')), 'the clinic had no Google reviews to use');
  assert.match(card.text, /5 services/);
});

test('the audit separates measured faults from risks, advice and unknowns, and respects decorative images', async () => {
  const scan = await scanWebsite(`${base}/`, { render: 'never' });
  const b = (await identifyBusiness({ placeId: 'mock-geo-78645', website: `${base}/` }, { scan })).business;
  const a = await auditWebsite(scan, b, { measure: false, summarize: false, scores: async () => ({}) });
  const id = (x: string) => a.issues.find((i) => i.id === x);
  // the audited place is the validated one: the town is Lago Vista, never the postal code's Leander
  assert.ok(!a.issues.some((i) => /Leander/.test(`${i.title} ${i.detail}`)));
  // title length is advice and does not move the score
  assert.equal(id('title-long')?.basis, 'suggestion');
  // empty alt text marks a decorative picture: it is not reported as missing
  assert.ok(!id('alt') || !/no alt/.test(id('alt')!.detail.replace(/decorative/g, '')) || id('alt')!.detail.startsWith('1 of'), 'only a missing alt attribute counts');
  assert.ok(a.passed.some((p) => /decorative/.test(p)) || !id('alt'));
  // analytics that can't be seen in static HTML is unknown, not "none installed"
  assert.ok(!id('analytics'));
  assert.ok(a.unknowns.some((u) => u.id === 'analytics'));
  // layout shift is a risk from missing attributes (the fixture images declare sizes, so none here), never reported as measured
  assert.notEqual(id('img-dims')?.basis, 'measured');
  // a fixed-width risk read from the source and not tested on a phone is labelled as such
  assert.notEqual(id('fixed-layout')?.basis, 'measured');
  // the partial image sample is a lower bound and is listed as not fully measured
  assert.ok(a.unknowns.some((u) => u.id === 'page-weight') || a.metrics.imagesMeasured === a.metrics.images);
  // score counts measured faults fully, risks at half and advice not at all
  const only = a.issues.filter((i) => i.basis !== 'suggestion');
  assert.ok(a.score <= 100 && a.score > 0 && only.length >= 0);
  // the pitch names where the preview comes from
  const withSummary = await auditWebsite(scan, b, { measure: false, summarize: true, scores: async () => ({}) });
  assert.match(withSummary.summary.pitch || 'from your website', /from your website/);
});

test('a saved site with an invalid identity is re-resolved and its static output regenerated at the same address', async () => {
  const slug = 'old-78645-leander';
  fs.mkdirSync(path.join(config.dirs.sites, slug), { recursive: true });
  fs.writeFileSync(path.join(config.dirs.sites, slug, 'index.html'), '<h1>78645</h1><p>Postal Code in Leander</p>');
  await saveBuild({
    id: 'old1', createdAt: new Date().toISOString(), source: 'imessage', status: 'done',
    result: { slug, siteUrl: `${config.publicBaseUrl}/sites/${slug}/`, business: { placeId: 'mock-geo-78645', name: '78645', primaryTypeLabel: 'Postal Code', formattedAddress: 'Leander, TX 78645, USA', website: `${base}/` } } as any,
    input: { placeId: 'mock-geo-78645', website: `${base}/`, themeSource: 'auto', preview: true },
  });
  const nothing = await repairIdentity({ slug: built.slug });
  assert.equal(nothing.repaired, false); // a real business needs no repair
  const r = await repairIdentity({ slug }, { screenshot: false });
  assert.equal(r.repaired, true, r.message);
  assert.equal(r.build!.business.name, 'Lakeside Chiropractic');
  assert.equal(r.build!.slug, slug); // the same address
  const html = read(slug);
  assert.ok(!/<h1>78645<\/h1>/.test(html) && !/Postal Code in Leander/.test(html), 'the old pages are gone');
  assert.match(html, /Lakeside Chiropractic/);
  assert.match(html, /Massage Chair Session/);
});

test('a page that builds its content in the browser is read after its scripts run, and says so', { skip: !screenshotsAvailable() && 'no browser available here' }, async () => {
  const plain = await scanWebsite(`${base}/js/`, { render: 'never' });
  assert.equal(plain.content!.services.length, 0, 'the HTML as delivered has no services');
  assert.equal(plain.content!.report.find((r) => r.name === 'services')!.status, 'failed');
  const scan = await scanWebsite(`${base}/js/`);
  assert.equal(scan.rendered, true);
  assert.deepEqual(scan.content!.services.map((x) => x.name), ['Cleanings', 'Whitening', 'Implants']);
  assert.equal(scan.content!.report.find((r) => r.name === 'rendered page')!.status, 'success');
});

const browser = !screenshotsAvailable() && 'no browser available here';

test('service pictures stay with their services, cropped to one shape, with a focal point', async () => {
  const r = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/`, audit: false, screenshot: false, slug: 'service-pictures' });
  const html = read(r.slug);
  const cards = html.match(/<li class="f-svc-card">[\s\S]*?<\/li>/g) || [];
  assert.equal(cards.length, 5, 'one card per service');
  const byName = (n: string) => cards.find((c) => c.includes(n))!;
  for (const n of SERVICES) {
    const c = byName(n.replace('&', '&amp;'));
    assert.match(c, /<div class="f-svc-media"><img src="assets\/svc-\d\.webp" width="900" height="562" alt="[^"]*"/, `${n}: a 16:10 picture of its own`);
    assert.match(c, /object-position:\d+% \d+%/, `${n}: its focal point`);
  }
  // an alt that only restates the heading is decorative; one that adds something stays
  assert.match(byName('Massage Chair Session'), /alt="" loading/);
  assert.match(byName('Decompression Therapy'), /alt="Spinal decompression therapy table"/);
  // each card's own booking destination
  assert.match(byName('Massage Therapy'), /href="tel:1-512-630-3723"[^>]*>Call to book/);
  assert.match(byName('Chiropractic Adjustment'), /href="https:\/\/practice\.chirotouch\.com\/portal\/LakesideChiropractic"[^>]*>Book online/);
  // "No appointment necessary": the card offers the way there, not a booking button
  assert.doesNotMatch(byName('Massage Chair Session'), /Book online/);
  assert.match(byName('Massage Chair Session'), />(Get directions|Visit us)/);
  // the same booking button on three or more cards is a quiet link on each card (the hero carries the button)
  assert.match(byName('Chiropractic Adjustment'), /class="f-svc-link"/);
  // the pictures are saved with the service, with the uncropped copy for re-cropping
  const draft = (await (await import('../src/drafts.js')).findDraft({ slug: r.slug }))!;
  const adj = draft.offerings.find((o: any) => o.name === 'Chiropractic Adjustment')!;
  assert.equal(adj.image!.source, 'website');
  assert.ok(adj.image!.original && adj.image!.sourceUrl && adj.image!.focal.x > 0 && adj.image!.focal.y > 0);
  assert.equal(adj.contact, undefined);
  assert.ok(draft.offerings.find((o: any) => o.name === 'Massage Therapy')!.contact!.url === 'tel:1-512-630-3723');
  assert.ok(fs.existsSync(path.join(config.dirs.sites, r.slug, adj.image!.path)));
  // cards use the page's variables: 20px corners, white surface, gold button with blue lettering when the brand says so
  assert.match(html, /\.f-svc-card\{[^}]*border-radius:20px/);
  assert.match(html, /\.f-svc-grid\{[^}]*gap:24px/);
  assert.match(html, /\.f-svc-media\{aspect-ratio:16\/10/);
});

test('a page without usable pictures keeps its services as a list, and a lost picture is a finding', async () => {
  const r = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/broken/`, audit: false, screenshot: false, slug: 'no-service-pictures' });
  const html = read(r.slug);
  assert.ok(!/class="f-svc-card"/.test(html), 'no cards without pictures');
  for (const s of SERVICES) assert.ok(html.includes(s.replace('&', '&amp;')), `${s} is still listed`);
  const c = r.review!.checks.find((x) => x.id === 'service-images-lost')!;
  assert.ok(c, 'the lost pictures are reported');
  assert.equal(r.serviceImages!.filter((x) => x.ok).length, 0);
  // the output check also fails a page that dropped pictures it had, or the brand colours it was given
  const ok = '<li class="f-svc-card"><div class="f-svc-media"><img src="a"></div></li>'.repeat(5) + '<style>:root{--brand:#E4B600;--heading:#0828B9}</style>';
  assert.deepEqual(checkOutput(ok, { services: [], serviceImages: 5, brandColors: ['#0828B9', '#E4B600'] }), []);
  const lostPictures = checkOutput(ok.replace(/<li class="f-svc-card">[\s\S]*?<\/li>/, ''), { services: [], serviceImages: 5 });
  assert.ok(lostPictures.some((x) => x.id === 'output-service-images' && x.level === 'block'));
  const lostBrand = checkOutput('<style>:root{--brand:#166534}</style>', { services: [], brandColors: ['#0828B9', '#E4B600'] });
  assert.ok(lostBrand.some((x) => x.id === 'output-brand' && /#0828B9/.test(x.message)));
});

test('the brand is read from the website\'s rendered styles, with evidence, and applied in its roles', { skip: browser }, async () => {
  const raw = await measureBrand(`${base}/`);
  const p = buildBrandProfile(raw, { logoColors: ['#E3B500'], sourceUrl: base });
  assert.equal(p.method, 'rendered');
  assert.equal(p.primary!.hex, '#0828B9');
  assert.ok(['high', 'medium'].includes(p.primary!.confidence), 'a small page still reads with at least medium confidence');
  assert.ok(p.primary!.evidence.length >= 2 && p.primary!.evidence.every((e) => e.where && e.detail), 'the source elements are recorded');
  assert.equal(p.secondary!.hex, '#E4B600');
  assert.deepEqual(p.button && { fill: p.button.fill, text: p.button.text }, { fill: '#E4B600', text: '#0828B9' });
  assert.ok(p.button!.radius >= 50, 'the page\'s pill buttons');
  assert.equal(p.typography!.heading!.kind, 'sans');
  assert.equal(p.typography!.substitution!.body!.to, 'Nunito Sans');
  assert.match(p.typography!.substitution!.body!.reason, /licensed|custom|closest/);
  // a logo alone doesn't define the palette: a different logo colour leaves the page's colours in charge
  const other = buildBrandProfile(raw, { logoColors: ['#00AA55'], sourceUrl: base });
  assert.equal(other.primary!.hex, '#0828B9');
  // the roles: headings and bands blue, buttons gold lettered in blue, white surfaces
  const css = brandCss(p);
  assert.equal(css.tokens['--heading'], '#0828B9');
  assert.equal(css.tokens['--band'], '#0828B9');
  assert.equal(css.tokens['--brand'], '#E4B600');
  assert.equal(css.tokens['--brand-ink'], '#0828B9');
  assert.equal(css.tokens['--surface'], '#FFFFFF');
  assert.match(css.tokens['--font-heading'], /Inter/);
  assert.match(css.tokens['--font-body'], /Nunito Sans/);
  assert.deepEqual(profileColors(p).sort(), ['#0828B9', '#E4B600']);
  // and it reaches a built page, with the substitution on record
  process.env.BRAND_MEASURE = '1';
  try {
    const r = await buildSite({ placeId: 'mock-geo-78645', website: `${base}/`, audit: false, screenshot: false, slug: 'brand-clinic' });
    const html = read(r.slug);
    assert.match(html, /<style id="rg-brand">:root\{[^}]*--brand:#E4B600[^}]*--heading:#0828B9/);
    assert.equal(r.brandProfile!.primary!.hex, '#0828B9');
    assert.deepEqual(r.review!.checks.filter((c) => c.level !== 'info' && c.id !== 'story-unedited'), []); // (without Claude the About text is unedited, which is a finding)
    assert.ok(r.extraction!.extractors.some((e) => e.name === 'brand' && e.status === 'success' && /#0828B9/.test(e.reason)));
    assert.ok(html.includes('family=Nunito+Sans') && html.includes('family=Inter'), 'the substituted typefaces are loaded');
    const d = (await (await import('../src/drafts.js')).findDraft({ slug: r.slug }))!;
    assert.equal(d.base.brandProfile!.secondary!.hex, '#E4B600');
  } finally { process.env.BRAND_MEASURE = '0'; }
});

test('logos are shown whole at every width', () => {
  const css = fs.readFileSync(new URL('../src/render/family-css.ts', import.meta.url), 'utf8');
  for (const c of ['fe', 'fw', 'fb']) assert.match(css, new RegExp(`\\.${c}-logo-img\\{[^}]*max-width:100%;object-fit:contain`));
});
