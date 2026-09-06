const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../store');
const multer = require('multer');
const chatHub = require('../services/chatHub');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const router = express.Router();

// ---------- ไฟล์ Report ที่เอเจนซี่อัปเข้ามา ----------
const REPORT_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.ppt', '.pptx', '.xls', '.xlsx', '.doc', '.docx', '.csv'];
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const reportUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        // ตั้งชื่อไฟล์เดาไม่ได้ ป้องกันคนสุ่มเปิดไฟล์ของเจ้าอื่น
        filename: (req, file, cb) => cb(null, `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 25 * 1024 * 1024 },   // 25MB — เผื่อเด็คสไลด์
    fileFilter: (req, file, cb) => {
        const ok = REPORT_EXT.includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับเฉพาะ PDF / รูป / PowerPoint / Excel / Word / CSV'), ok);
    }
});

// รูปแนบในแชท — รูปเท่านั้น และเล็กกว่าไฟล์ Report เพราะเป็นภาพประกอบการคุย
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

// บรีฟต่อสินค้า เฉพาะที่เอเจนซี่เจ้านี้รับผิดชอบ (ตามขอบเขตสินค้าของลิงก์)
function scopedProductBriefs(project, link) {
    const pb = project.product_briefs || {};
    const out = {};
    Object.keys(pb).forEach(code => {
        if (!link.scoped || !link.products.length || link.products.includes(code)) {
            out[code] = { link: pb[code].link || null, file: pb[code].file ? { original: pb[code].file.original } : null };
        }
    });
    return out;
}
// บรีฟหลักต่อ Platform เฉพาะที่เอเจนซี่เจ้านี้รับผิดชอบ (ตามขอบเขต Platform ของลิงก์)
function scopedPlatformBriefs(project, link) {
    const pb = project.platform_briefs || {};
    const out = {};
    Object.keys(pb).forEach(pf => {
        if (!link.scoped || !link.platforms.length || link.platforms.includes(pf)) {
            out[pf] = { link: pb[pf].link || null, file: pb[pf].file ? { original: pb[pf].file.original } : null };
        }
    });
    return out;
}
// งบต่อ Platform เฉพาะที่เอเจนซี่เจ้านี้รับผิดชอบ (ตามขอบเขต Platform ของลิงก์)
function scopedPlatformBudgets(project, link) {
    const pb = project.platform_budgets || {};
    const out = {};
    Object.keys(pb).forEach(pf => {
        if (!link.scoped || !link.platforms.length || link.platforms.includes(pf)) {
            out[pf] = Number(pb[pf]) || 0;
        }
    });
    return out;
}
// หมายเหตุ: เส้นทางนี้ "สาธารณะ" (ไม่ต้องล็อกอิน) — ให้ Agency เข้าผ่านลิงก์ token

// เฉพาะ submissions ที่เจ้านี้เห็นได้ (ลิงก์แยกต่อเจ้า = เห็นเฉพาะ agency_token ตัวเอง / ลิงก์รวมเดิม = เห็นทั้งหมด)
function scopeSubs(subs, link) {
    return link.scoped ? subs.filter(s => s.agency_token === link.token) : subs;
}
// platform ของกลุ่ม (รองรับข้อมูลเดิมที่เก็บ platform ไว้ใน allocation)
function groupPlatforms(g) {
    const set = new Set();
    if (Array.isArray(g.platforms)) g.platforms.forEach(p => { if (p) set.add(p); });
    if (g.platform) set.add(g.platform);
    (g.allocations || []).forEach(a => { if (a.platform) set.add(a.platform); });
    return [...set];
}
// กลุ่มโฆษณาเฉพาะที่เอเจนซี่เจ้านี้รับผิดชอบ (ตาม Platform + สินค้าของลิงก์)
function scopedAdGroups(project, link) {
    const groups = project.ad_groups || [];
    if (!link.scoped) return groups;   // ลิงก์รวมเดิม = เห็นทุกกลุ่ม
    return groups.filter(g => {
        const gPlats = groupPlatforms(g);
        const platOk = !link.platforms.length || gPlats.length === 0 || gPlats.some(p => link.platforms.includes(p));
        const prodOk = !link.products.length || (g.products || []).some(c => link.products.includes(c));
        return platOk && prodOk;
    });
}

// GET /api/agency/:token — ข้อมูลแคมเปญ + รายชื่อที่ส่งไปแล้ว (พร้อมสถานะคัดเลือก)
router.get('/:token', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project, link } = resolved;
        const subs = scopeSubs(await store.submissions.listByProject(project.id), link);
        res.json({
            status: 'success',
            data: {
                project_name: project.name,
                brand: project.brand,
                objective: project.objective,
                brief_link: project.brief_link,
                products: project.products || [],
                ad_groups: scopedAdGroups(project, link),
                kol_target: project.kol_target || 0,
                agency_name: link.name,        // ชื่อเจ้าของลิงก์ (ถ้าเป็นลิงก์แยกต่อเจ้า)
                agency_scope: { products: link.products || [], platforms: link.platforms || [], kol_count: link.kol_count || 0 }, // ขอบเขตงานที่รับผิดชอบ
                product_briefs: scopedProductBriefs(project, link),   // บรีฟต่อสินค้า เฉพาะของเจ้านี้
                platform_briefs: scopedPlatformBriefs(project, link), // บรีฟหลักต่อ Platform เฉพาะของเจ้านี้
                platform_budgets: scopedPlatformBudgets(project, link), // งบต่อ Platform เฉพาะของเจ้านี้
                submissions: subs,
                reports: Array.isArray(link.reports) ? link.reports : []   // Report ที่เจ้านี้ส่งเข้ามาแล้ว
            }
        });
    } catch (err) { next(err); }
});

// POST /api/agency/:token — Agency ส่งรายชื่อ KOL
router.post('/:token', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project, link } = resolved;
        const { account_name, followers, platform, product, budget, agency, link_account, group_key, tier } = req.body;
        if (!account_name) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ Account' });
        // จำนวนวัน Gencode เริ่มต้น = ตามที่ตั้งไว้ในกลุ่มสินค้านั้น (ถ้ามี)
        const grp = (project.ad_groups || []).find(g => g.key === group_key);
        // กลุ่มนี้กำหนดให้ 1 คนส่งหลายคลิป -> สร้างแถวให้ครบทุกคลิปเลย เอเจนซี่กรอกชื่อครั้งเดียว
        const rows = await store.submissions.addPerson({
            project_id: project.id,
            account_name,
            followers: Number(followers) || 0,
            platform: platform || null,
            product: product || null,
            budget: Number(budget) || 0,
            agency: agency || link.name || null,        // ค่าเริ่มต้น = ชื่อเจ้าของลิงก์
            link_account: link_account || null,
            group_key: group_key || null,
            tier: tier || null,
            code_expire: grp ? (Number(grp.code_expire) || 60) : 60,
            agency_token: link.scoped ? link.token : null   // ติดตราเจ้าของ (เฉพาะลิงก์แยกต่อเจ้า)
        }, (grp && grp.clips) || []);
        res.status(201).json({ status: 'success', data: rows[0], data_all: rows });
    } catch (err) { next(err); }
});

// PUT /api/agency/:token/submissions/:subId — Agency อัปเดตดราฟงาน (ลิงค์งาน/Gencode/feedback/approve)
router.put('/:token/submissions/:subId', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project, link } = resolved;
        // ลิงก์แยกต่อเจ้า: แก้ได้เฉพาะ KOL ของตัวเอง
        if (link.scoped) {
            const existing = await store.submissions.get(req.params.subId);
            if (!existing || existing.project_id !== project.id || existing.agency_token !== link.token) {
                return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์แก้ไขรายการนี้' });
            }
        }
        const {
            account_name, followers, platform, product, agency, budget, link_account, agency_note,
            draft_link, draft_link2, draft_link3, draft_link4, draft_link5,
            gencode, feedback, feedback2, feedback3, feedback4, feedback5,
            approved, draft_status, post_url, post_date, id_post, code_expire,
            views, likes, comments, saves, shares   // ผลงานคอนเทนต์ จากโมดัล Perf
        } = req.body;
        if (account_name !== undefined && !String(account_name).trim()) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อ Account' });
        }
        // ช่อง "ตัวคน" (ชื่อ/ยอดฟอล/Platform/สินค้า/ลิงก์ช่อง/ผู้ติดต่อ) แก้ทีเดียวให้ครบทุกคลิป
        // ช่อง "ตัวงาน" (งบ/Gencode/ดราฟ/โพสต์/ยอดวิว) เป็นของแต่ละคลิป จึงแก้เฉพาะแถวนั้น
        const personFields = ['account_name', 'followers', 'platform', 'product', 'link_account', 'agency'];
        const isPersonEdit = personFields.some(f => req.body[f] !== undefined);
        const writer = isPersonEdit ? store.submissions.updatePerson : store.submissions.update;
        const data = await writer.call(store.submissions, req.params.subId, project.id, {
            account_name: account_name !== undefined ? String(account_name).trim() : undefined,
            followers: followers !== undefined ? (Number(followers) || 0) : undefined,
            platform, product, agency,
            budget: budget !== undefined ? (Number(budget) || 0) : undefined,
            link_account,
            agency_note: agency_note !== undefined ? ((agency_note && String(agency_note).trim()) ? String(agency_note).trim() : null) : undefined,
            draft_link, draft_link2, draft_link3, draft_link4, draft_link5,
            gencode, feedback, feedback2, feedback3, feedback4, feedback5,
            approved, draft_status, post_url, post_date, id_post, code_expire,
            views: views !== undefined ? (Number(views) || 0) : undefined, likes: likes !== undefined ? (Number(likes) || 0) : undefined, comments: comments !== undefined ? (Number(comments) || 0) : undefined, saves: saves !== undefined ? (Number(saves) || 0) : undefined, shares: shares !== undefined ? (Number(shares) || 0) : undefined
        }, link.name ? `${link.name} (เอเจนซี่)` : 'เอเจนซี่');   // ฝั่งนี้ไม่มีบัญชีผู้ใช้ ใช้ชื่อจากลิงก์แทน
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/agency/:token/submissions/:subId — Agency ลบรายชื่อของตัวเองออก
router.delete('/:token/submissions/:subId', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project, link } = resolved;
        const target = await store.submissions.get(req.params.subId);
        if (!target || target.project_id !== project.id) {
            return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        }
        // ลิงก์แยกต่อเจ้า: ลบได้เฉพาะรายชื่อที่ส่งผ่านลิงก์ตัวเอง
        if (link.scoped && target.agency_token !== link.token) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์ลบรายการนี้' });
        }
        // ลบทั้งคน (ทุกคลิปของคนนี้) — หน้าคัดเลือกยุบเป็นแถวเดียว การลบจึงต้องลบทั้งชุด
        const gone = await store.submissions.removePerson(req.params.subId, project.id);
        res.json({ status: 'success', message: `ลบรายชื่อแล้ว (${gone.removed} คลิป)` });
    } catch (err) { next(err); }
});

// POST /api/agency/:token/batch — Agency ส่งรายชื่อหลายคนพร้อมกัน
router.post('/:token/batch', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project, link } = resolved;
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        const valid = items.filter(it => it && it.account_name && String(it.account_name).trim());
        if (valid.length === 0) return res.status(400).json({ status: 'error', message: 'กรุณากรอกอย่างน้อย 1 รายชื่อ' });

        const added = [];
        for (const it of valid) {
            const grp = (project.ad_groups || []).find(g => g.key === it.group_key);
            const rows = await store.submissions.addPerson({
                project_id: project.id,
                account_name: String(it.account_name).trim(),
                followers: Number(it.followers) || 0,
                platform: it.platform || null,
                product: it.product || null,
                budget: Number(it.budget) || 0,
                agency: link.name || null,
                agency_token: link.scoped ? link.token : null,
                group_key: it.group_key || null
            }, (grp && grp.clips) || []);
            added.push(...rows);
        }
        res.status(201).json({ status: 'success', count: added.length, data: added });
    } catch (err) { next(err); }
});

// GET /api/agency/:token/product-brief/:code/file — เอเจนซี่เปิดไฟล์บรีฟสินค้า (สาธารณะ, จำกัดตามขอบเขต)
router.get('/:token/product-brief/:code/file', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้อง' });
        const { project, link } = resolved;
        const code = req.params.code;
        if (link.scoped && link.products.length && !link.products.includes(code)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์เปิดไฟล์นี้' });
        }
        const pb = project.product_briefs || {};
        const meta = pb[code] && pb[code].file;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์บรีฟ' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// GET /api/agency/:token/platform-brief/:platform/file — เอเจนซี่เปิดไฟล์บรีฟ Platform (สาธารณะ, จำกัดตามขอบเขต)
router.get('/:token/platform-brief/:platform/file', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้อง' });
        const { project, link } = resolved;
        const pf = req.params.platform;
        if (link.scoped && link.platforms.length && !link.platforms.includes(pf)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์เปิดไฟล์นี้' });
        }
        const pb = project.platform_briefs || {};
        const meta = pb[pf] && pb[pf].file;
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์บรีฟ' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// ---------- Report ที่เอเจนซี่ส่งเข้ามา ----------
// POST /api/agency/:token/reports — อัปไฟล์ (field "file") หรือส่งลิงก์ ({ url, note })
router.post('/:token/reports', (req, res, next) => {
    const isFile = String(req.headers['content-type'] || '').startsWith('multipart/');
    if (!isFile) return next();
    reportUpload.single('file')(req, res, err => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        next();
    });
}, async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const { project } = resolved;
        let meta;
        if (req.file) {
            meta = { kind: 'file', original: req.file.originalname, filename: req.file.filename, size: req.file.size };
        } else {
            const url = (req.body.url || '').trim();
            const okUrl = url.toLowerCase().startsWith('http://') || url.toLowerCase().startsWith('https://');
            if (!okUrl) return res.status(400).json({ status: 'error', message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' });
            meta = { kind: 'link', original: (req.body.note || '').trim() || url, url };
        }
        const row = await store.projects.addAgencyReport(project.id, req.params.token, meta);
        if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบลิงก์เอเจนซี่' });
        res.status(201).json({ status: 'success', data: row });
    } catch (err) { next(err); }
});

// GET /api/agency/:token/reports/:reportId/file — เปิด/ดาวน์โหลดไฟล์
router.get('/:token/reports/:reportId/file', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const r = await store.projects.getAgencyReport(resolved.project.id, req.params.token, req.params.reportId);
        if (!r || r.kind !== 'file') return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const fp = path.join(UPLOAD_DIR, r.filename);
        if (!fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(fp);
    } catch (err) { next(err); }
});

// DELETE /api/agency/:token/reports/:reportId — เอเจนซี่ลบของตัวเองได้ (เผื่อส่งผิดไฟล์)
router.delete('/:token/reports/:reportId', async (req, res, next) => {
    try {
        const resolved = await store.projects.resolveToken(req.params.token);
        if (!resolved) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const gone = await store.projects.removeAgencyReport(resolved.project.id, req.params.token, req.params.reportId);
        if (!gone) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการ' });
        if (gone.kind === 'file' && gone.filename) {
            const fp = path.join(UPLOAD_DIR, gone.filename);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ลบไฟล์ไม่ได้ก็ปล่อย ข้อมูลถูกลบไปแล้ว */ }
        }
        res.json({ status: 'success', data: gone });
    } catch (err) { next(err); }
});

// ---------- แชทกับทีม ----------
// GET /api/agency/:token/messages
router.get('/:token/messages', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const data = await store.projects.listAgencyMessages(r.project.id, req.params.token);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบห้องแชท' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/agency/:token/messages — ข้อความ (+ รูป 1 ใบ)
router.post('/:token/messages', (req, res, next) => {
    if (!String(req.headers['content-type'] || '').startsWith('multipart/')) return next();
    chatImage.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }])(req, res, err => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        next();
    });
}, async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const text = String(req.body.text || '').trim();
        const full = req.files && req.files.image && req.files.image[0];
        const thumb = req.files && req.files.thumb && req.files.thumb[0];
        if (!text && !full) return res.status(400).json({ status: 'error', message: 'พิมพ์ข้อความ หรือแนบรูปอย่างน้อยหนึ่งอย่าง' });
        const row = await store.projects.addAgencyMessage(r.project.id, req.params.token, {
            from: 'agency',
            by: r.link.name || 'เอเจนซี่',
            text,
            image: full ? { filename: full.filename, original: full.originalname, size: full.size } : null,
            thumb: thumb ? { filename: thumb.filename, original: thumb.originalname, size: thumb.size } : null
        });
        if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบห้องแชท' });
        chatHub.broadcast(req.params.token);   // เด้งให้ทุกคนที่เปิดห้องอยู่รู้ทันที
        res.status(201).json({ status: 'success', data: row });
    } catch (err) { next(err); }
});

// POST /api/agency/:token/messages/read — บอกว่าอ่านถึงตอนนี้แล้ว
router.post('/:token/messages/read', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        await store.projects.markAgencyRead(r.project.id, req.params.token, 'agency');
        res.json({ status: 'success' });
    } catch (err) { next(err); }
});

// GET /api/agency/:token/messages/:msgId/image
// :which = image (รูปเต็ม ตอนกดขยาย) | thumb (รูปย่อ ที่โชว์ในแชท)
router.get('/:token/messages/:msgId/:which(image|thumb)', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const img = await store.projects.getAgencyMessageImage(r.project.id, req.params.token, req.params.msgId, req.params.which);
        if (!img) return res.status(404).json({ status: 'error', message: 'ไม่พบรูป' });
        const fp = path.join(UPLOAD_DIR, img.filename);
        if (!fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        // รูปในข้อความไม่มีวันเปลี่ยน (URL ผูกกับ id ข้อความ) เก็บ cache ยาวไปเลย
        // เปิดแชทซ้ำจะได้ไม่ต้องวิ่งถาม server ใหม่ทุกรูป
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(fp);
    } catch (err) { next(err); }
});

// GET /api/agency/:token/stream — ช่องแจ้งว่ามีข้อความใหม่ (ใช้ร่วมกันทั้งทีมและเอเจนซี่)
// ส่งแค่สัญญาณ ไม่มีเนื้อข้อความ ระดับความลับจึงเท่ากับตัวลิงก์เอเจนซี่เอง
router.get('/:token/stream', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        chatHub.subscribe(req.params.token, req, res);
    } catch (err) { next(err); }
});

// PATCH /api/agency/:token/messages/:msgId — แก้ข้อความของตัวเอง
router.patch('/:token/messages/:msgId', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const text = String(req.body.text || '').trim();
        if (!text) return res.status(400).json({ status: 'error', message: 'ข้อความว่างไม่ได้ — ถ้าจะเอาออกให้กดลบแทน' });
        const out = await store.projects.editAgencyMessage(r.project.id, req.params.token, req.params.msgId, 'agency', text);
        if (out.error === 404) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อความ' });
        if (out.error === 403) return res.status(403).json({ status: 'error', message: 'แก้ได้เฉพาะข้อความของตัวเอง' });
        if (out.error === 410) return res.status(410).json({ status: 'error', message: 'ข้อความนี้ถูกลบไปแล้ว' });
        chatHub.broadcast(req.params.token);
        res.json({ status: 'success', data: out.data });
    } catch (err) { next(err); }
});

// DELETE /api/agency/:token/messages/:msgId — ลบข้อความของตัวเอง
router.delete('/:token/messages/:msgId', async (req, res, next) => {
    try {
        const r = await store.projects.resolveToken(req.params.token);
        if (!r) return res.status(404).json({ status: 'error', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
        const out = await store.projects.deleteAgencyMessage(r.project.id, req.params.token, req.params.msgId, 'agency');
        if (out.error === 404) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อความ' });
        if (out.error === 403) return res.status(403).json({ status: 'error', message: 'ลบได้เฉพาะข้อความของตัวเอง' });
        (out.files || []).forEach(f => {
            const fp = path.join(UPLOAD_DIR, f);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ลบไฟล์ไม่ได้ก็ปล่อย ข้อมูลถูกลบไปแล้ว */ }
        });
        chatHub.broadcast(req.params.token);
        res.json({ status: 'success', data: out.data });
    } catch (err) { next(err); }
});

module.exports = router;
