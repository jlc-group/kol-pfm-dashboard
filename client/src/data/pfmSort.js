// เรียงหน้า Ads ตามคะแนน PFM (ผู้ใช้สั่ง 22 ต.ค. 2026 — "กดทีเดียวเรียงทั้ง CPM และ CPE" · คอลัมน์ STAMPED PFM 🔒 และ PFM)
// คะแนน = (CPM ÷ เกณฑ์ CPM + CPE ÷ เกณฑ์ CPE) ÷ 2 — ต่ำ = ดี · เทียบกับเกณฑ์ทั้งสองตัวจึงนับน้ำหนักเท่ากัน (CPM หลักสิบ CPE หลักหน่วย)
// มีตัวเดียว = ใช้ตัวนั้น · ไม่มีตัวเลขเลย (เช่นบัญชีที่ไม่เห็นต้นทุน) = เรียงตามผล ผ่าน ก่อน ไม่ผ่าน · ไม่มีผล = ท้ายตารางเสมอ
// key 'stamp' = ผลที่ล็อกไว้ (perf_stamp) · 'live' = ผลตอนนี้ (content_cpm / content_cpe / performance)

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function pfmScore(cpm, cpe, good) {
    const parts = [];
    if (num(cpm) !== null && good.cpm > 0) parts.push(num(cpm) / good.cpm);
    if (num(cpe) !== null && good.cpe > 0) parts.push(num(cpe) / good.cpe);
    return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
}

// ค่าที่ใช้เรียงของแถว: { tier, score } · tier 0 = มีตัวเลข · 1 = มีแค่ผลผ่าน/ไม่ผ่าน · 2 = ยังไม่มีผล
export function pfmSortValue(row, key, good) {
    if (key === 'stamp') {
        const st = row && row.perf_stamp;
        if (!st) return { tier: 2, score: 0 };
        const sc = pfmScore(st.cpm, st.cpe, good);
        if (sc !== null) return { tier: 0, score: sc };
        return st.verdict ? { tier: 1, score: st.verdict === 'Pass' ? 0 : 1 } : { tier: 2, score: 0 };
    }
    if (!row || !row.performance) return { tier: 2, score: 0 };
    const sc = pfmScore(row.content_cpm, row.content_cpe, good);
    if (sc !== null) return { tier: 0, score: sc };
    return { tier: 1, score: row.performance === 'Good' ? 0 : 1 };
}

// sort = { key: 'stamp' | 'live' | '', dir: 'asc' | 'desc' | '' } · ไม่เรียง = คืนลำดับเดิม (ตามที่ server ส่ง)
// asc = คะแนนน้อย → มาก (ดีสุดก่อน) · desc = มาก → น้อย · แถวที่ยังไม่มีผลอยู่ท้ายเสมอ · ค่าเท่ากันคงลำดับเดิม
export function sortByPfm(rows, sort, good) {
    const list = Array.isArray(rows) ? rows : [];
    if (!sort || !sort.key || (sort.dir !== 'asc' && sort.dir !== 'desc')) return list;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return list
        .map((r, i) => ({ r, i, v: pfmSortValue(r, sort.key, good) }))
        .sort((a, b) => (a.v.tier - b.v.tier) || (sign * (a.v.score - b.v.score)) || (a.i - b.i))
        .map(x => x.r);
}

// จำนวนแถวที่มีผลให้เรียง (ตัวเลขบนตัวเลือก)
export const pfmRatedCount = (rows, key, good) => (rows || []).filter(r => pfmSortValue(r, key, good).tier < 2).length;
