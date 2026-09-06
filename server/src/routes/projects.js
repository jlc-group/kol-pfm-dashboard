const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const chatHub = require('../services/chatHub');
const store = require('../store');
const tiktok = require('../services/tiktok');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ---------- ที่เก็บไฟล์บรีฟ (ใช้โฟลเดอร์ uploads ร่วมกัน) ----------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// รูปแนบในแชทกับเอเจนซี่ — รูปเท่านั้น
const chatImage = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads')),
        filename: (req, file, cb) => cb(null, `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('แนบได้เฉพาะรูปภาพ'), ok);
    }
});

const briefUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `brief_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.ppt', '.pptx'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับ PDF, รูปภาพ, Word หรือ PowerPoint'), ok);
    }
});

const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };

// ตรวจว่าผู้ใช้มีสิทธิ์แก้ project นี้ไหม (admin ได้ทุกอัน, member เฉพาะทีมตัวเอง)
async function canEditProject(req, projectId) {
    const teamId = await store.projects.findTeamId(projectId);
    if (teamId === undefined) return { ok: false, code: 404, message: 'ไม่พบ Project' };
    if (req.user.role !== 'admin' && teamId !== req.user.team_id) {
        return { ok: false, code: 403, message: 'ไม่มีสิทธิ์แก้ไข Project ของทีมอื่น' };
    }
    return { ok: true };
}

// บันทึกประวัติ (ไม่ให้ error ของ log ไปกระทบ response หลัก)
async function record(req, id, action, summary, projectName, teamId) {
    try {
        let name = projectName, tid = teamId;
        if (name === undefined || tid === undefined) {
            const p = await store.projects.findByIdFull(id);
            if (p) { if (name === undefined) name = p.name; if (tid === undefined) tid = p.team_id; }
        }
        await store.activity.log({
            user_id: req.user.id, team_id: tid ?? req.user.team_id, action,
            project_id: Number(id) || null, project_name: name || null, summary
        });
    } catch { /* เงียบไว้ */ }
}

// GET /api/projects — รายการ Project (admin เห็นหมด / member เห็นเฉพาะทีมตัวเอง)
router.get('/', async (req, res, next) => {
    try {
        const scope = req.user.role === 'admin' ? null : req.user.team_id;
        const data = await store.projects.list(scope);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/projects/chats/all — รายการห้องแชททุกแคมเปญ (ไว้ทำกล่องแชทลอยที่อยู่ทุกหน้า)
router.get('/chats/all', async (req, res, next) => {
    try {
        const scope = req.user.role === 'admin' ? null : req.user.team_id;
        const data = await store.projects.listTeamChats(scope);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});
// GET /api/projects/:id — รายละเอียด + KOL ใน project
router.get('/:id', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const data = await store.projects.findByIdFull(req.params.id);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/projects — สร้าง Project ให้ทีมของตัวเอง
router.post('/', async (req, res, next) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ Project' });

        // member สร้างให้ทีมตัวเอง; admin ระบุ team_id ได้ (fallback = ทีมตัวเอง)
        const teamId = (req.user.role === 'admin' && req.body.team_id) ? req.body.team_id : req.user.team_id;
        if (!teamId) return res.status(400).json({ status: 'error', message: 'ผู้ใช้ยังไม่ได้สังกัดทีม' });

        const data = await store.projects.create({
            ...req.body, team_id: teamId, created_by: req.user.id
        });
        await record(req, data.id, 'create', 'สร้างแคมเปญ', data.name, teamId);
        res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
});

// PUT /api/projects/:id — แก้ไข Project
router.put('/:id', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const bodyKeys = Object.keys(req.body);
        const data = await store.projects.update(req.params.id, { ...req.body, updated_by: req.user.id });
        // ถ้าแก้แค่สถานะ บันทึกเป็น "เปลี่ยนสถานะ" มิฉะนั้นเป็น "แก้ไขข้อมูล"
        const summary = (bodyKeys.length === 1 && bodyKeys[0] === 'status')
            ? `เปลี่ยนสถานะเป็น ${STATUS_LABEL[req.body.status] || req.body.status}`
            : 'แก้ไขข้อมูลแคมเปญ';
        await record(req, req.params.id, 'update', summary, data.name, data.team_id);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id — ลบ Project
router.delete('/:id', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const proj = await store.projects.findByIdFull(req.params.id); // เก็บชื่อก่อนลบ
        await store.projects.remove(req.params.id);
        await record(req, req.params.id, 'delete', 'ลบแคมเปญ', proj ? proj.name : null, proj ? proj.team_id : undefined);
        res.json({ status: 'success', message: 'ลบ Project แล้ว' });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/kols — เพิ่ม KOL เข้า Project
router.post('/:id/kols', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });

        const { kol_id, fee, views, status, notes } = req.body;
        if (!kol_id) return res.status(400).json({ status: 'error', message: 'กรุณาระบุ kol_id' });

        const data = await store.projectKols.add({ project_id: req.params.id, kol_id, fee, views, status, notes });
        const kol = await store.kols.findById(kol_id);
        await record(req, req.params.id, 'add_kol', `เพิ่ม KOL: ${kol ? kol.name : kol_id}`);
        res.status(201).json({ status: 'success', data });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.message });
        next(err);
    }
});

// PUT /api/projects/:id/kols/:linkId — แก้ข้อมูลการใช้งาน KOL (งบ/วิว/ลิงก์ผลงาน/วันที่ลงงาน/สถานะ)
router.put('/:id/kols/:linkId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { fee, views, likes, comments, shares, post_link, posted_date, status, notes } = req.body;
        const data = await store.projectKols.update(req.params.linkId, req.params.id,
            { fee, views, likes, comments, shares, post_link, posted_date, status, notes });
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        await record(req, req.params.id, 'update_kol', 'แก้ข้อมูลผลงาน KOL');
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id/kols/:linkId — เอา KOL ออกจาก Project
router.delete('/:id/kols/:linkId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        await store.projectKols.remove(req.params.linkId, req.params.id);
        await record(req, req.params.id, 'remove_kol', 'เอา KOL ออกจากแคมเปญ');
        res.json({ status: 'success', message: 'เอา KOL ออกจาก Project แล้ว' });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/brief/upload — อัปโหลดไฟล์บรีฟ
router.post('/:id/brief/upload', (req, res, next) => {
    briefUpload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const check = await canEditProject(req, req.params.id);
            if (!check.ok) {
                fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
                return res.status(check.code).json({ status: 'error', message: check.message });
            }
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const data = await store.projects.setBriefFile(req.params.id, meta);
            await record(req, req.params.id, 'brief', 'อัปโหลดไฟล์บรีฟ');
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// GET /api/projects/:id/brief/file — เปิด/ดาวน์โหลดไฟล์บรีฟ
router.get('/:id/brief/file', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const project = await store.projects.findByIdFull(req.params.id);
        const meta = project && project.brief_file;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์บรีฟ' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// POST /api/projects/:id/product-brief/:code/file — อัปโหลดไฟล์บรีฟของสินค้าหนึ่งตัว
router.post('/:id/product-brief/:code/file', (req, res, next) => {
    briefUpload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const check = await canEditProject(req, req.params.id);
            if (!check.ok) { fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {}); return res.status(check.code).json({ status: 'error', message: check.message }); }
            const meta = { filename: req.file.filename, original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), size: req.file.size, uploaded_at: new Date().toISOString() };
            const data = await store.projects.setProductBriefFile(req.params.id, req.params.code, meta);
            await record(req, req.params.id, 'brief', `อัปโหลดบรีฟสินค้า ${req.params.code}`);
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// GET /api/projects/:id/product-brief/:code/file — เปิดไฟล์บรีฟสินค้า (ฝั่งทีม)
router.get('/:id/product-brief/:code/file', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const project = await store.projects.findByIdFull(req.params.id);
        const meta = project && project.product_briefs && project.product_briefs[req.params.code] && project.product_briefs[req.params.code].file;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์บรีฟ' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// POST /api/projects/:id/platform-brief/:platform/file — อัปโหลดไฟล์บรีฟหลักของ Platform
router.post('/:id/platform-brief/:platform/file', (req, res, next) => {
    briefUpload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const check = await canEditProject(req, req.params.id);
            if (!check.ok) { fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {}); return res.status(check.code).json({ status: 'error', message: check.message }); }
            const meta = { filename: req.file.filename, original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), size: req.file.size, uploaded_at: new Date().toISOString() };
            const data = await store.projects.setPlatformBriefFile(req.params.id, req.params.platform, meta);
            await record(req, req.params.id, 'brief', `อัปโหลดบรีฟ Platform ${req.params.platform}`);
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// GET /api/projects/:id/platform-brief/:platform/file — เปิดไฟล์บรีฟ Platform (ฝั่งทีม)
router.get('/:id/platform-brief/:platform/file', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const project = await store.projects.findByIdFull(req.params.id);
        const meta = project && project.platform_briefs && project.platform_briefs[req.params.platform] && project.platform_briefs[req.params.platform].file;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์บรีฟ' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// ---------- Agency Submissions (คัดเลือก KOL จากเอเจนซี่) ----------
const crypto = require('crypto');

// POST /api/projects/:id/share — สร้าง/ดึงลิงก์แชร์ให้ Agency (ลิงก์รวมเดิม)
router.post('/:id/share', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const token = await store.projects.setShareToken(req.params.id, crypto.randomBytes(9).toString('hex'));
        res.json({ status: 'success', token });
    } catch (err) { next(err); }
});

// ===== ลิงก์เอเจนซี่แบบแยกต่อเจ้า (แต่ละเจ้าเห็นเฉพาะ KOL ของตัวเอง) =====
// GET /api/projects/:id/agency-links — รายการลิงก์เอเจนซี่ทั้งหมด
router.get('/:id/agency-links', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        res.json({ status: 'success', data: await store.projects.listAgencyLinks(req.params.id) });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/agency-links — สร้างลิงก์ให้เอเจนซี่เจ้าใหม่
router.post('/:id/agency-links', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { name, products, platforms, kol_count } = req.body;
        const link = await store.projects.addAgencyLink(req.params.id, name, crypto.randomBytes(9).toString('hex'), { products, platforms, kol_count });
        if (!link) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });
        await record(req, req.params.id, 'agency_link', `สร้างลิงก์เอเจนซี่: ${link.name}`);
        res.status(201).json({ status: 'success', data: link });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id/agency-links/:token — ลบลิงก์เอเจนซี่
router.delete('/:id/agency-links/:token', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        // ลบลิงก์แล้วรายชื่อที่ส่งผ่านลิงก์นั้นต้องหายตามไปด้วย ไม่งั้นจะกลายเป็น
        // รายชื่อกำพร้า — หายจากหน้าแคมเปญ แต่ยังไปโผล่ใน Dashboard/Report
        const removed = await store.submissions.removeByAgencyToken(req.params.token, req.params.id);
        const ok = await store.projects.removeAgencyLink(req.params.id, req.params.token);
        if (ok) await record(req, req.params.id, 'remove_agency_link', `ลบลิงก์เอเจนซี่ (รายชื่อที่ส่งผ่านลิงก์นี้ถูกลบ ${removed} คน)`);
        res.json({ status: ok ? 'success' : 'error', data: { removed_submissions: removed } });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/submissions — ทีมเพิ่ม KOL เข้าลิสต์เอง
router.post('/:id/submissions', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { account_name, platform, product, agency, budget, link_account, followers, group_key } = req.body;
        if (!account_name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ Account' });
        const proj = await store.projects.findByIdFull(req.params.id);
        const grp = ((proj && proj.ad_groups) || []).find(g => g.key === group_key);
        const rows = await store.submissions.addPerson({
            project_id: req.params.id, account_name,
            platform: platform || null, product: product || null, agency: agency || null,
            budget: Number(budget) || 0, link_account: link_account || null, followers: Number(followers) || 0,
            group_key: group_key || null   // กลุ่มโฆษณาที่สังกัด — พา Target/Content Type/Photo-VDO/Content Format มาด้วย
        }, (grp && grp.clips) || []);
        const data = rows[0];
        await record(req, req.params.id, 'add_kol', `เพิ่ม KOL: ${account_name}` + (rows.length > 1 ? ` (${rows.length} คลิป)` : ''));
        res.status(201).json({ status: 'success', data, data_all: rows });
    } catch (err) { next(err); }
});

// GET /api/projects/:id/submissions — รายชื่อที่ Agency ส่งเข้ามา (ฝั่งทีม)
router.get('/:id/submissions', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const data = await store.submissions.listByProject(req.params.id);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// PUT /api/projects/:id/submissions/:subId — คัดเลือก/ไม่เลือก (confirmed | rejected | submitted)
router.put('/:id/submissions/:subId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const {
            status, gencode, approved, draft_status,
            draft_link, draft_link2, draft_link3, draft_link4, draft_link5,
            feedback, feedback2, feedback3, feedback4, feedback5,
            post_url, post_date, id_post, code_expire,
            account_name, platform, product, agency, budget, link_account, concept, gen_date, team_note,
            views, likes, comments, saves, shares   // ผลงานคอนเทนต์ จากโมดัล Perf
        } = req.body;
        if (status !== undefined && !['confirmed', 'rejected', 'submitted'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'สถานะไม่ถูกต้อง' });
        }
        const user = await store.users.findById(req.user.id);
        const byName = user ? (user.full_name || user.username) : null;
        const data = await store.submissions.update(req.params.subId, req.params.id, {
            status, gencode, approved, draft_status,
            draft_link, draft_link2, draft_link3, draft_link4, draft_link5,
            feedback, feedback2, feedback3, feedback4, feedback5,
            post_url, post_date, id_post, code_expire,
            account_name, platform, product, agency,
            budget: budget !== undefined ? (Number(budget) || 0) : undefined,
            link_account, concept, gen_date,
            team_note: team_note !== undefined ? ((team_note && String(team_note).trim()) ? String(team_note).trim() : null) : undefined,
            views: views !== undefined ? (Number(views) || 0) : undefined, likes: likes !== undefined ? (Number(likes) || 0) : undefined, comments: comments !== undefined ? (Number(comments) || 0) : undefined, saves: saves !== undefined ? (Number(saves) || 0) : undefined, shares: shares !== undefined ? (Number(shares) || 0) : undefined
        }, byName);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        if (status !== undefined) {
            const label = status === 'confirmed' ? 'คัดเลือก KOL' : status === 'rejected' ? 'ไม่เลือก KOL' : 'รีเซ็ตสถานะ KOL';
            await record(req, req.params.id, 'select_kol', `${label}: ${data.account_name}`);
        } else if (draft_status !== undefined || draft_link !== undefined || feedback !== undefined) {
            await record(req, req.params.id, 'feedback_kol', `Feedback ดราฟ: ${data.account_name}`);
        }
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id/submissions/:subId — ลบรายชื่อออกจากแคมเปญถาวร
router.delete('/:id/submissions/:subId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        // รายชื่อที่มาจากเอเจนซี่ให้ลบได้เฉพาะฝั่งเอเจนซี่ ฝั่งทีมใช้ "ไม่เลือก" แทน
        // ยกเว้นลิงก์นั้นถูกลบไปแล้ว — ไม่งั้นแถวจะค้างและไม่มีใครลบได้เลย
        const target = await store.submissions.get(req.params.subId);
        if (target && target.project_id === Number(req.params.id) && target.agency_token) {
            const proj = await store.projects.findByIdFull(req.params.id);
            const alive = (proj?.agency_links || []).some(l => l.token === target.agency_token);
            if (alive) return res.status(403).json({ status: 'error', message: 'รายชื่อนี้มาจากเอเจนซี่ ให้เอเจนซี่ลบจากลิงก์ของตัวเอง' });
        }
        const gone = await store.submissions.removePerson(req.params.subId, req.params.id);
        if (!gone) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        await record(req, req.params.id, 'remove_kol', `ลบรายชื่อออกจากแคมเปญ: ${gone.account_name}`);
        res.json({ status: 'success', message: `ลบรายชื่อออกจากแคมเปญแล้ว (${gone.removed} คลิป)` });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/submissions/:subId/fetch-tiktok — ดึงสถิติวิดีโอจาก TikTok API (ถ้าตั้งค่าไว้)
router.post('/:id/submissions/:subId/fetch-tiktok', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const sub = await store.submissions.get(req.params.subId);
        if (!sub) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        try {
            const stats = await tiktok.fetchVideoStats(sub.post_url);
            const data = await store.submissions.update(req.params.subId, req.params.id, { ...stats, perf_synced_at: new Date().toISOString() });
            res.json({ status: 'success', data });
        } catch (e) {
            res.status(400).json({ status: 'error', message: e.message, code: e.code });
        }
    } catch (err) { next(err); }
});

// GET /api/projects/:id/agency-reports/:token/:reportId/file — ทีมเปิดไฟล์ Report ที่เอเจนซี่ส่งมา
router.get('/:id/agency-reports/:token/:reportId/file', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const r = await store.projects.getAgencyReport(req.params.id, req.params.token, req.params.reportId);
        if (!r || r.kind !== 'file') return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const fp = path.join(__dirname, '..', '..', 'uploads', r.filename);
        if (!fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(fp);
    } catch (err) { next(err); }
});

// ---------- แชทกับเอเจนซี่ (ฝั่งทีม) ----------
router.get('/:id/agency-links/:token/messages', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const data = await store.projects.listAgencyMessages(req.params.id, req.params.token);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบห้องแชท' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

router.post('/:id/agency-links/:token/messages', (req, res, next) => {
    if (!String(req.headers['content-type'] || '').startsWith('multipart/')) return next();
    chatImage.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }])(req, res, err => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        next();
    });
}, async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const text = String(req.body.text || '').trim();
        const full = req.files && req.files.image && req.files.image[0];
        const thumb = req.files && req.files.thumb && req.files.thumb[0];
        if (!text && !full) return res.status(400).json({ status: 'error', message: 'พิมพ์ข้อความ หรือแนบรูปอย่างน้อยหนึ่งอย่าง' });
        const user = await store.users.findById(req.user.id);
        const row = await store.projects.addAgencyMessage(req.params.id, req.params.token, {
            from: 'team',
            by: user ? (user.full_name || user.username) : 'ทีม',
            text,
            image: full ? { filename: full.filename, original: full.originalname, size: full.size } : null,
            thumb: thumb ? { filename: thumb.filename, original: thumb.originalname, size: thumb.size } : null
        });
        if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบห้องแชท' });
        chatHub.broadcast(req.params.token);
        res.status(201).json({ status: 'success', data: row });
    } catch (err) { next(err); }
});

router.post('/:id/agency-links/:token/messages/read', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        await store.projects.markAgencyRead(req.params.id, req.params.token, 'team');
        res.json({ status: 'success' });
    } catch (err) { next(err); }
});

router.get('/:id/agency-links/:token/messages/:msgId/:which(image|thumb)', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const img = await store.projects.getAgencyMessageImage(req.params.id, req.params.token, req.params.msgId, req.params.which);
        if (!img) return res.status(404).json({ status: 'error', message: 'ไม่พบรูป' });
        const fp = path.join(__dirname, '..', '..', 'uploads', img.filename);
        if (!fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(fp);
    } catch (err) { next(err); }
});

// PATCH / DELETE ข้อความแชทของทีมเอง
router.patch('/:id/agency-links/:token/messages/:msgId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const text = String(req.body.text || '').trim();
        if (!text) return res.status(400).json({ status: 'error', message: 'ข้อความว่างไม่ได้ — ถ้าจะเอาออกให้กดลบแทน' });
        const out = await store.projects.editAgencyMessage(req.params.id, req.params.token, req.params.msgId, 'team', text);
        if (out.error === 404) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อความ' });
        if (out.error === 403) return res.status(403).json({ status: 'error', message: 'แก้ได้เฉพาะข้อความของตัวเอง' });
        if (out.error === 410) return res.status(410).json({ status: 'error', message: 'ข้อความนี้ถูกลบไปแล้ว' });
        chatHub.broadcast(req.params.token);
        res.json({ status: 'success', data: out.data });
    } catch (err) { next(err); }
});

router.delete('/:id/agency-links/:token/messages/:msgId', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const out = await store.projects.deleteAgencyMessage(req.params.id, req.params.token, req.params.msgId, 'team');
        if (out.error === 404) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อความ' });
        if (out.error === 403) return res.status(403).json({ status: 'error', message: 'ลบได้เฉพาะข้อความของตัวเอง' });
        (out.files || []).forEach(f => {
            const fp = path.join(__dirname, '..', '..', 'uploads', f);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ลบไฟล์ไม่ได้ก็ปล่อย */ }
        });
        chatHub.broadcast(req.params.token);
        res.json({ status: 'success', data: out.data });
    } catch (err) { next(err); }
});

module.exports = router;
