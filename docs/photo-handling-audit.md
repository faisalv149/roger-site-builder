# Photo identity and persistence handoff

Scope: changes against the supplied `roger-current-source.zip`, 15 November 2026. No commit, push, deployment, live generation, or cleanup of existing records.

## Identity

- Builder reuse still matches current downloaded pixels against exactly one saved check, within the existing fingerprint/color/dimension tolerances. Missing/ambiguous checks are not reused. Google photos with featureless/unreadable fingerprints are rejected before entering the builder's image list.
- Concept catalogs now observe the current candidate, then match its fingerprint against saved checks of the same dimensions. A same-size reorder cannot transfer a description by position. Ineligible/unmatched photos are omitted with stage notes. Saved website vision descriptions also require the fingerprint captured when they were described; a newer image cannot be stamped onto an old description during handoff.
- A live reference uses position/dimensions only to locate ONE candidate, not as proof of identity. The server resolves one display URL, fingerprints the bytes from that URL, and returns that same URL. It does not download other listing photos to hunt for a replacement. Listing metadata is read once per place per page filler; image checks are deduplicated by place, position, dimensions AND fingerprint within that request.
- Concept and builder HTML remove failed images and credits. Builder responsive sources, preloads and lightbox entries are handled too. Direct `/gphoto` requests fail with 404 plus `x-photo-omitted` rather than serving a grey image. Omission reasons are recorded through the existing omission collection and log.
- Google images and live URLs remain in request memory only. They are not written as new image files or cached across requests. The browser loads the checked URL directly; the server does not rehost the image.

## Persistent write audit

| Boundary | Coverage |
| --- | --- |
| `store.ts` document writes | Builds, conversations, publishes, leads, drafts, orders and every registered Studio collection; serialize and scrub before both local atomic writes and remote writes |
| Generated text files | Site/draft records, pages, concept/spec renders, shared shells, reports, cards, order previews, uploaded theme JSON, publish output and SVG metadata; shared `writeStoredFile` boundary |
| Generated version copies | `copyStoredTree` sanitizes NEW copies without modifying the source |
| Remote file uploads and restores | `storedBytes` sanitizes textual uploads; restores use the guarded writer |
| Remaining binary writes/copies | Re-encoded photos, image crops, logos, screenshots and thumbnails; no JSON/resource-name payloads |

The sanitizer covers ordinary resource paths, URL-encoded slashes, JSON-escaped slashes, nested strings and object keys. Website URLs and internal `google-listing:<place>#<n>` references remain intact. Warning messages do not include the raw resource name.

## Dry run only

From the project root:

```sh
npm run audit:google-names -- --json
```

Equivalent without the tsx CLI's IPC server:

```sh
node --import tsx scripts/google-names-dry-run.ts --json
```

The command has no apply mode. It reads all registered collections, all generated text files under OUT_DIR, uploaded themes and remote-only generated files when remote storage is configured. It reports affected records, occurrences, fields and examples separately by location. Local and remote copies are counted as separate physical files. An unreadable collection/record/file causes failure, not a misleading zero count. Remote listing does not create a bucket.

No production credentials or real data were in the source export. Therefore no actual affected-record counts are claimed. Synthetic audit: three seeded document collections plus one file, five resource-name occurrences, with source bytes unchanged. The remote stand-in also verifies no upsert, upload, bucket creation or delete during audit.

## Verification

- Type-check passed.
- Final related set: 42 passed, 2 Windows-only tests skipped, 0 failures.
- Earlier broader selection: 56 passed, 2 skipped, 2 browser checks blocked because Chromium cannot create its singleton socket in this environment (`Operation not permitted`). These are not reported as passes.
- No full suite or live Google/production check. Tests used the available local dependency installation; a fresh lockfile install was not performed.

```sh
node --import tsx --test test/google-photo-identity.test.ts test/google-photo-storage-remote.test.ts test/handoff-reuse.test.ts test/store-replace.test.ts test/resolve-business.test.ts test/intake-open.test.ts test/intake-versions.test.ts test/google-only.test.ts
npm run typecheck
```

## Remaining gaps within this scope

- Existing stored resource names are untouched; run the dry-run against your local/production storage to obtain real counts before a separately authorized cleanup.
- Old descriptions without a fingerprint cannot be reused. Their photo is omitted, or the existing builder performs its normal fresh check when a build is later requested.
- A moved image that cannot be located from the single candidate is omitted rather than searching/download-scanning the listing.
- Fingerprints are a perceptual heuristic, not a mathematical identity guarantee. Current thresholds are unchanged; malformed and featureless fingerprints fail closed.
- Chromium visual checks and live remote-service behavior remain unverified here. No unrelated release work was performed.
