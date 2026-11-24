# Roger — platform, design and operations

The complete reference for how Roger works today: what customers and staff see, how a site is made, the design
principles and rules behind every generated site, the checks and repairs, and the infrastructure that runs it.

Status as of 18 Nov 2026: the custom full-site generator runs in an invite-only **beta** on Vercel
(`https://roger-beta-five.vercel.app`, Hobby plan, internal testing only). Production Roger (the older theme-based
builder) is separate and unchanged.

---

## Contents

1. [What Roger is](#1-what-roger-is)
2. [Surfaces at a glance](#2-surfaces-at-a-glance)
3. [How a site gets made](#3-how-a-site-gets-made)
4. [Design aesthetics: the generated sites](#4-design-aesthetics-the-generated-sites)
5. [Checks, repairs and delivery](#5-checks-repairs-and-delivery)
6. [Design aesthetics: the staff app](#6-design-aesthetics-the-staff-app)
7. [Roger's voice](#7-rogers-voice)
8. [Platform and infrastructure](#8-platform-and-infrastructure)
9. [Access and security](#9-access-and-security)
10. [Costs and limits](#10-costs-and-limits)
11. [Data and compliance](#11-data-and-compliance)
12. [Known gaps](#12-known-gaps)
13. [Repository map](#13-repository-map)
14. [Glossary](#14-glossary)

---

## 1. What Roger is

Roger builds free website previews for local businesses. A business owner texts Roger (iMessage), Roger finds the
business's Google listing, researches it, and writes a custom, multi-page website for that one business. The owner
gets a private preview link and can approve it or ask for another version.

Two ideas run through everything:

- **No templates.** Each site's design comes from a visual idea found in that business's own material (its photos,
  its trade, its story). There is no theme library, section recipe or fixed grid in the custom generator.
- **Only verified facts.** Every address, hour, phone number, rating and offering on a site comes from a checked
  source and is inserted by Roger, not typed by the AI. What is not known stays off the page.

---

## 2. Surfaces at a glance

| Surface | Who | Address | What it does |
|---|---|---|---|
| iMessage conversation | Business owner | real gateway (later); simulator now | Finds the business, confirms it, sends the preview link |
| Custom simulator | Staff, invited testers | `/imessage/?intake=custom` | iPhone-style stand-in for iMessage; testers need an invite link |
| **New site** | Staff | `/app/frontend.html` | Find business → Review sources and audit → Generate and preview |
| **Reviews** | Staff | `/app/imessage-reviews.html` | Every customer conversation, its versions, checks, costs and actions |
| Invites | Staff | `/app/imessage-reviews.html#invites` | Create and revoke tester invite links (with spend and job limits) |
| Customer preview | Business owner | `/v/<version id>` | The private preview link the customer receives (all pages) |
| Listing cards | Anyone with the link | `/cards/<id>/` | Share page per Google listing (opens the listing in Google Maps) |
| Old Studio / builder | Staff (production only) | `/app/` outside the beta | The earlier theme-based builder; turned off in the beta |

---

## 3. How a site gets made

### 3.1 Finding the business (the conversation)

The customer can send a name, a name and a place, an address, or a Google Maps link, in any order and across several
messages. Roger combines what it is told into one lookup.

| Customer sends | Roger does |
|---|---|
| A name alone ("Corner Taqueria") | Shows up to **three listing cards** whose names are similar (closest first). Each card has the listing's live Google photo (credited), name, address and rating; tapping it opens the listing in Google Maps; **"This is my business"** chooses it. None similar: asks "Where is …?" |
| Name and place ("Corner Taqueria, Austin TX") | Strict lookup; offers the matching listing as a card: "Is this your business?" |
| Name, then a street address | Keeps the name, adds the address, one lookup for both |
| An address alone | Never treated as the business. Holds the address and asks for the name |
| A postal code that differs from the listing's | Says which code the listing has ("its listing has the postal code 54000, not 56400") so one reply fixes it |
| A corrected name when asked "Where is it?" | Looks it up as the name (a place it can't recognise is still taken as the location) |
| A Google Maps link | Uses that exact listing |
| "Yes" when nothing is on offer | "I don't have a listing for you to confirm yet" — nothing starts |

**Matching rules (a listing is offered only when all hold):**

- its name is the business's name (not just a shared word: similarity ≥ 0.85, or ≥ 0.6 for the pick-list);
- it is not **named after an address** ("645 Imperial Block 1", a pinned plot);
- its address agrees with what was given: street number and street, postal code, town (each only when given);
- a "yes" is checked again against these rules before anything starts.

Google returning a listing is never evidence by itself; nearby listings are never offered in place of the business.

### 3.2 Research

Once the customer confirms the listing, Roger checks the website (the customer's link, or the one on the listing)
against the listing, then researches the business. A saved brief for the **same Google listing** is reused instead
of new research.

Research stages: `identity` → `page_inventory` → `crawl` → `documents` → `assets` → `brand` → `brief` → `qa`.

The result is a **brief**: every fact with its status (`verified` / `unknown`) and source, the business's own words
and offerings, photos (website and Google listing), brand colours and fonts if known, unknowns, and questions for the
owner. If a website leads research to a different listing than the confirmed one, the research is not used.

### 3.3 The media gate (photos)

Rule-based, no AI call, the same verdict every time for the same evidence:

- **Withheld:** before-and-after body imagery, selfies and portraits of identifiable people, and pictures that suggest
  a facility or outcome the business's own text does not state (e.g. a kids' area at a gym that never mentions one).
- **Staff review:** a photo whose subject is uncertain or is mainly a person.
- Withheld photos are recorded on the version and can never reappear in a later edit.

### 3.4 Generation

One AI generation writes the homepage (HTML and CSS) from the brief; a second writes the inner pages in the same
visual language. Each may get one targeted repair when a validator finds a problem; it never regenerates blindly.
**Cap: $2 of AI cost per site.**

Inner pages are chosen from the content the business actually has (at most four, in this order):

| Page | Made when |
|---|---|
| Services or Menu | the business lists at least 4 offerings (Menu when items outnumber services) |
| About | it has its own story, or at least 4 of its own lines |
| Photos | it has at least 6 checked photos |
| Visit | always (shows only the visit facts that exist) |

### 3.5 Compilation (how facts, photos and links get in)

The AI never types facts. It marks places in its HTML and Roger fills them:

| Binding | Roger inserts |
|---|---|
| `data-fact="address"` (hours, phone, rating, name, story, each offering) | the exact verified text |
| `<a data-action="…">` | the verified destination **and** label (directions, call, reviews) |
| `<img data-photo="…">` | the verified image; for Google photos, the photographer credit |
| `<a data-page="…">` | the version's own page addresses |
| `<img data-logo>` | the verified logo |

The compiler rejects scripts, forms, inline styles, external resources, unknown photos and links to pages that don't
exist. Every page links every page.

**Pipeline revisions.** Each version records the rules it was made under; a saved version always renders the same.

| Rev | Adds |
|---|---|
| 1 | the original compiler and copy rules |
| 2 | photos take the shape of their CSS frame and their credit sits inside it; copy may not infer ownership, membership, results, amenities, classes or trainers; the media gate runs before writing |
| 3 | copy may not refer to a page the site does not have |
| 4 | layout guards: page parts clip sideways overflow; a box that scrolls Google photos sideways is rewritten to wrap |

---

## 4. Design aesthetics: the generated sites

### 4.1 Principles

1. **One idea per business, found in its own material.** Before coding, the generator decides what this business
   should say first, what makes it credible, and which of its photos can carry the idea. The idea is written down
   with every version ("Design idea: …").
2. **Not a template.** No default hero height, no required section count, no split-hero-then-bands pattern. The
   generator is told not to imitate earlier Roger layouts; recent ideas are passed in so it doesn't repeat them.
3. **A real desktop and a real phone design** — not a desktop layout squeezed down. Every page is reviewed at
   1440px and 390px.
4. **Photos have jobs.** The hero photo is chosen by subject, size and fit, not list order. Photos sit beside an
   offering only when they explain it. No generic image grid just because pictures exist. With no verified photos the
   design is confidently type-led.
5. **Facts are visit information, not headlines.** An address is never the marketing line.
6. **Brand colours are preserved when known**; typography is free (up to three Google Fonts). With no known brand,
   the generator proposes a palette that suits the business.

### 4.2 What the ideas look like (examples, anonymised)

- A roofing contractor: *"Laid in courses"* — each section is a course of shingle with tabs overhanging the next,
  CSS counters label the courses, a chalk line snapped across the hero, an asphalt/felt/copper palette.
- A barber shop open late: *"The station mirror after dark"* — photos in arched, round and oval mirror frames ringed
  with bulb dots on a night-ink wall; hours as a morning-to-midnight sky bar.
- A plumbing, heating and electrical firm: *"The utility-room wall"* — a supply pipe wraps the hero photo, services
  drawn as a breaker panel with labelled circuits on label tape.
- A bakery: *"A vintage bakeshop storefront"* — striped scalloped awning, an arched shop window for the widest
  photo, an order-slip ticket with the rating and hours, a letterboard for the baked goods.

### 4.3 Copy rules

- Original, natural draft copy grounded in the supplied facts; welcoming language and section labels are fine.
- Never invent services, facilities, prices, offers, achievements, reviews, schedules or promises; no awards or dated
  promotions unless verified; no undated seasonal promotions. A neutral holiday-hours caveat beside verified hours is
  allowed.
- **No digits in Roger's own words** (no "01/02", ordinals, years). Lists are numbered with CSS counters; every number
  comes through a fact binding.
- A photo shows what is in it, nothing more. Google listing photos are customers' photos: copy never calls them the
  business's own, never calls people "members", never mentions membership, results, amenities, classes, coaches or
  trainers unless the business's own text does.
- Only listed pages exist ("see our menu page" is refused when there is no menu page).
- All new wording is a draft: the owner reviews it before anything is published.

### 4.4 Photo and layout rules

- A Google photo's credit has links, so a photo is never inside a link.
- To shape a photo, put the image alone in its own frame and shape the frame; captions go outside the frame.
- Masks and clip paths are for decoration only — never on anything holding a photo, name, offering, text or action.
  Round or arched photo frames are fine when the subject stays visible.
- Every photo and its credit is fully in view at 1440 and 390 without sideways scrolling: no horizontal photo strips
  or carousels; photo grids wrap.
- Nothing may make the page wider than the window: bleeding, rotated or oversized decorations sit inside a section
  that clips them.

### 4.5 Accessibility rules

Semantic header/main/footer, exactly one `h1`, logical headings, visible keyboard focus, readable contrast and type,
reduced-motion support for any animation, a working mobile menu (native `details/summary`), no scripts. The review
checks these (see 5.1); contrast, heading order and tap-target size are reported for staff.

---

## 5. Checks, repairs and delivery

### 5.1 The rendered review

Every page of every version opens in a real browser at **1440px and 390px**.

| Check | Blocking? |
|---|---|
| Each Google photo's credit has text, is displayed, sits inside the photo's visible frame (or directly under it when moved), and is not covered | Blocking |
| The photo itself is visible | Blocking |
| No sideways scroll; no text running past the window's edge | Blocking |
| No broken images, no page errors, the version's identity on the page | Blocking |
| Links go only to this version's pages, page anchors, https, tel: or mailto:; every link and image has a name/alt; one `h1`; page language | Blocking |
| A mask or clip path hiding essential content | Blocking |
| Text covered by a photo | Blocking |
| Contrast under WCAG AA, skipped heading levels, tap targets under 24px on a phone | Staff note |

### 5.2 Pre-send rules

- **Blocking only when the output would be wrong, non-compliant or broken:** words referring to a page that doesn't
  exist; any failed check above; a homepage-only result; a failed generation.
- **Never blocking (staff notes):** a missing address or hours (a service-area business hides its address), a fact
  not shown, contrast and tap sizes, photos for staff review, moved credits, and "copy is Claude's draft".

> Rule of thumb: a gap in the listing's facts never stops a preview; it is fixed over time.

### 5.3 Automatic repairs (no new generation, no cost)

| Problem | Repair |
|---|---|
| A decoration wider than the page (rotated line, bleed band) | The page's top-level parts clip sideways overflow (rev 4) |
| Google photos in a sideways-scrolling strip | The strip's rules are rewritten in place to wrap (same selector, same media query) (rev 4) |
| A credit the design's frame hides (round/oval frame cuts the corner, an overlay covers it) | That photo's credit becomes a caption just below the photo, above any overlay; the checks run once more |
| The server restarts mid-homepage | Started again **once**; a second interruption is held for staff |
| Inner pages fail after an accepted homepage | Staff can retry the inner pages once, reusing the homepage |

### 5.4 Delivery

- A version that passes every blocking check is **sent to the customer automatically** — no staff step. Staff notes
  never hold a link back.
- One version at a time per conversation; each customer gets each link once.
- The customer can **Approve and publish** (recorded; nothing is published yet) or **Request another version**.
- A failed version tells the customer plainly and offers "try again"; staff see the reason, and can run the checks
  again (no new generation), retry inner pages, or reject.

---

## 6. Design aesthetics: the staff app

The staff pages (New site, Reviews, Invites) share the **Roger Studio** look.

### 6.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F6F9` | page background |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F8FAFC` | cards / quiet panels, locked stages |
| `--ink` / `--ink-2` / `--muted` | `#0F172A` / `#334155` / `#64748B` | text levels |
| `--line` / `--line-2` | `#E5E7EB` / `#CBD5E1` | borders, input borders |
| `--accent` / `--accent-600` / `--accent-50` / `--accent-100` | `#2563EB` / `#1D4ED8` / `#EFF6FF` / `#DBEAFE` | actions, current step, focus |
| `--ok` · `--warn` · `--bad` (+ tints) | `#15803D` · `#B45309` · `#B91C1C` | passed / to check / blocking |
| Radius | 14px cards, 10px controls, 99px pills | |
| Shadow | `0 1px 2px rgba(15,23,42,.04), 0 6px 20px -10px rgba(15,23,42,.14)` | cards |
| Type | Inter (system fallbacks), 14px base, 15–17px headings | |

### 6.2 Components and patterns

- **Top bar:** dark "R" logo tile, "Roger Studio" + page subtitle, staff navigation (New site · Reviews · Invites ·
  Custom simulator), sticky.
- **Steps:** numbered pills (current = blue, done = green, locked = grey); locked stages render as quiet panels.
- **Business cards:** name, full address, category, website status, rating, Place ID, "Select this business", "Open
  in Google Maps". Nothing is ever pre-selected.
- **Tags:** "Current website" (grey) for the audit of the site the business has now; "New website preview" (blue) for
  Roger's output — never confused.
- **Accordions (Reviews):** a business closed shows latest status, versions, sent, total cost, total time; a version
  closed shows status, cost, time, attempts and checks. What needs attention opens by default; staff choices persist.
- **States:** every step has empty, loading (spinner line), error (red line or alert) and cancelled ("Stopped
  watching — the job keeps running") states.
- **Previews:** Desktop · 1440 (true width, scrolls in its box on narrow screens) and Phone · 390.
- **Accessibility:** 40–44px controls, visible focus rings, `aria-live` status lines, reduced motion respected, no
  sideways scroll at 390px.

### 6.3 Customer-facing conversation UI (simulator)

iMessage look: grey incoming bubbles, blue outgoing, quick-reply buttons under the latest message, rich link cards
(image, title, second line, host). Listing cards carry a "This is my business" button in the simulator; a real
iMessage gateway uses the quick replies instead.

---

## 7. Roger's voice

Roger speaks for himself, in the first person, plainly. He never mentions "our team" or the internal review.

- "Hi, I'm Roger! I build free website previews for local businesses, so you can see what a better site would look
  like before you spend anything."
- "I found 3 listings on Google for Corner Taqueria. Which one is yours?"
- "Thanks! I'm researching your business and building your website preview. I'll check it and send the link here
  when it's ready. This may take a few minutes."
- "I couldn't confirm that example.com is Corner Taqueria's website, so I'll build from your Google listing."
- "Sorry, I couldn't finish your preview this time. Reply "try again" and I'll build a new one."

---

## 8. Platform and infrastructure

### 8.1 Stack

- **App:** Node.js + TypeScript (run with `tsx`), Express server (`src/server.ts`), static staff pages in
  `public/app/`, simulator in `public/imessage/`.
- **AI:** Claude (Anthropic API on Vercel; the signed-in Claude Code CLI locally). Model per config.
- **Google:** Places API (New) for search, details and live photos; PageSpeed via the Maps key where allowed.
- **Browser:** Playwright with Chromium for the rendered review, audits and screenshots.

### 8.2 Beta on Vercel

| Piece | Setup |
|---|---|
| Web | Vercel service from `src/server.ts` (functions, 300 s limit on Hobby) |
| Worker | Vercel **daemon** `worker` from `Dockerfile.worker` (`node --import tsx src/worker.ts`), 2 GiB, 1 instance (iad1), 30-minute grace on stop, liveness `:1234/health` |
| Storage | Supabase, namespaced per environment (`ROGER_STORE_NAMESPACE=beta` → `beta:<collection>`, files under `beta/`) |
| Config | `vercel.beta.json` (copied as `vercel.json` in a clean staging copy at deploy time) |

The web functions hand generation, rechecks and resumes to the worker. Jobs are claimed atomically (one runner per
job), send a heartbeat every 30 s, and are recovered when the heartbeat is older than 2 minutes. Conversations
change in one process at a time under a shared lock.

### 8.3 Local development

`npm run dev` (watch mode, port 4000). Watch mode restarts the server on code changes, which interrupts a running
build (a homepage restarts once). Data lives in `data/` and builds in `out/` (both git-ignored). `npm test` runs the
full suite (unit, route and real-browser tests).

### 8.4 Deploying the beta

1. Copy the repo to a fresh staging folder, excluding `node_modules`, `data`, `out`, `.env*`, `.vercel`, `.git`.
2. Copy `vercel.beta.json` to `vercel.json` and add the roger-beta project link.
3. `vercel deploy --prod` with the project token, in the team scope.

Never link the main repo folder to the beta project (it is linked to production).

---

## 9. Access and security

- **Staff:** HTTP Basic login (`STUDIO_PASSWORD`). Staff pages and their API calls answer with the login challenge,
  so the browser sends the login it already holds. The beta refuses to run without a staff password.
- **Testers:** private invite links (tokens stored only as hashes), each with its own limits. The simulator's own
  calls are refused plainly (no password box) without a valid invite.
- **Public:** customer preview links (`/v/…`), listing cards, generated assets, health check.
- **Beta allow-list:** only the beta's own pages and APIs are served; the old Studio returns 404 there.
- Customer links are only ever built on the public HTTPS address (never localhost) in the beta and on Vercel.

---

## 10. Costs and limits

| Item | Value |
|---|---|
| AI generation cap | $2 per site (homepage + inner pages + repairs) |
| Research | time recorded; AI cost not recorded per job |
| Beta invite (defaults) | $6 AI spend, 2 businesses, 3 versions per business |
| Beta daily cap | $25 AI spend across all invites |
| Reserves while a job runs | $0.25 research, $1.50 version |
| Typical version | about $0.6–1.1 and 4–8 minutes |
| Vercel Hobby | internal testing only; daemon quota ≈ 5 CPU-hours and 420 GB-hours a month |

---

## 11. Data and compliance

- **Google listing photos are never stored.** Pages request them live through `/gphoto/…` (a redirect to Google's
  current image), and every photo shows its photographer's credit with links. A photo whose credit cannot be shown is
  withheld or blocks the version.
- Only Google **place IDs** are kept long-term; listing content stays in the private data store.
- The repository is public: no secrets, `.env*` or `data/` are committed; tests use synthetic businesses only.
- Every generated preview is noindex and private until a publication step exists.

---

## 12. Known gaps

- No desktop/phone screenshots of a business's **current** website (open it instead).
- Research and generation jobs can't be cancelled; staff can only stop watching.
- Research AI cost isn't recorded per job.
- Research can't pin a confirmed listing and a corrected website together (it checks the result and offers
  "research from the listing only").
- No send/approve action for versions made on the New site page (they have no customer conversation).
- Publishing a customer's approved site is not built yet; approval is recorded only.
- Descriptive searches ("hair salon Paragon City") don't list nearby businesses unless a name is similar.

---

## 13. Repository map

| Area | Files |
|---|---|
| Conversation (custom intake) | `src/imessage/custom-flow.ts`, `src/imessage/custom-intake.ts`, `src/imessage/flow.ts`, `src/imessage/cards.ts` |
| Business lookup | `src/studio/resolve-business.ts`, `src/sources/places.ts`, `src/sources/identity.ts` |
| Research and brief | `src/studio/jobs.ts`, `src/studio/stages.ts`, `src/studio/brief.ts` |
| Generator | `src/studio/frontend/page.ts` (prompt, compiler, rules), `site.ts` (inner pages), `jobs.ts` (jobs, checks, repairs) |
| Media gate | `src/studio/frontend/media-gate.ts` |
| Layout guards | `src/studio/frontend/layout-guard.ts` |
| Rendered review | `src/studio/frontend/review.ts` |
| Live Google content | `src/sources/google-live.ts`, `src/studio/concepts/listing-photos.ts` |
| Beta, invites, caps | `src/beta.ts`, `src/config.ts` |
| Worker | `src/worker.ts`, `Dockerfile.worker`, `vercel.beta.json` |
| Storage | `src/store.ts`, `src/remote.ts`, `src/supabase.ts` |
| Staff pages | `public/app/frontend.*` (New site), `public/app/imessage-reviews.*` (Reviews, Invites) |
| Simulator | `public/imessage/` |
| Earlier docs | `docs/custom-frontend-pilot.md`, `docs/design-directions.md` (legacy theme-based builder), `docs/photo-handling-audit.md`, `docs/studio-*.md` |

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Brief | The researched record of a business: verified facts, sources, photos, unknowns |
| Version | One generated site for a business (homepage + inner pages), with its own link and checks |
| Pipeline revision | The rule set a version was made under (1–4); saved versions keep theirs |
| Binding | A marker in the generated HTML that Roger fills with a verified fact, action, photo, page link or logo |
| Credit | The photographer attribution shown on every Google listing photo |
| Media gate | The rule-based photo filter that withholds or flags photos before writing |
| Rendered review | The real-browser check of every page at 1440 and 390 |
| Blocking problem | Something that stops a version reaching the customer (wrong, non-compliant or broken) |
| Staff note | Something to check later; never stops a preview |
| Service-area business | A business that hides its address on Google; its site shows no address |
| Invite | A tester's private simulator link with spend and job limits |
