import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client: Anthropic | null = null;
let cliOk: boolean | undefined;

function cliAvailable() {
  if (cliOk === undefined) {
    const r = spawnSync(config.claudeCliPath, ['--version'], { timeout: 15_000, windowsHide: true, encoding: 'utf8' });
    cliOk = r.status === 0;
    if (!cliOk) console.warn(`[claude] CLAUDE_CLI=1 but "${config.claudeCliPath} --version" failed; using templates`);
  }
  return cliOk;
}

/** Which backend answers: the Claude API (key), the local Claude Code CLI (its own sign-in, for local demos), or none (templates). */
export const claudeVia = (): 'api' | 'cli' | null => (config.anthropicKey ? 'api' : config.claudeCli && cliAvailable() ? 'cli' : null);
export const claudeEnabled = () => claudeVia() !== null;

let keyCheck: Promise<string> | null = null;
/**
 * API key works and the model exists? One free model-info call per server instance (no tokens). For /api/health:
 * "ok", or Anthropic's status and error type (e.g. "401 authentication_error"), never the key itself.
 */
export function claudeKeyStatus(): Promise<string> {
  const k = config.anthropicKey;
  const shape = !k.startsWith('sk-ant-') ? ' (key does not start with sk-ant-)' : /\s|["']/.test(k) ? ' (key contains spaces or quotes)' : '';
  keyCheck ||= fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(config.anthropicModel)}`, {
    headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(10_000),
  }).then(async (r) => {
    if (r.ok) return 'ok';
    const j = (await r.json().catch(() => ({}))) as { error?: { type?: string } };
    return `${r.status} ${j.error?.type || 'error'}${shape}`;
  }).catch(() => { keyCheck = null; return 'unreachable'; }); // retry next time if it was the network
  return keyCheck;
}

/**
 * Some models (the newest ones) refuse a forced tool call ("tool_choice: type tool ... not supported for this model").
 * Learn that from the first refusal, remember it per model, and ask the model to call the tool on its own instead.
 */
const forcedToolUnsupported = new Set<string>();
export const claudeToolMode = (): 'forced' | 'auto' => (forcedToolUnsupported.has(config.anthropicModel) ? 'auto' : 'forced');
const refusesForcedTool = (e: unknown) => /tool_choice/i.test((e as Error)?.message ?? '') && /not supported|unsupported|invalid/i.test((e as Error)?.message ?? '');

/** One request that returns the tool call, with the forced-tool fallback. */
async function toolRequest(opts: { system: string; toolName: string; toolDescription: string; schema: Record<string, unknown>; maxTokens: number; content: unknown; requestOpts?: { timeout?: number; maxRetries?: number } }) {
  const make = (forced: boolean) => getClient().messages.create({
    model: config.anthropicModel,
    max_tokens: opts.maxTokens,
    system: forced ? opts.system : `${opts.system}\n\nRespond only by calling the ${opts.toolName} tool, with no other text.`,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema as any }],
    tool_choice: forced ? { type: 'tool', name: opts.toolName } : { type: 'auto' },
    messages: [{ role: 'user', content: opts.content as any }],
  }, opts.requestOpts);
  if (!forcedToolUnsupported.has(config.anthropicModel)) {
    try { return await make(true); } catch (e) {
      if (!refusesForcedTool(e)) throw e;
      forcedToolUnsupported.add(config.anthropicModel);
      console.warn(`[claude] ${config.anthropicModel} doesn't accept a forced tool call; asking it to call the tool itself`);
    }
  }
  return make(false);
}

function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

/**
 * Every Claude call the builder makes, as it finishes: what kind, which tool, how it went and what it cost when that is
 * known (the CLI reports its own cost estimate; the API reports tokens, priced elsewhere). Listeners only observe.
 */
export interface ClaudeCallRecord { at: string; kind: 'json' | 'vision'; tool: string; via: 'api' | 'cli'; model: string; ms: number; ok: boolean; inputTokens?: number; outputTokens?: number; costUsd?: number; error?: string }
const callListeners = new Set<(c: ClaudeCallRecord) => void>();
export function onClaudeCall(fn: (c: ClaudeCallRecord) => void): () => void { callListeners.add(fn); return () => { callListeners.delete(fn); }; }
function recordCall(c: Omit<ClaudeCallRecord, 'at' | 'model'>) { const rec = { at: new Date().toISOString(), model: config.anthropicModel, ...c }; for (const l of callListeners) { try { l(rec); } catch { /* an observer never breaks a call */ } } }
const usageOf = (res: { usage?: { input_tokens?: number; output_tokens?: number } }) => ({ inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens });

export type ClaudeOutcome<T> = { ok: true; data: T; ms: number; via: 'api' | 'cli' } | { ok: false; ms: number; via: 'api' | 'cli' | null; error: string };

/**
 * Ask Claude for structured JSON by forcing a single tool call, and say what happened: the answer, or why there
 * isn't one (no key, the request failed, the answer wasn't a tool call). Never throws.
 */
export async function claudeJsonDetailed<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<ClaudeOutcome<T>> {
  const via = claudeVia();
  if (!via) return { ok: false, ms: 0, via: null, error: config.anthropicKey ? 'Claude is unavailable' : 'no ANTHROPIC_API_KEY, and the local Claude CLI is off' };
  const started = Date.now();
  try {
    if (via === 'cli') {
      const r = await cliJson(`${opts.system}

Answer with: ${opts.toolDescription}`, opts.prompt, opts.schema);
      recordCall({ kind: 'json', tool: opts.toolName, via, ms: Date.now() - started, ok: true, costUsd: r.costUsd });
      return { ok: true, data: r.output as T, ms: Date.now() - started, via };
    }
    const res = await toolRequest({ system: opts.system, toolName: opts.toolName, toolDescription: opts.toolDescription, schema: opts.schema, maxTokens: opts.maxTokens ?? 2000, content: opts.prompt });
    const block = res.content.find((c) => c.type === 'tool_use');
    recordCall({ kind: 'json', tool: opts.toolName, via, ms: Date.now() - started, ok: !!block && block.type === 'tool_use', ...usageOf(res) });
    if (!block || block.type !== 'tool_use') return { ok: false, ms: Date.now() - started, via, error: `Claude answered without the ${opts.toolName} tool call (stop reason: ${res.stop_reason})` };
    return { ok: true, data: block.input as T, ms: Date.now() - started, via };
  } catch (e) {
    const error = (e as Error).message.replace(/sk-ant-[w-]+/g, 'sk-ant-…').slice(0, 240);
    console.warn(`[claude ${via}] ${opts.toolName} failed: ${error}`);
    recordCall({ kind: 'json', tool: opts.toolName, via, ms: Date.now() - started, ok: false, error, costUsd: (e as { costUsd?: number }).costUsd });
    return { ok: false, ms: Date.now() - started, via, error };
  }
}

/** The same call for callers that only want the answer or null (every caller can fall back to templates). */
export async function claudeJson<T>(opts: Parameters<typeof claudeJsonDetailed<T>>[0]): Promise<{ data: T; ms: number } | null> {
  const r = await claudeJsonDetailed<T>(opts);
  return r.ok ? { data: r.data, ms: r.ms } : null;
}

/**
 * Structured JSON about images (small JPEG thumbnails). API only: the local CLI mode runs without tools, so it
 * can't read images; callers fall back to deterministic rules. Returns null on any failure or timeout.
 */
export async function claudeVisionJson<T>(opts: {
  system: string;
  prompt: string;
  images: Buffer[];
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ data: T; ms: number } | null> {
  const via = claudeVia();
  if (!via || !opts.images.length) return null;
  const started = Date.now();
  if (via === 'cli') {
    // the local Claude Code CLI takes images through its stream-json input (same prompt and schema as the API)
    try {
      const r = await cliVisionJson(opts.system, opts.prompt, opts.images, opts.schema, Math.max(opts.timeoutMs ?? 20_000, 120_000));
      recordCall({ kind: 'vision', tool: opts.toolName, via, ms: Date.now() - started, ok: true, costUsd: r.costUsd });
      return { data: r.output as T, ms: Date.now() - started };
    } catch (e) {
      console.warn(`[claude cli] ${opts.toolName} failed: ${(e as Error).message}`);
      recordCall({ kind: 'vision', tool: opts.toolName, via, ms: Date.now() - started, ok: false, error: (e as Error).message.slice(0, 240), costUsd: (e as { costUsd?: number }).costUsd });
      return null;
    }
  }
  try {
    const content = [
      ...opts.images.flatMap((b, i) => [
        { type: 'text' as const, text: `Photo ${i}:` },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b.toString('base64') } },
      ]),
      { type: 'text' as const, text: opts.prompt },
    ];
    const res = await toolRequest({ system: opts.system, toolName: opts.toolName, toolDescription: opts.toolDescription, schema: opts.schema, maxTokens: 1000, content, requestOpts: { timeout: opts.timeoutMs ?? 20_000, maxRetries: 0 } });
    const block = res.content.find((c) => c.type === 'tool_use');
    recordCall({ kind: 'vision', tool: opts.toolName, via, ms: Date.now() - started, ok: !!block && block.type === 'tool_use', ...usageOf(res) });
    if (!block || block.type !== 'tool_use') return null;
    return { data: block.input as T, ms: Date.now() - started };
  } catch (e) {
    console.warn(`[claude api] ${opts.toolName} failed: ${(e as Error).message}`);
    recordCall({ kind: 'vision', tool: opts.toolName, via, ms: Date.now() - started, ok: false, error: (e as Error).message.slice(0, 240) });
    return null;
  }
}

/** `claude -p` with pictures: one stream-json user message (each image numbered), the same isolation as cliJson. */
function cliVisionJson(system: string, prompt: string, images: Buffer[], schema: Record<string, unknown>, timeoutMs: number): Promise<{ output: unknown; costUsd?: number }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-claude-'));
  const env = { ...process.env };
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(schema), '--system-prompt', system, '--model', config.anthropicModel,
    '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence'];
  const content = [
    ...images.flatMap((b, i) => [{ type: 'text', text: `Photo ${i}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]),
    { type: 'text', text: prompt },
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(config.claudeCliPath, args, { cwd, env, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      const result = out.split('\n').map((l) => { try { return JSON.parse(l) as { type?: string; is_error?: boolean; result?: string; subtype?: string; structured_output?: unknown; total_cost_usd?: number }; } catch { return undefined; } }).find((l) => l?.type === 'result');
      if (!result) return reject(new Error(`exit ${code}: ${(err || out).trim().slice(0, 300) || 'no output'}`));
      const costUsd = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined;
      if (result.is_error || result.structured_output == null) return reject(Object.assign(new Error(String(result.result || result.subtype || 'no structured output').slice(0, 300)), { costUsd }));
      resolve({ output: result.structured_output, costUsd });
    });
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
  });
}

/**
 * One `claude -p` run with schema-validated output. Prompts carry scraped website text and reviews, so the
 * CLI gets no tools, no MCP servers and no user settings (hooks), and runs in an empty temp folder.
 */
function cliJson(system: string, prompt: string, schema: Record<string, unknown>, timeoutMs = 120_000): Promise<{ output: unknown; costUsd?: number }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roger-claude-'));
  const env = { ...process.env };
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY; // dotenv sets it to "" when the .env line is blank
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', system, '--model', config.anthropicModel,
    '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence'];
  return new Promise((resolve, reject) => {
    const child = spawn(config.claudeCliPath, args, { cwd, env, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      let r: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown; total_cost_usd?: number };
      try { r = JSON.parse(out); } catch { return reject(new Error(`exit ${code}: ${(err || out).trim().slice(0, 300) || 'no output'}`)); }
      const costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : undefined;
      if (r.is_error || r.structured_output == null) return reject(Object.assign(new Error(String(r.result || r.subtype || 'no structured output').slice(0, 300)), { costUsd }));
      resolve({ output: r.structured_output, costUsd });
    });
    child.stdin.end(prompt);
  });
}
