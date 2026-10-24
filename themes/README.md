# Theme package — 5 verticals × 6 layouts = 30 themes

Each file is one complete `theme.json` (schemaVersion 2). Folders: roofing, hvac, plumbing, electrical, landscaping.
`index.json` lists every theme with its vertical, variant, grid system, brand color and section order.

## The six layouts (same six in every vertical)
| variant  | leads with      | grid                       | corners | default fonts   |
|----------|-----------------|----------------------------|---------|-----------------|
| urgent   | call button     | 12-col, 1140px, compact    | square  | bold condensed  |
| showcase | gallery         | asymmetric 12, 1440px      | none    | editorial serif |
| trust    | reviews         | centered 8, 960px          | round   | rounded         |
| estimate | quote form      | 12 + sticky sidebar, 1280px| soft    | clean sans      |
| classic  | brief's default | 12-col, 1200px             | soft    | classic serif   |
| minimal  | single column   | single col, 760px          | square  | geometric       |

## Build-time rules
- `palette.brand` is the vertical default. At build, write the color pulled from the logo into the *rendered* palette only; never back into the theme file. `brandColor` says what to do when the pulled color is unusable.
- `sections` is the order; `sectionLayout` is the variant/columns per section; `sectionRules` is when a section is hidden.
- `services.defaults` exist because Google never returns a services list. Match `keywords` against reviews/website to pick the top 6.
- `{city}` etc. are the only placeholders filled in copy (see `placeholders`).
- `fontFaces` is empty: all fonts are system fonts, nothing loads. Add web fonts there (max 3 weights) if the designer picks any.
- Stock images point at `/stock/<vertical>-*.svg` placeholders; replace with licensed photos.
- `match.googleTypes` maps the Google Business category to the vertical.
