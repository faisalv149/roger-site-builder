// What kind of face a font is: used by the renderer (a readable minimum for decorative faces) and by the design
// director (a hand-drawn look that is a verified font). No imports, so either can use it without a cycle.
/** script, handwriting, marker and brush faces, by name (Google's handwriting faces and the usual naming) */
const DECORATIVE = /\b(hand|script|brush|marker|signature|chalk|scribble|scrawl|cursive|calligraph\w*|pen|ink|amatic|caveat|pacifico|lobster|satisfy|sacramento|kalam|gloria|courgette|cookie|yellowtail|kaushan|allura|parisienne|great vibes|dancing|shadows into light|indie flower|permanent marker|rock salt|homemade apple|reenie beanie|nothing you could do|covered by your grace|architects daughter|gochi|neucha|schoolbell|coming soon|patrick|mynerve|grape nuts)\b/i;
export function decorativeFont(family: string | null | undefined): boolean { return !!family && DECORATIVE.test(family); }
