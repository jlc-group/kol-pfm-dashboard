const express = require('express');
const store = require('../store');
const { authenticate, parseLimit } = require('../services/kolContentExport');
const { pfmBrandByCode } = require('../store/logic');

// mergeParams: app.js ผูกไว้ที่ /api/integrations/:brand — อ่านรหัสแบรนด์จาก URL ได้
const router = express.Router({ mergeParams: true });

// GET /api/integrations/<brand>/content-candidates — beauterry / jarvit / jernis (logic.js PFM_BRAND_CODES)
// Read-only feed for Beauterry PFM's content importer (one feed per brand, same format). It never changes KOL data.
// 9 ต.ค. 2026 ผู้ใช้สั่งเปิดฟีด Jarvit / Jernis ตามสเปก beauterry-pfm docs/kol-content-sync.md "Multiple brands"
// beauterry (หรือผูก router ไว้ที่ /api/integrations/beauterry ตรง ๆ แบบเดิม) = แบรนด์จาก KOL_CONTENT_EXPORT_BRAND เหมือนเดิมทุกอย่าง
// รหัสที่ไม่รู้จัก = 404 (ตรวจหลังยืนยันรหัสลับ คนไม่มีรหัสลองเดารายชื่อแบรนด์ไม่ได้) · ห้ามถอยไปส่งข้อมูล Beauterry
router.get('/content-candidates', async (req, res, next) => {
    const auth = authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ status: 'error', code: auth.code, message: auth.message });

    const code = String(req.params.brand || 'beauterry').trim().toLowerCase();
    const brand = code === 'beauterry' ? auth.settings.brand : pfmBrandByCode(code);
    if (!brand) {
        return res.status(404).json({ status: 'error', code: 'UNKNOWN_BRAND', message: `Unknown brand '${code.slice(0, 40)}'.` });
    }

    const limit = parseLimit(req.query.limit, auth.settings.maxLimit);
    if (limit === null) {
        return res.status(400).json({ status: 'error', code: 'INVALID_LIMIT', message: `limit must be an integer between 1 and ${auth.settings.maxLimit}.` });
    }

    let updatedSince = null;
    if (req.query.updated_since) {
        const parsed = new Date(String(req.query.updated_since));
        if (!Number.isFinite(parsed.getTime())) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UPDATED_SINCE', message: 'updated_since must be a valid ISO datetime.' });
        }
        updatedSince = parsed.toISOString();
    }

    try {
        const rows = await store.contentExport.listCandidates({
            brand,
            limit: limit + 1,
            updatedSince
        });
        const items = rows.slice(0, limit);
        res.json({
            status: 'success',
            data: {
                count: items.length,
                has_more: rows.length > limit,
                items,
                filters: {
                    brand,
                    platform: 'TikTok',
                    ad_status: 'ยังไม่ยิง'
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
