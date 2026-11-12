import { allTargetsForProduct } from './products.js';

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

// ติดตะกร้า / ไม่ติดตะกร้า (11 พ.ย. 2026) — ตั้งต่อชุด Content Type · บังคับเลือก · ใช้เฉพาะ TikTok ก่อน
// เก็บเป็น set.cart / allocation.cart = true | false (null = ยังไม่เลือก / แคมเปญที่บันทึกก่อนมีช่องนี้)
// ต้องตรงกับ CART_PLATFORMS ฝั่ง server (server/src/store/logic.js — tests/cart-tag.test.cjs เทียบให้)
export const CART_PLATFORMS = ['TikTok'];
export const needCart = p => CART_PLATFORMS.includes(p);
// นับเฉพาะ true / false ตรงตัว — สตริง 'true' / undefined (ร่างหรือแท็บที่เปิดค้างก่อนมีช่องนี้) = ยังไม่เลือก
export const cartValue = v => (v === true ? true : v === false ? false : null);
// ชุด Content Type ชุดหนึ่งเลือกตะกร้าครบหรือยัง (Platform ที่ไม่ใช้ = ผ่านเสมอ)
export const setCartOk = (platform, s) => !needCart(platform) || cartValue(s && s.cart) !== null;
export const CART_LABEL = { true: 'ติดตะกร้า', false: 'ไม่ติดตะกร้า' };

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
export const emptySet = (over = {}) => ({ campaign: '', content_type: '', media_type: '', content_format: '', cart: null, tiers: [emptyTier()], ...over });
// product_targets = Target แยกต่อสินค้า { รหัสสินค้า: [Target] } · target = รวมทุกสินค้า (ให้หน้าที่ยังอ่านแบบรวมใช้ต่อได้)
// budget_mode = 'total' งบรวมก้อนเดียว (budget) | 'split' แยกงบต่อสินค้า (product_budgets { รหัส: งบ } และ budget = ผลรวม)
// concept_split / product_concepts = Concept แยกต่อสินค้าของ Platform นี้ (ว่าง = ใช้ Concept หลักของกลุ่ม)
// kol_split / product_kols = จำนวน KOL แยกต่อสินค้าของ Platform นี้ { รหัส: จำนวนคน } (ผลรวม = จำนวนคนจากแถว Tier พอดี)
// bundles = ชุดสินค้าที่ KOL 1 คนรีวิวรวมในคลิปเดียว [['L8A','L8B'], ...] (ดู blockBundles)
// singles / row_targets = แถวสินค้ารุ่น 2 (สินค้าเดียวกันอยู่ได้หลายแถว — ดู productRows) · บล็อกใหม่เป็นรุ่น 2 เสมอ
export const emptyBlock = platform => ({ platform, target: [], product_targets: {}, row_targets: {}, budget: '', budget_mode: 'total', product_budgets: {}, concept_split: false, product_concepts: {}, kol_split: false, product_kols: {}, singles: [], bundles: [], products: [], clips: [], sets: [emptySet()] });

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
                // แถวสินค้ารุ่น 2 (สินค้าเดียวกันอยู่ได้หลายแถว · 12 พ.ย. 2026) — ไม่มี = ข้อมูลรุ่นเก่า (upgradeRows แปลงให้ด้านล่าง)
                ...(Array.isArray(b.singles) ? { singles: b.singles.map(String), row_targets: isMap(b.row_targets) ? { ...b.row_targets } : {} } : {}),
                products: [...(b.products || [])],
                clips: [...(b.clips || [])],
                sets: (b.sets && b.sets.length ? b.sets : [emptySet()]).map(s => ({
                    campaign: s.campaign || '',
                    content_type: s.content_type || '',
                    media_type: s.media_type || '',
                    content_format: s.content_format || '',
                    // ติดตะกร้า (TikTok) — แคมเปญที่บันทึกก่อนมีช่องนี้ = null (ฟอร์มให้เลือกก่อนบันทึก)
                    cart: cartValue(s.cart),
                    tiers: (s.tiers && s.tiers.length ? s.tiers : [emptyTier()])
                        .map(t => ({ tier: t.tier || '', kols: t.kols ?? '' }))
                }))
            };
        });
        // บล็อกที่บันทึกไว้ก่อนมีช่องงบ -> เกลี่ยงบของกลุ่มลงไปให้ ไม่ให้กลายเป็น 0
        // บล็อกที่บันทึกก่อนมีช่องสินค้า/คลิป -> ยกของกลุ่มลงไปให้
        // แถวสินค้า: ข้อมูลรุ่นเก่าแปลงเป็นรุ่น 2 (แถวเท่าเดิม ค่าเท่าเดิม) — ทุกหน้าที่อ่านผ่าน toBlocks / ฟอร์ม ใช้รูปเดียวกัน
        const filled = kept.map(b => upgradeRows({
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
    return spreadBudget(legacy.map(upgradeRows), g.budget);
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
            content_format: s.content_format || null,
            // ติดตะกร้า — Platform ที่ไม่ใช้เก็บ null เสมอ (กันค่าค้างตอนเปลี่ยน Platform)
            cart: needCart(b.platform) ? cartValue(s.cart) : null
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

// Target ของแถวที่บันทึกไว้ เทียบกับ Target ต่อรหัส (product_targets) — ใช้ตอนอ่านข้อมูลที่บันทึกแล้วเท่านั้น (ไม่ใช่ state ของฟอร์มที่กำลังแก้)
// ปกติ product_targets = รวมของทุกแถว (packProductTargets เขียนพร้อมกัน) จึงคืน row_targets ตามเดิม
// ต่างกัน = มีคนแก้ product_targets จากที่อื่น (server รุ่นก่อนที่ยังไม่รีสตาร์ตแก้ชื่อ Target ในหน้า Products & Targets — ผลรีวิว 12 พ.ย.)
//   → ชื่อที่ไม่อยู่ใน Target ต่อรหัสแล้วตัดทิ้ง · แถวเดี่ยวเติมชื่อจาก Target ต่อรหัสที่ไม่ใช่ของแถวอื่น (ได้ชื่อใหม่ที่ถูกแก้แทน)
// ต้องตรงกับ savedRowTargets ฝั่ง server (server/src/store/logic.js)
function savedRowTargets(b, rows, r) {
    const rt = isMap(b.row_targets) ? b.row_targets : {};
    const own = asArr(rt[r.key]);
    const pt = isMap(b.product_targets) ? b.product_targets : null;
    if (!pt) return own;
    // ชุด: ชื่อที่ยังอยู่ใน Target ต่อรหัสของรหัสไหนในชุดก็ได้ = ยังใช้ (ข้อมูลเก่าที่ Target ของแต่ละรหัสในชุดไม่เท่ากันไม่หาย)
    const ok = own.filter(t => r.codes.some(c => asArr(pt[c]).includes(t)));
    if (ok.length === own.length) return own;
    if (r.codes.length !== 1) return ok;
    const c = r.codes[0];
    const others = new Set(rows.filter(x => x.key !== r.key && x.codes.includes(c)).flatMap(x => asArr(rt[x.key])));
    return [...new Set([...ok, ...asArr(pt[c]).filter(t => !others.has(t))])];
}

// Target ของคลิปจากแถวสินค้า — รุ่น 2: แถวที่รหัสในคลิปตรงกันพอดี (row_targets) ก่อน
// ไม่ตรงแถวไหน / แถวนั้นยังไม่มี Target / ข้อมูลรุ่นเก่า = รวม Target ต่อรหัสของทุกรหัสในคลิป (product_targets — กติกาเดิม)
// คืน [] = ไม่รู้ (ผู้เรียกถอยไปใช้ Target รวมของ Platform)
function clipRowTargets(b, product) {
    const pt = isMap(b.product_targets) ? b.product_targets : null;
    const v2 = hasRowModel(b) && isMap(b.row_targets);
    if (!product || (!pt && !v2)) return [];
    // รหัสที่รู้จัก: รุ่นเก่าใช้คีย์ของ product_targets ตามเดิม · รุ่น 2 รวมสินค้าของบล็อกด้วย (แถวจับคู่จากรายการสินค้า)
    const known = v2 ? uniqStr([...(b.products || []), ...(pt ? Object.keys(pt) : [])]) : Object.keys(pt);
    const codes = productCodesIn(product, known);
    if (!codes.length) return [];
    if (v2) {
        const rows = productRows(b);
        const row = rows.find(r => sameCodes(r.codes, codes));
        const own = row ? savedRowTargets(b, rows, row) : [];
        if (own.length) return own;
    }
    return pt ? [...new Set(codes.flatMap(c => asArr(pt[c])))] : [];
}

// Target ของ Platform นั้น (ของเก่าเก็บไว้ระดับกลุ่ม)
// ส่ง product (สินค้าของคลิป) มาด้วย = Target ของแถวสินค้าที่คลิปนั้นอยู่ (clipRowTargets) · ไม่รู้สินค้า/ไม่มีข้อมูลต่อสินค้า = Target รวมของ Platform
// ต้องตรงกับ resolveGroupTarget ฝั่ง server (server/src/store/logic.js)
export function targetFor(g, platform, product) {
    if (Array.isArray(g.blocks) && g.blocks.length) {
        const b = g.blocks.find(x => x.platform === platform);
        if (b) {
            const picked = clipRowTargets(b, product);
            if (picked.length) return picked;
            return asArr(b.target);
        }
    }
    return needTarget(platform) ? asArr(g.target) : [];
}

// ฟอร์มแคมเปญ: เตรียม Target ของแต่ละแถวสินค้า (row_targets — บล็อกผ่าน upgradeRows มาแล้ว)
// แคมเปญที่บันทึกก่อนมี Target ต่อสินค้า (row_targets = null) เก็บ Target รวมก้อนเดียวต่อ Platform — แบ่งให้อัตโนมัติ:
// แถวได้ Target เดิมที่อยู่ในรายการของสินค้าในแถว · Target เดิมที่ไม่ตรงแถวไหนเลยเก็บใน legacy_orphans ไว้เตือน
export function withProductTargets(b0) {
    const b = upgradeRows(b0);
    const union = asArr(b.target);
    const saved = isMap(b.row_targets) ? b.row_targets : null;
    const rows = productRows(b);
    const rt = {};
    rows.forEach(r => {
        // นับ Target ที่ Admin ซ่อนแล้วด้วย (หน้า Products & Targets) — แคมเปญเก่าที่เลือกไว้ไม่กลายเป็น Target ค้าง
        // ที่บันทึกไว้ = เทียบกับ Target ต่อรหัสก่อน (savedRowTargets — กันชื่อ Target ที่ถูกแก้จากที่อื่นกลับมา)
        rt[r.key] = saved ? savedRowTargets(b, rows, r) : union.filter(t => r.codes.some(c => allTargetsForProduct(c).includes(t)));
    });
    const used = new Set(Object.values(rt).flat());
    return { ...b, row_targets: rt, legacy_orphans: saved ? [] : union.filter(t => !used.has(t)) };
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------- แถวสินค้า: สินค้าเดี่ยว + ชุดสินค้า (Bundle — KOL 1 คนรีวิวหลายสินค้ารวมในคลิปเดียว เช่น L8A + L8B) ต่อ Platform ----------
// สินค้าเดียวกันอยู่ได้หลายแถว (ผู้ใช้สั่ง 12 พ.ย. 2026): แถว L10 เดี่ยว + ชุด L10 + L20 + ชุด L10 + L23 พร้อมกัน
//   แต่ละแถวมี จำนวนคน / งบ / Concept / Target ของตัวเอง · คลิปนับเข้าแถวที่รหัสในช่องสินค้าตรงกันพอดี ("L10" = แถว L10 · "L10,L20" = ชุด L10 + L20)
// รูปข้อมูลของบล็อก (รุ่น 2 — มี singles):
//   products = รหัสทุกตัวที่อยู่ในแถวไหนก็ได้ (ไม่ซ้ำ — หน้าอื่น / server ใช้เป็น "สินค้าของ Platform" เหมือนเดิม)
//   singles  = รหัสที่มีแถวเดี่ยวของตัวเอง · bundles = [[รหัส...], ...] ชุดละอย่างน้อย 2 รหัส ซ้อนกันได้ (ชุดรหัสเดียวกันซ้ำ = ตัดทิ้ง)
//   ค่าของแถว (product_kols / product_budgets / product_concepts) เก็บที่ key ของแถว — เดี่ยว = รหัส · ชุด = รหัสเรียงแล้วต่อด้วย + ("L10+L20")
//   row_targets { key: [Target] } = Target ของแต่ละแถว · product_targets { รหัส: [Target] } = รวม Target ของทุกแถวที่มีรหัสนั้น (ให้ตัวอ่านแบบต่อรหัสใช้ต่อได้)
// ข้อมูลรุ่นเก่า (ไม่มี singles — แคมเปญก่อน 12 พ.ย. / KOL รายคน ที่ server สร้าง): 1 รหัสอยู่ได้ชุดเดียว · รหัสที่ไม่อยู่ในชุด = แถวเดี่ยว
//   ค่าของชุดเก็บที่หัวชุด (รหัสแรก) · Target เก็บต่อรหัส (ทุกรหัสในชุดเท่ากัน) — อ่านได้ตรงเดิมทุกจุด (rowValue / rowTargetsOf) ฟอร์มแปลงเป็นรุ่น 2 ตอนเปิด (upgradeRows)
// ต้องตรงกับ server/src/store/logic.js (blockBundles / blockSingles / blockRows / rowKeyOf) ทุกตัวอักษร — tests/product-row-overlap.test.cjs เทียบสองฝั่ง
export const hasRowModel = b => !!b && Array.isArray(b.singles);
export const rowKeyOf = codes => (codes.length === 1 ? String(codes[0]) : codes.map(String).sort().join('+'));
const uniqStr = list => [...new Set((list || []).map(String))];
const sameCodes = (a, b) => a.length === b.length && a.every(c => b.includes(c));

// ชุดสินค้าของบล็อก — เฉพาะรหัสที่อยู่ในบล็อก · ชุดละอย่างน้อย 2 รหัส · รุ่นเก่า: 1 รหัสอยู่ได้ชุดเดียว (ชุดหลังที่ใช้รหัสซ้ำถูกตัดรหัสนั้น)
// รุ่น 2: ซ้อนกันได้ แต่ชุดที่มีรหัสชุดเดียวกัน (ไม่สนลำดับ) ซ้ำ = เก็บอันแรก
export function blockBundles(b) {
    const products = uniqStr(b && b.products);
    const v2 = hasRowModel(b);
    const used = new Set();
    const seen = new Set();
    const out = [];
    (b && Array.isArray(b.bundles) ? b.bundles : []).forEach(raw => {
        if (!Array.isArray(raw)) return;
        const codes = [];
        raw.map(String).forEach(c => { if (products.includes(c) && (v2 || !used.has(c)) && !codes.includes(c)) codes.push(c); });
        if (codes.length < 2) return;
        if (v2) {
            const k = rowKeyOf(codes);
            if (seen.has(k)) return;
            seen.add(k);
        } else codes.forEach(c => used.add(c));
        out.push(codes);
    });
    return out;
}

// รหัสที่มีแถวเดี่ยว — รุ่นเก่า = รหัสที่ไม่อยู่ในชุดไหน · รุ่น 2 = ที่อยู่ใน singles + รหัสที่ไม่อยู่ในแถวไหนเลย (ไม่ให้สินค้าหายจากตา)
export function blockSingles(b) {
    const products = uniqStr(b && b.products);
    const inBundle = new Set(blockBundles(b).flat());
    if (!hasRowModel(b)) return products.filter(c => !inBundle.has(c));
    const listed = new Set(b.singles.map(String));
    return products.filter(c => listed.has(c) || !inBundle.has(c));
}

// แถวสินค้าของบล็อกตามลำดับสินค้า: ไล่รหัสตามลำดับ → แถวเดี่ยวของรหัสนั้น (ถ้ามี) แล้วชุดที่มีรหัสนั้นที่ยังไม่ได้ขึ้น
// → [{ key, head, codes, label, bundle }] · key = ที่เก็บค่าของแถว (รุ่น 2) · head = รหัสแรกของแถว (ที่เก็บค่าของชุดในข้อมูลรุ่นเก่า)
// label ของชุด = "L8A + L8B" · ข้อมูลรุ่นเก่าได้แถวเหมือนเดิมทุกอย่าง
export function productRows(b) {
    const products = uniqStr(b && b.products);
    const bundles = blockBundles(b);
    const singles = new Set(blockSingles(b));
    const rows = [];
    const doneSingle = new Set();
    const doneBundle = new Set();
    products.forEach(code => {
        if (singles.has(code) && !doneSingle.has(code)) {
            doneSingle.add(code);
            rows.push({ key: code, head: code, codes: [code], label: code, bundle: false });
        }
        bundles.forEach((bd, k) => {
            if (doneBundle.has(k) || !bd.includes(code)) return;
            doneBundle.add(k);
            rows.push({ key: rowKeyOf(bd), head: bd[0], codes: bd, label: bd.join(' + '), bundle: true });
        });
    });
    return rows;
}

// ที่เก็บค่าของแถว: รุ่น 2 = key · รุ่นเก่า = หัวชุด (แถวเดี่ยว key = head = รหัสอยู่แล้ว)
const slotOf = (b, r) => (hasRowModel(b) ? r.key : r.head);
// ค่าของแถวจาก map ต่อแถว (product_kols / product_budgets / product_concepts) — อ่านได้ทั้งสองรุ่น
export const rowValue = (b, name, r) => (b && isMap(b[name]) ? b[name][slotOf(b, r)] : undefined);
// Target ของแถว — รุ่น 2 = row_targets[key] · รุ่นเก่า = รวม Target ต่อรหัสของทุกรหัสในแถว (ชุดมีค่าเท่ากันทุกรหัสอยู่แล้ว)
export function rowTargetsOf(b, r) {
    if (hasRowModel(b) && isMap(b.row_targets)) return asArr(b.row_targets[r.key]);
    const pt = b && isMap(b.product_targets) ? b.product_targets : {};
    return [...new Set(r.codes.flatMap(c => asArr(pt[c])))];
}
// แถวที่รหัสในช่องสินค้าของคลิปตรงกันพอดี (ไม่สนลำดับ) — ไม่มี = null
export function rowOfProduct(b, product) {
    const codes = productCodesIn(product, uniqStr(b && b.products));
    if (!codes.length) return null;
    return productRows(b).find(r => sameCodes(r.codes, codes)) || null;
}

// แปลงบล็อกรุ่นเก่าเป็นรุ่น 2 (ฟอร์มแคมเปญ / ร่าง เรียกตอนเปิด) — แถวเท่าเดิม ค่าเท่าเดิม แค่ย้ายที่เก็บ
// ค่าของชุดย้ายจากหัวชุดไปที่ key ของแถว · Target ต่อแถว = Target ต่อรหัสเดิม (null = แคมเปญก่อนมี Target ต่อสินค้า ให้ withProductTargets แบ่งเอง)
export function upgradeRows(b) {
    if (!b || hasRowModel(b)) return b;
    const rows = productRows(b);
    const remap = name => {
        if (!isMap(b[name])) return b[name];
        const m = {};
        rows.forEach(r => { const v = b[name][r.head]; if (v !== undefined) m[r.key] = v; });
        return m;
    };
    return {
        ...b,
        singles: rows.filter(r => !r.bundle).map(r => r.key),
        bundles: rows.filter(r => r.bundle).map(r => [...r.codes]),
        product_kols: remap('product_kols'),
        product_budgets: remap('product_budgets'),
        product_concepts: remap('product_concepts'),
        row_targets: isMap(b.product_targets) ? Object.fromEntries(rows.map(r => [r.key, rowTargetsOf(b, r)])) : null
    };
}

// map ต่อแถว: เก็บเฉพาะแถวที่ยังอยู่ (ใช้ตอนแถวเปลี่ยน — รวมชุด / แยกชุด / เอาแถวออก)
const keepRowValues = (b, name) => {
    const m = isMap(b[name]) ? b[name] : {};
    const out = {};
    productRows(b).forEach(r => { if (m[r.key] !== undefined) out[r.key] = m[r.key]; });
    return out;
};
// แถวเปลี่ยนแล้ว: เก็บเฉพาะค่าของแถวที่ยังอยู่ + งบรวม (ตอนแยกงบ) คิดใหม่
function tidyRows(b) {
    const next = {
        ...b,
        product_kols: keepRowValues(b, 'product_kols'),
        product_budgets: keepRowValues(b, 'product_budgets'),
        product_concepts: keepRowValues(b, 'product_concepts'),
        row_targets: keepRowValues(b, 'row_targets')
    };
    if (!isSplitBudget(next)) return next;
    const sum = productBudgetSum(next);
    return { ...next, budget: sum > 0 ? String(sum) : '' };
}

// แถวที่ติ๊ก (key) รวมเป็นชุดเดียว — ติ๊กชุดที่มีอยู่ = เอารหัสทั้งชุดมารวม · ต้องได้อย่างน้อย 2 แถว และชุดนี้ต้องยังไม่มี ไม่งั้นคืนบล็อกเดิม
// แถวที่ติ๊กกลายเป็นชุดเดียว (แถวเดี่ยว / ชุดเดิมที่ติ๊กหายไป) — แถวอื่นที่มีรหัสเดียวกันไม่โดน (เพิ่มแถวเดี่ยวคืนได้ที่ช่องเลือกสินค้า)
// รหัสในชุดเรียงตามลำดับสินค้าในบล็อก · ค่าที่ใส่ไว้ไม่หาย: งบ / จำนวนคน = ผลรวมของแถวที่รวม · Concept = ทุกคอนเซปต์ (ไม่ซ้ำ ต่อบรรทัด) · Target = รวมทุกแถว
export function makeBundle(b0, keys) {
    const b = upgradeRows(b0);
    const want = (keys || []).map(String);
    const rows = productRows(b);
    const picked = rows.filter(r => want.includes(r.key));
    if (picked.length < 2) return b0;
    const members = uniqStr(b.products).filter(c => picked.some(r => r.codes.includes(c)));
    const key = rowKeyOf(members);
    if (rows.some(r => r.bundle && r.key === key && !picked.includes(r))) return b0;
    const val = name => (isMap(b[name]) ? b[name] : {});
    const pb = { ...val('product_budgets') };
    const pk = { ...val('product_kols') };
    const pc = { ...val('product_concepts') };
    const rt = { ...val('row_targets') };
    const bsum = picked.reduce((n, r) => n + num(pb[r.key]), 0);
    const ksum = picked.reduce((n, r) => n + num(pk[r.key]), 0);
    const cons = [...new Set(picked.flatMap(r => conceptParts(pc[r.key])))];
    const tg = [...new Set(picked.flatMap(r => asArr(rt[r.key])))];
    picked.forEach(r => { delete pb[r.key]; delete pk[r.key]; delete pc[r.key]; delete rt[r.key]; });
    if (bsum > 0) pb[key] = String(bsum);
    if (ksum > 0) pk[key] = String(ksum);
    if (cons.length) pc[key] = cons.join('\n');
    rt[key] = tg;
    const pickedSingles = picked.filter(r => !r.bundle).map(r => r.key);
    const pickedBundles = picked.filter(r => r.bundle).map(r => r.key);
    const next = {
        ...b,
        singles: blockSingles(b).filter(c => !pickedSingles.includes(c)),
        bundles: [...blockBundles(b).filter(bd => !pickedBundles.includes(rowKeyOf(bd))), members],
        product_budgets: pb, product_kols: pk, product_concepts: pc, row_targets: rt
    };
    return tidyRows(next);
}

// แยกชุดกลับเป็นทีละสินค้า: รหัสที่ยังไม่มีแถวเดี่ยวได้แถวเดี่ยว · งบ / จำนวนคน / Concept ของชุดไปอยู่ที่แถวเดี่ยวแรกที่เพิ่งเกิด (ตัวอื่นเริ่มว่าง)
// Target: แถวเดี่ยวที่เพิ่งเกิดได้ Target ของชุดไป · รหัสที่มีแถวเดี่ยวอยู่แล้วคงค่าเดิม
// ทุกรหัสมีแถวเดี่ยวอยู่แล้ว = ค่าของชุดบวกเข้าแถวเดี่ยวของรหัสแรก (ยอดรวมไม่หาย)
export function splitBundle(b0, key) {
    const b = upgradeRows(b0);
    const row = productRows(b).find(r => r.bundle && r.key === key);
    if (!row) return b0;
    const had = new Set(blockSingles(b));
    const fresh = row.codes.filter(c => !had.has(c));
    const val = name => ({ ...(isMap(b[name]) ? b[name] : {}) });
    const pb = val('product_budgets'), pk = val('product_kols'), pc = val('product_concepts'), rt = val('row_targets');
    if (fresh.length) {
        const to = fresh[0];
        if (pb[key] !== undefined) pb[to] = pb[key];
        if (pk[key] !== undefined) pk[to] = pk[key];
        if (pc[key] !== undefined) pc[to] = pc[key];
        fresh.forEach(c => { rt[c] = asArr(rt[key]); });
    } else {
        // ทุกรหัสมีแถวเดี่ยวอยู่แล้ว (ผลรีวิว 12 พ.ย.): ค่าของชุดรวมเข้าแถวเดี่ยวของรหัสแรก — จำนวนคน / งบรวมของ Platform ไม่หาย
        // Concept ต่อท้าย (ไม่ซ้ำ) · Target รวมกัน
        const to = row.codes[0];
        const add = (m, v) => { const n = num(m[to]) + num(v); if (n > 0) m[to] = String(n); };
        if (pb[key] !== undefined) add(pb, pb[key]);
        if (pk[key] !== undefined) add(pk, pk[key]);
        const cons = [...new Set([...conceptParts(pc[to]), ...conceptParts(pc[key])])];
        if (cons.length) pc[to] = cons.join('\n');
        rt[to] = [...new Set([...asArr(rt[to]), ...asArr(rt[key])])];
    }
    const next = {
        ...b,
        singles: [...blockSingles(b), ...fresh],
        bundles: blockBundles(b).filter(bd => rowKeyOf(bd) !== key),
        product_budgets: pb, product_kols: pk, product_concepts: pc, row_targets: rt
    };
    return tidyRows(next);
}

// เอาแถวออก (× ที่แถว): แถวเดี่ยว = เอาแถวนั้นออก · ชุด = เอาชุดนั้นออก
// รหัสที่ไม่เหลือแถวไหนแล้ว = ออกจากสินค้าของ Platform ด้วย (เหมือนติ๊กออกที่ช่องเลือกสินค้า) · ค่าของแถวที่เอาออกหายไปด้วย
export function removeRow(b0, key) {
    const b = upgradeRows(b0);
    const rows = productRows(b);
    const row = rows.find(r => r.key === key);
    if (!row) return b0;
    const rest = rows.filter(r => r !== row);
    const left = new Set(rest.flatMap(r => r.codes));
    const next = {
        ...b,
        products: uniqStr(b.products).filter(c => left.has(c)),
        singles: rest.filter(r => !r.bundle).map(r => r.key),
        bundles: rest.filter(r => r.bundle).map(r => [...r.codes])
    };
    return tidyRows(next);
}

// เพิ่มแถวเดี่ยวของรหัส (ช่องเลือกสินค้า) — ยังไม่มีในสินค้าของ Platform = เพิ่มต่อท้าย · อยู่ในชุดแล้ว = ได้แถวเดี่ยวเพิ่มอีกแถว (ชุดไม่โดน)
// targets = Target เริ่มต้นของแถวใหม่ (ฟอร์มส่งกติกาเดียวกับตอนติ๊กสินค้า)
export function addSingle(b0, code, targets = []) {
    const b = upgradeRows(b0);
    const c = String(code);
    if (blockSingles(b).includes(c)) return b0;
    const products = uniqStr(b.products);
    return {
        ...b,
        products: products.includes(c) ? products : [...products, c],
        singles: [...blockSingles(b), c],
        row_targets: { ...(isMap(b.row_targets) ? b.row_targets : {}), [c]: asArr(targets) }
    };
}

// ตอนบันทึก: เขียนรูปรุ่น 2 เสมอ (singles + bundles เป็นอาเรย์) — server ใช้ singles แยกฟอร์มรุ่นใหม่ออกจากแท็บที่เปิดค้างก่อน deploy
// เก็บเฉพาะแถวที่ถูกต้อง (รหัสยังอยู่ในบล็อก · ชุดอย่างน้อย 2 รหัส · ชุดไม่ซ้ำ)
export function packBundles(b0) {
    const b = upgradeRows(b0);
    return { ...b, singles: blockSingles(b), bundles: blockBundles(b).map(x => [...x]) };
}

// งบของ Platform แยกต่อสินค้าไหม (ไม่มีค่า / ข้อมูลเก่า = งบรวมก้อนเดียว)
export const isSplitBudget = b => !!b && b.budget_mode === 'split';

// ผลรวมงบของสินค้าที่ยังอยู่ในบล็อก — ชุดนับครั้งเดียว (งบอยู่ที่หัวชุด)
export function productBudgetSum(b) {
    return productRows(b).reduce((n, r) => n + num(rowValue(b, 'product_budgets', r)), 0);
}
// งบของแถวสินค้า (r = แถวจาก productRows) — 1 แถว = 1 งบ (ชุด = งบเดียวของชุด)
export const rowBudgetOf = (b, r) => num(rowValue(b, 'product_budgets', r));

// ตอนบันทึก: แยกต่อสินค้า → เก็บงบเฉพาะสินค้าที่ยังอยู่ (ชุด = เก็บที่หัวชุดตัวเดียว) และ budget = ผลรวม (งบกลุ่ม/งบแคมเปญ/แบ่งค่าตัวที่อ่าน budget ใช้ต่อได้เหมือนเดิม)
// ก้อนเดียว → เขียน budget_mode 'total' ไว้ชัด ๆ (server ใช้แยกฟอร์มรุ่นใหม่ออกจากแท็บเก่าที่ไม่รู้จักช่องนี้) และไม่เก็บงบรายสินค้า
// ต้องตรงกับ carryProductBudgets ฝั่ง server (server/src/store/logic.js)
export function packBudgets(b) {
    const { budget_before_split, product_budgets, ...rest } = b;
    if (!isSplitBudget(b)) return { ...rest, budget_mode: 'total' };
    const pb = {};
    productRows(rest).forEach(r => { pb[r.key] = num(rowValue(b, 'product_budgets', r)); });
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
    // นับ Concept ของทุกคู่ (แถวสินค้า, Platform) ที่เห็น รวมที่ว่าง — แถวที่มี Concept แค่บาง Platform ต้องมีชื่อ Platform กำกับ
    // 1 รายการ = 1 แถวสินค้า (สินค้าเดี่ยว "L10" / ชุด "L10 + L20") — สินค้าเดียวกันอยู่หลายแถวได้ แต่ละแถวมี Concept ของตัวเอง (12 พ.ย. 2026)
    const conceptsOf = {};
    const nameOf = {};
    g.blocks.forEach(b => {
        if (!b || (platforms && platforms.length && !platforms.includes(b.platform))) return;
        const split = isBlockSplitConcept(b);
        productRows(b).filter(r => !only || r.codes.some(c => only.includes(c))).forEach(r => {
            const own = split ? ctext(rowValue(b, 'product_concepts', r)) : '';
            const concept = own || main;
            // ชุดเดียวกันแต่ละ Platform อาจติ๊กคนละลำดับ ("L8A + L8B" / "L8B + L8A") — นับด้วย key ของแถว ชื่อใช้แบบแรกที่เจอ (ผลรีวิว 12 พ.ย.)
            if (!nameOf[r.key]) nameOf[r.key] = r.label;
            (conceptsOf[r.key] = conceptsOf[r.key] || new Set()).add(concept);
            if (concept) entries.push({ code: r.head, codes: r.codes, key: r.key, platform: b.platform, concept, own: !!own });
        });
    });
    const rows = [];
    entries.forEach(e => {
        const label = conceptsOf[e.key].size > 1 ? nameOf[e.key] + ' · ' + e.platform : nameOf[e.key];
        let row = rows.find(r => r.concept === e.concept);
        if (!row) { row = { concept: e.concept, items: [], main: true }; rows.push(row); }
        if (e.own) row.main = false;
        if (!row.items.some(it => it.label === label)) row.items.push({ code: e.code, label, ...(e.codes.length > 1 ? { codes: e.codes } : {}) });
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
    productRows(rest).forEach(r => {
        const v = conceptParts(rowValue(b, 'product_concepts', r)).join('\n');
        if (v) pc[r.key] = v;
    });
    return { ...rest, concept_split: true, product_concepts: pc };
}

// ---------- จำนวน KOL แยกต่อสินค้า (ต่อ Platform — ช่อง "คน" อยู่ในแถวสินค้าที่เดียวกับ Target / งบ / Concept) ----------
// b.kol_split = Platform นี้แยกจำนวนคนต่อสินค้า · b.product_kols = { รหัส: จำนวนคน }
// กติกา: ทุกสินค้าในบล็อกใส่อย่างน้อย 1 คน และผลรวมต้องเท่าจำนวน KOL ของ Platform (ผลรวมแถว Tier = blockKol) พอดี
// ชุดสินค้า (bundles) นับเป็น 1 แถว — จำนวนคนของชุดเก็บที่หัวชุดตัวเดียว (ดู productRows)
// จำนวนคนรวมยังมาจากแถว Tier ที่เดียวเหมือนเดิม — ตัวเลขต่อสินค้าเป็นแค่การแบ่งยอดนั้น (โควตา / allocations ไม่เปลี่ยน)
export const isKolSplit = b => !!b && b.kol_split === true;
// จำนวนคนของแถวสินค้า — r = แถวจาก productRows (หรือ key ของแถวในบล็อกรุ่น 2)
export const productKolOf = (b, r) => num(typeof r === 'string' ? (b && isMap(b.product_kols) ? b.product_kols[r] : 0) : rowValue(b, 'product_kols', r));
// ผลรวมจำนวนคนของแถวสินค้าที่ยังอยู่ในบล็อก — 1 แถว = 1 จำนวน
export const productKolSum = b => (b ? productRows(b) : []).reduce((n, r) => n + productKolOf(b, r), 0);

// สถานะของบล็อกที่แยกจำนวนคน (null = ไม่ได้แยก) — ฟอร์มใช้ทั้งป้ายหัวรายการสินค้าและตัวตรวจก่อนบันทึก
// total = จำนวนคนจากแถว Tier · sum = ผลรวมที่ใส่ · filled / count = ใส่แล้วกี่แถว / ทั้งหมดกี่แถว (ชุด = 1 แถว)
// missing = แถวที่ยังไม่ใส่ (หรือใส่ 0) — ชื่อแถวของชุดเป็น "L8A + L8B"
export function kolSplitState(b) {
    if (!isKolSplit(b)) return null;
    const rows = productRows(b);
    const missing = rows.filter(r => productKolOf(b, r) < 1).map(r => r.label);
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
    productRows(rest).forEach(r => {
        const n = num(rowValue(b, 'product_kols', r));
        if (n > 0) pk[r.key] = n;
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
    const product_kols = rows.length === 1 && total > 0 ? { [slotOf(b, rows[0])]: String(total) } : {};
    return { ...b, kol_split: true, product_kols };
}

// ---------- ใช้สินค้าเหมือน Platform อื่นในกลุ่มเดียวกัน (ผู้ใช้สั่ง 6 ต.ค. 2026) ----------
// คัดลอก สินค้า + ชุดรวม + จำนวนคนต่อแถว ของต้นทาง (src) มาแทนที่ของปลายทาง (dst) ทั้งหมด — ลำดับสินค้าตามต้นทาง
// ไม่คัดลอก งบ / Concept / Target (ของใคร Platform มัน):
//   งบ / Concept ของปลายทาง เก็บไว้เฉพาะแถวที่ยังเป็นแถวเดียวกับเดิม (สินค้าเดี่ยวเดิม / ชุดเดิมครบทุกตัว) · แถวที่เปลี่ยนรูปเริ่มว่าง
//   Target ของปลายทาง เก็บไว้ต่อรหัสที่ยังอยู่ · รหัสที่เพิ่งเข้ามาได้ seedTarget(code) (ฟอร์มส่งกติกาเดียวกับตอนติ๊กสินค้า) · ทุกรหัสในชุดได้ Target ชุดเดียวกัน
export function copyProductSet(dst0, src0, seedTarget = () => []) {
    const dst = upgradeRows(dst0);
    const src = upgradeRows(src0 || {});
    const products = uniqStr(src.products);
    const singles = blockSingles(src);
    const bundles = blockBundles(src).map(x => [...x]);
    const shape = { products, singles, bundles };
    const rows = productRows(shape);
    const pk = {};
    rows.forEach(r => { const n = productKolOf(src, r); if (n > 0) pk[r.key] = String(n); });
    // แถวเดิมของปลายทางที่มีรหัสชุดเดียวกัน — key ของแถวเรียงรหัสแล้ว (ชุดเดียวกันแต่ละ Platform ติ๊กคนละลำดับก็ได้ key เดียวกัน)
    const oldKeys = new Set(productRows(dst).map(r => r.key));
    const keep = name => {
        const m = isMap(dst[name]) ? dst[name] : {};
        const out = {};
        rows.forEach(r => { if (oldKeys.has(r.key) && m[r.key] !== undefined) out[r.key] = m[r.key]; });
        return out;
    };
    // Target: แถวเดิมของปลายทางคงไว้ · แถวที่เพิ่งเข้ามา = รวม Target ของแต่ละรหัสในแถว
    //   รหัสที่ปลายทางมีแถวเดี่ยวอยู่ = Target ของแถวเดี่ยวนั้น · อยู่แค่ในชุด = Target ของชุดที่มีรหัสนั้น (ผลรีวิว 12 พ.ย. — เดิมเก็บต่อรหัสจึงไม่หาย)
    //   ไม่มีในปลายทางเลย = Target เริ่มต้น (กติกาเดียวกับตอนติ๊กสินค้า)
    const oldRows = productRows(dst);
    const oldRt = isMap(dst.row_targets) ? dst.row_targets : {};
    const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
    const codeTargets = c => {
        if (oldKeys.has(c) && has(oldRt, c)) return asArr(oldRt[c]);
        const inRows = oldRows.filter(o => o.codes.includes(c) && has(oldRt, o.key));
        return inRows.length ? [...new Set(inRows.flatMap(o => asArr(oldRt[o.key])))] : asArr(seedTarget(c));
    };
    const rt = {};
    rows.forEach(r => {
        rt[r.key] = oldKeys.has(r.key) && has(oldRt, r.key)
            ? asArr(oldRt[r.key])
            : [...new Set(r.codes.flatMap(codeTargets))];
    });
    const next = { ...dst, ...shape, kol_split: true, product_kols: pk,
        product_budgets: keep('product_budgets'), product_concepts: keep('product_concepts'), row_targets: rt };
    if (!isSplitBudget(next)) return next;
    const sum = productBudgetSum(next);
    return { ...next, budget: sum > 0 ? String(sum) : '' };
}
// สินค้า + ชุดรวม + จำนวนคน เหมือนกันแล้วไหม (ไม่สนลำดับ) — ปุ่มคัดลอกขึ้น "✓ เหมือนแล้ว"
const productSetSig = b => productRows(b).map(r => (r.bundle ? 'B:' : 'S:') + rowKeyOf(r.codes) + '=' + productKolOf(b, r)).sort().join('|');
export const sameProductSet = (a, b) => !!a && !!b && (a.products || []).length > 0 && productSetSig(a) === productSetSig(b);

// ความคืบหน้าต่อสินค้าของกลุ่ม (เฉพาะบล็อกที่แยกจำนวนคน) — หน้าเอเจนซี่ / แท็บรายชื่อ / On Process ใช้ตัวเดียวกัน
// คืน [{ platform, rows: [{ code, need, sent, over, full, codes? }] }] (codes เฉพาะแถวที่เป็นชุด) · ไม่มีบล็อกไหนแยก = []
// sent = จำนวน "คน" (person_key) ของ Platform นั้นในกลุ่มนี้ที่ยังไม่ถูกปฏิเสธ
// คนนับเข้าแถวที่รหัสในช่องสินค้าตรงกันพอดี ("L10" = แถว L10 · "L10,L20" = ชุด L10 + L20 · ผู้ใช้สั่ง 12 พ.ย. 2026)
// ไม่ตรงแถวไหนเลย = กติกาเดิม: นับให้ทุกแถวที่มีรหัสไหนของคนนั้น (คลิปเก่าที่ใส่รหัสเดียวของชุด / คนที่รีวิวหลายสินค้าเดี่ยว)
// ชุดสินค้า = 1 แถว (code = "L8A + L8B" · codes = รหัสในชุด)
// subs = รายชื่อที่ผู้ดูเห็น (เอเจนซี่ = ของลิงก์ตัวเอง) · platforms = Platform ในขอบเขตที่ดูอยู่ (ว่าง = ทุก Platform)
export function productKolProgress(g, subs, platforms) {
    if (!g || !Array.isArray(g.blocks)) return [];
    const pf = (platforms || []).filter(Boolean);
    return g.blocks
        .filter(b => isKolSplit(b) && (b.products || []).length && (!pf.length || pf.includes(b.platform)))
        .map(b => {
            const rows = productRows(b);
            const people = rows.map(() => new Set());
            const products = uniqStr(b.products);
            (subs || []).forEach(s => {
                if (!s || s.group_key !== g.key || s.platform !== b.platform || s.status === 'rejected') return;
                const who = s.person_key || ('sub:' + s.id);
                const codes = productCodesIn(s.product, products);
                if (!codes.length) return;
                const exact = rows.findIndex(r => sameCodes(r.codes, codes));
                if (exact >= 0) { people[exact].add(who); return; }
                rows.forEach((r, k) => { if (r.codes.some(c => codes.includes(c))) people[k].add(who); });
            });
            return {
                platform: b.platform,
                rows: rows.map((r, k) => {
                    const need = productKolOf(b, r);
                    const sent = people[k].size;
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

// ชุดที่หน้าอื่นแยกไม่ออก = ใช้ค่าตะกร้าเดียวกัน — หน้า Ads / เอเจนซี่ / On Process จับคู่คลิปกับชุดด้วย (Platform + Content Type) เท่านั้น
// (ผลรีวิว 11 พ.ย.) ชุดที่ Content Type ซ้ำกัน หรือกลุ่ม "ไม่ใช้ Gencode" (ช่อง Content Type ปิด ทุกชุดเป็นกล่องเดียว) ต้องได้ค่าเดียวกัน
export const cartKey = (g, s) => (groupNoGencode(g) ? '' : String((s && s.content_type) || ''));
// เลือกตะกร้าที่ชุดหนึ่ง = ชุดอื่นในบล็อกเดียวกันที่แยกไม่ออกได้ค่าเดียวกันด้วย
export function withSetCart(g, b, si, v) {
    const key = cartKey(g, (b.sets || [])[si]);
    return { ...b, sets: (b.sets || []).map((s, j) => (j === si || cartKey(g, s) === key ? { ...s, cart: cartValue(v) } : s)) };
}
// Content Type ที่มีชุดเลือกตะกร้าต่างกัน (เกิดได้ตอนเปลี่ยน Content Type ของชุดให้ซ้ำกับอีกชุด) — ตัวตรวจฟอร์มไม่ให้บันทึก
export function cartConflicts(g, b) {
    if (!needCart(b && b.platform)) return [];
    const seen = {};
    (b.sets || []).forEach(s => {
        const v = cartValue(s && s.cart);
        if (v === null) return;
        const k = cartKey(g, s);
        (seen[k] = seen[k] || new Set()).add(v);
    });
    return Object.keys(seen).filter(k => seen[k].size > 1);
}

// ตอนบันทึก: ติดตะกร้าเก็บเป็น true / false / null ตรงตัวเสมอ (ส่งคีย์ทุกชุด — server แยกฟอร์มรุ่นใหม่ออกจากแท็บที่เปิดค้างก่อนมีช่องนี้)
// Platform ที่ไม่ใช้ = null (กันค่าค้างเมื่อเปลี่ยน Platform ของบล็อก)
export function packCart(b) {
    const use = needCart(b.platform);
    return { ...b, sets: (b.sets || []).map(s => ({ ...s, cart: use ? cartValue(s.cart) : null })) };
}

// ตอนบันทึก: เก็บ Target ของแถวที่ยังอยู่ (row_targets) + Target ต่อรหัส (product_targets = รวม Target ของทุกแถวที่มีรหัสนั้น)
// + Target รวม (b.target) ใหม่จากทุกแถว — หน้าที่ยังอ่านแบบต่อรหัส / แบบรวม (server รุ่นก่อนที่ยังไม่รีสตาร์ต / หน้า Products & Targets) ได้ค่าตรงกับที่เลือกจริง
// Platform ที่ไม่ใช้ Target เก็บเป็นว่าง · ตัดตัวช่วยเตือนของฟอร์มทิ้ง · บล็อกต้องเป็นรุ่น 2 แล้ว (packBundles มาก่อน)
export function packProductTargets(b0) {
    const { legacy_orphans, ...rest } = upgradeRows(b0);
    const src = isMap(rest.row_targets) ? rest.row_targets : {};
    const rows = productRows(rest);
    const rt = {};
    rows.forEach(r => { rt[r.key] = needTarget(rest.platform) ? asArr(src[r.key]) : []; });
    const pt = {};
    uniqStr(rest.products).forEach(c => { pt[c] = [...new Set(rows.filter(r => r.codes.includes(c)).flatMap(r => rt[r.key]))]; });
    return { ...rest, row_targets: rt, product_targets: pt, target: [...new Set(Object.values(rt).flat())] };
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

// ติดตะกร้าของ (Platform + Content Type) — true / false / null (ไม่ใช่ TikTok / แคมเปญก่อนมีช่องนี้ / ไม่เจอชุด)
// กติกาเดียวกับ resolveGroupCart ฝั่ง server: Content Type ต้องตรงตัว (ไม่ใช่แบบ mediaFor ที่ชุดไม่มี Content Type ใช้ได้กับทุกอัน)
// ไม่รู้ Content Type = ชุดแรกที่เลือกไว้ · อ่านจาก blocks ก่อน (allocations ข้ามชุดที่ยังไม่มี Tier) แล้วค่อยถอยไป allocations
export function cartFor(g, platform, contentType) {
    if (!g || !needCart(platform)) return null;
    const match = x => x && cartValue(x.cart) !== null && (!contentType || x.content_type === contentType);
    const b = (g.blocks || []).find(x => x && x.platform === platform);
    const s = b && (b.sets || []).find(match);
    if (s) return s.cart;
    const a = (g.allocations || []).find(x => x && x.platform === platform && match(x));
    return a ? a.cart : null;
}

// จำนวนที่ต้องการของ (Platform + Content Type) — ไว้ทำตัวเลข "ส่งแล้ว / ต้องการ" ในตัวกรอง
export function quotaOf(g, platform, contentType) {
    return (g.allocations || [])
        .filter(a => (!platform || a.platform === platform) && (!contentType || a.content_type === contentType))
        .reduce((n, a) => n + (Number(a.kols) || 0), 0);
}

// Tier ของ KOL ที่ทีมเลือกได้ในฟอร์มแคมเปญ (เรียงเล็ก → ใหญ่)
export const KOL_TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
// "คละ Tier" (ผู้ใช้ขอ 19 ต.ค. 2026) — ทีมไม่ล็อก Tier ของ Platform นั้น · ตอนกรอกรายชื่อ (หน้าเอเจนซี่ / แถวเพิ่มรายชื่อฝั่งทีม)
// ให้เลือกได้ทุก Tier แล้วเก็บ Tier จริงของแต่ละคน — ค่านี้อยู่แค่ในโครงกลุ่ม ไม่ลงแถวรายชื่อ
export const MIXED_TIER = 'คละ Tier';

// Tier ที่ (Platform + Content Type) นี้เปิดรับ — ไว้จำกัดตัวเลือกให้เอเจนซี่
// ไม่ระบุ Content Type = ทุก Tier ของ Platform นั้น · มี "คละ Tier" = ทุก Tier ตามลำดับปกติ (+ ชื่ออื่นที่ตั้งไว้ต่อท้าย)
export function tiersOf(g, platform, contentType) {
    const out = [];
    let mixed = false;
    (g.allocations || []).forEach(a => {
        if (platform && a.platform && a.platform !== platform) return;
        if (contentType && a.content_type && a.content_type !== contentType) return;
        if (a.tier === MIXED_TIER) mixed = true;
        else if (a.tier && !out.includes(a.tier)) out.push(a.tier);
    });
    return mixed ? [...KOL_TIERS, ...out.filter(t => !KOL_TIERS.includes(t))] : out;
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
