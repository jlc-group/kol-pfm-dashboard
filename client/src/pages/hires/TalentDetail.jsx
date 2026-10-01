import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SideDrawer from '../../components/SideDrawer.jsx';
import FilePreviewModal from '../../components/FilePreviewModal.jsx';
import Icon from '../../components/Icon.jsx';
import { visibleBrands } from '../../data/brands.js';
import { T, baht } from '../../data/talentLabels.js';
import { normalizeSocials } from '../../data/talentSocials.js';
import { jobsCountOf, monthYear, sortJobs } from '../../data/talentJobs.js';
import { Photo, SocialLine, cardSocials, httpUrl, okPath, str } from './CompCard.jsx';
import TalentJobForm from './TalentJobForm.jsx';

// หน้ารายละเอียดของคนใน Talent Book — กดการ์ดแล้วเปิด (ผู้ใช้สั่ง 1 ต.ค. 2026)
// บน: ข้อมูลของคนทั้งหมด (รูป / ช่องทาง Social / เรท / แบรนด์ / ผู้ติดต่อ / Scope / หมายเหตุ / คลิป)
// ล่าง: "งานที่จ้าง (N)" ทุกงานใหม่สุดก่อน · เพิ่ม/แก้/ลบได้เฉพาะคนที่แก้การ์ดนี้ได้ (คนที่เพิ่ม / admin — server ตัดสิน)
// ข้อมูลคนมาจากการ์ด (โชว์ทันที) แล้วเติมด้วย GET /hires/talents/:id (ข้อมูลเต็ม + jobs) · การ์ดจากงานเก่าอย่างเดียว (ไม่มี talent) ไม่มีส่วนงานที่จ้าง
// reloadKey เปลี่ยน (แก้ข้อมูลในฟอร์มแล้ว) = โหลดใหม่ · onChanged() = งานเปลี่ยน ให้หน้าแม่โหลดการ์ดใหม่ (ตัวเลข "จ้างแล้ว N งาน")
const CONTACT_LABEL = { self: 'ติดต่อเอง', agency: 'ผ่าน Agency' };

export default function TalentDetail({ card, reloadKey = 0, onClose, onEdit, onChanged }) {
    const { user } = useAuth();
    const tid = card.talent ? card.talent.id : null;
    const [t, setT] = useState(null);          // ข้อมูลเต็มจาก server (ไม่มี = ใช้ของการ์ด)
    const [jobs, setJobs] = useState(null);
    const [loadErr, setLoadErr] = useState('');
    const [ver, setVer] = useState(0);
    const [jobEdit, setJobEdit] = useState(null);   // null = ไม่ได้แก้ · { id: null } = เพิ่ม · { id } = แก้งานนั้น
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [preview, setPreview] = useState(null);

    useEffect(() => {
        if (tid == null) return undefined;
        let on = true;
        api(`/hires/talents/${encodeURIComponent(tid)}`)
            .then(res => {
                if (!on) return;
                const d = (res && res.data) || {};
                setT(d);
                setJobs(sortJobs(Array.isArray(d.jobs) ? d.jobs : []));
                setLoadErr('');
            })
            .catch(e => { if (on) { setLoadErr(e.message || 'โหลดงานที่จ้างไม่สำเร็จ'); setJobs(j => j || []); } });
        return () => { on = false; };
    }, [tid, ver, reloadKey]);

    const talent = card.talent || null;
    // แก้ได้ไหม: server ตอบมาแล้วเชื่อ server · ยังโหลดไม่เสร็จใช้ค่าจากการ์ด
    const editable = !!(t ? t.editable : talent && talent.editable);
    const name = str(t && t.name) || str(card.name);
    const kind = str(t && t.kind) || str(card.kind);
    // ช่องทาง / ผู้ติดต่อ / แบรนด์ = ค่าที่ server รวมไว้ในการ์ดแล้ว (หน้าการ์ดกับหน้ารายละเอียดต้องตรงกัน)
    // — การ์ดที่รวมกับคนจากงานเดิม (ชื่อ + ประเภทงานตรงกัน) ได้ช่องทาง / สังกัด / เบอร์ จากงานมาด้วย ข้อมูลของแถวที่เพิ่มเองอย่างเดียวไม่มี
    // ข้อมูลเต็ม (t) ใช้เติมเมื่อการ์ดไม่มี · บันทึกฟอร์มแล้วหน้าแม่โหลดการ์ดใหม่ทุกครั้ง ค่าในการ์ดจึงไม่ค้าง
    const cs = cardSocials(card);
    const socials = cs.length ? cs : normalizeSocials(t && t.socials, t && t.link);
    const rateRaw = t ? t.rate : talent && talent.rate;
    const rate = Number(rateRaw) > 0 ? Number(rateRaw) : 0;
    const rateUnit = str(t ? t.rate_unit : talent && talent.rate_unit);
    const brands = [...new Set([...(card.brands || []), ...((t && Array.isArray(t.brands) && t.brands) || [])].map(str).filter(Boolean))];
    const mode = str(card.contact_mode) || str(t && t.contact_mode);
    const contactName = str(card.contact_name) || str(t && t.contact_name);
    const contact = str(card.contact) || str(t && t.contact);
    const agency = str(card.agency) || str(t && t.agency);
    // ลิงก์รูป / คอมการ์ดที่ทีมวางไว้ — การ์ดมีไฟล์รูป (อัปเอง / ดึงจากลิงก์ Social อัตโนมัติ) ลิงก์นี้ก็ยังเปิดได้จากตรงนี้
    // รูปบนการ์ดเป็นลิงก์นี้อยู่แล้ว (ไม่มีไฟล์) = กดรูปเปิดได้ ไม่ต้องมีปุ่มซ้ำ
    const imgLink = httpUrl((t && t.image_link) || card.image_link);
    const showImgLink = !!imgLink && !(card.photo && card.photo.type === 'link' && httpUrl(card.photo.url) === imgLink);
    const scope = str(t ? t.scope : talent && talent.scope);
    const note = str(t ? t.note : talent && talent.note);
    const addedBy = str(t ? t.added_by : talent && talent.added_by);
    const clip = card.clip || null;
    const projects = (card.projects || []).filter(p => p && p.id != null);
    const fees = (Array.isArray(card.fees) ? card.fees : []).filter(f => f && Number(f.fee) > 0);
    const list = jobs || [];
    const count = jobs ? list.length : jobsCountOf(card);
    // แบรนด์ของงานเลือกได้เฉพาะแบรนด์ที่ตัวเองเห็น · ตั้งต้นให้ถ้าเลือกได้แบรนด์เดียว หรือการ์ดผูกไว้แบรนด์เดียวที่ตัวเองเห็น
    const mine = visibleBrands(user);
    const mineOnCard = mine.filter(b => brands.includes(b));
    const defaultBrand = mine.length === 1 ? mine[0] : mineOnCard.length === 1 ? mineOnCard[0] : '';

    function requestClose() {
        if (busy) return;
        if (jobEdit && !window.confirm('ยังไม่ได้บันทึกงานที่กรอกค้างไว้ — ปิดเลยไหม?')) return;
        onClose && onClose();
    }
    const jobSaved = () => { setJobEdit(null); setErr(''); setVer(v => v + 1); onChanged && onChanged(); };

    async function removeJob(j) {
        const what = [j.brand, monthYear(j.hired_on)].filter(Boolean).join(' · ') || 'งานนี้';
        if (!window.confirm(`ลบงานที่จ้าง "${what}" ของ ${name}?`)) return;
        setBusy(true); setErr('');
        try {
            await api(`/hires/talents/${encodeURIComponent(tid)}/jobs/${encodeURIComponent(j.id)}`, { method: 'DELETE' });
            jobSaved();
        } catch (e) {
            setErr(e.message || 'ลบงานไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    }

    const facts = [
        brands.length > 0 && ['แบรนด์', brands.join(', ')],
        mode && ['ช่องทางติดต่อ', CONTACT_LABEL[mode] || mode],
        agency && [mode === 'agency' ? 'เอเจนซี่' : 'สังกัด', agency],
        contactName && [mode === 'agency' ? 'ผู้ติดต่อเอเจนซี่' : 'ชื่อผู้ติดต่อ', contactName],
        contact && [T.contact, contact],
        scope && ['Scope of work', scope],
        note && [T.note, note],
        (card.team_contacts || []).length > 0 && ['ผู้ติดต่อ (ทีม)', card.team_contacts.join(', ')],
        (card.proposed_by || []).length > 0 && ['เสนอโดย', card.proposed_by.join(', ')],
        addedBy && ['เพิ่มเข้า Talent Book โดย', addedBy]
    ].filter(Boolean);

    let clipEl = null;
    if (clip && clip.type === 'file' && okPath(clip.path)) {
        clipEl = (
            <button type="button" className="btn-ghost tbd-clip" onClick={() => setPreview({ path: clip.path, title: `คลิปของ ${name}`, kind: 'video' })}>
                <Icon name="play" size={13} /> ดูคลิปผลงาน
            </button>
        );
    } else if (clip && clip.type === 'link' && httpUrl(clip.url)) {
        clipEl = (
            <a className="btn-ghost tbd-clip" href={httpUrl(clip.url)} target="_blank" rel="noopener noreferrer">
                <Icon name="play" size={13} /> ดูคลิปผลงาน (ลิงก์)
            </a>
        );
    }

    const footer = (
        <>
            {editable && tid != null && onEdit && (
                <button type="button" className="btn-ghost tbd-edit" onClick={() => onEdit(tid)} disabled={busy}>✎ แก้ไขข้อมูล</button>
            )}
            <button type="button" className="btn-primary" onClick={requestClose} disabled={busy}>ปิด</button>
        </>
    );

    return (
        <SideDrawer title={name} subtitle={[kind, count > 0 ? `จ้างแล้ว ${count} งาน` : ''].filter(Boolean).join(' · ')}
            onClose={requestClose} footer={footer} width={780} busy={busy} className="tbd-drawer">
            <div className="tbd">
                <section className="tbd-hero">
                    <div className="tbd-side">
                        <Photo card={card} onPreview={setPreview} className="tb-photo tbd-photo" />
                        {showImgLink && (
                            <a className="btn-ghost tbd-clip tbd-imglink" href={imgLink} target="_blank" rel="noopener noreferrer" title={imgLink}>
                                <Icon name="image" size={13} /> ดูรูป / คอมการ์ด (ลิงก์)
                            </a>
                        )}
                        {clipEl}
                    </div>
                    <div className="tbd-main">
                        {kind && <div className="tbd-kind">{kind}</div>}
                        <div className="tbd-block">
                            <div className="tbd-k">ช่องทาง Social</div>
                            {socials.length > 0 ? (
                                <ul className="tb-socials tbd-socials">
                                    {socials.map((s, i) => <li key={i}><SocialLine s={s} full /></li>)}
                                </ul>
                            ) : <div className="tb-soc-none">ยังไม่มีช่องทาง Social</div>}
                        </div>
                        <div className="tbd-block">
                            <div className="tbd-k">เรทราคา</div>
                            {rate > 0
                                ? <div className="tbd-rate"><b>{baht(rate)}</b>{rateUnit && <span> {rateUnit}</span>}</div>
                                : <div className="tb-fee-none">ยังไม่มีเรทราคา</div>}
                        </div>
                        {facts.length > 0 && (
                            <dl className="tbd-facts">
                                {facts.map(([k, v]) => (
                                    <div key={k} className="tbd-fact"><dt>{k}</dt><dd>{v}</dd></div>
                                ))}
                            </dl>
                        )}
                    </div>
                </section>

                {tid != null ? (
                    <section className="tbd-jobs" aria-labelledby="tbd-jobs-title">
                        <div className="tbd-jobs-head">
                            <h3 id="tbd-jobs-title">งานที่จ้าง ({count})</h3>
                            {editable && !jobEdit && (
                                <button type="button" className="btn-primary tbd-add-job" onClick={() => { setErr(''); setJobEdit({ id: null }); }} disabled={busy}>
                                    <Icon name="plus" size={14} /> เพิ่มงานที่จ้าง
                                </button>
                            )}
                        </div>
                        {err && <div className="alert-error" role="alert">{err}</div>}
                        {loadErr && <div className="alert-error">{loadErr}</div>}
                        {jobEdit && jobEdit.id == null && (
                            <TalentJobForm talentId={tid} brands={mine} defaultBrand={defaultBrand}
                                onCancel={() => setJobEdit(null)} onSaved={jobSaved} />
                        )}
                        {jobs == null ? (
                            <p className="muted tbd-empty">กำลังโหลด...</p>
                        ) : list.length === 0 ? (
                            !jobEdit && <p className="muted tbd-empty">ยังไม่มีงานที่จ้าง{editable ? ' — กด "+ เพิ่มงานที่จ้าง" เพื่อบันทึกงานแรก' : ''}</p>
                        ) : (
                            <ul className="tbj-list">
                                {list.map(j => (jobEdit && String(jobEdit.id) === String(j.id) ? (
                                    <li key={j.id} className="tbj-item editing">
                                        <TalentJobForm talentId={tid} job={j} brands={mine}
                                            onCancel={() => setJobEdit(null)} onSaved={jobSaved} />
                                    </li>
                                ) : (
                                    <li key={j.id} className="tbj-item">
                                        <div className="tbj-when">{monthYear(j.hired_on) || '—'}</div>
                                        <div className="tbj-body">
                                            <div className="tbj-top">
                                                <span className="tbj-brand">{str(j.brand) || '—'}</span>
                                                {j.fee != null && j.fee !== '' && Number.isFinite(Number(j.fee)) && (
                                                    <span className="tbj-fee">{Number(j.fee) > 0 ? baht(j.fee) : 'ได้ฟรี (฿0)'}</span>
                                                )}
                                            </div>
                                            {str(j.scope) && <div className="tbj-line"><span className="tbj-k">Scope :</span> {str(j.scope)}</div>}
                                            {httpUrl(j.work_link) && (
                                                <div className="tbj-line">
                                                    <a className="tb-acc" href={httpUrl(j.work_link)} target="_blank" rel="noopener noreferrer" title={httpUrl(j.work_link)}>
                                                        <Icon name="link" size={12} /> ลิงก์งาน / โพสต์
                                                    </a>
                                                </div>
                                            )}
                                            {str(j.note) && <div className="tbj-line"><span className="tbj-k">{T.note} :</span> {str(j.note)}</div>}
                                            {str(j.added_by || j.created_by) && <div className="tbj-by">บันทึกโดย {str(j.added_by || j.created_by)}</div>}
                                        </div>
                                        {editable && j.editable !== false && !jobEdit && (
                                            <div className="tbj-actions">
                                                <button type="button" className="tbj-btn" onClick={() => { setErr(''); setJobEdit({ id: j.id }); }} disabled={busy}
                                                    aria-label={`แก้งาน ${str(j.brand)} ${monthYear(j.hired_on)}`}>✎ แก้</button>
                                                <button type="button" className="tbj-btn danger" onClick={() => removeJob(j)} disabled={busy}
                                                    aria-label={`ลบงาน ${str(j.brand)} ${monthYear(j.hired_on)}`}>ลบ</button>
                                            </div>
                                        )}
                                    </li>
                                )))}
                            </ul>
                        )}
                    </section>
                ) : (
                    <section className="tbd-jobs">
                        <p className="muted tbd-empty">การ์ดนี้มาจากงาน Talent เดิม — กด "+ Talent Book" เพิ่มชื่อ + ประเภทงานเดียวกัน แล้วจะบันทึกงานที่จ้างได้</p>
                    </section>
                )}

                {projects.length > 0 && (
                    <section className="tbd-old">
                        <h3>เคยอยู่ในงาน Talent เดิม ({projects.length})</h3>
                        <ul>
                            {projects.map(p => {
                                const f = fees.find(x => String(x.project_id) === String(p.id));
                                return (
                                    <li key={p.id}>
                                        <Link to={`/projects/${encodeURIComponent(p.id)}`}>{str(p.name) || `งาน #${p.id}`}</Link>
                                        {f && <span className="muted"> · {f.kind === 'hired' ? 'ค่าตัว' : 'ราคาที่เสนอ'} {baht(f.fee)}</span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}
            </div>

            {preview && (
                <FilePreviewModal path={preview.path} title={preview.title} kind={preview.kind || 'auto'} onClose={() => setPreview(null)} />
            )}
        </SideDrawer>
    );
}
