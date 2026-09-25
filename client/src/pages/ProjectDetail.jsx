import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, openFile } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import OtherProjectDetail from './OtherProjectDetail.jsx';
import OnProcessTable from '../components/OnProcessTable.jsx';
import ProductChips, { ProductSummary } from '../components/ProductChips.jsx';
import ConceptLines from '../components/ConceptLines.jsx';
import GroupNeedHead, { groupClipNeed } from '../components/GroupNeedHead.jsx';
import ProductMultiSelect from '../components/ProductMultiSelect.jsx';
import { unreadCount } from '../components/MessageBox.jsx';
import ChatDock from '../components/ChatDock.jsx';
import { productLabel, asTargetArray } from '../data/products.js';
import {
    groupPlatforms, kolInScope, contentTypesOf, mediaFor, quotaOf,
    toBlocks, blockKol, blocksKol, blocksBudget, num, needTarget, isSplitBudget, hasOwnConcepts,
    contentCells, cellKeyOf, cellKey, clipCountFor, targetFor, groupNoGencode, productsFor, allocsInScope
} from '../data/adGroups.js';
import { collapseByPerson, countPeople } from '../data/clips.js';
import ProductFilter from '../components/ProductFilter.jsx';
import { knownProductCodes, matchProducts, productFilterOptions } from '../data/productFilter.js';
import { NO_GROUP, groupKeySet, matchGroup, normalizeGroupSel, groupFilterOptions } from '../data/groupFilter.js';
import { stampAtFor } from '../data/stamp.js';
import StageCards from '../components/StageCards.jsx';
import FeeInput from '../components/FeeInput.jsx';
import DivideFeesModal, { feeOf, personKeyOf, feeBudgetFor, feeEligible, locksOnFee } from '../components/DivideFeesModal.jsx';
import { tabBadges, markSeen, seedDraftsSeen } from '../utils/tabUpdates.js';
import { fmtRange } from '../utils/date.js';
import { useAuth } from '../auth/AuthContext.jsx';

// ค่าที่เก็บเป็นสตริงคั่นด้วย , (เช่น content_format) → แยกเป็นรายตัว
const splitCsv = v => (v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);

const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
const STATUS_ORDER = ['Draft', 'Active', 'Completed', 'Cancelled'];
const LINK_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];

function formatFollowers(n) {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

function AddKolModal({ projectId, existingIds, onClose, onAdded }) {
    const [kols, setKols] = useState([]);
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        api(`/kols?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}`)
            .then(res => setKols(res.data))
            .catch(err => setError(err.message));
    }, [search]);

    async function add(kol) {
        try {
            await api(`/projects/${projectId}/kols`, { method: 'POST', body: { kol_id: kol.id } });
            onAdded();
        } catch (err) { alert(err.message); }
    }

    const available = kols.filter(k => !existingIds.includes(k.id));

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>เพิ่ม KOL เข้า Project</h3>
                {error && <div className="alert-error">{error}</div>}
                <div className="search-wrap" style={{ maxWidth: 'none', marginBottom: 14 }}>
                    <Icon name="search" size={17} />
                    <input className="search-input" placeholder="ค้นหา KOL..."
                        value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="pick-list">
                    {available.length === 0 ? (
                        <div className="empty">ไม่มี KOL ให้เพิ่ม (อาจถูกเพิ่มไปหมดแล้ว)</div>
                    ) : available.map(k => (
                        <div className="pick-row" key={k.id}>
                            <div className="pick-info">
                                <div className="pick-name">{k.name}</div>
                                <div className="pick-sub">{k.username || '—'} · {k.platform || '—'} · {formatFollowers(k.followers)} ผู้ติดตาม</div>
                            </div>
                            <button className="btn-primary" onClick={() => add(k)}>
                                <Icon name="plus" size={15} /> เพิ่ม
                            </button>
                        </div>
                    ))}
                </div>
                <div className="modal-actions">
                    <button className="btn-ghost" onClick={onClose}>ปิด</button>
                </div>
            </div>
        </div>
    );
}

const SUB_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'YouTube', 'X'];

// modal เพิ่ม KOL เข้าลิสต์เอง (ฝั่งทีม)
// preset = { group_key, platform, content_type } — เปิดจากปุ่ม "+ เพิ่มรายชื่อ" ในกล่องของแท็บรายชื่อ
// เลือกกลุ่ม / Platform / Content Type ของกล่องนั้นไว้ให้เลย (ยังเปลี่ยนเองได้) · ไม่มี preset = ทำงานแบบเดิมทุกอย่าง
function AddSubmissionModal({ projectId, products = [], groups = [], preset = null, onClose, onAdded }) {
    // มีกลุ่มเดียวก็เลือกให้เลย ไม่ต้องกดซ้ำ
    const [f, setF] = useState(() => {
        const base = { group_key: groups.length === 1 ? groups[0].key : '', account_name: '', platform: (groups.length === 1 && groupPlatforms(groups[0]).length === 1) ? groupPlatforms(groups[0])[0] : '', content_type: '', product: '', agency: '', budget: '', link_account: '' };
        // กลุ่มใน preset ต้องยังมีอยู่ในแคมเปญ — ไม่งั้นใช้ค่าเริ่มต้นแบบเดิม
        if (!preset || !groups.some(x => x.key === preset.group_key)) return base;
        return { ...base, group_key: preset.group_key, platform: preset.platform || base.platform, content_type: preset.content_type || '' };
    });
    const g = groups.find(x => x.key === f.group_key) || null;
    const gPlats = g ? groupPlatforms(g) : [];
    // สินค้าให้เลือกเฉพาะของกลุ่มที่เลือก — ถ้ายังไม่เลือกกลุ่มค่อยใช้สินค้าทั้งแคมเปญ
    const productOpts = (g && (g.products || []).length) ? g.products : products;
    // เลือกกลุ่มแล้วดึง Platform ของกลุ่มมาให้
    // สินค้าเก็บได้หลายตัว (คั่นด้วย ,) จึงคัดเหลือเฉพาะตัวที่กลุ่มใหม่มี ไม่ใช่ล้างทิ้งทั้งหมด
    function pickGroup(key) {
        const grp = groups.find(x => x.key === key) || null;
        setF(st => {
            const cur = st.product ? String(st.product).split(',').map(x => x.trim()).filter(Boolean) : [];
            const allow = grp ? (grp.products || []) : null;
            return {
                ...st,
                group_key: key,
                platform: (() => {
                    const ps = grp ? groupPlatforms(grp) : [];
                    if (!ps.length) return st.platform;
                    if (ps.includes(st.platform)) return st.platform;
                    // มี Platform เดียวก็เลือกให้เลย หลายอันให้คนเลือกเอง จะได้ไม่กรอกผิดช่องทาง
                    return ps.length === 1 ? ps[0] : '';
                })(),
                content_type: '',   // Content Type ผูกกับกลุ่ม เปลี่ยนกลุ่มต้องเลือกใหม่
                product: allow ? cur.filter(c => allow.includes(c)).join(',') : st.product
            };
        });
    }
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));

    async function submit(e) {
        e.preventDefault();
        if (!f.platform) { setError('กรุณาเลือก Platform'); return; }
        const ctOpts = g ? contentTypesOf(g, f.platform) : [];
        // มีให้เลือกอย่างเดียวก็เติมให้เอง ไม่ต้องบังคับกด
        const ct = ctOpts.length === 1 ? ctOpts[0] : f.content_type;
        if (ctOpts.length > 1 && !ct) { setError('กรุณาเลือก Content Type'); return; }
        setError(''); setSaving(true);
        try {
            await api(`/projects/${projectId}/submissions`, {
                method: 'POST',
                body: { ...f, group_key: f.group_key || null, content_type: ct || null, budget: Number(f.budget) || 0 }
            });
            onAdded();
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head"><h3>เพิ่ม KOL เข้า Project</h3><button className="modal-x" onClick={onClose}>×</button></div>
                {error && <div className="alert-error">{error}</div>}
                <form onSubmit={submit}>
                    {groups.length > 0 && (
                        <div className="field">
                            <label>กลุ่มในแคมเปญ</label>
                            <select value={f.group_key} onChange={e => pickGroup(e.target.value)}>
                                <option value="">— ยังไม่ระบุกลุ่ม —</option>
                                {groups.map((grp, gi) => (
                                    <option key={grp.key} value={grp.key}>
                                        {'กลุ่มที่ ' + (gi + 1)}
                                        {groupPlatforms(grp).length ? ' · ' + groupPlatforms(grp).join(', ') : ''}
                                        {(grp.products || []).length ? ' · ' + grp.products.join(', ') : ''}
                                    </option>
                                ))}
                            </select>
                            {g ? (
                                <div className="addsub-inherit">
                                    <span className="addsub-inherit-t">ติดมาจากกลุ่มนี้เอง ไม่ต้องกรอกซ้ำ</span>
                                    {(() => {
                                        const plat = gPlats.length === 1 ? gPlats[0] : f.platform;
                                        const opts = plat ? contentTypesOf(g, plat) : [];
                                        const ct = opts.length === 1 ? opts[0] : f.content_type;
                                        const m = mediaFor(g, plat, ct);
                                        // Target ตามสินค้าที่เลือกในฟอร์มนี้ (ถ้าเลือกแล้ว) ไม่งั้นเป็น Target รวมของ Platform
                                        const tg = plat ? asTargetArray(targetFor(g, plat, f.product)) : asTargetArray(g.target);
                                        const empty = !ct && !m.media_type && !m.content_format && tg.length === 0;
                                        return (
                                            <div className="ag-group-req">
                                                {ct && <span className="proc-ctype-chip">{ct}</span>}
                                                {m.media_type && <span className="proc-ctype-chip media">{m.media_type}</span>}
                                                {m.content_format && <span className="proc-ctype-chip fmt">{m.content_format}</span>}
                                                {tg.map(t => <span className="proc-ads-tgt" key={t}>🎯 {t}</span>)}
                                                {empty && <span className="muted">เลือก Platform กับ Content Type แล้วจะขึ้น Format / Style ให้เอง</span>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            ) : (
                                <div className="addsub-warn">
                                    ยังไม่เลือกกลุ่ม — KOL คนนี้จะไม่มี Target / Content Type / Format / Style ติดมาด้วย
                                </div>
                            )}
                        </div>
                    )}
                    <div className="field">
                        <label>ชื่อ Account *</label>
                        <input value={f.account_name} onChange={e => up('account_name', e.target.value)} placeholder="เช่น @username" required autoFocus />
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>Platform</label>
                            {gPlats.length === 1 ? (
                                <div className="perf-readonly" title="กำหนดไว้ที่กลุ่มนี้ตอนตั้งแคมเปญ">{gPlats[0]}</div>
                            ) : (
                                // กลุ่มลงได้หลาย Platform → ให้เลือกเฉพาะที่กลุ่มนี้มี
                                <select value={f.platform} onChange={e => { up('platform', e.target.value); up('content_type', ''); }}>
                                    <option value="">— เลือก —</option>
                                    {(gPlats.length ? gPlats : SUB_PLATFORMS).map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            )}
                        </div>
                        {/* Content Type — 1 Platform ในกลุ่มเดียวอาจมีหลายอย่าง (เช่น Facebook: Awareness / Engagement) */}
                        <div className="field">
                            <label>Content Type</label>
                            {(() => {
                                const plat = gPlats.length === 1 ? gPlats[0] : f.platform;
                                const opts = g && plat ? contentTypesOf(g, plat) : [];
                                if (opts.length === 1) return <div className="perf-readonly" title="กำหนดไว้ที่กลุ่มนี้ตอนตั้งแคมเปญ">{opts[0]}</div>;
                                return (
                                    <select value={f.content_type} disabled={opts.length === 0}
                                        onChange={e => up('content_type', e.target.value)}>
                                        <option value="">{opts.length ? '— เลือก —' : (plat ? '— ไม่มีให้เลือก —' : '— เลือก Platform ก่อน —')}</option>
                                        {opts.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                );
                            })()}
                        </div>
                        <div className="field">
                            <label>Product</label>
                            {productOpts.length > 0 ? (
                                <ProductMultiSelect value={f.product} options={productOpts} onChange={v => up('product', v)} />
                            ) : <input value={f.product} onChange={e => up('product', e.target.value)} placeholder="สินค้า" />}
                        </div>
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>KOL Contact</label>
                            <input value={f.agency} onChange={e => up('agency', e.target.value)} placeholder="ชื่อเอเจนซี่ หรือคนในทีมที่ติดต่อ" />
                        </div>
                        <div className="field">
                            <label>ค่าตัวต่อคลิป (฿) — ไม่บังคับ</label>
                            <input type="number" min="0" inputMode="numeric" value={f.budget} onChange={e => up('budget', e.target.value)} placeholder="ใส่ทีหลังที่รายชื่อได้" />
                            {(() => {
                                // 1 คนทำหลายคลิป -> ทุกคลิปได้ยอดนี้เท่ากัน โชว์ยอดรวมทั้งคนให้เห็นก่อนกดเพิ่ม
                                const n = g ? clipCountFor(g, gPlats.length === 1 ? gPlats[0] : f.platform) : 1;
                                return n > 1
                                    ? <small className="fee-add-total">× {n} คลิป = ฿{((Number(f.budget) || 0) * n).toLocaleString('th-TH')}</small>
                                    : null;
                            })()}
                        </div>
                    </div>
                    <div className="field">
                        <label>Link Account</label>
                        <input type="url" value={f.link_account} onChange={e => up('link_account', e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'เพิ่ม KOL'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ชิปสินค้าในแถบลิงก์เอเจนซี่ — พับเก็บเวลาสินค้าเยอะ กันแถบยาว
function ScopeProducts({ codes, limit = 6 }) {
    const [open, setOpen] = useState(false);
    if (!codes || codes.length === 0) return null;
    const collapsed = !open && codes.length > limit;
    const shown = collapsed ? codes.slice(0, limit) : codes;
    return (
        <>
            {shown.map(c => <span className="alp-sv-chip prod" key={c} title={productLabel(c)}>{c}</span>)}
            {codes.length > limit && (
                <button type="button" className="alp-sv-more" onClick={() => setOpen(o => !o)}>
                    {collapsed ? `+${codes.length - limit} สินค้า` : '▲ ย่อ'}
                </button>
            )}
        </>
    );
}

// แถบลิงก์เอเจนซี่ 1 อัน — ย่อเป็นบรรทัดเดียว (ชื่อ + สรุปขอบเขต + ปุ่ม) กด ▾ เพื่อดู URL + สินค้าเต็ม
function AgencyLinkRow({ l, url, copied, onCopy, onEdit, onDelete, onChat, unread = 0, projectId, boundTo }) {
    const reports = l.reports || [];
    const [open, setOpen] = useState(false);
    const prods = l.products || [];
    const plats = l.platforms || [];
    return (
        <div className="alp-item">
            <div className="alp-item-top">
                <button type="button" className="alp-toggle" onClick={() => setOpen(o => !o)} title={open ? 'ย่อ' : 'ดูรายละเอียด'}>{open ? '▾' : '▸'}</button>
                <span className="alp-name"><Icon name="users" size={14} /> {l.name}</span>
                {boundTo
                    ? <span className="alp-bound ok" title={'บัญชี ' + boundTo + ' เข้าลิงก์นี้ได้'}>🔗 {boundTo}</span>
                    : <span className="alp-bound none" title="ยังไม่มีบัญชีเอเจนซี่ผูกกับลิงก์นี้ — เปิดลิงก์แล้วจะเข้าไม่ได้">⚠ ยังไม่ผูกบัญชี</span>}
                <div className="alp-summary">
                    {(l.groups || []).length > 0 && <span className="alp-sv-chip grp">🗂 {(l.groups || []).length} กลุ่ม</span>}
                    {l.kol_count > 0 && <span className="alp-sv-chip kol">⭐ {l.kol_count} KOL</span>}
                    <span className="alp-sv-chip prod">{prods.length ? `${prods.length} สินค้า` : 'ทุกสินค้า'}</span>
                    {plats.length ? plats.map(p => <span className="alp-sv-chip plat" key={p}>{p}</span>) : <span className="alp-sv-chip plat">ทุก Platform</span>}
                    <span className={'alp-sv-chip rep' + (reports.length ? ' has' : '')} title="Report ที่เอเจนซี่ส่งเข้ามา">
                        📊 {reports.length ? `${reports.length} ไฟล์` : 'ยังไม่ส่ง'}
                    </span>
                </div>
                <button type="button" className="alp-chat" onClick={onChat} title="คุยกับเอเจนซี่เจ้านี้">
                    💬 คุย{unread > 0 && <span className="alp-chat-n">{unread}</span>}
                </button>
                <button className="btn-ghost" onClick={onEdit} title="แก้ไขขอบเขตงาน/บัญชีที่ผูกไว้"><Icon name="edit" size={14} /> แก้ไข</button>
                <button className="btn-ghost" onClick={onCopy}>{copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}</button>
                <a className="btn-ghost" href={url} target="_blank" rel="noreferrer">เปิดดู</a>
                <button className="alp-del" title="ลบลิงก์" onClick={onDelete}><Icon name="trash" size={15} /></button>
            </div>
            {open && (
                <div className="alp-detail">
                    <input className="alp-url" readOnly value={url} onFocus={e => e.target.select()} />
                    {prods.length > 0 && (
                        <div className="alp-scope-view">
                            <span className="alp-sv-lbl">สินค้า:</span>
                            <ScopeProducts codes={prods} limit={12} />
                        </div>
                    )}
                    <div className="alp-scope-view">
                        <span className="alp-sv-lbl">Report:</span>
                        {reports.length === 0 ? <span className="muted">ยังไม่ได้ส่ง</span> : (
                            <div className="alp-reports">
                                {reports.map(r => (r.kind === 'link'
                                    ? <a className="alp-report" key={r.id} href={r.url} target="_blank" rel="noreferrer">🔗 {r.original}</a>
                                    : <button type="button" className="alp-report" key={r.id}
                                        onClick={() => openFile(`/projects/${projectId}/agency-reports/${l.token}/${r.id}/file`).catch(e => alert(e.message))}>
                                        📄 {r.original}</button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// สินค้าในบล็อกที่ตั้ง Target เป็นชุดเดียวกัน รวมไว้แถวเดียว (เรียงตามสินค้าตัวแรกที่เจอ)
function groupByTargets(b) {
    const rows = [];
    (b.products || []).forEach(code => {
        const targets = asTargetArray((b.product_targets || {})[code]);
        const key = [...targets].sort().join('|');
        const row = rows.find(r => r.key === key);
        if (row) row.codes.push(code); else rows.push({ key, targets, codes: [code] });
    });
    return rows;
}

export default function ProjectDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [project, setProject] = useState(null);
    const [error, setError] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [showAddSub, setShowAddSub] = useState(false);
    // กลุ่ม/Platform/Content Type ที่เลือกไว้ให้ในหน้าต่างเพิ่ม KOL (กดจากกล่องในแท็บรายชื่อ) — null = เปิดจากปุ่มด้านบน
    const [addSubPreset, setAddSubPreset] = useState(null);
    const openAddSub = (preset = null) => { setAddSubPreset(preset); setShowAddSub(true); };
    const [showEdit, setShowEdit] = useState(false);
    const [showDelConfirm, setShowDelConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [submissions, setSubmissions] = useState([]);
    const [agencyLinks, setAgencyLinks] = useState([]);
    const [chatUnread, setChatUnread] = useState({});    // { token: จำนวนที่ยังไม่ได้อ่าน }
    // งานจ้างอื่น ๆ ใช้หน้าคนละหน้า (ไม่มีเอเจนซี่/คลิป/ค่าแอด) — เช็คหลังโหลดข้อมูลเสร็จเท่านั้น
    const isOther = (project?.campaign_type || 'kol') === 'other';

    // นับข้อความที่เอเจนซี่ส่งมาแล้วเรายังไม่ได้เปิดอ่าน — เช็คซ้ำทุก 30 วิ เหมือนในห้องแชท
    const loadChatUnread = useCallback(async () => {
        if (!agencyLinks.length) { setChatUnread({}); return; }
        const out = {};
        await Promise.all(agencyLinks.map(async l => {
            try {
                const res = await api(`/projects/${id}/agency-links/${l.token}/messages`);
                out[l.token] = unreadCount(res.data, 'team');
            } catch { /* อ่านไม่ได้ก็ข้าม ไม่ต้องรบกวนผู้ใช้ */ }
        }));
        setChatUnread(out);
    }, [agencyLinks, id]);

    useEffect(() => {
        if (isOther) return;            // งานจ้างอื่น ๆ ไม่มีลิงก์เอเจนซี่ จึงไม่มีแชทให้นับ
        loadChatUnread();
        const t = setInterval(loadChatUnread, 30000);
        return () => clearInterval(t);
    }, [loadChatUnread, isOther]);
    const { user } = useAuth();                 // ปุ่มสร้างบัญชีเอเจนซี่ขึ้นเฉพาะ admin
    const [showLinks, setShowLinks] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    // ตอนสร้างลิงก์: เลือกบัญชีเอเจนซี่ที่มีอยู่ / สร้างบัญชีใหม่ / พิมพ์ชื่อเปล่า ๆ
    const [agencyAccounts, setAgencyAccounts] = useState([]);
    const [linkPick, setLinkPick] = useState('');          // '' | 'u<id>' | '__NEW__' | '__FREE__'
    const [newAccount, setNewAccount] = useState(null);    // บัญชี+รหัสชั่วคราวที่เพิ่งสร้าง (โชว์ครั้งเดียว)
    const [pwCopied, setPwCopied] = useState(false);
    const [editToken, setEditToken] = useState(null);      // null = กำลังสร้างใหม่ · มีค่า = กำลังแก้ลิงก์นั้น
    const [newLinkName, setNewLinkName] = useState('');
    // ต้องโหลดตั้งแต่เปิดแผงลิงก์ เพราะป้าย "ผูกบัญชีแล้ว/ยัง" ใช้ข้อมูลนี้
    useEffect(() => { if (showLinks) loadAgencyAccounts(); }, [showLinks, showCreate]);
    const [newLinkGroups, setNewLinkGroups] = useState([]);   // key ของกลุ่มที่เอเจนซี่เจ้านี้รับผิดชอบ
    const [newLinkProducts, setNewLinkProducts] = useState([]);
    const [newLinkPlatforms, setNewLinkPlatforms] = useState([]);
    const [newLinkKol, setNewLinkKol] = useState('');
    const [copiedToken, setCopiedToken] = useState('');
    const [stage, setStage] = useState('all');   // ตัวกรองขั้นงานจากการ์ดสรุป
    // ลิงก์จากหน้า Ads (?tab=process&check=1) เปิดแท็บ On Process พร้อมตัวกรอง "รอตรวจ"
    const [subTab, setSubTab] = useState(() => (new URLSearchParams(window.location.search).get('tab') === 'process' ? 'process' : 'list'));
    const [openCheckOnly] = useState(() => new URLSearchParams(window.location.search).get('check') === '1');
    // กรองรายชื่อตาม Platform — โชว์เมื่อแคมเปญมีมากกว่า 1 Platform
    const [listPlat, setListPlat] = useState('all');
    // กรองย่อยตาม Content Type ในแพลตฟอร์มนั้น (เช่น Facebook มี Awareness / Engagement)
    const [listCtype, setListCtype] = useState('all');
    // กรองเฉพาะคนที่ยังไม่ใส่ค่าตัว — ใช้ร่วมกับตัวกรอง Platform / Content Type ได้
    const [feeOnly, setFeeOnly] = useState(false);
    // กรองรายชื่อตามสินค้า — เลือกได้หลายตัว ([] = ทุกสินค้า) ใช้ร่วมกับตัวกรองอื่นได้
    const [listProducts, setListProducts] = useState([]);
    // กรองรายชื่อตามกลุ่มสินค้า — เลือกได้ทีละกลุ่ม ('__none' = คนที่ไม่อยู่กลุ่มไหน) แบบเดียวกับแถบกลุ่มในแท็บ On Process
    const [listGroup, setListGroup] = useState('all');
    // หน้าต่างหาร/ล้างค่าตัวของกลุ่ม { key, gi, mode: 'divide' | 'clear' }
    const [feeModal, setFeeModal] = useState(null);
    const [badges, setBadges] = useState({ listNew: false, processNew: false });
    const [subsLoaded, setSubsLoaded] = useState(false);
    // รายชื่อหมด (ลบคนสุดท้าย / เอเจนซี่ลบของตัวเอง) แถบตัวกรองจะหายไป แต่การ์ดกลุ่มยังขึ้นเสมอ
    // ถ้าไม่ล้าง ตัวกรองที่มองไม่เห็นจะซ่อนกลุ่ม/นับเฉพาะ Platform ที่เคยกดไว้ และไม่มีปุ่มให้กดคืน
    useEffect(() => {
        if (submissions.length > 0) return;
        setListPlat('all'); setListCtype('all'); setFeeOnly(false); setListProducts([]); setListGroup('all');
    }, [submissions.length]);

    function load() {
        api(`/projects/${id}`)
            .then(res => setProject(res.data))
            .catch(err => setError(err.message));
        loadSubs();
    }
    function loadSubs() {
        api(`/projects/${id}/submissions`).then(res => { setSubmissions(res.data); setSubsLoaded(true); }).catch(() => {});
    }
    useEffect(() => { load(); loadLinks(); }, [id]);

    // แจ้งเตือนแท็บ: เปิดแท็บไหนอยู่ = เห็นแล้ว, แท็บอื่นเด้ง badge ถ้ามีอัปเดตใหม่ (รอโหลดข้อมูลก่อนค่อย seed)
    useEffect(() => {
        if (!subsLoaded) return;
        seedDraftsSeen(id, submissions);
        markSeen(id, subTab, submissions);
        setBadges(tabBadges(id, submissions));
    }, [submissions, subTab, id, subsLoaded]);

    // โหลดข้อมูลซ้ำเป็นระยะ เพื่อให้เห็นอัปเดตจากฝั่ง Agency แบบไม่ต้องรีเฟรช
    useEffect(() => {
        if (isOther) return;            // ไม่มีรายชื่อ KOL ให้รีเฟรช
        const t = setInterval(loadSubs, 20000);
        return () => clearInterval(t);
    }, [id, isOther]);

    // token ของลิงก์เอเจนซี่ที่ยังใช้งานอยู่ — ใช้ดูว่าแถวไหนกลายเป็นกำพร้า
    const liveTokens = new Set(agencyLinks.map(l => l.token));

    // ===== ลิงก์เอเจนซี่แบบแยกต่อเจ้า =====
    function loadLinks() {
        api(`/projects/${id}/agency-links`).then(res => setAgencyLinks(res.data)).catch(() => {});
    }
    // รายชื่อบัญชีเอเจนซี่ ไว้ให้เลือกตอนสร้างลิงก์ (เจ้าเดิมใช้รหัสเดิมได้เลย ไม่ต้องออกใหม่)
    function loadAgencyAccounts() {
        api('/users/agency-options').then(res => setAgencyAccounts(res.data || [])).catch(() => {});
    }
    async function createLink() {
        // แปลงตัวเลือกใน dropdown เป็นข้อมูลที่ server เข้าใจ
        const body = { products: newLinkProducts, platforms: newLinkPlatforms, kol_count: Number(newLinkKol) || 0, groups: newLinkGroups };
        if (linkPick === '__NEW__') {
            if (!newLinkName.trim()) { alert('กรุณาใส่ชื่อบัญชีเอเจนซี่'); return; }
            body.new_agency_username = newLinkName.trim();
        } else if (linkPick === '__FREE__' || !linkPick) {
            body.name = newLinkName.trim() || null;
        } else {
            body.agency_user_id = Number(linkPick.slice(1));
        }
        try {
            const res = await api(`/projects/${id}/agency-links`, { method: 'POST', body });
            // รหัสชั่วคราวส่งกลับมาครั้งเดียว ไม่ได้เก็บไว้ที่ไหน — ต้องโชว์ให้ก๊อปทันที
            if (res.data && res.data.temp_password) {
                setNewAccount({ username: res.data.agency_account.username, password: res.data.temp_password });
                setPwCopied(false);
            }
            setNewLinkName(''); setNewLinkGroups([]); setNewLinkProducts([]); setNewLinkPlatforms([]); setNewLinkKol(''); setLinkPick('');
            setShowCreate(false);
            loadLinks();
            loadAgencyAccounts();
        } catch (err) { alert(err.message); }
    }
    // สินค้าของ Platform ที่เลือก (ตามที่เจ้าของโปรเจคผูกไว้ในกลุ่มโฆษณา) — ถ้ายังไม่เลือก Platform = ว่าง
    // ติ๊กกลุ่ม = ได้ Platform/สินค้า/จำนวน KOL ของกลุ่มนั้นมาทั้งชุด ไม่ต้องไล่เลือกเอง
    function toggleNewGroup(key) {
        const next = newLinkGroups.includes(key) ? newLinkGroups.filter(k => k !== key) : [...newLinkGroups, key];
        setNewLinkGroups(next);
        const picked = (project?.ad_groups || []).filter(g => next.includes(g.key));
        // Platform/สินค้าที่เลือกไว้ ต้องไม่หลุดขอบเขตกลุ่มใหม่
        let plats = newLinkPlatforms;
        if (picked.length) {
            const gp = [...new Set(picked.flatMap(g => groupPlatforms(g)))];
            const gc = [...new Set(picked.flatMap(g => g.products || []))];
            plats = newLinkPlatforms.filter(p => gp.includes(p));
            setNewLinkPlatforms(plats);
            setNewLinkProducts(cur => cur.filter(c => gc.includes(c)));
        }
        // นับเฉพาะจำนวนคนของ Platform ที่เจ้านี้รับผิดชอบ ไม่ใช่ยอดทั้งกลุ่ม
        setNewLinkKol(next.length ? String(kolInScope(project?.ad_groups, next, plats)) : '');
    }
    const productsForPlatforms = plats => {
        if (!plats.length) return [];
        const set = new Set();
        // เทียบกับทุก Platform ของกลุ่ม ไม่ใช่แค่ g.platform ตัวเดียว
        // ไม่งั้นกลุ่มที่ลง TikTok+Instagram จะไม่มีสินค้าขึ้นตอนเลือก Instagram
        const pool = newLinkGroups.length
            ? (project?.ad_groups || []).filter(g => newLinkGroups.includes(g.key))
            : (project?.ad_groups || []);
        pool.forEach(g => {
            if (groupPlatforms(g).some(pf => plats.includes(pf))) (g.products || []).forEach(c => set.add(c));
        });
        return [...set];
    };
    const toggleNewProduct = code => setNewLinkProducts(a => a.includes(code) ? a.filter(x => x !== code) : [...a, code]);
    const toggleNewPlatform = p => {
        const next = newLinkPlatforms.includes(p) ? newLinkPlatforms.filter(x => x !== p) : [...newLinkPlatforms, p];
        setNewLinkPlatforms(next);
        // ตัด/เพิ่ม Platform แล้วจำนวนคนที่เจ้านี้รับผิดชอบก็เปลี่ยนตาม
        if (newLinkGroups.length) setNewLinkKol(String(kolInScope(project?.ad_groups, newLinkGroups, next)));
        // เอาสินค้าที่ไม่อยู่ใน Platform ที่เหลือออก
        const valid = new Set(productsForPlatforms(next));
        setNewLinkProducts(prods => prods.filter(c => valid.has(c)));
    };
    // แก้ลิงก์เดิม — ใช้ฟอร์มเดียวกับตอนสร้าง แค่เติมค่าเดิมเข้าไปก่อน
    function startEdit(l) {
        const bound = agencyAccounts.find(a => (a.agency_tokens || []).includes(l.token));
        setEditToken(l.token);
        setLinkPick(bound ? 'u' + bound.id : '__FREE__');
        setNewLinkName(l.name || '');
        setNewLinkGroups([...(l.groups || [])]);
        setNewLinkProducts([...(l.products || [])]);
        setNewLinkPlatforms([...(l.platforms || [])]);
        setNewLinkKol(l.kol_count ? String(l.kol_count) : '');
        setShowCreate(true);
    }
    function resetLinkForm() {
        setShowCreate(false); setEditToken(null); setLinkPick('');
        setNewLinkName(''); setNewLinkGroups([]); setNewLinkProducts([]); setNewLinkPlatforms([]); setNewLinkKol('');
    }
    async function saveLinkEdit() {
        const body = {
            name: newLinkName.trim() || undefined,
            products: newLinkProducts, platforms: newLinkPlatforms,
            groups: newLinkGroups,
            kol_count: Number(newLinkKol) || 0
        };
        // เปลี่ยนบัญชีที่ผูก: พิมพ์ชื่อเอง = ถอดบัญชีออกจากลิงก์นี้
        if (linkPick === '__FREE__') body.agency_user_id = null;
        else if (linkPick && linkPick !== '__NEW__') body.agency_user_id = Number(linkPick.slice(1));
        try {
            await api(`/projects/${id}/agency-links/${editToken}`, { method: 'PUT', body });
            resetLinkForm();
            loadLinks();
            loadAgencyAccounts();
        } catch (err) { alert(err.message); }
    }
    async function deleteLink(token) {
        if (!confirm('ลบลิงก์นี้?\nรายชื่อ KOL ทั้งหมดที่ส่งเข้ามาผ่านลิงก์นี้จะถูกลบไปด้วย และกู้คืนไม่ได้')) return;
        try { await api(`/projects/${id}/agency-links/${token}`, { method: 'DELETE' }); loadLinks(); }
        catch (err) { alert(err.message); }
    }
    const linkUrl = token => `${window.location.origin}/agency/${token}`;
    function copyLink(token) {
        navigator.clipboard.writeText(linkUrl(token)).then(() => { setCopiedToken(token); setTimeout(() => setCopiedToken(''), 2000); });
    }
    async function decideSub(subId, status) {
        try { await api(`/projects/${id}/submissions/${subId}`, { method: 'PUT', body: { status } }); loadSubs(); }
        catch (err) { alert(err.message); }
    }
    // ลบรายชื่อออกถาวร — "ยกเลิก/ไม่เลือก" แค่เปลี่ยนสถานะ แถวยังอยู่ในระบบและยังไปโผล่ที่อื่น
    async function deleteSub(s) {
        if (!confirm(`ลบ "${s.account_name}" ออกจากแคมเปญนี้ถาวร?
ลบแล้วกู้คืนไม่ได้ และจะหายจาก Dashboard / Report ด้วย`)) return;
        try { await api(`/projects/${id}/submissions/${s.id}`, { method: 'DELETE' }); loadSubs(); }
        catch (err) { alert(err.message); }
    }
    // อัปเดต submission (ใช้กับ On Process — บันทึกโพสต์/ดราฟ/feedback ฝั่งทีม)
    const putSubmission = (subId, payload) => api(`/projects/${id}/submissions/${subId}`, { method: 'PUT', body: payload });

    // ===== ค่าตัว KOL (ต่อคลิป) =====
    // คลิปทั้งหมดของคนนี้ หาจาก submissions ทั้งแคมเปญเสมอ — _clips ของแถวที่ยุบแล้วอาจโดนตัวกรอง/บล็อกสถานะตัดไปบางคลิป
    const clipsOfPerson = s => submissions
        .filter(x => personKeyOf(x) === personKeyOf(s))
        .sort((a, b) => (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
    // ช่องเดียวต่อคน = ยอดต่อคลิป เขียนลงทุกคลิปของคนนั้นในคำขอเดียว
    // ส่ง from = ค่าที่หน้าเว็บเห็นอยู่ ถ้ามีคนแก้ไปก่อน server ตอบ 409 จะได้ไม่ทับกัน
    async function saveFee(clips, value) {
        const items = clips.filter(c => feeOf(c) !== value).map(c => ({ sub_id: c.id, budget: value, from: feeOf(c) }));
        if (!items.length) return;
        // คลิปที่ค่าแอดถึงเกณฑ์แล้วแต่ยังไม่ล็อกผล — บันทึกแล้วผลคุ้ม/ไม่คุ้มจะล็อกทันทีและแก้ย้อนหลังไม่ได้ จึงถามยืนยันก่อน
        const locking = clips.filter(c => items.some(i => i.sub_id === c.id) && locksOnFee(c, value, stampAtFor(project.brand))).length;
        if (locking > 0 && !window.confirm(`บันทึกค่าตัว ฿${value.toLocaleString('th-TH')} ต่อคลิปใช่ไหม?\nค่าแอดของ ${locking} คลิปถึงเกณฑ์แล้ว — บันทึกแล้วผลคุ้ม/ไม่คุ้มจะล็อกทันทีและแก้ย้อนหลังไม่ได้`)) {
            const cancelled = new Error('ยกเลิก');
            cancelled.cancelled = true;
            throw cancelled;
        }
        try {
            const res = await api(`/projects/${id}/fees`, { method: 'PUT', body: { items, reason: 'manual' } });
            // เอาแถวที่ server ส่งกลับมาใส่ก่อนเลย ตัวเลขจะได้ไม่กระพริบกลับค่าเดิมระหว่างรอโหลดใหม่
            const rows = (res && res.data && res.data.rows) || [];
            if (rows.length) {
                const byId = new Map(rows.map(r => [r.id, r]));
                setSubmissions(list => list.map(x => byId.get(x.id) || x));
            }
            loadSubs();
        } catch (err) {
            if (err.status === 409) { loadSubs(); throw new Error('มีคนแก้ไปแล้ว — โหลดค่าล่าสุดให้แล้ว'); }
            throw err;
        }
    }

    // เปลี่ยนสถานะแคมเปญแบบเร็ว
    async function changeStatus(status) {
        try { await api(`/projects/${id}`, { method: 'PUT', body: { status } }); load(); }
        catch (err) { alert(err.message); }
    }

    async function removeKol(linkId) {
        if (!confirm('เอา KOL นี้ออกจาก Project?')) return;
        try { await api(`/projects/${id}/kols/${linkId}`, { method: 'DELETE' }); load(); }
        catch (err) { alert(err.message); }
    }

    // ลบทั้งโปรเจค (ยืนยันผ่านหน้าต่างยืนยัน/ยกเลิก)
    async function deleteProject() {
        setDeleting(true);
        try {
            await api(`/projects/${id}`, { method: 'DELETE' });
            navigate('/projects');
        } catch (err) { alert(err.message); setDeleting(false); }
    }

    if (error) return <div className="alert-error">{error}</div>;
    if (!project) return <div className="empty">กำลังโหลด...</div>;
    // แยกที่นี่ที่เดียว — ลิงก์ /projects/:id เดิมทั้งหมด (หน้าแคมเปญ, ประวัติการแก้ไข, บุ๊กมาร์ก) จึงยังใช้ได้เหมือนเดิม
    if (isOther) return <OtherProjectDetail project={project} reload={load} onDeleted={() => navigate('/hires?tab=jobs')} />;

    const kols = project.kols || [];
    // สินค้าที่เลือกได้ = เฉพาะสินค้าของ Platform ที่รับผิดชอบ (เลือก Platform ก่อน)
    const availProducts = productsForPlatforms(newLinkPlatforms);
    // Platform ที่โปรเจคนี้มี (ให้เลือกได้เฉพาะที่เจ้าของโปรเจคตั้งไว้)
    const linkGroups = project.ad_groups || [];
    // แคมเปญที่มีกลุ่มแล้ว ต้องติ๊กอย่างน้อย 1 กลุ่มก่อนถึงจะบันทึกได้
    const needGroup = linkGroups.length > 0 && newLinkGroups.length === 0;
    const pickedGroups = linkGroups.filter(g => newLinkGroups.includes(g.key));
    // เลือกกลุ่มไว้แล้ว ตัวเลือก Platform/สินค้าเหลือเฉพาะของกลุ่มนั้น
    const scopeGroups = pickedGroups.length ? pickedGroups : linkGroups;
    const projectPlatforms = [...new Set(scopeGroups.flatMap(g => groupPlatforms(g)))];
    // ตัวกรองของแท็บรายชื่อ ต้องดูจากทุกกลุ่มในแคมเปญ ไม่ใช่กลุ่มที่ติ๊กไว้ในฟอร์มสร้างลิงก์
    const listPlatforms = [...new Set(linkGroups.flatMap(g => groupPlatforms(g)))];
    const ctypesOfPlat = p => [...new Set(linkGroups.flatMap(g => contentTypesOf(g, p)))];
    const quotaFor = (p, ct) => linkGroups.reduce((n, g) => n + quotaOf(g, p, ct), 0);
    const subCtypes = listPlat === 'all' ? [] : ctypesOfPlat(listPlat);
    const matchScope = s => (listPlat === 'all' || s.platform === listPlat)
        && (listCtype === 'all' || s.content_type === listCtype);
    // คนที่ยังไม่ใส่ค่าตัว = มีคลิปที่ไม่ได้ถูก "ไม่เลือก" แต่ค่าตัวยังเป็น 0 — นับเป็นคน ไม่ใช่คลิป
    const missingFee = s => s.status !== 'rejected' && feeOf(s) <= 0;
    const feeMissingKeys = new Set(submissions.filter(missingFee).map(personKeyOf));
    const feeMissingCount = countPeople(submissions.filter(s => matchScope(s) && missingFee(s)));
    // กรองทั้งคน (ทุกคลิป) ไม่ใช่เฉพาะคลิปที่เป็น 0 — ช่องค่าตัวต่อคนจะได้เห็นครบ
    // กรองตามสินค้าแบบทั้งคน: คนที่มีคลิปของสินค้าที่เลือก เห็นครบทุกคลิป (ช่องค่าตัวต่อคนจะได้ไม่แหว่ง)
    const knownCodes = knownProductCodes(project.ad_groups || [], submissions);
    const productKeys = listProducts.length
        ? new Set(submissions.filter(s => matchProducts(s, listProducts, knownCodes)).map(personKeyOf)) : null;
    // ตัวกรองกลุ่ม — คุมเฉพาะการ์ดข้างล่าง ไม่แตะตัวเลขบนชิปแพลตฟอร์ม/Content Type/สินค้า
    // (ยอดพวกนั้นเป็นของทั้งแคมเปญ เหมือนแท็บ On Process คนใช้จึงยังเทียบได้ว่ากำลังซ่อนอะไรอยู่)
    // ห้ามย้ายไปใส่ใน matchScope เพราะ matchScope เป็นตัวหารของโควตาหัวการ์ดและป้าย "ซ่อน N คนตามตัวกรอง"
    const groupKeys = groupKeySet(project.ad_groups);
    const groupOpts = groupFilterOptions(project.ad_groups, submissions, countPeople);
    // ชิปไหนไม่มีให้กดแล้ว (หรือแถบไม่ขึ้นเลย) ต้องถอยเป็น "ทั้งหมด" ตอน render ทันที
    // ห้ามมีตัวกรองทำงานอยู่เงียบ ๆ โดยไม่มีชิปไหนติด
    const curGroup = normalizeGroupSel(listGroup, groupOpts);
    const matchListFilter = s => matchScope(s) && matchGroup(s, curGroup, groupKeys)
        && (!feeOnly || feeMissingKeys.has(personKeyOf(s)))
        && (!productKeys || productKeys.has(personKeyOf(s)));
    // ข้อความตอนไม่มีรายชื่อ — บอกให้ชัดว่าหายเพราะตัวกรอง
    const emptyText = where => (feeOnly ? `ไม่มีคนที่ยังไม่ใส่ค่าตัว${where}`
        : listProducts.length ? `ไม่มีรายชื่อของสินค้าที่เลือก${where}` : `ยังไม่มีรายชื่อ${where}`);

    // แถวในตารางรายชื่อ KOL (action ต่างกันตามกลุ่ม)
    const subRow = (s, i, grp) => (
        <tr key={s.id}>
            <td className="sub-no">{i + 1}</td>
            <td>
                <strong>{s.account_name}</strong>
                {(s._clips || []).length > 1 && (
                    <span className="sub-clip-chip" title={s._clips.map(c => c.clip_name || `คลิป ${c.clip_no}`).join(" · ")}>{s._clips.length} คลิป</span>
                )}
            </td>
            <td>{s.platform ? <span className="tag">{s.platform}</span> : '—'}</td>
            {/* Content Type เก็บรายคน ส่วน Style อ่านจากที่ตั้งไว้ในกลุ่ม */}
            <td className="sub-ctype">
                {s.content_type ? <>
                    <span className="proc-ctype-chip">{s.content_type}</span>
                    {(() => {
                        const fmt = grp ? mediaFor(grp, s.platform, s.content_type).content_format : null;
                        return fmt ? <span className="proc-ctype-chip fmt">{fmt}</span> : null;
                    })()}
                </> : <span className="ctype-none">— ยังไม่ระบุ —</span>}
            </td>
            <td className="muted"><ProductSummary value={s.product} /></td>
            <td className="muted">{s.agency || '—'}</td>
            <td className="num sub-fee">
                {(() => {
                    // ช่องเดียวต่อคน โชว์ยอดของคลิปแรก — แก้แล้วเขียนลงทุกคลิปของคนนี้
                    const clips = clipsOfPerson(s);
                    const first = feeOf(clips[0] || s);
                    const uneven = clips.some(c => feeOf(c) !== first);
                    // คนที่ "ไม่เลือก" ไม่ต้องเตือน และไม่นับคลิปที่ "ไม่เลือก" — ให้ตรงกับตัวนับในแถบกลุ่มและตัวกรอง
                    const nudge = s.status !== 'rejected' && clips.some(c => c.status !== 'rejected' && feeOf(c) <= 0);
                    // คลิปไม่เท่ากันหรือยังมีคลิปที่เป็น 0 — พิมพ์ยอดเดียวกับคลิปแรกก็ต้องบันทึกได้ ไม่งั้นแก้ให้เท่ากันไม่ได้
                    const dirty = uneven || clips.some(c => feeOf(c) <= 0);
                    // ใช้จับว่าระหว่างพิมพ์มีคนแก้ค่าตัวคนนี้ไปแล้วหรือยัง
                    const version = clips.map(c => `${c.id}:${feeOf(c)}`).join('|');
                    return <>
                        <FeeInput value={first} missing={nudge} dirty={dirty} version={version} onSave={v => saveFee(clips, v)} />
                        {clips.length > 1 && (
                            <small className="sub-budget-split">× {clips.length} คลิป = ฿{clips.reduce((n, c) => n + feeOf(c), 0).toLocaleString('th-TH')}</small>
                        )}
                        {uneven && <small className="fee-uneven">แต่ละคลิปไม่เท่ากัน — แก้แล้วทุกคลิปจะเป็นยอดนี้</small>}
                        {nudge && <span className="fee-missing-chip">ยังไม่ใส่ค่าตัว</span>}
                    </>;
                })()}
            </td>
            <td>{s.link_account ? <a className="work-link" href={s.link_account} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> เปิด</a> : '—'}</td>
            <td>
                <input className="sub-note-input" defaultValue={s.team_note || ''} placeholder="📝 เช่น ย้ายไปสินค้าอื่น"
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (s.team_note || '')) putSubmission(s.id, { team_note: v || null }).then(loadSubs); }} />
                {/* หมายเหตุที่เอเจนซี่เขียนกลับมา — อ่านอย่างเดียว */}
                {s.agency_note && <div className="sub-note-from-agency" title={s.agency_note}>💬 {s.agency_note}</div>}
            </td>
            <td className="actions">
                {s.status === 'confirmed' ? (
                    <button className="btn-ghost" onClick={() => decideSub(s.id, 'submitted')}>ยกเลิก</button>
                ) : s.status === 'rejected' ? (
                    <button className="btn-ghost" onClick={() => decideSub(s.id, 'submitted')}>↩ คืนกลับ</button>
                ) : (
                    <div className="sub-decide">
                        <button className="btn-primary" style={{ padding: '6px 12px' }} onClick={() => decideSub(s.id, 'confirmed')}>✓ เลือก</button>
                        <button className="btn-reject" onClick={() => decideSub(s.id, 'rejected')}>✕ ไม่เลือก</button>
                    </div>
                )}
                {/* รายชื่อจากเอเจนซี่ให้เจ้าของลิงก์ลบเอง ฝั่งทีมใช้ "ไม่เลือก" แทน
                    ยกเว้นลิงก์ถูกลบไปแล้ว = แถวกำพร้า ทีมต้องเก็บกวาดเองได้ */}
                {(!s.agency_token || !liveTokens.has(s.agency_token)) && (
                    <button className="sub-del" title="ลบรายชื่อนี้ออกจากแคมเปญถาวร" onClick={() => deleteSub(s)}>
                        <Icon name="trash" size={14} />
                    </button>
                )}
            </td>
            <td className="tbl-spacer"></td>
        </tr>
    );

    // เรียงเก่า -> ใหม่ ให้เหมือนฝั่งลิงก์เอเจนซี่ (API ส่งมาแบบใหม่สุดขึ้นก่อน)
    const oldestFirst = list => list.slice().sort((a, b) =>
        (a.submitted_at || '').localeCompare(b.submitted_at || '') || (a.id - b.id));

    // บล็อกสถานะ 1 อัน (คืน null ถ้าไม่มีรายการ)
    const statusBlock = (dotClass, title, rows, actionLabel, extraCls = '', grp = null) => {
        if (rows.length === 0) return null;
        return (
            <div className={'sub-group ' + extraCls} key={title}>
                <div className="sub-group-head">
                    <span className={'sub-group-dot ' + dotClass} />
                    <span className="sub-group-title">{title}</span>
                    <span className="sub-group-count">{rows.length}</span>
                </div>
                <div className={'panel no-pad ' + extraCls}>
                    {/* .panel.no-pad ตัดของที่ล้นทิ้ง — ตารางกว้างขึ้นจากช่องค่าตัว จึงให้เลื่อนซ้าย-ขวาในกล่องนี้แทน */}
                    <div className="sub-table-scroll">
                        <table className="data-table tight">
                            <thead><tr>
                                <th className="sub-no">#</th><th>ชื่อ Account</th><th>Platform</th><th>Content Type</th><th>Product</th><th>KOL Contact</th>
                                <th className="num">ค่าตัว/คลิป</th><th>ลิงก์</th><th>หมายเหตุ</th><th className="actions">{actionLabel}</th>
                                <th className="tbl-spacer" aria-hidden="true"></th>
                            </tr></thead>
                            <tbody>{rows.map((s, i) => subRow(s, i, grp))}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };
    // หัวกล่องของ 1 ช่อง = Platform + Content Type (ตรงกับที่เอเจนซี่กรอก)
    // total = จำนวนคนทั้งหมดในช่องนี้ตามตัวกรอง Platform/Content Type — เปิดตัวกรองสินค้า/ยังไม่ใส่ค่าตัวแล้วตัวเลขเทียบโควตาต้องไม่หด
    const cellHead = (g, c, rows, total) => {
        const m = mediaFor(g, c.platform, c.contentType);
        const quota = quotaOf(g, c.platform, c.contentType || null);
        return (
            <div className="ag-tb-head list-tb-head">
                <span className="adg-plat">📱 {c.platform}</span>
                {c.contentType
                    ? <span className="proc-ctype-chip">{c.contentType}</span>
                    : <span className="ctype-none">— ยังไม่ได้ตั้ง Content Type —</span>}
                {m.media_type && <span className="proc-ctype-chip media">{m.media_type}</span>}
                {splitCsv(m.content_format).map(x => <span className="proc-ctype-chip fmt" key={x}>{x}</span>)}
                <span className="ag-tb-count">{total != null ? total : countPeople(rows)}<span>/{quota || '—'}</span> คน</span>
            </div>
        );
    };
    // แบ่งรายชื่อในกลุ่มเป็นกล่องตาม Platform + Content Type แทนที่จะกองรวมกัน
    // กล่องขึ้นครบทุกช่องของกลุ่มแม้ยังไม่มีใครส่งชื่อมา (เหมือนหน้าเอเจนซี่) — ทีมเห็นว่ายังขาดช่องไหน และกดเพิ่มเองจากกล่องได้เลย
    const cellBlocks = (g, rows) => {
        const plats = listPlat === 'all' ? [] : [listPlat];
        // กรอง Platform ที่กลุ่มนี้ไม่ได้ลง = ไม่มีกล่อง (contentCells สร้างช่องให้ Platform ที่ส่งเข้าไปเสมอ ไม่เช็คว่ากลุ่มมีไหม)
        const cells = contentCells(g, plats)
            .filter(c => listPlat === 'all' || groupPlatforms(g).includes(c.platform))
            .filter(c => listCtype === 'all' || c.contentType === listCtype);
        const known = new Set(cells.map(cellKey));
        const leftover = rows.filter(r => !known.has(cellKeyOf(g, r)));
        // กลุ่มยังไม่ได้ตั้ง Platform เลย และไม่มีรายชื่อค้าง — ไม่มีกล่องให้โชว์
        if (cells.length === 0 && leftover.length === 0) return <div className="proc-group-empty">{emptyText('ในกลุ่มนี้')}</div>;
        return <>
            {cells.map(c => {
                const mine = rows.filter(r => cellKeyOf(g, r) === cellKey(c));
                const all = submissions.filter(s => s.group_key === g.key && matchScope(s) && cellKeyOf(g, s) === cellKey(c));
                return (
                    <div className="list-typebox" key={cellKey(c)}>
                        {cellHead(g, c, mine, countPeople(all))}
                        {/* กรองอยู่แล้วซ่อนบางคน — บอกให้รู้ว่าไม่ได้หาย */}
                        {countPeople(all) > countPeople(mine) && mine.length > 0 && (
                            <div className="ag-hidden-note">ซ่อน {countPeople(all) - countPeople(mine)} คนตามตัวกรองที่เลือกอยู่</div>
                        )}
                        {/* ช่องที่ยังไม่มีใครเลย โชว์แค่หัวกล่อง + ปุ่มเพิ่ม (เหมือนเอเจนซี่) · มีคนแต่โดนตัวกรองซ่อนหมด ต้องบอกว่าหายเพราะตัวกรอง */}
                        {mine.length > 0
                            ? statusBlocks(mine, g)
                            : all.length > 0 && <div className="proc-group-empty">{emptyText('ในช่องนี้')}</div>}
                        {/* ปุ่มหน้าตาเดียวกับกล่องกรอกของเอเจนซี่ — เปิดหน้าต่างเพิ่ม KOL เดิม โดยเลือกกลุ่ม/Platform/Content Type ของกล่องนี้ไว้ให้ */}
                        <button type="button" className="agency-add-row list-add-row"
                            onClick={() => openAddSub({ group_key: g.key, platform: c.platform, content_type: c.contentType || '' })}>
                            <Icon name="plus" size={15} /> เพิ่มรายชื่อ
                        </button>
                    </div>
                );
            })}
            {leftover.length > 0 && (
                <div className="list-typebox list-typebox-left">
                    <div className="ag-tb-head list-tb-head">
                        <span className="ctype-none">— ยังไม่ระบุ Content Type ({countPeople(leftover)} คน) —</span>
                        <span className="ag-tb-note">ส่งเข้ามาก่อนมีการแยกช่อง</span>
                    </div>
                    {statusBlocks(leftover, g)}
                </div>
            )}
        </>;
    };
    // ทั้ง 3 สถานะของชุด subs ที่ให้มา (รอคัดเลือก / คัดเลือกแล้ว / ไม่เลือก)
    const statusBlocks = (list, grp = null) => {
        // แท็บนี้คือหน้าคัดเลือก "คน" — ยุบแถวพี่น้อง (คนเดียวกันหลายคลิป) ให้เหลือคนละแถว
        const pend = oldestFirst(collapseByPerson(list.filter(s => s.status !== 'confirmed' && s.status !== 'rejected')));
        const conf = oldestFirst(collapseByPerson(list.filter(s => s.status === 'confirmed')));
        const rej = oldestFirst(collapseByPerson(list.filter(s => s.status === 'rejected')));
        return <>
            {statusBlock('pending', 'รอคัดเลือก', pend, 'คัดเลือก', '', grp)}
            {statusBlock('confirmed', 'คัดเลือกแล้ว', conf, 'จัดการ', 'grp-confirmed', grp)}
            {statusBlock('rejected', 'ไม่เลือก', rej, 'จัดการ', 'grp-rejected', grp)}
        </>;
    };
    // โควตาคนของกลุ่ม ตามขอบเขตที่กำลังกรองดูอยู่
    // ดูทั้งกลุ่ม = ผลรวมแถว Tier ใน allocations (แบบหน้าเอเจนซี่ / ผลรวมโควตาของกล่องย่อย)
    // ไม่ใช้ blocksKol — นับแถว Tier ที่ยังไม่ได้เลือกชื่อ Tier ด้วย ตัวเลขหัวกลุ่มจะไม่ตรงกับกล่องย่อยและหน้าเอเจนซี่
    const groupQuota = g => (listPlat === 'all')
        ? allocsInScope(g, []).reduce((n, a) => n + (Number(a.kols) || 0), 0)
        : quotaOf(g, listPlat, listCtype === 'all' ? null : listCtype);
    // หัวการ์ดกลุ่มสินค้า (ฝั่งทีม) — หน้าตา/ข้อมูลเดียวกับหัวกลุ่มหน้าเอเจนซี่ (GroupNeedHead) + ของที่มีเฉพาะทีม (คัดเลือกแล้ว, แถบค่าตัว)
    // Platform ในขอบเขตที่กำลังดู — ทีมเห็นทุก Platform ของกลุ่ม แต่ตามตัวกรอง Platform ที่เลือกอยู่ (ใช้ทั้งหัวกลุ่มและสรุป/หารค่าตัว)
    const feePlatsOf = g => groupPlatforms(g).filter(p => listPlat === 'all' || p === listPlat);
    const teamGroupHead = (g, gi) => {
        // ตัวเลขส่งแล้ว/คัดเลือกนับตามตัวกรอง Platform/Content Type เท่านั้น — เปิดตัวกรอง "ยังไม่ใส่ค่าตัว" / สินค้า แล้วยอดต้องไม่หด
        // (โควตาจำนวนคนตั้งต่อ Platform/Content Type ไม่ได้ตั้งต่อสินค้า)
        const scoped = submissions.filter(s => s.group_key === g.key && matchScope(s));
        const confRows = scoped.filter(s => s.status === 'confirmed');
        const conf = countPeople(confRows);
        const plats = feePlatsOf(g);
        // สินค้า = ของ Platform ในขอบเขต (กรอง TikTok อยู่ก็เห็นแค่สินค้าที่ลง TikTok) — กติกาเดียวกับหน้าเอเจนซี่
        const products = plats.length ? [...new Set(plats.flatMap(p => productsFor(g, p)))] : (g.products || []);
        // กรอง Platform/Content Type อยู่ ตัวหารต้องเป็นโควตาเฉพาะที่กรอง ไม่ใช่ยอดรวมทั้งกลุ่ม
        // ดูทั้งกลุ่มแล้วไม่มีโควตารายช่อง (ข้อมูลเก่า) ถอยไปใช้จำนวน KOL ของกลุ่ม เหมือนหน้าเอเจนซี่
        const need = groupQuota(g) || (listPlat === 'all' ? (Number(g.kol_count) || 0) : 0);
        const { perClip, clips } = groupClipNeed(g, plats, listCtype === 'all' ? null : listCtype);
        const needClips = clips || need;
        // สรุปค่าตัวของกลุ่ม: งบ (กลุ่ม × Platform) เทียบกับค่าตัวที่ใส่แล้ว — ไม่นับคนที่ "ไม่เลือก"
        const feeBudget = plats.reduce((n, p) => n + feeBudgetFor(project, g, p), 0);
        const feeRows = plats.flatMap(p => feeEligible(submissions, g, p));
        const feeSet = feeRows.reduce((n, s) => n + feeOf(s), 0);
        const feeMissing = countPeople(feeRows.filter(s => feeOf(s) <= 0));
        return (
            <>
                <GroupNeedHead group={g} gi={gi} products={products} platforms={plats}
                    need={need} perClip={perClip} needClips={needClips}
                    sent={countPeople(scoped)} sentClips={scoped.length}
                    progExtra={(
                        // เฉพาะทีม: ส่งมากี่คนแล้วเลือกไปกี่คน (หน้าเอเจนซี่ไม่มีบรรทัดนี้)
                        // แยกคลิปเป็นบรรทัดของตัวเอง คอลัมน์ขวาจะได้ไม่กว้างกว่าของเอเจนซี่มาก (จอแคบหัวกลุ่มไม่โดนบีบ)
                        <div className="ag-group-prog-conf">
                            <div>คัดเลือกแล้ว {conf}{need > 0 ? '/' + need : ''} คน</div>
                            {perClip > 1 && <div className="ag-group-prog-conf-clip">{confRows.length}/{needClips} คลิปที่คัดเลือก</div>}
                        </div>
                    )} />
                {(feeBudget > 0 || feeRows.length > 0) && (
                    <div className="ag-budget-bar fee-group-bar">
                        <span className="ag-budget-info">
                            💰 งบกลุ่มนี้ <b>{feeBudget > 0 ? '฿' + feeBudget.toLocaleString('th-TH') : '—'}</b>
                            {' · '}ใส่แล้ว <b>฿{feeSet.toLocaleString('th-TH')}</b>
                            {' · '}{feeRows.length === 0
                                ? <span className="muted">ยังไม่มีรายชื่อ</span>
                                : feeMissing > 0
                                    ? <span className="fee-missing-txt">ยังไม่ใส่ค่าตัว {feeMissing} คน</span>
                                    : <span className="fee-done-txt">✓ ใส่ค่าตัวครบ</span>}
                            {listPlat !== 'all' && <span className="muted"> ({listPlat})</span>}
                        </span>
                        <div className="ag-budget-actions">
                            {/* กลุ่มที่ไม่มีงบ = ไม่มีอะไรให้หาร จึงไม่มีปุ่มหาร */}
                            {feeBudget > 0 && (
                                <button type="button" className="ag-divide-btn" disabled={feeRows.length === 0}
                                    onClick={() => setFeeModal({ key: g.key, gi, mode: 'divide' })}
                                    title="หารงบของกลุ่มเท่า ๆ กันต่อคลิป — ดูตัวอย่างก่อนบันทึก">
                                    = หารเฉลี่ยเท่ากัน
                                </button>
                            )}
                            <button type="button" className="ag-clear-btn" disabled={!feeRows.some(s => feeOf(s) > 0)}
                                onClick={() => setFeeModal({ key: g.key, gi, mode: 'clear' })}
                                title="ตั้งค่าตัวของทุกคนในกลุ่มนี้กลับเป็น 0 (ดูตัวอย่างและยืนยันก่อน)">
                                ล้างค่าตัว
                            </button>
                        </div>
                    </div>
                )}
            </>
        );
    };


    return (
        <div>
            {/* Hero banner */}
            <div className="pd-hero">
                <button className="pd-back" onClick={() => navigate('/projects')} title="กลับ"><Icon name="back" size={18} /></button>
                <div className="pd-hero-main">
                    <div className="pd-hero-top">
                        <span className={`status status-${project.status}`}>{STATUS_LABEL[project.status] || project.status}</span>
                        {project.team_name && <span className="pd-chip">{project.team_name}</span>}
                        {project.brand && <span className="pd-chip"><Icon name="tag" size={12} /> {project.brand}</span>}
                    </div>
                    <h1 className="pd-title">{project.name}</h1>
                    <div className="pd-hero-by">
                        {(project.creator || project.created_by_name) && <span>👤 สร้างโดย {project.creator || project.created_by_name}</span>}
                        {project.updated_by_name && <span> · ✎ แก้ไขล่าสุดโดย {project.updated_by_name}</span>}
                    </div>
                </div>
                <div className="pd-hero-actions">
                    <label className="quick-status">
                        สถานะ:
                        <select value={project.status} onChange={e => changeStatus(e.target.value)}>
                            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                    </label>
                    <button className="pd-edit-btn" onClick={() => setShowEdit(true)}>
                        <Icon name="edit" size={15} /> แก้ไข
                    </button>
                    <button className="pd-del-btn" onClick={() => setShowDelConfirm(true)} title="ลบโปรเจคนี้">
                        <Icon name="trash" size={15} /> ลบ
                    </button>
                </div>
            </div>

            {/* การ์ดตัวเลขสำคัญ */}
            <div className="pd-metrics">
                <div className="pd-metric">
                    <div className="pd-metric-icon budget"><Icon name="coins" size={22} /></div>
                    {(() => {
                        // งบที่ตั้งไว้ + ที่รีเควสเพิ่มทีหลัง (ใช้กติกาเดียวกับหน้าภาพรวม)
                        const planned = Number(project.budget) || 0;
                        const spent = submissions.filter(s => s.status === 'confirmed').reduce((n, s) => n + (Number(s.budget) || 0), 0);
                        const extra = Math.max(0, spent - planned);
                        // คนที่คัดเลือกแล้วแต่ค่าตัวยังเป็น 0 — ยอดงบด้านบนยังไม่รวมคนกลุ่มนี้
                        const feeWait = countPeople(submissions.filter(s => s.status === 'confirmed' && feeOf(s) <= 0));
                        return (
                            <div>
                                <div className="pd-metric-label">งบประมาณ</div>
                                <div className="pd-metric-value">฿{(planned + extra).toLocaleString('th-TH')}</div>
                                {extra > 0 && (
                                    <div className="pd-metric-extra">ตั้งไว้ ฿{planned.toLocaleString('th-TH')} · เพิ่มระหว่างทาง ฿{extra.toLocaleString('th-TH')}</div>
                                )}
                                {feeWait > 0 && (
                                    <div className="pd-metric-extra fee-wait-line">คัดเลือกแล้วแต่ยังไม่ใส่ค่าตัว {feeWait} คน</div>
                                )}
                            </div>
                        );
                    })()}
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon kol"><Icon name="star" size={22} /></div>
                    <div><div className="pd-metric-label">จำนวน KOL (คัดเลือกแล้ว)</div><div className="pd-metric-value">{countPeople(submissions.filter(s => s.status === 'confirmed'))}{project.kol_target ? <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)' }}> / {project.kol_target}</span> : ''}</div></div>
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon date"><Icon name="calendar" size={20} /></div>
                    <div><div className="pd-metric-label">ช่วงเวลา</div><div className="pd-metric-value sm">{fmtRange(project.start_date, project.end_date, ' → ')}</div></div>
                </div>
                <div className="pd-metric">
                    <div className="pd-metric-icon owner"><Icon name="users" size={20} /></div>
                    <div><div className="pd-metric-label">Project Owner</div><div className="pd-metric-value sm">{project.owner || '—'}</div></div>
                </div>
            </div>

            {/* รายละเอียด / บรีฟ / สินค้า */}
            {(project.objective || project.brief_link || project.brief_file || project.products?.length > 0 || project.ad_groups?.length > 0) && (
                <div className="panel pd-details">
                    {project.objective && (
                        <div className="pd-block">
                            <div className="pd-block-title"><Icon name="file" size={15} /> รายละเอียดแคมเปญ</div>
                            <p className="pd-block-text">{project.objective}</p>
                        </div>
                    )}
                    {/* บรีฟหลักของแคมเปญ — เดิมหน้านี้ไม่เคยแสดงเลย เห็นแต่บรีฟตาม Platform ที่ตอนนี้เลิกใช้แล้ว */}
                    {(project.brief_link || project.brief_file) && (
                        <div className="pd-block">
                            <div className="pd-block-title"><Icon name="file" size={15} /> บรีฟหลักของแคมเปญ</div>
                            <div className="pd-pf-briefs">
                                {project.brief_link && (
                                    <a className="brief-link" href={project.brief_link} target="_blank" rel="noreferrer">
                                        <Icon name="eye" size={14} /> เปิดลิงก์บรีฟ
                                    </a>
                                )}
                                {project.brief_file && (
                                    <button type="button" className="file-view" style={{ flex: 'none' }}
                                        onClick={() => openFile(`/projects/${id}/brief/file`).catch(e => alert(e.message))}>
                                        <Icon name="file" size={14} /> <span className="file-name">{project.brief_file.original}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {project.brief_note && (
                        <div className="pd-block">
                            <div className="pd-block-title"><Icon name="file" size={15} /> บรีฟหลัก (ข้อความ)</div>
                            <p className="pd-block-text">{project.brief_note}</p>
                        </div>
                    )}
                    {(() => {
                        const pb = Object.entries(project.platform_budgets || {}).filter(([, v]) => Number(v) > 0);
                        if (pb.length === 0) return null;
                        return (
                            <div className="pd-block">
                                <div className="pd-block-title"><Icon name="coins" size={15} /> งบต่อ Platform</div>
                                <div className="pd-pf-budgets">
                                    {pb.map(([pf, v]) => (
                                        <span className="pd-pf-budget" key={pf}>📱 {pf} <b>฿{Number(v).toLocaleString('th-TH')}</b></span>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                    {(project.ad_groups?.length > 0 || project.products?.length > 0) && (
                        <div className="pd-block">
                            <div className="pd-block-title"><Icon name="tag" size={15} /> สินค้า &amp; กลุ่มโฆษณา</div>
                            {project.ad_groups?.length > 0 ? (
                                <div className="adg-cards">
                                    {project.ad_groups.map((g, i) => {
                                        // โครงใหม่ กลุ่ม > Platform > Content Type > Tier — ค่าทุกอย่างอ่านต่อ Platform
                                        const blocks = toBlocks(g);
                                        return (
                                        <div className="adg-card" key={i}>
                                            <div className="adg-card-head">
                                                <span className="adg-badge">กลุ่มที่ {i + 1}</span>
                                                {hasOwnConcepts(g)
                                                    ? <span className="adg-concept">📝 Concept แยกตามสินค้า</span>
                                                    : g.concept && <span className="adg-concept">📝 Concept: {g.concept}</span>}
                                                {/* ตั้ง "-" ในฟอร์มแคมเปญ — ทีมจะได้รู้ว่าช่อง Gencode ว่างในกลุ่มนี้ไม่ใช่ลืมกรอก */}
                                                {groupNoGencode(g) && <span className="adg-concept" title="กลุ่มนี้ไม่ใช้ Gencode">ไม่ใช้ Gencode</span>}
                                                {blocksKol(blocks) > 0 && <span className="adg-kol">⭐ รวม {blocksKol(blocks)} KOL</span>}
                                                {blocksBudget(blocks) > 0 && <span className="adg-budget">💰 รวม ฿{blocksBudget(blocks).toLocaleString('th-TH')}</span>}
                                            </div>
                                            <ConceptLines group={g} className="adg" />
                                            {g.brief && (
                                                <a className="brief-link adg-brief" href={g.brief} target="_blank" rel="noreferrer">
                                                    <Icon name="eye" size={13} /> เปิดบรีฟกลุ่มนี้
                                                </a>
                                            )}
                                            {blocks.length === 0 && <div className="muted" style={{ fontSize: 12 }}>กลุ่มนี้ยังไม่ได้เลือก Platform</div>}
                                            <div className="adg-plats">
                                                {blocks.map((b, bi) => (
                                                    <div className="adg-plat-block" key={bi}>
                                                        <div className="adg-pb-head">
                                                            <span className="adg-plat">📱 {b.platform}</span>
                                                            {blockKol(b) > 0 && <span className="adg-pb-kol">⭐ {blockKol(b)} คน</span>}
                                                            {num(b.budget) > 0 && <span className="adg-pb-budget">฿{num(b.budget).toLocaleString('th-TH')}</span>}
                                                            {(b.clips || []).length > 1 && <span className="adg-pb-clip">🎬 {b.clips.length} Content / คน</span>}
                                                        </div>
                                                        <div className="adg-fields">
                                                            {/* บล็อกที่ตั้ง Target แยกต่อสินค้า: 1 แถว = สินค้า + Target ของสินค้านั้น */}
                                                            {needTarget(b.platform) && b.product_targets && (b.products || []).length > 0 ? (
                                                                <div className="adg-field">
                                                                    <span className="adg-label">สินค้า + Target <span className="adg-count">({b.products.length})</span></span>
                                                                    <div className="adg-ptgt">
                                                                        {groupByTargets(b).map(r => (
                                                                            <div className="adg-ptgt-row" key={r.key}>
                                                                                <div className="adg-ptgt-tg">
                                                                                    {r.targets.length > 0
                                                                                        ? r.targets.map(t => <span className="chip-target" key={t}>🎯 {t}</span>)
                                                                                        : <span className="muted">ไม่ระบุ Target</span>}
                                                                                    <span className="adg-count">· {r.codes.length} สินค้า</span>
                                                                                </div>
                                                                                <ProductChips products={r.codes} />
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ) : (<>
                                                            <div className="adg-field">
                                                                <span className="adg-label">สินค้า <span className="adg-count">({(b.products || []).length})</span></span>
                                                                <div className="adg-val">
                                                                    {(b.products || []).length > 0
                                                                        ? <ProductChips products={b.products} />
                                                                        : <span className="muted">ไม่ระบุ</span>}
                                                                </div>
                                                            </div>
                                                            {/* Target มีเฉพาะ Platform ที่ใช้ยิงแอด (TikTok) */}
                                                            {needTarget(b.platform) && (
                                                                <div className="adg-field">
                                                                    <span className="adg-label">กลุ่มเป้าหมาย (Target)</span>
                                                                    <div className="adg-val">
                                                                        {b.target.length > 0
                                                                            ? b.target.map(t => <span className="chip-target" key={t}>🎯 {t}</span>)
                                                                            : <span className="muted">ไม่ระบุ</span>}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            </>)}
                                                            {/* งบแยกต่อสินค้า (ผลรวม = งบของ Platform ที่หัวบล็อก) */}
                                                            {isSplitBudget(b) && (b.products || []).length > 0 && (
                                                                <div className="adg-field">
                                                                    <span className="adg-label">งบต่อสินค้า</span>
                                                                    <div className="adg-val">
                                                                        {b.products.map(c => (
                                                                            <span className="adg-pbud" key={c} title={productLabel(c)}>
                                                                                <b>{c}</b> ฿{num((b.product_budgets || {})[c]).toLocaleString('th-TH')}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {/* 1 Platform มีได้หลาย Content Type แต่ละอันมี Tier ของตัวเอง */}
                                                        <div className="adg-sets">
                                                            {b.sets.map((s, si) => (
                                                                <div className="adg-set" key={si}>
                                                                    <div className="adg-set-chips">
                                                                        {s.content_type
                                                                            ? <span className="chip-ctype">{s.content_type}</span>
                                                                            : <span className="muted">ยังไม่ตั้ง Content Type</span>}
                                                                        {s.media_type && <span className="chip-ctype media">{s.media_type}</span>}
                                                                        {splitCsv(s.content_format).map(x => <span className="chip-ctype fmt" key={x}>{x}</span>)}
                                                                    </div>
                                                                    <div className="adg-set-tiers">
                                                                        {(s.tiers || []).filter(t => t.tier || num(t.kols)).map((t, ti) => (
                                                                            <span className="adg-alloc" key={ti}><b>{t.tier || '—'}</b> · {num(t.kols)} คน</span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="chip-list">
                                    {project.products.map(p => {
                                        const name = typeof p === 'string' ? p : p.name;
                                        const target = typeof p === 'string' ? '' : p.target;
                                        return <span className="chip-item" key={name} style={{ padding: '4px 11px' }}>{productLabel(name)}{target && <span className="chip-target">🎯 {target}</span>}</span>;
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ===== KOL ใน Project (จาก Agency + เพิ่มเอง) ===== */}
            <div className="section-head">
                <h3>KOL ใน Project</h3>
                <div className="row-actions">
                    <button className="btn-ghost" onClick={() => setShowLinks(v => !v)}>
                        <Icon name="upload" size={16} /> ลิงก์ให้ Agency{agencyLinks.length > 0 && ` (${agencyLinks.length})`}
                    </button>
                    <button className="btn-primary" onClick={() => openAddSub()}>
                        <Icon name="plus" size={17} /> เพิ่ม KOL
                    </button>
                </div>
            </div>

            {showLinks && (
                <div className="agency-links-panel">
                    {newAccount && (
                        <div className="alp-newacc">
                            <div className="alp-newacc-head">
                                <span>🔑 สร้างบัญชีให้เรียบร้อย — ส่งข้อมูลนี้ให้เอเจนซี่</span>
                                <button type="button" onClick={() => setNewAccount(null)} title="ปิด">×</button>
                            </div>
                            <div className="alp-newacc-body">
                                <div><span className="alp-newacc-k">Username</span><code>{newAccount.username}</code></div>
                                <div><span className="alp-newacc-k">รหัสชั่วคราว</span><code>{newAccount.password}</code></div>
                            </div>
                            <div className="alp-newacc-foot">
                                <button type="button" className="btn-primary" onClick={() => {
                                    navigator.clipboard.writeText('Username: ' + newAccount.username + String.fromCharCode(10) + 'Password: ' + newAccount.password);
                                    setPwCopied(true);
                                }}>
                                    <Icon name={pwCopied ? 'check' : 'copy'} size={15} /> {pwCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                                </button>
                                <span className="alp-hint">ปิดกล่องนี้แล้วจะดูรหัสอีกไม่ได้ · ให้เอเจนซี่กด "เปลี่ยนรหัสผ่าน" ตั้งของตัวเองตอนเข้าครั้งแรก</span>
                            </div>
                        </div>
                    )}
                    <div className="alp-head">
                        <span>ลิงก์แยกต่อเอเจนซี่ <span className="dash-section-sub">แต่ละเจ้าเห็นเฉพาะ KOL ที่ตัวเองส่ง</span></span>
                    </div>
                    {agencyLinks.length === 0
                        ? <p className="empty" style={{ padding: '10px 0' }}>ยังไม่มีลิงก์ — ตั้งชื่อเอเจนซี่แล้วกด "สร้างลิงก์" ด้านล่าง</p>
                        : (
                            <div className="alp-list">
                                {agencyLinks.map(l => (
                                    <AgencyLinkRow
                                        key={l.token}
                                        l={l}
                                        url={linkUrl(l.token)}
                                        copied={copiedToken === l.token}
                                        onCopy={() => copyLink(l.token)}
                                        onEdit={() => startEdit(l)}
                                        onDelete={() => deleteLink(l.token)}
                                        projectId={id}
                                        unread={chatUnread[l.token] || 0}
                                        boundTo={(agencyAccounts.find(a => (a.agency_tokens || []).includes(l.token)) || {}).username}
                                        onChat={() => window.dispatchEvent(new CustomEvent('kol:open-chat', {
                                            detail: { project_id: id, project_name: project.name, token: l.token, agency_name: l.name }
                                        }))}
                                    />
                                ))}
                            </div>
                        )}
                    {/* ปุ่มเปิดฟอร์มเพิ่มเอเจนซี่ (ซ่อนฟอร์มไว้ก่อน) */}
                    {!showCreate && (
                        <button type="button" className="alp-add-agency" onClick={() => { setEditToken(null); setLinkPick(''); setNewLinkName(''); setNewLinkGroups([]); setNewLinkProducts([]); setNewLinkPlatforms([]); setNewLinkKol(''); setShowCreate(true); }}>
                            <Icon name="plus" size={16} /> เพิ่มเอเจนซี่
                        </button>
                    )}
                    {/* ฟอร์มสร้างลิงก์ + กำหนดขอบเขตงานของเอเจนซี่ */}
                    {showCreate && (
                    <div className="alp-create">
                        {editToken && <div className="alp-edit-head">✏️ กำลังแก้ไขลิงก์นี้ <span className="alp-hint">URL เดิมไม่เปลี่ยน ลิงก์ที่ส่งไปแล้วยังใช้ได้</span></div>}
                        <div className="alp-create-row">
                            <select className="alp-agency-pick" value={linkPick} onChange={e => { setLinkPick(e.target.value); setNewLinkName(''); }}>
                                <option value="">— เลือกเอเจนซี่ —</option>
                                {agencyAccounts.map(a => (
                                    <option key={a.id} value={'u' + a.id}>{a.username}</option>
                                ))}
                                {user?.role === 'admin' && !editToken && <option value="__NEW__">＋ เอเจนซี่ใหม่ (สร้างบัญชี + รหัสให้เลย)</option>}
                                <option value="__FREE__">พิมพ์ชื่อเอง (ยังไม่สร้างบัญชี)</option>
                            </select>
                            <input type="number" min="0" className="alp-kol-input" value={newLinkKol} onChange={e => setNewLinkKol(e.target.value)} placeholder="จำนวน KOL" />
                        </div>
                        {(editToken || linkPick === '__NEW__' || linkPick === '__FREE__') && (
                            <div className="alp-create-row">
                                <input value={newLinkName} onChange={e => setNewLinkName(e.target.value)}
                                    placeholder={linkPick === '__NEW__' ? 'ชื่อบัญชีเอเจนซี่ (ใช้เข้าสู่ระบบ เช่น Mesaran House)' : 'ชื่อเอเจนซี่ (เช่น Agency A)'}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createLink(); } }} autoFocus />
                            </div>
                        )}
                        {linkPick === '__FREE__' && !editToken && (
                            <p className="alp-hint">ลิงก์จะใช้งานได้ก็ต่อเมื่อมีบัญชีเอเจนซี่ผูกไว้ — สร้างบัญชีให้ทีหลังได้ที่หน้าผู้ใช้งาน</p>
                        )}
                        {linkGroups.length > 0 && (
                            <div className="alp-groups">
                                <span className="alp-sc-lbl">กลุ่มที่รับผิดชอบ * <span className="alp-hint">ติ๊กกลุ่มแล้ว Platform/สินค้า/จำนวน KOL จะตามมาเอง · เลือกได้มากกว่า 1 กลุ่ม</span></span>
                                {needGroup && <div className="alp-need-group">⚠ ต้องเลือกอย่างน้อย 1 กลุ่ม ไม่งั้นเอเจนซี่จะเห็นงานของทุกกลุ่มในแคมเปญนี้</div>}
                                <div className="alp-group-list">
                                    {linkGroups.map((g, gi) => (
                                        <label key={g.key} className={"alp-group-pick" + (newLinkGroups.includes(g.key) ? " on" : "")}>
                                            <input type="checkbox" checked={newLinkGroups.includes(g.key)} onChange={() => toggleNewGroup(g.key)} />
                                            <span className="alp-group-no">กลุ่มที่ {gi + 1}</span>
                                            {g.concept && <span className="alp-group-concept">{g.concept}</span>}
                                            <span className="alp-group-meta">
                                                {groupPlatforms(g).join(" · ") || "ไม่ระบุ Platform"}
                                                {g.kol_count > 0 ? " · " + g.kol_count + " KOL" : ""}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="alp-create-scope">
                            <div className="alp-sc-col">
                                <span className="alp-sc-lbl">1. Platform ที่รับผิดชอบ</span>
                                {newLinkPlatforms.length > 0 && (
                                    <div className="alp-chips">
                                        {newLinkPlatforms.map(p => <span className="chip-item" key={p}>{p}<button type="button" onClick={() => toggleNewPlatform(p)}>×</button></span>)}
                                    </div>
                                )}
                                <select value="" disabled={projectPlatforms.length === 0}
                                    onChange={e => {
                                        if (e.target.value === '__ALL__') {
                                            const allSel = projectPlatforms.every(p => newLinkPlatforms.includes(p));
                                            if (allSel) { setNewLinkPlatforms([]); setNewLinkProducts([]); }
                                            else setNewLinkPlatforms([...projectPlatforms]);
                                        } else if (e.target.value) toggleNewPlatform(e.target.value);
                                        e.target.value = '';
                                    }}>
                                    <option value="">{projectPlatforms.length ? '+ เพิ่ม Platform' : '— โปรเจคยังไม่มี Platform —'}</option>
                                    {projectPlatforms.length > 0 && (
                                        <option value="__ALL__">{projectPlatforms.every(p => newLinkPlatforms.includes(p)) ? '✓ ทุก Platform (เลือกครบแล้ว)' : '☑ ทุก Platform'}</option>
                                    )}
                                    {projectPlatforms.filter(p => !newLinkPlatforms.includes(p)).map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div className="alp-sc-col">
                                <span className="alp-sc-lbl">2. สินค้าที่รับผิดชอบ {newLinkProducts.length > 0 && <span className="adg-count">({newLinkProducts.length})</span>}</span>
                                {newLinkProducts.length > 0 && (
                                    <div className="prodchip-wrap alp-chips">
                                        {newLinkProducts.map(c => (
                                            <span className="prodchip removable" key={c} title={productLabel(c)}>
                                                {c}<button type="button" onClick={() => toggleNewProduct(c)} title="เอาออก">×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <select value="" disabled={newLinkPlatforms.length === 0 || availProducts.length === 0}
                                    onChange={e => {
                                        if (e.target.value === '__ALL__') {
                                            const allSel = availProducts.every(c => newLinkProducts.includes(c));
                                            setNewLinkProducts(allSel ? [] : [...availProducts]);
                                        } else if (e.target.value) toggleNewProduct(e.target.value);
                                        e.target.value = '';
                                    }}>
                                    <option value="">{newLinkPlatforms.length === 0 ? '— เลือก Platform ก่อน —' : (availProducts.length ? '+ เพิ่มสินค้า' : '— Platform นี้ยังไม่มีสินค้า —')}</option>
                                    {availProducts.length > 0 && (
                                        <option value="__ALL__">{availProducts.every(c => newLinkProducts.includes(c)) ? '✓ ทุกสินค้า (เลือกครบแล้ว)' : '☑ ทุกสินค้า'}</option>
                                    )}
                                    {availProducts.filter(c => !newLinkProducts.includes(c)).map(c => <option key={c} value={c}>{productLabel(c)}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="alp-create-actions">
                            <button type="button" className="btn-ghost" onClick={resetLinkForm}>ยกเลิก</button>
                            {editToken
                                ? <button className="btn-primary alp-create-btn" onClick={saveLinkEdit} disabled={needGroup} title={needGroup ? "เลือกกลุ่มที่รับผิดชอบก่อน" : undefined}><Icon name="check" size={15} /> บันทึกการแก้ไข</button>
                                : <button className="btn-primary alp-create-btn" onClick={createLink} disabled={needGroup} title={needGroup ? "เลือกกลุ่มที่รับผิดชอบก่อน" : undefined}><Icon name="plus" size={15} /> สร้างลิงก์</button>}
                        </div>
                    </div>
                    )}
                </div>
            )}

            {/* แท็บ: รายชื่อ KOL / On Process */}
            <div className="agency-tabs">
                <button className={subTab === 'list' ? 'active' : ''} onClick={() => setSubTab('list')}>
                    รายชื่อ KOL <span className="agency-tab-count">{submissions.length}</span>
                    {badges.listNew && <span className="tab-new-dot" title="มีอัปเดตใหม่" />}
                </button>
                <button className={subTab === 'process' ? 'active' : ''} onClick={() => setSubTab('process')}>
                    On Process {submissions.filter(s => s.status === 'confirmed').length > 0 && <span className="agency-tab-count">{submissions.filter(s => s.status === 'confirmed').length}</span>}
                    {/* ข้อมูลโพสต์ที่เอเจนซี่ส่งมารอทีมตรวจ (ยังไม่ขึ้นหน้า Ads) */}
                    {submissions.some(s => s.status === 'confirmed' && (s.post_check === 'pending' || s.post_check === 'changed')) && (
                        <span className="tab-check-count" title="ข้อมูลโพสต์ที่เอเจนซี่ส่งมา/แก้ รอทีมตรวจ">
                            รอตรวจ {submissions.filter(s => s.status === 'confirmed' && (s.post_check === 'pending' || s.post_check === 'changed')).length}
                        </span>
                    )}
                    {badges.processNew && <span className="tab-new-dot" title="มีอัปเดตใหม่" />}
                </button>
            </div>

            {/* แถบปุ่มกรองกลุ่มสินค้า — โชว์เมื่อแบ่งเกิน 1 กลุ่ม (นับ "ไม่ระบุกลุ่ม" เป็นหนึ่งกลุ่มด้วย)
                วางบนสุดเหมือนแท็บ On Process เพราะกลุ่มเป็นการแบ่งระดับใหญ่กว่าแพลตฟอร์ม
                ยังไม่มีรายชื่อก็โชว์ เพราะการ์ดกลุ่มขึ้นเสมอ ทีมจะได้เลือกดูความต้องการของกลุ่มเดียวได้ */}
            {subTab === 'list' && groupOpts.length > 1 && (
                <div className="proc-platfilter">
                    <span className="proc-platfilter-lbl">กลุ่ม:</span>
                    <button type="button" className={'proc-plat-chip' + (curGroup === 'all' ? ' on' : '')}
                        onClick={() => setListGroup('all')}>ทั้งหมด ({countPeople(submissions)})</button>
                    {groupOpts.map(o => (
                        <button type="button" key={o.key}
                            className={'proc-plat-chip' + (curGroup === o.key ? ' on' : '')}
                            title={o.key === NO_GROUP ? 'KOL ที่ยังไม่ได้ถูกจัดเข้ากลุ่มไหน'
                                : [o.products.join(', '), o.concept].filter(Boolean).join(' · ')}
                            onClick={() => setListGroup(o.key)}>
                            {o.key === NO_GROUP ? 'ไม่ระบุกลุ่ม' : `กลุ่มที่ ${o.no}${o.concept ? ' · ' + o.concept : ''}`} ({o.count})
                        </button>
                    ))}
                </div>
            )}
            {subTab === 'list' && listPlatforms.length > 1 && submissions.length > 0 && (
                <div className="proc-platfilter">
                    <span className="proc-platfilter-lbl">แพลตฟอร์ม:</span>
                    <button type="button" className={'proc-plat-chip' + (listPlat === 'all' ? ' on' : '')}
                        onClick={() => { setListPlat('all'); setListCtype('all'); }}>ทั้งหมด ({countPeople(submissions)})</button>
                    {listPlatforms.map(p => (
                        <button type="button" key={p} className={'proc-plat-chip' + (listPlat === p ? ' on' : '')}
                            onClick={() => { setListPlat(p); setListCtype('all'); }}>
                            {p} ({countPeople(submissions.filter(s => s.platform === p))}/{quotaFor(p) || '—'})
                        </button>
                    ))}
                </div>
            )}
            {/* แบ่งย่อยตาม Content Type ของแพลตฟอร์มที่เลือก — ส่งแล้ว/ที่ต้องการ */}
            {subTab === 'list' && listPlat !== 'all' && subCtypes.length > 1 && submissions.length > 0 && (
                <div className="proc-platfilter proc-ctypefilter">
                    <span className="proc-platfilter-lbl">Content Type:</span>
                    <button type="button" className={'proc-plat-chip' + (listCtype === 'all' ? ' on' : '')}
                        onClick={() => setListCtype('all')}>
                        ทั้งหมด ({countPeople(submissions.filter(s => s.platform === listPlat))}/{quotaFor(listPlat) || '—'})
                    </button>
                    {subCtypes.map(ct => (
                        <button type="button" key={ct} className={'proc-plat-chip' + (listCtype === ct ? ' on' : '')}
                            onClick={() => setListCtype(ct)}>
                            {ct} ({countPeople(submissions.filter(s => s.platform === listPlat && s.content_type === ct))}/{quotaFor(listPlat, ct) || '—'})
                        </button>
                    ))}
                </div>
            )}
            {/* ตัวกรองสินค้า (เลือกได้หลายตัว) — จำนวนนับเป็นคน ตามตัวกรอง Platform / Content Type ที่เลือกอยู่ */}
            {subTab === 'list' && submissions.length > 0 && (
                <ProductFilter options={productFilterOptions(submissions.filter(matchScope), knownCodes, countPeople)}
                    value={listProducts} onChange={setListProducts} total={countPeople(submissions.filter(matchScope))} />
            )}
            {/* ตัวกรองคนที่ยังไม่ใส่ค่าตัว — แถวของตัวเอง โชว์ตลอด ใช้ร่วมกับตัวกรอง Platform / Content Type ด้านบนได้ */}
            {subTab === 'list' && submissions.length > 0 && (
                <div className="proc-platfilter fee-filter-row">
                    <button type="button" aria-pressed={feeOnly}
                        className={'proc-plat-chip fee-filter-chip' + (feeOnly ? ' on' : '') + (feeMissingCount > 0 ? ' has' : '')}
                        onClick={() => setFeeOnly(v => !v)}>
                        {feeOnly ? '✓ ' : ''}ยังไม่ใส่ค่าตัว ({feeMissingCount})
                    </button>
                    {feeOnly && <span className="fee-filter-hint">แสดงเฉพาะคนที่ยังไม่ใส่ค่าตัว · ไม่นับคนที่ไม่เลือก</span>}
                </div>
            )}
            {subTab === 'list' && (
                project.ad_groups?.length > 0 ? (
                    /* แบ่งตามกลุ่มสินค้า — การ์ดกลุ่มขึ้นเสมอแม้ยังไม่มีรายชื่อ (เหมือนหน้าเอเจนซี่) ทีมจะได้เห็นว่าแต่ละกลุ่มต้องการอะไร */
                    <>
                        {project.ad_groups.map((g, gi) => {
                            // เลือกดูทีละกลุ่ม — การ์ดกลุ่มอื่นซ่อนหมด (เลือก "ไม่ระบุกลุ่ม" ก็ซ่อนการ์ดกลุ่มจริงทั้งหมด)
                            if (curGroup !== 'all' && g.key !== curGroup) return null;
                            // กรอง Platform ที่กลุ่มนี้ไม่ได้ลง และไม่มีรายชื่อค้างของ Platform นั้น = ไม่มีอะไรให้ดู ข้ามทั้งการ์ด
                            // แต่กลุ่มที่เลือกอยู่ต้องโชว์การ์ดเสมอ ไม่งั้นหน้าว่างทั้งหน้าโดยไม่บอกอะไรเลย
                            if (curGroup === 'all' && listPlat !== 'all' && !groupPlatforms(g).includes(listPlat)
                                && !submissions.some(s => s.group_key === g.key && matchScope(s))) return null;
                            const gsubs = submissions.filter(s => s.group_key === g.key && matchListFilter(s));
                            return (
                                <div className="kol-group-card agency-card ag-group" key={g.key || gi}>
                                    {teamGroupHead(g, gi)}
                                    {cellBlocks(g, gsubs)}
                                </div>
                            );
                        })}
                        {(() => {
                            const gkeys = new Set(project.ad_groups.map(g => g.key));
                            const ung = submissions.filter(s => (!s.group_key || !gkeys.has(s.group_key)) && matchListFilter(s));
                            // เลือก "ไม่ระบุกลุ่ม" อยู่ = การ์ดกลุ่มจริงถูกซ่อนหมดแล้ว การ์ดนี้จึงต้องขึ้นเสมอ
                            // ไม่งั้นกรองต่อจนไม่เหลือใคร หน้าจะว่างสนิทโดยไม่มีอะไรบอกว่าว่างเพราะตัวกรอง
                            if (ung.length === 0 && curGroup !== NO_GROUP) return null;
                            return (
                                <div className="kol-group-card">
                                    <div className="grp-bar"><span className="grp-no muted-bar">ไม่ระบุกลุ่ม</span><span className="grp-count">{countPeople(ung)} คน</span></div>
                                    {ung.length > 0 ? statusBlocks(ung) : <div className="proc-group-empty">{emptyText('ในกลุ่มนี้')}</div>}
                                </div>
                            );
                        })()}
                    </>
                ) : submissions.length === 0 ? (
                    /* แคมเปญเก่าที่ไม่มีกลุ่มสินค้า และยังไม่มีรายชื่อ */
                    <div className="panel"><p className="empty" style={{ padding: '10px 0' }}>ยังไม่มีรายชื่อจาก Agency — กด "สร้างลิงก์ให้ Agency" แล้วส่งลิงก์ให้เอเจนซี่กรอก</p></div>
                ) : (
                    /* ไม่มีกลุ่มสินค้า → รวมทั้งหมด */
                    ((feeOnly || listProducts.length > 0) && !submissions.some(matchListFilter))
                        ? <div className="proc-group-empty">{emptyText('')}</div>
                        : statusBlocks(submissions.filter(matchListFilter))
                )
            )}

            {subTab === 'process' && (
                    <>
                        <StageCards subs={submissions} value={stage} onChange={setStage} />
                        <div className="panel">
                            <OnProcessTable subs={submissions} groups={project.ad_groups || []} showAds scope={id}
                                putSubmission={putSubmission} reload={loadSubs}
                                initialCheckOnly={openCheckOnly}
                                onPostCheck={async (subId, action, note, seenAt) => {
                                    // โหลดใหม่เสมอ — ถ้าได้ 409 (เอเจนซี่แก้แทรก) ทีมจะเห็นค่าล่าสุดก่อนตรวจอีกรอบ
                                    try { await api(`/projects/${id}/submissions/${subId}/post-check`, { method: 'POST', body: { action, note, seen_at: seenAt } }); }
                                    finally { loadSubs(); }
                                }}
                                stage={stage} onClearStage={() => setStage('all')} />
                        </div>
                    </>
            )}


            {/* กล่องแชทลอย — มีเฉพาะหน้าแคมเปญ แสดงเอเจนซี่ของแคมเปญนี้ */}
            <ChatDock mode="list" projectId={id} />

            {showAddSub && (
                <AddSubmissionModal
                    projectId={id}
                    groups={project.ad_groups || []}
                    products={(project.products || []).map(p => (typeof p === 'string' ? p : p.name))}
                    preset={addSubPreset}
                    onClose={() => setShowAddSub(false)}
                    onAdded={() => { setShowAddSub(false); loadSubs(); }}
                />
            )}

            {feeModal && (() => {
                // อ่านกลุ่มจากข้อมูลแคมเปญล่าสุดทุกครั้ง (เผื่อแคมเปญถูกแก้ระหว่างเปิดหน้าต่าง)
                const g = (project.ad_groups || []).find(x => x.key === feeModal.key);
                if (!g) return null;
                return (
                    <DivideFeesModal
                        projectId={id}
                        project={project}
                        group={g}
                        groupNo={feeModal.gi + 1}
                        mode={feeModal.mode}
                        platforms={feePlatsOf(g)}
                        filtered={listPlat !== 'all'}
                        submissions={submissions}
                        onClose={() => setFeeModal(null)}
                        onReload={loadSubs}
                        onDone={() => { setFeeModal(null); loadSubs(); }}
                    />
                );
            })()}

            {showEdit && (
                <ProjectForm
                    editing={project}
                    onClose={() => setShowEdit(false)}
                    onSaved={() => { setShowEdit(false); load(); }}
                />
            )}

            {showDelConfirm && (
                <div className="modal-backdrop" onClick={() => !deleting && setShowDelConfirm(false)}>
                    <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                        <div className="confirm-icon danger"><Icon name="trash" size={26} /></div>
                        <h3 className="confirm-title">ลบโปรเจคนี้?</h3>
                        <p className="confirm-text">
                            ต้องการลบ <strong>"{project.name}"</strong> ใช่หรือไม่<br />
                            การลบเป็นการลบถาวร กู้คืนไม่ได้
                        </p>
                        <div className="confirm-actions">
                            <button className="btn-ghost" onClick={() => setShowDelConfirm(false)} disabled={deleting}>ยกเลิก</button>
                            <button className="btn-danger" onClick={deleteProject} disabled={deleting}>
                                {deleting ? 'กำลังลบ...' : 'ยืนยันการลบ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
