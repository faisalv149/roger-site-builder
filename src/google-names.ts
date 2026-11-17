import fs from 'node:fs';
import path from 'node:path';
/**
 * Google Maps Platform terms: a Place Photo's resource name ("places/<placeId>/photos/<name>") expires and may not be
 * stored or cached (place IDs may). Roger keeps listing photos only as references to their place in the listing, their
 * size and the fingerprint of the picture ("google-listing:<placeId>#<n>", resolved live). This is the last guard before
 * anything is written: any photo name still in a document is cut back to its place ID, and where it was found is
 * reported, so the write path that let it through can be fixed.
 */
export const GOOGLE_PHOTO_NAME = /places(?:\\*\/|%2f)([A-Za-z0-9_-]+)(?:\\*\/|%2f)photos(?:\\*\/|%2f)[A-Za-z0-9_-]+/gi;
/** what a photo name becomes when it reaches a write: its place, and nothing of the photo */
export const scrubbedName = (placeId: string) => `places/${placeId}/photos/(not kept)`;

export function hasGooglePhotoName(s: string): boolean { return new RegExp(GOOGLE_PHOTO_NAME.source, 'i').test(s); }

/** a copy of the document with every photo name cut back, and the field paths where names were found */
export function scrubGooglePhotoNames<T>(data: T): { data: T; found: string[] } {
  const found = new Set<string>();
  const walk = (v: unknown, at: string): unknown => {
    if (typeof v === 'string') { if (!hasGooglePhotoName(v)) return v; found.add(at.replace(/\.\d+(?=\.|$)/g, '[]') || '(root)'); return v.replace(GOOGLE_PHOTO_NAME, (_m, placeId: string) => scrubbedName(placeId)); }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}.${i}`));
    if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [String(walk(k, `${at}.[key]`)), walk(x, `${at}.${hasGooglePhotoName(k) ? "[redacted-key]" : k}`)]));
    return v;
  };
  const out = walk(data, '') as T;
  return { data: found.size ? out : data, found: [...found] };
}

/** the same guard for a written text (a page, a published file): any photo name cut back to its place */
export function forStorageText(s: string, where: string): string {
  if (!hasGooglePhotoName(s)) return s;
  console.warn(`[google-names] ${where}: Google photo names reached a written file and were not kept`);
  return s.replace(GOOGLE_PHOTO_NAME, (_m, placeId: string) => scrubbedName(placeId));
}

/** the guarded form for a write: scrubbed, with a warning naming the collection and fields (a write path to fix) */
export function forStorage<T>(data: T, where: string): T {
  const r = scrubGooglePhotoNames(data);
  if (r.found.length) console.warn(`[google-names] ${where}: Google photo names reached a write and were not kept (${r.found.slice(0, 5).join(', ')})`);
  return r.data;
}

/** All generated text writes use this boundary; binary images are passed through unchanged. */
export const isStoredText = (file: string) => /\.(json|html?|xml|txt|css|[cm]?js|svg|webmanifest|md|log)$/i.test(file);
export function storedBytes(file: string, data: Buffer): Buffer {
  return isStoredText(file) ? Buffer.from(forStorageText(data.toString('utf8'), path.basename(file))) : data;
}
export const writeStoredFile: typeof fs.writeFileSync = (file, data, options) => {
  const clean = typeof data === 'string' ? forStorageText(data, path.basename(String(file)))
    : Buffer.isBuffer(data) ? storedBytes(String(file), data) : data;
  fs.writeFileSync(file, clean, options);
};
/** Copying a generated version is also a new persistent write. */
export function copyStoredTree(from: string, to: string): void {
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) throw new Error('Generated copies cannot contain symbolic links');
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) copyStoredTree(path.join(from, f), path.join(to, f));
  } else writeStoredFile(to, fs.readFileSync(from));
}
