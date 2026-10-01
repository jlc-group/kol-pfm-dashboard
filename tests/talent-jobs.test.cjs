const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// Talent Book รอบ 1 ต.ค. 2026 (ผู้ใช้สั่ง):
//   • งานที่จ้างหลายงานต่อคน — /api/hires/talents/:id/jobs (เพิ่ม / แก้ / ลบ) + GET /talents/:id มี jobs + การ์ดมี talent.jobs_count
//   • ช่องทาง Social หลายช่อง (socials) — แถวเก่าที่มีแค่ link ไม่หาย · ฟอร์มรุ่นก่อน (ส่งแค่ link) ยังใช้ได้
//   • รูปการ์ดดึงจากลิงก์ TikTok / YouTube / X เอง (หลังบันทึก + ปุ่ม "ดึงรูปจากลิงก์") · วางรูป Ctrl+V = อัปแบบเดียวกับเลือกไฟล์
// ทั้งหมดใช้ข้อมูลจำลองในหน่วยความจำ — ฐานข้อมูลของระบบคือ production ห้ามแตะ · เว็บภายนอกจำลองทั้งหมด (ห้ามยิงจริง)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-jobs-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-jobs test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ---------------------------------------------------------------- เว็บภายนอกจำลอง
// fetch ของหน้าเทสต์เอง (127.0.0.1) ผ่านจริง · ที่เหลือ (TikTok / YouTube / X) ไปที่ outbound — ไม่ได้ตั้ง = เครือข่ายล่ม
const realFetch = globalThis.fetch;
let base = '';
let outbound = null;
const outCalls = [];
globalThis.fetch = (url, opts) => {
    const u = String(url);
    if (base && u.startsWith(base)) return realFetch(url, opts);
    outCalls.push(u);
    return outbound ? outbound(u, opts) : Promise.reject(new TypeError('ห้ามยิงเว็บจริงในเทสต์: ' + u));
};
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), crypto.randomBytes(200)]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex');
const ttImg = h => `https://p16-common-sign.tiktokcdn.com/tos-avt/${h}~tplv.jpeg?x-signature=a`;
// TikTok จำลอง: หน้าโปรไฟล์ของทุกชื่อมี avatarLarger (เข้ารหัส / เป็น \u002F) → รูป JPEG
function fakeTikTok({ fail = false } = {}) {
    outbound = async u => {
        const m = /^https:\/\/www\.tiktok\.com\/@([^/?#]+)$/.exec(u);
        if (m) {
            if (fail) return new Response('blocked', { status: 403 });
            return new Response(`<script>{"avatarLarger":"${ttImg(m[1]).replace(/\//g, '\\u002F')}"}</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        if (u.startsWith('https://p16-common-sign.tiktokcdn.com/')) return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        throw new TypeError('ไม่มีในข้อมูลจำลอง: ' + u);
    };
}

// ---------------------------------------------------------------- ข้อมูลจำลอง
const rows = new Map();
const jobs = new Map();
let seq = 0, jseq = 0;
const P90 = {
    id: 90, name: 'ถ่ายแบบ Oct', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: 'Miw',
    start_date: '2026-10-01', hire_items: [{ key: 'd1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 15000, status: 'ตกลงแล้ว', link: 'https://instagram.com/mali' }]
};
const FIXTURE = { other_projects: [P90], user_names: [] };
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
const realLoadSnapshot = snapshot.loadSnapshot;
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) {
        snap[t] = t === 'talents' ? [...rows.values()].map(r => structuredClone(r))
            : t === 'talent_jobs' ? [...jobs.values()].map(j => ({ id: j.id, talent_id: j.talent_id, brand: j.brand }))
                : structuredClone(FIXTURE[t] || []);
    }
    return snap;
};

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

// ตัวจริงของชั้นฐานข้อมูล (เทสต์ท้ายไฟล์เรียกตรงกับ pool จำลอง) — เก็บไว้ก่อนแทนด้วยตัวจำลอง (store.* คือ object เดียวกัน)
const REAL = { jobs: { ...store.talentJobs }, setFile: store.talents.setFile };

// store.talents จำลอง — พฤติกรรมเดียวกับ pg/talents.js (รวม keepUserFile ของ setFile)
const norm = v => String(v ?? '').trim().toLowerCase();
const iso = () => new Date().toISOString();
store.talents.findById = async id => { const r = rows.get(Number(id)); return r ? structuredClone(r) : null; };
store.talents.findByKey = async (name, kind, exceptId = null) =>
    [...rows.values()].find(r => norm(r.name) === norm(name) && norm(r.kind) === norm(kind) && r.id !== Number(exceptId)) || null;
store.talents.create = async (fields, { byId = null, byName = null } = {}) => {
    const r = { id: ++seq, name: null, kind: null, link: null, socials: [], brands: [], contact_mode: null, contact_name: null, contact: null, agency: null,
        rate: null, rate_unit: null, scope: null, image: null, image_link: null, clip: null, clip_link: null, note: null,
        ...structuredClone(fields), created_by_id: byId, created_by: byName, created_at: iso(), updated_at: iso() };
    rows.set(r.id, r);
    return structuredClone(r);
};
store.talents.update = async (id, fields) => {
    const r = rows.get(Number(id));
    if (!r) return null;
    Object.assign(r, structuredClone(fields), { updated_at: iso() });
    return structuredClone(r);
};
store.talents.remove = async id => {
    const r = rows.get(Number(id));
    if (!r) return null;
    rows.delete(Number(id));
    for (const [k, j] of jobs) if (j.talent_id === Number(id)) jobs.delete(k);   // ON DELETE CASCADE
    return structuredClone(r);
};
store.talents.setFile = async (id, field, meta, { keepUserFile = false, stillWanted = null } = {}) => {
    const r = rows.get(Number(id));
    if (!r) return null;
    if (keepUserFile && r[field] && r[field].source !== 'auto') return { row: structuredClone(r), old: null, kept: true };
    if (typeof stillWanted === 'function' && !stillWanted(structuredClone(r))) return { row: structuredClone(r), old: null, kept: true, stale: true };
    const old = r[field];
    r[field] = meta;
    r.updated_at = iso();
    return { row: structuredClone(r), old };
};
// store.talentJobs จำลอง — พฤติกรรมเดียวกับ pg/talentJobs.js (สิทธิ์แบรนด์ · ใหม่สุดก่อน · งานของคนอื่น = ไม่พบ)
store.talentJobs.listByTalent = async (tid, { scopeBrands = null } = {}) => [...jobs.values()]
    .filter(j => j.talent_id === Number(tid) && (!Array.isArray(scopeBrands) || scopeBrands.includes(j.brand)))
    .sort((a, b) => b.hired_on.localeCompare(a.hired_on) || b.id - a.id).map(j => ({ ...j }));
store.talentJobs.findById = async (tid, jid) => { const j = jobs.get(Number(jid)); return j && j.talent_id === Number(tid) ? { ...j } : null; };
store.talentJobs.create = async (tid, fields, { byId = null, byName = null } = {}) => {
    if (!rows.has(Number(tid))) return null;
    const j = { id: ++jseq, talent_id: Number(tid), brand: null, hired_on: null, fee: null, scope: null, work_link: null, note: null,
        ...fields, created_by_id: byId, created_by: byName, created_at: iso(), updated_at: iso() };
    jobs.set(j.id, j);
    return { ...j };
};
store.talentJobs.update = async (tid, jid, fields) => {
    const j = jobs.get(Number(jid));
    if (!j || j.talent_id !== Number(tid)) return null;
    Object.assign(j, fields, { updated_at: iso() });
    return { ...j };
};
store.talentJobs.remove = async (tid, jid) => {
    const j = jobs.get(Number(jid));
    if (!j || j.talent_id !== Number(tid)) return null;
    jobs.delete(Number(jid));
    return { ...j };
};
const logged = [];
store.activity.log = async entry => { logged.push(entry); return entry; };

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: null, role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'praew', full_name: 'Praew Team', nickname: 'แพรว', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jdent'] },
    3: { id: 3, username: 'fon', full_name: 'Fon', nickname: 'ฝน', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Beauterry'] },
    4: { id: 4, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['t1'] },
    5: { id: 5, username: 'mgr', full_name: 'Manager', nickname: 'เมย์', role: 'manager', status: 'active', is_active: true, team_id: 1, brands: [] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);

let server;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
beforeEach(() => {
    rows.clear(); jobs.clear(); seq = 0; jseq = 0; logged.length = 0; outCalls.length = 0; outbound = null;
    for (const f of fs.readdirSync(process.env.UPLOAD_DIR)) fs.rmSync(path.join(process.env.UPLOAD_DIR, f), { force: true });
});

const tokenOf = uid => jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
async function call(uid, method, url, body) {
    const res = await fetch(base + '/api' + url, {
        method,
        headers: { Authorization: `Bearer ${tokenOf(uid)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* ไฟล์ */ }
    return { status: res.status, body: json };
}
async function upload(uid, url, name, bytes, type) {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    const res = await fetch(base + '/api' + url, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(uid)}` }, body: fd });
    let json = null;
    try { json = await res.json(); } catch { /* */ }
    return { status: res.status, body: json };
}
const uploadsNow = () => fs.readdirSync(process.env.UPLOAD_DIR).filter(n => n.startsWith('talent')).sort();
const tick = () => new Promise(r => setTimeout(r, 30));
// คนใน Talent Book ที่แพรว (Jdent) เพิ่ม — ไม่มีลิงก์ที่ดึงรูปได้ (ไม่ยิงเว็บภายนอก)
const addTalent = async (extra = {}, uid = 2) => (await call(uid, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', ...extra })).body.data;

// ================================================================ งานที่จ้าง
test('เพิ่มงานที่จ้าง: แบรนด์ + เดือนที่จ้าง (ช่องเดือน YYYY-MM ได้) · ค่าตัวรับคอมมา · ส่งออกครบช่อง ไม่มี id ผู้ใช้ · บันทึกประวัติ', async () => {
    const t = await addTalent();
    const r = await call(2, 'POST', `/hires/talents/${t.id}/jobs`, {
        brand: ' Jdent ', hired_on: '2026-10', fee: '15,000', scope: ' ถ่ายนิ่ง 1 วัน ', work_link: ' https://www.tiktok.com/@ton/video/1 ', note: ' โอเค '
    });
    assert.equal(r.status, 201);
    const j = r.body.data;
    assert.deepEqual(Object.keys(j).sort(), ['added_by', 'brand', 'created_at', 'editable', 'fee', 'hired_on', 'id', 'note', 'scope', 'talent_id', 'updated_at', 'work_link']);
    assert.deepEqual([j.talent_id, j.brand, j.hired_on, j.fee, j.scope, j.work_link, j.note, j.added_by, j.editable],
        [t.id, 'Jdent', '2026-10-01', 15000, 'ถ่ายนิ่ง 1 วัน', 'https://www.tiktok.com/@ton/video/1', 'โอเค', 'แพรว', true]);
    assert.equal(jobs.get(j.id).created_by_id, 2);
    assert.equal(logged.at(-1).summary, 'Talent Book: เพิ่มงานที่จ้าง "ต้น" — Jdent (ต.ค. 2026)');
    assert.equal(logged.at(-1).action, 'create');
    // ไม่ใส่ค่าตัว = null (ไม่ใช่ 0) · วันที่เต็มก็ได้
    const r2 = await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Jdent', hired_on: '2025-02-28' });
    assert.equal(r2.status, 201);
    assert.deepEqual([r2.body.data.fee, r2.body.data.hired_on, r2.body.data.scope, r2.body.data.work_link], [null, '2025-02-28', null, null]);
});

test('งานที่จ้าง: ตรวจค่า (ข้อความภาษาไทย) ไม่บันทึกอะไร', async () => {
    const t = await addTalent();
    const bad = async (body, re) => {
        const r = await call(2, 'POST', `/hires/talents/${t.id}/jobs`, body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match(r.body.message, re);
    };
    await bad({ hired_on: '2026-10' }, /^เลือกแบรนด์$/);
    await bad({ brand: '  ', hired_on: '2026-10' }, /^เลือกแบรนด์$/);
    await bad({ brand: 'x'.repeat(61), hired_on: '2026-10' }, /แบรนด์ไม่ถูกต้อง/);
    await bad({ brand: 'Jdent' }, /^ใส่เดือนที่จ้าง$/);
    for (const d of ['2026-13', '2026-00', '2026-02-30', '26-10', 'ต.ค. 2026', '1999-12', '2026/10/01', 20261001]) {
        await bad({ brand: 'Jdent', hired_on: d }, /^วันที่จ้างไม่ถูกต้อง$/);
    }
    await bad({ brand: 'Jdent', hired_on: '2026-10', fee: -1 }, /ค่าตัวต้องเป็นตัวเลข 0 ขึ้นไป/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', fee: 'ห้าพัน' }, /ค่าตัวต้องเป็นตัวเลข 0 ขึ้นไป/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', fee: 2e9 }, /ค่าตัวสูงเกินไป/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', work_link: 'www.tiktok.com/@a' }, /ลิงก์ผลงานต้องขึ้นต้นด้วย http/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', work_link: 'javascript:alert(1)' }, /ลิงก์ผลงานต้องขึ้นต้นด้วย http/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', scope: 'ก'.repeat(2001) }, /Scope of work ยาวเกิน 2000/);
    await bad({ brand: 'Jdent', hired_on: '2026-10', note: 'ก'.repeat(1001) }, /หมายเหตุยาวเกิน 1000/);
    assert.equal(jobs.size, 0);
});

test('งานที่จ้าง: สิทธิ์ — เพิ่ม/แก้/ลบได้เฉพาะคนที่แก้การ์ดได้ (คนที่เพิ่ม / admin) และเฉพาะแบรนด์ที่ตัวเองดูแล', async () => {
    const t = await addTalent();
    const body = { brand: 'Jdent', hired_on: '2026-10' };
    assert.equal((await call(3, 'POST', `/hires/talents/${t.id}/jobs`, body)).status, 403, 'คนอื่น (ฝน) เพิ่มงานให้การ์ดของแพรวไม่ได้');
    assert.equal((await call(5, 'POST', `/hires/talents/${t.id}/jobs`, body)).status, 403, 'manager ก็ไม่ใช่คนที่เพิ่มการ์ด');
    assert.notEqual((await call(4, 'POST', `/hires/talents/${t.id}/jobs`, body)).status, 201, 'เอเจนซี่');
    const notMine = await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Beauterry', hired_on: '2026-10' });
    assert.equal(notMine.status, 403);
    assert.equal(notMine.body.message, 'เพิ่มงานได้เฉพาะแบรนด์ที่คุณดูแล');
    assert.equal(jobs.size, 0);
    assert.equal((await call(1, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Beauterry', hired_on: '2026-09' })).status, 201, 'admin เพิ่มแบรนด์ไหนก็ได้');
    assert.equal((await call(2, 'POST', '/hires/talents/999/jobs', body)).status, 404);
    assert.equal((await call(2, 'POST', '/hires/talents/abc/jobs', body)).status, 404);
});

test('ดูรายละเอียด: งานใหม่สุดก่อน · เห็นเฉพาะแบรนด์ที่มีสิทธิ์ (ทั้งรายการและจำนวน) · editable ตามคนที่ดู', async () => {
    const t = await addTalent();
    const add = (uid, brand, hired_on, fee) => call(uid, 'POST', `/hires/talents/${t.id}/jobs`, { brand, hired_on, fee });
    await add(2, 'Jdent', '2026-08', 1000);
    await add(1, 'Beauterry', '2026-10', 2000);
    await add(2, 'Jdent', '2026-10', 3000);    // เดือนเดียวกับงานก่อนหน้า — เพิ่มทีหลังขึ้นก่อน
    await add(1, 'Code Lab', '2025-12-15', null);

    const asAdmin = (await call(1, 'GET', `/hires/talents/${t.id}`)).body.data;
    assert.equal(asAdmin.jobs_count, 4);
    assert.deepEqual(asAdmin.jobs.map(j => [j.brand, j.hired_on, j.fee]), [
        ['Jdent', '2026-10-01', 3000], ['Beauterry', '2026-10-01', 2000], ['Jdent', '2026-08-01', 1000], ['Code Lab', '2025-12-15', null]]);
    assert.ok(asAdmin.jobs.every(j => j.editable));

    const asPraew = (await call(2, 'GET', `/hires/talents/${t.id}`)).body.data;
    assert.equal(asPraew.jobs_count, 2, 'แพรวเห็นแค่ Jdent');
    assert.deepEqual(asPraew.jobs.map(j => j.fee), [3000, 1000]);
    assert.ok(asPraew.jobs.every(j => j.editable));

    const asFon = (await call(3, 'GET', `/hires/talents/${t.id}`)).body.data;
    assert.deepEqual(asFon.jobs.map(j => j.brand), ['Beauterry']);
    assert.equal(asFon.jobs[0].editable, false, 'ฝนไม่ใช่คนที่เพิ่มการ์ด');
    assert.equal(asFon.editable, false);

    const asMgr = (await call(5, 'GET', `/hires/talents/${t.id}`)).body.data;
    assert.equal(asMgr.jobs_count, 4, 'manager เห็นทุกแบรนด์');
    assert.ok(asMgr.jobs.every(j => !j.editable));
    assert.ok(!JSON.stringify(asAdmin).includes('created_by_id'), 'ไม่ส่ง id ผู้ใช้');
});

test('แก้งาน: บางช่องที่เหลือคงเดิม · ย้ายไปแบรนด์ที่ไม่ได้ดูแลไม่ได้ · งานที่มองไม่เห็น/ของคนอื่น = ไม่พบ · คนอื่นแก้ไม่ได้', async () => {
    const t = await addTalent();
    const other = await addTalent({ name: 'ฟ้า' });
    const j = (await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Jdent', hired_on: '2026-10', fee: 5000, note: 'เดิม' })).body.data;
    const hidden = (await call(1, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Beauterry', hired_on: '2026-10' })).body.data;

    const r = await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { fee: '6,500', hired_on: '2026-11-15' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.data.fee, r.body.data.hired_on, r.body.data.note, r.body.data.brand], [6500, '2026-11-15', 'เดิม', 'Jdent']);
    assert.equal(logged.at(-1).summary, 'Talent Book: แก้งานที่จ้าง "ต้น" — Jdent (พ.ย. 2026)');
    const cleared = await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { fee: '', note: '' });
    assert.deepEqual([cleared.body.data.fee, cleared.body.data.note], [null, null], 'ส่งค่าว่าง = ล้างช่อง');

    const move = await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { brand: 'Beauterry' });
    assert.equal(move.status, 403);
    assert.equal(jobs.get(j.id).brand, 'Jdent');
    assert.equal((await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { brand: '' })).status, 400);
    assert.equal((await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { hired_on: '2026-02-30' })).status, 400);
    assert.equal((await call(2, 'PUT', `/hires/talents/${t.id}/jobs/${hidden.id}`, { fee: 1 })).status, 404, 'งานแบรนด์ที่แพรวไม่เห็น');
    assert.equal((await call(2, 'PUT', `/hires/talents/${other.id}/jobs/${j.id}`, { fee: 1 })).status, 404, 'งานของคนอื่น');
    assert.equal((await call(2, 'PUT', `/hires/talents/${t.id}/jobs/999`, { fee: 1 })).status, 404);
    assert.equal((await call(3, 'PUT', `/hires/talents/${t.id}/jobs/${j.id}`, { fee: 1 })).status, 403);
    assert.equal(jobs.get(j.id).fee, null);
    const admin = await call(1, 'PUT', `/hires/talents/${t.id}/jobs/${hidden.id}`, { brand: 'Jdent' });
    assert.equal(admin.status, 200);
});

test('ลบงาน: คนอื่นไม่ได้ · มองไม่เห็นไม่ได้ · ลบแล้วบันทึกประวัติ · ลบคนออกจาก Talent Book งานหายตาม', async () => {
    const t = await addTalent();
    const j = (await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Jdent', hired_on: '2026-10' })).body.data;
    const hidden = (await call(1, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Beauterry', hired_on: '2026-10' })).body.data;
    assert.equal((await call(3, 'DELETE', `/hires/talents/${t.id}/jobs/${j.id}`)).status, 403);
    assert.equal((await call(2, 'DELETE', `/hires/talents/${t.id}/jobs/${hidden.id}`)).status, 404);
    const del = await call(2, 'DELETE', `/hires/talents/${t.id}/jobs/${j.id}`);
    assert.equal(del.status, 200);
    assert.deepEqual(del.body.data, { id: j.id });
    assert.equal(jobs.has(j.id), false);
    assert.equal(logged.at(-1).summary, 'Talent Book: ลบงานที่จ้าง "ต้น" — Jdent (ต.ค. 2026)');
    assert.equal(logged.at(-1).action, 'delete');
    assert.equal((await call(2, 'DELETE', `/hires/talents/${t.id}/jobs/${j.id}`)).status, 404);
    assert.equal((await call(1, 'DELETE', `/hires/talents/${t.id}`)).status, 200);
    assert.equal(jobs.size, 0);
});

test('การ์ด Talent Book: talent.jobs_count นับเฉพาะงานที่คนดูเห็น · แบรนด์ของงานเข้าตัวกรอง Brand', async () => {
    const t = await addTalent();
    await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Jdent', hired_on: '2026-10' });
    await call(2, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Jdent', hired_on: '2026-09' });
    await call(1, 'POST', `/hires/talents/${t.id}/jobs`, { brand: 'Dermiq', hired_on: '2026-09' });
    const cardOf = async uid => (await call(uid, 'GET', '/hires/book')).body.data.cards.find(c => c.name === 'ต้น');
    const admin = await cardOf(1);
    assert.equal(admin.talent.jobs_count, 3);
    assert.deepEqual([...admin.brands].sort(), ['Dermiq', 'Jdent']);
    assert.equal((await cardOf(2)).talent.jobs_count, 2);
    const fon = await cardOf(3);
    assert.equal(fon.talent.jobs_count, 0, 'ฝนไม่มีสิทธิ์ทั้ง Jdent และ Dermiq');
    assert.deepEqual(fon.brands, ['Jdent'], 'เห็นแค่แบรนด์ที่ทีมติดไว้บนการ์ด ไม่เห็นแบรนด์ของงาน');
    const book = (await call(1, 'GET', '/hires/book')).body.data;
    assert.ok(book.brands.includes('Dermiq'));
    // การ์ดที่มาจากงานอย่างเดียวไม่มี talent
    assert.equal(book.cards.find(c => c.key === 'มะลิ|นางแบบ').talent, null);
});

// ================================================================ ช่องทาง Social
test('ช่องทาง Social: บันทึกหลายช่อง (วางลิงก์ = รู้แพลตฟอร์ม/ชื่อเอง) · link = ลิงก์ช่องทางแรก · ขึ้นบนการ์ด', async () => {
    const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', auto_image: false, socials: [
        { platform: '', url: 'https://www.instagram.com/aom.chr/?igsh=x' },
        { platform: 'TikTok', handle: '@aom_chr' },
        { platform: 'อื่น ๆ', handle: 'LINE OA: @aom' },
        { platform: 'TikTok', handle: '', url: '' }
    ] });
    assert.equal(r.status, 201);
    const want = [
        { platform: 'Instagram', handle: 'aom.chr', url: 'https://www.instagram.com/aom.chr' },
        { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' },
        { platform: 'อื่น ๆ', handle: 'LINE OA: @aom', url: '' }
    ];
    assert.deepEqual(r.body.data.socials, want);
    assert.equal(r.body.data.link, 'https://www.instagram.com/aom.chr');
    assert.deepEqual(rows.get(r.body.data.id).socials, want, 'เก็บแบบมาตรฐานลงฐาน');
    assert.equal(rows.get(r.body.data.id).link, 'https://www.instagram.com/aom.chr', 'โค้ดเก่าที่อ่าน link ยังใช้ได้');
    assert.deepEqual(r.body.image_fetch, { status: 'none' }, 'auto_image: false = ไม่ดึงรูป');
    assert.equal(outCalls.length, 0);
    const card = (await call(3, 'GET', '/hires/book')).body.data.cards.find(c => c.name === 'ออม');
    assert.deepEqual(card.socials, want);
    assert.equal(card.link, 'https://www.instagram.com/aom.chr');

    const up = await call(2, 'PUT', `/hires/talents/${r.body.data.id}`, { socials: [{ platform: 'X', handle: 'aom' }] });
    assert.deepEqual(up.body.data.socials, [{ platform: 'X', handle: 'aom', url: 'https://x.com/aom' }]);
    assert.equal(rows.get(r.body.data.id).link, 'https://x.com/aom');
    const none = await call(2, 'PUT', `/hires/talents/${r.body.data.id}`, { socials: [] });
    assert.deepEqual(none.body.data.socials, []);
    assert.equal(rows.get(r.body.data.id).link, null, 'ล้างช่องทางหมด = link ว่างด้วย');
});

test('ช่องทาง Social: ค่าผิด → 400 ภาษาไทย ไม่บันทึก', async () => {
    const bad = async (socials, re) => {
        const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', socials });
        assert.equal(r.status, 400, JSON.stringify(socials));
        assert.match(r.body.message, re);
    };
    await bad('https://tiktok.com/@a', /ช่องทาง Social ไม่ถูกต้อง/);
    await bad([{ platform: 'MySpace', url: 'https://myspace.com/a' }], /แพลตฟอร์มไม่ถูกต้อง/);
    await bad([{ platform: 'TikTok', url: 'javascript:alert(1)' }], /ต้องขึ้นต้นด้วย http/);
    await bad(Array.from({ length: 11 }, (_, i) => ({ platform: 'X', handle: 'h' + i })), /ไม่เกิน 10 ช่องทาง/);
    assert.equal(rows.size, 0);
});

test('แถวเก่า / ฟอร์มรุ่นก่อน (ส่งแค่ link): ช่องทางไม่หาย · แก้ link = ช่องทางเปลี่ยนตาม · ไม่แตะ link = ช่องทางคงเดิม', async () => {
    // ฟอร์มรุ่นก่อนเพิ่มคน → แปลง link เป็นช่องทาง
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ใบเตย', kind: 'ช่างแต่งหน้า', link: ' https://instagram.com/baitoey ' })).body.data;
    assert.deepEqual(a.socials, [{ platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' }]);
    assert.equal(a.link, 'https://instagram.com/baitoey', 'link เดิมเก็บตามที่พิมพ์');
    // แถวในฐานที่ยังไม่มี socials (ก่อน 1 ต.ค.) — อ่านแล้วได้ช่องทางจาก link
    rows.get(a.id).socials = [];
    const detail = (await call(3, 'GET', `/hires/talents/${a.id}`)).body.data;
    assert.deepEqual(detail.socials, [{ platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' }]);
    delete rows.get(a.id).socials;   // คอลัมน์ยังไม่มี (โค้ดขึ้นก่อน setup-db) ก็อ่านได้
    assert.deepEqual((await call(3, 'GET', '/hires/book')).body.data.cards.find(c => c.name === 'ใบเตย').socials, detail.socials);

    // บันทึกหลายช่องด้วยฟอร์มใหม่ แล้วฟอร์มรุ่นก่อนแก้ช่องอื่น (ส่ง link เดิมกลับมา) → ช่องทางคงเดิม
    const two = [{ platform: 'TikTok', handle: 'tey', url: '' }, { platform: 'X', handle: 'tey', url: '' }];
    const saved = (await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: two })).body.data;
    assert.equal(saved.socials.length, 2);
    const keep = await call(2, 'PUT', `/hires/talents/${a.id}`, { link: saved.link, note: 'x' });
    assert.equal(keep.body.data.socials.length, 2, 'ไม่แตะ link = ช่องทางคงเดิม');
    // ฟอร์มรุ่นก่อนเปลี่ยน Account → ช่องทางเปลี่ยนตาม (ไม่ค้างของเก่าที่ไม่ตรงกับ link)
    const changed = await call(2, 'PUT', `/hires/talents/${a.id}`, { link: 'https://www.youtube.com/@tey' });
    assert.deepEqual(changed.body.data.socials, [{ platform: 'YouTube', handle: 'tey', url: 'https://www.youtube.com/@tey' }]);
    // ข้อความที่ไม่ใช่ลิงก์ = ช่อง "อื่น ๆ" (ไม่หาย)
    const text = await call(2, 'PUT', `/hires/talents/${a.id}`, { link: 'IG @baitoey' });
    assert.deepEqual(text.body.data.socials, [{ platform: 'อื่น ๆ', handle: 'IG @baitoey', url: '' }]);
});

test('แถวเก่า: ข้อความ Account ยาวเกิน 100 ตัว / หลายบรรทัด — เปิดฟอร์ม (GET → แถวในฟอร์ม → socials ที่ส่ง) แก้แค่ช่องอื่น link ต้องครบทุกตัวอักษร', async () => {
    const { pathToFileURL } = require('node:url');
    const c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/talentSocials.js')).href);
    // ทำแบบเดียวกับ TalentForm: โหลด → แถวในฟอร์ม (socialRowsOf) → กดบันทึก (socialsForSave + link = linkFromSocials)
    const formSave = async (id, extra) => {
        const t = (await call(2, 'GET', `/hires/talents/${id}`)).body.data;
        const formRows = c.socialRowsOf(c.normalizeSocials(t.socials, t.link));
        formRows.forEach(r => assert.equal(c.socialRowError(r), '', 'ฟอร์มไม่ฟ้อง error: ' + r.handle.slice(0, 40)));
        const socials = c.socialsForSave(formRows);
        return call(2, 'PUT', `/hires/talents/${id}`, { socials, link: c.linkFromSocials(socials) || '', ...extra });
    };
    const LONG = 'IG: daokao_official / TikTok: @daokao.th / FB: Dao Kao Official Page / LINE: @daokao / โทร 081-234-5678 ติดต่อผ่านพี่นก';
    assert.ok(LONG.length > 100);
    const a = await addTalent({ name: 'ดาวเก่า' });
    Object.assign(rows.get(a.id), { link: LONG, socials: [] });   // แถวในฐานก่อน 1 ต.ค.: มีแค่ link
    const r1 = await formSave(a.id, { rate: 9000 });
    assert.equal(r1.status, 200);
    assert.equal(rows.get(a.id).link, LONG, 'link เดิมครบทุกตัวอักษร');
    assert.equal(rows.get(a.id).rate, 9000);
    assert.deepEqual(r1.body.data.socials, [{ platform: 'อื่น ๆ', handle: LONG, url: '' }], 'โชว์ข้อความเต็ม ไม่ถูกตัด');
    await formSave(a.id, { rate: 9500 });   // รอบสอง (socials ถูกเขียนลงฐานแล้ว) ก็ยังครบ
    assert.equal(rows.get(a.id).link, LONG);

    // หลายบรรทัด + ช่องว่างซ้อน (ตั้งผ่าน API แบบฟอร์มรุ่นก่อน — ช่อง Account)
    const MULTI = 'https://www.tiktok.com/@dao_tt\nhttps://www.instagram.com/dao.ig\nผู้จัดการ: พี่นก  081-234-5678';
    const b = await addTalent({ name: 'ดาวหลายบรรทัด' });
    assert.equal((await call(2, 'PUT', `/hires/talents/${b.id}`, { link: MULTI })).status, 200);
    assert.equal(rows.get(b.id).link, MULTI);
    rows.get(b.id).socials = [];
    await formSave(b.id, { rate: 1000 });
    assert.equal(rows.get(b.id).link, MULTI, 'บรรทัด / ช่องว่างซ้อนไม่หาย');
    await formSave(b.id, { note: 'แก้หมายเหตุ' });
    assert.equal(rows.get(b.id).link, MULTI);
    assert.equal(rows.get(b.id).note, 'แก้หมายเหตุ');
    // ตาข่ายฝั่ง server: ช่องทางที่ส่งมาเหมือนที่บันทึกไว้ = ไม่เขียน link ใหม่ (link เดิมแบบไม่มี www. ก็ไม่ถูกจัดรูปทับ)
    const g = await addTalent({ name: 'ลิงก์เก่า' });
    Object.assign(rows.get(g.id), { link: 'http://instagram.com/baitoey/?igsh=abc', socials: [] });
    await formSave(g.id, { rate: 3000 });
    assert.equal(rows.get(g.id).link, 'http://instagram.com/baitoey/?igsh=abc', 'link เดิมไม่ถูกเขียนทับ');
    assert.deepEqual(rows.get(g.id).socials, [{ platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' }]);
    // แก้ช่องทางจริง → link ตามช่องทางใหม่
    await call(2, 'PUT', `/hires/talents/${g.id}`, { socials: [{ platform: 'Instagram', handle: 'baitoey.new' }] });
    assert.equal(rows.get(g.id).link, 'https://www.instagram.com/baitoey.new');

    // ผู้ใช้แก้ข้อความเอง: ยาวเกิน 100 ได้ (ไม่ถูกตัด) link เปลี่ยนตาม · "อื่น ๆ" เกิน 1000 / ช่องทางอื่นเกิน 100 = 400
    const EDITED = LONG + ' (อัปเดต ต.ค. 2026)';
    assert.equal((await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'อื่น ๆ', handle: EDITED, url: '' }] })).status, 200);
    assert.equal(rows.get(a.id).link, EDITED);
    const tooLong = await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'อื่น ๆ', handle: 'x'.repeat(1001), url: '' }] });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.message, /ชื่อช่องยาวเกิน 1000/);
    const ttLong = await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'TikTok', handle: 'x'.repeat(101), url: '' }] });
    assert.equal(ttLong.status, 400);
    assert.match(ttLong.body.message, /ชื่อช่องยาวเกิน 100/);
    assert.equal(rows.get(a.id).link, EDITED, 'ค่าผิดไม่บันทึก');
});

// ================================================================ รูปจากลิงก์
test('เพิ่มคนที่มีลิงก์ TikTok แต่ไม่มีรูป → บันทึกก่อน แล้วดึงรูปโปรไฟล์มาเก็บเป็นรูปการ์ด (ที่เดียวกับรูปที่อัป)', async () => {
    fakeTikTok();
    const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ',
        socials: [{ platform: '', url: 'https://www.tiktok.com/@aom_chr?lang=th' }] });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.image_fetch, { status: 'done', platform: 'TikTok' });
    const img = r.body.data.image;
    assert.equal(img.source, 'auto');
    assert.equal(img.from, 'https://www.tiktok.com/@aom_chr');
    assert.equal(img.original, 'TikTok-aom_chr.jpg');
    assert.deepEqual(outCalls, ['https://www.tiktok.com/@aom_chr', ttImg('aom_chr')], 'ยิงแค่หน้าโปรไฟล์ + รูปบน CDN');
    const files = uploadsNow();
    assert.equal(files.length, 1);
    assert.match(files[0], new RegExp(`^talent_${r.body.data.id}_\\d+[0-9a-f]{6}\\.jpg$`));
    assert.equal('filename' in img, false, 'ไม่ส่งชื่อไฟล์ในเครื่องออกไป');
    // การ์ดใช้รูปนี้ และเปิดไฟล์ได้
    const card = (await call(3, 'GET', '/hires/book')).body.data.cards.find(c => c.name === 'ออม');
    assert.equal(card.photo.type, 'image');
    assert.match(card.photo.path, new RegExp(`^/hires/talents/${r.body.data.id}/image\\?v=\\d+$`));
    const view = await realFetch(`${base}/api${card.photo.path}`, { headers: { Authorization: `Bearer ${tokenOf(3)}` } });
    assert.equal(view.status, 200);
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), JPEG);
    await tick();
    assert.ok(logged.some(l => l.summary === 'Talent Book: ดึงรูปโปรไฟล์จาก TikTok ของ "ออม"'));
});

test('ดึงรูปไม่สำเร็จ ไม่ขวางการบันทึก · Instagram / Facebook บอกให้วาง/อัปรูปเอง · ปิดดึงเองได้ (auto_image: false)', async () => {
    fakeTikTok({ fail: true });
    const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', socials: [{ platform: 'TikTok', handle: 'aom_fail' }] });
    assert.equal(r.status, 201, 'บันทึกสำเร็จ');
    assert.ok(rows.has(r.body.data.id));
    assert.equal(r.body.image_fetch.status, 'failed');
    assert.equal(r.body.image_fetch.platform, 'TikTok');
    assert.match(r.body.image_fetch.message, /ดึงรูปจาก TikTok ไม่สำเร็จ .*Ctrl\+V/);
    assert.equal(r.body.data.image, null);
    assert.deepEqual(uploadsNow(), []);

    outCalls.length = 0;
    const ig = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'เตย', kind: 'นางแบบ', socials: [{ platform: 'Instagram', handle: 'tey' }] });
    assert.equal(ig.status, 201);
    assert.equal(ig.body.image_fetch.status, 'none');
    assert.equal(ig.body.image_fetch.platform, 'Instagram');
    assert.match(ig.body.image_fetch.message, /ดึงรูปจาก Instagram อัตโนมัติไม่ได้ — ก๊อปรูปแล้วกด Ctrl\+V/);
    const off = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ฟ้า', kind: 'นางแบบ', auto_image: false, socials: [{ platform: 'TikTok', handle: 'fah' }] });
    assert.deepEqual(off.body.image_fetch, { status: 'none' });
    const noLink = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ดาว', kind: 'นางแบบ' });
    assert.deepEqual(noLink.body.image_fetch, { status: 'none' });
    assert.deepEqual(outCalls, [], 'ไม่ยิงเว็บภายนอกเลย');
});

test('แก้ข้อมูล: ห้ามทับรูปที่ผู้ใช้อัปเอง · รูปที่ดึงไว้แล้วไม่ดึงซ้ำ · เปลี่ยนช่อง TikTok = ดึงรูปใหม่ ลบรูปเก่า', async () => {
    fakeTikTok();
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', socials: [{ platform: 'TikTok', handle: 'aom_chr' }] })).body.data;
    const first = uploadsNow();
    assert.equal(first.length, 1);
    outCalls.length = 0;
    const same = await call(2, 'PUT', `/hires/talents/${a.id}`, { note: 'แก้หมายเหตุ' });
    assert.deepEqual(same.body.image_fetch, { status: 'none' });
    assert.deepEqual(outCalls, [], 'ช่องทางเดิม = ไม่ดึงซ้ำ');

    const moved = await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'TikTok', handle: 'aom_new' }] });
    assert.deepEqual(moved.body.image_fetch, { status: 'done', platform: 'TikTok' });
    assert.equal(moved.body.data.image.from, 'https://www.tiktok.com/@aom_new');
    await tick();
    const second = uploadsNow();
    assert.equal(second.length, 1, 'รูปเก่าที่ดึงไว้ถูกลบ');
    assert.notDeepEqual(second, first);

    // ผู้ใช้อัปรูปเอง → บันทึก/เปลี่ยนช่องทางอีกกี่ครั้งก็ไม่ทับ
    const mine = await upload(2, `/hires/talents/${a.id}/image`, 'ของฉัน.png', PNG, 'image/png');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.image.source, 'upload');
    outCalls.length = 0;
    const again = await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'TikTok', handle: 'aom_third' }] });
    assert.deepEqual(again.body.image_fetch, { status: 'none' });
    assert.deepEqual(outCalls, []);
    assert.equal(rows.get(a.id).image.original, 'ของฉัน.png');
});

test('ปุ่ม "ดึงรูปจากลิงก์": เฉพาะคนที่แก้การ์ดได้ · กดเอง = แทนรูปที่อัปไว้ได้ · ใช้ลิงก์ที่ส่งมาได้ · ดึงไม่ได้ = 422 พร้อมวิธีแก้', async () => {
    fakeTikTok();
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', auto_image: false,
        socials: [{ platform: 'Instagram', handle: 'aom' }, { platform: 'TikTok', handle: 'aom_chr' }] })).body.data;
    await upload(2, `/hires/talents/${a.id}/image`, 'mine.png', PNG, 'image/png');
    const userFile = rows.get(a.id).image.filename;

    assert.equal((await call(3, 'POST', `/hires/talents/${a.id}/fetch-image`)).status, 403);
    assert.equal((await call(2, 'POST', '/hires/talents/999/fetch-image')).status, 404);
    outCalls.length = 0;
    const r = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.image_fetch, { status: 'done', platform: 'TikTok' });
    assert.equal(r.body.data.image.source, 'auto', 'ช่อง Instagram ข้ามไป ใช้ช่อง TikTok');
    assert.deepEqual(outCalls, ['https://www.tiktok.com/@aom_chr', ttImg('aom_chr')]);
    await tick();
    assert.ok(!uploadsNow().includes(userFile), 'รูปที่อัปไว้ถูกแทน (ผู้ใช้กดเอง)');

    // ลิงก์ที่เพิ่งพิมพ์ในฟอร์ม (ยังไม่บันทึก)
    const typed = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`, { url: 'https://www.tiktok.com/@someone_else/video/1' });
    assert.equal(typed.status, 200);
    assert.equal(typed.body.data.image.from, 'https://www.tiktok.com/@someone_else');
    const ig = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`, { url: 'https://www.instagram.com/aom' });
    assert.equal(ig.status, 422);
    assert.match(ig.body.message, /ดึงรูปจาก Instagram อัตโนมัติไม่ได้/);
    const short = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`, { url: 'https://vt.tiktok.com/ZS1/' });
    assert.equal(short.status, 422);
    assert.match(short.body.message, /ไม่ใช่หน้าช่อง/);
    const notLink = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`, { url: 'aom_chr' });
    assert.equal(notLink.status, 400);
    const evil = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`, { url: 'https://169.254.169.254/latest' });
    assert.equal(evil.status, 422);
    assert.ok(!outCalls.some(u => u.includes('169.254')), 'ไม่ยิงไปเครื่องอื่น');

    // ไม่มีช่องทางเลย / มีแต่ Facebook
    const b = await addTalent({ name: 'ไม่มีลิงก์' });
    const none = await call(2, 'POST', `/hires/talents/${b.id}/fetch-image`);
    assert.equal(none.status, 422);
    assert.match(none.body.message, /ยังไม่มีลิงก์ TikTok \/ YouTube \/ X/);
    const fb = await addTalent({ name: 'เฟซ', socials: [{ platform: 'Facebook', handle: 'page.a' }] });
    const fbr = await call(2, 'POST', `/hires/talents/${fb.id}/fetch-image`);
    assert.equal(fbr.status, 422);
    assert.match(fbr.body.message, /Facebook อัตโนมัติไม่ได้/);

    // TikTok ไม่ให้ดึง → 422 รูปเดิมอยู่ครบ
    fakeTikTok({ fail: true });
    const before = rows.get(a.id).image.filename;
    const failed = await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`);
    assert.equal(failed.status, 422);
    assert.match(failed.body.message, /ดึงรูปจาก TikTok ไม่สำเร็จ/);
    assert.equal(rows.get(a.id).image.filename, before);
});

test('ลิงก์คลิป YouTube / Shorts / โพสต์ X / เพลง TikTok ไม่ถูกเอารูปปกคลิปมาเป็นรูปการ์ด — บอกให้ใส่ลิงก์หน้าช่อง · พิมพ์ชื่อช่องไว้ = ใช้หน้าช่องจากชื่อ', async () => {
    const YT_IMG = 'https://yt3.googleusercontent.com/aom=s900-c-k';
    outbound = async u => {
        if (u === 'https://www.youtube.com/@aom') return new Response(`<meta property="og:image" content="${YT_IMG}">`, { status: 200, headers: { 'content-type': 'text/html' } });
        if (u === YT_IMG) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
        // หน้าคลิปจริงมี og:image = รูปปกคลิปบน i.ytimg.com (ผ่านด่านโดเมน CDN) — ต้องไม่ถูกเรียกเลย
        if (/^https:\/\/www\.youtube\.com\/(watch|shorts)/.test(u)) {
            return new Response('<meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg">', { status: 200, headers: { 'content-type': 'text/html' } });
        }
        if (u.startsWith('https://i.ytimg.com/')) return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        throw new TypeError('ไม่มีในข้อมูลจำลอง: ' + u);
    };
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const a = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', socials: [{ platform: '', url: watch }] });
    assert.equal(a.status, 201);
    assert.equal(a.body.data.image, null, 'ไม่มีรูปปกคลิปบนการ์ด');
    assert.equal(a.body.image_fetch.status, 'none');
    assert.equal(a.body.image_fetch.platform, 'YouTube');
    assert.match(a.body.image_fetch.message, /ไม่ใช่หน้าช่อง[\s\S]*Ctrl\+V/, 'บอกให้ใส่ลิงก์หน้าช่อง หรือวางรูปเอง');
    // ปุ่มดึงรูปกับลิงก์ที่ไม่ใช่หน้าช่อง = 422 not-profile (ไม่ยิงออกไปเลย)
    for (const url of [watch, 'https://www.youtube.com/shorts/abc123', 'https://www.youtube.com/playlist?list=PL1', 'https://x.com/i/status/123',
        'https://www.tiktok.com/music/song-7300000000000000000', 'https://www.tiktok.com/tag/skincare']) {
        const r = await call(2, 'POST', `/hires/talents/${a.body.data.id}/fetch-image`, { url });
        assert.equal(r.status, 422, url);
        assert.equal(r.body.data.code, 'not-profile', url);
    }
    // ไม่ส่งลิงก์ = ใช้ช่องทางที่บันทึกไว้ (ลิงก์คลิปอย่างเดียว) → 422 not-profile
    const saved = await call(2, 'POST', `/hires/talents/${a.body.data.id}/fetch-image`);
    assert.equal(saved.status, 422);
    assert.equal(saved.body.data.code, 'not-profile');
    assert.deepEqual(outCalls, [], 'ไม่ยิงไปหน้าคลิปเลย');
    assert.equal(rows.get(a.body.data.id).image, null);
    // พิมพ์ชื่อช่องไว้ แต่วางลิงก์คลิป → ดึงจากหน้าช่อง @aom
    const b = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออมยูทูบ', kind: 'นางแบบ', socials: [{ platform: 'YouTube', handle: 'aom', url: watch }] });
    assert.deepEqual(b.body.image_fetch, { status: 'done', platform: 'YouTube' });
    assert.equal(b.body.data.image.from, 'https://www.youtube.com/@aom');
    assert.deepEqual(outCalls, ['https://www.youtube.com/@aom', YT_IMG]);
});

test('เอารูปที่ดึงอัตโนมัติออกเองแล้วแก้ช่องอื่น → รูปไม่กลับมาเอง · เปลี่ยนลิงก์ / กดปุ่มเอง = ดึงได้ · แถวเก่าบันทึกด้วยฟอร์มใหม่ครั้งแรก = ดึงให้', async () => {
    fakeTikTok();
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', socials: [{ platform: 'TikTok', handle: 'aom_rm' }] })).body.data;
    assert.equal(a.image.source, 'auto');
    // ฟอร์ม: กด × ที่รูปแล้วบันทึก = PUT (auto_image: false) + DELETE /image
    assert.deepEqual((await call(2, 'PUT', `/hires/talents/${a.id}`, { note: 'ไม่เอารูปนี้', auto_image: false })).body.image_fetch, { status: 'none' });
    assert.equal((await call(2, 'DELETE', `/hires/talents/${a.id}/image`)).status, 200);
    assert.equal(rows.get(a.id).image, null);
    outCalls.length = 0;
    const r = await call(2, 'PUT', `/hires/talents/${a.id}`, { rate: 5000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.image_fetch, { status: 'none' });
    assert.equal(r.body.data.image, null, 'รูปที่เอาออกไม่กลับมาเอง');
    // ฟอร์มส่งช่องทางชุดเดิมกลับมา (ไม่ได้แก้ลิงก์) ก็ไม่ดึง
    const same = await call(2, 'PUT', `/hires/talents/${a.id}`, {
        socials: [{ platform: 'TikTok', handle: 'aom_rm', url: 'https://www.tiktok.com/@aom_rm' }], link: 'https://www.tiktok.com/@aom_rm', rate: 5500 });
    assert.deepEqual(same.body.image_fetch, { status: 'none' });
    assert.deepEqual(outCalls, [], 'ไม่ยิงเว็บภายนอก');
    assert.equal(rows.get(a.id).image, null);
    // เปลี่ยนลิงก์ = ดึงรูปของลิงก์ใหม่ · กดปุ่มเอง = ดึงได้เสมอ
    const moved = await call(2, 'PUT', `/hires/talents/${a.id}`, { socials: [{ platform: 'TikTok', handle: 'aom_new' }] });
    assert.deepEqual(moved.body.image_fetch, { status: 'done', platform: 'TikTok' });
    await call(2, 'DELETE', `/hires/talents/${a.id}/image`);
    assert.equal((await call(2, 'POST', `/hires/talents/${a.id}/fetch-image`)).status, 200);
    assert.equal(rows.get(a.id).image.source, 'auto');

    // แถวเก่า (มีแค่ link TikTok · ยังไม่เคยบันทึก socials · ไม่มีรูป): บันทึกด้วยฟอร์มใหม่ครั้งแรก = ช่องทางถูกบันทึกครั้งแรก → ดึงให้
    const b = await addTalent({ name: 'เก่าหนึ่ง', auto_image: false });
    Object.assign(rows.get(b.id), { socials: [], link: 'https://www.tiktok.com/@old_one', image: null });
    const first = await call(2, 'PUT', `/hires/talents/${b.id}`, {
        socials: [{ platform: 'TikTok', handle: 'old_one', url: 'https://www.tiktok.com/@old_one' }], link: 'https://www.tiktok.com/@old_one', rate: 1 });
    assert.deepEqual(first.body.image_fetch, { status: 'done', platform: 'TikTok' });
    // ฟอร์มรุ่นก่อน (ไม่ส่ง socials) แก้ช่องอื่นของแถวเก่า = ไม่ดึง
    const c = await addTalent({ name: 'เก่าสอง', auto_image: false });
    Object.assign(rows.get(c.id), { socials: [], link: 'https://www.tiktok.com/@old_two', image: null });
    outCalls.length = 0;
    assert.deepEqual((await call(2, 'PUT', `/hires/talents/${c.id}`, { note: 'x' })).body.image_fetch, { status: 'none' });
    assert.deepEqual(outCalls, []);
});

test('ลิงก์รูป (image_link) ที่ทีมวางไว้ไม่หายเมื่อระบบดึงรูปโปรไฟล์มาใส่การ์ด — การ์ด / รายละเอียดยังส่งลิงก์ให้เปิดได้', async () => {
    fakeTikTok();
    const link = 'https://drive.google.com/file/d/comp-aom/view';
    const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ออม', kind: 'นางแบบ', image_link: link,
        socials: [{ platform: 'TikTok', handle: 'aom_link' }] });
    assert.deepEqual(r.body.image_fetch, { status: 'done', platform: 'TikTok' });
    assert.equal(r.body.data.image_link, link);
    const card = (await call(3, 'GET', '/hires/book')).body.data.cards.find(x => x.name === 'ออม');
    assert.equal(card.photo.type, 'image', 'การ์ดโชว์รูปที่ดึงมา');
    assert.equal(card.image_link, link, 'ลิงก์รูปยังส่งไปให้หน้ารายละเอียดเปิดได้');
    assert.equal((await call(3, 'GET', `/hires/talents/${r.body.data.id}`)).body.data.image_link, link);
    await addTalent({ name: 'ไม่มีลิงก์รูป' });
    assert.equal((await call(3, 'GET', '/hires/book')).body.data.cards.find(x => x.name === 'ไม่มีลิงก์รูป').image_link, null);
});

test('ปุ่ม "ดึงรูปจากลิงก์" ดึงช้า แล้วผู้ใช้อัปรูปเองระหว่างนั้น → รูปที่อัปชนะ (ไม่ถูกทับ ไม่ถูกลบ) ตอบ 409', async () => {
    let open;
    const gate = new Promise(resolve => { open = resolve; });
    outbound = async u => {
        if (u === 'https://www.tiktok.com/@aom_slow') {
            await gate;
            return new Response(`<script>{"avatarLarger":"${ttImg('aom_slow').replace(/\//g, '\\u002F')}"}</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        if (u.startsWith('https://p16-common-sign.tiktokcdn.com/')) return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        throw new TypeError('ไม่มีในข้อมูลจำลอง: ' + u);
    };
    const a = await addTalent({ name: 'ออม', auto_image: false, socials: [{ platform: 'TikTok', handle: 'aom_slow' }] });
    const pressing = call(2, 'POST', `/hires/talents/${a.id}/fetch-image`);
    for (let i = 0; i < 200 && !outCalls.includes('https://www.tiktok.com/@aom_slow'); i++) await tick();
    assert.ok(outCalls.includes('https://www.tiktok.com/@aom_slow'), 'เริ่มดึงแล้ว');
    const up = await upload(2, `/hires/talents/${a.id}/image`, 'mine.png', PNG, 'image/png');
    assert.equal(up.status, 200);
    const mine = rows.get(a.id).image.filename;
    open();
    const r = await pressing;
    assert.equal(r.status, 409);
    assert.match(r.body.message, /ถูกเปลี่ยนระหว่างที่กำลังดึง/);
    assert.equal(rows.get(a.id).image.filename, mine, 'รูปที่อัปไม่ถูกทับ');
    assert.notEqual(rows.get(a.id).image.source, 'auto');
    await tick();
    assert.deepEqual(uploadsNow(), [mine], 'ไฟล์ที่ดึงมาถูกลบ · รูปที่อัปอยู่ครบ');
});

test('วางรูป (Ctrl+V): ไฟล์ไม่มีนามสกุล ("blob") ใช้ชนิดไฟล์แทน — PNG / JPG / WEBP เท่านั้น · ชื่อที่โชว์เติมนามสกุลให้', async () => {
    const a = await addTalent();
    const pasted = await upload(2, `/hires/talents/${a.id}/image`, 'blob', PNG, 'image/png');
    assert.equal(pasted.status, 200);
    assert.equal(pasted.body.data.image.original, 'blob.png');
    assert.equal(pasted.body.data.image.source, 'upload');
    assert.match(rows.get(a.id).image.filename, /^talent_\d+_\d+\.png$/);
    const jpg = await upload(2, `/hires/talents/${a.id}/image`, 'image', JPEG, 'image/jpeg');
    assert.equal(jpg.status, 200);
    assert.match(rows.get(a.id).image.filename, /\.jpg$/);
    // ชื่อที่ Chrome ตั้งให้ ("image.png") ผ่านทางนามสกุลตามเดิม
    assert.equal((await upload(2, `/hires/talents/${a.id}/image`, 'image.png', PNG, 'image/png')).status, 200);
    const before = uploadsNow();
    for (const [name, type] of [['blob', 'text/plain'], ['blob', 'image/gif'], ['blob', 'application/pdf'], ['x.exe', 'image/png'], ['blob', 'image/svg+xml']]) {
        const r = await upload(2, `/hires/talents/${a.id}/image`, name, PNG, type);
        assert.equal(r.status, 400, `${name} ${type}`);
        assert.match(r.body.message, /รองรับรูปภาพ/);
    }
    assert.deepEqual(uploadsNow(), before, 'ไฟล์ที่ไม่รับไม่ถูกเขียนลงเครื่อง');
    // ช่องคลิปไม่ใช้ชนิดไฟล์แทนนามสกุล
    assert.equal((await upload(2, `/hires/talents/${a.id}/clip`, 'blob', PNG, 'video/mp4')).status, 400);
    // คนไม่มีสิทธิ์วางไม่ได้
    assert.equal((await upload(3, `/hires/talents/${a.id}/image`, 'blob', PNG, 'image/png')).status, 403);
});

test('ทุกเส้นของคนหนึ่งคนตอบข้อมูลรูปเดียวกัน (POST / PUT / GET / อัปไฟล์ / เอาไฟล์ออก) — มี socials + jobs_count + jobs', async () => {
    const a = await addTalent();
    const KEYS = ['id', 'name', 'kind', 'link', 'brands', 'socials', 'contact_mode', 'contact_name', 'contact', 'agency', 'rate', 'rate_unit', 'scope',
        'image', 'image_link', 'clip', 'clip_link', 'note', 'added_by', 'created_at', 'updated_at', 'editable', 'jobs_count', 'jobs'].sort();
    assert.deepEqual(Object.keys(a).sort(), KEYS);
    assert.deepEqual(Object.keys((await call(2, 'PUT', `/hires/talents/${a.id}`, { note: 'x' })).body.data).sort(), KEYS);
    assert.deepEqual(Object.keys((await call(3, 'GET', `/hires/talents/${a.id}`)).body.data).sort(), KEYS);
    assert.deepEqual(Object.keys((await upload(2, `/hires/talents/${a.id}/image`, 'a.png', PNG, 'image/png')).body.data).sort(), KEYS);
    assert.deepEqual(Object.keys((await call(2, 'DELETE', `/hires/talents/${a.id}/image`)).body.data).sort(), KEYS);
    assert.deepEqual([a.jobs_count, a.jobs], [0, []]);
});

// ================================================================ ชั้นฐานข้อมูล (ไม่ต่อฐานจริง — จำลอง pool)
test('pg/talentJobs: SQL กรองแบรนด์ / เรียงใหม่สุดก่อน · ไม่มีสิทธิ์แบรนด์ไหนเลย = ไม่ถามฐาน · ยังไม่มีตาราง (42P01) = ว่าง', async () => {
    const talentJobs = REAL.jobs;
    const saved = pool.query;
    const seen = [];
    try {
        pool.query = async (text, params) => { seen.push({ text, params }); return { rows: [{ id: 1 }] }; };
        assert.deepEqual(await talentJobs.listByTalent(5, { scopeBrands: ['Jdent'] }), [{ id: 1 }]);
        assert.match(seen[0].text, /WHERE talent_id = \$1 AND brand = ANY\(\$2::text\[\]\) ORDER BY hired_on DESC, id DESC/);
        assert.deepEqual(seen[0].params, [5, ['Jdent']]);
        await talentJobs.listByTalent(5);
        assert.doesNotMatch(seen[1].text, /brand/);
        assert.deepEqual(await talentJobs.listByTalent(5, { scopeBrands: [] }), []);
        assert.deepEqual(await talentJobs.listByTalent('3000000000'), []);
        assert.equal(seen.length, 2, 'สองกรณีหลังไม่ถามฐาน');
        await talentJobs.update(5, 9, { fee: 1, talent_id: 99, created_by_id: 1 });
        assert.match(seen[2].text, /^UPDATE talent_jobs SET fee = \$1, updated_at = \$2 WHERE id = \$3 AND talent_id = \$4 RETURNING \*$/, 'แก้ talent_id / ผู้เพิ่มไม่ได้');
        await talentJobs.remove(5, 9);
        assert.match(seen[3].text, /DELETE FROM talent_jobs WHERE id = \$1 AND talent_id = \$2/);
        pool.query = async () => { const e = new Error('relation "talent_jobs" does not exist'); e.code = '42P01'; throw e; };
        assert.deepEqual(await talentJobs.listByTalent(5), []);
        await assert.rejects(() => talentJobs.findById(5, 1), /does not exist/, 'เส้นเพิ่ม/แก้ไม่กลืน error');
        // _snapshot: talent_jobs ยังไม่มี = ว่าง (การ์ดยังขึ้น)
        const snap = await realLoadSnapshot(['talent_jobs']);
        assert.deepEqual(snap.talent_jobs, []);
    } finally { pool.query = saved; }
});

test('pg/talents.setFile: keepUserFile ไม่ทับไฟล์ที่ผู้ใช้อัปเอง (เช็คในล็อกเดียวกัน) · รูปที่ดึงไว้ทับได้', async () => {
    const talents = { setFile: REAL.setFile };
    const savedConnect = pool.connect;
    let current = null;
    const sql = [];
    pool.connect = async () => ({
        query: async (text, params) => {
            sql.push(text);
            if (/^SELECT \* FROM talents WHERE id = \$1 FOR UPDATE$/.test(text)) return { rows: current ? [{ id: params[0], image: current }] : [] };
            if (/^UPDATE talents SET image = \$1/.test(text)) return { rows: [{ id: params[2], image: JSON.parse(params[0]) }] };
            return { rows: [] };
        },
        release: () => {}
    });
    try {
        const auto = { filename: 'talent_1_n.jpg', source: 'auto', from: 'https://www.tiktok.com/@a' };
        current = { filename: 'talent_1_mine.png', original: 'mine.png' };
        const kept = await talents.setFile(1, 'image', auto, { keepUserFile: true });
        assert.equal(kept.kept, true);
        assert.equal(kept.old, null);
        assert.ok(!sql.some(s => s.startsWith('UPDATE')), 'ไม่เขียนทับ');
        current = { filename: 'talent_1_old.jpg', source: 'auto' };
        const swapped = await talents.setFile(1, 'image', auto, { keepUserFile: true });
        assert.deepEqual(swapped.old, current);
        assert.deepEqual(swapped.row.image, auto);
        current = { filename: 'talent_1_mine.png' };
        assert.deepEqual((await talents.setFile(1, 'image', auto)).old, current, 'อัปเอง/กดเอง = แทนได้ตามเดิม');
        // stillWanted: งานดึงที่ช้ากว่า (ลิงก์ / รูปเปลี่ยนระหว่างดึง) — เช็คกับแถวที่ล็อกไว้ ไม่ผ่าน = ไม่เขียน
        current = { filename: 'talent_1_old.jpg', source: 'auto', from: 'https://www.tiktok.com/@old' };
        sql.length = 0;
        const seen = [];
        const stale = await talents.setFile(1, 'image', auto, { keepUserFile: true, stillWanted: cur => { seen.push(cur); return false; } });
        assert.deepEqual(stale, { row: { id: 1, image: current }, old: null, kept: true, stale: true });
        assert.deepEqual(seen, [{ id: 1, image: current }], 'ได้แถวที่ล็อกไว้ (FOR UPDATE) ไปตัดสิน');
        assert.ok(sql.some(s => / FOR UPDATE$/.test(s)) && !sql.some(s => s.startsWith('UPDATE')), 'ไม่เขียนทับ');
        const ok = await talents.setFile(1, 'image', auto, { keepUserFile: true, stillWanted: () => true });
        assert.deepEqual(ok.row.image, auto);
        assert.deepEqual(ok.old, current);
        current = { filename: 'talent_1_mine.png' };
        const mineKept = await talents.setFile(1, 'image', auto, { keepUserFile: true, stillWanted: () => true });
        assert.equal(mineKept.kept, true);
        assert.equal(mineKept.stale, undefined, 'รูปที่ผู้ใช้อัปเอง = kept (เช็คก่อน)');
        current = null;
        assert.equal(await talents.setFile(1, 'image', auto, { keepUserFile: true }), null);
    } finally { pool.connect = savedConnect; }
});

test('ด่านความพร้อมของ production ไม่บังคับตาราง talent_jobs (โค้ดขึ้นก่อน setup-db ทั้งเว็บต้องไม่ล่ม)', async () => {
    const saved = pool.query;
    let asked = null;
    pool.query = async q => { asked = q.values[0]; return { rows: [] }; };
    try {
        const { checkDatabase } = require(path.join(SRC, 'services/readiness'));
        await checkDatabase();
        assert.ok(asked.includes('projects'));
        assert.equal(asked.includes('talent_jobs'), false);
        assert.equal(asked.includes('talents'), false);
    } finally { pool.query = saved; }
});

test('schema.sql: คอลัมน์ socials + ตาราง talent_jobs แบบรันซ้ำได้ (IF NOT EXISTS) ตามสัญญา', () => {
    const sql = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    assert.match(sql, /ALTER TABLE talents ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '\[\]'::jsonb;/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS talent_jobs \(/);
    assert.match(sql, /talent_id\s+INTEGER NOT NULL REFERENCES talents\(id\) ON DELETE CASCADE/);
    assert.match(sql, /hired_on\s+DATE NOT NULL/);
    assert.match(sql, /fee\s+NUMERIC\(18,2\),/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_talent_jobs_talent ON talent_jobs\(talent_id\);/);
    // talent_jobs ต้องมาหลัง talents (REFERENCES)
    assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS talent_jobs') > sql.indexOf('CREATE TABLE IF NOT EXISTS talents'));
});
