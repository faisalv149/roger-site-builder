/**
 * The background worker: runs custom-site generations outside the request lifecycle. In the Vercel beta it is a Vercel
 * Daemon (vercel.beta.json, Dockerfile.worker): one long-running process that Vercel restarts if it exits, and stops with
 * SIGTERM (and a grace period) when a new deployment rolls out.
 *
 *   start      recover generations whose heartbeat stopped (a crash or a killed instance): each continues once, from its
 *              saved stage (an accepted homepage is never regenerated)
 *   every 5s   claim and run the generations the web functions queued (an atomic claim per queued run)
 *   every 15s  move custom-intake conversations forward and send what their customers have not had yet (once)
 *   SIGTERM    take no new work; finish the generations under way (their heartbeats keep any other worker off them), exit
 *
 * Nothing here depends on a browser being open, or on a request staying alive.
 */
process.env.ROGER_ROLE = 'worker';
import http from 'node:http';
import os from 'node:os';
const { recoverInterruptedFrontendJobs, runQueuedFrontendJobs, runningFrontendJobs } = await import('./studio/frontend/jobs.js');
const { advanceAllCustom } = await import('./imessage/flow.js');
const { config } = await import('./config.js');
const { remote } = await import('./remote.js');

const owner = `worker-${os.hostname()}-${process.pid}-${Date.now().toString(36)}`;
let stopping = false;
let lastTick = Date.now();
const log = (...a: unknown[]) => console.log(`[worker ${new Date().toISOString()}]`, ...a);

// health: alive while the loop keeps ticking (a stuck loop fails the probe and Vercel restarts the instance)
http.createServer((req, res) => {
  const ok = req.url === '/health' && Date.now() - lastTick < 120_000;
  res.statusCode = ok ? 200 : 503;
  res.end(ok ? 'ok' : 'stale');
}).listen(Number(process.env.WORKER_HEALTH_PORT || 1234));

process.on('SIGTERM', () => { stopping = true; log(`SIGTERM: no new work; ${runningFrontendJobs()} generation(s) to finish`); });

log(`start ${owner}; storage ${remote?.name ?? 'local disk'}${process.env.ROGER_STORE_NAMESPACE ? ` (namespace ${process.env.ROGER_STORE_NAMESPACE})` : ''}; public origin ${config.publicOrigin || 'none'}; chromium ${config.chromiumPath || 'serverless'}`);
const r = await recoverInterruptedFrontendJobs(owner).catch((e) => { log('recovery failed', (e as Error).message); return { resumed: [], restarted: [], failed: [] }; });
if (r.resumed.length + r.restarted.length + r.failed.length) log(`recovered: resumed ${r.resumed.join(', ') || '-'}; restarted ${r.restarted.join(', ') || '-'}; failed ${r.failed.join(', ') || '-'}`);

let n = 0;
while (!stopping) {
  lastTick = Date.now();
  try {
    const started = await runQueuedFrontendJobs(owner);
    if (started.length) log(`started ${started.join(', ')}`);
    if (n % 3 === 0) {
      const moved = await advanceAllCustom();
      if (moved) log(`advanced ${moved} conversation(s)`);
      // a generation whose worker died: picked up once its heartbeat is stale
      if (n % 12 === 0) { const rr = await recoverInterruptedFrontendJobs(owner); if (rr.resumed.length + rr.restarted.length + rr.failed.length) log('recovered', JSON.stringify(rr)); }
    }
  } catch (e) { log('tick failed', (e as Error).message); }
  n++;
  await new Promise((res) => setTimeout(res, 5000));
}
// drain: the generations under way finish (bounded by the grace period Vercel gives after SIGTERM)
while (runningFrontendJobs() > 0) { lastTick = Date.now(); await new Promise((res) => setTimeout(res, 2000)); }
log('drained; exit');
process.exit(0);
