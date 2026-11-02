import { findDraft, getDraft } from './drafts.js';
import { latestBuildFor, listBuilds } from './store.js';
import { startBuild, waitForJob } from './jobs.js';
import type { BuildInput, BuildResult } from './pipeline.js';
import { savedIdentityProblem } from './sources/resolve.js';

/**
 * Sites built before identity was checked can carry a business that isn't one (a postal code, a town) in their
 * saved record. Deploying fixed code doesn't touch them: their static pages and their saved draft keep the old
 * name until the site is rebuilt. This finds such a site and rebuilds it under the same address, so the corrected
 * pages replace the old ones (and a saved draft keeps its id, owner link and orders).
 */
export interface RepairResult {
  slug: string;
  /** why the saved identity is invalid, when it is */
  problem?: string;
  repaired: boolean;
  message: string;
  build?: BuildResult;
}

/** What a saved site says its business is, from its draft or its latest build record. */
async function savedBusiness(slug: string, draftId?: string) {
  const d = draftId ? await getDraft(draftId) : await findDraft({ slug });
  const rec = await latestBuildFor(d?.slug ?? slug);
  const b = d?.base.business ?? (rec?.result?.business as undefined | { name: string; placeId: string; formattedAddress?: string; primaryTypeLabel?: string; website?: string; source?: 'places' | 'mock' | 'website' });
  return { d, rec, b, slug: d?.slug ?? rec?.result?.slug ?? slug };
}

export async function findInvalidIdentities(): Promise<{ slug: string; name: string; problem: string }[]> {
  const out: { slug: string; name: string; problem: string }[] = [];
  const seen = new Set<string>();
  for (const s of await listBuilds()) {
    if (!s.slug || s.status !== 'done' || s.replaced || seen.has(s.slug)) continue;
    seen.add(s.slug);
    const problem = savedIdentityProblem({ name: s.name || '', types: [], primaryTypeLabel: s.category, formattedAddress: s.address, source: 'places' });
    if (problem) out.push({ slug: s.slug, name: s.name || '', problem });
  }
  return out;
}

export async function repairIdentity(ref: { slug?: string; draftId?: string }, opts: { screenshot?: boolean; force?: boolean } = {}): Promise<RepairResult> {
  const { d, rec, b, slug } = await savedBusiness(ref.slug || '', ref.draftId);
  if (!b) return { slug, repaired: false, message: `No saved site found for "${ref.slug || ref.draftId}".` };
  const problem = savedIdentityProblem({ name: b.name, types: (b as { types?: string[] }).types ?? [], primaryType: (b as { primaryType?: string }).primaryType, primaryTypeLabel: b.primaryTypeLabel, formattedAddress: b.formattedAddress, source: b.source ?? 'places' });
  if (!problem && !opts.force) return { slug, repaired: false, message: `"${b.name}" is a business, so nothing needs re-resolving.` };
  const website = rec?.input?.website ?? b.website ?? d?.base.source?.website;
  if (!website) return { slug, problem, repaired: false, message: `The saved identity is invalid (${problem}) and there is no website to re-resolve it from. Rebuild it from the business name and ZIP.` };
  const input: BuildInput = {
    placeId: rec?.input?.placeId ?? b.placeId,
    website,
    slug,
    // the same choices as the original build
    themeId: rec?.input?.themeSource === 'manual' ? rec.input.themeId : undefined,
    fonts: rec?.input?.fonts,
    brandColor: rec?.input?.brandColor,
    preview: rec?.input?.preview !== false,
    audit: false,
    scoreNew: false,
    screenshot: opts.screenshot !== false,
    repair: true,
  };
  const job = startBuild(input, { source: 'api' });
  await waitForJob(job);
  if (job.status !== 'done' || !job.result) return { slug, problem, repaired: false, message: `Re-resolving failed: ${job.error}` };
  const nb = job.result.business;
  return { slug, problem, repaired: true, build: job.result, message: `"${b.name}" was not a business (${problem}). Rebuilt as "${nb.name}" (${nb.identity?.status ?? 'checked'}) at the same address.` };
}
