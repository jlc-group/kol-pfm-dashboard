const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// กฎ "คลิปที่ยังไม่ใส่ค่าตัว" ของหน้า Dashboard และหน้า Report — ไม่มีฐานข้อมูล
// ยอดรวมค่าจ้างไม่เปลี่ยน (0 ไม่ได้บวกอะไร) แต่คลิปพวกนี้ต้องไม่ถูกเอามาคิด CPM/CPE เฉลี่ย
// แกนคะแนน CPM/CPE และการนับ Good — ไม่งั้นต้นทุนเหลือแค่ค่าแอดจะดูคุ้มเกินจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const {
    feeMissing, clipCostMetrics, costAxisRange, costAxisNorm, perfVerdict, feeCostAverages, GOOD_CPM, GOOD_CPE
} = require(path.join(SRC, 'store/logic.js'));

// ==================== helper ล้วนใน logic.js ====================

test('feeMissing: 0, empty or negative means no fee yet', () => {
    for (const b of [0, '0', '0.00', '', null, undefined, -1, 'abc']) assert.equal(feeMissing(b), true, String(b));
    for (const b of [0.01, 1, 5000, '5000.00']) assert.equal(feeMissing(b), false, String(b));
});

test('clipCostMetrics: no fee gives null CPM/CPE instead of an ad-only bargain', () => {
    assert.deepEqual(clipCostMetrics({ fee: 0, adSpend: 500, views: 300000, engagement: 10000 }),
        { fee_missing: true, cost: 500, cpm: null, cpe: null });
    // CPM/CPE คิดจากค่าตัวอย่างเดียว (5 ต.ค. 2026): 5000 ÷ 100 = 50 · 5000 ÷ 1200 = 4.17 · cost (ค่าตัว + ค่าแอด) ยังเป็น 17000
    assert.deepEqual(clipCostMetrics({ fee: '5000.00', adSpend: 12000, views: 100000, engagement: 1200 }),
        { fee_missing: false, cost: 17000, cpm: 50, cpe: 4.17 });
    assert.deepEqual(clipCostMetrics({ fee: 5000, adSpend: 0, views: 0, engagement: 0 }),
        { fee_missing: false, cost: 5000, cpm: 0, cpe: 0 });
});

test('KOL รายคน (solo): fee 0 = free, not missing — CPM/CPE come from the fee only, so a free clip is not rated', () => {
    for (const b of [0, '0', '', null, undefined]) {
        assert.equal(feeMissing(b, 'solo'), false, String(b));
        assert.equal(feeMissing(b, 'kol'), true, String(b));
    }
    // ได้ฟรี + ยังไม่ยิงแอด = ไม่มีต้นทุนให้ตัดสิน (null ไม่ใช่ 0 ที่ดูคุ้มสุด)
    assert.deepEqual(clipCostMetrics({ fee: 0, adSpend: 0, views: 300000, engagement: 10000, campaignType: 'solo' }),
        { fee_missing: false, fee_free: true, cost: 0, cpm: null, cpe: null });
    // ได้ฟรี + ยิงแอดแล้ว = ยังไม่มีค่าตัวให้คิด (CPM/CPE ไม่รวมค่าแอด · 5 ต.ค. 2026) · cost ยังเป็นค่าแอดที่จ่ายจริง
    assert.deepEqual(clipCostMetrics({ fee: '0.00', adSpend: 4000, views: 200000, engagement: 4000, campaignType: 'solo' }),
        { fee_missing: false, fee_free: true, cost: 4000, cpm: null, cpe: null });
    assert.deepEqual(clipCostMetrics({ fee: 5000, adSpend: 0, views: 100000, engagement: 1000, campaignType: 'solo' }),
        { fee_missing: false, fee_free: false, cost: 5000, cpm: 50, cpe: 5 });
    // แคมเปญอื่นไม่มี fee_free (รูปผลลัพธ์เดิม)
    assert.deepEqual(clipCostMetrics({ fee: 0, adSpend: 500, views: 1, engagement: 1, campaignType: 'kol' }),
        { fee_missing: true, cost: 500, cpm: null, cpe: null });
    assert.equal(perfVerdict({ fee_missing: false, views: 300000, cpm: null, cpe: null }), null, 'ไม่มี CPM = ยังตัดสินไม่ได้');
    assert.equal(perfVerdict({ fee_missing: false, views: 200000, cpm: 20, cpe: 1 }), 'Good');
    // ค่าเฉลี่ยไม่เอาคลิปที่ไม่มี CPM (null จะถูกนับเป็น 0)
    assert.deepEqual(feeCostAverages([
        { fee_missing: false, reach: 100000, cpm: 20, cpe: 1 },
        { fee_missing: false, reach: 5000, cpm: null, cpe: null }
    ]), { avg_cpm: 20, avg_cpe: 1, fee_clips: 1, fee_missing_clips: 0 });
});

test('costAxisRange ignores clips without a fee or without the metric', () => {
    const rows = [
        { fee_missing: false, cpm: 25, cpe: 0.83 },
        { fee_missing: false, cpm: 80, cpe: 0 },
        { fee_missing: true, cpm: null, cpe: null },
        { fee_missing: true, cpm: 1.67, cpe: 0.05 }   // มีตัวเลขถูก ๆ ติดมาก็ต้องไม่ยืดช่วง
    ];
    assert.deepEqual(costAxisRange(rows, 'cpm'), { min: 25, max: 80 });
    assert.deepEqual(costAxisRange(rows, 'cpe'), { min: 0.83, max: 0.83 });
    assert.deepEqual(costAxisRange([{ fee_missing: true, cpm: 1 }], 'cpm'), { min: 0, max: 0 });
    assert.deepEqual(costAxisRange([], 'cpe'), { min: 0, max: 0 });
});

test('costAxisNorm: cheapest = 1, dearest = 0, no fee or no value = 0', () => {
    const r = { min: 25, max: 125 };
    assert.equal(costAxisNorm({ fee_missing: false, cpm: 25 }, 'cpm', r), 1);
    assert.equal(costAxisNorm({ fee_missing: false, cpm: 125 }, 'cpm', r), 0);
    assert.equal(costAxisNorm({ fee_missing: false, cpm: 75 }, 'cpm', r), 0.5);
    assert.equal(costAxisNorm({ fee_missing: true, cpm: 1 }, 'cpm', r), 0);
    assert.equal(costAxisNorm({ fee_missing: true, cpm: null }, 'cpm', r), 0);
    assert.equal(costAxisNorm({ fee_missing: false, cpm: 0 }, 'cpm', r), 0);
    assert.equal(costAxisNorm({ fee_missing: false, cpe: 3 }, 'cpe', { min: 3, max: 3 }), 1);
});

test('costAxisRange/costAxisNorm: a page can pass its own rule, so a fee clip rounded to 0.00 stays the cheapest', () => {
    const hasCpe = r => r.engagement_total > 0;
    const rows = [
        { fee_missing: false, cpe: 0, engagement_total: 25000 },      // ถูกมากจนปัดเหลือ 0.00
        { fee_missing: false, cpe: 0.2, engagement_total: 25000 },
        { fee_missing: false, cpe: 0, engagement_total: 0 },          // ไม่มี engagement = ไม่มีค่าให้เทียบ
        { fee_missing: true, cpe: null, engagement_total: 90000 }
    ];
    const range = costAxisRange(rows, 'cpe', hasCpe);
    assert.deepEqual(range, { min: 0, max: 0.2 });
    assert.deepEqual(rows.map(r => costAxisNorm(r, 'cpe', range, hasCpe)), [1, 0, 0, 0]);
    // ไม่ส่งกติกามา = นับเฉพาะค่ามากกว่า 0 (กติกาเดิมของหน้า Report)
    assert.deepEqual(costAxisRange(rows, 'cpe'), { min: 0.2, max: 0.2 });
    assert.equal(costAxisNorm(rows[0], 'cpe', { min: 0.2, max: 0.2 }), 0);
});

test('perfVerdict: a clip without a fee is neither Good nor Improve', () => {
    assert.equal(perfVerdict({ fee_missing: true, views: 300000, cpm: 1.67, cpe: 0.05 }), null);
    assert.equal(perfVerdict({ fee_missing: false, views: 200000, cpm: 25, cpe: 0.83 }), 'Good');
    assert.equal(perfVerdict({ fee_missing: false, views: 1, cpm: GOOD_CPM, cpe: GOOD_CPE }), 'Good');
    assert.equal(perfVerdict({ fee_missing: false, views: 1, cpm: GOOD_CPM + 0.01, cpe: 1 }), 'Improve');
    assert.equal(perfVerdict({ fee_missing: false, views: 0, cpm: 0, cpe: 0 }), 'Improve');
});

test('feeCostAverages: averages fee clips with reach, counts missing clips over all rows', () => {
    const rows = [
        { fee_missing: false, reach: 150000, cpm: 25, cpe: 0.83 },
        { fee_missing: false, reach: 80000, cpm: 80, cpe: 6.67 },
        { fee_missing: false, reach: 0, cpm: 50, cpe: 1 },          // ยังไม่มี reach — ไม่เข้าเฉลี่ย (กติกาเดิม)
        { fee_missing: true, reach: 250000, cpm: null, cpe: null },
        { fee_missing: true, reach: 0, cpm: null, cpe: null }
    ];
    assert.deepEqual(feeCostAverages(rows), { avg_cpm: 52.5, avg_cpe: 3.75, fee_clips: 2, fee_missing_clips: 2 });
    assert.deepEqual(feeCostAverages([{ fee_missing: true, reach: 1000, cpm: null, cpe: null }]),
        { avg_cpm: 0, avg_cpe: 0, fee_clips: 0, fee_missing_clips: 1 });
    assert.deepEqual(feeCostAverages([]), { avg_cpm: 0, avg_cpe: 0, fee_clips: 0, fee_missing_clips: 0 });
});

// ==================== โค้ดจริงของ dashboard.js / reports.js กับ snapshot ปลอม ====================
// ต่อฐานจริงทุกทางโยน error ทันที · loadSnapshot ถูกสลับเป็นข้อมูลชุดทดสอบ
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in fee-missing test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const SUB = fields => ({
    project_id: 41, person_key: null, clip_no: 1, platform: 'TikTok', product: 'สินค้า A', agency: 'Agency A',
    status: 'confirmed', budget: 0, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: null, link_account: null, post_date: null, group_key: null, content_format: null, ...fields
});
const FIXTURE = {
    projects: [
        { id: 41, name: 'แคมเปญทดสอบ', brand: 'Jdent', budget: 100000, status: 'Active', team_id: 1,
          created_at: '2026-07-01T00:00:00.000Z', start_date: '2026-07-01', end_date: '2026-07-31', ad_groups: [], products: ['สินค้า A'] },
        { id: 42, name: 'แบรนด์อื่น', brand: 'Code Lab', budget: 50000, status: 'Active', team_id: 2,
          created_at: '2026-07-02T00:00:00.000Z', start_date: null, end_date: null, ad_groups: [], products: [] },
        { id: 43, name: 'ค่าตัวครบ', brand: 'Jarvit', budget: 20000, status: 'Active', team_id: 1,
          created_at: '2026-08-01T00:00:00.000Z', start_date: '2026-08-01', end_date: null, ad_groups: [], products: [] },
        // KOL รายคน (รอบ 4): ค่าตัว 0 = ได้ฟรี ไม่ใช่ "ยังไม่ใส่ค่าตัว"
        // กลุ่มหลาย Platform: ค่าระดับกลุ่มเป็นของ TikTok · Instagram มี Format ของตัวเอง
        { id: 44, name: 'KOL รายคน · @free (TikTok, Instagram)', brand: 'Beauterry', budget: 3000, status: 'Active', team_id: 1, campaign_type: 'solo',
          created_at: '2026-10-01T00:00:00.000Z', start_date: '2026-10-01', end_date: '2026-10-01', products: [],
          ad_groups: [{ key: 'g44', platform: 'TikTok', platforms: ['TikTok', 'Instagram'], content_format: 'Review', allocations: [
              { platform: 'TikTok', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Review', media_type: 'VDO', content_format: 'Review' },
              { platform: 'Instagram', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Reels', media_type: 'Photo', content_format: 'Unbox' }] }] }
    ],
    submissions: [
        // น้องเอ: มีค่าตัว ผ่านเกณฑ์คุ้มค่า (CPM 25 · CPE 0.83)
        SUB({ id: 1, account_name: 'น้องเอ', person_key: 'pa', budget: 5000, ad_reach: 150000, post_date: '2026-07-10',
              views: 200000, likes: 5000, comments: 500, saves: 300, shares: 200, post_url: 'https://example.test/1' }),
        // น้องบี: มีค่าตัว แพงกว่า (CPM 80 · CPE 6.67)
        SUB({ id: 2, account_name: 'น้องบี', person_key: 'pb', budget: 8000, ad_reach: 80000, post_date: '2026-07-12',
              views: 100000, likes: 1000, comments: 100, saves: 50, shares: 50, post_url: 'https://example.test/2' }),
        // น้องซี: ยังไม่ใส่ค่าตัว ยิงแอดไป 500 ยอดดีสุด — เดิม CPM/CPE ต่ำสุดจนได้ Good และคะแนนเต็ม
        SUB({ id: 3, account_name: 'น้องซี', person_key: 'pc', ad_spend: 500, ad_reach: 250000, post_date: '2026-07-15',
              views: 300000, likes: 9000, comments: 500, saves: 300, shares: 200, post_url: 'https://example.test/3' }),
        // น้องดี: ยังไม่ใส่ค่าตัว ยังไม่มีผลงาน ยังไม่ลงงาน
        SUB({ id: 4, account_name: 'น้องดี', person_key: 'pd' }),
        // ไม่นับ: ยังไม่คัดเลือก / ไม่เลือก
        SUB({ id: 5, account_name: 'รอคัด', status: 'submitted' }),
        SUB({ id: 6, account_name: 'ไม่เลือก', status: 'rejected' }),
        // น้องอี: ยังไม่ใส่ค่าตัว ลงงานก่อนช่วงวันที่ที่กรอง
        SUB({ id: 7, account_name: 'น้องอี', person_key: 'pe', post_date: '2026-01-10' }),
        // คนละแบรนด์ ยังไม่ใส่ค่าตัว
        SUB({ id: 8, project_id: 42, account_name: 'แบรนด์อื่น', views: 1000 }),
        // แคมเปญ 43: ทุกคนมีค่าตัว ER กับยอดวิวเท่ากัน ต่างกันแค่ค่าตัว
        // ถูกมาก: CPE = 100 / 25,000 = 0.004 ปัดเหลือ 0.00 · กลาง: 0.012 → 0.01 · แพงสุด: 0.2
        SUB({ id: 9, project_id: 43, account_name: 'ถูกมาก', person_key: 'j1', budget: 100, views: 100000, likes: 25000 }),
        SUB({ id: 10, project_id: 43, account_name: 'กลาง', person_key: 'j2', budget: 300, views: 100000, likes: 25000 }),
        SUB({ id: 11, project_id: 43, account_name: 'แพงสุด', person_key: 'j3', budget: 5000, views: 100000, likes: 25000 }),
        // แคมเปญ 44 (KOL รายคน · 1 การจ้าง = person_key เดียว): ได้ฟรียังไม่ยิงแอด / ได้ฟรียิงแอด 4,000 (ค่าตัว 0 = ไม่มี CPM/CPE) / มีค่าตัวยังไม่มีผลงาน
        SUB({ id: 12, project_id: 44, account_name: 'ฟรียังไม่ยิง', person_key: 'ps', ad_reach: 5000, views: 50000, likes: 500,
              post_url: 'https://example.test/12', post_date: '2026-10-02', group_key: 'g44', content_type: 'Review' }),
        SUB({ id: 13, project_id: 44, account_name: 'ฟรียิงแล้ว', person_key: 'ps', ad_spend: 4000, ad_reach: 100000, views: 200000, likes: 4000,
              post_url: 'https://example.test/13', post_date: '2026-10-02', group_key: 'g44', content_type: 'Review' }),
        SUB({ id: 14, project_id: 44, account_name: 'มีค่าตัว', person_key: 'ps', budget: 3000, platform: 'Instagram', group_key: 'g44', content_type: 'Reels' })
    ]
};

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
// dashboard.js / reports.js หยิบ loadSnapshot ออกไปตอน require — ต้องสลับก่อนโหลดสองไฟล์นี้
const { dashboard } = require(path.join(SRC, 'store/pg/dashboard'));
const { reports } = require(path.join(SRC, 'store/pg/reports'));
const kols = require(path.join(SRC, 'store/pg/kols'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));

test('Dashboard: totals unchanged, fee_missing_clips counts the same clips as total_spent, CPM uses fee clips only', async () => {
    const d = await dashboard.overview({ scopeBrands: ['Jdent'] });
    assert.equal(d.total_clips, 5);            // 1, 2, 3, 4, 7
    assert.equal(d.total_spent, 13000);
    assert.equal(d.total_views, 480000);       // reach ทุกคลิป รวมคลิปที่ยังไม่ใส่ค่าตัว
    assert.equal(d.fee_missing_clips, 3);      // 3, 4, 7
    assert.equal(d.cpm, 57);                   // 13,000 / (230,000 / 1000) — เดิมหารด้วย reach ทุกคลิปได้ 27
    // ช่วงวันลงงานตัดคลิปออกจากยอดรวมเท่าไหร่ ตัวนับก็ตัดเท่านั้น
    const ranged = await dashboard.overview({ scopeBrands: ['Jdent'], from: '2026-07-01' });
    assert.equal(ranged.total_clips, 4);
    assert.equal(ranged.fee_missing_clips, 2);
    assert.equal((await dashboard.overview({})).fee_missing_clips, 4);
    const none = await dashboard.overview({ scopeBrands: [] });
    assert.equal(none.fee_missing_clips, 0);
    assert.equal(none.cpm, 0);
});

test('Dashboard top KOLs: no fee = null CPM/CPE and nothing earned on the cost axes', async () => {
    const d = await dashboard.overview({ scopeBrands: ['Jdent'] });
    const by = name => d.top_kols.find(k => k.name === name);
    const part = (k, key) => k.score_parts.find(p => p.key === key);
    const a = by('น้องเอ'), b = by('น้องบี'), c = by('น้องซี');
    assert.deepEqual([c.fee_missing, c.cpm, c.cpe, c.fee, c.cost], [true, null, null, 0, 500]);
    assert.deepEqual([a.fee_missing, a.cpm, a.cpe], [false, 25, 0.83]);
    // ช่วงเทียบ CPM/CPE มาจากคนที่มีค่าตัวเท่านั้น: น้องเอถูกสุดได้เต็ม น้องบีแพงสุดได้ 0
    assert.deepEqual([part(a, 'cpm').earned, part(a, 'cpe').earned], [20, 20]);
    assert.deepEqual([part(b, 'cpm').earned, part(b, 'cpe').earned], [0, 0]);
    assert.deepEqual([part(c, 'cpm').earned, part(c, 'cpe').earned], [0, 0]);
    assert.deepEqual([part(c, 'cpm').note, part(c, 'cpe').note], ['ยังไม่ใส่ค่าตัว', 'ยังไม่ใส่ค่าตัว']);
    // น้องซี ER กับยอดวิวสูงสุด ได้ 35 + 25 = 60 (เดิมได้ 100)
    assert.equal(c.score, 60);
    assert.deepEqual(d.top_kols.filter(k => k.measured).map(k => k.name), ['น้องเอ', 'น้องซี', 'น้องบี']);
    assert.equal(by('น้องดี').score, null);
    assert.equal(by('น้องดี').fee_missing, true);
});

test('Report: rows without a fee get null CPM/CPE/performance; averages and Good count use fee clips only', async () => {
    const r = await reports.detail(41, ['Jdent']);
    assert.equal(r.kols.length, 5);
    assert.equal(r.campaign.used, 13000);
    assert.deepEqual(r.cost, {
        kol_cost: 13000, ads_cost: 500, avg_cpm: 52.5, avg_cpe: 3.75, total: 13500,
        fee_missing_clips: 3, fee_clips: 2
    });
    const by = name => r.kols.find(k => k.name === name);
    for (const name of ['น้องซี', 'น้องดี', 'น้องอี']) {
        const k = by(name);
        assert.deepEqual([k.fee_missing, k.cpm, k.cpe, k.performance], [true, null, null, null], name);
    }
    assert.deepEqual([by('น้องซี').cost, by('น้องซี').total_cost], [0, 500]);
    const a = by('น้องเอ');
    assert.deepEqual([a.fee_missing, a.cpm, a.cpe, a.performance], [false, 25, 0.83, 'Good']);
    assert.equal(by('น้องบี').performance, 'Improve');
    assert.ok(r.kols.every(k => typeof k.fee_missing === 'boolean'));
    // Good / ทั้งหมด = เฉพาะคลิปที่ตัดสินได้ (Good + Improve ในตาราง)
    assert.deepEqual(r.good_performance, { good: 1, total: 2 });
    // คะแนน: น้องซีได้แค่ ER + ยอดวิว · น้องดียังไม่มีผลงาน
    assert.equal(by('น้องซี').score, 60);
    assert.ok(a.score > by('น้องซี').score);
    assert.equal(by('น้องดี').score, null);
});

test('Dashboard and Report flag the same clips as missing a fee', async () => {
    const d = await dashboard.overview({ projectId: 41 });
    const r = await reports.detail(41, null);
    assert.equal(d.fee_missing_clips, r.cost.fee_missing_clips);
    const names = list => list.filter(k => k.fee_missing).map(k => k.name).sort();
    assert.deepEqual(names(d.top_kols), names(r.kols));
    assert.deepEqual(names(r.kols), ['น้องซี', 'น้องดี', 'น้องอี'].sort());
});

test('Dashboard top KOLs: a fee clip so cheap its CPE rounds to 0.00 still counts as the cheapest', async () => {
    const d = await dashboard.overview({ scopeBrands: ['Jarvit'] });
    const by = name => d.top_kols.find(k => k.name === name);
    const cpe = k => k.score_parts.find(p => p.key === 'cpe');
    // ก่อนรอบ 3 คนนี้ได้ CPE เต็ม 20 — คนที่มีค่าตัวต้องได้คะแนนเหมือนเดิม
    assert.deepEqual([by('ถูกมาก').fee_missing, by('ถูกมาก').cpe], [false, 0]);
    assert.deepEqual([cpe(by('ถูกมาก')).earned, cpe(by('กลาง')).earned, cpe(by('แพงสุด')).earned], [20, 19, 0]);
    assert.equal(by('ถูกมาก').score, 100);
    assert.deepEqual(d.top_kols.map(k => k.name), ['ถูกมาก', 'กลาง', 'แพงสุด']);
});

test('Influencer page: a clip without a fee is not judged Pass/Fail on ad cost alone', async () => {
    const { rows } = await kols.analytics(['Jdent']);
    const by = name => rows.find(r => r.kol_name === name);
    // น้องซี: เดิมคิดจากค่าแอด 500 อย่างเดียว ได้ CPM 1.67 / CPE 0.05 จนขึ้น Pass
    assert.deepEqual(
        (({ fee_missing, cpm, cpe, performance, total_cost }) => [fee_missing, cpm, cpe, performance, total_cost])(by('น้องซี')),
        [true, null, null, null, 500]);
    const a = by('น้องเอ');
    assert.deepEqual([a.fee_missing, a.cpm, a.cpe, a.performance], [false, 25, 0.83, 'Good']);
    assert.equal(by('น้องบี').performance, 'Improve');
    // น้องดียังไม่ลงงาน (ไม่มีลิงก์โพสต์) → ไม่ขึ้นหน้า Influencer List และไม่นับในตัวเลขสรุป
    assert.equal(by('น้องดี'), undefined);
});

test('Influencer page lists only people who have posted, and the summary counts only them', async () => {
    const { rows, summary } = await kols.analytics(['Jdent']);
    // ทุกแถวที่ขึ้นต้องมีลิงก์โพสต์ — คนที่ยังไม่ลงงานไม่ขึ้นเลย
    assert.ok(rows.length > 0);
    assert.ok(rows.every(r => r.post_url && String(r.post_url).trim() !== ''));
    assert.equal(summary.total_kols, rows.length);
    assert.equal(summary.budget, rows.reduce((s, r) => s + r.cost, 0));
    // ลิงก์เป็นช่องว่างล้วน = ยังไม่ลงงาน
    const saved = FIXTURE.submissions;
    FIXTURE.submissions = [...saved, SUB({ id: 99, account_name: 'ช่องว่าง', person_key: 'px', post_url: '   ', views: 10 })];
    try {
        assert.equal((await kols.analytics(['Jdent'])).rows.find(r => r.kol_name === 'ช่องว่าง'), undefined);
    } finally {
        FIXTURE.submissions = saved;
    }
});

test('KOL รายคนได้ฟรี: Dashboard / Report / Influencer / Ads ไม่นับเป็นรอค่าตัว · ไม่มีค่าตัวให้คิด = ยังไม่ตัดสิน (แม้ยิงแอดแล้ว)', async () => {
    const d = await dashboard.overview({ scopeBrands: ['Beauterry'] });
    assert.deepEqual([d.fee_missing_clips, d.total_spent, d.total_clips, d.total_kols], [0, 3000, 3, 1]);
    const dk = name => d.top_kols.find(k => k.name === name);
    const free = dk('ฟรียังไม่ยิง');
    assert.deepEqual([free.fee_missing, free.cpm, free.cpe, free.cost], [false, null, null, 0]);
    assert.deepEqual(free.score_parts.filter(p => p.key === 'cpm' || p.key === 'cpe').map(p => [p.earned, p.note]),
        [[0, 'ได้ฟรี ไม่มีค่าตัวให้คิด'], [0, 'ได้ฟรี ไม่มีค่าตัวให้คิด']]);
    // ได้ฟรีที่ยิงแอดแล้วก็ไม่มี CPM/CPE — สูตรใหม่ไม่เอาค่าแอดมาคิด (5 ต.ค. 2026) · cost ยังเป็นค่าแอดที่จ่ายจริง
    assert.deepEqual([dk('ฟรียิงแล้ว').fee_missing, dk('ฟรียิงแล้ว').cpm, dk('ฟรียิงแล้ว').cpe, dk('ฟรียิงแล้ว').cost], [false, null, null, 4000]);

    const r = await reports.detail(44, ['Beauterry']);
    const rk = name => r.kols.find(k => k.name === name);
    assert.deepEqual([rk('ฟรียังไม่ยิง').fee_missing, rk('ฟรียังไม่ยิง').cpm, rk('ฟรียังไม่ยิง').performance], [false, null, null]);
    assert.deepEqual([rk('ฟรียิงแล้ว').cpm, rk('ฟรียิงแล้ว').cpe, rk('ฟรียิงแล้ว').performance], [null, null, null]);
    assert.equal(rk('มีค่าตัว').performance, 'Improve');
    assert.deepEqual(r.good_performance, { good: 0, total: 1 }, 'ไม่นับคลิปที่ยังตัดสินไม่ได้');
    // ค่าเฉลี่ยใช้คลิปที่มีค่าตัว + มี reach + มี CPM — ฟรียิงแล้วไม่มี CPM · มีค่าตัวยังไม่มี reach = ไม่มีคลิปให้เฉลี่ย
    assert.deepEqual([r.cost.fee_missing_clips, r.cost.fee_clips, r.cost.avg_cpm, r.cost.avg_cpe], [0, 0, 0, 0]);
    // Format ต่อแถวอ่านของ Platform + Content Type ของคลิป (ไม่ใช่ค่าระดับกลุ่มที่เป็นของ Platform แรก)
    assert.deepEqual(r.kols.map(k => [k.name, k.platform, k.format]),
        [['ฟรียังไม่ยิง', 'TikTok', 'Review'], ['ฟรียิงแล้ว', 'TikTok', 'Review'], ['มีค่าตัว', 'Instagram', 'Unbox']]);

    const { rows: inf } = await kols.analytics(['Beauterry']);
    const ik = name => inf.find(x => x.kol_name === name);
    assert.deepEqual([ik('ฟรียังไม่ยิง').fee_missing, ik('ฟรียังไม่ยิง').cpm, ik('ฟรียังไม่ยิง').performance], [false, null, null]);
    assert.deepEqual([ik('ฟรียิงแล้ว').fee_missing, ik('ฟรียิงแล้ว').performance, ik('ฟรียิงแล้ว').stamp_wait_reason], [false, null, null]);

    const { rows: adRows } = await ads.list({ scopeBrands: ['Beauterry'] });
    const ak = name => adRows.find(x => x.account_name === name);
    assert.deepEqual([ak('ฟรียังไม่ยิง').fee_missing, ak('ฟรียังไม่ยิง').content_cpm, ak('ฟรียังไม่ยิง').performance], [false, null, null]);
    assert.deepEqual([ak('ฟรียิงแล้ว').content_cpm, ak('ฟรียิงแล้ว').performance, ak('ฟรียิงแล้ว').stamp_wait_reason], [null, null, null]);
});

test('Ads page: the live verdict waits for the fee too', async () => {
    const { rows } = await ads.list({ scopeBrands: ['Jdent'] });
    const by = name => rows.find(r => r.account_name === name);
    const c = by('น้องซี');
    assert.deepEqual([c.fee_missing, c.content_cpm, c.content_cpe, c.performance], [true, null, null, null]);
    const a = by('น้องเอ');
    assert.deepEqual([a.fee_missing, a.content_cpm, a.content_cpe, a.performance], [false, 25, 0.83, 'Good']);
});

test('Report (KOL รายคนหลาย Platform): Platform ที่ไม่ได้เลือก Format ได้ null — ไม่ยืม Format ระดับกลุ่มของ Platform แรก', async () => {
    const g = FIXTURE.projects.find(p => p.id === 44).ad_groups[0];
    const saved = structuredClone(g.allocations);
    // Instagram ไม่ได้เลือก Photo/VDO + Format · กลุ่มยังมีค่าระดับกลุ่ม (Review ของ TikTok) ค้างอยู่แบบกลุ่มที่บันทึกก่อนแก้
    g.allocations[1] = { ...g.allocations[1], media_type: null, content_format: null };
    try {
        const r = await reports.detail(44, ['Beauterry']);
        assert.deepEqual(r.kols.map(k => [k.platform, k.format]), [['TikTok', 'Review'], ['TikTok', 'Review'], ['Instagram', null]]);
    } finally {
        g.allocations = saved;
    }
});

test('ScoreModal: KOL รายคนได้ฟรี (ค่าตัว 0) อธิบายว่าไม่มีค่าตัวให้คิด — ไม่นับ CPM/CPE เป็นจุดอ่อน ไม่สรุปเรื่องความคุ้มค่า', async () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '../client/src/components/ScoreModal.jsx'), 'utf8');
    // ส่วนหัวของไฟล์ (ก่อนคอมโพเนนต์) เป็น JS ล้วน — B / N / verdict
    const verdict = new Function(src.slice(0, src.indexOf('/**')) + '; return verdict;')();
    const d = await dashboard.overview({ scopeBrands: ['Beauterry'] });
    const free = d.top_kols.find(k => k.name === 'ฟรียังไม่ยิง');
    assert.deepEqual([free.fee_missing, free.cpm, free.cpe], [false, null, null]);
    const lines = verdict(free);
    assert.equal(lines[0], 'ได้ฟรี (ค่าตัว 0) — CPM/CPE คิดจากค่าตัว จึงไม่มีตัวเลข คะแนนตอนนี้มาจาก Engagement Rate และยอดวิวเท่านั้น (เต็ม 60)');
    assert.ok(!lines.slice(1).some(t => /CPM|CPE/.test(t)), 'CPM/CPE ไม่ถูกนับเป็นจุดอ่อน: ' + JSON.stringify(lines));
    assert.ok(!lines.some(t => /ต้นทุน|คุ้ม/.test(t)), 'ไม่สรุปเรื่องความคุ้มค่า: ' + JSON.stringify(lines));
    // ได้ฟรีแต่ยิงแอดแล้ว = ก็ยังไม่มีค่าตัวให้คิด (สูตรใหม่ไม่เอาค่าแอดมาคิด) อธิบายแบบเดียวกัน · รอค่าตัวยังใช้ข้อความเดิม
    assert.match(verdict(d.top_kols.find(k => k.name === 'ฟรียิงแล้ว'))[0], /^ได้ฟรี \(ค่าตัว 0\)/);
    assert.match(verdict({ ...free, fee_missing: true })[0], /^ยังไม่ได้ใส่ค่าตัว/);
});
