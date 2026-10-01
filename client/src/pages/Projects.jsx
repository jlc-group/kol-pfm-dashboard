import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import { visibleBrands } from '../data/brands.js';
import { groupPlatforms, quotaOf, clipCountFor } from '../data/adGroups.js';
import SoloKolForm from '../components/SoloKolForm.jsx';
import SoloKolList from './projects/SoloKolList.jsx';
import { matchSoloSearch } from '../data/soloKol.js';

const STATUS_LABEL = {
    Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก'
};
// ลำดับการแสดงกลุ่มสถานะ: ร่าง → กำลังทำ → เสร็จสิ้น → ยกเลิก
const STATUS_ORDER = ['Draft', 'Active', 'Completed', 'Cancelled'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${TH_MONTHS_FULL[m - 1]} ${y}`;
}
// รวมทุกเดือนที่ project แต่ละอันคาบเกี่ยว (สำหรับ dropdown)
function monthsOfProject(p) {
    const s = (p.start_date || p.end_date || '').slice(0, 7);
    const e = (p.end_date || p.start_date || '').slice(0, 7);
    if (!s) return [];
    const out = [];
    let [y, m] = s.split('-').map(Number);
    const [ey, em] = e.split('-').map(Number);
    while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m++; if (m > 12) { m = 1; y++; }
    }
    return out;
}
function fmtDate(d) {
    if (!d) return null;
    const [y, m, day] = d.split('-');
    return `${Number(day)} ${TH_MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}
function dateRange(p) {
    const a = fmtDate(p.start_date), b = fmtDate(p.end_date);
    if (a && b) return `${a} – ${b}`;
    return a || b || null;
}
function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
// project อยู่ในเดือนที่เลือกไหม (ช่วงวันแคมเปญคาบเกี่ยวกับเดือนนั้น)
function inMonth(p, ym) {
    if (!ym) return true;
    const [y, m] = ym.split('-').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const mStart = `${y}-${pad(m)}-01`;
    const mEnd = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
    const s = p.start_date || p.end_date;
    const e = p.end_date || p.start_date;
    if (!s) return false;
    return s <= mEnd && e >= mStart;
}
// project อยู่ในปีที่เลือกไหม (ใช้เกณฑ์เดียวกับเดือน คือช่วงวันแคมเปญคาบเกี่ยวกับปีนั้น)
function inYear(p, y) {
    if (!y) return true;
    const s = p.start_date || p.end_date;
    const e = p.end_date || p.start_date;
    if (!s) return false;
    return s <= `${y}-12-31` && e >= `${y}-01-01`;
}
// แคมเปญที่บันทึกไว้ก่อนมีประเภท = แคมเปญ KOL ทั้งหมด · 'solo' = KOL รายคน (แท็บของตัวเอง)
const typeOf = p => (p.campaign_type === 'other' || p.campaign_type === 'solo' ? p.campaign_type : 'kol');
function matchSearch(p, q) {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [p.name, p.brand, p.owner, p.team_name].some(v => (v || '').toLowerCase().includes(s));
}

export default function Projects() {
    const { user } = useAuth();
    const BRANDS = visibleBrands(user);   // เห็นเฉพาะแบรนด์ที่ตัวเองดูแล
    const { isAdmin } = useAuth();
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [brand, setBrand] = useState('');
    const [search, setSearch] = useState('');
    const [year, setYear] = useState('');   // '' = ทุกปี
    const [month, setMonth] = useState(''); // '' = ทุกเดือน
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // หน้านี้สร้างแคมเปญ KOL (และ KOL รายคนในแท็บของมัน) — งานจ้างอื่น ๆ / สอบถามราคา ไม่มีที่สร้างในหน้าเว็บแล้ว (หน้า Talent เหลือแค่ Talent Book)
    const [showForm, setShowForm] = useState(false);
    // แท็บ แคมเปญ KOL | KOL รายคน (ผู้ใช้สั่ง 30 ก.ย. 2026) — จำไว้ใน URL (?view=solo) ให้ปุ่มย้อนกลับ/ลิงก์กลับมาแท็บเดิม
    const [params, setParams] = useSearchParams();
    const view = params.get('view') === 'solo' ? 'solo' : 'kol';
    const setView = v => setParams(v === 'solo' ? { view: 'solo' } : {}, { replace: true });
    const [showSolo, setShowSolo] = useState(false);
    const [freshId, setFreshId] = useState(null);   // แถวที่เพิ่งเพิ่ม — ไฮไลต์สักครู่ให้เห็นว่าเข้าแล้ว
    useEffect(() => {
        if (!freshId) return undefined;
        const t = setTimeout(() => setFreshId(null), 2500);
        return () => clearTimeout(t);
    }, [freshId]);

    function load() {
        setLoading(true);
        api('/projects')
            .then(res => setProjects(res.data))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { load(); }, []);

    function handleCreated(project) {
        setShowForm(false);
        navigate(`/projects/${project.id}`);
    }
    // เพิ่ม KOL รายคนแล้ว: อยู่หน้าเดิม สลับไปแท็บ KOL รายคน โหลดรายการใหม่ และไฮไลต์แถวใหม่
    // "บันทึกแล้วเพิ่มอีกคน" = ฟอร์มยังเปิดอยู่
    function handleSoloSaved(project, { again } = {}) {
        if (!again) setShowSolo(false);
        setView('solo');
        if (project && project.id) setFreshId(project.id);
        load();
    }

    // หน้านี้เหลือเฉพาะแคมเปญ KOL — งานจ้างอื่น ๆ ย้ายไปอยู่เมนู "งานจ้างอื่น ๆ" (รายชื่อผู้รับงาน)
    // และ "งานจัดหา" (ใบขอจัดหาที่ยังไม่ได้ตัวคน) ตัดออกตั้งแต่ต้นทางเพื่อให้ตัวนับทุกตัวไม่รวมของที่ไม่ได้โชว์
    // KOL รายคนแยกไปแท็บของตัวเอง — ตัวกรองค้นหา / ปี / เดือน / แบรนด์ ใช้ร่วมกัน แต่นับตามแท็บที่เปิดอยู่
    const kolProjects = projects.filter(p => typeOf(p) === 'kol');
    const soloProjects = projects.filter(p => typeOf(p) === 'solo');
    const pool = view === 'solo' ? soloProjects : kolProjects;
    const matchQ = view === 'solo' ? matchSoloSearch : matchSearch;
    // กรองด้วย search + ปี + เดือน ก่อน แล้วค่อยกรองแบรนด์ (นับจำนวนในชิปแบรนด์ให้ตรงกับตัวกรองปัจจุบัน)
    const base = pool.filter(p => inYear(p, year) && inMonth(p, month) && matchQ(p, search));
    const shown = brand ? base.filter(p => p.brand === brand) : base;
    const countOf = b => base.filter(p => p.brand === b).length;
    const hasFilter = brand || search.trim() || month || year;
    // รายการเดือนสำหรับ dropdown (จากช่วงวันของทุก project) — ถ้าเลือกปีไว้ ให้เหลือเฉพาะเดือนของปีนั้น
    const allMonths = [...new Set(pool.flatMap(monthsOfProject))].sort().reverse();
    // ตัวเลือกคิดจากแท็บที่เปิดอยู่ — เดือน/ปีที่เลือกไว้จากอีกแท็บต้องยังอยู่ในรายการ (ไม่งั้นช่องขึ้น "ทุกเดือน" แต่ยังกรองอยู่)
    const monthOptions = [...new Set([...(year ? allMonths.filter(mm => mm.startsWith(year + '-')) : allMonths), ...(month ? [month] : [])])].sort().reverse();
    const yearOptions = [...new Set([...allMonths.map(mm => mm.slice(0, 4)), ...(year ? [year] : [])])].sort().reverse();

    // เปลี่ยนปีแล้วถ้าเดือนที่เลือกอยู่ไม่ใช่ของปีนั้น ให้ล้างเดือนทิ้ง กันเลือกขัดกันจนไม่เหลือผลลัพธ์
    function changeYear(y) {
        setYear(y);
        if (y && month && !month.startsWith(y + '-')) setMonth('');
    }

    // การ์ด Project 1 ใบ
    const renderCard = (p) => (
        <button type="button" className="pcard" key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
            <div className={`pcard-accent acc-${p.status}`} />
            <div className="pcard-body">
                <div className="pcard-head">
                    <span className={`status status-${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span>
                    {isAdmin && p.team_name && <span className="team-chip">{p.team_name}</span>}
                </div>
                {p.brand && <span className="pcard-brand">{p.brand}</span>}
                <h3 className="pcard-name">{p.name}</h3>
                <div className="pcard-sub">
                    {p.owner && <span className="pcard-owner">👤 {p.owner}</span>}
                    {dateRange(p) && <span>📅 {dateRange(p)}</span>}
                </div>
                <div className="pcard-foot">
                    <div>
                        <div className="pcard-budget-val">฿{Number(p.budget).toLocaleString('th-TH')}</div>
                        <div className="pcard-budget-lbl">งบประมาณ</div>
                    </div>
                    {/* 1 แถว = 1 Clip อยู่แล้ว เป้าจึงต้องเป็นจำนวน Clip ไม่ใช่จำนวนคน
                        (คน × Content ต่อคน ของแต่ละ Platform) — ของเก่าที่ไม่มีกลุ่มค่อยถอยไปใช้เป้าคน */}
                    {(() => {
                        const gs = p.ad_groups || [];
                        const target = gs.reduce((n, g) => n + groupPlatforms(g)
                            .reduce((m, pf) => m + quotaOf(g, pf) * clipCountFor(g, pf), 0), 0) || p.kol_target || 0;
                        const done = p.sub_count > 0 ? p.sub_confirmed : (p.kol_count || 0);
                        return <span className="kol-badge">⭐ {done}{target ? `/${target}` : ''} Clip</span>;
                    })()}
                </div>
            </div>
        </button>
    );

    return (
        <div>
            <header className="page-head">
                <h1>แคมเปญ</h1>
                <p className="page-sub">{isAdmin ? 'จัดการแคมเปญของทุกทีมในที่เดียว' : 'จัดการแคมเปญของทีมคุณ'}</p>
            </header>

            <div className="agency-tabs hub-tabs proj-type-tabs" role="tablist" aria-label="ประเภทงาน KOL">
                <button type="button" role="tab" aria-selected={view === 'kol'} className={view === 'kol' ? 'active' : ''} onClick={() => setView('kol')}>
                    แคมเปญ KOL <span className="agency-tab-count">{kolProjects.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={view === 'solo'} className={view === 'solo' ? 'active' : ''} onClick={() => setView('solo')}>
                    KOL รายคน <span className="agency-tab-count">{soloProjects.length}</span>
                </button>
            </div>

            {/* ค้นหา + กรองรายเดือน */}
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                <div className="search-wrap">
                    <Icon name="search" size={17} />
                    <input aria-label="ค้นหาแคมเปญ" className="search-input"
                        placeholder={view === 'solo' ? 'ค้นหาชื่อบัญชี KOL แบรนด์ Agency หรือผู้ดูแล' : 'ค้นหาชื่อแคมเปญ แบรนด์ หรือผู้ดูแล'}
                        value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select aria-label="กรองตามปี" className="campaign-select" value={year} onChange={e => changeYear(e.target.value)}>
                    <option value="">ทุกปี</option>
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select aria-label="กรองตามเดือน" className="campaign-select" value={month} onChange={e => setMonth(e.target.value)}>
                    <option value="">ทุกเดือน</option>
                    {monthOptions.map(mm => <option key={mm} value={mm}>{monthLabel(mm)}</option>)}
                </select>
            </div>

            {/* ฟิลเตอร์ตามแบรนด์ (dropdown) + ปุ่มสร้าง (ซ้ายสุด) */}
            <div className="brand-filter">
                {/* ปุ่มของแท็บที่เปิดอยู่เป็นปุ่มหลัก อีกอันเป็นปุ่มรอง */}
                <button className={view === 'kol' ? 'btn-primary' : 'btn-ghost'} style={{ marginRight: 6 }} onClick={() => setShowForm(true)}>
                    <Icon name="plus" size={17} /> สร้างแคมเปญ KOL
                </button>
                <button className={view === 'solo' ? 'btn-primary' : 'btn-ghost'} style={{ marginRight: 6 }} onClick={() => setShowSolo(true)}>
                    <Icon name="plus" size={17} /> เพิ่ม KOL รายคน
                </button>
                <span className="brand-filter-label">แบรนด์</span>
                <select aria-label="กรองตามแบรนด์" className="campaign-select" value={brand} onChange={e => setBrand(e.target.value)}>
                    <option value="">ทุกแบรนด์ ({base.length})</option>
                    {BRANDS.map(b => (
                        <option key={b} value={b}>{b} ({countOf(b)})</option>
                    ))}
                </select>
            </div>

            {error && <div className="alert-error">{error}</div>}

            {loading ? (
                <div className="panel"><p className="empty">กำลังโหลด...</p></div>
            ) : view === 'solo' ? (
                <SoloKolList list={shown} onOpen={p => navigate(`/projects/${p.id}`)} onAdd={() => setShowSolo(true)}
                    freshId={freshId} filtered={!!hasFilter} />
            ) : shown.length === 0 ? (
                <div className="panel empty-state">
                    <div className="empty-emoji">🔍</div>
                    <p>{hasFilter ? 'ไม่พบ Project ตามเงื่อนไขที่เลือก — ลองปรับคำค้นหา แบรนด์ ปี หรือเดือน' : 'ยังไม่มี Project — เริ่มสร้าง Project แรกของทีมได้เลย'}</p>
                    <button className="btn-primary" onClick={() => setShowForm(true)}>
                        <Icon name="plus" size={17} /> สร้างแคมเปญ
                    </button>
                </div>
            ) : (
                STATUS_ORDER.map(st => {
                    const list = shown.filter(p => p.status === st);
                    if (list.length === 0) return null;
                    return (
                        <div className="proj-status-group" key={st}>
                            <div className="proj-status-head">
                                <span className={`proj-status-dot dot-${st}`} />
                                <span className="proj-status-title">{STATUS_LABEL[st]}</span>
                                <span className="proj-status-count">{list.length}</span>
                            </div>
                            <div className="card-grid">
                                {list.map(renderCard)}
                            </div>
                        </div>
                    );
                })
            )}

            {showForm && <ProjectForm onClose={() => setShowForm(false)} onSaved={handleCreated} />}
            {showSolo && <SoloKolForm onClose={changed => { setShowSolo(false); if (changed) load(); }} onSaved={handleSoloSaved} />}
        </div>
    );
}
