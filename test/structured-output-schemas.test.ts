// Structured outputs against the Claude API's schema rules. Production failed twice on them: the open planner's
// DesignSpec ("For 'number' type, properties maximum, minimum are not supported") and the reference strategy
// ("minItems values other than 0 or 1 are not supported (got: [2, 5])"). Every structured call now sends a converted
// schema and checks the answer against the original; an API refusal stops the stage instead of becoming a fallback.
// A local stand-in for the API rejects those keywords the same way and otherwise streams back a canned answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-schemas-'));
const answers: unknown[] = [];
const seen: { schema: Record<string, unknown>; format: boolean; prompt: string }[] = [];
let refuseAll = false;
const { apiSchemaFor, server } = await (async () => {
  const S = await import('../src/studio/concepts/schema-compat.js');
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body) as { output_config?: { format?: { schema?: Record<string, unknown> } }; messages: { content: string }[] };
      const schema = j.output_config?.format?.schema ?? {};
      seen.push({ schema, format: !!j.output_config?.format, prompt: j.messages[0].content });
      const bad = S.unsupportedKeywords(schema);
      if (refuseAll || bad.length) {
        res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_test_400' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: refuseAll ? 'output_config.format.schema: test refusal' : `output_config.format.schema: not supported: ${bad.join(', ')}` }, request_id: 'req_test_400' }));
      }
      // like the real API, a constrained schema with this many alternatives is too large to compile
      if ((JSON.stringify(schema).match(/"anyOf"/g) ?? []).length > 8) {
        res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_test_grammar' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.' }, request_id: 'req_test_grammar' }));
      }
      const a = answers[Math.min(seen.length - 1, answers.length - 1)];
      const text = typeof a === 'string' ? a : JSON.stringify(a);
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([
        ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } }),
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
        ev('content_block_stop', { index: 0 }),
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } }),
        ev('message_stop', {}),
      ].join(''));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { apiSchemaFor: S, server: srv };
})();
Object.assign(process.env, {
  MOCK: '1', CLAUDE_CLI: '0', ANTHROPIC_API_KEY: 'sk-ant-test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  DATA_DIR: path.join(tmp, 'data'), OUT_DIR: path.join(tmp, 'out'),
});
const { apiSchema, schemaErrors, unsupportedKeywords } = apiSchemaFor;
const { aiJson, apiTransport, ApiRequestError, CostLedger } = await import('../src/studio/concepts/ai.js');
const { SPEC_SCHEMA, generateDesignSpec } = await import('../src/studio/concepts/designspec.js');
const { STRATEGY_SCHEMA } = await import('../src/studio/concepts/references.js');
const { PLAN_SCHEMA } = await import('../src/studio/concepts/plan.js');
test.after(() => server.close());

const reset = (list: unknown[], refuse = false) => { fs.rmSync(path.join(tmp, 'data', 'studio-ai'), { recursive: true, force: true }); answers.length = 0; answers.push(...list); seen.length = 0; refuseAll = refuse; };
/** every `required` list and `enum` in a schema, in order: the structure the API still enforces */
const skeleton = (s: unknown): unknown[] => (!s || typeof s !== 'object' ? [] : Array.isArray(s) ? s.flatMap(skeleton) : Object.entries(s).flatMap(([k, v]) => (k === 'required' || k === 'enum' ? [[k, v]] : skeleton(v))));

test('the strategy and DesignSpec schemas send nothing the API refuses, keep their structure, and the originals are untouched', () => {
  const before = JSON.stringify([STRATEGY_SCHEMA, SPEC_SCHEMA, PLAN_SCHEMA]);
  // the keywords production was refused for are in the originals…
  assert.ok(unsupportedKeywords(STRATEGY_SCHEMA).includes('$.layoutPatterns: minItems'));
  assert.ok(unsupportedKeywords(SPEC_SCHEMA).includes('$.type.base: minimum') && unsupportedKeywords(SPEC_SCHEMA).includes('$.type.base: maximum'));
  for (const s of [STRATEGY_SCHEMA, SPEC_SCHEMA, PLAN_SCHEMA]) {
    const sent = apiSchema(s);
    // …and in none of what is sent
    assert.deepEqual(unsupportedKeywords(sent), []);
    // every required field and every allowed value is still enforced by the API
    assert.deepEqual(skeleton(sent), skeleton(s));
  }
  assert.equal((apiSchema(STRATEGY_SCHEMA) as { properties: { layoutPatterns: { minItems: number } } }).properties.layoutPatterns.minItems, 1, 'at least one pattern is still asked of the API');
  assert.equal(JSON.stringify([STRATEGY_SCHEMA, SPEC_SCHEMA, PLAN_SCHEMA]), before, 'the originals stay whole for checking answers');
});

test('the limits the API is not sent are still checked on the answer, naming the place', () => {
  const pattern = { pattern: 'Photo-led hero', why: 'food sells', from: ['a.example'] };
  const strategy = { summary: 'Warm and direct.', layoutPatterns: [pattern, pattern], typography: { headings: 'h', body: 'b', notes: 'n' }, imagery: [], navigation: { desktop: 'd', mobile: 'm' }, interactions: [], avoid: [] };
  assert.deepEqual(schemaErrors(STRATEGY_SCHEMA, strategy), []);
  assert.match(schemaErrors(STRATEGY_SCHEMA, { ...strategy, layoutPatterns: [pattern] }).join(), /\$\.layoutPatterns: 1 item\(s\), at least 2 needed/);
  assert.match(schemaErrors(STRATEGY_SCHEMA, { ...strategy, layoutPatterns: Array(7).fill(pattern) }).join(), /at most 6 allowed/);
  assert.match(schemaErrors(STRATEGY_SCHEMA, { ...strategy, summary: 'x'.repeat(321) }).join(), /\$\.summary: text is 321 characters, over the limit of 320/);
  const type = SPEC_SCHEMA.properties.type;
  const t = { heading: 'Inter', body: 'Inter', mono: null, base: 17, scale: 1.3, headingWeight: 700, headingCase: 'none', tracking: 0, measure: 62 };
  assert.deepEqual(schemaErrors(type, t), []);
  assert.match(schemaErrors(type, { ...t, base: 99 }).join(), /\$\.base: 99 is above the maximum 20/);
  assert.match(schemaErrors(type, { ...t, headingWeight: 50 }).join(), /\$\.headingWeight: 50 is below the minimum 200/);
  assert.match(schemaErrors(type, { ...t, measure: 62.5 }).join(), /\$\.measure: 62\.5 should be integer/);
});

test('through the API: the strategy request is accepted, a too-short answer is sent back once, the full answer is kept', async () => {
  const pattern = (n: number) => ({ pattern: `Pattern ${n}`, why: 'fits', from: ['a.example'] });
  const strategy = (k: number) => ({ summary: 'Warm and direct.', layoutPatterns: Array.from({ length: k }, (_, i) => pattern(i)), typography: { headings: 'h', body: 'b', notes: 'n' }, imagery: [], navigation: { desktop: 'd', mobile: 'm' }, interactions: [], avoid: [] });
  reset([strategy(1), strategy(3)]);
  const r = await aiJson({ stage: 'references:strategy', system: 's', prompt: 'p', schema: STRATEGY_SCHEMA, maxOutputTokens: 3000 }, { transport: apiTransport('claude-sonnet-5-5'), ledger: new CostLedger(3, 'test-strategy'), validate: () => [] });
  assert.equal(seen.length, 2, 'two requests, both accepted by the API');
  assert.ok(seen.every((x) => !unsupportedKeywords(x.schema).length));
  assert.match(r.rejected[0].errors.join(), /at least 2 needed/, 'the short answer was refused locally');
  assert.equal((r.data as { layoutPatterns: unknown[] }).layoutPatterns.length, 3);
});

test('an API refusal stops at once, names its stage, and is never replaced by an older kind of design', async () => {
  reset([], true);
  const ledger = new CostLedger(3, 'test-refusal');
  await assert.rejects(
    aiJson({ stage: 'design:spec', system: 's', prompt: 'p', schema: SPEC_SCHEMA, maxOutputTokens: 9000 }, { transport: apiTransport('claude-sonnet-5-5'), ledger, validate: () => [] }),
    (e: Error) => e instanceof ApiRequestError && /^the Claude API rejected the design:spec request \(HTTP 400\): .*test refusal.*\[req_test_400\]$/.test(e.message),
  );
  assert.equal(seen.length, 1, 'not retried: asking again cannot fix a refused request');
  assert.equal(ledger.calls.length, 1);
  assert.equal(ledger.calls[0].ok, false);

  // the open planner reports it rather than falling back to the directions
  reset([], true);
  const cat = {
    business: { name: 'Northline Systems', category: null, website: 'https://northline.example.com', summary: 'A systems consultancy.' },
    ownLines: ['Systems that talk to each other.'], services: [], story: null, actions: [], omitted: [], photos: [], logo: null, email: null, claims: [], items: [], facts: {}, allowedText: '',
  } as never;
  const brief = { businessKey: 'site-northline.example.com', revision: 1, identity: { status: 'website-only' }, brand: { colors: [], fonts: [], logo: { value: null, status: 'unknown' } } } as never;
  await assert.rejects(generateDesignSpec(cat, brief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'a direction' }), /rejected the design:spec request \(HTTP 400\)/);
  assert.equal(seen.length, 1);
});

// ───────────────────────── design:spec as ordinary JSON ─────────────────────────
const { cat: northline, brief: northlineBrief, good } = await import('./helpers/northline-spec.js');
const { SPEC_CONTRACT, specRequest } = await import('../src/studio/concepts/designspec.js');

test('the DesignSpec schema is too large for constrained output, so design:spec asks for ordinary JSON with a contract', async () => {
  // what production hit: the full spec schema as constrained output is refused, even with every keyword converted
  reset([{}]);
  await assert.rejects(
    aiJson({ stage: 'design:spec', system: 's', prompt: 'p', schema: SPEC_SCHEMA, maxOutputTokens: 9000 }, { transport: apiTransport('claude-sonnet-5-5'), ledger: new CostLedger(3, 'test-grammar'), validate: () => [] }),
    /rejected the design:spec request \(HTTP 400\): .*compiled grammar is too large/,
  );
  // the planner's own request: no format, the contract in the prompt, the full schema kept for checking
  const req = specRequest(northline, northlineBrief, null);
  assert.equal(req.output, 'json');
  assert.equal(req.schema, SPEC_SCHEMA);
  assert.ok(req.prompt.endsWith(SPEC_CONTRACT));
  assert.ok(SPEC_CONTRACT.length < 4000, `a concise contract (${SPEC_CONTRACT.length} characters)`);
  for (const line of ['TextRef = { "ownLine": int } | { "service": string, "field": "name"|"description" }', '"base": number 15–20', '"headingWeight": int 200–900', '}] (1–8)', '"referencesUsed": [int ≥0] (≤8)']) assert.ok(SPEC_CONTRACT.includes(line), line);
  // the strategy keeps constrained output (its converted schema compiles)
  reset([{ summary: 'Warm.', layoutPatterns: [{ pattern: 'a', why: 'b', from: ['x.example'] }, { pattern: 'c', why: 'd', from: ['x.example'] }], typography: { headings: 'h', body: 'b', notes: 'n' }, imagery: [], navigation: { desktop: 'd', mobile: 'm' }, interactions: [], avoid: [] }]);
  await aiJson({ stage: 'references:strategy', system: 's', prompt: 'p', schema: STRATEGY_SCHEMA, maxOutputTokens: 3000 }, { transport: apiTransport('claude-sonnet-5-5'), ledger: new CostLedger(3, 'test-strategy-format'), validate: () => [] });
  assert.equal(seen[0].format, true);
});

test('through the API: a DesignSpec answered as ordinary JSON is parsed and passes the full schema and every check', async () => {
  reset([`Here is the design.\n\`\`\`json\n${JSON.stringify(good())}\n\`\`\``]);
  const r = await generateDesignSpec(northline, northlineBrief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'none' });
  assert.equal(r.source, 'ai', r.fallback?.reason ?? '');
  assert.deepEqual(r.spec, good());
  assert.equal(r.attempts, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].format, false, 'no output_config.format is sent for design:spec');
  assert.ok(seen[0].prompt.includes(SPEC_CONTRACT), 'the contract is in the prompt');
  assert.ok(r.calls[0].ok && r.calls[0].costUsd > 0, 'its cost is recorded');
});

test('a malformed answer uses the single repair; an out-of-range one is refused by the full schema; two bad answers fail with the reason', async () => {
  // malformed, then valid: accepted on the repair, which was told why
  reset(['{"thesis": "A page", "palette": {', JSON.stringify(good())]);
  let r = await generateDesignSpec(northline, northlineBrief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'none' });
  assert.equal(r.source, 'ai', r.fallback?.reason ?? '');
  assert.equal(r.attempts, 2);
  assert.match(r.rejected[0].errors[0], /^the answer was not valid JSON \(/);
  assert.match(seen[1].prompt, /Your previous answer was rejected:\n- the answer was not valid JSON .*answer with one JSON object only/);
  assert.ok(r.calls[0].costUsd > 0 && !r.calls[0].ok, 'the unreadable answer is paid for and recorded as failed');

  // a number outside the schema's range (no longer enforced by the API), then valid
  const wide = good(); wide.type.base = 30;
  reset([JSON.stringify(wide), JSON.stringify(good())]);
  r = await generateDesignSpec(northline, northlineBrief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'none' });
  assert.equal(r.source, 'ai');
  assert.match(r.rejected[0].errors.join(), /\$\.type\.base: 30 is above the maximum 20/);

  // a grounding failure (an unsupported action) is still caught after parsing
  const ungrounded = good(); ungrounded.hero.actions = ['call'];
  reset([JSON.stringify(ungrounded), JSON.stringify(ungrounded)]);
  r = await generateDesignSpec(northline, northlineBrief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'none' });
  assert.equal(r.spec, null);
  assert.equal(seen.length, 2, 'one attempt and one repair, no more');
  assert.match(r.fallback!.reason, /no valid spec after 2 attempt\(s\): .*action "call" is not supported/);

  // malformed twice: no spec, the reason says so
  reset(['not json at all', 'still not json']);
  r = await generateDesignSpec(northline, northlineBrief, null, { transport: apiTransport('claude-sonnet-5-5'), fallback: () => 'none' });
  assert.equal(r.spec, null);
  assert.match(r.fallback!.reason, /no valid spec after 2 attempt\(s\): the answer was not valid JSON/);
});
