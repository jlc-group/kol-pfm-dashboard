const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// สินค้าเดียวกันอยู่ได้หลายแถว (ผู้ใช้สั่ง 12 พ.ย. 2026 — "นอกจากรวมสินค้าเป็นกลุ่มเดียวกันได้แล้ว อยากให้เพิ่มรายการสินค้าเดียวกันกับที่รวมกลุ่มไปแล้วได้ด้วย")
// ผู้ใช้ตอบ: ได้ทั้งแถวเดี่ยว + หลายชุด · Target แต่ละแถวเลือกเอง · นับคลิปเข้าแถวจากสินค้าที่เลือก (รหัสตรงกันพอดี)
// แถวสินค้ารุ่น 2 = บล็อกมี singles · ค่าของแถวเก็บที่ key ("L10" / "L10+L20") · Target ต่อแถว (row_targets)
// หน้าเว็บ (client/src/data/adGroups.js) กับ server (server/src/store/logic.js) ต้องได้ผลเดียวกันทุกตัวอักษร · ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-row-overlap-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in row-overlap test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const tiers = n => [{ tier: 'Micro 10k - 100k', kols: String(n) }];
// TikTok: แถว L10 เดี่ยว (5 คน · T1) + ชุด L10 + L20 (3 คน · T2) + ชุด L10 + L23 (2 คน · T3) + แถว L23 เดี่ยว (4 คน · T4)
const V2 = (over = {}) => ({
    platform: 'TikTok', products: ['L10', 'L20', 'L23'],
    singles: ['L10', 'L23'], bundles: [['L10', 'L20'], ['L10', 'L23']],
    kol_split: true, product_kols: { L10: 5, 'L10+L20': 3, 'L10+L23': 2, L23: 4 },
    budget_mode: 'split', budget: '14000', product_budgets: { L10: 5000, 'L10+L20': 3000, 'L10+L23': 2000, L23: 4000 },
    concept_split: true, product_concepts: { L10: 'เดี่ยว', 'L10+L20': 'คู่ 20' },
    row_targets: { L10: ['T1'], 'L10+L20': ['T2'], 'L10+L23': ['T3'], L23: ['T4'] },
    product_targets: { L10: ['T1', 'T2', 'T3'], L20: ['T2'], L23: ['T3', 'T4'] },
    target: ['T1', 'T2', 'T3', 'T4'],
    sets: [{ content_type: 'Review', tiers: tiers(14) }], ...over
});
const GROUP = (over = {}) => ({ key: 'g1', platform: 'TikTok', platforms: ['TikTok'], blocks: [V2()], products: ['L10', 'L20', 'L23'],
    allocations: [{ platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 14, content_type: 'Review' }], ...over });

const SUB = over => ({
    project_id: 95, group_key: 'g1', person_key: null, clip_no: 1, platform: 'TikTok', product: 'L10', agency: 'A', status: 'confirmed',
    budget: 1000, fee_free: false, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: '2026-11-01', content_type: 'Review', gencode: '#G', id_post: null, code_expire: 60,
    perf_stamp: null, ad_synced_at: null, post_check: null, ...over
});
const FIXTURE = {
    projects: [{ id: 95, name: 'KOL Nov', brand: "Jula's Herb", team_id: 1, campaign_type: 'kol', ad_groups: [GROUP()] }],
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        SUB({ id: 1, product: 'L10' }),
        SUB({ id: 2, product: 'L10,L20' }),
        SUB({ id: 3, product: 'L23, L10' }),
        SUB({ id: 4, product: 'L20' }),
        SUB({ id: 5, product: 'L23' }),
        SUB({ id: 6, product: 'L10, L20, L23' })
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
const { renameTargetInGroups } = require(path.join(SRC, 'store/targetRename'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;
let server, base;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    store.users.findById = async () => ({ id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active', brands: [] });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) {
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    // รอ socket ปิดครบ — deploy รันเทสต์แบบ --test-force-exit (บน Windows ปิดค้างแล้วแครช UV_HANDLE_CLOSING)
    for (let i = 0; i < 40 && process._getActiveHandles().some(h => h && h.constructor && h.constructor.name === 'Socket'); i++) {
        await new Promise(r => setTimeout(r, 25));
    }
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------- แถวสินค้า (หน้าเว็บ = server)
const shape = rows => rows.map(r => [r.key, r.label, r.bundle]);

test('แถวรุ่น 2: L10 เดี่ยว + ชุด L10 + L20 + ชุด L10 + L23 + L23 เดี่ยว — ลำดับตามสินค้า · key ชุดเรียงรหัส · server ได้แถวเดียวกัน', () => {
    const b = V2();
    const want = [['L10', 'L10', false], ['L10+L20', 'L10 + L20', true], ['L10+L23', 'L10 + L23', true], ['L23', 'L23', false]];
    assert.deepEqual(shape(web.productRows(b)), want);
    assert.deepEqual(shape(logic.blockRows(b)), want);
    assert.deepEqual(web.blockSingles(b), ['L10', 'L23']);
    // ชุดซ้ำ (ไม่สนลำดับ) ตัดทิ้ง · รหัสที่ไม่อยู่ในแถวไหนเลย = แถวเดี่ยว (ไม่หายจากตา) · singles ที่ไม่อยู่ในสินค้า = ไม่นับ
    const messy = V2({ products: ['L10', 'L20', 'L23', 'L3'], singles: ['L10', 'X9'], bundles: [['L10', 'L20'], ['L20', 'L10'], ['L10', 'L23'], ['L3'], null, ['L20', 'L99']] });
    const wantMessy = [['L10', 'L10', false], ['L10+L20', 'L10 + L20', true], ['L10+L23', 'L10 + L23', true], ['L3', 'L3', false]];
    assert.deepEqual(shape(web.productRows(messy)), wantMessy);
    assert.deepEqual(shape(logic.blockRows(messy)), wantMessy);
    assert.deepEqual(web.blockBundles(messy), logic.blockBundles(messy));
    assert.deepEqual(web.blockSingles(messy), logic.blockSingles(messy));
    // ข้อมูลรุ่นเก่า (ไม่มี singles) — 1 รหัสอยู่ได้ชุดเดียว เหมือนเดิมทุกอย่าง ทั้งสองฝั่ง
    const legacy = { products: ['L10', 'L20', 'L23'], bundles: [['L10', 'L20'], ['L10', 'L23']] };
    assert.deepEqual(shape(web.productRows(legacy)), [['L10+L20', 'L10 + L20', true], ['L23', 'L23', false]]);
    assert.deepEqual(shape(logic.blockRows(legacy)), shape(web.productRows(legacy)));
    assert.equal(web.rowKeyOf(['L20', 'L10']), logic.rowKeyOf(['L10', 'L20']));
});

test('ฟอร์ม: รวมชุดแล้วเพิ่มแถวเดี่ยวคืนได้ · รวมชุดที่สองที่ใช้รหัสเดิมได้ · ชุดซ้ำรวมไม่ได้ · เอาแถวเดี่ยวออกชุดไม่โดน', () => {
    // เริ่ม: L10 / L20 / L23 เดี่ยว (ข้อมูลรุ่นเก่า)
    const start = { platform: 'TikTok', products: ['L10', 'L20', 'L23'], kol_split: true, product_kols: { L10: '5', L20: '3', L23: '2' },
        product_targets: { L10: ['T1'], L20: ['T2'], L23: ['T3'] }, sets: [{ content_type: 'Review', tiers: tiers(10) }] };
    let b = web.makeBundle(start, ['L10', 'L20']);
    assert.deepEqual(shape(web.productRows(b)), [['L10+L20', 'L10 + L20', true], ['L23', 'L23', false]]);
    assert.deepEqual(b.product_kols, { 'L10+L20': '8', L23: '2' });
    // ติ๊ก L10 ที่ช่องเลือกสินค้าอีกครั้ง = แถวเดี่ยวเพิ่ม (ชุดยังอยู่ ค่าไม่โดน)
    b = web.addSingle(b, 'L10', ['T9']);
    assert.deepEqual(shape(web.productRows(b)), [['L10', 'L10', false], ['L10+L20', 'L10 + L20', true], ['L23', 'L23', false]]);
    assert.deepEqual([b.products, b.row_targets.L10, b.product_kols['L10+L20']], [['L10', 'L20', 'L23'], ['T9'], '8']);
    assert.equal(web.addSingle(b, 'L10'), b, 'มีแถวเดี่ยวอยู่แล้ว = ไม่เพิ่มซ้ำ');
    // สินค้าใหม่ที่ยังไม่อยู่ในบล็อก = เพิ่มต่อท้าย
    assert.deepEqual(web.addSingle(b, 'L3').products, ['L10', 'L20', 'L23', 'L3']);
    // ชุดที่สองที่มี L10: ติ๊กแถวเดี่ยว L10 + L23 → ชุด L10 + L23 (ชุด L10 + L20 ไม่โดน)
    b = web.makeBundle({ ...b, product_kols: { ...b.product_kols, L10: '1' } }, ['L10', 'L23']);
    assert.deepEqual(shape(web.productRows(b)), [['L10+L20', 'L10 + L20', true], ['L10+L23', 'L10 + L23', true]]);
    assert.deepEqual(b.product_kols, { 'L10+L20': '8', 'L10+L23': '3' });
    // ชุดที่จะได้ซ้ำกับชุดที่มีอยู่ (ไม่ได้ติ๊ก) = ไม่รวม
    const again = web.addSingle(web.addSingle(b, 'L10'), 'L20');
    assert.equal(web.makeBundle(again, ['L10', 'L20']), again);
    // เอาแถวเดี่ยว L10 ออก = ชุดที่มี L10 ยังอยู่ · L10 ยังอยู่ในสินค้า
    const noSingle = web.removeRow(again, 'L10');
    // ลำดับแถว: ไล่รหัสตามลำดับสินค้า → แถวเดี่ยวของรหัสนั้น แล้วทุกชุดที่มีรหัสนั้น (ชุดที่มี L10 ขึ้นต่อจาก L10 ทั้งหมด)
    assert.deepEqual(shape(web.productRows(noSingle)), [['L10+L20', 'L10 + L20', true], ['L10+L23', 'L10 + L23', true], ['L20', 'L20', false]]);
    assert.deepEqual(noSingle.products, ['L10', 'L20', 'L23']);
    // แยกชุด L10 + L20 ตอนที่ L20 มีแถวเดี่ยวแล้ว: L10 ได้แถวเดี่ยวพร้อมค่าของชุด · L20 คงค่าเดิม
    const split = web.splitBundle({ ...noSingle, product_kols: { ...noSingle.product_kols, L20: '2' } }, 'L10+L20');
    assert.deepEqual(shape(web.productRows(split)), [['L10', 'L10', false], ['L10+L23', 'L10 + L23', true], ['L20', 'L20', false]]);
    assert.deepEqual(split.product_kols, { L10: '8', L20: '2', 'L10+L23': '3' });
});

test('บันทึก: รูปรุ่น 2 เสมอ · ค่าเฉพาะแถวที่ยังอยู่ · Target ต่อรหัส = รวมทุกแถวที่มีรหัสนั้น · เปิดฟอร์มใหม่ได้แถวและค่าเดิมครบ', () => {
    const packed = web.packCart(web.packCampaigns(web.packProductTargets(web.packBudgets(web.packConcepts(web.packKols(web.packBundles(
        V2({ product_kols: { L10: 5, 'L10+L20': 3, 'L10+L23': 2, L23: 4, 'L20+L99': 9 }, row_targets: { L10: ['T1'], 'L10+L20': ['T2'], 'L10+L23': ['T3'], L23: ['T4'], gone: ['X'] } })
    )))))));
    assert.deepEqual([packed.singles, packed.bundles], [['L10', 'L23'], [['L10', 'L20'], ['L10', 'L23']]]);
    assert.deepEqual(packed.product_kols, { L10: 5, 'L10+L20': 3, 'L10+L23': 2, L23: 4 });
    assert.deepEqual(packed.product_budgets, { L10: 5000, 'L10+L20': 3000, 'L10+L23': 2000, L23: 4000 });
    assert.equal(packed.budget, '14000');
    assert.deepEqual(packed.product_concepts, { L10: 'เดี่ยว', 'L10+L20': 'คู่ 20' });
    assert.deepEqual(packed.row_targets, { L10: ['T1'], 'L10+L20': ['T2'], 'L10+L23': ['T3'], L23: ['T4'] });
    assert.deepEqual(packed.product_targets, { L10: ['T1', 'T2', 'T3'], L20: ['T2'], L23: ['T3', 'T4'] });
    assert.deepEqual(packed.target, ['T1', 'T2', 'T3', 'T4']);
    const st = web.kolSplitState(packed);
    assert.deepEqual([st.count, st.sum, st.total, st.ok], [4, 14, 14, true]);
    // เปิดแคมเปญที่บันทึกแล้วในฟอร์ม (toBlocks → withProductTargets) = ได้แถว / ค่า / Target เดิม
    const reopened = web.withProductTargets(web.toBlocks({ key: 'g1', platforms: ['TikTok'], blocks: [packed] }, 'TikTok')[0]);
    assert.deepEqual(shape(web.productRows(reopened)), shape(web.productRows(V2())));
    assert.deepEqual([reopened.row_targets, reopened.product_kols, reopened.legacy_orphans], [packed.row_targets, packed.product_kols, []]);
    assert.equal(web.sameProductSet(reopened, packed), true);
});

test('นับคน: รหัสในช่องสินค้าตรงแถวไหนพอดี = นับแถวนั้นแถวเดียว · ไม่ตรงแถวไหน = กติกาเดิม (ทุกแถวที่มีรหัสนั้น)', () => {
    let id = 0;
    const sub = (person, product) => ({ id: ++id, group_key: 'g1', platform: 'TikTok', person_key: person, product, status: 'submitted' });
    const subs = [
        sub('p1', 'L10'),                              // แถว L10 เดี่ยวเท่านั้น
        sub('p2', 'L10,L20'),                          // ชุด L10 + L20
        sub('p3', 'L20 - ชื่อสินค้า, L10'),            // ลำดับ / ชื่อต่อท้ายไม่มีผล = ชุด L10 + L20
        sub('p4', 'L23, L10'),                         // ชุด L10 + L23
        sub('p5', 'L23'),                              // แถว L23 เดี่ยว
        sub('p6', 'L20'),                              // ไม่มีแถว L20 เดี่ยว → ชุดที่มี L20
        sub('p7', 'L10, L20, L23')                     // ไม่ตรงแถวไหน → ทุกแถวที่มีรหัสใดรหัสหนึ่ง
    ];
    const out = web.productKolProgress({ key: 'g1', blocks: [V2()] }, subs);
    assert.deepEqual(out[0].rows.map(r => [r.code, r.need, r.sent]), [
        ['L10', 5, 2], ['L10 + L20', 3, 4], ['L10 + L23', 2, 2], ['L23', 4, 2]
    ]);
    assert.deepEqual(out[0].rows[1].codes, ['L10', 'L20']);
});

test('Target ของคลิป (หน้า On Process = หน้า Ads / ฟีด): แถวที่ตรงพอดี · ไม่ตรง = รวมต่อรหัส · หน้าเว็บ = server', () => {
    const g = GROUP();
    const cases = [
        ['L10', ['T1']],
        ['L10,L20', ['T2']],
        ['L20 - ชื่อ, L10', ['T2']],
        ['L10, L23', ['T3']],
        ['L23', ['T4']],
        ['L20', ['T2']],                              // ไม่มีแถวเดี่ยว → Target ต่อรหัส (รวมของทุกแถวที่มี L20)
        ['L10, L20, L23', ['T1', 'T2', 'T3', 'T4']],  // ไม่ตรงแถวไหน → รวมต่อรหัส
        ['X9', ['T1', 'T2', 'T3', 'T4']],             // ไม่รู้จักสินค้า → Target รวมของ Platform
        ['', ['T1', 'T2', 'T3', 'T4']]
    ];
    for (const [product, want] of cases) {
        assert.deepEqual(web.targetFor(g, 'TikTok', product), want, 'web ' + product);
        assert.deepEqual(logic.resolveGroupTarget(g, 'TikTok', product), want, 'server ' + product);
    }
    // แถวที่ยังไม่มี Target ของตัวเอง = ถอยไปรวมต่อรหัส (ไม่ว่าง)
    const noOwn = GROUP({ blocks: [V2({ row_targets: { L10: [], 'L10+L20': ['T2'], 'L10+L23': ['T3'], L23: ['T4'] } })] });
    assert.deepEqual(web.targetFor(noOwn, 'TikTok', 'L10'), ['T1', 'T2', 'T3']);
    assert.deepEqual(logic.resolveGroupTarget(noOwn, 'TikTok', 'L10'), ['T1', 'T2', 'T3']);
    // ข้อมูลรุ่นเก่า: กติกาเดิม (รวม Target ต่อรหัส) ทั้งสองฝั่ง
    const old = { blocks: [{ platform: 'TikTok', products: ['L8A', 'L8B', 'L3'], bundles: [['L8A', 'L8B']], product_targets: { L8A: ['M'], L8B: ['M'], L3: ['S'] }, target: ['M', 'S'] }] };
    for (const [product, want] of [['L8B', ['M']], ['L8A,L8B', ['M']], ['L3, L8A', ['S', 'M']], ['L3', ['S']]]) {
        assert.deepEqual(web.targetFor(old, 'TikTok', product), want, 'web old ' + product);
        assert.deepEqual(logic.resolveGroupTarget(old, 'TikTok', product), want, 'server old ' + product);
    }
});

test('หน้า Ads (ads.list): คอลัมน์ TARGET ของแต่ละคลิปมาจากแถวที่คลิปอยู่', async () => {
    const { rows } = await ads.list({ user: { id: 7, role: 'admin', team_id: 1, brands: [] } });
    const byId = Object.fromEntries(rows.map(r => [r.sub_id, r.target]));
    assert.deepEqual([byId[1], byId[2], byId[3], byId[4], byId[5], byId[6]], [['T1'], ['T2'], ['T3'], ['T2'], ['T4'], ['T1', 'T2', 'T3', 'T4']]);
});

test('หน้า Products & Targets แก้ชื่อ Target ของ L20: ทุกแถวที่มี L20 (ชุด) เปลี่ยน · L10 ในชุดนั้นคืนใน bundled · แถวอื่นไม่โดน', () => {
    const g = [GROUP({ blocks: [V2({ row_targets: { L10: ['T1'], 'L10+L20': ['T'], 'L10+L23': ['T'], L23: ['T4'] },
        product_targets: { L10: ['T1', 'T'], L20: ['T'], L23: ['T', 'T4'] }, target: ['T1', 'T', 'T4'] })] })];
    const r = renameTargetInGroups(g, ['L20'], 'T', 'NEW');
    const b = r.groups[0].blocks[0];
    assert.equal(r.changed, true);
    assert.deepEqual(b.row_targets, { L10: ['T1'], 'L10+L20': ['NEW'], 'L10+L23': ['T'], L23: ['T4'] });
    assert.deepEqual(b.product_targets, { L10: ['T1', 'NEW', 'T'], L20: ['NEW'], L23: ['T', 'T4'] }, 'Target ต่อรหัสคิดใหม่จากแถว');
    assert.deepEqual(b.target, ['T1', 'T', 'T4', 'NEW'], 'ยังมีแถวที่ใช้ T อยู่ = คงชื่อเดิม + เติมชื่อใหม่');
    assert.deepEqual(r.bundled, ['L10']);
    // L23 ใช้ T อยู่ในชุด L10 + L23 → แก้ของ L23 = ชุดนั้นเปลี่ยนด้วย แถว L23 เดี่ยวไม่มี T ไม่โดน
    const r2 = renameTargetInGroups(g, ['L23'], 'T', 'NEW');
    assert.deepEqual(r2.groups[0].blocks[0].row_targets, { L10: ['T1'], 'L10+L20': ['T'], 'L10+L23': ['NEW'], L23: ['T4'] });
    // สินค้าที่ไม่มีแถวไหนใช้ชื่อนี้ = ไม่เปลี่ยน
    assert.equal(renameTargetInGroups(g, ['L23'], 'T1', 'NEW').changed, false);
});

test('แท็บฟอร์มเก่า (ไม่ส่ง singles) บันทึกทับบล็อกรุ่น 2 = เจอ · รุ่น 2 ส่งมา / ในฐานยังเป็นรุ่นเก่า = ไม่เจอ', () => {
    const stored = [GROUP()];
    const oldTab = [{ ...GROUP(), blocks: [(({ singles, row_targets, ...b }) => b)(V2())] }];
    assert.deepEqual(logic.staleRowBlocks(oldTab, stored), ['กลุ่มที่ 1 · TikTok']);
    assert.deepEqual(logic.staleRowBlocks([GROUP()], stored), []);
    assert.deepEqual(logic.staleRowBlocks(oldTab, [{ ...GROUP(), blocks: [{ platform: 'TikTok', products: ['L10'] }] }]), []);
    assert.deepEqual(logic.staleRowBlocks(oldTab, [{ ...GROUP(), key: 'other' }]), [], 'กลุ่มใหม่ = ไม่ชน');
    assert.deepEqual(logic.staleRowBlocks(null, stored), []);
});

test('PUT /api/projects/:id: แท็บเก่าบันทึกทับแถวรุ่น 2 = 409 ไม่บันทึกอะไร · ฟอร์มใหม่บันทึกได้ · เปลี่ยนสถานะอย่างเดียวไม่โดน', async () => {
    let project = { id: 95, name: 'KOL Nov', brand: "Jula's Herb", team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [GROUP()] };
    const updates = [];
    store.projects.findByIdFull = async id => (String(id) === '95' ? structuredClone(project) : null);
    store.projects.update = async (id, fields) => { updates.push(structuredClone(fields)); project = { ...project, ...fields }; return structuredClone(project); };
    store.activity.log = async () => {};
    const call = body => fetch(`${base}/api/projects/95`, {
        method: 'PUT', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const oldTab = [{ ...GROUP(), blocks: [(({ singles, row_targets, ...b }) => ({ ...b, bundles: [['L10', 'L20']] }))(V2())] }];
    let res = await call({ name: 'KOL Nov', ad_groups: oldTab });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'STALE_FORM');
    assert.match(body.message, /F5/);
    assert.match(body.message, /กลุ่มที่ 1 · TikTok/);
    assert.equal(updates.length, 0, 'ไม่บันทึกอะไร');
    res = await call({ name: 'KOL Nov', ad_groups: [GROUP()] });
    assert.equal(res.status, 200);
    assert.deepEqual(updates.at(-1).ad_groups[0].blocks[0].singles, ['L10', 'L23']);
    res = await call({ status: 'Completed' });
    assert.equal(res.status, 200);
});

// ---------------------------------------------------------------- ผลรีวิวอิสระ 12 พ.ย.
test('Concept: ชุดเดียวกันที่แต่ละ Platform ติ๊กคนละลำดับ = รายการเดียวกัน (มีชื่อ Platform กำกับเมื่อ Concept ต่างกัน)', () => {
    const blkC = (platform, products, concept) => ({ platform, products, singles: [], bundles: [products], concept_split: true, product_concepts: { 'L8A+L8B': concept } });
    const g = { concept: 'หลัก', blocks: [blkC('TikTok', ['L8A', 'L8B'], 'X'), blkC('Facebook', ['L8B', 'L8A'], 'Y')] };
    assert.equal(web.conceptText(g, true), 'L8A + L8B · TikTok = X · L8A + L8B · Facebook = Y');
    const same = { concept: 'หลัก', blocks: [blkC('TikTok', ['L8A', 'L8B'], 'X'), blkC('Facebook', ['L8B', 'L8A'], 'X')] };
    assert.deepEqual(web.conceptRows(same).map(r => r.items.map(i => i.label)), [['L8A + L8B']]);
});

test('server รุ่นก่อน (ยังไม่รีสตาร์ต) แก้ชื่อ Target แค่ใน product_targets: อ่านแล้วได้ชื่อใหม่ ไม่ใช่ชื่อเดิม — หน้าเว็บ = server · เปิดฟอร์มได้ชื่อใหม่', () => {
    // บันทึกจากฟอร์มใหม่: L10 [T1] · L10 + L20 [T2] — แล้ว server รุ่นก่อนแก้ T1 → T1X ใน product_targets ของ L10 เท่านั้น
    const b = V2({ singles: ['L10'], bundles: [['L10', 'L20']], products: ['L10', 'L20'],
        row_targets: { L10: ['T1'], 'L10+L20': ['T2'] }, product_targets: { L10: ['T1X', 'T2'], L20: ['T2'] }, target: ['T1X', 'T2'] });
    const g = GROUP({ blocks: [b] });
    for (const [product, want] of [['L10', ['T1X']], ['L10,L20', ['T2']]]) {
        assert.deepEqual(web.targetFor(g, 'TikTok', product), want, 'web ' + product);
        assert.deepEqual(logic.resolveGroupTarget(g, 'TikTok', product), want, 'server ' + product);
    }
    assert.deepEqual(web.withProductTargets(b).row_targets, { L10: ['T1X'], 'L10+L20': ['T2'] }, 'เปิดฟอร์มแล้วบันทึก = ได้ชื่อใหม่ (ไม่ย้อนชื่อเดิมกลับ)');
    // ชุดที่ถูกแก้ชื่อ: ชื่อเดิมตัดทิ้ง → ไม่มี Target ของแถว → ถอยไปรวมต่อรหัส (มีชื่อใหม่)
    const bb = V2({ singles: [], bundles: [['L10', 'L20']], products: ['L10', 'L20'], row_targets: { 'L10+L20': ['T2'] }, product_targets: { L10: ['T2X'], L20: ['T2X'] } });
    assert.deepEqual(web.targetFor(GROUP({ blocks: [bb] }), 'TikTok', 'L10,L20'), ['T2X']);
    assert.deepEqual(logic.resolveGroupTarget(GROUP({ blocks: [bb] }), 'TikTok', 'L10,L20'), ['T2X']);
    // ปกติ (เขียนพร้อมกัน) = row_targets ตามเดิมทุกตัว
    assert.deepEqual(web.withProductTargets(V2()).row_targets, V2().row_targets);
});

test('ใช้สินค้าเหมือน Platform อื่น: สินค้าที่ปลายทางอยู่แค่ในชุด แล้วกลายเป็นแถวเดี่ยว = ได้ Target ของชุดนั้นไป (ไม่ใช่ Target เริ่มต้น)', () => {
    const dst = { platform: 'TikTok', products: ['L8A', 'L8B'], bundles: [['L8A', 'L8B']], product_targets: { L8A: ['M1'], L8B: ['M1'] } };   // ข้อมูลรุ่นเก่า
    const src = { platform: 'Facebook', products: ['L8A', 'L8B'], kol_split: true, product_kols: { L8A: 1, L8B: 1 } };
    const out = web.copyProductSet(dst, src, () => ['SEED']);
    assert.deepEqual(out.row_targets, { L8A: ['M1'], L8B: ['M1'] });
    assert.deepEqual(web.copyProductSet(dst, { ...src, products: ['L8A', 'L3'] }, () => ['SEED']).row_targets, { L8A: ['M1'], L3: ['SEED'] });
});

test('แยกชุดตอนที่ทุกสินค้าในชุดมีแถวเดี่ยวแล้ว = ค่าของชุดบวกเข้าแถวเดี่ยวแรก (จำนวนคน / งบรวมไม่หาย)', () => {
    const b = V2({ products: ['L10', 'L20'], singles: ['L10', 'L20'], bundles: [['L10', 'L20']],
        product_kols: { L10: '1', L20: '1', 'L10+L20': '3' }, product_budgets: { L10: '1000', L20: '1000', 'L10+L20': '3000' }, budget: '5000',
        product_concepts: { L10: 'a', 'L10+L20': 'c' }, row_targets: { L10: ['T1'], L20: ['T2'], 'L10+L20': ['T3'] } });
    const s = web.splitBundle(b, 'L10+L20');
    assert.deepEqual([s.singles, s.bundles], [['L10', 'L20'], []]);
    assert.deepEqual([s.product_kols, s.product_budgets, s.budget], [{ L10: '4', L20: '1' }, { L10: '4000', L20: '1000' }, '5000']);
    assert.deepEqual([s.product_concepts.L10, s.row_targets.L10], ['a\nc', ['T1', 'T3']]);
    assert.equal(web.productKolSum(s), web.productKolSum(b));
});
