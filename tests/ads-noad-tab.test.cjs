const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// หน้า Ads แยกแท็บ "ไม่ต้องยิงแอด / ไม่ใช้ Gencode" (ผู้ใช้สั่ง 5 ต.ค. 2026)
// การ์ดสรุปนับเฉพาะคลิปที่ต้องยิง · ฟีดที่ PFM ดึงไปยิงแอดตัดคลิปในกลุ่มที่ไม่ใช้ Gencode · ข้อมูลจำลอง ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ads-noad-tab test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const SUB = over => ({
    project_id: 91, person_key: null, clip_no: 1, platform: 'TikTok', product: 'BTA4-01', agency: 'A', status: 'confirmed',
    budget: 2000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: '2026-10-01', content_type: 'Review', gencode: null, id_post: null,
    perf_stamp: null, ad_synced_at: null, post_check: null, ...over
});
const FIXTURE = {
    projects: [{ id: 91, name: 'Beauterry Oct', brand: 'Beauterry', team_id: 1, campaign_type: 'kol',
        ad_groups: [{ key: 'gA', platform: 'TikTok', platforms: ['TikTok'] }, { key: 'gN', platform: 'Instagram', platforms: ['Instagram'], no_gencode: true }] }],
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        SUB({ id: 1, group_key: 'gA', gencode: '#A1', ad_status: 'ยิงแล้ว', ad_spend: 1000, ad_reach: 5000, budget: 3000, likes: 100 }),
        SUB({ id: 2, group_key: 'gA', gencode: '#A2' }),
        SUB({ id: 3, group_key: 'gN', platform: 'Instagram' }),                                     // ไม่ต้องยิง
        SUB({ id: 4, group_key: 'gN', platform: 'Instagram', ad_spend: 400, ad_reach: 900, likes: 50 }), // ไม่ต้องยิง แต่มีค่าแอด
        SUB({ id: 5, group_key: 'gN', platform: 'Instagram', gencode: 'adcode-x' })                  // กลุ่มไม่ใช้ Gencode แต่มี Gencode → ต้องยิง
    ]
};
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
const base = require(path.join(SRC, 'store/pg/_base'));
const seenSql = [];
base.query = async (text, params) => { seenSql.push({ text, params }); return { rows: [] }; };
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const { contentExport } = require(path.join(SRC, 'store/pg/contentExport'));

test('ads.list: แถวส่งครบทุกคลิป (มี no_gencode) แต่การ์ดสรุปนับเฉพาะคลิปที่ต้องยิง', async () => {
    const { rows, summary } = await ads.list({});
    assert.equal(rows.length, 5, 'แถวทั้งหมดยังส่งไป หน้าเว็บแยกแท็บเอง');
    assert.deepEqual(rows.filter(r => r.no_gencode).map(r => r.sub_id).sort(), [3, 4]);
    assert.equal(summary.total_posts, 3);
    assert.equal(summary.no_gencode_posts, 2);
    assert.equal(summary.done_count, 1);
    assert.equal(summary.pending_count, 2);
    assert.equal(summary.total_spend, 1000, 'ค่าแอดของคลิปไม่ต้องยิงไม่รวมในการ์ด');
    assert.equal(summary.total_reach, 5000);
    assert.equal(summary.eng_posts, 1);
    assert.equal(summary.cpe, 40, '(3000 + 1000) / 100 — ไม่เอาคลิปไม่ต้องยิงมาคิด');
    assert.deepEqual(summary.by_brand.map(b => [b.brand, b.posts, b.spend]), [['Beauterry', 3, 1000]]);
});

test('ฟีดที่ PFM ดึงไปยิงแอด: SQL ตัดคลิปในกลุ่มที่ไม่ใช้ Gencode (กลุ่ม no_gencode = true และยังไม่มี Gencode)', async () => {
    seenSql.length = 0;
    await contentExport.listCandidates({ brand: 'Beauterry', limit: 10 });
    const sql = seenSql[0].text.replace(/\s+/g, ' ');
    assert.match(sql, /NOT \(NULLIF\(BTRIM\(s\.gencode\), ''\) IS NULL AND p\.ad_groups @> jsonb_build_array\(jsonb_build_object\('key', s\.group_key, 'no_gencode', true\)\)\)/);
    // เงื่อนไขเดิมยังอยู่ครบ
    for (const re of [/p\.brand = \$1/, /s\.ad_status = \$2/, /s\.platform ILIKE 'tiktok%'/, /BTRIM\(s\.id_post\) ~ '\^\[0-9\]\+\$'/]) assert.match(sql, re);
    assert.deepEqual(seenSql[0].params.slice(0, 2), ['Beauterry', 'ยังไม่ยิง']);
});
