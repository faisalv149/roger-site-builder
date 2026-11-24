# Roger splash page — build plan

Roger's new output: **one splash homepage per business**, a vertical scroll of 4 to 9 screens that answers a
visitor's question within five seconds and gets them to act. It replaces the multi-page custom site as what Roger
generates. This plan turns the client's splash-page specification into Roger's pipeline.

## Decisions (23 Nov 2026)

| Question | Decision |
|---|---|
| Trade playbook | Roger drafts it; one standardised scroll order, varied only by trade family (food, health, calm) |
| Pages | One-page splash only. No multi-page generation for now |
| Owner inputs | Through the iMessage conversation (corrections, prices, photos, review picks, service area) |
| Quote requests | Go to the owner and to a Roger dashboard |
| Privacy policy | Provided by the owner; Roger's terms and SMS consent wording linked in the footer |
| Live mode | Owner's own domain when they have one; Roger provides one when they don't |
| Google cost | Richer Places fields (attributes, price level) and static maps are approved |
| AI budget | Open while testing |
| Motion | Within the spec's motion budget now; richer motion (scroll effects, parallax) is a later stage |

## How it is built

Roger's code does everything that must be exact; Claude does what needs judgment.

| Step (spec) | Who | Where |
|---|---|---|
| 1. Collect (Places details, crawl ≤25 same-domain pages, menu PDFs, logo, colours) | Roger | `src/sources/*`, research stages |
| 2. Classify the trade (confidence, generic below 0.7) | Roger | `src/splash/classify.ts` ✅ |
| 3. Fact sheet (owner › website › Google, conflicts, never-infer list) | Roger | `src/splash/facts.ts` ✅ |
| Review selection (4–5 stars, verbatim, skip health / named people / complaints) | Roger | `src/splash/reviews.ts` ✅ |
| 4. Screen plan (keep, merge thin, drop) | Roger | `src/splash/screens.ts` ✅ |
| 5. Copy | Claude, within hard limits Roger validates | generator v2 |
| 6. Design (palette, type, layout, photography, motion budget) | Claude, Roger supplies tokens and checks | generator v2 |
| 7. Dock and quote sheet | Roger (identical, tested component) | new |
| 8. Build: meta, OG, JSON-LD, preview ribbon, Google slots, fonts, images | Roger | new |
| 9. Checks, automatic fixes, `needs_human` | Roger | rendered review, extended |

The trade playbook is in `src/splash/playbook.ts`: 33 trades plus a generic fallback, each with its schema.org type,
first-screen answer, main action, dock, standard flow and watch-outs.

## Phases

1. **Foundations** ✅ — playbook, classifier, fact sheet and open questions, review selection, screen planner, with
   tests (`test/splash-plan.test.ts`).
2. **Collect** ✅ — `src/splash/collect.ts`, `extras.ts`, `owner.ts` (`test/splash-collect.test.ts`). Places
   details with every spec field (attributes, price level, current hours, editorial summary, location, Maps URI);
   research reused per listing, or run with a 25-page budget (robots.txt obeyed, menu PDFs read); FAQs, team,
   JSON-LD and social profiles from the stored pages; booking / order / reserve / quote links sorted by where they go;
   the business's claims sorted by kind; text addressed to an AI noted for the owner; an unreachable website noted;
   a non-operational listing stops for a human; owner inputs stored per business (captured from iMessage in phase 7).
   Tried on six real businesses (bakery, restaurant, chiropractor, restoration roofer, Google-only barber,
   service-area plumber): 1–6 s each with saved research.
3. **Google slots** ✅ — `src/splash/slots.ts`. `data-google="rating" | "review_count" | "open_now" | "hours_today" |
   "reviews"` filled from the live listing each time the page is served (nothing stored); a slot with nothing live is
   removed with its attribution; one "· Google Maps" attribution per line; the reviews block carries "Selected
   reviews", the full rating and count, each review verbatim with author, avatar and its Maps link, and how they were
   chosen. Google photos keep the existing verified `data-photo` binding (live, photographer credit on the frame)
   rather than `photo.N` slots.
4. **Generator v2** ✅ — `src/splash/prompt.ts`, `build.ts`, `jobs.ts`, `dock.ts` (`test/splash-build.test.ts`).
   Splash prompt (one page, planned screens in order, copy and design rules, template tells, CSS-only motion budget),
   checked answer with one targeted repair, compiled with the head (title "Name | Category in City", meta, OG,
   canonical in live mode, JSON-LD without ratings), the dock and quote sheet, footer links to the business's own
   pages and the preview strip, then the rendered review at 1440 and 390. Staff routes: `POST /api/studio/splash`
   `{placeId}`, `GET /api/studio/splash/:id`, `GET /api/studio/splash/:id/preview`; public
   `POST /api/splash/:id/quote` (leads stored in "splash-leads"). First real pages (23 Nov): bakery, chiropractor,
   restoration roofer — Opus, $0.25–0.36 and 2½–3 minutes each.
5. **Roger components** ✅ — `src/splash/images.ts`, `fonts.ts` (`test/splash-images.test.ts`, `splash-fonts.test.ts`).
   Website photos served by Roger at the size the screen needs (`/api/splash/<job>/img/<photo>/<width>`: a master of
   at most 2400 px fetched once, the host's own smaller copy asked first for Wix and Squarespace, AVIF / WebP / JPEG by
   what the browser accepts, cached in "splash-images", srcset and sizes on the page; only the job's own photos, only
   public addresses checked on every redirect; a host that resets servers is fetched through the browser, and if Roger
   still cannot fetch it the visitor's browser is sent to the host). Fonts self-hosted (Google Fonts as WOFF2, latin
   and latin-ext, `/api/splash/fonts/<key>.woff2`, inline @font-face with swap, display face preloaded). Quote
   requests take an optional photo (not for health trades): shrunk on the phone, re-encoded without camera metadata,
   stored in "splash-lead-photos". Directions open Apple Maps on Apple devices. Services link to their own pages.
6. **Checks** ✅ — `src/splash/qa.ts`: the spec's Step 9 as `{passed, fixed, needs_human}`, run at the end of every
   job and served with the page by `GET /api/studio/splash/:id/output` (the spec's output JSON). In the served HTML:
   every fact from the fact sheet, no stock images, reviews and Google attribution, phone links, JSON-LD and noindex,
   watch-outs, focus styles, reduced transparency. In a browser: the first screen at 390 x 844 (what, where, the
   trade's key answer, the main action), JavaScript off, reduced motion, layout shift at 390 and 1440, dock targets of
   44 px. Every link-out is fetched: a dead link to the business's own page is removed (fixed), a dead action link goes
   to needs_human. The rendered review's problems and accessibility notes are folded in. The generator's checks now
   also refuse superlatives and claims the business never stated (24/7, free estimates, licences, warranties…).
7. **Integration** ✅ — splash jobs run like custom-site generations: queued by web functions and claimed once by the
   worker in the beta (`runQueuedSplashJobs`), a heartbeat every 30 s, a stopped job recovered once (a page already made
   only has its checks run again; one stopped twice fails). The iMessage intake makes splash pages when
   `ROGER_INTAKE_PAGE=splash` (default: the custom full site, unchanged; a run keeps its kind): a page whose checks
   found wrong or non-compliant content is never sent; notes for staff never hold a link back. After the first link
   Roger asks the plan's questions one at a time ("Skip" to skip); answers are kept as owner facts (the top source);
   "Update my page" makes a new version from the page last sent, keeping its design with the new facts (no AI when the
   design still fits). Quote and appointment requests go to the owner's conversation and to the Roger dashboard
   (`/app/leads.html`); a photo reaches the owner by an unguessable link. The New site page makes splash pages (the
   default) or full websites, with the checks as passed / fixed / for staff. `/v/sp_…` serves a sent splash page.
8. **Live mode** — serving at the root of the owner's domain (or a Roger-provided one), canonical, no Roger branding.

The splash generator is built behind a switch beside the current one and compared on the same businesses before the
beta changes over.

## Known constraints

- Google photos can't be stored, so they can't be re-encoded to AVIF/WebP; they are served live at sized widths.
- Google returns at most 5 reviews and 10 photos; after selection, Proof is often merged rather than a full screen.
- With JavaScript off, a map is a static Google map image or a Google Maps link.
- The Roger-answered number (voice agent) does not exist yet; the dock uses the business phone until it does.
- Later motion work (scroll effects, parallax) must keep the page readable with JavaScript off and honour reduced
  motion; the spec's 30 KB, no-framework script budget will need revisiting for Framer Motion.
