const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Talent: "Scope of Work" ในใบขอให้หา + ผู้ดูแลงานบังคับใส่ (ฝั่ง server)
// · scope เก็บในแถวใบขอให้หา (projects.hire_items) — แถวคนเป็น null เสมอ · ฟอร์มที่ไม่ส่งช่องนี้มาต้องไม่ล้างของเดิม
// · ผู้ดูแลงาน (creator) ต้องมีตอนสร้างงาน Talent และล้างทิ้งทีหลังไม่ได้ — แคมเปญ KOL ไม่เกี่ยว
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-scope-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-scope-owner test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// snapshot จำลอง — ต้องสลับก่อนโหลด store เพราะ pg/hires หยิบ loadSnapshot ออกไปตอน require
const FIXTURE = { other_projects: [], user_names: [] };
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};

const logic = require(path.join(SRC, 'store/logic'));
const store = require(path.join(SRC, 'store'));
const { hires: pgHires } = require(path.join(SRC, 'store/pg/hires'));
const realTasks = pgHires.tasks;
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let server, base, account;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    store.users.findById = async () => account;
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

function user(fields = {}) {
    account = { id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active', ...fields };
}
function send(method, url, body, token = adminToken) {
    return fetch(`${base}${url}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}
const NEED_OWNER = { status: 'error', message: 'เลือกผู้ดูแลงาน' };
const SCOPE = 'ถ่ายภาพนิ่ง 20 ลุค + วิดีโอสั้น 3 ตัว · ใช้งานออนไลน์ 6 เดือน';

// ---------------------------------------------------------------- ตรรกะล้วน

test('newHireRow: a casting request keeps its Scope of Work (trimmed, clipped at 2000); a person never has one', () => {
    const casting = body => logic.newHireRow({ mode: 'casting', kind: 'นางแบบ', headcount: 2, ...body }, { userId: 3 }).item;
    assert.equal(casting({ scope: `  ${SCOPE}  ` }).scope, SCOPE);
    assert.equal(casting({ scope: 'ก'.repeat(2500) }).scope, 'ก'.repeat(2000), 'ยาวเกินถูกตัดที่ 2000 ตัวอักษร');
    assert.equal(logic.HIRE_SCOPE_MAX, 2000);
    // ไม่ส่ง / ว่าง / object ที่ปลอมมา = null (ไม่ใช่ "[object Object]")
    for (const scope of [undefined, null, '', '   ', { x: 1 }, ['a']]) {
        assert.equal(casting({ scope }).scope, null, JSON.stringify(scope));
    }
    // สเปคยังแยกช่องเดิม — scope ไม่ไปทับ
    const both = casting({ spec: 'หญิง 20-25', scope: SCOPE });
    assert.equal(both.spec, 'หญิง 20-25');
    assert.equal(both.scope, SCOPE);

    // มีคนแล้ว: ส่ง scope มาก็ไม่เก็บ
    const direct = logic.newHireRow({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', scope: SCOPE }, {}).item;
    assert.equal(direct.scope, null);
});

test('mergeHireItems keeps a request\'s Scope of Work when the form does not send it, and updates / clears it when it does', () => {
    const at = '2026-09-21T03:00:00.000Z';
    const current = [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 2, filled: 0, candidates: [], scope: SCOPE, spec: 'หญิง' },
        { key: 'r2', mode: 'casting', kind: 'ช่างภาพ', fee: 0, headcount: 1, filled: 1,
          candidates: [{ key: 'c1', name: 'ต้น', status: 'เลือกแล้ว' }], scope: 'ถ่าย 1 วัน' },
        { key: 'h1', mode: 'direct', kind: 'พิธีกร', name: 'ชบา', fee: 3000, status: 'ตกลงแล้ว' }
    ];
    const merge = incoming => Object.fromEntries(logic.mergeHireItems(current, incoming, { userId: 3, at }).map(it => [it.key, it]));
    // ฟอร์มรุ่นเก่า / แท็บที่เปิดค้าง: ไม่มีช่อง scope ในแถวเลย → คงของเดิม
    const withoutScope = current.map(({ scope, ...rest }) => rest);
    let out = merge(withoutScope);
    assert.equal(out.r1.scope, SCOPE);
    assert.equal(out.r2.scope, 'ถ่าย 1 วัน');
    assert.equal(out.h1.scope, null, 'แถวคนเป็น null เสมอ');
    // ส่งค่าใหม่มา → ใช้ค่าใหม่ (ตัดช่องว่าง / จำกัดความยาว)
    out = merge(current.map(it => (it.key === 'r1' ? { ...it, scope: '  ถ่าย 5 ลุค  ' } : it)));
    assert.equal(out.r1.scope, 'ถ่าย 5 ลุค');
    out = merge(current.map(it => (it.key === 'r1' ? { ...it, scope: 'ข'.repeat(3000) } : it)));
    assert.equal(out.r1.scope.length, 2000);
    // ตั้งใจลบ (null / ว่าง) → null · object ปลอม → null
    for (const scope of [null, '', '   ', { evil: true }]) {
        out = merge(current.map(it => (it.key === 'r1' ? { ...it, scope } : it)));
        assert.equal(out.r1.scope, null, JSON.stringify(scope));
    }
    // แถวคนที่ส่ง scope มาก็ไม่เก็บ
    out = merge(current.map(it => (it.key === 'h1' ? { ...it, scope: 'ปลอม' } : it)));
    assert.equal(out.h1.scope, null);
    // ใบที่เดินงานไปแล้วสลับเป็นแถวคนไม่ได้ → คงใบเดิมทั้งแถว รวม scope
    out = merge(current.map(it => (it.key === 'r2' ? { key: 'r2', mode: 'direct', name: 'x', scope: null } : it)));
    assert.equal(out.r2.mode, 'casting');
    assert.equal(out.r2.scope, 'ถ่าย 1 วัน');
    // แถวคนสลับเป็นใบขอให้หา: ไม่มี scope เดิมให้ยก → ใช้ที่ส่งมา หรือ null
    out = merge(current.map(it => (it.key === 'h1' ? { key: 'h1', mode: 'casting', kind: 'พิธีกร', headcount: 1 } : it)));
    assert.equal(out.h1.mode, 'casting');
    assert.equal(out.h1.scope, null);
    out = merge(current.map(it => (it.key === 'h1' ? { key: 'h1', mode: 'casting', kind: 'พิธีกร', headcount: 1, scope: 'พูด 2 ชม.' } : it)));
    assert.equal(out.h1.scope, 'พูด 2 ชม.');
    // ใบใหม่ในฟอร์มเต็ม
    const fresh = logic.mergeHireItems([], [{ mode: 'casting', kind: 'x', headcount: 1, scope: SCOPE }], { userId: 3, at })[0];
    assert.equal(fresh.scope, SCOPE);
    assert.equal(logic.mergeHireItems([], [{ mode: 'casting', kind: 'x', headcount: 1 }], { userId: 3, at })[0].scope, null);
});

// ---------------------------------------------------------------- store (ฐานจำลอง)

test('the request list carries the Scope of Work for the finder and can be searched by it', async () => {
    FIXTURE.other_projects = [{ id: 90, name: 'ถ่ายแบบ', brand: 'Jdent', status: 'Active', campaign_type: 'other', hire_items: [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 1, filled: 0, candidates: [], assignee_id: 55,
          spec: 'หญิง 20-25', scope: SCOPE },
        { key: 'r2', mode: 'casting', kind: 'ช่างภาพ', fee: 0, headcount: 1, filled: 0, candidates: [], assignee_id: 55 },  // ใบเก่า
        { key: 'r3', mode: 'casting', kind: 'พิธีกร', fee: 0, headcount: 1, filled: 0, candidates: [], assignee_id: 55, scope: '   ' }
    ] }];
    try {
        // คนช่วยหาที่ไม่มีสิทธิ์แบรนด์ (scope = []) ยังเห็นบรีฟของใบที่ได้รับมอบหมายครบ
        const out = await realTasks.call(pgHires, { userId: 55, scopeBrands: [], withNames: false });
        const by = Object.fromEntries(out.rows.map(r => [r.key, r]));
        assert.equal(by.r1.scope, SCOPE);
        assert.equal(by.r1.spec, 'หญิง 20-25');
        assert.equal(by.r2.scope, null, 'ใบเก่าที่ไม่มีช่องนี้ = null');
        assert.equal(by.r3.scope, null, 'ช่องว่างล้วน = null');
        const found = await realTasks.call(pgHires, { userId: 55, scopeBrands: [], withNames: false, search: 'วิดีโอสั้น' });
        assert.deepEqual(found.rows.map(r => r.key), ['r1']);
    } finally {
        FIXTURE.other_projects = [];
    }
});

// ---------------------------------------------------------------- เส้น API: Scope of Work

test('POST /api/projects/:id/hires stores the Scope of Work on a request but never on a person', async () => {
    user();
    const db = { id: 63, name: 'ถ่ายแบบ Sep', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active', creator: 'แพรว', hire_items: [] };
    store.projects.findByIdFull = async id => (String(id) === '63' ? structuredClone(db) : null);
    store.activity.log = async () => {};
    store.projects.addHireItem = async (id, item) => {
        db.hire_items = [...db.hire_items, structuredClone(item)];
        return { item, items: structuredClone(db.hire_items), updated_at: '2026-09-21T05:00:00.000Z' };
    };
    let res = await send('POST', '/api/projects/63/hires', { mode: 'casting', kind: 'นางแบบ', headcount: 2, fee: 3000, spec: 'หญิง', scope: ` ${SCOPE} ` });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.item.scope, SCOPE);
    res = await send('POST', '/api/projects/63/hires', { mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', scope: SCOPE });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.item.scope, null);
});

test('PUT /api/projects/:id/hires/:key edits the Scope of Work only when it is sent', async () => {
    user();
    let saved = [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 2, filled: 0, candidates: [], spec: 'หญิง', scope: SCOPE },
        { key: 'h1', mode: 'direct', kind: 'พิธีกร', name: 'ชบา', fee: 3000, status: 'ตกลงแล้ว' }
    ];
    store.projects.findByIdFull = async () => ({ id: 64, name: 'งาน', brand: 'Beauterry', team_id: 1, campaign_type: 'other',
        status: 'Active', creator: 'แพรว', hire_items: saved });
    store.projects.patchHireItems = async (id, key, fn) => {
        const row = saved.find(it => it.key === key);
        if (!row) return null;
        const next = fn(structuredClone(row), structuredClone(saved));
        if (!Array.isArray(next)) return null;
        saved = next;
        return structuredClone(next);
    };
    store.activity.log = async () => {};
    const put = body => send('PUT', '/api/projects/64/hires/r1', body);
    const r1 = () => saved.find(it => it.key === 'r1');

    // แก้ช่องอื่น ไม่ส่ง scope → คงเดิม
    assert.equal((await put({ spec: 'หญิง 20-25' })).status, 200);
    assert.equal(r1().spec, 'หญิง 20-25');
    assert.equal(r1().scope, SCOPE);
    // ส่งมา → ตัดช่องว่าง / จำกัดความยาวแบบเดียวกับตอนสร้าง
    assert.equal((await put({ scope: '  ถ่าย 5 ลุค  ' })).status, 200);
    assert.equal(r1().scope, 'ถ่าย 5 ลุค');
    assert.equal((await put({ scope: 'ค'.repeat(2100) })).status, 200);
    assert.equal(r1().scope, 'ค'.repeat(2000));
    // ลบออก
    assert.equal((await put({ scope: '' })).status, 200);
    assert.equal(r1().scope, null);
    assert.equal((await put({ scope: SCOPE })).status, 200);
    assert.equal((await put({ scope: null })).status, 200);
    assert.equal(r1().scope, null);
    assert.equal((await put({ scope: { evil: 1 } })).status, 200);
    assert.equal(r1().scope, null, 'object ปลอมไม่กลายเป็น "[object Object]"');
    // แถวคนไม่ใช่ใบขอให้หา → 404 เหมือนเดิม
    assert.equal((await send('PUT', '/api/projects/64/hires/h1', { scope: SCOPE })).status, 404);
    assert.equal(saved.find(it => it.key === 'h1').scope, undefined);
});

test('saving the full job form without the scope field keeps every request\'s Scope of Work', async () => {
    user();
    const U = '2026-09-21T01:00:00.000Z';
    const stored = [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 2, filled: 0, candidates: [], requested_by_id: 3, scope: SCOPE },
        { key: 'h1', mode: 'direct', kind: 'พิธีกร', name: 'ชบา', fee: 3000, status: 'ตกลงแล้ว' }
    ];
    const project = { id: 66, name: 'งานเดิม', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active',
        creator: 'แพรว', updated_at: U, hire_items: stored };
    let written = null;
    store.projects.findByIdFull = async () => structuredClone(project);
    store.activity.log = async () => {};
    store.projects.updateWithHireItems = async (id, fields, expected, build) => {
        const items = build(structuredClone(stored));
        written = items;
        return { row: { ...project, ...fields, hire_items: items }, items };
    };
    const put = hire_items => send('PUT', '/api/projects/66', { name: 'งานเดิม', expected_updated_at: U, hire_items });

    assert.equal((await put(stored.map(({ scope, ...rest }) => rest))).status, 200);
    assert.equal(written.find(it => it.key === 'r1').scope, SCOPE, 'ฟอร์มที่ไม่ส่งช่องนี้ไม่ล้างของเดิม');
    assert.equal((await put(stored.map(it => (it.key === 'r1' ? { ...it, scope: 'ใหม่' } : it)))).status, 200);
    assert.equal(written.find(it => it.key === 'r1').scope, 'ใหม่');
    assert.equal((await put(stored.map(it => (it.key === 'r1' ? { ...it, scope: null } : it)))).status, 200);
    assert.equal(written.find(it => it.key === 'r1').scope, null);
    assert.equal(written.find(it => it.key === 'h1').scope, null);
});

// ---------------------------------------------------------------- เส้น API: ผู้ดูแลงาน

test('creating a Talent job needs ผู้ดูแลงาน; KOL campaigns do not', async () => {
    user();
    let created = [];
    store.projects.create = async fields => { created.push(fields); return { id: 70, ...fields }; };
    store.activity.log = async () => {};
    const create = body => send('POST', '/api/projects', { name: 'งานใหม่', brand: 'Beauterry', status: 'Active', ...body });

    for (const creator of [undefined, null, '', '   ', { name: 'แพรว' }, ['แพรว']]) {
        const res = await create({ campaign_type: 'other', creator, hire_items: [] });
        assert.equal(res.status, 400, JSON.stringify(creator));
        assert.deepEqual(await res.json(), NEED_OWNER);
    }
    // ใส่ owner มาอย่างเดียวไม่พอ — งานใหม่ต้องเลือกผู้ดูแลงาน (ช่อง creator)
    assert.equal((await create({ campaign_type: 'other', owner: 'แพรว' })).status, 400);
    assert.equal(created.length, 0, 'ไม่มีการสร้างงานจากคำขอที่ไม่ผ่าน');

    let res = await create({ campaign_type: 'other', creator: '  แพรว  ', hire_items: [{ mode: 'casting', kind: 'นางแบบ', headcount: 1, scope: SCOPE }] });
    assert.equal(res.status, 201);
    const data = (await res.json()).data;
    assert.equal(data.creator, 'แพรว', 'เก็บชื่อที่ตัดช่องว่างแล้ว');
    assert.equal(data.hire_items[0].scope, SCOPE);

    // แคมเปญ KOL (ไม่ระบุประเภท / ระบุ kol) สร้างได้โดยไม่มีผู้ดูแลงานเหมือนเดิม
    assert.equal((await create({})).status, 201);
    assert.equal((await create({ campaign_type: 'kol', creator: '' })).status, 201);
    assert.equal(created.length, 3);
    assert.equal(created[2].creator, '', 'แคมเปญ KOL ไม่แตะค่าที่ส่งมา');
});

test('ผู้ดูแลงาน of a Talent job cannot be cleared, but saves that do not send it are unaffected', async () => {
    user();
    const U = '2026-09-21T01:00:00.000Z';
    let project = { id: 67, name: 'งาน', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active',
        creator: 'แพรว', owner: null, updated_at: U, hire_items: [] };
    const updates = [];
    let hireWrites = 0;
    store.projects.findByIdFull = async () => structuredClone(project);
    store.projects.update = async (id, fields) => { updates.push(fields); return { ...project, ...fields }; };
    store.projects.updateWithHireItems = async (id, fields, expected, build) => {
        hireWrites++;
        const items = build([]);
        return { row: { ...project, ...fields, hire_items: items }, items };
    };
    store.activity.log = async () => {};
    const put = body => send('PUT', '/api/projects/67', body);

    // ล้างผู้ดูแลงาน (ว่าง / ช่องว่างล้วน / null / object) → 400 ไม่เขียนอะไร
    for (const creator of ['', '   ', null, { x: 1 }]) {
        const res = await put({ name: 'งาน', creator });
        assert.equal(res.status, 400, JSON.stringify(creator));
        assert.deepEqual(await res.json(), NEED_OWNER);
    }
    assert.equal((await put({ name: 'งาน', creator: '', owner: '  ' })).status, 400, 'owner ว่างก็ไม่นับ');
    // ส่งพร้อมรายการจ้างก็ตีกลับก่อนเปิดทรานแซกชัน
    assert.equal((await put({ name: 'งาน', creator: '', expected_updated_at: U, hire_items: [] })).status, 400);
    assert.equal(updates.length, 0);
    assert.equal(hireWrites, 0);

    // คำขอที่ไม่มีช่อง creator (เปลี่ยนสถานะ / บันทึกรายการจ้าง) ไม่โดนตรวจ — รวมงานเก่าที่ยังไม่มีผู้ดูแลงาน
    project = { ...project, creator: null };
    assert.equal((await put({ status: 'Completed' })).status, 200);
    assert.equal((await put({ expected_updated_at: U, hire_items: [] })).status, 200);
    assert.equal(hireWrites, 1);
    // งานเก่าที่เก็บชื่อไว้ในช่อง owner แล้วส่ง owner มาด้วย → ผ่าน
    assert.equal((await put({ name: 'งาน', creator: null, owner: 'สมชาย' })).status, 200);
    assert.equal(updates.at(-1).creator, null);
    // เลือกชื่อ → ผ่าน และเก็บแบบตัดช่องว่าง
    assert.equal((await put({ name: 'งาน', creator: '  ฟ้า ' })).status, 200);
    assert.equal(updates.at(-1).creator, 'ฟ้า');
    // งานเก่าที่ยังไม่มีผู้ดูแลงาน + หน้าเว็บที่เปิดค้างไว้ตั้งแต่ก่อนอัปเดต (ส่ง creator/owner ว่างมาทุกครั้ง) → ผ่าน เพราะไม่ได้ล้างอะไร
    assert.equal((await put({ name: 'งาน 2', creator: null, owner: null })).status, 200);
    assert.equal(updates.at(-1).creator, null);
    assert.equal((await put({ name: 'งาน 2', creator: '' })).status, 200);
    // งานเก่าที่เก็บชื่อไว้ในช่อง owner อย่างเดียว: ส่ง creator ว่างโดยไม่ส่ง owner → ยังตีกลับ (งานนี้มีผู้ดูแลอยู่แล้ว)
    project = { ...project, creator: null, owner: 'สมชาย' };
    const before = updates.length;
    assert.equal((await put({ name: 'งาน', creator: '' })).status, 400);
    assert.equal(updates.length, before);
    // ฟอร์มหน้าเดิมส่ง owner ที่เก็บไว้กลับมาด้วย → ผ่าน
    assert.equal((await put({ name: 'งาน', creator: null, owner: 'สมชาย' })).status, 200);
    project = { ...project, owner: null };

    // แคมเปญ KOL: ล้างชื่อได้เหมือนเดิม
    project = { ...project, campaign_type: 'kol', creator: 'แพรว' };
    assert.equal((await put({ name: 'งาน', creator: '' })).status, 200);
    assert.equal(updates.at(-1).creator, '');
});
