import { useEffect, useId, useRef, useState } from 'react';
import { api, uploadFile, fileBlobUrl } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import DatePicker from '../../components/DatePicker.jsx';
import SideDrawer from '../../components/SideDrawer.jsx';
import FilePreviewModal from '../../components/FilePreviewModal.jsx';
import { HIRE_KINDS } from '../../components/OtherProjectForm.jsx';
import {
    T, BOOKING_LABEL, PAYABLE_STATUS, feeMissing, NEED_FEE_MSG, hireStatusLabel
} from '../../data/talentLabels.js';
import { PERSON_STEPS, PERSON_STEP_LABEL } from '../../data/hireProgress.js';

// ลิ้นชักแก้ "คนหนึ่งคน" ในหน้างาน Talent — แทนตารางที่แก้ในหน้าแล้วต้องกดแถบบันทึกทั้งงาน
// บันทึกผ่าน PATCH /projects/:id/hires/:key/person ส่งเฉพาะช่องที่แก้ (set) + ค่าที่หน้านี้เห็นก่อนแก้ (expect)
// server เทียบ expect ทีละช่อง: ถ้ามีคนแก้ช่องเดียวกันไปก่อน → 409 แล้วหน้าแม่โหลดค่าล่าสุดมาให้ (ช่องที่เราแก้ค้างไว้ยังอยู่)
// ช่องที่คนอื่นแก้แต่เราไม่ได้แตะ ไม่ชนกัน — คนช่วยหาส่งชื่อเข้าใบอยู่ก็ไม่ทำให้บันทึกคนนี้ไม่ผ่าน

const TALKING = 'ทาบทาม';
const MAX_FILE = 10 * 1024 * 1024;
const FILE_OK = /\.(png|jpe?g|webp|pdf)$/i;
const IMG_OK = /\.(png|jpe?g|webp|gif)$/i;
// ความยาวสูงสุด — ตรงกับที่ server ตัด (newHireRow ใน server/src/store/logic.js)
const MAXLEN = { name: 200, kind: 100, contact: 200, agency: 200, qty: 100, use_time: 60, place: 200, link: 1000, note: 1000 };
const TEXTS = ['use_time', 'place', 'contact', 'agency', 'qty', 'link', 'note'];
const FIELDS = ['name', 'kind', 'fee', 'status', 'use_date', ...TEXTS];
const FIELD_LABEL = {
    name: 'ชื่อ', kind: 'ประเภทงาน', fee: 'ค่าตัว', status: 'คุยถึงไหนแล้ว', use_date: 'วันที่', use_time: 'เวลา',
    place: 'สถานที่', contact: T.contact, agency: 'สังกัด', qty: 'ระยะเวลาทำงาน', link: 'ลิงก์ Account/Social', note: T.note
};
const STEP_HINT = {
    'ทาบทาม': 'ยังไม่ได้ตกลงค่าตัวหรือวัน',
    'ตกลงแล้ว': 'ตกลงค่าตัวแล้ว นับเป็นเงินที่ต้องจ่าย',
    'ถ่ายเสร็จ': 'ทำงานเสร็จแล้ว',
    'ส่งงานแล้ว': 'ส่งไฟล์/งานครบแล้ว'
};

const S = v => (v == null ? '' : String(v));
const num = v => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const digits = v => String(v || '').replace(/[^0-9]/g, '');
// ไฟล์แนบเป็นรูปไหม (ดูจากชื่อไฟล์ — PDF คอมการ์ดโชว์เป็นไอคอน ไม่โหลดมาทำรูปย่อ)
export const isImageFile = meta => !!meta && IMG_OK.test(String(meta.original || meta.filename || ''));

// แถวในฐาน → ค่าในฟอร์ม (สตริงทั้งหมด ไม่งั้น input สลับ controlled/uncontrolled)
const toForm = r => ({
    name: S(r && r.name), kind: S(r && r.kind),
    fee: Number(r && r.fee) > 0 ? String(Number(r.fee)) : '',
    status: S(r && r.status), use_date: S(r && r.use_date).slice(0, 10),
    use_time: S(r && r.use_time), place: S(r && r.place), contact: S(r && r.contact), agency: S(r && r.agency),
    qty: S(r && r.qty), link: S(r && r.link), note: S(r && r.note)
});
// "แก้แล้วไหม" — เว้นวรรคหัวท้ายไม่นับ · ค่าตัวเทียบเป็นตัวเลข
const same = (k, a, b) => (k === 'fee' ? num(a) === num(b) : String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim());
// ค่าที่ส่งไปบันทึก — ช่องข้อความที่ลบจนว่างส่ง null (รูปเดียวกับฟอร์มสั้น)
const outVal = (k, v) => {
    if (k === 'fee') return num(v);
    if (k === 'use_date') return v || null;
    if (k === 'status') return v;
    if (k === 'name' || k === 'kind') return String(v).trim();
    return String(v).trim() || null;
};
const rawOf = (r, k) => (r && r[k] !== undefined ? r[k] : null);
const statusLabel = s => PERSON_STEP_LABEL[s] || hireStatusLabel(s) || 'ยังไม่ระบุ';

// ===== รูปย่อของคน (ใช้ทั้งในรายการหน้างานและในลิ้นชัก) =====
// โหลดรูปผ่าน token เป็น blob เฉพาะตอนแถวเลื่อนมาใกล้จอ (งานใหญ่มีหลายสิบคน) แล้วคืนหน่วยความจำตอนเลิกใช้
// ไม่มีรูป → ตัวอักษรแรกของชื่อ · PDF → ป้าย PDF
const THAI_LEAD = /[เแโใไ]/;
function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = w => { const cs = Array.from(w); return cs.find(ch => !THAI_LEAD.test(ch)) || cs[0]; };
    const a = first(words[0]);
    if (/^[A-Za-z]/.test(a) && words[1] && /^[A-Za-z]/.test(words[1])) return (a + first(words[1])).toUpperCase();
    return a.toUpperCase();
}
const tone = name => 'c' + (Array.from(String(name || '')).reduce((s, ch) => s + ch.codePointAt(0), 0) % 5);

// เก็บ URL ของรูปที่โหลดแล้ว (ตาม sig = path + ชื่อไฟล์) ไว้ใช้ซ้ำทั้งหน้า · เก็บไม่เกิน THUMB_MAX รูป เกินแล้วคืนหน่วยความจำรูปเก่าสุด
const THUMB_MAX = 60;
const thumbCache = new Map();   // sig → Promise<url | ''>
function cachedThumb(sig, path) {
    if (thumbCache.has(sig)) {
        const p = thumbCache.get(sig);
        thumbCache.delete(sig); thumbCache.set(sig, p);   // ใช้ล่าสุด → ไปท้ายคิว
        return p;
    }
    const p = fileBlobUrl(path)
        .then(r => {
            if (String(r.type || '').startsWith('image/')) return r.url;
            URL.revokeObjectURL(r.url);
            return '';
        })
        .catch(() => { thumbCache.delete(sig); return ''; });   // โหลดไม่ได้ → ครั้งหน้าลองใหม่
    thumbCache.set(sig, p);
    while (thumbCache.size > THUMB_MAX) {
        const [oldSig, oldP] = thumbCache.entries().next().value;
        thumbCache.delete(oldSig);
        oldP.then(u => { if (u) URL.revokeObjectURL(u); });
    }
    return p;
}

export function PersonThumb({ projectId, row, size = 'sm' }) {
    const meta = (row && row.image) || null;
    const img = isImageFile(meta);
    const path = img ? `/projects/${projectId}/hires/${encodeURIComponent(row.key)}/image` : '';
    // รูปที่อัปใหม่ได้ชื่อไฟล์ใหม่ → โหลดใหม่ (URL ของ API เดิม แต่เนื้อไฟล์เปลี่ยน)
    const sig = img ? `${path}|${meta.filename || ''}|${meta.uploaded_at || ''}` : '';
    const box = useRef(null);
    const [src, setSrc] = useState({ sig: '', url: '' });

    useEffect(() => {
        if (!sig) return undefined;
        let alive = true;
        let io = null;
        // รูปอยู่ในที่เก็บกลาง — เลิกใช้แล้วไม่คืนหน่วยความจำเอง (แถวอื่น/รอบหน้ายังใช้ได้) ที่เก็บคืนให้เองเมื่อเกินจำนวน
        const load = () => cachedThumb(sig, path).then(url => { if (alive && url) setSrc({ sig, url }); });
        const el = box.current;
        if (el && typeof window !== 'undefined' && 'IntersectionObserver' in window) {
            io = new IntersectionObserver(entries => {
                if (entries.some(e => e.isIntersecting)) { io.disconnect(); io = null; load(); }
            }, { rootMargin: '200px' });
            io.observe(el);
        } else {
            load();
        }
        return () => { alive = false; if (io) io.disconnect(); };
    }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps

    const cls = 'tj-thumb' + (size === 'lg' ? ' lg' : '');
    if (meta && !img) {
        return <span className={cls + ' pdf'} ref={box} aria-hidden="true"><Icon name="file" size={size === 'lg' ? 22 : 16} />PDF</span>;
    }
    const url = src.sig === sig ? src.url : '';
    return (
        <span className={cls + (url ? '' : ' ' + tone(row && row.name))} ref={box} aria-hidden="true">
            {url ? <img src={url} alt="" /> : initials(row && row.name)}
        </span>
    );
}

function Field({ label, req, hint, err, htmlFor, labelId, children }) {
    return (
        <div className={'qf-field' + (err ? ' has-err' : '')}>
            {label && (htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</label>
                : <div className="qf-label" id={labelId}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</div>)}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}

// row = แถวสดของคนนี้จากหน้าแม่ (หน้าแม่หามาใหม่ทุก render) · locked = ยังรอยืนยันคิวในใบที่ยังอยู่ (server ล็อกการเปลี่ยนสถานะ)
// focusFee = เปิดมาจากปุ่ม "ใส่ค่าตัวแล้วตกลง" · agreeOnFee = สถานะที่จะตั้งให้เองเมื่อใส่ค่าตัว (null = ไม่ตั้งให้)
// onSaved(data, name) / onRemoved(items, name) / onFileChanged(items) / onStale() / onOpenRequest(requestKey)
export default function PersonDrawer({
    projectId, row, locked = false, focusFee = false, agreeOnFee = null,
    onClose, onSaved, onRemoved, onFileChanged, onStale, onOpenRequest
}) {
    const uid = useId();
    const id = s => `${uid}-${s}`;
    // base = แถวที่ฟอร์มนี้ตั้งต้น (ค่าที่ส่งเป็น expect) — เปลี่ยนเมื่อหน้าแม่โหลดค่าใหม่มา
    const [base, setBase] = useState(row);
    const [f, setF] = useState(() => toForm(row));
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState('');              // '' | 'save' | 'remove' | 'upload'
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [feeNote, setFeeNote] = useState('');
    const [fileErr, setFileErr] = useState('');
    const [preview, setPreview] = useState(false);
    const [askRemove, setAskRemove] = useState(false);
    const wrapRef = useRef(null);
    const feeRef = useRef(null);
    const noKey = !!(row && row._nokey);

    // หน้าแม่โหลดแถวนี้ใหม่ (หลัง 409 / แนบรูป / มีคนอื่นแก้) → ตั้งต้นใหม่จากค่าล่าสุด
    // ช่องที่ผู้ใช้ยังไม่ได้แตะรับค่าใหม่ไปเลย ช่องที่แก้ค้างไว้คงค่าที่พิมพ์ (บอกว่าช่องไหนมีคนแก้ชนกัน)
    const rowSig = JSON.stringify([FIELDS.map(k => rawOf(row, k)), rawOf(row, 'image'), rawOf(row, 'booking')]);
    const sigRef = useRef(rowSig);
    useEffect(() => {
        if (rowSig === sigRef.current) return;
        sigRef.current = rowSig;
        const was = toForm(base);
        const now = toForm(row);
        const clash = FIELDS.filter(k => !same(k, f[k], was[k]) && !same(k, was[k], now[k]) && !same(k, f[k], now[k]));
        setF(cur => {
            const next = { ...cur };
            FIELDS.forEach(k => { if (same(k, cur[k], was[k])) next[k] = now[k]; });
            return next;
        });
        setBase(row);
        if (clash.length) setInfo(`มีคนแก้ ${clash.map(k => FIELD_LABEL[k]).join(', ')} ไปก่อนแล้ว — ช่องนี้ยังเป็นค่าที่คุณพิมพ์ไว้ ตรวจอีกครั้งก่อนบันทึก`);
    }, [rowSig]);   // eslint-disable-line react-hooks/exhaustive-deps

    const baseForm = toForm(base);
    const changed = FIELDS.filter(k => !same(k, f[k], baseForm[k]));
    const dirty = changed.length > 0;
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));

    function fieldErrors() {
        const e = {};
        if (changed.includes('name') && !f.name.trim()) e.name = 'ใส่ชื่อคนก่อนนะ';
        if (changed.includes('kind') && !f.kind.trim()) e.kind = 'เลือกประเภทงาน';
        // ตกลงแล้วขึ้นไปต้องมีค่าตัว — แถวเก่าที่เป็นแบบนี้อยู่แล้ว (ไม่ได้แตะสถานะ/ค่าตัว) ยังบันทึกช่องอื่นได้
        if ((changed.includes('status') || changed.includes('fee')) && PAYABLE_STATUS.includes(f.status) && feeMissing(f.fee)) e.fee = NEED_FEE_MSG;
        if (changed.includes('status') && locked) e.status = `คนนี้ยังรอ${T.confirmQueue}ใน${T.request} — ${T.confirmQueue}ในใบก่อน`;
        return e;
    }
    const E = tried ? fieldErrors() : {};

    // เปิดจากปุ่ม "ใส่ค่าตัวแล้วตกลง" → ไปที่ช่องค่าตัวเลย (หลัง SideDrawer โฟกัสตัวลิ้นชักเสร็จ)
    useEffect(() => {
        if (!focusFee) return undefined;
        const t = requestAnimationFrame(() => {
            const el = feeRef.current;
            if (!el) return;
            el.focus({ preventScroll: true });
            el.scrollIntoView({ block: 'center' });
        });
        return () => cancelAnimationFrame(t);
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    // Esc ปิดกล่องที่ซ้อนอยู่ก่อน (SideDrawer ไม่ปิดตัวเองตอนมี .modal-backdrop ข้างใน)
    useEffect(() => {
        if (!preview && !askRemove) return undefined;
        const onKey = e => {
            if (e.key !== 'Escape') return;
            if (preview) setPreview(false);
            else if (busy !== 'remove') setAskRemove(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [preview, askRemove, busy]);

    const scroller = () => (wrapRef.current ? wrapRef.current.closest('.side-drawer-body') : null);
    const toTop = () => { const s = scroller(); if (s) s.scrollTo({ top: 0, behavior: 'smooth' }); };

    function setFee(v) {
        const fee = digits(v).slice(0, 12);
        const next = { ...f, fee };
        let note = '';
        if (agreeOnFee && !locked && !feeMissing(fee) && same('status', f.status, baseForm.status)) {
            // เปิดมาเพื่อ "ใส่ค่าตัวแล้วตกลง" — พอมีค่าตัวก็ตั้งขั้นให้เลย (เปลี่ยนเองได้)
            next.status = agreeOnFee;
        } else if (feeMissing(fee) && PAYABLE_STATUS.includes(f.status) && !same('status', f.status, baseForm.status)) {
            // ลบค่าตัวออกหลังเลือกขั้นที่ต้องมีค่าตัว → ถอยกลับเป็นขั้นเดิม พร้อมบอกเหตุผล
            next.status = baseForm.status;
            note = `ไม่มีค่าตัวแล้ว เลยเปลี่ยนกลับเป็น "${statusLabel(baseForm.status || TALKING)}" — ${NEED_FEE_MSG}`;
        }
        setF(next);
        setFeeNote(note);
    }

    async function save() {
        if (busy || noKey) return;
        setTried(true);
        setError(''); setInfo('');
        const errs = fieldErrors();
        if (Object.keys(errs).length) {
            requestAnimationFrame(() => {
                const el = wrapRef.current && wrapRef.current.querySelector('.qf-field.has-err');
                if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
            return;
        }
        if (!changed.length) { onClose && onClose(); return; }
        const set = {};
        const expect = {};
        changed.forEach(k => { set[k] = outVal(k, f[k]); expect[k] = rawOf(base, k); });
        setBusy('save');
        try {
            const res = await api(`/projects/${projectId}/hires/${encodeURIComponent(row.key)}/person`, {
                method: 'PATCH', body: { set, expect }
            });
            setBusy('');
            onSaved && onSaved((res && res.data) || {}, set.name || S(base && base.name));
        } catch (e) {
            setBusy('');
            if (e.status === 409 || e.status === 404) {
                // ข้อมูลเพิ่งเปลี่ยน / ยังรอยืนยันคิว / ถูกเอาออกไปแล้ว — ให้หน้าแม่โหลดค่าล่าสุด (ช่องที่แก้ไว้ยังอยู่)
                setError(e.message || 'ข้อมูลเพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว ตรวจแล้วบันทึกอีกครั้ง');
                onStale && onStale();
            } else {
                setError(e.message || 'บันทึกไม่สำเร็จ');
            }
            toTop();
        }
    }

    async function remove() {
        if (busy || noKey) return;
        setBusy('remove');
        setError('');
        try {
            const res = await api(`/projects/${projectId}/hires/${encodeURIComponent(row.key)}`, { method: 'DELETE' });
            setBusy('');
            setAskRemove(false);
            onRemoved && onRemoved(res && res.data, S(base && base.name));
        } catch (e) {
            setBusy('');
            setAskRemove(false);
            setError(e.message || 'เอาออกไม่สำเร็จ');
            if (e.status === 404 || e.status === 409) onStale && onStale();
            toTop();
        }
    }

    // รูป/คอมการ์ดแนบทันทีที่เลือกไฟล์ (เส้นอัปโหลดแยกของมันเอง ไม่ต้องรอกดบันทึก)
    async function pickFile(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';   // เลือกไฟล์เดิมซ้ำได้
        if (!file || busy || noKey) return;
        if (!FILE_OK.test(file.name)) { setFileErr('รองรับเฉพาะรูป (png, jpg, webp) หรือ PDF'); return; }
        if (file.size > MAX_FILE) { setFileErr('ไฟล์ใหญ่เกิน 10MB — เลือกไฟล์ที่เล็กกว่านี้'); return; }
        setFileErr(''); setInfo(''); setError('');
        setBusy('upload');
        try {
            const res = await uploadFile(`/projects/${projectId}/hires/${encodeURIComponent(row.key)}/image`, file);
            setBusy('');
            setInfo(`แนบ ${file.name} แล้ว`);
            onFileChanged && onFileChanged(res && res.data);
        } catch (err) {
            setBusy('');
            setFileErr(err.message || 'อัปโหลดไม่สำเร็จ');
        }
    }

    // ทุกทางที่ปิด (× / Esc / กดพื้นหลัง / ยกเลิก) มาที่นี่ที่เดียว
    function requestClose() {
        if (busy) return;
        if (dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดเลยไหม? ที่แก้ไว้จะหาย')) return;
        onClose && onClose();
    }

    const name = S(base && base.name).trim() || 'คนนี้';
    const fromReq = !!row && row.from_request != null;
    const bookingOpenNow = !!(row && row.booking && (row.booking.state === 'pending' || row.booking.state === 'fee_review'));
    const kinds = baseForm.kind && !HIRE_KINDS.includes(baseForm.kind) ? [...HIRE_KINDS, baseForm.kind] : HIRE_KINDS;
    const oldStatusUnknown = baseForm.status && !PERSON_STEPS.includes(baseForm.status);
    const subtitle = [S(base && base.kind).trim(), fromReq ? `ได้จาก${T.request}` : ''].filter(Boolean).join(' · ');
    const imagePath = `/projects/${projectId}/hires/${encodeURIComponent(row ? row.key : '')}/image`;

    const footer = (
        <>
            <button type="button" className="btn-ghost danger tj-foot-left" onClick={() => setAskRemove(true)} disabled={!!busy || noKey}>
                <Icon name="trash" size={15} /> เอาคนนี้ออกจากงาน
            </button>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={!!busy}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={save} disabled={!!busy || noKey}>
                {busy === 'save' ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
        </>
    );

    return (
        <SideDrawer title={`แก้ ${name}`} subtitle={subtitle} onClose={requestClose} footer={footer} width={600}
            busy={!!busy} className="qf-drawer tj-person-drawer">
            <div className="qf" ref={wrapRef}>
                {error && <div className="alert-error" role="alert">{error}</div>}
                {info && <div className="qf-ok" role="status"><Icon name="check" size={16} /> {info}</div>}
                {noKey && (
                    <div className="qf-warn">แถวนี้เป็นข้อมูลเก่าที่ไม่มีรหัสแถว — แก้ได้ในฟอร์มเต็ม (เมนู ⋯ → แก้หลายคนพร้อมกัน)</div>
                )}

                <section className="qf-sec" aria-labelledby={id('s1')}>
                    <h3 className="qf-sec-head" id={id('s1')}>ใคร ทำอะไร เท่าไร</h3>
                    <Field label="ชื่อ" req err={E.name} htmlFor={id('name')}>
                        <input id={id('name')} value={f.name} onChange={e => up('name', e.target.value)}
                            maxLength={MAXLEN.name} autoComplete="off" placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
                    </Field>
                    <Field label="ประเภทงาน" req err={E.kind} labelId={id('kind')}>
                        <div className="qf-chips" role="radiogroup" aria-labelledby={id('kind')}>
                            {kinds.map(k => (
                                <button type="button" key={k} role="radio" aria-checked={f.kind === k}
                                    className={'qf-chip' + (f.kind === k ? ' on' : '')} onClick={() => up('kind', k)}>{k}</button>
                            ))}
                        </div>
                    </Field>
                    <Field label="ค่าตัว (บาท)" err={E.fee} htmlFor={id('fee')}
                        hint={agreeOnFee && !locked ? `ใส่ค่าตัวแล้วกดบันทึก — ระบบตั้งเป็น "${statusLabel(agreeOnFee)}" ให้` : 'ยังไม่รู้ก็เว้นไว้ได้ — ใส่ทีหลังได้'}>
                        <input id={id('fee')} ref={feeRef} inputMode="numeric" value={f.fee} onChange={e => setFee(e.target.value)}
                            placeholder="เช่น 8000" autoComplete="off" />
                    </Field>
                    <Field label="คุยถึงไหนแล้ว" err={E.status} labelId={id('st')}>
                        <div className="qf-seg tj-seg4" role="radiogroup" aria-labelledby={id('st')}>
                            {PERSON_STEPS.map(s => {
                                // ค่าเดิมที่บันทึกไว้แล้ว (แถวเก่าที่ตกลงแล้วแต่ไม่มีค่าตัว) ยังเลือกค้างไว้ได้ ถ้าไม่ได้แก้ค่าตัว
                                const keepOld = s === baseForm.status && same('fee', f.fee, baseForm.fee);
                                const blocked = PAYABLE_STATUS.includes(s) && feeMissing(f.fee) && !keepOld;
                                return (
                                    <button type="button" key={s} role="radio" aria-checked={f.status === s}
                                        className={'qf-seg-opt' + (f.status === s ? ' on' : '')}
                                        disabled={locked || blocked || noKey} title={blocked ? NEED_FEE_MSG : undefined}
                                        onClick={() => { up('status', s); setFeeNote(''); }}>
                                        {PERSON_STEP_LABEL[s]}<small>{STEP_HINT[s]}</small>
                                    </button>
                                );
                            })}
                        </div>
                        {oldStatusUnknown && (
                            <div className="qf-hint">สถานะที่บันทึกไว้เดิม: "{statusLabel(baseForm.status)}" — เลือกขั้นใหม่ได้เลย</div>
                        )}
                        {locked ? (
                            <div className="qf-warn tj-lockbox">
                                <span>
                                    {bookingOpenNow ? BOOKING_LABEL[row.booking.state] : `รอ${T.confirmQueue}`} ใน{T.request} —
                                    เปลี่ยนขั้นตรงนี้ไม่ได้จนกว่าจะ{T.confirmQueue}ในใบ (ช่องอื่นแก้ได้ตามปกติ)
                                </span>
                                {onOpenRequest && fromReq && (
                                    <button type="button" className="qf-link-btn" onClick={() => onOpenRequest(row.from_request)}>เปิดใบ</button>
                                )}
                            </div>
                        ) : feeNote ? (
                            <div className="qf-warn" role="status">{feeNote}</div>
                        ) : feeMissing(f.fee) && <div className="qf-hint">{NEED_FEE_MSG}</div>}
                    </Field>
                </section>

                <section className="qf-sec" aria-labelledby={id('s2')}>
                    <h3 className="qf-sec-head" id={id('s2')}>เมื่อไหร่ ที่ไหน</h3>
                    <div className="qf-row2">
                        <Field label="วันที่">
                            <DatePicker value={f.use_date} onChange={v => up('use_date', v)} disabled={noKey} />
                        </Field>
                        <Field label="เวลา" htmlFor={id('time')}>
                            <input id={id('time')} value={f.use_time} maxLength={MAXLEN.use_time}
                                onChange={e => up('use_time', e.target.value)} placeholder="เช่น 09:00-17:00" />
                        </Field>
                    </div>
                    <Field label="สถานที่" htmlFor={id('place')}>
                        <input id={id('place')} value={f.place} maxLength={MAXLEN.place}
                            onChange={e => up('place', e.target.value)} placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                    </Field>
                    <Field label="ระยะเวลาทำงาน" htmlFor={id('qty')}>
                        <input id={id('qty')} value={f.qty} maxLength={MAXLEN.qty}
                            onChange={e => up('qty', e.target.value)} placeholder="เช่น 2 วัน หรือ 3 รอบไลฟ์" />
                    </Field>
                </section>

                <section className="qf-sec" aria-labelledby={id('s3')}>
                    <h3 className="qf-sec-head" id={id('s3')}>ติดต่อ และไฟล์</h3>
                    <div className="qf-row2">
                        <Field label={T.contact} htmlFor={id('contact')}>
                            <input id={id('contact')} value={f.contact} maxLength={MAXLEN.contact}
                                onChange={e => up('contact', e.target.value)} placeholder="เบอร์ / LINE / IG" />
                        </Field>
                        <Field label="สังกัด" htmlFor={id('agency')}>
                            <input id={id('agency')} value={f.agency} maxLength={MAXLEN.agency}
                                onChange={e => up('agency', e.target.value)} placeholder="ไม่มีก็เว้นไว้" />
                        </Field>
                    </div>
                    <Field label="ลิงก์ Account/Social" htmlFor={id('link')}>
                        <input id={id('link')} type="url" value={f.link} maxLength={MAXLEN.link}
                            onChange={e => up('link', e.target.value)} placeholder="IG / TikTok / Facebook (https://...)" />
                    </Field>
                    <Field label={T.note} htmlFor={id('note')}>
                        <textarea id={id('note')} rows="3" value={f.note} maxLength={MAXLEN.note}
                            onChange={e => up('note', e.target.value)} placeholder="เงื่อนไข ข้อตกลง หรือสิ่งที่ต้องจำ" />
                    </Field>
                    <Field label="รูป/คอมการ์ด" err={fileErr} hint="รูป (png, jpg, webp) หรือ PDF ไม่เกิน 10MB — เลือกไฟล์แล้วแนบให้ทันที">
                        <div className="tj-file">
                            {row && row.image && (
                                <button type="button" className="tj-file-prev" onClick={() => setPreview(true)} title="เปิดดูไฟล์">
                                    <PersonThumb projectId={projectId} row={row} size="lg" />
                                    <span>{row.image.original || 'ไฟล์แนบ'}</span>
                                </button>
                            )}
                            <label className={'qf-file-btn' + (busy === 'upload' ? ' busy' : '')} tabIndex={busy || noKey ? -1 : 0} role="button"
                                aria-disabled={!!busy || noKey}
                                onKeyDown={e => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    const inp = e.currentTarget.querySelector('input[type=file]');
                                    if (inp && !inp.disabled) inp.click();
                                }}>
                                <Icon name="upload" size={15} />
                                <span>{busy === 'upload' ? 'กำลังแนบ...' : row && row.image ? 'เปลี่ยนไฟล์' : 'แนบรูป หรือ PDF คอมการ์ด'}</span>
                                <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={pickFile} disabled={!!busy || noKey} />
                            </label>
                        </div>
                    </Field>
                </section>
            </div>

            {preview && row && row.image && (
                <FilePreviewModal path={imagePath} title={row.image.original} onClose={() => setPreview(false)} />
            )}

            {askRemove && (
                <div className="modal-backdrop" onClick={() => busy !== 'remove' && setAskRemove(false)}>
                    <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={id('rm')}
                        onClick={e => e.stopPropagation()}>
                        <h3 id={id('rm')}>เอา {name} ออกจากงานนี้?</h3>
                        <p className="tj-confirm-text">
                            {fromReq
                                ? `ที่ว่างจะคืนให้${T.request} — ใบจะกลับไปหาคนเพิ่มอีก 1 คน`
                                : 'ข้อมูลของคนนี้ในงานนี้จะถูกลบ (ประวัติการจ้างในงานอื่นไม่หาย)'}
                        </p>
                        {bookingOpenNow && fromReq && (
                            <p className="tj-confirm-warn">คนนี้ยัง{BOOKING_LABEL[row.booking.state]}อยู่ — เอาออกแล้ว{T.finder}ต้องหาคนแทน</p>
                        )}
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={busy === 'remove'} onClick={() => setAskRemove(false)}>ยกเลิก</button>
                            <button type="button" className="btn-danger tj-btn-danger" disabled={busy === 'remove'} onClick={remove}>
                                {busy === 'remove' ? 'กำลังเอาออก...' : 'เอาออกจากงาน'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </SideDrawer>
    );
}
