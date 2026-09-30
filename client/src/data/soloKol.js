// KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026) · ตรรกะล้วน ทดสอบได้โดยไม่ต้องเปิดเบราว์เซอร์
// ตัวเลือกต้องตรงกับ server/src/store/soloKol.js (tests/solo-kol-client.test.cjs เทียบให้)

export const SOLO_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
export const SOLO_TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
export const SOLO_CODE_EXPIRE = [7, 30, 60, 180, 365];
export const SOLO_MAX_CLIPS = 5;

// Tier ตามจำนวนผู้ติดตาม — แนะนำให้อัตโนมัติ แก้เองได้
export function tierFromFollowers(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v < 10000) return SOLO_TIERS[0];
    if (v < 100000) return SOLO_TIERS[1];
    if (v < 1000000) return SOLO_TIERS[2];
    return SOLO_TIERS[3];
}
export const tierShort = t => String(t || '').split(' ')[0];

// ขั้นถัดไปของการจ้าง (server คิดให้ใน solo_summary.next_step — soloClipStep ใน server/src/store/soloKol.js)
export const SOLO_STEP_LABEL = {
    todo: 'รอส่งดราฟ', review: 'รอตรวจดราฟ', approved: 'รอลงงาน',
    gencode: 'รอ Gencode', idpost: 'รอ ID Post', ad: 'รอยิงแอด', done: 'ยิงแอดแล้ว'
};
// ตัวกรองขั้นงานบนแท็บ KOL รายคน — Gencode กับ ID Post รวมเป็นปุ่มเดียว
export const SOLO_STEP_FILTERS = [
    { key: 'todo', label: 'รอส่งดราฟ', steps: ['todo'] },
    { key: 'review', label: 'รอตรวจดราฟ', steps: ['review'] },
    { key: 'approved', label: 'รอลงงาน', steps: ['approved'] },
    { key: 'code', label: 'รอ Gencode / ID Post', steps: ['gencode', 'idpost'] },
    { key: 'ad', label: 'รอยิงแอด', steps: ['ad'] },
    { key: 'done', label: 'ยิงแอดแล้ว', steps: ['done'] }
];
export const soloStepOf = p => (p && p.solo_summary && p.solo_summary.next_step) || 'todo';
export const matchStepFilter = (p, key) => {
    if (!key || key === 'all') return true;
    const f = SOLO_STEP_FILTERS.find(x => x.key === key);
    return !!f && f.steps.includes(soloStepOf(p));
};

// ค้นหาในแท็บ KOL รายคน — ชื่อบัญชี / แบรนด์ / ผู้ดูแล / Agency / สินค้า
export function matchSoloSearch(p, q) {
    const s = String(q || '').trim().toLowerCase().replace(/^@+/, '');
    if (!s) return true;
    const sum = (p && p.solo_summary) || {};
    return [p && p.name, p && p.brand, p && p.owner, sum.account_name, sum.payee, sum.agency, ...(sum.products || [])]
        .some(v => String(v || '').toLowerCase().includes(s));
}

// สรุปยอดบนแท็บ (ตามตัวกรองที่เลือก)
export function soloTotals(list) {
    const out = { people: 0, clips: 0, fee: 0, posted: 0, ad: 0 };
    (list || []).forEach(p => {
        const s = (p && p.solo_summary) || {};
        out.people += 1;
        out.clips += Number(s.clips) || 0;
        out.fee += Number(s.fee_total) || 0;
        out.posted += Number(s.posted) || 0;
        out.ad += Number(s.ad_fired) || 0;
    });
    return out;
}

// เลยกำหนดลงงาน: มีกำหนด (solo_summary.due_date — ไม่ใส่ = ไม่มีกำหนด) · ยังลงไม่ครบ · วันนี้เลยวันนั้นแล้ว → จำนวนวันที่เลย (ไม่เลย = 0)
// ห้ามใช้ end_date: server ตั้ง end_date = วันจ้างเมื่อไม่ใส่กำหนด (ให้ตัวกรองปี/เดือนทำงาน) จะขึ้นเลยกำหนดตั้งแต่วันถัดไป
export const soloDueOf = p => (p && p.solo_summary && p.solo_summary.due_date) || null;
export function overdueDays(p, today) {
    const s = (p && p.solo_summary) || {};
    const due = soloDueOf(p);
    if (!due || !today || (s.clips && s.posted >= s.clips) || p.status !== 'Active') return 0;
    const d = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000);
    return d > 0 ? d : 0;
}

export const baht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
export const followersText = n => {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return v ? String(v) : '';
};
