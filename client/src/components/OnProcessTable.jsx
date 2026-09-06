import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import DraftModal from './DraftModal.jsx';
import PerfModal from './PerfModal.jsx';
import { asTargetArray } from '../data/products.js';
import { ProductSummary } from './ProductChips.jsx';
import { draftIsNew, markDraftSeen } from '../utils/tabUpdates.js';

// ค่าที่เก็บเป็นสตริงคั่นด้วย , (เช่น content_format) → แยกเป็นรายตัว
const splitCsv = v => (v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);

const EXPIRE_OPTS = [30, 45, 60, 90, 120];
// แพลตฟอร์มที่ไม่ใช้ ID Post → ช่องขึ้น "-" อัตโนมัติ (กรอกไม่ได้)
const NO_IDPOST = ['Facebook', 'Lemon8', 'YouTube', 'X'];

// แถวตาราง On Process — อัปเดตงานของ KOL ที่ถูกคัดเลือกแล้ว
// putSubmission(subId, payload) = ผู้เรียกเป็นคนยิง API (agency ใช้ token / ทีมใช้ /projects)
function ProcessRow({ sub, putSubmission, reload, showAds = false, group = null, scope = '', directEdit = false, seq = 1 }) {
    const [draftNew, setDraftNew] = useState(false);
    useEffect(() => { setDraftNew(draftIsNew(scope, sub)); }, [scope, sub.id, sub.draft_updated_at]);
    const openDraft = () => { markDraftSeen(scope, sub); setDraftNew(false); setShowDraft(true); };
    // เด้ง "ดราฟใหม่" เฉพาะดราฟที่ยังไม่ได้ตัดสิน — พอกด Revise/Approve (มี draft_status) แล้วไม่ต้องขึ้นอีก
    const showDraftNew = draftNew && !sub.draft_status;
    const [postUrl, setPostUrl] = useState(sub.post_url || '');
    const [postDate, setPostDate] = useState(sub.post_date || '');
    const [gencode, setGencode] = useState(sub.gencode || '');
    const [idPost, setIdPost] = useState(sub.id_post || '');
    const [codeExpire, setCodeExpire] = useState(sub.code_expire || 60);
    const [showDraft, setShowDraft] = useState(false);
    const [showPerf, setShowPerf] = useState(false);
    const perfFetchUrl = directEdit ? `/agency/${scope}/submissions/${sub.id}/fetch-tiktok` : `/projects/${scope}/submissions/${sub.id}/fetch-tiktok`;
    const hasPerf = (Number(sub.views) || 0) > 0;
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [editing, setEditing] = useState(false); // false = ล็อก (อ่านอย่างเดียว), true = กำลังแก้ไข
    const unlocked = directEdit || editing; // directEdit (ฝั่งเอเจนซี่) = กรอกได้เลยไม่ต้องกดแก้ไข
    const noIdPost = NO_IDPOST.includes(sub.platform); // แพลตฟอร์มนี้ไม่ใช้ ID Post
    // ยิงแอดไปแล้ว = ล็อก ลิงก์โพสต์ / Gencode / ID Post ห้ามแก้
    // เพราะเป็นข้อมูลที่แอดที่ยิงไปแล้วอ้างอิงอยู่ (ฝั่ง server ปฏิเสธซ้ำอีกชั้น)
    const adLocked = sub.ad_status === 'ยิงแล้ว';
    const canEditPost = unlocked && !adLocked;
    const lockTip = 'ยิงแอดไปแล้ว แก้ไม่ได้ — ถ้าต้องแก้จริง ให้กดสถานะกลับเป็น "ยังไม่ยิง" ที่หน้า ADS ก่อน';

    // มีการแก้ไขที่ยังไม่บันทึกหรือไม่ (เทียบกับค่าที่บันทึกไว้ล่าสุด = sub prop)
    const dirty =
        postUrl !== (sub.post_url || '') ||
        postDate !== (sub.post_date || '') ||
        gencode !== (sub.gencode || '') ||
        idPost !== (sub.id_post || '') ||
        Number(codeExpire) !== (Number(sub.code_expire) || 60);

    // ยกเลิกการแก้ไข — คืนค่ากลับเป็นค่าที่บันทึกไว้ล่าสุด แล้วล็อก
    function cancelEdit() {
        setPostUrl(sub.post_url || '');
        setPostDate(sub.post_date || '');
        setGencode(sub.gencode || '');
        setIdPost(sub.id_post || '');
        setCodeExpire(sub.code_expire || 60);
        setEditing(false);
    }

    // บันทึกเฉพาะฟิลด์ในตาราง (โพสต์/วันที่/gencode/id/หมดอายุ) — ต้องกดบันทึกเอง ข้อมูลถึงจะขึ้นฝั่ง Dashboard
    async function save() {
        if (!dirty) { setEditing(false); return; }
        setSaving(true); setSaved(false);
        try {
            await putSubmission(sub.id, {
                post_url: postUrl || null,
                post_date: postDate || null,
                gencode: gencode || null,
                id_post: noIdPost ? null : (idPost || null),
                code_expire: Number(codeExpire) || 60
            });
            setSaved(true); setEditing(false); reload();
            setTimeout(() => setSaved(false), 1800);
        } catch (err) { alert(err.message); }
        finally { setSaving(false); }
    }

    return (
        <div className="proc-row">
            <div className="proc-name">
                <span className="proc-seq">{seq}</span>
                <span className="proc-name-txt">
                    {sub.account_name}
                    {/* คนเดียวกันอาจมีหลายแถว = หลายคลิป บอกให้ชัดว่าแถวนี้คือคลิปไหน */}
                    {sub.clip_name && <span className="proc-clip-tag">🎬 {sub.clip_name}</span>}
                </span>
            </div>
            <div className="proc-cell">
                <ProductSummary value={sub.product} max={2} />
            </div>
            {showAds && (
                <div className="proc-cell">
                    {asTargetArray(group?.target).length > 0
                        ? asTargetArray(group.target).map(t => <span className="proc-ads-tgt" key={t} title={t}>🎯 {t}</span>)
                        : <span className="muted">—</span>}
                </div>
            )}
            {showAds && (
                <div className="proc-cell">
                    {group?.content_type
                        ? <span className="proc-ctype-chip">{group.content_type}</span>
                        : <span className="muted">—</span>}
                </div>
            )}
            {showAds && (
                <div className="proc-cell">
                    {group?.media_type || group?.content_format ? (
                        <>
                            {group.media_type && <span className="proc-ctype-chip media">{group.media_type}</span>}
                            {splitCsv(group.content_format).map(x => <span className="proc-ctype-chip fmt" key={x}>{x}</span>)}
                        </>
                    ) : <span className="muted">—</span>}
                </div>
            )}
            <div className="proc-cell"><span className="proc-plat">{sub.platform || '—'}</span></div>
            <div className="proc-cell proc-draft-cell">
                <button type="button" className={'proc-viewdraft' + (showDraftNew ? ' has-new' : '')} onClick={openDraft}>
                    <Icon name="eye" size={14} /> View Draft
                    {showDraftNew && <span className="draft-new-pill" title="มีดราฟอัปเดตใหม่">ดราฟใหม่</span>}
                </button>
                {sub.draft_status === 'approve' && <span className="draft-verdict approved" title="ทีมอนุมัติดราฟแล้ว">✓ Approved</span>}
                {sub.draft_status === 'revise' && <span className="draft-verdict revise" title="ทีมขอให้แก้ไขดราฟ">↻ ขอแก้ไข</span>}
                <button type="button" className={'proc-perf-btn' + (hasPerf ? ' has' : '')} onClick={() => setShowPerf(true)} title="กรอก/ดูผลงานคอนเทนต์ (Views/Engagement)">
                    📊 {hasPerf ? `${Number(sub.views).toLocaleString()} วิว` : 'Perf'}
                </button>
            </div>
            <div className="proc-cell" title={adLocked ? lockTip : undefined}>
                <input type="url" value={postUrl} onChange={e => setPostUrl(e.target.value)} placeholder="ลิงก์โพสต์" disabled={!canEditPost} />
            </div>
            <div className="proc-cell"><DatePicker value={postDate} onChange={setPostDate} disabled={!unlocked} placeholder="เลือกวัน" /></div>
            <div className="proc-cell" title={adLocked ? lockTip : undefined}>
                <input value={gencode} onChange={e => setGencode(e.target.value)} placeholder="Gencode" disabled={!canEditPost} />
            </div>
            <div className="proc-cell" title={adLocked && !noIdPost ? lockTip : undefined}>{noIdPost
                ? <span className="muted" title="แพลตฟอร์มนี้ไม่ใช้ ID Post">—</span>
                : <input value={idPost} onChange={e => setIdPost(e.target.value)} placeholder="ID Post" disabled={!canEditPost} />}</div>
            <div className="proc-cell">
                <select value={codeExpire} onChange={e => setCodeExpire(e.target.value)} disabled={!unlocked}>
                    {EXPIRE_OPTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>
            <div className="proc-cell proc-act-cell">
                {directEdit ? (
                    saved ? (
                        <button type="button" className="proc-ibtn done" disabled title="บันทึกแล้ว"><Icon name="check" size={16} /></button>
                    ) : (
                        <button type="button" className="proc-ibtn ok" onClick={save} disabled={saving || !dirty} title="บันทึก"><Icon name="check" size={16} /></button>
                    )
                ) : editing ? (
                    <>
                        <button type="button" className="proc-ibtn ok" onClick={save} disabled={saving} title="บันทึก"><Icon name="check" size={16} /></button>
                        <button type="button" className="proc-ibtn x" onClick={cancelEdit} disabled={saving} title="ยกเลิก">✕</button>
                    </>
                ) : saved ? (
                    <button type="button" className="proc-ibtn done" disabled title="บันทึกแล้ว"><Icon name="check" size={16} /></button>
                ) : (
                    <button type="button" className="proc-ibtn edit" onClick={() => setEditing(true)} title="แก้ไข"><Icon name="edit" size={15} /></button>
                )}
            </div>

            {showDraft && (
                <DraftModal
                    sub={sub}
                    onClose={() => setShowDraft(false)}
                    onSave={async (payload) => { const res = await putSubmission(sub.id, payload); if (res?.data) markDraftSeen(scope, res.data); setDraftNew(false); reload(); }}
                />
            )}
            {showPerf && (
                <PerfModal
                    sub={sub}
                    fetchUrl={perfFetchUrl}
                    onClose={() => setShowPerf(false)}
                    onSave={async (payload) => { await putSubmission(sub.id, payload); reload(); }}
                />
            )}
        </div>
    );
}

// หัวตาราง (ใช้ซ้ำในแต่ละกลุ่ม) — showAds = โชว์คอลัมน์ Target/Content Type (เฉพาะฝั่ง Dashboard)
const procHead = (showAds = false) => (
    <div className="proc-tbl-head">
        <span>KOL NAME</span><span>PRODUCT</span>
        {showAds && <span>TARGET</span>}
        {showAds && <span>CONTENT TYPE</span>}
        {showAds && <span>CONTENT FORMAT</span>}
        <span>PLATFORM</span><span>CONTENT DRAFT</span>
        <span>POST</span><span>POST DATE</span><span>GENCODE</span>
        <span>ID POST</span><span>CODE EXPIRE IN</span><span className="ta-c">จัดการ</span>
    </div>
);

// แถบหัวกลุ่มสินค้า (กลุ่มที่ N + รหัสสินค้า + concept + จำนวน)
function GroupBar({ group, gi, count }) {
    return (
        <div className="grp-bar">
            <span className="grp-no">กลุ่มที่ {gi + 1}</span>
            <div className="grp-chips">
                <ProductSummary value={group.products || []} max={4} />
            </div>
            {group.concept && <span className="grp-concept">📝 Concept: {group.concept}</span>}
            <span className="grp-count">{count} คน</span>
        </div>
    );
}

/**
 * ตาราง On Process — แสดง KOL ที่ถูกคัดเลือกแล้ว ให้ทีม/เอเจนซี่อัปเดตงาน + ดราฟ
 * props: subs, groups (ad_groups — ถ้ามีจะแบ่งเป็นกลุ่มสินค้า), putSubmission(subId, payload), reload()
 */
export default function OnProcessTable({ subs = [], groups = [], showAds = false, scope = '', putSubmission, reload, directEdit = false }) {
    const [platFilter, setPlatFilter] = useState('all');   // ตัวกรองตามแพลตฟอร์ม
    const [clipFilter, setClipFilter] = useState('all');   // ตัวกรองตามคลิป (กลุ่มที่ 1 คนส่งหลายคลิป)
    // เรียงเก่า -> ใหม่ ให้ตรงกับแท็บรายชื่อและฝั่งลิงก์เอเจนซี่ (API ส่งมาแบบใหม่สุดขึ้นก่อน)
    const confirmed = subs.filter(s => s.status === 'confirmed')
        .slice().sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || '') || (a.id - b.id));
    if (confirmed.length === 0) {
        return <p className="empty" style={{ padding: '20px 0' }}>ยังไม่มี KOL ที่ถูกคัดเลือก — คัดเลือก KOL ก่อนจึงจะอัปเดตงานได้</p>;
    }
    // แพลตฟอร์มที่มีจริงในลิสต์ (ทำเป็นปุ่มกรอง)
    const platforms = [...new Set(confirmed.map(s => s.platform).filter(Boolean))];
    // ชื่อคลิปที่มีจริงในลิสต์ (กลุ่มที่ 1 คนส่ง 2 คลิปจะมีมากกว่า 1 ชื่อ)
    const clipNames = [...new Set(confirmed.map(s => s.clip_name).filter(Boolean))];
    const view = confirmed
        .filter(s => platFilter === 'all' || (s.platform || '') === platFilter)
        .filter(s => clipFilter === 'all' || (s.clip_name || '') === clipFilter);

    const groupMap = {};
    groups.forEach(g => { groupMap[g.key] = g; });
    const tblCls = 'proc-tbl' + (showAds ? ' with-ads' : '');
    const rowsFor = list => list.map((s, i) => (
        <ProcessRow key={s.id} sub={s} seq={i + 1} putSubmission={putSubmission} reload={reload} showAds={showAds} scope={scope} group={groupMap[s.group_key] || null} directEdit={directEdit} />
    ));

    // แถบปุ่มกรองคลิป — โชว์เมื่อแคมเปญนี้มีคนที่ต้องส่งมากกว่า 1 คลิป
    const clipBar = clipNames.length > 1 ? (
        <div className="proc-platfilter">
            <span className="proc-platfilter-lbl">คลิป:</span>
            <button type="button" className={'proc-plat-chip' + (clipFilter === 'all' ? ' on' : '')} onClick={() => setClipFilter('all')}>ทั้งหมด ({confirmed.length})</button>
            {clipNames.map(c => (
                <button type="button" key={c} className={'proc-plat-chip' + (clipFilter === c ? ' on' : '')} onClick={() => setClipFilter(c)}>
                    {c} ({confirmed.filter(s => s.clip_name === c).length})
                </button>
            ))}
        </div>
    ) : null;

    // แถบปุ่มกรองแพลตฟอร์ม (โชว์เมื่อมีมากกว่า 1 แพลตฟอร์ม)
    const filterBar = platforms.length > 1 ? (
        <div className="proc-platfilter">
            <span className="proc-platfilter-lbl">แพลตฟอร์ม:</span>
            <button type="button" className={'proc-plat-chip' + (platFilter === 'all' ? ' on' : '')} onClick={() => setPlatFilter('all')}>ทั้งหมด ({confirmed.length})</button>
            {platforms.map(p => (
                <button type="button" key={p} className={'proc-plat-chip' + (platFilter === p ? ' on' : '')} onClick={() => setPlatFilter(p)}>
                    {p} ({confirmed.filter(s => s.platform === p).length})
                </button>
            ))}
        </div>
    ) : null;

    // มีกลุ่มสินค้า → แบ่งเป็นกลุ่ม
    if (groups.length > 0) {
        const groupKeys = new Set(groups.map(g => g.key));
        const ungrouped = view.filter(s => !s.group_key || !groupKeys.has(s.group_key));
        const visibleGroups = groups.filter(g => view.some(s => s.group_key === g.key));
        return (
            <div>
                {filterBar}
                {clipBar}
                <div className="proc-tbl-scroll">
                    <div className={tblCls}>
                        {visibleGroups.map((g) => {
                            const gi = groups.indexOf(g);
                            const gs = view.filter(s => s.group_key === g.key);
                            return (
                                <div className="proc-group" key={g.key || gi}>
                                    <GroupBar group={g} gi={gi} count={gs.length} />
                                    {procHead(showAds)}{rowsFor(gs)}
                                </div>
                            );
                        })}
                        {ungrouped.length > 0 && (
                            <div className="proc-group">
                                <div className="grp-bar"><span className="grp-no muted-bar">ไม่ระบุกลุ่ม</span><span className="grp-count">{ungrouped.length} คน</span></div>
                                {procHead(showAds)}{rowsFor(ungrouped)}
                            </div>
                        )}
                        {view.length === 0 && <div className="proc-group-empty" style={{ padding: '16px 4px' }}>ไม่มี KOL ในแพลตฟอร์มนี้</div>}
                    </div>
                </div>
            </div>
        );
    }

    // ไม่มีกลุ่ม → ตารางเดียว
    return (
        <div>
            {filterBar}
                {clipBar}
            <div className="proc-tbl-scroll">
                <div className={tblCls}>
                    {procHead(showAds)}
                    {rowsFor(view)}
                    {view.length === 0 && <div className="proc-group-empty" style={{ padding: '16px 4px' }}>ไม่มี KOL ในแพลตฟอร์มนี้</div>}
                </div>
            </div>
        </div>
    );
}
