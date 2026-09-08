const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('../store');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ทุก endpoint ในไฟล์นี้ — admin เท่านั้น (เห็น + แก้ไขได้คนเดียว)
router.use(authenticate, requireRole('admin'));

// ---------- ตั้งค่าที่เก็บไฟล์อัปโหลด ----------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        // ตั้งชื่อไฟล์แบบไม่ซ้ำ (เดาไม่ได้)
        const ext = path.extname(file.originalname);
        const unique = `${req.params.projectId}_${req.params.type}_${Date.now()}${ext}`;
        cb(null, unique);
    }
});
// สลิปของรอบทำจ่าย — ตั้งชื่อไฟล์คนละแบบกับใบเสนอราคา/ใบแจ้งหนี้
const slipStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `batch${req.params.id}_slip_${Date.now()}${ext}`);
    }
});
const fileOk = (req, file, cb) => {
    const ok = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('รองรับเฉพาะไฟล์ PDF หรือรูปภาพ'), ok);
};
const slipUpload = multer({ storage: slipStorage, limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: fileOk });
// ใบแจ้งหนี้รายงวด
const invUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `inst${req.params.id}_invoice_${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: fileOk
});
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
        const ok = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('รองรับเฉพาะไฟล์ PDF หรือรูปภาพ'), ok);
    }
});

// GET /api/payments — รายการ Project ทั้งหมด + ข้อมูลการจ่าย
router.get('/', async (req, res, next) => {
    try {
        const data = await store.payments.listWithProjects();
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// ===================== งวดการจ่าย =====================
// ประกาศไว้ก่อน /:projectId เพื่อไม่ให้ชนกัน

// GET /api/payments/installments?status=pending — งวดทั้งหมด (ไว้ทำหน้ารวมรอบจ่าย)
router.get('/installments', async (req, res, next) => {
    try {
        const data = await store.installments.list({ status: req.query.status || null });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/payments/installments/:id/invoice — แนบใบแจ้งหนี้ของงวดนี้
router.post('/installments/:id/invoice', (req, res, next) => {
    invUpload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const data = await store.installments.setInvoice(req.params.id, meta);
            if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบงวดนี้' });
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// PUT /api/payments/installments/:id/invoice-link — ใส่ใบแจ้งหนี้เป็นลิงก์แทนไฟล์
router.put('/installments/:id/invoice-link', async (req, res, next) => {
    try {
        const data = await store.installments.setInvoiceLink(req.params.id, req.body && req.body.link);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบงวดนี้' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// ลบไฟล์ออกจากดิสก์ด้วย ไม่งั้นจะเหลือไฟล์กำพร้าสะสมในโฟลเดอร์ uploads
function dropFile(meta) {
    if (!meta || !meta.filename) return;
    const f = path.join(UPLOAD_DIR, meta.filename);
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ลบไฟล์ไม่ได้ก็ไม่ต้องขวางการลบข้อมูล */ }
}

// DELETE /api/payments/installments/:id/invoice — ลบใบแจ้งหนี้ของงวด (เผื่อใส่ผิดใบ)
router.delete('/installments/:id/invoice', async (req, res, next) => {
    try {
        const it = await store.installments.get(req.params.id);
        if (!it) return res.status(404).json({ status: 'error', message: 'ไม่พบงวดนี้' });
        dropFile(it.invoice);
        const data = await store.installments.setInvoice(req.params.id, null);
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/payments/installments/:id/invoice — เปิดใบแจ้งหนี้ของงวด
router.get('/installments/:id/invoice', async (req, res, next) => {
    try {
        const it = await store.installments.get(req.params.id);
        if (!it || !it.invoice) return res.status(404).json({ status: 'error', message: 'ยังไม่ได้แนบใบแจ้งหนี้' });
        const filePath = path.join(UPLOAD_DIR, it.invoice.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// PUT /api/payments/installments/:id — แก้ยอด/วันครบกำหนดของงวดเดียว
router.put('/installments/:id', async (req, res, next) => {
    try {
        const { amount, percent, due_date, note } = req.body;
        const r = await store.installments.update(req.params.id, { amount, percent, due_date, note });
        if (r.error) return res.status(400).json({ status: 'error', message: r.error });
        res.json({ status: 'success', data: r.data });
    } catch (err) { next(err); }
});

// DELETE /api/payments/:projectId/plan — ลบแผนของเอเจนซี่+กลุ่มนั้นทั้งชุด
router.delete('/:projectId/plan', async (req, res, next) => {
    try {
        const agency = req.query.agency || (req.body && req.body.agency);
        const groupKey = req.query.group_key || (req.body && req.body.group_key) || null;
        if (!agency) return res.status(400).json({ status: 'error', message: 'กรุณาระบุเอเจนซี่' });
        const r = await store.installments.removePlan(req.params.projectId, agency, groupKey);
        if (r.error) return res.status(400).json({ status: 'error', message: r.error });
        res.json({ status: 'success', data: r.data });
    } catch (err) { next(err); }
});

// PUT /api/payments/:projectId/plan — ตั้งแผนแบ่งงวดของแคมเปญ+เอเจนซี่
// body: { agency, plan: [{ percent, amount, due_date, note }] }
router.put('/:projectId/plan', async (req, res, next) => {
    try {
        const { agency, group_key, plan } = req.body;
        if (!agency) return res.status(400).json({ status: 'error', message: 'กรุณาระบุเอเจนซี่ของแผนนี้' });
        if (!Array.isArray(plan) || !plan.length) {
            return res.status(400).json({ status: 'error', message: 'กรุณาระบุงวดอย่างน้อย 1 งวด' });
        }
        if (plan.length > 12) return res.status(400).json({ status: 'error', message: 'แบ่งได้สูงสุด 12 งวด' });
        const r = await store.installments.setPlan(req.params.projectId, agency, group_key || null, plan);
        if (r.error) return res.status(400).json({ status: 'error', message: r.error });
        res.json({ status: 'success', data: r.data });
    } catch (err) { next(err); }
});

// ===================== รอบทำจ่าย (สลิป 1 ใบ) =====================

// GET /api/payments/batches
router.get('/batches', async (req, res, next) => {
    try {
        res.json({ status: 'success', data: await store.payBatches.list() });
    } catch (err) { next(err); }
});

// POST /api/payments/batches — มัดหลายงวดเป็นรอบเดียว
router.post('/batches', async (req, res, next) => {
    try {
        const { agency, pay_date, installment_ids, note } = req.body;
        const r = await store.payBatches.create({
            agency, pay_date, installment_ids, note,
            created_by: req.user && req.user.username
        });
        if (r.error) return res.status(400).json({ status: 'error', message: r.error });
        res.status(201).json({ status: 'success', data: r.data });
    } catch (err) { next(err); }
});

// POST /api/payments/batches/:id/items — เติมงวดเข้ารอบเดิม (สลิปใบเดียวเหมือนเดิม)
router.post('/batches/:id/items', async (req, res, next) => {
    try {
        const r = await store.payBatches.addItems(req.params.id, req.body && req.body.installment_ids);
        if (r.error) return res.status(400).json({ status: 'error', message: r.error });
        res.json({ status: 'success', data: r.data });
    } catch (err) { next(err); }
});

// PUT /api/payments/batches/:id — แก้วันจ่าย/โน้ต
router.put('/batches/:id', async (req, res, next) => {
    try {
        const data = await store.payBatches.update(req.params.id, req.body || {});
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรอบทำจ่ายนี้' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// DELETE /api/payments/batches/:id — ยกเลิกรอบ งวดข้างในกลับไปค้างจ่าย
router.delete('/batches/:id', async (req, res, next) => {
    try {
        const ok = await store.payBatches.remove(req.params.id);
        if (!ok) return res.status(404).json({ status: 'error', message: 'ไม่พบรอบทำจ่ายนี้' });
        res.json({ status: 'success', data: { removed: true } });
    } catch (err) { next(err); }
});

// POST /api/payments/batches/:id/slip — แนบสลิปของรอบนี้
router.post('/batches/:id/slip', (req, res, next) => {
    slipUpload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const data = await store.payBatches.setSlip(req.params.id, meta);
            if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรอบทำจ่ายนี้' });
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// GET /api/payments/batches/:id/slip — เปิดสลิป
router.get('/batches/:id/slip', async (req, res, next) => {
    try {
        const b = await store.payBatches.get(req.params.id);
        if (!b || !b.slip) return res.status(404).json({ status: 'error', message: 'ยังไม่ได้แนบสลิป' });
        const filePath = path.join(UPLOAD_DIR, b.slip.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

// PUT /api/payments/:projectId — แก้ ชื่อเอเจนซี่ / รอบวันจ่าย / สถานะ / โน้ต
router.put('/:projectId', async (req, res, next) => {
    try {
        const { agency_name, payment_date, status, notes, quotation_link } = req.body;
        const data = await store.payments.update(req.params.projectId, { agency_name, payment_date, status, notes, quotation_link });
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// POST /api/payments/:projectId/upload/:type — อัปโหลดไฟล์ (type = quotation | invoice)
router.post('/:projectId/upload/:type', (req, res, next) => {
    const { type } = req.params;
    if (!['quotation', 'invoice'].includes(type)) {
        return res.status(400).json({ status: 'error', message: 'ประเภทไฟล์ไม่ถูกต้อง' });
    }
    upload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'ไม่พบไฟล์' });
        try {
            const meta = {
                filename: req.file.filename,
                original: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
                size: req.file.size,
                uploaded_at: new Date().toISOString()
            };
            const data = await store.payments.setFile(req.params.projectId, type, meta);
            if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });
            res.json({ status: 'success', data });
        } catch (e) { next(e); }
    });
});

// DELETE /api/payments/:projectId/file/:type — ลบเอกสารของแคมเปญ
router.delete('/:projectId/file/:type', async (req, res, next) => {
    try {
        const { type } = req.params;
        if (!['quotation', 'invoice'].includes(type)) {
            return res.status(400).json({ status: 'error', message: 'ประเภทไฟล์ไม่ถูกต้อง' });
        }
        const pay = await store.payments.get(req.params.projectId);
        dropFile(pay && pay[type]);
        const data = await store.payments.setFile(req.params.projectId, type, null);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบ Project' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// GET /api/payments/:projectId/file/:type — ดาวน์โหลด/เปิดไฟล์
router.get('/:projectId/file/:type', async (req, res, next) => {
    try {
        const pay = await store.payments.get(req.params.projectId);
        const meta = pay && pay[req.params.type];
        if (!meta) return res.status(404).json({ status: 'error', message: 'ไม่พบไฟล์' });
        const filePath = path.join(UPLOAD_DIR, meta.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'ไฟล์หายไป' });
        res.sendFile(filePath);
    } catch (err) { next(err); }
});

module.exports = router;
