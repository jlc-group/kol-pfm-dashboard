import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { T, baht, jobStatusLabel, jobStatusValue } from '../../data/talentLabels.js';
import { moneyLine, todoText } from '../../data/hireProgress.js';
import { fmtD } from './requestText.js';

// การ์ดงานหนึ่งใบ — แท็บ "งานทั้งหมด" และ "งานที่กำลังทำ" ในหน้าหลัก (compact)
// ตัวเลขทั้งหมดมาจาก progress ที่ server คิดให้ (GET /hires/jobs → jobProgress) ไม่คิดซ้ำฝั่งหน้าเว็บ
// การ์ดบอก 3 อย่าง: ได้คนแล้วกี่คน (แถบสี) · เรื่องถัดไปที่ต้องทำพร้อมปุ่มเดียว · เงิน 3 ก้อน

// เรื่องของ "คน" → ชิปกรองในหน้างานที่ควรเปิดให้ (?show=) จะได้เห็นคนกลุ่มนั้นทันที
const SHOW_OF = { talking: 'pending', past: 'agreed', deliver: 'done' };

// ที่นั่งของงาน: ตกลงแล้ว (ตกลง+ถ่ายเสร็จ+ส่งงาน) / รอยืนยัน (กำลังคุย+รอยืนยันคิว) / ยังต้องหา — ใช้ทั้งการ์ดและกล่องสรุป
export function jobSlots(progress) {
    const p = (progress && progress.people) || {};
    const n = v => Number(v) || 0;
    const agreed = n(p.agreed) + n(p.shot) + n(p.delivered);
    const pending = n(p.talking) + n(p.booking);
    const need = n(p.need);
    return { agreed, pending, need, total: n(p.total) || agreed + pending + need };
}

function rangeText(job) {
    if (!job.start_date) return '';
    return job.end_date && job.end_date !== job.start_date
        ? `${fmtD(job.start_date)} – ${fmtD(job.end_date)}`
        : fmtD(job.start_date);
}

export default function JobCard({ job, compact = false, onOpenRequest, onStart, isAdmin = false }) {
    const navigate = useNavigate();
    const [menu, setMenu] = useState(false);
    const [flash, setFlash] = useState('');
    const menuRef = useRef(null);
    const btnRef = useRef(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);

    // เมนู ⋯: กดนอกเมนู / Esc ปิด (Esc คืนโฟกัสให้ปุ่ม ⋯ คนใช้คีย์บอร์ดจะได้ไม่หลง)
    useEffect(() => {
        if (!menu) return undefined;
        const onDown = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
        const onKey = e => {
            if (e.key !== 'Escape') return;
            setMenu(false);
            if (btnRef.current) btnRef.current.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        // เปิดเมนูแล้วโฟกัสรายการแรกให้เลย
        const first = menuRef.current && menuRef.current.querySelector('[role="menuitem"]');
        if (first) first.focus();
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const url = `/projects/${job.id}`;
    const closed = !!job.closed;
    const p = job.progress || null;
    const range = rangeText(job);

    const say = text => {
        clearTimeout(timer.current);
        setFlash(text);
        timer.current = setTimeout(() => setFlash(''), 2500);
    };
    const choose = fn => { setMenu(false); fn(); };
    const start = mode => { if (onStart) onStart(mode, job); else navigate(url); };

    async function copyLink() {
        const link = `${window.location.origin}${url}`;
        // เปิดผ่าน IP ในวง LAN (ไม่ใช่ https) เบราว์เซอร์ไม่ให้ใช้คลิปบอร์ด → ให้คัดลอกเองจากกล่องแทน
        try {
            await navigator.clipboard.writeText(link);
            say('คัดลอกลิงก์งานแล้ว');
        } catch {
            window.prompt('คัดลอกลิงก์งานนี้', link);
        }
    }

    // ===== เรื่องถัดไป =====
    const next = p && p.next ? p.next : null;
    const nt = next ? todoText(next, p.people || {}) : null;
    const moreTodo = p && Array.isArray(p.todo) && p.todo.length > 1 ? p.todo.length - 1 : 0;
    function goNext() {
        if (!nt) return;
        const firstKey = next.keys && next.keys.length ? next.keys[0] : null;
        if (nt.target === 'request') {
            // ใบเปิดในลิ้นชักบนหน้าเดิม — ไม่มีใบให้เปิด (ไม่น่าเกิด) ก็พาไปหน้างานแทน
            if (firstKey != null && onOpenRequest) onOpenRequest(job.id, firstKey);
            else navigate(url);
        } else if (nt.target === 'people') {
            navigate(`${url}?show=${SHOW_OF[next.code] || 'pending'}`);
        } else if (nt.target === 'add') {
            start('direct');
        } else {
            // close / job → หน้างาน (ปุ่มปิดงานอยู่ที่หัวหน้างาน)
            navigate(url);
        }
    }

    const slots = p ? jobSlots(p) : null;

    return (
        <article className={'tl-card' + (closed ? ' is-closed' : '') + (menu ? ' menu-open' : '') + (compact ? ' compact' : '')}>
            <div className="tl-head">
                <div className="tl-title">
                    <Link className="tl-name" to={url}>{job.name}</Link>
                    <div className="tl-meta">
                        {job.brand && <span className="tag">{job.brand}</span>}
                        {/* งานที่ยังทำอยู่ไม่ต้องมีป้าย (ทุกใบเหมือนกัน) — ป้ายขึ้นเฉพาะงานที่ปิดแล้ว */}
                        {closed && <span className={`status status-${jobStatusValue(job.status)}`}>{jobStatusLabel(job.status)}</span>}
                        {range && <span className="tl-range"><Icon name="calendar" size={13} /> {range}</span>}
                    </div>
                </div>
                {!compact && (
                    <div className="tl-menu-wrap tl-above" ref={menuRef}>
                        <button type="button" ref={btnRef} className="tl-more" aria-haspopup="menu" aria-expanded={menu}
                            aria-label={`เมนูของงาน ${job.name}`} title="เมนูของงาน" onClick={() => setMenu(m => !m)}>
                            ⋯
                        </button>
                        {menu && (
                            <div className="tl-menu" role="menu">
                                <button type="button" role="menuitem" onClick={() => choose(() => start('direct'))}>
                                    <Icon name="plus" size={15} /> เพิ่มคนที่มีแล้ว
                                </button>
                                {/* งานปิดแล้วเปิดใบขอให้หาใหม่ไม่ได้ (server ตีกลับ) — ไม่ต้องมีปุ่มให้กดแล้วเจอข้อความผิดพลาด */}
                                {!closed && (
                                    <button type="button" role="menuitem" onClick={() => choose(() => start('casting'))}>
                                        <Icon name="search" size={15} /> ขอให้ช่วยหา
                                    </button>
                                )}
                                <button type="button" role="menuitem" onClick={() => choose(copyLink)}>
                                    <Icon name="copy" size={15} /> คัดลอกลิงก์งาน
                                </button>
                                <button type="button" role="menuitem" onClick={() => choose(() => navigate(url))}>
                                    <Icon name="folder" size={15} /> เปิดหน้างาน
                                </button>
                                {isAdmin && (
                                    <button type="button" role="menuitem" onClick={() => choose(() => navigate('/payments'))}>
                                        <Icon name="wallet" size={15} /> ไปหน้ารอบทำจ่าย
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {!slots ? (
                // server เก่ายังไม่ส่ง progress → ใช้ตัวเลขชุดเดิมไปก่อน
                <div className="tl-old">
                    <span>{Number(job.people_count) || 0} คน</span>
                    {Number(job.remaining) > 0 && <span className="th-job-need">ต้องหาอีก {job.remaining}</span>}
                </div>
            ) : slots.total > 0 && (
                // งานเปล่า (total 0) ไม่ต้องมีแถบว่าง — บรรทัดถัดไปบอก "ยังไม่มีคนในงานนี้" อยู่แล้ว
                <div className="tl-progress">
                    <div className="tl-progress-head">
                        <span>ได้คนแล้ว <b>{slots.agreed}</b> จาก {slots.total} คน</span>
                    </div>
                    <div className="tl-bar" role="img"
                        aria-label={`ได้คนแล้ว ${slots.agreed} จาก ${slots.total} คน · ${T.pending} ${slots.pending} · ยังต้องหา ${slots.need}`}>
                        {slots.agreed > 0 && <span className="ok" style={{ flex: `${slots.agreed} 1 0` }} />}
                        {slots.pending > 0 && <span className="wait" style={{ flex: `${slots.pending} 1 0` }} />}
                        {slots.need > 0 && <span className="need" style={{ flex: `${slots.need} 1 0` }} />}
                    </div>
                    <div className="tl-legend" aria-hidden="true">
                        {slots.agreed > 0 && <span><i className="tl-dot ok" />{T.agreed} {slots.agreed}</span>}
                        {slots.pending > 0 && <span><i className="tl-dot wait" />{T.pending} {slots.pending}</span>}
                        {slots.need > 0 && <span><i className="tl-dot need" />ยังต้องหา {slots.need}</span>}
                    </div>
                </div>
            )}

            {nt && (
                <div className={'tl-next' + (next.code === 'closed' ? ' closed' : nt.urgent ? ' urgent' : '')}>
                    <span className="tl-next-text">
                        {next.code === 'closed' ? nt.text : `ถัดไป: ${nt.text}`}
                        {moreTodo > 0 && <span className="tl-next-more">{` · และอีก ${moreTodo} เรื่อง`}</span>}
                    </span>
                    <button type="button" className="th-smallbtn tl-above" onClick={goNext}>{nt.button}</button>
                </div>
            )}

            <div className="tl-foot">
                {!compact && (
                    <div className="tl-money">{p ? moneyLine(p.money) : `งบรวม ${baht(job.total_fee)}`}</div>
                )}
                <div>{T.owner}: {job.contact || '—'}</div>
                {flash && <div className="tl-flash" role="status">{flash}</div>}
            </div>
        </article>
    );
}
