// ป้าย KOL PFM จาก WeBoostX ในช่อง ค่าแอด / REACH หน้า Ads (19 ต.ค. 2026) — ตรรกะล้วน ทดสอบได้โดยไม่ต้องเปิดเบราว์เซอร์
// pfm 0-10 = engagement จากแอดต่อ 1,000 impressions จัดอันดับเทียบโพสต์ KOL แบรนด์ + แพลตฟอร์มเดียวกัน (5 = กลางกลุ่ม)
// เกรดใช้ตามที่ WeBoostX ส่งมา (คิดจากคะแนนก่อนปัด) — ห้ามคิดเกรดเองจาก pfm
// WeBoostX ดูแลเฉพาะ Instagram / Facebook — แถวแพลตฟอร์มอื่นไม่ขึ้นป้ายนี้ (ผู้ใช้เลือก 19 ต.ค. 2026)

export const WX_PFM_TITLE = 'KOL PFM (WeBoostX): engagement จากแอดต่อ 1,000 impressions เทียบโพสต์ KOL ของแบรนด์และแพลตฟอร์มเดียวกัน — ไม่ใช่ตัวบอกว่าแอดถูกหรือแพง';

const GRADES = ['S', 'A', 'B', 'C', 'D'];

export const isWxPlatform = platform => /instagram|facebook/i.test(String(platform == null ? '' : platform));

// คะแนนตามที่ส่งมา (ไม่เกิน 2 ตำแหน่ง ตัดศูนย์ท้าย): 7.7 → "7.7" · 7.73 → "7.73" · 8 → "8"
function scoreText(v) {
    const n = Math.round(v * 100) / 100;
    return String(n);
}

// → { text, grade, cls } · ไม่มีคะแนน (null / ค่าแปลก) = "—"
export function wxPfmBadge(pfm, grade) {
    const n = pfm === null || pfm === undefined || pfm === '' ? NaN : Number(pfm);
    const g = typeof grade === 'string' ? grade.trim().toUpperCase() : '';
    if (!Number.isFinite(n) || n < 0 || n > 10 || !GRADES.includes(g)) return { text: '—', grade: null, cls: 'none' };
    return { text: `${g} · ${scoreText(n)}`, grade: g, cls: g.toLowerCase() };
}
