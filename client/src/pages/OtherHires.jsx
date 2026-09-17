import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import OtherProjectForm from '../components/OtherProjectForm.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';

// หน้ารวมรายชื่อผู้รับงานจากแคมเปญ "งานจ้างอื่น ๆ" ทุกใบ (นางแบบ/นักแสดง/Live สด ฯลฯ)
// แยกจากหน้าอินฟลูเอนเซอร์ตั้งใจ — งานพวกนี้ไม่มียอดวิว/CPM ถ้าเอาไปปนกัน ค่าเฉลี่ยของหน้านั้นจะเพี้ยน
// server รวมรายชื่อให้แล้ว (1 แถว = 1 คน) หน้านี้ทำแค่ค้นหา/กรอง/เรียง
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};

export default function OtherHires() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [showForm, setShowForm] = useState(false);
    const BRANDS = visibleBrands(user);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('');
    const [brand, setBrand] = useState('');

    useEffect(() => {
        api('/hires').then(res => setData(res.data)).catch(err => setError(err.message));
    }, []);

    const rows = data?.rows || [];
    const kinds = data?.kinds || [];
    // กรองในหน้าเว็บ (ข้อมูลชุดเล็ก) — server กรองสิทธิ์แบรนด์ให้แล้วชั้นหนึ่ง
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r =>
            (!kind || r.kind === kind)
            && (!brand || (r.brands || []).includes(brand))
            && (!q || [r.name, r.kind, r.agency, r.contact, ...(r.campaigns || []).map(c => c.name), ...(r.brands || [])]
                .some(v => String(v == null ? '' : v).toLowerCase().includes(q))));
    }, [rows, search, kind, brand]);

    const jobs = shown.reduce((n, r) => n + (Number(r.jobs) || 0), 0);
    const totalFee = shown.reduce((n, r) => n + (Number(r.total_fee) || 0), 0);
    const brandOptions = BRANDS.filter(b => rows.some(r => (r.brands || []).includes(b)));

    return (
        <div>
            <header className="page-head with-action">
                <div>
                    <h1>งานจ้างอื่น ๆ</h1>
                    <p className="page-sub">รายชื่อนางแบบ / นักแสดง / Live สด และงานจ้างที่ไม่ใช่ KOL</p>
                </div>
                <div className="ka-top-filters">
                    <button className="btn-primary" onClick={() => setShowForm(true)}>
                        <Icon name="plus" size={16} /> สร้างงานจ้าง
                    </button>
                    <div className="ka-search">
                        <Icon name="search" size={15} />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="ค้นหาชื่อ / สังกัด / เบอร์ติดต่อ / งาน..." />
                        {search && (
                            <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>
                        )}
                    </div>
                    <select aria-label="กรองตามประเภทงาน" value={kind} onChange={e => setKind(e.target.value)}>
                        <option value="">ทุกประเภทงาน</option>
                        {kinds.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                </div>
            </header>

            {error && <div className="alert-error">{error}</div>}

            <div className="ka-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="team" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ผู้รับงานทั้งหมด</div>
                        <div className="ka-sum-v">{data ? shown.length : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico blue"><Icon name="folder" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">จำนวนครั้งที่จ้าง</div>
                        <div className="ka-sum-v">{data ? jobs : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico amber"><Icon name="coins" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ค่าตัวรวม</div>
                        <div className="ka-sum-v">{data ? B(totalFee) : '—'}</div>
                    </div>
                </div>
            </div>

            {brandOptions.length > 0 && (
                <div className="brand-filter">
                    <span className="brand-filter-label">Brand:</span>
                    <button type="button" className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>
                        ทุกแบรนด์ ({rows.length})
                    </button>
                    {brandOptions.map(b => (
                        <button type="button" key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>
                            {b} ({rows.filter(r => (r.brands || []).includes(b)).length})
                        </button>
                    ))}
                </div>
            )}

            <div className="panel no-pad">
                <div className="ka-table-scroll">
                    <table className="data-table hires-table">
                        <thead>
                            <tr>
                                <th>ชื่อผู้รับงาน</th><th>ประเภทงาน</th><th>สังกัด</th><th>ติดต่อ</th>
                                <th className="num">จำนวนงาน</th><th className="num">ค่าตัวล่าสุด</th><th className="num">ค่าตัวเฉลี่ย</th>
                                <th>งานล่าสุด</th><th>แบรนด์</th><th>แคมเปญ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!data ? (
                                <tr><td colSpan="10" className="empty">กำลังโหลด...</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan="10" className="empty">
                                    {rows.length === 0
                                        ? 'ยังไม่มีงานจ้างอื่น ๆ — กดปุ่ม "สร้างงานจ้าง" มุมขวาบนได้เลย'
                                        : 'ไม่พบผู้รับงานตามเงื่อนไขที่เลือก'}
                                </td></tr>
                            ) : shown.map(r => (
                                <tr key={r.key}>
                                    <td><strong>{r.name}</strong></td>
                                    <td>{r.kind ? <span className="proc-ctype-chip">{r.kind}</span> : <span className="muted">—</span>}</td>
                                    <td className="muted">{r.agency || '—'}</td>
                                    <td className="muted">{r.contact || '—'}</td>
                                    <td className="num">{r.jobs}</td>
                                    <td className="num">{B(r.last_fee)}</td>
                                    <td className="num muted">{B(r.avg_fee)}</td>
                                    <td className="muted">{fmtD(r.last_date)}</td>
                                    <td>{(r.brands || []).map(b => <span className="tag" key={b}>{b}</span>)}</td>
                                    <td className="muted">
                                        {(r.campaigns || []).map(c => (
                                            <Link className="act-project" key={c.id} to={`/projects/${c.id}`}>{c.name}</Link>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showForm && (
                <OtherProjectForm onClose={() => setShowForm(false)}
                    onSaved={p => { setShowForm(false); navigate(`/projects/${p.id}`); }} />
            )}
        </div>
    );
}
