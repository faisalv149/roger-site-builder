import type { BuildReview } from './validate.js';

/**
 * What Roger says about a finished preview, written from what the build actually obtained. It never mentions Google
 * photos, reviews or hours that weren't there, and never says the preview "fixes" problems that weren't measured.
 */
export interface Obtained {
  name: string;
  /** where the business information came from */
  identitySource: 'google' | 'website' | 'mock';
  googlePhotos: number;
  websitePhotos: number;
  googleReviews: number;
  hoursKnown: boolean;
  services: number;
  videos: number;
  hasStory: boolean;
  bookingLinked: boolean;
  hadWebsite: boolean;
  /** the old site was audited (kept for callers; the message makes no claim about fixing what the audit found) */
  auditIssues?: number;
}

const list = (parts: string[]) => (parts.length <= 1 ? parts[0] || '' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function usedSummary(o: Obtained): string {
  const parts: string[] = [];
  if (o.services) parts.push(`${o.identitySource === 'website' ? 'the' : 'your'} ${n(o.services, 'service')} from your website`);
  if (o.websitePhotos) parts.push(`${n(o.websitePhotos, 'photo')} from your website`);
  if (o.googlePhotos) parts.push(`${n(o.googlePhotos, 'photo')} from your Google profile`);
  if (o.googleReviews) parts.push(`your Google reviews`);
  if (o.hoursKnown) parts.push('your opening hours');
  if (o.hasStory) parts.push('your story');
  if (o.videos) parts.push(n(o.videos, 'video'));
  return parts.length ? list(parts) : '';
}

/** The message that goes with the preview link. */
export function previewMessage(o: Obtained, review: BuildReview): string {
  const used = usedSummary(o);
  const open = o.hadWebsite ? `Here's a preview of a new site for ${o.name}.` : `Your free website preview for ${o.name} is ready.`;
  const body = used ? ` It uses ${used}.` : ' It uses the details found so far.';
  const gaps = review.checks.filter((c) => (c.level === 'block' || c.level === 'review') && !c.recovered);
  const missing = [
    !o.googlePhotos && !o.websitePhotos ? 'photos' : '',
    !o.googleReviews ? 'reviews' : '',
    !o.hoursKnown ? 'opening hours' : '',
  ].filter(Boolean);
  const notes = [
    o.identitySource === 'website' ? ' There was no Google listing to match, so everything comes from your website.' : '',
    missing.length ? ` I couldn't find ${list(missing)}, so ${missing.length === 1 ? 'that' : 'those'} ${missing.length === 1 ? 'is' : 'are'} left out rather than guessed.` : '',
    o.bookingLinked ? ' Booking goes to your existing online booking page.' : '',
    gaps.length ? ` A few things need your check before it goes live: ${gaps.slice(0, 2).map((g) => g.message.replace(/\.$/, '')).join('; ')}.` : '',
  ].join('');
  return `${open}${body}${notes}`;
}
