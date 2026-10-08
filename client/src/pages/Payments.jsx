import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, openFile } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Avatar from '../components/Avatar.jsx';
import PayCyclePicker from '../components/PayCyclePicker.jsx';
import { fmtDate } from '../utils/date.js';
import { BRANDS } from '../data/brands.js';
import { conceptOneLine } from '../data/adGroups.js';
import { ProductSummary } from '../components/ProductChips.jsx';
import { AUTO_PAY_BY, dayAfter, hasInvoice, inPendingTab, pendingState, todayTH } from '../data/payAuto.js';

const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH');

// งบของงานจ้างอื่น ๆ แยกตามความคืบหน้า (มาจาก server: hire_breakdown) — โชว์เฉพาะก้อนที่มียอด
function HireSplit({ split }) {
    const parts = [
        ['agreed', 'ตกลงแล้ว (จ่ายได้)', split.agreed],
        ['pending', 'รอตกลง / รอยืนยันคิว', split.pending],
        ['unfilled', 'ยังหาคนไม่ได้', split.unfilled]
    ].filter(p => Number(p[2]) > 0);
    if (!parts.length) return null;
    return (
        <div className="hire-split">
            {parts.map(([k, label, v]) => (
                <span key={k} className={'hire-split-' + k}>{label} {baht(v)}</span>
            ))}
        </div>
    );
}

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// '2026-09-15' -> '15 ก.ย. 2026'
function fmtDateTh(d) {
    if (!d) return "—";
    const [y, m, day] = String(d).slice(0, 10).split('-');
    if (!y || !m || !day) return String(d);
    return Number(day) + ' ' + (TH_MON[Number(m) - 1] || m) + ' ' + y;
}


// ช่องอัปโหลด/ดูไฟล์ (ใบเสนอราคา หรือ ใบแจ้งหนี้ — อยู่ที่แคมเปญ ออกทีเดียวทั้งงาน)
function FileSlot({ label, uploadPath, viewPath, meta, onUploaded, compact, link, onSaveLink, onUploadFile, onDeleteFile }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState(link || '');
    const [done, setDone] = useState(false);
    useEffect(() => { setUrl(link || ''); }, [link]);

    async function saveLink() {
        setBusy(true);
        try { await onSaveLink(url.trim()); setDone(true); }
        catch (err) { alert(err.message); }
        finally { setBusy(false); }
    }

    async function handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        setBusy(true);
        try {
            // onUploadFile = พ่อแม่จัดการเอง (เช่น ต้องสร้างงวดก่อนถึงจะรู้ปลายทาง)
            if (onUploadFile) await onUploadFile(file);
            else {
                const res = await uploadFile(uploadPath, file);
                onUploaded(res.data);
            }
        } catch (err) { alert(err.message); }
        finally { setBusy(false); e.target.value = ''; }
    }

    async function view() {
        try { await openFile(viewPath); }
        catch (err) { alert(err.message); }
    }

    return (
        <div className={'file-slot' + (compact ? ' compact' : '')}>
            {label && <div className="file-slot-label">{label}</div>}
            <div className="fs-row">
                {meta ? (
                    <div className="file-has">
                        <button className="file-view" onClick={view} title="เปิดดูไฟล์">
                            <Icon name="file" size={15} /> <span className="file-name">{meta.original}</span>
                        </button>
                        <button className="icon-btn" title="เปลี่ยนไฟล์" onClick={() => inputRef.current.click()} disabled={busy}>
                            <Icon name="upload" size={15} />
                        </button>
                        {onDeleteFile && (
                            <button className="icon-btn danger" title="ลบไฟล์นี้" disabled={busy}
                                onClick={async () => {
                                    if (!confirm('ลบไฟล์นี้ออกจากระบบ?' + String.fromCharCode(10) + meta.original)) return;
                                    setBusy(true);
                                    try { await onDeleteFile(); } catch (err) { alert(err.message); }
                                    finally { setBusy(false); }
                                }}>
                                <Icon name="trash" size={15} />
                            </button>
                        )}
                    </div>
                ) : (
                    <button className="file-upload-btn" onClick={() => inputRef.current.click()} disabled={busy}>
                        <Icon name="upload" size={15} /> {busy ? 'กำลังอัปโหลด...' : 'อัปโหลดไฟล์'}
                    </button>
                )}
                {/* ใส่เป็นลิงก์แทนก็ได้ (เอกสารอยู่ Drive/Dropbox) */}
                {onSaveLink && (
                    <div className="fs-link">
                        <input type="url" value={url} placeholder="หรือวางลิงก์เอกสาร https://..."
                            onChange={e => { setUrl(e.target.value); setDone(false); }} />
                        {url !== (link || '') && (
                            <button className="btn-primary fs-link-save" onClick={saveLink} disabled={busy}>บันทึก</button>
                        )}
                        {done && <span className="fs-link-ok">✓</span>}
                        {link && url === link && (
                            <>
                                <a className="brief-link" href={link} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> เปิด</a>
                                <button className="icon-btn danger" title="ลบลิงก์นี้" disabled={busy}
                                    onClick={async () => {
                                        if (!confirm('ลบลิงก์นี้ออก?')) return;
                                        setBusy(true);
                                        try { await onSaveLink(''); setUrl(''); }
                                        catch (err) { alert(err.message); }
                                        finally { setBusy(false); }
                                    }}>
                                    <Icon name="trash" size={14} />
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
            <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleFile} />
        </div>
    );
}

// ===================== แท็บ 1: งวดรอทำจ่าย =====================
// ทำจ่ายอัตโนมัติ (ผู้ใช้สั่ง 8 ต.ค. 2026): ขึ้นเฉพาะงวดที่แนบใบแจ้งหนี้แล้ว · ดูอย่างเดียว ไม่ต้องกดสร้างรอบ
// เลยวันทำจ่าย 1 วัน ระบบย้ายไปแท็บรอบที่จ่ายแล้วเอง (1 วัน + 1 เอเจนซี่ = สลิป 1 ใบ) — กติกาอยู่ที่ data/payAuto.js + server
// จัดตาม "วันทำจ่าย" ก่อน แล้วค่อยแยกเอเจนซี่ · งวดที่พักไว้ (ยกเลิกรอบแล้ว) อยู่บนสุด · ยังไม่ตั้งวัน อยู่ท้ายสุด
const STATE_ICON = { waiting: '⏳', moving: '➜', nodate: '•', hold: '⏸' };
const STATE_TIP = {
    waiting: 'รอถึงวัน — เลยวันทำจ่าย 1 วัน ระบบย้ายเป็นจ่ายแล้วเอง',
    moving: 'เลยวันทำจ่ายแล้ว — ระบบกำลังย้ายไปรอบที่จ่ายแล้ว',
    nodate: 'ยังไม่ตั้งวันทำจ่าย — ระบบยังไม่ย้ายเอง',
    hold: 'ยกเลิกรอบแล้ว พักไว้ — ระบบไม่นับจ่ายจนกว่าจะกดนับจ่ายใหม่ หรือแก้วันทำจ่าย'
};

function PendingTab({ items, today, onChanged }) {
    const [busyId, setBusyId] = useState(null);
    // งวดที่พักไว้: นับจ่ายใหม่ด้วยวันเดิม (เลยวันแล้ว = ระบบย้ายเป็นจ่ายแล้วทันทีที่ตรวจรอบถัดไป)
    async function release(i) {
        if (!window.confirm('นับงวดนี้ว่าจ่ายแล้วอีกครั้ง (วันทำจ่ายเดิม ' + fmtDateTh(i.due_date) + ')?'
            + '\nระบบจะย้ายไปแท็บรอบที่จ่ายแล้วให้เอง · ถ้าจะเลื่อนวัน ให้แก้วันทำจ่ายในแท็บแคมเปญ / ตั้งงวดแทน')) return;
        setBusyId(i.id);
        try { await api(`/payments/installments/${i.id}`, { method: 'PUT', body: { release: true } }); if (onChanged) onChanged(); }
        catch (err) { alert(err.message); }
        finally { setBusyId(null); }
    }
    if (!items.length) {
        return (
            <div className="panel empty-state">
                <div className="empty-emoji">✅</div>
                <p>ไม่มีงวดรอทำจ่ายตามตัวกรองที่เลือก</p>
                <p className="muted" style={{ fontSize: 12.5 }}>งวดจะขึ้นที่นี่เมื่อแนบใบแจ้งหนี้ในแท็บแคมเปญ / ตั้งงวดแล้ว</p>
            </div>
        );
    }

    // ชั้น: บล็อก (พักไว้ / วันทำจ่าย / ยังไม่ตั้งวัน) -> เอเจนซี่ -> งวด
    const blocks = {};
    items.forEach(i => {
        const st = pendingState(i, today);
        const k = st === 'hold' ? '0|hold' : st === 'nodate' ? '2|nodate' : '1|' + String(i.due_date).slice(0, 10);
        const a = i.agency || '— ยังไม่ระบุเอเจนซี่ —';
        blocks[k] = blocks[k] || {};
        (blocks[k][a] = blocks[k][a] || []).push(i);
    });
    const keys = Object.keys(blocks).sort();
    const sumOf = list => list.reduce((s, i) => s + (Number(i.amount) || 0), 0);

    return (
        <>
            {keys.map(k => {
                const [, d] = k.split('|');
                const groups = blocks[k];
                const all = Object.values(groups).flat();
                const agencies = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th'));
                const late = d !== 'hold' && d !== 'nodate' && d < today;
                return (
                    <div className="due-block" key={k}>
                        <div className="due-head">
                            <span className="due-date">
                                {d === 'hold' ? '⏸ พักไว้ — ยกเลิกรอบแล้ว'
                                    : d === 'nodate' ? '📅 ยังไม่ตั้งวันทำจ่าย'
                                    : '📅 วันทำจ่าย ' + fmtDateTh(d)}
                            </span>
                            {d === 'hold' ? (
                                <span className="due-move hold">ไม่นับจ่ายอัตโนมัติ · กด "นับจ่ายใหม่" หรือแก้วันทำจ่ายในแท็บแคมเปญ / ตั้งงวด</span>
                            ) : d === 'nodate' ? (
                                <span className="due-move hold">ระบบยังไม่ย้ายเอง · ตั้งวันในแท็บแคมเปญ / ตั้งงวด</span>
                            ) : late ? (
                                <span className="due-move late">เลยวันแล้ว · กำลังย้ายไปรอบที่จ่ายแล้ว</span>
                            ) : (
                                <span className="due-move">ย้ายเป็นจ่ายแล้วอัตโนมัติ {fmtDateTh(dayAfter(d))}</span>
                            )}
                            <span className="due-sum">{all.length} งวด · <b>{baht(sumOf(all))}</b></span>
                        </div>

                        {agencies.map(name => {
                            const list = groups[name];
                            return (
                                <div className="inst-group" key={name}>
                                    <div className="inst-group-head">
                                        <span className="inst-agency"><Icon name="users" size={15} /> {name}</span>
                                        <span className="inst-group-sum">{list.length} งวด · <b>{baht(sumOf(list))}</b></span>
                                    </div>
                                    <div className="inst-rows">
                                        {list.map(i => {
                                            const st = pendingState(i, today);
                                            return (
                                                <div className={'inst-row st-' + st} key={i.id} title={STATE_TIP[st]}>
                                                    <span className="inst-state" aria-label={STATE_TIP[st]}>{STATE_ICON[st]}</span>
                                                    <span className="inst-project">
                                                        {i.brand && <span className="inst-brand">{i.brand}</span>}
                                                        {i.project_name}
                                                        {i.group_no && (
                                                            <span className="inst-grp" title={conceptOneLine(i.group_concept)}>
                                                                กลุ่ม {i.group_no}{i.group_concept ? ' · ' + conceptOneLine(i.group_concept) : ''}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="inst-no">งวด {i.no}/{i.of}</span>
                                                    <span className="inst-pct">{i.percent}%</span>
                                                    <span className="inst-amt">{baht(i.amount)}</span>
                                                    <span className="inst-due">
                                                        {st === 'hold' && <span className="inst-old-due">เดิม {fmtDateTh(i.due_date)}</span>}
                                                        <span className="inv-chip ok" title={i.invoice ? 'แนบไฟล์แล้ว: ' + i.invoice.original : (i.invoice_link || '')}>
                                                            🧾 มีใบแจ้งหนี้
                                                        </span>
                                                        {st === 'hold' && (
                                                            <button type="button" className="btn-ghost plan-release" disabled={busyId === i.id}
                                                                onClick={() => release(i)}>นับจ่ายใหม่</button>
                                                        )}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </>
    );
}

// ยกเลิกรอบ = ย้อนรายการเงิน ต้องบอกเหตุผลไว้ในประวัติเสมอ
function CancelBatchModal({ b, onClose, onDone }) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const today = todayTH();
    const items = b.items || [];
    const noInv = items.filter(i => !hasInvoice(i));
    const held = items.filter(i => hasInvoice(i) && i.due_date && String(i.due_date).slice(0, 10) < today);
    const back = items.filter(i => hasInvoice(i) && !held.includes(i));
    async function go() {
        if (!reason.trim()) return;
        setSaving(true);
        try {
            await api(`/payments/batches/${b.id}?reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' });
            onDone();
        } catch (err) { alert(err.message); setSaving(false); }
    }
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="draft-head"><div className="draft-name">↩ ยกเลิกรอบทำจ่าย</div></div>
                <div className="batch-items">
                    <div className="batch-item"><span>เอเจนซี่</span><b>{b.agency || '-'}</b></div>
                    <div className="batch-item"><span>วันที่จ่าย</span><b>{b.pay_date ? fmtDateTh(b.pay_date) : '-'}</b></div>
                    <div className="batch-item total"><span>ยอดที่จะย้อนกลับ</span><b>{baht(b.total)}</b></div>
                </div>
                {/* ทำจ่ายอัตโนมัติ (8 ต.ค. 2026): บอกตามจริงว่างวดแต่ละแบบไปไหน — กติกาเดียวกับ remove() ฝั่ง server */}
                <p className="dash-section-sub" style={{ margin: '12px 0' }}>
                    งวดทั้ง {b.item_count} งวดไม่หายไปไหน
                    {back.length > 0 && <> · <b>{back.length}</b> งวดกลับไปแท็บรอทำจ่าย</>}
                    {noInv.length > 0 && <> · <b>{noInv.length}</b> งวดยังไม่มีใบแจ้งหนี้ กลับไปอยู่แท็บแคมเปญ / ตั้งงวด</>}
                    {b.slip ? ' · สลิปที่แนบไว้จะถูกลบไปพร้อมรอบนี้' : ''}
                </p>
                {held.length > 0 && (
                    <div className="pay-auto-note warn">
                        <b>{held.length}</b> งวดเลยวันทำจ่ายแล้ว จะถูก<b>พักไว้</b> (ระบบไม่นับจ่ายซ้ำ) — ถ้าจะให้นับใหม่ กด "นับจ่ายใหม่"
                        ในแท็บรอทำจ่าย หรือแก้วันทำจ่ายในแท็บแคมเปญ / ตั้งงวด
                    </div>
                )}
                <div className="field">
                    <label>หมายเหตุ: ยกเลิกเพราะอะไร *</label>
                    <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                        placeholder="เช่น โอนผิดยอด / เลื่อนรอบจ่าย / เอเจนซี่ขอแก้ใบแจ้งหนี้" />
                    <span className="cpw-hint">บันทึกไว้ในประวัติการแก้ไข ตรวจย้อนหลังได้</span>
                </div>
                <div className="modal-actions">
                    <button className="btn-ghost" onClick={onClose} disabled={saving}>ไม่ยกเลิกแล้ว</button>
                    <button className="btn-primary" onClick={go} disabled={!reason.trim() || saving}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิกรอบ'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ===================== แท็บ 2: รอบที่จ่ายแล้ว =====================
function BatchCard({ b, onChanged }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);

    async function handleSlip(e) {
        const file = e.target.files[0];
        if (!file) return;
        setBusy(true);
        try { await uploadFile(`/payments/batches/${b.id}/slip`, file); onChanged(); }
        catch (err) { alert(err.message); }
        finally { setBusy(false); e.target.value = ''; }
    }

    const [asking, setAsking] = useState(false);   // เปิดหน้าถามเหตุผลก่อนยกเลิก

    return (
        <div className="batch-card">
            <div className="batch-card-head">
                <div>
                    <div className="batch-agency">
                        <Icon name="users" size={15} /> {b.agency || '—'}
                        {b.created_by === AUTO_PAY_BY && (
                            <span className="batch-auto" title="ระบบย้ายเป็นจ่ายแล้วเอง เพราะเลยวันทำจ่ายมาแล้ว 1 วัน">อัตโนมัติ</span>
                        )}
                    </div>
                    <div className="batch-meta">
                        {b.pay_date ? '📅 ' + fmtDate(b.pay_date) : <span className="muted">ยังไม่ระบุวันจ่าย</span>}
                        <span> · {b.item_count} งวด</span>
                        {b.note && <span> · {b.note}</span>}
                    </div>
                </div>
                <div className="batch-total">{baht(b.total)}</div>
            </div>

            <div className="batch-card-foot">
                {b.slip ? (
                    <button className="file-view" onClick={() => openFile(`/payments/batches/${b.id}/slip`).catch(e => alert(e.message))}>
                        <Icon name="file" size={15} /> <span className="file-name">{b.slip.original}</span>
                    </button>
                ) : (
                    <button className="file-upload-btn" onClick={() => inputRef.current.click()} disabled={busy}>
                        <Icon name="upload" size={15} /> {busy ? 'กำลังอัปโหลด...' : 'แนบสลิป'}
                    </button>
                )}
                <div className="batch-btns">
                    <button className="btn-ghost" onClick={() => setOpen(o => !o)}>{open ? 'ย่อ' : 'ดูงวดในรอบนี้'}</button>
                    <button className="alp-del" title="ยกเลิกรอบ" onClick={() => setAsking(true)}><Icon name="trash" size={15} /></button>
                </div>
                <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleSlip} />
            </div>

            {asking && <CancelBatchModal b={b} onClose={() => setAsking(false)} onDone={onChanged} />}

            {open && (
                <div className="batch-items">
                    {b.items.map(i => (
                        <div className="batch-item" key={i.id}>
                            <span>
                                {i.brand && <span className="inst-brand">{i.brand}</span>}
                                {i.project_name}
                                {i.group_no && <span className="inst-grp">กลุ่ม {i.group_no}</span>}
                                <span className="muted">งวด {i.no}/{i.of} · {i.percent}%</span>
                            </span>
                            <b>{baht(i.amount)}</b>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ===================== แท็บ 3: แคมเปญ (ตั้งงวด + เอกสาร) =====================
function CampaignCard({ row, onOpen }) {
    const planned = Number(row.planned_amount) || 0;
    const paid = Number(row.paid_amount) || 0;
    const pct = planned > 0 ? Math.round((paid / planned) * 100) : 0;
    // KOL รายคนที่ได้ฟรี (ค่าตัว 0 ทุกคลิป · งบ 0) — ไม่มีอะไรต้องจ่าย ไม่ใช่ "ยังไม่ตั้งงวด"
    const free = row.campaign_type === 'solo' && !(Number(row.budget) > 0) && planned === 0;
    const state = free ? 'free' : planned === 0 ? 'none' : paid >= planned ? 'done' : 'part';
    const settled = state === 'done' || state === 'free';
    const invTotal = (row.installments || []).length;
    const invDone = (row.installments || []).filter(i => i.invoice || i.invoice_link).length;
    // แผนรวมมากกว่างบ = สัญญาณว่ามีแผนซ้อนกัน (ทั้งแคมเปญ + รายกลุ่ม)
    const overPlan = planned > 0 && Number(row.budget) > 0 && planned > Number(row.budget);
    return (
        <div className="pcard" onClick={onOpen}>
            <div className={'pcard-accent payacc-' + (settled ? 'pay-done' : 'pay-wait')} />
            <div className="pcard-body">
                <div className="pcard-head">
                    <span className={'status ' + (settled ? 'pay-done' : 'pay-wait')}>
                        {state === 'free' ? 'ได้ฟรี' : state === 'none' ? 'ยังไม่ตั้งงวด' : state === 'done' ? 'จ่ายครบแล้ว' : 'จ่ายแล้ว ' + pct + '%'}
                    </span>
                    {row.campaign_type === 'solo' && <span className="solo-badge" title="จ้าง KOL เดี่ยว (ไม่มีแคมเปญ) — ผู้รับเงิน = Agency ที่ระบุ หรือตัว KOL">KOL รายคน</span>}
                    {overPlan && (
                        <span className="status pay-pending" title="ผลรวมของแผนมากกว่างบแคมเปญ — อาจตั้งแผนทั้งแคมเปญซ้อนกับรายกลุ่ม">
                            ⚠ แผนเกินงบ
                        </span>
                    )}
                </div>
                {row.brand && <span className="pcard-brand">{row.brand}</span>}
                <h3 className="pcard-name">{row.project_name}</h3>
                <div className="pcard-sub">
                    <span>🏢 {row.agencies && row.agencies.length ? row.agencies.join(', ') : <span className="muted">ยังไม่มีเอเจนซี่</span>}</span>
                    {/* สินค้าในแคมเปญ — ดูได้ตั้งแต่การ์ด ไม่ต้องเปิดเข้าไปดูทีละใบ (งานจ้างอื่น ๆ ไม่มีสินค้า จึงไม่ขึ้นบรรทัดนี้) */}
                    {/* กดปุ่ม "+N" ดูสินค้าทั้งหมดได้ โดยไม่เผลอเปิดหน้าต่างตั้งงวด (ทั้งการ์ดกดแล้วเปิดอยู่) */}
                    {row.products && row.products.length > 0 && (
                        <span className="pcard-prods" onClick={e => e.stopPropagation()}>📦 <ProductSummary value={row.products} max={4} /></span>
                    )}
                </div>
                {planned > 0 && (
                    <div className="pay-progress">
                        <div className="pay-progress-bar"><div style={{ width: pct + '%' }} /></div>
                        <div className="pay-progress-txt">{baht(paid)} / {baht(planned)}</div>
                    </div>
                )}
                <div className="pcard-foot">
                    <div>
                        <div className="pcard-budget-val">{free ? 'ได้ฟรี' : baht(row.budget)}</div>
                        <div className="pcard-budget-lbl">{row.hire_breakdown ? 'งบงานจ้าง' : row.campaign_type === 'solo' ? 'ค่าตัว KOL' : 'งบแคมเปญ'}</div>
                        {/* งานจ้างอื่น ๆ: งบรวมงบของคนที่ยังไม่ตกลง/ยังหาไม่ได้ — แยกให้เห็นก่อนตั้งงวด */}
                        {row.hire_breakdown && <HireSplit split={row.hire_breakdown} />}
                    </div>
                    <div className="pay-docs">
                        <span className={row.quotation || row.quotation_link ? 'doc-ok' : 'doc-no'}>📄 เสนอราคา</span>
                        <span className={invTotal > 0 && invDone === invTotal ? 'doc-ok' : 'doc-no'}>
                            🧾 แจ้งหนี้ {invTotal > 0 ? invDone + "/" + invTotal : ""}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ตัวแก้แผนงวด
// ทำจ่ายอัตโนมัติ (8 ต.ค. 2026): แนบใบแจ้งหนี้ให้งวดที่รอจ่ายและเลยวันทำจ่ายแล้ว = ระบบนับว่าจ่ายแล้วทันที — ถามก่อน
// งวดที่จ่ายแล้ว / พักไว้ (เปลี่ยนไฟล์ใบแจ้งหนี้) ไม่ถูกนับจ่ายเพิ่ม จึงไม่ต้องถาม
function okToAttachLate(due, status = 'pending') {
    const d = String(due || '').slice(0, 10);
    if (status === 'paid' || status === 'hold' || !d || d >= todayTH()) return true;
    return window.confirm('งวดนี้เลยวันทำจ่ายแล้ว (' + fmtDateTh(d) + ')\nแนบใบแจ้งหนี้แล้วระบบจะนับว่าจ่ายแล้วทันที (ย้ายไปแท็บรอบที่จ่ายแล้ว)'
        + '\n\nถ้ายังไม่ได้จ่ายจริง ให้แก้วันทำจ่ายแล้วบันทึกก่อน — แนบต่อเลยไหม?');
}

// บันทึกแผนทั้งชุด: งวดที่มีใบแจ้งหนี้ + วันทำจ่ายผ่านมาแล้ว = ระบบนับจ่ายทันที · งวดที่พักไว้ = กลับมานับตามวันที่ตั้ง — ถามก่อน
function okToSavePlan(plan, saved) {
    const today = todayTH();
    const late = plan.filter((x, i) => saved[i] && saved[i].status !== 'paid' && hasInvoice(saved[i])
        && x.due_date && String(x.due_date).slice(0, 10) < today).length;
    const held = saved.filter((s, i) => i < plan.length && s.status === 'hold').length;
    if (!late && !held) return true;
    const lines = [];
    if (late) lines.push(late + ' งวดมีใบแจ้งหนี้และวันทำจ่ายผ่านมาแล้ว → ระบบจะนับว่าจ่ายแล้วทันที');
    if (held) lines.push(held + ' งวดที่พักไว้ (ยกเลิกรอบแล้ว) จะกลับมานับตามวันทำจ่ายที่ตั้ง');
    return window.confirm(lines.join('\n') + '\n\nบันทึกแผนเลยไหม?');
}

// แถว "วันที่ทำจ่าย" ของการ์ดงวด (ใช้ทั้งแผนของแคมเปญและรายการนอกแคมเปญ)
// งวดจ่ายแล้ว = โชว์วันเฉย ๆ · แผนถูกล็อก (มีงวดอื่นจ่ายแล้ว) ยังแก้วันของงวดที่ยังไม่จ่ายทีละงวดได้ (บันทึกวัน)
// งวดที่พักไว้ (ยกเลิกรอบแล้ว) = นับจ่ายใหม่ด้วยวันเดิม หรือแก้วันแล้วบันทึก → กลับไปรอตามกติกาอัตโนมัติ
function DueDateRow({ x, it, locked, onChange, onReload }) {
    const [busy, setBusy] = useState(false);
    // ค่าล่าสุดที่บันทึกแล้ว — หน้าต่างรายการนอกแคมเปญไม่ได้รับงวดใหม่หลังโหลดซ้ำ จึงจำไว้เอง
    const [cur, setCur] = useState(it ? { due: it.due_date || '', status: it.status } : null);
    useEffect(() => { setCur(it ? { due: it.due_date || '', status: it.status } : null); }, [it && it.id, it && it.due_date, it && it.status]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (it && cur && cur.status === 'paid') {
        return (
            <div className="plan-card-row">
                <span className="plan-card-lbl">วันที่ทำจ่าย</span>
                <span>{fmtDateTh(cur.due)}</span>
                <span className="plan-st paid">✓ จ่ายแล้ว</span>
            </div>
        );
    }
    const changed = !!(it && cur && locked && String(x.due_date || '') !== String(cur.due || ''));
    async function put(body, next, ask) {
        if (ask && !window.confirm(ask)) return;
        setBusy(true);
        try {
            await api(`/payments/installments/${it.id}`, { method: 'PUT', body });
            setCur(next);
            if (onReload) await onReload();
        } catch (err) { alert(err.message); }
        finally { setBusy(false); }
    }
    return (
        <div className="plan-card-row">
            <span className="plan-card-lbl">วันที่ทำจ่าย</span>
            <DatePicker value={x.due_date} onChange={onChange} />
            {changed && (
                <button type="button" className="btn-primary fs-link-save" disabled={busy}
                    onClick={() => put({ due_date: x.due_date || null }, { due: x.due_date || '', status: 'pending' },
                        // วันที่ผ่านมาแล้ว + มีใบแจ้งหนี้ = ระบบนับว่าจ่ายแล้วทันที
                        x.due_date && String(x.due_date).slice(0, 10) < todayTH() && hasInvoice(it)
                            ? 'วันที่เลือก (' + fmtDateTh(x.due_date) + ') ผ่านมาแล้ว และงวดนี้มีใบแจ้งหนี้\nบันทึกแล้วระบบจะนับว่าจ่ายแล้วทันที — บันทึกเลยไหม?'
                            : null)}>
                    บันทึกวัน
                </button>
            )}
            {cur && cur.status === 'hold' && (
                <>
                    <span className="plan-st hold" title="ยกเลิกรอบแล้ว — ระบบไม่นับจ่ายจนกว่าจะกดนับจ่ายใหม่หรือแก้วันทำจ่าย">⏸ พักไว้</span>
                    {!changed && (
                        <button type="button" className="btn-ghost plan-release" disabled={busy}
                            onClick={() => put({ release: true }, { ...cur, status: 'pending' },
                                'นับงวดนี้ว่าจ่ายแล้วอีกครั้ง (วันทำจ่ายเดิม ' + fmtDateTh(cur.due) + ')?\nระบบจะย้ายไปแท็บรอบที่จ่ายแล้วให้เอง · ถ้าจะเลื่อนวัน ให้เลือกวันใหม่แล้วกด "บันทึกวัน" แทน')}>
                            นับจ่ายใหม่ (วันเดิม)
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

function PlanModal({ row, onClose, onSaved, onReload }) {
    const groups = row.ad_groups || [];
    // แผนการจ่ายแยกตาม (เอเจนซี่ + กลุ่ม) — ฐานคิด % คืองบของกลุ่มนั้น ไม่ใช่งบทั้งแคมเปญ
    // '' = ยังไม่เลือก · ALL = ทั้งแคมเปญ · อื่น ๆ = key ของกลุ่ม
    const ALL = '__ALL__';
    const saved0 = row.installments || [];
    const hasPlan = gk => saved0.some(i => (i.group_key || '') === gk);
    // ตั้งแผนไว้แล้วก็เปิดชุดนั้นขึ้นมาเลย (เรียงตามลำดับใน dropdown)
    // ยังไม่เคยตั้ง -> ค่าว่าง ให้เลือกเองว่าจะตั้งของก้อนไหน จะได้ไม่เผลอตั้งผิด
    const plannedGroup = groups.find(g => hasPlan(g.key));
    const firstGroup = groups.length === 0
        ? ALL
        : (hasPlan('') ? ALL : (plannedGroup ? plannedGroup.key : ''));
    const [groupKey, setGroupKey] = useState(firstGroup);
    const curGroup = groups.find(g => g.key === groupKey) || null;
    const noGroupPicked = groupKey === '';        // ยังไม่เลือก = ยังตั้งแผนไม่ได้
    const budget = curGroup ? (Number(curGroup.budget) || 0) : (Number(row.budget) || 0);
    const agencyOpts = curGroup
        ? (curGroup.agencies || [])
        : (row.agencies || []);
    // งบของกลุ่มที่ระบุ (ไม่ระบุ = งบทั้งแคมเปญ)
    const budgetOf = gk => {
        const g = groups.find(x => x.key === gk);
        return g ? (Number(g.budget) || 0) : (Number(row.budget) || 0);
    };
    // แปลงค่าใน dropdown -> group_key ที่เก็บจริง (ALL/ว่าง = null คือทั้งแคมเปญ)
    const asKey = gk => (gk && gk !== ALL ? gk : '');
    // ต้องรับฐานงบเข้ามาตรง ๆ — ตอนสลับกลุ่ม state ยังเป็นค่าเก่า ถ้าอ่านจาก budget จะคิดผิดกลุ่ม
    // เศษที่หารไม่ลงตัวยกไปงวดสุดท้าย ไม่งั้น 3 งวดจะรวมได้ 399,999 แทนที่จะเป็น 400,000
    const blankFor = (n, base) => {
        const pct = Math.floor(100 / n);
        const amt = Math.floor(base / n);
        return Array.from({ length: n }, (_, i) => (i === n - 1
            ? { percent: 100 - pct * (n - 1), amount: base - amt * (n - 1), due_date: '' }
            : { percent: pct, amount: amt, due_date: '' }));
    };
    const blank = n => blankFor(n, budget);
    const planOf = (name, gk) => {
        const its = (row.installments || []).filter(i => i.agency === name && (i.group_key || '') === asKey(gk));
        return its.length
            ? its.map(i => ({ percent: i.percent, amount: i.amount, due_date: i.due_date || '' }))
            : blankFor(2, budgetOf(asKey(gk)));
    };

    // เจ้าของแผนที่เปิดอยู่ ถ้ายังไม่มีแผนค่อยใช้เจ้าแรกในรายการ
    const firstAgency = (saved0.find(i => (i.group_key || '') === asKey(firstGroup)) || {}).agency
        || agencyOpts[0] || '';
    const [agency, setAgency] = useState(firstAgency);
    const [plan, setPlan] = useState(planOf(firstAgency, firstGroup));
    const [saving, setSaving] = useState(false);

    const mineHere = i => i.agency === agency && (i.group_key || '') === asKey(groupKey);
    const locked = (row.installments || []).some(i => mineHere(i) && i.status === 'paid');
    // แถวในตารางด้านบนยังเป็นแค่ร่าง — ใบแจ้งหนี้ต้องผูกกับงวดที่บันทึกแล้วเท่านั้น
    const saved = (row.installments || []).filter(mineHere).sort((a, b) => a.no - b.no);

    function pickAgency(name) { setAgency(name); setPlan(planOf(name, groupKey)); }
    // เปลี่ยนกลุ่ม = เปลี่ยนทั้งฐานงบ รายชื่อเอเจนซี่ และแผนที่เคยตั้งไว้ของกลุ่มนั้น
    function pickGroup(gk) {
        setGroupKey(gk);
        const g = groups.find(x => x.key === gk) || null;
        const opts = g ? (g.agencies || []) : (row.agencies || []);
        const a = opts.includes(agency) ? agency : (opts[0] || '');
        setAgency(a);
        setPlan(planOf(a, gk));
    }

    // แก้ % แล้วคิดยอดให้อัตโนมัติ · แก้ยอดเองได้ ไม่ไปยุ่งกับ %
    const setRow = (idx, k, v) => setPlan(p => p.map((x, i) => {
        if (i !== idx) return x;
        if (k === 'percent') return { ...x, percent: v, amount: Math.round(budget * (Number(v) || 0) / 100) };
        return { ...x, [k]: v };
    }));

    const sumPct = plan.reduce((s, x) => s + (Number(x.percent) || 0), 0);
    const sumAmt = plan.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    // แนบใบแจ้งหนี้ก่อนกดบันทึกแผนได้ — ถ้ายังไม่มีงวดจริง บันทึกแผนให้เงียบ ๆ ก่อนแล้วค่อยแนบ
    async function ensureInstallment(idx) {
        if (saved[idx]) return saved[idx];
        if (noGroupPicked) throw new Error('เลือกกลุ่มที่จะทำจ่ายก่อน');
        if (!agency) throw new Error('ยังไม่มีเอเจนซี่ — เลือกเอเจนซี่ก่อนถึงจะแนบเอกสารได้');
        // บันทึกแผนให้เองก็ต้องถามแบบเดียวกับปุ่มบันทึก (งวดพักไว้ / วันผ่านไปแล้ว = นับจ่ายทันที)
        if (!okToSavePlan(plan, saved)) throw new Error('ยังไม่ได้แนบ — ยังไม่ได้บันทึกแผน');
        const res = await api(`/payments/${row.project_id}/plan`, {
            method: 'PUT', body: { agency, group_key: asKey(groupKey) || null, plan }
        });
        const it = (res.data || [])[idx];
        if (!it) throw new Error('บันทึกแผนไม่สำเร็จ');
        return it;
    }
    // วันที่ server ใช้ตัดสิน = วันของงวดที่บันทึกแล้ว (ยังไม่เคยบันทึก = วันในฟอร์ม ซึ่งจะถูกบันทึกพร้อมแผน)
    const dueOf = idx => (saved[idx] ? saved[idx].due_date : (plan[idx] || {}).due_date);
    const statusOf = idx => (saved[idx] ? saved[idx].status : 'pending');
    async function attachInvoiceFile(idx, file) {
        if (!okToAttachLate(dueOf(idx), statusOf(idx))) return;
        const it = await ensureInstallment(idx);
        await uploadFile(`/payments/installments/${it.id}/invoice`, file);
        if (onReload) await onReload();
    }
    async function attachInvoiceLink(idx, v) {
        if (v && !okToAttachLate(dueOf(idx), statusOf(idx))) throw new Error('ยังไม่ได้บันทึกลิงก์ใบแจ้งหนี้');
        const it = await ensureInstallment(idx);
        await api(`/payments/installments/${it.id}/invoice-link`, { method: 'PUT', body: { link: v || null } });
        if (onReload) await onReload();
    }

    async function save() {
        if (!agency) { alert('ยังไม่มีเอเจนซี่ในแคมเปญนี้ — สร้างลิงก์เอเจนซี่ในหน้าแคมเปญก่อน'); return; }
        if (!okToSavePlan(plan, saved)) return;
        setSaving(true);
        try {
            await api(`/payments/${row.project_id}/plan`, { method: 'PUT', body: { agency, group_key: asKey(groupKey) || null, plan } });
            onSaved();
        } catch (err) { alert(err.message); setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <div className="pay-head-left">
                        <Avatar name={row.brand || row.project_name} size={44} icon={<Icon name="wallet" size={20} />} />
                        <div>
                            <div className="pay-project">{row.project_name}</div>
                            <div className="pay-sub">
                                {row.brand && <span className="cat-chip">{row.brand}</span>}
                                {row.campaign_type === 'solo' && <span className="solo-badge" style={{ marginLeft: 6 }}>KOL รายคน</span>}
                                <span className="muted"> · ฐานคิดยอด {baht(budget)}{curGroup ? " (กลุ่มนี้)" : " (ทั้งแคมเปญ)"}</span>
                            </div>
                            {row.hire_breakdown && (Number(row.hire_breakdown.pending) > 0 || Number(row.hire_breakdown.unfilled) > 0) && (
                                <div className="hire-split-note">
                                    งบนี้รวมคนที่ยังไม่ตกลง/ยังหาไม่ได้ด้วย — ยอดที่ตกลงแล้วจริง {baht(row.hire_breakdown.agreed)}
                                    <HireSplit split={row.hire_breakdown} />
                                </div>
                            )}
                        </div>
                    </div>
                    <button className="modal-x" onClick={onClose}>×</button>
                </div>

                <div className="plan-box">
                    {groups.length > 0 && (
                        <div className="field">
                            <label>กลุ่มที่จะทำจ่าย</label>
                            <select value={groupKey} onChange={e => pickGroup(e.target.value)}>
                                <option value="">— เลือกกลุ่มทำจ่าย —</option>
                                <option value={ALL}>{hasPlan('') ? '✓ ' : ''}ทั้งแคมเปญ · งบ {baht(Number(row.budget) || 0)}</option>
                                {groups.map((g, i) => (
                                    <option key={g.key} value={g.key}>
                                        {hasPlan(g.key) ? '✓ ' : ''}กลุ่มที่ {i + 1}{g.concept ? " · " + conceptOneLine(g.concept) : ""} · งบ {baht(g.budget)}
                                    </option>
                                ))}
                            </select>
                            {noGroupPicked && <p className="alp-hint">เลือกก่อนว่าจะตั้งแผนของกลุ่มไหน หรือจ่ายรวมทั้งแคมเปญ</p>}
                        </div>
                    )}
                    {noGroupPicked ? (
                        <div className="plan-empty">
                            👆 เลือกกลุ่มที่จะทำจ่ายด้านบนก่อน แล้วตารางแบ่งงวดกับช่องใบแจ้งหนี้จะขึ้นตรงนี้
                        </div>
                    ) : (<>
                    <div className="field-row">
                        <div className="field">
                            <label>เอเจนซี่</label>
                            {agencyOpts.length ? (
                                <select value={agency} onChange={e => pickAgency(e.target.value)}>
                                    {agencyOpts.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                            ) : <div className="perf-readonly">{curGroup ? 'ยังไม่มีเอเจนซี่รับผิดชอบกลุ่มนี้' : 'ยังไม่มีเอเจนซี่ — สร้างลิงก์ในหน้าแคมเปญก่อน'}</div>}
                        </div>
                        <div className="field">
                            <label>แบ่งเป็นกี่งวด</label>
                            <select value={plan.length} onChange={e => setPlan(blank(Number(e.target.value)))} disabled={locked}>
                                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} งวด</option>)}
                            </select>
                        </div>
                    </div>

                    {locked && (
                        <div className="alert-error" style={{ marginTop: 4 }}>
                            เจ้านี้มีงวดที่ทำจ่ายไปแล้ว แก้ยอด/จำนวนงวดไม่ได้ — ต้องยกเลิกรอบทำจ่ายนั้นก่อน
                            · งวดที่ยังไม่จ่ายแก้วันทำจ่ายได้ทีละงวด (กด "บันทึกวัน")
                        </div>
                    )}

                    {/* ใบเสนอราคาออกทีเดียวทั้งงาน จึงอยู่เหนือรายการงวด */}
                    <div className="pay-files">
                        <FileSlot label="ใบเสนอราคา (ทั้งแคมเปญ)"
                            uploadPath={`/payments/${row.project_id}/upload/quotation`}
                            viewPath={`/payments/${row.project_id}/file/quotation`}
                            meta={row.quotation} onUploaded={() => onReload && onReload()}
                            onDeleteFile={async () => {
                                await api(`/payments/${row.project_id}/file/quotation`, { method: 'DELETE' });
                                if (onReload) await onReload();
                            }}
                            link={row.quotation_link}
                            onSaveLink={async v => {
                                await api(`/payments/${row.project_id}`, { method: 'PUT', body: { quotation_link: v || null } });
                                if (onReload) await onReload();
                            }} />
                    </div>

                    {/* 1 งวด = 1 การ์ด: ยอด -> ใบแจ้งหนี้ของงวดนั้น -> วันที่ทำจ่าย */}
                    <div className="plan-cards">
                        {plan.map((x, i) => {
                            const it = saved[i] || null;
                            return (
                                <div className="plan-card" key={i}>
                                    <div className="plan-card-head">
                                        <span className="plan-no">งวด {i + 1}/{plan.length}</span>
                                        <label className="plan-f">
                                            <span>%</span>
                                            <input type="number" min="0" max="100" value={x.percent} disabled={locked}
                                                onChange={e => setRow(i, 'percent', e.target.value)} />
                                        </label>
                                        <label className="plan-f wide">
                                            <span>ยอด (฿)</span>
                                            <input type="number" min="0" value={x.amount} disabled={locked}
                                                onChange={e => setRow(i, 'amount', e.target.value)} />
                                        </label>
                                    </div>
                                    <div className="plan-card-row">
                                        <span className="plan-card-lbl">ใบแจ้งหนี้</span>
                                        <FileSlot compact
                                            viewPath={it ? `/payments/installments/${it.id}/invoice` : null}
                                            meta={it && it.invoice}
                                            link={it && it.invoice_link}
                                            onUploadFile={file => attachInvoiceFile(i, file)}
                                            onSaveLink={v => attachInvoiceLink(i, v)}
                                            onDeleteFile={it ? async () => {
                                                await api(`/payments/installments/${it.id}/invoice`, { method: 'DELETE' });
                                                if (onReload) await onReload();
                                            } : null} />
                                    </div>
                                    <DueDateRow x={x} it={it} locked={locked} onChange={v => setRow(i, 'due_date', v)} onReload={onReload} />
                                </div>
                            );
                        })}
                        <div className="plan-sum">
                            <span>รวมทุกงวด</span>
                            <span className={sumPct === 100 ? '' : 'plan-warn'}>{sumPct}%</span>
                            <span className={sumAmt === budget ? '' : 'plan-warn'}>{baht(sumAmt)}</span>
                            <span className="muted">{sumAmt !== budget && budget > 0 ? 'งบ ' + baht(budget) : ''}</span>
                        </div>
                    </div>
                    <p className="alp-hint">ยอดคิดจาก % ของงบให้อัตโนมัติ แก้ตัวเลขทับได้ · แผนที่ยังไม่เคยบันทึก แนบใบแจ้งหนี้ได้เลย ระบบบันทึกแผนให้เอง (แผนที่บันทึกแล้ว แก้ยอด/วันแล้วกดบันทึกก่อนแนบ)</p>
                    <p className="alp-hint">🧾 งวดที่แนบใบแจ้งหนี้แล้วขึ้นแท็บรอทำจ่ายทันที · เลยวันที่ทำจ่าย 1 วัน ระบบย้ายเป็นจ่ายแล้วให้เอง</p>
                    </>)}
                </div>

                <div className="modal-actions">
                    {saved.length > 0 && !locked && (
                        <button type="button" className="btn-ghost danger" onClick={async () => {
                            if (!confirm('ลบแผนการจ่ายชุดนี้ทั้งหมด ' + saved.length + ' งวด?')) return;
                            try {
                                await api(`/payments/${row.project_id}/plan?agency=${encodeURIComponent(agency)}&group_key=${encodeURIComponent(asKey(groupKey))}`, { method: 'DELETE' });
                                onSaved();
                            } catch (err) { alert(err.message); }
                        }}>
                            <Icon name="trash" size={15} /> ลบแผนนี้
                        </button>
                    )}
                    <button className="btn-ghost" onClick={onClose}>ปิด</button>
                    <button className="btn-primary" onClick={save} disabled={saving || locked || !agency || noGroupPicked}
                        title={noGroupPicked ? 'เลือกกลุ่มที่จะทำจ่ายก่อน' : undefined}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกแผนการจ่าย'}
                    </button>
                </div>
            </div>
        </div>
    );
}


// ===================== รายการจ่ายนอกแคมเปญ (ตั้งงวดเอง) =====================
// ใช้ตอนมีงานที่ไม่ได้เปิดเป็นแคมเปญในระบบ แต่ยังต้องทำจ่ายให้เอเจนซี่
function ManualModal({ item, agencies, manuals, onClose, onSaved, onReload }) {
    const [manualId, setManualId] = useState((item && item.manual_id) || null);
    // ข้อมูลล่าสุดหลังโหลดซ้ำ (สถานะงวดเปลี่ยนได้จากระบบอัตโนมัติ / รายการใหม่ที่เพิ่งถูกบันทึกตอนแนบเอกสาร)
    const live = (manualId && (manuals || []).find(m => m.manual_id === manualId)) || item;
    const saved0 = (live && live.installments) || [];
    const [title, setTitle] = useState((item && item.title) || '');
    const [agency, setAgency] = useState((item && item.agency) || agencies[0] || '');
    const [freeAgency, setFreeAgency] = useState(!!(item && item.agency && !agencies.includes(item.agency)));
    const [total, setTotal] = useState(item ? String(item.planned_amount || '') : '');
    const [plan, setPlan] = useState(saved0.length
        ? saved0.map(i => ({ percent: i.percent, amount: i.amount, due_date: i.due_date || '' }))
        : [{ percent: 100, amount: '', due_date: '' }]);
    const [saving, setSaving] = useState(false);

    const locked = saved0.some(i => i.status === 'paid');
    const saved = saved0.slice().sort((a, b) => a.no - b.no);

    // แบ่งงวดจากยอดรวมที่กรอก — เศษยกไปงวดสุดท้าย
    const splitBy = n => {
        const base = Number(String(total).replace(/[^0-9]/g, '')) || 0;
        const pct = Math.floor(100 / n);
        const amt = Math.floor(base / n);
        setPlan(Array.from({ length: n }, (_, i) => (i === n - 1
            ? { percent: 100 - pct * (n - 1), amount: base - amt * (n - 1), due_date: '' }
            : { percent: pct, amount: amt, due_date: '' })));
    };
    const setRow = (idx, k, v) => setPlan(p => p.map((x, i) => {
        if (i !== idx) return x;
        if (k === 'percent') {
            const base = Number(String(total).replace(/[^0-9]/g, '')) || 0;
            return { ...x, percent: v, amount: Math.round(base * (Number(v) || 0) / 100) };
        }
        return { ...x, [k]: v };
    }));

    const sumAmt = plan.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const canSave = title.trim() && agency && plan.length > 0 && !locked;

    async function persist() {
        const res = await api('/payments/manual', {
            method: 'PUT',
            body: { manual_id: manualId, title: title.trim(), agency, plan }
        });
        setManualId(res.data.manual_id);
        return res.data.installments;
    }
    async function save() {
        if (!canSave) return;
        if (!okToSavePlan(plan, saved)) return;
        setSaving(true);
        try { await persist(); onSaved(); }
        catch (err) { alert(err.message); setSaving(false); }
    }
    // แนบเอกสารก่อนกดบันทึกได้ — บันทึกให้เงียบ ๆ ก่อนแล้วค่อยแนบ
    async function ensure(idx) {
        if (saved[idx]) return saved[idx];
        if (!title.trim() || !agency) throw new Error('ใส่ชื่อรายการกับเอเจนซี่ก่อนถึงจะแนบเอกสารได้');
        if (!okToSavePlan(plan, saved)) throw new Error('ยังไม่ได้แนบ — ยังไม่ได้บันทึกรายการ');
        const rows = await persist();
        if (!rows[idx]) throw new Error('บันทึกไม่สำเร็จ');
        return rows[idx];
    }
    const dueOf = idx => (saved[idx] ? saved[idx].due_date : (plan[idx] || {}).due_date);
    const statusOf = idx => (saved[idx] ? saved[idx].status : 'pending');
    async function attachFile(idx, file) {
        if (!okToAttachLate(dueOf(idx), statusOf(idx))) return;
        const it = await ensure(idx);
        await uploadFile(`/payments/installments/${it.id}/invoice`, file);
        if (onReload) await onReload();
    }
    async function attachLink(idx, v) {
        if (v && !okToAttachLate(dueOf(idx), statusOf(idx))) throw new Error('ยังไม่ได้บันทึกลิงก์ใบแจ้งหนี้');
        const it = await ensure(idx);
        await api(`/payments/installments/${it.id}/invoice-link`, { method: 'PUT', body: { link: v || null } });
        if (onReload) await onReload();
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="draft-head">
                    <div className="draft-name">🧾 {item ? 'แก้ไขรายการจ่ายนอกแคมเปญ' : 'ตั้งงวดเอง (ไม่ผูกกับแคมเปญ)'}</div>
                </div>

                <div className="plan-box">
                    <div className="field">
                        <label>ชื่อรายการ *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} disabled={locked}
                            placeholder="เช่น ค่าโปรดักชันงาน Event ก.ย." autoFocus />
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>เอเจนซี่ *</label>
                            {freeAgency || !agencies.length ? (
                                <input value={agency} onChange={e => setAgency(e.target.value)} disabled={locked}
                                    placeholder="พิมพ์ชื่อเอเจนซี่" />
                            ) : (
                                <select value={agency} onChange={e => {
                                    if (e.target.value === '__FREE__') { setFreeAgency(true); setAgency(''); }
                                    else setAgency(e.target.value);
                                }} disabled={locked}>
                                    {agencies.map(a => <option key={a} value={a}>{a}</option>)}
                                    <option value="__FREE__">พิมพ์ชื่อเอง...</option>
                                </select>
                            )}
                        </div>
                        <div className="field">
                            <label>ยอดรวม (฿)</label>
                            <input type="number" min="0" value={total} disabled={locked}
                                onChange={e => setTotal(e.target.value)} placeholder="เช่น 500000" />
                        </div>
                        <div className="field">
                            <label>แบ่งเป็นกี่งวด</label>
                            <select value={plan.length} onChange={e => splitBy(Number(e.target.value))} disabled={locked}>
                                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} งวด</option>)}
                            </select>
                        </div>
                    </div>

                    {locked && (
                        <div className="alert-error" style={{ marginTop: 4 }}>
                            รายการนี้มีงวดที่ทำจ่ายไปแล้ว แก้ยอด/จำนวนงวดไม่ได้ — ต้องยกเลิกรอบทำจ่ายนั้นก่อน
                            · งวดที่ยังไม่จ่ายแก้วันทำจ่ายได้ทีละงวด (กด "บันทึกวัน")
                        </div>
                    )}

                    <div className="plan-cards">
                        {plan.map((x, i) => {
                            const it = saved[i] || null;
                            return (
                                <div className="plan-card" key={i}>
                                    <div className="plan-card-head">
                                        <span className="plan-no">งวด {i + 1}/{plan.length}</span>
                                        <label className="plan-f">
                                            <span>%</span>
                                            <input type="number" min="0" max="100" value={x.percent} disabled={locked}
                                                onChange={e => setRow(i, 'percent', e.target.value)} />
                                        </label>
                                        <label className="plan-f wide">
                                            <span>ยอด (฿)</span>
                                            <input type="number" min="0" value={x.amount} disabled={locked}
                                                onChange={e => setRow(i, 'amount', e.target.value)} />
                                        </label>
                                    </div>
                                    <div className="plan-card-row">
                                        <span className="plan-card-lbl">ใบแจ้งหนี้</span>
                                        <FileSlot compact
                                            viewPath={it ? `/payments/installments/${it.id}/invoice` : null}
                                            meta={it && it.invoice}
                                            link={it && it.invoice_link}
                                            onUploadFile={file => attachFile(i, file)}
                                            onSaveLink={v => attachLink(i, v)}
                                            onDeleteFile={it ? async () => {
                                                await api(`/payments/installments/${it.id}/invoice`, { method: 'DELETE' });
                                                if (onReload) await onReload();
                                            } : null} />
                                    </div>
                                    <DueDateRow x={x} it={it} locked={locked} onChange={v => setRow(i, 'due_date', v)} onReload={onReload} />
                                </div>
                            );
                        })}
                        <div className="plan-sum">
                            <span>รวมทุกงวด</span>
                            <span>{baht(sumAmt)}</span>
                        </div>
                    </div>
                    <p className="alp-hint">งวดที่แนบใบแจ้งหนี้แล้วจะขึ้นแท็บรอทำจ่ายเหมือนงวดของแคมเปญ · เลยวันที่ทำจ่าย 1 วัน ระบบย้ายเป็นจ่ายแล้วให้เอง (รวมสลิปใบเดียวกับงานอื่นของเอเจนซี่เจ้าเดียวกันในวันเดียวกัน)</p>
                </div>

                <div className="modal-actions">
                    {item && !locked && (
                        <button type="button" className="btn-ghost danger" onClick={async () => {
                            if (!confirm('ลบรายการ "' + item.title + '" ทั้งหมด ' + saved.length + ' งวด?')) return;
                            try { await api(`/payments/manual/${item.manual_id}`, { method: 'DELETE' }); onSaved(); }
                            catch (err) { alert(err.message); }
                        }}>
                            <Icon name="trash" size={15} /> ลบรายการนี้
                        </button>
                    )}
                    <button className="btn-ghost" onClick={onClose}>ปิด</button>
                    <button className="btn-primary" onClick={save} disabled={!canSave || saving}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// การ์ดรายการนอกแคมเปญ
function ManualCard({ item, onOpen }) {
    const planned = Number(item.planned_amount) || 0;
    const paid = Number(item.paid_amount) || 0;
    const pct = planned > 0 ? Math.round((paid / planned) * 100) : 0;
    const done = planned > 0 && paid >= planned;
    const invTotal = item.installments.length;
    const invDone = item.installments.filter(i => i.invoice || i.invoice_link).length;
    return (
        <div className="pcard" onClick={onOpen}>
            <div className={'pcard-accent payacc-' + (done ? 'pay-done' : 'pay-wait')} />
            <div className="pcard-body">
                <div className="pcard-head">
                    <span className={'status ' + (done ? 'pay-done' : 'pay-wait')}>
                        {done ? 'จ่ายครบแล้ว' : 'จ่ายแล้ว ' + pct + '%'}
                    </span>
                    <span className="cat-chip">นอกแคมเปญ</span>
                </div>
                <h3 className="pcard-name">{item.title}</h3>
                <div className="pcard-sub"><span>🏢 {item.agency}</span></div>
                <div className="pay-progress">
                    <div className="pay-progress-bar"><div style={{ width: pct + '%' }} /></div>
                    <div className="pay-progress-txt">{baht(paid)} / {baht(planned)}</div>
                </div>
                <div className="pcard-foot">
                    <div>
                        <div className="pcard-budget-val">{baht(planned)}</div>
                        <div className="pcard-budget-lbl">ยอดรวม · {invTotal} งวด</div>
                    </div>
                    <div className="pay-docs">
                        <span className={invTotal > 0 && invDone === invTotal ? 'doc-ok' : 'doc-no'}>
                            🧾 แจ้งหนี้ {invDone}/{invTotal}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ===================== หน้าหลัก =====================
export default function Payments() {
    const [rows, setRows] = useState([]);        // แคมเปญ + สรุปงวด
    const [pending, setPending] = useState([]);  // งวดค้างจ่าย
    const [batches, setBatches] = useState([]);  // รอบที่จ่ายแล้ว
    const [manuals, setManuals] = useState([]);  // รายการจ่ายนอกแคมเปญ
    const [manualOpen, setManualOpen] = useState(null); // null = ปิด · 'new' = สร้างใหม่ · object = แก้ไข
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // เปิดมาที่แท็บตั้งงวดก่อน เพราะเป็นจุดเริ่มของงาน (ตั้งงวด -> รอทำจ่าย -> จ่ายแล้ว)
    const [tab, setTab] = useState('campaigns');   // campaigns | pending | batches
    const [brand, setBrand] = useState('');
    const [cycle, setCycle] = useState('');
    const [openId, setOpenId] = useState(null);

    function loadAll() {
        return Promise.all([
            api('/payments'),
            // ขอแยก 2 ครั้ง (pending / hold = ยกเลิกรอบแล้ว พักไว้) — server รุ่นก่อน (ยังไม่รีสตาร์ต) ไม่รู้จักแบบคั่น , แท็บจะได้ไม่ว่าง
            Promise.all([api('/payments/installments?status=pending'), api('/payments/installments?status=hold')])
                .then(([p, h]) => ({ data: [...(p.data || []), ...(h.data || [])] })),
            api('/payments/batches'),
            api('/payments/manual')
        ]).then(([a, b, c, d]) => {
            setRows(a.data); setPending(b.data); setBatches(c.data); setManuals(d.data);
        }).catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { loadAll(); }, []);

    function refresh() {
        setOpenId(null); setManualOpen(null);
        loadAll();
    }

    // ตัวกรองใช้ร่วมกันทุกแท็บ — งวดดูจากวันครบกำหนด รอบดูจากวันที่จ่าย
    const inCycle = d => !cycle || (!!d && (cycle.length === 10 ? d === cycle : d.startsWith(cycle)));
    // รอทำจ่าย = เฉพาะงวดที่แนบใบแจ้งหนี้แล้ว (ทำจ่ายอัตโนมัติ 8 ต.ค. 2026)
    const today = todayTH();
    const shownPending = pending.filter(i => inPendingTab(i) && (!brand || i.brand === brand) && inCycle(i.due_date));
    const shownBatches = batches.filter(b => (!brand || (b.items || []).some(i => i.brand === brand)) && inCycle(b.pay_date));
    const shownRows = rows.filter(r => !brand || r.brand === brand);

    const pendingTotal = shownPending.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const batchTotal = shownBatches.reduce((s, b) => s + (Number(b.total) || 0), 0);
    const countOf = b => rows.filter(r => r.brand === b).length;

    return (
        <div>
            <header className="page-head">
                <h1>รอบทำจ่ายเอเจนซี่</h1>
                <p className="page-sub">ตั้งงวด + แนบใบแจ้งหนี้ → ขึ้นรอทำจ่าย → เลยวันทำจ่าย 1 วัน ระบบย้ายเป็นจ่ายแล้วให้เอง (สลิป 1 ใบต่อเอเจนซี่ต่อวัน · เฉพาะผู้ดูแลระบบ)</p>
            </header>

            <div className="pay-tabs">
                <button className={'pay-tab' + (tab === 'campaigns' ? ' active' : '')} onClick={() => setTab('campaigns')}>
                    แคมเปญ / ตั้งงวด <span className="pay-tab-n">{shownRows.length}</span>
                </button>
                <button className={'pay-tab' + (tab === 'pending' ? ' active' : '')} onClick={() => setTab('pending')}>
                    รอทำจ่าย <span className="pay-tab-n">{shownPending.length}</span>
                </button>
                <button className={'pay-tab' + (tab === 'batches' ? ' active' : '')} onClick={() => setTab('batches')}>
                    รอบที่จ่ายแล้ว <span className="pay-tab-n">{shownBatches.length}</span>
                </button>
            </div>

            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                <label className="bud-month">
                    {tab === 'batches' ? 'วันที่จ่าย:' : 'วันทำจ่าย:'}
                    <PayCyclePicker value={cycle} onChange={setCycle} />
                </label>
            </div>

            <div className="brand-filter">
                <span className="brand-filter-label">▼ แบรนด์:</span>
                <button className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>
                    ทุกแบรนด์ ({rows.length})
                </button>
                {BRANDS.map(b => (
                    <button key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>
                        {b} ({countOf(b)})
                    </button>
                ))}
            </div>

            {tab === 'campaigns' && (
                <button type="button" className="alp-add-agency" onClick={() => setManualOpen('new')}>
                    <Icon name="plus" size={16} /> ตั้งงวดเอง (งานที่ไม่ได้เปิดเป็นแคมเปญ)
                </button>
            )}
            <div className="pay-summary">
                {tab === 'batches' ? (
                    <>
                        <span>แสดง <strong>{shownBatches.length}</strong> รอบ</span>
                        <span>จ่ายไปแล้วรวม <strong>{baht(batchTotal)}</strong></span>
                    </>
                ) : tab === 'pending' ? (
                    <>
                        <span>รอทำจ่าย <strong>{shownPending.length}</strong> งวด</span>
                        <span>ยอดรวม <strong>{baht(pendingTotal)}</strong></span>
                    </>
                ) : (
                    <>
                        <span>แสดง <strong>{shownRows.length}</strong> แคมเปญ</span>
                        <span>งบรวม <strong>{baht(shownRows.reduce((s, r) => s + (Number(r.budget) || 0), 0))}</strong></span>
                    </>
                )}
            </div>

            {error && <div className="alert-error">{error}</div>}

            {loading ? (
                <div className="panel"><p className="empty">กำลังโหลด...</p></div>
            ) : tab === 'pending' ? (
                <>
                    <div className="pay-auto-note">
                        🧾 งวดที่<b>แนบใบแจ้งหนี้แล้ว</b>ขึ้นที่นี่ทันที · <b>เลยวันทำจ่าย 1 วัน</b> ระบบย้ายไปแท็บรอบที่จ่ายแล้วให้เอง (แนบสลิปทีหลังได้)
                        · งวดที่ยังไม่แนบใบแจ้งหนี้ดูได้ในแท็บแคมเปญ / ตั้งงวด
                    </div>
                    <PendingTab items={shownPending} today={today} onChanged={refresh} />
                </>
            ) : tab === 'batches' ? (
                shownBatches.length === 0 ? (
                    <div className="panel empty-state">
                        <div className="empty-emoji">🧾</div>
                        <p>ยังไม่มีรอบทำจ่ายตามตัวกรองที่เลือก</p>
                    </div>
                ) : (
                    <div className="batch-list">
                        {shownBatches.map(b => <BatchCard key={b.id} b={b} onChanged={refresh} />)}
                    </div>
                )
            ) : (
                shownRows.length === 0 ? (
                    <div className="panel empty-state">
                        <div className="empty-emoji">💸</div>
                        <p>ไม่มีแคมเปญตามตัวกรองที่เลือก</p>
                    </div>
                ) : (
                    <>
                        <div className="card-grid">
                            {shownRows.map(r => <CampaignCard key={r.project_id} row={r} onOpen={() => setOpenId(r.project_id)} />)}
                            {manuals.map(m => <ManualCard key={m.manual_id} item={m} onOpen={() => setManualOpen(m)} />)}
                        </div>
                    </>
                )
            )}

            {manualOpen && (
                <ManualModal
                    item={manualOpen === 'new' ? null : manualOpen}
                    agencies={[...new Set(rows.flatMap(r => r.agencies || []))].sort((a, b) => a.localeCompare(b, 'th'))}
                    manuals={manuals}
                    onClose={() => setManualOpen(null)} onSaved={refresh} onReload={loadAll} />
            )}

            {openId != null && (
                <PlanModal row={rows.find(r => r.project_id === openId)}
                    onClose={() => setOpenId(null)} onSaved={refresh} onReload={loadAll} />
            )}
        </div>
    );
}
