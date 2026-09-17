const express = require('express');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { allowedBrands } = require('../data/roles');

const router = express.Router();
router.use(authenticate);

// GET /api/hires — รายชื่อผู้รับงานจากแคมเปญ "งานจ้างอื่น ๆ" ทุกใบ (เห็นเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์)
router.get('/', async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { kind, brand, from, to, search } = req.query;
        const data = await store.hires.list({
            scopeBrands,
            kind: kind || undefined,
            brand: brand || undefined,
            from: from || undefined,
            to: to || undefined,
            search: search || undefined
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});


// GET /api/hires/tasks — ใบขอจัดหา (งานที่ต้องหาคน) เท่าที่ตัวเองมีสิทธิ์เห็น
// mine=find (งานที่ฉันต้องหา) · mine=ask (ใบที่ฉันขอไว้) · ไม่ส่ง = ทั้งหมดที่เห็นได้
router.get('/tasks', async (req, res, next) => {
    try {
        const { mine, status, search, brand } = req.query;
        const data = await store.hires.tasks({
            userId: req.user.id,
            scopeBrands: allowedBrands(req.account || req.user),
            mine: (mine === 'find' || mine === 'ask') ? mine : '',
            status: status || undefined,
            search: search || undefined,
            brand: brand || undefined
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/hires/tasks/count — ตัวเลขแดงบนเมนู (ส่งแค่จำนวน ไม่ต้องลากรายการทั้งหมดไปหน้าเว็บทุกนาที)
router.get('/tasks/count', async (req, res, next) => {
    try {
        const data = await store.hires.tasks({
            userId: req.user.id,
            scopeBrands: allowedBrands(req.account || req.user)
        });
        res.json({ status: 'success', data: data.counts });
    } catch (err) { next(err); }
});

module.exports = router;
