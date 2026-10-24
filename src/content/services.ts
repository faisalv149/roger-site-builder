import type { Theme } from '../theme/schema.js';
import type { Business, ServiceItem, WebsiteScan } from '../types.js';
import { iconExists } from '../render/icons.js';
import { slugify } from '../util/text.js';
import { SERVICE_COPY } from './service-copy.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lucide icons Claude may pick for a business's own services (any trade or kind of business). */
export const SERVICE_ICONS = [
  'wrench', 'hammer', 'house', 'droplet', 'flame', 'zap', 'plug', 'lightbulb', 'snowflake', 'fan', 'thermometer',
  'leaf', 'trees', 'sprout', 'shovel', 'paintbrush', 'ruler', 'hard-hat', 'shield-check', 'search', 'clipboard-check',
  'calendar', 'clock', 'phone', 'truck', 'car', 'package', 'shopping-bag', 'utensils', 'coffee', 'dumbbell', 'heart-pulse',
  'stethoscope', 'baby', 'dog', 'graduation-cap', 'book-open', 'briefcase', 'users', 'user', 'camera', 'music', 'gift',
  'scissors', 'sparkles', 'star', 'sun', 'cloud-lightning', 'layers', 'key-round', 'lock', 'recycle', 'waves', 'bike', 'bed',
  'building-2', 'store', 'circle-check',
].filter(iconExists);

/**
 * Services shown on the site. Google never returns a services list, so:
 *  1. the business's own services (Claude, from its website or reviews) when there are at least `min`;
 *  2. otherwise the theme's standard services, ranked by keyword hits in the website text + reviews
 *     (+ any ids Claude saw mentioned). General themes have none, so the section hides.
 */
export function pickServices(
  theme: Theme,
  b: Business,
  scan: WebsiteScan | undefined,
  mentioned: string[] = [],
  blurbs: Record<string, string> = {},
  opts: { emergencyOk?: boolean; own?: { name: string; description: string; icon: string }[] } = {},
): { items: ServiceItem[]; matched: number; overflow: boolean; hidden: boolean; source: 'business' | 'theme' } {
  const rules = (theme.sectionRules.services || {}) as { min?: number; max?: number };
  const max = rules.max ?? 6;
  const min = rules.min ?? 3;

  const own = opts.own || [];
  if (own.length >= min) {
    const ids = new Set<string>();
    const items: ServiceItem[] = own.slice(0, max).map((s) => {
      let id = slugify(s.name) || 'service';
      while (ids.has(id)) id += '-2';
      ids.add(id);
      return { id, label: s.name, icon: iconExists(s.icon) ? s.icon : 'circle-check', hits: 1, description: s.description || undefined };
    });
    return { items, matched: items.length, overflow: own.length > max, hidden: false, source: 'business' };
  }

  const site = scan?.ok ? scan.text : '';
  const corpus = `${site}\n${b.editorialSummary || ''}\n${b.reviews.map((r) => r.text).join('\n')}`.toLowerCase();
  const scored = theme.services.defaults.map((s, idx) => {
    let hits = 0;
    for (const kw of s.keywords) {
      const re = new RegExp(`\\b${escapeRe(kw.toLowerCase())}`, 'g');
      hits += (corpus.match(re) || []).length;
    }
    if (mentioned.includes(s.id)) hits += 3;
    return { s, idx, hits };
  });
  // "24/7 emergency" is a claim, not a filler service: only list it when the business supports it.
  const eligible = scored.filter((x) => x.s.id !== 'emergency' || opts.emergencyOk);
  const matched = eligible.filter((x) => x.hits > 0).length;
  const ranked = [...eligible].sort((a, b) => (b.hits > 0 ? 1 : 0) - (a.hits > 0 ? 1 : 0) || b.hits - a.hits || a.idx - b.idx);
  const vertical = theme.meta.vertical;
  const items: ServiceItem[] = ranked.slice(0, max).map(({ s, hits }) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    hits,
    description: blurbs[s.id] || (s as any).description || SERVICE_COPY[`${vertical}:${s.id}`] || SERVICE_COPY[s.id],
  }));
  return { items, matched, overflow: theme.services.defaults.length > max, hidden: items.length < min, source: 'theme' };
}
