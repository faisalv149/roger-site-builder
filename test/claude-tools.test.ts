// A model that refuses a forced tool call must not silently turn every Claude step into a template fallback.
import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, { MOCK: '1', ANTHROPIC_API_KEY: 'sk-ant-test-key', CLAUDE_CLI: '0', ANTHROPIC_MODEL: 'claude-test-no-forced-tools' });

const seen: { forced: boolean; system: string }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/api\.anthropic\.com\/v1\/messages/.test(url)) return new Response('{}', { status: 404 });
  const body = JSON.parse(String(init?.body ?? '{}'));
  const forced = body.tool_choice?.type === 'tool';
  seen.push({ forced, system: String(body.system) });
  if (forced) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tu_1', name: body.tools[0].name, input: { answer: 42 } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const { claudeJsonDetailed, claudeToolMode } = await import('../src/content/claude.js');
const call = () => claudeJsonDetailed<{ answer: number }>({ system: 'You extract facts.', prompt: '{}', toolName: 'record_facts', toolDescription: 'Record facts.', schema: { type: 'object', properties: { answer: { type: 'number' } } } });

test('a model that refuses forced tool use is asked to call the tool itself, and that is remembered', async () => {
  assert.equal(claudeToolMode(), 'forced');
  const first = await call();
  assert.ok(first.ok && first.data.answer === 42, 'the answer comes back instead of a fallback');
  assert.deepEqual(seen.map((s) => s.forced), [true, false], 'one refused forced request, then the retry');
  assert.match(seen[1].system, /Respond only by calling the record_facts tool/);
  assert.equal(claudeToolMode(), 'auto');
  const second = await call();
  assert.ok(second.ok);
  assert.deepEqual(seen.map((s) => s.forced), [true, false, false], 'later calls go straight to the supported mode');
});
