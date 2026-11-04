# Design studio, phase 2: interface proposal

Status: **proposal, now implemented**: see `docs/studio-phase2.md` for what was built. Differences: previews leave open facts out rather than showing placeholders; the publishable mode is a separate publication gate, not a request mode.

Phase 2 takes one **reviewed** business brief and produces **three distinct homepage concepts**. Every visible fact in a concept must trace to the brief. This document defines the inputs, outputs, job stages, validators and API, so that the concepts come from the same infrastructure for every business. No concept is styled by hand for any one site.

## 1. Principles

1. **A concept is data, rendered by a shared section library.** It is a plan: sections, bindings to brief facts, design tokens and copy. A generic renderer turns it into HTML. Nothing is written as per-business CSS or markup.
2. **Facts are bound, not written.** A phone number, address, price, hours, service name, claim or picture appears only through a binding to a brief entry. AI may write connective copy, such as headlines and section intros, and a validator checks that copy for new facts.
3. **Distinctness is measured.** The three concepts must differ on defined axes. A check enforces this; "three colour swaps" fails it.
4. **Unresolved stays unresolved.** A disputed or unknown fact, and any held call to action, can never appear in a publishable concept. In a preview it appears only as a marked placeholder.
5. **Reproducible.** The same brief, review, seed and model give the same concept set. AI calls are cached by input hash, as the Phase 1 summary already is.

## 2. Inputs

### 2.1 Pinned brief

```ts
interface BriefRef { businessKey: string; revision: number; briefHash: string }
```

The request names a revision and its hash. If the stored revision's hash differs, the request is rejected with 409, so a concept is never built from a brief the owner did not review.

### 2.2 Owner review

The owner review is a new document (`roger.owner-review`). It holds the owner's answers to the brief's questions.

```ts
interface OwnerReview {
  schema: 'roger.owner-review'; version: 1;
  id: string;                       // sha256 of the content
  brief: BriefRef;
  reviewedBy: string; reviewedAt: string;
  answers: Record<string /* questionId */, {
    choice?: string;                // one of the question's options, e.g. a phone candidate
    text?: string;                  // a free answer, e.g. the business story
    assetIds?: string[];            // uploads or confirmed pictures
  }>;
  approvedAssets: string[];         // website asset ids the owner may publish (rights: owner-approved)
  approvedClaims: string[];         // claim fact paths the owner confirmed
  offeringsConfirmed?: { current: boolean; pricesApproved: boolean };
}
```

### 2.3 Resolved facts

`resolveBrief(brief, review) → ResolvedFacts` is pure and deterministic. It applies the review to the brief:

- Choosing a phone candidate sets `contact.phone`, status `owner-resolved`, with the owner as a source alongside the original sources.
- Choosing a location sets `locations.primaryId`.
- A held call to action whose question is answered is released, or dropped if the owner chose the other value.
- Claims, pictures and prices become publishable only when listed in the review.
- Every fact the review does not settle keeps its Phase 1 status.

Every entry in `ResolvedFacts` carries a `publishable: boolean` and, when false, the reason (`unknown`, `conflicting`, `unconfirmed-rights`, `unconfirmed-claim`, `price-needs-review`, `google-restricted`).

### 2.4 Request

```ts
interface ConceptRequest {
  brief: BriefRef;
  reviewId: string;
  mode: 'preview' | 'publishable';
  count: 3;
  page: 'home';                    // inner pages are a later phase
  seed?: string;                   // default: briefHash + reviewId
  exclude?: DirectionAxes[];       // directions the owner has already rejected
}
```

- **`publishable`** requires every blocking question to be answered. Otherwise the request is rejected with 422, listing the open question ids.
- **`preview`** proceeds with placeholders where a fact is not publishable.

## 3. Output

```ts
interface ConceptSet {
  schema: 'roger.concept-set'; version: 1;
  id: string; brief: BriefRef; reviewId: string; mode: 'preview' | 'publishable'; seed: string;
  concepts: [HomepageConcept, HomepageConcept, HomepageConcept];
  distinctness: { pairs: { a: string; b: string; axesDiffering: string[]; structureDistance: number; pass: boolean }[] };
  checks: ConceptCheck[];          // set-level and per-concept validator results
}

interface HomepageConcept {
  id: 'a' | 'b' | 'c';
  name: string;                    // a working label, e.g. "Menu first"
  thesis: {                        // why this direction suits this business, grounded in the brief
    text: string;
    evidence: FactRef[];           // e.g. the menu items, reviews, story, locations it leans on
  };
  axes: DirectionAxes;
  tokens: DesignTokens;
  sections: Section[];             // in page order
  ctaPlan: { primary: CtaBinding; secondary?: CtaBinding; persistent?: CtaBinding };
  copy: CopyBlock[];
}
```

### 3.1 Direction axes: what makes the three concepts distinct

```ts
interface DirectionAxes {
  structure: 'offer-first' | 'story-first' | 'proof-first' | 'visit-first' | 'catalog-first' | 'action-first';
  heroComposition: 'full-bleed-photo' | 'split-photo-text' | 'type-led' | 'collage' | 'offer-panel';
  density: 'airy' | 'balanced' | 'dense';
  imageryRole: 'lead' | 'supporting' | 'minimal';
  typeVoice: 'grotesk' | 'humanist' | 'serif' | 'slab' | 'display-plus-sans';
  colorStrategy: 'brand-dominant' | 'brand-accent' | 'neutral-with-brand-action';
}
```

A pair of concepts passes when both of these hold:

- At least 3 axes differ, and `structure` or `heroComposition` is one of them.
- The structure distance is at least 0.5. This is the edit distance between the two section-kind sequences, normalised by length.

A set passes when all three pairs pass. A later check after rendering compares screenshots, so that two plans that differ on paper but look alike are caught.

### 3.2 Tokens, with their origin

```ts
interface DesignTokens {
  color: Record<'primary' | 'accent' | 'action' | 'surface' | 'text' | 'muted', TokenValue<string>>;
  type: { heading: TokenValue<FontChoice>; body: TokenValue<FontChoice>; scale: number; headingCase: 'as-is' | 'upper' | 'title' };
  radius: TokenValue<number>; spacing: 'compact' | 'regular' | 'generous';
  imagery: { treatment: 'natural' | 'duotone-brand' | 'framed'; aspect: '16:9' | '4:3' | '1:1' };
}
interface TokenValue<T> { value: T; origin: 'brand-measured' | 'logo' | 'stylesheet' | 'owner' | 'proposed'; ref?: FactRef }
```

- Brand colours and fonts from the brief keep their origin.
- When the brief's brand confidence is low or none, a concept may propose a palette, marked `proposed` and tied to `q-brand`.
- Colour contrast is a validator (§5), not a styling choice.

### 3.3 Sections and bindings

```ts
type SectionKind = 'hero' | 'offerings' | 'services' | 'proof' | 'story' | 'gallery' | 'locations' | 'hours' | 'contact' | 'cta-band' | 'faq';
interface Section {
  kind: SectionKind;
  variant: string;                 // a variant from the shared library, e.g. offerings: 'grouped-list' | 'featured-cards' | 'poster-grid'
  bindings: { slot: string; ref: FactRef }[];
  placeholders?: { slot: string; reason: string; questionId?: string }[];   // preview mode only
}
type FactRef =
  | { kind: 'fact'; path: string }                 // e.g. 'contact.phone', 'hours.listing', 'story'
  | { kind: 'offering'; id: string; withPrice: boolean }
  | { kind: 'service'; id: string }
  | { kind: 'asset'; id: string }
  | { kind: 'claim'; path: string }
  | { kind: 'testimonial'; index: number }
  | { kind: 'location'; id: string }
  | { kind: 'reviews-summary' }                    // rating and count; links to Google, never copies review text
  | { kind: 'owner-answer'; questionId: string };
interface CtaBinding { label: CopyRef; action: FactRef }   // e.g. action: { kind: 'fact', path: 'callsToAction.primary' }
```

**Section library.** Each `kind` and `variant` is one generic component that renders from the bindings and the tokens. A new variant is a library addition, available to every business. It is never a fork for one site.

### 3.4 Copy

```ts
interface CopyBlock {
  id: string; slot: string;
  origin: 'bound' | 'paraphrase' | 'generated';
  text: string;
  refs: FactRef[];                 // what it draws on; empty only for generated copy
}
```

- **`bound`** copy is the brief value verbatim, such as a name, price or address.
- **`paraphrase`** copy is a shortened form of a brief text, such as the story. It is checked for faithfulness, like the Phase 1 summary.
- **`generated`** copy is a headline or section intro. It must contain no numbers, names, places, prices, years or claims that are not in its refs.

## 4. Job stages

Phase 2 uses the existing job runner: resumable stages, saved work, and AI calls cached per input hash.

| Stage | What it does | AI? |
|---|---|---|
| `resolve` | Loads the pinned brief and the review, checks the hashes, and runs `resolveBrief`. In publishable mode it stops with 422 while blocking questions are open. | no |
| `directions` | Proposes three `DirectionAxes` and section sequences, each with a grounded thesis. The distinctness check runs on the proposals; failures are re-asked up to twice, then the set fails with the reason. | yes (cached) |
| `compose` | Fills the sections with bindings from `ResolvedFacts`, using deterministic selection rules (for example, offerings ordered as the menu orders them, and only publishable pictures). It writes the generated copy. | copy only (cached) |
| `tokens` | Derives the tokens for each concept from the brand evidence and the axes. Where evidence is missing, it proposes tokens and marks their origin. | no |
| `render` | Runs the shared renderer: HTML and CSS from the section library and tokens, with desktop and mobile screenshots. | no |
| `validate` | Runs the §5 validators on the plan and on the rendered HTML. | no |

## 5. Validators

These are the gates. Each is a pure function with fixture tests, and a failure names the slot and the fact.

1. **Grounding.** Scan the rendered text for phone numbers, emails, addresses, prices, times, years, percentages and names. Each match must equal a bound value whose fact is publishable, or a placeholder in preview mode.
2. **No held or disputed values.** No held call to action appears, and no value a fact had only as a candidate appears. Every `tel:`, `mailto:` and maps link resolves to a publishable fact.
3. **Rights.**
   - Publishable mode allows `owner-approved` pictures only.
   - Preview mode may show Google listing photos with the credit shown, never in the same gallery as owner pictures.
   - Review text is never copied.
4. **Offerings.**
   - A price is shown only if it is `verified`, or the owner approved prices.
   - An item is shown only if it is in `brief.offerings`.
   - Item order and sections follow the document.
5. **Copy faithfulness.** Paraphrase and generated blocks pass the no-new-facts check, which reuses `src/studio/summary.ts`'s checker.
6. **Distinctness.** §3.1, on the plans and on the screenshots.
7. **Accessibility basics.**
   - Text contrast is at least 4.5:1.
   - Touch targets are at least 44 px.
   - Every picture used has alt text, taken from the asset's alt or context.
   - There is one `h1`.
8. **Determinism.** Rebuilding from the cached AI outputs gives the same `ConceptSet` hash.

## 6. API

| Method | Path | Body or result |
|---|---|---|
| `POST` | `/api/studio/reviews` | `OwnerReview` without its id → 201 `{ id }`; 409 if the brief hash is stale |
| `GET` | `/api/studio/reviews/:id` | the review |
| `POST` | `/api/studio/concepts` | `ConceptRequest` → 202 `{ jobId }`; 409 stale brief; 422 open blocking questions (publishable mode) |
| `GET` | `/api/studio/jobs/:id` | the existing job view, with the Phase 2 stages |
| `GET` | `/api/studio/concepts/:setId` | `ConceptSet` |
| `GET` | `/api/studio/concepts/:setId/:conceptId/preview` | rendered HTML; preview watermark in preview mode |

**UI.** The brief page gains:

- a "Review" step: answer the questions, confirm pictures, claims and the menu;
- a "Concepts" step: three previews side by side, each with its thesis, axes, the facts it uses and its validator results.

## 7. Acceptance tests for phase 2

These run offline on the Phase 1 fixtures.

1. **Distinct concepts.** A fixture brief and review give three concepts that pass distinctness. Each concept's facts all trace to the brief.
2. **Disputed phone.**
   - In preview mode, the disputed Taco House phone (the `test/studio-documents.test.ts` fixture) renders as a placeholder, with no `tel:` link.
   - In publishable mode, the request is rejected with 422 until `q-contact-phone` is answered.
   - After the answer, the call button uses the chosen number.
3. **Grounding negatives.** A concept with an injected fabricated price, phone or year fails grounding. A Google photo in publishable mode fails rights.
4. **Offerings.** A menu-first concept lists only `brief.offerings` items. It shows prices only when they are verified or approved.
5. **Distinctness negative.** Three concepts that differ only in colour fail distinctness.
6. **Determinism.** The same inputs and cache give the same set hash. A new review gives a new set.

## 8. Decisions needed before building

1. **Publishable mode.** Should it require every blocking answer (as proposed), or allow a concept that leaves out the sections whose facts are open?
2. **Model and budget** for `directions` and copy: number of retries, and cost per set.
3. **Section library.** Which variants go in the first library? Proposed: 2–3 variants per section kind, which is enough for three concepts to differ without per-site work.
