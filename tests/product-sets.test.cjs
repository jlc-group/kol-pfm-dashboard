const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// สินค้าในเซ็ต (ผู้ใช้สั่ง 11 พ.ย. 2026 "รหัส JNPSET1 ในหน้า Ads อยากให้ขึ้นเป็น JNP1,JNP2,JNP3" → เลือกทาง 1)
// • หน้า Products & Targets ตั้งได้ว่ารหัสเซ็ตมีสินค้าอะไรข้างใน (catalog_products.set_items)
// • ช่อง PRODUCTS หน้า Ads (หน้าเว็บ) + ฟีดยิงแอด (server) กางเซ็ตเป็นสินค้าข้างใน — สองฝั่งต้องได้ผลเดียวกันทุกตัวอักษร
// • ป้ายใต้ชื่อ KOL ยังเป็นรหัสเซ็ตตามที่รีวิวจริง · Target ยังคิดจากรหัสเซ็ต
// ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-product-sets-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in product-sets test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ต้องสลับ query / withTransaction ก่อน require โมดูล store (หยิบไปเก็บตอนโหลด)
const base = require(path.join(SRC, 'store/pg/_base'));
let onQuery = async () => ({ rows: [], rowCount: 0 });
const SQL = [];
base.query = async (text, params) => { SQL.push({ text: String(text), params }); return onQuery(String(text), params); };
base.withTransaction = async fn => fn({ query: async (text, params) => { SQL.push({ text: String(text), params, tx: true }); return onQuery(String(text), params); } });

const store = require(path.join(SRC, 'store'));
const { catalog } = require(path.join(SRC, 'store/pg/catalog'));
const REAL = { ...catalog };   // ตัวจริงก่อนเทสต์เส้น API แทน store.catalog.* ด้วยตัวจำลอง
const { contentExport } = require(path.join(SRC, 'store/pg/contentExport'));
const families = require(path.join(SRC, 'store/productFamilies'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;
before(async () => { web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/products.js')).href); });
beforeEach(() => { SQL.length = 0; onQuery = async () => ({ rows: [], rowCount: 0 }); });

const BTA4 = ['BTA4-00', 'BTA4-01', 'BTA4-02', 'BTA4-03', 'BTA4-04', 'BTA4-05', 'BTA4-06', 'BTA4-07'];
const BTA2 = ['BTA2-01', 'BTA2-02', 'BTA2-03'];
// แถว catalog_products แบบที่ server อ่านได้ (GET /api/catalog ส่งรูปนี้ให้หน้าเว็บ)
const ROWS = [
    { code: 'JNPSET1', name: 'All true your day mini parfum set', brand: 'Jernis', hidden: false, set_items: ['JNP1', 'JNP2', 'JNP3'] },
    { code: 'JNPSET2', name: 'เซ็ตมีตัวซ่อน', brand: 'Jernis', hidden: false, set_items: ['jnp3', ' JNP4 ', 'JNP3', 'bad code', 5, null, 'JNPSET2'] },
    { code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: true, set_items: [] },
    { code: 'BTASET1', name: 'เซ็ตบิวเทอร์รี่', brand: 'Beauterry', hidden: false, set_items: ['BTA4-01', 'BTA2-02'] },
    // ข้อมูลที่หลุด API มา (ซ้อนเซ็ต) — ไม่กางซ้อน ถือเป็นรหัสธรรมดา ทั้งสองฝั่ง
    { code: 'NESTSET1', name: 'ซ้อน', brand: 'Jernis', hidden: false, set_items: ['JNPSET1'] },
    { code: 'NOSET1', name: 'ไม่ใช่เซ็ต', brand: 'Jernis', hidden: false, set_items: [] },
    { code: 'OLDROW1', name: 'แถวจากฐานก่อนมีคอลัมน์', brand: 'Jernis', hidden: false }
];
const serverMap = () => families.familyMapWith(ROWS);

// ---------------------------------------------------------------- กางเซ็ต: หน้าเว็บ = server
test('กางเซ็ต: JNPSET1 → JNP1, JNP2, JNP3 ทั้งช่อง PRODUCTS หน้า Ads และฟีด · ป้ายใต้ชื่อ KOL ยังเป็น JNPSET1', () => {
    web.applyCatalogOverlay({ products: ROWS, targets: [] });
    const map = serverMap();
    const CASES = [
        ['JNPSET1', ['JNP1', 'JNP2', 'JNP3']],
        ['jnpset1', ['JNP1', 'JNP2', 'JNP3']],
        ['JNPSET1 All true your day mini parfum set', ['JNP1', 'JNP2', 'JNP3']],
        ['JNPSET1, JNP1', ['JNP1', 'JNP2', 'JNP3']],
        ['JNP2, JNPSET1', ['JNP2', 'JNP1', 'JNP3']],
        ['JNP1,JNP2,JNP3,JNPSET1', ['JNP1', 'JNP2', 'JNP3']],          // ชุดรวม (รวมเป็นชุด) ที่มีทั้งเซ็ตและสินค้าข้างใน
        [['JNPSET1'], ['JNP1', 'JNP2', 'JNP3']],
        ['JNPSET2', ['JNP3', 'JNP4']],                                   // แถวสกปรก: ตัวพิมพ์เล็ก/ช่องว่าง/ซ้ำ/รูปผิด/ไม่ใช่ข้อความ/ตัวเอง ทิ้ง · ตัวที่ซ่อนยังกาง
        ['BTASET1', [...BTA4, ...BTA2]],                                 // สินค้าข้างในที่มีหลายสี กางทุกสีต่อ
        ['NESTSET1', ['JNPSET1']],                                       // ไม่กางซ้อน
        ['NOSET1', ['NOSET1']],
        ['OLDROW1', ['OLDROW1']],
        ['JNPSET9', ['JNPSET9']],                                        // ไม่มีในคลัง = ตามเดิม
        ['BTA4-01', BTA4],                                               // กลุ่มสีเดิมไม่เปลี่ยน
        ['JNP1', ['JNP1']],
        ['', []]
    ];
    for (const [input, want] of CASES) {
        assert.deepEqual(web.expandProductFamilies(input), want, 'web ' + JSON.stringify(input));
        assert.deepEqual(families.expandProductFamilies(input, map), want, 'server ' + JSON.stringify(input));
    }
    // ทุกรหัสในคลัง (รวมที่เพิ่มเอง) กางเหมือนกันสองฝั่ง
    for (const p of web.PRODUCT_CATALOG) assert.deepEqual(families.expandProductFamilies(p.code, map), web.expandProductFamilies(p.code), p.code);
    const all = web.PRODUCT_CATALOG.map(p => p.code).join(',');
    assert.deepEqual(families.expandProductFamilies(all, map), web.expandProductFamilies(all));
    // ใต้ชื่อ KOL = รหัสที่รีวิวจริง ไม่กาง
    assert.deepEqual(web.clipProductLabels('JNPSET1'), ['JNPSET1']);
    assert.deepEqual(web.clipProductLabels('JNPSET1 All true your day mini parfum set'), ['JNPSET1']);
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.deepEqual(web.expandProductFamilies('JNPSET1'), ['JNPSET1'], 'ไม่มีส่วนต่าง = ไม่มีเซ็ต');
});

test('เซ็ตชนะกลุ่มสี (ข้อมูลที่หลุด API มา) — สองฝั่งยังได้ผลเดียวกัน · ไม่มีเซ็ต = กลุ่มสีเดิมตัวเดิม', () => {
    const rows = [{ code: 'BTA4-08', name: 'คุชชั่นใหม่', brand: 'Beauterry', hidden: false, set_items: ['BTA2-01'] }];
    web.applyCatalogOverlay({ products: rows, targets: [] });
    const map = families.familyMapWith(rows);
    for (const code of ['BTA4-08', 'BTA4-01', 'BTA2-03']) assert.deepEqual(families.expandProductFamilies(code, map), web.expandProductFamilies(code), code);
    assert.deepEqual(web.expandProductFamilies('BTA4-08'), BTA2);
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.equal(families.familyMapWith([]), families.familyMapWith(null));
    assert.equal(families.familyMapWith([{ code: 'JNP4', brand: 'Jernis', set_items: [] }]).get('JNP4'), undefined);
    assert.ok(!families.familiesWith(ROWS).has('JNPSET1'), 'familiesWith = กลุ่มสีอย่างเดียว');
    assert.deepEqual(families.setItemsOf(ROWS[1]), ['JNP3', 'JNP4']);
    assert.deepEqual(families.setItemsOf(null), []);
    assert.deepEqual(families.setItemsOf({ code: 'X1', set_items: 'JNP1' }), []);
});

test('คลังหน้าเว็บ: productSetItems / isProductSet / setsContaining / productInfo.items · คืนสำเนา', () => {
    web.applyCatalogOverlay({ products: ROWS, targets: [] });
    assert.deepEqual(web.productSetItems('JNPSET1'), ['JNP1', 'JNP2', 'JNP3']);
    assert.deepEqual(web.productSetItems('jnpset1'), ['JNP1', 'JNP2', 'JNP3']);
    assert.deepEqual(web.productSetItems('JNPSET2'), ['JNP3', 'JNP4']);
    assert.deepEqual(web.productSetItems('JNP1'), []);
    assert.deepEqual(web.productSetItems('NOPE1'), []);
    assert.equal(web.isProductSet('JNPSET1'), true);
    assert.equal(web.isProductSet('JNP4'), false);
    assert.deepEqual(web.setsContaining('JNP3'), ['JNPSET1', 'JNPSET2']);
    assert.deepEqual(web.setsContaining('JNP4'), ['JNPSET2']);
    assert.deepEqual(web.setsContaining('JNPSET1'), ['NESTSET1']);
    assert.deepEqual(web.productInfo('JNPSET1').items, ['JNP1', 'JNP2', 'JNP3']);
    assert.deepEqual(web.productInfo('JNP1').items, [], 'สินค้าตั้งต้น = ไม่ใช่เซ็ต');
    web.productInfo('JNPSET1').items.push('X');
    web.productSetItems('JNPSET1').push('X');
    web.getCatalogOverlay().products[0].set_items.push('X');
    assert.deepEqual(web.productSetItems('JNPSET1'), ['JNP1', 'JNP2', 'JNP3']);
    assert.deepEqual(web.expandProductFamilies('JNPSET1'), ['JNP1', 'JNP2', 'JNP3']);
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.equal(web.isProductSet('JNPSET1'), false);
});

// ---------------------------------------------------------------- ฟีดยิงแอด
test('ฟีด content-candidates: คลิปรีวิว JNPSET1 → product "JNP1, JNP2, JNP3" · Target ยังคิดจากรหัสเซ็ต · ฐานยังไม่มีคอลัมน์ = ส่งตามเดิม', async () => {
    const candidate = { submission_id: 1, id_post: '7600000000000000001', gencode: 'GC', brand: 'Jernis', platform: 'TikTok', status: 'confirmed',
        ad_status: 'ยังไม่ยิง', post_check: null, post_url: 'u', post_date: '2026-11-01', product: 'JNPSET1', group_key: 'g1',
        ad_groups: [{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['JNPSET1'], product_targets: { JNPSET1: ['F_Parfume_18_44'] } }] }], updated_at: 't' };
    onQuery = async text => {
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'JNPSET1', brand: 'Jernis', set_items: ['JNP1', 'JNP2', 'JNP3'] }] };
        return { rows: [candidate] };
    };
    const [item] = await contentExport.listCandidates({ brand: 'Jernis', limit: 10 });
    assert.equal(item.product, 'JNP1, JNP2, JNP3');
    assert.deepEqual(item.target, ['F_Parfume_18_44']);
    // ยังไม่ setup-db (42703) = อ่านแบบเดิม ไม่มีเซ็ต ฟีดไม่ล่ม
    onQuery = async text => {
        if (/set_items/.test(text)) { const e = new Error('column "set_items" does not exist'); e.code = '42703'; throw e; }
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'JNPSET1', brand: 'Jernis' }] };
        return { rows: [candidate] };
    };
    const [item2] = await contentExport.listCandidates({ brand: 'Jernis', limit: 10 });
    assert.equal(item2.product, 'JNPSET1');
});

// ---------------------------------------------------------------- ชั้น SQL
const noColumn = () => { const e = new Error('column "set_items" does not exist'); e.code = '42703'; return e; };
const noTable = () => { const e = new Error('relation does not exist'); e.code = '42P01'; return e; };

test('store อ่าน: overlay / familyProducts / findProduct ส่ง set_items (null = []) · sets: true', async () => {
    onQuery = async text => {
        if (/FROM catalog_targets/.test(text)) return { rows: [] };
        if (/SELECT code, brand, set_items/.test(text)) return { rows: [{ code: 'JNPSET1', brand: 'Jernis', set_items: ['JNP1'] }, { code: 'JNP4', brand: 'Jernis', set_items: null }] };
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'JNPSET1', name: 'n', brand: 'Jernis', set_items: ['JNP1'] }, { code: 'JNP4', name: 'v', brand: 'Jernis', set_items: null }] };
        return { rows: [] };
    };
    const o = await REAL.overlay();
    assert.equal(o.ready, true);
    assert.equal(o.sets, true);
    assert.deepEqual(o.products.map(p => [p.code, p.set_items]), [['JNP4', []], ['JNPSET1', ['JNP1']]]);
    assert.match(SQL.find(q => /FROM catalog_products/.test(q.text)).text, /, set_items FROM catalog_products/);
    assert.deepEqual(await REAL.familyProducts(), [{ code: 'JNP4', brand: 'Jernis', set_items: [] }, { code: 'JNPSET1', brand: 'Jernis', set_items: ['JNP1'] }]);
    SQL.length = 0;
    assert.deepEqual((await REAL.findProduct('JNPSET1')).set_items, ['JNP1']);
    assert.deepEqual(SQL[0].params, ['JNPSET1']);
    assert.match(SQL[0].text, /WHERE code = \$1/);
});

test('store อ่าน: ยังไม่มีคอลัมน์ set_items (42703) = อ่านแบบเดิม ไม่มีเซ็ต (sets: false) · ยังไม่มีตาราง = ready:false เหมือนเดิม', async () => {
    onQuery = async text => {
        if (/set_items/.test(text)) throw noColumn();
        if (/FROM catalog_targets/.test(text)) return { rows: [] };
        if (/SELECT code, brand FROM/.test(text)) return { rows: [{ code: 'JNPSET1', brand: 'Jernis' }] };
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'JNPSET1', name: 'n', brand: 'Jernis' }] };
        return { rows: [] };
    };
    const o = await REAL.overlay();
    assert.deepEqual([o.ready, o.sets], [true, false]);
    assert.deepEqual(o.products[0].set_items, []);
    assert.deepEqual(await REAL.familyProducts(), [{ code: 'JNPSET1', brand: 'Jernis', set_items: [] }]);
    assert.deepEqual((await REAL.findProduct('JNPSET1')).set_items, []);
    onQuery = async () => { throw noTable(); };
    assert.deepEqual(await REAL.overlay(), { ready: false, sets: false, products: [], targets: [] });
    assert.deepEqual(await REAL.familyProducts(), []);
    await assert.rejects(REAL.findProduct('JNPSET1'), e => e.status === 503);
});

test('store เขียน: เพิ่มสินค้าพร้อมเซ็ต (transaction เดียว) · ไม่มีเซ็ต = INSERT แบบเดิม · ตั้ง/ล้างเซ็ต · ยังไม่ setup-db = 503', async () => {
    onQuery = async text => (/INSERT INTO catalog_products/.test(text) ? { rows: [{ code: 'JNPSET3' }] } : { rows: [{ id: 1 }] });
    await REAL.addProduct({ code: 'JNPSET3', name: 'เซ็ต 3', brand: 'Jernis', items: ['JNP1', 'JNP2'] }, { byId: 7, byName: 'แอดมิน' }, ['F_A']);
    assert.ok(SQL.every(q => q.tx));
    assert.match(SQL[0].text, /INSERT INTO catalog_products \([^)]*set_items\)[^]*\$6::text\[\]/);
    assert.deepEqual(SQL[0].params, ['JNPSET3', 'เซ็ต 3', 'Jernis', 7, 'แอดมิน', ['JNP1', 'JNP2']]);
    SQL.length = 0;
    await REAL.addProduct({ code: 'JNP5', name: 'x', brand: 'Jernis', items: [] });
    assert.doesNotMatch(SQL[0].text, /set_items/, 'ไม่มีเซ็ต = ไม่แตะคอลัมน์ใหม่ (ใช้ได้แม้ยังไม่ setup-db)');
    SQL.length = 0;
    onQuery = async () => ({ rows: [{ code: 'JNPSET1', set_items: ['JNP1', 'JNP2', 'JNP3'] }] });
    const row = await REAL.setSetItems('JNPSET1', ['JNP1', 'JNP2', 'JNP3'], { byId: 7, byName: 'แอดมิน' });
    assert.deepEqual(row.set_items, ['JNP1', 'JNP2', 'JNP3']);
    assert.match(SQL[0].text, /UPDATE catalog_products SET set_items = \$2::text\[\], updated_at = now\(\), updated_by = \$3\s+WHERE code = \$1/);
    assert.deepEqual(SQL[0].params, ['JNPSET1', ['JNP1', 'JNP2', 'JNP3'], 'แอดมิน']);
    onQuery = async () => ({ rows: [] });
    assert.equal(await REAL.setSetItems('NOPE1', []), null, 'ไม่มีแถว = null');
    onQuery = async () => { throw noColumn(); };
    await assert.rejects(REAL.setSetItems('JNPSET1', ['JNP1']), e => e.status === 503 && /สินค้าในเซ็ต[^]*setup-db/.test(e.message));
    await assert.rejects(REAL.addProduct({ code: 'JNPSET3', name: 'x', brand: 'Jernis', items: ['JNP1'] }), e => e.status === 503 && /setup-db/.test(e.message));
    onQuery = async () => { throw noTable(); };
    await assert.rejects(REAL.setSetItems('JNPSET1', ['JNP1']), e => e.status === 503 && /setup-db/.test(e.message));
});

test('store เขียน + verify: ล็อก advisory → อ่านคลังในธุรกรรม → ตรวจ → เขียน · ไม่ผ่าน = ไม่เขียนอะไร · ยังไม่มีคอลัมน์ = อ่านแค่ code, brand', async () => {
    const LOCKED = [{ code: 'JNPSET2', brand: 'Jernis', set_items: ['JNP1'] }, { code: 'JNP4', brand: 'Jernis', set_items: null }];
    let has = true;
    onQuery = async text => {
        if (/information_schema\.columns/.test(text)) return { rows: [{ has }] };
        if (/SELECT code, brand(, set_items)? FROM catalog_products/.test(text)) return { rows: LOCKED.map(r => (has ? r : { code: r.code, brand: r.brand })) };
        if (/UPDATE catalog_products/.test(text)) return { rows: [{ code: 'JNPSET1', set_items: ['JNP1'] }] };
        if (/INSERT INTO catalog_products/.test(text)) return { rows: [{ code: 'JNPSET3' }] };
        return { rows: [] };
    };
    const seen = [];
    const pass = async rows => { seen.push(rows); return null; };
    await REAL.setSetItems('JNPSET1', ['JNP1'], { byName: 'แอดมิน' }, pass);
    assert.ok(SQL.every(q => q.tx), 'ทั้งหมดในธุรกรรมเดียว');
    assert.match(SQL[0].text, /pg_advisory_xact_lock\(hashtext\('catalog_product_sets'\)\)/);
    assert.match(SQL[2].text, /SELECT code, brand, set_items FROM catalog_products/);
    assert.match(SQL[3].text, /UPDATE catalog_products/);
    assert.deepEqual(seen[0], [{ code: 'JNPSET2', brand: 'Jernis', set_items: ['JNP1'] }, { code: 'JNP4', brand: 'Jernis', set_items: [] }]);
    // ไม่ผ่าน = error ตามสถานะที่ตัวตรวจบอก · ไม่มีคำสั่งเขียน
    SQL.length = 0;
    await assert.rejects(REAL.setSetItems('JNPSET1', ['JNP1'], {}, async () => ({ status: 409, message: 'JNP1 อยู่ในเซ็ตแล้ว' })),
        e => e.status === 409 && e.message === 'JNP1 อยู่ในเซ็ตแล้ว');
    assert.equal(SQL.filter(q => /UPDATE|INSERT/.test(q.text)).length, 0);
    SQL.length = 0;
    await assert.rejects(REAL.addProduct({ code: 'BTAS1-02', name: 'x', brand: 'Beauterry' }, {}, [], async () => ({ status: 409, message: 'กลุ่มสีเดียวกับเซ็ต' })),
        e => e.status === 409);
    assert.equal(SQL.filter(q => /INSERT/.test(q.text)).length, 0);
    // เพิ่มสินค้าธรรมดาตอนยังไม่ setup-db: เช็คคอลัมน์ก่อน (ไม่ให้ error ทำธุรกรรมเสีย) แล้วอ่านแค่ code, brand
    has = false;
    SQL.length = 0;
    seen.length = 0;
    await REAL.addProduct({ code: 'JNP6', name: 'x', brand: 'Jernis' }, {}, [], pass);
    assert.match(SQL[2].text, /SELECT code, brand FROM catalog_products/);
    assert.deepEqual(seen[0].map(r => r.set_items), [[], []]);
    assert.match(SQL[3].text, /INSERT INTO catalog_products/);
    // ไม่ส่ง verify = ไม่ล็อก ไม่อ่าน (เหมือนเดิม)
    SQL.length = 0;
    await REAL.addProduct({ code: 'JNP7', name: 'x', brand: 'Jernis' });
    assert.equal(SQL.length, 1);
});

test('schema: คอลัมน์ set_items ต่อท้ายตาราง catalog_products · ค่าเริ่มต้นคงที่ (ไม่เขียนแถวเดิม)', () => {
    const schema = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    const create = schema.indexOf('CREATE TABLE IF NOT EXISTS catalog_products');
    const alter = schema.indexOf("ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS set_items TEXT[] NOT NULL DEFAULT '{}';");
    assert.ok(create > 0 && alter > create, 'ALTER ต้องอยู่หลัง CREATE TABLE');
});

// ---------------------------------------------------------------- เส้น API
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', nickname: 'แอดมิน', role: 'admin', status: 'active', is_active: true, team_id: 1, team_name: 'Admin', brands: [] },
    2: { id: 2, username: 'ads-mem', nickname: 'อังกอร์', role: 'member', status: 'active', is_active: true, team_id: 3, team_name: 'Ads', brands: ['Jernis'] },
    3: { id: 3, username: 'kol-mem', role: 'member', status: 'active', is_active: true, team_id: 2, team_name: 'KOL', brands: ['Jernis'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const LOG = [];
store.activity.log = async e => { LOG.push(e); return e; };
const CALLS = [];
let OVERLAY_FAIL = null;
const OV_ROWS = () => [
    { code: 'JNPSET1', name: 'All true your day mini parfum set', brand: 'Jernis', hidden: false, set_items: [] },
    { code: 'JNPSET2', name: 'เซ็ต 2', brand: 'Jernis', hidden: false, set_items: ['JNP1', 'JNP4'] },
    { code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: true, set_items: [] },
    { code: 'JNP5', name: 'Velvet Dusk', brand: 'Jernis', hidden: false, set_items: [] },
    { code: 'BTA4-08', name: 'คุชชั่นใหม่', brand: 'Beauterry', hidden: false, set_items: [] },
    { code: 'BTASET1', name: 'เซ็ตบิวเทอร์รี่', brand: 'Beauterry', hidden: false, set_items: [] },
    { code: 'L3', name: 'แถวซ่อนสินค้าตั้งต้น', brand: "Jula's Herb", hidden: true, set_items: [] },
    // เซ็ตที่รหัสหน้าตาแบบสี (Beauterry ตัดเลขท้ายขีด = กลุ่ม BTAS1 มีตัวเดียว) — เพิ่ม BTAS1-02 ทีหลังต้องไม่ได้ (ผลรีวิว 11 พ.ย.)
    { code: 'BTAS1-01', name: 'เซ็ตหน้าตาแบบสี', brand: 'Beauterry', hidden: false, set_items: ['BTA1-01'] },
    // Jula's Herb เพิ่ม T6B คู่กับสินค้าตั้งต้น T6A (ไม่มีในกลุ่มที่เขียนไว้ฝั่ง server) = หน้าเว็บเห็นเป็นกลุ่มสี T6
    { code: 'T6B', name: 'ทินท์สีใหม่', brand: "Jula's Herb", hidden: false, set_items: [] }
];
// ตัวจำลองตรวจซ้ำใต้ล็อกแบบเดียวกับ pg/catalog.js runVerify — LOCKED_ROWS = คลังตอนบันทึก (จำลองคนอื่นบันทึกแทรก)
let LOCKED_ROWS = null;
async function runVerify(verify) {
    if (typeof verify !== 'function') return;
    const p = await verify(LOCKED_ROWS || OV_ROWS());
    if (p) { const e = new Error(p.message); e.status = p.status; throw e; }
}
store.catalog.overlay = async () => { if (OVERLAY_FAIL) throw OVERLAY_FAIL; return { ready: true, sets: true, products: OV_ROWS(), targets: [] }; };
store.catalog.findProduct = async code => { CALLS.push(['findProduct', code]); return OV_ROWS().find(p => p.code === code) || null; };
for (const m of ['setProduct', 'setTargets']) store.catalog[m] = async (...a) => { CALLS.push([m, ...a]); return { ok: true }; };
store.catalog.addProduct = async (...a) => { await runVerify(a[3]); CALLS.push(['addProduct', ...a]); return { ok: true }; };
store.catalog.setSetItems = async (...a) => { await runVerify(a[3]); CALLS.push(['setSetItems', ...a]); return OV_ROWS().find(p => p.code === a[0]) ? { code: a[0], set_items: a[1] } : null; };

let server, baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = 'http://127.0.0.1:' + server.address().port; });
after(async () => {
    if (web) web.applyCatalogOverlay({ products: [], targets: [] });
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end().catch(() => {});
});
const call = async (uid, method, url, body) => {
    const a = ACCOUNTS[uid];
    const token = jwt.sign({ id: a.id, username: a.username, role: a.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/catalog' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
};
const reset = () => { CALLS.length = 0; LOG.length = 0; OVERLAY_FAIL = null; LOCKED_ROWS = null; };
const setCalls = () => CALLS.filter(c => c[0] === 'setSetItems');

test('PATCH items: ตั้งเซ็ต JNPSET1 = JNP1, JNP2, JNP3 (ตัวพิมพ์ใหญ่ ไม่ซ้ำ) · ลง Activity Log · ตอบส่วนต่างล่าสุด (sets: true)', async () => {
    reset();
    const r = await call(1, 'PATCH', '/products/jnpset1', { items: ['jnp1', 'JNP2', ' JNP3 ', 'JNP2'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.sets, true);
    assert.deepEqual(setCalls().map(c => c.slice(1, 3)), [['JNPSET1', ['JNP1', 'JNP2', 'JNP3']]]);
    assert.equal(setCalls()[0][3].byName, 'แอดมิน');
    assert.equal(LOG.at(-1).project_name, 'Products & Targets');
    assert.equal(LOG.at(-1).summary, 'ตั้งสินค้าในเซ็ต JNPSET1: JNP1, JNP2, JNP3');
    // สินค้าที่ซ่อนอยู่ใส่ในเซ็ตได้ (คลิปเก่ายังต้องกางครบ) · แก้เซ็ตเดิม = บอกค่าเดิมใน log
    reset();
    assert.equal((await call(1, 'PATCH', '/products/JNPSET2', { items: ['JNP4', 'JNP5'] })).status, 200);
    assert.equal(LOG.at(-1).summary, 'ตั้งสินค้าในเซ็ต JNPSET2: JNP4, JNP5 (เดิม JNP1, JNP4)');
    // [] = ไม่เป็นเซ็ตแล้ว
    reset();
    assert.equal((await call(1, 'PATCH', '/products/JNPSET2', { items: [] })).status, 200);
    assert.deepEqual(setCalls().map(c => c.slice(1, 3)), [['JNPSET2', []]]);
    assert.equal(LOG.at(-1).summary, 'JNPSET2 ไม่เป็นเซ็ตแล้ว (เดิม JNP1, JNP4)');
});

test('PATCH items ไม่ผ่าน: สินค้าตั้งต้น / ไม่มีในคลัง / ข้ามแบรนด์ / ซ้อนเซ็ต / อยู่ในเซ็ตอื่น / กลุ่มสี / ตัวเอง / รูปผิด / เกิน 30 — ไม่บันทึกอะไร', async () => {
    const thirtyOne = Array.from({ length: 31 }, (_, i) => 'JNP' + (i + 10));
    for (const [url, body, status, re] of [
        ['/products/JNP1', { items: ['JNP2'] }, 400, /สินค้าตั้งต้น/],                     // ตั้งต้น ไม่มีแถว
        ['/products/L3', { items: ['L10'] }, 400, /สินค้าตั้งต้น/],                         // ตั้งต้นที่มีแถวซ่อน
        ['/products/ZZZ9', { items: ['JNP1'] }, 404, /ไม่มีสินค้า ZZZ9/],
        ['/products/JNPSET1', { items: ['JNP9'] }, 400, /ไม่มีสินค้า JNP9 ในคลัง/],
        ['/products/JNPSET1', { items: ['JNP1', 'BTA4-01'] }, 400, /BTA4-01 \(Beauterry\) ไม่ใช่สินค้าของ Jernis/],
        ['/products/JNPSET1', { items: ['JNPSET2'] }, 409, /JNPSET2 เป็นเซ็ตอยู่แล้ว/],
        ['/products/JNP4', { items: ['JNP5'] }, 409, /JNP4 อยู่ในเซ็ต JNPSET2 แล้ว/],
        ['/products/BTA4-08', { items: ['BTA1-01'] }, 409, /กลุ่มสี/],
        ['/products/JNPSET1', { items: ['JNPSET1', 'JNP1'] }, 400, /ของตัวเอง/],
        ['/products/JNPSET1', { items: ['bad code'] }, 400, /ใช้ไม่ได้/],
        ['/products/JNPSET1', { items: 'JNP1,JNP2' }, 400, /รายการ/],
        ['/products/JNPSET1', { items: null }, 400, /รายการ/],
        ['/products/JNPSET1', { items: thirtyOne }, 400, /ไม่เกิน 30/]
    ]) {
        reset();
        const r = await call(1, 'PATCH', url, body);
        assert.equal(r.status, status, url + ' ' + JSON.stringify(body) + ' → ' + JSON.stringify(r.body));
        assert.match(r.body.message, re, url);
        assert.equal(setCalls().length, 0, url);
        assert.equal(LOG.length, 0, url);
    }
    // เอาออกจากการเป็นเซ็ต ([]) ไม่ต้องผ่านด่านตรวจสินค้า (เช่นสินค้าที่อยู่ในเซ็ตอื่น ล้างเซ็ตเก่าของตัวเองได้)
    reset();
    assert.equal((await call(1, 'PATCH', '/products/JNP4', { items: [] })).status, 200);
});

test('PATCH items: อ่านคลังไม่ได้ = 503 ไม่ปล่อยผ่าน · ทีม Ads แก้ได้เฉพาะเซ็ตของแบรนด์ตัวเอง · ทีมอื่น 403', async () => {
    reset();
    OVERLAY_FAIL = new Error('Connection terminated unexpectedly');
    const r = await call(1, 'PATCH', '/products/JNPSET1', { items: ['JNP1'] });
    assert.equal(r.status, 503);
    assert.equal(setCalls().length, 0);
    reset();
    assert.equal((await call(2, 'PATCH', '/products/JNPSET1', { items: ['JNP1', 'JNP2', 'JNP3'] })).status, 200, 'ทีม Ads แบรนด์ Jernis');
    reset();
    assert.equal((await call(2, 'PATCH', '/products/BTASET1', { items: ['BTA1-01'] })).status, 403, 'ทีม Ads แบรนด์อื่น');
    assert.equal((await call(3, 'PATCH', '/products/JNPSET1', { items: ['JNP1'] })).status, 403, 'ทีม KOL');
    assert.equal(setCalls().length, 0);
});

test('POST /products พร้อมสินค้าในเซ็ต: ส่งไปในก้อนเดียวกับสินค้า · ไม่ส่ง / [] = แบบเดิม · ตรวจเหมือน PATCH', async () => {
    reset();
    const ok = await call(1, 'POST', '/products', { code: 'jnpset3', name: 'เซ็ต 3', brand: 'Jernis', items: ['JNP2', 'jnp1'], targets: ['F_Parfume_18_44'] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const add = CALLS.find(c => c[0] === 'addProduct');
    assert.deepEqual(add[1], { code: 'JNPSET3', name: 'เซ็ต 3', brand: 'Jernis', items: ['JNP2', 'JNP1'] });
    assert.deepEqual(add[3], ['F_Parfume_18_44']);
    assert.equal(LOG.at(-1).summary, 'เพิ่มสินค้า JNPSET3 - เซ็ต 3 (Jernis) · Target: F_Parfume_18_44 · สินค้าในเซ็ต: JNP2, JNP1');
    for (const items of [undefined, []]) {
        reset();
        assert.equal((await call(1, 'POST', '/products', { code: 'JNP6', name: 'x', brand: 'Jernis', ...(items ? { items } : {}) })).status, 201);
        assert.deepEqual(CALLS.find(c => c[0] === 'addProduct')[1], { code: 'JNP6', name: 'x', brand: 'Jernis' }, 'ไม่มีคีย์ items');
    }
    for (const [body, status, re] of [
        [{ code: 'JNPSET4', name: 'x', brand: 'Jernis', items: ['BTA4-01'] }, 400, /ไม่ใช่สินค้าของ Jernis/],
        [{ code: 'JNPSET4', name: 'x', brand: 'Jernis', items: ['JNPSET2'] }, 409, /เป็นเซ็ตอยู่แล้ว/],
        [{ code: 'JNPSET4', name: 'x', brand: 'Jernis', items: ['JNPSET4'] }, 400, /ของตัวเอง/],
        [{ code: 'JNPSET4', name: 'x', brand: 'Jernis', items: 'JNP1' }, 400, /รายการ/],
        [{ code: 'BTA4-09', name: 'x', brand: 'Beauterry', items: ['BTA1-01'] }, 409, /กลุ่มสี/]
    ]) {
        reset();
        const r = await call(1, 'POST', '/products', body);
        assert.equal(r.status, status, JSON.stringify(body) + ' → ' + JSON.stringify(r.body));
        assert.match(r.body.message, re);
        assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
    }
    reset();
    OVERLAY_FAIL = new Error('boom');
    const down = await call(1, 'POST', '/products', { code: 'JNPSET4', name: 'x', brand: 'Jernis', items: ['JNP1'] });
    assert.equal(down.status, 503, 'ตรวจเซ็ตไม่ได้ = ไม่บันทึก (แม้เป็น admin)');
    assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
});

// ---------------------------------------------------------------- ผลรีวิว 11 พ.ย.: เซ็ตต้องไม่ไปอยู่ในกลุ่มสี · สองคนบันทึกพร้อมกัน
test('เพิ่มสีพี่น้องของรหัสที่เป็นเซ็ต (BTAS1-01 เป็นเซ็ต → เพิ่ม BTAS1-02) = 409 ไม่บันทึก · สินค้าธรรมดาอื่นเพิ่มได้ตามเดิม', async () => {
    reset();
    const r = await call(1, 'POST', '/products', { code: 'BTAS1-02', name: 'สีใหม่', brand: 'Beauterry' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.message, /BTAS1-02 จะไปเข้ากลุ่มสีเดียวกับเซ็ต BTAS1-01/);
    assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
    reset();
    assert.equal((await call(1, 'POST', '/products', { code: 'BTA6-01', name: 'สินค้าใหม่', brand: 'Beauterry' })).status, 201);
    assert.equal(typeof CALLS.find(c => c[0] === 'addProduct')[4], 'function', 'ส่งตัวตรวจซ้ำให้ store');
    reset();
    assert.equal((await call(1, 'POST', '/products', { code: 'JNP6', name: 'x', brand: 'Jernis' })).status, 201);
});

test('กลุ่มสีที่หน้าเว็บเห็นจากสินค้าตั้งต้นตัวเดี่ยว (T6A + T6B ที่เพิ่ม) — ตั้ง T6B เป็นเซ็ตไม่ได้ · เพิ่ม T6C ตอน T6B เป็นเซ็ตไม่ได้', async () => {
    reset();
    const r = await call(1, 'PATCH', '/products/T6B', { items: ['L3', 'L10'] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.message, /T6B อยู่ในกลุ่มสี/);
    assert.equal(setCalls().length, 0);
    // แถวจำลองที่ T6B เป็นเซ็ตไปแล้ว (ข้อมูลเก่า) → เพิ่ม T6C ต้องไม่ได้
    reset();
    const rows = OV_ROWS().map(p => (p.code === 'T6B' ? { ...p, set_items: ['L3'] } : p));
    const saved = store.catalog.overlay;
    store.catalog.overlay = async () => ({ ready: true, sets: true, products: rows, targets: [] });
    try {
        const r2 = await call(1, 'POST', '/products', { code: 'T6C', name: 'สีที่สาม', brand: "Jula's Herb" });
        assert.equal(r2.status, 409, JSON.stringify(r2.body));
        assert.match(r2.body.message, /เซ็ต T6B/);
    } finally { store.catalog.overlay = saved; }
    // หน้าเว็บ: ปุ่มเซ็ตไม่ขึ้นให้รหัสในกลุ่มสี (inColorFamily) — กติกาเดียวกับ server
    web.applyCatalogOverlay({ products: OV_ROWS(), targets: [] });
    assert.equal(web.inColorFamily('T6B'), true);
    assert.equal(web.inColorFamily('BTA4-08'), true);
    assert.equal(web.inColorFamily('JNPSET1'), false);
    assert.equal(web.inColorFamily('BTAS1-01'), false);
    web.applyCatalogOverlay({ products: [], targets: [] });
});

test('ตรวจซ้ำตอนบันทึก: คลังเปลี่ยนระหว่างนั้น (อีกคนเพิ่งตั้ง JNP5 เป็นเซ็ต) = 409 ไม่บันทึก · ไม่มี log', async () => {
    reset();
    LOCKED_ROWS = OV_ROWS().map(p => (p.code === 'JNP5' ? { ...p, set_items: ['JNP2'] } : p));
    const r = await call(1, 'PATCH', '/products/JNPSET1', { items: ['JNP5'] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.message, /JNP5 เป็นเซ็ตอยู่แล้ว/);
    assert.equal(setCalls().length, 0);
    assert.equal(LOG.length, 0);
    // กลับกัน: อีกคนเพิ่งใส่ JNP5 ไว้ในเซ็ต JNPSET1 → ตั้ง JNP5 เป็นเซ็ตไม่ได้
    reset();
    LOCKED_ROWS = OV_ROWS().map(p => (p.code === 'JNPSET1' ? { ...p, set_items: ['JNP5'] } : p));
    const r2 = await call(1, 'PATCH', '/products/JNP5', { items: ['JNP2'] });
    assert.equal(r2.status, 409);
    assert.match(r2.body.message, /JNP5 อยู่ในเซ็ต JNPSET1 แล้ว/);
    // POST: อีกคนเพิ่งตั้ง JNP5 เป็นเซ็ต
    reset();
    LOCKED_ROWS = OV_ROWS().map(p => (p.code === 'JNP5' ? { ...p, set_items: ['JNP2'] } : p));
    const r3 = await call(1, 'POST', '/products', { code: 'JNPSET5', name: 'x', brand: 'Jernis', items: ['JNP5'] });
    assert.equal(r3.status, 409);
    assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
});
