// ระยะเวลายิงแอดของ 1 โพสต์ (หน้า Ads คอลัมน์ "ระยะเวลายิง" · ผู้ใช้สั่ง 1 ต.ค. 2026)
// นับจาก "วันที่พร้อมให้ยิง" = วันที่ข้อมูลครบชิ้นสุดท้าย ไม่ใช่วันลงคลิป — ความช้าของเอเจนซี่/คนอนุมัติไม่นับเป็นความช้าของคนยิงแอด
//   วันลงคลิป · วันที่ใส่ Gencode (กลุ่มที่ใช้ Gencode) · วันที่ใส่ ID Post (TikTok) · วันที่ทีมอนุมัติข้อมูลโพสต์ (post_check 'ok')
// ยิงภายใน 3 วันนับจากวันพร้อมยิง = ตรงเวลา · เกินกว่านั้นนับเฉพาะส่วนที่เกิน (พร้อม 1 ต.ค. ยิง 6 ต.ค. = ช้า 2 วัน)
export const AD_GRACE_DAYS = 3;

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// วันที่ตามเวลาไทย (YYYY-MM-DD) — รับทั้งวันที่ล้วน และเวลาแบบ ISO จากฐาน (TIMESTAMPTZ เก็บเป็น UTC)
export function thDay(v) {
    if (!v) return null;
    const s = String(v);
    if (isDay(s)) return s;
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// จำนวนวันระหว่าง 2 วันที่ (to - from) · ข้อมูลไม่ครบ = null
export function dayDiff(from, to) {
    if (!isDay(from) || !isDay(to)) return null;
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

const READY_LABEL = { post: 'ลงคลิป', gencode: 'ใส่ Gencode', idpost: 'ใส่ ID Post', check: 'ทีมอนุมัติข้อมูลโพสต์' };

// วันที่พร้อมให้ยิง = วันที่ช้าที่สุดของข้อมูลที่ต้องมีก่อนยิง → { date, by, label } · ไม่มีวันลงคลิป = null
// เวลาที่ไม่ได้บันทึกไว้ (ข้อมูลเก่าก่อนมีการเก็บเวลา) ข้ามไป ไม่เดา
export function adReadyDate(row) {
    if (!row) return null;
    const post = thDay(row.post_date);
    if (!post) return null;
    const cands = [['post', post]];
    if (row.no_gencode !== true && row.gencode && String(row.gencode).trim()) cands.push(['gencode', thDay(row.gencode_at)]);
    if (row.platform === 'TikTok' && row.id_post && String(row.id_post).trim()) cands.push(['idpost', thDay(row.id_post_at)]);
    if (row.post_check === 'ok') cands.push(['check', thDay(row.post_check_at)]);
    let best = null;
    cands.forEach(([by, date]) => { if (date && (!best || date > best.date)) best = { by, date }; });
    return { ...best, label: READY_LABEL[best.by] };
}

// ระยะเวลายิงของแถวที่ยิงแล้ว (adDate = วันยิงแอด) → { ready, adDate, waited, late } · ข้อมูลไม่ครบ = null
// waited = วันพร้อมยิง → วันยิง (ยิงก่อนข้อมูลครบ = 0) · late = ส่วนที่เกิน 3 วัน (0 = ตรงเวลา)
export function adTiming(row, adDate) {
    const ad = thDay(adDate);
    const ready = adReadyDate(row);
    if (!ad || !ready) return null;
    const d = dayDiff(ready.date, ad);
    if (d === null) return null;
    const waited = Math.max(0, d);
    return { ready, adDate: ad, waited, late: Math.max(0, waited - AD_GRACE_DAYS) };
}

// ระดับสีของป้าย + ตัวกรอง: ตรงเวลา / ช้า 1-2 วัน / ช้า 3 วันขึ้นไป
export const timingLevel = late => (late <= 0 ? 'ontime' : late <= 2 ? 'warn' : 'bad');
export const TIMING_OPTS = [
    ['ontime', 'ตรงเวลา (ภายใน 3 วัน)'],
    ['warn', 'ช้า 1-2 วัน'],
    ['bad', 'ช้า 3 วันขึ้นไป']
];

// คำอธิบายเวลาชี้ที่ป้าย
export function timingTip(t) {
    if (!t) return '';
    const base = `พร้อมยิง ${t.ready.date} (${t.ready.label}) · ยิง ${t.adDate} · รอ ${t.waited} วัน`;
    return t.late > 0
        ? `${base} — เกินกำหนด ${AD_GRACE_DAYS} วันไป ${t.late} วัน`
        : `${base} — ภายในกำหนด ${AD_GRACE_DAYS} วัน`;
}
