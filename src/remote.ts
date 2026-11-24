import { kv, kvEnabled } from './kv.js';
import { sbCreateDoc, sbDelDoc, sbDelFiles, sbGetDoc, sbGetFile, sbListDocs, sbListFiles, sbPutDoc, sbPutFile, supabaseEnabled } from './supabase.js';

/**
 * Lasting storage for when the local disk doesn't last (Vercel): Supabase if configured, else Upstash Redis,
 * else none (null: everything stays on the local disk). Used by src/store.ts (records) and src/files.ts (files).
 */
export interface Remote {
  name: 'supabase' | 'redis';
  getDoc(col: string, id: string): Promise<string | null>;
  putDoc(col: string, id: string, json: string): Promise<void>;
  listDocs(col: string): Promise<string[]>;
  delDoc(col: string, id: string): Promise<void>;
  /** create only if absent (atomic where the store allows it): true when this call created it */
  createDoc(col: string, id: string, json: string): Promise<boolean>;
  putFile(path: string, data: Buffer, contentType?: string): Promise<void>;
  getFile(path: string): Promise<Buffer | undefined>;
  /** full paths of every file under prefix ("sites/<slug>") */
  listFiles(prefix: string): Promise<string[]>;
  delFiles(paths: string[]): Promise<void>;
}

const supabase: Remote = {
  name: 'supabase',
  getDoc: sbGetDoc,
  putDoc: sbPutDoc,
  listDocs: sbListDocs,
  delDoc: sbDelDoc,
  createDoc: sbCreateDoc,
  putFile: sbPutFile,
  getFile: sbGetFile,
  listFiles: sbListFiles,
  delFiles: sbDelFiles,
};

// Redis keeps records as "<collection>:<id>" and files as "file:<path>" (base64)
const redis: Remote = {
  name: 'redis',
  getDoc: (col, id) => kv.get(`${col}:${id}`),
  putDoc: async (col, id, json) => { await kv.set(`${col}:${id}`, json); },
  listDocs: async (col) => (await kv.mget(await kv.keys(`${col}:`))).filter(Boolean) as string[],
  delDoc: async (col, id) => { await kv.del(`${col}:${id}`); },
  // (Redis here has no set-if-absent: a read then a write; claims are atomic only on Supabase or the local disk)
  createDoc: async (col, id, json) => { if (await kv.get(`${col}:${id}`)) return false; await kv.set(`${col}:${id}`, json); return true; },
  putFile: async (path, data) => { await kv.set(`file:${path}`, data.toString('base64')); },
  getFile: async (path) => { const v = await kv.get(`file:${path}`); return v ? Buffer.from(v, 'base64') : undefined; },
  listFiles: async (prefix) => (await kv.keys(`file:${prefix ? prefix.replace(/\/$/, '') + '/' : ''}`)).map((k) => k.slice('file:'.length)),
  delFiles: async (paths) => { await kv.del(...paths.map((p) => `file:${p}`)); },
};

// Automatic on Vercel. Elsewhere only with REMOTE_STORAGE=1: a laptop with Supabase keys in .env must not mix its
// localhost builds into the live site's history.
const wanted = !!process.env.VERCEL || process.env.REMOTE_STORAGE === '1';
const base: Remote | null = !wanted ? null : supabaseEnabled ? supabase : kvEnabled ? redis : null;
/**
 * ROGER_STORE_NAMESPACE (the beta: "beta"): every record's collection and every file's path is prefixed, so a second
 * deployment can share one datastore with production without ever reading or overwriting production's records.
 */
const ns = (process.env.ROGER_STORE_NAMESPACE || '').replace(/[^a-z0-9-]/gi, '');
const namespaced = (r: Remote, n: string): Remote => {
  const c = (col: string) => `${n}:${col}`, f = (p: string) => `${n}/${p}`;
  return {
    name: r.name,
    getDoc: (col, id) => r.getDoc(c(col), id), putDoc: (col, id, j) => r.putDoc(c(col), id, j), listDocs: (col) => r.listDocs(c(col)),
    delDoc: (col, id) => r.delDoc(c(col), id), createDoc: (col, id, j) => r.createDoc(c(col), id, j),
    putFile: (p, d, t) => r.putFile(f(p), d, t), getFile: (p) => r.getFile(f(p)),
    listFiles: async (prefix) => (await r.listFiles(f(prefix))).map((p) => p.slice(n.length + 1)), delFiles: (ps) => r.delFiles(ps.map(f)),
  };
};
export const remote: Remote | null = base && ns ? namespaced(base, ns) : base;
