import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-frontend-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
const { checkCode, compilePage, FRONTEND_PROMPT } = await import('../src/studio/frontend/page.js');
const { generateFrontend, startFrontendJob, waitFrontendJob, getFrontendJob } = await import('../src/studio/frontend/jobs.js');
const { CostLedger } = await import('../src/studio/concepts/ai.js');
const { studioDocs } = await import('../src/store.js');
const { screenshotsAvailable } = await import('../src/render/og.js');
import type { FrontendCode, FrontendInput } from '../src/studio/frontend/page.js';
import type { AiTransport, AiRequest } from '../src/studio/concepts/ai.js';
const input: FrontendInput = {
  business: { name: 'Example Studio', category: 'Studio', website: null, summary: null }, colours: ['#134531'],
  facts: { name: 'Example Studio', address: 'Example Road', hours: 'Monday: 9–5', rating: '4.6★ from 22 reviews' },
  actions: [{ id: 'directions', factId: 'address', kind: 'directions', label: 'Directions', href: 'https://example.com/maps' }],
  photos: [{ id: 'p1', url: 'https://example.com/photo.jpg', width: 1200, height: 800, orientation: 'landscape', uses: [], alt: 'Studio entrance', seen: 'Studio entrance', services: [] }],
  ownLines: [], services: [], items: [], story: null, notes: [],
};
const good = (): FrontendCode => ({ idea: 'An editorial cover with an inset image and compact visiting information.', fonts: ['DM Sans', 'Bodoni Moda'],
  html: '<header><span data-fact="name"></span><a href="#visit">Visit</a></header><main><section class="cover"><h1>Make room for something new.</h1><figure><img data-photo="p1"></figure><p>A welcoming place to begin. Come and meet the studio.</p></section><aside id="visit"><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="directions">Find us</a></aside></main><footer>See you soon.</footer>',
  css: '/* Free composition, no section enums. */ .cover{display:grid;grid-template-columns:2fr 3fr;isolation:isolate}.cover h1{grid-area:1/1/2/3;z-index:2;transform:rotate(-2deg)}img{max-width:100%;height:auto}@media(max-width:600px){.cover{display:block}}',
});
function fake(answers: unknown[]) {
  const requests: AiRequest[] = [];
  const transport: AiTransport = { via: 'fake', model: 'claude-sonnet-5-5', async call(req) {
    requests.push(req); return { data: answers[Math.min(requests.length - 1, answers.length - 1)], usage: { via: 'fake', model: 'claude-sonnet-5-5', inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, costBasis: 'reported' } };
  } };
  return { transport, requests };
}

test('free composition and fresh prose work without DesignSpec enums or a brand font list', () => {
  assert.deepEqual(checkCode(good(), input), []);
  const html = compilePage(good(), input);
  assert.match(html, /transform:rotate\(-2deg\)/);
  assert.match(html, /Bodoni%20Moda/);
  assert.match(html, /Monday: 9–5/);
  assert.match(html, /href="https:\/\/example.com\/maps"/);
  assert.match(html, /alt="Studio entrance"/);
  assert.match(html, /noindex,nofollow/);
  assert.match(FRONTEND_PROMPT, /There is no DesignSpec/);
  const second = good(); second.css = 'main{display:flex;flex-direction:column-reverse}figure{border-radius:50%;overflow:hidden}';
  assert.deepEqual(checkCode(second, input), [], 'a different composition is not restricted to a catalogue');
});

test('unknown content references, missing facts and invented destinations are refused', () => {
  const unknown = good(); unknown.html = unknown.html.replace('data-photo="p1"', 'data-photo="invented"');
  assert.match(checkCode(unknown, input).join(' '), /Unknown photo/);
  const missing = good(); missing.html = missing.html.replace('<p data-fact="hours"></p>', '');
  assert.match(checkCode(missing, input).join(' '), /Include verified hours/);
  const bad = good(); bad.html += '<a href="https://invented.example/book">Book</a>';
  assert.match(checkCode(bad, input).join(' '), /Unresolved link/);
  const claim = good(); claim.html += '<p>Guaranteed results in 7 days.</p>';
  assert.match(checkCode(claim, input).join(' '), /unsupported factual marketing claims/);
});

test('scripts, event handlers, injected CSS requests and escaping style are refused', () => {
  for (const addition of ['<script>alert(1)</script>', '<img data-photo="p1" onerror="alert(1)">', '<iframe src="https://evil.example"></iframe>']) {
    const code = good(); code.html += addition; assert.ok(checkCode(code, input).length, addition);
  }
  for (const css of ['a{background:url(https://evil.example)}', '@im/**/port "https://evil.example";', '/* </style><script>x</script> */', 'a{background:u\\72l(https://evil.example)}']) {
    const code = good(); code.css = css; assert.ok(checkCode(code, input).length, css);
  }
});

test('the code call uses ordinary JSON, one repair maximum, and never a legacy renderer', async () => {
  const bad = good(); bad.html = '<main><h1>Missing the source bindings</h1></main>';
  const f = fake([bad, good()]);
  const result = await generateFrontend(input, 'repair-case', new CostLedger(2, 'fe_repair'), f.transport);
  assert.ok(result.data); assert.equal(result.attempts, 2); assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((r) => r.output === 'json' && r.stage.startsWith('frontend:')));
  const fail = fake([bad]);
  const failed = await generateFrontend(input, 'failure-case', new CostLedger(2, 'fe_failure'), fail.transport);
  assert.equal(failed.data, null); assert.equal(failed.attempts, 2); assert.equal(fail.requests.length, 2);
});

test('a saved job exposes a draft only after validation; polling makes no AI calls', async () => {
  await studioDocs.put('studio-concept-jobs', 'cj_synthetic', { id: 'cj_synthetic', status: 'done', input: { businessKey: 'synthetic', revision: 1 } });
  const f = fake([homeWithNav(), visitSite()]);
  const job = await startFrontendJob('cj_synthetic', 'saved-job', { input, transport: f.transport });
  const finished = await waitFrontendJob(job.id);
  assert.equal(finished?.status, 'needs-review'); assert.equal(finished?.checks.publication, 'disabled');
  // the standard rendered-page review runs on every finished version (pending only where no browser exists); the preview
  // goes to the customer automatically only when it passed
  assert.notEqual(finished?.checks.browser, screenshotsAvailable() ? 'pending' : 'never');
  assert.equal(finished?.delivery?.auto, finished?.checks.browser === 'passed');
  assert.equal(finished?.costUsd, 0.02, 'two calls: the homepage, then its inner pages');
  assert.match(finished?.previewUrl || '', /\/api\/studio\/frontend-jobs\/fe_.*\/preview/);
  await getFrontendJob(job.id); await getFrontendJob(job.id); assert.equal(f.requests.length, 2);
  const bad = good(); bad.html = '<h1>Missing main</h1>';
  const failedJob = await startFrontendJob('cj_synthetic', 'saved-failure', { input, transport: fake([bad]).transport });
  const failed = await waitFrontendJob(failedJob.id);
  assert.equal(failed?.status, 'failed'); assert.equal(failed?.previewUrl, undefined); assert.equal(failed?.code, undefined);
});

test('new frontend collection is included in the central persistence guard', async () => {
  const marker = 'places/ChIJSyntheticPlace/photos/not-a-real-photo-resource';
  await studioDocs.put('studio-frontend-jobs', 'fe_storage', { instruction: marker, nested: { photo: marker } });
  const stored = await studioDocs.get('studio-frontend-jobs', 'fe_storage');
  assert.ok(!JSON.stringify(stored).includes(marker));
});

test('a verified logo is preserved and executable asset destinations cannot be compiled', () => {
  const branded = { ...input, logo: { url: 'https://example.com/logo.png', width: 200, height: 80 } };
  assert.match(checkCode(good(), branded).join(' '), /Preserve the verified logo/);
  const code = good(); code.html = code.html.replace('<header>', '<header><img data-logo="brand">');
  assert.match(compilePage(code, branded), /src="https:\/\/example.com\/logo.png"/);
  assert.throws(() => compilePage(good(), { ...input, photos: [{ ...input.photos[0], url: 'javascript:alert(1)' }] }), /secure source/);
  assert.throws(() => compilePage(good(), { ...input, actions: [{ ...input.actions[0], href: 'javascript:alert(1)' }] }), /Invalid action/);
});

test('a new Google business starts from its brief without generating an old concept; checked photos are reusable', async () => {
  const sharp = (await import('sharp')).default;
  const { photoFingerprint } = await import('../src/design/fingerprint.js');
  const { frontendInputFromBrief } = await import('../src/studio/frontend/jobs.js');
  const pixels = Buffer.alloc(256 * 256 * 3);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const offset = (y * 256 + x) * 3;
    pixels[offset] = (x * 7 + y * 19) % 255;
    pixels[offset + 1] = (x * 13 + y * 3) % 255;
    pixels[offset + 2] = (x * 5 + y * 11) % 255;
  }
  const fp = await photoFingerprint(await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).jpeg().toBuffer());
  const businessKey = 'synthetic-profile', revision = 4;
  const brief = { businessKey, revision, briefHash: 'synthetic-hash', identity: { status: 'verified' }, brand: { logo: { status: 'unknown', value: null }, colors: [] } } as never;
  const catalog = () => ({ ...input, business: { name: 'Independent Gym', category: 'Fitness', website: null, summary: null },
    brief: { businessKey, revision, briefHash: 'synthetic-hash' }, phone: null, email: null, address: { id: 'address', formatted: '10 Oak Road' },
    hours: ['Monday: 9 AM – 5 PM'], rating: null, ownLines: [], services: [], items: [], story: null,
    photos: [{ ...input.photos[0], id: 'google-1', url: 'google-listing:ChIJSyntheticPlace#0', alt: 'Photo of the business from Google Maps', seen: undefined, fp: undefined }],
    actions: input.actions, }) as never;
  let judged = 0;
  const deps = { load: async () => ({ brief, inventory: {} as never }), catalog,
    judge: async () => { judged++; return { items: [{ n: 0, width: 1200, height: 800, kind: 'work', seen: 'Training room with equipment', fp, eligible: true }], labelled: 'fake' as const }; },
    observe: async (photos: { fp?: string }[]) => { photos[0].fp = fp; } } as never;
  const first = await frontendInputFromBrief(businessKey, revision, deps);
  assert.equal(judged, 1); assert.equal(first.photos[0].seen, 'Training room with equipment');
  assert.equal(first.facts.address, '10 Oak Road');
  await studioDocs.put('studio-frontend-jobs', 'fe_prior', { id: 'fe_prior', businessKey, revision, createdAt: '2026-01-01', input: first });
  const second = await frontendInputFromBrief(businessKey, revision, deps);
  assert.equal(judged, 1, 'the second run reuses the checked fingerprint and description');
  assert.equal(second.photos[0].seen, 'Training room with equipment');
});

test('scroll-behavior and overscroll-behavior are ordinary CSS; the old behavior: property is still refused', () => {
  const withCss = (css: string) => { const code = good(); code.css += css; return checkCode(code, input).filter((e) => e.startsWith('CSS')); };
  for (const ok of ['html{scroll-behavior:smooth}', 'main{overscroll-behavior:contain}', '.x{overscroll-behavior-y : none;scroll-behavior: auto}', '@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}'])
    assert.deepEqual(withCss(ok), [], ok);
  for (const bad of ['a{behavior:url(x.htc)}', 'a{color:red;behavior :x}', 'a{\n  behavior: x}', 'a{beh\\61vior:x}'])
    assert.match(withCss(bad).join(' '), /found "(\{|;)?behavior\s*:"|found "url\("/, bad);
});

test('a Google listing photo may not sit inside a link: its credit carries links, and links cannot nest', () => {
  const listingInput = { ...input, photos: [{ ...input.photos[0], id: 'g1', url: 'google-listing:ChIJsynthetic0001#2', fp: 'dce80cc99264c9b1b9c61d7982246858-595a49' }] };
  const card = good(); card.html = card.html.replace(/<figure><img data-photo="p1"><\/figure>/, '<a class="stage" href="#visit"><figure><img data-photo="g1"></figure><span>Free weights</span></a>');
  const errs = checkCode(card, listingInput).join(' ');
  assert.match(errs, /Photo g1 is a Google listing photo inside a link \(<a>\).*Move the img out of the <a>/);
  // the same card with the link beside the photo passes
  const fixed = good(); fixed.html = fixed.html.replace(/<figure><img data-photo="p1"><\/figure>/, '<div class="stage"><figure><img data-photo="g1"></figure><a href="#visit">Free weights</a></div>');
  assert.ok(!/inside a link/.test(checkCode(fixed, listingInput).join(' ')));
  // a website photo (no credit links) may still be a linked image
  const site = good(); site.html = site.html.replace(/<figure><img data-photo="p1"><\/figure>/, '<a href="#visit"><img data-photo="p1"></a>');
  assert.ok(!/inside a link/.test(checkCode(site, input).join(' ')));
});

// ── the custom full site ──
/** the homepage with its navigation to the site's pages (here: home and visit) */
const nav = '<nav><a data-page="home">Home</a><a data-page="visit">Visit</a></nav>';
const homeWithNav = (): FrontendCode => { const c = good(); c.html = c.html.replace('<header><span data-fact="name"></span>', `<header><span data-fact="name"></span>${nav}`); return c; };
const visitHtml = (main = '<h1>Find the studio</h1><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="directions">Directions</a>') => `<header><span data-fact="name"></span>${nav}</header><main>${main}</main><footer>See you soon.</footer>`;
const visitSite = (html = visitHtml()) => ({ css: '.visit-card{display:grid;gap:1rem}', pages: [{ slug: 'visit', html }] });
const { planPages, checkSite, compileSite } = await import('../src/studio/frontend/site.js');
const { editedVersion, versionText, frontendPreview, sameRecentJob } = await import('../src/studio/frontend/jobs.js');

test('the pages come from the business content: offerings, its own story, its photos, and how to visit', () => {
  assert.deepEqual(planPages(input).map((p) => p.slug), ['visit'], 'nothing else is sourced: no menu, about or photo page');
  const rich = { ...input, facts: { ...input.facts, story: 'We opened in a converted garage.', 'item-a': 'Cake', 'item-b': 'Pie', 'item-c': 'Tart', 'item-d': 'Bun' }, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as never,
    photos: Array.from({ length: 7 }, (_, i) => ({ ...input.photos[0], id: `p${i + 1}` })) };
  const plan = planPages(rich);
  assert.deepEqual(plan.map((p) => [p.slug, p.title]), [['menu', 'Menu'], ['about', 'About'], ['photos', 'Photos'], ['visit', 'Visit']]);
  assert.deepEqual(plan[0].required, ['name', 'item-a', 'item-b', 'item-c', 'item-d'], 'the menu page shows every offering');
  assert.equal(plan[2].minPhotos, 7);
  assert.deepEqual(plan[3].required, ['name', 'address', 'hours', 'rating']);
});

test('every page is checked: its facts, its photos, navigation to every page, and a Google photo never inside a link', () => {
  const plan = planPages(input);
  assert.deepEqual(checkCode(homeWithNav(), input, { pages: plan }), []);
  assert.match(checkCode(good(), input, { pages: plan }).join(' '), /Link the home page in the navigation/, 'the homepage without its navigation');
  assert.deepEqual(checkSite(visitSite(), homeWithNav(), input, plan), []);
  const noHours = visitSite(visitHtml('<h1>Find the studio</h1><p data-fact="address"></p><p data-fact="rating"></p><a data-action="directions">Go</a>'));
  assert.match(checkSite(noHours, homeWithNav(), input, plan).join(' '), /visit page: Include verified hours using data-fact on the visit page/);
  const stray = visitSite(visitHtml().replace('<a data-page="visit">Visit</a>', '<a data-page="gallery">Gallery</a>'));
  assert.match(checkSite(stray, homeWithNav(), input, plan).join(' '), /visit page: Unknown page link "gallery".*Link the visit page in the navigation/);
  assert.match(checkSite({ css: 'a{background:url(x)}', pages: [{ slug: 'visit', html: visitHtml() }] }, homeWithNav(), input, plan).join(' '), /found "url\("/);
  assert.match(checkSite({ css: '', pages: [] }, homeWithNav(), input, plan).join(' '), /Return exactly these pages, in this order: visit/);
  assert.match(checkSite({ css: '', pages: [{ slug: 'visit', html: visitHtml('<h1>Find us</h1><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><a data-action="directions">Go</a><p>Open since 1998.</p>') }] }, homeWithNav(), input, plan).join(' '), /visit page: Keep numbers/);
});

test('a full site: homepage then pages, one visual language, links to this version, no legacy renderer', async () => {
  const f = fake([{ ...homeWithNav(), idea: 'A full-site test homepage (its own idea, so no cached answer is reused).' }, visitSite()]);
  const job = await startFrontendJob({ businessKey: 'synthetic-site', revision: 1 }, 'full-site', { input, transport: f.transport });
  const done = (await waitFrontendJob(job.id))!;
  assert.equal(done.status, 'needs-review');
  assert.deepEqual(done.pages?.map((p) => p.slug), ['visit']);
  assert.equal(f.requests[1].stage, 'frontend:pages-v1');
  assert.match(f.requests[1].prompt, /The homepage's CSS \(reuse its classes/);
  assert.match(f.requests[0].prompt, /Site pages \(the header navigation links each/);
  const home = await frontendPreview(done), visit = await frontendPreview(done, 'visit');
  assert.match(home, new RegExp(`<a data-page="visit" href="/api/studio/frontend-jobs/${done.id}/preview/visit"`));
  assert.match(visit, new RegExp(`<a data-page="home" href="/api/studio/frontend-jobs/${done.id}/preview"`));
  assert.match(visit, /transform:rotate\(-2deg\)[\s\S]*\.visit-card\{display:grid/, 'the homepage CSS, then the pages\' own');
  assert.match(visit, new RegExp(`<meta name="roger-version" content="${done.id}">`));
  assert.match(visit, /<title>Example Studio — Visit — Design preview<\/title>/);
  assert.ok(!/DesignSpec|theme-|data-variant/.test(home + visit));
  await assert.rejects(frontendPreview(done, 'gallery'), /No such page/);
  // the inner pages fail: the site fails with the reason, no preview, the homepage kept for inspection, no fallback
  const bad = fake([{ ...homeWithNav(), idea: 'A homepage whose pages will fail (its own idea, so no cached answer is reused).' }, visitSite(visitHtml('<h2>no main heading</h2>'))]);
  const failed = (await waitFrontendJob((await startFrontendJob({ businessKey: 'synthetic-site', revision: 1 }, 'pages-fail', { input, transport: bad.transport })).id))!;
  assert.equal(failed.status, 'failed');
  assert.match(failed.error!, /^Custom inner pages failed after 2 attempts: visit page: Include one main and exactly one h1/);
  assert.equal(failed.previewUrl, undefined);
  assert.ok(failed.code, 'the homepage is kept');
  assert.equal(bad.requests.length, 3, 'homepage once, pages twice (one repair), nothing else');
});

test('owner edits make a new version: the version edited never changes, and edits keep the copy rules', async () => {
  const done = (await waitFrontendJob((await startFrontendJob({ businessKey: 'synthetic-edit', revision: 1 }, 'edit', { input, transport: fake([homeWithNav(), visitSite()]).transport })).id))!;
  const text = versionText(done);
  assert.deepEqual(text.home.map((t) => t.key), text.home.map((_, i) => `home-${i + 1}`), 'keys in page order');
  assert.ok(text.visit.some((t) => t.text === 'Find the studio'));
  const h1 = text.home.find((t) => t.text === 'Make room for something new.')!;
  const v2 = await editedVersion(done.id, { [h1.key]: 'Room to make something.' });
  assert.equal(v2.version?.parentId, done.id);
  assert.equal(v2.version!.n, done.version!.n + 1);
  assert.equal(v2.costUsd, 0);
  assert.match(await frontendPreview(v2), /Room to make something\./);
  assert.match(await frontendPreview(done), /Make room for something new\./, 'the earlier version is unchanged');
  assert.match(await frontendPreview(v2), new RegExp(`/api/studio/frontend-jobs/${v2.id}/preview/visit`), 'its links stay within its own version');
  await assert.rejects(editedVersion(done.id, { [h1.key]: 'Open since 1998!' }), /Keep numbers/);
  await assert.rejects(editedVersion(done.id, { 'home-999': 'x' }), /Unknown edit key/);
  await assert.rejects(editedVersion(done.id, { [h1.key]: '<b>x</b>' }), /plain text/);
  // compiled from the same saved code: the bound facts are untouched by an edit
  assert.match(await frontendPreview(v2), /<p data-fact="address">Example Road<\/p>/);
});

test('a repeated start returns the job under way or just finished; another version is explicit', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const slow: AiTransport = { via: 'fake', model: 'claude-sonnet-5-5', async call(req, limits) { await gate; return fake([homeWithNav(), visitSite()]).transport.call(req, limits); } };
  const first = await startFrontendJob({ businessKey: 'synthetic-repeat', revision: 1 }, '', { input, transport: slow });
  const again = await startFrontendJob({ businessKey: 'synthetic-repeat', revision: 1 }, '', { input, transport: slow });
  assert.equal(again.id, first.id); assert.equal(again.reused, true);
  release(); await waitFrontendJob(first.id);
  const after = await startFrontendJob({ businessKey: 'synthetic-repeat', revision: 1 }, '', { input, transport: slow });
  assert.equal(after.id, first.id, 'finished moments ago: returned, not paid for again');
  assert.equal((await sameRecentJob('synthetic-repeat', 1, 'a different direction')), undefined, 'a different direction is a different request');
  const another = await startFrontendJob({ businessKey: 'synthetic-repeat', revision: 1 }, '', { input, transport: fake([homeWithNav(), visitSite()]).transport, again: true });
  assert.notEqual(another.id, first.id);
});

test('an alt on an image is accepted and always replaced by the verified description; style attributes and digits are still refused', () => {
  const withAlt = homeWithNav(); withAlt.html = withAlt.html.replace('<img data-photo="p1">', '<img data-photo="p1" alt="Something Claude wrote">');
  assert.deepEqual(checkCode(withAlt, input, { pages: planPages(input) }), []);
  const html = compilePage(withAlt, input, { pages: planPages(input) });
  assert.match(html, /<img data-photo="p1" alt="Studio entrance"/);
  assert.ok(!html.includes('Something Claude wrote'));
  const styled = good(); styled.html = styled.html.replace('<h1>', '<h1 style="color:red">');
  assert.match(checkCode(styled, input).join(' '), /Attribute style is not allowed: put all styling in css/);
  const altOnP = good(); altOnP.html = altOnP.html.replace('<p>A welcoming', '<p alt="x">A welcoming');
  assert.match(checkCode(altOnP, input).join(' '), /Attribute alt is not allowed/, 'alt only on an image');
  assert.match(FRONTEND_PROMPT, /Your own words contain no digits at all/);
  assert.match(FRONTEND_PROMPT, /no style attributes/);
});

// ── a failure at the inner pages: the claim rule, the checkpoint, and the admin screen ──
const { resumeFrontendJob } = await import('../src/studio/frontend/jobs.js');
const claimVisit = () => visitSite(visitHtml('<h1>Find the studio</h1><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="rating"></p><p>Cakes go fast, so come early for the best pick of the case.</p><a data-action="directions">Directions</a>'));

test('an unsupported claim on the Visit page is refused, with the exact phrase and what to do instead', () => {
  const errs = checkSite(claimVisit(), homeWithNav(), input, planPages(input)).join(' ');
  assert.match(errs, /visit page: Keep numbers\/contact details in data-fact bindings; remove unsupported factual marketing claims\. Unbound text that breaks this: "best" in "[^"]*come early for the best pick of the case/);
  assert.match(errs, /Remove each quoted phrase, or replace it with the business's own verified words from the brief .* or a data-fact binding\. Do not reword it into another claim or number\./);
});

test('the inner pages resume from the checkpoint: the accepted homepage, brief and photo checks are reused, never regenerated', async () => {
  const home = { ...homeWithNav(), idea: 'A checkpoint test homepage (its own idea).' };
  const first = fake([home, claimVisit(), claimVisit()]);
  const failed = (await waitFrontendJob((await startFrontendJob({ businessKey: 'synthetic-resume', revision: 1 }, '', { input, transport: first.transport })).id))!;
  assert.equal(failed.status, 'failed'); assert.equal(failed.stage, 'pages');
  assert.match(failed.error!, /"best" in/);
  const savedHome = JSON.stringify(failed.code), costBefore = failed.costUsd;
  const retry = fake([visitSite()]);
  await resumeFrontendJob(failed.id, { transport: retry.transport });
  await assert.rejects(resumeFrontendJob(failed.id, { transport: retry.transport }), /already running/, 'one resume at a time');
  const done = (await waitFrontendJob(failed.id))!;
  assert.equal(done.status, 'needs-review');
  assert.equal(retry.requests.length, 1);
  assert.ok(retry.requests.every((r) => r.stage === 'frontend:pages-v1'), 'only the inner pages are asked for: no homepage call');
  assert.match(retry.requests[0].prompt, /An earlier attempt at these pages was rejected:\nvisit page: .*"best" in/);
  assert.equal(JSON.stringify(done.code), savedHome, 'the accepted homepage is reused as it was');
  assert.deepEqual(done.input, failed.input, 'the same brief facts and photo checks');
  assert.equal(done.costUsd, costBefore + 0.01, 'the resume adds only its own call');
  assert.equal(done.resumes?.length, 1); assert.equal(done.resumes![0].ok, true); assert.equal(done.resumes![0].costUsd, 0.01);
  assert.match(await frontendPreview(done, 'visit'), /<h1 data-edit="visit-1">Find the studio<\/h1>/);
  await assert.rejects(resumeFrontendJob(done.id, { transport: retry.transport }), /Only a job that failed at its inner pages/, 'a finished job does not resume');
  const homeFail = (await waitFrontendJob((await startFrontendJob({ businessKey: 'synthetic-resume-home', revision: 1 }, '', { input, transport: fake([{ ...good(), html: '<p>no main</p>' }]).transport })).id))!;
  await assert.rejects(resumeFrontendJob(homeFail.id, { transport: retry.transport }), /Only a job that failed at its inner pages, with an accepted homepage/);
});

test('the admin screen shows a failed job\'s actual error prominently, with its design idea kept separate', { skip: !(await import('../src/render/og.js')).screenshotsAvailable() }, async () => {
  const { launchBrowser } = await import('../src/render/og.js');
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    // the New site page reopening a generation it started for a selected business and brief
    await context.addInitScript(() => { localStorage.setItem('roger-newsite-v2', JSON.stringify({ selected: { placeId: 'ChIJsugar0000000000001', name: 'Sugar', address: '1 Test St' }, brief: { businessKey: 'place-ChIJsugar0000000000001', revision: 1 }, designJobId: 'fe_failed1' })); });
    const page = await context.newPage();
    let state: 'failed' | 'done' = 'failed', resumed = 0;
    const at = new Date().toISOString();
    const job = () => (state === 'failed'
      ? { id: 'fe_failed1', status: 'failed', stage: 'pages', attempts: 3, costUsd: 0.869, createdAt: at, updatedAt: at, idea: 'Stepping under the awning of a vintage shop.', error: 'Custom inner pages failed after 2 attempts: visit page: unsupported claim "best"', notes: ['img_1: the website photo has no description'] }
      : { id: 'fe_failed1', status: 'needs-review', attempts: 4, costUsd: 1.1, createdAt: at, updatedAt: at, idea: 'Stepping under the awning of a vintage shop.', previewUrl: '/api/studio/frontend-jobs/fe_failed1/preview', pages: [{ slug: 'home', title: 'Home', url: '/api/studio/frontend-jobs/fe_failed1/preview' }], review: { ran: true, pass: true, pages: [], problems: [] } });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const file = { '/app/frontend.html': 'text/html', '/app/frontend.js': 'text/javascript', '/app/frontend.css': 'text/css' }[url.pathname];
      if (file) return route.fulfill({ contentType: file, body: fs.readFileSync(path.join('public', url.pathname)) });
      if (url.pathname === '/api/studio/businesses') return route.fulfill({ json: { businesses: [] } });
      if (url.pathname.startsWith('/api/studio/briefs/')) return route.fulfill({ status: 404, json: { error: 'No brief' } });
      if (url.pathname === '/api/studio/frontend-jobs/fe_failed1/resume') { resumed++; state = 'done'; return route.fulfill({ status: 202, json: { id: 'fe_failed1', status: 'generating' } }); }
      if (url.pathname === '/api/studio/frontend-jobs/fe_failed1') return route.fulfill({ json: job() });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>preview</p>' });
    });
    await page.goto('http://roger.test/app/frontend.html');
    await page.waitForSelector('#generate-error:not([hidden])');
    assert.match(await page.textContent('#generate-error') ?? '', /Why it failed\s*Custom inner pages failed after 2 attempts: visit page: unsupported claim "best"/);
    assert.equal(await page.textContent('#fail-idea'), 'Stepping under the awning of a vintage shop.', 'the idea stays visible, separately');
    assert.equal(await page.getAttribute('#generate-error', 'role'), 'alert');
    assert.equal(await page.isVisible('#resume-pages'), true, 'failed at the inner pages: the retry is offered');
    await page.click('#resume-pages');
    await page.waitForSelector('#generate-error', { state: 'hidden' });
    await page.waitForSelector('#result:not([hidden])');
    assert.equal(resumed, 1);
    assert.match(await page.textContent('#generate-status') ?? '', /^Finished in /);
  } finally { await browser.close(); }
});
