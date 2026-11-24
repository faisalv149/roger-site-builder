import type { SiteManifest } from '../manifest.js';
import { undatedSeasonal } from '../../util/text.js';
import { LABEL_ONLY } from './labels.js';
import type { Catalog } from './review.js';
import type { BusinessBrief } from '../schema.js';
import type { DesignSpec, TextRef } from './designspec.js';

/**
 * What the open planner reads from an existing-website business's saved site manifest: a short selection, not the
 * manifest. The business's story and its own lines, a summary of its offerings (sections with a few examples, by id),
 * its brand, and its best relevant photos, each with the id of where it came from. Menu descriptions, prices and sizes
 * stay out; the planner asks for up to a few items by id ("menuNeeded") and only those are added (menuDetails).
 *
 * Award claims and prices are the business's own words but not confirmed: they are listed for the owner's review, a
 * flagged line may never be shown (claimProblems), and a price is never offered as fact.
 */
export const SELECTION_LIMITS = { lines: 16, examplesPerSection: 4, photos: 8, storyChars: 600, retrieve: 8 } as const;

export interface PlannerSelection {
  manifest: string;
  story: { id: string; text: string } | null;
  /** the business's own lines worth showing (menu item names and flagged claims are elsewhere), with their ownLine index */
  lines: { line: number; text: string }[];
  offerings: {
    services: { id: string; name: string }[];
    menu: { section: string; count: number; examples: { id: string; name: string; line?: number; photo?: string }[] }[];
  };
  /** what of the brand is confirmed (its colours and fonts themselves are in the request's brand line) */
  brand: { logo: 'verified' | 'review' | 'none'; colours: { hex: string; role: string; status: string }[]; /** no brand known: colours and fonts are proposals */ proposed?: string };
  /** role: what it can fill (hero-sized or a card); undescribed: its subject is unknown, given only because no verified photo fills that role */
  /** whether a verified photo can lead the page; if not, the hero is type-led */
  hero: string;
  photos: { id: string; w: number; h: number; role: 'hero' | 'card'; shows: string; undescribed?: true; item?: string; src?: string }[];
  review: { claims: { id: string; line?: number; text: string }[]; prices: string | null };
  retrieve: string;
  /** where the selection comes from, for the request's wording (default: the business's website) */
  source?: string;
  /** a business with no website: the listing's facts, a few live attributed reviews, and what is missing */
  facts?: Record<string, unknown>;
  reviews?: { author: string; rating: number; text: string; when?: string }[];
  missing?: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** a review heading or attribution with no review text of its own ("Reviews", "Review by - Yelp", "five star review by Jef R.:") */
export const reviewLabel = (t: string) =>
  /^\s*(?:(?:customer |our |google |yelp )?reviews?|testimonials?|what (?:people|our customers|our clients|guests|clients) (?:are )?say(?:ing)?|read (?:more |the |our )?reviews?(?: on \w+)?)\s*[.!:]*\s*$/i.test(t)
  || /\breview(?:ed)? by\b|^\s*(?:one|two|three|four|five|[1-5])[- ]star review\b/i.test(t);
/** an alt text that says what a photo shows: not empty, not stock words ("slideshow photo number 1", "image 3", "IMG_2041") */
export const describes = (alt: string | undefined) =>
  !!alt && /[a-z]{3,}/i.test(alt) && !/^\s*(?:slide(?:show)?|photo|image|img|picture|pic|banner|hero|gallery|untitled|dsc|thumbnail|background)\b[\s\w-]*\d*\s*$|\bphoto number\b|^img[_-]?\d+/i.test(alt);

/** the ownLine indices that are award claims in the manifest: never shown until the owner confirms them */
export function flaggedLines(m: SiteManifest, cat: Catalog): Set<number> {
  const flagged = new Set(m.text.filter((t) => t.flag === 'award-claim').map((t) => norm(t.text)));
  return new Set(cat.ownLines.flatMap((l, i) => (flagged.has(norm(l)) ? [i] : [])));
}

/** the selection the planner is given (see the module notes); `cat` is the planner's catalog (its photos and lines) */
export function plannerSelection(m: SiteManifest, cat: Catalog): PlannerSelection {
  const lineOf = new Map(cat.ownLines.map((l, i) => [norm(l), i]));
  const menuNames = new Set(m.menu.map((x) => norm(x.name)));
  const flagged = flaggedLines(m, cat);
  const planPhotos = new Map(cat.photos.map((p) => [p.id, p]));

  const story = m.text.find((t) => t.kind === 'story');
  const storyText = story ? (story.text.length <= SELECTION_LIMITS.storyChars ? story.text : `${story.text.slice(0, SELECTION_LIMITS.storyChars).replace(/\s+\S*$/, '')}… (${story.id})`) : null;
  // the lines worth offering: not a menu item's name (those are in the offerings), not a flagged claim, not a promotion
  // with a date but no year (the preview leaves those out until the owner confirms them), and not a review label or
  // attribution whose review text is not here ("Reviews", "Review by - Yelp", "five star review by Jef R.:")
  const lines = cat.ownLines.map((text, line) => ({ line, text })).filter((x) => !menuNames.has(norm(x.text)) && !flagged.has(x.line) && !undatedSeasonal(x.text) && !reviewLabel(x.text) && !LABEL_ONLY.test(x.text.trim())).slice(0, SELECTION_LIMITS.lines);

  // offerings: sections with a few examples each (items with a photo first, then with a description); a seasonal
  // section with no year ("Thanksgiving Favorites") is left out, with its items and their photos
  const sections = new Map<string, SiteManifest['menu']>();
  for (const it of m.menu) sections.set(it.section ?? 'Menu', [...(sections.get(it.section ?? 'Menu') ?? []), it]);
  const seasonal = new Set([...sections.keys()].filter((s) => undatedSeasonal(s)));
  const photoOf = (it: SiteManifest['menu'][number]) => it.images?.find((id) => planPhotos.has(id));
  const menu = [...sections].filter(([section]) => !seasonal.has(section)).map(([section, items]) => ({
    section, count: items.length,
    examples: [...items].sort((a, b) => Number(!!photoOf(b)) - Number(!!photoOf(a)) || Number(!!b.description) - Number(!!a.description)).slice(0, SELECTION_LIMITS.examplesPerSection)
      .map((it) => ({ id: it.id, name: it.name, ...(lineOf.has(norm(it.name)) ? { line: lineOf.get(norm(it.name))! } : {}), ...(photoOf(it) ? { photo: photoOf(it)! } : {}) })),
  }));

  // photos. A verified subject first: what an image check saw, a link to a menu item (the photo is in its block), or a
  // real description. An undescribed photo (no check, no link, an empty or stock alt such as "slideshow photo number 1")
  // comes in only for a role no verified photo can fill: one hero-sized photo, or one card. At most two from one menu
  // section, so the selection shows the range; nothing from a section left out.
  const itemOf = new Map(m.menu.filter((it) => !seasonal.has(it.section ?? 'Menu')).flatMap((it) => (it.images ?? []).map((id) => [id, it] as const)));
  const fromLeftOut = new Set(m.menu.filter((it) => seasonal.has(it.section ?? 'Menu')).flatMap((it) => it.images ?? []));
  const candidates = m.images.filter((i) => planPhotos.has(i.id) && !fromLeftOut.has(i.id)).map((i) => {
    const p = planPhotos.get(i.id)!;
    const it = itemOf.get(i.id);
    const subject = p.seen ?? it?.name ?? (describes(p.alt) ? p.alt : undefined);
    const role: 'hero' | 'card' = i.uses.includes('hero') ? 'hero' : 'card';
    const score = (p.seen ? 3 : 0) + (it ? 2 : 0) + (subject ? 1 : 0) + Math.min(2, (p.width * p.height) / 1e6);
    return { i, p, it, subject, role, score };
  });
  const photos = rankPhotos(candidates.map((c) => ({ id: c.i.id, w: c.p.width, h: c.p.height, role: c.role, subject: c.subject, score: c.score, ...(c.it ? { item: { id: c.it.id, section: c.it.section } } : {}), ...(c.i.src[0]?.page ? { src: c.i.src[0].page } : {}) })));

  // a flagged text is quoted short (its id points to the whole): it is listed so it is not used, not to be read
  const claims = m.text.filter((t) => t.flag === 'award-claim').map((t) => ({ id: t.id, ...(lineOf.has(norm(t.text)) ? { line: lineOf.get(norm(t.text))! } : {}), text: t.text.length <= 100 ? t.text : `${t.text.slice(0, 100).replace(/\s+\S*$/, '')}…` }));
  const priced = m.menu.filter((x) => x.price || x.options).length;
  return {
    manifest: `${m.businessKey} r${m.revision}`,
    story: story && storyText ? { id: story.id, text: storyText } : null,
    lines,
    offerings: { services: m.services.map((s) => ({ id: s.id, name: s.name })), menu },
    brand: { logo: m.brand.logo ? m.brand.logo.status : 'none', colours: [...new Map(m.brand.colours.map((c) => [c.hex, { hex: c.hex, role: c.role, status: c.status }])).values()] },
    photos,
    hero: heroNote(photos),
    review: { claims, prices: priced ? `${priced} menu price(s) read from the page layout: for the owner's review; never show or state a price as confirmed` : null },
    retrieve: m.menu.length ? `Menu descriptions, prices and sizes are not included. To use them, list up to ${SELECTION_LIMITS.retrieve} menu item ids in "menuNeeded"; only those are added.` : 'No menu.',
  };
}

/** a photo the planner may be given, with what is known about it */
interface PhotoCandidate { id: string; w: number; h: number; role: 'hero' | 'card'; subject?: string; score: number; item?: { id: string; section?: string }; src?: string }
/**
 * The photos the planner is given (at most SELECTION_LIMITS.photos). A verified subject first: what an image check saw,
 * a link to a menu item, or a real description. An undescribed photo comes in only for a card no verified photo can
 * fill, marked as such, and never for the hero: it would lead the page with an unknown subject (the hero is type-led
 * instead). At most two from one menu section, so the selection shows the range.
 */
export function rankPhotos(candidates: PhotoCandidate[]): PlannerSelection['photos'] {
  const verified = candidates.filter((c) => c.subject).sort((a, b) => b.score - a.score);
  const undescribed = candidates.filter((c) => !c.subject).sort((a, b) => b.score - a.score);
  const perSection = new Map<string, number>();
  const photos: PlannerSelection['photos'] = [];
  const take = (c: PhotoCandidate, fallback = false) => {
    if (photos.length >= SELECTION_LIMITS.photos) return;
    const sec = c.item?.section ?? '';
    if (sec && (perSection.get(sec) ?? 0) >= 2) return;
    perSection.set(sec, (perSection.get(sec) ?? 0) + 1);
    photos.push({ id: c.id, w: c.w, h: c.h, role: c.role, shows: c.subject ?? 'not described (no image check, no item, no description)', ...(fallback ? { undescribed: true as const } : {}), ...(c.item ? { item: c.item.id } : {}), ...(c.src ? { src: c.src } : {}) });
  };
  if (!verified.some((x) => x.role === 'card')) { const c = undescribed.find((x) => x.role === 'card'); if (c) take(c, true); }
  for (const c of verified) take(c);
  return photos;
}
const heroNote = (photos: PlannerSelection['photos']) => (photos.some((p) => p.role === 'hero' && !p.undescribed) ? 'a verified photo may lead (role "hero")' : 'type-led: no verified photo fits the hero, so lead with its own words (no hero.backgroundPhoto, no hero image)');

/** a Google review, as the listing returns it now (fetched for this request only, never stored) */
export interface ListingReview { author: string; rating: number; text: string; when?: string }
/**
 * The planner's input for a business with no website: what its Google listing and Roger's brief verify. Facts (name,
 * category, address, phone, hours, rating), a few attributed reviews (fetched live for this request, never stored, for
 * understanding only: never quoted on the page), and its verified listing photos (preview only, with their
 * photographers' credit). Services and menu items only where the brief sources them; everything not known is listed in
 * "missing" so the design does not pretend otherwise. With no brand known, colours and fonts are proposals.
 */
export function listingSelection(brief: BusinessBrief, cat: Catalog, reviews: ListingReview[] = []): PlannerSelection {
  const sourced = (brief.services.items ?? []).filter((s) => s.evidence.length);
  const services = cat.services.filter((s) => sourced.some((x) => x.id === s.id)).map((s) => ({ id: s.id, name: s.name }));
  const menu = cat.items.length ? [...new Set(cat.items.map((i) => i.section ?? 'Menu'))].map((section) => {
    const items = cat.items.filter((i) => (i.section ?? 'Menu') === section);
    return { section, count: items.length, examples: items.slice(0, SELECTION_LIMITS.examplesPerSection).map((i) => ({ id: i.id, name: i.name })) };
  }) : [];
  const candidates: PhotoCandidate[] = cat.photos.map((p) => {
    const subject = p.seen ?? (describes(p.alt) ? p.alt : undefined);
    return { id: p.id, w: p.width, h: p.height, role: p.uses.includes('hero') ? 'hero' as const : 'card' as const, subject, score: (p.seen ? 3 : 0) + (subject ? 1 : 0) + Math.min(2, (p.width * p.height) / 1e6), src: p.url.startsWith('google-listing:') ? 'google listing (preview only, credited)' : 'website' };
  });
  const photos = rankPhotos(candidates);
  const brandKnown = brief.brand.colors.length > 0;
  const fontsKnown = brief.brand.fonts.length > 0;
  const missing = [
    ...(!brief.identity.website.value ? ['website'] : []),
    ...(!services.length ? ['services (none sourced: none may be listed)'] : []),
    ...(!menu.length ? ['menu items and prices'] : []),
    ...(!cat.story ? ['story (no words of its own)'] : []),
    ...(!cat.ownLines.length ? ['its own headlines or taglines (only short plain labels may be written)'] : []),
    ...(!brandKnown ? ['brand colours (proposed here)'] : []),
    ...(!fontsKnown ? ['brand fonts (proposed here)'] : []),
    ...(!cat.logo ? ['logo (the name is set as a wordmark)'] : []),
    ...(!cat.email ? ['email'] : []),
    ...(!cat.phone ? ['phone'] : []),
    ...(!cat.hours?.length ? ['opening hours'] : []),
    ...(!photos.some((p) => !p.undescribed) ? ['verified photos'] : []),
  ];
  return {
    manifest: `google listing ${brief.identity.listing?.placeId ?? ''} (${brief.businessKey} r${brief.revision})`,
    source: 'its Google listing (there is no website)',
    facts: {
      name: cat.business.name, category: cat.business.category, address: cat.address?.formatted ?? null, phone: cat.phone?.display ?? null,
      hours: cat.hours ?? null, area: cat.area ?? null, rating: cat.rating ? `${cat.rating.value} from ${cat.rating.count} Google reviews` : null,
      googleSummary: cat.business.summary ? `${cat.business.summary} (Google's words, not the business's: never quote it)` : null,
    },
    reviews: reviews.slice(0, 3).map((r) => ({ author: r.author, rating: r.rating, text: r.text.length <= 220 ? r.text : `${r.text.slice(0, 220).replace(/\s+\S*$/, '')}…`, ...(r.when ? { when: r.when } : {}) })),
    story: null,
    lines: [],
    offerings: { services, menu },
    brand: { logo: cat.logo ? 'review' : 'none', colours: [], ...(brandKnown && fontsKnown ? {} : { proposed: 'no brand known: the colours and fonts chosen are proposals, recorded as such for the owner' }) },
    photos,
    hero: heroNote(photos),
    review: { claims: [], prices: null },
    retrieve: 'No menu.',
    missing,
  };
}

/** the details of the menu items the planner asked for (at most a few), prices marked as unconfirmed */
export function menuDetails(m: SiteManifest, ids: string[], cat: Catalog) {
  const lineOf = new Map(cat.ownLines.map((l, i) => [norm(l), i]));
  const planPhotos = new Set(cat.photos.map((p) => p.id));
  return [...new Set(ids)].slice(0, SELECTION_LIMITS.retrieve).flatMap((id) => {
    const it = m.menu.find((x) => x.id === id);
    if (!it) return [];
    const unconfirmed = (p: string) => `${p} (for the owner's review; not confirmed)`;
    const photo = it.images?.find((x) => planPhotos.has(x));
    return [{
      id: it.id, name: it.name, ...(it.section ? { section: it.section } : {}), ...(lineOf.has(norm(it.name)) ? { line: lineOf.get(norm(it.name))! } : {}),
      ...(it.description ? { description: it.description } : {}), ...(it.price ? { price: unconfirmed(it.price.text) } : {}),
      ...(it.options ? { options: it.options.map((o) => `${o.label}: ${unconfirmed(o.price)}`) } : {}), ...(photo ? { photo } : {}),
    }];
  });
}

/** every visible ownLine in a spec that is a flagged award claim: it may not be shown until the owner confirms it */
export function claimProblems(spec: DesignSpec, cat: Catalog, flagged: Set<number>): string[] {
  if (!flagged.size) return [];
  const errs: string[] = [];
  const check = (r: TextRef | null | undefined, where: string) => {
    if (r && 'ownLine' in r && flagged.has(r.ownLine)) errs.push(`${where}: ownLine ${r.ownLine} ("${(cat.ownLines[r.ownLine] ?? '').slice(0, 60)}") is an award claim the owner has not confirmed; do not show it`);
  };
  const h = spec.hero;
  check(h.kicker, 'hero.kicker'); check(h.headline, 'hero.headline'); check(h.lede, 'hero.lede');
  (h.aside.items ?? []).forEach((r, i) => check(r, `hero.aside.items[${i}]`));
  spec.sections.forEach((s, i) => {
    check(s.heading, `sections[${i}].heading`); check(s.intro, `sections[${i}].intro`);
    s.items.forEach((it, j) => { check(it.title, `sections[${i}].items[${j}].title`); check(it.body, `sections[${i}].items[${j}].body`); });
  });
  return errs;
}

/** the photos that may lead the page: verified ones big enough for the hero (none: the hero is type-led) */
export const heroPhotos = (sel: PlannerSelection) => new Set(sel.photos.filter((p) => p.role === 'hero' && !p.undescribed).map((p) => p.id));

/** a hero photo that is not a verified, hero-sized one from the selection */
export function heroProblems(spec: DesignSpec, sel: PlannerSelection): string[] {
  const ok = heroPhotos(sel);
  const used = [spec.hero.backgroundPhoto, spec.hero.aside?.kind === 'image' ? spec.hero.aside.photoId : null].filter((x): x is string => !!x);
  return used.filter((id) => !ok.has(id)).map((id) => ok.size
    ? `hero: photo "${id}" may not lead the page; use one of the verified hero photos (${[...ok].join(', ')}) or make the hero type-led`
    : `hero: photo "${id}" may not lead the page: no verified photo fits the hero, so make it type-led (no background photo, no image beside the text)`);
}

/** the same for a direction's plan: a hero planned around a photo when none may lead */
export function directionHeroProblems(d: { idea: { hero: { aside: string; photoBehindText: boolean } }; revised: { hero: { aside: string; photoBehindText: boolean } } | null }, sel: PlannerSelection): string[] {
  if (heroPhotos(sel).size) return [];
  const idea = d.revised ?? d.idea;
  return idea?.hero && (idea.hero.aside === 'image' || idea.hero.photoBehindText) ? [`${d.revised ? 'revised' : 'idea'}.hero: no verified photo fits the hero, so plan it type-led (no photo behind the text, no image beside it)`] : [];
}
