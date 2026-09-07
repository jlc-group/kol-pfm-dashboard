// ขั้นของงาน 1 คลิป — funnel: รอส่งดราฟ → รอตรวจดราฟ → Approve แล้ว → ลงงานแล้ว
// แยกไว้ที่เดียว เพราะทั้งการ์ดสรุป (นับ) และตาราง On Process (กรอง) ต้องใช้เกณฑ์เดียวกัน
// ไม่งั้นกดการ์ด "รอตรวจ 37" แล้วตารางอาจขึ้นมาไม่ครบ 37
export const STAGES = [
    { key: 'todo', label: 'รอส่งดราฟ' },
    { key: 'review', label: 'รอตรวจดราฟ' },
    { key: 'approved', label: 'ดราฟ Approve แล้ว' },
    { key: 'posted', label: 'ลงงานแล้ว' }
];

const filled = v => !!(v && String(v).trim());

export function workStage(s) {
    if (filled(s.post_url)) return 'posted';
    if (s.draft_status === 'approve') return 'approved';
    if ([s.draft_link, s.draft_link2, s.draft_link3, s.draft_link4, s.draft_link5].some(filled)) return 'review';
    return 'todo';
}

// นับทีละขั้น (รับเฉพาะรายการที่คัดเลือกแล้ว)
export function countStages(subs = []) {
    const out = { todo: 0, review: 0, approved: 0, posted: 0 };
    subs.forEach(s => { out[workStage(s)]++; });
    return out;
}
