const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// "Engagement ยังไม่มา" ทั้งที่ PFM เชื่อมแล้ว (ผู้ใช้เลือกแก้ A + C + D · 2 ต.ค. 2026)
// A: CPE รวมของการ์ดหน้า Ads / ไทล์หน้า Dashboard + Engagement Rate ต่อแพลตฟอร์ม คิดจาก engagement จริง (เดิมตายตัว)
// C: ซิงก์ PFM รับยอดที่สูงขึ้นได้แม้เวลาอัปเดตของต้นทางไม่ขยับ (เดิมทิ้งทั้งชุด ยอดค้างที่ค่าแรก)
// D: แถวที่ยังไม่มียอดวิวบอกเหตุผลจริง (views_reason)
// ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in pfm-engagement test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const PROJECTS = [
    { id: 81, name: 'Beauterry Oct', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [], budget: 100000 },
    { id: 82, name: 'Solo', brand: 'Jdent', team_id: 1, campaign_type: 'solo', ad_groups: [], budget: 0 }
];
const SUB = over => ({
    project_id: 81, person_key: null, clip_no: 1, platform: 'TikTok', product: 'BTA4-01', agency: 'A',
    status: 'confirmed', budget: 0, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: '2026-10-01', group_key: null, content_type: 'Review',
    gencode: null, id_post: null, perf_stamp: null, ad_synced_at: null, perf_synced_at: null, ...over
});
const freshFixture = () => ({
    projects: structuredClone(PROJECTS),
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        // 1: มีครบ — ค่าตัว 5,000 + ค่าแอด 1,000 · engagement 400 → CPE 15
        SUB({ id: 1, budget: 5000, ad_spend: 1000, views: 20000, likes: 300, comments: 50, saves: 30, shares: 20, id_post: '7000000000000000001', ad_synced_at: '2026-10-01T00:00:00.000Z' }),
        // 2: มี engagement 200 แต่ยังไม่ใส่ค่าตัว → ไม่นับใน CPE
        SUB({ id: 2, budget: 0, ad_spend: 500, views: 10000, likes: 200, id_post: '7000000000000000002', ad_synced_at: '2026-10-01T00:00:00.000Z' }),
        // 3: ค่าตัวมีแต่ engagement 0 → ไม่นับ · PFM จับคู่แล้วแต่ไม่มียอดวิว
        SUB({ id: 3, budget: 3000, ad_spend: 3500, id_post: '7000000000000000003', ad_synced_at: '2026-10-01T00:00:00.000Z' }),
        // 4: Instagram ไม่เคยถูกขอจาก PFM
        SUB({ id: 4, platform: 'Instagram', budget: 2000, id_post: null }),
        // 5: TikTok ยังไม่ใส่ ID Post
        SUB({ id: 5, budget: 2000, id_post: '  ' }),
        // 6: ID Post ไม่ใช่ตัวเลข
        SUB({ id: 6, budget: 2000, id_post: 'https://www.tiktok.com/@a/video/1' }),
        // 7: ถาม PFM แล้วแต่ PFM ไม่เคยส่งคลิปนี้กลับมา
        SUB({ id: 7, budget: 2000, id_post: '7000000000000000007' }),
        // 8: KOL รายคนได้ฟรี (ค่าตัว 0) + ค่าแอด 600 · engagement 100 → นับใน CPE (ต้นทุน = ค่าแอด)
        SUB({ id: 8, project_id: 82, budget: 0, ad_spend: 600, views: 5000, likes: 100, id_post: '7000000000000000008', ad_synced_at: '2026-10-01T00:00:00.000Z' }),
        // 9: ID Post ซ้ำกับแถว 3 (แถว 3 ซิงก์ได้แล้ว) → ยอดลงแถว 3 แถวเดียว
        SUB({ id: 9, budget: 2000, id_post: ' 7000000000000000003 ' }),
        // 10: ID Post ซ้ำกับแถว 7 (แถว 7 เองก็ยังไม่เคยได้ข้อมูล) → ยังไม่ได้ยอดจาก PFM ทั้งคู่
        SUB({ id: 10, budget: 2000, id_post: '7000000000000000007' })
    ]
});
let FIXTURE = freshFixture();
beforeEach(() => { FIXTURE = freshFixture(); written = []; });

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
const base = require(path.join(SRC, 'store/pg/_base'));
let written = [];
base.withTransaction = async fn => fn({ query: async sql => {
    assert.match(sql, /FOR UPDATE OF s/);
    return { rows: structuredClone(FIXTURE.submissions).map(s => {
        const p = FIXTURE.projects.find(p => p.id === s.project_id);
        return { ...s, sync_brand: p?.brand, sync_campaign_type: p?.campaign_type };
    }) };
} });
base.updateRow = async (table, id, patch) => { written.push({ table, id, patch }); return { id, ...patch }; };

const { pooledCpe, viewsMissingReason, firstByIdPost } = require(path.join(SRC, 'store/logic'));
const { ads, adsSync } = require(path.join(SRC, 'store/pg/ads'));
const kols = require(path.join(SRC, 'store/pg/kols'));
const { dashboard } = require(path.join(SRC, 'store/pg/dashboard'));
const { syncSummaryLine, sanitizeRow } = require(path.join(SRC, 'services/beauterryPfmSync'));
const byId = (rows, id) => rows.find(r => r.sub_id === id);

// ---------------------------------------------------------------- D: เหตุที่ยังไม่มียอดวิว
test('viewsMissingReason: แยกเหตุตามที่ระบบขอข้อมูลจาก PFM จริง · มียอดวิวแล้ว = null', () => {
    // แคมเปญ Beauterry (ต่อ PFM แล้ว) — แบรนด์อื่นดู tests/pfm-brand-scope.test.cjs
    const r = s => viewsMissingReason(SUB(s), null, 'Beauterry');
    assert.equal(r({ views: 10 }), null);
    assert.equal(r({ platform: 'Instagram' }), 'not_tiktok');
    assert.equal(r({ platform: null }), 'not_tiktok');
    assert.equal(r({ platform: ' TikTok' }), 'not_tiktok', 'ตรงกับ SQL ILIKE tiktok% (ไม่ตัดช่องว่างหน้า)');
    assert.equal(r({ platform: 'tiktok', id_post: null }), 'no_id_post');
    assert.equal(r({ id_post: '   ' }), 'no_id_post');
    assert.equal(r({ id_post: '7690488609664748807?lang=th' }), 'bad_id_post');
    assert.equal(r({ id_post: ' 7690488609664748807 ' }), 'pfm_no_clip', 'ตัดช่องว่างหัวท้ายแบบเดียวกับ btrim');
    assert.equal(r({ id_post: '7690488609664748807', ad_synced_at: '2026-10-01T00:00:00Z' }), 'pfm_no_views');
    assert.equal(viewsMissingReason(null, null, 'Beauterry'), null);
    // ID Post ซ้ำ: แถวที่ไม่ใช่แถวแรก + แถวแรกซิงก์ได้แล้ว = dup_id_post · แถวแรกยังไม่ได้ = pfm_no_clip · ไม่ส่ง Map = ไม่เช็คซ้ำ
    const subs = [SUB({ id: 1, id_post: '9', ad_synced_at: 'x' }), SUB({ id: 2, id_post: '9 ' }), SUB({ id: 3, id_post: '8' }), SUB({ id: 4, id_post: '8' })];
    const first = firstByIdPost(subs);
    assert.equal(first.get('9').id, 1);
    assert.equal(viewsMissingReason(subs[1], first, 'Beauterry'), 'dup_id_post');
    assert.equal(viewsMissingReason(subs[3], first, 'Beauterry'), 'pfm_no_clip');
    assert.equal(viewsMissingReason(subs[1], null, 'Beauterry'), 'pfm_no_clip');
    assert.equal(viewsMissingReason(SUB({ id_post: '\t9' }), null, 'Beauterry'), 'bad_id_post', 'btrim ตัดเฉพาะช่องว่าง (tab ไม่ตัด แบบเดียวกับ SQL)');
});

test('ads.list / kols.analytics ส่ง views_reason ต่อแถว', async () => {
    const { rows } = await ads.list({});
    const want = { 1: null, 2: null, 3: 'pfm_no_views', 4: 'not_tiktok', 5: 'no_id_post', 6: 'bad_id_post', 7: 'pfm_no_clip', 8: null, 9: 'dup_id_post', 10: 'pfm_no_clip' };
    for (const [id, reason] of Object.entries(want)) assert.equal(byId(rows, Number(id)).views_reason, reason, 'ads ' + id);
    const an = await kols.analytics(null);
    for (const [id, reason] of Object.entries(want)) assert.equal(byId(an.rows, Number(id)).views_reason, reason, 'kols ' + id);
});

test('หน้าเว็บ viewsReasonText: ทุกเหตุมีป้ายสั้น + คำอธิบาย · เหตุที่ไม่รู้จัก = null (ใช้ข้อความเดิม)', async () => {
    const C = await import(pathToFileURL(path.join(__dirname, '../client/src/data/stamp.js')).href);
    for (const reason of ['not_tiktok', 'no_id_post', 'bad_id_post', 'dup_id_post', 'pfm_no_clip', 'pfm_no_views']) {
        const t = C.viewsReasonText(reason, { platform: 'Instagram', id_post: 'abc' });
        assert.ok(t && t.short && t.long, reason);
    }
    assert.match(C.viewsReasonText('not_tiktok', { platform: 'Instagram' }).short, /Instagram/);
    assert.match(C.viewsReasonText('bad_id_post', { id_post: 'abc?x' }).long, /abc\?x/);
    assert.equal(C.viewsReasonText(undefined, {}), null);
    assert.equal(C.viewsReasonText(null, {}), null);
    assert.equal(C.viewsReasonText('อะไรไม่รู้', {}), null);
});

// ---------------------------------------------------------------- A: CPE รวม
test('pooledCpe: ค่าตัว ÷ engagement รวม (ไม่รวมค่าแอด) · ไม่นับคลิปที่ยังไม่ใส่ค่าตัว / ได้ฟรี / engagement 0 · ไม่มีเลย = null', () => {
    assert.deepEqual(pooledCpe([]), { cpe: null, clips: 0, fee: 0, engagement: 0 });
    assert.deepEqual(pooledCpe(null), { cpe: null, clips: 0, fee: 0, engagement: 0 });
    const p = pooledCpe([
        { fee: 5000, adSpend: 1000, engagement: 400, campaignType: 'kol' },   // นับ: ค่าตัว 5000 / 400 (ค่าแอดไม่นับ)
        { fee: 0, adSpend: 500, engagement: 200, campaignType: 'kol' },       // ยังไม่ใส่ค่าตัว → ไม่นับ
        { fee: 3000, adSpend: 0, engagement: 0, campaignType: 'kol' },        // engagement 0 → ไม่นับ
        { fee: 0, adSpend: 600, engagement: 100, campaignType: 'solo' },      // KOL รายคนได้ฟรี → ไม่มีค่าตัวให้คิด
        { fee: 2000, adSpend: 0, engagement: 100, campaignType: 'solo' },     // KOL รายคนมีค่าตัว → นับ
        null
    ]);
    assert.equal(p.clips, 2);
    assert.equal(p.fee, 7000);
    assert.equal(p.engagement, 500);
    assert.equal(p.cpe, 14);
    assert.equal(pooledCpe([{ fee: 1000, adSpend: 0, engagement: 3 }]).cpe, 333.33, 'ปัด 2 ตำแหน่ง');
});

test('ads.list summary: cpe จาก engagement จริง + จำนวนโพสต์ที่ใช้คิด · กรองแบรนด์แล้วคิดใหม่ตามแถวที่เหลือ', async () => {
    const { summary } = await ads.list({});
    assert.equal(summary.cpe, 12.5);          // แถว 1 ค่าตัว 5000 / 400 · แถว 8 ได้ฟรี (ไม่มีค่าตัวให้คิด) · ค่าแอดไม่นับ
    assert.equal(summary.cpe_clips, 1);
    assert.equal(summary.eng_posts, 3);       // 1, 2, 8 มี engagement (2 ยังไม่ใส่ค่าตัว · 8 ได้ฟรี)
    const jdent = (await ads.list({ brand: 'Jdent' })).summary;
    assert.equal(jdent.cpe, null, 'Jdent มีแต่คลิปได้ฟรี = ไม่มีค่าตัวให้คิด');
    assert.equal(jdent.cpe_clips, 0);
    FIXTURE.submissions.forEach(s => { s.likes = 0; s.comments = 0; s.saves = 0; s.shares = 0; });
    const none = (await ads.list({})).summary;
    assert.equal(none.cpe, null, 'ไม่มี engagement เลย = null (หน้าเว็บขึ้น —)');
    assert.equal(none.cpe_clips, 0);
    assert.equal(none.eng_posts, 0);
});

test('ads.list ไม่ส่งค่าตัว (budget) ออกไปกับแถว — CPE รวมคิดในฝั่ง server', async () => {
    const { rows } = await ads.list({});
    for (const r of rows) assert.equal('budget' in r || 'fee' in r, false, 'แถว ' + r.sub_id);
});

test('dashboard.overview: CPE รวมจาก engagement จริง (เดิม 0 ตายตัว) + Engagement Rate ต่อแพลตฟอร์ม', async () => {
    const d = await dashboard.overview({});
    assert.equal(d.cpe, 12.5);
    const tt = d.platforms.find(p => p.platform === 'TikTok');
    // TikTok ที่มียอดวิว: 1 (20000 / 400) · 2 (10000 / 200) · 8 (5000 / 100) → 700 / 35000 = 2%
    assert.equal(tt.engagement, 2);
    const ig = d.platforms.find(p => p.platform === 'Instagram');
    assert.equal(ig.engagement, null, 'ยังไม่มียอดวิว = null (หน้าเว็บขึ้น -)');
    FIXTURE.submissions.forEach(s => { s.likes = 0; s.comments = 0; s.saves = 0; s.shares = 0; });
    assert.equal((await dashboard.overview({})).cpe, null);
});

// ---------------------------------------------------------------- C: ซิงก์ PFM
const synced = (over = {}) => SUB({ id: 50, id_post: '7100000000000000050', views: 2265, likes: 20, comments: 5,
    perf_synced_at: '2026-09-25T03:00:00.000Z', ad_synced_at: '2026-10-01T00:00:00.000Z', ...over });
const pfmRow = over => sanitizeRow({ id_post: '7100000000000000050', ...over });
const patchOf = id => Object.assign({}, ...written.filter(w => w.id === id).map(w => w.patch));

test('ซิงก์ PFM: เวลาต้นทางไม่ขยับ แต่ยอดสูงขึ้น → รับเฉพาะช่องที่สูงขึ้น · perf_synced_at ไม่ขยับ · นับ stale_raised', async () => {
    FIXTURE.submissions = [synced()];
    const out = await adsSync.apply([pfmRow({ views: 124000, likes: 900, comments: 5, source_updated_at: '2026-09-25T03:00:00.000Z' })]);
    const p = patchOf(50);
    assert.equal(p.views, 124000);
    assert.equal(p.likes, 900);
    assert.equal('comments' in p, false, 'เท่าเดิม = ไม่เขียน');
    assert.equal('perf_synced_at' in p, false, 'เวลาต้นทางไม่ใหม่กว่า = ไม่ขยับ perf_synced_at');
    assert.equal(out.stale, 1);
    assert.equal(out.stale_raised, 1);
    assert.equal(out.updated, 1);
});

test('ซิงก์ PFM: ไม่ส่งเวลาต้นทางมา (แถวเคยซิงก์แล้ว) แต่ยอดสูงขึ้น → รับได้ · ยอดต่ำกว่าเดิม → ไม่รับ (regressed)', async () => {
    FIXTURE.submissions = [synced()];
    const out = await adsSync.apply([pfmRow({ views: 3000, likes: 10 })]);
    const p = patchOf(50);
    assert.equal(p.views, 3000);
    assert.equal('likes' in p, false, 'ยอดต่ำกว่าเดิมไม่ทับ');
    assert.equal(out.regressed_metrics, 1);
    assert.equal(out.stale, 1);
    assert.equal(out.stale_raised, 1);
});

test('ซิงก์ PFM: เวลาต้นทางไม่ขยับและยอดไม่สูงขึ้น → ไม่เขียนยอดอะไรเลย (stale แต่ไม่ raised) · ค่าแอดยังเดินได้', async () => {
    FIXTURE.submissions = [synced({ ad_spend: 100 })];
    const out = await adsSync.apply([pfmRow({ views: 2265, likes: 20, ad_spend: 250, source_updated_at: '2026-09-24T00:00:00.000Z' })]);
    const p = patchOf(50);
    for (const k of ['views', 'likes', 'comments', 'saves', 'shares', 'reposts', 'perf_synced_at']) assert.equal(k in p, false, k);
    assert.equal(p.ad_spend, 250);
    assert.equal(out.stale, 1);
    assert.equal(out.stale_raised, 0);
});

test('ซิงก์ PFM: เวลาต้นทางใหม่กว่า → เขียนทุกช่องที่ส่งมา + ขยับ perf_synced_at (พฤติกรรมเดิม)', async () => {
    FIXTURE.submissions = [synced()];
    const out = await adsSync.apply([pfmRow({ views: 2265, likes: 30, comments: 5, source_updated_at: '2026-10-02T03:00:00.000Z' })]);
    const p = patchOf(50);
    assert.equal(p.views, 2265);
    assert.equal(p.likes, 30);
    assert.equal(p.perf_synced_at, '2026-10-02T03:00:00.000Z');
    assert.equal(out.stale, 0);
    assert.equal(out.stale_raised, 0);
});

test('ซิงก์ที่ไม่ใช่ PFM (เส้น /api/ads-sync/sync) ทำงานเหมือนเดิม — เขียนตามที่ส่งมา ไม่ผ่านด่านเวลา/ยอดลด', async () => {
    FIXTURE.submissions = [synced()];
    const out = await adsSync.apply([{ id_post: '7100000000000000050', views: 100, likes: 1 }]);
    const p = patchOf(50);
    assert.equal(p.views, 100);
    assert.equal(p.likes, 1);
    assert.equal(out.stale, 0);
    assert.equal(out.regressed_metrics, 0);
});

test('log ของรอบซิงก์บอกจำนวนที่ถูกทิ้ง/ข้าม ไม่ใช่แค่ updated', () => {
    const line = syncSummaryLine({ updated: 70, requested: 79, received: 72, source_not_found: ['1', '2'], not_found: ['3'],
        stale: 40, stale_raised: 12, regressed_metrics: 3, skipped: 0, stamped: 1 });
    assert.match(line, /70\/79 updated/);
    assert.match(line, /PFM ไม่มี 2/);
    assert.match(line, /จับคู่ไม่ได้ 1/);
    assert.match(line, /เวลาต้นทางไม่ขยับ 40 \(รับยอดที่สูงขึ้น 12\)/);
    assert.match(line, /ยอดต่ำกว่าเดิมไม่รับ 3/);
    assert.match(syncSummaryLine({}), /0\/0 updated/);
    assert.equal(syncSummaryLine({ skipped: true, reason: 'already_running' }), 'Beauterry PFM sync skipped: already_running');
});
