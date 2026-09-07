const express = require('express');
const store = require('../store');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
// ประวัติการแก้ไข — admin เท่านั้น
router.use(authenticate, requireRole('admin'));

// GET /api/activity — ประวัติการสร้าง/แก้ไข (ฟิลเตอร์: user_id, project_id, from, to)
router.get('/', async (req, res, next) => {
    try {
        const { user_id, project_id, from, to } = req.query;
        const data = await store.activity.list({
            scopeBrands: null, // หน้านี้ admin เท่านั้น จึงเห็นทุกแบรนด์เสมอ
            user_id: user_id || undefined,
            project_id: project_id || undefined,
            from: from || undefined,
            to: to || undefined
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/activity/actors — รายชื่อผู้ใช้ที่เคยมีประวัติ (สำหรับ dropdown ฟิลเตอร์)
router.get('/actors', async (req, res, next) => {
    try {
        const data = await store.activity.actors(null);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

module.exports = router;
