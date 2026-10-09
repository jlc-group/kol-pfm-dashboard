const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// PFM ผูกกับแบรนด์ (ผู้ใช้สั่ง 6 ต.ค. 2026): ตอนนี้ต่อแค่ PFM ของ Beauterry — แบรนด์อื่น (เช่น Jula's Herb) ห้ามถูกส่งไปถาม
// และห้ามรับข้อมูลจาก PFM ของ Beauterry · TikTok ของแบรนด์ที่ยังไม่ต่อ PFM กรอกเองได้ (สถานะยิงแล้ว / ค่าแอด / ยอดวิว)
// แต่ละแบรนด์จะมี PFM ของตัวเองทีหลัง — ต่อเพิ่มที่ logic.js PFM_SOURCES
// 9 ต.ค. 2026: PFM ตัวเดียวดูแลหลายแบรนด์แล้ว — ต่อ Jarvit / Jernis (ถามทีละแบรนด์ ?brand= · ลงเฉพาะคลิปแบรนด์นั้น)
// ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in pfm-brand-scope test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const PROJECTS = [
    { id: 91, name: 'KOL Sep.2026', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [] },
    { id: 92, name: 'KOL เดือนตุลาคม', brand: "Jula's Herb", team_id: 1, campaign_type: 'kol', ad_groups: [] }
];
const SUB = over => ({
    project_id: 91, person_key: null, clip_no: 1, platform: 'TikTok', product: 'L3', agency: 'A',
    status: 'confirmed', budget: 3000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://www.tiktok.com/@a/video/1', link_account: null, post_date: '2026-10-05',
    group_key: null, content_type: 'Review', gencode: null, id_post: null, perf_stamp: null, ...over
});
const fresh = () => ({
    projects: structuredClone(PROJECTS),
    teams: [{ id: 1, name: 'ทีมทดสอบ' }],
    submissions: [
        SUB({ id: 1, project_id: 91, id_post: '7600000000000000001' }),                       // Beauterry TikTok
        SUB({ id: 2, project_id: 92, id_post: '7693136943999175988', account_name: 'luvjennerr' }), // Jula's Herb TikTok (ภาพของผู้ใช้)
        SUB({ id: 3, project_id: 92, platform: 'Instagram', id_post: null }),                 // Jula's Herb Instagram
        SUB({ id: 4, project_id: 92, id_post: '7600000000000000004', ad_synced_at: '2026-10-01T00:00:00.000Z' }) // Jula's Herb ที่เคยถูกซิงก์ (ข้อมูลเก่า)
    ]
});
let FIXTURE = fresh();
let written = [];
let queries = [];
beforeEach(() => { FIXTURE = fresh(); written = []; queries = []; });

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
// ต้องสลับก่อน require pg/ads (ไฟล์นั้นหยิบ query / updateRow ไปเก็บตอนโหลด)
const base = require(path.join(SRC, 'store/pg/_base'));
base.query = async (sql, params) => { queries.push({ sql, params }); return { rows: [{ id_post: '7600000000000000001' }], rowCount: 1 }; };
base.withTransaction = async fn => fn({ query: async sql => {
    assert.match(sql, /FOR UPDATE OF s/);
    return { rows: structuredClone(FIXTURE.submissions).map(s => {
        const p = FIXTURE.projects.find(p => p.id === s.project_id);
        return { ...s, sync_brand: p?.brand, sync_campaign_type: p?.campaign_type };
    }) };
} });
base.updateRow = async (table, id, patch) => { written.push({ table, id, patch }); return { id, ...patch }; };

const logic = require(path.join(SRC, 'store/logic'));
const { isPfmBrand, pfmSourceBrands, adStatusAuto, pfmManagedSpend, viewsMissingReason, PFM_SOURCES } = logic;
const { ads, adsSync } = require(path.join(SRC, 'store/pg/ads'));
const kols = require(path.join(SRC, 'store/pg/kols'));
const { runSync, sanitizeRow, syncSummaryLine } = require(path.join(SRC, 'services/beauterryPfmSync'));

test('Beauterry lifetime reach is stored without clearing or lowering a previous total', async () => {
    FIXTURE.submissions[0].ad_reach = 100;
    await adsSync.apply([{ id_post: '7600000000000000001', pfm_source: 'beauterry-pfm', ad_reach: 11691 }]);
    assert.equal(written[0].patch.ad_reach, 11691);
    for (const value of [null, undefined, '', 0, 90, -1, 'NaN']) {
        written = [];
        await adsSync.apply([{ id_post: '7600000000000000001', pfm_source: 'beauterry-pfm', ad_reach: value }]);
        assert.equal('ad_reach' in written[0].patch, false, String(value));
    }
});

test('รายชื่อแบรนด์ที่ต่อ PFM: Beauterry + Jarvit + Jernis (9 ต.ค. 2026) · ไม่สนตัวพิมพ์/ช่องว่าง · source ที่ไม่รู้จัก = null', () => {
    assert.deepEqual(PFM_SOURCES, { 'beauterry-pfm': ['Beauterry', 'Jarvit', 'Jernis'] });
    for (const b of ['Beauterry', ' beauterry ', 'BEAUTERRY', 'Jarvit', 'jernis', ' Jernis ']) assert.equal(isPfmBrand(b), true, b);
    for (const b of ["Jula's Herb", 'Jdent', 'Dermiq', 'Code Lab', 'Minimii', 'Any Skin', '', null, undefined]) assert.equal(isPfmBrand(b), false, String(b));
    assert.deepEqual(pfmSourceBrands('beauterry-pfm'), ['Beauterry', 'Jarvit', 'Jernis']);
    assert.equal(pfmSourceBrands('weboostx'), null);
    assert.equal(pfmSourceBrands(undefined), null);
    assert.equal(pfmSourceBrands('constructor'), null, 'ไม่หลุดไปอ่าน prototype');
    pfmSourceBrands('beauterry-pfm').push('X');
    assert.deepEqual(pfmSourceBrands('beauterry-pfm'), ['Beauterry', 'Jarvit', 'Jernis'], 'คืนสำเนา แก้แล้วไม่กระทบรายชื่อจริง');
});

test('รหัสแบรนด์ที่ PFM ใช้ (?brand= / ฟีด /api/integrations/<รหัส>): ครบทุกแบรนด์ของ PFM · ไม่รู้จัก = null ไม่ถอยเป็น Beauterry', () => {
    const { PFM_BRAND_CODES, pfmBrandCode, pfmBrandByCode } = logic;
    assert.deepEqual(PFM_BRAND_CODES, { Beauterry: 'beauterry', Jarvit: 'jarvit', Jernis: 'jernis' });
    for (const b of pfmSourceBrands('beauterry-pfm')) assert.ok(pfmBrandCode(b), 'ทุกแบรนด์ของ PFM ต้องมีรหัส: ' + b);
    assert.equal(pfmBrandCode(' Jarvit '), 'jarvit');
    assert.equal(pfmBrandCode("Jula's Herb"), null);
    assert.equal(pfmBrandCode('constructor'), null, 'ไม่หลุดไปอ่าน prototype');
    assert.equal(pfmBrandByCode('JERNIS'), 'Jernis');
    assert.equal(pfmBrandByCode(' jarvit '), 'Jarvit');
    for (const c of ['', null, undefined, 'julaherb', 'constructor', '__proto__', 'beauterry2']) assert.equal(pfmBrandByCode(c), null, String(c));
});

test('สถานะยิงแล้ว / ค่าแอด / เหตุที่ไม่มียอดวิว: TikTok แบรนด์ที่ต่อ PFM = PFM ดูแล · แบรนด์อื่น = กรอกเอง', () => {
    const tt = { platform: 'TikTok', id_post: '7600000000000000001' };
    assert.equal(adStatusAuto(tt, 'Beauterry'), true);
    assert.equal(adStatusAuto(tt, "Jula's Herb"), false);
    assert.equal(adStatusAuto(tt), false, 'ไม่รู้แบรนด์ = ไม่ล็อก');
    assert.equal(adStatusAuto({ platform: 'Instagram' }, 'Beauterry'), false);
    assert.equal(pfmManagedSpend(tt, 'Beauterry'), true);
    assert.equal(pfmManagedSpend(tt, "Jula's Herb"), false, 'TikTok แบรนด์อื่นกรอกค่าแอดเองได้');
    assert.equal(pfmManagedSpend({ ...tt, ad_synced_at: 'x' }, "Jula's Herb"), false, 'แม้เคยถูกซิงก์ (ข้อมูลเก่า)');
    // Facebook / Instagram ที่ WeBoostX ซิงก์ให้ (ad_synced_at) ล็อกเหมือนเดิมทุกแบรนด์
    assert.equal(pfmManagedSpend({ platform: 'Instagram', ad_synced_at: 'x' }, "Jula's Herb"), true);
    assert.equal(pfmManagedSpend({ platform: 'Instagram' }, 'Beauterry'), false);
    assert.equal(viewsMissingReason({ ...tt }, null, "Jula's Herb"), 'no_pfm_brand');
    assert.equal(viewsMissingReason({ ...tt }, null, 'Beauterry'), 'pfm_no_clip');
    assert.equal(viewsMissingReason({ platform: 'Instagram' }, null, "Jula's Herb"), 'not_tiktok');
    assert.equal(viewsMissingReason({ ...tt, views: 10 }, null, "Jula's Herb"), null, 'มียอดวิวแล้ว (กรอกเอง) = ไม่มีป้าย');
});

test('itemIds: ถาม PFM เฉพาะคลิป TikTok ของแบรนด์ที่ PFM ตัวนั้นดูแล (JOIN projects + กรองแบรนด์) · ไม่มีแบรนด์ = ไม่ถามเลย', async () => {
    const ids = await adsSync.itemIds(['Beauterry']);
    assert.deepEqual(ids, ['7600000000000000001']);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /JOIN projects p ON p\.id = s\.project_id/);
    assert.match(queries[0].sql, /lower\(btrim\(p\.brand\)\) = ANY\(\$1::text\[\]\)/);
    assert.match(queries[0].sql, /s\.platform ILIKE 'tiktok%'/);
    assert.deepEqual(queries[0].params, [['beauterry']]);
    await adsSync.itemIds();
    assert.deepEqual(queries[1].params, [['beauterry', 'jarvit', 'jernis']], 'ค่าเริ่มต้น = แบรนด์ของ beauterry-pfm (9 ต.ค. 2026 เพิ่ม Jarvit / Jernis)');
    assert.deepEqual(await adsSync.itemIds([]), []);
    assert.deepEqual(await adsSync.itemIds(null), []);
    assert.equal(queries.length, 2, 'ไม่มีแบรนด์ = ไม่ยิง SQL');
});

test('runSync ของ Beauterry ส่งแบรนด์ของตัวเองไปเลือก ID Post · log บอกจำนวนคลิปแบรนด์อื่นที่ไม่รับ', async () => {
    const asked = [];
    // 9 ต.ค. 2026 หลายแบรนด์: ถามทีละแบรนด์ — Jarvit / Jernis ไม่มีคลิป = ไม่ยิงคำขอไป PFM
    const storeImpl = { adsSync: {
        itemIds: async brands => { asked.push(brands); return brands[0] === 'Beauterry' ? ['7600000000000000001'] : []; },
        apply: async () => ({ updated: 1, stale: 0, stamped: 0, other_brand: 2 })
    } };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'success', data: { rows: [{ id_post: '7600000000000000001', views: 5 }], not_found: [] } }) });
    const result = await runSync({ storeImpl, fetchImpl, env: { BEAUTERRY_PFM_EXPORT_KEY: 'fixture', BEAUTERRY_PFM_BASE_URL: 'http://pfm.local' } });
    assert.deepEqual(asked, [['Beauterry'], ['Jarvit'], ['Jernis']]);
    assert.equal(result.other_brand, 2);
    assert.match(syncSummaryLine(result), /คลิปแบรนด์อื่นไม่รับ 2/);
    assert.doesNotMatch(syncSummaryLine({ ...result, other_brand: 0 }), /แบรนด์อื่น/, 'ไม่มี = ไม่ขึ้นในบรรทัด log');
});

test('apply: แถวจาก PFM ของ Beauterry ไม่เขียนลงคลิปแบรนด์อื่น (นับ other_brand) · คลิป Beauterry รับตามเดิม', async () => {
    const out = await adsSync.apply([
        sanitizeRow({ id_post: '7693136943999175988', views: 9999, ad_spend: 500, ad_launched: true, first_ad_date: '2026-10-05' }),
        sanitizeRow({ id_post: '7600000000000000001', views: 1200, ad_spend: 300 }),
        sanitizeRow({ id_post: '7999999999999999999', views: 1 })
    ]);
    assert.equal(out.other_brand, 1);
    assert.deepEqual(out.not_found, ['7999999999999999999'], 'ไม่มีคลิปไหนตรงเลย = not_found เหมือนเดิม');
    assert.equal(out.updated, 1);
    assert.deepEqual(written.map(w => w.id), [1], 'เขียนเฉพาะคลิป Beauterry');
    assert.equal(written[0].patch.views, 1200);
});

test('apply: ID Post เดียวกันทั้งสองแบรนด์ (คลิปแบรนด์อื่น id ต่ำกว่า) → PFM ลงที่คลิป Beauterry ไม่ใช่แถวแรกของทั้งตาราง', async () => {
    FIXTURE.submissions = [
        SUB({ id: 1, project_id: 92, id_post: '7600000000000000777' }),
        SUB({ id: 2, project_id: 91, id_post: '7600000000000000777' })
    ];
    const out = await adsSync.apply([sanitizeRow({ id_post: '7600000000000000777', views: 50 })]);
    assert.equal(out.updated, 1);
    assert.deepEqual(written.map(w => w.id), [2]);
});

test('apply หลายแบรนด์ (9 ต.ค. 2026): ชุดจากคำขอ ?brand=jernis ลงได้เฉพาะคลิป Jernis · คลิป Beauterry ที่ ID ตรงไม่ถูกแตะ', async () => {
    FIXTURE.projects.push({ id: 93, name: 'Jernis Oct', brand: 'Jernis', team_id: 1, campaign_type: 'kol', ad_groups: [] });
    FIXTURE.submissions.push(SUB({ id: 5, project_id: 93, id_post: '7600000000000000005' }));
    const out = await adsSync.apply([
        sanitizeRow({ id_post: '7600000000000000001', views: 111 }),   // คลิป Beauterry — มากับคำขอของ Jernis ไม่รับ
        sanitizeRow({ id_post: '7600000000000000005', views: 555 })    // คลิป Jernis
    ], { brands: ['Jernis'] });
    assert.equal(out.updated, 1);
    assert.equal(out.other_brand, 1);
    assert.deepEqual(written.map(w => w.id), [5]);
    assert.equal(written[0].patch.views, 555);
    // แบรนด์ที่ไม่ใช่ของ PFM ตัวนี้ส่งมาเป็นตัวกรอง = ไม่มีคลิปไหนรับได้เลย (ไม่ถอยไปทุกแบรนด์)
    written = [];
    const none = await adsSync.apply([sanitizeRow({ id_post: '7693136943999175988', views: 1 })], { brands: ["Jula's Herb"] });
    assert.equal(none.updated, 0);
    assert.equal(none.other_brand, 1);
    assert.deepEqual(written, []);
});

test('apply: ข้อมูลจากแหล่งอื่น (เส้น /api/ads-sync/sync ไม่มี pfm_source) ไม่จำกัดแบรนด์ — เหมือนเดิม', async () => {
    const out = await adsSync.apply([{ id_post: '7693136943999175988', ad_spend: 700 }]);
    assert.equal(out.updated, 1);
    assert.equal(out.other_brand, 0);
    assert.deepEqual(written.map(w => w.id), [2]);
});

test('หน้า Ads (ads.list): Jula\'s Herb TikTok กดสถานะ / กรอกค่าแอดเองได้ + ป้ายบอกว่าแบรนด์นี้ยังไม่มี PFM · Beauterry ยังล็อกเหมือนเดิม', async () => {
    const { rows } = await ads.list({});
    const by = id => rows.find(r => r.sub_id === id);
    assert.deepEqual([by(1).status_auto, by(1).spend_from_pfm, by(1).views_reason], [true, true, 'pfm_no_clip']);
    assert.deepEqual([by(2).status_auto, by(2).spend_from_pfm, by(2).views_reason], [false, false, 'no_pfm_brand']);
    assert.deepEqual([by(3).status_auto, by(3).spend_from_pfm, by(3).views_reason], [false, false, 'not_tiktok']);
    assert.deepEqual([by(4).status_auto, by(4).spend_from_pfm, by(4).views_reason], [false, false, 'no_pfm_brand'], 'เคยถูกซิงก์ก็ปลดล็อก');
});

test('หน้า KOL Analytics (kols.analytics) ส่งเหตุ no_pfm_brand ของ TikTok แบรนด์อื่นเหมือนหน้า Ads', async () => {
    const an = await kols.analytics(null);
    const r2 = an.rows.find(r => r.sub_id === 2);
    assert.ok(r2, 'มีแถว Jula\'s Herb');
    assert.equal(r2.views_reason, 'no_pfm_brand');
    assert.equal(an.rows.find(r => r.sub_id === 1).views_reason, 'pfm_no_clip');
    assert.equal(an.rows.find(r => r.sub_id === 3).views_reason, 'not_tiktok');
});

test('PUT /api/ads/:id ตัดสินด้วยแบรนด์ของแคมเปญ (ctx.brand) · หน้าเว็บใช้ status_auto ที่ server ส่งมา (มีสำรองสำหรับ server รุ่นก่อน)', () => {
    const route = fs.readFileSync(path.join(SRC, 'routes/ads.js'), 'utf8');
    assert.ok(route.includes('pfmManagedSpend(ctx.submission, ctx.brand)'));
    assert.ok(route.includes('adStatusAuto(ctx.submission, ctx.brand)'));
    const page = fs.readFileSync(path.join(__dirname, '../client/src/pages/Ads.jsx'), 'utf8');
    assert.ok(page.includes("const adStatusAuto = row => (typeof row.status_auto === 'boolean' ? row.status_auto : /^\\s*tiktok/i.test(String(row.platform || '')));"));
    const stamp = fs.readFileSync(path.join(__dirname, '../client/src/data/stamp.js'), 'utf8');
    assert.ok(stamp.includes("case 'no_pfm_brand':"));
});
