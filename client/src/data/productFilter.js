// ตัวกรองรายชื่อตามสินค้า (แท็บรายชื่อ KOL / On Process ทั้งฝั่งทีมและเอเจนซี่) — เลือกได้หลายสินค้า
// ช่องสินค้าของรายชื่อ (submission.product) เป็นสตริงคั่นคอมมา เช่น "L3,L4" หรือ "L3 - ดีดีครีม, L4"
import { productCodesIn } from './adGroups.js';

// ตัวเลือกพิเศษ: รายชื่อที่ไม่ได้ใส่สินค้าเลย
export const NO_PRODUCT = '__none';

// รหัสตัวแรกของแต่ละรายการในช่องสินค้า ("L3 - ดีดีครีม" → "L3")
const tokenCodes = v => String(v == null ? '' : v).split(/[,，]/)
    .map(t => t.trim().split(/\s+/)[0]).filter(Boolean);

// รหัสสินค้าที่รู้จัก: สินค้าของทุกกลุ่มตามลำดับในแคมเปญ + รหัสที่พบในช่องสินค้าของรายชื่อ (กันสินค้านอกกลุ่มหลุดตัวกรอง)
export function knownProductCodes(groups, subs) {
    const out = [];
    const add = c => { if (c && !out.includes(c)) out.push(c); };
    (groups || []).forEach(g => {
        (g.blocks || []).forEach(b => (b.products || []).forEach(add));
        (g.products || []).forEach(add);
    });
    (subs || []).forEach(s => tokenCodes(s && s.product).forEach(add));
    return out;
}

// สินค้าของรายชื่อแถวหนึ่ง (เทียบเต็มรหัส "L1" ไม่จับ "L10")
export const subProductCodes = (s, known) => productCodesIn(s && s.product, known);

// ผ่านตัวกรองไหม: ไม่ได้เลือก = ผ่านทุกแถว · มีสินค้าใดสินค้าหนึ่งที่เลือก = ผ่าน · ไม่มีสินค้าเลย = ผ่านเมื่อเลือก "ไม่ระบุสินค้า"
export function matchProducts(s, selected, known) {
    if (!selected || !selected.length) return true;
    const codes = subProductCodes(s, known);
    return codes.length ? codes.some(c => selected.includes(c)) : selected.includes(NO_PRODUCT);
}

// ตัวเลือกของตัวกรอง: เฉพาะสินค้าที่มีในรายชื่อจริง พร้อมจำนวน — count(list) กำหนดเองได้ (นับคน / นับคลิป)
export function productFilterOptions(subs, known, count = list => list.length) {
    const list = subs || [];
    const opts = known
        .map(code => ({ code, count: count(list.filter(s => subProductCodes(s, known).includes(code))) }))
        .filter(o => o.count > 0);
    const none = list.filter(s => subProductCodes(s, known).length === 0);
    if (none.length) opts.push({ code: NO_PRODUCT, count: count(none) });
    return opts;
}
