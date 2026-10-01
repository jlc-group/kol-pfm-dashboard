const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { allowedBrands, canSeeBrand } = require('../data/roles');
const { UPLOAD_DIR, uploadPath } = require('../config/uploads');
const { AVATAR_PLATFORMS, detectSocial, normalizeSocials, validateSocials, linkFromSocials } = require('../data/talentSocials');
const { createTalentAvatars, within, pageFor, imageKey, failMessage } = require('../services/talentAvatar');

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
// 1 ต.ค. 2026: ช่องทาง Social หลายช่อง (socials) · งานที่จ้างหลายงานต่อคน (talent_jobs) · รูปการ์ดดึงจากลิงก์ TikTok / YouTube / X ได้เอง
const KIND_OTHER = 'อื่น ๆ';   // ตัวเลือก "อื่น ๆ" ที่ยังไม่ได้พิมพ์ว่าเป็นงานอะไร (client/src/data/hireKinds.js) — ห้ามเก็บเป็นประเภทงาน
const TALENT_MAX = { name: 200, kind: 100, link: 1000, contact_name: 200, contact: 200, agency: 200, rate_unit: 40, scope: 2000, image_link: 1000, clip_link: 1000, note: 1000 };
const TALENT_LABEL = { name: 'ชื่อ', kind: 'ประเภทงาน', link: 'Account', contact_name: 'ชื่อผู้ติดต่อ', contact: 'เบอร์ / LINE', agency: 'ชื่อเอเจนซี่',
    rate_unit: 'หน่วยเรท', scope: 'Scope of work ', image_link: 'ลิงก์รูป', clip_link: 'ลิงก์คลิป', note: 'หมายเหตุ' };
// ช่องทางติดต่อ (ผู้ใช้สั่ง 30 ก.ย. 2026) — ต้องตรงกับ CONTACT_MODES ใน client/src/pages/hires/TalentForm.jsx
//   self = ติดต่อเอง: ชื่อผู้ติดต่อ + เบอร์/LINE · agency = ผ่านเอเจนซี่: ชื่อเอเจนซี่ + ชื่อผู้ติดต่อของเอเจนซี่ (ไม่มีเบอร์)
const CONTACT_MODES = ['self', 'agency'];
// แบรนด์ (เลือกได้หลายแบรนด์ · บังคับอย่างน้อย 1) — รายชื่อแบรนด์อยู่ฝั่งหน้าเว็บ (client/src/data/brands.js) ที่นี่กันแค่รูปแบบ/ขนาด
const TALENT_BRANDS_MAX = 20;
const TALENT_BRAND_LEN = 60;
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
    // ช่องทาง Social หลายช่อง (1 ต.ค. 2026) — ส่งมาแล้ว link (ช่องเดิม) = ลิงก์ของช่องทางแรก ให้โค้ดเก่าที่อ่าน link ยังใช้ได้
    // ไม่ส่งมา (ฟอร์มรุ่นก่อนที่เปิดค้าง) = เส้น POST/PUT แปลง link เป็นช่องทางให้เอง
    if (b.socials !== undefined) {
        const s = validateSocials(b.socials);
        if (s.error) return { error: s.error };
        fields.socials = s.socials;
        fields.link = linkFromSocials(s.socials);
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
    // ตรวจท้ายสุด — ข้อความ error ของช่องอื่นขึ้นก่อน (ฟอร์มโชว์ทีละข้อ)
    if (b.brands !== undefined) {
        if (!Array.isArray(b.brands)) return { error: 'แบรนด์ไม่ถูกต้อง' };
        const list = [...new Set(b.brands.map(textOf).filter(Boolean))];
        if (list.length > TALENT_BRANDS_MAX || list.some(x => x.length > TALENT_BRAND_LEN)) return { error: 'แบรนด์ไม่ถูกต้อง' };
        fields.brands = list;
    }
    if (!partial && b.brands === undefined) {
        // ฟอร์มรุ่นก่อนมีช่องแบรนด์ (เปิดค้างไว้ก่อน deploy) ไม่ส่ง brands มาเลย — กด "เลือกแบรนด์" ไม่ได้ ต้องรีเฟรชก่อน
        return { error: 'หน้าเว็บนี้เป็นรุ่นเก่า — กดรีเฟรชหน้า (F5) แล้วเลือกแบรนด์ก่อนบันทึก' };
    }
    if ((!partial || b.brands !== undefined) && !(fields.brands && fields.brands.length)) {
        return { error: 'เลือกแบรนด์อย่างน้อย 1 แบรนด์' };
    }
    return { fields };
}

// ข้อมูลของแถวสำหรับฟอร์มแก้ไข — ไม่ส่ง id ผู้ใช้ / ชื่อไฟล์ในเครื่อง ออกไป
// source = 'auto' (ดึงจากลิงก์ Social อัตโนมัติ · from = หน้าโปรไฟล์ที่ดึงมา) | 'upload' (ผู้ใช้อัป/วางเอง)
const fileInfo = f => (f && typeof f === 'object' && (f.filename || f.original)
    ? { original: f.original || null, size: Number(f.size) || null,
        source: f.source === 'auto' ? 'auto' : 'upload', ...(f.source === 'auto' && isWebUrl(String(f.from || '')) ? { from: f.from } : {}) }
    : null);
const talentOut = (t, req) => ({
    id: t.id, name: t.name, kind: t.kind, link: t.link || null, brands: Array.isArray(t.brands) ? t.brands : [],
    // ช่องทาง Social [{ platform, handle, url }] — แถวเก่าที่มีแค่ link แปลงเป็น 1 ช่องทาง (ไม่หาย)
    socials: normalizeSocials(t.socials, t.link),
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

// ===================== งานที่จ้าง (talent_jobs · ผู้ใช้สั่ง 1 ต.ค. 2026) =====================
// คนหนึ่งมีได้หลายงาน · เพิ่ม/แก้/ลบได้เฉพาะคนที่แก้การ์ดนั้นได้ (คนที่เพิ่ม / admin) และเฉพาะแบรนด์ที่ตัวเองมีสิทธิ์
// เห็นตามสิทธิ์แบรนด์เหมือนงานในแท็บอื่น — งานของแบรนด์ที่ไม่มีสิทธิ์ไม่ขึ้นทั้งในรายการและตัวเลขบนการ์ด
const viewerOf = req => req.account || req.user;
const JOB_MAX = { scope: 2000, work_link: 1000, note: 1000 };
const JOB_LABEL = { scope: 'Scope of work ', work_link: 'ลิงก์ผลงาน', note: 'หมายเหตุ' };
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thMonth = d => { const m = /^(\d{4})-(\d{2})/.exec(String(d || '')); return m ? `${TH_MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}` : ''; };
// วันที่จ้าง: 'YYYY-MM-DD' หรือ 'YYYY-MM' (ช่องเลือกเดือน → วันที่ 1) → 'YYYY-MM-DD' · ว่าง = '' · ผิดรูป/ไม่มีวันนั้นจริง = null
function hiredDate(v) {
    const s = textOf(v);
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = m[3] ? Number(m[3]) : 1;
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
    return `${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`;
}
// ตรวจค่าจากฟอร์มงานที่จ้าง → { fields } หรือ { error } · partial = แก้ไข (ส่งมาเฉพาะช่องที่แก้)
function jobInput(body, { partial = false } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const fields = {};
    if (!partial || b.brand !== undefined) {
        const brand = textOf(b.brand);
        if (!brand) return { error: 'เลือกแบรนด์' };
        if (brand.length > TALENT_BRAND_LEN) return { error: 'แบรนด์ไม่ถูกต้อง' };
        fields.brand = brand;
    }
    if (!partial || b.hired_on !== undefined) {
        const d = hiredDate(b.hired_on);
        if (d === '') return { error: 'ใส่เดือนที่จ้าง' };
        if (!d) return { error: 'วันที่จ้างไม่ถูกต้อง' };
        fields.hired_on = d;
    }
    if (b.fee !== undefined) {
        const raw = typeof b.fee === 'string' ? b.fee.replace(/,/g, '').trim() : b.fee;
        if (raw === null || raw === '') fields.fee = null;
        else {
            const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
            if (!Number.isFinite(n) || n < 0) return { error: 'ค่าตัวต้องเป็นตัวเลข 0 ขึ้นไป' };
            if (n > RATE_MAX) return { error: 'ค่าตัวสูงเกินไป (ไม่เกิน 1,000,000,000 บาท)' };
            fields.fee = Math.round(n * 100) / 100;
        }
    }
    for (const k of Object.keys(JOB_MAX)) {
        if (b[k] === undefined) continue;
        const v = textOf(b[k]);
        if (v.length > JOB_MAX[k]) return { error: `${JOB_LABEL[k]}ยาวเกิน ${JOB_MAX[k]} ตัวอักษร` };
        fields[k] = v || null;
    }
    if (fields.work_link && !isWebUrl(fields.work_link)) return { error: 'ลิงก์ผลงานต้องขึ้นต้นด้วย http:// หรือ https://' };
    return { fields };
}
// งานหนึ่งงานที่ส่งออก — ไม่ส่ง id ผู้ใช้ · editable = คนที่ดูแก้การ์ดนี้ได้ และมีสิทธิ์แบรนด์ของงานนี้
const jobOut = (j, req, t) => ({
    id: j.id, talent_id: j.talent_id, brand: j.brand, hired_on: j.hired_on || null,
    fee: j.fee == null ? null : Number(j.fee), scope: j.scope || null, work_link: j.work_link || null, note: j.note || null,
    added_by: j.created_by || null, created_at: j.created_at || null, updated_at: j.updated_at || null,
    editable: canManageTalent(req, t) && canSeeBrand(viewerOf(req), j.brand)
});
// ข้อมูลเต็มของคนหนึ่งคน (ฟอร์มแก้ไข / หน้ารายละเอียด) = ข้อมูลการ์ด + งานที่จ้างที่เห็นได้ (ใหม่สุดก่อน)
async function talentDetail(t, req) {
    const jobs = await store.talentJobs.listByTalent(t.id, { scopeBrands: allowedBrands(viewerOf(req)) });
    return { ...talentOut(t, req), jobs_count: jobs.length, jobs: jobs.map(j => jobOut(j, req, t)) };
}
const jobLine = (t, j) => `"${t.name}" — ${j.brand}${thMonth(j.hired_on) ? ` (${thMonth(j.hired_on)})` : ''}`;

// ===================== รูปโปรไฟล์จากลิงก์ Social (services/talentAvatar.js) =====================
// บันทึกก่อน ดึงทีหลัง — รอผลได้ไม่เกิน AUTO_WAIT_MS ช้ากว่านั้นตอบไปก่อน (image_fetch.status = 'pending') รูปขึ้นเองเมื่อดึงเสร็จ
const AUTO_WAIT_MS = 6000;
const avatars = createTalentAvatars({
    dir: UPLOAD_DIR,
    setFile: (...a) => store.talents.setFile(...a),
    removeFile: meta => removeTalentFile(meta)
});
// เริ่มดึง (กดซ้ำ/บันทึกซ้อนลิงก์เดิม = งานเดียวกัน) · ดึงสำเร็จบันทึกประวัติครั้งเดียว ไม่ว่าจะรอผลทันหรือไม่
// expect = รูปของแถวตอนเริ่ม — ระหว่างดึงมีรูปใหม่กว่า (ผู้ใช้อัป/วางเอง · ดึงอันอื่นเสร็จก่อน) = ไม่ทับ ไม่ลบรูปนั้น
function startImage(req, t, source, force) {
    const job = avatars.run(t.id, source, { force, expect: imageKey(t.image) });
    if (!job.logged) {
        job.logged = true;
        job.then(out => (out && out.ok ? logTalent(req, 'update', `Talent Book: ดึงรูปโปรไฟล์จาก ${out.platform} ของ "${t.name}"`) : null)).catch(() => {});
    }
    return job;
}
// ไม่ได้ดึง: ไม่มีรูป + มีช่องทางแต่ดึงอัตโนมัติไม่ได้ (Instagram / Facebook / ลิงก์ย่อ / ลิงก์คลิป) → บอกให้วาง/อัปรูปเอง
// มีช่อง TikTok / YouTube / X ที่ไม่ใช่หน้าช่อง (เช่นลิงก์คลิป) บอกเรื่องนั้นก่อน — แก้ลิงก์แล้วระบบดึงให้ได้
function noFetchInfo(t) {
    if (t.image) return { status: 'none' };
    const list = normalizeSocials(t.socials, t.link);
    const first = list.find(s => AVATAR_PLATFORMS.includes(s.platform)) || list[0];
    if (!first) return { status: 'none' };
    const code = AVATAR_PLATFORMS.includes(first.platform) ? 'not-profile' : 'unsupported';
    return { status: 'none', platform: first.platform, message: failMessage(code, first.platform) };
}
// หลังเพิ่ม/แก้: ไม่มีรูป (หรือรูปที่ดึงไว้มาจากช่องทางที่ถูกเปลี่ยนไปแล้ว) + มีลิงก์ TikTok / YouTube / X → ดึงรูปให้
// ห้ามแทนรูปที่ผู้ใช้อัป/วางเอง · auto_image: false (ฟอร์มกำลังจะอัปรูปที่ผู้ใช้เลือกต่อ) = ไม่ต้องดึง
async function autoImage(req, t, wanted) {
    if (!wanted) return { row: t, info: { status: 'none' } };
    const plan = avatars.planAuto(t);
    if (!plan) return { row: t, info: noFetchInfo(t) };
    const out = await within(startImage(req, t, plan, false), AUTO_WAIT_MS);
    if (!out) return { row: t, info: { status: 'pending', platform: plan.social.platform } };
    if (out.ok) return { row: out.row, info: { status: 'done', platform: out.platform } };
    // kept = ผู้ใช้อัปรูปเองระหว่างดึง · stale = ลิงก์/รูปถูกเปลี่ยนระหว่างดึง (การบันทึกที่ใหม่กว่าเริ่มดึงของตัวเองแล้ว)
    if (out.code === 'kept' || out.code === 'stale') return { row: out.row || t, info: { status: 'none' } };
    return { row: t, info: { status: 'failed', platform: out.platform, message: out.message } };
}
// หน้าโปรไฟล์ที่ดึงรูปได้ของช่องทางที่ "บันทึกไว้จริง" — แถวเก่าที่ยังไม่เคยบันทึก socials (มีแค่ link) = ว่าง
// (บันทึกครั้งแรกด้วยฟอร์มใหม่จึงนับว่าช่องทางเปลี่ยน → ดึงรูปให้ได้)
const savedAvatarPages = t => (Array.isArray(t && t.socials) && t.socials.length
    ? avatars.sourcesOf(t).map(s => s.page).join('\n') : '');
const sameSocials = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// POST /api/hires/talents — เพิ่มคนเข้า Talent Book
// ตอบ data = ข้อมูลเต็ม (แบบ GET /talents/:id) + image_fetch = ผลดึงรูปโปรไฟล์จากลิงก์ { status: done|pending|failed|none, platform?, message? }
router.post('/talents', async (req, res, next) => {
    try {
        const { fields, error } = talentInput(req.body);
        if (error) return res.status(400).json({ status: 'error', message: error });
        // ฟอร์มรุ่นก่อนส่งแค่ link → แปลงเป็นช่องทาง
        if (fields.socials === undefined) fields.socials = normalizeSocials([], fields.link);
        const dup = await store.talents.findByKey(fields.name, fields.kind);
        if (dup) return res.status(409).json({ status: 'error', message: dupMessage(dup, req), data: { id: dup.id } });
        let row;
        try { row = await store.talents.create(fields, { byId: req.user.id, byName: byNameOf(req) }); }
        catch (e) { if (isDupKey(e)) return dupReply(req, res, fields); throw e; }
        await logTalent(req, 'create', `Talent Book: เพิ่ม "${row.name}" (${row.kind})`);
        const img = await autoImage(req, row, !(req.body && req.body.auto_image === false));
        res.status(201).json({ status: 'success', data: await talentDetail(img.row, req), image_fetch: img.info });
    } catch (err) { next(err); }
});

// GET /api/hires/talents/:id — ข้อมูลเต็มของคนที่เพิ่มเอง (ฟอร์มแก้ไข / หน้ารายละเอียด) + งานที่จ้าง (jobs ใหม่สุดก่อน · jobs_count)
router.get('/talents/:id', async (req, res, next) => {
    try {
        const t = await store.talents.findById(req.params.id);
        if (!t) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
        res.json({ status: 'success', data: await talentDetail(t, req) });
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
        // ฟอร์มรุ่นก่อน (ไม่ส่ง socials) แก้ช่อง Account → ช่องทางเปลี่ยนตาม · link เดิมไม่เปลี่ยน = ช่องทางคงเดิม
        if (fields.socials === undefined && fields.link !== undefined && (fields.link || null) !== (acc.talent.link || null)) {
            fields.socials = normalizeSocials([], fields.link);
        }
        // ช่องทางที่ส่งมาเหมือนที่บันทึกไว้ (รวมแถวเก่าที่แปลงจาก link ให้ฟอร์ม) = ไม่เขียน link ใหม่
        // — ข้อความ Account เดิม (ยาว / หลายบรรทัด) ต้องอยู่ครบทุกตัวอักษร แม้แก้แค่ช่องอื่น
        if (fields.socials !== undefined && sameSocials(fields.socials, normalizeSocials(acc.talent.socials, acc.talent.link))) {
            delete fields.link;
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
        // แก้ข้อมูล: ดึงรูปเองเฉพาะตอนช่องทางที่ดึงรูปได้เปลี่ยนในการบันทึกนี้ (หรือรูปที่ดึงไว้มาจากช่องทางที่ถูกเปลี่ยน/ลบแล้ว)
        // — ผู้ใช้เอารูปออกเองแล้วแก้ช่องอื่น รูปต้องไม่กลับมาเอง (อยากได้คืนกด "ดึงรูปจากลิงก์") · เพิ่มใหม่ (POST) ดึงเสมอ
        const wanted = !(req.body && req.body.auto_image === false)
            && (savedAvatarPages(acc.talent) !== savedAvatarPages(row) || !!(row.image && row.image.source === 'auto'));
        const img = await autoImage(req, row, wanted);
        res.json({ status: 'success', data: await talentDetail(img.row, req), image_fetch: img.info });
    } catch (err) { next(err); }
});

// POST /api/hires/talents/:id/fetch-image — ปุ่ม "ดึงรูปจากลิงก์" (คนที่แก้การ์ดได้เท่านั้น)
// body.url (ไม่บังคับ) = ลิงก์ที่จะดึง (เช่นลิงก์ที่เพิ่งพิมพ์ในฟอร์ม) · ไม่ส่ง = ช่องทางแรกที่ดึงได้ของคนนี้
// กดเอง = แทนรูปเดิมได้ทุกแบบ (รวมรูปที่อัปเอง) · ดึงไม่ได้ → 422 + ข้อความบอกให้วาง (Ctrl+V) / อัปรูปเอง
router.post('/talents/:id/fetch-image', async (req, res, next) => {
    try {
        const acc = await talentAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const raw = req.body && req.body.url;
        let source = null;
        if (raw !== undefined && raw !== null && raw !== '') {
            const det = typeof raw === 'string' && raw.length <= 1000 ? detectSocial(raw) : null;
            if (!det) return res.status(400).json({ status: 'error', message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' });
            const page = pageFor(det);
            if (!page) {
                const code = AVATAR_PLATFORMS.includes(det.platform) ? 'not-profile' : 'unsupported';
                return res.status(422).json({ status: 'error', message: failMessage(code, det.platform), data: { code } });
            }
            source = { social: det, page };
        } else {
            source = avatars.sourcesOf(acc.talent)[0] || null;
            if (!source) {
                const info = noFetchInfo({ ...acc.talent, image: null });
                const code = info.message ? (AVATAR_PLATFORMS.includes(info.platform) ? 'not-profile' : 'unsupported') : 'no-link';
                return res.status(422).json({ status: 'error', message: info.message || failMessage('no-link'), data: { code } });
            }
        }
        const out = await startImage(req, acc.talent, source, true);
        if (!out.ok) {
            // stale = ระหว่างดึงมีคนอัป/วางรูปใหม่ (รูปนั้นชนะ ไม่ถูกทับ/ลบ)
            const status = out.code === 'gone' ? 404 : out.code === 'stale' ? 409 : 422;
            return res.status(status).json({ status: 'error', message: out.message, data: { code: out.code } });
        }
        res.json({ status: 'success', data: await talentDetail(out.row, req), image_fetch: { status: 'done', platform: out.platform } });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------- งานที่จ้าง
// ตรวจว่ามีงานนี้ของคนนี้ และคนที่ขอมีสิทธิ์แบรนด์ของงาน (ไม่มีสิทธิ์ = ไม่พบ — ไม่บอกว่ามีงานของแบรนด์อื่นอยู่)
async function jobAccess(req) {
    const acc = await talentAccess(req);
    if (!acc.ok) return acc;
    const job = await store.talentJobs.findById(acc.talent.id, req.params.jobId);
    if (!job || !canSeeBrand(viewerOf(req), job.brand)) return { ok: false, code: 404, message: 'ไม่พบงานนี้' };
    return { ok: true, talent: acc.talent, job };
}

// POST /api/hires/talents/:id/jobs — เพิ่มงานที่จ้าง { brand*, hired_on* (YYYY-MM-DD | YYYY-MM), fee, scope, work_link, note }
router.post('/talents/:id/jobs', async (req, res, next) => {
    try {
        const acc = await talentAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const { fields, error } = jobInput(req.body);
        if (error) return res.status(400).json({ status: 'error', message: error });
        if (!canSeeBrand(viewerOf(req), fields.brand)) return res.status(403).json({ status: 'error', message: 'เพิ่มงานได้เฉพาะแบรนด์ที่คุณดูแล' });
        const job = await store.talentJobs.create(acc.talent.id, fields, { byId: req.user.id, byName: byNameOf(req) });
        if (!job) return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' });
        await logTalent(req, 'create', `Talent Book: เพิ่มงานที่จ้าง ${jobLine(acc.talent, job)}`);
        res.status(201).json({ status: 'success', data: jobOut(job, req, acc.talent) });
    } catch (err) { next(err); }
});

// PUT /api/hires/talents/:id/jobs/:jobId — แก้งาน (ส่งมาเฉพาะช่องที่แก้ก็ได้)
router.put('/talents/:id/jobs/:jobId', async (req, res, next) => {
    try {
        const acc = await jobAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const { fields, error } = jobInput(req.body, { partial: true });
        if (error) return res.status(400).json({ status: 'error', message: error });
        if (fields.brand !== undefined && !canSeeBrand(viewerOf(req), fields.brand)) {
            return res.status(403).json({ status: 'error', message: 'ย้ายงานไปแบรนด์ที่คุณไม่ได้ดูแลไม่ได้' });
        }
        const job = await store.talentJobs.update(acc.talent.id, acc.job.id, fields);
        if (!job) return res.status(404).json({ status: 'error', message: 'ไม่พบงานนี้' });
        await logTalent(req, 'update', `Talent Book: แก้งานที่จ้าง ${jobLine(acc.talent, job)}`);
        res.json({ status: 'success', data: jobOut(job, req, acc.talent) });
    } catch (err) { next(err); }
});

// DELETE /api/hires/talents/:id/jobs/:jobId — ลบงาน
router.delete('/talents/:id/jobs/:jobId', async (req, res, next) => {
    try {
        const acc = await jobAccess(req);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const job = await store.talentJobs.remove(acc.talent.id, acc.job.id);
        if (!job) return res.status(404).json({ status: 'error', message: 'ไม่พบงานนี้' });
        await logTalent(req, 'delete', `Talent Book: ลบงานที่จ้าง ${jobLine(acc.talent, job)}`);
        res.json({ status: 'success', data: { id: job.id } });
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
// byMime = ช่องรูป: ไฟล์ที่ไม่มีนามสกุลเลย (วางรูปจากคลิปบอร์ด Ctrl+V — เบราว์เซอร์บางตัวตั้งชื่อ "blob") ใช้ชนิดไฟล์แทน
// เฉพาะ PNG / JPG / WEBP · มีนามสกุลแต่ไม่อยู่ในรายการ (เช่น .exe) ยังไม่รับเหมือนเดิม
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const extOf = (file, exts, byMime) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (exts.includes(ext)) return ext;
    return byMime && !ext && MIME_EXT[file.mimetype] ? MIME_EXT[file.mimetype] : null;
};
const talentUpload = (prefix, exts, maxMb, message, byMime = false) => multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `${prefix}_${Number(req.params.id) || 0}_${Date.now()}${extOf(file, exts, byMime) || ''}`)
    }),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = !!extOf(file, exts, byMime);
        cb(ok ? null : new Error(message), ok);
    }
});
const TALENT_FILES = {
    image: talentUpload('talent', ['.png', '.jpg', '.jpeg', '.webp', '.pdf'], 10, 'รองรับรูปภาพ (PNG/JPG/WEBP) หรือไฟล์ PDF คอมการ์ด ไม่เกิน 10MB', true),
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
                const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
                const meta = {
                    filename: req.file.filename,
                    // ไฟล์ที่วางมาไม่มีนามสกุล ("blob") — เติมนามสกุลตามชนิดไฟล์ให้ชื่อที่โชว์ในฟอร์มอ่านรู้เรื่อง
                    original: path.extname(original) ? original : original + path.extname(req.file.filename),
                    size: req.file.size,
                    uploaded_at: new Date().toISOString()
                };
                const out = await store.talents.setFile(acc.talent.id, field, meta);
                if (!out) { drop(); return res.status(404).json({ status: 'error', message: 'ไม่พบคนนี้ใน Talent Book' }); }
                committed = true;
                removeTalentFile(out.old);
                await logTalent(req, 'update', `Talent Book: อัปโหลด${FILE_WORD[field]}ของ "${out.row.name}"`);
                res.json({ status: 'success', data: await talentDetail(out.row, req) });
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
            res.json({ status: 'success', data: await talentDetail(out.row, req) });
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
