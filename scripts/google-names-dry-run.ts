// Dry run of the cleanup of Google photo resource names kept by earlier versions: which collections, fields and files
// are affected, and how many. Reads only; changes nothing. Usage: npm run audit:google-names [-- --json]
import 'dotenv/config';
import { auditGooglePhotoNames } from '../src/maintenance/google-names-audit.js';

if (process.argv.slice(2).some((arg) => arg !== '--json')) throw new Error('Read-only audit: only --json is supported; no apply/cleanup mode exists.');
const a = await auditGooglePhotoNames();
if (process.argv.includes('--json')) { console.log(JSON.stringify(a, null, 2)); process.exit(0); }
console.log(`Google photo names kept (dry run, ${a.at}): nothing was changed.\n`);
for (const [title, rows] of [['Document store', a.store], ['Written files', a.files]] as const) {
  console.log(title);
  for (const r of rows) console.log(`  ${r.where.padEnd(46)} ${String(r.affected).padStart(4)} of ${String(r.scanned).padEnd(5)} affected, ${r.names} name(s)${r.fields.length ? `  fields: ${r.fields.slice(0, 4).join(', ')}${r.fields.length > 4 ? ', …' : ''}` : ''}`);
}
console.log(`\nTotal: ${a.totals.documents} document(s) and ${a.totals.files} file(s), ${a.totals.names} photo name(s).`);
process.exit(0);
