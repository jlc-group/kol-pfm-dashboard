const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// Never connect tests to an operator's database, even when a local .env exists.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-deploy-test-'));
const store = require('../server/src/store');
const { pool } = require('../server/src/config/db');
pool.query = async () => { throw new Error('Unexpected database query in isolated test'); };
pool.connect = async () => { throw new Error('Unexpected database connection in isolated test'); };
const jwt = require('../server/node_modules/jsonwebtoken');
const { uploadDirectory, validateRuntime, root } = require('../server/src/config/runtime');
const app = require('../server/src/app');
let server, base, account, accountReads, listed;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    store.users.findById = async () => { accountReads++; return account; };
    store.users.listWithTeam = async () => { listed++; return []; };
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

function user(fields = {}) {
    accountReads = 0; listed = 0;
    account = { id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active', ...fields };
}
function request(url, token = adminToken, options = {}) {
    return fetch(`${base}${url}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
}

test('built frontend serves root and deep links from the API process', async () => {
    for (const url of ['/', '/login', '/projects/123', '/agency/example']) {
        const res = await fetch(base + url, { headers: { Accept: 'text/html' } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/html/);
        const html = await res.text();
        assert.match(html, /id="root"/);
        const asset = html.match(/src="([^\"]+\.js)"/)[1];
        assert.equal((await fetch(base + asset)).status, 200);
    }
});

test('missing API and missing assets return 404, not the SPA', async () => {
    assert.equal((await fetch(base + '/api/does-not-exist')).status, 404);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(base + '/server/.env')).status, 404);
});

test('health stays live while readiness reports database failure without leaking details', async () => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const res = await fetch(base + '/api/ready');
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'error', message: 'Database is not ready' });
});

test('a demoted admin cannot use its old token on admin routes', async () => {
    user({ role: 'member', team_id: 2 });
    assert.equal((await request('/api/users')).status, 403);
    assert.equal(listed, 0);
    assert.equal(accountReads, 1);
});

test('active admin succeeds and nested auth does not reset the current identity', async () => {
    user();
    assert.equal((await request('/api/users')).status, 200);
    assert.equal(listed, 1);
    assert.equal(accountReads, 1);
});

test('disabled and deleted accounts cannot use existing tokens', async () => {
    user({ is_active: false });
    assert.equal((await request('/api/users')).status, 401);
    account = null;
    assert.equal((await request('/api/auth/me')).status, 401);
});

test('pending accounts retain status page access but cannot enter dashboard or agency', async () => {
    user({ status: 'pending', role: 'member' });
    assert.equal((await request('/api/auth/me')).status, 200);
    assert.equal((await request('/api/users')).status, 403);
    assert.equal((await request('/api/agency/fixture')).status, 403);
});

test('old staff token cannot bypass changed agency role and assigned links', async () => {
    user({ role: 'agency', agency_tokens: [] });
    assert.equal((await request('/api/users')).status, 403);
    assert.equal((await request('/api/agency/fixture')).status, 403);
});

test('missing or forged tokens cannot access user data', async () => {
    assert.equal((await fetch(base + '/api/users')).status, 401);
    assert.equal((await request('/api/users', 'invalid')).status, 401);
});

test('production uploads must be absolute and outside the synced source', () => {
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production' }), /UPLOAD_DIR/);
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: 'uploads' }), /absolute/);
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: path.join(root, 'server/uploads') }), /outside/);
    assert.equal(uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: process.env.UPLOAD_DIR }), process.env.UPLOAD_DIR);
});

test('multipart upload and authenticated download use the external upload directory', async () => {
    user();
    const project = { id: 23, name: 'fixture', team_id: 1, brand: 'fixture' };
    store.projects.findByIdFull = async () => project;
    store.projects.setBriefFile = async (id, meta) => { project.brief_file = meta; return project; };
    store.activity.log = async () => {};
    const payload = '%PDF-1.4\nfixture brief';
    const form = new FormData();
    form.append('file', new Blob([payload], { type: 'application/pdf' }), 'brief.pdf');
    const uploaded = await request('/api/projects/23/brief/upload', adminToken, { method: 'POST', body: form });
    assert.equal(uploaded.status, 200);
    const stored = path.join(process.env.UPLOAD_DIR, project.brief_file.filename);
    assert.equal(fs.readFileSync(stored, 'utf8'), payload);
    const downloaded = await request('/api/projects/23/brief/file');
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), payload);
    assert.equal((await fetch(base + '/api/projects/23/brief/file')).status, 401);
    assert.equal((await fetch(base + '/uploads/' + project.brief_file.filename)).status, 404);
    user({ role: 'member', brands: [] });
    assert.equal((await request('/api/projects/23/brief/file')).status, 403);
});

test('members can only create or move campaigns into brands they are assigned', async () => {
    const project = { id: 31, name: 'fixture', team_id: 2, brand: 'Jdent' };
    let created = 0, updated = 0;
    store.projects.findByIdFull = async () => project;
    store.projects.create = async fields => { created++; return { id: 32, ...fields }; };
    store.projects.update = async (id, fields) => { updated++; return { ...project, ...fields }; };
    store.activity.log = async () => {};
    const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    assert.equal((await request('/api/projects', adminToken, send('POST', { name: 'x', brand: 'Code Lab' }))).status, 403);
    assert.equal((await request('/api/projects', adminToken, send('POST', { name: 'x' }))).status, 403);
    assert.equal(created, 0);
    assert.equal((await request('/api/projects', adminToken, send('POST', { name: 'x', brand: 'Jdent' }))).status, 201);
    assert.equal(created, 1);
    assert.equal((await request('/api/projects/31', adminToken, send('PUT', { name: 'x', brand: 'Code Lab' }))).status, 403);
    assert.equal((await request('/api/projects/31', adminToken, send('PUT', { name: 'x', brand: null }))).status, 403);
    assert.equal(updated, 0);
    assert.equal((await request('/api/projects/31', adminToken, send('PUT', { status: 'Active' }))).status, 200);
    assert.equal((await request('/api/projects/31', adminToken, send('PUT', { name: 'x', brand: 'Jdent' }))).status, 200);
    assert.equal(updated, 2);
    user({ role: 'manager', team_id: 3, brands: [] });
    assert.equal((await request('/api/projects', adminToken, send('POST', { name: 'x', brand: 'Code Lab' }))).status, 201);
    assert.equal((await request('/api/projects/31', adminToken, send('PUT', { brand: 'Code Lab' }))).status, 200);
});

function agencyFixture() {
    const project = { id: 41, name: 'fixture', brand: 'Jdent', platform_budgets: { TikTok: 90000 },
        ad_groups: [{ key: 'g1', budget: 90000, products: [], blocks: [{ platform: 'TikTok', budget: '90000', products: [], clips: [], sets: [] }] }] };
    const link = { token: 'tok1', scoped: true, name: 'Fixture Agency', products: [], platforms: [], groups: [], reports: [] };
    const row = { id: 5, project_id: 41, agency_token: 'tok1', person_key: 'p1', budget: '5000.00', ad_spend: '12000.00', ad_status: 'ยิงแล้ว',
        perf_stamp: { views: 1000, verdict: 'Pass', ad_spend: 12000, total_cost: 17000, cpm: 17, cpe: 2 } };
    store.projects.resolveToken = async () => ({ project, link });
    store.submissions.listByProject = async () => [row];
    store.submissions.get = async () => row;
    return { project, row };
}

test('agency accounts get no team budgets, and only admin/manager get ad costs on agency links', async () => {
    const { project } = agencyFixture();
    user({ role: 'agency', agency_tokens: ['tok1'] });
    const seen = (await (await request('/api/agency/tok1')).json()).data;
    assert.deepEqual(seen.platform_budgets, {});
    assert.equal('budget' in seen.ad_groups[0], false);
    assert.equal('budget' in seen.ad_groups[0].blocks[0], false);
    assert.equal(seen.ad_groups[0].blocks[0].platform, 'TikTok');
    assert.equal(seen.submissions[0].budget, '5000.00');
    assert.equal(seen.submissions[0].ad_status, 'ยิงแล้ว');
    assert.equal('ad_spend' in seen.submissions[0], false);
    assert.deepEqual(seen.submissions[0].perf_stamp, { views: 1000, verdict: 'Pass' });
    assert.equal(project.ad_groups[0].budget, 90000);
    user();
    const staff = (await (await request('/api/agency/tok1')).json()).data;
    assert.deepEqual(staff.platform_budgets, { TikTok: 90000 });
    assert.equal(staff.ad_groups[0].blocks[0].budget, '90000');
    assert.equal(staff.submissions[0].ad_spend, '12000.00');
    user({ role: 'member', brands: ['Jdent'] });
    const member = (await (await request('/api/agency/tok1')).json()).data;
    assert.deepEqual(member.platform_budgets, { TikTok: 90000 });
    assert.equal('ad_spend' in member.submissions[0], false);
    assert.deepEqual(member.submissions[0].perf_stamp, { views: 1000, verdict: 'Pass' });
});

test('agency person edits cannot multiply clip fees, and stale pages are told to refresh', async () => {
    const { row } = agencyFixture();
    const person = [], single = [];
    store.submissions.updatePerson = async (id, pid, fields) => { person.push(fields); return row; };
    store.submissions.update = async (id, pid, fields) => { single.push(fields); return row; };
    const put = body => request('/api/agency/tok1/submissions/5', adminToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    user({ role: 'agency', agency_tokens: ['tok1'] });
    // หน้าเก่า + คนคลิปเดียว: ยอดที่ส่งมาคือค่าต่อคลิปอยู่แล้ว รับได้
    const res = await put({ account_name: 'kol', budget: 8000 });
    assert.equal(res.status, 200);
    assert.equal('ad_spend' in (await res.json()).data, false);
    assert.equal(person[0].budget, 8000);
    assert.equal(person[0].account_name, 'kol');
    // หน้าเก่า + คนหลายคลิป: ปฏิเสธทั้งคำขอ ไม่เขียนอะไรเลย
    store.submissions.listByProject = async () => [row, { ...row, id: 6, clip_no: 2 }];
    const stale = await put({ account_name: 'kol', budget: 10000 });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'STALE_PAGE');
    assert.equal(person.length, 1);
    // หน้าใหม่ส่งค่าต่อคลิปพร้อมยืนยัน: รับได้แม้มีหลายคลิป
    assert.equal((await put({ account_name: 'kol', budget: 7000, budget_per_clip: true })).status, 200);
    assert.equal(person[1].budget, 7000);
    // ปุ่มหารเฉลี่ย/ล้างงบส่งแค่ budget ต่อแถว ยังทำงานเหมือนเดิม
    assert.equal((await put({ budget: 4000 })).status, 200);
    assert.equal(single[0].budget, 4000);
    // แก้ข้อมูลตัวคนโดยไม่แตะค่าตัว ไม่ถูกปฏิเสธ
    assert.equal((await put({ account_name: 'kol2' })).status, 200);
    assert.equal(person[2].budget, undefined);
});

// ค่าตัวต่อคลิป: น้องเอมี 2 คลิป (person_key เดียวกัน), น้องบีมีคลิปเดียวและยังไม่มีค่าตัว
function feeFixture() {
    const project = { id: 51, name: 'fee fixture', team_id: 1, brand: 'Jdent' };
    const rows = [
        { id: 11, project_id: 51, person_key: 'pa', clip_no: 1, account_name: 'น้องเอ', budget: 5000, status: 'confirmed' },
        { id: 12, project_id: 51, person_key: 'pa', clip_no: 2, account_name: 'น้องเอ', budget: 5000, status: 'confirmed' },
        { id: 13, project_id: 51, person_key: null, clip_no: 1, account_name: 'น้องบี', budget: 0, status: 'submitted' }
    ];
    const calls = [], logs = [];
    store.projects.findByIdFull = async () => project;
    store.submissions.listByProject = async () => rows;
    store.submissions.setFees = async (pid, items, byName) => {
        calls.push({ pid, items, byName });
        const hit = it => rows.find(r => r.id === it.sub_id);
        return {
            changed: items.map(it => ({ id: it.sub_id, account_name: hit(it).account_name, clip_no: hit(it).clip_no, from: hit(it).budget, to: it.budget })),
            rows: items.map(it => ({ ...hit(it), budget: it.budget }))
        };
    };
    store.activity.log = async entry => { logs.push(entry); };
    return { project, calls, logs };
}
const putFees = (id, body) => request(`/api/projects/${id}/fees`, adminToken, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('staff set per-clip fees in one request: normalized items, one activity entry per request', async () => {
    const { calls, logs } = feeFixture();
    user();
    const res = await putFees(51, { reason: 'manual', items: [
        { sub_id: 11, budget: 6000.456, from: 5000 }, { sub_id: 12, budget: 6000.456, from: 5000 }, { sub_id: 13, budget: 1500 }] });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.equal(calls.length, 1);
    assert.equal(Number(calls[0].pid), 51);
    assert.deepEqual(calls[0].items, [
        { sub_id: 11, budget: 6000.46, from: 5000 }, { sub_id: 12, budget: 6000.46, from: 5000 }, { sub_id: 13, budget: 1500 }]);
    assert.equal(calls[0].byName, 'fixture');
    assert.equal(body.data.changed.length, 3);
    assert.deepEqual(body.data.changed[0], { id: 11, account_name: 'น้องเอ', clip_no: 1, from: 5000, to: 6000.46 });
    assert.equal(body.data.rows[2].budget, 1500);
    // คลิปของคนเดียวกันรวมเป็นคนเดียวในประวัติ และบันทึกครั้งเดียวต่อคำขอ
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'fee');
    assert.equal(logs[0].project_id, 51);
    assert.equal(logs[0].summary, 'แก้ค่าตัว: น้องเอ ฿5,000→฿6,000.46 (2 คลิป), น้องบี ฿0→฿1,500');
    // คำนำหน้าตามวิธีที่ตั้งค่าตัว
    assert.equal((await putFees(51, { reason: 'divide', items: [{ sub_id: 13, budget: 2500, from: 0 }] })).status, 200);
    assert.equal(logs[1].summary, 'หารเฉลี่ย: น้องบี ฿0→฿2,500');
    assert.equal((await putFees(51, { reason: 'clear', items: [{ sub_id: 11, budget: 0 }, { sub_id: 12, budget: 0 }] })).status, 200);
    assert.equal(logs[2].summary, 'ล้างค่าตัว: น้องเอ ฿5,000→฿0 (2 คลิป)');
    // ไม่มีแถวไหนเปลี่ยนจริง = ไม่ต้องลงประวัติ
    store.submissions.setFees = async (pid, items) => { calls.push({ pid, items }); return { changed: [], rows: [] }; };
    assert.equal((await putFees(51, { reason: 'manual', items: [{ sub_id: 11, budget: 5000 }] })).status, 200);
    assert.equal(logs.length, 3);
});

test('fee edits follow campaign brand permissions with no extra role gate', async () => {
    const { calls } = feeFixture();
    const body = { reason: 'manual', items: [{ sub_id: 13, budget: 1000 }] };
    user({ role: 'member', team_id: 2, brands: ['Code Lab'] });
    assert.equal((await putFees(51, body)).status, 403);
    user({ role: 'member', team_id: 2, brands: [] });
    assert.equal((await putFees(51, body)).status, 403);
    assert.equal(calls.length, 0);
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    assert.equal((await putFees(51, body)).status, 200);
    assert.equal(calls.length, 1);
    user();
    store.projects.findByIdFull = async () => null;
    assert.equal((await putFees(51, body)).status, 404);
    assert.equal(calls.length, 1);
});

test('invalid fee bodies are rejected before anything is written', async () => {
    const { calls, logs } = feeFixture();
    user();
    const bad = [
        { reason: 'manual', items: [{ sub_id: 99, budget: 1000 }] },                              // ไม่ใช่ของแคมเปญนี้
        { reason: 'manual', items: [{ sub_id: 11, budget: -1 }] },                                // ติดลบ
        { reason: 'manual', items: [{ sub_id: 11, budget: NaN }] },                               // NaN (JSON กลายเป็น null)
        { reason: 'manual', items: [{ sub_id: 11, budget: 10000001 }] },                          // เกินเพดาน
        { reason: 'manual', items: [{ sub_id: 11, budget: '5000' }] },                            // สตริง
        { reason: 'manual', items: [{ sub_id: 11, budget: 1000 }, { sub_id: 11, budget: 2000 }] }, // sub_id ซ้ำ
        { reason: 'manual', items: [] },                                                          // ว่าง
        { reason: 'manual', items: Array.from({ length: 501 }, (_, i) => ({ sub_id: i + 1, budget: 1 })) },
        { reason: 'manual', items: [{ sub_id: 1.5, budget: 1000 }] },
        { reason: 'manual', items: [{ sub_id: '11', budget: 1000 }] },
        { reason: 'manual', items: [{ sub_id: 11, budget: 1000, from: '5000' }] },
        { reason: 'manual', items: [null] },
        { reason: 'oops', items: [{ sub_id: 11, budget: 1000 }] },
        { items: [{ sub_id: 11, budget: 1000 }] }
    ];
    for (const body of bad) {
        const res = await putFees(51, body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
        const json = await res.json();
        assert.equal(json.status, 'error');
        assert.equal(typeof json.message, 'string');
    }
    assert.equal(calls.length, 0);
    assert.equal(logs.length, 0);
});

test('a fee changed by someone else since the page loaded returns 409 and logs nothing', async () => {
    const { logs } = feeFixture();
    user();
    store.submissions.setFees = async () => { const e = new Error('มีคนแก้ค่าตัวนี้ไปแล้ว กรุณารีเฟรช'); e.status = 409; throw e; };
    const res = await putFees(51, { reason: 'manual', items: [{ sub_id: 11, budget: 7000, from: 4000 }] });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { status: 'error', message: 'มีคนแก้ค่าตัวนี้ไปแล้ว กรุณารีเฟรช' });
    assert.equal(logs.length, 0);
});

test('production refuses missing settings, sample secrets and invalid ports', () => {
    assert.throws(() => validateRuntime({ NODE_ENV: 'production' }), /Missing production settings/);
    const env = { NODE_ENV: 'production', JWT_SECRET: process.env.JWT_SECRET, DB_HOST: 'fixture', DB_PORT: '5432',
        DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASSWORD: 'fixture', PORT: '3080', UPLOAD_DIR: process.env.UPLOAD_DIR };
    assert.doesNotThrow(() => validateRuntime(env));
    assert.throws(() => validateRuntime({ ...env, JWT_SECRET: 'change_this_to_a_long_random_secret' }), /JWT_SECRET/);
    assert.throws(() => validateRuntime({ ...env, PORT: '0' }), /PORT/);
});
