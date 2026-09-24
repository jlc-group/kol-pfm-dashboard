// ตัวกรองรายชื่อตามกลุ่มสินค้า (แท็บรายชื่อ KOL ฝั่งทีม) — เลือกได้ทีละกลุ่ม
// กลุ่มของแคมเปญอยู่ใน project.ad_groups · รายชื่อชี้กลุ่มด้วย submission.group_key

// ตัวเลือกพิเศษ: คนที่ไม่ได้อยู่กลุ่มไหน (group_key ว่าง หรือชี้กลุ่มที่ถูกลบไปแล้ว)
export const NO_GROUP = '__none';

// คีย์ของกลุ่มที่ยังมีอยู่จริงในแคมเปญ
export const groupKeySet = groups => new Set((groups || []).map(g => g && g.key).filter(Boolean));

// อยู่นอกทุกกลุ่มไหม
export const isUngrouped = (s, keys) => !s || !s.group_key || !keys.has(s.group_key);

// ผ่านตัวกรองไหม — ไม่ได้เลือก ('all') = ผ่านทุกแถว
export function matchGroup(s, selected, keys) {
    if (!selected || selected === 'all') return true;
    return selected === NO_GROUP ? isUngrouped(s, keys) : !!s && s.group_key === selected;
}

// ปุ่มของกลุ่มที่เลือกไว้ไม่มีให้กดแล้ว → ถอยกลับเป็น 'all' เอง
// เกิดได้ 3 ทาง: กลุ่มถูกลบ · คนตกกลุ่มคนสุดท้ายหายไป (ชิป "ไม่ระบุกลุ่ม" จึงหาย) · เหลือกลุ่มเดียวจนแถบไม่ขึ้น
// ต้องตัดสินจากตัวเลือกที่มีอยู่จริง ไม่ใช่จากรายชื่อกลุ่ม ไม่งั้นตัวกรองจะทำงานค้างเงียบ ๆ
// โดยไม่มีชิปไหนติดให้กดคืน และรายชื่อว่างทั้งแท็บ
export function normalizeGroupSel(selected, opts) {
    const list = opts || [];
    if (list.length < 2) return 'all';
    return list.some(o => o.key === selected) ? selected : 'all';
}

// ตัวเลือกของแถบชิป — ทุกกลุ่มในแคมเปญตามลำดับ รวมกลุ่มที่ยังไม่มีรายชื่อ
// (ต่างจากแท็บ On Process ที่โชว์เฉพาะกลุ่มที่มีคนอยู่จริง เพราะแท็บนี้การ์ดกลุ่มขึ้นเสมอ ชิปจึงต้องมีครบทุกการ์ด)
// count(list) กำหนดเองได้ (นับคน / นับคลิป) · "ไม่ระบุกลุ่ม" ต่อท้ายเฉพาะตอนมีคนตกกลุ่มจริง
export function groupFilterOptions(groups, subs, count = list => list.length) {
    const list = subs || [];
    const gs = groups || [];
    // ข้อมูลเก่าที่กลุ่มไม่มี key แยกกันไม่ได้ (จะไปปนกับคนที่ไม่ระบุกลุ่ม) — ไม่ให้ตัวเลือกเลย ดีกว่ากรองผิด
    if (!gs.length || !gs.every(g => g && g.key)) return [];
    const keys = groupKeySet(gs);
    const opts = gs.map((g, gi) => ({
        key: g.key,
        no: gi + 1,
        concept: g.concept || '',
        products: Array.isArray(g.products) ? g.products : [],
        count: count(list.filter(s => s.group_key === g.key))
    }));
    const none = list.filter(s => isUngrouped(s, keys));
    if (none.length) opts.push({ key: NO_GROUP, no: 0, concept: '', products: [], count: count(none) });
    return opts;
}
