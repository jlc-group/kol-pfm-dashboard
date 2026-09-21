import { useState } from 'react';
import { api } from '../api/client.js';
import DatePicker from './DatePicker.jsx';
import { HIRE_KINDS } from './OtherProjectForm.jsx';
import { T } from '../data/talentLabels.js';

// แก้รายละเอียดของใบขอให้หาหนึ่งใบ (จากปุ่มดินสอบนการ์ดของใบ ไม่ต้องเปิดฟอร์มทั้งงาน)
// แก้ได้เฉพาะสิ่งที่ "ขอ" — รายชื่อที่เสนอเข้ามาและคนที่เลือกไปแล้วมีเส้นของตัวเอง ที่นี่ไม่แตะ
export default function HireRequestEditModal({ request, onClose, onSaved }) {
    const [f, setF] = useState({
        kind: request.kind || '',
        headcount: String(Number(request.headcount) || 1),
        fee: request.fee == null ? '' : String(request.fee),
        use_date: request.use_date || '',
        deadline: request.deadline || '',
        place: request.place || '',
        spec: request.spec || '',
        scope: request.scope || '',
        note: request.note || ''
    });
    // ค่าเดิมของ Scope of Work ตอนเปิดกล่อง — ส่งไปเฉพาะเมื่อแก้จริง
    // (ข้อมูลใบที่มาจากที่อื่นอาจยังไม่มีช่องนี้ ถ้าส่งค่าว่างไปทุกครั้ง server จะล้างของเดิมทิ้งเงียบ ๆ)
    const [scope0] = useState(() => request.scope || '');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const filled = Number(request.filled) || 0;

    async function save() {
        if (!f.kind) { setErr('กรุณาเลือกประเภทงาน'); return; }
        if (!(Number(f.headcount) > 0)) { setErr('จำนวนคนที่ต้องการต้องมากกว่า 0'); return; }
        setSaving(true); setErr('');
        try {
            const res = await api(`/projects/${request.project_id}/hires/${request.key}`, {
                method: 'PUT',
                body: {
                    kind: f.kind, headcount: Number(f.headcount) || 1, fee: Number(f.fee) || 0,
                    use_date: f.use_date || null, deadline: f.deadline || null,
                    place: f.place, spec: f.spec, note: f.note,
                    ...(f.scope !== scope0 ? { scope: f.scope } : {})
                }
            });
            onSaved(res.data);
        } catch (e) { setErr(e.message); setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>แก้ไข{T.request}</h3>
                    <button type="button" className="modal-x" onClick={onClose}>×</button>
                </div>
                <p className="ctype-lead">{request.project_name}{request.brand ? ` · ${request.brand}` : ''}</p>

                {err && <div className="alert-error">{err}</div>}

                <div className="hire-grid">
                    <label className="hire-f">
                        <span>ประเภทงาน *</span>
                        <select value={f.kind} onChange={e => up('kind', e.target.value)}>
                            <option value="">— เลือก —</option>
                            {HIRE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                            {f.kind && !HIRE_KINDS.includes(f.kind) && <option value={f.kind}>{f.kind}</option>}
                        </select>
                    </label>
                    <label className="hire-f">
                        <span>จำนวนคนที่ต้องการ *</span>
                        <input inputMode="numeric" value={f.headcount}
                            onChange={e => up('headcount', e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" />
                        {filled > 0 && <span className="cast-sub">หาได้แล้ว {filled} คน — ลดต่ำกว่านี้ไม่ได้</span>}
                    </label>
                    <label className="hire-f">
                        <span>งบต่อคน (บาท) *</span>
                        <input inputMode="numeric" value={f.fee}
                            onChange={e => up('fee', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
                    </label>
                    <div className="hire-f">
                        <span>วันที่ต้องใช้งาน</span>
                        <DatePicker value={f.use_date} onChange={v => up('use_date', v)} />
                    </div>
                    <div className="hire-f">
                        <span>กำหนดส่งรายชื่อ</span>
                        <DatePicker value={f.deadline} onChange={v => up('deadline', v)} />
                    </div>
                    <label className="hire-f">
                        <span>สถานที่</span>
                        <input value={f.place} onChange={e => up('place', e.target.value)} placeholder="เช่น สตูดิโอ ลาดพร้าว" />
                    </label>
                    <label className="hire-f wide">
                        <span>สเปคที่ต้องการ</span>
                        <textarea rows="2" value={f.spec} onChange={e => up('spec', e.target.value)}
                            placeholder="เช่น หญิง 20-25 ปี สูง 165 ขึ้นไป เคยถ่ายงานสกินแคร์" />
                    </label>
                    <label className="hire-f wide">
                        <span>Scope of Work</span>
                        <textarea rows="3" value={f.scope} maxLength={2000} onChange={e => up('scope', e.target.value)}
                            placeholder="เช่น ถ่ายภาพนิ่ง 20 ลุค + วิดีโอสั้น 3 ตัว · ใช้งานออนไลน์ 6 เดือน" />
                    </label>
                    <label className="hire-f wide">
                        <span>{T.note}</span>
                        <input value={f.note} onChange={e => up('note', e.target.value)} placeholder="เงื่อนไข ข้อตกลง หรือสิ่งที่ต้องจำ" />
                    </label>
                </div>

                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                    <button type="button" className="btn-primary" disabled={saving} onClick={save}>
                        {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                    </button>
                </div>
            </div>
        </div>
    );
}
