# SEO, owner review and publishing

## Pages (SitePlan)

`src/design/siteplan.ts` decides one page or several from the business's content (see [page-families.md](page-families.md#pages-siteplan)). The plan is versioned (`SITE_PLAN_VERSION`), stored on the draft, and kept stable across edits. Owner choices (single or multi-page, per-page title, description and "hide from search") are overrides on top of it. Removed routes become permanent redirects. Every page has a unique title and description, a canonical URL, crawlable `<a href>` navigation, and the site has a real `404.html` (the server answers unknown paths with status 404).

## Preview vs published

| | Preview (`/sites/<slug>/`, owner editor) | Published |
|---|---|---|
| Robots | `noindex, nofollow` | indexable |
| `robots.txt` | disallows all | `Allow: /` + sitemap line |
| `sitemap.xml` | none | indexable pages only |
| Canonical | the Roger preview origin | the **primary origin** |
| Google photos and review text | shown, with credit | not published; a "Read our reviews on Google" link instead |
| Sample content | shown | blocks publishing |

Source: `src/seo.ts` (one config for titles, descriptions, canonicals, robots, sitemap, JSON-LD and checks) and `src/site-render.ts`.

## Owner review ("Business details")

Each fact (name, phone, address, hours, claims such as licensed or years in business, offerings, prices, about text) carries **provenance** (`google`, `website`, `claude`, `owner`, `sample`) that is kept separate from its **review state** (`unreviewed`, `confirmed`, `corrected`, `omitted`). A review is bound to a hash of the value: if the value changes the confirmation lapses. Colour and layout changes never need re-approval. Sample (mock) values cannot be confirmed. The name can't be omitted.

Photos and logo have a Media area: upload (JPEG, PNG or WebP, read from the file, at least 300×200, EXIF dropped), replace, omit, focal point, alt text and role. Google photos are previewed with credit and are not published.

`publishReadiness` (`src/design/content.ts`) lists blockers; `publishSite` enforces it **on the server**, including Studio's publish button (HTTP 422 with `blockers`). Sites built before this review existed cannot be published until rebuilt.

## Primary origin and domain change

- Publishing uses an immutable `out/publish/<slug>/r<rev>` copy and a Vercel deployment.
- `setPrimaryDomain(slug, domain)` only switches after the provider reports the domain verified **and** the new address answers 200. It then regenerates canonicals, sitemap and robots for the new origin and writes permanent (308) redirects from the old origin, including host-based redirects for the previous domains.
- The simulated domain step in the customer flow never changes the real origin, indexing or canonicals.

## Structured data

JSON-LD is built from confirmed facts only: the specific LocalBusiness subtype for the category (`Plumber`, `HairSalon`, `Restaurant`, …), an address only when it is visible on the page, `OfferCatalog` only for non-sample priced offerings, `Service` on offering pages, `BreadcrumbList` on inner pages. There is no `aggregateRating` (self-serving reviews are not eligible) and nothing invented. Example output: `out/qa/release/examples/README.md` (`npm run qa:seo-examples`).

## Scores

`src/rescore.ts` records each Lighthouse result with the revision, URL, device, tool and time. A save queues a debounced (`RESCORE_DEBOUNCE_MS`, default 20 s) background run; the editor shows the current revision's result or labels an older one "previous". `RESCORE=0` disables it. Lab results (Lighthouse here, PageSpeed Insights for public URLs) are labelled separately from field data, which exists only for public pages with enough Chrome traffic.

## After the site is live: Search Console

1. Add the primary domain as a property in Google Search Console (a Domain property verifies by DNS, a URL-prefix property by an HTML tag or file).
2. Submit `https://<primary>/sitemap.xml` under Sitemaps.
3. Use URL Inspection on the home page, then "Request indexing". Indexing is not instant or guaranteed.
4. After a domain change, add the new property and submit its sitemap; the old origin's 308 redirects pass visitors and signals on.

Roger does not claim a ranking outcome; it makes the site crawlable, consistent and truthful.

## Configuration

| Variable | Effect |
|---|---|
| `RESCORE=0` | no background re-scoring after saves |
| `RESCORE_DEBOUNCE_MS` | quiet period before a re-score (default 20000) |
| `PAGESPEED=0`, `PAGESPEED_API_KEY`, `PAGESPEED_TIMEOUT_MS` | PageSpeed Insights for public URLs |

## QA commands

```
MOCK=1 DATA_DIR=<tmp> OUT_DIR=<tmp> npm run qa:release -- --label release              # 12 profiles, 1440/768/390, axe
MOCK=1 ... npm run qa:release -- --label families --only mock-demo-copperleaf --families  # each family, same content
MOCK=1 ... npm run qa:seo-examples
BASE=http://localhost:4100 npm run qa:owner                                              # against an isolated MOCK=1 server on PORT=4100
npm test
```
