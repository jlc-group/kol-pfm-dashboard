const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

// หน้า Ads คอลัมน์ DAY LEFT (ผู้ใช้สั่ง 10 พ.ย. 2026 — "เอาคอลัมน์นี้ไปไว้ในหน้า Ads ต่อจากระยะเวลายิง")
// วัน Gencode ที่เหลือ = วันลงโพสต์ + อายุ Gencode − วันนี้ · สูตรเดียวกับหน้า KOL Analytics (logic.js gencodeDayLeft)
// ใช้ข้อมูลจำลองในหน่วยความจำ — ฐานข้อมูลของระบบคือ production ห้ามแตะ
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ads-dayleft-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ads-day-left test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// วันที่ตามเวลาท้องถิ่น (ตรงกับที่ server แปลง 'YYYY-MM-DD' + 'T00:00:00')
const pad = n => String(n).padStart(2, '0');
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const BLOCKS = [{ platform: 'TikTok', products: ['BTA4-01'] }];
const SUB = over => ({
    project_id: 91, group_key: 'gA', person_key: null, clip_no: 1, platform: 'TikTok', product: 'BTA4-01', agency: 'A', status: 'confirmed',
    budget: 1000, fee_free: false, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: daysAgo(10), content_type: 'Review', gencode: '#G', id_post: null, code_expire: 60,
    perf_stamp: null, ad_synced_at: null, post_check: null, gen_date: null, ad_end: null, link_account: null, ...over
});
const FIXTURE = {
    projects: [{
        id: 91, name: 'KOL Nov', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', status: 'Active', start_date: '2026-10-01',
        ad_groups: [
            { key: 'gA', platform: 'TikTok', platforms: ['TikTok'], code_expire: 60, blocks: BLOCKS },
            { key: 'gNone', platform: 'TikTok', platforms: ['TikTok'], code_expire: 60, no_gencode: true, blocks: BLOCKS }
        ]
    }],
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        SUB({ id: 1 }),                                                 // 60 วัน ลง 10 วันก่อน → เหลือ 50
        SUB({ id: 2, code_expire: 30, post_date: daysAgo(25) }),         // เหลือ 5 (แดง)
        SUB({ id: 3, code_expire: 30, post_date: daysAgo(40) }),         // ติดลบ = หมดอายุแล้ว
        SUB({ id: 4, post_date: null }),                                 // ไม่มีวันลงโพสต์ → null
        SUB({ id: 5, group_key: 'gNone', gencode: null }),               // กลุ่ม "-" ไม่มี Gencode → null + no_gencode
        SUB({ id: 6, group_key: 'gNone', gencode: 'KEEP1' }),            // กลุ่ม "-" แต่มี Gencode เดิม → นับปกติ
        SUB({ id: 7, code_expire: '45' })                                // pg ส่งตัวเลขมาเป็นข้อความ
    ]
};
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
const pgBase = require(path.join(SRC, 'store/pg/_base'));
pgBase.query = async () => ({ rows: [] });
const logic = require(path.join(SRC, 'store/logic'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const kols = require(path.join(SRC, 'store/pg/kols'));

let dl;
before(async () => {
    dl = await import(pathToFileURL(path.join(__dirname, '../client/src/data/dayLeft.js')).href);
});

test('logic.gencodeDayLeft: วันลงโพสต์ + จำนวนวัน − วันนี้ ปัดขึ้น · ข้อมูลไม่ครบ = null', () => {
    const today = new Date('2026-11-10T09:00:00');
    assert.equal(logic.gencodeDayLeft('2026-11-01', 60, today), 51);     // ครบกำหนด 31 ธ.ค.
    assert.equal(logic.gencodeDayLeft('2026-09-12', 60, today), 1);      // ครบกำหนดพรุ่งนี้ (11 พ.ย.)
    assert.ok(logic.gencodeDayLeft('2026-09-11', 60, today) === 0);      // วันครบกำหนด (10 พ.ย.) = 0 Days (ได้ -0 · JSON ส่งเป็น 0)
    assert.equal(logic.gencodeDayLeft('2026-09-10', 60, today), -1);     // เลยมา 1 วัน = หมดอายุแล้ว
    assert.equal(logic.gencodeDayLeft(null, 60, today), null);
    assert.equal(logic.gencodeDayLeft('2026-11-01', 0, today), null);
    assert.equal(logic.gencodeDays({ code_expire: '45' }, false), 45);
    assert.equal(logic.gencodeDays({ code_expire: 60 }, true), 0);
    assert.equal(logic.gencodeDays({ code_expire: null }, false), 0);
});

test('ads.list: แถวมี day_left / gencode_days ตามกติกาเดียวกับหน้า KOL Analytics', async () => {
    const { rows } = await ads.list({});
    const by = Object.fromEntries(rows.map(r => [r.sub_id, r]));
    assert.deepEqual([by[1].gencode_days, by[1].day_left], [60, 50]);
    assert.deepEqual([by[2].gencode_days, by[2].day_left], [30, 5]);
    assert.ok(by[3].day_left < 0, 'เลยกำหนดแล้ว = ติดลบ');
    assert.equal(by[4].day_left, null, 'ไม่มีวันลงโพสต์ = ไม่มีตัวเลข');
    assert.deepEqual([by[5].no_gencode, by[5].gencode_days, by[5].day_left], [true, 0, null]);
    assert.deepEqual([by[6].no_gencode, by[6].day_left], [false, 50]);
    assert.deepEqual([by[7].gencode_days, by[7].day_left], [45, 35]);
});

test('ads.list กับ kols.analytics ได้ Day Left ตรงกันทุกแถว (ตัวเลขเดียวกันทั้งสองหน้า)', async () => {
    const a = Object.fromEntries((await ads.list({})).rows.map(r => [r.sub_id, [r.day_left, r.no_gencode]]));
    const k = Object.fromEntries((await kols.analytics(null)).rows.filter(r => r.post_url).map(r => [r.sub_id, [r.day_left, r.no_gencode]]));
    // kols นับเฉพาะ status confirmed + มีลิงก์ — fixture ทุกแถวเข้าเงื่อนไข
    assert.deepEqual(Object.keys(k).sort(), Object.keys(a).sort());
    for (const id of Object.keys(a)) assert.deepEqual(a[id], k[id], 'sub ' + id);
});

test('client dayLeftLevel: สีเดียวกับหน้า KOL Analytics · ไม่ใช้ / ไม่มีข้อมูลแยกกัน', () => {
    assert.equal(dl.dayLeftLevel(50), 'green');
    assert.equal(dl.dayLeftLevel(21), 'green');
    assert.equal(dl.dayLeftLevel(20), 'amber');
    assert.equal(dl.dayLeftLevel(10), 'amber');
    assert.equal(dl.dayLeftLevel(9), 'red');
    assert.equal(dl.dayLeftLevel(0), 'red');
    assert.equal(dl.dayLeftLevel(-0), 'red');
    assert.equal(dl.dayLeftLevel(-1), 'over');
    assert.equal(dl.dayLeftLevel(null), 'unknown');
    assert.equal(dl.dayLeftLevel(undefined), 'unknown', 'server รุ่นก่อนไม่ส่งคีย์ = "—" ไม่ใช่ 0');
    assert.equal(dl.dayLeftLevel(5, true), 'none');
});

test('client gencodeExpireDate: วันลงโพสต์ + จำนวนวัน (ข้ามเดือน/ปีถูก) · ข้อมูลไม่ครบ = null', () => {
    assert.equal(dl.gencodeExpireDate('2026-11-01', 60), '2026-12-31');
    assert.equal(dl.gencodeExpireDate('2026-12-15', 30), '2027-01-14');
    assert.equal(dl.gencodeExpireDate('2026-11-01', 0), null);
    assert.equal(dl.gencodeExpireDate(null, 60), null);
    assert.equal(dl.gencodeExpireDate('2026-11-01', undefined), null);
});

test('client sortByDayLeft: ↑ ใกล้หมดก่อน · ↓ เหลือเยอะก่อน · ไม่มีวันอยู่ท้ายเสมอ · ค่าเท่ากันคงลำดับเดิม', () => {
    const rows = [
        { sub_id: 'a', day_left: 30 }, { sub_id: 'n1', day_left: null }, { sub_id: 'b', day_left: -2 },
        { sub_id: 'c', day_left: 5 }, { sub_id: 'x', day_left: 7, no_gencode: true }, { sub_id: 'd', day_left: 5 },
        { sub_id: 'u' }
    ];
    const ids = list => list.map(r => r.sub_id).join(',');
    assert.equal(ids(dl.sortByDayLeft(rows, 'asc')), 'b,c,d,a,n1,x,u');
    assert.equal(ids(dl.sortByDayLeft(rows, 'desc')), 'a,c,d,b,n1,x,u');
    assert.equal(dl.sortByDayLeft(rows, ''), rows, 'ไม่เรียง = ลำดับเดิมตัวเดิม');
    assert.deepEqual(dl.sortByDayLeft(null, 'asc'), []);
    assert.equal(ids(rows), 'a,n1,b,c,x,d,u', 'ไม่แก้ลำดับของอาร์เรย์เดิม');
});
