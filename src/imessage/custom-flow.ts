/**
 * The customer's conversation for the custom full-site intake (test-only, `intake: "custom"`). The customer sees only
 * the conversation, in Roger's own voice; every version is reviewed internally before its link is sent.
 *
 *   business name (and its location)  →  Roger finds the Google listing (asking for the location when it is missing)
 *   →  "Is this your business?" with the name and full address  →  yes: Roger checks the website, then research and
 *   one custom full site  →  one link, with "Approve and publish" and "Request another version"
 *
 * The name and the location may come in separate messages (in either order): they are combined into one lookup, and a
 * street address sent after the name never replaces the name. Only credible listings are offered: the listing's name
 * must be the business's name, it must not be named after an address, and its address must agree with what the
 * customer gave (street number and street, ZIP, town, each when given). A ZIP, street or town is never taken as the
 * business, and a nearby listing is never offered just because Google returned it. When nothing passes, Roger asks for
 * the Google Maps link or a correction; nothing starts. Roger checks the website only once the listing is confirmed,
 * and uses it only when the site checks out as this business's; otherwise it builds from the Google listing. Before
 * research starts, the customer can correct the listing (say no, or send another name or location) or the website
 * (send a link, or "no website"). The normal client flow (flow.ts) is unchanged.
 */
import { addressAgrees, addressNamed, NAME_MATCH, parseBusinessInput, resolveBusiness } from '../studio/resolve-business.js';
import { liveListingPhotos, searchCandidates } from '../sources/places.js';
import { config } from '../config.js';
import { confirmBusinessCard } from './cards.js';
import { scanWebsite } from '../sources/website.js';
import { matchCandidate, nameSimilarity, sourceView } from '../sources/identity.js';
import { registrableHost } from '../sources/site-content.js';
import type { BusinessCandidate } from '../types.js';
import { advanceCustom, chargeCost, customBusy, customMessages, intakeDeps, newCustomRun, recordApproval, requestCustomVersion, versionInFlight, statusText, DONE_CHOICES, type CustomReply, type CustomRun } from './custom-intake.js';

/** what Roger found about a listing's website */
export interface SiteCheck { url?: string; status: 'verified' | 'none' | 'uncertain'; evidence: string; from: 'listing' | 'customer' }
export interface CustomSession {
  state: string; candidates: BusinessCandidate[]; idx: number; chosen?: BusinessCandidate; confirmedAt?: string;
  website?: string; query?: string; location?: string; site?: SiteCheck; lastSiteUrl?: string; custom?: CustomRun; followUp?: { at: string; reason: 'call' | 'publish' };
  /** the website link the customer sent, and "no website": both checked only once the listing is confirmed */
  siteUrl?: string; noSite?: boolean;
  /** the beta invite this conversation belongs to (none: staff), and the conversation's own id */
  inviteId?: string; from?: string;
}

/** the lookups the conversation makes (tests replace them; nothing else changes) */
export const discovery = {
  resolve: resolveBusiness,
  /** is this text a place (a town, state, ZIP or country) rather than a business? */
  isPlace: async (text: string) => { const r = await searchCandidates(text, { limit: 3 }); return !r.candidates.length && r.rejected.length > 0; },
  /** does this website belong to this listing? its own name, phone or address must match the listing (not the link) */
  /** the listing's card: its share page (opens the listing in Google Maps) and, when it has one, its first photo's author */
  card: async (c: BusinessCandidate) => {
    const [card, photos] = await Promise.all([confirmBusinessCard(c).catch(() => undefined), liveListingPhotos(c.placeId).catch(() => [])]);
    return { url: card?.url ?? c.mapsUrl, image: card?.image, photo: photos.length ? { author: photos[0].authors?.[0]?.name } : undefined };
  },
  checkSite: async (c: BusinessCandidate, url: string, from: SiteCheck['from']): Promise<SiteCheck> => {
    try {
      const scan = await scanWebsite(url, { extraPages: 0, render: 'never', crawl: false });
      if (!scan.ok || !scan.content?.identity.name) return { url, status: 'uncertain', evidence: `${registrableHost(url)} could not be read`, from };
      const m = matchCandidate({ ...c, googleWebsite: undefined }, sourceView(scan.content));
      return m.verdict === 'rejected' ? { url, status: 'uncertain', evidence: m.reason ?? 'nothing on the site ties it to the listing', from } : { url: scan.finalUrl || url, status: 'verified', evidence: m.evidence.join(', '), from };
    } catch (e) { return { url, status: 'uncertain', evidence: `${registrableHost(url)} could not be opened (${(e as Error).message.slice(0, 80)})`, from }; }
  },
};

const URL_RE = /(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+\.(?:com|net|org|biz|us|co|io|pro|info|services|site|pk|uk|ca|au)(?:\/[^\s]*)?)/i;
const MAPS_RE = /google\.|goo\.gl|g\.page|maps\.app/i;
const YES = /^(y|yes|yep|yeah|yup|sure|correct|that'?s (me|us|it|right)|it is|ok|okay|please|do it|build it|let'?s go|sounds good|go ahead)\b/i;
const NO = /^(n|no|nope|not (me|us|it|this one|really)|wrong)\b/i;
const NO_SITE = /^(no website|no site|none|we don'?t have (one|a website)|i don'?t have (one|a website)|don'?t have (one|a website)|not that (one|site)|wrong (site|website)|skip)\b/i;
const GREETING = /^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening))( roger)?[\s!.,]*$/i;
const ALTERNATIVE = /\b(different|another|other|new) (design|look|style|layout|version)\b|\btry (a|another) design\b/i;
const RETRY = /\b(try again|retry)\b/i;
const APPROVE = /\b(approve|publish|go live|i'?ll take it)\b/i;
const THANKS = /^(thanks|thank you|thx|ty|great|awesome|perfect|cool|nice|love it)[\s!.]*$/i;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
const STATES: Record<string, string> = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia' };
const host = (u: string) => { try { return registrableHost(u); } catch { return u; } };
const ASK_BUSINESS = 'What\'s your business called, and where is it? Send the name and the city or ZIP code.';
/** a reply that only says yes or no (not a business that happens to start with "OK") */
const BARE_YES = /^(y|yes|yep|yeah|yup|sure|correct|ok|okay|(yes,?\s+)?(that'?s|it is|it'?s) (it|me|us|right|correct|mine))[\s.!]*$/i;
const BARE_NO = /^(n|no|nope|wrong|(no,?\s+)?not (me|us|it|this one|that one|mine))[\s.!]*$/i;
const ZIP_ONLY = (t: string) => ZIP_RE.test(t) && !t.replace(ZIP_RE, '').replace(/[\s,]/g, '');

/** a street address, not a business: it starts with a house number ("63 S Imperial Block, …") or a unit ("Shop 4, …") */
export const looksLikeAddress = (t: string) => /^\s*#?\d{1,6}[A-Za-z]?\s+(?!\d{4,5}\b)[A-Za-z]/.test(t) || /^\s*(house|plot|shop|office|suite|unit|flat|apt|building|bldg)\.?\s*(no\.?\s*)?#?\s*\d/i.test(t);
/** "at 63 S Imperial Block, …" or "in Austin TX" */
const atOrIn = (loc: string) => `${looksLikeAddress(loc) ? 'at' : 'in'} ${loc}`;

/**
 * Whether Roger may offer this listing for the business the customer named at the location they gave: the listing's
 * name is that name (not a shared word), it is not named after an address, and its address agrees with the location
 * on every part given (street number and street, ZIP, and town). Google returning it is not evidence by itself.
 */
export function credibleListing(c: BusinessCandidate, name: string, location: string): boolean {
  if (nameSimilarity(c.name ?? '', name) < NAME_MATCH || addressNamed(c, location)) return false;
  if (!addressAgrees(c, parseBusinessInput({ name, address: location }))) return false;
  // the town: what follows the street, when a street was given
  const town = looksLikeAddress(location) ? location.split(',').slice(1).join(',').trim() : location;
  return !town || inLocation(c.address, town);
}

/** a state named in a location (its abbreviation, or its full name) */
function stateOf(loc: string): { abbr: string; name: string } | undefined {
  const l = loc.toLowerCase();
  for (const [abbr, name] of Object.entries(STATES)) if (new RegExp(`(^|[\\s,])${abbr}\\.?$`).test(l.trim()) || new RegExp(`\\b${name}\\b`).test(l)) return { abbr, name };
  return undefined;
}
/** Is this address in the location the customer gave? Its ZIP (or the same 3-digit area), or its town and state. */
export function inLocation(address: string | undefined, loc: string): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  const zip = loc.match(ZIP_RE)?.[0]?.slice(0, 5);
  if (zip) { const az = a.match(/\b(\d{5})\b/)?.[1]; if (a.includes(zip) || (az && az.slice(0, 3) === zip.slice(0, 3))) return true; if (!loc.replace(ZIP_RE, '').trim()) return false; }
  const st = stateOf(loc);
  const rest = loc.toLowerCase().replace(ZIP_RE, ' ').replace(st ? new RegExp(`\\b(${st.name}|${st.abbr})\\b\\.?`, 'g') : /$^/, ' ');
  const words = rest.split(/[^a-z]+/).filter((w) => w.length > 1 && !['usa', 'us', 'the', 'city', 'of'].includes(w));
  if (st && !new RegExp(`\\b${st.abbr}\\b|\\b${st.name}\\b`).test(a)) return false;
  return words.length > 0 ? words.every((w) => a.includes(w)) : !!st;
}
/** "Name, Austin TX" / "Name 78704" / "Name, Lahore": the business name and its location, when the text gives one */
export async function splitBusiness(text: string): Promise<{ name: string; location?: string }> {
  const t = text.trim().replace(/[.!]+$/, '');
  // "Name, 63 S Imperial Block, Paragon City, Lahore": everything from the street on is the location
  const all = t.split(',').map((s) => s.trim()).filter(Boolean);
  const street = all.findIndex((p, i) => i > 0 && looksLikeAddress(p));
  if (street > 0) return { name: all.slice(0, street).join(', '), location: all.slice(street).join(', ') };
  const zip = t.match(ZIP_RE);
  if (zip) {
    const before = t.slice(0, zip.index).replace(/[\s,]+$/, '');
    // the town and state right before the ZIP belong to the location ("Name, Austin, TX 78704")
    const parts = before.split(',').map((s) => s.trim()).filter(Boolean);
    let n = parts.length;
    while (n > 1 && (stateOf(parts[n - 1]) || (await discovery.isPlace(parts[n - 1]).catch(() => false)))) n--;
    return { name: parts.slice(0, n).join(', '), location: [...parts.slice(n), zip[0]].join(', ') };
  }
  const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
  // trailing parts that are places: "…, Austin, TX", "…, Lahore" (a part of the name, such as "Air & Electric", is not)
  let n = parts.length;
  while (n > 1 && (stateOf(parts[n - 1]) && parts[n - 1].split(/\s+/).length <= 3 || await discovery.isPlace(parts[n - 1]).catch(() => false))) n--;
  if (n < parts.length) return { name: parts.slice(0, n).join(', '), location: parts.slice(n).join(', ') };
  // "Joe's Pizza Austin TX": a state at the end without a comma
  const m = t.match(/^(.*\S)\s+([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+)?)\s+([A-Za-z]{2})$/);
  if (m && STATES[m[3].toLowerCase()] && await discovery.isPlace(`${m[2]} ${m[3]}`).catch(() => false)) return { name: m[1], location: `${m[2]}, ${m[3].toUpperCase()}` };
  return { name: t };
}

/** where the session stands once the run has moved: building while anything is in flight, otherwise done */
export function settle(s: CustomSession) {
  const run = s.custom;
  if (!run) return;
  s.state = customBusy(run) ? 'building' : 'done';
  const sent = [...run.versions].reverse().find((v) => v.status === 'sent');
  if (sent?.url) s.lastSiteUrl = sent.url;
}

/**
 * A listing as a card: its photo (the listing's first Google photo, shown live from Google and never stored, with its
 * author credited; otherwise Roger's own card image), its name, address and rating. Tapping it opens the listing in
 * Google Maps, so the customer can see it is theirs. With no link for it, the listing is a plain message instead.
 */
async function listingCard(c: BusinessCandidate, n?: number, choice?: string): Promise<CustomReply> {
  const title = `${n ? `${n}. ` : ''}${c.name}`;
  const card = await discovery.card(c).catch(() => undefined);
  const rating = c.rating ? `★ ${c.rating.toFixed(1)}${c.reviewCount ? ` (${c.reviewCount} reviews)` : ''}` : '';
  if (!card?.url) return { text: [title, c.address, rating].filter(Boolean).join('\n') };
  const credit = card.photo ? `Photo: ${card.photo.author ? `${card.photo.author}, ` : ''}Google` : '';
  return {
    text: '', url: card.url, title, ...(choice ? { choice } : {}),
    image: card.photo ? `${config.publicBaseUrl}/gphoto/cover/${encodeURIComponent(c.placeId)}?w=800` : card.image,
    subtitle: [(c.address ?? '').replace(/, USA$/, ''), rating, credit].filter(Boolean).join(' · '),
  };
}

const CONFIRM_CHOICES = ['Yes, that\'s it', 'No, not this one'];
/** the listing to confirm, as a card (the website is checked only once the customer says yes) */
const confirmCard = async (c: BusinessCandidate): Promise<CustomReply[]> => [
  { text: 'Is this your business?' }, await listingCard(c, undefined, CONFIRM_CHOICES[0]),
  { text: 'Tap "Yes, that\'s it" to start your preview. If it isn\'t yours, reply "No" or send me the Google Maps link to your listing.', quickReplies: CONFIRM_CHOICES },
];

async function offer(s: CustomSession, intro?: string): Promise<CustomReply[]> {
  s.state = 'confirm';
  const r = await confirmCard(s.candidates[s.idx]);
  return intro ? [{ text: intro }, ...r] : r;
}

/** a name similar enough to put a listing on the list the customer chooses from (they confirm it by choosing) */
const PICK_MATCH = 0.6;
/** the buttons under the list: "1. Crescent Pharmacy - Model Town" … (one listing: yes or no) */
const pickLabels = (list: BusinessCandidate[]) => {
  if (list.length === 1) return ['Yes, that\'s mine'];
  const short = (t: string) => t.length > 26 ? `${t.slice(0, 25).replace(/[\s,.-]+$/, '')}…` : t;
  // branches with the same name are told apart by their street
  const same = new Set(list.map((c) => c.name)).size < list.length;
  return list.map((c, i) => `${i + 1}. ${short(same ? (c.address ?? '').split(',')[0].trim() || (c.name ?? '') : c.name ?? '')}`);
};

/**
 * A business name alone: the Google listings whose name is like it (up to three, the closest names first; never one
 * named after an address), each with its full address, for the customer to choose from. Undefined when there are none
 * (or Google cannot be reached): the customer is then asked where the business is.
 */
async function pickList(s: CustomSession): Promise<CustomReply[] | undefined> {
  let r;
  try { r = await discovery.resolve({ name: s.query! }); } catch (e) { console.warn(`[imessage custom] lookup of "${s.query}" failed: ${(e as Error).message}`); return undefined; }
  const found = r.status === 'confirmed' ? [r.candidate] : r.candidates;
  const list = found
    .map((c, order) => ({ c, order, sim: nameSimilarity(c.name ?? '', s.query!) }))
    .filter((x) => x.sim >= PICK_MATCH && !addressNamed(x.c))
    .sort((a, b) => b.sim - a.sim || a.order - b.order)
    .slice(0, 3).map((x) => x.c);
  if (!list.length) return undefined;
  s.candidates = list; s.idx = 0; s.state = 'choose';
  const labels = pickLabels(list);
  const cards = await Promise.all(list.map((c, i) => listingCard(c, list.length > 1 ? i + 1 : undefined, labels[i])));
  return [{ text: list.length > 1 ? `I found ${list.length} listings on Google for ${s.query}. Which one is yours?` : 'I found this listing on Google. Is it yours?' }, ...cards,
    list.length > 1
      ? { text: 'Tap yours to start your preview. If none of these is yours, tap "None of these" or send me the address or the Google Maps link.', quickReplies: [...labels, 'None of these'] }
      : { text: 'Tap "Yes, that\'s mine" to start your preview. If it isn\'t yours, tap "No, not this one" or send me the address or the Google Maps link.', quickReplies: [...labels, 'No, not this one'] }];
}

/** after the customer confirmed the listing: the website (theirs, or the listing's) is checked against it */
async function checkWebsite(s: CustomSession, c: BusinessCandidate): Promise<CustomReply[]> {
  const url = s.noSite ? undefined : s.siteUrl ?? c.website ?? c.googleWebsite;
  const from: SiteCheck['from'] = s.noSite || s.siteUrl ? 'customer' : 'listing';
  s.site = url ? await discovery.checkSite(c, url, from) : { status: 'none', evidence: s.noSite ? 'the customer has no website' : 'the Google listing has no website', from };
  s.website = s.site.status === 'verified' ? s.site.url : undefined;
  return url && s.site.status !== 'verified' ? [{ text: `I couldn't confirm that ${host(url)} is ${c.name}'s website, so I'll build from your Google listing.` }] : [];
}

export async function respondCustom(msg: string, s: CustomSession): Promise<CustomReply[]> {
  // a run under way: repeated messages report on the saved run (nothing new is started)
  if (s.state === 'building' && s.custom) {
    s.custom = await advanceCustom(s.custom);
    const m = customMessages(s.custom);
    settle(s);
    return m.length ? m : [{ text: statusText(s.custom) }];
  }
  if (s.state === 'start') {
    s.state = 'need-business';
    if (!GREETING.test(msg) && msg.length > 2) return respondCustom(msg, s); // they opened with the business itself
    return [{ text: `Hi, I'm Roger! I build free website previews for local businesses, so you can see what a better site would look like before you spend anything.\n\n${ASK_BUSINESS}` }];
  }
  if (s.state === 'need-business' || s.state === 'need-location') {
    if (GREETING.test(msg)) return [{ text: `Hi! ${ASK_BUSINESS}` }];
    // no listing is on offer: a yes or a no confirms nothing (and is never taken as a name or a place)
    if (BARE_YES.test(msg.trim()) || BARE_NO.test(msg.trim())) {
      return [{ text: s.query && !MAPS_RE.test(s.query) ? `I don't have a listing for you to confirm yet. Send me the Google Maps link to ${s.query}'s listing, or its name and address exactly as they appear on Google.` : `I don't have a listing for you to confirm yet. ${ASK_BUSINESS}` }];
    }
    const url = msg.match(URL_RE)?.[0];
    if (url && MAPS_RE.test(url)) { s.query = url; s.location = undefined; return find(s); }
    const whole = (url ? msg.replace(url, '') : msg).trim().replace(/[.!]+$/, '').replace(/^[\s,]+|[\s,]+$/g, '');
    if (url) s.siteUrl = url; // the customer's website: checked once the listing is confirmed
    if (!whole) return [{ text: s.query ? `Thanks! Where is ${s.query}? Send the city and state, or the ZIP code, so I find the right listing.` : `Thanks! ${ASK_BUSINESS}` }];
    const held = !!s.query && !MAPS_RE.test(s.query); // a business name the customer already gave
    // a street address, a ZIP, or (when the name is known) wholly a place: the business's location. The name already
    // given is kept, and the two are looked up together.
    if (looksLikeAddress(whole) || ZIP_ONLY(whole) || (held && await discovery.isPlace(whole).catch(() => false))) {
      // a postal code alone corrects the one in the location already given ("Lahore, Pakistan 56400" + "54000")
      s.location = ZIP_ONLY(whole) && held && s.location && ZIP_RE.test(s.location) ? s.location.replace(ZIP_RE, whole.match(ZIP_RE)![0]) : whole;
      if (!held) { s.query = undefined; s.state = 'need-business'; return [{ text: 'Thanks, that\'s the address. What\'s the business called? Send the name as it appears on Google.' }]; }
      return find(s);
    }
    const sp = await splitBusiness(whole);
    if (s.state === 'need-location') {
      // the answer to "where is it?" that is not a place or an address. The name again with the place: the place.
      if (sp.location && nameSimilarity(sp.name, s.query!) >= 0.6) { s.location = sp.location; return find(s); }
      // a place with more to it ("Lahore, Pakistan 56400"): the whole reply is the location
      if (sp.location && (ZIP_RE.test(whole) || await discovery.isPlace(sp.name).catch(() => false))) { s.location = whole; return find(s); }
      // otherwise the customer is most likely correcting the business's name ("Clip Craft Studio By Ali" after
      // "hair salon Paragon City"): it is looked up as the name (with its place, if it gives one)
      const earlier = s.query;
      s.query = sp.name; s.location = sp.location;
      if (s.location) return find(s);
      const list = await pickList(s);
      if (list) return list;
      // no listing has that name: it was the location after all (a neighbourhood, or a town Google didn't recognise)
      s.query = earlier; s.location = whole; s.state = 'need-location';
      return find(s);
    }
    if (!sp.name || ZIP_RE.test(sp.name) && sp.name.replace(ZIP_RE, '').trim().length < 2) { s.state = 'need-business'; return [{ text: `That looks like a place, not a business name. ${ASK_BUSINESS}` }]; }
    // a name (and maybe its place): with no place in it, the location already given (an address sent first, or the
    // location of a lookup being corrected) is used
    s.query = sp.name; s.location = sp.location ?? s.location;
    if (!s.location) {
      // a name alone: the Google listings with that name (up to three) to choose from; none: ask where it is
      const list = await pickList(s);
      if (list) return list;
      s.state = 'need-location';
      return [{ text: `Thanks! Where is ${sp.name}? Send the city and state, or the ZIP code, so I find the right listing.` }];
    }
    return find(s);
  }
  if (s.state === 'choose') {
    const t = msg.trim();
    const labels = pickLabels(s.candidates);
    const n = labels.indexOf(t) >= 0 ? labels.indexOf(t) : Number(t.match(/^#?([1-9])[.)]?$/)?.[1] ?? 0) - 1;
    const one = s.candidates.length === 1 && YES.test(t) ? 0 : -1;
    const i = n >= 0 && n < s.candidates.length ? n : one;
    // the customer's tap is the confirmation: the website is checked, then research starts
    if (i >= 0) {
      const c = s.candidates[i];
      s.idx = i; s.chosen = c; s.confirmedAt = new Date().toISOString();
      const note = await checkWebsite(s, c);
      return [...note, ...await start(s)];
    }
    if (/^none( of (these|them))?\b/i.test(t) || NO.test(t)) {
      s.state = 'need-location'; s.candidates = []; s.idx = 0;
      return [{ text: `No problem. Where is ${s.query}? Send the address, or the city and ZIP code, or the Google Maps link to your listing.` }];
    }
    // anything else (an address, a town, a Maps link, a correction): looked up with the name already given
    s.state = 'need-location'; s.candidates = []; s.idx = 0;
    return respondCustom(msg, s);
  }
  if (s.state === 'confirm') {
    const c = s.candidates[s.idx];
    const url = msg.match(URL_RE)?.[0];
    // a Google Maps link: the customer's own listing, looked up instead
    if (url && MAPS_RE.test(url)) { s.state = 'need-business'; return respondCustom(msg, s); }
    // the website before research starts: noted now, checked against the listing once it is confirmed
    if (url) { s.siteUrl = url; s.noSite = false; return [{ text: `Thanks, I'll check ${host(url)} once you confirm your listing.` }, ...await confirmCard(c)]; }
    if (NO_SITE.test(msg)) { s.noSite = true; s.siteUrl = undefined; return [{ text: 'No problem, I\'ll build from your Google listing.' }, ...await confirmCard(c)]; }
    if (NO.test(msg)) {
      s.idx++;
      if (s.idx < s.candidates.length) return offer(s, 'How about this one?');
      s.state = 'need-business'; s.query = undefined; s.location = undefined;
      return [{ text: 'Sorry about that. Send me the Google Maps link to your listing, or the business name and address exactly as they appear on Google.' }];
    }
    if (YES.test(msg)) {
      // held to the same rules as when it was offered (a conversation saved under older rules can hold a listing that
      // is not the business): a listing that does not pass is not confirmed, and nothing starts
      if (s.query && !MAPS_RE.test(s.query) && s.location && !credibleListing(c, s.query, s.location)) {
        console.warn(`[imessage custom] ${s.from ?? ''}: "yes" to ${c.placeId} (${c.name}) not accepted: it does not match "${s.query}" ${atOrIn(s.location)}`);
        s.state = 'need-business'; s.candidates = []; s.idx = 0; s.query = undefined; s.location = undefined;
        return [{ text: `Sorry, I can't confirm that listing is your business: it doesn't match the name and address you sent. Please send me the Google Maps link to your listing, or the business name and address exactly as they appear on Google.` }];
      }
      s.chosen = c; s.confirmedAt = new Date().toISOString();
      const note = await checkWebsite(s, c);
      return [...note, ...await start(s)];
    }
    // anything else is a correction of the business itself: look again
    if (msg.trim().length > 2) { s.state = 'need-business'; s.location = undefined; s.website = undefined; s.site = undefined; return respondCustom(msg, s); }
    return [{ text: 'Is this your business? Just reply yes or no.', quickReplies: ['Yes, that\'s it', 'No, not this one'] }];
  }
  if (s.state === 'done' && s.custom) {
    const run = s.custom;
    if (run.stage === 'failed' && RETRY.test(msg) && s.chosen) return start(s); // research failed: a fresh run for the same confirmed listing
    if (ALTERNATIVE.test(msg) || RETRY.test(msg)) {
      const r = requestCustomVersion(run);
      if (r === 'busy') return [{ text: statusText(run) }];
      if (r === 'unavailable') return [{ text: s.lastSiteUrl ? `Your preview is here: ${s.lastSiteUrl}` : 'Sorry, I can\'t make a new version right now. I\'ll send a message here when I can.', ...(s.lastSiteUrl ? { url: s.lastSiteUrl, quickReplies: DONE_CHOICES } : {}) }];
      s.custom = await advanceCustom(run);
      settle(s);
      return [{ text: s.lastSiteUrl ? 'On it! I\'m making another version of your site. I\'ll check it and send the link here when it\'s ready.' : 'On it! I\'m building a new preview. I\'ll check it and send the link here when it\'s ready.' }, ...customMessages(s.custom)];
    }
    if (APPROVE.test(msg)) {
      const a = recordApproval(run);
      if (!a) return [{ text: 'There\'s no preview to approve yet. I\'ll send the link here as soon as it\'s ready.' }];
      s.followUp = { at: new Date().toISOString(), reason: 'publish' };
      return [{ text: 'Thanks! I\'ve noted that you approved this version of your site. I\'ll be in touch about publishing it.' }];
    }
    if (THANKS.test(msg)) return [{ text: 'You\'re welcome!', ...(s.lastSiteUrl ? { quickReplies: DONE_CHOICES } : {}) }];
    if (s.lastSiteUrl) return [{ text: `Here's your preview again: ${s.lastSiteUrl}\n\nReply "Approve and publish" if you're happy with it, or "Request another version" for a different design. Text "restart" to start over with a different business.`, url: s.lastSiteUrl, quickReplies: DONE_CHOICES }];
    return [{ text: 'I don\'t have a preview for you yet. Reply "try again" and I\'ll make one, or text "restart" to start over.', quickReplies: ['Try again'] }];
  }
  return [{ text: `Sorry, I didn't catch that. ${ASK_BUSINESS} Text "restart" anytime to start over.` }];
}

/**
 * The listing for the business name and its location, looked up together (one search for both, however many messages
 * they came in). Only credible listings are offered (credibleListing: the same name, not an address-named listing, and
 * an address that agrees with the one given), one at a time. When none passes, nothing is offered and nothing starts:
 * the customer is asked for the Google Maps link to the listing, or a correction.
 */
async function find(s: CustomSession): Promise<CustomReply[]> {
  const viaLink = MAPS_RE.test(s.query ?? '');
  let r;
  try { r = await discovery.resolve(viaLink ? { text: s.query! } : { name: s.query!, address: s.location }); } catch (e) {
    console.warn(`[imessage custom] lookup of "${s.query}" in "${s.location}" failed: ${(e as Error).message}`);
    s.state = 'need-business';
    return [{ text: 'Sorry, I couldn\'t reach Google just now. Could you send your business name and location again in a minute?' }];
  }
  const found = r.status === 'confirmed' ? [r.candidate] : r.candidates;
  const credible = viaLink ? found : found.filter((c) => credibleListing(c, s.query!, s.location!));
  if (!credible.length) {
    if (viaLink) { s.state = 'need-business'; s.query = undefined; return [{ text: 'I couldn\'t open that Google Maps link as a business listing. Could you send the link again, or the business name and address exactly as they appear on Google?' }]; }
    // listings with this name, at other addresses: the name is kept, and the next reply is taken as the location
    const named = found.filter((c) => nameSimilarity(c.name ?? '', s.query!) >= NAME_MATCH && !addressNamed(c, s.location));
    const elsewhere = named.length > 0;
    s.state = elsewhere ? 'need-location' : 'need-business'; // no listing with this name: the name or the location can be corrected
    // the only disagreement is the postal code (the listing matches with its own code): say so, so the customer can
    // correct it. The listing is not offered: the customer confirms the code first.
    const given = s.location!.match(ZIP_RE)?.[0];
    const codeOf = (c: BusinessCandidate) => c.address?.match(/\b\d{5}\b/)?.[0];
    const offCode = given ? named.find((c) => { const z = codeOf(c); return z && z !== given && credibleListing(c, s.query!, s.location!.replace(ZIP_RE, z)); }) : undefined;
    if (offCode) return [{ text: `I found ${offCode.name} on Google, but its listing has the postal code ${codeOf(offCode)}, not ${given}. If ${codeOf(offCode)} is right, reply "${codeOf(offCode)}". Otherwise, send me the Google Maps link to your listing, or the correct address.` }];
    return [{ text: elsewhere
      ? `I couldn't find ${s.query} ${atOrIn(s.location!)} on Google. The listings I found with that name are ${looksLikeAddress(s.location!) ? 'at other addresses' : 'in other places'}. Where is your business? Send the Google Maps link to your listing, or the correct address (or city and state, or ZIP code).`
      : `I couldn't find ${s.query} ${atOrIn(s.location!)} on Google. Could you send me the Google Maps link to your listing, or correct the name or address exactly as they appear on Google?` }];
  }
  s.candidates = credible; s.idx = 0;
  return offer(s, credible.length > 1 ? `I found ${credible.length} listings for ${s.query} in ${s.location}. Let's find yours.` : undefined);
}

/** the confirmed listing: research and the first version start now; the link follows after the checks */
async function start(s: CustomSession): Promise<CustomReply[]> {
  // a beta invite's caps: businesses, one job at a time, its spend and the day's spend
  const runId = `ci_pending_${Date.now().toString(36)}`;
  if (s.inviteId) {
    const cap = await intakeDeps.capProblem(s.inviteId, 'research', { runId }, chargeCost);
    if (cap) { console.warn(`[imessage custom] ${s.from}: not started, ${cap}`); s.state = s.custom ? 'done' : 'need-business'; return [{ text: /still being made/.test(cap) ? "I'm still working on your other preview. I'll send the link here when it's ready, and then I can start another." : "I can't start another preview on this beta invite. I'll be in touch about next steps." }]; }
  }
  s.custom = newCustomRun({ placeId: s.chosen!.placeId, name: s.chosen!.name, website: s.website, confirmedAt: s.confirmedAt ?? new Date().toISOString(), inviteId: s.inviteId, from: s.from });
  if (s.inviteId) await intakeDeps.recordCharge(s.inviteId, { kind: 'research', from: s.from ?? '', runId: s.custom.id });
  s.custom = await advanceCustom(s.custom);
  settle(s);
  s.state = 'building';
  return [{ text: 'Thanks! I\'m researching your business and building your website preview. I\'ll check it and send the link here when it\'s ready. This may take a few minutes.' }, ...customMessages(s.custom)];
}
