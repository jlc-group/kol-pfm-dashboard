import { targetsForProduct } from './products.js';

// Platform ของกลุ่มโฆษณา — 1 กลุ่มลงได้หลาย Platform
//
// รูปแบบข้อมูลที่ต้องรองรับพร้อมกัน:
//   - แบบใหม่   : g.platforms = ['TikTok', 'Instagram']
//   - แบบเดิม   : g.platform  = 'TikTok'
//   - ในฟอร์ม   : g.platform  = 'TikTok,Instagram' (MultiSelect เก็บเป็นสตริงคั่นคอมมา)
//   - เก่ากว่านั้น: platform ติดอยู่ที่ allocation แต่ละแถว
export function splitCsv(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    return v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
}

export function groupPlatforms(g) {
    if (!g) return [];
    if (Array.isArray(g.platforms) && g.platforms.length) return [...new Set(g.platforms.filter(Boolean))];
    const set = new Set(splitCsv(g.platform));
    (g.allocations || []).forEach(a => { if (a.platform) set.add(a.platform); });
    return [...set];
}

// ===== การแบ่งงานในกลุ่ม 3 ชั้น =====
// บล็อก Platform (มี Target ของ Platform นั้น)
//   -> ชุด Content Type (Campaign / Content Type / Format / Style)
//      -> แถว Tier (Tier / จำนวน KOL)   <- จำนวนคนอยู่ชั้นนี้ที่เดียว
//
// เก็บลงฐานข้อมูลเป็น g.blocks และแบนออกเป็น g.allocations ให้โค้ดเดิมอ่านได้ด้วย

// กลุ่ม Target ใช้เฉพาะบาง Platform — เพิ่มชื่อในลิสต์นี้ที่เดียวถ้าวันหลัง Platform อื่นต้องใช้
export const TARGET_PLATFORMS = ['TikTok'];
export const needTarget = p => TARGET_PLATFORMS.includes(p);

// Content Type ต่างกันตาม Platform
export const CONTENT_TYPES_DEFAULT = ['Review', 'Sale'];
// Facebook / Instagram ไม่เลือกที่ช่องนี้แล้ว — เลือก Awareness / Engagement / Reels ที่ช่อง Campaign แทน (ดู CAMPAIGN_TYPES_BY_PLATFORM)
export const CONTENT_TYPES_BY_PLATFORM = {
    // TikTok ใช้ค่า default เดิมทั้งสองตัว แล้วเพิ่ม Branding ที่มีเฉพาะ Platform นี้
    // (เดิมชื่อ C-ADS — ณ วันที่เปลี่ยนชื่อยังไม่มีกลุ่มหรือ KOL ไหนบันทึกค่านี้ไว้)
    TikTok: [...CONTENT_TYPES_DEFAULT, 'Branding'],
};
// ค่าที่เคยบันทึกไว้ต้องคงอยู่ในลิสต์เสมอ ไม่งั้น dropdown จะเด้งเป็นค่าว่างแล้วข้อมูลหายเงียบ ๆ
export function contentTypesFor(platformCsv, current) {
    const plats = splitCsv(platformCsv);
    const out = [];
    (plats.length ? plats : ['']).forEach(p => {
        (CONTENT_TYPES_BY_PLATFORM[p] || CONTENT_TYPES_DEFAULT).forEach(c => { if (!out.includes(c)) out.push(c); });
    });
    if (current && !out.includes(current)) out.push(current);
    return out;
}

// Campaign ของการยิงแอด — ตั้งต่อชุด Content Type (หน้า Ads แสดงเป็นคอลัมน์ CAMPAIGN)
export const CAMPAIGN_TYPES = ['VDO View', 'Reach', 'Consideration Ads'];
// ตัวเลือก Campaign ต่อ Platform — Facebook / Instagram ใช้ Awareness / Engagement / Reels (ย้ายมาจากช่อง Content Type)
// ต้องตรงกับ SOCIAL_CAMPAIGNS ฝั่ง server (server/src/store/logic.js)
export const SOCIAL_CAMPAIGNS = ['Awareness', 'Engagement', 'Reels'];
export const CAMPAIGN_TYPES_BY_PLATFORM = {
    TikTok: CAMPAIGN_TYPES,
    Facebook: SOCIAL_CAMPAIGNS,
    Instagram: SOCIAL_CAMPAIGNS
};
// Platform ที่เปิดช่อง Campaign — Platform อื่นปิดช่องนี้ ไม่ต้องเลือก (เพิ่มชื่อในลิสต์นี้ที่เดียวถ้าวันหลังต้องใช้)
// ต้องตรงกับ CAMPAIGN_PLATFORMS ฝั่ง server (server/src/store/logic.js)
export const CAMPAIGN_PLATFORMS = ['TikTok', 'Facebook', 'Instagram'];
export const needCampaign = p => CAMPAIGN_PLATFORMS.includes(p);
// Platform ที่ Campaign "คือ" ตัวแยกชุด (แทน Content Type) — ช่อง Content Type ปิดไว้ แต่ตอนบันทึกเก็บค่าเดียวกันลง content_type ด้วย
// เหตุผล: หน้าเอเจนซี่ / หน้าแคมเปญ / On Process / หน้า Ads แยกคน นับโควตา และจับคู่ข้อมูลรายคนด้วย content_type ของชุด
// ต้องตรงกับ CAMPAIGN_AS_CTYPE ฝั่ง server (server/src/store/logic.js)
export const CAMPAIGN_AS_CTYPE = ['Facebook', 'Instagram'];
export const campaignIsCtype = p => CAMPAIGN_AS_CTYPE.includes(p);
// ค่าที่เคยบันทึกไว้ต้องคงอยู่ในลิสต์เสมอ (กติกาเดียวกับ contentTypesFor)
export function campaignTypesFor(platform, current) {
    const base = CAMPAIGN_TYPES_BY_PLATFORM[platform] || CAMPAIGN_TYPES;
    return current && !base.includes(current) ? [...base, current] : base;
}
// ตอนเปิดแก้แคมเปญเดิม: ชุดของ Facebook / Instagram ที่บันทึกก่อนย้าย (ค่าอยู่ที่ content_type) → ขึ้นในช่อง Campaign
// ใช้ content_type ก่อน เพราะข้อมูลเก่าอาจมี campaign ค้างเป็นของ TikTok (เช่น 'Reach')
// ค่าเดิมที่ไม่อยู่ในลิสต์ (เช่น Instagram 'Review') ยังคงอยู่ในช่อง Campaign — บันทึกแล้วคนเดิมยังอยู่ชุดเดิม
export function withCampaignFromCtype(b) {
    if (!b || !campaignIsCtype(b.platform)) return b;
    return { ...b, sets: (b.sets || []).map(s => ({ ...s, campaign: s.content_type || s.campaign || '' })) };
}

export const emptyTier = () => ({ tier: '', kols: '' });
export const emptySet = (over = {}) => ({ campaign: '', content_type: '', media_type: '', content_format: '', tiers: [emptyTier()], ...over });
// product_targets = Target แยกต่อสินค้า { รหัสสินค้า: [Target] } · target = รวมทุกสินค้า (ให้หน้าที่ยังอ่านแบบรวมใช้ต่อได้)
// budget_mode = 'total' งบรวมก้อนเดียว (budget) | 'split' แยกงบต่อสินค้า (product_budgets { รหัส: งบ } และ budget = ผลรวม)
// concept_split / product_concepts = Concept แยกต่อสินค้าของ Platform นี้ (ว่าง = ใช้ Concept หลักของกลุ่ม)
export const emptyBlock = platform => ({ platform, target: [], product_targets: {}, budget: '', budget_mode: 'total', product_budgets: {}, concept_split: false, product_concepts: {}, products: [], clips: [], sets: [emptySet()] });

export const setKol = s => (s.tiers || []).reduce((n, t) => n + (Number(t.kols) || 0), 0);
export const blockKol = b => (b.sets || []).reduce((n, s) => n + setKol(s), 0);
export const blocksKol = blocks => (blocks || []).reduce((n, b) => n + blockKol(b), 0);
// งบกรอกที่ชั้น Platform — ยอดรวมของกลุ่มคิดจากตรงนี้ ไม่ได้กรอกซ้ำ
export const num = v => Number(String(v == null ? '' : v).replace(/[^0-9]/g, '')) || 0;
export const blocksBudget = blocks => (blocks || []).reduce((n, b) => n + num(b.budget), 0);
// งบแยกตาม Platform ของทั้งแคมเปญ (รวมทุกกลุ่ม)
export function platformBudgets(groups) {
    const out = {};
    (groups || []).forEach(g => {
        (g.blocks || []).forEach(b => { if (b.platform) out[b.platform] = (out[b.platform] || 0) + num(b.budget); });
    });
    return out;
}

const asArr = v => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

// กระจายงบก้อนเดียวลงแต่ละบล็อกตามสัดส่วนจำนวนคน (เศษยกไปบล็อกสุดท้าย ยอดรวมจะได้ไม่หาย)
// ใช้ตอนอ่านข้อมูลที่ยังไม่มีงบรายบล็อก — ทั้งข้อมูลเก่า และบล็อกที่บันทึกก่อนมีช่องงบนี้
function spreadBudget(blocks, total) {
    const amount = num(total);
    if (!amount || !blocks.length) return blocks;
    if (blocks.length === 1) return blocks.map(b => ({ ...b, budget: String(amount) }));
    const kols = blocks.map(b => blockKol(b));
    const sum = kols.reduce((s, n) => s + n, 0);
    if (!sum) {
        const each = Math.floor(amount / blocks.length);
        return blocks.map((b, i) => ({ ...b, budget: String(i === blocks.length - 1 ? amount - each * (blocks.length - 1) : each) }));
    }
    const parts = kols.map(k => Math.floor(amount * k / sum));
    const used = parts.slice(0, -1).reduce((s, n) => s + n, 0);
    return blocks.map((b, i) => ({ ...b, budget: String(i === blocks.length - 1 ? amount - used : parts[i]) }));
}

// อ่านข้อมูลกลุ่ม (เก่าหรือใหม่) ออกมาเป็นโครง 3 ชั้นตาม Platform ที่ระบุ
// ของเก่าเก็บ Tier ชุดเดียวโดยไม่แยก Platform -> ใส่ลงบล็อกแรกเท่านั้น
// ไม่งั้นจำนวน KOL จะถูกนับซ้ำตามจำนวน Platform
export function toBlocks(g, platformCsv) {
    const plats = splitCsv(platformCsv != null ? platformCsv : groupPlatforms(g));
    if (Array.isArray(g.blocks) && g.blocks.length) {
        const kept = plats.map(p => {
            const b = g.blocks.find(x => x.platform === p);
            if (!b) return emptyBlock(p);
            return {
                platform: p,
                target: asArr(b.target),
                // null = บันทึกไว้ก่อนมี Target ต่อสินค้า (ฟอร์มจะแบ่ง Target รวมให้แต่ละสินค้าเอง)
                product_targets: b.product_targets && typeof b.product_targets === 'object' && !Array.isArray(b.product_targets)
                    ? { ...b.product_targets } : null,
                budget: b.budget != null ? b.budget : '',
                // งบแยกต่อสินค้า ('split') หรือก้อนเดียว ('total' / ข้อมูลเก่าที่ไม่มีช่องนี้)
                budget_mode: b.budget_mode === 'split' ? 'split' : 'total',
                product_budgets: isMap(b.product_budgets) ? { ...b.product_budgets } : {},
                concept_split: b.concept_split === true,
                product_concepts: isMap(b.product_concepts) ? { ...b.product_concepts } : {},
                products: [...(b.products || [])],
                clips: [...(b.clips || [])],
                sets: (b.sets && b.sets.length ? b.sets : [emptySet()]).map(s => ({
                    campaign: s.campaign || '',
                    content_type: s.content_type || '',
                    media_type: s.media_type || '',
                    content_format: s.content_format || '',
                    tiers: (s.tiers && s.tiers.length ? s.tiers : [emptyTier()])
                        .map(t => ({ tier: t.tier || '', kols: t.kols ?? '' }))
                }))
            };
        });
        // บล็อกที่บันทึกไว้ก่อนมีช่องงบ -> เกลี่ยงบของกลุ่มลงไปให้ ไม่ให้กลายเป็น 0
        // บล็อกที่บันทึกก่อนมีช่องสินค้า/คลิป -> ยกของกลุ่มลงไปให้
        const filled = kept.map(b => ({
            ...b,
            products: b.products.length ? b.products : [...(g.products || [])],
            clips: b.clips.length ? b.clips : [...(g.clips || [])]
        }));
        return blocksBudget(filled) > 0 ? filled : spreadBudget(filled, g.budget);
    }
    const oldTiers = (g.allocations || []).length
        ? g.allocations.map(a => ({ tier: a.tier || '', kols: a.kols ?? '' }))
        : [emptyTier()];
    const legacy = plats.map((p, idx) => ({
        platform: p,
        target: needTarget(p) ? asArr(g.target) : [],
        product_targets: null,
        budget_mode: 'total',
        product_budgets: {},
        concept_split: false,
        product_concepts: {},
        // ของเก่าสินค้า/คลิปเป็นของกลุ่ม = ทุก Platform ใช้ชุดเดียวกันอยู่แล้ว ยกลงให้ครบทุกบล็อก
        products: [...(g.products || [])],
        clips: [...(g.clips || [])],
        sets: [emptySet({
            content_type: g.content_type || '',
            media_type: g.media_type || '',
            content_format: g.content_format || '',
            tiers: idx === 0 ? oldTiers : [emptyTier()]
        })]
    }));
    // ข้อมูลเก่ามีงบก้อนเดียวต่อกลุ่ม — เกลี่ยลงแต่ละ Platform ตามสัดส่วนจำนวนคน
    return spreadBudget(legacy, g.budget);
}

// แบนโครง 3 ชั้นออกเป็น allocations — 1 แถว = Platform + Content Type + Tier
export function flattenBlocks(blocks) {
    return (blocks || []).flatMap(b => (b.sets || []).flatMap(s =>
        (s.tiers || []).filter(t => t.tier).map(t => ({
            platform: b.platform,
            tier: t.tier,
            kols: Number(t.kols) || 0,
            campaign: s.campaign || null,
            content_type: s.content_type || null,
            media_type: s.media_type || null,
            content_format: s.content_format || null
        }))));
}

// หาค่าที่ใช้กับ KOL คนหนึ่ง — เลือกตาม Platform (และ Tier ถ้าระบุ)
// ไม่เจอ -> ถอยไปใช้ค่าระดับกลุ่มแบบเดิม
export function specFor(g, platform, tier) {
    const rows = (g.allocations || []).filter(a => a.platform === platform);
    const hit = (tier && rows.find(a => a.tier === tier)) || rows[0] || null;
    if (hit && (hit.content_type || hit.media_type || hit.content_format)) {
        return {
            content_type: hit.content_type || null,
            media_type: hit.media_type || null,
            content_format: hit.content_format || null
        };
    }
    return {
        content_type: g.content_type || null,
        media_type: g.media_type || null,
        content_format: g.content_format || null
    };
}

// รหัสสินค้าที่อยู่ในช่องสินค้าของคลิป ("L3,L4" / "L3 - ชื่อ, L4") เทียบกับรหัสที่รู้จัก
// เทียบแบบเต็มรหัส ("L1" ไม่ไปจับ "L10")
export function productCodesIn(value, known) {
    const keys = (known || []).map(String);
    const out = [];
    String(value == null ? '' : value).split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
        const hit = keys.find(k => tok === k || tok.startsWith(k + ' '));
        if (hit && !out.includes(hit)) out.push(hit);
    });
    return out;
}

// Target ของ Platform นั้น (ของเก่าเก็บไว้ระดับกลุ่ม)
// ส่ง product (สินค้าของคลิป) มาด้วย = เอาเฉพาะ Target ของสินค้านั้น · ไม่รู้สินค้า/ไม่มีข้อมูลต่อสินค้า = Target รวมของ Platform
// ต้องตรงกับ resolveGroupTarget ฝั่ง server (server/src/store/logic.js)
export function targetFor(g, platform, product) {
    if (Array.isArray(g.blocks) && g.blocks.length) {
        const b = g.blocks.find(x => x.platform === platform);
        if (b) {
            const pt = b.product_targets;
            if (product && pt && typeof pt === 'object' && !Array.isArray(pt)) {
                const codes = productCodesIn(product, Object.keys(pt));
                const picked = [...new Set(codes.flatMap(c => asArr(pt[c])))];
                if (picked.length) return picked;
            }
            return asArr(b.target);
        }
    }
    return needTarget(platform) ? asArr(g.target) : [];
}

// ฟอร์มแคมเปญ: เตรียม Target แยกต่อสินค้าของบล็อก (1 แถว = 1 สินค้า)
// แคมเปญที่บันทึกก่อนมีแบบนี้เก็บ Target รวมก้อนเดียวต่อ Platform — แบ่งให้อัตโนมัติ:
// สินค้าได้ Target เดิมที่อยู่ในรายการของสินค้านั้น · Target เดิมที่ไม่ตรงสินค้าไหนเลยเก็บใน legacy_orphans ไว้เตือน
export function withProductTargets(b) {
    const union = asArr(b.target);
    const pt0 = b.product_targets;
    const saved = pt0 && typeof pt0 === 'object' && !Array.isArray(pt0) ? pt0 : null;
    const pt = {};
    (b.products || []).forEach(code => {
        pt[code] = saved ? asArr(saved[code]) : union.filter(t => targetsForProduct(code).includes(t));
    });
    const used = new Set(Object.values(pt).flat());
    return { ...b, product_targets: pt, legacy_orphans: saved ? [] : union.filter(t => !used.has(t)) };
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

// งบของ Platform แยกต่อสินค้าไหม (ไม่มีค่า / ข้อมูลเก่า = งบรวมก้อนเดียว)
export const isSplitBudget = b => !!b && b.budget_mode === 'split';

// ผลรวมงบของสินค้าที่ยังอยู่ในบล็อก
export function productBudgetSum(b) {
    const pb = isMap(b.product_budgets) ? b.product_budgets : {};
    return (b.products || []).reduce((n, c) => n + num(pb[c]), 0);
}

// ตอนบันทึก: แยกต่อสินค้า → เก็บงบเฉพาะสินค้าที่ยังอยู่ และ budget = ผลรวม (งบกลุ่ม/งบแคมเปญ/แบ่งค่าตัวที่อ่าน budget ใช้ต่อได้เหมือนเดิม)
// ก้อนเดียว → เขียน budget_mode 'total' ไว้ชัด ๆ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้) และไม่เก็บงบรายสินค้า
// ต้องตรงกับ carryProductBudgets ฝั่ง server (server/src/store/logic.js)
export function packBudgets(b) {
    const { budget_before_split, product_budgets, ...rest } = b;
    if (!isSplitBudget(b)) return { ...rest, budget_mode: 'total' };
    const pb = {};
    (rest.products || []).forEach(c => { pb[c] = num(isMap(product_budgets) ? product_budgets[c] : 0); });
    const sum = Object.values(pb).reduce((n, v) => n + v, 0);
    return { ...rest, budget_mode: 'split', product_budgets: pb, budget: sum > 0 ? String(sum) : '' };
}

// ---------- Concept แยกต่อสินค้า (ต่อ Platform — ช่องอยู่ในแถวสินค้าที่เดียวกับ Target / งบ) ----------
// g.concept = Concept หลักของกลุ่ม · b.concept_split = Platform นี้แยก Concept ต่อสินค้า · b.product_concepts = { รหัส: ข้อความ }
const ctext = v => String(v == null ? '' : v).trim();
export const isBlockSplitConcept = b => !!b && b.concept_split === true;

// กลุ่มนี้มี Platform ไหนแยก Concept บ้าง (platforms = นับเฉพาะ Platform ที่ผู้ดูเห็น)
export const isSplitConcept = (g, platforms) => !!g && Array.isArray(g.blocks)
    && g.blocks.some(b => isBlockSplitConcept(b) && (!platforms || !platforms.length || platforms.includes(b.platform)));

// แถว Concept สำหรับแสดงผล: สินค้าที่ Concept เดียวกันรวมแถวเดียว [{ concept, items: [{ code, label }], main }]
// สินค้าเดียวกันที่ Concept ต่างกันตาม Platform มีชื่อ Platform กำกับ ("L3 · TikTok")
// main = ทุกรายการในแถวใช้ Concept หลัก · only / platforms = จำกัดเฉพาะสินค้า / Platform ที่ผู้ดูเห็น
export function conceptRows(g, only, platforms) {
    const main = ctext(g && g.concept);
    if (!isSplitConcept(g, platforms)) return main ? [{ concept: main, items: [], main: true }] : [];
    const entries = [];
    // นับ Concept ของทุกคู่ (สินค้า, Platform) ที่เห็น รวมที่ว่าง — สินค้าที่มี Concept แค่บาง Platform ต้องมีชื่อ Platform กำกับ
    const conceptsOf = {};
    g.blocks.forEach(b => {
        if (!b || (platforms && platforms.length && !platforms.includes(b.platform))) return;
        const pc = isBlockSplitConcept(b) && isMap(b.product_concepts) ? b.product_concepts : {};
        (b.products || []).filter(c => !only || only.includes(c)).forEach(code => {
            const own = ctext(pc[code]);
            const concept = own || main;
            (conceptsOf[code] = conceptsOf[code] || new Set()).add(concept);
            if (concept) entries.push({ code, platform: b.platform, concept, own: !!own });
        });
    });
    const rows = [];
    entries.forEach(e => {
        const label = conceptsOf[e.code].size > 1 ? e.code + ' · ' + e.platform : e.code;
        let row = rows.find(r => r.concept === e.concept);
        if (!row) { row = { concept: e.concept, items: [], main: true }; rows.push(row); }
        if (e.own) row.main = false;
        if (!row.items.some(it => it.label === label)) row.items.push({ code: e.code, label });
    });
    return rows;
}

// มีสินค้าที่ใส่ Concept ของตัวเองจริงไหม (ในขอบเขตที่เห็น) — เปิดแยกแต่ยังไม่ได้ใส่ = แสดงแบบ Concept เดียวของกลุ่ม
export const hasOwnConcepts = (g, only, platforms) => conceptRows(g, only, platforms).some(r => !r.main);

// ข้อความบรรทัดเดียว (แถบหัวกลุ่ม) — ไม่ได้แยก = Concept หลักเหมือนเดิม
// แยกแล้ว: บอกเฉพาะสินค้าที่มี Concept ของตัวเอง (เกิน 3 ตัวย่อเป็น +N) ที่เหลือรวมเป็น "สินค้าอื่น = Concept หลัก"
// full = ไม่ย่อ ใส่ทุกรหัส (ใช้เป็น tooltip) · only / platforms = จำกัดเฉพาะสินค้า / Platform ที่ผู้ดูเห็น (หน้าเอเจนซี่)
export function conceptText(g, full = false, only, platforms) {
    if (!isSplitConcept(g, platforms)) return ctext(g && g.concept);
    const rows = conceptRows(g, only, platforms);
    const own = rows.filter(r => !r.main);
    const rest = rows.find(r => r.main);
    if (!own.length) return rest ? rest.concept : '';
    const list = items => {
        const l = items.map(it => it.label);
        return full || l.length <= 3 ? l.join(', ') : l.slice(0, 3).join(', ') + ' +' + (l.length - 3);
    };
    return [
        ...own.map(r => list(r.items) + ' = ' + r.concept),
        ...(rest ? [(full ? list(rest.items) : 'สินค้าอื่น') + ' = ' + rest.concept + (full ? ' (Concept หลัก)' : '')] : [])
    ].join(' · ');
}

// ตอนบันทึก (ต่อบล็อก): เขียน concept_split ไว้ชัด ๆ เสมอ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้)
// แยกอยู่ → เก็บเฉพาะสินค้าที่ยังอยู่ในบล็อกและมีข้อความ · ไม่แยก → ไม่เก็บ product_concepts
// ต้องตรงกับ carryProductConcepts ฝั่ง server (server/src/store/logic.js)
export function packConcepts(b) {
    const { product_concepts, ...rest } = b;
    if (!isBlockSplitConcept(b)) return { ...rest, concept_split: false };
    const pc = {};
    (rest.products || []).forEach(c => {
        const v = ctext(isMap(product_concepts) ? product_concepts[c] : '');
        if (v) pc[c] = v;
    });
    return { ...rest, concept_split: true, product_concepts: pc };
}

// ตอนบันทึก: Platform ที่ไม่ใช้ Campaign เก็บเป็นว่างเสมอ (กันค่าค้างจากข้อมูลเก่า)
// Facebook / Instagram: เก็บค่า Campaign ซ้ำลง content_type ด้วย (หน้าอื่นอ่านจาก content_type)
export function packCampaigns(b) {
    if (campaignIsCtype(b.platform)) return { ...b, sets: (b.sets || []).map(s => ({ ...s, content_type: s.campaign || '' })) };
    if (needCampaign(b.platform)) return b;
    return { ...b, sets: (b.sets || []).map(s => ({ ...s, campaign: '' })) };
}

// ตอนบันทึก: เก็บ Target เฉพาะสินค้าที่ยังอยู่ในบล็อก และคิด Target รวม (b.target) ใหม่จากทุกสินค้า
// ให้หน้าที่ยังอ่าน Target รวมได้ค่าตรงกับที่เลือกจริง · Platform ที่ไม่ใช้ Target เก็บเป็นว่าง · ตัดตัวช่วยเตือนของฟอร์มทิ้ง
export function packProductTargets(b) {
    const { legacy_orphans, ...rest } = b;
    const src = rest.product_targets && typeof rest.product_targets === 'object' ? rest.product_targets : {};
    const pt = {};
    (rest.products || []).forEach(code => { pt[code] = needTarget(rest.platform) ? asArr(src[code]) : []; });
    return { ...rest, product_targets: pt, target: [...new Set(Object.values(pt).flat())] };
}

// จำนวน KOL ในขอบเขตที่ระบุ — ใช้ตอนตั้งลิงก์เอเจนซี่ (เจ้าที่รับแค่ TikTok ต้องได้จำนวนของ TikTok)
// groupKeys ว่าง = ทุกกลุ่ม · platforms ว่าง = ทุก Platform
export function kolInScope(groups, groupKeys, platforms) {
    const gk = (groupKeys || []).filter(Boolean);
    const pf = (platforms || []).filter(Boolean);
    return (groups || [])
        .filter(g => !gk.length || gk.includes(g.key))
        .reduce((n, g) => {
            const rows = (g.allocations || []).filter(a => !pf.length || pf.includes(a.platform));
            if (rows.length) return n + rows.reduce((s, a) => s + (Number(a.kols) || 0), 0);
            // ไม่มี allocations ให้แยก -> ใช้ยอดทั้งกลุ่ม ถ้ากลุ่มนั้นอยู่ในขอบเขต Platform
            const inScope = !pf.length || groupPlatforms(g).some(p => pf.includes(p));
            return n + (inScope ? (Number(g.kol_count) || 0) : 0);
        }, 0);
}

// แถว Tier/จำนวน ที่อยู่ในขอบเขต Platform ที่ระบุ (ลิงก์เอเจนซี่จะได้เห็นแค่ของตัวเอง)
export function allocsInScope(g, platforms) {
    const pf = (platforms || []).filter(Boolean);
    return (g.allocations || []).filter(a => !pf.length || !a.platform || pf.includes(a.platform));
}

// สินค้าทั้งหมดของกลุ่ม = รวมของทุก Platform (ไว้ให้หน้าที่ยังอ่านแบบเดิมใช้)
export function blocksProducts(blocks) {
    const out = [];
    (blocks || []).forEach(b => (b.products || []).forEach(c => { if (!out.includes(c)) out.push(c); }));
    return out;
}

// สินค้า / คลิป ของ Platform หนึ่งในกลุ่ม — ไม่เจอก็ถอยไปใช้ค่าของกลุ่มแบบเดิม
export function productsFor(g, platform) {
    const b = (g.blocks || []).find(x => x.platform === platform);
    return (b && (b.products || []).length) ? b.products : (g.products || []);
}
export function clipsFor(g, platform) {
    const b = (g.blocks || []).find(x => x.platform === platform);
    return (b && (b.clips || []).length) ? b.clips : (g.clips || []);
}

// Content Type ที่ Platform หนึ่งในกลุ่มนี้เปิดไว้ (จาก allocations ที่แบนมาจาก blocks)
export function contentTypesOf(g, platform) {
    const out = [];
    (g.allocations || []).forEach(a => {
        if (platform && a.platform && a.platform !== platform) return;
        if (a.content_type && !out.includes(a.content_type)) out.push(a.content_type);
    });
    if (!out.length && g.content_type) out.push(g.content_type);
    return out;
}

// Format (Photo/VDO) + Style (content_format) ของ (Platform + Content Type) — ไม่ต้องให้คนกรอกซ้ำ
export function mediaFor(g, platform, contentType) {
    const rows = (g.allocations || []).filter(a =>
        (!platform || !a.platform || a.platform === platform)
        && (!contentType || !a.content_type || a.content_type === contentType));
    const hit = rows.find(a => a.media_type || a.content_format) || null;
    return {
        media_type: hit ? (hit.media_type || null) : (g.media_type || null),
        content_format: hit ? (hit.content_format || null) : (g.content_format || null)
    };
}

// จำนวนที่ต้องการของ (Platform + Content Type) — ไว้ทำตัวเลข "ส่งแล้ว / ต้องการ" ในตัวกรอง
export function quotaOf(g, platform, contentType) {
    return (g.allocations || [])
        .filter(a => (!platform || a.platform === platform) && (!contentType || a.content_type === contentType))
        .reduce((n, a) => n + (Number(a.kols) || 0), 0);
}

// Tier ที่ (Platform + Content Type) นี้เปิดรับ — ไว้จำกัดตัวเลือกให้เอเจนซี่
// ไม่ระบุ Content Type = ทุก Tier ของ Platform นั้น
export function tiersOf(g, platform, contentType) {
    const out = [];
    (g.allocations || []).forEach(a => {
        if (platform && a.platform && a.platform !== platform) return;
        if (contentType && a.content_type && a.content_type !== contentType) return;
        if (a.tier && !out.includes(a.tier)) out.push(a.tier);
    });
    return out;
}

// งบของ Platform หนึ่งในกลุ่ม — ข้อมูลเก่าที่ยังไม่มีงบรายบล็อกจะถูก toBlocks เกลี่ยให้ตามสัดส่วนคน
export function budgetFor(g, platform) {
    const b = toBlocks(g).find(x => x.platform === platform);
    return b ? num(b.budget) : 0;
}

// 1 คนของ Platform นี้ต้องทำกี่ Content (อย่างน้อย 1 เสมอ)
export function clipCountFor(g, platform) {
    return Math.max(1, clipsFor(g, platform).map(c => String(c || '').trim()).filter(Boolean).length);
}

// "ช่อง" ของกลุ่ม = Platform + Content Type หนึ่งคู่ — ใช้แยกกล่องกรอก/กล่องรายชื่อ
// กลุ่มที่ Facebook เปิด Awareness 10 + Engagement 10 จะได้ 2 ช่อง ไม่ต้องให้ใครติ๊กเอง
export function contentCells(g, platforms) {
    const pf = (platforms || []).filter(Boolean);
    const plats = pf.length ? pf : groupPlatforms(g);
    const out = [];
    plats.forEach(p => {
        const cts = contentTypesOf(g, p);
        if (cts.length) cts.forEach(ct => out.push({ platform: p, contentType: ct }));
        else out.push({ platform: p, contentType: '' });
    });
    return out;
}
// KOL แถวนี้อยู่ช่องไหน — Platform ที่เปิด Content Type ไว้อย่างเดียว
// ให้แถวเก่าที่ยังไม่ระบุตกเข้าช่องนั้นเลย จะได้ไม่มีกล่อง "ยังไม่ระบุ" โดยไม่จำเป็น
export function cellKeyOf(g, sub) {
    const cts = contentTypesOf(g, sub.platform);
    const ct = sub.content_type || (cts.length === 1 ? cts[0] : '');
    return (sub.platform || '') + '::' + ct;
}
export const cellKey = c => c.platform + '::' + c.contentType;
