# Performance evidence in KOL Dashboard

The effective counters stay in `submissions.views/likes/comments/saves/shares/reposts` for existing reports. The additive `submissions.perf_sources` JSONB column stores the latest manual entry and the latest API evidence separately. Existing counters and historical stamps are not backfilled with an invented source.

- A manual save selects `mode=manual`. Automatic sync retains API evidence but does not replace effective counters. Paid spend, Reach and ad metadata continue to sync.
- The editor displays the separate API values. Explicitly choosing **ใช้ข้อมูล API** selects its complete counters, including lower counters, while retaining the manual evidence and historical stamp. Selection requires an available source, positive views, all five TikTok counter fields, and receipt within two hours. This receipt-time guard does not prove TikTok counter freshness.
- Form submissions include the counters seen when the editor opened. The comparison happens under the same PostgreSQL row lock as the write. Changed values return HTTP 409.
- Beauterry sync reads and locks matched rows in ascending ID order inside its transaction. It never applies a pre-transaction snapshot. Brand scope, duplicate-post selection and cumulative guards remain enforced.
- Upstream record time (`source_updated_at`), KOL receipt time (`observed_at`) and manual save time (`saved_at`) have separate meanings. Beauterry's current record time is not proof of a successful counter fetch.
- `snapshot_only`, `source_unavailable`, `pending`, `source_not_found`, or a receipt older than two hours prevents a new automatic stamp. An explicit manual entry can create a stamp when the existing spend/fee/views conditions are met. Existing stamps remain unchanged. New stamps record the selected source and observation time.
- Source status persists in the KOL database across application restarts. Missing source values do not become invented zero counters. The Ads page labels manual, unavailable, snapshot and expired sync evidence.

Apply `node scripts/migrate-performance-sources.cjs --apply` against the intended KOL database **before** deploying this version. Without `--apply`, the script only previews the database name and column presence. The migration adds one nullable column, does not rewrite rows, and uses a five-second lock timeout. Production readiness checks the required column.

Validation: `npm run build` runs the isolated regression suite. `node scripts/test-performance-concurrency.cjs` is an opt-in PostgreSQL integration check; it creates a uniquely named empty disposable database, tests real row-lock contention, manual/API selection and stale forms, then removes that database. It does not copy production data.

This release changes KOL only. Restoring external TikTok KOL counters and auditing historical Beauterry budget decisions remain separate work. This evidence stores the latest entry per source, not a complete time series of every counter observation.

Rollback: deploy the previous application commit and retain the nullable evidence column. The prior version ignores it; do not drop it as part of application rollback.
