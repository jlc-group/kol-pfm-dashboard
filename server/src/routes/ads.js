const express = require('express');
const path = require('node:path');
const store = require('../store');
const { UPLOAD_DIR } = require('../config/uploads');
const { thumbPath, createThumbCache } = require('../services/adThumbs');
const { authenticate } = require('../middleware/auth');
const { allowedBrands, canSeeBrand, canSeeCostMetrics } = require('../data/roles');
const { cleanFee, pfmManagedSpend, postCheckWaiting, adStatusAuto } = require('../store/logic');
const { getOrganicMetricStatus } = require('../services/beauterryPfmSync');

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

// รูปปกคลิป TikTok (คอลัมน์ IMAGE) — ดึงครั้งแรกแล้วเก็บไว้ในเครื่อง ครั้งต่อไปเสิร์ฟจากไฟล์เลย
const thumbs = createThumbCache({ dir: path.join(UPLOAD_DIR, 'ads-thumbs') });

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
            r.thumb = thumbPath(r);
            if (r.status_auto === true) {
                r.organic_metrics_status = getOrganicMetricStatus(r.id_post);
                if (r.views_reason === 'pfm_no_views' && r.organic_metrics_status === 'source_unavailable') r.views_reason = 'pfm_source_unavailable';
            }
        });
        res.json({ status: 'success', data: maskCost(data, req.account || req.user) });
    } catch (err) { next(err); }
});

// GET /api/ads/:subId/thumb — รูปปกคลิป TikTok ของโพสต์ · สิทธิ์ตามแบรนด์เหมือนตอนแก้แถว
router.get('/:subId/thumb', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');   // ตอบ error ห้ามค้างในเบราว์เซอร์ (ดึงได้ทีหลังต้องเห็นรูป)
        const ctx = await store.ads.subContext(req.params.subId);
        if (!ctx) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });
        if (!canSeeBrand(req.account || req.user, ctx.brand)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์ดูข้อมูลของแบรนด์อื่น' });
        }
        const fp = await thumbs.get(ctx.submission.post_url);
        if (!fp) return res.status(404).json({ status: 'error', message: 'ยังไม่มีรูปปกของโพสต์นี้' });
        // รูปของคลิปเดิมไม่เปลี่ยน (เปลี่ยนลิงก์โพสต์ = ?v= ใหม่) — ให้เบราว์เซอร์เก็บไว้ 7 วัน เฉพาะเครื่องคนนั้น
        // ใส่ผ่าน headers ของ sendFile = ตั้งเฉพาะตอนส่งไฟล์สำเร็จ (ส่งไม่ได้ยังเป็น no-store ข้างบน)
        res.sendFile(fp, { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=604800' } });
    } catch (err) { next(err); }
});

// PUT /api/ads/:subId — อัปเดตข้อมูลแอดของโพสต์ (สถานะ/ค่าแอด/Reach/วันเริ่ม-จบ)
router.put('/:subId', async (req, res, next) => {
    try {
        const ctx = await store.ads.subContext(req.params.subId);
        if (!ctx) return res.status(404).json({ status: 'error', message: 'ไม่พบโพสต์' });
        // ตรวจสิทธิ์ตามแบรนด์: admin/manager ได้ทุกแบรนด์, member เฉพาะแบรนด์ตัวเอง
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
