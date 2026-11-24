/**
 * Which Google reviews the page may show ("Selected reviews"): 4 and 5 stars, verbatim (trimmed only with an
 * ellipsis), with the reviewer's name and a link to the review on Google. Skipped: reviews that mention a health
 * condition, name another person, or complain. The review text itself is never stored in the page: the selection is
 * by position in Google's live list, and the page's slots are filled at serve time.
 */
import type { LiveReview } from '../sources/places.js';

export interface ReviewChoice { selected: { index: number; review: LiveReview; text: string }[]; skipped: { index: number; reason: string }[]; howChosen: string }

const HEALTH = /\b(diagnos\w*|cancer|diabet\w*|depress\w*|anxiety|pregnan\w*|surger\w*|injur\w*|disease|illness|medication|prescription|chronic|adhd|autism|ptsd|infection|tumou?r|stroke|seizure|allergic reaction|miscarriage|disorder|rehab\w*|addiction)\b/i;
const COMPLAINT = /\b(unfortunately|disappoint\w*|rude|never again|worst|terrible|horrible|awful|not happy|refund|complain\w*|overpriced|waited (?:over|for|an?)|problem with|issue with|however|but the|would not recommend|wouldn't recommend)\b/i;
/** "ask for Sam", "thanks to Maria": a person named after a phrase that introduces one (any case), the name capitalised */
const ASK_FOR = /\b(?:ask for|thanks to|thank you|shout ?out to|kudos to)\s+(\S+)/i;
/** "Jordan was great": a capitalised word mid-sentence followed by what a person does */
const NAMED = /(?<![.!?]\s|^)\b[A-Z][a-z]{2,}\s+(?:was|is|did|helped|took|made|went|explained|fixed|cut|styled|treated)\b/;
const NOT_NAMES = new Set(['The', 'This', 'They', 'Their', 'Everyone', 'Everything', 'Staff', 'Service', 'Food', 'Place', 'Team', 'Price', 'Work', 'Job', 'Owner', 'Manager', 'Shop', 'Store', 'Salon', 'Office', 'Experience', 'Atmosphere', 'Location']);

/** trim to at most max characters at a word boundary, ending with an ellipsis */
export function trimReview(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${cut.replace(/[,;:.\s]+$/, '')}…`;
}

export function selectReviews(reviews: LiveReview[], opts: { names?: string[]; max?: number; hide?: boolean } = {}): ReviewChoice {
  const howChosen = 'Selected from recent 4- and 5-star Google reviews.';
  if (opts.hide) return { selected: [], skipped: reviews.map((_, index) => ({ index, reason: 'reviews are not shown for this trade' })), howChosen };
  const names = (opts.names ?? []).map((n) => n.trim()).filter((n) => n.length > 1);
  const selected: ReviewChoice['selected'] = [], skipped: ReviewChoice['skipped'] = [];
  reviews.forEach((review, index) => {
    const text = review.text ?? '';
    const asked = ASK_FOR.exec(text);
    const named = asked && /^[A-Z][a-z]+/.test(asked[1]) ? [asked[1]] : NAMED.exec(text);
    const reason = review.rating < 4 ? 'under 4 stars'
      : text.trim().length < 30 ? 'too short to quote'
      : HEALTH.test(text) ? 'mentions a health condition'
      : COMPLAINT.test(text) ? 'contains a complaint'
      : names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) || (named && !NOT_NAMES.has(named[0].split(/\s+/).pop()!) && !NOT_NAMES.has(named[0].split(/\s+/)[0])) ? 'names another person'
      : '';
    if (reason) skipped.push({ index, reason });
    else if (selected.length < (opts.max ?? 4)) selected.push({ index, review, text: trimReview(text) });
  });
  return { selected, skipped, howChosen };
}
