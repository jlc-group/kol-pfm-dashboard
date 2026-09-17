import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import OtherProjectForm from '../../components/OtherProjectForm.jsx';
import { fmtRange } from '../../utils/date.js';

// แท็บ "งานจ้าง" — รายการงานจ้างอื่น ๆ รายงาน (บ้านของ "งาน")
// ปุ่มสร้างงานจ้างมีที่นี่ที่เดียวในแอป · ทีมที่ดีลคนเองแล้วเปิดงาน → แก้ไข / เพิ่มคน → ระบุคนเอง
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
const SHOW = [
    { key: 'open', label: 'ยังไม่จบ' },
    { key: 'Completed', label: 'เสร็จสิ้น' },
    { key: 'Cancelled', label: 'ยกเลิก' },
    { key: '', label: 'ทั้งหมด' }
];

export default function JobsTab() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [show, setShow] = useState('open');
    const [brand, setBrand] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        api('/hires/jobs').then(res => { setData(res.data); setError(''); }).catch(err => setError(err.message));
    }, []);

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
                <button className="btn-primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" size={16} /> สร้างงานจ้าง
                </button>
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่องาน / แบรนด์ / ผู้ติดต่อ / ชื่อคนในงาน..." />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
            </div>

            {error && <div className="alert-error">{error}</div>}

            <div className="ka-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">งานที่ยังไม่จบ</div>
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
                        <div className="ka-sum-k">ค่าตัวรวม (งานที่ยังไม่จบ)</div>
                        <div className="ka-sum-v">{data ? B(totalFee) : '—'}</div>
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
                                <th className="num">ได้ตัวแล้ว</th><th>ใบขอจัดหา</th><th className="num">ค่าตัวรวม</th><th>ผู้ติดต่อ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!data ? (
                                <tr><td colSpan="8" className="empty">กำลังโหลด...</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan="8" className="empty">
                                    {rows.length === 0
                                        ? 'ยังไม่มีงานจ้าง — กด "สร้างงานจ้าง" ด้านบนได้เลย'
                                        : 'ไม่พบงานตามเงื่อนไขที่เลือก'}
                                </td></tr>
                            ) : shown.map(r => (
                                <tr key={r.id} className="row-link" onClick={() => navigate(`/projects/${r.id}`)}>
                                    <td>
                                        <Link className="act-project" to={`/projects/${r.id}`} onClick={e => e.stopPropagation()}>{r.name}</Link>
                                        {r.item_count === 0 && <span className="cast-sub ctype-none">ยังไม่มีรายชื่อ</span>}
                                    </td>
                                    <td>{r.brand ? <span className="tag">{r.brand}</span> : <span className="muted">—</span>}</td>
                                    <td><span className={`status status-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                                    <td className="muted">{r.start_date ? fmtRange(r.start_date, r.end_date, ' → ') : '—'}</td>
                                    <td className="num">{r.people_count} คน</td>
                                    <td>
                                        {r.request_count === 0 ? <span className="muted">—</span>
                                            : r.closed ? <span className="tag">งานปิดแล้ว</span>
                                            : r.remaining === 0 ? <span className="tag">ครบแล้ว</span>
                                                : (
                                                    <span className="tag warn">
                                                        ต้องหาอีก {r.remaining}{r.waiting > 0 ? ` · รออนุมัติ ${r.waiting}` : ''}
                                                    </span>
                                                )}
                                    </td>
                                    <td className="num">{B(r.total_fee)}</td>
                                    <td className="muted">{r.contact || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {creating && (
                <OtherProjectForm onClose={() => setCreating(false)}
                    onSaved={p => { setCreating(false); navigate(`/projects/${p.id}`); }} />
            )}
        </div>
    );
}
