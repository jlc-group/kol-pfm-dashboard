const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../store');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeRole, STATUSES, hasBrandList } = require('../data/roles');
const { displayName, nameKey, cleanNickname, nameTaken } = require('../data/userNames');

const router = express.Router();
router.use(authenticate);

// GET /api/users/options — รายชื่อผู้ใช้แบบย่อ (ชื่อเท่านั้น) สำหรับ dropdown Owner
// ทุกคนที่ล็อกอินเรียกได้ (ไม่ใช่ข้อมูลอ่อนไหว)
router.get('/options', async (req, res, next) => {
    try {
        const all = await store.users.listWithTeam();
        // เอาเฉพาะคนที่อนุมัติแล้วและไม่ใช่บัญชีเอเจนซี่ — คนพวกนี้คือคนที่ดูแลแคมเปญได้จริง
        // ใช้ชื่อเล่นเป็นหลัก เพราะทีมเรียกกันด้วยชื่อเล่น
        const data = all
            .filter(u => u.is_active !== false && (u.status || 'active') === 'active' && u.role !== 'agency')
            .map(u => ({ id: u.id, name: u.nickname || u.full_name || u.username }))
            .sort((a, b) => a.name.localeCompare(b.name, 'th'));
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/users/agency-options — บัญชีเอเจนซี่ทั้งหมด (ไว้เลือกตอนสร้างลิงก์ในหน้าแคมเปญ)
// คนในทีมที่สร้างลิงก์ได้ต้องเรียกได้ด้วย ไม่ใช่แค่ admin — ส่งไปแค่ id/ชื่อ/ลิงก์ที่ถืออยู่
router.get('/agency-options', async (req, res, next) => {
    try {
        res.json({ status: 'success', data: await store.users.listAgencies() });
    } catch (err) { next(err); }
});

// GET /api/users/pending-count — จำนวนคนที่รออนุมัติ (ไว้ทำตัวเลขแจ้งเตือนบนเมนู)
router.get('/pending-count', requireRole('admin'), async (req, res, next) => {
    try {
        res.json({ status: 'success', data: { count: await store.users.countPending() } });
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
        // ชื่อที่แสดง (ไม่บังคับ) — กติกาเดียวกับที่เจ้าของบัญชีแก้เอง (data/userNames.js · 28 ต.ค. 2026)
        const nick = cleanNickname(req.body.nickname === undefined ? null : req.body.nickname, { allowEmpty: true });
        if (nick.error) return res.status(400).json({ status: 'error', message: nick.error });
        const nickname = nick.value || null;
        const safeRole = normalizeRole(role);
        // ตรวจชื่อที่จะโชว์จริง (ไม่ใส่ชื่อที่แสดง = โชว์ชื่อเต็ม / username) ไม่ใช่แค่ช่องชื่อที่แสดง (ผลรีวิว 28 ต.ค. รอบ 2)
        const shown = displayName({ nickname, full_name, username: String(username).trim() });
        if (safeRole !== 'agency' && nameTaken(await store.users.listWithTeam(), null, shown)) {
            return res.status(409).json({ status: 'error', message: `มีคนใช้ชื่อ "${shown}" แล้ว — ใส่ชื่อที่แสดงให้ต่างกัน` });
        }
        const password_hash = await bcrypt.hash(password, 10);
        // member / manager เก็บแบรนด์ที่ดูได้ · admin เห็นทุกแบรนด์อยู่แล้ว ไม่ต้องเก็บรายการแบรนด์ให้สับสน
        const safeBrands = hasBrandList(safeRole) && Array.isArray(brands) ? brands.filter(Boolean) : [];
        const safeTokens = safeRole === 'agency' && Array.isArray(agency_tokens) ? agency_tokens.filter(Boolean) : [];
        // admin สร้างให้เอง = อนุมัติทันที ไม่ต้องรอ
        const data = await store.users.create({ username, password_hash, full_name, nickname, role: safeRole, team_id, brands: safeBrands, agency_tokens: safeTokens, status: 'active' });
        res.status(201).json({ status: 'success', data });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.message });
        next(err);
    }
});

// PUT /api/users/:id — แก้ไขผู้ใช้ (admin เท่านั้น)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
    try {
        const { username, full_name, role, team_id, is_active, password, brands, agency_tokens, status } = req.body;
        const fields = { full_name, team_id };
        if (username && String(username).trim()) fields.username = String(username).trim();
        // สถานะบัญชี: pending (รออนุมัติ) / active (อนุมัติแล้ว) / rejected (ปฏิเสธ)
        if (status && STATUSES.includes(status)) fields.status = status;
        if (role) fields.role = normalizeRole(role);
        // เปลี่ยนเป็น admin / agency = ล้างรายการแบรนด์ทิ้ง (admin เห็นทุกแบรนด์อยู่แล้ว) · member / manager เก็บแบรนด์ที่ส่งมา
        if (fields.role && !hasBrandList(fields.role)) fields.brands = [];
        else if (Array.isArray(brands)) fields.brands = brands.filter(Boolean);
        if (fields.role && fields.role !== 'agency') fields.agency_tokens = [];
        else if (Array.isArray(agency_tokens)) fields.agency_tokens = agency_tokens.filter(Boolean);
        if (typeof is_active === 'boolean') fields.is_active = is_active;
        if (password) fields.password_hash = await bcrypt.hash(password, 10);
        // ชื่อที่แสดง — Admin ตั้ง / ล้างให้ได้ ('' = กลับไปโชว์ชื่อเต็ม / username) · หน้าเว็บส่งมาเฉพาะตอน Admin แก้ช่องนี้จริง
        // (ไม่งั้นฟอร์มที่เปิดค้างไว้จะเขียนทับชื่อที่เจ้าของเพิ่งแก้เอง · ผลรีวิว 28 ต.ค.)
        if (req.body.nickname !== undefined) {
            const nick = cleanNickname(req.body.nickname, { allowEmpty: true });
            if (nick.error) return res.status(400).json({ status: 'error', message: nick.error });
            fields.nickname = nick.value;
        }
        // แก้ชื่อ (ชื่อที่แสดง / username) แล้วชื่อที่โชว์จริงเปลี่ยน → ห้ามซ้ำคนอื่น — รวมกรณีล้างชื่อที่แสดงจนกลับไปโชว์ชื่อเต็ม / username (ผลรีวิว 28 ต.ค. รอบ 2)
        // อนุมัติ / เปลี่ยนสิทธิ์ / เปิดบัญชีคืน ไม่ตรวจ (ไม่ขวางงานเดิมของ Admin) · ชื่อเดิมที่ซ้ำกันอยู่แล้วไม่ขวางการแก้ช่องอื่น
        if (fields.nickname !== undefined || fields.username) {
            const cur = await store.users.findById(req.params.id);
            if (!cur) return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
            const next = { ...cur };
            for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) next[k] = v;   // กติกาเดียวกับ store.users.update
            const shown = displayName(next);
            if (next.role !== 'agency' && nameKey(shown) !== nameKey(displayName(cur))
                && nameTaken(await store.users.listWithTeam(), cur.id, shown)) {
                return res.status(409).json({ status: 'error', message: `มีคนใช้ชื่อ "${shown}" แล้ว — ตั้งชื่อที่แสดงให้ต่างกัน` });
            }
        }

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
