/**
 * แก้ชื่อ Target ในแคมเปญที่บันทึกไว้แล้ว (หน้า Products & Targets → ปุ่มแก้ไข Target · ผู้ใช้สั่ง 21 ต.ค. 2026 "เปลี่ยนตามด้วย")
 * ตรรกะล้วน (ไม่มีฐานข้อมูล) — store/pg/catalog.js renameTarget เรียกใช้ใน transaction เดียวกับการแก้คลัง
 *
 * ชื่อ Target ในแคมเปญอยู่ 3 ชั้น (ad_groups ของ projects — แคมเปญปกติและ KOL รายคน):
 *   1. blocks[].product_targets { รหัสสินค้า: [Target] }  — Target ต่อสินค้าใน Platform นั้น (หน้า Ads / ฟีด อ่านตัวนี้ก่อน)
 *   2. blocks[].target [Target]                         — รวมทั้ง Platform (ข้อมูลก่อนแยกต่อสินค้า / ฟอร์ม KOL รายคน อ่านตัวนี้)
 *   3. groups[].target [Target]                         — ระดับกลุ่มแบบเดิม (ตัวอ่านเก่า)
 * กติกา:
 *   • แก้เฉพาะสินค้าที่เลือก (codes) — สินค้าอื่นที่ยังใช้ชื่อเดิมไม่โดน
 *   • ชุดสินค้า (blocks[].bundles — KOL 1 คนรีวิวรวมในคลิปเดียว Target ต้องเท่ากันทั้งชุด): สินค้าในชุดโดนเลือก 1 ตัว = แก้ทั้งชุด
 *     (ไม่งั้นชุดแตกเป็น 2 ชื่อ) · รหัสที่โดนเพราะอยู่ในชุดคืนใน bundled ให้หน้าต่างแก้ไขบอกก่อนบันทึก
 *   • ชั้นรวม (2, 3) เปลี่ยนชื่อเดิมเป็นชื่อใหม่เมื่อไม่มีสินค้าไหนในชั้นนั้นใช้ชื่อเดิมแล้ว · ยังมีคนใช้ = คงชื่อเดิมไว้แล้วเติมชื่อใหม่ต่อท้าย
 *   • บล็อก/กลุ่มแบบเก่าที่ไม่มี product_targets (Target ก้อนเดียวใช้กับทุกสินค้า — ฟอร์มแบ่งให้สินค้าตามคลังตอนเปิด):
 *     เปลี่ยนทั้งก้อนเมื่อสินค้าในก้อนที่ยังใช้ชื่อเดิมโดนเลือกครบ · ไม่ครบ = คงชื่อเดิม + เติมชื่อใหม่ (สินค้าที่ไม่ได้เลือกไม่เสีย Target)
 *     keep = รหัสในคลังที่ยังมีชื่อเดิมหลังแก้ (หน้าเว็บส่งมา) · ไม่ส่ง = ถือว่าสินค้าที่ไม่ได้เลือกทุกตัวยังใช้ชื่อเดิม (ปลอดภัยไว้ก่อน)
 *   • เทียบชื่อแบบตัดช่องว่างหัวท้าย ตรงทุกตัวอักษร · ชื่อใหม่มีในรายการอยู่แล้ว (ไม่สนตัวพิมพ์) = ใช้ตัวสะกดที่มีอยู่ รวมเป็นอันเดียว
 *   • ไม่แตะช่องอื่นของแคมเปญเลย · ไม่มีอะไรเปลี่ยน = changed false (ไม่ต้องเขียนแคมเปญนั้น)
 */
const norm = v => (typeof v === 'string' ? v.trim() : '');
const key = v => norm(v).toLowerCase();
const up = c => String(c).trim().toUpperCase();
const isArr = Array.isArray;
const isMap = v => !!v && typeof v === 'object' && !isArr(v);

// รายการ (array หรือสตริงเดี่ยวแบบข้อมูลเก่า) มีชื่อนี้ไหม
function listHas(list, name) {
    if (isArr(list)) return list.some(x => norm(x) === name);
    return norm(list) === name;
}
// เปลี่ยน from → to ในรายการ (คงลำดับ · ไม่ให้ซ้ำ) — สตริงเดี่ยวคืนเป็นสตริง
// รายการมีชื่อใหม่อยู่แล้วแต่ตัวพิมพ์ต่างกัน = ใช้ตัวสะกดที่มีอยู่ (ไม่ให้มีทั้ง ABC และ abc)
function swap(list, from, to) {
    if (!isArr(list)) return norm(list) === from ? to : list;
    const existing = list.find(x => norm(x) !== from && key(x) === key(to));
    const out = [];
    for (const x of list) {
        const v = norm(x) === from ? (existing ?? to) : x;
        if (!out.some(y => norm(y) === norm(v))) out.push(v);
    }
    return out;
}
// ชั้นรวม: ไม่มีใครใช้ชื่อเดิมแล้ว = เปลี่ยนเป็นชื่อใหม่ · ยังมี = คงไว้ · ทั้งสองแบบต้องมีชื่อใหม่อยู่ในรายการรวม
function swapUnion(list, from, to, stillOld) {
    if (!isArr(list)) {
        if (norm(list) !== from) return list;
        return stillOld ? [list, to] : to;
    }
    const out = stillOld ? [...list] : swap(list, from, to);
    const present = out.some(x => norm(x) === to || (norm(x) !== from && key(x) === key(to)));
    return present ? out : [...out, to];
}
// ชุดสินค้าของบล็อก — เฉพาะรหัสที่อยู่ในบล็อก · ชุดละอย่างน้อย 2 รหัส (กติกาเดียวกับ blockBundles ใน store/logic.js)
function bundlesOf(b) {
    const list = (isArr(b.products) ? b.products : []).map(up);
    const used = new Set();
    const out = [];
    (isArr(b.bundles) ? b.bundles : []).forEach(raw => {
        if (!isArr(raw)) return;
        const codes = [];
        raw.map(up).forEach(c => { if (list.includes(c) && !used.has(c) && !codes.includes(c)) codes.push(c); });
        if (codes.length < 2) return;
        codes.forEach(c => used.add(c));
        out.push(codes);
    });
    return out;
}

function renameTargetInGroups(groups, codes, fromRaw, toRaw, { keep } = {}) {
    const from = norm(fromRaw), to = norm(toRaw);
    const pick = new Set((codes || []).map(up));
    const none = { groups, changed: false, places: 0, bundled: [] };
    if (!isArr(groups) || !from || !to || from === to || !pick.size) return none;
    const keepSet = isArr(keep) ? new Set(keep.map(up)) : null;
    const bundled = new Set();
    let places = 0;
    // ก้อน Target แบบเก่า (ใช้กับทุกสินค้าในก้อน): ไม่เกี่ยวกับสินค้าที่เลือก = null · ครบ = เปลี่ยนทั้งก้อน · ไม่ครบ = คงชื่อเดิม + เติมชื่อใหม่
    function legacy(list, products, picked) {
        const ps = (isArr(products) ? products : []).map(up);
        if (!listHas(list, from) || !ps.some(c => picked.has(c))) return null;
        const stillUsed = ps.some(c => !picked.has(c) && (keepSet ? keepSet.has(c) : true));
        return stillUsed ? swapUnion(list, from, to, true) : swap(list, from, to);
    }
    const out = groups.map(g0 => {
        if (!isMap(g0)) return g0;
        const g = { ...g0 };
        let groupTouched = false;
        if (isArr(g.blocks)) {
            g.blocks = g.blocks.map(b0 => {
                if (!isMap(b0)) return b0;
                const b = { ...b0 };
                // สินค้าที่เลือก + เพื่อนร่วมชุด (ชุดต้องใช้ Target เดียวกันทั้งชุด)
                const picked = new Set(pick);
                bundlesOf(b).forEach(bd => { if (bd.some(c => pick.has(c))) bd.forEach(c => picked.add(c)); });
                let touched = false;
                if (isMap(b.product_targets)) {
                    const pt = { ...b.product_targets };
                    for (const code of Object.keys(pt)) {
                        if (!picked.has(up(code)) || !listHas(pt[code], from)) continue;
                        pt[code] = swap(pt[code], from, to);
                        if (!pick.has(up(code))) bundled.add(up(code));
                        touched = true; places++;
                    }
                    if (touched) {
                        b.product_targets = pt;
                        const stillOld = Object.values(pt).some(l => listHas(l, from));
                        if (isArr(b.target) || listHas(b.target, from)) b.target = swapUnion(b.target, from, to, stillOld);
                    }
                } else {
                    // บล็อกแบบเก่า: ไม่มีรายการสินค้าในบล็อก = ใช้ของกลุ่ม (ฟอร์มยกของกลุ่มลงมาให้แบบเดียวกัน)
                    const products = isArr(b.products) && b.products.length ? b.products : g.products;
                    const next = legacy(b.target, products, picked);
                    if (next !== null) { b.target = next; touched = true; places++; }
                }
                if (touched) groupTouched = true;
                return touched ? b : b0;
            });
        }
        // ชั้นกลุ่ม (ตัวอ่านเก่า)
        if (listHas(g.target, from)) {
            const hasBlocks = isArr(g.blocks) && g.blocks.length > 0;
            if (hasBlocks) {
                if (groupTouched) {
                    const stillOld = g.blocks.some(b => isMap(b) && (listHas(b.target, from)
                        || (isMap(b.product_targets) && Object.values(b.product_targets).some(l => listHas(l, from)))));
                    g.target = swapUnion(g.target, from, to, stillOld);
                }
            } else {
                const next = legacy(g.target, g.products, pick);
                if (next !== null) { g.target = next; groupTouched = true; places++; }
            }
        }
        return groupTouched ? g : g0;
    });
    if (!places) return none;
    return { groups: out, changed: true, places, bundled: [...bundled] };
}

// ใช้ตอนนับก่อนบันทึก (กติกาเดียวกับตอนแก้จริง) — แคมเปญนี้โดนไหม + รหัสที่โดนเพราะอยู่ในชุดเดียวกับสินค้าที่เลือก
const PROBE = '\u0000__probe__';
function previewRename(groups, codes, from) {
    const r = renameTargetInGroups(groups, codes, from, PROBE);
    return { changed: r.changed, bundled: r.bundled };
}
const usesTarget = (groups, codes, from) => previewRename(groups, codes, from).changed;

module.exports = { renameTargetInGroups, previewRename, usesTarget };
