// สินค้าที่มีหลายสี / หลายเบอร์ — ฟีด content-candidates ส่ง "ทุกสีของสินค้านั้น" ให้ระบบยิงแอดของ Beauterry
// (ระบบยิงแอดยิงทีเดียวครอบทุกสี · คลิปที่รีวิว BTA4-01 ต้องได้ BTA4-00 ถึง BTA4-07)
// สำเนาของกลุ่มที่หน้าเว็บคิดจากคลังสินค้า client/src/data/products.js — เพิ่มสีใหม่ต้องแก้ทั้งสองที่
// (tests/product-families.test.cjs เทียบสองฝั่งให้ ไม่ตรงกันเทสต์แดงทันที)
const PRODUCT_FAMILIES = [
    ['L8A', 'L8B'],                                                                           // Jula's Herb อีอีคูชั่นแตงโม
    ['T5A', 'T5B', 'T5C'],                                                                    // Jula's Herb ลิปเซรั่มแทททู
    ['BTA1-01', 'BTA1-02', 'BTA1-03', 'BTA1-04', 'BTA1-05', 'BTA1-06'],                      // Beauterry ลิป
    ['BTA2-01', 'BTA2-02', 'BTA2-03'],                                                        // Beauterry บลัช พาเลตต์
    ['BTA3-01', 'BTA3-02', 'BTA3-03'],                                                        // Beauterry อาย พาเลตต์
    ['BTA4-00', 'BTA4-01', 'BTA4-02', 'BTA4-03', 'BTA4-04', 'BTA4-05', 'BTA4-06', 'BTA4-07']  // Beauterry คุชชั่น
];
const FAMILY_OF = new Map(PRODUCT_FAMILIES.flatMap(codes => codes.map(c => [c, codes])));

// ===== สินค้าที่ Admin เพิ่มเองในหน้า Products & Targets (7 ต.ค. 2026 · ตาราง catalog_products) =====
// กติกาจัดกลุ่มเดียวกับหน้าเว็บ (client/src/data/products.js FAMILY_RULES): Beauterry ตัดเลขท้ายขีด (BTA4-08 → BTA4) · Jula's Herb ตัดตัวอักษรท้าย
// สีใหม่ที่ key ตรงกลุ่มเดิม (BTA4-08) ต่อท้ายกลุ่มนั้น · key ใหม่ (BTA5-01 + BTA5-02) เป็นกลุ่มใหม่ (ต้องมีอย่างน้อย 2 สี)
// ฝั่งนี้รู้แค่กลุ่มตั้งต้นด้านบน (ไม่รู้สินค้าตั้งต้นตัวเดี่ยวอย่าง L3) — ฟีด PFM ส่งเฉพาะ Beauterry ที่สินค้าตั้งต้นอยู่ในกลุ่มครบทุกตัวแล้ว
const FAMILY_RULES = {
    Beauterry: code => (code.match(/^(.+)-\d+$/) || [])[1] || null,
    "Jula's Herb": code => (code.match(/^([A-Z]+\d+)[A-Z]$/) || [])[1] || null
};
const keyOfDefault = code => FAMILY_RULES.Beauterry(code) || FAMILY_RULES["Jula's Herb"](code);
// extra = [{ code, brand }] เรียงตามรหัส (pg/catalog.js familyProducts) → Map รหัส → ทุกสีในกลุ่ม · ไม่มี extra = กลุ่มตั้งต้นเดิม
function familyMapWith(extra) {
    // เรียงรหัสแบบตัวเลขเอง (BTA4-08 ก่อน BTA4-10) — ลำดับสีต้องตรงกับหน้าเว็บ (products.js เรียงสินค้าที่เพิ่มแบบเดียวกัน)
    const list = (extra || []).filter(p => p && typeof p.code === 'string' && typeof p.brand === 'string')
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    if (!list.length) return FAMILY_OF;
    const byKey = new Map(PRODUCT_FAMILIES.map(codes => [keyOfDefault(codes[0]), [...codes]]));
    for (const p of list) {
        const rule = FAMILY_RULES[p.brand];
        const key = rule ? rule(p.code) : null;
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        const codes = byKey.get(key);
        if (!codes.includes(p.code)) codes.push(p.code);
    }
    const fams = [...byKey.values()].filter(codes => codes.length > 1);
    return new Map(fams.flatMap(codes => codes.map(c => [c, codes])));
}

// แยกช่องสินค้า ("BTA1-03,BTA1-04" หรือ array) เป็นรายการ — คั่นด้วย , หรือ ， (จุลภาคเต็มความกว้าง แบบเดียวกับ productCodesIn)
// ตัดช่องว่าง ทิ้งช่องว่างเปล่า
function splitProductList(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/);
    return list.map(s => String(s ?? '').trim()).filter(Boolean);
}

// หน้าตารหัสสินค้า (BTA4-01, L8A, L10, JNP1, C1, JNPSET1 ...) — ใช้แยกรายการที่พิมพ์รหัสหลายตัวคั่นด้วยช่องว่าง/ขึ้นบรรทัด
// ตัวอักษรนำหน้า 1-8 ตัว (8 ต.ค. 2026 ขยายจาก 1-4 ให้ใส่รหัสเซ็ตอย่าง JNPSET1 ได้ · ข้อมูลเดิมในฐานไม่มีแถวไหนแยกต่างจากเดิม)
// ต้องตรงกับ client/src/data/products.js และ client/src/pages/Catalog.jsx
const CODE_SHAPE = /^[A-Z]{1,8}\d+[A-Z]?(?:-\d+)?$/;

// รายการย่อย: รายการที่เป็นรหัสล้วนหลายตัว ("BTA4-01 BTA2-01") แยกเป็นทีละรหัส ไม่งั้นตัวหลังหาย
// รายการที่เป็นรหัส + ชื่อ ("BTA2-01 บิวเทอร์รี่ ...") หรือข้อความที่พิมพ์เอง ("Dermiq Serum Vit C") เก็บทั้งก้อน
function productParts(value) {
    return splitProductList(value).flatMap(entry => {
        const tokens = entry.split(/\s+/);
        return tokens.length > 1 && tokens.every(t => CODE_SHAPE.test(t.toUpperCase())) ? tokens : [entry];
    });
}

// รหัสของรายการ = คำแรก (บางแถวเก็บเป็น "BTA2-01 บิวเทอร์รี่ ...") · ไม่สนตัวพิมพ์
function productCodeOf(entry) {
    return String(entry ?? '').trim().split(/\s+/)[0].toUpperCase();
}

// กางทุกสีของสินค้าที่มีหลายสี · สินค้าอื่นคืนค่าเดิม · ไม่ซ้ำ เรียงตามที่เจอก่อน
// familyOf = กลุ่มที่รวมสินค้าที่ Admin เพิ่มแล้ว (familyMapWith) · ไม่ส่ง = กลุ่มตั้งต้น
function expandProductFamilies(value, familyOf = FAMILY_OF) {
    const out = [];
    const seen = new Set();
    const add = v => { if (!seen.has(v)) { seen.add(v); out.push(v); } };
    for (const part of productParts(value)) {
        const fam = familyOf.get(productCodeOf(part));
        if (fam) fam.forEach(add); else add(part);
    }
    return out;
}

module.exports = { PRODUCT_FAMILIES, FAMILY_RULES, CODE_SHAPE, splitProductList, productParts, productCodeOf, expandProductFamilies, familyMapWith };
