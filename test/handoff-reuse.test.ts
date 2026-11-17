// The open-design full-site handoff reuses the Studio's completed work only for the business the owner confirmed, and a
// saved photo description only for the photo it was made of (its image fingerprint), wherever Google moved it: two
// different photos of the same size that swap places keep their own descriptions; a photo whose identity cannot be
// established is looked at again and never given an old description. Google's photo resource names and authors are not
// kept in drafts or site records: photos stay live references. Synthetic images and records; nothing is fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-handoff-reuse-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), IMESSAGE_OUTBOUND_URL: '', LEAD_WEBHOOK_URL: '' });
const { reusedLabels } = await import('../src/pipeline.js');
const { reusedFacts } = await import('../src/content/facts.js');
const { studioReuse } = await import('../src/studio/concepts/site.js');
const { studioDocs } = await import('../src/store.js');
const { onClaudeCall } = await import('../src/content/claude.js');
const { photoFingerprint, fingerprintDistance, samePhoto, featureless, SAME_PHOTO_BITS } = await import('../src/design/fingerprint.js');
const { withLivePhotos } = await import('../src/sources/google-live.js');
const { putDraft } = await import('../src/drafts.js');
const { newIntake, advanceIntake } = await import('../src/imessage/intake.js');

const PLACE = 'ChIJsynthetic000000001';
// three different textured pictures of exactly the same size (300×400): seeded blocks of colour, like a photo's detail
const picture = (seed: number) => {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const w = 300, h = 400, bw = 25, cols = w / bw, cells = Array.from({ length: cols * (h / bw) }, () => [rnd(), rnd(), rnd()].map((v) => Math.round(v * 255)));
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x2 = 0; x2 < w; x2++) cells[Math.floor(y / bw) * cols + Math.floor(x2 / bw)].forEach((v, c) => { px[(y * w + x2) * 3 + c] = v; });
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
};
const TACOS = await picture(7);
const BOWL = await picture(11);
const NEW = await picture(23);
const BLANK_A = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().toBuffer();
const BLANK_B = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 205, g: 198, b: 202 } } }).jpeg().toBuffer();
const gphoto = (name: string) => ({ ref: `places/${PLACE}/photos/${name}`, width: 300, height: 400, authors: [{ name: 'A. Contributor', uri: 'https://maps.google.com/contrib/1' }], source: 'google' as const });
const business = (photos: ReturnType<typeof gphoto>[]) => ({ placeId: PLACE, name: 'Corner Taqueria', source: 'places', photos, reviews: [], hours: { periods: [], weekdayText: [] } }) as never;
const item = (photo: object, raw: Buffer) => ({ photo, image: {} as never, raw });
const check = async (n: number, raw: Buffer | null, kind: string, seen: string) => ({ url: `google-listing:${PLACE}#${n}`, width: 300, height: 400, kind, seen, ...(raw ? { fp: await photoFingerprint(raw) } : {}) });
const asker = () => { const asked: number[] = []; return { asked, ask: async (items: unknown[]) => { asked.push(items.length); return { kinds: items.map(() => 'work' as const), seen: items.map(() => 'looked at again'), source: 'vision' as const }; } }; };

test('fingerprints: the same picture re-encoded or resized matches; a different picture of the same size does not', async () => {
  const a = await photoFingerprint(TACOS);
  assert.ok(fingerprintDistance(a, await photoFingerprint(await sharp(TACOS).resize(150, 200).jpeg({ quality: 60 }).toBuffer())) <= SAME_PHOTO_BITS, 'half the size, lower quality: the same picture');
  assert.ok(fingerprintDistance(a, await photoFingerprint(BOWL)) > 3 * SAME_PHOTO_BITS);
  assert.ok(fingerprintDistance(a, await photoFingerprint(NEW)) > 3 * SAME_PHOTO_BITS);
  assert.equal(samePhoto(a, [{ fp: a }, { fp: a }]), undefined, 'two equally close: not established');
  // a blank or flat picture has no structure to tell it from another: never an identity
  const blank = await photoFingerprint(BLANK_A);
  assert.equal(featureless(blank), true);
  assert.equal(samePhoto(await photoFingerprint(BLANK_B), [{ fp: blank }]), undefined);
});

test('two different photos of the same size swap places: each keeps its own description, nothing is asked again', async () => {
  const checks = [await check(0, TACOS, 'work', 'Tacos on a tray'), await check(1, BOWL, 'work', 'Bowl with avocado')];
  // Google now lists the bowl first and the tacos second
  const now = [gphoto('bowl'), gphoto('tacos')];
  const { asked, ask } = asker();
  const r = await reusedLabels([item(now[0], BOWL), item(now[1], TACOS)] as never, business(now), { from: 'x', photoChecks: checks }, ask);
  assert.deepEqual(r.seen, ['Bowl with avocado', 'Tacos on a tray'], 'by the image, not by the position');
  assert.notDeepEqual(r.seen, checks.map((c) => c.seen), 'position and size alone would have swapped them');
  assert.deepEqual(asked, []);
  assert.equal(r.reused, 2);
});

test('identity not established: no old description is attached, and only those photos are looked at again', async () => {
  const now = [gphoto('tacos'), gphoto('new'), gphoto('bowl')];
  const items = [item(now[0], TACOS), item(now[1], NEW), item(now[2], BOWL)];
  // the tacos check has a fingerprint; position 1 is a new picture of the same size; the bowl's check predates fingerprints
  const checks = [await check(0, TACOS, 'work', 'Tacos on a tray'), await check(1, null, 'storefront', 'Old storefront'), await check(2, null, 'work', 'Bowl with avocado')];
  const { asked, ask } = asker();
  const r = await reusedLabels(items as never, business(now), { from: 'x', photoChecks: checks }, ask);
  assert.deepEqual(r.seen, ['Tacos on a tray', 'looked at again', 'looked at again']);
  assert.ok(!r.seen.includes('Old storefront') && !r.seen.includes('Bowl with avocado'), 'never by position alone');
  assert.deepEqual(asked, [2], 'one call, for the two uncertain photos only');
  assert.match(r.note!, /^2 photo\(s\) whose identity could not be established \(2 saved check\(s\) predate fingerprints; .*no old description was attached/);
  // two saved checks of the same picture: ambiguous, so looked at again
  const twice = [await check(0, TACOS, 'work', 'Tacos'), await check(3, TACOS, 'other', 'Menu')];
  const again = asker();
  assert.deepEqual((await reusedLabels([item(now[0], TACOS)] as never, business([now[0]]), { from: 'x', photoChecks: twice }, again.ask)).seen, ['looked at again']);
  // a website photo: matched by its image too, never by its address alone
  const site = { ref: 'https://example.com/img/cake.jpg', width: 300, height: 400, authors: [], source: 'website' as const };
  const w = asker();
  const byAddress = await reusedLabels([item(site, NEW)] as never, business([]), { from: 'x', photoChecks: [{ url: site.ref, width: 300, height: 400, kind: 'work', seen: 'Cake stand', fp: await photoFingerprint(TACOS) }] }, w.ask);
  assert.deepEqual(byAddress.seen, ['looked at again'], 'the same address now shows another picture');
});

test('facts come from the confirmed brief: its verified offerings only, no Claude call', () => {
  const calls: unknown[] = [];
  const off = onClaudeCall((c) => calls.push(c));
  const r = reusedFacts(business([]), undefined, { services: [{ name: 'Breakfast tacos', description: 'Served until 11.' }] }, 'brief place-x r1');
  off();
  assert.equal(calls.length, 0);
  assert.equal(r.claude.ran, false);
  assert.deepEqual(r.services.map((s) => [s.name, s.description]), [['Breakfast tacos', 'Served until 11.']]);
  assert.deepEqual(r.serviceBlurbs, {}, 'no theme blurbs: not verified facts');
});

const brief = (status: string, placeId = PLACE) => ({
  businessKey: `place-${placeId}`, revision: 1, route: 'google', briefHash: 'h',
  identity: { status, evidence: ['the link names this Google listing'], listing: { placeId }, website: { value: null } },
  services: { status: 'unknown', items: [], proposals: [] },
  serviceArea: { value: null, status: 'unknown', confidence: 0, sources: [] },
  availability: { emergency: { value: null, status: 'unknown', confidence: 0, sources: [] }, note: '' },
}) as never;
const owner = (placeId = PLACE) => ({ by: 'owner' as const, placeId, at: '2026-11-15T12:00:00.000Z' });

test('reuse requires the owner\'s confirmation of this very listing; checks keep their fingerprints', async () => {
  await studioDocs.put('studio-concept-jobs', 'cj_synthetic', { id: 'cj_synthetic', setId: 'cs_synthetic', createdAt: '', updatedAt: '', status: 'done', input: { businessKey: `place-${PLACE}`, revision: 1, reviewId: 'rv', planner: 'open' }, stages: [], resumes: 0,
    work: { calls: [], listing: { labelled: 'vision', items: [{ n: 0, width: 300, height: 400, kind: 'work', seen: 'Tacos', eligible: true, fp: await photoFingerprint(TACOS) }, { n: 1, width: 300, height: 400, kind: 'unknown', eligible: false, reason: 'could not be looked at' }, { n: 2, width: 300, height: 400, kind: 'other', seen: 'Menu board', eligible: false }] } } });
  const none = await studioReuse('cs_synthetic', brief('probable'));
  assert.equal(none.reuse, undefined, 'no confirmation: nothing reused');
  assert.match(none.summary.missing[0], /the owner has not confirmed this business/);
  const other = await studioReuse('cs_synthetic', brief('probable'), owner('ChIJsomeoneelse0000002'));
  assert.equal(other.reuse, undefined, 'confirmed another listing: nothing reused');
  assert.match(other.summary.missing[0], /the owner confirmed Google listing ChIJsomeoneelse0000002, but the brief is for ChIJsynthetic000000001/);
  assert.equal((await studioReuse('cs_synthetic', brief('unverified'), owner())).reuse, undefined, 'an unsettled brief identity: nothing reused');
  assert.equal((await studioReuse('cs_synthetic', brief('probable'), { by: 'staff', placeId: PLACE, at: 'x' } as never)).reuse, undefined, 'only the owner confirms');
  const r = await studioReuse('cs_synthetic', brief('probable'), owner());
  assert.match(r.reuse!.from, /concept job cj_synthetic · confirmed by the owner 2026-11-15T12:00:00.000Z$/);
  assert.deepEqual(r.reuse?.photoChecks?.map((c) => [c.url, !!c.fp]), [[`google-listing:${PLACE}#0`, true], [`google-listing:${PLACE}#2`, false]]);
  assert.ok(r.summary.missing.some((m) => /1 saved photo check\(s\) have no image fingerprint .*looked at again, never given the old description/.test(m)));
});

test('the intake carries the owner\'s confirmation to the site build; without one, none is invented', async () => {
  const key = `place-${PLACE}`;
  await studioDocs.put('studio-index', key, { businessKey: key, latest: 1, revisions: [] });
  await studioDocs.put('studio-briefs', `${key}--r1`, brief('probable'));
  await studioDocs.put('studio-concept-sets', 'cs_synthetic', { id: 'cs_synthetic', brief: { businessKey: key, revision: 1, briefHash: 'h' }, reviewId: 'rv', concepts: [{ id: 'a', name: 'Open design', designSpecId: 'ds_x', checks: [{ id: 'photos', level: 'pass' }, { id: 'facts', level: 'pass' }] }] });
  await studioDocs.put('studio-concept-jobs', 'cj_synthetic', { ...(await studioDocs.get<object>('studio-concept-jobs', 'cj_synthetic'))!, work: { calls: [], designSpecId: 'ds_x', design: { id: 'ds_x', source: 'ai', attempts: 1, strategy: 'none saved', fallback: null, rejected: [] } } });
  const site = async (input: Parameters<typeof newIntake>[0]) => { const run = newIntake(input, 'open'); await advanceIntake(run); assert.ok(run.siteJobId, run.error ?? 'no site job'); return studioDocs.get<{ confirmed?: unknown }>('studio-site-jobs', run.siteJobId!); };
  assert.deepEqual((await site({ placeId: PLACE, confirmed: owner() }))?.confirmed, owner());
  assert.equal((await site({ placeId: PLACE }))?.confirmed, undefined);
  assert.equal((await site({ placeId: PLACE, confirmed: owner('ChIJsomeoneelse0000002') }))?.confirmed, undefined, 'a confirmation of another listing is not passed on');
});

test('the conversation records the owner\'s "yes" as the confirmation the intake carries', async () => {
  const { handleInbound } = await import('../src/imessage/flow.js');
  const { getConversation } = await import('../src/store.js');
  const from = 'owner-confirms';
  for (const t of ['hi', 'Larkspur Plumbing 53703', "Yes, that's me", 'Yes, build it']) await handleInbound(from, t, { intake: 'open' });
  const s = (await getConversation(from)) as unknown as { session: { chosen: { placeId: string }; confirmedAt: string; intake: { input: { placeId: string; confirmed?: { by: string; placeId: string; at: string } } } } };
  assert.equal(s.session.intake.input.confirmed?.by, 'owner');
  assert.equal(s.session.intake.input.confirmed?.placeId, s.session.chosen.placeId);
  assert.equal(s.session.intake.input.confirmed?.at, s.session.confirmedAt);
});

test('Google photo resource names and authors are not kept: drafts and site records hold live references', async () => {
  const b = { placeId: PLACE, photos: [gphoto('first'), { ref: 'https://example.com/own.jpg', width: 800, height: 600, authors: [], source: 'website' as const }, gphoto('second')] };
  const kept = withLivePhotos(b);
  assert.deepEqual(kept.photos.map((p) => p.ref), [`google-listing:${PLACE}#0`, 'https://example.com/own.jpg', `google-listing:${PLACE}#1`], 'numbered among Google photos, as /gphoto/<place>/<n> is');
  assert.ok(kept.photos.filter((p) => p.source === 'google').every((p) => p.authors.length === 0 && p.width === 300 && p.height === 400));
  assert.deepEqual(withLivePhotos(kept), kept, 'applying it again changes nothing');
  await putDraft({ id: 'drf_synthetic', v: 1, base: { business: b } } as never);
  const raw = fs.readFileSync(path.join(tmp, 'data', 'drafts', 'drf_synthetic.json'), 'utf8');
  assert.ok(!raw.includes(`places/${PLACE}/photos/`), 'no resource name stored');
  assert.ok(!raw.includes('A. Contributor'), 'no author stored');
  assert.ok(raw.includes(`google-listing:${PLACE}#1`));
});
