// คนตรวจคลิป + งานของคนตรวจ (ผู้ใช้สั่ง 27 ต.ค. 2026 — หน้า "งานของฉัน")
// ต้องตรงกับ server/src/data/reviewers.js ทุกเงื่อนไข (tests/reviewers.test.cjs เทียบให้)
//
// คนตรวจตั้งได้ 3 ชั้น ชั้นล่างทับชั้นบน: ทั้งแคมเปญ (projects.review_assign.default) → รายกลุ่ม (review_assign.groups[group_key])
// → รายคลิป (submissions.reviewer_id) · ไม่ตั้งเลย = "ยังไม่มีคนตรวจ"

export const idOf = v => {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export function normalizeAssign(raw) {
    const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const groups = {};
    if (a.groups && typeof a.groups === 'object' && !Array.isArray(a.groups)) {
        Object.entries(a.groups).forEach(([k, v]) => { const id = idOf(v); if (k && id) groups[k] = id; });
    }
    return { default: idOf(a.default), groups };
}

// คนตรวจของคลิป → { id, from } · from = 'clip' | 'group' | 'campaign' | null (ยังไม่มีคนตรวจ)
export function reviewerOf(sub, assign, groupKeys) {
    const a = normalizeAssign(assign);
    const own = idOf(sub && sub.reviewer_id);
    if (own) return { id: own, from: 'clip' };
    const gk = sub && sub.group_key;
    if (gk && a.groups[gk] && (!groupKeys || groupKeys.has(gk))) return { id: a.groups[gk], from: 'group' };
    if (a.default) return { id: a.default, from: 'campaign' };
    return { id: null, from: null };
}

const filled = v => !!(v !== null && v !== undefined && String(v).trim());
export const DRAFT_LINKS = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5'];

// งานของคลิปในมุมคนตรวจ: review (รอคนตรวจ) · revise (ขอแก้ไขแล้ว รอเอเจนซี่) · approved (รอลงงาน) · posted · todo (ยังไม่ส่งดราฟ)
export function reviewBucket(sub) {
    if (!sub) return 'todo';
    if (filled(sub.post_url)) return 'posted';
    if (sub.draft_status === 'approve') return 'approved';
    if (!DRAFT_LINKS.some(k => filled(sub[k]))) return 'todo';
    return sub.draft_status === 'revise' ? 'revise' : 'review';
}

export function latestDraftNo(sub) {
    let n = 0;
    DRAFT_LINKS.forEach((k, i) => { if (sub && filled(sub[k])) n = i + 1; });
    return n;
}

// การ์ดหน้า "งานของฉัน" (ตามลำดับ) · ลงงานแล้วนับเฉพาะ 7 วันล่าสุด (server ตัดให้)
export const WORK_BUCKETS = [
    { key: 'review', label: 'รอฉันตรวจ', hint: 'เอเจนซี่ส่งดราฟมาแล้ว ยังไม่มีใครกด Approve / ขอแก้ไข' },
    { key: 'revise', label: 'รอเอเจนซี่แก้', hint: 'ขอแก้ไขไปแล้ว รอดราฟใหม่' },
    { key: 'approved', label: 'Approve แล้ว รอลงงาน', hint: 'ดราฟผ่านแล้ว รอ KOL ลงโพสต์' },
    { key: 'posted', label: 'ลงงานแล้ว (7 วัน)', hint: 'ลงโพสต์แล้วใน 7 วันล่าสุด' }
];

// ที่มาของคนตรวจ (ป้ายในตาราง On Process)
export const FROM_LABEL = { clip: 'เฉพาะคลิปนี้', group: 'ตามกลุ่ม', campaign: 'ตามแคมเปญ' };

// รอมานานแค่ไหน (ป้ายหน้า "งานของฉัน") → { text, level } · level: '' < 1 วัน · 'warn' 1-2 วัน · 'bad' > 2 วัน
export function waitedText(iso, now = Date.now()) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return { text: '—', level: '' };
    const h = Math.max(0, Math.floor((now - t) / 3600000));
    if (h < 24) return { text: h < 1 ? 'ไม่ถึงชั่วโมง' : `${h} ชม.`, level: '' };
    const d = Math.floor(h / 24);
    return { text: `${d} วัน`, level: d > 2 ? 'bad' : 'warn' };
}
