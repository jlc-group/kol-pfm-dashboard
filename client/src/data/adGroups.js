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
// kol_split / product_kols = จำนวน KOL แยกต่อสินค้าของ Platform นี้ { รหัส: จำนวนคน } (ผลรวม = จำนวนคนจากแถว Tier พอดี)
// bundles = ชุดสินค้าที่ KOL 1 คนรีวิวรวมในคลิปเดียว [['L8A','L8B'], ...] (ดู blockBundles)
export const emptyBlock = platform => ({ platform, target: [], product_targets: {}, budget: '', budget_mode: 'total', product_budgets: {}, concept_split: false, product_concepts: {}, kol_split: false, product_kols: {}, bundles: [], products: [], clips: [], sets: [emptySet()] });

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
                // จำนวน KOL แยกต่อสินค้า — ข้อมูลเก่าที่ไม่มีช่องนี้ = ไม่แยก
                kol_split: b.kol_split === true,
                product_kols: isMap(b.product_kols) ? { ...b.product_kols } : {},
                // ชุดสินค้า (รีวิวรวมในคลิปเดียว) — ข้อมูลเก่าที่ไม่มีช่องนี้ = ไม่มีชุด ทุกสินค้าเป็นแถวเดี่ยว
                bundles: Array.isArray(b.bundles) ? b.bundles.filter(Array.isArray).map(x => x.map(String)) : [],
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
        kol_split: false,
        product_kols: {},
        bundles: [],
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

// ---------- ชุดสินค้า (Bundle) — สินค้าที่ KOL 1 คนรีวิวรวมในคลิปเดียว เช่น L8A + L8B (ต่อ Platform) ----------
// b.bundles = [['L8A','L8B'], ...] · 1 รหัสอยู่ได้ชุดเดียว · เฉพาะรหัสที่ยังอยู่ในบล็อก · ชุดต้องมีอย่างน้อย 2 รหัส
// แถวสินค้า (row) = สินค้าเดี่ยว หรือ ทั้งชุด → งบ / จำนวนคน / Concept ของชุดเก็บที่ "หัวชุด" (รหัสแรกของชุด) ที่เดียว รหัสอื่นในชุดไม่มีค่า
// Target ยังเก็บต่อสินค้าเหมือนเดิม (ทุกรหัสในชุดได้ Target ชุดเดียวกัน) — targetFor / resolveGroupTarget อ่านต่อสินค้าได้เลย
// ข้อมูลเก่าไม่มี bundles = ทุกสินค้าเป็นแถวเดี่ยว (ทุกอย่างเหมือนเดิม) · ต้องตรงกับ blockBundles ฝั่ง server (server/src/store/logic.js)
export function blockBundles(b) {
    const products = ((b && b.products) || []).map(String);
    const used = new Set();
    const out = [];
    (b && Array.isArray(b.bundles) ? b.bundles : []).forEach(raw => {
        if (!Array.isArray(raw)) return;
        const codes = [];
        raw.map(String).forEach(c => { if (products.includes(c) && !used.has(c) && !codes.includes(c)) codes.push(c); });
        if (codes.length < 2) return;
        codes.forEach(c => used.add(c));
        out.push(codes);
    });
    return out;
}

// แถวสินค้าของบล็อกตามลำดับสินค้า (ชุดอยู่ตรงตำแหน่งรหัสแรกของชุดที่เจอ)
// → [{ head, codes, label, bundle }] · label ของชุด = "L8A + L8B" · ไม่มีชุด = 1 สินค้า 1 แถวเหมือนเดิม
export function productRows(b) {
    const bundles = blockBundles(b);
    const rows = [];
    ((b && b.products) || []).forEach(code => {
        const bd = bundles.find(x => x.includes(code));
        if (!bd) { rows.push({ head: code, codes: [code], label: code, bundle: false }); return; }
        if (rows.some(r => r.head === bd[0])) return;
        rows.push({ head: bd[0], codes: bd, label: bd.join(' + '), bundle: true });
    });
    return rows;
}

// รหัสที่เก็บค่าของแถวที่สินค้านี้อยู่ (อยู่ในชุด = หัวชุด · ไม่อยู่ในชุด = ตัวเอง)
export const rowHeadOf = (b, code) => { const bd = blockBundles(b).find(x => x.includes(code)); return bd ? bd[0] : code; };

// รวมแถวที่ติ๊กเป็นชุดเดียว (ติ๊กแถวที่เป็นชุดอยู่แล้ว = เอาทั้งชุดมารวมด้วย) — ต้องได้อย่างน้อย 2 แถว ไม่งั้นคืนบล็อกเดิม
// รหัสในชุดเรียงตามลำดับสินค้าในบล็อก → หัวชุด = ตัวแรก
// ค่าที่ใส่ไว้ไม่หาย: งบ / จำนวนคน = ผลรวมของแถวที่รวม (ยอดรวมของ Platform เท่าเดิม) · Concept = ทุกคอนเซปต์ที่ใส่ไว้ (ไม่ซ้ำ ต่อบรรทัด)
// Target = รวมทุก Target ที่เลือกไว้ แล้วให้ทุกรหัสในชุด
export function makeBundle(b, codes) {
    const want = (codes || []).map(String);
    const picked = productRows(b).filter(r => r.codes.some(c => want.includes(c)));
    if (picked.length < 2) return b;
    const members = (b.products || []).filter(c => picked.some(r => r.codes.includes(c)));
    const head = members[0];
    const heads = picked.map(r => r.head);
    const pb = { ...(isMap(b.product_budgets) ? b.product_budgets : {}) };
    const pk = { ...(isMap(b.product_kols) ? b.product_kols : {}) };
    const pc = { ...(isMap(b.product_concepts) ? b.product_concepts : {}) };
    const pt = { ...(isMap(b.product_targets) ? b.product_targets : {}) };
    const bsum = heads.reduce((n, h) => n + num(pb[h]), 0);
    const ksum = heads.reduce((n, h) => n + num(pk[h]), 0);
    const cons = [...new Set(heads.flatMap(h => conceptParts(pc[h])))];
    const tg = [...new Set(members.flatMap(c => asArr(pt[c])))];
    members.forEach(c => { delete pb[c]; delete pk[c]; delete pc[c]; pt[c] = [...tg]; });
    if (bsum > 0) pb[head] = String(bsum);
    if (ksum > 0) pk[head] = String(ksum);
    if (cons.length) pc[head] = cons.join('\n');
    const bundles = [...blockBundles(b).filter(x => !x.some(c => members.includes(c))), members];
    const next = { ...b, bundles, product_budgets: pb, product_kols: pk, product_concepts: pc, product_targets: pt };
    if (!isSplitBudget(next)) return next;
    const sum = productBudgetSum(next);
    return { ...next, budget: sum > 0 ? String(sum) : '' };
}

// แยกชุดกลับเป็นทีละสินค้า: งบ / จำนวนคน / Concept ของชุดอยู่ที่หัวชุด (ตัวแรก) ตามเดิม · รหัสอื่นเริ่มว่าง (ไม่เดาตัวเลขให้)
// Target: ทุกรหัสคง Target ของชุดไว้ (เอาออกเองทีละแถวได้) · ยอดรวมงบ / จำนวนคนของ Platform ไม่เปลี่ยน
export function splitBundle(b, head) {
    return { ...b, bundles: blockBundles(b).filter(x => !x.includes(head)) };
}

// เอาสินค้าออกจากบล็อก = หลุดจากชุดด้วย · ถ้าเป็นหัวชุด ค่าของชุด (งบ / จำนวนคน / Concept) ย้ายไปที่รหัสถัดไปในชุด
// ชุดที่เหลือรหัสเดียว = กลายเป็นแถวปกติ (รหัสที่เหลือได้ค่าของชุดไป) · เรียกได้ทั้งก่อนและหลังเอารหัสออกจาก products
export function dropFromBundle(b, code) {
    const has = (b.products || []).includes(code);
    const bundles = blockBundles(has ? b : { ...b, products: [...(b.products || []), code] });
    const bd = bundles.find(x => x.includes(code));
    if (!bd) return b;
    const rest = bd.filter(c => c !== code);
    const next = { ...b, bundles: bundles.map(x => (x === bd ? rest : x)).filter(x => x.length >= 2) };
    if (bd[0] !== code) return next;
    const move = key => {
        const m = { ...(isMap(b[key]) ? b[key] : {}) };
        if (m[code] !== undefined) m[rest[0]] = m[code];
        delete m[code];
        return m;
    };
    return { ...next, product_budgets: move('product_budgets'), product_kols: move('product_kols'), product_concepts: move('product_concepts') };
}

// ตอนบันทึก: เขียน bundles เป็นอาเรย์เสมอ (ว่าง = ไม่มีชุด) — server (carryProductBundles) ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้
// เก็บเฉพาะชุดที่ถูกต้อง (รหัสยังอยู่ในบล็อก ไม่ซ้ำชุด อย่างน้อย 2 รหัส)
export const packBundles = b => ({ ...b, bundles: blockBundles(b) });

// งบของ Platform แยกต่อสินค้าไหม (ไม่มีค่า / ข้อมูลเก่า = งบรวมก้อนเดียว)
export const isSplitBudget = b => !!b && b.budget_mode === 'split';

// ผลรวมงบของสินค้าที่ยังอยู่ในบล็อก — ชุดนับครั้งเดียว (งบอยู่ที่หัวชุด)
export function productBudgetSum(b) {
    const pb = isMap(b.product_budgets) ? b.product_budgets : {};
    return productRows(b).reduce((n, r) => n + num(pb[r.head]), 0);
}

// ตอนบันทึก: แยกต่อสินค้า → เก็บงบเฉพาะสินค้าที่ยังอยู่ (ชุด = เก็บที่หัวชุดตัวเดียว) และ budget = ผลรวม (งบกลุ่ม/งบแคมเปญ/แบ่งค่าตัวที่อ่าน budget ใช้ต่อได้เหมือนเดิม)
// ก้อนเดียว → เขียน budget_mode 'total' ไว้ชัด ๆ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้) และไม่เก็บงบรายสินค้า
// ต้องตรงกับ carryProductBudgets ฝั่ง server (server/src/store/logic.js)
export function packBudgets(b) {
    const { budget_before_split, product_budgets, ...rest } = b;
    if (!isSplitBudget(b)) return { ...rest, budget_mode: 'total' };
    const pb = {};
    productRows(rest).forEach(r => { pb[r.head] = num(isMap(product_budgets) ? product_budgets[r.head] : 0); });
    const sum = Object.values(pb).reduce((n, v) => n + v, 0);
    return { ...rest, budget_mode: 'split', product_budgets: pb, budget: sum > 0 ? String(sum) : '' };
}

// ---------- Concept แยกต่อสินค้า (ต่อ Platform — ช่องอยู่ในแถวสินค้าที่เดียวกับ Target / งบ) ----------
// g.concept = Concept หลักของกลุ่ม · b.concept_split = Platform นี้แยก Concept ต่อสินค้า · b.product_concepts = { รหัส: ข้อความ }
const ctext = v => String(v == null ? '' : v).trim();
export const isBlockSplitConcept = b => !!b && b.concept_split === true;

// 1 สินค้าใส่ได้หลาย Concept — เก็บเป็นข้อความเดียวเหมือนเดิม คั่นด้วยขึ้นบรรทัดใหม่
// ข้อมูลเก่าที่มี Concept เดียวไม่มี \n จึงได้อาเรย์ 1 ตัว อ่านได้เหมือนเดิมทุกจุดโดยไม่ต้องแปลงข้อมูล
// รับ | เป็นตัวคั่นด้วย (พิมพ์รวดเดียวไม่ต้องกด Enter) — ไม่ใช้ , หรือ / เพราะข้อความ Concept ไทยใช้จริง
export const conceptParts = v => ctext(v).split(/\r?\n|\|/).map(s => s.trim()).filter(Boolean);
// ที่ที่มีพื้นที่บรรทัดเดียว (ชิปกรอง หัวตาราง ตัวเลือกใน dropdown) — ต่อกันด้วย " / "
export const conceptOneLine = v => conceptParts(v).join(' / ');

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
        // สินค้าในชุด (รีวิวรวมในคลิปเดียว) ใช้ Concept ของชุด (เก็บที่หัวชุด) — ทุกรหัสในชุดโชว์ Concept เดียวกัน
        const headOf = {};
        productRows(b).forEach(r => r.codes.forEach(c => { headOf[c] = r.head; }));
        (b.products || []).filter(c => !only || only.includes(c)).forEach(code => {
            const own = ctext(pc[headOf[code] || code]);
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
    if (!isSplitConcept(g, platforms)) return conceptOneLine(g && g.concept);
    const rows = conceptRows(g, only, platforms);
    const own = rows.filter(r => !r.main);
    const rest = rows.find(r => r.main);
    if (!own.length) return rest ? conceptOneLine(rest.concept) : '';
    const list = items => {
        const l = items.map(it => it.label);
        return full || l.length <= 3 ? l.join(', ') : l.slice(0, 3).join(', ') + ' +' + (l.length - 3);
    };
    return [
        ...own.map(r => list(r.items) + ' = ' + conceptOneLine(r.concept)),
        ...(rest ? [(full ? list(rest.items) : 'สินค้าอื่น') + ' = ' + conceptOneLine(rest.concept) + (full ? ' (Concept หลัก)' : '')] : [])
    ].join(' · ');
}

// ตอนบันทึก (ต่อบล็อก): เขียน concept_split ไว้ชัด ๆ เสมอ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้)
// แยกอยู่ → เก็บเฉพาะสินค้าที่ยังอยู่ในบล็อกและมีข้อความ (ชุด = เก็บที่หัวชุดตัวเดียว) · ไม่แยก → ไม่เก็บ product_concepts
// ต้องตรงกับ carryProductConcepts ฝั่ง server (server/src/store/logic.js)
export function packConcepts(b) {
    const { product_concepts, ...rest } = b;
    if (!isBlockSplitConcept(b)) return { ...rest, concept_split: false };
    const pc = {};
    productRows(rest).forEach(({ head: c }) => {
        const v = conceptParts(isMap(product_concepts) ? product_concepts[c] : '').join('\n');
        if (v) pc[c] = v;
    });
    return { ...rest, concept_split: true, product_concepts: pc };
}

// ---------- จำนวน KOL แยกต่อสินค้า (ต่อ Platform — ช่อง "คน" อยู่ในแถวสินค้าที่เดียวกับ Target / งบ / Concept) ----------
// b.kol_split = Platform นี้แยกจำนวนคนต่อสินค้า · b.product_kols = { รหัส: จำนวนคน }
// กติกา: ทุกสินค้าในบล็อกใส่อย่างน้อย 1 คน และผลรวมต้องเท่าจำนวน KOL ของ Platform (ผลรวมแถว Tier = blockKol) พอดี
// ชุดสินค้า (bundles) นับเป็น 1 แถว — จำนวนคนของชุดเก็บที่หัวชุดตัวเดียว (ดู productRows)
// จำนวนคนรวมยังมาจากแถว Tier ที่เดียวเหมือนเดิม — ตัวเลขต่อสินค้าเป็นแค่การแบ่งยอดนั้น (โควตา / allocations ไม่เปลี่ยน)
export const isKolSplit = b => !!b && b.kol_split === true;
export const productKolOf = (b, code) => num(b && isMap(b.product_kols) ? b.product_kols[code] : 0);
// ผลรวมจำนวนคนของสินค้าที่ยังอยู่ในบล็อก — ชุดนับครั้งเดียว
export const productKolSum = b => (b ? productRows(b) : []).reduce((n, r) => n + productKolOf(b, r.head), 0);

// สถานะของบล็อกที่แยกจำนวนคน (null = ไม่ได้แยก) — ฟอร์มใช้ทั้งป้ายหัวรายการสินค้าและตัวตรวจก่อนบันทึก
// total = จำนวนคนจากแถว Tier · sum = ผลรวมที่ใส่ · filled / count = ใส่แล้วกี่แถว / ทั้งหมดกี่แถว (ชุด = 1 แถว)
// missing = แถวที่ยังไม่ใส่ (หรือใส่ 0) — ชื่อแถวของชุดเป็น "L8A + L8B"
export function kolSplitState(b) {
    if (!isKolSplit(b)) return null;
    const rows = productRows(b);
    const missing = rows.filter(r => productKolOf(b, r.head) < 1).map(r => r.label);
    const sum = productKolSum(b);
    const total = blockKol(b);
    return {
        total, sum, missing, count: rows.length, filled: rows.length - missing.length,
        ok: rows.length > 0 && missing.length === 0 && sum === total
    };
}

// ข้อความที่ฟอร์มขึ้นตอนบันทึกไม่ได้ (null = ผ่าน / ไม่ได้แยก) — label = ที่อยู่ในวงเล็บ เช่น "TikTok" หรือ "กลุ่มที่ 2 · TikTok"
// เช่น "จำนวน KOL ต่อสินค้า (TikTok) รวมได้ 8 / 10 คน — ขาด 2 คน"
export function kolSplitProblem(b, label) {
    const st = kolSplitState(b);
    if (!st || st.ok) return null;
    const head = 'จำนวน KOL ต่อสินค้า (' + (label || b.platform) + ')';
    if (!st.count) return head + ' ยังไม่ได้เลือกสินค้า';
    const diff = st.total - st.sum;
    const parts = [];
    if (st.missing.length) parts.push('ยังไม่ใส่จำนวนของ ' + st.missing.join(', ') + ' (อย่างน้อย 1 คน)');
    if (diff !== 0) parts.push('รวมได้ ' + st.sum + ' / ' + st.total + ' คน — ' + (diff > 0 ? 'ขาด ' + diff : 'เกิน ' + (-diff)) + ' คน');
    return head + ' ' + parts.join(' · ');
}

// ตอนบันทึก (ต่อบล็อก): เขียน kol_split ไว้ชัด ๆ เสมอ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้)
// แยกอยู่ → เก็บเฉพาะสินค้าที่ยังอยู่ในบล็อกเป็นตัวเลข (ชุด = เก็บที่หัวชุดตัวเดียว) · ไม่แยก → ไม่ส่ง product_kols (ตัวเลขที่พิมพ์ค้างในฟอร์มไม่ถูกบันทึก)
// ต้องตรงกับ carryProductKols ฝั่ง server (server/src/store/logic.js)
export function packKols(b) {
    const { product_kols, ...rest } = b;
    if (!isKolSplit(b)) return { ...rest, kol_split: false };
    const pk = {};
    productRows(rest).forEach(({ head: c }) => {
        const n = num(isMap(product_kols) ? product_kols[c] : 0);
        if (n > 0) pk[c] = n;
    });
    return { ...rest, kol_split: true, product_kols: pk };
}

// ---------- จำนวนคนใส่ที่สินค้า (ผู้ใช้สั่ง 6 ต.ค. 2026) ----------
// ฟอร์มแคมเปญแยกจำนวน KOL ต่อสินค้าเสมอ (เอาปุ่ม 👥 ออก)
// Tier แยกออกจาก Content Type (ผู้ใช้สั่งรอบ 2 วันเดียวกัน): Tier ตั้งที่ระดับ Platform ใช้ร่วมทุก Content Type และไม่มีจำนวนคน
// จำนวนคนต่อ Content Type มีเฉพาะตอนมีมากกว่า 1 Content Type (ผลรวมต้องเท่าผลรวมจากสินค้า) · Content Type เดียว = จำนวนมาจากสินค้าเอง
// เก็บข้อมูลรูปเดิม (sets[].tiers = [{ tier, kols }]) ให้หน้าอื่นอ่านได้เหมือนเดิม: ทุกชุดมี Tier ชุดเดียวกัน · จำนวนของชุดเก็บที่ Tier ตัวแรก
//   Tier อื่นเป็น 0 แต่ยังอยู่ใน allocations (tiersOf ยังให้เอเจนซี่เลือกได้ครบ · quotaOf ต่อ Content Type รวมถูก)
export const kolAutoTier = b => !!b && (b.sets || []).length === 1;
// ช่องที่เก็บจำนวนคนของชุด = Tier ตัวแรกที่มีชื่อ (ไม่มีสักตัว = ตัวแรก)
// ตอนบันทึก flattenBlocks ทิ้ง Tier ที่ไม่มีชื่อ — ถ้าเก็บที่ตัวแรกที่ยังว่างชื่อ จำนวนทั้งชุดจะหาย (รีวิว 6 ต.ค. 2026)
const kolSlot = s => Math.max(0, (s.tiers || []).findIndex(t => t.tier));
// จำนวนคนของชุดลงที่ช่องเก็บ (ตัวอื่นว่าง)
const putSetKols = (s, v) => { const at = kolSlot(s); return { ...s, tiers: (s.tiers || []).map((t, k) => ({ ...t, kols: k === at ? v : '' })) }; };
// หลังแก้ Tier (ลบชื่อ Tier ตัวแรก / เลือกแค่ Tier ตัวหลัง / ลบ Tier) — ย้ายจำนวนของชุดไปอยู่ช่องเก็บให้ถูกที่ (คืนตัวเดิมถ้าอยู่ถูกที่แล้ว)
const hasVal = t => String(t.kols ?? '').trim() !== '';
export function settleKols(b) {
    if (!b || !Array.isArray(b.sets)) return b;
    let changed = false;
    const sets = b.sets.map(s => {
        const tiers = s.tiers || [];
        const at = kolSlot(s);
        if (!tiers.some((t, k) => k !== at && hasVal(t))) return s;
        changed = true;
        const vals = tiers.filter(hasVal);
        return putSetKols(s, vals.length === 1 ? String(vals[0].kols) : String(setKol(s)));
    });
    return changed ? { ...b, sets } : b;
}
// Content Type เดียว: เขียนผลรวมจากสินค้าลงชุดนั้น (คืนตัวเดิมถ้าไม่ใช่บล็อกชุดเดียว / ค่าตรงอยู่แล้ว)
// ยังไม่ได้ใส่สักสินค้า (แคมเปญเก่าที่เพิ่งเปิดแก้) = คงจำนวนเดิมไว้ให้เห็น — ตัวตรวจก่อนบันทึก (kolSplitProblem) บังคับให้ใส่ครบเอง
export function syncAutoKols(b) {
    if (!kolAutoTier(b)) return b;
    const sum = productKolSum(b);
    if (sum <= 0) return b;
    const s0 = b.sets[0];
    const tiers = s0.tiers || [];
    const at = kolSlot(s0);
    if (tiers.length && String(tiers[at].kols) === String(sum) && tiers.every((t, k) => k === at || !num(t.kols))) return b;
    return { ...b, sets: [putSetKols(s0, String(sum))] };
}
// Tier ของ Platform (ชื่อเรียงตามลำดับ · ชุดแรกเป็นตัวตั้ง)
export const blockTierNames = b => ((b && b.sets && b.sets[0] && b.sets[0].tiers) || [{ tier: '' }]).map(t => t.tier || '');
// เปิดบล็อกในฟอร์ม: ทุกชุดใช้ Tier ชุดเดียวกัน (รวมชื่อ Tier จากทุกชุดตามลำดับที่เจอ) · จำนวนเดิมของแต่ละชุด (รวมทุก Tier) ย้ายไปที่ Tier ตัวแรก
// ข้อมูลเก่าที่แบ่งจำนวนต่อ Tier ไว้ จะเหลือยอดรวมต่อ Content Type (ผู้ใช้สั่งเลิกแบ่งต่อ Tier)
export function unifyTiers(b) {
    if (!b || !(b.sets || []).length) return b;
    const names = [];
    b.sets.forEach(s => (s.tiers || []).forEach(t => { if (t.tier && !names.includes(t.tier)) names.push(t.tier); }));
    if (!names.length) names.push('');
    const sets = b.sets.map(s => {
        const total = setKol(s);
        return { ...s, tiers: names.map((tier, k) => ({ tier, kols: k === 0 && total > 0 ? String(total) : '' })) };
    });
    return { ...b, sets };
}
// ตั้งจำนวนคนของชุด si (ใช้ตอนมีหลาย Content Type)
export const setSetKols = (b, si, v) => ({ ...b, sets: b.sets.map((s, j) => (j === si ? putSetKols(s, v) : s)) });
// เปิดบล็อกในฟอร์ม (แคมเปญเดิม / Platform ที่เพิ่งเลือก): บังคับแยกต่อสินค้า
// บล็อกที่ยังไม่เคยแยกและมีแถวสินค้าแถวเดียว = ยกจำนวนรวมเดิมไปใส่ที่สินค้านั้น (ไม่ต้องกรอกซ้ำ) · หลายแถว = เริ่มว่าง ให้ทีมแบ่งเอง
export function seedKolSplit(b) {
    if (!b || isKolSplit(b)) return b;
    const rows = productRows(b);
    const total = blockKol(b);
    const product_kols = rows.length === 1 && total > 0 ? { [rows[0].head]: String(total) } : {};
    return { ...b, kol_split: true, product_kols };
}

// ---------- ใช้สินค้าเหมือน Platform อื่นในกลุ่มเดียวกัน (ผู้ใช้สั่ง 6 ต.ค. 2026) ----------
// คัดลอก สินค้า + ชุดรวม + จำนวนคนต่อแถว ของต้นทาง (src) มาแทนที่ของปลายทาง (dst) ทั้งหมด — ลำดับสินค้าตามต้นทาง
// ไม่คัดลอก งบ / Concept / Target (ของใคร Platform มัน):
//   งบ / Concept ของปลายทาง เก็บไว้เฉพาะแถวที่ยังเป็นแถวเดียวกับเดิม (สินค้าเดี่ยวเดิม / ชุดเดิมครบทุกตัว) · แถวที่เปลี่ยนรูปเริ่มว่าง
//   Target ของปลายทาง เก็บไว้ต่อรหัสที่ยังอยู่ · รหัสที่เพิ่งเข้ามาได้ seedTarget(code) (ฟอร์มส่งกติกาเดียวกับตอนติ๊กสินค้า) · ทุกรหัสในชุดได้ Target ชุดเดียวกัน
export function copyProductSet(dst, src, seedTarget = () => []) {
    const products = [...new Set(((src && src.products) || []).map(String))];
    const bundles = blockBundles({ products, bundles: src && src.bundles }).map(x => [...x]);
    const rows = productRows({ products, bundles });
    const pk = {};
    rows.forEach(r => { const n = productKolOf(src, r.head); if (n > 0) pk[r.head] = String(n); });
    // แถวเดิมของปลายทางที่มีรหัสชุดเดียวกัน — ไม่ดูหัวชุด (ชุดเดียวกันแต่ละ Platform อาจมีหัวคนละตัว ตามลำดับที่ติ๊กสินค้า)
    const oldRows = productRows(dst);
    const oldOf = r => oldRows.find(o => o.codes.length === r.codes.length && o.codes.every(c => r.codes.includes(c)));
    const keep = key => {
        const m = isMap(dst[key]) ? dst[key] : {};
        const out = {};
        rows.forEach(r => { const o = oldOf(r); if (o && m[o.head] !== undefined) out[r.head] = m[o.head]; });
        return out;
    };
    const oldPt = isMap(dst.product_targets) ? dst.product_targets : {};
    const pt = {};
    products.forEach(c => { pt[c] = Object.prototype.hasOwnProperty.call(oldPt, c) ? asArr(oldPt[c]) : asArr(seedTarget(c)); });
    bundles.forEach(bd => { const tg = [...new Set(bd.flatMap(c => pt[c]))]; bd.forEach(c => { pt[c] = [...tg]; }); });
    const next = { ...dst, products, bundles, kol_split: true, product_kols: pk,
        product_budgets: keep('product_budgets'), product_concepts: keep('product_concepts'), product_targets: pt };
    if (!isSplitBudget(next)) return next;
    const sum = productBudgetSum(next);
    return { ...next, budget: sum > 0 ? String(sum) : '' };
}
// สินค้า + ชุดรวม + จำนวนคน เหมือนกันแล้วไหม (ไม่สนลำดับ) — ปุ่มคัดลอกขึ้น "✓ เหมือนแล้ว"
const productSetSig = b => productRows(b).map(r => [...r.codes].sort().join('+') + '=' + productKolOf(b, r.head)).sort().join('|');
export const sameProductSet = (a, b) => !!a && !!b && (a.products || []).length > 0 && productSetSig(a) === productSetSig(b);

// ความคืบหน้าต่อสินค้าของกลุ่ม (เฉพาะบล็อกที่แยกจำนวนคน) — หน้าเอเจนซี่ / แท็บรายชื่อ / On Process ใช้ตัวเดียวกัน
// คืน [{ platform, rows: [{ code, need, sent, over, full, codes? }] }] (codes เฉพาะแถวที่เป็นชุด) · ไม่มีบล็อกไหนแยก = []
// sent = จำนวน "คน" (person_key) ของ Platform นั้นในกลุ่มนี้ที่ยังไม่ถูกปฏิเสธ — 1 คนที่ช่องสินค้ามีหลายรหัส นับให้ทุกรหัสที่มี
// ชุดสินค้า = 1 แถว (code = "L8A + L8B" · codes = รหัสในชุด) — คนที่ช่องสินค้ามีรหัสไหนของชุดก็ได้ นับให้ชุดนั้น 1 ครั้ง
// subs = รายชื่อที่ผู้ดูเห็น (เอเจนซี่ = ของลิงก์ตัวเอง) · platforms = Platform ในขอบเขตที่ดูอยู่ (ว่าง = ทุก Platform)
export function productKolProgress(g, subs, platforms) {
    if (!g || !Array.isArray(g.blocks)) return [];
    const pf = (platforms || []).filter(Boolean);
    return g.blocks
        .filter(b => isKolSplit(b) && (b.products || []).length && (!pf.length || pf.includes(b.platform)))
        .map(b => {
            const people = {};
            (subs || []).forEach(s => {
                if (!s || s.group_key !== g.key || s.platform !== b.platform || s.status === 'rejected') return;
                const who = s.person_key || ('sub:' + s.id);
                productCodesIn(s.product, b.products).forEach(c => { (people[c] = people[c] || new Set()).add(who); });
            });
            return {
                platform: b.platform,
                rows: productRows(b).map(r => {
                    const need = productKolOf(b, r.head);
                    const who = new Set(r.codes.flatMap(c => [...(people[c] || [])]));
                    const sent = who.size;
                    const row = { code: r.label, need, sent, over: sent > need, full: need > 0 && sent === need };
                    return r.bundle ? { ...row, codes: r.codes } : row;
                })
            };
        });
}

// ---------- กลุ่มที่ไม่ใช้ Gencode ("-" ในฟอร์มแคมเปญ) ----------
// เก็บเป็น g.no_gencode = true ที่ระดับกลุ่ม · g.code_expire ยังเก็บจำนวนวันไว้ (สลับกลับแล้วได้ค่าเดิม) และ code_expire ของแต่ละแถวไม่ถูกแตะ
// ต้องเป็น true ตรงตัวเท่านั้น ห้ามเดาจาก code_expire 0 / ว่าง — มีโค้ดหลายจุดที่ `|| 60` จะกลบค่าพวกนั้นเงียบ ๆ
// โพสต์ที่มี Gencode อยู่แล้ว (กรอกไว้ก่อนเปลี่ยนกลุ่มเป็น "-") ทำงานแบบเดิมทุกอย่าง
// ต้องตรงกับ groupNoGencode / postNoGencode ฝั่ง server (server/src/store/logic.js) ทุกตัวอักษร
export const groupNoGencode = g => !!g && g.no_gencode === true;
// ชุด Content Type ชุดหนึ่งเลือกช่องที่บังคับครบหรือยัง (ใช้ในตัวตรวจฟอร์มแคมเปญ)
// Facebook / Instagram เลือกที่ช่อง Campaign แทน Content Type · Platform อื่นเลือกที่ Content Type
// กลุ่มที่ตั้ง "ไม่ใช้ Gencode" = ไม่ได้ยิงแอด สองช่องนี้ถูกปิดไว้ในฟอร์ม จึงต้องไม่บังคับ
// (ถ้าบังคับต่อจะกลายเป็นบันทึกไม่ได้ทั้งที่ไม่มีช่องให้กรอก)
export const setTypeOk = (g, platform, s) => groupNoGencode(g)
    || !!(campaignIsCtype(platform) ? (s && s.campaign) : (s && s.content_type));
export const postNoGencode = (s, g) => groupNoGencode(g) && !String((s && s.gencode) ?? '').trim();

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
    // ชุดสินค้า: ทุกรหัสในชุดได้ Target ชุดเดียวกัน (รวมของทุกรหัสในชุด) — หน้าอื่น / server อ่าน Target ต่อสินค้าได้ตรงกัน
    blockBundles(rest).forEach(bd => {
        const union = [...new Set(bd.flatMap(c => pt[c] || []))];
        bd.forEach(c => { pt[c] = [...union]; });
    });
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
