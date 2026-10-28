const express = require('express');
const store = require('../store');
const { allowedBrands, normalizeRole, canUseMyWork } = require('../data/roles');
const { idOf, reviewerOf, reviewBucket, latestDraftNo, DRAFT_LINKS } = require('../data/reviewers');

// หน้า "งานของฉัน" (ผู้ใช้สั่ง 27 ต.ค. 2026) — คลิปที่ต้องตรวจดราฟ ข้ามทุกแคมเปญ ตามคนตรวจที่ตั้งไว้ (ทั้งแคมเปญ → กลุ่ม → รายคลิป)
// เห็นได้เฉพาะงานของบัญชีตัวเอง · Admin ดูของทุกคนได้ (?user=<id> หรือ ?user=unassigned = คลิปที่ยังไม่มีคนตรวจ)
// ตัดตามแบรนด์ที่ผู้เปิดมีสิทธิ์เสมอ · ไม่มีข้อมูลเงิน (ค่าตัว / ค่าแอด) ในคำตอบ
// app.js: authenticate + blockPending + blockAgency (เอเจนซี่เข้าไม่ได้)
const router = express.Router();
// เข้าได้เฉพาะทีม Reviewer + Admin (ผู้ใช้สั่ง 28 ต.ค. 2026) — ทีมอื่นไม่มีหน้านี้ (เมนู / เลขแดงก็ไม่ขึ้น · roles.js canUseMyWork)
router.use((req, res, next) => (canUseMyWork(req.account)
    ? next() : res.status(403).json({ status: 'error', message: 'หน้า My Work ใช้ได้เฉพาะทีม Reviewer และ Admin' })));

const POSTED_DAYS = 7;   // การ์ด "ลงงานแล้ว" นับเฉพาะ 7 วันล่าสุด
const DAY = 86400000;
// ช่องที่หน้าต่างดราฟ (DraftModal) และรายการต้องใช้ — ไม่ส่งทั้งแถว (มีค่าตัว / ค่าแอด / ข้อมูลภายในอื่น)
const ROW_KEYS = ['id', 'project_id', 'account_name', 'platform', 'product', 'clip_name', 'clip_no', 'group_key', 'status',
    ...DRAFT_LINKS, 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5',
    'draft_remark', 'draft_remark2', 'draft_remark3', 'draft_remark4', 'draft_remark5',
    'draft_status', 'approved', 'post_url', 'post_url_at', 'post_date', 'draft_updated_at',
    'draft_checked_by_id', 'draft_checked_by', 'draft_checked_at', 'reviewer_id'];
const COUNT_KEYS = ['reviewer_id', ...DRAFT_LINKS, 'draft_status', 'post_url', 'post_url_at'];

// ?user= → ดูงานของใคร: { id } (null = ยังไม่มีคนตรวจ) · คนที่ไม่ใช่ admin ขอดูของคนอื่น = error 403
function targetOf(req) {
    const me = idOf(req.user && req.user.id);
    const raw = req.query.user;
    if (raw === undefined || raw === '' || String(raw) === String(me)) return { id: me };
    const isAdmin = normalizeRole((req.account || req.user || {}).role) === 'admin';
    if (!isAdmin) return { error: 403, message: 'ดูได้เฉพาะงานของตัวเอง' };
    if (raw === 'unassigned') return { id: null };
    const id = idOf(raw);
    return id ? { id } : { error: 400, message: 'ผู้ใช้ไม่ถูกต้อง' };
}

// แถวที่เป็นงานของคนนี้ (ตามสิทธิ์แบรนด์ของผู้เปิด) → [{ row, project, bucket, reviewer }]
// project = { id, name, brand, campaign_type, review_assign, group_keys (ตามลำดับกลุ่ม), keySet }
async function workOf(req, targetId, columns = ROW_KEYS) {
    const scope = allowedBrands(req.account || req.user);   // null = ทุกแบรนด์
    const [{ projects, rows }, users] = await Promise.all([store.submissions.reviewRows(columns), store.users.listWithTeam()]);
    // คนตรวจที่ปิดบัญชี / ถูกลบ / เปลี่ยนเป็นเอเจนซี่ไปแล้ว = นับเป็น "ยังไม่มีคนตรวจ" (ผลรีวิว 27 ต.ค.)
    // ไม่งั้นคลิปของคนนั้นหายจากทุกหน้า รวมหน้า "ยังไม่มีคนตรวจ" ของ Admin ที่ใช้ตามเก็บงานตกหล่น
    // + คนที่เข้าหน้านี้ไม่ได้แล้ว (ไม่อยู่ทีม Reviewer และไม่ใช่ Admin · 28 ต.ค.) เช่น ตั้งไว้ก่อนจำกัดทีม / ย้ายทีมทีหลัง (ผลรีวิว 28 ต.ค.)
    const active = new Set((users || []).filter(u => u && u.is_active !== false && (u.status || 'active') === 'active' && u.role !== 'agency' && canUseMyWork(u)).map(u => idOf(u.id)));
    const byId = new Map();
    projects.forEach(p => {
        const keys = (Array.isArray(p.group_keys) ? p.group_keys : []).filter(Boolean);
        byId.set(p.id, { ...p, group_keys: keys, keySet: new Set(keys) });
    });
    const now = Date.now();
    const out = [];
    for (const r of rows) {
        const project = byId.get(r.project_id);
        if (!project || (scope && !scope.includes(project.brand))) continue;
        const found = reviewerOf(r, project.review_assign, project.keySet);
        const rv = found.id && !active.has(found.id) ? { id: null, from: null } : found;
        if (rv.id !== targetId) continue;
        const bucket = reviewBucket(r);
        if (bucket === 'todo') continue;   // ยังไม่ส่งดราฟ — ยังไม่ใช่งานของคนตรวจ
        if (bucket === 'posted') {
            const t = Date.parse(r.post_url_at || '');
            if (!Number.isFinite(t) || now - t > POSTED_DAYS * DAY) continue;
        }
        out.push({ row: r, project, bucket, reviewer: rv });
    }
    return out;
}

// GET /api/my-work?user= — รายการ + จำนวนต่อการ์ด
router.get('/', async (req, res, next) => {
    try {
        const t = targetOf(req);
        if (t.error) return res.status(t.error).json({ status: 'error', message: t.message });
        const items = await workOf(req, t.id);
        const counts = { review: 0, revise: 0, approved: 0, posted: 0 };
        const data = items.map(({ row, project, bucket, reviewer }) => {
            counts[bucket]++;
            const o = {};
            ROW_KEYS.forEach(k => { o[k] = row[k] === undefined ? null : row[k]; });
            const gi = project.group_keys.indexOf(row.group_key);
            return {
                ...o, bucket, reviewer_from: reviewer.from, draft_no: latestDraftNo(row),
                project_name: project.name, brand: project.brand, campaign_type: project.campaign_type || 'kol', group_no: gi >= 0 ? gi + 1 : null
            };
        });
        res.json({ status: 'success', data: { user: t.id, counts, rows: data } });
    } catch (err) { next(err); }
});

// GET /api/my-work/count — เลขแดงบนเมนู (คลิปที่รอฉันตรวจ · ของตัวเองเท่านั้น)
router.get('/count', async (req, res, next) => {
    try {
        // ถามทุกนาทีจากทุกบัญชี — อ่านเฉพาะช่องที่ใช้ตัดสินคนตรวจ / ขั้นงาน
        const items = await workOf(req, idOf(req.user && req.user.id), COUNT_KEYS);
        res.json({ status: 'success', data: { review: items.filter(i => i.bucket === 'review').length } });
    } catch (err) { next(err); }
});

module.exports = router;
