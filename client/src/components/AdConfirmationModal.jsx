import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasAdSpend } from '../data/adEvidence.js';
import { fmtDate } from '../utils/date.js';

export default function AdConfirmationModal({ row, status, date, onSave, onClose }) {
    const [confirmed, setConfirmed] = useState(status === 'ยิงแล้ว');
    const [startDate, setStartDate] = useState(date || '');
    const [saving, setSaving] = useState(false);
    const ref = useRef(null);
    const paid = hasAdSpend(row);
    useEffect(() => {
        const previous = document.activeElement;
        ref.current?.focus();
        return () => previous?.focus();
    }, []);
    function onKeyDown(e) {
        if (e.key === 'Escape' && !saving) onClose();
        if (e.key !== 'Tab') return;
        const items = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    async function submit(e) {
        e.preventDefault(); setSaving(true);
        const ok = await onSave({ ad_status: confirmed ? 'ยิงแล้ว' : 'ยังไม่ยิง',
            ad_end: confirmed || paid ? startDate || null : null });
        setSaving(false);
        if (ok) onClose();
    }
    return <div className="modal-backdrop" onClick={() => !saving && onClose()}>
        <form className="modal ads-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ad-confirm-title"
            tabIndex={-1} ref={ref} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()} onSubmit={submit}>
            <h2 id="ad-confirm-title">การยืนยันของทีม · {row.account_name}</h2>
            <p className="ads-explainer">บันทึกว่าเริ่มยิงแล้วเมื่อใด ช่องนี้ไม่ได้เปิดหรือหยุดแอดในแพลตฟอร์ม</p>
            <div className="field">
                <label htmlFor="ad-confirm-status">การยืนยันของทีม</label>
                <select id="ad-confirm-status" value={confirmed ? 'yes' : 'no'} disabled={saving} onChange={e => setConfirmed(e.target.value === 'yes')}>
                    <option value="no">ทีมยังไม่ได้ยืนยันว่าเริ่มยิงแล้ว</option>
                    <option value="yes">ทีมยืนยันว่าเริ่มยิงแล้ว</option>
                </select>
            </div>
            {(confirmed || paid) && <div className="field">
                <label htmlFor="ad-confirm-date">วันเริ่มยิงจริง</label>
                <input id="ad-confirm-date" type="date" value={startDate} required={confirmed} disabled={saving} onChange={e => setStartDate(e.target.value)} />
                <small className="ads-evidence-detail">เลือกวันที่เริ่มยิงจริง ระบบจะไม่ลงวันที่วันนี้ให้เอง</small>
            </div>}
            {paid && <p className="ads-explainer">โพสต์นี้มีค่าแอดแล้ว แม้ยกเลิกการยืนยันของทีม ป้าย “มีค่าแอดแล้ว” จะยังอยู่ เพราะค่าแอดสะสมเป็นหลักฐานว่าเคยยิง</p>}
            {startDate && row.post_date && startDate < row.post_date && <div className="ads-date-warning" role="status">
                วันเริ่มยิง {fmtDate(startDate)} อยู่ก่อนวันลงโพสต์ {fmtDate(row.post_date)} ตรวจวันที่จริงทั้งสองวันก่อนบันทึก
                <Link to={`/projects/${row.project_id}?tab=process`}>ตรวจวันลงโพสต์ในแคมเปญ</Link>
            </div>}
            <div className="modal-actions">
                <button type="button" className="btn-ghost" disabled={saving} onClick={onClose}>ยกเลิก</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกการยืนยัน'}</button>
            </div>
        </form>
    </div>;
}
