const express = require('express');
const store = require('../store');
const { requireRole } = require('../middleware/auth');
const { CODE_SHAPE } = require('../store/productFamilies');

// ===== หน้า Products & Targets (เมนู ADMIN · ผู้ใช้สั่ง 7 ต.ค. 2026) =====
// เก็บเฉพาะส่วนต่างจากรายการตั้งต้นในโค้ด (client/src/data/products.js) — ดู store/pg/catalog.js
// อ่าน: ทุกคนที่ล็อกอินแล้ว รวมบัญชีเอเจนซี่ (หน้าเอเจนซี่ใช้ชื่อสินค้าใหม่ด้วย) — app.js ผูกเส้นนี้โดยไม่มี blockAgency
// แก้: admin เท่านั้น · ไม่มีการลบ (ซ่อนแทน) · ทุกการแก้ลง Activity Log · ทุกเส้นที่แก้ตอบส่วนต่างล่าสุดกลับไปทั้งก้อน
const router = express.Router();

const actorName = req => (req.account && (req.account.nickname || req.account.full_name)) || (req.user && req.user.username) || null;
const by = req => ({ byId: req.user && req.user.id, byName: actorName(req) });

async function record(req, action, summary) {
    try {
        await store.activity.log({
            user_id: req.user.id, team_id: req.user.team_id, action,
            project_id: null, project_name: 'Products & Targets', summary
        });
    } catch { /* บันทึกประวัติพลาดไม่ขวางงานหลัก */ }
}

// ---- ตรวจค่าขาเข้า (คืน { value } หรือ { error: ข้อความไทย }) ----
const str = v => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
// รหัส: ตัวพิมพ์ใหญ่ รูปแบบเดียวกับรหัสที่มีอยู่ (JNP4, BTA5-01, L8C) — หน้าเว็บแยกรายการ / ใส่ใน URL บรีฟต่อสินค้าได้ปลอดภัย
function codeOf(v) {
    const code = str(v).trim().toUpperCase();
    if (!code) return { error: 'กรุณาใส่รหัสสินค้า' };
    if (code.length > 40 || !CODE_SHAPE.test(code)) return { error: `รหัส "${code}" ใช้ไม่ได้ — ต้องเป็นตัวอักษรอังกฤษ 1-8 ตัว + ตัวเลข (ต่อด้วยตัวอักษร 1 ตัว หรือ -ตัวเลข ได้) เช่น JNP4, BTA5-01, L8C, JNPSET1` };
    return { value: code };
}
function textOf(v, label, max) {
    const t = str(v).trim();
    if (!t) return { error: `กรุณาใส่${label}` };
    if (t.length > max) return { error: `${label}ยาวเกิน ${max} ตัวอักษร` };
    if (/[\r\n]/.test(t)) return { error: `${label}ต้องเป็นบรรทัดเดียว` };
    return { value: t };
}
// ชื่อ Target ต้องตรงกับระบบยิงแอด — เก็บตามที่พิมพ์ (ตัดแค่ช่องว่างหัวท้าย) · ห้ามจุลภาค (หลายที่แยกรายการด้วย ,)
function targetOf(v) {
    const r = textOf(v, 'ชื่อ Target', 100);
    if (r.error) return r;
    if (/[,，]/.test(r.value)) return { error: 'ชื่อ Target ห้ามมีจุลภาค (,)' };
    return r;
}
function codesOf(v) {
    if (!Array.isArray(v) || !v.length) return { error: 'กรุณาเลือกสินค้าอย่างน้อย 1 ตัว' };
    if (v.length > 300) return { error: 'เลือกสินค้าได้ครั้งละไม่เกิน 300 ตัว' };
    const out = [];
    for (const c of v) {
        const r = codeOf(c);
        if (r.error) return r;
        if (!out.includes(r.value)) out.push(r.value);
    }
    return { value: out };
}
const fail = (res, status, message) => res.status(status).json({ status: 'error', message });
const sendOverlay = async (res, status = 200) => res.status(status).json({ status: 'success', data: await store.catalog.overlay() });
const handle = (err, res, next) => (err && err.status ? fail(res, err.status, err.message) : next(err));

// GET /api/catalog — ส่วนต่างทั้งหมด { ready, products, targets }
router.get('/', async (req, res, next) => {
    try { await sendOverlay(res); } catch (err) { handle(err, res, next); }
});

// POST /api/catalog/products — เพิ่มสินค้าใหม่ { code, name, brand, targets?: [ชื่อ Target] }
router.post('/products', requireRole('admin'), async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(b.code); if (code.error) return fail(res, 400, code.error);
        const name = textOf(b.name, 'ชื่อสินค้า', 200); if (name.error) return fail(res, 400, name.error);
        const brand = textOf(b.brand, 'แบรนด์', 100); if (brand.error) return fail(res, 400, brand.error);
        const targets = [];
        for (const t of Array.isArray(b.targets) ? b.targets : []) {
            const r = targetOf(t); if (r.error) return fail(res, 400, r.error);
            if (!targets.some(x => x.toLowerCase() === r.value.toLowerCase())) targets.push(r.value);
        }
        if (await store.catalog.findProduct(code.value)) return fail(res, 409, `มีสินค้ารหัส ${code.value} อยู่แล้ว`);
        // สินค้า + Target ทั้งหมดบันทึกใน transaction เดียว — พลาดกลางทาง = ไม่มีอะไรค้าง (กดบันทึกใหม่ได้ ไม่ติด "มีอยู่แล้ว")
        await store.catalog.addProduct({ code: code.value, name: name.value, brand: brand.value }, by(req), targets);
        await record(req, 'create', `เพิ่มสินค้า ${code.value} - ${name.value} (${brand.value})${targets.length ? ' · Target: ' + targets.join(', ') : ''}`);
        await sendOverlay(res, 201);
    } catch (err) {
        if (err && err.code === '23505') return fail(res, 409, 'มีสินค้ารหัสนี้อยู่แล้ว');
        handle(err, res, next);
    }
});

// PATCH /api/catalog/products/:code — ซ่อน / เอากลับ { hidden } · แก้ชื่อสินค้าที่เพิ่มเอง { name }
// สินค้าตั้งต้นที่ยังไม่มีแถว ต้องส่ง name + brand มาด้วย (เก็บไว้เป็นข้อมูลอ้างอิง — หน้าเว็บยึดชื่อตามโค้ด)
router.patch('/products/:code', requireRole('admin'), async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(req.params.code); if (code.error) return fail(res, 400, code.error);
        const cur = await store.catalog.findProduct(code.value);
        if (b.hidden !== undefined) {
            // ซ่อน / เอากลับ — name / brand ใช้แค่ตอนสร้างแถวให้สินค้าตั้งต้นที่ยังไม่มีแถว (ไม่ใช่การแก้ชื่อ)
            if (typeof b.hidden !== 'boolean') return fail(res, 400, 'hidden ต้องเป็น true / false');
            if (!cur) {
                const n = textOf(b.name, 'ชื่อสินค้า', 200); if (n.error) return fail(res, 400, n.error);
                const br = textOf(b.brand, 'แบรนด์', 100); if (br.error) return fail(res, 400, br.error);
                await store.catalog.setProduct(code.value, { hidden: b.hidden, name: n.value, brand: br.value }, by(req));
            } else {
                await store.catalog.setProduct(code.value, { hidden: b.hidden }, by(req));
            }
            await record(req, 'update', `${b.hidden ? 'ซ่อนสินค้า' : 'เอาสินค้ากลับมาใช้'} ${code.value}`);
            // ต้อง await ใน try — อ่านส่วนต่างพลาดแล้วไม่ await = promise ค้างไม่มีคนรับ server ล้มทั้งตัว
            await sendOverlay(res);
            return;
        }
        if (b.name === undefined) return fail(res, 400, 'ไม่มีอะไรให้แก้');
        // แก้ชื่อ — เฉพาะสินค้าที่ Admin เพิ่มเอง (สินค้าตั้งต้นยึดชื่อตามโค้ด หน้าเว็บไม่ใช้ชื่อในแถว)
        const name = textOf(b.name, 'ชื่อสินค้า', 200); if (name.error) return fail(res, 400, name.error);
        if (!cur) return fail(res, 404, `แก้ชื่อได้เฉพาะสินค้าที่เพิ่มในหน้านี้ (${code.value} เป็นสินค้าตั้งต้น)`);
        await store.catalog.setProduct(code.value, { name: name.value }, by(req));
        await record(req, 'update', `แก้ชื่อสินค้า ${code.value}: ${cur.name || ''} → ${name.value}`);
        await sendOverlay(res);
    } catch (err) { handle(err, res, next); }
});

// POST /api/catalog/targets — เพิ่ม Target ให้สินค้า (หลายตัวได้) { target, codes: [...] } · ชื่อเดิมที่ซ่อนไว้ = เอากลับมา
router.post('/targets', requireRole('admin'), async (req, res, next) => {
    try {
        const b = req.body || {};
        const target = targetOf(b.target); if (target.error) return fail(res, 400, target.error);
        const codes = codesOf(b.codes); if (codes.error) return fail(res, 400, codes.error);
        await store.catalog.setTargets(codes.value, target.value, false, by(req));
        await record(req, 'create', `เพิ่ม Target ${target.value} ให้ ${codes.value.join(', ')}`);
        await sendOverlay(res, 201);
    } catch (err) { handle(err, res, next); }
});

// PATCH /api/catalog/targets — ซ่อน / เอากลับ Target ของสินค้า { code, target, hidden }
router.patch('/targets', requireRole('admin'), async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(b.code); if (code.error) return fail(res, 400, code.error);
        const target = targetOf(b.target); if (target.error) return fail(res, 400, target.error);
        if (typeof b.hidden !== 'boolean') return fail(res, 400, 'hidden ต้องเป็น true / false');
        await store.catalog.setTargets([code.value], target.value, b.hidden, by(req));
        await record(req, 'update', `${b.hidden ? 'ซ่อน' : 'เอากลับ'} Target ${target.value} ของ ${code.value}`);
        await sendOverlay(res);
    } catch (err) { handle(err, res, next); }
});

module.exports = router;
