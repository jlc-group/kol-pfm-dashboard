/**
 * แบรนด์ของรหัสสินค้า — ฝั่ง server ใช้ตรวจว่าทีม Ads แก้หน้า Products & Targets ได้เฉพาะสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ (21 ต.ค. 2026)
 * สินค้าตั้งต้นอยู่ในโค้ดหน้าเว็บ client/src/data/products.js (ไฟล์ข้อมูลล้วน ไม่มี import) — อ่านไฟล์เดียวกันจึงไม่เพี้ยนกันสองฝั่ง
 * สินค้าที่เพิ่มเองอยู่ในฐาน (catalog_products) · สินค้าตั้งต้นยึดแบรนด์ตามโค้ดเสมอ (แถวในฐานของสินค้าตั้งต้นเป็นแค่ธงซ่อน)
 * โหลดคลังตั้งต้นไม่ได้ = โยน error — route ตอบ 503 ให้คนที่ไม่ใช่ admin (ไม่เดาแบรนด์ ไม่ปล่อยผ่าน)
 */
const path = require('path');
const { pathToFileURL } = require('url');

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

module.exports = { brandsOf, builtinBrands };
