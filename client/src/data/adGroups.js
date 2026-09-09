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
export const emptyBlock = platform => ({ platform, target: [], sets: [emptySet()] });

export const setKol = s => (s.tiers || []).reduce((n, t) => n + (Number(t.kols) || 0), 0);
export const blockKol = b => (b.sets || []).reduce((n, s) => n + setKol(s), 0);
export const blocksKol = blocks => (blocks || []).reduce((n, b) => n + blockKol(b), 0);

const asArr = v => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

// อ่านข้อมูลกลุ่ม (เก่าหรือใหม่) ออกมาเป็นโครง 3 ชั้นตาม Platform ที่ระบุ
// ของเก่าเก็บ Tier ชุดเดียวโดยไม่แยก Platform -> ใส่ลงบล็อกแรกเท่านั้น
// ไม่งั้นจำนวน KOL จะถูกนับซ้ำตามจำนวน Platform
export function toBlocks(g, platformCsv) {
    const plats = splitCsv(platformCsv != null ? platformCsv : groupPlatforms(g));
    if (Array.isArray(g.blocks) && g.blocks.length) {
        return plats.map(p => {
            const b = g.blocks.find(x => x.platform === p);
            if (!b) return emptyBlock(p);
            return {
                platform: p,
                target: asArr(b.target),
                sets: (b.sets && b.sets.length ? b.sets : [emptySet()]).map(s => ({
                    content_type: s.content_type || '',
                    media_type: s.media_type || '',
                    content_format: s.content_format || '',
                    tiers: (s.tiers && s.tiers.length ? s.tiers : [emptyTier()])
                        .map(t => ({ tier: t.tier || '', kols: t.kols ?? '' }))
                }))
            };
        });
    }
    const oldTiers = (g.allocations || []).length
        ? g.allocations.map(a => ({ tier: a.tier || '', kols: a.kols ?? '' }))
        : [emptyTier()];
    return plats.map((p, idx) => ({
        platform: p,
        target: needTarget(p) ? asArr(g.target) : [],
        sets: [emptySet({
            content_type: g.content_type || '',
            media_type: g.media_type || '',
            content_format: g.content_format || '',
            tiers: idx === 0 ? oldTiers : [emptyTier()]
        })]
    }));
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
