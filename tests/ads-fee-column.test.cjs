const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Ads คอลัมน์ BUDGET = ค่าตัว KOL ของคลิป (ผู้ใช้สั่ง 2 พ.ย. 2026) — ดูอย่างเดียว ทีมใส่ที่หน้าแคมเปญ
// แถวส่ง fee (ตัวเลข) + fee_missing / fee_free เดิม · ไม่ปิดตามสิทธิ์ (เหมือนหน้า KOL Analytics) — ที่ปิดยังเป็นค่าแอด / CPM เท่านั้น
// ใช้ข้อมูลจำลองในหน่วยความจำ — ฐานข้อมูลของระบบคือ production ห้ามแตะ
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ads-fee-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ads-fee-column test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const SUB = over => ({
    project_id: 91, group_key: 'gA', person_key: null, clip_no: 1, platform: 'TikTok', product: 'BTA4-01', agency: 'A', status: 'confirmed',
    budget: 0, fee_free: false, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: '2026-10-30', content_type: 'Review', gencode: '#G', id_post: null,
    perf_stamp: null, ad_synced_at: null, post_check: null, ...over
});
const FIXTURE = {
    projects: [
        { id: 91, name: 'KOL Nov', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [{ key: 'gA', platform: 'TikTok', platforms: ['TikTok'] }] },
        { id: 92, name: 'KOL รายคน', brand: 'Beauterry', team_id: 1, campaign_type: 'solo', ad_groups: [{ key: 'gA', platform: 'TikTok', platforms: ['TikTok'] }] }
    ],
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        SUB({ id: 1, budget: 3500 }),                         // ใส่ค่าตัวแล้ว
        SUB({ id: 2 }),                                       // ยังไม่ใส่
        SUB({ id: 3, fee_free: true }),                       // แคมเปญ KOL ยืนยันว่าได้ฟรี
        SUB({ id: 4, project_id: 92 }),                       // KOL รายคน ค่าตัว 0 = ฟรี
        SUB({ id: 5, budget: '1500.50' })                     // numeric จาก pg มาเป็นข้อความ
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
const { ads } = require(path.join(SRC, 'store/pg/ads'));

test('ads.list: แถวมี fee = ค่าตัวของคลิป (ตัวเลข) และป้ายรอค่าตัว / ฟรีเหมือนเดิม', async () => {
    const { rows } = await ads.list({});
    const by = Object.fromEntries(rows.map(r => [r.sub_id, r]));
    assert.deepEqual(Object.keys(by).map(Number).sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual([by[1].fee, by[1].fee_missing, by[1].fee_free], [3500, false, false]);
    assert.deepEqual([by[2].fee, by[2].fee_missing, by[2].fee_free], [0, true, false], 'ยังไม่ใส่ = รอค่าตัว');
    assert.deepEqual([by[3].fee, by[3].fee_missing, by[3].fee_free], [0, false, true], 'ยืนยันฟรี = ไม่ใช่รอค่าตัว');
    assert.deepEqual([by[4].fee, by[4].fee_missing, by[4].fee_free], [0, false, true], 'KOL รายคน 0 = ฟรี');
    assert.equal(by[5].fee, 1500.5, 'numeric ที่มาเป็นข้อความกลายเป็นตัวเลข');
});

// ---------------------------------------------------------------- เส้น GET /api/ads ตามสิทธิ์
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'member1', full_name: 'Member', role: 'member', status: 'active', is_active: true, team_id: 1, brands: [] }
};
let server, base;
before(async () => {
    store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริงก่อนจบ — ไม่งั้น --test-force-exit (build.cjs ตอน deploy) บน Windows แครช libuv UV_HANDLE_CLOSING
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const tokenOf = a => jwt.sign({ id: a.id, username: a.username, role: a.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const getAds = async who => {
    const res = await fetch(base + '/api/ads', { headers: { Authorization: 'Bearer ' + tokenOf(ACCOUNTS[who]) } });
    assert.equal(res.status, 200);
    return (await res.json()).data;
};

test('GET /api/ads: member เห็น BUDGET (ค่าตัว) แต่ค่าแอด / CPM ยังถูกปิด · admin เห็นทั้งหมด', async () => {
    store.ads.list = async () => ({
        rows: [{ sub_id: 1, platform: 'TikTok', post_url: 'https://www.tiktok.com/@x/video/1', fee: 3500, fee_missing: false, ad_spend: 900, cpm: 12, content_cpm: 3 }],
        summary: { total_spend: 900, cpm: 12, cpe: 1, by_brand: [], by_month: [] }
    });
    const mem = await getAds(2);
    assert.equal(mem.rows[0].fee, 3500, 'ค่าตัวไม่ใช่ข้อมูลลับ (หน้า KOL Analytics ก็เห็น)');
    assert.deepEqual([mem.rows[0].ad_spend, mem.rows[0].cpm, mem.rows[0].content_cpm], [null, null, null], 'ค่าแอด / CPM ยังปิดเหมือนเดิม');
    const adm = await getAds(1);
    assert.deepEqual([adm.rows[0].fee, adm.rows[0].ad_spend], [3500, 900]);
});
