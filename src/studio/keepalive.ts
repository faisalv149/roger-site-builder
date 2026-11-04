/**
 * Studio jobs on a serverless host (Vercel): a function stops when its response is sent, so a job started by a request
 * is handed to waitUntil, which keeps the function alive (up to its time limit) until the job's promise settles.
 * A job that outlives the limit is cut off mid-stage; its stages are saved as they finish and it is picked up again
 * by the next poll of its status (see the jobs' `stale` checks). Elsewhere this does nothing: the server stays up.
 */
export async function keepAlive(p: Promise<unknown>): Promise<void> {
  p.catch(() => undefined);
  if (!process.env.VERCEL) return;
  const { waitUntil } = await import('@vercel/functions');
  waitUntil(p);
}

/** a job not touched for this long is no longer running anywhere (a running stage touches it every 15 s) */
export const STALE_MS = () => Number(process.env.STUDIO_STALE_MS ?? 60_000);
export const HEARTBEAT_MS = 15_000;
