// The splash page's foundations (no AI, no network): the trade playbook, the trade classifier, the fact sheet and its
// open questions, review selection, and the screen plan. Synthetic businesses only.
import test from 'node:test';
import assert from 'node:assert/strict';
const { PLAYBOOK, GENERIC_ROW, STANDARD_ORDER, FAMILY_ORDER, tradeRow, isCalm, minimalContact, watchOuts } = await import('../src/splash/playbook.js');
const { classifyTrade } = await import('../src/splash/classify.js');
const { buildFactSheet, openQuestions, fact } = await import('../src/splash/facts.js');
const { selectReviews, trimReview } = await import('../src/splash/reviews.js');
const { planScreens } = await import('../src/splash/screens.js');

test('the playbook: every row is complete; the scroll order is the standard one, or its family\'s', () => {
  const ids = new Set<string>();
  for (const r of [...PLAYBOOK, GENERIC_ROW]) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`); ids.add(r.id);
    assert.ok(r.schemaType && r.firstScreen && r.standardFlow.length, r.id);
    assert.ok(!r.dock.includes(r.mainAction), `${r.id}: the main action is not repeated in the dock`);
    assert.ok(r.dock.length <= 4, `${r.id}: at most four secondary actions (desktop shows five with the main one)`);
    assert.ok(r.keywords.every((k) => k === k.toLowerCase()), r.id);
    assert.ok(r.standardFlow.every((s) => !/guarantee|promise|always|within \d/i.test(s)), `${r.id}: no invented guarantees`);
  }
  for (const order of Object.values(FAMILY_ORDER)) {
    assert.deepEqual([...order].sort(), [...STANDARD_ORDER].sort(), 'every family uses all nine screens');
    assert.equal(order[0], 'hero'); assert.equal(order.at(-1), 'cta');
  }
  assert.ok(PLAYBOOK.filter(isCalm).map((r) => r.id).sort().join() === 'counseling,funeral,restoration');
  assert.ok(minimalContact(tradeRow('dentist')) && minimalContact(tradeRow('counseling')) && !minimalContact(tradeRow('plumber')));
  assert.ok(watchOuts(tradeRow('restaurant')).some((w) => /allergen/i.test(w)) && watchOuts(tradeRow('restaurant')).some((w) => /superlatives/i.test(w)));
});

test('the trade: the owner first, then Google\'s primary type, other types, the category and name, then the website', () => {
  assert.deepEqual(classifyTrade({ ownerTrade: 'bakery', primaryType: 'cafe' }).row.id, 'bakery', 'the owner wins');
  const p = classifyTrade({ primaryType: 'roofing_contractor', types: ['roofing_contractor', 'general_contractor'] });
  assert.equal(p.row.id, 'roofer'); assert.equal(p.confidence, 0.95); assert.equal(p.via, 'primary-type');
  assert.equal(classifyTrade({ types: ['point_of_interest', 'plumber'] }).row.id, 'plumber');
  assert.equal(classifyTrade({ category: 'Barber shop', name: 'Clip Craft Studio' }).row.id, 'barber');
  // a bakery cafe: the primary type's row, the other trade named for the Offer screen
  const bc = classifyTrade({ primaryType: 'bakery', types: ['bakery', 'cafe', 'food'] });
  assert.equal(bc.row.id, 'bakery'); assert.equal(bc.secondary, undefined, 'a cafe is the same family as a bakery');
  const sb = classifyTrade({ primaryType: 'barber_shop', types: ['barber_shop', 'cafe'] });
  assert.equal(sb.secondary?.id, 'cafe');
  // unsure: the generic row, and the owner is asked
  const weak = classifyTrade({ name: 'Northside Holdings', websiteText: 'Welcome. We fix things around the house.' });
  assert.equal(weak.row.id, 'generic'); assert.equal(weak.askOwner, true);
  const site = classifyTrade({ name: 'Northside', websiteText: 'Drain cleaning, water heater repair and plumbing for Northside homes.' });
  assert.equal(site.row.id, 'plumber'); assert.equal(site.confidence, 0.7);
});

test('the fact sheet: owner over website over Google; a disagreement becomes a question; no source, no fact', () => {
  const at = '2026-11-23T10:00:00Z';
  const sheet = buildFactSheet([
    { field: 'phone', value: '(512) 555-0100', source: 'google', source_ref: 'places:nationalPhoneNumber', retrieved_at: at },
    { field: 'phone', value: '512.555.0100', source: 'website', source_ref: 'https://x.example/contact', retrieved_at: at },
    { field: 'hours', value: ['Mon–Fri 8–5'], source: 'website', source_ref: 'https://x.example/', retrieved_at: at },
    { field: 'hours', value: ['Mon–Sat 8–6'], source: 'google', source_ref: 'places:regularOpeningHours', retrieved_at: at },
    { field: 'hours', value: ['Mon–Sat 7–6'], source: 'owner', source_ref: 'imessage:2026-11-23', retrieved_at: at },
    { field: 'years_in_business', value: '', source: 'website', source_ref: 'https://x.example/about', retrieved_at: at },
    { field: 'free_estimate', value: 'Free estimates', source: 'website', source_ref: '', retrieved_at: at },
  ]);
  assert.equal(fact(sheet, 'hours')?.source, 'owner');
  assert.equal(fact(sheet, 'phone')?.source, 'website');
  assert.equal(sheet.conflicts.find((c) => c.field === 'phone'), undefined, 'the same number written differently is not a conflict');
  assert.equal(sheet.conflicts.find((c) => c.field === 'hours')?.others.length, 2);
  assert.equal(fact(sheet, 'years_in_business'), undefined, 'an empty value is no fact');
  assert.equal(fact(sheet, 'free_estimate'), undefined, 'a value without a source is no fact');
  const qs = openQuestions(sheet, { tradeUnsure: 'a plumber', notes: ['A page on your site has text addressed to an AI assistant; it was ignored.', 'a', 'b', 'c'] });
  assert.equal(qs.length, 5, 'at most five');
  assert.match(qs[0], /^Your opening hours: you told me "Mon–Sat 7–6", but your website says "Mon–Fri 8–5"\. Which is right\?$/);
  assert.match(qs[1], /^Is your business a plumber\?/);
});

test('selected reviews: 4 and 5 stars, quotable, no health conditions, no named people, no complaints; trimmed with an ellipsis', () => {
  const r = (rating: number, text: string) => ({ author: 'A Reviewer', text, rating });
  const choice = selectReviews([
    r(5, 'Fixed our leaking boiler the same afternoon and left the place spotless. Clear pricing up front.'),
    r(3, 'It was fine I suppose, nothing special about the visit at all really.'),
    r(5, 'After my surgery they made the appointment easy and the whole visit calm and friendly.'),
    r(5, 'Ask for Jordan, he sorted the whole thing out in an hour and explained every step.'),
    r(4, 'Good work overall, however the wait for the quote was longer than we expected.'),
    r(5, 'Great.'),
    r(5, 'Polite, quick and tidy. They explained the options and let us choose without any pressure at all.'),
    r(5, 'Sam was brilliant from the first call to the last, we will use them again for sure.'),
  ], { names: ['Sam'] });
  assert.deepEqual(choice.selected.map((s) => s.index), [0, 6]);
  assert.deepEqual(Object.fromEntries(choice.skipped.map((s) => [s.index, s.reason])), { 1: 'under 4 stars', 2: 'mentions a health condition', 3: 'names another person', 4: 'contains a complaint', 5: 'too short to quote', 7: 'names another person' });
  assert.equal(choice.howChosen, 'Selected from recent 4- and 5-star Google reviews.');
  assert.equal(trimReview('word '.repeat(100), 40).endsWith('…'), true);
  assert.ok(trimReview('word '.repeat(100), 40).length <= 40);
  assert.equal(selectReviews([r(5, 'A long and lovely review of the place that anyone would quote.')], { hide: true }).selected.length, 0, 'a trade that shows no reviews');
});

test('the screen plan: a rich business gets every screen in its order; a sparse one keeps 4, merging thin screens into their neighbour', () => {
  const rich = planScreens(tradeRow('plumber'), { reviews: 4, credentials: 2, offerings: 8, photos: 9, processStated: true, aboutName: true, aboutStory: true, faqs: 5 });
  assert.deepEqual(rich.screens.map((s) => s.screen), STANDARD_ORDER);
  assert.match(rich.screens[0].content, /Main action: Call\./);
  const sparse = planScreens(tradeRow('plumber'), { reviews: 1, credentials: 0, offerings: 2, photos: 0, processStated: false, aboutName: true, aboutStory: false, faqs: 0 });
  assert.deepEqual(sparse.screens.map((s) => s.screen), ['hero', 'expect', 'where', 'cta'], 'never fewer than four');
  assert.deepEqual(sparse.merged.map((m) => `${m.screen}>${m.into}`), ['proof>hero', 'offer>hero', 'about>expect']);
  assert.deepEqual(sparse.dropped.map((d) => d.screen), ['work', 'faq']);
  assert.match(sparse.screens.find((s) => s.screen === 'expect')!.content, /plain standard flow/);
  assert.match(sparse.screens[0].content, /Also: proof \(only 1 quotable review/);
  // food leads with the menu and the food
  const cafe = planScreens(tradeRow('restaurant'), { reviews: 3, credentials: 0, offerings: 12, photos: 6, processStated: false, aboutName: false, aboutStory: false, faqs: 0 });
  assert.deepEqual(cafe.screens.map((s) => s.screen), ['hero', 'offer', 'work', 'proof', 'expect', 'where', 'cta']);
  assert.ok(cafe.screens.length >= 4 && cafe.screens.length <= 9);
});
