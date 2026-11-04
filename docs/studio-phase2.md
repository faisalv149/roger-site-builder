# Design studio, phase 2: homepage concepts

Phase 2 turns one pinned brief revision and an owner review into three homepage concepts. Each concept is rendered on desktop and mobile and checked against the facts. Everything is shared infrastructure: the concepts are data, rendered by one section library. No business has its own styling.

The code is in `src/studio/concepts/`. The interface was first proposed in `docs/studio-phase2-interface.md`; this document describes what was built and where it differs.

## Inputs

- **A pinned brief.** A job names `businessKey`, `revision` and, optionally, `briefHash`. If the stored revision has a different hash, the job is refused (`StaleBrief`, HTTP 409).
- **An owner review** (`roger.owner-review`, `review.ts`). It holds:
  - answers to the brief's questions;
  - the photo ids the owner approves (`"logo"` for the logo);
  - the claims the owner confirms;
  - whether the owner approves the menu prices;
  - the pictures the owner ties to a service or a menu section, or a choice of no picture (`serviceImages`);
  - the one concept the owner chose (`selectedConcept`).

  The review is pinned to the same brief. When none is given, an empty review ("not reviewed yet") is saved and used.

## Previews and publishing are separate

`resolveCatalog(brief, inventory, review)` builds the fact catalog: what a preview may show. A fact whose value is still open is left out of every concept, and so is every action that would act on it. The concept records each omission with its reason and question.

| Open in the brief | In a preview |
|---|---|
| Phone disputed (no answer to `q-contact-phone`) | Neither number appears and there is no call button; the validator fails any page that shows either number. Once the owner chooses, that number returns. |
| Listing address not on the website | The website's locations are listed; the listing's address and directions to it are not. |
| Several locations, none chosen as the main one | Every website location is listed, each with directions on its own card, none marked as the main one. A page-level action (header, hero, contact card) never picks one location: "Directions" becomes "Find a location", which opens the page's list of locations. The concept records the substitution in `notes`. The hours are left out, because they differ by location. |
| Website and listing hours disagree | No hours are shown. |
| A menu price tied to its item only by a poster's layout | The item is shown without that price. |
| A held call to action | Never shown. |

Publishing is a separate gate (`publicationGate`). Previews never require it. It lists what must happen before any concept is published:

- one concept chosen;
- every blocking question answered;
- every photo the chosen concept shows approved;
- every claim it shows confirmed;
- every price it shows approved;
- the logo confirmed.

Even with all of those, the gate stays closed: publishing itself is not built yet, and a chosen concept goes on to inner pages and a full build first.

## The job

`concepts/jobs.ts` runs these stages: `resolve` → `photos` → `directions` → `compose` → `render` → `validate`. The job is saved after every stage, can be resumed, and carries its AI spend with it.

1. **photos**
   - The business's own usable website photos are copied once into a shared cache and then into the set: no hotlinking, and three tries with backoff.
   - Pictures whose alt text or context names them as a diagram, chart, logo or graphic are excluded.
   - Google listing photos are never used in concepts.
2. **directions**: Claude plans the three directions (`plan.ts`, details below). If Claude is unavailable, over budget, or fails the rules after its retries, a deterministic planner assigns the library's variants instead. It is checked by the same rules.
3. **compose**: each plan becomes a concept. Facts and photos are bound by id from the catalog, and design tokens come from the brand evidence (`tokens.ts`).
4. **render** (`render.ts`, `library.ts`)
   - Each concept is written as one HTML file.
   - Chrome opens it at 1440×900 and at 390×844 (2× pixel density), takes a full-page screenshot and a first-screen screenshot, and measures the page.
5. **validate** (`validate.ts`): the checks below.

## Claude

- **Model:** `STUDIO_CONCEPT_MODEL`, default `claude-sonnet-5-5`. It runs through the API when `ANTHROPIC_API_KEY` is set (structured output, `output_config.effort`, default `medium`), else through the signed-in Claude Code CLI (`--json-schema`, `--max-budget-usd`). `STUDIO_CONCEPT_AI=0` turns it off.
- **Hard cost cap** (`STUDIO_CONCEPT_CAP_USD`, default $3 per set). Before each call, its worst case is computed: the input, plus the most output it may produce, at the model's prices; the CLI is counted at two turns and a one-hour cache write. If that worst case does not fit in what is left, the call is not sent. The CLI is also given the remainder as its own limit. Prices are in `ai.ts` (Sonnet 5.5: $2 in, $10 out per million tokens).
- **At most two retries** (`STUDIO_CONCEPT_RETRIES`, capped at 2). A rejected answer is retried with the list of what was wrong.
- **Keeping a sound plan:** if the last answer's structure passes every rule and only some lines of copy do not, the plan is kept and those lines fall back to plain default copy. Evidence ids that are not in the catalog are dropped rather than rejected, because they only support the thesis, which only the reviewer sees.
- **Cache:** answers are cached by model, attempt and exact request, so a rerun from the same brief and review replays to the same plan at no cost.
- **Usage log:** every call (tokens, cost, how the cost was known, worst case, cache hit) is logged to the set and to `studio-ai-usage`.

## The section library

Each variant is one renderer in `library.ts`. A new variant is added there, for every business.

| Kind | Variants |
|---|---|
| hero | `full-bleed` (photo fills the screen, headline over a scrim) · `split` (text panel beside a framed photo) · `type-collage` (oversized headline on the brand colour, three tilted photos, a running list of services or menu items) |
| offer (services or menu) | `cards` · `board` (numbered index, or the full menu by section with dotted leaders) · `rows` (alternating photo and text) |
| proof | `rating-band` (dark band with the Google rating and the business's own claims) · `pledges` · `stat-strip` |
| gallery | `mosaic` · `filmstrip` · `feature-grid` |
| contact | `panel` · `locations` (a card per location with directions) · `band` (dark band, phone number large) |
| story | `columns` · `portrait` |

Picture rules that hold for every variant:

- **A service shows only its own picture.** That means the picture the website itself puts on that service's card or page, and on no other service's. The owner can also tie a picture to a service in review, or take one away.
- **A menu section shows a picture only if the owner tied one to it.** No evidence links a website photo to a section such as "Drinks".
- **No stand-ins.** Without its own picture (none exists, it could not be downloaded, or it is already used higher on the page), a service or section is set as a tinted text row with a brand rule. It never gets a stand-in photo.
- **One appearance.** A photo appears once per page.

Type rules that hold for every variant:

- **Headline size.** A hero headline is sized so that its longest word fits its column at that face's width. Words are never hyphenated or broken.
- **Display-only faces.** A face like Climate Crisis or Anton is used only for headlines, section titles, big numbers and the running list. Small headings, quotes, addresses and names use the body face.
- **Big numbers.** Stat numbers are sized to their own box.
- **Logo.** The logo's empty margins are trimmed. It is shown only where it stands out from the header at 3:1; elsewhere the business name is used as a wordmark.

## Distinctness

- **Plan rules:** the three plans must use different hero variants, offer variants, structures (which section follows the hero), type voices and colour strategies. They must also use different hero photos.
- **Screenshot rule:**
  - Each screenshot is reduced to a greyscale edge map, which keeps structure and drops colour.
  - The first screen is cropped to the end of the hero.
  - A pair is distinct only if the first screens on desktop and on mobile, and the whole pages, are all below the thresholds (0.5, 0.55, 0.5).
- **Calibration** used negative controls (`out/qa/studio-phase2/calibrate.mts`, and the tests):
  - the same concept with its sections reordered scores 0.998 on the first screen;
  - the same concept recoloured scores 0.92 on mobile and 0.59 on the whole page;
  - real pairs score 0.05–0.42.

## Checks on the rendered pages

| Check | What fails it |
|---|---|
| grounding | A phone number, email, address, price or any other number on the page that the catalog does not allow; any disputed value, or a price left out, appearing. |
| rights | A picture that is not one of the business's own website photos copied into the set; any Google photo; a picture that did not load. |
| links | A link that is not a section of the page, the agreed phone or email, or one of the catalog's actions; any held action. Directions to one address anywhere except that location's own card, unless it is the business's chosen address (checked on desktop and mobile). |
| imagery | A picture inside a service or menu section (by its `data-fact`) that is not the one tied to it, or a picture where nothing ties one. |
| accessibility and legibility | Text below WCAG AA contrast (measured in the page, worst case over photographs); a tap target under 44×44; a missing alt text; not exactly one h1; skipped heading levels; sideways scrolling on mobile; no skip link; a heading that breaks a word across lines; text that spills out of its own box. |
| copy (before rendering) | Written copy that adds a number, a name or a claim the evidence does not contain. Claims such as "best" or "licensed" are checked however they are spelled, so "family owned" and "family-owned" count as one. Other things that fail it: title case (it reads as names) and copy over the length limits. **Evidence** means the facts (including a state's full name for its locations), the business's own story and photo captions. It does not include the AI summary, because the summary is itself written copy. |

The in-page measuring has a test of its own (`measureHtml`), on a page built to fail every check.

## API and UI

- **API** (`src/studio/routes.ts`):
  - `GET /api/studio/businesses` lists every business with a brief.
  - `POST /api/studio/reviews` saves an owner review and returns 201. It returns 409 for a stale brief.
  - `POST /api/studio/concepts` with `{ businessKey, revision?, briefHash?, reviewId? }` starts a concept job and returns 202 with `{ id, setId }`.
  - `GET /api/studio/concept-jobs/:id` returns the job.
  - `GET /api/studio/concept-sets/:id` returns the set.
- **Previews** are served under `/studio-previews/<setId>/`, behind the Studio password, with `noindex`.
- **Owner review:**
  - `GET /api/studio/review-data/:key[?revision][&reviewId]` returns what the review screen needs: questions, disputed facts with their sources, photos, the service pictures, claims, the menu, and the concept sets of that revision.
  - `GET /api/studio/concept-sets/:id/gate[?reviewId]` returns the gate of a set under a review.
  - The page is `/app/review.html`. On it the owner settles facts, chooses a concept, approves photos and the logo, ties pictures to services and menu sections, and confirms claims and the menu. It saves a review, shows that publishing stays blocked and why, and can start new concepts with the review.
- **Studio page:** `/app/concepts.html`. It starts a set, shows the stages, then shows the three concepts side by side with their screenshots, checks, omissions, cost, distinctness and publication blockers.
- **Command line:** `npx tsx scripts/studio-concepts.ts --business <key> [--revision n] [--review id] --out <dir>`.

## Not built yet

- Publishing a concept (the gate always lists it as not built).
- Inner pages: only the homepage is designed.
- **Photo understanding.** Claude chooses hero and gallery photos from their alt text, size and orientation, not by looking at them. Service pictures are safe, because they come from evidence or the owner. But a hero or gallery photo can still be a poor choice; the owner review is where a person corrects that.
- **Editorial judgement.** The copy checks stop invented facts, not generic slogans ("you can trust", "feel well"). Choosing and refining one direction per business is a person's job, in review.
