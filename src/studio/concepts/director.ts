/**
 * The design director: before the open planner writes a DesignSpec, Claude states who the page is for, the page's
 * main job, and one visual idea grounded in the business's brand and real content; critiques that idea for generic
 * AI-design patterns; and revises it once if any apply. The final idea goes into the DesignSpec request.
 *
 * Adapted from the "frontend-design" skill by Anthropic (https://github.com/anthropics/skills, skills/frontend-design,
 * commit 41bbe19, 2026-09-03), licensed under the Apache License 2.0; a copy is in
 * licenses/anthropic-skills-frontend-design.LICENSE.txt.
 * Modified by Roger: condensed into a short guide for a small business's homepage; its process (subject → audience →
 * primary job → a plan → review it against the generic defaults → revise) is kept, its catalogue of generic traits is
 * restated in terms of the DesignSpec's primitives; its advice on code, motion and inventing copy is left out, because
 * here every visible word, service, action and photo comes only from the verified brief, and brand colours, fonts and
 * logo are preserved. No themes or category layouts are added.
 *
 * Versioned: DIRECTOR_VERSION is saved with every design made with it. The guide is sent only with the direction
 * request (once per design), not with the DesignSpec request.
 */
import type { BusinessBrief } from '../schema.js';
import type { Catalog } from './review.js';
import type { DesignStrategy } from './references.js';
// functions only, used at call time: the two modules import each other safely
import { brandColors, brandFonts, brandLine, NEUTRALS, PROPOSAL_FONTS, resolveColor, SPEC_SCHEMA, verifiedPlaces } from './designspec.js';
import { contractOf } from './schema-compat.js';
import { decorativeFont } from './font-kind.js';
import type { PlannerSelection } from './manifest-input.js';

export const DIRECTOR_VERSION = 'director-1';
/** QA only: STUDIO_DESIGN_DIRECTOR=0 composes without a direction (to compare); on everywhere else */
export const directorOn = () => process.env.STUDIO_DESIGN_DIRECTOR !== '0';

export const DIRECTOR_GUIDE = `You are the design lead at a studio known for giving every client a visual identity that is not mistaken for anyone else's. This client is a real small business; it has rejected proposals that felt templated. Make deliberate choices specific to this business, and take an aesthetic risk where its brand and content justify one.

Before any layout, decide three things:
1. Audience: who arrives on this homepage, and what they are trying to decide.
2. Main job: the one thing the page must get done for them, ideally one of the business's supported actions.
3. The most characteristic thing in this business's world, taken from its own words, services, story and verified photos (cite them). Distinctive visual choices come from the subject's materials, vernacular and voice, never from a category template.

Then one visual idea, as a compact plan using only what the renderer can build (listed below); a treatment it cannot build is not a plan:
- Palette: the brand's own colours (kept as they are), neutrals and tints of brand colours, assigned to ground, surface, ink and accent.
- Type: the brand's own fonts and their roles, a deliberate scale and weight; use the type itself as part of the design, not a neutral vehicle. Lines under about 80 characters.
- Hero: what opens the page. Open with the most characteristic real thing (a line of the business's own, a photo, its services), in the form that suits it, and keep it balanced: the text and what sits beside it share the space.
- Sections: how they differ in arrangement, item style and background, so the page reads as a sequence of decisions, not a stack of the same block. Fewer, fuller sections beat many thin ones.
- One bold element: spend boldness in one place and keep everything around it quiet. Before finishing, remove one accessory.
- Alignment: left, centred, or mixed, and why.

Critique the idea before committing to it. Generated design clusters around these defaults; each is legitimate for some briefs, but here it is a fault when it is chosen by habit rather than by this business's brand or content:
- a warm cream ground with a high-contrast serif display and a terracotta or clay accent;
- a near-black ground with one bright acid-green or vermilion accent;
- a broadsheet look: hairline rules, zero radius, dense newspaper columns;
- the card kit: content chopped into identical cards with one radius on everything;
- template chrome: a small all-caps label above every heading, labels that add nothing, numbered markers (01, 02, 03) on content that is not a sequence;
- accenting one word of a headline;
- a hero formula reached for by habit: a big centred headline, a subline and two buttons over a darkened photo;
- every section in the same arrangement and density.
Name each match and where it is in the idea. Mark it "keep" only where the brand's own colours or words make it right, and say why; otherwise mark it "revise", revise that part once, and say what you changed.

Limits that no design choice may cross:
- Design guidance never adds content. Visible words come only from the business's own lines, services and story, or a short plain label. No invented services, claims, prices, numbers, ratings, actions or photos.
- Actions only from the supported list; photos only from the verified list.
- Keep the verified logo and the brand colours; use only the brand's fonts.
- No themes, presets or layouts borrowed from a business category: compose from this business's content.
- Words exist to make the page easier to use: plain, specific, sentence case.`;

const str = (max: number) => ({ type: 'string', maxLength: max });
const en = (...v: string[]) => ({ type: 'string', enum: v });
const NULLABLE = (s: object) => ({ anyOf: [s, { type: 'null' }] });
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

/** the renderer's own options, read from the DesignSpec schema (at call time: the two modules import each other) */
function specOptions() {
  const P = (SPEC_SCHEMA as { properties: Record<string, { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }>; items?: { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> } }> }> }).properties;
  const sec = P.sections as unknown as { items: { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> } };
  return {
    aside: P.hero.properties.aside.properties!.kind.enum!,
    header: P.header.properties.style.enum!,
    arrangement: sec.items.properties.layout.properties!.arrangement.enum!,
    itemStyle: sec.items.properties.layout.properties!.itemStyle.enum!,
    density: sec.items.properties.layout.properties!.density.enum!,
    background: sec.items.properties.background.enum!,
    media: sec.items.properties.media.properties!.placement.enum!,
    kind: sec.items.properties.kind.enum!,
  };
}

/** what Roger's renderer can build, in a few lines: the director plans only with these */
export function capabilities(): string {
  const o = specOptions();
  return [
    'What Roger\'s renderer can build (plan only with these):',
    `- Page: a 12-column grid; sections stacked top to bottom; a header (${o.header.join(' | ')}, may stick) with the verified logo or the name as a wordmark.`,
    `- Hero: the text in a column range on the left, right or centre; beside it an aside: ${o.aside.join(' | ')} ("image" is one verified photo); or one verified photo behind the whole hero under a dark scrim. Height 40-100% of the screen.`,
    `- Sections (${o.kind.join(' | ')}): ${o.arrangement.join(' | ')} (heading columns beside content columns); items ${o.itemStyle.join(' | ')} in 1-4 columns, each may have one photo; section photos ${o.media.join(' | ')} ("band" runs edge to edge); density ${o.density.join(' | ')}.`,
    `- Colour: each section's background is one role: ${o.background.join(' | ')}; the palette is brand colours, neutrals and tints.`,
    '- Type: one heading font and one body font from the brand; base size, scale, weight, case (none | uppercase), tracking. Decorative fonts are set no smaller than a readable minimum.',
    '- Phone (390px): hero text or photo first, a menu button or inline links, one sticky action; columns collapse to 1-2.',
    'Not available: overlapping or layered elements, tilted or rotated items, stickers or collage, free positioning, gradients, textures, motion, illustrations, custom shapes, text over any photo other than the hero\'s background photo.',
  ].join('\n');
}

/**
 * The direction's schema for one brief. Fonts, the main job's action and every layout choice are exact options (enums)
 * from the brief and the renderer, so the plan can only name what can be built; the little prose left is short.
 */
/** `menuIds`: the menu items the planner may ask details for (from the site manifest); none without a manifest */
export function directionSchema(fonts: string[], actions: string[], menuIds: string[] = []) {
  const o = specOptions();
  const font = en(...(fonts.length ? fonts : PROPOSAL_FONTS));
  const IDEA = obj({
    summary: str(160),
    palette: obj({ ground: str(30), surface: str(30), ink: str(30), accent: str(30) }),
    type: obj({ heading: font, body: font, treatment: str(120) }),
    hero: obj({ textSide: en('left', 'right', 'centre'), aside: en(...o.aside), photoBehindText: { type: 'boolean' }, note: str(120) }),
    sections: { type: 'array', minItems: 1, maxItems: 8, items: obj({ content: str(60), arrangement: en(...o.arrangement), itemStyle: en(...o.itemStyle), background: en(...o.background), media: en(...o.media) }) },
    boldElement: str(120),
    alignment: en('left', 'center', 'mixed'),
  });
  return obj({
    audience: str(160),
    mainJob: obj({ text: str(120), action: actions.length ? { anyOf: [en(...actions), { type: 'null' }] } : { type: 'null' } }),
    characteristic: obj({ text: str(160), evidence: { type: 'array', minItems: 1, maxItems: 6, items: obj({ kind: en('ownLine', 'service', 'story', 'photo', 'action', 'rating'), id: str(60) }) } }),
    idea: IDEA,
    critique: { type: 'array', maxItems: 6, items: obj({ trait: str(80), where: str(80), verdict: en('revise', 'keep'), why: str(160) }) },
    revised: NULLABLE(IDEA),
    changes: NULLABLE(str(200)),
    // menu details on request (only when the site manifest has a menu): up to 8 item ids whose descriptions, prices or
    // sizes the design needs
    ...(menuIds.length ? { menuNeeded: { type: 'array', maxItems: 8, items: en(...menuIds) } } : {}),
  });
}

export interface DirectionIdea {
  summary: string; palette: { ground: string; surface: string; ink: string; accent: string };
  /** heading and body: brand font names exactly; treatment: how they are set (size, weight, case, spacing) */
  type: { heading: string; body: string; treatment: string };
  /** the hero in the renderer's terms: where the text sits, what is beside it, a photo behind it or not */
  hero: { textSide: 'left' | 'right' | 'centre'; aside: string; photoBehindText: boolean; note: string };
  /** the page, section by section, in the renderer's terms */
  sections: { content: string; arrangement: string; itemStyle: string; background: string; media: string }[];
  boldElement: string; alignment: 'left' | 'center' | 'mixed';
}
export interface Direction {
  audience: string; mainJob: { text: string; action: string | null };
  characteristic: { text: string; evidence: { kind: 'ownLine' | 'service' | 'story' | 'photo' | 'action' | 'rating'; id: string }[] };
  /** each generic default the idea matches: revised (the revision follows), or kept because the brand or content justifies it (why) */
  idea: DirectionIdea; critique: { trait: string; where: string; verdict: 'revise' | 'keep'; why: string }[]; revised: DirectionIdea | null; changes: string | null;
  /** menu items whose details the design needs (only those are added to the DesignSpec request) */
  menuNeeded?: string[];
}
/** the idea the DesignSpec follows: the revision when the critique found generic defaults, else the first idea */
export const finalIdea = (d: Direction) => d.revised ?? d.idea;

/** invented facts a direction's prose must not carry (it is not shown, but it steers the spec) */
const INVENTED = /[$£€]\s?\d[\d,.]*\d|[$£€]\s?\d|\b\d+(?:\.\d+)?\s?(?:%|percent\b|dollars?\b|usd\b)|\b(award(?:-winning|s)?|certified|guarantee(?:d)?|#1|number one|world-class|premier|trusted by|proven|fastest|cheapest)\b/i;
/** treatments the renderer cannot build: a direction naming one is revised before any spec is asked for */
const UNSUPPORTED = /\b(tilt(?:ed|s|ing)?|rotat\w*|overlap\w*|layered|layering|stickers?|collage|scrapbook|polaroids?|diagonal\w*|angled|skew\w*|parallax|animat\w*|gradients?|textur(?:e|ed|es)|hand[- ]drawn|illustrat\w*|carousel|slider|marquee|torn)\b/gi;
/** what type is called; a hand-drawn look of type is a font's, not a drawing */
const TYPE_WORDS = /\b(?:type|typeface|lettering|lettered|letters|font|script|headings?|headlines?|wordmark|titles?|names?)\b/i;
/** what a renderer would have to draw */
const DRAWN_THINGS = /\b(?:illustrations?|drawings?|doodles?|icons?|sketch\w*|graphics?|art(?:work)?|pictures?|motifs?|patterns?|borders?|frames?|ornaments?|flourishes?|characters?|scenes?)\b/i;
/**
 * The first treatment in `text` the renderer cannot build, or undefined. "Hand-drawn" is allowed when it describes the
 * look of a verified font: the brand has a decorative (hand-lettered, script) font, and the words around it are about
 * type ("hand-drawn type", "headings in Just Another Hand, hand-drawn"), not about something to draw ("hand-drawn
 * illustrations", "hand-drawn icons"), which stays refused.
 */
export function unsupportedIn(text: string, brandFonts: string[]): string | undefined {
  for (const m of text.matchAll(UNSUPPORTED)) {
    if (/^hand[- ]drawn$/i.test(m[0])) {
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
      const around = text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40);
      const aboutType = TYPE_WORDS.test(after) || brandFonts.some((f) => text.toLowerCase().includes(f.toLowerCase()) && around.toLowerCase().includes(f.toLowerCase().split(' ')[0]));
      if (brandFonts.some(decorativeFont) && aboutType && !DRAWN_THINGS.test(after)) continue;
    }
    return m[0];
  }
  return undefined;
}

/** what is wrong with a direction, checked against the brief it was made for; empty when it is sound */
export function validateDirection(d: Direction, cat: Catalog, brief: BusinessBrief): string[] {
  const errs: string[] = [];
  if (!d || typeof d !== 'object') return ['no direction'];
  const brand = brandColors(brief);
  const fonts = brandFonts(brief);
  const actions = new Set(cat.actions.map((a) => a.id));
  const photos = new Set(cat.photos.map((p) => p.id));
  if (d.mainJob?.action && !actions.has(d.mainJob.action)) errs.push(`mainJob.action: "${d.mainJob.action}" is not a supported action (${[...actions].join(', ') || 'none'})`);
  for (const [i, e] of (d.characteristic?.evidence ?? []).entries()) {
    const at = `characteristic.evidence[${i}]`;
    const ok = e.kind === 'ownLine' ? /^\d+$/.test(e.id) && +e.id < cat.ownLines.length
      : e.kind === 'service' ? cat.services.some((s) => s.id === e.id)
      : e.kind === 'story' ? !!cat.story
      : e.kind === 'photo' ? photos.has(e.id)
      : e.kind === 'action' ? actions.has(e.id)
      : e.kind === 'rating' ? !!cat.rating : false;
    if (!ok) errs.push(`${at}: ${e.kind} "${e.id}" is not in the brief`);
  }
  const idea = (x: DirectionIdea, where: string) => {
    for (const [k, v] of Object.entries(x.palette ?? {})) if (!resolveColor(String(v), brand)) errs.push(`${where}.palette.${k}: "${v}" is not a brand colour (${brand.join(', ') || 'none'}), a neutral (${Object.keys(NEUTRALS).join(', ')}) or a brand tint`);
    if (brand.length && !Object.values(x.palette ?? {}).some((v) => brand.some((b) => String(v).toUpperCase().includes(b)))) errs.push(`${where}.palette: the brand colours are not used`);
    for (const k of ['heading', 'body'] as const) if (x.type?.[k] && !(fonts.length ? fonts : PROPOSAL_FONTS).includes(x.type[k])) errs.push(fonts.length ? `${where}.type.${k}: "${x.type[k]}" is not one of the brand's fonts (${fonts.join(', ')})` : `${where}.type.${k}: "${x.type[k]}" is not one of the fonts that may be proposed (${PROPOSAL_FONTS.join(', ')})`);
    const prose: [string, string][] = [['summary', x.summary], ['type.treatment', x.type?.treatment], ['hero.note', x.hero?.note], ['boldElement', x.boldElement], ...(x.sections ?? []).map((s, i) => [`sections[${i}].content`, s.content] as [string, string])];
    for (const [k, v] of prose) {
      const inv = String(v ?? '').match(INVENTED); if (inv) errs.push(`${where}.${k}: "${inv[0]}" states a price, figure or claim the brief does not give; design guidance adds no content`);
      const un = unsupportedIn(String(v ?? ''), fonts); if (un) errs.push(`${where}.${k}: "${un}" is not something the renderer can build; revise it to one of the listed capabilities`);
    }
    // a photo in the plan needs a verified photo to show
    if (!photos.size && (x.hero?.aside === 'image' || x.hero?.photoBehindText || (x.sections ?? []).some((s) => s.media !== 'none'))) errs.push(`${where}: the plan places photos, but the business has no verified photos; plan with type, colour and space`);
    if (x.hero?.photoBehindText && x.hero.aside === 'image') errs.push(`${where}.hero: a photo behind the text and an image beside it compete; choose one`);
  };
  if (d.idea) idea(d.idea, 'idea'); else errs.push('idea is missing');
  if (d.revised) idea(d.revised, 'revised');
  for (const k of ['audience', 'characteristic'] as const) { const m = String(k === 'audience' ? d.audience : d.characteristic?.text).match(INVENTED); if (m) errs.push(`${k}: "${m[0]}" states a price, figure or claim the brief does not give`); }
  // the critique decides the revision: a default marked "revise" must be revised once (and the change said); one kept
  // needs its reason from the brand or content; with nothing to revise, nothing is revised
  const toRevise = (d.critique ?? []).filter((c) => c.verdict === 'revise');
  for (const [i, c] of (d.critique ?? []).entries()) if (c.verdict === 'keep' && !c.why?.trim()) errs.push(`critique[${i}]: a default kept needs its reason from the brand or content`);
  if (toRevise.length && !d.revised) errs.push(`critique: ${toRevise.length} default(s) marked "revise" (${toRevise.map((c) => c.trait).join('; ')}) but "revised" is null; revise the idea once and say what changed`);
  if (d.revised && !d.changes?.trim()) errs.push('changes: say what the revision changed and why');
  if (!toRevise.length && d.revised) errs.push('revised: no default is marked "revise", so there is nothing to revise; set it to null');
  return errs;
}

/** the request for a direction: the guide (system), the renderer's capabilities, the brief's facts, and the contract */
export function directionRequest(cat: Catalog, brief: BusinessBrief, strategy: DesignStrategy | null, previous: string | null, selection?: PlannerSelection | null, menuIds: string[] = []) {
  const schema = directionSchema(brandFonts(brief), cat.actions.map((a) => a.id), selection ? menuIds : []);
  return {
    stage: 'design:direction', schema, maxOutputTokens: 3000,
    system: `${DIRECTOR_GUIDE}\n\n${capabilities()}\n\nAnswer only with the JSON asked for.`,
    prompt: [
      `Business: ${cat.business.name}${cat.business.category ? ` (${cat.business.category})` : ''}. ${cat.business.summary ?? ''}`,
      ...(selection ? [] : [`Its own lines (cite as ownLine with the index): ${JSON.stringify(cat.ownLines.map((t, i) => `${i}: ${t}`))}`]),
      ...(selection ? [`From ${selection.source ?? "the business's website"} (selected; ids are sources; "line" is the ownLine index to cite): ${JSON.stringify(selection)}`] : []),
      `Services (cite by id): ${JSON.stringify(cat.services.map((x) => ({ id: x.id, name: x.name, description: x.description ?? null })))}`,
      `Story: ${cat.story ? JSON.stringify(cat.story) : 'none'}`,
      `Supported actions (cite by id; the only ones allowed): ${JSON.stringify(cat.actions.map((a) => ({ id: a.id, label: a.label, kind: a.kind })))}`,
      ...(selection ? [] : [`Verified photos (cite by id): ${cat.photos.length ? JSON.stringify(cat.photos.map((p) => ({ id: p.id, orientation: p.orientation, shows: p.seen ?? (p.alt || 'unknown') }))) : 'none: the idea must work with type, colour and space alone'}`]),
      `Google rating: ${cat.rating ? `${cat.rating.value} from ${cat.rating.count} reviews (cite as rating)` : 'none'}. Verified location: ${verifiedPlaces(cat).join('; ') || 'none'}.`,
      `${brandLine(brandColors(brief), brandFonts(brief), brief.brand.logo.status === 'verified' && !!cat.logo)} Palette values: ${brandColors(brief).length ? 'a brand hex' : 'a hex you propose'}, a neutral (${Object.keys(NEUTRALS).join(', ')}) or "tint:<hex>:<4-30>".`,
      strategy ? `Reference strategy (measured from other sites; inspiration only): ${JSON.stringify({ summary: strategy.summary, layoutPatterns: strategy.layoutPatterns.map((p) => p.pattern), avoid: strategy.avoid })}` : 'No reference strategy.',
      ...(previous ? [`Versions already shown to the client: ${previous}. This direction must be a different idea, not a variation.`] : []),
      'A promotion with a date or season but no year (a holiday, a pre-order date) is left out of the preview until the owner confirms it: do not build the main job, the hero or a section on it.',
      '',
      'Write the direction: audience, main job, the most characteristic thing (with evidence by id), the idea as a plan in the renderer\'s terms, your critique of it against the generic defaults (each with its verdict; [] if none applies), the revised idea (null when nothing is marked "revise") and what changed. Keep the prose short: say a choice, not its whole rationale.',
      'Contract (every key required; "string ≤N" is at most N characters — the limit is beside each field and is hard; "(≤N)" is the most items):',
      contractOf(schema, {}),
    ].join('\n'),
  };
}

/** what the DesignSpec request is told: the final direction, and the few rules it turns into primitives */
export function directionForSpec(d: Direction): string {
  const idea = finalIdea(d);
  return [
    `Design direction (${DIRECTOR_VERSION}; decided before this spec — follow it; it adds no content, and every fact still comes only from the lists above): ${JSON.stringify({ audience: d.audience, mainJob: d.mainJob, characteristic: d.characteristic.text, idea })}`,
    'State the idea in "thesis". In the DesignSpec\'s terms, unless the direction says why: "numbered" items only for a real sequence; kickers and "uppercase" headings only where the label carries information; "card" items not in every section and not as the only device; vary arrangement, density and background between sections; one bold element, the rest quiet.',
  ].join('\n');
}

/**
 * The direction's planner-only notes: prose that steers the design and is never shown on a site. An over-long one is
 * cut locally (see aiJson). Never a source id (characteristic.evidence), a font, an action or any other exact choice.
 */
const DIRECTION_NOTES = new Set(['audience', 'text', 'summary', 'treatment', 'note', 'boldElement', 'content', 'trait', 'where', 'why', 'changes']);
export const isDirectionNote = (path: (string | number)[]) => typeof path[path.length - 1] === 'string' && DIRECTION_NOTES.has(path[path.length - 1] as string) && !path.includes('evidence');
