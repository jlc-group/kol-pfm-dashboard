import { useState, useEffect, useRef } from 'react';
import { workStage, STAGES } from '../data/workStage.js';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import DraftModal from './DraftModal.jsx';
import PerfModal from './PerfModal.jsx';
import { asTargetArray } from '../data/products.js';
import { mediaFor, contentTypesOf, quotaOf, targetFor, conceptText, conceptOneLine, groupNoGencode, postNoGencode } from '../data/adGroups.js';
import { ProductSummary } from './ProductChips.jsx';
import ProductFilter from './ProductFilter.jsx';
import { knownProductCodes, matchProducts, productFilterOptions } from '../data/productFilter.js';
import { draftIsNew, markDraftSeen } from '../utils/tabUpdates.js';

// ค่าที่เก็บเป็นสตริงคั่นด้วย , (เช่น content_format) → แยกเป็นรายตัว
const splitCsv = v => (v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);

const EXPIRE_OPTS = [30, 45, 60, 90, 120];
// แพลตฟอร์มที่ไม่ใช้ ID Post → ช่องขึ้น "-" อัตโนมัติ (กรอกไม่ได้)
const NO_IDPOST = ['Facebook', 'Lemon8', 'YouTube', 'X'];

// แถวตาราง On Process — อัปเดตงานของ KOL ที่ถูกคัดเลือกแล้ว
// putSubmission(subId, payload) = ผู้เรียกเป็นคนยิง API (agency ใช้ token / ทีมใช้ /projects)
// ช่องข้อมูลโพสต์ที่ทีมตรวจ — ชื่อที่โชว์ในป้าย "แก้หลังยืนยัน"
const POST_CHECK_LABEL = { post_url: 'ลิงก์โพสต์', post_date: 'วันที่โพสต์', gencode: 'Gencode', id_post: 'ID Post', code_expire: 'Code Expire' };
// แถบสถานะขึ้นเมื่อ: รอทีมตรวจ / ทีมส่งกลับให้แก้ / เอเจนซี่แก้หลังยิงแอด (ยังอยู่หน้า Ads)
const postCheckShown = s => s.post_check === 'pending' || s.post_check === 'returned' || s.post_check === 'changed';
const postCheckTeamTodo = s => s.post_check === 'pending' || s.post_check === 'changed';

// onPostCheck(subId, action, note) = ฝั่งทีมเท่านั้น (ยืนยัน / ส่งกลับให้แก้) · ฝั่งเอเจนซี่ไม่ส่งมา = เห็นแค่สถานะ
function ProcessRow({ sub, putSubmission, reload, showAds = false, group = null, scope = '', directEdit = false, seq = 1, onPostCheck, canRemark = false, canDecide = true }) {
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
    // ข้อมูลโหลดใหม่เป็นระยะ — ช่องที่ผู้ใช้ยังไม่ได้พิมพ์ทับ ต้องเปลี่ยนตามค่าล่าสุด
    // (ไม่งั้นทีมเห็นค่าเก่าแล้วกดยืนยันค่าใหม่ที่เอเจนซี่เพิ่งแก้ โดยไม่เคยเห็น)
    const serverVals = useRef({ post_url: sub.post_url || '', post_date: sub.post_date || '', gencode: sub.gencode || '', id_post: sub.id_post || '', code_expire: Number(sub.code_expire) || 60 });
    const [showDraft, setShowDraft] = useState(false);
    const [showPerf, setShowPerf] = useState(false);
    const perfFetchUrl = directEdit ? `/agency/${scope}/submissions/${sub.id}/fetch-tiktok` : `/projects/${scope}/submissions/${sub.id}/fetch-tiktok`;
    const hasPerf = (Number(sub.views) || 0) > 0;
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [editing, setEditing] = useState(false); // false = ล็อก (อ่านอย่างเดียว), true = กำลังแก้ไข
    useEffect(() => {
        const prev = serverVals.current;
        const next = { post_url: sub.post_url || '', post_date: sub.post_date || '', gencode: sub.gencode || '', id_post: sub.id_post || '', code_expire: Number(sub.code_expire) || 60 };
        serverVals.current = next;
        if (editing) return;   // ทีมกำลังแก้อยู่ ไม่ทับ (กดยกเลิกแล้วจะได้ค่าล่าสุด)
        if (postUrl === prev.post_url) setPostUrl(next.post_url);
        if (postDate === prev.post_date) setPostDate(next.post_date);
        if (gencode === prev.gencode) setGencode(next.gencode);
        if (idPost === prev.id_post) setIdPost(next.id_post);
        if (Number(codeExpire) === prev.code_expire) setCodeExpire(next.code_expire);
    }, [sub.post_url, sub.post_date, sub.gencode, sub.id_post, sub.code_expire]);
    // ตรวจข้อมูลโพสต์ที่เอเจนซี่ส่งมา (ฝั่งทีม)
    const [returning, setReturning] = useState(false);
    const [returnNote, setReturnNote] = useState('');
    const [checking, setChecking] = useState(false);
    async function decide(action) {
        if (action === 'return' && !returnNote.trim()) return;
        setChecking(true);
        try {
            // ส่ง post_check_at ที่เห็นไปด้วย — เอเจนซี่แก้แทรกระหว่างนี้ server จะตอบ 409 ให้โหลดใหม่
            await onPostCheck(sub.id, action, action === 'return' ? returnNote.trim() : null, sub.post_check_at);
            setReturning(false); setReturnNote('');
        } catch (err) { alert(err.message); }
        finally { setChecking(false); }
    }
    const checkChanges = sub.post_check_changes && typeof sub.post_check_changes === 'object'
        ? Object.entries(sub.post_check_changes).filter(([f]) => POST_CHECK_LABEL[f]) : [];
    const unlocked = directEdit || editing; // directEdit (ฝั่งเอเจนซี่) = กรอกได้เลยไม่ต้องกดแก้ไข
    const noIdPost = NO_IDPOST.includes(sub.platform); // แพลตฟอร์มนี้ไม่ใช้ ID Post
    // กลุ่มนี้ตั้ง "-" (ไม่ใช้ Gencode) และแถวนี้ไม่มี Gencode → ช่อง GENCODE / CODE EXPIRE IN ขึ้น "—" แบบเดียวกับ NO_IDPOST
    // ตัดสินจาก sub.gencode ที่ server ส่งมา ไม่ใช่ค่าในช่องที่กำลังพิมพ์ — ช่องจะได้ไม่หายไปกลางคันตอนลบค่าออก
    // แถวที่มี Gencode อยู่แล้วกรอก/แก้ได้ตามเดิม · ตอนบันทึกส่งค่าเดิมกลับไป (ช่องที่ซ่อนแก้ไม่ได้) จึงไม่โดน 409 และ post-check ไม่ขึ้นรายการแก้
    const noGencode = postNoGencode(sub, group);
    // Content Type ผูกกับคน (1 Platform ในกลุ่มเดียวมีได้หลายอย่าง) — ของเก่าที่ยังไม่ระบุค่อยถอยไปใช้ของกลุ่ม
    const ctype = sub.content_type || (group ? (contentTypesOf(group, sub.platform)[0] || null) : null);
    const media = group ? mediaFor(group, sub.platform, ctype) : { media_type: null, content_format: null };
    // Target ตามสินค้าของคลิปนี้ (แคมเปญที่ตั้ง Target ต่อสินค้า) — ไม่รู้สินค้าก็ใช้ Target รวมของ Platform
    const tgt = group ? asTargetArray(targetFor(group, sub.platform, sub.product)) : [];
    // ยิงแอดไปแล้ว = ล็อก ลิงก์โพสต์ / Gencode / ID Post ห้ามแก้
    // เพราะเป็นข้อมูลที่แอดที่ยิงไปแล้วอ้างอิงอยู่ (ฝั่ง server ปฏิเสธซ้ำอีกชั้น)
    const adLocked = sub.ad_status === 'ยิงแล้ว';
    const canEditPost = unlocked && !adLocked;
    const lockTip = 'ยิงแอดไปแล้ว แก้ไม่ได้ — ถ้าต้องแก้จริง ให้กดสถานะกลับเป็น "ยังไม่ยิง" ที่หน้า ADS ก่อน';
    // ลิงก์ที่กดเปิดได้จริง — อ่านจากช่องกรอกสด ๆ จะได้เช็คได้ทันทีตั้งแต่ยังไม่กดบันทึก
    // รับเฉพาะ http/https: ค่านี้มาจากช่องกรอก ถ้าปล่อยผ่านจะเปิด javascript: ที่ฝังสคริปต์มาได้
    const openablePostUrl = (() => {
        const v = String(postUrl || '').trim();
        if (!v) return null;
        try {
            const u = new URL(v);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
        } catch { return null; }
    })();

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
                    {/* Target ตั้งต่อ Platform และมีเฉพาะ Platform ที่ใช้ยิงแอด */}
                    {tgt.length > 0
                        ? tgt.map(t => <span className="proc-ads-tgt" key={t} title={t}>🎯 {t}</span>)
                        : <span className="muted">—</span>}
                </div>
            )}
            <div className="proc-cell">
                {ctype
                    ? <span className="proc-ctype-chip">{ctype}</span>
                    : <span className="ctype-none">— ยังไม่ระบุ —</span>}
            </div>
            <div className="proc-cell">
                {media.media_type || media.content_format ? (
                    <>
                        {media.media_type && <span className="proc-ctype-chip media">{media.media_type}</span>}
                        {splitCsv(media.content_format).map(x => <span className="proc-ctype-chip fmt" key={x}>{x}</span>)}
                    </>
                ) : <span className="muted">—</span>}
            </div>
            <div className="proc-cell"><span className="proc-plat">{sub.platform || '—'}</span></div>
            <div className="proc-cell proc-draft-cell">
                <button type="button" className={'proc-viewdraft' + (showDraftNew ? ' has-new' : '')} onClick={openDraft}>
                    <Icon name="eye" size={14} /> View Draft
                </button>
                {/* ป้ายนี้เคยอยู่ในปุ่ม ทำให้ปุ่มกว้างเกินคอลัมน์แล้วล้นไปทับช่อง Post */}
                {showDraftNew && <span className="draft-new-pill" title="มีดราฟอัปเดตใหม่">ดราฟใหม่</span>}
                {sub.draft_status === 'approve' && <span className="draft-verdict approved" title="ทีมอนุมัติดราฟแล้ว">✓ Approved</span>}
                {sub.draft_status === 'revise' && <span className="draft-verdict revise" title="ทีมขอให้แก้ไขดราฟ">↻ ขอแก้ไข</span>}
                <button type="button" className={'proc-perf-btn' + (hasPerf ? ' has' : '')} onClick={() => setShowPerf(true)} title="กรอก/ดูผลงานคอนเทนต์ (Views/Engagement)">
                    📊 {hasPerf ? `${Number(sub.views).toLocaleString()} วิว` : 'Perf'}
                </button>
            </div>
            <div className="proc-cell" title={adLocked ? lockTip : undefined}>
                <input type="url" value={postUrl} onChange={e => setPostUrl(e.target.value)} placeholder="ลิงก์โพสต์" disabled={!canEditPost} />
                {/* กดดูคลิปได้แม้แถวถูกล็อก — ล็อกแค่ห้ามแก้ ไม่ได้ห้ามดู */}
                {openablePostUrl
                    ? <a className="proc-openpost" href={openablePostUrl} target="_blank" rel="noreferrer" title="เปิดลิงก์คลิปในแท็บใหม่"><Icon name="eye" size={14} /></a>
                    : <span className="proc-openpost off" title={postUrl.trim() ? 'ลิงก์ไม่ถูกต้อง — ต้องขึ้นต้นด้วย http:// หรือ https://' : 'ยังไม่มีลิงก์โพสต์'}><Icon name="eye" size={14} /></span>}
            </div>
            <div className="proc-cell"><DatePicker value={postDate} onChange={setPostDate} disabled={!unlocked} placeholder="เลือกวัน" /></div>
            <div className="proc-cell" title={adLocked && !noGencode ? lockTip : undefined}>{noGencode
                ? <span className="muted" title="กลุ่มนี้ไม่ใช้ Gencode">—</span>
                : <input value={gencode} onChange={e => setGencode(e.target.value)} placeholder="Gencode" disabled={!canEditPost} />}</div>
            <div className="proc-cell" title={adLocked && !noIdPost ? lockTip : undefined}>{noIdPost
                ? <span className="muted" title="แพลตฟอร์มนี้ไม่ใช้ ID Post">—</span>
                : <input value={idPost} onChange={e => setIdPost(e.target.value)} placeholder="ID Post" disabled={!canEditPost} />}</div>
            <div className="proc-cell">{noGencode
                ? <span className="muted" title="กลุ่มนี้ไม่ใช้ Gencode">—</span>
                : <select value={codeExpire} onChange={e => setCodeExpire(e.target.value)} disabled={!unlocked}>
                    {EXPIRE_OPTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>}</div>
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

            {/* ตรวจข้อมูลโพสต์: เอเจนซี่ส่งมา/แก้ = รอทีมตรวจก่อนขึ้นหน้า Ads · ทีมส่งกลับให้แก้พร้อมเหตุผลได้ */}
            {postCheckShown(sub) && (
                <div className={'proc-check ' + sub.post_check}>
                    <div className="proc-check-msg">
                        {sub.post_check === 'returned'
                            ? <b>{onPostCheck ? '↩ ส่งกลับให้เอเจนซี่แก้แล้ว' : '↩ ทีมให้แก้ข้อมูลโพสต์'}</b>
                            : sub.post_check === 'changed'
                                ? <b>{onPostCheck ? '✏ เอเจนซี่แก้ข้อมูลหลังยิงแอดแล้ว' : '✏ แก้ข้อมูลหลังยิงแอดแล้ว'}</b>
                                : <b>{onPostCheck ? '🕵 รอตรวจข้อมูลโพสต์ที่เอเจนซี่ส่งมา' : '🕵 รอทีมตรวจข้อมูลโพสต์'}</b>}
                        <span className="proc-check-sub">{sub.post_check === 'changed'
                            ? (onPostCheck ? ' — ยังอยู่หน้า Ads (แอดวิ่งอยู่) เช็คว่าค่าที่แก้ถูกต้อง' : ' — ทีมได้รับแจ้งแล้ว โพสต์ยังอยู่หน้า Ads ตามเดิม')
                            : ' — ยังไม่ขึ้นหน้า Ads จนกว่าทีมจะยืนยัน'}</span>
                        {sub.post_check_note && <div className="proc-check-note">เหตุผล: {sub.post_check_note}</div>}
                        {checkChanges.length > 0 && (
                            <div className="proc-check-changes">
                                <span>แก้หลังทีมยืนยัน:</span>
                                {checkChanges.map(([f, c]) => (
                                    <span className="proc-check-chg" key={f} title={`${c.from || '(ว่าง)'} → ${c.to || '(ว่าง)'}`}>
                                        <b>{POST_CHECK_LABEL[f]}</b> {c.from || '(ว่าง)'} → {c.to || '(ว่าง)'}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    {onPostCheck && (
                        returning ? (
                            <div className="proc-check-return">
                                <input value={returnNote} onChange={e => setReturnNote(e.target.value)} maxLength={500} autoFocus
                                    placeholder="บอกเอเจนซี่ว่าต้องแก้อะไร เช่น ID Post ไม่ตรงกับลิงก์" />
                                <button type="button" className="proc-check-btn warn" disabled={checking || !returnNote.trim()} onClick={() => decide('return')}>ส่งกลับ</button>
                                <button type="button" className="proc-check-btn" disabled={checking} onClick={() => { setReturning(false); setReturnNote(''); }}>ยกเลิก</button>
                            </div>
                        ) : (
                            <div className="proc-check-actions">
                                <button type="button" className="proc-check-btn ok" disabled={checking || editing || dirty} onClick={() => decide('ok')}
                                    title={editing || dirty ? 'บันทึกหรือยกเลิกการแก้ไขในแถวนี้ก่อน' : sub.post_check === 'changed' ? 'ค่าที่แก้ถูกต้อง — เอาป้ายออก' : 'ข้อมูลถูกต้อง — ขึ้นหน้า Ads'}>✓ ยืนยันถูกต้อง</button>
                                {/* ยิงแอดแล้ว: ไม่ส่งกลับ (จะดึงแถวออกจากหน้า Ads ทั้งที่แอดวิ่งอยู่) — ค่าผิดให้ทีมกดแก้ไขในแถวเอง */}
                                {sub.post_check !== 'returned' && sub.post_check !== 'changed' && (
                                    <button type="button" className="proc-check-btn" disabled={checking} onClick={() => setReturning(true)}>ส่งกลับให้แก้</button>
                                )}
                            </div>
                        )
                    )}
                </div>
            )}

            {showDraft && (
                <DraftModal
                    canRemark={canRemark}
                    canDecide={canDecide}
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
        <span>CONTENT TYPE</span><span>FORMAT / STYLE</span>
        <span>PLATFORM</span><span>CONTENT DRAFT</span>
        <span>POST</span><span>POST DATE</span><span>GENCODE</span>
        <span>ID POST</span><span>CODE EXPIRE IN</span><span className="ta-c">จัดการ</span>
    </div>
);

// แถบหัวกลุ่มสินค้า (กลุ่มที่ N + รหัสสินค้า + concept + จำนวน)
// scope = { products, platforms } ที่ผู้ดูเห็น (หน้าเอเจนซี่) — Concept แยกต่อสินค้าโชว์เฉพาะของขอบเขตนี้
function GroupBar({ group, gi, count, scope }) {
    const concept = conceptText(group, false, scope && scope.products, scope && scope.platforms);
    return (
        <div className="grp-bar">
            <span className="grp-no">กลุ่มที่ {gi + 1}</span>
            <div className="grp-chips">
                <ProductSummary value={group.products || []} max={4} />
            </div>
            {/* Concept แยกต่อสินค้า = "L3, L10 = ... · L4 = ..." · ไม่แยก = Concept ของกลุ่มเหมือนเดิม */}
            {concept && <span className="grp-concept" title={conceptText(group, true, scope && scope.products, scope && scope.platforms)}>📝 Concept: {concept}</span>}
            {/* กลุ่มที่ตั้ง "-" ในฟอร์มแคมเปญ — บอกไว้ที่หัวกลุ่มว่าช่อง Gencode ว่างได้ ไม่ใช่ลืมกรอก */}
            {groupNoGencode(group) && <span className="grp-concept" title="กลุ่มนี้ไม่ใช้ Gencode — แถวที่ไม่มี Gencode ไม่ต้องกรอก">ไม่ใช้ Gencode</span>}
            <span className="grp-count">{count} คน</span>
        </div>
    );
}

/**
 * ตาราง On Process — แสดง KOL ที่ถูกคัดเลือกแล้ว ให้ทีม/เอเจนซี่อัปเดตงาน + ดราฟ
 * props: subs, groups (ad_groups — ถ้ามีจะแบ่งเป็นกลุ่มสินค้า), putSubmission(subId, payload), reload()
 */
// conceptScope(group) → { products, platforms } = ขอบเขตที่ผู้ดูเห็น (หน้าเอเจนซี่ส่งมา · หน้าทีมไม่ส่ง = เห็นทั้งกลุ่ม)
// onPostCheck(subId, action, note, seenAt) = ฝั่งทีมยืนยัน/ส่งกลับข้อมูลโพสต์ (ฝั่งเอเจนซี่ไม่ส่ง = เห็นแค่สถานะ)
// initialCheckOnly = เปิดมาพร้อมตัวกรอง "รอตรวจ" (ลิงก์จากหน้า Ads)
// canRemark / canDecide ตัดสินจาก role ของบัญชี ไม่ใช่จากหน้าที่เปิด — ทีมที่เปิดลิงก์เอเจนซี่ยังตรวจดราฟได้ตามปกติ
export default function OnProcessTable({ subs = [], groups = [], showAds = false, scope = '', putSubmission, reload, directEdit = false, stage = 'all', onClearStage, conceptScope, onPostCheck, initialCheckOnly = false, canRemark = false, canDecide = true }) {
    const [platFilter, setPlatFilter] = useState('all');   // ตัวกรองตามแพลตฟอร์ม
    const [ctypeFilter, setCtypeFilter] = useState('all'); // ตัวกรองย่อยตาม Content Type
    const [clipFilter, setClipFilter] = useState('all');   // ตัวกรองตามคลิป (กลุ่มที่ 1 คนส่งหลายคลิป)
    const [groupFilter, setGroupFilter] = useState('all'); // ตัวกรองตามกลุ่มสินค้า ('__none' = คนที่ไม่อยู่กลุ่มไหน)
    const [prodFilter, setProdFilter] = useState([]);      // ตัวกรองตามสินค้า — เลือกได้หลายตัว ([] = ทุกสินค้า)
    const [checkOnly, setCheckOnly] = useState(!!initialCheckOnly);   // ดูเฉพาะแถวที่ข้อมูลโพสต์รอทีมตรวจ / ถูกส่งกลับ / แก้หลังยิงแอด
    // เรียงเก่า -> ใหม่ ให้ตรงกับแท็บรายชื่อและฝั่งลิงก์เอเจนซี่ (API ส่งมาแบบใหม่สุดขึ้นก่อน)
    const confirmed = subs.filter(s => s.status === 'confirmed')
        .slice().sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || '') || (a.id - b.id));
    if (confirmed.length === 0) {
        return <p className="empty" style={{ padding: '20px 0' }}>ยังไม่มี KOL ที่ถูกคัดเลือก — คัดเลือก KOL ก่อนจึงจะอัปเดตงานได้</p>;
    }
    // แพลตฟอร์มที่มีจริงในลิสต์ (ทำเป็นปุ่มกรอง)
    const platforms = [...new Set(confirmed.map(s => s.platform).filter(Boolean))];
    // สินค้าที่มีจริงในลิสต์ (1 แถว = 1 คลิป จึงกรองตามสินค้าของคลิปนั้นตรง ๆ)
    const knownCodes = knownProductCodes(groups, confirmed);
    // Content Type ของแพลตฟอร์มที่เลือกอยู่ (เช่น Facebook: Awareness / Engagement)
    const ctypesOfPlat = p => [...new Set(groups.flatMap(g => contentTypesOf(g, p)))];
    const quotaFor = (p, ct) => groups.reduce((n, g) => n + quotaOf(g, p, ct), 0);
    const subCtypes = platFilter === 'all' ? [] : ctypesOfPlat(platFilter);
    // ชื่อคลิปที่มีจริงในลิสต์ (กลุ่มที่ 1 คนส่ง 2 คลิปจะมีมากกว่า 1 ชื่อ)
    const clipNames = [...new Set(confirmed.map(s => s.clip_name).filter(Boolean))];
    // กลุ่มที่มีคนอยู่จริง + คนที่ตกกลุ่ม (group_key ว่าง หรือชี้ไปกลุ่มที่ถูกลบไปแล้ว)
    const groupKeySet = new Set(groups.map(g => g.key));
    const isUngrouped = s => !s.group_key || !groupKeySet.has(s.group_key);
    const groupsInUse = groups.filter(g => confirmed.some(s => s.group_key === g.key));
    const ungroupedCount = confirmed.filter(isUngrouped).length;
    const view = confirmed
        .filter(s => platFilter === 'all' || (s.platform || '') === platFilter)
        .filter(s => ctypeFilter === 'all' || (s.content_type || '') === ctypeFilter)
        .filter(s => clipFilter === 'all' || (s.clip_name || '') === clipFilter)
        .filter(s => groupFilter === 'all' || (groupFilter === '__none' ? isUngrouped(s) : s.group_key === groupFilter))
        .filter(s => matchProducts(s, prodFilter, knownCodes))
        .filter(s => !checkOnly || postCheckShown(s))
        .filter(s => stage === 'all' || workStage(s) === stage);   // ตัวกรองจากการ์ดสรุปด้านบน

    const groupMap = {};
    groups.forEach(g => { groupMap[g.key] = g; });
    const tblCls = 'proc-tbl' + (showAds ? ' with-ads' : '');
    const rowsFor = list => list.map((s, i) => (
        <ProcessRow key={s.id} sub={s} seq={i + 1} putSubmission={putSubmission} reload={reload} showAds={showAds} scope={scope} group={groupMap[s.group_key] || null} directEdit={directEdit} onPostCheck={onPostCheck} canRemark={canRemark} canDecide={canDecide} />
    ));

    // บอกให้ชัดว่าตารางถูกกรองอยู่ ไม่งั้นงงว่าทำไมรายชื่อหายไป
    const stageLabel = (STAGES.find(x => x.key === stage) || {}).label;
    const stageBar = stageLabel ? (
        <div className="proc-stagebar">
            <span>กำลังดูเฉพาะ <b>{stageLabel}</b> · {view.length} รายการ</span>
            {onClearStage && <button type="button" onClick={onClearStage}>× ดูทั้งหมด</button>}
        </div>
    ) : null;

    // แถบปุ่มกรองกลุ่มสินค้า — โชว์เมื่อแบ่งเกิน 1 กลุ่ม (นับ "ไม่ระบุกลุ่ม" เป็นหนึ่งกลุ่มด้วย)
    // วางไว้บนสุดเพราะกลุ่มเป็นการแบ่งระดับใหญ่กว่าแพลตฟอร์มและคลิป
    const groupBar = (groupsInUse.length + (ungroupedCount > 0 ? 1 : 0)) > 1 ? (
        <div className="proc-platfilter">
            <span className="proc-platfilter-lbl">กลุ่ม:</span>
            <button type="button" className={'proc-plat-chip' + (groupFilter === 'all' ? ' on' : '')}
                onClick={() => setGroupFilter('all')}>ทั้งหมด ({confirmed.length})</button>
            {groupsInUse.map(g => (
                <button type="button" key={g.key}
                    className={'proc-plat-chip' + (groupFilter === g.key ? ' on' : '')}
                    title={[(g.products || []).join(', '), conceptOneLine(g.concept)].filter(Boolean).join(' · ')}
                    onClick={() => setGroupFilter(g.key)}>
                    กลุ่มที่ {groups.indexOf(g) + 1}{g.concept ? ' · ' + conceptOneLine(g.concept) : ''} ({confirmed.filter(s => s.group_key === g.key).length})
                </button>
            ))}
            {ungroupedCount > 0 && (
                <button type="button" className={'proc-plat-chip' + (groupFilter === '__none' ? ' on' : '')}
                    title="KOL ที่ยังไม่ได้ถูกจัดเข้ากลุ่มไหน"
                    onClick={() => setGroupFilter('__none')}>ไม่ระบุกลุ่ม ({ungroupedCount})</button>
            )}
        </div>
    ) : null;

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

    // แถบปุ่มกรองแพลตฟอร์ม (โชว์เมื่อมีมากกว่า 1 แพลตฟอร์ม) + ตัวกรองสินค้า (โชว์เมื่อมีมากกว่า 1 สินค้า)
    const filterBar = (
        <>
            <ProductFilter options={productFilterOptions(confirmed, knownCodes)} value={prodFilter}
                onChange={setProdFilter} total={confirmed.length} unit="" />
            {/* แถวที่ข้อมูลโพสต์รอทีมตรวจ / ถูกส่งกลับ — โชว์เมื่อมี (หรือกำลังกรองค้างอยู่) */}
            {(confirmed.some(postCheckShown) || checkOnly) && (
                <div className="proc-platfilter">
                    <button type="button" aria-pressed={checkOnly}
                        className={'proc-plat-chip check-filter-chip' + (checkOnly ? ' on' : '')}
                        onClick={() => setCheckOnly(v => !v)}>
                        {checkOnly ? '✓ ' : ''}🕵 {onPostCheck
                            // ฝั่งทีม: ที่ต้องตรวจ (รอตรวจ + แก้หลังยิงแอด) · ที่ส่งกลับไปแล้ว (รอเอเจนซี่)
                            ? `รอตรวจ ${confirmed.filter(postCheckTeamTodo).length}` + (confirmed.some(s => s.post_check === 'returned') ? ` · ส่งกลับแล้ว ${confirmed.filter(s => s.post_check === 'returned').length}` : '')
                            : [['รอทีมตรวจ', 'pending'], ['ทีมให้แก้', 'returned'], ['แก้หลังยิงแอด', 'changed']]
                                .map(([label, st]) => [label, confirmed.filter(s => s.post_check === st).length])
                                .filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`).join(' · ')}
                    </button>
                </div>
            )}
            {platforms.length > 1 && (
                <div className="proc-platfilter">
                    <span className="proc-platfilter-lbl">แพลตฟอร์ม:</span>
                    <button type="button" className={'proc-plat-chip' + (platFilter === 'all' ? ' on' : '')}
                        onClick={() => { setPlatFilter('all'); setCtypeFilter('all'); }}>ทั้งหมด ({confirmed.length})</button>
                    {platforms.map(p => (
                        <button type="button" key={p} className={'proc-plat-chip' + (platFilter === p ? ' on' : '')}
                            onClick={() => { setPlatFilter(p); setCtypeFilter('all'); }}>
                            {p} ({confirmed.filter(s => s.platform === p).length}{quotaFor(p) ? '/' + quotaFor(p) : ''})
                        </button>
                    ))}
                </div>
            )}
            {/* แบ่งย่อยตาม Content Type ของแพลตฟอร์มนั้น */}
            {platFilter !== 'all' && subCtypes.length > 1 && (
                <div className="proc-platfilter proc-ctypefilter">
                    <span className="proc-platfilter-lbl">Content Type:</span>
                    <button type="button" className={'proc-plat-chip' + (ctypeFilter === 'all' ? ' on' : '')}
                        onClick={() => setCtypeFilter('all')}>
                        ทั้งหมด ({confirmed.filter(s => s.platform === platFilter).length}{quotaFor(platFilter) ? '/' + quotaFor(platFilter) : ''})
                    </button>
                    {subCtypes.map(ct => (
                        <button type="button" key={ct} className={'proc-plat-chip' + (ctypeFilter === ct ? ' on' : '')}
                            onClick={() => setCtypeFilter(ct)}>
                            {ct} ({confirmed.filter(s => s.platform === platFilter && s.content_type === ct).length}{quotaFor(platFilter, ct) ? '/' + quotaFor(platFilter, ct) : ''})
                        </button>
                    ))}
                </div>
            )}
        </>
    );

    // มีกลุ่มสินค้า → แบ่งเป็นกลุ่ม
    if (groups.length > 0) {
        const groupKeys = new Set(groups.map(g => g.key));
        const ungrouped = view.filter(s => !s.group_key || !groupKeys.has(s.group_key));
        const visibleGroups = groups.filter(g => view.some(s => s.group_key === g.key));
        return (
            <div>
                {stageBar}
                {groupBar}
                {filterBar}
                {clipBar}
                <div className="proc-tbl-scroll">
                    <div className={tblCls}>
                        {visibleGroups.map((g) => {
                            const gi = groups.indexOf(g);
                            const gs = view.filter(s => s.group_key === g.key);
                            return (
                                <div className="proc-group" key={g.key || gi}>
                                    <GroupBar group={g} gi={gi} count={gs.length} scope={conceptScope ? conceptScope(g) : null} />
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
                        {view.length === 0 && <div className="proc-group-empty" style={{ padding: '16px 4px' }}>ไม่มี KOL ตรงกับตัวกรอง</div>}
                    </div>
                </div>
            </div>
        );
    }

    // ไม่มีกลุ่ม → ตารางเดียว
    return (
        <div>
            {stageBar}
            {groupBar}
            {filterBar}
            {clipBar}
            <div className="proc-tbl-scroll">
                <div className={tblCls}>
                    {procHead(showAds)}
                    {rowsFor(view)}
                    {view.length === 0 && <div className="proc-group-empty" style={{ padding: '16px 4px' }}>ไม่มี KOL ตรงกับตัวกรอง</div>}
                </div>
            </div>
        </div>
    );
}
