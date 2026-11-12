const { query } = require('./_base');
const { resolveGroupProducts, resolveGroupTarget, POST_CHECK_WAITING } = require('../logic');
const { expandProductFamilies, familyMapWith } = require('../productFamilies');
const { catalog } = require('./catalog');

const AD_STATUS = 'ยังไม่ยิง';
// เวลาที่แถวเปลี่ยนล่าสุดสำหรับฟีด (ตัวกรอง updated_since / ลำดับ / updated_at ที่ส่งออก)
// รวมเวลาตรวจข้อมูลโพสต์ด้วย (12 พ.ย. 2026) — ทีมกด "ยืนยันถูกต้อง" ไม่ได้ขยับ updated_at (ตาราง submissions ไม่มี trigger)
// ถ้าไม่รวม คลิปที่ถูกกันไว้ตอนรอตรวจ แล้วยืนยันทีหลัง จะไม่ถูกส่งให้ระบบที่ดึงแบบ updated_since อีกเลย · GREATEST ข้ามค่า NULL
const CHANGED_AT = 'GREATEST(COALESCE(s.updated_at, s.submitted_at), s.post_check_at)';

async function listCandidates({ brand, limit = 100, updatedSince = null } = {}) {
    const values = [brand, AD_STATUS, Math.max(1, Math.min(Number(limit) || 100, 501)), POST_CHECK_WAITING];
    const where = [
        'p.brand = $1',
        's.ad_status = $2',
        "s.platform ILIKE 'tiktok%'",
        "NULLIF(BTRIM(s.id_post), '') IS NOT NULL",
        "BTRIM(s.id_post) ~ '^[0-9]+$'",
        // 5 ต.ค. 2026: ไม่ส่งคลิปในกลุ่มที่ตั้งว่าไม่ใช้ Gencode (ไม่ต้องยิงแอด) — กติกาเดียวกับ logic.js postNoGencode
        // (กลุ่ม no_gencode === true และคลิปยังไม่มี Gencode) · @> เทียบกับ jsonb array ของกลุ่ม: มีกลุ่ม key ตรงที่ no_gencode เป็น true
        // ad_groups เป็น JSONB array (NOT NULL DEFAULT '[]') · group_key ว่าง = jsonb null ไม่มีกลุ่มไหนตรง = ไม่ตัด
        "NOT (NULLIF(BTRIM(s.gencode), '') IS NULL AND p.ad_groups @> jsonb_build_array(jsonb_build_object('key', s.group_key, 'no_gencode', true)))",
        // 12 พ.ย. 2026 (ผู้ใช้สั่ง "ทำเลย"): ไม่ส่งคลิปที่ข้อมูลโพสต์ยังรอทีมตรวจ (เอเจนซี่เพิ่งส่ง / ทีมส่งกลับให้แก้) — กติกาเดียวกับหน้า Ads (logic.js postCheckWaiting)
        // เดิมฟีดส่งไปด้วย ระบบยิงแอดยิงโพสต์ที่ทีมยังไม่ยืนยัน · ยืนยันแล้ว (ok) / แก้หลังยิง (changed) / ไม่มีการตรวจ (NULL) = ส่งตามเดิม
        '(s.post_check IS NULL OR NOT (s.post_check = ANY($4::text[])))'
    ];

    if (updatedSince) {
        values.push(updatedSince);
        where.push(`${CHANGED_AT} > $${values.length}`);
    }

    const result = await query(
        `WITH candidates AS (
             SELECT DISTINCT ON (BTRIM(s.id_post))
                    s.id AS submission_id,
                    BTRIM(s.id_post) AS id_post,
                    NULLIF(BTRIM(s.gencode), '') AS gencode,
                    p.brand,
                    s.platform,
                    s.status,
                    s.ad_status,
                    s.post_check,
                    s.post_url,
                    s.post_date,
                    s.product,
                    s.group_key,
                    p.ad_groups,
                    ${CHANGED_AT} AS updated_at
               FROM submissions s
               JOIN projects p ON p.id = s.project_id
              WHERE ${where.join(' AND ')}
              ORDER BY BTRIM(s.id_post), ${CHANGED_AT} DESC, s.id DESC
        )
        SELECT *
          FROM candidates
         ORDER BY updated_at, submission_id
         LIMIT $3`,
        values
    );

    // สีใหม่ที่ Admin เพิ่มในหน้า Products & Targets (7 ต.ค. 2026) กางครบเหมือนสีตั้งต้น · อ่านคลังไม่ได้ = ใช้กลุ่มตั้งต้น (ฟีดไม่ล่ม)
    // + เซ็ตที่ตั้งสินค้าข้างในไว้ (11 พ.ย. 2026) กางเป็นสินค้าข้างใน เช่น JNPSET1 → "JNP1, JNP2, JNP3"
    let familyOf;
    try { familyOf = familyMapWith(await catalog.familyProducts()); } catch { familyOf = undefined; }

    return result.rows.map(row => {
        // Same Product/Target the /ads page shows for this clip.
        const grp = Array.isArray(row.ad_groups) ? row.ad_groups.find(g => g && g.key === row.group_key) : null;
        // Target ยังเลือกจากรหัสที่ KOL รีวิวจริง (Target ตั้งต่อสินค้าได้) — กางทุกสีแค่ช่อง product
        const target = resolveGroupTarget(grp, row.platform, row.product);
        // product = ทุกสีของสินค้าที่คลิปรีวิว (ระบบยิงแอดยิงครอบทุกสี) เหมือนช่อง PRODUCTS หน้า Ads
        // เช่น คลิปรีวิว BTA4-01 → "BTA4-00, BTA4-01, ..., BTA4-07" · คลิปรีวิว JNPSET1 (เซ็ต) → "JNP1, JNP2, JNP3" · สินค้าอื่นส่งตามเดิม
        const products = expandProductFamilies(row.product || resolveGroupProducts(grp, row.platform), familyOf);
        return {
        submission_id: row.submission_id,
        id_post: String(row.id_post),
        gencode: row.gencode || null,
        brand: row.brand,
        platform: row.platform,
        status: row.status,
        ad_status: row.ad_status,
        post_check: row.post_check || null,
        post_url: row.post_url || null,
        post_date: row.post_date || null,
        product: products.length ? products.join(', ') : null,
        target: Array.isArray(target) ? target : (target ? [target] : []),
        updated_at: row.updated_at || null
        };
    });
}

module.exports = { contentExport: { listCandidates } };
