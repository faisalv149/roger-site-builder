import type { Business, WebsiteScan } from '../types.js';
import { phoneKey, plausiblePhone, registrableHost } from './site-content.js';
import { identityRecord } from './identity.js';

/** The id a website-only business carries instead of a Google place id. */
export const WEBSITE_ID_PREFIX = 'website:';
export const isWebsiteId = (id: string | undefined) => !!id && id.startsWith(WEBSITE_ID_PREFIX);
export const websiteIdFor = (url: string) => `${WEBSITE_ID_PREFIX}${registrableHost(url)}`;

export class IdentityError extends Error {}

const GOOGLE_TYPE_LABEL: Record<string, string> = { chiropractor: 'Chiropractor', dentist: 'Dentist', doctor: 'Doctor', physiotherapist: 'Physical therapist' };

/**
 * A business described only by what its own website says. Nothing Google would have supplied is made up: no rating,
 * no reviews, no hours unless the page lists them, no photos from Google. What the page doesn't say stays unknown.
 */
export function businessFromWebsite(scan: WebsiteScan, opts: { rejected?: { placeId: string; name: string; reason: string }[] } = {}): Business {
  const c = scan.content;
  if (!scan.ok || !c?.identity.name) throw new IdentityError(`Couldn't tell who this business is from ${scan.finalUrl || scan.url}: no business name on the page. Send the business name and ZIP, or a Google Maps link.`);
  const phone = c.phones.primary ? plausiblePhone(c.phones.primary) : undefined;
  const a = c.address;
  const type = c.identity.typeHint;
  const formattedAddress = a ? `${a.formatted}, USA` : undefined;
  return {
    placeId: websiteIdFor(scan.finalUrl || scan.url),
    name: c.identity.name,
    primaryType: type?.googleType,
    primaryTypeLabel: type?.label,
    types: type ? [type.googleType] : [],
    formattedAddress,
    shortAddress: a ? `${a.street}${a.unit ? `, ${a.unit}` : ''}, ${a.city}` : undefined,
    street: a ? `${a.street}${a.unit ? `, ${a.unit}` : ''}` : undefined,
    city: a?.city,
    state: a?.state,
    zip: a?.zip,
    country: a ? 'US' : undefined,
    phone,
    phoneE164: phone ? `+1${phoneKey(phone)}` : undefined,
    website: scan.finalUrl || scan.url,
    reviews: [],
    photos: [],
    editorialSummary: undefined,
    nearbyTowns: [],
    source: 'website',
    identity: identityRecord({
      source: 'website',
      status: 'website-only',
      evidence: [`name "${c.identity.name}" seen in ${c.identity.names[0].sources.join(', ')}`, a ? `address ${a.formatted}` : 'no street address on the page', phone ? `phone ${phone}` : 'no phone on the page'],
      rejected: opts.rejected,
      websiteDomain: c.identity.domain,
      googleListsWebsite: false,
    }),
  };
}

export const typeLabelFor = (googleType: string) => GOOGLE_TYPE_LABEL[googleType];
