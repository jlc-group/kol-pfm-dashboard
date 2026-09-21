/**
 * ตรรกะบริสุทธิ์ (pure logic) ที่ใช้ร่วมกันระหว่าง jsonStore และ pgStore
 *
 * ฟังก์ชันในไฟล์นี้ไม่แตะที่เก็บข้อมูลเลย — รับ object เข้ามาแล้วคำนวณอย่างเดียว
 * แยกออกมาไว้ที่เดียวเพื่อให้สองไดรเวอร์ใช้ตรรกะชุดเดียวกันเป๊ะ
 * ถ้าปล่อยให้ต่างคนต่างถือสำเนา วันหนึ่งจะคำนวณไม่ตรงกันโดยไม่มีใครรู้
 */

// เกณฑ์ตัดสินว่า KOL คนนี้ "คุ้มค่า" ไหม — ใช้ที่หน้า Report และ Influencer
const GOOD_CPM = 28;
const GOOD_CPE = 1.5;

// Platform ที่มีเป้าหมาย (target) ระดับกลุ่ม
const TARGET_PLATFORMS = ['TikTok'];
// Platform ที่ใช้ช่อง Campaign — ต้องตรงกับ CAMPAIGN_PLATFORMS ฝั่งหน้าเว็บ (client/src/data/adGroups.js)
// TikTok: VDO View / Reach / Consideration Ads · Facebook / Instagram: Awareness / Engagement / Reels
const CAMPAIGN_PLATFORMS = ['TikTok', 'Facebook', 'Instagram'];
// Platform ที่ Campaign คือตัวแยกชุด (แทน Content Type) — ฟอร์มเก็บค่าเดียวกันไว้ทั้ง campaign และ content_type
// ต้องตรงกับ CAMPAIGN_AS_CTYPE / SOCIAL_CAMPAIGNS ฝั่งหน้าเว็บ (client/src/data/adGroups.js)
const CAMPAIGN_AS_CTYPE = ['Facebook', 'Instagram'];
const SOCIAL_CAMPAIGNS = ['Awareness', 'Engagement', 'Reels'];

// ค่าแอดขั้นต่ำที่ถือว่า "ยิงจริงจังแล้ว" — ถึงเกณฑ์นี้ระบบจึงล็อกผลตัดสินคุ้ม/ไม่คุ้ม
// (ต่ำกว่านี้ตัวเลขยังแกว่ง ตัดสินไปก็ไม่มีความหมาย)
const AD_STAMP_AT = 10000;

const now = () => new Date().toISOString();
const clone = (v) => (v === undefined ? undefined : structuredClone(v));


// จำลอง error รหัส '23505' (unique violation) ให้ route จัดการเหมือน PostgreSQL
function duplicateError(msg) {
    const e = new Error(msg || 'duplicate key value violates unique constraint');
    e.code = '23505';
    return e;
}

// ===== ตัวกรองสิทธิ์กลาง =====
// scope = null/undefined  -> เห็นทุกแบรนด์ (admin / manager)
// scope = []              -> ยังไม่ได้รับแบรนด์ = ไม่เห็นอะไรเลย
// scope = [ชื่อแบรนด์...]  -> เห็นเฉพาะแคมเปญของแบรนด์นั้น
// เขียนไว้ที่เดียวเพราะเดิมเงื่อนไขนี้ถูกก็อปไว้ 17 จุด พลาดจุดเดียว = ข้อมูลข้ามแบรนด์หลุด
function inScope(project, scope) {
    if (!Array.isArray(scope)) return true;
    return scope.includes(project && project.brand);
}

function scopeProjects(list, scope) {
    if (!Array.isArray(scope)) return list;
    return list.filter(p => scope.includes(p.brand));
}

// ===== งบของรายการจ้าง (แคมเปญงานจ้างอื่น ๆ) =====
// แถว "ระบุคนเอง" = ค่าตัวของคนนั้น · ใบขอจัดหา = งบต่อคน × จำนวนคนที่ "ยังต้องหา"
// คนที่หาได้แล้วจะถูกย้ายออกไปเป็นแถวของตัวเอง ถ้ายังนับซ้ำในใบขอจัดหา งบจะบวกสองรอบ
// ต้องตรงกับ rowFee ฝั่งหน้าเว็บ (client/src/components/OtherProjectForm.jsx) เป๊ะ ๆ
function hireRemaining(it) {
    if (!it || it.mode !== 'casting') return 0;
    return Math.max(0, (Number(it.headcount) || 1) - (Number(it.filled) || 0));
}

function hireRowFee(it) {
    if (!it) return 0;
    const fee = Number(it.fee) || 0;
    return it.mode === 'casting' ? fee * hireRemaining(it) : fee;
}

// ===== ขั้นตอนของใบขอจัดหา (คิดจากข้อมูลที่มีตอนอ่าน ไม่เก็บลงฐาน) =====
// ต้องตรงกับ hireWaiting / hireNeedMore / hireStage ฝั่งหน้าเว็บ (client/src/components/OtherProjectForm.jsx)
const HIRE_JOB_CLOSED = ['Completed', 'Cancelled'];
// ชื่อที่เสนอมาแล้ว "รอทีมอนุมัติ" (เก็บในฐานเป็น 'เสนอ' — แถวเก่าที่ไม่มีสถานะถือเป็นรออนุมัติ)
function hireWaiting(it) {
    if (!it || it.mode !== 'casting') return 0;
    return (Array.isArray(it.candidates) ? it.candidates : [])
        .filter(c => c && (String(c.status || '').trim() || 'เสนอ') === 'เสนอ').length;
}
// คนหายังต้องหาเพิ่มอีกกี่คน — ชื่อที่รออนุมัติอยู่นับว่า "หามาให้แล้ว" จนกว่าทีมจะกดไม่ผ่าน
function hireNeedMore(it) {
    return Math.max(0, hireRemaining(it) - hireWaiting(it));
}
// ===== ขั้นคอนเฟิร์มคิว — คนที่ทีมอนุมัติจากใบขอจัดหา ยังไม่ถือว่า "ตกลงแล้ว" จนกว่าคนหาคอนเฟิร์มคิว/ค่าตัวจริง =====
// เก็บไว้ในแถวผู้รับงานเอง (hire_items[].booking) ไม่ต้องเพิ่มคอลัมน์ · แถวเก่าที่ไม่มี booking ถือว่าคอนเฟิร์มแล้ว
const BOOK_PENDING = 'pending';     // รอคนหาคอนเฟิร์มคิว
const BOOK_FEE = 'fee_review';      // คนหาคอนเฟิร์มแล้วแต่ค่าตัวจริงสูงกว่าที่อนุมัติ → รอทีมอนุมัติค่าตัวใหม่
const BOOK_OK = 'confirmed';
const HIRE_BOOKED = 'ทาบทาม';
const HIRE_AGREED = 'ตกลงแล้ว';
const bookingState = it => (it && it.booking && it.booking.state) || null;
const bookingOpen = it => bookingState(it) === BOOK_PENDING || bookingState(it) === BOOK_FEE;
// คนที่ได้จากใบนี้และยังค้างขั้นคอนเฟิร์ม (items = hire_items ทั้งงาน)
function hireBookings(items, key) {
    const rows = (Array.isArray(items) ? items : []).filter(it => it && it.mode !== 'casting'
        && it.from_request != null && key != null && String(it.from_request) === String(key) && bookingOpen(it));
    return {
        rows,
        pending: rows.filter(r => bookingState(r) === BOOK_PENDING).length,
        fee_review: rows.filter(r => bookingState(r) === BOOK_FEE).length
    };
}

// closed = งานเสร็จ/ยกเลิกแล้ว · fee = ได้ครบแต่มีค่าตัวใหม่รอทีมอนุมัติ · booking = ได้ครบแต่ยังรอคนหาคอนเฟิร์มคิว
// full = ได้ครบ · deciding = มีชื่อรออนุมัติ · unassigned = ยังไม่มีคนหา · finding = คนหากำลังหา
// items (ไม่บังคับ) = hire_items ทั้งงาน ใช้ดูว่าคนที่ได้จากใบนี้คอนเฟิร์มครบหรือยัง
function hireStage(it, jobStatus, items) {
    if (HIRE_JOB_CLOSED.includes(jobStatus)) return 'closed';
    if (hireRemaining(it) <= 0) {
        const b = hireBookings(items, it && it.key);
        if (b.fee_review > 0) return 'fee';
        if (b.pending > 0) return 'booking';
        return 'full';
    }
    if (hireWaiting(it) > 0) return 'deciding';
    if (!it || it.assignee_id === null || it.assignee_id === undefined || it.assignee_id === '') return 'unassigned';
    return 'finding';
}

// ===== ค่าแอดของโพสต์มาจากระบบ PFM อัตโนมัติไหม =====
// PFM ซิงก์ค่าแอดให้โพสต์ที่มี ID Post เป็นตัวเลข (TikTok) และซิงก์ได้ทางเดียว (ขึ้นอย่างเดียว)
// ถ้าให้กรอกทับ ยอดที่กรอกเกินจริงจะค้างถาวร และถ้ากรอกต่ำกว่า ซิงก์รอบหน้าจะเขียนทับกลับ — โพสต์พวกนี้จึงให้ PFM ดูแลอย่างเดียว
function pfmManagedSpend(s) {
    return !!(s && (s.ad_synced_at || /^\d{1,50}$/.test(String(s.id_post || '').trim())));
}

// ===== สถานะ "ยิงแล้ว" ที่ใช้แสดงผล =====
// ad_status เป็นค่าที่คนกดเอง แต่ค่าแอดซิงก์มาจาก PFM อัตโนมัติ — พอไม่มีใครกด
// แถวที่เงินเดินไปแล้วจึงค้างเป็น "ยังไม่ยิง" ทั้งที่แอดวิ่งจริง (การ์ดข้างบนเลยขึ้น 0/93)
// มีค่าแอด = แอดวิ่งแล้วแน่นอน จึงนับว่ายิงแล้วตอนโชว์และตอนสรุป
//
// ใช้ได้เฉพาะ "แสดงผล/นับ" เท่านั้น ห้ามเขียนลงฐานและห้ามเอาไปตัดสินสิทธิ์แก้ข้อมูล:
// การล็อก post_url/gencode/id_post, guard ตอน PUT และฟีด content export
// ยังต้องยึด ad_status ที่คนกดจริง ไม่งั้นค่าแอดที่ซิงก์เข้ามาเองจะไปล็อก
// แถวที่ทีมยังแก้ข้อมูลไม่เสร็จ และจะดึงคลิปหายออกจากฟีดของ beauterry
function adRanBySpend(s) {
    return (Number(s && s.ad_spend) || 0) > 0;
}
function effectiveAdStatus(s) {
    return ((s && s.ad_status === 'ยิงแล้ว') || adRanBySpend(s)) ? 'ยิงแล้ว' : 'ยังไม่ยิง';
}

// ===== งบของงานจ้างอื่น ๆ แยกตามความคืบหน้า (หน้ารอบทำจ่าย) =====
// งบของงาน = ผลรวมทุกแถว แต่ไม่ใช่ทั้งก้อนที่ "จ่ายได้" — ต้องแยกให้แอดมินเห็นก่อนตั้งงวด
//  agreed   = ตกลงแล้ว / ถ่ายเสร็จ / ส่งงานแล้ว (จ่ายได้จริง)
//  pending  = ยังทาบทาม หรือยังค้างคอนเฟิร์มคิว / ค่าตัวใหม่ (ยังไม่แน่นอน)
//  unfilled = งบของใบขอจัดหาที่ยังหาคนไม่ได้ (ยังไม่มีคนให้จ่าย)
const HIRE_PAYABLE = ['ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'];
function hireBreakdown(items) {
    const out = { agreed: 0, pending: 0, unfilled: 0 };
    (Array.isArray(items) ? items : []).forEach(it => {
        if (!it) return;
        const fee = hireRowFee(it);
        if (it.mode === 'casting') { out.unfilled += fee; return; }
        if (!bookingOpen(it) && HIRE_PAYABLE.includes(String(it.status || '').trim())) out.agreed += fee;
        else out.pending += fee;
    });
    return out;
}

// ===== ความคืบหน้าของงาน Talent ทั้งงาน (การ์ดงาน / หน้างาน) — คิดตอนอ่าน ไม่เก็บลงฐาน =====
// ต้องตรงกับ jobProgress ฝั่งหน้าเว็บ (client/src/data/hireProgress.js) — เทสต์เทียบผลสองฝั่ง (tests/talent-r2-parity.test.cjs)
// people นับเป็น "ตำแหน่ง": แถวคน 1 แถว = 1 ตำแหน่ง · ใบขอให้หาที่ยังขาดคน = ตำแหน่งที่ยังต้องหา (need)
//   talking = กำลังคุย (ยังไม่ตกลง) · booking = เลือกจากใบแล้วรอยืนยันคิว / ค่าตัวใหม่ · agreed / shot / delivered = ตกลงแล้ว / ถ่ายเสร็จ / ส่งงานแล้ว
// money = hireBreakdown (ชุดเดียวกับหน้ารอบทำจ่าย)
// todo = เรื่องที่ค้างในงานนี้ เรียงตามความสำคัญ (keys = ใบขอให้หา / แถวคนที่เกี่ยว ไว้เปิดต่อ) · next = เรื่องแรก หรือสถานะเมื่อไม่มีอะไรค้าง
// today = 'YYYY-MM-DD' ตามเวลาไทย (ไม่ส่ง = ไม่เช็คเลยกำหนด / เลยวันงาน)
const HIRE_TALK = 'ทาบทาม';
const noAssignee = it => !it || it.assignee_id === null || it.assignee_id === undefined || it.assignee_id === '';
function jobProgress(items, jobStatus, today) {
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    const closed = HIRE_JOB_CLOSED.includes(jobStatus);
    const st = it => String(it.status || '').trim();
    const direct = list.filter(it => it.mode !== 'casting');
    const requests = list.filter(it => it.mode === 'casting');
    const people = { total: 0, talking: 0, no_fee: 0, booking: 0, agreed: 0, shot: 0, delivered: 0, need: 0 };
    direct.forEach(it => {
        if (bookingOpen(it)) people.booking += 1;
        else if (st(it) === 'ส่งงานแล้ว') people.delivered += 1;
        else if (st(it) === 'ถ่ายเสร็จ') people.shot += 1;
        else if (st(it) === HIRE_AGREED) people.agreed += 1;
        else { people.talking += 1; if (!((Number(it.fee) || 0) > 0)) people.no_fee += 1; }
    });
    // งานที่ปิดแล้วไม่มีใครต้องหาต่อ (ตรงกับ hireStage = closed)
    const open = closed ? [] : requests.filter(it => hireRemaining(it) > 0);
    people.need = open.reduce((s, it) => s + hireRemaining(it), 0);
    people.total = direct.length + people.need;
    const money = hireBreakdown(list);
    if (closed) return { people, money, todo: [], next: { code: 'closed', n: 0, keys: [] } };

    const todo = [];
    const keysOf = (rows, field = 'key') => [...new Set(rows.map(it => String(it[field])))];
    const add = (code, n, keys) => { if (n > 0) todo.push({ code, n, keys }); };
    const fromReq = it => it.from_request !== null && it.from_request !== undefined;
    const feeRows = direct.filter(it => fromReq(it) && bookingState(it) === BOOK_FEE);
    const pendRows = direct.filter(it => fromReq(it) && bookingState(it) === BOOK_PENDING);
    const deciding = open.filter(it => hireWaiting(it) > 0);
    const unassigned = open.filter(it => hireWaiting(it) === 0 && noAssignee(it));
    const overdue = today ? open.filter(it => it.deadline && hireNeedMore(it) > 0 && String(it.deadline) < today) : [];
    const finding = open.filter(it => hireNeedMore(it) > 0 && !noAssignee(it));
    const talking = direct.filter(it => !bookingOpen(it) && ![HIRE_AGREED, 'ถ่ายเสร็จ', 'ส่งงานแล้ว'].includes(st(it)));
    // ตกลงแล้วแต่เลยวันงานไปแล้ว — ถ่ายเสร็จหรือยัง (หน้ารอบทำจ่ายหยิบยอดตามสถานะ)
    const late = today ? direct.filter(it => !bookingOpen(it) && st(it) === HIRE_AGREED && it.use_date && String(it.use_date) < today) : [];
    add('fee', feeRows.length, keysOf(feeRows, 'from_request'));
    add('decide', deciding.reduce((s, it) => s + hireWaiting(it), 0), keysOf(deciding));
    add('assign', unassigned.length, keysOf(unassigned));
    add('overdue', overdue.length, keysOf(overdue));
    add('confirm', pendRows.length, keysOf(pendRows, 'from_request'));
    add('finding', finding.reduce((s, it) => s + hireNeedMore(it), 0), keysOf(finding));
    add('talking', talking.length, keysOf(talking));
    add('past', late.length, keysOf(late));

    let next = todo[0];
    if (!next) {
        const left = direct.filter(it => st(it) !== 'ส่งงานแล้ว');
        if (!direct.length) next = { code: 'empty', n: 0, keys: [] };
        else if (!left.length) next = { code: 'close', n: direct.length, keys: [] };
        else if (left.every(it => st(it) === 'ถ่ายเสร็จ')) next = { code: 'deliver', n: left.length, keys: keysOf(left) };
        else {
            // ครบแล้ว รอวันงาน — บอกวันงานถัดไปที่ยังไม่ถึง
            const dates = left.map(it => it.use_date).filter(Boolean).map(String).filter(d => !today || d >= today).sort();
            next = { code: 'ready', n: left.length, keys: [], date: dates[0] || null };
        }
    }
    return { people, money, todo, next };
}

// ----- การเปลี่ยนขั้นคอนเฟิร์มคิว (ฟังก์ชันบริสุทธิ์: รับ hire_items ทั้งงาน คืน { list, row } หรือ { error }) -----
const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clipText = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; };

function bookingTarget(list, reqKey, rowKey) {
    const arr = Array.isArray(list) ? list : [];
    const req = arr.find(it => it && String(it.key) === String(reqKey));
    if (!req || req.mode !== 'casting') return { error: { code: 404, message: 'ไม่พบใบขอให้หานี้' } };
    const idx = arr.findIndex(it => it && String(it.key) === String(rowKey));
    const row = idx >= 0 ? arr[idx] : null;
    if (!row || row.mode === 'casting' || row.from_request == null || String(row.from_request) !== String(reqKey)) {
        return { error: { code: 404, message: 'ไม่พบคนที่เลือกจากใบขอให้หานี้' } };
    }
    return { arr, req, row, idx };
}

// คืนที่ว่างให้ใบขอจัดหา เมื่อคนที่ได้จากใบนี้หลุดออกจากงาน (คิวไม่ว่าง / ถอนตัว / ทีมลบแถวทิ้ง)
// ใบ: จำนวนที่หาได้ −1 · ชื่อที่เสนอคนนั้น: กลับเป็น "ไม่ผ่าน" พร้อมเหตุผล (ถ้าคิวกลับมาว่าง ทีมกดดึงกลับมาพิจารณาได้)
function releaseToRequest(list, person, { reason = null, actor = null, at = now() } = {}) {
    const arr = Array.isArray(list) ? list : [];
    if (!person || person.from_request == null) return arr;
    return arr.map(it => {
        if (!it || it.mode !== 'casting' || String(it.key) !== String(person.from_request)) return it;
        const cands = Array.isArray(it.candidates) ? it.candidates : [];
        // ผูกด้วย from_candidate (แถวที่อนุมัติหลังมีขั้นนี้) · แถวเก่าใช้ชื่อที่อนุมัติแล้วตรงกัน
        let hitKey = person.from_candidate ? String(person.from_candidate) : null;
        if (!hitKey) {
            const nm = v => String(v || '').trim();
            const fileOf = v => (v && v.image && v.image.filename) || null;
            const picked = cands.filter(c => c && c.status === 'เลือกแล้ว');
            let m = picked.find(c => nm(c.name) === nm(person.name))
                || (fileOf(person) ? picked.find(c => fileOf(c) === fileOf(person)) : null);
            if (!m) {
                // ชื่อถูกแก้ไปแล้ว: ตัดชื่อที่ยังมีคนในงานอ้างอยู่ออก ถ้าเหลือชื่อเดียวก็คือคนนี้ (เหลือหลายชื่อ = ไม่เดา)
                const others = arr.filter(r => r && r.mode !== 'casting' && r.from_request != null && String(r.from_request) === String(it.key));
                const claimed = c => others.some(r => (r.from_candidate && String(r.from_candidate) === String(c.key))
                    || (fileOf(r) && fileOf(r) === fileOf(c)) || nm(r.name) === nm(c.name));
                const free = picked.filter(c => !claimed(c));
                if (free.length === 1) m = free[0];
            }
            hitKey = m ? String(m.key) : null;
        }
        return {
            ...it,
            filled: Math.max(0, (Number(it.filled) || 0) - 1),
            candidates: cands.map(c => (c && hitKey && String(c.key) === hitKey && c.status === 'เลือกแล้ว'
                ? { ...c, status: 'ไม่เอา', decided_by: actor, decided_at: at, decided_note: reason }
                : c))
        };
    });
}

// คนหาคอนเฟิร์มคิว — บันทึกวันที่/เวลา/สถานที่/ติดต่อ/ค่าตัวจริง/โน้ต (ชื่อและสังกัดแก้ไม่ได้)
// ค่าตัวไม่เกินที่อนุมัติ → ตกลงแล้ว (จบงานคนหา) · สูงกว่า → รอทีมอนุมัติค่าตัวใหม่ (งบยังใช้ค่าตัวเดิมจนกว่าทีมอนุมัติ)
function bookingConfirm(list, reqKey, rowKey, body = {}, { actor = null, at = now() } = {}) {
    const t = bookingTarget(list, reqKey, rowKey);
    if (t.error) return t;
    if (bookingState(t.row) !== BOOK_PENDING) {
        return { error: { code: 409, message: 'คนนี้ไม่ได้อยู่ในขั้นรอยืนยันคิวแล้ว — โหลดหน้าใหม่เพื่อดูสถานะล่าสุด' } };
    }
    const b = body && typeof body === 'object' ? body : {};
    const approved = Number(t.row.fee) || 0;
    const asked = cleanFee(b.fee);
    const fee = asked > 0 ? asked : approved;
    // กติกาเดียวกับทั้งระบบ: ไม่มีค่าตัว = ยัง "ตกลงแล้ว" ไม่ได้ — ปุ่มยืนยันคลิกเดียวกับคนที่เลือกมาแบบไม่มีค่าตัว (fee 0)
    // เคยได้ "ตกลงแล้ว ค่าตัว 0" ซึ่งทำให้รอบทำจ่ายนับเป็นคนที่จ่ายได้แต่ไม่มียอด
    if (fee <= 0) return { error: { code: 400, message: 'ใส่ค่าตัวที่ตกลงจริงก่อนยืนยันคิว' } };
    const patch = {
        use_date: b.use_date === undefined ? (t.row.use_date || null) : (isDateStr(b.use_date) ? b.use_date : null),
        use_time: b.use_time === undefined ? (t.row.use_time || null) : clipText(b.use_time, 60),
        place: b.place === undefined ? (t.row.place || null) : clipText(b.place, 200),
        contact: b.contact === undefined ? (t.row.contact || null) : clipText(b.contact, 200),
        note: b.note === undefined ? (t.row.note || null) : clipText(b.note, 500)
    };
    const base = { ...(t.row.booking || {}), confirmed_by: actor, confirmed_at: at };
    const next = fee > approved
        ? { ...t.row, ...patch, status: HIRE_BOOKED,
            booking: { ...base, state: BOOK_FEE, requested_fee: fee, approved_fee: approved } }
        : { ...t.row, ...patch, fee, status: HIRE_AGREED,
            booking: { ...base, state: BOOK_OK, requested_fee: null } };
    const out = t.arr.slice();
    out[t.idx] = next;
    return { list: out, row: next };
}

// ทีมตัดสินค่าตัวใหม่ — อนุมัติ: ใช้ค่าตัวใหม่ + ตกลงแล้ว · ไม่อนุมัติ: กลับไปรอคนหาคอนเฟิร์ม (พร้อมโน้ตของทีม)
function bookingFeeDecision(list, reqKey, rowKey, approve, note, { actor = null, at = now(), expected_fee, expected_confirmed_at } = {}) {
    const t = bookingTarget(list, reqKey, rowKey);
    if (t.error) return t;
    if (bookingState(t.row) !== BOOK_FEE) {
        return { error: { code: 409, message: 'ไม่มีค่าตัวใหม่ที่รอตัดสินสำหรับคนนี้แล้ว — โหลดหน้าใหม่เพื่อดูสถานะล่าสุด' } };
    }
    const bk = t.row.booking || {};
    // ต้องเป็นยอดเดียวกับที่ทีมเห็นบนหน้าจอ — ไม่ส่งยอดมา หรือคนหาคอนเฟิร์มรอบใหม่ไปแล้ว = ให้โหลดใหม่ก่อน
    if (cleanFee(expected_fee) !== cleanFee(bk.requested_fee)
        || (bk.confirmed_at && expected_confirmed_at !== undefined && !sameInstant(bk.confirmed_at, expected_confirmed_at))) {
        return { error: { code: 409, message: 'ค่าตัวที่ขอเปลี่ยนไประหว่างที่หน้าเปิดอยู่ — โหลดหน้าใหม่เพื่อดูยอดล่าสุดก่อนตัดสิน' } };
    }
    const stamp = { reviewed_by: actor, reviewed_at: at, team_note: clipText(note, 500) };
    const next = approve
        ? { ...t.row, fee: cleanFee(bk.requested_fee) || Number(t.row.fee) || 0, status: HIRE_AGREED,
            booking: { ...bk, ...stamp, state: BOOK_OK } }
        : { ...t.row, status: HIRE_BOOKED,
            booking: { ...bk, ...stamp, state: BOOK_PENDING, rejected_fee: bk.requested_fee || null, requested_fee: null } };
    const out = t.arr.slice();
    out[t.idx] = next;
    return { list: out, row: next };
}

// คิวไม่ว่าง / คนนั้นถอนตัว — เอาออกจากงาน แล้วคืนที่ว่างให้คนหาหาใหม่ (ทำได้ระหว่างยังไม่คอนเฟิร์มเท่านั้น)
function bookingUnavailable(list, reqKey, rowKey, reason, { actor = null, at = now() } = {}) {
    const t = bookingTarget(list, reqKey, rowKey);
    if (t.error) return t;
    if (!bookingOpen(t.row)) {
        return { error: { code: 409, message: 'คนนี้ยืนยันคิวแล้ว — ถ้ามาไม่ได้ภายหลัง ให้ทีมแบรนด์ลบออกจากรายชื่อคนในงาน (ที่ว่างจะคืนให้ใบเอง)' } };
    }
    const why = clipText(reason, 300);
    const without = t.arr.filter((_, i) => i !== t.idx);
    return { list: releaseToRequest(without, t.row, { reason: 'คิวไม่ว่าง' + (why ? ': ' + why : ''), actor, at }), row: t.row };
}

// ===== ไฟล์อัปโหลด: แปลงชื่อที่เก็บในฐานเป็น path จริงอย่างปลอดภัย =====
// ชื่อไฟล์ใน hire_items / product_briefs มาจาก JSON ที่หน้าเว็บส่งมาทั้งก้อนได้ จึงห้ามเชื่อ
// รับเฉพาะ "ชื่อไฟล์ล้วน" ที่อยู่ในโฟลเดอร์อัปโหลดตรง ๆ — มีโฟลเดอร์/../ ปนมา = null ห้ามอ่านห้ามลบเด็ดขาด
function resolveInside(dir, name) {
    const path = require('node:path');
    if (typeof name !== 'string' || !name) return null;
    const base = path.basename(name);
    if (!base || base === '.' || base === '..' || base !== name || name.includes('/') || name.includes('\\')) return null;
    const root = path.resolve(dir);
    const full = path.resolve(root, base);
    return path.dirname(full) === root ? full : null;
}

// เวลาสองค่าคือจังหวะเดียวกันไหม (สตริง ISO / Date) — ใช้เช็คว่ามีใครแก้ข้อมูลระหว่างที่หน้าเว็บเปิดค้างไว้
function sameInstant(a, b) {
    const t = v => (v === null || v === undefined || v === '' ? NaN : new Date(v).getTime());
    const x = t(a), y = t(b);
    return Number.isFinite(x) && x === y;
}

// ===== ชื่อที่ใช้ตั้งชื่อไฟล์จาก route param — req.params ถูก decode แล้ว (%2F กลายเป็น /) จึงต้องกรองก่อนเสมอ =====
const safeId = v => (/^\d+$/.test(String(v == null ? '' : v)) ? String(v) : '0');
const safeSlug = v => (/^[a-z0-9_-]{1,40}$/i.test(String(v == null ? '' : v)) ? String(v) : 'file');

// ===== ค่าตัว / จำนวนคน จากหน้าเว็บ — ตัดค่าติดลบ ไม่ใช่ตัวเลข และค่ามหาศาลทิ้ง ไม่ให้งบติดลบหรือพังตอนคำนวณ =====
const FEE_MAX = 100000000;      // 100 ล้านต่อแถว (เกินนี้ถือว่าพิมพ์ผิด)
const HEADCOUNT_MAX = 999;
function cleanFee(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(Math.round(n * 100) / 100, FEE_MAX);
}
function cleanHeadcount(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, HEADCOUNT_MAX);
}

// ===== บรีฟที่มีไฟล์แนบ (product_briefs / platform_briefs) จากฟอร์มแคมเปญ =====
// ฟอร์มส่ง file meta เดิมกลับมาทุกครั้ง แต่ชื่อไฟล์ต้องมาจากเส้นอัปโหลดเท่านั้น (ถ้าเชื่อ body จะชี้ไปเปิดไฟล์อะไรก็ได้)
// กติกา: ส่ง file เป็น null = เอาไฟล์ออกได้ · ส่งเป็นอะไรก็ตาม = ใช้ของในฐาน (ไม่มีในฐาน = null)
function mergeBriefFiles(current, incoming) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return {};
    const cur = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const out = {};
    for (const [k, v] of Object.entries(incoming)) {
        const entry = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        const keepFile = entry.file != null && cur[k] && cur[k].file ? cur[k].file : null;
        out[k] = { ...entry, file: keepFile };
    }
    return out;
}

// ===== Scope of Work ของใบขอให้หา (ขอบเขตงานที่คนช่วยหาต้องรู้ก่อนหาคน: ถ่ายกี่ลุค ใช้งานกี่เดือน ฯลฯ) =====
// มีเฉพาะใบขอให้หา — แถวคนเป็น null เสมอ · ใช้ตัวเดียวกันทั้ง mergeHireItems / newHireRow / เส้นแก้ใบ (routes/projects.js)
// ความยาวจึงตรงกันทุกทาง · รับแค่สตริง/ตัวเลข (object ที่ปลอมมาไม่กลายเป็น "[object Object]") ว่าง = null
const HIRE_SCOPE_MAX = 2000;
const hireScope = v => (typeof v === 'string' || typeof v === 'number' ? clipText(v, HIRE_SCOPE_MAX) : null);

// ===== รวม hire_items ที่ฟอร์มส่งมาทั้งก้อน เข้ากับของในฐาน =====
// ฟิลด์ที่ "ระบบเป็นคนตั้ง" ห้ามเชื่อจากหน้าเว็บ เพราะหน้าเว็บส่งกลับมาทั้งก้อนและปลอมได้:
//   image (ชื่อไฟล์) · candidates · filled · requested_by_id / requested_at · from_request
// แถวที่มีอยู่ในฐาน → ยึดค่าพวกนี้จากฐาน · แถวใหม่ → ล้างทิ้ง (ไฟล์ต้องมาจากเส้นอัปโหลดเท่านั้น)
// ผู้รับผิดชอบจัดหาเลือกในฟอร์มได้ แต่ต้องเป็นคนที่ route ตรวจกับฐานผู้ใช้แล้ว (users) ชื่อก็เอาจากฐาน
function mergeHireItems(current, incoming, { userId = null, at = now(), users = {}, actor = null } = {}) {
    const byKey = new Map((Array.isArray(current) ? current : [])
        .filter(it => it && it.key)
        .map(it => [String(it.key), it]));
    const seen = new Set();
    const merged = (Array.isArray(incoming) ? incoming : [])
        .filter(it => it && typeof it === 'object' && !Array.isArray(it))
        .map(raw => {
            let key = raw.key ? String(raw.key) : '';
            // key ซ้ำในก้อนเดียวกัน (ปลอมมา) ให้ถือเป็นแถวใหม่ ไม่งั้นแถวที่สองจะได้ไฟล์/รายชื่อของแถวแรกไป
            if (!key || seen.has(key)) key = 'h' + Math.random().toString(36).slice(2, 9);
            seen.add(key);
            const prev = byKey.get(key) || null;
            // ใบขอจัดหาที่เดินงานไปแล้ว (มีชื่อเสนอ หรือหาได้แล้ว) สลับเป็นแถว "ระบุคนเอง" ไม่ได้
            // ไม่งั้นรายชื่อที่เสนอและจำนวนคนที่หาได้จะถูกล้างทิ้ง — คงแถวเดิมจากฐานไว้ทั้งแถว (แก้/ลบใบให้ทำที่การ์ด)
            if (prev && prev.mode === 'casting' && raw.mode !== 'casting'
                && ((Number(prev.filled) || 0) > 0 || (Array.isArray(prev.candidates) && prev.candidates.length > 0))) {
                return { ...prev, key };
            }
            const casting = raw.mode === 'casting';
            const out = { ...raw, key, mode: casting ? 'casting' : 'direct', fee: cleanFee(raw.fee) };

            out.image = prev && prev.image ? prev.image : null;
            out.from_request = prev && prev.from_request ? prev.from_request : null;
            // ขั้นคอนเฟิร์มคิวเป็นของระบบ (เดินผ่านปุ่มบนการ์ดเท่านั้น) — ห้ามเชื่อจากหน้าเว็บ
            out.from_candidate = prev && prev.from_candidate ? prev.from_candidate : null;
            out.booking = !casting && prev && prev.mode !== 'casting' && prev.booking ? prev.booking : null;
            // เวลาใช้งานคนหาใส่ตอนคอนเฟิร์ม — หน้าเว็บเก่าที่ไม่ส่งช่องนี้มาต้องไม่ล้างทิ้ง
            out.use_time = raw.use_time === undefined ? ((prev && prev.use_time) || null) : clipText(raw.use_time, 60);

            if (!casting) {
                // ระหว่างรอคอนเฟิร์มคิว / รออนุมัติค่าตัวใหม่ สถานะเดินตามขั้นตอน ห้ามเปลี่ยนเองจากตารางหรือฟอร์ม
                if (bookingOpen(out) && (Array.isArray(current) ? current : [])
                    .some(c => c && c.mode === 'casting' && String(c.key) === String(out.from_request))) {
                    out.status = (prev && prev.status) || HIRE_BOOKED;
                }
                out.candidates = null; out.filled = null; out.headcount = null;
                out.assignee_id = null; out.assignee_name = null; out.assigned_at = null;
                out.requested_by_id = null; out.requested_at = null;
                out.scope = null;       // Scope of Work เป็นของใบขอให้หาเท่านั้น
                return out;
            }

            const prevCasting = prev && prev.mode === 'casting' ? prev : null;
            // ฟอร์มเต็ม / แท็บที่เปิดค้างจากก่อน deploy ไม่ส่งช่องนี้มา (undefined) — คงของเดิมในใบไว้ ห้ามล้างทิ้งเงียบ ๆ
            // ส่งมาเป็น null / ว่าง = ตั้งใจลบออก
            out.scope = raw.scope === undefined ? ((prevCasting && hireScope(prevCasting.scope)) || null) : hireScope(raw.scope);
            out.candidates = prevCasting && Array.isArray(prevCasting.candidates) ? prevCasting.candidates : [];
            out.filled = prevCasting ? (Number(prevCasting.filled) || 0) : 0;
            out.requested_by_id = prevCasting && prevCasting.requested_by_id != null ? prevCasting.requested_by_id : (userId || null);
            out.requested_at = prevCasting && prevCasting.requested_at ? prevCasting.requested_at : at;
            // ลดจำนวนที่ขอต่ำกว่าคนที่หาได้แล้วไม่ได้ — งบจะติดลบและใบจะค้างสถานะแปลก ๆ
            out.headcount = Math.max(cleanHeadcount(raw.headcount), out.filled);

            const want = raw.assignee_id === null || raw.assignee_id === undefined || raw.assignee_id === '' ? null : String(raw.assignee_id);
            const had = prevCasting && prevCasting.assignee_id != null ? String(prevCasting.assignee_id) : null;
            if (want === had) {
                // ไม่ได้เปลี่ยนคน — คงของเดิมทั้งชุด (แม้คนนั้นจะถูกปิดบัญชีไปแล้วก็ไม่ถอดงานเงียบ ๆ)
                out.assignee_id = prevCasting ? prevCasting.assignee_id : null;
                out.assignee_name = prevCasting ? (prevCasting.assignee_name || null) : null;
                out.assigned_at = prevCasting ? (prevCasting.assigned_at || null) : null;
            } else if (want && users[want]) {
                out.assignee_id = users[want].id;
                out.assignee_name = users[want].name;
                out.assigned_at = at;
            } else {
                out.assignee_id = null; out.assignee_name = null; out.assigned_at = null;
            }
            return out;
        });
    // คนที่ได้จากใบขอจัดหาแล้วถูกลบออกจากฟอร์ม → คืนที่ว่างให้ใบนั้น (ไม่งั้นใบค้าง "ได้ครบแล้ว" ทั้งที่คนหายไป)
    const kept = new Set(merged.map(it => String(it.key)));
    let result = merged;
    (Array.isArray(current) ? current : []).forEach(prev => {
        if (!prev || !prev.key || prev.mode === 'casting' || prev.from_request == null || kept.has(String(prev.key))) return;
        result = releaseToRequest(result, prev, { reason: 'ถูกลบออกจากรายชื่อผู้รับงาน', actor, at });
    });
    return result;
}

// ===== เพิ่มคน 1 แถวจากฟอร์มสั้นหน้า Talent (POST /projects/:id/hires) =====
// ฟอร์มสั้นมีสองแบบ: "มีคนแล้ว" (direct = รู้ชื่อคนแล้ว) กับ "ขอให้ช่วยหา" (casting = ใบขอให้หา)
// รับเฉพาะช่องที่ฟอร์มกรอกได้ (whitelist) — ห้าม spread body ทั้งก้อน เพราะ mergeHireItems ส่งต่อทุกช่องที่ได้มาตรง ๆ
// แล้วส่งแถวเดียวเข้า mergeHireItems([], ...) ให้ช่องที่ระบบเป็นคนตั้ง (รูป, booking, from_*, candidates, filled,
// requested_by_id/at, คนช่วยหา) ได้กติกาเดียวกับฟอร์มเต็มเป๊ะ
// ไม่ส่งแถวเดิมของงานเข้า merge ด้วย — ไม่งั้นใบเก่าที่ไม่มี requested_by จะถูกประทับเป็นคนกดบันทึกครั้งนี้
// และแถวเก่าที่ key ซ้ำกันจะโดนเปลี่ยน key · key ชนกับของในฐานให้ store ตรวจใต้ล็อกแถว (projects.addHireItem)
const HIRE_DIRECT_STATUS = ['ทาบทาม', 'ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'];   // ค่าในฐาน (= HIRE_STATUS ฝั่งหน้าเว็บ)
const NEED_FEE_MSG = 'ใส่ค่าตัวก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้';                // ต้องตรงกับ NEED_FEE_MSG ฝั่งหน้าเว็บ (talentLabels.js)

// วันที่ต้องเป็นวันที่มีอยู่จริงแบบ YYYY-MM-DD ไม่งั้นเป็นว่าง — วันใช้งานถูกเอาไปขยายช่วงวันของงาน (คอลัมน์ DATE)
// ถ้าปล่อย '2026-02-31' ผ่านไป Postgres จะโยน error ทั้งคำขอ
function realDate(v) {
    if (!isDateStr(v)) return null;
    const t = new Date(v + 'T00:00:00Z');
    return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === v ? v : null;
}

function newHireRow(body, { userId = null, users = {}, actor = null, at = now() } = {}) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    if (!b) return { error: { code: 400, message: 'ข้อมูลไม่ถูกต้อง' } };
    const mode = b.mode === 'casting' || b.mode === 'direct' ? b.mode : null;
    if (!mode) return { error: { code: 400, message: 'เลือกก่อนว่า มีคนแล้ว หรือ ขอให้ช่วยหา' } };
    // ช่องข้อความรับแค่สตริง/ตัวเลข (object ที่ปลอมมาจะไม่กลายเป็น "[object Object]") ตัดช่องว่างหัวท้ายและจำกัดความยาว
    const text = (v, n) => (typeof v === 'string' || typeof v === 'number' ? clipText(v, n) : null);
    const kind = text(b.kind, 100);
    if (!kind) return { error: { code: 400, message: 'กรุณาระบุประเภทงาน' } };
    const fee = cleanFee(b.fee);
    let raw;
    if (mode === 'direct') {
        const name = text(b.name, 200);
        if (!name) return { error: { code: 400, message: 'กรุณาระบุชื่อคน' } };
        const want = text(b.status, 40);
        const status = HIRE_DIRECT_STATUS.includes(want) ? want : HIRE_BOOKED;
        // บันทึกคนที่ยังไม่รู้ค่าตัวได้ (กำลังคุย) แต่ "ตกลงแล้ว" และขั้นหลังจากนั้นต้องมีค่าตัว ไม่งั้นรอบทำจ่ายนับเป็นยอด 0
        if (HIRE_PAYABLE.includes(status) && fee <= 0) return { error: { code: 400, message: NEED_FEE_MSG } };
        raw = {
            mode, kind, name,
            contact: text(b.contact, 200), agency: text(b.agency, 200), qty: text(b.qty, 100),
            fee, use_date: realDate(b.use_date), use_time: text(b.use_time, 60), place: text(b.place, 200),
            link: text(b.link, 1000), note: text(b.note, 1000), status
        };
    } else {
        raw = {
            // ใบขอให้หาห้ามมีชื่อคน — hires.list() นับทุกแถวที่มีชื่อเป็น "คนที่เคยจ้าง"
            mode, kind, name: null, contact: null, agency: null, qty: null, link: null,
            fee,                                        // งบต่อคน (0 ได้ = ยังไม่กำหนดงบ)
            headcount: b.headcount,                     // merge ปัดผ่าน cleanHeadcount (1…999)
            spec: text(b.spec, 1000), deadline: realDate(b.deadline),
            scope: hireScope(b.scope),                  // Scope of Work (ไม่บังคับ) — แถวคนไม่มีช่องนี้ (merge ตั้งเป็น null)
            use_date: realDate(b.use_date), place: text(b.place, 200), note: text(b.note, 1000),
            // คนช่วยหาต้องผ่านการตรวจกับฐานผู้ใช้ (users จาก route) ไม่งั้น merge ถอดออกเป็นว่าง
            assignee_id: typeof b.assignee_id === 'string' || typeof b.assignee_id === 'number' ? b.assignee_id : null,
            status: 'กำลังหา'                          // ใบใหม่เริ่มที่ "กำลังหา" เสมอ (หน้าเว็บตั้งสถานะใบเองไม่ได้)
        };
    }
    const [item] = mergeHireItems([], [raw], { userId, users, actor, at });
    return { item };
}

// ===== กติกา "ไม่มีค่าตัว ห้ามตกลงแล้ว" ของฟอร์มที่ส่งรายการจ้างมาทั้งก้อน (PUT /projects/:id, POST /projects) =====
// คืนแถวแรกที่ผิดกติกา (หรือ null): แถวคนที่สถานะ ตกลงแล้ว/ถ่ายเสร็จ/ส่งงานแล้ว แต่ค่าตัว 0 และ "เพิ่งเป็นแบบนี้" ในการบันทึกครั้งนี้
// = แถวใหม่ หรือสถานะเปลี่ยน หรือค่าตัวเปลี่ยน · แถวเก่าที่เป็นแบบนี้อยู่แล้วและไม่ได้แตะ ต้องผ่าน
// (ไม่งั้นงานเก่าที่เคยบันทึกค่าตัว 0 ไว้ จะบันทึกอะไรในงานนั้นไม่ได้อีกเลย)
// เทียบตัวตนแถวแบบเดียวกับ mergeHireItems: key เดียวกัน = แถวเดิม · key ว่าง / ซ้ำในก้อน = แถวใหม่
function payableWithoutFee(currentItems, incomingItems) {
    const cur = Array.isArray(currentItems) ? currentItems : [];
    const byKey = new Map(cur.filter(it => it && it.key).map(it => [String(it.key), it]));
    const seen = new Set();
    const st = v => String(v == null ? '' : v).trim();
    for (const raw of (Array.isArray(incomingItems) ? incomingItems : [])) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const key = raw.key ? String(raw.key) : '';
        const prev = !key || seen.has(key) ? null : (byKey.get(key) || null);
        if (key) seen.add(key);
        if (raw.mode === 'casting') continue;
        // ใบขอให้หาที่เดินงานไปแล้ว merge คงใบเดิมไว้ทั้งแถว — แถวคนที่ส่งมาแทนไม่ถูกบันทึกอยู่แล้ว
        if (prev && prev.mode === 'casting'
            && ((Number(prev.filled) || 0) > 0 || (Array.isArray(prev.candidates) && prev.candidates.length > 0))) continue;
        const was = prev && prev.mode !== 'casting' ? prev : null;
        // ระหว่างรอยืนยันคิว / รอตัดสินค่าตัวใหม่ merge ล็อกสถานะไว้ตามของเดิม — สถานะที่ส่งมาไม่มีผล
        const locked = !!was && bookingOpen(was) && was.from_request != null
            && cur.some(c => c && c.mode === 'casting' && String(c.key) === String(was.from_request));
        const status = locked ? (st(was.status) || HIRE_BOOKED) : st(raw.status);
        if (!HIRE_PAYABLE.includes(status) || cleanFee(raw.fee) > 0) continue;
        if (!was || status !== st(was.status) || cleanFee(was.fee) !== cleanFee(raw.fee)) return raw;
    }
    return null;
}

// ===== แก้คน 1 คนในงาน Talent (PATCH /projects/:id/hires/:key/person — ปุ่ม "ถัดไป" และลิ้นชักคนในหน้างาน) =====
// หน้างานส่งมาเฉพาะช่องที่แก้ (set) พร้อมค่าที่หน้าเห็นก่อนแก้ (expect) — ไม่ส่งทั้งก้อนแบบฟอร์มเต็ม
// จึงไม่ทับงานคนอื่นที่แก้คนละช่อง / คนละคนในเวลาเดียวกัน · ค่าที่เห็นไม่ตรงของในฐาน = มีคนแก้ไปแล้ว → 409 ให้โหลดใหม่
// ช่องที่แก้ได้ = ช่องเดียวกับที่ฟอร์มสั้นกรอกได้ (newHireRow) — ช่องที่ระบบเป็นคนตั้ง (รูป, booking, from_*, key) แก้ทางนี้ไม่ได้
// ความยาวของแต่ละช่องตรงกับ newHireRow ไม่งั้นแก้ทีหลังจะยาวกว่าตอนสร้างได้
const PERSON_TEXT_MAX = { name: 200, kind: 100, contact: 200, agency: 200, qty: 100, use_time: 60, place: 200, link: 1000, note: 1000 };
const PERSON_FIELDS = [...Object.keys(PERSON_TEXT_MAX), 'fee', 'use_date', 'status'];

// row = แถวคนตามที่อยู่ในฐาน (ใต้ล็อก) · requestExists = ใบขอให้หาต้นทางของคนนี้ยังอยู่ในงานไหม
// คืน { row: แถวใหม่, changed: [ช่องที่เปลี่ยนจริง] } หรือ { error: { code, message, stale? } }
// changed ว่าง = ส่งค่าเดิมมา (เช่นกดเลิกทำซ้ำ) ไม่มีอะไรต้องเขียน
function personPatch(row, set, expect, { requestExists = false } = {}) {
    if (!row || typeof row !== 'object') return { error: { code: 404, message: 'ไม่พบรายการนี้' } };
    if (row.mode === 'casting') return { error: { code: 400, message: 'แก้ได้เฉพาะคนในงาน — ใบขอให้หาแก้ในใบ' } };
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
    // ช่องที่ไม่รู้จักทิ้งเงียบ ๆ (หน้าเว็บรุ่นใหม่กว่าอาจส่งมาเกิน) — เหลือไม่มีเลย = ไม่มีอะไรให้บันทึก
    const keys = PERSON_FIELDS.filter(k => has(set, k));
    if (!keys.length) return { error: { code: 400, message: 'ไม่มีอะไรให้บันทึก' } };

    // ตัวแปลงค่าให้เทียบกันได้: ข้อความตัดช่องว่าง/ความยาวแบบเดียวกับตอนสร้าง (ว่าง = null) · ค่าตัวผ่าน cleanFee ('' = 0 = null)
    // วันที่เทียบเป็นสตริง · สถานะที่ไม่รู้จัก (ข้อมูลเก่า / ว่าง) ถือเป็นกำลังคุย แบบเดียวกับหน้าเว็บ (personStep)
    const text = (v, n) => (typeof v === 'string' || typeof v === 'number' ? clipText(v, n) : null);
    const statusOf = v => { const s = text(v, 40); return HIRE_DIRECT_STATUS.includes(s) ? s : HIRE_BOOKED; };
    const dateOf = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const norm = (k, v) => (k === 'fee' ? cleanFee(v)
        : k === 'status' ? statusOf(v)
            : k === 'use_date' ? dateOf(v)
                : text(v, PERSON_TEXT_MAX[k]));
    const who = String(text(row.name, 200) || text(row.kind, 100) || 'คนนี้').slice(0, 100);

    // เช็คก่อนตรวจค่าที่ส่งมา — หน้าที่เปิดค้าง (ข้อมูลเก่า) ต้องได้ 409 ให้โหลดใหม่ ไม่ใช่ 400 เรื่องค่าที่ตัวเองไม่ได้แตะ
    // เทียบเฉพาะช่องที่ส่ง expect มา (หน้าเว็บส่งค่าเดิมของทุกช่องที่แก้)
    const stale = PERSON_FIELDS.find(k => has(expect, k) && norm(k, expect[k]) !== norm(k, row[k]));
    if (stale) {
        return { error: { code: 409, stale: true, message: `ข้อมูลของ ${who} เพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว ตรวจแล้วบันทึกอีกครั้ง` } };
    }

    const next = {};
    for (const k of keys) {
        const v = set[k];
        if (k === 'fee') next.fee = cleanFee(v);
        else if (k === 'status') {
            const s = text(v, 40);
            if (!HIRE_DIRECT_STATUS.includes(s)) return { error: { code: 400, message: 'สถานะไม่ถูกต้อง' } };
            next.status = s;
        } else if (k === 'use_date') {
            // ว่าง = ล้างวัน · วันที่ผิดรูป/ไม่มีจริงตีกลับ (ไม่ล้างเงียบ ๆ แบบฟอร์มสร้าง — ที่นี่คือแก้วันที่มีอยู่แล้ว พิมพ์ผิดแล้ววันหายจะไม่มีใครรู้)
            if (v === null || (typeof v === 'string' && !v.trim())) next.use_date = null;
            else if (realDate(typeof v === 'string' ? v.trim() : v)) next.use_date = v.trim();
            else return { error: { code: 400, message: 'วันที่ไม่ถูกต้อง (ต้องเป็น ปี-เดือน-วัน)' } };
        } else next[k] = text(v, PERSON_TEXT_MAX[k]);
    }
    if (keys.includes('name') && !next.name) return { error: { code: 400, message: 'กรุณาระบุชื่อคน' } };
    if (keys.includes('kind') && !next.kind) return { error: { code: 400, message: 'กรุณาระบุประเภทงาน' } };

    // เขียนเฉพาะช่องที่เปลี่ยนจริง — ช่องที่ส่งค่าเดิมมาคงของในฐานไว้ตามเดิมทุกตัวอักษร
    const changed = keys.filter(k => norm(k, next[k]) !== norm(k, row[k]));
    const out = { ...row };
    changed.forEach(k => { out[k] = next[k]; });

    if (changed.includes('status') && bookingOpen(row)) {
        // ระหว่างรอยืนยันคิว / รอตัดสินค่าตัวใหม่ สถานะเดินตามปุ่มในใบเท่านั้น (กติกาเดียวกับ mergeHireItems)
        if (requestExists) return { error: { code: 409, message: 'คนนี้ยังรอยืนยันคิวในใบขอให้หา — ยืนยันคิวในใบก่อน' } };
        // ใบต้นทางหายไปแล้ว ไม่มีใครกดยืนยันคิวให้ได้อีก — ตั้งสถานะเองแล้วปิดขั้นยืนยันคิวไปด้วย
        // ไม่งั้นคนนี้ค้าง "รอยืนยัน" ในความคืบหน้า/รอบทำจ่ายตลอดไปทั้งที่ตั้งสถานะแล้ว
        out.booking = { ...(row.booking || {}), state: BOOK_OK };
    }
    // ไม่มีค่าตัว ห้ามตกลงแล้ว — ตรวจเฉพาะเมื่อครั้งนี้แตะสถานะหรือค่าตัว (แถวเก่าที่ตกลงแล้วค่าตัว 0 ยังแก้ช่องอื่นได้)
    if ((changed.includes('status') || changed.includes('fee'))
        && HIRE_PAYABLE.includes(statusOf(out.status)) && !bookingOpen(out) && cleanFee(out.fee) <= 0) {
        const name = String(text(out.name, 200) || text(out.kind, 100) || 'คนที่ยังไม่ใส่ชื่อ').slice(0, 100);
        return { error: { code: 400, message: `ใส่ค่าตัวของ "${name}" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้` } };
    }
    return { row: out, changed };
}

// Platform ของกลุ่ม — รองรับทั้ง platforms[] แบบใหม่ และ platform เดี่ยว/ที่ติดอยู่กับ allocation แบบเดิม
function linkGroupPlatforms(g) {
    const set = new Set();
    (g.platforms || []).forEach(p => { if (p) set.add(p); });
    if (g.platform) set.add(g.platform);
    (g.allocations || []).forEach(a => { if (a.platform) set.add(a.platform); });
    return [...set];
}

// Content Type/Photo-VDO/Format ของกลุ่ม — โครงใหม่เก็บแยกต่อ Platform ใน allocations
// Content ที่ 1 คนต้องทำ — ตั้งแยกต่อ Platform ได้ (TikTok 2 คลิป / Facebook 1 ก็ได้)
// ห้ามใช้ grp.clips ตรง ๆ เพราะนั่นคือค่าของ Platform แรกเท่านั้น
function resolveGroupClips(g, platform) {
    if (!g) return [];
    const b = (g.blocks || []).find(x => x.platform === platform);
    const list = (b && (b.clips || []).length) ? b.clips : (g.clips || []);
    return list.map(c => String(c || '').trim()).filter(Boolean);
}

// Target ตั้งแยกต่อ Platform และมีเฉพาะ Platform ที่ใช้ยิงแอด
// กลุ่มที่ลง TikTok + Facebook จะมี Target แค่ฝั่ง TikTok เท่านั้น
// รหัสสินค้าในช่องสินค้าของคลิป ("L3,L4" / "L3 - ชื่อ, L4") ที่ตรงกับรหัสที่รู้จัก — เทียบเต็มรหัส ("L1" ไม่จับ "L10")
// ต้องตรงกับ productCodesIn ฝั่งหน้าเว็บ (client/src/data/adGroups.js)
function productCodesIn(value, known) {
    const keys = (known || []).map(String);
    const out = [];
    String(value == null ? '' : value).split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
        const hit = keys.find(k => tok === k || tok.startsWith(k + ' '));
        if (hit && !out.includes(hit)) out.push(hit);
    });
    return out;
}

// Target ของคลิป: บล็อกที่ตั้ง Target แยกต่อสินค้า (product_targets) → เอาเฉพาะของสินค้าในคลิป
// ไม่รู้สินค้า / ไม่มีข้อมูลต่อสินค้า → Target รวมของ Platform ตามเดิม · ต้องตรงกับ targetFor ฝั่งหน้าเว็บ
function resolveGroupTarget(g, platform, product) {
    if (!g) return null;
    const b = (g.blocks || []).find(x => x.platform === platform);
    if (b) {
        const pt = b.product_targets;
        if (product && pt && typeof pt === 'object' && !Array.isArray(pt)) {
            const picked = [...new Set(productCodesIn(product, Object.keys(pt))
                .flatMap(c => (Array.isArray(pt[c]) ? pt[c] : (pt[c] ? [pt[c]] : [])).filter(Boolean)))];
            if (picked.length) return picked;
        }
        const t = b.target;
        return (Array.isArray(t) ? t.length : !!t) ? t : null;
    }
    return TARGET_PLATFORMS.includes(platform) ? (g.target || null) : null;
}

// Concept แยกต่อสินค้า (ต่อ Platform): แท็บที่เปิดค้างจากก่อน deploy ส่งบล็อกมาโดยไม่มี concept_split (ฟอร์มรุ่นใหม่ส่ง true/false เสมอ)
// ของในฐานแยกอยู่ + Concept หลักของกลุ่มเท่าเดิม → ยก Concept ต่อสินค้าเดิมมาต่อ (เฉพาะสินค้าที่ยังอยู่ในบล็อก)
// ต้องตรงกับ packConcepts ฝั่งหน้าเว็บ
function carryProductConcepts(incoming, stored) {
    if (!Array.isArray(incoming) || !Array.isArray(stored)) return incoming;
    const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const text = v => String(v == null ? '' : v).trim();
    return incoming.map(g => {
        if (!g || !Array.isArray(g.blocks) || !g.key) return g;
        const old = stored.find(s => s && s.key === g.key);
        if (!old || !Array.isArray(old.blocks) || text(g.concept) !== text(old.concept)) return g;
        let changed = false;
        const blocks = g.blocks.map(b => {
            if (!b || b.concept_split !== undefined) return b;
            const ob = old.blocks.find(x => x && x.platform === b.platform && x.concept_split === true && isMap(x.product_concepts));
            if (!ob) return b;
            const pc = {};
            (Array.isArray(b.products) ? b.products : []).forEach(c => {
                if (Object.prototype.hasOwnProperty.call(ob.product_concepts, c) && text(ob.product_concepts[c])) pc[c] = text(ob.product_concepts[c]);
            });
            changed = true;
            return { ...b, concept_split: true, product_concepts: pc };
        });
        return changed ? { ...g, blocks } : g;
    });
}

// งบแยกต่อสินค้า: แท็บที่เปิดค้างจากก่อน deploy ส่งบล็อกมาโดยไม่มี budget_mode (ฟอร์มรุ่นใหม่ส่ง 'total' / 'split' เสมอ)
// ของในฐานแยกงบอยู่ + ทุกสินค้าที่ส่งมามีงบเดิม + ผลรวมเท่างบที่ส่งมา (ไม่ได้แตะงบ) → ยกงบรายสินค้าเดิมมาต่อ
// นอกนั้นเป็นงบก้อนเดียวตามที่ส่งมา (ตัวเลขงบรวมยังถูกเสมอ) · ต้องตรงกับ packBudgets ฝั่งหน้าเว็บ
function carryProductBudgets(incoming, stored) {
    if (!Array.isArray(incoming) || !Array.isArray(stored)) return incoming;
    const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const money = v => Number(String(v == null ? '' : v).replace(/[^0-9]/g, '')) || 0;
    return incoming.map(g => {
        if (!g || !Array.isArray(g.blocks) || !g.key) return g;
        const old = stored.find(s => s && s.key === g.key);
        if (!old || !Array.isArray(old.blocks)) return g;
        let changed = false;
        const blocks = g.blocks.map(b => {
            if (!b || b.budget_mode !== undefined) return b;
            const ob = old.blocks.find(x => x && x.platform === b.platform && x.budget_mode === 'split' && isMap(x.product_budgets));
            if (!ob) return b;
            const products = Array.isArray(b.products) ? b.products : [];
            if (!products.length || !products.every(c => Object.prototype.hasOwnProperty.call(ob.product_budgets, c))) return b;
            const pb = {};
            products.forEach(c => { pb[c] = money(ob.product_budgets[c]); });
            const sum = Object.values(pb).reduce((n, v) => n + v, 0);
            if (!sum || sum !== money(b.budget)) return b;
            changed = true;
            return { ...b, budget_mode: 'split', product_budgets: pb };
        });
        return changed ? { ...g, blocks } : g;
    });
}

// หน้าเว็บที่เปิดค้างไว้ตั้งแต่ก่อน deploy (ฟอร์มรุ่นเก่า) ไม่รู้จัก product_targets — บันทึกเมื่อไหร่ Target ต่อสินค้าหายทั้งก้อน
// บล็อกที่ส่งมาไม่มี product_targets แต่ของในฐานมี และ Target รวมยังเท่าเดิม (คนกดบันทึกไม่ได้แตะ Target) → ยกของเดิมมาต่อ
// เฉพาะสินค้าที่ยังอยู่ในบล็อก · ถ้า Target รวมเปลี่ยน = แก้ Target จริง ปล่อยให้ฟอร์มรุ่นใหม่แบ่งใหม่ตอนเปิดครั้งหน้า
function carryProductTargets(incoming, stored) {
    if (!Array.isArray(incoming) || !Array.isArray(stored)) return incoming;
    const list = t => (Array.isArray(t) ? t.filter(Boolean) : (t ? [t] : []));
    const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const sameSet = (a, b) => {
        const A = new Set(list(a)), B = new Set(list(b));
        return A.size === B.size && [...A].every(x => B.has(x));
    };
    return incoming.map(g => {
        if (!g || !Array.isArray(g.blocks) || !g.key) return g;
        const old = stored.find(s => s && s.key === g.key);
        if (!old || !Array.isArray(old.blocks)) return g;
        let changed = false;
        const blocks = g.blocks.map(b => {
            if (!b || isMap(b.product_targets) || !TARGET_PLATFORMS.includes(b.platform)) return b;
            const ob = old.blocks.find(x => x && x.platform === b.platform && isMap(x.product_targets));
            if (!ob || !sameSet(b.target, ob.target)) return b;
            const pt = {};
            (Array.isArray(b.products) ? b.products : []).forEach(c => {
                if (Object.prototype.hasOwnProperty.call(ob.product_targets, c)) pt[c] = list(ob.product_targets[c]);
            });
            changed = true;
            return { ...b, product_targets: pt };
        });
        return changed ? { ...g, blocks } : g;
    });
}

// สินค้าของ Platform นั้นในกลุ่ม — ไม่มีค่อยถอยไปใช้ของทั้งกลุ่ม
function resolveGroupProducts(g, platform) {
    if (!g) return [];
    const b = (g.blocks || []).find(x => x.platform === platform);
    return (b && (b.products || []).length) ? b.products : (g.products || []);
}

function resolveGroupCtype(g, platform) {
    if (!g) return null;
    const hit = (g.allocations || []).find(a => a.content_type && (!platform || !a.platform || a.platform === platform));
    return hit ? hit.content_type : (g.content_type || null);
}

function resolveGroupMedia(g, platform, contentType) {
    if (!g) return { media_type: null, content_format: null };
    const rows = (g.allocations || []).filter(a =>
        (!platform || !a.platform || a.platform === platform)
        && (!contentType || !a.content_type || a.content_type === contentType));
    const hit = rows.find(a => a.media_type || a.content_format);
    return {
        media_type: hit ? (hit.media_type || null) : (g.media_type || null),
        content_format: hit ? (hit.content_format || null) : (g.content_format || null)
    };
}

// Campaign (VDO View / Reach / Consideration Ads) ของ (Platform + Content Type) — ตั้งไว้ที่ชุด Content Type ในฟอร์มแคมเปญ
// ต้องตรง Content Type จริง — ชุดที่ยังไม่เลือก Content Type ห้ามแจก Campaign ให้ KOL ทุก Content Type ใน Platform นั้น
// (ต่างจาก resolveGroupMedia ที่ถือว่าแถวไม่มี Content Type ใช้ได้กับทุกอัน) · KOL ที่ไม่มี Content Type เลยถึงจะหยิบชุดแรกที่มี Campaign
// กลุ่มที่บันทึกก่อนมีช่องนี้ = null
// Platform ที่ไม่ใช้ Campaign (ไม่ใช่ TikTok) = null เสมอ แม้ข้อมูลเก่าจะมีค่าค้างอยู่
function resolveGroupCampaign(g, platform, contentType) {
    if (!g) return null;
    if (platform && !CAMPAIGN_PLATFORMS.includes(platform)) return null;
    // Facebook / Instagram: Campaign = content_type ของชุด (ค่าเดียวกัน) — ยึด content_type เพราะแท็บที่เปิดค้างก่อน deploy
    // อาจบันทึกทับจน campaign ว่าง และข้อมูลเก่าอาจมี campaign ค้างเป็นของ TikTok ('Reach')
    // ค่าเดิมที่ไม่ใช่ Campaign (เช่น Instagram 'Review' ที่บันทึกก่อนย้าย) ไม่นับเป็น Campaign — ยังเป็น Content Type เหมือนเดิม
    if (platform && CAMPAIGN_AS_CTYPE.includes(platform)) {
        const hit = (g.allocations || []).find(a => a.platform === platform && SOCIAL_CAMPAIGNS.includes(a.content_type)
            && (!contentType || a.content_type === contentType));
        return hit ? hit.content_type : null;
    }
    const hit = (g.allocations || []).find(a => a.campaign
        && (!platform || !a.platform || a.platform === platform)
        && (!contentType || a.content_type === contentType));
    return hit ? hit.campaign : null;
}

function engagementOf(s) {
    return (Number(s.likes) || 0) + (Number(s.comments) || 0) + (Number(s.saves) || 0)
        + (Number(s.shares) || 0) + (Number(s.reposts) || 0);
}

// คืนค่า stamp ถ้าเพิ่งสแตมป์รอบนี้ / null ถ้ายังไม่ถึงเงื่อนไข
function maybeStamp(s) {
    if (!s || s.perf_stamp) return null;                       // สแตมป์แล้วห้ามแตะซ้ำ
    const spend = Number(s.ad_spend) || 0;
    if (spend < AD_STAMP_AT) return null;
    const views = Number(s.views) || 0;
    // ถึงเกณฑ์แล้วแต่ยังไม่มีผลงาน -> รอไว้ก่อน ไม่งั้นจะล็อกค่าว่างค้างถาวร
    if (views <= 0) return null;
    // ยังไม่ได้ใส่ค่าตัว -> รอไว้ก่อน ไม่งั้นต้นทุนรวมเหลือแค่ค่าแอด CPM/CPE ต่ำเกินจริงแล้วล็อกค้างถาวร
    // (ใส่ค่าตัวเมื่อไหร่ submissions.updateOne เรียกฟังก์ชันนี้ซ้ำ แล้วสแตมป์ตอนนั้นเอง)
    if ((Number(s.budget) || 0) <= 0) return null;
    const engagement = engagementOf(s);
    const totalCost = (Number(s.budget) || 0) + spend;
    const cpm = Number((totalCost / (views / 1000)).toFixed(2));
    const cpe = engagement > 0 ? Number((totalCost / engagement).toFixed(2)) : 0;
    s.perf_stamp = {
        at: now(),
        ad_spend: spend,
        views, engagement,
        er: Number(((engagement / views) * 100).toFixed(2)),
        total_cost: totalCost,
        cpm, cpe,
        verdict: (cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Pass' : 'Fail'
    };
    return s.perf_stamp;
}

// ค่าแอดถึงเกณฑ์แล้วแต่ยังสแตมป์ไม่ได้เพราะรออะไรอยู่ — ให้หน้าเว็บบอกได้ว่าต้องไปกรอกช่องไหน
// 'views' = ยังไม่มียอดวิว · 'fee' = ยังไม่ได้ใส่ค่าตัว
// null = ไม่ได้รออะไร (สแตมป์แล้ว / ค่าแอดยังไม่ถึงเกณฑ์ / ครบแล้วรอสแตมป์รอบถัดไป)
// ลำดับการเช็คต้องตรงกับ maybeStamp: ยอดวิวก่อน แล้วค่อยค่าตัว
function stampWaitReason(s) {
    if (!s || s.perf_stamp) return null;
    if ((Number(s.ad_spend) || 0) < AD_STAMP_AT) return null;
    if ((Number(s.views) || 0) <= 0) return 'views';
    if ((Number(s.budget) || 0) <= 0) return 'fee';
    return null;
}

// ===== คลิปที่ยังไม่ใส่ค่าตัว — กฎชุดเดียวกันทั้งหน้า Dashboard และหน้า Report =====
// ค่าตัว (submissions.budget) เก็บต่อคลิป · 0 / ว่าง = ทีมยังไม่ได้ใส่ (เงื่อนไขเดียวกับ maybeStamp)
// ยอดรวมค่าจ้างยังบวกตามเดิม (0 ไม่ได้เพิ่มอะไร) แต่ CPM/CPE ของคลิปพวกนี้เหลือแค่ค่าแอด หรือเป็น 0
// ซึ่งดูถูกเกินจริง จึงตัดออกจากค่าเฉลี่ย CPM/CPE, แกนคะแนน CPM/CPE และการตัดสิน Good/Improve
function feeMissing(budget) {
    return (Number(budget) || 0) <= 0;
}

// CPM/CPE ของ 1 คลิป — ต้นทุน = ค่าตัว + ค่ายิงแอด
// ยังไม่ใส่ค่าตัว = cpm/cpe เป็น null (ห้ามคืน 0 หรือคิดจากค่าแอดอย่างเดียว เพราะจะดูคุ้มเกินจริง)
function clipCostMetrics({ fee, adSpend, views, engagement }) {
    const f = Number(fee) || 0;
    const cost = f + (Number(adSpend) || 0);
    if (feeMissing(f)) return { fee_missing: true, cost, cpm: null, cpe: null };
    return {
        fee_missing: false, cost,
        cpm: views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0,
        cpe: engagement > 0 ? Number((cost / engagement).toFixed(2)) : 0
    };
}

// has(row) = แถวนี้มีค่าแกนนี้ให้เทียบไหม — แต่ละหน้าคงกติกาเดิมของตัวเองไว้สำหรับคนที่มีค่าตัว
// ค่าเริ่มต้น = ค่ามากกว่า 0 (กติกาเดิมของหน้า Report)
// หน้า Dashboard ส่งกติกาเดิมของตัวเองมา เพื่อให้ค่าที่ถูกมากจนปัดเศษเหลือ 0.00 ยังได้คะแนนเต็ม ไม่กลายเป็นแย่สุด
const hasPositive = key => r => Number(r[key]) > 0;

// ช่วง min/max ของแกน CPM หรือ CPE ที่ใช้เทียบคะแนน (key = 'cpm' | 'cpe')
// นับเฉพาะแถวที่มีค่าตัวและมีค่านั้น (has) — แถวที่ยังไม่ใส่ค่าตัวห้ามเข้ามายืดช่วง
function costAxisRange(rows, key, has = hasPositive(key)) {
    const v = rows.filter(r => !r.fee_missing && r[key] != null && has(r)).map(r => Number(r[key]));
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: 0, max: 0 };
}

// คะแนนแกน CPM/CPE ของ 1 แถว เป็นสัดส่วน 0-1 (ยิ่งต่ำยิ่งได้มาก)
// ยังไม่ใส่ค่าตัว หรือยังไม่มีค่านี้ = 0 (แย่สุดของแกน ไม่ใช่ดีสุด) · ทุกคนเท่ากัน = 1
// has ต้องเป็นตัวเดียวกับที่ส่งให้ costAxisRange ตอนสร้าง range
function costAxisNorm(row, key, range, has = hasPositive(key)) {
    if (row.fee_missing || row[key] == null || !has(row)) return 0;
    if (range.max === range.min) return 1;
    return 1 - (Number(row[key]) - range.min) / (range.max - range.min);
}

// ผ่าน/ไม่ผ่านเกณฑ์คุ้มค่า — ยังไม่ใส่ค่าตัว = null (ยังตัดสินไม่ได้ ไม่นับเป็นทั้ง Good และ Improve)
function perfVerdict({ fee_missing, views, cpm, cpe }) {
    if (fee_missing) return null;
    return (views > 0 && cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Good' : 'Improve';
}

// ค่าเฉลี่ย CPM/CPE ต่อคลิปของหน้า Report — เฉพาะคลิปที่มีค่าตัวและมี reach จากแอดแล้ว
// fee_clips = จำนวนคลิปที่เอามาเฉลี่ยจริง · fee_missing_clips = คลิปที่ยังไม่ใส่ค่าตัว (นับทุกแถวที่รวมอยู่ในยอดค่าจ้าง)
function feeCostAverages(rows) {
    const used = rows.filter(r => !r.fee_missing && r.reach > 0);
    const avg = key => (used.length ? Number((used.reduce((a, r) => a + r[key], 0) / used.length).toFixed(2)) : 0);
    return {
        avg_cpm: avg('cpm'), avg_cpe: avg('cpe'),
        fee_clips: used.length,
        fee_missing_clips: rows.filter(r => r.fee_missing).length
    };
}


// ---------- ทีมตรวจข้อมูลโพสต์ที่เอเจนซี่กรอก ก่อนขึ้นหน้า Ads ----------
// post_check: null = ไม่ต้องตรวจ (ข้อมูลเดิม / ทีมกรอกเอง) · 'pending' รอทีมตรวจ · 'returned' ทีมส่งกลับให้แก้ · 'ok' ทีมยืนยันแล้ว
// · 'changed' เอเจนซี่แก้วันที่/Code expire หลังยิงแอด (ยังอยู่หน้า Ads แต่มีป้ายให้ทีมรับทราบ)
// หน้า Ads แสดงเฉพาะแถวที่ไม่ได้รอตรวจ (null / ok / changed)
const POST_CHECK_FIELDS = ['post_url', 'post_date', 'gencode', 'id_post', 'code_expire'];
const POST_CHECK_WAITING = ['pending', 'returned'];
const postCheckWaiting = s => !!s && POST_CHECK_WAITING.includes(s.post_check);
// สถานะที่ทีมยังต้องตัดสิน/รับทราบ (ปุ่มยืนยันใช้ได้เฉพาะแถวเหล่านี้)
const POST_CHECK_OPEN = ['pending', 'returned', 'changed'];
const postFieldText = (f, v) => (f === 'code_expire' ? String(Number(v) || 60) : String(v == null ? '' : v).trim());

// สถานะตรวจหลังแก้ข้อมูลโพสต์ — before = แถวก่อนแก้ · after = แถวหลังแก้ · actor = 'team' | 'agency'
// คืน null = ไม่ต้องเปลี่ยน (ไม่มีช่องโพสต์ไหนเปลี่ยน / ไม่รู้ว่าใครแก้)
// - ทีมแก้เอง = ตรวจแล้ว ('ok')
// - เอเจนซี่แก้ แต่ยังไม่มีลิงก์/Gencode/ID Post เลย (แจ้งแค่วันลงงาน / ลบลิงก์ทิ้ง) = ไม่มีอะไรให้ตรวจ และไม่ขึ้นหน้า Ads อยู่แล้ว
// - เอเจนซี่แก้แถวที่ยิงแอดแล้ว (เหลือแก้ได้แค่วันที่/Code expire) = 'changed' ยังอยู่หน้า Ads แต่มีป้ายให้ทีมเห็นว่าแก้อะไร
// - เอเจนซี่แก้ที่เหลือ = 'pending' รอทีมตรวจ ถ้าเคยผ่านการตรวจ (หรือเป็นข้อมูลเดิม) จดว่าแก้ช่องไหน เดิม→ใหม่
function nextPostCheck(before, after, actor, byName, at) {
    if (actor !== 'team' && actor !== 'agency') return null;
    const changed = POST_CHECK_FIELDS.filter(f => postFieldText(f, before[f]) !== postFieldText(f, after[f]));
    if (!changed.length) return null;
    const prev = before.post_check || null;
    const cleared = { post_check: null, post_check_by: null, post_check_at: null, post_check_note: null, post_check_changes: null };
    if (actor === 'team') {
        return { post_check: 'ok', post_check_by: byName || null, post_check_at: at, post_check_note: null, post_check_changes: null };
    }
    const hasPost = r => ['post_url', 'gencode', 'id_post'].some(f => postFieldText(f, r[f]) !== '');
    if (!hasPost(after)) return prev ? cleared : null;
    const open = prev !== null && prev !== 'ok';   // ยังค้างจากการแก้รอบก่อน (pending / returned / changed)
    const hadPost = hasPost(before) || postFieldText('post_date', before.post_date) !== '';
    const prevChanges = before.post_check_changes && typeof before.post_check_changes === 'object' && !Array.isArray(before.post_check_changes)
        ? before.post_check_changes : null;
    let changes = null;
    if (!open && hadPost) changes = {};                         // เคยผ่านการตรวจ / ข้อมูลเดิม → เริ่มจดช่องที่แก้
    else if (open && prevChanges) changes = { ...prevChanges };  // ยังค้างจากรอบก่อน → จดต่อจากเดิม
    if (changes) {
        changed.forEach(f => {
            const from = changes[f] ? changes[f].from : postFieldText(f, before[f]);
            const to = postFieldText(f, after[f]);
            if (from === to) delete changes[f]; else changes[f] = { from, to };
        });
    }
    const list = changes && Object.keys(changes).length ? changes : null;
    // ทีมส่งกลับพร้อมเหตุผลไว้ → เก็บเหตุผลไว้ให้ทีมเทียบว่าแก้ตามที่ขอหรือยัง (ล้างตอนทีมยืนยัน)
    const note = open ? (before.post_check_note || null) : null;
    if (before.ad_status === 'ยิงแล้ว') {
        // ยิงแอดแล้ว: ไม่ดึงแถวที่แอดกำลังวิ่งออกจากหน้า Ads · แก้กลับเป็นค่าเดิมหมด = ไม่ต้องแจ้งแล้ว
        if (!list) return prev === 'changed' ? cleared : null;
        return { post_check: 'changed', post_check_by: byName || null, post_check_at: at, post_check_note: note, post_check_changes: list };
    }
    return { post_check: 'pending', post_check_by: byName || null, post_check_at: at, post_check_note: note, post_check_changes: list };
}

// ทีมตัดสินผลตรวจ: 'ok' ยืนยันถูกต้อง (ขึ้นหน้า Ads) · 'return' ส่งกลับให้เอเจนซี่แก้พร้อมเหตุผล
function postCheckDecision(action, note, byName, at) {
    if (action === 'ok') return { post_check: 'ok', post_check_by: byName || null, post_check_at: at, post_check_note: null, post_check_changes: null };
    if (action === 'return') return { post_check: 'returned', post_check_by: byName || null, post_check_at: at, post_check_note: note || null };
    return null;
}

module.exports = {
    GOOD_CPM, GOOD_CPE, TARGET_PLATFORMS, CAMPAIGN_PLATFORMS, CAMPAIGN_AS_CTYPE, SOCIAL_CAMPAIGNS, AD_STAMP_AT, now, clone,
    POST_CHECK_FIELDS, POST_CHECK_OPEN, postCheckWaiting, nextPostCheck, postCheckDecision,
    duplicateError, inScope, scopeProjects, hireRemaining, hireRowFee,
    HIRE_JOB_CLOSED, hireWaiting, hireNeedMore, hireStage,
    BOOK_PENDING, BOOK_FEE, BOOK_OK, HIRE_BOOKED, HIRE_AGREED, bookingState, bookingOpen, hireBookings,
    releaseToRequest, bookingConfirm, bookingFeeDecision, bookingUnavailable, hireBreakdown, jobProgress, pfmManagedSpend,
    adRanBySpend, effectiveAdStatus,
    HIRE_PAYABLE, HIRE_DIRECT_STATUS, newHireRow, payableWithoutFee, isDateStr, clipText, HIRE_SCOPE_MAX, hireScope,
    PERSON_FIELDS, personPatch,
    resolveInside, sameInstant, mergeHireItems, mergeBriefFiles, cleanFee, cleanHeadcount, safeId, safeSlug,
    linkGroupPlatforms, resolveGroupClips, resolveGroupTarget, productCodesIn, carryProductTargets, carryProductBudgets, carryProductConcepts,
    resolveGroupProducts, resolveGroupCtype, resolveGroupMedia, resolveGroupCampaign,
    engagementOf, maybeStamp, stampWaitReason,
    feeMissing, clipCostMetrics, costAxisRange, costAxisNorm, perfVerdict, feeCostAverages
};
