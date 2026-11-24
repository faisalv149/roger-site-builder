/**
 * Google content on a splash page: never stored, never written into the saved page. The page has slots, filled from
 * Google's live listing each time the page is served:
 *
 *   data-google="rating"        the rating ("4.9")
 *   data-google="review_count"  the number of reviews ("137")
 *   data-google="open_now"      "Open now" / "Closed now"
 *   data-google="hours_today"   today's hours ("Today: 10:00 AM – 7:00 PM")
 *   data-google="reviews"       Roger's "Selected reviews" block: each review verbatim (trimmed only with an ellipsis),
 *                               its author's name, avatar and profile link, its link on Google Maps, the full rating
 *                               and count, how the reviews were chosen, and the Google Maps attribution. Inside it, each
 *                               review's parts carry review.N.text / author / author_uri / avatar / maps_uri.
 *
 * Google photos use Roger's verified photo binding (data-photo), filled live with each photographer's credit.
 * Every container of Google content carries the Google Maps attribution (added when the page is compiled).
 */
import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { config } from '../config.js';
import type { LiveReview } from '../sources/places.js';
import { selectReviews } from './reviews.js';

export const TEXT_SLOTS = ['rating', 'review_count', 'open_now', 'hours_today'] as const;

/** at compile time: the Google Maps attribution beside every Google text slot (once per container) */
export function attributeGoogleSlots($: CheerioAPI, mapsUri: string | undefined) {
  const link = mapsUri ? `<a class="g-attr" href="${mapsUri.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">Google Maps</a>` : '<span class="g-attr">Google Maps</span>';
  const done = new Set<unknown>();
  $(TEXT_SLOTS.map((s) => `[data-google="${s}"]`).join(',')).each((_, el) => {
    const block = slotBlock($(el))[0];
    if (!block || done.has(block)) return;
    done.add(block);
    $(block).append(` <span class="g-src">· ${link}</span>`);
  });
}

/** the block a Google slot sits in (its line: a paragraph, list item, cell…): one attribution per block */
const BLOCKS = 'p,li,dd,dt,td,th,div,figcaption,blockquote,h1,h2,h3,h4,h5,h6,section,header,footer,aside,article,main';
function slotBlock(el: Cheerio<AnyNode>): Cheerio<AnyNode> { const b = el.parent().closest(BLOCKS); return b.length ? b : el.parent(); }

export interface LiveListing { rating?: number; userRatingCount?: number; reviews: LiveReview[]; openNow?: boolean; weekday?: string[]; utcOffsetMinutes?: number; mapsUri?: string }

/** the listing as Google has it now (Places API only; nothing is stored) */
export async function liveListing(placeId: string): Promise<LiveListing> {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': config.googleKey, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews,currentOpeningHours,regularOpeningHours,utcOffsetMinutes,googleMapsUri' } });
  if (!r.ok) throw new Error(`Google Places ${r.status}`);
  const p = await r.json() as Record<string, any>;
  return {
    rating: p.rating, userRatingCount: p.userRatingCount, mapsUri: p.googleMapsUri, utcOffsetMinutes: p.utcOffsetMinutes,
    openNow: p.currentOpeningHours?.openNow, weekday: p.currentOpeningHours?.weekdayDescriptions ?? p.regularOpeningHours?.weekdayDescriptions,
    reviews: (p.reviews ?? []).map((v: any) => ({ author: v.authorAttribution?.displayName || 'Google user', authorUri: v.authorAttribution?.uri, avatar: v.authorAttribution?.photoUri, text: v.text?.text || v.originalText?.text || '', rating: v.rating, when: v.relativePublishTimeDescription, mapsUri: v.googleMapsUri })),
  };
}

/** today's line of the week's hours, in the business's own time zone ("Today: 10:00 AM – 7:00 PM") */
export function hoursToday(weekday: string[] | undefined, utcOffsetMinutes: number | undefined, now = new Date()): string | undefined {
  if (!weekday?.length) return undefined;
  const local = new Date(now.getTime() + (utcOffsetMinutes ?? 0) * 60_000);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][local.getUTCDay()];
  const line = weekday.find((l) => l.startsWith(day));
  return line ? `Today: ${line.slice(day.length + 1).trim()}` : undefined;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stars = (n: number) => `<span class="g-review__stars" role="img" aria-label="${n} out of 5 stars">${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}</span>`;

/** the "Selected reviews" block, from the reviews that pass selection now (none: the block's screen keeps only the rating) */
export function reviewsBlock(live: LiveListing, opts: { names?: string[]; hide?: boolean; max?: number } = {}): string {
  const choice = selectReviews(live.reviews, { names: opts.names, hide: opts.hide, max: opts.max ?? 3 });
  if (!choice.selected.length) return '';
  const maps = live.mapsUri ? `<a class="g-attr" href="${esc(live.mapsUri)}" target="_blank" rel="noopener">Google Maps</a>` : 'Google Maps';
  const items = choice.selected.map(({ review: r, text }, i) => {
    const n = i + 1;
    const who = r.authorUri ? `<a data-google="review.${n}.author_uri" href="${esc(r.authorUri)}" target="_blank" rel="noopener"><span data-google="review.${n}.author">${esc(r.author)}</span></a>` : `<span data-google="review.${n}.author">${esc(r.author)}</span>`;
    return `<li class="g-review">${stars(r.rating)}<blockquote class="g-review__text" data-google="review.${n}.text"><p>“${esc(text)}”</p></blockquote>`
      + `<p class="g-review__by">${r.avatar ? `<img class="g-review__avatar" data-google="review.${n}.avatar" src="${esc(r.avatar)}" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer">` : ''}${who}`
      + `${r.mapsUri ? ` · <a data-google="review.${n}.maps_uri" href="${esc(r.mapsUri)}" target="_blank" rel="noopener">See it on Google Maps</a>` : ''}</p></li>`;
  }).join('');
  const total = live.rating && live.userRatingCount ? `<span class="g-reviews__total">${live.rating.toFixed(1)}★ from ${live.userRatingCount.toLocaleString('en-US')} Google reviews</span>` : '';
  return `<p class="g-reviews__label"><strong>Selected reviews</strong>${total ? ` · ${total}` : ''}</p><ul class="g-reviews__list">${items}</ul><p class="g-reviews__how">${esc(choice.howChosen)} Reviews from ${maps}.</p>`;
}

/** at serve time: every Google slot filled from the live listing; a slot with nothing live to show is removed */
export function fillGoogleSlots(html: string, live: LiveListing | null, opts: { names?: string[]; hideReviews?: boolean; now?: Date } = {}): string {
  if (!html.includes('data-google=')) return html;
  const $ = load(html);
  const text: Record<string, string | undefined> = {
    rating: live?.rating ? live.rating.toFixed(1) : undefined,
    review_count: live?.userRatingCount ? live.userRatingCount.toLocaleString('en-US') : undefined,
    open_now: live?.openNow === undefined ? undefined : live.openNow ? 'Open now' : 'Closed now',
    hours_today: live ? hoursToday(live.weekday, live.utcOffsetMinutes, opts.now) : undefined,
  };
  for (const [slot, value] of Object.entries(text)) {
    $(`[data-google="${slot}"]`).each((_, el) => {
      // the page already labels it, in any element of the same line ("Today: <slot>", "<b>Today</b> <slot>"): the bare hours
      if (value && slot === 'hours_today') {
        $(el).text('\u0000');
        const line = slotBlock($(el)).text();
        $(el).text(/today\s*:?\s*$/i.test(line.slice(0, line.indexOf('\u0000'))) ? value.replace(/^Today:\s*/, '') : value);
        return;
      }
      if (value) { $(el).text(value); return; }
      // nothing live: the slot goes, and its attribution with it when its block shows no other Google content
      const block = slotBlock($(el));
      $(el).remove();
      if (!block.find(TEXT_SLOTS.map((s) => `[data-google="${s}"]`).join(',')).length) block.find('.g-src').remove();
    });
  }
  $('[data-google="reviews"]').each((_, el) => {
    const block = live ? reviewsBlock(live, { names: opts.names, hide: opts.hideReviews }) : '';
    if (block) $(el).html(block); else $(el).remove();
  });
  return $.html();
}
