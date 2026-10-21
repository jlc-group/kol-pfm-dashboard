// Manager เห็นเฉพาะงานและงบของแบรนด์ที่ admin กำหนดให้ (ผู้ใช้สั่ง 21 ต.ค. 2026 — เดิม Manager เห็นทุกแบรนด์)
// • กติกากลาง roles.js / brands.js: เห็นทุกแบรนด์ = admin เท่านั้น · Manager ยังเห็นตัวเลขต้นทุน (CPM / CPE / ค่าแอด)
// • หน้า Users: เก็บแบรนด์ให้ Manager ได้ (เดิมล้างทิ้งเมื่อเป็น Manager) · เปลี่ยนเป็น admin / agency ยังล้าง
// • ทุกเส้นที่ใช้ allowedBrands ส่งขอบเขตแบรนด์ของ Manager ไปที่ store (ภาพรวม / งบ / รายงาน / แคมเปญ / Ads)
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
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-mgr-scope-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const store = require('../server/src/store');
const { pool } = require('../server/src/config/db');
pool.query = async () => { throw new Error('ห้ามต่อฐานข้อมูลจริง'); };
pool.connect = async () => { throw new Error('ห้ามต่อฐานข้อมูลจริง'); };
const jwt = require('../server/node_modules/jsonwebtoken');
const roles = require('../server/src/data/roles');
const app = require('../server/src/app');

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'mgr1', role: 'manager', status: 'active', is_active: true, team_id: 3, brands: ['Jdent', 'Beauterry'] },
    3: { id: 3, username: 'mgr-none', role: 'manager', status: 'active', is_active: true, team_id: 3, brands: [] },
    4: { id: 4, username: 'member1', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Jdent'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
store.activity.log = async () => {};

let server, base, web;
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/brands.js')).href);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const call = async (uid, method, url, body) => {
    const a = ACCOUNTS[uid];
    const token = jwt.sign({ id: a.id, username: a.username, role: a.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
};

test('กติกากลาง (server): เห็นทุกแบรนด์ = admin เท่านั้น · Manager = แบรนด์ที่กำหนด (ว่าง = ไม่เห็นอะไร) · ตัวเลขต้นทุนยังเห็น', () => {
    const mgr = ACCOUNTS[2], none = ACCOUNTS[3];
    assert.equal(roles.seesAllBrands(ACCOUNTS[1]), true);
    assert.equal(roles.seesAllBrands(mgr), false);
    assert.equal(roles.allowedBrands(ACCOUNTS[1]), null);
    assert.deepEqual(roles.allowedBrands(mgr), ['Jdent', 'Beauterry']);
    assert.deepEqual(roles.allowedBrands(none), [], 'Manager ที่ยังไม่ได้กำหนดแบรนด์ = ไม่เห็นอะไร (ไม่ใช่ทุกแบรนด์)');
    assert.equal(roles.canSeeBrand(mgr, 'Jdent'), true);
    assert.equal(roles.canSeeBrand(mgr, 'Code Lab'), false);
    assert.equal(roles.canSeeBrand(none, 'Jdent'), false);
    assert.equal(roles.canSeeCostMetrics(mgr), true, 'Manager ยังเห็น CPM / CPE / ค่าแอด');
    assert.equal(roles.canSeeCostMetrics(ACCOUNTS[4]), false);
    assert.deepEqual(['admin', 'manager', 'member', 'agency'].map(roles.hasBrandList), [false, true, true, false]);
});

test('กติกากลาง (หน้าเว็บ) ตรงกับ server: visibleBrands ของ Manager = แบรนด์ที่กำหนด · canSeeCostMetrics แยกจากแบรนด์', () => {
    assert.equal(web.seesAllBrands(ACCOUNTS[1]), true);
    assert.equal(web.seesAllBrands(ACCOUNTS[2]), false);
    assert.deepEqual(web.visibleBrands(ACCOUNTS[1]), web.BRANDS);
    assert.deepEqual(web.visibleBrands(ACCOUNTS[2]), web.BRANDS.filter(b => ['Jdent', 'Beauterry'].includes(b)));
    assert.deepEqual(web.visibleBrands(ACCOUNTS[3]), []);
    assert.equal(web.canSeeCostMetrics(ACCOUNTS[2]), true);
    assert.equal(web.canSeeCostMetrics(ACCOUNTS[4]), false);
    for (const r of ['admin', 'manager', 'member', 'agency']) {
        assert.equal(web.hasBrandList(r), roles.hasBrandList(r), r);
        const u = { role: r, brands: ['Jdent'] };
        assert.equal(web.seesAllBrands(u), roles.seesAllBrands(u), r);
        assert.equal(web.canSeeCostMetrics(u), roles.canSeeCostMetrics(u), r);
    }
});

test('หน้า Users: สร้าง/แก้ Manager เก็บแบรนด์ได้ · เปลี่ยนเป็น admin / agency ล้างแบรนด์ · member เหมือนเดิม', async () => {
    let created = null;
    const updates = [];
    store.users.create = async f => { created = f; return { id: 9, ...f }; };
    store.users.update = async (id, f) => { updates.push(f); return { id: Number(id), ...f }; };
    let r = await call(1, 'POST', '/api/users', { username: 'm2', password: 'Passw0rd!x', role: 'manager', team_id: 3, brands: ['Jernis', '', 'Jdent'] });
    assert.equal(r.status, 201);
    assert.deepEqual(created.brands, ['Jernis', 'Jdent']);
    r = await call(1, 'POST', '/api/users', { username: 'a2', password: 'Passw0rd!x', role: 'admin', team_id: 1, brands: ['Jernis'] });
    assert.deepEqual(created.brands, [], 'admin ไม่เก็บแบรนด์');
    await call(1, 'PUT', '/api/users/3', { role: 'manager', brands: ['Beauterry'] });
    await call(1, 'PUT', '/api/users/3', { brands: ['Jarvit'] });
    await call(1, 'PUT', '/api/users/3', { role: 'admin', brands: ['Beauterry'] });
    await call(1, 'PUT', '/api/users/3', { role: 'agency', brands: ['Beauterry'] });
    await call(1, 'PUT', '/api/users/4', { role: 'member', brands: ['Jdent', 'Jernis'] });
    assert.deepEqual(updates.map(u => u.brands), [['Beauterry'], ['Jarvit'], [], [], ['Jdent', 'Jernis']]);
    assert.equal((await call(2, 'PUT', '/api/users/2', { brands: ['Code Lab'] })).status, 403, 'Manager ตั้งแบรนด์ให้ตัวเองไม่ได้ (admin เท่านั้น)');
    assert.equal(updates.length, 5);
});

test('ภาพรวม / งบ / เทรนด์งบ / รายงาน / แคมเปญ / Ads: Manager ส่งขอบเขตเป็นแบรนด์ที่กำหนด · admin ไม่จำกัด', async () => {
    const seen = {};
    store.dashboard.overview = async o => { seen.dashboard = o.scopeBrands; return {}; };
    store.budget.overview = async o => { seen.budget = o.scopeBrands; return {}; };
    store.budget.trend = async o => { seen.trend = o.scopeBrands; return {}; };
    store.reports.campaigns = async o => { seen.reports = o.scopeBrands; return []; };
    for (const [uid, want] of [[2, ['Jdent', 'Beauterry']], [3, []], [1, null]]) {
        for (const url of ['/api/stats/dashboard', '/api/stats/budget', '/api/stats/budget/trend', '/api/stats/reports']) {
            const r = await call(uid, 'GET', url);
            assert.equal(r.status, 200, url);
        }
        assert.deepEqual(seen, { dashboard: want, budget: want, trend: want, reports: want }, 'uid ' + uid);
    }
});

test('แคมเปญแบรนด์อื่น: Manager เปิด/แก้ไม่ได้ · แบรนด์ของตัวเองได้ · สร้างได้เฉพาะแบรนด์ที่กำหนด', async () => {
    const projects = { 51: { id: 51, name: 'J', brand: 'Jdent', team_id: 2, campaign_type: 'kol' }, 52: { id: 52, name: 'C', brand: 'Code Lab', team_id: 2, campaign_type: 'kol' } };
    store.projects.findByIdFull = async id => (projects[Number(id)] ? { ...projects[Number(id)] } : null);
    store.projects.findById = store.projects.findByIdFull;
    store.projects.update = async (id, f) => ({ ...projects[Number(id)], ...f });
    store.projects.create = async f => ({ id: 60, ...f });
    assert.equal((await call(2, 'PUT', '/api/projects/52', { status: 'Active' })).status, 403);
    assert.equal((await call(2, 'PUT', '/api/projects/51', { status: 'Active' })).status, 200);
    assert.equal((await call(2, 'POST', '/api/projects', { name: 'x', brand: 'Code Lab' })).status, 403);
    assert.equal((await call(2, 'POST', '/api/projects', { name: 'x', brand: 'Beauterry' })).status, 201);
    assert.equal((await call(3, 'POST', '/api/projects', { name: 'x', brand: 'Beauterry' })).status, 403, 'ยังไม่ได้กำหนดแบรนด์ = สร้างไม่ได้');
    assert.equal((await call(1, 'PUT', '/api/projects/52', { status: 'Active' })).status, 200, 'admin ทุกแบรนด์');
});

test('ลิงก์เอเจนซี่: ด่านแบรนด์ใช้ token ตัวเดียวกับ handler (ส่ง %xx มาหลบไม่ได้) · ลิงก์ที่ไม่มีจริง = 404 ที่ด่าน', async () => {
    const project = { id: 41, name: 'fixture', brand: 'Code Lab', platform_budgets: { TikTok: 90000 },
        ad_groups: [{ key: 'g1', budget: 90000, products: [], blocks: [{ platform: 'TikTok', budget: '90000', products: ['L3'], clips: [], sets: [] }] }] };
    const link = { token: 'a1b2', scoped: true, name: 'Fixture Agency', products: [], platforms: [], groups: [], reports: [] };
    const row = { id: 5, project_id: 41, agency_token: 'a1b2', person_key: 'p1', budget: '5000.00', ad_spend: '12000.00', ad_status: 'ยิงแล้ว' };
    const asked = [];
    // เหมือน pg จริง: หาแบบตรงตัว (WHERE token = $1)
    store.projects.resolveToken = async t => { asked.push(t); return t === 'a1b2' ? { project, link } : null; };
    store.submissions.listByProject = async () => [row];
    store.submissions.get = async () => row;
    const encoded = '%61%31b2';   // = a1b2
    for (const url of ['/api/agency/a1b2', '/api/agency/' + encoded, '/api/agency/' + encoded + '/messages']) {
        assert.equal((await call(2, 'GET', url)).status, 403, 'Manager (Jdent, Beauterry) เปิดลิงก์ Code Lab ไม่ได้: ' + url);
    }
    assert.ok(asked.includes('a1b2') && !asked.includes(encoded), 'ด่านถอด %xx ก่อนหา');
    assert.equal((await call(2, 'PUT', '/api/agency/' + encoded + '/submissions/5', { budget: 1 })).status, 403, 'แก้ผ่านลิงก์ที่เข้ารหัสก็ไม่ได้');
    assert.equal((await call(2, 'GET', '/api/agency/zz99')).status, 404, 'ลิงก์ที่ไม่มีจริง = 404');
    assert.equal((await call(2, 'GET', '/api/agency/%E0%A4%A')).status, 404, 'ถอดไม่ได้ = 404');
    project.brand = 'Jdent';
    const mine = await call(2, 'GET', '/api/agency/' + encoded);
    assert.equal(mine.status, 200, 'แบรนด์ของตัวเองเปิดได้ (ทั้งแบบเข้ารหัส)');
    assert.equal(mine.body.data.submissions[0].ad_spend, '12000.00', 'Manager ยังเห็นค่าแอด');
    assert.equal((await call(4, 'GET', '/api/agency/a1b2')).status, 200, 'member ของ Jdent เปิดได้');
    assert.equal((await call(1, 'GET', '/api/agency/' + encoded)).status, 200, 'admin เปิดได้');
});
