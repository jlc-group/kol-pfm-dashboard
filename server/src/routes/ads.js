const express = require('express');
const path = require('node:path');
const store = require('../store');
const { UPLOAD_DIR } = require('../config/uploads');
const { thumbPath, createThumbCache } = require('../services/adThumbs');
const wxThumbs = require('../services/weboostxThumbs');
const { authenticate } = require('../middleware/auth');
const { allowedBrands, canSeeBrand, canSeeCostMetrics } = require('../data/roles');
const { cleanFee, pfmManagedSpend, postCheckWaiting, adStatusAuto } = require('../store/logic');
const { getOrganicMetricStatus } = require('../services/beauterryPfmSync');
const wxSync = require('../services/weboostxPfmSync');
const wxPosts = require('../services/weboostxPosts');
const wxStore = require('../store/pg/weboostxSync');
const { platformOf: wxPlatformOf } = require('../services/weboostxMetrics');

// ค่ายิงแอดเป็นข้อมูลลับ — คนที่ไม่ใช่ admin/manager ไม่ได้รับตัวเลขไปเลย
// (CPM ถอดกลับเป็นค่าแอดได้ จึงต้องปิดด้วย) แต่ยังเห็นผล Pass/Fail ตามปกติ
function maskCost(data, user) {
    if (canSeeCostMetrics(user)) return data;
    (data.rows || []).forEach(r => {
        r.ad_spend = null; r.cpm = null; r.content_cpm = null; r.content_cpe = null;
        if (r.perf_stamp) r.perf_stamp = { ...r.perf_stamp, ad_spend: null, cpm: null, cpe: null, total_cost: null };
    });
    if (data.summary) {
        const s = data.summary;
        s.total_spend = null; s.cpm = null; s.cpe = null;
        (s.by_brand || []).forEach(b => { b.spend = null; b.cpm = null; });
        (s.by_month || []).forEach(m => { m.spend = null; m.cpm = null; });
    }
    return data;
}

const router = express.Router();
router.use(authenticate);

router.get('/tiktok-evidence-status', (req, res) => {
    const status = require('../services/tiktokEvidenceSync').getStatus();
    res.json({ status: 'success', data: { configured: status.configured, reason: status.reason } });
});

// รูปปกคลิป TikTok (คอลัมน์ IMAGE) — ดึงครั้งแรกแล้วเก็บไว้ในเครื่อง ครั้งต่อไปเสิร์ฟจากไฟล์เลย
const thumbs = createThumbCache({ dir: path.join(UPLOAD_DIR, 'ads-thumbs') });
// รูปปกโพสต์ IG / FB — server ดาวน์โหลดจาก WeBoostX มาเก็บไว้แล้ว (services/weboostxThumbs.js) เส้นนี้แค่ส่งสำเนาของเรา
const WX_THUMB_DIR = wxThumbs.thumbDir(UPLOAD_DIR);

const AD_STATUSES = ['ยังไม่ยิง', 'ยิงแล้ว'];

// GET /api/ads — รายการโพสต์ที่ยิงแอด + สรุปภาพรวม (ตามสิทธิ์ทีม + ตัวกรอง)
router.get('/', async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { brand, status, from, to } = req.query;
        const data = await store.ads.list({
            scopeBrands,
            brand: brand || undefined,
            status: status || undefined,
            from: from || undefined,
            to: to || undefined
        });
        // path รูปปกของแต่ละแถว (null = ไม่ใช่โพสต์ TikTok หน้าเว็บขึ้นไอคอนแทน)
        (data.rows || []).forEach(r => {
            // TikTok: ดึงปกตอนขอรูป · IG / FB: สำเนาที่ดาวน์โหลดจาก WeBoostX ไว้แล้ว (ชื่อไฟล์ใช้แค่ทำ ?v= ไม่ส่งออกไป)
            r.thumb = thumbPath(r) || wxThumbs.thumbPathFor(r);
            delete r.thumbnail_local;
            if (r.status_auto === true) {
                r.organic_metrics_status = r.perf_sources?.api?.status || getOrganicMetricStatus(r.id_post);
                if (r.views_reason === 'pfm_no_views' && r.organic_metrics_status === 'source_unavailable') r.views_reason = 'pfm_source_unavailable';
            }
        });
        res.json({ status: 'success', data: maskCost(data, req.account || req.user) });
    } catch (err) { next(err); }
});

// GET /api/ads/:subId/thumb — รูปปกของโพสต์ (TikTok ดึงเอง · IG / FB สำเนาจาก WeBoostX) · สิทธิ์ตามแบรนด์เหมือนตอนแก้แถว
router.get('/:subId/thumb', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');   // ตอบ error ห้ามค้างในเบราว์เซอร์ (ดึงได้ทีหลังต้องเห็นรูป)
        res.set('X-Content-Type-Options', 'nosniff');
        const ctx = await store.ads.subContext(req.params.subId);
        if (!ctx) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });
        if (!canSeeBrand(req.account || req.user, ctx.brand)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์ดูข้อมูลของแบรนด์อื่น' });
        }
        // IG / FB: เสิร์ฟสำเนาที่ดาวน์โหลดไว้แล้วเท่านั้น — ไม่เรียก WeBoostX ระหว่างตอบเบราว์เซอร์
        const local = wxThumbs.localFile(ctx.submission.thumbnail_local, WX_THUMB_DIR);
        if (local) {
            // ไฟล์ของ path เดิมไม่เปลี่ยน (path เปลี่ยน = ชื่อไฟล์ใหม่ = ?v= ใหม่) — เก็บในเบราว์เซอร์ได้ 7 วัน
            return res.sendFile(local, { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=604800' } });
        }
        const fp = await thumbs.get(ctx.submission.post_url);
        if (!fp) return res.status(404).json({ status: 'error', message: 'ยังไม่มีรูปปกของโพสต์นี้' });
        // รูปของคลิปเดิมไม่เปลี่ยน (เปลี่ยนลิงก์โพสต์ = ?v= ใหม่) — ให้เบราว์เซอร์เก็บไว้ 7 วัน เฉพาะเครื่องคนนั้น
        // ใส่ผ่าน headers ของ sendFile = ตั้งเฉพาะตอนส่งไฟล์สำเร็จ (ส่งไม่ได้ยังเป็น no-store ข้างบน)
        res.sendFile(fp, { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=604800' } });
    } catch (err) { next(err); }
});

// ===== หาโพสต์ IG / FB จาก WeBoostX ให้แถวที่ยังไม่มี ID POST (26 ต.ค. 2026 · services/weboostxPosts.js) =====
// Gencode อย่างเดียวจับคู่ไม่ได้ (โพสต์ที่ทีมยิงใน Ads Manager ไม่มีโค้ดในระบบ WeBoostX) และบางโพสต์ WeBoostX จับด้วยลิงก์ไม่ได้
// → ดึงรายการโพสต์ที่แอดของเราโปรโมต มาเรียงตามชื่อ KOL / วันลงโพสต์ / สินค้า ให้คนเปิดดูแล้วกดยืนยัน (ห้ามจับคู่เอง — สัญญาข้อ 2)
// หน้า Ads ปิดเอเจนซี่ทั้งเส้น (app.js blockAgency) · สิทธิ์ตามแบรนด์ · ค่าแอดของตัวเลือกเห็นเฉพาะคนที่เห็นต้นทุน
const wxPostsCache = wxPosts.createPostsCache();
// แถวที่หาโพสต์ได้: IG / FB · ยังไม่มี ID POST · ไม่ได้รอทีมตรวจ — คืน { status, message } ถ้าหาไม่ได้
function wxFindBlock(ctx, viewer) {
    if (!ctx) return { status: 404, message: 'ไม่พบโพสต์' };
    if (!canSeeBrand(viewer, ctx.brand)) return { status: 403, message: 'ไม่มีสิทธิ์ดูข้อมูลของแบรนด์อื่น' };
    if (!wxPlatformOf(ctx.submission.platform)) return { status: 400, message: 'หาโพสต์จาก WeBoostX ได้เฉพาะ Instagram / Facebook' };
    if (String(ctx.submission.id_post || '').trim()) return { status: 409, message: 'แถวนี้มี ID POST แล้ว — โหลดหน้าใหม่แล้วดูอีกครั้ง' };
    if (postCheckWaiting(ctx.submission)) return { status: 409, message: 'เอเจนซี่เพิ่งแก้ข้อมูลโพสต์นี้ รอทีมตรวจก่อน' };
    if (!wxSync.config().apiKey) return { status: 503, message: 'server ยังไม่ได้ตั้งค่าการเชื่อม WeBoostX' };
    return null;
}
// รายการโพสต์ของ Platform นี้จาก WeBoostX (เก็บไว้ 10 นาที) — กรองแบรนด์ทีหลังตอนเรียง / ตอนยืนยัน
function wxPostsFor(s) {
    const platform = wxPlatformOf(s.platform);
    const since = wxPosts.sinceFor(s.post_date);
    return wxPostsCache.get(`${platform}|${since}`, () => wxPosts.fetchPosts({ platform, since }));
}

// GET /api/ads/:subId/wx-posts?q= — ตัวเลือกโพสต์ (ไม่ค้น = ที่ชื่อ/วันที่/สินค้าใกล้เคียง · q = ค้นชื่อในแอด / ID)
router.get('/:subId/wx-posts', async (req, res, next) => {
    try {
        const viewer = req.account || req.user;
        const ctx = await store.ads.subContext(req.params.subId);
        const block = wxFindBlock(ctx, viewer);
        if (block) return res.status(block.status).json({ status: 'error', message: block.message });
        const s = ctx.submission;
        let posts;
        try { posts = await wxPostsFor(s); } catch (e) {
            console.error(`WeBoostX posts failed: ${e.message}`);
            return res.status(502).json({ status: 'error', message: 'ดึงรายการโพสต์จาก WeBoostX ไม่ได้ตอนนี้ — ลองใหม่อีกครั้ง' });
        }
        const since = wxPosts.sinceFor(s.post_date);
        const q = String(req.query.q || '').trim().slice(0, 100);
        const clip = { platform: s.platform, brand: ctx.brand, account_name: s.account_name, link_account: s.link_account, post_date: s.post_date, product: s.product };
        const ranked = wxPosts.rankPosts(clip, posts, { q });
        // โพสต์ที่ผูกกับคลิปอื่นแล้ว (ชื่อคลิปของแบรนด์ที่ไม่มีสิทธิ์ = ไม่บอกชื่อ)
        const users = await wxStore.idPostUsers(ranked.flatMap(p => [p.id_post, p.fb_story_id]).filter(Boolean));
        const showCost = canSeeCostMetrics(viewer);
        const candidates = ranked.map(p => ({
            id_post: p.id_post, fb_story_id: p.fb_story_id, permalink: p.permalink,
            creator: p.creator, post_date: p.post_date, sku_codes: p.sku_codes, brand: p.brand,
            first_ad_date: p.first_ad_date, last_ad_date: p.last_ad_date, ads_count: p.ads_count, ad_reach: p.ad_reach,
            ad_spend: showCost ? p.ad_spend : null,
            score: p.score, level: p.level, reasons: p.reasons,
            used_by: users.filter(u => u.id !== s.id && (u.id_post === p.id_post || u.id_post === p.fb_story_id))
                .map(u => ({ sub_id: u.id, account_name: canSeeBrand(viewer, u.brand) ? u.account_name : null }))
        }));
        res.json({ status: 'success', data: { total: posts.filter(p => wxPosts.brandMatches(ctx.brand, p)).length, since, query: q, candidates } });
    } catch (err) { next(err); }
});

// POST /api/ads/:subId/wx-confirm { id_post, fb_story_id? } — คนเลือกโพสต์แล้วยืนยัน
// ถาม WeBoostX ซ้ำว่า ID นี้เป็นโพสต์ที่แอดเราโปรโมตจริง (ไม่เชื่อค่าจากเบราว์เซอร์) → เก็บ ID POST (เฉพาะตอนยังว่าง) → ลงค่าแอดให้ทันที
router.post('/:subId/wx-confirm', async (req, res, next) => {
    try {
        const viewer = req.account || req.user;
        const ctx = await store.ads.subContext(req.params.subId);
        const block = wxFindBlock(ctx, viewer);
        if (block) return res.status(block.status).json({ status: 'error', message: block.message });
        const platform = wxPlatformOf(ctx.submission.platform);
        const id = String(req.body.id_post ?? '').trim();
        const story = String(req.body.fb_story_id ?? '').trim();
        if (!/^\d{1,50}$/.test(id) || (story && (platform !== 'facebook' || !/^\d{1,50}_\d{1,50}$/.test(story) || story.split('_')[1] !== id))) {
            return res.status(400).json({ status: 'error', message: 'ID POST ไม่ถูกต้อง' });
        }
        // FB เก็บแบบ <page>_<post> (แม่นที่สุดตามสัญญา) · IG เก็บ media id
        const value = story || id;
        let found;
        try {
            // ต้องเป็นโพสต์ในรายการของแบรนด์เดียวกับคลิป (ที่หน้าต่างให้เลือก) — กันยิงตรงเอา ID ของแบรนด์อื่น / ที่ไม่ได้อยู่ในรายการมาเก็บ
            const listed = (await wxPostsFor(ctx.submission)).find(p => p.id_post === id && wxPosts.brandMatches(ctx.brand, p)
                && (!story || p.fb_story_id === story));
            if (!listed) return res.status(409).json({ status: 'error', message: `โพสต์นี้ไม่อยู่ในรายการโพสต์ของ ${ctx.brand || 'แบรนด์นี้'} — เลือกใหม่อีกครั้ง` });
            const rows = await wxSync.fetchBatch([value]);
            found = rows.find(r => r.item_id === value && r.platform === platform && r.id_post === id);
        } catch (e) {
            console.error(`WeBoostX confirm check failed: ${e.message}`);
            return res.status(502).json({ status: 'error', message: 'ตรวจกับ WeBoostX ไม่ได้ตอนนี้ — ลองใหม่อีกครั้ง' });
        }
        if (!found) return res.status(409).json({ status: 'error', message: 'WeBoostX ไม่พบโพสต์นี้ (หรือเป็นคนละ Platform) — เลือกใหม่อีกครั้ง' });
        const user = await store.users.findById(req.user.id);
        const byName = user ? (user.full_name || user.username) : null;
        const saved = await store.submissions.update(ctx.submission.id, null, { id_post: value }, byName, { fillEmpty: ['id_post'] });
        if (!saved) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });
        // ลงค่าแอด / Reach / วันยิงแอดของโพสต์นี้ทันที (ล้มก็ไม่เป็นไร — รอบซิงก์ทุกชั่วโมงเติมให้)
        let synced = false;
        try {
            const r = await wxStore.apply([{ ...found, submission_id: ctx.submission.id }]);
            synced = (r.updated || 0) > 0;
        } catch (e) { console.error(`WeBoostX confirm apply failed: ${e.message}`); }
        try {
            await store.activity.log({
                user_id: req.user.id, team_id: ctx.team_id ?? req.user.team_id, action: 'ad',
                project_id: ctx.project_id, project_name: ctx.project_name,
                summary: `เก็บ ID POST จากรายการโพสต์ WeBoostX: ${ctx.account_name} · ${value}`
            });
        } catch { /* เงียบไว้ */ }
        res.json({ status: 'success', data: { id_post: value, synced } });
    } catch (err) { next(err); }
});

// PUT /api/ads/:subId — อัปเดตข้อมูลแอดของโพสต์ (สถานะ/ค่าแอด/Reach/วันเริ่ม-จบ)
router.put('/:subId', async (req, res, next) => {
    try {
        const ctx = await store.ads.subContext(req.params.subId);
        if (!ctx) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });
        // ตรวจสิทธิ์ตามแบรนด์: admin ได้ทุกแบรนด์, manager / member เฉพาะแบรนด์ที่ได้รับ
        if (!canSeeBrand(req.account || req.user, ctx.brand)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์แก้ไขข้อมูลของแบรนด์อื่น' });
        }

        const { ad_status, ad_spend, ad_reach, ad_start, ad_end, ad_note } = req.body;
        const viewer = req.account || req.user;
        if (ad_spend !== undefined) {
            // ค่าแอดเป็นข้อมูลลับ (member ไม่เห็นตัวเลข) — คนที่มองไม่เห็นยอดเดิมห้ามเขียนทับ
            if (!canSeeCostMetrics(viewer)) {
                return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์แก้ค่าแอด (ดูและแก้ได้เฉพาะผู้ดูแลระบบและ Manager)' });
            }
            // TikTok ของแบรนด์ที่ยังไม่ต่อ PFM กรอกค่าแอดเองได้ (6 ต.ค. 2026 — ctx.brand = แบรนด์ของแคมเปญ)
            if (pfmManagedSpend(ctx.submission, ctx.brand)) {
                return res.status(409).json({ status: 'error', message: 'ค่าแอดของโพสต์นี้ซิงก์จากระบบ PFM อัตโนมัติ — แก้เองไม่ได้' });
            }
        }
        // หน้าเว็บส่งค่าที่เห็นตอนเริ่มแก้มาด้วย (…_from) — ถ้าในฐานเปลี่ยนไปแล้ว (อีกคนแก้/ซิงก์เข้ามา) ห้ามเขียนทับ
        const sameMoney = (a, b) => Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
        if ((ad_spend !== undefined && req.body.ad_spend_from !== undefined && !sameMoney(req.body.ad_spend_from, ctx.submission.ad_spend))
            || (ad_reach !== undefined && req.body.ad_reach_from !== undefined && !sameMoney(req.body.ad_reach_from, ctx.submission.ad_reach))) {
            return res.status(409).json({ status: 'error', message: 'ค่านี้เพิ่งถูกแก้ (หรือซิงก์เข้ามา) ระหว่างที่หน้าเปิดอยู่ — โหลดหน้าใหม่แล้วลองอีกครั้ง' });
        }
        if (ad_status !== undefined && !AD_STATUSES.includes(ad_status)) {
            return res.status(400).json({ status: 'error', message: 'สถานะไม่ถูกต้อง' });
        }
        // TikTok: สถานะมาจาก PFM อัตโนมัติ — กดเองไม่ได้ทั้งสองทาง (หน้าเว็บที่เปิดค้างรุ่นก่อน / เรียก API ตรง ก็ไม่ผ่าน)
        // เฉพาะแบรนด์ที่ต่อ PFM แล้ว — TikTok ของแบรนด์อื่นกดเองได้ (6 ต.ค. 2026)
        if (ad_status !== undefined && adStatusAuto(ctx.submission, ctx.brand)) {
            return res.status(409).json({ status: 'error', message: 'โพสต์ TikTok ยิงแอดผ่านระบบ PFM — สถานะยิงแล้วขึ้นเองอัตโนมัติ กดเองไม่ได้' });
        }
        // หน้า Ads ที่เปิดค้างไว้: เอเจนซี่เพิ่งแก้ข้อมูลโพสต์ แถวนี้รอทีมตรวจ (ออกจากหน้า Ads แล้ว) — ห้ามกดยิงแล้วด้วยข้อมูลเก่า
        if (ad_status === 'ยิงแล้ว' && postCheckWaiting(ctx.submission)) {
            return res.status(409).json({ status: 'error', message: 'เอเจนซี่เพิ่งแก้ข้อมูลโพสต์นี้ รอทีมตรวจก่อน — โหลดหน้าใหม่แล้วเช็ค Gencode / ID Post อีกครั้ง' });
        }
        const fields = {};
        if (ad_status !== undefined) fields.ad_status = ad_status;
        // ค่าแอด / reach กรอกมือได้จากหน้าโฆษณา — กันค่าติดลบ/ไม่ใช่ตัวเลข/เลขมหาศาลที่พิมพ์ผิด
        if (ad_spend !== undefined) fields.ad_spend = cleanFee(ad_spend);
        if (ad_reach !== undefined) {
            const n = Math.floor(Number(ad_reach));
            fields.ad_reach = Number.isFinite(n) && n > 0 ? Math.min(n, 10000000000) : 0;
        }
        if (ad_start !== undefined) fields.ad_start = ad_start || null;
        if (ad_end !== undefined) fields.ad_end = ad_end || null;
        if (ad_note !== undefined) fields.ad_note = (ad_note && String(ad_note).trim()) ? String(ad_note).trim() : null;

        if (req.body.ad_spend_from !== undefined) fields.ad_spend_from = req.body.ad_spend_from;
        if (req.body.ad_reach_from !== undefined) fields.ad_reach_from = req.body.ad_reach_from;
        const data = await store.submissions.update(req.params.subId, null, fields);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });

        // บันทึกประวัติ (เงียบไว้ถ้า log พลาด)
        try {
            await store.activity.log({
                user_id: req.user.id, team_id: ctx.team_id ?? req.user.team_id, action: 'ad',
                project_id: ctx.project_id, project_name: ctx.project_name,
                summary: `อัปเดตแอด: ${ctx.account_name}` + (ad_status ? ` (${ad_status})` : '')
            });
        } catch { /* เงียบไว้ */ }

        // แถวที่คืนไปต้องผ่านการปิดต้นทุนแบบเดียวกับตอนดึงรายการ (member ห้ามเห็นค่าแอด/ต้นทุนในผลสแตมป์)
        res.json({ status: 'success', data: maskCost({ rows: [data] }, viewer).rows[0] });
    } catch (err) { next(err); }
});

module.exports = router;
