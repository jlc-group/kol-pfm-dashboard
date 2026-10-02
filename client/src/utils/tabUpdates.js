// แจ้งเตือนแท็บ "รายชื่อ KOL" / "On Process" — เทียบเวลาอัปเดตล่าสุดกับครั้งที่เปิดดูล่าสุด (เก็บใน localStorage)
// timestamp เป็น ISO string (เทียบด้วย > ได้ตรงๆ)

const maxStr = (a, b) => (a > b ? a : b);

// เวลาล่าสุดของแท็บ "รายชื่อ KOL" (เพิ่ม/แก้ข้อมูล KOL หรือคัดเลือก)
export function listLatest(subs) {
    return (subs || []).reduce((mx, s) =>
        [s.submitted_at, s.list_updated_at, s.decided_at].reduce((m, t) => maxStr(m, t || ''), mx), '');
}

// เวลาล่าสุดของแท็บ "On Process" (อัปเดตดราฟ/งาน ของ KOL ที่คัดเลือกแล้ว)
export function processLatest(subs) {
    return (subs || []).filter(s => s.status === 'confirmed')
        .reduce((mx, s) => maxStr(mx, s.work_updated_at || ''), '');
}

const K = (scope, kind) => `kolseen:${scope}:${kind}`;

// ครั้งแรกที่เปิด project/token นี้ → ถือว่าเห็นทุกอย่างแล้ว (ไม่เด้ง badge ย้อนหลัง)
function ensureInit(scope, subs) {
    if (localStorage.getItem(K(scope, 'init')) === '1') return;
    localStorage.setItem(K(scope, 'list'), listLatest(subs));
    localStorage.setItem(K(scope, 'process'), processLatest(subs));
    localStorage.setItem(K(scope, 'init'), '1');
}

// คืน { listNew, processNew } — มีอัปเดตใหม่ที่ยังไม่ได้เปิดดูไหม
export function tabBadges(scope, subs) {
    ensureInit(scope, subs);
    return {
        listNew: listLatest(subs) > (localStorage.getItem(K(scope, 'list')) || ''),
        processNew: processLatest(subs) > (localStorage.getItem(K(scope, 'process')) || '')
    };
}

// ===== ป้าย "อัปเดตใหม่" บนการ์ดแคมเปญ (หน้ารายการแคมเปญ · 2 ต.ค. 2026) =====
// server ส่ง list_latest / process_latest มากับแคมเปญ (คิดแบบเดียวกับ listLatest / processLatest ข้างบน)
// เทียบกับเวลาที่เปิดดูแท็บนั้นล่าสุดในหน้าแคมเปญ (key ชุดเดียวกัน) → เปิดดูแท็บแล้วป้ายบนการ์ดหายตาม
// ยังไม่เคยเปิดแคมเปญนี้ในเครื่องนี้ = ถือว่าเห็นของตอนนี้แล้ว (ไม่เด้งย้อนหลังทุกแคมเปญ) แบบเดียวกับ ensureInit
// localStorage ใช้ไม่ได้ (โหมดส่วนตัว / ถูกปิด) = ไม่มีป้าย ไม่ทำให้หน้าพัง
export function cardUpdates(scope, listTs, processTs) {
    // server รุ่นก่อน (หน้าเว็บใหม่ขึ้นก่อน server รีสตาร์ต) ไม่ส่งสองช่องนี้ — ห้ามตั้งค่าเริ่มต้นเป็น ''
    // ไม่งั้นพอ server ใหม่ขึ้น ทุกการ์ดที่เครื่องนี้ยังไม่เคยเปิดจะขึ้น "อัปเดตใหม่" ค้าง ทั้งที่ไม่มีอะไรใหม่
    if (listTs === undefined || processTs === undefined) return { list: false, process: false };
    try {
        if (localStorage.getItem(K(scope, 'init')) !== '1') {
            localStorage.setItem(K(scope, 'list'), listTs || '');
            localStorage.setItem(K(scope, 'process'), processTs || '');
            localStorage.setItem(K(scope, 'init'), '1');
            return { list: false, process: false };
        }
        return {
            list: (listTs || '') > (localStorage.getItem(K(scope, 'list')) || ''),
            process: (processTs || '') > (localStorage.getItem(K(scope, 'process')) || '')
        };
    } catch {
        return { list: false, process: false };
    }
}

// ทำเครื่องหมายว่าเปิดดูแท็บนี้แล้ว (เคลียร์ badge)
export function markSeen(scope, tab, subs) {
    const t = tab === 'process' ? processLatest(subs) : listLatest(subs);
    localStorage.setItem(K(scope, tab === 'process' ? 'process' : 'list'), t);
}

// ===== แจ้งเตือนดราฟใหม่รายคน (per-KOL) =====
const DK = (scope, subId) => `draftseen:${scope}:${subId}`;

// KOL คนนี้มีดราฟอัปเดตใหม่ที่ยังไม่ได้เปิดดูไหม
export function draftIsNew(scope, sub) {
    const du = sub.draft_updated_at || '';
    if (!du) return false;
    return du > (localStorage.getItem(DK(scope, sub.id)) || '');
}

// เปิดดู/บันทึกดราฟของ KOL คนนี้แล้ว → เคลียร์
export function markDraftSeen(scope, sub) {
    localStorage.setItem(DK(scope, sub.id), sub.draft_updated_at || new Date().toISOString());
}

// ครั้งแรกของ scope นี้ → ถือว่าเห็นดราฟปัจจุบันทั้งหมดแล้ว (ไม่เด้งย้อนหลัง)
export function seedDraftsSeen(scope, subs) {
    const k = `draftseen:${scope}:init`;
    if (localStorage.getItem(k) === '1') return;
    (subs || []).forEach(s => { if (s.draft_updated_at) localStorage.setItem(DK(scope, s.id), s.draft_updated_at); });
    localStorage.setItem(k, '1');
}
