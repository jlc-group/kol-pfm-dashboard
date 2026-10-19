const { query, withTransaction, updateRow, asJson } = require('./_base');
const { platformOf, itemIdFor, patchFor, STUDIO_COLUMNS } = require('../../services/weboostxMetrics');
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
            // ฐานที่ยังไม่ได้เพิ่มคอลัมน์ KOL PFM / รูปปก (ยังไม่รัน setup-db) — ตัดช่องใหม่ทิ้ง ค่าแอดยังซิงก์ได้ตามเดิม
            // (ถ้าเขียนไปทั้งที่ไม่มีคอลัมน์ UPDATE จะล้มแล้วทั้ง batch rollback รวมค่าแอดด้วย)
            STUDIO_COLUMNS.forEach(k => { if (!(k in current)) delete patch[k]; });
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
// ===== รูปปกโพสต์จาก WeBoostX (services/weboostxThumbs.js) =====
// แถวที่มี path รูปจาก WeBoostX ทั้งหมด (โพสต์เดียวกันหลายคลิป = path เดียวกัน · ตัวดาวน์โหลดจัดกลุ่มเอง)
// ฐานที่ยังไม่มีคอลัมน์ (ยังไม่รัน setup-db) — PostgreSQL ตอบ 42703 → คืน null ให้ตัวดาวน์โหลดข้ามรอบนี้
async function thumbRows() {
    try {
        const r = await query(`SELECT id, weboostx_thumbnail_path, thumbnail_local, thumbnail_error FROM submissions
            WHERE weboostx_thumbnail_path IS NOT NULL ORDER BY id`);
        return r.rows;
    } catch (e) {
        if (e && e.code === '42703') return null;
        throw e;
    }
}
// ล็อกแถวเรียงตาม id ก่อนเขียน — ลำดับเดียวกับ apply() (ล็อกทีละแถวตาม id) จึงไม่ deadlock กับรอบซิงก์ที่กดเองระหว่างโหลดรูป
// (ถ้าชนกันแล้วฐานเลือกยกเลิกฝั่งซิงก์ ค่าแอดทั้ง batch จะ rollback)
const LOCK_BY_PATH = `SELECT id FROM submissions WHERE weboostx_thumbnail_path = $1 ORDER BY id FOR UPDATE`;
// ดาวน์โหลดสำเร็จ — ทุกแถวที่ยังชี้ path นี้อยู่ได้สำเนาเดียวกัน (path เปลี่ยนระหว่างโหลด = แถวนั้นไม่โดนแตะ)
async function thumbSaved(thumbPath, filename) {
    const r = await query(`UPDATE submissions s SET thumbnail_local = $2, thumbnail_fetched_at = now(), thumbnail_error = NULL
        FROM (${LOCK_BY_PATH}) t WHERE s.id = t.id`, [thumbPath, filename]);
    return r.rowCount || 0;
}
// ดาวน์โหลดไม่สำเร็จ — จดสาเหตุไว้ ลองใหม่รอบหน้า · ไม่แตะสำเนาเดิม (thumbnail_local)
async function thumbFailed(thumbPath, reason) {
    const r = await query(`UPDATE submissions s SET thumbnail_error = $2 FROM (${LOCK_BY_PATH}) t WHERE s.id = t.id`,
        [thumbPath, String(reason || 'error').slice(0, 120)]);
    return r.rowCount || 0;
}
module.exports = { items, apply, thumbRows, thumbSaved, thumbFailed };
