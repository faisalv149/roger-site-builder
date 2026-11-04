# Design studio, phase 1: business brief

Phase 1 reads a business, from its website or its Google Business Profile, into two versioned documents. Phase 2 will design from these documents:

- **SiteInventory** (`roger.site-inventory`, v2): what Roger read. It covers every page found, what was done with each and why, what each page holds, and the relationships between pages and assets.
- **BusinessBrief** (`roger.business-brief`, v2): what Roger knows. Each fact carries its sources and a confidence. The brief also records conflicts between sources, what is unknown, and the questions the owner must answer.

Both routes produce the same two documents. Whatever a route could not see is marked `unknown` with an owner question. It is never filled in.

The schemas are zod definitions in `src/studio/schema.ts`. Version 2 adds linked PDFs (`inventory.documents`, `brief.offerings`), conflict candidates (`Fact.candidates`, `callsToAction.held`, `locations.primaryId`) and the single picture count (`inventory.assetSummary`).

## Pipeline

A job runs eight resumable stages (`src/studio/jobs.ts`, `src/studio/stages.ts`):

| Stage | What it does | Saved |
|---|---|---|
| `identity` | **Website route:** reads the home page, then looks the business up on Google using what the site says (name with town, ZIP, phone). The listing must match the site (`matchCandidate`). **Google route:** resolves the link or address to a listing; if the listing names a website, reads it and holds the listing to it. | identity status and evidence, rejected candidates, listing facts (no review text, photo references only) |
| `page_inventory` | Reads robots.txt (disallow rules, Sitemap lines) and the sitemaps, including indexes. Collects the home page's menu and links. Classifies each address: skipped files, accounts, archives, robots-disallowed pages, legal pages and posts beyond the first three are recorded with a reason. Applies the page budget (`STUDIO_MAX_PAGES`, default 20) and depth (`STUDIO_MAX_DEPTH`, default 2) by priority: services and locations first. | every discovered address with how it was found and the decision |
| `crawl` | Fetches the chosen pages two at a time. Retries on reset, 429 or 5xx (3 tries with backoff); a 404 is final. Pages that are mostly script are read again in a browser (`STUDIO_MAX_RENDERS`, default 3). Links found on read pages are added up to the depth limit. Linked stylesheets are fetched once each. | each page's status, HTTP status, attempts and error; bodies stored by sha256 |
| `documents` | Reads linked PDFs that say what the business sells or costs (menus, price lists, service brochures), within a budget: `STUDIO_MAX_PDFS` (4) documents, `STUDIO_MAX_PDF_BYTES` (25 MB) each, `STUDIO_MAX_PDF_PAGES` (12) pages each, `STUDIO_MAX_OCR_PAGES` (6) OCR pages per job. Each page is read from its text layer; a page with no usable text (a scan, or a decorative font whose glyphs carry no letters) is read by OCR (Tesseract, English model shipped in `node_modules`; `STUDIO_OCR=0` turns it off). Every PDF found is recorded, read or not, with the reason (budget, size, HTTP error, not a PDF, unreadable, not a business document). | per document: status, reason, attempts, bytes, sha256, pages and how each was read, OCR confidence; the extraction stored by hash |
| `assets` | Downloads up to `STUDIO_MAX_ASSETS` (40) website pictures: service-card pictures first, then hero, then content. Icons and badges are recognised by file name and not downloaded. Measures size, format and sha256, detects artwork, and computes a perceptual hash. Google photos are recorded as references only. | one probe per picture |
| `brand` | Probes the logo candidates (size, dominant colours). Measures colours, buttons and type in a browser when one is available. | raw measurement and logo probes |
| `brief` | Saves the **source snapshot**, builds the inventory and brief from it, adds the cached AI summary, and saves the revision. | snapshot, brief, inventory, revision index |
| `qa` | Checks the schemas, rebuilds from the snapshot and compares hashes, then reports coverage, identity, services, conflicts, unknowns, picture rights and provenance. | QA report on the job |

### Interruption and resume

- After every page and picture, the job saves its work. A stopped job continues from its first unfinished stage, and the crawl does not fetch pages it already has.
- On start-up the server resumes jobs that have gone quiet (`resumeInterruptedJobs`). A stopped or failed job can also be resumed with `POST /api/studio/jobs/:id/resume`.
- Production needs a worker instead of in-process runs: see `docs/studio-worker-migration.md`.

## Linked PDFs

- `src/studio/pdf.ts` reads the PDF (mupdf), and `itemsFromPdf` turns its text-layer pages into items. Lines set larger than the body text are item names. A size used only once or twice per page, larger still, is a section title. Running headers and page numbers in the page margins are dropped.
- **List pages:** an item's own lines give its price, tags and description. The price is `verified`.
- **Poster grids** (names in three or more columns): a name takes the price printed above it in its own tile. The price is `needs_review`, because it is tied by layout.
- **Merging:** items are merged by name across documents. When two documents print different amounts for an item, its price is `needs_review` and both are named.
- **OCR is evidence only.** It never makes an item. An OCR-only document gives no items, and the QA `offerings` check fails any item without a read document behind it.
- **Allergen and nutrition lists** are read and recorded, but give no items.
- **The owner question:** when items are found, `q-offerings` asks the owner to confirm that the menu is current. It is blocking while any price needs a check.

## Conflicts

When the website and the Google listing disagree on the main phone number or on the location, no value is chosen:

- The fact's `value` is `null` and its status is `conflicting`. `candidates` lists every value with its sources, and `questionId` names the blocking owner question.
- A call button for a disputed number, or a directions link to a disputed place, is moved to `callsToAction.held` until the owner answers.
- `locations.primaryId` is `null` while the location is disputed. Several website addresses with no listing are treated the same way (status `needs_review`): Roger does not pick a main location.
- QA `disputed` fails if a disputed fact has a value, a public call button uses a disputed number, or a main location is chosen while the address is disputed.

## One count of pictures

- `inventory.assetSummary` is the only count of pictures. It records how each was examined (downloaded, download failed, judged by file name, judged by its role such as a logo, over the download budget) and how it came out (usable, graphic, icon, map, undersized, duplicate, broken, not measured).
- Both breakdowns add up to the same total. The brief (`assets.website.usable` / `total`), the reports (`src/studio/report.ts`: `coverageReport`, `summaryTable`), the UI and the job notes all read that summary.
- Stage notes describe what the stage did ("downloaded 31 pictures (9 downloads failed)"), not outcomes. QA `counts` fails if any of these disagree.

## Determinism

- **The snapshot holds everything.** The inventory and brief are built by `buildFromSnapshot` in `src/studio/brief.ts`, from the snapshot alone: no network, no clock, no model. The snapshot contains the page bodies (by hash), the PDF extractions (by hash), the listing facts, the asset probes and the brand measurement. OCR runs while fetching, never while building, so a rebuild does not depend on the OCR engine.
- **Same snapshot, same documents.** Running it again gives identical documents. `briefHash` is the sha256 of the brief's content, excluding its revision, snapshot id, capture time and the AI summary.
- **Revisions follow content.** A new revision is saved only when that hash changes. A rerun whose new snapshot says the same thing keeps the same revision.
- **The AI summary is cached and checked.** It is cached per snapshot and prompt version (`studio-ai`), so a rerun gets the same words. It is checked against the evidence and dropped if it adds facts. It is never used for the service inventory, which comes only from what the business shows: home-page cards, menu entries, and service pages with their own heading.

## Provenance and rights

- Every stated fact has `sources` (a page URL with a locator, or `google:<placeId>`), a `confidence`, and a `status`: `verified`, `conflicting`, `needs_review` or `unknown`. QA fails any stated fact that has no source.
- Website pictures are `unconfirmed` until the owner confirms them.
- Google listing photos are `google-restricted`: preview only and credited. They are kept apart from the owner's pictures. Google review text is not stored; only the rating and count are.

## API and UI

- **API** (`src/studio/routes.ts`, mounted at `/api/studio`):
  - `POST /jobs {website}|{google}` returns 202 and a job id immediately.
  - `GET /jobs/:id` returns the job with its stages, progress, notes and errors.
  - `POST /jobs/:id/resume` continues a stopped or failed job.
  - `POST /jobs/:id/rebuild` makes a new job from the same snapshot, with nothing fetched.
  - `GET /briefs/:businessKey[?revision=n]` and `GET /snapshots/:id` return saved documents.
- **Studio page:** `/app/brief.html` (linked as "Business brief" in the Studio header). It starts a job, shows live stage progress and failures, and then shows the brief: facts, conflicts, owner questions, services, pages, brand, pictures and QA.
- **Command line:** `npx tsx scripts/studio-brief.ts --website <url>|--google "<name, address>"|--rebuild <jobId> --out <dir>` writes `brief.json`, `inventory.json`, `job.json`, `coverage.md`, `conflicts.md` and `offerings.md`.

## Files

- **New:**
  - `src/studio/`: `schema.ts`, `snapshot.ts`, `discover.ts`, `extract.ts`, `address.ts`, `stages.ts`, `brief.ts`, `summary.ts`, `qa.ts`, `jobs.ts`, `routes.ts`, `report.ts`.
  - `public/app/brief.html` and `public/app/brief.js`.
  - `scripts/studio-brief.ts`.
  - `src/studio/pdf.ts`.
  - `test/studio.test.ts`, `test/studio-documents.test.ts`.
- **Changed:**
  - `src/store.ts`: studio collections and `studioDocs`.
  - `src/server.ts`: routes, and resume on start-up.
  - `src/sources/website.ts`: shared `logoCandidatesOf`, `colorsFromCss` and `fontsFromCss`.
  - `src/sources/crawl.ts`: exports `summarisePage`.
  - `src/sources/site-content.ts`: exports `ldNodes` and `platformOf`; a logo's alt text "X logo" now names X.
  - `src/sources/site-images.ts`: exports `fingerprint`.
  - `src/design/image-fit.ts`: thumbnail sizes in file names count as icons.
  - `public/app/index.html`: header link.
  - `src/util/http.ts`: `FetchResult.truncated` when a body is cut off at the size limit.
  - `package.json`: `mupdf`, `tesseract.js`, `@tesseract.js-data/eng`.
