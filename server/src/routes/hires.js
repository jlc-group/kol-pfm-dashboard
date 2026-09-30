const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { allowedBrands } = require('../data/roles');
const { UPLOAD_DIR, uploadPath } = require('../config/uploads');

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

// GET /api/hires/book — Talent Book: คอมการ์ดทุกคนที่เคยเสนอ/บันทึกไว้ให้แบรนด์ (Booked / Casting) เห็นเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์
// ชื่อที่เสนอในใบขอให้หาก็ตามสิทธิ์แบรนด์ — คนช่วยหาที่ถูกมอบใบข้ามแบรนด์ ไม่ได้เห็นรายชื่อย้อนหลังทั้งแบรนด์ไปด้วย
// ไม่มีตัวกรองฝั่ง server: ส่งทั้งชุดไปให้หน้าเว็บกรอง/ค้นเอง (ตัวเลขบนชิป ทั้งหมด/Booked/Casting ต้องนับจากชุดเต็ม)
router.get('/book', async (req, res, next) => {
    try {
        const data = await store.hires.book({
            scopeBrands: allowedBrands(req.account || req.user),
            // การ์ดที่เพิ่มเองบอกว่าคนที่ดูอยู่แก้ได้ไหม (คนที่เพิ่ม / admin) — ตัดสินที่ server ไม่ส่ง id ผู้ใช้ออกไป
            userId: req.user && req.user.id, isAdmin: !!req.user && req.user.role === 'admin'
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/hires/jobs — รายการงานจ้างอื่น ๆ รายงาน (เห็นเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์)
router.get('/jobs', async (req, res, next) => {
    try {
        const data = await store.hires.jobs({ scopeBrands: allowedBrands(req.account || req.user) });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/hires/tasks — ใบขอให้หา (งานที่ต้องหาคน) เท่าที่ตัวเองมีสิทธิ์เห็น · แต่ละใบมีชื่อคนขอ (requested_by_name) และเวลาที่ขอ
// mine=todo (ถึงตาฉัน) · mine=find (งานที่ฉันต้องหา) · mine=ask (ใบที่ฉันขอไว้) · ไม่ส่ง = ทั้งหมดที่เห็นได้
// project=<id งาน> = เฉพาะใบของงานนั้น (หน้างาน) · ว่าง = ไม่กรอง · ไม่ใช่ตัวเลข → 400
// (ไม่ปล่อยผ่านเป็น "ไม่กรอง" เพราะหน้างานจะได้ใบของงานอื่นทั้งหมดไปแสดงเป็นของงานตัวเอง)
router.get('/tasks', async (req, res, next) => {
    try {
        const { mine, status, search, brand, project } = req.query;
        let projectId = null;
        if (project !== undefined && project !== '') {
            const n = typeof project === 'string' && /^\d{1,10}$/.test(project) ? Number(project) : NaN;
            if (!Number.isSafeInteger(n) || n > 2147483647) {
                return res.status(400).json({ status: 'error', message: 'รหัสงานไม่ถูกต้อง' });
            }
            projectId = n;
        }
        const data = await store.hires.tasks({
            userId: req.user.id,
            scopeBrands: allowedBrands(req.account || req.user),
            mine: (mine === 'find' || mine === 'ask' || mine === 'todo') ? mine : '',
            status: status || undefined,
            search: search || undefined,
            brand: brand || undefined,
            project: projectId
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/hires/tasks/count — ตัวเลขแดงบนเมนู (ส่งแค่จำนวน ไม่ต้องลากรายการทั้งหมดไปหน้าเว็บทุกนาที)
// ทุกหน้าเรียกเส้นนี้ทุก 60 วินาที — ไม่โหลดชื่อผู้ใช้ (withNames: false) เพราะตัวเลขไม่ต้องใช้
router.get('/tasks/count', async (req, res, next) => {
    try {
        const data = await store.hires.tasks({
            userId: req.user.id,
            scopeBrands: allowedBrands(req.account || req.user),
            withNames: false
        });
        res.json({ status: 'success', data: data.counts });
    } catch (err) { next(err); }
});

// ===================== Talent Book: คนที่ทีมเพิ่มเอง (ไม่ต้องมีงาน) =====================
// ผู้ใช้สั่ง 29 ก.ย. 2026 — ทุกคนในทีมเห็น (ไม่ผูกแบรนด์) · แก้/ลบ/เปลี่ยนไฟล์ได้เฉพาะคนที่เพิ่ม และ admin
// คนเดียวกัน = ชื่อ + ประเภทงาน (ไม่สนตัวพิมพ์) — ห้ามซ้ำในตาราง talents (การ์ดเดียวต้องมีแถวให้แก้แถวเดียว)
// คนที่มาจากงานที่ชื่อ + ประเภทงานตรงกัน รวมเป็นการ์ดเดียวที่ store.hires.book()
const KIND_OTHER = 'อื่น ๆ';   // ตัวเลือก "อื่น ๆ" ที่ยังไม่ได้พิมพ์ว่าเป็นงานอะไร (client/src/data/hireKinds.js) — ห้ามเก็บเป็นประเภทงาน
const TALENT_MAX = { name: 200, kind: 100, link: 1000, contact_name: 200, contact: 200, agency: 200, rate_unit: 40, scope: 2000, image_link: 1000, clip_link: 1000, note: 1000 };
const TALENT_LABEL = { name: 'ชื่อ', kind: 'ประเภทงาน', link: 'Account', contact_name: 'ชื่อผู้ติดต่อ', contact: 'เบอร์ / LINE', agency: 'ชื่อเอเจนซี่',
    rate_unit: 'หน่วยเรท', scope: 'Scope of work ', image_link: 'ลิงก์รูป', clip_link: 'ลิงก์คลิป', note: 'หมายเหตุ' };
// ช่องทางติดต่อ (ผู้ใช้สั่ง 30 ก.ย. 2026) — ต้องตรงกับ CONTACT_MODES ใน client/src/pages/hires/TalentForm.jsx
//   self = ติดต่อเอง: ชื่อผู้ติดต่อ + เบอร์/LINE · agency = ผ่านเอเจนซี่: ชื่อเอเจนซี่ + ชื่อผู้ติดต่อของเอเจนซี่ (ไม่มีเบอร์)
const CONTACT_MODES = ['self', 'agency'];
// หน่วยของเรทราคา — ต้องตรงกับตัวเลือกในฟอร์ม (client/src/pages/hires/TalentForm.jsx)
const RATE_UNITS = ['ต่อวัน', 'ต่องาน', 'ต่อชั่วโมง', 'ต่อโพสต์', 'ต่อคลิป'];
const RATE_MAX = 1e9;
const isWebUrl = v => /^https?:\/\/\S+$/i.test(v);
const textOf = v => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// ตรวจค่าจากฟอร์ม → { fields } หรือ { error } · partial = แก้ไข (ส่งมาเฉพาะช่องที่มี)
function talentInput(body, { partial = false } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const fields = {};
    for (const k of Object.keys(TALENT_MAX)) {
        if (b[k] === undefined) continue;
        const v = textOf(b[k]);
        if (v.length > TALENT_MAX[k]) return { error: `${TALENT_LABEL[k]}ยาวเกิน ${TALENT_MAX[k]} ตัวอักษร` };
        fields[k] = v || null;
    }
    if (!partial || b.name !== undefined) {
        if (!fields.name) return { error: 'ใส่ชื่อก่อนนะ' };
    }
    if (!partial || b.kind !== undefined) {
        if (!fields.kind) return { error: 'เลือกประเภทงาน' };
        if (fields.kind === KIND_OTHER) return { error: 'ระบุว่าเป็นงานอะไร (พิมพ์ในช่องใต้ "อื่น ๆ")' };
    }
    for (const k of ['image_link', 'clip_link']) {
        if (fields[k] && !isWebUrl(fields[k])) return { error: `${TALENT_LABEL[k]}ต้องขึ้นต้นด้วย http:// หรือ https://` };
    }
    if (b.rate !== undefined) {
        const raw = typeof b.rate === 'string' ? b.rate.replace(/,/g, '').trim() : b.rate;
        if (raw === null || raw === '') fields.rate = null;
        else {
            const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
            if (!Number.isFinite(n) || n < 0) return { error: 'เรทราคาต้องเป็นตัวเลข 0 ขึ้นไป' };
            if (n > RATE_MAX) return { error: 'เรทราคาสูงเกินไป (ไม่เกิน 1,000,000,000 บาท)' };
            fields.rate = Math.round(n * 100) / 100;
        }
    }
    if (fields.rate_unit && !RATE_UNITS.includes(fields.rate_unit)) return { error: 'หน่วยเรทไม่ถูกต้อง' };
    if (b.contact_mode !== undefined) {
        const m = textOf(b.contact_mode);
        if (m && !CONTACT_MODES.includes(m)) return { error: 'ช่องทางติดต่อไม่ถูกต้อง' };
        fields.contact_mode = m || null;
        // ช่องที่ไม่ใช่ของแบบที่เลือกล้างทิ้ง — ข้อมูลที่ซ่อนอยู่ในฟอร์มไม่ค้างในฐาน
        if (m === 'self') fields.agency = null;
        if (m === 'agency') fields.contact = null;
    }
    return { fields };
}

// ข้อมูลของแถวสำหรับฟอร์มแก้ไข — ไม่ส่ง id ผู้ใช้ / ชื่อไฟล์ในเครื่อง ออกไป
const fileInfo = f => (f && typeof f === 'object' && (f.filename || f.original)
    ? { original: f.original || null, size: Number(f.size) || null } : null);
const talentOut = (t, req) => ({
    id: t.id, name: t.name, kind: t.kind, link: t.link || null,
    contact_mode: t.contact_mode || null, contact_name: t.contact_name || null, contact: t.contact || null, agency: t.agency || null,
    rate: t.rate == null ? null : Number(t.rate), rate_unit: t.rate_unit || null, scope: t.scope || null,
    image: fileInfo(t.image), image_link: t.image_link || null,
    clip: fileInfo(t.clip), clip_link: t.clip_link || null,
    note: t.note || null, added_by: t.created_by || null,
    created_at: t.created_at || null, updated_at: t.updated_at || null,
    editable: canManageTalent(req, t)
});
const canManageTalent = (req, t) => !!req.user && (req.user.role === 'admin'
    || (t.created_by_id != null && String(t.created_by_id) === String(req.user.id)));
const byNameOf = req => {
    const a = req.account || {};
    return textOf(a.nickname) || textOf(a.full_name) || textOf(a.username) || textOf(req.user && req.user.username) || null;
};
// คนที่แก้การ์ดเดิมได้ (คนที่เพิ่ม / admin) บอกให้กดแก้ไข · คนอื่นไม่มีปุ่มแก้ไข บอกให้ค้นหาการ์ดเดิมแทน
const dupMessage = (t, req) => `มี "${t.name}" (${t.kind}) ใน Talent Book แล้ว — ${canManageTalent(req, t)
    ? 'กดแก้ไขที่การ์ดเดิมได้เลย'
    : 'ค้นชื่อในแท็บนี้เพื่อดูการ์ดเดิม (แก้ได้เฉพาะคนที่เพิ่มการ์ดนั้น หรือผู้ดูแลระบบ)'}`;
// ชนกับ unique index (กดเพิ่ม/แก้ชื่อพร้อมกันสองคน ผ่านด่าน findByKey มาทั้งคู่) → 409 แบบเดียวกับเช็คปกติ
const isDupKey = err => err && err.code === '23505';
async function dupReply(req, res, fields) {
    const dup = await store.talents.findByKey(fields.name, fields.kind);
    return res.status(409).json({ status: 'error', message: dup ? dupMessage(dup, req) : 'มีคนนี้ใน Talent Book แล้ว', data: dup ? { id: dup.id } : null });
}
// ประวัติการแก้ไข (Activity Log) — ไม่ผูกงาน · บันทึกไม่สำเร็จไม่ขวางงานหลัก
async function logTalent(req, action, summary) {
    try {
        await store.activity.log({ user_id: req.user.id, team_id: req.user.team_id, action, project_id: null, project_name: null, summary });
    } catch { /* เงียบไว้ */ }
}
// ลบไฟล์ของคนใน Talent Book — ไฟล์ของตาราง talents ไม่ถูกใช้ร่วมกับที่อื่น ลบได้เลย
const removeTalentFile = meta => {
    const fp = meta && typeof meta === 'object' && meta.filename ? uploadPath(meta.filename) : null;
    if (fp) fs.unlink(fp, () => {});
};

// POST /api/hires/talents — เพิ่มคนเข้า Talent Book
router.post('/talents', async (req, res, next) => {
    try {
        const { fields, error } = talentInput(req.body);
        if (error) return res.status(400).json({ status: 'error', message: error });
        const dup = await store.talents.findByKey(fields.name, fields.kind);
        if (dup) return res.status(409).json({ status: 'error', message: dupMessage(dup, req), data: { id: dup.id } });
        let row;
        try { row = await store.talents.create(fields, { byId: req.user.id, byName: byNameOf(req) }); }
        catch (e) { if (isDupKey(e)) return dupReply(req, res, fields); throw e; }
        await logTalent(req, 'create', `Talent Book: เพิ่ม "${row.name}" (${row.kind})`);
        res.status(201).json({ status: 'success', data: talentOut(row, req) });
    } catch (err) { next(err); }
});

// GET /api/hires/talents/:id — ข้อมูลเต็มของคนที่เพิ่มเอง (ฟอร์มแก้ไข)
router.get('/talents/:id', async (req, res, next) => {
    try {
        const t = await store.talents.findById(req.params.id);
        if (!t) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
        res.json({ status: 'success', data: talentOut(t, req) });
    } catch (err) { next(err); }
});

// ตรวจว่ามีแถวนี้ และคนที่ขอเป็นคนเพิ่ม / admin — ใช้ทั้งเส้นแก้/ลบ และวางไว้หน้า multer (ไม่ให้คนไม่มีสิทธิ์ส่งไฟล์มาเขียนลงเครื่อง)
async function talentAccess(req) {
    const t = await store.talents.findById(req.params.id);
    if (!t) return { ok: false, code: 404, message: 'ไม่พบคนนี้ใน Talent Book' };
    if (!canManageTalent(req, t)) return { ok: false, code: 403, message: 'แก้ได้เฉพาะคนที่เพิ่มการ์ดนี้ หรือผู้ดูแลระบบ' };
    return { ok: true, talent: t };
}
const guardTalent = (req, res, next) => talentAccess(req)
    .then(a => (a.ok ? next() : res.status(a.code).json({ status: 'error', message: a.message })))
    .catch(next);

// PUT /api/hires/talents/:id — แก้ข้อมูล (ส่งมาเฉพาะช่องที่แก้ก็ได้)
router.put('/talents/:id', async (req, res, next) => {
    try {
        const acc = await talentAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const { fields, error } = talentInput(req.body, { partial: true });
        if (error) return res.status(400).json({ status: 'error', message: error });
        // ไม่ได้ส่งช่องทางติดต่อมา (แก้บางช่อง / หน้าเว็บรุ่นเก่าที่ยังเปิดค้าง) → ยึดแบบที่บันทึกไว้ ช่องของอีกแบบห้ามกลับเข้ามา
        if (fields.contact_mode === undefined) {
            if (acc.talent.contact_mode === 'self' && fields.agency !== undefined) fields.agency = null;
            if (acc.talent.contact_mode === 'agency' && fields.contact !== undefined) fields.contact = null;
        }
        const name = fields.name !== undefined ? fields.name : acc.talent.name;
        const kind = fields.kind !== undefined ? fields.kind : acc.talent.kind;
        const dup = await store.talents.findByKey(name, kind, acc.talent.id);
        if (dup) return res.status(409).json({ status: 'error', message: dupMessage(dup, req), data: { id: dup.id } });
        let row;
        try { row = await store.talents.update(acc.talent.id, fields); }
        catch (e) { if (isDupKey(e)) return dupReply(req, res, { name, kind }); throw e; }
        if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
        await logTalent(req, 'update', `Talent Book: แก้ข้อมูล "${row.name}" (${row.kind})`);
        res.json({ status: 'success', data: talentOut(row, req) });
    } catch (err) { next(err); }
});

// DELETE /api/hires/talents/:id — ลบออกจาก Talent Book (การ์ดที่มาจากงานยังอยู่ตามงาน)
router.delete('/talents/:id', async (req, res, next) => {
    try {
        const acc = await talentAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const row = await store.talents.remove(acc.talent.id);
        if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
        removeTalentFile(row.image);
        removeTalentFile(row.clip);
        await logTalent(req, 'delete', `Talent Book: ลบ "${row.name}" (${row.kind})`);
        res.json({ status: 'success', data: { id: row.id } });
    } catch (err) { next(err); }
});

// ไฟล์รูป/คอมการ์ด (รูป หรือ PDF 10MB) และคลิปผลงาน (95MB — ต่ำกว่าเพดาน 100MB ของ Cloudflare) · อัปใหม่ = แทนที่ของเดิม
const talentUpload = (prefix, exts, maxMb, message) => multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `${prefix}_${Number(req.params.id) || 0}_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = exts.includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error(message), ok);
    }
});
const TALENT_FILES = {
    image: talentUpload('talent', ['.png', '.jpg', '.jpeg', '.webp', '.pdf'], 10, 'รองรับรูปภาพ (PNG/JPG/WEBP) หรือไฟล์ PDF คอมการ์ด ไม่เกิน 10MB'),
    clip: talentUpload('talentvid', ['.mp4', '.mov', '.m4v', '.webm'], 95, 'รองรับคลิป MP4 / MOV / WEBM ขนาดไม่เกิน 95MB')
};
const FILE_WORD = { image: 'รูป/คอมการ์ด', clip: 'คลิปผลงาน' };

for (const field of ['image', 'clip']) {
    // POST /api/hires/talents/:id/image|clip — อัปโหลด (แทนที่ไฟล์เดิม)
    router.post(`/talents/:id/${field}`, guardTalent, (req, res, next) => {
        TALENT_FILES[field].single('file')(req, res, async err => {
            if (err) {
                const tooBig = err && err.code === 'LIMIT_FILE_SIZE';
                return res.status(400).json({ status: 'error', message: tooBig ? `ไฟล์ใหญ่เกินไป (${FILE_WORD[field]})` : err.message });
            }
            if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
            const drop = () => fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
            let committed = false;
            try {
                const acc = await talentAccess(req);   // เช็คซ้ำ — สิทธิ์อาจเปลี่ยนระหว่างอัป
                if (!acc.ok) { drop(); return res.status(acc.code).json({ status: 'error', message: acc.message }); }
                const meta = {
                    filename: req.file.filename,
                    original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                    size: req.file.size,
                    uploaded_at: new Date().toISOString()
                };
                const out = await store.talents.setFile(acc.talent.id, field, meta);
                if (!out) { drop(); return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' }); }
                committed = true;
                removeTalentFile(out.old);
                await logTalent(req, 'update', `Talent Book: อัปโหลด${FILE_WORD[field]}ของ "${out.row.name}"`);
                res.json({ status: 'success', data: talentOut(out.row, req) });
            } catch (e) { if (!committed) drop(); next(e); }
        });
    });

    // DELETE /api/hires/talents/:id/image|clip — เอาไฟล์ออก
    router.delete(`/talents/:id/${field}`, async (req, res, next) => {
        try {
            const acc = await talentAccess(req);
            if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
            const out = await store.talents.setFile(acc.talent.id, field, null);
            if (!out) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
            removeTalentFile(out.old);
            res.json({ status: 'success', data: talentOut(out.row, req) });
        } catch (err) { next(err); }
    });

    // GET /api/hires/talents/:id/image|clip — เปิดไฟล์ (ทุกคนในทีมเห็น เหมือนการ์ด) · sendFile รองรับการกรอคลิปให้เอง
    router.get(`/talents/:id/${field}`, async (req, res, next) => {
        try {
            const t = await store.talents.findById(req.params.id);
            const meta = t && t[field];
            if (!meta || !meta.filename) return res.status(404).json({ status: 'error', message: `ยังไม่มี${FILE_WORD[field]}ของคนนี้` });
            const fp = uploadPath(meta.filename);
            if (!fp || !fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
            res.sendFile(fp);
        } catch (err) { next(err); }
    });
}

module.exports = router;
