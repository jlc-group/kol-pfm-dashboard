import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import {
    SOLO_STEP_LABEL, SOLO_STEP_FILTERS, soloStepOf, matchStepFilter, soloTotals, overdueDays, soloDueOf, baht, followersText, tierShort
} from '../../data/soloKol.js';

// แท็บ "KOL รายคน" ในหน้าแคมเปญ — 1 แถว = การจ้าง 1 ครั้ง (ผู้ใช้สั่ง 30 ก.ย. 2026)
// ข้อมูลของแถวมาจาก p.solo_summary ที่ server คิดให้ (server/src/store/soloKol.js soloSummary) · กดแถว = เปิดหน้าของ KOL คนนั้น
const STATUS_LABEL = { Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
const STATUS_ORDER = ['Active', 'Completed', 'Cancelled'];
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const shortDate = d => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${Number(day)} ${TH_MONTHS[Number(m) - 1]} ${y.slice(2)}`; };

function Row({ p, onOpen, fresh, today }) {
    const s = p.solo_summary || {};
    const step = soloStepOf(p);
    const late = overdueDays(p, today);
    const fol = followersText(s.followers);
    return (
        <button type="button" className={'solo-row' + (fresh ? ' fresh' : '')} onClick={() => onOpen(p)}>
            <span className="solo-kol">
                <span className="solo-avatar" aria-hidden="true">{String(s.account_name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="solo-kol-text">
                    <b className="solo-acc">@{s.account_name || '—'}</b>
                    <span className="solo-meta">{[s.platform, fol, tierShort(s.tier)].filter(Boolean).join(' · ')}</span>
                    <span className="solo-meta">{s.contact_mode === 'agency' ? `Agency: ${s.agency || s.payee || '—'}` : 'ติดต่อเอง'}</span>
                </span>
            </span>
            <span className="solo-brand">
                <span className="solo-brand-name">{p.brand || '—'}</span>
                {/* ข้อความล้วน — แถวทั้งแถวเป็นปุ่ม ห้ามมีปุ่มซ้อนข้างใน (กด "+N" แล้วจะเปิดหน้ารายละเอียดแทน) */}
                {(s.products || []).length > 0 && (
                    <span className="solo-prods" title={s.products.join(', ')}>
                        {s.products.slice(0, 2).join(', ')}{s.products.length > 2 ? ` +${s.products.length - 2}` : ''}
                    </span>
                )}
            </span>
            <span className="solo-clips" title={`ลงงานแล้ว ${s.posted || 0} จาก ${s.clips || 0} คลิป`}>
                <span className="solo-dots" aria-hidden="true">
                    {Array.from({ length: s.clips || 0 }, (_, i) => <i key={i} className={i < (s.posted || 0) ? 'on' : ''} />)}
                </span>
                {s.posted || 0}/{s.clips || 0} ลงแล้ว
            </span>
            <span className="solo-step-cell">
                <span className={'solo-step s-' + step}>{SOLO_STEP_LABEL[step] || step}</span>
                {late > 0 && <span className="solo-late">เลยกำหนด {late} วัน</span>}
            </span>
            <span className="solo-fee">
                {s.fee_missing ? <span className="solo-fee-missing">รอค่าตัว</span>
                    : <>{baht(s.fee_per_clip)}{s.clips > 1 && <small> × {s.clips} = {baht(s.fee_total)}</small>}</>}
            </span>
            <span className="solo-owner">
                {p.owner || '—'}
                {soloDueOf(p) && <small>กำหนด {shortDate(soloDueOf(p))}</small>}
            </span>
            <Icon name="chevron" size={16} />
        </button>
    );
}

export default function SoloKolList({ list, onOpen, onAdd, freshId, filtered }) {
    const [step, setStep] = useState('all');
    const [openDone, setOpenDone] = useState(false);
    const today = todayStr();
    const shown = list.filter(p => matchStepFilter(p, step));
    const tot = soloTotals(list);
    const countStep = key => list.filter(p => matchStepFilter(p, key)).length;

    if (!list.length) {
        return (
            <div className="panel empty-state">
                <div className="empty-emoji">🙋</div>
                <p>{filtered ? 'ไม่พบ KOL รายคนตามเงื่อนไขที่เลือก — ลองปรับคำค้นหา แบรนด์ ปี หรือเดือน' : 'ยังไม่มี KOL รายคน — จ้าง KOL เดี่ยวได้เลยโดยไม่ต้องสร้างแคมเปญ'}</p>
                <button className="btn-primary" onClick={onAdd}><Icon name="plus" size={17} /> เพิ่ม KOL รายคน</button>
            </div>
        );
    }
    return (
        <div className="solo-wrap">
            <div className="solo-sumline">
                {tot.people} คน · {tot.clips} คลิป · ค่าตัวรวม {baht(tot.fee)} · ลงแล้ว {tot.posted}/{tot.clips} · ยิงแอดแล้ว {tot.ad}
            </div>
            <div className="solo-stepbar" role="group" aria-label="กรองตามขั้นงาน">
                <button type="button" className={'brand-chip' + (step === 'all' ? ' active' : '')} onClick={() => setStep('all')}>ทั้งหมด ({list.length})</button>
                {SOLO_STEP_FILTERS.map(f => (
                    <button type="button" key={f.key} className={'brand-chip' + (step === f.key ? ' active' : '')} onClick={() => setStep(f.key)}>
                        {f.label} ({countStep(f.key)})
                    </button>
                ))}
            </div>
            {STATUS_ORDER.map(st => {
                const rows = shown.filter(p => p.status === st || (st === 'Active' && !STATUS_ORDER.includes(p.status)));
                if (!rows.length) return null;
                const closed = st !== 'Active';
                const body = (
                    <div className="solo-table">
                        <div className="solo-head" aria-hidden="true">
                            <span>KOL</span><span>แบรนด์ · สินค้า</span><span>คลิป</span><span>ขั้นถัดไป</span><span>ค่าตัว</span><span>ผู้ดูแล</span><span />
                        </div>
                        {rows.map(p => <Row key={p.id} p={p} onOpen={onOpen} fresh={freshId === p.id} today={today} />)}
                    </div>
                );
                return (
                    <div className="proj-status-group" key={st}>
                        {closed ? (
                            <>
                                <button type="button" className="proj-status-head solo-fold" aria-expanded={openDone} onClick={() => setOpenDone(v => !v)}>
                                    <span className={`proj-status-dot dot-${st}`} />
                                    <span className="proj-status-title">{STATUS_LABEL[st]}</span>
                                    <span className="proj-status-count">{rows.length}</span>
                                    <span className="solo-fold-hint">{openDone ? 'ซ่อน' : 'แสดง'}</span>
                                </button>
                                {openDone && body}
                            </>
                        ) : (
                            <>
                                <div className="proj-status-head">
                                    <span className={`proj-status-dot dot-${st}`} />
                                    <span className="proj-status-title">{STATUS_LABEL[st]}</span>
                                    <span className="proj-status-count">{rows.length}</span>
                                </div>
                                {body}
                            </>
                        )}
                    </div>
                );
            })}
            {!shown.length && <div className="panel"><p className="empty">ไม่มี KOL รายคนในขั้นนี้</p></div>}
        </div>
    );
}
