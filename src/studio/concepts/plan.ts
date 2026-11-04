import type { BusinessBrief } from '../schema.js';
import { checkCopy, checkStory } from './copy.js';
import type { Catalog, Photo } from './review.js';
import { brandHeadingFont, tokensFor } from './tokens.js';
import { COLOR_STRATEGIES, DENSITIES, IMAGERY, SECTION_KINDS, STRUCTURES, TYPE_VOICES, VARIANTS, type ComposedSection, type Concept, type ConceptAction, type CopyBlock, type DirectionPlan, type SectionKind } from './types.js';

/**
 * Three directions for a business: Claude proposes them (one request, validated, retried at most twice), or, when
 * Claude is off or over budget, a deterministic planner assigns the library's variants so that no two concepts share a
 * hero, an offer layout, a structure, a type voice or a colour strategy. Either way the same rules decide what is
 * distinct, and every fact, picture and action is chosen by id from the catalog.
 */

export const PROMPT_VERSION = 'concepts-plan-1';

const LIBRARY = `Section library (kind: variant — what it does):
hero: full-bleed — one landscape photograph fills the screen, headline over it, bottom-left · split — text on a plain panel beside one framed photograph · type-collage — oversized headline on the brand colour with a collage of three tilted photos and a running list of the menu or services.
offer (services or menu): cards — a grid of cards (photos for services, prices for menu items) · board — an index or menu board: numbered services, or the whole menu by section with dotted leaders to prices · rows — alternating photo-and-text rows, one per service or menu section.
proof: rating-band — a dark band with the Google rating as a huge number and the business's own claims · pledges — the business's own claims and offers as bold cards · stat-strip — three or four big numbers (rating, review count, locations or towns, number of services or dishes).
gallery: mosaic — a 4-column grid with one large tile · filmstrip — a horizontal scrolling strip of tall photos · feature-grid — one large photo with smaller ones.
story: columns — a pull quote from the story and the rest in two columns · portrait — a portrait photo beside the story.
contact: panel — contact details beside a dark action card · locations — a card per location with directions · band — a dark band with the phone number large, then hours and address.`;

const RULES = `Rules:
1. Three directions that differ in page composition, hero treatment, content hierarchy and imagery: each uses a different hero variant, a different offer variant, a different structure, a different typeVoice and a different colorStrategy. Not colour swaps, not the same sections reordered.
2. Each direction's section order expresses its structure: offer-first puts the offer second; story-first the story; proof-first the proof; visit-first the contact; gallery-first the gallery. Hero always first. Use each kind at most once; include contact. Leave out kinds the business has nothing for (no story → no story section; fewer than 4 photos → no gallery; no rating and no claims → no proof).
3. Ground every choice: the thesis says why this direction suits THIS business, citing its facts; evidence lists the fact ids it leans on.
4. Copy (eyebrow, headline, subline, titles, intros, storyText) frames the facts and adds none: no numbers, names, places, prices, years, awards or claims that are not in the facts below; use the business's own words for claims ("free", "family owned" only if the facts say so). Sentence case only (capitalise the first word and proper names, nothing else). Headline at most 9 words; subline at most 30; titles at most 6 words; intros at most 30 words; storyText at most 110 words, a faithful shortening of the story in its own facts, or "" when there is no story section.
5. Choose pictures by id from the photo list: full-bleed needs a landscape photo with use "hero"; split takes any photo at least 900px wide; type-collage takes three. Do not use the same hero photo in two directions. galleryImageIds: 5 to 8 photos not used in that direction's hero. storyImageId: a portrait photo for story:portrait, else "".
6. primaryAction and secondaryAction are action ids from the list (or ""). featureIds: the services or menu items to show first.
7. Never mention anything in "Left out of previews".`;

/** the prompt: the business's facts, the library, the rules */
export function planPrompt(cat: Catalog, brief: BusinessBrief): { system: string; prompt: string } {
  const photo = (p: Photo) => `${p.id}: ${p.orientation} ${p.width}x${p.height}, uses ${p.uses.join('/')}${p.alt ? `, "${p.alt.slice(0, 80)}"` : ''}${p.services.length ? `, shows ${p.services.join(', ')}` : ''}`;
  const lines = [
    `Business: ${cat.business.name}${cat.business.category ? ` (${cat.business.category})` : ''}`,
    cat.business.summary ? `Summary (checked against the evidence): ${cat.business.summary}` : '',
    cat.area ? `Service area: ${cat.area.join(', ')}` : '',
    cat.locations.length ? `Locations (${cat.locations.length}${cat.address ? '' : ', none is the main one'}): ${cat.locations.map((l) => `${l.id} ${l.street}, ${l.cityLine}`).join(' · ')}` : '',
    cat.hours ? `Hours: ${cat.hours.join('; ')}` : '',
    cat.rating ? `Google rating: ${cat.rating.value} from ${cat.rating.count} reviews${cat.rating.scope ? ` (for the ${cat.rating.scope} only)` : ''} [fact id rating]` : '',
    cat.claims.length ? `The business's own claims: ${cat.claims.map((c) => `${c.id} "${c.text}"`).join(' · ')}` : '',
    cat.pledges.length ? `Its offers: ${cat.pledges.map((c) => `${c.id} "${c.text}"`).join(' · ')}` : '',
    cat.services.length ? `Services:\n${cat.services.map((s) => `- ${s.id}: ${s.name}${s.description ? ` — ${s.description.slice(0, 160)}` : ''}${s.imageId ? ` (its own photo: ${s.imageId})` : ' (no photo of its own)'}`).join('\n')}` : '',
    cat.items.length ? `Menu (${cat.items.length} items; prices only where confirmed):\n${[...new Set(cat.items.map((i) => i.section ?? ''))].map((sec) => `${sec || 'Items'}: ${cat.items.filter((i) => (i.section ?? '') === sec).map((i) => `${i.id} ${i.name}${i.price ? ` ${i.price}` : ''}`).join('; ')}`).join('\n')}` : '',
    cat.story ? `Story ("${cat.story.heading}"): ${cat.story.text.slice(0, 1500)}` : 'Story: none',
    `Brand: colours ${brief.brand.colors.map((c) => `${c.role} ${c.hex} (${c.confidence})`).join(', ') || 'none found'}; fonts ${brief.brand.fonts.map((f) => f.family).slice(0, 4).join(', ') || 'none found'}${brandHeadingFont(brief) ? `; its own Google font: ${brandHeadingFont(brief)}` : ''}`,
    `Photos (${cat.photos.length}):\n${cat.photos.map(photo).join('\n')}`,
    `Actions: ${cat.actions.map((a) => `${a.id} "${a.label}"`).join(' · ') || 'none'}`,
    cat.omitted.length ? `Left out of previews (open questions): ${cat.omitted.map((o) => o.what).join('; ')}` : '',
    `Structures: ${STRUCTURES.join(', ')}. typeVoice: ${TYPE_VOICES.join(', ')}. colorStrategy: ${COLOR_STRATEGIES.join(', ')}. density: ${DENSITIES.join(', ')}. imageryRole: ${IMAGERY.join(', ')}.`,
  ].filter(Boolean);
  return {
    system: `You are the lead designer at Roger, which makes websites for small local businesses. From one business's verified facts you propose three genuinely different homepage directions, built only from Roger's section library, each one specific to this business rather than a template. You never add facts.\n\n${LIBRARY}\n\n${RULES}`,
    prompt: `${lines.join('\n\n')}\n\nPropose the three directions.`,
  };
}

const str = { type: 'string' };
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'thesis', 'evidence', 'structure', 'density', 'imageryRole', 'typeVoice', 'colorStrategy', 'sections', 'hero', 'titles', 'primaryAction', 'secondaryAction', 'featureIds', 'galleryImageIds', 'storyImageId', 'storyText'],
        properties: {
          name: str, thesis: str, evidence: { type: 'array', items: str },
          structure: { type: 'string', enum: [...STRUCTURES] }, density: { type: 'string', enum: [...DENSITIES] }, imageryRole: { type: 'string', enum: [...IMAGERY] },
          typeVoice: { type: 'string', enum: [...TYPE_VOICES] }, colorStrategy: { type: 'string', enum: [...COLOR_STRATEGIES] },
          sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'variant'], properties: { kind: { type: 'string', enum: [...SECTION_KINDS] }, variant: { type: 'string', enum: [...new Set(Object.values(VARIANTS).flat())] } } } },
          hero: { type: 'object', additionalProperties: false, required: ['eyebrow', 'headline', 'subline', 'imageIds'], properties: { eyebrow: str, headline: str, subline: str, imageIds: { type: 'array', items: str } } },
          titles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'intro'], properties: { kind: { type: 'string', enum: [...SECTION_KINDS] }, title: str, intro: str } } },
          primaryAction: str, secondaryAction: str, featureIds: { type: 'array', items: str }, galleryImageIds: { type: 'array', items: str }, storyImageId: str, storyText: str,
        },
      },
    },
  },
} as const;

/** the answer, as the planner's type ("" meaning none) */
export function fromAnswer(a: { concepts: Record<string, unknown>[] }): DirectionPlan[] {
  return (a.concepts ?? []).map((x) => {
    const c = x as Record<string, any>;
    return {
      name: c.name, thesis: c.thesis, evidence: c.evidence ?? [], axes: { structure: c.structure, density: c.density, imageryRole: c.imageryRole, typeVoice: c.typeVoice, colorStrategy: c.colorStrategy },
      sections: c.sections ?? [], hero: c.hero, titles: c.titles ?? [], primaryAction: c.primaryAction || null, secondaryAction: c.secondaryAction || null,
      featureIds: c.featureIds ?? [], galleryImageIds: c.galleryImageIds ?? [], storyImageId: c.storyImageId || null, storyText: c.storyText || null,
    };
  });
}

// ───────────────────────── what the business has content for ─────────────────────────
export function available(cat: Catalog): Record<SectionKind, boolean> {
  return {
    hero: true,
    offer: cat.services.length > 0 || cat.items.length > 0,
    proof: !!cat.rating || cat.claims.length + cat.pledges.length > 0,
    gallery: cat.photos.length >= 6,
    story: !!cat.story,
    contact: true,
  };
}
const heroOk = (variant: string, p: Photo | undefined) => !!p && (variant === 'full-bleed' ? p.orientation === 'landscape' && p.uses.includes('hero') : variant === 'split' ? p.width >= 900 : true);

/** Every rule a set of plans must meet. The same rules check Claude's plans and the fallback's. */
export function validatePlans(plans: DirectionPlan[], cat: Catalog, opts: { copy?: boolean } = {}): string[] {
  const errs: string[] = [];
  if (plans.length !== 3) return [`there must be exactly 3 directions, not ${plans.length}`];
  const has = available(cat);
  const photo = new Map(cat.photos.map((p) => [p.id, p]));
  const facts = new Set([...Object.keys(cat.facts), ...cat.services.map((s) => s.id), ...cat.items.map((i) => i.id)]);
  const actions = new Set(cat.actions.map((a) => a.id));
  plans.forEach((p, i) => {
    const at = `direction ${i + 1} ("${p.name}")`;
    if (!p.sections.length || p.sections[0].kind !== 'hero') errs.push(`${at}: the first section must be the hero`);
    const kinds = p.sections.map((s) => s.kind);
    if (new Set(kinds).size !== kinds.length) errs.push(`${at}: a section kind is used twice`);
    if (!kinds.includes('contact')) errs.push(`${at}: it has no contact section`);
    for (const s of p.sections) {
      if (!(VARIANTS[s.kind] as readonly string[]).includes(s.variant)) errs.push(`${at}: "${s.variant}" is not a ${s.kind} variant (${VARIANTS[s.kind].join(', ')})`);
      if (!has[s.kind]) errs.push(`${at}: the business has nothing for a ${s.kind} section`);
    }
    const lead: Record<string, SectionKind> = { 'offer-first': 'offer', 'story-first': 'story', 'proof-first': 'proof', 'visit-first': 'contact', 'gallery-first': 'gallery' };
    if (kinds[1] !== lead[p.axes.structure]) errs.push(`${at}: structure ${p.axes.structure} needs the ${lead[p.axes.structure]} section second, after the hero`);
    const hero = p.sections[0]?.variant;
    const heroImgs = p.hero.imageIds.filter((id) => photo.has(id));
    if (hero === 'type-collage' ? heroImgs.length < Math.min(3, cat.photos.length) : !heroOk(hero, photo.get(heroImgs[0]))) errs.push(`${at}: the ${hero} hero needs ${hero === 'type-collage' ? 'three photo ids' : hero === 'full-bleed' ? 'a landscape photo with use "hero"' : 'a photo at least 900px wide'} from the list`);
    for (const id of [...p.hero.imageIds, ...p.galleryImageIds, ...(p.storyImageId ? [p.storyImageId] : [])]) if (!photo.has(id)) errs.push(`${at}: "${id}" is not a photo id`);
    for (const id of p.featureIds) if (!facts.has(id)) errs.push(`${at}: "${id}" is not a service or menu item id`);
    // evidence only supports the thesis (for the reviewer, not the page): an id that is not in the catalog is dropped when composing, not an error
    for (const id of [p.primaryAction, p.secondaryAction]) if (id && !actions.has(id)) errs.push(`${at}: "${id}" is not an action id`);
    if (kinds.includes('gallery') && p.galleryImageIds.filter((id) => photo.has(id) && !p.hero.imageIds.includes(id)).length < 4) errs.push(`${at}: the gallery needs at least 4 photos not used in its hero`);
    const copy: [string, string][] = [['hero.eyebrow', p.hero.eyebrow], ['hero.headline', p.hero.headline], ['hero.subline', p.hero.subline], ...p.titles.flatMap((t): [string, string][] => [[`${t.kind}.title`, t.title], [`${t.kind}.intro`, t.intro]])];
    if (opts.copy !== false) for (const [slot, text] of copy) if (text) errs.push(...checkCopy(text, slot, cat).map((e) => `${at}: ${e}`));
    if (opts.copy !== false && kinds.includes('story') && p.storyText) errs.push(...checkStory(p.storyText, cat).map((e) => `${at}: ${e}`));
  });
  // distinct: no shared hero, offer layout, structure, voice or colour strategy; no shared hero photo
  const distinct = (label: string, get: (p: DirectionPlan) => string | undefined) => { const v = plans.map(get).filter(Boolean); if (new Set(v).size !== v.length) errs.push(`two directions share the same ${label} (${v.join(', ')}): each must differ`); };
  distinct('hero variant', (p) => p.sections[0]?.variant);
  distinct('offer variant', (p) => p.sections.find((s) => s.kind === 'offer')?.variant);
  distinct('structure', (p) => p.axes.structure);
  distinct('typeVoice', (p) => p.axes.typeVoice);
  distinct('colorStrategy', (p) => p.axes.colorStrategy);
  distinct('hero photo', (p) => (p.sections[0]?.variant === 'type-collage' ? undefined : p.hero.imageIds[0]));
  return [...new Set(errs)];
}

// ───────────────────────── the fallback planner ─────────────────────────
/** Deterministic directions from the library: a Latin square over hero, offer, proof, gallery, contact and voice. */
export function fallbackPlans(cat: Catalog, brief: BusinessBrief): DirectionPlan[] {
  const has = available(cat);
  const land = cat.photos.filter((p) => p.orientation === 'landscape' && p.uses.includes('hero')).sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const wide = cat.photos.filter((p) => p.width >= 900).sort((a, b) => (a.orientation === 'portrait' ? -1 : 0) - (b.orientation === 'portrait' ? -1 : 0) || b.width - a.width || a.id.localeCompare(b.id));
  const portrait = cat.photos.filter((p) => p.orientation !== 'landscape');
  const multi = cat.locations.length > 1;
  const menu = cat.items.length > 0;
  const city = cat.locations[0]?.cityLine.split(',')[0] ?? cat.area?.[0];
  const what = menu ? 'menu' : 'services';
  const primary = cat.actions.find((a) => ['call', 'book'].includes(a.kind))?.id ?? cat.actions.find((a) => a.kind === 'site' || a.kind === 'menu')?.id ?? null;
  const secondary = cat.actions.find((a) => a.id !== primary && ['menu', 'site', 'book', 'call', 'reviews'].includes(a.kind))?.id ?? null;
  const usedHero = new Set<string>();
  const pickHero = (variant: string) => {
    if (variant === 'type-collage') return (portrait.length >= 3 ? portrait : cat.photos).slice(0, 3).map((p) => p.id);
    const pool = variant === 'full-bleed' ? land : wide;
    const p = pool.find((x) => !usedHero.has(x.id)) ?? pool[0];
    if (p) usedHero.add(p.id);
    return p ? [p.id] : [];
  };
  const gallery = (hero: string[], offset: number) => { const rest = cat.photos.filter((p) => !hero.includes(p.id)); return [...rest.slice(offset), ...rest.slice(0, offset)].slice(0, 7).map((p) => p.id); };
  const order = (lead: SectionKind, rest: SectionKind[]) => ['hero' as SectionKind, lead, ...rest.filter((k) => k !== lead)].filter((k) => has[k]);
  const heroVariants = [land.length ? 'full-bleed' : 'split', land.length ? 'split' : 'type-collage', land.length ? 'type-collage' : 'full-bleed'].map((v) => (v === 'full-bleed' && !land.length ? 'split' : v));
  const brandFont = brandHeadingFont(brief);
  const specs = [
    { name: `${menu ? 'Menu' : 'Services'} up front`, structure: has.offer ? 'offer-first' : 'gallery-first', lead: (has.offer ? 'offer' : 'gallery') as SectionKind, rest: ['proof', 'gallery', 'story', 'contact'] as SectionKind[], offer: 'cards', proof: 'rating-band', gallery: 'mosaic', contact: 'panel', voice: brandFont ? 'grotesk' : 'grotesk', color: 'brand-dominant', density: 'balanced', imagery: 'lead' },
    { name: 'The story first', structure: has.story ? 'story-first' : has.gallery ? 'gallery-first' : 'offer-first', lead: (has.story ? 'story' : has.gallery ? 'gallery' : 'offer') as SectionKind, rest: ['gallery', 'offer', 'proof', 'contact'] as SectionKind[], offer: 'board', proof: 'stat-strip', gallery: 'filmstrip', contact: multi ? 'locations' : 'panel', voice: 'serif', color: 'brand-accent', density: 'airy', imagery: 'supporting' },
    { name: multi ? 'Every location' : 'Reputation first', structure: multi ? 'visit-first' : has.proof ? 'proof-first' : 'visit-first', lead: (multi ? 'contact' : has.proof ? 'proof' : 'contact') as SectionKind, rest: ['offer', 'proof', 'gallery', 'contact'] as SectionKind[], offer: 'rows', proof: cat.claims.length + cat.pledges.length ? 'pledges' : 'stat-strip', gallery: 'feature-grid', contact: multi ? 'locations' : 'band', voice: 'display', color: 'neutral-with-brand-action', density: 'dense', imagery: 'minimal' },
  ];
  // a structure the business cannot have falls to one no other direction uses
  const taken = new Set<string>();
  for (const s of specs) { if (taken.has(s.structure)) { const free = (['offer-first', 'gallery-first', 'proof-first', 'visit-first', 'story-first'] as const).find((x) => !taken.has(x) && has[({ 'offer-first': 'offer', 'story-first': 'story', 'proof-first': 'proof', 'visit-first': 'contact', 'gallery-first': 'gallery' } as const)[x]]); if (free) { s.structure = free; s.lead = ({ 'offer-first': 'offer', 'story-first': 'story', 'proof-first': 'proof', 'visit-first': 'contact', 'gallery-first': 'gallery' } as const)[free]; } } taken.add(s.structure); }
  if (specs[1].proof === specs[2].proof) specs[1].proof = 'rating-band';
  return specs.map((s, i) => {
    const hero = heroVariants[i];
    const heroIds = pickHero(hero);
    const variants: Record<string, string> = { hero, offer: s.offer, proof: s.proof, gallery: s.gallery, story: i === 1 && portrait.length ? 'portrait' : 'columns', contact: s.contact };
    const kinds = order(s.lead, s.rest);
    if (!kinds.includes('contact')) kinds.push('contact');
    const headline = [cat.business.name, cat.business.category && city ? `${cat.business.category} in ${city}` : cat.business.category ?? cat.business.name, menu ? `The ${cat.business.name} menu` : cat.services[0]?.name ?? cat.business.name][i];
    return {
      name: s.name, thesis: `A ${s.structure.replace('-', ' ')} page with a ${hero} hero, built from the business's own ${what}${cat.rating ? ', Google rating' : ''} and photos.`,
      evidence: [menu ? cat.items[0]?.id : cat.services[0]?.id, cat.rating ? 'rating' : undefined].filter(Boolean) as string[],
      axes: { structure: s.structure as DirectionPlan['axes']['structure'], density: s.density as DirectionPlan['axes']['density'], imageryRole: s.imagery as DirectionPlan['axes']['imageryRole'], typeVoice: s.voice as DirectionPlan['axes']['typeVoice'], colorStrategy: s.color as DirectionPlan['axes']['colorStrategy'] },
      sections: kinds.map((k) => ({ kind: k, variant: variants[k] })),
      hero: { eyebrow: cat.business.category ?? '', headline, subline: '', imageIds: heroIds },
      titles: [], primaryAction: primary, secondaryAction: secondary, featureIds: [], galleryImageIds: gallery(heroIds, i * 2), storyImageId: i === 1 ? portrait.find((p) => !heroIds.includes(p.id))?.id ?? null : null, storyText: null,
    };
  });
}

// ───────────────────────── composing a concept from a plan ─────────────────────────
const DEFAULT_TITLES: Record<SectionKind, (cat: Catalog) => string> = {
  hero: () => '', offer: (c) => (c.items.length ? 'The menu' : 'Services'), proof: (c) => (c.rating ? 'Rated on Google' : 'Our word'), gallery: () => 'A closer look',
  story: (c) => c.story?.heading.replace(/^about\s+.*$/i, 'Our story') || 'Our story', contact: (c) => (c.locations.length > 1 ? 'Locations' : 'Visit'),
};
const excerpt = (t: string, max = 900) => { const s = t.replace(/\s+\n/g, '\n').trim().match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [t]; let out = ''; for (const x of s) { if ((out + x).length > max && out) break; out += x; } return out.trim(); };

export function compose(plan: DirectionPlan, id: 'a' | 'b' | 'c', source: 'ai' | 'fallback', cat: Catalog, brief: BusinessBrief, useBrandFont: boolean): Concept {
  const has = available(cat);
  const photo = new Map(cat.photos.map((p) => [p.id, p]));
  const hero = plan.sections[0].variant;
  const axes = { ...plan.axes, heroComposition: hero as Concept['axes']['heroComposition'] };
  const copy: CopyBlock[] = [];
  const say = (slot: string, text: string, fallback: string, refs: string[] = []) => {
    const ok = text && !checkCopy(text, slot, cat).length;
    copy.push({ slot, origin: ok ? (source === 'ai' ? 'generated' : 'default') : 'default', text: ok ? text : fallback, refs });
  };
  say('hero.eyebrow', plan.hero.eyebrow, cat.business.category ?? '');
  say('hero.headline', plan.hero.headline, cat.business.name, ['name']);
  say('hero.subline', plan.hero.subline, cat.area ? `Serving ${cat.area.slice(0, 4).join(', ')}.` : cat.locations.length > 1 ? `${cat.locations.length} locations.` : cat.address ? cat.address.formatted : '', cat.area ? ['area'] : []);
  const heroIds = plan.hero.imageIds.filter((x) => photo.has(x));
  const used = new Set(heroIds);
  const sections: ComposedSection[] = [];
  for (const s of plan.sections) {
    if (!has[s.kind]) continue;
    const t = plan.titles.find((x) => x.kind === s.kind);
    const title = s.kind === 'hero' ? '' : t?.title && !checkCopy(t.title, `${s.kind}.title`, cat).length ? t.title : DEFAULT_TITLES[s.kind](cat);
    const intro = t?.intro && !checkCopy(t.intro, `${s.kind}.intro`, cat).length ? t.intro : '';
    if (s.kind !== 'hero') copy.push({ slot: `${s.kind}.title`, origin: t?.title === title ? (source === 'ai' ? 'generated' : 'default') : 'default', text: title, refs: [] });
    if (intro && s.kind !== 'hero') copy.push({ slot: `${s.kind}.intro`, origin: source === 'ai' ? 'generated' : 'default', text: intro, refs: [] });
    let variant = s.variant;
    let factIds: string[] = [];
    let imageIds: string[] = [];
    if (s.kind === 'hero') imageIds = heroIds;
    if (s.kind === 'offer') {
      factIds = [...plan.featureIds.filter((x) => cat.services.some((v) => v.id === x) || cat.items.some((v) => v.id === x)), ...cat.services.map((v) => v.id), ...cat.items.map((v) => v.id)].filter((v, i, a) => a.indexOf(v) === i);
      // offer sections show only pictures tied to what they show (a service's own, or the owner's choice): none chosen here
      imageIds = [];
    }
    if (s.kind === 'proof') {
      factIds = [...(cat.rating ? ['rating'] : []), ...cat.claims.map((x) => x.id), ...cat.pledges.map((x) => x.id)];
      if (variant === 'pledges' && !cat.claims.length && !cat.pledges.length) variant = 'stat-strip';
      if (variant === 'rating-band' && !cat.rating) variant = 'pledges';
    }
    if (s.kind === 'gallery') {
      const wanted = plan.galleryImageIds.filter((x) => photo.has(x) && !heroIds.includes(x));
      const fill = cat.photos.filter((p) => !heroIds.includes(p.id) && !wanted.includes(p.id)).map((p) => p.id);
      imageIds = [...wanted, ...fill].slice(0, variant === 'feature-grid' ? 5 : variant === 'filmstrip' ? 8 : 7);
    }
    if (s.kind === 'story') {
      factIds = ['story'];
      const text = plan.storyText && !checkStory(plan.storyText, cat).length ? plan.storyText : null;
      copy.push(text ? { slot: 'story.text', origin: 'paraphrase', text, refs: ['story'] } : { slot: 'story.text', origin: 'bound', text: excerpt(cat.story!.text), refs: ['story'] });
      if (variant === 'portrait') { const p = (plan.storyImageId && photo.get(plan.storyImageId)) || cat.photos.find((x) => x.orientation === 'portrait' && !heroIds.includes(x.id)); if (p) imageIds = [p.id]; else variant = 'columns'; }
    }
    if (s.kind === 'contact') {
      factIds = [cat.address?.id, cat.phone ? 'phone' : undefined, cat.email ? 'email' : undefined, cat.hours ? 'hours' : undefined, cat.area ? 'area' : undefined, ...cat.locations.map((l) => l.id)].filter(Boolean) as string[];
      if (variant === 'locations' && !cat.locations.length) variant = 'panel';
    }
    imageIds.forEach((x) => used.add(x));
    sections.push({ kind: s.kind, variant, id: s.kind === 'hero' ? 'top' : s.kind === 'offer' ? 'offer' : s.kind === 'contact' ? 'visit' : s.kind, title, intro, factIds, imageIds, ...(variant !== s.variant ? { note: `${s.variant} needs content this business lacks; ${variant} instead` } : {}) });
  }
  const notes: string[] = [];
  // a page-level action (header, hero, contact card) never picks one location the owner has not chosen: "Directions" goes
  // to the business's own address when it has one, else to the page's list of locations
  const act = (slot: 'primary' | 'secondary', actionId: string | null): ConceptAction[] => {
    const a = cat.actions.find((x) => x.id === actionId);
    if (!a) return [];
    if (a.kind === 'directions') {
      const main = cat.address ? cat.actions.find((x) => x.id === `dir-${cat.address!.id}`) : undefined;
      const to = main ?? cat.chooser;
      const where = cat.locations.find((l) => l.id === a.factId)?.street ?? a.factId;
      if (!to) return [];
      if (to.id !== a.id) notes.push(`the plan's ${slot} action was directions to ${where}; ${main ? 'it goes to the business\'s own address instead' : 'no main location is chosen, so it opens the list of locations ("Find a location") instead'}`);
      return [{ slot, actionId: to.id, label: main ? a.label : to.label, href: to.href, factId: main ? main.factId : 'locations' }];
    }
    return [{ slot, actionId: a.id, label: a.label, href: a.href, factId: a.factId }];
  };
  let actions = [...act('primary', plan.primaryAction), ...act('secondary', plan.secondaryAction === plan.primaryAction ? null : plan.secondaryAction)];
  if (!actions.some((a) => a.slot === 'primary')) { const first = cat.actions.find((a) => !actions.some((x) => x.actionId === a.id) && a.kind !== 'directions'); actions = [...act('primary', first?.id ?? null), ...actions.filter((a) => a.slot === 'secondary')]; }
  const images = [...new Set(sections.flatMap((s) => s.imageIds).concat(cat.services.filter((s) => s.imageId && sections.some((x) => x.kind === 'offer' && x.factIds.includes(s.id))).map((s) => s.imageId!)))].filter((x) => photo.has(x));
  return {
    id, name: plan.name, thesis: plan.thesis, evidence: plan.evidence.filter((x) => x in cat.facts || cat.services.some((s) => s.id === x) || cat.items.some((i) => i.id === x) || photo.has(x) || cat.actions.some((a) => a.id === x)), axes, planSource: source,
    tokens: tokensFor(brief, axes, { useBrandFont }), sections, copy, actions: actions.filter((a, i) => actions.findIndex((x) => x.actionId === a.actionId) === i), images,
    ...(notes.length ? { notes } : {}),
    omitted: [...cat.omitted, ...plan.sections.filter((s) => !has[s.kind]).map((s) => ({ what: `the ${s.kind} section`, reason: 'the business has nothing for it yet' }))],
    checks: [],
  };
}
