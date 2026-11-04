# Studio jobs in production: moving from in-process runs to a worker

Phase 1 runs business-brief jobs inside the web server process. That is enough for local use and review. It is not safe on Vercel, where the server is a serverless function. This note explains what has to change before studio jobs run in production, and in what order.

## How jobs run today (local)

- `POST /api/studio/jobs` saves a job record (`studio-jobs`) and an empty work document (`studio-work`). It returns the job id with HTTP 202, then starts `runStudioJob` in the same process without awaiting it.
- The job runs seven stages in order: `identity → page_inventory → crawl → assets → brand → brief → qa`. Stage state and progress are saved as the job goes: the work document after every page and picture, the job record at least every 400 ms. Finished stages are never run again.
- The crawl can resume part-way through. Pages already in the work document are not fetched again, because page and stylesheet bodies are stored once each by sha256 (`studio-bodies`).
- On start-up, `resumeInterruptedJobs()` picks up jobs left `running` or `queued` that have not been saved for `STUDIO_STALE_MS` (90 s by default). That lets a restarted process continue a job without taking one away from another live process.
- Storage goes through `studioDocs` in `src/store.ts`: JSON files under `data/` locally, and the Supabase or Redis document store when `remote` is configured.

## Why this does not work on Vercel

1. **The function stops after the response.** Work started after `res.json()` is cut off or frozen. Nothing guarantees the job continues.
2. **Jobs outlast function limits.** A real site takes 1–8 minutes: about 20 pages with retries, browser renders, 40 picture downloads and a brand measurement.
3. **A browser is needed.** Script-built pages and brand measurement need Chromium. `@sparticuz/chromium` works in a function but is slow to start, and running it repeatedly per page is expensive.
4. **There is no start-up hook.** Nothing runs `resumeInterruptedJobs()` on a serverless deployment.
5. **The document store is the wrong shape for page bodies.** Snapshots reference bodies by hash, which is right. But putting megabytes of gzip+base64 HTML into the Supabase/Redis document table is not.

## Target design

Keep the API, the stage functions and the stored documents as they are. Change only where stages run and how a job is claimed.

```
Vercel (web/API)                         Worker (container, long-running)
POST /api/studio/jobs ──► queue message ──► claim job (lease) ──► run next stage ──► save ──► loop
GET  /api/studio/jobs/:id ◄─────────── job table (Supabase) ◄──────────── heartbeat / progress
                                        bodies ──► object storage (sha256 keys)
```

### 1. A worker process

- Run one Node service from the same repository, for example a small Fly.io, Render or Railway container with Chrome installed. Its entry point loops: claim a job, call `runStudioJob(id)`, repeat.
- Concurrency: 2–3 jobs per worker, and at most 2 requests at a time per site host. The crawl already spaces its own requests.
- Add workers when the queue grows. The lease below keeps a job on one worker at a time.

### 2. A queue and a lease instead of in-memory locks

- The job table gets `locked_by`, `locked_until` and `heartbeat_at` columns.
- Claim a job with one conditional update, such as `UPDATE studio_jobs SET locked_by=$w, locked_until=now()+'2 min' WHERE id=$id AND (locked_until IS NULL OR locked_until < now()) RETURNING *`. A message from a queue (Vercel Queues, SQS or Upstash QStash) only wakes a worker; the lease decides who runs the job.
- The worker extends the lease on every save (`ctx.save()` already happens after each page and picture). A worker that dies stops extending it, and the next claim takes the job over. This replaces `resumeInterruptedJobs()` and its time threshold.
- `POST /api/studio/jobs/:id/resume` keeps working: it resets the failed stage to `pending` and sends a new queue message.

### 3. Storage

- **Job records, work documents, snapshots, briefs, inventories, index:** Supabase tables, one row per document. They can keep the current `collection/id/data` layout at first. Split work documents by page once they grow.
- **Page and stylesheet bodies:** object storage (Supabase Storage or S3) under `bodies/<sha256>.html.gz`. `putBody` and `getBody` in `src/studio/snapshot.ts` are the only places to change.
- **Retention:**
  - Keep snapshots and bodies for as long as a brief revision references them. That is what makes a brief reproducible.
  - Delete work documents 30 days after their job finishes.
- **Google listing data:** the snapshot keeps listing facts and photo references only. It keeps no review text and no photo bytes. Under the Places API terms, place IDs can be kept indefinitely, but other listing content needs a refresh policy. Re-fetch the listing when a brief is older than the allowed caching period, and do not serve stale listing facts.

### 4. Browser use

- The worker image includes Chromium. `renderPage` and `measureBrand` in `src/sources/render-page.ts` already launch it through `launchBrowser`.
- Reuse one browser per job instead of one per page once render volume makes it worthwhile. The current cap is `STUDIO_MAX_RENDERS=3` per job.

### 5. Progress to the UI

The Studio page polls `GET /api/studio/jobs/:id` every 1.2 s, and that stays valid. Server-sent events can come later, fed by the job row's `updated_at`.

## Migration steps

1. Move `studioDocs` collections to Supabase tables, and bodies to object storage. Keep the local JSON backend for development.
2. Add the lease columns and a `claimStudioJob(workerId)` function. Make `runStudioJob` refuse to run without a lease when `STUDIO_WORKER=1`.
3. Add `scripts/studio-worker.ts`, the claim–run–repeat loop, and its container image with Chromium.
4. In the API, when running on Vercel, enqueue instead of calling `runStudioJob`. Keep in-process runs only for local development.
5. Remove the start-up `resumeInterruptedJobs()` call from production builds. Leases cover it.
6. Add alerts for jobs `running` with an expired lease and no claimant, and for a failure rate above an agreed threshold per stage.

## What already holds and needs no change

- Each stage only reads and writes the work document, so any worker can run any stage.
- Pages are keyed by URL and bodies by content hash, so retrying a stage cannot duplicate or corrupt data.
- `buildFromSnapshot` is pure: QA checks that rebuilding from the saved snapshot gives the same brief hash. The brief and QA stages can run anywhere the snapshot can be read.
- The tests in `test/studio.test.ts` cover the interrupted-job resume and the deterministic rebuild. Run them against the worker as well.
