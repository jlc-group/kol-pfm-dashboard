import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import OnProcessTable from '../components/OnProcessTable.jsx';
import StageCards from '../components/StageCards.jsx';
import FeeInput from '../components/FeeInput.jsx';
import ProductChips from '../components/ProductChips.jsx';
import { feeOf, locksOnFee } from '../components/DivideFeesModal.jsx';
import { stampAtFor } from '../data/stamp.js';
import { asTargetArray } from '../data/products.js';
import { groupNoGencode, conceptOneLine } from '../data/adGroups.js';
import { SOLO_STEP_LABEL, soloStepOf, baht, followersText } from '../data/soloKol.js';
import { fmtRange } from '../utils/date.js';
import SoloKolForm from '../components/SoloKolForm.jsx';

// หน้าของ KOL รายคน 1 การจ้าง (campaign_type 'solo' · ผู้ใช้สั่ง 30 ก.ย. 2026) — ProjectDetail แตกทางมาที่นี่ (URL /projects/:id เดิม)
// ติดตามงานใช้ตาราง On Process ตัวเดียวกับแคมเปญ (ดราฟ / ลงงาน / Gencode / ID Post / ยอดวิว / ยิงแอด)
// ค่าตัวแก้ผ่าน PUT /projects/:id/fees ตัวเดียวกับแคมเปญ (server อัปเดตงบของรายการตามให้) · ไม่มีลิงก์เอเจนซี่ / แชท
const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };

export default function SoloKolDetail({ project, reload }) {
    const navigate = useNavigate();
    const id = project.id;
    const [subs, setSubs] = useState([]);
    const [stage, setStage] = useState('all');
    const [busy, setBusy] = useState(false);
    const [openCheckOnly] = useState(() => new URLSearchParams(window.location.search).get('check') === '1');
    const [showEdit, setShowEdit] = useState(false);
    // ฟอร์มแก้ไขอ่านชื่อคลิป / สถานะล็อกจากรายการคลิปตอนเปิด — เปิดก่อนโหลดเสร็จ ชื่อคลิปจะกลายเป็น "คลิป 1, 2, ..." ตอนบันทึก
    const [subsState, setSubsState] = useState('loading');   // loading | ok | error
    const g = (project.ad_groups || [])[0] || null;
    const sum = project.solo_summary || {};

    function loadSubs() {
        api(`/projects/${id}/submissions`)
            .then(res => { setSubs(res.data || []); setSubsState('ok'); })
            .catch(() => setSubsState(s => (s === 'ok' ? 'ok' : 'error')));
    }
    useEffect(() => { loadSubs(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const clips = subs.filter(s => s.status !== 'rejected')
        .sort((a, b) => (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
    const first = clips.length ? feeOf(clips[0]) : 0;
    const uneven = clips.some(c => feeOf(c) !== first);
    const feeTotal = clips.reduce((n, c) => n + feeOf(c), 0);
    const putSubmission = (subId, payload) => api(`/projects/${id}/submissions/${subId}`, { method: 'PUT', body: payload });

    // ค่าตัวต่อคลิป — เขียนลงทุกคลิปในคำขอเดียว · from = ค่าที่เห็นอยู่ (มีคนแก้ก่อน → 409)
    async function saveFee(value) {
        const items = clips.filter(c => feeOf(c) !== value).map(c => ({ sub_id: c.id, budget: value, from: feeOf(c) }));
        if (!items.length) return;
        if (!(value > 0)) {
            const e = new Error('ค่าตัวต้องมากกว่า 0');
            throw e;
        }
        const locking = clips.filter(c => items.some(i => i.sub_id === c.id) && locksOnFee(c, value, stampAtFor(project.brand))).length;
        if (locking > 0 && !window.confirm(`บันทึกค่าตัว ${baht(value)} ต่อคลิปใช่ไหม?\nค่าแอดของ ${locking} คลิปถึงเกณฑ์แล้ว — บันทึกแล้วผลคุ้ม/ไม่คุ้มจะล็อกทันทีและแก้ย้อนหลังไม่ได้`)) {
            const cancelled = new Error('ยกเลิก');
            cancelled.cancelled = true;
            throw cancelled;
        }
        try {
            await api(`/projects/${id}/fees`, { method: 'PUT', body: { items, reason: 'manual' } });
            loadSubs(); reload();
        } catch (err) {
            if (err.status === 409) { loadSubs(); throw new Error('มีคนแก้ไปแล้ว — โหลดค่าล่าสุดให้แล้ว'); }
            throw err;
        }
    }

    async function setStatus(status, ask) {
        if (ask && !window.confirm(ask)) return;
        setBusy(true);
        try { await api(`/projects/${id}`, { method: 'PUT', body: { status } }); reload(); }
        catch (err) { alert(err.message); }
        finally { setBusy(false); }
    }
    async function remove() {
        if (!window.confirm(`ลบการจ้าง @${sum.account_name || ''} ออกถาวร?\nคลิป ${clips.length} รายการและข้อมูลทั้งหมดของการจ้างนี้จะหายไป กู้คืนไม่ได้`)) return;
        setBusy(true);
        try { await api(`/projects/${id}`, { method: 'DELETE' }); navigate('/projects?view=solo'); }
        catch (err) { alert(err.message); setBusy(false); }
    }

    const step = soloStepOf(project);
    const allAdDone = clips.length > 0 && sum.steps && sum.steps.every(x => x === 'done');
    const target = g ? asTargetArray((g.blocks && g.blocks[0] && g.blocks[0].target) || g.target) : [];
    const info = [
        g && g.content_type && ['Content Type', g.content_type],
        g && (g.allocations || [])[0] && g.allocations[0].campaign && g.allocations[0].campaign !== g.content_type && ['Campaign', g.allocations[0].campaign],
        g && g.media_type && ['Photo/VDO', g.media_type],
        g && g.content_format && ['Format', g.content_format],
        target.length > 0 && ['Target', target.join(', ')],
        g && ['Gencode', groupNoGencode(g) ? 'ไม่ใช้ Gencode' : `อายุ ${Number(g.code_expire) || 60} วัน`],
        g && g.concept && ['Concept', conceptOneLine(g.concept)],
        project.objective && ['หมายเหตุ', project.objective]
    ].filter(Boolean);

    return (
        <div className="solo-detail">
            <button type="button" className="btn-ghost solo-back" onClick={() => navigate('/projects?view=solo')}>
                ‹ KOL รายคน
            </button>

            <div className="panel solo-hero">
                <div className="solo-hero-top">
                    <span className="solo-badge">KOL รายคน</span>
                    <span className={`status status-${project.status}`}>{STATUS_LABEL[project.status] || project.status}</span>
                    {project.brand && <span className="tag">{project.brand}</span>}
                    <span className={'solo-step s-' + step}>ขั้นถัดไป: {SOLO_STEP_LABEL[step] || step}</span>
                </div>
                <h1 className="solo-hero-name">@{sum.account_name || '—'}</h1>
                <div className="solo-hero-meta">
                    {[sum.platform, followersText(sum.followers) && `${followersText(sum.followers)} ผู้ติดตาม`, sum.tier].filter(Boolean).join(' · ')}
                    {sum.link_account && <> · <a href={sum.link_account} target="_blank" rel="noopener noreferrer">ลิงก์ช่อง</a></>}
                </div>
                <div className="solo-hero-meta">
                    {sum.contact_mode === 'agency' ? `ผ่าน Agency: ${sum.agency || sum.payee || '—'}` : 'ติดต่อ KOL เอง'}
                    {' · '}ผู้รับเงิน: {sum.payee || '—'} · ผู้ดูแล: {project.owner || '—'}
                    {project.start_date && <> · จ้าง {fmtRange(project.start_date, null)}</>}
                    {sum.due_date && <> · กำหนดลงงาน {fmtRange(sum.due_date, null)}</>}
                </div>
                <div className="solo-hero-actions">
                    <button type="button" className="btn-ghost" disabled={busy || subsState !== 'ok'} onClick={() => setShowEdit(true)}
                        title={subsState === 'loading' ? 'กำลังโหลดรายการคลิป…' : subsState === 'error' ? 'โหลดรายการคลิปไม่สำเร็จ — กด F5' : undefined}>
                        <Icon name="edit" size={15} /> แก้ไขข้อมูล
                    </button>
                    {project.status === 'Active' && (
                        <button type="button" className="btn-primary" disabled={busy} onClick={() => setStatus('Completed', 'ปิดงานนี้เป็น "เสร็จสิ้น"?')}>
                            <Icon name="check" size={16} /> ปิดงาน
                        </button>
                    )}
                    {project.status !== 'Active' && (
                        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('Active')}>เปิดงานอีกครั้ง</button>
                    )}
                    {project.status === 'Active' && (
                        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('Cancelled', 'ยกเลิกการจ้างนี้? (ข้อมูลยังอยู่ เปิดงานอีกครั้งได้)')}>ยกเลิกการจ้าง</button>
                    )}
                    <button type="button" className="btn-ghost solo-del" disabled={busy} onClick={remove}><Icon name="trash" size={15} /> ลบ</button>
                </div>
                {subsState === 'error' && <div className="alert-error" style={{ marginTop: 12 }}>โหลดรายการคลิปไม่สำเร็จ — กด F5 แล้วลองใหม่</div>}
                {allAdDone && project.status === 'Active' && (
                    <div className="solo-done-hint">ทุกคลิปลงงานและยิงแอดแล้ว — กด "ปิดงาน" ได้เลย</div>
                )}
            </div>

            <div className="stat-grid solo-stats">
                <div className="stat-card">
                    <div className="stat-label">ค่าตัวต่อคลิป</div>
                    <div className="solo-fee-input">
                        <FeeInput value={first} missing={first <= 0} dirty={uneven || first <= 0}
                            version={clips.map(c => `${c.id}:${feeOf(c)}`).join('|')} onSave={saveFee} />
                    </div>
                    {uneven && <small className="fee-uneven">แต่ละคลิปไม่เท่ากัน — แก้แล้วทุกคลิปจะเป็นยอดนี้</small>}
                </div>
                <div className="stat-card">
                    <div className="stat-label">ค่าตัวรวม</div>
                    <div className="stat-value">{baht(feeTotal)}</div>
                    <small className="muted">{clips.length} คลิป</small>
                </div>
                <div className="stat-card">
                    <div className="stat-label">ลงงานแล้ว</div>
                    <div className="stat-value">{sum.posted || 0}/{sum.clips || clips.length}</div>
                    <small className="muted">ยิงแอดแล้ว {sum.ad_fired || 0}</small>
                </div>
                <div className="stat-card">
                    <div className="stat-label">สินค้า</div>
                    {(sum.products || []).length ? <ProductChips products={sum.products} collapseAt={3} /> : <span className="muted">—</span>}
                </div>
            </div>

            {info.length > 0 && (
                <div className="panel solo-info">
                    {info.map(([k, v]) => <span key={k} className="solo-info-chip"><b>{k}:</b> {v}</span>)}
                    {project.brief_link && <a className="solo-info-chip" href={project.brief_link} target="_blank" rel="noopener noreferrer">บรีฟ ↗</a>}
                </div>
            )}

            <h2 className="solo-work-title">ติดตามงาน</h2>
            <StageCards subs={subs} value={stage} onChange={setStage} />
            <div className="panel">
                <OnProcessTable subs={subs} groups={project.ad_groups || []} showAds scope={id}
                    putSubmission={putSubmission} reload={() => { loadSubs(); reload(); }}
                    initialCheckOnly={openCheckOnly}
                    onPostCheck={async (subId, action, note, seenAt) => {
                        try { await api(`/projects/${id}/submissions/${subId}/post-check`, { method: 'POST', body: { action, note, seen_at: seenAt } }); }
                        finally { loadSubs(); reload(); }
                    }}
                    stage={stage} onClearStage={() => setStage('all')} />
            </div>

            {showEdit && (
                <SoloKolForm project={project} clipNames={clips.map(c => c.clip_name || '')}
                    // คลิปเริ่มงานแล้ว (ลงงาน / ยิงแอด / สแตมป์) = ล็อกแบรนด์และ Platform — เกณฑ์เดียวกับ soloClipLive ฝั่ง server
                    locked={clips.some(c => !!(c.post_url && String(c.post_url).trim()) || Number(c.ad_spend) > 0 || c.ad_status === 'ยิงแล้ว' || !!c.perf_stamp)}
                    onClose={() => setShowEdit(false)}
                    onSaved={() => { setShowEdit(false); reload(); loadSubs(); }} />
            )}
        </div>
    );
}
