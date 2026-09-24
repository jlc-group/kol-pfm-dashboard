import { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api/client.js';
import Icon from './Icon.jsx';
import DatePicker from './DatePicker.jsx';
import { productsByBrand, productLabel, targetsForProduct, asTargetArray } from '../data/products.js';
import { CONTENT_FORMATS } from '../data/contentFormats.js';
import MultiSelect from './MultiSelect.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import {
    groupPlatforms, splitCsv, needTarget, contentTypesFor, campaignTypesFor,
    emptyTier, emptySet, emptyBlock, blocksKol, toBlocks, flattenBlocks,
    num, blocksBudget, platformBudgets, blocksProducts, withProductTargets, packProductTargets,
    needCampaign, campaignIsCtype, withCampaignFromCtype, packCampaigns, setTypeOk, isSplitBudget, productBudgetSum, packBudgets,
    isSplitConcept, isBlockSplitConcept, packConcepts
} from '../data/adGroups.js';

// รายชื่อทีมงานที่รับเป็น Owner ของแคมเปญ — แก้/เพิ่มชื่อตรงนี้ได้เลย
// ตั้งใจไม่ดึงจากรายชื่อผู้ใช้ในระบบ เพราะบัญชีล็อกอิน (admin/member) ไม่ใช่คนที่ดูแลแคมเปญจริง
// รายชื่อคนดูแล/คนสร้าง ดึงจากผู้ใช้จริงที่อนุมัติแล้ว (เดิมเป็นรายชื่อตายตัวในโค้ด
// คนเข้าใหม่เลยไม่โผล่ ต้องมาแก้โค้ดทุกครั้ง)
// กลุ่ม Target สำหรับการยิงแอด (ตามช่วงอายุ)
// Content Type ต่างกันตาม Platform — Facebook ใช้ชุดของแอด ไม่ใช่ Review/Sale เหมือนช่องทางอื่น
// Content Type / Target / โครงการแบ่งงาน 3 ชั้น อยู่ที่ data/adGroups.js (ใช้ร่วมกับหน้าอื่น)
// รูปแบบสื่อที่ต้องการจาก KOL กลุ่มนี้
// ชื่อที่หน้าเว็บใช้: media_type (Photo / VDO) = "Format" · content_format (Review, Tie-in ...) = "Style" · campaign = "Campaign"
// ชื่อช่องในฐานข้อมูลยังเป็นแบบเดิม เปลี่ยนแค่ป้ายที่คนเห็น
const MEDIA_TYPES = ['Photo', 'VDO'];
const CODE_EXPIRE_OPTS = [7, 30, 60, 180, 365]; // จำนวนวัน Gencode ให้เลือก
const GROUP_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
const TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
// จำนวน KOL รวมของกลุ่ม = ผลรวมทุกแถว allocation (Platform/Tier/จำนวน)
const groupTotalKol = g => ((g.blocks && g.blocks.length)
    ? blocksKol(g.blocks)
    : (g.allocations || []).reduce((s, a) => s + (Number(a.kols) || 0), 0));
// สร้าง "กลุ่มโฆษณา" เริ่มต้นจากข้อมูลเดิม (รองรับ ad_groups / products[{name,target}] / products[string])
// เลือกแบบ checkbox ติ๊กได้หลายตัวพร้อมกัน (ใช้ทั้งสินค้าและกลุ่ม Target)
// options = [{ value, label }]
// buttonText = ข้อความบนปุ่มแทนแบบปกติ (เช่นโชว์ชื่อที่เลือกไว้) · buttonTitle = tooltip ของปุ่ม
function CheckMultiSelect({ options, selected, onToggle, disabled, disabledText, placeholder, emptyText, allLabel = 'ทั้งหมด', buttonText, buttonTitle }) {
    const [open, setOpen] = useState(false);
    if (disabled) return <div className="product-picker pms-disabled">{disabledText}</div>;
    const allSelected = options.length > 0 && options.every(o => selected.includes(o.value));
    // เลือก/ยกเลิกทุกตัวในครั้งเดียว (toggle เฉพาะตัวที่ต่างจากสถานะที่ต้องการ)
    const selectAll = () => options.forEach(o => { if (!selected.includes(o.value)) onToggle(o.value); });
    const clearAll = () => options.forEach(o => { if (selected.includes(o.value)) onToggle(o.value); });
    return (
        <div className="pms">
            <button type="button" className="product-picker pms-toggle" onClick={() => setOpen(o => !o)} title={buttonTitle}>
                <span className="pms-text">{buttonText != null ? buttonText : `${placeholder} ${selected.length > 0 ? `(เลือกแล้ว ${selected.length})` : '(ติ๊กได้หลายตัว)'}`}</span>
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

// โครงการแบ่งงานในกลุ่ม 3 ชั้น:
//   บล็อก Platform (มี Target ของ Platform นั้น)
//     -> ชุด Content Type (Campaign / Content Type / Format / Style)
//        -> แถว Tier (Tier / จำนวน KOL)  <- จำนวนคนอยู่ชั้นนี้ที่เดียว
const emptyAlloc = () => ({ tier: '', kols: '' });
   // Platform ย้ายไปอยู่ระดับกลุ่มแล้ว (allocation เหลือแค่ Tier/จำนวน)
const genKey = () => 'g' + Math.random().toString(36).slice(2, 9);
const newGroup = (over = {}) => ({ key: genKey(), platform: '', concept: '', clips: [], target: [], content_type: '', media_type: '', content_format: '', products: [], allocations: [emptyAlloc()], blocks: [], brief: '', draft: '', budget: '', code_expire: 60, no_gencode: false, ...over });
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
            return newGroup({ key: g.key || genKey(), platform: plat, concept: g.concept || '', clips: [...(g.clips || [])], target: asTargetArray(g.target), content_type: g.content_type || '', media_type: g.media_type || '', content_format: g.content_format || '', brief: g.brief || '', products: [...(g.products || [])], allocations: migAllocations(g), blocks: toBlocks(g, plat).map(withProductTargets).map(withCampaignFromCtype), budget: seededBudget, code_expire: Number(g.code_expire) || 60, no_gencode: g.no_gencode === true });
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
        creator: editing?.creator || '',
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
    // บรีฟต่อ Platform เลิกใช้แล้วทั้งหมด (ซ้ำกับบรีฟหลักของแคมเปญ) ไม่อ่านและไม่เขียนต่อ
    const briefInputRef = useRef(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [owners, setOwners] = useState([]);
    useEffect(() => {
        api('/users/options')
            .then(res => setOwners((res.data || []).map(u => u.name)))
            .catch(() => setOwners([]));
    }, []);
    const OWNERS = owners;
    // แบรนด์ให้เลือกเฉพาะที่ตัวเองมีสิทธิ์ (admin/manager เห็นครบ) — server ตรวจซ้ำอีกชั้นที่ routes/projects.js
    const { user } = useAuth();
    const brandOpts = visibleBrands(user);
    // ตอนแก้ไข ถ้าแบรนด์เดิมไม่อยู่ในรายการ (เช่นชื่อแบรนด์เก่า) ต้องโชว์ไว้ ไม่งั้นช่องจะว่างแล้วบันทึกไม่ผ่าน
    const keepBrand = isEdit && editing.brand && !brandOpts.includes(editing.brand) ? editing.brand : null;

    function update(k, v) { setForm(f => ({ ...f, [k]: v })); }
    // เริ่มจากกลุ่มสินค้า แล้วค่อยเลือก Platform ในหัวกลุ่ม
    const addGroup = () => setAdGroups(g => [...g, newGroup()]);
    const removeGroup = i => setAdGroups(g => g.filter((_, idx) => idx !== i));
    // คลิปต่อคนของกลุ่ม (ชื่อคลิป) — ว่าง = 1 คน 1 คลิป
    // ---- แบ่งงานในกลุ่ม: บล็อก Platform -> ชุด Content Type -> แถว Tier ----
    // เลือก/เอา Platform ออก แล้วให้บล็อกตามไปด้วย (ของที่กรอกไว้ของ Platform เดิมยังอยู่)
    function setGroupPlatforms(i, csv) {
        setAdGroups(gs => gs.map((x, idx) => {
            if (idx !== i) return x;
            const plats = splitCsv(csv);
            const blocks = plats.map(p => (x.blocks || []).find(b => b.platform === p) || emptyBlock(p));
            return { ...x, platform: csv, blocks };
        }));
    }
    const mapBlock = (i, bi, fn) => setAdGroups(gs => gs.map((x, idx) =>
        idx !== i ? x : ({ ...x, blocks: (x.blocks || []).map((b, j) => j !== bi ? b : fn(b)) })));
    // Target ของสินค้าตัวหนึ่งในบล็อก (1 แถว = 1 สินค้า) — Target รวมของบล็อกคิดใหม่ตอนบันทึก
    const toggleProductTarget = (i, bi, code, t) => mapBlock(i, bi, b => {
        const cur = asTargetArray((b.product_targets || {})[code]);
        return { ...b, product_targets: { ...(b.product_targets || {}), [code]: cur.includes(t) ? cur.filter(v => v !== t) : [...cur, t] } };
    });
    // เพิ่มชุด Content Type — ก๊อป Campaign / Format (Photo/VDO) / Style ของชุดก่อนหน้ามาให้ กรอกน้อยลง
    // Facebook / Instagram ไม่ก๊อป Campaign — ช่องนี้คือตัวแยกชุด (แทน Content Type) ชุดใหม่ต้องเลือกเอง ไม่งั้นได้ชุดซ้ำ
    const addSet = (i, bi) => mapBlock(i, bi, b => {
        const last = b.sets[b.sets.length - 1] || {};
        const copyCampaign = needCampaign(b.platform) && !campaignIsCtype(b.platform);
        return { ...b, sets: [...b.sets, emptySet({ campaign: copyCampaign ? (last.campaign || '') : '', media_type: last.media_type || '', content_format: last.content_format || '' })] };
    });
    const removeSet = (i, bi, si) => mapBlock(i, bi, b => ({ ...b, sets: b.sets.length > 1 ? b.sets.filter((_, j) => j !== si) : b.sets }));
    const setBlockBudget = (i, bi, v) => mapBlock(i, bi, b => ({ ...b, budget: v.replace(/[^0-9]/g, '') }));
    // งบของ Platform: รวมก้อนเดียว ↔ แยกต่อสินค้า — ตอนแยก b.budget = ผลรวมของสินค้าเสมอ (งบกลุ่ม/รวมทั้งกลุ่มอ่านค่านี้)
    // เปลี่ยนเป็นแยก: ช่องงบของแต่ละสินค้าเริ่มว่าง (ไม่เดาตัวเลขให้) · กลับเป็นก้อนเดียว: ยกผลรวมที่ใส่ไว้มา ถ้ายังไม่ได้ใส่คืนงบก้อนเดิม
    const setBudgetMode = (i, bi, mode) => mapBlock(i, bi, b => {
        if (mode === 'split') {
            if (isSplitBudget(b)) return b;
            const next = { ...b, budget_mode: 'split', product_budgets: { ...(b.product_budgets || {}) }, budget_before_split: b.budget };
            const sum = productBudgetSum(next);
            return { ...next, budget: sum > 0 ? String(sum) : '' };
        }
        if (!isSplitBudget(b)) return b;
        const sum = productBudgetSum(b);
        return { ...b, budget_mode: 'total', budget: sum > 0 ? String(sum) : (b.budget_before_split || '') };
    });
    const setProductBudget = (i, bi, code, v) => mapBlock(i, bi, b => {
        const pb = { ...(b.product_budgets || {}), [code]: String(v).replace(/[^0-9]/g, '') };
        const sum = productBudgetSum({ ...b, product_budgets: pb });
        return { ...b, product_budgets: pb, budget: sum > 0 ? String(sum) : '' };
    });
    // เอาสินค้าออกจากบล็อก = งบ / Concept ของสินค้านั้นหายไปด้วย และงบรวม (ตอนแยกงบ) คิดใหม่
    const dropProductExtras = (b, code) => {
        const pb = { ...(b.product_budgets || {}) };
        delete pb[code];
        const pc = { ...(b.product_concepts || {}) };
        delete pc[code];
        const next = { ...b, product_budgets: pb, product_concepts: pc };
        if (!isSplitBudget(next)) return next;
        const sum = productBudgetSum(next);
        return { ...next, budget: sum > 0 ? String(sum) : '' };
    };
    // สินค้า / คลิปต่อคน ย้ายมาอยู่ระดับ Platform แล้ว
    // เลือก/เอาสินค้าออก — แถว Target ของสินค้านั้นเกิด/หายตามไปด้วย
    const toggleBlockProduct = (i, bi, code) => mapBlock(i, bi, b => {
        const on = (b.products || []).includes(code);
        const pt = { ...(b.product_targets || {}) };
        // สินค้าที่มี Target ให้เลือกตัวเดียว (เช่น Beauterry) ติ๊กให้เลย ไม่ต้องเปิดเลือกทีละแถว — กด × เอาออกได้
        const only = needTarget(b.platform) && targetsForProduct(code).length === 1 ? targetsForProduct(code) : [];
        // Target เดิมที่ค้างอยู่ (แคมเปญเก่า) และเป็นของสินค้าที่เพิ่งเพิ่ม → ติ๊กคืนให้ตามที่คำเตือนบอกไว้
        const back = asTargetArray(b.legacy_orphans).filter(t => targetsForProduct(code).includes(t));
        if (on) delete pt[code]; else pt[code] = pt[code] || [...new Set([...only, ...back])];
        const next = { ...b, products: on ? b.products.filter(c => c !== code) : [...(b.products || []), code], product_targets: pt };
        return on ? dropProductExtras(next, code) : next;
    });
    const removeBlockProduct = (i, bi, code) => mapBlock(i, bi, b => {
        const pt = { ...(b.product_targets || {}) };
        delete pt[code];
        return dropProductExtras({ ...b, products: (b.products || []).filter(c => c !== code), product_targets: pt }, code);
    });
    const addBlockClip = (i, bi) => mapBlock(i, bi, b => ({ ...b, clips: [...(b.clips || []), ''] }));
    const removeBlockClip = (i, bi, ci) => mapBlock(i, bi, b => ({ ...b, clips: (b.clips || []).filter((_, j) => j !== ci) }));
    const setBlockClip = (i, bi, ci, v) => mapBlock(i, bi, b => ({ ...b, clips: (b.clips || []).map((c, j) => j === ci ? v : c) }));
    const setSetField = (i, bi, si, k, v) => mapBlock(i, bi, b => ({
        ...b, sets: b.sets.map((s, j) => j !== si ? s : ({ ...s, [k]: v }))
    }));
    // เพิ่มแถว Tier — เติม Tier ของแถวก่อนหน้ามาให้ (กลุ่มเดียวมักใช้ Tier เดิม)
    const addTier = (i, bi, si) => mapBlock(i, bi, b => ({
        ...b, sets: b.sets.map((s, j) => {
            if (j !== si) return s;
            const last = s.tiers[s.tiers.length - 1] || {};
            return { ...s, tiers: [...s.tiers, { tier: last.tier || '', kols: '' }] };
        })
    }));
    const removeTier = (i, bi, si, ti) => mapBlock(i, bi, b => ({
        ...b, sets: b.sets.map((s, j) => j !== si ? s : ({ ...s, tiers: s.tiers.length > 1 ? s.tiers.filter((_, k) => k !== ti) : s.tiers }))
    }));
    const setTierField = (i, bi, si, ti, k, v) => mapBlock(i, bi, b => ({
        ...b, sets: b.sets.map((s, j) => j !== si ? s : ({ ...s, tiers: s.tiers.map((t, k2) => k2 !== ti ? t : ({ ...t, [k]: v })) }))
    }));

    const setGroupField = (i, k, v) => setAdGroups(g => g.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
    // Concept แยกต่อสินค้า (ต่อ Platform) — ปิดแล้วข้อความที่พิมพ์ไว้ยังอยู่ในฟอร์ม (เปิดใหม่ได้คืน) แต่ไม่ถูกบันทึก
    const toggleConceptSplit = (i, bi) => mapBlock(i, bi, b => ({ ...b, concept_split: !b.concept_split }));
    const setProductConcept = (i, bi, code, v) => mapBlock(i, bi, b => ({ ...b, product_concepts: { ...(b.product_concepts || {}), [code]: v } }));
    // เลือกกลุ่ม Target ได้หลายอัน (array)

    // ตรวจว่ากรอกครบทุกช่องไหม (คืน list ช่องที่ยังไม่ครบ)
    function validate() {
        const m = [];
        if (!form.name.trim()) m.push('ชื่อแคมเปญ');
        if (!form.brand) m.push('Brand');
        if (!form.objective.trim()) m.push('รายละเอียดแคมเปญ');
        // ตรวจทีละชั้น: กลุ่ม -> บล็อก Platform -> ชุด Content Type -> แถว Tier
        const groupsOk = adGroups.length > 0 && adGroups.every(g => {
            if (!g.platform) return false;
            const blocks = g.blocks || [];
            if (!blocks.length) return false;
            return blocks.every(b => {
                if (!(b.products || []).length) return false;
                // Target บังคับเฉพาะ Platform ที่ใช้ Target — ทุกสินค้าที่มี Target ให้เลือกต้องเลือกอย่างน้อย 1 กลุ่ม
                if (needTarget(b.platform) && b.products.some(code =>
                    targetsForProduct(code).length > 0 && asTargetArray((b.product_targets || {})[code]).length === 0)) return false;
                if (!(b.sets || []).length) return false;
                // Facebook / Instagram เลือกที่ช่อง Campaign แทน Content Type — ต้องเลือกทุกชุดเหมือนเดิม
                // ยกเว้นกลุ่มที่ไม่ใช้ Gencode (ไม่ได้ยิงแอด) ที่สองช่องนี้ถูกปิดไว้ — ดู setTypeOk
                return b.sets.every(s => setTypeOk(g, b.platform, s)
                    && (s.tiers || []).length > 0
                    && s.tiers.every(t => t.tier && (Number(t.kols) || 0) > 0));
            });
        });
        if (!groupsOk) m.push('กลุ่มสินค้า (Platform/สินค้า/Target ของทุกสินค้าใน TikTok/Content Type (Facebook/Instagram: Campaign — กลุ่มที่ไม่ใช้ Gencode ไม่ต้องใส่) + ทุกแถว Tier กับจำนวน KOL ให้ครบ)');
        if (!form.owner) m.push('Project Owner');
        // งบกรอกที่ชั้น Platform — ต้องมีทุกบล็อก
        // แยกงบต่อสินค้า = ทุกสินค้าในบล็อกต้องใส่งบ · ก้อนเดียว = งบของ Platform ต้องมากกว่า 0
        const budgetOk = adGroups.length > 0 && adGroups.every(g => (g.blocks || []).length > 0
            && g.blocks.every(b => (isSplitBudget(b)
                ? (b.products || []).length > 0 && b.products.every(c => num((b.product_budgets || {})[c]) > 0)
                : num(b.budget) > 0)));
        if (!budgetOk) m.push('Budget ของแต่ละ Platform ในกลุ่มสินค้า (ถ้าแยกงบต่อสินค้า ทุกสินค้าต้องใส่งบ)');
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
            const groups = adGroups.filter(g => g.platform && (g.blocks || []).some(b => (b.products || []).length)).map(g => {
                const plats = splitCsv(g.platform);
                // Target ต่อสินค้า: เก็บเฉพาะสินค้าที่ยังอยู่ + คิด Target รวมของบล็อกใหม่ (packProductTargets)
                // Campaign: Platform ที่ไม่ใช้ (ไม่ใช่ TikTok/Facebook/Instagram) เก็บเป็นว่าง · Facebook/Instagram เก็บซ้ำลง content_type (packCampaigns)
                // งบ: แยกต่อสินค้า → budget = ผลรวม (packBudgets)
                // Concept แยกต่อสินค้า: เก็บเฉพาะสินค้าที่ยังอยู่และมีข้อความ (packConcepts)
                // ไม่ใช้ Gencode: ส่ง no_gencode เป็น boolean เสมอ — server (carryNoGencode) ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่ส่งคีย์นี้
                const blocks = (g.blocks || []).filter(b => plats.includes(b.platform)).map(b => packCampaigns(packProductTargets(packBudgets(packConcepts(b)))));
                // แบนโครง 3 ชั้นออกเป็น allocations — 1 แถว = Platform + Content Type + Tier
                // หน้าอื่นที่ยังอ่านแบบเดิมจะยังทำงานได้ และมีข้อมูลพอให้แยกตาม Platform ได้ด้วย
                const allocations = flattenBlocks(blocks);
                // ค่าระดับกลุ่มแบบเดิม — เอาจากบล็อก/ชุดแรก เพื่อความเข้ากันได้ย้อนหลัง
                const b0 = blocks[0] || null;
                const s0 = (b0 && b0.sets && b0.sets[0]) || null;
                return { key: g.key || genKey(), platform: plats[0] || null, platforms: plats, blocks, concept: g.concept || null, target: b0 ? asTargetArray(b0.target) : [], content_type: s0 ? (s0.content_type || null) : null, media_type: s0 ? (s0.media_type || null) : null, content_format: s0 ? (s0.content_format || null) : null, clips: (s0 && b0 ? (b0.clips || []) : (g.clips || [])).map(c => String(c || '').trim()).filter(Boolean), brief: (g.brief && g.brief.trim()) ? g.brief.trim() : null, products: blocksProducts(blocks), allocations, kol_count: allocations.reduce((s, a) => s + a.kols, 0), budget: blocksBudget(blocks), code_expire: Number(g.code_expire) || 60, no_gencode: !!g.no_gencode };
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
            // บรีฟหลักต่อ Platform เลิกใช้แล้ว (ซ้ำกับบรีฟหลักของแคมเปญ)
            // ส่งค่าว่างไป ของเก่าที่ค้างอยู่จะถูกล้างตอนบันทึกแคมเปญครั้งถัดไป
            const platform_briefs = {};
            // งบต่อ Platform = ผลรวมงบของกลุ่มใน Platform นั้น (ไว้ให้หน้าอื่นที่ยังดูแบบต่อ Platform ใช้)
            // งบต่อ Platform = ยอดที่กรอกไว้ในบล็อกของ Platform นั้นจริง ๆ (ไม่ใช่หารเท่า ๆ กันแบบเดิม)
            const platform_budgets = platformBudgets(groups);
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
                creator: form.creator || null,
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
                    {/* ทีมใช้บัญชีเดียวร่วมกัน ระบบจึงบันทึกได้แค่ "System Admin" ต้องเลือกชื่อจริงเอง */}
                    <div className="field">
                        <label>Project Creator</label>
                        <select value={form.creator} onChange={e => update('creator', e.target.value)}>
                            <option value="">— เลือก —</option>
                            {OWNERS.map(n => <option key={n} value={n}>{n}</option>)}
                            {form.creator && !OWNERS.includes(form.creator) && (
                                <option value={form.creator}>{form.creator}</option>
                            )}
                        </select>
                    </div>

                    <div className="field-row">
                        <div className="field">
                            <label>Brand</label>
                            <select value={form.brand} onChange={e => update('brand', e.target.value)}>
                                <option value="">{brandOpts.length || keepBrand ? 'เลือกแบรนด์' : 'ยังไม่ได้รับสิทธิ์แบรนด์ — ติดต่อผู้ดูแลระบบ'}</option>
                                {brandOpts.map(b => <option key={b} value={b}>{b}</option>)}
                                {keepBrand && <option value={keepBrand}>{keepBrand}</option>}
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
                                // Target ย้ายไปอยู่ในบล็อกของแต่ละ Platform แล้ว ระดับกลุ่มไม่ต้องคิดอะไร
                                return (
                                <div className="adgroup-block" key={g.key || i}>
                                    <div className="adgroup-head">
                                        <span className="adgroup-no">กลุ่มที่ {i + 1}</span>
                                        <div className={'adgroup-platform' + (g.platform ? '' : ' empty')}>
                                            <MultiSelect value={g.platform} options={GROUP_PLATFORMS}
                                                onChange={v => setGroupPlatforms(i, v)}
                                                placeholder="— เลือก Platform —" itemName="Platform" />
                                        </div>
                                        <input className="adgroup-concept" value={g.concept}
                                            placeholder={isSplitConcept(g) ? 'Concept หลักของกลุ่ม...' : 'Concept ของกลุ่ม...'}
                                            onChange={e => setGroupField(i, 'concept', e.target.value)} />
                                        <button type="button" className="adgroup-rm" title="ลบกลุ่ม" onClick={() => removeGroup(i)}>×</button>
                                    </div>


                                    {/* จำนวนวัน Gencode (โค้ดใช้ได้กี่วัน) — "-" = กลุ่มนี้ไม่ใช้ Gencode */}
                                    {/* เลือก "-" แค่ตั้ง no_gencode ไม่แตะ code_expire เวลาสลับกลับจะได้จำนวนวันเดิม · เลือกจำนวนวัน = ปลด "-" แล้วใช้วันนั้น */}
                                    <label className="platform-budget platform-budget-row">
                                        <span>⏳ จำนวนวัน Gencode</span>
                                        <select value={g.no_gencode ? '-' : String(Number(g.code_expire) || 60)}
                                            onChange={e => { const v = e.target.value; setAdGroups(gs => gs.map((x, idx) => idx !== i ? x
                                                : v === '-' ? { ...x, no_gencode: true } : { ...x, no_gencode: false, code_expire: Number(v) })); }}>
                                            <option value="-">- (ไม่ใช้ Gencode)</option>
                                            {CODE_EXPIRE_OPTS.map(d => <option key={d} value={d}>{d} Days</option>)}
                                            {/* จำนวนวันที่ไม่อยู่ในตัวเลือก (ยิง API ตรง) ต้องมีตัวเลือกของตัวเอง ไม่งั้นช่องจะโชว์ "-" ตัวแรกทั้งที่กลุ่มยังใช้ Gencode */}
                                            {!g.no_gencode && !CODE_EXPIRE_OPTS.includes(Number(g.code_expire) || 60) && <option value={String(Number(g.code_expire))}>{Number(g.code_expire)} Days</option>}
                                        </select>
                                    </label>
                                    {/* บรีฟเฉพาะกลุ่มนี้ */}
                                    <div className="target-multi">
                                        <input className="target-add" type="url" value={g.brief} onChange={e => setGroupField(i, 'brief', e.target.value)}
                                            placeholder="📄 บรีฟเฉพาะกลุ่มนี้ (ลิงก์ https://...) — เว้นว่างได้ถ้าใช้บรีฟหลัก" />
                                    </div>

                                    {/* แบ่งงานในกลุ่ม: Platform -> Content Type -> Tier
                                        จำนวน KOL กรอกที่ชั้น Tier ที่เดียว ยอดรวมคิดขึ้นมาให้เอง */}
                                    {(g.blocks || []).length === 0 ? (
                                        <p className="blk-empty">เลือก Platform ด้านบนก่อน แล้วช่องแบ่งงานจะขึ้นตรงนี้</p>
                                    ) : (g.blocks || []).map((b, bi) => {
                                        const single = (g.blocks || []).length === 1;
                                        const withTarget = needTarget(b.platform);
                                        const ptOf = code => asTargetArray((b.product_targets || {})[code]);
                                        const needCount = (b.products || []).filter(code => targetsForProduct(code).length > 0).length;
                                        const doneCount = (b.products || []).filter(code => targetsForProduct(code).length > 0 && ptOf(code).length > 0).length;
                                        // Target เดิมที่ยังไม่มีสินค้าไหนใช้ — คิดสดทุกครั้ง (เลือกคืนให้สินค้าแล้วคำเตือนหายเอง)
                                        const orphans = withTarget ? asTargetArray(b.legacy_orphans).filter(t => !(b.products || []).some(c => ptOf(c).includes(t))) : [];
                                        // งบแยกต่อสินค้า
                                        const split = isSplitBudget(b);
                                        const pbOf = code => num((b.product_budgets || {})[code]);
                                        const budgetMissing = split ? (b.products || []).filter(code => pbOf(code) <= 0) : [];
                                        // Concept แยกต่อสินค้า — ช่องในแถวสินค้า (ว่าง = ใช้ Concept หลักของกลุ่ม)
                                        const cSplit = isBlockSplitConcept(b);
                                        const cOf = code => String((b.product_concepts || {})[code] || '');
                                        const conceptField = (code, inline) => (
                                            <div className={'pcon' + (inline ? ' inline' : '')}>
                                                <span className="pcon-ico" aria-hidden="true">📝</span>
                                                <input className={'pcon-in' + (cOf(code).trim() ? ' filled' : '')} value={cOf(code)}
                                                    placeholder="ว่าง = ใช้ Concept หลักของกลุ่ม" aria-label={`Concept ของ ${code}`}
                                                    onChange={e => setProductConcept(i, bi, code, e.target.value)} />
                                            </div>
                                        );
                                        const rowLabel = [withTarget && 'Target', split && 'งบ', cSplit && 'Concept'].filter(Boolean).join(' + ') + ' ของแต่ละสินค้า';
                                        const moneyInput = code => (
                                            // div ไม่ใช่ label — .field label ของฟอร์มบังคับเป็น block ตัวอักษรใหญ่ ทำให้ ฿ ตกบรรทัด
                                            <div className={'ptgt-money' + (pbOf(code) > 0 ? '' : ' need')}>
                                                <input type="text" inputMode="numeric" placeholder="ใส่งบ" aria-label={`งบของ ${code}`}
                                                    value={pbOf(code) > 0 ? pbOf(code).toLocaleString('en-US') : ''}
                                                    onChange={e => setProductBudget(i, bi, code, e.target.value)} />
                                                <span>฿</span>
                                            </div>
                                        );
                                        return (
                                        <div className={'plat-blk' + (single ? ' single' : '')} key={b.platform}>
                                            <div className="plat-blk-head">
                                                {/* หัวบล็อก = ชื่อ (กลุ่มที่มี Platform เดียวเขียน BUDGET) + งบ · จำนวนคนรวมดูที่แถวสรุปท้ายกลุ่ม */}
                                                <span className="plat-blk-name">{single ? '💰 BUDGET' : '📱 ' + b.platform}</span>
                                                {split ? (
                                                    <span className="plat-blk-budget auto" title="รวมจากงบของแต่ละสินค้าอัตโนมัติ">
                                                        <b>฿{num(b.budget).toLocaleString('en-US')}</b>
                                                        <small>รวมจากสินค้า</small>
                                                    </span>
                                                ) : (
                                                    <label className="plat-blk-budget">
                                                        <input type="text" inputMode="numeric" placeholder="0"
                                                            value={b.budget ? num(b.budget).toLocaleString('en-US') : ''}
                                                            onChange={e => setBlockBudget(i, bi, e.target.value)} />
                                                        <span className="pb-baht">฿</span>
                                                    </label>
                                                )}
                                            </div>
                                            {/* ปกติ = งบรวมก้อนเดียว (ช่องงบที่หัวบล็อก) · กดปุ่มนี้ = แยกงบต่อสินค้า (ใส่งบในแถวของแต่ละสินค้า) กดอีกครั้งเพื่อกลับ */}
                                            <div className="bmode">
                                                <button type="button" className={split ? 'on' : ''} aria-pressed={split}
                                                    title={split ? 'กดอีกครั้งเพื่อกลับไปใช้งบรวมก้อนเดียว' : 'ใส่งบแยกของแต่ละสินค้า แล้วระบบรวมให้อัตโนมัติ'}
                                                    onClick={() => setBudgetMode(i, bi, split ? 'total' : 'split')}>
                                                    {split ? '☑' : '☐'} 📦 แยกงบต่อสินค้า
                                                </button>
                                                {/* กดแล้วแถวสินค้าได้ช่อง Concept ของตัวเอง — ว่าง = ใช้ Concept หลักของกลุ่ม */}
                                                <button type="button" className={cSplit ? 'on' : ''} aria-pressed={cSplit}
                                                    title={cSplit ? 'กดอีกครั้งเพื่อกลับไปใช้ Concept ของกลุ่มทุกสินค้า' : 'ใส่ Concept แยกของแต่ละสินค้าใน Platform นี้'}
                                                    onClick={() => toggleConceptSplit(i, bi)}>
                                                    {cSplit ? '☑' : '☐'} 📝 แยก Concept ต่อสินค้า
                                                </button>
                                            </div>
                                            {/* สินค้าของ Platform นี้ */}
                                            <CheckMultiSelect
                                                disabled={!form.brand}
                                                disabledText="— เลือกแบรนด์ก่อน —"
                                                placeholder="+ เลือกสินค้า"
                                                emptyText="ไม่มีสินค้าในแบรนด์นี้"
                                                allLabel="ทุกสินค้า"
                                                options={productsByBrand(form.brand).map(p => ({ value: p.code, label: `${p.code} - ${p.name}` }))}
                                                selected={b.products || []}
                                                onToggle={code => toggleBlockProduct(i, bi, code)}
                                            />
                                            {/* Platform ที่ใช้ Target (ตอนนี้ TikTok): 1 แถว = 1 สินค้า + Target ของสินค้านั้น
                                                Platform อื่นไม่มี Target — แสดงแค่รายการสินค้า */}
                                            {(b.products || []).length > 0 && !withTarget && (split || cSplit) && (
                                                <div className="ptgt-list">
                                                    <div className="tgt-label">
                                                        <span>{split ? '💰' : '📝'} {rowLabel}{split && <b className="tgt-req"> *</b>}</span>
                                                        {split && (budgetMissing.length > 0
                                                            ? <span className="tgt-hint">ใส่งบแล้ว {b.products.length - budgetMissing.length} / {b.products.length} สินค้า</span>
                                                            : <span className="tgt-ok">✓ ใส่งบครบ {b.products.length} สินค้า</span>)}
                                                    </div>
                                                    {b.products.map(code => (
                                                        <div className={'ptgt-row' + (split && pbOf(code) <= 0 ? ' need-budget' : '')} key={code}>
                                                            <div className="ptgt-prod" title={productLabel(code)}>
                                                                <b>{code}</b>
                                                                <span>{productLabel(code).replace(code + ' - ', '')}</span>
                                                            </div>
                                                            {/* ไม่มีช่องอื่นในแถว = Concept อยู่บรรทัดเดียวกับสินค้า · มีงบด้วย = Concept ขึ้นบรรทัดที่สอง */}
                                                            {cSplit && !split && conceptField(code, true)}
                                                            {split && moneyInput(code)}
                                                            <button type="button" className="ptgt-rm" title={`เอา ${code} ออกจาก Platform นี้`}
                                                                onClick={() => removeBlockProduct(i, bi, code)}>×</button>
                                                            {cSplit && split && conceptField(code, false)}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {(b.products || []).length > 0 && !withTarget && !split && !cSplit && (
                                                <div className="prodchip-wrap" style={{ marginBottom: 8 }}>
                                                    {b.products.map(code => (
                                                        <span className="prodchip removable" key={code} title={productLabel(code)}>
                                                            {code}<button type="button" onClick={() => removeBlockProduct(i, bi, code)} title="เอาออก">×</button>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {(b.products || []).length > 0 && withTarget && (
                                                <div className="ptgt-list">
                                                    <div className="tgt-label">
                                                        <span>🎯 {rowLabel} <b className="tgt-req">*</b></span>
                                                        {split ? (
                                                            // แยกงบ: ✓ ได้เมื่อครบทั้ง Target และงบ — ไม่งั้นบอกว่าขาดอะไรกี่สินค้า
                                                            (needCount === 0 || doneCount === needCount) && budgetMissing.length === 0
                                                                ? <span className="tgt-ok">✓ Target และงบครบ {b.products.length} สินค้า</span>
                                                                : <span className="tgt-hint">
                                                                    {[needCount > 0 && doneCount < needCount ? `เลือก Target แล้ว ${doneCount} / ${needCount}` : null,
                                                                        budgetMissing.length > 0 ? `ใส่งบแล้ว ${b.products.length - budgetMissing.length} / ${b.products.length}` : null]
                                                                        .filter(Boolean).join(' · ')} สินค้า
                                                                </span>
                                                        ) : needCount === 0 ? <span className="tgt-hint">สินค้าที่เลือกยังไม่มี Target ให้เลือก</span>
                                                            : doneCount < needCount
                                                                ? <span className="tgt-hint">เลือกแล้ว {doneCount} / {needCount} สินค้า — ทุกสินค้าต้องมีอย่างน้อย 1 กลุ่ม</span>
                                                                : <span className="tgt-ok">✓ เลือกครบ {needCount} สินค้า</span>}
                                                    </div>
                                                    {b.products.map(code => {
                                                        const opts = [...new Set([...targetsForProduct(code), ...ptOf(code)])];
                                                        const sel = ptOf(code);
                                                        const need = targetsForProduct(code).length > 0 && sel.length === 0;
                                                        // ยังไม่ใส่งบ (ตอนแยกงบ) — แถวแดง แต่ปุ่ม Target ไม่แดง (Target เลือกแล้ว)
                                                        const needBudget = split && pbOf(code) <= 0;
                                                        return (
                                                            <div className={'ptgt-row' + (need ? ' need' : '') + (needBudget ? ' need-budget' : '')} key={code}>
                                                                <div className="ptgt-prod" title={productLabel(code)}>
                                                                    <b>{code}</b>
                                                                    <span>{productLabel(code).replace(code + ' - ', '')}</span>
                                                                </div>
                                                                <div className="ptgt-pick">
                                                                    <CheckMultiSelect
                                                                        disabled={opts.length === 0}
                                                                        disabledText="— สินค้านี้ไม่มี Target —"
                                                                        emptyText="สินค้านี้ยังไม่มี Target"
                                                                        allLabel="ทุก Target ของสินค้านี้"
                                                                        buttonText={sel.length ? '🎯 ' + sel.join(', ') : '▾ เลือก Target (ติ๊กได้หลายตัว)'}
                                                                        buttonTitle={sel.length ? sel.join('\n') : undefined}
                                                                        options={opts.map(t => ({ value: t, label: t }))}
                                                                        selected={sel}
                                                                        onToggle={t => toggleProductTarget(i, bi, code, t)}
                                                                    />
                                                                </div>
                                                                {split && moneyInput(code)}
                                                                <button type="button" className="ptgt-rm" title={`เอา ${code} ออกจาก Platform นี้`}
                                                                    onClick={() => removeBlockProduct(i, bi, code)}>×</button>
                                                                {cSplit && conceptField(code, false)}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {/* อยู่นอกรายการสินค้า — บล็อกที่มี Target เดิมแต่ไม่มีสินค้าเลยก็ต้องเตือน */}
                                            {orphans.length > 0 && (
                                                <div className="ptgt-orphan">
                                                    Target เดิมที่ยังไม่มีสินค้าไหนใช้: {orphans.join(', ')} — บันทึกแล้วจะถูกเอาออก
                                                    (ถ้ายังต้องใช้ ให้เลือกสินค้าที่ใช้ Target นี้เพิ่ม ระบบจะติ๊กคืนให้ หรือติ๊กในแถวของสินค้านั้นเอง)
                                                </div>
                                            )}
                                            {(b.sets || []).map((s, si) => (
                                                <div className="ctype-set" key={si}>
                                                    <div className="ctype-set-row">
                                                        {/* Campaign ใช้เฉพาะ TikTok / Facebook / Instagram — Platform อื่นปิดช่องไว้ ไม่ต้องเลือก
                                                            Facebook / Instagram: Campaign (Awareness / Engagement / Reels) ใช้แทน Content Type — ช่อง Content Type ปิดไว้
                                                            กลุ่มที่ตั้ง "-" (ไม่ใช้ Gencode) ไม่ได้ยิงแอด จึงปิดทั้งสองช่อง แต่ยังโชว์ค่าที่เคยกรอกไว้
                                                            (สลับกลับมาใช้ Gencode ได้ค่าเดิมคืน แบบเดียวกับช่องจำนวนวัน Gencode) */}
                                                        {g.no_gencode ? (
                                                            <select className="target-add" value={s.campaign || ''} disabled
                                                                title="กลุ่มนี้ตั้งไว้ว่าไม่ใช้ Gencode (ไม่ได้ยิงแอด) จึงไม่ต้องใส่ Campaign">
                                                                <option value="">— ไม่ต้องใส่ (ไม่ยิงแอด) —</option>
                                                                {s.campaign && <option value={s.campaign}>{s.campaign}</option>}
                                                            </select>
                                                        ) : needCampaign(b.platform) ? (
                                                            <select className="target-add" value={s.campaign || ''}
                                                                onChange={e => setSetField(i, bi, si, 'campaign', e.target.value)}>
                                                                <option value="">— Campaign —</option>
                                                                {campaignTypesFor(b.platform, s.campaign).map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
                                                        ) : (
                                                            <select className="target-add" value="" disabled title="Campaign ใช้เฉพาะ TikTok / Facebook / Instagram">
                                                                <option value="">— ไม่ใช้ Campaign —</option>
                                                            </select>
                                                        )}
                                                        {g.no_gencode ? (
                                                            <select className="target-add" value={s.content_type || ''} disabled
                                                                title="กลุ่มนี้ตั้งไว้ว่าไม่ใช้ Gencode (ไม่ได้ยิงแอด) จึงไม่ต้องใส่ Content Type">
                                                                <option value="">— ไม่ต้องใส่ (ไม่ยิงแอด) —</option>
                                                                {s.content_type && <option value={s.content_type}>{s.content_type}</option>}
                                                            </select>
                                                        ) : campaignIsCtype(b.platform) ? (
                                                            <select className="target-add" value="" disabled title={`${b.platform} เลือกที่ช่อง Campaign แทน`}>
                                                                <option value="">— ไม่ใช้ Content Type —</option>
                                                            </select>
                                                        ) : (
                                                            <select className="target-add" value={s.content_type}
                                                                onChange={e => setSetField(i, bi, si, 'content_type', e.target.value)}>
                                                                <option value="">— Content Type —</option>
                                                                {contentTypesFor(b.platform, s.content_type).map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
                                                        )}
                                                        <select className="target-add" value={s.media_type}
                                                            onChange={e => setSetField(i, bi, si, 'media_type', e.target.value)}>
                                                            <option value="">— Format —</option>
                                                            {MEDIA_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                        <MultiSelect value={s.content_format} options={CONTENT_FORMATS}
                                                            onChange={v => setSetField(i, bi, si, 'content_format', v)}
                                                            placeholder="— Style —" itemName="Style" />
                                                        {(b.sets || []).length > 1 && (
                                                            <button type="button" className="alloc-rm" title="ลบชุดนี้"
                                                                onClick={() => removeSet(i, bi, si)}>×</button>
                                                        )}
                                                    </div>
                                                    <div className="tier-rows">
                                                        {(s.tiers || []).map((t, ti) => (
                                                            <div className="tier-row" key={ti}>
                                                                <select value={t.tier} onChange={e => setTierField(i, bi, si, ti, 'tier', e.target.value)}>
                                                                    <option value="">— Tier —</option>
                                                                    {TIERS.map(x => <option key={x} value={x}>{x}</option>)}
                                                                </select>
                                                                <input type="number" min="0" placeholder="0" value={t.kols}
                                                                    onChange={e => setTierField(i, bi, si, ti, 'kols', e.target.value)} />
                                                                <span className="tier-unit">คน</span>
                                                                {(s.tiers || []).length > 1 && (
                                                                    <button type="button" className="alloc-rm" title="ลบแถว Tier"
                                                                        onClick={() => removeTier(i, bi, si, ti)}>×</button>
                                                                )}
                                                            </div>
                                                        ))}
                                                        <button type="button" className="tier-add" onClick={() => addTier(i, bi, si)}>
                                                            <Icon name="plus" size={13} /> เพิ่ม Tier
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                            <button type="button" className="alloc-add" onClick={() => addSet(i, bi)}>
                                                <Icon name="plus" size={14} /> {g.no_gencode ? 'เพิ่มชุด' : campaignIsCtype(b.platform) ? 'เพิ่ม Campaign' : 'เพิ่ม Content Type'}
                                            </button>
                                            {/* คลิปต่อคนของ Platform นี้ — ไม่ตั้ง = 1 คน 1 คลิป */}
                                            <div className="clips-box">
                                                <div className="clips-head">
                                                    <span className="clips-title">🎬 Content / คน</span>
                                                    <span className="clips-count">{Math.max(1, (b.clips || []).length)} Content / คน</span>
                                                </div>
                                                {(b.clips || []).map((c, ci) => (
                                                    <div className="clip-row" key={ci}>
                                                        <span className="clip-no">{ci + 1}</span>
                                                        <input value={c} placeholder={`ชื่อ Content ที่ ${ci + 1} เช่น คลิปงาน Event`}
                                                            onChange={e => setBlockClip(i, bi, ci, e.target.value)} />
                                                        <button type="button" className="clip-rm" title="ลบ Content นี้" onClick={() => removeBlockClip(i, bi, ci)}>×</button>
                                                    </div>
                                                ))}
                                                <button type="button" className="clip-add" onClick={() => addBlockClip(i, bi)}>
                                                    <Icon name="plus" size={14} /> เพิ่ม Content
                                                </button>
                                                {(b.clips || []).length === 0 && (
                                                    <p className="clips-hint">ยังไม่ได้ตั้ง = 1 คนส่ง 1 Content</p>
                                                )}
                                            </div>
                                        </div>
                                        );
                                    })}
                                    <div className="grp-kol-sum">
                                        รวมทั้งกลุ่ม <b>{groupTotalKol(g)}</b> คน · งบ <b>฿{blocksBudget(g.blocks).toLocaleString('en-US')}</b>
                                        <span className="grp-kol-note">(คิดจากที่กรอกในแต่ละ Platform)</span>
                                    </div>
                                </div>
                                );
                            })}
                            <button type="button" className="adgroup-add" onClick={addGroup}>
                                <Icon name="plus" size={15} /> เพิ่มกลุ่มสินค้า
                            </button>
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
