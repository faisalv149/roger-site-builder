// "Request another version" on the open intake: a new DesignSpec that differs meaningfully in hero composition and page
// structure (not just colour, type or order), one version per request however often the conversation is polled, each
// version with its own stable link, only that link and the two choices sent, and approval naming the version shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-versions-'));
Object.assign(process.env, { MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out') });
delete process.env.ROGER_INTAKE_CONCEPTS;
const { config } = await import('../src/config.js');
const D = await import('../src/studio/concepts/designspec.js');
const { renderSpec } = await import('../src/studio/concepts/spec-render.js');
const { advanceIntake, requestVersion } = await import('../src/imessage/intake.js');
const { handleInbound, pollIntake } = await import('../src/imessage/flow.js');
const { studioDocs, saveConversation, getConversation } = await import('../src/store.js');
const { putDraft } = await import('../src/drafts.js');
type Spec = import('../src/studio/concepts/designspec.js').DesignSpec;
type Run = import('../src/imessage/intake.js').IntakeRun;

const layout = (o: object = {}) => ({ arrangement: 'stack' as const, headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12, itemColumns: 3, itemStyle: 'card' as const, density: 'regular' as const, ...o });
const v1 = (): Spec => ({
  thesis: 't', palette: { ground: 'paper', surface: 'tint:#3F7C7D:8', ink: 'ink', inverse: '#3F7C7D', accent: '#AD0000', onAccent: 'white' },
  type: { heading: 'Teko', body: 'Quicksand', mono: null, base: 17, scale: 1.35, headingWeight: 600, headingCase: 'uppercase', tracking: 0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 24, margin: 40 }, shape: { radius: 6, rule: 'hairline' },
  header: { style: 'split', links: ['menu'], action: null, sticky: true },
  hero: { composition: 'split', background: 'ground', backgroundPhoto: null, minHeight: 64, verticalAlign: 'center', align: 'start', textStart: 1, textSpan: 6, headlineSize: 4.4, kicker: null, headline: { ownLine: 0 }, lede: null, actions: [], aside: { kind: 'image', start: 8, span: 5, items: [], photoId: 'p1' } },
  sections: [
    { id: 'menu', purpose: 'p', kind: 'work', heading: { ownLine: 1 }, intro: null, layout: layout(), background: 'ground', items: [], actions: [] },
    { id: 'custom', purpose: 'p', kind: 'statement', heading: { ownLine: 1 }, intro: null, layout: layout({ arrangement: 'side-by-side', headingSpan: 5, contentStart: 7, contentSpan: 6, itemStyle: 'ruled' }), background: 'surface', items: [], actions: [] },
    { id: 'about', purpose: 'p', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout: layout({ itemStyle: 'plain' }), background: 'inverse', items: [], actions: [] },
    { id: 'visit', purpose: 'p', kind: 'contact', heading: { ownLine: 1 }, intro: null, layout: layout({ arrangement: 'side-by-side', headingSpan: 6, contentStart: 7, contentSpan: 6, itemStyle: 'ruled' }), background: 'ground', items: [], actions: [] },
  ],
  imagery: { approach: 'a', roles: [] }, mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: null, headingScale: 0.62, itemColumns: 1 },
});

test('a new version must differ in hero composition and page structure; colour, type and section order do not count', () => {
  // the same structure in other colours and fonts, sections reordered
  const reskin = v1();
  reskin.palette = { ...reskin.palette, ground: 'white', accent: '#3F7C7D' };
  reskin.type = { ...reskin.type, heading: 'Quicksand', headingCase: 'none' };
  reskin.sections = [...reskin.sections].reverse();
  const errs = D.differenceProblems(reskin, [v1()]);
  assert.match(errs.join(' | '), /hero: too close to version 1 \(only nothing differs/);
  assert.match(errs.join(' | '), /page structure: too close to version 1 \(0 structural change\(s\): none; at least 2 needed/);
  // a photo-background, centred, tall hero and a different page
  const other = v1();
  other.hero = { ...other.hero, backgroundPhoto: 'p1', align: 'center', textStart: 3, textSpan: 8, minHeight: 85, aside: { kind: 'none', start: 1, span: 0, items: [], photoId: null } };
  other.sections = [
    { ...other.sections[0], layout: layout({ itemStyle: 'large-type' }), media: { placement: 'band', photoIds: ['p2'] } },
    { ...other.sections[2], layout: layout({ arrangement: 'side-by-side', headingSpan: 4, contentStart: 6, contentSpan: 7, itemStyle: 'plain' }) },
    { ...other.sections[3] },
  ];
  assert.deepEqual(D.differenceProblems(other, [v1()]), []);
  assert.match(D.previousForPrompt([v1()]), /version 1: \{"hero":\{"aside":"image","photoBg":false,"textSide":"left","width":"mid","height":"short"\}/);
});

test('an "Hours" label with no verified hours is left out; with verified hours it shows them', () => {
  const cat = { business: { name: 'Sugar Loaf Bakeshop', summary: null }, ownLines: ['Baking Up Cake & Community!', 'Visit', 'Hours', 'Location'], services: [], story: null, actions: [], omitted: [], photos: [], logo: null, email: null, address: null, locations: [], area: null, hours: null } as never;
  const brief = { brand: { colors: [{ hex: '#3F7C7D' }, { hex: '#AD0000' }], fonts: [], logo: { value: null, status: 'unknown' } } } as never;
  const s = v1(); s.hero.aside = { kind: 'none', start: 1, span: 0, items: [], photoId: null };
  s.sections = [{ ...s.sections[3], items: [{ title: { ownLine: 3 }, body: { ownLine: 1 } }, { title: { ownLine: 2 }, body: null }] }];
  const without = renderSpec(s, cat, brief);
  assert.ok(!/<h3>Hours<\/h3>/.test(without), 'no empty Hours heading');
  assert.match(without, /<h3>Location<\/h3>/);
  const withHours = renderSpec(s, { ...(cat as object), hours: ['Tue–Sat: 10:00 AM – 7:00 PM'] } as never, brief);
  assert.match(withHours, /<h3>Hours<\/h3><p>Tue–Sat: 10:00 AM – 7:00 PM<\/p>/);
});

// ── one request, one version; stable links; the message; approval ──
const FROM = 'qa-versions-test';
async function plant(): Promise<Run> {
  await studioDocs.put('studio-index', 'place-v', { businessKey: 'place-v', latest: 1, revisions: [] });
  await studioDocs.put('studio-briefs', 'place-v--r1', { businessKey: 'place-v', revision: 1, briefHash: 'h' });
  await putDraft({ id: 'drf_v', slug: 'sugar-loaf' } as never);
  const site = path.join(config.dirs.sites, 'sugar-loaf');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<meta name="roger-design" content="ds_v1"><h1>Version one</h1>');
  const run: Run = { id: 'in_v', input: { placeId: 'v' }, mode: 'open', stage: 'done', startedAt: new Date().toISOString(), timings: {}, businessKey: 'place-v', referenceJobId: 'rj_v', conceptJobId: 'cj_v1', setId: 'cs_v1', designSpecId: 'ds_v1', siteJobId: 'sj_v1', draftId: 'drf_v', siteUrl: `${config.publicBaseUrl}/sites/sugar-loaf/`, checks: [] };
  await saveConversation({ from: FROM, startedAt: run.startedAt, updatedAt: run.startedAt, messages: [], buildIds: [], session: { state: 'done', candidates: [], idx: 0, chosen: { name: 'Sugar Loaf Bakeshop', placeId: 'v' }, intake: run, intakeMode: 'open', lastSiteUrl: run.siteUrl } } as never);
  return run;
}
const conceptJobs = async () => (await studioDocs.list<{ input: { avoidSpecIds?: string[] } }>('studio-concept-jobs')).filter((j) => j.input.avoidSpecIds);

test('one request makes one version, however often the conversation is polled or the request repeated', async () => {
  await plant();
  const r1 = await handleInbound(FROM, 'Request another version', { async: true });
  assert.match(r1.replies[0].text!, /^On it! I'm making another version/);
  let s = (await getConversation(FROM))!.session as { intake: Run; state: string };
  assert.equal(s.state, 'building');
  assert.equal(s.intake.next?.n, 2);
  assert.deepEqual(s.intake.versions?.map((v) => [v.n, v.siteUrl]), [[1, `${config.publicBaseUrl}/sites/sugar-loaf-inv-v1/`]], 'version 1 kept under its own link before anything is rebuilt');
  assert.ok(fs.existsSync(path.join(config.dirs.sites, 'sugar-loaf-inv-v1', 'index.html')));
  // the version's concept job keeps working (here it would fail at once: the planted brief has no inventory)
  await new Promise((r) => setTimeout(r, 300));
  const jid = s.intake.next!.conceptJobId!;
  await studioDocs.put('studio-concept-jobs', jid, { ...(await studioDocs.get<object>('studio-concept-jobs', jid)), status: 'running', updatedAt: new Date().toISOString(), stages: [] });
  for (let i = 0; i < 3; i++) await pollIntake(FROM);
  const r2 = await handleInbound(FROM, 'Request another version', { async: true });
  assert.match(r2.replies[0].text!, /^Still building your preview|^Still making your other version/);
  const jobs = await conceptJobs();
  assert.equal(jobs.length, 1, 'one concept job for one request');
  assert.deepEqual(jobs[0].input.avoidSpecIds, ['ds_v1'], 'checked against the version already shown');
  s = (await getConversation(FROM))!.session as { intake: Run; state: string };
  assert.equal(s.intake.next?.n, 2);
});

test('a finished version gets its own stable link; the client gets only that link and the two choices; approval names it', async () => {
  const s = (await getConversation(FROM))!.session as { intake: Run };
  const run = s.intake;
  // the version's jobs, as they finish: an open concept job with its spec, and the site job for the same draft
  await studioDocs.put('studio-concept-jobs', run.next!.conceptJobId!, { ...(await studioDocs.get<object>('studio-concept-jobs', run.next!.conceptJobId!)), status: 'done', setId: 'cs_v2', work: { calls: [], designSpecId: 'ds_v2', design: { references: { referenceJobId: 'rj_v', provided: true, applied: ['Photo-led hero'] } } } });
  run.next!.stage = 'site';
  run.next!.setId = 'cs_v2'; run.next!.designSpecId = 'ds_v2';
  run.next!.siteJobId = 'sj_v2';
  await studioDocs.put('studio-site-jobs', 'sj_v2', { id: 'sj_v2', setId: 'cs_v2', conceptId: 'a', status: 'done', stages: [], createdAt: '', updatedAt: new Date().toISOString(), resumes: 0, draftId: 'drf_v', siteUrl: `${config.publicBaseUrl}/sites/sugar-loaf/`, review: { status: 'ok', checks: [] } });
  fs.writeFileSync(path.join(config.dirs.sites, 'sugar-loaf', 'index.html'), '<meta name="roger-design" content="ds_v2"><h1>Version two</h1>');
  const conv = (await getConversation(FROM))!;
  await saveConversation({ ...conv, session: { ...(conv.session as object), intake: run } } as never);
  const before = conv.messages.length;
  await pollIntake(FROM);
  await pollIntake(FROM);
  const after = (await getConversation(FROM))!;
  const ss = after.session as { intake: Run; state: string; lastSiteUrl: string };
  assert.equal(ss.state, 'done');
  assert.deepEqual(ss.intake.versions?.map((v) => [v.n, v.designSpecId, v.siteUrl]), [[1, 'ds_v1', `${config.publicBaseUrl}/sites/sugar-loaf-inv-v1/`], [2, 'ds_v2', `${config.publicBaseUrl}/sites/sugar-loaf-inv-v2/`]]);
  assert.equal(fs.readFileSync(path.join(config.dirs.sites, 'sugar-loaf-inv-v1', 'index.html'), 'utf8'), '<meta name="roger-design" content="ds_v1"><h1>Version one</h1>', 'version 1 still shows version 1');
  assert.equal(fs.readFileSync(path.join(config.dirs.sites, 'sugar-loaf-inv-v2', 'index.html'), 'utf8'), '<meta name="roger-design" content="ds_v2"><h1>Version two</h1>');
  const sent = after.messages.slice(before).filter((m) => m.dir === 'out');
  assert.equal(sent.length, 1, 'polled twice, delivered once');
  const m = sent[0] as { text?: string; url?: string; quickReplies?: string[] };
  assert.equal(m.url, `${config.publicBaseUrl}/sites/sugar-loaf-inv-v2/`);
  assert.ok(!/https?:\/\//.test(m.text ?? ''), 'no other link in the text');
  assert.deepEqual(m.quickReplies, ['Approve and publish', 'Request another version']);
  assert.equal(ss.intake.shownVersion, 'in_v-v2');
  await handleInbound(FROM, 'Approve and publish', { async: true });
  const approved = ((await getConversation(FROM))!.session as { intake: Run }).intake.approved!;
  assert.deepEqual({ ...approved, at: undefined }, { versionId: 'in_v-v2', n: 2, designSpecId: 'ds_v2', siteUrl: `${config.publicBaseUrl}/sites/sugar-loaf-inv-v2/`, at: undefined });
  // and a version request is only for a finished open intake
  assert.equal(await requestVersion({ ...run, mode: undefined } as Run), 'unavailable');
  assert.equal(await requestVersion({ ...run, stage: 'site' } as Run), 'unavailable');
  void advanceIntake;
});
