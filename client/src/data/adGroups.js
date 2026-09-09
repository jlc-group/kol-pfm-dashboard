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
//   -> ชุด Content Type (Content Type / Photo-VDO / Content Format)
//      -> แถว Tier (Tier / จำนวน KOL)   <- จำนวนคนอยู่ชั้นนี้ที่เดียว
//
// เก็บลงฐานข้อมูลเป็น g.blocks และแบนออกเป็น g.allocations ให้โค้ดเดิมอ่านได้ด้วย

// กลุ่ม Target ใช้เฉพาะบาง Platform — เพิ่มชื่อในลิสต์นี้ที่เดียวถ้าวันหลัง Platform อื่นต้องใช้
export const TARGET_PLATFORMS = ['TikTok'];
export const needTarget = p => TARGET_PLATFORMS.includes(p);

// Content Type ต่างกันตาม Platform
export const CONTENT_TYPES_DEFAULT = ['Review', 'Sale'];
export const CONTENT_TYPES_BY_PLATFORM = { Facebook: ['Awareness', 'Engagement', 'Reels'] };
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

export const emptyTier = () => ({ tier: '', kols: '' });
export const emptySet = (over = {}) => ({ content_type: '', media_type: '', content_format: '', tiers: [emptyTier()], ...over });
export const emptyBlock = platform => ({ platform, target: [], budget: '', products: [], clips: [], sets: [emptySet()] });

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
                budget: b.budget != null ? b.budget : '',
                products: [...(b.products || [])],
                clips: [...(b.clips || [])],
                sets: (b.sets && b.sets.length ? b.sets : [emptySet()]).map(s => ({
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

// Target ของ Platform นั้น (ของเก่าเก็บไว้ระดับกลุ่ม)
export function targetFor(g, platform) {
    if (Array.isArray(g.blocks) && g.blocks.length) {
        const b = g.blocks.find(x => x.platform === platform);
        if (b) return asArr(b.target);
    }
    return needTarget(platform) ? asArr(g.target) : [];
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
