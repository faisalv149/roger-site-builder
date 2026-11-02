import { config } from '../config.js';
import { getBuild, type BuildRecord, type BuildSource } from '../store.js';
import { startBuild, type Job } from '../jobs.js';
import type { BuildInput, PersonaliseInfo } from '../pipeline.js';
import { DIRECTION_LABEL, GOAL_LABEL, HERO_LABEL, validatePreferences, type DesignPreferences } from './schema.js';
import { TYPE_PRESET_DEFS } from './directions.js';

/**
 * Personalising a finished build: the same entry point for the Studio and the iMessage flow. Rebuilds the site
 * with the owner's answers (or as an alternative design), keeping its slug, preview mode and audit.
 */
export interface RefineRequest { preferences?: unknown; alternative?: boolean; optIn?: boolean }
export type RefineStart = { ok: true; job: Job; prefs: DesignPreferences } | { ok: false; status: number; error: string };

const isManual = (rec: BuildRecord) =>
  rec.result?.personalise ? rec.result.personalise.manualTheme : rec.input ? rec.input.themeSource !== 'auto' : /Chosen manually|Uploaded theme/.test(rec.result?.themeReason || '');

/** What the questions offer for a build; older records (before the pilot) are read from their result. */
export function personaliseInfo(rec: BuildRecord): PersonaliseInfo {
  const r = rec.result!;
  if (r.personalise) return r.personalise;
  return {
    eligible: config.designPilot,
    reason: config.designPilot ? undefined : 'Personalisation is turned off (DESIGN_PILOT=0)',
    manualTheme: isManual(rec),
    suggestions: r.services.slice(0, 4),
    phoneOk: !!r.business.phone,
    emergencyVerified: !!(r.facts.open24h || r.facts.emergency),
  };
}

/** The Studio's view of a build's personalisation: options, current answers, and a readable plan summary. */
export async function personaliseState(buildId: string) {
  const rec = await getBuild(buildId);
  if (!rec || rec.status !== 'done' || !rec.result) return undefined;
  const p = rec.result.design;
  return {
    buildId,
    ...personaliseInfo(rec),
    current: p?.preferences ?? rec.preferences ?? {},
    plan: p ? {
      id: p.id, variation: p.variation, direction: DIRECTION_LABEL[p.direction], goal: GOAL_LABEL[p.goal], service: p.service.label,
      hero: HERO_LABEL[p.hero.variant], typography: TYPE_PRESET_DEFS[p.typography].label, sections: p.sections.map((s) => s.id),
      copySource: p.copy.source, planner: p.planner, reasons: p.reasons,
    } : null,
  };
}

export function refinementInput(rec: BuildRecord, prefs: DesignPreferences, req: RefineRequest): BuildInput {
  const r = rec.result!;
  const manual = isManual(rec);
  return {
    placeId: rec.input?.placeId ?? r.business.placeId,
    website: rec.input?.website ?? r.business.website,
    preview: rec.input?.preview ?? true,
    audit: false, // the build keeps its audit (attached by the job)
    screenshot: true,
    slug: r.slug,
    fonts: rec.input?.fonts,
    brandColor: rec.input?.brandColor,
    design: { preferences: prefs, alternative: !!req.alternative, optIn: manual ? true : undefined, previous: r.design },
  };
}

export async function startRefinement(buildId: string, req: RefineRequest, meta: { source?: BuildSource } = {}): Promise<RefineStart> {
  const rec = await getBuild(buildId);
  if (!rec) return { ok: false, status: 404, error: 'No such build' };
  if (rec.status !== 'done' || !rec.result) return { ok: false, status: 400, error: 'This build failed; build the site again first' };
  const info = personaliseInfo(rec);
  if (!info.eligible) return { ok: false, status: 400, error: info.reason || 'This site can\'t be personalised' };
  if (info.manualTheme && !req.optIn) return { ok: false, status: 409, error: 'This site uses a chosen theme. Confirm that Roger\'s design may replace it.' };
  const v = validatePreferences(req.preferences);
  if (!v.ok) return { ok: false, status: 400, error: v.errors.join('; ') };
  const source = meta.source ?? (rec.source === 'imessage' ? 'imessage' : 'studio');
  // Studio rebuilds are scored again for the comparison; iMessage replies shouldn't wait for it
  const job = startBuild({ ...refinementInput(rec, v.prefs, req), scoreNew: source === 'studio' }, {
    source,
    from: rec.from,
    audit: rec.result.audit,
  });
  return { ok: true, job, prefs: v.prefs };
}
