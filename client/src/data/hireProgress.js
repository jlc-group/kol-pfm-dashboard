// ความคืบหน้าของงาน Talent (คน / เงิน / เรื่องที่ต้องทำก่อน) + ขั้นของคนแต่ละคน
// ไฟล์นี้ต้องเป็น JS ล้วน (ไม่มี JSX / window) — เทสต์ import ตรงผ่าน node ได้
// jobProgress ต้องตรงกับ jobProgress ฝั่ง server (server/src/store/logic.js) — tests/talent-r2-parity.test.cjs เทียบผลสองฝั่ง
// การ์ดงานในแท็บงานทั้งหมดได้ผลนี้จาก server (GET /hires/jobs → progress) ส่วนหน้างานคิดเองจาก hire_items ที่โหลดมา
import { T, baht } from './talentLabels.js';

const JOB_CLOSED = ['Completed', 'Cancelled'];
const BOOK_PENDING = 'pending';
const BOOK_FEE = 'fee_review';
const AGREED = 'ตกลงแล้ว';
const SHOT = 'ถ่ายเสร็จ';
const DELIVERED = 'ส่งงานแล้ว';
const TALKING = 'ทาบทาม';
const PAYABLE = [AGREED, SHOT, DELIVERED];

const stOf = it => String((it && it.status) || '').trim();
const bookingState = it => (it && it.booking && it.booking.state) || null;
const bookingOpen = it => bookingState(it) === BOOK_PENDING || bookingState(it) === BOOK_FEE;
const noAssignee = it => !it || it.assignee_id === null || it.assignee_id === undefined || it.assignee_id === '';
const remaining = it => (it && it.mode === 'casting' ? Math.max(0, (Number(it.headcount) || 1) - (Number(it.filled) || 0)) : 0);
const rowFee = it => (!it ? 0 : (Number(it.fee) || 0) * (it.mode === 'casting' ? remaining(it) : 1));
const waiting = it => (it && it.mode === 'casting'
    ? (Array.isArray(it.candidates) ? it.candidates : []).filter(c => c && (String(c.status || '').trim() || 'เสนอ') === 'เสนอ').length
    : 0);
const needMore = it => Math.max(0, remaining(it) - waiting(it));

// เงินของงานแยก 3 ก้อน — ต้องตรงกับ hireBreakdown ฝั่ง server (หน้ารอบทำจ่ายใช้ชุดเดียวกัน)
export function hireBreakdown(items) {
    const out = { agreed: 0, pending: 0, unfilled: 0 };
    (Array.isArray(items) ? items : []).forEach(it => {
        if (!it) return;
        const fee = rowFee(it);
        if (it.mode === 'casting') { out.unfilled += fee; return; }
        if (!bookingOpen(it) && PAYABLE.includes(stOf(it))) out.agreed += fee;
        else out.pending += fee;
    });
    return out;
}

export function jobProgress(items, jobStatus, today) {
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    const closed = JOB_CLOSED.includes(jobStatus);
    const direct = list.filter(it => it.mode !== 'casting');
    const requests = list.filter(it => it.mode === 'casting');
    const people = { total: 0, talking: 0, no_fee: 0, booking: 0, agreed: 0, shot: 0, delivered: 0, need: 0 };
    direct.forEach(it => {
        if (bookingOpen(it)) people.booking += 1;
        else if (stOf(it) === DELIVERED) people.delivered += 1;
        else if (stOf(it) === SHOT) people.shot += 1;
        else if (stOf(it) === AGREED) people.agreed += 1;
        else { people.talking += 1; if (!((Number(it.fee) || 0) > 0)) people.no_fee += 1; }
    });
    const open = closed ? [] : requests.filter(it => remaining(it) > 0);
    people.need = open.reduce((s, it) => s + remaining(it), 0);
    people.total = direct.length + people.need;
    const money = hireBreakdown(list);
    if (closed) return { people, money, todo: [], next: { code: 'closed', n: 0, keys: [] } };

    const todo = [];
    const keysOf = (rows, field = 'key') => [...new Set(rows.map(it => String(it[field])))];
    const add = (code, n, keys) => { if (n > 0) todo.push({ code, n, keys }); };
    const fromReq = it => it.from_request !== null && it.from_request !== undefined;
    const feeRows = direct.filter(it => fromReq(it) && bookingState(it) === BOOK_FEE);
    const pendRows = direct.filter(it => fromReq(it) && bookingState(it) === BOOK_PENDING);
    const deciding = open.filter(it => waiting(it) > 0);
    const unassigned = open.filter(it => waiting(it) === 0 && noAssignee(it));
    const overdue = today ? open.filter(it => it.deadline && needMore(it) > 0 && String(it.deadline) < today) : [];
    const finding = open.filter(it => needMore(it) > 0 && !noAssignee(it));
    const talking = direct.filter(it => !bookingOpen(it) && !PAYABLE.includes(stOf(it)));
    const late = today ? direct.filter(it => !bookingOpen(it) && stOf(it) === AGREED && it.use_date && String(it.use_date) < today) : [];
    add('fee', feeRows.length, keysOf(feeRows, 'from_request'));
    add('decide', deciding.reduce((s, it) => s + waiting(it), 0), keysOf(deciding));
    add('assign', unassigned.length, keysOf(unassigned));
    add('overdue', overdue.length, keysOf(overdue));
    add('confirm', pendRows.length, keysOf(pendRows, 'from_request'));
    add('finding', finding.reduce((s, it) => s + needMore(it), 0), keysOf(finding));
    add('talking', talking.length, keysOf(talking));
    add('past', late.length, keysOf(late));

    let next = todo[0];
    if (!next) {
        const left = direct.filter(it => stOf(it) !== DELIVERED);
        if (!direct.length) next = { code: 'empty', n: 0, keys: [] };
        else if (!left.length) next = { code: 'close', n: direct.length, keys: [] };
        else if (left.every(it => stOf(it) === SHOT)) next = { code: 'deliver', n: left.length, keys: keysOf(left) };
        else {
            const dates = left.map(it => it.use_date).filter(Boolean).map(String).filter(d => !today || d >= today).sort();
            next = { code: 'ready', n: left.length, keys: [], date: dates[0] || null };
        }
    }
    return { people, money, todo, next };
}

// ประโยคของเรื่องที่ต้องทำ (บรรทัด "ถัดไป:" ของการ์ดงาน / กล่อง "ต้องทำในงานนี้")
// target บอกว่าปุ่มควรพาไปไหน: 'request' = เปิดใบขอให้หา (keys[0]) · 'people' = ดูรายชื่อคนในงาน · 'job' = เปิดหน้างาน
const d_m = d => { const [, m, dd] = String(d || '').split('-'); return m && dd ? `${Number(dd)}/${Number(m)}` : ''; };
export function todoText(item, people = {}) {
    const n = (item && item.n) || 0;
    switch (item && item.code) {
        case 'fee': return { text: `${T.newFee}รอตัดสิน ${n} คน`, button: 'ตัดสินค่าตัว', target: 'request', urgent: true };
        case 'decide': return { text: `มี ${n} ชื่อรอเลือก`, button: 'ดูรายชื่อแล้วเลือก', target: 'request', urgent: true };
        case 'assign': return { text: `ยังไม่มี${T.finder} ${n} ใบ`, button: `เลือก${T.finder}`, target: 'request', urgent: true };
        case 'overdue': return { text: `เลยกำหนดส่งรายชื่อ ${n} ใบ`, button: 'เปิดใบ', target: 'request', urgent: true };
        case 'confirm': return { text: `รอ${T.confirmQueue} ${n} คน`, button: 'เปิดใบ', target: 'request' };
        case 'finding': return { text: `กำลังหาอีก ${n} คน`, button: 'เปิดใบ', target: 'request' };
        case 'talking': return {
            text: `${T.talking} ${n} คน` + (people.no_fee ? ` · ยังไม่ใส่ค่าตัว ${people.no_fee} คน` : ''),
            button: 'ดูคน', target: 'people'
        };
        case 'past': return { text: `เลยวันงานแล้ว ${n} คน — ถ่ายเสร็จหรือยัง?`, button: 'อัปเดตสถานะ', target: 'people', urgent: true };
        case 'deliver': return { text: `ถ่ายเสร็จแล้ว รอส่งงาน ${n} คน`, button: 'ดูคน', target: 'people' };
        case 'close': return { text: 'ส่งงานครบแล้ว ปิดงานได้', button: 'ปิดงาน', target: 'close' };
        case 'ready': return { text: `ได้ครบแล้ว${item.date ? ` · รอวันงาน ${d_m(item.date)}` : ''}`, button: 'เปิดงาน', target: 'job' };
        case 'empty': return { text: 'ยังไม่มีคนในงานนี้', button: 'เพิ่มคน', target: 'add' };
        case 'closed': return { text: 'งานปิดแล้ว', button: 'เปิดงาน', target: 'job' };
        default: return { text: '', button: 'เปิดงาน', target: 'job' };
    }
}

// เงิน 3 ก้อนเป็นบรรทัดเดียว (ก้อนที่เป็น 0 ไม่ต้องโชว์ ยกเว้นทั้งงานเป็น 0)
export function moneyLine(money) {
    const m = money || {};
    const parts = [
        m.agreed ? `${T.agreed} ${baht(m.agreed)}` : '',
        m.pending ? `${T.pending} ${baht(m.pending)}` : '',
        m.unfilled ? `${T.reserved} ${baht(m.unfilled)}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'ยังไม่มีค่าใช้จ่าย';
}

// ===== ขั้นของคนหนึ่งคน (แถวในงาน) =====
// เส้นทางปกติ: กำลังคุย › ตกลงแล้ว › ถ่ายเสร็จ › ส่งงานแล้ว (ค่าในฐาน ทาบทาม / ตกลงแล้ว / ถ่ายเสร็จ / ส่งงานแล้ว)
export const PERSON_STEPS = [TALKING, AGREED, SHOT, DELIVERED];
export const PERSON_STEP_LABEL = { [TALKING]: T.talking, [AGREED]: T.agreed, [SHOT]: 'ถ่ายเสร็จ', [DELIVERED]: 'ส่งงานแล้ว' };
// ค่าที่ไม่รู้จัก (ข้อมูลเก่า) ถือเป็นกำลังคุย
export const personStep = it => (PERSON_STEPS.includes(stOf(it)) ? stOf(it) : TALKING);
export const personBooking = it => bookingOpen(it);
// ปุ่ม "ถัดไป" ของคนนี้: null = ไม่มี (ส่งงานแล้ว) · locked = รอยืนยันคิวในใบ (เปลี่ยนตรงนี้ไม่ได้)
// needFee = จะไปตกลงแล้วแต่ยังไม่มีค่าตัว → ต้องเปิดลิ้นชักใส่ค่าตัวก่อน
export function personNext(it) {
    if (bookingOpen(it)) return { locked: true, label: bookingState(it) === BOOK_FEE ? `รอตัดสิน${T.newFee}ในใบ` : `รอ${T.confirmQueue}ในใบ` };
    const cur = personStep(it);
    const i = PERSON_STEPS.indexOf(cur);
    if (i >= PERSON_STEPS.length - 1) return null;
    const to = PERSON_STEPS[i + 1];
    if (to === AGREED && !((Number(it && it.fee) || 0) > 0)) return { status: to, needFee: true, label: 'ใส่ค่าตัวแล้วตกลง' };
    const label = to === AGREED ? `ถัดไป: ${T.agreed}` : to === SHOT ? 'ถัดไป: ถ่ายเสร็จแล้ว' : 'ถัดไป: ส่งงานแล้ว';
    return { status: to, label };
}
// กลุ่มของชิปกรองในหน้างาน: ยังไม่ตกลง / ตกลงแล้ว / เสร็จแล้ว
export function personGroup(it) {
    if (bookingOpen(it)) return 'pending';
    const s = personStep(it);
    if (s === TALKING) return 'pending';
    if (s === AGREED) return 'agreed';
    return 'done';
}
export const PERSON_GROUPS = [
    { key: '', label: 'ทุกคน' },
    { key: 'pending', label: 'ยังไม่ตกลง' },
    { key: 'agreed', label: T.agreed },
    { key: 'done', label: 'เสร็จแล้ว' }
];
