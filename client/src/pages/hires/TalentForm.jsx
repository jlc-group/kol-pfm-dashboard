import { useEffect, useId, useRef, useState } from 'react';
import { api, uploadFile } from '../../api/client.js';
import SideDrawer from '../../components/SideDrawer.jsx';
import KindPicker from '../../components/KindPicker.jsx';
import { kindError, kindValue } from '../../data/hireKinds.js';

// ฟอร์มเพิ่ม / แก้คนใน Talent Book เอง — ไม่ต้องมีงาน (ผู้ใช้สั่ง 29 ก.ย. 2026)
// talentId = null → เพิ่มใหม่ (POST /hires/talents) · มีค่า → แก้ (GET แล้ว PUT) และลบได้
// ทุกคนในทีมเห็นการ์ดนี้ (ไม่ผูกแบรนด์) · แก้/ลบได้เฉพาะคนที่เพิ่ม และ admin (server ตัดสิน)
// ไฟล์รูป / คลิปอัปหลังบันทึกข้อมูลแล้ว (ต้องมี id ก่อน) — อัปพลาด: ข้อมูลเก็บแล้ว ฟอร์มค้างอยู่ให้กดบันทึกซ้ำเพื่อลองอัปใหม่
// หน่วยเรทต้องตรงกับ RATE_UNITS ใน server/src/routes/hires.js
export const RATE_UNITS = ['ต่อวัน', 'ต่องาน', 'ต่อชั่วโมง', 'ต่อโพสต์', 'ต่อคลิป'];
// ช่องทางติดต่อ — ติ๊กเลือกก่อน แล้วช่องที่ต้องกรอกเปลี่ยนตามแบบ (ผู้ใช้สั่ง 30 ก.ย. 2026) · ค่าต้องตรงกับ CONTACT_MODES ใน server
//   ติดต่อเอง = ชื่อผู้ติดต่อ + เบอร์/LINE · ผ่าน Agency = ชื่อเอเจนซี่ + ชื่อผู้ติดต่อของเอเจนซี่ (ไม่มีช่องเบอร์/LINE)
export const CONTACT_MODES = [['self', 'ติดต่อเอง'], ['agency', 'ผ่าน Agency']];
const EMPTY = { name: '', kind: '', link: '', contact_mode: '', contact_name: '', contact: '', agency: '', rate: '', rate_unit: RATE_UNITS[0], scope: '', image_link: '', clip_link: '', note: '' };
const MAX = { name: 200, link: 1000, contact_name: 200, contact: 200, agency: 200, scope: 2000, image_link: 1000, clip_link: 1000, note: 1000 };
// แถวที่บันทึกก่อนมีตัวเลือกนี้ (contact_mode ว่าง) — เดาจากข้อมูลที่มี: มีสังกัด = ผ่านเอเจนซี่ · มีเบอร์/ชื่อ = ติดต่อเอง
// มีทั้งเบอร์และสังกัด (ฟอร์มรุ่นเก่า) = ไม่เดา ปล่อยให้คนเลือกเอง — เดาแล้วช่องที่ถูกซ่อนจะหายตอนกดบันทึกโดยไม่รู้ตัว
const modeOf = t => (t.contact_mode === 'self' || t.contact_mode === 'agency') ? t.contact_mode
    : (t.agency && t.contact) ? ''
    : t.agency ? 'agency' : (t.contact || t.contact_name) ? 'self' : '';
const FILES = {
    image: { exts: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'], mb: 10, accept: '.png,.jpg,.jpeg,.webp,.pdf', word: 'รูป/คอมการ์ด' },
    clip: { exts: ['.mp4', '.mov', '.m4v', '.webm'], mb: 95, accept: '.mp4,.mov,.m4v,.webm,video/*', word: 'คลิปผลงาน' }
};
const isWeb = v => /^https?:\/\/\S+$/i.test(v);
const extOf = name => { const m = /\.[^.]+$/.exec(String(name || '').toLowerCase()); return m ? m[0] : ''; };
const rateNum = v => Number(String(v).replace(/,/g, '').trim());
const RATE_MAX = 1e9;   // เพดานเดียวกับ server
const S = v => (v == null ? '' : String(v));
const fileErr = (file, field) => {
    if (!file) return '';
    const spec = FILES[field];
    if (!spec.exts.includes(extOf(file.name))) return `รองรับเฉพาะ ${spec.exts.join(' / ').toUpperCase().replace(/\./g, '')}`;
    if (file.size > spec.mb * 1024 * 1024) return `ไฟล์ใหญ่เกิน ${spec.mb}MB`;
    return '';
};

function Field({ label, req, hint, err, htmlFor, labelId, children }) {
    return (
        <div className={'qf-field' + (err ? ' has-err' : '')}>
            {htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</label>
                : <div className="qf-label" id={labelId}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</div>}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}

export default function TalentForm({ talentId = null, onClose, onSaved }) {
    const uid = useId();
    const id = s => `${uid}-${s}`;
    // เพิ่มสำเร็จแล้วแต่อัปไฟล์ไม่ผ่าน → ฟอร์มกลายเป็นโหมดแก้ไขของแถวนั้น (กดบันทึกซ้ำจะไม่สร้างคนซ้ำ)
    const [rowId, setRowId] = useState(talentId);
    const [f, setF] = useState(EMPTY);
    const [orig, setOrig] = useState(null);
    const [loading, setLoading] = useState(!!talentId);
    const [loadErr, setLoadErr] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [clipFile, setClipFile] = useState(null);
    const [dropImage, setDropImage] = useState(false);
    const [dropClip, setDropClip] = useState(false);
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const clean = useRef(JSON.stringify(EMPTY));
    const wrapRef = useRef(null);
    // บันทึกข้อมูลไปแล้วอย่างน้อยครั้งหนึ่ง (แม้ไฟล์ยังอัปไม่ขึ้น) — ปิดฟอร์มแล้วหน้าแม่ต้องโหลดการ์ดใหม่
    const savedAny = useRef(false);
    // ข้อความ error อยู่บนสุดของฟอร์ม — เลื่อนขึ้นไปให้เห็น (กดบันทึกจากท้ายฟอร์ม ข้อความจะพ้นจอ)
    const toTop = () => {
        const s = wrapRef.current && wrapRef.current.closest('.side-drawer-body');
        if (s) s.scrollTo({ top: 0, behavior: 'smooth' });
    };

    useEffect(() => {
        if (!talentId) return undefined;
        let on = true;
        api(`/hires/talents/${encodeURIComponent(talentId)}`)
            .then(res => {
                if (!on) return;
                const t = res.data || {};
                const next = {
                    name: S(t.name), kind: S(t.kind), link: S(t.link),
                    contact_mode: modeOf(t), contact_name: S(t.contact_name), contact: S(t.contact), agency: S(t.agency),
                    rate: t.rate == null ? '' : String(t.rate), rate_unit: t.rate_unit || RATE_UNITS[0], scope: S(t.scope),
                    image_link: S(t.image_link), clip_link: S(t.clip_link), note: S(t.note)
                };
                setF(next); setOrig(t); clean.current = JSON.stringify(next);
            })
            .catch(e => { if (on) setLoadErr(e.message || 'โหลดข้อมูลไม่สำเร็จ'); })
            .finally(() => { if (on) setLoading(false); });
        return () => { on = false; };
    }, [talentId]);

    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const editing = rowId != null;

    function fieldErrors() {
        const e = {};
        if (!f.name.trim()) e.name = 'ใส่ชื่อก่อนนะ';
        const ke = kindError(f.kind);
        if (ke) e.kind = ke;
        if (f.image_link.trim() && !isWeb(f.image_link.trim())) e.image = 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://';
        if (f.clip_link.trim() && !isWeb(f.clip_link.trim())) e.clip = 'ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://';
        if (f.rate.trim()) {
            const n = rateNum(f.rate);
            // ต้องมีตัวเลขจริง (พิมพ์แค่ "," จะกลายเป็น 0 เงียบ ๆ)
            if (!/\d/.test(f.rate) || !Number.isFinite(n) || n < 0) e.rate = 'ใส่เป็นตัวเลข เช่น 5000';
            else if (n > RATE_MAX) e.rate = 'สูงเกินไป (ไม่เกิน 1,000,000,000 บาท)';
        }
        const ie = fileErr(imageFile, 'image');
        if (ie) e.image = ie;
        const ce = fileErr(clipFile, 'clip');
        if (ce) e.clip = ce;
        return e;
    }
    const errs = fieldErrors();
    // ยังไม่เลือกช่องทางติดต่อ: คนใหม่ = บอกให้เลือก · แถวเก่าที่มีข้อมูลอยู่แล้ว = โชว์ของเดิมให้เห็น (ช่องยังซ่อนอยู่จนกว่าจะเลือก)
    const legacy = [f.agency.trim() && `สังกัด ${f.agency.trim()}`, f.contact.trim() && `เบอร์/LINE ${f.contact.trim()}`,
        f.contact_name.trim() && `ผู้ติดต่อ ${f.contact_name.trim()}`].filter(Boolean);
    const modeHint = f.contact_mode ? ''
        : legacy.length ? `ข้อมูลเดิม: ${legacy.join(' · ')} — เลือกแบบด้านบนเพื่อแก้ (ไม่เลือกก็เก็บไว้ตามเดิม)`
        : 'เลือกก่อนว่าติดต่อคนนี้เอง หรือติดต่อผ่านเอเจนซี่ แล้วจะมีช่องให้กรอก';
    const E = tried ? errs : {};
    const dirty = JSON.stringify(f) !== clean.current || !!imageFile || !!clipFile || dropImage || dropClip;

    function requestClose() {
        if (saving) return;
        // ข้อมูลบันทึกแล้วแต่ไฟล์ยังค้าง = บอกตรง ๆ ว่าอะไรยังไม่ขึ้น (ไม่ใช่ "ยังไม่ได้บันทึก")
        const fileOnly = savedAny.current && JSON.stringify(f) === clean.current;
        if (dirty && !window.confirm(fileOnly ? 'ข้อมูลบันทึกแล้ว แต่ไฟล์ยังไม่ขึ้น — ปิดฟอร์มเลยไหม?' : 'ยังไม่ได้บันทึก — ปิดฟอร์มนี้เลยไหม?')) return;
        onClose(savedAny.current);
    }

    async function save() {
        setTried(true);
        if (Object.keys(errs).length) {
            setErr('');
            // เลื่อนไปช่องแรกที่ยังไม่ครบ
            setTimeout(() => {
                const el = wrapRef.current && wrapRef.current.querySelector('.qf-field.has-err');
                if (el) {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const input = el.querySelector('.kind-other') || el.querySelector('input:not([type=file]), textarea, select, button');
                    if (input) input.focus({ preventScroll: true });
                }
            }, 0);
            return;
        }
        setSaving(true); setErr('');
        const hasRate = f.rate.trim() !== '';
        // ส่งเฉพาะช่องของแบบที่เลือก — สลับแบบไปมาแล้ว ของที่พิมพ์ในแบบเดิมยังอยู่ในฟอร์ม แต่ไม่ถูกบันทึก
        // ยังไม่เลือก = ส่งค่าเดิมกลับไปตามที่โหลดมา (คนใหม่ = ว่างอยู่แล้ว · แถวเก่าที่มีทั้งเบอร์และสังกัด = ไม่หาย)
        const mode = f.contact_mode;
        const body = {
            name: f.name.trim(), kind: kindValue(f.kind), link: f.link.trim(),
            contact_mode: mode, contact_name: f.contact_name.trim(),
            contact: mode === 'agency' ? '' : f.contact.trim(), agency: mode === 'self' ? '' : f.agency.trim(),
            rate: hasRate ? rateNum(f.rate) : null, rate_unit: hasRate ? f.rate_unit : null, scope: f.scope.trim(),
            image_link: f.image_link.trim(), clip_link: f.clip_link.trim(), note: f.note.trim()
        };
        try {
            const res = editing
                ? await api(`/hires/talents/${encodeURIComponent(rowId)}`, { method: 'PUT', body })
                : await api('/hires/talents', { method: 'POST', body });
            const saved = res.data || {};
            const tid = saved.id;
            setRowId(tid);
            savedAny.current = true;
            clean.current = JSON.stringify(f);
            const fails = [];
            const fileStep = async (field, file, drop, clearFile, clearDrop) => {
                const url = `/hires/talents/${encodeURIComponent(tid)}/${field}`;
                try {
                    // อัปไฟล์ใหม่ = แทนที่ไฟล์เดิมอยู่แล้ว → ล้างทั้งไฟล์ที่เลือกและคำสั่ง "เอาไฟล์เดิมออก"
                    // (ไม่ล้าง drop: กดบันทึกซ้ำตอนอีกไฟล์พลาด จะไปลบไฟล์ใหม่ที่เพิ่งอัปทิ้ง)
                    if (file) { await uploadFile(url, file); clearFile(null); clearDrop(false); }
                    else if (drop) { await api(url, { method: 'DELETE' }); clearDrop(false); }
                } catch (e) { fails.push(`${FILES[field].word}: ${e.message || 'ไม่สำเร็จ'}`); }
            };
            await fileStep('image', imageFile, dropImage, setImageFile, setDropImage);
            await fileStep('clip', clipFile, dropClip, setClipFile, setDropClip);
            if (fails.length) {
                setErr(`บันทึกข้อมูลแล้ว แต่ไฟล์ยังไม่ขึ้น — ${fails.join(' · ')} · กดบันทึกอีกครั้งเพื่อลองใหม่`);
                toTop();
                return;
            }
            onSaved && onSaved(saved, { created: !talentId });
        } catch (e) {
            setErr(e.message || 'บันทึกไม่สำเร็จ');
            toTop();
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!editing) return;
        const who = f.name.trim() || 'คนนี้';
        if (!window.confirm(`ลบ "${who}" ออกจาก Talent Book?\nการ์ดที่มาจากงาน (ถ้ามี) ยังอยู่ตามงานเดิม`)) return;
        setSaving(true); setErr('');
        try {
            await api(`/hires/talents/${encodeURIComponent(rowId)}`, { method: 'DELETE' });
            onSaved && onSaved(null);
        } catch (e) {
            setErr(e.message || 'ลบไม่สำเร็จ');
            toTop();
        } finally {
            setSaving(false);
        }
    }

    // ช่องไฟล์: ไฟล์เดิม (เอาออกได้) / ไฟล์ใหม่ที่เลือก / ปุ่มเลือกไฟล์ + ช่องวางลิงก์แทนได้
    const fileField = (field, current, file, setFile, drop, setDrop, linkKey) => {
        const spec = FILES[field];
        const hasOld = !!(current && !drop && !file);
        return (
            <>
                <div className="tf-file">
                    {file ? (
                        <span className="tf-file-name">📎 {file.name}
                            <button type="button" className="tf-file-x" onClick={() => setFile(null)} title="ไม่ใช้ไฟล์นี้">×</button>
                        </span>
                    ) : hasOld ? (
                        <span className="tf-file-name">📎 {current.original || 'ไฟล์เดิม'}
                            <button type="button" className="tf-file-x" onClick={() => setDrop(true)} title={`เอา${spec.word}ออก`}>×</button>
                        </span>
                    ) : drop ? (
                        <span className="tf-file-name muted">จะเอาไฟล์เดิมออกตอนบันทึก
                            <button type="button" className="tf-file-x" onClick={() => setDrop(false)} title="เก็บไฟล์เดิมไว้">↺</button>
                        </span>
                    ) : null}
                    <label className="btn-ghost tf-pick">
                        {file || hasOld ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
                        <input type="file" accept={spec.accept} hidden
                            onChange={e => { const x = e.target.files && e.target.files[0]; if (x) setFile(x); e.target.value = ''; }} />
                    </label>
                    <span className="tf-file-hint">{spec.exts.join(' ').toUpperCase().replace(/\./g, '')} · ไม่เกิน {spec.mb}MB</span>
                </div>
                <input className="tf-link" type="url" value={f[linkKey]} maxLength={MAX[linkKey]} aria-label={`ลิงก์${spec.word}`}
                    onChange={e => up(linkKey, e.target.value)} placeholder="หรือวางลิงก์ (Google Drive / IG / TikTok ...)" />
            </>
        );
    };

    const footer = (
        <>
            {editing && orig && orig.editable !== false && (
                <button type="button" className="btn-ghost tf-delete" onClick={remove} disabled={saving}>ลบออกจาก Talent Book</button>
            )}
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={saving}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving || loading || !!loadErr}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
        </>
    );

    return (
        <SideDrawer title={editing ? 'แก้ข้อมูลใน Talent Book' : 'เพิ่มคนเข้า Talent Book'}
            subtitle="ทุกคนในทีมเห็นการ์ดนี้ · ถ้าคนนี้ถูกจ้างในงาน (ชื่อ + ประเภทงานตรงกัน) จะรวมเป็นการ์ดเดียวกัน"
            onClose={requestClose} footer={footer} width={600} busy={saving} className="qf-drawer tf-drawer">
            <div className="qf" ref={wrapRef}>
                {loading ? <p className="muted">กำลังโหลด...</p> : loadErr ? <div className="alert-error">{loadErr}</div> : (
                    <>
                        {err && <div className="alert-error" role="alert">{err}</div>}
                        <Field label="ชื่อ" req err={E.name} htmlFor={id('name')}>
                            <input id={id('name')} value={f.name} maxLength={MAX.name} autoComplete="off"
                                onChange={e => up('name', e.target.value)} placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" autoFocus={!talentId} />
                        </Field>
                        <Field label="ประเภทงาน" req err={E.kind} labelId={id('kind')}>
                            <KindPicker value={f.kind} onChange={v => up('kind', v)} labelId={id('kind')} invalid={!!E.kind} />
                        </Field>
                        <Field label="Account / Social" htmlFor={id('link')}>
                            <input id={id('link')} value={f.link} maxLength={MAX.link} autoComplete="off"
                                onChange={e => up('link', e.target.value)} placeholder="IG / TikTok / Facebook (https://...)" />
                        </Field>
                        <Field label="ช่องทางติดต่อ" labelId={id('mode')} hint={modeHint}>
                            <div className="qf-chips" role="radiogroup" aria-labelledby={id('mode')}>
                                {CONTACT_MODES.map(([v, label]) => (
                                    <button type="button" key={v} role="radio" aria-checked={f.contact_mode === v}
                                        className={'qf-chip' + (f.contact_mode === v ? ' on' : '')} onClick={() => up('contact_mode', v)}>{label}</button>
                                ))}
                            </div>
                        </Field>
                        {f.contact_mode === 'self' && (
                            <div className="qf-row2">
                                <Field label="ชื่อผู้ติดต่อ" htmlFor={id('cname')}>
                                    <input id={id('cname')} value={f.contact_name} maxLength={MAX.contact_name} autoComplete="off"
                                        onChange={e => up('contact_name', e.target.value)} placeholder="เช่น ตัวเอง / ผู้จัดการส่วนตัว" />
                                </Field>
                                <Field label="เบอร์ / LINE" htmlFor={id('contact')}>
                                    <input id={id('contact')} value={f.contact} maxLength={MAX.contact} autoComplete="off"
                                        onChange={e => up('contact', e.target.value)} placeholder="เบอร์โทร หรือ LINE ID" />
                                </Field>
                            </div>
                        )}
                        {f.contact_mode === 'agency' && (
                            <div className="qf-row2">
                                <Field label="ชื่อเอเจนซี่" htmlFor={id('agency')}>
                                    <input id={id('agency')} value={f.agency} maxLength={MAX.agency} autoComplete="off"
                                        onChange={e => up('agency', e.target.value)} placeholder="ชื่อเอเจนซี่ / สังกัด" />
                                </Field>
                                <Field label="ชื่อผู้ติดต่อ (ของเอเจนซี่)" htmlFor={id('cname')}>
                                    <input id={id('cname')} value={f.contact_name} maxLength={MAX.contact_name} autoComplete="off"
                                        onChange={e => up('contact_name', e.target.value)} placeholder="คนที่เราคุยด้วยที่เอเจนซี่" />
                                </Field>
                            </div>
                        )}
                        <Field label="เรทราคา (บาท)" err={E.rate} htmlFor={id('rate')} hint="ยังไม่รู้ก็เว้นไว้ได้">
                            <div className="tf-rate">
                                <input id={id('rate')} inputMode="decimal" value={f.rate} autoComplete="off"
                                    onChange={e => up('rate', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="เช่น 5000" />
                                <select value={f.rate_unit} onChange={e => up('rate_unit', e.target.value)} aria-label="หน่วยเรท">
                                    {RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                            </div>
                        </Field>
                        <Field label="Scope of work" htmlFor={id('scope')} hint="งานที่รวมอยู่ในเรทนี้ — ยังไม่รู้ก็เว้นไว้ได้">
                            <textarea id={id('scope')} rows={3} value={f.scope} maxLength={MAX.scope}
                                onChange={e => up('scope', e.target.value)} placeholder="เช่น ถ่ายภาพนิ่ง 1 วัน + คลิปสั้น 2 ชิ้น · ใช้สิทธิ์ภาพ 3 เดือน" />
                        </Field>
                        <Field label="รูป / คอมการ์ด" err={E.image} labelId={id('image')}>
                            {fileField('image', orig && orig.image, imageFile, setImageFile, dropImage, setDropImage, 'image_link')}
                        </Field>
                        <Field label="คลิปผลงาน" err={E.clip} labelId={id('clip')}>
                            {fileField('clip', orig && orig.clip, clipFile, setClipFile, dropClip, setDropClip, 'clip_link')}
                        </Field>
                        <Field label="หมายเหตุ" htmlFor={id('note')}>
                            <textarea id={id('note')} rows={3} value={f.note} maxLength={MAX.note}
                                onChange={e => up('note', e.target.value)} placeholder="เช่น ถนัดงานสกินแคร์ · ว่างเฉพาะเสาร์-อาทิตย์" />
                        </Field>
                    </>
                )}
            </div>
        </SideDrawer>
    );
}
