/**
 * Which playbook row a business is, and how sure: in order, what the owner said, Google's primary type, Google's other
 * types, then the words of its category, name and website. Below 0.7 the generic row is used and the owner is asked to
 * confirm the trade. A business spanning two trades (a bakery cafe) uses its primary type's row and names the other.
 */
import { GENERIC_ROW, PLAYBOOK, type TradeRow } from './playbook.js';

export interface TradeSignals {
  /** what the owner said the business is ("we're a bakery"), a row id or free words */
  ownerTrade?: string;
  primaryType?: string;
  types?: string[];
  /** Google's display name for the type, and the business's name */
  category?: string;
  name?: string;
  /** the website's own words (titles, headings, about text) */
  websiteText?: string;
}
export interface TradeChoice {
  row: TradeRow;
  confidence: number;
  /** what decided it */
  via: 'owner' | 'primary-type' | 'types' | 'category' | 'website' | 'fallback';
  /** another trade it also is (its key offer belongs on the Offer screen) */
  secondary?: TradeRow;
  /** below 0.7: the owner is asked to confirm the trade */
  askOwner: boolean;
  /** when unsure: the best weak guess, to ask the owner about */
  guess?: TradeRow;
}

export const CONFIDENT = 0.7;
const GENERIC_TYPES = new Set(['store', 'food', 'point_of_interest', 'establishment', 'health', 'finance']);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hits = (text: string, row: TradeRow) => row.keywords.filter((k) => new RegExp(`(^|[^a-z])${esc(k)}([^a-z]|$)`, 'i').test(text)).length;

export function classifyTrade(s: TradeSignals): TradeChoice {
  const types = (s.types ?? []).filter(Boolean);
  const byType = (t: string) => PLAYBOOK.find((r) => r.googleTypes.includes(t));
  // a second trade from a specific type only ("store" and "food" describe nearly every listing)
  const secondaryOf = (row: TradeRow) => types.filter((t) => !GENERIC_TYPES.has(t)).map(byType).find((r) => r && r.id !== row.id && r.family !== row.family);
  const done = (row: TradeRow, confidence: number, via: TradeChoice['via']): TradeChoice => {
    const conf = Math.round(confidence * 100) / 100;
    if (conf < CONFIDENT) return { row: GENERIC_ROW, confidence: conf, via: 'fallback', askOwner: true, guess: row };
    const secondary = via === 'owner' ? undefined : secondaryOf(row);
    return { row, confidence: conf, via, ...(secondary ? { secondary } : {}), askOwner: false };
  };

  // 1. the owner's word
  const owner = s.ownerTrade?.trim().toLowerCase();
  if (owner) {
    const row = PLAYBOOK.find((r) => r.id === owner || r.label.toLowerCase() === owner) ?? PLAYBOOK.map((r) => ({ r, n: hits(owner, r) })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0]?.r;
    if (row) return done(row, 1, 'owner');
  }
  // 2. Google's primary type
  const primary = s.primaryType ? byType(s.primaryType) : undefined;
  if (primary) return done(primary, 0.95, 'primary-type');
  // 3. Google's other types (the row most of them point to)
  const counted = new Map<TradeRow, number>();
  for (const t of types) { const r = byType(t); if (r) counted.set(r, (counted.get(r) ?? 0) + 1); }
  const typed = [...counted].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (typed) return done(typed, 0.8, 'types');
  // 4. the category and name
  const named = `${s.category ?? ''} ${s.name ?? ''}`;
  const byName = PLAYBOOK.map((r) => ({ r, n: hits(named, r) })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0];
  if (byName) return done(byName.r, 0.75, 'category');
  // 5. the website's words: confident only when several of a trade's words appear
  const site = s.websiteText ?? '';
  const bySite = PLAYBOOK.map((r) => ({ r, n: hits(site, r) })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0];
  if (bySite) return done(bySite.r, bySite.n >= 3 ? 0.7 : 0.5, 'website');
  return { row: GENERIC_ROW, confidence: 0, via: 'fallback', askOwner: true };
}
