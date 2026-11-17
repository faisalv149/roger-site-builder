import { searchCandidates } from '../sources/places.js';
import type { BusinessCandidate } from '../types.js';
import { nameSimilarity } from '../sources/identity.js';

/**
 * A business name and/or address, resolved to one confirmed Google place ID with Roger's existing lookup
 * (searchCandidates: businesses only; postal codes, towns and streets are set aside), before any research starts.
 *
 *   confirmed   a place ID or Google Maps link; or one business whose name matches the name given (and whose address
 *               agrees with the ZIP and street number given): the same listing the Google-only flow designs from
 *   choose      several businesses match, or none matches the name exactly: the user picks one (its place ID)
 *   need-name   a ZIP code, a street address or a town alone: never a confirmed business. The businesses found there,
 *               if any, are offered to choose from; with none, the user is asked for the business name
 *   not-found   Google found no business for it
 */
export interface BusinessInput { text?: string; name?: string; address?: string; placeId?: string }
export type Resolution =
  | { status: 'confirmed'; placeId: string; candidate: BusinessCandidate; via: 'place-id' | 'name-and-address' | 'name'; evidence: string[]; query: string }
  | { status: 'choose' | 'need-name' | 'not-found'; candidates: BusinessCandidate[]; reason: string; query: string };

const ZIP = /\b\d{5}(?:-\d{4})?\b/;
/** an input that names only a place: a ZIP code, a street address (it starts with a house number), or "Town, ST" */
const LOCATION_ONLY = [/^\d{5}(?:-\d{4})?$/, /^\d{1,6}[A-Za-z]?\s+\S/, /^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/];
export const locationOnly = (text: string) => LOCATION_ONLY.some((re) => re.test(text.trim()));

/** what the input says: the business name (if any), the ZIP and street number to hold a match to, and the search text */
export function parseBusinessInput(i: BusinessInput): { name?: string; address?: string; zip?: string; streetNumber?: string; query: string; locationOnly: boolean } {
  let name = i.name?.trim() || undefined;
  let address = i.address?.trim() || undefined;
  const text = i.text?.trim();
  if (text && !name && !address) {
    if (locationOnly(text)) address = text;
    else {
      // "Name, 3409 E 5th St, Austin TX 78702" or "Name 78702": the name is what comes before the address
      const head = text.split(',')[0].replace(ZIP, '').replace(/\s+\d{1,6}[A-Za-z]?\s+\S.*$/, '').trim();
      name = head || undefined;
      const rest = text.slice(text.indexOf(head) + head.length).replace(/^[\s,]+/, '').trim();
      address = rest || undefined;
    }
  }
  const zip = address?.match(ZIP)?.[0]?.slice(0, 5);
  const streetNumber = address?.match(/(?:^|,\s*)(\d{1,6}[A-Za-z]?)\s+(?!\d{4}\b)[A-Za-z]/)?.[1];
  const query = text && !i.name && !i.address ? text : [name, address].filter(Boolean).join(', ');
  return { name, address, zip, streetNumber, query, locationOnly: !name && !!address };
}

/** words in an address that say what kind of street or unit it is, not which one */
const STREET_WORD = /^(st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place|block|blk|sector|phase|plot|house|main|n|s|e|w|north|south|east|west|ne|nw|se|sw|no|floor|fl|unit|suite|ste|apt|flat|bldg|building|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|sq|square)$/i;
/** the words that name the street given ("63 S Imperial Block" → imperial; "12 Oak St" → oak) */
export function streetWords(address: string | undefined): string[] {
  const street = address?.split(',')[0].match(/^\s*#?\d{1,6}[A-Za-z]?\s+(.*)$/)?.[1];
  return street ? street.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STREET_WORD.test(w)) : [];
}
/**
 * Whether a listing's address agrees with the address given, on each part that was given: the street number and the
 * street, and the ZIP. A listing that shows no postal code (common outside the US) does not disagree on it, as long as
 * the street number given is there.
 */
export function addressAgrees(c: { address?: string }, p: { address?: string; zip?: string; streetNumber?: string }): boolean {
  const a = c.address ?? '';
  const listingZip = a.match(/\b\d{5}\b/g) ?? [];
  if (p.zip && !a.includes(p.zip) && (listingZip.length || !p.streetNumber)) return false;
  if (p.streetNumber && !new RegExp(`(^|[\\s,#])${p.streetNumber}\\s`, 'i').test(a)) return false;
  const words = p.streetNumber ? streetWords(p.address) : [];
  if (words.length && !words.some((w) => a.toLowerCase().includes(w))) return false;
  return true;
}
/**
 * A listing named after an address rather than a business ("645 Imperial Block 1", a house or plot someone pinned):
 * its name is a house number followed only by street words, numbers and words of the address. Such a listing is never
 * offered as the business, whatever Google ranks it. ("21 Bistro" or "7-Eleven" are businesses: their words are not.)
 */
export function addressNamed(c: { name?: string; address?: string }, given?: string): boolean {
  const rest = (c.name ?? '').trim().match(/^#?\d{1,6}[A-Za-z]?[\s,-]+(.+)$/)?.[1];
  if (!rest) return false;
  const where = `${c.address ?? ''} ${given ?? ''}`.toLowerCase();
  return rest.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every((w) => /^\d+[a-z]?$/.test(w) || STREET_WORD.test(w) || where.includes(w));
}
/** a name match strict enough to confirm: the same name (an exact or near-exact match, not a shared word) */
export const NAME_MATCH = 0.85;

export async function resolveBusiness(i: BusinessInput, deps: { search?: typeof searchCandidates } = {}): Promise<Resolution> {
  const search = deps.search ?? searchCandidates;
  // a place ID or a Google Maps link names one listing
  const direct = i.placeId?.trim();
  const p = parseBusinessInput(i);
  const query = direct || p.query;
  if (!query) return { status: 'need-name', candidates: [], reason: 'Give the business name, or its name and address.', query: '' };
  const found = await search(query, { limit: 5 });
  if (found.intent.kind === 'placeId') {
    const c = found.candidates[0];
    return c
      ? { status: 'confirmed', placeId: c.placeId, candidate: c, via: 'place-id', evidence: ['the link names this Google listing'], query }
      : { status: 'not-found', candidates: [], reason: found.rejected[0] ? `Google's result "${found.rejected[0].name}" is not a business: ${found.rejected[0].reason}` : 'Google found no business for that link', query };
  }
  const all = found.candidates;
  // a place alone (ZIP, street, town) is never a business: offer what is there, or ask for the name
  if (p.locationOnly) {
    return all.length
      ? { status: 'need-name', candidates: all, reason: `"${query}" is an address, not a business: choose the business, or add its name`, query }
      : { status: 'need-name', candidates: [], reason: `"${query}" is an address, not a business: send the business name too`, query };
  }
  if (!all.length) return { status: 'not-found', candidates: [], reason: `Google found no business for "${query}"`, query };
  const named = all.filter((c) => nameSimilarity(c.name ?? '', p.name ?? '') >= NAME_MATCH && !addressNamed(c, p.address));
  const matches = named.filter((c) => addressAgrees(c, p));
  if (matches.length === 1) {
    const c = matches[0];
    const held = [p.zip ? `ZIP ${p.zip}` : '', p.streetNumber ? `street number ${p.streetNumber}` : ''].filter(Boolean);
    return { status: 'confirmed', placeId: c.placeId, candidate: c, via: held.length ? 'name-and-address' : 'name', evidence: [`the only Google business named "${c.name}"${held.length ? ` at the address given (${held.join(', ')})` : ''} among ${all.length} result(s) for "${query}"`], query };
  }
  if (matches.length > 1) return { status: 'choose', candidates: matches, reason: `${matches.length} businesses match "${query}": choose one`, query };
  return { status: 'choose', candidates: all, reason: named.length ? `no business named "${p.name}" is at the address given: choose one, or correct the address` : `no business is named exactly "${p.name}": choose one, or correct the name`, query };
}
