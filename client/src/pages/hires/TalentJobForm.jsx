import { useId, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import DatePicker from '../../components/DatePicker.jsx';
import { JOB_EMPTY, JOB_MAX, jobBody, jobErrors, jobForm } from '../../data/talentJobs.js';

// ฟอร์มเพิ่ม / แก้ "งานที่จ้าง" หนึ่งงาน — อยู่ในหน้ารายละเอียดของคน (TalentDetail) ไม่เปิดกล่องซ้อน
// job = null → เพิ่ม (POST /hires/talents/:id/jobs) · มีค่า → แก้ (PUT /hires/talents/:id/jobs/:jobId)
// brands = แบรนด์ที่คนนี้เลือกได้ (แบรนด์ที่ตัวเองเห็น — server ตรวจซ้ำ) · งานเดิมที่แบรนด์อยู่นอกรายการยังเลือกค้างไว้ได้
export default function TalentJobForm({ talentId, job = null, brands = [], defaultBrand = '', onCancel, onSaved }) {
    const uid = useId();
    const id = s => `${uid}-${s}`;
    const [f, setF] = useState(() => (job ? jobForm(job) : { ...JOB_EMPTY, brand: defaultBrand }));
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const clean = useRef(JSON.stringify(f));
    const wrap = useRef(null);
    const options = job && job.brand && !brands.includes(job.brand) ? [...brands, job.brand] : brands;
    const errs = jobErrors(f, options);
    const E = tried ? errs : {};
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const dirty = JSON.stringify(f) !== clean.current;

    function cancel() {
        if (saving) return;
        if (dirty && !window.confirm('ยังไม่ได้บันทึกงานนี้ — ทิ้งที่กรอกไว้เลยไหม?')) return;
        onCancel && onCancel();
    }

    async function save() {
        if (saving) return;
        setTried(true);
        if (Object.keys(errs).length) {
            setErr('');
            setTimeout(() => {
                const el = wrap.current && wrap.current.querySelector('.qf-field.has-err');
                if (el) {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const input = el.querySelector('input, textarea, select, button');
                    if (input) input.focus({ preventScroll: true });
                }
            }, 0);
            return;
        }
        setSaving(true); setErr('');
        const base = `/hires/talents/${encodeURIComponent(talentId)}/jobs`;
        try {
            const res = job
                ? await api(`${base}/${encodeURIComponent(job.id)}`, { method: 'PUT', body: jobBody(f) })
                : await api(base, { method: 'POST', body: jobBody(f) });
            clean.current = JSON.stringify(f);
            setSaving(false);
            onSaved && onSaved(res && res.data, { created: !job });
        } catch (e) {
            setSaving(false);
            setErr(e.message || 'บันทึกงานไม่สำเร็จ');
        }
    }

    const field = (key, label, req, control, hint) => (
        <div className={'qf-field' + (E[key] ? ' has-err' : '')}>
            <label className="qf-label" htmlFor={id(key)}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</label>
            {control}
            {E[key] && <div className="qf-err" role="alert">{E[key]}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );

    return (
        <div className="qf tbj-form" ref={wrap} role="group" aria-label={job ? 'แก้งานที่จ้าง' : 'เพิ่มงานที่จ้าง'}>
            <div className="tbj-form-head">{job ? 'แก้งานที่จ้าง' : 'เพิ่มงานที่จ้าง'}</div>
            {err && <div className="alert-error" role="alert">{err}</div>}
            <div className="qf-row2">
                {field('brand', 'แบรนด์', true, options.length ? (
                    <select id={id('brand')} value={f.brand} onChange={e => up('brand', e.target.value)} aria-invalid={E.brand ? 'true' : undefined}>
                        <option value="">— เลือกแบรนด์ —</option>
                        {options.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                ) : <p className="muted" id={id('brand')}>บัญชีนี้ยังไม่ได้รับสิทธิ์แบรนด์ไหน — ติดต่อผู้ดูแลระบบ</p>)}
                <div className={'qf-field' + (E.hired_on ? ' has-err' : '')}>
                    <div className="qf-label" id={id('date')}>วันที่จ้าง<span className="qf-req" aria-hidden="true"> *</span></div>
                    <div role="group" aria-labelledby={id('date')} className="tbj-date">
                        <DatePicker value={f.hired_on} onChange={v => up('hired_on', v)} placeholder="เลือกวันที่จ้าง" />
                    </div>
                    {E.hired_on && <div className="qf-err" role="alert">{E.hired_on}</div>}
                    <div className="qf-hint">การ์ดโชว์เป็นเดือน/ปี</div>
                </div>
            </div>
            {field('fee', 'ค่าตัวที่จ่ายจริง (บาท)', false, (
                <input id={id('fee')} inputMode="decimal" value={f.fee} autoComplete="off" placeholder="เช่น 15000"
                    onChange={e => up('fee', e.target.value.replace(/[^0-9.,]/g, ''))} />
            ), 'ยังไม่รู้ / ได้ฟรี เว้นไว้ได้')}
            {field('scope', 'Scope of work', false, (
                <textarea id={id('scope')} rows={2} value={f.scope} maxLength={JOB_MAX.scope}
                    onChange={e => up('scope', e.target.value)} placeholder="เช่น ถ่ายภาพนิ่ง 1 วัน + คลิปสั้น 2 ชิ้น" />
            ))}
            {field('work_link', 'ลิงก์งาน / โพสต์', false, (
                <input id={id('work_link')} type="url" value={f.work_link} maxLength={JOB_MAX.work_link} autoComplete="off"
                    onChange={e => up('work_link', e.target.value)} placeholder="https://..." />
            ))}
            {field('note', 'หมายเหตุ', false, (
                <textarea id={id('note')} rows={2} value={f.note} maxLength={JOB_MAX.note}
                    onChange={e => up('note', e.target.value)} placeholder="เช่น ส่งงานตรงเวลา · ต่อราคาได้" />
            ))}
            <div className="tbj-form-actions">
                <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>ยกเลิก</button>
                <button type="button" className="btn-primary" onClick={save} disabled={saving || !options.length}>
                    {saving ? 'กำลังบันทึก...' : job ? 'บันทึกงาน' : 'เพิ่มงาน'}
                </button>
            </div>
        </div>
    );
}
