import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import { BRANDS } from '../data/brands.js';
import { productsByBrand, productInfo, targetEntriesOf, targetsForProduct, PRODUCT_CATALOG } from '../data/products.js';
import { setCatalogFromServer } from '../data/catalogLoader.js';
import { useCatalogVersion } from '../data/useCatalog.js';

// ===== หน้า Products & Targets (เมนู ADMIN · ผู้ใช้สั่ง 7 ต.ค. 2026) =====
// Admin เพิ่มสินค้าใหม่ / เพิ่ม Target / ซ่อน ได้เอง — เก็บเฉพาะส่วนต่างจากรายการตั้งต้นในโค้ด (server/src/store/pg/catalog.js)
// ไม่มีการลบ (ซ่อนแทน แคมเปญเก่าไม่เสีย) · รหัสสินค้าแก้ไม่ได้ · ชื่อ Target ต้องตรงกับระบบยิงแอดทุกตัวอักษร
// แบรนด์มีเท่าที่ data/brands.js กำหนด (ผูกกับสิทธิ์ผู้ใช้ — เพิ่มแบรนด์ใหม่ต้องแก้แยก)

// รูปแบบรหัสเดียวกับ server (store/productFamilies.js CODE_SHAPE) — เช่น JNP4, BTA5-01, L8C, JNPSET1 (ตัวอักษร 1-8 ตัว · 8 ต.ค. 2026)
const CODE_SHAPE = /^[A-Z]{1,8}\d+[A-Z]?(?:-\d+)?$/;
// ชื่อคล้ายกัน = เหมือนกันเมื่อไม่สนตัวพิมพ์ / ช่องว่าง / _ / - (เช่น F_Beauty-Make up_18-44 กับ f_beauty make up 18-44)
const loose = t => String(t || '').toLowerCase().replace(/[\s_-]+/g, '');
const LAST_BRAND_KEY = 'kol:catalog-brand';
const readLastBrand = () => { try { const b = localStorage.getItem(LAST_BRAND_KEY); return BRANDS.includes(b) ? b : null; } catch { return null; } };
const saveLastBrand = b => { try { localStorage.setItem(LAST_BRAND_KEY, b); } catch { /* เปิดแบบไม่เก็บข้อมูล */ } };

// ทุกชื่อ Target ในคลัง (รวมทุกแบรนด์) — ไว้เตือนชื่อซ้ำ/คล้าย
function allTargetNames() {
    const out = new Set();
    PRODUCT_CATALOG.forEach(p => targetEntriesOf(p.code).forEach(t => out.add(t.target)));
    return [...out];
}

function Modal({ title, onClose, children }) {
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal catg-modal" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
                <h3>{title}</h3>
                {children}
            </div>
        </div>
    );
}

// ช่องชื่อ Target + เตือนชื่อคล้าย + ติ๊กยืนยันว่าตรงกับระบบยิงแอด
function TargetNameField({ value, onChange, confirmed, onConfirm, autoFocus }) {
    const name = value.trim();
    const similar = name ? allTargetNames().filter(t => t !== name && loose(t) === loose(name)) : [];
    return (
        <>
            <div className="field">
                <label>ชื่อ Target *</label>
                <input value={value} onChange={e => onChange(e.target.value)} placeholder="F_Beauty-Fragrance_18-44" autoFocus={autoFocus}
                    aria-label="ชื่อ Target" maxLength={100} />
            </div>
            {similar.length > 0 && (
                <div className="catg-warn" role="alert">
                    ⚠ มีชื่อคล้ายกันอยู่แล้ว: <b>{similar.join(', ')}</b> — ถ้าเป็นกลุ่มเดียวกัน ให้ใช้ชื่อเดิม
                </div>
            )}
            {name && (
                <label className="catg-confirm">
                    <input type="checkbox" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
                    <span>ตรวจแล้ว ชื่อ <b className="catg-exact">{name}</b> ตรงกับกลุ่มเป้าหมายในระบบยิงแอดทุกตัวอักษร</span>
                </label>
            )}
        </>
    );
}

function AddProductModal({ brand, onClose, onSaved }) {
    const [form, setForm] = useState({ brand, code: '', name: '' });
    const [picked, setPicked] = useState([]);          // Target ที่เลือก (จากของแบรนด์ หรือพิมพ์ใหม่)
    const [typed, setTyped] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const code = form.code.trim().toUpperCase();
    const brandTargets = useMemo(() => {
        const out = [];
        productsByBrand(form.brand).forEach(p => targetsForProduct(p.code).forEach(t => { if (!out.includes(t)) out.push(t); }));
        return out;
    }, [form.brand]);
    const newTargets = picked.filter(t => !brandTargets.includes(t));
    const dup = code ? productInfo(code) : null;
    const problems = [];
    if (!code) problems.push('รหัสสินค้า');
    else if (!CODE_SHAPE.test(code)) problems.push('รหัสสินค้า (รูปแบบไม่ถูก)');
    else if (dup) problems.push(`รหัส ${code} มีอยู่แล้ว (${dup.brand})`);
    if (!form.name.trim()) problems.push('ชื่อสินค้า');
    if (newTargets.length && !confirmed) problems.push('ติ๊กยืนยันชื่อ Target ใหม่');
    // พิมพ์ชื่อไว้แต่ยังไม่กด "+ ใส่" — ไม่ส่งไปเงียบ ๆ (ต้องผ่านช่องติ๊กยืนยันชื่อก่อน)
    if (typed.trim()) problems.push('กด "+ ใส่" ชื่อ Target ที่พิมพ์ไว้ (หรือลบออก)');
    const togglePick = t => setPicked(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));
    function addTyped() {
        const t = typed.trim();
        if (!t) return;
        if (/[,，]/.test(t)) { setError('ชื่อ Target ห้ามมีจุลภาค (,)'); return; }
        setError('');
        setPicked(p => (p.some(x => x.toLowerCase() === t.toLowerCase()) ? p : [...p, t]));
        setTyped('');
        setConfirmed(false);
    }
    async function submit(e) {
        e.preventDefault();
        if (problems.length) { setError('ยังไม่ครบ: ' + problems.join(', ')); return; }
        setError(''); setSaving(true);
        try {
            const res = await api('/catalog/products', { method: 'POST', body: { code, name: form.name.trim(), brand: form.brand, targets: picked } });
            onSaved(res.data, `เพิ่มสินค้า ${code} แล้ว`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title="เพิ่มสินค้า" onClose={onClose}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>แบรนด์ *</label>
                    <select value={form.brand} onChange={e => { setForm(f => ({ ...f, brand: e.target.value })); setPicked([]); }} aria-label="แบรนด์">
                        {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                </div>
                <div className="catg-row2">
                    <div className="field">
                        <label>รหัสสินค้า *</label>
                        <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="JNP4 / BTA5-01" aria-label="รหัสสินค้า" maxLength={40} autoFocus />
                        <small className="catg-hint">ตัวอักษรอังกฤษ 1-8 ตัว + ตัวเลข (ต่อด้วยตัวอักษร หรือ -ตัวเลข ได้) เช่น JNP4, JNPSET1 · แก้ทีหลังไม่ได้</small>
                    </div>
                    <div className="field">
                        <label>ชื่อสินค้า *</label>
                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Velvet Dawn" aria-label="ชื่อสินค้า" maxLength={200} />
                    </div>
                </div>
                {dup && <div className="catg-warn" role="alert">⚠ รหัส {code} มีอยู่แล้ว: {dup.code} - {dup.name} ({dup.brand}){dup.hidden ? ' · ซ่อนอยู่ (กดเอากลับในตารางได้)' : ''}</div>}
                <div className="field">
                    <label>Target <span className="catg-opt">ไม่บังคับ · เพิ่มทีหลังได้</span></label>
                    {brandTargets.length > 0 && (
                        <div className="catg-pick">
                            {brandTargets.map(t => (
                                <button type="button" key={t} className={'catg-pick-item' + (picked.includes(t) ? ' on' : '')} aria-pressed={picked.includes(t)} onClick={() => togglePick(t)}>
                                    {picked.includes(t) ? '☑' : '☐'} {t}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="catg-typed">
                        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="พิมพ์ชื่อ Target ใหม่" aria-label="Target ใหม่" maxLength={100}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} />
                        <button type="button" className="btn-ghost" onClick={addTyped}>+ ใส่</button>
                    </div>
                    {newTargets.length > 0 && (
                        <div className="catg-pick">
                            {newTargets.map(t => (
                                <span key={t} className="catg-chip new">{t}<button type="button" title="เอาออก" aria-label={`เอา ${t} ออก`} onClick={() => togglePick(t)}>×</button></span>
                            ))}
                        </div>
                    )}
                </div>
                {newTargets.length > 0 && (
                    <label className="catg-confirm">
                        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                        <span>ตรวจแล้ว ชื่อ Target ใหม่ <b className="catg-exact">{newTargets.join(', ')}</b> ตรงกับกลุ่มเป้าหมายในระบบยิงแอดทุกตัวอักษร</span>
                    </label>
                )}
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'เพิ่มสินค้า'}</button>
                </div>
            </form>
        </Modal>
    );
}

function AddTargetModal({ brand, preset, onClose, onSaved }) {
    const products = productsByBrand(brand).filter(p => !p.hidden || (preset || []).includes(p.code));
    const [codes, setCodes] = useState(() => (preset && preset.length ? preset : products.map(p => p.code)));
    const [name, setName] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const t = name.trim();
    const has = code => targetsForProduct(code).some(x => x.toLowerCase() === t.toLowerCase());
    const already = t ? codes.filter(has) : [];
    const send = codes.filter(c => !already.includes(c));
    const allOn = codes.length === products.length;
    const problems = [];
    if (!t) problems.push('ชื่อ Target');
    else if (/[,，]/.test(t)) problems.push('ชื่อ Target ห้ามมีจุลภาค (,)');
    if (!codes.length) problems.push('เลือกสินค้าอย่างน้อย 1 ตัว');
    else if (t && !send.length) problems.push('สินค้าที่เลือกมี Target นี้ครบแล้ว');
    if (t && !confirmed) problems.push('ติ๊กยืนยันชื่อ Target');
    async function submit(e) {
        e.preventDefault();
        if (problems.length) { setError('ยังไม่ครบ: ' + problems.join(', ')); return; }
        setError(''); setSaving(true);
        try {
            const res = await api('/catalog/targets', { method: 'POST', body: { target: t, codes: send } });
            onSaved(res.data, `เพิ่ม Target ${t} ให้ ${send.length} สินค้าแล้ว`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title={`เพิ่ม Target · ${brand}`} onClose={onClose}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <TargetNameField value={name} onChange={v => { setName(v); setConfirmed(false); }} confirmed={confirmed} onConfirm={setConfirmed} autoFocus />
                <div className="field">
                    <label className="catg-label-row">
                        <span>ใช้กับสินค้า * <span className="catg-opt">{codes.length} / {products.length}</span></span>
                        <button type="button" className="catg-link" onClick={() => setCodes(allOn ? [] : products.map(p => p.code))}>{allOn ? 'ไม่เลือกเลย' : 'เลือกทั้งแบรนด์'}</button>
                    </label>
                    <div className="catg-pick">
                        {products.map(p => (
                            <button type="button" key={p.code} className={'catg-pick-item' + (codes.includes(p.code) ? ' on' : '')} aria-pressed={codes.includes(p.code)}
                                title={p.name} onClick={() => setCodes(c => (c.includes(p.code) ? c.filter(x => x !== p.code) : [...c, p.code]))}>
                                {codes.includes(p.code) ? '☑' : '☐'} {p.code}
                            </button>
                        ))}
                    </div>
                    {already.length > 0 && <small className="catg-hint">{already.join(', ')} มี Target นี้อยู่แล้ว (ข้าม)</small>}
                </div>
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : `เพิ่ม Target${send.length ? ` (${send.length} สินค้า)` : ''}`}</button>
                </div>
            </form>
        </Modal>
    );
}

function RenameModal({ product, onClose, onSaved }) {
    const [name, setName] = useState(product.name);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    async function submit(e) {
        e.preventDefault();
        if (!name.trim()) { setError('กรุณาใส่ชื่อสินค้า'); return; }
        setError(''); setSaving(true);
        try {
            const res = await api(`/catalog/products/${encodeURIComponent(product.code)}`, { method: 'PATCH', body: { name: name.trim() } });
            onSaved(res.data, `แก้ชื่อ ${product.code} แล้ว`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title={`แก้ชื่อสินค้า ${product.code}`} onClose={onClose}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>ชื่อสินค้า *</label>
                    <input value={name} onChange={e => setName(e.target.value)} aria-label="ชื่อสินค้า" maxLength={200} autoFocus />
                </div>
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                </div>
            </form>
        </Modal>
    );
}

export default function Catalog() {
    useCatalogVersion();   // render ใหม่ทุกครั้งที่คลังเปลี่ยน
    const [brand, setBrand] = useState(() => readLastBrand() || BRANDS[0]);
    const [showHidden, setShowHidden] = useState(false);
    const [ready, setReady] = useState(null);     // null = กำลังเช็ค · false = ยังไม่ได้ setup-db
    const [modal, setModal] = useState(null);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState('');

    useEffect(() => {
        api('/catalog')
            .then(res => { setCatalogFromServer(res.data); setReady(res.data ? res.data.ready !== false : true); })
            .catch(err => { setError(err.message); setReady(true); });
    }, []);
    useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(''), 5000);
        return () => clearTimeout(timer);
    }, [note]);
    const pickBrand = b => { setBrand(b); saveLastBrand(b); };
    const saved = (data, msg) => { setCatalogFromServer(data); setModal(null); setError(''); setNote(msg); };

    async function patch(key, url, body, msg) {
        setBusy(key); setError('');
        try { const res = await api(url, { method: 'PATCH', body }); saved(res.data, msg); }
        catch (err) { setError(err.message); }
        finally { setBusy(''); }
    }
    const toggleProduct = p => {
        const hide = !p.hidden;
        if (hide && !window.confirm(`ซ่อนสินค้า ${p.code} - ${p.name}?\nแคมเปญใหม่จะเลือกสินค้านี้ไม่ได้ · แคมเปญเก่าที่เลือกไว้แล้วไม่เสีย · กดเอากลับได้`)) return;
        patch('p:' + p.code, `/catalog/products/${encodeURIComponent(p.code)}`, { hidden: hide, name: p.name, brand: p.brand },
            hide ? `ซ่อน ${p.code} แล้ว` : `เอา ${p.code} กลับมาแล้ว`);
    };
    const toggleTarget = (p, t) => {
        const hide = !t.hidden;
        if (hide && !window.confirm(`ซ่อน Target "${t.target}" ของ ${p.code}?\nแคมเปญใหม่จะเลือก Target นี้ให้สินค้านี้ไม่ได้ · แคมเปญเก่าไม่เสีย · กดเอากลับได้`)) return;
        patch('t:' + p.code + ':' + t.target, '/catalog/targets', { code: p.code, target: t.target, hidden: hide },
            hide ? `ซ่อน Target ของ ${p.code} แล้ว` : `เอา Target ของ ${p.code} กลับมาแล้ว`);
    };

    const all = productsByBrand(brand);
    const rows = all.filter(p => showHidden || !p.hidden);
    const hiddenCount = all.filter(p => p.hidden).length;
    const locked = ready === false;
    const lockTip = locked ? 'ยังบันทึกไม่ได้ — ต้องรัน setup-db ก่อน' : undefined;

    return (
        <div className="catg-page">
            <header className="page-head with-action">
                <div>
                    <h1>Products &amp; Targets</h1>
                    <p className="page-sub">สินค้าและ Target ที่ใช้ในฟอร์มแคมเปญ · ชื่อ Target ต้องตรงกับระบบยิงแอดทุกตัวอักษร</p>
                </div>
            </header>

            {locked && <div className="catg-warn big" role="alert">⚠ ยังไม่ได้สร้างตารางของหน้านี้ในฐานข้อมูล (ต้องรัน setup-db) — ดูรายการได้ แต่ยังเพิ่ม/ซ่อนไม่ได้</div>}
            {error && <div className="alert-error">{error}</div>}
            {note && <div className="agency-saved catg-note">✓ {note}</div>}

            <div className="catg-brands" role="tablist" aria-label="แบรนด์">
                {BRANDS.map(b => {
                    const n = productsByBrand(b).filter(p => !p.hidden).length;
                    return (
                        <button type="button" key={b} role="tab" aria-selected={b === brand} className={'brand-chip' + (b === brand ? ' active' : '')} onClick={() => pickBrand(b)}>
                            {b} <span className="catg-count">{n}</span>
                        </button>
                    );
                })}
            </div>

            <div className="catg-toolbar">
                <button type="button" className="btn-primary" disabled={locked} title={lockTip} onClick={() => setModal({ kind: 'product' })}><Icon name="plus" size={16} /> เพิ่มสินค้า</button>
                <button type="button" className="btn-ghost" disabled={locked || !all.some(p => !p.hidden)} title={lockTip} onClick={() => setModal({ kind: 'target' })}><Icon name="plus" size={16} /> เพิ่ม Target</button>
                <label className="catg-showhidden">
                    <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
                    แสดงที่ซ่อนไว้{hiddenCount ? ` (${hiddenCount} สินค้า)` : ''}
                </label>
            </div>

            <div className="panel no-pad catg-panel">
                <div className="catg-scroll">
                    <table className="data-table catg-table">
                        <thead>
                            <tr><th>รหัส</th><th>ชื่อสินค้า</th><th>Target</th><th className="actions">จัดการ</th></tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan="4" className="empty">{all.length ? 'ทุกสินค้าของแบรนด์นี้ถูกซ่อนอยู่ — ติ๊ก "แสดงที่ซ่อนไว้"' : `แบรนด์ ${brand} ยังไม่มีสินค้าในคลัง — กด "เพิ่มสินค้า"`}</td></tr>
                            ) : rows.map(p => {
                                const targets = targetEntriesOf(p.code).filter(t => showHidden || !t.hidden);
                                return (
                                    <tr key={p.code} className={p.hidden ? 'catg-hidden-row' : ''}>
                                        <td className="catg-code">
                                            <b>{p.code}</b>
                                            {!p.builtin && <span className="catg-badge new">เพิ่มเอง</span>}
                                            {p.hidden && <span className="catg-badge off">ซ่อนอยู่</span>}
                                        </td>
                                        <td>{p.name}</td>
                                        <td>
                                            <div className="catg-targets">
                                                {targets.map(t => (
                                                    <span key={t.target} className={'catg-chip' + (t.hidden ? ' off' : '') + (!t.builtin ? ' new' : '')} title={t.hidden ? 'ซ่อนอยู่' : t.target}>
                                                        {t.target}
                                                        <button type="button" disabled={locked || !!busy} title={lockTip || (t.hidden ? 'เอากลับมาใช้' : 'ซ่อน Target นี้')}
                                                            aria-label={`${t.hidden ? 'เอากลับ' : 'ซ่อน'} Target ${t.target} ของ ${p.code}`} onClick={() => toggleTarget(p, t)}>
                                                            {t.hidden ? '↺' : '×'}
                                                        </button>
                                                    </span>
                                                ))}
                                                {!p.hidden && (
                                                    <button type="button" className="catg-add-t" disabled={locked} title={lockTip || `เพิ่ม Target ให้ ${p.code}`}
                                                        aria-label={`เพิ่ม Target ให้ ${p.code}`} onClick={() => setModal({ kind: 'target', codes: [p.code] })}>+</button>
                                                )}
                                                {!targets.length && p.hidden && <span className="muted">—</span>}
                                            </div>
                                        </td>
                                        <td className="actions">
                                            <span className="row-actions">
                                                {!p.builtin && !p.hidden && (
                                                    <button type="button" className="icon-btn" disabled={locked} title={lockTip || 'แก้ชื่อ'} aria-label={`แก้ชื่อ ${p.code}`}
                                                        onClick={() => setModal({ kind: 'rename', product: p })}><Icon name="edit" size={15} /></button>
                                                )}
                                                <button type="button" className={'catg-toggle' + (p.hidden ? ' back' : '')} disabled={locked || busy === 'p:' + p.code} title={lockTip}
                                                    aria-label={`${p.hidden ? 'เอากลับ' : 'ซ่อน'} ${p.code}`} onClick={() => toggleProduct(p)}>
                                                    {p.hidden ? 'เอากลับ' : 'ซ่อน'}
                                                </button>
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            <p className="catg-foot">กด × ที่ Target = ซ่อน (แคมเปญเก่าไม่เสีย กดเอากลับได้) · ซ่อนสินค้า = แคมเปญใหม่เลือกไม่ได้ · รหัสสินค้าแก้/ลบไม่ได้ · เพิ่มแบรนด์ใหม่ต้องแก้ในระบบ</p>

            {modal && modal.kind === 'product' && <AddProductModal brand={brand} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'target' && <AddTargetModal brand={brand} preset={modal.codes} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'rename' && <RenameModal product={modal.product} onClose={() => setModal(null)} onSaved={saved} />}
        </div>
    );
}
