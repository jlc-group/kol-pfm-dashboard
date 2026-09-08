const express = require('express');
const store = require('../store');
const { authenticate, requireRole } = require('../middleware/auth');
const { canSeeCostMetrics } = require('../data/roles');

const router = express.Router();
router.use(authenticate);

// GET /api/kols — KOL ส่วนกลาง (ทุกทีมเห็นเหมือนกัน) + ค้นหา/กรอง
router.get('/', async (req, res, next) => {
    try {
        const { search, platform, category, limit, offset } = req.query;
        const data = await store.kols.list({ search, platform, category, limit, offset });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/kols/used — Influencer ที่ถูกใช้ในแคมเปญ (รวมซ้ำ + แนบผลงาน) — เห็นได้ทุกแบรนด์
router.get('/used', async (req, res, next) => {
    try {
        // หน้าคลัง KOL เปิดให้ทุกคนเห็นเท่ากัน รวมค่าตัวที่แบรนด์อื่นเคยจ่าย
        // (ตกลงกันไว้ว่าให้หา KOL ได้ง่าย ไม่ต้องกั้นตามแบรนด์)
        const scopeBrands = null;
        const data = await store.kols.usedWithCampaigns(scopeBrands);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/kols/analytics — KOL ทุกคนที่คัดเลือกแล้วจากทุกแคมเปญ (สำหรับหน้า KOL Analytics)
router.get('/analytics', async (req, res, next) => {
    try {
        // หน้าคลัง KOL เปิดให้ทุกคนเห็นเท่ากัน รวมค่าตัวที่แบรนด์อื่นเคยจ่าย
        // (ตกลงกันไว้ว่าให้หา KOL ได้ง่าย ไม่ต้องกั้นตามแบรนด์)
        const scopeBrands = null;
        const data = await store.kols.analytics(scopeBrands);
        // ปิดตัวเลขต้นทุนสำหรับคนที่ไม่ใช่ admin/manager — ยังเห็นผล Pass/Fail ได้เหมือนเดิม
        if (!canSeeCostMetrics(req.account || req.user)) {
            (data.rows || []).forEach(r => {
                r.cpm = null; r.cpe = null; r.ad_spend = null; r.total_cost = null;
                if (r.perf_stamp) { r.perf_stamp = { ...r.perf_stamp, cpm: null, cpe: null, ad_spend: null, total_cost: null }; }
            });
        }
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/kols/:id/usages — รายละเอียด Influencer + ประวัติการใช้งาน — เห็นได้ทุกแบรนด์
router.get('/:id/usages', async (req, res, next) => {
    try {
        // หน้าคลัง KOL เปิดให้ทุกคนเห็นเท่ากัน รวมค่าตัวที่แบรนด์อื่นเคยจ่าย
        // (ตกลงกันไว้ว่าให้หา KOL ได้ง่าย ไม่ต้องกั้นตามแบรนด์)
        const scopeBrands = null;
        const data = await store.kols.detailWithUsages(req.params.id, scopeBrands);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ Influencer' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/kols/:id — รายละเอียด KOL
router.get('/:id', async (req, res, next) => {
    try {
        const data = await store.kols.findById(req.params.id);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ KOL' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/kols — เพิ่ม KOL ส่วนกลาง (admin เท่านั้น)
router.post('/', requireRole('admin'), async (req, res, next) => {
    try {
        if (!req.body.name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ KOL' });
        const data = await store.kols.create(req.body);
        res.status(201).json({ status: 'success', data });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.message });
        next(err);
    }
});

// PUT /api/kols/:id — แก้ไข KOL ส่วนกลาง (admin เท่านั้น)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const data = await store.kols.update(req.params.id, req.body);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ KOL' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/kols/:id — ลบ KOL ส่วนกลาง (admin เท่านั้น)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const ok = await store.kols.remove(req.params.id);
        if (!ok) return res.status(404).json({ status: 'error', message: 'ไม่พบ KOL' });
        res.json({ status: 'success', message: 'ลบ KOL แล้ว' });
    } catch (err) { next(err); }
});

module.exports = router;
