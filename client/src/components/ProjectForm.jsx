import { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api/client.js';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import { productsByBrand, productLabel, targetsForProducts, asTargetArray } from '../data/products.js';
import { CONTENT_FORMATS } from '../data/contentFormats.js';
import MultiSelect from './MultiSelect.jsx';
import { groupPlatforms, splitCsv } from '../data/adGroups.js';

const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];
// รายชื่อทีมงานที่รับเป็น Owner ของแคมเปญ — แก้/เพิ่มชื่อตรงนี้ได้เลย
// ตั้งใจไม่ดึงจากรายชื่อผู้ใช้ในระบบ เพราะบัญชีล็อกอิน (admin/member) ไม่ใช่คนที่ดูแลแคมเปญจริง
const OWNERS = ['ทราย', 'อุ้ม', 'แพรวแพรว', 'ป้อนข้าว'];
// กลุ่ม Target สำหรับการยิงแอด (ตามช่วงอายุ)
const CONTENT_TYPES = ['Review', 'Sale'];
// รูปแบบสื่อที่ต้องการจาก KOL กลุ่มนี้
const MEDIA_TYPES = ['Photo', 'VDO'];
const CODE_EXPIRE_OPTS = [7, 30, 60, 180, 365]; // จำนวนวัน Gencode ให้เลือก
const GROUP_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
const TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
// จำนวน KOL รวมของกลุ่ม = ผลรวมทุกแถว allocation (Platform/Tier/จำนวน)
const groupTotalKol = g => (g.allocations || []).reduce((s, a) => s + (Number(a.kols) || 0), 0);
// สร้าง "กลุ่มโฆษณา" เริ่มต้นจากข้อมูลเดิม (รองรับ ad_groups / products[{name,target}] / products[string])
// เลือกแบบ checkbox ติ๊กได้หลายตัวพร้อมกัน (ใช้ทั้งสินค้าและกลุ่ม Target)
// options = [{ value, label }]
function CheckMultiSelect({ options, selected, onToggle, disabled, disabledText, placeholder, emptyText, allLabel = 'ทั้งหมด' }) {
    const [open, setOpen] = useState(false);
    if (disabled) return <div className="product-picker pms-disabled">{disabledText}</div>;
    const allSelected = options.length > 0 && options.every(o => selected.includes(o.value));
    // เลือก/ยกเลิกทุกตัวในครั้งเดียว (toggle เฉพาะตัวที่ต่างจากสถานะที่ต้องการ)
    const selectAll = () => options.forEach(o => { if (!selected.includes(o.value)) onToggle(o.value); });
    const clearAll = () => options.forEach(o => { if (selected.includes(o.value)) onToggle(o.value); });
    return (
        <div className="pms">
            <button type="button" className="product-picker pms-toggle" onClick={() => setOpen(o => !o)}>
                <span>{placeholder} {selected.length > 0 ? `(เลือกแล้ว ${selected.length})` : '(ติ๊กได้หลายตัว)'}</span>
                <span className="pms-caret">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="pms-panel">
                    {options.length === 0 ? (
                        <div className="pms-empty">{emptyText}</div>
                    ) : (
                        <>
                            <button type="button" className="pms-all" onClick={allSelected ? clearAll : selectAll}>
                                {allSelected ? `✕ ยกเลิก${allLabel}` : `☑ เลือก${allLabel}`}
                            </button>
                            {options.map(o => (
                                <label className={'pms-item' + (selected.includes(o.value) ? ' on' : '')} key={o.value}>
                                    <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
                                    <span>{o.label}</span>
                                </label>
                            ))}
                        </>
                    )}
                    <button type="button" className="pms-done" onClick={() => setOpen(false)}>เสร็จ ({selected.length})</button>
                </div>
            )}
        </div>
    );
}

const emptyAlloc = () => ({ tier: '', kols: '' });   // Platform ย้ายไปอยู่ระดับกลุ่มแล้ว (allocation เหลือแค่ Tier/จำนวน)
const genKey = () => 'g' + Math.random().toString(36).slice(2, 9);
const newGroup = (over = {}) => ({ key: genKey(), platform: '', concept: '', clips: [], target: [], content_type: '', media_type: '', content_format: '', products: [], allocations: [emptyAlloc()], brief: '', draft: '', budget: '', code_expire: 60, ...over });
// แปลงข้อมูลเดิม → allocations แบบใหม่ (เหลือ tier/kols) + คืน platform ของกลุ่ม
function migAllocations(g) {
    if (Array.isArray(g.allocations) && g.allocations.length) return g.allocations.map(a => ({ tier: a.tier || '', kols: a.kols ?? '' }));
    if (g.tier_kols && Object.keys(g.tier_kols).length) {
        const al = Object.entries(g.tier_kols).filter(([, v]) => Number(v) > 0).map(([tier, v]) => ({ tier, kols: v }));
        if (al.length) return al;
    }
    if (g.tier && g.kol_count) return [{ tier: g.tier, kols: g.kol_count }];
    return [emptyAlloc()];
}
// Platform ของกลุ่ม — ในฟอร์มเก็บเป็นสตริงคั่นคอมมา (MultiSelect ใช้รูปแบบนี้)
const migPlatform = g => groupPlatforms(g).join(',');
function initGroups(editing) {
    if (Array.isArray(editing?.ad_groups) && editing.ad_groups.length) {
        // ข้อมูลเดิมงบเก็บต่อ Platform — ถ้ากลุ่มยังไม่มี budget และ Platform นั้นมีกลุ่มเดียว ให้สืบค่าจากงบ Platform
        const pb = editing.platform_budgets || {};
        const groupsPerPlat = {};
        editing.ad_groups.forEach(g => { const p = migPlatform(g); groupsPerPlat[p] = (groupsPerPlat[p] || 0) + 1; });
        return editing.ad_groups.map(g => {
            const plat = migPlatform(g);
            const seededBudget = (g.budget != null && g.budget !== '') ? g.budget : ((groupsPerPlat[plat] === 1 && Number(pb[plat]) > 0) ? pb[plat] : '');
            return newGroup({ key: g.key || genKey(), platform: plat, concept: g.concept || '', clips: [...(g.clips || [])], target: asTargetArray(g.target), content_type: g.content_type || '', media_type: g.media_type || '', content_format: g.content_format || '', brief: g.brief || '', products: [...(g.products || [])], allocations: migAllocations(g), budget: seededBudget, code_expire: Number(g.code_expire) || 60 });
        });
    }
    const prods = editing?.products || [];
    if (!prods.length) return [];
    if (typeof prods[0] === 'string') return [newGroup({ products: [...prods] })];
    const byT = {};
    prods.forEach(p => { const t = p.target || ''; (byT[t] = byT[t] || []).push(p.name); });
    return Object.entries(byT).map(([t, names]) => newGroup({ target: t ? [t] : [], products: names }));
}
const STATUS = [
    { value: 'Draft', label: 'ร่าง' },
    { value: 'Active', label: 'กำลังทำ' },
    { value: 'Completed', label: 'เสร็จสิ้น' },
    { value: 'Cancelled', label: 'ยกเลิก' }
];

// ฟอร์มสร้าง/แก้ไขแคมเปญ (ใช้ร่วมกันทั้งหน้า Projects และ ProjectDetail)
export default function ProjectForm({ editing, onClose, onSaved }) {
    const isEdit = !!editing;
    const [form, setForm] = useState({
        name: editing?.name || '',
        brand: editing?.brand || '',
        objective: editing?.objective || '',
        brief_link: editing?.brief_link || '',
        // ไม่เติมชื่อคนที่ล็อกอินให้อัตโนมัติแล้ว — ให้เลือกจากรายชื่อทีมงานเอง
        owner: editing?.owner || '',
        budget: editing?.budget ?? '',
        kol_target: editing?.kol_target ?? '',
        start_date: editing?.start_date || '',
        end_date: editing?.end_date || '',
        status: editing?.status || 'Draft'
    });
    const [adGroups, setAdGroups] = useState(() => initGroups(editing));
    // Platform ไม่ใช่ state แยกอีกแล้ว — อ่านจากกลุ่มสินค้าที่มีอยู่
    // (บรีฟหลัก/validate/ตอนบันทึก ยังใช้ตัวแปรชื่อเดิม จึงไม่ต้องแก้ที่อื่น)
    const platforms = [...new Set(adGroups.flatMap(g => splitCsv(g.platform)))];
    const [briefFile, setBriefFile] = useState(null);
    const [productBriefs, setProductBriefs] = useState(() => editing?.product_briefs || {}); // { code: { link, file } }
    const [pbFiles, setPbFiles] = useState({}); // code -> File (รออัปโหลดหลังบันทึก)
    const setPbLink = (code, link) => { setProductBriefs(m => ({ ...m, [code]: { ...(m[code] || {}), link } })); setPbFiles(f => { const n = { ...f }; delete n[code]; return n; }); };
    const setPbFile = (code, file) => { setPbFiles(f => ({ ...f, [code]: file })); setProductBriefs(m => ({ ...m, [code]: { ...(m[code] || {}), link: '' } })); };
    // บรีฟหลักต่อ Platform
    const [platformBriefs, setPlatformBriefs] = useState(() => editing?.platform_briefs || {}); // { platform: { link, file } }
    const [pfBriefFiles, setPfBriefFiles] = useState({}); // platform -> File (รออัปโหลด)
    const setPfBriefLink = (pf, link) => { setPlatformBriefs(m => ({ ...m, [pf]: { ...(m[pf] || {}), link } })); setPfBriefFiles(f => { const n = { ...f }; delete n[pf]; return n; }); };
    const setPfBriefFile = (pf, file) => { setPfBriefFiles(f => ({ ...f, [pf]: file })); setPlatformBriefs(m => ({ ...m, [pf]: { ...(m[pf] || {}), link: '' } })); };
    const briefInputRef = useRef(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    function update(k, v) { setForm(f => ({ ...f, [k]: v })); }
    // เริ่มจากกลุ่มสินค้า แล้วค่อยเลือก Platform ในหัวกลุ่ม
    const addGroup = () => setAdGroups(g => [...g, newGroup()]);
    const addAllocation = i => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, allocations: [...x.allocations, emptyAlloc()] } : x));
    const removeAllocation = (i, ai) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, allocations: x.allocations.length > 1 ? x.allocations.filter((_, j) => j !== ai) : x.allocations } : x));
    const setAllocation = (i, ai, k, v) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, allocations: x.allocations.map((a, j) => j === ai ? { ...a, [k]: v } : a) } : x));
    const removeGroup = i => setAdGroups(g => g.filter((_, idx) => idx !== i));
    // คลิปต่อคนของกลุ่ม (ชื่อคลิป) — ว่าง = 1 คน 1 คลิป
    const addClip = i => setAdGroups(g => g.map((x, idx) => idx !== i ? x : ({ ...x, clips: [...(x.clips || []), ''] })));
    const removeClip = (i, ci) => setAdGroups(g => g.map((x, idx) => idx !== i ? x : ({ ...x, clips: (x.clips || []).filter((_, j) => j !== ci) })));
    const setClip = (i, ci, v) => setAdGroups(g => g.map((x, idx) => idx !== i ? x : ({ ...x, clips: (x.clips || []).map((c, j) => j === ci ? v : c) })));
    const setGroupField = (i, k, v) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
    function addProductToGroup(i, code) {
        if (!code) return;
        setAdGroups(g => g.map((x, idx) => {
            if (idx !== i || x.products.includes(code)) return x;
            return { ...x, products: [...x.products, code] };
        }));
    }
    const removeProductFromGroup = (i, name) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, products: x.products.filter(n => n !== name) } : x));
    // ติ๊กเลือก/เอาออก สินค้าในกลุ่ม (สำหรับ checkbox หลายตัว)
    const toggleProductInGroup = (i, code) => setAdGroups(g => g.map((x, idx) => idx !== i ? x : ({ ...x, products: x.products.includes(code) ? x.products.filter(c => c !== code) : [...x.products, code] })));
    // เลือกกลุ่ม Target ได้หลายอัน (array)
    const addTargetToGroup = (i, t) => { if (!t) return; setAdGroups(g => g.map((x, idx) => (idx === i && !asTargetArray(x.target).includes(t)) ? { ...x, target: [...asTargetArray(x.target), t] } : x)); };
    const removeTargetFromGroup = (i, t) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, target: asTargetArray(x.target).filter(v => v !== t) } : x));
    const toggleTargetInGroup = (i, t) => setAdGroups(g => g.map((x, idx) => idx !== i ? x : ({ ...x, target: asTargetArray(x.target).includes(t) ? asTargetArray(x.target).filter(v => v !== t) : [...asTargetArray(x.target), t] })));

    // ตรวจว่ากรอกครบทุกช่องไหม (คืน list ช่องที่ยังไม่ครบ)
    function validate() {
        const m = [];
        if (!form.name.trim()) m.push('ชื่อแคมเปญ');
        if (!form.brand) m.push('Brand');
        if (!form.objective.trim()) m.push('รายละเอียดแคมเปญ');
        const briefOk = platforms.length > 0 && platforms.every(pf => {
            const cur = platformBriefs[pf] || {};
            return (cur.link && cur.link.trim()) || cur.file || pfBriefFiles[pf];
        });
        if (!briefOk) m.push('บรีฟหลักของแต่ละ Platform');
        const groupsOk = adGroups.length > 0 && adGroups.every(g =>
            g.platform && g.products.length && g.content_type &&
            (targetsForProducts(g.products).length === 0 || asTargetArray(g.target).length > 0) &&
            g.allocations.length > 0 && g.allocations.every(a => a.tier && (Number(a.kols) || 0) > 0));
        if (!groupsOk) m.push('กลุ่มสินค้า (Platform/สินค้า/Target/Content Type + ทุกแถว Tier/จำนวน KOL ให้ครบ)');
        if (!form.owner) m.push('Project Owner');
        if (!(adGroups.length > 0 && adGroups.every(g => Number(String(g.budget).replace(/\D/g, '')) > 0))) m.push('Budget ของแต่ละกลุ่มสินค้า');
        if (!form.start_date) m.push('วันเริ่ม (Start)');
        if (!form.end_date) m.push('วันสิ้นสุด (End)');
        return m;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!isEdit) {
            const m = validate();
            if (m.length) { setError('กรุณากรอกให้ครบทุกช่อง: ' + m.join(', ')); return; }
        }
        setError(''); setSaving(true);
        try {
            // เก็บเฉพาะกลุ่มที่มีสินค้า + ทำ products แบบ flat ไว้ให้หน้าอื่นใช้ (เช่น Agency)
            const groups = adGroups.filter(g => g.products.length && g.platform).map(g => {
                const plats = splitCsv(g.platform);
                // platform (เดี่ยว) คงไว้ให้โค้ดเก่าอ่านได้ ตัวจริงคือ platforms
                const allocations = g.allocations.filter(a => a.tier).map(a => ({ platform: plats[0] || null, tier: a.tier, kols: Number(a.kols) || 0 }));
                return { key: g.key || genKey(), platform: plats[0] || null, platforms: plats, concept: g.concept || null, target: asTargetArray(g.target), content_type: g.content_type || null, media_type: g.media_type || null, content_format: g.content_format || null, clips: (g.clips || []).map(c => String(c || '').trim()).filter(Boolean), brief: (g.brief && g.brief.trim()) ? g.brief.trim() : null, products: g.products, allocations, kol_count: allocations.reduce((s, a) => s + a.kols, 0), budget: Number(String(g.budget).replace(/\D/g, '')) || 0, code_expire: Number(g.code_expire) || 60 };
            });
            const flatProducts = groups.flatMap(g => g.products);
            const totalKol = groups.reduce((s, g) => s + g.kol_count, 0); // KOL เป้าหมายรวม = ผลรวมทุกกลุ่ม
            // บรีฟต่อสินค้า (เฉพาะสินค้าที่ยังใช้อยู่) — เก็บ link + คง file meta เดิม (ไฟล์ใหม่จะอัปหลังบันทึก)
            const usedCodes = [...new Set(flatProducts)];
            const product_briefs = {};
            usedCodes.forEach(code => {
                const cur = productBriefs[code] || {};
                product_briefs[code] = { link: (cur.link && cur.link.trim()) ? cur.link.trim() : null, file: cur.file || null };
            });
            // บรีฟหลักต่อ Platform (เฉพาะ Platform ที่ใช้อยู่)
            const platform_briefs = {};
            platforms.forEach(pf => {
                const cur = platformBriefs[pf] || {};
                platform_briefs[pf] = { link: (cur.link && cur.link.trim()) ? cur.link.trim() : null, file: cur.file || null };
            });
            // งบต่อ Platform = ผลรวมงบของกลุ่มใน Platform นั้น (ไว้ให้หน้าอื่นที่ยังดูแบบต่อ Platform ใช้)
            const platform_budgets = {};
            groups.forEach(g => {
                const plats = g.platforms.length ? g.platforms : [g.platform].filter(Boolean);
                if (!plats.length) return;
                const share = (Number(g.budget) || 0) / plats.length;   // ลงหลาย Platform = หารเท่า ๆ กัน
                plats.forEach(pf => { platform_budgets[pf] = (platform_budgets[pf] || 0) + share; });
            });
            const totalBudget = groups.reduce((s, g) => s + (Number(g.budget) || 0), 0); // งบรวม = ผลรวมทุกกลุ่ม
            const body = {
                name: form.name,
                brand: form.brand,
                objective: form.objective || null,
                brief_link: (form.brief_link && form.brief_link.trim()) ? form.brief_link.trim() : null,
                products: flatProducts,
                ad_groups: groups,
                product_briefs,
                platform_briefs,
                platform_budgets,
                owner: form.owner || null,
                budget: totalBudget,
                kol_target: totalKol,
                start_date: form.start_date || null,
                end_date: form.end_date || null
            };
            if (isEdit) body.status = form.status;

            let saved;
            if (isEdit) {
                const res = await api(`/projects/${editing.id}`, { method: 'PUT', body });
                saved = res.data;
            } else {
                const res = await api('/projects', { method: 'POST', body });
                saved = res.data;
            }
            const pid = isEdit ? editing.id : saved.id;
            // อัปโหลดไฟล์บรีฟหลักของแคมเปญ (ถ้าเลือกไฟล์ไว้)
            if (briefFile) {
                try { await uploadFile(`/projects/${pid}/brief/upload`, briefFile); }
                catch (e) { alert(`อัปโหลดบรีฟหลักไม่สำเร็จ: ${e.message}`); }
            }
            // อัปโหลดไฟล์บรีฟหลักต่อ Platform (ที่เพิ่งเลือกใหม่)
            for (const [pf, file] of Object.entries(pfBriefFiles)) {
                try { await uploadFile(`/projects/${pid}/platform-brief/${encodeURIComponent(pf)}/file`, file); }
                catch (e) { alert(`อัปโหลดบรีฟ ${pf} ไม่สำเร็จ: ${e.message}`); }
            }
            // อัปโหลดไฟล์บรีฟต่อสินค้า (ที่เพิ่งเลือกใหม่)
            for (const [code, file] of Object.entries(pbFiles)) {
                try { await uploadFile(`/projects/${pid}/product-brief/${code}/file`, file); }
                catch (e) { alert(`อัปโหลดบรีฟสินค้า ${code} ไม่สำเร็จ: ${e.message}`); }
            }
            onSaved(saved);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    const missing = validate();
    const canSubmit = isEdit || missing.length === 0;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{isEdit ? 'แก้ไขแคมเปญ' : 'สร้างแคมเปญใหม่'}</h3>
                    <button type="button" className="modal-x" onClick={onClose}>×</button>
                </div>
                {error && <div className="alert-error">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="field-row">
                        <div className="field">
                            <label>Brand</label>
                            <select value={form.brand} onChange={e => update('brand', e.target.value)}>
                                <option value="">เลือกแบรนด์</option>
                                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="field">
                        <label>ชื่อแคมเปญ *</label>
                        <input value={form.name} onChange={e => update('name', e.target.value)} required autoFocus />
                    </div>

                    <div className="field">
                        <label>รายละเอียดแคมเปญ</label>
                        <textarea rows="3" value={form.objective}
                            onChange={e => update('objective', e.target.value)}
                            placeholder="รายละเอียดของแคมเปญ..." />
                    </div>

                    {/* บรีฟหลักของแคมเปญ — ลิงก์หรือไฟล์ ใช้กับทุกกลุ่ม
                        (บรีฟแยกต่อ Platform / ต่อกลุ่ม อยู่ในส่วนกลุ่มสินค้าด้านล่าง) */}
                    <div className="field">
                        <label>บรีฟหลัก <span className="dash-section-sub">วางลิงก์ หรืออัปไฟล์ก็ได้ อย่างใดอย่างหนึ่ง</span></label>
                        <div className="pbrief-row">
                            <input className="pbrief-link" type="url" value={form.brief_link}
                                onChange={e => update('brief_link', e.target.value)}
                                placeholder="ลิงก์บรีฟ (https://...)" disabled={!!briefFile} />
                            <label className={'pbrief-file-btn' + ((briefFile || editing?.brief_file) ? ' has-file' : '')}>
                                <Icon name="upload" size={14} /> {briefFile ? briefFile.name : (editing?.brief_file ? editing.brief_file.original : 'อัปไฟล์')}
                                <input ref={briefInputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.ppt,.pptx"
                                    onChange={e => { if (e.target.files[0]) { setBriefFile(e.target.files[0]); update('brief_link', ''); } }} />
                            </label>
                            {briefFile && (
                                <button type="button" className="pbrief-file-clear" title="เอาไฟล์ออก"
                                    onClick={() => { setBriefFile(null); if (briefInputRef.current) briefInputRef.current.value = ''; }}>×</button>
                            )}
                        </div>
                    </div>

                    {/* สินค้า & กลุ่มโฆษณา — Platform ชั้นบน (มีบรีฟหลักต่อ Platform) */}
                    <div className="field">
                        <label>สินค้า &amp; กลุ่มโฆษณา <span className="dash-section-sub">กด “เพิ่มกลุ่มสินค้า” แล้วเลือก Platform ในหัวกลุ่ม เพิ่มได้หลายกลุ่ม</span></label>
                        <div className="adgroup-editor">
                            {adGroups.length === 0 && (
                                <p className="dash-section-sub" style={{ padding: '4px 2px' }}>ยังไม่มีกลุ่มสินค้า — กดปุ่มด้านล่างเพื่อเริ่ม</p>
                            )}
                            {adGroups.map((g, i) => {
                                const gTargets = targetsForProducts(g.products);
                                const gTargetSel = asTargetArray(g.target);
                                const targetOpts = [...new Set([...gTargets, ...gTargetSel])];
                                return (
                                <div className="adgroup-block" key={g.key || i}>
                                    <div className="adgroup-head">
                                        <span className="adgroup-no">กลุ่มที่ {i + 1}</span>
                                        <div className={'adgroup-platform' + (g.platform ? '' : ' empty')}>
                                            <MultiSelect value={g.platform} options={GROUP_PLATFORMS}
                                                onChange={v => setGroupField(i, 'platform', v)}
                                                placeholder="— เลือก Platform —" itemName="Platform" />
                                        </div>
                                        <input className="adgroup-concept" value={g.concept} placeholder="Concept ของกลุ่ม..."
                                            onChange={e => setGroupField(i, 'concept', e.target.value)} />
                                        <button type="button" className="adgroup-rm" title="ลบกลุ่ม" onClick={() => removeGroup(i)}>×</button>
                                    </div>
                                    <CheckMultiSelect
                                        disabled={!form.brand}
                                        disabledText="— เลือกแบรนด์ก่อน —"
                                        placeholder="+ เลือกสินค้า"
                                        emptyText="ไม่มีสินค้าในแบรนด์นี้"
                                        allLabel="ทุกสินค้า"
                                        options={productsByBrand(form.brand).map(p => ({ value: p.code, label: `${p.code} - ${p.name}` }))}
                                        selected={g.products}
                                        onToggle={code => toggleProductInGroup(i, code)}
                                    />
                                    {g.products.length > 0 && (
                                        <div className="prodchip-wrap" style={{ marginBottom: 8 }}>
                                            {g.products.map(code => (
                                                <span className="prodchip removable" key={code} title={productLabel(code)}>
                                                    {code}<button type="button" onClick={() => removeProductFromGroup(i, code)} title="เอาออก">×</button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {/* กลุ่ม Target — เลือกได้หลายอัน (ชิปที่เลือกขึ้นด้านล่างช่องเลือก) */}
                                    <div className="target-multi">
                                        <CheckMultiSelect
                                            disabled={g.products.length === 0 || targetOpts.length === 0}
                                            disabledText={g.products.length === 0 ? '— เลือกสินค้าก่อน —' : '— สินค้านี้ยังไม่มี Target —'}
                                            placeholder="+ เลือกกลุ่ม Target"
                                            emptyText="สินค้านี้ยังไม่มี Target"
                                            options={targetOpts.map(t => ({ value: t, label: t }))}
                                            selected={gTargetSel}
                                            onToggle={t => toggleTargetInGroup(i, t)}
                                        />
                                        {gTargetSel.length > 0 && (
                                            <div className="chip-list target-chips">
                                                {gTargetSel.map(t => (
                                                    <span className="chip-target lg" key={t}>🎯 {t}
                                                        <button type="button" onClick={() => removeTargetFromGroup(i, t)}>×</button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="target-multi ctype-row">
                                        <select className="target-add" value={g.content_type} onChange={e => setGroupField(i, 'content_type', e.target.value)}>
                                            <option value="">— Content Type —</option>
                                            {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <select className="target-add" value={g.media_type} onChange={e => setGroupField(i, 'media_type', e.target.value)}>
                                            <option value="">— Photo / VDO —</option>
                                            {MEDIA_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <MultiSelect value={g.content_format} options={CONTENT_FORMATS}
                                            onChange={v => setGroupField(i, 'content_format', v)}
                                            placeholder="— Content Format —" itemName="Content Format" />
                                    </div>
                                    {/* คลิปต่อคน — KOL 1 คนในกลุ่มนี้ต้องส่งกี่คลิป ตั้งชื่อคลิปได้
                                        ไม่ตั้ง = 1 คน 1 คลิป (แบบเดิม) */}
                                    <div className="clips-box">
                                        <div className="clips-head">
                                            <span className="clips-title">🎬 คลิปต่อคน</span>
                                            <span className="clips-count">{Math.max(1, (g.clips || []).length)} คลิป / คน</span>
                                        </div>
                                        {(g.clips || []).map((c, ci) => (
                                            <div className="clip-row" key={ci}>
                                                <span className="clip-no">{ci + 1}</span>
                                                <input value={c} placeholder={`ชื่อคลิปที่ ${ci + 1} เช่น คลิปงาน Event`}
                                                    onChange={e => setClip(i, ci, e.target.value)} />
                                                <button type="button" className="clip-rm" title="ลบคลิปนี้" onClick={() => removeClip(i, ci)}>×</button>
                                            </div>
                                        ))}
                                        <button type="button" className="clip-add" onClick={() => addClip(i)}>
                                            <Icon name="plus" size={14} /> เพิ่มคลิป
                                        </button>
                                        {(g.clips || []).length === 0 && (
                                            <p className="clips-hint">ยังไม่ได้ตั้ง = 1 คนส่ง 1 คลิป · กดเพิ่มคลิปถ้าคนหนึ่งต้องส่งหลายคลิป</p>
                                        )}
                                    </div>
                                    {/* จำนวนวัน Gencode (โค้ดใช้ได้กี่วัน) */}
                                    <label className="platform-budget platform-budget-row">
                                        <span>⏳ จำนวนวัน Gencode</span>
                                        <select value={g.code_expire || 60} onChange={e => setGroupField(i, 'code_expire', Number(e.target.value))}>
                                            {CODE_EXPIRE_OPTS.map(d => <option key={d} value={d}>{d} Days</option>)}
                                        </select>
                                    </label>
                                    {/* บรีฟเฉพาะกลุ่มนี้ */}
                                    <div className="target-multi">
                                        <input className="target-add" type="url" value={g.brief} onChange={e => setGroupField(i, 'brief', e.target.value)}
                                            placeholder="📄 บรีฟเฉพาะกลุ่มนี้ (ลิงก์ https://...) — เว้นว่างได้ถ้าใช้บรีฟหลัก" />
                                    </div>
                                    {/* งบของกลุ่มสินค้านี้ */}
                                    <label className="platform-budget platform-budget-row">
                                        <span>💰 Budget กลุ่มนี้</span>
                                        <input type="text" inputMode="numeric"
                                            value={(g.budget != null && g.budget !== '') ? Number(String(g.budget).replace(/\D/g, '') || 0).toLocaleString('en-US') : ''}
                                            onChange={e => setGroupField(i, 'budget', e.target.value.replace(/\D/g, ''))}
                                            placeholder="0" />
                                        <span className="pb-baht">฿</span>
                                    </label>

                                    {/* Tier · จำนวน KOL (Platform มาจากด้านบนแล้ว) */}
                                    <div className="alloc-section">
                                        <div className="alloc-head alloc-head-2"><span>Tier</span><span>จำนวน KOL</span><span /></div>
                                        {g.allocations.map((a, ai) => (
                                            <div className="alloc-row alloc-row-2" key={ai}>
                                                <select value={a.tier} onChange={e => setAllocation(i, ai, 'tier', e.target.value)}>
                                                    <option value="">— Tier —</option>
                                                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                                <input type="number" min="0" placeholder="0" value={a.kols} onChange={e => setAllocation(i, ai, 'kols', e.target.value)} />
                                                <button type="button" className="alloc-rm" title="ลบแถว" onClick={() => removeAllocation(i, ai)}>×</button>
                                            </div>
                                        ))}
                                        <button type="button" className="alloc-add" onClick={() => addAllocation(i)}>
                                            <Icon name="plus" size={14} /> เพิ่ม Tier / จำนวน
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                            <button type="button" className="adgroup-add" onClick={addGroup}>
                                <Icon name="plus" size={15} /> เพิ่มกลุ่มสินค้า
                            </button>

                            {/* บรีฟหลัก — ขึ้นตาม Platform ที่กลุ่มสินค้าเลือกไว้ */}
                            {platforms.map(pf => {
                                const cur = platformBriefs[pf] || {};
                                const pendingFile = pfBriefFiles[pf];
                                return (
                                    <div className="platform-brief" key={pf}>
                                        <span className="platform-brief-lbl">📄 บรีฟหลักของ {pf}</span>
                                        <div className="pbrief-row">
                                            <input className="pbrief-link" type="url" value={cur.link || ''} onChange={e => setPfBriefLink(pf, e.target.value)}
                                                placeholder="ลิงก์บรีฟ (https://...)" disabled={!!pendingFile} />
                                            <label className={'pbrief-file-btn' + ((pendingFile || cur.file) ? ' has-file' : '')}>
                                                <Icon name="upload" size={14} /> {pendingFile ? pendingFile.name : (cur.file ? cur.file.original : 'อัปไฟล์')}
                                                <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.ppt,.pptx"
                                                    onChange={e => { if (e.target.files[0]) setPfBriefFile(pf, e.target.files[0]); }} />
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="field">
                        <label>Project Owner</label>
                        <select value={form.owner} onChange={e => update('owner', e.target.value)}>
                            <option value="">— เลือก —</option>
                            {OWNERS.map(n => <option key={n} value={n}>{n}</option>)}
                            {form.owner && !OWNERS.includes(form.owner) && (
                                <option value={form.owner}>{form.owner}</option>
                            )}
                        </select>
                    </div>

                    <div className="field-row">
                        <div className="field">
                            <label>Period (Start)</label>
                            <DatePicker value={form.start_date} onChange={v => update('start_date', v)} />
                        </div>
                        <div className="field">
                            <label>Period (End)</label>
                            <DatePicker value={form.end_date} onChange={v => update('end_date', v)} />
                        </div>
                    </div>

                    {!isEdit && missing.length > 0 && (
                        <div className="form-missing-hint">⚠️ กรุณากรอกให้ครบก่อนบันทึก: {missing.join(' · ')}</div>
                    )}
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving || !canSubmit}>
                            {saving ? 'กำลังบันทึก...' : (isEdit ? 'บันทึกการแก้ไข' : 'สร้างแคมเปญ')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
