import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { kv, kvEnabled } from './kv.js';

/**
 * Generated files (out/: sites, cards, reports). Builds write them to the local disk; on Vercel (Upstash configured)
 * each finished folder is also copied to Redis as "file:<path under out/>" (base64), because the next request may
 * land on another server instance with an empty disk. Reads try the local disk first.
 */
const MAX_BYTES = 900 * 1024; // one Redis value per file; images are capped at 250 KB, so this only guards odd uploads
const rel = (abs: string) => path.relative(config.dirs.out, abs).split(path.sep).join('/');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.tmp') ? [] : [p];
  });
}

/** Copy a finished folder (e.g. out/sites/<slug>) to Redis, replacing what a previous build left there. */
export async function persistDir(absDir: string): Promise<void> {
  if (!kvEnabled) return;
  const prefix = `file:${rel(absDir)}/`;
  const files = walk(absDir);
  const keep = new Set<string>();
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async (f) => {
      const data = fs.readFileSync(f);
      if (data.length > MAX_BYTES) { console.warn(`[files] ${rel(f)} is ${Math.round(data.length / 1024)} KB, too big to store; skipped`); return; }
      const key = `file:${rel(f)}`;
      keep.add(key);
      await kv.set(key, data.toString('base64'));
    }));
  }
  const stale = (await kv.keys(prefix)).filter((k) => !keep.has(k));
  await kv.del(...stale);
}

/** A file under out/ ("sites/<slug>/index.html"), from this disk or from Redis. */
export async function readOut(relPath: string): Promise<Buffer | undefined> {
  const abs = path.join(config.dirs.out, relPath);
  if (!abs.startsWith(config.dirs.out + path.sep)) return undefined;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return fs.readFileSync(abs);
  if (!kvEnabled) return undefined;
  const v = await kv.get(`file:${relPath}`);
  return v ? Buffer.from(v, 'base64') : undefined;
}

/** Every file of a folder under out/ ("sites/<slug>"), as { file: path inside the folder, data }. */
export async function listOut(relDir: string): Promise<{ file: string; data: Buffer }[]> {
  const abs = path.join(config.dirs.out, relDir);
  const local = walk(abs);
  if (local.length) return local.map((f) => ({ file: path.relative(abs, f).split(path.sep).join('/'), data: fs.readFileSync(f) }));
  if (!kvEnabled) return [];
  const keys = await kv.keys(`file:${relDir}/`);
  const vals = await kv.mget(keys);
  return keys.map((k, i) => ({ file: k.slice(`file:${relDir}/`.length), data: Buffer.from(vals[i] || '', 'base64') })).filter((f) => f.data.length);
}
