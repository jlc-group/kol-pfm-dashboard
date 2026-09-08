import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, openFile } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Avatar from '../components/Avatar.jsx';
import PayCyclePicker from '../components/PayCyclePicker.jsx';
import { fmtDate } from '../utils/date.js';
import { BRANDS } from '../data/brands.js';

const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH');

// ช่องอัปโหลด/ดูไฟล์ (ใบเสนอราคา หรือ ใบแจ้งหนี้ — อยู่ที่แคมเปญ ออกทีเดียวทั้งงาน)
function FileSlot({ label, projectId, type, meta, onUploaded }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);

    async function handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        setBusy(true);
        try {
            const res = await uploadFile(`/payments/${projectId}/upload/${type}`, file);
            onUploaded(res.data);
        } catch (err) { alert(err.message); }
        finally { setBusy(false); e.target.value = ''; }
    }

    async function view() {
        try { await openFile(`/payments/${projectId}/file/${type}`); }
        catch (err) { alert(err.message); }
    }

    return (
        <div className="file-slot">
            <div className="file-slot-label">{label}</div>
            {meta ? (
                <div className="file-has">
                    <button className="file-view" onClick={view} title="เปิดดูไฟล์">
                        <Icon name="file" size={15} /> <span className="file-name">{meta.original}</span>
                    </button>
                    <button className="icon-btn" title="เปลี่ยนไฟล์" onClick={() => inputRef.current.click()} disabled={busy}>
                        <Icon name="upload" size={15} />
                    </button>
                </div>
            ) : (
                <button className="file-upload-btn" onClick={() => inputRef.current.click()} disabled={busy}>
                    <Icon name="upload" size={15} /> {busy ? 'กำลังอัปโหลด...' : 'อัปโหลด'}
                </button>
            )}
            <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleFile} />
        </div>
    );
}

// ===================== แท็บ 1: งวดค้างจ่าย =====================
// จัดกลุ่มตามเอเจนซี่ เพราะสลิป 1 ใบ = เอเจนซี่ 1 เจ้า
function PendingTab({ items, picked, setPicked, onMakeBatch }) {
    // เจ้าที่กำลังเลือกอยู่ — เลือกแล้วเจ้าอื่นติ๊กไม่ได้
    const lockedAgency = picked.length ? (items.find(i => i.id === picked[0]) || {}).agency : null;

    const byAgency = {};
    items.forEach(i => {
        const key = i.agency || '— ยังไม่ระบุเอเจนซี่ —';
        (byAgency[key] = byAgency[key] || []).push(i);
    });
    const agencies = Object.keys(byAgency).sort((a, b) => a.localeCompare(b, 'th'));

    if (!items.length) {
        return (
            <div className="panel empty-state">
                <div className="empty-emoji">✅</div>
                <p>ไม่มีงวดค้างจ่ายตามตัวกรองที่เลือก</p>
            </div>
        );
    }

    const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    const toggleAll = list => {
        const ids = list.map(i => i.id);
        const allOn = ids.every(id => picked.includes(id));
        setPicked(allOn ? picked.filter(id => !ids.includes(id)) : [...new Set([...picked, ...ids])]);
    };

    return (
        <>
            {agencies.map(name => {
                const list = byAgency[name];
                const sum = list.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                const blocked = lockedAgency && name !== lockedAgency;
                return (
                    <div className={'inst-group' + (blocked ? ' blocked' : '')} key={name}>
                        <div className="inst-group-head">
                            <input type="checkbox" disabled={blocked}
                                checked={list.every(i => picked.includes(i.id))}
                                onChange={() => toggleAll(list)} />
                            <span className="inst-agency"><Icon name="users" size={15} /> {name}</span>
                            <span className="inst-group-sum">ค้าง {list.length} งวด · <b>{baht(sum)}</b></span>
                            {blocked && <span className="inst-blocked-note">เลือกได้ทีละเอเจนซี่ (สลิป 1 ใบ = 1 เจ้า)</span>}
                        </div>
                        <div className="inst-rows">
                            {list.map(i => (
                                <label className={'inst-row' + (picked.includes(i.id) ? ' on' : '')} key={i.id}>
                                    <input type="checkbox" disabled={blocked}
                                        checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                                    <span className="inst-project">
                                        {i.brand && <span className="inst-brand">{i.brand}</span>}
                                        {i.project_name}
                                    </span>
                                    <span className="inst-no">งวด {i.no}/{i.of}</span>
                                    <span className="inst-pct">{i.percent}%</span>
                                    <span className="inst-amt">{baht(i.amount)}</span>
                                    <span className="inst-due">
                                        {i.due_date ? '📅 ' + fmtDate(i.due_date) : <span className="muted">ไม่กำหนดวัน</span>}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                );
            })}

            {picked.length > 0 && (
                <div className="inst-bar">
                    <div className="inst-bar-info">
                        <span className="inst-bar-agency">{lockedAgency}</span>
                        <span>เลือก <b>{picked.length}</b> งวด</span>
                        <span className="inst-bar-total">
                            รวม {baht(items.filter(i => picked.includes(i.id)).reduce((s, i) => s + (Number(i.amount) || 0), 0))}
                        </span>
                    </div>
                    <div className="inst-bar-actions">
                        <button className="btn-ghost" onClick={() => setPicked([])}>ล้างที่เลือก</button>
                        <button className="btn-primary" onClick={onMakeBatch}>
                            <Icon name="wallet" size={16} /> สร้างรอบทำจ่าย
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

// popup ยืนยันรอบทำจ่าย
function BatchModal({ agency, items, onClose, onDone }) {
    const [payDate, setPayDate] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

    async function save() {
        setSaving(true);
        try {
            await api('/payments/batches', {
                method: 'POST',
                body: { agency, pay_date: payDate || null, note: note || null, installment_ids: items.map(i => i.id) }
            });
            onDone();
        } catch (err) { alert(err.message); setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="draft-head"><div className="draft-name">💸 สร้างรอบทำจ่าย</div></div>
                <p className="dash-section-sub" style={{ marginBottom: 14 }}>
                    รอบนี้จะออกเป็นสลิป 1 ใบ ยอดเดียว โอนให้ <b>{agency}</b>
                </p>

                <div className="batch-items">
                    {items.map(i => (
                        <div className="batch-item" key={i.id}>
                            <span>{i.project_name} <span className="muted">งวด {i.no}/{i.of}</span></span>
                            <b>{baht(i.amount)}</b>
                        </div>
                    ))}
                    <div className="batch-item total">
                        <span>ยอดโอนรวม</span>
                        <b>{baht(total)}</b>
                    </div>
                </div>

                <div className="field">
                    <label>วันที่ทำจ่าย</label>
                    <DatePicker value={payDate} onChange={setPayDate} />
                </div>
                <div className="field">
                    <label>หมายเหตุ</label>
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น รอบ 25 ก.ย." />
                </div>

                <div className="modal-actions">
                    <button className="btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button className="btn-primary" onClick={save} disabled={saving}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : 'ยืนยันรอบทำจ่าย'}
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

    async function cancel() {
        if (!confirm(`ยกเลิกรอบทำจ่ายนี้?\nงวดทั้ง ${b.item_count} งวดจะกลับไปเป็นค้างจ่ายเหมือนเดิม`)) return;
        try { await api(`/payments/batches/${b.id}`, { method: 'DELETE' }); onChanged(); }
        catch (err) { alert(err.message); }
    }

    return (
        <div className="batch-card">
            <div className="batch-card-head">
                <div>
                    <div className="batch-agency"><Icon name="users" size={15} /> {b.agency || '—'}</div>
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
                    <button className="alp-del" title="ยกเลิกรอบ" onClick={cancel}><Icon name="trash" size={15} /></button>
                </div>
                <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleSlip} />
            </div>

            {open && (
                <div className="batch-items">
                    {b.items.map(i => (
                        <div className="batch-item" key={i.id}>
                            <span>
                                {i.brand && <span className="inst-brand">{i.brand}</span>}
                                {i.project_name} <span className="muted">งวด {i.no}/{i.of} · {i.percent}%</span>
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
    const state = planned === 0 ? 'none' : paid >= planned ? 'done' : 'part';
    return (
        <div className="pcard" onClick={onOpen}>
            <div className={'pcard-accent payacc-' + (state === 'done' ? 'pay-done' : 'pay-wait')} />
            <div className="pcard-body">
                <div className="pcard-head">
                    <span className={'status ' + (state === 'done' ? 'pay-done' : 'pay-wait')}>
                        {state === 'none' ? 'ยังไม่ตั้งงวด' : state === 'done' ? 'จ่ายครบแล้ว' : 'จ่ายแล้ว ' + pct + '%'}
                    </span>
                </div>
                {row.brand && <span className="pcard-brand">{row.brand}</span>}
                <h3 className="pcard-name">{row.project_name}</h3>
                <div className="pcard-sub">
                    <span>🏢 {row.agencies && row.agencies.length ? row.agencies.join(', ') : <span className="muted">ยังไม่มีเอเจนซี่</span>}</span>
                </div>
                {planned > 0 && (
                    <div className="pay-progress">
                        <div className="pay-progress-bar"><div style={{ width: pct + '%' }} /></div>
                        <div className="pay-progress-txt">{baht(paid)} / {baht(planned)}</div>
                    </div>
                )}
                <div className="pcard-foot">
                    <div>
                        <div className="pcard-budget-val">{baht(row.budget)}</div>
                        <div className="pcard-budget-lbl">งบแคมเปญ</div>
                    </div>
                    <div className="pay-docs">
                        <span className={row.quotation ? 'doc-ok' : 'doc-no'}>📄 เสนอราคา</span>
                        <span className={row.invoice ? 'doc-ok' : 'doc-no'}>📄 แจ้งหนี้</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ตัวแก้แผนงวด
function PlanModal({ row, onClose, onSaved }) {
    const agencyOpts = (row.agencies || []);
    const budget = Number(row.budget) || 0;
    const blank = n => Array.from({ length: n }, () => ({
        percent: Math.round(100 / n), amount: Math.round(budget / n), due_date: ''
    }));
    const planOf = name => {
        const its = (row.installments || []).filter(i => i.agency === name);
        return its.length ? its.map(i => ({ percent: i.percent, amount: i.amount, due_date: i.due_date || '' })) : blank(2);
    };

    const [agency, setAgency] = useState(agencyOpts[0] || '');
    const [plan, setPlan] = useState(planOf(agencyOpts[0] || ''));
    const [saving, setSaving] = useState(false);

    const locked = (row.installments || []).some(i => i.agency === agency && i.status === 'paid');

    function pickAgency(name) { setAgency(name); setPlan(planOf(name)); }

    // แก้ % แล้วคิดยอดให้อัตโนมัติ · แก้ยอดเองได้ ไม่ไปยุ่งกับ %
    const setRow = (idx, k, v) => setPlan(p => p.map((x, i) => {
        if (i !== idx) return x;
        if (k === 'percent') return { ...x, percent: v, amount: Math.round(budget * (Number(v) || 0) / 100) };
        return { ...x, [k]: v };
    }));

    const sumPct = plan.reduce((s, x) => s + (Number(x.percent) || 0), 0);
    const sumAmt = plan.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    async function save() {
        if (!agency) { alert('ยังไม่มีเอเจนซี่ในแคมเปญนี้ — สร้างลิงก์เอเจนซี่ในหน้าแคมเปญก่อน'); return; }
        setSaving(true);
        try {
            await api(`/payments/${row.project_id}/plan`, { method: 'PUT', body: { agency, plan } });
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
                                <span className="muted"> · งบ {baht(budget)}</span>
                            </div>
                        </div>
                    </div>
                    <button className="modal-x" onClick={onClose}>×</button>
                </div>

                <div className="plan-box">
                    <div className="field-row">
                        <div className="field">
                            <label>เอเจนซี่</label>
                            {agencyOpts.length ? (
                                <select value={agency} onChange={e => pickAgency(e.target.value)}>
                                    {agencyOpts.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                            ) : <div className="perf-readonly">ยังไม่มีเอเจนซี่ — สร้างลิงก์ในหน้าแคมเปญก่อน</div>}
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
                            เจ้านี้มีงวดที่ทำจ่ายไปแล้ว แก้แผนไม่ได้ — ต้องยกเลิกรอบทำจ่ายนั้นก่อน
                        </div>
                    )}

                    <div className="plan-rows">
                        <div className="plan-row head">
                            <span>งวด</span><span>%</span><span>ยอด (฿)</span><span>ครบกำหนด</span>
                        </div>
                        {plan.map((x, i) => (
                            <div className="plan-row" key={i}>
                                <span className="plan-no">{i + 1}/{plan.length}</span>
                                <input type="number" min="0" max="100" value={x.percent} disabled={locked}
                                    onChange={e => setRow(i, 'percent', e.target.value)} />
                                <input type="number" min="0" value={x.amount} disabled={locked}
                                    onChange={e => setRow(i, 'amount', e.target.value)} />
                                <DatePicker value={x.due_date} onChange={v => setRow(i, 'due_date', v)} />
                            </div>
                        ))}
                        <div className="plan-row sum">
                            <span>รวม</span>
                            <span className={sumPct === 100 ? '' : 'plan-warn'}>{sumPct}%</span>
                            <span className={sumAmt === budget ? '' : 'plan-warn'}>{baht(sumAmt)}</span>
                            <span className="muted">{sumAmt !== budget && budget > 0 ? 'งบ ' + baht(budget) : ''}</span>
                        </div>
                    </div>
                    <p className="alp-hint">ยอดคิดจาก % ของงบให้อัตโนมัติ แก้ตัวเลขทับได้ · รวมไม่ครบ 100% ก็บันทึกได้ เผื่อกรณีจ่ายไม่เต็มงบ</p>
                </div>

                <div className="pay-files">
                    <FileSlot label="ใบเสนอราคา" projectId={row.project_id} type="quotation" meta={row.quotation}
                        onUploaded={onSaved} />
                    <FileSlot label="ใบแจ้งหนี้" projectId={row.project_id} type="invoice" meta={row.invoice}
                        onUploaded={onSaved} />
                </div>

                <div className="modal-actions">
                    <button className="btn-ghost" onClick={onClose}>ปิด</button>
                    <button className="btn-primary" onClick={save} disabled={saving || locked || !agency}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกแผนการจ่าย'}
                    </button>
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('pending');   // pending | batches | campaigns
    const [brand, setBrand] = useState('');
    const [cycle, setCycle] = useState('');
    const [picked, setPicked] = useState([]);
    const [showBatch, setShowBatch] = useState(false);
    const [openId, setOpenId] = useState(null);

    function loadAll() {
        return Promise.all([
            api('/payments'),
            api('/payments/installments?status=pending'),
            api('/payments/batches')
        ]).then(([a, b, c]) => {
            setRows(a.data); setPending(b.data); setBatches(c.data);
        }).catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { loadAll(); }, []);

    function refresh() {
        setPicked([]); setShowBatch(false); setOpenId(null);
        loadAll();
    }

    // ตัวกรองใช้ร่วมกันทุกแท็บ — งวดดูจากวันครบกำหนด รอบดูจากวันที่จ่าย
    const inCycle = d => !cycle || (!!d && (cycle.length === 10 ? d === cycle : d.startsWith(cycle)));
    const shownPending = pending.filter(i => (!brand || i.brand === brand) && inCycle(i.due_date));
    const shownBatches = batches.filter(b => (!brand || (b.items || []).some(i => i.brand === brand)) && inCycle(b.pay_date));
    const shownRows = rows.filter(r => !brand || r.brand === brand);

    const pendingTotal = shownPending.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const batchTotal = shownBatches.reduce((s, b) => s + (Number(b.total) || 0), 0);
    const countOf = b => rows.filter(r => r.brand === b).length;

    const pickedItems = pending.filter(i => picked.includes(i.id));

    return (
        <div>
            <header className="page-head">
                <h1>รอบทำจ่ายเอเจนซี่</h1>
                <p className="page-sub">แบ่งงวดต่อแคมเปญ แล้วรวมหลายงวดเป็นสลิปใบเดียวต่อเอเจนซี่ (เฉพาะผู้ดูแลระบบ)</p>
            </header>

            <div className="pay-tabs">
                <button className={'pay-tab' + (tab === 'pending' ? ' active' : '')} onClick={() => setTab('pending')}>
                    ค้างจ่าย <span className="pay-tab-n">{shownPending.length}</span>
                </button>
                <button className={'pay-tab' + (tab === 'batches' ? ' active' : '')} onClick={() => setTab('batches')}>
                    รอบที่จ่ายแล้ว <span className="pay-tab-n">{shownBatches.length}</span>
                </button>
                <button className={'pay-tab' + (tab === 'campaigns' ? ' active' : '')} onClick={() => setTab('campaigns')}>
                    แคมเปญ / ตั้งงวด <span className="pay-tab-n">{shownRows.length}</span>
                </button>
            </div>

            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                <label className="bud-month">
                    {tab === 'batches' ? 'วันที่จ่าย:' : 'ครบกำหนด:'}
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

            <div className="pay-summary">
                {tab === 'batches' ? (
                    <>
                        <span>แสดง <strong>{shownBatches.length}</strong> รอบ</span>
                        <span>จ่ายไปแล้วรวม <strong>{baht(batchTotal)}</strong></span>
                    </>
                ) : tab === 'pending' ? (
                    <>
                        <span>ค้าง <strong>{shownPending.length}</strong> งวด</span>
                        <span>ยอดค้างรวม <strong>{baht(pendingTotal)}</strong></span>
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
                <PendingTab items={shownPending} picked={picked} setPicked={setPicked}
                    onMakeBatch={() => setShowBatch(true)} />
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
                    <div className="card-grid">
                        {shownRows.map(r => <CampaignCard key={r.project_id} row={r} onOpen={() => setOpenId(r.project_id)} />)}
                    </div>
                )
            )}

            {showBatch && pickedItems.length > 0 && (
                <BatchModal agency={pickedItems[0].agency} items={pickedItems}
                    onClose={() => setShowBatch(false)} onDone={refresh} />
            )}

            {openId != null && (
                <PlanModal row={rows.find(r => r.project_id === openId)}
                    onClose={() => setOpenId(null)} onSaved={refresh} />
            )}
        </div>
    );
}
