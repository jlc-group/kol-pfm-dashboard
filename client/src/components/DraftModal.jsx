import { useState } from 'react';
import Icon from './Icon.jsx';
// ตรรกะแปลงข้อมูลดราฟอยู่ในไฟล์ .js แยก เพื่อให้เทสต์ import ได้ (ไฟล์ .jsx มี JSX เทสต์อ่านไม่ได้)
import { MAX_DRAFTS, buildDrafts, draftPayload, canRemoveDraft } from '../data/drafts.js';

export { MAX_DRAFTS, buildDrafts, draftPayload };

/**
 * โมดัลอัปเดตดราฟงาน (View Draft) — ใช้ร่วมทั้งหน้า Agency และ Dashboard หลัก
 * props:
 *   sub       = submission ที่จะแก้
 *   onSave    = async (payload) => {}  // ผู้เรียกเป็นคนยิง API เอง (agency / team ต่างกัน)
 *   onClose   = () => {}
 *   canRemark = ฝั่งเอเจนซี่ (เขียน Remark ได้) · ทีมเห็นแต่แก้ไม่ได้
 *   canDecide = ตัดสินผลตรวจได้ (Revise / Approve) — เฉพาะทีม · เอเจนซี่เห็นผลแต่กดไม่ได้
 */
export default function DraftModal({ sub, onSave, onClose, canRemark = false, canDecide = true }) {
    const [drafts, setDrafts] = useState(() => buildDrafts(sub));
    const [draftStatus, setDraftStatus] = useState(sub.draft_status || (sub.approved ? 'approve' : ''));
    // เพิ่งกดเพิ่มดราฟในครั้งนี้ — คนที่ตัดสินไม่ได้ก็ยังต้องล้างผลตรวจรอบก่อนออกได้
    const [resetReview, setResetReview] = useState(false);
    const [saving, setSaving] = useState(false);

    const setDraft = (i, key, val) => setDrafts(ds => ds.map((d, idx) => idx === i ? { ...d, [key]: val } : d));
    // เพิ่มดราฟใหม่ = เริ่มตรวจรอบใหม่ ต้องล้างผลตรวจรอบก่อนออกด้วย
    // ไม่งั้นดราฟ 2 จะขึ้นปุ่ม Revise ค้างมาจากรอบที่แล้ว เหมือนตรวจไปแล้วทั้งที่ยังไม่ได้ดู
    const addDraft = () => {
        if (drafts.length >= MAX_DRAFTS) return;
        setDrafts(ds => [...ds, { link: '', fb: '', rm: '' }]);
        setDraftStatus('');
        setResetReview(true);
    };
    // กันซ้ำในตัวฟังก์ชันด้วย ไม่ได้พึ่งแค่การซ่อนปุ่ม (ดู canRemoveDraft)
    const removeDraft = i => setDrafts(ds => (canRemoveDraft(ds, i, canRemark) ? ds.filter((_, idx) => idx !== i) : ds));

    async function save() {
        setSaving(true);
        try {
            const ok = await onSave(draftPayload(drafts, draftStatus, { canRemark, canDecide, resetReview }));
            if (ok !== false) onClose();
        } catch (err) { alert(err.message); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="draft-head">
                    <div className="draft-name">
                        {/* กดชื่อเพื่อเปิดหน้า Account ของ KOL (ถ้ามีลิงก์ช่อง) */}
                        {sub.link_account
                            ? <a className="draft-name-link" href={sub.link_account} target="_blank" rel="noreferrer"
                                title={`เปิดหน้า Account: ${sub.link_account}`}>{sub.account_name}<Icon name="eye" size={13} /></a>
                            : sub.account_name}
                        <span className="muted"> · {sub.platform || '—'}</span>
                    </div>
                </div>

                {/* ดราฟ 1 - 5 (วนลูป) */}
                {drafts.map((d, i) => (
                    <div className="draft-block" key={i}>
                        <div className="draft-block-title">
                            ดราฟ {i + 1}
                            {i > 0 && (canRemoveDraft(drafts, i, canRemark)
                                ? <button type="button" className="draft-block-rm" title={`ลบดราฟ ${i + 1}`} onClick={() => removeDraft(i)}>× ลบ</button>
                                // ทีมลบดราฟที่ตั้งแต่ตัวมันลงไปมี Remark ของเอเจนซี่ไม่ได้ — Remark จะไปติดผิดดราฟ
                                : <span className="draft-block-lock" title="ดราฟนี้ (หรือดราฟถัดไป) มี Remark จากเอเจนซี่ — ลบแล้ว Remark จะไปติดผิดดราฟ ถ้าต้องลบให้เอเจนซี่ลบจากฝั่งของเขา">🔒 ลบไม่ได้</span>)}
                        </div>
                        <div className="field">
                            <label>ลิงค์งาน (ดราฟ){i > 0 ? ` ${i + 1}` : ''}</label>
                            <div className="draft-link-line">
                                <input type="url" value={d.link} onChange={e => setDraft(i, 'link', e.target.value)} placeholder="https://... ลิงก์ดราฟงาน" />
                                {d.link && <a className="draft-link-open" href={d.link} target="_blank" rel="noreferrer" title="เปิดลิงก์"><Icon name="eye" size={15} /></a>}
                            </div>
                        </div>
                        {/* Remark ของเอเจนซี่ — ต่อจากช่องลิงก์ทันที เพราะเป็นของที่เอเจนซี่กรอกคู่กับลิงก์ตอนส่งดราฟ
                            คนละช่องกับ Feedback ที่ทีมเขียนบอกจุดแก้ (อยู่ล่างสุด ต่อจากผลตรวจ)
                            เอเจนซี่กรอกได้ทุกดราฟ · ทีมเห็นเฉพาะดราฟที่เอเจนซี่เขียนไว้ และแก้ไม่ได้ (server ก็ไม่รับจากเส้นของทีม) */}
                        {(canRemark || d.rm) && (
                            <div className="field draft-remark">
                                <label>REMARK{i > 0 ? ` (ดราฟ ${i + 1})` : ''} <span className="draft-remark-who">{canRemark ? '— เพิ่มเติมจากดราฟนี้ (ถ้ามี)' : '— จากเอเจนซี่'}</span></label>
                                {canRemark
                                    ? <textarea rows="2" value={d.rm} maxLength={2000} onChange={e => setDraft(i, 'rm', e.target.value)}
                                        placeholder="เช่น เพลงติดลิขสิทธิ์เลยเปลี่ยนให้ / ถ่ายใหม่เพราะแสงไม่พอ" />
                                    : <div className="draft-remark-read">{d.rm}</div>}
                            </div>
                        )}
                        {/* ผลตรวจของทีม (เฉพาะดราฟล่าสุด): ทีมเลือก Revise (แก้ไข+Feedback) หรือ Approve (ผ่านเลย)
                            เอเจนซี่ไม่ได้กดเอง เห็นเป็นป้ายบอกผลอย่างเดียว */}
                        {i === drafts.length - 1 && !canDecide && draftStatus && (
                            <div className="draft-decide">
                                <span className="draft-decide-lbl">ผลตรวจจากทีม →</span>
                                <span className={'draft-status-read ' + draftStatus}>
                                    {draftStatus === 'approve' ? '✓ Approve (ผ่านแล้ว)' : '↻ Revise (ขอแก้ไข)'}
                                </span>
                            </div>
                        )}
                        {i === drafts.length - 1 && canDecide && (
                            <div className="draft-decide">
                                <span className="draft-decide-lbl">ดูลิงก์ดราฟแล้ว →</span>
                                <button type="button" className={'draft-status-btn revise' + (draftStatus === 'revise' ? ' on' : '')} onClick={() => setDraftStatus(s => s === 'revise' ? '' : 'revise')}>↻ Revise (ขอแก้ไข)</button>
                                <button type="button" className={'draft-status-btn approve' + (draftStatus === 'approve' ? ' on' : '')} onClick={() => setDraftStatus(s => s === 'approve' ? '' : 'approve')}>✓ Approve (ผ่านเลย)</button>
                            </div>
                        )}
                        {/* ช่อง Feedback ขึ้นเฉพาะตอนกด Revise (ดราฟล่าสุด) หรือดราฟเก่าที่มี Feedback อยู่แล้ว (ประวัติ) */}
                        {((i === drafts.length - 1 && draftStatus === 'revise') || (i !== drafts.length - 1 && d.fb)) && (
                            <div className="field">
                                <label>FEEDBACK{i > 0 ? ` (ดราฟ ${i + 1})` : ''}{i === drafts.length - 1 && <span className="draft-fb-req"> — ระบุจุดที่ต้องแก้</span>}</label>
                                <textarea rows="3" value={d.fb} onChange={e => setDraft(i, 'fb', e.target.value)} placeholder="คอมเมนต์ / จุดที่ต้องแก้ไข..." />
                            </div>
                        )}
                    </div>
                ))}
                {drafts.length < MAX_DRAFTS && (
                    <button type="button" className="draft-addlink" onClick={addDraft}>
                        <Icon name="plus" size={14} /> เพิ่มดราฟ {drafts.length + 1}
                    </button>
                )}
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ปิด</button>
                    {/* ยังไม่ได้เลือก Revise/Approve = เขียวอ่อน
                        เลือกแล้ว = เขียวเข้ม เตือนว่ามีผลตรวจรออยู่ ต้องกดบันทึกก่อนปิด */}
                    <button type="button" className={'btn-primary' + (draftStatus ? ' btn-save-strong' : '')}
                        onClick={save} disabled={saving}
                        title={draftStatus ? 'มีผลตรวจที่ยังไม่ได้บันทึก' : undefined}>
                        {draftStatus ? '💾 ' : ''}{saving ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                </div>
            </div>
        </div>
    );
}
