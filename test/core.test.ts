import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLookupInput, resolveLookupInput } from '../src/sources/maps-url.js';
import { checkBrandColor, deriveScale } from '../src/color/palette.js';
import { contrast } from '../src/color/oklch.js';
import { loadThemes, validateTheme } from '../src/theme/load.js';
import { fillPlaceholders } from '../src/util/text.js';
import { compactHours } from '../src/content/model.js';
import { is24h } from '../src/sources/places.js';
import { ROOT, config } from '../src/config.js';
import { selectTheme } from '../src/theme/select.js';
import { pickServices } from '../src/content/services.js';
import { friendlyDuration } from '../src/estimate.js';
import { projectName, rewriteForPublish } from '../src/publish.js';
import { PACKAGE_THEMES } from '../src/theme/package-themes.js';
import { themeFiles } from '../scripts/theme-manifest.js';

const theme = () => structuredClone(loadThemes().get('roofing-urgent')!.theme);

test('Google Maps inputs are parsed', () => {
  assert.deepEqual(parseLookupInput('ChIJN1t_tDeuEmsRUsoyG83frY4'), { kind: 'placeId', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
  const long = parseLookupInput('https://www.google.com/maps/place/Summit+Peak+Roofing/@30.2457,-97.7801,17z/data=!3m1!4b1!4m6!3m5!1s0x8644b4e3f:0x1a2b3c!8m2!3d30.2458!4d-97.7802');
  assert.equal(long.kind, 'text');
  if (long.kind === 'text') { assert.equal(long.query, 'Summit Peak Roofing'); assert.equal(long.lat, 30.2458); assert.equal(long.cid, BigInt('0x1a2b3c').toString()); }
  assert.equal(parseLookupInput('https://maps.app.goo.gl/AbCdEf123').kind, 'short');
  assert.deepEqual(parseLookupInput('https://www.google.com/maps/search/?api=1&query=Joe&query_place_id=ChIJabcdefghijklmnopqrstu'), { kind: 'placeId', placeId: 'ChIJabcdefghijklmnopqrstu' });
  assert.deepEqual(parseLookupInput("Joe's Roofing 78704"), { kind: 'text', query: "Joe's Roofing 78704" });
});

test('a maps.app.goo.gl short link is followed as a plain client (a browser gets a page with no address)', async () => {
  const long = 'https://www.google.com/maps/place/TLT+-+The+Last+Tribe+Rooftop/@31.51,74.35,15z/data=!4m7!3m6!1s0x3919050731a2ae49:0x6ff91d1e604c0b3f!8m2!3d31.5086248!4d74.3506163';
  const real = globalThis.fetch;
  const seen: string[] = [];
  // Google's behaviour as of 2026-11: a browser identity gets a 200 script page, a plain client gets the 302
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const ua = String((init?.headers as Record<string, string>)?.['user-agent'] ?? '');
    seen.push(ua);
    return /Mozilla/.test(ua) ? new Response('<!doctype html><html><body><script>/* loads the place */</script></body></html>', { status: 200 }) : new Response(null, { status: 302, headers: { location: long } });
  }) as typeof fetch;
  try {
    const intent = await resolveLookupInput('https://maps.app.goo.gl/tVkK1prMGBSq8A6MA');
    assert.equal(intent.kind, 'text');
    if (intent.kind === 'text') { assert.equal(intent.query, 'TLT - The Last Tribe Rooftop'); assert.equal(intent.cid, BigInt('0x6ff91d1e604c0b3f').toString()); assert.equal(intent.lat, 31.5086248); }
    assert.ok(!/Mozilla/.test(seen[0]), 'the first request is not a browser');
  } finally {
    globalThis.fetch = real;
  }
});

test('all 36 package themes validate (5 trades + general, 6 layouts each)', () => {
  const themes = [...loadThemes().values()].filter((t) => t.origin === 'package');
  assert.equal(themes.length, 36);
  const ids = new Set(themes.map((t) => t.id));
  for (const v of ['roofing', 'hvac', 'plumbing', 'electrical', 'landscaping', 'general']) for (const l of ['urgent', 'showcase', 'trust', 'estimate', 'classic', 'minimal']) assert.ok(ids.has(`${v}-${l}`), `${v}-${l}`);
  for (const t of themes.filter((x) => x.vertical === 'general')) assert.deepEqual(t.warnings, [], t.id);
});

const biz = (o: Record<string, unknown>) => ({ name: 'Biz', types: [], reviews: [], photos: [], rating: 4.2, reviewCount: 12, phone: '+15125550100', ...o }) as any;
const noFacts = { open24h: false, emergency: false } as any;

test('businesses outside the five trades get a general theme, never a trade\'s', () => {
  const gym = selectTheme(biz({ name: 'Level Up Fitness Club', primaryType: 'fitness_center', primaryTypeLabel: 'Fitness center', types: ['fitness_center', 'gym'] }), noFacts, 0);
  assert.equal(gym.entry.vertical, 'general');
  assert.match(gym.reason, /Fitness center/);
  // name keywords only count when Google's category is vague
  assert.equal(selectTheme(biz({ name: 'Rooftop Bar', primaryType: 'bar', types: ['bar'] }), noFacts, 0).entry.vertical, 'general');
  assert.equal(selectTheme(biz({ name: 'ABC Roofing', primaryType: 'general_contractor', types: ['general_contractor'] }), noFacts, 0).entry.vertical, 'roofing');
  assert.equal(selectTheme(biz({ name: 'Joe', primaryType: 'plumber', types: ['plumber'] }), noFacts, 0).entry.vertical, 'plumbing');
});

test('services: the business\'s own list wins, the theme list is only a fallback', () => {
  const roof = theme();
  const own = [
    { name: 'Emergency roof tarping', description: 'Same-day tarps after storms.', icon: 'cloud-lightning' },
    { name: 'Commercial roofing', description: 'Flat and low-slope roofs.', icon: 'not-an-icon' },
    { name: 'Roof inspections', description: 'Photo reports.', icon: 'search' },
  ];
  const r = pickServices(roof, biz({}), undefined, [], {}, { own });
  assert.equal(r.source, 'business');
  assert.deepEqual(r.items.map((i) => i.label), own.map((s) => s.name));
  assert.equal(r.items[1].icon, 'circle-check'); // unknown icon falls back
  const few = pickServices(roof, biz({}), undefined, [], {}, { own: own.slice(0, 1) });
  assert.equal(few.source, 'theme'); // below sectionRules.services.min: theme's standard list
  const general = structuredClone(loadThemes().get('general-classic')!.theme);
  const none = pickServices(general, biz({}), undefined, [], {}, { own: own.slice(0, 1) });
  assert.equal(none.hidden, true); // no standard list to fall back to: hide rather than invent
});

test('uploader accepts unknown keys (with a warning) and rejects broken themes', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/hvac/hvac-trust.theme.json'), 'utf8'));
  const ok = validateTheme({ ...raw, designerNotes: 'new field' });
  assert.ok(ok.ok);
  assert.ok(ok.warnings.some((w) => w.includes('designerNotes')));
  const bad = structuredClone(raw);
  bad.palette.brand = 'blue';
  const r = validateTheme(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('palette.brand')));
});

test('brand color rules: reject gray and neon, darken until contrast passes', () => {
  const t = theme();
  assert.equal(checkBrandColor('#777777', t).ok, false); // near-gray
  assert.equal(checkBrandColor('#FF00FF', t).ok, false); // neon (OKLCH chroma ≈ 0.32 > maxChroma 0.3)
  // Note: pure #00FF00 has chroma ≈ 0.295, so maxChroma 0.3 lets it through; it then gets darkened for contrast.
  const mid = checkBrandColor('#E8742B', t); // orange: too light for white text → darkened
  assert.ok(mid.ok);
  assert.ok(contrast(mid.hex, mid.ink) >= t.derive.minButtonContrast);
  const navy = checkBrandColor('#1D3F6E', t);
  assert.ok(navy.ok && navy.hex === '#1D3F6E' && navy.ink === '#FFFFFF');
  const { tints, shades } = deriveScale('#1D3F6E', t);
  assert.equal(tints.length, 3); assert.equal(shades.length, 3);
});

test('only declared placeholders are filled; missing ones are reported', () => {
  const r = fillPlaceholders('{business} in {city}, {state} {foo}', { business: 'Acme', city: 'Austin' }, ['{business}', '{city}', '{state}']);
  assert.equal(r.text, 'Acme in Austin, {state} {foo}');
  assert.deepEqual(r.missing, ['state']);
});

test('hours helpers', () => {
  assert.ok(is24h([{ open: { day: 0, hour: 0, minute: 0 } }]));
  assert.ok(!is24h([{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }]));
  const rows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => ({ day, time: '8 AM – 5 PM' }));
  assert.deepEqual(compactHours([...rows, { day: 'Saturday', time: 'Closed' }, { day: 'Sunday', time: 'Closed' }]), [{ days: 'Mon–Fri', time: '8 AM – 5 PM' }, { days: 'Sat–Sun', time: 'Closed' }]);
});

test('build-time estimates read naturally and round up', () => {
  assert.deepEqual(friendlyDuration(3.2), { seconds: 4, label: 'a few seconds' });
  assert.deepEqual(friendlyDuration(11.8), { seconds: 15, label: 'about 15 seconds' });
  assert.deepEqual(friendlyDuration(19.6), { seconds: 20, label: 'about 20 seconds' });
  assert.deepEqual(friendlyDuration(41), { seconds: 45, label: 'about 45 seconds' });
  assert.deepEqual(friendlyDuration(75), { seconds: 60, label: 'about a minute' });
  assert.deepEqual(friendlyDuration(130), { seconds: 120, label: 'about 2 minutes' });
  assert.deepEqual(friendlyDuration(160), { seconds: 180, label: 'about 3 minutes' });
});

test('publishing to Vercel: valid project names, self-links rewritten, lead form left on the builder', () => {
  assert.equal(projectName('baked-lahore'), 'roger-baked-lahore');
  assert.equal(projectName('a---b'), 'roger-a--b'); // Vercel rejects "---"
  assert.ok(projectName('x'.repeat(150)).length <= 100);
  const base = config.publicBaseUrl;
  const html = `<link rel="canonical" href="${base}/sites/baked-lahore/"><meta property="og:image" content="${base}/sites/baked-lahore/preview.jpg"><form action="${base}/api/leads/baked-lahore">`;
  const out = rewriteForPublish(html, 'baked-lahore', 'roger-baked-lahore.vercel.app');
  assert.ok(out.includes('href="https://roger-baked-lahore.vercel.app/"'));
  assert.ok(out.includes('content="https://roger-baked-lahore.vercel.app/preview.jpg"'));
  assert.ok(out.includes(`action="${base}/api/leads/baked-lahore"`));
});

test('the bundled theme list matches themes/ on disk (re-run scripts/theme-manifest.ts if not)', () => {
  assert.deepEqual(PACKAGE_THEMES.map((t) => t.file), themeFiles());
});

test("a website's own headline keeps its words but not the separators left at its ends", async () => {
  const { tidyHeadline } = await import('../src/pipeline.js');
  assert.equal(tidyHeadline('For Plumbing, HVAC & Electrical Services - Just Call Radiant - '), 'For Plumbing, HVAC & Electrical Services - Just Call Radiant');
  assert.equal(tidyHeadline('| Fresh bread daily |'), 'Fresh bread daily');
  assert.equal(tidyHeadline('Roof repair — done right'), 'Roof repair — done right');
});

test('a phone or address the website and Google disagree on is held: neither is chosen for visitors', async () => {
  const { heldContacts } = await import('../src/pipeline.js');
  const site = { phones: { primary: '(833) 656-4056' }, address: { zip: '78744', formatted: '4437 Supply Court, Unit #101, Austin, TX 78744' } };
  const h = heldContacts({ phone: '(512) 690-4935', formattedAddress: '901 Reinli St, Austin, TX 78751, USA' }, site);
  assert.deepEqual(h.phone, { google: '(512) 690-4935', website: '(833) 656-4056' });
  assert.equal(h.address?.website, '4437 Supply Court, Unit #101, Austin, TX 78744');
  assert.deepEqual(heldContacts({ phone: '512-690-4935', formattedAddress: '901 Reinli St, Austin, TX 78751, USA' }, { phones: { primary: '(512) 690 4935' }, address: { zip: '78751', formatted: '901 Reinli St' } }), {}, 'the same number written differently is no conflict');
});

test('"Schedule now" only where it reaches a verified booking page; a request form says what it is', async () => {
  const { ctaFor, requestLabel } = await import('../src/pipeline.js');
  assert.deepEqual(ctaFor({ label: 'Schedule Now', kind: 'external', href: 'https://book.example.com' }, true, false), { label: 'Schedule Now', to: 'booking' });
  assert.deepEqual(ctaFor({ label: 'Schedule Now', kind: 'page', href: 'https://radiant.example/schedule' }, false, false), { label: 'Request an appointment', to: 'form' });
  assert.deepEqual(ctaFor({ label: 'Schedule Now', kind: 'anchor', href: '#form' }, false, false), { label: 'Request an appointment', to: 'form' });
  assert.deepEqual(ctaFor({ label: 'Call Now', kind: 'phone', href: 'tel:+15126904935' }, false, true), { label: 'Send a request', to: 'form' }, 'a held phone is not called');
  assert.deepEqual(ctaFor({ label: 'Get a free estimate', kind: 'anchor', href: '#form' }, false, false), { label: 'Get a free estimate', to: 'form' });
  assert.equal(requestLabel('Book an appointment'), 'Request an appointment');
});

test('vague one-word service labels are dropped; a service photo needs words that name that service', async () => {
  const { vagueService, serviceImageFits } = await import('../src/pipeline.js');
  for (const v of ['Installation', 'Maintenance', 'Tankless', 'Repair']) assert.equal(vagueService(v), true, v);
  for (const k of ['AC Repair', 'Water Heater Repair', 'Repiping', 'Leak Detection']) assert.equal(vagueService(k), false, k);
  assert.equal(serviceImageFits('Plumbing', { alt: 'Radiant plumber fixing a sink', url: 'https://x/a.jpg' }), true);
  assert.equal(serviceImageFits('Water Heaters', { url: 'https://x/tankless-water-heater-install.jpg' }), true);
  assert.equal(serviceImageFits('Drains & Sewers', { alt: 'Radiant technician with van', url: 'https://x/IMG_2041.jpg' }), false);
  assert.equal(serviceImageFits('Electrical', { url: 'https://x/team-photo.jpg' }), false);
  // the owner's "missing services" check leaves out vague labels and menu wording, and keeps real services
  const { reviewEvidence } = await import('../src/evidence.js');
  const svc = (canonicalName: string) => ({ canonicalName, aliases: [], isPrimary: false, status: 'verified', mentions: [{ kind: 'nav' }] });
  const found = reviewEvidence({ services: ['Installation', 'Maintenance', 'Tankless', 'Every plumbing service we offer', 'All indoor air quality services', 'Duct Cleaning'].map(svc), assets: [], conflicts: [], claims: {}, brand: { confidence: 1 }, hero: {}, projectsVerified: [] } as any, { servicesShown: [], serviceCardImages: 0 });
  assert.equal(found.find((f) => f.id === 'secondary-services-missing')?.message, "Services listed in the website's menu are not on the site: Duct Cleaning.");
  // the audit text never shows an empty bullet
  const { auditCard } = await import('../src/imessage/cards.js');
  const card = auditCard({ summary: { headline: 'Scored 88.', bullets: ['Phones differ', '', '  '], pitch: 'Want it?' } } as any, 'https://x/r', 'https://x/i.png');
  assert.equal(card.text, 'Scored 88.\n\n• Phones differ\n\nWant it?');
  // the business's own name is not evidence of what the picture shows
  const biz = 'Radiant Plumbing, Air Conditioning, & Electrical';
  assert.equal(serviceImageFits('Plumbing', { alt: 'Radiant Plumbing technician beside the van', url: 'https://x/radiant-plumbing-van.jpg' }, biz), false);
  assert.equal(serviceImageFits('Plumbing', { alt: 'Radiant plumber repairing a kitchen sink pipe', url: 'https://x/a.jpg' }, biz), true);
  assert.equal(serviceImageFits('Heating & Air Conditioning', { alt: 'Technician next to an air conditioning condenser', url: 'https://x/b.jpg' }, biz), true);
});
