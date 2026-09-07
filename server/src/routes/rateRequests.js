const express = require('express');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { allowedBrands } = require('../data/roles');

const router = express.Router();
router.use(authenticate);

// POST /api/rate-requests — สร้างคำขอสอบถาม Rate Card
router.post('/', async (req, res, next) => {
    try {
        const { kol_name, link_account, brand, products, platforms, scope, budget, no_budget, brief_link, brief_note } = req.body;
        if (!kol_name || !String(kol_name).trim()) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ KOL' });
        }
        const data = await store.rateRequests.create({
            kol_name: String(kol_name).trim(), link_account, brand, products, platforms, scope,
            budget, no_budget, brief_link, brief_note,
            created_by: req.user.full_name || req.user.username, team_id: req.user.team_id
        });
        res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/rate-requests — รายการคำขอ (ตามสิทธิ์ทีม)
router.get('/', async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const data = await store.rateRequests.list({ scopeBrands });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

module.exports = router;
