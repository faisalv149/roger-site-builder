# Page families

Roger's generated sites use three authored **page families**. Each is a complete page design: header, hero, section rhythm, offerings, proof, imagery, contact, footer and inner pages. Families are versioned source code (`src/render/families.ts`, `src/render/family-css.ts`). A site's design plan pins the family **and its version** (`plan.family = { id, version }`), so updating a family never silently redesigns a customer's site. The owner can upgrade deliberately in the editor (Layout → "Update to the latest design").

| Family | Version | Built on (tokens) | Use when |
|---|---|---|---|
| Editorial Showcase | 2 | `modern-premium` direction: editorial serif + sans, spacious | Strong, authentic photos and a business whose work or atmosphere should lead (premium trades, salons, restaurants, shops) |
| Warm Local | 2 | `local-trusted` direction: warm serif / friendly sans, soft neutrals, rounded | People, locality and customer experience matter (cafés, salons, local trades, shops, consultants with a team) |
| Bold Practical | 2 | `bold-direct` direction: condensed grotesk, square, high contrast | Speed and clarity matter, or media is sparse (emergency trades, gyms, businesses without usable photos) |
| Clean Professional | 1 only | `clean-professional` direction | Earlier design, kept working for existing sites; not chosen for new plans |

Version 1 of every family is the earlier direction renderer (`src/render/design-sections.ts`). Plans saved before families existed migrate to `{ id: <from direction>, version: 1 }` and look exactly as before.

## Routing (`src/design/planner.ts`)

Routing goes by goal, content and media, not by category alone. Any category can use more than one family.

- Verified emergency or 24-hour service → Bold Practical.
- Strong photos (4+ usable, a hero that can lead) plus a standout signal (4.8★, 15+ years), or a salon, café or shop with strong photos → Editorial Showcase.
- Fitness → Bold Practical.
- No usable photo → Bold Practical (its photo-free hero is designed for this).
- Otherwise → Warm Local.
- "Generate another design" picks among families the content suits: Editorial only when there are photos that can lead.

## Shared rules

- **Containers:** the theme's `--maxw` (1160–1240px) with `--margin` gutters (16–20px on phones, 32–40px on desktop). The desktop breakpoint is 900px.
- **Type:** headings are `clamp()`-scaled to the viewport, multiplied by the owner's text size (`--tk`). Long headings wrap with `text-wrap: balance`. The H1 is limited to 12–16ch per family so long business names wrap rather than shrink.
- **Spacing:** `--section-y` comes from the direction preset, scaled by density and the owner's spacing choice (`--density`).
- **Colour roles:**
  - `--brand` is the button fill (or `--btn-bg` for gradients).
  - `--brand-ink` is text on the brand colour.
  - `--brand-text` is brand-coloured text and links. It is checked at 4.5:1 against both `--surface` and `--surface-alt`.
  - `--band` is the dark band.
  - `--ink` and `--ink-muted` are body text.
  - Gradients and custom colours are deepened until white button text reaches 4.5:1 (`src/design/appearance.ts`).
- **Motion:** each family has one restrained language, listed per family below. Every hover effect has a focus or `:focus-within` equivalent, and nothing is revealed only on hover. The owner's Motion setting (`data-motion`: off, subtle, expressive) and `prefers-reduced-motion` turn transitions off.
- **Actions:** the main action follows the plan's goal and what the business can actually do. Call needs a valid phone number. Appointments are requests, confirmed by the business. Order enquiries and quotes go to the request form.
- **Content fallbacks:**
  - No offerings → no offerings section, and no dead `#services` link.
  - Gallery: fewer than two photos → no gallery. Each family uses only counts that fill whole rows: Editorial uses lead + 2 or lead + 4, Warm uses 3 or 6, Bold uses 2 or 4.
  - No team photo → no team section.
  - No reviews or trust facts → no proof section. On published sites it becomes a "Read our reviews on Google" link.
  - No map → the visit card spans one column.
  - Carousel needs 3 or more good landscape photos, and is manual (APG carousel pattern).

## Editorial Showcase

| Part | Design |
|---|---|
| Header | 76px. Wordmark or logo left. Text-link navigation with underline-on-hover. The action is an underlined text link with an arrow, not a pill. Phones: wordmark + "Menu" disclosure (works without JavaScript) |
| Hero | Split variant: 5/12 text, 7/12 photo bleeding to the right edge. Large photo variant: full-bleed image (max 78vh) with a text panel overlapping it by 160px on desktop. Typography variant: headline up to 112px. A hairline facts strip (rating, years, licence, 24h) sits under the hero. Phones: the photo is limited to 4:3 and 42–46vh so the headline and main action stay on the first screen |
| Type | Serif display headings (clamp 40–88px H1), sans body; small-caps labels with 0.16em letter-spacing |
| Offerings | Two columns: sticky label and heading (4/12) next to a numbered list (8/12). Rows: number · name (links to its page when it has one) · description · price in the heading face. Phones: number and name, with the price below |
| Proof | One large pull quote (26–48px serif), up to two smaller quotes, then a rating and trust line |
| Imagery | Feature mosaic: lead photo across 2 rows (2fr) plus 2 or 4 smaller photos. Square corners, credits on photos |
| Rhythm | Hero → about (label left, large serif paragraph right) → offerings (alt surface) → gallery → process → team → proof → dark consultation band → visit → minimal footer |
| Closing | Dark band: "Let's talk about your project" (wording by category), hours, inverted button and a text link |
| Footer | Large wordmark, three columns (visit, hours, contact), small copyright |
| Inner pages | Breadcrumb, serif H1 (38–76px), lede and a hairline under the page header |
| Motion | Offering rows tint on hover; underline offsets on links |

## Warm Local

| Part | Design |
|---|---|
| Header | Utility strip on the dark band: open today · phone · town (shown only when known). Sticky 72px header: logo, navigation with an underline indicator, pill button. Phones: strip + logo + Menu |
| Hero | Text on the left: rating badge (or "Welcome to …"), H1 36–64px, lede, button and phone button. On the right, a collage: main photo in a white frame rotated −1.2°, a secondary polaroid from the gallery (desktop only) and an info card (hours, address). Typography variant: centred text with the info card below |
| Type | Warm serif or friendly sans headings; generous body line-height |
| Offerings | A cream "menu card" (24px radius) with rows: name · dotted leader · price, then description and duration; two columns on desktop. Suits menus, treatments and trade services alike |
| Proof | Three review cards on a tinted background, with initials avatars, stars and "Google review" attribution, plus trust chips |
| Imagery | Polaroid grid (3 or 6): white mats, soft shadows, 4:3 |
| Rhythm | Strip → header → hero → offerings → team → proof → gallery → closing card → visit card → footer (Classic), or with the intro first (Alternate) |
| Closing | Rounded tinted card: "See you soon at …" (hours-first categories) or "Talk to …", with buttons |
| Footer | Warm dark band: about blurb, the full hours list, contact |
| Inner pages | Tinted page header with rounded bottom corners, H1 34–56px |
| Motion | Cards and gallery photos lift 3px on hover |

## Bold Practical

| Part | Design |
|---|---|
| Header | Sticky dark bar, 70px: uppercase wordmark, uppercase navigation, "Call" plus the number on desktop, primary button. Phones: wordmark + phone icon button (44px, accessible name "Call …") + Menu |
| Hero | Purpose first, on the dark band: kicker, uppercase H1 (clamp 44–108px, 12ch), lede. On the right, a white action panel with a brand top rule: action title, phone, button, hours, verified checklist. Photo variants add a 21:9 photo band below (16:10 on phones). The photo-free variant shows up to four large verified numbers (years, rating, towns, number of services) |
| Type | Condensed grotesk, uppercase headings, tabular prices |
| Offerings | Ruled price table: uppercase names, descriptions, large prices on the right, "Request a quote" for unknown prices. The plans variant uses 3px-bordered cards, the first offset-shadowed in the brand colour |
| Proof | Big rating number (64–112px) with stars and count, trust checklist and one quote with a brand rule |
| Imagery | Square tiles (2 or 4) with no radius |
| Rhythm | Hero → urgent strip (trades with verified emergency only) → offerings → action band → gallery → proof → team → visit → black footer |
| Closing | Full-width band in `--btn-bg` (brand or gradient): uppercase call to action, light and outline buttons |
| Footer | Black, three tight columns: contact, hours, areas |
| Inner pages | Dark band with uppercase H1 |
| Motion | Price rows shift 8px on hover or focus-within |

## Pages (SitePlan, `src/design/siteplan.ts`)

- **One page:** a sparse business, or the owner's choice.
- **Several pages:** when there are 4 or more offerings, contact details to show, and either 2 or more offerings with real descriptions (60+ characters), an About page with substance, or 6 or more offerings. Pages:
  - Home, with an offerings teaser (4 items) and an action band.
  - Offerings overview (`services/`, `treatments/`, `menu/`, `memberships/`, `products/`).
  - Individual offering pages, only for trades, professional, general and salon offerings with real descriptions.
  - About, only with an 80+ character introduction plus people or facts.
  - Contact: form, hours, address, map.

No town-name pages and no empty pages. Removed routes are kept as redirects.

## Checks

`npm run qa:release` (`scripts/release-qa.ts`) runs full-page screenshots at 1440, 768 and 390px. It checks horizontal overflow, broken images, a single H1, axe WCAG 2.2 AA rules (contrast on the actual backgrounds, names, keyboard), the main action on the first phone screen and not covered by the widget, and in-page links with targets. `--families` renders each profile in all three families with the same content. Screenshots are evidence, not a pass on their own; automated accessibility checks don't establish full conformance. Human creative review is an open checkpoint.
