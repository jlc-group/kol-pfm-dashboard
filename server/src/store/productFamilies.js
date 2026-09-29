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

// แยกช่องสินค้า ("BTA1-03,BTA1-04" หรือ array) เป็นรายการ — คั่นด้วย , หรือ ， (จุลภาคเต็มความกว้าง แบบเดียวกับ productCodesIn)
// ตัดช่องว่าง ทิ้งช่องว่างเปล่า
function splitProductList(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/);
    return list.map(s => String(s ?? '').trim()).filter(Boolean);
}

// หน้าตารหัสสินค้า (BTA4-01, L8A, L10, JNP1, C1 ...) — ใช้แยกรายการที่พิมพ์รหัสหลายตัวคั่นด้วยช่องว่าง/ขึ้นบรรทัด
const CODE_SHAPE = /^[A-Z]{1,4}\d+[A-Z]?(?:-\d+)?$/;

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
function expandProductFamilies(value) {
    const out = [];
    const seen = new Set();
    const add = v => { if (!seen.has(v)) { seen.add(v); out.push(v); } };
    for (const part of productParts(value)) {
        const fam = FAMILY_OF.get(productCodeOf(part));
        if (fam) fam.forEach(add); else add(part);
    }
    return out;
}

module.exports = { PRODUCT_FAMILIES, splitProductList, productParts, productCodeOf, expandProductFamilies };
