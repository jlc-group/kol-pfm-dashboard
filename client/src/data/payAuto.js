// ทำจ่ายอัตโนมัติ (ผู้ใช้สั่ง 8 ต.ค. 2026) — กติกาเดียวกับ server (store/pg/payBatches.js + services/autoPay.js)
// 1) งวดที่แนบใบแจ้งหนี้แล้ว (ไฟล์หรือลิงก์) ขึ้นแท็บ "รอทำจ่าย" ทันที · ยังไม่แนบ = เห็นแค่ในแท็บแคมเปญ / ตั้งงวด
// 2) เลยวันทำจ่าย (due_date) มาแล้ว 1 วัน → ระบบย้ายเป็น "จ่ายแล้ว" เอง (รอบละ 1 เอเจนซี่ + 1 วัน · แนบสลิปทีหลังได้)
// 3) ยกเลิกรอบของงวดที่เลยวันแล้ว = 'hold' พักไว้ในรอทำจ่าย — ไม่นับจ่ายซ้ำจนกว่าจะบันทึกแผนงวดใหม่

export const AUTO_PAY_BY = 'ระบบอัตโนมัติ';

export const hasInvoice = i => !!(i && ((i.invoice && typeof i.invoice === 'object') || (i.invoice_link && String(i.invoice_link).trim())));

// วันนี้ตามเวลาไทย 'YYYY-MM-DD' (ตรงกับ todayTH ฝั่ง server)
export const todayTH = (ms = Date.now()) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

// วันถัดไปของ 'YYYY-MM-DD' = วันที่ระบบย้ายเป็นจ่ายแล้ว
export function dayAfter(d) {
    const t = Date.parse(String(d || '').slice(0, 10) + 'T00:00:00Z');
    return Number.isNaN(t) ? null : new Date(t + 86400000).toISOString().slice(0, 10);
}

// งวดที่ขึ้นในแท็บรอทำจ่าย
export const inPendingTab = i => !!i && (i.status === 'pending' || i.status === 'hold') && hasInvoice(i);

// สถานะของงวดในแท็บรอทำจ่าย
// hold = ยกเลิกรอบแล้ว พักไว้ · nodate = ยังไม่ตั้งวันทำจ่าย (ไม่ย้ายเอง) · moving = เลยวันแล้ว กำลังย้าย · waiting = รอถึงวัน
export function pendingState(i, today = todayTH()) {
    if (i.status === 'hold') return 'hold';
    const d = String(i.due_date || '').slice(0, 10);
    if (!d) return 'nodate';
    return d < today ? 'moving' : 'waiting';
}
