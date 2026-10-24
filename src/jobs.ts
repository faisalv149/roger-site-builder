import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { buildSite, type BuildInput, type BuildResult } from './pipeline.js';
import { saveBuild, type BuildSource } from './store.js';
import { auditCard } from './imessage/cards.js';

// In-memory job queue. Swap for BullMQ/SQS when running more than one server.
// Every finished job is also saved to data/builds/ (src/store.ts) so the Studio can list it later.
export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  createdAt: number;
  events: any[];
  result?: BuildResult;
  error?: string;
  bus: EventEmitter;
}

export interface JobMeta {
  source?: BuildSource;
  from?: string;
  /** an audit run earlier in the conversation (iMessage builds skip their own) */
  audit?: BuildResult['audit'];
}

const jobs = new Map<string, Job>();
let running = 0;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_BUILDS || 3);
const queue: (() => void)[] = [];

export function startBuild(input: BuildInput, meta: JobMeta = {}): Job {
  const job: Job = { id: randomUUID().slice(0, 8), status: 'queued', createdAt: Date.now(), events: [], bus: new EventEmitter() };
  jobs.set(job.id, job);
  const run = async () => {
    running++;
    job.status = 'running';
    try {
      job.result = await buildSite(input, (e) => {
        job.events.push({ ...e, t: Date.now() - job.createdAt });
        job.bus.emit('event', e);
      });
      if (meta.audit && !job.result.audit) {
        job.result.audit = meta.audit;
        job.result.cards.unshift(auditCard(meta.audit, meta.audit.reportUrl, meta.audit.image));
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = (e as Error).message;
      console.error(`[job ${job.id}]`, e);
    } finally {
      try {
        saveBuild({ id: job.id, createdAt: new Date(job.createdAt).toISOString(), finishedAt: new Date().toISOString(), source: meta.source || 'api', from: meta.from, status: job.status === 'done' ? 'done' : 'error', error: job.error, result: job.result });
      } catch (e) { console.error(`[job ${job.id}] could not save build record`, e); }
      running--;
      job.bus.emit('end');
      queue.shift()?.();
    }
  };
  if (running < MAX_CONCURRENT) void run(); else queue.push(() => void run());
  // forget old jobs after an hour (the saved record stays in data/builds/)
  setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  return job;
}

export const getJob = (id: string) => jobs.get(id);

/** For build-time estimates: a full queue means waiting before starting. */
export const queueDepth = () => ({ running, queued: queue.length, max: MAX_CONCURRENT });

export function waitForJob(job: Job): Promise<Job> {
  if (job.status === 'done' || job.status === 'error') return Promise.resolve(job);
  return new Promise((resolve) => job.bus.once('end', () => resolve(job)));
}
