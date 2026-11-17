/**
 * The pre-delivery media and claim gate (pipeline revision 2 and later).
 *
 * Photos: each verified photo's subject (what the saved photo check saw) is read before any page is written. Photos that
 * must never reach a client's site are withheld with the rule and reason: before-and-after body imagery, selfies and
 * other body or portrait shots of identifiable people, and pictures suggesting a facility or outcome the business's own
 * verified text does not state. A photo whose subject is uncertain (not described, or a person as the main subject) is
 * also withheld and flagged for staff review; while any photo is flagged the preview is not sent to the customer
 * automatically. Withheld photos are removed from the version's photo set and recorded on it, so no later edit or
 * refinement can show them again (an unknown photo fails the page checks).
 *
 * Copy: Claude's own text may not infer ownership of photos, membership, results, amenities, classes or trainers from a
 * Google photo or the business category. A word in these groups is allowed only where the business's own verified text
 * (its name, category, summary, own lines, offerings, story) already uses it.
 *
 * Rule-based on purpose: no new AI call, deterministic, and the same verdict every time for the same saved evidence.
 */
import type { Photo } from '../concepts/review.js';
import type { FrontendInput } from './page.js';

export type GateAction = 'withhold' | 'review';
export interface PhotoDecision { id: string; action: GateAction; rule: string; reason: string; seen?: string; at: string }

const GENERIC_ALT = /^photo of .* from google maps$/i;
/** what is known about a photo's subject: the photo check's description, or a real (non-generic) description */
const subjectOf = (p: Photo) => [p.seen, p.alt && !GENERIC_ALT.test(p.alt.trim()) ? p.alt : ''].filter(Boolean).join('. ').trim();

/** the business's own verified words, lower-cased: the only place an amenity, membership or result may come from */
export function verifiedText(input: FrontendInput): string {
  return [input.business.name, input.business.category, input.business.summary, ...input.ownLines,
    ...input.services.flatMap((s) => [s.name, s.description]), ...input.items.flatMap((i) => [i.section, i.name, i.description]),
    input.story?.text, input.facts.story].filter(Boolean).join(' \n ').toLowerCase();
}
/** is a term (or its singular/plural) used by the business's own verified text? */
const verified = (term: string, text: string) => {
  const t = term.toLowerCase().replace(/[’']/g, "'").trim(), base = t.replace(/(?:es|s)$/, '');
  return new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')}(?:e?s)?\\b`).test(text);
};

const PERSON = String.raw`(?:man|men|woman|women|person|guy|girl|boy|lady|child|children|kid|kids|teen|trainer|coach|instructor|athlete|member|customer|client|bodybuilder|couple|family)`;
const SCENE = /\b(?:interior|floor|gym|room|hall|area|space|studio|shop|store|shopfront|storefront|entrance|signs?|signage|cars?|road|outside|aisles?|shelves|roof|counter|kitchen|dining|seating|exterior|building|street|facility|equipment|machines?|racks?|weights?|treadmills?|tables?|bar|stage|venue)\b/;
/** facilities a photo can suggest but only the business's own text can state */
export const AMENITY = /\b(?:kids?|children|child|creche|crèche|daycare|childcare|play ?(?:area|room|zone|ground)|playground|ball pit|pool|swimming|sauna|steam room|jacuzzi|hot tub|spa|massage|caf[eé]|juice bar|smoothie bar|restaurant|parking|car park|lockers?|showers?|changing rooms?|boxing ring|wi-?fi|rooftop|terrace|nursery)\b/gi;
const OUTCOME = /\b(?:trophy|trophies|medals?|awards?|certificates?|winners?|competitions?|podium|champions?(?:hip)?|results?)\b/i;
const SERVICE = /(?<![-\w])(?:class|classes|trainers?|coach(?:es|ing)?|instructors?|personal training|sessions?)\b/i;

/** the gate's verdict on one photo: undefined when it may be used */
export function photoVerdict(p: Photo, input: FrontendInput): { action: GateAction; rule: string; reason: string } | undefined {
  const s = subjectOf(p).toLowerCase(), text = verifiedText(input);
  if (!s) return { action: 'review', rule: 'undescribed', reason: 'the photo check did not describe its subject, so it cannot be cleared for a client page' };
  if (/before[\s-]*(?:and|&|\/|vs\.?|to)?[\s-]*after|transformation|progress (?:photo|pic|picture|shot)|weight[- ]loss/.test(s)) return { action: 'withhold', rule: 'before-after', reason: 'before-and-after body imagery: an implied results claim showing an identifiable person' };
  if (/\bselfies?\b/.test(s)) return { action: 'withhold', rule: 'selfie', reason: 'an identifiable customer selfie' };
  if (/\b(?:shirtless|topless|bare[- ]chested|flexing|physique|swimsuit|bikini|underwear|lingerie)\b/.test(s)) return { action: 'withhold', rule: 'body', reason: 'body imagery of an identifiable person' };
  if (new RegExp(`\\b${PERSON}\\b`).test(s) && /\b(?:portrait|close-?up|headshot|face|faces|smiling|posing|poses|posed)\b/.test(s)) return { action: 'withhold', rule: 'portrait', reason: 'a portrait of an identifiable person' };
  const amenity = [...s.matchAll(AMENITY)].map((m) => m[0]).find((a) => !verified(a, text));
  if (amenity) return { action: 'withhold', rule: 'unverified-facility', reason: `suggests a facility the business's own text does not state ("${amenity}")` };
  const outcome = s.match(OUTCOME)?.[0];
  if (outcome && !verified(outcome, text)) return { action: 'withhold', rule: 'unverified-outcome', reason: `suggests an outcome or achievement the business's own text does not state ("${outcome}")` };
  const service = s.match(SERVICE)?.[0];
  if (service && !verified(service, text)) return { action: 'withhold', rule: 'unverified-service', reason: `suggests ${service} the business's own text does not offer` };
  // a person as the picture's subject (not people seen in a wider scene of the place): who it is and whether they agreed
  // to be on the business's site is unknown
  if (new RegExp(`^(?:an? |the |one |two |three |several )?(?:young |older |smiling )?${PERSON}\\b`).test(s) || (new RegExp(`\\b${PERSON}\\b`).test(s) && !SCENE.test(s))) return { action: 'review', rule: 'person-subject', reason: 'a person is the main subject; staff must confirm the photo is suitable' };
  return undefined;
}

/** the gate over a version's photos: the photos that may be used, and every withheld photo with its rule and reason */
export function gatePhotos(input: FrontendInput, at = new Date().toISOString()): { input: FrontendInput; decisions: PhotoDecision[] } {
  const decisions: PhotoDecision[] = [];
  for (const p of input.photos) {
    const v = photoVerdict(p, input);
    if (v) decisions.push({ id: p.id, ...v, ...(p.seen ? { seen: p.seen } : {}), at });
  }
  const out = new Set(decisions.map((d) => d.id));
  return { input: { ...input, photos: input.photos.filter((p) => !out.has(p.id)) }, decisions };
}

/** Claude's copy inferring what a photo cannot show: ownership, membership, results, amenities, classes or trainers */
const INFERENCE: { re: RegExp; what: string; always?: boolean }[] = [
  { re: /\b(?:our|their|(?:the|this) (?:club|gym|studio|team|business|shop|bakery|restaurant|owner|salon)['’]s) own (?:photos?|pictures?|images?|shots?)\b/gi, what: 'that the photos are the business\'s own (they are Google listing photos)', always: true },
  { re: /\b(?:members?|membership)\b/gi, what: 'membership' },
  { re: /\b(?:results?|transformations?|before[- ](?:and|&)[- ]after|weight[- ]loss)\b/gi, what: 'results' },
  { re: AMENITY, what: 'an amenity' },
  { re: /(?<![-\w])(?:class|classes|trainers?|coach(?:es|ing)?|instructors?|personal training)\b/gi, what: 'classes or trainers' },
];
/** one element's own text around a position in the ' | '-joined page text (the sentence to rewrite) */
const segmentAt = (prose: string, at: number) => prose.slice(prose.lastIndexOf('|', at) + 1, (prose.indexOf('|', at) + 1 || prose.length + 1) - 1).replace(/\s+/g, ' ').trim().slice(0, 160);
const sameCase = (word: string, like: string) => (like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
/** what to write instead: what a photo actually shows, never what it is taken to mean */
function instead(word: string, sentence: string, what: string): string {
  const w = word.toLowerCase();
  if (/^members?$/.test(w)) {
    const by = /review|rated|rating|written|say/i.test(sentence) ? (w === 'member' ? 'reviewer' : 'reviewers') : (w === 'member' ? 'person' : 'people');
    return `Rewrite it as "${sentence.replace(new RegExp('\\b' + word + '\\b'), sameCase(by, word))}": say what the photo shows (people training, the floor, the equipment), not who they are.`;
  }
  if (/membership/.test(w)) return 'Remove it: the business\'s own text says nothing about membership.';
  if (/own (photos?|pictures?|images?|shots?)/.test(w)) return `Rewrite it as "${sentence.replace(word, sameCase('photos from the Google listing', word))}".`;
  if (what === 'results') return 'Remove it: describe the equipment or the space the photo shows instead of an outcome.';
  if (what === 'an amenity') return `Remove it: the business's own text does not mention a ${w}.`;
  if (what === 'classes or trainers') return 'Remove it: describe the equipment or the space instead.';
  return 'Remove it.';
}
/**
 * Each sentence that infers what a photo cannot show, quoted with its page, and how to rewrite it (the rule is not
 * relaxed: the pictured people are never called members, and nothing is inferred).
 */
export function inferenceProblems(prose: string, input: FrontendInput, page = 'home'): string[] {
  const text = verifiedText(input), hits: string[] = [];
  for (const rule of INFERENCE) for (const m of prose.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
    if (!rule.always && verified(m[0], text)) continue;
    const sentence = segmentAt(prose, m.index!);
    hits.push(`"${sentence}" uses "${m[0]}", which infers ${rule.what}. ${instead(m[0], sentence, rule.what)}`);
  }
  return hits.length ? [`On the ${page} page, the copy infers what a photo or the category cannot show: ${[...new Set(hits)].slice(0, 6).join(' ')} Use the business's own verified words or describe only what is visible.`] : [];
}
