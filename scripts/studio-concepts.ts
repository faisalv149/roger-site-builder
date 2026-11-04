import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { getConceptJob, getConceptSet, startConceptJob, waitForConceptJob } from '../src/studio/concepts/jobs.js';
import { setDir } from '../src/studio/concepts/render.js';

/**
 * Make three homepage concepts for a business from its latest (or a given) brief revision, and copy the set (HTML,
 * screenshots, set.json) to an output folder.
 *   npx tsx scripts/studio-concepts.ts --business <businessKey> [--revision n] [--review <reviewId>] --out out/qa/studio-phase2/<name>
 * STUDIO_CONCEPT_AI=0 uses the deterministic planner (no Claude).
 */
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const business = arg('business');
if (!business) throw new Error('--business <businessKey> is required');
const out = arg('out') ?? `out/qa/studio-phase2/${business}`;
const job = await startConceptJob({ businessKey: business, revision: arg('revision') ? Number(arg('revision')) : undefined, reviewId: arg('review') });
console.log(`concept job ${job.id} (set ${job.setId}) started`);
const timer = setInterval(async () => { const j = await getConceptJob(job.id); const s = j?.stages.find((x) => x.status === 'running'); if (s) console.log(`  ${s.name}…`); }, 8000);
const done = await waitForConceptJob(job.id);
clearInterval(timer);
for (const s of done.stages) console.log(`${s.status.padEnd(8)} ${s.name}${s.error ? `: ${s.error}` : ''}${s.notes.length ? `\n           ${s.notes.join('\n           ')}` : ''}`);
console.log(`status ${done.status}${done.error ? `: ${done.error}` : ''}`);
if (done.status !== 'done') process.exit(1);
const set = (await getConceptSet(done.setId))!;
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(setDir(done.setId), out, { recursive: true });
fs.writeFileSync(path.join(out, 'job.json'), JSON.stringify({ ...done, work: { ...done.work, rendered: undefined } }, null, 2));
console.log(`set ${set.id} · hash ${set.setHash.slice(0, 16)} · cost $${set.cost.spentUsd.toFixed(4)} · ${set.checks.map((c) => `${c.id} ${c.level}`).join(', ')}`);
console.log(`saved to ${out}`);
process.exit(0);
