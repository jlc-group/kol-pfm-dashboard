// หน้า Products & Targets: ทีม Ads เข้าได้ (ผู้ใช้สั่ง 21 ต.ค. 2026 "หน้านี้ขอให้ฝั่ง Ads เข้าถึงได้")
// • ใคร: admin (ทุกแบรนด์) + ทุกคนในทีม Ads (ดูจากชื่อทีม) · ทีมอื่น / เอเจนซี่ = 403
// • ทำได้ทุกอย่างเหมือน admin แต่เฉพาะสินค้าของแบรนด์ที่ตัวเองมีสิทธิ์ (server ตรวจแบรนด์จากคลังเอง ไม่เชื่อที่หน้าเว็บส่งมา)
// • แก้ชื่อ Target: แคมเปญที่เปลี่ยนตามด้วยจำกัดเฉพาะแบรนด์ที่คนแก้มีสิทธิ์
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-catalog-ads-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => { throw new Error('ห้ามต่อฐานข้อมูลจริง'); };
pool.connect = async () => { throw new Error('ห้ามต่อฐานข้อมูลจริง'); };
const store = require(path.join(SRC, 'store'));
const roles = require(path.join(SRC, 'data/roles'));
const catalogBrands = require(path.join(SRC, 'store/catalogBrands'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', role: 'admin', status: 'active', is_active: true, team_id: 1, team_name: 'Admin', brands: [] },
    2: { id: 2, username: 'ads-mem', nickname: 'อังกอร์', role: 'member', status: 'active', is_active: true, team_id: 3, team_name: 'Ads', brands: ['Jarvit', 'Jernis'] },
    3: { id: 3, username: 'ads-mgr', role: 'manager', status: 'active', is_active: true, team_id: 3, team_name: ' ads ', brands: ["Jula's Herb"] },
    4: { id: 4, username: 'kol-mem', role: 'member', status: 'active', is_active: true, team_id: 2, team_name: 'KOL', brands: ['Jernis'] },
    5: { id: 5, username: 'mgr-team', role: 'manager', status: 'active', is_active: true, team_id: 9, team_name: 'Manager', brands: ['Jernis'] },
    6: { id: 6, username: 'agency1', role: 'agency', status: 'active', is_active: true, team_id: 3, team_name: 'Ads', brands: [], agency_tokens: ['tk'] },
    7: { id: 7, username: 'ads-pending', role: 'member', status: 'pending', is_active: true, team_id: 3, team_name: 'Ads', brands: ['Jernis'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
store.activity.log = async () => {};
const CALLS = [];
let EXISTING = null;
const stub = name => async (...args) => { CALLS.push([name, ...args]); return name === 'findProduct' ? EXISTING : { ok: true }; };
// สินค้าที่เพิ่มเอง: JNP4 (Jernis) · ZZ1 (Code Lab)
store.catalog.overlay = async () => ({ ready: true, products: [{ code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis', hidden: false }, { code: 'ZZ1', name: 'อื่น', brand: 'Code Lab', hidden: false }], targets: [] });
for (const m of ['findProduct', 'addProduct', 'setProduct', 'setTargets']) store.catalog[m] = stub(m);
store.catalog.targetUsage = async (...a) => { CALLS.push(['targetUsage', ...a]); return { campaigns: [], bundled: [] }; };
store.catalog.renameTarget = async (...a) => { CALLS.push(['renameTarget', ...a]); return { campaigns: [] }; };

let server, baseUrl, web;
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/brands.js')).href);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const call = async (uid, method, url, body) => {
    const a = ACCOUNTS[uid];
    const token = jwt.sign({ id: a.id, username: a.username, role: a.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/catalog' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
};
const writes = () => CALLS.filter(c => c[0] !== 'findProduct');

test('ใครแก้ได้ (server + หน้าเว็บตรงกัน): admin + ทีม Ads (ชื่อทีมไม่สนตัวพิมพ์/ช่องว่าง) · ทีมอื่น / Manager นอกทีม Ads / เอเจนซี่ = ไม่ได้', () => {
    const want = { 1: true, 2: true, 3: true, 4: false, 5: false, 6: false };
    for (const [id, ok] of Object.entries(want)) {
        assert.equal(roles.canManageCatalog(ACCOUNTS[id]), ok, 'server uid ' + id);
        assert.equal(web.canManageCatalog(ACCOUNTS[id]), ok, 'หน้าเว็บ uid ' + id);
    }
    assert.equal(roles.canManageCatalog(null), false);
    assert.equal(web.canManageCatalog({ role: 'member', team_name: null }), false);
});

test('แบรนด์ของรหัสสินค้า: สินค้าตั้งต้นจากคลังโค้ดหน้าเว็บ (แถวในฐานแก้แบรนด์สินค้าตั้งต้นไม่ได้) · สินค้าที่เพิ่มเองจากฐาน · ไม่มีในคลัง = ไม่รู้', async () => {
    const m = await catalogBrands.brandsOf(['L3', 'jnp1', 'JNP4', 'NOPE9'], [{ code: 'JNP4', brand: 'Jernis' }, { code: 'L3', brand: 'Jernis' }]);
    assert.equal(m.get('L3'), "Jula's Herb", 'สินค้าตั้งต้นยึดแบรนด์ตามโค้ด');
    assert.equal(m.get('JNP1'), 'Jernis');
    assert.equal(m.get('JNP4'), 'Jernis');
    assert.equal(m.has('NOPE9'), false);
});

test('ทีมอื่น / เอเจนซี่ / รออนุมัติ: แก้อะไรไม่ได้เลย (403) และไม่มีอะไรถูกเขียน · อ่านคลังได้เหมือนเดิม', async () => {
    CALLS.length = 0;
    for (const uid of [4, 5, 6]) {
        assert.equal((await call(uid, 'POST', '/products', { code: 'JNP9', name: 'x', brand: 'Jernis' })).status, 403, 'uid ' + uid);
        assert.equal((await call(uid, 'PATCH', '/products/JNP1', { hidden: true, name: 'n', brand: 'Jernis' })).status, 403);
        assert.equal((await call(uid, 'POST', '/targets', { target: 'T', codes: ['JNP1'] })).status, 403);
        assert.equal((await call(uid, 'PATCH', '/targets', { code: 'JNP1', target: 'T', hidden: true })).status, 403);
        assert.equal((await call(uid, 'GET', '/targets/usage?target=T&codes=JNP1')).status, 403);
        assert.equal((await call(uid, 'POST', '/targets/rename', { from: 'T', to: 'U', codes: ['JNP1'] })).status, 403);
    }
    assert.equal((await call(7, 'POST', '/targets', { target: 'T', codes: ['JNP1'] })).status, 403, 'ทีม Ads ที่ยังรออนุมัติ');
    assert.deepEqual(writes(), []);
    assert.equal((await call(4, 'GET', '')).status, 200);
});

test('ทีม Ads: แก้ได้ทุกอย่างกับสินค้าของแบรนด์ตัวเอง · แบรนด์อื่น / รหัสที่ไม่มีในคลัง = 403 (ทั้งชุด ไม่บันทึกบางส่วน)', async () => {
    CALLS.length = 0;
    // member ทีม Ads (Jarvit, Jernis)
    assert.equal((await call(2, 'POST', '/products', { code: 'JNP9', name: 'ใหม่', brand: 'Jernis' })).status, 201);
    assert.equal((await call(2, 'POST', '/products', { code: 'L99', name: 'x', brand: "Jula's Herb" })).status, 403, 'เพิ่มสินค้าแบรนด์อื่น');
    assert.equal((await call(2, 'PATCH', '/products/JNP1', { hidden: true, name: 'n', brand: 'Jernis' })).status, 200, 'ซ่อนสินค้าตั้งต้นของ Jernis');
    assert.equal((await call(2, 'PATCH', '/products/L3', { hidden: true, name: 'n', brand: 'Jernis' })).status, 403, 'แอบส่งแบรนด์ปลอมก็ไม่ผ่าน (L3 = Jula\'s Herb)');
    EXISTING = { code: 'JNP4', name: 'Velvet Dawn', brand: 'Jernis' };
    assert.equal((await call(2, 'PATCH', '/products/JNP4', { name: 'Velvet Dawn 2' })).status, 200, 'แก้ชื่อสินค้าที่เพิ่มเองของ Jernis');
    EXISTING = { code: 'ZZ1', name: 'อื่น', brand: 'Code Lab' };
    assert.equal((await call(2, 'PATCH', '/products/ZZ1', { name: 'x' })).status, 403, 'สินค้าที่เพิ่มเองของแบรนด์อื่น');
    EXISTING = null;
    assert.equal((await call(2, 'POST', '/targets', { target: 'F_X_18_44', codes: ['JNP1', 'JNP4'] })).status, 201);
    assert.equal((await call(2, 'POST', '/targets', { target: 'F_X_18_44', codes: ['JNP1', 'L3'] })).status, 403, 'ปนแบรนด์อื่น 1 ตัว = ไม่บันทึกทั้งชุด');
    assert.equal((await call(2, 'POST', '/targets', { target: 'F_X_18_44', codes: ['NOPE9'] })).status, 403, 'รหัสที่ไม่มีในคลัง');
    assert.equal((await call(2, 'PATCH', '/targets', { code: 'JNP2', target: 'F_Beauty-Fragrance_18-44', hidden: true })).status, 200);
    assert.equal((await call(2, 'PATCH', '/targets', { code: 'C1', target: 'MF_ACNE_13-34', hidden: true })).status, 403);
    const sets = CALLS.filter(c => c[0] === 'setTargets').map(c => c[1]);
    assert.deepEqual(sets, [['JNP1', 'JNP4'], ['JNP2']]);
    // usage / rename: ส่งขอบเขตแบรนด์ของคนแก้ไปที่ store (แคมเปญแบรนด์อื่นไม่โดน)
    assert.equal((await call(2, 'GET', '/targets/usage?target=F_Beauty-Fragrance_18-44&codes=JNP1')).status, 200);
    assert.deepEqual(CALLS.filter(c => c[0] === 'targetUsage').at(-1).slice(1), [['JNP1'], 'F_Beauty-Fragrance_18-44', ['Jarvit', 'Jernis']]);
    assert.equal((await call(2, 'GET', '/targets/usage?target=T&codes=L3')).status, 403);
    assert.equal((await call(2, 'POST', '/targets/rename', { from: 'F_Beauty-Fragrance_18-44', to: 'F_Beauty-Fragrance_18-45', codes: ['JNP1'] })).status, 200);
    assert.deepEqual(CALLS.filter(c => c[0] === 'renameTarget').at(-1)[4].scopeBrands, ['Jarvit', 'Jernis']);
    assert.equal((await call(2, 'POST', '/targets/rename', { from: 'A', to: 'B', codes: ['L3'] })).status, 403);
    // manager ทีม Ads (Jula's Herb) — แบรนด์ของตัวเองได้ ของคนอื่นไม่ได้
    assert.equal((await call(3, 'POST', '/targets', { target: 'MF_X', codes: ['L3', 'C1'] })).status, 201);
    assert.equal((await call(3, 'POST', '/targets', { target: 'MF_X', codes: ['JNP1'] })).status, 403);
    // admin: ทุกแบรนด์ · rename ไม่จำกัดแบรนด์ของแคมเปญ
    assert.equal((await call(1, 'POST', '/targets', { target: 'T', codes: ['L3', 'JNP1', 'NOPE9'] })).status, 201, 'admin ไม่ตรวจแบรนด์ (เหมือนเดิม)');
    assert.equal((await call(1, 'POST', '/targets/rename', { from: 'A', to: 'B', codes: ['L3'] })).status, 200);
    assert.equal(CALLS.filter(c => c[0] === 'renameTarget').at(-1)[4].scopeBrands, null);
});

test('โหลดคลังสินค้าตั้งต้นไม่ได้ = ทีม Ads ได้ 503 (ไม่เดาแบรนด์ ไม่ปล่อยผ่าน) · admin ไม่กระทบ', async () => {
    const real = catalogBrands.brandsOf;
    catalogBrands.brandsOf = async () => { throw new Error('โหลดไม่ได้'); };
    try {
        CALLS.length = 0;
        assert.equal((await call(2, 'POST', '/targets', { target: 'T', codes: ['JNP1'] })).status, 503);
        assert.deepEqual(writes(), []);
        assert.equal((await call(1, 'POST', '/targets', { target: 'T', codes: ['JNP1'] })).status, 201);
    } finally { catalogBrands.brandsOf = real; }
});
