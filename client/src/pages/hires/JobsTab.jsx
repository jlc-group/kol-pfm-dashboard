import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Icon from '../../components/Icon.jsx';
import OtherProjectForm from '../../components/OtherProjectForm.jsx';
import { fmtRange } from '../../utils/date.js';
import { T, baht, jobStatusLabel, jobStatusValue } from '../../data/talentLabels.js';
import JobCard, { jobSlots } from './JobCard.jsx';

// แท็บ "งานทั้งหมด" — รายการงาน Talent (บ้านของ "งาน")
// ปุ่ม "บันทึกการจ้าง" เปิดฟอร์มสั้นของหน้าแม่ (มีคนแล้ว / ขอให้ช่วยหา) · ฟอร์มเต็มหลายคนยังอยู่ในเมนูเดียวกัน
// version = ตัวนับจากหน้าแม่ บันทึกจากฟอร์มสั้นเสร็จแล้วรายการต้องโหลดใหม่ (งานใหม่ / คนเพิ่ม)
// มุมมองหลักเป็นการ์ด (แถบได้คนแล้ว + เรื่องถัดไป + เงิน 3 ก้อน) · ตาราง 8 คอลัมน์เดิมยังสลับดูได้
const SHOW = [
    { key: 'open', label: 'กำลังทำ' },
    { key: 'Completed', label: 'จบแล้ว' },
    { key: 'Cancelled', label: 'ยกเลิก' },
    { key: '', label: 'ทั้งหมด' }
];
// หัวกล่องสรุปกล่องแรกเปลี่ยนตามชิป — ตัวเลขทุกกล่องนับจากงานที่แสดงอยู่ในรายการเสมอ
const SHOW_TITLE = { open: 'งานที่กำลังทำ', Completed: 'งานที่จบแล้ว', Cancelled: 'งานที่ยกเลิก', '': 'งานทั้งหมด' };

// จำมุมมองที่เลือกไว้ (การ์ด | ตาราง) — ที่เก็บข้อมูลถูกปิดก็แค่กลับไปเป็นการ์ด
const VIEW_KEY = 'talent.jobsView';
const readView = () => {
    try { return window.localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
};
const saveView = v => {
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* ที่เก็บข้อมูลถูกปิด — ไม่เป็นไร */ }
};

// รวมตัวเลขของงานที่แสดงอยู่ (ใช้ตอนกรอง — server สรุปให้แค่ "งานที่กำลังทำทั้งหมด")
// ok = false → มีงานที่ยังไม่มี progress (server เก่า) กล่องสรุปกลับไปใช้ตัวเลขชุดเดิม
function sumRows(list) {
    const out = {
        jobs: list.length, ok: true,
        slots: { agreed: 0, pending: 0, need: 0 },
        money: { agreed: 0, pending: 0, unfilled: 0 },
        people: 0, remaining: 0, total_fee: 0
    };
    list.forEach(r => {
        out.people += Number(r.people_count) || 0;
        out.remaining += Number(r.remaining) || 0;
        out.total_fee += Number(r.total_fee) || 0;
        if (!r.progress) { out.ok = false; return; }
        const s = jobSlots(r.progress);
        out.slots.agreed += s.agreed;
        out.slots.pending += s.pending;
        out.slots.need += s.need;
        const m = r.progress.money || {};
        out.money.agreed += Number(m.agreed) || 0;
        out.money.pending += Number(m.pending) || 0;
        out.money.unfilled += Number(m.unfilled) || 0;
    });
    return out;
}

export default function JobsTab({ onStart, onOpenRequest, version = 0 }) {
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [show, setShow] = useState('open');
    const [brand, setBrand] = useState('');
    const [view, setView] = useState(readView);
    const [creating, setCreating] = useState(false);
    const [menu, setMenu] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        let on = true;
        api('/hires/jobs')
            .then(res => { if (on) { setData(res.data); setError(''); } })
            .catch(err => { if (on) setError(err.message); });
        return () => { on = false; };
    }, [version]);

    // เมนูปุ่มบันทึก: กดนอกเมนู / กด Esc แล้วปิด
    useEffect(() => {
        if (!menu) return undefined;
        const onDown = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
        const onKey = e => { if (e.key === 'Escape') setMenu(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);
    const choose = fn => { setMenu(false); fn(); };
    const start = mode => { if (onStart) onStart(mode); };
    const pickView = v => { setView(v); saveView(v); };

    const rows = data?.rows || [];
    const brands = data?.brands || [];
    // ตัวเลือกแบรนด์ขึ้นเฉพาะตอนมีมากกว่า 1 แบรนด์ — ถ้ารายการใหม่เหลือแบรนด์เดียว ตัวกรองที่ค้างไว้ต้องไม่ซ่อนงานแบบมองไม่เห็น
    const brandOn = brands.length > 1 && brands.includes(brand) ? brand : '';
    const q = search.trim().toLowerCase();
    const matchBase = r => (!brandOn || r.brand === brandOn)
        && (!q || [r.name, r.brand, r.contact, ...(r.names || [])]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
    const matchShow = (r, key) => (key === 'open' ? !r.closed : !key || r.status === key);
    const shown = useMemo(() => rows.filter(r => matchBase(r) && matchShow(r, show)),
        [rows, brandOn, q, show]);   // eslint-disable-line react-hooks/exhaustive-deps

    // กล่องสรุป = ตัวเลขของงานที่แสดงอยู่ · มุมมองตั้งต้น (กำลังทำ ไม่กรอง) ใช้สรุปจาก server ซึ่งเป็นชุดเดียวกันพอดี
    const plain = show === 'open' && !brandOn && !q;
    const srv = data && data.summary;
    const sum = plain && srv && srv.slots && srv.money && shown.every(r => r.progress)
        ? { ...sumRows(shown), jobs: Number(srv.open_jobs != null ? srv.open_jobs : shown.length) || 0, slots: srv.slots, money: srv.money }
        : sumRows(shown);
    const n = v => Number(v) || 0;

    const filteredOut = data && rows.length > 0 && shown.length === 0;
    const clearFilters = () => { setSearch(''); setBrand(''); setShow(''); };

    return (
        <div className="hub-tab">
            <div className="hub-toolbar">
                <div className="th-menu-wrap" ref={menuRef}>
                    <button type="button" className="btn-primary" aria-haspopup="menu" aria-expanded={menu}
                        onClick={() => setMenu(m => !m)}>
                        <Icon name="plus" size={16} /> บันทึกการจ้าง ▾
                    </button>
                    {menu && (
                        <div className="th-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => choose(() => start('direct'))}>
                                <strong>มีคนแล้ว บันทึกการจ้าง</strong>
                                <span>รู้ชื่อคนแล้ว ใส่ค่าตัว วัน สถานที่</span>
                            </button>
                            <button type="button" role="menuitem" onClick={() => choose(() => start('casting'))}>
                                <strong>ขอให้ช่วยหาคน</strong>
                                <span>บอกสเปค จำนวน งบต่อคน ให้{T.finder}ส่งรายชื่อมา</span>
                            </button>
                            <button type="button" role="menuitem" onClick={() => choose(() => setCreating(true))}>
                                <strong>สร้างงานเปล่า (ฟอร์มเต็ม)</strong>
                                <span>ใส่หลายคน / หลายใบขอให้หาในครั้งเดียว</span>
                            </button>
                        </div>
                    )}
                </div>
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`ค้นหาชื่องาน / แบรนด์ / ${T.owner} / ชื่อคนในงาน...`}
                        aria-label="ค้นหางาน" />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
                {brands.length > 1 && (
                    <select className="tl-brand" value={brandOn} onChange={e => setBrand(e.target.value)} aria-label="กรองตามแบรนด์">
                        <option value="">ทุกแบรนด์</option>
                        {brands.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                )}
            </div>

            {error && <div className="alert-error">{error}</div>}

            <div className="tl-filterrow">
                <div className="proc-platfilter">
                    <span className="proc-platfilter-lbl">แสดง:</span>
                    {SHOW.map(s => (
                        <button type="button" key={s.key || 'all'} className={'proc-plat-chip' + (show === s.key ? ' on' : '')}
                            aria-pressed={show === s.key} onClick={() => setShow(s.key)}>
                            {s.label} ({rows.filter(r => matchBase(r) && matchShow(r, s.key)).length})
                        </button>
                    ))}
                </div>
                <div className="tl-view" role="group" aria-label="มุมมองรายการงาน">
                    <button type="button" className={'tl-view-btn' + (view === 'cards' ? ' on' : '')} aria-pressed={view === 'cards'}
                        onClick={() => pickView('cards')}>การ์ด</button>
                    <button type="button" className={'tl-view-btn' + (view === 'table' ? ' on' : '')} aria-pressed={view === 'table'}
                        onClick={() => pickView('table')}>ตาราง</button>
                </div>
            </div>

            <div className="ka-summary tl-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                    <div className="tl-sum-count">
                        <div className="ka-sum-k">{SHOW_TITLE[show]}</div>
                        <div className="ka-sum-v">{data ? sum.jobs : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico blue"><Icon name="team" size={22} /></div>
                    <div className="tl-sum-body">
                        <div className="ka-sum-k">คน</div>
                        {!data ? <div className="ka-sum-v">—</div> : sum.ok ? (
                            <ul className="tl-sum-list">
                                <li><span><i className="tl-dot ok" />{T.agreed}</span><b>{n(sum.slots.agreed)} คน</b></li>
                                <li><span><i className="tl-dot wait" />{T.pending}</span><b>{n(sum.slots.pending)} คน</b></li>
                                <li><span><i className="tl-dot need" />ยังต้องหา</span><b>{n(sum.slots.need)} คน</b></li>
                            </ul>
                        ) : (
                            <ul className="tl-sum-list">
                                <li><span>ได้ตัวแล้ว</span><b>{sum.people} คน</b></li>
                                <li><span>ยังต้องหา</span><b>{sum.remaining} คน</b></li>
                            </ul>
                        )}
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico amber"><Icon name="coins" size={22} /></div>
                    <div className="tl-sum-body">
                        <div className="ka-sum-k">เงิน</div>
                        {!data ? <div className="ka-sum-v">—</div> : sum.ok ? (
                            <ul className="tl-sum-list">
                                <li><span><i className="tl-dot ok" />{T.agreed}</span><b>{baht(sum.money.agreed)}</b></li>
                                <li><span><i className="tl-dot wait" />{T.pending}</span><b>{baht(sum.money.pending)}</b></li>
                                <li><span><i className="tl-dot need" />{T.reserved}</span><b>{baht(sum.money.unfilled)}</b></li>
                            </ul>
                        ) : (
                            <ul className="tl-sum-list">
                                <li><span>งบรวม</span><b>{baht(sum.total_fee)}</b></li>
                            </ul>
                        )}
                        {/* ยอด 3 ก้อนเป็นชุดเดียวกับหน้ารอบทำจ่าย (hireBreakdown) — admin เปิดเทียบได้ทันที */}
                        {isAdmin && <Link className="th-link tl-pay-link" to="/payments">ไปหน้ารอบทำจ่าย →</Link>}
                    </div>
                </div>
            </div>
            {/* ค้นหา / เลือกแบรนด์แล้วตัวเลขเปลี่ยน — บอกไว้ว่านับจากรายการที่เห็น ไม่ใช่ทั้งหมด */}
            {data && (brandOn || q) && (
                <p className="tl-sum-note">ตัวเลขด้านบนนับจากงานที่แสดงอยู่ {shown.length} งาน</p>
            )}

            {view === 'cards' ? (
                !data ? (
                    <div className="th-section th-loading tl-empty">{error ? '—' : 'กำลังโหลด...'}</div>
                ) : rows.length === 0 ? (
                    <div className="th-section th-empty tl-empty">
                        <div className="th-empty-title">ยังไม่มีงาน</div>
                        <p>เริ่มจากบันทึกคนที่ดีลไว้แล้ว หรือขอให้{T.finder}ช่วยหาคน</p>
                        <div className="th-empty-actions">
                            <button type="button" className="btn-primary" onClick={() => start('direct')}>
                                <Icon name="plus" size={16} /> มีคนแล้ว บันทึกการจ้าง
                            </button>
                            <button type="button" className="btn-ghost th-casting-btn" onClick={() => start('casting')}>
                                <Icon name="search" size={16} /> ขอให้ช่วยหาคน
                            </button>
                        </div>
                    </div>
                ) : filteredOut ? (
                    <div className="th-section th-empty tl-empty">
                        <div className="th-empty-title">ไม่พบงานตามเงื่อนไขที่เลือก</div>
                        <button type="button" className="th-textbtn" onClick={clearFilters}>ล้างตัวกรอง ดูงานทั้งหมด</button>
                    </div>
                ) : (
                    <div className="tl-grid">
                        {shown.map(r => (
                            <JobCard key={r.id} job={r} onOpenRequest={onOpenRequest} onStart={onStart} isAdmin={isAdmin} />
                        ))}
                    </div>
                )
            ) : (
                <div className="panel no-pad">
                    <div className="ka-table-scroll">
                        <table className="data-table jobs-table">
                            <thead>
                                <tr>
                                    <th>ชื่องาน</th><th>แบรนด์</th><th>สถานะงาน</th><th>ช่วงวันใช้งาน</th>
                                    <th className="num">ได้ตัวแล้ว</th><th>{T.request}</th><th className="num">ค่าตัวรวม</th><th>{T.owner}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!data ? (
                                    <tr><td colSpan="8" className="empty">{error ? '—' : 'กำลังโหลด...'}</td></tr>
                                ) : shown.length === 0 ? (
                                    <tr><td colSpan="8" className="empty">
                                        {rows.length === 0
                                            ? 'ยังไม่มีงาน — กด "บันทึกการจ้าง" ด้านบนได้เลย'
                                            : 'ไม่พบงานตามเงื่อนไขที่เลือก'}
                                    </td></tr>
                                ) : shown.map(r => (
                                    <tr key={r.id} className="row-link" onClick={() => navigate(`/projects/${r.id}`)}>
                                        <td>
                                            <Link className="act-project" to={`/projects/${r.id}`} onClick={e => e.stopPropagation()}>{r.name}</Link>
                                            {r.item_count === 0 && <span className="cast-sub ctype-none">ยังไม่มีรายชื่อ</span>}
                                        </td>
                                        <td>{r.brand ? <span className="tag">{r.brand}</span> : <span className="muted">—</span>}</td>
                                        {/* งาน Draft แสดงเป็น "กำลังทำ" — สีต้องเหมือนกันด้วย ไม่งั้นป้ายเดียวกันสองสีดูเหมือนคนละสถานะ */}
                                        <td><span className={`status status-${jobStatusValue(r.status)}`}>{jobStatusLabel(r.status)}</span></td>
                                        <td className="muted">{r.start_date ? fmtRange(r.start_date, r.end_date, ' → ') : '—'}</td>
                                        <td className="num">{r.people_count} คน</td>
                                        <td>
                                            {r.request_count === 0 ? <span className="muted">—</span>
                                                : r.closed ? <span className="tag">งานปิดแล้ว</span>
                                                : r.remaining === 0 ? <span className="tag">ครบแล้ว</span>
                                                    : (
                                                        <span className="tag warn">
                                                            ต้องหาอีก {r.remaining}{r.waiting > 0 ? ` · รอเลือก ${r.waiting}` : ''}
                                                        </span>
                                                    )}
                                            {!r.closed && (r.booking_pending > 0 || r.fee_review > 0) && (
                                                <span className="tag warn">
                                                    {[r.booking_pending ? `รอ${T.confirmQueue} ${r.booking_pending}` : '', r.fee_review ? `รอตัดสินค่าตัวใหม่ ${r.fee_review}` : ''].filter(Boolean).join(' · ')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="num">{baht(r.total_fee)}</td>
                                        <td className="muted">{r.contact || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {creating && (
                <OtherProjectForm onClose={() => setCreating(false)}
                    onSaved={p => {
                        setCreating(false);
                        // ฟอร์มเต็มสร้างใบขอให้หาได้ด้วย — บอกเลขแดง/หน้าหลักให้โหลดใหม่ก่อนพาไปหน้างาน
                        window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
                        navigate(`/projects/${p.id}`);
                    }} />
            )}
        </div>
    );
}
