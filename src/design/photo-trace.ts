import type { ProcessedPhoto, SiteImage } from '../brand/photos.js';
import type { Photo } from '../types.js';
import type { DesignPlan } from './schema.js';
import { photoKey, type PhotoInfo, type PhotoLabels } from './photos.js';

/**
 * Every photo the build found, followed to the page: found → downloaded → classified → eligible → selected → rendered.
 * Each one records how far it got and, when it stopped, why. "Rendered" is counted in the finished HTML, not taken
 * from the plan, so a photo the plan chose but the page doesn't show is caught too.
 *
 * Google's photo names may not be stored (Maps Platform terms), so a photo is identified by a short hash of its
 * reference for this build, never by the reference itself.
 */
export const TRACE_STAGES = ['found', 'downloaded', 'classified', 'eligible', 'selected', 'rendered'] as const;
export type TraceStage = (typeof TRACE_STAGES)[number];
export type PhotoRole = 'hero' | 'slide' | 'team' | 'gallery';

export interface PhotoTraceItem {
  id: string;
  source: 'google' | 'website' | 'owner';
  size: string;
  /** the furthest stage this photo reached */
  stage: TraceStage;
  kind?: string;
  /** what the classifier saw in it */
  seen?: string;
  roles: PhotoRole[];
  /** how many times the finished pages show it */
  shown: number;
  /** why it stopped where it did (absent when it is on the page) */
  reason?: string;
}
export interface PhotoTrace {
  counts: Record<TraceStage, number>;
  /** how photos were classified: Claude's vision, sample labels, or not at all (then ranked by quality only) */
  labelled: PhotoLabels['source'];
  labelNote?: string;
  items: PhotoTraceItem[];
}

/** Asset files the pages reference (src, srcset, inline background urls). */
export function assetRefs(html: string): string[] {
  // the site's own files, and Google listing photos linked live (/gphoto/<place>/<n>?s=WxH, see google-live.ts)
  return [...html.matchAll(/assets\/[A-Za-z0-9._-]+\.(?:webp|jpe?g|png|avif)|\/gphoto\/[A-Za-z0-9_%-]+\/\d+\?s=\d+x\d+/g)].map((m) => m[0]);
}

export function tracePhotos(i: {
  found: Photo[];
  processed: { rejected: { ref: string; reason: string }[]; skipped?: { ref: string; reason: string }[]; items: ProcessedPhoto[]; hero?: SiteImage; gallery: SiteImage[] };
  labels?: PhotoLabels;
  infos?: PhotoInfo[];
  plan?: DesignPlan;
  /** every rendered page, joined */
  html: string;
  /** why the plan has no gallery, when it says (src/design/planner.ts reasons) */
  planReasons?: string[];
}): PhotoTrace {
  const refs = assetRefs(i.html);
  const count = (pred: (r: string) => boolean) => refs.filter(pred).length;
  const rejected = new Map(i.processed.rejected.map((r) => [r.ref, r.reason]));
  const skipped = new Map((i.processed.skipped ?? []).map((r) => [r.ref, r.reason]));
  const itemIdx = new Map(i.processed.items.map((it, n) => [it.photo.ref, n]));
  const planned = new Map<string, PhotoRole[]>();
  const role = (k: string | null | undefined, r: PhotoRole) => { if (k) planned.set(k, [...(planned.get(k) ?? []), r]); };
  if (i.plan) {
    role(i.plan.images.hero, 'hero');
    for (const k of i.plan.images.slides) role(k, 'slide');
    role(i.plan.images.team, 'team');
    for (const k of i.plan.images.gallery) role(k, 'gallery');
  }
  const galleryWhy = i.planReasons?.find((r) => /^No gallery/.test(r));
  const items = i.found.map((p): PhotoTraceItem => {
    const base = { id: photoKey(p.ref), source: (p.source === 'website' ? 'website' : 'google') as PhotoTraceItem['source'], size: `${p.width}×${p.height}`, roles: [] as PhotoRole[], shown: 0 };
    const n = itemIdx.get(p.ref);
    if (n === undefined) {
      const why = rejected.get(p.ref) ?? skipped.get(p.ref) ?? 'not downloaded';
      // a picture that was downloaded and then judged a flyer or graphic got further than one that was never fetched
      return { ...base, stage: /text-heavy/.test(why) ? 'downloaded' : 'found', reason: why };
    }
    const it = i.processed.items[n];
    const info = i.infos?.[n];
    const kind = info?.kind ?? i.labels?.kinds[n] ?? 'unknown';
    const seen = i.labels?.seen[n];
    const key = info?.key ?? photoKey(p.ref);
    const frag = key.slice(2, 8);
    const file = it.image.publicPath;
    const shown = count((r) => r === file || r.includes(`-${frag}-`));
    const roles = i.plan ? planned.get(key) ?? [] : ([i.processed.hero?.publicPath === file ? 'hero' : undefined, i.processed.gallery.some((g) => g.publicPath === file) ? 'gallery' : undefined].filter(Boolean) as PhotoRole[]);
    const classified = kind !== 'unknown';
    const eligible = kind !== 'other';
    const stage: TraceStage = shown ? 'rendered' : roles.length ? 'selected' : eligible ? 'eligible' : classified ? 'classified' : 'downloaded';
    const reason = shown ? undefined
      : !eligible ? `classified as other${seen ? ` (${seen})` : ''}: graphics, text and unrelated scenes are kept off the page`
      : roles.length ? `planned as ${roles.join(' and ')} but not on the rendered page`
      : i.plan && !i.plan.images.gallery.length ? `not placed: ${galleryWhy ? galleryWhy.replace(/^No gallery: /, 'no gallery, ') : 'this layout has no gallery'}`
      : `not placed: the layout shows ${planned.size} photo${planned.size === 1 ? '' : 's'} and ranked this one lower`;
    return { ...base, stage, ...(classified ? { kind } : { kind: 'unknown' }), ...(seen ? { seen } : {}), roles, shown, ...(reason ? { reason } : {}) };
  });
  const at = (s: TraceStage) => items.filter((x) => TRACE_STAGES.indexOf(x.stage) >= TRACE_STAGES.indexOf(s)).length;
  const counts = Object.fromEntries(TRACE_STAGES.map((s) => [s, s === 'classified' ? items.filter((x) => TRACE_STAGES.indexOf(x.stage) >= 1 && x.kind && x.kind !== 'unknown').length : at(s)])) as Record<TraceStage, number>;
  return { counts, labelled: i.labels?.source ?? 'none', ...(i.labels?.note ? { labelNote: i.labels.note } : {}), items };
}

/** "found 10 → downloaded 10 → classified 10 → eligible 8 → selected 7 → shown 7" */
export const traceLine = (t: PhotoTrace) => `found ${t.counts.found} → downloaded ${t.counts.downloaded} → classified ${t.counts.classified}${t.labelled === 'none' ? ' (no labels)' : ''} → eligible ${t.counts.eligible} → selected ${t.counts.selected} → shown ${t.counts.rendered}`;

/**
 * The finding a build gets when it had photos to use and the page shows none (never a clean success), or when
 * photos were found and none could be used at all. The commonest reasons are named.
 */
export function photoFindings(t: PhotoTrace): { id: string; level: 'review'; message: string }[] {
  const reasons = (xs: PhotoTraceItem[]) => {
    const tally = new Map<string, number>();
    for (const x of xs) { const r = (x.reason ?? '').replace(/ \(.*?\)/, '').replace(/:.*$/, ''); tally.set(r, (tally.get(r) ?? 0) + 1); }
    return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${n} ${r}`).join('; ');
  };
  if (t.counts.downloaded > 0 && t.counts.rendered === 0) {
    return [{ id: 'photos-unshown', level: 'review', message: `${t.counts.downloaded} photo${t.counts.downloaded === 1 ? ' was' : 's were'} downloaded but the page shows none (${reasons(t.items.filter((x) => x.stage !== 'found'))}). Check the photo labels, relevance and publication rights.` }];
  }
  if (t.counts.found > 0 && t.counts.downloaded === 0) {
    return [{ id: 'photos-unusable', level: 'review', message: `${t.counts.found} photo${t.counts.found === 1 ? ' was' : 's were'} found but none could be used (${reasons(t.items)}). Ask the owner for photos.` }];
  }
  return [];
}
