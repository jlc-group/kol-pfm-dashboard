import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import SideDrawer from './SideDrawer.jsx';
import DatePicker from './DatePicker.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import { productsByBrand, targetsForProducts } from '../data/products.js';
import { contentTypesFor, CAMPAIGN_TYPES, SOCIAL_CAMPAIGNS, campaignIsCtype, needCampaign, needTarget } from '../data/adGroups.js';
import { CONTENT_FORMATS } from '../data/contentFormats.js';
import { SOLO_PLATFORMS, SOLO_TIERS, SOLO_CODE_EXPIRE, SOLO_MAX_CLIPS, tierFromFollowers, baht } from '../data/soloKol.js';

// ฟอร์ม "เพิ่ม KOL รายคน" — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026)
// ส่งไป POST /api/projects/solo — server สร้างรายการ + กลุ่มโฆษณา + แถวคลิปให้เอง (ตรวจค่าซ้ำฝั่ง server: server/src/store/soloKol.js)
// ค่าตัวบังคับทุกครั้ง (ผู้ใช้เลือก) · "บันทึกแล้วเพิ่มอีกคน" จำแบรนด์ / สินค้า / งาน / ค่าตัว / ผู้ดูแล / วันที่ ไว้ ล้างแค่ข้อมูล KOL
const LAST_OWNER = 'solo.lastOwner';
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readLastOwner = () => { try { return localStorage.getItem(LAST_OWNER) || ''; } catch { return ''; } };
const saveLastOwner = v => { try { localStorage.setItem(LAST_OWNER, v); } catch { /* โหมดส่วนตัว — ไม่จำก็ได้ */ } };
const feeNum = v => Number(String(v == null ? '' : v).replace(/,/g, '').trim());
const isWeb = v => /^https?:\/\/\S+$/i.test(v);

const KOL_EMPTY = { account_name: '', platform: 'TikTok', link_account: '', followers: '', tier: '', tierTouched: false, contact_mode: '', agency: '' };
const JOB_EMPTY = brand => ({
    brand, products: [], content_type: '', campaign: '', media_type: '', content_format: '',
    clips: 1, clip_names: ['', '', '', '', ''], fee: '', owner: readLastOwner(), hire_date: todayStr(), due_date: '',
    target: [], code_expire: 60, no_gencode: false, concept: '', brief_link: '', note: ''
});

function Field({ label, req, hint, err, htmlFor, labelId, children }) {
    return (
        <div className={'qf-field' + (err ? ' has-err' : '')}>
            {htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</label>
                : <div className="qf-label" id={labelId}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</div>}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}
// ปุ่มเลือก (ตัวเดียว = radio · หลายตัว = checkbox) · disabled = ล็อกไว้ (แก้ไม่ได้)
function Chips({ options, value, onPick, multi = false, labelId, render = o => o, disabled = false }) {
    const on = o => (multi ? (value || []).includes(o) : value === o);
    return (
        <div className="qf-chips" role={multi ? 'group' : 'radiogroup'} aria-labelledby={labelId}>
            {options.map(o => (
                <button type="button" key={o} role={multi ? 'checkbox' : 'radio'} aria-checked={on(o)} disabled={disabled}
                    className={'qf-chip' + (on(o) ? ' on' : '')} onClick={() => onPick(o)}>{render(o)}</button>
            ))}
        </div>
    );
}

// ค่าในฟอร์มจากการจ้างที่มีอยู่ (โหมดแก้ไข · ช่วง 3) — อ่านจาก solo_summary + กลุ่มโฆษณา + ชื่อคลิปจริง
function fromProject(p, clipNames) {
    const s = p.solo_summary || {};
    const g = (p.ad_groups || [])[0] || {};
    const b0 = (g.blocks || [])[0] || {};
    const a0 = (g.allocations || [])[0] || {};
    const clips = Math.max(1, Math.min(SOLO_MAX_CLIPS, Number(s.clips) || clipNames.length || 1));
    const platform = g.platform || s.platform || 'TikTok';
    const k = {
        account_name: s.account_name || '', platform, link_account: s.link_account || '',
        followers: s.followers ? String(s.followers) : '', tier: s.tier || '', tierTouched: true,
        contact_mode: s.contact_mode || '', agency: s.agency || ''
    };
    const j = {
        brand: p.brand || '', products: [...(g.products || s.products || [])],
        content_type: g.content_type || a0.content_type || '', campaign: campaignIsCtype(platform) ? '' : (a0.campaign || ''),
        media_type: g.media_type || '', content_format: g.content_format || '',
        clips, clip_names: [0, 1, 2, 3, 4].map(i => (clips > 1 ? String(clipNames[i] || '') : '')),
        fee: '', owner: p.owner || '', hire_date: p.start_date || todayStr(), due_date: s.due_date || '',
        target: [...((Array.isArray(b0.target) ? b0.target : null) || (Array.isArray(g.target) ? g.target : []))],
        code_expire: Number(g.code_expire) || 60, no_gencode: g.no_gencode === true,
        concept: g.concept || '', brief_link: p.brief_link || '', note: p.objective || ''
    };
    return { k, j };
}

// project = แก้การจ้างที่มีอยู่ (PUT /projects/:id/solo) · clipNames = ชื่อคลิปเรียงตามลำดับ
// locked = มีคลิปลงงาน/ยิงแอดแล้ว — แบรนด์และ Platform แก้ไม่ได้ (server กันซ้ำ)
export default function SoloKolForm({ onClose, onSaved, project = null, clipNames = [], locked = false }) {
    const editing = !!project;
    const uid = useId();
    const id = s => `${uid}-${s}`;
    const { user } = useAuth();
    const mine = visibleBrands(user);
    // แบรนด์เดิมของการจ้างต้องอยู่ในตัวเลือกเสมอ (ไม่งั้นช่องว่าง บันทึกไม่ผ่าน)
    const brands = editing && project.brand && !mine.includes(project.brand) ? [...mine, project.brand] : mine;
    const [init] = useState(() => (editing ? fromProject(project, clipNames) : null));
    const [k, setK] = useState(() => (init ? init.k : KOL_EMPTY));
    const [j, setJ] = useState(() => (init ? init.j : JOB_EMPTY(brands.length === 1 ? brands[0] : '')));
    const [owners, setOwners] = useState([]);
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [done, setDone] = useState([]);   // ชื่อที่เพิ่มไปแล้วในรอบนี้ (บันทึกแล้วเพิ่มอีกคน)
    const wrapRef = useRef(null);
    const clean = useRef(null);
    useEffect(() => {
        let alive = true;
        api('/users/options')
            .then(res => { if (alive) setOwners((res.data || []).map(u => u.name).filter(Boolean)); })
            .catch(() => { if (alive) setOwners([]); });
        return () => { alive = false; };
    }, []);
    useEffect(() => { clean.current = JSON.stringify({ k, j }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const upK = (key, v) => setK(s => ({ ...s, [key]: v }));
    const upJ = (key, v) => setJ(s => ({ ...s, [key]: v }));
    const social = campaignIsCtype(k.platform);
    const ctypeOptions = social ? SOCIAL_CAMPAIGNS : contentTypesFor(k.platform);
    const productOptions = useMemo(() => (j.brand ? productsByBrand(j.brand) : []), [j.brand]);
    const targetOptions = useMemo(() => (needTarget(k.platform) ? targetsForProducts(j.products) : []), [k.platform, j.products]);
    const ownerOptions = j.owner && !owners.includes(j.owner) ? [...owners, j.owner] : owners;

    // เปลี่ยน Platform → Content Type / Campaign / Target ที่ไม่มีใน Platform ใหม่ล้างทิ้ง
    function pickPlatform(p) {
        setK(s => ({ ...s, platform: p }));
        setJ(s => {
            const cts = campaignIsCtype(p) ? SOCIAL_CAMPAIGNS : contentTypesFor(p);
            return { ...s, content_type: cts.includes(s.content_type) ? s.content_type : '', campaign: needCampaign(p) && !campaignIsCtype(p) ? s.campaign : '', target: needTarget(p) ? s.target : [] };
        });
    }
    function pickBrand(b) {
        // เปลี่ยนแบรนด์ = สินค้า/Target ชุดใหม่
        setJ(s => (s.brand === b ? s : { ...s, brand: b, products: [], target: [] }));
    }
    function toggleProduct(code) {
        setJ(s => {
            const products = s.products.includes(code) ? s.products.filter(x => x !== code) : [...s.products, code];
            const opts = needTarget(k.platform) ? targetsForProducts(products) : [];
            // Target ที่ไม่อยู่ในตัวเลือกใหม่ล้างทิ้ง · มีตัวเลือกเดียว = เลือกให้เลย
            let target = s.target.filter(t => opts.includes(t));
            if (!target.length && opts.length === 1) target = [opts[0]];
            return { ...s, products, target };
        });
    }
    const toggleTarget = t => setJ(s => ({ ...s, target: s.target.includes(t) ? s.target.filter(x => x !== t) : [...s.target, t] }));
    function setFollowers(v) {
        const clean = v.replace(/[^0-9]/g, '');
        setK(s => ({ ...s, followers: clean, tier: s.tierTouched ? s.tier : tierFromFollowers(clean) }));
    }

    const fee = feeNum(j.fee);
    const total = Number.isFinite(fee) && fee > 0 ? Math.round(fee * j.clips * 100) / 100 : 0;

    function errors() {
        const e = {};
        if (!k.account_name.trim().replace(/^@+/, '')) e.account_name = 'ใส่ชื่อบัญชี KOL';
        if (k.link_account.trim() && !isWeb(k.link_account.trim())) e.link_account = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
        if (!k.tier) e.tier = 'เลือก Tier';
        if (!k.contact_mode) e.contact_mode = 'เลือกช่องทางติดต่อ';
        if (k.contact_mode === 'agency' && !k.agency.trim()) e.agency = 'ใส่ชื่อ Agency (ผู้รับเงิน)';
        if (!j.brand) e.brand = 'เลือกแบรนด์';
        if (!j.products.length) e.products = 'เลือกสินค้าอย่างน้อย 1 ตัว';
        // ต้องเป็นตัวเลือกของ Platform ตอนนี้ — กันค่าที่ค้างจาก Platform ก่อน (มองไม่เห็นในปุ่ม) หลุดไปบันทึก
        if (!j.content_type || !ctypeOptions.includes(j.content_type)) e.content_type = social ? 'เลือก Campaign' : 'เลือก Content Type';
        if (targetOptions.length && !j.target.length) e.target = 'เลือก Target อย่างน้อย 1 กลุ่ม (หน้า Ads และระบบยิงแอดใช้ค่านี้)';
        if (!editing && !(Number.isFinite(fee) && fee > 0)) e.fee = 'ใส่ค่าตัวต่อคลิป';
        if (!j.owner) e.owner = 'เลือกผู้ดูแล';
        if (!j.hire_date) e.hire_date = 'เลือกวันที่จ้าง';
        if (j.due_date && j.hire_date && j.due_date < j.hire_date) e.due_date = 'กำหนดลงงานต้องไม่ก่อนวันที่จ้าง';
        if (j.clips > 1) {
            const names = j.clip_names.slice(0, j.clips).map((n, i) => n.trim() || `คลิป ${i + 1}`);
            if (new Set(names).size !== names.length) e.clips = 'ชื่อคลิปซ้ำกัน';
        }
        if (j.brief_link.trim() && !isWeb(j.brief_link.trim())) e.brief_link = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
        return e;
    }
    const errs = errors();
    const E = tried ? errs : {};
    const dirty = clean.current !== null && JSON.stringify({ k, j }) !== clean.current;

    function requestClose() {
        if (saving) return;
        if (dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดฟอร์มนี้เลยไหม?')) return;
        onClose(done.length > 0);
    }
    const toTop = () => {
        const s = wrapRef.current && wrapRef.current.closest('.side-drawer-body');
        if (s) s.scrollTo({ top: 0, behavior: 'smooth' });
    };

    async function save(again) {
        setTried(true);
        if (Object.keys(errs).length) {
            setErr('');
            setTimeout(() => {
                const el = wrapRef.current && wrapRef.current.querySelector('.qf-field.has-err');
                if (el) {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const input = el.querySelector('input:not([type=file]), textarea, select, button');
                    if (input) input.focus({ preventScroll: true });
                }
            }, 0);
            return;
        }
        setSaving(true); setErr('');
        const body = {
            account_name: k.account_name.trim(), platform: k.platform, link_account: k.link_account.trim(),
            followers: k.followers ? Number(k.followers) : 0, tier: k.tier,
            contact_mode: k.contact_mode, agency: k.contact_mode === 'agency' ? k.agency.trim() : '',
            brand: j.brand, products: j.products, content_type: j.content_type,
            campaign: social ? j.content_type : j.campaign, media_type: j.media_type, content_format: j.content_format,
            clips: j.clips, clip_names: j.clip_names.slice(0, j.clips).map(n => n.trim()),
            fee, owner: j.owner, hire_date: j.hire_date, due_date: j.due_date,
            target: j.target, code_expire: j.code_expire, no_gencode: j.no_gencode,
            concept: j.concept.trim(), brief_link: j.brief_link.trim(), note: j.note.trim()
        };
        try {
            if (editing) {
                // แก้ไข: ค่าตัวไม่ส่ง (แก้ที่ช่องค่าตัวในหน้า KOL) — server ตัดสินเพิ่ม/ลดคลิป และล็อกแบรนด์/Platform
                delete body.fee;
                const res = await api(`/projects/${encodeURIComponent(project.id)}/solo`, { method: 'PUT', body });
                saveLastOwner(j.owner);
                onSaved && onSaved(res && res.data, { again: false });
                return;
            }
            const res = await api('/projects/solo', { method: 'POST', body });
            // ห้ามชื่อ project — ซ้ำกับค่าที่ส่งเข้าฟอร์ม (โหมดแก้ไข) แล้วกลายเป็นตัวแปรที่ยังไม่ถูกตั้งค่า (TDZ)
            const created = res && res.data && res.data.project;
            saveLastOwner(j.owner);
            const who = '@' + body.account_name.replace(/^@+/, '');
            if (again) {
                // เก็บงาน/แบรนด์/ค่าตัว/ผู้ดูแลไว้ ล้างแค่ข้อมูล KOL
                setDone(d => [...d, who]);
                // คง Platform ไว้ด้วย — Content Type / Campaign / Target ที่จำไว้เป็นของ Platform นี้
                const nextK = { ...KOL_EMPTY, platform: k.platform };
                setK(nextK);
                setTried(false);
                clean.current = JSON.stringify({ k: nextK, j });
                onSaved && onSaved(created, { again: true });
                toTop();
                const first = wrapRef.current && wrapRef.current.querySelector('input');
                if (first) first.focus({ preventScroll: true });
            } else {
                onSaved && onSaved(created, { again: false });
            }
        } catch (e) {
            // server ยังเป็นรุ่นเก่า (ยังไม่รีสตาร์ตหลัง deploy) = ไม่มีเส้นนี้
            setErr(e.status === 404 ? 'เซิร์ฟเวอร์ยังไม่อัปเดต — กด F5 แล้วลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ' : (e.message || 'บันทึกไม่สำเร็จ'));
            toTop();
        } finally {
            setSaving(false);
        }
    }

    const footer = (
        <>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={saving}>ยกเลิก</button>
            {!editing && <button type="button" className="btn-ghost" onClick={() => save(true)} disabled={saving}>บันทึกแล้วเพิ่มอีกคน</button>}
            <button type="button" className="btn-primary" onClick={() => save(false)} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </>
    );

    return (
        <SideDrawer title={editing ? 'แก้ข้อมูล KOL รายคน' : 'เพิ่ม KOL รายคน'}
            subtitle={editing ? 'ค่าตัวแก้ที่ช่อง "ค่าตัวต่อคลิป" ในหน้านี้ · ลดจำนวนคลิปได้เฉพาะคลิปที่ยังไม่เริ่มงาน'
                : 'จ้าง KOL เดี่ยว ไม่ต้องสร้างแคมเปญ · ติดตามงาน / Gencode / ยิงแอด / ทำจ่าย ได้เหมือนแคมเปญ'}
            onClose={requestClose} footer={footer} width={640} busy={saving} className="qf-drawer solo-drawer">
            <div className="qf" ref={wrapRef}>
                {err && <div className="alert-error" role="alert">{err}</div>}
                {done.length > 0 && <div className="solo-added" role="status">เพิ่มแล้ว {done.length} คน: {done.join(', ')}</div>}

                <section className="qf-sec">
                    <h3 className="qf-sec-head"><span className="qf-num">1</span>KOL</h3>
                    <div className="qf-row2">
                        <Field label="ชื่อบัญชี" req err={E.account_name} htmlFor={id('acc')}>
                            <input id={id('acc')} value={k.account_name} maxLength={200} autoComplete="off" autoFocus
                                onChange={e => upK('account_name', e.target.value)} placeholder="@ชื่อบัญชี" />
                        </Field>
                        <Field label="ลิงก์ช่อง" err={E.link_account} htmlFor={id('link')}>
                            <input id={id('link')} value={k.link_account} maxLength={1000} autoComplete="off"
                                onChange={e => upK('link_account', e.target.value)} placeholder="https://www.tiktok.com/@..." />
                        </Field>
                    </div>
                    <Field label="Platform" req labelId={id('plat')} hint={editing && locked ? 'ล็อกแล้ว — มีคลิปที่ลงงาน/ยิงแอดแล้ว' : ''}>
                        <Chips options={SOLO_PLATFORMS} value={k.platform} onPick={pickPlatform} labelId={id('plat')} disabled={editing && locked} />
                    </Field>
                    <div className="qf-row2">
                        <Field label="ผู้ติดตาม" htmlFor={id('fol')} hint="ใส่แล้ว Tier จะเลือกให้อัตโนมัติ">
                            <input id={id('fol')} inputMode="numeric" value={k.followers} autoComplete="off"
                                onChange={e => setFollowers(e.target.value)} placeholder="เช่น 85000" />
                        </Field>
                        <Field label="Tier" req err={E.tier} htmlFor={id('tier')}>
                            <select id={id('tier')} value={k.tier} onChange={e => setK(s => ({ ...s, tier: e.target.value, tierTouched: true }))}>
                                <option value="">— เลือก —</option>
                                {SOLO_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </Field>
                    </div>
                    <Field label="ช่องทางติดต่อ" req err={E.contact_mode} labelId={id('mode')}>
                        <Chips options={['self', 'agency']} value={k.contact_mode} onPick={v => upK('contact_mode', v)} labelId={id('mode')}
                            render={v => (v === 'self' ? 'ติดต่อ KOL เอง' : 'ผ่าน Agency')} />
                    </Field>
                    {k.contact_mode === 'agency' && (
                        <Field label="ชื่อ Agency" req err={E.agency} htmlFor={id('ag')} hint="Agency นี้คือผู้รับเงิน (ถ้าติดต่อเอง ผู้รับเงินคือตัว KOL)">
                            <input id={id('ag')} value={k.agency} maxLength={200} autoComplete="off" onChange={e => upK('agency', e.target.value)} />
                        </Field>
                    )}
                </section>

                <section className="qf-sec">
                    <h3 className="qf-sec-head"><span className="qf-num">2</span>งาน</h3>
                    <Field label="แบรนด์" req err={E.brand} labelId={id('brand')} hint={editing && locked ? 'ล็อกแล้ว — มีคลิปที่ลงงาน/ยิงแอดแล้ว' : ''}>
                        {brands.length ? <Chips options={brands} value={j.brand} onPick={pickBrand} labelId={id('brand')} disabled={editing && locked} />
                            : <p className="muted">บัญชีนี้ยังไม่ได้รับสิทธิ์แบรนด์ไหน — ติดต่อผู้ดูแลระบบ</p>}
                    </Field>
                    {j.brand && (
                        <Field label="สินค้า" req err={E.products} labelId={id('prod')} hint="เลือกได้หลายตัว">
                            <div className="qf-chips solo-products" role="group" aria-labelledby={id('prod')}>
                                {productOptions.map(p => (
                                    <button type="button" key={p.code} role="checkbox" aria-checked={j.products.includes(p.code)} title={p.name}
                                        className={'qf-chip' + (j.products.includes(p.code) ? ' on' : '')} onClick={() => toggleProduct(p.code)}>
                                        {p.code}<span className="solo-prod-name"> {p.name}</span>
                                    </button>
                                ))}
                            </div>
                        </Field>
                    )}
                    <Field label={social ? 'Campaign' : 'Content Type'} req err={E.content_type} labelId={id('ct')}>
                        <Chips options={ctypeOptions} value={j.content_type} onPick={v => upJ('content_type', v)} labelId={id('ct')} />
                    </Field>
                    <Field label="จำนวนคลิป" req err={E.clips} labelId={id('clips')}>
                        <Chips options={Array.from({ length: SOLO_MAX_CLIPS }, (_, i) => i + 1)} value={j.clips}
                            onPick={v => upJ('clips', v)} labelId={id('clips')} render={v => `${v} คลิป`} />
                        {j.clips > 1 && (
                            <div className="solo-clip-names">
                                {Array.from({ length: j.clips }, (_, i) => (
                                    <input key={i} value={j.clip_names[i]} maxLength={100} aria-label={`ชื่อคลิป ${i + 1}`}
                                        placeholder={`คลิป ${i + 1}`}
                                        onChange={e => setJ(s => ({ ...s, clip_names: s.clip_names.map((n, x) => (x === i ? e.target.value : n)) }))} />
                                ))}
                            </div>
                        )}
                    </Field>
                    {!editing && (
                        <Field label="ค่าตัวต่อคลิป (บาท)" req err={E.fee} htmlFor={id('fee')}
                            hint={total > 0 ? `${baht(fee)} × ${j.clips} คลิป = ${baht(total)}` : 'ต้องใส่ทุกครั้ง'}>
                            <input id={id('fee')} inputMode="decimal" value={j.fee} autoComplete="off"
                                onChange={e => upJ('fee', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="เช่น 5000" />
                        </Field>
                    )}
                    <Field label="ผู้ดูแล" req err={E.owner} htmlFor={id('owner')}>
                        <select id={id('owner')} value={j.owner} onChange={e => upJ('owner', e.target.value)}>
                            <option value="">— เลือก —</option>
                            {ownerOptions.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </Field>
                    <div className="qf-row2">
                        <Field label="วันที่จ้าง" req err={E.hire_date} labelId={id('hd')}>
                            <DatePicker value={j.hire_date} onChange={v => upJ('hire_date', v || '')} />
                        </Field>
                        <Field label="กำหนดลงงาน" err={E.due_date} labelId={id('dd')} hint="ไม่มีก็เว้นไว้">
                            <DatePicker value={j.due_date} onChange={v => upJ('due_date', v || '')} />
                        </Field>
                    </div>
                </section>

                <section className="qf-sec">
                    <h3 className="qf-sec-head"><span className="qf-num">3</span>ข้อมูลยิงแอด
                        <span className="qf-sec-sub">{needTarget(k.platform) ? 'Target บังคับ (ระบบยิงแอดใช้) · ที่เหลือไม่บังคับ' : 'ไม่บังคับ'}</span></h3>
                    {needTarget(k.platform) && (
                        <Field label="Target" req={targetOptions.length > 0} err={E.target} labelId={id('tg')}
                            hint={j.products.length ? (targetOptions.length ? '' : 'สินค้าที่เลือกไม่มี Target ให้เลือก') : 'เลือกสินค้าก่อน'}>
                            {targetOptions.length > 0 && <Chips options={targetOptions} value={j.target} onPick={toggleTarget} multi labelId={id('tg')} />}
                        </Field>
                    )}
                    {needCampaign(k.platform) && !social && (
                        <Field label="Campaign" labelId={id('cp')}>
                            <Chips options={CAMPAIGN_TYPES} value={j.campaign} onPick={v => upJ('campaign', j.campaign === v ? '' : v)} labelId={id('cp')} />
                        </Field>
                    )}
                    <div className="qf-row2">
                        <Field label="Photo / VDO" labelId={id('mt')}>
                            <Chips options={['Photo', 'VDO']} value={j.media_type} onPick={v => upJ('media_type', j.media_type === v ? '' : v)} labelId={id('mt')} />
                        </Field>
                        <Field label="Format / Style" htmlFor={id('cf')}>
                            <select id={id('cf')} value={j.content_format} onChange={e => upJ('content_format', e.target.value)}>
                                <option value="">— ไม่ระบุ —</option>
                                {CONTENT_FORMATS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Field>
                    </div>
                    <div className="qf-row2">
                        <Field label="อายุ Gencode" htmlFor={id('ce')}>
                            <select id={id('ce')} value={j.code_expire} disabled={j.no_gencode} onChange={e => upJ('code_expire', Number(e.target.value))}>
                                {SOLO_CODE_EXPIRE.map(n => <option key={n} value={n}>{n} วัน</option>)}
                            </select>
                        </Field>
                        <Field label=" " labelId={id('ng')}>
                            <label className="solo-check">
                                <input type="checkbox" checked={j.no_gencode} onChange={e => upJ('no_gencode', e.target.checked)} /> ไม่ใช้ Gencode
                            </label>
                        </Field>
                    </div>
                    <Field label="Concept" htmlFor={id('cc')}>
                        <textarea id={id('cc')} rows={2} value={j.concept} maxLength={1000} onChange={e => upJ('concept', e.target.value)} />
                    </Field>
                    <Field label="ลิงก์บรีฟ" err={E.brief_link} htmlFor={id('bl')}>
                        <input id={id('bl')} value={j.brief_link} maxLength={1000} autoComplete="off" onChange={e => upJ('brief_link', e.target.value)} placeholder="https://..." />
                    </Field>
                    <Field label="หมายเหตุ" htmlFor={id('nt')}>
                        <textarea id={id('nt')} rows={2} value={j.note} maxLength={1000} onChange={e => upJ('note', e.target.value)} />
                    </Field>
                </section>
            </div>
        </SideDrawer>
    );
}
