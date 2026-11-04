import { faithful } from '../../content/story.js';
import type { Catalog } from './review.js';
import { unsupportedActions } from '../../content/action-claims.js';

/**
 * Checks on the words a concept adds (headlines, eyebrows, section titles and intros, the shortened story). Written
 * copy may frame the business's facts; it may not add any. So every number must be one the catalog states, every
 * proper name one the evidence uses, and every claim word (best, licensed, guarantee, award, family-owned...) one the
 * business itself uses.
 */

const CLAIM = /\b(award(?:-winning)?|best|#1|number one|guarantee[ds]?|licensed|insured|bonded|warrant(?:y|ies)|24\/7|certified|accredited|family[- ]owned|locally owned|veteran[- ]owned|years?|since|decades?|top[- ]rated|leading|premier|trusted|voted|favou?rite|cheapest|lowest|free|organic|authentic|famous|largest)\b/gi;
const LIMITS: Record<string, number> = { 'hero.eyebrow': 48, 'hero.headline': 90, 'hero.subline': 220, title: 60, intro: 240, 'story.text': 1100 };
const vocab = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * What the business and its listing say: the facts, the story, the photos' own captions. Not the AI summary, which is
 * itself written copy: a claim it added would otherwise pass from it into the page.
 */
export function evidenceOf(cat: Catalog) {
  return [cat.allowedText, cat.rating ? 'Google rating reviews' : '', cat.business.name, cat.business.category ?? '', cat.story?.text ?? '', ...cat.photos.map((p) => p.alt)].join('\n');
}
/** "family owned", "family-owned" and "Family Owned" are one claim */
const claimForm = (s: string) => norm(s).replace(/[-\s]+/g, ' ');

/** Problems with one piece of written copy; empty when it only frames the facts. */
export function checkCopy(text: string, slot: string, cat: Catalog, evidence = evidenceOf(cat)): string[] {
  const out: string[] = [];
  const limit = LIMITS[slot] ?? LIMITS[slot.split('.').pop()!] ?? 240;
  if (text.length > limit) out.push(`${slot} is ${text.length} characters; at most ${limit}`);
  const ev = norm(evidence);
  const words = vocab(evidence);
  for (const raw of text.match(/\d[\d,.:]*/g) ?? []) {
    const n = raw.replace(/[.,:]+$/, '');
    if (!cat.allowedText.includes(n) && !cat.allowedText.includes(n.replace(/,/g, ''))) out.push(`${slot}: the number "${n}" is not a fact in the brief`);
  }
  // a capitalised word that is not the first of its sentence is a name: it must be one the evidence uses
  for (const m of text.matchAll(/(?<=[a-z0-9,;:&'’)]\s)([A-Z][\p{L}'’]+)/gu)) {
    const w = norm(m[1]).replace(/['’]s$/, '');
    if (!words.has(w) && !['i'].includes(w)) out.push(`${slot}: "${m[1]}" is not a name the business or its listing uses`);
  }
  const evClaims = claimForm(ev);
  for (const m of text.matchAll(CLAIM)) if (!new RegExp(`\\b${claimForm(m[1]).replace(/[#/]/g, (c) => `\\${c}`)}\\b`, 'i').test(evClaims)) out.push(`${slot}: "${m[1]}" is a claim the business does not make`);
  // what the business does for customers (reserve, book, deliver, discount...) only when its own sources say it
  for (const u of unsupportedActions(text, [evidence, ...cat.actions.map((a) => a.label)].join('\n'))) out.push(`${slot}: "${u.said}" claims ${u.label}, which the business's own sources don't state`);
  for (const p of cat.forbidden.phones) if (text.replace(/\D/g, '').includes(p.replace(/\D/g, '').slice(-7))) out.push(`${slot}: mentions a disputed phone number`);
  return [...new Set(out)];
}

/** A shortened story: the copy checks, and the faithfulness check against the business's own story. */
export function checkStory(text: string, cat: Catalog): string[] {
  const out = checkCopy(text, 'story.text', cat);
  if (!cat.story) return [...out, 'there is no story to shorten'];
  const groups: string[] = [];
  for (const s of text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text]) {
    const last = groups[groups.length - 1];
    if (last !== undefined && (last.length < 40 || `${last} ${s.trim()}`.length <= 420)) groups[groups.length - 1] = `${last} ${s.trim()}`;
    else groups.push(s.trim());
  }
  const problem = groups.length > 3 ? 'it is longer than three short paragraphs' : faithful(`${cat.story.text} ${cat.business.name}`, groups, cat.business.name);
  return problem ? [...out, `story: ${problem}`] : out;
}
