# KOL PFM Dashboard — we-platform deployment

Updated: 2026-09-10. Status: **production online; GitHub webhook auto deploy verified**.

## Latest activation checkpoint

- User supplied environment settings and authorized provisioning. Root DEV `.env` and PROD `.env` now exist; neither is tracked by Git. No secret values are recorded here.
- PostgreSQL connection and table readiness passed: 14 public tables, 5 users, 5 projects, 8 KOLs. Existing admin credentials matched and the account is active. No seed/migration or business-data writes ran.
- Port 3080 is assigned to this app; persistent uploads directory has been provisioned.
- Selective additions were applied independently to DEV and PROD `we-platform/main.py`, `ecosystem.config.cjs`, and `scripts/deploy.ps1`. Existing unrelated edits were preserved. The shared control plane was reloaded and recognizes this project.
- Exact backups and validated drafts: `D:/AI_WORKSPACE/_maintenance/kol-pfm-deploy-20260910`. `plan.json` records target paths and original hashes.
- The production we-platform deploy script ran for only `kol-pfm-dashboard` with `RestartPm2=false`: sync, build, 12 API regression tests and real DB production preflight passed.
- The app source was committed and pushed as `01493ac`; GitHub Actions run `34449172289` passed.
- GitHub webhook `677027830` delivered the push to we-platform with HTTP 200. Deployment history records success at `2026-09-10 14:17:28`.

The activation was retried after the user confirmed Cloudflare login. `kol-pfm-dashboard-prod` is online on port 3080. The shared we-platform process was reloaded and recognizes the project. Because the LocalSystem Cloudflared service could not be restarted from the non-elevated session, a dedicated locally managed tunnel named `kol-pfm-dashboard` was created and registered as PM2 process `kol-pfm-dashboard-tunnel`. DNS now points to that tunnel. Public login, health and readiness pass; readiness returned 200 in 10 consecutive checks. PM2 state was saved. The temporary connector used during diagnosis was stopped.

## Verified baseline

- Repository: `jlc-group/kol-pfm-dashboard`, branch `main`.
- This is separate from `jlc-kol-workspace`; do not reuse `kol.wejlc.com`.
- Domain: `kol-pfm-dashboard.wejlc.com`; DNS and dedicated tunnel are active.
- GitHub hook count was 0 during the initial inspection.
- No KOL PFM production folder, PM2 process or registration was found during the initial inspection; all three now exist.
- Ports 4000/5173 belong to stopped Pickleball services and remain reserved.
- Port 3080 was absent from listeners, PM2 metadata, DEV/PROD ecosystem files, inspected registries and Cloudflare ingress before assignment. It is now reserved and active for this app.
- we-platform DEV has existing uncommitted changes and differs from the running PROD source. Never copy the entire DEV control plane over PROD to register this app.

## Implemented

- Root `npm run build` installs nested packages from their lockfiles, creates `client/dist`, and runs isolated API regression tests. When invoked with `NODE_ENV=production`, it also runs production preflight before returning success to we-platform.
- Express serves the built SPA and `/api` on one port. Deep links reload correctly; missing API endpoints/assets return 404.
- Startup checks production environment, frontend build and database table availability before listening. `/api/health` is liveness; `/api/ready` returns 503 when database checks fail. Readiness checks table existence, not every column or business workflow.
- All upload/read/delete paths use `UPLOAD_DIR`. Production rejects a missing, relative, internal or unwritable directory. Provision a persistent directory outside DEV and PROD.
- JWT verification reloads current role/team/account state. Nested router middleware cannot restore stale token roles. Pending users can read their own status but cannot access agency or dashboard data.
- Dependency upgrades: Vite 7, React Router 7, Multer 2; `qs` override keeps Express 4 on a patched parser. Node >=22.12 is required. Runtime remains React 18 + Express 4.
- GitHub Actions validates build, isolated API tests, browser smoke and dependency audit. The we-platform push webhook does not automatically wait for GitHub Actions; its local build gate runs the API tests independently.

## Prepared registration artifacts

- `deploy/registration.json`: identity, paths, proposed port and outstanding decisions.
- `deploy/ecosystem.config.cjs`: reference process definition, no credentials. Port comes from production environment.
- The applied control-plane changes add the `node-backend` deploy override, repository mappings, PM2/dashboard metadata, app-specific upload exclusion, readiness gate, application process and dedicated tunnel process. Exact pre-change backups and validated drafts remain outside the deploy tree at the backup path documented above.

## Required production inputs

The user supplied and authorized the environment settings. They were saved privately into DEV root and PROD root `.env`, with production mode, loopback host, assigned port 3080 and persistent upload path. Credentials were preserved and never included in source, patches or Obsidian.

| Setting | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3080`, confirmed and reserved |
| `HOST` | `127.0.0.1` behind the existing tunnel |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Existing approved PostgreSQL database/account; verify `kol_dashboard` with owner |
| `JWT_SECRET` | Existing approved secret, or operator-provisioned random value of at least 32 characters |
| `JWT_EXPIRES_IN` | Optional; current default 7d |
| `UPLOAD_DIR` | `D:/AI_WORKSPACE/Persistent/kol-pfm-dashboard/uploads` |
| `ADS_SYNC_KEY` | Optional; absent means ads-sync integration is disabled |

Preferred runtime env file: `D:/AI_WORKSPACE/Production/kol-pfm-dashboard/.env`.
Explicit process variables take precedence, followed by root `.env`, then legacy `server/.env`.
Database SSL behavior remains the original `ssl: false`, matching the verified private-network connection.

## Activation sequence

1. Confirm domain/database and recheck port ownership in live PM2, listeners, ecosystem and ingress; record the reservation in Obsidian and root registries.
2. Inspect current DEV/PROD control-plane changes and back up only files being changed to a dated directory outside the deploy tree. Record baseline hashes and PM2 metadata without secret environment values.
3. Review the selective registration patch. Integrate only KOL PFM entries, validate Python/PowerShell/JS syntax, and verify exact project paths/type/PM2 name.
4. Have the operator provision approved env and persistent uploads. If existing uploads are discovered, copy and verify filenames/counts/hashes before switching paths; do not delete originals.
5. Verify the existing database's tables, essential columns and actual login/read/write workflows against an approved test database/account. No automatic setup-db, seed or migration runs during deployment. Back up DB before any separately approved schema changes.
6. Build using Node 22.12+ and run `npm run check:production` with the intended production settings. Missing settings or DB readiness must block activation.
7. Deploy only `kol-pfm-dashboard` via we-platform (`node-backend`). Verify its production path and start only `kol-pfm-dashboard-prod` using the reviewed ecosystem entry. The deploy script may require the first process start explicitly if its restart path cannot create a missing process.
8. Check origin `/`, a SPA deep link, `/api/health`, `/api/ready`, login and authorized upload/download. Recheck existing port owners.
9. Add the confirmed domain's ingress/DNS to the existing tunnel through the standard process. Validate HTTPS and authenticated paths; no broad PM2/tunnel restarts.
10. A single GitHub push webhook uses the existing we-platform endpoint `https://api.wejlc.com/api/deploy/webhook`; its first push delivery, build result, PM2 process and public readiness are verified.
11. If an operator needs evidence for file retention, upload a disposable approved file and verify it after a later deployment. The upload directory is outside both mirrored release trees.

## Rollback

- Before activation, save the exact control-plane files and previous app release outside the mirrored tree. Protect their backups as potentially sensitive; do not commit them.
- If first activation fails, disable only the new webhook, stop only `kol-pfm-dashboard-prod`, and restore only the new mapping/ingress additions from the reviewed baseline. Keep persistent uploads and database intact.
- For subsequent app deployments, redeploy the last verified commit through the approved release path, then restart only this app and recheck `/api/ready` and file download. Do not run `git reset --hard` on the shared DEV checkout.
- Never automatically roll back or reseed the database. Schema rollback needs its own reviewed plan.
- `robocopy /PURGE` is not an atomic release system; do not claim transactional deploy or automatic rollback.

## Validation and operational limit

Local validation uses an ephemeral loopback server and isolated in-memory store fixtures. The test code rejects real database access.

- API tests cover serving built assets/deep links, 404s, DB outage readiness, active/demoted/disabled/deleted/pending/agency accounts, token rejection, external multipart upload and authorized download, production setting validation.
- Browser smoke uses the real React bundle and real login API with fixture persistence: login rejection/success, pending state, reload, logout, navigation and mobile width, with no browser JS exceptions.
- Public login and `/api/auth/me` passed against PostgreSQL with the existing active admin account. `/api/ready` returned HTTP 200 in 10 consecutive public checks. No production payment record or disposable upload was created during deployment verification.

The durable we-platform registration is proposed in [Chanack18/we-platform PR #13](https://github.com/Chanack18/we-platform/pull/13). The host is already running the same selective mapping; the PR isolates it from unrelated local changes in the shared control-plane checkout.

## Source rules

- `D:/AI_WORKSPACE/AI_Project/Github/AGENTS.md`
- `D:/AI_WORKSPACE/05_vault/30-JLC-Work/We-Platform-Port-Registry.md`
- `D:/AI_WORKSPACE/05_vault/30-JLC-Work/Order-Product-Issues-Production-Runbook.md`
- `D:/AI_WORKSPACE/05_vault/30-JLC-Work/JLC-KOL-Workspace-Production-Runbook.md`

Dependency migration references: [Vite 7 migration](https://v7.vite.dev/guide/migration), [Multer middleware](https://expressjs.com/en/resources/middleware/multer/).
