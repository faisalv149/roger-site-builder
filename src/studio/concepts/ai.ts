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

export interface AiRequest { stage: string; system: string; prompt: string; schema: Record<string, unknown>; maxOutputTokens?: number }
export interface AiAnswer { data: unknown; usage: Omit<UsageRecord, 'setId' | 'stage' | 'attempt' | 'cacheHit' | 'worstCaseUsd' | 'ms' | 'ok' | 'at' | 'error'> }
export interface AiTransport { via: 'api' | 'cli' | 'fake'; model: string; call(req: AiRequest, limits: { maxOutputTokens: number; budgetUsd: number }): Promise<AiAnswer> }

export class CostCapExceeded extends Error {}

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
export function apiTransport(model = conceptModel()): AiTransport {
  const client = new Anthropic({ apiKey: config.anthropicKey, timeout: 300_000, maxRetries: 0 });
  return {
    via: 'api', model,
    async call(req, limits) {
      const msg = await client.messages.stream({
        model, max_tokens: limits.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: effort(), format: { type: 'json_schema', schema: req.schema } },
      }).finalMessage();
      const u = msg.usage;
      const usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
      if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('the answer was cut off at the output limit'), { usage });
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { data: JSON.parse(text), usage: { via: 'api', model, ...usage, costUsd: computedCost(model, usage), costBasis: 'computed' } };
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
      const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(req.schema), '--system-prompt', req.system, '--model', model, '--effort', effort(),
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

export async function aiJson<T>(req: AiRequest, o: { transport: AiTransport; ledger: CostLedger; validate: (data: T) => string[]; retries?: number }): Promise<{ data: T | null; attempts: number; errors: string[]; rejected: { attempt: number; errors: string[] }[]; last: T | null }> {
  const retries = Math.max(0, Math.min(2, o.retries ?? conceptRetries()));
  const p = priceOf(o.transport.model);
  const maxOutputTokens = Math.min(req.maxOutputTokens ?? 24_000, p.maxOutput);
  let feedback = '';
  let lastErrors: string[] = [];
  const rejected: { attempt: number; errors: string[] }[] = [];
  let last: T | null = null;
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
        feedback = `- the request failed: ${lastErrors[0]}`;
        rejected.push({ attempt, errors: lastErrors });
        continue;
      }
    }
    last = data as T;
    lastErrors = o.validate(data as T);
    if (!lastErrors.length) return { data: data as T, attempts: attempt, errors: [], rejected, last };
    rejected.push({ attempt, errors: lastErrors });
    feedback = lastErrors.slice(0, 20).map((x) => `- ${x}`).join('\n');
  }
  return { data: null, attempts: 1 + retries, errors: lastErrors, rejected, last };
}
