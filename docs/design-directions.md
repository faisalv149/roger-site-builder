# Personalisation pilot: design directions and compatibility rules

Plumbing only, first release. Code: `src/design/` (model, planner, photos, composition), `src/render/design-sections.ts` and `src/render/design-css.ts` (rendering). Other trades and every chosen or uploaded theme render exactly as before.

## When a build gets a design plan

| Build | Plan? |
|---|---|
| Automatic theme choice and the business is a plumber | Yes, with recommended answers: the first preview needs no questions |
| Theme chosen in the Studio, `themeId` / `vertical` / `variant` in the API, or an uploaded theme.json | No. The theme stays authoritative |
| Same, then refined with **Replace the chosen theme** ticked (`optIn: true`) | Yes |
| Any other trade | No ("pilot for plumbing businesses") |
| `DESIGN_PILOT=0` | No (switch for the whole server) |

## The three questions (all optional)

| Question | Options | Rules |
|---|---|---|
| Which service should your website focus on? | services the business data supports (its own list, or theme services its website/reviews mention), the owner's own wording, **Keep recommended** | Owner text: 2–60 letters/numbers/simple punctuation, no links or emails, escaped when rendered. It is used as typed unless it matches a listed service exactly |
| What should visitors do? | Call · Request a quote · Request an appointment · **Keep recommended** | Call needs a valid phone number (otherwise the plan uses Request a quote and says why). Appointments are **requests**: there is no booking provider, the business confirms the time |
| How should your business feel? | Local & trusted · Bold & direct · Modern & premium · **Keep recommended** | A bold style never adds emergency claims. The Studio has an "owner confirmed emergency call-outs" box; iMessage asks "Do you offer emergency call-outs?" after Bold |

The Studio (`POST /api/builds/:id/personalise`) and the iMessage flow (`src/imessage/flow.ts`, answers saved in the conversation's session) send the same `DesignPreferences`, validated by `preferencesSchema` (`src/design/schema.ts`), into the same rebuild (`src/design/refine.ts`).

## Directions

| | Local & trusted | Bold & direct | Modern & premium |
|---|---|---|---|
| Surfaces | warm neutrals (`#FBF8F3` / `#F2ECE3`), soft shadows, 14–28px radii | white + near-black bands, square edges, 2px rules | off-white, hairlines, no shadows |
| Type (preset, alternate) | Fraunces + Source Sans 3 · Nunito + Nunito Sans | Barlow Condensed + Barlow (uppercase) · Archivo | Playfair Display + Inter · Inter Tight + Inter |
| Spacing | comfortable (56 / 96px sections) | compact (40 / 72px) | spacious (72 / 136px) |
| Hero options, in order of preference | split · type-led | photo-led · type-led · split | photo-led · split · type-led |
| Emphasis | team, verified reviews, service area | phone and request buttons first, emergency band when verified | the main service, large project photos, how it works |
| Main sections | services (cards / checklist), team, review cards, projects grid, coverage, request (split) | contact band, emergency band, dense service list, projects strip, stat band, team strip, request (inline), chips | service focus + index, projects (large), how it works, team, pull quote, consultation request, compact area |

Brand colours come from the business (logo → website → theme default) and are checked against each direction's surfaces with the usual contrast rules (`src/brand/brand.ts`). Only the selected pair's two families and weights are requested from Google Fonts, with system fallbacks.

## Compatibility rules

Enforced by `planProblems()` / `validatePlan()` (`src/design/schema.ts`); the planner never ships a plan that fails them.

1. The hero is first, with the plan's hero variant; the footer is last; exactly one request (quote) section.
2. A section may only appear in a direction that lists it, with a variant that direction lists (`COMPAT`).
3. Typography and hero variant must belong to the direction.
4. `split` and `photo-led` heroes need a hero photo; `photo-led` also needs a strong one (≥1400px wide, landscape, quality ≥ 0.55).
5. `team` needs a photo confirmed to show the team (vision label or sample label). Unknown photos never become team photos.
6. `projects` needs ≥3 photos for `grid`, ≥2 for `strip` and `large`.
7. `urgent` (emergency band) needs `emergency: true`: 24h hours or emergency wording from the business, or the owner's confirmation. The owner saying "no" wins.
8. Hero, team and project photos are all different.

Content rules applied by the planner: reviews only with a rating ≥4.0 from ≥5 reviews or stated licence / insurance / years; area only with towns or an address. Pages without photos get a typography-led hero; the sparsest page is hero → services (or service focus) → request → footer.

## Planning order and stability

For each decision: the owner's answer → the saved plan (newest plan for the same Google place ID) → recommendation from the data. Claude may suggest a style, main service, headline and subline inside the existing facts call (no extra request). Each suggestion is used only when valid:

- the style only when the rules fell back to the default
- the service only when it matches a listed service
- the copy only when it names the main service and passes the claim guard (no unverified 24/7, emergency, licence, insurance, warranty, years or rating; no superlatives, prices, "free", phone numbers or links)

Otherwise deterministic rules decide; with Claude off or failing, everything is rules.

- An ordinary rebuild reuses the saved plan exactly: same id, sections, variants, photos and copy.
- Changing one answer re-resolves only what it affects: the style changes the type, hero and sections; the goal changes the actions and the request section; the service changes the focus and copy.
- **Try a different design** makes variation n+1, a new plan id. With no style answer it rotates the direction; with one, it rotates the type preset, hero and service layout.

## Photos

`src/design/photos.ts` ranks each kept Google photo by usable resolution, sharpness and exposure. What a photo shows (team / work / vehicle / storefront / other) comes from one Claude vision call with small thumbnails, which runs alongside the facts call and is API only. Sample fixtures carry the label in `analysis.kind`, standing in for that call. Without either, photos are ranked by quality only and no team section appears. Hero crops are art-directed per screen (`<picture>`, sharp attention cropping): desktop 16:9 / 4:5 split, phone 2:3 (premium overlay), 3:2 (bold) or 4:3. Credits for customer photos stay visible.

## The plan (version 1)

Saved with the build (`result.design`, in the JSON tab and the API) and its answers (`record.preferences`). Fields:

- `id` (`dp_` + hash of place ID and variation), `variation`
- `direction`, `goal`, `service`, `hero`, `sections` (ordered id + variant), `typography`
- `tokens` (brand and surface colours)
- `images` (photo keys for hero, team, projects)
- `copy`, `emergency`
- `sources` (owner / saved / recommended / alternative per decision), `preferences`
- `planner` (rules or claude+rules), `reasons`

Records from before the pilot have none of these and still open, personalise and rebuild.

## QA

- `npx tsx scripts/make-plumbing-fixtures.ts`: the 10 fictional plumbing businesses (`fixtures/places/mock-demo-*.json`, 3 demo websites).
- `npm test`: preference resolution, plan validation, deterministic fallback, stability, theme precedence, persistence compatibility, leads.
- `npm run qa:design -- http://localhost:4100 <password> out/qa/design`: needs a server on empty `DATA_DIR` / `OUT_DIR`. It builds and refines the matrix, checks every page on desktop and phone, submits real leads, drives the simulator and the Studio, and writes `report.md` / `report.json`, screenshots and greyscale direction sheets.
