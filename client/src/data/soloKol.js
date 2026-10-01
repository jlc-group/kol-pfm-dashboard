// KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026) · ตรรกะล้วน ทดสอบได้โดยไม่ต้องเปิดเบราว์เซอร์
// ตัวเลือกต้องตรงกับ server/src/store/soloKol.js (tests/solo-kol-client.test.cjs เทียบให้)
// รอบ 4 (1 ต.ค. 2026): 1 การจ้างเลือกได้หลาย Platform — บัญชี / ค่าตัว / ข้อมูลยิงแอด แยกต่อ Platform · จำนวนคลิปเท่ากันทุก Platform

export const SOLO_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
export const SOLO_TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
export const SOLO_MEDIA = ['Photo', 'VDO'];
export const SOLO_CODE_EXPIRE = [7, 30, 60, 180, 365];
export const SOLO_MAX_CLIPS = 5;

// ---- server รุ่นเก่า (ยังไม่รีสตาร์ตหลัง deploy) — ใช้ร่วมกันในฟอร์ม (SoloKolForm) และหน้า KOL รายคน (SoloKolDetail)
// รับแบบ Platform เดียว (ช่องแบนระดับบนสุด) — ส่งรูปใหม่ไปจะตอบว่าไม่เจอช่องแรกที่ตรวจ
// รุ่นที่ขึ้น prod ตรวจชื่อบัญชีก่อนแล้วจึง Platform จึงได้ข้อความแรก · server รุ่นใหม่ไม่ส่งสองข้อความนี้ตรง ๆ ใช้แยกรุ่นได้
export const OLD_SERVER_MSGS = ['ใส่Platformก่อนนะ', 'ใส่ชื่อบัญชี KOLก่อนนะ'];
// server ก่อนรอบ 4 ยังไม่มี "ได้ฟรี" — ตั้งค่าตัว 0 ที่ช่องค่าตัว (PUT /projects/:id/fees) จะตอบข้อความนี้
export const OLD_SERVER_FEE_MSG = 'ค่าตัวของ KOL รายคนต้องมากกว่า 0';
export const OLD_SERVER_TEXT = 'เซิร์ฟเวอร์ยังไม่อัปเดต — กด F5 แล้วลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ';
// 404 ของตัวจับเส้นที่ server ไม่รู้จัก (server/src/app.js) = ยังไม่มีเส้นนี้ (server รุ่นเก่า)
// 404 แบบอื่น (เช่น "ไม่พบ Project" — รายการถูกลบไปแล้ว) ต้องโชว์ข้อความของ server ตามจริง ไม่ใช่บอกว่า server ยังไม่อัปเดต
export const ROUTE_NOT_FOUND_MSG = 'API route not found';
export const isOldServerError = e => !!e && ((e.status === 404 && e.message === ROUTE_NOT_FOUND_MSG) || OLD_SERVER_MSGS.includes(e.message));

// คลิปที่ "ยังว่าง" (ยังไม่มีอะไรเกิดขึ้นเลย) — ต้องตรงกับ soloClipEmpty ใน server/src/store/soloKol.js ทุกเงื่อนไข
// (tests/solo-kol-client.test.cjs เทียบให้) · คลิปไม่ว่าง = เอา Platform ของคลิปออกไม่ได้ / ลดจำนวนคลิปให้ต่ำกว่าลำดับคลิปนั้นไม่ได้
const filled = v => !!(v && String(v).trim());
export const clipEmpty = s => !!s && ![s.draft_link, s.draft_link2, s.draft_link3, s.draft_link4, s.draft_link5, s.post_url, s.gencode, s.id_post].some(filled)
    && !(Number(s.ad_spend) > 0) && !(Number(s.views) > 0) && !s.perf_stamp && s.ad_status !== 'ยิงแล้ว';

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

// Platform เรียงตาม SOLO_PLATFORMS เสมอ (ตัวแรก = Platform หลัก) · ค่าแปลก ๆ ที่ไม่อยู่ในลิสต์ต่อท้าย ไม่ทิ้ง
export function soloPlatformOrder(list) {
    const set = new Set((list || []).filter(Boolean));
    return [...SOLO_PLATFORMS.filter(p => set.has(p)), ...[...set].filter(p => !SOLO_PLATFORMS.includes(p))];
}
// บัญชีของการจ้าง (1 บัญชี / Platform) — solo_summary.accounts · สรุปรุ่นก่อนรอบ 4 มีบัญชีเดียวที่ระดับบนสุด
export function soloAccountsOf(p) {
    const s = (p && p.solo_summary) || {};
    if (Array.isArray(s.accounts) && s.accounts.length) return s.accounts;
    return s.account_name ? [{
        platform: s.platform || '', account_name: s.account_name, link_account: s.link_account || null,
        followers: Number(s.followers) || 0, tier: s.tier || null
    }] : [];
}
// Platform ของการจ้าง — solo_summary.platforms → บัญชี → บล็อกในกลุ่มโฆษณา → Platform ของกลุ่ม
export function soloPlatformsOf(p) {
    const s = (p && p.solo_summary) || {};
    if (Array.isArray(s.platforms) && s.platforms.length) return soloPlatformOrder(s.platforms);
    const acc = soloAccountsOf(p).map(a => a.platform).filter(Boolean);
    if (acc.length) return soloPlatformOrder(acc);
    const g = ((p && p.ad_groups) || [])[0] || {};
    const blocks = (Array.isArray(g.blocks) ? g.blocks : []).map(b => b && b.platform).filter(Boolean);
    if (blocks.length) return soloPlatformOrder(blocks);
    return g.platform ? [g.platform] : [];
}
// ข้อจำกัดของฟอร์มแก้ไข (เกณฑ์เดียวกับ updateSolo ฝั่ง server ซึ่งดูทุกแถวคลิป) จากคลิปที่ไม่ว่าง (clipEmpty)
// lockedPlatforms = Platform ที่เอาออกไม่ได้ · minClips = จำนวนคลิปต่ำสุดที่เลือกได้ (ลำดับคลิปที่ไม่ว่างสูงสุด)
export function soloEditLimits(subs) {
    const busy = (subs || []).filter(s => s && !clipEmpty(s));
    return {
        lockedPlatforms: soloPlatformOrder(busy.map(s => s.platform)),
        minClips: busy.reduce((n, s) => Math.max(n, Number(s.clip_no) || 1), 1)
    };
}

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

// ค้นหาในแท็บ KOL รายคน — ชื่อบัญชี (ทุก Platform) / แบรนด์ / ผู้ดูแล / Agency / สินค้า
export function matchSoloSearch(p, q) {
    const s = String(q || '').trim().toLowerCase().replace(/^@+/, '');
    if (!s) return true;
    const sum = (p && p.solo_summary) || {};
    const accounts = soloAccountsOf(p).map(a => a && a.account_name);
    return [p && p.name, p && p.brand, p && p.owner, sum.account_name, ...accounts, sum.payee, sum.agency, ...(sum.products || [])]
        .some(v => String(v || '').toLowerCase().includes(s));
}

// สรุปยอดบนแท็บ (ตามตัวกรองที่เลือก) — clips = จำนวนโพสต์ทั้งหมด (คลิป × Platform)
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

export const baht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
export const followersText = n => {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return v ? String(v) : '';
};
