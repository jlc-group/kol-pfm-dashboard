import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import OtherProjectForm, {
    HIRE_JOB_CLOSED, isCasting, hireLeft, hireStage, hireWaiting, hireNeedMore, bookingOpen, bookingState, hireBookings
} from '../components/OtherProjectForm.jsx';
import QuickHireForm from '../components/QuickHireForm.jsx';
import RequestDrawer from './hires/RequestDrawer.jsx';
import PersonDrawer, { PersonThumb } from './hires/PersonDrawer.jsx';
import JobInfoDrawer from './hires/JobInfoDrawer.jsx';
import { waitingSentence, fmtD } from './hires/requestText.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtRange } from '../utils/date.js';
import { setNavSection } from '../utils/navSection.js';
import {
    T, baht, STAGE_LABEL, BOOKING_LABEL, jobStatusLabel, PAYABLE_STATUS, feeMissing, todayTH, daysLate
} from '../data/talentLabels.js';
import {
    jobProgress, todoText, PERSON_STEPS, PERSON_STEP_LABEL, personStep, personNext, personGroup, PERSON_GROUPS
} from '../data/hireProgress.js';

// หน้างานของ Talent (campaign_type = 'other') — ProjectDetail เรียกหน้านี้แทนเมื่อเป็นประเภท other
// งานแบบนี้ไม่มี Platform / คลิป / ค่าแอด / เอเจนซี่ — สิ่งที่ต้องดูคือ "ใคร ทำอะไร วันไหน เท่าไร ถึงขั้นไหนแล้ว"
// รอบ 2: เลิกตารางที่แก้ในหน้าแล้วต้องกดแถบ "บันทึกการแก้ไข" (ลืมกดแล้วงานหาย / ชน 409 กับคนช่วยหา)
//   • เปลี่ยนขั้นของคนด้วยปุ่ม "ถัดไป" คลิกเดียว บันทึกทันที มีแถบเลิกทำ 5 วินาที
//   • แก้คนทีละคนในลิ้นชัก (PersonDrawer) ผ่านเส้นแก้แถวเดียว PATCH .../hires/:key/person
//   • ใบขอให้หาของงานนี้เป็นบรรทัดสรุป กดแล้วเปิดลิ้นชักใบ (ตัวเดียวกับหน้า Talent) บนหน้านี้
// ตัวเลขคน/เงิน/เรื่องที่ต้องทำ คิดด้วย jobProgress ชุดเดียวกับการ์ดงาน (server คิดแบบเดียวกัน มีเทสต์เทียบ)

// #req-<key> มาจาก URL ที่คนพิมพ์/วางเองได้ — % ที่ไม่ครบชุดทำให้ decodeURIComponent โยน error แล้วหน้าพังทั้งหน้า
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
// แถวเก่าที่บันทึกก่อนมี key ต้องมีรหัสให้ React เสมอ — แต่เส้นแก้แถวเดียวหาแถวนั้นไม่เจอ จึงติดป้าย _nokey ไว้ (แก้ได้ในฟอร์มเต็ม)
const rowsOf = list => (Array.isArray(list) ? list : []).filter(Boolean)
    .map((it, i) => (it.key ? it : { ...it, key: 'h' + i, _nokey: true }));
// ?show= ที่การ์ดงานส่งมา (ยังไม่ตกลง / ตกลงแล้ว / เสร็จแล้ว)
const SHOW_KEYS = ['pending', 'agreed', 'done'];
// เรื่องที่ต้องทำแบบ "ดูคน" → ชิปกรองที่ตรงกัน
const GROUP_OF_TODO = { talking: 'pending', past: 'agreed', deliver: 'done' };
// ใบที่ต้องมีคนทำก่อนขึ้นก่อน ใบที่ครบ/ปิดแล้วไปท้าย
const STAGE_ORDER = ['fee', 'deciding', 'unassigned', 'booking', 'finding', 'full', 'closed'];
// เวลา a ใหม่กว่า b ไหม (ISO) — อ่านไม่ออกถือว่าไม่ใหม่กว่า
const newerThan = (a, b) => { const x = Date.parse(a); const y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && x > y; };
const tasksChanged = () => window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));

// ปุ่มที่กางเมนู (ปิดงาน ▾ / ⋯) — กดนอกเมนูหรือ Esc แล้วปิด · มือถือกางเป็นแผ่นล่างจอ (CSS)
function HeroMenu({ label, ariaLabel, title, className = 'tc-hero-ghost', disabled = false, items }) {
    const [open, setOpen] = useState(false);
    const [alignLeft, setAlignLeft] = useState(false);
    const wrap = useRef(null);
    const btn = useRef(null);
    const menu = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
        const onKey = e => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            if (btn.current) btn.current.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        // โฟกัสรายการแรก — ใช้คีย์บอร์ดเลือกต่อได้ทันที
        const first = menu.current && menu.current.querySelector('button:not(:disabled)');
        if (first) first.focus({ preventScroll: true });
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    function toggle() {
        if (!open && wrap.current) {
            // เมนูกว้าง ~280px: ปุ่มที่อยู่ชิดซ้ายของจอ (หัวงานบนแท็บเล็ต ปุ่มลงบรรทัดใหม่) ให้กางไปทางขวา ไม่ตกขอบจอ
            const r = wrap.current.getBoundingClientRect();
            setAlignLeft(r.right < 300);
        }
        setOpen(o => !o);
    }

    return (
        <div className="tj-menu-wrap" ref={wrap}>
            <button ref={btn} type="button" className={className} aria-haspopup="menu" aria-expanded={open}
                aria-label={ariaLabel} title={title} disabled={disabled} onClick={toggle}>
                {label}
            </button>
            {open && (
                <>
                    <div className="tj-menu-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
                    <div className={'tj-menu' + (alignLeft ? ' left' : '')} role="menu" ref={menu}>
                        {items.filter(Boolean).map(it => (
                            <button key={it.key} type="button" role="menuitem" className={it.danger ? 'danger' : ''}
                                disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
                                <strong>{it.label}</strong>
                                {it.sub && <span>{it.sub}</span>}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default function OtherProjectDetail({ project, reload, onDeleted }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const isAdmin = !!user && user.role === 'admin';
    // หน้านี้เป็นของเมนู Talent แม้ URL จะเป็น /projects/:id — ให้เมนูด้านข้างไฮไลต์ถูกอัน
    useEffect(() => { setNavSection('hires'); return () => setNavSection(null); }, []);

    // ผลล่าสุดจากเส้นแก้ทีละแถว (PATCH / DELETE / แนบรูป คืน hire_items ทั้งชุด) — โชว์ทันทีระหว่างรอ reload()
    // ผูกกับ project ก้อนที่เห็นตอนกด: หน้าแม่โหลดก้อนใหม่มาเมื่อไร ใช้ของใหม่แทน
    // ยกเว้นก้อนที่มาถึงช้า (คำขอโหลดที่ยิงไว้ก่อนบันทึก) ซึ่ง updated_at เก่ากว่าผลที่เพิ่งบันทึก — ไม่งั้นปุ่มที่เพิ่งกดจะเด้งกลับชั่วครู่
    const [fresh, setFresh] = useState(null);
    const freshOn = !!fresh && (fresh.from === project
        || (!!fresh.at && Date.now() - fresh.t < 15000 && newerThan(fresh.at, project.updated_at)));
    const items = useMemo(() => rowsOf(freshOn ? fresh.items : project.hire_items), [freshOn, fresh, project]);
    const applyItems = (list, at = null) => {
        if (Array.isArray(list)) setFresh({ from: project, items: list, at: at || null, t: Date.now() });
    };
    // หลังแก้อะไรสำเร็จ: โหลดงานใหม่ + บอกทุกที่ที่นับใบขอให้หา (เลขแดงบนเมนู / รายการใบของหน้านี้)
    const afterChange = () => { reload(); tasksChanged(); };

    const today = todayTH();
    const closed = HIRE_JOB_CLOSED.includes(project.status);
    const progress = useMemo(() => jobProgress(items, project.status, today), [items, project.status, today]);
    const P = progress.people;
    const M = progress.money;
    const direct = items.filter(it => !isCasting(it));
    const requests = items.filter(isCasting);
    const liveReq = new Set(requests.map(r => String(r.key)));
    // ล็อกขั้นเฉพาะคนที่ยังรอยืนยันคิว และใบต้นทางยังอยู่ (กติกาเดียวกับ server) — ใบหายไปแล้วเปลี่ยนขั้นเองได้
    const lockedRow = it => bookingOpen(it) && it.from_request != null && liveReq.has(String(it.from_request));
    const nextOf = it => (bookingOpen(it) && !lockedRow(it) ? personNext({ ...it, booking: null }) : personNext(it));
    // ขั้นถัดไปที่ต้องมีค่าตัวแต่ยังไม่มี (รวมแถวเก่าที่ตกลงแล้วแต่ค่าตัว 0 จะไปถ่ายเสร็จ) → ต้องใส่ค่าตัวในลิ้นชักก่อน
    const needFeeFor = (it, nx) => !!nx && !nx.locked && (nx.needFee || (PAYABLE_STATUS.includes(nx.status) && feeMissing(it.fee)));

    // ===== ข้อความ / แถบเลิกทำ =====
    const [notice, setNotice] = useState(null);          // { type: 'ok' | 'error', text }
    const [undo, setUndo] = useState(null);              // { id, key, name, from, to }
    const [undoBusy, setUndoBusy] = useState(null);      // id ของแถบที่กำลังเลิกทำ (แถบใหม่ของอีกคนต้องกดได้ตามปกติ)
    useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(null), notice.type === 'error' ? 9000 : 5000);
        return () => clearTimeout(t);
    }, [notice]);
    useEffect(() => {
        if (!undo || undoBusy === undo.id) return undefined;
        const t = setTimeout(() => setUndo(u => (u && u.id === undo.id ? null : u)), 5000);
        return () => clearTimeout(t);
    }, [undo, undoBusy]);

    // ===== ใบขอให้หาของงานนี้ (แถวของ GET /hires/tasks — รูปเดียวกับที่ลิ้นชักใบใช้ทุกที่) =====
    const pid = project.id;
    const [tasks, setTasks] = useState(null);            // null = ยังไม่เคยโหลด
    const [tasksTick, setTasksTick] = useState(0);       // นับครั้งที่โหลดเสร็จ (สำเร็จหรือพลาด)
    const [tasksErr, setTasksErr] = useState('');
    const tasksSeq = useRef(0);
    const loadTasks = useCallback(() => {
        const seq = ++tasksSeq.current;
        api(`/hires/tasks?project=${encodeURIComponent(pid)}`)
            .then(res => {
                if (seq !== tasksSeq.current) return;       // มีคำขอใหม่กว่าแล้ว — ทิ้งผลเก่า
                // กรองซ้ำฝั่งนี้ด้วย: server รุ่นก่อนหน้าไม่รู้จัก ?project= จะส่งใบของทุกงานมา
                const rows = (res && res.data && Array.isArray(res.data.rows) ? res.data.rows : [])
                    .filter(r => r && String(r.project_id) === String(pid));
                setTasks(rows);
                setTasksErr('');
                setTasksTick(t => t + 1);
            })
            .catch(err => {
                if (seq !== tasksSeq.current) return;
                setTasksErr(err.message || `โหลด${T.request}ไม่สำเร็จ`);
                setTasks(t => t || []);
                setTasksTick(t => t + 1);
            });
    }, [pid]);
    useEffect(() => {
        loadTasks();
        window.addEventListener('kol:hire-tasks-changed', loadTasks);
        return () => { tasksSeq.current += 1; window.removeEventListener('kol:hire-tasks-changed', loadTasks); };
    }, [loadTasks]);

    // ลิ้นชักใบเปิดตาม #req-<key> ใน URL ที่เดียว (ลิงก์จากหน้า Talent / ลิงก์ที่คัดลอกไว้ / กดในหน้านี้)
    // ปิดลิ้นชัก = เอา hash ออก (replace — ไม่เพิ่มประวัติ ปุ่มย้อนกลับของเบราว์เซอร์ยังพากลับหน้าที่มา)
    const hashMatch = /^#req-(.+)$/.exec(location.hash || '');
    const openReq = hashMatch ? safeDecode(hashMatch[1]) : null;
    const setHash = hash => navigate({ pathname: location.pathname, search: location.search, hash }, { replace: true });
    const openRequest = key => { if (key != null && key !== '') setHash('#req-' + encodeURIComponent(String(key))); };
    const closeRequest = () => { if (/^#req-/.test(location.hash || '')) setHash(''); };
    const reqRow = openReq && Array.isArray(tasks) ? (tasks.find(r => String(r.key) === openReq) || null) : null;
    // ใบที่เพิ่งสร้าง (กด "ดูใบ" จากฟอร์มสั้น) อาจยังไม่อยู่ในรายการที่โหลดไว้ → โหลดใหม่หนึ่งรอบ แล้วเปิดเมื่อเจอ
    // โหลดใหม่แล้วก็ยังไม่เจอ = ใบถูกลบไปแล้ว / ลิงก์ผิด → บอกแล้วเอา hash ออก
    const retry = useRef({ key: null, tick: 0 });
    useEffect(() => {
        if (!openReq) { retry.current = { key: null, tick: 0 }; return; }
        if (reqRow || tasksTick === 0) return;
        if (retry.current.key !== openReq) {
            retry.current = { key: openReq, tick: tasksTick };
            loadTasks();
            return;
        }
        if (tasksTick > retry.current.tick) {
            setNotice({ type: 'error', text: tasksErr ? `เปิด${T.request}ไม่ได้: ${tasksErr}` : `ไม่พบ${T.request}นี้ในงานนี้ — อาจถูกลบไปแล้ว` });
            closeRequest();
        }
    }, [openReq, reqRow, tasksTick]);   // eslint-disable-line react-hooks/exhaustive-deps

    // ===== คนในงานนี้: ตัวกรอง / มุมมอง =====
    const showParam = new URLSearchParams(location.search).get('show');
    const [group, setGroup] = useState(() => (SHOW_KEYS.includes(showParam) ? showParam : ''));
    const [view, setView] = useState('person');          // person = ตามคน · day = ตามวัน (อ่านอย่างเดียว)
    const peopleRef = useRef(null);
    const goPeople = g => {
        setGroup(g);
        setView('person');
        requestAnimationFrame(() => { if (peopleRef.current) peopleRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    };
    // มาจากการ์ดงาน (?show=pending|agreed|done) → เลือกชิปนั้นแล้วเลื่อนลงไปที่รายชื่อ
    useEffect(() => {
        if (SHOW_KEYS.includes(showParam)) goPeople(showParam);
    }, [showParam]);   // eslint-disable-line react-hooks/exhaustive-deps

    const groupCount = k => (k ? direct.filter(it => personGroup(it) === k).length : direct.length);
    const shownPeople = group ? direct.filter(it => personGroup(it) === group) : direct;

    // ===== ลิ้นชักแก้คน =====
    const [person, setPerson] = useState(null);           // { key, focusFee, agreeOnFee }
    const personRow = person ? (direct.find(it => String(it.key) === person.key) || null) : null;
    useEffect(() => {
        // คนที่เปิดอยู่หายไปจากงาน (มีคนเอาออก / ถูกลบจากที่อื่น) → ปิดลิ้นชักพร้อมบอก
        if (person && !personRow) {
            setPerson(null);
            setNotice({ type: 'error', text: 'ไม่พบคนนี้ในงานแล้ว — อาจถูกเอาออกไปแล้ว' });
        }
    }, [person, personRow]);
    const openPerson = (key, fee = null) => setPerson({
        key: String(key), focusFee: !!fee, agreeOnFee: fee && fee.agree ? fee.agree : null
    });

    // ===== สถานะรายแถว (ปุ่มถัดไป) =====
    const [busyKeys, setBusyKeys] = useState({});
    const setRowBusy = (key, on) => setBusyKeys(b => {
        const next = { ...b };
        if (on) next[key] = true; else delete next[key];
        return next;
    });
    const patchPerson = (key, set, expect) => api(`/projects/${project.id}/hires/${encodeURIComponent(key)}/person`, {
        method: 'PATCH', body: { set, expect }
    });
    function failed(e) {
        if (e && e.status === 409) {
            // ข้อมูลเพิ่งเปลี่ยน (มีคนแก้ก่อน / เพิ่งมีการเลือกจากใบ) — โหลดค่าล่าสุดให้เลย
            reload();
            tasksChanged();
            const stale = /เพิ่งเปลี่ยน/.test(e.message || '');
            setNotice({ type: 'error', text: stale ? 'ข้อมูลเพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว' : `${e.message} (โหลดค่าล่าสุดให้แล้ว)` });
        } else if (e && e.status === 404) {
            reload();
            setNotice({ type: 'error', text: e.message || 'ไม่พบรายการนี้' });
        } else {
            setNotice({ type: 'error', text: (e && e.message) || 'บันทึกไม่สำเร็จ' });
        }
    }

    async function stepPerson(it, nx) {
        const key = String(it.key);
        if (busyKeys[key] || it._nokey || !nx || nx.locked) return;
        setRowBusy(key, true);
        const from = personStep(it);
        try {
            // expect = สถานะที่หน้านี้เห็น (ค่าในฐานตรง ๆ) — มีคนเปลี่ยนไปก่อนแล้ว server ตอบ 409
            const res = await patchPerson(key, { status: nx.status }, { status: it.status === undefined ? null : it.status });
            applyItems(res && res.data && res.data.items, res && res.data && res.data.updated_at);
            afterChange();
            setNotice(null);
            setUndo({ id: Date.now(), key, name: String(it.name || '').trim() || 'คนนี้', from, to: nx.status });
        } catch (e) {
            failed(e);
        } finally {
            setRowBusy(key, false);
        }
    }

    // เลิกทำ = ย้อนสถานะด้วยเส้นเดิม (expect เป็นขั้นที่เพิ่งตั้ง — ถ้ามีคนเปลี่ยนต่อไปแล้วจะไม่ย้อนทับ)
    async function undoStep() {
        const u = undo;
        if (!u || undoBusy === u.id) return;
        setUndoBusy(u.id);
        try {
            const res = await patchPerson(u.key, { status: u.from }, { status: u.to });
            applyItems(res && res.data && res.data.items, res && res.data && res.data.updated_at);
            afterChange();
            setUndo(cur => (cur && cur.id === u.id ? null : cur));
            setNotice({ type: 'ok', text: `เลิกทำแล้ว — ${u.name} กลับเป็น "${PERSON_STEP_LABEL[u.from] || T.talking}"` });
        } catch (e) {
            setUndo(cur => (cur && cur.id === u.id ? null : cur));
            failed(e);
        } finally {
            setUndoBusy(cur => (cur === u.id ? null : cur));
        }
    }

    // ===== สถานะงาน =====
    const [jobBusy, setJobBusy] = useState(false);
    // คนที่เลือกแล้วค้างยืนยันคิว / ค่าตัวใหม่ (เฉพาะที่ใบต้นทางยังอยู่) — ปิดงานแล้วคนช่วยหาแตะไม่ได้ ต้องเตือนก่อน
    const bookingPeople = direct.filter(it => lockedRow(it) && bookingState(it) === 'pending').length;
    const feePeople = direct.filter(it => lockedRow(it) && bookingState(it) === 'fee_review').length;
    async function changeStatus(status) {
        if (jobBusy) return;
        if (HIRE_JOB_CLOSED.includes(status) && (bookingPeople + feePeople) > 0
            && !window.confirm(`ยังมี ${bookingPeople + feePeople} คนที่เลือกแล้ว${BOOKING_LABEL.pending}/${BOOKING_LABEL.fee_review} — ปิดงานแล้ว${T.finder}จะแตะไม่ได้ ทีมแบรนด์ต้องจัดการเองในใบ ต้องการปิดงานไหม?`)) return;
        setJobBusy(true);
        try {
            await api(`/projects/${project.id}`, { method: 'PUT', body: { status } });
            afterChange();
            setNotice({ type: 'ok', text: status === 'Active' ? 'เปิดงานอีกครั้งแล้ว' : `ปิดงานแล้ว — ${jobStatusLabel(status)}` });
        } catch (e) {
            setNotice({ type: 'error', text: e.message || 'เปลี่ยนสถานะงานไม่สำเร็จ' });
        } finally {
            setJobBusy(false);
        }
    }

    // ===== ลบงาน (ต้องพิมพ์ชื่องานให้ตรงก่อน) =====
    const [showDel, setShowDel] = useState(false);
    const [delName, setDelName] = useState('');
    const [delErr, setDelErr] = useState('');
    const [deleting, setDeleting] = useState(false);
    const normName = s => String(s || '').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const jobName = normName(project.name);
    const delOk = jobName !== '' && normName(delName) === jobName;
    const openDelete = () => { setDelName(''); setDelErr(''); setShowDel(true); };
    useEffect(() => {
        if (!showDel) return undefined;
        const onKey = e => { if (e.key === 'Escape' && !deleting) setShowDel(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showDel, deleting]);
    async function deleteProject() {
        if (!delOk || deleting) return;
        setDeleting(true);
        setDelErr('');
        try {
            await api(`/projects/${project.id}`, { method: 'DELETE' });
            tasksChanged();
            onDeleted();
        } catch (e) {
            setDelErr(e.message || 'ลบไม่สำเร็จ');
            setDeleting(false);
        }
    }

    // ===== ฟอร์ม / ลิ้นชักอื่น =====
    const [quick, setQuick] = useState('');               // 'direct' = เพิ่มคนที่มีแล้ว · 'casting' = ขอให้ช่วยหา
    const [showEdit, setShowEdit] = useState(false);      // ฟอร์มเต็ม (แก้หลายคนพร้อมกัน)
    const [showInfo, setShowInfo] = useState(false);      // แก้ข้อมูลงาน

    // ปุ่มย้อนกลับ: มาจากในแอป (หน้าหลัก Talent / ลิ้นชักใบ / รายการงาน) → กลับหน้าเดิมพร้อมแท็บและตัวกรองเดิม
    // เปิดตรงจากลิงก์ (ไม่มีประวัติในแอป) → ไปหน้า Talent แทน ไม่ให้เด้งออกนอกเว็บ
    function goBack() {
        if (window.history.state && window.history.state.idx > 0) navigate(-1);
        else navigate('/hires');
    }

    const useDates = items.map(it => it.use_date).filter(Boolean).map(String).sort();
    const rangeText = useDates.length
        ? fmtRange(useDates[0], useDates[useDates.length - 1], ' → ')
        : (project.start_date || project.end_date ? fmtRange(project.start_date, project.end_date, ' → ') : 'ยังไม่ระบุวัน');
    const owner = project.creator || project.owner || '';

    // ===== ใบขอให้หา: บรรทัดสรุปคิดจากรายการจ้างของหน้านี้ (ตัวเลขตรงกับแถบเงินและกล่องต้องทำ) =====
    const reqLines = requests.map(it => {
        const stage = hireStage(it, project.status, items);
        const bk = hireBookings(items, it.key);
        const needMore = hireNeedMore(it);
        const cands = Array.isArray(it.candidates) ? it.candidates : [];
        const line = {
            key: String(it.key), kind: it.kind || '', stage, headcount: Number(it.headcount) || 1, fee: Number(it.fee) || 0,
            remaining: hireLeft(it), waiting_count: hireWaiting(it), need_more: needMore,
            booking_pending: bk.filter(b => bookingState(b) === 'pending').length,
            fee_review: bk.filter(b => bookingState(b) === 'fee_review').length,
            assignee_id: it.assignee_id == null ? null : it.assignee_id, assignee_name: it.assignee_name || null,
            deadline: it.deadline || null, candidates: cands.length
        };
        line.late = stage !== 'closed' && needMore > 0 && it.deadline ? daysLate(it.deadline) : 0;
        return line;
    }).sort((a, b) => (b.late > 0 ? 1 : 0) - (a.late > 0 ? 1 : 0) || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

    // ===== ตามวัน: คนที่ยังไม่ระบุวันไปท้ายสุด · ชิป "ทุกคน" รวมใบที่ยังต้องหาคนด้วย (เห็นว่าวันไหนยังขาดคน) =====
    const dayRows = [...shownPeople, ...(group || closed ? [] : requests.filter(r => hireLeft(r) > 0))];
    const byDay = [];
    dayRows.forEach(it => {
        const d = it.use_date ? String(it.use_date).slice(0, 10) : '';
        let g = byDay.find(x => x.date === d);
        if (!g) { g = { date: d, rows: [] }; byDay.push(g); }
        g.rows.push(it);
    });
    byDay.sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date).localeCompare(String(b.date)));

    const personLabel = it => (lockedRow(it) ? BOOKING_LABEL[bookingState(it)] : PERSON_STEP_LABEL[personStep(it)]);

    function doTodo(item, tt) {
        // ใบแรกที่ยังอยู่จริง (คนที่ค้างยืนยันคิวอาจชี้ใบที่ถูกลบไปแล้ว)
        const keys = Array.isArray(item.keys) ? item.keys : [];
        if (tt.target === 'request') openRequest(keys.find(k => liveReq.has(String(k))) || keys[0]);
        else if (tt.target === 'people') goPeople(GROUP_OF_TODO[item.code] || '');
    }

    const empty = items.length === 0;

    return (
        <div className="tj-page">
            <div className="pd-hero tc-hero">
                <button className="pd-back" onClick={goBack} title="กลับหน้าที่มา" aria-label="กลับหน้าที่มา">
                    <Icon name="back" size={18} />
                </button>
                <div className="pd-hero-main">
                    <div className="pd-hero-top">
                        <span className={`status status-${project.status || 'Draft'}`}>{jobStatusLabel(project.status)}</span>
                        <span className="ctype-chip" title="งาน Talent — ไม่เข้าหน้าโฆษณาและรายงานแคมเปญ">Talent</span>
                        {project.brand && <span className="pd-chip">{project.brand}</span>}
                    </div>
                    <h1 className="pd-title">{project.name}</h1>
                    <div className="pd-hero-by tj-hero-by">
                        {T.owner}: {owner || 'ยังไม่ระบุ'} · วันใช้งาน {rangeText}
                    </div>
                </div>
                <div className="pd-hero-actions">
                    <button type="button" className="pd-edit-btn" onClick={() => setQuick('direct')}
                        title="บันทึกคนที่ดีลไว้แล้วเข้างานนี้ ทีละคน">
                        <Icon name="plus" size={15} /> เพิ่มคนที่มีแล้ว
                    </button>
                    {/* งานปิดแล้วขอให้ช่วยหาเพิ่มไม่ได้ (server ตีกลับ 409) — ปิดปุ่มไว้พร้อมบอกเหตุผล */}
                    <button type="button" className="pd-edit-btn" onClick={() => setQuick('casting')} disabled={closed}
                        title={closed ? 'งานนี้ปิดแล้ว — ขอให้ช่วยหาเพิ่มไม่ได้ (เปิดงานอีกครั้งก่อน)' : `เปิด${T.request} ให้${T.finder}ส่งรายชื่อมาให้เลือก`}>
                        <Icon name="plus" size={15} /> ขอให้ช่วยหา
                    </button>
                    {closed ? (
                        <button type="button" className="tc-hero-ghost" onClick={() => changeStatus('Active')} disabled={jobBusy}
                            title="ย้ายงานกลับไปเป็น กำลังทำ">
                            {jobBusy ? 'กำลังเปิด...' : 'เปิดงานอีกครั้ง'}
                        </button>
                    ) : (
                        <HeroMenu label={jobBusy ? 'กำลังบันทึก...' : 'ปิดงาน ▾'} disabled={jobBusy} title="จบงาน หรือยกเลิกงาน"
                            items={[
                                { key: 'done', label: 'จบงาน', sub: 'ทำครบแล้ว — งานย้ายไปอยู่ใน "จบแล้ว"', onClick: () => changeStatus('Completed') },
                                { key: 'cancel', label: 'ยกเลิกงาน', sub: 'งานนี้ไม่ทำแล้ว', danger: true, onClick: () => changeStatus('Cancelled') }
                            ]} />
                    )}
                    <HeroMenu label="⋯" ariaLabel="เมนูเพิ่มเติมของงาน" title="แก้ข้อมูลงาน / แก้หลายคนพร้อมกัน / ลบงาน"
                        className="tc-hero-ghost tj-more"
                        items={[
                            { key: 'info', label: 'แก้ข้อมูลงาน', sub: `ชื่องาน รายละเอียดงาน ${T.owner}`, onClick: () => setShowInfo(true) },
                            { key: 'full', label: 'แก้หลายคนพร้อมกัน (ฟอร์มเต็ม)', sub: `เพิ่ม/แก้หลายคน หรือหลาย${T.request}ในครั้งเดียว`, onClick: () => setShowEdit(true) },
                            { key: 'del', label: 'ลบงาน', sub: 'ลบงานนี้และทุกคนในงานถาวร', danger: true, onClick: openDelete }
                        ]} />
                </div>
            </div>

            {project.objective && (
                <div className="panel pd-details">
                    <div className="pd-block">
                        <div className="pd-block-title"><Icon name="file" size={15} /> รายละเอียดงาน</div>
                        <p className="pd-block-text">{project.objective}</p>
                    </div>
                </div>
            )}

            {empty ? (
                <div className="panel tj-empty">
                    <div className="tj-empty-title">ยังไม่มีคนในงานนี้</div>
                    <p>ดีลคนไว้แล้วก็บันทึกเข้างานได้เลย หรือขอให้เพื่อนในทีมช่วยหาคน แล้วเลือกจากรายชื่อที่ส่งมา</p>
                    <div className="tj-empty-actions">
                        <button type="button" className="tj-big" onClick={() => setQuick('direct')}>
                            <strong><Icon name="plus" size={16} /> เพิ่มคนที่มีแล้ว</strong>
                            <span>รู้ชื่อคนแล้ว ใส่ค่าตัว วัน สถานที่</span>
                        </button>
                        <button type="button" className="tj-big casting" onClick={() => setQuick('casting')} disabled={closed}
                            title={closed ? 'งานนี้ปิดแล้ว — เปิดงานอีกครั้งก่อน' : undefined}>
                            <strong><Icon name="search" size={16} /> ขอให้ช่วยหา</strong>
                            <span>บอกสเปค จำนวน งบต่อคน ให้{T.finder}ส่งรายชื่อมาให้เลือก</span>
                        </button>
                    </div>
                    <Link className="tj-link" to="/hires?tab=people">เลือกจาก Talent Book →</Link>
                </div>
            ) : (
                <>
                    {/* เงิน 3 ก้อน — ชุดเดียวกับหน้ารอบทำจ่าย (hireBreakdown) */}
                    <div className="tj-money" role="group" aria-label="คนและเงินของงานนี้">
                        <div className="tj-money-box ok">
                            <div className="tj-money-k">{T.agreed} <small>(จ่ายได้)</small></div>
                            <div className="tj-money-v">{baht(M.agreed)}</div>
                            <div className="tj-money-n">{P.agreed + P.shot + P.delivered} คน</div>
                        </div>
                        <div className="tj-money-box wait">
                            <div className="tj-money-k">{T.pending}</div>
                            <div className="tj-money-v">{baht(M.pending)}</div>
                            <div className="tj-money-n">
                                {P.talking + P.booking} คน{P.no_fee > 0 ? ` · ยังไม่ใส่ค่าตัว ${P.no_fee}` : ''}
                            </div>
                        </div>
                        <div className="tj-money-box hold">
                            <div className="tj-money-k">{T.reserved} <small>(ยังไม่ได้คน)</small></div>
                            <div className="tj-money-v">{baht(M.unfilled)}</div>
                            <div className="tj-money-n">{P.need > 0 ? `ยังต้องหา ${P.need} คน` : 'ไม่มีที่ว่างรอหา'}</div>
                        </div>
                    </div>
                    <div className="tj-money-foot">
                        {isAdmin && <Link className="tj-link" to="/payments">ไปหน้ารอบทำจ่าย →</Link>}
                    </div>

                    {progress.todo.length > 0 && (
                        <section className="tj-todo" aria-labelledby="tj-todo-head">
                            <h2 id="tj-todo-head">ต้องทำในงานนี้</h2>
                            <ul>
                                {progress.todo.map(item => {
                                    const tt = todoText(item, P);
                                    return (
                                        <li key={item.code} className={tt.urgent ? 'urgent' : ''}>
                                            <span className="tj-todo-dot" aria-hidden="true" />
                                            <span className="tj-todo-text">{tt.text}</span>
                                            <button type="button" className="tj-btn" onClick={() => doTodo(item, tt)}>{tt.button}</button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}

                    {reqLines.length > 0 && (
                        <section className="tj-sec" aria-labelledby="tj-req-head">
                            <div className="tj-sec-head">
                                <h2 id="tj-req-head">{T.request} <span className="tj-count">{reqLines.length}</span></h2>
                            </div>
                            {tasksErr && <div className="tj-sec-note">โหลดรายละเอียดใบไม่สำเร็จ ({tasksErr}) — กดที่ใบเพื่อลองอีกครั้ง</div>}
                            <div className="tj-reqs">
                                {reqLines.map(r => {
                                    const counts = [
                                        r.remaining > 0 ? `ต้องหาอีก ${r.remaining} คน` : 'ได้ครบแล้ว',
                                        r.candidates > 0 ? `ส่งชื่อมาแล้ว ${r.candidates} ชื่อ` : '',
                                        r.waiting_count > 0 ? `รอเลือก ${r.waiting_count}` : '',
                                        r.assignee_name ? `${T.finder}: ${r.assignee_name}` : `ยังไม่มี${T.finder}`
                                    ].filter(Boolean).join(' · ');
                                    const kind = r.kind || 'คน';
                                    return (
                                        <div key={r.key} className="tj-req" role="button" tabIndex={0}
                                            aria-label={`เปิด${T.request} ${kind} ${r.headcount} คน — ${STAGE_LABEL[r.stage] || ''}`}
                                            onClick={() => openRequest(r.key)}
                                            onKeyDown={e => {
                                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                                e.preventDefault();
                                                openRequest(r.key);
                                            }}>
                                            <div className="tj-req-main">
                                                <div className="tj-req-top">
                                                    <span className={'stage-chip st-' + r.stage}>{STAGE_LABEL[r.stage] || r.stage}</span>
                                                    {r.late > 0 && <span className="stage-chip st-late">เลยกำหนดส่งรายชื่อ {r.late} วัน</span>}
                                                    <b>{kind} {r.headcount} คน</b>
                                                    <span className="tj-req-budget">งบ {baht(r.fee)}/คน</span>
                                                </div>
                                                <div className="tj-req-line">{waitingSentence(r)}</div>
                                                <div className="tj-req-meta">{counts}</div>
                                            </div>
                                            <Icon name="chevron" size={18} />
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <section className="tj-sec" ref={peopleRef} aria-labelledby="tj-people-head">
                        <div className="tj-sec-head">
                            <h2 id="tj-people-head">คนในงานนี้ <span className="tj-count">{direct.length}</span></h2>
                            <div className="tj-switch" role="group" aria-label="มุมมองรายชื่อ">
                                <button type="button" aria-pressed={view === 'person'} className={view === 'person' ? 'on' : ''}
                                    onClick={() => setView('person')}>ตามคน</button>
                                <button type="button" aria-pressed={view === 'day'} className={view === 'day' ? 'on' : ''}
                                    onClick={() => setView('day')}>ตามวัน</button>
                            </div>
                        </div>
                        <div className="tj-chips" role="group" aria-label="กรองคนตามขั้น">
                            {PERSON_GROUPS.map(g => (
                                <button type="button" key={g.key || 'all'} aria-pressed={group === g.key}
                                    className={'tj-chip' + (group === g.key ? ' on' : '')} onClick={() => setGroup(g.key)}>
                                    {g.label} <span>{groupCount(g.key)}</span>
                                </button>
                            ))}
                        </div>

                        {view === 'person' ? (
                            shownPeople.length === 0 ? (
                                <div className="tj-none">
                                    {direct.length === 0
                                        ? `ยังไม่มีคนในงานนี้ — รอ${T.finder}ส่งชื่อเข้า${T.request} หรือกด "+ เพิ่มคนที่มีแล้ว"`
                                        : 'ไม่มีคนในกลุ่มนี้'}
                                </div>
                            ) : (
                                <div className="tj-people">
                                    {shownPeople.map(it => {
                                        const key = String(it.key);
                                        const nx = nextOf(it);
                                        const busy = !!busyKeys[key];
                                        const needFee = needFeeFor(it, nx);
                                        const cur = PERSON_STEPS.indexOf(personStep(it));
                                        const meta = [fmtD(it.use_date), it.use_time, it.place].filter(Boolean).join(' · ');
                                        return (
                                            <div key={key} className={'tj-person' + (busy ? ' busy' : '')}
                                                onClick={e => { if (!e.target.closest('button, a, input, label')) openPerson(key); }}>
                                                <PersonThumb projectId={project.id} row={it} />
                                                <div className="tj-person-main">
                                                    <div className="tj-person-name-row">
                                                        <button type="button" className="tj-person-name" onClick={() => openPerson(key)}
                                                            title="เปิดแก้คนนี้">
                                                            {String(it.name || '').trim() || '(ยังไม่ใส่ชื่อ)'}
                                                        </button>
                                                        {it.kind && <span className="tj-kind">{it.kind}</span>}
                                                        {it.from_request != null && <span className="tj-from">ได้จาก{T.request}</span>}
                                                    </div>
                                                    <div className="tj-person-meta">{meta || 'ยังไม่ระบุวัน / สถานที่'}</div>
                                                    <div className="tj-person-fee">
                                                        {/* คนที่ยังกำลังคุยบันทึกได้โดยไม่มีค่าตัว — บอกให้ชัดแทน ฿0 ที่ดูเหมือนจ้างฟรี */}
                                                        {feeMissing(it.fee) ? <span className="tc-fee-missing">ยังไม่ใส่ค่าตัว</span> : baht(it.fee)}
                                                    </div>
                                                </div>
                                                <ol className="tj-steps" aria-label={`ขั้นของ ${it.name || 'คนนี้'}: ${personLabel(it)}`}>
                                                    {PERSON_STEPS.map((s, i) => (
                                                        <li key={s} className={i < cur ? 'done' : i === cur ? 'cur' : ''}
                                                            aria-current={i === cur ? 'step' : undefined}>
                                                            <span>{PERSON_STEP_LABEL[s]}</span>
                                                        </li>
                                                    ))}
                                                </ol>
                                                <div className="tj-person-act">
                                                    {nx && nx.locked ? (
                                                        // ระหว่างรอยืนยันคิว ขั้นเดินตามใบ — เปลี่ยนตรงนี้ไม่ได้ กดแล้วเปิดใบให้
                                                        <button type="button" className="tj-lock" onClick={() => openRequest(it.from_request)}
                                                            title={`เปิด${T.request}เพื่อ${T.confirmQueue}`}>
                                                            {nx.label}
                                                        </button>
                                                    ) : needFee ? (
                                                        <button type="button" className="tj-btn warn" disabled={busy || it._nokey}
                                                            onClick={() => openPerson(key, { agree: nx.needFee ? nx.status : null })}>
                                                            {nx.needFee ? nx.label : 'ใส่ค่าตัวก่อน'}
                                                        </button>
                                                    ) : nx ? (
                                                        <button type="button" className="tj-btn next" disabled={busy || it._nokey}
                                                            title={it._nokey ? 'แถวข้อมูลเก่า — แก้ได้ในฟอร์มเต็ม (เมนู ⋯)' : undefined}
                                                            onClick={() => stepPerson(it, nx)}>
                                                            {busy ? 'กำลังบันทึก...' : nx.label}
                                                        </button>
                                                    ) : (
                                                        <span className="tj-done"><Icon name="check" size={14} /> ครบทุกขั้นแล้ว</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            byDay.length === 0 ? (
                                <div className="tj-none">{direct.length === 0 ? 'ยังไม่มีคนในงานนี้' : 'ไม่มีคนในกลุ่มนี้'}</div>
                            ) : (
                                <div className="tj-days">
                                    {byDay.map(g => (
                                        <div className="tj-day" key={g.date || 'no-date'}>
                                            <div className="tj-day-head">
                                                <b>{g.date ? fmtD(g.date) : 'ยังไม่ระบุวัน'}</b>
                                                <span>{[...new Set(g.rows.map(r => String(r.place || '').trim()).filter(Boolean))].join(' · ')}</span>
                                                <span className="tj-count">{g.rows.length}</span>
                                            </div>
                                            <ul>
                                                {g.rows.map(it => (isCasting(it) ? (
                                                    <li key={it.key}>
                                                        <button type="button" className="tj-day-row req" onClick={() => openRequest(it.key)}>
                                                            <b>{T.request}{it.kind ? ` · ${it.kind}` : ''}</b>
                                                            <span className="tj-day-sub">ต้องหาอีก {hireLeft(it)} คน{it.place ? ` · ${it.place}` : ''}</span>
                                                            <span className="tj-day-fee">งบ {baht(it.fee)}/คน</span>
                                                        </button>
                                                    </li>
                                                ) : (
                                                    <li key={it.key}>
                                                        <button type="button" className="tj-day-row" onClick={() => openPerson(it.key)}>
                                                            <b>{String(it.name || '').trim() || '(ยังไม่ใส่ชื่อ)'}</b>
                                                            <span className="tj-day-sub">
                                                                {[it.kind, it.use_time, it.place, personLabel(it)].filter(Boolean).join(' · ')}
                                                            </span>
                                                            <span className="tj-day-fee">
                                                                {feeMissing(it.fee) ? <span className="tc-fee-missing">ยังไม่ใส่ค่าตัว</span> : baht(it.fee)}
                                                            </span>
                                                        </button>
                                                    </li>
                                                )))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}
                    </section>
                </>
            )}

            {/* แถบบันทึกแล้ว + เลิกทำ 5 วินาที / ข้อความผลการบันทึก */}
            <div className="tj-toasts" aria-live="polite">
                {openReq && !reqRow && (
                    <div className="tj-toast wait" role="status"><span>กำลังเปิด{T.request}...</span></div>
                )}
                {undo && (
                    <div className="tj-toast" key={undo.id}>
                        <span>บันทึก {undo.name}: {PERSON_STEP_LABEL[undo.from] || T.talking} → {PERSON_STEP_LABEL[undo.to] || undo.to}</span>
                        <button type="button" onClick={undoStep} disabled={undoBusy === undo.id}>{undoBusy === undo.id ? 'กำลังเลิกทำ...' : 'เลิกทำ'}</button>
                        {undoBusy !== undo.id && <i className="tj-toast-timer" aria-hidden="true" />}
                    </div>
                )}
                {notice && (
                    <div className={'tj-toast ' + notice.type} role={notice.type === 'error' ? 'alert' : 'status'}>
                        <span>{notice.text}</span>
                        <button type="button" className="x" aria-label="ปิดข้อความ" onClick={() => setNotice(null)}>×</button>
                    </div>
                )}
            </div>

            {/* ฟอร์มสั้นเพิ่มทีละคน / ขอให้ช่วยหา — ต่อท้ายงานนี้ด้วยเส้น POST ของแถวเดียว · "ดูใบ" เปิดลิ้นชักใบบนหน้านี้ */}
            {quick && (
                <QuickHireForm mode={quick} job={project}
                    onClose={() => setQuick('')}
                    onSaved={() => reload()}
                    onOpenRequest={({ key }) => openRequest(key)} />
            )}

            {personRow && (
                <PersonDrawer key={person.key} projectId={project.id} row={personRow} locked={lockedRow(personRow)}
                    focusFee={person.focusFee} agreeOnFee={person.agreeOnFee}
                    onClose={() => setPerson(null)}
                    onSaved={(data, name) => {
                        setPerson(null);
                        applyItems(data && data.items, data && data.updated_at);
                        afterChange();
                        setNotice({ type: 'ok', text: `บันทึก ${name || 'คนนี้'} แล้ว` });
                    }}
                    onRemoved={(list, name) => {
                        setPerson(null);
                        applyItems(list);
                        afterChange();
                        setNotice({ type: 'ok', text: `เอา ${name || 'คนนี้'} ออกจากงานแล้ว` });
                    }}
                    onFileChanged={list => { applyItems(list); afterChange(); }}
                    onStale={() => { reload(); tasksChanged(); }}
                    onOpenRequest={key => openRequest(key)} />
            )}

            {/* ลิ้นชักใบ — ได้แถวสดจาก /hires/tasks ทุกครั้ง (โหลดใหม่หลังทุกการเปลี่ยนแปลง) */}
            {openReq && reqRow && (
                <RequestDrawer request={reqRow} onClose={closeRequest} onJobPage
                    onChanged={() => { reload(); loadTasks(); }} />
            )}

            {showInfo && (
                <JobInfoDrawer project={project} onClose={() => setShowInfo(false)}
                    onSaved={() => {
                        setShowInfo(false);
                        afterChange();
                        setNotice({ type: 'ok', text: 'บันทึกข้อมูลงานแล้ว' });
                    }} />
            )}

            {showEdit && (
                <OtherProjectForm editing={project} onClose={() => setShowEdit(false)} onConflict={reload}
                    onSaved={() => { setShowEdit(false); afterChange(); }} />
            )}

            {showDel && (
                <div className="modal-backdrop" onClick={() => !deleting && setShowDel(false)}>
                    <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="tj-del-head"
                        onClick={e => e.stopPropagation()}>
                        <h3 id="tj-del-head">ลบงานนี้?</h3>
                        <p className="tj-confirm-text">
                            <span className="tj-del-name">“{project.name}”</span> และทุกคน / ทุก{T.request}ในงานนี้จะถูกลบถาวร ย้อนกลับไม่ได้
                        </p>
                        <label className="tj-del-label" htmlFor="tj-del-input">พิมพ์ชื่องานให้ตรงเพื่อยืนยัน</label>
                        <input id="tj-del-input" className="tj-del-input" value={delName} autoComplete="off" autoFocus
                            onChange={e => setDelName(e.target.value)} placeholder={jobName}
                            onKeyDown={e => { if (e.key === 'Enter') deleteProject(); }} />
                        {delErr && <div className="alert-error" role="alert">{delErr}</div>}
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={deleting} onClick={() => setShowDel(false)}>ยกเลิก</button>
                            <button type="button" className="btn-danger tj-btn-danger" disabled={!delOk || deleting} onClick={deleteProject}>
                                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
