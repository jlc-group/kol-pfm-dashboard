import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import {
    SOLO_STEP_LABEL, SOLO_STEP_FILTERS, soloStepOf, matchStepFilter, soloTotals, baht, followersText, tierShort, soloAccountsOf, soloPlatformsOf
} from '../../data/soloKol.js';

// แท็บ "KOL รายคน" ในหน้าแคมเปญ — 1 แถว = การจ้าง 1 ครั้ง (ผู้ใช้สั่ง 30 ก.ย. 2026)
// ข้อมูลของแถวมาจาก p.solo_summary ที่ server คิดให้ (server/src/store/soloKol.js soloSummary) · กดแถว = เปิดหน้าของ KOL คนนั้น
// รอบ 4 (1 ต.ค. 2026): หลาย Platform — แถวโชว์บัญชีหลัก (+ ชื่อบัญชีอื่น) · ค่าตัว 0 ทุกคลิป = ได้ฟรี · ไม่มีกำหนดลงงาน / เลยกำหนดแล้ว
const STATUS_LABEL = { Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
const STATUS_ORDER = ['Active', 'Completed', 'Cancelled'];

function Row({ p, onOpen, fresh }) {
    const s = p.solo_summary || {};
    const step = soloStepOf(p);
    const accounts = soloAccountsOf(p);
    const primary = accounts[0] || {};
    const name = s.account_name || primary.account_name || '';
    // ชื่อบัญชีอื่นที่ไม่ซ้ำกับบัญชีหลัก (Platform อื่นใช้ชื่อเดียวกันไม่นับ — Platform บอกอยู่แล้วในบรรทัดถัดไป)
    const more = new Set(accounts.map(a => a.account_name).filter(n => n && n !== name)).size;
    const fol = followersText(primary.followers != null ? primary.followers : s.followers);
    return (
        <button type="button" className={'solo-row' + (fresh ? ' fresh' : '')} onClick={() => onOpen(p)}>
            <span className="solo-kol">
                <span className="solo-avatar" aria-hidden="true">{String(name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="solo-kol-text">
                    <b className="solo-acc" title={accounts.map(a => `${a.platform} @${a.account_name || '—'}`).join(' · ')}>
                        @{name || '—'}{more > 0 && <small> +{more}</small>}
                    </b>
                    <span className="solo-meta">{[soloPlatformsOf(p).join(', '), fol, tierShort(primary.tier || s.tier)].filter(Boolean).join(' · ')}</span>
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
            <span className="solo-clips" title={`ลงงานแล้ว ${s.posted || 0} จาก ${s.clips || 0} โพสต์`}>
                <span className="solo-dots" aria-hidden="true">
                    {Array.from({ length: s.clips || 0 }, (_, i) => <i key={i} className={i < (s.posted || 0) ? 'on' : ''} />)}
                </span>
                {s.posted || 0}/{s.clips || 0} ลงแล้ว
            </span>
            <span className="solo-step-cell">
                <span className={'solo-step s-' + step}>{SOLO_STEP_LABEL[step] || step}</span>
            </span>
            <span className="solo-fee">
                {/* fee_per_clip = null เมื่อค่าตัวแต่ละคลิป/Platform ไม่เท่ากัน → โชว์ยอดรวมอย่างเดียว */}
                {s.fee_free ? 'ได้ฟรี'
                    : s.fee_per_clip != null ? <>{baht(s.fee_per_clip)}{s.clips > 1 && <small> × {s.clips} = {baht(s.fee_total)}</small>}</>
                        : baht(s.fee_total)}
            </span>
            <span className="solo-owner">{p.owner || '—'}</span>
            <Icon name="chevron" size={16} />
        </button>
    );
}

export default function SoloKolList({ list, onOpen, onAdd, freshId, filtered }) {
    const [step, setStep] = useState('all');
    const [openDone, setOpenDone] = useState(false);
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
                        {rows.map(p => <Row key={p.id} p={p} onOpen={onOpen} fresh={freshId === p.id} />)}
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
