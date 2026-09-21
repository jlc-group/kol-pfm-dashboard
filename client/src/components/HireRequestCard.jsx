import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile, fileBlobUrl } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import FilePreviewModal from './FilePreviewModal.jsx';
import HireRequestEditModal from './HireRequestEditModal.jsx';
import DatePicker from './DatePicker.jsx';
import {
    hireStage, hireNeedMore, BOOK_PENDING, BOOK_FEE, bookingState, hireBookings
} from './OtherProjectForm.jsx';
import {
    T, STAGE_LABEL, BOOKING_LABEL, CAND_LABEL, REJECT_REASONS, requestLink, feeDiff, baht, timeAgo
} from '../data/talentLabels.js';

// การ์ด "ใบขอให้หา" หนึ่งใบ พร้อมรายชื่อที่ส่งเข้ามาทั้งหมด — ที่เดียวที่ทำอะไรกับใบได้
// ใช้ 2 ที่ด้วยหน้าตาเดียวกัน: ฝังตรง ๆ ในหน้ารายละเอียดงาน (ทีมแบรนด์) และในลิ้นชักใบขอให้หาของหน้า Talent
// งานของใบนี้มีสองฝั่ง — คนช่วยหาเสนอชื่อได้หลายคน ทีมแบรนด์เป็นคนกด "เลือกคนนี้" / "ไม่เอา" (พร้อมเหตุผลให้คนช่วยหาเห็น)
// ทุกปุ่มยิงเส้นที่แก้ทีละแถวในฐาน (ไม่ใช่ PUT ทั้งแคมเปญ) สองฝั่งจึงทำงานพร้อมกันได้โดยไม่ทับกัน
// ค่าในฐานยังเป็นคำเดิม (เสนอ / เลือกแล้ว / ไม่เอา / pending / fee_review) — เปลี่ยนแค่ป้ายที่โชว์ผ่าน talentLabels.js
// รอบ 2: รายชื่อที่เสนอเป็นแกลเลอรีคอมการ์ด (รูปย่อ + ป้ายในงบ/เกินงบ) แบ่งกลุ่ม รอเลือก → เลือกแล้ว → (พับไว้) ไม่เอา / สำรองไว้
// ฟอร์มเสนอชื่อเหลือ 3 ช่องหลัก ที่เหลือพับไว้ใต้ "ข้อมูลเพิ่มเติม" — เส้น API และ body ทุกเส้นเหมือนรอบ 1 ทุกตัว
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};
const CAND_NEW = 'เสนอ';
const CAND_PICKED = 'เลือกแล้ว';
const CAND_DROPPED = 'ไม่เอา';
const CAND_KNOWN = [CAND_NEW, CAND_PICKED, CAND_DROPPED];
const candsOf = r => (Array.isArray(r && r.candidates) ? r.candidates : []);
const leftOf = r => Math.max(0, (Number(r && r.headcount) || 1) - (Number(r && r.filled) || 0));
const EMPTY = { name: '', fee: '', contact: '', agency: '', link: '', note: '', image_link: '', video_link: '' };
const S = v => (v == null ? '' : String(v));
const digitsOnly = v => String(v == null ? '' : v).replace(/[^0-9]/g, '');
// เหตุผลที่เซิร์ฟเวอร์เขียนไว้ตอนคนที่เลือกแล้วมาไม่ได้ ('คิวไม่ว่าง: …' — ค่าในฐานคงเดิม มีเทสต์ผูกไว้)
// โชว์เป็นคำใหม่เท่านั้น ไม่แก้ข้อมูล
const UNAVAIL_PREFIX = 'คิวไม่ว่าง';
const isUnavailNote = n => typeof n === 'string' && (n === UNAVAIL_PREFIX || n.startsWith(UNAVAIL_PREFIX + ': '));
const showDecidedNote = n => (!isUnavailNote(n) ? n
    : n === UNAVAIL_PREFIX ? 'มาไม่ได้' : 'มาไม่ได้: ' + n.slice(UNAVAIL_PREFIX.length + 2));

// ===== คอมการ์ดของชื่อที่เสนอ =====
// server รับแค่ png/jpg/jpeg/webp/pdf — ดูชนิดจากนามสกุลของไฟล์ (ชื่อไฟล์ในฐานใช้นามสกุลเดียวกับไฟล์ต้นฉบับ)
const fileKind = f => {
    if (!f) return null;
    const n = String(f.filename || f.original || '');
    if (/\.pdf$/i.test(n)) return 'pdf';
    return /\.(png|jpe?g|webp|gif)$/i.test(n) ? 'image' : 'file';
};
// ตัวระบุไฟล์ — อัปรูปใหม่ทับแล้วชื่อไฟล์ในฐานเปลี่ยน รูปย่อจึงรู้ว่าต้องโหลดใหม่ (เส้น GET ของรูปเป็น URL เดิมเสมอ)
const fileId = f => (f ? String(f.filename || f.original || f.uploaded_at || 'file') : '');
// ตัวอักษรแรกของชื่อไว้แทนรูป — ข้ามสระหน้า (เ แ โ ใ ไ) ไม่งั้นได้วงกลมที่มีแต่สระ
const firstChar = name => {
    const chars = Array.from(String(name || '').trim());
    return (chars.find(ch => !/[เแโใไ\s]/.test(ch)) || chars[0] || '?').toUpperCase();
};
// ป้ายเทียบค่าตัวที่เสนอกับงบต่อคนของใบ — ยังไม่ใส่ค่าตัว / ใบที่ไม่ได้ตั้งงบ ไม่มีอะไรให้เทียบ
const budgetBadge = (fee, budget) => {
    const f = Number(fee) || 0;
    const b = Number(budget) || 0;
    if (!(f > 0) || !(b > 0)) return null;
    return f <= b ? { cls: 'ok', text: 'ในงบ' } : { cls: 'over', text: `เกินงบ ${baht(f - b)}` };
};

// รูปย่อของคนหนึ่งคน — โหลดรูปเฉพาะตอนการ์ดใกล้เข้าจอ (รายชื่อยาวในลิ้นชักไม่ต้องดึงรูปทั้งหมดตั้งแต่เปิด)
// ไฟล์ต้องแนบ token จึงใช้ <img src> ตรง ๆ ไม่ได้ — โหลดเป็น blob ผ่านตัวเก็บของการ์ด (load/peek) ที่คืนหน่วยความจำให้ตอนปิดการ์ด
// ลิงก์คอมการ์ดภายนอก (Drive / Canva) ไม่ดึงรูปมาโชว์ — แค่เป็นปุ่มเปิดแท็บใหม่ ไม่ส่งคำขอไปเว็บคนอื่นจากหน้านี้
function CandThumb({ c, no, path, load, peek, onOpen }) {
    const kind = fileKind(c.image);
    const file = fileId(c.image);
    const [url, setUrl] = useState(() => (kind === 'image' ? peek(c.key, file) : ''));
    const [failed, setFailed] = useState(false);
    const box = useRef(null);
    useEffect(() => {
        setFailed(false);
        if (kind !== 'image') { setUrl(''); return undefined; }
        const ready = peek(c.key, file);
        if (ready) { setUrl(ready); return undefined; }
        setUrl('');
        let alive = true;
        let io = null;
        const go = () => load(c.key, file, path)
            .then(r => { if (alive) setUrl(r.url); })
            .catch(() => { if (alive) setFailed(true); });
        const el = box.current;
        if (el && typeof window.IntersectionObserver === 'function') {
            io = new window.IntersectionObserver(entries => {
                if (!entries.some(e => e.isIntersecting)) return;
                io.disconnect(); io = null;
                go();
            }, { rootMargin: '240px 0px' });
            io.observe(el);
        } else {
            go();
        }
        return () => { alive = false; if (io) io.disconnect(); };
    }, [kind, file, path, c.key]);   // eslint-disable-line react-hooks/exhaustive-deps

    const name = S(c.name) || 'คนนี้';
    let body;
    if (kind === 'image') {
        body = (
            <button type="button" className="tc2-thumb-btn" onClick={onOpen} title={`ดูคอมการ์ดของ ${name}`}>
                {url
                    ? <img src={url} alt={`คอมการ์ดของ ${name}`} draggable="false" />
                    : <span className="tc2-thumb-wait">{failed ? 'โหลดรูปย่อไม่ได้ — กดเพื่อเปิดดู' : 'กำลังโหลดรูป...'}</span>}
            </button>
        );
    } else if (kind) {
        body = (
            <button type="button" className="tc2-thumb-btn tc2-thumb-file" onClick={onOpen}
                title={`เปิดคอมการ์ดของ ${name}${c.image && c.image.original ? ` (${c.image.original})` : ''}`}>
                <Icon name="file" size={26} />
                <span>{kind === 'pdf' ? 'เปิด PDF' : 'เปิดไฟล์'}</span>
            </button>
        );
    } else if (c.image_link) {
        body = (
            <a className="tc2-thumb-btn tc2-thumb-link" href={c.image_link} target="_blank" rel="noopener noreferrer"
                title={`เปิดคอมการ์ดของ ${name} จากลิงก์ (แท็บใหม่)`}>
                <span className="tc2-initial" aria-hidden="true">{firstChar(c.name)}</span>
                <span className="tc2-link-chip"><Icon name="eye" size={12} /> เปิดลิงก์</span>
                <span className="tc2-thumb-sub">คอมการ์ดเป็นลิงก์</span>
            </a>
        );
    } else {
        body = (
            <div className="tc2-thumb-none">
                <span className="tc2-initial" aria-hidden="true">{firstChar(c.name)}</span>
                <span>ยังไม่มีรูป</span>
            </div>
        );
    }
    return (
        <div className="tc2-thumb" ref={box}>
            {body}
            <span className="tc2-no" aria-hidden="true">{no}</span>
        </div>
    );
}

// ช่องกรอกของ "ชื่อที่เสนอ" — ใช้ชุดเดียวกันทั้งตอนเสนอใหม่และตอนกดแก้ไข จะได้ไม่มีช่องที่มีแค่ฝั่งเดียว
// compact (ตอนเสนอใหม่): โชว์แค่ ชื่อ / ค่าตัวที่เสนอ / รูปหรือคอมการ์ด ที่เหลือพับไว้ใต้ "ข้อมูลเพิ่มเติม"
// — คนช่วยหาส่งชื่อทีละหลายคน ช่องที่ไม่จำเป็นทำให้ส่งช้า · ตอนแก้ไขโชว์ครบทุกช่อง (เห็นของเดิมทั้งหมด)
function CandFields({
    form, setForm, budget, img, setImg, vid, setVid, current, clearImg, setClearImg, clearVid, setClearVid,
    compact = false, more = true, setMore, nameRef, nameErr, onNameOk
}) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const curImg = current && current.image && !clearImg ? current.image : null;
    const curVid = current && current.video && !clearVid ? current.video : null;
    const showExtra = !compact || more;
    const extraN = [form.contact, form.agency, form.link, form.video_link, form.note].filter(v => S(v).trim()).length
        + (vid ? 1 : 0);
    const bud = Number(budget) || 0;
    const feeNow = Number(digitsOnly(form.fee)) || 0;
    const badge = budgetBadge(feeNow, bud);
    // เลือกไฟล์เดิมซ้ำหลังกด × ต้องยังทำงาน — ล้างค่าในช่องไฟล์ทุกครั้งที่อ่านเสร็จ
    const pick = (e, fn) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) fn(f); };
    return (
        <div className="hire-grid tc2-fields">
            <label className="hire-f">
                <span>ชื่อ *</span>
                <input ref={nameRef} value={form.name} maxLength={200} className={nameErr ? 'tc2-invalid' : undefined}
                    aria-invalid={nameErr ? 'true' : undefined}
                    onChange={e => { set('name', e.target.value); if (nameErr && e.target.value.trim() && onNameOk) onNameOk(); }}
                    placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
                {nameErr && <span className="tc2-ferr" role="alert">ใส่ชื่อคนก่อนนะ</span>}
            </label>
            <label className="hire-f">
                <span>ค่าตัวที่เสนอ (บาท)</span>
                <input inputMode="numeric" value={form.fee}
                    onChange={e => set('fee', digitsOnly(e.target.value))}
                    placeholder={bud > 0 ? `งบต่อคน ${baht(bud)}` : 'ยังไม่รู้ก็เว้นไว้ได้'} />
                {/* บอกงบต่อคนของใบไว้ใต้ช่อง + ป้ายในงบ/เกินงบตามที่พิมพ์ — ทีมแบรนด์เห็นป้ายเดียวกันบนการ์ด */}
                <span className="tc2-fee-hint">
                    {bud > 0 ? <>งบต่อคน {baht(bud)}</> : 'ใบนี้ไม่ได้ระบุงบต่อคน'}
                    {badge && <span className={'tc2-badge ' + badge.cls}>{badge.text}</span>}
                </span>
            </label>

            {/* คอมการ์ด: อัปไฟล์ก็ได้ วางลิงก์ก็ได้ (บางเอเจนซี่ส่งมาเป็นลิงก์ Drive/Canva) — อย่างใดอย่างหนึ่ง */}
            <div className="hire-f wide">
                <span>รูป / คอมการ์ด</span>
                <div className="pbrief-row">
                    <label className={'pbrief-file-btn' + (img || curImg ? ' has-file' : '')}>
                        <Icon name="upload" size={14} /> {img ? img.name : (curImg ? curImg.original : 'อัปโหลดรูป หรือ PDF คอมการ์ด')}
                        <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf"
                            onChange={e => pick(e, f => { setImg(f); if (setClearImg) setClearImg(false); })} />
                    </label>
                    {img && <button type="button" className="pbrief-file-clear" title="เอาไฟล์ที่เพิ่งเลือกออก" onClick={() => setImg(null)}>×</button>}
                    {!img && curImg && setClearImg && (
                        <button type="button" className="pbrief-file-clear" title="เอาไฟล์เดิมออก" onClick={() => setClearImg(true)}>×</button>
                    )}
                </div>
                <input className="hire-link-input" type="url" value={form.image_link}
                    onChange={e => set('image_link', e.target.value)} placeholder="หรือวางลิงก์คอมการ์ด (Drive / Canva / ...)" />
            </div>

            {compact && (
                <button type="button" className="tc2-more" aria-expanded={more} onClick={() => setMore && setMore(!more)}>
                    <span className="tc2-caret" aria-hidden="true">▸</span> ข้อมูลเพิ่มเติม
                    <span className="tc2-more-n">
                        {extraN > 0 ? `(กรอกแล้ว ${extraN} ช่อง)` : `(${T.contact} · สังกัด · ลิงก์ Account · คลิป · ${T.note})`}
                    </span>
                </button>
            )}

            {showExtra && (<>
                <label className="hire-f">
                    <span>{T.contact}</span>
                    <input value={form.contact} onChange={e => set('contact', e.target.value)} placeholder="เบอร์ / LINE / IG" />
                </label>
                <label className="hire-f">
                    <span>สังกัด / เอเจนซี่</span>
                    <input value={form.agency} onChange={e => set('agency', e.target.value)} placeholder="ไม่มีก็เว้นไว้" />
                </label>
                <label className="hire-f wide">
                    <span>ลิงก์ Account / Social Media</span>
                    <input type="url" value={form.link} onChange={e => set('link', e.target.value)} placeholder="IG / TikTok / Facebook (https://...)" />
                </label>

                {/* คลิปแนะนำตัว: ไฟล์ใหญ่กว่ารูปมาก จึงมีทางเลือกวางลิงก์ให้ด้วย */}
                <div className="hire-f wide">
                    <span>คลิปแนะนำตัว</span>
                    <div className="pbrief-row">
                        <label className={'pbrief-file-btn' + (vid || curVid ? ' has-file' : '')}>
                            <Icon name="upload" size={14} /> {vid ? vid.name : (curVid ? curVid.original : 'อัปโหลดคลิป MP4 / MOV / WEBM (ไม่เกิน 95MB)')}
                            <input type="file" hidden accept=".mp4,.mov,.m4v,.webm"
                                onChange={e => pick(e, f => { setVid(f); if (setClearVid) setClearVid(false); })} />
                        </label>
                        {vid && <button type="button" className="pbrief-file-clear" title="เอาคลิปที่เพิ่งเลือกออก" onClick={() => setVid(null)}>×</button>}
                        {!vid && curVid && setClearVid && (
                            <button type="button" className="pbrief-file-clear" title="เอาคลิปเดิมออก" onClick={() => setClearVid(true)}>×</button>
                        )}
                    </div>
                    <input className="hire-link-input" type="url" value={form.video_link}
                        onChange={e => set('video_link', e.target.value)} placeholder="หรือวางลิงก์คลิป (YouTube / Drive / TikTok)" />
                </div>

                <label className="hire-f wide">
                    <span>{T.note}</span>
                    <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="เช่น ว่างเฉพาะช่วงเช้า" />
                </label>
            </>)}
        </div>
    );
}

// ===== ส่วน "เลือกแล้ว · รอยืนยันคิว" ของการ์ด =====
// คนช่วยหา (หรือทีมแบรนด์แทน) ยืนยันคิว/ค่าตัวจริง หรือแจ้งว่าคนนี้มาไม่ได้ · ทีมแบรนด์ตัดสินค่าตัวใหม่เมื่อแพงกว่าที่ตกลงไว้
const bookingsOf = r => (Array.isArray(r && r.bookings) ? r.bookings : []);
const BOOK_EMPTY = { use_date: '', use_time: '', place: '', contact: '', fee: '', note: '' };
const digits = v => Number(String(v == null ? '' : v).replace(/[^0-9]/g, '')) || 0;

function BookingSection({ rows, pid, rowKey, canAct, canFee, busy, run, applyItems, onStale, err, errAt }) {
    const [confirmKey, setConfirmKey] = useState('');
    const [bf, setBf] = useState(BOOK_EMPTY);
    const [dropKey, setDropKey] = useState('');
    const [dropReason, setDropReason] = useState('');
    const [feeNoKey, setFeeNoKey] = useState('');
    const [feeNote, setFeeNote] = useState('');
    const set = (k, v) => setBf(f => ({ ...f, [k]: v }));
    const url = (b, action) => `/projects/${pid}/hires/${rowKey}/bookings/${b.key}/${action}`;
    const closeAll = () => { setConfirmKey(''); setDropKey(''); setFeeNoKey(''); };
    // แถวเปลี่ยนขั้นไปแล้ว (อีกคนกดไปก่อน / โหลดใหม่) → ปิดกล่องที่ไม่ตรงขั้นทิ้ง ไม่ให้ส่งค่าเก่า
    useEffect(() => {
        const stOf = k => { const r = rows.find(x => String(x.key) === String(k)); return r ? bookingState(r) : null; };
        if (confirmKey && stOf(confirmKey) !== BOOK_PENDING) setConfirmKey('');
        if (feeNoKey && stOf(feeNoKey) !== BOOK_FEE) setFeeNoKey('');
        if (dropKey && !stOf(dropKey)) setDropKey('');
    }, [rows]);   // eslint-disable-line react-hooks/exhaustive-deps
    // ข้อมูลในหน้าเก่ากว่าในฐาน (409) → ให้หน้าแม่โหลดใหม่ จะได้เห็นขั้น/ยอดล่าสุด
    const act = (b, fn) => run('b' + b.key, async () => {
        try { await fn(); }
        catch (e) { if (e.status === 409 && onStale) onStale(); throw e; }
    });

    function openConfirm(b) {
        closeAll();
        setConfirmKey(b.key);
        setBf({
            use_date: S(b.use_date), use_time: S(b.use_time), place: S(b.place), contact: S(b.contact),
            fee: b.fee == null ? '' : String(b.fee), note: S(b.note)
        });
    }
    // ปิดเฉพาะกล่องของคนนี้หลังทำเสร็จ — ถ้ากำลังกรอกของอีกคนค้างไว้ ต้องไม่หาย
    const confirm = b => act(b, async () => {
        const res = await api(url(b, 'confirm'), {
            method: 'POST',
            body: { use_date: bf.use_date || null, use_time: bf.use_time, place: bf.place, contact: bf.contact, fee: digits(bf.fee), note: bf.note }
        });
        applyItems(res.data);
        setConfirmKey(k => (k === b.key ? '' : k));
    });
    const drop = b => act(b, async () => {
        const res = await api(url(b, 'unavailable'), { method: 'POST', body: { reason: dropReason } });
        applyItems(res.data);
        setDropKey(k => (k === b.key ? '' : k));
    });
    const feeDecide = (b, ok) => act(b, async () => {
        const bk = b.booking || {};
        // ส่งยอดที่เห็นบนจอไปด้วย — ถ้าคนช่วยหายืนยันคิวรอบใหม่ระหว่างนั้น server จะตีกลับแทนการยอมรับยอดที่ไม่เคยเห็น
        const res = await api(url(b, ok ? 'fee-approve' : 'fee-reject'), {
            method: 'POST',
            body: { note: ok ? null : feeNote, expected_fee: bk.requested_fee, expected_confirmed_at: bk.confirmed_at || null }
        });
        applyItems(res.data);
        setFeeNoKey(k => (k === b.key ? '' : k));
    });

    if (!rows.length) return null;
    return (
        <div className="req-bookings">
            <div className="req-cands-head">
                <span>
                    เลือกแล้ว · {[
                        rows.some(r => bookingState(r) === BOOK_PENDING) ? `${BOOKING_LABEL.pending} ${rows.filter(r => bookingState(r) === BOOK_PENDING).length}` : '',
                        rows.some(r => bookingState(r) === BOOK_FEE) ? `${BOOKING_LABEL.fee_review} ${rows.filter(r => bookingState(r) === BOOK_FEE).length}` : ''
                    ].filter(Boolean).join(' · ')}
                </span>
            </div>
            {rows.map(b => {
                const st = bookingState(b);
                const bk = b.booking || {};
                const isBusy = busy === 'b' + b.key;
                const approved = Number(b.fee) || 0;
                const higher = confirmKey === b.key && digits(bf.fee) > approved;
                // ไม่ได้พิมพ์ค่าตัว server จะใช้ค่าตัวที่ตกลงไว้ — ถ้าอันนั้นก็ 0 จะยืนยันคิว (= ตกลงแล้ว) ไม่ได้
                const zeroFee = confirmKey === b.key && digits(bf.fee) <= 0 && approved <= 0;
                return (
                    <div className={'req-book st-' + st} key={b.key}>
                        <div className="req-book-top">
                            <div className="req-cand-main">
                                <div className="req-cand-name">
                                    <strong>{b.name}</strong>
                                    <span className={'stage-chip st-' + (st === BOOK_FEE ? 'fee' : 'booking')}>{BOOKING_LABEL[st]}</span>
                                </div>
                                <div className="req-cand-meta">
                                    ค่าตัวที่ตกลงไว้ {approved > 0 ? B(approved) : 'ยังไม่ระบุ'}
                                    {b.use_date ? ` · ${fmtD(b.use_date)}` : ''}{b.use_time ? ` ${b.use_time}` : ''}
                                    {b.place ? ` · ${b.place}` : ''}{b.contact ? ` · ${b.contact}` : ''}
                                    {bk.approved_by ? ` · เลือกโดย ${bk.approved_by}` : ''}
                                </div>
                                {st === BOOK_FEE && (
                                    <div className="req-book-fee">
                                        ขอ{T.newFee} <b>{B(bk.requested_fee)}</b> (ตกลงไว้ {B(approved)} · {feeDiff(approved, bk.requested_fee).text})
                                        {bk.confirmed_by ? ` · ${T.confirmQueue}โดย ${bk.confirmed_by}` : ''}
                                    </div>
                                )}
                                {st === BOOK_PENDING && bk.rejected_fee != null && (
                                    <div className="req-cand-reason">
                                        ทีมไม่ยอมรับค่าตัว {B(bk.rejected_fee)}{bk.reviewed_by ? ` (${bk.reviewed_by})` : ''}
                                        {bk.team_note ? ` — ${bk.team_note}` : ''} · คุยใหม่แล้ว{T.confirmQueue}อีกครั้ง หรือกด "{T.cantCome}"
                                    </div>
                                )}
                            </div>
                            <div className="req-cand-actions">
                                {st === BOOK_PENDING && canAct && confirmKey !== b.key && dropKey !== b.key && (
                                    <button type="button" className="btn-primary" disabled={isBusy} onClick={() => openConfirm(b)}>
                                        {T.confirmQueue}
                                    </button>
                                )}
                                {st === BOOK_FEE && canFee && feeNoKey !== b.key && dropKey !== b.key && (
                                    <>
                                        <button type="button" className="btn-primary" disabled={isBusy} onClick={() => feeDecide(b, true)}>
                                            ✓ ยอมรับ{T.newFee}
                                        </button>
                                        <button type="button" className="btn-reject" disabled={isBusy}
                                            onClick={() => { closeAll(); setFeeNoKey(b.key); setFeeNote(''); }}>✕ ไม่ยอมรับ</button>
                                    </>
                                )}
                                {canAct && dropKey !== b.key && confirmKey !== b.key && feeNoKey !== b.key && (
                                    <button type="button" className="btn-ghost" disabled={isBusy}
                                        onClick={() => { closeAll(); setDropKey(b.key); setDropReason(''); }}>{T.cantCome}</button>
                                )}
                            </div>
                        </div>

                        {confirmKey === b.key && st === BOOK_PENDING && (
                            <div className="req-add">
                                <div className="hire-grid">
                                    <div className="hire-f">
                                        <span>วันที่ใช้งาน</span>
                                        <DatePicker value={bf.use_date} onChange={v => set('use_date', v)} />
                                    </div>
                                    <label className="hire-f">
                                        <span>เวลา</span>
                                        <input value={bf.use_time} maxLength={60} onChange={e => set('use_time', e.target.value)} placeholder="เช่น 09:00-17:00" />
                                    </label>
                                    <label className="hire-f">
                                        <span>สถานที่</span>
                                        <input value={bf.place} maxLength={200} onChange={e => set('place', e.target.value)} placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                                    </label>
                                    <label className="hire-f">
                                        <span>{T.contact}</span>
                                        <input value={bf.contact} maxLength={200} onChange={e => set('contact', e.target.value)} placeholder="เบอร์ / LINE / IG" />
                                    </label>
                                    <label className="hire-f">
                                        <span>ค่าตัวที่ตกลงจริง (บาท){approved > 0 ? '' : ' *'}</span>
                                        <input inputMode="numeric" value={bf.fee} placeholder={String(approved)}
                                            onChange={e => set('fee', e.target.value.replace(/[^0-9]/g, ''))} />
                                    </label>
                                    <label className="hire-f wide">
                                        <span>{T.note}</span>
                                        <input value={bf.note} maxLength={500} onChange={e => set('note', e.target.value)} placeholder="เงื่อนไขที่ตกลงกัน เช่น เตรียมชุดมาเอง" />
                                    </label>
                                </div>
                                {higher && (
                                    <div className="req-book-warn">
                                        ค่าตัวสูงกว่าที่ตกลงไว้ ({B(approved)}) — กดส่งแล้วต้องรอทีมแบรนด์ตัดสิน{T.newFee}ก่อน ถึงจะเป็น "{T.agreed}"
                                    </div>
                                )}
                                {zeroFee && <div className="tc-need-fee">ใส่ค่าตัวที่ตกลงจริงก่อน</div>}
                                <div className="req-add-actions">
                                    <button type="button" className="btn-ghost" disabled={isBusy} onClick={() => setConfirmKey('')}>ยกเลิก</button>
                                    <button type="button" className="btn-primary" disabled={isBusy || zeroFee} onClick={() => confirm(b)}
                                        title={zeroFee ? 'ใส่ค่าตัวที่ตกลงจริงก่อน' : undefined}>
                                        {isBusy ? 'กำลังบันทึก...' : higher ? `ส่งให้ทีมตัดสิน${T.newFee}` : T.confirmQueue}
                                    </button>
                                </div>
                            </div>
                        )}

                        {dropKey === b.key && (
                            <div className="req-reject">
                                <input value={dropReason} autoFocus maxLength={300} onChange={e => setDropReason(e.target.value)}
                                    placeholder="เหตุผล เช่น ติดงานอื่นวันนั้น (ทีมจะเห็น) — ที่ว่างจะคืนให้หาคนใหม่" />
                                <button type="button" className="btn-ghost" disabled={isBusy} onClick={() => setDropKey('')}>ยกเลิก</button>
                                <button type="button" className="btn-reject" disabled={isBusy} onClick={() => drop(b)}>
                                    {isBusy ? 'กำลังบันทึก...' : `ยืนยัน: ${T.cantCome}`}
                                </button>
                            </div>
                        )}

                        {feeNoKey === b.key && st === BOOK_FEE && (
                            <div className="req-reject">
                                <input value={feeNote} autoFocus maxLength={500} onChange={e => setFeeNote(e.target.value)}
                                    placeholder={`เหตุผล / งบที่รับได้ (ไม่บังคับ) — ${T.finder}จะเห็นข้อความนี้`} />
                                <button type="button" className="btn-ghost" disabled={isBusy} onClick={() => setFeeNoKey('')}>ยกเลิก</button>
                                <button type="button" className="btn-reject" disabled={isBusy} onClick={() => feeDecide(b, false)}>
                                    {isBusy ? 'กำลังบันทึก...' : `ยืนยัน: ไม่ยอมรับ${T.newFee}`}
                                </button>
                            </div>
                        )}

                        {/* ข้อผิดพลาดของปุ่มในแถวนี้ขึ้นที่แถวนี้ — ในลิ้นชักยาว ๆ กล่องบนสุดของการ์ดมักอยู่นอกจอ */}
                        {err && errAt === 'b' + b.key && <div className="alert-error tc2-err" role="alert">{err}</div>}
                    </div>
                );
            })}
        </div>
    );
}

export default function HireRequestCard({ request, canDecide = false, canPropose = false, heading = true, onChanged, onDeleted }) {
    const pid = request.project_id;
    const rowKey = request.key;
    // เก็บสถานะของใบไว้ในการ์ดเอง — ทุกเส้นคืน hire_items ทั้งชุดกลับมา จึงหยิบแถวของตัวเองมาอัปเดตได้ทันที
    // แล้วค่อยบอกหน้าแม่ให้โหลดใหม่ (ยอดงบ/ตัวเลขสรุปอยู่ที่หน้าแม่)
    const [row, setRow] = useState(request);
    // หน้าแม่สร้าง object ใบใหม่ทุกครั้งที่ re-render (เช่นพิมพ์ในช่องหมายเหตุของแถวอื่น)
    // ถ้าซิงก์ตาม object ตรง ๆ ผลที่เพิ่งกดจะถูกเขียนทับด้วยข้อมูลเก่าที่ยังโหลดไม่เสร็จ — ซิงก์เฉพาะตอนเนื้อในเปลี่ยนจริง
    const sig = JSON.stringify([
        request.key, request.kind, request.headcount, request.fee, request.use_date, request.deadline,
        request.place, request.spec, request.scope, request.note, request.status, request.filled, request.assignee_id,
        candsOf(request), bookingsOf(request)
    ]);
    // คนที่เลือกจากใบนี้แล้วยังรอยืนยันคิว (หน้าแม่ส่งมา / เส้นที่กดคืน hire_items ชุดใหม่มา)
    const [bookRows, setBookRows] = useState(() => bookingsOf(request));
    useEffect(() => { setRow(request); setBookRows(bookingsOf(request)); }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps

    // ข้อผิดพลาด + ที่มาของมัน (label ของปุ่มที่กด) — ขึ้นข้อความตรงจุดที่ผู้ใช้กดอยู่ ถ้าจุดนั้นยังเห็นบนจอ
    // ('add' = ฟอร์มเสนอชื่อ · 'e<key>' = ฟอร์มแก้ชื่อ · 'c<key>' = การ์ดของชื่อนั้น · 'b<key>' = แถวรอยืนยันคิว · อื่น ๆ = บนสุดของการ์ด)
    const [err, setErrText] = useState('');
    const [errAt, setErrAt] = useState('');
    const setErr = (text, at = '') => { setErrText(text || ''); setErrAt(text ? at : ''); };
    const [busy, setBusy] = useState('');
    const [owners, setOwners] = useState([]);
    const [assignee, setAssignee] = useState(request.assignee_id == null ? '' : String(request.assignee_id));
    useEffect(() => {
        setAssignee(row.assignee_id == null ? '' : String(row.assignee_id));
    }, [row.assignee_id]);
    // แก้/เอาชื่อที่เสนอออกได้ถ้าเป็นฝั่งคนขอ หรือเป็นคนเสนอชื่อนั้นเอง (ตรงกับที่ server บังคับ ไม่โชว์ปุ่มที่กดแล้วเจอ 403)
    const { user } = useAuth();
    const canTouch = c => canDecide || (user && c && String(c.by_id) === String(user.id));
    const [preview, setPreview] = useState(null);   // ไฟล์ที่กำลังเปิดดูในหน้า
    const [editing, setEditing] = useState(false);
    const [del, setDel] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [rejectKey, setRejectKey] = useState('');   // ชื่อที่กำลังกด "ไม่เอา" (รอใส่เหตุผล)
    const [rejectNote, setRejectNote] = useState('');
    // ชื่อที่กำลังถามก่อน "เลือกคนนี้" — เลือกแล้วคนนั้นกลายเป็นแถวผู้รับงานทันที ย้อนกลับไม่ได้ จึงให้ยืนยันอีกชั้น
    const [pickKey, setPickKey] = useState('');
    const [changingFinder, setChangingFinder] = useState(false);   // กด [เปลี่ยน] คนช่วยหาแล้ว → ขึ้นช่องเลือก
    const [copied, setCopied] = useState(false);
    // กลุ่มที่พับไว้ตอนเปิดการ์ด — ชื่อที่ไม่เอา/มาไม่ได้ และตัวสำรอง ไม่ใช่เรื่องที่ต้องทำตอนนี้
    const [openGroups, setOpenGroups] = useState({ dropped: false, spare: false });
    const toggleGroup = k => setOpenGroups(g => ({ ...g, [k]: !g[k] }));

    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [img, setImg] = useState(null);
    const [vid, setVid] = useState(null);
    const [more, setMore] = useState(false);          // "ข้อมูลเพิ่มเติม" ของฟอร์มเสนอชื่อ — จำไว้ตลอดการ์ด (ส่งหลายคนติดกันไม่ต้องกดเปิดใหม่)
    const [nameErr, setNameErr] = useState(false);
    const [formSeq, setFormSeq] = useState(0);        // เปลี่ยนเลข = ฟอร์มเสนอชื่อเริ่มใหม่ (ล้างช่องไฟล์ที่ค้างในเบราว์เซอร์ด้วย)
    const [sending, setSending] = useState('');       // 'one' | 'next' — ปุ่มไหนกำลังส่ง
    const [sent, setSent] = useState('');             // 'ส่ง {ชื่อ} แล้ว'
    const nameRef = useRef(null);
    const focusName = useRef(false);
    const sentTimer = useRef(null);
    useEffect(() => () => clearTimeout(sentTimer.current), []);
    // ส่งแล้วเสนอคนต่อไป: ฟอร์มถูกวาดใหม่ (formSeq) แล้วค่อยวางเคอร์เซอร์ที่ช่องชื่อ
    useEffect(() => {
        if (!focusName.current) return;
        focusName.current = false;
        if (nameRef.current) nameRef.current.focus();
    }, [formSeq, adding]);

    const [editKey, setEditKey] = useState('');     // ชื่อที่กำลังกดแก้ไขอยู่
    const [editForm, setEditForm] = useState(EMPTY);
    const [editImg, setEditImg] = useState(null);
    const [editVid, setEditVid] = useState(null);
    const [clearImg, setClearImg] = useState(false);
    const [clearVid, setClearVid] = useState(false);
    const [editNameErr, setEditNameErr] = useState(false);
    const editNameRef = useRef(null);

    // รูปย่อคอมการ์ดที่โหลดแล้ว (candKey → { file, promise, url }) — เก็บไว้ทั้งการ์ด
    // ชื่อย้ายกลุ่ม (รอเลือก → เลือกแล้ว) แล้วรูปไม่ต้องโหลดใหม่ · ปิดการ์ดแล้วคืนหน่วยความจำของรูปทั้งหมด
    const thumbs = useRef(new Map());
    const loadThumb = useCallback((candKey, file, path) => {
        const m = thumbs.current;
        const hit = m.get(candKey);
        if (hit && hit.file === file) return hit.promise;
        if (hit && hit.url) URL.revokeObjectURL(hit.url);
        const entry = { file, url: '' };
        entry.promise = fileBlobUrl(path).then(r => {
            // ระหว่างรอ การ์ดถูกปิด / รูปถูกเปลี่ยน → รูปนี้ไม่มีใครใช้แล้ว คืนหน่วยความจำทันที
            if (thumbs.current.get(candKey) !== entry) { URL.revokeObjectURL(r.url); throw new Error('stale'); }
            entry.url = r.url;
            return r;
        }, e => {
            // โหลดไม่ได้ (เน็ตหลุด / ไฟล์หาย) — ไม่จำความล้มเหลวไว้ เปิดการ์ดใหม่จะลองอีกครั้ง
            if (thumbs.current.get(candKey) === entry) thumbs.current.delete(candKey);
            throw e;
        });
        m.set(candKey, entry);
        return entry.promise;
    }, []);
    const peekThumb = useCallback((candKey, file) => {
        const hit = thumbs.current.get(candKey);
        return hit && hit.file === file ? hit.url : '';
    }, []);
    useEffect(() => () => {
        thumbs.current.forEach(t => { if (t.url) URL.revokeObjectURL(t.url); });
        thumbs.current.clear();
    }, []);

    useEffect(() => {
        if (!canDecide) return;   // มีแต่ฝั่งคนขอที่เปลี่ยนคนช่วยหาได้ ไม่ต้องโหลดรายชื่อให้คนอื่น
        api('/users/options').then(res => setOwners(res.data || [])).catch(() => setOwners([]));
    }, [canDecide]);

    function applyItems(items) {
        const arr = Array.isArray(items) ? items : [];
        const hit = arr.find(it => String(it.key) === String(rowKey));
        if (hit) {
            setRow(r => ({ ...r, ...hit }));
            setBookRows(hireBookings(arr, rowKey));
        }
        // ตัวเลขแดงบนเมนูอ่านจากเส้นนับของตัวเอง ต้องบอกให้โหลดใหม่ ไม่งั้นต้องรอครบนาที
        window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
        if (onChanged) onChanged();
    }

    async function run(label, fn) {
        setBusy(label); setErr('');
        try { await fn(); }
        catch (e) { setErr(e.message, label); }
        finally { setBusy(''); }
    }

    // อัปไฟล์ของชื่อที่เสนอ (ทำหลังรู้รหัสของคนนั้นแล้วเท่านั้น) — คืน hire_items ชุดล่าสุดกลับไป
    async function putFiles(candKey, items, imageFile, videoFile) {
        let out = items;
        if (imageFile) {
            const up = await uploadFile(`/projects/${pid}/hires/${rowKey}/candidates/${candKey}/image`, imageFile);
            if (up && up.data) out = up.data;
        }
        if (videoFile) {
            const up = await uploadFile(`/projects/${pid}/hires/${rowKey}/candidates/${candKey}/video`, videoFile);
            if (up && up.data) out = up.data;
        }
        return out;
    }

    const saveAssignee = () => run('assign', async () => {
        const res = await api(`/projects/${pid}/hires/${rowKey}/assign`,
            { method: 'PUT', body: { assignee_id: assignee === '' ? null : Number(assignee) } });
        applyItems(res.data);
        setChangingFinder(false);
    });

    function flashSent(name) {
        setSent(`ส่ง ${name} แล้ว`);
        clearTimeout(sentTimer.current);
        sentTimer.current = setTimeout(() => setSent(''), 6000);
    }
    function openAdd() {
        setAdding(true); setForm(EMPTY); setImg(null); setVid(null); setNameErr(false);
        setFormSeq(n => n + 1);
        focusName.current = true;
        if (errAt === 'add') setErr('');
    }
    function cancelAdd() {
        setAdding(false); setImg(null); setVid(null); setNameErr(false);
        if (errAt === 'add') setErr('');
    }

    // next = true → "ส่งแล้วเสนอคนต่อไป": ฟอร์มค้างไว้ ล้างช่อง แล้ววางเคอร์เซอร์ที่ชื่อ (คนช่วยหาส่งทีละหลายคน)
    async function propose(next) {
        if (busy === 'add') return;
        const name = form.name.trim();
        if (!name) {
            setNameErr(true);
            if (nameRef.current) nameRef.current.focus();
            return;
        }
        setBusy('add'); setSending(next ? 'next' : 'one'); setErr('');
        try {
            const res = await api(`/projects/${pid}/hires/${rowKey}/candidates`, {
                method: 'POST',
                body: {
                    name: form.name, fee: Number(String(form.fee).replace(/[^0-9]/g, '')) || 0,
                    contact: form.contact, agency: form.agency, link: form.link, note: form.note,
                    image_link: form.image_link, video_link: form.video_link
                }
            });
            let items = res.data;
            const hit = (items || []).find(it => String(it.key) === String(rowKey));
            const last = candsOf(hit).slice(-1)[0];
            let fileErr = '';
            if (last && (img || vid)) {
                try { items = await putFiles(last.key, items, img, vid); }
                catch (e) { fileErr = `เสนอชื่อแล้ว แต่อัปไฟล์ไม่สำเร็จ: ${e.message}`; }
            }
            applyItems(items);
            setForm(EMPTY); setImg(null); setVid(null); setNameErr(false);
            flashSent(name);
            if (next) {
                setFormSeq(n => n + 1);
                focusName.current = true;
            } else {
                setAdding(false);
            }
            // อัปไฟล์ไม่ผ่าน: บอกตรงฟอร์ม (ถ้ายังเปิด) หรือที่การ์ดของชื่อนั้น
            if (fileErr) setErr(fileErr, next ? 'add' : (last ? 'c' + last.key : ''));
        } catch (e) {
            setErr(e.message, 'add');
        } finally {
            setBusy(''); setSending('');
        }
    }

    function startEdit(c) {
        setEditKey(c.key);
        setEditForm({
            name: S(c.name), fee: c.fee == null ? '' : String(c.fee), contact: S(c.contact), agency: S(c.agency),
            link: S(c.link), note: S(c.note), image_link: S(c.image_link), video_link: S(c.video_link)
        });
        setEditImg(null); setEditVid(null); setClearImg(false); setClearVid(false); setEditNameErr(false);
        setPickKey(k => (k === c.key ? '' : k));
        setErr('');
    }

    const saveEdit = c => {
        if (!editForm.name.trim()) {
            setEditNameErr(true);
            if (editNameRef.current) editNameRef.current.focus();
            return;
        }
        run('e' + c.key, async () => {
            const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${c.key}`, {
                method: 'PUT',
                body: {
                    name: editForm.name, fee: Number(String(editForm.fee).replace(/[^0-9]/g, '')) || 0,
                    contact: editForm.contact, agency: editForm.agency, link: editForm.link, note: editForm.note,
                    image_link: editForm.image_link, video_link: editForm.video_link,
                    clear_image: clearImg, clear_video: clearVid
                }
            });
            let items = res.data;
            let fileErr = '';
            if (editImg || editVid) {
                try { items = await putFiles(c.key, items, editImg, editVid); }
                catch (e) { fileErr = `บันทึกการแก้ไขแล้ว แต่อัปไฟล์ไม่สำเร็จ: ${e.message}`; }
            }
            applyItems(items);
            setEditKey('');
            if (fileErr) setErr(fileErr, 'c' + c.key);
        });
    };

    // note = เหตุผลตอนไม่เอา (ไม่บังคับ) — server เก็บเป็น decided_note แล้วคนช่วยหาเห็นบนการ์ด
    const decide = (cand, status, note) => run('c' + cand.key, async () => {
        const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${cand.key}`,
            { method: 'PATCH', body: { status, note: note && note.trim() ? note.trim() : null } });
        applyItems(res.data);
        // ปิดเฉพาะกล่องของชื่อนี้ — ถ้ากำลังพิมพ์เหตุผล/ถามยืนยันของอีกชื่อค้างไว้ ต้องไม่หาย
        setRejectKey(k => (k === cand.key ? '' : k));
        setPickKey(k => (k === cand.key ? '' : k));
    });

    // ลิงก์ของใบนี้ไว้ส่งทาง LINE — ลิงก์เดียวใช้ได้ทุกคน (เปิดใบในหน้า Talent ได้ทั้งทีมแบรนด์และคนช่วยหา)
    // (ห้ามส่งลิงก์หน้างานตรง ๆ ให้คนช่วยหา — คนที่ไม่มีสิทธิ์แบรนด์เปิดหน้างานไม่ได้)
    async function copyLink() {
        const url = requestLink(window.location.origin, pid, rowKey);
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            window.prompt('คัดลอกลิงก์ใบนี้', url);
        }
    }

    const drop = cand => {
        const files = [cand.image && 'คอมการ์ด', cand.video && 'คลิปแนะนำตัว'].filter(Boolean).join(' และ ');
        if (!window.confirm(`เอาชื่อ "${cand.name}" ออกจากใบนี้?${files ? ` ${files} ที่แนบไว้จะถูกลบด้วย` : ''}`)) return;
        run('c' + cand.key, async () => {
            const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${cand.key}`, { method: 'DELETE' });
            applyItems(res.data);
        });
    };

    async function removeRequest() {
        setDeleting(true); setErr('');
        try {
            await api(`/projects/${pid}/hires/${rowKey}`, { method: 'DELETE' });
            window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
            setDel(false);
            // ใบนี้ไม่มีอยู่แล้ว — ให้หน้าแม่เป็นคนตัดสินใจว่าจะปิดกล่องหรือโหลดรายการใหม่
            if (onDeleted) onDeleted(); else if (onChanged) onChanged();
        } catch (e) { setErr(e.message); setDeleting(false); }
    }

    const cands = candsOf(row);
    const left = leftOf(row);
    const pending = cands.filter(c => (c.status || CAND_NEW) === CAND_NEW);
    const waiting = left > 0 ? pending : [];
    const spares = left > 0 ? [] : pending;
    // สถานะแปลก ๆ ที่ไม่รู้จัก (ข้อมูลเก่า) ไปอยู่ท้ายกลุ่มเลือกแล้ว — ชื่อต้องไม่หายจากการ์ดเงียบ ๆ
    const picked = cands.filter(c => (c.status || CAND_NEW) === CAND_PICKED || !CAND_KNOWN.includes(c.status || CAND_NEW));
    const dropped = cands.filter(c => (c.status || CAND_NEW) === CAND_DROPPED);
    const noOf = new Map(cands.map((c, i) => [String(c.key), i + 1]));   // เลขตามลำดับที่ส่งเข้ามา (คุยกันว่า "เบอร์ 3" ได้)
    // ข้อมูลจากคิว (GET /hires/tasks) ไม่มีฟิลด์ mode — การ์ดนี้เป็นใบขอให้หาเสมอ ต้องบอกตัวคิดขั้นตอนให้ชัด
    const castRow = { ...row, mode: 'casting' };
    const stage = hireStage(castRow, request.job_status, bookRows);
    const nPending = bookRows.filter(b => bookingState(b) === BOOK_PENDING).length;
    const nFee = bookRows.filter(b => bookingState(b) === BOOK_FEE).length;
    const needMore = hireNeedMore(castRow);
    const noFinder = row.assignee_id == null || row.assignee_id === '';
    const waitingText = stage === 'unassigned' ? `รอทีมแบรนด์เลือก${T.finder}`
        : stage === 'finding' ? `รอ ${row.assignee_name || T.finder} หาคน`
            : stage === 'deciding' ? `รอทีมแบรนด์เลือกชื่อที่ส่งมา${needMore > 0 ? ` · ${T.finder}ยังต้องหาเพิ่มอีก ${needMore} คน` : ''}`
                : stage === 'booking' ? (noFinder
                    ? `รอทีมแบรนด์${T.confirmQueue} ${nPending} คน (ใบนี้ไม่มี${T.finder})`
                    : `รอ ${row.assignee_name || T.finder} ${T.confirmQueue} ${nPending} คน`)
                    : stage === 'fee' ? `รอทีมแบรนด์ตัดสิน${T.newFee} ${nFee} คน${nPending ? ` · ${BOOKING_LABEL.pending}อีก ${nPending} คน` : ''}`
                        : stage === 'full' ? 'ได้คนครบตามที่ขอแล้ว'
                            : bookRows.length ? `งานนี้ปิดแล้ว · ยังมี ${bookRows.length} คนค้าง${T.confirmQueue} — ทีมแบรนด์จัดการต่อได้`
                                : 'งานนี้ปิดแล้ว — ส่งชื่อหรือเลือกชื่อเพิ่มไม่ได้';
    const closed = stage === 'closed';
    // ใบเปลี่ยนระหว่างที่กล่องยืนยัน "เลือกคนนี้" เปิดอยู่ (ได้ครบ / มีคนเลือกไปก่อน / งานปิด) → ปิดกล่องทิ้ง
    // ไม่งั้นกล่องหายไปแต่ค่ายังค้าง ปุ่ม "ไม่เอา" ของคนนั้นถูกซ่อนต่อโดยไม่มีทางกดยกเลิก
    useEffect(() => {
        if (!pickKey) return;
        const pc = cands.find(x => x && x.key === pickKey);
        if (left <= 0 || closed || !pc || (pc.status || CAND_NEW) !== CAND_NEW) setPickKey('');
    }, [pickKey, left, closed, cands]);
    // ชื่อที่ถูกเอาออก / เปลี่ยนรูป / ลบรูป → คืนหน่วยความจำของรูปย่อเดิม
    useEffect(() => {
        const m = thumbs.current;
        m.forEach((t, k) => {
            const c = cands.find(x => x && String(x.key) === String(k));
            if (c && fileId(c.image) === t.file) return;
            if (t.url) URL.revokeObjectURL(t.url);
            m.delete(k);
        });
    }, [cands]);
    // ใครเป็นคนยืนยันคิวต่อหลังทีมเลือกชื่อ — ใบที่ไม่มีคนช่วยหา ทีมแบรนด์ยืนยันเอง
    const nextConfirmer = noFinder ? 'ทีม'
        : (user && String(row.assignee_id) === String(user.id)) ? 'คุณ' : (row.assignee_name || T.finder);

    // ข้อผิดพลาดขึ้นตรงจุดที่กด ถ้าจุดนั้นยังเห็นอยู่ ไม่งั้นขึ้นบนสุดของการ์ดเหมือนเดิม
    const candByKey = new Map(cands.map(c => [String(c.key), c]));
    const groupOpen = c => {
        const st = c.status || CAND_NEW;
        if (st === CAND_DROPPED) return openGroups.dropped;
        if (st === CAND_NEW && left <= 0) return openGroups.spare;
        return true;
    };
    const errInline = !!err && (
        (errAt === 'add' && adding)
        || (!!editKey && errAt === 'e' + editKey)
        || (errAt.startsWith('c') && (() => {
            const c = candByKey.get(errAt.slice(1));
            return !!c && groupOpen(c) && editKey !== c.key;
        })())
        || (errAt.startsWith('b') && bookRows.some(b => 'b' + b.key === errAt))
    );
    const inlineErr = at => (err && errAt === at ? <div className="alert-error tc2-err" role="alert">{err}</div> : null);

    // การ์ดของชื่อที่เสนอหนึ่งชื่อในแกลเลอรี (หรือฟอร์มแก้ไข ถ้ากำลังแก้ชื่อนี้อยู่)
    function renderCand(c) {
        const no = noOf.get(String(c.key)) || 0;
        const st = c.status || CAND_NEW;
        if (editKey === c.key) {
            return (
                <div className="req-add req-edit tc2-edit" key={c.key}>
                    <div className="req-edit-lbl">แก้ไขชื่อที่เสนอ #{no}</div>
                    <CandFields form={editForm} setForm={setEditForm} budget={Number(row.fee) || 0}
                        img={editImg} setImg={setEditImg} vid={editVid} setVid={setEditVid}
                        current={c} clearImg={clearImg} setClearImg={setClearImg}
                        clearVid={clearVid} setClearVid={setClearVid}
                        nameRef={editNameRef} nameErr={editNameErr} onNameOk={() => setEditNameErr(false)} />
                    {inlineErr('e' + c.key)}
                    <div className="req-add-actions">
                        <button type="button" className="btn-ghost" disabled={busy === 'e' + c.key} onClick={() => setEditKey('')}>ยกเลิก</button>
                        <button type="button" className="btn-primary" disabled={busy === 'e' + c.key} onClick={() => saveEdit(c)}>
                            {busy === 'e' + c.key ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                        </button>
                    </div>
                </div>
            );
        }
        const spare = st === CAND_NEW && left <= 0;
        // ทีมแบรนด์ที่เสนอชื่อเองแล้วมาเลือกเอง — บอกให้รู้ตัว (ไม่ห้าม เพราะทีมเล็กทำเองทั้งสองฝั่งเป็นปกติ)
        const mine = canDecide && user && c.by_id != null && String(c.by_id) === String(user.id);
        const unavail = st === CAND_DROPPED && isUnavailNote(c.decided_note);
        const picking = pickKey === c.key && st === CAND_NEW && canDecide && left > 0 && !closed;
        const fee = Number(c.fee) || 0;
        const badge = budgetBadge(fee, row.fee);
        const ago = timeAgo(c.at);
        const byLine = c.by_name ? `เสนอโดย ${c.by_name}${ago ? ` · ${ago}` : ''}` : (ago ? `เสนอ ${ago}` : '');
        const imgPath = `/projects/${pid}/hires/${rowKey}/candidates/${c.key}/image`;
        const cls = st === CAND_PICKED ? 'ok' : st === CAND_DROPPED ? 'no' : spare ? 'spare' : st === CAND_NEW ? 'new' : 'other';
        // ปุ่มของชื่อนี้ — เงื่อนไขเดียวกับรอบ 1 ทุกปุ่ม (แค่แยกเป็นกลุ่มตัดสินใจ / เครื่องมือ)
        const hitBk = st === CAND_PICKED
            ? bookRows.find(bk => bk.from_candidate != null && String(bk.from_candidate) === String(c.key)) : null;
        const canPick = st === CAND_NEW && canDecide && left > 0 && !closed && rejectKey !== c.key && !picking;
        const canReject = st === CAND_NEW && canDecide && !closed && rejectKey !== c.key && !picking;
        const canRestore = st === CAND_DROPPED && canDecide && !closed;
        const showDecide = st === CAND_PICKED || canPick || canReject || canRestore;
        const showTools = canPropose && canTouch(c) && st !== CAND_PICKED;
        return (
            <div className={'tc2-card st-' + cls} key={c.key}>
                <div className="tc2-top">
                    <CandThumb c={c} no={no} path={imgPath} load={loadThumb} peek={peekThumb}
                        onOpen={() => setPreview({ path: imgPath, title: (c.image && c.image.original) || `คอมการ์ดของ ${c.name}`, kind: 'auto' })} />
                    <div className="tc2-info">
                        <div className="tc2-name">
                            <strong>{c.name}</strong>
                            <span className="tc2-st">{spare ? T.spare : unavail ? 'มาไม่ได้' : (CAND_LABEL[st] || st)}</span>
                            {mine && <span className="tc-self">ชื่อนี้คุณเสนอเอง</span>}
                        </div>
                        <div className="tc2-fee">
                            {fee > 0 ? <b>{B(fee)}</b> : <span className="tc2-badge none">ยังไม่ใส่ค่าตัว</span>}
                            {badge && <span className={'tc2-badge ' + badge.cls}>{badge.text}</span>}
                        </div>
                        {(c.agency || c.contact) && (
                            <div className="req-cand-meta">{[c.agency, c.contact].filter(Boolean).join(' · ')}</div>
                        )}
                        {byLine && <div className="tc2-by">{byLine}</div>}
                        {c.note && <div className="req-cand-note">📝 {c.note}</div>}
                        {st === CAND_DROPPED && (c.decided_note || c.decided_by) && (
                            <div className="req-cand-reason">
                                {/* คนที่เลือกแล้วแต่มาไม่ได้ ไม่ใช่ทีม "ไม่เอา" — แยกคำให้คนอ่านไม่เข้าใจผิด */}
                                {unavail
                                    ? `${showDecidedNote(c.decided_note)}${c.decided_by ? ` (แจ้งโดย ${c.decided_by})` : ''}`
                                    : `${T.reject}${c.decided_by ? ` โดย ${c.decided_by}` : ''}${c.decided_note ? ` — ${c.decided_note}` : ''}`}
                            </div>
                        )}
                        {/* รูปคอมการ์ดเปิดจากรูปย่อ — ตรงนี้เหลือลิงก์อื่น ๆ (ลิงก์คอมการ์ดขึ้นตรงนี้เฉพาะเมื่อมีไฟล์อัปไว้ด้วย) */}
                        {((c.image && c.image_link) || c.video || c.video_link || c.link) && (
                            <div className="req-cand-links">
                                {c.image && c.image_link && (
                                    <a className="work-link" href={c.image_link} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={12} /> คอมการ์ด (ลิงก์)</a>
                                )}
                                {c.video && (
                                    <button type="button" className="work-link"
                                        onClick={() => setPreview({ path: `/projects/${pid}/hires/${rowKey}/candidates/${c.key}/video`, title: c.video.original, kind: 'video' })}>
                                        <Icon name="eye" size={12} /> ดูคลิป
                                    </button>
                                )}
                                {c.video_link && <a className="work-link" href={c.video_link} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={12} /> ดูคลิป (ลิงก์)</a>}
                                {c.link && <a className="work-link" href={c.link} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={12} /> ดูโซเชียล</a>}
                            </div>
                        )}
                    </div>
                </div>

                {rejectKey === c.key && (
                    <div className="req-reject">
                        {/* เหตุผลลัด — กดแล้วเติมลงช่อง พิมพ์ต่อเองได้ */}
                        <div className="tc-reasons" role="group" aria-label="เหตุผลที่ใช้บ่อย">
                            {REJECT_REASONS.map(r => (
                                <button type="button" key={r}
                                    className={'proc-plat-chip' + (rejectNote.trim() === r ? ' on' : '')}
                                    aria-pressed={rejectNote.trim() === r}
                                    disabled={busy === 'c' + c.key}
                                    onClick={() => setRejectNote(r)}>{r}</button>
                            ))}
                        </div>
                        <input value={rejectNote} autoFocus maxLength={300}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder={`เหตุผลที่ไม่เอา (ไม่บังคับ) — ${T.finder}จะเห็นข้อความนี้`} />
                        <button type="button" className="btn-ghost" disabled={busy === 'c' + c.key}
                            onClick={() => { setRejectKey(''); setRejectNote(''); }}>ยกเลิก</button>
                        <button type="button" className="btn-reject" disabled={busy === 'c' + c.key}
                            onClick={() => decide(c, CAND_DROPPED, rejectNote)}>
                            {busy === 'c' + c.key ? 'กำลังบันทึก...' : `ยืนยัน: ${T.reject}`}
                        </button>
                    </div>
                )}
                {picking && (
                    <div className="tc-pick" role="group" aria-label={`ยืนยันเลือก ${c.name}`}>
                        <div className="tc-pick-q">
                            เลือก {c.name} {Number(c.fee) > 0 ? B(c.fee) : Number(row.fee) > 0 ? B(row.fee) : '(ยังไม่ระบุค่าตัว)'}?
                        </div>
                        {!(Number(c.fee) > 0) && Number(row.fee) > 0 && (
                            <div className="tc-pick-sub">ยังไม่ได้ใส่ค่าตัว — ใช้งบต่อคน {B(row.fee)} ไปก่อน แก้เป็นค่าตัวจริงได้ตอน{T.confirmQueue}</div>
                        )}
                        <div className="tc-pick-sub">
                            ขั้นต่อไป {nextConfirmer} จะ{T.confirmQueue}กับ {c.name} · เลือกแล้วย้อนกลับไม่ได้
                        </div>
                        <div className="tc-pick-actions">
                            <button type="button" className="btn-primary" disabled={busy === 'c' + c.key}
                                onClick={() => decide(c, CAND_PICKED)}>
                                {busy === 'c' + c.key ? 'กำลังบันทึก...' : 'เลือกเลย'}
                            </button>
                            <button type="button" className="btn-ghost" disabled={busy === 'c' + c.key}
                                onClick={() => setPickKey('')}>ยกเลิก</button>
                        </div>
                    </div>
                )}
                {inlineErr('c' + c.key)}

                {(showDecide || showTools) && (
                    <div className="tc2-actions">
                        {/* ปุ่มตัดสินใจอยู่ซ้าย (กดบ่อย) · แก้ไข / ลบ อยู่ขวา — การ์ดแคบแล้วเครื่องมือลงบรรทัดใหม่ชิดขวา */}
                        {showDecide && (
                            <div className="tc2-act-main">
                                {st === CAND_PICKED && (
                                    <span className="req-cand-done"
                                        title={canDecide
                                            ? 'แก้ข้อมูลคนนี้ได้ในหน้างาน — ส่วน "คนในงานนี้"'
                                            : 'ทีมแบรนด์เลือกคนนี้แล้ว'}>
                                        {/* ป้ายสถานะบนการ์ดบอก "เลือกแล้ว" อยู่แล้ว — ตรงนี้บอกแค่ขั้นต่อไปของคนนี้ */}
                                        {hitBk ? (BOOKING_LABEL[bookingState(hitBk)] || BOOKING_LABEL.pending) : 'อยู่ในรายชื่อผู้รับงานแล้ว'}
                                    </span>
                                )}
                                {canPick && (
                                    <button type="button" className="btn-primary" disabled={busy === 'c' + c.key}
                                        onClick={() => { setPickKey(c.key); setRejectKey(''); setErr(''); }}>✓ {T.pick}</button>
                                )}
                                {canReject && (
                                    <button type="button" className="btn-reject" disabled={busy === 'c' + c.key}
                                        onClick={() => { setRejectKey(c.key); setRejectNote(''); setPickKey(''); }}>✕ {T.reject}</button>
                                )}
                                {canRestore && (
                                    <button type="button" className="btn-ghost" disabled={busy === 'c' + c.key}
                                        title="ย้ายชื่อนี้กลับไปรอเลือกอีกครั้ง"
                                        onClick={() => decide(c, CAND_NEW)}>↩ {T.restore}</button>
                                )}
                            </div>
                        )}
                        {/* คนที่เลือกแล้วเป็นแถวผู้รับงานไปแล้ว — แก้ที่นี่ไม่ไปถึงแถวนั้น จึงแก้/เอาออกได้เฉพาะชื่อที่ยังไม่ถูกเลือก
                            (เอาออกตรงนี้หลังเลือกแล้ว ยอดคนกับงบจะไม่ตรงกัน) */}
                        {showTools && (
                            <div className="tc2-act-tools">
                                <button type="button" className="btn-ghost req-edit-btn" title="แก้ไขข้อมูลของคนนี้"
                                    disabled={busy === 'c' + c.key} onClick={() => startEdit(c)}>
                                    <Icon name="edit" size={13} /> แก้ไข
                                </button>
                                <button type="button" className="sub-del" title="เอาชื่อนี้ออกจากใบ" aria-label={`เอาชื่อ ${c.name} ออกจากใบ`}
                                    disabled={busy === 'c' + c.key}
                                    onClick={() => drop(c)}>
                                    <Icon name="trash" size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
    const gallery = list => <div className="tc2-gallery">{list.map(renderCand)}</div>;

    return (
        <div className="panel req-card tc-card" id={'req-' + rowKey}>
            {(heading || canDecide) && (
                <div className="req-card-head">
                    {heading && (
                        <>
                            <span className="cast-chip">{T.request}</span>
                            {row.kind && <strong className="req-card-kind">{row.kind}</strong>}
                            <span className={'req-need' + (left > 0 ? '' : ' done')}>
                                {left > 0 ? `ต้องหาอีก ${left} คน จาก ${Number(row.headcount) || 1}` : 'ได้ครบแล้ว'}
                            </span>
                            <span className="req-money">{B(row.fee)} / คน</span>
                        </>
                    )}
                    {/* แก้/ลบได้เฉพาะฝั่งคนขอ — คนช่วยหาแตะตัวใบไม่ได้ */}
                    {canDecide && (
                        <div className="row-actions req-card-actions">
                            <button type="button" className="icon-btn" title={`แก้ไข${T.request}`} onClick={() => setEditing(true)}>
                                <Icon name="edit" size={14} />
                            </button>
                            <button type="button" className="icon-btn danger" title={`ลบ${T.request}`} onClick={() => setDel(true)}>
                                <Icon name="trash" size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className="req-stage-line">
                <span className={'stage-chip st-' + stage}>{STAGE_LABEL[stage]}</span>
                <span className="req-stage-text">{waitingText}</span>
                <button type="button" className="btn-ghost req-copy" onClick={copyLink} title={`คัดลอกลิงก์ไว้ส่งให้${T.finder} / ทีม ทาง LINE`}>
                    <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์ใบนี้'}
                </button>
            </div>

            {err && !errInline && <div className="alert-error">{err}</div>}

            <div className="req-facts">
                <div><span>วันที่ต้องใช้งาน</span><b>{fmtD(row.use_date)}</b></div>
                <div><span>กำหนดส่งรายชื่อ</span><b>{fmtD(row.deadline)}</b></div>
                <div><span>สถานที่</span><b>{row.place || '—'}</b></div>
                {/* หมายเหตุของคนขอ (เช่น เงื่อนไขกองถ่าย) — คนช่วยหาต้องเห็นก่อนไปคุยกับใคร */}
                {row.note && String(row.note).trim() && (
                    <div className="tc-fact-wide"><span>{T.note}</span><b>{row.note}</b></div>
                )}
            </div>

            {row.spec && <div className="req-spec"><Icon name="file" size={14} /> {row.spec}</div>}
            {/* ขอบเขตงาน (ทำอะไร ใช้แค่ไหน) — ส่วนหนึ่งของโจทย์ที่คนช่วยหาต้องเห็นก่อนไปคุยราคา · มักพิมพ์เป็นข้อ ๆ จึงคงการขึ้นบรรทัดไว้ */}
            {row.scope && String(row.scope).trim() && (
                <div className="req-spec req-scope" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    <Icon name="target" size={14} /> <b>Scope of Work:</b> {row.scope}
                </div>
            )}

            <div className="req-assign">
                <span className="req-assign-lbl">{T.finder}</span>
                {canDecide && !noFinder && !changingFinder ? (
                    <>
                        <b>{row.assignee_name || `ผู้ใช้ #${row.assignee_id}`}</b>
                        <button type="button" className="btn-ghost" disabled={closed} onClick={() => setChangingFinder(true)}>เปลี่ยน</button>
                    </>
                ) : canDecide ? (
                    <>
                        <select value={assignee} onChange={e => setAssignee(e.target.value)}>
                            <option value="">— ยังไม่เลือก —</option>
                            {owners.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                            {/* คนที่เคยรับงานไว้แต่ไม่อยู่ในรายชื่อแล้ว (ปิดบัญชี/เปลี่ยนสิทธิ์) ต้องยังโชว์
                                ไม่งั้นช่องจะเด้งกลับเป็น "ยังไม่เลือก" แล้วกดบันทึกทีเดียวงานหลุดมือเงียบ ๆ */}
                            {assignee !== '' && !owners.some(u => String(u.id) === assignee) && (
                                <option value={assignee}>{row.assignee_name || `ผู้ใช้ #${assignee}`}</option>
                            )}
                        </select>
                        <button type="button" className="btn-ghost"
                            disabled={busy === 'assign' || assignee === (row.assignee_id == null ? '' : String(row.assignee_id))}
                            onClick={saveAssignee}>{busy === 'assign' ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                        {changingFinder && (
                            <button type="button" className="btn-ghost" disabled={busy === 'assign'}
                                onClick={() => { setChangingFinder(false); setAssignee(row.assignee_id == null ? '' : String(row.assignee_id)); }}>ยกเลิก</button>
                        )}
                    </>
                ) : (
                    <b>{row.assignee_name || `— ยังไม่ได้เลือก${T.finder} —`}</b>
                )}
            </div>

            <BookingSection rows={bookRows} pid={pid} rowKey={rowKey}
                canAct={canPropose && (!closed || canDecide)} canFee={canDecide}
                busy={busy} run={run} applyItems={applyItems} onStale={onChanged}
                err={err} errAt={errAt} />

            <div className="req-cands-head">
                <span>รายชื่อที่เสนอ ({cands.length}{waiting.length ? ` · ${CAND_LABEL['เสนอ']} ${waiting.length}` : ''}{spares.length ? ` · ${T.spare} ${spares.length}` : ''})</span>
                {canPropose && !adding && !closed && (
                    <button type="button" className="btn-ghost" onClick={openAdd}>
                        <Icon name="plus" size={14} /> เสนอชื่อ
                    </button>
                )}
            </div>

            {sent && <div className="tc2-sent" role="status"><Icon name="check" size={14} /> {sent}</div>}

            {adding && (
                <div className="req-add tc2-propose">
                    <CandFields key={formSeq} form={form} setForm={setForm} budget={Number(row.fee) || 0}
                        img={img} setImg={setImg} vid={vid} setVid={setVid}
                        compact more={more} setMore={setMore}
                        nameRef={nameRef} nameErr={nameErr} onNameOk={() => setNameErr(false)} />
                    {inlineErr('add')}
                    <div className="req-add-actions tc2-propose-actions">
                        <button type="button" className="btn-ghost" disabled={busy === 'add'} onClick={cancelAdd}>ยกเลิก</button>
                        {/* ส่งแล้วเสนอคนต่อไป: ฟอร์มยังเปิดอยู่ ช่องว่างพร้อมพิมพ์ชื่อถัดไป */}
                        <button type="button" className="btn-ghost" disabled={busy === 'add'} onClick={() => propose(true)}>
                            {sending === 'next' ? 'กำลังส่ง...' : 'ส่งแล้วเสนอคนต่อไป'}
                        </button>
                        <button type="button" className="btn-primary" disabled={busy === 'add'} onClick={() => propose(false)}>
                            {sending === 'one' ? 'กำลังส่ง...' : 'ส่งชื่อนี้ให้ทีม'}
                        </button>
                    </div>
                </div>
            )}

            {cands.length === 0 ? (
                <div className="req-empty">ยังไม่มีใครเสนอชื่อเข้ามา</div>
            ) : (
                <div className="tc2-cands">
                    {waiting.length > 0 ? (
                        <section className="tc2-group" aria-label={`${CAND_LABEL['เสนอ']} ${waiting.length} ชื่อ`}>
                            <div className="tc2-group-head">
                                {CAND_LABEL['เสนอ']} <span className="tc2-group-n">{waiting.length}</span>
                            </div>
                            {gallery(waiting)}
                        </section>
                    ) : left > 0 && !closed ? (
                        <div className="tc2-empty">ยังไม่มีชื่อรอเลือก</div>
                    ) : null}

                    {picked.length > 0 && (
                        <section className="tc2-group" aria-label={`${CAND_LABEL['เลือกแล้ว']} ${picked.length} ชื่อ`}>
                            <div className="tc2-group-head">
                                {CAND_LABEL['เลือกแล้ว']} <span className="tc2-group-n">{picked.length}</span>
                            </div>
                            {gallery(picked)}
                        </section>
                    )}

                    {/* ไม่เอา / มาไม่ได้ และตัวสำรอง พับไว้ — ไม่ใช่เรื่องที่ต้องทำตอนนี้ แต่ยังเปิดดู / เอากลับมาพิจารณาได้ */}
                    {dropped.length > 0 && (
                        <section className="tc2-group">
                            <button type="button" className="tc2-group-toggle" aria-expanded={openGroups.dropped}
                                onClick={() => toggleGroup('dropped')}>
                                <span className="tc2-caret" aria-hidden="true">▸</span>
                                {T.reject} / มาไม่ได้ <span className="tc2-group-n">{dropped.length}</span>
                            </button>
                            {openGroups.dropped && gallery(dropped)}
                        </section>
                    )}
                    {spares.length > 0 && (
                        <section className="tc2-group">
                            <button type="button" className="tc2-group-toggle" aria-expanded={openGroups.spare}
                                onClick={() => toggleGroup('spare')}>
                                <span className="tc2-caret" aria-hidden="true">▸</span>
                                {T.spare} <span className="tc2-group-n">{spares.length}</span>
                                <span className="tc2-group-hint">ได้คนครบแล้ว — เก็บไว้เผื่อคนที่เลือกมาไม่ได้</span>
                            </button>
                            {openGroups.spare && gallery(spares)}
                        </section>
                    )}
                </div>
            )}

            {preview && (
                <FilePreviewModal path={preview.path} title={preview.title} kind={preview.kind}
                    onClose={() => setPreview(null)} />
            )}

            {editing && (
                <HireRequestEditModal request={row}
                    onClose={() => setEditing(false)}
                    onSaved={items => { setEditing(false); applyItems(items); }} />
            )}

            {del && (
                <div className="modal-backdrop" onClick={() => !deleting && setDel(false)}>
                    <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>ลบ{T.request}นี้?</h3>
                        <p>
                            {row.kind || T.request}
                            {cands.length > 0 ? ` · รายชื่อที่เสนอไว้ ${cands.length} ชื่อจะหายไปด้วย` : ''}
                            {Number(row.filled) > 0 && !bookRows.length ? ` · คนที่เลือกไปแล้ว ${Number(row.filled)} คนยังอยู่ในงานจ้างตามเดิม` : ''}
                            {bookRows.length > 0 && (
                                <span className="req-del-block"> · ยังลบไม่ได้: มี {bookRows.length} คนที่เลือกแล้ว{BOOKING_LABEL.pending}/{BOOKING_LABEL.fee_review} — {T.confirmQueue} หรือกด "{T.cantCome}" ให้ครบก่อน</span>
                            )}
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={deleting} onClick={() => setDel(false)}>ยกเลิก</button>
                            <button type="button" className="btn-danger" disabled={deleting || bookRows.length > 0} onClick={removeRequest}>
                                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
