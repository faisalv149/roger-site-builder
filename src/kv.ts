/**
 * Upstash Redis over its REST API, used when Roger runs on Vercel (no lasting disk there). Vercel's Upstash
 * integration sets KV_REST_API_URL / KV_REST_API_TOKEN (older) or UPSTASH_REDIS_REST_URL / _TOKEN (newer).
 * Without them everything stays on the local disk (src/store.ts, src/files.ts).
 */
const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const kvEnabled = !!(url && token);

async function call<T>(body: unknown, route = ''): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${url}${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { result?: T; error?: string };
      if (!r.ok || j.error) throw Object.assign(new Error(`Redis: ${j.error || `HTTP ${r.status}`}`), { fatal: r.status < 500 });
      return j.result as T;
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 300 * attempt)); // network blip: Redis commands here are idempotent
    }
  }
}
const cmd = <T>(...args: (string | number)[]) => call<T>(args);

export const kv = {
  get: (key: string) => cmd<string | null>('GET', key),
  set: (key: string, value: string) => cmd<string>('SET', key, value),
  del: (...keys: string[]) => (keys.length ? cmd<number>('DEL', ...keys) : Promise.resolve(0)),
  async mget(keys: string[]): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) out.push(...(await cmd<(string | null)[]>('MGET', ...keys.slice(i, i + 100))));
    return out;
  },
  /** every key that starts with prefix (prefixes here never contain glob characters) */
  async keys(prefix: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await cmd<[string, string[]]>('SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 1000);
      found.push(...batch);
      cursor = String(next);
    } while (cursor !== '0');
    return found;
  },
};
