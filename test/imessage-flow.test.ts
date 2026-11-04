// Roger's iMessage conversation, end to end on a sample business: he never promises a build time, answers the
// questions people ask on the way (what is this, what does it cost, call me), and every button he offers has an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-imessage-'));
Object.assign(process.env, { BRAND_MEASURE: '0', MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: '', LEAD_WEBHOOK_URL: '', IMESSAGE_OUTBOUND_URL: '', PAGESPEED: '0', RESCORE: '0', DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'), PUBLIC_BASE_URL: 'http://localhost:4995' });

const { handleInbound, isPending } = await import('../src/imessage/flow.js');
const { getConversation, saveConversation, saveBuild } = await import('../src/store.js');

/** a promised duration: "about 15 seconds", "2 minutes", "in a minute" */
const PROMISE = /\b(\d+|a|one|two|few|couple of)\s*(sec|second|min|minute)s?\b/i;

test('Roger never promises a time, answers questions on the way, and handles every button he offers', { timeout: 240_000 }, async () => {
  const from = 'owner-1';
  const say = async (t: string) => (await handleInbound(from, t)).replies;
  const text = (r: { text: string }[]) => r.map((x) => x.text).join('\n');
  const all: string[] = [];
  const turn = async (t: string) => { const r = await say(t); all.push(text(r)); return r; };

  let r = await turn('hi');
  assert.match(text(r), /What's your website\?/);

  r = await turn('how much does it cost?');
  assert.match(text(r), /preview is free/);
  assert.match(r.at(-1)!.text, /send me your website/i, 'and asks the question again');

  r = await turn('hello');
  assert.match(text(r), /send me your website/i, 'a greeting is not searched for on Google');

  r = await turn('BlueLine Plumbing Denver');
  assert.match(r[0].text, /^Is this you\?\nBlueLine Plumbing & Drain/);

  r = await turn('what is this?');
  assert.match(r[0].text, /I'm Roger/);
  assert.equal(r[1].text, 'Is BlueLine Plumbing & Drain your business?');

  r = await turn('call me');
  assert.match(r[0].text, /call/);
  assert.equal((await getConversation(from))?.followUp?.reason, 'call', 'the Studio sees the request');

  r = await turn("Yes, that's me");
  assert.match(r[0].text, /couldn't find a website for BlueLine/);
  assert.deepEqual(r[0].quickReplies, ['Yes, build it', 'Not now']);

  r = await turn('Yes, build it');
  assert.match(r[0].text, /^On it!/);
  const preview = r.find((x) => /localhost:4995\/sites\//.test(x.url ?? ''));
  assert.ok(preview, 'the preview card follows');
  const editor = r.find((x) => /\/owner\/\?d=/.test(x.url ?? ''));
  assert.ok(editor, 'and the private editor link');
  assert.ok(preview!.quickReplies?.length, 'with buttons');

  // every button on the preview gets a real answer, not "text restart"
  for (const chip of preview!.quickReplies!) {
    if (/personali[sz]e|change|different design/i.test(chip)) continue; // these rebuild; covered by the Studio tests
    const a = await turn(chip);
    assert.ok(!/didn't catch that|preview again/i.test(text(a)), `"${chip}" has its own answer: ${text(a)}`);
  }
  r = await turn('Publish it');
  assert.match(text(r), /Buy this website/);
  assert.equal(r[0].url, editor!.url, 'the same editor link, not a new one that cancels the first');

  r = await turn('Check the details');
  assert.match(text(r), /check|nothing waiting/i);

  r = await turn('thanks!');
  assert.match(text(r), /welcome/i);

  r = await turn('blah blah');
  assert.match(text(r), /Here's your preview again/);

  for (const t of all) assert.ok(!PROMISE.test(t), `no time is promised: "${t.match(PROMISE)?.[0]}" in ${t}`);
});

test('a build that is still running is not called dead because it is slower than a guess', async () => {
  const from = 'owner-2';
  const at = new Date().toISOString();
  const building = (startedMinutesAgo: number, buildId: string) => saveConversation({ from, startedAt: at, updatedAt: at, messages: [], buildIds: [], session: { state: 'building', candidates: [], idx: 0, lastBuildId: buildId, buildStartedAt: Date.now() - startedMinutesAgo * 60_000 } });
  process.env.VERCEL = '1'; // another instance may be running it: only the saved record or the hard limit decides
  try {
    await building(5, 'job-slow');
    assert.equal(await isPending(from), true, 'five minutes in, it is still building');
    await building(20, 'job-slow');
    assert.equal(await isPending(from), false, 'past the hard limit it died');
    await saveBuild({ id: 'job-done', createdAt: at, finishedAt: at, source: 'imessage', from, status: 'done' } as Parameters<typeof saveBuild>[0]);
    await building(1, 'job-done');
    assert.equal(await isPending(from), false, 'a saved record means it finished');
  } finally {
    delete process.env.VERCEL;
  }
});
