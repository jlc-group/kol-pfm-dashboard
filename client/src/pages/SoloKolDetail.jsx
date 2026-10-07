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
import { groupNoGencode, conceptOneLine, campaignIsCtype } from '../data/adGroups.js';
import {
    SOLO_STEP_LABEL, soloStepOf, baht, followersText, soloAccountsOf, soloPlatformsOf, soloPlatformOrder, soloEditLimits,
    OLD_SERVER_FEE_MSG, OLD_SERVER_TEXT
} from '../data/soloKol.js';
import { fmtDate } from '../utils/date.js';
import SoloKolForm from '../components/SoloKolForm.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

// หน้าของ KOL รายคน 1 การจ้าง (campaign_type 'solo' · ผู้ใช้สั่ง 30 ก.ย. 2026) — ProjectDetail แตกทางมาที่นี่ (URL /projects/:id เดิม)
// ติดตามงานใช้ตาราง On Process ตัวเดียวกับแคมเปญ (ดราฟ / ลงงาน / Gencode / ID Post / ยอดวิว / ยิงแอด)
// ค่าตัวแก้ผ่าน PUT /projects/:id/fees ตัวเดียวกับแคมเปญ (server อัปเดตงบของรายการตามให้) · ไม่มีลิงก์เอเจนซี่ / แชท
// รอบ 4 (1 ต.ค. 2026): หลาย Platform — บัญชี / ค่าตัว / ข้อมูลยิงแอด แยกต่อ Platform · ค่าตัว 0 = ได้ฟรี · ไม่มีปุ่มปิดงาน / กำหนดลงงานแล้ว
const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
// คลิปเริ่มงานแล้ว (ลงงาน / ยิงแอด / สแตมป์) — เกณฑ์เดียวกับ soloClipLive ฝั่ง server
const clipLive = c => !!(c.post_url && String(c.post_url).trim()) || Number(c.ad_spend) > 0 || c.ad_status === 'ยิงแล้ว' || !!c.perf_stamp;

export default function SoloKolDetail({ project, reload }) {
    const navigate = useNavigate();
    const { user } = useAuth();
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
    const accounts = soloAccountsOf(project);

    function loadSubs() {
        api(`/projects/${id}/submissions`)
            .then(res => { setSubs(res.data || []); setSubsState('ok'); })
            .catch(() => setSubsState(s => (s === 'ok' ? 'ok' : 'error')));
    }
    useEffect(() => { loadSubs(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const clips = subs.filter(s => s.status !== 'rejected')
        .sort((a, b) => (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
    // Platform ของการจ้าง + Platform ที่มีคลิปอยู่จริง (กันคลิปหลุดจากช่องค่าตัว)
    const plats = soloPlatformOrder([...soloPlatformsOf(project), ...clips.map(c => c.platform)]);
    const rowsOf = p => clips.filter(c => c.platform === p);
    const livePlats = plats.filter(p => rowsOf(p).length > 0);
    const clipCount = Number(sum.clip_count) || new Set(clips.map(c => Number(c.clip_no) || 1)).size;
    // ก่อนโหลดรายการคลิปเสร็จ ใช้ยอดจากสรุปของ server ไปก่อน (ไม่ขึ้น ฿0 / 0 คลิป ชั่วคราว)
    const loaded = subsState === 'ok';
    const posts = loaded ? clips.length : Number(sum.clips) || 0;
    const platCount = loaded ? livePlats.length : plats.length;
    const feeTotal = loaded ? clips.reduce((n, c) => n + feeOf(c), 0) : Number(sum.fee_total) || 0;
    const allFree = loaded ? clips.length > 0 && clips.every(c => feeOf(c) <= 0) : sum.fee_free === true;
    const putSubmission = (subId, payload) => api(`/projects/${id}/submissions/${subId}`, { method: 'PUT', body: payload });

    // ค่าตัวต่อคลิปของ 1 Platform — เขียนลงทุกคลิปของ Platform นั้นในคำขอเดียว · from = ค่าที่เห็นอยู่ (มีคนแก้ก่อน → 409)
    async function saveFee(platform, value) {
        const rows = rowsOf(platform);
        const items = rows.filter(c => feeOf(c) !== value).map(c => ({ sub_id: c.id, budget: value, from: feeOf(c) }));
        if (!items.length) return;
        const cancelled = () => { const e = new Error('ยกเลิก'); e.cancelled = true; return e; };
        // ค่าตัว 0 = ได้ฟรี (ไม่ใช่ยังไม่ใส่) — ถามก่อน กันพิมพ์ 0 เผลอ
        if (value === 0 && !window.confirm(`ตั้งค่าตัว ${platform} เป็น 0 (ได้ฟรี) ใช่ไหม?`)) throw cancelled();
        const locking = rows.filter(c => items.some(i => i.sub_id === c.id) && locksOnFee(c, value, stampAtFor(project.brand))).length;
        if (locking > 0 && !window.confirm(`บันทึกค่าตัว ${platform} ${baht(value)} ต่อคลิปใช่ไหม?\nค่าแอดของ ${locking} คลิปถึงเกณฑ์แล้ว — บันทึกแล้วผลคุ้ม/ไม่คุ้มจะล็อกทันทีและแก้ย้อนหลังไม่ได้`)) {
            throw cancelled();
        }
        try {
            await api(`/projects/${id}/fees`, { method: 'PUT', body: { items, reason: 'manual' } });
            loadSubs(); reload();
        } catch (err) {
            if (err.status === 409) { loadSubs(); throw new Error('มีคนแก้ไปแล้ว — โหลดค่าล่าสุดให้แล้ว'); }
            // server รุ่นก่อนรอบ 4 (ยังไม่รีสตาร์ต) ยังไม่มี "ได้ฟรี" — ตอบว่าค่าตัวต้องมากกว่า 0 ซึ่งชวนให้เข้าใจผิดว่าตั้ง 0 ไม่ได้
            if (value === 0 && err.message === OLD_SERVER_FEE_MSG) throw new Error(OLD_SERVER_TEXT);
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
        const names = [...new Set(accounts.map(a => '@' + (a.account_name || '')))].join(', ');
        // posts = ยอดจากสรุปของ server ระหว่างที่รายการคลิปยังโหลดไม่เสร็จ (ไม่ขึ้น "ทั้ง 0 โพสต์")
        if (!window.confirm(`ลบการจ้างนี้${names ? ` (${names})` : ''} ออกถาวร?\nทั้ง ${posts} โพสต์และข้อมูลทั้งหมดของการจ้างนี้จะหายไป กู้คืนไม่ได้`)) return;
        setBusy(true);
        try { await api(`/projects/${id}`, { method: 'DELETE' }); navigate('/projects?view=solo'); }
        catch (err) { alert(err.message); setBusy(false); }
    }

    const step = soloStepOf(project);
    // ข้อมูลยิงแอดแยกต่อ Platform (บล็อกของ Platform นั้นในกลุ่มโฆษณา) + ข้อมูลที่ใช้ร่วมกันทุก Platform
    const blocks = g && Array.isArray(g.blocks) ? g.blocks : [];
    const infoOf = p => {
        const b = blocks.find(x => x && x.platform === p);
        const s = (b && (b.sets || [])[0]) || {};
        const social = campaignIsCtype(p);
        const ct = s.content_type || (social ? s.campaign : '');
        const target = b ? asTargetArray(b.target) : [];
        return [
            ct && [social ? 'Campaign' : 'Content Type', ct],
            !social && s.campaign && ['Campaign', s.campaign],
            s.media_type && ['Photo/VDO', s.media_type],
            s.content_format && ['Format', s.content_format],
            target.length > 0 && ['Target', target.join(', ')]
        ].filter(Boolean);
    };
    const platInfo = plats.map(p => ({ p, items: infoOf(p) })).filter(x => x.items.length > 0);
    const shared = [
        g && ['Gencode', groupNoGencode(g) ? 'ไม่ใช้ Gencode' : `อายุ ${Number(g.code_expire) || 60} วัน`],
        g && g.concept && ['Concept', conceptOneLine(g.concept)]
    ].filter(Boolean);
    // รายละเอียดบรีฟ (projects.objective — ฟอร์มเพิ่มกลับ 5 ต.ค. 2026) ยาวได้หลายบรรทัด → แสดงเป็นย่อหน้า ไม่ใส่ในป้าย
    // ชื่อคลิปตามลำดับคลิป (clip_no) — ทุก Platform ใช้ชื่อชุดเดียวกัน
    const clipNames = [];
    clips.forEach(c => { const i = Math.max(0, (Number(c.clip_no) || 1) - 1); if (!clipNames[i]) clipNames[i] = c.clip_name || ''; });
    // ฟอร์มแก้ไข: Platform ที่เอาออกไม่ได้ + จำนวนคลิปต่ำสุด — คิดจากทุกแถวคลิป (subs) แบบเดียวกับ updateSolo ฝั่ง server
    const editLimits = soloEditLimits(subs);

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
                <h1 className="solo-hero-name">@{sum.account_name || (accounts[0] && accounts[0].account_name) || '—'}</h1>
                {accounts.map(a => (
                    <div className="solo-hero-meta" key={a.platform || a.account_name}>
                        <b>{a.platform || '—'}</b> · @{a.account_name || '—'}
                        {followersText(a.followers) && ` · ${followersText(a.followers)} ผู้ติดตาม`}
                        {a.tier && ` · ${a.tier}`}
                        {a.link_account && <> · <a href={a.link_account} target="_blank" rel="noopener noreferrer">ลิงก์ช่อง</a></>}
                    </div>
                ))}
                <div className="solo-hero-meta">
                    {/* ฟอร์มไม่ถามช่องทางติดต่อแล้ว (5 ต.ค. 2026) — บอกเฉพาะการจ้างเก่าที่ผ่าน Agency */}
                    {sum.contact_mode === 'agency' && <>ผ่าน Agency: {sum.agency || sum.payee || '—'} · </>}
                    ผู้รับเงิน: {sum.payee || '—'} · ผู้ดูแล: {project.owner || '—'}
                    {project.start_date && <> · เพิ่มเมื่อ {fmtDate(project.start_date)}</>}
                </div>
                <div className="solo-hero-actions">
                    <button type="button" className="btn-ghost" disabled={busy || subsState !== 'ok'} onClick={() => setShowEdit(true)}
                        title={subsState === 'loading' ? 'กำลังโหลดรายการคลิป…' : subsState === 'error' ? 'โหลดรายการคลิปไม่สำเร็จ — กด F5' : undefined}>
                        <Icon name="edit" size={15} /> แก้ไขข้อมูล
                    </button>
                    {project.status !== 'Active' && (
                        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('Active')}>เปิดงานอีกครั้ง</button>
                    )}
                    {project.status === 'Active' && (
                        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('Cancelled', 'ยกเลิกการจ้างนี้? (ข้อมูลยังอยู่ เปิดงานอีกครั้งได้)')}>ยกเลิกการจ้าง</button>
                    )}
                    {/* ลบได้เฉพาะ Admin (ผู้ใช้สั่ง 7 ต.ค. 2026 · server ตรวจซ้ำ) — ทีมใช้ "ยกเลิกการจ้าง" แทน */}
                    {user?.role === 'admin' && (
                        <button type="button" className="btn-ghost solo-del" disabled={busy} onClick={remove}><Icon name="trash" size={15} /> ลบ</button>
                    )}
                </div>
                {subsState === 'error' && <div className="alert-error" style={{ marginTop: 12 }}>โหลดรายการคลิปไม่สำเร็จ — กด F5 แล้วลองใหม่</div>}
            </div>

            <div className="stat-grid solo-stats">
                <div className="stat-card">
                    <div className="stat-label">ค่าตัวต่อคลิป</div>
                    {livePlats.map(p => {
                        const rows = rowsOf(p);
                        const first = feeOf(rows[0]);
                        const uneven = rows.some(c => feeOf(c) !== first);
                        return (
                            <div className="solo-fee-row" key={p}>
                                {livePlats.length > 1 && <span className="solo-fee-plat">{p}</span>}
                                <div className="solo-fee-input">
                                    {/* 0 = ได้ฟรี ไม่ใช่ "ยังไม่ใส่" — ช่องโชว์ 0 ไม่ขึ้นสีเตือน */}
                                    <FeeInput value={first} missing={false} allowZero dirty={uneven}
                                        version={rows.map(c => `${c.id}:${feeOf(c)}`).join('|')} onSave={v => saveFee(p, v)} />
                                </div>
                                {uneven && <small className="fee-uneven">แต่ละคลิปไม่เท่ากัน — แก้แล้วทุกคลิปของ {p} จะเป็นยอดนี้</small>}
                            </div>
                        );
                    })}
                    {!livePlats.length && <span className="muted">—</span>}
                </div>
                <div className="stat-card">
                    <div className="stat-label">ค่าตัวรวม</div>
                    <div className="stat-value">{allFree ? 'ได้ฟรี' : baht(feeTotal)}</div>
                    <small className="muted">
                        {platCount > 1 ? `${posts} โพสต์ (${clipCount} คลิป × ${platCount} Platform)` : `${posts} คลิป`}
                    </small>
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

            {(platInfo.length > 0 || shared.length > 0 || project.brief_link || project.objective) && (
                <div className="panel solo-info">
                    {platInfo.map(({ p, items }) => (
                        <div className="solo-info-row" key={p}>
                            <span className="solo-info-plat">{p}</span>
                            {items.map(([k, v]) => <span key={k} className="solo-info-chip"><b>{k}:</b> {v}</span>)}
                        </div>
                    ))}
                    {(shared.length > 0 || project.brief_link) && (
                        <div className="solo-info-row">
                            {shared.map(([k, v]) => <span key={k} className="solo-info-chip"><b>{k}:</b> {v}</span>)}
                            {project.brief_link && <a className="solo-info-chip" href={project.brief_link} target="_blank" rel="noopener noreferrer">บรีฟ ↗</a>}
                        </div>
                    )}
                    {project.objective && (
                        <div className="solo-brief"><b>รายละเอียดบรีฟ</b><p>{project.objective}</p></div>
                    )}
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
                <SoloKolForm project={project} clipNames={Array.from(clipNames, n => n || '')}
                    // คลิปไม่ว่าง (มีดราฟ / Gencode / ID Post / ลงงาน / ยิงแอด) = เอา Platform ของคลิปออกไม่ได้ และลดจำนวนคลิปให้ต่ำกว่าคลิปนั้นไม่ได้
                    // — เกณฑ์เดียวกับ soloClipEmpty ฝั่ง server (updateSolo ดูทุกแถวคลิป) · ล็อกแบรนด์ยังใช้เกณฑ์คลิปเริ่มงาน (soloClipLive)
                    lockedPlatforms={editLimits.lockedPlatforms}
                    minClips={editLimits.minClips}
                    brandLocked={clips.some(clipLive)}
                    onClose={() => setShowEdit(false)}
                    onSaved={() => { setShowEdit(false); reload(); loadSubs(); }} />
            )}
        </div>
    );
}
