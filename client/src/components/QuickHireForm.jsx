import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, uploadFile } from '../api/client.js';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import SideDrawer from './SideDrawer.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import { HIRE_KINDS, HIRE_JOB_CLOSED } from './OtherProjectForm.jsx';
import { T, feeMissing, needsFee, NEED_FEE_MSG, baht, requestLink, todayTH, addDays } from '../data/talentLabels.js';
import { fmtDate } from '../utils/date.js';

// ฟอร์มสั้นของหน้า Talent — แทนการเปิดฟอร์มเต็มแล้วเลือก "รูปแบบการจ้าง" ใน dropdown
// • mode 'direct'  = มีคนแล้ว บันทึกการจ้าง (1 คน = 1 แถว)
// • mode 'casting' = ขอให้ช่วยหาคน (1 ใบขอให้หา)
// บันทึกทีละแถวผ่าน POST /projects/:id/hires — ไม่ส่งรายการจ้างทั้งก้อน จึงไม่ชน 409 กับคนช่วยหาที่กำลังส่งชื่อเข้าใบอยู่
// งานใหม่ใช้ POST /projects เดิม (สร้างงาน + แถวแรกในคำขอเดียว)

// ค่าสถานะในฐาน (ห้ามเปลี่ยน) — ป้ายที่โชว์มาจาก T
const TALKING = 'ทาบทาม';
const AGREED = 'ตกลงแล้ว';
const OWNER_KEY = 'talent.lastOwner';
const MAX_FILE = 10 * 1024 * 1024;
const FILE_OK = /\.(png|jpe?g|webp|pdf)$/i;

const num = v => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const digits = v => String(v || '').replace(/[^0-9]/g, '');
const trimOrNull = v => (String(v || '').trim() || null);
const clampHead = v => Math.min(99, Math.max(1, parseInt(v, 10) || 1));
// '2026-09-25' → '25/9/26' (หน้าจบของใบ — สั้นพอจะก๊อปไปพิมพ์ใน LINE ต่อ)
const dmy = ymd => {
    const [y, m, d] = String(ymd || '').slice(0, 10).split('-');
    return y && m && d ? `${Number(d)}/${Number(m)}/${y.slice(2)}` : String(ymd || '');
};
const jobRange = j => {
    const a = j && j.start_date, b = j && j.end_date;
    if (!a && !b) return '';
    if (!a || !b || a === b) return fmtDate(a || b);
    return `${fmtDate(a)} – ${fmtDate(b)}`;
};
// localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว / ถูกบล็อก) — ห้ามให้ฟอร์มพังเพราะแค่จำค่าไม่ได้
const readStore = k => { try { return window.localStorage.getItem(k) || ''; } catch { return ''; } };
const writeStore = (k, v) => {
    try { if (v) window.localStorage.setItem(k, v); else window.localStorage.removeItem(k); } catch { /* จำไม่ได้ก็ไม่เป็นไร */ }
};

// ช่องของทั้งสองโหมดรวมไว้ก้อนเดียว — ส่งเฉพาะช่องของโหมดนั้นตอนบันทึก
const START = {
    name: '', kind: '', fee: '', status: TALKING,
    use_date: '', use_time: '', place: '',
    contact: '', agency: '', qty: '', link: '', note: '',
    headcount: '1', spec: '', deadline: '', assignee_id: ''
};
// "มีอะไรพิมพ์ค้างไว้ไหม" — เทียบกับค่าตอนเปิดฟอร์ม/ตอนบันทึกล่าสุด (แบรนด์/ผู้ดูแล/งานที่เลือก เป็นแค่การกดเลือก ไม่นับ)
const dirtyKey = (f, jobName, file) => JSON.stringify([f, String(jobName || '').trim(), file ? `${file.name}:${file.size}` : '']);

function Field({ label, req, opt, hint, err, htmlFor, labelId, className = '', children }) {
    const head = (
        <>
            {label}
            {req && <span className="qf-req" aria-hidden="true"> *</span>}
            {opt && <span className="qf-opt"> ({opt})</span>}
        </>
    );
    return (
        <div className={'qf-field' + (err ? ' has-err' : '') + (className ? ' ' + className : '')}>
            {label && (htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{head}</label>
                : <div className="qf-label" id={labelId}>{head}</div>)}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}

export default function QuickHireForm({ mode = 'direct', job = null, onClose, onSaved, onOpenRequest }) {
    const casting = mode === 'casting';
    const uid = useId();
    const id = s => `${uid}-${s}`;
    const { user } = useAuth();
    const brandOpts = visibleBrands(user);

    // ===== ① งานไหน =====
    // งานที่เพิ่งสร้างจาก "บันทึกแล้วเพิ่มอีกคน" — คนถัดไปต้องต่อท้ายงานเดิม ไม่ใช่สร้างงานใหม่ซ้ำ
    const [createdJob, setCreatedJob] = useState(null);
    const lockedJob = job || createdJob;
    const [jobMode, setJobMode] = useState(null);          // 'existing' | 'new' | null (ยังโหลดรายการงานไม่เสร็จ)
    const modeTouched = useRef(false);
    const [jobs, setJobs] = useState(null);                  // งานที่ยังไม่ปิด (null = กำลังโหลด)
    const [jobsErr, setJobsErr] = useState('');
    const [jobQuery, setJobQuery] = useState('');
    const [pickedJob, setPickedJob] = useState(null);
    const [brand, setBrand] = useState(() => (brandOpts.length === 1 ? brandOpts[0] : ''));
    const [jobName, setJobName] = useState('');
    // ผู้ดูแลงาน (เก็บเป็นชื่อในช่อง creator เหมือนฟอร์มเต็ม) — ทีมใช้บัญชีร่วมกัน ระบบเดาเองไม่ได้ จึงจำค่าที่เลือกล่าสุดไว้ให้
    const [owner, setOwner] = useState(() => readStore(OWNER_KEY));
    const [people, setPeople] = useState([]);

    // ===== ②③ ตัวคน / ใบ =====
    const [f, setF] = useState(START);
    const [file, setFile] = useState(null);
    const [fileErr, setFileErr] = useState('');
    const [moreOpen, setMoreOpen] = useState(false);
    const [feeNote, setFeeNote] = useState('');

    // ===== สถานะการบันทึก =====
    const [tried, setTried] = useState(false);               // กดบันทึกแล้วอย่างน้อยหนึ่งครั้ง → เริ่มโชว์ข้อความใต้ช่อง
    const [errTick, setErrTick] = useState(0);
    const [saving, setSaving] = useState('');                // '' | 'one' | 'more' | 'send'
    const [error, setError] = useState('');
    const [savedMsg, setSavedMsg] = useState('');
    const [upFail, setUpFail] = useState(null);              // { pid, key, file, name, msg, pending }
    const [retrying, setRetrying] = useState(false);
    const [done, setDone] = useState(null);                  // หน้าจบของใบขอให้หา
    const [copied, setCopied] = useState(false);
    const cleanKey = useRef(dirtyKey(START, '', null));
    const wrapRef = useRef(null);
    const nameRef = useRef(null);

    const hasJob = !!job;
    useEffect(() => {
        if (hasJob) return undefined;
        let alive = true;
        api('/hires/jobs')
            .then(res => {
                if (!alive) return;
                const rows = (res && res.data && Array.isArray(res.data.rows) ? res.data.rows : []).filter(r => r && !r.closed);
                setJobs(rows);
                // ค่าเริ่ม: มีงานที่กำลังทำอยู่ → เลือกจากงานเดิมก่อน (ส่วนใหญ่เพิ่มคนเข้างานที่เปิดไว้แล้ว)
                if (!modeTouched.current) setJobMode(rows.length ? 'existing' : 'new');
            })
            .catch(err => {
                if (!alive) return;
                setJobs([]);
                setJobsErr(err.message);
                if (!modeTouched.current) setJobMode('new');
            });
        return () => { alive = false; };
    }, [hasJob]);

    useEffect(() => {
        let alive = true;
        api('/users/options')
            .then(res => { if (alive) setPeople(Array.isArray(res && res.data) ? res.data : []); })
            .catch(() => { if (alive) setPeople([]); });
        return () => { alive = false; };
    }, []);
    const ownerNames = people.map(u => u.name);
    // ชื่อที่จำไว้แต่ไม่อยู่ในรายชื่อแล้ว (ปิดบัญชีไป) — ล้างทิ้ง ไม่งั้นงานใหม่จะผูกกับคนที่ไม่อยู่แล้ว
    useEffect(() => {
        if (owner && people.length && !people.some(u => u.name === owner)) setOwner('');
    }, [people, owner]);

    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const pickMode = m => { modeTouched.current = true; setJobMode(m); };
    const chooseOwner = v => { setOwner(v); writeStore(OWNER_KEY, v); };

    const filteredJobs = useMemo(() => {
        const list = Array.isArray(jobs) ? jobs : [];
        const q = jobQuery.trim().toLowerCase();
        const hit = q ? list.filter(j => [j.name, j.brand, j.contact].some(v => String(v || '').toLowerCase().includes(q))) : list;
        // งานที่เลือกไว้ต้องยังเห็นอยู่ แม้พิมพ์ค้นคำอื่นไปแล้ว — ไม่งั้นดูเหมือนไม่ได้เลือกอะไร
        if (pickedJob && !hit.some(j => String(j.id) === String(pickedJob.id))) return [pickedJob, ...hit];
        return hit;
    }, [jobs, jobQuery, pickedJob]);

    const lockedClosed = !!lockedJob && HIRE_JOB_CLOSED.includes(lockedJob.status);
    // งานที่ปิดแล้วขอให้ช่วยหาเพิ่มไม่ได้ (server ตีกลับ 409) — บอกตั้งแต่เปิดฟอร์ม ไม่ต้องรอกดส่งแล้วค่อยรู้
    const blockSend = casting && lockedClosed;
    const hc = clampHead(f.headcount);
    const today = todayTH();
    const quickDeadlines = [
        { label: 'พรุ่งนี้', v: addDays(today, 1) },
        { label: '3 วัน', v: addDays(today, 3) },
        { label: '1 สัปดาห์', v: addDays(today, 7) }
    ];
    const extraCount = [f.contact, f.agency, f.qty, f.link, f.note].filter(v => String(v).trim()).length + (file ? 1 : 0);
    const dirty = dirtyKey(f, jobName, file) !== cleanKey.current;

    function fieldErrors() {
        const e = {};
        if (!lockedJob) {
            if (jobMode === 'new') {
                if (!brand) e.brand = 'เลือกแบรนด์';
                if (!jobName.trim()) e.jobName = 'ใส่ชื่องาน';
            } else if (!pickedJob) {
                e.job = 'เลือกงานก่อน';
            }
        }
        if (!casting && !f.name.trim()) e.name = 'ใส่ชื่อคนก่อนนะ';
        if (!f.kind) e.kind = 'เลือกประเภทงาน';
        if (casting) {
            if (!(num(f.fee) > 0)) e.fee = 'ใส่งบต่อคน';
        } else if (needsFee(f.status, f.fee)) {
            e.fee = NEED_FEE_MSG;
        }
        return e;
    }
    const errs = fieldErrors();
    const E = tried ? errs : {};

    // เลื่อนไปช่องแรกที่ยังไม่ครบ — ฟอร์มยาวบนมือถือ ข้อความเตือนอาจอยู่นอกจอ
    useEffect(() => {
        if (!errTick || !wrapRef.current) return;
        const el = wrapRef.current.querySelector('.qf-field.has-err');
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const input = el.querySelector('input:not([type=file]), textarea, select, button');
        if (input) input.focus({ preventScroll: true });
    }, [errTick]);

    const scroller = () => (wrapRef.current ? wrapRef.current.closest('.side-drawer-body') : null);
    const toTop = () => { const s = scroller(); if (s) s.scrollTo({ top: 0, behavior: 'smooth' }); };

    function setFee(v) {
        const fee = digits(v);
        // ลบค่าตัวออกตอนเลือก "ตกลงแล้ว" ไว้ → ถอยกลับเป็นกำลังคุย พร้อมบอกเหตุผล (ตกลงแล้วต้องมีค่าตัวเสมอ)
        if (!casting && f.status === AGREED && feeMissing(fee)) {
            setF(s => ({ ...s, fee, status: TALKING }));
            setFeeNote(`ไม่มีค่าตัวแล้ว เลยเปลี่ยนกลับเป็น "${T.talking}" — ${NEED_FEE_MSG}`);
            return;
        }
        setF(s => ({ ...s, fee }));
        if (!feeMissing(fee)) setFeeNote('');
    }

    function pickFile(e) {
        const picked = e.target.files && e.target.files[0];
        e.target.value = '';   // เลือกไฟล์เดิมซ้ำได้ (เช่นหลังลบออก)
        if (!picked) return;
        if (!FILE_OK.test(picked.name)) { setFileErr('รองรับเฉพาะรูป (png, jpg, webp) หรือ PDF'); return; }
        if (picked.size > MAX_FILE) { setFileErr('ไฟล์ใหญ่เกิน 10MB — เลือกไฟล์ที่เล็กกว่านี้'); return; }
        setFileErr('');
        setFile(picked);
    }

    // body ตามสัญญาของ POST /projects/:id/hires — ส่งเฉพาะช่องของโหมดนั้น (server คัดช่องอีกชั้น)
    function rowBody() {
        if (casting) {
            return {
                mode: 'casting', kind: f.kind, headcount: hc, fee: num(f.fee),
                spec: trimOrNull(f.spec), deadline: f.deadline || null, use_date: f.use_date || null,
                place: trimOrNull(f.place), note: trimOrNull(f.note),
                assignee_id: f.assignee_id === '' ? null : Number(f.assignee_id)
            };
        }
        return {
            mode: 'direct', kind: f.kind, name: f.name.trim(),
            contact: trimOrNull(f.contact), agency: trimOrNull(f.agency), qty: trimOrNull(f.qty),
            fee: num(f.fee), use_date: f.use_date || null, use_time: trimOrNull(f.use_time),
            place: trimOrNull(f.place), link: trimOrNull(f.link), note: trimOrNull(f.note),
            status: f.status === AGREED && !feeMissing(f.fee) ? AGREED : TALKING
        };
    }

    async function save(more) {
        if (saving) return;
        setTried(true);
        if (Object.keys(fieldErrors()).length) { setErrTick(t => t + 1); return; }
        if (blockSend) return;
        setSaving(casting ? 'send' : (more ? 'more' : 'one'));
        setError(''); setSavedMsg(''); setUpFail(null);
        const row = rowBody();
        const who = casting ? '' : row.name;
        const pickedFile = casting ? null : file;
        let project, item, created = false;
        try {
            const target = lockedJob || (jobMode === 'existing' ? pickedJob : null);
            if (target) {
                const res = await api(`/projects/${target.id}/hires`, { method: 'POST', body: row });
                item = (res && res.data && res.data.item) || null;
                project = { id: target.id, name: target.name, brand: target.brand || null };
            } else {
                // งานใหม่ + แถวแรกในคำขอเดียว — ใบขอให้หาต้องตั้งสถานะเริ่มเอง และช่องของตัวคนเป็น null (รูปเดียวกับฟอร์มเต็ม)
                const first = casting
                    ? { ...row, status: 'กำลังหา', name: null, contact: null, agency: null, qty: null, link: null }
                    : row;
                const res = await api('/projects', {
                    method: 'POST',
                    body: {
                        campaign_type: 'other', name: jobName.trim(), brand,
                        creator: owner || null, owner: null, objective: null, status: 'Active',
                        hire_items: [first], budget: 0, kol_target: 0, products: [], ad_groups: [],
                        // ช่วงเวลาของงานคิดจากวันใช้งาน — ไม่มีวันเลยงานจะหลุดตัวกรองเดือนในหน้าแคมเปญ/งบ
                        start_date: f.use_date || null, end_date: f.use_date || null
                    }
                });
                const saved = (res && res.data) || {};
                const list = Array.isArray(saved.hire_items) ? saved.hire_items : [];
                item = list[list.length - 1] || null;
                project = { id: saved.id, name: saved.name || jobName.trim(), brand: saved.brand || brand || null };
                created = true;
            }
        } catch (err) {
            setError(err.message || 'บันทึกไม่สำเร็จ');
            setSaving('');
            toTop();
            return;
        }

        // แถวบันทึกแล้ว — ไฟล์อัปทีหลังด้วย key ที่ server ตอบกลับมา (อัปไม่สำเร็จก็ไม่ลบแถวทิ้ง)
        let upErr = '';
        const rowKey = (item && item.key) || null;
        if (pickedFile && rowKey) {
            try { await uploadFile(`/projects/${project.id}/hires/${rowKey}/image`, pickedFile); }
            catch (err) { upErr = err.message || 'อัปโหลดไม่สำเร็จ'; }
        } else if (pickedFile) {
            // ไม่รู้ key ของแถวที่เพิ่งบันทึก → ผูกไฟล์ไม่ได้ ต้องบอก ไม่ใช่ทิ้งไฟล์เงียบ ๆ
            upErr = 'ไม่พบรหัสแถวที่เพิ่งบันทึก — แนบไฟล์ใหม่ได้ที่หน้างาน';
        }
        window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
        const result = { mode: casting ? 'casting' : 'direct', project, item, created, more: !!more };
        setSaving('');

        if (casting) {
            onSaved && onSaved(result);
            setDone({
                pid: project.id, key: item && item.key, project,
                finder: (item && item.assignee_name) || null,
                deadline: (item && item.deadline) || row.deadline || null,
                kind: row.kind, headcount: row.headcount, fee: row.fee
            });
            toTop();
            return;
        }

        if (!more) {
            if (upErr) {
                // อัปไฟล์ไม่สำเร็จ: ถ้าปิดเลย (หน้าหลักจะพาไปหน้างาน) คนใช้จะไม่รู้ว่ารูปไม่ได้แนบ
                // → ค้างหน้า "บันทึกแล้ว" ให้ลองแนบใหม่ก่อน แล้วค่อยแจ้ง onSaved ตอนปิด
                setUpFail({ pid: project.id, key: rowKey, file: pickedFile, name: who, msg: upErr, pending: result });
                toTop();
                return;
            }
            onSaved && onSaved(result);
            onClose && onClose();
            return;
        }

        // บันทึกแล้วเพิ่มอีกคน — คนถัดไปมักเป็นกองเดียวกัน: เก็บประเภท/วัน/เวลา/สถานที่ ล้างเฉพาะช่องของตัวคน
        onSaved && onSaved(result);
        const next = {
            ...START,
            kind: f.kind, use_date: f.use_date, use_time: f.use_time, place: f.place
        };
        setF(next);
        setFile(null); setFileErr(''); setFeeNote('');
        setTried(false);
        if (created) setCreatedJob({ ...project, status: 'Active' });
        cleanKey.current = dirtyKey(next, jobName, null);
        setSavedMsg(`บันทึก ${who} แล้ว — เพิ่มคนถัดไปได้เลย`);
        if (upErr) setUpFail({ pid: project.id, key: rowKey, file: pickedFile, name: who, msg: upErr, pending: null });
        toTop();
        requestAnimationFrame(() => { if (nameRef.current) nameRef.current.focus({ preventScroll: true }); });
    }

    async function retryUpload() {
        if (!upFail || !upFail.key || retrying) return;
        const u = upFail;
        setRetrying(true);
        try {
            await uploadFile(`/projects/${u.pid}/hires/${u.key}/image`, u.file);
            setUpFail(null);
            setRetrying(false);
            if (u.pending) { onSaved && onSaved(u.pending); onClose && onClose(); return; }
            setSavedMsg(`แนบรูป/คอมการ์ดของ ${u.name} แล้ว`);
        } catch (err) {
            setUpFail({ ...u, msg: err.message || 'อัปโหลดไม่สำเร็จ' });
            setRetrying(false);
        }
    }

    // ทุกทางที่ปิด (ปุ่ม × / Esc / กดพื้นหลัง / ยกเลิก) มาที่นี่ที่เดียว
    function requestClose() {
        if (saving || retrying) return;
        if (upFail && upFail.pending) {
            const r = upFail.pending;
            onSaved && onSaved(r);
            onClose && onClose();
            return;
        }
        if (!done && dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดฟอร์มนี้เลยไหม?')) return;
        onClose && onClose();
    }

    async function copyLink() {
        if (!done || !done.key) return;
        const url = requestLink(window.location.origin, done.pid, done.key);
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            window.prompt('คัดลอกลิงก์ใบนี้ แล้วส่งใน LINE', url);
        }
    }

    const title = casting ? 'ขอให้ช่วยหาคน' : 'มีคนแล้ว บันทึกการจ้าง';
    const subtitle = casting
        ? `บอกว่าอยากได้คนแบบไหน แล้ว${T.finder}จะส่งรายชื่อเข้ามาในใบให้คุณเลือก`
        : `บันทึกคนที่คุยไว้เข้างาน — พอตกลงค่าตัวแล้วค่อยเปลี่ยนเป็น "${T.agreed}"`;
    const busy = !!saving || retrying;
    const secNo = n => (lockedJob ? n - 1 : n);

    // ===== หน้าจบ: ส่งใบขอให้หาแล้ว =====
    if (done) {
        return (
            <SideDrawer title={title} subtitle={done.project.name + (done.project.brand ? ' · ' + done.project.brand : '')}
                onClose={requestClose} width={640} className="qf-drawer qf-casting">
                <div className="qf" ref={wrapRef}>
                    <div className="qf-done">
                        <h3><span className="qf-done-tick">✓</span> ส่ง{T.request}แล้ว</h3>
                        <div className="qf-done-line">
                            {done.finder
                                ? <>รอ <b>{done.finder}</b> ส่งรายชื่อ{done.deadline ? <>ภายใน <b>{dmy(done.deadline)}</b></> : ''}</>
                                : `ยังไม่ได้เลือก${T.finder} — เลือกได้ในใบ`}
                        </div>
                        <div className="qf-done-sub">
                            {done.kind} {done.headcount} คน · งบ {baht(done.fee)}/คน
                        </div>
                        <div className="qf-done-actions">
                            {done.key && (
                                <button type="button" className="btn-primary" onClick={copyLink}>
                                    <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์ส่ง LINE'}
                                </button>
                            )}
                            {onOpenRequest && done.key && (
                                <button type="button" className="btn-ghost qf-btn-accent" onClick={() => {
                                    onOpenRequest({ project_id: done.pid, key: done.key });
                                    onClose && onClose();
                                }}>ดูใบ</button>
                            )}
                            <button type="button" className="btn-ghost" onClick={requestClose}>ปิด</button>
                        </div>
                    </div>
                </div>
            </SideDrawer>
        );
    }

    // ===== หน้า "บันทึกแล้ว แต่แนบไฟล์ไม่สำเร็จ" (บันทึกคนเดียวแล้วปิด) =====
    if (upFail && upFail.pending) {
        return (
            <SideDrawer title={title} onClose={requestClose} width={640} busy={retrying} className="qf-drawer">
                <div className="qf" ref={wrapRef}>
                    <div className="qf-done">
                        <h3><span className="qf-done-tick">✓</span> บันทึก {upFail.name} แล้ว</h3>
                        <div className="qf-warn">แนบรูป/คอมการ์ดไม่สำเร็จ: {upFail.msg}</div>
                        <div className="qf-done-sub">{upFail.key ? 'ลองแนบอีกครั้ง หรือปิดแล้วไปแนบทีหลังที่หน้างาน' : 'ปิดแล้วไปแนบทีหลังที่หน้างาน'}</div>
                        <div className="qf-done-actions">
                            {upFail.key && (
                                <button type="button" className="btn-primary" onClick={retryUpload} disabled={retrying}>
                                    <Icon name="upload" size={16} /> {retrying ? 'กำลังแนบ...' : 'ลองแนบอีกครั้ง'}
                                </button>
                            )}
                            <button type="button" className="btn-ghost" onClick={requestClose} disabled={retrying}>ปิด</button>
                        </div>
                    </div>
                </div>
            </SideDrawer>
        );
    }

    const footer = casting ? (
        <>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={() => save(false)} disabled={busy || blockSend}>
                {saving ? 'กำลังส่ง...' : `ส่ง${T.request}`}
            </button>
        </>
    ) : (
        <>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
            <button type="button" className="btn-ghost qf-btn-accent" onClick={() => save(true)} disabled={busy}>
                {saving === 'more' ? 'กำลังบันทึก...' : 'บันทึกแล้วเพิ่มอีกคน'}
            </button>
            <button type="button" className="btn-primary" onClick={() => save(false)} disabled={busy}>
                {saving === 'one' ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
        </>
    );

    const kindChips = (
        <div className="qf-chips" role="radiogroup" aria-labelledby={id('kind')}>
            {HIRE_KINDS.map(k => (
                <button type="button" key={k} role="radio" aria-checked={f.kind === k}
                    className={'qf-chip' + (f.kind === k ? ' on' : '')} onClick={() => up('kind', k)}>{k}</button>
            ))}
        </div>
    );

    return (
        <SideDrawer title={title} subtitle={subtitle} onClose={requestClose} footer={footer} width={640} busy={busy}
            className={'qf-drawer' + (casting ? ' qf-casting' : '')}>
            <div className="qf" ref={wrapRef}>
                {error && <div className="alert-error">{error}</div>}
                {savedMsg && <div className="qf-ok" role="status"><Icon name="check" size={16} /> {savedMsg}</div>}
                {upFail && !upFail.pending && (
                    <div className="qf-warn qf-upfail">
                        <div>แนบรูป/คอมการ์ดของ {upFail.name} ไม่สำเร็จ: {upFail.msg}</div>
                        {upFail.key && (
                            <button type="button" className="qf-link-btn" onClick={retryUpload} disabled={retrying}>
                                {retrying ? 'กำลังแนบ...' : 'ลองแนบอีกครั้ง'}
                            </button>
                        )}
                    </div>
                )}

                {/* ① งานไหน — เปิดจากหน้างาน (หรือเพิ่งสร้างงานไปแล้ว) ข้ามข้อนี้ โชว์ชื่องานเป็นบรรทัดตายตัว */}
                {lockedJob ? (
                    <div className={'qf-fixed' + (blockSend ? ' warn' : '')}>
                        <span className="qf-fixed-k">บันทึกเข้างาน</span>
                        <b>{lockedJob.name}</b>
                        {lockedJob.brand && <span className="qf-fixed-meta">· {lockedJob.brand}</span>}
                        {createdJob && !job && <span className="qf-fixed-meta">(งานที่เพิ่งสร้าง)</span>}
                        {blockSend && <div className="qf-warn">งานนี้จบแล้ว — ขอให้ช่วยหาเพิ่มไม่ได้ (เปลี่ยนสถานะงานเป็น "กำลังทำ" ก่อน)</div>}
                    </div>
                ) : (
                    <section className="qf-sec" aria-labelledby={id('s1')}>
                        <h3 className="qf-sec-head" id={id('s1')}><span className="qf-num">1</span> งานไหน</h3>
                        {/* ยังโหลดรายการงานไม่เสร็จแต่กดบันทึกแล้ว — ข้อความเตือนต้องขึ้นที่นี่ (รายการงานยังไม่ถูกวาด) */}
                        <Field err={jobMode === null ? E.job : undefined}
                            hint={jobMode === null ? 'กำลังโหลดงานที่กำลังทำ...' : ''}>
                            <div className="qf-seg" role="radiogroup" aria-label="งานไหน">
                                <button type="button" role="radio" aria-checked={jobMode === 'existing'}
                                    className={'qf-seg-opt' + (jobMode === 'existing' ? ' on' : '')} onClick={() => pickMode('existing')}>
                                    งานที่มีอยู่{Array.isArray(jobs) && jobs.length > 0 ? ` (${jobs.length})` : ''}
                                </button>
                                <button type="button" role="radio" aria-checked={jobMode === 'new'}
                                    className={'qf-seg-opt' + (jobMode === 'new' ? ' on' : '')} onClick={() => pickMode('new')}>
                                    งานใหม่
                                </button>
                            </div>
                        </Field>

                        {jobMode === 'existing' && (
                            <Field err={E.job} className="qf-field-jobs">
                                <div className="qf-search">
                                    <Icon name="search" size={16} />
                                    <input type="search" value={jobQuery} onChange={e => setJobQuery(e.target.value)}
                                        placeholder="ค้นหาชื่องาน หรือแบรนด์" aria-label="ค้นหางาน" />
                                </div>
                                <div className="qf-joblist" role="listbox" aria-label="งานที่กำลังทำ">
                                    {jobs === null && <div className="qf-empty">กำลังโหลด...</div>}
                                    {jobs !== null && filteredJobs.length === 0 && (
                                        <div className="qf-empty">
                                            {jobsErr
                                                ? `โหลดรายการงานไม่สำเร็จ: ${jobsErr}`
                                                : jobs.length === 0
                                                    ? 'ยังไม่มีงานที่กำลังทำ — เลือก "งานใหม่"'
                                                    : 'ไม่เจองานที่ค้นหา — ลองคำอื่น หรือเลือก "งานใหม่"'}
                                        </div>
                                    )}
                                    {filteredJobs.map(j => {
                                        const on = !!pickedJob && String(pickedJob.id) === String(j.id);
                                        const meta = [j.brand, jobRange(j)].filter(Boolean).join(' · ');
                                        return (
                                            <button type="button" key={j.id} role="option" aria-selected={on}
                                                className={'qf-job' + (on ? ' on' : '')} onClick={() => setPickedJob(j)}>
                                                <span className="qf-job-txt">
                                                    <span className="qf-job-name">{j.name}</span>
                                                    {meta && <span className="qf-job-meta">{meta}</span>}
                                                </span>
                                                {on && <Icon name="check" size={18} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </Field>
                        )}

                        {jobMode === 'new' && (
                            <div className="qf-newjob">
                                <Field label="แบรนด์" req err={E.brand} labelId={id('brand')}>
                                    {brandOpts.length ? (
                                        <div className="qf-chips" role="radiogroup" aria-labelledby={id('brand')}>
                                            {brandOpts.map(b => (
                                                <button type="button" key={b} role="radio" aria-checked={brand === b}
                                                    className={'qf-chip' + (brand === b ? ' on' : '')} onClick={() => setBrand(b)}>{b}</button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="qf-hint">ยังไม่ได้รับสิทธิ์แบรนด์ — ติดต่อผู้ดูแลระบบ</div>
                                    )}
                                </Field>
                                <Field label="ชื่องาน" req err={E.jobName} htmlFor={id('jobname')}>
                                    <input id={id('jobname')} value={jobName} onChange={e => setJobName(e.target.value)}
                                        placeholder="เช่น ถ่าย Lookbook คอลเลกชันใหม่" maxLength={255} />
                                </Field>
                                <Field label={T.owner} opt="ไม่บังคับ" htmlFor={id('owner')}
                                    hint="ระบบจำชื่อที่เลือกล่าสุดไว้ให้ครั้งหน้า">
                                    <select id={id('owner')} value={owner} onChange={e => chooseOwner(e.target.value)}>
                                        <option value="">— ยังไม่ระบุ —</option>
                                        {ownerNames.map(n => <option key={n} value={n}>{n}</option>)}
                                        {owner && !ownerNames.includes(owner) && <option value={owner}>{owner}</option>}
                                    </select>
                                </Field>
                            </div>
                        )}
                    </section>
                )}

                {/* ② ใคร / อยากได้คนแบบไหน */}
                <section className="qf-sec" aria-labelledby={id('s2')}>
                    <h3 className="qf-sec-head" id={id('s2')}>
                        <span className="qf-num">{secNo(2)}</span> {casting ? 'อยากได้คนแบบไหน' : 'ใคร'}
                    </h3>
                    {!casting ? (
                        <>
                            <Field label="ชื่อ" req err={E.name} htmlFor={id('name')}>
                                <input id={id('name')} ref={nameRef} value={f.name} onChange={e => up('name', e.target.value)}
                                    placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" maxLength={255} autoComplete="off" />
                            </Field>
                            <Field label="ประเภทงาน" req err={E.kind} labelId={id('kind')}>{kindChips}</Field>
                            <Field label="ค่าตัว (บาท)" err={E.fee} htmlFor={id('fee')} hint="ยังไม่รู้ก็เว้นไว้ได้ — ใส่ทีหลังได้">
                                <input id={id('fee')} inputMode="numeric" value={f.fee} onChange={e => setFee(e.target.value)}
                                    placeholder="เช่น 8000" autoComplete="off" />
                            </Field>
                            <Field label="คุยถึงไหนแล้ว" labelId={id('st')}>
                                <div className="qf-seg" role="radiogroup" aria-labelledby={id('st')}>
                                    <button type="button" role="radio" aria-checked={f.status === TALKING}
                                        className={'qf-seg-opt' + (f.status === TALKING ? ' on' : '')}
                                        onClick={() => { up('status', TALKING); setFeeNote(''); }}>
                                        {T.talking}<small>ยังไม่ได้ตกลงค่าตัวหรือวัน</small>
                                    </button>
                                    <button type="button" role="radio" aria-checked={f.status === AGREED}
                                        className={'qf-seg-opt' + (f.status === AGREED ? ' on' : '')}
                                        disabled={feeMissing(f.fee)} title={feeMissing(f.fee) ? NEED_FEE_MSG : undefined}
                                        onClick={() => { up('status', AGREED); setFeeNote(''); }}>
                                        {T.agreed}<small>ตกลงค่าตัวแล้ว นับเป็นเงินที่ต้องจ่าย</small>
                                    </button>
                                </div>
                                {feeNote
                                    ? <div className="qf-warn" role="status">{feeNote}</div>
                                    : feeMissing(f.fee) && <div className="qf-hint">{NEED_FEE_MSG}</div>}
                            </Field>
                        </>
                    ) : (
                        <>
                            <Field label="ประเภทงาน" req err={E.kind} labelId={id('kind')}>{kindChips}</Field>
                            <div className="qf-row2">
                                <Field label="จำนวนคน" labelId={id('hc')}>
                                    <div className="qf-step" role="group" aria-labelledby={id('hc')}>
                                        <button type="button" aria-label="ลดจำนวนคน" disabled={hc <= 1}
                                            onClick={() => up('headcount', String(clampHead(hc - 1)))}>−</button>
                                        <input inputMode="numeric" value={f.headcount} aria-label="จำนวนคน"
                                            onChange={e => up('headcount', digits(e.target.value).slice(0, 2))}
                                            onBlur={() => up('headcount', String(hc))} />
                                        <button type="button" aria-label="เพิ่มจำนวนคน" disabled={hc >= 99}
                                            onClick={() => up('headcount', String(clampHead(hc + 1)))}>+</button>
                                    </div>
                                </Field>
                                <Field label="งบต่อคน (บาท)" req err={E.fee} htmlFor={id('budget')}
                                    hint={num(f.fee) > 0
                                        ? <>รวม <b>{baht(num(f.fee) * hc)}</b>{hc > 1 ? ` (${baht(num(f.fee))} × ${hc} คน)` : ''}</>
                                        : 'กรอบเงินที่ให้ได้ต่อหนึ่งคน'}>
                                    <input id={id('budget')} inputMode="numeric" value={f.fee}
                                        onChange={e => setFee(e.target.value)} placeholder="เช่น 5000" autoComplete="off" />
                                </Field>
                            </div>
                            <Field label="สเปค" opt="ไม่บังคับ" htmlFor={id('spec')}>
                                <textarea id={id('spec')} rows="3" value={f.spec} onChange={e => up('spec', e.target.value)}
                                    placeholder="เช่น หญิง 20-25 ปี สูง 165 ขึ้นไป เคยถ่ายงานสกินแคร์" />
                            </Field>
                        </>
                    )}
                </section>

                {/* ③ เมื่อไหร่ ที่ไหน / ใช้เมื่อไหร่ ใครช่วยหา */}
                <section className="qf-sec" aria-labelledby={id('s3')}>
                    <h3 className="qf-sec-head" id={id('s3')}>
                        <span className="qf-num">{secNo(3)}</span>
                        {casting ? ' ใช้เมื่อไหร่ ใครช่วยหา' : <> เมื่อไหร่ ที่ไหน <span className="qf-sec-sub">(ข้ามได้)</span></>}
                    </h3>
                    {!casting ? (
                        <>
                            <div className="qf-row2">
                                <Field label="วันที่">
                                    <DatePicker value={f.use_date} onChange={v => up('use_date', v)} />
                                </Field>
                                <Field label="เวลา" htmlFor={id('time')}>
                                    <input id={id('time')} value={f.use_time} maxLength={60}
                                        onChange={e => up('use_time', e.target.value)} placeholder="เช่น 09:00-17:00" />
                                </Field>
                            </div>
                            <Field label="สถานที่" htmlFor={id('place')}>
                                <input id={id('place')} value={f.place} onChange={e => up('place', e.target.value)}
                                    placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                            </Field>

                            {/* ช่องเสริมพับไว้ — คนส่วนใหญ่กรอกแค่ชื่อ ประเภท ค่าตัว ก็พอ */}
                            <button type="button" className="qf-more-btn" aria-expanded={moreOpen} aria-controls={id('more')}
                                onClick={() => setMoreOpen(o => !o)}>
                                ข้อมูลเพิ่มเติม {moreOpen ? '▾' : '▸'}
                                {!moreOpen && extraCount > 0 && <span className="qf-more-count">กรอกแล้ว {extraCount} ช่อง</span>}
                            </button>
                            {moreOpen && (
                                <div className="qf-more" id={id('more')}>
                                    <div className="qf-row2">
                                        <Field label={T.contact} htmlFor={id('contact')}>
                                            <input id={id('contact')} value={f.contact} onChange={e => up('contact', e.target.value)}
                                                placeholder="เบอร์ / LINE / IG" />
                                        </Field>
                                        <Field label="สังกัด/เอเจนซี่" htmlFor={id('agency')}>
                                            <input id={id('agency')} value={f.agency} onChange={e => up('agency', e.target.value)}
                                                placeholder="ไม่มีก็เว้นไว้" />
                                        </Field>
                                    </div>
                                    <Field label="ระยะเวลาทำงาน" htmlFor={id('qty')}>
                                        <input id={id('qty')} value={f.qty} onChange={e => up('qty', e.target.value)}
                                            placeholder="เช่น 2 วัน หรือ 3 รอบไลฟ์" />
                                    </Field>
                                    <Field label="ลิงก์ Account/Social" htmlFor={id('link')}>
                                        <input id={id('link')} type="url" value={f.link} onChange={e => up('link', e.target.value)}
                                            placeholder="IG / TikTok / Facebook (https://...)" />
                                    </Field>
                                    <Field label="รูป/คอมการ์ด" err={fileErr} hint="รูป หรือ PDF ไม่เกิน 10MB — แนบให้หลังบันทึก">
                                        <div className="qf-file">
                                            <label className={'qf-file-btn' + (file ? ' has' : '')} tabIndex={0} role="button"
                                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const inp = e.currentTarget.querySelector('input[type=file]'); if (inp) inp.click(); } }}>
                                                <Icon name="upload" size={15} />
                                                <span>{file ? file.name : 'เลือกรูป หรือ PDF คอมการ์ด'}</span>
                                                <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={pickFile} />
                                            </label>
                                            {file && (
                                                <button type="button" className="pbrief-file-clear" title="เอาไฟล์นี้ออก" aria-label="เอาไฟล์นี้ออก"
                                                    onClick={() => setFile(null)}>×</button>
                                            )}
                                        </div>
                                    </Field>
                                    <Field label={T.note} htmlFor={id('note')}>
                                        <input id={id('note')} value={f.note} onChange={e => up('note', e.target.value)}
                                            placeholder="เงื่อนไข ข้อตกลง หรือสิ่งที่ต้องจำ" />
                                    </Field>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="qf-row2">
                                <Field label="ใช้งานวันที่">
                                    <DatePicker value={f.use_date} onChange={v => up('use_date', v)} />
                                </Field>
                                <Field label="ส่งรายชื่อภายใน"
                                    hint={f.deadline && f.use_date && f.deadline > f.use_date ? 'กำหนดส่งรายชื่อเลยวันใช้งานไปแล้ว — ตรวจวันอีกที' : ''}>
                                    <DatePicker value={f.deadline} onChange={v => up('deadline', v)} />
                                    <div className="qf-chips qf-chips-sm">
                                        {quickDeadlines.map(q => (
                                            <button type="button" key={q.label} aria-pressed={f.deadline === q.v}
                                                className={'qf-chip sm' + (f.deadline === q.v ? ' on' : '')}
                                                onClick={() => up('deadline', q.v)}>{q.label}</button>
                                        ))}
                                    </div>
                                </Field>
                            </div>
                            <Field label="ให้ใครช่วยหา" htmlFor={id('finder')}
                                hint={`${T.finder}จะเห็นใบนี้ในหน้า Talent ของเขา แล้วส่งรายชื่อเข้ามาในใบ`}>
                                <select id={id('finder')} value={f.assignee_id} onChange={e => up('assignee_id', e.target.value)}>
                                    <option value="">ไว้เลือกทีหลัง</option>
                                    {people.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                                </select>
                            </Field>
                            <Field label="สถานที่" htmlFor={id('cplace')}>
                                <input id={id('cplace')} value={f.place} onChange={e => up('place', e.target.value)}
                                    placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                            </Field>
                            <Field label={T.note} htmlFor={id('cnote')}>
                                <input id={id('cnote')} value={f.note} onChange={e => up('note', e.target.value)}
                                    placeholder={`เงื่อนไข หรือสิ่งที่${T.finder}ควรรู้`} />
                            </Field>
                        </>
                    )}
                </section>
            </div>
        </SideDrawer>
    );
}
