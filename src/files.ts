import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { remote } from './remote.js';

/**
 * Generated files (out/: sites, cards, reports). Builds write them to the local disk; on Vercel each finished folder
 * is also copied to Supabase Storage or Redis (src/remote.ts), because the next request may land on another server
 * instance with an empty disk. Reads try the local disk first.
 */
const MAX_BYTES = 900 * 1024; // Redis keeps one value per file; images are capped at 250 KB, so this only guards odd uploads
const rel = (abs: string) => path.relative(config.dirs.out, abs).split(path.sep).join('/');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.tmp') ? [] : [p];
  });
}

/** Copy a finished folder (e.g. out/sites/<slug>) to the remote store, replacing what a previous build left there. */
export async function persistDir(absDir: string): Promise<void> {
  if (!remote) return;
  const files = walk(absDir);
  const keep = new Set<string>();
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async (f) => {
      const data = fs.readFileSync(f);
      if (remote!.name === 'redis' && data.length > MAX_BYTES) { console.warn(`[files] ${rel(f)} is ${Math.round(data.length / 1024)} KB, too big for Redis; skipped`); return; }
      keep.add(rel(f));
      await remote!.putFile(rel(f), data, TYPES[path.extname(f).toLowerCase()]);
    }));
  }
  const stale = (await remote.listFiles(rel(absDir))).filter((p) => !keep.has(p));
  if (stale.length) await remote.delFiles(stale);
}

/** A file under out/ ("sites/<slug>/index.html"), from this disk or from the remote store. */
export async function readOut(relPath: string): Promise<Buffer | undefined> {
  const abs = path.join(config.dirs.out, relPath);
  if (!abs.startsWith(config.dirs.out + path.sep)) return undefined;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return fs.readFileSync(abs);
  return remote ? remote.getFile(relPath) : undefined;
}

/** Every file of a folder under out/ ("sites/<slug>"), as { file: path inside the folder, data }. */
export async function listOut(relDir: string): Promise<{ file: string; data: Buffer }[]> {
  const abs = path.join(config.dirs.out, relDir);
  const local = walk(abs);
  if (local.length) return local.map((f) => ({ file: path.relative(abs, f).split(path.sep).join('/'), data: fs.readFileSync(f) }));
  if (!remote) return [];
  const paths = await remote.listFiles(relDir);
  const out: { file: string; data: Buffer }[] = [];
  for (let i = 0; i < paths.length; i += 8) {
    const batch = await Promise.all(paths.slice(i, i + 8).map(async (p) => ({ file: p.slice(relDir.length + 1), data: await remote!.getFile(p) })));
    for (const b of batch) if (b.data?.length) out.push({ file: b.file, data: b.data });
  }
  return out;
}
