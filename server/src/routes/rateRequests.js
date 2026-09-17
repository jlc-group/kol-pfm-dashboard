const express = require('express');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { allowedBrands, canSeeBrand } = require('../data/roles');

const router = express.Router();
router.use(authenticate);

// คำขอสอบถามราคา (rate card) — ทีมเปิดคำขอ แล้วคนที่ดูแลเรทมาตอบราคาให้
const OPEN = 'open';
const ANSWERED = 'answered';
const CLOSED = 'closed';
const STATUSES = [OPEN, ANSWERED, CLOSED];
const txt = v => { const s = v == null ? '' : String(v).trim(); return s || null; };
// ชื่อคนที่ใช้โชว์ — req.user มาจาก token ซึ่งไม่มีชื่อเล่น ต้องอ่านจาก req.account (ข้อมูลสดจากฐาน)
const actorName = req => (req.account && (req.account.nickname || req.account.full_name)) || req.user.username;

// บันทึกประวัติ (ไม่ให้ error ของ log ไปกระทบ response หลัก) — คำขอเรตไม่ผูกกับแคมเปญ จึงส่ง project_id เป็น null
async function record(req, action, summary) {
    try {
        await store.activity.log({
            user_id: req.user.id, team_id: req.user.team_id, action,
            project_id: null, project_name: 'สอบถามราคา', summary
        });
    } catch { /* เงียบไว้ */ }
}

// POST /api/rate-requests — เปิดคำขอสอบถามราคา
router.post('/', async (req, res, next) => {
    try {
        const { kol_name, link_account, brand, products, platforms, scope, budget, no_budget, brief_link, brief_note,
            request_type, contract_period } = req.body;
        // หน้าเว็บส่งมาเป็นรายชื่อ (1 คน 1 ใบ) — รองรับแบบเดี่ยวไว้ด้วยเผื่อมีของเก่าเรียกอยู่
        const people = Array.isArray(req.body.people) && req.body.people.length
            ? req.body.people.map(p => ({ name: txt(p && p.name), link: txt(p && p.link) })).filter(p => p.name)
            : (txt(kol_name) ? [{ name: txt(kol_name), link: txt(link_account) }] : []);
        if (!people.length) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ KOL' });
        // ค่าที่ไม่รู้จักให้ตกเป็น 'kol' เสมอ (ของเก่าในฐานไม่มีคอลัมน์นี้ ถือเป็น KOL เหมือนกัน)
        const type = request_type === 'presenter' ? 'presenter' : 'kol';
        // ต้องเลือกแบรนด์เสมอ และต้องเป็นแบรนด์ที่ตัวเองมีสิทธิ์ — รายการกรองตามแบรนด์
        // ถ้าไม่มีแบรนด์ member จะมองไม่เห็นคำขอที่ตัวเองเพิ่งเปิด และแก้ไม่ได้อีกเลย
        if (!txt(brand)) return res.status(400).json({ status: 'error', message: 'กรุณาเลือกแบรนด์' });
        if (!canSeeBrand(req.account || req.user, brand)) {
            return res.status(403).json({ status: 'error', message: 'เลือกได้เฉพาะแบรนด์ที่คุณได้รับสิทธิ์' });
        }
        // แยกเป็นคนละใบต่อคน เพราะราคาที่ได้ของแต่ละคนไม่เท่ากัน ต้องตอบและปิดงานแยกกัน
        const created = [];
        for (const p of people) {
            created.push(await store.rateRequests.create({
                kol_name: p.name, link_account: p.link,
                brand, products, platforms, scope, budget, no_budget, brief_link, brief_note,
                request_type: type, contract_period: type === 'presenter' ? contract_period : null,
                created_by: actorName(req), team_id: req.user.team_id
            }));
        }
        await record(req, 'create',
            `เปิดคำขอสอบถามราคา (${type === 'presenter' ? 'Presenter' : 'KOL'}) ${created.length} รายชื่อ: ${people.map(p => p.name).join(', ')}`);
        res.status(201).json({ status: 'success', data: created.length === 1 ? created[0] : created });
    } catch (err) { next(err); }
});

// GET /api/rate-requests — รายการคำขอ (เห็นเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์)
router.get('/', async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const data = await store.rateRequests.list({ scopeBrands });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// PATCH /api/rate-requests/:id — ตอบราคา / เปลี่ยนสถานะ
router.patch('/:id', async (req, res, next) => {
    try {
        const cur = await store.rateRequests.findById(req.params.id);
        if (!cur) return res.status(404).json({ status: 'error', message: 'ไม่พบคำขอนี้' });
        // คำขอที่ไม่ได้ระบุแบรนด์ member จะมองไม่เห็นในรายการอยู่แล้ว จึงต้องกันการแก้ให้ตรงกัน
        const scope = allowedBrands(req.account || req.user);
        const allowed = scope === null || (cur.brand && scope.includes(cur.brand));
        if (!allowed) return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์แก้คำขอของแบรนด์อื่น' });

        const fields = {};
        const hasRate = Object.prototype.hasOwnProperty.call(req.body, 'quoted_rate');
        const hasNote = Object.prototype.hasOwnProperty.call(req.body, 'answer_note');
        if (hasRate) fields.quoted_rate = req.body.quoted_rate === null || req.body.quoted_rate === '' ? null : Number(req.body.quoted_rate) || 0;
        if (hasNote) fields.answer_note = txt(req.body.answer_note);
        if (req.body.status !== undefined) {
            if (!STATUSES.includes(req.body.status)) {
                return res.status(400).json({ status: 'error', message: 'สถานะไม่ถูกต้อง' });
            }
            fields.status = req.body.status;
        }
        // ตอบราคาเมื่อไหร่ก็ประทับชื่อคนตอบกับเวลาให้เอง และดันสถานะจาก "รอตอบ" ขึ้นเป็น "ตอบแล้ว"
        if (hasRate || hasNote) {
            fields.answered_by = actorName(req);
            fields.answered_at = new Date().toISOString();
            if (fields.status === undefined && cur.status === OPEN) fields.status = ANSWERED;
        }
        if (!Object.keys(fields).length) {
            return res.status(400).json({ status: 'error', message: 'ไม่มีข้อมูลที่จะแก้' });
        }

        const data = await store.rateRequests.update(req.params.id, fields);
        await record(req, 'update', fields.status === CLOSED
            ? `ปิดคำขอสอบถามราคา: ${cur.kol_name || ''}`
            : `ตอบราคา ${cur.kol_name || ''}${fields.quoted_rate != null ? ' = ฿' + fields.quoted_rate : ''}`);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

module.exports = router;
