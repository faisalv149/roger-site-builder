import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { cardServices, heroOf, navMenu } from '../src/sources/page-structure.js';
import { reconcileServices, reviewEvidence, headlineRelevant, type EvidenceModel } from '../src/evidence.js';
import { checkOutput } from '../src/content/validate.js';
import { publishReadiness } from '../src/design/content.js';
import { leadOf } from '../src/design/compose.js';

// A made-up trade site: a hero with two buttons, three service cards with their own pictures, a menu with one more service.
const HOME = 'https://example-contractor.test/';
const HTML = `<html><body>
<header><nav><ul>
  <li><a href="/">Home</a></li>
  <li><a href="/services/">Services</a><ul>
    <li><a href="/services/roof-repair/">Roof Repair</a></li>
    <li><a href="/services/gutter-installation/">Gutter Installation</a></li>
  </ul></li>
  <li><a href="/gallery/">Gallery</a></li>
  <li><a href="/contact/">Contact</a></li>
</ul></nav></header>
<section class="hero"><h1>Dependable roofing and gutters for your home</h1>
  <p>Family-owned crews who treat every house like their own, from first call to final clean-up.</p>
  <a class="btn" href="#contact">Get a free roof inspection</a><a class="btn" href="/gallery/">See our work</a></section>
<section class="svc">
  <div class="card"><img src="/img/a.jpg" width="600" height="400" alt="Shingle roof"><h3>Roof Replacement</h3><p>A complete tear-off and new roof, done properly and on time.</p><a href="/services/roof-replacement/">Read more</a></div>
  <div class="card"><img src="/img/b.jpg" width="600" height="400" alt="Repair"><h3>Storm Damage Repair</h3><p>Fast repairs after hail and wind so the weather stays outside.</p><a href="/services/storm-damage/">Read more</a></div>
  <div class="card"><img src="/img/c.jpg" width="600" height="400" alt="Inspection"><h3>Roof Inspections</h3><p>A careful look at the whole roof with photographs and a plain report.</p><a href="/services/inspections/">Read more</a></div>
</section>
</body></html>`;

test('repeated service cards keep their names, descriptions, destinations and their own pictures', () => {
  const $ = cheerio.load(HTML);
  const cards = cardServices($, HOME);
  assert.deepEqual(cards.map((c) => c.name), ['Roof Replacement', 'Storm Damage Repair', 'Roof Inspections']);
  assert.ok(cards.every((c) => c.image && c.href && c.description), 'each card has a picture, a destination and a sentence');
  assert.match(cards[1].image!.url, /\/img\/b\.jpg$/); // the picture beside "Storm Damage Repair", not another card's
  assert.ok(cards[0].locator.includes('Roof Replacement'), 'the evidence says where it was read');
});

test('the website\'s own main action is kept, with its words and its destination', () => {
  const hero = heroOf(cheerio.load(HTML), HOME)!;
  assert.equal(hero.primary?.label, 'Get a free roof inspection');
  assert.equal(hero.primary?.terms, 'free');
  assert.equal(hero.primary?.kind, 'form');
  assert.equal(hero.secondary?.label, 'See our work');
});

test('one deduplicated service list: cards lead, menu-only services are secondary, inferred ones are proposals', () => {
  const $ = cheerio.load(HTML);
  const cards = cardServices($, HOME);
  const content = {
    services: cards.map((c) => ({ name: c.name, description: c.description, href: c.href, method: 'cards', locator: c.locator })),
    nav: navMenu($, HOME),
  } as any;
  const recs = reconcileServices({ homeUrl: HOME, content, crawl: [], inferred: [{ name: 'Roof Repair' }, { name: 'Attic Insulation' }] });
  const by = (n: string) => recs.find((r) => r.canonicalName === n)!;
  assert.deepEqual(recs.filter((r) => r.isPrimary).map((r) => r.canonicalName), ['Roof Replacement', 'Storm Damage Repair', 'Roof Inspections']);
  assert.equal(by('Gutter Installation').isPrimary, false); // in the menu only
  assert.equal(by('Gutter Installation').status, 'verified');
  assert.equal(by('Attic Insulation').status, 'needs_review'); // inferred: never shown without the owner
  assert.equal(recs.filter((r) => /gutter/i.test(r.canonicalName)).length, 1, 'no duplicates');
});

const model = (over: Partial<EvidenceModel> = {}): EvidenceModel => ({
  services: [
    { id: 'a', canonicalName: 'Roof Replacement', aliases: [], priority: 1, sourcePages: [], imageIds: [], isPrimary: true, status: 'verified', mentions: [] },
    { id: 'b', canonicalName: 'Roof Inspections', aliases: [], priority: 2, sourcePages: [], imageIds: [], isPrimary: true, status: 'verified', mentions: [] },
  ],
  assets: [{ kind: 'service', usable: true }],
  claims: {},
  conflicts: [],
  brand: { confidence: 'high' },
  hero: { primaryCta: { label: 'Get a free roof inspection' } },
  projectsVerified: false,
  ...over,
} as unknown as EvidenceModel);
const ok = { servicesShown: ['Roof Replacement', 'Roof Inspections'], headline: 'Roof replacement and inspections', typeLabel: 'Roofing contractor', primaryCtaLabel: 'Get a free roof inspection', galleryTitle: 'Photos', serviceCardImages: 2 };

test('publication blockers: a dropped service or a replaced main action stops the build; unverified work is only for review', () => {
  assert.deepEqual(reviewEvidence(model(), ok), []);
  const dropped = reviewEvidence(model(), { ...ok, servicesShown: ['Roof Replacement'] });
  assert.ok(dropped.some((f) => f.id === 'primary-services-missing' && f.level === 'block'));
  const swapped = reviewEvidence(model(), { ...ok, primaryCtaLabel: 'Request a quote' });
  assert.ok(swapped.some((f) => f.id === 'primary-cta-changed' && f.level === 'block'));
  const claimed = reviewEvidence(model(), { ...ok, galleryTitle: 'Recent work' });
  assert.ok(claimed.some((f) => f.id === 'project-attribution' && f.level === 'review'), '"Recent work" needs verified projects');
  assert.ok(!reviewEvidence(model({ projectsVerified: true } as any), { ...ok, galleryTitle: 'Recent work' }).some((f) => f.id === 'project-attribution'));
});

test('a headline must say what the business does, not just where it is', () => {
  const ctx = { typeLabel: 'Roofing contractor', services: ['Roof Replacement', 'Roof Inspections'] };
  assert.equal(headlineRelevant('Dependable roofing for your home', ctx), true);
  assert.equal(headlineRelevant('Welcome to 78664', ctx), false);
});

test('the finished page: the website\'s action is there, and no call to action is loose text', () => {
  const good = '<a class="btn btn-primary" href="#quote">Get a free roof inspection</a><a class="f-price is-quote" href="#quote">Request a quote</a>';
  assert.deepEqual(checkOutput(good, { services: [], ctaLabel: 'Get a free roof inspection' }), []);
  const lost = checkOutput('<a href="#quote">Request a quote</a>', { services: [], ctaLabel: 'Get a free roof inspection' });
  assert.ok(lost.some((c) => c.id === 'output-cta' && c.level === 'block'));
  const inert = checkOutput('<span class="f-price is-quote">Request a quote</span>', { services: [] });
  assert.ok(inert.some((c) => c.id === 'output-inert-cta' && c.level === 'block'));
});

test('publishing: the build\'s blocks stop it, items for review are warnings, and a lead test is required', () => {
  const items = publishReadiness({ facts: {}, media: [], revision: 1 } as any, [], { checks: [{ id: 'x', level: 'block', message: 'b' }, { id: 'y', level: 'review', message: 'r' }], leadTested: false });
  assert.ok(items.some((i) => i.key === 'build:x' && i.level === 'blocker'));
  assert.ok(items.some((i) => i.key === 'build:y' && i.level === 'warning'));
  assert.ok(items.some((i) => i.key === 'lead-test' && i.level === 'blocker'));
  const tested = publishReadiness({ facts: {}, media: [], revision: 1 } as any, [], { checks: [], leadTested: true });
  assert.ok(!tested.some((i) => i.key === 'lead-test'));
});

test('a story is led by whole sentences, never cut mid-sentence', () => {
  const story = 'We are a family-owned roofing company serving our neighbours. We replace and repair roofs after storms, and we do it with care and honest prices. Our crews are local and our warranty is in writing, so you know who to call. We have worked in this town for decades.';
  const lead = leadOf(story, 160);
  assert.ok(lead.length <= 200 && /[.!?]$/.test(lead), lead);
  assert.ok(story.startsWith(lead));
});

import { faithful, tidyHeading, extractParagraphs } from '../src/content/story.js';

const SOURCE = 'Look, we launched Acme Roofing because we got fed up watching homeowners get burned by fly-by-night contractors. Too many good people were stuck with shoddy leak repair and ghosted after paying deposits. Our approach: answer calls day or night, show up when we say we will, do the job right the first time, and back up our work.';

test('an edited About section may not add facts: numbers, names and claims must be in the source', () => {
  const good = ['Acme Roofing was started because the company saw homeowners let down by unreliable contractors, including poor leak repairs and deposits taken without follow-through.', 'The company answers calls day or night, arrives when it says it will, and does the job right the first time, then backs up its work.'];
  assert.equal(faithful(SOURCE, good, 'Acme Roofing'), undefined);
  assert.match(faithful(SOURCE, [good[0], 'The company has served more than 500 homes since 1998 and is licensed and insured throughout Texas.'], 'Acme Roofing')!, /number|claim/);
  assert.match(faithful(SOURCE, [good[0], 'Bob Smith leads every crew himself and inspects each roof before the work is signed off on.'], 'Acme Roofing')!, /not in the source/);
  // a number at the end of a sentence is the number, not the number and its full stop
  assert.equal(faithful(`In 2008, ${SOURCE}`, [`${good[0]} The business began in 2008.`], 'Acme Roofing'), undefined);
  assert.equal(tidyHeading('About ACME ROOFING', 'Acme Roofing'), 'About Acme Roofing');
  assert.equal(tidyHeading('OUR STORY', 'Acme Roofing'), 'Our story');
});

test('without an edit, the About text falls back to whole sentences in at most two short paragraphs', () => {
  const paras = extractParagraphs(SOURCE);
  assert.ok(paras.length >= 1 && paras.length <= 2);
  assert.ok(paras.every((p) => /[.!?]$/.test(p)));
});

test('a site with no list of services: the services its text names are shown; one named like the business itself is held for review', () => {
  const content = { services: [], nav: [], identity: { name: 'Veracruz All Natural' } } as any;
  const recs = reconcileServices({ homeUrl: HOME, content, crawl: [], textServices: [{ name: 'Tacos' }, { name: 'Fresh Juices' }, { name: 'Veracruz Fonda & Bar' }], inferred: [{ name: 'Delivery' }] });
  const by = (n: string) => recs.find((r) => r.canonicalName === n)!;
  assert.equal(by('Tacos').status, 'verified');
  assert.equal(by('Tacos').isPrimary, true);
  assert.equal(by('Veracruz Fonda & Bar').status, 'needs_review'); // a sister restaurant, not a menu item
  assert.equal(by('Delivery').status, 'needs_review');
});

test('headline relevance reads word stems: "Chiropractic Care" says what a chiropractor does', () => {
  assert.equal(headlineRelevant('Chiropractic Care in Lago Vista, TX', { typeLabel: 'Chiropractor', services: ['Chiropractic Adjustment', 'Decompression Therapy'] }), true);
  assert.equal(headlineRelevant('Welcome to Lago Vista', { typeLabel: 'Chiropractor', services: ['Chiropractic Adjustment', 'Decompression Therapy'] }), false);
});
