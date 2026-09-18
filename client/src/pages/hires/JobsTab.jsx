import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import OtherProjectForm from '../../components/OtherProjectForm.jsx';
import { fmtRange } from '../../utils/date.js';
import { T, baht, jobStatusLabel, jobStatusValue } from '../../data/talentLabels.js';

// แท็บ "งานทั้งหมด" — รายการงาน Talent (บ้านของ "งาน")
// ปุ่ม "บันทึกการจ้าง" เปิดฟอร์มสั้นของหน้าแม่ (มีคนแล้ว / ขอให้ช่วยหา) · ฟอร์มเต็มหลายคนยังอยู่ในเมนูเดียวกัน
// version = ตัวนับจากหน้าแม่ บันทึกจากฟอร์มสั้นเสร็จแล้วรายการต้องโหลดใหม่ (งานใหม่ / คนเพิ่ม)
const SHOW = [
    { key: 'open', label: 'กำลังทำ' },
    { key: 'Completed', label: 'จบแล้ว' },
    { key: 'Cancelled', label: 'ยกเลิก' },
    { key: '', label: 'ทั้งหมด' }
];

export default function JobsTab({ onStart, version = 0 }) {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [show, setShow] = useState('open');
    const [brand, setBrand] = useState('');
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

    const rows = data?.rows || [];
    const q = search.trim().toLowerCase();
    const matchBase = r => (!brand || r.brand === brand)
        && (!q || [r.name, r.brand, r.contact, ...(r.names || [])]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
    const matchShow = (r, key) => (key === 'open' ? !r.closed : !key || r.status === key);
    const shown = useMemo(() => rows.filter(r => matchBase(r) && matchShow(r, show)),
        [rows, brand, q, show]);   // eslint-disable-line react-hooks/exhaustive-deps

    const openRows = rows.filter(r => !r.closed && matchBase(r));
    const people = openRows.reduce((n, r) => n + r.people_count, 0);
    const remaining = openRows.reduce((n, r) => n + r.remaining, 0);
    const totalFee = openRows.reduce((n, r) => n + r.total_fee, 0);
    const brands = data?.brands || [];

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
                            <button type="button" role="menuitem" onClick={() => choose(() => onStart && onStart('direct'))}>
                                <strong>มีคนแล้ว บันทึกการจ้าง</strong>
                                <span>รู้ชื่อคนแล้ว ใส่ค่าตัว วัน สถานที่</span>
                            </button>
                            <button type="button" role="menuitem" onClick={() => choose(() => onStart && onStart('casting'))}>
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
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`ค้นหาชื่องาน / แบรนด์ / ${T.owner} / ชื่อคนในงาน...`} />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
            </div>

            {error && <div className="alert-error">{error}</div>}

            <div className="ka-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">งานที่กำลังทำ</div>
                        <div className="ka-sum-v">{data ? openRows.length : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico blue"><Icon name="team" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ได้ตัวแล้ว / ยังต้องหาอีก</div>
                        <div className="ka-sum-v">{data ? `${people} / ${remaining} คน` : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico amber"><Icon name="coins" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ค่าตัวรวม (งานที่กำลังทำ)</div>
                        <div className="ka-sum-v">{data ? baht(totalFee) : '—'}</div>
                    </div>
                </div>
            </div>

            <div className="proc-platfilter">
                <span className="proc-platfilter-lbl">แสดง:</span>
                {SHOW.map(s => (
                    <button type="button" key={s.key || 'all'} className={'proc-plat-chip' + (show === s.key ? ' on' : '')}
                        onClick={() => setShow(s.key)}>
                        {s.label} ({rows.filter(r => matchBase(r) && matchShow(r, s.key)).length})
                    </button>
                ))}
            </div>

            {brands.length > 1 && (
                <div className="brand-filter">
                    <span className="brand-filter-label">Brand:</span>
                    <button type="button" className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>ทุกแบรนด์</button>
                    {brands.map(b => (
                        <button type="button" key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>{b}</button>
                    ))}
                </div>
            )}

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
