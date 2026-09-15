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

// Campaign (VDO View / Reach / Consideration Ads) ของ (Platform + Content Type) — ตั้งไว้ที่ชุด Content Type ในฟอร์มแคมเปญ
// ต้องตรง Content Type จริง — ชุดที่ยังไม่เลือก Content Type ห้ามแจก Campaign ให้ KOL ทุก Content Type ใน Platform นั้น
// (ต่างจาก resolveGroupMedia ที่ถือว่าแถวไม่มี Content Type ใช้ได้กับทุกอัน) · KOL ที่ไม่มี Content Type เลยถึงจะหยิบชุดแรกที่มี Campaign
// กลุ่มที่บันทึกก่อนมีช่องนี้ = null
function resolveGroupCampaign(g, platform, contentType) {
    if (!g) return null;
    const hit = (g.allocations || []).find(a => a.campaign
        && (!platform || !a.platform || a.platform === platform)
        && (!contentType || a.content_type === contentType));
    return hit ? hit.campaign : null;
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
    // ยังไม่ได้ใส่ค่าตัว -> รอไว้ก่อน ไม่งั้นต้นทุนรวมเหลือแค่ค่าแอด CPM/CPE ต่ำเกินจริงแล้วล็อกค้างถาวร
    // (ใส่ค่าตัวเมื่อไหร่ submissions.updateOne เรียกฟังก์ชันนี้ซ้ำ แล้วสแตมป์ตอนนั้นเอง)
    if ((Number(s.budget) || 0) <= 0) return null;
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

// ค่าแอดถึงเกณฑ์แล้วแต่ยังสแตมป์ไม่ได้เพราะรออะไรอยู่ — ให้หน้าเว็บบอกได้ว่าต้องไปกรอกช่องไหน
// 'views' = ยังไม่มียอดวิว · 'fee' = ยังไม่ได้ใส่ค่าตัว
// null = ไม่ได้รออะไร (สแตมป์แล้ว / ค่าแอดยังไม่ถึงเกณฑ์ / ครบแล้วรอสแตมป์รอบถัดไป)
// ลำดับการเช็คต้องตรงกับ maybeStamp: ยอดวิวก่อน แล้วค่อยค่าตัว
function stampWaitReason(s) {
    if (!s || s.perf_stamp) return null;
    if ((Number(s.ad_spend) || 0) < AD_STAMP_AT) return null;
    if ((Number(s.views) || 0) <= 0) return 'views';
    if ((Number(s.budget) || 0) <= 0) return 'fee';
    return null;
}

// ===== คลิปที่ยังไม่ใส่ค่าตัว — กฎชุดเดียวกันทั้งหน้า Dashboard และหน้า Report =====
// ค่าตัว (submissions.budget) เก็บต่อคลิป · 0 / ว่าง = ทีมยังไม่ได้ใส่ (เงื่อนไขเดียวกับ maybeStamp)
// ยอดรวมค่าจ้างยังบวกตามเดิม (0 ไม่ได้เพิ่มอะไร) แต่ CPM/CPE ของคลิปพวกนี้เหลือแค่ค่าแอด หรือเป็น 0
// ซึ่งดูถูกเกินจริง จึงตัดออกจากค่าเฉลี่ย CPM/CPE, แกนคะแนน CPM/CPE และการตัดสิน Good/Improve
function feeMissing(budget) {
    return (Number(budget) || 0) <= 0;
}

// CPM/CPE ของ 1 คลิป — ต้นทุน = ค่าตัว + ค่ายิงแอด
// ยังไม่ใส่ค่าตัว = cpm/cpe เป็น null (ห้ามคืน 0 หรือคิดจากค่าแอดอย่างเดียว เพราะจะดูคุ้มเกินจริง)
function clipCostMetrics({ fee, adSpend, views, engagement }) {
    const f = Number(fee) || 0;
    const cost = f + (Number(adSpend) || 0);
    if (feeMissing(f)) return { fee_missing: true, cost, cpm: null, cpe: null };
    return {
        fee_missing: false, cost,
        cpm: views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0,
        cpe: engagement > 0 ? Number((cost / engagement).toFixed(2)) : 0
    };
}

// has(row) = แถวนี้มีค่าแกนนี้ให้เทียบไหม — แต่ละหน้าคงกติกาเดิมของตัวเองไว้สำหรับคนที่มีค่าตัว
// ค่าเริ่มต้น = ค่ามากกว่า 0 (กติกาเดิมของหน้า Report)
// หน้า Dashboard ส่งกติกาเดิมของตัวเองมา เพื่อให้ค่าที่ถูกมากจนปัดเศษเหลือ 0.00 ยังได้คะแนนเต็ม ไม่กลายเป็นแย่สุด
const hasPositive = key => r => Number(r[key]) > 0;

// ช่วง min/max ของแกน CPM หรือ CPE ที่ใช้เทียบคะแนน (key = 'cpm' | 'cpe')
// นับเฉพาะแถวที่มีค่าตัวและมีค่านั้น (has) — แถวที่ยังไม่ใส่ค่าตัวห้ามเข้ามายืดช่วง
function costAxisRange(rows, key, has = hasPositive(key)) {
    const v = rows.filter(r => !r.fee_missing && r[key] != null && has(r)).map(r => Number(r[key]));
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: 0, max: 0 };
}

// คะแนนแกน CPM/CPE ของ 1 แถว เป็นสัดส่วน 0-1 (ยิ่งต่ำยิ่งได้มาก)
// ยังไม่ใส่ค่าตัว หรือยังไม่มีค่านี้ = 0 (แย่สุดของแกน ไม่ใช่ดีสุด) · ทุกคนเท่ากัน = 1
// has ต้องเป็นตัวเดียวกับที่ส่งให้ costAxisRange ตอนสร้าง range
function costAxisNorm(row, key, range, has = hasPositive(key)) {
    if (row.fee_missing || row[key] == null || !has(row)) return 0;
    if (range.max === range.min) return 1;
    return 1 - (Number(row[key]) - range.min) / (range.max - range.min);
}

// ผ่าน/ไม่ผ่านเกณฑ์คุ้มค่า — ยังไม่ใส่ค่าตัว = null (ยังตัดสินไม่ได้ ไม่นับเป็นทั้ง Good และ Improve)
function perfVerdict({ fee_missing, views, cpm, cpe }) {
    if (fee_missing) return null;
    return (views > 0 && cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Good' : 'Improve';
}

// ค่าเฉลี่ย CPM/CPE ต่อคลิปของหน้า Report — เฉพาะคลิปที่มีค่าตัวและมี reach จากแอดแล้ว
// fee_clips = จำนวนคลิปที่เอามาเฉลี่ยจริง · fee_missing_clips = คลิปที่ยังไม่ใส่ค่าตัว (นับทุกแถวที่รวมอยู่ในยอดค่าจ้าง)
function feeCostAverages(rows) {
    const used = rows.filter(r => !r.fee_missing && r.reach > 0);
    const avg = key => (used.length ? Number((used.reduce((a, r) => a + r[key], 0) / used.length).toFixed(2)) : 0);
    return {
        avg_cpm: avg('cpm'), avg_cpe: avg('cpe'),
        fee_clips: used.length,
        fee_missing_clips: rows.filter(r => r.fee_missing).length
    };
}


module.exports = {
    GOOD_CPM, GOOD_CPE, TARGET_PLATFORMS, AD_STAMP_AT, now, clone,
    duplicateError, inScope, scopeProjects,
    linkGroupPlatforms, resolveGroupClips, resolveGroupTarget,
    resolveGroupProducts, resolveGroupCtype, resolveGroupMedia, resolveGroupCampaign,
    engagementOf, maybeStamp, stampWaitReason,
    feeMissing, clipCostMetrics, costAxisRange, costAxisNorm, perfVerdict, feeCostAverages
};
