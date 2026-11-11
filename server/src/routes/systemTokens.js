const express = require('express');
const store = require('../store');
const { requireRole } = require('../middleware/auth');
const { DOORS, MAX_ACTIVE_PER_SCOPE, doorOf, generate } = require('../services/systemTokens');

// ===== หน้า Token ระบบ (เมนู ADMIN · 11 พ.ย. 2026 · มาตรฐาน token ระบบต่อระบบของ JLC) =====
// admin ออก / เพิกถอน token ให้ระบบอื่นมาดึงข้อมูลทางประตูระบบ (services/systemTokens.js DOORS) — ไม่ต้องแก้ .env ไม่ต้อง restart
// token ตัวจริงอยู่ในคำตอบของ POST / ครั้งเดียว — ไม่เก็บ ไม่ลง Activity Log ไม่พิมพ์ลง log · รายการแสดงแค่ 4 ตัวท้าย
// ทุกเส้น admin เท่านั้น (app.js ผูก authenticate + blockPending + blockAgency ไว้ก่อนแล้ว)
const router = express.Router();
router.use(requireRole('admin'));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const actorName = req => (req.account && (req.account.nickname || req.account.full_name)) || (req.user && req.user.username) || null;
const fail = (res, status, message) => res.status(status).json({ status: 'error', message });

async function record(req, action, summary) {
    try {
        await store.activity.log({
            user_id: req.user.id, team_id: req.user.team_id, action,
            project_id: null, project_name: 'Token ระบบ', summary
        });
    } catch { /* บันทึกประวัติพลาดไม่ขวางงานหลัก */ }
}

// ชื่อระบบที่จะใช้ token: ต้องมี · ไม่เกิน 100 ตัว · บรรทัดเดียว
function nameOf(v) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t) return { error: 'กรุณาใส่ชื่อระบบที่จะใช้ token นี้ เช่น WeBoostX' };
    if (t.length > 100) return { error: 'ชื่อระบบยาวเกิน 100 ตัวอักษร' };
    if (/[\r\n]/.test(t)) return { error: 'ชื่อระบบต้องเป็นบรรทัดเดียว' };
    return { value: t };
}

// GET /api/system-tokens — รายการ token (ไม่มีตัวจริง ไม่มี hash) + ประตูที่ออกได้ · ready:false = ยังไม่มีตาราง (ต้องรัน setup-db)
router.get('/', async (_req, res, next) => {
    try {
        const { ready, rows } = await store.systemTokens.list();
        res.json({ status: 'success', data: rows, doors: DOORS, max_active_per_scope: MAX_ACTIVE_PER_SCOPE, ready });
    } catch (err) {
        next(err);
    }
});

// POST /api/system-tokens { name, scope } — ออก token ใหม่ · คำตอบนี้เป็นที่เดียวที่มี token ตัวจริง
router.post('/', async (req, res, next) => {
    const b = req.body || {};
    const name = nameOf(b.name);
    if (name.error) return fail(res, 400, name.error);
    const door = typeof b.scope === 'string' ? doorOf(b.scope) : null;
    if (!door) return fail(res, 400, 'กรุณาเลือกประตูที่จะออก token ให้');

    try {
        const fresh = generate();
        const row = await store.systemTokens.issue({
            name: name.value, scope: door.scope,
            tokenHash: fresh.hash, tokenHint: fresh.hint,
            byId: req.user && req.user.id, byName: actorName(req),
            maxActive: MAX_ACTIVE_PER_SCOPE
        });
        await record(req, 'create', `ออก token ระบบให้ ${row.name} (ประตู ${row.scope} · ลงท้าย …${row.token_hint})`);
        res.status(201).json({ status: 'success', data: row, token: fresh.token });
    } catch (err) {
        if (err && err.status && err.status < 500) return fail(res, err.status, err.message);
        if (err && err.status === 503) return fail(res, 503, err.message);
        next(err);
    }
});

// POST /api/system-tokens/:id/revoke — เพิกถอน (ไม่ลบแถว) · มีผลตั้งแต่คำขอถัดไปของระบบนั้น
router.post('/:id/revoke', async (req, res, next) => {
    try {
        const row = await store.systemTokens.revoke(req.params.id, actorName(req));
        await record(req, 'update', `เพิกถอน token ระบบของ ${row.name} (ประตู ${row.scope} · ลงท้าย …${row.token_hint})`);
        res.json({ status: 'success', data: row });
    } catch (err) {
        if (err && err.status && err.status < 500) return fail(res, err.status, err.message);
        if (err && err.status === 503) return fail(res, 503, err.message);
        next(err);
    }
});

module.exports = router;
