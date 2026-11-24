/**
 * The fact sheet: every fact the page may use, each with its source. Sources rank owner, then website, then Google.
 * When sources disagree, the higher rank is used and the disagreement becomes a question for the owner. A fact with
 * no source does not exist (it is never inferred).
 *
 * Google content (rating, review count, reviews, Google photos, open-now, today's hours) is recorded here so the plan
 * knows it exists, but it is never written into the page: the page has server-filled slots (data-google="…").
 */
export type Source = 'owner' | 'website' | 'google';
export interface Fact { field: string; value: string | number | boolean | string[]; source: Source; source_ref: string; retrieved_at: string }
export interface Conflict { field: string; used: Fact; others: Fact[] }
export interface FactSheet { facts: Fact[]; conflicts: Conflict[] }

const RANK: Record<Source, number> = { owner: 0, website: 1, google: 2 };
/** fields shown only through live Google slots */
export const GOOGLE_SLOT_FIELDS = new Set(['rating', 'review_count', 'reviews', 'google_photos', 'open_now', 'hours_today']);
/** things that are never inferred: they exist only when a source states them */
export const NEVER_INFER = ['price', 'credential', 'licence', 'license', 'years_in_business', 'award', 'service_area', 'emergency', 'response_time', 'financing', 'warranty', 'insurance_accepted', 'free_estimate', 'family_owned', 'accepting_new_patients'];

/** two values that say the same thing (case, spacing and punctuation aside; phone numbers by their digits) */
export function sameValue(field: string, a: Fact['value'], b: Fact['value']): boolean {
  const norm = (v: Fact['value']) => {
    const s = Array.isArray(v) ? [...v].map(String).sort().join('|') : String(v);
    if (/phone/.test(field)) return s.replace(/\D/g, '').slice(-10);
    // accents, case and punctuation aside ("Café" = "Cafe"); an address without its country is the same address
    const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return (field === 'address' ? t.replace(/,?\s*(usa|united states|united kingdom|uk|canada|australia|pakistan)\s*$/, '') : t).replace(/[^a-z0-9|]+/g, ' ').trim();
  };
  const x = norm(a), y = norm(b);
  // a name one source extends with its town ("Lakeside Chiropractic" / "Lakeside Chiropractic Lago Vista")
  return x === y || (field === 'name' && !!x && !!y && (x.startsWith(`${y} `) || y.startsWith(`${x} `)));
}

/** the sheet from every candidate fact: one per field (the best-ranked source), with the disagreements */
export function buildFactSheet(candidates: Fact[]): FactSheet {
  const byField = new Map<string, Fact[]>();
  for (const f of candidates) {
    if (!f.source_ref || f.value === '' || f.value === null || f.value === undefined || (Array.isArray(f.value) && !f.value.length)) continue; // no source, no fact
    byField.set(f.field, [...(byField.get(f.field) ?? []), f]);
  }
  const facts: Fact[] = [], conflicts: Conflict[] = [];
  for (const [field, list] of byField) {
    const ranked = [...list].sort((a, b) => RANK[a.source] - RANK[b.source]);
    const used = ranked[0];
    facts.push(used);
    const others = ranked.slice(1).filter((f) => f.source !== used.source && !sameValue(field, f.value, used.value));
    if (others.length) conflicts.push({ field, used, others });
  }
  return { facts, conflicts };
}
export const fact = (sheet: FactSheet, field: string) => sheet.facts.find((f) => f.field === field);

const FIELD_WORDS: Record<string, string> = { phone: 'phone number', hours: 'opening hours', address: 'address', name: 'business name', prices: 'prices', service_area: 'service area', email: 'email' };
/** most important first: what stops a visitor reaching the business, then what they pay, then everything else */
const PRIORITY = ['phone', 'address', 'hours', 'name', 'prices', 'service_area'];
const SAYS: Record<Source, string> = { owner: 'you told me', website: 'your website says', google: 'your Google listing says' };

/**
 * At most five questions for the owner, plain language, most important first: disagreements between sources, the
 * trade when it is unsure, then other notes (such as text on a page that addresses an AI, which was ignored).
 */
export function openQuestions(sheet: FactSheet, extra: { tradeUnsure?: string; notes?: string[] } = {}): string[] {
  return ownerQuestions(sheet, { tradeUnsure: extra.tradeUnsure ? { words: extra.tradeUnsure } : undefined, notes: (extra.notes ?? []).map((text) => ({ field: 'note', text })) }).map((q) => q.text);
}

/** a question for the owner: the fact it settles, and (for a yes-or-no question) what a "yes" means */
export interface OwnerQuestion { field: string; text: string; yes?: string }
/** the same questions, each knowing which fact the answer settles (the owner's answers become owner facts) */
export function ownerQuestions(sheet: FactSheet, extra: { tradeUnsure?: { words: string; id?: string }; notes?: OwnerQuestion[] } = {}): OwnerQuestion[] {
  // (a disagreement is raised even when the owner's value is used: staff see it, and the website may need updating;
  // the owner's conversation never asks again about a fact they already answered: see nextQuestion)
  const conflicts = [...sheet.conflicts].sort((a, b) => (PRIORITY.indexOf(a.field) + 99) % 99 - (PRIORITY.indexOf(b.field) + 99) % 99);
  const shown = (v: Fact['value']) => (Array.isArray(v) ? v.join('; ') : String(v));
  const qs: OwnerQuestion[] = conflicts.map((c) => ({ field: c.field, text: `Your ${FIELD_WORDS[c.field] ?? c.field.replace(/_/g, ' ')}: ${SAYS[c.used.source]} "${shown(c.used.value)}", but ${SAYS[c.others[0].source]} "${shown(c.others[0].value)}". Which is right?` }));
  if (extra.tradeUnsure) qs.push({ field: 'trade', text: `Is your business ${extra.tradeUnsure.words}? If not, what do you do?`, ...(extra.tradeUnsure.id ? { yes: extra.tradeUnsure.id } : {}) });
  qs.push(...(extra.notes ?? []));
  return qs.slice(0, 5);
}
