# Roger Site Builder

Turn a Google Business listing + one of your `theme.json` files into a live website in seconds (≈2–3 s offline in mock mode; live runs are expected around 15–45 s, mostly Claude and PageSpeed, which run in parallel), audit the business's existing site, and produce the iMessage cards Roger sends at each step.

```
iMessage ─► /api/lookup  ─► "Is this you?" card
         ─► /api/audit   ─► score + top issues card      (has a website)
         ─► /api/build   ─► new site + preview card       (always)
```

## Quick start

```bash
npm install
cp .env.example .env          # leave keys empty to run fully offline (mock mode)
npm start                     # http://localhost:4000  → Roger Site Studio
npm run demo -- --all-layouts # builds the 4 sample businesses + roofing in all 6 layouts
npm test                      # unit tests (maps links, color rules, theme validation, hours)
npm run sweep                 # all 36 themes: phone/desktop overflow + JS errors (server running)
npm run e2e                   # Studio walkthrough; npm run e2e:imessage for the iMessage demo (screenshots in out/qa/)
```

Studio (`/`) lets you: find a business, add an existing website, pick a library theme **or drop in a theme.json**, build, and see the live progress, a desktop/phone preview, the audit, the exact iMessage cards, and a conversation simulator of the whole Roger flow.

**iMessage demo (`/imessage`)** is a stand-in for the iMessage gateway: an iPhone Messages look-alike (light/dark, full-screen on a phone) that posts each text to `/api/imessage/inbound` and renders the replies the way iPhone does: text bubbles, then a rich link preview from the page's `og:image` + `og:title`, typing indicator, Delivered/Read, and the quick replies as tappable suggestions. Use it for demos until a real gateway is hooked up.

**Saved history.** Every build the server runs (Studio, iMessage page, API) is saved to `data/builds/<id>.json` with its full result, and every iMessage conversation to `data/conversations/` (messages + the flow state, so a server restart continues where it left off). The Studio's **Sites** tab lists them, updates on its own, and re-opens any build in the other tabs, with the conversation that produced it. The iMessage page reloads its conversation after a refresh. Sites built before this existed can be added with `npx tsx scripts/import-site.ts <slug> [--source imessage]`. Rebuilding a business overwrites `out/sites/<slug>/`, so older builds of the same site are marked "replaced".

**Build-time estimate.** The Studio shows one above **Build website** (and the exact line Roger texts), counts up while building and shows the real time after. Roger uses the same estimate in iMessage: the no-website offer says "It takes about 15 seconds", and "yes" gets "On it. Your preview will be ready in about 15 seconds" right away, with the preview following when it's done. Texting mid-build gets the time left. Estimates round up (Roger slightly over-promises) and use the 75th percentile of recent matching builds (`src/estimate.ts`).

Mock mode (no `GOOGLE_MAPS_API_KEY`) uses 4 sample businesses in `fixtures/places/` and a deliberately outdated demo website at `/demo-sites/summit-peak-roofing/` so the audit has something to find.

### Environment

| Variable | Purpose |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Places API (New). Enables live lookup, details, photos, nearby towns. |
| `PAGESPEED_API_KEY` | Optional; real Lighthouse mobile score in the audit (falls back to the Maps key). |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude extracts facts from the website/reviews, writes service one-liners and the iMessage audit summary. Default model `claude-sonnet-5-5`. Without a key, deterministic templates are used. |
| `CLAUDE_CLI` / `CLAUDE_CLI_PATH` | Local demos only. `CLAUDE_CLI=1` with no API key runs the same Claude calls through the signed-in Claude Code CLI (`claude -p`, schema-validated JSON; no tools, no MCP, no user settings, empty temp folder). Adds roughly 5–10 s per call. An API key always wins. |
| `PUBLIC_BASE_URL` | Public URL of this server. Needed for `og:image` (iMessage rich links) and lead-form posts. |
| `ROGER_IMESSAGE_ADDRESS` | Optional. Adds a "Claim it" link (opens Messages to Roger) on preview sites. |
| `LEAD_WEBHOOK_URL` | Optional. Every quote-form submission is POSTed here as JSON (also saved to `data/leads/<slug>.jsonl`). |
| `CHROMIUM_PATH` | Optional. Real screenshot for the preview card; auto-detected from Playwright. |
| `DATA_DIR` | Optional. Where saved builds, conversations, leads and uploaded themes go (default `data/`). Point QA runs at a throwaway folder so test builds stay out of the real history. |
| `IMESSAGE_OUTBOUND_URL` | Optional. Your iMessage gateway's send endpoint. Messages Roger sends later (the preview after "On it") are POSTed here as `{ from, replies }`. |
| `STUDIO_PASSWORD` / `STUDIO_USER` | Password (user default `roger`) for the Studio, `/imessage` and `/api/*`. Unset = open, fine only on your own machine. |
| `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_PREFIX` | Publish finished sites to Vercel (token from vercel.com/account/tokens; team id only for a team token; project prefix default `roger-`). |
| `OUT_DIR` | Optional. Where generated sites, cards and reports go (default `out/`). On a host, the persistent disk. |

## Deploy

**Builder (Studio, API, iMessage page) on Render.** It needs an always-on server with a disk (it writes sites, builds and conversations), so it does not run as Vercel functions.
1. Render → **New → Blueprint** → this repo. `render.yaml` sets Node 22, `npm ci`, `node --import tsx src/server.ts`, a 1 GB disk at `/var/data` (`DATA_DIR`, `OUT_DIR`) and the `/api/health` check.
2. Fill in what it asks for: `STUDIO_PASSWORD` (required on a server), `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY` (the local Claude Code mode does not exist on a server; without a key Roger uses templates), `VERCEL_TOKEN`, and `VERCEL_TEAM_ID` only for a team token.
3. Open the Render URL and sign in as `roger` with that password. `PUBLIC_BASE_URL` defaults to the Render URL; set it when you add a custom domain.

Railway works too: start command `npm start`, a volume, and `DATA_DIR` / `OUT_DIR` pointing into it (`PUBLIC_BASE_URL` defaults to `RAILWAY_PUBLIC_DOMAIN`).

**Finished sites on Vercel.** With `VERCEL_TOKEN` set, every site gets a **Publish** button (Sites tab and build summary). Each site becomes its own Vercel project, `roger-<slug>.vercel.app` (prefix: `VERCEL_PROJECT_PREFIX`); **Republish** appears when a newer build exists. Links the site makes to itself are rewritten to the Vercel domain, the lead form keeps posting to the builder, and `site.json` (raw Google data) is not uploaded. Preview builds keep their banner and `noindex`.

Notes: Render's Node runtime has no Chromium, so preview cards use the generated share image instead of a screenshot. `STUDIO_PASSWORD` covers the Studio, `/imessage` and `/api/*`; sites, cards, reports, stock images, `/api/leads/*` and `/api/health` stay public. An iMessage gateway calling `/api/imessage/inbound` sends the same credentials (HTTP Basic). Google photos and reviews on a published site are still subject to the Places API terms (see below).

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/lookup` | `{ input }` — name + ZIP, Google Maps link, `maps.app.goo.gl` short link, or place ID | candidates + "Is this you?" card |
| POST | `/api/audit` | `{ website, placeId? | google? }` | audit, report URL, card |
| POST | `/api/build` | JSON or multipart: `google` or `placeId`, optional `website`, `themeId` **or** `theme` (file/object), `vertical`, `variant`, `fonts=business`, `brandColor`, `preview`, `audit`, `slug`. Add `?wait=1` to block. | `202 { jobId }` or the full result |
| GET | `/api/jobs/:id/events` | — | Server-sent events: each step with timing, then `end` with the result |
| GET | `/api/themes` · `/api/themes/:id` | — | library (36 package themes + uploads) |
| POST | `/api/themes/validate` · `/api/themes` | multipart `theme` file or `{ theme }` | validation (errors + warnings) / save to `data/themes/` |
| POST | `/api/leads/:slug` | `{ name, phone, email?, zip?, service?, message? }` | stores lead, forwards to webhook (CORS open) |
| POST | `/api/imessage/inbound` | `{ from, text, async? }` | `{ replies: [{ text, url?, image?, title?, quickReplies? }], pending?, messageCount }`. With `async: true` a build answers "On it. Your preview will be ready in about 20 seconds." at once (`pending` has the estimate) and the preview follows later: saved to the conversation and POSTed to `IMESSAGE_OUTBOUND_URL`. Without it, everything comes back in one response |
| GET | `/api/estimate?website=1&audit=1` | — | `{ seconds, label, basis, samples, source }`: how long a build will take, from recent builds that ran the same way (live/sample data, Claude mode, website, audit); starting figures until there are 3 |
| GET | `/api/builds` · `/api/builds/:id` | — | saved builds, newest first (summary) / one full record |
| GET | `/api/conversations` · `/api/conversations/:from` | — | saved iMessage conversations / one transcript. No auth yet: fine locally, add it before this is public |

CLI equivalents: `npm run cli -- build --google "Name 78704" [--theme my.theme.json | --theme-id plumbing-urgent] [--website https://…]`, `cli -- audit --website …`, `cli -- lookup …`, `cli -- validate file.json`.

### Sending the cards in iMessage
iMessage draws a rich card from the link's Open Graph tags. Every card URL here (confirm page, audit report, site) carries a purpose-made 1200×630 `og:image`, so the gateway just sends `text`, then `url` as its own message. Quick replies are suggestions for your UI or the expected answers.

## Build pipeline (`src/pipeline.ts`)

1. **Google Business** — resolve the input (expands short links, parses `/maps/place/NAME/@lat,lng`, `query_place_id`, `!19sChIJ…`), Text Search, Place Details, Nearby Search for towns.
2. **Website scan** — HTML + up to 3 stylesheets + 2 service/about pages: logo candidates, theme-color, CSS colors, Google Fonts, phones, emails, socials, text.
3. **Theme** — the uploaded file, a chosen id, or auto-pick: `match.googleTypes` → vertical (name keywords only when the Google category is vague, e.g. general contractor; no match → the `general` themes, never a trade's); layout by signals (24h/emergency → urgent, ≥4.7★ & ≥40 reviews → trust, ≥6 photos → showcase, no phone → estimate, else classic).
4. **In parallel** — photos (size filter, owner photos first, flyer filter, WebP under `maxFileKb`), logo (decodable, big enough, not a photo, visible on the header band), facts (Claude or regex), audit.
5. **Brand color** — `brandColor.source` order (logo → website → default); reject near-gray / neon by OKLCH chroma; auto ink; darken until `minButtonContrast`. Applied to a clone only — **the theme file is never modified**.
6. **Content model** → **render** static HTML (one file, inline CSS/JS, no external requests except the map embed) → favicon, apple-touch-icon, `og.jpg`, `preview.jpg`, `site.json`.

Output: `out/sites/<slug>/` — a self-contained folder you can upload to any static host (Cloudflare Pages, Netlify, S3). Set `PUBLIC_BASE_URL` to where it will live before building so `og:image` and the lead form point to the right place.

## How the theme.json (schemaVersion 2) is used

| Key | Used for |
|---|---|
| `meta.vertical` + `meta.variant` | Theme identity (`roofing-urgent`), never the filename |
| `match.googleTypes` | Google category → vertical |
| `fontPairs`, `defaultPair`, `fontFaces` | CSS font stacks; `fontFaces[].url` loads web fonts. `fonts=business` adds the website's Google Font for headings |
| `type.*` | Scale (4xl phone/desktop), line heights, weights, heading case/tracking, `measure` |
| `palette`, `derive`, `brandColor` | Rendered palette, OKLCH tints/shades, brand-ink, contrast-safe brand text color |
| `overlayAlpha`, `overlayStyle` | Photo overlays (solid / gradient-left / gradient-bottom) |
| `logo.*` | Header logo size per device, band contrast check, wordmark fallback (heading font, title case, 2 lines, brand) |
| `grid.*` | `12-col`, `asymmetric-12`, `centered-8`, `single-col`, `sidebar-12` (sticky quote sidebar; inline on phones) |
| `spacing`, `radius`, `shadow`, `buttons`, `icons` | CSS tokens; Lucide icons inlined at the theme's stroke/size/color |
| `images.*` | Hero/gallery ratios, min size, max gallery, text-heavy filter, 250 KB cap |
| `sections`, `sectionLayout`, `sectionRules` | Order, every variant listed in the package, and the hide rules |
| `copy`, `placeholders` | Hero/subline/urgent/action/quote copy, only `{business} {city} {state} {zip} {rating} {reviewCount} {years}` are filled (plus `{category}`, Google's label such as "Fitness center", in themes that declare it, like the general ones); `heroNoCity` / `sublineNoServices` fallbacks |
| `services.defaults` | Fallback only. Claude first lists the business's own services from its website (or what reviews say it provides), in its wording, with an icon; with at least `sectionRules.services.min` of those they replace the theme list. Otherwise the defaults are ranked by keyword hits in website + reviews, top `max` shown. May be empty (general themes): then the section hides |
| `trust.templates` | Only facts the business states (license, insured, years, warranty) |
| `roger.*` | Sticky call/text/quote bar, header call button, text bubble with prefill, consent line, preview banner, footer credit |
| `seo.*`, `locale`, `colorScheme`, `motion` | Title/description patterns, JSON-LD `@type`, `og:image` from hero, `lang`, reduced-motion-safe reveal |
| `stock.hero` | Hero fallback when no usable Google photo. `stock.gallery` is intentionally **not** used: placeholders shouldn't pose as the business's work |

Unknown keys are accepted and reported as warnings (the old uploader rejected them). Optional extras the renderer understands: `copy.titles.{services,proof,gallery,area}` and `services.defaults[].description`.

## Things worth knowing

- **Google doesn't provide a logo, brand colors, fonts, services or service areas** through the Places API. Logo, colors and fonts come from the business website; without one, Roger uses a wordmark + the theme's colors. The Business Profile API (owner sign-in, and Google must approve API access first) exposes the logo, cover photo and the owner-entered services list (`serviceItems`) — a good next step once a client says "yes, that's me". Until then services come from the business's website via Claude.
- **Google content rules**: reviews show the author and "Ratings and reviews from Google"; customer photos carry a credit; owner-uploaded photos are preferred. Places content has caching/storage limits, so treat Google photos/reviews in a *published* site as something to confirm with the owner (or re-pull through the Business Profile API) — previews are `noindex`.
- `brandColor.maxChroma: 0.3` only rejects the most extreme colors (pure `#00FF00` is ~0.295 and passes, then gets darkened). Around 0.25 would catch pure greens and reds.
- The `emergency` service ("24/7 emergency …") is only listed when the business is open 24 hours or mentions emergency service.
- In-memory job queue (`src/jobs.ts`, 3 concurrent builds). Swap for a real queue when you run more than one server.

## Layout

```
src/
  sources/   maps-url.ts (link parsing) · places.ts (Places API + mock) · website.ts (scanner)
  theme/     schema.ts (zod, permissive) · load.ts (library + uploads) · select.ts (auto-pick)
  color/     oklch.ts · palette.ts (brandColor + derive rules)
  brand/     logo.ts · photos.ts · brand.ts
  content/   facts.ts (Claude + heuristics) · services.ts · service-copy.ts · model.ts (section rules)
  render/    css.ts · sections.ts (every variant) · page.ts · parts.ts · icons.ts · og.ts
  audit/     audit.ts (checks + PageSpeed + summary) · report.ts (report page + score card)
  imessage/  cards.ts · flow.ts (reference conversation)
  pipeline.ts · jobs.ts · server.ts · cli.ts
themes/      your 30-theme package (unchanged) + general/ (6 trade-neutral stand-ins from scripts/make-general-themes.ts, for gyms, salons, shops...; replace with designer versions)
fixtures/    mock Google businesses + demo outdated website
public/      Studio UI · /stock placeholders
```
