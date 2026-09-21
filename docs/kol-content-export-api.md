# KOL Content Export for Beauterry PFM

This read-only endpoint is a separate integration from the hourly metrics
sync. It exposes only Beauterry TikTok submissions that already have an
`id_post` and are still marked `ยังไม่ยิง`.

## Endpoint

```text
GET /api/integrations/beauterry/content-candidates
X-KOL-Content-Key: <KOL_CONTENT_EXPORT_KEY>
```

Optional query parameters:

- `limit`: 1-500, default 100
- `updated_since`: ISO datetime; returns rows changed after this timestamp

The server always applies these filters and does not let the caller choose a
different brand:

- `projects.brand = KOL_CONTENT_EXPORT_BRAND`
- `platform ILIKE 'tiktok%'`
- `ad_status = 'ยังไม่ยิง'`
- numeric, non-empty `id_post`

## Response

```json
{
  "status": "success",
  "data": {
    "count": 1,
    "has_more": false,
    "filters": {
      "brand": "Beauterry",
      "platform": "TikTok",
      "ad_status": "ยังไม่ยิง"
    },
    "items": [
      {
        "submission_id": 123,
        "id_post": "7412345678901234567",
        "gencode": "#example",
        "brand": "Beauterry",
        "platform": "TikTok",
        "status": "confirmed",
        "ad_status": "ยังไม่ยิง",
        "post_check": "ok",
        "post_url": "https://www.tiktok.com/@creator/video/7412345678901234567",
        "post_date": "2026-09-20",
        "updated_at": "2026-09-20T10:00:00.000Z"
      }
    ]
  }
}
```

This endpoint is read-only and never changes KOL submissions. It is disabled
unless `KOL_CONTENT_EXPORT_ENABLED=true` and a separate
`KOL_CONTENT_EXPORT_KEY` are configured. Do not reuse `ADS_SYNC_KEY` or
`BEAUTERRY_PFM_EXPORT_KEY`.

The Beauterry consumer may import a row only after TikTok has authorized that
video under the configured Beauterry advertiser. `id_post` and `gencode` do
not replace TikTok's one-time `auth_code`.
