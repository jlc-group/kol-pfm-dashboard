import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Icon from '../../components/Icon.jsx';
import {
    T, CAND_LABEL, baht, feeDiff, timeAgo, daysLate, requestLink
} from '../../data/talentLabels.js';
import {
    bookingsOf, bookingStateOf, candsOf, shownNote, isUnavailNote, teamCanHelp,
    waitingSentence, todoCards, todoTitle, todoMeta, requesterText
} from './requestText.js';
import JobCard from './JobCard.jsx';

// แท็บ "หน้าหลัก" ของ Talent — เปิดเมนูมาเจอหน้านี้เสมอ
// บนสุดคือทางเริ่ม 3 ทาง ถัดมาคือ "รอคุณทำ" เรื่องละการ์ด (เรื่องง่ายกดจบในการ์ด เรื่องที่ต้องดูรายละเอียดเปิดลิ้นชักบนหน้าเดิม)
// ข้อมูลใบขอให้หามาจากหน้าแม่ชุดเดียว (tasks) — หน้านี้โหลดเองแค่ "งานที่กำลังทำ" 5 ใบ
// คนช่วยหาที่ไม่มีแบรนด์ (finderOnly) ได้หน้า "งานหาคนของฉัน" แทน
const USES_KEY = 'talent.startUses';
const readUses = () => {
    try { return Number(window.localStorage.getItem(USES_KEY)) || 0; } catch { return 0; }
};
const bumpUses = () => {
    try { window.localStorage.setItem(USES_KEY, String(readUses() + 1)); } catch { /* ที่เก็บข้อมูลถูกปิด — ไม่เป็นไร */ }
};
const DAY = 86400000;
const changed = () => window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));

export default function HomeTab(props) {
    return props.finderOnly ? <FinderHome {...props} /> : <BrandHome {...props} />;
}

// ===================== ทีมแบรนด์ =====================
function BrandHome({ tasks, loading, error, brands = [], rates, onOpen, onOpenRequest, onStart, onAskRate, onGoTab, jobsVersion }) {
    const rows = (tasks && tasks.rows) || [];
    const cards = useMemo(() => todoCards(rows), [rows]);
    const [flash, say] = useFlash();
    // ใบที่ทีมต้องทำแต่ไม่ได้นับเป็นตาเรา — คนในแบรนด์ช่วยกดแทนได้ (เลขแดงไม่นับ ตั้งใจให้นับแค่ของเรา)
    const helpRows = rows.filter(teamCanHelp);
    const otherRows = rows.filter(r => r.in_brand && !r.my_todo && !teamCanHelp(r)
        && r.waiting_on === 'finder' && r.stage !== 'full' && r.stage !== 'closed');

    return (
        <div className="th-home">
            <StartCards onStart={onStart} onAskRate={onAskRate} onGoTab={onGoTab} />

            {error && <div className="alert-error">{error}</div>}

            {!tasks ? (
                loading ? <div className="th-section th-loading">กำลังโหลด...</div> : null
            ) : cards.length > 0 ? (
                <TodoSection cards={cards} onOpen={onOpen} flash={flash} say={say} />
            ) : (
                <div className="th-section th-empty">
                    <Flash flash={flash} />
                    <div className="th-empty-title">ไม่มีอะไรรอคุณตอนนี้</div>
                    <p>จะเริ่มจ้างคนใหม่ก็เลือกได้เลย</p>
                    <div className="th-empty-actions">
                        <button type="button" className="btn-primary" onClick={() => onStart('direct')}>
                            <Icon name="plus" size={16} /> มีคนแล้ว บันทึกการจ้าง
                        </button>
                        <button type="button" className="btn-ghost th-casting-btn" onClick={() => onStart('casting')}>
                            <Icon name="search" size={16} /> ขอให้ช่วยหาคน
                        </button>
                    </div>
                </div>
            )}

            {tasks && helpRows.length > 0 && (
                <Fold title="รอทีมแบรนด์ คุณช่วยได้" count={helpRows.length} tone="amber"
                    // เห็นแบรนด์เดียว = ใบพวกนี้คืองานของทีมตัวเองแน่ ๆ กางไว้เลย · หลายแบรนด์พับไว้ไม่ให้รก
                    defaultOpen={brands.length === 1}
                    hint="ใบของทีมในแบรนด์ที่คุณดูแล — ไม่ได้นับเป็นเลขแดงของคุณ แต่คุณกดแทนทีมได้">
                    <ul className="th-lines">
                        {helpRows.map(r => (
                            <RowLine key={`${r.project_id}~${r.key}`} row={r} onOpen={onOpen} />
                        ))}
                    </ul>
                </Fold>
            )}

            {tasks && otherRows.length > 0 && (
                <Fold title="รอคนอื่นอยู่" count={otherRows.length} defaultOpen={false}
                    hint={`รอ${T.finder}ส่งชื่อหรือยืนยันคิว — ตอนนี้ไม่ต้องทำอะไร กดคัดลอกลิงก์ไปทวงใน LINE ได้`}>
                    <ul className="th-lines">
                        {otherRows.map(r => (
                            <RowLine key={`${r.project_id}~${r.key}`} row={r} onOpen={onOpen} nudge />
                        ))}
                    </ul>
                </Fold>
            )}

            <RateSummary rates={rates} onGoTab={onGoTab} />

            <OpenJobs version={jobsVersion} onGoTab={onGoTab} onStart={onStart}
                // หน้าแม่ส่งตัวเปิดใบแบบ (งาน, ใบ) มาให้ — ถ้าไม่มีก็ใช้ onOpen เดิมที่รับแถวใบ
                onOpenRequest={onOpenRequest || ((pid, key) => onOpen({ project_id: pid, key }))} />
        </div>
    );
}

// ทางเริ่ม 3 ทาง — ใช้ครบ 3 ครั้งแล้วย่อเหลือแถบปุ่มเล็ก (คนที่ใช้คล่องแล้วไม่ต้องเห็นคำอธิบายยาวทุกวัน)
function StartCards({ onStart, onAskRate, onGoTab }) {
    // อ่านครั้งเดียวตอนเปิดหน้า — หน้าตาไม่เปลี่ยนกลางคันตอนเพิ่งกด
    const [compact] = useState(() => readUses() >= 3);
    const items = [
        { key: 'direct', icon: 'users', title: 'มีคนแล้ว บันทึกการจ้าง', desc: 'รู้ชื่อคนแล้ว ใส่ค่าตัว วัน สถานที่', go: () => onStart('direct') },
        { key: 'casting', icon: 'search', title: 'ยังไม่มีคน ขอให้ช่วยหา', desc: `บอกสเปค จำนวน งบต่อคน แล้ว${T.finder}จะส่งรายชื่อมาให้เลือก`, go: () => onStart('casting') },
        { key: 'rate', icon: 'coins', title: 'ถามราคาก่อน', desc: 'อยากรู้เรทก่อนตัดสินใจจ้าง', go: () => onAskRate() }
    ];
    const use = it => { bumpUses(); it.go(); };
    const again = (
        <button type="button" className="th-link th-again" onClick={() => onGoTab('people')}>
            จ้างคนเดิมซ้ำ? ดูคนที่เคยจ้าง →
        </button>
    );
    if (compact) {
        return (
            <div className="th-start-compact">
                {items.map(it => (
                    <button type="button" key={it.key} className={'th-start-mini th-k-' + it.key} onClick={() => use(it)}>
                        <Icon name={it.icon} size={15} /> {it.title}
                    </button>
                ))}
                {again}
            </div>
        );
    }
    return (
        <div className="th-start">
            <div className="th-start-grid">
                {items.map(it => (
                    <button type="button" key={it.key} className={'th-start-card th-k-' + it.key} onClick={() => use(it)}>
                        <span className="th-start-ico"><Icon name={it.icon} size={20} /></span>
                        <span className="th-start-title">{it.title}</span>
                        <span className="th-start-desc">{it.desc}</span>
                    </button>
                ))}
            </div>
            {again}
        </div>
    );
}

// ===== "รอคุณทำ" =====
// ข้อความผลลัพธ์ของปุ่มกดจบ อยู่ระดับหน้า (ไม่ใช่ในการ์ด) — การ์ดที่กดจบจะหายไปเมื่อโหลดใหม่
// และถ้าเป็นการ์ดใบสุดท้าย ทั้งหัวข้อจะกลายเป็น "ไม่มีอะไรรอคุณ" ข้อความต้องยังอยู่ให้เห็น
function useFlash() {
    const [flash, setFlash] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const say = useCallback((kind, text) => {
        clearTimeout(timer.current);
        setFlash({ kind, text });
        timer.current = setTimeout(() => setFlash(null), kind === 'ok' ? 4000 : 7000);
    }, []);
    return [flash, say];
}
function Flash({ flash }) {
    return flash ? <div className={'th-flash ' + flash.kind} role="status">{flash.text}</div> : null;
}

function TodoSection({ cards, onOpen, flash, say, title = 'รอคุณทำ' }) {
    return (
        <section className="th-section th-todo-sec" aria-label={title}>
            <h2 className="th-sec-title">{title} <span className="th-count danger">{cards.length}</span></h2>
            <Flash flash={flash} />
            <div className="th-todo-list">
                {cards.map(c => <TodoCard key={c.id} card={c} onOpen={onOpen} say={say} />)}
            </div>
        </section>
    );
}

function TodoCard({ card, onOpen, say }) {
    const { row, booking: b, type } = card;
    const bk = (b && b.booking) || {};
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [done, setDone] = useState('');
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');
    const url = action => `/projects/${row.project_id}/hires/${row.key}/bookings/${b.key}/${action}`;
    const open = () => onOpen(row);

    async function run(label, fn, okText) {
        setBusy(label); setErr('');
        try {
            await fn();
            setDone(okText);
            say('ok', okText);
            changed();
        } catch (e) {
            // มีคนกดไปก่อน / คนช่วยหาแก้ค่าตัวระหว่างนั้น → โหลดใหม่ให้เห็นค่าล่าสุด แทนการยืนยันยอดที่ไม่เคยเห็น
            if (e && e.status === 409) { say('warn', 'ข้อมูลเพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว'); changed(); }
            else setErr((e && e.message) || 'บันทึกไม่สำเร็จ');
        } finally {
            setBusy('');
        }
    }
    // ส่งยอดที่เห็นบนจอไปด้วย — ถ้าคนช่วยหายืนยันใหม่ระหว่างนั้น server ตีกลับ 409 แทนการยอมรับยอดที่ไม่เคยเห็น
    const feeBody = note => ({ note, expected_fee: bk.requested_fee, expected_confirmed_at: bk.confirmed_at || null });
    const approve = () => run('approve', () => api(url('fee-approve'), { method: 'POST', body: feeBody(null) }),
        `✓ ยอมรับค่าตัวใหม่ของ ${b.name || 'คนนี้'} แล้ว`);
    const reject = () => run('reject', () => api(url('fee-reject'), { method: 'POST', body: feeBody(reason.trim() || null) }),
        `✓ ไม่ยอมรับค่าตัวใหม่ของ ${b.name || 'คนนี้'} แล้ว`);
    // body ว่าง = ใช้วัน/เวลา/สถานที่/ค่าตัวตามที่ตกลงไว้ทั้งหมด (server เก็บค่าเดิมให้)
    const confirm = () => run('confirm', () => api(url('confirm'), { method: 'POST', body: {} }),
        `✓ ${T.confirmQueue} ${b.name || ''} แล้ว`);

    const isBusy = !!busy;
    let actions;
    if (done) {
        actions = <span className="th-done">{done}</span>;
    } else if (type === 'fee' && b) {
        const approved = bk.approved_fee != null ? bk.approved_fee : b.fee;
        actions = rejecting ? (
            <div className="th-reject">
                <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                    placeholder="เหตุผล (ไม่บังคับ) เช่น เกินงบ" aria-label="เหตุผลที่ไม่ยอมรับค่าตัวใหม่" />
                <div className="th-todo-actions">
                    <button type="button" className="btn-primary th-danger" disabled={isBusy} onClick={reject}>
                        {busy === 'reject' ? 'กำลังบันทึก...' : 'ยืนยัน: ไม่ยอมรับ'}
                    </button>
                    <button type="button" className="th-textbtn" disabled={isBusy} onClick={() => setRejecting(false)}>ยกเลิก</button>
                </div>
            </div>
        ) : (
            <>
                <div className="th-todo-detail">(ตกลงไว้ {baht(approved)} · {feeDiff(approved, bk.requested_fee).text})</div>
                <div className="th-todo-actions">
                    <button type="button" className="btn-primary" disabled={isBusy} onClick={approve}>
                        {busy === 'approve' ? 'กำลังบันทึก...' : `ยอมรับ ${baht(bk.requested_fee)}`}
                    </button>
                    <button type="button" className="th-textbtn" disabled={isBusy} onClick={() => setRejecting(true)}>ไม่ยอมรับ</button>
                    <button type="button" className="th-textbtn" disabled={isBusy} onClick={open}>ดูใบ</button>
                </div>
            </>
        );
    } else if (type === 'confirm' && b) {
        // ทีมเพิ่งไม่ยอมรับค่าตัวที่ขอเพิ่ม → ต้องเห็นคำตอบของทีมก่อน ห้ามยืนยันคลิกเดียวด้วยยอดเดิม (ยืนยันแล้วย้อนไม่ได้)
        const rejected = bk.rejected_fee != null;
        // ค่าตัว 0 ยืนยันคลิกเดียวไม่ได้ (server ตีกลับ) — ต้องเปิดใบใส่ค่าตัวที่ตกลงจริงก่อน
        const oneClick = Number(b.fee) > 0 && !rejected;
        actions = (
            <>
                {rejected && (
                    <div className="th-todo-detail">
                        ทีมไม่ยอมรับค่าตัว {baht(bk.rejected_fee)}{bk.team_note ? ` — ${bk.team_note}` : ''} · คุยใหม่แล้ว{T.confirmQueue}อีกครั้ง
                    </div>
                )}
                <div className="th-todo-actions">
                    {oneClick ? (
                        <button type="button" className="btn-primary" disabled={isBusy} onClick={confirm}>
                            {busy === 'confirm' ? 'กำลังบันทึก...' : 'ยืนยันตามนี้'}
                        </button>
                    ) : (
                        <button type="button" className="btn-primary" disabled={isBusy} onClick={open}>
                            {rejected ? `ดูแล้ว${T.confirmQueue}` : 'ใส่ค่าตัวแล้วยืนยัน'}
                        </button>
                    )}
                    {oneClick && <button type="button" className="th-textbtn" disabled={isBusy} onClick={open}>แก้ก่อนยืนยัน</button>}
                    <button type="button" className="th-textbtn" disabled={isBusy} onClick={open}>{T.cantCome}</button>
                </div>
            </>
        );
    } else {
        const label = type === 'decide' ? 'ดูรายชื่อแล้วเลือก'
            : type === 'find' ? 'ส่งชื่อ'
                : type === 'assign' ? `เลือก${T.finder}` : 'เปิดใบ';
        actions = (
            <div className="th-todo-actions">
                <button type="button" className="btn-primary" onClick={open}>{label}</button>
            </div>
        );
    }

    const meta = todoMeta(card);
    return (
        <article className={'th-todo th-t-' + type + (card.overdue ? ' late' : '')}>
            <div className="th-todo-title">{todoTitle(card)}</div>
            {meta && <div className="th-todo-meta">{meta}</div>}
            <ContextLine row={row} />
            {err && <div className="th-err">{err}</div>}
            {actions}
        </article>
    );
}

// บรรทัดบริบท: งาน · แบรนด์ · ขอโดย X · 2 ชม.ก่อน + ป้ายแดงเลยกำหนด
function ContextLine({ row }) {
    const { user } = useAuth();
    const late = row.overdue ? daysLate(row.deadline) : 0;
    const parts = [
        row.project_name,
        row.brand,
        requesterText(row, user && user.id),
        timeAgo(row.requested_at)
    ].filter(Boolean);
    return (
        <div className="th-ctx">
            <span>{parts.join(' · ')}</span>
            {row.overdue && (
                <span className="th-late">เลยกำหนดส่งรายชื่อ{late > 0 ? ` ${late} วัน` : ''}</span>
            )}
        </div>
    );
}

// หัวข้อพับได้ — ปุ่มบอกสถานะกาง/พับให้โปรแกรมอ่านหน้าจอด้วย
function Fold({ title, count, defaultOpen = false, tone = '', hint, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className={'th-section th-fold' + (tone ? ' ' + tone : '')}>
            <button type="button" className="th-fold-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <span className={'th-fold-caret' + (open ? ' open' : '')}><Icon name="chevron" size={15} /></span>
                <span className="th-fold-title">{title}</span>
                <span className={'th-count' + (tone ? ' ' + tone : '')}>{count}</span>
            </button>
            {open && (
                <div className="th-fold-body">
                    {hint && <p className="th-hint">{hint}</p>}
                    {children}
                </div>
            )}
        </section>
    );
}

// หนึ่งใบหนึ่งบรรทัด — กดทั้งแถวเปิดลิ้นชัก · nudge = มีปุ่มคัดลอกลิงก์ไว้ทวงคนช่วยหา
function RowLine({ row, onOpen, nudge = false }) {
    const [copied, setCopied] = useState(false);
    async function copy(e) {
        e.stopPropagation();
        const link = requestLink(window.location.origin, row.project_id, row.key);
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            window.prompt('คัดลอกลิงก์ใบนี้', link);
        }
    }
    const open = () => onOpen(row);
    return (
        <li className="th-line" role="button" tabIndex={0} onClick={open}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
            <div className="th-line-main">
                <div className="th-line-text">{waitingSentence(row)}</div>
                <div className="th-line-sub">{[row.kind, row.project_name, row.brand].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="th-line-actions">
                {nudge && (
                    <button type="button" className="th-textbtn" onClick={copy}>
                        <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์ทวง'}
                    </button>
                )}
                <button type="button" className="th-smallbtn" onClick={e => { e.stopPropagation(); open(); }}>เปิดใบ</button>
            </div>
        </li>
    );
}

// ===== สรุปถามราคา =====
function RateSummary({ rates, onGoTab }) {
    if (!rates) return null;
    const now = Date.now();
    const waiting = rates.filter(r => (r.status || 'open') === 'open').length;
    // "ได้ราคาแล้ว" = มีคนตอบ (answered_at ประทับตอนตอบราคา/หมายเหตุ) ภายใน 7 วันที่ผ่านมา
    const recent = rates.filter(r => {
        if ((r.status || 'open') === 'open' || !r.answered_at) return false;
        const t = new Date(r.answered_at).getTime();
        return Number.isFinite(t) && now - t <= 7 * DAY;
    }).length;
    if (!waiting && !recent) return null;
    return (
        <section className="th-section th-rate-sum">
            <span className="th-rate-text">
                ถามราคา: รอตอบ <b>{waiting}</b> · ได้ราคาแล้วใน 7 วัน <b>{recent}</b>
            </span>
            <button type="button" className="th-smallbtn" onClick={() => onGoTab('rates')}>ดู</button>
        </section>
    );
}

// ===== งานที่กำลังทำ (5 ใบแรกตามลำดับของ server: งานที่มีเรื่องค้างขึ้นก่อน) =====
// การ์ดแบบย่อ (compact) ของแท็บงานทั้งหมด: แถบได้คนแล้ว + เรื่องถัดไปพร้อมปุ่ม — ไม่มีเมนู ⋯ และบรรทัดเงิน
function OpenJobs({ version, onGoTab, onStart, onOpenRequest }) {
    const [jobs, setJobs] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let on = true;
        api('/hires/jobs')
            .then(res => { if (on) { setJobs(((res.data && res.data.rows) || []).filter(r => !r.closed)); setErr(''); } })
            .catch(e => { if (on) setErr(e.message); });
        return () => { on = false; };
    }, [version]);
    const shown = (jobs || []).slice(0, 5);
    return (
        <section className="th-section th-jobs-sec">
            <div className="th-sec-row">
                <h2 className="th-sec-title">งานที่กำลังทำ {jobs && <span className="th-count">{jobs.length}</span>}</h2>
                <button type="button" className="th-link" onClick={() => onGoTab('jobs')}>ดูงานทั้งหมด →</button>
            </div>
            {err && <div className="th-err">{err}</div>}
            {!jobs ? (
                !err && <p className="th-hint">กำลังโหลด...</p>
            ) : shown.length === 0 ? (
                <p className="th-hint">ยังไม่มีงานที่กำลังทำ</p>
            ) : (
                <div className="tl-grid compact">
                    {shown.map(j => (
                        <JobCard key={j.id} job={j} compact onOpenRequest={onOpenRequest} onStart={onStart} />
                    ))}
                </div>
            )}
        </section>
    );
}

// ===================== คนช่วยหาที่ไม่มีแบรนด์ =====================
function FinderHome({ tasks, loading, error, user, onOpen }) {
    const rows = (tasks && tasks.rows) || [];
    const cards = useMemo(() => todoCards(rows), [rows]);
    const [flash, say] = useFlash();
    const done = r => r.stage === 'full' || r.stage === 'closed';
    const others = rows.filter(r => r.is_assignee && !r.my_todo && !done(r));
    const finished = rows.filter(done);
    const uid = user && user.id != null ? String(user.id) : null;

    // ชื่อที่ฉันเสนอทุกใบ — บอกผลให้ครบ (รอเลือก / เลือกแล้ว / ไม่เอา + เหตุผล) ไม่ต้องไล่เปิดทีละใบ
    const mine = [];
    if (uid) {
        rows.forEach(r => {
            candsOf(r).forEach(c => {
                if (!c || String(c.by_id) !== uid) return;
                const st = c.status || 'เสนอ';
                const bk = bookingsOf(r).find(b => b.from_candidate != null && String(b.from_candidate) === String(c.key));
                const bst = bookingStateOf(bk);
                // next = ต่อท้ายป้าย "เลือกแล้ว" ในบรรทัดเดียวกัน (อ่านเป็น "เลือกแล้ว — รอคุณยืนยันคิว") · extra = เหตุผลที่ไม่เอา
                let next = '';
                let extra = '';
                if (st === 'ไม่เอา' && c.decided_note) extra = shownNote(c.decided_note);
                else if (st === 'เลือกแล้ว' && bst === 'pending' && bk.booking && bk.booking.rejected_fee != null) next = '— ทีมไม่ยอมรับค่าตัวใหม่ คุยใหม่แล้วยืนยันคิว';
                else if (st === 'เลือกแล้ว' && bst === 'pending') next = `— รอคุณ${T.confirmQueue}`;
                else if (st === 'เลือกแล้ว' && bst === 'fee_review') next = '— รอทีมตัดสินค่าตัวใหม่';
                // กด "คนนี้มาไม่ได้" ถูกเก็บเป็น 'ไม่เอา' — แสดงเป็น "มาไม่ได้" ไม่ให้อ่านว่าทีมไม่เอาคนนี้
                const label = st === 'ไม่เอา' && isUnavailNote(c.decided_note) ? 'มาไม่ได้' : (CAND_LABEL[st] || st);
                mine.push({ id: `${r.project_id}~${r.key}~${c.key}`, row: r, cand: c, st, label, next, extra });
            });
        });
    }

    return (
        <div className="th-home th-finder">
            <section className="th-section th-finder-intro">
                <h2 className="th-sec-title">งานหาคนของฉัน</h2>
                <p>ทีมแบรนด์มอบงานหาคนให้คุณ ส่งชื่อคนที่เหมาะเข้าไปในใบ</p>
                <p>ทีมจะเลือก แล้วคุณ{T.confirmQueue}กับคนนั้น</p>
            </section>

            {error && <div className="alert-error">{error}</div>}

            {!tasks ? (
                loading ? <div className="th-section th-loading">กำลังโหลด...</div> : null
            ) : (
                <>
                    {cards.length > 0 ? (
                        <TodoSection cards={cards} onOpen={onOpen} flash={flash} say={say} />
                    ) : (
                        <div className="th-section th-empty">
                            <Flash flash={flash} />
                            <div className="th-empty-title">ไม่มีอะไรรอคุณตอนนี้</div>
                            <p>มีใบใหม่มอบให้คุณเมื่อไหร่ จะขึ้นที่นี่พร้อมเลขแดงบนเมนู</p>
                        </div>
                    )}

                    {mine.length > 0 && (
                        <section className="th-section">
                            <h2 className="th-sec-title">ชื่อที่คุณเสนอ <span className="th-count">{mine.length}</span></h2>
                            <ul className="th-lines">
                                {mine.map(m => (
                                    <li key={m.id} className="th-line" role="button" tabIndex={0} onClick={() => onOpen(m.row)}
                                        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(m.row); } }}>
                                        <div className="th-line-main">
                                            <div className="th-line-text">
                                                <b>{m.cand.name}</b>
                                                <span className={'th-cand-st st-' + (m.st === 'เลือกแล้ว' ? 'ok' : m.st === 'ไม่เอา' ? 'no' : 'wait')}>
                                                    {m.label}
                                                </span>
                                                {m.next && <span className="th-line-next">{m.next}</span>}
                                            </div>
                                            <div className="th-line-sub">{[m.row.kind, m.row.project_name].filter(Boolean).join(' · ')}</div>
                                            {m.extra && <div className={'th-line-note' + (m.st === 'ไม่เอา' ? ' no' : '')}>{m.extra}</div>}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {others.length > 0 && (
                        <section className="th-section">
                            <h2 className="th-sec-title">ใบอื่นที่คุณช่วยหา <span className="th-count">{others.length}</span></h2>
                            <ul className="th-lines">
                                {others.map(r => <RowLine key={`${r.project_id}~${r.key}`} row={r} onOpen={onOpen} />)}
                            </ul>
                        </section>
                    )}

                    {finished.length > 0 && (
                        <Fold title="ใบที่ครบแล้ว / งานปิดแล้ว" count={finished.length}>
                            <ul className="th-lines">
                                {finished.map(r => <RowLine key={`${r.project_id}~${r.key}`} row={r} onOpen={onOpen} />)}
                            </ul>
                        </Fold>
                    )}
                </>
            )}
        </div>
    );
}
