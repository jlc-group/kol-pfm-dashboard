import { useEffect, useState } from 'react';
import { api, uploadFile } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import FilePreviewModal from './FilePreviewModal.jsx';
import HireRequestEditModal from './HireRequestEditModal.jsx';

// การ์ด "ใบขอจัดหา" หนึ่งใบ พร้อมรายชื่อที่เสนอเข้ามาทั้งหมด
// ใช้ 2 ที่ด้วยหน้าตาเดียวกัน: ฝังตรง ๆ ในหน้ารายละเอียดงานจ้าง และอยู่ในกล่องของหน้างานจัดหา
// งานของใบนี้มีสองฝั่ง — คนจัดหาเสนอชื่อได้หลายคน คนขอเป็นคนกดเลือก/ไม่เอา
// ทุกปุ่มยิงเส้นที่แก้ทีละแถวในฐาน (ไม่ใช่ PUT ทั้งแคมเปญ) สองฝั่งจึงทำงานพร้อมกันได้โดยไม่ทับกัน
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtD = d => {
    if (!d) return '—';
    const [y, m, dd] = String(d).split('-');
    return `${Number(dd)}/${Number(m)}/${String(y).slice(2)}`;
};
const CAND_NEW = 'เสนอ';
const CAND_PICKED = 'เลือกแล้ว';
const CAND_DROPPED = 'ไม่เอา';
const candsOf = r => (Array.isArray(r && r.candidates) ? r.candidates : []);
const leftOf = r => Math.max(0, (Number(r && r.headcount) || 1) - (Number(r && r.filled) || 0));
const EMPTY = { name: '', fee: '', contact: '', agency: '', link: '', note: '', image_link: '', video_link: '' };
const S = v => (v == null ? '' : String(v));

// ช่องกรอกของ "ชื่อที่เสนอ" — ใช้ชุดเดียวกันทั้งตอนเสนอใหม่และตอนกดแก้ไข จะได้ไม่มีช่องที่มีแค่ฝั่งเดียว
function CandFields({ form, setForm, feeHint, img, setImg, vid, setVid, current, clearImg, setClearImg, clearVid, setClearVid }) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const curImg = current && current.image && !clearImg ? current.image : null;
    const curVid = current && current.video && !clearVid ? current.video : null;
    return (
        <div className="hire-grid">
            <label className="hire-f">
                <span>ชื่อคนที่เสนอ *</span>
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
            </label>
            <label className="hire-f">
                <span>ค่าตัวที่คุยไว้ (บาท)</span>
                <input inputMode="numeric" value={form.fee}
                    onChange={e => set('fee', e.target.value.replace(/[^0-9]/g, ''))} placeholder={String(feeHint || 0)} />
            </label>
            <label className="hire-f">
                <span>ช่องทางติดต่อ</span>
                <input value={form.contact} onChange={e => set('contact', e.target.value)} placeholder="เบอร์ / LINE / IG" />
            </label>
            <label className="hire-f">
                <span>สังกัด / เอเจนซี่</span>
                <input value={form.agency} onChange={e => set('agency', e.target.value)} placeholder="ไม่มีก็เว้นไว้" />
            </label>
            <label className="hire-f wide">
                <span>ลิงก์ Account / Social Media</span>
                <input type="url" value={form.link} onChange={e => set('link', e.target.value)} placeholder="IG / TikTok / Facebook (https://...)" />
            </label>

            {/* คอมการ์ด: อัปไฟล์ก็ได้ วางลิงก์ก็ได้ (บางเอเจนซี่ส่งมาเป็นลิงก์ Drive/Canva) */}
            <div className="hire-f wide">
                <span>รูป / คอมการ์ด</span>
                <div className="pbrief-row">
                    <label className={'pbrief-file-btn' + (img || curImg ? ' has-file' : '')}>
                        <Icon name="upload" size={14} /> {img ? img.name : (curImg ? curImg.original : 'อัปโหลดรูป หรือ PDF คอมการ์ด')}
                        <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf"
                            onChange={e => { const f = e.target.files[0]; if (f) { setImg(f); if (setClearImg) setClearImg(false); } }} />
                    </label>
                    {img && <button type="button" className="pbrief-file-clear" title="เอาไฟล์ที่เพิ่งเลือกออก" onClick={() => setImg(null)}>×</button>}
                    {!img && curImg && setClearImg && (
                        <button type="button" className="pbrief-file-clear" title="เอาไฟล์เดิมออก" onClick={() => setClearImg(true)}>×</button>
                    )}
                </div>
                <input className="hire-link-input" type="url" value={form.image_link}
                    onChange={e => set('image_link', e.target.value)} placeholder="หรือวางลิงก์คอมการ์ด (Drive / Canva / ...)" />
            </div>

            {/* คลิปแนะนำตัว: ไฟล์ใหญ่กว่ารูปมาก จึงมีทางเลือกวางลิงก์ให้ด้วย */}
            <div className="hire-f wide">
                <span>คลิปแนะนำตัว</span>
                <div className="pbrief-row">
                    <label className={'pbrief-file-btn' + (vid || curVid ? ' has-file' : '')}>
                        <Icon name="upload" size={14} /> {vid ? vid.name : (curVid ? curVid.original : 'อัปโหลดคลิป MP4 / MOV / WEBM (ไม่เกิน 95MB)')}
                        <input type="file" hidden accept=".mp4,.mov,.m4v,.webm"
                            onChange={e => { const f = e.target.files[0]; if (f) { setVid(f); if (setClearVid) setClearVid(false); } }} />
                    </label>
                    {vid && <button type="button" className="pbrief-file-clear" title="เอาคลิปที่เพิ่งเลือกออก" onClick={() => setVid(null)}>×</button>}
                    {!vid && curVid && setClearVid && (
                        <button type="button" className="pbrief-file-clear" title="เอาคลิปเดิมออก" onClick={() => setClearVid(true)}>×</button>
                    )}
                </div>
                <input className="hire-link-input" type="url" value={form.video_link}
                    onChange={e => set('video_link', e.target.value)} placeholder="หรือวางลิงก์คลิป (YouTube / Drive / TikTok)" />
            </div>

            <label className="hire-f wide">
                <span>โน้ต</span>
                <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="เช่น ว่างเฉพาะช่วงเช้า" />
            </label>
        </div>
    );
}

export default function HireRequestCard({ request, canDecide = false, canPropose = false, heading = true, onChanged, onDeleted }) {
    const pid = request.project_id;
    const rowKey = request.key;
    // เก็บสถานะของใบไว้ในการ์ดเอง — ทุกเส้นคืน hire_items ทั้งชุดกลับมา จึงหยิบแถวของตัวเองมาอัปเดตได้ทันที
    // แล้วค่อยบอกหน้าแม่ให้โหลดใหม่ (ยอดงบ/ตัวเลขสรุปอยู่ที่หน้าแม่)
    const [row, setRow] = useState(request);
    // หน้าแม่สร้าง object ใบใหม่ทุกครั้งที่ re-render (เช่นพิมพ์ในช่องหมายเหตุของแถวอื่น)
    // ถ้าซิงก์ตาม object ตรง ๆ ผลที่เพิ่งกดจะถูกเขียนทับด้วยข้อมูลเก่าที่ยังโหลดไม่เสร็จ — ซิงก์เฉพาะตอนเนื้อในเปลี่ยนจริง
    const sig = JSON.stringify([
        request.key, request.kind, request.headcount, request.fee, request.use_date, request.deadline,
        request.place, request.spec, request.note, request.status, request.filled, request.assignee_id,
        candsOf(request)
    ]);
    useEffect(() => { setRow(request); }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps

    const [err, setErr] = useState('');
    const [busy, setBusy] = useState('');
    const [owners, setOwners] = useState([]);
    const [assignee, setAssignee] = useState(request.assignee_id == null ? '' : String(request.assignee_id));
    useEffect(() => {
        setAssignee(row.assignee_id == null ? '' : String(row.assignee_id));
    }, [row.assignee_id]);
    // แก้/ถอนชื่อที่เสนอได้ถ้าเป็นฝั่งคนขอ หรือเป็นคนเสนอชื่อนั้นเอง (ตรงกับที่ server บังคับ ไม่โชว์ปุ่มที่กดแล้วเจอ 403)
    const { user } = useAuth();
    const canTouch = c => canDecide || (user && c && String(c.by_id) === String(user.id));
    const [preview, setPreview] = useState(null);   // ไฟล์ที่กำลังเปิดดูในหน้า
    const [editing, setEditing] = useState(false);
    const [del, setDel] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [img, setImg] = useState(null);
    const [vid, setVid] = useState(null);

    const [editKey, setEditKey] = useState('');     // ชื่อที่กำลังกดแก้ไขอยู่
    const [editForm, setEditForm] = useState(EMPTY);
    const [editImg, setEditImg] = useState(null);
    const [editVid, setEditVid] = useState(null);
    const [clearImg, setClearImg] = useState(false);
    const [clearVid, setClearVid] = useState(false);

    useEffect(() => {
        if (!canDecide) return;   // มีแต่ฝั่งคนขอที่เปลี่ยนผู้รับผิดชอบได้ ไม่ต้องโหลดรายชื่อให้คนอื่น
        api('/users/options').then(res => setOwners(res.data || [])).catch(() => setOwners([]));
    }, [canDecide]);

    function applyItems(items) {
        const hit = (Array.isArray(items) ? items : []).find(it => String(it.key) === String(rowKey));
        if (hit) setRow(r => ({ ...r, ...hit }));
        // ตัวเลขแดงบนเมนูอ่านจากเส้นนับของตัวเอง ต้องบอกให้โหลดใหม่ ไม่งั้นต้องรอครบนาที
        window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
        if (onChanged) onChanged();
    }

    async function run(label, fn) {
        setBusy(label); setErr('');
        try { await fn(); }
        catch (e) { setErr(e.message); }
        finally { setBusy(''); }
    }

    // อัปไฟล์ของชื่อที่เสนอ (ทำหลังรู้รหัสของคนนั้นแล้วเท่านั้น) — คืน hire_items ชุดล่าสุดกลับไป
    async function putFiles(candKey, items, imageFile, videoFile) {
        let out = items;
        if (imageFile) {
            const up = await uploadFile(`/projects/${pid}/hires/${rowKey}/candidates/${candKey}/image`, imageFile);
            if (up && up.data) out = up.data;
        }
        if (videoFile) {
            const up = await uploadFile(`/projects/${pid}/hires/${rowKey}/candidates/${candKey}/video`, videoFile);
            if (up && up.data) out = up.data;
        }
        return out;
    }

    const saveAssignee = () => run('assign', async () => {
        const res = await api(`/projects/${pid}/hires/${rowKey}/assign`,
            { method: 'PUT', body: { assignee_id: assignee === '' ? null : Number(assignee) } });
        applyItems(res.data);
    });

    const propose = () => run('add', async () => {
        if (!form.name.trim()) { setErr('กรุณาระบุชื่อคนที่เสนอ'); return; }
        const res = await api(`/projects/${pid}/hires/${rowKey}/candidates`, {
            method: 'POST',
            body: {
                name: form.name, fee: Number(String(form.fee).replace(/[^0-9]/g, '')) || 0,
                contact: form.contact, agency: form.agency, link: form.link, note: form.note,
                image_link: form.image_link, video_link: form.video_link
            }
        });
        let items = res.data;
        const hit = (items || []).find(it => String(it.key) === String(rowKey));
        const last = candsOf(hit).slice(-1)[0];
        if (last && (img || vid)) {
            try { items = await putFiles(last.key, items, img, vid); }
            catch (e) { setErr(`เสนอชื่อแล้ว แต่อัปไฟล์ไม่สำเร็จ: ${e.message}`); }
        }
        applyItems(items);
        setForm(EMPTY); setImg(null); setVid(null); setAdding(false);
    });

    function startEdit(c) {
        setEditKey(c.key);
        setEditForm({
            name: S(c.name), fee: c.fee == null ? '' : String(c.fee), contact: S(c.contact), agency: S(c.agency),
            link: S(c.link), note: S(c.note), image_link: S(c.image_link), video_link: S(c.video_link)
        });
        setEditImg(null); setEditVid(null); setClearImg(false); setClearVid(false);
        setErr('');
    }

    const saveEdit = c => run('e' + c.key, async () => {
        if (!editForm.name.trim()) { setErr('กรุณาระบุชื่อคนที่เสนอ'); return; }
        const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${c.key}`, {
            method: 'PUT',
            body: {
                name: editForm.name, fee: Number(String(editForm.fee).replace(/[^0-9]/g, '')) || 0,
                contact: editForm.contact, agency: editForm.agency, link: editForm.link, note: editForm.note,
                image_link: editForm.image_link, video_link: editForm.video_link,
                clear_image: clearImg, clear_video: clearVid
            }
        });
        let items = res.data;
        if (editImg || editVid) {
            try { items = await putFiles(c.key, items, editImg, editVid); }
            catch (e) { setErr(`บันทึกการแก้ไขแล้ว แต่อัปไฟล์ไม่สำเร็จ: ${e.message}`); }
        }
        applyItems(items);
        setEditKey('');
    });

    const decide = (cand, status) => run('c' + cand.key, async () => {
        const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${cand.key}`, { method: 'PATCH', body: { status } });
        applyItems(res.data);
    });

    const drop = cand => {
        const files = [cand.image && 'คอมการ์ด', cand.video && 'คลิปแนะนำตัว'].filter(Boolean).join(' และ ');
        if (!window.confirm(`ถอนชื่อ "${cand.name}" ออกจากใบนี้?${files ? ` ${files} ที่แนบไว้จะถูกลบด้วย` : ''}`)) return;
        run('c' + cand.key, async () => {
            const res = await api(`/projects/${pid}/hires/${rowKey}/candidates/${cand.key}`, { method: 'DELETE' });
            applyItems(res.data);
        });
    };

    async function removeRequest() {
        setDeleting(true); setErr('');
        try {
            await api(`/projects/${pid}/hires/${rowKey}`, { method: 'DELETE' });
            window.dispatchEvent(new CustomEvent('kol:hire-tasks-changed'));
            setDel(false);
            // ใบนี้ไม่มีอยู่แล้ว — ให้หน้าแม่เป็นคนตัดสินใจว่าจะปิดกล่องหรือโหลดรายการใหม่
            if (onDeleted) onDeleted(); else if (onChanged) onChanged();
        } catch (e) { setErr(e.message); setDeleting(false); }
    }

    const cands = candsOf(row);
    const left = leftOf(row);
    const waiting = cands.filter(c => (c.status || CAND_NEW) === CAND_NEW);

    return (
        <div className="panel req-card">
            {(heading || canDecide) && (
                <div className="req-card-head">
                    {heading && (
                        <>
                            <span className="cast-chip">ใบขอจัดหา</span>
                            {row.kind && <strong className="req-card-kind">{row.kind}</strong>}
                            <span className={'req-need' + (left > 0 ? '' : ' done')}>
                                {left > 0 ? `ต้องหาอีก ${left} คน จาก ${Number(row.headcount) || 1}` : 'ได้ครบแล้ว'}
                            </span>
                            <span className="req-money">{B(row.fee)} / คน</span>
                        </>
                    )}
                    {/* แก้/ลบได้เฉพาะฝั่งคนขอ — คนที่ถูกมอบหมายให้จัดหาแตะใบไม่ได้ */}
                    {canDecide && (
                        <div className="row-actions req-card-actions">
                            <button type="button" className="icon-btn" title="แก้ไขใบขอจัดหา" onClick={() => setEditing(true)}>
                                <Icon name="edit" size={14} />
                            </button>
                            <button type="button" className="icon-btn danger" title="ลบใบขอจัดหา" onClick={() => setDel(true)}>
                                <Icon name="trash" size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {err && <div className="alert-error">{err}</div>}

            <div className="req-facts">
                <div><span>วันที่ต้องใช้งาน</span><b>{fmtD(row.use_date)}</b></div>
                <div><span>กำหนดส่งรายชื่อ</span><b>{fmtD(row.deadline)}</b></div>
                <div><span>สถานที่</span><b>{row.place || '—'}</b></div>
            </div>

            {row.spec && <div className="req-spec"><Icon name="file" size={14} /> {row.spec}</div>}

            <div className="req-assign">
                <span className="req-assign-lbl">ผู้รับผิดชอบจัดหา</span>
                {canDecide ? (
                    <>
                        <select value={assignee} onChange={e => setAssignee(e.target.value)}>
                            <option value="">— ยังไม่มอบหมาย —</option>
                            {owners.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                            {/* คนที่เคยรับงานไว้แต่ไม่อยู่ในรายชื่อแล้ว (ปิดบัญชี/เปลี่ยนสิทธิ์) ต้องยังโชว์
                                ไม่งั้นช่องจะเด้งกลับเป็น "ยังไม่มอบหมาย" แล้วกดบันทึกทีเดียวงานหลุดมือเงียบ ๆ */}
                            {assignee !== '' && !owners.some(u => String(u.id) === assignee) && (
                                <option value={assignee}>{row.assignee_name || `ผู้ใช้ #${assignee}`}</option>
                            )}
                        </select>
                        <button type="button" className="btn-ghost"
                            disabled={busy === 'assign' || assignee === (row.assignee_id == null ? '' : String(row.assignee_id))}
                            onClick={saveAssignee}>{busy === 'assign' ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                    </>
                ) : (
                    <b>{row.assignee_name || '— ยังไม่มอบหมาย —'}</b>
                )}
            </div>

            <div className="req-cands-head">
                <span>รายชื่อที่เสนอ ({cands.length}{waiting.length ? ` · รอเลือก ${waiting.length}` : ''})</span>
                {canPropose && !adding && (
                    <button type="button" className="btn-ghost" onClick={() => { setAdding(true); setForm(EMPTY); setImg(null); setVid(null); }}>
                        <Icon name="plus" size={14} /> เสนอชื่อ
                    </button>
                )}
            </div>

            {adding && (
                <div className="req-add">
                    <CandFields form={form} setForm={setForm} feeHint={Number(row.fee) || 0}
                        img={img} setImg={setImg} vid={vid} setVid={setVid} />
                    <div className="req-add-actions">
                        <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setImg(null); setVid(null); }}>ยกเลิก</button>
                        <button type="button" className="btn-primary" disabled={busy === 'add'} onClick={propose}>
                            {busy === 'add' ? 'กำลังบันทึก...' : 'เสนอชื่อนี้'}
                        </button>
                    </div>
                </div>
            )}

            {cands.length === 0 ? (
                <div className="req-empty">ยังไม่มีใครเสนอชื่อเข้ามา</div>
            ) : (
                <div className="req-cands">
                    {cands.map((c, i) => {
                        const st = c.status || CAND_NEW;
                        if (editKey === c.key) {
                            return (
                                <div className="req-add req-edit" key={c.key}>
                                    <div className="req-edit-lbl">
                                        แก้ไขชื่อที่เสนอ #{i + 1}
                                        {st === CAND_PICKED && (
                                            <span className="req-edit-warn"> · คนนี้เข้าเป็นผู้รับงานแล้ว แก้ตรงนี้ไม่เปลี่ยนข้อมูลในแถวผู้รับงาน</span>
                                        )}
                                    </div>
                                    <CandFields form={editForm} setForm={setEditForm} feeHint={Number(row.fee) || 0}
                                        img={editImg} setImg={setEditImg} vid={editVid} setVid={setEditVid}
                                        current={c} clearImg={clearImg} setClearImg={setClearImg}
                                        clearVid={clearVid} setClearVid={setClearVid} />
                                    <div className="req-add-actions">
                                        <button type="button" className="btn-ghost" onClick={() => setEditKey('')}>ยกเลิก</button>
                                        <button type="button" className="btn-primary" disabled={busy === 'e' + c.key} onClick={() => saveEdit(c)}>
                                            {busy === 'e' + c.key ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                        return (
                            <div className={'req-cand st-' + (st === CAND_PICKED ? 'ok' : st === CAND_DROPPED ? 'no' : 'new')} key={c.key}>
                                <div className="req-cand-main">
                                    <div className="req-cand-name">
                                        <span className="req-cand-no">{i + 1}</span>
                                        <strong>{c.name}</strong>
                                        <span className="req-cand-st">{st}</span>
                                    </div>
                                    <div className="req-cand-meta">
                                        {B(c.fee)}
                                        {c.agency ? ` · ${c.agency}` : ''}
                                        {c.contact ? ` · ${c.contact}` : ''}
                                        {c.by_name ? ` · เสนอโดย ${c.by_name}` : ''}
                                    </div>
                                    {c.note && <div className="req-cand-note">📝 {c.note}</div>}
                                    <div className="req-cand-links">
                                        {c.image && (
                                            <button type="button" className="work-link"
                                                onClick={() => setPreview({ path: `/projects/${pid}/hires/${rowKey}/candidates/${c.key}/image`, title: c.image.original, kind: 'auto' })}>
                                                <Icon name="eye" size={12} /> คอมการ์ด
                                            </button>
                                        )}
                                        {c.image_link && <a className="work-link" href={c.image_link} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> คอมการ์ด (ลิงก์)</a>}
                                        {c.video && (
                                            <button type="button" className="work-link"
                                                onClick={() => setPreview({ path: `/projects/${pid}/hires/${rowKey}/candidates/${c.key}/video`, title: c.video.original, kind: 'video' })}>
                                                <Icon name="eye" size={12} /> คลิปแนะนำตัว
                                            </button>
                                        )}
                                        {c.video_link && <a className="work-link" href={c.video_link} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> คลิป (ลิงก์)</a>}
                                        {c.link && <a className="work-link" href={c.link} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> Account</a>}
                                    </div>
                                </div>
                                <div className="req-cand-actions">
                                    {st === CAND_PICKED && <span className="req-cand-done">เข้าเป็นผู้รับงานแล้ว</span>}
                                    {/* แก้ไขได้ทุกแถว รวมถึงคนที่ถูกเลือกไปแล้ว (แก้ชื่อ/ค่าตัว/ติดต่อ/ไฟล์ที่แนบผิด) */}
                                    {canPropose && canTouch(c) && (
                                        <button type="button" className="btn-ghost req-edit-btn" title="แก้ไขข้อมูลของคนนี้"
                                            disabled={busy === 'c' + c.key} onClick={() => startEdit(c)}>
                                            <Icon name="edit" size={13} /> แก้ไข
                                        </button>
                                    )}
                                    {st === CAND_NEW && canDecide && left > 0 && (
                                        <button type="button" className="btn-primary" disabled={busy === 'c' + c.key}
                                            onClick={() => decide(c, CAND_PICKED)}>✓ เลือกคนนี้</button>
                                    )}
                                    {st === CAND_NEW && canDecide && (
                                        <button type="button" className="btn-reject" disabled={busy === 'c' + c.key}
                                            onClick={() => decide(c, CAND_DROPPED)}>✕ ไม่เอา</button>
                                    )}
                                    {/* คนที่ถูกเลือกแล้วถอนออกจากใบไม่ได้ — แถวผู้รับงานเกิดไปแล้ว ถ้าถอนตรงนี้ยอดคนกับงบจะไม่ตรงกัน
                                        ปุ่มจึงยังอยู่แต่กดไม่ได้ พร้อมบอกว่าให้ไปลบที่ตารางผู้รับงานแทน */}
                                    {canPropose && canTouch(c) && (
                                        <button type="button" className="sub-del"
                                            title={st === CAND_PICKED
                                                ? 'คนนี้เข้าเป็นผู้รับงานแล้ว ถอนจากใบไม่ได้ — ให้ไปลบที่ตารางผู้รับงานแทน'
                                                : 'ถอนชื่อนี้ออก'}
                                            disabled={busy === 'c' + c.key || st === CAND_PICKED}
                                            onClick={() => drop(c)}>
                                            <Icon name="trash" size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {preview && (
                <FilePreviewModal path={preview.path} title={preview.title} kind={preview.kind}
                    onClose={() => setPreview(null)} />
            )}

            {editing && (
                <HireRequestEditModal request={row}
                    onClose={() => setEditing(false)}
                    onSaved={items => { setEditing(false); applyItems(items); }} />
            )}

            {del && (
                <div className="modal-backdrop" onClick={() => !deleting && setDel(false)}>
                    <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>ลบใบขอจัดหานี้?</h3>
                        <p>
                            {row.kind || 'ใบขอจัดหา'}
                            {cands.length > 0 ? ` · รายชื่อที่เสนอไว้ ${cands.length} ชื่อจะหายไปด้วย` : ''}
                            {Number(row.filled) > 0 ? ` · คนที่เลือกไปแล้ว ${Number(row.filled)} คนยังอยู่ในงานจ้างตามเดิม` : ''}
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" disabled={deleting} onClick={() => setDel(false)}>ยกเลิก</button>
                            <button type="button" className="btn-danger" disabled={deleting} onClick={removeRequest}>
                                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
