import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import RateCardForm from '../../components/RateCardForm.jsx';
import RateAnswerModal from '../../components/RateAnswerModal.jsx';

// แท็บ "สอบถามราคา" — คำขอราคา KOL / Presenter (ตาราง rate_requests ไม่ผูกกับงานจ้าง)
// เปิดคำขอได้จากปุ่มบนแท็บนี้ที่เดียว — เดิมอยู่ในดรอปดาวน์ของฟอร์มงานจ้าง ทำให้เข้าใจผิดว่าเป็นส่วนหนึ่งของงาน
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtDT = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
};
const RATE_LABEL = { open: 'รอตอบ', answered: 'ตอบแล้ว', closed: 'ปิดแล้ว' };
const SHOW = [
    { key: 'open', label: 'รอตอบ' },
    { key: 'answered', label: 'ตอบแล้ว' },
    { key: 'closed', label: 'ปิดแล้ว' },
    { key: '', label: 'ทั้งหมด' }
];
const stOf = r => r.status || 'open';

export default function RatesTab({ onOpenCount }) {
    const [rates, setRates] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [brand, setBrand] = useState('');
    const [show, setShow] = useState(null);         // null = ตั้งตามข้อมูล (มีรอตอบ → รอตอบ · ไม่มี → ทั้งหมด)
    const [asking, setAsking] = useState(false);
    const [openRate, setOpenRate] = useState(null);
    const [sent, setSent] = useState(false);

    const load = useCallback(() => {
        api('/rate-requests').then(res => {
            const list = res.data || [];
            setRates(list); setError('');
            if (onOpenCount) onOpenCount(list.filter(r => stOf(r) === 'open').length);
        }).catch(err => setError(err.message));
    }, [onOpenCount]);
    useEffect(() => { load(); }, [load]);

    const rows = rates || [];
    const openCount = rows.filter(r => stOf(r) === 'open').length;
    const current = show === null ? (openCount > 0 ? 'open' : '') : show;
    const q = search.trim().toLowerCase();
    const matchBase = r => (!brand || r.brand === brand)
        && (!q || [r.kol_name, r.brand, r.created_by, r.scope, r.answer_note]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
    const shown = useMemo(() => rows.filter(r => matchBase(r) && (!current || stOf(r) === current)),
        [rows, brand, q, current]);   // eslint-disable-line react-hooks/exhaustive-deps
    const brandOptions = [...new Set(rows.map(r => r.brand).filter(Boolean))].sort();

    return (
        <div className="hub-tab">
            <div className="hub-toolbar">
                <button className="btn-primary" onClick={() => { setSent(false); setAsking(true); }}>
                    <Icon name="plus" size={16} /> สอบถามราคา
                </button>
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ KOL / แบรนด์ / คนขอ..." />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
            </div>

            {error && <div className="alert-error">{error}</div>}
            {sent && <div className="rate-sent-note">✓ ส่งคำขอสอบถามราคาแล้ว — รายการใหม่อยู่ในตารางด้านล่าง</div>}

            <div className="proc-platfilter">
                <span className="proc-platfilter-lbl">แสดง:</span>
                {SHOW.map(s => (
                    <button type="button" key={s.key || 'all'} className={'proc-plat-chip' + (current === s.key ? ' on' : '')}
                        onClick={() => setShow(s.key)}>
                        {s.label} ({rows.filter(r => matchBase(r) && (!s.key || stOf(r) === s.key)).length})
                    </button>
                ))}
            </div>

            {brandOptions.length > 1 && (
                <div className="brand-filter">
                    <span className="brand-filter-label">Brand:</span>
                    <button type="button" className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>ทุกแบรนด์</button>
                    {brandOptions.map(b => (
                        <button type="button" key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>{b}</button>
                    ))}
                </div>
            )}

            <div className="panel no-pad">
                <div className="ka-table-scroll">
                    <table className="data-table tasks-table">
                        <thead>
                            <tr>
                                <th>วันที่ขอ</th><th>ประเภท</th><th>ชื่อ</th><th>แบรนด์</th><th>ช่องทาง / สื่อ</th>
                                <th className="num">งบที่ตั้งไว้</th><th className="num">ราคาที่ได้</th>
                                <th>สถานะ</th><th>คนขอ</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {!rates ? (
                                <tr><td colSpan="10" className="empty">กำลังโหลด...</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan="10" className="empty">
                                    {rows.length === 0
                                        ? 'ยังไม่มีคำขอสอบถามราคา — กด "สอบถามราคา" ด้านบนได้เลย'
                                        : 'ไม่พบคำขอตามเงื่อนไขที่เลือก'}
                                </td></tr>
                            ) : shown.map(r => {
                                const st = stOf(r);
                                return (
                                    <tr key={r.id}>
                                        <td className="muted">{fmtDT(r.created_at)}</td>
                                        <td>
                                            <span className={'rate-type-chip' + (r.request_type === 'presenter' ? '' : ' kol')}>
                                                {r.request_type === 'presenter' ? 'Presenter' : 'KOL'}
                                            </span>
                                        </td>
                                        <td>
                                            <strong>{r.kol_name}</strong>
                                            {r.contract_period && <span className="cast-sub">สัญญา {r.contract_period}</span>}
                                            {r.scope && <span className="cast-sub">{r.scope}</span>}
                                        </td>
                                        <td>{r.brand ? <span className="tag">{r.brand}</span> : <span className="muted">—</span>}</td>
                                        <td className="muted">{(Array.isArray(r.platforms) ? r.platforms : []).join(' · ') || '—'}</td>
                                        <td className="num">{r.no_budget ? <span className="muted">ไม่กำหนด</span> : B(r.budget)}</td>
                                        <td className="num">
                                            {r.quoted_rate == null ? <span className="muted">—</span> : <strong>{B(r.quoted_rate)}</strong>}
                                            {r.answered_by && <span className="cast-sub">โดย {r.answered_by}</span>}
                                        </td>
                                        <td><span className={'tag' + (st === 'open' ? ' warn' : '')}>{RATE_LABEL[st] || st}</span></td>
                                        <td className="muted">{r.created_by || '—'}</td>
                                        <td><button type="button" className="btn-ghost" onClick={() => setOpenRate(r)}>
                                            {st === 'open' ? 'ตอบราคา' : 'ดู / แก้คำตอบ'}
                                        </button></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {asking && (
                <RateCardForm onClose={() => setAsking(false)}
                    onSaved={() => { setAsking(false); setSent(true); setShow(null); load(); }} />
            )}

            {openRate && (
                <RateAnswerModal item={openRate}
                    onClose={() => setOpenRate(null)}
                    onSaved={saved => { setOpenRate(saved || null); load(); }} />
            )}
        </div>
    );
}
