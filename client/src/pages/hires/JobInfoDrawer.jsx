import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import SideDrawer from '../../components/SideDrawer.jsx';
import { T } from '../../data/talentLabels.js';

// ลิ้นชัก "แก้ข้อมูลงาน" — ชื่องาน / รายละเอียดงาน / ผู้ดูแลงาน เท่านั้น (ไม่แตะรายการจ้าง)
// PUT /projects/:id ส่งเฉพาะช่องที่แก้ ไม่มี hire_items จึงไม่ต้องส่ง expected_updated_at และไม่ชนกับคนช่วยหาที่กำลังส่งชื่อเข้าใบ
// ผู้ดูแลงานเก็บเป็น "ชื่อ" ในช่อง creator (แบบเดียวกับฟอร์มเต็มและฟอร์มสั้น) — งานเก่าบางงานเก็บไว้ที่ owner จึงอ่านสองช่อง
// ผู้ดูแลงานเป็นช่องบังคับ — งานเก่าที่ยังไม่มีต้องเลือกก่อนถึงจะบันทึกได้ และล้างให้ว่างไม่ได้ (server ตีกลับด้วยข้อความเดียวกัน)
const S = v => (v == null ? '' : String(v));
const OWNER_MSG = 'เลือกผู้ดูแลงาน';

export default function JobInfoDrawer({ project, onClose, onSaved }) {
    const uid = useId();
    const id = s => `${uid}-${s}`;
    const [start] = useState(() => ({
        name: S(project.name),
        objective: S(project.objective),
        creator: S(project.creator) || S(project.owner)
    }));
    const [f, setF] = useState(start);
    const [people, setPeople] = useState([]);
    const [peopleErr, setPeopleErr] = useState('');
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const nameRef = useRef(null);
    const ownerRef = useRef(null);

    useEffect(() => {
        let alive = true;
        api('/users/options')
            .then(res => { if (alive) { setPeople(Array.isArray(res && res.data) ? res.data : []); setPeopleErr(''); } })
            .catch(e => { if (alive) { setPeople([]); setPeopleErr((e && e.message) || 'โหลดรายชื่อไม่สำเร็จ'); } });
        return () => { alive = false; };
    }, []);

    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const changed = Object.keys(start).filter(k => S(f[k]).trim() !== S(start[k]).trim());
    const dirty = changed.length > 0;
    const nameErr = tried && !f.name.trim() ? 'ใส่ชื่องาน' : '';
    const ownerErr = tried && !S(f.creator).trim() ? OWNER_MSG : '';
    const ownerNames = [...new Set(people.map(u => u && u.name).filter(Boolean))];

    async function save() {
        if (saving) return;
        setTried(true);
        setError('');
        if (!f.name.trim()) { if (nameRef.current) nameRef.current.focus(); return; }
        // เช็คก่อน "ไม่ได้แก้อะไร" — งานเก่าที่ไม่มีผู้ดูแลงาน กดบันทึกเฉย ๆ ต้องถูกชี้ให้เลือก ไม่ใช่ปิดไปเงียบ ๆ
        if (!S(f.creator).trim()) { if (ownerRef.current) ownerRef.current.focus(); return; }
        if (!dirty) { onClose && onClose(); return; }
        const body = {};
        changed.forEach(k => { body[k] = k === 'name' ? f.name.trim() : (S(f[k]).trim() || null); });
        setSaving(true);
        try {
            await api(`/projects/${project.id}`, { method: 'PUT', body });
            setSaving(false);
            onSaved && onSaved(body);
        } catch (e) {
            setSaving(false);
            setError(e.message || 'บันทึกไม่สำเร็จ');
        }
    }

    function requestClose() {
        if (saving) return;
        if (dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดเลยไหม? ที่แก้ไว้จะหาย')) return;
        onClose && onClose();
    }

    const footer = (
        <>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={saving}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </>
    );

    return (
        <SideDrawer title="แก้ข้อมูลงาน" subtitle={[project.name, project.brand].filter(Boolean).join(' · ')}
            onClose={requestClose} footer={footer} width={560} busy={saving} className="qf-drawer tj-info-drawer">
            <div className="qf">
                {error && <div className="alert-error" role="alert">{error}</div>}
                <section className="qf-sec">
                    <div className={'qf-field' + (nameErr ? ' has-err' : '')}>
                        <label className="qf-label" htmlFor={id('name')}>ชื่องาน<span className="qf-req" aria-hidden="true"> *</span></label>
                        <input id={id('name')} ref={nameRef} value={f.name} maxLength={255} onChange={e => up('name', e.target.value)}
                            placeholder="เช่น ถ่าย Lookbook คอลเลกชันใหม่" />
                        {nameErr && <div className="qf-err" role="alert">{nameErr}</div>}
                    </div>
                    <div className="qf-field">
                        <label className="qf-label" htmlFor={id('obj')}>รายละเอียดงาน</label>
                        <textarea id={id('obj')} rows="5" value={f.objective} onChange={e => up('objective', e.target.value)}
                            placeholder="งานนี้ทำอะไร ใช้ที่ไหน มีเงื่อนไขอะไรที่ทีมควรรู้" />
                    </div>
                    <div className={'qf-field' + (ownerErr ? ' has-err' : '')}>
                        <label className="qf-label" htmlFor={id('owner')}>{T.owner}<span className="qf-req" aria-hidden="true"> *</span></label>
                        <select id={id('owner')} ref={ownerRef} value={f.creator} onChange={e => up('creator', e.target.value)}
                            aria-invalid={ownerErr ? 'true' : undefined}>
                            {/* ตัวเลือกว่างมีไว้เฉพาะตอนยังไม่มีชื่อ (งานเก่า) — เลือกแล้วย้อนกลับไปว่างไม่ได้ */}
                            {!S(f.creator).trim() && <option value="">— เลือก{T.owner} —</option>}
                            {ownerNames.map(n => <option key={n} value={n}>{n}</option>)}
                            {/* ชื่อเดิมที่ไม่อยู่ในรายชื่อแล้ว (ปิดบัญชีไป / พิมพ์เองจากฟอร์มเก่า) ต้องยังเลือกค้างไว้ได้ */}
                            {f.creator && !ownerNames.includes(f.creator) && <option value={f.creator}>{f.creator}</option>}
                        </select>
                        {ownerErr && <div className="qf-err" role="alert">{ownerErr}</div>}
                        <div className="qf-hint">
                            {peopleErr
                                ? `โหลดรายชื่อไม่สำเร็จ (${peopleErr}) — ปิดแล้วเปิดใหม่อีกครั้ง`
                                : 'คนที่ทีมถามเรื่องงานนี้ได้ — ขึ้นในการ์ดงานและหน้างาน'}
                        </div>
                    </div>
                </section>
            </div>
        </SideDrawer>
    );
}
