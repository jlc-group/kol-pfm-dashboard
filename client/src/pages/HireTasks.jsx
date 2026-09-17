import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import HireRequestModal from '../components/HireRequestModal.jsx';
import OtherProjectForm from '../components/OtherProjectForm.jsx';
import RateAnswerModal from '../components/RateAnswerModal.jsx';
import HireRequestEditModal from '../components/HireRequestEditModal.jsx';

// หน้า "งานจัดหา" — งานที่ทีมเปิดไว้ให้คนอื่นไปหา/ไปถามมาให้ รวมสองอย่างไว้ที่เดียว
//  • ใบขอจัดหา  = ต้องไปหาตัวคน (มาจากแถว "ให้ช่วยจัดหา" ในงานจ้างอื่น ๆ)
//  • สอบถามราคา = ต้องไปถามเรทของ KOL มาให้ก่อนตัดสินใจจ้าง
// แยกออกมาเป็นหน้าของตัวเองเพราะคนทำงานพวกนี้ไม่ได้ไล่เปิดทีละแคมเปญ เขาต้องเห็นงานค้างของตัวเองในหน้าเดียว
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};
const fmtDT = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
};
const today = () => new Date().toISOString().slice(0, 10);
const RATE_LABEL = { open: 'รอตอบ', answered: 'ตอบแล้ว', closed: 'ปิดแล้ว' };

export default function HireTasks() {
    const navigate = useNavigate();
    const [kind, setKind] = useState('cast');   // cast = ใบขอจัดหา · rate = สอบถามราคา
    const [mine, setMine] = useState('find');   // find = ที่ฉันต้องหา · ask = ที่ฉันขอไว้ · '' = ทั้งหมด
    const [data, setData] = useState(null);
    const [rates, setRates] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [brand, setBrand] = useState('');
    const [open, setOpen] = useState(null);       // ใบขอจัดหาที่กำลังเปิดดู
    const [openRate, setOpenRate] = useState(null); // คำขอราคาที่กำลังเปิดตอบ
    const [newOther, setNewOther] = useState(false);
    const [editReq, setEditReq] = useState(null);   // ใบขอจัดหาที่กำลังแก้
    const [delReq, setDelReq] = useState(null);     // ใบขอจัดหาที่กำลังจะลบ
    const [deleting, setDeleting] = useState(false);
    const [rowErr, setRowErr] = useState('');

    async function removeRequest() {
        setDeleting(true); setRowErr('');
        try {
            await api(`/projects/${delReq.project_id}/hires/${delReq.key}`, { method: 'DELETE' });
            window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
            setDelReq(null);
            load();
        } catch (e) { setRowErr(e.message); }
        finally { setDeleting(false); }
    }

    const load = useCallback(() => {
        api('/hires/tasks').then(res => { setData(res.data); setError(''); }).catch(err => setError(err.message));
    }, []);
    const loadRates = useCallback(() => {
        api('/rate-requests').then(res => { setRates(res.data || []); setError(''); }).catch(err => setError(err.message));
    }, []);
    useEffect(() => { load(); loadRates(); }, [load, loadRates]);

    const rows = data?.rows || [];
    const rateRows = rates || [];
    const q = search.trim().toLowerCase();
    // ตัวเลขบนชิปต้องนับจากชุดเดียวกับที่ตารางโชว์ (ตัวเลขแดงบนเมนูเป็นอีกความหมาย: นับเฉพาะงานที่ยังค้าง)
    const matchRow = r => (!brand || r.brand === brand)
        && (!q || [r.project_name, r.brand, r.kind, r.spec, r.assignee_name, r.place]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
    const nFind = rows.filter(r => r.is_assignee && matchRow(r)).length;
    const nAsk = rows.filter(r => r.is_requester && matchRow(r)).length;
    const nAll = rows.filter(matchRow).length;

    // กรองในหน้าเว็บ (ข้อมูลชุดเล็ก) — server กรองสิทธิ์แบรนด์ให้แล้วชั้นหนึ่ง
    const shown = useMemo(() => rows.filter(r =>
        (!mine || (mine === 'find' ? r.is_assignee : r.is_requester))
        && (!brand || r.brand === brand)
        && (!q || [r.project_name, r.brand, r.kind, r.spec, r.assignee_name, r.place]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)))), [rows, mine, brand, q]);

    const shownRates = useMemo(() => rateRows.filter(r =>
        (!brand || r.brand === brand)
        && (!q || [r.kol_name, r.brand, r.created_by, r.scope, r.answer_note]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)))), [rateRows, brand, q]);

    const needed = shown.reduce((n, r) => n + (Number(r.remaining) || 0), 0);
    const budget = shown.reduce((n, r) => n + (Number(r.budget) || 0), 0);
    const waiting = shown.reduce((n, r) => n + (Number(r.waiting_count) || 0), 0);
    const rateOpen = shownRates.filter(r => (r.status || 'open') === 'open').length;
    const rateAnswered = shownRates.filter(r => r.status === 'answered').length;

    const brandOptions = [...new Set(
        (kind === 'cast' ? rows : rateRows).map(r => r.brand).filter(Boolean)
    )].sort();

    return (
        <div>
            <header className="page-head with-action">
                <div>
                    <h1>งานจัดหา</h1>
                    <p className="page-sub">ใบขอจัดหานางแบบ / นักแสดง / Live สด และคำขอสอบถามราคา KOL / Presenter</p>
                </div>
                <div className="ka-top-filters">
                    <button className="btn-primary" onClick={() => setNewOther(true)}>
                        <Icon name="plus" size={16} /> สร้างงานจ้าง
                    </button>
                    <div className="ka-search">
                        <Icon name="search" size={15} />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                            placeholder={kind === 'cast' ? 'ค้นหาแคมเปญ / ประเภทงาน / สเปค...' : 'ค้นหาชื่อ KOL / แบรนด์ / คนขอ...'} />
                        {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                    </div>
                </div>
            </header>

            {error && <div className="alert-error">{error}</div>}
            {rowErr && <div className="alert-error">{rowErr}</div>}

            <div className="agency-tabs">
                <button className={kind === 'cast' ? 'active' : ''} onClick={() => { setKind('cast'); setBrand(''); }}>
                    ใบขอจัดหา <span className="agency-tab-count">{rows.length}</span>
                </button>
                <button className={kind === 'rate' ? 'active' : ''} onClick={() => { setKind('rate'); setBrand(''); }}>
                    สอบถามราคา {rateOpen > 0
                        ? <span className="agency-tab-count warn">{rateOpen}</span>
                        : <span className="agency-tab-count">{rateRows.length}</span>}
                </button>
            </div>

            <div className="ka-summary">
                {kind === 'cast' ? (
                    <>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">ใบขอจัดหา</div>
                                <div className="ka-sum-v">{data ? shown.length : '—'}</div>
                            </div>
                        </div>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico blue"><Icon name="team" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">ยังต้องหาอีก</div>
                                <div className="ka-sum-v">{data ? `${needed} คน` : '—'}</div>
                            </div>
                        </div>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico amber"><Icon name="coins" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">งบที่ตั้งไว้</div>
                                <div className="ka-sum-v">{data ? B(budget) : '—'}</div>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">คำขอทั้งหมด</div>
                                <div className="ka-sum-v">{rates ? shownRates.length : '—'}</div>
                            </div>
                        </div>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico amber"><Icon name="history" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">รอตอบ</div>
                                <div className="ka-sum-v">{rates ? rateOpen : '—'}</div>
                            </div>
                        </div>
                        <div className="ka-sum-card">
                            <div className="ka-sum-ico blue"><Icon name="check" size={22} /></div>
                            <div>
                                <div className="ka-sum-k">ตอบแล้ว</div>
                                <div className="ka-sum-v">{rates ? rateAnswered : '—'}</div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {kind === 'cast' && (
                <div className="proc-platfilter">
                    <span className="proc-platfilter-lbl">แสดง:</span>
                    <button type="button" className={'proc-plat-chip' + (mine === 'find' ? ' on' : '')}
                        onClick={() => setMine('find')}>ที่ฉันต้องหา ({nFind})</button>
                    <button type="button" className={'proc-plat-chip' + (mine === 'ask' ? ' on' : '')}
                        onClick={() => setMine('ask')}>ที่ฉันขอไว้ ({nAsk})</button>
                    <button type="button" className={'proc-plat-chip' + (mine === '' ? ' on' : '')}
                        onClick={() => setMine('')}>ทั้งหมด ({nAll})</button>
                </div>
            )}

            {kind === 'cast' && mine === 'ask' && waiting > 0 && (
                <div className="req-hint">มีคนเสนอชื่อมาแล้ว {waiting} ชื่อ รอให้คุณเลือก</div>
            )}

            {brandOptions.length > 0 && (
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
                    {kind === 'cast' ? (
                        <table className="data-table tasks-table">
                            <thead>
                                <tr>
                                    <th>แคมเปญ</th><th>แบรนด์</th><th>ประเภทงาน</th>
                                    <th className="num">ต้องหาอีก</th><th className="num">งบต่อคน</th>
                                    <th>วันที่ใช้งาน</th><th>กำหนดส่งรายชื่อ</th>
                                    <th>ผู้รับผิดชอบ</th><th>เสนอมาแล้ว</th><th>สถานะ</th><th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {!data ? (
                                    <tr><td colSpan="11" className="empty">กำลังโหลด...</td></tr>
                                ) : shown.length === 0 ? (
                                    <tr><td colSpan="11" className="empty">
                                        {mine === 'find' ? 'ยังไม่มีใบขอจัดหาที่มอบหมายให้คุณ'
                                            : mine === 'ask' ? 'คุณยังไม่ได้เปิดใบขอจัดหาไว้'
                                                : 'ยังไม่มีใบขอจัดหา — กดปุ่ม "สร้างงานจ้าง" มุมขวาบน แล้วเลือกรูปแบบ "ให้ช่วยจัดหา"'}
                                    </td></tr>
                                ) : shown.map(r => {
                                    const late = r.deadline && r.remaining > 0 && r.deadline < today();
                                    return (
                                        <tr key={`${r.project_id}-${r.key}`}>
                                            <td>
                                                {r.in_brand
                                                    ? <Link className="act-project" to={`/projects/${r.project_id}`}>{r.project_name}</Link>
                                                    : <span className="muted" title="แคมเปญของแบรนด์อื่น — กดเปิดใบเพื่อดูรายละเอียดงานนี้">{r.project_name}</span>}
                                            </td>
                                            <td>{r.brand ? <span className="tag">{r.brand}</span> : <span className="muted">—</span>}</td>
                                            <td>{r.kind ? <span className="proc-ctype-chip">{r.kind}</span> : <span className="muted">—</span>}</td>
                                            <td className="num">
                                                {r.remaining > 0 ? <strong>{r.remaining}</strong> : <span className="muted">ครบแล้ว</span>}
                                                <span className="cast-sub">จาก {r.headcount} คน</span>
                                            </td>
                                            <td className="num">{B(r.fee)}</td>
                                            <td className="muted">{fmtD(r.use_date)}</td>
                                            <td className={late ? 'req-late' : 'muted'}>
                                                {fmtD(r.deadline)}{late ? ' · เลยกำหนด' : ''}
                                            </td>
                                            <td className="muted">{r.assignee_name || <span className="ctype-none">— ยังไม่มอบหมาย —</span>}</td>
                                            <td>
                                                {r.candidate_count > 0
                                                    ? <span className={'tag' + (r.waiting_count ? ' warn' : '')}>{r.candidate_count} ชื่อ{r.waiting_count ? ` · รอ ${r.waiting_count}` : ''}</span>
                                                    : <span className="muted">—</span>}
                                            </td>
                                            <td><span className="tag">{r.status}</span></td>
                                            <td>
                                                <div className="row-actions">
                                                    <button type="button" className="btn-ghost" onClick={() => setOpen(r)}>เปิดใบ</button>
                                                    {/* แก้/ลบได้เฉพาะฝั่งคนขอ (คนที่มีสิทธิ์ในแบรนด์ของแคมเปญนี้) — คนจัดหาแตะใบไม่ได้ */}
                                                    {r.in_brand && (
                                                        <button type="button" className="icon-btn" title="แก้ไขใบขอจัดหา" onClick={() => setEditReq(r)}>
                                                            <Icon name="edit" size={14} />
                                                        </button>
                                                    )}
                                                    {r.in_brand && (
                                                        <button type="button" className="icon-btn danger" title="ลบใบขอจัดหา" onClick={() => setDelReq(r)}>
                                                            <Icon name="trash" size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
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
                                ) : shownRates.length === 0 ? (
                                    <tr><td colSpan="10" className="empty">
                                        ยังไม่มีคำขอสอบถามราคา — เปิดได้จากฟอร์มงานจ้าง เลือก "สอบถามราคา..." ในช่องรูปแบบการจ้าง
                                    </td></tr>
                                ) : shownRates.map(r => {
                                    const st = r.status || 'open';
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
                    )}
                </div>
            </div>

            {newOther && (
                <OtherProjectForm onClose={() => setNewOther(false)}
                    onSaved={p => { setNewOther(false); navigate(`/projects/${p.id}`); }} />
            )}

            {open && (
                <HireRequestModal
                    request={open}
                    canDecide={!!open.in_brand}
                    canPropose={!!open.is_assignee || !!open.in_brand}
                    onClose={() => setOpen(null)}
                    onSaved={load} />
            )}

            {editReq && (
                <HireRequestEditModal request={editReq}
                    onClose={() => setEditReq(null)}
                    onSaved={() => { setEditReq(null); load(); window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed')); }} />
            )}

            {delReq && (
                <div className="modal-backdrop" onClick={() => !deleting && setDelReq(null)}>
                    <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>ลบใบขอจัดหานี้?</h3>
                        <p>
                            {delReq.kind || 'ใบขอจัดหา'} ของ “{delReq.project_name}”
                            {delReq.candidate_count > 0 ? ` · รายชื่อที่เสนอไว้ ${delReq.candidate_count} ชื่อจะหายไปด้วย` : ''}
                            {delReq.filled > 0 ? ` · คนที่เลือกไปแล้ว ${delReq.filled} คนยังอยู่ในงานจ้างตามเดิม` : ''}
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={deleting} onClick={() => setDelReq(null)}>ยกเลิก</button>
                            <button type="button" className="btn-danger" disabled={deleting} onClick={removeRequest}>
                                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {openRate && (
                <RateAnswerModal item={openRate}
                    onClose={() => setOpenRate(null)}
                    onSaved={saved => { setOpenRate(saved || null); loadRates(); }} />
            )}
        </div>
    );
}
