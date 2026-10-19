const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// "คละ Tier" (19 ต.ค. 2026) เป็นค่าของกลุ่มเท่านั้น — ห้ามลงเป็น Tier ของคน
// หน้าเว็บรุ่นใหม่ให้เลือก Tier จริงเสมอ · แท็บรุ่นเก่า (ก่อน deploy) ล็อกช่องเป็น "คละ Tier" แล้วส่งมา → server ตอบ 400 ไม่บันทึกอะไร
// ทั้งหมดใช้ข้อมูลจำลอง ไม่แตะฐานข้อมูลจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-mixed-tier-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in mixed-tier test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const tiers = require(path.join(SRC, 'data/tiers'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let server, base;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);
const agToken = jwt.sign({ id: 9, role: 'agency' }, process.env.JWT_SECRET);
const ADMIN = { id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active' };
const AGENCY = { id: 9, username: 'ag', role: 'agency', status: 'active', is_active: true, agency_tokens: ['tok1'] };
let who = ADMIN;

const group = { key: 'g1', platforms: ['TikTok'], products: ['L3'], code_expire: 30,
    allocations: [{ platform: 'TikTok', tier: 'คละ Tier', kols: 5, content_type: 'Review' }] };
const project = { id: 80, name: 'แคมเปญ', brand: "Jula's Herb", team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [group] };
const sub = { id: 55, project_id: 80, agency_token: 'tok1', account_name: 'น้องเอ', status: 'submitted', group_key: 'g1', platform: 'TikTok', tier: 'Nano 1k - 10k' };
let added = [], written = [];

before(async () => {
    store.users.findById = async () => ({ ...who });
    store.projects.findByIdFull = async id => (String(id) === '80' ? structuredClone(project) : null);
    store.projects.resolveToken = async token => (token === 'tok1'
        ? { project: structuredClone(project), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: ['g1'], products: [], platforms: [], kol_count: 0, reports: [], scoped: true } }
        : null);
    store.submissions.get = async () => structuredClone(sub);
    store.submissions.addPerson = async f => { added.push(structuredClone(f)); return [{ ...f, id: 100 + added.length }]; };
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.submissions.updatePerson = store.submissions.update;
    store.activity.log = async () => {};
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    // รอซ็อกเก็ตปิดจริงก่อนจบ — ไม่งั้น --test-force-exit (build.cjs ตอน deploy) บน Windows แครช libuv UV_HANDLE_CLOSING
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

const call = (method, url, body, token) => fetch(base + url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const person = over => ({ account_name: 'kol_x', platform: 'TikTok', group_key: 'g1', content_type: 'Review', product: 'L3', link_account: 'https://www.tiktok.com/@kol_x', followers: 50000, ...over });

test('ค่าคงที่ server ตรงกับหน้าเว็บ · isMixedTier รับเฉพาะสตริง "คละ Tier" (ตัดช่องว่าง)', async () => {
    const web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    assert.equal(tiers.MIXED_TIER, web.MIXED_TIER);
    assert.equal(tiers.isMixedTier('คละ Tier'), true);
    assert.equal(tiers.isMixedTier('  คละ Tier '), true);
    for (const v of ['Nano 1k - 10k', '', null, undefined, 5, ['คละ Tier']]) assert.equal(tiers.isMixedTier(v), false, String(v));
});

test('เอเจนซี่เพิ่มรายชื่อ: "คละ Tier" = 400 ไม่บันทึก · Tier จริงบันทึกตามปกติ', async () => {
    who = AGENCY; added = [];
    let res = await call('POST', '/api/agency/tok1', person({ tier: 'คละ Tier' }), agToken);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MIXED_TIER');
    assert.match(body.message, /รีเฟรช/);
    assert.equal(added.length, 0, 'ต้องไม่บันทึกอะไรเลย');
    res = await call('POST', '/api/agency/tok1', person({ tier: 'Mega 1M+' }), agToken);
    assert.equal(res.status, 201);
    assert.equal(added.at(-1).tier, 'Mega 1M+');
    res = await call('POST', '/api/agency/tok1', person({ tier: '' }), agToken);
    assert.equal(res.status, 201, 'ไม่ส่ง Tier (ช่องไม่บังคับในกลุ่มเก่า) ยังบันทึกได้เหมือนเดิม');
    assert.equal(added.at(-1).tier, null);
});

test('เอเจนซี่ส่งหลายคน: มีคนไหน "คละ Tier" = 400 ไม่บันทึกสักคน', async () => {
    who = AGENCY; added = [];
    let res = await call('POST', '/api/agency/tok1/batch', { items: [person({ tier: 'Nano 1k - 10k' }), person({ account_name: 'kol_y', tier: 'คละ Tier' })] }, agToken);
    assert.equal(res.status, 400);
    assert.equal(added.length, 0, 'ไม่ลงครึ่งชุด');
    res = await call('POST', '/api/agency/tok1/batch', { items: [person({ tier: 'Nano 1k - 10k' }), person({ account_name: 'kol_y', tier: 'Micro 10k - 100k' })] }, agToken);
    assert.equal(res.status, 201);
    assert.deepEqual(added.map(a => a.tier), ['Nano 1k - 10k', 'Micro 10k - 100k']);
});

test('เอเจนซี่แก้ข้อมูล: ตั้ง Tier เป็น "คละ Tier" = 400 ไม่เขียน · Tier จริง / ไม่ส่ง Tier เขียนได้ตามเดิม', async () => {
    who = AGENCY; written = [];
    let res = await call('PUT', '/api/agency/tok1/submissions/55', { tier: 'คละ Tier', account_name: 'น้องเอ' }, agToken);
    assert.equal(res.status, 400);
    assert.equal(written.length, 0);
    res = await call('PUT', '/api/agency/tok1/submissions/55', { tier: 'Macro 100k - 1M' }, agToken);
    assert.equal(res.status, 200);
    assert.equal(written.at(-1).tier, 'Macro 100k - 1M');
    res = await call('PUT', '/api/agency/tok1/submissions/55', { draft_link: 'https://example.invalid/d1' }, agToken);
    assert.equal(res.status, 200, 'แก้ช่องอื่นไม่โดนด่านนี้');
});

test('ทีมเพิ่มรายชื่อเอง: "คละ Tier" = 400 ไม่บันทึก · Tier จริงบันทึกตามปกติ', async () => {
    who = ADMIN; added = [];
    let res = await call('POST', '/api/projects/80/submissions', person({ tier: 'คละ Tier', budget: 0 }), adminToken);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'MIXED_TIER');
    assert.equal(added.length, 0);
    res = await call('POST', '/api/projects/80/submissions', person({ tier: 'Micro 10k - 100k', budget: 0 }), adminToken);
    assert.equal(res.status, 201);
    assert.equal(added.at(-1).tier, 'Micro 10k - 100k');
});
