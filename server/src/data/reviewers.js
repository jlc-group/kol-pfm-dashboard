// คนตรวจคลิป + งานของคนตรวจ (ผู้ใช้สั่ง 27 ต.ค. 2026 — หน้า "งานของฉัน")
// ต้องตรงกับ client/src/data/reviewers.js ทุกเงื่อนไข (tests/reviewers.test.cjs เทียบให้)
//
// คนตรวจตั้งได้ 3 ชั้น ชั้นล่างทับชั้นบน: ทั้งแคมเปญ (projects.review_assign.default) → รายกลุ่ม (review_assign.groups[group_key])
// → รายคลิป (submissions.reviewer_id) · ไม่ตั้งเลย = "ยังไม่มีคนตรวจ" (ผู้ใช้เลือกไม่ใส่ให้เองตอนสร้างแคมเปญ)

const idOf = v => {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// review_assign จากฐาน (JSONB) → { default, groups } ที่ใช้ได้แน่นอน · ค่าเพี้ยน = ทิ้ง
function normalizeAssign(raw) {
    const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const groups = {};
    if (a.groups && typeof a.groups === 'object' && !Array.isArray(a.groups)) {
        Object.entries(a.groups).forEach(([k, v]) => { const id = idOf(v); if (k && id) groups[k] = id; });
    }
    return { default: idOf(a.default), groups };
}

// คนตรวจของคลิป → { id, from } · from = 'clip' | 'group' | 'campaign' | null (ยังไม่มีคนตรวจ)
// groupKeys = กลุ่มที่ยังมีอยู่ในแคมเปญ — กลุ่มที่ถูกลบไปแล้วไม่นับ (ตกไปใช้ของทั้งแคมเปญ)
function reviewerOf(sub, assign, groupKeys) {
    const a = normalizeAssign(assign);
    const own = idOf(sub && sub.reviewer_id);
    if (own) return { id: own, from: 'clip' };
    const gk = sub && sub.group_key;
    if (gk && a.groups[gk] && (!groupKeys || groupKeys.has(gk))) return { id: a.groups[gk], from: 'group' };
    if (a.default) return { id: a.default, from: 'campaign' };
    return { id: null, from: null };
}

const filled = v => !!(v !== null && v !== undefined && String(v).trim());
const DRAFT_LINKS = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5'];

// งานของคลิปในมุมคนตรวจ (ตรวจดราฟอย่างเดียว · ผู้ใช้เลือก 27 ต.ค.)
// review = เอเจนซี่ส่งดราฟแล้ว ยังไม่มีใครกด Approve / ขอแก้ไข (รอคนตรวจ) · revise = ขอแก้ไขแล้ว รอเอเจนซี่
// approved = Approve แล้ว รอลงงาน · posted = ลงงานแล้ว · todo = ยังไม่ส่งดราฟ
// ลำดับเดียวกับ workStage (client/src/data/workStage.js) แค่แยก "รอตรวจ" กับ "ขอแก้ไข" ออกจากกัน
function reviewBucket(sub) {
    if (!sub) return 'todo';
    if (filled(sub.post_url)) return 'posted';
    if (sub.draft_status === 'approve') return 'approved';
    if (!DRAFT_LINKS.some(k => filled(sub[k]))) return 'todo';
    return sub.draft_status === 'revise' ? 'revise' : 'review';
}

// ดราฟล่าสุดเป็นดราฟที่เท่าไหร่ (1-5) · ยังไม่มี = 0
function latestDraftNo(sub) {
    let n = 0;
    DRAFT_LINKS.forEach((k, i) => { if (sub && filled(sub[k])) n = i + 1; });
    return n;
}

module.exports = { idOf, normalizeAssign, reviewerOf, reviewBucket, latestDraftNo, DRAFT_LINKS };
