/**
 * ตรรกะบริสุทธิ์ (pure logic) ที่ใช้ร่วมกันระหว่าง jsonStore และ pgStore
 *
 * ฟังก์ชันในไฟล์นี้ไม่แตะที่เก็บข้อมูลเลย — รับ object เข้ามาแล้วคำนวณอย่างเดียว
 * แยกออกมาไว้ที่เดียวเพื่อให้สองไดรเวอร์ใช้ตรรกะชุดเดียวกันเป๊ะ
 * ถ้าปล่อยให้ต่างคนต่างถือสำเนา วันหนึ่งจะคำนวณไม่ตรงกันโดยไม่มีใครรู้
 */

// เกณฑ์ตัดสินว่า KOL คนนี้ "คุ้มค่า" ไหม — ใช้ที่หน้า Report และ Influencer
const GOOD_CPM = 28;
const GOOD_CPE = 1.5;

// Platform ที่มีเป้าหมาย (target) ระดับกลุ่ม
const TARGET_PLATFORMS = ['TikTok'];

// ค่าแอดขั้นต่ำที่ถือว่า "ยิงจริงจังแล้ว" — ถึงเกณฑ์นี้ระบบจึงล็อกผลตัดสินคุ้ม/ไม่คุ้ม
// (ต่ำกว่านี้ตัวเลขยังแกว่ง ตัดสินไปก็ไม่มีความหมาย)
const AD_STAMP_AT = 10000;

const now = () => new Date().toISOString();
const clone = (v) => (v === undefined ? undefined : structuredClone(v));


// จำลอง error รหัส '23505' (unique violation) ให้ route จัดการเหมือน PostgreSQL
function duplicateError(msg) {
    const e = new Error(msg || 'duplicate key value violates unique constraint');
    e.code = '23505';
    return e;
}

// ===== ตัวกรองสิทธิ์กลาง =====
// scope = null/undefined  -> เห็นทุกแบรนด์ (admin / manager)
// scope = []              -> ยังไม่ได้รับแบรนด์ = ไม่เห็นอะไรเลย
// scope = [ชื่อแบรนด์...]  -> เห็นเฉพาะแคมเปญของแบรนด์นั้น
// เขียนไว้ที่เดียวเพราะเดิมเงื่อนไขนี้ถูกก็อปไว้ 17 จุด พลาดจุดเดียว = ข้อมูลข้ามแบรนด์หลุด
function inScope(project, scope) {
    if (!Array.isArray(scope)) return true;
    return scope.includes(project && project.brand);
}

function scopeProjects(list, scope) {
    if (!Array.isArray(scope)) return list;
    return list.filter(p => scope.includes(p.brand));
}

// Platform ของกลุ่ม — รองรับทั้ง platforms[] แบบใหม่ และ platform เดี่ยว/ที่ติดอยู่กับ allocation แบบเดิม
function linkGroupPlatforms(g) {
    const set = new Set();
    (g.platforms || []).forEach(p => { if (p) set.add(p); });
    if (g.platform) set.add(g.platform);
    (g.allocations || []).forEach(a => { if (a.platform) set.add(a.platform); });
    return [...set];
}

// Content Type/Photo-VDO/Format ของกลุ่ม — โครงใหม่เก็บแยกต่อ Platform ใน allocations
// Content ที่ 1 คนต้องทำ — ตั้งแยกต่อ Platform ได้ (TikTok 2 คลิป / Facebook 1 ก็ได้)
// ห้ามใช้ grp.clips ตรง ๆ เพราะนั่นคือค่าของ Platform แรกเท่านั้น
function resolveGroupClips(g, platform) {
    if (!g) return [];
    const b = (g.blocks || []).find(x => x.platform === platform);
    const list = (b && (b.clips || []).length) ? b.clips : (g.clips || []);
    return list.map(c => String(c || '').trim()).filter(Boolean);
}

// Target ตั้งแยกต่อ Platform และมีเฉพาะ Platform ที่ใช้ยิงแอด
// กลุ่มที่ลง TikTok + Facebook จะมี Target แค่ฝั่ง TikTok เท่านั้น
function resolveGroupTarget(g, platform) {
    if (!g) return null;
    const b = (g.blocks || []).find(x => x.platform === platform);
    if (b) { const t = b.target; return (Array.isArray(t) ? t.length : !!t) ? t : null; }
    return TARGET_PLATFORMS.includes(platform) ? (g.target || null) : null;
}

// สินค้าของ Platform นั้นในกลุ่ม — ไม่มีค่อยถอยไปใช้ของทั้งกลุ่ม
function resolveGroupProducts(g, platform) {
    if (!g) return [];
    const b = (g.blocks || []).find(x => x.platform === platform);
    return (b && (b.products || []).length) ? b.products : (g.products || []);
}

function resolveGroupCtype(g, platform) {
    if (!g) return null;
    const hit = (g.allocations || []).find(a => a.content_type && (!platform || !a.platform || a.platform === platform));
    return hit ? hit.content_type : (g.content_type || null);
}

function resolveGroupMedia(g, platform, contentType) {
    if (!g) return { media_type: null, content_format: null };
    const rows = (g.allocations || []).filter(a =>
        (!platform || !a.platform || a.platform === platform)
        && (!contentType || !a.content_type || a.content_type === contentType));
    const hit = rows.find(a => a.media_type || a.content_format);
    return {
        media_type: hit ? (hit.media_type || null) : (g.media_type || null),
        content_format: hit ? (hit.content_format || null) : (g.content_format || null)
    };
}

function engagementOf(s) {
    return (Number(s.likes) || 0) + (Number(s.comments) || 0) + (Number(s.saves) || 0)
        + (Number(s.shares) || 0) + (Number(s.reposts) || 0);
}

// คืนค่า stamp ถ้าเพิ่งสแตมป์รอบนี้ / null ถ้ายังไม่ถึงเงื่อนไข
function maybeStamp(s) {
    if (!s || s.perf_stamp) return null;                       // สแตมป์แล้วห้ามแตะซ้ำ
    const spend = Number(s.ad_spend) || 0;
    if (spend < AD_STAMP_AT) return null;
    const views = Number(s.views) || 0;
    // ถึงเกณฑ์แล้วแต่ยังไม่มีผลงาน -> รอไว้ก่อน ไม่งั้นจะล็อกค่าว่างค้างถาวร
    if (views <= 0) return null;
    const engagement = engagementOf(s);
    const totalCost = (Number(s.budget) || 0) + spend;
    const cpm = Number((totalCost / (views / 1000)).toFixed(2));
    const cpe = engagement > 0 ? Number((totalCost / engagement).toFixed(2)) : 0;
    s.perf_stamp = {
        at: now(),
        ad_spend: spend,
        views, engagement,
        er: Number(((engagement / views) * 100).toFixed(2)),
        total_cost: totalCost,
        cpm, cpe,
        verdict: (cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Pass' : 'Fail'
    };
    return s.perf_stamp;
}


module.exports = {
    GOOD_CPM, GOOD_CPE, TARGET_PLATFORMS, AD_STAMP_AT, now, clone,
    duplicateError, inScope, scopeProjects,
    linkGroupPlatforms, resolveGroupClips, resolveGroupTarget,
    resolveGroupProducts, resolveGroupCtype, resolveGroupMedia,
    engagementOf, maybeStamp
};
