import { useState } from 'react';
import Icon from './Icon.jsx';

export const MAX_DRAFTS = 5;
// ชื่อฟิลด์ของแต่ละดราฟ: ดราฟ 1 = draft_link/feedback, ดราฟ 2-5 = draft_linkN/feedbackN
const draftSuffix = i => (i === 0 ? '' : String(i + 1));

// สร้าง array ของดราฟจากข้อมูล submission (อย่างน้อย 1 ดราฟ)
export function buildDrafts(sub) {
    const out = [{ link: sub.draft_link || '', fb: sub.feedback || '' }];
    for (let i = 1; i < MAX_DRAFTS; i++) {
        const link = sub['draft_link' + (i + 1)] || '';
        const fb = sub['feedback' + (i + 1)] || '';
        if (link || fb) out.push({ link, fb });
    }
    return out;
}

// แปลง drafts array + สถานะ เป็น payload ฟิลด์แบน (draft_link/feedback/draft_status/approved)
export function draftPayload(drafts, status) {
    const payload = { draft_status: status || null, approved: status === 'approve' };
    for (let i = 0; i < MAX_DRAFTS; i++) {
        payload['draft_link' + draftSuffix(i)] = drafts[i]?.link || null;
        payload['feedback' + draftSuffix(i)] = drafts[i]?.fb || null;
    }
    return payload;
}

/**
 * โมดัลอัปเดตดราฟงาน (View Draft) — ใช้ร่วมทั้งหน้า Agency และ Dashboard หลัก
 * props:
 *   sub      = submission ที่จะแก้
 *   onSave   = async (payload) => {}  // ผู้เรียกเป็นคนยิง API เอง (agency / team ต่างกัน)
 *   onClose  = () => {}
 */
export default function DraftModal({ sub, onSave, onClose }) {
    const [drafts, setDrafts] = useState(() => buildDrafts(sub));
    const [draftStatus, setDraftStatus] = useState(sub.draft_status || (sub.approved ? 'approve' : ''));
    const [saving, setSaving] = useState(false);

    const setDraft = (i, key, val) => setDrafts(ds => ds.map((d, idx) => idx === i ? { ...d, [key]: val } : d));
    // เพิ่มดราฟใหม่ = เริ่มตรวจรอบใหม่ ต้องล้างผลตรวจรอบก่อนออกด้วย
    // ไม่งั้นดราฟ 2 จะขึ้นปุ่ม Revise ค้างมาจากรอบที่แล้ว เหมือนตรวจไปแล้วทั้งที่ยังไม่ได้ดู
    const addDraft = () => {
        if (drafts.length >= MAX_DRAFTS) return;
        setDrafts(ds => [...ds, { link: '', fb: '' }]);
        setDraftStatus('');
    };
    const removeDraft = i => setDrafts(ds => ds.length > 1 ? ds.filter((_, idx) => idx !== i) : ds);

    async function save() {
        setSaving(true);
        try {
            const ok = await onSave(draftPayload(drafts, draftStatus));
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
                            {i > 0 && <button type="button" className="draft-block-rm" title={`ลบดราฟ ${i + 1}`} onClick={() => removeDraft(i)}>× ลบ</button>}
                        </div>
                        <div className="field">
                            <label>ลิงค์งาน (ดราฟ){i > 0 ? ` ${i + 1}` : ''}</label>
                            <div className="draft-link-line">
                                <input type="url" value={d.link} onChange={e => setDraft(i, 'link', e.target.value)} placeholder="https://... ลิงก์ดราฟงาน" />
                                {d.link && <a className="draft-link-open" href={d.link} target="_blank" rel="noreferrer" title="เปิดลิงก์"><Icon name="eye" size={15} /></a>}
                            </div>
                        </div>
                        {/* ปุ่มตรวจดราฟ — อยู่ใต้ช่องลิงก์ (เฉพาะดราฟล่าสุด): ดูลิงก์แล้วเลือก Revise (แก้ไข+Feedback) หรือ Approve (ผ่านเลย) */}
                        {i === drafts.length - 1 && (
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
                    {/* ปุ่มบันทึกสีเข้ม เพื่อเตือนว่าต้องกดบันทึกก่อนปิดทุกครั้ง */}
                    <button type="button" className="btn-primary btn-save-strong" onClick={save} disabled={saving}>
                        💾 {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                </div>
            </div>
        </div>
    );
}
