const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// เกณฑ์สแตมป์แยกตามแบรนด์ — ตรวจว่าเส้นทางจริงทั้งขาอ่าน (ads.list) และขาเขียน (adsSync.apply)
// หยิบแบรนด์จาก projects.brand มาใช้จริง ไม่ใช่แค่ตัวฟังก์ชันคำนวณ · ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in stamp-sync test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

// แคมเปญ 2 ใบ: Beauterry (เกณฑ์ 3,000) กับ Dermiq (เกณฑ์ 10,000 ตามค่ากลาง)
const PROJECTS = [
    { id: 71, name: 'Beauterry campaign', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [] },
    { id: 72, name: 'Dermiq campaign', brand: 'Dermiq', team_id: 1, campaign_type: 'kol', ad_groups: [] }
];
// ข้อมูลครบทุกอย่างแล้ว (มียอดวิว มีค่าตัว) เหลือแค่ค่าแอดว่าถึงเกณฑ์ของแบรนด์ไหม
const SUB = over => ({
    project_id: 71, person_key: null, clip_no: 1, platform: 'TikTok', product: 'L3', agency: 'Agency A',
    status: 'confirmed', budget: 5000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 100000, likes: 1000, comments: 10, saves: 5, shares: 5, reposts: 0,
    post_url: 'https://example.invalid/p', link_account: null, post_date: '2026-09-02',
    group_key: null, content_type: 'Review', gencode: null, id_post: null, perf_stamp: null, ...over
});
const FIXTURE = {
    projects: PROJECTS,
    teams: [{ id: 1, name: 'ทีมทดสอบ' }],
    submissions: [
        SUB({ id: 1, project_id: 71, ad_spend: 3000, id_post: '900001' }),   // Beauterry ถึงเกณฑ์แล้ว
        SUB({ id: 2, project_id: 71, ad_spend: 2999, id_post: '900002' }),   // Beauterry ยังขาดอีกบาทเดียว
        SUB({ id: 3, project_id: 72, ad_spend: 3000, id_post: '900003' }),   // Dermiq ยังห่างเกณฑ์ 10,000
        SUB({ id: 4, project_id: 72, ad_spend: 10000, id_post: '900004' })   // Dermiq ถึงเกณฑ์
    ]
};

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
// adsSync.apply เขียนจริงผ่าน _base — ดักไว้ดูว่าเขียนอะไรบ้าง แทนที่จะไปแตะฐาน
const base = require(path.join(SRC, 'store/pg/_base'));
let written = [];
base.withTransaction = async fn => fn({ query: async () => ({ rows: [], rowCount: 0 }) });
base.updateRow = async (table, id, patch) => { written.push({ table, id, patch }); return { id, ...patch }; };

// ต้องสลับ loadSnapshot / _base ให้เสร็จก่อน require โมดูลที่หยิบไปเก็บไว้ตอนโหลด
const { ads, adsSync } = require(path.join(SRC, 'store/pg/ads'));
const kols = require(path.join(SRC, 'store/pg/kols'));

const byId = (rows, id) => rows.find(r => r.sub_id === id);

test('ads.list ส่งเกณฑ์ของแบรนด์ไปให้หน้าเว็บ (Beauterry 3,000 · แบรนด์อื่น 10,000)', async () => {
    const { rows } = await ads.list({});
    assert.equal(byId(rows, 1).stamp_at, 3000);
    assert.equal(byId(rows, 2).stamp_at, 3000);
    assert.equal(byId(rows, 3).stamp_at, 10000);
    assert.equal(byId(rows, 4).stamp_at, 10000);
});

test('ads.list คิด "รอสแตมป์" ด้วยเกณฑ์ของแบรนด์ ไม่ใช่ 10,000 ตายตัว', async () => {
    const { rows } = await ads.list({});
    // ข้อมูลครบอยู่แล้ว จึงไม่ได้ "รอ" อะไร — ตัวที่ต้องดูคือแถวที่ขาดค่าตัว
    const fixture = structuredClone(FIXTURE.submissions);
    FIXTURE.submissions.forEach(s => { s.budget = 0; });
    const noFee = (await ads.list({})).rows;
    assert.equal(byId(noFee, 1).stamp_waiting, true, 'Beauterry 3,000 ต้องนับว่าถึงเกณฑ์แล้วและรอค่าตัว');
    assert.equal(byId(noFee, 1).stamp_wait_reason, 'fee');
    assert.equal(byId(noFee, 2).stamp_waiting, false, 'Beauterry 2,999 ยังไม่ถึงเกณฑ์');
    assert.equal(byId(noFee, 3).stamp_waiting, false, 'Dermiq 3,000 ยังไม่ถึงเกณฑ์ 10,000');
    assert.equal(byId(noFee, 4).stamp_waiting, true, 'Dermiq 10,000 ถึงเกณฑ์แล้ว');
    FIXTURE.submissions = fixture;
    assert.equal(byId(rows, 1).stamp_waiting, false);
});

test('ซิงก์ PFM สแตมป์แถว Beauterry ที่ค่าแอดถึง 3,000 แต่ไม่แตะแถวแบรนด์อื่นที่ยังไม่ถึง 10,000', async () => {
    written = [];
    const out = await adsSync.apply([
        { id_post: '900001', ad_spend: 3000 },
        { id_post: '900002', ad_spend: 2999 },
        { id_post: '900003', ad_spend: 3000 },
        { id_post: '900004', ad_spend: 10000 }
    ]);
    assert.equal(out.updated, 4);
    assert.equal(out.stamped, 2, 'ต้องสแตมป์ 2 แถว: Beauterry 3,000 และ Dermiq 10,000');
    const stampedIds = written.filter(w => w.patch.perf_stamp).map(w => w.id).sort((a, b) => a - b);
    assert.deepEqual(stampedIds, [1, 4]);
    const first = JSON.parse(written.find(w => w.id === 1).patch.perf_stamp);
    assert.equal(first.ad_spend, 3000);
    assert.equal(first.total_cost, 8000);        // ค่าตัว 5,000 + ค่าแอด 3,000
});

test('หน้า Influencers ส่งเกณฑ์ของแบรนด์ไปด้วยเหมือนกัน', async () => {
    const { rows } = await kols.analytics(null);
    assert.equal(byId(rows, 1).stamp_at, 3000);
    assert.equal(byId(rows, 3).stamp_at, 10000);
});
