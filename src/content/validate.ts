import type { Business, WebsiteScan } from '../types.js';
import type { ClaudeRun } from './extraction.js';
import { geographicReason, nameSimilarity } from '../sources/identity.js';
import { phoneKey } from '../sources/site-content.js';
import { esc } from '../util/text.js';

/**
 * Checks that run before a site is delivered. A request that returned 200 and a screenshot that rendered prove the
 * page loads, not that it is the right page: these compare what the source said with what the site kept, and turn a
 * silent loss (a hidden section, a dropped service, a wrong phone) into a recovery or a review state.
 */
export interface BuildCheck {
  id: string;
  level: 'block' | 'review' | 'info';
  message: string;
  /** a gap that was found and filled in before delivery */
  recovered?: boolean;
}
export interface BuildReview { status: 'ready' | 'needs-review' | 'blocked'; checks: BuildCheck[] }

export const statusOf = (checks: BuildCheck[]): BuildReview['status'] => (checks.some((c) => c.level === 'block' && !c.recovered) ? 'blocked' : checks.some((c) => c.level === 'review' && !c.recovered) ? 'needs-review' : 'ready');

export interface BuildFacts {
  business: Business;
  scan?: WebsiteScan;
  /** services the site kept, in order */
  servicesKept: string[];
  photos: { discovered: number; kept: number; failures: number };
  videos: { discovered: number; kept: number };
  booking?: { url: string };
  hidden: Record<string, string>;
  claude?: ClaudeRun;
  /** pictures found on the website's service cards: how many, how many were usable (fetched, big enough) */
  serviceImages?: { discovered: number; usable: number; failures: number };
  /** brand colours the website's rendered styles show (high or medium confidence), when they were measured */
  brand?: { found: string[] };
}

/** Identity, contact consistency and retention of what the source showed. */
export function checkBuild(f: BuildFacts): BuildReview {
  const checks: BuildCheck[] = [];
  const b = f.business;
  const c = f.scan?.content;
  const add = (id: string, level: BuildCheck['level'], message: string, recovered?: boolean) => checks.push({ id, level, message, ...(recovered ? { recovered } : {}) });

  const geo = b.source === 'mock' ? undefined : geographicReason({ name: b.name, types: b.types, primaryType: b.primaryType, primaryTypeLabel: b.primaryTypeLabel, formattedAddress: b.formattedAddress });
  if (geo) add('identity-place', 'block', `The business identity is a place, not a business: ${geo}.`);
  if (c?.identity.name && b.source !== 'mock') {
    const sim = Math.max(...c.identity.names.map((n) => nameSimilarity(b.name, n.name)), 0);
    if (sim < 0.5) add('identity-source', 'block', `The business is named "${b.name}" but its website says "${c.identity.name}".`);
  }
  if (!b.phone && !b.formattedAddress) add('contact-none', 'block', 'No phone number or address for this business: visitors would have no way to reach it.');
  if (c?.phones.primary && b.phone && phoneKey(c.phones.primary) !== phoneKey(b.phone)) add('phone-differs', 'review', `Google lists ${b.phone} but the website shows ${c.phones.primary}. Confirm which one visitors should call.`);
  if (c?.phones.primary && !b.phone) add('phone-missing', 'block', `The website shows ${c.phones.primary} but the site has no phone number.`);
  if (c?.address && b.formattedAddress && !b.formattedAddress.includes(c.address.zip) && b.source !== 'mock') add('address-differs', 'review', `The website's address (${c.address.formatted}) is not the one used (${b.formattedAddress}).`);
  if (c?.address && !b.formattedAddress) add('address-missing', 'block', `The website gives an address (${c.address.formatted}) that the site does not use.`);

  const found = c?.services.length ?? 0;
  if (found && f.servicesKept.length < found) add('services-dropped', 'block', `The website lists ${found} services; the site keeps ${f.servicesKept.length}.`);
  else if (found) add('services', 'info', `All ${found} services from the website are on the site.`);
  else if (f.scan?.ok) add('services-none', 'review', 'No list of services could be read from the website: the services section needs to be filled in.');
  if (found && f.hidden.services) add('services-hidden', 'block', `The services section is hidden (${f.hidden.services}) although the website lists ${found}.`);

  if (f.photos.discovered && !f.photos.kept) add('photos-none', 'review', `The website shows ${f.photos.discovered} photo${f.photos.discovered > 1 ? 's' : ''}, but none could be used${f.photos.failures ? ` (${f.photos.failures} failed to download)` : ''}.`);
  else if (f.photos.discovered && f.photos.kept < f.photos.discovered) add('photos-partial', 'info', `${f.photos.kept} of ${f.photos.discovered} website photos are used; the rest were icons or graphics, duplicates, under-sized or failed to download.`);
  if (f.videos.discovered && f.videos.kept < f.videos.discovered) add('videos-dropped', 'review', `The website has ${f.videos.discovered} videos; the site shows ${f.videos.kept}.`);
  if (c?.booking.primary && !f.booking) add('booking-dropped', 'block', `The website's booking address (${c.booking.primary.url}) is missing from the site.`);
  if (f.serviceImages && f.serviceImages.discovered && f.serviceImages.usable < f.serviceImages.discovered) add('service-images-lost', f.serviceImages.usable ? 'review' : 'review', `The website shows a picture on ${f.serviceImages.discovered} service${f.serviceImages.discovered > 1 ? 's' : ''}; ${f.serviceImages.usable} could be used${f.serviceImages.failures ? ` (${f.serviceImages.failures} failed to download)` : ''}.`);
  if (f.claude && f.claude.enabled && !f.claude.validated) add('claude-fallback', 'info', `Claude ${f.claude.ran ? "didn't produce a usable answer" : "didn't run"}: ${f.claude.fallbackReason || 'rules answered instead'}.`);
  if (f.hidden.proof && !b.reviews.length) add('no-reviews', 'info', 'No Google reviews are available, so there is no reviews section.');
  return { status: statusOf(checks), checks };
}

/**
 * The finished page against what was expected of it: every service named, the booking address linked, the phone
 * and the street shown. Anything absent is a check that fails, not a section that quietly disappears.
 */
export function checkOutput(html: string, expect: { services: string[]; bookingUrl?: string; phone?: string; street?: string; name?: string; /** the website's own brand colours: they must reach the page's styles */ brandColors?: string[]; /** service pictures that were usable: each must be on a card */ serviceImages?: number; /** the website's main call to action: its words must be on the page */ ctaLabel?: string }): BuildCheck[] {
  const out: BuildCheck[] = [];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const lower = text.toLowerCase().replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  const missing = expect.services.filter((s) => !lower.includes(esc(s).toLowerCase().replace(/&amp;/g, '&').replace(/&#39;/g, "'")) && !lower.includes(s.toLowerCase()));
  if (missing.length) out.push({ id: 'output-services', level: 'block', message: `The page does not show ${missing.length} of the website's services: ${missing.slice(0, 4).join(', ')}.` });
  if (expect.bookingUrl && !html.includes(expect.bookingUrl)) out.push({ id: 'output-booking', level: 'block', message: `The page does not link the website's booking address (${expect.bookingUrl}).` });
  if (expect.phone && !html.replace(/\D/g, '').includes(phoneKey(expect.phone))) out.push({ id: 'output-phone', level: 'block', message: `The page does not show the phone number ${expect.phone}.` });
  if (expect.street && !lower.includes(expect.street.toLowerCase().split(',')[0])) out.push({ id: 'output-address', level: 'block', message: 'The page does not show the street address.' });
  // the brand: its primary and accent colours must be in the page's own styles, not replaced by a default palette
  const lostBrand = (expect.brandColors ?? []).filter((c) => !new RegExp(c.replace('#', '#?'), 'i').test(html));
  if (lostBrand.length) out.push({ id: 'output-brand', level: 'block', message: `The website's brand colour${lostBrand.length > 1 ? 's' : ''} ${lostBrand.join(', ')} ${lostBrand.length > 1 ? 'are' : 'is'} missing from the page's styles.` });
  if (expect.serviceImages) {
    const cards = (html.match(/class="f-svc-media"[^>]*><img/g) || []).length;
    if (cards < expect.serviceImages) out.push({ id: 'output-service-images', level: 'block', message: `${expect.serviceImages} service pictures were recovered but only ${cards} appear on the service cards.` });
  }
  if (expect.ctaLabel && !lower.includes(expect.ctaLabel.toLowerCase())) out.push({ id: 'output-cta', level: 'block', message: `The website's main call to action ("${expect.ctaLabel}") is not on the page.` });
  // a call to action that isn't a link: "Request a quote" sitting as loose text
  const loose = (text.match(/<(?:span|p|div)[^>]*class="[^"]*is-quote[^"]*"[^>]*>[^<]*<\/(?:span|p|div)>/gi) || []).filter((x) => /quote|book|call|request|inspection/i.test(x));
  if (loose.length) out.push({ id: 'output-inert-cta', level: 'block', message: `${loose.length} call${loose.length > 1 ? 's' : ''} to action on the page ${loose.length > 1 ? 'are' : 'is'} not a link.` });
  const noSrc = (html.match(/<img\b[^>]*\bsrc=""/gi) || []).length;
  if (noSrc) out.push({ id: 'output-empty-image', level: 'block', message: `${noSrc} image${noSrc > 1 ? 's have' : ' has'} no file.` });
  if (expect.name && /\(\s*555\s*\)\s*010-?0\d\d\d|555-01\d\d/.test(html)) out.push({ id: 'output-placeholder-phone', level: 'block', message: 'The page contains a placeholder (fictional 555) phone number.' });
  return out;
}
