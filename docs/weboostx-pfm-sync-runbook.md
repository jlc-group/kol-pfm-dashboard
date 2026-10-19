# WeBoostX → KOL paid metrics

Provider: WeBoostX2, Facebook/Instagram only. Consumer: KOL Dashboard.
TikTok remains owned by the existing Beauterry adapter.

Production settings (private root `.env`, never Git):

```env
WEBOOSTX_PFM_SYNC_ENABLED=true
WEBOOSTX_PFM_BASE_URL=http://127.0.0.1:8201
WEBOOSTX_PFM_EXPORT_KEY=<same dedicated key as WeBoostX KOL_PFM_EXPORT_KEY>
WEBOOSTX_PFM_SYNC_INTERVAL_SECONDS=3600
WEBOOSTX_PFM_SYNC_INITIAL_DELAY_SECONDS=30
```

DEV must keep `WEBOOSTX_PFM_SYNC_ENABLED=false`. There is no fallback to
`ADS_SYNC_KEY` or `BEAUTERRY_PFM_EXPORT_KEY`. Do not send keys in tickets/chat.

The consumer reads provider `/api/v1/integrations/kol-pfm/metrics` (DB-only).
Match supported post URLs first, then numeric/compound ID, then known gencode.
Map the response's original `item_id` plus platform back to exact submission IDs.
Fill blank `id_post` only; preserve existing IDs and manually entered ad dates.
Changed identities are skipped after a row lock. No fuzzy creator matching.

Instagram `/p/`, `/reel/`, `/reels/`, `/tv/` and username-prefixed post links
are supported. WeBoostX must resolve `source_instagram_media_id` with Meta's
`id,permalink`; a creative's `instagram_permalink_url` may identify an ad copy
and must not be used as the creator's original URL. Missing/unreadable original
media remain unmatched, never guessed by name, date or SKU. Older provider cache
entries are repaired by its bounded hourly source-permalink job.

`ad_spend` and `ad_reach` are lifetime totals, never increments. Null reach means
unknown: do not write zero. Do not sum daily reach. Regressing totals are ignored.
Fired status requires actual spend. Existing performance-stamp rules remain in
effect using existing organic metrics; paid engagement never overwrites organic.
There are no new paid-engagement columns or new paid-only CPE calculation here
(the KOL PFM score below is WeBoostX's own ranking, stored and shown as-is).

Automatic pull: 30 seconds after startup, then hourly, with single-flight and
20-second request timeout. WeBoostX's upstream source/reach refresh runs separately;
new IDs or reach may remain unavailable until that scheduled refresh completes.

## KOL PFM + post thumbnails (2026-10-19)

Provider contract: WeBoostX2 `docs/KOL_DASHBOARD_API.md` §4 and consumer steps 6-7.
Every `/metrics` row may carry `pfm` (0-10 or null), `pfm_grade` (S/A/B/C/D or null)
and `thumbnail_url` (a PATH `/api/v1/integrations/kol-pfm/thumbnail/<id>` or null).

- Columns on `submissions` (schema.sql, additive): `weboostx_pfm`, `weboostx_pfm_grade`,
  `weboostx_thumbnail_path`, `thumbnail_local`, `thumbnail_fetched_at`, `thumbnail_error`.
  Run these six `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` lines before deploying.
  Without them the sync still runs: new fields are dropped and only ad_* is written.
- Mapping (`services/weboostxMetrics.js`): null is stored as null; malformed values
  drop only that field (never the row or the run). A field that is absent is not
  touched. Values overwrite on change (PFM is recalculated hourly). The grade is used
  as sent — never recomputed from `pfm`. ad_* mapping, `item_id` matching and
  `ad_launched` semantics are unchanged; ad_* never maps into organic fields.
- Downloader (`services/weboostxThumbs.js`) runs after each sync in the same hourly
  cycle, outside the sync transaction; its failure never changes the sync result.
  Paths without a current local copy (none yet, or the path changed) are fetched:
  max 200 paths per run, 4 at a time, 20 s timeout, no redirects, key sent only to
  `WEBOOSTX_PFM_BASE_URL`'s origin. Accept HTTP 200 + `image/*` + ≤5 MB + real
  JPEG/PNG/WEBP/GIF bytes. Files: `UPLOAD_DIR/weboostx-thumbs/wx<sha1(path)[:16]>.<ext>`
  (one file per path). Failures (e.g. `http_404`) go to `thumbnail_error` and are
  retried next run; an existing copy is never deleted. A copy recorded in the DB but
  missing on disk is fetched again. Never-tried paths go first; previously failed
  paths are retried in random order so permanent failures cannot starve others.
  Row updates lock rows in id order (same order as the sync), avoiding deadlocks.
- Changing an IG/FB post's identity (post link / ID Post / Gencode / platform) clears
  that row's KOL PFM, grade and thumbnail fields (they belonged to the old post); the
  next sync refills them for the new post.
- Serving: `GET /api/ads/:subId/thumb` (login + brand check, as for TikTok covers)
  sends our copy with `private, max-age=604800` and `nosniff`. Browsers never call
  WeBoostX. `weboostx_thumbnail_path`, `thumbnail_local`, `thumbnail_error` and
  `thumbnail_fetched_at` are stripped from every JSON response (`data/privateFields.js`); agency responses also
  drop `weboostx_pfm` / `weboostx_pfm_grade` (internal data).
- Ads page: IMAGE shows the copy for IG/FB; under the ad spend, IG/FB rows show
  "<grade> · <score>" (S green, A light green, B yellow, C orange, D red, "—" when null).
- Status: `GET /api/ads-sync/weboostx-status` → `thumbnails.last_run`
  (saved / reused / failed / error codes; never the key or provider URL).

Protected diagnostics (header `X-Ads-Sync-Key` uses KOL's inbound key):

- `GET /api/ads-sync/weboostx-status`
- `POST /api/ads-sync/pull-weboostx`

Inspect `enabled`, `configured`, `last_run.status`, `received`, `updated`, and
`source_not_found` (submission IDs). Success with unmatched rows is not proof of
complete data coverage. Rows with no supported identifier are not requested.

Release: `npm run build` (isolated tests) → review diff → push `main` → existing
webhook staging gate → guarded KOL activation. Verify PM2 PID equals the listener
on 3080, public `/api/ready`, and a real successful sync. Provider must be ready
first. Do not manually copy source to Production or bypass the port guard.

Rollback: disable only `WEBOOSTX_PFM_SYNC_ENABLED` and use the approved KOL
restart/deploy path. Revert the consumer commit through Git if needed. Preserve
pre-sync row backup; never overwrite later user edits when restoring metrics.
