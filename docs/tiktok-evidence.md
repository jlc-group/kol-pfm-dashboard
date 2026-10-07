# Isolated TikTok counters for KOL

This consumer runs in KOL only. It does not import Beauterry code, connect to its
database, change its worker configuration, authorize Spark clips, or issue ad/budget
commands. Collection writes only `submissions.perf_sources.tiktok_evidence` in the
existing KOL JSONB column. Effective counters, manual entries, paid data, ad dates,
updated_at, and historical stamps are unchanged by collection. No migration is needed.

The feature is disabled and unconfigured by default. There is currently no verified
replacement provider on this machine; deploying this consumer does not restore missing
TikTok counters by itself. Do not enable the old Beauterry item-detail worker to activate
this feature: that worker writes the counters used by its auto-budget rules.

## Provider contract

Configure a maintained **read-only** provider endpoint:

```text
KOL_TIKTOK_EVIDENCE_ENABLED=false
KOL_TIKTOK_EVIDENCE_URL=https://<provider>/kol-organic-metrics
KOL_TIKTOK_EVIDENCE_KEY=<dedicated provider secret>
KOL_TIKTOK_EVIDENCE_INTERVAL_SECONDS=3600
```

Only HTTPS or HTTP loopback URLs without credentials, query parameters or fragments
are accepted. No URL or key is returned by status endpoints. No fallback scraper is
used. Automatic collection requires explicit enablement; manual collection requires
both URL and key. A provider may be hosted separately from Beauterry to maintain
this isolation. Setting an arbitrary URL is insufficient: verify the contract below.

The consumer sends GET `<endpoint>?item_ids=<comma-separated IDs>` with
`X-KOL-TikTok-Key`, batches of 100, no redirects, a 20-second timeout and a 1 MiB
response limit. It requests only TikTok IDs belonging to the brands managed by the
Beauterry integration, currently Beauterry. This does not imply Julaherb support.

```json
{
  "status": "success",
  "rows": [{
    "id_post": "7600000000000000001",
    "status": "available",
    "collected_at": "2026-10-07T14:00:00Z",
    "metrics": {"views": 1000, "likes": 100, "comments": 0, "saves": 0, "shares": 5}
  }]
}
```

Every requested ID must have exactly one row, including missing clips. For unavailable
rows use `pending`, `source_not_found`, `source_unavailable`, or `fetch_failed`; no
counters are synthesized. `available` requires all five nonnegative safe-integer
counters and a timezone-qualified actual successful counter-collection time. Provider
record-update time and KOL receipt time are not substitutes. Counters can include real
zero values; omitted or null counters invalidate an available observation. These are
post counters; do not substitute paid impressions or paid reach. Do not describe total
post counters as organic-only if the provider cannot establish that distinction.

## Review and selection

The performance editor shows this evidence separately from the existing PFM evidence.
Clicking fetch only collects evidence. Clicking **เลือกใช้ยอด TikTok ชุดนี้** explicitly
copies the reviewed counters into the effective KOL fields, freezes the selected copy
in manual mode, and records its origin and collection time. Later collectors and PFM
sync retain evidence without replacing this copy. Saving handwritten counters replaces
the latest manual entry as before. Existing stamps remain unchanged; explicit selection
may create a new stamp under the existing manual-save rules.

Selection requires matching post ID, complete counters, positive views, collection and
receipt within two hours, and the same SHA-256 evidence ID that the editor displayed.
Both evidence writes and explicit selection use the submission row lock. Changed
effective counters or changed evidence return 409. Older/equal collection timestamps
cannot refresh the previous evidence; repeat transport success does not make old
counters fresh. Failed batches are reported as failures and do not synthesize values.

## Operations and rollback

- GET `/api/ads-sync/tiktok-evidence-status` and POST
  `/api/ads-sync/pull-tiktok-evidence` require the existing `X-Ads-Sync-Key`.
- Authenticated GET `/api/ads/tiktok-evidence-status` exposes configured/reason only.
- The existing project-scoped fetch route uses this isolated collector and verifies
  project membership before requesting a clip. It no longer calls the unfinished
  direct TikTok API placeholder or changes counters during collection.
- No new production secret/config is set in this release. Verify a real provider
  before configuring/enabling it. Initial live checks must be read-only; never use
  invented metrics in production to prove collection.
- Roll back application code while retaining JSONB evidence. No schema or Beauterry
  rollback is needed. Keep collection disabled until a real provider passes validation.

Validation: unit/contract/API/selection tests, PostgreSQL disposable-database row-lock
test, frontend build and browser smoke. Verify production effective-data hashes and
unconfigured status after deployment; this proves isolation, not live data completeness.
