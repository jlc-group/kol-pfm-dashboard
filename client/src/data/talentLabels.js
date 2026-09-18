// คำศัพท์ชุดเดียวของหน้า Talent — เปลี่ยนแค่ "ป้ายที่แสดง" ค่าที่เก็บในฐานเหมือนเดิมทุกตัว
// (ทาบทาม / ตกลงแล้ว / เสนอ / เลือกแล้ว / ไม่เอา / pending / fee_review / Draft / Active ... ห้ามแก้)
// ไฟล์นี้ต้องเป็น JS ล้วน (ไม่มี JSX / window) — เทสต์ import ตรงผ่าน node ได้

// คำนามที่ใช้ทั้งหน้า — ใช้ตัวแปรแทนการพิมพ์ซ้ำ จะได้ไม่หลุดกลับไปใช้คำเก่า
export const T = {
    request: 'ใบขอให้หา',            // เดิม: ใบขอจัดหา
    finder: 'คนช่วยหา',              // เดิม: คนหา / ผู้รับผิดชอบจัดหา
    confirmQueue: 'ยืนยันคิว',        // เดิม: คอนเฟิร์มคิว / ยืนยันคอนเฟิร์มคิว
    cantCome: 'คนนี้มาไม่ได้',        // เดิม: คิวไม่ว่าง / ถอนตัว
    talking: 'กำลังคุย',              // เดิม: ทาบทาม
    pick: 'เลือกคนนี้',               // เดิม: อนุมัติ (ชื่อที่เสนอ)
    reject: 'ไม่เอา',                 // เดิม: ไม่ผ่าน
    spare: 'สำรองไว้',                // เดิม: ตัวสำรอง
    restore: 'เอากลับมาพิจารณา',      // เดิม: ดึงกลับมาพิจารณา
    owner: 'ผู้ดูแลงาน',              // เดิม: ผู้ติดต่อ (ของงาน)
    contact: 'เบอร์/LINE',            // เดิม: ช่องทางติดต่อ (ของคน)
    note: 'หมายเหตุ',                 // เดิม: โน้ต
    agreed: 'ตกลงแล้ว',
    pending: 'รอยืนยัน',
    reserved: 'งบที่กันไว้',
    newFee: 'ค่าตัวใหม่'
};

// สถานะงาน (projects.status) — "ร่าง" กับ "กำลังทำ" รวมเป็นป้ายเดียว (Draft ใช้แค่เรียงลำดับ)
export const JOB_STATUS_LABEL = { Draft: 'กำลังทำ', Active: 'กำลังทำ', Completed: 'จบแล้ว', Cancelled: 'ยกเลิก' };
export const jobStatusLabel = v => JOB_STATUS_LABEL[v] || JOB_STATUS_LABEL.Draft;
// ตัวเลือกในช่องเปลี่ยนสถานะงาน — งาน Draft ให้เลือกค้างที่ Active (ป้ายเดียวกัน)
export const JOB_STATUS_OPTIONS = ['Active', 'Completed', 'Cancelled'];
export const jobStatusValue = v => (v === 'Draft' || !v ? 'Active' : v);

// สถานะคน (hire_items[].status) — ค่าในฐาน → ป้าย
export const HIRE_STATUS_LABEL = {
    'ทาบทาม': 'กำลังคุย',
    'ตกลงแล้ว': 'ตกลงแล้ว',
    'ถ่ายเสร็จ': 'ถ่ายเสร็จ',
    'ส่งงานแล้ว': 'ส่งงานแล้ว',
    // ของใบขอให้หา (casting)
    'กำลังหา': 'กำลังหา',
    'เสนอชื่อแล้ว': 'ส่งชื่อมาแล้ว'
};
export const hireStatusLabel = v => HIRE_STATUS_LABEL[v] || v || '';

// สถานะที่ถือว่า "ตกลงแล้ว" ขึ้นไป (นับเป็นเงินจ่ายจริง) — ต้องตรงกับ HIRE_PAYABLE ใน server/src/store/logic.js
export const PAYABLE_STATUS = ['ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'];
// กติกา: บันทึกคนที่ยังไม่รู้ค่าตัวได้ แต่ตั้งเป็น "ตกลงแล้ว" (และขั้นหลังจากนั้น) ไม่ได้จนกว่าจะใส่ค่าตัว
export const feeMissing = fee => !(Number(String(fee == null ? '' : fee).replace(/[^0-9.]/g, '')) > 0);
export const needsFee = (status, fee) => PAYABLE_STATUS.includes(status) && feeMissing(fee);
export const NEED_FEE_MSG = 'ใส่ค่าตัวก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้';

// ขั้นของใบขอให้หา (hireStage) — booking/fee ต้องเป็นข้อความเดียวกับ BOOKING_LABEL (ชิปกรองในหน้างานเทียบเป็นข้อความ)
export const STAGE_LABEL = {
    unassigned: 'รอเลือกคนช่วยหา',
    finding: 'กำลังหา',
    deciding: 'รอทีมเลือกชื่อ',
    booking: 'รอยืนยันคิว',
    fee: 'รอตัดสินค่าตัวใหม่',
    full: 'ได้ครบแล้ว',
    closed: 'งานปิดแล้ว'
};

// คนที่ทีมเลือกจากใบแล้ว รอคนช่วยหายืนยันคิว / รอทีมตัดสินค่าตัวที่ขอเพิ่ม (booking.state)
export const BOOKING_LABEL = { pending: 'รอยืนยันคิว', fee_review: 'รอตัดสินค่าตัวใหม่' };

// ชื่อที่คนช่วยหาเสนอเข้ามา (candidates[].status) — ค่าในฐาน → ป้าย
export const CAND_LABEL = { 'เสนอ': 'รอเลือก', 'เลือกแล้ว': 'เลือกแล้ว', 'ไม่เอา': 'ไม่เอา' };

// เหตุผลสั้น ๆ ตอนกด "ไม่เอา" (ชิปลัด — พิมพ์เองได้เสมอ)
export const REJECT_REASONS = ['ไม่ตรงสเปค', 'เกินงบ', 'คิวไม่ตรง'];

// ลิงก์ของใบ (ส่ง LINE ให้คนช่วยหา / ทีม) — รูปแบบเดิม ลิงก์เก่าที่ส่งไปแล้วยังเปิดได้
export const requestLink = (origin, projectId, key) => `${origin}/hires?tab=requests&open=${projectId}~${key}`;
export const parseOpen = v => {
    const [pid, key] = String(v || '').split('~');
    return pid && key ? { project_id: pid, key } : null;
};

// ตัวเลขเงิน / เวลาแบบคนอ่าน
export const baht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
export function feeDiff(approved, asked) {
    const a = Number(approved) || 0, b = Number(asked) || 0;
    const d = b - a;
    const pct = a > 0 ? Math.round((d / a) * 100) : null;
    const sign = d >= 0 ? '+' : '−';
    return { diff: d, pct, text: sign + baht(Math.abs(d)) + (pct === null ? '' : ` / ${sign}${Math.abs(pct)}%`) };
}
// "2 ชม.ก่อน" / "3 วันก่อน" — now ส่งเข้ามาได้เพื่อให้เทสต์ได้ผลคงที่
export function timeAgo(iso, now = Date.now()) {
    const t = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'เมื่อสักครู่';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} นาทีก่อน`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ชม.ก่อน`;
    const d = Math.round(h / 24);
    return `${d} วันก่อน`;
}
// วันนี้ตามเวลาไทย (YYYY-MM-DD) และบวกวัน — ใช้กับชิปลัด "ส่งรายชื่อภายใน"
export function todayTH(now = Date.now()) {
    return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
export function addDays(ymd, n) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
}
// เลยกำหนดกี่วัน (0 = ยังไม่เลย) — deadline เป็น YYYY-MM-DD
export function daysLate(deadline, now = Date.now()) {
    if (!deadline) return 0;
    const today = todayTH(now);
    if (deadline >= today) return 0;
    const a = Date.UTC(...today.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
    const b = Date.UTC(...String(deadline).split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
    return Math.round((a - b) / 86400000);
}
