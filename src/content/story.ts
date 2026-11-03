import { claudeJson } from './claude.js';

/**
 * The business's own "about" text, edited into a short, faithful section: a clear heading and one to three readable
 * paragraphs. Claude does the editing under strict rules; its answer is kept only if it adds nothing the source
 * doesn't say (no new numbers or names). Without Claude, or when its answer fails that check, whole sentences of
 * the source are used as they are and the result is marked as unedited, for the owner to look at.
 */
export interface EditedStory { heading: string; paragraphs: string[]; method: 'edited' | 'extracted' }

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** "About CALIBER RESTORATION" → "About Caliber Restoration": a heading shouldn't shout the business's name. */
export function tidyHeading(heading: string, name: string): string {
  const h = heading.replace(/\s+/g, ' ').trim();
  if (!h) return `About ${name}`;
  if (h.toLowerCase().includes(name.toLowerCase())) return h.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), name);
  return h === h.toUpperCase() ? h.charAt(0) + h.slice(1).toLowerCase() : h;
}

const CLAIM = /\b(award|best|#1|number one|guarantee|licensed|insured|warranty|24\/7|founders?|owners?|family[- ]owned|veterans?|years)\b/i;

/** Numbers and capitalised names in the edit must be in the source; nothing may be longer than a short paragraph. */
export function faithful(source: string, paragraphs: string[], name: string): string | undefined {
  if (!paragraphs.length || paragraphs.length > 3) return 'wrong number of paragraphs';
  const src = new Set(words(`${source} ${name}`));
  for (const p of paragraphs) {
    if (p.length < 40 || p.length > 420) return 'a paragraph is too short or too long';
    for (const n of p.match(/\d[\d,.]*/g) ?? []) if (!source.includes(n)) return `the number ${n} is not in the source`;
    for (const w of p.match(/(?<=[a-z,;]\s)[A-Z][a-z]{2,}/g) ?? []) if (!src.has(w.toLowerCase())) return `"${w}" is not in the source`;
    if (CLAIM.test(p) && !CLAIM.test(source)) return 'a claim the source does not make';
  }
  const kept = new Set(paragraphs.flatMap(words));
  const novel = [...kept].filter((w) => w.length > 4 && !src.has(w));
  if (novel.length > Math.max(12, kept.size * 0.45)) return `too many words that are not in the source (${novel.slice(0, 4).join(', ')})`;
  return undefined;
}

/** The fallback: whole sentences, grouped into at most two short paragraphs. Not edited: flagged as such. */
export function extractParagraphs(text: string, max = 2): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?=\s|$)/g)?.map((s) => s.trim()) ?? [];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > 260) { out.push(cur); cur = s; if (out.length >= max) break; } else cur = `${cur} ${s}`.trim();
  }
  if (cur && out.length < max) out.push(cur);
  return out.slice(0, max);
}

export async function editStory(src: { name: string; heading: string; text: string }): Promise<EditedStory> {
  const heading = tidyHeading(src.heading, src.name);
  const fallback = (): EditedStory => ({ heading, paragraphs: extractParagraphs(src.text), method: 'extracted' });
  if (src.text.length < 200) return { heading, paragraphs: [src.text.trim()], method: 'extracted' };
  const r = await claudeJson<{ paragraphs: string[] }>({
    system: 'You edit the "about" text of a small business website into a short, faithful section for a new website. Rules: write in plain, professional third person ("the company", or the business name); 2 short paragraphs (max 3), each under 60 words; keep only what the source says: why the business started, what it does, how it works; no slang, profanity or hype; do not add facts, numbers, names, roles (such as founders or owners), awards, guarantees or promises that are not in the source; do not reuse the business\'s tagline; keep the meaning of every claim you keep.',
    prompt: `Business: ${src.name}\n\nSource text:\n${src.text.slice(0, 3000)}`,
    toolName: 'about_section',
    toolDescription: 'the edited About section: {"paragraphs": string[]}',
    schema: { type: 'object', properties: { paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } }, required: ['paragraphs'], additionalProperties: false },
    maxTokens: 700,
  });
  const paragraphs = (r?.data.paragraphs ?? []).map((p) => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const problem = r ? faithful(src.text, paragraphs, src.name) : 'Claude is unavailable';
  if (problem) { if (r) console.warn(`[story] edit rejected: ${problem}`); return fallback(); }
  return { heading, paragraphs, method: 'edited' };
}
