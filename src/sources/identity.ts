import type { Business, BusinessCandidate, IdentityRecord } from '../types.js';
import { nameKey, phoneKey, plausiblePhone, registrableHost, type ParsedAddress, type SiteContent } from './site-content.js';

/**
 * Who a business is, and whether a Google result is really it.
 *
 * A Google place can be a postal code, a town or a street, none of which is a business. And a result is only
 * evidence of identity when something Google reports (its own website for the place, phone, address, name) agrees
 * with what the business's own website says. A website address the user typed is not Google's confirmation: it is
 * the thing being checked.
 */

/** Google place types that name a place on the map, not a business. */
const GEOGRAPHIC_TYPES = new Set([
  'postal_code', 'postal_code_prefix', 'postal_code_suffix', 'postal_town', 'locality', 'sublocality', 'sublocality_level_1', 'sublocality_level_2',
  'neighborhood', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'administrative_area_level_4',
  'administrative_area_level_5', 'country', 'continent', 'colloquial_area', 'political', 'route', 'street_address', 'street_number', 'intersection',
  'geocode', 'plus_code', 'premise', 'subpremise', 'town_square', 'natural_feature', 'school_district',
]);
/** Types that mean a business is there even when a geographic type is also listed. */
const ESTABLISHMENT_HINT = /^(establishment|point_of_interest|store|food|health|finance|lodging|[a-z_]+_(?:store|shop|service|contractor|clinic|office|agency|school|salon|studio|club|center|centre))$/;
const POSTCODE_NAME = /^(?:\d{4,6}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i;

/**
 * Why this result is a place and not a business, or undefined when it can be one. Checks Google's types first, then
 * the shape of the name (a postal code, or just the town and state) for results that arrive without types.
 */
export function geographicReason(c: { name?: string; types?: string[]; primaryType?: string; primaryTypeLabel?: string; address?: string; formattedAddress?: string }): string | undefined {
  const types = [...new Set([c.primaryType, ...(c.types || [])].filter(Boolean) as string[])];
  const geo = types.filter((t) => GEOGRAPHIC_TYPES.has(t));
  const business = types.filter((t) => !GEOGRAPHIC_TYPES.has(t) && ESTABLISHMENT_HINT.test(t));
  if (types.length && geo.length === types.length) return `Google lists it as a place (${geo.slice(0, 3).join(', ')}), not a business`;
  if (c.primaryType && GEOGRAPHIC_TYPES.has(c.primaryType) && !business.length) return `Google's main type for it is "${c.primaryType}", not a business`;
  if (/^(postal code|locality|neighborhood|city|town|state|county|country|route|street address)$/i.test(c.primaryTypeLabel || '')) return `Google labels it "${c.primaryTypeLabel}", not a business`;
  const name = (c.name || '').trim();
  if (POSTCODE_NAME.test(name)) return `its name "${name}" is a postal code`;
  const address = (c.address || c.formattedAddress || '').replace(/,?\s*(USA|United States)$/i, '').trim();
  // the name is the address without its street: "Leander, TX 78645" or "Leander"
  if (name && address && !types.length) {
    const a = nameKey(address), n = nameKey(name);
    if (n && (a === n || a.startsWith(n) && a.length - n.length <= 12 || a.endsWith(n))) return `its name "${name}" is just the place it is in`;
  }
  return undefined;
}

/** What a business's website says about who it is, reduced to what can be compared with a Google result. */
export interface SourceView {
  names: string[];
  domain: string;
  phones: string[];
  address?: ParsedAddress;
  city?: string;
  state?: string;
  typeLabel?: string;
}
export function sourceView(c: SiteContent): SourceView {
  return {
    names: c.identity.names.map((n) => n.name),
    domain: c.identity.domain,
    phones: [c.phones.primary, ...c.phones.others.map((o) => o.number)].filter(Boolean).map((p) => phoneKey(p)).filter(Boolean),
    address: c.address,
    city: c.address?.city,
    state: c.address?.state,
    typeLabel: c.identity.typeHint?.label,
  };
}

const STOP = new Set(['the', 'and', 'of', 'llc', 'inc', 'co', 'company', 'pllc', 'pc', 'ltd', 'at']);
const tokens = (s: string) => s.toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
/** 0..1: how alike two business names are. */
export function nameSimilarity(a: string, b: string): number {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if ((ka.includes(kb) || kb.includes(ka)) && Math.min(ka.length, kb.length) >= 6) return 0.9;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const shared = ta.filter((t) => tb.includes(t)).length;
  return shared / Math.max(ta.length, tb.length);
}

export interface Match { score: number; verdict: 'verified' | 'probable' | 'rejected'; evidence: string[]; reason?: string }

/** Whether a Google candidate address is the source's: same street number and street word in the same ZIP. */
function addressMatch(candidate: string | undefined, a: ParsedAddress | undefined): 'strong' | 'weak' | undefined {
  if (!candidate || !a) return undefined;
  const text = candidate.toLowerCase();
  const num = a.street.match(/^\d+/)?.[0];
  const word = tokens(a.street.replace(/^\d+\s*/, ''))[0];
  if (num && word && text.includes(num) && text.includes(word) && text.includes(a.zip)) return 'strong';
  if (num && word && text.includes(num) && text.includes(word)) return 'strong';
  if (text.includes(a.zip) || (a.city && text.includes(a.city.toLowerCase()))) return 'weak';
  return undefined;
}

/**
 * Score a Google candidate against the website. Evidence that counts: the candidate's own Google-listed website on
 * the same domain, the same phone, the same street address, a matching name. A place that is only a place is
 * rejected outright. Having no photos or reviews is not evidence of anything, and is never a reason to reject.
 */
export function matchCandidate(c: Pick<BusinessCandidate, 'name' | 'address' | 'types' | 'primaryType' | 'primaryTypeLabel' | 'phone' | 'googleWebsite'>, src: SourceView | undefined): Match {
  const geo = geographicReason({ name: c.name, types: c.types, primaryType: c.primaryType, primaryTypeLabel: c.primaryTypeLabel, address: c.address });
  if (geo) return { score: 0, verdict: 'rejected', evidence: [], reason: geo };
  if (!src) return { score: 1, verdict: 'probable', evidence: ['no website to compare with'] };
  const evidence: string[] = [];
  let hard = 0;
  let score = 0;
  const sim = Math.max(0, ...src.names.map((n) => nameSimilarity(c.name || '', n)));
  if (sim >= 0.85) { evidence.push(`name matches "${src.names.find((n) => nameSimilarity(c.name || '', n) === sim) || src.names[0]}"`); score += 3; }
  else if (sim >= 0.5) { evidence.push('name partly matches'); score += 1.5; }
  if (c.googleWebsite && registrableHost(c.googleWebsite) === src.domain) { evidence.push(`Google lists ${src.domain} as its website`); score += 4; hard++; }
  else if (c.googleWebsite && sim < 0.85) { return { score, verdict: 'rejected', evidence, reason: `Google lists a different website (${registrableHost(c.googleWebsite)}) for it` }; }
  const phone = phoneKey(c.phone);
  if (phone && src.phones.includes(phone)) { evidence.push('same phone number'); score += 4; hard++; }
  const addr = addressMatch(c.address, src.address);
  if (addr === 'strong') { evidence.push('same street address'); score += 3; hard++; } else if (addr === 'weak') { evidence.push('same ZIP or town'); score += 0.5; }
  const verdict: Match['verdict'] = hard >= 2 || (sim >= 0.85 && hard >= 1) ? 'verified' : sim >= 0.85 && addr ? 'probable' : sim >= 0.6 && hard >= 1 ? 'probable' : 'rejected';
  const reason = verdict === 'rejected' ? `nothing ties it to the website: ${sim >= 0.5 ? 'the name is similar' : `the name "${c.name}" is not on the website`}, ${hard ? '' : 'and no website, phone or street address match'}`.replace(/, $/, '') : undefined;
  return { score, verdict, evidence, reason };
}

/** Searches that can find the business on Google from its website: name with town, name with ZIP, then the phone. */
export function identityQueries(src: SourceView, hint?: string): string[] {
  const name = src.names[0];
  if (!name) return [];
  const q = [
    [name, src.address?.city, src.address?.state].filter(Boolean).join(' '),
    [name, src.address?.zip].filter(Boolean).join(' '),
    src.phones[0] ? `${name} ${plausiblePhone(src.phones[0]) || ''}`.trim() : '',
    name,
    hint ? `${name} ${hint}` : '',
  ].filter(Boolean);
  return [...new Set(q)].slice(0, 4);
}

/** The identity record that goes with a business, from how it was established. */
export function identityRecord(opts: { source: IdentityRecord['source']; status: IdentityRecord['status']; evidence: string[]; rejected?: IdentityRecord['rejected']; websiteDomain?: string; googleListsWebsite?: boolean }): IdentityRecord {
  return { source: opts.source, status: opts.status, evidence: opts.evidence, rejected: opts.rejected ?? [], websiteDomain: opts.websiteDomain, googleListsWebsite: opts.googleListsWebsite };
}

/** A Business seen as a candidate, so a saved or explicitly chosen listing is held to the same checks as a search result. */
export const candidateOf = (b: Business): BusinessCandidate => ({
  placeId: b.placeId, name: b.name, address: b.formattedAddress, primaryTypeLabel: b.primaryTypeLabel, primaryType: b.primaryType, types: b.types, phone: b.phone, googleWebsite: b.website, website: b.website, rating: b.rating, reviewCount: b.reviewCount,
});
