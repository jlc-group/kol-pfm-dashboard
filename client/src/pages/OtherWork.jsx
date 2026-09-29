import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import { T, parseOpen } from '../data/talentLabels.js';
import QuickHireForm from '../components/QuickHireForm.jsx';
import RateCardForm from '../components/RateCardForm.jsx';
import HomeTab from './hires/HomeTab.jsx';
import JobsTab from './hires/JobsTab.jsx';
import RequestsTab from './hires/RequestsTab.jsx';
import PeopleTab from './hires/PeopleTab.jsx';
import RatesTab from './hires/RatesTab.jsx';
import RequestDrawer from './hires/RequestDrawer.jsx';
import { countsTip } from './hires/requestText.js';

// เมนู Talent — จ้างนางแบบ / นักแสดง / พิธีกร / Live สด (งาน campaign_type 'other')
//  • (ไม่มีแท็บ "หน้าหลัก" แล้ว — ผู้ใช้ขอเอาออก 29 ก.ย.) เปิดเมนูมาเจอ "งานทั้งหมด"
//  • งานทั้งหมด   = รายการงาน (บ้านของ "งาน")
//  • ใบขอให้หา    = ใบขอให้หาทุกใบข้ามงาน · เลขแดง "ถึงตาคุณ" อยู่บนแท็บนี้ (ตัวกรอง "รอฉันทำ" ในแท็บ)
//  • ขอเรทราคา    = แท็บของตัวเอง (?tab=rates) — ผู้ใช้ขอเอาตัวสลับย่อยใน Talent Book ออก · ลิงก์เก่าทั้งสองยังพามาถูกที่
//  • Talent Book  = คอมการ์ดของทุกคนที่เคยเสนอ/จ้าง (?tab=people)
// คนช่วยหาที่ไม่มีแบรนด์ไม่มีแถบแท็บ — ได้หน้า "งานหาคนของฉัน" (HomeTab) หน้าเดียว
// ข้อมูลใบขอให้หาโหลดที่นี่ที่เดียวแล้วส่งลงไป — เลขแดง ตาราง และลิ้นชักจะได้เห็นชุดเดียวกันเสมอ
// ลิ้นชักของใบเปิดจาก ?open=<งาน>~<ใบ> ได้จากทุกแท็บ (ลิงก์ที่ส่ง LINE ไปแล้วยังเปิดได้)
const TABS = [
    { key: 'jobs', label: 'งานทั้งหมด' },
    { key: 'requests', label: T.request },
    // ผู้ใช้ขอให้ "ขอเรทราคา" มาก่อน "Talent Book"
    { key: 'rates', label: 'ขอเรทราคา' },
    { key: 'people', label: 'Talent Book' }
];
// ?tab= → แท็บ (ค่าที่ไม่รู้จัก รวมถึงลิงก์เก่า ?tab=home = งานทั้งหมด)
const tabOf = v => (v === 'requests' || v === 'people' || v === 'rates' ? v : 'jobs');
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
    // 'home' = หน้า "งานหาคนของฉัน" ของคนช่วยหาที่ไม่มีแบรนด์เท่านั้น (ไม่มีแท็บให้กด)
    const tab = hasBrand ? tabOf(asked) : 'home';

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

    // ===== ขอเรทราคา: เลขเหลืองบนแท็บ (เฉพาะคนที่มีแบรนด์ — คำขอราคากรองตามแบรนด์) =====
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
    // การ์ดงาน (แท็บงานทั้งหมด) ส่งงานมาด้วย → ฟอร์มสั้นล็อกงานนั้นไว้ ข้ามข้อ "งานไหน"
    const startFromCard = (mode, job) => startForm(mode, job || null);
    // การ์ดงานรู้แค่ (งาน, ใบ) — เปิดลิ้นชักตัวเดียวกับที่อื่น (?open=<งาน>~<ใบ>)
    const openRequestAt = (projectId, key) => openRequest({ project_id: projectId, key });
    function onFormSaved(result) {
        loadTasks();
        setJobsVersion(v => v + 1);
        // บันทึกคนเสร็จ (ไม่ได้กด "เพิ่มอีกคน") → พาไปหน้างาน เห็นคนที่เพิ่งใส่พร้อมงบรวมของงาน
        if (result && result.mode === 'direct' && !result.more && result.project && result.project.id != null) {
            navigate(`/projects/${result.project.id}`);
        }
    }
    function onRateSaved() {
        // ไปที่แท็บ "ขอเรทราคา" — แท็บนั้นโหลดรายการใหม่เองแล้วส่งกลับมาอัปเดตเลขเหลือง
        setAsking(false);
        setParams({ tab: 'rates' });
        setRateSent(true);
    }

    const todoTitle = counts && counts.total > 0 ? `${T.request}ที่ถึงตาคุณ ${counts.total} ใบ (${countsTip(counts)})` : '';

    return (
        <div className="th-hub">
            <header className="page-head th-head">
                <div>
                    <h1>Talent</h1>
                    <p className="page-sub">จ้างนางแบบ นักแสดง พิธีกร Live สด: บันทึกคนที่ดีลไว้แล้ว หรือขอให้เพื่อนในทีมช่วยหาคน</p>
                </div>
            </header>

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
                            {/* เลขแดงเดิมอยู่บนแท็บหน้าหลัก — ย้ายมาที่ใบขอให้หา (ดูเรื่องค้างที่ตัวกรอง "รอฉันทำ") */}
                            {t.key === 'requests' && counts && counts.total > 0 && (
                                <span className="agency-tab-count danger" title={todoTitle}>{counts.total}</span>
                            )}
                            {t.key === 'rates' && rateOpen > 0 && (
                                <span className="agency-tab-count warn" title="ขอเรทราคาที่ยังรอตอบ">{rateOpen}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {tab === 'home' ? (
                <HomeTab tasks={tasks} loading={tasksBusy && !tasks} error={tasksError} user={user} onOpen={openRequest} />
            ) : tab === 'jobs' ? (
                <JobsTab onStart={startFromCard} onOpenRequest={openRequestAt} version={jobsVersion} />
            ) : tab === 'requests' ? (
                <RequestsTab tasks={tasks} loading={tasksBusy && !tasks} error={tasksError} hasBrand={hasBrand}
                    onOpen={openRequest} onNewRequest={() => startForm('casting')} />
            ) : tab === 'rates' ? (
                <RatesTab onLoaded={list => setRates(list)} justSent={rateSent} />
            ) : (
                <PeopleTab />
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
