import type { Business, Facts } from '../types.js';
import { loadThemes, type ThemeEntry } from './load.js';

export interface ThemePick {
  entry: ThemeEntry;
  reason: string;
}

const VAGUE_TYPES = new Set(['general_contractor', 'contractor', 'home_improvement_store', 'point_of_interest', 'establishment']);

/** Map the Google Business category to a vertical using each theme's match.googleTypes. */
export function detectVertical(b: Business): { vertical?: string; matchedType?: string } {
  const themes = [...loadThemes().values()];
  const types = [b.primaryType, ...b.types].filter(Boolean) as string[];
  for (const t of types) {
    const hit = themes.find((e) => e.theme.match.googleTypes.includes(t));
    if (hit) return { vertical: hit.vertical, matchedType: t };
  }
  // Fallback: keyword in the business name / category label. Only when Google's category is vague
  // ("General contractor" named "ABC Roofing"); a "Rooftop Bar" or "Garden Cafe" is not a trade.
  if (b.primaryType && !VAGUE_TYPES.has(b.primaryType)) return {};
  const hay = `${b.name} ${b.primaryTypeLabel || ''}`.toLowerCase();
  const kw: Record<string, string[]> = {
    roofing: ['roof'],
    hvac: ['hvac', 'heating', 'cooling', 'air condition', 'furnace'],
    plumbing: ['plumb', 'drain', 'sewer', 'water heater'],
    electrical: ['electric'],
    landscaping: ['landscap', 'lawn', 'garden', 'yard'],
  };
  for (const [v, words] of Object.entries(kw)) if (words.some((w) => hay.includes(w))) return { vertical: v };
  return {};
}

/**
 * Pick one of the six layouts for a business.
 *  urgent   — 24h or emergency language
 *  trust    — strong reviews
 *  showcase — lots of good photos
 *  estimate — no phone listed (form-first)
 *  classic  — default
 */
export function pickVariant(b: Business, facts: Facts, usablePhotos: number): { variant: string; reason: string } {
  if (facts.open24h || facts.emergency) return { variant: 'urgent', reason: facts.open24h ? 'Open 24 hours' : 'Mentions emergency service' };
  if ((b.rating || 0) >= 4.7 && (b.reviewCount || 0) >= 40) return { variant: 'trust', reason: `${b.rating}★ from ${b.reviewCount} reviews` };
  if (usablePhotos >= 6) return { variant: 'showcase', reason: `${usablePhotos} usable photos` };
  if (!b.phone) return { variant: 'estimate', reason: 'No phone number listed, lead form first' };
  return { variant: 'classic', reason: 'Balanced default' };
}

export function selectTheme(
  b: Business,
  facts: Facts,
  usablePhotos: number,
  opts: { themeId?: string; vertical?: string; variant?: string } = {},
): ThemePick {
  const all = loadThemes();
  if (opts.themeId) {
    const e = all.get(opts.themeId);
    if (!e) throw new Error(`Theme "${opts.themeId}" not found`);
    return { entry: e, reason: 'Chosen manually' };
  }
  const det = detectVertical(b);
  // No trade matches (a gym, a salon...): the general themes, never a trade's copy and services
  const fallback = [...all.values()].some((e) => e.vertical === 'general') ? 'general' : 'roofing';
  const vertical = opts.vertical || det.vertical || fallback;
  const auto = pickVariant(b, facts, usablePhotos);
  const variant = opts.variant || auto.variant;
  const entry = all.get(`${vertical}-${variant}`) || [...all.values()].find((e) => e.vertical === vertical) || [...all.values()][0];
  if (!entry) throw new Error('No themes loaded');
  const why = [
    opts.vertical ? `vertical ${vertical} (manual)` : det.matchedType ? `Google type "${det.matchedType}" → ${vertical}` : det.vertical ? `name/category → ${vertical}` : `no trade matches Google category "${b.primaryTypeLabel || b.primaryType || 'unknown'}" → ${vertical}`,
    opts.variant ? `layout ${variant} (manual)` : `layout ${variant}: ${auto.reason}`,
  ].join('; ');
  return { entry, reason: why };
}
