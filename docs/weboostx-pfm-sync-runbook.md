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

`ad_spend` and `ad_reach` are lifetime totals, never increments. Null reach means
unknown: do not write zero. Do not sum daily reach. Regressing totals are ignored.
Fired status requires actual spend. Existing performance-stamp rules remain in
effect using existing organic metrics; paid engagement never overwrites organic.
There are no new paid-engagement columns or new paid-only CPE calculation here.

Automatic pull: 30 seconds after startup, then hourly, with single-flight and
20-second request timeout. WeBoostX's upstream source/reach refresh runs separately;
new IDs or reach may remain unavailable until that scheduled refresh completes.

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
