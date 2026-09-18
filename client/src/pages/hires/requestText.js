// ประโยคของใบขอให้หา (แถวจาก GET /hires/tasks) — แยกจาก JSX ให้ไล่ตรรกะ "ถึงตาใคร" ได้ในที่เดียว
// ไฟล์นี้ต้องเป็น JS ล้วน (ไม่มี JSX / window) — หน้าหลัก ลิ้นชัก และตารางใบขอให้หาใช้ชุดเดียวกัน ข้อความจะได้ไม่ขัดกัน
import { T, baht } from '../../data/talentLabels.js';

const str = v => (v == null ? '' : String(v).trim());
const num = v => Number(v) || 0;
const kindOf = r => str(r && r.kind) || 'คน';
// ประเภทงานที่เป็นคำอังกฤษ (Live สด / Event) ต้องเว้นวรรคคั่นคำไทย ไม่งั้นอ่านติดกัน เช่น "หาLive สดอีก"
const kindIn = r => { const k = kindOf(r); return (/^[A-Za-z0-9]/.test(k) ? ' ' : '') + k + (/[A-Za-z0-9]$/.test(k) ? ' ' : ''); };
const noFinder = r => !r || r.assignee_id == null || r.assignee_id === '';
const finderName = r => str(r && r.assignee_name) || T.finder;

// '2026-09-25' → '25/9/26' (แบบเดียวกับตารางเดิมของแท็บ)
export function fmtD(d) {
    if (!d) return '';
    const [y, m, dd] = String(d).slice(0, 10).split('-');
    if (!y || !m || !dd) return String(d);
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
}

export const bookingsOf = r => (Array.isArray(r && r.bookings) ? r.bookings : []);
export const bookingStateOf = b => (b && b.booking && b.booking.state) || null;
export const candsOf = r => (Array.isArray(r && r.candidates) ? r.candidates : []);

// "ขอโดยคุณ" เมื่อคนขอคือคนที่ดูอยู่ — เห็นชื่อบัญชีตัวเองแล้วงงว่าใคร (ทีมใช้บัญชีร่วมกันก็เห็นเป็นคุณเหมือนกัน)
export function requesterText(row, userId) {
    const r = row || {};
    if (r.requested_by_id != null && userId != null && String(r.requested_by_id) === String(userId)) return 'ขอโดยคุณ';
    return str(r.requested_by_name) ? `ขอโดย ${str(r.requested_by_name)}` : '';
}

// เหตุผลที่ server เก็บตอนกด "คนนี้มาไม่ได้" ยังเป็นคำเก่า ('คิวไม่ว่าง: …' — มีเทสต์ล็อกไว้) → แปลงเฉพาะตอนแสดง
// คนที่คนช่วยหากด "คนนี้มาไม่ได้" ถูกเก็บเป็น status 'ไม่เอา' + note 'คิวไม่ว่าง…' — แยกออกจากคนที่ทีมไม่เอาจริง
export const isUnavailNote = note => /^คิวไม่ว่าง(\s*:|\s*$)/.test(String(note == null ? '' : note));
export const shownNote = note => String(note == null ? '' : note).replace(/^คิวไม่ว่าง(?=\s*:|\s*$)/, 'มาไม่ได้');

// ใบที่ทีมแบรนด์ต้องทำ แต่ไม่ได้นับเป็นตาของเรา (เราไม่ใช่คนขอ) — คนในแบรนด์เดียวกันช่วยกดแทนได้
// (ทีมใช้บัญชีร่วมกัน / คนขอลา) ต้องตรงกับหัวข้อ "รอทีมแบรนด์ คุณช่วยได้" ในหน้าหลัก
export function teamCanHelp(row) {
    const r = row || {};
    return !!(r.in_brand && !r.my_todo && r.stage !== 'closed'
        && (['team', 'assign'].includes(r.waiting_on) || num(r.fee_review) > 0 || (num(r.booking_pending) > 0 && noFinder(r))));
}

// ประโยค "ตอนนี้รออะไร" แบบคนนอกมอง (ไม่มีคำว่า "คุณ") — ใช้ในรายการบรรทัดเดียว
export function waitingSentence(row) {
    const r = row || {};
    const k = kindIn(r);
    const pending = num(r.booking_pending);
    const feeReview = num(r.fee_review);
    let main;
    switch (r.stage) {
        case 'closed':
            main = pending + feeReview > 0 ? `งานปิดแล้ว · ยังค้าง${T.confirmQueue} / ค่าตัวใหม่ ${pending + feeReview} คน` : 'งานปิดแล้ว';
            break;
        case 'full':
            main = 'ได้ครบแล้ว';
            break;
        case 'fee':
            main = `รอทีมแบรนด์ตัดสินค่าตัวใหม่ ${feeReview} คน`;
            break;
        case 'booking':
            main = noFinder(r)
                ? `รอทีมแบรนด์${T.confirmQueue} ${pending} คน (ใบนี้ไม่มี${T.finder})`
                : `รอ ${finderName(r)} ${T.confirmQueue} ${pending} คน`;
            break;
        case 'deciding':
            main = `รอทีมแบรนด์เลือกจาก ${num(r.waiting_count)} ชื่อ`
                + (num(r.need_more) > 0 ? ` · ${noFinder(r) ? 'ยัง' : finderName(r) + ' ยัง'}ต้องหาอีก ${num(r.need_more)} คน` : '');
            break;
        case 'unassigned':
            main = `รอทีมแบรนด์เลือก${T.finder} (หา${k} ${num(r.remaining)} คน)`;
            break;
        case 'finding':
            main = `รอ ${finderName(r)} หา${k}อีก ${num(r.need_more)} คน`
                + (r.deadline ? ` · ส่งรายชื่อภายใน ${fmtD(r.deadline)}` : '');
            break;
        default:
            main = '';
    }
    // ใบที่ยังขาดคน แต่มีคนที่เลือกแล้วค้างขั้นยืนยันอยู่ด้วย — บอกไว้ไม่ให้หลุดสายตา
    const side = !['booking', 'fee', 'closed'].includes(r.stage)
        ? [pending ? `รอ${T.confirmQueue} ${pending} คน` : '', feeReview ? `รอตัดสินค่าตัวใหม่ ${feeReview} คน` : ''].filter(Boolean)
        : [];
    return [main, ...side].filter(Boolean).join(' · ');
}

// บรรทัดบนสุดของลิ้นชัก — พูดกับผู้ใช้ตรง ๆ ว่าถึงตาใคร (อ่านจาก todo ที่ server คิดให้ = ตรงกับเลขแดง)
// → { mine, text } เช่น 'ถึงตาคุณ: เลือกจาก 3 ชื่อ' / 'รอ มิ้นท์ หาอีก 2 คน — ตอนนี้ไม่ต้องทำอะไร'
export function turnText(row) {
    const r = row || {};
    const todo = Array.isArray(r.todo) ? r.todo : [];
    if (todo.length) {
        const parts = [];
        if (todo.includes('fee')) parts.push(`ตัดสินค่าตัวใหม่ ${num(r.fee_review)} คน`);
        if (todo.includes('decide')) parts.push(`เลือกจาก ${num(r.waiting_count)} ชื่อ`);
        if (todo.includes('confirm')) parts.push(`${T.confirmQueue} ${num(r.booking_pending)} คน`);
        if (todo.includes('find')) parts.push(`หา${kindIn(r)}อีก ${num(r.need_more)} คน`);
        if (todo.includes('assign')) parts.push(`เลือก${T.finder}`);
        if (parts.length) return { mine: true, text: 'ถึงตาคุณ: ' + parts.join(' · ') };
    }
    const wait = waitingSentence(r) || 'ยังไม่มีอะไรต้องทำ';
    if (teamCanHelp(r)) return { mine: false, text: wait + ' — คุณช่วยได้' };
    if (r.stage === 'closed' || r.stage === 'full') return { mine: false, text: wait };
    return { mine: false, text: wait + ' — ตอนนี้ไม่ต้องทำอะไร' };
}

// คอลัมน์ "รอใคร" ของตารางใบขอให้หา (สั้น) — เป็นเราเองเขียนว่า "คุณ" จะได้เห็นทันทีว่าต้องทำอะไร
export function whoShort(row) {
    const r = row || {};
    const todo = Array.isArray(r.todo) ? r.todo : [];
    if (todo.includes('fee')) return `คุณ · ตัดสินค่าตัวใหม่ ${num(r.fee_review)} คน`;
    if (todo.includes('confirm') && !todo.includes('find')) return `คุณ · ${T.confirmQueue} ${num(r.booking_pending)} คน`;
    if (r.stage === 'deciding' && todo.includes('find')) return `คุณ · หาเพิ่มอีก ${num(r.need_more)} คน`;
    if (r.stage === 'booking') {
        // ใบที่ไม่มีคนช่วยหา → ทีมแบรนด์ (คนขอ) ยืนยันคิวเอง
        const who = r.is_assignee || (noFinder(r) && r.is_requester) ? 'คุณ' : noFinder(r) ? 'ทีมแบรนด์' : finderName(r);
        return `${who} · ${T.confirmQueue}`;
    }
    if (r.stage === 'fee') return 'ทีมแบรนด์ · ตัดสินค่าตัวใหม่';
    if (r.waiting_on === 'assign') return `${r.is_requester ? 'คุณ' : 'ทีมแบรนด์'} · เลือก${T.finder}`;
    if (r.waiting_on === 'finder') return r.is_assignee ? 'คุณ · หาคน' : `${finderName(r)} · หาคน`;
    if (r.waiting_on === 'team') return `${r.is_requester ? 'คุณ' : 'ทีมแบรนด์'} · เลือกชื่อ`;
    return '—';
}

// คำอธิบายเลขแดง (ชุดคำเดียวกับป้ายบนเมนู)
export function countsTip(counts) {
    const c = counts || {};
    return [
        c.to_find ? `หาคน ${c.to_find}` : '',
        c.to_decide ? `เลือกชื่อ ${c.to_decide}` : '',
        c.to_assign ? `เลือก${T.finder} ${c.to_assign}` : '',
        c.to_confirm ? `${T.confirmQueue} ${c.to_confirm}` : '',
        c.to_fee ? `ตัดสินค่าตัวใหม่ ${c.to_fee}` : ''
    ].filter(Boolean).join(' · ');
}

// ===== การ์ด "รอคุณทำ" ของหน้าหลัก =====
// 1 การ์ด = 1 เรื่อง: ค่าตัวใหม่ / ยืนยันคิว แยกการ์ดรายคน (กดจบในการ์ดได้) · เลือกชื่อ / หาคน / เลือกคนช่วยหา การ์ดละใบ
// เรียง: ใบที่เลยกำหนดก่อน → ค่าตัวใหม่ → เลือกชื่อ → ยืนยันคิว → หาคน → เลือกคนช่วยหา (ลำดับเดิมของ server ในกลุ่มเดียวกัน)
export const TODO_ORDER = ['fee', 'decide', 'confirm', 'find', 'assign'];
const BOOK_OF = { fee: 'fee_review', confirm: 'pending' };

export function todoCards(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((row, i) => {
        if (!row || !row.my_todo) return;
        const base = `${row.project_id}~${row.key}`;
        const todo = Array.isArray(row.todo) ? row.todo : [];
        TODO_ORDER.filter(t => todo.includes(t)).forEach(type => {
            if (BOOK_OF[type]) {
                const list = bookingsOf(row).filter(b => bookingStateOf(b) === BOOK_OF[type]);
                list.forEach((b, j) => out.push({ id: `${base}~${type}~${b.key}`, type, row, booking: b, overdue: !!row.overdue, seq: i * 1000 + j }));
                // server บอกว่าถึงตาแต่หาแถวคนไม่เจอ (ข้อมูลเก่า) — ยังต้องมีการ์ดให้เปิดใบไปดู ไม่ให้งานหายเงียบ
                if (!list.length) out.push({ id: `${base}~${type}`, type, row, booking: null, overdue: !!row.overdue, seq: i * 1000 });
            } else {
                out.push({ id: `${base}~${type}`, type, row, booking: null, overdue: !!row.overdue, seq: i * 1000 });
            }
        });
    });
    return out.sort((a, b) => (a.overdue ? 0 : 1) - (b.overdue ? 0 : 1)
        || TODO_ORDER.indexOf(a.type) - TODO_ORDER.indexOf(b.type)
        || a.seq - b.seq);
}

// บรรทัดหัวการ์ด (ตัวหนา ขึ้นต้นด้วยคำกริยา) + บรรทัดรายละเอียด
export function todoTitle(card) {
    const r = card.row || {};
    const b = card.booking;
    const bk = (b && b.booking) || {};
    switch (card.type) {
        case 'fee':
            return b ? `${str(b.name) || 'คนที่เลือก'} ขอค่าตัว ${baht(bk.requested_fee)}` : `ตัดสินค่าตัวใหม่ ${num(r.fee_review)} คน`;
        case 'decide':
            return `เลือก${kindIn(r)}จาก ${num(r.waiting_count)} ชื่อที่ส่งมา`;
        case 'confirm':
            return b ? `${T.confirmQueue} ${str(b.name) || 'คนที่เลือก'}` : `${T.confirmQueue} ${num(r.booking_pending)} คน`;
        case 'find':
            return `หา${kindIn(r)}อีก ${num(r.need_more)} คน`;
        case 'assign':
            return `เลือก${T.finder} (หา${kindIn(r)} ${num(r.remaining)} คน)`;
        default:
            return '';
    }
}

export function todoMeta(card) {
    const r = card.row || {};
    const b = card.booking;
    if (card.type === 'confirm' && b) {
        return [fmtD(b.use_date || r.use_date), str(b.place || r.place), Number(b.fee) > 0 ? baht(b.fee) : 'ยังไม่มีค่าตัว'].filter(Boolean).join(' · ');
    }
    if (card.type === 'find') {
        return [`งบ ${baht(r.fee)}/คน`, r.use_date ? `ใช้งาน ${fmtD(r.use_date)}` : '', r.deadline ? `ส่งรายชื่อภายใน ${fmtD(r.deadline)}` : '']
            .filter(Boolean).join(' · ');
    }
    return '';
}
