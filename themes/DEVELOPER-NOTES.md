# Theme files: what changed and what to update

The theme files now use **schemaVersion 2**. The old shape (fontPairs, defaultPair, fontFaces, palette, derive, overlayAlpha, sections, copy, stock) is still there and unchanged. Everything below is new. Please update the uploader and the renderer in this order.

## 1. Uploader

- Accept the new top-level keys listed below. Right now the uploader rejects unknown keys, so nothing uploads.
- Read `meta.vertical` and `meta.variant` to identify a theme. Stop versioning by filename: `roofing-urgent` and `roofing-trust` are two different themes, not two versions of `roofing`.
- `stock.hero[]` and `stock.gallery[]` entries are objects: `{ url, width, height, alt, source }`.
- `fontPairs[]` entries now include `label`.

## 2. Layout and grid

- `grid`: the page grid. `system` is one of `12-col`, `asymmetric-12`, `centered-8`, `sidebar-12`, `single-col`. Also `columns`, `maxWidth`, `gutter`, `margin.phone` / `margin.desktop`. `sidebar-12` has a `sidebar` object (width in columns, side, sticky, which section it holds).
- `sections`: the order of sections, same as before.
- `sectionLayout`: one entry per section id with its `variant` plus any of `columns` (phone/desktop), `span`, `offset`, `split`, `align`, `height`. Build each variant once; the list of variants is in index.json.
- `spacing.scale` (8 steps), `spacing.sectionY` (phone/desktop), `spacing.density`.
- `radius.sm/md/lg` and `shadow.card`.

## 3. Type and fonts

- `type.scale` xs to 4xl in px (4xl has phone/desktop values), `type.lineHeight`, `type.headingWeight`, `type.headingCase`, `type.headingTracking`, `type.bodyWeight`, `type.measure` (max characters per line).
- `fontFaces` is still empty: all fonts are system fonts, load nothing.

## 4. Color and branding

- `palette` now includes `inkMuted` and `surfaceAlt`.
- `derive` now includes `space: "oklch"`, `brandInkAuto` (pick white or dark text on brand automatically) and `minButtonContrast: 4.5`.
- `brandColor`: rules for the color pulled from the client's logo. Reject near-gray or neon (chroma limits), darken until the button passes contrast, else fall back to `palette.brand`. **Apply the pulled color at build time only; never write it back into the theme file.**
- `logo`: header placement, max height per device, white band, and the wordmark fallback (heading font, title case, two lines, brand color) when there is no usable logo.
- `overlayStyle`: `solid`, `gradient-left` or `gradient-bottom`, used with `overlayAlpha` under text on photos.

## 5. Components

- `buttons.primary` / `buttons.secondary`: fill, ink, border, radius, height, case, weight. `minTapTarget: 44`, `focusRing`.
- `icons`: one outline set (`lucide`), stroke, size, color.
- `images`: hero and gallery aspect ratios, min size, max gallery count, reject text-heavy, 250 KB cap.
- `roger`: which Roger components are on, text prefill, consent line.

## 6. Content rules

- `sectionRules`: when to hide a section. `urgent.showWhen` (open 24h or an emergency keyword), `services.min/max` plus the overflow link, `proof.minRating/minReviews` and review quotes, `gallery.minPhotos`, `area.maxPlaces/showMap`, `hours.showOpenNow`.
- `services.defaults`: the trade's standard services with `icon` and `keywords`. Google returns no services, so match keywords against reviews and the website and show the top six.
- `trust.templates`: wording for license, insurance, years, warranty. Only show facts the business states.
- `copy` has two new fallbacks: `sublineNoServices` and `heroNoCity`.
- `placeholders`: the only tokens to fill in copy: `{business} {city} {state} {zip} {rating} {reviewCount} {years}`.
- `match.googleTypes`: Google Business categories that map to this vertical.
- `seo`: title and description patterns, `schemaType`, OG image source.
- `locale`, `colorScheme` (always light), `motion` (subtle, off for reduced motion).

## Not changed

Palette tints/shades recipe, section ids, `{city}` behaviour, stock placeholder paths, the Roger components list.
