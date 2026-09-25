import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { budgetFor, quotaOf, clipCountFor, groupPlatforms, blocksBudget, toBlocks } from '../data/adGroups.js';
import { AD_STAMP_AT, stampAtFor } from '../data/stamp.js';

// ===== หาร / ล้าง ค่าตัว KOL ของ 1 กลุ่ม (ฝั่งทีม) =====
// ขอบเขตหาร = 1 กลุ่ม × 1 Platform เพราะงบตั้งไว้ที่ชั้น Platform ของกลุ่ม
// ค่าตัวต่อคลิป = งบ ÷ (โควตาคน × คลิปต่อคน) — หารจากโควตา ไม่ใช่จำนวนรายชื่อตอนนี้
//   คนที่ส่งเข้ามาทีหลังจะได้ยอดเท่ากับคนแรก ๆ
// ไม่นับคนที่ "ไม่เลือก" · ส่งคำขอเดียวทั้งชุด (server ทำใน transaction) · ไม่จำอะไรไว้ในเครื่อง

export const feeOf = s => Number(s && s.budget) || 0;
export const personKeyOf = s => s.person_key || ('sub:' + s.id);
const baht = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const MAX_ITEMS = 500;   // server รับได้ไม่เกินนี้ต่อคำขอ

// งบของ (กลุ่ม × Platform) — ใช้งบที่ตั้งไว้ในกลุ่มก่อนเสมอ
// ถอยไปใช้งบต่อ Platform ของแคมเปญได้เฉพาะตอนที่ Platform นั้นมีกลุ่มเดียว
// เพราะ platform_budgets คือผลรวมงบของทุกกลุ่มใน Platform นั้น ถ้ามีหลายกลุ่ม ยอดนั้นไม่ใช่งบของกลุ่มนี้ (หารแล้วค่าตัวเกินจริง)
export function feeBudgetFor(project, g, platform) {
    const own = budgetFor(g, platform);
    if (own > 0) return own;
    // กลุ่มมีงบของตัวเองใน Platform อื่นอยู่แล้ว (เช่นข้อมูลเก่าที่เกลี่ยงบกลุ่มลงบางบล็อก) — Platform นี้ถือว่าไม่มีงบ
    // ห้ามถอยไปใช้งบรวมของ Platform เพราะข้อมูลเก่าเก็บงบกลุ่มซ้ำไว้ใน platform_budgets ด้วย จะนับซ้ำ
    if (blocksBudget(toBlocks(g)) > 0) return 0;
    const sharing = ((project && project.ad_groups) || []).filter(x => groupPlatforms(x).includes(platform));
    if (sharing.length !== 1 || sharing[0].key !== g.key) return 0;
    return Number(((project && project.platform_budgets) || {})[platform]) || 0;
}

// คลิปที่ค่าแอดถึงเกณฑ์และมียอดวิวแล้ว แต่ยังไม่ล็อกผล — ใส่ค่าตัว > 0 เมื่อไร ผลคุ้ม/ไม่คุ้มจะล็อกทันทีและแก้ย้อนหลังไม่ได้
// เงื่อนไขต้องตรงกับ maybeStamp ใน server/src/store/logic.js · at = เกณฑ์ของแบรนด์ (ตัวเรียกหาจาก stampAtFor)
export const locksOnFee = (s, next, at = AD_STAMP_AT) => !!s && !s.perf_stamp && next > 0
    && (Number(s.ad_spend) || 0) >= (Number(at) || AD_STAMP_AT) && (Number(s.views) || 0) > 0;

// แถว (คลิป) ที่หาร/ล้างได้ = กลุ่มนี้ + Platform นี้ ที่ไม่ได้ถูก "ไม่เลือก"
export function feeEligible(subs, g, platform) {
    return (subs || []).filter(s => s.group_key === g.key && s.platform === platform && s.status !== 'rejected');
}

// คำนวณแผนของ 1 Platform — ใช้ทั้งทำตัวอย่างและสร้างรายการที่จะส่ง
function planFor(project, group, platform, subs, mode, overwrite) {
    const isClear = mode === 'clear';
    const budget = feeBudgetFor(project, group, platform);
    const quota = quotaOf(group, platform);
    const clips = clipCountFor(group, platform);
    const divisor = quota * clips;
    const perClip = (!isClear && budget > 0 && divisor > 0) ? Math.round(budget / divisor) : 0;
    const to = isClear ? 0 : perClip;
    const rows = feeEligible(subs, group, platform);

    let targets = [];
    if (isClear) targets = rows.filter(s => feeOf(s) > 0);
    else if (perClip > 0) targets = rows.filter(s => (overwrite ? feeOf(s) !== perClip : feeOf(s) <= 0));

    const changed = new Set(targets.map(s => s.id));
    // ตัวอย่างแสดงเป็น "คน" — คลิปของคนเดียวกันรวมเป็นแถวเดียว
    const people = new Map();
    targets.forEach(s => {
        const key = personKeyOf(s);
        if (!people.has(key)) {
            people.set(key, { key, name: s.account_name, olds: [], clips: 0, all: rows.filter(r => personKeyOf(r) === key).length });
        }
        const p = people.get(key);
        p.olds.push(feeOf(s));
        p.clips += 1;
    });

    return {
        platform, budget, quota, clips, divisor, perClip, to, rows,
        items: targets.map(s => ({ sub_id: s.id, budget: to, from: feeOf(s) })),
        people: [...people.values()],
        totalAfter: rows.reduce((n, s) => n + (changed.has(s.id) ? to : feeOf(s)), 0),
        clearedSum: isClear ? targets.reduce((n, s) => n + feeOf(s), 0) : 0,
        overwritten: isClear ? 0 : targets.filter(s => feeOf(s) > 0).length,
        kept: isClear ? 0 : rows.filter(s => !changed.has(s.id) && feeOf(s) > 0).length,
        // ปัดเป็นบาทเต็มแล้ว ถ้าครบโควตาทุกคลิป ยอดรวมจะต่างจากงบเท่านี้ (+ = เกิน, − = ขาด)
        rounding: perClip > 0 ? perClip * divisor - budget : 0
    };
}

// ค่าตัวเดิมของคนหนึ่ง — คลิปเท่ากันโชว์ยอดเดียว ไม่เท่ากันโชว์เป็นช่วง
function oldText(olds) {
    const min = Math.min(...olds), max = Math.max(...olds);
    return min === max ? baht(min) : `${baht(min)}–${baht(max)}`;
}

function PlanBlock({ plan: pl, mode, overwrite }) {
    const isClear = mode === 'clear';
    let note = null;
    if (!isClear && pl.budget <= 0) note = 'กลุ่มนี้ยังไม่ได้ตั้งงบของ Platform นี้ — ตั้งงบที่ฟอร์มแคมเปญก่อน แล้วค่อยหาร';
    else if (!isClear && pl.divisor <= 0) note = 'Platform นี้ยังไม่ได้ตั้งจำนวน KOL (โควตา) — หารไม่ได้ ข้ามไป';
    else if (pl.rows.length === 0) note = 'ยังไม่มีรายชื่อใน Platform นี้';
    else if (pl.items.length === 0) {
        note = isClear ? 'ไม่มีค่าตัวให้ล้าง'
            : overwrite ? 'ทุกคลิปเท่ากับยอดเฉลี่ยอยู่แล้ว'
                : 'ทุกคนใส่ค่าตัวแล้ว — ถ้าจะให้เท่ากันหมด เลือก "ทับทุกคนให้เท่ากัน"';
    }
    const showCalc = !isClear && pl.budget > 0 && pl.divisor > 0;
    return (
        <div className="fee-plan">
            <div className="fee-plan-head">
                <span className="adg-plat">📱 {pl.platform}</span>
                {showCalc && (
                    <span className="fee-plan-calc">
                        งบ {baht(pl.budget)} ÷ ({pl.quota} คน × {pl.clips} คลิป) = <b>{baht(pl.perClip)}/คลิป</b>
                    </span>
                )}
            </div>
            {note && <div className="fee-plan-note">{note}</div>}
            {pl.people.length > 0 && (
                <div className="fee-preview-scroll">
                    <table className="fee-preview">
                        <thead><tr>
                            <th>ชื่อ Account</th><th className="num">คลิป</th><th className="num">ค่าตัว/คลิป เดิม → ใหม่</th>
                        </tr></thead>
                        <tbody>
                            {pl.people.map(p => (
                                <tr key={p.key}>
                                    <td title={p.name}>{p.name}</td>
                                    <td className="num">{p.clips === p.all ? p.clips : `${p.clips}/${p.all}`}</td>
                                    <td className="num">
                                        <span className="fee-old">{oldText(p.olds)}</span> → <b className={'fee-new' + (isClear ? ' clear' : '')}>{baht(pl.to)}</b>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {pl.items.length > 0 && (
                <div className="fee-plan-sum">
                    {isClear ? (
                        <span>ล้าง {pl.items.length} คลิป · ค่าตัวที่ใส่ไว้รวม {baht(pl.clearedSum)} จะกลายเป็น ฿0</span>
                    ) : <>
                        <span>
                            รวมค่าตัวหลังบันทึก <b>{baht(pl.totalAfter)}</b> จากงบ {baht(pl.budget)}
                            {pl.totalAfter > pl.budget && <span className="warn"> · เกินงบ {baht(pl.totalAfter - pl.budget)}</span>}
                        </span>
                        {pl.rounding !== 0 && (
                            <span className="muted">
                                ปัดเป็นบาทเต็ม — ครบโควตา {pl.divisor} คลิปจะรวม {baht(pl.perClip * pl.divisor)}
                                {' '}({pl.rounding > 0 ? 'เกิน' : 'ขาด'}งบ {baht(Math.abs(pl.rounding))})
                            </span>
                        )}
                        {pl.rows.length > pl.divisor && (
                            <span className="warn">ตอนนี้มีรายชื่อ {pl.rows.length} คลิป มากกว่าโควตา {pl.divisor} คลิป</span>
                        )}
                        {pl.kept > 0 && <span className="muted">ข้าม {pl.kept} คลิปที่ใส่ค่าตัวไว้แล้ว</span>}
                    </>}
                </div>
            )}
        </div>
    );
}

export default function DivideFeesModal({ projectId, project, group, groupNo, platforms = [], filtered = false, mode, submissions, onClose, onReload, onDone }) {
    const isClear = mode === 'clear';
    const [overwrite, setOverwrite] = useState(false);
    // ติ๊กยืนยัน = ยืนยันรายการชุดที่เห็นตอนติ๊ก (เก็บลายเซ็นรายการไว้) — รายการเปลี่ยนเมื่อไร ติ๊กหลุดทันทีในรอบ render เดียวกัน
    const [confirmedSig, setConfirmedSig] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // กด Esc ปิดได้ (ยกเว้นระหว่างบันทึก)
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape' && !saving) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [saving, onClose]);

    // คำนวณใหม่ทุกครั้งที่รายชื่อโหลดซ้ำ — ตัวอย่างและค่า from จะตรงกับข้อมูลล่าสุดเสมอ
    const plans = platforms.map(p => planFor(project, group, p, submissions, mode, overwrite));
    const items = plans.flatMap(pl => pl.items);
    const overwritten = plans.reduce((n, pl) => n + pl.overwritten, 0);
    // ล้างค่าตัว และ "ทับทุกคน" ต้องติ๊กยืนยันก่อนเสมอ — ทั้งสองอย่างเปลี่ยนค่าที่คนใส่ไว้แล้ว
    const needConfirm = items.length > 0 && (isClear || overwrite);
    const tooMany = items.length > MAX_ITEMS;
    // รายชื่อโหลดใหม่ทุก 20 วิ — ถ้ารายการที่จะเปลี่ยนไม่เหมือนตอนติ๊กยืนยัน ต้องยืนยันใหม่
    // ไม่งั้นอาจล้าง/ทับค่าตัวของคนที่เพิ่งถูกเพิ่มหรือแก้ ซึ่งยังไม่ได้ดูในตัวอย่าง
    const itemsSig = items.map(i => `${i.sub_id}:${i.budget}:${i.from}`).join('|');
    const confirmed = confirmedSig !== null && confirmedSig === itemsSig;

    async function submit() {
        if (!items.length || saving || tooMany) return;
        if (needConfirm && !confirmed) return;
        // คลิปที่บันทึกแล้วจะล็อกผลคุ้ม/ไม่คุ้มทันที — ถามยืนยันก่อน เพราะแก้ย้อนหลังไม่ได้
        const at = stampAtFor(project && project.brand);
        const locking = items.filter(it => locksOnFee(submissions.find(x => x.id === it.sub_id), it.budget, at)).length;
        if (locking > 0 && !window.confirm(`ค่าแอดของ ${locking} คลิปถึงเกณฑ์แล้ว — บันทึกค่าตัวแล้วผลคุ้ม/ไม่คุ้มของคลิปเหล่านี้จะล็อกทันทีและแก้ย้อนหลังไม่ได้\nยืนยันบันทึก?`)) return;
        setSaving(true); setError('');
        try {
            await api(`/projects/${projectId}/fees`, { method: 'PUT', body: { items, reason: isClear ? 'clear' : 'divide' } });
            onDone();
        } catch (err) {
            if (err.status === 409) {
                // มีคนแก้ค่าตัวระหว่างเปิดหน้าต่างนี้ — โหลดใหม่ ให้ดูตัวอย่างอีกรอบก่อนกดซ้ำ
                setError('มีคนแก้ค่าตัวไปแล้วระหว่างนี้ — โหลดข้อมูลล่าสุดให้แล้ว ตรวจตัวอย่างอีกครั้งก่อนกดบันทึก');
                setConfirmedSig(null);
                if (onReload) onReload();
            } else {
                setError(err.message);
            }
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop fee-modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
            <div className="modal fee-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{isClear ? 'ล้างค่าตัว' : 'หารค่าตัวเฉลี่ยเท่ากัน'} · กลุ่มที่ {groupNo}</h3>
                    <button type="button" className="modal-x" onClick={onClose} disabled={saving} aria-label="ปิด">×</button>
                </div>
                <p className="fee-modal-sub">
                    {platforms.length ? <>Platform: <b>{platforms.join(' · ')}</b>{filtered && ' (ตามตัวกรอง Platform ที่เลือกอยู่)'}</> : 'กลุ่มนี้ยังไม่ได้เลือก Platform'}
                    {' · '}ไม่นับคนที่ "ไม่เลือก"
                    {isClear ? ' · ค่าตัวที่ใส่ไว้จะกลายเป็น ฿0' : ' · ยอดต่อคลิป = งบ ÷ (โควตาคน × คลิปต่อคน)'}
                </p>

                {!isClear && (
                    <div className="fee-mode" role="radiogroup" aria-label="วิธีหาร">
                        <label className={'fee-mode-opt' + (!overwrite ? ' on' : '')}>
                            <input type="radio" name="fee-divide-mode" checked={!overwrite}
                                onChange={() => { setOverwrite(false); setConfirmedSig(null); }} />
                            <span><b>เติมเฉพาะคนที่ยังไม่ใส่ค่าตัว</b><small>คนที่ใส่ไว้แล้วไม่ถูกแตะ (แนะนำ)</small></span>
                        </label>
                        <label className={'fee-mode-opt' + (overwrite ? ' on' : '')}>
                            <input type="radio" name="fee-divide-mode" checked={overwrite}
                                onChange={() => { setOverwrite(true); setConfirmedSig(null); }} />
                            <span><b>ทับทุกคนให้เท่ากัน</b><small>ค่าตัวที่ใส่ไว้แล้วจะถูกเปลี่ยนเป็นยอดเฉลี่ย</small></span>
                        </label>
                    </div>
                )}

                {plans.map(pl => <PlanBlock key={pl.platform} plan={pl} mode={mode} overwrite={overwrite} />)}

                {needConfirm && (
                    <label className="fee-confirm">
                        <input type="checkbox" checked={confirmed} onChange={e => setConfirmedSig(e.target.checked ? itemsSig : null)} />
                        <span>
                            {isClear
                                ? `ยืนยันล้างค่าตัว ${items.length} คลิป ให้เป็น ฿0`
                                : `ยืนยันทับค่าตัว — มี ${overwritten} คลิปที่ใส่ไว้แล้วจะถูกเปลี่ยนเป็นยอดเฉลี่ย`}
                        </span>
                    </label>
                )}
                {tooMany && <div className="alert-error">รายการเยอะเกิน {MAX_ITEMS} คลิปต่อครั้ง — เลือกตัวกรอง Platform ทีละอันก่อนแล้วค่อยทำ</div>}
                {error && <div className="alert-error">{error}</div>}

                <div className="modal-actions fee-modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button type="button" className={(isClear ? 'btn-danger' : 'btn-primary') + ' fee-modal-go'}
                        onClick={submit} disabled={!items.length || saving || tooMany || (needConfirm && !confirmed)}>
                        {saving ? 'กำลังบันทึก...'
                            : !items.length ? 'ไม่มีอะไรต้องเปลี่ยน'
                                : isClear ? `ล้างค่าตัว ${items.length} คลิป` : `บันทึก ${items.length} คลิป`}
                    </button>
                </div>
            </div>
        </div>
    );
}
