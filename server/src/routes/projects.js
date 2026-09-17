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
const { UPLOAD_DIR, uploadPath } = require('../config/uploads');
const { mergeHireItems, mergeBriefFiles, hireRowFee, cleanFee, cleanHeadcount, safeId } = require('../store/logic');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// รูปแนบในแชทกับเอเจนซี่ — รูปเท่านั้น
const chatImage = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
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
        filename: (req, file, cb) => cb(null, `brief_${safeId(req.params.id)}_${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.ppt', '.pptx'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับ PDF, รูปภาพ, Word หรือ PowerPoint'), ok);
    }
});

// รูป/คอมการ์ดของผู้รับงานในแคมเปญงานจ้างอื่น ๆ — 1 ไฟล์ต่อ 1 คน (อัปใหม่ = แทนที่ของเดิม)
const hireImage = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `hire_${safeId(req.params.id)}_${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับรูปภาพ (PNG/JPG/WEBP) หรือไฟล์ PDF คอมการ์ด'), ok);
    }
});


// คลิปแนะนำตัวของคนที่ถูกเสนอเข้ามา — ไฟล์ใหญ่กว่ารูปมาก จึงแยกตัวรับไฟล์และเพดานขนาดออกจากกัน
const hireVideo = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `hirevid_${safeId(req.params.id)}_${Date.now()}${path.extname(file.originalname)}`)
    }),
    // Cloudflare (แผนปกติ) รับอัปโหลดได้ไม่เกิน 100MB ต่อคำขอ — ตั้งต่ำกว่านั้นเผื่อหัวคำขอ ไม่งั้นไฟล์ใหญ่จะโดนตัดกลางทางแบบไม่มีข้อความ
    limits: { fileSize: 95 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.mp4', '.mov', '.m4v', '.webm'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับคลิป MP4 / MOV / WEBM ขนาดไม่เกิน 95MB'), ok);
    }
});

const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };

// ตรวจว่าผู้ใช้มีสิทธิ์แก้ project นี้ไหม (admin ได้ทุกอัน, member เฉพาะทีมตัวเอง)
async function canEditProject(req, projectId) {
    const proj = await store.projects.findByIdFull(projectId);
    if (!proj) return { ok: false, code: 404, message: 'ไม่พบ Project' };
    // สิทธิ์แก้ไขยึดตามแบรนด์ของแคมเปญ (admin/manager แก้ได้ทุกแบรนด์)
    if (!canSeeBrand(req.account || req.user, proj.brand)) {
        return { ok: false, code: 403, message: 'ไม่มีสิทธิ์แก้ไขแคมเปญของแบรนด์อื่น' };
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

// ---------- งานจ้างอื่น ๆ: ตัวช่วยกลาง ----------
// คนจัดหาที่ฟอร์มเลือกมา → ตรวจกับฐานผู้ใช้จริง (ใช้งานอยู่ ไม่ใช่บัญชีเอเจนซี่) แล้วคืนชื่อที่ถูกต้อง
async function resolveAssignees(items) {
    const ids = [...new Set((Array.isArray(items) ? items : [])
        .map(it => it && it.assignee_id)
        .filter(v => v !== null && v !== undefined && v !== '')
        .map(String))];
    const users = {};
    for (const id of ids) {
        const u = await store.users.findById(id);
        if (u && u.is_active !== false && (u.status || 'active') === 'active' && u.role !== 'agency') {
            users[String(u.id)] = { id: u.id, name: u.nickname || u.full_name || u.username };
        }
    }
    return users;
}

// ชื่อไฟล์ที่ยังมีแถวไหนอ้างถึงอยู่ — คนที่ถูกเลือกไปแล้วใช้ไฟล์คอมการ์ดร่วมกับชื่อที่เสนอในใบ ห้ามลบไฟล์นั้น
function referencedFiles(items) {
    const set = new Set();
    (Array.isArray(items) ? items : []).forEach(it => {
        if (!it) return;
        if (it.image && it.image.filename) set.add(it.image.filename);
        (Array.isArray(it.candidates) ? it.candidates : []).forEach(c => {
            if (c && c.image && c.image.filename) set.add(c.image.filename);
            if (c && c.video && c.video.filename) set.add(c.video.filename);
        });
    });
    return set;
}

// ลบไฟล์เฉพาะเมื่อไม่มีแถวไหนใช้อยู่แล้ว และชื่อไฟล์ต้องอยู่ในโฟลเดอร์อัปโหลดจริงเท่านั้น
function removeFileIfUnused(meta, items) {
    if (!meta || !meta.filename) return;
    if (referencedFiles(items).has(meta.filename)) return;
    const p = uploadPath(meta.filename);
    if (p) fs.unlink(p, () => {});
}

// GET /api/projects — รายการ Project (admin/manager เห็นหมด / member เห็นเฉพาะแบรนด์ตัวเอง)
router.get('/', async (req, res, next) => {
    try {
        const scope = allowedBrands(req.account || req.user);
        const data = await store.projects.list(scope);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/projects/chats/all — รายการห้องแชททุกแคมเปญ (ไว้ทำกล่องแชทลอยที่อยู่ทุกหน้า)
router.get('/chats/all', async (req, res, next) => {
    try {
        const scope = allowedBrands(req.account || req.user);
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
        // สร้างได้เฉพาะแบรนด์ที่ตัวเองมีสิทธิ์ ไม่งั้นแคมเปญจะหายจากรายการของคนสร้างทันที (member ต้องระบุแบรนด์เสมอ)
        if (!canSeeBrand(req.account || req.user, req.body.brand)) {
            return res.status(403).json({ status: 'error', message: 'เลือกได้เฉพาะแบรนด์ที่คุณได้รับสิทธิ์' });
        }

        // member สร้างให้ทีมตัวเอง; admin ระบุ team_id ได้ (fallback = ทีมตัวเอง)
        const teamId = (req.user.role === 'admin' && req.body.team_id) ? req.body.team_id : req.user.team_id;
        if (!teamId) return res.status(400).json({ status: 'error', message: 'ผู้ใช้ยังไม่ได้สังกัดทีม' });

        const createFields = { ...req.body, team_id: teamId, created_by: req.user.id };
        if (req.body.hire_items !== undefined && req.body.hire_items !== null && !Array.isArray(req.body.hire_items)) {
            return res.status(400).json({ status: 'error', message: 'รายการจ้างไม่ถูกต้อง' });
        }
        // ไฟล์ต้องมาจากเส้นอัปโหลดเท่านั้น — แคมเปญใหม่ยังไม่มีไฟล์ในฐาน ทุก file จึงเป็น null
        delete createFields.brief_file;
        if (req.body.product_briefs !== undefined) createFields.product_briefs = mergeBriefFiles({}, req.body.product_briefs);
        if (req.body.platform_briefs !== undefined) createFields.platform_briefs = mergeBriefFiles({}, req.body.platform_briefs);
        if (Array.isArray(req.body.hire_items)) {
            const users = await resolveAssignees(req.body.hire_items);
            createFields.hire_items = mergeHireItems([], req.body.hire_items, { userId: req.user.id, users });
            // งบของงานจ้างอื่น ๆ = ผลรวมรายการจ้าง คำนวณฝั่งนี้ ไม่เชื่อตัวเลขที่หน้าเว็บส่งมา
            if (req.body.campaign_type === 'other') {
                createFields.budget = createFields.hire_items.reduce((s, it) => s + hireRowFee(it), 0);
            }
        }
        delete createFields.expected_updated_at;
        const data = await store.projects.create(createFields);
        await record(req, data.id, 'create',
            data.campaign_type === 'other' ? 'สร้างแคมเปญ (งานจ้างอื่น ๆ)' : 'สร้างแคมเปญ', data.name, teamId);
        res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
});

// PUT /api/projects/:id — แก้ไข Project
router.put('/:id', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        // ย้ายแคมเปญไปแบรนด์ที่ตัวเองไม่มีสิทธิ์ไม่ได้ (ส่งมาแค่ status ไม่ต้องตรวจ)
        if (Object.prototype.hasOwnProperty.call(req.body, 'brand') && !canSeeBrand(req.account || req.user, req.body.brand)) {
            return res.status(403).json({ status: 'error', message: 'เลือกได้เฉพาะแบรนด์ที่คุณได้รับสิทธิ์' });
        }
        // สลับประเภทแคมเปญทีหลังไม่ได้ — แคมเปญ KOL ที่มีรายชื่อ/คลิป/ค่าแอดอยู่แล้ว
        // ถ้าเปลี่ยนเป็น 'other' ข้อมูลพวกนั้นจะหายจากหน้าโฆษณาและรายงานทันทีโดยไม่มีอะไรเตือน
        if (Object.prototype.hasOwnProperty.call(req.body, 'campaign_type')) {
            const cur = await store.projects.findByIdFull(req.params.id);
            const asked = req.body.campaign_type === 'other' ? 'other' : 'kol';
            if (cur && (cur.campaign_type || 'kol') !== asked) {
                return res.status(400).json({ status: 'error', message: 'เปลี่ยนประเภทแคมเปญหลังสร้างแล้วไม่ได้ — ให้สร้างแคมเปญใหม่แทน' });
            }
        }
        const bodyKeys = Object.keys(req.body).filter(k => k !== 'expected_updated_at');
        const patch = { ...req.body, updated_by: req.user.id };
        delete patch.expected_updated_at;
        const hasHire = Object.prototype.hasOwnProperty.call(req.body, 'hire_items');
        if (hasHire && !Array.isArray(req.body.hire_items)) {
            return res.status(400).json({ status: 'error', message: 'รายการจ้างไม่ถูกต้อง' });
        }
        // hire_items เขียนได้ทางเดียวคือ replaceHireItems ด้านล่าง (ห้ามหลุดไปถึง store.update แบบทั้งก้อน)
        delete patch.hire_items;
        const curProject = await store.projects.findByIdFull(req.params.id);
        // งบของงานจ้างอื่น ๆ = ผลรวมรายการจ้างเสมอ ห้ามแก้ตัวเลขตรง ๆ (แคมเปญ KOL ยังส่งงบจริงจากฟอร์มได้ตามเดิม)
        if (curProject && (curProject.campaign_type || 'kol') === 'other') delete patch.budget;
        // ไฟล์บรีฟ: ฟอร์มส่ง file เดิมกลับมาทุกครั้ง — ยึดของในฐาน (ส่ง null = เอาออกได้)
        if (patch.product_briefs !== undefined) patch.product_briefs = mergeBriefFiles(curProject && curProject.product_briefs, patch.product_briefs);
        if (patch.platform_briefs !== undefined) patch.platform_briefs = mergeBriefFiles(curProject && curProject.platform_briefs, patch.platform_briefs);
        // รายการจ้างไม่เขียนทับทั้งก้อน: ต้องยืนยันว่าหน้าเว็บถือข้อมูลล่าสุดอยู่ แล้วรวมกับของในฐาน
        // (ชื่อที่คนจัดหาเสนอ / คนที่ถูกเลือกไปแล้ว / ไฟล์แนบ มาจากเส้นของมันเอง หน้าเว็บส่งทับไม่ได้)
        if (hasHire) {
            if (!req.body.expected_updated_at) {
                return res.status(409).json({ status: 'error', code: 'STALE', message: 'ข้อมูลของงานนี้เพิ่งเปลี่ยน — โหลดค่าล่าสุดแล้วบันทึกอีกครั้ง' });
            }
            const users = await resolveAssignees(req.body.hire_items);
            const saved = await store.projects.replaceHireItems(req.params.id, req.body.expected_updated_at,
                current => mergeHireItems(current, req.body.hire_items, { userId: req.user.id, users }));
            if (!saved) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });
            if (saved.conflict) {
                return res.status(409).json({ status: 'error', code: 'STALE', message: 'ข้อมูลของงานนี้เพิ่งเปลี่ยนระหว่างที่เปิดอยู่ — โหลดค่าล่าสุดแล้วบันทึกอีกครั้ง' });
            }
            delete patch.budget;     // งบคำนวณใหม่จากรายการจ้างที่รวมแล้ว
        }
        const data = await store.projects.update(req.params.id, patch);
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
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// POST /api/projects/:id/hires/:key/image — อัปโหลดรูป/คอมการ์ดของผู้รับงานหนึ่งคน (แคมเปญงานจ้างอื่น ๆ)
// key = รหัสแถวใน hire_items (ฝั่งหน้าเว็บสร้างไว้ตอนเพิ่มแถว) ไม่ใช่ลำดับ เพราะลำดับสลับได้เมื่อมีการลบแถว
router.post('/:id/hires/:key/image', (req, res, next) => {
    hireImage.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const dropUploaded = () => fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
        let committed = false;
        try {
            const check = await canEditProject(req, req.params.id);
            if (!check.ok) { dropUploaded(); return res.status(check.code).json({ status: 'error', message: check.message }); }
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            // แก้ทีละแถวผ่าน patchHireItems (ล็อกแถว + คิดงบใหม่) — เดิมอ่านมาแล้วเขียนทับทั้งก้อน ทับงานคนอื่นได้
            let hit = null;
            const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
                hit = row;
                return list.map(it => (String(it.key) === String(req.params.key) ? { ...it, image: meta } : it));
            });
            if (!items) { dropUploaded(); return res.status(404).json({ status: 'error', message: 'ไม่พบรายการจ้างนี้' }); }
            committed = true;
            // ไฟล์เดิมลบเฉพาะเมื่อไม่มีแถวไหนใช้อยู่แล้ว (คนที่ได้จากใบขอจัดหาใช้ไฟล์ร่วมกับชื่อที่เสนอ)
            if (hit) removeFileIfUnused(hit.image, items);
            await record(req, req.params.id, 'update', `อัปโหลดรูป/คอมการ์ดของ ${(hit && hit.name) || 'ผู้รับงาน'}`);
            res.json({ status: 'success', data: items });
        } catch (e) { if (!committed) dropUploaded(); next(e); }
    });
});

// GET /api/projects/:id/hires/:key/image — เปิดรูป/คอมการ์ดของผู้รับงานคนนั้น
router.get('/:id/hires/:key/image', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const project = await store.projects.findByIdFull(req.params.id);
        const items = Array.isArray(project && project.hire_items) ? project.hire_items : [];
        const hit = items.find(it => String(it.key) === String(req.params.key));
        const meta = hit && hit.image;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ยังไม่มีรูปของผู้รับงานคนนี้' });
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// ---------- งานจัดหา (ใบขอจัดหาของแคมเปญงานจ้างอื่น ๆ) ----------
// ใบขอจัดหา = แถวใน hire_items ที่ mode === 'casting' มีสองฝั่ง: "คนขอ" (requested_by_id) กับ "คนรับผิดชอบหา" (assignee_id)
// ทุกเส้นด้านล่างแก้ทีละแถวผ่าน store.projects.patchHireItems (ล็อกแถวในทรานแซกชัน)
// ห้ามให้เส้นพวกนี้ไปใช้ PUT /projects/:id ทั้งก้อนแบบหน้าเว็บ เพราะสองฝั่งทำงานคนละเวลา ฝั่งที่บันทึกทีหลังจะทับอีกฝั่งเงียบ ๆ
const CAST_FIND = 'กำลังหา';
const CAST_PROPOSED = 'เสนอชื่อแล้ว';
const CAST_DONE = 'ตกลงแล้ว';
const CAND_NEW = 'เสนอ';
const CAND_PICKED = 'เลือกแล้ว';
const CAND_DROPPED = 'ไม่เอา';

const rnd = () => Math.random().toString(36).slice(2, 9);
const txt = v => { const s = v == null ? '' : String(v).trim(); return s || null; };
const candsOf = it => (Array.isArray(it.candidates) ? it.candidates : []);
const leftOf = it => Math.max(0, (Number(it.headcount) || 1) - (Number(it.filled) || 0));
// ชื่อที่เอาไว้โชว์ว่า "ใครทำ" — req.user มาจาก token ซึ่งไม่มีชื่อเล่น ต้องอ่านจาก req.account (ข้อมูลสดจากฐาน)
const actorName = req => (req.account && (req.account.nickname || req.account.full_name)) || req.user.username;

// คนที่ยุ่งกับใบขอจัดหาได้: คนที่แก้แคมเปญนี้ได้ (ฝั่งคนขอ) หรือคนที่ถูกมอบหมายให้หา (ฝั่งคนจัดหา)
// คนจัดหาอาจไม่มีสิทธิ์แบรนด์นี้ — ตั้งใจให้แตะได้เฉพาะ "ใบที่ถูกมอบหมายให้" ไม่ได้เปิดทั้งแคมเปญให้
async function castingRow(req, projectId, key) {
    const project = await store.projects.findByIdFull(projectId);
    if (!project) return { ok: false, code: 404, message: 'ไม่พบ Project' };
    const row = (Array.isArray(project.hire_items) ? project.hire_items : [])
        .find(it => String(it.key) === String(key));
    if (!row) return { ok: false, code: 404, message: 'ไม่พบใบขอจัดหานี้' };
    if (row.mode !== 'casting') return { ok: false, code: 400, message: 'รายการนี้ไม่ใช่ใบขอจัดหา' };
    const isOwner = canSeeBrand(req.account || req.user, project.brand);
    const isAssignee = row.assignee_id != null && String(row.assignee_id) === String(req.user.id);
    if (!isOwner && !isAssignee) return { ok: false, code: 403, message: 'ไม่มีสิทธิ์เข้าถึงใบขอจัดหานี้' };
    return { ok: true, project, row, isOwner, isAssignee };
}

// เส้นที่คนจัดหาเรียกได้คืน hire_items กลับไป — ถ้าคนเรียกไม่มีสิทธิ์แบรนด์นี้ ให้เห็นแค่ใบที่ถูกมอบหมาย ไม่ใช่ทั้งแคมเปญ
const visibleItems = (items, acc, key) =>
    (acc.isOwner ? items : (Array.isArray(items) ? items : []).filter(it => String(it.key) === String(key)));

// PUT /api/projects/:id/hires/:key/assign — มอบหมาย / เปลี่ยน / ถอนคนรับผิดชอบจัดหา
router.put('/:id/hires/:key/assign', async (req, res, next) => {
    try {
        // มอบงานได้เฉพาะคนที่แก้แคมเปญนี้ได้ — คนจัดหาโยนงานต่อให้คนอื่นเองไม่ได้
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });

        const raw = req.body.assignee_id;
        let assignee = null;
        if (raw !== null && raw !== undefined && raw !== '') {
            const u = await store.users.findById(raw);
            if (!u || u.is_active === false || (u.status || 'active') !== 'active' || u.role === 'agency') {
                return res.status(400).json({ status: 'error', message: 'เลือกผู้รับผิดชอบไม่ถูกต้อง' });
            }
            // เก็บทั้ง id และชื่อ: id คือตัวจริงที่ใช้เทียบสิทธิ์ ส่วนชื่อเก็บไว้โชว์ย้อนหลังแม้คนนั้นถูกลบไปแล้ว
            assignee = { id: u.id, name: u.nickname || u.full_name || u.username };
        }

        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            if (row.mode !== 'casting') return null;
            return list.map(it => (String(it.key) === String(req.params.key) ? {
                ...it,
                assignee_id: assignee ? assignee.id : null,
                assignee_name: assignee ? assignee.name : null,
                assigned_at: assignee ? new Date().toISOString() : null,
                status: it.status || CAST_FIND
            } : it));
        });
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' });
        await record(req, req.params.id, 'update',
            assignee ? `มอบงานจัดหาให้ ${assignee.name}` : 'ถอนผู้รับผิดชอบงานจัดหา');
        res.json({ status: 'success', data: items });
    } catch (err) { next(err); }
});


// PUT /api/projects/:id/hires/:key — แก้รายละเอียดใบขอจัดหา (ฝั่งคนขอเท่านั้น คนจัดหาแก้ใบไม่ได้)
// ส่งมาเฉพาะคีย์ที่จะแก้ คีย์ที่ไม่ส่งคงค่าเดิม · ห้ามแตะ candidates/filled ที่นี่ (มีเส้นของตัวเองอยู่แล้ว)
router.put('/:id/hires/:key', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });

        const b = req.body || {};
        let hit = null;
        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            if (row.mode !== 'casting') return null;
            hit = row;
            const patch = { ...row };
            if (b.kind !== undefined) patch.kind = txt(b.kind);
            if (b.spec !== undefined) patch.spec = txt(b.spec);
            if (b.place !== undefined) patch.place = txt(b.place);
            if (b.note !== undefined) patch.note = txt(b.note);
            if (b.use_date !== undefined) patch.use_date = b.use_date || null;
            if (b.deadline !== undefined) patch.deadline = b.deadline || null;
            if (b.fee !== undefined) patch.fee = cleanFee(b.fee);
            if (b.headcount !== undefined) {
                // ลดจำนวนที่ขอต่ำกว่าคนที่หาได้แล้วไม่ได้ — งบจะติดลบและใบจะค้างสถานะแปลก ๆ
                patch.headcount = Math.max(cleanHeadcount(b.headcount), Number(row.filled) || 0);
            }
            if (b.status !== undefined) patch.status = txt(b.status) || row.status;
            return list.map(it => (String(it.key) === String(req.params.key) ? patch : it));
        });
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' });
        await record(req, req.params.id, 'update', `แก้ไขใบขอจัดหา${hit && hit.kind ? ' (' + hit.kind + ')' : ''}`);
        res.json({ status: 'success', data: items });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id/hires/:key — ลบใบขอจัดหาทิ้งทั้งใบ (คนที่เลือกไปแล้วเป็นแถวของตัวเอง ไม่ถูกลบตาม)
router.delete('/:id/hires/:key', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });

        let gone = null;
        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            gone = row;
            return list.filter(it => String(it.key) !== String(req.params.key));
        });
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการนี้' });

        // เก็บกวาดไฟล์ของใบที่ถูกลบ — แต่ข้ามไฟล์ที่ยังมีแถวอื่นใช้อยู่ (คนที่เลือกไปแล้วใช้คอมการ์ดไฟล์เดียวกัน)
        if (gone) {
            removeFileIfUnused(gone.image, items);
            candsOf(gone).forEach(c => { removeFileIfUnused(c.image, items); removeFileIfUnused(c.video, items); });
        }
        await record(req, req.params.id, 'update',
            `ลบ${gone && gone.mode === 'casting' ? 'ใบขอจัดหา' : 'รายการจ้าง'}${gone && gone.kind ? ' (' + gone.kind + ')' : ''}`);
        res.json({ status: 'success', data: items });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/hires/:key/candidates — คนจัดหาเสนอชื่อเข้ามา (เสนอได้หลายคนต่อหนึ่งใบ)
router.post('/:id/hires/:key/candidates', async (req, res, next) => {
    try {
        const acc = await castingRow(req, req.params.id, req.params.key);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const name = txt(req.body.name);
        if (!name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อคนที่เสนอ' });

        const cand = {
            key: 'c' + rnd(), name,
            contact: txt(req.body.contact), agency: txt(req.body.agency),
            fee: cleanFee(req.body.fee), link: txt(req.body.link), note: txt(req.body.note),
            // คอมการ์ด/คลิปแนบได้ 2 ทาง: อัปไฟล์ (image/video) หรือวางลิงก์ (image_link/video_link)
            image: null, image_link: txt(req.body.image_link),
            video: null, video_link: txt(req.body.video_link),
            status: CAND_NEW,
            by_id: req.user.id, by_name: actorName(req), at: new Date().toISOString()
        };
        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            if (row.mode !== 'casting') return null;
            return list.map(it => (String(it.key) === String(req.params.key) ? {
                ...it,
                candidates: [...candsOf(it), cand],
                // ใบที่หาครบแล้วไม่ต้องย้อนสถานะกลับ — เสนอเพิ่มไว้เป็นตัวสำรองได้
                status: leftOf(it) > 0 ? CAST_PROPOSED : (it.status || CAST_DONE)
            } : it));
        });
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' });
        await record(req, req.params.id, 'update', `เสนอชื่อ ${name} ให้ใบขอจัดหา${acc.row.kind ? ' (' + acc.row.kind + ')' : ''}`);
        res.json({ status: 'success', data: visibleItems(items, acc, req.params.key) });
    } catch (err) { next(err); }
});

// PATCH /api/projects/:id/hires/:key/candidates/:ckey — คนขอเลือก / ไม่เอาคนที่เสนอมา
// เลือกแล้ว = เกิดแถว "ระบุคนเอง" ใหม่ 1 แถว และใบขอจัดหาเหลือจำนวนที่ต้องหาน้อยลง 1
router.patch('/:id/hires/:key/candidates/:ckey', async (req, res, next) => {
    try {
        // คนขอเป็นคนตัดสิน (คนจัดหากดเลือกให้ตัวเองไม่ได้) จึงใช้สิทธิ์แก้แคมเปญ ไม่ใช่ castingRow
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const want = String(req.body.status || '');
        if (![CAND_PICKED, CAND_DROPPED, CAND_NEW].includes(want)) {
            return res.status(400).json({ status: 'error', message: 'สถานะไม่ถูกต้อง' });
        }

        let pickedName = null;
        let candName = null;
        let full = false;
        // เหตุผลตอนไม่ผ่าน — คนหาเห็นบนการ์ด (จำกัดความยาวไว้ ไม่ให้ประวัติ/การ์ดบวม)
        const reason = (txt(req.body.note) || '').slice(0, 500) || null;
        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            if (row.mode !== 'casting') return null;
            const cand = candsOf(row).find(c => String(c.key) === String(req.params.ckey));
            if (!cand) return null;
            candName = cand.name;
            if (want === CAND_PICKED && leftOf(row) <= 0) { full = true; return null; }
            // เลือกไปแล้วย้อนไม่ได้ — แถวผู้รับงานจริงเกิดไปแล้ว ถ้าปล่อยให้ย้อนจะมีแถวค้างและงบเพี้ยน
            if ((cand.status || CAND_NEW) === CAND_PICKED) return null;

            const stamped = candsOf(row).map(c => (String(c.key) === String(req.params.ckey) ? {
                ...c, status: want,
                decided_by: actorName(req), decided_at: new Date().toISOString(), decided_note: reason
            } : c));
            if (want !== CAND_PICKED) {
                return list.map(it => (String(it.key) === String(row.key) ? { ...it, candidates: stamped } : it));
            }

            pickedName = cand.name;
            const filled = (Number(row.filled) || 0) + 1;
            const left = Math.max(0, (Number(row.headcount) || 1) - filled);
            const hired = {
                key: 'h' + rnd(), mode: 'direct', kind: row.kind || null,
                name: cand.name, contact: cand.contact || null, agency: cand.agency || null,
                qty: row.qty || null,
                // ค่าตัวจริงของคนที่เลือกมาแทนงบที่ตั้งไว้ต่อคน (ถ้าไม่ได้ระบุ ใช้งบต่อคนไปก่อน)
                fee: Number(cand.fee) || Number(row.fee) || 0,
                use_date: row.use_date || null, place: row.place || null,
                link: cand.link || null, image: cand.image || null,
                status: CAST_DONE, note: cand.note || null,
                from_request: row.key
            };
            const out = [];
            list.forEach(it => {
                if (String(it.key) !== String(row.key)) { out.push(it); return; }
                out.push({ ...it, candidates: stamped, filled, status: left === 0 ? CAST_DONE : (it.status || CAST_FIND) });
                out.push(hired);   // วางต่อจากใบที่ขอ จะได้อ่านเป็นเรื่องเดียวกัน
            });
            return out;
        });
        if (full) return res.status(409).json({ status: 'error', message: 'ใบนี้ได้คนครบจำนวนที่ขอแล้ว — ถ้าต้องการเพิ่มคน ให้แก้จำนวนคนที่ต้องการในใบก่อน' });
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบชื่อที่เสนอนี้ หรืออนุมัติไปแล้ว' });
        await record(req, req.params.id, 'update', want === CAND_PICKED
            ? `อนุมัติ ${pickedName} จากใบขอจัดหา`
            : want === CAND_DROPPED
                ? `ไม่ผ่าน ${candName || ''} ในใบขอจัดหา${reason ? ' — ' + reason : ''}`
                : `ดึง ${candName || ''} กลับมาพิจารณาในใบขอจัดหา`);
        res.json({ status: 'success', data: items });
    } catch (err) { next(err); }
});

// DELETE /api/projects/:id/hires/:key/candidates/:ckey — ถอนชื่อที่เสนอไว้ (ที่ถูกเลือกแล้วถอนไม่ได้)
router.delete('/:id/hires/:key/candidates/:ckey', async (req, res, next) => {
    try {
        const acc = await castingRow(req, req.params.id, req.params.key);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
        if (!cand) return res.status(404).json({ status: 'error', message: 'ไม่พบชื่อที่เสนอนี้' });
        if ((cand.status || CAND_NEW) === CAND_PICKED) {
            return res.status(400).json({ status: 'error', message: 'คนที่อนุมัติแล้วถอนออกจากใบไม่ได้ — ให้ไปลบแถวผู้รับงานแทน' });
        }
        // คนอื่นที่ไม่ใช่คนเสนอเองต้องมีสิทธิ์ในแคมเปญนี้ถึงจะถอนให้ได้
        if (String(cand.by_id) !== String(req.user.id) && !acc.isOwner) {
            return res.status(403).json({ status: 'error', message: 'ถอนได้เฉพาะชื่อที่ตัวเองเสนอ' });
        }
        let pickedMeanwhile = false;
        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) => {
            const fresh = candsOf(row).find(c => String(c.key) === String(req.params.ckey));
            if (!fresh) return null;
            if ((fresh.status || CAND_NEW) === CAND_PICKED) { pickedMeanwhile = true; return null; }
            return list.map(it => (String(it.key) === String(req.params.key)
                ? { ...it, candidates: candsOf(it).filter(c => String(c.key) !== String(req.params.ckey)) }
                : it));
        });
        if (pickedMeanwhile) {
            return res.status(409).json({ status: 'error', message: 'คนนี้เพิ่งได้รับอนุมัติเป็นผู้รับงานไปแล้ว ถอนจากใบไม่ได้' });
        }
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' });
        // เก็บกวาดไฟล์ของชื่อที่ถอนออก (ข้ามไฟล์ที่ยังมีแถวอื่นใช้อยู่)
        removeFileIfUnused(cand.image, items);
        removeFileIfUnused(cand.video, items);
        await record(req, req.params.id, 'update', `ถอนชื่อ ${cand.name} ออกจากใบขอจัดหา`);
        res.json({ status: 'success', data: visibleItems(items, acc, req.params.key) });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/hires/:key/candidates/:ckey/image — รูป / คอมการ์ดของคนที่เสนอ
router.post('/:id/hires/:key/candidates/:ckey/image', (req, res, next) => {
    hireImage.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const dropUploaded = () => fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
        try {
            const acc = await castingRow(req, req.params.id, req.params.key);
            if (!acc.ok) { dropUploaded(); return res.status(acc.code).json({ status: 'error', message: acc.message }); }
            const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
            if (!cand) { dropUploaded(); return res.status(404).json({ status: 'error', message: 'ไม่พบชื่อที่เสนอนี้' }); }
            if (String(cand.by_id) !== String(req.user.id) && !acc.isOwner) {
                dropUploaded();
                return res.status(403).json({ status: 'error', message: 'แก้ไฟล์ได้เฉพาะชื่อที่ตัวเองเสนอ' });
            }
            const oldImage = cand.image;
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) =>
                list.map(it => (String(it.key) === String(req.params.key)
                    ? { ...it, candidates: candsOf(it).map(c => (String(c.key) === String(req.params.ckey) ? { ...c, image: meta } : c)) }
                    : it)));
            if (!items) { dropUploaded(); return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' }); }
            removeFileIfUnused(oldImage, items);
            res.json({ status: 'success', data: visibleItems(items, acc, req.params.key) });
        } catch (e) { dropUploaded(); next(e); }
    });
});

// GET /api/projects/:id/hires/:key/candidates/:ckey/image — เปิดรูปของคนที่เสนอ
router.get('/:id/hires/:key/candidates/:ckey/image', async (req, res, next) => {
    try {
        const acc = await castingRow(req, req.params.id, req.params.key);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
        const meta = cand && cand.image;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ยังไม่มีรูปของคนที่เสนอคนนี้' });
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// PUT /api/projects/:id/hires/:key/candidates/:ckey — แก้รายละเอียดของชื่อที่เสนอไว้
// แก้ได้ทั้งคนที่เสนอเอง และคนที่แก้แคมเปญนี้ได้ · ส่งมาเฉพาะคีย์ที่จะแก้ คีย์ที่ไม่ส่งคงค่าเดิม
router.put('/:id/hires/:key/candidates/:ckey', async (req, res, next) => {
    try {
        const acc = await castingRow(req, req.params.id, req.params.key);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
        if (!cand) return res.status(404).json({ status: 'error', message: 'ไม่พบชื่อที่เสนอนี้' });
        if (String(cand.by_id) !== String(req.user.id) && !acc.isOwner) {
            return res.status(403).json({ status: 'error', message: 'แก้ได้เฉพาะชื่อที่ตัวเองเสนอ' });
        }
        const b = req.body || {};
        const keep = (key, fn) => (b[key] === undefined ? (cand[key] === undefined ? null : cand[key]) : fn(b[key]));
        const name = b.name === undefined ? cand.name : txt(b.name);
        if (!name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อคนที่เสนอ' });

        const patch = {
            name,
            fee: b.fee === undefined ? cleanFee(cand.fee) : cleanFee(b.fee),
            contact: keep('contact', txt), agency: keep('agency', txt),
            link: keep('link', txt), note: keep('note', txt),
            image_link: keep('image_link', txt), video_link: keep('video_link', txt)
        };
        // กดเอาไฟล์ออก — ลบไฟล์ในโฟลเดอร์ตามด้วย (เฉพาะเมื่อไม่มีแถวอื่นใช้อยู่)
        const dropImage = b.clear_image === true ? cand.image : null;
        const dropVideo = b.clear_video === true ? cand.video : null;
        if (b.clear_image === true) patch.image = null;
        if (b.clear_video === true) patch.video = null;

        const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) =>
            list.map(it => (String(it.key) === String(req.params.key)
                ? { ...it, candidates: candsOf(it).map(c => (String(c.key) === String(req.params.ckey) ? { ...c, ...patch } : c)) }
                : it)));
        if (!items) return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' });
        removeFileIfUnused(dropImage, items);
        removeFileIfUnused(dropVideo, items);
        await record(req, req.params.id, 'update', `แก้ข้อมูลของ ${name} ในใบขอจัดหา`);
        res.json({ status: 'success', data: visibleItems(items, acc, req.params.key) });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/hires/:key/candidates/:ckey/video — คลิปแนะนำตัวของคนที่เสนอ
router.post('/:id/hires/:key/candidates/:ckey/video', (req, res, next) => {
    hireVideo.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const dropUploaded = () => fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
        try {
            const acc = await castingRow(req, req.params.id, req.params.key);
            if (!acc.ok) { dropUploaded(); return res.status(acc.code).json({ status: 'error', message: acc.message }); }
            const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
            if (!cand) { dropUploaded(); return res.status(404).json({ status: 'error', message: 'ไม่พบชื่อที่เสนอนี้' }); }
            if (String(cand.by_id) !== String(req.user.id) && !acc.isOwner) {
                dropUploaded();
                return res.status(403).json({ status: 'error', message: 'แก้ไฟล์ได้เฉพาะชื่อที่ตัวเองเสนอ' });
            }
            const oldVideo = cand.video;
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const items = await store.projects.patchHireItems(req.params.id, req.params.key, (row, list) =>
                list.map(it => (String(it.key) === String(req.params.key)
                    ? { ...it, candidates: candsOf(it).map(c => (String(c.key) === String(req.params.ckey) ? { ...c, video: meta } : c)) }
                    : it)));
            if (!items) { dropUploaded(); return res.status(404).json({ status: 'error', message: 'ไม่พบใบขอจัดหานี้' }); }
            removeFileIfUnused(oldVideo, items);
            res.json({ status: 'success', data: visibleItems(items, acc, req.params.key) });
        } catch (e) { dropUploaded(); next(e); }
    });
});

// GET /api/projects/:id/hires/:key/candidates/:ckey/video — เปิดคลิปแนะนำตัว (sendFile รองรับการกรอคลิปให้เอง)
router.get('/:id/hires/:key/candidates/:ckey/video', async (req, res, next) => {
    try {
        const acc = await castingRow(req, req.params.id, req.params.key);
        if (!acc.ok) return res.status(acc.code).json({ status: 'error', message: acc.message });
        const cand = candsOf(acc.row).find(c => String(c.key) === String(req.params.ckey));
        const meta = cand && cand.video;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ยังไม่มีคลิปของคนที่เสนอคนนี้' });
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
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
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
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
        const filePath = uploadPath(meta.filename);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// ---------- Agency Submissions (คัดเลือก KOL จากเอเจนซี่) ----------
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// รหัสชั่วคราวสำหรับบัญชีเอเจนซี่ที่เพิ่งสร้าง — ตัดตัวที่อ่านสับสนออก (0/O, 1/l/I)
// เพราะรหัสนี้ต้องก๊อปไปส่งทางแชท/ไลน์ แล้วเอเจนซี่พิมพ์เอง
function tempPassword() {
    const LOW = 'abcdefghijkmnopqrstuvwxyz';
    const UP  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const NUM = '23456789';
    const SYM = '!@#$%&';
    const pick = set => set[crypto.randomInt(set.length)];
    // การันตีว่ามีครบทุกประเภทอย่างน้อยอย่างละตัว แล้วสลับตำแหน่ง
    const chars = [pick(LOW), pick(UP), pick(NUM), pick(SYM)];
    const all = LOW + UP + NUM + SYM;
    while (chars.length < 12) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}
const { allowedBrands, seesAllBrands, canSeeBrand } = require('../data/roles');

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

// แคมเปญที่ตั้งกลุ่มไว้แล้ว ลิงก์ต้องระบุกลุ่มเสมอ — ไม่งั้นเอเจนซี่จะเห็นทุกกลุ่มแบบเงียบ ๆ
// (แคมเปญที่ยังไม่ได้ตั้งกลุ่มยังออกลิงก์ได้ตามเดิม)
async function requireGroups(projectId, groups) {
    const proj = await store.projects.findByIdFull(projectId);
    const has = (proj && proj.ad_groups || []).length > 0;
    if (!has) return null;
    const picked = Array.isArray(groups) ? groups.filter(Boolean) : [];
    if (!picked.length) return 'กรุณาเลือกกลุ่มที่เอเจนซี่เจ้านี้รับผิดชอบอย่างน้อย 1 กลุ่ม';
    const keys = new Set(proj.ad_groups.map(g => g.key));
    if (picked.some(k => !keys.has(k))) return 'มีกลุ่มที่ไม่ได้อยู่ในแคมเปญนี้';
    return null;
}

// POST /api/projects/:id/agency-links — สร้างลิงก์ให้เอเจนซี่เจ้าใหม่
// body: agency_user_id = ผูกกับบัญชีเอเจนซี่ที่มีอยู่ · new_agency_username = สร้างบัญชีใหม่ (admin เท่านั้น)
router.post('/:id/agency-links', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { name, products, platforms, kol_count, groups, agency_user_id, new_agency_username } = req.body;
        const gErr = await requireGroups(req.params.id, groups);
        if (gErr) return res.status(400).json({ status: 'error', message: gErr });

        // --- ตรวจให้ครบก่อนสร้างลิงก์ ไม่งั้นพลาดตรงบัญชีแล้วจะเหลือลิงก์ค้างที่ไม่มีใครเข้าได้ ---
        let account = null;                       // บัญชีเดิมที่จะผูกลิงก์ให้
        let newName = null;                       // ชื่อบัญชีใหม่ที่จะสร้าง
        if (new_agency_username) {
            // ออกรหัสผ่าน = ให้สิทธิ์เข้าถึงข้อมูลแคมเปญ จำกัดไว้ที่ admin เท่านั้น
            if ((req.account || req.user).role !== 'admin') {
                return res.status(403).json({ status: 'error', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สร้างบัญชีเอเจนซี่ได้' });
            }
            newName = String(new_agency_username).trim();
            if (!newName) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อบัญชีเอเจนซี่' });
            if (await store.users.findByUsername(newName)) {
                return res.status(409).json({ status: 'error', message: 'มีบัญชีชื่อนี้อยู่แล้ว — เลือกจากรายการแทน' });
            }
        } else if (agency_user_id) {
            account = await store.users.findById(agency_user_id);
            if (!account || account.role !== 'agency') {
                return res.status(404).json({ status: 'error', message: 'ไม่พบบัญชีเอเจนซี่ที่เลือก' });
            }
        }

        const linkName = newName || (account && account.username) || name;
        const link = await store.projects.addAgencyLink(req.params.id, linkName, crypto.randomBytes(9).toString('hex'), { products, platforms, kol_count, groups });
        if (!link) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });

        // --- ผูกลิงก์เข้าบัญชี เพื่อไม่ต้องไปติ๊กเองที่หน้าผู้ใช้งาน ---
        let temp_password = null;
        let agency_account = null;
        if (newName) {
            temp_password = tempPassword();
            agency_account = await store.users.create({
                username: newName,
                password_hash: await bcrypt.hash(temp_password, 10),
                role: 'agency', brands: [], agency_tokens: [link.token], status: 'active'
            });
            await record(req, req.params.id, 'agency_link', 'สร้างบัญชีเอเจนซี่: ' + newName);
        } else if (account) {
            await store.users.bindAgencyToken(account.id, link.token);
            agency_account = { id: account.id, username: account.username };
        }

        await record(req, req.params.id, 'agency_link', 'สร้างลิงก์เอเจนซี่: ' + link.name);
        res.status(201).json({ status: 'success', data: { ...link, agency_account, temp_password } });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: err.message });
        next(err);
    }
});

// PUT /api/projects/:id/agency-links/:token — แก้ขอบเขตงาน + เปลี่ยนบัญชีที่ผูกไว้
router.put('/:id/agency-links/:token', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { name, products, platforms, kol_count, groups, agency_user_id } = req.body;
        if (groups !== undefined) {
            const gErr = await requireGroups(req.params.id, groups);
            if (gErr) return res.status(400).json({ status: 'error', message: gErr });
        }

        // เปลี่ยนบัญชีที่ผูก: ถอนของเดิมออกก่อนแล้วค่อยผูกใหม่ ไม่งั้นเจ้าเก่ายังเข้าได้อยู่
        if (agency_user_id !== undefined) {
            if (agency_user_id) {
                const acc = await store.users.findById(agency_user_id);
                if (!acc || acc.role !== 'agency') {
                    return res.status(404).json({ status: 'error', message: 'ไม่พบบัญชีเอเจนซี่ที่เลือก' });
                }
                await store.users.unbindAgencyToken(req.params.token);
                await store.users.bindAgencyToken(acc.id, req.params.token);
            } else {
                await store.users.unbindAgencyToken(req.params.token);
            }
        }

        const link = await store.projects.updateAgencyLink(req.params.id, req.params.token, { name, products, platforms, kol_count, groups });
        if (!link) return res.status(404).json({ status: 'error', message: 'ไม่พบลิงก์นี้' });
        await record(req, req.params.id, 'agency_link', 'แก้ไขลิงก์เอเจนซี่: ' + link.name);
        res.json({ status: 'success', data: link });
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
        // ถอนลิงก์ออกจากบัญชีเอเจนซี่ด้วย ไม่งั้นบัญชีจะเหลือ token ตายค้างอยู่
        if (ok) await store.users.unbindAgencyToken(req.params.token);
        if (ok) await record(req, req.params.id, 'remove_agency_link', `ลบลิงก์เอเจนซี่ (รายชื่อที่ส่งผ่านลิงก์นี้ถูกลบ ${removed} คน)`);
        res.json({ status: ok ? 'success' : 'error', data: { removed_submissions: removed } });
    } catch (err) { next(err); }
});

// POST /api/projects/:id/submissions — ทีมเพิ่ม KOL เข้าลิสต์เอง
router.post('/:id/submissions', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const { account_name, platform, product, agency, budget, link_account, followers, group_key, content_type } = req.body;
        if (!account_name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ Account' });
        const proj = await store.projects.findByIdFull(req.params.id);
        const grp = ((proj && proj.ad_groups) || []).find(g => g.key === group_key);
        const rows = await store.submissions.addPerson({
            project_id: req.params.id, account_name,
            platform: platform || null, product: product || null, agency: agency || null,
            budget: Number(budget) || 0, link_account: link_account || null, followers: Number(followers) || 0,
            group_key: group_key || null,  // กลุ่มโฆษณาที่สังกัด — พา Target/Photo-VDO/Content Format มาด้วย
            content_type: content_type || null   // 1 Platform อาจมีหลาย Content Type ในกลุ่มเดียว ต้องระบุว่าคนนี้ทำอันไหน
            // Content ต่อคนตั้งแยกต่อ Platform ได้ จึงต้องอ่านตาม Platform ของคนนี้
        }, store.resolveGroupClips(grp, platform || null));
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
            account_name, platform, product, agency, link_account, concept, gen_date, team_note,
            views, likes, comments, saves, shares, reposts   // ผลงานคอนเทนต์ จากโมดัล Perf
        } = req.body;
        // ค่าตัว (budget) ไม่รับที่เส้นนี้แล้ว — ตั้งผ่าน PUT /:id/fees ที่เดียว (มีเช็คค่าเดิม + ลงประวัติ)
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
            link_account, concept, gen_date,
            team_note: team_note !== undefined ? ((team_note && String(team_note).trim()) ? String(team_note).trim() : null) : undefined,
            views: views !== undefined ? (Number(views) || 0) : undefined, likes: likes !== undefined ? (Number(likes) || 0) : undefined, comments: comments !== undefined ? (Number(comments) || 0) : undefined, saves: saves !== undefined ? (Number(saves) || 0) : undefined, shares: shares !== undefined ? (Number(shares) || 0) : undefined,
            reposts: reposts !== undefined ? (Number(reposts) || 0) : undefined
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

// ---------- ค่าตัว KOL (ต่อคลิป) — ทีมตั้งเองจากหน้า Dashboard ไม่ต้องรอเอเจนซี่ ----------
// คำนำหน้าในประวัติ แยกตามวิธีที่ตั้งค่าตัว
const FEE_REASONS = { manual: 'แก้ค่าตัว: ', divide: 'หารเฉลี่ย: ', clear: 'ล้างค่าตัว: ' };
const FEE_MAX = 10000000;      // ค่าตัวต่อคลิปสูงสุดที่รับ (กันพิมพ์ศูนย์เกิน)
const FEE_BATCH_MAX = 500;     // แถวต่อคำขอ — หารเฉลี่ยทั้งกลุ่มยังไม่ถึงหลักร้อย
const baht = n => '฿' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ตรวจรูปคำขอก่อนแตะฐานข้อมูล — คืน { items, reason } ที่ปัดสตางค์แล้ว หรือ { error } เป็นข้อความภาษาไทย
function parseFeeBody(body) {
    const { items, reason } = body || {};
    if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(FEE_REASONS, reason)) {
        return { error: 'รูปแบบการตั้งค่าตัวไม่ถูกต้อง' };
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > FEE_BATCH_MAX) {
        return { error: `ส่งรายการค่าตัวได้ครั้งละ 1-${FEE_BATCH_MAX} รายการ` };
    }
    const seen = new Set();
    const out = [];
    for (const it of items) {
        if (!it || typeof it !== 'object') return { error: 'รายการค่าตัวไม่ถูกต้อง' };
        const { sub_id, budget, from } = it;
        if (!Number.isInteger(sub_id) || sub_id <= 0) return { error: 'รหัสรายการไม่ถูกต้อง' };
        if (seen.has(sub_id)) return { error: 'มีรายการซ้ำกันในคำขอเดียว' };
        seen.add(sub_id);
        // ตัวเลขเท่านั้น — '' / null / สตริง ห้ามแปลงเป็น 0 เงียบ ๆ ไม่งั้นค่าตัวจะถูกล้างโดยไม่ตั้งใจ
        if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 || budget > FEE_MAX) {
            return { error: `ค่าตัวต้องเป็นตัวเลข 0 ถึง ${FEE_MAX.toLocaleString('en-US')} บาท` };
        }
        if (from !== undefined && (typeof from !== 'number' || !Number.isFinite(from))) {
            return { error: 'ค่าตัวเดิมที่ส่งมาไม่ถูกต้อง กรุณารีเฟรช' };
        }
        const item = { sub_id, budget: Math.round(budget * 100) / 100 };
        if (from !== undefined) item.from = from;
        out.push(item);
    }
    return { items: out, reason };
}

// สรุปลงประวัติ 1 บรรทัดต่อคำขอ — รวมคลิปของคนเดียวกัน (person_key) เป็นคนเดียว แสดงไม่เกิน 10 คน
// byId = รายชื่อทั้งแคมเปญ (ใช้หา person_key เพราะ changed ไม่มีช่องนี้)
function feeSummary(reason, changed, byId) {
    const people = new Map();
    for (const c of changed) {
        const sub = byId.get(Number(c.id));
        const key = (sub && sub.person_key) || `#${c.id}`;   // ไม่มี person_key = คนที่มีคลิปเดียว
        let p = people.get(key);
        if (!p) { p = { name: c.account_name || '-', from: new Set(), to: new Set(), clips: 0 }; people.set(key, p); }
        p.from.add(Number(c.from) || 0);
        p.to.add(Number(c.to) || 0);
        p.clips++;
    }
    const list = [...people.values()];
    const text = list.slice(0, 10).map(p =>
        `${p.name} ${[...p.from].map(n => baht(n)).join('/')}→${[...p.to].map(n => baht(n)).join('/')}`
        + (p.clips > 1 ? ` (${p.clips} คลิป)` : ''));
    const more = list.length > 10 ? ` และอีก ${list.length - 10} คน` : '';
    return FEE_REASONS[reason] + text.join(', ') + more;
}

// PUT /api/projects/:id/fees — ตั้งค่าตัวต่อคลิปหลายแถวในคำขอเดียว (กรอกรายคน / หารเฉลี่ย / ล้างค่าตัว)
// body: { items: [{ sub_id, budget, from? }], reason: 'manual' | 'divide' | 'clear' }
// from = ค่าที่หน้าเว็บเห็นก่อนแก้ ถ้าในฐานไม่ตรงแล้ว (มีคนแก้แทรก) ตอบ 409 ให้รีเฟรช ไม่เขียนทับ
router.put('/:id/fees', async (req, res, next) => {
    try {
        const check = await canEditProject(req, req.params.id);
        if (!check.ok) return res.status(check.code).json({ status: 'error', message: check.message });
        const parsed = parseFeeBody(req.body);
        if (parsed.error) return res.status(400).json({ status: 'error', message: parsed.error });
        // ทุกแถวต้องเป็นของแคมเปญนี้ — กันยิง sub_id ของแคมเปญ/แบรนด์อื่นเข้ามาแก้ผ่านแคมเปญที่ตัวเองมีสิทธิ์
        const all = await store.submissions.listByProject(req.params.id);
        const byId = new Map(all.map(s => [Number(s.id), s]));
        if (parsed.items.some(it => !byId.has(it.sub_id))) {
            return res.status(400).json({ status: 'error', message: 'มีรายการที่ไม่ได้อยู่ในแคมเปญนี้ กรุณารีเฟรช' });
        }
        const user = await store.users.findById(req.user.id);
        const byName = user ? (user.full_name || user.username) : null;
        const { rows, changed } = await store.submissions.setFees(req.params.id, parsed.items, byName);
        // บันทึกประวัติครั้งเดียวต่อคำขอ (ส่งค่าเดิมมาทั้งชุด = ไม่มีอะไรเปลี่ยน ไม่ต้องบันทึก)
        if (changed.length) await record(req, req.params.id, 'fee', feeSummary(parsed.reason, changed, byId));
        res.json({ status: 'success', data: { changed, rows } });
    } catch (err) {
        // 400/409 จาก store = ตั้งใจปฏิเสธ (ข้อมูลเปลี่ยนระหว่างทาง) ไม่ใช่บั๊กของระบบ
        if (err.status === 400 || err.status === 409) {
            return res.status(err.status).json({ status: 'error', message: err.message });
        }
        next(err);
    }
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
        const fp = path.join(UPLOAD_DIR, r.filename);
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
        const fp = path.join(UPLOAD_DIR, img.filename);
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
            const fp = path.join(UPLOAD_DIR, f);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ลบไฟล์ไม่ได้ก็ปล่อย */ }
        });
        chatHub.broadcast(req.params.token);
        res.json({ status: 'success', data: out.data });
    } catch (err) { next(err); }
});

module.exports = router;
