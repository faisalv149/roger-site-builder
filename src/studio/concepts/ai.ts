import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { claudeVia } from '../../content/claude.js';
import { studioDocs } from '../../store.js';
import { sha256, stableStringify } from '../snapshot.js';
import type { UsageRecord } from './types.js';
import { apiSchema, overLength, parseJsonAnswer, schemaErrors, setAt, shortenAtWord, type LongField } from './schema-compat.js';

/**
 * Claude for concept sets, with a hard cost cap. Every call:
 *   - is cached by its exact request (model, prompt version, system, prompt, schema): the same request is answered
 *     from the cache at no cost, so a set rebuilt from the same brief and review gets the same plan;
 *   - is refused before it is sent unless its worst case (the input, plus the most output it may produce) fits in
 *     what is left of the set's cap; the CLI is also given the remainder as its own limit (--max-budget-usd);
 *   - is logged (tokens, cost, how the cost was known) to the set and to `studio-ai-usage`.
 * A set makes at most 1 + 2 attempts per stage: an answer that fails validation is retried with the errors, twice.
 */

/** dollars per million tokens (Anthropic first-party rates) */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; maxOutput: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4, maxOutput: 32_000 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8, maxOutput: 32_000 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2, maxOutput: 32_000 },
};
export const conceptModel = () => process.env.STUDIO_CONCEPT_MODEL || 'claude-sonnet-5-5';
export const conceptCapUsd = () => Number(process.env.STUDIO_CONCEPT_CAP_USD ?? 3);
/** retries after the first attempt: at most 2, whatever is configured */
export const conceptRetries = () => Math.max(0, Math.min(2, Number(process.env.STUDIO_CONCEPT_RETRIES ?? 2)));
const effort = () => (process.env.STUDIO_CONCEPT_EFFORT || 'medium') as 'low' | 'medium' | 'high';

export interface AiRequest {
  stage: string; system: string; prompt: string; schema: Record<string, unknown>; maxOutputTokens?: number;
  /**
   * 'schema' (default): constrained output (output_config.format, the converted schema). 'json': ordinary JSON in the
   * answer text, for a schema too large for the API's grammar (the prompt carries its contract). Either way the answer
   * is checked against the full original schema by aiJson.
   */
  output?: 'schema' | 'json';
}
export interface AiAnswer { data: unknown; usage: Omit<UsageRecord, 'setId' | 'stage' | 'attempt' | 'cacheHit' | 'worstCaseUsd' | 'ms' | 'ok' | 'at' | 'error'> }
export interface AiTransport { via: 'api' | 'cli' | 'fake'; model: string; call(req: AiRequest, limits: { maxOutputTokens: number; budgetUsd: number }): Promise<AiAnswer> }

export class CostCapExceeded extends Error {}

/**
 * The Claude API refused the request itself (a 4xx other than rate limiting: an invalid schema or parameter, a bad key,
 * a request too large). Asking again cannot help, so it is not retried and no stage falls back to another design on
 * it: the stage fails with this message, which names the stage.
 */
export class ApiRequestError extends Error {
  constructor(readonly stage: string, readonly status: number, detail: string, readonly requestId?: string | null) {
    super(`the Claude API rejected the ${stage} request (HTTP ${status}): ${detail}${requestId ? ` [${requestId}]` : ''}`);
  }
}
const REQUEST_ERRORS = new Set([400, 401, 403, 404, 413, 422]);

/** An ordinary-JSON answer that holds no readable JSON object: a failed attempt (it may use the repair), with what it cost. */
export class MalformedAnswer extends Error {
  constructor(why: string, readonly usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, readonly answer?: AiAnswer['usage']) {
    super(`the answer was not valid JSON (${why})`);
  }
}
/** the answer's JSON object, or a MalformedAnswer carrying the spend */
function readJson(text: string, usage: MalformedAnswer['usage'], answer?: AiAnswer['usage']): Record<string, unknown> {
  try { return parseJsonAnswer(text); } catch (e) { throw new MalformedAnswer((e as Error).message, usage, answer); }
}
const scrub = (s: string) => s.replace(/sk-ant-[\w-]+/g, 'sk-ant-…');

export class CostLedger {
  calls: UsageRecord[] = [];
  constructor(readonly capUsd: number, readonly setId: string) {}
  get spentUsd() { return +this.calls.reduce((s, c) => s + c.costUsd, 0).toFixed(6); }
  get remainingUsd() { return Math.max(0, this.capUsd - this.spentUsd); }
  async record(r: UsageRecord) {
    this.calls.push(r);
    await studioDocs.put('studio-ai-usage', `u_${this.setId}_${String(this.calls.length).padStart(2, '0')}`, r);
    console.log(`[concepts ai] ${r.setId} ${r.stage}#${r.attempt} ${r.via} ${r.model} ${r.cacheHit ? 'cache' : `${r.inputTokens}+${r.cacheWriteTokens}w+${r.cacheReadTokens}r in / ${r.outputTokens} out`} $${r.costUsd.toFixed(4)} (${r.costBasis}; worst case $${r.worstCaseUsd.toFixed(3)}; spent $${this.spentUsd.toFixed(4)} of $${this.capUsd})${r.ok ? '' : ` FAILED: ${r.error}`}`);
  }
}

const priceOf = (model: string) => {
  const p = PRICES[model];
  if (!p) throw new CostCapExceeded(`No price is known for ${model}, so its cost cannot be capped; add it to PRICES.`);
  return p;
};
/** a conservative token count: three characters a token (English text runs nearer four) */
const tokensOf = (s: string) => Math.ceil(s.length / 3);
export function computedCost(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, cacheWrite: 'cacheWrite5m' | 'cacheWrite1h' = 'cacheWrite5m') {
  const p = priceOf(model);
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p[cacheWrite]) / 1e6;
}

/** The most one call can cost. The CLI may take two turns for a structured answer and writes a one-hour cache. */
export function worstCase(t: AiTransport, req: AiRequest, maxOutputTokens: number) {
  const p = priceOf(t.model);
  const input = tokensOf(req.system) + tokensOf(req.prompt) + tokensOf(JSON.stringify(req.schema)) + 2_000;
  const turns = t.via === 'cli' ? 2 : 1;
  return turns * (input * (t.via === 'cli' ? p.cacheWrite1h : p.input) + maxOutputTokens * p.output) / 1e6;
}

// ───────────────────────── transports ─────────────────────────
/** a temporary service error worth waiting out: rate limited, a 5xx (overloaded, a moment's credential validation failure), a dropped connection */
export function transientError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 429 || (status !== undefined && status >= 500) || /overloaded|credential validation failed|ECONNRESET|socket hang up/i.test(String((e as Error)?.message ?? e));
}

export function apiTransport(model = conceptModel()): AiTransport {
  const client = new Anthropic({ apiKey: config.anthropicKey, timeout: 300_000, maxRetries: 0 });
  return {
    via: 'api', model,
    async call(req, limits) {
      // a temporary service error (429, 5xx, "overloaded", a moment's credential validation failure) is waited out
      // twice (2 s, then 6 s) before it counts as a failed attempt: nothing was generated, so nothing is spent
      const ask = () => client.messages.stream({
        model, max_tokens: limits.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        // the API refuses some JSON-schema keywords: they are left out here and checked on the answer by aiJson;
        // an ordinary-JSON request sends no format at all (its contract is in the prompt)
        output_config: req.output === 'json' ? { effort: effort() } : { effort: effort(), format: { type: 'json_schema', schema: apiSchema(req.schema) } },
      }).finalMessage();
      let msg: Awaited<ReturnType<typeof ask>> | undefined;
      for (let i = 0; ; i++) {
        try { msg = await ask(); break; } catch (e) {
          if (e instanceof Anthropic.APIError && typeof e.status === 'number' && REQUEST_ERRORS.has(e.status)) throw new ApiRequestError(req.stage, e.status, scrub(e.message).slice(0, 300), e.requestID);
          if (!transientError(e) || i >= 2) throw e;
          await new Promise((r) => setTimeout(r, i === 0 ? 2000 : 6000));
        }
      }
      const u = msg.usage;
      const usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
      if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('the answer was cut off at the output limit'), { usage });
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { data: readJson(text, usage), usage: { via: 'api', model, ...usage, costUsd: computedCost(model, usage), costBasis: 'computed' } };
    },
  };
}

/** The signed-in Claude Code CLI (local demos without an API key): no tools, no MCP, no user settings, an empty folder. */
export function cliTransport(model = conceptModel()): AiTransport {
  return {
    via: 'cli', model,
    call(req, limits) {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-concepts-'));
      const env = { ...process.env };
      if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
      const args = ['-p', '--output-format', 'json', ...(req.output === 'json' ? [] : ['--json-schema', JSON.stringify(apiSchema(req.schema))]), '--system-prompt', req.system, '--model', model, '--effort', effort(),
        '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence', '--max-budget-usd', limits.budgetUsd.toFixed(4)];
      return new Promise((resolve, reject) => {
        const child = spawn(config.claudeCliPath, args, { cwd, env, windowsHide: true });
        let out = '', err = '';
        const timer = setTimeout(() => child.kill(), 420_000);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timer);
          fs.rmSync(cwd, { recursive: true, force: true });
          type R = { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
          let r: R;
          try { r = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300) || 'no output'}`)); }
          const u = r.usage ?? {};
          const usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
          const costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : computedCost(model, usage, 'cacheWrite1h');
          const answer = { via: 'cli' as const, model, ...usage, costUsd, costBasis: typeof r.total_cost_usd === 'number' ? 'reported' as const : 'computed' as const };
          if (req.output === 'json' && !r.is_error) {
            try { return resolve({ data: readJson(String(r.result ?? ''), usage, answer), usage: answer }); } catch (e) { return reject(e); }
          }
          if (r.is_error || r.structured_output == null) return reject(Object.assign(new Error(String(r.result || r.subtype || 'no structured output').slice(0, 300)), { answer }));
          resolve({ data: r.structured_output, usage: answer });
        });
        child.stdin.end(req.prompt);
      });
    },
  };
}

/** The transport for this environment: the API with a key, else the local CLI, else none (concepts use the fallback planner). */
export function defaultTransport(): AiTransport | null {
  const via = claudeVia();
  if (process.env.STUDIO_CONCEPT_AI === '0' || !via) return null;
  return via === 'api' ? apiTransport() : cliTransport();
}

// ───────────────────────── one validated, cached, capped request ─────────────────────────
export const AI_CACHE_VERSION = 'concepts-ai-1';

/**
 * Rewrite the fields that run over their limits, and nothing else: one small request listing each field, its limit and
 * its text. Each answer must be within its limit and is never cut; the map is by the field's place (e.g. $.thesis).
 * null when the rewrite is not usable (then the normal repair, if any is left, asks again in full).
 */
async function shortenFields(stage: string, long: LongField[], o: { transport: AiTransport; ledger: CostLedger }, notes: Record<string, string[]> = {}): Promise<Record<string, string> | null> {
  const places = long.map((f) => f.at);
  const r = await aiJson<{ fields: { at: string; text: string }[] }>({
    stage: `${stage}:shorten`, maxOutputTokens: 2000,
    system: 'You rewrite text fields that are over their length limit. Keep each one\'s meaning and every fact; say it in fewer words. Never add a fact, never cut a sentence off. Answer only with the JSON asked for.',
    prompt: `Rewrite each field within its limit (characters):\n${long.map((f) => `${f.at} (at most ${f.limit}; now ${f.text.length}${notes[f.at]?.length ? `; also: ${notes[f.at].map((m) => m.replace(/^[^:]+:\s*/, '')).join('; ')}` : ''}): ${JSON.stringify(f.text)}`).join('\n')}`,
    schema: { type: 'object', additionalProperties: false, required: ['fields'], properties: { fields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['at', 'text'], properties: { at: { type: 'string', enum: places }, text: { type: 'string' } } } } } },
  }, {
    transport: o.transport, ledger: o.ledger, retries: 0, fieldRepair: false,
    validate: (d) => long.flatMap((f) => { const x = d.fields.find((y) => y.at === f.at)?.text?.trim(); return !x ? [`${f.at}: missing`] : x.length > f.limit ? [`${f.at}: still ${x.length} characters, over ${f.limit}`] : []; }),
  }).catch((e) => { if (e instanceof ApiRequestError) throw e; return null; });
  return r?.data ? Object.fromEntries(r.data.fields.map((f) => [f.at, f.text.trim()])) : null;
}

export async function aiJson<T>(req: AiRequest, o: { transport: AiTransport; ledger: CostLedger; validate: (data: T) => string[]; retries?: number; /** false: no field-level rewrite of over-long texts (the rewrite's own request) */ fieldRepair?: boolean; /** planner-only notes (never shown on a site): over-long ones are cut locally at a word boundary, no AI call */ localShorten?: (path: (string | number)[]) => boolean }): Promise<{ data: T | null; attempts: number; errors: string[]; rejected: { attempt: number; errors: string[] }[]; last: T | null; /** notes cut locally, with their originals (for debugging) */ shortened: { at: string; original: string; shortened: string }[] }> {
  const retries = Math.max(0, Math.min(2, o.retries ?? conceptRetries()));
  const p = priceOf(o.transport.model);
  const maxOutputTokens = Math.min(req.maxOutputTokens ?? 24_000, p.maxOutput);
  let feedback = '';
  let lastErrors: string[] = [];
  const rejected: { attempt: number; errors: string[] }[] = [];
  let last: T | null = null;
  let fieldRepaired = false;
  const shortened: { at: string; original: string; shortened: string }[] = [];
  for (let attempt = 1; attempt <= 1 + retries; attempt++) {
    const r: AiRequest = { ...req, prompt: feedback ? `${req.prompt}\n\nYour previous answer was rejected:\n${feedback}\nAnswer again, fixing every point.` : req.prompt };
    // keyed by the attempt too: a retry is a new question even when its feedback repeats, and a rerun replays the same
    // sequence (rejected answers included) from the cache, so it reaches the same accepted plan at no cost
    const key = `cpt_${sha256(stableStringify({ v: AI_CACHE_VERSION, model: o.transport.model, via: o.transport.via === 'fake' ? 'fake' : 'claude', attempt, system: r.system, prompt: r.prompt, schema: r.schema })).slice(0, 40)}`;
    const base = { setId: o.ledger.setId, stage: req.stage, attempt, via: o.transport.via, model: o.transport.model, at: new Date().toISOString() };
    const cached = await studioDocs.get<{ data: T }>('studio-ai', key);
    let data: T | undefined;
    if (cached) {
      data = cached.data;
      await o.ledger.record({ ...base, cacheHit: true, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costBasis: 'cached', worstCaseUsd: 0, ms: 0, ok: true });
    } else {
      const worst = worstCase(o.transport, r, maxOutputTokens);
      if (worst > o.ledger.remainingUsd) {
        await o.ledger.record({ ...base, cacheHit: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costBasis: 'computed', worstCaseUsd: worst, ms: 0, ok: false, error: `not sent: its worst case ($${worst.toFixed(3)}) exceeds what is left of the cap ($${o.ledger.remainingUsd.toFixed(3)})` });
        throw new CostCapExceeded(`The ${req.stage} request was not sent: its worst case ($${worst.toFixed(3)}) exceeds what is left of the $${o.ledger.capUsd} cap ($${o.ledger.remainingUsd.toFixed(3)}).`);
      }
      const started = Date.now();
      try {
        const ans = await o.transport.call(r, { maxOutputTokens, budgetUsd: o.ledger.remainingUsd });
        data = ans.data as T;
        await o.ledger.record({ ...base, ...ans.usage, cacheHit: false, worstCaseUsd: worst, ms: Date.now() - started, ok: true });
        await studioDocs.put('studio-ai', key, { data, model: o.transport.model, at: base.at });
      } catch (e) {
        const spent = (e as { answer?: AiAnswer['usage']; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } });
        const usage = spent.answer ?? (spent.usage ? { via: o.transport.via, model: o.transport.model, ...spent.usage, costUsd: computedCost(o.transport.model, spent.usage), costBasis: 'computed' as const } : { via: o.transport.via, model: o.transport.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costBasis: 'computed' as const });
        lastErrors = [(e as Error).message.replace(/sk-ant-[\w-]+/g, 'sk-ant-…').slice(0, 300)];
        await o.ledger.record({ ...base, ...usage, cacheHit: false, worstCaseUsd: worst, ms: Date.now() - started, ok: false, error: lastErrors[0] });
        if (e instanceof ApiRequestError) throw e;
        feedback = e instanceof MalformedAnswer ? `- ${lastErrors[0]}: answer with one JSON object only, exactly as the contract describes, and nothing else` : `- the request failed: ${lastErrors[0]}`;
        rejected.push({ attempt, errors: lastErrors });
        continue;
      }
    }
    last = data as T;
    // the answer against the full original schema first (the limits the API was not sent), then the stage's own checks
    lastErrors = schemaErrors(req.schema, data);
    // only texts over their limits
    const long = lastErrors.length ? overLength(req.schema, data) : [];
    const lengthOnly = long.length > 0 && long.length === lastErrors.length;
    // every check that reads text (claims, treatments, grounding) runs on the ORIGINAL first: shortening can never hide one
    const other = lengthOnly ? o.validate(data as T) : [];
    if (lengthOnly && !other.length && o.localShorten && long.every((f) => o.localShorten!(f.path))) {
      // planner-only notes, never shown on a site: cut here at a word boundary, no AI call; the originals are kept
      data = structuredClone(data) as T;
      for (const f of long) { const to = shortenAtWord(f.text, f.limit); setAt(data, f.path, to); shortened.push({ at: f.at, original: f.text, shortened: to }); }
      last = data as T;
      rejected.push({ attempt, errors: [...lastErrors, `${long.length} planner note(s) shortened locally at a word boundary (originals kept): ${long.map((f) => f.at).join(', ')}`] });
      lastErrors = schemaErrors(req.schema, data);
    } else if (lengthOnly && o.fieldRepair !== false && !fieldRepaired) {
      // otherwise those fields alone are rewritten (once per request), never cut, then checked again; worth it only when
      // every problem is in those fields (their length, or a rule about the same text such as a label's word count)
      const placeOf = (at: string) => at.replace(/^\$\./, '').replace(/\.label$/, '');
      const notes: Record<string, string[]> = Object.fromEntries(long.map((f) => [f.at, other.filter((m) => m.startsWith(`${placeOf(f.at)}:`))]));
      const elsewhere = other.filter((m) => !long.some((f) => m.startsWith(`${placeOf(f.at)}:`)));
      if (elsewhere.length) lastErrors = [...lastErrors, ...other];
      else {
        fieldRepaired = true;
        const fixed = await shortenFields(req.stage, long, o, notes);
        if (fixed) {
          data = structuredClone(data) as T;
          for (const f of long) setAt(data, f.path, fixed[f.at]);
          last = data as T;
          rejected.push({ attempt, errors: [...lastErrors, `${long.length} field(s) rewritten within their limits: ${long.map((f) => f.at).join(', ')}`] });
          lastErrors = schemaErrors(req.schema, data);
        } else lastErrors = [...lastErrors, ...other]; // the rewrite could not be used: every problem is reported
      }
    } else if (other.length) lastErrors = [...lastErrors, ...other];
    if (!lastErrors.length) lastErrors = o.validate(data as T);
    if (!lastErrors.length) return { data: data as T, attempts: attempt, errors: [], rejected, last, shortened };
    rejected.push({ attempt, errors: lastErrors });
    feedback = lastErrors.slice(0, 20).map((x) => `- ${x}`).join('\n');
  }
  return { data: null, attempts: 1 + retries, errors: lastErrors, rejected, last, shortened };
}
