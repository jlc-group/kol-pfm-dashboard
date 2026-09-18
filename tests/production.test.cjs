const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

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


test('uploads are refused before any file is written when the user may not edit the job', async () => {
    const project = { id: 24, name: 'fixture', team_id: 1, brand: 'Beauterry', campaign_type: 'other',
        hire_items: [
            { key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000 },
            { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 1, filled: 0, assignee_id: 55,
              candidates: [{ key: 'c1', name: 'ชบา', status: 'เสนอ', by_id: 55 }] }
        ] };
    store.projects.findByIdFull = async () => project;
    store.projects.setBriefFile = async () => { throw new Error('must not be reached'); };
    store.projects.patchHireItems = async () => { throw new Error('must not be reached'); };
    store.activity.log = async () => {};
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    const send = (url, token = adminToken, name = 'big.pdf') => {
        const form = new FormData();
        form.append('file', new Blob([Buffer.alloc(64 * 1024)], { type: 'application/pdf' }), name);
        return request(url, token, { method: 'POST', body: form });
    };

    // member ของแบรนด์อื่น: ทุกเส้นอัปของงานนี้ตีกลับ 403 และไม่มีไฟล์ใหม่ในโฟลเดอร์
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    assert.equal((await send('/api/projects/24/brief/upload')).status, 403);
    assert.equal((await send('/api/projects/24/hires/h1/image')).status, 403);
    assert.equal((await send('/api/projects/24/product-brief/P1/file')).status, 403);
    assert.equal((await send('/api/projects/24/platform-brief/TikTok/file')).status, 403);
    // ไฟล์ของชื่อที่เสนอ: ไม่ใช่คนหาของใบ ไม่ใช่ทีมแบรนด์ → 403 · ชื่อที่ไม่มีอยู่ → 404
    assert.equal((await send('/api/projects/24/hires/r1/candidates/c1/image')).status, 403);
    assert.equal((await send('/api/projects/24/hires/r1/candidates/c1/video')).status, 403);
    // ไฟล์นามสกุลที่ไม่รับ: ถ้าด่านอยู่หน้า multer ต้องได้ 403 (ไม่ใช่ 400 จากตัวกรองไฟล์) = ไม่ได้เริ่มรับไฟล์เลย
    for (const url of ['/api/projects/24/brief/upload', '/api/projects/24/hires/h1/image',
        '/api/projects/24/product-brief/P1/file', '/api/projects/24/platform-brief/TikTok/file',
        '/api/projects/24/hires/r1/candidates/c1/image', '/api/projects/24/hires/r1/candidates/c1/video']) {
        assert.equal((await send(url, adminToken, 'x.exe')).status, 403, url);
    }
    // แชตทีมกับเอเจนซี่: member แบรนด์อื่นส่งไม่ได้ ทั้งข้อความล้วนและแนบรูป
    store.projects.addAgencyMessage = async () => { throw new Error('must not be reached'); };
    assert.equal((await request('/api/projects/24/agency-links/tok1/messages', adminToken, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' })
    })).status, 403);
    assert.equal((await send('/api/projects/24/agency-links/tok1/messages', adminToken, 'x.exe')).status, 403);

    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    assert.equal((await send('/api/projects/24/hires/r1/candidates/nope/image')).status, 404);
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before, 'ไม่มีไฟล์ค้างจากคำขอที่ถูกตีกลับ');

    // งานปกติต้องยังผ่าน: คนหาที่ไม่มีสิทธิ์แบรนด์อัปคอมการ์ดของชื่อที่ตัวเองเสนอได้
    let saved = structuredClone(project.hire_items);
    store.projects.patchHireItems = async (id, key, fn) => {
        const row = saved.find(it => it.key === key);
        const next = row ? fn(structuredClone(row), structuredClone(saved)) : null;
        if (!Array.isArray(next)) return null;
        saved = next;
        return structuredClone(next);
    };
    const finder = jwt.sign({ id: 55, role: 'member', team_id: 2 }, process.env.JWT_SECRET);
    user({ id: 55, role: 'member', team_id: 2, brands: [] });
    const ok = await send('/api/projects/24/hires/r1/candidates/c1/image', finder, 'card.png');
    assert.equal(ok.status, 200);
    const img = saved.find(it => it.key === 'r1').candidates[0].image;
    assert.ok(img && fs.existsSync(path.join(process.env.UPLOAD_DIR, img.filename)));
    fs.unlinkSync(path.join(process.env.UPLOAD_DIR, img.filename));
});

test('agency uploads need a live link before any file is accepted', async () => {
    user({ role: 'agency', agency_tokens: ['tok9'] });
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    store.projects.resolveToken = async () => null;   // ลิงก์ถูกลบ/หมดอายุ แต่บัญชียังผูกอยู่
    store.projects.addAgencyReport = async () => { throw new Error('must not be reached'); };
    store.projects.addAgencyMessage = async () => { throw new Error('must not be reached'); };
    const post = (url, name) => {
        const form = new FormData();
        form.append(url.endsWith('/messages') ? 'image' : 'file', new Blob([Buffer.alloc(1024)], { type: 'image/png' }), name);
        return request(url, adminToken, { method: 'POST', body: form });
    };
    // ลิงก์ไม่อยู่แล้ว → 404 ก่อนรับไฟล์ (ไฟล์นามสกุลที่ไม่รับก็ยังได้ 404 ไม่ใช่ 400)
    assert.equal((await post('/api/agency/tok9/reports', 'x.exe')).status, 404);
    assert.equal((await post('/api/agency/tok9/messages', 'x.exe')).status, 404);
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before);

    // ลิงก์ใช้ได้ → ส่งรายงานได้ตามปกติ
    store.projects.resolveToken = async () => ({ project: { id: 5, brand: 'Beauterry' }, link: { name: 'Agency' } });
    let stored = null;
    store.projects.addAgencyReport = async (pid, token, meta) => { stored = meta; return { id: 1, ...meta }; };
    const res = await post('/api/agency/tok9/reports', 'report.pdf');
    assert.equal(res.status, 201);
    assert.ok(stored && fs.existsSync(path.join(process.env.UPLOAD_DIR, stored.filename)));
    fs.unlinkSync(path.join(process.env.UPLOAD_DIR, stored.filename));
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
        ad_groups: [{ key: 'g1', budget: 90000, products: [], blocks: [{ platform: 'TikTok', budget: '90000', budget_mode: 'split', product_budgets: { L3: 90000 }, products: ['L3'], clips: [], sets: [] }] }] };
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
    assert.equal('product_budgets' in seen.ad_groups[0].blocks[0], false);   // งบแยกต่อสินค้าก็เป็นงบของทีม
    assert.equal(seen.ad_groups[0].blocks[0].platform, 'TikTok');
    // ค่าตัว KOL: บัญชีเอเจนซี่ได้ null แต่คีย์ต้องยังอยู่ (แท็บเก่าทำ Number(s.budget) ไม่มีคีย์จะขึ้น ฿NaN)
    assert.equal('budget' in seen.submissions[0], true);
    assert.equal(seen.submissions[0].budget, null);
    assert.equal(seen.submissions[0].ad_status, 'ยิงแล้ว');
    assert.equal('ad_spend' in seen.submissions[0], false);
    assert.deepEqual(seen.submissions[0].perf_stamp, { views: 1000, verdict: 'Pass' });
    assert.equal(project.ad_groups[0].budget, 90000);
    user();
    const staff = (await (await request('/api/agency/tok1')).json()).data;
    assert.deepEqual(staff.platform_budgets, { TikTok: 90000 });
    assert.equal(staff.ad_groups[0].blocks[0].budget, '90000');
    assert.deepEqual(staff.ad_groups[0].blocks[0].product_budgets, { L3: 90000 });
    assert.equal(staff.submissions[0].budget, '5000.00');
    assert.equal(staff.submissions[0].ad_spend, '12000.00');
    user({ role: 'member', brands: ['Jdent'] });
    const member = (await (await request('/api/agency/tok1')).json()).data;
    assert.deepEqual(member.platform_budgets, { TikTok: 90000 });
    assert.equal(member.submissions[0].budget, '5000.00');
    assert.equal('ad_spend' in member.submissions[0], false);
    assert.deepEqual(member.submissions[0].perf_stamp, { views: 1000, verdict: 'Pass' });
});

test('agency routes never write KOL fees', async () => {
    const { project, row } = agencyFixture();
    const added = [], person = [], single = [];
    store.submissions.addPerson = async (fields) => { added.push(fields); return [{ ...row, id: 90, budget: fields.budget.toFixed(2) }]; };
    store.submissions.updatePerson = async (id, pid, fields) => { person.push(fields); return row; };
    store.submissions.update = async (id, pid, fields) => { single.push(fields); return row; };
    const send = (url, method, body) => request(url, adminToken, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const put = body => send('/api/agency/tok1/submissions/5', 'PUT', body);
    const FEE_MOVED = { status: 'error', code: 'FEE_MOVED', message: 'ค่าตัว KOL ย้ายไปให้ทีมกรอกที่หน้าแคมเปญแล้ว กรุณารีเฟรชหน้า (กด F5)' };
    user({ role: 'agency', agency_tokens: ['tok1'] });

    // ส่งรายชื่อ (ทีละคน / หลายคน): ค่าตัวที่แท็บเก่าส่งมาไม่ถูกใช้ แถวใหม่เริ่มที่ 0 เสมอ
    const one = await send('/api/agency/tok1', 'POST', { account_name: 'kol', budget: 9000, platform: 'TikTok' });
    assert.equal(one.status, 201);
    assert.equal(added[0].budget, 0);
    const oneBody = await one.json();
    assert.equal(oneBody.data.budget, null);
    assert.equal(oneBody.data_all[0].budget, null);
    assert.equal('ad_spend' in oneBody.data, false);
    const many = await send('/api/agency/tok1/batch', 'POST', { items: [{ account_name: 'kol', budget: 5 }] });
    assert.equal(many.status, 201);
    assert.equal(added[1].budget, 0);
    assert.equal((await many.json()).data[0].budget, null);

    // มีแต่ค่าตัว = แท็บเก่า: ตอบ 409 ให้รีเฟรช ไม่เรียก store เขียนอะไรเลย
    for (const body of [{ budget: 4000 }, { budget: 4000, budget_per_clip: true }, { budget_per_clip: true }]) {
        const res = await put(body);
        assert.equal(res.status, 409, JSON.stringify(body));
        assert.deepEqual(await res.json(), FEE_MOVED);
    }
    assert.equal(person.length + single.length, 0);

    // มีช่องอื่นมาด้วย: ตัดค่าตัวทิ้ง บันทึกที่เหลือตามปกติ (แก้ตัวคน = updatePerson เหมือนเดิม)
    const edited = await put({ account_name: 'kol', budget: 7000, budget_per_clip: true });
    assert.equal(edited.status, 200);
    assert.equal(person.length, 1);
    assert.equal(person[0].account_name, 'kol');
    assert.equal(person[0].budget, undefined);
    assert.equal('budget_per_clip' in person[0], false);
    assert.equal((await edited.json()).data.budget, null);
    assert.equal((await put({ agency_note: 'ราคาตามแชท', budget: 3000 })).status, 200);
    assert.equal(single.length, 1);
    assert.equal(single[0].agency_note, 'ราคาตามแชท');
    assert.equal(single[0].budget, undefined);

    // ทีมที่เปิดลิงก์เดียวกันก็เขียนค่าตัวผ่านเส้นนี้ไม่ได้ แต่ยังเห็นค่าตัวจริง
    user();
    const staff = await put({ budget: 4000 });
    assert.equal(staff.status, 409);
    assert.equal((await staff.json()).code, 'FEE_MOVED');
    const staffEdit = await put({ account_name: 'kol', budget: 6000 });
    assert.equal(staffEdit.status, 200);
    assert.equal(person[1].budget, undefined);
    assert.equal((await staffEdit.json()).data.budget, '5000.00');
    assert.equal(person.length + single.length, 3);

    // PUT รายชื่อฝั่งทีมก็ไม่รับค่าตัวแล้ว — ตั้งผ่าน PUT /api/projects/:id/fees ที่เดียว
    store.projects.findByIdFull = async () => project;
    const team = await send('/api/projects/41/submissions/5', 'PUT', { budget: 7000, team_note: 'x' });
    assert.equal(team.status, 200);
    assert.equal(single.length, 2);
    assert.equal('budget' in single[1], false);
    assert.equal(single[1].team_note, 'x');
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


test('booking steps: the finder confirms or releases, only the brand team decides a higher fee', async () => {
    let saved = [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 5000, headcount: 2, filled: 2, assignee_id: 7,
          candidates: [{ key: 'c1', name: 'มะลิ', status: 'เลือกแล้ว' }, { key: 'c2', name: 'ชบา', status: 'เลือกแล้ว' }] },
        { key: 'p1', mode: 'direct', name: 'มะลิ', fee: 5000, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c1', booking: { state: 'pending' } },
        { key: 'p2', mode: 'direct', name: 'ชบา', fee: 5000, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c2', booking: { state: 'pending' } },
        { key: 'x1', mode: 'direct', name: 'คนของงานอื่น', fee: 1, status: 'ตกลงแล้ว' }
    ];
    const logs = [];
    store.projects.findByIdFull = async () => ({ id: 61, name: 'งานจ้าง', brand: 'Beauterry', team_id: 1, campaign_type: 'other', hire_items: saved });
    store.projects.patchHireItems = async (id, key, fn) => {
        const row = saved.find(it => it.key === key);
        if (!row) return null;
        const next = fn(structuredClone(row), structuredClone(saved));
        if (!Array.isArray(next)) return null;
        saved = next;
        return structuredClone(next);
    };
    store.activity.log = async entry => { logs.push(entry); };
    const post = (tail, body, token = adminToken) => request(`/api/projects/61/hires/r1/bookings/${tail}`, token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });

    // คนหา (user 7) ไม่มีสิทธิ์แบรนด์: คอนเฟิร์มด้วยค่าตัวสูงกว่า → รอทีมอนุมัติ · เห็นเฉพาะใบของตัวเอง + คนที่ได้จากใบนี้
    user({ role: 'member', team_id: 2, brands: [] });
    let res = await post('p1/confirm', { fee: 7000, use_time: '10:00', name: 'ปลอม' });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data.map(it => it.key).sort(), ['p1', 'p2', 'r1']);
    assert.equal(saved.find(it => it.key === 'p1').booking.state, 'fee_review');
    assert.equal(saved.find(it => it.key === 'p1').name, 'มะลิ');
    // คนหาอนุมัติ/ไม่อนุมัติค่าตัวให้ตัวเองไม่ได้ — รวมถึงเปลี่ยนตัวพิมพ์ชื่อคำสั่งเพื่อหลบด่าน
    assert.equal((await post('p1/fee-approve', { expected_fee: 7000 })).status, 403);
    assert.equal((await post('p1/Fee-Reject', { expected_fee: 7000 })).status, 404);
    assert.equal((await post('p1/CONFIRM', { fee: 1 })).status, 404);
    assert.equal(saved.find(it => it.key === 'p1').booking.state, 'fee_review');

    // คนนอก (ไม่ใช่คนหา ไม่มีสิทธิ์แบรนด์) แตะอะไรไม่ได้เลย
    const stranger = jwt.sign({ id: 99, role: 'member', team_id: 2 }, process.env.JWT_SECRET);
    assert.equal((await post('p2/confirm', {}, stranger)).status, 403);
    assert.equal((await post('p2/unavailable', {}, stranger)).status, 403);

    // คนหาแจ้งคิวไม่ว่าง → หลุดจากงาน คืนที่ว่างให้ใบ
    res = await post('p2/unavailable', { reason: 'ติดงาน' });
    assert.equal(res.status, 200);
    assert.ok(!saved.some(it => it.key === 'p2'));
    assert.equal(saved.find(it => it.key === 'r1').filled, 1);

    // ทีมแบรนด์อนุมัติค่าตัวใหม่ — ต้องเป็นยอดที่เห็นบนจอ
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    assert.equal((await post('p1/fee-approve', { expected_fee: 5000 })).status, 409);
    // ลบใบตอนยังมีคนรอค่าตัวใหม่ไม่ได้
    assert.equal((await request('/api/projects/61/hires/r1', adminToken, { method: 'DELETE' })).status, 409);
    assert.ok(saved.some(it => it.key === 'r1'));
    res = await post('p1/fee-approve', { expected_fee: 7000 });
    assert.equal(res.status, 200);
    const p1 = saved.find(it => it.key === 'p1');
    assert.equal(p1.fee, 7000);
    assert.equal(p1.status, 'ตกลงแล้ว');
    // คอนเฟิร์มแล้วใช้ปุ่มคิวไม่ว่างไม่ได้ · กดซ้ำขั้นเดิมได้ 409 ไม่เขียนซ้ำ
    assert.equal((await post('p1/unavailable', { reason: 'x' })).status, 409);
    assert.equal((await post('p1/confirm', { fee: 1 })).status, 409);
    // action อื่นไม่มีเส้นให้เรียก
    assert.equal((await post('p1/delete')).status, 404);
    assert.equal(logs.length, 3, 'บันทึกประวัติเฉพาะครั้งที่สำเร็จ');

    // งานปิดแล้ว: คนหาแตะไม่ได้ ทีมแบรนด์ยังเก็บงานค้างได้
    saved.push({ key: 'p3', mode: 'direct', name: 'ส้ม', fee: 5000, status: 'ทาบทาม', from_request: 'r1', booking: { state: 'pending' } });
    store.projects.findByIdFull = async () => ({ id: 61, name: 'งานจ้าง', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Completed', hire_items: saved });
    user({ role: 'member', team_id: 2, brands: [] });
    assert.equal((await post('p3/confirm', {})).status, 409);
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    assert.equal((await post('p3/confirm', {})).status, 200);
    assert.equal(saved.find(it => it.key === 'p3').status, 'ตกลงแล้ว');
});


test('saving an Other job writes hire rows and the other fields in one transaction', async () => {
    user();
    const project = { id: 62, name: 'งานเดิม', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active',
        updated_at: '2026-09-18T01:00:00.000Z', hire_items: [{ key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000, status: 'ตกลงแล้ว' }] };
    store.projects.findByIdFull = async () => project;
    store.activity.log = async () => {};
    let plainUpdates = 0;
    store.projects.update = async () => { plainUpdates++; return project; };
    const calls = [];
    let conflict = false;
    store.projects.updateWithHireItems = async (id, fields, expected, build) => {
        calls.push({ id, fields, expected });
        if (conflict) return { conflict: true };
        const items = build(project.hire_items);
        return { row: { ...project, ...fields, hire_items: items }, items };
    };
    const put = body => request('/api/projects/62', adminToken, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const body = { name: 'ชื่อใหม่', status: 'Active', budget: 999999, expected_updated_at: project.updated_at,
        hire_items: [{ key: 'h1', mode: 'direct', name: 'มะลิ', fee: 2500, status: 'ตกลงแล้ว' }] };

    const res = await put(body);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, 'บันทึกผ่านทรานแซกชันเดียว');
    assert.equal(plainUpdates, 0, 'ไม่แยกบันทึกช่องอื่นอีกรอบ');
    assert.equal(calls[0].fields.name, 'ชื่อใหม่');
    assert.equal(calls[0].fields.budget, undefined, 'งบของงานจ้างคิดจากรายการจ้าง ไม่รับจากฟอร์ม');
    assert.equal(calls[0].fields.hire_items, undefined);
    assert.equal(calls[0].expected, project.updated_at);
    assert.equal((await res.json()).data.name, 'ชื่อใหม่');

    // มีคนแก้ระหว่างนั้น → 409 และไม่มีอะไรถูกบันทึกเลย (รวมช่องอื่นด้วย)
    conflict = true;
    assert.equal((await put(body)).status, 409);
    assert.equal(plainUpdates, 0);

    // แก้เฉพาะสถานะ (ไม่มีรายการจ้าง) → ทางเดิม
    conflict = false;
    assert.equal((await put({ status: 'Completed' })).status, 200);
    assert.equal(plainUpdates, 1);
});

test('ad spend and reach typed on the Ads page are cleaned before saving', async () => {
    user();
    let sub = { id: 11, ad_spend: 0, ad_reach: 0, id_post: null, ad_synced_at: null };
    store.ads.subContext = async () => ({ submission: sub, brand: 'Beauterry', project_id: 5, project_name: 'x', account_name: 'kol', team_id: 1 });
    const saved = [];
    store.submissions.update = async (id, pid, fields) => { saved.push(fields); return { id: Number(id), ...fields }; };
    store.activity.log = async () => {};
    const put = body => request('/api/ads/11', adminToken, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await put({ ad_spend: 12500, ad_reach: 34000 })).status, 200);
    assert.deepEqual(saved.pop(), { ad_spend: 12500, ad_reach: 34000 });
    assert.equal((await put({ ad_spend: -5000, ad_reach: -3 })).status, 200);
    assert.deepEqual(saved.pop(), { ad_spend: 0, ad_reach: 0 }, 'ค่าติดลบกลายเป็น 0');
    assert.equal((await put({ ad_spend: 'abc', ad_reach: 12.9 })).status, 200);
    assert.deepEqual(saved.pop(), { ad_spend: 0, ad_reach: 12 });
    assert.equal((await put({ ad_spend: 1e15 })).status, 200);
    assert.equal(saved.pop().ad_spend, 100000000, 'เลขมหาศาลที่พิมพ์ผิดถูกจำกัด');
    // member แบรนด์อื่นแก้ไม่ได้
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    assert.equal((await put({ ad_spend: 1 })).status, 403);

    // member ของแบรนด์นั้นเอง: มองไม่เห็นค่าแอด (ถูกปิดไว้) จึงห้ามเขียนทับ แต่ใส่ Reach ได้ และแถวที่คืนมาต้องไม่มีค่าแอด
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    store.submissions.update = async (id, pid, fields) => ({ id: 11, ad_spend: 25000, ad_reach: fields.ad_reach || 0, perf_stamp: { total_cost: 30000, cpm: 5 } });
    assert.equal((await put({ ad_spend: 500 })).status, 403);
    const memberRes = await put({ ad_reach: 900 });
    assert.equal(memberRes.status, 200);
    const memberRow = (await memberRes.json()).data;
    assert.equal(memberRow.ad_spend, null);
    assert.equal(memberRow.perf_stamp.total_cost, null);

    // โพสต์ที่ PFM ซิงก์ค่าแอดให้ (ID Post เป็นตัวเลข / เคยซิงก์แล้ว) — กรอกทับไม่ได้ แม้เป็น admin
    user();
    store.submissions.update = async (id, pid, fields) => { saved.push(fields); return { id: Number(id), ...fields }; };
    sub = { ...sub, id_post: '7412345678901234567' };
    assert.equal((await put({ ad_spend: 100 })).status, 409);
    sub = { ...sub, id_post: null, ad_synced_at: '2026-09-18T00:00:00.000Z' };
    assert.equal((await put({ ad_spend: 100 })).status, 409);
    assert.equal((await put({ ad_reach: 500 })).status, 200, 'Reach PFM ไม่ได้ส่งมา กรอกได้ทุกโพสต์');

    // ค่าในฐานเปลี่ยนไประหว่างที่หน้าเปิดอยู่ → ไม่เขียนทับ
    sub = { ...sub, ad_synced_at: null, ad_spend: 1200.5, ad_reach: 40 };
    assert.equal((await put({ ad_spend: 900, ad_spend_from: 1000 })).status, 409);
    assert.equal((await put({ ad_spend: 900, ad_spend_from: 1200.5 })).status, 200);
    assert.equal((await put({ ad_reach: 90, ad_reach_from: 10 })).status, 409);

    // หน้า Ads ที่เปิดค้าง: เอเจนซี่เพิ่งแก้ข้อมูลโพสต์ (รอทีมตรวจ) → กด "ยิงแล้ว" ไม่ได้ แต่เรื่องอื่นยังบันทึกได้
    sub = { ...sub, ad_spend: 0, ad_reach: 0, post_check: 'pending' };
    assert.equal((await put({ ad_status: 'ยิงแล้ว' })).status, 409);
    sub = { ...sub, post_check: 'returned' };
    assert.equal((await put({ ad_status: 'ยิงแล้ว' })).status, 409);
    assert.equal((await put({ ad_status: 'ยังไม่ยิง' })).status, 200);
    sub = { ...sub, post_check: 'changed' };                                   // แก้หลังยิงแอด = ยังอยู่หน้า Ads
    assert.equal((await put({ ad_status: 'ยิงแล้ว' })).status, 200);
    sub = { ...sub, post_check: 'ok' };
    assert.equal((await put({ ad_status: 'ยิงแล้ว' })).status, 200);
});

test('staff can only open agency links of brands they may see', async () => {
    const { project } = agencyFixture();
    project.brand = 'Beauterry';
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    const denied = await request('/api/agency/tok1');
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).message, 'ไม่มีสิทธิ์เปิดลิงก์ของแบรนด์อื่น');
    assert.equal((await request('/api/agency/tok1/messages')).status, 403);
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    assert.equal((await request('/api/agency/tok1')).status, 200);
    user({ role: 'manager', team_id: 3, brands: [] });
    assert.equal((await request('/api/agency/tok1')).status, 200);
    user({ role: 'agency', agency_tokens: ['tok1'] });
    assert.equal((await request('/api/agency/tok1')).status, 200);
});

test('production refuses missing settings, sample secrets and invalid ports', () => {
    assert.throws(() => validateRuntime({ NODE_ENV: 'production' }), /Missing production settings/);
    const env = { NODE_ENV: 'production', JWT_SECRET: process.env.JWT_SECRET, DB_HOST: 'fixture', DB_PORT: '5432',
        DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASSWORD: 'fixture', PORT: '3080', UPLOAD_DIR: process.env.UPLOAD_DIR };
    assert.doesNotThrow(() => validateRuntime(env));
    assert.throws(() => validateRuntime({ ...env, JWT_SECRET: 'change_this_to_a_long_random_secret' }), /JWT_SECRET/);
    assert.throws(() => validateRuntime({ ...env, PORT: '0' }), /PORT/);
});

test('production process exits when its database is unavailable so PM2 can restart it', { timeout: 15000 }, async () => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../server/src/index.js')], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            NODE_ENV: 'production',
            JWT_SECRET: crypto.randomBytes(48).toString('hex'),
            DB_HOST: '127.0.0.1',
            DB_PORT: '1',
            DB_NAME: 'unavailable',
            DB_USER: 'unavailable',
            DB_PASSWORD: 'unavailable',
            PORT: '3080',
            HOST: '127.0.0.1',
            UPLOAD_DIR: process.env.UPLOAD_DIR
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /Database is not ready/);
});

// ประเภทแคมเปญ (campaign_type) — 'kol' เข้าหน้าโฆษณา/รายงาน ส่วน 'other' ไม่เข้า
// ถ้าสลับประเภทของแคมเปญที่มีรายชื่อและค่าแอดอยู่แล้วได้ ข้อมูลพวกนั้นจะหายจากสองหน้านั้นเงียบ ๆ
test('campaign type is fixed at creation and cannot be switched afterwards', async () => {
    const updates = [];
    store.projects.findByIdFull = async () => ({ id: 61, name: 'KOL Sep', brand: 'Jdent', team_id: 1, campaign_type: 'kol' });
    store.projects.update = async (id, fields) => { updates.push({ id, fields }); return { id: Number(id), name: 'KOL Sep', team_id: 1 }; };
    store.activity.log = async () => {};
    const put = body => request('/api/projects/61', adminToken, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    user();
    const blocked = await put({ campaign_type: 'other', name: 'KOL Sep' });
    assert.equal(blocked.status, 400);
    assert.equal(updates.length, 0);   // ต้องไม่เขียนอะไรเลย ไม่ใช่เขียนบางส่วนแล้วค่อยตีกลับ

    // ส่งประเภทเดิมมาด้วย (ฟอร์มส่งทั้งก้อน) ต้องผ่านตามปกติ ไม่ใช่โดนบล็อกไปด้วย
    assert.equal((await put({ campaign_type: 'kol', name: 'KOL Sep' })).status, 200);
    assert.equal(updates.length, 1);

    // แคมเปญเก่าที่ยังไม่มีคอลัมน์นี้ = แบบ KOL — แก้ต่อได้เหมือนเดิม
    store.projects.findByIdFull = async () => ({ id: 61, name: 'KOL Sep', brand: 'Jdent', team_id: 1 });
    assert.equal((await put({ campaign_type: 'kol', name: 'KOL Sep' })).status, 200);
    assert.equal((await put({ campaign_type: 'other', name: 'KOL Sep' })).status, 400);
    assert.equal(updates.length, 2);
});

// ค่าประเภทที่ไม่รู้จักต้องถอยเป็น 'kol' ไม่ใช่ลงฐานตรง ๆ
// (ไม่งั้นแคมเปญจะหายจากหน้าโฆษณา/รายงาน เพราะสองหน้านั้นกรองด้วย campaign_type)
test('unknown campaign types fall back to kol in the store', async () => {
    const jsonStore = require('../server/src/store/jsonStore');
    // jsonStore เขียนลง server/data/db.json จริง — เครื่องที่ยังไม่มีไฟล์นี้ต้องไม่มีไฟล์ค้างหลังเทส
    const dataFile = path.resolve(__dirname, '../server/data/db.json');
    const hadFile = fs.existsSync(dataFile);
    try {
        for (const [sent, expected] of [['other', 'other'], ['kol', 'kol'], ['OTHER', 'kol'], [undefined, 'kol'], ['', 'kol'], [{}, 'kol']]) {
            const created = await jsonStore.projects.create({ team_id: 1, created_by: 7, name: 'ทดสอบประเภทแคมเปญ', campaign_type: sent });
            assert.equal(created.campaign_type, expected, `create ${JSON.stringify(sent)}`);
            const updated = await jsonStore.projects.update(created.id, { campaign_type: sent });
            assert.equal(updated.campaign_type, expected, `update ${JSON.stringify(sent)}`);
            await jsonStore.projects.remove(created.id);
        }
    } finally {
        if (!hadFile) fs.rmSync(dataFile, { force: true });
    }
});

test('saving from a tab opened before the per-product Target deploy keeps the saved per-product Targets', async () => {
    const project = { id: 33, name: 'fixture', team_id: 1, brand: 'Jdent', ad_groups: [{ key: 'g1', blocks: [
        { platform: 'TikTok', products: ['L3', 'L4'], target: ['a', 'b'], product_targets: { L3: ['a'], L4: ['b'] } }] }] };
    let sent = null;
    store.projects.findByIdFull = async () => project;
    store.projects.update = async (id, fields) => { sent = fields; return { ...project, ...fields }; };
    store.activity.log = async () => {};
    user();
    const put = groups => request('/api/projects/33', adminToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', ad_groups: groups }) });
    // ฟอร์มรุ่นเก่าส่งบล็อกที่ไม่มี product_targets และ Target รวมเท่าเดิม → ยกของเดิมมาต่อ
    assert.equal((await put([{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], target: ['b', 'a'] }] }])).status, 200);
    assert.deepEqual(sent.ad_groups[0].blocks[0].product_targets, { L3: ['a'], L4: ['b'] });
    // ฟอร์มรุ่นใหม่ส่งมาเอง → ใช้ของที่ส่งมา
    assert.equal((await put([{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3'], target: ['a'], product_targets: { L3: ['a'] } }] }])).status, 200);
    assert.deepEqual(sent.ad_groups[0].blocks[0].product_targets, { L3: ['a'] });
});

test('saving from a tab opened before the per-product budget deploy keeps the per-product budgets', async () => {
    const project = { id: 34, name: 'fixture', team_id: 1, brand: 'Jdent', ad_groups: [{ key: 'g1', blocks: [
        { platform: 'Facebook', products: ['L3', 'L4'], budget: '500', budget_mode: 'split', product_budgets: { L3: 300, L4: 200 } }] }] };
    let sent = null;
    store.projects.findByIdFull = async () => project;
    store.projects.update = async (id, fields) => { sent = fields; return { ...project, ...fields }; };
    store.activity.log = async () => {};
    user();
    const put = groups => request('/api/projects/34', adminToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', ad_groups: groups }) });
    // ฟอร์มรุ่นเก่าไม่ส่ง budget_mode และงบเท่าเดิม → ยกงบรายสินค้าเดิมมาต่อ
    assert.equal((await put([{ key: 'g1', blocks: [{ platform: 'Facebook', products: ['L3', 'L4'], budget: '500' }] }])).status, 200);
    assert.equal(sent.ad_groups[0].blocks[0].budget_mode, 'split');
    assert.deepEqual(sent.ad_groups[0].blocks[0].product_budgets, { L3: 300, L4: 200 });
    // ฟอร์มรุ่นใหม่เปลี่ยนเป็นงบก้อนเดียว → ใช้ตามที่ส่งมา
    assert.equal((await put([{ key: 'g1', blocks: [{ platform: 'Facebook', products: ['L3', 'L4'], budget: '500', budget_mode: 'total' }] }])).status, 200);
    assert.equal(sent.ad_groups[0].blocks[0].budget_mode, 'total');
    assert.equal(sent.ad_groups[0].blocks[0].product_budgets, undefined);
});

test('saving from a tab opened before the per-product concept deploy keeps the per-product concepts', async () => {
    const project = { id: 35, name: 'fixture', team_id: 1, brand: 'Jdent', ad_groups: [{ key: 'g1', concept: 'หลัก',
        blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], concept_split: true, product_concepts: { L3: 'กันแดด' } }] }] };
    let sent = null;
    store.projects.findByIdFull = async () => project;
    store.projects.update = async (id, fields) => { sent = fields; return { ...project, ...fields }; };
    store.activity.log = async () => {};
    user();
    const put = groups => request('/api/projects/35', adminToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', ad_groups: groups }) });
    // ฟอร์มรุ่นเก่าไม่ส่ง concept_split และ Concept หลักเท่าเดิม → ยก Concept ต่อสินค้าเดิมมาต่อ
    assert.equal((await put([{ key: 'g1', concept: 'หลัก', blocks: [{ platform: 'TikTok', products: ['L3', 'L4'] }] }])).status, 200);
    assert.equal(sent.ad_groups[0].blocks[0].concept_split, true);
    assert.deepEqual(sent.ad_groups[0].blocks[0].product_concepts, { L3: 'กันแดด' });
    // ฟอร์มรุ่นใหม่ปิดการแยก → ใช้ตามที่ส่งมา
    assert.equal((await put([{ key: 'g1', concept: 'หลัก', blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], concept_split: false }] }])).status, 200);
    assert.equal(sent.ad_groups[0].blocks[0].concept_split, false);
    assert.equal(sent.ad_groups[0].blocks[0].product_concepts, undefined);
});

test('post-check: agency edits are marked as agency, team edits as team, and only the team decides', async () => {
    const { row } = agencyFixture();
    const calls = [];
    store.submissions.update = async (id, pid, fields, byName, opts) => { calls.push({ byName, opts }); return row; };
    store.submissions.updatePerson = async (id, pid, fields, byName, opts) => { calls.push({ byName, opts }); return row; };
    const send = (url, method, body) => request(url, adminToken, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // บัญชีเอเจนซี่แก้ข้อมูลโพสต์ = agency (ต้องรอทีมตรวจ)
    user({ role: 'agency', agency_tokens: ['tok1'] });
    assert.equal((await send('/api/agency/tok1/submissions/5', 'PUT', { id_post: '123' })).status, 200);
    assert.equal(calls[0].opts.actor, 'agency');
    assert.equal(calls[0].byName, 'Fixture Agency (เอเจนซี่)');
    // ทีมที่เปิดลิงก์เดียวกัน = team (นับว่าตรวจแล้ว) และบันทึกชื่อทีมจริง
    user();
    assert.equal((await send('/api/agency/tok1/submissions/5', 'PUT', { id_post: '124' })).status, 200);
    assert.equal(calls[1].opts.actor, 'team');
    assert.equal(calls[1].byName, 'fixture');

    // ทีมตัดสินผลตรวจ
    const project = { id: 41, name: 'fixture', brand: 'Jdent', team_id: 1 };
    store.projects.findByIdFull = async () => project;
    const decided = [], logs = [];
    let cur = { id: 5, project_id: 41, account_name: 'kol', post_url: 'https://x.test/v/1', post_check: 'pending' };
    store.submissions.get = async () => cur;
    store.submissions.setPostCheck = async (id, pid, action, note, byName, seenAt) => {
        if (seenAt === 'stale') { const e = new Error('ข้อมูลโพสต์เพิ่งถูกแก้'); e.status = 409; throw e; }
        decided.push({ action, note, byName, seenAt }); return { ...cur, post_check: action === 'ok' ? 'ok' : 'returned' };
    };
    store.activity.log = async entry => { logs.push(entry); };
    const check = body => send('/api/projects/41/submissions/5/post-check', 'POST', body);
    assert.equal((await check({ action: 'ok', seen_at: '2026-09-18T10:00:00.000Z' })).status, 200);
    assert.deepEqual(decided[0], { action: 'ok', note: null, byName: 'fixture', seenAt: '2026-09-18T10:00:00.000Z' });
    // เอเจนซี่แก้แทรกระหว่างที่ทีมดูอยู่ → 409 ไม่บันทึกกิจกรรม
    assert.equal((await check({ action: 'ok', seen_at: 'stale' })).status, 409);
    assert.equal((await check({ action: 'return', note: '  ' })).status, 400);        // ส่งกลับต้องมีเหตุผล
    assert.equal((await check({ action: 'return', note: 'ID ไม่ตรง' })).status, 200);
    assert.deepEqual(decided[1], { action: 'return', note: 'ID ไม่ตรง', byName: 'fixture', seenAt: undefined });
    assert.equal((await check({ action: 'approve' })).status, 400);                   // คำสั่งอื่นไม่รับ
    assert.equal((await check({ action: 'return', note: 'x'.repeat(501) })).status, 400);
    cur = { ...cur, project_id: 99 };                                                  // แถวของแคมเปญอื่น
    assert.equal((await check({ action: 'ok' })).status, 404);
    cur = { id: 5, project_id: 41, account_name: 'kol', post_url: null, gencode: null, id_post: null };
    assert.equal((await check({ action: 'ok' })).status, 400);                        // ยังไม่มีข้อมูลโพสต์
    assert.equal(decided.length, 2);
    assert.equal(logs.length, 2);
    // บัญชีเอเจนซี่เรียกเส้นนี้ไม่ได้
    user({ role: 'agency', agency_tokens: ['tok1'] });
    cur = { id: 5, project_id: 41, account_name: 'kol', post_url: 'https://x.test/v/1', post_check: 'pending' };
    assert.notEqual((await check({ action: 'ok' })).status, 200);
    assert.equal(decided.length, 2);
});
