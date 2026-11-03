import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fitFor, usesOf, graphicKind } from '../src/design/image-fit.js';
import { buildOffers, type ServiceRecord } from '../src/evidence.js';
import { config } from '../src/config.js';
import { deliverLead, configuredChannels, ownerEmailOf } from '../src/lead-delivery.js';
import { publishReadiness } from '../src/design/content.js';
import { confirmServiceImages } from '../src/design/offerings.js';
import type { Lead } from '../src/store.js';

test('image fit: the frame decides — a 783×432 photo suits a card, not a hero; nothing is enlarged', () => {
  assert.equal(fitFor(783, 432, 'card').level, 'sharp');
  assert.equal(fitFor(783, 432, 'hero').level, 'undersized');
  assert.deepEqual(usesOf(783, 432), ['card', 'gallery']);
  assert.ok(usesOf(1920, 1080).includes('hero'));
  // a tall 510×590 original keeps its own size: its 16:10 crop is 510 wide, acceptable on a 390px card, never stretched to fill
  const tall = fitFor(510, 590, 'card');
  assert.deepEqual(tall.crop, { width: 510, height: 319 });
  assert.equal(tall.level, 'acceptable');
  assert.equal(fitFor(300, 200, 'card').level, 'undersized');
  assert.deepEqual(usesOf(300, 200), []);
});

test('image outcomes are different things: icons, maps and graphics are not photographs', () => {
  assert.equal(graphicKind('https://x.test/wp-content/uploads/counter_2_3.svg', { width: 60, height: 60 }), 'icon');
  assert.equal(graphicKind('https://x.test/a/Susan.png', { width: 120, height: 120 }), 'icon');
  assert.equal(graphicKind('https://x.test/a/round-rock-map-Google-Search.png', { width: 651, height: 336 }), 'map');
  assert.equal(graphicKind('https://x.test/a/AUstin.png', { width: 644, height: 343, places: ['Round Rock', 'Austin'] }), 'map');
  assert.equal(graphicKind('https://x.test/a/Screenshot-2024-07-26.png', { width: 1304, height: 680 }), 'graphic');
  assert.equal(graphicKind('https://x.test/a/Roofers-Installing-Asphalt-Shingles.jpg', { width: 1080, height: 720, places: ['Austin'] }), undefined);
});

const svc = (name: string, destination: string, description?: string): ServiceRecord => ({ id: name.toLowerCase().replace(/\W+/g, '-'), canonicalName: name, aliases: [], priority: 1, sourcePages: [], destination, imageIds: [], isPrimary: true, status: 'verified', mentions: [], ...(description ? { description: { value: description, sourceUrl: 'https://x.test/', sourceType: 'website', observedAt: '', confidence: 1, status: 'verified' as const } } : {}) });

test('an offer applies to a service only where the business shows it there; a shared word proves nothing', () => {
  const hero = { primary: { label: 'Get a free roof inspection', href: 'https://x.test/#contact', kind: 'form', terms: 'free' } };
  const crawl = [
    { url: 'https://x.test/services/inspections/', type: 'services' as const, ok: true, status: 200, headings: [], cards: [], images: [], ctas: [{ label: 'Get a Free Roof Inspection', href: 'https://x.test/#contact' }], text: '' },
    { url: 'https://x.test/services/roof-repair/', type: 'services' as const, ok: true, status: 200, headings: [], cards: [], images: [], ctas: [{ label: 'Call us', href: 'tel:5125550100' }], text: 'We repair roofs of every kind.' },
  ];
  const services = [svc('Roof Inspections', 'https://x.test/services/inspections/'), svc('Roof Repair', 'https://x.test/services/roof-repair/'), svc('Roof Replacement', 'https://x.test/services/replacement/'), svc('Insurance Claims', 'https://x.test/claims/', 'Roof damage documentation. Get a free roof inspection first.')];
  const [offer] = buildOffers({ homeUrl: 'https://x.test/', hero, crawl, services });
  assert.deepEqual(offer.eligible.map((e) => e.service).sort(), ['Insurance Claims', 'Roof Inspections']);
  // "roof" is in the names of Roof Repair and Roof Replacement, but nothing shows the offer there
  assert.ok(!offer.eligible.some((e) => /repair|replacement/i.test(e.service)));
  assert.ok(offer.eligible.every((e) => e.evidenceUrl && e.locator));
  assert.equal(offer.terms, 'free');
});

const lead: Lead = { slug: 's', at: new Date().toISOString(), name: 'Pat', phone: '(512) 555-0100', message: 'hi' };
function server(handler: (req: http.IncomingMessage, body: string) => { status: number; json?: unknown }) {
  const calls: { url?: string; body: string; auth?: string }[] = [];
  const s = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      calls.push({ url: req.url, body, auth: req.headers.authorization });
      const r = handler(req, body);
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.json ?? {}));
    });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => void }>((ok) => s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, calls, close: () => s.close() })));
}

test('lead delivery: a webhook\'s answer, not the save, decides whether the business got it', async () => {
  const keep = { w: config.leadWebhook, k: process.env.RESEND_API_KEY, f: process.env.LEAD_FROM_EMAIL, a: process.env.RESEND_API_URL, n: process.env.LEAD_NOTIFY_EMAIL };
  try {
    delete process.env.RESEND_API_KEY; (config as { leadWebhook: string }).leadWebhook = '';
    assert.deepEqual(configuredChannels('owner@x.test'), []);
    const none = await deliverLead(lead, { business: 'X' });
    assert.equal(none.confirmed, false); // nothing configured: saved, but not delivered
    assert.deepEqual(none.attempts, []);

    const ok = await server(() => ({ status: 200 }));
    (config as { leadWebhook: string }).leadWebhook = `${ok.url}/hook`;
    const sent = await deliverLead(lead, { business: 'X' });
    assert.equal(sent.confirmed, true);
    assert.equal(sent.attempts[0].status, 'delivered');
    assert.equal(JSON.parse(ok.calls[0].body).name, 'Pat');
    ok.close();

    const bad = await server(() => ({ status: 500 }));
    (config as { leadWebhook: string }).leadWebhook = `${bad.url}/hook`;
    const failed = await deliverLead(lead, { business: 'X' });
    assert.equal(failed.confirmed, false);
    assert.equal(failed.attempts[0].status, 'failed');
    bad.close();
    (config as { leadWebhook: string }).leadWebhook = 'http://127.0.0.1:1/unreachable';
    assert.equal((await deliverLead(lead, { business: 'X' })).confirmed, false);
  } finally {
    (config as { leadWebhook: string }).leadWebhook = keep.w;
    for (const [k, v] of [['RESEND_API_KEY', keep.k], ['LEAD_FROM_EMAIL', keep.f], ['RESEND_API_URL', keep.a], ['LEAD_NOTIFY_EMAIL', keep.n]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('lead delivery: email goes to the business\'s own address and is "accepted" by the provider, not "delivered"', async () => {
  const keep = { w: config.leadWebhook };
  const mail = await server(() => ({ status: 200, json: { id: 'em_123' } }));
  try {
    (config as { leadWebhook: string }).leadWebhook = '';
    process.env.RESEND_API_KEY = 'test-key'; process.env.LEAD_FROM_EMAIL = 'Roger <leads@roger.test>'; process.env.RESEND_API_URL = mail.url;
    assert.deepEqual(configuredChannels(undefined), []); // no address to send to
    assert.deepEqual(configuredChannels('owner@x.test'), ['email']);
    const r = await deliverLead({ ...lead, email: 'pat@x.test' }, { business: 'Acme', ownerEmail: 'owner@x.test' });
    assert.equal(r.confirmed, true);
    assert.equal(r.attempts[0].status, 'accepted');
    const sent = JSON.parse(mail.calls[0].body);
    assert.deepEqual(sent.to, ['owner@x.test']);
    assert.equal(sent.reply_to, 'pat@x.test');
    assert.equal(mail.calls[0].auth, 'Bearer test-key');
    assert.equal(ownerEmailOf({ facts: { email: { value: 'o@x.test', review: { status: 'omitted' } } } }), undefined); // left out by the owner
  } finally {
    mail.close(); (config as { leadWebhook: string }).leadWebhook = keep.w;
    delete process.env.RESEND_API_KEY; delete process.env.LEAD_FROM_EMAIL; delete process.env.RESEND_API_URL;
  }
});

test('publication is blocked until enquiries have somewhere to go and a test arrived, and until picture rights are confirmed', () => {
  const content = { facts: {}, media: [{ key: 'p_aaaaaa', source: 'google', publishable: false, order: 0 }, { key: 'p_bbbbbb', source: 'website', publishable: false, order: 1 }], revision: 1 } as any;
  const img = { path: 'a', width: 900, height: 562, focal: { x: 0.5, y: 0.5 }, alt: '', source: 'website' as const };
  const offerings = [{ id: 'roof', name: 'Roof', price: { kind: 'quote', currency: 'USD' }, source: 'website', image: img }] as any;
  const blockers = (o: any, review: any) => publishReadiness(content, o, review).filter((x) => x.level === 'blocker').map((x) => x.key);
  const b = blockers(offerings, { checks: [], leadTested: false, leadNotified: false });
  for (const k of ['lead-delivery', 'lead-test', 'media', 'media-website', 'service-images']) assert.ok(b.includes(k), k);
  const confirmed = confirmServiceImages(offerings);
  assert.ok(!blockers(confirmed, { leadTested: true, leadNotified: true }).includes('service-images'));
  // Google photos can't be confirmed as the owner's: leaving them out (or uploading) is the way through
  content.media[0].role = 'omit';
  assert.ok(!blockers(confirmed, { leadTested: true, leadNotified: true }).includes('media'));
});

import { featuredService } from '../src/evidence.js';
test('one card carries the offer button: the service sent to the booking form; the rest keep the association but link to the service', () => {
  const hero = { primary: { label: 'Get a free roof inspection', href: '#form', kind: 'form', terms: 'free' } };
  const services = [{ ...svc('Roof Replacement', 'https://x.test/roofing/'), priority: 1 }, { ...svc('Roof Inspections', 'https://x.test/#book_now'), priority: 3 }, { ...svc('Roof Repair', 'https://x.test/roofing/'), priority: 2 }];
  const crawl = [{ url: 'https://x.test/roofing/', type: 'services' as const, ok: true, status: 200, headings: [], cards: [], images: [], ctas: [{ label: 'Free Roof Inspection', href: '#form' }] }];
  const [offer] = buildOffers({ homeUrl: 'https://x.test/', hero, crawl, services });
  assert.equal(offer.eligible.length, 3); // the data keeps every association the evidence supports
  assert.equal(featuredService(offer, services), 'inspection roof'); // but the design shows the button once
  assert.equal(featuredService(undefined, services), undefined);
});

import { contentFromBuild, contentSchema } from '../src/design/content.js';
test('a long image caption from a website never invalidates the saved business details', () => {
  const long = 'A very long description of a photograph that a website author pasted into the alt attribute, '.repeat(5);
  const b = { name: 'Acme', placeId: 'x', source: 'website', phone: '(512) 555-0100', nearbyTowns: [] } as any;
  const f = { city: 'Austin', licensed: false, insured: false, warranty: false, open24h: false, emergency: false, maintenance: false, serviceAreas: [], notes: [], source: 'heuristic' } as any;
  const c = contentFromBuild(b, f, [{ key: 'p_abcdef', image: { alt: long, publicPath: 'assets/a.webp', source: 'website' }, width: 900, height: 600 } as any], { sample: false, fetchedAt: new Date().toISOString() });
  assert.ok(contentSchema.safeParse(c).success);
  assert.ok(c.media[0].alt.length <= 160);
});

import sharp from 'sharp';
import { looksLikeArtwork } from '../src/sources/site-images.js';
test('artwork (a badge, an illustration, a sticker) is told apart from a photograph', async () => {
  const w = 400, h = 300;
  // a "photograph": opaque, every pixel different
  const noise = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; noise[i] = (x * 255 / w + Math.sin(y / 9) * 30 + (x * y % 13)) & 255; noise[i + 1] = (y * 255 / h + Math.cos(x / 11) * 40 + (x * y % 7)) & 255; noise[i + 2] = ((x + y) * 255 / (w + h) + Math.sin((x - y) / 17) * 50 + (x % 5)) & 255; }
  const photo = await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
  // a badge: flat colours on a transparent ground
  const badge = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 200, g: 60, b: 40, alpha: 1 } } }).png().toBuffer(), left: 100, top: 50 }]).png().toBuffer();
  // an opaque flat illustration
  const flat = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 160, b: 150 } } }).png().toBuffer();
  assert.equal(await looksLikeArtwork(photo), false);
  assert.equal(await looksLikeArtwork(badge), true);
  assert.equal(await looksLikeArtwork(flat), true);
  // a black-and-white photograph: few colours, many tones; a grey logo: few tones
  const bw = await sharp(photo).greyscale().jpeg().toBuffer();
  assert.equal(await looksLikeArtwork(bw), false);
  const greyLogo = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 240 } } }).composite([{ input: await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 40, g: 40, b: 40 } } }).png().toBuffer(), left: 100, top: 90 }]).png().toBuffer();
  assert.equal(await looksLikeArtwork(greyLogo), true);
});
