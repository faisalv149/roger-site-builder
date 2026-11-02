import { config } from '../config.js';
import type { Business, BusinessCandidate, IdentityRecord, WebsiteScan } from '../types.js';
import { findDraft } from '../drafts.js';
import { getBusiness, searchCandidates } from './places.js';
import { scanWebsite } from './website.js';
import { candidateOf, geographicReason, identityQueries, identityRecord, matchCandidate, sourceView, type Match, type SourceView } from './identity.js';
import { IdentityError, businessFromWebsite, isWebsiteId } from './website-business.js';
import { normalizeUrl } from '../util/http.js';
import { nameKey, registrableHost } from './site-content.js';

/**
 * Who is this business? The business's own website is read first, so what it says about itself (name, phone, street
 * address) is known before any Google result is chosen. A Google result is used only when it checks out against that:
 * a postal code is never a business, and a place whose name, phone, address or listed website doesn't match is turned
 * down. When nothing reliable matches, the build goes on from the website's own information.
 */
export interface Identified {
  business: Business;
  scan?: WebsiteScan;
  /** the website the build reads: the one given, else the one Google lists for the business */
  websiteUrl?: string;
  /** what happened, for the build's report */
  notes: string[];
}

export interface IdentifyInput { google?: string; placeId?: string; website?: string }

/** The saved listing of a site built before identity checks existed, when live data isn't available (sample-data mode). */
async function getListing(placeId: string): Promise<Business> {
  try {
    return await getBusiness(placeId);
  } catch (e) {
    // sample-data mode (MOCK=1) only knows the fixtures: a site built from live Google data can still be
    // rebuilt from the business data its draft saved; otherwise say what's going on
    if (!config.mock || placeId.startsWith('mock-')) throw e;
    const saved = await findDraft({ businessKey: placeId });
    if (saved?.base.business) return saved.base.business;
    throw new Error('This site was built from live Google data, but Roger is running on sample data (MOCK=1), so it cannot look the business up. Restart the server without MOCK=1 to rebuild it.');
  }
}

function safeNormalize(u: string | undefined): string | undefined {
  if (!u?.trim()) return undefined;
  try { return normalizeUrl(u); } catch { return undefined; }
}

/** Best match first; rejected ones are returned separately with their reasons. */
export function rankCandidates(cs: BusinessCandidate[], src: SourceView | undefined): { ranked: (BusinessCandidate & { match: Match })[]; rejected: { placeId: string; name: string; reason: string }[] } {
  const scored = cs.map((c) => ({ ...c, match: matchCandidate(c, src) }));
  const rejected = scored.filter((c) => c.match.verdict === 'rejected').map((c) => ({ placeId: c.placeId, name: c.name, reason: c.match.reason || 'did not match' }));
  const rank = (c: { match: Match }) => (c.match.verdict === 'verified' ? 2 : c.match.verdict === 'probable' ? 1 : 0);
  return { ranked: scored.filter((c) => c.match.verdict !== 'rejected').sort((a, b) => rank(b) - rank(a) || b.match.score - a.match.score), rejected };
}

export async function identifyBusiness(input: IdentifyInput, opts: { scan?: WebsiteScan } = {}): Promise<Identified> {
  const notes: string[] = [];
  const rejected: IdentityRecord['rejected'] = [];
  const userSite = safeNormalize(input.website) ?? (isWebsiteId(input.placeId) ? safeNormalize(input.placeId!.slice('website:'.length)) : undefined);

  // 1) a Google listing, when one was chosen or named (a website-only id means there is none)
  let google: Business | undefined;
  let candidates: BusinessCandidate[] = [];
  if (input.placeId && !isWebsiteId(input.placeId)) {
    try {
      google = await getListing(input.placeId);
    } catch (e) {
      if (!userSite) throw e;
      notes.push(`The saved Google listing couldn't be loaded (${(e as Error).message.slice(0, 120)}); using the website.`);
    }
  } else if (input.google) {
    const found = await searchCandidates(input.google, { limit: 5 });
    candidates = found.candidates;
    rejected.push(...found.rejected);
    for (const r of found.rejected) notes.push(`Turned down "${r.name}": ${r.reason}.`);
  }
  if (google && google.source === 'mock' && !geographicReason({ name: google.name, types: google.types, primaryType: google.primaryType, primaryTypeLabel: google.primaryTypeLabel, formattedAddress: google.formattedAddress })) {
    // fictional sample businesses are trusted as they are (unless one is just a place)
    google.identity = identityRecord({ source: 'mock', status: 'verified', evidence: ['sample business'] });
    const scan = opts.scan ?? (safeNormalize(input.website || google.website) ? await scanWebsite(input.website || google.website!) : undefined);
    return { business: google, scan, websiteUrl: input.website || google.website, notes };
  }

  // 2) the website (the one given, else the one the listing names)
  let websiteUrl = userSite;
  let scan = opts.scan;
  if (!websiteUrl) websiteUrl = safeNormalize(google?.website) ?? safeNormalize(candidates[0]?.googleWebsite);
  if (!scan && websiteUrl) scan = await scanWebsite(websiteUrl);
  const src = scan?.ok && scan.content?.identity.name ? sourceView(scan.content) : undefined;
  if (scan && !scan.ok) notes.push(`The website didn't load (${scan.error || scan.status}), so it couldn't be used to check the Google listing.`);
  else if (scan && !src) notes.push('The website loaded but names no business, so it could not be used to check the Google listing.');

  // 3) hold the chosen or found listing to what the website says
  const verify = (b: Business): Match => matchCandidate(candidateOf(b), src);
  let match: Match | undefined;
  if (google) {
    match = verify(google);
    if (match.verdict === 'rejected') {
      rejected.push({ placeId: google.placeId, name: google.name, reason: match.reason || 'did not match the website' });
      notes.push(`Turned down the Google listing "${google.name}": ${match.reason}.`);
      google = undefined;
      match = undefined;
    }
  }
  if (!google && candidates.length) {
    const { ranked, rejected: bad } = rankCandidates(candidates, src);
    rejected.push(...bad.filter((r) => !rejected.some((x) => x.placeId === r.placeId)));
    if (ranked[0]) { google = await getBusiness(ranked[0].placeId); match = ranked[0].match; }
  }
  // 4) a website that names the business: look it up on Google by what the site says, not by what was typed
  if (!google && src && scan?.content) {
    const seen = new Set<string>();
    for (const q of identityQueries(src, scan.content.address?.zip)) {
      let found: Awaited<ReturnType<typeof searchCandidates>>;
      try { found = await searchCandidates(q, { limit: 5 }); } catch { break; }
      const fresh = found.candidates.filter((c) => !seen.has(c.placeId));
      fresh.forEach((c) => seen.add(c.placeId));
      const { ranked, rejected: bad } = rankCandidates(fresh, src);
      for (const r of [...found.rejected, ...bad]) if (!rejected.some((x) => x.placeId === r.placeId)) rejected.push(r);
      const best = ranked.find((c) => c.match.verdict === 'verified') ?? ranked.find((c) => c.match.verdict === 'probable');
      if (best) { google = await getBusiness(best.placeId); match = best.match; notes.push(`Found the Google listing "${google.name}" from what the website says (${best.match.evidence.join(', ')}).`); break; }
    }
  }

  if (google) {
    const googleDomain = google.website ? registrableHost(google.website) : undefined;
    const evidence = src ? [...(match?.evidence ?? [])] : ['no website to compare with'];
    // Google often appends the town to a name ("Lakeside Chiropractic Lago Vista"); the business calls itself what its website says
    const own = src?.names[0];
    if (own && google.source !== 'mock' && nameKey(google.name) !== nameKey(own) && nameKey(google.name).startsWith(nameKey(own))) {
      evidence.push(`Google lists the name as "${google.name}"; using it as the website writes it`);
      google.name = own;
    }
    google.identity = identityRecord({
      source: 'google',
      status: src ? (match?.verdict === 'verified' ? 'verified' : 'probable') : 'unverified',
      evidence,
      rejected,
      websiteDomain: src?.domain,
      googleListsWebsite: !!googleDomain && !!src && googleDomain === src.domain,
    });
    // a listing with no photos or reviews is still the business; only the information the build can use differs
    if (!google.photos.length && !google.reviews.length) notes.push('The Google listing has no photos or reviews yet.');
    return { business: google, scan, websiteUrl: websiteUrl ?? safeNormalize(google.website), notes };
  }

  // 5) nothing on Google checks out: go on from the website, or stop with a message that says what to send
  if (scan?.ok && src) {
    notes.push('No Google listing matched the website, so this build uses the information on the website itself.');
    return { business: businessFromWebsite(scan, { rejected }), scan, websiteUrl, notes };
  }
  const why = rejected[0] ? `Google's top result, "${rejected[0].name}", is not usable: ${rejected[0].reason}. ` : '';
  throw new IdentityError(`${why}I couldn't confirm which business this is${websiteUrl ? ` from ${websiteUrl}` : ''}. Send the business name and ZIP, or a Google Maps link to the listing.`);
}

/** Whether a saved business is one the checks would turn down: a place, not a business. */
export function savedIdentityProblem(b: Pick<Business, 'name' | 'types' | 'primaryType' | 'primaryTypeLabel' | 'formattedAddress' | 'source'>): string | undefined {
  return geographicReason({ name: b.name, types: b.types, primaryType: b.primaryType, primaryTypeLabel: b.primaryTypeLabel, formattedAddress: b.formattedAddress });
}

/**
 * Candidates for "Is this you?": what a name, ZIP or link finds on Google, held to what the website says. A ZIP code
 * alone finds a postal code, which is set aside; a website with a name in it is searched for by that name and town,
 * and when nothing on Google matches, the website's own details are offered as the candidate.
 */
export async function lookupCandidates(input: string, opts: { website?: string; zip?: string; limit?: number } = {}): Promise<{ intent: Awaited<ReturnType<typeof searchCandidates>>['intent'] | undefined; candidates: BusinessCandidate[]; rejected: IdentityRecord['rejected']; notes: string[]; scan?: WebsiteScan }> {
  const limit = opts.limit ?? 5;
  const notes: string[] = [];
  const text = input.trim();
  let found: Awaited<ReturnType<typeof searchCandidates>> | undefined;
  if (text) found = await searchCandidates(text, { zip: opts.zip, limit });
  const rejected = [...(found?.rejected ?? [])];
  for (const r of rejected) notes.push(`Turned down "${r.name}": ${r.reason}.`);
  const site = safeNormalize(opts.website);
  if (!site) return { intent: found?.intent, candidates: found?.candidates ?? [], rejected, notes };

  const scan = await scanWebsite(site);
  const src = scan.ok && scan.content?.identity.name ? sourceView(scan.content) : undefined;
  let candidates: BusinessCandidate[] = [];
  if (src) {
    const first = rankCandidates(found?.candidates ?? [], src);
    candidates = first.ranked;
    for (const r of first.rejected) { rejected.push(r); notes.push(`Turned down "${r.name}": ${r.reason}.`); }
    if (!candidates.length) {
      const seen = new Set<string>();
      for (const q of identityQueries(src, scan.content!.address?.zip)) {
        let r2: Awaited<ReturnType<typeof searchCandidates>>;
        try { r2 = await searchCandidates(q, { limit }); } catch { break; }
        const fresh = r2.candidates.filter((c) => !seen.has(c.placeId));
        fresh.forEach((c) => seen.add(c.placeId));
        const ranked = rankCandidates(fresh, src);
        for (const r of [...r2.rejected, ...ranked.rejected]) if (!rejected.some((x) => x.placeId === r.placeId)) rejected.push(r);
        candidates = ranked.ranked.filter((c) => c.match.verdict !== 'rejected');
        if (candidates.length) break;
      }
    }
    if (!candidates.length) {
      const b = businessFromWebsite(scan, { rejected });
      candidates = [{ placeId: b.placeId, name: b.name, address: b.formattedAddress?.replace(/, USA$/, ''), primaryTypeLabel: b.primaryTypeLabel, website: b.website, fromWebsite: true }];
      notes.push('No Google listing matched the website; offering the details found on the website itself.');
    }
  } else {
    notes.push(scan.ok ? 'The website names no business, so Google results could not be checked against it.' : `The website didn't load (${scan.error || scan.status}).`);
    candidates = found?.candidates ?? [];
  }
  return { intent: found?.intent, candidates: candidates.slice(0, limit), rejected, notes, scan };
}
