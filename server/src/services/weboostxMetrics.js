// Paid engagement must never become organic metrics.
function platformOf(value) {
    const p = String(value || '').trim().toLowerCase();
    return ['facebook', 'instagram'].includes(p) ? p : null;
}
function itemIdFor(row) {
    const platform = platformOf(row.platform);
    if (!platform) return null;
    const link = String(row.post_url || '').trim();
    try {
        const url = new URL(link);
        const host = url.hostname.toLowerCase();
        const valid = platform === 'instagram'
            ? /^(www\.)?instagram\.com$/.test(host)
                && /^\/(?:[A-Za-z0-9_.]+\/)?(?:p|reels?|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
            : /^(www\.|m\.|web\.)?facebook\.com$/.test(host)
                && (/\/(posts|videos|permalink)\//.test(url.pathname) || url.searchParams.has('story_fbid'));
        if (valid && url.protocol === 'https:' && link.length <= 500) return link;
    } catch { /* Prefer a supported ID/code when no post URL is available. */ }
    const id = String(row.id_post || '').trim();
    if (/^\d{1,50}(?:_\d{1,50})?$/.test(id)) return id;
    const code = String(row.gencode || '').trim();
    return code && code.length <= 500 ? code : null;
}
function metricNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function sanitizeRow(row) {
    if (!row || typeof row.item_id !== 'string' || !platformOf(row.platform)) return null;
    const id = String(row.id_post || '');
    if (!/^\d{1,50}(?:_\d{1,50})?$/.test(id)) return null;
    const clean = { item_id: row.item_id, platform: platformOf(row.platform), id_post: id };
    for (const field of ['ad_spend', 'ad_reach']) {
        const value = metricNumber(row[field]);
        if (value !== undefined) clean[field] = value;
    }
    // WeBoostX fired means actual spend, unlike Beauterry's attached-ad flag.
    if (row.ad_launched === true && clean.ad_spend > 0) clean.ad_launched = true;
    const day = String(row.first_ad_date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))
        && new Date(day).toISOString().slice(0, 10) === day) clean.first_ad_date = day;
    Object.assign(clean, studioFields(row));
    return clean;
}

// ===== KOL PFM + รูปปกโพสต์ จาก KOL Studio ของ WeBoostX (สัญญา 19 ต.ค. 2026: docs/KOL_DASHBOARD_API.md ของ WeBoostX2) =====
// pfm = engagement จากแอดต่อ 1,000 impressions จัดอันดับเทียบโพสต์ KOL แบรนด์ + แพลตฟอร์มเดียวกัน (0-10) — ไม่ใช่คะแนนต้นทุน
// pfm_grade = เกรดที่ WeBoostX คิดจากคะแนนก่อนปัดเศษ ใช้ตามที่ส่งมา ห้ามคิดเองจาก pfm (7.996 → pfm 8.0 แต่เกรด A)
// thumbnail_url = PATH บนเครื่อง WeBoostX (ต้องดาวน์โหลดด้วย key ฝั่ง server เท่านั้น — services/weboostxThumbs.js)
// กติกา: ส่งมา null = เก็บ null · ค่าผิดรูป = ทิ้งเฉพาะช่องนั้น (ไม่ทำให้ทั้งแถว/ทั้งรอบล้ม ค่าแอดต้องซิงก์ต่อได้)
// ไม่ส่งช่องนี้มาเลย (WeBoostX รุ่นก่อน) = ไม่ใส่คีย์ = ไม่แตะค่าเดิม
const PFM_GRADES = ['S', 'A', 'B', 'C', 'D'];
const THUMB_PATH_RE = /^\/api\/v1\/integrations\/kol-pfm\/thumbnail\/\d{1,20}$/;
const thumbPathOf = v => (typeof v === 'string' && THUMB_PATH_RE.test(v) ? v : undefined);
function studioFields(row) {
    const out = {};
    if (Object.prototype.hasOwnProperty.call(row, 'pfm')) {
        const v = row.pfm;
        if (v === null) out.pfm = null;
        else if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10) out.pfm = Math.round(v * 100) / 100;
    }
    if (Object.prototype.hasOwnProperty.call(row, 'pfm_grade')) {
        const v = row.pfm_grade;
        if (v === null) out.pfm_grade = null;
        else if (typeof v === 'string' && PFM_GRADES.includes(v.trim().toUpperCase())) out.pfm_grade = v.trim().toUpperCase();
    }
    if (Object.prototype.hasOwnProperty.call(row, 'thumbnail_url')) {
        if (row.thumbnail_url === null) out.thumbnail_url = null;
        else if (thumbPathOf(row.thumbnail_url)) out.thumbnail_url = row.thumbnail_url;
    }
    return out;
}
// ค่าในฐาน (NUMERIC มาเป็นสตริง '7.70') → ตัวเลขเทียบกันได้
const pfmOf = v => (v === null || v === undefined || v === '' ? null : Number(v));
function patchFor(current, row) {
    const patch = {};
    if (row.ad_spend !== undefined && row.ad_spend > Number(current.ad_spend || 0)) patch.ad_spend = row.ad_spend;
    // Null is unknown, not zero. Never erase measured lifetime unique reach.
    if (row.ad_reach !== undefined && row.ad_reach > Number(current.ad_reach || 0)) patch.ad_reach = row.ad_reach;
    if (!String(current.id_post || '').trim()) patch.id_post = row.id_post;
    if (!current.ad_end && row.first_ad_date) patch.ad_end = row.first_ad_date;
    if (row.ad_launched === true && current.ad_status !== 'ยิงแล้ว') patch.ad_status = 'ยิงแล้ว';
    // KOL PFM / เกรด / path รูป — คะแนนคิดใหม่ทุกชั่วโมง ขึ้นลงได้ จึงเขียนทับเมื่อค่าเปลี่ยน (ไม่ใช่แบบค่าแอดที่รับเฉพาะค่าที่สูงขึ้น)
    // path รูปเปลี่ยน: ไม่ล้างสำเนาเดิม (thumbnail_local) — รูปเก่ายังโชว์ได้จนตัวดาวน์โหลดได้รูปใหม่
    if (row.pfm !== undefined && pfmOf(current.weboostx_pfm) !== row.pfm) patch.weboostx_pfm = row.pfm;
    if (row.pfm_grade !== undefined && (current.weboostx_pfm_grade ?? null) !== row.pfm_grade) patch.weboostx_pfm_grade = row.pfm_grade;
    if (row.thumbnail_url !== undefined && (current.weboostx_thumbnail_path ?? null) !== row.thumbnail_url) {
        patch.weboostx_thumbnail_path = row.thumbnail_url;
    }
    return patch;
}
// คอลัมน์ใหม่ที่ patchFor อาจเขียน — ฐานที่ยังไม่ได้รัน setup-db ไม่มีคอลัมน์พวกนี้ (store/pg/weboostxSync.js ตัดทิ้งก่อนเขียน)
const STUDIO_COLUMNS = ['weboostx_pfm', 'weboostx_pfm_grade', 'weboostx_thumbnail_path'];
module.exports = { platformOf, itemIdFor, sanitizeRow, patchFor, studioFields, thumbPathOf, THUMB_PATH_RE, PFM_GRADES, STUDIO_COLUMNS };
