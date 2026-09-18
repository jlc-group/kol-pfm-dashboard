import { useEffect, useState } from 'react';
import { api, uploadFile } from '../api/client.js';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import {
    T, STAGE_LABEL, BOOKING_LABEL, CAND_LABEL, JOB_STATUS_OPTIONS, jobStatusLabel, jobStatusValue,
    PAYABLE_STATUS, feeMissing, needsFee, NEED_FEE_MSG
} from '../data/talentLabels.js';

// ป้ายของขั้นตอน/คนที่เลือกแล้ว/ชื่อที่เสนอ ย้ายไปอยู่ในคำศัพท์ชุดเดียวของหน้า Talent แล้ว
// ส่งต่อจากที่นี่ด้วยชื่อเดิม — ไฟล์อื่นที่ import จากฟอร์มนี้อยู่แล้วไม่ต้องแก้
export { STAGE_LABEL, BOOKING_LABEL, CAND_LABEL };

// ฟอร์มแคมเปญ "Other" — งานจ้างที่ไม่ใช่ KOL (นางแบบ/นักแสดง/Live สด/พิธีกร ฯลฯ)
// ตั้งใจแยกจาก ProjectForm เพราะงานพวกนี้ไม่มี Platform / Content Type / Tier / Gencode / ค่าแอด
// สิ่งที่ต้องรู้จริง ๆ คือ "จ้างใคร ทำอะไร วันไหน เท่าไร" เท่านั้น

export const HIRE_KINDS = ['นางแบบ', 'นายแบบ', 'นักแสดง', 'Live สด', 'พิธีกร', 'ช่างภาพ', 'ช่างวิดีโอ', 'เสียงพากย์', 'Event', 'อื่น ๆ'];
// สถานะของแต่ละคน ไม่ใช่ของทั้งแคมเปญ — คนหนึ่งถ่ายเสร็จแล้วอีกคนเพิ่งเริ่มคุยเป็นเรื่องปกติ
// ค่าในฐานยังเป็นคำเดิม (ทาบทาม = ป้าย "กำลังคุย") — ป้ายที่โชว์ใช้ hireStatusLabel จาก talentLabels.js
export const HIRE_STATUS = ['ทาบทาม', 'ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'];
// ใบขอให้หา (ยังไม่มีตัวคน) เดินสถานะคนละชุด — ต้องหาคนให้ได้ก่อนถึงจะเข้าเส้นเดียวกับแถวที่มีคนแล้ว
export const CASTING_STATUS = ['กำลังหา', 'เสนอชื่อแล้ว', 'ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'];
// แถวเก่าที่บันทึกก่อนมีฟีเจอร์นี้ไม่มี mode — ถือเป็น "มีคนแล้ว" (direct) เสมอ
export const isCasting = it => (it && it.mode) === 'casting';
export const statusesOf = it => (isCasting(it) ? CASTING_STATUS : HIRE_STATUS);
// แถวที่เพิ่งเพิ่มยังไม่ได้เลือกรูปแบบ — ยังไม่ขึ้นช่องกรอกให้รก (ของเก่าในฐานถือเป็น direct เสมอ)
export const hasMode = it => !!it && (it.mode === 'direct' || it.mode === 'casting');

const genKey = () => 'h' + Math.random().toString(36).slice(2, 9);
const num = v => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const S = v => (v == null ? '' : String(v));
// งบของแถว — ใบขอให้หาคิด งบต่อคน × จำนวนคนที่ขอ ส่วนแถวที่มีคนแล้วคือค่าตัวตรง ๆ
// จำนวนคนที่ "ยังต้องหา" ของใบขอให้หา — คนที่หาได้แล้ว (filled) ถูกย้ายไปเป็นแถวของตัวเองแล้ว
export const hireLeft = it => (isCasting(it) ? Math.max(0, (num(it && it.headcount) || 1) - num(it && it.filled)) : 0);
// ต้องตรงกับ hireRowFee ฝั่งเซิร์ฟเวอร์ (server/src/store/logic.js) ไม่งั้นงบสองฝั่งจะไม่ตรงกัน
export const rowFee = it => num(it && it.fee) * (isCasting(it) ? hireLeft(it) : 1);

// ===== ขั้นตอนของใบขอให้หา — ต้องตรงกับ hireWaiting / hireNeedMore / hireStage ฝั่งเซิร์ฟเวอร์ (server/src/store/logic.js) =====
export const HIRE_JOB_CLOSED = ['Completed', 'Cancelled'];
// ชื่อที่ส่งมาแล้วรอทีมเลือก (ในฐานเก็บเป็น 'เสนอ')
export const hireWaiting = it => (isCasting(it)
    ? (Array.isArray(it.candidates) ? it.candidates : []).filter(c => c && (String(c.status || '').trim() || 'เสนอ') === 'เสนอ').length
    : 0);
// คนช่วยหายังต้องหาเพิ่มอีกกี่คน (ชื่อที่รอเลือกอยู่นับว่าหามาให้แล้ว)
export const hireNeedMore = it => Math.max(0, hireLeft(it) - hireWaiting(it));
// ขั้นยืนยันคิวของคนที่เลือกจากใบขอให้หา (hire_items[].booking) — แถวเก่าที่ไม่มี booking ถือว่ายืนยันแล้ว
export const BOOK_PENDING = 'pending';
export const BOOK_FEE = 'fee_review';
export const bookingState = it => (it && it.booking && it.booking.state) || null;
export const bookingOpen = it => bookingState(it) === BOOK_PENDING || bookingState(it) === BOOK_FEE;
// คนที่ได้จากใบ key และยังค้างขั้นยืนยันคิว (items = hire_items ทั้งงาน)
export const hireBookings = (items, key) => (Array.isArray(items) ? items : []).filter(it => it && it.mode !== 'casting'
    && it.from_request != null && key != null && String(it.from_request) === String(key) && bookingOpen(it));
export const hireStage = (it, jobStatus, items) => {
    if (HIRE_JOB_CLOSED.includes(jobStatus)) return 'closed';
    if (hireLeft(it) <= 0) {
        const b = hireBookings(items, it && it.key);
        if (b.some(r => bookingState(r) === BOOK_FEE)) return 'fee';
        if (b.length > 0) return 'booking';
        return 'full';
    }
    if (hireWaiting(it) > 0) return 'deciding';
    if (!it || it.assignee_id === null || it.assignee_id === undefined || it.assignee_id === '') return 'unassigned';
    return 'finding';
};
// แถวใหม่เริ่มที่ "ยังไม่เลือกรูปแบบ" — เลือกจาก dropdown ก่อน ช่องกรอกถึงจะขึ้น
// คนที่มีแล้วเริ่มที่ 'ทาบทาม' (กำลังคุย) เสมอ — ยังไม่รู้ค่าตัวก็บันทึกได้
const newItem = (mode = '') => ({
    key: genKey(), mode: (mode === 'casting' || mode === 'direct') ? mode : '',
    kind: '', name: '', contact: '', agency: '',
    qty: '', fee: '', use_date: '', use_time: '', place: '', link: '', note: '', image: null,
    // เฉพาะใบขอให้หา
    headcount: mode === 'casting' ? '1' : '', spec: '', deadline: '',
    status: mode === 'casting' ? CASTING_STATUS[0] : (mode === 'direct' ? HIRE_STATUS[0] : '')
});
// ของเก่าที่บันทึกไว้อาจไม่มีคีย์ครบ และฐานเก็บช่องว่างเป็น null
// ต้องแปลงเป็นสตริงว่างก่อนเข้าฟอร์ม ไม่งั้น input จะสลับ controlled/uncontrolled และ .trim() ตอนบันทึกจะพัง
const toItem = it => {
    const base = newItem(it && it.mode === 'casting' ? 'casting' : 'direct');
    return {
        ...base, ...it, key: (it && it.key) || base.key,
        mode: base.mode,
        kind: S(it.kind), name: S(it.name), contact: S(it.contact), agency: S(it.agency),
        qty: S(it.qty), fee: it.fee == null ? '' : String(it.fee),
        use_date: S(it.use_date), use_time: S(it.use_time), place: S(it.place), link: S(it.link), note: S(it.note),
        spec: S(it.spec), deadline: S(it.deadline),
        headcount: it.headcount == null ? base.headcount : String(it.headcount),
        image: it.image || null, status: S(it.status) || base.status
    };
};

export default function OtherProjectForm({ editing, onClose, onSaved, onConflict }) {
    const isEdit = !!editing;
    const [form, setForm] = useState({
        name: editing?.name || '',
        brand: editing?.brand || '',
        objective: editing?.objective || '',
        owner: editing?.owner || '',
        creator: editing?.creator || '',
        status: editing?.status || 'Draft'
    });
    const [items, setItems] = useState(() => {
        const src = Array.isArray(editing?.hire_items) ? editing.hire_items : [];
        return src.length ? src.map(toItem) : [newItem()];
    });
    // รูป/คอมการ์ดที่เพิ่งเลือกไว้ (ยังไม่ได้อัป) — คีย์คือ key ของแถว ค่าเป็นไฟล์
    // ต้องอัปหลังบันทึกงานเสร็จ เพราะตอนสร้างใหม่ยังไม่มีรหัสงานให้ผูกไฟล์
    const [rowFiles, setRowFiles] = useState({});
    // แถวที่มีอยู่ในฐานแล้วตอนเปิดฟอร์ม — สลับรูปแบบไม่ได้ และใบขอให้หาที่บันทึกแล้วแก้ในฟอร์มไม่ได้
    // (แก้/เลือกคนช่วยหา/ลบใบทำที่การ์ดในหน้างานที่เดียว ไม่ให้สองที่แก้ของชิ้นเดียวกัน)
    const [savedKeys] = useState(() => new Set((Array.isArray(editing?.hire_items) ? editing.hire_items : [])
        .map(it => it && it.key).filter(Boolean).map(String)));
    // สถานะ/ค่าตัวเดิมของแต่ละแถวตอนเปิดฟอร์ม — ใช้ตัดสินว่าแถว "ตกลงแล้วแต่ไม่มีค่าตัว" เพิ่งถูกแก้ในฟอร์มนี้หรือเป็นของเก่า
    // (ของเก่าที่ไม่ได้แตะต้องบันทึกผ่าน — กติกาเดียวกับ payableWithoutFee ฝั่งเซิร์ฟเวอร์)
    const [savedRows] = useState(() => new Map((Array.isArray(editing?.hire_items) ? editing.hire_items : [])
        .filter(it => it && it.key).map(it => [String(it.key), { status: it.status || '', fee: num(it.fee) }])));
    const isLocked = it => isCasting(it) && savedKeys.has(String(it.key));
    const [error, setError] = useState('');
    const [baseUpdatedAt] = useState(() => (editing && editing.updated_at) || null);
    const [saving, setSaving] = useState(false);
    // [{ id, name }] — ใช้ชื่อสำหรับช่องผู้ดูแลงาน (ของเดิมเก็บเป็นชื่อ)
    // และใช้ id สำหรับคนช่วยหา เพราะงานที่ฝากหาต้องผูกกับบัญชีจริง ไม่ใช่ข้อความชื่อ
    const [people, setPeople] = useState([]);
    useEffect(() => {
        api('/users/options')
            .then(res => setPeople(res.data || []))
            .catch(() => setPeople([]));
    }, []);
    const owners = people.map(u => u.name);

    const { user } = useAuth();
    const brandOpts = visibleBrands(user);
    // ตอนแก้ไข ถ้าแบรนด์เดิมไม่อยู่ในรายการ (เช่นชื่อแบรนด์เก่า) ต้องโชว์ไว้ ไม่งั้นช่องจะว่างแล้วบันทึกไม่ผ่าน
    const keepBrand = isEdit && editing.brand && !brandOpts.includes(editing.brand) ? editing.brand : null;

    function update(k, v) { setForm(f => ({ ...f, [k]: v })); }
    const setItem = (i, k, v) => setItems(list => list.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
    // เพิ่มแถว — ก๊อปประเภทงาน/วันที่/สถานที่ของแถวก่อนหน้ามาให้ (งานกองเดียวกันมักซ้ำกันทั้งชุด)
    // รูปแบบการจ้างไม่ก๊อปมา ต้องเลือกใหม่ทุกแถว ช่องกรอกถึงจะขึ้น
    const addItem = () => setItems(list => {
        const last = list[list.length - 1] || {};
        return [...list, { ...newItem(), kind: last.kind || '', use_date: last.use_date || '', place: last.place || '' }];
    });
    // เลือกคนช่วยหาจากในฟอร์ม — เก็บทั้ง id (ตัวจริงที่ใช้เทียบสิทธิ์) และชื่อ (ไว้โชว์ย้อนหลัง)
    const setAssignee = (i, id) => setItems(list => list.map((x, idx) => {
        if (idx !== i) return x;
        const hit = people.find(u => String(u.id) === String(id));
        return { ...x, assignee_id: id === '' ? null : Number(id), assignee_name: hit ? hit.name : null };
    }));
    // เลือก/สลับรูปแบบของแถว — ต้องย้ายสถานะไปอยู่ในชุดของรูปแบบใหม่ด้วย ไม่งั้นช่องสถานะจะว่าง
    const setMode = (i, mode) => setItems(list => list.map((x, idx) => {
        if (idx !== i || x.mode === mode) return x;
        if (mode !== 'direct' && mode !== 'casting') return { ...x, mode: '' };
        const allowed = mode === 'casting' ? CASTING_STATUS : HIRE_STATUS;
        return {
            ...x, mode,
            headcount: mode === 'casting' ? (x.headcount || '1') : x.headcount,
            status: allowed.includes(x.status) ? x.status : allowed[0]
        };
    }));
    const removeItem = i => setItems(list => list.length > 1 ? list.filter((_, idx) => idx !== i) : list);

    // งบรวมของแคมเปญ = ผลรวมของทุกแถว (ไม่มีช่องให้กรอกงบเอง เพื่อไม่ให้สองตัวเลขขัดกัน)
    // ใบขอให้หานับ งบต่อคน × จำนวนคน เพราะยังไม่รู้ตัวคน แต่รู้กรอบเงินที่จะใช้แล้ว
    const totalFee = items.reduce((s, it) => s + rowFee(it), 0);

    // แถวที่เริ่มกรอกแล้วเท่านั้นถึงจะบันทึก — แถวว่างที่กดเพิ่มไว้เฉย ๆ ไม่ต้องเก็บ
    // แถวที่กดเพิ่มแล้วยังไม่เลือกรูปแบบ (ประเภทงานถูกก๊อปมาจากแถวก่อนให้อัตโนมัติ) ไม่นับว่ากรอกแล้ว — ไม่งั้นได้แถวคนว่าง ๆ ติดไป
    // แถวที่มีอยู่ในฐานแล้วเก็บไว้เสมอ (ลบต้องกดถังขยะเอง ไม่ใช่หายไปเพราะช่องว่าง)
    const rowFilled = it => savedKeys.has(String(it.key)) || (hasMode(it) && (isCasting(it)
        ? !!(it.kind || num(it.fee) > 0 || it.spec.trim())
        : !!(it.name.trim() || num(it.fee) > 0)));
    // แถวที่ครบพอจะนับเป็นรายการจ้างจริง — ต้องเลือกรูปแบบก่อน
    // มีคนแล้ว: ประเภทงาน + ชื่อ (ค่าตัวเว้นได้ — แถวใหม่เป็น "กำลังคุย" ใส่ค่าตัวทีหลังได้)
    // ขอให้ช่วยหา: ประเภทงาน + จำนวนคน + งบต่อคน (คนช่วยหาต้องรู้กรอบเงินก่อนไปคุยกับใคร)
    const rowOk = it => hasMode(it) && (isCasting(it)
        ? !!(it.kind && num(it.headcount) > 0 && num(it.fee) > 0)
        : !!(it.kind && it.name.trim()));
    // แถวที่ "ตกลงแล้ว" ขึ้นไปแต่ค่าตัวว่าง และเพิ่งถูกแก้ในฟอร์มนี้ (แถวใหม่ / สถานะหรือค่าตัวเปลี่ยน)
    // server ตีกลับอยู่แล้ว — เช็คก่อนส่งเพื่อบอกชื่อคนให้ชัด ไม่ต้องรอข้อความจากเซิร์ฟเวอร์
    const feeBlocked = it => {
        if (!hasMode(it) || isCasting(it) || !needsFee(it.status, it.fee)) return false;
        const before = savedRows.get(String(it.key));
        return !before || before.status !== it.status || before.fee !== num(it.fee);
    };

    function validate() {
        const m = [];
        if (!form.name.trim()) m.push('ชื่องาน');
        if (!form.brand) m.push('Brand');
        const itemsOk = items.some(rowOk);
        if (!itemsOk) m.push('รายการจ้าง (เลือกรูปแบบก่อน แล้วกรอก — มีคนแล้ว: ประเภทงาน + ชื่อ · ขอให้ช่วยหา: ประเภทงาน + จำนวนคน + งบต่อคน อย่างน้อย 1 แถว)');
        return m;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!isEdit) {
            const m = validate();
            if (m.length) { setError('กรุณากรอกให้ครบทุกช่อง: ' + m.join(', ')); return; }
        }
        const noFee = items.filter(rowFilled).find(feeBlocked);
        if (noFee) { setError(`ใส่ค่าตัวของ "${noFee.name.trim() || 'คนนี้'}" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้`); return; }
        setError(''); setSaving(true);
        try {
            // เก็บเฉพาะแถวที่กรอกจริง — แถวว่างที่กดเพิ่มไว้แล้วไม่ได้ใช้ไม่ต้องบันทึก
            const hire_items = items
                .filter(rowFilled)
                .map(it => {
                    const casting = isCasting(it);
                    return {
                        key: it.key, mode: casting ? 'casting' : 'direct',
                        kind: it.kind || null, name: casting ? null : (it.name.trim() || null),
                        contact: casting ? null : (it.contact.trim() || null),
                        agency: casting ? null : (it.agency.trim() || null),
                        qty: casting ? null : (it.qty.trim() || null),
                        // ใบขอให้หา: fee คือ "งบต่อคน" — จำนวนคนอยู่ที่ headcount
                        fee: num(it.fee),
                        headcount: casting ? Math.max(1, num(it.headcount), Number(it.filled) || 0) : null,
                        spec: casting ? (it.spec.trim() || null) : null,
                        deadline: casting ? (it.deadline || null) : null,
                        // คนช่วยหาเลือกได้ในฟอร์ม (server ตรวจกับฐานผู้ใช้อีกชั้น)
                        // ส่วนฟิลด์ที่ระบบเป็นคนตั้ง — รายชื่อที่เสนอ / จำนวนที่หาได้แล้ว / คนขอ / ไฟล์แนบ / ใบต้นทาง —
                        // ไม่ต้องส่ง: server ยึดของในฐานเสมอ (ป้องกันหน้าเว็บที่ถือข้อมูลเก่าเขียนทับงานของคนอื่น)
                        assignee_id: casting ? (it.assignee_id == null ? null : it.assignee_id) : null,
                        use_date: it.use_date || null, place: it.place.trim() || null,
                        // เวลาใช้งาน (คนช่วยหาใส่ตอนยืนยันคิว) — ใบขอให้หาไม่ส่ง server จะคงของเดิมไว้
                        use_time: casting ? undefined : (it.use_time.trim() || null),
                        link: casting ? null : (it.link.trim() || null),
                        status: it.status || (casting ? CASTING_STATUS[0] : HIRE_STATUS[0]),
                        note: it.note.trim() || null
                    };
                });
            const useDates = hire_items.map(it => it.use_date).filter(Boolean).sort();
            const body = {
                campaign_type: 'other',
                name: form.name,
                brand: form.brand,
                objective: form.objective || null,
                hire_items,
                owner: form.owner || null,
                creator: form.creator || null,
                budget: hire_items.reduce((s, it) => s + rowFee(it), 0),
                // งานจ้างอื่น ๆ ไม่มีเป้าคลิป/สินค้า/กลุ่มโฆษณา — ส่งค่าว่างไปให้ชัด ไม่ปล่อยให้ค้างค่าเก่า
                kol_target: 0,
                products: [],
                ad_groups: [],
                // ช่วงเวลาของงานคิดจากวันใช้งานของรายการจ้าง — ฟอร์มไม่มีช่องให้กรอกแล้ว
                // ต้องมีค่าเสมอถ้าพอคิดได้ ไม่งั้นแคมเปญจะหายจากตัวกรองเดือน/ปีในหน้าแคมเปญ
                // ตอนแก้ไข ถ้ายังไม่มีแถวไหนระบุวันเลย ให้คงของเดิมไว้ ไม่ใช่ล้างทิ้ง
                start_date: useDates[0] || (isEdit ? (editing.start_date || null) : null),
                end_date: useDates[useDates.length - 1] || (isEdit ? (editing.end_date || null) : null)
            };
            if (isEdit) body.status = form.status;
            // เวลาแก้ล่าสุดของข้อมูลที่ฟอร์มนี้เปิดมา — ถ้าระหว่างนั้นมีคนเสนอชื่อ/เลือกคนในใบขอให้หา
            // server จะตีกลับแทนการเขียนทับเงียบ ๆ (รายการจ้างเก็บเป็นก้อนเดียว ทับแล้วของคนอื่นหายทั้งแถว)
            if (isEdit) body.expected_updated_at = baseUpdatedAt;
            // ประเภทแคมเปญเปลี่ยนทีหลังไม่ได้ (server ตีกลับ) — ตอนแก้ไขจึงไม่ส่งไปซ้ำ
            if (isEdit) delete body.campaign_type;

            const res = isEdit
                ? await api(`/projects/${editing.id}`, { method: 'PUT', body })
                : await api('/projects', { method: 'POST', body });
            const saved = res.data;
            // อัปรูป/คอมการ์ดทีละแถวหลังบันทึก — อ้างแถวด้วย key ชุดเดียวกับที่เพิ่งบันทึกไป
            const pid = isEdit ? editing.id : saved.id;
            for (const [key, file] of Object.entries(rowFiles)) {
                try { await uploadFile(`/projects/${pid}/hires/${key}/image`, file); }
                catch (err) { alert(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`); }
            }
            onSaved(saved);
        } catch (err) {
            if (err.status === 409) {
                // ค่าในฟอร์มเก่ากว่าในฐานแล้ว — รวมให้อัตโนมัติไม่ปลอดภัย (อาจทับรายชื่อที่คนช่วยหาเพิ่งส่งมา)
                // จึงให้หน้าแม่โหลดค่าล่าสุดไว้ แล้วบอกให้เปิดฟอร์มใหม่
                if (onConflict) onConflict();
                setError('ข้อมูลของงานนี้เพิ่งเปลี่ยนระหว่างที่ฟอร์มเปิดอยู่ (เช่น มีคนส่งชื่อหรือเลือกคนในใบขอให้หา) — ปิดฟอร์มแล้วเปิดใหม่เพื่อแก้จากค่าล่าสุด ค่าที่พิมพ์ในฟอร์มนี้ยังไม่ถูกบันทึก');
            } else {
                setError(err.message);
            }
        } finally {
            setSaving(false);
        }
    }

    const missing = validate();
    const canSubmit = isEdit || missing.length === 0;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{isEdit ? 'แก้ไขงานจ้าง' : 'สร้างงานจ้าง (Talent)'}</h3>
                    <button type="button" className="modal-x" onClick={onClose}>×</button>
                </div>
                <p className="ctype-lead">งานจ้างนอกเหนือจาก KOL — ไม่เข้าหน้าโฆษณาและรายงานแคมเปญ แต่ค่าตัวยังเข้ารอบทำจ่ายตามปกติ</p>

                <form onSubmit={handleSubmit}>

                    <div className="field-row">
                        <div className="field">
                            <label>Brand</label>
                            <select value={form.brand} onChange={e => update('brand', e.target.value)}>
                                <option value="">{brandOpts.length || keepBrand ? 'เลือกแบรนด์' : 'ยังไม่ได้รับสิทธิ์แบรนด์ — ติดต่อผู้ดูแลระบบ'}</option>
                                {brandOpts.map(b => <option key={b} value={b}>{b}</option>)}
                                {keepBrand && <option value={keepBrand}>{keepBrand}</option>}
                            </select>
                        </div>
                        {isEdit && (
                            <div className="field">
                                <label>สถานะ</label>
                                {/* งาน Draft โชว์เป็น "กำลังทำ" (ป้ายเดียวกัน) — ค่าในฐานคง Draft ไว้จนกว่าจะเลือกสถานะอื่นเอง */}
                                <select value={jobStatusValue(form.status)} onChange={e => update('status', e.target.value)}>
                                    {JOB_STATUS_OPTIONS.map(s => <option key={s} value={s}>{jobStatusLabel(s)}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="field">
                        <label>ชื่องาน *</label>
                        <input value={form.name} onChange={e => update('name', e.target.value)}
                            placeholder="เช่น ถ่าย Lookbook คอลเลกชันใหม่" required autoFocus />
                    </div>

                    <div className="field">
                        <label>รายละเอียดงาน</label>
                        <textarea rows="3" value={form.objective}
                            onChange={e => update('objective', e.target.value)}
                            placeholder="รายละเอียดของงาน..." />
                    </div>

                    {/* รายการจ้าง — 1 แถว = คน 1 คน (คนเดิมจ้างสองงานคนละวัน ให้แยกสองแถว ค่าตัวจะได้ตรง) */}
                    <div className="field">
                        <label>รายการจ้าง <span className="dash-section-sub">เลือกรูปแบบได้ทีละแถว — "มีคนแล้ว" ถ้าได้ตัวคนแล้ว หรือ "ขอให้ช่วยหา" ถ้ายังไม่มีคนในใจ</span></label>

                        {items.map((it, i) => (
                            <div className={'hire-row' + (isCasting(it) ? ' casting' : '')} key={it.key}>
                                <div className="hire-row-head">
                                    <span className="hire-row-no">#{i + 1}</span>
                                    <span className="hire-mode-hint">
                                        {isLocked(it)
                                            ? `${T.request}ที่บันทึกแล้ว`
                                            : bookingOpen(it)
                                            ? `เลือกจาก${T.request}แล้ว · ${BOOKING_LABEL[bookingState(it)]} (สถานะจะเปลี่ยนเองเมื่อ${T.confirmQueue})`
                                            : !hasMode(it)
                                            ? 'เลือกรูปแบบการจ้างก่อน แล้วช่องกรอกจะขึ้นให้'
                                            : isCasting(it)
                                                ? 'ยังไม่มีคนในใจ — ระบุสเปค จำนวนคน และงบต่อคนไว้ก่อน แล้วคนช่วยหาจะส่งรายชื่อมาให้เลือก'
                                                : 'มีชื่อคนหรือเอเจนซี่ในมือแล้ว — กรอกชื่อได้เลย ค่าตัวยังไม่รู้ก็เว้นไว้ได้'}
                                    </span>
                                    {rowFee(it) > 0 && (
                                        <span className="hire-row-sum">
                                            ฿{rowFee(it).toLocaleString('th-TH')}
                                            {isCasting(it) && num(it.headcount) > 1 && <span className="hire-row-sum-x"> ({num(it.fee).toLocaleString('th-TH')} × {num(it.headcount)})</span>}
                                        </span>
                                    )}
                                    {items.length > 1 && !isLocked(it) && (
                                        <button type="button" className="hire-del" title="ลบแถวนี้" onClick={() => {
                                            // คนที่ได้จากใบขอให้หา — ลบแล้วที่ว่างจะคืนให้ใบ (บอกก่อน จะได้ไม่ตกใจว่าใบกลับมาต้องหาคน)
                                            if (it.from_request && savedKeys.has(String(it.key))
                                                && !window.confirm(`"${it.name || 'คนนี้'}" ได้มาจาก${T.request} — ลบแล้วที่ว่างจะคืนให้ใบนั้นหาคนใหม่ (บันทึกฟอร์มแล้วจึงมีผล) ต้องการลบไหม?`)) return;
                                            removeItem(i);
                                        }}>
                                            <Icon name="trash" size={14} />
                                        </button>
                                    )}
                                </div>

                                {isLocked(it) ? (
                                    <div className="hire-locked">
                                        <div className="hire-locked-main">
                                            <b>{it.kind || 'ไม่ระบุประเภทงาน'}</b>
                                            {' · '}{hireLeft(it) > 0 ? `ต้องหาอีก ${hireLeft(it)} จาก ${num(it.headcount) || 1} คน` : 'ได้ครบแล้ว'}
                                            {' · '}฿{num(it.fee).toLocaleString('th-TH')} / คน
                                            {' · '}{it.assignee_name ? `${T.finder}: ${it.assignee_name}` : `ยังไม่ได้เลือก${T.finder}`}
                                        </div>
                                        <div className="hire-locked-note">
                                            แก้รายละเอียด เลือก{T.finder} หรือลบใบนี้ ได้ที่การ์ดของใบในหน้างาน (ปิดฟอร์มนี้แล้วเลื่อนไปที่ส่วน "{T.request}")
                                        </div>
                                    </div>
                                ) : (
                                <div className="hire-grid">
                                    <label className="hire-f">
                                        <span>รูปแบบการจ้าง *</span>
                                        {savedKeys.has(String(it.key)) ? (
                                            // แถวที่บันทึกแล้วสลับรูปแบบไม่ได้ — ข้อมูลของรูปแบบเดิม (ชื่อ ไฟล์ ค่าตัว) จะหาย
                                            <div className="hire-mode-fixed">มีคนแล้ว (ระบุชื่อ)</div>
                                        ) : (
                                            <select value={it.mode} onChange={e => setMode(i, e.target.value)}>
                                                {/* ตัวเลือกว่างมีเฉพาะตอนยังไม่ได้เลือก — เลือกแล้วย้อนกลับไปว่างไม่ได้ ข้อมูลที่กรอกจะได้ไม่หาย */}
                                                {!hasMode(it) && <option value="">— เลือก —</option>}
                                                <option value="direct">มีคนแล้ว (ระบุชื่อ)</option>
                                                <option value="casting">ขอให้ช่วยหา</option>
                                            </select>
                                        )}
                                    </label>
                                    {hasMode(it) && (<>
                                    <label className="hire-f">
                                        <span>ประเภทงาน *</span>
                                        <select value={it.kind} onChange={e => setItem(i, 'kind', e.target.value)}>
                                            <option value="">— เลือก —</option>
                                            {HIRE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                                        </select>
                                    </label>
                                    {!isCasting(it) ? (
                                        <>
                                            <label className="hire-f">
                                                <span>ชื่อผู้รับงาน *</span>
                                                <input value={it.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
                                            </label>
                                            <label className="hire-f">
                                                <span>{T.contact}</span>
                                                <input value={it.contact} onChange={e => setItem(i, 'contact', e.target.value)} placeholder="เบอร์ / LINE / IG" />
                                            </label>
                                            <label className="hire-f">
                                                <span>สังกัด / เอเจนซี่</span>
                                                <input value={it.agency} onChange={e => setItem(i, 'agency', e.target.value)} placeholder="ไม่มีก็เว้นไว้" />
                                            </label>
                                            <label className="hire-f">
                                                <span>ระยะเวลาทำงาน</span>
                                                <input value={it.qty} onChange={e => setItem(i, 'qty', e.target.value)} placeholder="เช่น 2 วัน หรือ 3 รอบไลฟ์" />
                                            </label>
                                            <label className="hire-f">
                                                {/* ค่าตัวบังคับเฉพาะคนที่ "ตกลงแล้ว" ขึ้นไป — คนที่ยังกำลังคุยบันทึกไว้ก่อนได้ */}
                                                <span>ค่าตัว (บาท){PAYABLE_STATUS.includes(it.status) ? ' *' : ''}</span>
                                                <input inputMode="numeric" value={it.fee}
                                                    onChange={e => setItem(i, 'fee', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
                                                {feeBlocked(it)
                                                    ? <span className="tc-need-fee">{NEED_FEE_MSG}</span>
                                                    : feeMissing(it.fee) && !PAYABLE_STATUS.includes(it.status)
                                                        ? <span className="cast-sub">ยังไม่รู้ก็เว้นไว้ได้ — ใส่ทีหลังได้</span>
                                                        : null}
                                            </label>
                                            <div className="hire-f">
                                                <span>วันที่ใช้งาน</span>
                                                <DatePicker value={it.use_date} onChange={v => setItem(i, 'use_date', v)} />
                                            </div>
                                            <label className="hire-f">
                                                <span>เวลา</span>
                                                <input value={it.use_time} maxLength={60} onChange={e => setItem(i, 'use_time', e.target.value)} placeholder="เช่น 09:00-17:00" />
                                            </label>
                                        </>
                                    ) : (
                                        <>
                                            <label className="hire-f">
                                                <span>จำนวนคนที่ต้องการ *</span>
                                                <input inputMode="numeric" value={it.headcount}
                                                    onChange={e => setItem(i, 'headcount', e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" />
                                                {num(it.filled) > 0 && (
                                                    <span className="cast-sub">หาได้แล้ว {num(it.filled)} คน — ลดต่ำกว่านี้ไม่ได้</span>
                                                )}
                                            </label>
                                            <label className="hire-f">
                                                <span>งบต่อคน (บาท) *</span>
                                                <input inputMode="numeric" value={it.fee}
                                                    onChange={e => setItem(i, 'fee', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
                                            </label>
                                            <div className="hire-f">
                                                <span>วันที่ต้องใช้งาน</span>
                                                <DatePicker value={it.use_date} onChange={v => setItem(i, 'use_date', v)} />
                                            </div>
                                            <div className="hire-f">
                                                <span>กำหนดส่งรายชื่อ</span>
                                                <DatePicker value={it.deadline} onChange={v => setItem(i, 'deadline', v)} />
                                            </div>
                                            <label className="hire-f">
                                                <span>{T.finder}</span>
                                                <select value={it.assignee_id == null ? '' : String(it.assignee_id)}
                                                    onChange={e => setAssignee(i, e.target.value)}>
                                                    <option value="">— ไว้เลือกทีหลัง —</option>
                                                    {people.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                                                    {/* คนที่เคยรับงานแต่ไม่อยู่ในรายชื่อแล้ว ต้องยังโชว์ ไม่งั้นกดบันทึกแล้วงานหลุดมือเงียบ ๆ */}
                                                    {it.assignee_id != null && !people.some(u => String(u.id) === String(it.assignee_id)) && (
                                                        <option value={String(it.assignee_id)}>{it.assignee_name || `ผู้ใช้ #${it.assignee_id}`}</option>
                                                    )}
                                                </select>
                                            </label>
                                        </>
                                    )}
                                    <label className="hire-f">
                                        <span>สถานที่</span>
                                        <input value={it.place} onChange={e => setItem(i, 'place', e.target.value)} placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                                    </label>
                                    {isCasting(it) && (
                                        <label className="hire-f wide">
                                            <span>สเปคที่ต้องการ</span>
                                            <textarea rows="2" value={it.spec} onChange={e => setItem(i, 'spec', e.target.value)}
                                                placeholder="เช่น หญิง 20-25 ปี สูง 165 ขึ้นไป เคยถ่ายงานสกินแคร์" />
                                        </label>
                                    )}
                                    {!isCasting(it) && (<>
                                    <div className="hire-f wide">
                                        <span>รูป / คอมการ์ด</span>
                                        <div className="pbrief-row">
                                            <label className={'pbrief-file-btn' + ((rowFiles[it.key] || it.image) ? ' has-file' : '')}>
                                                <Icon name="upload" size={14} /> {rowFiles[it.key] ? rowFiles[it.key].name : (it.image ? it.image.original : 'อัปโหลดรูป หรือ PDF คอมการ์ด')}
                                                <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf"
                                                    onChange={e => { const f = e.target.files[0]; if (f) setRowFiles(m => ({ ...m, [it.key]: f })); }} />
                                            </label>
                                            {rowFiles[it.key] && (
                                                <button type="button" className="pbrief-file-clear" title="เอาไฟล์ที่เพิ่งเลือกออก"
                                                    onClick={() => setRowFiles(m => { const n = { ...m }; delete n[it.key]; return n; })}>×</button>
                                            )}
                                        </div>
                                    </div>
                                    <label className="hire-f wide">
                                        <span>ลิงก์ Account / Social Media</span>
                                        <input type="url" value={it.link} onChange={e => setItem(i, 'link', e.target.value)} placeholder="IG / TikTok / Facebook ของผู้รับงาน (https://...)" />
                                    </label>
                                    </>)}
                                    <label className="hire-f wide">
                                        <span>{T.note}</span>
                                        <input value={it.note} onChange={e => setItem(i, 'note', e.target.value)} placeholder="เงื่อนไข ข้อตกลง หรือสิ่งที่ต้องจำ" />
                                    </label>
                                    </>)}
                                </div>
                                )}
                            </div>
                        ))}

                        <button type="button" className="btn-ghost hire-add" onClick={addItem}>
                            <Icon name="plus" size={15} /> เพิ่มรายการจ้าง
                        </button>

                        <div className="hire-total">
                            งบรวมทั้งงาน <b>฿{totalFee.toLocaleString('th-TH')}</b>
                            <span className="hire-total-note">ค่าตัวของคนที่มีแล้ว + (งบต่อคน × จำนวนคน) ของ{T.request}</span>
                        </div>
                    </div>

                    {/* ผู้ดูแลงาน (เก็บในช่อง creator เหมือนเดิม) — อยู่ท้ายฟอร์มตามที่ทีมขอ (ทีมใช้บัญชีเดียวร่วมกัน ระบบบันทึกได้แค่ "System Admin" ต้องเลือกชื่อจริงเอง) */}
                    <div className="field">
                        <label>{T.owner}</label>
                        <select value={form.creator} onChange={e => update('creator', e.target.value)}>
                            <option value="">— เลือก —</option>
                            {owners.map(n => <option key={n} value={n}>{n}</option>)}
                            {form.creator && !owners.includes(form.creator) && <option value={form.creator}>{form.creator}</option>}
                        </select>
                    </div>

                    {error && <div className="alert-error">{error}</div>}
                    {!isEdit && missing.length > 0 && (
                        <div className="form-missing-hint">⚠️ กรุณากรอกให้ครบก่อนบันทึก: {missing.join(' · ')}</div>
                    )}
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving || !canSubmit}>
                            {saving ? 'กำลังบันทึก...' : (isEdit ? 'บันทึกการแก้ไข' : 'สร้างงานจ้าง')}
                        </button>
                    </div>
                </form>

            </div>
        </div>
    );
}
