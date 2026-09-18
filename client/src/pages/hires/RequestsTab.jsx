import { useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { T, STAGE_LABEL, baht } from '../../data/talentLabels.js';
import { fmtD, whoShort, countsTip, candsOf, isUnavailNote } from './requestText.js';

// แท็บ "ใบขอให้หา" — ตารางใบขอให้หาทุกใบข้ามงาน บอกว่าแต่ละใบ "ถึงตาใคร"
// แท็บนี้แสดงอย่างเดียว: ข้อมูลมาจากหน้าแม่ (ชุดเดียวกับเลขแดง/หน้าหลัก) และกดแถวไหนก็เปิดลิ้นชักของใบนั้นบนหน้าเดิม
// ทุกการกระทำกับใบทำในการ์ดของลิ้นชัก (บ้านเดียวของการกระทำกับใบ) — ไม่พาไปหน้างาน กดปิดแล้วกลับมาที่ตารางเดิม
// ชื่อที่ไม่ได้ไปต่อ แยก "ทีมไม่เอา" กับ "คนนี้มาไม่ได้" (server เก็บเป็น status เดียวกัน ต่างกันที่ note)
const rejectedOf = r => candsOf(r).filter(c => c && c.status === 'ไม่เอา' && !isUnavailNote(c.decided_note)).length;
const unavailOf = r => candsOf(r).filter(c => c && c.status === 'ไม่เอา' && isUnavailNote(c.decided_note)).length;

const MINE = [
    { key: 'todo', label: 'รอฉันทำ' },
    { key: 'find', label: 'ที่ฉันช่วยหา' },
    { key: 'ask', label: 'ที่ฉันขอไว้' },
    { key: '', label: 'ทั้งหมด' }
];

export default function RequestsTab({ tasks, loading = false, error = '', hasBrand = true, onOpen, onNewRequest }) {
    const [search, setSearch] = useState('');
    const [brand, setBrand] = useState('');
    const [mine, setMine] = useState(null);          // null = ยังไม่ได้เลือก (ตั้งตามข้อมูลตอนโหลดเสร็จ)
    const [hideDone, setHideDone] = useState(true);

    const rows = (tasks && tasks.rows) || [];
    const todoCount = rows.filter(r => r.my_todo).length;
    const current = mine === null ? (todoCount > 0 ? 'todo' : '') : mine;

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
    const reason = tasks ? countsTip(tasks.counts) : '';

    const open = r => onOpen && onOpen(r);

    return (
        <div className="hub-tab">
            <div className="hub-toolbar">
                {hasBrand && onNewRequest && (
                    <button type="button" className="btn-primary" onClick={onNewRequest}>
                        <Icon name="plus" size={16} /> ขอให้ช่วยหาคน
                    </button>
                )}
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`ค้นหางาน / ประเภทงาน / สเปค / ${T.finder}...`} />
                    {search && <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>}
                </div>
            </div>

            {error && <div className="alert-error">{error}</div>}

            <div className="ka-summary">
                <div className="ka-sum-card">
                    <div className="ka-sum-ico"><Icon name="folder" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ใบที่แสดง</div>
                        <div className="ka-sum-v">{tasks ? shown.length : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico blue"><Icon name="team" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">ยังต้องหาอีก / ชื่อรอเลือก</div>
                        <div className="ka-sum-v">{tasks ? `${needed} คน / ${waiting} ชื่อ` : '—'}</div>
                    </div>
                </div>
                <div className="ka-sum-card">
                    <div className="ka-sum-ico amber"><Icon name="history" size={22} /></div>
                    <div>
                        <div className="ka-sum-k">เลยกำหนดส่งรายชื่อ</div>
                        <div className="ka-sum-v">{tasks ? `${overdue} ใบ` : '—'}</div>
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
                    <table className="data-table tasks-table th-req-table">
                        <thead>
                            <tr>
                                <th>ขั้นตอน</th><th>รอใคร</th><th>งาน</th><th>ประเภทงาน</th>
                                <th className="num">ต้องหาอีก</th><th className="num">งบต่อคน</th>
                                <th>วันใช้งาน</th><th>กำหนดส่งรายชื่อ</th><th>{T.finder}</th><th>ชื่อที่ส่งมา</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {!tasks ? (
                                <tr><td colSpan="11" className="empty">{loading ? 'กำลังโหลด...' : '—'}</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan="11" className="empty">
                                    {rows.some(r => matchMine(r, current)) && current !== 'todo'
                                        // มีใบอยู่แต่ถูกซ่อน/กรองออก — อย่าบอกว่า "ยังไม่มีใบ"
                                        ? (hideDone ? 'ไม่พบใบตามเงื่อนไขที่เลือก — ใบที่ได้ครบแล้ว / งานปิดแล้วถูกซ่อนอยู่ (เอาติ๊กออกเพื่อดู)' : 'ไม่พบใบตามเงื่อนไขที่เลือก')
                                        : current === 'todo' ? 'ไม่มีใบที่ถึงตาคุณตอนนี้'
                                            : current === 'find' || !hasBrand ? `ยังไม่มี${T.request}ที่มอบให้คุณช่วยหา`
                                                : current === 'ask' ? 'คุณยังไม่ได้ขอให้ช่วยหาคน'
                                                    : `ยังไม่มี${T.request} — กด "ขอให้ช่วยหาคน" ด้านบนได้เลย`}
                                </td></tr>
                            ) : shown.map(r => (
                                // ทั้งแถวกดได้ (และกด Enter ได้ตอนเลื่อนโฟกัสมาถึง) → เปิดลิ้นชักของใบ
                                <tr key={`${r.project_id}-${r.key}`} className={'th-row-link' + (r.my_todo ? ' row-todo' : '')}
                                    tabIndex={0} onClick={() => open(r)}
                                    onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(r); } }}
                                    aria-label={`เปิด${T.request} ${r.kind || ''} ${r.project_name || ''}`}>
                                    <td>
                                        <span className={'stage-chip st-' + r.stage}>{STAGE_LABEL[r.stage] || r.stage}</span>
                                        {r.overdue && <span className="stage-chip st-late">เลยกำหนด</span>}
                                    </td>
                                    <td className={r.my_todo ? 'req-mine' : 'muted'}>
                                        {whoShort(r)}
                                        {r.stage === 'deciding' && (r.todo || []).includes('find') ? (
                                            <span className="cast-sub">ทีมแบรนด์กำลังเลือกจาก {r.waiting_count} ชื่อ</span>
                                        ) : r.stage === 'deciding' && r.need_more > 0 ? (
                                            <span className="cast-sub">{T.finder}ยังต้องหาเพิ่มอีก {r.need_more} คน</span>
                                        ) : null}
                                        {/* ใบที่ยังขาดคนแต่มีคนที่เลือกแล้วรอยืนยันคิวอยู่ด้วย — บอกไว้ไม่ให้หลุดสายตา */}
                                        {r.stage !== 'booking' && r.stage !== 'fee' && r.stage !== 'closed' && (r.booking_pending > 0 || r.fee_review > 0) && (
                                            <span className="cast-sub">
                                                {[r.booking_pending ? `รอ${T.confirmQueue} ${r.booking_pending} คน` : '', r.fee_review ? `รอตัดสินค่าตัวใหม่ ${r.fee_review} คน` : ''].filter(Boolean).join(' · ')}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <span className="th-proj-name">{r.project_name}</span>
                                        {r.brand && <span className="cast-sub">{r.brand}</span>}
                                    </td>
                                    <td>{r.kind ? <span className="proc-ctype-chip">{r.kind}</span> : <span className="muted">—</span>}</td>
                                    <td className="num">
                                        {r.remaining > 0 ? <strong>{r.remaining}</strong> : <span className="muted">ครบแล้ว</span>}
                                        <span className="cast-sub">จาก {r.headcount} คน</span>
                                    </td>
                                    <td className="num">{baht(r.fee)}</td>
                                    <td className="muted">{fmtD(r.use_date) || '—'}</td>
                                    <td className={r.overdue ? 'req-late' : 'muted'}>{fmtD(r.deadline) || '—'}</td>
                                    <td className="muted">{r.assignee_name || <span className="ctype-none">— ยังไม่ได้เลือก —</span>}</td>
                                    <td>
                                        {r.candidate_count > 0 ? (
                                            <span className={'tag' + (r.waiting_count && r.remaining > 0 ? ' warn' : '')}>
                                                {r.candidate_count} ชื่อ
                                                {r.waiting_count && r.remaining > 0 && r.stage !== 'closed' ? ` · รอเลือก ${r.waiting_count}` : ''}
                                                {r.waiting_count && r.remaining <= 0 ? ` · ${T.spare} ${r.waiting_count}` : ''}
                                                {rejectedOf(r) ? ` · ${T.reject} ${rejectedOf(r)}` : ''}
                                                {unavailOf(r) ? ` · มาไม่ได้ ${unavailOf(r)}` : ''}
                                            </span>
                                        ) : <span className="muted">—</span>}
                                    </td>
                                    <td>
                                        <button type="button" className="btn-ghost req-go"
                                            onClick={e => { e.stopPropagation(); open(r); }}>
                                            เปิดใบ
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
