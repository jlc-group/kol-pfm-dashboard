const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// หน้า Products & Targets (เมนู ADMIN · ผู้ใช้สั่ง 7 ต.ค. 2026) — Admin เพิ่มสินค้า / Target / ซ่อน ได้เอง
// ฐานเก็บเฉพาะส่วนต่างจากรายการตั้งต้นในโค้ด · ตารางเสริม (ยังไม่ setup-db = ใช้รายการตั้งต้น) · ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-catalog-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in catalog test'); };
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
// เก็บตัวจริงไว้ก่อน — ส่วนเทสต์เส้น API ด้านล่างแทน store.catalog.* (object เดียวกัน) ด้วยตัวจำลอง
const REAL = { ...catalog };
const { contentExport } = require(path.join(SRC, 'store/pg/contentExport'));
const families = require(path.join(SRC, 'store/productFamilies'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;
before(async () => { web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/products.js')).href); });
after(() => {
    if (web) web.applyCatalogOverlay({ products: [], targets: [] });
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    return pool.end().catch(() => {});
});
beforeEach(() => { SQL.length = 0; onQuery = async () => ({ rows: [], rowCount: 0 }); });

const OVERLAY = {
    products: [
        { code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: false },
        { code: 'BTA5-02', name: 'บิวเทอร์รี่ ใหม่ 2', brand: 'Beauterry', hidden: false },
        { code: 'BTA5-01', name: 'บิวเทอร์รี่ ใหม่ 1', brand: 'Beauterry', hidden: false },
        { code: 'BTA4-08', name: 'บิวเทอร์รี่ คุชชั่น (NEW)', brand: 'Beauterry', hidden: false },
        { code: 'L3', name: 'ชื่อในฐานไม่ใช้', brand: "Jula's Herb", hidden: true },   // ซ่อนสินค้าตั้งต้น
        { code: 'BAD', brand: 'Jernis' }                                                    // รูปทรงผิด = ทิ้ง
    ],
    targets: [
        { product_code: 'JNP4', target: 'F_Beauty-Fragrance_18-44', hidden: false },
        { product_code: 'L10', target: 'mf_sun_mass_18_54 ', hidden: true },             // ซ่อน Target ตั้งต้น (ไม่สนตัวพิมพ์/ช่องว่าง)
        { product_code: 'L10', target: 'F_SUN_NEW_25_44', hidden: false },                // เพิ่ม Target ให้สินค้าตั้งต้น
        { product_code: 'JNP1', target: 'F_OLD_HIDDEN', hidden: true }
    ]
};

// ---------------------------------------------------------------- หน้าเว็บ: รวมส่วนต่างเข้ากับรายการตั้งต้น
test('รายการตั้งต้น (ยังไม่โหลดส่วนต่าง) เหมือนเดิมทุกอย่าง · ทุกสินค้า builtin ไม่ซ่อน', () => {
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.equal(web.PRODUCT_CATALOG.length, web.DEFAULT_PRODUCTS.length);
    assert.ok(web.PRODUCT_CATALOG.every(p => p.builtin === true && p.hidden === false));
    assert.deepEqual(web.targetsForProduct('L10'), ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54']);
    assert.deepEqual(web.productsByBrand('Jernis').map(p => p.code), ['JNP1', 'JNP2', 'JNP3']);
});

test('ใส่ส่วนต่าง: สินค้าใหม่ / ซ่อนสินค้าตั้งต้น / Target ใหม่ / ซ่อน Target · แถวผิดรูปทิ้ง · แจ้งตัวฟัง', () => {
    let calls = 0;
    const off = web.subscribeCatalog(() => { calls++; });
    const v0 = web.getCatalogVersion();
    web.applyCatalogOverlay(OVERLAY);
    off();
    assert.equal(calls, 1);
    assert.equal(web.getCatalogVersion(), v0 + 1);
    // สินค้าใหม่ต่อท้ายตามรหัส (เรียงแบบตัวเลข) · แถว BAD (ไม่มีชื่อ) ไม่เข้า
    assert.deepEqual(web.productsByBrand('Jernis').map(p => p.code), ['JNP1', 'JNP2', 'JNP3', 'JNP4']);
    assert.deepEqual(web.productInfo('JNP4'), { code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: false, builtin: false });
    assert.equal(web.productInfo('BAD'), null);
    assert.equal(web.productLabel('JNP4'), 'JNP4 - Velvet Dawn');
    assert.equal(web.productName('JNP4'), 'Velvet Dawn');
    assert.equal(web.isBuiltinProduct('JNP4'), false);
    assert.equal(web.isBuiltinProduct('l3'), true);
    // ซ่อนสินค้าตั้งต้น: ชื่อยังเป็นของโค้ด (ไม่ใช้ชื่อในฐาน) · ช่องเลือกไม่เอา ยกเว้นที่เลือกไว้แล้ว
    assert.equal(web.productLabel('L3'), 'L3 - ' + web.DEFAULT_PRODUCTS.find(p => p.code === 'L3').name);
    assert.equal(web.productInfo('L3').hidden, true);
    assert.equal(web.pickableProducts("Jula's Herb").some(p => p.code === 'L3'), false);
    assert.equal(web.pickableProducts("Jula's Herb", ['L3']).some(p => p.code === 'L3'), true, 'เลือกไว้แล้ว = ยังกดเอาออกได้');
    assert.equal(web.productsByBrand("Jula's Herb").some(p => p.code === 'L3' && p.hidden), true, 'productsByBrand รวมที่ซ่อน');
    // Target: ซ่อน (ไม่สนตัวพิมพ์/ช่องว่าง) ไม่ขึ้นให้เลือก · เพิ่มใหม่ต่อท้าย · all รวมที่ซ่อน
    assert.deepEqual(web.targetsForProduct('L10'), ['F_SUN_MASS_18_54', 'F_SUN_NEW_25_44']);
    assert.deepEqual(web.allTargetsForProduct('L10'), ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54', 'F_SUN_NEW_25_44']);
    assert.deepEqual(web.targetEntriesOf('L10').map(t => [t.target, t.hidden, t.builtin]),
        [['MF_SUN_MASS_18_54', true, true], ['F_SUN_MASS_18_54', false, true], ['F_SUN_NEW_25_44', false, false]]);
    assert.deepEqual(web.targetsForProduct('L3'), ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54'], 'ส่วนต่างของ L10 ไม่ไปโดน L3 (เดิมใช้ array ร่วมกัน)');
    assert.deepEqual(web.targetsForProduct('JNP4'), ['F_Beauty-Fragrance_18-44']);
    assert.deepEqual(web.targetsForProduct('JNP1'), ['F_Beauty-Fragrance_18-44'], 'Target ที่ซ่อนไว้ตั้งแต่เพิ่มไม่ขึ้น');
    assert.deepEqual(web.targetsForProducts(['L10', 'JNP4']), ['F_SUN_MASS_18_54', 'F_SUN_NEW_25_44', 'F_Beauty-Fragrance_18-44']);
    assert.deepEqual(web.allTargetsForProducts(['JNP1']), ['F_Beauty-Fragrance_18-44', 'F_OLD_HIDDEN']);
    // คืนสำเนา
    web.targetsForProduct('L10').push('X');
    web.targetEntriesOf('L10')[0].hidden = false;
    assert.deepEqual(web.targetsForProduct('L10'), ['F_SUN_MASS_18_54', 'F_SUN_NEW_25_44']);
});

test('สีใหม่ของ Beauterry กางครบทั้งหน้าเว็บและฟีด PFM (กลุ่มเดียวกันสองฝั่ง) · ป้ายใต้ชื่อ KOL รู้จักรหัสใหม่', () => {
    web.applyCatalogOverlay(OVERLAY);
    assert.deepEqual(web.expandProductFamilies('BTA4-03'), ['BTA4-00', 'BTA4-01', 'BTA4-02', 'BTA4-03', 'BTA4-04', 'BTA4-05', 'BTA4-06', 'BTA4-07', 'BTA4-08']);
    assert.deepEqual(web.expandProductFamilies('BTA5-02'), ['BTA5-01', 'BTA5-02']);
    assert.deepEqual(web.expandProductFamilies('JNP4'), ['JNP4'], 'Jernis ไม่มีกลุ่มสี');
    assert.deepEqual(web.clipProductLabels('JNP4 Velvet Dawn, BTA5-01'), ['JNP4', 'BTA5-01']);
    // ฝั่ง server คิดจากแถวในตาราง catalog_products (รวมแถวซ่อน L3) — กลุ่มของ Beauterry ต้องตรงกับหน้าเว็บ
    const map = families.familyMapWith(OVERLAY.products.filter(p => p.code && p.brand));
    for (const code of ['BTA4-03', 'BTA4-08', 'BTA5-01', 'BTA1-02']) {
        assert.deepEqual(families.expandProductFamilies(code, map), web.expandProductFamilies(code), code);
    }
    assert.deepEqual(families.expandProductFamilies('BTA4-03'), web.expandProductFamilies('BTA4-03').slice(0, 8), 'ไม่ส่ง map = กลุ่มตั้งต้น');
    assert.equal(families.familyMapWith([]), families.familyMapWith(null), 'ไม่มีแถว = กลุ่มตั้งต้นตัวเดิม');
});

test('ส่วนต่างว่าง = กลับเป็นรายการตั้งต้น', () => {
    web.applyCatalogOverlay(OVERLAY);
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.equal(web.productInfo('JNP4'), null);
    assert.equal(web.productInfo('L3').hidden, false);
    assert.deepEqual(web.targetsForProduct('L10'), ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54']);
    assert.deepEqual(web.expandProductFamilies('BTA4-03').length, 8);
    assert.deepEqual(web.getCatalogOverlay(), { products: [], targets: [] });
});

// ---------------------------------------------------------------- ชั้น SQL
test('store: ยังไม่มีตาราง (42P01) → อ่านได้ว่าง ready:false · เขียน = 503 บอกให้ setup-db', async () => {
    onQuery = async () => { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; };
    assert.deepEqual(await REAL.overlay(), { ready: false, products: [], targets: [] });
    assert.deepEqual(await REAL.familyProducts(), []);
    await assert.rejects(REAL.addProduct({ code: 'JNP4', name: 'x', brand: 'Jernis' }), e => e.status === 503 && /setup-db/.test(e.message));
    await assert.rejects(REAL.setTargets(['JNP4'], 'T', false), e => e.status === 503);
    await assert.rejects(REAL.setProduct('L3', { hidden: true, name: 'n', brand: 'b' }), e => e.status === 503);
});

test('store: overlay เรียงรหัสแบบตัวเลข · familyProducts ทิ้งแถวรูปทรงผิด · setTargets ใช้ ON CONFLICT ตามชื่อไม่สนตัวพิมพ์ใน transaction', async () => {
    onQuery = async text => {
        if (/FROM catalog_products/.test(text) && /SELECT code, brand/.test(text)) return { rows: [{ code: 'BTA4-10', brand: 'Beauterry' }, { code: 'BTA4-09', brand: 'Beauterry' }, { id: 5 }] };
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'BTA4-10' }, { code: 'BTA4-9' }, { code: 'BTA4-08' }] };
        if (/FROM catalog_targets/.test(text)) return { rows: [{ id: 1 }] };
        if (/INSERT INTO catalog_targets/.test(text)) return { rows: [{ id: 9 }] };
        return { rows: [] };
    };
    const o = await REAL.overlay();
    assert.equal(o.ready, true);
    assert.deepEqual(o.products.map(p => p.code), ['BTA4-08', 'BTA4-9', 'BTA4-10']);
    assert.deepEqual((await REAL.familyProducts()).map(p => p.code), ['BTA4-09', 'BTA4-10']);
    SQL.length = 0;
    const out = await REAL.setTargets(['JNP1', 'JNP2'], 'F_X', true, { byId: 7, byName: 'แอดมิน' });
    assert.equal(out.length, 2);
    assert.ok(SQL.every(q => q.tx), 'ทำใน transaction');
    assert.match(SQL[0].text, /ON CONFLICT \(product_code, \(lower\(btrim\(target\)\)\)\)/);
    assert.deepEqual(SQL[0].params, ['JNP1', 'F_X', true, 7, 'แอดมิน']);
});

test('store: เพิ่มสินค้า + Target ใน transaction เดียว (Target พลาด = สินค้าไม่ค้าง) · ซ่อนสินค้าตั้งต้นพร้อมกัน 2 คนไม่ชนรหัสซ้ำ', async () => {
    onQuery = async text => (/INSERT INTO catalog_products/.test(text) ? { rows: [{ code: 'JNP4' }] } : { rows: [{ id: 1 }] });
    await REAL.addProduct({ code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis' }, { byId: 7, byName: 'แอดมิน' }, ['F_A', 'F_B']);
    assert.equal(SQL.length, 3);
    assert.ok(SQL.every(q => q.tx), 'สินค้า + Target อยู่ใน transaction เดียวกัน');
    assert.match(SQL[0].text, /INSERT INTO catalog_products/);
    assert.deepEqual(SQL.slice(1).map(q => [q.params[0], q.params[1], q.params[2]]), [['JNP4', 'F_A', false], ['JNP4', 'F_B', false]]);
    // ไม่ส่ง targets = แค่สินค้า
    SQL.length = 0;
    await REAL.addProduct({ code: 'JNP5', name: 'x', brand: 'Jernis' });
    assert.equal(SQL.length, 1);
    // ซ่อนสินค้าตั้งต้นที่ยังไม่มีแถว: INSERT ... ON CONFLICT (code) อัปเดต hidden แทน error 23505
    SQL.length = 0;
    onQuery = async text => (/FOR UPDATE/.test(text) ? { rows: [] } : { rows: [{ code: 'L3', hidden: true }] });
    await REAL.setProduct('L3', { hidden: true, name: 'กันแดด', brand: "Jula's Herb" }, { byId: 1, byName: 'แอดมิน' });
    const ins = SQL.find(q => /INSERT INTO catalog_products/.test(q.text));
    assert.match(ins.text, /ON CONFLICT \(code\) DO UPDATE SET[^]*hidden = EXCLUDED\.hidden/);
    assert.equal(ins.params[3], true);
});

test('schema + ด่านความพร้อม: 2 ตารางใหม่เป็นตารางเสริม (โค้ดขึ้นก่อน setup-db ได้ เว็บไม่ล่ม)', () => {
    const schema = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS catalog_products \(\s*code\s+VARCHAR\(40\) PRIMARY KEY/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS catalog_targets \(/);
    assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS catalog_targets_key ON catalog_targets \(product_code, \(lower\(btrim\(target\)\)\)\);/);
    const readiness = fs.readFileSync(path.join(SRC, 'services/readiness.js'), 'utf8');
    assert.match(readiness, /OPTIONAL_TABLES = new Set\(\[[^\]]*'catalog_products'[^\]]*'catalog_targets'/);
});

test('ฟีด PFM (content-candidates) กางสีใหม่ที่ Admin เพิ่ม · อ่านคลังไม่ได้ = กลุ่มตั้งต้น ฟีดไม่ล่ม', async () => {
    const candidate = { submission_id: 1, id_post: '7600000000000000001', gencode: 'GC', brand: 'Beauterry', platform: 'TikTok', status: 'confirmed',
        ad_status: 'ยังไม่ยิง', post_check: null, post_url: 'u', post_date: '2026-10-01', product: 'BTA4-01', group_key: null, ad_groups: [], updated_at: 't' };
    onQuery = async text => {
        if (/FROM catalog_products/.test(text)) return { rows: [{ code: 'BTA4-08', brand: 'Beauterry' }] };
        return { rows: [candidate] };
    };
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry', limit: 10 });
    assert.equal(item.product.split(', ').at(-1), 'BTA4-08');
    assert.equal(item.product.split(', ').length, 9);
    onQuery = async text => {
        if (/FROM catalog_products/.test(text)) throw new Error('boom');
        return { rows: [candidate] };
    };
    const [item2] = await contentExport.listCandidates({ brand: 'Beauterry', limit: 10 });
    assert.equal(item2.product.split(', ').length, 8);
});

// ---------------------------------------------------------------- เส้น API
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: 'แอดมิน', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'member1', full_name: 'Member', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jernis'] },
    3: { id: 3, username: 'agency1', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tk'] },
    4: { id: 4, username: 'pending1', full_name: 'Pending', role: 'member', status: 'pending', is_active: true, team_id: null, brands: [] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const LOG = [];
store.activity.log = async e => { LOG.push(e); return e; };
const CALLS = [];
let EXISTING = null;
let FAIL = null;
let OVERLAY_FAIL = null;   // บันทึกสำเร็จ แต่อ่านส่วนต่างกลับมาพลาด
const stub = name => async (...args) => { CALLS.push([name, ...args]); if (FAIL) throw FAIL; return name === 'findProduct' ? EXISTING : { ok: true }; };
store.catalog.overlay = async () => { if (FAIL || OVERLAY_FAIL) throw FAIL || OVERLAY_FAIL; return { ready: true, products: [{ code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: false }], targets: [] }; };
for (const m of ['findProduct', 'addProduct', 'setProduct', 'setTargets']) store.catalog[m] = stub(m);

let server, baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = 'http://127.0.0.1:' + server.address().port; });
after(async () => { if (server) await new Promise(r => server.close(r)); });
const call = async (uid, method, url, body) => {
    const token = jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/catalog' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
};
const reset = () => { CALLS.length = 0; LOG.length = 0; EXISTING = null; FAIL = null; OVERLAY_FAIL = null; };

test('GET /api/catalog: ทุกคนที่ล็อกอินอ่านได้ รวมเอเจนซี่ (หน้าเอเจนซี่ใช้ชื่อสินค้าใหม่) · บัญชีรออนุมัติไม่ได้', async () => {
    reset();
    for (const uid of [1, 2, 3]) {
        const r = await call(uid, 'GET', '');
        assert.equal(r.status, 200, 'uid ' + uid);
        assert.equal(r.body.data.products[0].code, 'JNP4');
    }
    assert.equal((await call(4, 'GET', '')).status, 403);
    const anon = await fetch(baseUrl + '/api/catalog');
    assert.equal(anon.status, 401);
});

test('แก้ได้เฉพาะ admin — member / เอเจนซี่ ได้ 403 และไม่มีอะไรถูกเขียน', async () => {
    reset();
    for (const uid of [2, 3]) {
        assert.equal((await call(uid, 'POST', '/products', { code: 'JNP4', name: 'x', brand: 'Jernis' })).status, 403);
        assert.equal((await call(uid, 'PATCH', '/products/L3', { hidden: true, name: 'n', brand: 'b' })).status, 403);
        assert.equal((await call(uid, 'POST', '/targets', { target: 'T', codes: ['JNP1'] })).status, 403);
        assert.equal((await call(uid, 'PATCH', '/targets', { code: 'JNP1', target: 'T', hidden: true })).status, 403);
    }
    assert.deepEqual(CALLS.filter(c => c[0] !== 'findProduct'), []);
});

test('POST /products: รหัสเป็นตัวพิมพ์ใหญ่ + Target ไม่ซ้ำ + ลง Activity Log · รหัสผิดรูป / ซ้ำ / Target มีจุลภาค = ไม่บันทึก', async () => {
    reset();
    const ok = await call(1, 'POST', '/products', { code: ' jnp4 ', name: ' Velvet Dawn ', brand: 'Jernis', targets: ['F_Beauty-Fragrance_18-44', 'f_beauty-fragrance_18-44', 'F_NEW'] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(CALLS.find(c => c[0] === 'addProduct').slice(1, 2), [{ code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis' }]);
    // Target ส่งไปพร้อมสินค้า (บันทึกใน transaction เดียว) — ไม่เรียก setTargets แยก
    assert.deepEqual(CALLS.find(c => c[0] === 'addProduct')[3], ['F_Beauty-Fragrance_18-44', 'F_NEW']);
    assert.equal(CALLS.filter(c => c[0] === 'setTargets').length, 0);
    assert.equal(CALLS.find(c => c[0] === 'addProduct')[2].byName, 'แอดมิน');
    assert.equal(LOG.at(-1).action, 'create');
    assert.equal(LOG.at(-1).project_name, 'Products & Targets');
    assert.match(LOG.at(-1).summary, /เพิ่มสินค้า JNP4 - Velvet Dawn \(Jernis\) · Target: F_Beauty-Fragrance_18-44, F_NEW/);
    for (const [body, re] of [
        [{ code: 'JN-P1', name: 'x', brand: 'Jernis' }, /ใช้ไม่ได้/],
        [{ code: 'jnp4/../x', name: 'x', brand: 'Jernis' }, /ใช้ไม่ได้/],
        [{ code: 'JNP5', name: '', brand: 'Jernis' }, /ชื่อสินค้า/],
        [{ code: 'JNP5', name: 'x', brand: '' }, /แบรนด์/],
        [{ code: 'JNP5', name: 'x', brand: 'Jernis', targets: ['A,B'] }, /จุลภาค/],
        [{ code: 'JNP5', name: 'บรรทัด\nสอง', brand: 'Jernis' }, /บรรทัดเดียว/]
    ]) {
        reset();
        const r = await call(1, 'POST', '/products', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match(r.body.message, re);
        assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
    }
    reset();
    EXISTING = { code: 'JNP4' };
    const dup = await call(1, 'POST', '/products', { code: 'JNP4', name: 'x', brand: 'Jernis' });
    assert.equal(dup.status, 409);
    assert.equal(CALLS.filter(c => c[0] === 'addProduct').length, 0);
});

test('PATCH /products/:code: ซ่อนสินค้าตั้งต้นที่ยังไม่มีแถวต้องส่งชื่อ+แบรนด์ · แก้ชื่อสินค้าที่เพิ่มเอง · hidden ต้องเป็น boolean', async () => {
    reset();
    assert.equal((await call(1, 'PATCH', '/products/L3', { hidden: true })).status, 400, 'ยังไม่มีแถว ไม่ส่งชื่อ');
    assert.equal((await call(1, 'PATCH', '/products/L3', { hidden: 'yes', name: 'n', brand: 'b' })).status, 400);
    assert.equal((await call(1, 'PATCH', '/products/L3', {})).status, 400);
    const hide = await call(1, 'PATCH', '/products/l3', { hidden: true, name: 'กันแดด', brand: "Jula's Herb" });
    assert.equal(hide.status, 200);
    assert.deepEqual(CALLS.find(c => c[0] === 'setProduct').slice(1, 3), ['L3', { hidden: true, name: 'กันแดด', brand: "Jula's Herb" }]);
    assert.match(LOG.at(-1).summary, /ซ่อนสินค้า L3/);
    reset();
    EXISTING = { code: 'JNP4', name: 'Velvet Dawn' };
    const ren = await call(1, 'PATCH', '/products/JNP4', { name: 'Velvet Dusk' });
    assert.equal(ren.status, 200);
    assert.deepEqual(CALLS.find(c => c[0] === 'setProduct').slice(1, 3), ['JNP4', { name: 'Velvet Dusk' }]);
    assert.match(LOG.at(-1).summary, /แก้ชื่อสินค้า JNP4: Velvet Dawn → Velvet Dusk/);
    // มีแถวแล้ว: ซ่อน/เอากลับ ส่งแค่ hidden (ชื่อที่หน้าเว็บส่งมาด้วยไม่ใช่การแก้ชื่อ)
    reset();
    EXISTING = { code: 'JNP4', name: 'Velvet Dawn' };
    assert.equal((await call(1, 'PATCH', '/products/JNP4', { hidden: true, name: 'อื่น', brand: 'Jernis' })).status, 200);
    assert.deepEqual(CALLS.find(c => c[0] === 'setProduct').slice(1, 3), ['JNP4', { hidden: true }]);
    assert.equal(LOG.at(-1).summary, 'ซ่อนสินค้า JNP4');
    // สินค้าตั้งต้น (ยังไม่มีแถว) แก้ชื่อไม่ได้
    reset();
    const builtin = await call(1, 'PATCH', '/products/L3', { name: 'ชื่อใหม่' });
    assert.equal(builtin.status, 404);
    assert.equal(CALLS.filter(c => c[0] === 'setProduct').length, 0);
});

// timeout: ถ้าโค้ดถอยกลับไปไม่ await คำขอจะค้างไม่มีคำตอบ — ให้เทสต์ล้มแทนแขวน (deploy รันเทสต์ก่อนขึ้น)
test('PATCH /products/:code ซ่อน/เอากลับ: บันทึกแล้วอ่านส่วนต่างกลับพลาด = ตอบ error ปกติ · server ไม่ล้ม', { timeout: 5000 }, async () => {
    for (const hidden of [true, false]) {
        reset();
        EXISTING = { code: 'JNP4', name: 'Velvet Dawn' };
        OVERLAY_FAIL = new Error('Connection terminated unexpectedly');
        const r = await call(1, 'PATCH', '/products/JNP4', { hidden });
        assert.equal(r.status, 500);
        assert.equal(CALLS.filter(c => c[0] === 'setProduct').length, 1);
    }
    reset();
    assert.equal((await call(1, 'GET', '')).status, 200, 'server ยังตอบได้');
});

test('POST / PATCH /targets: หลายสินค้าในครั้งเดียว · ตรวจรหัส / ชื่อ / hidden · ยังไม่ setup-db = 503 บอกเหตุ', async () => {
    reset();
    const add = await call(1, 'POST', '/targets', { target: ' F_Beauty-Fragrance_25-44 ', codes: ['JNP1', 'jnp2', 'JNP1'] });
    assert.equal(add.status, 201);
    assert.deepEqual(CALLS.find(c => c[0] === 'setTargets').slice(1, 4), [['JNP1', 'JNP2'], 'F_Beauty-Fragrance_25-44', false]);
    assert.match(LOG.at(-1).summary, /เพิ่ม Target F_Beauty-Fragrance_25-44 ให้ JNP1, JNP2/);
    assert.equal((await call(1, 'POST', '/targets', { target: 'T', codes: [] })).status, 400);
    assert.equal((await call(1, 'POST', '/targets', { target: 'T', codes: ['bad code'] })).status, 400);
    assert.equal((await call(1, 'POST', '/targets', { target: '', codes: ['JNP1'] })).status, 400);
    assert.equal((await call(1, 'PATCH', '/targets', { code: 'JNP1', target: 'T' })).status, 400, 'ไม่ส่ง hidden');
    reset();
    const hide = await call(1, 'PATCH', '/targets', { code: 'L10', target: 'MF_SUN_MASS_18_54', hidden: true });
    assert.equal(hide.status, 200);
    assert.deepEqual(CALLS.find(c => c[0] === 'setTargets').slice(1, 4), [['L10'], 'MF_SUN_MASS_18_54', true]);
    assert.match(LOG.at(-1).summary, /ซ่อน Target MF_SUN_MASS_18_54 ของ L10/);
    reset();
    const e = new Error('ยังไม่ได้สร้างตารางของหน้านี้ในฐานข้อมูล — ต้องรัน setup-db ก่อน ถึงจะบันทึกได้');
    e.status = 503;
    FAIL = e;
    const r = await call(1, 'POST', '/targets', { target: 'T', codes: ['JNP1'] });
    assert.equal(r.status, 503);
    assert.match(r.body.message, /setup-db/);
});
