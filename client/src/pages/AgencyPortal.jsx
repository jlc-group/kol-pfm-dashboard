import { useEffect, useState, useRef } from 'react';
import ProductMultiSelect from '../components/ProductMultiSelect.jsx';
import AgencyReports from '../components/AgencyReports.jsx';
import ChatDock from '../components/ChatDock.jsx';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import OnProcessTable from '../components/OnProcessTable.jsx';
import StageCards from '../components/StageCards.jsx';
import ProductChips, { ProductSummary } from '../components/ProductChips.jsx';
import { productLabel } from '../data/products.js';
import { groupPlatforms, allocsInScope, contentTypesOf, mediaFor } from '../data/adGroups.js';
import { groupClips, clipCount, collapseByPerson, countPeople } from '../data/clips.js';
import { tabBadges, markSeen, seedDraftsSeen } from '../utils/tabUpdates.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ChangePasswordModal from '../components/ChangePasswordModal.jsx';
import { ROLE_LABEL } from '../data/brands.js';

// ค่าที่เก็บเป็นสตริงคั่นด้วย , (เช่น content_format) → แยกเป็นรายตัว
const splitCsv = v => (v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);

const PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'YouTube', 'X'];
const TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
const STATUS = {
    submitted: { label: 'รอคัดเลือก', cls: 'pay-wait' },
    confirmed: { label: 'คัดเลือกแล้ว ✓', cls: 'pay-done' },
    rejected: { label: 'ไม่ถูกเลือก', cls: 'pay-pending' }
};
const fmtNum = n => {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(v);
};
const emptyEntry = () => ({ account_name: '', platform: '', tier: '', product: '', agency: '', budget: '', link_account: '', saving: false });

// เลือก Product ได้หลายอันต่อ KOL 1 คน — เก็บค่าเป็นสตริงคั่นคอมมา, มีตัวเลือก "เลือกทุก Product"
// ใช้ native <select> (ไม่โดน overflow ของตารางบัง) + ชิปสินค้าที่เลือกไว้ (ลบได้)

// modal แก้ไขข้อมูล KOL ที่ส่งไปแล้ว
function EditSubmissionModal({ token, sub, products = [], onClose, onSaved, agencyName }) {
    const [f, setF] = useState({
        account_name: sub.account_name || '', platform: sub.platform || 'TikTok',
        followers: sub.followers ?? '', product: sub.product || '', agency: sub.agency || '',
        budget: sub.budget ?? '', link_account: sub.link_account || ''
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));

    async function submit(e) {
        e.preventDefault();
        if (!f.account_name.trim()) { setError('กรุณากรอกชื่อ Account'); return; }
        setError(''); setSaving(true);
        try {
            await api(`/agency/${token}/submissions/${sub.id}`, {
                method: 'PUT',
                body: {
                    account_name: f.account_name.trim(), platform: f.platform,
                    followers: Number(f.followers) || 0,
                    product: f.product || null, agency: agencyName || f.agency || null,
                    budget: Number(f.budget) || 0, link_account: f.link_account || null
                }
            });
            onSaved();
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head"><h3>แก้ไขข้อมูล KOL</h3><button className="modal-x" onClick={onClose}>×</button></div>
                {error && <div className="alert-error">{error}</div>}
                <form onSubmit={submit}>
                    <div className="field">
                        <label>ชื่อ Account *</label>
                        <input value={f.account_name} onChange={e => up('account_name', e.target.value)} placeholder="เช่น @username" required autoFocus />
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>Platform</label>
                            <select value={f.platform} onChange={e => up('platform', e.target.value)}>
                                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label>ยอดฟอล</label>
                            <input type="number" min="0" value={f.followers} onChange={e => up('followers', e.target.value)} placeholder="เช่น 25000" />
                        </div>
                    </div>
                    <div className="field">
                        <label>Product</label>
                        {products.length > 0 ? (
                            <ProductMultiSelect value={f.product} options={products} onChange={v => up('product', v)} />
                        ) : <input value={f.product} onChange={e => up('product', e.target.value)} placeholder="สินค้า" />}
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>KOL Contact</label>
                            {agencyName
                                ? <input value={agencyName} readOnly className="agency-locked" title="ชื่อเอเจนซี่ (จากลิงก์)" />
                                : <input value={f.agency} onChange={e => up('agency', e.target.value)} placeholder="KOL Contact" />}
                        </div>
                        <div className="field">
                            <label>Budget (฿)</label>
                            <input type="number" min="0" value={f.budget} onChange={e => up('budget', e.target.value)} placeholder="งบค่าตัว" />
                        </div>
                    </div>
                    <div className="field">
                        <label>Link Account</label>
                        <input type="url" value={f.link_account} onChange={e => up('link_account', e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// รายการ submission 1 อัน (ใช้ในลิสต์ของกลุ่ม/ไม่ระบุกลุ่ม)
// แถวที่บันทึกแล้ว — แสดงในตารางเดิม (ล็อกอ่านอย่างเดียว) ไม่เด้งไปลิสต์ด้านล่าง
function SavedGridRow({ s, n, group, onEdit, onDelete, onNote }) {
    // Format ไม่ได้เก็บในแถว — อ่านจากที่ตั้งไว้ในกลุ่มตาม Platform + Content Type
    const fmt = mediaFor(group, s.platform, s.content_type).content_format;
    const st = STATUS[s.status] || STATUS.submitted;
    const clips = s._clips || [s];          // แถวนี้ยุบมาจากกี่คลิป
    const perClipBudget = Number(clips[0]?.budget) || 0;
    return (
        <>
            <div className={'ag-add-row ag-saved-row' + (s.team_note ? ' has-note' : '')}>
                <div className="atr-name">
                    <span className="atr-num done">{n}</span>
                    <span className="ag-saved-name">{s.account_name}</span>
                    {clips.length > 1 && <span className="ag-clip-chip" title={clips.map(c => c.clip_name || `คลิป ${c.clip_no}`).join(" · ")}>{clips.length} คลิป</span>}
                    <span className={`status ${st.cls} ag-saved-status`}>{st.label}</span>
                </div>
                <span className="ag-saved-cell">{s.platform || '—'}</span>
                <span className="ag-saved-cell ag-ctype-cell">
                    {s.content_type
                        ? <><span className="proc-ctype-chip">{s.content_type}</span>
                            {fmt && <span className="proc-ctype-chip fmt">{fmt}</span>}</>
                        : <span className="ctype-none">— ยังไม่ระบุ —</span>}
                </span>
                <span className="ag-saved-cell">{Number(s.followers) > 0 ? Number(s.followers).toLocaleString('en-US') : '—'}</span>
                <span className="ag-saved-cell"><ProductSummary value={s.product} max={2} /></span>
                <span className="ag-saved-cell">{s.agency || '—'}</span>
                <span className="ag-saved-cell">
                    ฿{Number(s.budget || 0).toLocaleString('th-TH')}
                    {clips.length > 1 && <small className="ag-budget-split">฿{perClipBudget.toLocaleString('th-TH')} × {clips.length}</small>}
                </span>
                <span className="ag-saved-cell">{s.link_account ? <a href={s.link_account} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> ลิงก์</a> : '—'}</span>
                <div className="atr-action">
                    <button type="button" className="atr-edit" title="แก้ไขข้อมูล" onClick={() => onEdit(s)}><Icon name="edit" size={14} /></button>
                    <button type="button" className="atr-del" title="ลบรายชื่อนี้ออก" onClick={() => onDelete(s)}><Icon name="trash" size={14} /></button>
                </div>
            </div>
            {s.team_note && <div className="ag-team-note-banner">📝 <b>หมายเหตุจากทีม:</b> {s.team_note}</div>}
            {/* หมายเหตุของเอเจนซี่เอง — คนละช่องกับของทีม เขียนทับกันไม่ได้ */}
            <div className="ag-note-row">
                <span className="ag-note-lbl">📝 หมายเหตุถึงทีม</span>
                <input className="ag-note-input" defaultValue={s.agency_note || ''}
                    placeholder="เช่น คิวว่าง 20 ก.ย. / ขอเปลี่ยนสินค้า"
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (s.agency_note || '')) onNote(s, v); }} />
            </div>
        </>
    );
}

function SubItem({ s, onEdit }) {
    const st = STATUS[s.status] || STATUS.submitted;
    return (
        <div className={'agency-item' + (s.team_note ? ' has-note' : '')}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div className="agency-item-name">
                    {s.account_name}
                    {s.link_account && <a href={s.link_account} target="_blank" rel="noreferrer" className="agency-item-link"><Icon name="eye" size={12} /> ลิงก์</a>}
                    {s.team_note && <span className="ag-note-flag" title={s.team_note}>📝 หมายเหตุ</span>}
                </div>
                <div className="agency-item-meta">
                    {s.platform && <span>{s.platform}</span>}
                    {s.tier && <span>· {s.tier}</span>}
                    {s.product && <span>· <ProductSummary value={s.product} /></span>}
                    {s.agency && <span>· {s.agency}</span>}
                    <span>· ฿{Number(s.budget).toLocaleString('th-TH')}</span>
                </div>
                {s.team_note && <div className="ag-team-note-banner">📝 <b>หมายเหตุจากทีม:</b> {s.team_note}</div>}
            </div>
            <div className="agency-item-right">
                <span className={`status ${st.cls}`}>{st.label}</span>
                <button type="button" className="agency-item-edit" title="แก้ไขข้อมูล" onClick={() => onEdit(s)}><Icon name="edit" size={15} /></button>
            </div>
        </div>
    );
}

// section 1 กลุ่มสินค้า — โชว์ความต้องการ (Platform/Tier/จำนวน) + ฟอร์มใส่ชื่อ + ลิสต์ของกลุ่ม
function GroupSection({ token, group, gi, subs, onReload, onEdit, onDelete, onNote, agencyName, platformBudgets = {}, scopePlatforms = [], platFilter = 'all' }) {
    const groupProducts = group.products || [];
    const groupPlats = groupPlatforms(group);
    // เห็นแค่แถวของ Platform ที่เจ้านี้รับผิดชอบ ไม่ใช่ทั้งกลุ่ม
    const myAllocs = allocsInScope(group, platFilter === 'all' ? scopePlatforms : [platFilter]);
    const groupTiers = [...new Set(myAllocs.map(a => a.tier).filter(Boolean))];
    const myKol = myAllocs.reduce((s, a) => s + (Number(a.kols) || 0), 0);
    // API ส่งมาแบบใหม่สุดขึ้นก่อน — กลับด้านให้คนที่บันทึกทีหลังต่อท้ายลงมาเรื่อย ๆ
    const groupRows = subs.filter(s => s.group_key === group.key && (platFilter === 'all' || s.platform === platFilter))
        .slice().sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || '') || (a.id - b.id));
    // หน้านี้ = หน้าคัดเลือก "คน" จึงยุบแถวพี่น้อง (คนเดียวกันหลายคลิป) ให้เหลือคนละแถว
    const groupSubs = collapseByPerson(groupRows);
    const perClip = clipCount(group);              // กลุ่มนี้ 1 คนส่งกี่คลิป
    const clipNames = groupClips(group);
    const total = myKol || group.kol_count || 0;

    // Budget ของกลุ่มนี้ (สำหรับปุ่มหารเฉลี่ยแบบเหมาราคา) — ใช้งบต่อกลุ่ม, ถ้าข้อมูลเดิมไม่มีค่อย fallback งบต่อ Platform
    const groupPlatform = groupPlats[0] || null;
    const totalClips = (Number(group.kol_count) || 0) * perClip;   // เป้าจำนวนคลิปทั้งกลุ่ม
    const groupBudget = (group.budget != null && group.budget !== '')
        ? (Number(group.budget) || 0)
        : (groupPlatform ? (Number(platformBudgets[groupPlatform]) || 0) : 0);
    // งบเป็นต่อคลิป เพราะเวลายิงแอดคิดจากงบของคลิปนั้น ๆ
    const perHead = (groupBudget > 0 && totalClips > 0) ? Math.round(groupBudget / totalClips) : 0;
    const perUnit = perClip > 1 ? 'คลิป' : 'คน';
    const fmtBaht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');

    // จำว่ากลุ่มนี้ "หารเฉลี่ยแล้ว" (ต่อ token+group) เพื่อให้แถวใหม่เติมยอดต่อหัวอัตโนมัติ แม้รีเฟรชหน้า
    const divKey = `agdiv_${token}_${group.key}`;
    const [divided, setDivided] = useState(() => { try { return localStorage.getItem(divKey) === '1'; } catch { return false; } });
    const autoBudget = (divided && perHead > 0) ? String(perHead) : '';

    // ไม่เลือก Platform ให้ล่วงหน้า — กันกรอกผิดช่องทางโดยไม่ทันสังเกต
    const blank = () => ({ account_name: '', platform: '', content_type: '', followers: '', product: '', agency: '', budget: autoBudget, link_account: '', saving: false });
    const [rows, setRows] = useState([blank()]);
    const [err, setErr] = useState('');
    const upRow = (i, k, v) => setRows(rs => rs.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
    const addRow = () => setRows(rs => [...rs, blank()]);
    const removeRow = i => setRows(rs => rs.length === 1 ? [blank()] : rs.filter((_, idx) => idx !== i));
    // เหมาราคา: หารงบกลุ่มเท่าๆ กัน แล้ว "จำ" ไว้ทั้งกลุ่ม — ทับทุกคน (ทั้งแถวที่กรอก + คนที่บันทึกแล้ว) ให้เท่ากันหมด
    async function divideBudget() {
        if (perHead <= 0) return;
        setDivided(true);
        try { localStorage.setItem(divKey, '1'); } catch { /* ignore */ }
        setRows(rs => rs.map(r => (r.saving ? r : { ...r, budget: String(perHead) })));   // ทับทุกแถวที่กำลังกรอก
        // ทับ Budget ของคนที่บันทึกแล้วทุกคนในกลุ่มบนเซิร์ฟเวอร์
        const toUpdate = groupRows.filter(s => (Number(s.budget) || 0) !== perHead);   // ทุกแถวคลิป
        if (toUpdate.length) {
            try {
                await Promise.all(toUpdate.map(s => api(`/agency/${token}/submissions/${s.id}`, { method: 'PUT', body: { budget: perHead } })));
                onReload();
            } catch (e) { setErr(e.message); }
        }
    }

    // ล้าง Budget ทั้งกลุ่ม — เผื่อกดหารเฉลี่ยผิด หรืออยากกลับไปกรอกทีละคน
    // ทับของจริงบนเซิร์ฟเวอร์ด้วย เลยถามยืนยันก่อนเสมอ
    async function clearBudget() {
        const hasBudget = groupRows.filter(x => (Number(x.budget) || 0) > 0);   // ทุกแถวคลิป
        const msg = hasBudget.length
            ? `ล้าง Budget ของกลุ่มนี้?\nคนที่บันทึกไปแล้ว ${hasBudget.length} คน จะถูกตั้งเป็น 0 ด้วย`
            : 'ล้าง Budget ที่กรอกค้างไว้ในกลุ่มนี้?';
        if (!window.confirm(msg)) return;
        setDivided(false);
        try { localStorage.removeItem(divKey); } catch { /* ignore */ }
        setRows(rs => rs.map(r => (r.saving ? r : { ...r, budget: '' })));
        if (hasBudget.length) {
            try {
                await Promise.all(hasBudget.map(x => api(`/agency/${token}/submissions/${x.id}`, { method: 'PUT', body: { budget: 0 } })));
                onReload();
            } catch (e) { setErr(e.message); }
        }
    }

    async function saveRow(i) {
        const en = rows[i];
        if (!en.account_name.trim()) { setErr('กรุณากรอกชื่อ Account'); return; }
        if (!en.platform) { setErr('กรุณาเลือก Platform'); return; }
        if (contentTypesOf(group, en.platform).length > 0 && !en.content_type) { setErr('กรุณาเลือก Content Type'); return; }
        setErr(''); upRow(i, 'saving', true);
        try {
            await api(`/agency/${token}`, {
                method: 'POST',
                body: {
                    account_name: en.account_name.trim(), platform: en.platform, followers: Number(en.followers) || 0,
                    content_type: en.content_type || null,
                    product: en.product || null, agency: agencyName || en.agency || null, budget: Number(en.budget) || 0,
                    link_account: en.link_account || null, group_key: group.key
                }
            });
            setRows(rs => rs.length === 1 ? [blank()] : rs.filter((_, idx) => idx !== i)); // ลบแถวที่บันทึกแล้ว
            onReload();
        } catch (e) { setErr(e.message); upRow(i, 'saving', false); }
    }

    return (
        <div className="agency-card ag-group">
            <div className="ag-group-head">
                <div>
                    <span className="ag-group-no">กลุ่มที่ {gi + 1} <span className="adg-count">({groupProducts.length} สินค้า)</span></span>
                    {group.concept && <div className="ag-concept-top">📝 Concept: <b>{group.concept}</b></div>}
                    {(group.content_type || group.media_type || group.content_format) && (
                        <div className="ag-group-req">
                            {group.content_type && <span className="proc-ctype-chip">{group.content_type}</span>}
                            {group.media_type && <span className="proc-ctype-chip media">{group.media_type}</span>}
                            {splitCsv(group.content_format).map(x => <span className="proc-ctype-chip fmt" key={x}>{x}</span>)}
                        </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                        <ProductChips products={groupProducts} />
                    </div>
                </div>
                <div className="ag-group-prog">
                    <div className="ag-group-prog-num">{groupSubs.length}<span>/{total}</span></div>
                    <div className="ag-group-prog-lbl">คน · ส่งแล้ว / ต้องการ</div>
                    {perClip > 1 && <div className="ag-group-prog-clip">{groupRows.length}/{totalClips} คลิป</div>}
                </div>
            </div>

            {group.brief && <a className="brief-link ag-group-brief" href={group.brief} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> เปิดบรีฟกลุ่มนี้</a>}
            {myAllocs.length > 0 && (
                <div className="ag-group-allocs">
                    {myAllocs.map((a, ai) => (
                        <span className="chip-alloc" key={ai}>
                            {a.content_type ? a.content_type + ' · ' : ''}{a.tier} · {a.kols} คน
                        </span>
                    ))}
                </div>
            )}

            {err && <div className="alert-error">{err}</div>}
            {groupBudget > 0 && (
                <div className="ag-budget-bar">
                    <span className="ag-budget-info">
                        💰 Budget กลุ่มนี้ <b>{fmtBaht(groupBudget)}</b> · ต้องการ {total} คน
                        {perClip > 1 && <span className="ag-clip-note"> × {perClip} คลิป = {totalClips} คลิป</span>}
                        {divided && <span className="ag-divided-tag">✓ หารเฉลี่ยแล้ว {fmtBaht(perHead)}/{perUnit} (แถวใหม่เติมอัตโนมัติ)</span>}
                    </span>
                    {/* จับสองปุ่มเป็นกลุ่มเดียว จะได้เกาะกันชิดขวาเสมอ แม้ตอนข้อความยาวจนตกบรรทัด */}
                    <div className="ag-budget-actions">
                        <button type="button" className={'ag-divide-btn' + (divided ? ' on' : '')} onClick={divideBudget} disabled={perHead <= 0}
                            title="เหมาราคา: หารงบเท่าๆ กันทุกคน แล้วจำไว้ทั้งกลุ่ม (ทับ Budget ทุกคน + แถวใหม่เติมให้อัตโนมัติ)">
                            {divided ? `↻ ทับใหม่ (${fmtBaht(perHead)}/${perUnit})` : `= หารเฉลี่ยเท่ากัน (${fmtBaht(perHead)}/${perUnit})`}
                        </button>
                        <button type="button" className="ag-clear-btn" onClick={clearBudget}
                            disabled={!divided && !groupRows.some(x => (Number(x.budget) || 0) > 0) && !rows.some(r => r.budget)}
                            title="ล้าง Budget ของทุกคนในกลุ่มนี้ กลับไปกรอกทีละคนเอง">
                            ล้างงบ
                        </button>
                    </div>
                </div>
            )}
            <div className="ag-add-scroll">
                <div className="ag-add-grid">
                    <div className="ag-add-head"><span>NAME</span><span>PLATFORM</span><span>CONTENT TYPE</span><span>FOLLOWER</span><span>PRODUCT</span><span>AGENCY</span><span>BUDGET</span><span>LINK ACCOUNT</span><span /></div>
                    {groupSubs.map((s, si) => <SavedGridRow key={s.id} s={s} n={si + 1} group={group} onEdit={onEdit} onDelete={onDelete} onNote={onNote} />)}
                    {rows.map((en, i) => (
                        <div className="ag-add-row" key={i}>
                            <div className="atr-name"><span className="atr-num">{groupSubs.length + i + 1}</span><input value={en.account_name} onChange={e => upRow(i, 'account_name', e.target.value)} placeholder="ชื่อ Account" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRow(i); } }} /></div>
                            <select value={en.platform} onChange={e => { upRow(i, 'platform', e.target.value); upRow(i, 'content_type', ''); }}>
                                <option value="">— เลือก —</option>
                                {(groupPlats.length ? groupPlats : PLATFORMS).map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            {/* Content Type — 1 Platform อาจมีหลายอย่างในกลุ่มเดียว จึงต้องให้เลือกเอง */}
                            {(() => {
                                const opts = en.platform ? contentTypesOf(group, en.platform) : [];
                                return (
                                    <select value={en.content_type} disabled={!en.platform || opts.length === 0}
                                        onChange={e => upRow(i, 'content_type', e.target.value)}
                                        title={en.platform ? '' : 'เลือก Platform ก่อน'}>
                                        <option value="">{!en.platform ? '— เลือก Platform ก่อน —' : (opts.length ? '— เลือก —' : '— ไม่มีให้เลือก —')}</option>
                                        {opts.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                );
                            })()}
                            <input type="number" min="0" value={en.followers} onChange={e => upRow(i, 'followers', e.target.value)} placeholder="ยอดฟอล" />
                            <ProductMultiSelect value={en.product} options={groupProducts} onChange={v => upRow(i, 'product', v)} />
                            {agencyName
                                ? <input value={agencyName} readOnly className="agency-locked" title="ชื่อเอเจนซี่ (จากลิงก์)" />
                                : <input value={en.agency} onChange={e => upRow(i, 'agency', e.target.value)} placeholder="Contact" />}
                            <input type="number" min="0" value={en.budget} onChange={e => upRow(i, 'budget', e.target.value)} placeholder="฿" />
                            <input type="url" value={en.link_account} onChange={e => upRow(i, 'link_account', e.target.value)} placeholder="https://..." />
                            <div className="atr-action">
                                <button type="button" className="atr-ok" title="บันทึกรายชื่อนี้" disabled={en.saving} onClick={() => saveRow(i)}>✓</button>
                                <button type="button" className="atr-x" title="ลบแถว" onClick={() => removeRow(i)}>×</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <button type="button" className="agency-add-row" onClick={addRow}><Icon name="plus" size={15} /> เพิ่มรายชื่อ</button>
        </div>
    );
}

export default function AgencyPortal() {
    const { token } = useParams();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [showPw, setShowPw] = useState(false);   // โมดัลเปลี่ยนรหัสผ่านของตัวเอง
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [entries, setEntries] = useState([emptyEntry()]);
    const [savedMsg, setSavedMsg] = useState('');
    const [tab, setTab] = useState('list'); // list | process
    const [editSub, setEditSub] = useState(null); // KOL ที่กำลังแก้ไข
    const [stage, setStage] = useState('all');    // ตัวกรองขั้นงานจากการ์ดสรุป
    const [platFilter, setPlatFilter] = useState('all');   // ดูทีละ Platform เมื่อเจ้านี้รับหลาย Platform
    const [badges, setBadges] = useState({ listNew: false, processNew: false });
    const [toasts, setToasts] = useState([]);       // แจ้งเตือนเด้งอัตโนมัติ (Feedback/สถานะดราฟจากทีม)
    const toastId = useRef(0);
    const prevSnap = useRef(null);                   // สถานะ Feedback/ดราฟรอบก่อน (ไว้เทียบหาของใหม่)
    const pushToast = (text, kind = 'info') => {
        const id = ++toastId.current;
        setToasts(ts => [...ts, { id, text, kind }]);
        setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 9000);
    };

    function load() {
        api(`/agency/${token}`).then(res => setInfo(res.data)).catch(err => setError(err.message));
    }
    useEffect(() => { load(); }, [token]);
    // บันทึกหมายเหตุของเอเจนซี่ (ไม่ต้อง reload ทั้งหน้า — ค่าอยู่ในช่องอยู่แล้ว)
    async function saveNote(sub, text) {
        try { await api(`/agency/${token}/submissions/${sub.id}`, { method: 'PUT', body: { agency_note: text || null } }); }
        catch (err) { alert(err.message); }
    }

    // ลบรายชื่อของตัวเองออก — ถ้าทีมคัดเลือกไปแล้วต้องเตือนให้หนักกว่าเดิม
    async function deleteSub(sub) {
        const picked = sub.status === 'confirmed';
        const warn = picked
            ? `\n⚠️ ทีมคัดเลือก "${sub.account_name}" ไปแล้ว ลบแล้วงานที่บันทึกไว้จะหายไปด้วย`
            : '';
        if (!window.confirm(`ลบ "${sub.account_name}" ออกจากรายชื่อ?${warn}\nลบแล้วกู้คืนไม่ได้`)) return;
        try {
            await api(`/agency/${token}/submissions/${sub.id}`, { method: 'DELETE' });
            load();
        } catch (err) { alert(err.message); }
    }


    // แจ้งเตือนแท็บ: เปิดแท็บไหนอยู่ = เห็นแล้ว, แท็บอื่นเด้ง badge ถ้าทีมมีอัปเดตใหม่ (รอโหลดข้อมูลก่อนค่อย seed)
    useEffect(() => {
        if (!info) return;
        const subs = info.submissions || [];
        seedDraftsSeen(token, subs);
        markSeen(token, tab, subs);
        setBadges(tabBadges(token, subs));
    }, [info, tab, token]);

    // ตรวจจับ Feedback / สถานะดราฟใหม่จากทีม แล้วเด้งแจ้งเตือนอัตโนมัติ (ไม่ต้องรีเฟรช)
    useEffect(() => {
        if (!info) return;
        const subs = info.submissions || [];
        const snap = {};
        subs.forEach(s => {
            snap[s.id] = {
                fb: [s.feedback, s.feedback2, s.feedback3, s.feedback4, s.feedback5].map(x => x || '').join('¦'),
                st: s.draft_status || '',
                name: s.account_name
            };
        });
        const prev = prevSnap.current;
        if (prev) {   // ข้ามรอบแรก (กันเด้งย้อนหลัง) — เด้งเฉพาะที่เปลี่ยนจริงระหว่าง poll
            subs.forEach(s => {
                const p = prev[s.id]; const c = snap[s.id];
                if (!p) return;
                if (c.fb !== p.fb && c.fb.replace(/¦/g, '').trim()) {
                    pushToast(`💬 มี Feedback ใหม่จากทีม: ${c.name} — เปิด View Draft เพื่อดู`, 'fb');
                } else if (c.st !== p.st && c.st) {
                    const label = c.st === 'approve' ? 'อนุมัติดราฟแล้ว ✓' : c.st === 'revise' ? 'ขอให้แก้ไขดราฟ ↻' : c.st;
                    pushToast(`🔔 ทีมอัปเดตสถานะดราฟ: ${c.name} — ${label}`, c.st === 'approve' ? 'ok' : 'warn');
                }
            });
        }
        prevSnap.current = snap;
    }, [info]);

    // โหลดซ้ำเป็นระยะ เพื่อเห็นอัปเดตจากฝั่งทีมแบบไม่ต้องรีเฟรช
    useEffect(() => {
        const t = setInterval(load, 20000);
        return () => clearInterval(t);
    }, [token]);

    function updateEntry(i, k, v) { setEntries(es => es.map((e, idx) => idx === i ? { ...e, [k]: v } : e)); }
    function addEntry() { setEntries(es => [...es, emptyEntry()]); }
    function removeEntry(i) { setEntries(es => es.length === 1 ? [emptyEntry()] : es.filter((_, idx) => idx !== i)); }

    async function saveRow(i) {
        const en = entries[i];
        // บังคับกรอกให้ครบทุกช่อง
        const miss = [];
        if (!en.account_name.trim()) miss.push('ชื่อ Account');
        if (!en.platform) miss.push('Platform');
        if (!en.tier) miss.push('Tier');
        if (!String(en.product).trim()) miss.push('Product');
        if (!info.agency_name && !en.agency.trim()) miss.push('Agency');
        if (!en.budget || Number(en.budget) <= 0) miss.push('Budget');
        if (!en.link_account.trim()) miss.push('Link Account');
        if (miss.length) { setError('กรุณากรอกให้ครบทุกช่อง: ' + miss.join(', ')); return; }
        setError('');
        updateEntry(i, 'saving', true);
        try {
            await api(`/agency/${token}`, {
                method: 'POST',
                body: {
                    account_name: en.account_name.trim(),
                    platform: en.platform,
                    tier: en.tier || null,
                    product: en.product || null,
                    agency: info.agency_name || en.agency || null,
                    budget: Number(en.budget) || 0,
                    link_account: en.link_account || null
                }
            });
            // ลบแถวที่บันทึกแล้ว (คงไว้อย่างน้อย 1 แถวว่าง)
            setEntries(es => es.length === 1 ? [emptyEntry()] : es.filter((_, idx) => idx !== i));
            setSavedMsg(`✓ บันทึก "${en.account_name}" แล้ว`);
            load();
            setTimeout(() => setSavedMsg(''), 3000);
        } catch (err) {
            setError(err.message);
            updateEntry(i, 'saving', false);
        }
    }

    if (error && !info) return <div className="agency-page"><div className="agency-card"><div className="alert-error">{error}</div></div></div>;
    if (!info) return <div className="agency-page"><div className="empty" style={{ padding: 60 }}>กำลังโหลด...</div></div>;

    const subs = info.submissions || [];
    // products อาจเป็น string (ข้อมูลเดิม) หรือ { name, target } → ใช้เฉพาะชื่อในหน้า Agency
    const products = (info.products || []).map(p => (typeof p === 'string' ? p : p.name));
    // ขอบเขตงานที่เอเจนซี่เจ้านี้รับผิดชอบ (ถ้าทีมกำหนดไว้)
    const scope = info.agency_scope || {};
    const scopeProducts = scope.products || [];
    const scopePlatforms = scope.platforms || [];
    // Platform ที่เจ้านี้รับผิดชอบจริง — ถ้าลิงก์ไม่ได้จำกัดไว้ ใช้ Platform ที่มีอยู่ในกลุ่มที่เห็น
    const myPlatforms = scopePlatforms.length
        ? scopePlatforms
        : [...new Set((info.ad_groups || []).flatMap(g => groupPlatforms(g)))];
    const scopeKol = scope.kol_count || 0;
    const formProducts = scopeProducts.length ? scopeProducts : products;   // จำกัดสินค้าในฟอร์มตามที่รับผิดชอบ
    // บรีฟต่อสินค้า เฉพาะของเจ้านี้
    const briefEntries = Object.entries(info.product_briefs || {}).filter(([, b]) => b && (b.link || b.file));
    const openBriefFile = code => window.open(`/api/agency/${token}/product-brief/${encodeURIComponent(code)}/file`, '_blank');
    // บรีฟตาม Platform เลิกใช้แล้ว (ซ้ำกับบรีฟหลักของแคมเปญ) เหลือบรีฟหลัก + บรีฟต่อสินค้า
    const mainBrief = info.brief_link || null;   // บรีฟหลักของแคมเปญ (ทั้งแคมเปญ ไม่แยก Platform/สินค้า)
    const isAgencyLink = !!info.agency_name;                 // ลิงก์แยกต่อเจ้า (ไม่ใช่ลิงก์รวมเดิม)
    const platformBudgets = info.platform_budgets || {};     // งบต่อ Platform เฉพาะที่รับผิดชอบ
    const budgetEntries = Object.entries(platformBudgets).filter(([, v]) => Number(v) > 0);
    const fmtBaht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
    const displayTarget = scopeKol > 0 ? scopeKol : (info.kol_target || 0); // เป้าหมาย KOL ที่เจ้านี้รับผิดชอบ
    const adGroups = info.ad_groups || [];
    const groupKeys = new Set(adGroups.map(g => g.key));
    const ungrouped = subs.filter(s => !s.group_key || !groupKeys.has(s.group_key));

    return (
        <div className="agency-page">
            {/* แจ้งเตือนเด้งอัตโนมัติ (มุมขวาบน) */}
            {toasts.length > 0 && (
                <div className="ag-toasts">
                    {toasts.map(t => (
                        <div className={'ag-toast ' + (t.kind || 'info')} key={t.id}>
                            <span>{t.text}</span>
                            <button type="button" onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} title="ปิด">×</button>
                        </div>
                    ))}
                </div>
            )}
            <div className="agency-wrap wide">
                {/* แถบบัญชีที่ล็อกอินอยู่ — หน้านี้ไม่มีเมนูด้านข้าง ปุ่มพวกนี้เลยต้องอยู่ตรงนี้ */}
                {user && (
                    <div className="ag-account">
                        <div className="ag-account-who">
                            <Icon name="users" size={15} />
                            <span className="ag-account-name">{user.username}</span>
                            <span className="ag-account-role">{ROLE_LABEL[user.role] || user.role}</span>
                        </div>
                        <div className="ag-account-btns">
                            <button type="button" className="btn-changepw" onClick={() => setShowPw(true)}>
                                <Icon name="edit" size={14} /> เปลี่ยนรหัสผ่าน
                            </button>
                            <button type="button" className="btn-logout" onClick={() => { logout(); navigate("/login"); }}>
                                <Icon name="logout" size={15} /> ออกจากระบบ
                            </button>
                        </div>
                    </div>
                )}
                {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
                {/* หัวเรื่อง */}
                <div className="agency-hero">
                    <div className="agency-hero-badge"><Icon name="star" size={22} /></div>
                    <div>
                        <div className="agency-hero-sub">แบบฟอร์มส่งรายชื่อ Influencer{info.agency_name ? ` · สำหรับ ${info.agency_name}` : ''}</div>
                        <h1 className="agency-hero-title">{info.project_name}</h1>
                        <div className="agency-hero-meta">
                            {info.brand && <span className="pd-chip"><Icon name="tag" size={12} /> {info.brand}</span>}
                            {info.agency_name && <span className="pd-chip"><Icon name="users" size={12} /> {info.agency_name}</span>}
                        </div>
                    </div>
                </div>

                {/* ข้อมูลแคมเปญ */}
                <div className="agency-card agency-info">
                    <h3>ข้อมูลแคมเปญ</h3>
                    <div className="agency-info-grid">
                        <div className="agency-info-item span2">
                            <div className="agency-info-k">รายละเอียดแคมเปญ</div>
                            <div className="agency-info-v">{info.objective || '—'}</div>
                        </div>
                        <div className="agency-info-item">
                            <div className="agency-info-k">จำนวน KOL ที่คัดเลือกแล้ว</div>
                            <div className="agency-info-v big">{countPeople(subs.filter(s => s.status === 'confirmed'))} <span className="agency-info-unit">{displayTarget ? `/ เป้าหมาย ${displayTarget} คน` : `/ ส่งมา ${countPeople(subs)} คน`}</span></div>
                        </div>
                        <div className="agency-info-item">
                            <div className="agency-info-k">สินค้าที่คุณรับผิดชอบ {formProducts.length > 0 && <span className="adg-count">({formProducts.length})</span>}</div>
                            <div style={{ marginTop: 4 }}><ProductChips products={formProducts} /></div>
                        </div>
                        <div className="agency-info-item">
                            <div className="agency-info-k">Platform ที่รับผิดชอบ</div>
                            <div>{scopePlatforms.length ? <div className="chip-list" style={{ marginTop: 4 }}>{scopePlatforms.map(p => <span className="chip-item" key={p} style={{ padding: '4px 11px' }}>{p}</span>)}</div> : <span className="muted">ทุก Platform</span>}</div>
                        </div>
                        {budgetEntries.length > 0 && (
                            <div className="agency-info-item span2">
                                <div className="agency-info-k">Budget (ต่อ Platform)</div>
                                <div className="ag-budget-list" style={{ marginTop: 4 }}>
                                    {budgetEntries.map(([pf, v]) => (
                                        <span className="ag-budget-chip" key={pf}>{pf} · <b>{fmtBaht(v)}</b></span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* บรีฟของเจ้านี้ — บรีฟหลักของแคมเปญ + บรีฟต่อสินค้า */}
                {(mainBrief || briefEntries.length > 0) && (
                    <div className="agency-card">
                        <h3>📄 บรีฟงานของคุณ <span className="dash-section-sub">บรีฟหลักของแคมเปญ และบรีฟของสินค้าที่คุณรับผิดชอบ</span></h3>
                        {mainBrief && (
                            <>
                                <div className="pbrief-group-lbl">บรีฟหลักของแคมเปญ</div>
                                <div className="pbrief-view-list" style={{ marginBottom: briefEntries.length ? 16 : 0 }}>
                                    <div className="pbrief-view">
                                        <span className="pbrief-view-name">📋 ทั้งแคมเปญ</span>
                                        <a className="brief-link" href={mainBrief} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> เปิดลิงก์บรีฟ</a>
                                    </div>
                                </div>
                            </>
                        )}
                        {briefEntries.length > 0 && (
                            <>
                                <div className="pbrief-group-lbl">บรีฟต่อสินค้า</div>
                                <div className="pbrief-view-list">
                                    {briefEntries.map(([code, b]) => (
                                        <div className="pbrief-view" key={code}>
                                            <span className="pbrief-view-name">{productLabel(code)}</span>
                                            {b.link && <a className="brief-link" href={b.link} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> เปิดลิงก์บรีฟ</a>}
                                            {b.file && <button type="button" className="brief-link pbrief-file-open" onClick={() => openBriefFile(code)}><Icon name="file" size={14} /> {b.file.original}</button>}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* แท็บ */}
                <div className="agency-tabs">
                    <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
                        Influencers List
                        {badges.listNew && <span className="tab-new-dot" title="มีอัปเดตใหม่" />}
                    </button>
                    <button className={tab === 'process' ? 'active' : ''} onClick={() => setTab('process')}>
                        On Process {subs.filter(s => s.status === 'confirmed').length > 0 && <span className="agency-tab-count">{subs.filter(s => s.status === 'confirmed').length}</span>}
                        {badges.processNew && <span className="tab-new-dot" title="มีอัปเดตใหม่" />}
                    </button>
                </div>

                {/* ดูทีละ Platform — โชว์เมื่อเจ้านี้รับผิดชอบมากกว่า 1 Platform */}
                {myPlatforms.length > 1 && (
                    <div className="proc-platfilter ag-platfilter">
                        <span className="proc-platfilter-lbl">แพลตฟอร์ม:</span>
                        <button type="button" className={'proc-plat-chip' + (platFilter === 'all' ? ' on' : '')}
                            onClick={() => setPlatFilter('all')}>ทั้งหมด ({countPeople(subs)})</button>
                        {myPlatforms.map(p => (
                            <button type="button" key={p} className={'proc-plat-chip' + (platFilter === p ? ' on' : '')}
                                onClick={() => setPlatFilter(p)}>
                                {p} ({countPeople(subs.filter(s => s.platform === p))})
                            </button>
                        ))}
                    </div>
                )}

                {/* ===== แท็บ Influencers List ===== */}
                {tab === 'list' && <>
                    {savedMsg && <div className="agency-saved">{savedMsg}</div>}

                    {adGroups.length > 0 ? (
                        <>
                            {adGroups.map((g, gi) => (
                                <GroupSection key={g.key || gi} token={token} group={g} gi={gi} subs={subs} onReload={load} onEdit={setEditSub} onDelete={deleteSub} onNote={saveNote} agencyName={info.agency_name} platformBudgets={platformBudgets} scopePlatforms={scopePlatforms} platFilter={platFilter} />
                            ))}
                            {ungrouped.length > 0 && (
                                <div className="agency-card">
                                    <h3>ไม่ระบุกลุ่ม ({ungrouped.length}) <span className="dash-section-sub">รายชื่อที่ยังไม่ถูกจัดกลุ่ม</span></h3>
                                    <div className="agency-list">{ungrouped.map(s => <SubItem key={s.id} s={s} onEdit={setEditSub} />)}</div>
                                </div>
                            )}
                            <p className="agency-note">เมื่อทีมคัดเลือกแล้ว สถานะจะเปลี่ยนเป็น "คัดเลือกแล้ว ✓" ที่นี่ทันที</p>
                        </>
                    ) : (
                        <>
                            {/* กรณีไม่มีกลุ่มสินค้า — ฟอร์มเดี่ยวแบบเดิม */}
                            <div className="agency-card">
                                <h3>เพิ่มรายชื่อ Influencer <span className="dash-section-sub">กรอกทีละแถว กด ✓ เพื่อบันทึก</span></h3>
                                {error && <div className="alert-error">{error}</div>}
                                <div className="agency-tbl-scroll">
                                    <div className="agency-tbl">
                                        <div className="agency-tbl-head">
                                            <span>NAME</span><span>PLATFORM</span><span>TIER</span><span>PRODUCT</span><span>AGENCY</span>
                                            <span>BUDGET</span><span>LINK ACCOUNT</span><span className="ta-c">ACTION</span>
                                        </div>
                                        {entries.map((en, i) => (
                                            <div className="agency-tbl-row" key={i}>
                                                <div className="atr-name">
                                                    <Avatar name={en.account_name || '?'} size={38} />
                                                    <input value={en.account_name} onChange={e => updateEntry(i, 'account_name', e.target.value)} placeholder="ชื่อ Account" />
                                                </div>
                                                <select value={en.platform} onChange={e => updateEntry(i, 'platform', e.target.value)}>
                                                    <option value="">— เลือก —</option>
                                                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                                <select value={en.tier} onChange={e => updateEntry(i, 'tier', e.target.value)}>
                                                    <option value="">— Tier —</option>
                                                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                                {formProducts.length > 0 ? (
                                                    <ProductMultiSelect value={en.product} options={formProducts} onChange={v => updateEntry(i, 'product', v)} placeholder="— Product —" />
                                                ) : (
                                                    <input value={en.product} onChange={e => updateEntry(i, 'product', e.target.value)} placeholder="Product" />
                                                )}
                                                {info.agency_name
                                                    ? <input value={info.agency_name} readOnly className="agency-locked" title="ชื่อเอเจนซี่ (จากลิงก์)" />
                                                    : <input value={en.agency} onChange={e => updateEntry(i, 'agency', e.target.value)} placeholder="KOL Contact" />}
                                                <input type="number" min="0" value={en.budget} onChange={e => updateEntry(i, 'budget', e.target.value)} placeholder="฿ Budget" />
                                                <input type="url" value={en.link_account} onChange={e => updateEntry(i, 'link_account', e.target.value)} placeholder="https://..." />
                                                <div className="atr-action">
                                                    <button type="button" className="atr-ok" title="บันทึก" disabled={en.saving} onClick={() => saveRow(i)}>✓</button>
                                                    <button type="button" className="atr-x" title="ลบแถว" onClick={() => removeEntry(i)}>×</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <button type="button" className="agency-add-row" onClick={addEntry}><Icon name="plus" size={15} /> เพิ่มอีกแถว</button>
                            </div>
                            <div className="agency-card">
                                <h3>รายชื่อที่ส่งแล้ว ({countPeople(subs)})</h3>
                                {subs.length === 0 ? (
                                    <p className="empty" style={{ padding: '20px 0' }}>ยังไม่มีรายชื่อ — เพิ่มด้านบนได้เลย</p>
                                ) : (
                                    <div className="agency-list">{subs.map(s => <SubItem key={s.id} s={s} onEdit={setEditSub} />)}</div>
                                )}
                                <p className="agency-note">เมื่อทีมคัดเลือกแล้ว สถานะจะเปลี่ยนเป็น "คัดเลือกแล้ว ✓" ที่นี่ทันที</p>
                            </div>
                        </>
                    )}
                </>}

                {/* ===== แท็บ On Process (อัปเดตงาน) ===== */}
                {tab === 'process' && (
                    <div className="agency-card">
                        <h3>On Process <span className="dash-section-sub">อัปเดตงานของ KOL ที่ถูกคัดเลือกแล้ว</span></h3>
                        <StageCards subs={subs} value={stage} onChange={setStage} />
                        <OnProcessTable
                            subs={subs}
                            stage={stage} onClearStage={() => setStage('all')}
                            groups={adGroups}
                            scope={token}
                            directEdit
                            putSubmission={(subId, payload) => api(`/agency/${token}/submissions/${subId}`, { method: 'PUT', body: payload })}
                            reload={load}
                        />
                    </div>
                )}
            </div>


            <AgencyReports token={token} reports={info.reports || []} onReload={load} />

            <ChatDock
                base={`/agency/${token}/messages`}
                imageBase={`/agency/${token}/messages`}
                streamPath={`/agency/${token}/stream`}
                side="agency"
                title="คุยกับทีม"
                subtitle={info.project_name}
            />

            {editSub && (
                <EditSubmissionModal
                    token={token}
                    sub={editSub}
                    products={products}
                    agencyName={info.agency_name}
                    onClose={() => setEditSub(null)}
                    onSaved={() => { setEditSub(null); load(); setSavedMsg('✓ แก้ไขข้อมูลแล้ว'); setTimeout(() => setSavedMsg(''), 3000); }}
                />
            )}
        </div>
    );
}
