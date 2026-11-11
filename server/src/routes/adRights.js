const express = require('express');
const store = require('../store');
const { machineDoor } = require('../services/systemTokens');
const { PLATFORMS } = require('../store/pg/adRights');

// ===== ประตูระบบ /api/integrations/ad-rights (11 พ.ย. 2026) =====
// WeBoostX ดึงวันสุดท้ายที่ยิงแอดโพสต์ KOL ได้ (Instagram / Facebook) — อ่านอย่างเดียว
// เปิดได้ด้วย token ระบบ scope 'ad-rights' ทาง header X-KOL-Ad-Rights-Key เท่านั้น (admin ออกจากหน้า Token ระบบ)
// ล็อกอินของคน (Authorization: Bearer) และ token ใน query string เปิดไม่ได้ — machineDoor ไม่อ่านสองทางนั้นเลย
// สัญญา: WeBoostX2 docs/KOL_AD_RIGHTS_API.md
const router = express.Router();
router.use(machineDoor('ad-rights'));

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;
const bad = (res, code, message) => res.status(400).json({ status: 'error', code, message });

// ตัวเลขล้วนเท่านั้น ('10abc', '-1', '1.5' = ผิด) · ไม่ส่งมา = ค่าเริ่ม
function wholeNumber(value, fallback) {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
    return Number(value);
}

// GET /api/integrations/ad-rights?platform=&updated_since=&limit=&offset=
router.get('/', async (req, res, next) => {
    let platform = null;
    if (req.query.platform !== undefined && req.query.platform !== '') {
        platform = typeof req.query.platform === 'string' ? req.query.platform.trim().toLowerCase() : '';
        if (!PLATFORMS.includes(platform)) return bad(res, 'INVALID_PLATFORM', 'platform ต้องเป็น instagram หรือ facebook');
    }

    const limit = wholeNumber(req.query.limit, DEFAULT_LIMIT);
    if (limit === null || limit < 1 || limit > MAX_LIMIT) {
        return bad(res, 'INVALID_LIMIT', `limit ต้องเป็นจำนวนเต็ม 1–${MAX_LIMIT}`);
    }
    const offset = wholeNumber(req.query.offset, 0);
    if (offset === null) return bad(res, 'INVALID_OFFSET', 'offset ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');

    let updatedSince = null;
    if (req.query.updated_since !== undefined && req.query.updated_since !== '') {
        const parsed = typeof req.query.updated_since === 'string' ? new Date(req.query.updated_since) : new Date(NaN);
        if (!Number.isFinite(parsed.getTime())) {
            return bad(res, 'INVALID_UPDATED_SINCE', 'updated_since ต้องเป็นเวลาแบบ ISO 8601 พร้อมเขตเวลา เช่น 2026-11-10T09:00:00Z');
        }
        updatedSince = parsed.toISOString();
    }

    try {
        const { total, rows } = await store.adRights.list({ platform, updatedSince, limit, offset });
        res.json({
            status: 'success',
            data: {
                count: rows.length,
                total,
                has_more: offset + rows.length < total,
                generated_at: new Date().toISOString(),
                rows
            }
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/integrations/ad-rights/status — ปุ่ม "ทดสอบการเชื่อมต่อ" ฝั่ง WeBoostX + ความครบของข้อมูล
router.get('/status', async (_req, res, next) => {
    try {
        res.json({ status: 'success', data: await store.adRights.status() });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
