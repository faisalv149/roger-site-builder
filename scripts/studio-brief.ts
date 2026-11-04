import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { getBrief, getStudioJob, startStudioJob, waitForStudioJob } from '../src/studio/jobs.js';
import { coverageReport, conflictReport, offeringsReport } from '../src/studio/report.js';

/**
 * Run a business-brief job from the command line and save what it produced.
 *   npx tsx scripts/studio-brief.ts --website https://example.com --out out/qa/studio-phase1/example
 *   npx tsx scripts/studio-brief.ts --google "Business name, City ST" --out ...
 *   npx tsx scripts/studio-brief.ts --rebuild <jobId> --out ...      (from that job's snapshot, nothing fetched)
 */
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const out = arg('out') ?? 'out/qa/studio-phase1/run';
let input: { website?: string; google?: string; fromSnapshot?: string };
if (arg('rebuild')) {
  const j = await getStudioJob(arg('rebuild')!);
  if (!j?.snapshotId) throw new Error('that job has no snapshot');
  input = { fromSnapshot: j.snapshotId };
} else input = { website: arg('website'), google: arg('google') };

const job = await startStudioJob(input);
console.log(`job ${job.id} started`);
const timer = setInterval(async () => {
  const j = await getStudioJob(job.id);
  const s = j?.stages.find((x) => x.status === 'running');
  if (s) console.log(`  ${s.name}${s.progress ? ` ${s.progress.done}/${s.progress.total}${s.progress.note ? ` ${s.progress.note}` : ''}` : ''}`);
}, 5000);
const done = await waitForStudioJob(job.id);
clearInterval(timer);
for (const s of done.stages) console.log(`${s.status.padEnd(8)} ${s.name}${s.error ? `: ${s.error}` : ''}${s.notes.length ? `\n           ${s.notes.join('\n           ')}` : ''}`);
console.log(`status ${done.status}${done.error ? `: ${done.error}` : ''}`);
if (done.status !== 'done') process.exit(1);
const { brief, inventory } = await getBrief(done.businessKey!, done.revision);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'brief.json'), JSON.stringify(brief, null, 2));
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2));
fs.writeFileSync(path.join(out, 'job.json'), JSON.stringify(done, null, 2));
fs.writeFileSync(path.join(out, 'coverage.md'), coverageReport(inventory!, brief));
fs.writeFileSync(path.join(out, 'conflicts.md'), conflictReport(brief!));
fs.writeFileSync(path.join(out, 'offerings.md'), offeringsReport(brief!));
console.log(`revision ${done.revision} · brief ${done.briefHash?.slice(0, 16)} · snapshot ${done.snapshotId} · QA ${done.qa?.status}`);
console.log(`saved to ${out}`);
process.exit(0);
