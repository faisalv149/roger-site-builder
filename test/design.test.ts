import test from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Facts, ServiceItem } from '../src/types.js';
import type { BuildRecord } from '../src/store.js';
import { validatePlan, validatePreferences, planProblems, type DesignPlan } from '../src/design/schema.js';
import { claimProblems, designApplies, planDesign, planDifference, type PlanInput } from '../src/design/planner.js';
import { profileFor } from '../src/design/categories.js';
import { parseGoal, parseService, parseStyle, parseYesNo } from '../src/design/answers.js';
import { personaliseInfo, refinementInput } from '../src/design/refine.js';
import { processSteps } from '../src/design/compose.js';
import { fontsUrl, TYPE_PRESET_DEFS } from '../src/design/directions.js';
import { normalizeLead } from '../src/leads.js';
import type { PhotoInfo } from '../src/design/photos.js';

// ── fixtures for the planner (pure: no network, no files) ──
const biz = (o: Partial<Business> = {}): Business => ({
  placeId: 'mock-test', name: 'Testline Plumbing', primaryType: 'plumber', types: ['plumber'], city: 'Denver', state: 'CO',
  formattedAddress: '1 Main St, Denver, CO 80202, USA', phone: '(303) 555-0100', phoneE164: '+13035550100',
  rating: 4.6, reviewCount: 40, reviews: [], photos: [], nearbyTowns: ['Denver', 'Lakewood'], source: 'mock', ...o,
});
const facts = (o: Partial<Facts> = {}): Facts => ({ city: 'Denver', state: 'CO', licensed: false, insured: false, warranty: false, open24h: false, emergency: false, maintenance: false, serviceAreas: [], notes: [], source: 'heuristic', ...o });
const svc = (label: string, hits = 1): ServiceItem => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label, icon: 'wrench', hits });
const photo = (key: string, kind: PhotoInfo['kind'], o: Partial<PhotoInfo> = {}): PhotoInfo => ({
  key, image: { publicPath: `assets/${key}.webp`, width: 1600, height: 1066, alt: '', source: 'google' }, raw: Buffer.alloc(0),
  width: 2000, height: 1333, aspect: 1.5, owner: true, kind, sharpness: 0.8, exposure: 0.8, resolution: 1, quality: 0.88, ...o,
});
const tokens: PlanInput['tokens'] = () => ({ brand: '#1D4ED8', brandInk: '#FFFFFF', brandText: '#1D4ED8', surface: '#FFFFFF', surfaceAlt: '#F1F2F4', ink: '#0D1117', inkMuted: '#46505C' });
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  businessKey: 'mock-test', business: biz(), facts: facts(), category: 'trades', services: [svc('Drain cleaning', 5), svc('Leak repair', 2), svc('Water heaters', 1)], servicesSource: 'theme',
  photos: [photo('p_a', 'work'), photo('p_b', 'work', { quality: 0.7 }), photo('p_c', 'work', { quality: 0.6 })],
  evidence: { showRating: true, rating: 4.6, reviewCount: 40, trust: false, areas: ['Denver', 'Lakewood'], address: '1 Main St' },
  tokens, now: '2026-10-28T00:00:00.000Z', ...o,
});
const ids = (p: DesignPlan) => p.sections.map((s) => s.id);

test('preferences: optional, validated, owner text cleaned', () => {
  assert.deepEqual(validatePreferences({}), { ok: true, prefs: {} });
  assert.deepEqual(validatePreferences(undefined), { ok: true, prefs: {} });
  const ok = validatePreferences({ service: '  Tankless   water heaters ', goal: 'appointment', style: 'bold-direct', emergencyConfirmed: true });
  assert.ok(ok.ok && ok.prefs.service === 'Tankless water heaters');
  assert.equal(validatePreferences({ goal: 'book' }).ok, false);
  assert.equal(validatePreferences({ style: 'neon' }).ok, false);
  assert.equal(validatePreferences({ service: 'see www.spam.example' }).ok, false);
  assert.equal(validatePreferences({ extra: 1 }).ok, false); // unknown keys rejected
  const tags = validatePreferences({ service: '<b>Drains</b>' });
  assert.ok(!tags.ok || !/[<>]/.test(tags.prefs.service || ''));
  assert.deepEqual(validatePreferences({ service: '' }), { ok: true, prefs: {} });
});

test('owner answers in iMessage map to the same preferences', () => {
  const s = ['Drain cleaning', 'Leak repair'];
  assert.deepEqual(parseService('keep recommended', s), { keep: true });
  assert.deepEqual(parseService('2', s), { value: 'Leak repair' });
  assert.deepEqual(parseService('tankless water heaters', s), { value: 'tankless water heaters' });
  assert.ok('error' in parseService('???', s));
  assert.deepEqual(parseGoal('Request an appointment', true), { value: 'appointment' });
  assert.deepEqual(parseGoal('quote please', true), { value: 'quote' });
  assert.ok('error' in parseGoal('Call', false)); // no phone on Google: Call can't be the goal
  assert.deepEqual(parseStyle('something modern'), { value: 'modern-premium' });
  assert.deepEqual(parseStyle('Bold & direct'), { value: 'bold-direct' });
  assert.deepEqual(parseStyle('skip'), { keep: true });
  assert.deepEqual(parseYesNo('nope'), { value: false });
});

test('planner: verified emergency → bold, call, emergency band; plan validates', () => {
  const { plan } = planDesign(input({ facts: facts({ emergency: true }) }));
  assert.equal(plan.direction, 'bold-direct');
  assert.equal(plan.goal, 'call');
  assert.ok(plan.emergency && ids(plan).includes('urgent'));
  assert.equal(validatePlan(plan).ok, true);
  assert.match(plan.id, /^dp_[a-f0-9]{10}$/);
});

test('planner: a bold style does not create emergency claims; only the owner\'s confirmation does', () => {
  const bold = planDesign(input({ preferences: { style: 'bold-direct' } })).plan;
  assert.equal(bold.direction, 'bold-direct');
  assert.equal(bold.emergency, false);
  assert.ok(!ids(bold).includes('urgent'));
  assert.ok(!/24|emergenc/i.test(`${bold.copy.headline} ${bold.copy.subline}`));
  const confirmed = planDesign(input({ preferences: { style: 'bold-direct', emergencyConfirmed: true } })).plan;
  assert.ok(confirmed.emergency && ids(confirmed).includes('urgent'));
  // the owner saying no wins over keyword evidence
  const denied = planDesign(input({ facts: facts({ emergency: true }), preferences: { emergencyConfirmed: false } })).plan;
  assert.equal(denied.emergency, false);
});

test('planner: call needs a valid phone, otherwise the goal falls back to a quote request', () => {
  const out = planDesign(input({ business: biz({ phone: undefined, phoneE164: undefined }), preferences: { goal: 'call' } }));
  assert.equal(out.plan.goal, 'quote');
  assert.ok(out.warnings.some((w) => /phone/.test(w)));
});

test('planner: sparse data still makes a valid page (no photos → type-led, no projects / team / reviews)', () => {
  const { plan } = planDesign(input({ photos: [], evidence: { showRating: false, trust: false, areas: [], address: undefined } }));
  assert.equal(plan.hero.variant, 'type-led');
  assert.deepEqual(plan.images, { hero: null, slides: [], team: null, gallery: [] });
  for (const s of ['gallery', 'team', 'proof', 'area']) assert.ok(!ids(plan).includes(s as never), s);
  assert.equal(validatePlan(plan).ok, true);
  assert.ok(plan.reasons.some((r) => /No reviews section/.test(r)));
});

test('planner: team photo gets a team section; hero, team and projects are different photos', () => {
  const { plan } = planDesign(input({ photos: [photo('p_t', 'team'), photo('p_a', 'work'), photo('p_b', 'work'), photo('p_c', 'work'), photo('p_d', 'work')] }));
  assert.equal(plan.direction, 'local-trusted');
  assert.ok(ids(plan).includes('team'));
  assert.equal(plan.images.team, 'p_t');
  assert.notEqual(plan.images.hero, 'p_t');
  const all = [plan.images.hero, plan.images.team, ...plan.images.gallery].filter(Boolean);
  assert.equal(new Set(all).size, all.length);
});

test('planner: saved plans are stable; preference changes update only what they affect; alternatives make a new plan', () => {
  const first = planDesign(input()).plan;
  const again = planDesign(input({ previous: first, now: '2026-10-29T00:00:00.000Z' })).plan;
  assert.equal(again.id, first.id);
  for (const k of ['direction', 'goal', 'typography'] as const) assert.equal(again[k], first[k]);
  assert.deepEqual(again.hero, first.hero);
  assert.deepEqual(again.sections, first.sections);
  assert.deepEqual(again.images, first.images);
  assert.equal(again.copy.headline, first.copy.headline);
  assert.equal(again.createdAt, first.createdAt);

  const goal = planDesign(input({ previous: first, preferences: { goal: 'appointment' } })).plan;
  assert.equal(goal.goal, 'appointment');
  assert.equal(goal.direction, first.direction); // not asked about: kept
  assert.equal(goal.sources.direction, 'saved');

  const svcChange = planDesign(input({ previous: first, preferences: { service: 'Leak repair' } })).plan;
  assert.equal(svcChange.service.label, 'Leak repair');
  assert.match(svcChange.copy.headline, /Leak repair/i);

  const alt = planDesign(input({ previous: first, alternative: true })).plan;
  assert.equal(alt.variation, 1);
  assert.notEqual(alt.id, first.id);
  assert.ok(planDifference(alt, first) >= 2, 'another design differs in at least two ways');
  // an ordinary rebuild after an alternative keeps that alternative exactly (variants included)
  const afterAlt = planDesign(input({ previous: alt })).plan;
  assert.equal(afterAlt.id, alt.id);
  assert.deepEqual(afterAlt.sections, alt.sections);
  assert.equal(afterAlt.typography, alt.typography);
  assert.deepEqual(afterAlt.hero, alt.hero);

  // the owner's own wording stays theirs, even when a broader service is listed
  const own = planDesign(input({ services: [svc('Water heaters', 3), svc('Drain cleaning')], preferences: { service: 'Tankless water heaters' } })).plan;
  assert.equal(own.service.label, 'Tankless water heaters');
  assert.equal(own.service.id, undefined);
  const picked = planDesign(input({ preferences: { service: 'leak repair' } })).plan;
  assert.equal(picked.service.label, 'Leak repair'); // a suggestion, matched exactly
});

test('planner: Claude\'s advice is used only when valid; otherwise deterministic rules decide', () => {
  const bad = planDesign(input({ advice: { style: 'neon', mainService: 'Roof repair', headline: 'Best 24/7 plumbers in Denver', subline: 'Call now' } }));
  assert.equal(bad.plan.copy.source, 'rules');
  assert.equal(bad.plan.planner, 'rules');
  assert.equal(bad.plan.service.label, 'Drain cleaning');
  assert.ok(bad.warnings.some((w) => /not used/.test(w)));
  const good = planDesign(input({ advice: { style: 'local-trusted', mainService: 'drain cleaning', headline: 'Drain cleaning for Denver homes', subline: 'Testline Plumbing clears kitchen and main-line drains across Denver.' } }));
  assert.equal(good.plan.copy.source, 'claude');
  assert.equal(good.plan.service.source, 'claude');
  assert.equal(good.plan.planner, 'claude+rules');
});

test('claim guard: generated copy may only state what the data backs', () => {
  const ctx = { facts: facts(), emergency: false, evidence: { showRating: false, trust: false, areas: [] } };
  assert.deepEqual(claimProblems('Drain cleaning for Denver homes', ctx), []);
  assert.ok(claimProblems('Licensed plumbers with 20 years', ctx).includes('licensed'));
  assert.ok(claimProblems('Licensed plumbers with 20 years', ctx).includes('years'));
  assert.ok(claimProblems('Rated 4.9 by neighbors', ctx).includes('rating'));
  assert.ok(claimProblems('The best free estimates', ctx).length);
  assert.deepEqual(claimProblems('Licensed plumbers, 20 years', { ...ctx, facts: facts({ licensed: true, years: 20 }) }), []);
});

test('plan validation: compositions outside the compatibility rules are rejected', () => {
  const plan = planDesign(input({ photos: [photo('p_t', 'team'), photo('p_a', 'work'), photo('p_b', 'work'), photo('p_c', 'work'), photo('p_d', 'work')] })).plan;
  assert.deepEqual(planProblems(plan), []);
  const bad = (patch: (p: DesignPlan) => void) => { const p = structuredClone(plan); patch(p); return validatePlan(p); };
  assert.equal(bad((p) => { p.images.hero = null; }).ok, false); // split hero without a photo
  assert.equal(bad((p) => { p.images.team = null; }).ok, false); // team section without a team photo
  assert.equal(bad((p) => { p.sections.splice(1, 0, { id: 'urgent', variant: 'band' }); }).ok, false); // emergency not allowed / not in direction
  assert.equal(bad((p) => { p.sections[1] = { id: 'services', variant: 'dense-list' }; }).ok, false); // bold variant in local
  assert.equal(bad((p) => { p.sections.splice(1, 0, { id: 'quote', variant: 'split' }); }).ok, false); // two quote sections
  assert.equal(bad((p) => { (p as { version: number }).version = 4; }).ok, false);
  assert.equal(bad((p) => { p.typography = 'editorial'; }).ok, false);
});

test('theme precedence: chosen or uploaded themes stay authoritative unless the operator opts in', () => {
  assert.equal(designApplies({ pilot: true, manualTheme: false, optIn: false }), true);
  assert.equal(designApplies({ pilot: true, manualTheme: true, optIn: false }), false);
  assert.equal(designApplies({ pilot: true, manualTheme: true, optIn: true }), true);
  assert.equal(designApplies({ pilot: false, manualTheme: false, optIn: false }), false);
});

test('persistence: build records from before the pilot still personalise and rebuild the same site', () => {
  const old = {
    id: 'abc12345', createdAt: '2026-10-20T00:00:00.000Z', source: 'studio', status: 'done',
    result: { slug: 'blueline-denver', themeId: 'plumbing-classic', themeReason: 'Chosen manually', services: ['Drain cleaning', 'Leak repair'],
      business: { placeId: 'mock-blueline-plumbing', name: 'BlueLine', phone: '(303) 555-0187', website: undefined }, facts: facts({ open24h: true }) },
  } as unknown as BuildRecord;
  const info = personaliseInfo(old);
  assert.equal(info.eligible, true);
  assert.equal(info.manualTheme, true);
  assert.equal(info.emergencyVerified, true);
  const inp = refinementInput(old, { style: 'local-trusted' }, { optIn: true });
  assert.equal(inp.placeId, 'mock-blueline-plumbing');
  assert.equal(inp.slug, 'blueline-denver');
  assert.equal(inp.preview, true);
  assert.equal(inp.design?.optIn, true);
  assert.equal(inp.themeId, undefined);
  assert.equal(personaliseInfo({ ...old, result: { ...old.result!, themeId: 'roofing-classic' } } as BuildRecord).eligible, true); // every category now
});

test('leads: appointment requests stay requests; kinds and times are validated', () => {
  const ok = normalizeLead('x', { name: 'Ana', phone: '555', kind: 'appointment-request', preferredDate: '2026-11-03', preferredTime: 'Morning', service: 'Water heaters' });
  assert.ok(ok.ok && ok.lead.kind === 'appointment-request' && ok.lead.status === 'requested' && ok.lead.preferredDate === '2026-11-03' && ok.lead.preferredTime === 'Morning');
  const odd = normalizeLead('x', { name: 'Ana', phone: '555', kind: 'booking-confirmed', preferredDate: 'tomorrow', preferredTime: 'midnight' });
  assert.ok(odd.ok && odd.lead.kind === undefined && odd.lead.preferredDate === undefined && odd.lead.status === undefined);
  assert.equal(normalizeLead('x', { name: 'Ana' }).ok, false);
  assert.ok(processSteps('appointment', 'Testline', undefined, profileFor('trades')).some((s) => /confirm/i.test(`${s.title} ${s.text}`)));
});

test('typography: only the selected pair is requested from Google Fonts', () => {
  const u = fontsUrl(TYPE_PRESET_DEFS['compact-grotesk']);
  assert.match(u, /family=Barlow\+Condensed:wght@700&family=Barlow:wght@400;600&display=swap$/);
  assert.equal((fontsUrl(TYPE_PRESET_DEFS['heavy-grotesk']).match(/family=/g) || []).length, 1); // one family, merged weights
});
