// ประเภทงานของงาน Talent — รายการเดียว ใช้ทุกฟอร์ม (ฟอร์มสั้น / ฟอร์มงานเต็ม / แก้ใบขอให้หา / แก้คน) ผ่าน KindPicker
// ผู้ใช้สั่ง 29 ก.ย.: เอา ช่างภาพ / ช่างวิดีโอ / เสียงพากย์ ออก · "Event" → "งาน Event" · "อื่น ๆ" ให้พิมพ์เองว่าเป็นงานอะไร
// ผู้ใช้สั่ง 30 ก.ย.: เพิ่ม Presenter (ไว้ก่อน "อื่น ๆ" ซึ่งต้องอยู่ท้ายเสมอ)
// ผู้ใช้สั่ง 5 ต.ค.: ย้าย Presenter ไปตัวแรก · เพิ่ม KOL ต่อจาก นักแสดง
// ค่าที่เก็บ = ชื่อประเภทในรายการ หรือข้อความที่พิมพ์เองตอนเลือก "อื่น ๆ" (เช่น "ช่างแต่งหน้า")
// server รับข้อความอิสระอยู่แล้ว (บังคับแค่ห้ามว่าง) · ตอนแก้นี้ในฐานยังไม่มีงาน Talent เลย ไม่มีค่าเก่าต้องย้าย
// ค่าที่ไม่อยู่ในรายการ (ของเก่าอย่าง "ช่างภาพ" / ที่พิมพ์เอง) แสดงเป็น "อื่น ๆ" + ข้อความเดิมในช่อง แก้ต่อได้
export const KIND_OTHER = 'อื่น ๆ';
export const HIRE_KINDS = ['Presenter', 'นางแบบ', 'นายแบบ', 'นักแสดง', 'KOL', 'Live สด', 'พิธีกร', 'งาน Event', KIND_OTHER];
export const KIND_MAXLEN = 100;   // เท่ากับที่ฝั่ง server / หน้าแก้คนตัด
const FIXED = HIRE_KINDS.filter(k => k !== KIND_OTHER);

// ตัวเลือกที่ต้องติ๊ก: ในรายการ = ตัวมันเอง · ว่าง = ยังไม่เลือก · นอกนั้น = "อื่น ๆ"
export function kindChoiceOf(kind) {
    const k = String(kind ?? '');
    if (!k) return '';
    return FIXED.includes(k) ? k : KIND_OTHER;
}

// ข้อความในช่อง "ระบุงาน" (ค่า "อื่น ๆ" เปล่า ๆ = ยังไม่ได้พิมพ์)
export function kindOtherText(kind) {
    const k = String(kind ?? '');
    return kindChoiceOf(k) === KIND_OTHER && k !== KIND_OTHER ? k : '';
}

// ข้อความเตือนก่อนบันทึก ('' = ผ่าน)
export function kindError(kind) {
    const raw = String(kind ?? '');
    if (!raw) return 'เลือกประเภทงาน';
    const k = raw.trim();
    if (!k || k === KIND_OTHER) return 'ระบุว่าเป็นงานอะไร (พิมพ์ในช่องใต้ "อื่น ๆ")';
    return '';
}

// ค่าที่ส่งไปบันทึก
export const kindValue = kind => String(kind ?? '').trim();
