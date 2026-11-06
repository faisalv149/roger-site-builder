// Shared builder rules that apply to every business: a held phone, the About story, service lists,
// the chat button's position and gallery image sizes. Radiant (plumbing/HVAC) is the regression case;
// a dental practice and a salon check that the rules are not trade-specific.
import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '' });
const { notAService, coveredBy, reviewEvidence } = await import('../src/evidence.js');
const { withoutCallWording, storyFromReview } = await import('../src/pipeline.js');
const { reviewLike } = await import('../src/sources/site-content.js');
const { tileSrc } = await import('../src/render/parts.js');
const { rogerWidget, WIDGETS_JS } = await import('../src/render/widgets.js');

test('a held phone: no "call" wording left in the headline', () => {
  assert.equal(withoutCallWording('For Plumbing, HVAC & Electrical Services - Just Call Radiant'), 'For Plumbing, HVAC & Electrical Services');
  assert.equal(withoutCallWording('Gentle family dentistry. Call us today!'), 'Gentle family dentistry.');
  assert.equal(withoutCallWording('Haircuts and color | Give us a call'), 'Haircuts and color');
  assert.equal(withoutCallWording('Austin\'s trusted roofers'), 'Austin\'s trusted roofers', 'text without call wording is unchanged');
  assert.equal(withoutCallWording('Call now'), '', 'nothing left: the caller keeps its fallback');
});

const model = (over: Record<string, unknown> = {}) => ({
  theme: { roger: {} }, business: { name: 'Radiant' }, contact: { phoneHeld: true }, source: undefined,
  urls: { leadEndpoint: '/api/leads/x' }, hours: { compact: [] }, services: { items: [{ label: 'Plumbing' }] }, ...over,
}) as any;

test('a held phone: the chat widget offers no calls and says nothing about calling', () => {
  const html = rogerWidget(model());
  assert.doesNotMatch(html, /data-panel="call"|data-open="call"/, 'no call panel or call button');
  assert.doesNotMatch(html, /\bcall/i, 'no "call" in any label');
  assert.match(html, /aria-label="Chat with Radiant"/);
  assert.match(html, /data-panel="chat"/, 'the message form stays');
  const js = WIDGETS_JS(model());
  assert.match(js, /"held":true/);
  assert.match(js, /C\.held\?\[\]:\['Call me back'\]/, 'the "Call me back" chip is left out when held');
  // a business with a confirmed phone keeps its call panel
  const withPhone = rogerWidget(model({ contact: { phone: '(512) 555-0100', tel: 'tel:+15125550100' } }));
  assert.match(withPhone, /data-panel="call"/);
  assert.match(withPhone, /Chat with or call Radiant/);
});

test('the chat button steps aside from form fields and buttons', () => {
  const js = WIDGETS_JS(model());
  assert.match(js, /querySelectorAll\('input,select,textarea,button,a\.btn,\[role=button\]'\)/, 'it checks the page\'s own fields and buttons');
  assert.match(js, /rw\.classList\.toggle\('is-tucked',hit\)/);
  assert.match(js, /addEventListener\('scroll',tuckSoon/);
});

// Radiant's own website showed this customer review beside its "About" label
const REVIEW = 'Our 18 year old HVAC system finally gave out this past week, so we reached out to Radiant to see what could be done. They sent a tech out named Bryan the same day, and he did a great job looking over the entire HVAC system.';
test('About copy: a customer review is never the business story; the business\'s own words are', () => {
  assert.equal(reviewLike(REVIEW), true);
  assert.equal(storyFromReview(REVIEW, []), true);
  // the business's own About text, in three industries
  for (const own of [
    'Radiant has served Austin homeowners since 1997. Our licensed plumbers, HVAC technicians and electricians handle everything from water heaters to panel upgrades.',
    'We had a simple idea when we opened in our home town: gentle, modern dentistry for the whole family. Dr. Lee and our team have cared for Round Rock smiles for 20 years.',
    'Founded by two stylists in 2012, our salon offers cuts, color and treatments in a calm, friendly studio on South Congress.',
  ]) assert.equal(storyFromReview(own, []), false, own.slice(0, 40));
  // a story that repeats a Google review word for word is dropped too
  const review = 'The whole team was kind and patient with my kids and the new office is beautiful and so clean';
  assert.equal(storyFromReview(`Welcome. ${review}.`, [review]), true);
});

test('service lists: categories, places, vague labels and symptoms are not services, in any trade', () => {
  const places = ['Austin', 'San Antonio', 'Round Rock'];
  const not: [string, string][] = [
    ['Installation', 'vague'], ['Maintenance', 'vague'], ['Bathrooms', 'vague'], ['Kitchens', 'vague'],
    ['All plumbing services', 'menu'], ['Every indoor air service we offer', 'menu'],
    ['Austin Plumbers', 'location'], ['San Antonio Plumbers', 'location'], ['Round Rock Dentists', 'location'], ['Hair Salon in Austin', 'location'],
    ['Water at the base of the tank', 'symptom'], ['Rusty hot water', 'symptom'], ['Rumbling, popping or banging', 'symptom'], ['The second repair this year', 'symptom'], ['Past ten years and never serviced', 'symptom'], ['Gums that bleed when you brush', 'symptom'],
    ['Slower recovery than it used to have', 'symptom'], ['Running water you cannot find', 'symptom'], ['Hair that breaks when it is brushed', 'symptom'],
  ];
  for (const [n, why] of not) assert.equal(notAService(n, places), why, n);
  for (const n of ['AC Repair', 'A/C Repair', 'Water Heater Repair', 'Emergency Plumbers', 'Electrical (Austin)', 'Drain Cleaning', 'Teeth Whitening', 'Root Canal Therapy', 'Balayage', 'Kitchen Remodeling', 'Leak Detection'])
    assert.equal(notAService(n, places), undefined, n);
  // a category already shown as a service is not "missing"
  assert.equal(coveredBy('Electrical', ['Electrical (Austin)']), true);
  assert.equal(coveredBy('Cleaner Air', ['Clean Air & Water']), true);
  assert.equal(coveredBy('Furnace Installation', ['Heating & Air Conditioning', 'Furnace Repair']), false);
});

test('the owner\'s review lists only real services that are missing', () => {
  const svc = (canonicalName: string, status = 'verified') => ({ canonicalName, aliases: [], isPrimary: false, status, mentions: [{ kind: 'nav' }] });
  const m = { services: [...['Austin Plumbers', 'Electrical', 'Cleaner Air', 'Kitchens', 'Duct Cleaning'].map((n) => svc(n)), svc('Rusty hot water', 'needs_review'), svc('Sump Pump Installation', 'needs_review')], assets: [], conflicts: [], claims: {}, brand: { confidence: 1 }, hero: {}, projectsVerified: [] } as any;
  const out = reviewEvidence(m, { servicesShown: ['Electrical (Austin)', 'Clean Air & Water'], places: ['Austin'], serviceCardImages: 0 });
  assert.equal(out.find((f) => f.id === 'secondary-services-missing')?.message, "Services listed in the website's menu are not on the site: Duct Cleaning.");
  assert.match(out.find((f) => f.id === 'services-unverified')!.message, /: Sump Pump Installation\. Confirm/);
});

test('gallery tiles ask Google for a picture their size; credits and other pictures are unchanged', () => {
  const t = tileSrc('/gphoto/ChIJabc123/4?s=3024x4032');
  assert.match(t, /^src="\/gphoto\/ChIJabc123\/4\?s=3024x4032&amp;w=800"/);
  assert.match(t, /srcset="[^"]*&amp;w=400 400w, [^"]*&amp;w=800 800w, [^"]*&amp;w=1200 1200w"/);
  assert.match(t, /sizes="\(min-width: 1024px\) 34vw/);
  assert.equal(tileSrc('assets/photo-1.webp'), 'src="assets/photo-1.webp"', 'the site\'s own files are already sized');
});
