// วัน Gencode ที่เหลือ (Day Left) — ใช้ร่วมกันหน้า KOL Analytics กับหน้า Ads (คอลัมน์ DAY LEFT ต่อจากระยะเวลายิง · 10 พ.ย. 2026)
// ตัวเลขคิดที่ server (logic.js gencodeDayLeft = วันลงโพสต์ + อายุ Gencode − วันนี้) · ไฟล์นี้แค่เลือกสี / ข้อความ / ลำดับ

// สีป้าย: ต่ำกว่า 10 วัน = แดง | 10-20 วัน = เหลือง | 21 วันขึ้นไป = เขียว | ติดลบ = หมดอายุแล้ว
// none = กลุ่มตั้ง "-" (ไม่ใช้ Gencode) และแถวนี้ไม่มี Gencode · unknown = ยังไม่มีข้อมูล (ไม่มีวันลงโพสต์ / server รุ่นก่อนที่ยังไม่ส่งค่า)
export function dayLeftLevel(days, none = false) {
    if (none) return 'none';
    if (days === null || days === undefined || days === '' || !Number.isFinite(Number(days))) return 'unknown';
    const d = Number(days);
    if (d < 0) return 'over';
    return d < 10 ? 'red' : d <= 20 ? 'amber' : 'green';
}

export const DAY_LEFT_WHY = {
    red: 'เหลือน้อยกว่า 10 วัน — ต้องรีบแล้ว',
    amber: 'เหลือ 10-20 วัน — เริ่มต้องตาม',
    green: 'เหลือมากกว่า 20 วัน — ยังมีเวลา',
    over: 'Gencode หมดอายุแล้ว'
};

// วันครบอายุ Gencode = วันลงโพสต์ + จำนวนวัน (YYYY-MM-DD) — วันนั้นป้ายขึ้น 0 Days วันถัดไปเป็นหมดอายุแล้ว · ข้อมูลไม่ครบ = null
export function gencodeExpireDate(postDate, days) {
    const n = Number(days);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(postDate || ''));
    if (!m || !Number.isFinite(n) || n <= 0) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
    return d.toISOString().slice(0, 10);
}

// เรียงตามวันที่เหลือ — dir 'asc' = ใกล้หมดอายุก่อน (หมดอายุแล้ว/ติดลบอยู่บนสุด) · 'desc' = เหลือเยอะก่อน
// แถวที่ไม่มีตัวเลข (ไม่ใช้ Gencode / ยังไม่มีวันลงโพสต์) อยู่ท้ายเสมอ · ค่าเท่ากันคงลำดับเดิม (ตามที่ server ส่ง) · dir อื่น = ไม่เรียง
export function sortByDayLeft(rows, dir) {
    const list = Array.isArray(rows) ? rows : [];
    if (dir !== 'asc' && dir !== 'desc') return list;
    const sign = dir === 'asc' ? 1 : -1;
    const keyOf = r => {
        if (!r || r.no_gencode === true) return null;
        const v = r.day_left;
        return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    return list
        .map((r, i) => ({ r, i, k: keyOf(r) }))
        .sort((a, b) => {
            if (a.k === null || b.k === null) return (a.k === null) - (b.k === null) || (a.i - b.i);
            return (sign * (a.k - b.k)) || (a.i - b.i);
        })
        .map(x => x.r);
}
