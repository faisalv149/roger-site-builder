/**
 * What a business does for customers (takes reservations or bookings, delivers, has availability, gives discounts,
 * takes orders online) is a claim. Copy may say it only when the business's own sources say it: its website text,
 * its booking link, or the owner. A Google category or a review is not enough ("call to reserve your evening" on a
 * restaurant that has never said it takes reservations is invented).
 */
export const ACTION_CLAIMS: { id: string; label: string; re: RegExp }[] = [
  { id: 'reservations', label: 'reservations', re: /\b(reserv(?:e|es|ed|ing|ation|ations)|book (?:a|your) table|table bookings?)\b/i },
  { id: 'booking', label: 'bookings or appointments', re: /\b(book(?:ing|ings|ed)?(?: now| online| in| a| an| your)?|appointments?|schedul(?:e|ing) (?:a|your))\b/i },
  { id: 'delivery', label: 'delivery', re: /\b(deliver(?:y|ies|s|ed|ing)?|doorstep|foodpanda|uber ?eats|door ?dash|deliveroo)\b/i },
  { id: 'availability', label: 'availability', re: /\b(available (?:today|now|24\/7|anytime)|open now|same[- ]day|next[- ]day|walk[- ]ins?|no wait(?:ing)?|on short notice)\b/i },
  { id: 'discount', label: 'discounts or offers', re: /\b(discounts?|\d+\s?% off|special offers?|promo(?:tion)?s?|coupons?|deals?|on sale|half[- ]price)\b/i },
  { id: 'ordering', label: 'ordering online or takeaway', re: /\b(order (?:online|now|ahead)|takeaway|take[- ]?out|pick[- ]?up|curbside)\b/i },
];

/** The action claims in text that the business's own sources don't make (by id, with a readable label). */
export function unsupportedActions(text: string, sourceText: string): { id: string; label: string; said: string }[] {
  const out: { id: string; label: string; said: string }[] = [];
  for (const c of ACTION_CLAIMS) {
    const m = text.match(c.re);
    if (m && !c.re.test(sourceText)) out.push({ id: c.id, label: c.label, said: m[0] });
  }
  return out;
}
