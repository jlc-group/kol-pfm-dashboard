import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import OtherProjectForm, {
    HIRE_STATUS, HIRE_JOB_CLOSED, isCasting, statusesOf, rowFee, hireLeft, hireStage, hireWaiting,
    bookingOpen, bookingState, hireBookings
} from '../components/OtherProjectForm.jsx';
import HireRequestCard from '../components/HireRequestCard.jsx';
import QuickHireForm from '../components/QuickHireForm.jsx';
import FilePreviewModal from '../components/FilePreviewModal.jsx';
import { fmtRange } from '../utils/date.js';
import { setNavSection } from '../utils/navSection.js';
import {
    T, STAGE_LABEL, BOOKING_LABEL, JOB_STATUS_OPTIONS, jobStatusLabel, jobStatusValue,
    hireStatusLabel, PAYABLE_STATUS, feeMissing, NEED_FEE_MSG
} from '../data/talentLabels.js';

// หน้ารายละเอียดของแคมเปญ "งานจ้างอื่น ๆ" (campaign_type = 'other')
// งานแบบนี้ไม่มี Platform / คลิป / ค่าแอด / เอเจนซี่ — สิ่งที่ต้องดูคือ "จ้างใคร ทำอะไร วันไหน เท่าไร"
// จึงเป็นคนละหน้ากับแคมเปญ KOL ทั้งหน้า (ProjectDetail เรียกหน้านี้แทนเมื่อเป็นประเภท other)
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};
// #req-<key> มาจาก URL ที่คนพิมพ์/วางเองได้ — % ที่ไม่ครบชุดทำให้ decodeURIComponent โยน error แล้วหน้าพังทั้งหน้า
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
// ตัวกรองสถานะ: ใบขอให้หาใช้ "ขั้นตอน" ที่คิดจากข้อมูล (ชุดเดียวกับการ์ดและแท็บใบขอให้หา) · ผู้รับงานใช้สถานะของคน
// ทุกตัวเป็น "ป้ายที่โชว์" (ทาบทาม → กำลังคุย) — labelOf ด้านล่างต้องแปลงด้วยชุดเดียวกัน ไม่งั้นชิปนับได้ 0
const CHIP_ORDER = [...new Set([...Object.values(STAGE_LABEL), ...Object.values(BOOKING_LABEL), ...HIRE_STATUS.map(hireStatusLabel)])];
// แถวเก่าที่บันทึกก่อนมี key ต้องมีรหัสประจำแถวเสมอ ไม่งั้น React จะสลับแถวตอนแก้ไขในตาราง
const rowsOf = p => (Array.isArray(p.hire_items) ? p.hire_items : []).map((it, i) => ({ ...it, key: it.key || 'h' + i }));

export default function OtherProjectDetail({ project, reload, onDeleted }) {
    const navigate = useNavigate();
    const location = useLocation();
    // หน้านี้เป็นของเมนู "งานจ้างอื่น ๆ" แม้ URL จะเป็น /projects/:id — ให้เมนูด้านข้างไฮไลต์ถูกอัน
    useEffect(() => { setNavSection('hires'); return () => setNavSection(null); }, []);
    const [tab, setTab] = useState('people');      // people = รายชื่อผู้รับงาน · days = ตารางงานตามวัน
    const [statusPick, setStatusPick] = useState('');
    // ช่องที่แก้ในตาราง (สถานะ/ลิงก์ Account/หมายเหตุ) เก็บไว้ก่อน แล้วกดบันทึกทีเดียว
    // ฐานข้อมูลเก็บ hire_items เป็นก้อนเดียว ถ้าบันทึกทุกครั้งที่พิมพ์ จะเขียนทับกันเองและท่วมประวัติการแก้ไข
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [showEdit, setShowEdit] = useState(false);
    const [showDel, setShowDel] = useState(false);
    const [preview, setPreview] = useState(null);      // ไฟล์แนบที่กำลังเปิดดูในหน้า
    const [deleting, setDeleting] = useState(false);
    // ฟอร์มสั้น (ลิ้นชักขวา): 'direct' = เพิ่มคนที่มีแล้ว · 'casting' = ขอให้ช่วยหา — ไม่แตะตารางที่แก้ค้างไว้
    const [quick, setQuick] = useState('');

    const items = useMemo(() => rowsOf(project), [project]);
    const view = items.map(it => ({ ...it, ...(draft[it.key] || {}) }));
    const dirty = Object.keys(draft).length > 0;
    const setField = (key, field, value) => setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), [field]: value } }));

    // ใบขอให้หาคิดงบเป็น งบต่อคน × จำนวนคนที่ขอ ส่วนแถวที่มีคนแล้วคิดค่าตัวตรง ๆ
    const totalFee = items.reduce((s, it) => s + rowFee(it), 0);
    const people = new Set(items.map(it => String(it.name || '').trim()).filter(Boolean)).size;
    const castingRows = items.filter(isCasting);
    // งานที่ปิดแล้ว (จบแล้ว/ยกเลิก) ไม่มีใครต้องหา/เลือกต่อ — ให้ตรงกับการ์ดและแท็บใบขอให้หา
    const jobClosed = HIRE_JOB_CLOSED.includes(project.status);
    const castingHeads = jobClosed ? 0 : castingRows.reduce((n, it) => n + hireLeft(it), 0);
    const waitingNames = jobClosed ? 0 : castingRows.reduce((n, it) => n + (hireLeft(it) > 0 ? hireWaiting(it) : 0), 0);
    // คนที่เลือกแล้วค้างยืนยันคิว — นับเฉพาะที่ใบต้นทางยังอยู่ (ใบหายไปแล้วถือว่าไม่ค้างขั้นนี้ ให้แก้สถานะเองได้)
    // งานปิดแล้วก็ยังโชว์ ให้ทีมเห็นว่ามีคนค้างต้องเก็บ
    const liveReq = new Set(castingRows.map(r => String(r.key)));
    const bookingLive = it => !isCasting(it) && it.from_request != null && liveReq.has(String(it.from_request)) && bookingOpen(it);
    const bookingPeople = items.filter(it => bookingLive(it) && bookingState(it) === 'pending').length;
    const feePeople = items.filter(it => bookingLive(it) && bookingState(it) === 'fee_review').length;
    // ใบขอให้หาใบหนึ่ง + ข้อมูลงานที่การ์ดต้องใช้ (สถานะงานใช้คิดขั้นตอน "งานปิดแล้ว")
    const reqOf = it => ({
        ...it, project_id: project.id, project_name: project.name, brand: project.brand,
        job_status: project.status, remaining: hireLeft(it), in_brand: true, is_assignee: true,
        // คนที่เลือกจากใบนี้แล้วยังรอยืนยันคิว — การ์ดเป็นที่เดียวที่ยืนยันคิว/คนนี้มาไม่ได้/ตัดสินค่าตัวใหม่
        bookings: hireBookings(items, it.key)
    });

    // มาจากหน้า Talent / ลิงก์ที่คัดลอกไว้ (#req-<ใบ>) → เลื่อนไปที่การ์ดของใบนั้นแล้วไฮไลต์ให้เห็น
    // hashFound: ใบที่เพิ่งสร้างจากฟอร์มสั้นอาจยังไม่อยู่ในข้อมูลตอนกด "ดูใบ" — พอโหลดเสร็จแล้วมีใบนั้น ให้เลื่อนอีกรอบ
    const hashKey = (/^#req-(.+)$/.exec(location.hash || '') || [])[1];
    const hashFound = !!hashKey && items.some(it => String(it.key) === safeDecode(hashKey));
    useEffect(() => {
        const m = /^#req-(.+)$/.exec(location.hash || '');
        if (!m) return undefined;
        const el = document.getElementById('req-' + safeDecode(m[1]));
        if (!el) return undefined;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('req-flash');
        const t = setTimeout(() => el.classList.remove('req-flash'), 2600);
        return () => clearTimeout(t);
    }, [location.hash, location.key, project.id, hashFound]);   // location.key: กดไปที่ใบเดิมซ้ำก็เลื่อนให้อีกครั้ง
    const useDates = items.map(it => it.use_date).filter(Boolean).sort();
    const rangeText = useDates.length
        ? fmtRange(useDates[0], useDates[useDates.length - 1], ' → ')
        : fmtRange(project.start_date, project.end_date, ' → ');

    const statusOf = it => it.status || statusesOf(it)[0];
    // ป้ายที่โชว์ (ไม่ใช่ค่าในฐาน) — ชุดเดียวกับ CHIP_ORDER
    const labelOf = it => (isCasting(it) ? STAGE_LABEL[hireStage(it, project.status, items)]
        : bookingLive(it) ? BOOKING_LABEL[bookingState(it)] : hireStatusLabel(statusOf(it)));
    // สถานะที่บันทึกไว้จริงของแถว (ก่อนแก้ในตาราง) — แถวเก่าที่ "ตกลงแล้ว" แต่ไม่มีค่าตัวต้องยังเลือกค่าเดิมค้างไว้ได้
    const savedStatus = key => { const hit = items.find(x => x.key === key); return hit ? statusOf(hit) : ''; };
    const countStatus = s => view.filter(it => labelOf(it) === s).length;
    const shown = statusPick ? view.filter(it => labelOf(it) === statusPick) : view;

    // จัดกลุ่มตามประเภทงาน (นางแบบ / Live สด ...) — กองถ่ายหนึ่งกองมักมีหลายประเภทในงานเดียว
    const byKind = [];
    shown.forEach(it => {
        const k = it.kind || 'ไม่ระบุประเภทงาน';
        let g = byKind.find(x => x.kind === k);
        if (!g) { g = { kind: k, rows: [] }; byKind.push(g); }
        g.rows.push(it);
    });

    // ตารางงานตามวัน — คนที่ยังไม่ระบุวันไปอยู่ท้ายสุดเสมอ
    const byDay = [];
    shown.forEach(it => {
        const d = it.use_date || '';
        let g = byDay.find(x => x.date === d);
        if (!g) { g = { date: d, rows: [] }; byDay.push(g); }
        g.rows.push(it);
    });
    byDay.sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date).localeCompare(String(b.date)));

    async function saveRows() {
        setSaving(true); setErr('');
        try {
            // ส่งช่องที่แก้ได้ + เวลาแก้ล่าสุดของข้อมูลที่เปิดอยู่
            // ฟิลด์ที่ระบบเป็นคนตั้ง (รายชื่อที่เสนอ / ไฟล์ / จำนวนที่หาได้แล้ว / งบ) server ยึดของในฐานเอง ไม่ต้องส่ง
            const hire_items = items.map(({ candidates, image, filled, requested_by_id, requested_at, from_request, from_candidate, booking, ...it }) =>
                ({ ...it, ...(draft[it.key] || {}) }));
            await api(`/projects/${project.id}`, {
                method: 'PUT',
                body: { hire_items, expected_updated_at: project.updated_at || null }
            });
            setDraft({});
            reload();
        } catch (e) {
            if (e.status === 409) {
                // ข้อมูลเพิ่งเปลี่ยน (เช่นมีคนส่งชื่อในใบขอให้หา) — โหลดค่าล่าสุดให้เลย ช่องที่แก้ค้างไว้ยังอยู่
                reload();
                setErr('ข้อมูลของงานนี้เพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว ช่องที่แก้ไว้ยังอยู่ กดบันทึกอีกครั้ง');
            } else {
                setErr(e.message);
            }
        } finally { setSaving(false); }
    }

    async function changeStatus(status) {
        // ปิดงานตอนยังมีคนค้างยืนยันคิว — เตือนก่อน (ปิดแล้วคนช่วยหาแตะไม่ได้ ทีมต้องเก็บเอง)
        if (HIRE_JOB_CLOSED.includes(status) && (bookingPeople + feePeople) > 0
            && !window.confirm(`ยังมี ${bookingPeople + feePeople} คนที่เลือกแล้ว${BOOKING_LABEL.pending}/${BOOKING_LABEL.fee_review} — ปิดงานแล้ว${T.finder}จะแตะไม่ได้ ทีมแบรนด์ต้องจัดการเองที่การ์ดของใบ ต้องการปิดงานไหม?`)) return;
        try { await api(`/projects/${project.id}`, { method: 'PUT', body: { status } }); reload(); }
        catch (e) { alert(e.message); }
    }

    async function deleteProject() {
        setDeleting(true);
        try { await api(`/projects/${project.id}`, { method: 'DELETE' }); onDeleted(); }
        catch (e) { alert(e.message); setDeleting(false); }
    }

    // งานจ้างอื่น ๆ ไม่มีช่องบรีฟแล้ว เหลือแค่รายละเอียดงาน

    // ปุ่มย้อนกลับ: มาจากในแอป (หน้าหลัก Talent / ลิ้นชักใบ / รายการงาน) → กลับหน้าเดิมพร้อมแท็บและตัวกรองเดิม
    // เปิดตรงจากลิงก์ (ไม่มีประวัติในแอป) → ไปหน้า Talent แทน ไม่ให้เด้งออกนอกเว็บ
    function goBack() {
        if (window.history.state && window.history.state.idx > 0) navigate(-1);
        else navigate('/hires');
    }

    return (
        <div>
            <div className="pd-hero tc-hero">
                <button className="pd-back" onClick={goBack} title="กลับหน้าที่มา" aria-label="กลับหน้าที่มา">
                    <Icon name="back" size={18} />
                </button>
                <div className="pd-hero-main">
                    <div className="pd-hero-top">
                        <span className={`status status-${project.status}`}>{jobStatusLabel(project.status)}</span>
                        <span className="ctype-chip" title="งาน Talent — ไม่เข้าหน้าโฆษณาและรายงานแคมเปญ">Talent</span>
                        {project.brand && <span className="pd-chip">{project.brand}</span>}
                    </div>
                    <h1 className="pd-title">{project.name}</h1>
                </div>
                <div className="pd-hero-actions">
                    <label className="quick-status">สถานะ:
                        {/* งาน Draft โชว์เป็น "กำลังทำ" (ป้ายเดียวกัน) — ไม่เปลี่ยนค่าในฐานจนกว่าจะเลือกสถานะอื่นเอง */}
                        <select value={jobStatusValue(project.status)} onChange={e => changeStatus(e.target.value)}>
                            {JOB_STATUS_OPTIONS.map(s => <option key={s} value={s}>{jobStatusLabel(s)}</option>)}
                        </select>
                    </label>
                    <button type="button" className="pd-edit-btn" onClick={() => setQuick('direct')}
                        title="บันทึกคนที่ดีลไว้แล้วเข้างานนี้ ทีละคน">
                        <Icon name="plus" size={15} /> เพิ่มคนที่มีแล้ว
                    </button>
                    {/* งานปิดแล้วขอให้ช่วยหาเพิ่มไม่ได้ (server ตีกลับ 409) — ปิดปุ่มไว้พร้อมบอกเหตุผล */}
                    <button type="button" className="pd-edit-btn" onClick={() => setQuick('casting')} disabled={jobClosed}
                        title={jobClosed ? 'งานนี้จบแล้ว — ขอให้ช่วยหาเพิ่มไม่ได้' : `เปิด${T.request} ให้${T.finder}ส่งรายชื่อมาให้เลือก`}>
                        <Icon name="plus" size={15} /> ขอให้ช่วยหา
                    </button>
                    <button type="button" className="tc-hero-ghost" onClick={() => {
                        if (dirty && !window.confirm(`ยังมีที่แก้ในตาราง ${Object.keys(draft).length} แถวที่ยังไม่ได้บันทึก — เปิดฟอร์มแก้ไขแล้วค่าเหล่านี้จะหาย ต้องการไปต่อไหม?`)) return;
                        setShowEdit(true);
                    }} title="แก้ชื่องาน รายละเอียด สถานะ หรือเพิ่ม/แก้หลายคนพร้อมกันในฟอร์มเต็ม">
                        <Icon name="edit" size={15} /> แก้ไขงาน / หลายคน
                    </button>
                    <button className="pd-del-btn" onClick={() => setShowDel(true)} title="ลบงานนี้">
                        <Icon name="trash" size={15} /> ลบ
                    </button>
                </div>
            </div>

            <div className="pd-metrics">
                <div className="pd-metric">
                    <div className="pd-metric-icon budget"><Icon name="coins" size={22} /></div>
                    <div>
                        <div className="pd-metric-label">ค่าตัวรวม</div>
                        <div className="pd-metric-value">{B(totalFee)}</div>
                        <div className="pd-metric-extra">
                            {items.length} รายการจ้าง
                            {castingRows.length > 0 && ` · ${T.request} ${castingRows.length} ใบ`}
                        </div>
                    </div>
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon kol"><Icon name="team" size={22} /></div>
                    <div>
                        <div className="pd-metric-label">ผู้รับงาน</div>
                        <div className="pd-metric-value">{people} คน</div>
                        <div className="pd-metric-extra">
                            {byKind.length} ประเภทงาน
                            {castingHeads > 0 && ` · ต้องหาอีก ${castingHeads} คน`}
                            {waitingNames > 0 && ` · รอเลือก ${waitingNames} ชื่อ`}
                            {bookingPeople > 0 && ` · ${BOOKING_LABEL.pending} ${bookingPeople} คน`}
                            {feePeople > 0 && ` · ${BOOKING_LABEL.fee_review} ${feePeople} คน`}
                        </div>
                    </div>
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon date"><Icon name="calendar" size={20} /></div>
                    <div>
                        <div className="pd-metric-label">ช่วงวันใช้งาน</div>
                        <div className="pd-metric-value sm">{rangeText}</div>
                        {!useDates.length && <div className="pd-metric-extra">ยังไม่ได้ระบุวันรายคน</div>}
                    </div>
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon owner"><Icon name="users" size={20} /></div>
                    <div>
                        <div className="pd-metric-label">{T.owner}</div>
                        <div className="pd-metric-value sm">{project.creator || project.owner || '—'}</div>
                    </div>
                </div>
            </div>

            {project.objective && (
                <div className="panel pd-details">
                    {project.objective && (
                        <div className="pd-block">
                            <div className="pd-block-title"><Icon name="file" size={15} /> รายละเอียดงาน</div>
                            <p className="pd-block-text">{project.objective}</p>
                        </div>
                    )}
                </div>
            )}

            <div className="agency-tabs">
                <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
                    รายชื่อผู้รับงาน <span className="agency-tab-count">{items.length}</span>
                </button>
                <button className={tab === 'days' ? 'active' : ''} onClick={() => setTab('days')}>
                    ตารางงานตามวัน <span className="agency-tab-count">{byDay.length}</span>
                </button>
            </div>

            <div className="proc-platfilter">
                <span className="proc-platfilter-lbl">สถานะ:</span>
                <button type="button" className={'proc-plat-chip' + (statusPick === '' ? ' on' : '')}
                    onClick={() => setStatusPick('')}>ทั้งหมด ({view.length})</button>
                {/* โชว์เฉพาะสถานะที่มีจริงในงานนี้ — สองรูปแบบใช้สถานะคนละชุด ถ้าโชว์หมดจะมีปุ่ม (0) เต็มไปหมด */}
                {CHIP_ORDER.filter(s => countStatus(s) > 0 || statusPick === s).map(s => (
                    <button type="button" key={s} className={'proc-plat-chip' + (statusPick === s ? ' on' : '')}
                        onClick={() => setStatusPick(s)}>{s} ({countStatus(s)})</button>
                ))}
            </div>

            {err && <div className="alert-error">{err}</div>}
            {dirty && (
                <div className="draft-decide">
                    <span className="draft-decide-lbl">แก้ไขแล้วยังไม่ได้บันทึก {Object.keys(draft).length} แถว</span>
                    <button type="button" className="btn-primary" disabled={saving} onClick={saveRows}>
                        {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                    </button>
                    <button type="button" className="btn-ghost" disabled={saving} onClick={() => setDraft({})}>ยกเลิก</button>
                </div>
            )}

            {items.length === 0 ? (
                <div className="panel empty-state">
                    <div className="empty-emoji">🎬</div>
                    <p>ยังไม่มีรายการจ้าง — กดปุ่ม "+ เพิ่มคนที่มีแล้ว" ด้านบนถ้าดีลคนไว้แล้ว หรือ "+ ขอให้ช่วยหา" ถ้ายังไม่มีคน</p>
                </div>
            ) : tab === 'people' ? (
                byKind.map(g => {
                    // แยกสองส่วนในกลุ่มเดียวกัน: ใบขอให้หา (ยังไม่ได้ตัวคน) กับผู้รับงานที่ได้ตัวแล้ว
                    // โครงเดียวกับหน้าแคมเปญ KOL — แถบกลุ่มสีเขียว แล้วหัวข้อย่อยมีจุดสีบอกสถานะ
                    const reqs = g.rows.filter(isCasting);
                    const hired = g.rows.filter(it => !isCasting(it));
                    return (
                        <div className="sub-group" key={g.kind}>
                            <div className="grp-bar">
                                <span className="grp-no">{g.kind}</span>
                                <span className="grp-count">{g.rows.length} รายการ · {B(g.rows.reduce((s, it) => s + rowFee(it), 0))}</span>
                            </div>

                            {reqs.length > 0 && (
                                <>
                                    <div className="sub-group-head">
                                        <span className="sub-group-dot pending"></span>
                                        <span className="sub-group-title">{T.request}</span>
                                        <span className="sub-group-count">{reqs.length}</span>
                                    </div>
                                    {/* กางรายชื่อที่เสนอไว้ในหน้าเลย ไม่ต้องกดเปิดกล่องอีกชั้น */}
                                    {reqs.map(it => (
                                        <HireRequestCard key={it.key} request={reqOf(it)} canDecide canPropose
                                            onChanged={reload} onDeleted={reload} />
                                    ))}
                                </>
                            )}

                            {hired.length > 0 && (
                                <>
                                    <div className="sub-group-head">
                                        <span className="sub-group-dot confirmed"></span>
                                        <span className="sub-group-title">ผู้รับงาน</span>
                                        <span className="sub-group-count">{hired.length}</span>
                                    </div>
                                    <div className="panel no-pad">
                                        <div className="sub-table-scroll">
                                            <table className="data-table tight hire-detail-table">
                                                <thead><tr>
                                                    <th className="sub-no">#</th><th>ชื่อผู้รับงาน</th><th>งาน</th>
                                                    <th className="num">ค่าตัว</th><th>วันใช้งาน</th><th>ไฟล์ / ลิงก์</th>
                                                    <th>สถานะ</th><th>หมายเหตุ</th>
                                                    <th className="tbl-spacer" aria-hidden="true"></th>
                                                </tr></thead>
                                                <tbody>
                                                    {hired.map((it, i) => (
                                                        <tr key={it.key}>
                                                            <td className="sub-no">{i + 1}</td>
                                                            {/* สังกัด/ติดต่อ ย้ายมาอยู่ใต้ชื่อ ตารางจะได้ไม่ต้องเลื่อนซ้ายขวา */}
                                                            <td>
                                                                <strong>{it.name || '—'}</strong>
                                                                {(it.agency || it.contact) && (
                                                                    <span className="cast-sub">{[it.agency, it.contact].filter(Boolean).join(' · ')}</span>
                                                                )}
                                                                {it.from_request && <span className="hire-assignee">ได้จาก{T.request}</span>}
                                                            </td>
                                                            <td className="muted">
                                                                {it.qty || '—'}
                                                                {it.place && <span className="cast-sub">📍 {it.place}</span>}
                                                            </td>
                                                            <td className="num">
                                                                {/* คนที่ยังกำลังคุยบันทึกได้โดยไม่มีค่าตัว — บอกให้ชัดแทน ฿0 ที่ดูเหมือนจ้างฟรี */}
                                                                {feeMissing(it.fee)
                                                                    ? <span className="tc-fee-missing" title='ใส่ค่าตัวได้ที่ปุ่ม "แก้ไขงาน / หลายคน"'>ยังไม่ใส่ค่าตัว</span>
                                                                    : B(rowFee(it))}
                                                            </td>
                                                            <td className="muted">
                                                                {fmtD(it.use_date)}
                                                                {it.use_time && <span className="cast-sub">{it.use_time}</span>}
                                                            </td>
                                                            <td>
                                                                <div className="hire-file-cell">
                                                                {it.image && (
                                                                    <button type="button" className="work-link"
                                                                        onClick={() => setPreview({ path: `/projects/${project.id}/hires/${it.key}/image`, title: it.image.original })}>
                                                                        <Icon name="eye" size={12} /> คอมการ์ด
                                                                    </button>
                                                                )}
                                                                <input className="sub-note-input" value={it.link || ''} placeholder="🔗 IG / TikTok"
                                                                    onChange={e => setField(it.key, 'link', e.target.value)} />
                                                                </div>
                                                            </td>
                                                            <td>
                                                                {bookingLive(it) ? (
                                                                    // ระหว่างรอยืนยันคิว สถานะเดินตามขั้นตอนบนการ์ด เปลี่ยนเองจากตารางไม่ได้
                                                                    <>
                                                                        <span className={'stage-chip st-' + (bookingState(it) === 'fee_review' ? 'fee' : 'booking')}>
                                                                            {BOOKING_LABEL[bookingState(it)]}
                                                                        </span>
                                                                        <button type="button" className="work-link"
                                                                            onClick={() => {
                                                                                // ล้างตัวกรองก่อน ไม่งั้นการ์ดของใบอาจถูกกรองซ่อนอยู่ แล้วกดแล้วไม่ไปไหน
                                                                                setStatusPick('');
                                                                                navigate({ hash: '#req-' + it.from_request }, { replace: true });
                                                                            }}>
                                                                            ไปที่ใบ
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <select className="users-inline-sel" value={statusOf(it)}
                                                                        onChange={e => setField(it.key, 'status', e.target.value)}>
                                                                        {/* "ตกลงแล้ว" ขึ้นไปต้องมีค่าตัวก่อน (server ตีกลับเหมือนกัน)
                                                                            ยกเว้นค่าที่บันทึกไว้อยู่แล้ว — แถวเก่าต้องยังโชว์/คงค่าเดิมได้ */}
                                                                        {statusesOf(it).map(s => {
                                                                            const blocked = PAYABLE_STATUS.includes(s) && feeMissing(it.fee) && s !== savedStatus(it.key);
                                                                            return (
                                                                                <option key={s} value={s} disabled={blocked} title={blocked ? NEED_FEE_MSG : undefined}>
                                                                                    {hireStatusLabel(s)}{blocked ? ' (ใส่ค่าตัวก่อน)' : ''}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                    </select>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <input className="sub-note-input" value={it.note || ''} placeholder="📝 หมายเหตุ"
                                                                    onChange={e => setField(it.key, 'note', e.target.value)} />
                                                            </td>
                                                            <td className="tbl-spacer"></td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })
            ) : (
                byDay.map(g => (
                    <div className="sub-group" key={g.date || 'no-date'}>
                        <div className="grp-bar">
                            <span className="grp-no">{g.date ? fmtD(g.date) : 'ยังไม่ระบุวัน'}</span>
                            <span className="grp-concept">{[...new Set(g.rows.map(r => r.place).filter(Boolean))].join(' · ')}</span>
                            <span className="grp-count">{g.rows.length} รายการ</span>
                        </div>
                        <div className="panel no-pad">
                            <div className="sub-table-scroll">
                                <table className="data-table tight">
                                    <thead><tr>
                                        <th className="sub-no">#</th><th>ชื่อผู้รับงาน</th><th>ประเภทงาน</th><th>สถานที่</th>
                                        <th>สถานะ</th><th className="num">ค่าตัว</th>
                                        <th className="tbl-spacer" aria-hidden="true"></th>
                                    </tr></thead>
                                    <tbody>
                                        {g.rows.map((it, i) => (
                                            <tr key={it.key}>
                                                <td className="sub-no">{i + 1}</td>
                                                <td>
                                                    {isCasting(it)
                                                        ? <span className="cast-chip">{T.request}{it.kind ? ` · ${it.kind}` : ''} · {hireLeft(it) > 0 ? `ต้องหาอีก ${hireLeft(it)} คน` : 'ได้ครบแล้ว'}</span>
                                                        : <strong>{it.name || '—'}</strong>}
                                                </td>
                                                <td>{it.kind ? <span className="proc-ctype-chip">{it.kind}</span> : <span className="ctype-none">— ยังไม่ระบุ —</span>}</td>
                                                <td className="muted">{it.place || '—'}</td>
                                                <td><span className="tag">{labelOf(it)}</span></td>
                                                <td className="num">{B(rowFee(it))}</td>
                                                <td className="tbl-spacer"></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ))
            )}

            {preview && (
                <FilePreviewModal path={preview.path} title={preview.title} onClose={() => setPreview(null)} />
            )}

            {showEdit && (
                <OtherProjectForm editing={project} onClose={() => setShowEdit(false)} onConflict={reload}
                    onSaved={() => { setShowEdit(false); setDraft({}); reload(); }} />
            )}

            {/* ฟอร์มสั้นเพิ่มทีละคน / ขอให้ช่วยหา — ต่อท้ายงานนี้ด้วยเส้น POST ของแถวเดียว ไม่ทับที่แก้ค้างในตาราง
                "ดูใบ" หลังส่งใบ: สลับไปแท็บรายชื่อและล้างตัวกรองก่อน ไม่งั้นการ์ดของใบถูกซ่อนแล้วเลื่อนไปไม่เจอ */}
            {quick && (
                <QuickHireForm mode={quick} job={project}
                    onClose={() => setQuick('')}
                    onSaved={() => reload()}
                    onOpenRequest={({ key }) => {
                        setTab('people');
                        setStatusPick('');
                        navigate({ hash: '#req-' + key }, { replace: true });
                    }} />
            )}

            {showDel && (
                <div className="modal-backdrop" onClick={() => !deleting && setShowDel(false)}>
                    <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>ลบงานนี้?</h3>
                        <p>“{project.name}” และรายการจ้างทั้งหมดในงานนี้จะถูกลบถาวร</p>
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={deleting} onClick={() => setShowDel(false)}>ยกเลิก</button>
                            <button type="button" className="btn-danger" disabled={deleting} onClick={deleteProject}>
                                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
