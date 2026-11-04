# Business identity, website extraction and delivery checks

Why this exists: a ZIP code search returned Google's postal-code place "78645", the build treated it as the business, and the preview was a page about a postal code with a placeholder phone number. These are the rules that prevent that.

## Identity (`src/sources/identity.ts`, `src/sources/resolve.ts`)

1. **The website is read first.** `scanWebsite` also runs `extractSiteContent` (`src/sources/site-content.ts`): name (title, JSON-LD, `og:site_name`, copyright line, header link; a name cut short by a page builder is folded into the full one), street address, phones, emails, booking links, services, story, images, videos, hours.
2. **A place is not a business.** `geographicReason` rejects Google results typed `postal_code`, `locality`, `route` etc., labelled "Postal Code", or named like a postal code or just the town. `searchCandidates` filters them out and reports them.
3. **A Google result must agree with the website.** `matchCandidate` scores name, the website *Google lists for the place*, phone and street address. A website address typed by the user is never counted as Google's confirmation (it is what is being checked). No photos or reviews is not a reason to reject.
4. **Search by what the site says.** When nothing chosen checks out, Google is searched by the site's name + town/ZIP/phone, not by what was typed.
5. **No reliable match: use the website.** `businessFromWebsite` builds the business from the page alone (no rating, reviews or hours it doesn't state). If the page names no business either, the build stops with what to send.
6. The result is recorded as `business.identity` (`verified` / `probable` / `website-only` / `unverified`, the evidence, and every candidate turned down with why).

Saved sites built before these checks keep a wrong identity in their draft and static pages. `npm run repair:identity -- --scan` lists them; `npm run repair:identity -- <slug>` (or `POST /api/sites/:slug/re-resolve`) rebuilds the site at the same address. Any ordinary rebuild re-checks the identity too.

## Extraction report

Every build returns `extraction.extractors`: identity, address, phone, booking, services, story, images, videos, hours, rendered page, service pages, photos, each `success` / `partial` / `failed` / `skipped` with counts and a reason. `extraction.claude` says whether Claude was configured, whether it ran, whether its answer validated, what was dropped because the page text didn't support it, and why a fallback answered. `extraction.photos` has every image: source URL, role, alt kind, status, size, duplicates and failures. `extraction.retention` compares what the website showed with what the site kept.

- Pages that build content in the browser, or load pictures on scroll, are read again in headless Chromium when the HTML alone is thin.
- Image hosts that reset bursts of connections are fetched politely (two at a time, backoff retries); a reset is reported as such.
- Facts nobody stated are `null` (unknown), never `false`. `open24h` is known only when hours are.

## Delivery checks (`src/content/validate.ts`)

`review.status` is `ready`, `needs-review` or `blocked`. Checks compare identity and contact with the source (name, phone, address), retention (every service, photo, video, the booking address) and the finished HTML (each service named, booking link present, phone and street shown, no placeholder number). Missing phone or address is recovered from the website where it states them; anything else missing becomes a review item. The preview message (`src/content/summary.ts`) is written from what the build obtained and never mentions Google photos, reviews or hours that weren't there. A build with open checks isn't offered as "publish it".

## The widget

No placeholder phone number. With no phone the call panel offers a call back. There are no invented time slots: the booking panel is either a link to the business's own booking page (when its website has one) plus a plainly labelled request, or just the request ("a request, not a booking").

## The audit (`src/audit/audit.ts`)

Each issue has a `basis`: `measured` (counts fully), `heuristic` (a risk read from the page source, worded "may", counts half), or `suggestion` (advice, no score impact). What couldn't be determined goes in `unknowns` and is never reported as a problem: total download size (only HTML plus the sampled images is counted, and it is claimed only as "at least"), analytics (often loaded after the page opens), Google scores when PageSpeed didn't run. Pages are opened at phone width when a browser is available, so a missing H1 or sideways scrolling is measured. Empty `alt=""` is respected as "decorative". Title length is advice. The audit uses the validated business location, and a website-only business is not compared with a Google record.

## Brand profile and image-led service cards

- **Brand profile** (`src/sources/brand-profile.ts`): the page is rendered in a browser and the sampler measures real computed styles: backgrounds by area, text and heading colours by amount of text, the header and footer, buttons (fill, lettering, corners) and typefaces. Roles come from use: the *primary* colour carries large panels, the header and headings; the *secondary* fills buttons. Black, white and grey are never brand colours. Each colour records the source elements and a confidence; the logo's colours back them up but cannot replace them. Without a browser the page's stylesheet colours are used (low confidence); a logo alone is the last resort and is flagged.
- **Applied per business, never as a default**: `brandCss` writes `--brand` (button fill), `--brand-ink` (button lettering), `--heading`, `--band`, white surfaces and body text as CSS variables in `<style id="rg-brand">`, before the owner's own appearance (which still wins). Text/background pairs are held to 4.5:1 and every adjustment is listed. A logo too light for a white header puts the header on the brand colour, as the website does.
- **Typefaces**: a proprietary font can't be loaded from another site, so each role gets one explicit substitute, applied everywhere on the page and recorded (`typography.substitution` with the reason).
- **Service cards**: each service keeps its own picture from the card it sits in (`SourceService.image`), cropped to 16:10 around the page's own crop or the most prominent region, stored on the offering with its focal point, the uncropped copy and the source URL. With two or more service pictures the services become cards (white, 20px corners, 24px gaps, hover/focus lift that respects reduced motion), each with its own booking destination. Services without a picture get an icon panel of the same shape; with no pictures at all the earlier list is used.
- **Checks**: `output-brand` blocks a page whose styles lost the website's brand colours; `output-service-images` blocks a page that dropped service pictures it had; `service-images-lost` asks for review when pictures were found but couldn't be used.
