const { query, withTransaction, updateRow, asJson } = require('./_base');
const { platformOf, itemIdFor, patchFor } = require('../../services/weboostxMetrics');
const { maybeStamp, stampAtFor } = require('../logic');
async function items() {
    const result = await query(`SELECT id, platform, post_url, id_post, gencode FROM submissions
        WHERE lower(btrim(platform)) IN ('instagram', 'facebook') ORDER BY id`);
    return result.rows.map(row => ({ submission_id: row.id, platform: platformOf(row.platform),
        item_id: itemIdFor(row) })).filter(row => row.item_id);
}
async function apply(rows) {
    const result = { updated: 0, stamped: 0, skipped: 0 };
    if (!rows.length) return result;
    await withTransaction(async client => {
        // Lock current rows; a snapshot must not overwrite a concurrent human edit.
        for (const row of [...rows].sort((a, b) => a.submission_id - b.submission_id)) {
            const current = (await client.query(`SELECT s.*, p.brand AS sync_brand,
                p.campaign_type AS sync_campaign_type FROM submissions s
                JOIN projects p ON p.id = s.project_id WHERE s.id = $1 FOR UPDATE OF s`,
            [row.submission_id])).rows[0];
            if (!current || platformOf(current.platform) !== row.platform || itemIdFor(current) !== row.item_id) {
                result.skipped++;
                continue;
            }
            const patch = patchFor(current, row);
            const next = { ...current, ...patch };
            if (maybeStamp(next, stampAtFor(current.sync_brand), current.sync_campaign_type)) {
                patch.perf_stamp = asJson(next.perf_stamp);
                result.stamped++;
            }
            const at = new Date().toISOString();
            patch.ad_synced_at = at;
            patch.updated_at = at;
            await updateRow('submissions', current.id, patch, client);
            result.updated++;
        }
    });
    return result;
}
module.exports = { items, apply };
