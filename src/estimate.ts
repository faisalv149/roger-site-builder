import { config } from './config.js';
import { claudeVia } from './content/claude.js';
import { buildTimings } from './store.js';

/**
 * How long a build will take, for the Studio and for Roger to tell the owner ("about 20 seconds").
 * Uses the recent saved builds that ran under the same conditions (live/mock Google, how Claude runs,
 * website or not, audit or not); falls back to starting figures until there are a few of those.
 */
export interface EstimateInput {
  website: boolean;
  audit: boolean;
  /** builds already running / waiting, from jobs.queueDepth() */
  queue?: { running: number; queued: number; max: number };
}

export interface Estimate {
  seconds: number;
  label: string;
  /** short "based on ..." line for the Studio */
  basis: string;
  samples: number;
  source: 'history' | 'blend' | 'default';
}

type Via = 'api' | 'cli' | 'off';

// Starting figures (seconds) measured on 2026-10-24: sample data ~2 s; live Google ~5 s; Claude via the
// local CLI adds ~8 s, ~13 s when it also reads a website; the audit runs alongside Claude, so it only
// adds time when Claude is off.
function defaultSeconds(mock: boolean, via: Via, website: boolean, audit: boolean): number {
  let s = mock ? 2 : 5;
  if (website) s += 1.5;
  if (audit) s += via === 'off' ? 2 : 0.5;
  if (via === 'cli') s += website ? 13 : 8;
  if (via === 'api') s += website ? 8 : 5;
  return s;
}

/** Round up so Roger slightly over-promises: "about 20 seconds" that lands at 17 feels fast. */
export function friendlyDuration(sec: number): { seconds: number; label: string } {
  if (sec < 8) return { seconds: Math.max(1, Math.ceil(sec)), label: 'a few seconds' };
  if (sec <= 60) { const n = Math.ceil(sec / 5) * 5; return { seconds: n, label: `about ${n} seconds` }; }
  if (sec <= 90) return { seconds: 60, label: 'about a minute' };
  const m = Math.max(2, Math.round(sec / 60)); // minutes: nearest, "about 2 minutes" for 2:10
  return { seconds: m * 60, label: `about ${m} minutes` };
}

const p75 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))]; };

export async function estimateBuild(input: EstimateInput): Promise<Estimate> {
  const mock = config.mock;
  const via: Via = claudeVia() || 'off';
  const fallback = defaultSeconds(mock, via, input.website, input.audit);
  const same = (await buildTimings())
    .filter((t) => t.mode.mock === mock && (t.mode.claudeVia ?? (t.mode.claude ? 'cli' : 'off')) === via && t.website === input.website && t.audit === input.audit)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((t) => t.totalMs / 1000);
  let sec: number;
  let source: Estimate['source'];
  if (same.length >= 3) { sec = p75(same); source = 'history'; }
  else if (same.length) { sec = (fallback + same.reduce((a, b) => a + b, 0)) / (same.length + 1); source = 'blend'; }
  else { sec = fallback; source = 'default'; }
  // a full queue means waiting for a free slot first
  const q = input.queue;
  if (q && q.running >= q.max) sec += Math.ceil((q.queued + 1) / q.max) * sec;
  const f = friendlyDuration(sec);
  const what = `${mock ? 'sample-data' : 'live'} builds ${input.website ? 'with a website' : 'without a website'}${input.audit ? ' and an audit' : ''}`;
  const claude = via === 'cli' ? 'Claude via local CLI' : via === 'api' ? 'Claude API' : 'Claude off';
  const basis = source === 'default'
    ? `starting estimate for ${what} (${claude}); gets more accurate as you build`
    : `based on ${same.length} recent ${what} (${claude})`;
  return { ...f, basis: q && q.running >= q.max ? `${basis}; includes waiting for a free slot (${q.running} running, ${q.queued} waiting)` : basis, samples: same.length, source };
}
