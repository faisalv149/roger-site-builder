/**
 * The renderer's geometry: column ranges on the 12-column grid, derived from the design's choices. Claude chooses where
 * the hero text sits and how wide it is, and whether a section is stacked or side by side; it never writes column
 * numbers, so ranges always fit the grid and never overlap.
 */
export type TextSide = 'left' | 'right' | 'centre';
export type TextWidth = 'narrow' | 'mid' | 'wide';

/** the hero's text and aside columns. With an aside, text and aside share the row (one gap column between them). */
export function heroColumns(side: TextSide, width: TextWidth, aside: string): { textStart: number; textSpan: number; asideStart: number; asideSpan: number } {
  if (aside && aside !== 'none') {
    const text = { narrow: 5, mid: 6, wide: 7 }[width];
    const asideSpan = 12 - text - 1;
    // a centred text has nothing beside it: with an aside it sits on the left
    return side === 'right'
      ? { textStart: asideSpan + 2, textSpan: text, asideStart: 1, asideSpan }
      : { textStart: 1, textSpan: text, asideStart: text + 2, asideSpan };
  }
  const span = { narrow: 6, mid: 8, wide: 10 }[width];
  const start = side === 'right' ? 13 - span : side === 'centre' ? Math.floor((12 - span) / 2) + 1 : 1;
  return { textStart: start, textSpan: span, asideStart: 1, asideSpan: 0 };
}

/** a section's heading and content columns: stacked (heading over the full-width content) or side by side */
export function sectionColumns(arrangement: 'stack' | 'side-by-side'): { headingStart: number; headingSpan: number; contentStart: number; contentSpan: number } {
  return arrangement === 'side-by-side'
    ? { headingStart: 1, headingSpan: 4, contentStart: 6, contentSpan: 7 }
    : { headingStart: 1, headingSpan: 8, contentStart: 1, contentSpan: 12 };
}
