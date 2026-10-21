/**
 * แบรนด์ของรหัสสินค้า — ฝั่ง server ใช้ตรวจว่าทีม Ads แก้หน้า Products & Targets ได้เฉพาะสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ (21 ต.ค. 2026)
 * สินค้าตั้งต้นอยู่ในโค้ดหน้าเว็บ client/src/data/products.js (ไฟล์ข้อมูลล้วน ไม่มี import) — อ่านไฟล์เดียวกันจึงไม่เพี้ยนกันสองฝั่ง
 * สินค้าที่เพิ่มเองอยู่ในฐาน (catalog_products) · สินค้าตั้งต้นยึดแบรนด์ตามโค้ดเสมอ (แถวในฐานของสินค้าตั้งต้นเป็นแค่ธงซ่อน)
 * โหลดคลังตั้งต้นไม่ได้ = โยน error — route ตอบ 503 ให้คนที่ไม่ใช่ admin (ไม่เดาแบรนด์ ไม่ปล่อยผ่าน)
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { PRODUCT_FAMILIES, FAMILY_RULES } = require('./productFamilies');

const WEB_PRODUCTS = path.join(__dirname, '../../../client/src/data/products.js');
let builtin = null;   // Promise<Map รหัส → แบรนด์>

function builtinBrands() {
    if (!builtin) {
        builtin = import(pathToFileURL(WEB_PRODUCTS).href).then(m => {
            const list = Array.isArray(m.DEFAULT_PRODUCTS) ? m.DEFAULT_PRODUCTS : [];
            if (!list.length) throw new Error('คลังสินค้าตั้งต้นว่าง');
            return new Map(list.map(p => [String(p.code).toUpperCase(), p.brand]));
        });
        builtin.catch(() => { builtin = null; });   // พลาดแล้วครั้งหน้าลองโหลดใหม่
    }
    return builtin;
}

// codes → Map รหัส → แบรนด์ (รหัสที่ไม่มีในคลังเลยไม่อยู่ใน Map) · added = แถว catalog_products [{ code, brand }]
async function brandsOf(codes, added) {
    const base = await builtinBrands();
    const extra = new Map((Array.isArray(added) ? added : []).filter(p => p && p.code).map(p => [String(p.code).toUpperCase(), p.brand]));
    const out = new Map();
    for (const c of codes || []) {
        const code = String(c).toUpperCase();
        const brand = base.get(code) || extra.get(code);
        if (brand) out.set(code, brand);
    }
    return out;
}

// สินค้าใหม่ (POST /products) ใช้รหัสนี้ได้ไหม — คืนข้อความปัญหา หรือ null (รีวิว 21 ต.ค. 2026)
//   • รหัสของสินค้าตั้งต้น = ใช้ไม่ได้ (findProduct เห็นแค่แถวในฐาน — ไม่งั้นแบรนด์อื่นแอบเพิ่ม Target ให้สินค้าตั้งต้นของคนอื่นได้)
//   • รหัสที่จะไปเข้ากลุ่มสีของแบรนด์อื่น = ใช้ไม่ได้ — กลุ่มสี (familyMapWith / หน้าเว็บ familiesOf) จัดด้วย key ไม่ดูแบรนด์
//     เช่น BTA4X ของ Jula's Herb → key BTA4 = กลุ่มคุชชั่น Beauterry · L8-1 ของ Beauterry → key L8 = อีอีคูชั่น Jula's Herb
// added = แถว catalog_products [{ code, brand }] · โหลดคลังตั้งต้นไม่ได้ = โยน error
async function newProductProblem(codeRaw, brand, added) {
    const code = String(codeRaw).toUpperCase();
    const base = await builtinBrands();
    if (base.has(code)) return `รหัส ${code} เป็นสินค้าตั้งต้นของ ${base.get(code)} อยู่แล้ว`;
    const keyOf = (c, b) => { const rule = FAMILY_RULES[b]; return rule ? rule(c) : null; };
    const key = keyOf(code, brand);
    if (!key) return null;
    const owner = new Map();   // key ของกลุ่มสี → แบรนด์เจ้าของ (กติกาเดียวกับ familyMapWith)
    for (const codes of PRODUCT_FAMILIES) {
        const k = FAMILY_RULES.Beauterry(codes[0]) || FAMILY_RULES["Jula's Herb"](codes[0]);
        if (k) owner.set(k, base.get(codes[0]));
    }
    for (const p of Array.isArray(added) ? added : []) {
        const c = p && p.code ? String(p.code).toUpperCase() : '';
        if (!c || c === code || base.has(c)) continue;   // แถวของสินค้าตั้งต้นเป็นแค่ธงซ่อน
        const k = keyOf(c, p.brand);
        if (k && !owner.has(k)) owner.set(k, p.brand);
    }
    const other = owner.get(key);
    return other && other !== brand ? `รหัส ${code} จะไปเข้ากลุ่มสีเดียวกับสินค้าของ ${other} (${key}) — ใช้รหัสอื่น` : null;
}

module.exports = { brandsOf, builtinBrands, newProductProblem };
