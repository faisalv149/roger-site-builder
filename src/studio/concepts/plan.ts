import type { BusinessBrief } from '../schema.js';
import { checkCopy, checkStory } from './copy.js';
import type { Catalog, Photo } from './review.js';
import { brandHeadingFont, tokensFor } from './tokens.js';
import { COLOR_STRATEGIES, DENSITIES, IMAGERY, SECTION_KINDS, STRUCTURES, TYPE_VOICES, VARIANTS, type ComposedSection, type Concept, type ConceptAction, type CopyBlock, type DirectionPlan, type SectionKind } from './types.js';
import { available, DISTINCT_DIMENSIONS, LEAD, maxDirections, menuArt, planDifferences, planDims, rankDirections } from './directions.js';
export { available } from './directions.js';

/**
 * Up to maxDirections() directions for a business, ranked: Claude proposes them (one request, validated, retried at most
 * twice), or, when Claude is off or over budget, the direction library (directions.ts) ranks its recipes for the
 * business. Either way the same rules decide what is distinct (no shared hero, offer layout or page order, and enough
 * other differences that colour or type alone never make a direction), and every fact, picture and action is chosen by
 * id from the catalog. A business that can't support many directions gets fewer, never padding.
 */

export const PROMPT_VERSION = 'concepts-plan-2';

const LIBRARY = `Section library (kind: variant — what it does). Each hero brings its own site header and footer, used on every page:
hero: full-bleed — one landscape photograph fills the screen, headline over it, bottom-left (header over the photo) · split — text on a plain panel beside one framed photograph (a plain header bar) · type-collage — oversized headline on the brand colour with a collage of three tilted photos and a running list of the menu or services (a centred brand-colour header) · masthead — a newspaper front page: the business's name as a full-width masthead between rules, a dateline (what it is, where, when it opens), then the lead photograph beside the opening paragraph (a masthead header and a colophon footer) · desk — a front desk: the headline beside a panel of when to come, where, how to reach it and the main action, with at most one photo (a utility header with the hours and phone above the menu, and a footer of actions).
offer (services or menu): cards — a grid of cards (photos for services, prices for menu items) · board — an index or menu board: numbered services, or the whole menu by section with dotted leaders to prices · rows — alternating photo-and-text rows, one per service or menu section · ledger — a ruled table of contents: each service or dish on its own ruled line with its description and price, grouped under section rules · tiles — compact tiles with a jump row of chips to each group, for quick scanning on a phone.
proof: rating-band — a dark band with the Google rating as a huge number and the business's own claims · pledges — the business's own claims and offers as bold cards · stat-strip — three or four big numbers (rating, review count, locations or towns, number of services or dishes).
gallery: mosaic — a 4-column grid with one large tile · filmstrip — a horizontal scrolling strip of tall photos · feature-grid — one large photo with smaller ones.
story: columns — a pull quote from the story and the rest in two columns · portrait — a portrait photo beside the story.
contact: panel — contact details beside a dark action card · locations — a card per location with directions · band — a dark band with the phone number large, then hours and address · timetable — the week's opening hours as a large timetable beside the address, phone and actions.`;

const RULES = `Rules:
1. Up to ${'{N}'} directions, strongest first, that differ in page composition, hero treatment, content hierarchy and imagery: each uses a different hero variant, a different offer variant and a different structure, and any two differ in at least ${DISTINCT_DIMENSIONS} of: hero, offer, proof, gallery and contact variants, structure, typeVoice, colorStrategy, density, imageryRole. Not colour swaps, not the same sections reordered. Propose fewer when this business's content or photos can't carry more: a direction it can't fill is worse than none.
2. Each direction's section order expresses its structure: offer-first puts the offer second; story-first the story; proof-first the proof; visit-first the contact; gallery-first the gallery. Hero always first. Use each kind at most once; include contact. Leave out kinds the business has nothing for (no story → no story section; fewer than 4 photos → no gallery; no rating and no claims → no proof).
3. Ground every choice: the thesis says why this direction suits THIS business, citing its facts; evidence lists the fact ids it leans on.
4. Copy (eyebrow, headline, subline, titles, intros, storyText) frames the facts and adds none: no numbers, names, places, prices, years, awards or claims that are not in the facts below; use the business's own words for claims ("free", "family owned" only if the facts say so). Sentence case only (capitalise the first word and proper names, nothing else). Headline at most 9 words; subline at most 30; titles at most 6 words; intros at most 30 words; storyText at most 110 words, a faithful shortening of the story in its own facts, or "" when there is no story section.
5. Choose pictures by id from the photo list: full-bleed needs a landscape photo with use "hero"; split takes any photo at least 900px wide; type-collage takes three; masthead takes one landscape or square photo at least 900px wide; desk takes one photo or none. Do not use the same hero photo in two directions. galleryImageIds: 5 to 8 photos not used in that direction's hero. storyImageId: a portrait photo for story:portrait, else "".
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
  const max = maxDirections();
  return {
    system: `You are the lead designer at Roger, which makes websites for small local businesses. From one business's verified facts you propose up to ${max} genuinely different site directions, built only from Roger's section library, each one specific to this business rather than a template, strongest first. You never add facts.\n\n${LIBRARY}\n\n${RULES.replace('{N}', String(max))}`,
    prompt: `${lines.join('\n\n')}\n\nPropose up to ${max} directions, strongest first; fewer if the business can't support more.`,
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

// ───────────────────────── what each hero needs ─────────────────────────
const heroOk = (variant: string, p: Photo | undefined) => (variant === 'desk' || ((variant === 'masthead' || variant === 'split') && !p) ? true : !!p && (variant === 'full-bleed' ? p.orientation === 'landscape' && p.uses.includes('hero') : variant === 'split' ? p.width >= 900 : variant === 'masthead' ? p.width >= 900 && p.orientation !== 'portrait' : true));
const heroNeeds: Record<string, string> = { 'type-collage': 'three photo ids', 'full-bleed': 'a landscape photo with use "hero"', split: 'a photo at least 900px wide', masthead: 'a landscape or square photo at least 900px wide' };

/** Every rule a set of plans must meet. The same rules check Claude's plans and the fallback's. */
export function validatePlans(plans: DirectionPlan[], cat: Catalog, opts: { copy?: boolean } = {}): string[] {
  const errs: string[] = [];
  const max = maxDirections();
  if (plans.length < 1 || plans.length > max) return [`there must be between 1 and ${max} directions, not ${plans.length}`];
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
    if (kinds[1] !== LEAD[p.axes.structure]) errs.push(`${at}: structure ${p.axes.structure} needs the ${LEAD[p.axes.structure]} section second, after the hero`);
    const hero = p.sections[0]?.variant;
    const heroImgs = p.hero.imageIds.filter((id) => photo.has(id));
    if (hero === 'type-collage' ? heroImgs.length > 0 && heroImgs.length < Math.min(3, cat.photos.length) : !heroOk(hero, photo.get(heroImgs[0]))) errs.push(`${at}: the ${hero} hero needs ${heroNeeds[hero] ?? 'a photo'} from the list`);
    for (const id of [...p.hero.imageIds, ...p.galleryImageIds, ...(p.storyImageId ? [p.storyImageId] : [])]) if (!photo.has(id)) errs.push(`${at}: "${id}" is not a photo id`);
    for (const id of p.featureIds) if (!facts.has(id)) errs.push(`${at}: "${id}" is not a service or menu item id`);
    // evidence only supports the thesis (for the reviewer, not the page): an id that is not in the catalog is dropped when composing, not an error
    for (const id of [p.primaryAction, p.secondaryAction]) if (id && !actions.has(id)) errs.push(`${at}: "${id}" is not an action id`);
    if (kinds.includes('gallery') && p.galleryImageIds.filter((id) => photo.has(id) && !p.hero.imageIds.includes(id)).length < 4) errs.push(`${at}: the gallery needs at least 4 photos not used in its hero`);
    const copy: [string, string][] = [['hero.eyebrow', p.hero.eyebrow], ['hero.headline', p.hero.headline], ['hero.subline', p.hero.subline], ...p.titles.flatMap((t): [string, string][] => [[`${t.kind}.title`, t.title], [`${t.kind}.intro`, t.intro]])];
    if (opts.copy !== false) for (const [slot, text] of copy) if (text) errs.push(...checkCopy(text, slot, cat).map((e) => `${at}: ${e}`));
    if (opts.copy !== false && kinds.includes('story') && p.storyText) errs.push(...checkStory(p.storyText, cat).map((e) => `${at}: ${e}`));
  });
  // distinct: no shared hero, offer layout or page order, no shared hero photo; a type voice each while the voices
  // last; and every pair far enough apart that colour or type alone never make a second direction
  const distinct = (label: string, get: (p: DirectionPlan) => string | undefined) => { const v = plans.map(get).filter(Boolean); if (new Set(v).size !== v.length) errs.push(`two directions share the same ${label} (${v.join(', ')}): each must differ`); };
  distinct('hero variant', (p) => p.sections[0]?.variant);
  distinct('offer variant', (p) => p.sections.find((s) => s.kind === 'offer')?.variant);
  distinct('structure', (p) => p.axes.structure);
  if (plans.length <= TYPE_VOICES.length) distinct('typeVoice', (p) => p.axes.typeVoice);
  distinct('hero photo', (p) => (p.sections[0]?.variant === 'type-collage' || !p.hero.imageIds[0] ? undefined : p.hero.imageIds[0]));
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
    const d = planDifferences(plans[i], plans[j]);
    if (d.length < DISTINCT_DIMENSIONS) errs.push(`"${plans[i].name}" and "${plans[j].name}" differ only in ${d.join(', ') || 'nothing'} (${d.length} of ${Object.keys(planDims(plans[i])).length}; at least ${DISTINCT_DIMENSIONS} needed): a near-duplicate`);
  }
  return [...new Set(errs)];
}

// ───────────────────────── the fallback planner ─────────────────────────
/** The library's directions this business supports, ranked, weak ones and near-duplicates left out (directions.ts). */
export function fallbackPlans(cat: Catalog, brief: BusinessBrief): DirectionPlan[] {
  return rankDirections(cat, brief).plans;
}

// ───────────────────────── composing a concept from a plan ─────────────────────────
const DEFAULT_TITLES: Record<SectionKind, (cat: Catalog) => string> = {
  hero: () => '', offer: (c) => (c.items.length ? 'The menu' : 'Services'), proof: (c) => (c.rating ? 'Rated on Google' : 'Our word'), gallery: () => 'A closer look',
  story: (c) => c.story?.heading.replace(/^about\s+.*$/i, 'Our story') || 'Our story', contact: (c) => (c.locations.length > 1 ? 'Locations' : c.address || c.locations.length ? 'Visit' : 'Contact'),
};
const excerpt = (t: string, max = 900) => { const s = t.replace(/\s+\n/g, '\n').trim().match(/(?:[^.!?]|[.!?](?=\S))+[.!?]+(?=\s|$)/g) ?? [t]; let out = ''; for (const x of s) { if ((out + x).length > max && out) break; out += x; } return out.trim(); };

export function compose(plan: DirectionPlan, id: string, source: 'ai' | 'fallback', cat: Catalog, brief: BusinessBrief, useBrandFont: boolean): Concept {
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
      // offer sections show only pictures tied to what they show (a service's own, or the owner's choice); a menu shows
      // the business's own menu art, which never leads the page
      imageIds = cat.items.length ? cat.photos.filter((p) => menuArt(p, cat)).map((p) => p.id).slice(0, 2) : [];
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
      // a timetable needs a timetable: without opening hours it is the contact panel
      if (variant === 'timetable' && !cat.hours) variant = 'panel';
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
  if (!actions.some((a) => a.slot === 'primary')) { const first = cat.actions.find((a) => !actions.some((x) => x.actionId === a.id) && a.kind !== 'directions' && !a.seasonal); actions = [...act('primary', first?.id ?? null), ...actions.filter((a) => a.slot === 'secondary')]; }
  const images = [...new Set(sections.flatMap((s) => s.imageIds).concat(cat.services.filter((s) => s.imageId && sections.some((x) => x.kind === 'offer' && x.factIds.includes(s.id))).map((s) => s.imageId!)))].filter((x) => photo.has(x));
  return {
    id, name: plan.name, ...(plan.recipe ? { recipe: plan.recipe } : {}), thesis: plan.thesis, evidence: plan.evidence.filter((x) => x in cat.facts || cat.services.some((s) => s.id === x) || cat.items.some((i) => i.id === x) || photo.has(x) || cat.actions.some((a) => a.id === x)), axes, planSource: source,
    tokens: tokensFor(brief, axes, { useBrandFont }), sections, copy, actions: actions.filter((a, i) => actions.findIndex((x) => x.actionId === a.actionId) === i), images,
    ...(notes.length ? { notes } : {}),
    omitted: [...cat.omitted, ...plan.sections.filter((s) => !has[s.kind]).map((s) => ({ what: `the ${s.kind} section`, reason: 'the business has nothing for it yet' }))],
    checks: [],
  };
}
