const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ป๊อปอัปการ์ดหน้า Overview (ผู้ใช้สั่ง 13 พ.ย. 2026) — dashboard.details ต้องใช้ข้อมูลชุดเดียวกับ dashboard.overview
// ผลรวมของแต่ละมุม (แคมเปญ / แบรนด์ / Platform / Tier) ต้องเท่าตัวเลขบนการ์ดพอดี · ไม่มีฐานข้อมูล
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in overview-details test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const SUB = fields => ({
    project_id: 1, person_key: null, clip_no: 1, platform: 'TikTok', product: 'L10', tier: 'Nano 1k - 10k',
    status: 'confirmed', budget: 0, ad_spend: 0, ad_reach: 0, views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: null, post_date: null, fee_free: false, ...fields
});
const FIXTURE = {
    projects: [
        { id: 1, name: 'Beauterry Oct', brand: 'Beauterry', budget: 100000, kol_target: 5, status: 'Active', campaign_type: 'kol',
          created_at: '2026-10-01T00:00:00.000Z', start_date: '2026-10-01', end_date: '2026-10-31' },
        { id: 2, name: 'Beauterry Nov', brand: 'Beauterry', budget: 50000, status: 'Draft', campaign_type: 'kol',
          created_at: '2026-11-01T00:00:00.000Z', start_date: '2026-11-01', end_date: null },
        { id: 3, name: 'Jernis Nov', brand: 'Jernis', budget: 80000, status: 'Active', campaign_type: 'kol',
          created_at: '2026-11-02T00:00:00.000Z', start_date: '2026-11-01', end_date: '2026-11-30' },
        { id: 4, name: 'KOL รายคน · @free', brand: 'Jernis', budget: 0, status: 'Completed', campaign_type: 'solo',
          created_at: '2026-11-03T00:00:00.000Z', start_date: '2026-11-05', end_date: '2026-11-05' },
        { id: 5, name: 'แบรนด์ที่ไม่มีสิทธิ์', brand: 'Jarvit', budget: 999999, status: 'Active', campaign_type: 'kol',
          created_at: '2026-11-04T00:00:00.000Z' }
    ],
    submissions: [
        // คนเดียว (pa) 2 คลิปคนละ Platform
        SUB({ id: 1, account_name: 'น้องเอ', person_key: 'pa', budget: 5000, ad_reach: 200000, views: 250000, likes: 5000, post_date: '2026-10-10', post_url: 'https://example.test/1' }),
        SUB({ id: 2, account_name: 'น้องเอ', person_key: 'pa', platform: 'Instagram', budget: 3000, ad_reach: 50000, views: 60000, likes: 600, post_date: '2026-10-12', post_url: 'javascript:alert(1)' }),
        // ยังไม่ใส่ค่าตัว มี Reach — ไม่นำมาคิด CPM แต่ Reach นับในยอดวิวรวม
        SUB({ id: 3, account_name: 'น้องบี', person_key: 'pb', ad_reach: 300000, views: 400000, likes: 8000, post_date: '2026-10-15', tier: 'Micro 10k - 100k' }),
        // ยังไม่ลงงาน ไม่มี Reach
        SUB({ id: 4, account_name: 'น้องซี', person_key: 'pc', budget: 2000, tier: '' }),
        // นอกช่วงวัน (ใช้เทสต์ตัวกรองวันที่)
        SUB({ id: 5, project_id: 3, account_name: 'น้องดี', person_key: 'pd', budget: 10000, ad_reach: 100000, views: 120000, likes: 1200, post_date: '2026-11-10', tier: 'Micro 10k - 100k' }),
        // KOL รายคนได้ฟรี — ไม่ใช่รอค่าตัว · ไม่มี CPM
        // KOL รายคนได้ฟรี = ค่าตัว 0 · ช่อง fee_free เป็น false เสมอ (PUT fee-free ไม่รับแคมเปญ solo) — รูปเดียวกับข้อมูลจริง
        SUB({ id: 6, project_id: 4, account_name: 'ฟรี', person_key: 'pf', fee_free: false, ad_reach: 40000, views: 50000, likes: 500, post_date: '2026-11-05' }),
        // ไม่นับ: ยังไม่คัดเลือก / แบรนด์ที่ไม่มีสิทธิ์
        SUB({ id: 7, account_name: 'รอคัด', status: 'submitted', budget: 9999, ad_reach: 999999 }),
        SUB({ id: 8, project_id: 5, account_name: 'นอกสิทธิ์', person_key: 'px', budget: 7777, ad_reach: 777777, post_date: '2026-11-01' })
    ]
};

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
const { dashboard } = require(path.join(SRC, 'store/pg/dashboard'));

const SCOPE = ['Beauterry', 'Jernis'];
const sum = (list, k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);

// ตัวกรองหลายแบบ — ทุกแบบผลรวมของป๊อปอัปต้องเท่าการ์ด
const CASES = [
    { scopeBrands: SCOPE },
    { scopeBrands: SCOPE, brand: 'Beauterry' },
    { scopeBrands: SCOPE, from: '2026-11-01' },
    { scopeBrands: SCOPE, projectId: '3' },
    { scopeBrands: null }
];

for (const f of CASES) {
    test(`details reconciles with overview cards · ${JSON.stringify(f)}`, async () => {
        const o = await dashboard.overview(f);
        const d = await dashboard.details(f);
        const t = d.totals;
        // การ์ดสรุป
        assert.equal(t.clips, o.total_clips);
        assert.equal(t.kols, o.total_kols);
        assert.equal(t.fee, o.total_spent);
        assert.equal(t.reach, o.total_views);
        assert.equal(t.fee_missing, o.fee_missing_clips);
        assert.equal(t.avg_cost, o.avg_cost_per_clip);
        assert.equal(t.cpm, o.cpm);
        assert.equal(t.cpe, o.cpe);
        // การ์ดงบ: แคมเปญในตัวกรอง = งบรวม / จำนวนแคมเปญ / ค่าจ้าง / คลิปรอค่าตัว
        const inF = d.campaigns.filter(c => c.in_filter);
        assert.equal(inF.length, o.total_campaigns);
        assert.equal(sum(inF, 'budget'), o.total_budget);
        assert.equal(sum(inF, 'fee'), o.total_spent);
        assert.equal(sum(inF, 'clips'), o.total_clips);
        assert.equal(sum(inF, 'fee_missing'), o.fee_missing_clips);
        // การ์ด Campaign ทั้งหมด = ทุกแคมเปญตามสิทธิ์ (ไม่ขึ้นกับตัวกรองแบรนด์)
        assert.deepEqual(d.campaigns.map(c => c.id), o.campaigns.map(c => c.id));
        // แถบงบตามแบรนด์
        assert.deepEqual(d.brands.map(b => [b.brand, b.budget, b.kols]), o.brand_summary.map(b => [b.brand, b.budget, b.kols_count]));
        assert.equal(sum(d.brands, 'reach'), o.total_views);
        // การ์ด Platform
        const plat = Object.fromEntries(d.platforms.map(p => [p.platform, p]));
        for (const p of o.platforms) {
            assert.equal(plat[p.platform].kols, p.kols_count, p.platform + ' kols');
            assert.equal(plat[p.platform].clips, p.clips_count, p.platform + ' clips');
            assert.equal(plat[p.platform].reach, p.views, p.platform + ' reach');
            assert.equal(plat[p.platform].avg_cost, p.avg_cost, p.platform + ' avg');
            assert.equal(plat[p.platform].engagement, p.engagement, p.platform + ' engagement');
            assert.equal(sum(plat[p.platform].brands, 'clips'), p.clips_count);
            assert.equal(sum(plat[p.platform].tiers, 'clips'), p.clips_count);
        }
        assert.equal(d.platforms.length, o.platforms.length);
        // Tier รวมทุกคลิป
        assert.equal(sum(d.tiers, 'clips'), o.total_clips);
        assert.equal(sum(d.tiers, 'fee'), o.total_spent);
    });
}

test('details: scope never leaks — campaigns / clips of brands without permission are left out', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE });
    assert.ok(!d.campaigns.some(c => c.brand === 'Jarvit'));
    assert.ok(!d.top_reach.some(c => c.id === 8 || c.id === 7));
    assert.equal(d.totals.reach, 200000 + 50000 + 300000 + 100000 + 40000);
    const none = await dashboard.details({ scopeBrands: [] });
    assert.equal(none.campaigns.length, 0);
    assert.equal(none.totals.clips, 0);
    assert.equal(none.totals.cpm, null);
});

test('details: brand filter keeps every permitted campaign in the list but marks only that brand in_filter', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE, brand: 'Jernis' });
    assert.deepEqual(d.campaigns.filter(c => c.in_filter).map(c => c.id).sort(), [3, 4]);
    assert.equal(d.campaigns.length, 4);
    assert.deepEqual(d.brands.map(b => b.brand), ['Jernis']);
});

test('details: date range filters clips per campaign (unposted clips still count)', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE, from: '2026-11-01' });
    const c1 = d.campaigns.find(c => c.id === 1);
    assert.equal(c1.clips, 1);              // คลิป 4 ยังไม่ลงงาน · คลิป 1-3 ลงก่อนช่วง
    assert.equal(c1.fee, 2000);
    assert.equal(d.campaigns.find(c => c.id === 3).clips, 1);
});

test('details: CPM per row uses fee clips only · free / no-reach rows are null, never ฿0', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE });
    const c1 = d.campaigns.find(c => c.id === 1);
    // ค่าตัวคลิปที่ใส่แล้ว 5,000 + 3,000 + 2,000 ÷ Reach ของคลิปเหล่านั้น (200,000 + 50,000 + 0) — คลิป 3 รอค่าตัวไม่นับ
    assert.equal(c1.cpm, Math.round(10000 / 250));
    assert.equal(c1.fee_missing, 1);
    assert.equal(c1.no_reach, 1);
    assert.equal(d.campaigns.find(c => c.id === 4).cpm, null);     // ได้ฟรีทั้งแคมเปญ
    assert.equal(d.campaigns.find(c => c.id === 2).cpm, null);     // ยังไม่มีคลิป
    // คลิปถูก / แพงสุด: เฉพาะคลิปที่ใส่ค่าตัวแล้ว + มี Reach
    const ids = d.cpm_best.map(c => c.id);
    assert.ok(!ids.includes(3) && !ids.includes(4) && !ids.includes(6));
    assert.deepEqual(d.cpm_best.map(c => c.id), [1, 2, 5]);       // 25 · 60 · 100
    assert.deepEqual(d.cpm_worst.map(c => c.id), []);            // คลิปน้อยกว่า 10 — แพงสุดไม่ซ้ำกับถูกสุด
    assert.equal(d.cpm_best[0].cpm, 25);
    // Top Reach เรียงมากไปน้อย
    assert.deepEqual(d.top_reach.slice(0, 3).map(c => c.id), [3, 1, 5]);
});

test('details: KOL รายคนค่าตัว 0 ขึ้น "ได้ฟรี" ในรายการคลิปเหมือนตาราง Top Influencer (ไม่ใช่ ฿0 / รอค่าตัว)', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE });
    const free = d.top_reach.find(c => c.id === 6);
    assert.equal(free.fee_free, true);
    assert.equal(free.fee_missing, false);
    assert.equal(free.cpm, null);
    const o = await dashboard.overview({ scopeBrands: SCOPE });
    assert.equal(o.top_kols.find(k => k.kol_id === 6).fee_free, true);
    // ทั้งแคมเปญได้ฟรี = CPM คิดไม่ได้ ทั้งการ์ดและป๊อปอัปเป็น null (การ์ดขึ้น "—")
    const solo = { scopeBrands: SCOPE, projectId: '4' };
    assert.equal((await dashboard.overview(solo)).cpm, null);
    assert.equal((await dashboard.details(solo)).totals.cpm, null);
});

test('details: 10+ priced clips — cheapest / dearest 5 never overlap', async () => {
    const saved = FIXTURE.submissions;
    FIXTURE.submissions = Array.from({ length: 12 }, (_, i) => SUB({ id: 100 + i, account_name: 'k' + i, person_key: 'k' + i, budget: 1000 * (i + 1), ad_reach: 100000, post_date: '2026-10-10' }));
    try {
        const d = await dashboard.details({ scopeBrands: SCOPE });
        assert.deepEqual(d.cpm_best.map(c => c.id), [100, 101, 102, 103, 104]);
        assert.deepEqual(d.cpm_worst.map(c => c.id), [111, 110, 109, 108, 107]);
        FIXTURE.submissions = FIXTURE.submissions.slice(0, 7);
        const d7 = await dashboard.details({ scopeBrands: SCOPE });
        assert.deepEqual(d7.cpm_worst.map(c => c.id), [106, 105]);
    } finally { FIXTURE.submissions = saved; }
});

test('details: tiers group blank tier as "ไม่ระบุ Tier"', async () => {
    const d = await dashboard.details({ scopeBrands: SCOPE });
    const blank = d.tiers.find(t => t.tier === 'ไม่ระบุ Tier');
    assert.equal(blank.clips, 1);
    assert.equal(blank.fee, 2000);
});

test('overview top_kols carry every clip of that person in the filter (person popup)', async () => {
    const o = await dashboard.overview({ scopeBrands: SCOPE });
    const a = o.top_kols.find(k => k.kol_id === 1);
    assert.equal(a.person_key, 'pa');
    assert.deepEqual(a.clips.map(c => c.kol_id).sort(), [1, 2]);
    assert.equal(a.project_name, 'Beauterry Oct');
    assert.equal(a.clips.find(c => c.kol_id === 2).platform, 'Instagram');
    // คนที่ไม่มี person_key ยังได้คลิปของตัวเอง
    const ranged = await dashboard.overview({ scopeBrands: SCOPE, from: '2026-10-11' });
    const a2 = ranged.top_kols.find(k => k.kol_id === 2);
    assert.deepEqual(a2.clips.map(c => c.kol_id), [2]);            // คลิป 1 อยู่นอกช่วง
});
