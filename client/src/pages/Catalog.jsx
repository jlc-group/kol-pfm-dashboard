import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import { BRANDS, visibleBrands } from '../data/brands.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ColumnFilter from '../components/ColumnFilter.jsx';
import { sortProducts, prefixOptions, codePrefix, SORT_MODES, isSortMode } from '../data/catalogSort.js';
import { productsByBrand, productInfo, targetEntriesOf, targetsForProduct, sharedTargetsExcept, PRODUCT_CATALOG,
    isProductSet, setsContaining, expandProductFamilies, productName, inColorFamily } from '../data/products.js';
import { setCatalogFromServer } from '../data/catalogLoader.js';
import { useCatalogVersion } from '../data/useCatalog.js';

// ===== หน้า Products & Targets (เมนู ADMIN · ผู้ใช้สั่ง 7 ต.ค. 2026 · ทีม Ads เข้าได้ด้วยตั้งแต่ 21 ต.ค. 2026) =====
// ทีม Ads เห็น/แก้ได้เฉพาะแบรนด์ที่ตัวเองมีสิทธิ์ (server ตรวจซ้ำ routes/catalog.js) · admin ทุกแบรนด์
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
// วิธีเรียงตาราง (22 ต.ค. 2026) — จำไว้ให้เปิดมาครั้งหน้าเหมือนเดิม
const SORT_KEY = 'kol:catalog-sort';
const readSort = () => { try { const v = localStorage.getItem(SORT_KEY) || ''; return isSortMode(v) ? v : ''; } catch { return ''; } };
const saveSort = v => { try { localStorage.setItem(SORT_KEY, v); } catch { /* เปิดแบบไม่เก็บข้อมูล */ } };

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
// ignore = ชื่อเดิมตอนแก้ไข (แก้แค่ตัวพิมพ์ไม่ต้องเตือนว่าคล้ายชื่อตัวเอง)
function TargetNameField({ value, onChange, confirmed, onConfirm, autoFocus, ignore }) {
    const name = value.trim();
    const similar = name ? allTargetNames().filter(t => t !== name && t !== ignore && loose(t) === loose(name)) : [];
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

// ===== สินค้าในเซ็ต (ผู้ใช้สั่ง 11 พ.ย. 2026 — JNPSET1 หน้า Ads ขึ้นเป็น JNP1, JNP2, JNP3) =====
// ตัวเลือก = สินค้าแบรนด์เดียวกัน ไม่ใช่ตัวเอง ไม่ใช่เซ็ต (ไม่ซ้อนเซ็ต) · ที่ซ่อนอยู่ไม่ขึ้น ยกเว้นที่เลือกไว้แล้ว (กดเอาออกได้)
// ลำดับที่เก็บ = ลำดับในคลัง (JNP1, JNP2, JNP3) ไม่ใช่ลำดับที่กด — หน้า Ads / ฟีดเรียงตามนี้
const SET_MAX = 30;   // เท่ากับ server routes/catalog.js SET_MAX
const catalogOrder = codes => {
    const idx = new Map(PRODUCT_CATALOG.map((p, i) => [p.code, i]));
    return [...codes].sort((a, b) => (idx.has(a) ? idx.get(a) : 1e9) - (idx.has(b) ? idx.get(b) : 1e9));
};
function setCandidates(brand, self, value) {
    return productsByBrand(brand).filter(p => p.code !== self && !isProductSet(p.code) && (!p.hidden || value.includes(p.code)));
}
function SetItemsPicker({ brand, self, value, onChange }) {
    const list = setCandidates(brand, self, value);
    const toggle = c => onChange(catalogOrder(value.includes(c) ? value.filter(x => x !== c) : [...value, c]));
    if (!list.length) return <small className="catg-hint">แบรนด์นี้ยังไม่มีสินค้าอื่นให้ใส่ในเซ็ต</small>;
    return (
        <div className="catg-pick" role="group" aria-label="สินค้าในเซ็ต">
            {list.map(p => (
                <button type="button" key={p.code} className={'catg-pick-item' + (value.includes(p.code) ? ' on' : '')} aria-pressed={value.includes(p.code)}
                    title={p.name} onClick={() => toggle(p.code)}>
                    {value.includes(p.code) ? '☑' : '☐'} {p.code}{p.hidden ? ' · ซ่อน' : ''}
                </button>
            ))}
        </div>
    );
}
// สรุปผลบนหน้า Ads — สินค้าข้างในที่มีหลายสีกางทุกสี (เหมือนช่อง PRODUCTS จริง)
function SetPreview({ code, items }) {
    const name = code || 'รหัสนี้';
    if (!items.length) return <span>ไม่ติ๊กเลย = {name} ไม่เป็นเซ็ต · หน้า Ads ขึ้น {name} ตามเดิม</span>;
    return (
        <span>หน้า Ads ช่อง PRODUCTS และฟีดยิงแอด: <b>{name}</b> → <b>{expandProductFamilies(items).join(', ')}</b>
            {' '}· ป้ายใต้ชื่อ KOL ยังขึ้น {name} ตามที่รีวิวจริง · คลิปเดิมที่รีวิว {name} บนหน้า Ads เปลี่ยนตามทันที</span>
    );
}

function SetItemsModal({ product, onClose, onSaved }) {
    const [items, setItems] = useState(() => catalogOrder(product.items || []));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const before = catalogOrder(product.items || []);
    const parents = setsContaining(product.code);
    const unchanged = items.length === before.length && items.every((c, i) => c === before[i]);
    const problems = [];
    if (items.length && parents.length) problems.push(`${product.code} อยู่ในเซ็ต ${parents.join(', ')} แล้ว — ตั้งเป็นเซ็ตไม่ได้`);
    if (items.length > SET_MAX) problems.push(`ใส่สินค้าในเซ็ตได้ไม่เกิน ${SET_MAX} ตัว (ตอนนี้ ${items.length})`);
    if (unchanged) problems.push('ยังไม่ได้เปลี่ยนสินค้าในเซ็ต');
    const close = () => { if (!saving) onClose(); };
    async function submit(e) {
        e.preventDefault();
        if (saving) return;
        if (problems.length) { setError(problems.join(' · ')); return; }
        setError(''); setSaving(true);
        try {
            const res = await api(`/catalog/products/${encodeURIComponent(product.code)}`, { method: 'PATCH', body: { items } });
            onSaved(res.data, items.length ? `ตั้งสินค้าในเซ็ต ${product.code} แล้ว (${items.join(', ')})` : `${product.code} ไม่เป็นเซ็ตแล้ว`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title={`สินค้าในเซ็ต · ${product.code}`} onClose={close}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>เซ็ต</label>
                    <div><b>{product.code}</b> - {product.name}</div>
                </div>
                <div className="field">
                    <div className="catg-label-row">
                        <label>สินค้าข้างในเซ็ต <span className="catg-opt">{items.length} ตัว</span></label>
                        {items.length > 0 && <button type="button" className="catg-link" onClick={() => setItems([])}>ไม่เลือกเลย</button>}
                    </div>
                    <SetItemsPicker brand={product.brand} self={product.code} value={items} onChange={setItems} />
                </div>
                {parents.length > 0 && <div className="catg-warn" role="alert">⚠ {product.code} อยู่ในเซ็ต {parents.join(', ')} แล้ว — ตั้งเป็นเซ็ตซ้อนไม่ได้</div>}
                {items.length > SET_MAX && <div className="catg-warn" role="alert">⚠ ใส่สินค้าในเซ็ตได้ไม่เกิน {SET_MAX} ตัว (ตอนนี้ {items.length})</div>}
                <div className="catg-warn catg-usage" role="status"><SetPreview code={product.code} items={items} /></div>
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={close} disabled={saving}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving || problems.length > 0}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                </div>
            </form>
        </Modal>
    );
}

function AddProductModal({ brand, brands, setsReady, onClose, onSaved }) {
    const [form, setForm] = useState({ brand, code: '', name: '' });
    const [items, setItems] = useState([]);            // สินค้าในเซ็ต (ไม่บังคับ — ติ๊กเฉพาะสินค้าที่เป็นเซ็ต)
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
    if (setsReady && items.filter(c => c !== code).length > SET_MAX) problems.push(`สินค้าในเซ็ตไม่เกิน ${SET_MAX} ตัว`);
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
            const set = setsReady ? items.filter(c => c !== code) : [];
            const res = await api('/catalog/products', { method: 'POST', body: { code, name: form.name.trim(), brand: form.brand, targets: picked, ...(set.length ? { items: set } : {}) } });
            onSaved(res.data, `เพิ่มสินค้า ${code} แล้ว${set.length ? ` (เซ็ต: ${set.join(', ')})` : ''}`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title="เพิ่มสินค้า" onClose={onClose}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>แบรนด์ *</label>
                    <select value={form.brand} onChange={e => { setForm(f => ({ ...f, brand: e.target.value })); setPicked([]); setItems([]); }} aria-label="แบรนด์">
                        {brands.map(b => <option key={b} value={b}>{b}</option>)}
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
                {setsReady && (
                    <div className="field">
                        <label>สินค้าในเซ็ต <span className="catg-opt">ไม่บังคับ · ติ๊กเฉพาะสินค้าที่เป็นเซ็ต (เช่น JNPSET1 = JNP1 + JNP2 + JNP3)</span></label>
                        <SetItemsPicker brand={form.brand} self={code} value={items.filter(c => c !== code)} onChange={setItems} />
                        {items.filter(c => c !== code).length > 0 && (
                            <small className="catg-hint"><SetPreview code={code} items={items.filter(c => c !== code)} /></small>
                        )}
                    </div>
                )}
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

// แก้ไขชื่อ Target (ผู้ใช้สั่ง 21 ต.ค. 2026) — ใช้กับสินค้าที่เลือก (ตั้งต้น = เฉพาะสินค้าที่กด · กดเพิ่มเป็นทุกสินค้าที่ใช้ชื่อนี้ได้)
// ตั้งต้นไม่เลือกทั้งแบรนด์ เพราะชื่อเดียวกันใช้ได้ถึง 14 สินค้า — กด ✎ ที่แถวไหนควรเปลี่ยนแค่แถวนั้น เว้นแต่ตั้งใจขยายเอง
// แคมเปญเดิมที่ใช้ชื่อเดิมกับสินค้านั้นเปลี่ยนตามด้วย (ผู้ใช้เลือก) — บอกจำนวนแคมเปญที่จะโดนก่อนบันทึก
function EditTargetModal({ brand, product, target, onClose, onSaved }) {
    // สินค้าซ่อนอยู่ก็นับ (แคมเปญเก่ายังใช้ได้) · สินค้าที่ซ่อนชื่อนี้ไปแล้วไม่นับ
    const users = productsByBrand(brand).filter(p => p.code !== product.code && targetsForProduct(p.code).includes(target));
    // สินค้าที่กดมาก่อนเสมอ (ถึงจะซ่อนอยู่ก็ยังแก้ได้)
    const products = [product, ...users];
    const [codes, setCodes] = useState(() => [product.code]);
    const [name, setName] = useState(target);
    const [confirmed, setConfirmed] = useState(false);
    const [usage, setUsage] = useState(null);     // null = กำลังนับ · { count, campaigns, bundled } · { error }
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const t = name.trim();
    const codesKey = codes.join(',');
    useEffect(() => {
        if (!codes.length) { setUsage({ count: 0, campaigns: [], bundled: [] }); return undefined; }
        let live = true;
        setUsage(null);
        api(`/catalog/targets/usage?target=${encodeURIComponent(target)}&codes=${encodeURIComponent(codesKey)}`)
            .then(res => { if (live) setUsage(res.data); })
            .catch(err => { if (live) setUsage({ error: err.message }); });
        return () => { live = false; };
    }, [codesKey, target, retry]);
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    // ชื่อใหม่มีอยู่แล้วในสินค้าที่เลือก (คนละตัวกับชื่อเดิม · ไม่สนตัวพิมพ์) = รวมเป็นอันเดียว และใช้ตัวสะกดที่มีอยู่
    // ไม่งั้นพิมพ์ตัวเล็กทับชื่อตั้งต้น ตัวสะกดของชื่อนั้นในสินค้าอื่นจะเปลี่ยนตามไปด้วย
    const existing = t && !sameName(t, target)
        ? codes.flatMap(c => targetEntriesOf(c).filter(x => sameName(x.target, t)).map(x => x.target))[0] || null : null;
    const to = existing || t;
    const merging = existing ? codes.filter(c => targetEntriesOf(c).some(x => sameName(x.target, t))) : [];
    const allOn = codes.length === products.length;
    const problems = [];
    if (!t) problems.push('ชื่อ Target');
    else if (/[,，]/.test(t)) problems.push('ชื่อ Target ห้ามมีจุลภาค (,)');
    else if (t === target) problems.push('ชื่อใหม่ยังเหมือนชื่อเดิม');
    if (!codes.length) problems.push('เลือกสินค้าอย่างน้อย 1 ตัว');
    if (t && t !== target && !confirmed) problems.push('ติ๊กยืนยันชื่อ Target');
    const n = usage && !usage.error ? usage.count : null;
    const bundled = (usage && !usage.error && usage.bundled) || [];
    const close = () => { if (!saving) onClose(); };
    async function submit(e) {
        e.preventDefault();
        if (saving) return;
        if (problems.length) { setError('ยังไม่ครบ: ' + problems.join(', ')); return; }
        if (n === null) { setError(usage && usage.error ? 'นับแคมเปญไม่สำเร็จ — กด "นับใหม่" ก่อน' : 'รอนับแคมเปญที่ใช้ชื่อนี้ให้เสร็จก่อน'); return; }
        // สินค้าในคลัง (ทุกแบรนด์) ที่ยังใช้ชื่อเดิมหลังแก้ — server ใช้ตัดสินแคมเปญแบบเก่าที่ Target ก้อนเดียวใช้กับหลายสินค้า
        const keep = PRODUCT_CATALOG.filter(p => !codes.includes(p.code) && targetEntriesOf(p.code).some(x => sameName(x.target, target))).map(p => p.code);
        setError(''); setSaving(true);
        try {
            const res = await api('/catalog/targets/rename', { method: 'POST', body: { from: target, to, codes, keep } });
            const done = (res.campaigns || []).length;
            onSaved(res.data, `แก้ชื่อ Target เป็น ${to} แล้ว (${codes.length} สินค้า${done ? ` · เปลี่ยนในแคมเปญเดิม ${done} แคมเปญ` : ''})`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }
    return (
        <Modal title={`แก้ไข Target · ${brand}`} onClose={close}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>ชื่อเดิม</label>
                    <div className="catg-exact catg-old-name">{target}</div>
                </div>
                <TargetNameField value={name} onChange={v => { setName(v); setConfirmed(false); }}
                    confirmed={confirmed} onConfirm={setConfirmed} autoFocus ignore={target} />
                <div className="field">
                    {/* ปุ่มอยู่นอก <label> — ไม่งั้นกดที่ตัวหนังสือ "แก้ให้สินค้า" ก็ไปกดปุ่มสลับสินค้าทั้งหมดด้วย */}
                    <div className="catg-label-row">
                        <label>แก้ให้สินค้า * <span className="catg-opt">{codes.length} / {products.length}</span></label>
                        {products.length > 1 && (
                            <button type="button" className="catg-link" onClick={() => setCodes(allOn ? [product.code] : products.map(p => p.code))}>
                                {allOn ? `เฉพาะ ${product.code}` : `ทุกสินค้าที่ใช้ชื่อนี้ (${products.length})`}
                            </button>
                        )}
                    </div>
                    <div className="catg-pick">
                        {products.map(p => (
                            <button type="button" key={p.code} className={'catg-pick-item' + (codes.includes(p.code) ? ' on' : '')} aria-pressed={codes.includes(p.code)}
                                title={p.name} onClick={() => setCodes(c => (c.includes(p.code) ? c.filter(x => x !== p.code) : [...c, p.code]))}>
                                {codes.includes(p.code) ? '☑' : '☐'} {p.code}{p.hidden ? ' · ซ่อน' : ''}
                            </button>
                        ))}
                    </div>
                    {merging.length > 0 && <small className="catg-hint">{merging.join(', ')} มีชื่อ {existing} อยู่แล้ว — จะรวมเป็นอันเดียว{existing !== t ? ` (ใช้ตัวสะกด ${existing} ที่มีอยู่)` : ''}</small>}
                </div>
                {/* เนื้อหาห่อใน <span> — .catg-warn เป็น flex ข้อความกับตัวหนาจะแตกเป็นหลายคอลัมน์ */}
                <div className="catg-warn catg-usage" role="status">
                    {usage === null ? <span>กำลังนับแคมเปญที่ใช้ชื่อนี้…</span>
                        : usage.error ? <span>นับแคมเปญไม่ได้: {usage.error} <button type="button" className="catg-link" onClick={() => setRetry(x => x + 1)}>นับใหม่</button></span>
                        : usage.count === 0 ? <span>ยังไม่มีแคมเปญไหนใช้ชื่อนี้กับสินค้าที่เลือก — แก้แค่ในคลัง</span>
                        : <span>แคมเปญเดิมที่ใช้ชื่อนี้กับสินค้าที่เลือก <b>{usage.count} แคมเปญ</b> จะเปลี่ยนเป็นชื่อใหม่ด้วย:{' '}
                            {usage.campaigns.slice(0, 6).map(c => c.name).join(', ')}{usage.count > 6 ? ` และอีก ${usage.count - 6} แคมเปญ` : ''}
                            {bundled.length > 0 && <> · <b>{bundled.join(', ')}</b> อยู่ในชุดเดียวกับสินค้าที่เลือก (รีวิวรวมคลิปเดียว) ในแคมเปญนั้น จะเปลี่ยนทั้งชุด — ส่วนในคลัง {bundled.join(', ')} ยังเป็นชื่อเดิม</>}</span>}
                </div>
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={close} disabled={saving}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving || n === null}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                </div>
            </form>
        </Modal>
    );
}

// ซ่อน Target (กด × · ผู้ใช้สั่ง 6 พ.ย. 2026 "ปรับปุ่ม × ให้ถามก่อนเลย")
// เดิมซ่อนเลย แคมเปญเดิมเก็บชื่อเดิมไว้ หน้า Ads / ฟีดยิงแอดจึงยังส่งชื่อเดิม (ทีมเพิ่มชื่อใหม่ด้วย + แล้วซ่อนชื่อเดิม คิดว่าแคมเปญเปลี่ยนตาม)
// ตอนนี้: มีแคมเปญเดิมใช้ชื่อนี้กับสินค้าที่เลือก = ต้องเลือกก่อนว่า "คงชื่อเดิม" หรือ "เปลี่ยนเป็น Target อื่นของสินค้านั้น"
//   คงชื่อเดิม = PATCH ซ่อนทีละสินค้าแบบเดิม · เปลี่ยน = POST /catalog/targets/rename (ตัวเดียวกับ ✎ — ซ่อนชื่อเดิม + แก้แคมเปญในธุรกรรมเดียว)
function HideTargetModal({ brand, product, target, onClose, onSaved, onSync }) {
    // สินค้าอื่นของแบรนด์ที่ยังใช้ชื่อนี้ (ไม่ซ่อน) — เลือกซ่อนพร้อมกันได้ · สินค้าที่กดมาก่อนเสมอ
    const users = productsByBrand(brand).filter(p => p.code !== product.code && targetsForProduct(p.code).includes(target));
    const products = [product, ...users];
    const [codes, setCodes] = useState(() => [product.code]);
    const [picked, setMode] = useState('');     // '' = ยังไม่เลือก · 'keep' = คงชื่อเดิมในแคมเปญเดิม · 'replace' = เปลี่ยนเป็นชื่ออื่น
    const [pick, setPick] = useState('');
    const [usage, setUsage] = useState(null);     // null = กำลังนับ · { count, campaigns, bundled } · { error }
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const codesKey = codes.join(',');
    useEffect(() => {
        if (!codes.length) { setUsage({ count: 0, campaigns: [], bundled: [] }); return undefined; }
        let live = true;
        setUsage(null);
        api(`/catalog/targets/usage?target=${encodeURIComponent(target)}&codes=${encodeURIComponent(codesKey)}`)
            .then(res => { if (live) setUsage(res.data); })
            .catch(err => { if (live) setUsage({ error: err.message }); });
        return () => { live = false; };
    }, [codesKey, target, retry]);
    // ชื่อที่ใช้แทนได้ = Target ที่สินค้าที่เลือกทุกตัวมีอยู่แล้ว (ชื่อใหม่ที่ยังไม่มี ต้องกด + เพิ่มก่อน หรือใช้ ✎ แก้ชื่อแทน)
    const options = sharedTargetsExcept(codes, target);
    const to = options.includes(pick) ? pick : (options.length === 1 ? options[0] : '');
    // เลือก "เปลี่ยน" ไว้แล้วติ๊กสินค้าเพิ่มจนไม่มีชื่อที่ใช้แทนได้ = กลับไปยังไม่เลือก (ตัวเลือกนั้นกดไม่ได้แล้ว)
    const mode = picked === 'replace' && !options.length ? '' : picked;
    const n = usage && !usage.error ? usage.count : null;
    const bundled = (usage && !usage.error && usage.bundled) || [];
    const asking = n > 0;
    const replacing = asking && mode === 'replace';
    const allOn = codes.length === products.length;
    const close = () => { if (!saving) onClose(); };
    const problems = [];
    if (!codes.length) problems.push('เลือกสินค้าอย่างน้อย 1 ตัว');
    if (asking && !mode) problems.push('เลือกว่าแคมเปญเดิมจะใช้ Target ไหนต่อ');
    if (replacing && !to) problems.push('เลือกชื่อ Target ที่จะใช้แทน');
    async function submit(e) {
        e.preventDefault();
        if (saving) return;
        if (n === null) { setError(usage && usage.error ? 'นับแคมเปญไม่สำเร็จ — กด "นับใหม่" ก่อน' : 'รอนับแคมเปญที่ใช้ชื่อนี้ให้เสร็จก่อน'); return; }
        if (problems.length) { setError('ยังไม่ครบ: ' + problems.join(', ')); return; }
        setError(''); setSaving(true);
        if (replacing) {
            try {
                // keep = สินค้าในคลังที่ยังมีชื่อเดิม — กติกาเดียวกับ ✎ (ใช้ตัดสินแคมเปญแบบเก่าที่ Target ก้อนเดียวใช้กับหลายสินค้า)
                const keep = PRODUCT_CATALOG.filter(p => !codes.includes(p.code) && targetEntriesOf(p.code).some(x => x.target.trim().toLowerCase() === target.trim().toLowerCase())).map(p => p.code);
                const res = await api('/catalog/targets/rename', { method: 'POST', body: { from: target, to, codes, keep } });
                const done = (res.campaigns || []).length;
                onSaved(res.data, `ซ่อน ${target} แล้ว (${codes.length} สินค้า) · แคมเปญเดิม ${done} แคมเปญเปลี่ยนเป็น ${to}`);
            } catch (err) { setError(err.message); }
            finally { setSaving(false); }
            return;
        }
        // ซ่อนอย่างเดียว — route ซ่อนรับทีละสินค้า · พลาดกลางทาง = บอกว่าตัวไหนซ่อนแล้ว และอัปเดตตารางตามที่สำเร็จ
        const done = [];
        let last = null;
        try {
            for (const code of codes) {
                const res = await api('/catalog/targets', { method: 'PATCH', body: { code, target, hidden: true } });
                last = res.data; done.push(code);
            }
            onSaved(last, `ซ่อน ${target} ของ ${done.join(', ')} แล้ว${asking ? ` · แคมเปญเดิม ${n} แคมเปญยังใช้ชื่อเดิม` : ''}`);
        } catch (err) {
            if (last) onSync(last);
            setError((done.length ? `ซ่อนแล้ว ${done.join(', ')} · ` : '') + err.message);
        } finally { setSaving(false); }
    }
    return (
        <Modal title={`ซ่อน Target · ${brand}`} onClose={close}>
            {error && <div className="alert-error">{error}</div>}
            <form onSubmit={submit}>
                <div className="field">
                    <label>Target ที่จะซ่อน</label>
                    <div className="catg-exact catg-old-name">{target}</div>
                    <small className="catg-hint">ซ่อนแล้วแคมเปญใหม่จะเลือกชื่อนี้ให้สินค้าที่เลือกไม่ได้ · กด ↺ เอากลับได้</small>
                </div>
                <div className="field">
                    <div className="catg-label-row">
                        <label>ซ่อนจากสินค้า * <span className="catg-opt">{codes.length} / {products.length}</span></label>
                        {products.length > 1 && (
                            <button type="button" className="catg-link" onClick={() => setCodes(allOn ? [product.code] : products.map(p => p.code))}>
                                {allOn ? `เฉพาะ ${product.code}` : `ทุกสินค้าที่ใช้ชื่อนี้ (${products.length})`}
                            </button>
                        )}
                    </div>
                    <div className="catg-pick">
                        {products.map(p => (
                            <button type="button" key={p.code} className={'catg-pick-item' + (codes.includes(p.code) ? ' on' : '')} aria-pressed={codes.includes(p.code)}
                                title={p.name} onClick={() => setCodes(c => (c.includes(p.code) ? c.filter(x => x !== p.code) : [...c, p.code]))}>
                                {codes.includes(p.code) ? '☑' : '☐'} {p.code}{p.hidden ? ' · ซ่อน' : ''}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="catg-warn catg-usage" role="status">
                    {usage === null ? <span>กำลังนับแคมเปญที่ใช้ชื่อนี้…</span>
                        : usage.error ? <span>นับแคมเปญไม่ได้: {usage.error} <button type="button" className="catg-link" onClick={() => setRetry(x => x + 1)}>นับใหม่</button></span>
                        : usage.count === 0 ? <span>ยังไม่มีแคมเปญไหนใช้ชื่อนี้กับสินค้าที่เลือก — ซ่อนแค่ในคลัง</span>
                        : <span>แคมเปญเดิมที่ใช้ชื่อนี้กับสินค้าที่เลือก <b>{usage.count} แคมเปญ</b>: {usage.campaigns.slice(0, 6).map(c => c.name).join(', ')}
                            {usage.count > 6 ? ` และอีก ${usage.count - 6} แคมเปญ` : ''} — หน้า Ads และฟีดยิงแอดอ่าน Target จากแคมเปญ ไม่ได้อ่านจากหน้านี้</span>}
                </div>
                {asking && (
                    <div className="field">
                        <label>แคมเปญเดิมจะใช้ Target ไหนต่อ? *</label>
                        <div className="catg-choice" role="radiogroup" aria-label="แคมเปญเดิมจะใช้ Target ไหนต่อ">
                            <label className={'catg-choice-opt' + (mode === 'keep' ? ' on' : '')}>
                                <input type="radio" name="hide-target-mode" checked={mode === 'keep'} onChange={() => setMode('keep')} />
                                <span><b>คงชื่อเดิม ({target})</b><small>ซ่อนแค่ในคลัง · หน้า Ads / ฟีดยิงแอดของ {n} แคมเปญยังส่งชื่อเดิม</small></span>
                            </label>
                            <label className={'catg-choice-opt' + (mode === 'replace' ? ' on' : '') + (options.length ? '' : ' off')}>
                                <input type="radio" name="hide-target-mode" checked={mode === 'replace'} disabled={!options.length} onChange={() => setMode('replace')} />
                                <span>
                                    <b>เปลี่ยนในแคมเปญเดิมเป็น</b>
                                    {options.length
                                        ? <select value={to} aria-label="Target ที่ใช้แทน" onChange={e => { setPick(e.target.value); setMode('replace'); }}>
                                            {options.length > 1 && <option value="">— เลือก Target —</option>}
                                            {options.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                        : <small>สินค้าที่เลือก{codes.length > 1 ? 'ทุกตัว' : ''}ยังไม่มี Target อื่นให้เลือก — กด + เพิ่มชื่อใหม่ให้สินค้าก่อน หรือใช้ ✎ แก้ชื่อแทน</small>}
                                    {options.length > 0 && <small>{n} แคมเปญเปลี่ยนเป็นชื่อที่เลือกทันที (เหมือนกด ✎ แก้ชื่อ)</small>}
                                </span>
                            </label>
                        </div>
                        {replacing && bundled.length > 0 && <small className="catg-hint"><b>{bundled.join(', ')}</b> อยู่ในชุดเดียวกับสินค้าที่เลือก (รีวิวรวมคลิปเดียว) ในแคมเปญนั้น จะเปลี่ยนทั้งชุด — ส่วนในคลัง {bundled.join(', ')} ยังเป็นชื่อเดิม</small>}
                    </div>
                )}
                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={close} disabled={saving}>ยกเลิก</button>
                    <button type="submit" className="btn-primary" disabled={saving || n === null || problems.length > 0}>
                        {saving ? 'กำลังบันทึก...' : replacing ? 'ซ่อน + เปลี่ยนในแคมเปญเดิม' : 'ซ่อน'}
                    </button>
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
    // แบรนด์ที่เห็นในหน้านี้ = ที่ตัวเองมีสิทธิ์ (admin ครบ · ทีม Ads ตามที่ admin กำหนด)
    const { user } = useAuth();
    const brands = visibleBrands(user);
    const [picked, setBrand] = useState(() => readLastBrand());
    const brand = brands.includes(picked) ? picked : (brands[0] || null);
    const [showHidden, setShowHidden] = useState(false);
    // เรียงตามรหัส / ชื่อ + กรองตัวอักษรนำหน้ารหัส (ผู้ใช้สั่ง 22 ต.ค. 2026 — data/catalogSort.js)
    const [sortMode, setSortMode] = useState(readSort);
    const [prefix, setPrefix] = useState('');   // '' = ทุกรหัส · เปลี่ยนแบรนด์แล้วล้าง (ตัวอักษรของแต่ละแบรนด์ไม่เหมือนกัน)
    const [ready, setReady] = useState(null);     // null = กำลังเช็ค · false = ยังไม่ได้ setup-db
    // ตั้งสินค้าในเซ็ตได้ไหม — server ต้องตอบ sets: true (มีคอลัมน์ set_items แล้ว + server รุ่นที่รู้จักเซ็ต · 11 พ.ย. 2026)
    // server รุ่นเก่า (deploy แล้วยังไม่รีสตาร์ต) ไม่ส่งช่องนี้ = ปิดปุ่มไว้ก่อน ไม่ส่งไปให้ตอบ error
    const [setsReady, setSetsReady] = useState(false);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState('');

    useEffect(() => {
        api('/catalog')
            .then(res => { setCatalogFromServer(res.data); setReady(res.data ? res.data.ready !== false : true); setSetsReady(!!(res.data && res.data.sets === true)); })
            .catch(err => { setError(err.message); setReady(true); });
    }, []);
    useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(''), 5000);
        return () => clearTimeout(timer);
    }, [note]);
    const pickBrand = b => { setBrand(b); saveLastBrand(b); setPrefix(''); };
    const pickSort = v => { setSortMode(v); saveSort(v); };
    const saved = (data, msg) => {
        setCatalogFromServer(data);
        if (data && typeof data === 'object') setSetsReady(data.sets === true);
        setModal(null); setError(''); setNote(msg);
    };

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
    // × ซ่อน = เปิดหน้าต่างถามก่อน (แคมเปญเดิมคงชื่อเดิม / เปลี่ยนเป็นชื่ออื่น · 6 พ.ย. 2026) · ↺ เอากลับ = ทำเลยแบบเดิม
    const toggleTarget = (p, t) => {
        if (!t.hidden) { setModal({ kind: 'hide-target', product: p, target: t.target }); return; }
        patch('t:' + p.code + ':' + t.target, '/catalog/targets', { code: p.code, target: t.target, hidden: false },
            `เอา Target ของ ${p.code} กลับมาแล้ว`);
    };

    const all = brand ? productsByBrand(brand) : [];
    const visible = all.filter(p => showHidden || !p.hidden);
    const prefixOpts = prefixOptions(visible);
    // ตัวอักษรที่เลือกไว้ไม่มีในรายการแล้ว (เช่นเพิ่งปิด "แสดงที่ซ่อนไว้") = ถือว่าดูทุกรหัส ไม่ให้ตารางว่างค้าง
    const curPrefix = prefixOpts.some(o => o.value === prefix) ? prefix : '';
    // ล้างค่าที่จำไว้ด้วย — ไม่งั้นติ๊ก "แสดงที่ซ่อนไว้" / เพิ่มสินค้าตัวอักษรนั้นทีหลัง ตัวกรองจะกลับมาเองทั้งที่ ▾ ขึ้นว่าทุกรหัส (ผลรีวิว 22 ต.ค.)
    useEffect(() => { if (prefix && !curPrefix) setPrefix(''); }, [prefix, curPrefix]);
    const rows = sortProducts(visible.filter(p => !curPrefix || codePrefix(p.code) === curPrefix), sortMode);
    const hiddenCount = all.filter(p => p.hidden).length;
    // ยังไม่ได้รับแบรนด์ (ทีม Ads ที่ admin ยังไม่กำหนดแบรนด์) = ดูหรือแก้อะไรไม่ได้
    const locked = ready === false || !brand;
    const lockTip = ready === false ? 'ยังบันทึกไม่ได้ — ต้องรัน setup-db ก่อน' : (!brand ? 'ยังไม่ได้รับสิทธิ์แบรนด์' : undefined);

    return (
        <div className="catg-page">
            <header className="page-head with-action">
                <div>
                    <h1>Products &amp; Targets</h1>
                    <p className="page-sub">สินค้าและ Target ที่ใช้ในฟอร์มแคมเปญ · ชื่อ Target ต้องตรงกับระบบยิงแอดทุกตัวอักษร</p>
                </div>
            </header>

            {ready === false && <div className="catg-warn big" role="alert">⚠ ยังไม่ได้สร้างตารางของหน้านี้ในฐานข้อมูล (ต้องรัน setup-db) — ดูรายการได้ แต่ยังเพิ่ม/ซ่อนไม่ได้</div>}
            {!brand && <div className="catg-warn big" role="alert">⚠ บัญชีนี้ยังไม่ได้รับสิทธิ์แบรนด์ — ติดต่อผู้ดูแลระบบให้กำหนดแบรนด์ที่ดูแลในหน้า Users</div>}
            {error && <div className="alert-error">{error}</div>}
            {note && <div className="agency-saved catg-note">✓ {note}</div>}

            <div className="catg-brands" role="tablist" aria-label="แบรนด์">
                {brands.map(b => {
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
                <label className="catg-sort">
                    <span>เรียงตาม</span>
                    <select value={sortMode} onChange={e => pickSort(e.target.value)} aria-label="เรียงตาม">
                        {SORT_MODES.map(m => <option key={m.value || 'none'} value={m.value}>{m.label}</option>)}
                    </select>
                </label>
            </div>

            <div className="panel no-pad catg-panel">
                <div className="catg-scroll">
                    <table className="data-table catg-table">
                        <thead>
                            <tr>
                                <th className="catg-code-th">รหัส
                                    {/* กรองตามตัวอักษรนำหน้ารหัส (L, C, BTA, JNP ...) — เลขบนตัวเลือก = จำนวนสินค้า */}
                                    <ColumnFilter label="ตัวอักษรนำหน้ารหัส" value={curPrefix} onPick={setPrefix}
                                        options={[{ value: '', label: 'ทุกรหัส', count: visible.length }, ...prefixOpts]} />
                                </th>
                                <th>ชื่อสินค้า</th><th>Target</th><th className="actions">จัดการ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan="4" className="empty">{all.length ? 'ทุกสินค้าของแบรนด์นี้ถูกซ่อนอยู่ — ติ๊ก "แสดงที่ซ่อนไว้"' : (brand ? `แบรนด์ ${brand} ยังไม่มีสินค้าในคลัง — กด "เพิ่มสินค้า"` : 'ยังไม่ได้รับสิทธิ์แบรนด์ — ติดต่อผู้ดูแลระบบ')}</td></tr>
                            ) : rows.map(p => {
                                const targets = targetEntriesOf(p.code).filter(t => showHidden || !t.hidden);
                                const inSets = setsContaining(p.code);
                                return (
                                    <tr key={p.code} className={p.hidden ? 'catg-hidden-row' : ''}>
                                        <td className="catg-code">
                                            <b>{p.code}</b>
                                            {!p.builtin && <span className="catg-badge new">เพิ่มเอง</span>}
                                            {p.items.length > 0 && <span className="catg-badge set">เซ็ต</span>}
                                            {p.hidden && <span className="catg-badge off">ซ่อนอยู่</span>}
                                        </td>
                                        <td>
                                            {p.name}
                                            {/* สินค้าในเซ็ต — หน้า Ads ช่อง PRODUCTS + ฟีดยิงแอดขึ้นรหัสเหล่านี้แทนรหัสเซ็ต (11 พ.ย. 2026) */}
                                            {p.items.length > 0 && (
                                                <div className="catg-set" title="หน้า Ads ช่อง PRODUCTS และฟีดยิงแอดขึ้นสินค้าเหล่านี้แทนรหัสเซ็ต">
                                                    <span className="catg-set-label">ในเซ็ต:</span>
                                                    {p.items.map(c => <span key={c} className="catg-set-chip" title={productName(c) || c}>{c}</span>)}
                                                </div>
                                            )}
                                            {inSets.length > 0 && <div className="catg-inset">อยู่ในเซ็ต {inSets.join(', ')}</div>}
                                        </td>
                                        <td>
                                            <div className="catg-targets">
                                                {targets.map(t => (
                                                    <span key={t.target} className={'catg-chip' + (t.hidden ? ' off' : '') + (!t.builtin ? ' new' : '')} title={t.hidden ? 'ซ่อนอยู่' : t.target}>
                                                        {t.target}
                                                        {!t.hidden && (
                                                            <button type="button" className="catg-chip-edit" disabled={locked || !!busy} title={lockTip || 'แก้ไขชื่อ Target'}
                                                                aria-label={`แก้ไข Target ${t.target} ของ ${p.code}`}
                                                                onClick={() => setModal({ kind: 'edit-target', product: p, target: t.target })}>
                                                                <Icon name="edit" size={11} />
                                                            </button>
                                                        )}
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
                                                {/* ตั้งสินค้าในเซ็ต — เฉพาะสินค้าที่เพิ่มเอง (สินค้าตั้งต้นเป็นสินค้าเดี่ยว) · สินค้าที่อยู่ในเซ็ตอื่นแล้ว / อยู่ในกลุ่มสี ไม่มีปุ่ม
                                                    (server ไม่รับ) — เว้นแต่เป็นเซ็ตอยู่แล้ว ให้เปิดเอาออกได้ */}
                                                {!p.builtin && !p.hidden && (p.items.length > 0 || (!inSets.length && !inColorFamily(p.code))) && (
                                                    <button type="button" className={'catg-set-btn' + (p.items.length ? ' on' : '')} disabled={locked || !setsReady}
                                                        title={lockTip || (!setsReady ? 'ยังตั้งสินค้าในเซ็ตไม่ได้ — ต้องรัน setup-db / รอ server อัปเดต' : 'ตั้งสินค้าในเซ็ต')}
                                                        aria-label={`สินค้าในเซ็ต ${p.code}`} onClick={() => setModal({ kind: 'set', product: p })}>
                                                        เซ็ต
                                                    </button>
                                                )}
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
            <p className="catg-foot">กด ✎ ที่ Target = แก้ชื่อ (แคมเปญเดิมที่ใช้ชื่อนั้นเปลี่ยนตามด้วย) · กด × ที่ Target = ซ่อน (ถามก่อนว่าแคมเปญเดิมจะคงชื่อเดิมหรือเปลี่ยนเป็นชื่ออื่น · กด ↺ เอากลับได้) · กด "เซ็ต" = ตั้งสินค้าในเซ็ต (หน้า Ads ช่อง PRODUCTS + ฟีดยิงแอดขึ้นสินค้าข้างในแทนรหัสเซ็ต) · ซ่อนสินค้า = แคมเปญใหม่เลือกไม่ได้ · รหัสสินค้าแก้/ลบไม่ได้ · เพิ่มแบรนด์ใหม่ต้องแก้ในระบบ</p>

            {modal && modal.kind === 'product' && <AddProductModal brand={brand} brands={brands} setsReady={setsReady} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'set' && <SetItemsModal product={modal.product} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'target' && <AddTargetModal brand={brand} preset={modal.codes} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'rename' && <RenameModal product={modal.product} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'edit-target' && <EditTargetModal brand={brand} product={modal.product} target={modal.target} onClose={() => setModal(null)} onSaved={saved} />}
            {modal && modal.kind === 'hide-target' && <HideTargetModal brand={brand} product={modal.product} target={modal.target} onClose={() => setModal(null)} onSaved={saved} onSync={setCatalogFromServer} />}
        </div>
    );
}
