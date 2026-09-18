import { useState } from 'react';
import HireRequestCard from './HireRequestCard.jsx';
import { T } from '../data/talentLabels.js';

// กล่องเปิดใบขอให้หา — เนื้อในเป็นการ์ดใบเดียวกับที่ฝังอยู่ในหน้ารายละเอียดงาน
// ใช้กับคนช่วยหาที่ไม่มีสิทธิ์แบรนด์ของงานนั้น (เปิดหน้างานไม่ได้)
export default function HireRequestModal({ request, canDecide = false, canPropose = false, onClose, onSaved }) {
    const [dirty, setDirty] = useState(false);

    function close() {
        if (dirty && onSaved) onSaved();
        onClose();
    }

    return (
        <div className="modal-backdrop" onClick={close}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{T.request}{request.kind ? ` · ${request.kind}` : ''}</h3>
                    <button type="button" className="modal-x" onClick={close}>×</button>
                </div>
                <p className="ctype-lead">
                    {request.project_name}{request.brand ? ` · ${request.brand}` : ''} — {T.finder}ส่งชื่อได้หลายคน ทีมแบรนด์เป็นคนเลือก
                </p>

                <HireRequestCard request={request} canDecide={canDecide} canPropose={canPropose}
                    heading={false} onChanged={() => setDirty(true)}
                    onDeleted={() => { if (onSaved) onSaved(); onClose(); }} />

                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={close}>ปิด</button>
                </div>
            </div>
        </div>
    );
}
