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

function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

/**
 * Ask Claude for structured JSON by forcing a single tool call.
 * Returns null (never throws) so every caller can fall back to deterministic templates.
 */
export async function claudeJson<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<{ data: T; ms: number } | null> {
  const via = claudeVia();
  if (!via) return null;
  const started = Date.now();
  try {
    if (via === 'cli') {
      const data = (await cliJson(`${opts.system}\n\nAnswer with: ${opts.toolDescription}`, opts.prompt, opts.schema)) as T;
      return { data, ms: Date.now() - started };
    }
    const res = await getClient().messages.create({
      model: config.anthropicModel,
      max_tokens: opts.maxTokens ?? 2000,
      system: opts.system,
      tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema as any }],
      tool_choice: { type: 'tool', name: opts.toolName },
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const block = res.content.find((c) => c.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return null;
    return { data: block.input as T, ms: Date.now() - started };
  } catch (e) {
    console.warn(`[claude ${via}] ${opts.toolName} failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * One `claude -p` run with schema-validated output. Prompts carry scraped website text and reviews, so the
 * CLI gets no tools, no MCP servers and no user settings (hooks), and runs in an empty temp folder.
 */
function cliJson(system: string, prompt: string, schema: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
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
      let r: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
      try { r = JSON.parse(out); } catch { return reject(new Error(`exit ${code}: ${(err || out).trim().slice(0, 300) || 'no output'}`)); }
      if (r.is_error || r.structured_output == null) return reject(new Error(String(r.result || r.subtype || 'no structured output').slice(0, 300)));
      resolve(r.structured_output);
    });
    child.stdin.end(prompt);
  });
}
