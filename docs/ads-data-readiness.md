# Ads data readiness repair — 2026-10-07

The Ads page distinguishes missing post performance from successful paid-data
sync. Beauterry exports `organic_metrics_status` separately from spend/reach:
`available`, `pending`, `snapshot_only`, or `source_unavailable`. The consumer
retains diagnostics from its last successful pull in memory; after a restart
they reappear on the first scheduled pull. They are never written as metrics.
Existing providers without the optional field remain compatible.

The production audit found 206 visible posts: 11 stamps, 25 unstamped posts
waiting for views after reaching the spend threshold, and 170 below threshold.
52 posts had views/engagement. The KOL detail service was explicitly disabled;
Spark authorization metadata cannot supply those missing counters. A maintained
post-counter source is still required for automatic refresh. Paid reach and
paid impressions must not be substituted for post views/engagement.

The page now offers the existing performance editor directly from each row.
It preloads all engagement components and uses the existing project update
endpoint and brand permissions. A save can create a new stamp if the existing
rules are met; the snapshot represents the save time, not historical metrics
at the time the spend threshold was crossed. Existing stamps are preserved.

Gencode/ID and note classes use `kol-track-*` names because common cosmetic
ad-block rules hide `.ads-code` and `.ads-note`. Copy failure is visible.
An ad date before its post date is an `invalid` timing category, never on time;
later paperwork timestamps still use the existing three-day timing rule.
Missing Campaign/Target values link to the campaign for configuration review;
the repair does not invent those business values or rewrite conflicting dates.

Validation: unit tests, build and isolated browser smoke. The browser fixture
applies the cosmetic block rules and exercises the manual performance save
without a real database. No schema migration, credential/config changes,
historical stamp rewrite or automatic performance backfill is part of this
release. Runtime/source and database hashes are verified after deployment.

Deploy Beauterry first, then the consumer through the existing main-branch
WePlatform webhook. If verification fails, revert the scoped consumer commit,
then the provider commit through the same pipeline; do not restore older
database snapshots over live data. The provider field is additive, so either
version can safely run with the other during rollout or rollback.
