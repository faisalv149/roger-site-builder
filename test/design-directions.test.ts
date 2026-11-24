// The direction library and planner: a configurable number of ranked site-level directions, two new ones (the front
// page and the front desk), fewer when a business can't support more, near-duplicates rejected, recipes saved, and
// saved three-concept sets still valid. Synthetic verified catalogs for a restaurant, a trade business and a clinic;
// offline, no Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-directions-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), STUDIO_CONCEPT_FONTS: '0' });
delete process.env.STUDIO_MAX_DIRECTIONS;

const { rankDirections, rankPlans, maxDirections, shellOf, nearDuplicate, DIRECTIONS, conceptLetter } = await import('../src/studio/concepts/directions.js');
const { validatePlans, compose } = await import('../src/studio/concepts/plan.js');
const { ownerReview } = await import('../src/studio/concepts/types.js');
const { conceptHtml } = await import('../src/studio/concepts/render.js');
const { applyConceptShell } = await import('../src/studio/concepts/shell.js');
const { nextConcept } = await import('../src/studio/concepts/site.js');
const { studioDocs } = await import('../src/store.js');
type Catalog = import('../src/studio/concepts/review.js').Catalog;
type Photo = import('../src/studio/concepts/review.js').Photo;

const brief = { brand: { colors: [{ role: 'primary', hex: '#1F6F5C', confidence: 'high' }], fonts: [], logo: { value: null }, confidence: 'high', headingCase: 'none' } } as any;
const photos = (n: number, land = n, opts: { width?: number; alt?: string } = {}): Photo[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, url: `https://x/p${i + 1}.jpg`, width: opts.width ?? (i < land ? 1800 : 1000), height: i < land ? 1200 : 1400, orientation: i < land ? 'landscape' : 'portrait', uses: i < land ? ['hero', 'gallery'] : ['gallery'], alt: `${opts.alt ?? "A plumber at work on a job"} ${i + 1}`, services: [] }));
const HOURS = ['Monday: 9:00 AM – 5:00 PM', 'Tuesday: 9:00 AM – 5:00 PM', 'Saturday: Closed'];
function catalog(over: Partial<Catalog>): Catalog {
  return {
    brief: { businessKey: 'test', revision: 1, briefHash: 'h' }, business: { name: 'Test Business', category: 'Plumber', website: 'https://example.test/', summary: null },
    facts: { rating: {} as any, story: {} as any, hours: {} as any, phone: {} as any }, services: [], sectionImages: {}, items: [], locations: [{ id: 'loc1', street: '12 Main St', cityLine: 'Austin, TX 78701', formatted: '12 Main St, Austin, TX 78701', directions: 'dir-loc1' }],
    address: { id: 'loc1', formatted: '12 Main St, Austin, TX 78701' }, phone: { display: '(512) 555-0100', href: 'tel:+15125550100' }, email: null, hours: HOURS, area: null,
    rating: { value: 4.8, count: 120, href: null, scope: null }, claims: [], pledges: [], story: null, photos: photos(8, 5), logo: null,
    actions: [{ id: 'call', label: 'Call (512) 555-0100', href: 'tel:+15125550100', kind: 'call', factId: 'phone' }, { id: 'dir-loc1', label: 'Directions', href: 'https://maps.example/dir', kind: 'directions', factId: 'loc1' }],
    chooser: null, omitted: [], allowedText: 'Test Business 4.8 120 (512) 555-0100 12 Main St Austin TX 78701 9:00 5:00', forbidden: { phones: [], hrefs: [], prices: [] }, ...over,
  } as Catalog;
}
const trade = () => catalog({ business: { name: 'Cedar Lane Plumbing', category: 'Plumber', website: 'https://cedar.test/', summary: null }, services: ['Drain Cleaning', 'Water Heater Repair', 'Leak Detection', 'Repiping', 'Sewer Lines'].map((n, i) => ({ id: `s${i}`, name: n, description: `${n} for Austin homes.` })), story: { heading: 'About us', text: 'Cedar Lane Plumbing started with one van and a promise to show up when we say we will.' }, claims: [{ id: 'c1', text: 'Licensed and insured' }, { id: 'c2', text: 'Upfront pricing' }] });
const restaurant = () => catalog({ business: { name: 'Casa Verde', category: 'Mexican restaurant', website: 'https://casa.test/', summary: null }, items: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Taco ${i + 1}`, section: i < 6 ? 'Tacos' : 'Drinks', tags: [], price: '$4.50' })), story: { heading: 'Our story', text: 'Two sisters opened a food trailer on East Cesar Chavez and grew it into a family kitchen.' }, photos: photos(14, 9, { alt: "Inside the restaurant" }) });
const clinic = () => catalog({ business: { name: 'Lakeview Chiropractic', category: 'Chiropractor', website: 'https://lake.test/', summary: null }, services: ['Chiropractic Adjustment', 'Massage Therapy', 'Decompression Therapy'].map((n, i) => ({ id: `s${i}`, name: n })), actions: [{ id: 'book', label: 'Book online', href: 'https://book.test/', kind: 'book', factId: 'booking' }, { id: 'call', label: 'Call (512) 555-0100', href: 'tel:+15125550100', kind: 'call', factId: 'phone' }], photos: photos(3, 1, { alt: "" }) });

test('the library holds five site-level directions, each with its own hero, offer treatment and shell', () => {
  assert.equal(DIRECTIONS.length, 5);
  assert.equal(new Set(DIRECTIONS.map((d) => d.hero)).size, 5, 'a hero each');
  assert.equal(new Set(DIRECTIONS.map((d) => d.offer)).size, 5, 'an offer treatment each');
  const shells = DIRECTIONS.map((d) => shellOf({ sections: [{ kind: 'hero', variant: d.hero }] }));
  assert.equal(new Set(shells.map((s) => s.header)).size, 5, 'a header each');
  assert.deepEqual(shellOf({ sections: [{ kind: 'hero', variant: 'masthead' }] }), { header: 'masthead', footer: 'colophon' });
  assert.deepEqual(shellOf({ sections: [{ kind: 'hero', variant: 'desk' }] }), { header: 'utility', footer: 'utility' });
  assert.equal(maxDirections(), 5);
  assert.deepEqual([0, 1, 4, 5].map(conceptLetter), ['a', 'b', 'e', 'f']);
});

test('a business with the content for it gets up to five ranked directions, every pair distinct, in any trade', () => {
  for (const [label, cat] of [['trade', trade()], ['restaurant', restaurant()]] as const) {
    const { plans, ranking } = rankDirections(cat, brief);
    assert.ok(plans.length >= 4 && plans.length <= 5, `${label}: ${plans.length} directions`);
    assert.deepEqual(validatePlans(plans, cat, { copy: false }), [], `${label}: the planner's own plans pass the rules`);
    const scores = plans.map((p) => p.recipe!.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `${label}: strongest first`);
    assert.deepEqual(plans.map((p) => p.recipe!.rank), plans.map((_, i) => i + 1));
    for (const p of plans) assert.ok(p.recipe!.reasons.length && p.recipe!.evidence.facts.length + p.recipe!.evidence.photos.length > 0, `${label}: ${p.name} records why`);
    assert.equal(ranking.considered.filter((c) => c.status === 'kept').length, plans.length);
    // the two new directions take part wherever the business supports them
    assert.ok(plans.some((p) => p.sections[0].variant === 'masthead'), `${label}: the front page`);
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) assert.equal(nearDuplicate(plans[i], plans[j]), false);
  }
});

test('fewer, never padding: a clinic with three photos and no story gets the directions it can carry, the rest left out with reasons', () => {
  const cat = clinic();
  const { plans, ranking } = rankDirections(cat, brief);
  assert.ok(plans.length >= 1 && plans.length < 5, `${plans.length} directions`);
  assert.equal(plans[0].sections[0].variant, 'desk', 'the front desk leads for a clinic people book, with few photos');
  assert.equal(plans[0].primaryAction, 'book', 'its main action is the booking');
  const out = ranking.considered.filter((c) => c.status !== 'kept');
  assert.ok(out.length, 'directions are left out');
  for (const c of out) assert.ok(c.reasons.length, `${c.name}: says why`);
  assert.ok(out.some((c) => c.directionId === 'editorial' && /front page/.test(c.reasons[0])), 'the front page needs more than this clinic has');
  // a business with almost nothing (no photos, no visit facts) still gets one direction, the front desk, with why
  const bare = catalog({ photos: [], hours: null, phone: null, address: null, locations: [], rating: null, actions: [], services: [{ id: 's0', name: 'Repairs' }] });
  const one = rankDirections(bare, brief);
  assert.equal(one.plans.length, 1, 'never an empty set');
  assert.equal(one.plans[0].sections[0].variant, 'desk');
  assert.deepEqual(one.plans[0].hero.imageIds, [], 'no photo invented');
  assert.match(one.ranking.considered.find((c) => c.status === 'kept')!.reasons[0], /last resort/);
});

test('the limit is configurable: STUDIO_MAX_DIRECTIONS=3 keeps the three strongest, the rest are over the limit', () => {
  process.env.STUDIO_MAX_DIRECTIONS = '3';
  try {
    const { plans, ranking } = rankDirections(trade(), brief);
    assert.equal(plans.length, 3);
    assert.ok(ranking.considered.some((c) => c.status === 'over-limit'));
    assert.deepEqual(validatePlans(plans, trade(), { copy: false }), []);
    assert.match(validatePlans([...plans, plans[0]], trade(), { copy: false })[0], /between 1 and 3 directions/);
  } finally { delete process.env.STUDIO_MAX_DIRECTIONS; }
});

test('near-duplicates are rejected: a colour or type swap of a direction is not another direction', () => {
  const cat = trade();
  const [a] = rankDirections(cat, brief).plans;
  const swap = { ...a, name: 'Recoloured', axes: { ...a.axes, colorStrategy: 'brand-accent' as const, typeVoice: 'serif' as const } };
  assert.equal(nearDuplicate(a, swap), true);
  assert.ok(validatePlans([a, swap], cat, { copy: false }).some((e) => /same hero variant|near-duplicate/.test(e)));
  // Claude's directions go through the same ranking: the copy is dropped, the original kept
  const r = rankPlans([a, swap], cat, brief);
  assert.equal(r.plans.length, 1);
  assert.equal(r.ranking.considered.find((c) => c.name === 'Recoloured')!.status, 'duplicate');
});

test('each concept carries its recipe; saved three-concept sets (a, b, c, no recipe) still work', async () => {
  const cat = trade();
  const plans = rankDirections(cat, brief).plans;
  const concepts = plans.map((p, i) => compose(p, conceptLetter(i), 'fallback', cat, brief, i === 0));
  assert.deepEqual(concepts.map((c) => c.id), plans.map((_, i) => conceptLetter(i)));
  for (const c of concepts) assert.equal(c.recipe!.directionId, plans[concepts.indexOf(c)].recipe!.directionId);
  // an owner's choice may name any concept of a set, d and e included; an old a/b/c choice stays valid
  const review = (id: string) => ownerReview.safeParse({ schema: 'roger.owner-review', version: 1, id: 'x', brief: { businessKey: 'k', revision: 1, briefHash: 'h' }, reviewedBy: 'r', reviewedAt: 't', answers: {}, approvedAssets: [], approvedClaims: [], selectedConcept: { setId: 's', conceptId: id } });
  for (const id of ['a', 'c', 'e']) assert.ok(review(id).success, id);
  assert.equal(review('A').success, false);
  // a concept saved before recipes: its shell follows its hero
  const old = { ...concepts[0], recipe: undefined };
  assert.deepEqual(shellOf(old), { header: 'overlay', footer: 'standard' });
  // "another version" walks the saved set in rank order (a re-render of saved recipes), round to the start
  const set = { id: 'cs_test_n', concepts } as any;
  await studioDocs.put('studio-concept-sets', set.id, set);
  const order: string[] = [];
  let cur = 'a';
  for (let i = 0; i < concepts.length; i++) { const n = await nextConcept({ setId: set.id, conceptId: cur }); order.push(n!.id); cur = n!.id; }
  assert.deepEqual(order, [...concepts.slice(1).map((c) => c.id), 'a']);
  const three = { id: 'cs_test_3', concepts: concepts.slice(0, 3).map((c) => ({ ...c, recipe: undefined })) } as any;
  await studioDocs.put('studio-concept-sets', three.id, three);
  assert.equal((await nextConcept({ setId: three.id, conceptId: 'c' }))!.id, 'a');
});

test('the new directions render their own hero, offer, contact, header and footer, with SEO and keyboard structure', () => {
  for (const cat of [restaurant(), clinic()]) {
    const plans = rankDirections(cat, brief).plans;
    for (const id of ['masthead', 'desk']) {
      const p = plans.find((x) => x.sections[0].variant === id);
      if (!p) continue;
      const c = compose(p, 'a', 'fallback', cat, brief, false);
      const html = conceptHtml(c, cat, 'cs_none');
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${id}: one h1`);
      assert.match(html, /<a class="skip" href="#main">/);
      assert.match(html, /<meta name="robots" content="noindex">/);
      assert.match(html, /<button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-menu">/, `${id}: the phone menu`);
      assert.match(html, /:focus-visible\{outline/, 'visible focus');
      assert.match(html, /prefers-reduced-motion:reduce/);
      // every in-page link lands on something on the page
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `${id}: #${m[1]} exists`);
      if (id === 'masthead') {
        assert.match(html, /class="site-head site-head--masthead"/);
        assert.match(html, /class="site-foot site-foot--colophon"/);
        assert.match(html, /data-variant="masthead"[\s\S]*class="hm__toc"/, 'the front page lists the page');
        assert.match(html, /data-variant="ledger"/);
      } else {
        assert.match(html, /class="site-head site-head--utility"><div class="u__strip">/);
        assert.match(html, /class="site-foot site-foot--utility"/);
        assert.match(html, /aria-label="Visit details"/);
        assert.match(html, /data-variant="timetable"[\s\S]*<dt>Monday<\/dt><dd>9:00 AM – 5:00 PM<\/dd>/, 'the week as a timetable, the time never split at its colon');
        assert.match(html, /data-variant="tiles"/);
      }
    }
  }
  // the restaurant's tiles jump to each menu section
  const r = restaurant();
  const tiles = { ...rankDirections(r, brief).plans[0], sections: [{ kind: 'hero' as const, variant: 'desk' }, { kind: 'offer' as const, variant: 'tiles' }, { kind: 'contact' as const, variant: 'timetable' }] };
  const html = conceptHtml(compose(tiles, 'a', 'fallback', r, brief, false), r, 'cs_none');
  assert.match(html, /<nav class="tl__jump"[^>]*><ul><li><a href="#tl-0">Tacos<\/a><\/li><li><a href="#tl-1">Drinks<\/a>/);
});

test('inner pages wear the direction\'s own header and footer styles', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'site-'));
  const home = path.join(dir, 'index.html');
  const cat = restaurant();
  const p = rankDirections(cat, brief).plans.find((x) => x.sections[0].variant === 'masthead')!;
  const c = compose(p, 'a', 'fallback', cat, brief, false);
  const homeHtml = conceptHtml(c, cat, 'cs_none');
  fs.writeFileSync(home, homeHtml);
  fs.mkdirSync(path.join(dir, 'menu'));
  const inner = path.join(dir, 'menu', 'index.html');
  fs.writeFileSync(inner, '<html><head></head><body><header class="fb-head">old</header><main>Menu</main><footer class="fb-foot">old</footer></body></html>');
  applyConceptShell(dir, home, homeHtml, c.tokens, shellOf(c));
  const out = fs.readFileSync(inner, 'utf8');
  assert.match(out, /<div class="cx cx-head"><header class="site-head site-head--masthead"/);
  assert.match(out, /<div class="cx cx-foot"><footer class="site-foot site-foot--colophon"/);
  assert.match(out, /\.cx \.site-head--masthead\{/, 'the masthead header\'s styles, scoped');
  assert.match(out, /\.cx \.site-foot--colophon\{/);
  assert.match(out, /href="\.\.\/#offer"/, 'section links point back to the home page');
});

// ───────────────────────── lead selection: headline, lead image and main action chosen together ─────────────────────────
const { photoRole, journeyOf, scopedCity, leadConflicts, sameSubject } = await import('../src/studio/concepts/directions.js');
const { setDir } = await import('../src/studio/concepts/render.js');
const ph = (id: string, alt: string, o: Partial<Photo> = {}): Photo => ({ id, url: `https://x/${id}.jpg`, width: 2000, height: 1300, orientation: 'landscape', uses: ['hero', 'gallery'], alt, services: [], ...o });

test('location scope: a business in several cities is never described by one of them', () => {
  const locs = ['Round Rock, TX 78681', 'Austin, TX 78701', 'Austin, TX 78704', 'Sunset Valley, TX 78745'].map((city, i) => ({ id: `l${i}`, street: `${i} Main St`, cityLine: city, formatted: `${i} Main St, ${city}`, directions: `dir-l${i}` }));
  const cat = restaurant();
  Object.assign(cat, { locations: locs, address: null, hours: null });
  assert.equal(scopedCity(cat), undefined);
  const { plans } = rankDirections(cat, brief);
  for (const p of plans) assert.doesNotMatch(p.hero.headline, /Round Rock|Austin|Sunset Valley/, `${p.name}: "${p.hero.headline}"`);
  // no database-style line ("Mexican restaurant, 4 locations"): the business's own words, else what it is
  for (const p of plans) assert.doesNotMatch(p.hero.headline, /\d+ locations/, p.hero.headline);
  // a plan (Claude's) that names one of the cities is rejected
  assert.match(leadConflicts({ ...plans[0], hero: { ...plans[0].hero, headline: 'Mexican restaurant in Round Rock' } }, cat, { role: (p) => photoRole(p, cat), journey: 'visit' }).join(), /names Round Rock, but the business has 4 locations/);
  assert.equal(scopedCity(catalog({})), 'Austin', 'one location: its city');
});

test('image roles: a lead photo shows what the headline names; another service or a scene never leads', () => {
  // a roofing contractor whose biggest photos are a water-damage scene and a living room, then a roof
  const roof = catalog({ business: { name: 'Summit Roofing', category: 'Roofing Contractor', website: 'https://s.test/', summary: null }, area: ['Austin', 'Leander'],
    services: [{ id: 's1', name: 'Roof Replacement' }, { id: 's2', name: 'Water Damage Restoration' }],
    photos: [ph('water', 'Water-Damage-Picture', { width: 3000 }), ph('living', 'A bright living room with a sofa', { width: 2800 }), ph('roof', 'Crew installing asphalt shingles on a roof', { width: 1600 }), ph('tied', '', { services: ['Roof Replacement'], width: 1500 })] });
  assert.equal(photoRole(roof.photos[0], roof).role, 'off');
  assert.equal(photoRole(roof.photos[1], roof).role, 'off');
  assert.equal(photoRole(roof.photos[2], roof).role, 'subject');
  assert.equal(photoRole(roof.photos[3], roof).role, 'subject', 'tied to a core service');
  for (const p of rankDirections(roof, brief).plans) for (const id of p.hero.imageIds) assert.ok(!['water', 'living'].includes(id), `${p.name} leads with ${id}`);
  // a chiropractor's skincare photo is tied to a service that is not its core one
  const chiro = clinic();
  chiro.services = [{ id: 'a', name: 'Chiropractic Adjustment', imageId: 'adj' }, { id: 'b', name: 'Skincare & Wellness', imageId: 'skin' }];
  chiro.photos = [ph('skin', '', { services: ['Skincare & Wellness'], width: 3000 }), ph('adj', '', { services: ['Chiropractic Adjustment'] })];
  assert.equal(photoRole(chiro.photos[0], chiro).role, 'off');
  const lead = rankDirections(chiro, brief).plans.find((p) => p.sections[0].variant === 'full-bleed')!;
  assert.deepEqual(lead.hero.imageIds, ['adj']);
  assert.match(lead.recipe!.lead!.imageEvidence, /tied to the service Chiropractic Adjustment/);
  // a plan that leads with an off-subject photo is rejected, whatever its layout scores
  const bad = { ...lead, hero: { ...lead.hero, imageIds: ['skin'] } };
  assert.match(leadConflicts(bad, chiro, { role: (p) => photoRole(p, chiro), journey: 'visit' }).join(), /lead photo skin is tied to Skincare & Wellness/);
  const r = rankPlans([bad], chiro, brief);
  assert.equal(r.plans.length, 0);
  assert.equal(r.ranking.considered[0].status, 'unsupported');
});

test("customer journey: a business that works at the customer's property is asked for work, never sent to its office", () => {
  const roof = catalog({ area: ['Austin', 'Leander'], actions: [{ id: 'call', label: 'Call (512) 555-0100', href: 'tel:+15125550100', kind: 'call', factId: 'phone' }, { id: 'quote', label: 'Get a free roof inspection', href: 'https://s.test/inspect', kind: 'site', factId: 'cta' }, { id: 'dir-loc1', label: 'Directions', href: 'https://maps.example/dir', kind: 'directions', factId: 'loc1' }] });
  assert.equal(journeyOf(roof), 'on-site');
  const { plans, ranking } = rankDirections(roof, brief);
  assert.ok(!plans.some((p) => p.sections[0].variant === 'desk'), 'no "Before you come" front desk');
  assert.match(ranking.considered.find((c) => c.directionId === 'visit-desk')!.reasons[0], /request work at their own property/);
  for (const p of plans) assert.equal(p.primaryAction, 'quote', `${p.name}: the request, not ${p.primaryAction}`);
  // people who come to the business: a booking first; a restaurant's whole menu rather than one part of it
  assert.equal(rankDirections(clinic(), brief).plans[0].primaryAction, 'book');
  const r = restaurant();
  r.actions = [{ id: 'drinks', label: 'Drinks menu (PDF)', href: 'https://c.test/d.pdf', kind: 'menu', factId: 'm' }, { id: 'full', label: 'Menu (PDF)', href: 'https://c.test/m.pdf', kind: 'menu', factId: 'm' }];
  for (const p of rankDirections(r, brief).plans) assert.equal(p.primaryAction, 'full');
});

test('the story photo never repeats the people the hero shows', () => {
  const r = restaurant();
  r.photos = [ph('owners1', 'Ana and Lucia stand side by side smiling', { orientation: 'portrait', width: 1440, height: 1800 }), ph('owners2', 'Two smiling women, Ana and Lucia, pose outdoors', { orientation: 'portrait', width: 1100, height: 1600 }), ph('team', 'The kitchen crew at the pass', { orientation: 'portrait', width: 1000, height: 1400 }), ...photos(8, 5, { alt: 'Inside the restaurant' })];
  assert.equal(sameSubject(r.photos[0], r.photos[1]), true);
  const story = rankDirections(r, brief).plans.find((p) => p.recipe!.directionId === 'storyteller')!;
  const hero = r.photos.find((p) => p.id === story.hero.imageIds[0])!;
  const pic = r.photos.find((p) => p.id === story.storyImageId);
  assert.ok(!pic || !sameSubject(hero, pic), `story ${pic?.id} repeats hero ${hero.id}`);
});

test('on a phone the header action and the menu button never share a label', () => {
  const r = restaurant();
  r.actions = [{ id: 'full', label: 'Menu (PDF)', href: 'https://c.test/m.pdf', kind: 'menu', factId: 'm' }];
  const p = rankDirections(r, brief).plans[0];
  const html = conceptHtml(compose(p, 'a', 'fallback', r, brief, false), r, 'cs_none');
  assert.match(html, /class="menu-btn"[^>]*>Menu<\/button>/);
  assert.match(html, /<span class="lbl-s">View menu<\/span>/);
  assert.doesNotMatch(html, /<span class="lbl-s">Menu<\/span>/);
});

test('verified service photos appear in service layouts, each with its own service; the rest stay text', () => {
  const cat = clinic();
  cat.services = ['Chiropractic Adjustment', 'Decompression Therapy', 'Massage Therapy', 'Massage Chair Session'].map((n, i) => ({ id: `s${i}`, name: n, ...(i < 3 ? { imageId: `svc${i}` } : {}) }));
  cat.photos = [...cat.photos, ...[0, 1, 2].map((i) => ph(`svc${i}`, '', { services: [cat.services[i].name], width: 1200, uses: ['card'] }))];
  const setId = 'cs_test_service_photos';
  fs.mkdirSync(path.join(setDir(setId), 'img'), { recursive: true });
  for (const p of cat.photos) fs.writeFileSync(path.join(setDir(setId), 'img', `${p.id}.jpg`), 'x');
  const p = rankDirections(cat, brief).plans[0];
  const tiles = { ...p, sections: [{ kind: 'hero' as const, variant: 'desk' }, { kind: 'offer' as const, variant: 'tiles' }, { kind: 'contact' as const, variant: 'timetable' }], hero: { ...p.hero, imageIds: [] } };
  const html = conceptHtml(compose(tiles, 'a', 'fallback', cat, brief, false), cat, setId);
  const tile = (n: string) => html.match(new RegExp(`<li class="tl__tile[^"]*" data-fact="${n}">[\\s\\S]*?</li>`))![0];
  for (const i of [0, 1, 2]) assert.match(tile(`s${i}`), new RegExp(`<div class="tl__img"><img[^>]*data-asset="svc${i}"`), `service ${i} shows its own photo`);
  assert.doesNotMatch(tile('s3'), /<img/, 'a service without a photo of its own gets none');
  const cards = { ...tiles, sections: [{ kind: 'hero' as const, variant: 'desk' }, { kind: 'offer' as const, variant: 'cards' }, { kind: 'contact' as const, variant: 'timetable' }] };
  const c2 = conceptHtml(compose(cards, 'a', 'fallback', cat, brief, false), cat, setId);
  assert.equal((c2.match(/class="oc__img"/g) || []).length, 3, 'cards too: three own photos, one numbered text card');
});

// ───────────────────────── food over menu art, own words, verified heroes only, on-site evidence ─────────────────────────
const { menuArt, ownLine, onSiteEvidence } = await import('../src/studio/concepts/directions.js');

test('a restaurant leads with a verified food photo; its menu graphic goes in the menu section, never the hero', () => {
  const r = restaurant();
  r.items = ['Al Pastor Taco', 'Fish Taco', 'Veggie Taco', 'Green Juice', 'Orange Juice'].map((n, i) => ({ id: `m${i}`, name: n, section: i < 3 ? 'Tacos' : 'Drinks', tags: [] }));
  r.photos = [
    ph('board', '', { url: 'https://x/VAN+Tacos3.jpeg', pages: ['https://casa.test/menu'], orientation: 'portrait', width: 1320, height: 1780 }),
    ph('food', '', { url: 'https://x/01tacos-2-superJumbo.png', pages: ['https://casa.test/locations'], width: 1000, height: 667, uses: ['card', 'gallery'] }),
    ph('truck', 'A teal Casa Verde food truck parked by the patio', { width: 2500, height: 1400 }),
    ph('room', 'Interior of the dining room', { width: 2400, height: 1350 }),
    ph('anon', '', { url: 'https://x/IMG_8257.jpg', width: 2600, height: 1500 }),
  ];
  assert.equal(menuArt(r.photos[0], r), true, 'only on the menu page, named for the menu');
  assert.equal(menuArt(r.photos[1], r), false);
  assert.equal(photoRole(r.photos[0], r).role, 'off');
  assert.equal(photoRole(r.photos[1], r).food, true, 'a food photo');
  const { plans } = rankDirections(r, brief);
  for (const p of plans) assert.ok(!p.hero.imageIds.includes('board'), `${p.name} leads with the menu graphic`);
  const story = plans.find((p) => p.recipe!.directionId === 'storyteller')!;
  assert.deepEqual(story.hero.imageIds, ['food'], 'the food photo, before the place');
  const offer = compose(plans[0], 'a', 'fallback', r, brief, false).sections.find((s) => s.kind === 'offer')!;
  assert.deepEqual(offer.imageIds, ['board'], 'the menu graphic sits with the menu');
});

test("the headline is the business's own words, never a database line", () => {
  const r = restaurant();
  r.items = ['Al Pastor Taco', 'Fish Taco', 'Green Juice', 'Orange Juice'].map((n, i) => ({ id: `m${i}`, name: n, tags: [] }));
  r.ownLines = ['Come find us!', 'Learn More', 'Al Pastor Taco', 'The Story Behind Austin’s Most Iconic Tacos', 'Since 2008, 3 locations'];
  assert.equal(ownLine(r), 'The Story Behind Austin’s Most Iconic Tacos', 'UI words, a dish name and numbers are skipped');
  const story = rankDirections(r, brief).plans.find((p) => p.recipe!.directionId === 'storyteller')!;
  assert.equal(story.hero.headline, 'The Story Behind Austin’s Most Iconic Tacos');
  assert.match(story.recipe!.lead!.headlineEvidence, /own words/);
  // the business's own heading may name its own city, even with locations in several
  const multi = { ...r, locations: ['Austin, TX 78701', 'Round Rock, TX 78681'].map((c, i) => ({ id: `l${i}`, street: `${i} Main`, cityLine: c, formatted: c, directions: `d${i}` })), address: null };
  assert.deepEqual(leadConflicts(story, multi, { role: (p) => photoRole(p, multi), journey: 'visit' }), []);
  // nothing usable in its own words: what it is, never "category, N locations"
  r.ownLines = ['Learn More'];
  assert.equal(ownLine(r), undefined);
});

test('an undescribed photo never leads: those heroes are set in type instead', () => {
  const c = clinic();
  c.photos = photos(6, 4, { alt: '' });
  c.story = { heading: 'Our story', text: 'A family practice by the lake.' };
  c.services = ['Chiropractic Adjustment', 'Massage Therapy', 'Decompression Therapy', 'Spinal Care'].map((n, i) => ({ id: `s${i}`, name: n }));
  for (const p of c.photos) assert.equal(photoRole(p, c).role, 'unknown');
  const { plans, ranking } = rankDirections(c, brief);
  for (const p of plans) assert.deepEqual(p.hero.imageIds, [], `${p.name} leads with an undescribed photo`);
  assert.match(ranking.considered.find((x) => x.directionId === 'showcase')!.reasons[0], /no verified landscape photo/);
  const typed = plans.filter((p) => ['masthead', 'type-collage'].includes(p.sections[0].variant));
  assert.ok(typed.length >= 1, 'a type-led hero instead');
  for (const p of typed) assert.match(p.recipe!.lead!.imageEvidence, /type-led/);
  const col = plans.find((p) => p.sections[0].variant === 'type-collage');
  if (col) assert.match(conceptHtml(compose(col, 'a', 'fallback', c, brief, false), c, 'cs_none'), /class="wrap ht__grid ht__grid--type"/);
  // and a plan (Claude's) that leads with one is rejected
  const p0 = plans[0];
  assert.match(leadConflicts({ ...p0, hero: { ...p0.hero, imageIds: ['p1'] } }, c, { role: (p) => photoRole(p, c), journey: 'visit' }).join(), /undescribed/);
});

test("a business with no service list: the offerings its own photos are tied to name its subject; builder filler is no description", () => {
  const bakery = catalog({ business: { name: 'Crumb Bakery', category: 'Cafe', website: 'https://crumb.test/', summary: null }, services: [], area: null,
    photos: [ph('tied', '', { services: ['Cakes'] }), ph('cake', 'Under the Sea Cake.'), ph('filler', 'gallery photo number 11'), ph('slide', 'slideshow photo number 1'), ph('other', 'A parking lot at night')] });
  assert.equal(photoRole(bakery.photos[0], bakery).role, 'subject');
  assert.equal(photoRole(bakery.photos[1], bakery).role, 'subject', 'a cake, for a business whose own photos are of its cakes');
  assert.equal(photoRole(bakery.photos[2], bakery).role, 'unknown', 'filler is not a description');
  assert.equal(photoRole(bakery.photos[3], bakery).role, 'unknown');
  assert.equal(photoRole(bakery.photos[4], bakery).role, 'off');
});

test('a service area alone is not on-site work; the business must say it works at the property', () => {
  const bakery = catalog({ business: { name: 'Crumb Bakery', category: 'Bakery', website: 'https://crumb.test/', summary: null }, area: ['Austin', 'Round Rock'], services: [{ id: 's', name: 'Custom Cakes', description: 'Celebration cakes, delivered across Austin.' }], actions: [{ id: 'order', label: 'Order a cake', href: 'https://crumb.test/order', kind: 'site', factId: 'o' }] });
  assert.equal(onSiteEvidence(bakery), undefined);
  assert.equal(journeyOf(bakery), 'visit', 'delivery area: still a business people come to');
  const roofer = catalog({ area: ['Austin'], services: [{ id: 's', name: 'Roof Repair', description: 'We inspect your roof and fix leaks.' }] });
  assert.match(onSiteEvidence(roofer)!, /Roof Repair|your roof/i);
  assert.equal(journeyOf(roofer), 'on-site');
  const byAction = catalog({ area: ['Austin'], actions: [{ id: 'q', label: 'Get a free estimate', href: 'https://x.test/q', kind: 'site', factId: 'q' }] });
  assert.match(onSiteEvidence(byAction)!, /free estimate/);
  assert.equal(journeyOf(catalog({ area: null, services: [{ id: 's', name: 'Roof Repair', description: 'your roof' }] })), 'visit', 'no service area: people come to it');
});

// ───────────────────────── final pass: seasonal actions, image check, photos that fit their slot, no rating ─────────────────────────
const { seasonOf } = await import('../src/studio/concepts/seasonal.js');

test('seasonal actions: an expired one is never offered; one in season is never the main action', () => {
  const nov10 = new Date(2026, 10, 10);
  assert.deepEqual([seasonOf('Thanksgiving Pie Preorders!', nov10).seasonal, seasonOf('Thanksgiving Pie Preorders!', nov10).expired], [true, false], 'in season on Nov 10');
  assert.equal(seasonOf('Thanksgiving Pie Preorders!', new Date(2027, 2, 3)).expired, true, 'out of season in March');
  assert.equal(seasonOf('Pre-order Thanksgiving Favorites for 11/24 and 11/25', new Date(2026, 10, 26)).expired, true, 'both dates passed');
  assert.equal(seasonOf('Pre-order Thanksgiving Favorites for 11/24 and 11/25', nov10).expired, false);
  assert.equal(seasonOf('Valentine’s box — order by Feb 12', new Date(2027, 1, 20)).expired, true);
  assert.deepEqual(seasonOf('Order a custom cake', nov10), { seasonal: false, expired: false });
  // a seasonal link never leads, even when it is the business's only website action
  const shop = catalog({ business: { name: 'Crumb Bakery', category: 'Bakery', website: 'https://crumb.test/', summary: null }, phone: null,
    actions: [{ id: 'pies', label: 'Thanksgiving Pie Preorders!', href: 'https://crumb.test/pies', kind: 'site', factId: 'cta', seasonal: 'a thanksgiving offer' }, { id: 'order', label: 'Order a custom cake', href: 'https://crumb.test/order', kind: 'site', factId: 'cta2' }] });
  for (const p of rankDirections(shop, brief).plans) { assert.equal(p.primaryAction, 'order'); assert.notEqual(p.secondaryAction, 'pies'); }
});

test('the image check decides an undescribed photo: work and storefront lead, people and graphics do not', () => {
  const bakery = catalog({ business: { name: 'Crumb Bakery', category: 'Bakery', website: 'https://crumb.test/', summary: null }, services: [], area: null,
    photos: [ph('case', '', { seenKind: 'work', seen: 'a glass case of cupcakes and cookies', width: 1900, height: 1200 }), ph('front', '', { seenKind: 'storefront', seen: 'a pink bakery storefront' }), ph('crew', '', { seenKind: 'team', seen: 'two bakers smiling' }), ph('flyer', '', { seenKind: 'other', seen: 'a printed price list' }), ph('blind', '')] });
  const role = (id: string) => photoRole(bakery.photos.find((p) => p.id === id)!, bakery);
  assert.equal(role('case').role, 'subject');
  assert.match(role('case').why, /image check saw "a glass case of cupcakes and cookies"/);
  assert.equal(role('front').role, 'subject');
  assert.equal(role('crew').role, 'off', 'people tell the story; they do not lead');
  assert.equal(role('flyer').role, 'off');
  assert.equal(role('blind').role, 'unknown', 'no description and no image check: never a lead');
  const { plans } = rankDirections(bakery, brief);
  assert.ok(plans.some((p) => p.hero.imageIds[0] === 'case'), 'the verified photo leads a direction');
  for (const p of plans) for (const id of p.hero.imageIds) assert.ok(!['crew', 'flyer', 'blind'].includes(id), `${p.name} leads with ${id}`);
});

test('a photo fills only a slot it can: a small square is never stretched into a wide hero or band', () => {
  const small = catalog({ business: { name: 'Crumb Bakery', category: 'Bakery', website: 'https://crumb.test/', summary: null }, services: [], area: null,
    photos: [ph('sq', '', { seenKind: 'work', seen: 'a cookie cake', width: 800, height: 800, orientation: 'square' }), ph('mid', '', { seenKind: 'work', seen: 'a tray of pastries', width: 1100, height: 700 })] });
  const { plans, ranking } = rankDirections(small, brief);
  for (const p of plans) {
    if (['full-bleed', 'desk'].includes(p.sections[0].variant)) assert.ok(!p.hero.imageIds.includes('sq'), `${p.name}: the 800px square in a ${p.sections[0].variant} hero`);
    if (p.sections[0].variant === 'desk') assert.ok(!p.hero.imageIds.includes('mid'), 'a 1100px photo is too small for a full-width band');
  }
  assert.match(ranking.considered.find((c) => c.directionId === 'showcase')!.reasons[0], /no verified landscape photo/);
});

test('no Google rating: strong non-review designs still qualify; only the reputation direction needs reviews or claims', () => {
  const r = restaurant();
  r.rating = null;
  const { plans, ranking } = rankDirections(r, brief);
  for (const id of ['showcase', 'storyteller', 'editorial']) assert.ok(plans.some((p) => p.recipe!.directionId === id), `${id} without a rating`);
  assert.match(ranking.considered.find((c) => c.directionId === 'reputation')!.reasons[0], /no Google rating and no claims/);
});

test('a business with a story and no verified photo: the story-first direction leads in type', () => {
  const firm = catalog({ business: { name: 'Northwind IT', category: null, website: 'https://nw.test/', summary: null }, photos: [], rating: null, hours: null, address: null, locations: [], phone: null,
    story: { heading: 'About us', text: 'We connect business software to the rest of the business, and fix it when it breaks.' },
    services: ['Integrations', 'Migrations', 'Rescue work', 'Fractional IT leadership'].map((n, i) => ({ id: `s${i}`, name: n })),
    actions: [{ id: 'talk', label: 'Discuss your project', href: 'https://nw.test/contact', kind: 'site', factId: 'cta' }] });
  const { plans } = rankDirections(firm, brief);
  const story = plans.find((p) => p.recipe!.directionId === 'storyteller');
  assert.ok(story, `story-first kept: ${plans.map((p) => p.recipe!.directionId).join(', ')}`);
  assert.deepEqual(story!.hero.imageIds, []);
  assert.equal(story!.primaryAction, 'talk');
  assert.match(conceptHtml(compose(story!, 'a', 'fallback', firm, brief, false), firm, 'cs_none'), /<section class="hero hs hs--type"/);
  assert.ok(plans.length >= 2, 'more than one design without a rating or photos');
});

test('real content: a story keeps its first sentence; a remote business says Contact; the masthead says what it does; no repeated photo', () => {
  const firm = catalog({ business: { name: 'Northwind IT', category: 'IT consultant', website: 'https://nw.test/', summary: null }, photos: [], rating: null, hours: null, address: null, locations: [], phone: null, email: 'hi@nw.test',
    ownLines: ['Integrations and migrations, connected to the rest of your business.'],
    story: { heading: 'About', text: 'I have built integrations in C#, X++ and .NET development for 17 years. My background combines finance and engineering.' },
    services: ['Integrations', 'Migrations', 'Rescue work', 'Fractional leadership'].map((n, i) => ({ id: `s${i}`, name: n })),
    actions: [{ id: 'talk', label: 'Discuss your project', href: 'https://nw.test/contact', kind: 'site', factId: 'cta' }] });
  const plans = rankDirections(firm, brief).plans;
  const c = compose(plans.find((p) => p.recipe!.directionId === 'editorial') ?? plans[0], 'a', 'fallback', firm, brief, false);
  assert.match(c.copy.find((x) => x.slot === 'story.text')!.text, /^I have built integrations in C#, X\+\+ and \.NET development/, 'the story starts where the business starts it');
  assert.equal(c.sections.find((s) => s.kind === 'contact')!.title, 'Contact', 'no address: Contact, not Visit');
  const html = conceptHtml(c, firm, 'cs_none');
  assert.match(html, /<a href="#visit">Contact<\/a>/);
  if (c.sections[0].variant === 'masthead') assert.match(html, /class="hm__deck">Integrations and migrations, connected to the rest of your business\.</, "the business's own line under the masthead");
  assert.doesNotMatch(html, /<p class="cf__h">Visit<\/p>/, 'no empty Visit column');
  // a photo already on the page (the story's) is not shown again in the gallery
  const r = restaurant();
  const story = rankDirections(r, brief).plans.find((p) => p.recipe!.directionId === 'storyteller')!;
  const setId = 'cs_test_no_repeat';
  fs.mkdirSync(path.join(setDir(setId), 'img'), { recursive: true });
  for (const p of r.photos) fs.writeFileSync(path.join(setDir(setId), 'img', `${p.id}.jpg`), 'x');
  const page = conceptHtml(compose(story, 'b', 'fallback', r, brief, false), r, setId);
  const ids = [...page.matchAll(/data-asset="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `a photo shown twice: ${ids.join(', ')}`);
});
