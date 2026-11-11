# Ad Rights Export for WeBoostX + System Tokens

WeBoostX reads the last day each KOL post may be advertised (the date behind
the DAY LEFT label) and pauses the post's ads that night. Read-only: nothing
is written back to this dashboard. Full contract, including what WeBoostX does
with the data: WeBoostX2 `docs/KOL_AD_RIGHTS_API.md`.

This is the first door that uses a **system token** instead of an env key:
an admin issues and revokes the token on the "Token ระบบ" page, so nobody
edits `.env` or restarts the server.

## One-time setup after deploy

The `system_tokens` table is new. Deployment never runs `setup-db`
(`we-platform-deployment.md`), so it has to be run once, by hand, after the
code is live:

```text
cd server
npm run setup-db
```

Until then the web app works as before (`system_tokens` is in
`OPTIONAL_TABLES`), the door answers `503 TOKEN_CHECK_UNAVAILABLE`, and the
"Token ระบบ" page says the table is missing instead of issuing a token.

## System tokens

JLC system-to-system token standard (same as Affiliate Hub `ahx_` and
WeBoostX `wbx_`).

- Shape: `kol_` + 32 random bytes as base64url (43 characters).
- Stored: SHA-256 hex only (`token_hash`, UNIQUE) plus the last 4 characters,
  who issued it and when, last use, who revoked it and when. The real token is
  in the issue response once and nowhere else; it is never logged.
- One scope per door. A token opens only the door it was issued for.
- At most 20 active tokens per scope. Revoking keeps the row and takes effect
  on the next request (no cache).
- "ใช้ล่าสุด" (`last_used_at`) moves at most once every 10 minutes.
- Sent in the door's own header, never `Authorization: Bearer` and never a
  query string. A person's login does not open a machine door, and a system
  token does not open any page or API meant for people.

Admin API (admin session only, `Cache-Control: no-store`):

```text
GET  /api/system-tokens              list + doors + ready flag
POST /api/system-tokens              { name, scope } -> 201, token shown once
POST /api/system-tokens/:id/revoke
```

Rotation without a gap: issue a new token, the consumer switches to it, wait
for the new token's "ใช้ล่าสุด" to move, revoke the old one.

Code: `server/src/services/systemTokens.js` (`DOORS`, `machineDoor(scope)`),
`server/src/store/pg/systemTokens.js`, `server/src/routes/systemTokens.js`,
`client/src/pages/SystemTokens.jsx`. A new door = one row in `DOORS` and
`router.use(machineDoor('<scope>'))` on its router.

## Endpoints

```text
GET /api/integrations/ad-rights
GET /api/integrations/ad-rights/status
X-KOL-Ad-Rights-Key: kol_...        (scope ad-rights)
```

The router is mounted before `/api/integrations/:brand` so `ad-rights` is not
read as a brand code.

Rows served, fixed by the server: `status = 'confirmed'`, a non-empty
`post_url`, platform Instagram or Facebook (never TikTok), and not a campaign
with `campaign_type = 'other'`.

Optional query parameters of the list:

- `platform`: `instagram` or `facebook`
- `updated_since`: ISO datetime with a zone; rows changed strictly after it
- `limit`: 1-2000, default 500
- `offset`: 0 or more

Rows are ordered by `updated_at`, then `row_id`.

## Response

```json
{
  "status": "success",
  "data": {
    "count": 1,
    "total": 296,
    "has_more": false,
    "generated_at": "2026-11-11T03:35:02.118Z",
    "rows": [
      {
        "row_id": 8123,
        "platform": "instagram",
        "brand": "Beauterry",
        "creator": "example.creator",
        "product": "BTA3-01, BTA3-02",
        "post_url": "https://www.instagram.com/p/EXAMPLE/",
        "id_post": "18000000000000000",
        "gencode": "adcode-example",
        "post_date": "2026-11-10",
        "days": 60,
        "ad_rights_end": "2027-01-09",
        "no_end_reason": null,
        "updated_at": "2026-11-10T09:12:44.000Z",
        "post_date_by": "example"
      }
    ]
  }
}
```

`/status`:

```json
{
  "status": "success",
  "data": {
    "rows": 296,
    "rows_without_end": 12,
    "rows_without_post_id": 41,
    "last_updated_at": "2026-11-10T09:12:44.000Z"
  }
}
```

Field notes:

- `ad_rights_end` = `post_date` + `days`, a plain date (`logic.js`
  `gencodeExpireDate`, the same formula as `client/src/data/dayLeft.js`; a test
  holds the two equal). It is the last day ads may run, that day included: the
  day the DAY LEFT label reads "0 Days". Example: posted 2026-11-10, 60 days
  -> 2027-01-09.
- `days` = `gencodeDays` (the row's `code_expire`, default 60; 0 for a "no
  Gencode" group or a row without a Gencode).
- `ad_rights_end` is `null` with `no_end_reason` = `no_gencode`,
  `no_post_date` (missing, malformed, or not a real date) or `no_days`.
  WeBoostX does nothing for a row without an end date.
- `updated_at` is the latest of the row's own stamps (`submitted_at`,
  `updated_at`, `work_updated_at`, `list_updated_at`, `decided_at`,
  `post_date_at`, `gencode_at`, `id_post_at`, `post_url_at`) and the
  campaign's `updated_at`. Editing a campaign therefore re-sends all of its
  rows; the consumer upserts by `row_id`.
- Timestamps are UTC (`...Z`). `post_date` and `ad_rights_end` are dates
  without a zone, read as Thai calendar days.

## Errors

Body: `{ "status": "error", "code": "...", "message": "..." }`.

| HTTP | code | when |
|---|---|---|
| 401 | `INVALID_TOKEN` | header missing, wrong, revoked, or a token of another scope |
| 503 | `TOKEN_CHECK_UNAVAILABLE` | the token could not be checked (database error, or `system_tokens` not created yet) |
| 400 | `INVALID_PLATFORM` | `platform` is not `instagram` / `facebook` |
| 400 | `INVALID_LIMIT` | `limit` is not a whole number 1-2000 |
| 400 | `INVALID_OFFSET` | `offset` is not a whole number from 0 |
| 400 | `INVALID_UPDATED_SINCE` | `updated_since` is not a datetime |

A bad parameter is refused, never guessed (`limit=5000` is a 400, not 2000).

## Tests

`tests/ad-rights.test.cjs` (the door, the feed, the formula) and
`tests/system-tokens.test.cjs` (issue, revoke, the cap, what is never stored
or logged). Both run on in-memory stubs and never open a database connection.
