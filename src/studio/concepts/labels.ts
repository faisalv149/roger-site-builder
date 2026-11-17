// Lines of a website that are labels, not content: used by the renderer (what may stand alone on a page) and by the
// planner's selection (what is worth offering). No imports, so either can use it without a cycle.
/** a line that attributes a review ("Five star review by Jef R.:", "Review by - Yelp"): never a review without its text */
export const REVIEW_ATTRIBUTION = /\b(review|reviewed|testimonial)s?\b[^.!?]*\bby\b|^(\d|one|two|three|four|five)[- ]?star\b.*\breview|^reviews? (by|from|on)\b/i;
/** a website's label for content held elsewhere (a widget, a form, another page): nothing on its own */
export const LABEL_ONLY = /^(contact( us)?|get in touch|find us( on)?|follow us( on)?|connect( with us)?|social( media)?|newsletter|sign up|subscribe|events?|we are updating our events|please stay tuned|(opening |business |store |our )?hours|location(s)?|visit( us)?|address|directions|map|(our )?reviews?|testimonials?|gallery|photos|faq|(our )?menu|about( us)?|order online|delivery options|read more|learn more|click here)\s*(\.\.\.|…|:)?$/i;
