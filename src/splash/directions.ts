/**
 * Visual directions for splash pages. Without one, every page answered the same design brief and came out with the
 * same composition (words left, photo right, pill buttons, a rule before the eyebrow). Roger now gives each page one
 * direction, varied across recent pages, and the designer follows it. Facts, bindings, actions and checks are unchanged.
 */
export interface Direction {
  id: string;
  name: string;
  /** hero layouts this direction is built around, best first (the first one the photos can carry is used) */
  heroes: string[];
  brief: string;
}

export const DIRECTIONS: Direction[] = [
  {
    id: 'editorial', name: 'Editorial magazine', heroes: ['split', 'type'],
    brief: 'A printed magazine feature. Light paper-coloured ground, a high-contrast serif display face with a quiet sans for text. Hero: the photo on the LEFT, tall, the words on the right, set like a headline and standfirst. Hairline rules between screens instead of coloured bands, a narrow text column, captions under photos in small italic. Buttons are rectangular with sharp corners (radius sharp), the main one solid ink-coloured, the other a plain underlined link. Header: the name centred over the links. No shadows on photos; depth comes from scale and white space.',
  },
  {
    id: 'poster', name: 'Bold poster', heroes: ['type', 'split'],
    brief: 'A screen-printed poster. The hero is the brand colour as a full-bleed ground with the headline enormous (as wide as the screen allows), set in a heavy condensed or grotesque display face, one photo laid in or beside it. Screens alternate solid brand-colour and accent-colour bands with hard edges; no gradients, no soft shadows (if any shadow, a hard offset one). Buttons are chunky blocks with thick borders. Cards have thick outlines instead of shadows. Header: a solid bar in the text colour with the name left.',
  },
  {
    id: 'cinematic', name: 'Cinematic dark', heroes: ['full', 'split'],
    brief: 'A film still. Mood dark: near-black ground, light text, photos glowing. Hero: a full-bleed photo with the words CENTRED over it, a thin elegant display face, generous letter spacing on the eyebrow. Later screens use large full-width photos with text over a dark scrim, and slim centred section headings. Buttons are glass or outline with a soft glow on hover. Header transparent over the hero, name centred.',
  },
  {
    id: 'gallery', name: 'Gallery wall', heroes: ['collage', 'split'],
    brief: 'A bright gallery wall. Pure white or very light ground, a clean geometric sans for both display and text (different weights). Hero: the photos arranged as a loose mosaic that takes most of the width, the words in a compact block above or below them (not beside). Work and offer screens are photo grids with small captions; very little colour except the brand colour on the main button. Buttons are fully rounded pills, small and precise. Header: name left, links right, no background.',
  },
  {
    id: 'craft', name: 'Warm handmade', heroes: ['marquee', 'split', 'collage'],
    brief: 'Handmade and friendly. A warm tinted ground (not cream with terracotta), a rounded or soft display face with personality, round radius everywhere. Hero: words beside one photo in a rounded frame that is slightly rotated, with a band of the business\'s own words running beneath. Cards are soft and slightly tilted, sections sit on alternating tints with wavy or rounded edges done in CSS. Buttons are soft rounded rectangles with a gentle lift. Header: a floating rounded bar.',
  },
  {
    id: 'swiss', name: 'Swiss grid', heroes: ['split', 'type', 'full'],
    brief: 'International Typographic Style. A strict visible grid, a neo-grotesque sans for everything, everything left aligned, sizes in clear steps. Hero: a large photo on the RIGHT spanning to the screen edge, the words on a white ground at left with lots of air; a thin rule and a small label above the headline instead of an eyebrow dash. Sections separated by full-width 1px rules, content in columns, the brand colour used for one element per screen only. Buttons are sharp rectangles; secondary actions are text links with arrows drawn by the arrow hover. Header: a thin bar with a bottom rule.',
  },
  {
    id: 'stacked', name: 'Calm stacked', heroes: ['type', 'full'],
    brief: 'Quiet and centred. The hero stacks vertically and is CENTRED: a short eyebrow, a medium-large serif or humanist headline (about 3.5 to 4.5rem on desktop), the subline, the actions in a row, then a wide photo with soft rounded corners below them. Lots of vertical space, soft tinted grounds that change gently from screen to screen, centred section headings, light cards with a single soft shadow. Buttons are soft rounded rectangles. Header: centred name with links underneath on desktop.',
  },
  {
    id: 'block', name: 'Colour blocks', heroes: ['split', 'collage', 'type'],
    brief: 'Bold colour blocking. The page is made of big rectangles of the brand colour, the accent and white that meet edge to edge. Hero: split into two halves, one solid brand colour holding the words, the other the photo filling its half edge to edge (no frame radius). Each later screen is its own block of colour; cards are flat blocks with no shadow. A sturdy sans display face, heavy weight. Buttons are flat solid rectangles that invert colour on hover. Header: name in a small solid block at top left.',
  },
];

/**
 * One direction for a new page: one the photos can carry, not used by the business's earlier pages or the most recent
 * pages made (so consecutive pages differ), chosen at random among the rest.
 */
export function pickDirection(layouts: string[], recent: string[], earlier: string[], rand = Math.random): Direction {
  const fits = DIRECTIONS.filter((d) => d.heroes.some((h) => layouts.includes(h)));
  const pool = fits.filter((d) => !earlier.includes(d.id) && !recent.includes(d.id));
  const fresh = pool.length ? pool : fits.filter((d) => !earlier.includes(d.id));
  const from = fresh.length ? fresh : fits.length ? fits : DIRECTIONS;
  return from[Math.floor(rand() * from.length)];
}

/** the direction as the designer is told it, with the hero layout it should use */
export function directionText(d: Direction, layouts: string[]): string {
  const hero = d.heroes.find((h) => layouts.includes(h)) ?? layouts[0];
  return `${d.name}. ${d.brief} Use data-rk-hero="${hero}" for the hero, composed as described here. Whatever the direction, the headline, subline, actions and today's hours must all be visible on the first screen at 1440 x 900 and at 390 x 844 (size the headline to fit; never more than about 6rem), and no photo may cover any text.`;
}
