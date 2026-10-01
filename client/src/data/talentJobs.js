// งานที่จ้าง (talent_jobs) ของคนใน Talent Book + ตัวช่วยของฟอร์ม — ผู้ใช้สั่ง 1 ต.ค. 2026
// คนหนึ่งมีได้หลายงาน · หน้าการ์ดโชว์แค่ "จ้างแล้ว N งาน" · กดการ์ดแล้วเห็นทุกงาน (ใหม่สุดก่อน) เพิ่ม/แก้/ลบได้
// งาน 1 งาน = แบรนด์* · วันที่จ้าง* (โชว์เป็นเดือน/ปี เช่น ต.ค. 2026) · ค่าตัวที่จ่ายจริง · Scope · ลิงก์งาน/โพสต์ · หมายเหตุ
// ผู้บันทึก / เวลา server ใส่เอง · เพดานความยาวต้องตรงกับ server (routes/hires.js)
// ไฟล์นี้ต้องเป็น JS ล้วน (ไม่มี JSX / window) — เทสต์ import ตรงผ่าน node ได้
import { webUrl } from './talentSocials.js';

export const JOB_MAX = { brand: 60, scope: 2000, work_link: 1000, note: 1000 };
export const JOB_FEE_MAX = 1e9;   // เพดานเดียวกับเรทราคา
export const JOB_EMPTY = { brand: '', hired_on: '', fee: '', scope: '', work_link: '', note: '' };

const str = v => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// 'YYYY-MM-DD' ที่เป็นวันจริง (ไม่รับ 2026-02-30)
export function validYmd(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(v));
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
// วันที่จ้าง → "ต.ค. 2026" (ปี ค.ศ. แบบที่ทีมใช้ทั้งระบบ) · ค่าเพี้ยน = ''
export function monthYear(v) {
    const m = /^(\d{4})-(\d{2})/.exec(str(v));
    if (!m) return '';
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${TH_MONTH[mo - 1]} ${m[1]}` : '';
}

// ใหม่สุดก่อน: วันที่จ้าง → (วันเดียวกัน) งานที่เพิ่มทีหลัง
export function sortJobs(list) {
    return (Array.isArray(list) ? list : []).filter(j => j && typeof j === 'object').slice().sort((a, b) =>
        str(b.hired_on).slice(0, 10).localeCompare(str(a.hired_on).slice(0, 10))
        || (Number(b.id) || 0) - (Number(a.id) || 0));
}

// จำนวนงานที่จ้างของการ์ด (server ส่ง jobs_count มากับข้อมูลคน) — ไม่มี/เพี้ยน = 0
export function jobsCountOf(card) {
    const t = card && card.talent;
    const n = Number(t && t.jobs_count != null ? t.jobs_count : card && card.jobs_count);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const feeNum = v => Number(String(v == null ? '' : v).replace(/,/g, '').trim());

// ตรวจฟอร์มงาน → { ช่อง: ข้อความ } (ว่าง = ผ่าน) · brands = แบรนด์ที่เลือกได้ (ไม่ส่ง = ไม่เช็ครายชื่อ)
export function jobErrors(f, brands = null) {
    const e = {};
    const brand = str(f && f.brand);
    if (!brand) e.brand = 'เลือกแบรนด์';
    else if (Array.isArray(brands) && !brands.includes(brand)) e.brand = 'เลือกแบรนด์ที่คุณดูแลอยู่';
    const d = str(f && f.hired_on);
    if (!d) e.hired_on = 'เลือกวันที่จ้าง';
    else if (!validYmd(d)) e.hired_on = 'วันที่ไม่ถูกต้อง';
    const fee = str(f && f.fee);
    if (fee) {
        const n = feeNum(fee);
        if (!/\d/.test(fee) || !Number.isFinite(n) || n < 0) e.fee = 'ใส่เป็นตัวเลข เช่น 15000';
        else if (n > JOB_FEE_MAX) e.fee = 'สูงเกินไป (ไม่เกิน 1,000,000,000 บาท)';
    }
    const link = str(f && f.work_link);
    if (link && !webUrl(link)) e.work_link = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
    else if (link.length > JOB_MAX.work_link) e.work_link = `ลิงก์ยาวเกิน ${JOB_MAX.work_link} ตัวอักษร`;
    if (str(f && f.scope).length > JOB_MAX.scope) e.scope = `Scope ยาวเกิน ${JOB_MAX.scope} ตัวอักษร`;
    if (str(f && f.note).length > JOB_MAX.note) e.note = `หมายเหตุยาวเกิน ${JOB_MAX.note} ตัวอักษร`;
    return e;
}

// ฟอร์ม → ข้อมูลที่ส่งไปบันทึก (ค่าตัวว่าง = null · ลิงก์ไม่มี https:// เติมให้)
export function jobBody(f) {
    const fee = str(f && f.fee);
    return {
        brand: str(f && f.brand),
        hired_on: str(f && f.hired_on),
        fee: fee ? Math.round(feeNum(fee) * 100) / 100 : null,
        scope: str(f && f.scope),
        work_link: webUrl(f && f.work_link),
        note: str(f && f.note)
    };
}
// งานที่บันทึกแล้ว → ค่าในฟอร์มแก้ไข
export function jobForm(j) {
    const s = v => (v == null ? '' : String(v));
    return {
        brand: s(j && j.brand), hired_on: s(j && j.hired_on).slice(0, 10),
        fee: j && j.fee != null && j.fee !== '' ? String(j.fee) : '',
        scope: s(j && j.scope), work_link: s(j && j.work_link), note: s(j && j.note)
    };
}

// ===== วางรูปจากคลิปบอร์ด (Ctrl+V) ในช่องรูปของฟอร์ม — อัปแบบเดียวกับเลือกไฟล์ =====
// ชนิดที่ server รับ (นามสกุลต้องตรง — เส้นอัปตรวจจากนามสกุล) · GIF / BMP ไม่รับ
export const PASTE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
// คลิปบอร์ด (clipboardData) → รูปแรกที่เจอ (Blob/File) หรือ null · ไม่มีรูป = ปล่อยให้วางข้อความตามปกติ
export function clipboardImage(data) {
    if (!data) return null;
    const files = Array.from(data.files || []);
    const f = files.find(x => x && /^image\//i.test(x.type || ''));
    if (f) return f;
    const item = Array.from(data.items || []).find(i => i && i.kind === 'file' && /^image\//i.test(i.type || ''));
    return item && typeof item.getAsFile === 'function' ? item.getAsFile() : null;
}
// ชื่อไฟล์ของรูปที่วาง (รูปจากคลิปบอร์ดมักชื่อ image.png ทุกรูป) — ชนิดที่ไม่รับ = ''
export function pasteFileName(type, now = new Date()) {
    const ext = PASTE_TYPES[String(type || '').toLowerCase()];
    if (!ext) return '';
    const p = n => String(n).padStart(2, '0');
    return `pasted-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${ext}`;
}
