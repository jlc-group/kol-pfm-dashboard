const { query } = require('./_base');
const { postNoGencode, gencodeDays, gencodeExpireDate } = require('../logic');

// ===== ประตูระบบ /api/integrations/ad-rights (11 พ.ย. 2026) =====
// WeBoostX ดึง "วันสุดท้ายที่ยิงแอดโพสต์ KOL ได้" ไปเตือน / ปิดแอดตามวันนั้น — อ่านอย่างเดียว ไม่แก้ข้อมูล KOL
// แถวที่ส่ง = เกณฑ์เดียวกับหน้า KOL / Ads: ยืนยันแล้ว (confirmed) + มีลิงก์โพสต์ · เฉพาะ Instagram / Facebook (WeBoostX ไม่ดูแล TikTok)
//             · ไม่ส่งแคมเปญ campaign_type = 'other'
// วันหมดสิทธิ์ = วันลงโพสต์ + จำนวนวันของ Gencode (logic.js gencodeExpireDate — สูตรเดียวกับป้าย DAY LEFT) · ยิงได้ถึงสิ้นวันนั้น
// สัญญา: WeBoostX2 docs/KOL_AD_RIGHTS_API.md

const PLATFORMS = ['instagram', 'facebook'];

// เวลาแก้ล่าสุดของแถว (ใช้กับ updated_since): submissions.updated_at ไม่มี trigger — เอาเวลาล่าสุดจากทุกตราเวลาของแถว
// + updated_at ของแคมเปญ (trigger ขยับเอง · แก้จำนวนวัน / "ไม่ใช้ Gencode" ของกลุ่มอยู่ที่แคมเปญ ต้องส่งแถวของแคมเปญนั้นใหม่)
// GREATEST ของ Postgres ข้ามค่า NULL · submitted_at เป็น NOT NULL จึงมีค่าเสมอ
const UPDATED_AT = `GREATEST(
        s.submitted_at, s.updated_at, s.work_updated_at, s.list_updated_at, s.decided_at,
        s.post_date_at, s.gencode_at, s.id_post_at, s.post_url_at, p.updated_at)`;

const BASE_WHERE = [
    "s.status = 'confirmed'",
    "NULLIF(BTRIM(s.post_url), '') IS NOT NULL",
    "LOWER(BTRIM(s.platform)) IN ('instagram', 'facebook')",
    "COALESCE(p.campaign_type, 'kol') <> 'other'"
];

const text = v => { const t = String(v ?? '').trim(); return t || null; };

// วันลงโพสต์ต้องเป็น YYYY-MM-DD ที่มีอยู่จริง (2026-02-30 = ไม่ใช่วัน) — ไม่งั้นถือว่ายังไม่มีวันลงโพสต์
function realDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

// แถวฐานข้อมูล → แถวของฟีด · ใช้ทั้งรายการและสถานะ ตัวเลขสองเส้นจึงมาจากกติกาเดียวกัน
function toFeedRow(row) {
    const groups = Array.isArray(row.ad_groups) ? row.ad_groups : [];
    const group = groups.find(g => g && g.key === row.group_key) || null;
    const noGencode = postNoGencode(row, group);
    const days = gencodeDays(row, noGencode);
    const postDate = realDate(row.post_date);
    const end = noGencode || !postDate ? null : gencodeExpireDate(postDate, days);
    const reason = end ? null : (noGencode ? 'no_gencode' : (!postDate ? 'no_post_date' : 'no_days'));
    return {
        row_id: row.id,
        platform: String(row.platform || '').trim().toLowerCase(),
        brand: text(row.brand),
        creator: text(row.account_name),
        product: text(row.product),
        post_url: text(row.post_url),
        id_post: text(row.id_post),
        gencode: text(row.gencode),
        post_date: postDate,
        days,
        ad_rights_end: end,
        no_end_reason: reason,
        updated_at: row.feed_updated_at,
        post_date_by: text(row.post_date_by)
    };
}

const adRights = {
    // รายการ: เรียงตามเวลาแก้ล่าสุด แล้ว row_id (ผู้ดึงไล่หน้าด้วย offset หรือจำ updated_at ตัวท้ายไปใส่ updated_since)
    async list({ platform = null, updatedSince = null, limit = 500, offset = 0 } = {}) {
        const where = [...BASE_WHERE];
        const values = [];
        if (platform) {
            values.push(platform);
            where.push(`LOWER(BTRIM(s.platform)) = $${values.length}`);
        }
        if (updatedSince) {
            values.push(updatedSince);
            where.push(`${UPDATED_AT} > $${values.length}`);
        }
        const from = `FROM submissions s JOIN projects p ON p.id = s.project_id WHERE ${where.join(' AND ')}`;

        const total = (await query(`SELECT COUNT(*)::int AS n ${from}`, values)).rows[0].n;
        const page = await query(
            `SELECT s.id, s.platform, p.brand, s.account_name, s.product, s.post_url, s.id_post, s.gencode,
                    s.post_date, s.post_date_by, s.code_expire, s.group_key, p.ad_groups,
                    ${UPDATED_AT} AS feed_updated_at
               ${from}
              ORDER BY feed_updated_at, s.id
              LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [...values, limit, offset]
        );
        return { total, rows: page.rows.map(toFeedRow) };
    },

    // สถานะ: จำนวนแถวที่ส่ง · กี่แถวยังไม่มีวันหมดสิทธิ์ · กี่แถวยังไม่มี ID Post (จับคู่กับแอดได้จากลิงก์อย่างเดียว) · แก้ล่าสุดเมื่อไร
    async status() {
        const r = await query(
            `SELECT s.id, s.platform, s.id_post, s.gencode, s.post_date, s.code_expire, s.group_key, p.ad_groups,
                    ${UPDATED_AT} AS feed_updated_at
               FROM submissions s JOIN projects p ON p.id = s.project_id
              WHERE ${BASE_WHERE.join(' AND ')}`
        );
        let withoutEnd = 0, withoutPostId = 0, last = null;
        for (const row of r.rows) {
            const f = toFeedRow(row);
            if (!f.ad_rights_end) withoutEnd += 1;
            if (!f.id_post) withoutPostId += 1;
            const at = f.updated_at ? new Date(f.updated_at) : null;
            if (at && Number.isFinite(at.getTime()) && (!last || at > last)) last = at;
        }
        return {
            rows: r.rows.length,
            rows_without_end: withoutEnd,
            rows_without_post_id: withoutPostId,
            last_updated_at: last ? last.toISOString() : null
        };
    }
};

module.exports = { adRights, PLATFORMS, toFeedRow };
