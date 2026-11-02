import test from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Facts, ServiceItem } from '../src/types.js';
import { detectCategory, profileFor } from '../src/design/categories.js';
import { formatPrice, offeringsFrom, validateOfferings } from '../src/design/offerings.js';
import { DESIGN_PLAN_VERSION, migratePlan, validateAppearance, validatePlan, type DesignPlan } from '../src/design/schema.js';
import { planDesign, planDifference, PlanChoiceError, type PlanInput } from '../src/design/planner.js';
import { resolveAppearance } from '../src/design/appearance.js';
import { contrast } from '../src/color/oklch.js';
import type { PhotoInfo } from '../src/design/photos.js';
import { dnsGuide, domainIdeas, parseDomain } from '../src/orders.js';

const biz = (o: Partial<Business> = {}): Business => ({
  placeId: 'mock-unit', name: 'Velvet Test Studio', primaryType: 'hair_salon', primaryTypeLabel: 'Hair salon', types: ['hair_salon'], city: 'Austin',
  phone: '(512) 555-0100', phoneE164: '+15125550100', rating: 4.8, reviewCount: 50, reviews: [], photos: [], nearbyTowns: [], source: 'mock', ...o,
});
const facts: Facts = { city: 'Austin', licensed: false, insured: false, warranty: false, open24h: false, emergency: false, maintenance: false, serviceAreas: [], notes: [], source: 'heuristic' };
const photo = (key: string, kind: PhotoInfo['kind'], o: Partial<PhotoInfo> = {}): PhotoInfo => ({
  key, image: { publicPath: `assets/${key}.webp`, width: 1600, height: 1066, alt: '', source: 'google' }, raw: Buffer.alloc(0),
  width: 2400, height: 1600, aspect: 1.5, owner: true, kind, sharpness: 0.8, exposure: 0.8, resolution: 1, quality: 0.9, ...o,
});
const tokens: PlanInput['tokens'] = () => ({ brand: '#7B3F52', brandInk: '#FFFFFF', brandText: '#7B3F52', surface: '#FFFFFF', surfaceAlt: '#F5F7FA', ink: '#101828', inkMuted: '#475467' });
const offerings = offeringsFrom({
  business: [{ name: 'Cut & style', price: { kind: 'from', amount: 65, currency: 'USD' }, source: 'sample' }, { name: 'Balayage', price: { kind: 'range', amount: 180, max: 260, currency: 'USD' }, source: 'sample' }, { name: 'Bridal styling', source: 'sample' }],
  services: [], currency: 'USD',
});
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  businessKey: 'mock-unit', business: biz(), facts, category: 'salon', services: [] as ServiceItem[], servicesSource: 'theme', offerings,
  photos: [photo('p_a', 'work'), photo('p_b', 'work'), photo('p_c', 'work'), photo('p_d', 'storefront'), photo('p_t', 'team')],
  evidence: { showRating: true, rating: 4.8, reviewCount: 50, trust: false, areas: ['Austin'], address: '1 Main St' }, tokens, now: '2026-10-28T00:00:00.000Z', ...o,
});

test('categories: Google types decide wording and actions; unknown businesses get a general page', () => {
  assert.equal(detectCategory({ primaryType: 'hair_salon', types: [] }), 'salon');
  assert.equal(detectCategory({ primaryType: 'cafe', types: [] }), 'food');
  assert.equal(detectCategory({ primaryType: 'italian_restaurant', types: [] }), 'food');
  assert.equal(detectCategory({ primaryType: 'gym', types: [] }), 'fitness');
  assert.equal(detectCategory({ primaryType: 'consultant', types: [] }), 'professional');
  assert.equal(detectCategory({ primaryType: 'fabric_store', types: [] }), 'shop');
  assert.equal(detectCategory({ primaryType: 'electrician', types: [] }), 'trades');
  assert.equal(detectCategory({ primaryType: 'establishment', types: ['point_of_interest'] }), 'general');
  assert.equal(detectCategory({ primaryType: 'establishment', types: [] }, 'roofing'), 'trades'); // a trade theme is a trade
  assert.equal(profileFor('food').offeringsTitle, 'Menu');
  assert.equal(profileFor('salon').unknownPrice, 'Price on request');
  assert.equal(profileFor('nonsense').id, 'general');
});

test('prices: kinds, currency formatting and the category\'s wording for unknown prices', () => {
  const p = (o: object) => ({ currency: 'USD', ...o }) as never;
  assert.equal(formatPrice(p({ kind: 'fixed', amount: 38 })), '$38');
  assert.equal(formatPrice(p({ kind: 'fixed', amount: 4.5 })), '$4.50');
  assert.equal(formatPrice(p({ kind: 'from', amount: 65 })), 'From $65');
  assert.equal(formatPrice(p({ kind: 'range', amount: 180, max: 260 })), '$180–$260');
  assert.equal(formatPrice(p({ kind: 'unit', amount: 59, unit: 'month' })), '$59 / month');
  assert.equal(formatPrice({ kind: 'fixed', amount: 22, currency: 'GBP' }), '£22');
  assert.equal(formatPrice(p({ kind: 'quote' }), 'trades'), 'Request a quote');
  assert.equal(formatPrice(p({ kind: 'quote' }), 'food'), 'Ask in store');
});

test('prices: owner edits are validated and escaped; impossible prices are rejected', () => {
  const base = { id: 'cut', name: 'Cut', source: 'owner' as const };
  assert.equal(validateOfferings([{ ...base, price: { kind: 'fixed', amount: -5, currency: 'USD' } }]).ok, false);
  assert.equal(validateOfferings([{ ...base, price: { kind: 'range', amount: 80, max: 60, currency: 'USD' } }]).ok, false);
  assert.equal(validateOfferings([{ ...base, price: { kind: 'unit', amount: 10, currency: 'USD' } }]).ok, false); // per what?
  assert.equal(validateOfferings([{ ...base, price: { kind: 'fixed', currency: 'USD' } }]).ok, false); // no amount
  assert.equal(validateOfferings([{ ...base, price: { kind: 'fixed', amount: 5, currency: 'XYZ' } }]).ok, false);
  assert.equal(validateOfferings([{ ...base, price: { kind: 'quote', currency: 'USD' } }, { ...base, price: { kind: 'quote', currency: 'USD' } }]).ok, false); // duplicate id
  assert.equal(validateOfferings([{ ...base, extra: 1, price: { kind: 'quote', currency: 'USD' } }]).ok, false); // unknown field
  const ok = validateOfferings([{ ...base, name: '<b>Cut</b> & style', price: { kind: 'quote', currency: 'USD' } }]);
  assert.ok(ok.ok && !/[<>]/.test(ok.offerings[0].name));
  // a stated price that doesn't validate becomes "on request", never a made-up number
  const fromSite = offeringsFrom({ own: [{ name: 'Repair', description: '', icon: 'wrench', price: { kind: 'range', amount: 300, max: 100 } }], services: [] });
  assert.equal(fromSite[0].price.kind, 'quote');
  // the theme's services carry no price and say where they came from
  const theme = offeringsFrom({ services: [{ id: 'a', label: 'Drain cleaning', icon: 'wrench', hits: 0 }] });
  assert.deepEqual([theme[0].price.kind, theme[0].source], ['quote', 'theme']);
});

test('plan v2: version 1 plans migrate; invalid plans are rejected', () => {
  const v1 = {
    version: 1, id: 'dp_0123456789', businessKey: 'mock-x', variation: 0, vertical: 'plumbing', direction: 'local-trusted', goal: 'quote',
    service: { label: 'Drain cleaning', source: 'default' }, hero: { variant: 'type-led' },
    sections: [{ id: 'hero', variant: 'type-led' }, { id: 'services', variant: 'cards' }, { id: 'quote', variant: 'split' }, { id: 'footer', variant: 'warm' }],
    typography: 'warm-serif', tokens: tokens('local-trusted', 'warm-serif'), images: { hero: null, team: null, projects: [] },
    copy: { headline: 'Drains for Denver homes', subline: 'x', source: 'rules' }, emergency: false, sources: { direction: 'recommended', goal: 'recommended', service: 'recommended' },
    preferences: {}, planner: 'rules', reasons: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const m = validatePlan(v1);
  assert.ok(m.ok, JSON.stringify(m));
  assert.equal(m.plan.version, DESIGN_PLAN_VERSION);
  assert.equal(m.plan.category, 'trades');
  assert.deepEqual(m.plan.images.gallery, []);
  assert.equal((migratePlan({ version: 9 }) as { version: number }).version, 9); // unknown versions are left for validation to reject
  assert.equal(validatePlan({ ...v1, version: 9 }).ok, false);
});

test('variation: same seed → same plan; another design differs in two or more ways and keeps locked choices', () => {
  const a = planDesign(input()).plan;
  const b = planDesign(input()).plan;
  assert.deepEqual(a, b); // deterministic without Claude
  assert.equal(validatePlan(a).ok, true);
  assert.equal(a.category, 'salon');
  const reopened = planDesign(input({ previous: a, now: '2026-11-01T00:00:00.000Z' })).plan;
  assert.equal(reopened.id, a.id);
  assert.deepEqual(reopened.sections, a.sections);
  let prev = a;
  const recent: DesignPlan[] = [];
  for (let n = 0; n < 3; n++) {
    const next = planDesign(input({ previous: prev, alternative: true, recent })).plan;
    assert.ok(planDifference(next, prev) >= 2, `design ${n + 2} differs from the last in ${planDifference(next, prev)} ways`);
    assert.equal(validatePlan(next).ok, true);
    recent.unshift(prev);
    prev = next;
  }
  // the owner's layout choice locks that dimension
  const chosen = planDesign(input({ previous: a, layout: { hero: 'type-led', arrangement: 'b' } })).plan;
  assert.equal(chosen.hero.variant, 'type-led');
  assert.ok(chosen.locks.includes('hero') && chosen.locks.includes('arrangement'));
  for (let n = 0; n < 4; n++) {
    const g = planDesign(input({ previous: chosen, alternative: true })).plan;
    assert.equal(g.hero.variant, 'type-led');
    assert.equal(g.arrangement, 'b');
  }
  // the owner's answers stay too
  const owner = planDesign(input({ preferences: { goal: 'enquiry' } })).plan;
  assert.equal(planDesign(input({ previous: owner, alternative: true })).plan.goal, 'enquiry');
  // a layout the content can't support is refused with a reason
  assert.throws(() => planDesign(input({ photos: [], layout: { hero: 'carousel' } })), PlanChoiceError);
});

test('category content: salons show prices, sparse unknown businesses still get a valid page', () => {
  const salon = planDesign(input()).plan;
  assert.ok(salon.sections.some((s) => s.id === 'services' && s.variant === 'price-list') || salon.direction === 'modern-premium', JSON.stringify(salon.sections));
  assert.notEqual(salon.goal, 'quote');
  const sparse = planDesign(input({ category: 'general', business: biz({ primaryType: 'establishment', primaryTypeLabel: undefined, phone: undefined, phoneE164: undefined, rating: undefined, reviewCount: undefined }), offerings: [], photos: [], evidence: { showRating: false, trust: false, areas: [] } })).plan;
  assert.equal(validatePlan(sparse).ok, true);
  assert.equal(sparse.hero.variant, 'type-led');
  assert.notEqual(sparse.goal, 'call'); // no phone
  assert.ok(!sparse.sections.some((s) => s.id === 'services')); // nothing real to list
  assert.ok(!/undefined|null/.test(`${sparse.copy.headline} ${sparse.copy.subline}`));
});

test('appearance: validated; button text stays readable on any colour or gradient', () => {
  assert.equal(validateAppearance({ color: { mode: 'solid', accent: 'red' } }).ok, false);
  assert.equal(validateAppearance({ font: 'comic-sans' }).ok, false);
  assert.equal(validateAppearance({ hack: 1 }).ok, false);
  const ctx = { brand: '#7B3F52', surface: '#FFFFFF', ink: '#101828' };
  for (const accent of ['#FFFF00', '#FDE68A', '#22C55E', '#0EA5E9', '#000000', '#FF00FF']) {
    const r = resolveAppearance({ color: { mode: 'solid', accent } }, ctx);
    assert.ok(contrast(r.vars['--brand'], r.vars['--brand-ink']) >= 4.5, `${accent}: button text`);
    assert.ok(contrast(r.vars['--brand-text'], ctx.surface) >= 4.5, `${accent}: links`);
  }
  const g = resolveAppearance({ color: { mode: 'gradient', gradient: { from: '#FDE68A', to: '#A7F3D0', angle: 135 } } }, ctx);
  const stops = g.vars['--btn-bg'].match(/#[0-9A-F]{6}/gi)!;
  for (const s of stops) assert.ok(contrast(s, '#FFFFFF') >= 4.5, `gradient stop ${s}`);
  assert.ok(g.notes.length); // the owner is told the colours were adjusted
  const f = resolveAppearance({ font: 'clean-sans', textSize: 'compact', spacing: 'spacious', buttons: 'pill', motion: 'off' }, ctx);
  assert.match(f.vars['--font-heading'], /Manrope/);
  assert.equal(f.vars['--btn-r'], '999px');
  assert.equal(f.motion, 'off');
});

test('domains: input normalised, provider guidance, placeholders until real values exist', () => {
  const d = parseDomain('https://www.Copperleaf-Plumbing.com/contact');
  assert.ok(!('error' in d) && d.apex === 'copperleaf-plumbing.com' && d.host === 'www.copperleaf-plumbing.com' && !d.subdomain);
  const uk = parseDomain('shop.lantern.co.uk');
  assert.ok(!('error' in uk) && uk.apex === 'lantern.co.uk' && uk.subdomain);
  assert.ok('error' in parseDomain('not a domain'));
  assert.ok('error' in parseDomain('localhost'));
  const g = dnsGuide({ status: 'in-progress', choice: 'connect', domain: d as never, provider: { id: 'cloudflare', label: 'Cloudflare' }, done: [], demo: { verified: false, launched: false }, real: { domainVerified: false, certificateReady: false, published: false }, updatedAt: '' });
  assert.deepEqual(g.records.map((r) => [r.type, r.name]), [['A', '@'], ['CNAME', 'www']]);
  assert.ok(g.records.every((r) => r.value.placeholder));
  assert.match(g.keep, /MX/);
  assert.match(g.nameservers, /don.t need to change/);
  assert.match(g.note || '', /DNS only/);
  const sub = dnsGuide({ status: 'in-progress', domain: uk as never, done: [], demo: { verified: false, launched: false }, real: { domainVerified: false, certificateReady: false, published: false }, updatedAt: '' });
  assert.deepEqual(sub.records.map((r) => [r.type, r.name]), [['CNAME', 'shop']]);
  assert.ok(domainIdeas('Velvet & Vine Hair Studio', 'Austin').every((x) => /^[a-z0-9-]+\.(com|co)$/.test(x)));
});
