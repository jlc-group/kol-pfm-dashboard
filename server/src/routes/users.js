const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../store');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeRole } = require('../data/roles');

const router = express.Router();
router.use(authenticate);

// GET /api/users/options — รายชื่อผู้ใช้แบบย่อ (ชื่อเท่านั้น) สำหรับ dropdown Owner
// ทุกคนที่ล็อกอินเรียกได้ (ไม่ใช่ข้อมูลอ่อนไหว)
router.get('/options', async (req, res, next) => {
    try {
        const all = await store.users.listWithTeam();
        const data = all
            .filter(u => u.is_active)
            .map(u => ({ id: u.id, name: u.full_name || u.username }));
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/users — รายชื่อผู้ใช้ (admin เท่านั้น)
router.get('/', requireRole('admin'), async (req, res, next) => {
    try {
        const data = await store.users.listWithTeam();
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/users — สร้างผู้ใช้ใหม่ (admin เท่านั้น)
router.post('/', requireRole('admin'), async (req, res, next) => {
    try {
        const { username, password, full_name, role, team_id, brands, agency_tokens } = req.body;
        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุ username และ password' });
        }
        const safeRole = normalizeRole(role);
        const password_hash = await bcrypt.hash(password, 10);
        // admin/manager เห็นทุกแบรนด์อยู่แล้ว ไม่ต้องเก็บรายการแบรนด์ให้สับสน
        const safeBrands = safeRole === 'member' && Array.isArray(brands) ? brands.filter(Boolean) : [];
        const safeTokens = safeRole === 'agency' && Array.isArray(agency_tokens) ? agency_tokens.filter(Boolean) : [];
        const data = await store.users.create({ username, password_hash, full_name, role: safeRole, team_id, brands: safeBrands, agency_tokens: safeTokens });
        res.status(201).json({ status: 'success', data });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.message });
        next(err);
    }
});

// PUT /api/users/:id — แก้ไขผู้ใช้ (admin เท่านั้น)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const { full_name, role, team_id, is_active, password, brands, agency_tokens } = req.body;
        const fields = { full_name, team_id };
        if (role) fields.role = normalizeRole(role);
        // เปลี่ยนเป็น admin/manager = ล้างรายการแบรนด์ทิ้ง (เห็นทุกแบรนด์อยู่แล้ว)
        if (fields.role && fields.role !== 'member') fields.brands = [];
        else if (Array.isArray(brands)) fields.brands = brands.filter(Boolean);
        if (fields.role && fields.role !== 'agency') fields.agency_tokens = [];
        else if (Array.isArray(agency_tokens)) fields.agency_tokens = agency_tokens.filter(Boolean);
        if (typeof is_active === 'boolean') fields.is_active = is_active;
        if (password) fields.password_hash = await bcrypt.hash(password, 10);

        const data = await store.users.update(req.params.id, fields);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/users/:id — ลบผู้ใช้ (admin เท่านั้น, ห้ามลบตัวเอง)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
        if (Number(req.params.id) === req.user.id) {
            return res.status(400).json({ status: 'error', message: 'ลบบัญชีตัวเองไม่ได้' });
        }
        const ok = await store.users.remove(req.params.id);
        if (!ok) return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
        res.json({ status: 'success', message: 'ลบผู้ใช้แล้ว' });
    } catch (err) { next(err); }
});

module.exports = router;
