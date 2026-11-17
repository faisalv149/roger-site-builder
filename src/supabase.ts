/**
 * Supabase as Roger's storage on Vercel: records in a Postgres table (roger_docs, via the REST API) and generated
 * files in a private Storage bucket (roger). Uses the service role key, server-side only; it never reaches a browser.
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL, as Vercel's Supabase integration sets it) and
 * SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). Create the table once with supabase/schema.sql.
 */
/**
 * The project's API origin, whatever was pasted: "https://<ref>.supabase.co" as is; with a path ("…/rest/v1/") only its
 * origin; a dashboard link ("https://supabase.com/dashboard/project/<ref>…") as that project's API origin.
 */
function apiOrigin(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const ref = u.hostname === 'supabase.com' || u.hostname.endsWith('.supabase.com') ? u.pathname.match(/\/project\/([a-z0-9]{10,40})/i)?.[1] : undefined;
    return ref ? `https://${ref}.supabase.co` : u.origin;
  } catch { return v.replace(/\/$/, ''); }
}
const url = apiOrigin(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const BUCKET = 'roger';
const TABLE = 'roger_docs';

export const supabaseEnabled = !!(url && key);

async function call(route: string, init: RequestInit & { ok404?: boolean } = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${url}${route}`, {
        ...init,
        headers: { apikey: key, authorization: `Bearer ${key}`, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok || (init.ok404 && (r.status === 404 || r.status === 400))) return r;
      const body = await r.text();
      const msg = (() => { try { const j = JSON.parse(body); return j.message || j.error || body; } catch { return body; } })();
      if (/relation .*roger_docs.* does not exist|Could not find the table/i.test(msg)) throw Object.assign(new Error('Supabase: table roger_docs is missing. Run supabase/schema.sql once in the Supabase SQL editor.'), { fatal: true });
      throw Object.assign(new Error(`Supabase ${r.status}: ${String(msg).slice(0, 200)}`), { fatal: r.status < 500 });
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 300 * attempt)); // network blip; these calls are idempotent
    }
  }
}
const json = { 'content-type': 'application/json' };
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

// ── records: one row per (collection, id), the document as jsonb ──
export async function sbGetDoc(col: string, id: string): Promise<string | null> {
  const r = await call(`/rest/v1/${TABLE}?collection=eq.${encodeURIComponent(col)}&id=eq.${encodeURIComponent(id)}&select=data`);
  const rows = (await r.json()) as { data: unknown }[];
  return rows.length ? JSON.stringify(rows[0].data) : null;
}

export async function sbPutDoc(col: string, id: string, doc: string): Promise<void> {
  await call(`/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { ...json, prefer: 'resolution=merge-duplicates,return=minimal' }, // upsert on the primary key
    body: JSON.stringify({ collection: col, id, data: JSON.parse(doc), updated_at: new Date().toISOString() }),
  });
}

/**
 * Create a record only if none exists with this key (no upsert): true when this call created it, false when it was
 * already there. The database's primary key makes it atomic, so two workers can never both create it (a claim).
 */
export async function sbCreateDoc(col: string, id: string, doc: string): Promise<boolean> {
  try {
    await call(`/rest/v1/${TABLE}`, { method: 'POST', headers: { ...json, prefer: 'return=minimal' }, body: JSON.stringify({ collection: col, id, data: JSON.parse(doc), updated_at: new Date().toISOString() }) });
    return true;
  } catch (e) {
    if (/Supabase 409|duplicate key/i.test((e as Error).message)) return false;
    throw e;
  }
}

export async function sbListDocs(col: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await call(`/rest/v1/${TABLE}?collection=eq.${encodeURIComponent(col)}&select=data&order=id`, { headers: { range: `${from}-${from + 999}` } });
    const rows = (await r.json()) as { data: unknown }[];
    out.push(...rows.map((x) => JSON.stringify(x.data)));
    if (rows.length < 1000) return out;
  }
}

export async function sbDelDoc(col: string, id: string): Promise<void> {
  await call(`/rest/v1/${TABLE}?collection=eq.${encodeURIComponent(col)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
}

// ── files: a private bucket; the server streams them out through /sites, /cards, /reports ──
let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ||= call('/storage/v1/bucket', { method: 'POST', headers: json, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }), ok404: true })
    .then(async (r) => {
      if (r.ok) return;
      const t = await r.text(); // "already exists" comes back as 400/409
      if (!/exist|duplicate/i.test(t)) throw new Error(`Supabase storage: could not create bucket "${BUCKET}": ${t.slice(0, 200)}`);
    })
    .catch((e) => { bucketReady = null; throw e; });
  return bucketReady;
}

export async function sbPutFile(path: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  await ensureBucket();
  await call(`/storage/v1/object/${BUCKET}/${enc(path)}`, { method: 'POST', headers: { 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'max-age=60' }, body: new Uint8Array(data) });
}

export async function sbGetFile(path: string): Promise<Buffer | undefined> {
  const r = await call(`/storage/v1/object/authenticated/${BUCKET}/${enc(path)}`, { ok404: true });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : undefined;
}

/** every file path under prefix ("sites/<slug>"), including subfolders */
export async function sbListFiles(prefix: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 1000) {
      const r = await call(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: json, body: JSON.stringify({ prefix: dir, limit: 1000, offset }) });
      const items = (await r.json()) as { name: string; id: string | null }[];
      for (const it of items) {
        const p = dir ? `${dir}/${it.name}` : it.name;
        if (it.id === null) await walk(p); else files.push(p); // folders have no id
      }
      if (items.length < 1000) return;
    }
  };
  await walk(prefix.replace(/\/$/, ''));
  return files;
}

export async function sbDelFiles(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: json, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
  }
}
