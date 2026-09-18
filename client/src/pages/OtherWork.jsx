import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import { T, NEED_FEE_MSG, parseOpen } from '../data/talentLabels.js';
import QuickHireForm from '../components/QuickHireForm.jsx';
import RateCardForm from '../components/RateCardForm.jsx';
import HomeTab from './hires/HomeTab.jsx';
import JobsTab from './hires/JobsTab.jsx';
import RequestsTab from './hires/RequestsTab.jsx';
import PeopleRatesTab from './hires/PeopleRatesTab.jsx';
import RequestDrawer from './hires/RequestDrawer.jsx';
import { countsTip } from './hires/requestText.js';

// เมนู Talent — จ้างนางแบบ / นักแสดง / พิธีกร / Live สด (งาน campaign_type 'other')
//  • หน้าหลัก     = "รอคุณทำ" + ปุ่มเริ่ม 3 ทาง (เปิดเมนูมาเจอหน้านี้เสมอ ไม่เด้งแท็บตามข้อมูลแล้ว)
//  • งานทั้งหมด   = รายการงาน (บ้านของ "งาน")
//  • ใบขอให้หา    = ใบขอให้หาทุกใบข้ามงาน
//  • คนและราคา    = คนที่เคยจ้าง | ถามราคา (สลับย่อย)
// ข้อมูลใบขอให้หาโหลดที่นี่ที่เดียวแล้วส่งลงไป — เลขแดง หน้าหลัก ตาราง และลิ้นชักจะได้เห็นชุดเดียวกันเสมอ
// ลิ้นชักของใบเปิดจาก ?open=<งาน>~<ใบ> ได้จากทุกแท็บ (ลิงก์ที่ส่ง LINE ไปแล้วยังเปิดได้)
const TABS = [
    { key: 'home', label: 'หน้าหลัก' },
    { key: 'jobs', label: 'งานทั้งหมด' },
    { key: 'requests', label: T.request },
    { key: 'people', label: 'คนและราคา' }
];
// ?tab= ของลิงก์เก่า → แท็บใหม่ (rates / people เป็นแท็บย่อยของ "คนและราคา")
const tabOf = v => (v === 'jobs' || v === 'requests' ? v : v === 'people' || v === 'rates' ? 'people' : 'home');
const EMPTY_TASKS = { rows: [], counts: { total: 0 } };

export default function OtherWork() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const brands = visibleBrands(user);
    // คนช่วยหาที่ไม่มีสิทธิ์แบรนด์ไหนเลยเห็นได้แค่ใบที่ถูกมอบให้ — แท็บอื่นว่างเปล่าสำหรับเขา จึงเหลือหน้าเดียว
    const hasBrand = brands.length > 0;
    const [params, setParams] = useSearchParams();
    const asked = params.get('tab');
    const tab = hasBrand ? tabOf(asked) : 'home';
    const sub = asked === 'rates' ? 'rates' : 'people';

    // ===== ใบขอให้หา (ชุดเดียวทั้งหน้า) =====
    const [tasks, setTasks] = useState(null);
    const [tasksError, setTasksError] = useState('');
    const [tasksBusy, setTasksBusy] = useState(true);
    const alive = useRef(true);
    const busyRef = useRef(false);
    const againRef = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    // มีคนกดหลายที่พร้อมกัน (การ์ดยิงอีเวนต์ + หน้าแม่สั่งโหลด) → ระหว่างโหลดอยู่ให้จองไว้อีกรอบเดียวพอ
    // ไม่ยิงซ้อน: คำตอบที่มาช้ากว่าจะไม่ทับของใหม่ และไม่ถล่ม server ทีละหลายคำขอ
    const loadTasks = useCallback(function run() {
        if (busyRef.current) { againRef.current = true; return; }
        busyRef.current = true;
        setTasksBusy(true);
        api('/hires/tasks')
            .then(res => { if (alive.current) { setTasks(res.data || EMPTY_TASKS); setTasksError(''); } })
            .catch(err => { if (alive.current) setTasksError(err.message || 'โหลดใบขอให้หาไม่สำเร็จ'); })
            .finally(() => {
                busyRef.current = false;
                if (againRef.current) { againRef.current = false; run(); return; }
                if (alive.current) setTasksBusy(false);
            });
    }, []);
    useEffect(() => {
        loadTasks();
        window.addEventListener('kol:hire-tasks-changed', loadTasks);
        return () => window.removeEventListener('kol:hire-tasks-changed', loadTasks);
    }, [loadTasks]);
    const counts = tasks ? tasks.counts || { total: 0 } : null;
    const rows = (tasks && tasks.rows) || [];

    // ===== ถามราคา: เลขเหลือง + สรุปบนหน้าหลัก (เฉพาะคนที่มีแบรนด์ — คำขอราคากรองตามแบรนด์) =====
    const [rates, setRates] = useState(null);
    useEffect(() => {
        if (!hasBrand) return undefined;
        let on = true;
        api('/rate-requests').then(res => { if (on) setRates(res.data || []); }).catch(() => { if (on) setRates([]); });
        return () => { on = false; };
    }, [hasBrand]);
    const rateOpen = (rates || []).filter(r => (r.status || 'open') === 'open').length;
    const [rateSent, setRateSent] = useState(false);

    // ===== งานที่เพิ่งบันทึก → รายการงานโหลดใหม่ =====
    const [jobsVersion, setJobsVersion] = useState(0);
    // การกดในใบ (เลือกคน / คนนี้มาไม่ได้ / ยืนยันคิว) เปลี่ยนจำนวนคนของงานด้วย — รายการงานต้องโหลดใหม่ตาม ไม่งั้นตัวเลขขัดกับรายการใบด้านบน
    const refreshAll = useCallback(() => { loadTasks(); setJobsVersion(v => v + 1); }, [loadTasks]);
    useEffect(() => {
        const bump = () => setJobsVersion(v => v + 1);
        window.addEventListener('kol:hire-tasks-changed', bump);
        return () => window.removeEventListener('kol:hire-tasks-changed', bump);
    }, []);

    function pick(key) {
        // เปลี่ยนแท็บแล้วล้างพารามิเตอร์อื่นทั้งหมด (เช่น ?open= ของใบที่เปิดค้างไว้)
        setRateSent(false);
        setParams({ tab: key });
    }
    const goTab = key => pick(key);

    // ===== ลิ้นชักของใบ =====
    const openParam = params.get('open');
    const openRef = parseOpen(openParam);
    // หาแถวสดทุกครั้งที่ render — ลิ้นชักเห็นขั้นล่าสุดเสมอหลังโหลดใหม่
    const openRow = openRef
        ? rows.find(r => String(r.project_id) === String(openRef.project_id) && String(r.key) === String(openRef.key)) || null
        : null;
    const [notice, setNotice] = useState('');
    const shownRef = useRef(null);   // ใบที่ลิ้นชักเคยเปิดสำเร็จ (แยก "ลิงก์ผิด" กับ "ใบเพิ่งหายไป")

    const dropOpen = useCallback(() => {
        setParams(p => { const n = new URLSearchParams(p); n.delete('open'); return n; }, { replace: true });
    }, [setParams]);

    function openRequest(r) {
        if (!r || r.project_id == null || r.key == null) return;
        setNotice('');
        const hit = rows.some(x => String(x.project_id) === String(r.project_id) && String(x.key) === String(r.key));
        // ใบที่เพิ่งสร้างอาจยังไม่อยู่ในชุดที่โหลดไว้ → โหลดใหม่ก่อนตัดสินว่า "ไม่พบ"
        if (!hit) loadTasks();
        // เปิดจากในหน้า = push (กดย้อนกลับแล้วลิ้นชักปิด) · state บอกว่ารายการนี้เราใส่เอง ตอนปิดจะได้ถอยกลับแทนการซ้อนประวัติ
        setParams(p => { const n = new URLSearchParams(p); n.set('open', `${r.project_id}~${r.key}`); return n; },
            { state: { talentDrawer: true } });
    }
    function closeOpen() {
        shownRef.current = null;
        if (location.state && location.state.talentDrawer) navigate(-1);
        else dropOpen();
    }

    useEffect(() => {
        if (!openParam) { shownRef.current = null; return; }
        if (!openRef) {
            setNotice(`ลิงก์${T.request}ไม่ถูกต้อง`);
            dropOpen();
            return;
        }
        // รอให้ชุดข้อมูลล่าสุดมาถึงก่อน (โหลดครั้งแรก / เพิ่งสั่งโหลดใหม่) ไม่งั้นใบที่เพิ่งสร้างจะถูกบอกว่าไม่พบ
        if (!tasks || tasksBusy) return;
        if (openRow) { shownRef.current = openParam; return; }
        setNotice(shownRef.current === openParam
            ? 'ใบนี้ถูกลบหรือปิดไปแล้ว'
            : `ไม่พบ${T.request}จากลิงก์นี้ — ใบอาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เปิดใบนี้`);
        shownRef.current = null;
        dropOpen();
    }, [openParam, tasks, tasksBusy, !!openRow]);   // eslint-disable-line react-hooks/exhaustive-deps

    // ===== ฟอร์มสั้น (มีคนแล้ว / ขอให้ช่วยหา) และถามราคา — เปิดทับหน้าเดิม =====
    const [form, setForm] = useState(null);     // { mode, job }
    const [asking, setAsking] = useState(false);
    const startForm = (mode, job = null) => setForm({ mode, job });
    function onFormSaved(result) {
        loadTasks();
        setJobsVersion(v => v + 1);
        // บันทึกคนเสร็จ (ไม่ได้กด "เพิ่มอีกคน") → พาไปหน้างาน เห็นคนที่เพิ่งใส่พร้อมงบรวมของงาน
        if (result && result.mode === 'direct' && !result.more && result.project && result.project.id != null) {
            navigate(`/projects/${result.project.id}`);
        }
    }
    function onRateSaved() {
        // ไปที่ "คนและราคา / ถามราคา" — แท็บย่อยโหลดรายการใหม่เองแล้วส่งกลับมาอัปเดตเลขเหลือง
        setAsking(false);
        setParams({ tab: 'rates' });
        setRateSent(true);
    }

    const helpKey = 'talent.helpSeen';
    const [help, setHelp] = useState(false);
    useEffect(() => {
        // เปิดคำอธิบายให้เองครั้งแรกครั้งเดียว (คนช่วยหามีคำอธิบายของตัวเองในหน้าอยู่แล้ว)
        if (!hasBrand) return;
        let seen = true;
        try { seen = !!window.localStorage.getItem(helpKey); } catch { /* เบราว์เซอร์ปิดที่เก็บข้อมูล */ }
        if (!seen) {
            setHelp(true);
            try { window.localStorage.setItem(helpKey, '1'); } catch { /* ไม่เป็นไร */ }
        }
    }, [hasBrand]);

    const homeTitle = counts && counts.total > 0 ? `${T.request}ที่ถึงตาคุณ ${counts.total} ใบ (${countsTip(counts)})` : '';

    return (
        <div className="th-hub">
            <header className="page-head th-head">
                <div>
                    <h1>Talent</h1>
                    <p className="page-sub">จ้างนางแบบ นักแสดง พิธีกร Live สด: บันทึกคนที่ดีลไว้แล้ว หรือขอให้เพื่อนในทีมช่วยหาคน</p>
                </div>
                <button type="button" className="th-help-btn" aria-expanded={help} onClick={() => setHelp(h => !h)}>
                    ? ใช้งานยังไง
                </button>
            </header>

            {help && <HelpPanel onClose={() => setHelp(false)} />}

            {notice && (
                <div className="alert-error th-notice" role="alert">
                    <span>{notice}</span>
                    <button type="button" className="th-notice-x" aria-label="ปิดข้อความ" onClick={() => setNotice('')}>×</button>
                </div>
            )}

            {hasBrand && (
                <div className="agency-tabs hub-tabs" role="tablist">
                    {TABS.map(t => (
                        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                            className={tab === t.key ? 'active' : ''} onClick={() => pick(t.key)}>
                            {t.label}
                            {t.key === 'home' && counts && counts.total > 0 && (
                                <span className="agency-tab-count danger" title={homeTitle}>{counts.total}</span>
                            )}
                            {t.key === 'people' && rateOpen > 0 && (
                                <span className="agency-tab-count warn" title="ถามราคาที่ยังรอตอบ">{rateOpen}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {tab === 'home' ? (
                <HomeTab tasks={tasks} loading={tasksBusy && !tasks} error={tasksError}
                    finderOnly={!hasBrand} user={user} brands={brands} rates={rates}
                    onOpen={openRequest} onStart={mode => startForm(mode)} onAskRate={() => setAsking(true)}
                    onGoTab={goTab} jobsVersion={jobsVersion} />
            ) : tab === 'jobs' ? (
                <JobsTab onStart={mode => startForm(mode)} version={jobsVersion} />
            ) : tab === 'requests' ? (
                <RequestsTab tasks={tasks} loading={tasksBusy && !tasks} error={tasksError} hasBrand={hasBrand}
                    onOpen={openRequest} onNewRequest={() => startForm('casting')} />
            ) : (
                <PeopleRatesTab sub={sub} onSub={s => pick(s)} rateOpen={rateOpen}
                    onRatesLoaded={list => setRates(list)} rateSent={rateSent} />
            )}

            {openRow && (
                <RequestDrawer request={openRow} onClose={closeOpen} onChanged={refreshAll} />
            )}

            {form && (
                <QuickHireForm mode={form.mode} job={form.job} onClose={() => setForm(null)}
                    onSaved={onFormSaved} onOpenRequest={openRequest} />
            )}

            {asking && (
                <RateCardForm defaultBrand={brands.length === 1 ? brands[0] : ''}
                    onClose={() => setAsking(false)} onSaved={onRateSaved} />
            )}
        </div>
    );
}

// คำอธิบาย 2 เส้นทาง — ภาษาธรรมดา ให้คนที่เพิ่งเข้ามาเห็นภาพรวมก่อนกด
function HelpPanel({ onClose }) {
    const direct = ['บันทึกคน', T.agreed, 'ถ่าย', 'ส่งงาน', 'รอบทำจ่าย'];
    const casting = [`${T.finder}ส่งชื่อ`, 'คุณเลือก', T.confirmQueue, T.agreed];
    return (
        <section className="th-help" aria-label="วิธีใช้งานหน้า Talent">
            <div className="th-help-head">
                <strong>ใช้งานยังไง</strong>
                <button type="button" className="th-help-x" aria-label="ปิดคำอธิบาย" onClick={onClose}>×</button>
            </div>
            <div className="th-help-paths">
                <div className="th-help-path">
                    <div className="th-help-name">มีคนแล้ว</div>
                    <ol className="th-flow">{direct.map(s => <li key={s}>{s}</li>)}</ol>
                </div>
                <div className="th-help-path casting">
                    <div className="th-help-name">ยังไม่มีคน ให้ช่วยหา</div>
                    <ol className="th-flow">{casting.map(s => <li key={s}>{s}</li>)}</ol>
                </div>
            </div>
            <p className="th-help-note">
                บันทึกคนที่ยังไม่รู้ค่าตัวได้ (สถานะ "{T.talking}") — {NEED_FEE_MSG} · งานที่ต้องทำของคุณขึ้นที่ "หน้าหลัก" พร้อมเลขแดง
            </p>
        </section>
    );
}
