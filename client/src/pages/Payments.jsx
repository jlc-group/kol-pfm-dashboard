import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, openFile } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Avatar from '../components/Avatar.jsx';
import PayCyclePicker from '../components/PayCyclePicker.jsx';
import { fmtDate } from '../utils/date.js';
import { BRANDS } from '../data/brands.js';

const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH');

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

// ===================== แท็บ 1: งวดค้างจ่าย =====================
// จัดกลุ่มตามเอเจนซี่ เพราะสลิป 1 ใบ = เอเจนซี่ 1 เจ้า
// ===================== แท็บ 1: งวดรอทำจ่าย =====================
// จัดตาม "รอบวันที่" ก่อน แล้วค่อยแยกเอเจนซี่ — 1 วัน + 1 เอเจนซี่ = สลิป 1 ใบ
function PendingTab({ items, picked, setPicked, onMakeBatch, onTakeAll }) {
    // เจ้าที่กำลังเลือกอยู่ — เลือกแล้วกลุ่มอื่นติ๊กไม่ได้ (สลิปใบเดียวโอนให้เจ้าเดียว วันเดียว)
    const cur = picked.length ? items.find(i => i.id === picked[0]) : null;
    const lockKey = cur ? (cur.due_date || '') + '|' + (cur.agency || '') : null;

    if (!items.length) {
        return (
            <div className="panel empty-state">
                <div className="empty-emoji">✅</div>
                <p>ไม่มีงวดรอทำจ่ายตามตัวกรองที่เลือก</p>
            </div>
        );
    }

    // รวมเป็นชั้น: วันที่ -> เอเจนซี่ -> งวด
    const byDate = {};
    items.forEach(i => {
        const d = i.due_date || '';
        const a = i.agency || '— ยังไม่ระบุเอเจนซี่ —';
        byDate[d] = byDate[d] || {};
        (byDate[d][a] = byDate[d][a] || []).push(i);
    });
    // ไม่กำหนดวันไปอยู่ท้ายสุด
    const dates = Object.keys(byDate).sort((a, b) => (a || '9999').localeCompare(b || '9999'));

    const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    const toggleAll = list => {
        const ids = list.map(i => i.id);
        const allOn = ids.every(id => picked.includes(id));
        setPicked(allOn ? picked.filter(id => !ids.includes(id)) : [...new Set([...picked, ...ids])]);
    };
    const sumOf = list => list.reduce((s, i) => s + (Number(i.amount) || 0), 0);

    return (
        <>
            {dates.map(d => {
                const groups = byDate[d];
                const all = Object.values(groups).flat();
                const agencies = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th'));
                return (
                    <div className="due-block" key={d || 'nodate'}>
                        <div className="due-head">
                            <span className="due-date">
                                {d ? '📅 รอบ ' + fmtDateTh(d) : '📅 ยังไม่กำหนดวันครบกำหนด'}
                            </span>
                            <span className="due-sum">{all.length} งวด · <b>{baht(sumOf(all))}</b></span>
                        </div>

                        {agencies.map(name => {
                            const list = groups[name];
                            const key = (d || '') + '|' + (name === '— ยังไม่ระบุเอเจนซี่ —' ? '' : name);
                            const blocked = lockKey && key !== lockKey;
                            return (
                                <div className={'inst-group' + (blocked ? ' blocked' : '')} key={name}>
                                    <div className="inst-group-head">
                                        <input type="checkbox" disabled={blocked}
                                            checked={list.every(i => picked.includes(i.id))}
                                            onChange={() => toggleAll(list)} />
                                        <span className="inst-agency"><Icon name="users" size={15} /> {name}</span>
                                        <span className="inst-group-sum">{list.length} งวด · <b>{baht(sumOf(list))}</b></span>
                                        {!blocked && (
                                            <button type="button" className="inst-take-all" onClick={() => onTakeAll(list)}>
                                                รวมทั้งหมด → สร้างรอบทำจ่าย
                                            </button>
                                        )}
                                        {blocked && <span className="inst-blocked-note">สลิป 1 ใบ = 1 เอเจนซี่ 1 รอบวันที่</span>}
                                    </div>
                                    <div className="inst-rows">
                                        {list.map(i => (
                                            <label className={'inst-row' + (picked.includes(i.id) ? ' on' : '')} key={i.id}>
                                                <input type="checkbox" disabled={blocked}
                                                    checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                                                <span className="inst-project">
                                                    {i.brand && <span className="inst-brand">{i.brand}</span>}
                                                    {i.project_name}
                                                    {i.group_no && (
                                                        <span className="inst-grp" title={i.group_concept || ''}>
                                                            กลุ่ม {i.group_no}{i.group_concept ? ' · ' + i.group_concept : ''}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="inst-no">งวด {i.no}/{i.of}</span>
                                                <span className="inst-pct">{i.percent}%</span>
                                                <span className="inst-amt">{baht(i.amount)}</span>
                                                <span className="inst-due">
                                                    <span className={'inv-chip ' + (i.invoice || i.invoice_link ? 'ok' : 'no')}
                                                        title={i.invoice ? 'แนบไฟล์แล้ว: ' + i.invoice.original : (i.invoice_link || 'ยังไม่ได้แนบใบแจ้งหนี้ของงวดนี้')}>
                                                        🧾 {i.invoice || i.invoice_link ? 'มีใบแจ้งหนี้' : 'ยังไม่มีใบแจ้งหนี้'}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}

            {picked.length > 0 && (
                <div className="inst-bar">
                    <div className="inst-bar-info">
                        <span className="inst-bar-agency">{cur && cur.agency}</span>
                        {cur && cur.due_date && <span>รอบ {fmtDateTh(cur.due_date)}</span>}
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
function BatchModal({ agency, items, cycle, batches, onClose, onDone }) {
    // เติมวันที่ให้เอง ไม่ต้องมากรอกซ้ำ: ใช้ตัวกรองรอบก่อน ถ้าไม่มีก็ใช้วันครบกำหนดของงวดที่เลือก
    const guessDate = () => {
        if (cycle && cycle.length === 10) return cycle;
        const dues = [...new Set(items.map(i => i.due_date).filter(Boolean))].sort();
        return dues.length ? dues[dues.length - 1] : '';   // งวดครบกำหนดต่างวัน = ใช้วันหลังสุด
    };
    const [payDate, setPayDate] = useState(guessDate);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    // รอบของเจ้านี้ในวันเดียวกันที่มีอยู่แล้ว — ถ้ามี ควรรวมเข้าใบเดิมแทนออกสลิปสองใบ
    const sameDay = (batches || []).find(b => b.agency === agency && b.pay_date && b.pay_date === payDate);

    async function save() {
        setSaving(true);
        try {
            if (sameDay) {
                await api(`/payments/batches/${sameDay.id}/items`, {
                    method: 'POST', body: { installment_ids: items.map(i => i.id) }
                });
            } else {
                await api('/payments/batches', {
                    method: 'POST',
                    body: { agency, pay_date: payDate || null, note: note || null, installment_ids: items.map(i => i.id) }
                });
            }
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
                    {payDate && payDate === guessDate() && (
                        <span className="cpw-hint">เติมให้จากวันครบกำหนดของงวดที่เลือก — แก้ได้ถ้าโอนจริงคนละวัน</span>
                    )}
                </div>
                {sameDay ? (
                    <div className="batch-merge">
                        มีรอบของ <b>{agency}</b> วันเดียวกันอยู่แล้ว ({baht(sameDay.total)} · {sameDay.item_count} งวด)
                        <br />กดยืนยันแล้วจะ<b>รวมเข้าใบเดิม</b> ยอดใหม่ {baht(sameDay.total + total)} — สลิปยังเป็นใบเดียว
                    </div>
                ) : (
                    <div className="field">
                        <label>หมายเหตุ</label>
                        <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น รอบ 25 ก.ย." />
                    </div>
                )}

                <div className="modal-actions">
                    <button className="btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button className="btn-primary" onClick={save} disabled={saving}>
                        <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : (sameDay ? 'รวมเข้ารอบเดิม' : 'ยืนยันรอบทำจ่าย')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ยกเลิกรอบ = ย้อนรายการเงิน ต้องบอกเหตุผลไว้ในประวัติเสมอ
function CancelBatchModal({ b, onClose, onDone }) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
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
                <p className="dash-section-sub" style={{ margin: '12px 0' }}>
                    งวดทั้ง {b.item_count} งวดจะกลับไปเป็นรอทำจ่ายเหมือนเดิม ไม่หายไปไหน
                    {b.slip ? ' · สลิปที่แนบไว้จะถูกลบไปพร้อมรอบนี้' : ''}
                </p>
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
    const state = planned === 0 ? 'none' : paid >= planned ? 'done' : 'part';
    const invTotal = (row.installments || []).length;
    const invDone = (row.installments || []).filter(i => i.invoice || i.invoice_link).length;
    // แผนรวมมากกว่างบ = สัญญาณว่ามีแผนซ้อนกัน (ทั้งแคมเปญ + รายกลุ่ม)
    const overPlan = planned > 0 && Number(row.budget) > 0 && planned > Number(row.budget);
    return (
        <div className="pcard" onClick={onOpen}>
            <div className={'pcard-accent payacc-' + (state === 'done' ? 'pay-done' : 'pay-wait')} />
            <div className="pcard-body">
                <div className="pcard-head">
                    <span className={'status ' + (state === 'done' ? 'pay-done' : 'pay-wait')}>
                        {state === 'none' ? 'ยังไม่ตั้งงวด' : state === 'done' ? 'จ่ายครบแล้ว' : 'จ่ายแล้ว ' + pct + '%'}
                    </span>
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
        const res = await api(`/payments/${row.project_id}/plan`, {
            method: 'PUT', body: { agency, group_key: asKey(groupKey) || null, plan }
        });
        const it = (res.data || [])[idx];
        if (!it) throw new Error('บันทึกแผนไม่สำเร็จ');
        return it;
    }
    async function attachInvoiceFile(idx, file) {
        const it = await ensureInstallment(idx);
        await uploadFile(`/payments/installments/${it.id}/invoice`, file);
        if (onReload) await onReload();
    }
    async function attachInvoiceLink(idx, v) {
        const it = await ensureInstallment(idx);
        await api(`/payments/installments/${it.id}/invoice-link`, { method: 'PUT', body: { link: v || null } });
        if (onReload) await onReload();
    }

    async function save() {
        if (!agency) { alert('ยังไม่มีเอเจนซี่ในแคมเปญนี้ — สร้างลิงก์เอเจนซี่ในหน้าแคมเปญก่อน'); return; }
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
                                <span className="muted"> · ฐานคิดยอด {baht(budget)}{curGroup ? " (กลุ่มนี้)" : " (ทั้งแคมเปญ)"}</span>
                            </div>
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
                                        {hasPlan(g.key) ? '✓ ' : ''}กลุ่มที่ {i + 1}{g.concept ? " · " + g.concept : ""} · งบ {baht(g.budget)}
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
                            เจ้านี้มีงวดที่ทำจ่ายไปแล้ว แก้แผนไม่ได้ — ต้องยกเลิกรอบทำจ่ายนั้นก่อน
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
                                    <div className="plan-card-row">
                                        <span className="plan-card-lbl">วันที่ทำจ่าย</span>
                                        <DatePicker value={x.due_date} onChange={v => setRow(i, 'due_date', v)} />
                                    </div>
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
                    <p className="alp-hint">ยอดคิดจาก % ของงบให้อัตโนมัติ แก้ตัวเลขทับได้ · แนบใบแจ้งหนี้ก่อนกดบันทึกแผนได้ ระบบจะบันทึกแผนให้เอง</p>
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
function ManualModal({ item, agencies, onClose, onSaved, onReload }) {
    const saved0 = (item && item.installments) || [];
    const [title, setTitle] = useState((item && item.title) || '');
    const [agency, setAgency] = useState((item && item.agency) || agencies[0] || '');
    const [freeAgency, setFreeAgency] = useState(!!(item && item.agency && !agencies.includes(item.agency)));
    const [total, setTotal] = useState(item ? String(item.planned_amount || '') : '');
    const [plan, setPlan] = useState(saved0.length
        ? saved0.map(i => ({ percent: i.percent, amount: i.amount, due_date: i.due_date || '' }))
        : [{ percent: 100, amount: '', due_date: '' }]);
    const [saving, setSaving] = useState(false);
    const [manualId, setManualId] = useState((item && item.manual_id) || null);

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
        setSaving(true);
        try { await persist(); onSaved(); }
        catch (err) { alert(err.message); setSaving(false); }
    }
    // แนบเอกสารก่อนกดบันทึกได้ — บันทึกให้เงียบ ๆ ก่อนแล้วค่อยแนบ
    async function ensure(idx) {
        if (saved[idx]) return saved[idx];
        if (!title.trim() || !agency) throw new Error('ใส่ชื่อรายการกับเอเจนซี่ก่อนถึงจะแนบเอกสารได้');
        const rows = await persist();
        if (!rows[idx]) throw new Error('บันทึกไม่สำเร็จ');
        return rows[idx];
    }
    async function attachFile(idx, file) {
        const it = await ensure(idx);
        await uploadFile(`/payments/installments/${it.id}/invoice`, file);
        if (onReload) await onReload();
    }
    async function attachLink(idx, v) {
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
                            รายการนี้มีงวดที่ทำจ่ายไปแล้ว แก้ไม่ได้ — ต้องยกเลิกรอบทำจ่ายนั้นก่อน
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
                                    <div className="plan-card-row">
                                        <span className="plan-card-lbl">วันที่ทำจ่าย</span>
                                        <DatePicker value={x.due_date} onChange={v => setRow(i, 'due_date', v)} />
                                    </div>
                                </div>
                            );
                        })}
                        <div className="plan-sum">
                            <span>รวมทุกงวด</span>
                            <span>{baht(sumAmt)}</span>
                        </div>
                    </div>
                    <p className="alp-hint">รายการนี้จะไปโผล่ในแท็บรอทำจ่ายเหมือนงวดของแคมเปญ รวมสลิปใบเดียวกับงานอื่นของเอเจนซี่เจ้าเดียวกันได้</p>
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
            api('/payments/batches'),
            api('/payments/manual')
        ]).then(([a, b, c, d]) => {
            setRows(a.data); setPending(b.data); setBatches(c.data); setManuals(d.data);
        }).catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { loadAll(); }, []);

    function refresh() {
        setPicked([]); setShowBatch(false); setOpenId(null); setManualOpen(null);
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
                <PendingTab items={shownPending} picked={picked} setPicked={setPicked}
                    onMakeBatch={() => setShowBatch(true)}
                    onTakeAll={list => { setPicked(list.map(i => i.id)); setShowBatch(true); }} />
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

            {showBatch && pickedItems.length > 0 && (
                <BatchModal agency={pickedItems[0].agency} items={pickedItems}
                    cycle={cycle} batches={batches}
                    onClose={() => setShowBatch(false)} onDone={refresh} />
            )}

            {manualOpen && (
                <ManualModal
                    item={manualOpen === 'new' ? null : manualOpen}
                    agencies={[...new Set(rows.flatMap(r => r.agencies || []))].sort((a, b) => a.localeCompare(b, 'th'))}
                    onClose={() => setManualOpen(null)} onSaved={refresh} onReload={loadAll} />
            )}

            {openId != null && (
                <PlanModal row={rows.find(r => r.project_id === openId)}
                    onClose={() => setOpenId(null)} onSaved={refresh} onReload={loadAll} />
            )}
        </div>
    );
}
