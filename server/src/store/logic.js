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

// ----- การเปลี่ยนขั้นคอนเฟิร์มคิว (ฟังก์ชันบริสุทธิ์: รับ hire_items ทั้งงาน คืน { list, row } หรือ { error }) -----
const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clipText = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; };

function bookingTarget(list, reqKey, rowKey) {
    const arr = Array.isArray(list) ? list : [];
    const req = arr.find(it => it && String(it.key) === String(reqKey));
    if (!req || req.mode !== 'casting') return { error: { code: 404, message: 'ไม่พบใบขอจัดหานี้' } };
    const idx = arr.findIndex(it => it && String(it.key) === String(rowKey));
    const row = idx >= 0 ? arr[idx] : null;
    if (!row || row.mode === 'casting' || row.from_request == null || String(row.from_request) !== String(reqKey)) {
        return { error: { code: 404, message: 'ไม่พบคนที่อนุมัติจากใบขอจัดหานี้' } };
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
        return { error: { code: 409, message: 'คนนี้ไม่ได้อยู่ในขั้นรอคอนเฟิร์มคิวแล้ว — โหลดหน้าใหม่เพื่อดูสถานะล่าสุด' } };
    }
    const b = body && typeof body === 'object' ? body : {};
    const approved = Number(t.row.fee) || 0;
    const asked = cleanFee(b.fee);
    const fee = asked > 0 ? asked : approved;
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
        return { error: { code: 409, message: 'ไม่มีค่าตัวใหม่ที่รออนุมัติสำหรับคนนี้แล้ว — โหลดหน้าใหม่เพื่อดูสถานะล่าสุด' } };
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
        return { error: { code: 409, message: 'คนนี้คอนเฟิร์มคิวแล้ว — ถ้าหลุดงานภายหลัง ให้ทีมแบรนด์ลบออกจากรายชื่อผู้รับงาน (ที่ว่างจะคืนให้ใบเอง)' } };
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
                return out;
            }

            const prevCasting = prev && prev.mode === 'casting' ? prev : null;
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
function resolveGroupTarget(g, platform) {
    if (!g) return null;
    const b = (g.blocks || []).find(x => x.platform === platform);
    if (b) { const t = b.target; return (Array.isArray(t) ? t.length : !!t) ? t : null; }
    return TARGET_PLATFORMS.includes(platform) ? (g.target || null) : null;
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
function resolveGroupCampaign(g, platform, contentType) {
    if (!g) return null;
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


module.exports = {
    GOOD_CPM, GOOD_CPE, TARGET_PLATFORMS, AD_STAMP_AT, now, clone,
    duplicateError, inScope, scopeProjects, hireRemaining, hireRowFee,
    HIRE_JOB_CLOSED, hireWaiting, hireNeedMore, hireStage,
    BOOK_PENDING, BOOK_FEE, BOOK_OK, HIRE_BOOKED, HIRE_AGREED, bookingState, bookingOpen, hireBookings,
    releaseToRequest, bookingConfirm, bookingFeeDecision, bookingUnavailable,
    resolveInside, sameInstant, mergeHireItems, mergeBriefFiles, cleanFee, cleanHeadcount, safeId, safeSlug,
    linkGroupPlatforms, resolveGroupClips, resolveGroupTarget,
    resolveGroupProducts, resolveGroupCtype, resolveGroupMedia, resolveGroupCampaign,
    engagementOf, maybeStamp, stampWaitReason,
    feeMissing, clipCostMetrics, costAxisRange, costAxisNorm, perfVerdict, feeCostAverages
};
