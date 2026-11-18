import { useState } from 'react';
import { api } from '../api/client.js';
import ProductMultiSelect from './ProductMultiSelect.jsx';
import { accountLinkProblem, accountLinkPlaceholder, normalizeAccountLink, rowWithAccountLink } from '../data/talentSocials.js';
import { groupPlatforms, contentTypesOf, tiersOf, productsFor, clipCountFor, productCodesIn, needCart, cartFor, cartValue, CART_LABEL } from '../data/adGroups.js';

// ปุ่มแก้ไขข้อมูล Account ในตารางรายชื่อฝั่งทีม (ผู้ใช้สั่ง 16 พ.ย. 2026)
// ช่องชุดเดียวกับฟอร์มแก้ไขฝั่งเอเจนซี่ · บันทึกครั้งเดียวมีผลกับทุกคลิปของคนนี้ (server: PUT /submissions/:id/person)
// ค่าตัวแก้ที่ช่อง "ค่าตัว/คลิป" ในตารางเหมือนเดิม — ฟอร์มนี้ไม่มีช่องค่าตัว
const PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'YouTube', 'X'];
const FIELDS = ['account_name', 'followers', 'platform', 'content_type', 'tier', 'product', 'agency', 'link_account'];
const norm = v => (v === null || v === undefined ? '' : String(v).trim());

/**
 * sub = แถวในตาราง (คลิปแรกของคน) · clips = ทุกคลิปของคนนี้ · group = กลุ่มที่คนนี้สังกัด (null = ไม่มีกลุ่ม)
 * agencyName = ชื่อเอเจนซี่เมื่อรายชื่อมาจากลิงก์เอเจนซี่ที่ยังใช้อยู่ (KOL Contact ล็อกตามลิงก์)
 */
export default function TeamEditKolModal({ projectId, sub, clips = [], group = null, agencyName = null, onClose, onSaved }) {
    const start = {
        account_name: sub.account_name || '', followers: Number(sub.followers) > 0 ? String(sub.followers) : '',
        platform: sub.platform || '', content_type: sub.content_type || '', tier: sub.tier || '',
        product: sub.product || '', agency: sub.agency || '', link_account: sub.link_account || ''
    };
    const [f, setF] = useState(start);
    // ตะกร้ารายคน (16 พ.ย. 2026 · TikTok) — null = ยังไม่ได้กด (ใช้ค่ารายคนเดิม / ตามกลุ่ม) · true / false = เลือกในฟอร์มนี้ · 'group' = กดใช้ตามกลุ่ม
    const [cartPick, setCartPick] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const n = Math.max(1, clips.length);

    // ลงโพสต์ / ยิงแอดแล้ว = ยอดและหน้า Ads ผูกกับ Platform เดิม — เปลี่ยน Platform ไม่ได้ (server เช็คซ้ำ)
    const posted = clips.some(c => c.ad_status === 'ยิงแล้ว' || c.post_url || c.id_post);
    const platOpts = [...(group && groupPlatforms(group).length ? groupPlatforms(group) : PLATFORMS)];
    if (start.platform && !platOpts.includes(start.platform)) platOpts.unshift(start.platform);
    const platChanged = norm(f.platform) !== norm(start.platform);
    // ล็อกเฉพาะตอนยังไม่ได้เปลี่ยน — ถ้าเปลี่ยนไปแล้วระหว่างนั้นคลิปเพิ่งลงโพสต์ ยังต้องเลือกกลับ Platform เดิมได้
    const platLocked = posted && !platChanged;
    // Tier ที่ยังใช้ได้กับ Platform / Content Type ใหม่คงไว้ · มีให้เลือกอย่างเดียวเติมให้เอง
    const fitTier = (p, ct, cur) => {
        const opts = group && p ? tiersOf(group, p, ct || null) : [];
        if (cur && opts.includes(cur)) return cur;
        return opts.length === 1 ? opts[0] : '';
    };
    // จำนวนคลิปต่อคนตั้งแยกต่อ Platform — ไม่เท่ากันต้องลบแล้วเพิ่มใหม่ในกล่องนั้น (ระบบสร้างคลิปให้ครบ)
    const needClips = group && f.platform ? clipCountFor(group, f.platform) : n;
    const clipMismatch = platChanged && needClips !== n;

    const ctOpts = group && f.platform ? contentTypesOf(group, f.platform) : [];
    const tierOpts = group && f.platform ? tiersOf(group, f.platform, f.content_type || null) : [];
    const prodOpts = group && f.platform ? productsFor(group, f.platform) : [];
    // ตะกร้า: ฐานที่ยังไม่มีช่อง cart (ยังไม่ setup-db) = ไม่มีช่องนี้ในฟอร์ม · ค่าของกลุ่มตาม Platform / Content Type ที่เลือกอยู่
    const cartReady = Object.prototype.hasOwnProperty.call(sub, 'cart');
    const showCart = cartReady && needCart(f.platform);
    const groupCart = needCart(f.platform) ? cartFor(group, f.platform, f.content_type || null) : null;
    // ย้าย Platform = server ล้างค่ารายคนเดิมให้เอง (ผลรีวิว 16 พ.ย.) จึงเริ่มจากค่ากลุ่มของ Platform ใหม่
    const ownBefore = needCart(start.platform) && !platChanged ? cartValue(sub.cart) : null;
    const cartShown = cartPick === 'group' ? groupCart : cartPick !== null ? cartPick : (ownBefore !== null ? ownBefore : groupCart);
    // ค่าที่จะเก็บ: เท่ากลุ่ม = null (ตามกลุ่ม — กลุ่มเปลี่ยนทีหลังคนนี้เปลี่ยนตาม) · ต่างจากกลุ่ม = ค่ารายคน
    // คิดทุกครั้ง (ไม่ใช่เฉพาะตอนกด) — เปลี่ยน Content Type แล้วค่ารายคนเดิมเท่ากลุ่มใหม่ = กลับเป็นตามกลุ่ม
    const cartSave = cartPick === 'group' || cartShown === null || cartShown === groupCart ? null : cartShown;
    const cartOwn = cartSave !== null;
    // ลิงก์ช่องเทียบกับ Platform ที่เลือกอยู่ (18 พ.ย. 2026) · บล็อกบันทึกเมื่อแก้ลิงก์ / ย้าย Platform
    const linkProblem = accountLinkProblem(f.platform, f.link_account);
    const linkBlock = !!linkProblem && (norm(f.link_account) !== norm(start.link_account) || platChanged);
    // ค่าเดิมที่ไม่อยู่ในตัวเลือกแล้ว ยังต้องเห็น (ไม่หายเงียบ ๆ)
    const withCur = (opts, cur) => (cur && !opts.includes(cur) ? [cur, ...opts] : opts);

    function pickPlatform(p) {
        setF(s => {
            // กลับมา Platform เดิม = ยกเลิกการเปลี่ยน → คืน Content Type / Tier / สินค้าเดิม (ไม่งั้นสินค้าที่ถูกคัดออกตอนสลับไปจะหายเงียบ ๆ)
            // ชื่อว่าง / ชื่อที่ระบบเติมจากลิงก์ → เติมใหม่ตาม Platform ที่เลือก (ชื่อที่พิมพ์เองไม่ถูกทับ · 18 พ.ย. 2026)
            const refill = next => rowWithAccountLink(next, p, next.link_account);
            if (p === start.platform) return refill({ ...s, platform: p, content_type: start.content_type, tier: start.tier, product: start.product });
            const cts = group ? contentTypesOf(group, p) : [];
            const allow = group ? productsFor(group, p) : [];
            const ct = cts.length === 1 ? cts[0] : (cts.includes(s.content_type) ? s.content_type : '');
            return refill({
                ...s, platform: p, content_type: ct, tier: fitTier(p, ct, s.tier),
                // สินค้าคัดเหลือเฉพาะรหัสที่ Platform ใหม่มี — เทียบรหัส (ค่ารูปแบบเก่า "JNP1 - ชื่อ" ก็ยังจับได้)
                product: allow.length ? productCodesIn(s.product, allow).join(',') : s.product
            });
        });
    }

    async function submit(e) {
        e.preventDefault();
        if (!f.account_name.trim()) { setError('กรุณากรอกชื่อ Account'); return; }
        if (f.followers !== '' && !(Number(f.followers) >= 0)) { setError('ยอดฟอลต้องเป็นตัวเลข'); return; }
        // ลิงก์ช่องต้องตรง Platform (18 พ.ย. 2026) — บล็อกเมื่อแก้ลิงก์หรือย้าย Platform เท่านั้น
        // ลิงก์เดิมที่เอเจนซี่กรอกไว้ (ไม่ได้แตะ) ขึ้นเตือนอย่างเดียว ไม่บล็อกการแก้ช่องอื่น (server ก็ตรวจเฉพาะช่องที่ส่งไป)
        if (linkBlock) { setError('Link Account: ' + linkProblem); return; }
        if (norm(f.link_account) !== norm(start.link_account) && f.link_account.trim() && !/^https?:\/\//i.test(normalizeAccountLink(f.link_account))) {
            setError('Link Account ต้องขึ้นต้นด้วย http:// หรือ https://'); return;
        }
        if (platChanged && posted) { setError(`เปลี่ยน Platform ไม่ได้ — คลิปของคนนี้ลงโพสต์หรือยิงแอดแล้ว · เลือกกลับเป็น ${start.platform || 'Platform เดิม'}`); return; }
        // ย้าย Platform แล้วต้องระบุ Content Type (ไม่งั้นไปกองอยู่กล่อง "ยังไม่ระบุ Content Type")
        if (platChanged && ctOpts.length > 0 && !f.content_type) { setError('กรุณาเลือก Content Type ของ ' + f.platform); return; }
        if (clipMismatch) { setError(`เปลี่ยน Platform ไม่ได้ — ${f.platform} ในกลุ่มนี้ตั้งไว้ ${needClips} คลิป แต่คนนี้มี ${n} คลิป · ลบแล้วเพิ่มใหม่ในกล่อง ${f.platform} แทน`); return; }
        // ส่งเฉพาะช่องที่เปลี่ยน — ไม่เขียนทับค่าที่ไม่ได้แตะ
        const body = {};
        FIELDS.forEach(k => {
            if (k === 'agency' && agencyName) return;
            if (norm(f[k]) === norm(start[k])) return;
            body[k] = k === 'followers' ? (f.followers === '' ? 0 : Number(f.followers))
                : k === 'link_account' ? (normalizeAccountLink(f.link_account) || null)   // "tiktok.com/@x" → เติม https://
                    : (norm(f[k]) || null);
        });
        // ตะกร้า: เก็บเฉพาะตอนต่างจากกลุ่ม (เท่ากลุ่ม = null ตามกลุ่ม · กลุ่มเปลี่ยนทีหลังคนนี้เปลี่ยนตาม) · ส่งเฉพาะตอนค่าที่เก็บเปลี่ยน
        // ค่าที่อยู่ในฐานตอนนี้ (ย้าย Platform = server ล้างเป็น null ให้อยู่แล้ว) — ต่างจากที่จะเก็บถึงส่ง
        if (cartReady && needCart(f.platform)) {
            const stored = platChanged ? null : cartValue(sub.cart);
            if (cartSave !== stored) body.cart = cartSave;
        }
        if (body.account_name === null) { setError('กรุณากรอกชื่อ Account'); return; }
        if (!Object.keys(body).length) { onClose(); return; }
        setError(''); setSaving(true);
        try {
            await api(`/projects/${projectId}/submissions/${sub.id}/person`, { method: 'PUT', body });
            onSaved();
        } catch (err) { setError(err.message); setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal tek-modal" role="dialog" aria-modal="true" aria-labelledby="tek-title" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3 id="tek-title">แก้ไขข้อมูล Account</h3>
                    <button type="button" className="modal-x" onClick={onClose} aria-label="ปิด">×</button>
                </div>
                {n > 1 && <div className="tek-note">บันทึกครั้งเดียวมีผลกับทั้ง {n} คลิปของคนนี้</div>}
                {error && <div className="alert-error">{error}</div>}
                {/* noValidate: ช่อง URL ของเบราว์เซอร์จะบล็อกลิงก์เดิมที่ไม่มี http แม้ไม่ได้แตะ — ตรวจเองใน submit เฉพาะตอนแก้ */}
                <form onSubmit={submit} noValidate>
                    <div className="field">
                        <label>ชื่อ Account *</label>
                        <input value={f.account_name} onChange={e => up('account_name', e.target.value)} placeholder="เช่น @username" required autoFocus />
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>Platform</label>
                            {platLocked ? (
                                <div className="perf-readonly" title="คลิปของคนนี้ลงโพสต์หรือยิงแอดแล้ว — เปลี่ยน Platform ไม่ได้">{f.platform || '—'} 🔒</div>
                            ) : (
                                <select value={f.platform} onChange={e => pickPlatform(e.target.value)}>
                                    {!f.platform && <option value="">— เลือก —</option>}
                                    {platOpts.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            )}
                            {clipMismatch && <small className="tek-warn">{f.platform} ตั้งไว้ {needClips} คลิป แต่คนนี้มี {n} คลิป — เปลี่ยนไม่ได้</small>}
                            {posted && platChanged && <small className="tek-warn">คลิปของคนนี้เพิ่งลงโพสต์ / ยิงแอด — เลือกกลับเป็น {start.platform}</small>}
                        </div>
                        <div className="field">
                            <label>ยอดฟอล</label>
                            <input type="number" min="0" inputMode="numeric" value={f.followers} onChange={e => up('followers', e.target.value)} placeholder="เช่น 25000" />
                        </div>
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label>Content Type</label>
                            {ctOpts.length === 1 && f.content_type === ctOpts[0] ? (
                                <div className="perf-readonly" title="กำหนดไว้ที่กลุ่มนี้ตอนตั้งแคมเปญ">{ctOpts[0]}</div>
                            ) : ctOpts.length > 0 || f.content_type ? (
                                <select value={f.content_type} onChange={e => { const v = e.target.value; setF(s => ({ ...s, content_type: v, tier: fitTier(s.platform, v, s.tier) })); }}>
                                    <option value="">— ยังไม่ระบุ —</option>
                                    {withCur(ctOpts, start.platform === f.platform ? start.content_type : '').map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            ) : <div className="perf-readonly">—</div>}
                        </div>
                        <div className="field">
                            <label>Tier</label>
                            <select value={f.tier} onChange={e => up('tier', e.target.value)} disabled={!tierOpts.length && !f.tier}>
                                <option value="">{tierOpts.length ? '— ยังไม่ระบุ —' : '— ไม่ได้ระบุ Tier —'}</option>
                                {withCur(tierOpts, f.tier).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                    {showCart && (
                        <div className="field">
                            <label id="tek-cart-l">ตะกร้า (TikTok Shop)</label>
                            <div className="tek-cart" role="radiogroup" aria-labelledby="tek-cart-l">
                                {[true, false].map(v => (
                                    <label key={String(v)} className={cartShown === v ? 'on' : ''}>
                                        <input type="radio" name="tek-cart" checked={cartShown === v} onChange={() => setCartPick(v)} />
                                        {v ? '🛒 ' : ''}{CART_LABEL[v]}
                                    </label>
                                ))}
                            </div>
                            <small className="tek-cart-hint">
                                ค่าของกลุ่ม: {groupCart === null ? 'ยังไม่ได้ตั้ง' : CART_LABEL[groupCart]}
                                {cartOwn ? <> · <b>คนนี้ตั้งรายคน</b></> : <> · คนนี้ตามกลุ่ม</>}
                                {/* ล้างค่ารายคนได้เสมอ — รวมตอนกลุ่มยังไม่ได้ตั้ง (ไม่มีปุ่มเลือกให้กดกลับเป็นค่าว่าง) */}
                                {cartOwn && (
                                    <> · <button type="button" className="tek-cart-reset" onClick={() => setCartPick('group')}>ใช้ตามกลุ่ม</button></>
                                )}
                            </small>
                        </div>
                    )}
                    <div className="field">
                        <label>Product</label>
                        {prodOpts.length > 0
                            ? <ProductMultiSelect value={f.product} options={prodOpts} onChange={v => up('product', v)} />
                            : <input value={f.product} onChange={e => up('product', e.target.value)} placeholder="สินค้า" />}
                    </div>
                    <div className="field">
                        <label>KOL Contact</label>
                        {agencyName
                            ? <input value={f.agency || agencyName} readOnly className="agency-locked" title="รายชื่อนี้มาจากลิงก์เอเจนซี่ — KOL Contact ตามชื่อเอเจนซี่" />
                            : <input value={f.agency} onChange={e => up('agency', e.target.value)} placeholder="ชื่อเอเจนซี่ หรือคนในทีมที่ติดต่อ" />}
                    </div>
                    <div className="field">
                        <label>Link Account</label>
                        {/* ใส่ลิงก์ช่องแล้วชื่อ Account ขึ้นให้เอง (ช่องชื่อว่าง / ชื่อที่ระบบเติมไว้ · ไม่ทับชื่อที่พิมพ์เอง) */}
                        <input type="url" value={f.link_account} onChange={e => { const v = e.target.value; setF(s => rowWithAccountLink(s, s.platform, v)); }}
                            placeholder={accountLinkPlaceholder(f.platform)} className={linkProblem ? 'link-bad' : undefined} aria-invalid={linkProblem ? true : undefined}
                            aria-describedby={linkProblem ? 'tek-link-warn' : undefined} />
                        {linkProblem && <small className="atr-link-warn" id="tek-link-warn" role="alert">⚠ {linkProblem}{linkBlock ? '' : ' (ลิงก์เดิม — แก้ช่องอื่นได้ตามปกติ)'}</small>}
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving || clipMismatch || linkBlock}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
