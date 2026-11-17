import fs from 'node:fs';
import path from 'node:path';
import { remote } from '../remote.js';
import { config } from '../config.js';
import { ALL_COLLECTIONS, readCollection } from '../store.js';
import { GOOGLE_PHOTO_NAME, scrubGooglePhotoNames } from '../google-names.js';

/**
 * A dry run of the cleanup of Google photo resource names kept by earlier versions (src/google-names.ts): what is
 * affected, by collection and field, in the document store (local files or the remote store) and in the written files
 * (site records, pages, reports, concept sets, published copies). It reads only: nothing is changed, moved or deleted.
 */
export interface NamesAuditRow { where: string; scanned: number; affected: number; names: number; fields: string[]; examples: string[] }
export interface NamesAudit { dryRun: true; at: string; store: NamesAuditRow[]; files: NamesAuditRow[]; totals: { documents: number; files: number; names: number } }

const countNames = (s: string) => (s.match(new RegExp(GOOGLE_PHOTO_NAME.source, 'gi')) ?? []).length;
const label = (d: unknown) => { const o = d as Record<string, unknown>; return String(o?.id ?? o?.businessKey ?? o?.slug ?? o?.from ?? '?'); };

/** the folders of written files that can carry a business record or a page */
const FILE_ROOTS = () => [
  { where: 'out (all generated files)', dir: config.dirs.out },
  { where: 'data/themes (uploaded themes)', dir: config.dirs.customThemes },
];
const TEXT = /\.(json|html?|xml|txt|css|[cm]?js|svg|webmanifest|md|log)$/i;

function* walkFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (TEXT.test(e.name)) yield full;
  }
}

export async function auditGooglePhotoNames(): Promise<NamesAudit> {
  const store: NamesAuditRow[] = [];
  for (const col of ALL_COLLECTIONS) {
    const docs = await readCollection(col);
    const row: NamesAuditRow = { where: col, scanned: docs.length, affected: 0, names: 0, fields: [], examples: [] };
    const fields = new Set<string>();
    for (const d of docs) {
      const r = scrubGooglePhotoNames(d);
      if (!r.found.length) continue;
      row.affected++;
      row.names += countNames(JSON.stringify(d));
      r.found.forEach((f) => fields.add(f));
      if (row.examples.length < 3) row.examples.push(label(d));
    }
    row.fields = [...fields];
    if (row.scanned) store.push(row);
  }
  const files: NamesAuditRow[] = [];
  for (const root of FILE_ROOTS()) {
    const row: NamesAuditRow = { where: root.where, scanned: 0, affected: 0, names: 0, fields: [], examples: [] };
    const kinds = new Set<string>();
    for (const file of walkFiles(root.dir)) {
      row.scanned++;
      const text = fs.readFileSync(file, 'utf8');
      const n = countNames(text);
      if (!n) continue;
      row.affected++;
      row.names += n;
      kinds.add(path.basename(file));
      if (row.examples.length < 3) row.examples.push(path.relative(config.dirs.out, file).split(path.sep).join('/'));
    }
    row.fields = [...kinds];
    if (row.scanned) files.push(row);
  }
  // Remote generated files may have no local copy. Read them directly, never restore or rewrite them.
  if (remote) {
    const row: NamesAuditRow = { where: `remote files (${remote.name})`, scanned: 0, affected: 0, names: 0, fields: [], examples: [] };
    for (const file of await remote.listFiles('')) {
      if (!TEXT.test(file)) continue;
      const bytes = await remote.getFile(file);
      if (!bytes) throw new Error(`Audit incomplete: remote file could not be read`);
      row.scanned++;
      const n = countNames(bytes.toString('utf8'));
      if (n) { row.affected++; row.names += n; if (row.examples.length < 3) row.examples.push(file); }
    }
    files.push(row);
  }
  return { dryRun: true, at: new Date().toISOString(), store, files, totals: { documents: store.reduce((s, r) => s + r.affected, 0), files: files.reduce((s, r) => s + r.affected, 0), names: [...store, ...files].reduce((s, r) => s + r.names, 0) } };
}
