// The custom intake's conversation, end to end through the inbound handler and polls, with Google lookups, website
// checks and jobs faked (no network, no AI, no paid job): name-only ambiguity, name plus location, a conflicting
// location, a verified website, no website, an uncertain website, corrections before research, Roger's own voice, one
// job and one message however often the customer writes or the page polls, and the simulator's typing indicator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-imsg-conv-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { handleInbound, pollIntake } = await import('../src/imessage/flow.js');
const { discovery, inLocation, splitBusiness, credibleListing, looksLikeAddress } = await import('../src/imessage/custom-flow.js');
const { addressAgrees, addressNamed, parseBusinessInput } = await import('../src/studio/resolve-business.js');
const { intakeDeps } = await import('../src/imessage/custom-intake.js');
const { getConversation, saveConversation } = await import('../src/store.js');
const { screenshotsAvailable, launchBrowser } = await import('../src/render/og.js');
import type { BusinessCandidate } from '../src/types.js';

// Google as a stub answers (synthetic businesses: a name with a town in it, whose two Wisconsin branches come back even for "Austin TX")
const L = (placeId: string, name: string, address: string, website?: string): BusinessCandidate => ({ placeId, name, address, website, types: ['plumber'] });
const HARTLAND = L('pHart', 'Austin Pipe Works, Heating, Air & Electric', '530 Lakeview Dr, Hartland, WI 53029, USA', 'https://austinpipeworks.example/');
const GERMANTOWN = L('pGerm', 'Austin Pipe Works, Heating, Air & Electric', 'W190N10000 Example Ave, Germantown, WI 53022, USA', 'https://austinpipeworks.example/');
const SUGAR = L('pSugar', "Sweet Sixth Bakeshop", '1200 S 6th St, Austin, TX 78704, USA', 'https://www.sweetsixth.example/');
const LEVELUP = L('pLevel', 'Peak Form Fitness Club', '3rd floor, Example Mall, Main Road, Lahore, 54600, Pakistan');
const ODD = L('pOdd', 'Corner Cafe', '12 Main St, Hartland, WI 53029, USA', 'https://some-directory.example/corner-cafe');
const ALL = [HARTLAND, GERMANTOWN, SUGAR, LEVELUP, ODD];
const PLACES = new Set(['austin tx', 'austin, tx', 'lahore', 'paragon city', 'pakistan', 'hartland', 'hartland, wi', 'hartland wi', '78704', 'wi', 'tx']);
let lookups = 0;
/** what each lookup asked Google; a test may set what Google answers (otherwise: the listings named like the query) */
const asked: { text?: string; name?: string; address?: string }[] = [];
let google: ((i: { text?: string; name?: string; address?: string }) => BusinessCandidate[]) | undefined;
discovery.resolve = async (i: { text?: string; name?: string; address?: string }) => {
  lookups++; asked.push(i);
  if (google) return { status: 'choose', candidates: google(i), reason: 'test', query: [i.name, i.address].filter(Boolean).join(', ') } as never;
  const name = (i.name ?? i.text ?? '').toLowerCase();
  const found = ALL.filter((c) => c.name.toLowerCase().includes(name.split(',')[0].trim()) || name.includes(c.name.toLowerCase().split(',')[0]));
  return { status: 'choose', candidates: found, reason: 'test', query: name } as never;
};
discovery.isPlace = async (t: string) => PLACES.has(t.trim().toLowerCase());
// a listing's card: its share page, and (for listings with photos) the first photo's author
const WITH_PHOTO = new Set(['pPharm63', 'pB1']);
discovery.card = async (c: BusinessCandidate) => ({ url: `https://cards.example/${c.placeId}/`, image: `https://cards.example/${c.placeId}/card.jpg`, photo: WITH_PHOTO.has(c.placeId) ? { author: 'A. Photographer' } : undefined });
const siteChecks: string[] = [];
discovery.checkSite = async (_c, url, from) => {
  siteChecks.push(url);
  return /sweetsixth|austinpipeworks/.test(url) ? { url, status: 'verified', evidence: 'same phone number, name matches', from } : { url, status: 'uncertain', evidence: 'nothing on the site ties it to the listing', from };
};
// jobs: counted, never run
const starts = { research: 0, generation: 0 };
let researchDone = false;
Object.assign(intakeDeps, {
  getBrief: async () => ({ brief: undefined }),
  startStudioJob: async () => { starts.research++; return { id: `sj_${starts.research}` }; },
  getStudioJob: async (id: string) => ({ id, status: researchDone ? 'done' : 'running', businessKey: 'place-pSugar', revision: 1, stages: [] }),
  resumeIfStale: async (j: unknown) => j,
  startFrontendJob: async () => { starts.generation++; return { id: `fe_test${starts.generation}` }; },
  getFrontendJob: async (id: string) => ({ id, status: 'generating', stage: 'pages', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }),
  frontendJobRunning: () => true,
});

let n = 0;
const convo = () => `imsg-conv-${++n}`;
const say = async (from: string, text: string) => (await handleInbound(from, text, { async: true, intake: 'custom' })).replies;
/** the conversation as read: a message's text, or a card's title and its second line */
const texts = (r: { text: string; url?: string; title?: string; subtitle?: string }[]) => r.map((x) => (x.url ? [x.title, x.subtitle].filter(Boolean).join('\n') : x.text)).join('\n');
const cardsOf = (r: { url?: string; title?: string; subtitle?: string; image?: string; choice?: string }[]) => r.filter((x) => x.url);
const VOICE = /our team|the team|we'll|we will|someone (from|will)|text you|I'll text/i;

test('locations are read from the message, and an address is matched to the location given', async () => {
  assert.deepEqual(await splitBusiness('Austin Pipe Works, Heating, Air & Electric'), { name: 'Austin Pipe Works, Heating, Air & Electric' });
  assert.deepEqual(await splitBusiness("Sweet Sixth Bakeshop, Austin TX"), { name: "Sweet Sixth Bakeshop", location: 'Austin TX' });
  assert.deepEqual(await splitBusiness('Peak Form Fitness Club, Lahore'), { name: 'Peak Form Fitness Club', location: 'Lahore' });
  assert.deepEqual(await splitBusiness("Sweet Sixth Bakeshop 78704"), { name: "Sweet Sixth Bakeshop", location: '78704' });
  assert.equal(inLocation(HARTLAND.address, 'Austin TX'), false);
  assert.equal(inLocation(HARTLAND.address, 'Hartland, WI'), true);
  assert.equal(inLocation(GERMANTOWN.address, 'Hartland, WI'), false);
  assert.equal(inLocation(SUGAR.address, '78704'), true);
  assert.equal(inLocation(SUGAR.address, 'Austin, Texas'), true);
  assert.equal(inLocation(LEVELUP.address, 'Lahore'), true);
});

test('a name with no location: the listings with that name to choose from; a location instead narrows it to a credible match', async () => {
  const from = convo();
  await say(from, 'Hi');
  const a = await say(from, 'Austin Pipe Works, Heating, Air & Electric');
  assert.match(texts(a), /^I found 2 listings on Google for Austin Pipe Works, Heating, Air & Electric\. Which one is yours\?\n1\. Austin Pipe Works, Heating, Air & Electric\n530 Lakeview Dr, Hartland, WI 53029\n2\. Austin Pipe Works, Heating, Air & Electric\nW190N10000 Example Ave/);
  assert.deepEqual(a.at(-1)?.quickReplies, ['1. 530 Lakeview Dr', '2. W190N10000 Example Ave', 'None of these']);
  assert.doesNotMatch(texts(a), /Do you have a website/);
  // the customer sends a town instead of choosing: Austin, TX, where no listing with that name is, so none is offered
  const b = await say(from, 'Austin TX');
  assert.match(texts(b), /I couldn't find Austin Pipe Works, Heating, Air & Electric in Austin TX on Google\. The listings I found with that name are in other places/);
  assert.doesNotMatch(texts(b), /Hartland|Germantown|Is this your business/);
  assert.match(texts(b), /Where is your business\?/);
  // the customer answers with the town only: the name is kept; only the Hartland branch is offered, with its full
  // address (its website is checked only once the customer confirms it)
  const c = await say(from, 'Hartland, WI');
  assert.match(texts(c), /Is this your business\?\nAustin Pipe Works, Heating, Air & Electric\n530 Lakeview Dr, Hartland, WI 53029\nTap "Yes, that's it" to start your preview\. If it isn't yours, reply "No" or send me the Google Maps link to your listing\./);
  // the listing is a card: it opens the listing, and choosing it is "Yes, that's it"
  assert.deepEqual(cardsOf(c).map((x) => [x.title, x.url, x.choice]), [['Austin Pipe Works, Heating, Air & Electric', 'https://cards.example/pHart/', "Yes, that's it"]]);
  assert.deepEqual(c.at(-1)?.quickReplies, ["Yes, that's it", 'No, not this one']);
  assert.doesNotMatch(texts(c), /Germantown/);
});

test('name and location in one message; no website is checked or asked about before the listing is confirmed', async () => {
  const from = convo();
  await say(from, 'Hi');
  const checks = siteChecks.length;
  const r = await say(from, "Sweet Sixth Bakeshop, Austin TX");
  assert.match(texts(r), /^Is this your business\?\nSweet Sixth Bakeshop\n1200 S 6th St, Austin, TX 78704$/m);
  assert.doesNotMatch(texts(r), /Do you have a website|Website:/);
  assert.equal(siteChecks.length, checks, 'the website is not checked before the yes');
});

test('before the yes the customer may correct the website (noted, not checked) or the listing; nothing starts', async () => {
  const lv = convo();
  await say(lv, 'Hi');
  assert.match(texts(await say(lv, 'Peak Form Fitness Club, Lahore')), /^Is this your business\?\nPeak Form Fitness Club\n3rd floor, Example Mall/m);
  const odd = convo();
  await say(odd, 'Hi');
  const checks = siteChecks.length;
  assert.match(texts(await say(odd, 'Corner Cafe, Hartland WI')), /^Is this your business\?\nCorner Cafe\n12 Main St, Hartland, WI 53029$/m);
  // corrections before research: the customer's own link (noted), then "no website", then a different listing
  assert.match(texts(await say(odd, 'https://www.sweetsixth.example')), /^Thanks, I'll check sweetsixth\.example once you confirm your listing\.\nIs this your business\?/);
  assert.match(texts(await say(odd, 'no website')), /^No problem, I'll build from your Google listing\.\nIs this your business\?/);
  assert.match(texts(await say(odd, 'No, not this one')), /Sorry about that\. Send me the Google Maps link to your listing/);
  assert.equal(siteChecks.length, checks, 'no website was checked: no listing was confirmed');
  assert.equal(starts.research + starts.generation, 0, 'nothing starts before the customer says yes');
});

test('after "yes": one message, one research job and one generation, however often the customer writes or the page polls', async () => {
  const from = convo();
  await say(from, 'Hi');
  await say(from, "Sweet Sixth Bakeshop 78704");
  const checks = siteChecks.length;
  const yes = await handleInbound(from, "Yes, that's it", { async: true, intake: 'custom' });
  assert.deepEqual(siteChecks.slice(checks), ['https://www.sweetsixth.example/'], 'the listing\'s website is checked once, after the yes');
  assert.deepEqual(yes.replies.map((r) => r.text), ['Thanks! I\'m researching your business and building your website preview. I\'ll check it and send the link here when it\'s ready. This may take a few minutes.']);
  assert.ok(yes.pending, 'a job is under way (the simulator shows no typing indicator for it)');
  assert.equal(starts.research, 1);
  const count = async () => (await getConversation(from))!.messages.length;
  const before = await count();
  // repeated polls (some at the same moment) and messages mid-build
  await Promise.all([1, 2, 3, 4, 5].map(() => pollIntake(from)));
  const mid1 = await say(from, "Yes, that's it");
  const mid2 = await say(from, 'hello?');
  assert.match(texts(mid1), /^I'm still researching your business\. I'll send the link here when your preview is ready\.$/);
  assert.match(texts(mid2), /still researching/);
  researchDone = true;
  await Promise.all([1, 2, 3].map(() => pollIntake(from)));
  await pollIntake(from);
  const mid3 = await say(from, 'is it ready?');
  assert.match(texts(mid3), /^Still building your preview\. I'm on the inner pages now\. I'll send the link here when it's ready\.$/);
  assert.equal(starts.research, 1, 'one research job');
  assert.equal(starts.generation, 1, 'one generation');
  // the polls added no messages: only the customer's three mid-build texts and Roger's three short answers
  assert.equal(await count(), before + 6);
  const all = (await getConversation(from))!.messages.filter((m) => m.dir === 'out').map((m) => m.text).join('\n');
  assert.doesNotMatch(all, VOICE, 'Roger speaks for himself; the internal review is never mentioned');
});

test('the simulator: the typing indicator goes once Roger replies and stays gone through a long job; the later link shows; no sideways scroll', { skip: screenshotsAvailable() ? false : 'no browser here' }, async () => {
  const dir = path.resolve('public/imessage');
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    let polls = 0;
    const msgs: { dir: string; at: string; text: string; url?: string; quickReplies?: string[] }[] = [];
    const ack = 'Thanks! I\'m researching your business and building your website preview. I\'ll check it and send the link here when it\'s ready. This may take a few minutes.';
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/imessage/')) { const f = path.join(dir, u.pathname.replace('/imessage/', '') || 'index.html'); return route.fulfill({ body: fs.readFileSync(fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(dir, 'index.html')), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); }
      if (u.pathname === '/api/health') return route.fulfill({ json: { mock: false, claudeVia: 'cli', model: 'x' } });
      if (u.pathname === '/api/imessage/inbound') {
        const text = JSON.parse(route.request().postData() ?? '{}').text;
        msgs.push({ dir: 'in', at: new Date().toISOString(), text }, { dir: 'out', at: new Date().toISOString(), text: ack });
        return route.fulfill({ json: { replies: [{ text: ack }], pending: true, messageCount: msgs.length } });
      }
      if (u.pathname.startsWith('/api/conversations/')) {
        polls++;
        // the job runs for many polls; then the link arrives while the run is still "pending" in the server's terms
        if (polls === 4) msgs.push({ dir: 'out', at: new Date().toISOString(), text: "Here's a preview of a new site for Sweet Sixth Bakeshop.", url: 'http://localhost:4000/v/fe_x', quickReplies: ['Approve and publish', 'Request another version'] });
        return msgs.length ? route.fulfill({ json: { from: 'x', startedAt: msgs[0].at, messages: msgs, pending: polls < 6 } }) : route.fulfill({ status: 404, json: {} });
      }
      return route.abort();
    });
    await page.goto('http://localhost/imessage/?intake=custom');
    await page.fill('#text', "Yes, that's it");
    await page.click('#send');
    await page.waitForSelector(`text=${ack.slice(0, 40)}`);
    await page.waitForTimeout(800);
    // through several polls of a running job: no typing indicator at any moment
    for (let i = 0; i < 10; i++) { assert.equal(await page.locator('.bubble.typing').count(), 0, `typing shown during the job (check ${i})`); if (polls >= 3) break; await page.waitForTimeout(1500); }
    await page.waitForSelector('text=Here\'s a preview of a new site', { timeout: 20000 });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.bubble.typing').count(), 0, 'no typing indicator after the link');
    assert.equal(await page.locator('.bubble.link').count(), 1, 'one preview card: the link, after it was sent');
    const overflow = await page.evaluate(() => { const l = document.querySelector('.log')!; return l.scrollWidth > l.clientWidth + 1; });
    assert.equal(overflow, false, 'no sideways scroll inside the conversation');
    const wrap = await page.evaluate(() => Array.from(document.querySelectorAll('#suggest button')).every((b) => b.getBoundingClientRect().right <= document.querySelector('#suggest')!.getBoundingClientRect().right + 1));
    assert.ok(wrap, 'the quick replies fit the phone width');
  } finally { await browser.close(); }
});

// ── a business name and a street address in separate messages (synthetic businesses; the shape of the saved beta run
// where "645 Imperial block 1" at 472 … was offered for a business at 63 S Imperial Block) ──
const ADDRESS = '63 S Imperial Block, Paragon City, Lahore, 54000, Pakistan';
const P = (placeId: string, name: string, address: string, types: string[], website?: string): BusinessCandidate => ({ placeId, name, address, types, website });
const PHARMACY = P('pPharm63', 'Crescent Pharmacy', ADDRESS, ['pharmacy'], 'https://crescent-pharmacy.example/');
const PLOT_645 = P('pPlot645', '645 Imperial block 1', '472 Paragon City Main Blvd, Paragon City, Lahore, Pakistan', ['association_or_organization']);
const IMPERIAL_2 = P('pImp2', 'Imperial-2', '594 Street 19, imperial 2 Paragon City, Lahore, Pakistan', ['association_or_organization']);
const MALL = P('pMall', 'Imperial Mall', 'Imperial Main Blvd, Imperial Garden Homes Paragon City, Lahore, Pakistan', ['shopping_mall']);
const BAKERS_63 = P('pBake63', 'Imperial Bakers', '63 S Imperial Block, Paragon City, Lahore, 54000, Pakistan', ['bakery']);
const PHARMACY_12 = P('pPharm12', 'Crescent Pharmacy', '12 Main Blvd, Imperial Block, Paragon City, Lahore, Pakistan', ['pharmacy']);
/** what Google returned in the saved run: the address-named listing first, the business itself further down */
const SAVED_RUN = [PLOT_645, PHARMACY, IMPERIAL_2, MALL];
const sessionOf = async (from: string) => ((await getConversation(from)) as unknown as { session?: { state: string; custom?: unknown; candidates: BusinessCandidate[]; idx: number } })?.session;

test('63 versus 472: an address-named listing at another street number is never a match, for the name or for the street', async () => {
  // the saved run's lookup took the street as the business name; the listing passed on "imperial" and "block"
  assert.equal(credibleListing(PLOT_645, '63 S imperial block', 'Paragon City, Lahore, 54000'), false, 'the street is not a business name');
  assert.equal(credibleListing(PLOT_645, 'Crescent Pharmacy', ADDRESS), false);
  assert.equal(addressNamed(PLOT_645, ADDRESS), true, 'a house number and the words of the address');
  assert.equal(addressAgrees(PLOT_645, parseBusinessInput({ name: 'Crescent Pharmacy', address: ADDRESS })), false, 'street number 472 is not 63');
  assert.equal(credibleListing(PHARMACY, 'Crescent Pharmacy', ADDRESS), true);
  assert.equal(credibleListing(PHARMACY_12, 'Crescent Pharmacy', ADDRESS), false, 'the same name at 12 Main Blvd');
  assert.equal(credibleListing(BAKERS_63, 'Crescent Pharmacy', ADDRESS), false, 'another business at the same address');
  for (const name of ['21 Bistro', '7-Eleven', '99 Ranch Market']) assert.equal(addressNamed({ name, address: '21 Main St, Austin, TX 78701' }), false, name);
  assert.equal(looksLikeAddress(ADDRESS), true);
  assert.equal(looksLikeAddress('Crescent Pharmacy'), false);
  assert.equal(looksLikeAddress('Shop 4, Imperial Block'), true);
  assert.deepEqual(await splitBusiness(`Crescent Pharmacy, ${ADDRESS}`), { name: 'Crescent Pharmacy', location: ADDRESS });
});

test('a name, then its street address: one lookup for both; only the business at that address is offered, and nothing is checked before the yes', async () => {
  const from = convo();
  google = () => SAVED_RUN;
  try {
    await say(from, 'Hi Roger');
    // the name alone: the one listing with that name, to tap (the address-named and other nearby listings are not on it)
    const pick = await say(from, 'Crescent Pharmacy');
    assert.match(texts(pick), /^I found this listing on Google\. Is it yours\?\nCrescent Pharmacy\n63 S Imperial Block/);
    assert.doesNotMatch(texts(pick), /645|Imperial-2|Imperial Mall/);
    // the customer sends the address instead of tapping: looked up with the name
    const n = asked.length, checks = siteChecks.length;
    const r = await say(from, ADDRESS);
    assert.deepEqual(asked.slice(n), [{ name: 'Crescent Pharmacy', address: ADDRESS }], 'one lookup: the name kept, the address added');
    assert.match(texts(r), /^Is this your business\?\nCrescent Pharmacy\n63 S Imperial Block, Paragon City, Lahore, 54000, Pakistan · Photo: A\. Photographer, Google$/m);
    // the card shows the listing's own Google photo, live (never stored), credited to its author
    assert.match(cardsOf(r)[0].image ?? '', /\/gphoto\/cover\/pPharm63\?w=800$/);
    assert.doesNotMatch(texts(r), /645|472|Imperial-2|Imperial Mall|I found \d listings/);
    assert.equal(siteChecks.length, checks, 'no website check before the listing is confirmed');
    assert.deepEqual((await sessionOf(from))?.candidates.map((c) => c.placeId), [PHARMACY.placeId]);
  } finally { google = undefined; }
});

test('several nearby businesses (the same name at another address, another business at the same address, address-named listings): only the match is offered', async () => {
  const from = convo();
  google = () => [PHARMACY_12, PLOT_645, MALL, BAKERS_63, IMPERIAL_2, PHARMACY];
  try {
    await say(from, 'Hi');
    const r = await say(from, `Crescent Pharmacy, ${ADDRESS}`);
    assert.match(texts(r), /^Is this your business\?\nCrescent Pharmacy\n63 S Imperial Block/m);
    assert.doesNotMatch(texts(r), /12 Main Blvd|Imperial Bakers|645|I found \d listings/);
    // not this one: no nearby listing is offered in its place
    const no = await say(from, 'No, not this one');
    assert.match(texts(no), /^Sorry about that\. Send me the Google Maps link to your listing/);
    assert.doesNotMatch(texts(no), /Is this your business/);
  } finally { google = undefined; }
});

test('an address alone is never the business: Roger asks for the name, then looks up the two together', async () => {
  const from = convo();
  google = () => SAVED_RUN;
  try {
    await say(from, 'Hi');
    const n = asked.length;
    const a = await say(from, ADDRESS);
    assert.match(texts(a), /^Thanks, that's the address\. What's the business called\?/);
    assert.equal(asked.length, n, 'no listing is looked up, or offered, for an address alone');
    assert.match(texts(await say(from, "Yes, that's it")), /^I don't have a listing for you to confirm yet/);
    const b = await say(from, 'Crescent Pharmacy');
    assert.deepEqual(asked.slice(n), [{ name: 'Crescent Pharmacy', address: ADDRESS }]);
    assert.match(texts(b), /^Is this your business\?\nCrescent Pharmacy\n63 S Imperial Block/m);
  } finally { google = undefined; }
});

test('no listing passes: Roger asks for the Maps link or a correction, and "Yes, that\'s it" then starts nothing', async () => {
  const from = convo();
  // Google ranks only the address-named listing, nearby places and the same name at another street number
  google = () => [PLOT_645, IMPERIAL_2, MALL, PHARMACY_12];
  const before = { ...starts }, checks = siteChecks.length;
  try {
    await say(from, 'Hi Roger');
    await say(from, 'Crescent Pharmacy');
    const r = await say(from, ADDRESS);
    assert.match(texts(r), /^I couldn't find Crescent Pharmacy at 63 S Imperial Block, Paragon City, Lahore, 54000, Pakistan on Google\. The listings I found with that name are at other addresses\. Where is your business\? Send the Google Maps link to your listing, or the correct address/);
    assert.doesNotMatch(texts(r), /Is this your business|645|472/);
    // the quick reply from an earlier offer, or a customer saying yes anyway: nothing is confirmed or started
    const yes = await say(from, "Yes, that's it");
    assert.match(texts(yes), /^I don't have a listing for you to confirm yet\. Send me the Google Maps link to Crescent Pharmacy's listing/);
    assert.deepEqual(starts, before, 'no research and no generation');
    assert.equal(siteChecks.length, checks, 'no website check');
    const s = await sessionOf(from);
    assert.equal(s?.custom, undefined, 'no run'); assert.notEqual(s?.state, 'confirm');
    // no listing with the name at all: the name or the address may be corrected
    google = () => [PLOT_645, IMPERIAL_2, MALL];
    const other = convo();
    await say(other, 'Hi');
    assert.match(texts(await say(other, `Crescent Pharmacy, ${ADDRESS}`)), /^I couldn't find Crescent Pharmacy at 63 S Imperial Block.* Could you send me the Google Maps link to your listing, or correct the name or address/);
    // a corrected name keeps the address it was given with
    google = () => SAVED_RUN;
    const n = asked.length;
    assert.match(texts(await say(other, 'Crescent Pharmacy')), /^Is this your business\?\nCrescent Pharmacy\n63 S Imperial Block/m);
    assert.deepEqual(asked.slice(n), [{ name: 'Crescent Pharmacy', address: ADDRESS }]);
  } finally { google = undefined; }
});

test('a wrong listing on offer, then "Yes, that\'s it": the listing is not confirmed and nothing starts', async () => {
  // the saved beta conversation's state at the offer (saved before this fix): the street taken as the name, and the
  // address-named listing at 472 on offer for a business at 63
  const from = convo();
  const now = new Date().toISOString();
  await saveConversation({ from, startedAt: now, updatedAt: now, buildIds: [], messages: [], session: { state: 'confirm', candidates: [PLOT_645], idx: 0, query: '63 S imperial block', location: 'Paragon City, Lahore, 54000' } } as never);
  const before = { ...starts }, checks = siteChecks.length;
  const yes = await say(from, "Yes, that's it");
  assert.match(texts(yes), /^Sorry, I can't confirm that listing is your business: it doesn't match the name and address you sent\. Please send me the Google Maps link to your listing/);
  assert.doesNotMatch(texts(yes), /researching|building/);
  assert.deepEqual(starts, before, 'no research and no generation');
  assert.equal(siteChecks.length, checks, 'no website check');
  const s = await sessionOf(from);
  assert.equal(s?.custom, undefined, 'no run'); assert.equal(s?.state, 'need-business');
  // and a second "yes" confirms nothing either
  assert.match(texts(await say(from, "Yes, that's it")), /^I don't have a listing for you to confirm yet/);
  assert.deepEqual(starts, before);
  // the same session with the business's own listing on offer: the yes is accepted
  const ok = convo();
  await saveConversation({ from: ok, startedAt: now, updatedAt: now, buildIds: [], messages: [], session: { state: 'confirm', candidates: [PHARMACY], idx: 0, query: 'Crescent Pharmacy', location: ADDRESS } } as never);
  assert.match(texts(await say(ok, "Yes, that's it")), /Thanks! I'm researching your business/);
  assert.equal(starts.research, before.research + 1);
});

test('the website is checked once the listing is confirmed: a site that does not check out is not used, and the customer is told', async () => {
  const from = convo();
  await say(from, 'Hi');
  await say(from, 'Corner Cafe, Hartland WI');
  const checks = siteChecks.length, research = starts.research;
  const yes = await say(from, "Yes, that's it");
  assert.deepEqual(siteChecks.slice(checks), ['https://some-directory.example/corner-cafe']);
  assert.match(texts(yes), /^I couldn't confirm that some-directory\.example is Corner Cafe's website, so I'll build from your Google listing\.\nThanks! I'm researching your business/);
  assert.equal(starts.research, research + 1);
});

test('the right name in the right town with another postal code: Roger says which code the listing has, and a reply with it finds the listing', async () => {
  const from = convo();
  google = () => [PHARMACY, PLOT_645];
  const before = { ...starts };
  try {
    await say(from, 'Hi');
    await say(from, 'Crescent Pharmacy');
    const r = await say(from, 'Lahore, Pakistan 56400');
    assert.match(texts(r), /^I found Crescent Pharmacy on Google, but its listing has the postal code 54000, not 56400\. If 54000 is right, reply "54000"\./);
    assert.doesNotMatch(texts(r), /Is this your business/, 'not offered until the code is corrected');
    const n = asked.length;
    const ok = await say(from, '54000');
    assert.deepEqual(asked.slice(n), [{ name: 'Crescent Pharmacy', address: 'Lahore, Pakistan 54000' }], 'the code is corrected in the location given');
    assert.match(texts(ok), /^Is this your business\?\nCrescent Pharmacy\n63 S Imperial Block/m);
    assert.deepEqual(starts, before);
  } finally { google = undefined; }
});

test('a name alone: up to three listings with a similar name, closest first, never an address-named or unrelated one; the tap starts the preview', async () => {
  const BRANCHES = [
    P('pB1', 'Crescent Pharmacy - Model Town', '1 C Block, Model Town, Lahore, 54700, Pakistan', ['pharmacy'], 'https://crescent-pharmacy.example/'),
    PLOT_645, MALL,
    P('pB2', 'Crescent Pharmacy', '12 Zanjani Rd, Main Market, Lahore, 54000, Pakistan', ['pharmacy']),
    P('pB3', 'Crescent Pharmacy - Johar Town', '6 R3, Block N, Lahore, Pakistan', ['pharmacy']),
    P('pB4', 'Crescent Pharmacy - Cantt', 'Sarwar Colony, Lahore, Pakistan', ['pharmacy']),
    P('pB5', 'Crescent Opticians', '9 Mall Rd, Lahore, Pakistan', ['optician']),
  ];
  google = () => BRANCHES;
  const before = { ...starts };
  try {
    const from = convo();
    await say(from, 'Hi');
    const n = asked.length;
    const list = await say(from, 'Crescent Pharmacy');
    assert.deepEqual(asked.slice(n), [{ name: 'Crescent Pharmacy' }], 'one lookup for the name');
    assert.equal(list.length, 5, 'the question, three listing cards, and how to choose');
    assert.match(list[0].text, /^I found 3 listings on Google for Crescent Pharmacy\. Which one is yours\?$/);
    const cards = cardsOf(list);
    assert.deepEqual(cards.map((r) => r.title), ['1. Crescent Pharmacy', '2. Crescent Pharmacy - Model Town', '3. Crescent Pharmacy - Johar Town'], 'the exact name first, then Google\'s order');
    assert.deepEqual(cards.map((r) => r.choice), ['1. Crescent Pharmacy', '2. Crescent Pharmacy - Model…', '3. Crescent Pharmacy - Johar…'], 'each card chooses itself (the same reply as its button)');
    assert.deepEqual(cards.map((r) => r.subtitle), ['12 Zanjani Rd, Main Market, Lahore, 54000, Pakistan', '1 C Block, Model Town, Lahore, 54700, Pakistan · Photo: A. Photographer, Google', '6 R3, Block N, Lahore, Pakistan']);
    assert.deepEqual(cards.map((r) => r.image), ['https://cards.example/pB2/card.jpg', 'http://localhost:4000/gphoto/cover/pB1?w=800', 'https://cards.example/pB3/card.jpg'], 'a Google photo when the listing has one, otherwise the card image');
    assert.doesNotMatch(texts(list), /645|Imperial Mall|Opticians|Cantt/);
    assert.deepEqual(list.at(-1)?.quickReplies, ['1. Crescent Pharmacy', '2. Crescent Pharmacy - Model…', '3. Crescent Pharmacy - Johar…', 'None of these']);
    assert.deepEqual(starts, before, 'nothing starts before the customer chooses');
    // the tap: the website is checked for that listing, and research starts for it
    const checks = siteChecks.length;
    const tap = await say(from, '2. Crescent Pharmacy - Model…');
    assert.match(texts(tap), /Thanks! I'm researching your business/);
    assert.deepEqual(siteChecks.slice(checks), ['https://crescent-pharmacy.example/']);
    assert.equal(starts.research, before.research + 1);
    const ses = await sessionOf(from) as unknown as { chosen?: BusinessCandidate };
    assert.equal(ses?.chosen?.placeId, 'pB1');
    // a typed number works too; "None of these" asks where, and nothing starts
    const other = convo();
    await say(other, 'Hi');
    await say(other, 'Crescent Pharmacy');
    const none = await say(other, 'None of these');
    assert.match(texts(none), /^No problem\. Where is Crescent Pharmacy\? Send the address, or the city and ZIP code, or the Google Maps link/);
    assert.equal(starts.research, before.research + 1);
    const third = convo();
    await say(third, 'Hi');
    await say(third, 'Crescent Pharmacy');
    await say(third, '3');
    assert.equal(((await sessionOf(third)) as unknown as { chosen?: BusinessCandidate })?.chosen?.placeId, 'pB3');
  } finally { google = undefined; }
});

test('a name alone with no listing like it: Roger asks where it is (nothing unrelated is offered)', async () => {
  google = () => [PLOT_645, MALL, IMPERIAL_2];
  try {
    const from = convo();
    await say(from, 'Hi');
    assert.match(texts(await say(from, 'Crescent Pharmacy')), /^Thanks! Where is Crescent Pharmacy\? Send the city and state, or the ZIP code/);
  } finally { google = undefined; }
});
