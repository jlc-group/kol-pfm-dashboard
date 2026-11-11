const express = require('express');
const store = require('../store');
const { CODE_SHAPE, familiesWith, setItemsOf } = require('../store/productFamilies');
const { canManageCatalog, seesAllBrands, canSeeBrand, allowedBrands } = require('../data/roles');
const catalogBrands = require('../store/catalogBrands');

// ===== หน้า Products & Targets (เมนู ADMIN · ผู้ใช้สั่ง 7 ต.ค. 2026) =====
// เก็บเฉพาะส่วนต่างจากรายการตั้งต้นในโค้ด (client/src/data/products.js) — ดู store/pg/catalog.js
// อ่าน: ทุกคนที่ล็อกอินแล้ว รวมบัญชีเอเจนซี่ (หน้าเอเจนซี่ใช้ชื่อสินค้าใหม่ด้วย) — app.js ผูกเส้นนี้โดยไม่มี blockAgency
// แก้: admin (ทุกแบรนด์) + ทีม Ads (เฉพาะสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ · ผู้ใช้สั่ง 21 ต.ค. 2026) · ไม่มีการลบ (ซ่อนแทน) · ทุกการแก้ลง Activity Log · ทุกเส้นที่แก้ตอบส่วนต่างล่าสุดกลับไปทั้งก้อน
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
// ---- สินค้าในเซ็ต (ผู้ใช้สั่ง 11 พ.ย. 2026 — JNPSET1 หน้า Ads ขึ้นเป็น JNP1, JNP2, JNP3) ----
// ตั้งได้เฉพาะสินค้าที่เพิ่มในหน้านี้ · สินค้าข้างในต้องอยู่ในคลัง แบรนด์เดียวกับเซ็ต · ไม่ซ้อนเซ็ต · รหัสในกลุ่มสีตั้งเป็นเซ็ตไม่ได้
// ช่อง PRODUCTS หน้า Ads + ฟีดยิงแอดกางเซ็ตเป็นสินค้าข้างใน (store/productFamilies.js familyMapWith / หน้าเว็บ data/products.js)
const SET_MAX = 30;
function itemsOf(v, self) {
    if (!Array.isArray(v)) return { error: 'สินค้าในเซ็ตต้องเป็นรายการรหัสสินค้า' };
    if (v.length > SET_MAX) return { error: `ใส่สินค้าในเซ็ตได้ไม่เกิน ${SET_MAX} ตัว` };
    const out = [];
    for (const c of v) {
        const r = codeOf(c);
        if (r.error) return r;
        if (r.value === self) return { error: `ใส่ ${self} เป็นสินค้าในเซ็ตของตัวเองไม่ได้` };
        if (!out.includes(r.value)) out.push(r.value);
    }
    return { value: out };
}
// กลุ่มสีแบบเดียวกับที่หน้าเว็บเห็น — คลังตั้งต้นทั้งหมด (ไม่ใช่แค่กลุ่มที่เขียนไว้ใน productFamilies.js) + แถวที่เพิ่มเอง + แถวที่จะเพิ่ม
// (สินค้าตั้งต้นตัวเดี่ยวอย่าง T6A + T6B ที่เพิ่มทีหลัง = กลุ่มสีบนหน้าเว็บ · ผลรีวิว 11 พ.ย.) · แถวในฐานของสินค้าตั้งต้นยึดแบรนด์ตามโค้ด
async function familiesForGuard(rows, extra) {
    const builtin = await catalogBrands.builtinBrands();
    return familiesWith([
        ...[...builtin].map(([code, brand]) => ({ code, brand })),
        ...rows.filter(p => !builtin.has(p.code)),
        ...(extra ? [extra] : [])
    ]);
}
const isSetRow = (rows, code) => rows.some(p => p.code === code && setItemsOf(p).length > 0);

// สินค้าใหม่ที่จะเข้ากลุ่มสีเดียวกับเซ็ตที่มีอยู่ = ไม่รับ (เซ็ตต้องไม่อยู่ในกลุ่มสี — ไม่งั้นสีพี่น้องกางออกมาเป็นรหัสเซ็ตดิบ · ผลรีวิว 11 พ.ย.)
async function siblingOfSetProblem(code, brand, products) {
    const rows = Array.isArray(products) ? products.filter(p => p && typeof p.code === 'string' && p.code !== code) : [];
    if (!rows.some(p => setItemsOf(p).length)) return null;
    let fams;
    // โหลดคลังตั้งต้นไม่ได้ = ใช้กลุ่มจากแถวในฐาน + กลุ่มตั้งต้นในโค้ด (ไม่ขวางการเพิ่มสินค้าธรรมดา)
    try { fams = await familiesForGuard(rows, { code, brand }); } catch { fams = familiesWith([...rows, { code, brand }]); }
    const sets = (fams.get(code) || []).filter(c => c !== code && isSetRow(rows, c));
    return sets.length
        ? { status: 409, message: `รหัส ${code} จะไปเข้ากลุ่มสีเดียวกับเซ็ต ${sets.join(', ')} — ใช้รหัสอื่น หรือเอา ${sets.join(', ')} ออกจากการเป็นเซ็ตก่อน` }
        : null;
}

// ตรวจเซ็ตกับคลังตอนนี้ (products = แถว catalog_products พร้อม set_items) → { status, message } หรือ null
// items ว่าง (เอาออกจากการเป็นเซ็ต) ผ่านเสมอ · โหลดคลังตั้งต้นไม่ได้ = throw (route ตอบ 503 ไม่ปล่อยผ่าน)
async function setProblem(code, brand, items, products) {
    if (!items.length) return null;
    const rows = Array.isArray(products) ? products.filter(p => p && typeof p.code === 'string') : [];
    const brands = await catalogBrands.brandsOf(items, rows);
    const missing = items.filter(c => !brands.has(c));
    if (missing.length) return { status: 400, message: `ไม่มีสินค้า ${missing.join(', ')} ในคลัง` };
    const other = items.filter(c => brands.get(c) !== brand);
    if (other.length) return { status: 400, message: `${other.map(c => `${c} (${brands.get(c)})`).join(', ')} ไม่ใช่สินค้าของ ${brand} — ใส่ได้เฉพาะสินค้าแบรนด์เดียวกับเซ็ต` };
    const sets = rows.filter(p => p.code !== code && setItemsOf(p).length);
    const nested = items.filter(c => sets.some(p => p.code === c));
    if (nested.length) return { status: 409, message: `${nested.join(', ')} เป็นเซ็ตอยู่แล้ว — ใส่เซ็ตซ้อนในเซ็ตไม่ได้` };
    const parents = sets.filter(p => setItemsOf(p).includes(code)).map(p => p.code);
    if (parents.length) return { status: 409, message: `${code} อยู่ในเซ็ต ${parents.join(', ')} แล้ว — สินค้าที่อยู่ในเซ็ตอื่นตั้งเป็นเซ็ตไม่ได้` };
    // รหัสในกลุ่มสี (BTA4-09 ฯลฯ) กางทุกสีอยู่แล้ว — เป็นเซ็ตด้วยจะกางสองแบบชนกัน
    if ((await familiesForGuard(rows.filter(p => p.code !== code), { code, brand })).has(code)) {
        return { status: 409, message: `${code} อยู่ในกลุ่มสี (ช่อง PRODUCTS กางทุกสีอยู่แล้ว) — ตั้งเป็นเซ็ตไม่ได้` };
    }
    return null;
}

// ตัวตรวจที่ส่งให้ store ตรวจซ้ำใต้ล็อกในธุรกรรม (pg/catalog.js runVerify) — ตรวจไม่ได้ = 503 ไม่ปล่อยผ่าน (ROLLBACK)
const SET_CHECK_DOWN = { status: 503, message: 'ตรวจสินค้าในเซ็ตไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง' };
const safeVerify = fn => async rows => { try { return await fn(rows); } catch { return SET_CHECK_DOWN; } };

const fail = (res, status, message) => res.status(status).json({ status: 'error', message });
const sendOverlay = async (res, status = 200) => res.status(status).json({ status: 'success', data: await store.catalog.overlay() });
const handle = (err, res, next) => (err && err.status ? fail(res, err.status, err.message) : next(err));

// ---- ใครแก้ได้ (roles.js canManageCatalog) — admin ทุกแบรนด์ · ทีม Ads เฉพาะสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ ----
const requireCatalogEditor = (req, res, next) => (canManageCatalog(req.account)
    ? next() : fail(res, 403, 'แก้หน้า Products & Targets ได้เฉพาะผู้ดูแลระบบและทีม Ads'));
// ขอบเขตแบรนด์ของคนที่แก้ (null = admin ทุกแบรนด์) — ใช้กรองแคมเปญที่แก้ชื่อ Target ตามด้วย
const scopeOf = req => allowedBrands(req.account);
// ทีม Ads: ทุกรหัสต้องเป็นสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ · รหัสที่ไม่มีในคลัง = ไม่ผ่าน (ไม่เดาแบรนด์) · admin ไม่ต้องเช็ค
// ตอบ 403 ไปแล้ว = true (route หยุด) · โหลดคลังตั้งต้นไม่ได้ = 503
async function denyOtherBrands(req, res, codes) {
    if (seesAllBrands(req.account)) return false;
    let brands;
    try { brands = await catalogBrands.brandsOf(codes, (await store.catalog.overlay()).products); }
    catch { fail(res, 503, 'ตรวจแบรนด์ของสินค้าไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง'); return true; }
    const bad = codes.filter(c => !brands.has(c) || !canSeeBrand(req.account, brands.get(c)));
    if (!bad.length) return false;
    fail(res, 403, `แก้ได้เฉพาะสินค้าของแบรนด์ที่คุณมีสิทธิ์ (${bad.join(', ')})`);
    return true;
}

// GET /api/catalog — ส่วนต่างทั้งหมด { ready, products, targets }
router.get('/', async (req, res, next) => {
    try { await sendOverlay(res); } catch (err) { handle(err, res, next); }
});

// POST /api/catalog/products — เพิ่มสินค้าใหม่ { code, name, brand, targets?: [ชื่อ Target], items?: [รหัสสินค้าในเซ็ต] }
router.post('/products', requireCatalogEditor, async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(b.code); if (code.error) return fail(res, 400, code.error);
        const name = textOf(b.name, 'ชื่อสินค้า', 200); if (name.error) return fail(res, 400, name.error);
        const brand = textOf(b.brand, 'แบรนด์', 100); if (brand.error) return fail(res, 400, brand.error);
        if (!canSeeBrand(req.account, brand.value)) return fail(res, 403, `เพิ่มสินค้าได้เฉพาะแบรนด์ที่คุณมีสิทธิ์ (${brand.value})`);
        const items = b.items === undefined || b.items === null ? { value: [] } : itemsOf(b.items, code.value);
        if (items.error) return fail(res, 400, items.error);
        // รหัสของสินค้าตั้งต้น / ชนกลุ่มสีของแบรนด์อื่น = ไม่รับ (ทุกคน) · ตรวจไม่ได้: admin ผ่านแบบเดิม · ทีม Ads = 503
        let clash = null;
        let overlay = null;
        try {
            overlay = await store.catalog.overlay();
            clash = await catalogBrands.newProductProblem(code.value, brand.value, overlay.products);
        } catch { if (!seesAllBrands(req.account)) return fail(res, 503, 'ตรวจรหัสสินค้าไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง'); }
        if (clash) return fail(res, 409, clash);
        // สินค้าในเซ็ต + สินค้าใหม่ต้องไม่ไปเข้ากลุ่มสีเดียวกับเซ็ตที่มีอยู่ — ตรวจตอนนี้ (ข้อความชัด) แล้วตรวจซ้ำใต้ล็อกตอนบันทึก (verifyAdd)
        // ตรวจเซ็ตไม่ได้ = ไม่ปล่อยผ่าน (ทุกคน · เซ็ตผิดทำให้ช่อง PRODUCTS / ฟีดยิงแอดส่งรหัสผิด) · สินค้าธรรมดา อ่านคลังพลาดตรงนี้ไม่ขวาง (ตรวจซ้ำตอนบันทึกอยู่แล้ว)
        const verifyAdd = async rows => (items.value.length ? await setProblem(code.value, brand.value, items.value, rows) : null)
            || await siblingOfSetProblem(code.value, brand.value, rows);
        {
            let problem = null;
            try {
                if (!overlay) overlay = await store.catalog.overlay();
                problem = await verifyAdd(overlay.products);
            } catch { if (items.value.length) return fail(res, 503, SET_CHECK_DOWN.message); }
            if (problem) return fail(res, problem.status, problem.message);
        }
        const targets = [];
        for (const t of Array.isArray(b.targets) ? b.targets : []) {
            const r = targetOf(t); if (r.error) return fail(res, 400, r.error);
            if (!targets.some(x => x.toLowerCase() === r.value.toLowerCase())) targets.push(r.value);
        }
        if (await store.catalog.findProduct(code.value)) return fail(res, 409, `มีสินค้ารหัส ${code.value} อยู่แล้ว`);
        // สินค้า + Target (+ สินค้าในเซ็ต) บันทึกใน transaction เดียว — พลาดกลางทาง = ไม่มีอะไรค้าง (กดบันทึกใหม่ได้ ไม่ติด "มีอยู่แล้ว")
        await store.catalog.addProduct({ code: code.value, name: name.value, brand: brand.value, ...(items.value.length ? { items: items.value } : {}) }, by(req), targets,
            safeVerify(verifyAdd));
        await record(req, 'create', `เพิ่มสินค้า ${code.value} - ${name.value} (${brand.value})${targets.length ? ' · Target: ' + targets.join(', ') : ''}`
            + (items.value.length ? ' · สินค้าในเซ็ต: ' + items.value.join(', ') : ''));
        await sendOverlay(res, 201);
    } catch (err) {
        if (err && err.code === '23505') return fail(res, 409, 'มีสินค้ารหัสนี้อยู่แล้ว');
        handle(err, res, next);
    }
});

// PATCH /api/catalog/products/:code — ซ่อน / เอากลับ { hidden } · แก้ชื่อสินค้าที่เพิ่มเอง { name } · สินค้าในเซ็ต { items: [...] } (11 พ.ย. 2026)
// สินค้าตั้งต้นที่ยังไม่มีแถว ต้องส่ง name + brand มาด้วย (เก็บไว้เป็นข้อมูลอ้างอิง — หน้าเว็บยึดชื่อตามโค้ด)
router.patch('/products/:code', requireCatalogEditor, async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(req.params.code); if (code.error) return fail(res, 400, code.error);
        if (await denyOtherBrands(req, res, [code.value])) return;
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
        if (b.items !== undefined) {
            // สินค้าในเซ็ต { items: [รหัส] } · [] = ไม่เป็นเซ็ตแล้ว — เฉพาะสินค้าที่ Admin เพิ่มเอง (สินค้าตั้งต้นเป็นสินค้าเดี่ยวตามโค้ด)
            const items = itemsOf(b.items, code.value); if (items.error) return fail(res, 400, items.error);
            let builtin;
            try { builtin = await catalogBrands.builtinBrands(); }
            catch { return fail(res, 503, 'ตรวจสินค้าในเซ็ตไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง'); }
            if (builtin.has(code.value)) return fail(res, 400, `${code.value} เป็นสินค้าตั้งต้น — ตั้งสินค้าในเซ็ตได้เฉพาะสินค้าที่เพิ่มในหน้านี้`);
            if (!cur) return fail(res, 404, `ไม่มีสินค้า ${code.value} ในคลัง`);
            let problem;
            try { problem = await setProblem(code.value, cur.brand, items.value, (await store.catalog.overlay()).products); }
            catch { return fail(res, 503, 'ตรวจสินค้าในเซ็ตไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง'); }
            if (problem) return fail(res, problem.status, problem.message);
            const before = setItemsOf(cur);
            // ตรวจซ้ำใต้ล็อกในธุรกรรมเดียวกับที่เขียน — สองคนบันทึกเซ็ตพร้อมกันต้องไม่ได้เซ็ตซ้อนเซ็ต
            const row = await store.catalog.setSetItems(code.value, items.value, by(req),
                safeVerify(rows => setProblem(code.value, cur.brand, items.value, rows)));
            if (!row) return fail(res, 404, `ไม่มีสินค้า ${code.value} ในคลัง`);
            await record(req, 'update', items.value.length
                ? `ตั้งสินค้าในเซ็ต ${code.value}: ${items.value.join(', ')}${before.length ? ` (เดิม ${before.join(', ')})` : ''}`
                : `${code.value} ไม่เป็นเซ็ตแล้ว${before.length ? ` (เดิม ${before.join(', ')})` : ''}`);
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
router.post('/targets', requireCatalogEditor, async (req, res, next) => {
    try {
        const b = req.body || {};
        const target = targetOf(b.target); if (target.error) return fail(res, 400, target.error);
        const codes = codesOf(b.codes); if (codes.error) return fail(res, 400, codes.error);
        if (await denyOtherBrands(req, res, codes.value)) return;
        await store.catalog.setTargets(codes.value, target.value, false, by(req));
        await record(req, 'create', `เพิ่ม Target ${target.value} ให้ ${codes.value.join(', ')}`);
        await sendOverlay(res, 201);
    } catch (err) { handle(err, res, next); }
});

// PATCH /api/catalog/targets — ซ่อน / เอากลับ Target ของสินค้า { code, target, hidden }
router.patch('/targets', requireCatalogEditor, async (req, res, next) => {
    try {
        const b = req.body || {};
        const code = codeOf(b.code); if (code.error) return fail(res, 400, code.error);
        const target = targetOf(b.target); if (target.error) return fail(res, 400, target.error);
        if (typeof b.hidden !== 'boolean') return fail(res, 400, 'hidden ต้องเป็น true / false');
        if (await denyOtherBrands(req, res, [code.value])) return;
        await store.catalog.setTargets([code.value], target.value, b.hidden, by(req));
        await record(req, 'update', `${b.hidden ? 'ซ่อน' : 'เอากลับ'} Target ${target.value} ของ ${code.value}`);
        await sendOverlay(res);
    } catch (err) { handle(err, res, next); }
});

// GET /api/catalog/targets/usage?target=&codes=L3,L10 — แคมเปญที่ใช้ Target นี้กับสินค้าที่เลือก (หน้าต่างแก้ไข Target บอกก่อนบันทึก)
router.get('/targets/usage', requireCatalogEditor, async (req, res, next) => {
    try {
        const target = targetOf(req.query.target); if (target.error) return fail(res, 400, target.error);
        const codes = codesOf(String(req.query.codes || '').split(',').filter(Boolean)); if (codes.error) return fail(res, 400, codes.error);
        if (await denyOtherBrands(req, res, codes.value)) return;
        const { campaigns, bundled } = await store.catalog.targetUsage(codes.value, target.value, scopeOf(req));
        res.json({ status: 'success', data: { count: campaigns.length, campaigns, bundled } });
    } catch (err) { handle(err, res, next); }
});

// POST /api/catalog/targets/rename — แก้ชื่อ Target ของสินค้าที่เลือก { from, to, codes: [...] } (21 ต.ค. 2026)
// แคมเปญเดิมที่ใช้ชื่อเดิมกับสินค้านั้นเปลี่ยนตามด้วย (ผู้ใช้เลือก "เปลี่ยนตามด้วย") — ทำใน transaction เดียวกับคลัง
router.post('/targets/rename', requireCatalogEditor, async (req, res, next) => {
    try {
        const b = req.body || {};
        const from = targetOf(b.from); if (from.error) return fail(res, 400, 'ชื่อเดิม: ' + from.error);
        const to = targetOf(b.to); if (to.error) return fail(res, 400, to.error);
        if (from.value === to.value) return fail(res, 400, 'ชื่อใหม่เหมือนชื่อเดิม');
        const codes = codesOf(b.codes); if (codes.error) return fail(res, 400, codes.error);
        if (await denyOtherBrands(req, res, codes.value)) return;
        // keep (ไม่บังคับ) = รหัสในคลังที่ยังใช้ชื่อเดิม · ไม่ส่ง = ถือว่าสินค้าที่ไม่ได้เลือกยังใช้ชื่อเดิมทุกตัว (ปลอดภัยไว้ก่อน)
        const keep = Array.isArray(b.keep) ? b.keep.slice(0, 5000).map(codeOf).filter(r => !r.error).map(r => r.value) : undefined;
        const { campaigns } = await store.catalog.renameTarget(codes.value, from.value, to.value, { ...by(req), keep, scopeBrands: scopeOf(req) });
        await record(req, 'update', `แก้ชื่อ Target ${from.value} → ${to.value} ของ ${codes.value.join(', ')}`
            + (campaigns.length ? ` · เปลี่ยนในแคมเปญเดิม ${campaigns.length} แคมเปญ` : ''));
        // ประวัติของแต่ละแคมเปญที่โดน — ดูย้อนหลังได้ว่าชื่อ Target เปลี่ยนเพราะอะไร
        for (const c of campaigns) {
            try {
                await store.activity.log({
                    user_id: req.user.id, team_id: c.team_id ?? req.user.team_id, action: 'update',
                    project_id: c.id, project_name: c.name,
                    summary: `แก้ชื่อ Target ${from.value} → ${to.value} (${codes.value.join(', ')}) จากหน้า Products & Targets`
                });
            } catch { /* บันทึกประวัติพลาดไม่ขวางงานหลัก */ }
        }
        res.json({ status: 'success', data: await store.catalog.overlay(),
            campaigns: campaigns.map(c => ({ id: c.id, name: c.name, brand: c.brand })) });
    } catch (err) { handle(err, res, next); }
});

module.exports = router;
