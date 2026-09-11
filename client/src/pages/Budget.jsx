import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import { fmtRange } from '../utils/date.js';

const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];
const MONTHS = [
    ['01', 'มกราคม'], ['02', 'กุมภาพันธ์'], ['03', 'มีนาคม'], ['04', 'เมษายน'],
    ['05', 'พฤษภาคม'], ['06', 'มิถุนายน'], ['07', 'กรกฎาคม'], ['08', 'สิงหาคม'],
    ['09', 'กันยายน'], ['10', 'ตุลาคม'], ['11', 'พฤศจิกายน'], ['12', 'ธันวาคม'],
];
const fmt = n => (Number(n) || 0).toLocaleString('th-TH');

export default function Budget() {
    const navigate = useNavigate();
    const [brand, setBrand] = useState('');
    const [year, setYear] = useState('');
    const [month, setMonth] = useState('');
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const q = new URLSearchParams();
        if (brand) q.set('brand', brand);
        api(`/stats/reports?${q.toString()}`)
            .then(res => setRows(res.data))
            .catch(err => setError(err.message));
    }, [brand]);

    // ปีที่เลือกได้ = ปีที่มีแคมเปญจริงเท่านั้น (ดูจากวันเริ่มแคมเปญ)
    const years = useMemo(() => {
        const ys = [...new Set((rows || []).map(r => (r.start_date || '').slice(0, 4)).filter(Boolean))];
        return ys.sort((a, b) => b.localeCompare(a));
    }, [rows]);

    // กรองด้วย "วันเริ่มแคมเปญ" — แคมเปญที่ยังไม่ระบุวันเริ่มจะไม่เข้าเงื่อนไขเมื่อมีการกรอง
    const shown = (rows || []).filter(r => {
        const d = r.start_date || '';
        return (!year || d.slice(0, 4) === year) && (!month || d.slice(5, 7) === month);
    });
    const filtering = !!(brand || year || month);

    return (
        <div>
            <header className="page-head">
                <h1>Campaign Reports</h1>
                <p className="page-sub">เลือกแคมเปญเพื่อดูรายงาน</p>
            </header>

            {/* ฟิลเตอร์: แบรนด์ + ปี + เดือน (ปี/เดือน ดูจากวันเริ่มแคมเปญ) */}
            <div className="brand-filter report-filters">
                <span className="brand-filter-label">▼ แบรนด์:</span>
                <select className="campaign-select" value={brand} onChange={e => setBrand(e.target.value)}>
                    <option value="">ทุกแบรนด์</option>
                    {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>

                <span className="brand-filter-label">ปี:</span>
                <select className="campaign-select" value={year} onChange={e => setYear(e.target.value)}>
                    <option value="">ทุกปี</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <span className="brand-filter-label">เดือน:</span>
                <select className="campaign-select" value={month} onChange={e => setMonth(e.target.value)}>
                    <option value="">ทุกเดือน</option>
                    {MONTHS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>

                {filtering && (
                    <button type="button" className="brand-chip" onClick={() => { setBrand(''); setYear(''); setMonth(''); }}>
                        ล้างตัวกรอง
                    </button>
                )}
            </div>

            {error && <div className="alert-error">{error}</div>}

            <h3 className="report-section-title">Select Campaign to Report</h3>

            {!rows ? (
                <div className="panel"><p className="empty">กำลังโหลด...</p></div>
            ) : shown.length === 0 ? (
                <div className="panel">
                    <div className="empty-illus">
                        <div className="empty-illus-icon"><Icon name="bars" size={28} /></div>
                        <div className="empty-illus-title">ยังไม่มีแคมเปญให้รายงาน</div>
                        <p className="empty-illus-sub">
                            {filtering ? 'ไม่มีแคมเปญที่ตรงกับตัวกรองที่เลือก ลองล้างตัวกรองดู' : 'เมื่อมีแคมเปญในระบบ จะแสดงการ์ดรายงานที่นี่'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="report-grid">
                    {shown.map(r => (
                        <div className="report-card" key={r.id}>
                            <div className="report-card-head">
                                <h3 className="report-card-name">{r.name}</h3>
                                <span className={`report-status st-${r.status}`}>{r.status}</span>
                            </div>
                            <div className="report-card-dates">{fmtRange(r.start_date, r.end_date)}</div>

                            <div className="report-metrics">
                                <div className="rm">
                                    <div className="rm-label">KOLS</div>
                                    <div className="rm-val pink">{fmt(r.kols)}</div>
                                </div>
                                <div className="rm">
                                    <div className="rm-label">BUDGET</div>
                                    <div className="rm-val blue">{fmt(r.budget)}</div>
                                </div>
                                <div className="rm">
                                    <div className="rm-label">USED</div>
                                    <div className="rm-val red">{fmt(r.used)}</div>
                                </div>
                                <div className="rm">
                                    <div className="rm-label">POST RATE</div>
                                    <div className="rm-val green">{r.post_rate}%</div>
                                </div>
                            </div>

                            <button className="report-view-btn" onClick={() => navigate(`/reports/${r.id}`)}>
                                <Icon name="bars" size={15} /> View Report
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
