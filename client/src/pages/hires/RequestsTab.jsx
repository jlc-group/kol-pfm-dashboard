import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import HireRequestModal from '../../components/HireRequestModal.jsx';
import { STAGE_LABEL } from '../../components/OtherProjectForm.jsx';

// แท็บ "ใบขอจัดหา" — คิวงานข้ามทุกงาน บอกว่าแต่ละใบ "ถึงตาใคร"
// แท็บนี้ไม่มีปุ่มแก้/ลบ/อนุมัติของตัวเอง ทุกอย่างทำที่การ์ดของใบ (บ้านเดียวของการกระทำกับใบ):
//  • คนที่มีสิทธิ์แบรนด์ → พาไปที่การ์ดในหน้างาน (เห็นงบและคนที่มีอยู่แล้วประกอบการอนุมัติ)
//  • คนหาที่ไม่มีสิทธิ์แบรนด์ → เปิดการ์ดใบเดียวกันในกล่อง (เสนอชื่อได้อย่างเดียว)
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};
const MINE = [
    { key: 'todo', label: 'รอฉันทำ' },
    { key: 'find', label: 'ที่ฉันต้องหา' },
    { key: 'ask', label: 'ที่ฉันขอไว้' },
    { key: '', label: 'ทั้งหมด' }
];

// ข้อความ "รอใคร" ของแต่ละใบ — เป็นเราเองให้เขียนว่า "คุณ" จะได้เห็นทันทีว่าต้องทำอะไร
function waitingText(r) {
    const todo = r.todo || [];
    if (todo.includes('fee')) return `คุณ · อนุมัติค่าตัวใหม่ ${r.fee_review} คน`;
    if (todo.includes('confirm') && !todo.includes('find')) return `คุณ · คอนเฟิร์มคิว ${r.booking_pending} คน`;
    if (r.stage === 'deciding' && todo.includes('find')) return `คุณ · หาเพิ่มอีก ${r.need_more} คน`;
    if (r.stage === 'booking') {
        // ใบที่ไม่มีคนหา → ทีมแบรนด์ (คนขอ) คอนเฟิร์มเอง
        const noFinder = r.assignee_id == null || r.assignee_id === '';
        return `${r.is_assignee || (noFinder && r.is_requester) ? 'คุณ' : noFinder ? 'ทีมแบรนด์' : (r.assignee_name || 'คนหา')} · คอนเฟิร์มคิว`;
    }
    if (r.stage === 'fee') return 'ทีมแบรนด์ · อนุมัติค่าตัวใหม่';
    if (r.waiting_on === 'assign') return r.is_requester ? 'คุณ · มอบหมายคนหา' : 'ทีมแบรนด์ · มอบหมายคนหา';
    if (r.waiting_on === 'finder') return r.is_assignee ? 'คุณ · หาคน' : `${r.assignee_name || 'คนหา'} · หาคน`;
    if (r.waiting_on === 'team') return r.is_requester ? 'คุณ · อนุมัติชื่อ' : 'ทีมแบรนด์ · อนุมัติชื่อ';
    return '—';
}

export default function RequestsTab({ counts, hasBrand = true }) {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [brand, setBrand] = useState('');
    const [mine, setMine] = useState(null);          // null = ยังไม่ได้เลือก (ตั้งตามข้อมูลตอนโหลดเสร็จ)
    const [hideDone, setHideDone] = useState(true);
    const [open, setOpen] = useState(null);          // ใบที่เปิดในกล่อง (คนหาที่ไม่มีสิทธิ์แบรนด์)

    const load = useCallback(() => {
        api('/hires/tasks').then(res => { setData(res.data); setError(''); }).catch(err => setError(err.message));
    }, []);
    useEffect(() => { load(); }, [load]);
    // ตัวเลขแดงเปลี่ยน (เช่นมีคนเสนอชื่อ/อนุมัติจากที่อื่น) → โหลดคิวใหม่ด้วย ไม่ให้เลขกับตารางไม่ตรงกัน
    useEffect(() => {
        window.addEventListener('kol:hire-tasks-changed', load);
        return () => window.removeEventListener('kol:hire-tasks-changed', load);
    }, [load]);

    const rows = data?.rows || [];
    const todoCount = rows.filter(r => r.my_todo).length;
    const current = mine === null ? (todoCount > 0 ? 'todo' : '') : mine;

    // ลิงก์ที่คัดลอกจากการ์ด (?open=<งาน>~<ใบ>) — คนมีสิทธิ์แบรนด์ไปที่การ์ดในหน้างาน · คนหาเปิดกล่อง
    const openParam = params.get('open');
    useEffect(() => {
        if (!openParam || !data) return;
        const [pid, key] = String(openParam).split('~');
        const hit = rows.find(r => String(r.project_id) === pid && String(r.key) === key);
        if (!hit) {
            setError('ไม่พบใบขอจัดหาจากลิงก์นี้ — ใบอาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เปิดใบนี้');
            setParams({ tab: 'requests' }, { replace: true });
            return;
        }
        if (hit.in_brand) navigate(`/projects/${hit.project_id}#req-${hit.key}`, { replace: true });
        else setOpen(hit);
    }, [openParam, data]);   // eslint-disable-line react-hooks/exhaustive-deps

    const q = search.trim().toLowerCase();
    const matchBase = r => (!brand || r.brand === brand)
        && (!q || [r.project_name, r.brand, r.kind, r.spec, r.assignee_name, r.place]
            .some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
    const done = r => r.stage === 'full' || r.stage === 'closed';
    const matchMine = (r, key) => (key === 'todo' ? r.my_todo
        : key === 'find' ? r.is_assignee
            : key === 'ask' ? r.is_requester : true);
    // "รอฉันทำ" ไม่มีใบที่จบแล้วอยู่แล้ว · ชิปอื่นซ่อนใบที่จบแล้วตามช่องติ๊ก
    const visible = (r, key) => matchBase(r) && matchMine(r, key) && (key === 'todo' || !hideDone || !done(r));
    const shown = useMemo(() => rows.filter(r => visible(r, current)),
        [rows, current, brand, q, hideDone]);   // eslint-disable-line react-hooks/exhaustive-deps

    const needed = shown.reduce((n, r) => n + (r.stage === 'closed' ? 0 : Number(r.remaining) || 0), 0);
    const waiting = shown.reduce((n, r) => n + (r.remaining > 0 && r.stage !== 'closed' ? Number(r.waiting_count) || 0 : 0), 0);
    const overdue = shown.filter(r => r.overdue).length;
    const brandOptions = [...new Set(rows.map(r => r.brand).filter(Boolean))].sort();

    function closeModal() {
        setOpen(null);
        if (openParam) setParams({ tab: 'requests' }, { replace: true });
    }

    const reason = counts
        ? [counts.to_find ? `หาคน ${counts.to_find}` : '', counts.to_decide ? `อนุมัติชื่อ ${counts.to_decide}` : '', counts.to_assign ? `มอบหมายคนหา ${counts.to_assign}` : '',
            counts.to_confirm ? `คอนเฟิร์มคิว ${counts.to_confirm}` : '', counts.to_fee ? `อนุมัติค่าตัวใหม่ ${counts.to_fee}` : '']
            .filter(Boolean).join(' · ')
        : '';

    return (
        <div className="hub-tab">
            <div className="hub-toolbar">
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหางาน / ประเภทงาน / สเปค / คนหา..." />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
                {hasBrand && (
                    <span className="hub-hint">เปิดใบขอจัดหาใหม่ได้ในงาน: แท็บงานจ้าง → เปิดงาน → แก้ไข / เพิ่มคน → เลือก "ให้ช่วยจัดหา"</span>
                )}
            </div>

            {error && <div className="alert-error">{error}</div>}

            <div className="ka-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ใบที่แสดง</div>
                        <div className="ka-sum-v">{data ? shown.length : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico blue"><Icon name="team" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ยังต้องหาอีก / ชื่อรออนุมัติ</div>
                        <div className="ka-sum-v">{data ? `${needed} คน / ${waiting} ชื่อ` : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico amber"><Icon name="history" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">เลยกำหนดส่งรายชื่อ</div>
                        <div className="ka-sum-v">{data ? `${overdue} ใบ` : '—'}</div>
                    </div>
                </div>
            </div>

            <div className="proc-platfilter">
                <span className="proc-platfilter-lbl">แสดง:</span>
                {MINE.map(m => (
                    <button type="button" key={m.key || 'all'}
                        className={'proc-plat-chip' + (current === m.key ? ' on' : '') + (m.key === 'todo' && todoCount > 0 ? ' alert' : '')}
                        title={m.key === 'todo' && reason ? reason : undefined}
                        onClick={() => setMine(m.key)}>
                        {m.label} ({rows.filter(r => visible(r, m.key)).length})
                    </button>
                ))}
                {current !== 'todo' && (
                    <label className="hub-check">
                        <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
                        ซ่อนใบที่ได้ครบแล้ว / งานปิดแล้ว
                    </label>
                )}
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
                                <th>ขั้นตอน</th><th>รอใคร</th><th>งาน</th><th>ประเภทงาน</th>
                                <th className="num">ต้องหาอีก</th><th className="num">งบต่อคน</th>
                                <th>วันใช้งาน</th><th>กำหนดส่งรายชื่อ</th><th>คนหา</th><th>ชื่อที่เสนอ</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {!data ? (
                                <tr><td colSpan="11" className="empty">กำลังโหลด...</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan="11" className="empty">
                                    {rows.some(r => matchMine(r, current)) && current !== 'todo'
                                        // มีใบอยู่แต่ถูกซ่อน/กรองออก — อย่าบอกว่า "ยังไม่มีใบ"
                                        ? (hideDone ? 'ไม่พบใบตามเงื่อนไขที่เลือก — ใบที่ได้ครบแล้ว / งานปิดแล้วถูกซ่อนอยู่ (เอาติ๊กออกเพื่อดู)' : 'ไม่พบใบตามเงื่อนไขที่เลือก')
                                        : current === 'todo' ? 'ไม่มีใบที่ถึงตาคุณตอนนี้'
                                            : current === 'find' ? 'ยังไม่มีใบขอจัดหาที่มอบหมายให้คุณ'
                                                : current === 'ask' ? 'คุณยังไม่ได้เปิดใบขอจัดหาไว้'
                                                    : !hasBrand ? 'ยังไม่มีใบขอจัดหาที่มอบหมายให้คุณ'
                                                        : 'ยังไม่มีใบขอจัดหา — เปิดได้ในงาน: แท็บงานจ้าง → เปิดงาน → แก้ไข / เพิ่มคน → เลือก "ให้ช่วยจัดหา"'}
                                </td></tr>
                            ) : shown.map(r => (
                                <tr key={`${r.project_id}-${r.key}`} className={r.my_todo ? 'row-todo' : ''}>
                                    <td>
                                        <span className={'stage-chip st-' + r.stage}>{STAGE_LABEL[r.stage] || r.stage}</span>
                                        {r.overdue && <span className="stage-chip st-late">เลยกำหนด</span>}
                                    </td>
                                    <td className={r.my_todo ? 'req-mine' : 'muted'}>
                                        {waitingText(r)}
                                        {r.stage === 'deciding' && (r.todo || []).includes('find') ? (
                                            <span className="cast-sub">ทีมแบรนด์กำลังพิจารณา {r.waiting_count} ชื่อ</span>
                                        ) : r.stage === 'deciding' && r.need_more > 0 ? (
                                            <span className="cast-sub">คนหายังต้องหาเพิ่มอีก {r.need_more} คน</span>
                                        ) : null}
                                        {/* ใบที่ยังขาดคนแต่มีคนที่อนุมัติแล้วรอคอนเฟิร์มอยู่ด้วย — บอกไว้ไม่ให้หลุดสายตา */}
                                        {r.stage !== 'booking' && r.stage !== 'fee' && r.stage !== 'closed' && (r.booking_pending > 0 || r.fee_review > 0) && (
                                            <span className="cast-sub">
                                                {[r.booking_pending ? `รอคอนเฟิร์มคิว ${r.booking_pending} คน` : '', r.fee_review ? `รออนุมัติค่าตัวใหม่ ${r.fee_review} คน` : ''].filter(Boolean).join(' · ')}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        {r.in_brand
                                            ? <Link className="act-project" to={`/projects/${r.project_id}`}>{r.project_name}</Link>
                                            : <span title="งานของแบรนด์อื่น — เปิดใบเพื่อดูรายละเอียดของใบนี้">{r.project_name}</span>}
                                        {r.brand && <span className="cast-sub">{r.brand}</span>}
                                    </td>
                                    <td>{r.kind ? <span className="proc-ctype-chip">{r.kind}</span> : <span className="muted">—</span>}</td>
                                    <td className="num">
                                        {r.remaining > 0 ? <strong>{r.remaining}</strong> : <span className="muted">ครบแล้ว</span>}
                                        <span className="cast-sub">จาก {r.headcount} คน</span>
                                    </td>
                                    <td className="num">{B(r.fee)}</td>
                                    <td className="muted">{fmtD(r.use_date)}</td>
                                    <td className={r.overdue ? 'req-late' : 'muted'}>{fmtD(r.deadline)}</td>
                                    <td className="muted">{r.assignee_name || <span className="ctype-none">— ยังไม่มอบหมาย —</span>}</td>
                                    <td>
                                        {r.candidate_count > 0 ? (
                                            <span className={'tag' + (r.waiting_count && r.remaining > 0 ? ' warn' : '')}>
                                                {r.candidate_count} ชื่อ
                                                {r.waiting_count && r.remaining > 0 && r.stage !== 'closed' ? ` · รออนุมัติ ${r.waiting_count}` : ''}
                                                {r.waiting_count && r.remaining <= 0 ? ` · ตัวสำรอง ${r.waiting_count}` : ''}
                                                {r.rejected_count ? ` · ไม่ผ่าน ${r.rejected_count}` : ''}
                                            </span>
                                        ) : <span className="muted">—</span>}
                                    </td>
                                    <td>
                                        {r.in_brand ? (
                                            <Link className="btn-ghost req-go" to={`/projects/${r.project_id}#req-${r.key}`}>
                                                ไปที่ใบ →
                                            </Link>
                                        ) : (
                                            <button type="button" className="btn-ghost req-go" onClick={() => setOpen(r)}>
                                                เปิดใบ / เสนอชื่อ
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {open && (
                <HireRequestModal request={open} canDecide={false} canPropose
                    onClose={closeModal} onSaved={load} />
            )}
        </div>
    );
}
