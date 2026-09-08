const express = require('express');
const crypto = require('crypto');
const store = require('../store');

const router = express.Router();

// ===== ซิงก์จากระบบยิงแอดของบริษัท =====
// ยืนยันด้วย API key ของตัวเอง ไม่ใช้บัญชีคน (ระบบต่อระบบ) — คีย์อยู่ใน .env
function checkSyncKey(req, res, next) {
    const expected = process.env.ADS_SYNC_KEY;
    if (!expected) {
        return res.status(503).json({ status: 'error', message: 'ยังไม่ได้ตั้ง ADS_SYNC_KEY ในเซิร์ฟเวอร์' });
    }
    const got = req.get('X-Ads-Sync-Key') || '';
    // เทียบแบบเวลาคงที่ กันเดาคีย์ทีละตัวอักษรจากเวลาตอบกลับ
    const a = Buffer.from(String(got));
    const b = Buffer.from(String(expected));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ status: 'error', message: 'API key ไม่ถูกต้อง' });
    next();
}

// POST /api/ads-sync/sync — ระบบยิงแอดส่งค่าแอดสะสม + ผลงานเข้ามาเป็นชุด
// body: { rows: [{ gencode | id_post | submission_id, ad_spend, ad_reach, views, likes, ... }] }
router.post('/sync', checkSyncKey, express.json({ limit: '2mb' }), async (req, res, next) => {
    try {
        const rows = (req.body && req.body.rows) || [];
        if (!Array.isArray(rows)) return res.status(400).json({ status: 'error', message: 'rows ต้องเป็น array' });
        if (rows.length > 2000) return res.status(400).json({ status: 'error', message: 'ส่งได้ครั้งละไม่เกิน 2000 รายการ' });
        const result = await store.adsSync.apply(rows);
        res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
});

module.exports = router;
