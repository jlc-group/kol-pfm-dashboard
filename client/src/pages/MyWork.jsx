import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import DraftModal from '../components/DraftModal.jsx';
import { WORK_BUCKETS, waitedText } from '../data/reviewers.js';
import { fmtDate } from '../utils/date.js';

// หน้า "งานของฉัน" (ผู้ใช้สั่ง 27 ต.ค. 2026) — คลิปที่ต้องตรวจดราฟ ข้ามทุกแคมเปญ ตามคนตรวจที่ตั้งไว้ในแท็บ On Process
// เห็นเฉพาะงานของบัญชีตัวเอง · Admin เลือกดูของคนอื่น / คลิปที่ยังไม่มีคนตรวจได้ (server บังคับซ้ำที่ routes/myWork.js)
// กด "ตรวจ" = หน้าต่างดราฟเดิม (Approve / ขอแก้ไข) ไม่ต้องเข้าแคมเปญ · ใครกดก็ได้ ระบบจดว่าใครตรวจ (ตรวจแทนขึ้นป้ายในแคมเปญ)
const ME = '';
const UNASSIGNED = 'unassigned';
const ago = iso => waitedText(iso);

export default function MyWork() {
    const { user, isAdmin } = useAuth();
    const [who, setWho] = useState(ME);               // Admin: '' = ตัวเอง · id = คนอื่น · 'unassigned'
    const [people, setPeople] = useState([]);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [bucket, setBucket] = useState('review');
    const [brand, setBrand] = useState('');
    const [campaign, setCampaign] = useState('');
    const [open, setOpen] = useState(null);           // แถวที่เปิดหน้าต่างดราฟ

    useEffect(() => {
        if (!isAdmin) return undefined;
        let alive = true;
        api('/users/options').then(r => { if (alive) setPeople(r.data || []); }).catch(() => {});
        return () => { alive = false; };
    }, [isAdmin]);

    // โหลดใหม่เป็นระยะ (20 วิ เหมือนแท็บ On Process) + ตอนกลับมาที่แท็บ — หน้าเปิดค้างต้องเห็นดราฟใหม่ / ผลที่คนอื่นตัดสินไปแล้ว (ผลรีวิว 27 ต.ค.)
    // คำตอบที่มาช้ากว่าคำขอล่าสุด (Admin สลับดูคนเร็ว ๆ) ทิ้ง ไม่ให้งานของคนก่อนมาทับ
    const reqSeq = useRef(0);
    const load = useCallback(() => {
        const n = ++reqSeq.current;
        return api('/my-work' + (who ? `?user=${encodeURIComponent(who)}` : ''))
            .then(r => { if (n === reqSeq.current) { setData(r.data); setError(''); } })
            .catch(e => { if (n === reqSeq.current) { setData(null); setError(e.message || 'โหลดงานไม่ได้'); } });
    }, [who]);
    useEffect(() => {
        setData(null);
        load();
        const tick = () => { if (document.visibilityState !== 'hidden') load(); };
        const t = setInterval(tick, 20000);
        document.addEventListener('visibilitychange', tick);
        window.addEventListener('kol:my-work-changed', tick);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('kol:my-work-changed', tick); };
    }, [load]);
    // เปลี่ยนคน = ล้างตัวกรองแบรนด์ / แคมเปญ (ของคนก่อนอาจไม่มีในงานของคนนี้)
    useEffect(() => { setBrand(''); setCampaign(''); }, [who]);

    const rows = useMemo(() => (data ? data.rows : []), [data]);
    const brands = [...new Set(rows.map(r => r.brand).filter(Boolean))].sort();
    // ตัวกรองที่เลือกไว้แต่ไม่มีในรายการแล้ว (งานหมด / โหลดใหม่) = ไม่กรอง — ไม่ให้รายการว่างค้างตอนดรอปดาวน์ถูกซ่อน
    const curBrand = brands.includes(brand) ? brand : '';
    const campaigns = [...new Map(rows.filter(r => !curBrand || r.brand === curBrand).map(r => [r.project_id, r.project_name])).entries()];
    const curCampaign = campaigns.some(([pid]) => String(pid) === campaign) ? campaign : '';
    const shown = rows
        .filter(r => r.bucket === bucket)
        .filter(r => !curBrand || r.brand === curBrand)
        .filter(r => !curCampaign || String(r.project_id) === curCampaign)
        // รอตรวจ = รอนานสุดขึ้นก่อน · อื่น ๆ = ล่าสุดขึ้นก่อน
        .sort((a, b) => {
            const ta = Date.parse(a.bucket === 'posted' ? a.post_url_at : a.bucket === 'review' ? a.draft_updated_at : (a.draft_checked_at || a.draft_updated_at)) || 0;
            const tb = Date.parse(b.bucket === 'posted' ? b.post_url_at : b.bucket === 'review' ? b.draft_updated_at : (b.draft_checked_at || b.draft_updated_at)) || 0;
            return bucket === 'review' ? ta - tb : tb - ta;
        });
    const counts = data ? data.counts : { review: 0, revise: 0, approved: 0, posted: 0 };
    const viewingOther = isAdmin && who !== ME;
    const whoName = who === UNASSIGNED ? 'คลิปที่ยังไม่มีคนตรวจ' : (people.find(p => String(p.id) === String(who)) || {}).name || '';

    async function saveDraft(row, payload) {
        await api(`/projects/${row.project_id}/submissions/${row.id}`, { method: 'PUT', body: payload });
        await load();
        window.dispatchEvent(new Event('kol:my-work-changed'));
    }
    // เปิดหน้าต่างดราฟด้วยข้อมูลล่าสุดของคลิปเสมอ — หน้าต่างบันทึกดราฟทั้ง 5 ช่องกลับไป ถ้าใช้แถวเก่าที่โหลดไว้
    // ดราฟที่เอเจนซี่เพิ่งส่ง / ผลที่เพื่อนเพิ่งตัดสิน จะโดนเขียนทับ (ผลรีวิว 27 ต.ค.)
    const [opening, setOpening] = useState(null);
    async function openDraft(row) {
        setOpening(row.id);
        try {
            const r = await api(`/projects/${row.project_id}/submissions`);
            const fresh = (r.data || []).find(s => s.id === row.id);
            if (!fresh || fresh.status !== 'confirmed') { alert('คลิปนี้ถูกเปลี่ยนสถานะไปแล้ว — โหลดรายการใหม่ให้'); load(); return; }
            setOpen({ ...row, ...fresh });
        } catch (e) { alert(e.message || 'เปิดดราฟไม่ได้'); }
        finally { setOpening(null); }
    }

    const statusText = r => {
        // รอตรวจ: ไม่มีป้าย "รอมา ..." (ผู้ใช้สั่งเอาออก 27 ต.ค.) — ลำดับยังรอนานสุดขึ้นก่อน
        if (r.bucket === 'review') return null;
        if (r.bucket === 'posted') return <span className="muted">ลงงาน {r.post_date ? fmtDate(r.post_date) : '—'}</span>;
        const verb = r.bucket === 'revise' ? 'ขอแก้ไข' : 'Approve';
        return <span className="muted">{verb}{r.draft_checked_by ? ` โดย ${r.draft_checked_by}` : ''}{r.draft_checked_at ? ` · ${ago(r.draft_checked_at).text}ที่แล้ว` : ''}</span>;
    };

    return (
        <div className="mywork-page">
            <header className="page-head">
                <div>
                    <h1>งานของฉัน</h1>
                    <p className="page-sub">
                        {viewingOther ? `กำลังดูงานของ ${whoName}` : 'คลิปที่ต้องตรวจดราฟ ทุกแคมเปญ'} — ตั้งคนตรวจได้ที่แท็บ On Process ของแต่ละแคมเปญ (ทั้งแคมเปญ / รายกลุ่ม / รายคลิป)
                    </p>
                </div>
            </header>

            {isAdmin && (
                <div className="toolbar mywork-who">
                    <label>
                        ดูงานของ
                        <select value={who} onChange={e => setWho(e.target.value)} aria-label="ดูงานของ">
                            <option value={ME}>ฉัน{user ? ` (${user.nickname || user.full_name || user.username})` : ''}</option>
                            <option value={UNASSIGNED}>— คลิปที่ยังไม่มีคนตรวจ —</option>
                            {people.filter(p => !user || p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </label>
                </div>
            )}

            <div className="proc-stat-grid">
                {WORK_BUCKETS.map(b => (
                    <button type="button" key={b.key} className={'proc-stat-card ' + b.key + (bucket === b.key ? ' on' : '')}
                        aria-pressed={bucket === b.key} title={b.hint} onClick={() => setBucket(b.key)}>
                        <span className="proc-stat-num">{data ? (counts[b.key] || 0) : '—'}</span>
                        <span className="proc-stat-lbl">{b.label}</span>
                    </button>
                ))}
            </div>

            {(brands.length > 1 || campaigns.length > 1) && (
                <div className="toolbar mywork-filters">
                    {brands.length > 1 && (
                        <select value={curBrand} onChange={e => { setBrand(e.target.value); setCampaign(''); }} aria-label="แบรนด์">
                            <option value="">ทุกแบรนด์</option>
                            {brands.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    )}
                    {campaigns.length > 1 && (
                        <select value={curCampaign} onChange={e => setCampaign(e.target.value)} aria-label="แคมเปญ">
                            <option value="">ทุกแคมเปญ</option>
                            {campaigns.map(([pid, name]) => <option key={pid} value={String(pid)}>{name}</option>)}
                        </select>
                    )}
                </div>
            )}

            {error && <div className="alert-error">{error}</div>}
            <div className="panel no-pad">
                {!data ? (
                    // โหลดไม่ได้ = บอก error ด้านบนอย่างเดียว ไม่ขึ้นว่า "ไม่มีงาน" (ผลรีวิว 27 ต.ค.)
                    <p className="empty" style={{ padding: 20 }}>{error ? 'ยังโหลดรายการไม่ได้ — ระบบจะลองใหม่เองทุก 20 วินาที' : 'กำลังโหลด...'}</p>
                ) : shown.length === 0 ? (
                    <div className="empty-illus">
                        <div className="empty-illus-title">
                            {bucket === 'review' ? 'ไม่มีดราฟรอตรวจ' : `ไม่มีคลิปใน "${(WORK_BUCKETS.find(b => b.key === bucket) || {}).label}"`}
                        </div>
                        <p className="empty-illus-sub">
                            {who === UNASSIGNED ? 'ทุกคลิปที่ส่งดราฟแล้วมีคนตรวจครบ'
                                : 'ถ้าคิดว่าควรมีงาน ให้เช็คว่าแคมเปญตั้งคนตรวจไว้ที่แท็บ On Process แล้ว'}
                        </p>
                    </div>
                ) : (
                    <div className="mywork-list" role="list">
                        {shown.map(r => (
                            <div className="mywork-row" role="listitem" key={r.id}>
                                <div className="mywork-main">
                                    <Link className="mywork-camp" to={`/projects/${r.project_id}?tab=process`}>{r.project_name}</Link>
                                    <span className="mywork-brand">{r.brand}</span>
                                    {r.campaign_type === 'solo' && <span className="mywork-brand solo">KOL รายคน</span>}
                                    <div className="mywork-kol">
                                        <b>{r.account_name || '—'}</b>
                                        {r.clip_name && <span className="proc-clip-tag">🎬 {r.clip_name}</span>}
                                    </div>
                                </div>
                                <div className="mywork-meta">
                                    <span>{r.product || '—'}</span>
                                    <span>{r.platform || '—'}</span>
                                    {r.group_no && <span>กลุ่มที่ {r.group_no}</span>}
                                    <span>ดราฟ {r.draft_no || '—'}</span>
                                </div>
                                <div className="mywork-status">{statusText(r)}</div>
                                <button type="button" className={r.bucket === 'review' ? 'btn-primary mywork-btn' : 'btn-ghost mywork-btn'}
                                    disabled={opening === r.id} onClick={() => openDraft(r)}>
                                    {opening === r.id ? 'กำลังเปิด...' : r.bucket === 'review' ? 'ตรวจ' : 'ดูดราฟ'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {open && (
                <DraftModal sub={open} canDecide canRemark={false}
                    onClose={() => setOpen(null)}
                    onSave={payload => saveDraft(open, payload)} />
            )}
        </div>
    );
}
