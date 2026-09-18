import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import JobsTab from './hires/JobsTab.jsx';
import RequestsTab from './hires/RequestsTab.jsx';
import RatesTab from './hires/RatesTab.jsx';
import PeopleTab from './hires/PeopleTab.jsx';

// เมนู "งานจ้างอื่น ๆ" — รวมของเดิมสองเมนู (งานจัดหา + งานจ้างอื่น ๆ) ไว้ที่เดียว แยกหน้าที่เป็นแท็บไม่ให้ทับกัน
//  • งานจ้าง      = ตัวงาน (สร้างงานได้ที่นี่ที่เดียว) · ทีมที่ดีลคนเองใส่ชื่อในงาน
//  • ใบขอจัดหา    = คิวงานข้ามทุกงาน "ถึงตาใคร" (เลขแดงบนเมนูนับจากแท็บนี้) — กดแล้วพาไปที่การ์ดของใบ
//  • สอบถามราคา   = คำขอราคา KOL / Presenter (ไม่ผูกกับงาน)
//  • คนที่เคยจ้าง = ประวัติคน/ค่าตัว (อ่านอย่างเดียว)
// แท็บอยู่ใน URL (?tab=) จะได้ส่งลิงก์ / กดย้อนกลับแล้วกลับมาแท็บเดิม
const TABS = [
    { key: 'jobs', label: 'งานจ้าง', brandOnly: true },
    { key: 'requests', label: 'ใบขอจัดหา', brandOnly: false },
    { key: 'rates', label: 'สอบถามราคา', brandOnly: true },
    { key: 'people', label: 'คนที่เคยจ้าง', brandOnly: true }
];

export default function OtherWork() {
    const { user } = useAuth();
    // คนหาที่ไม่มีสิทธิ์แบรนด์ไหนเลยเห็นได้แค่ใบที่ถูกมอบหมาย — แท็บอื่นว่างเปล่าสำหรับเขา จึงซ่อนไว้
    const hasBrand = visibleBrands(user).length > 0;
    const tabs = TABS.filter(t => hasBrand || !t.brandOnly);
    const [params, setParams] = useSearchParams();

    const [counts, setCounts] = useState(null);     // เลขแดง (ชุดเดียวกับบนเมนู)
    const [rateOpen, setRateOpen] = useState(0);    // คำขอราคาที่ยังรอตอบ

    const loadCounts = useCallback(() => {
        api('/hires/tasks/count')
            .then(res => setCounts(res.data || { total: 0 }))
            .catch(() => setCounts({ total: 0 }));
    }, []);
    useEffect(() => {
        loadCounts();
        window.addEventListener('kol:hire-tasks-changed', loadCounts);
        return () => window.removeEventListener('kol:hire-tasks-changed', loadCounts);
    }, [loadCounts]);

    // ไม่ได้ระบุแท็บ: มีงานถึงตาเรา → เปิดคิวก่อน · ไม่มี → เปิดรายการงาน
    // เลือกครั้งเดียวแล้วเขียนลง URL — ถ้าคิดใหม่ทุกครั้งที่เลขแดงเปลี่ยน แท็บจะเด้งไปเองกลางงาน (กล่องที่เปิดอยู่ปิดหาย)
    // และกดย้อนกลับจะกลับมาแท็บเดิมได้ถูก
    const asked = params.get('tab');
    const valid = tabs.some(t => t.key === asked) ? asked : null;
    useEffect(() => {
        if (valid) return;
        if (hasBrand && counts == null) return;
        const pickTab = !hasBrand || counts.total > 0 ? 'requests' : 'jobs';
        setParams(p => { const n = new URLSearchParams(p); n.set('tab', pickTab); return n; }, { replace: true });
    }, [valid, hasBrand, counts]);   // eslint-disable-line react-hooks/exhaustive-deps
    const tab = valid;

    function pick(key) {
        // เปลี่ยนแท็บแล้วล้างพารามิเตอร์ของแท็บเก่า (เช่น ?open= ของใบที่เปิดค้างไว้)
        setParams({ tab: key });
    }

    return (
        <div>
            <header className="page-head">
                <div>
                    <h1>Talent</h1>
                    <p className="page-sub">นางแบบ / นักแสดง / Live สด / พิธีกร — ทั้งงานที่ดีลคนเองแล้ว และงานที่ขอให้ช่วยจัดหา</p>
                </div>
            </header>

            <div className="agency-tabs hub-tabs" role="tablist">
                {tabs.map(t => (
                    <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                        className={tab === t.key ? 'active' : ''} onClick={() => pick(t.key)}>
                        {t.label}
                        {t.key === 'requests' && counts && counts.total > 0 && (
                            <span className="agency-tab-count danger" title="ใบที่ถึงตาคุณ">{counts.total}</span>
                        )}
                        {t.key === 'rates' && rateOpen > 0 && (
                            <span className="agency-tab-count warn" title="คำขอที่ยังรอตอบ">{rateOpen}</span>
                        )}
                    </button>
                ))}
            </div>

            {tab === null ? (
                <div className="panel empty-state"><p>กำลังโหลด...</p></div>
            ) : tab === 'jobs' ? (
                <JobsTab />
            ) : tab === 'requests' ? (
                <RequestsTab counts={counts} hasBrand={hasBrand} />
            ) : tab === 'rates' ? (
                <RatesTab onOpenCount={setRateOpen} />
            ) : (
                <PeopleTab />
            )}

            {/* แท็บสอบถามราคาโหลดข้อมูลเองตอนเปิด — ตัวเลขบนแท็บต้องมีตั้งแต่ยังไม่ได้กดเข้าไป */}
            {hasBrand && tab !== 'rates' && <RateCountLoader onCount={setRateOpen} />}
        </div>
    );
}

function RateCountLoader({ onCount }) {
    useEffect(() => {
        let alive = true;
        api('/rate-requests')
            .then(res => { if (alive) onCount((res.data || []).filter(r => (r.status || 'open') === 'open').length); })
            .catch(() => {});
        return () => { alive = false; };
    }, [onCount]);
    return null;
}
