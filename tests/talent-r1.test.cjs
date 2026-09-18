const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Talent รอบ 1 (ฝั่ง server)
// · ฟอร์มสั้น "มีคนแล้ว" / "ขอให้ช่วยหา" เพิ่มทีละ 1 แถว (POST /api/projects/:id/hires)
// · กติกา "ไม่มีค่าตัว ห้ามตกลงแล้ว" ทุกทางที่ตั้งสถานะได้ (ฟอร์มสั้น / ฟอร์มเต็ม / สร้างงาน / ปุ่มยืนยันคิวคลิกเดียว)
// · ใบขอให้หาบอกได้ว่าใครขอ เมื่อไหร่
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-r1 test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// snapshot จำลอง — ต้องสลับก่อนโหลด store เพราะ pg/hires หยิบ loadSnapshot ออกไปตอน require
const FIXTURE = { other_projects: [], user_names: [] };
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
const realLoadSnapshot = snapshot.loadSnapshot;
const snapCalls = [];
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    snapCalls.push(only);
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};

const logic = require(path.join(SRC, 'store/logic'));
const store = require(path.join(SRC, 'store'));
const { projects: pgProjects } = require(path.join(SRC, 'store/pg/projects'));
const { hires: pgHires } = require(path.join(SRC, 'store/pg/hires'));
// เก็บตัวจริงไว้ก่อน — เทสต์ของ route สลับเมธอดบน store (เป็น object เดียวกัน)
const realAddHireItem = pgProjects.addHireItem;
const realTasks = pgHires.tasks;
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let server, base, account;
// ผู้ใช้คนอื่นที่ route อ่านตอนตรวจคนช่วยหา (id → แถว หรือ null = ไม่มีผู้ใช้นี้) · id อื่นได้บัญชีที่ล็อกอินอยู่
const lookups = {};
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    store.users.findById = async id => (Object.prototype.hasOwnProperty.call(lookups, String(id)) ? lookups[String(id)] : account);
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

// ---------------------------------------------------------------- ตรรกะล้วน

test('newHireRow: a direct person keeps only the fields the form can fill', () => {
    const at = '2026-09-18T03:00:00.000Z';
    const { item, error } = logic.newHireRow({
        mode: 'direct', kind: ' นางแบบ ', name: ' มะลิ ', contact: '081-000-0000', agency: 'Model Co', qty: '1 วัน',
        fee: '3500.456', use_date: '2026-09-20', use_time: '09:00-17:00', place: 'สตูดิโอ A',
        link: 'https://example.test/mali', note: 'ชุดมาเอง', status: 'ตกลงแล้ว',
        // ช่องที่ระบบเป็นคนตั้ง และช่องแปลกปลอม — ห้ามผ่านเข้าแถวเด็ดขาด
        key: 'forged-key', image: { filename: '../.env' }, booking: { state: 'confirmed' }, from_request: 'r1', from_candidate: 'c1',
        candidates: [{ key: 'x', name: 'ปลอม', status: 'เลือกแล้ว' }], filled: 5, headcount: 9, spec: 'ปลอม', deadline: '2026-09-19',
        requested_by_id: 99, requested_at: '2000-01-01T00:00:00.000Z', assignee_id: 7, budget: 1e9, is_admin: true
    }, { userId: 3, users: { 7: { id: 7, name: 'ฟ้า' } }, actor: 'แพรว', at });

    assert.equal(error, undefined);
    assert.equal(item.mode, 'direct');
    assert.equal(item.kind, 'นางแบบ');
    assert.equal(item.name, 'มะลิ');
    assert.equal(item.contact, '081-000-0000');
    assert.equal(item.agency, 'Model Co');
    assert.equal(item.qty, '1 วัน');
    assert.equal(item.fee, 3500.46);
    assert.equal(item.status, 'ตกลงแล้ว');
    assert.equal(item.use_date, '2026-09-20');
    assert.equal(item.use_time, '09:00-17:00');
    assert.equal(item.place, 'สตูดิโอ A');
    assert.equal(item.link, 'https://example.test/mali');
    assert.equal(item.note, 'ชุดมาเอง');
    for (const k of ['image', 'booking', 'from_request', 'from_candidate', 'candidates', 'filled', 'headcount',
        'assignee_id', 'assignee_name', 'assigned_at', 'requested_by_id', 'requested_at']) {
        assert.equal(item[k], null, k);
    }
    for (const k of ['budget', 'is_admin', 'spec', 'deadline']) assert.equal(item[k], undefined, k);
    assert.ok(typeof item.key === 'string' && item.key.length > 1);
    assert.notEqual(item.key, 'forged-key', 'key มาจาก server เสมอ');

    // วันที่ไม่มีจริง / ผิดรูปแบบ = ว่าง (ห้ามหลุดไปถึงคอลัมน์ DATE) · object ในช่องข้อความไม่กลายเป็น "[object Object]"
    const odd = logic.newHireRow({ mode: 'direct', kind: 'พิธีกร', name: 'ชบา', use_date: '2026-02-31', place: { x: 1 }, note: ['a'] }, {}).item;
    assert.equal(odd.use_date, null);
    assert.equal(odd.place, null);
    assert.equal(odd.note, null);
    for (const d of ['20/09/2026', '2026-13-01', '2026-9-1', 20260920]) {
        assert.equal(logic.newHireRow({ mode: 'direct', kind: 'พิธีกร', name: 'ชบา', use_date: d }, {}).item.use_date, null, String(d));
    }
});

test('newHireRow: a casting request never carries a person and always starts as กำลังหา', () => {
    const at = '2026-09-18T03:00:00.000Z';
    const users = { 7: { id: 7, name: 'ฟ้า' } };
    const { item } = logic.newHireRow({
        mode: 'casting', kind: 'นักแสดง', name: 'ปลอม', contact: '081', agency: 'x', qty: '2 วัน', link: 'https://x',
        headcount: 3, fee: 0, spec: 'ชาย 25-30 ปี', deadline: '2026-09-25', use_date: '2026-09-30', place: 'สตูดิโอ', note: 'ด่วน',
        assignee_id: '7', status: 'ตกลงแล้ว', candidates: [{ key: 'c', name: 'x', status: 'เลือกแล้ว' }], filled: 2,
        requested_by_id: 99, requested_at: '2000-01-01T00:00:00.000Z', image: { filename: 'evil.jpg' }
    }, { userId: 3, users, actor: 'แพรว', at });

    assert.equal(item.mode, 'casting');
    // ใบขอให้หาห้ามมีชื่อคน ไม่งั้นหน้า "คนที่เคยจ้าง" นับเป็นคน
    for (const k of ['name', 'contact', 'agency', 'qty', 'link', 'image', 'booking', 'from_request']) assert.equal(item[k], null, k);
    assert.equal(item.status, 'กำลังหา');
    assert.equal(item.fee, 0, 'งบต่อคน 0 ได้');
    assert.equal(item.headcount, 3);
    assert.deepEqual(item.candidates, []);
    assert.equal(item.filled, 0);
    assert.equal(item.requested_by_id, 3, 'คนขอ = คนที่กดบันทึก ไม่ใช่ค่าที่ส่งมา');
    assert.equal(item.requested_at, at);
    assert.equal(item.assignee_id, 7);
    assert.equal(item.assignee_name, 'ฟ้า', 'ชื่อคนช่วยหาเอาจากฐาน');
    assert.equal(item.assigned_at, at);
    assert.equal(item.spec, 'ชาย 25-30 ปี');
    assert.equal(item.deadline, '2026-09-25');
    assert.equal(item.use_date, '2026-09-30');
    assert.equal(item.place, 'สตูดิโอ');
    assert.equal(item.note, 'ด่วน');

    // จำนวนคนถูกจำกัด · ไม่ส่งมา = 1
    assert.equal(logic.newHireRow({ mode: 'casting', kind: 'x', headcount: 1e9 }, {}).item.headcount, 999);
    assert.equal(logic.newHireRow({ mode: 'casting', kind: 'x' }, {}).item.headcount, 1);
    // คนช่วยหาที่ไม่ผ่านการตรวจกับฐานผู้ใช้ = ยังไม่มีคนช่วยหา
    const forged = logic.newHireRow({ mode: 'casting', kind: 'x', assignee_id: 123 }, { userId: 3, users }).item;
    assert.equal(forged.assignee_id, null);
    assert.equal(forged.assignee_name, null);
    assert.equal(logic.newHireRow({ mode: 'casting', kind: 'x', assignee_id: { id: 7 } }, { users }).item.assignee_id, null);
});

test('newHireRow: required fields, unknown statuses and the no-fee rule', () => {
    const need = { error: { code: 400, message: 'ใส่ค่าตัวก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้' } };
    for (const status of ['ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว']) {
        for (const fee of [0, '', null, -500, 'abc', undefined]) {
            assert.deepEqual(logic.newHireRow({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', status, fee }, {}), need, `${status} / ${fee}`);
        }
    }
    // กำลังคุย (ทาบทาม) บันทึกได้โดยยังไม่มีค่าตัว
    assert.equal(logic.newHireRow({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ' }, {}).item.status, 'ทาบทาม');
    assert.equal(logic.newHireRow({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', status: 'ตกลงแล้ว', fee: 5000 }, {}).item.status, 'ตกลงแล้ว');
    // สถานะที่ไม่รู้จัก (รวมสถานะของใบขอให้หา) → กำลังคุย และไม่ติดกติกาค่าตัว
    for (const status of ['อะไรก็ได้', 'กำลังหา', 'เสนอชื่อแล้ว', { x: 1 }, null]) {
        assert.equal(logic.newHireRow({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', status }, {}).item.status, 'ทาบทาม', String(status));
    }

    const err = body => logic.newHireRow(body, {}).error;
    assert.deepEqual(err({ mode: 'direct', name: 'มะลิ' }), { code: 400, message: 'กรุณาระบุประเภทงาน' });
    assert.deepEqual(err({ mode: 'casting', kind: '   ', headcount: 2 }), { code: 400, message: 'กรุณาระบุประเภทงาน' });
    assert.deepEqual(err({ mode: 'direct', kind: 'นางแบบ', name: '   ' }), { code: 400, message: 'กรุณาระบุชื่อคน' });
    assert.deepEqual(err({ mode: 'direct', kind: 'นางแบบ' }), { code: 400, message: 'กรุณาระบุชื่อคน' });
    assert.equal(err({ kind: 'นางแบบ', name: 'มะลิ' }).code, 400, 'ต้องบอกว่าเป็นแบบไหน');
    assert.equal(err({ mode: 'Direct', kind: 'นางแบบ', name: 'มะลิ' }).code, 400);
    assert.equal(err(null).code, 400);
    assert.equal(err([{ mode: 'direct', kind: 'x', name: 'y' }]).code, 400);
});

test('payableWithoutFee: only rows that become agreed without a fee in this save are blocked', () => {
    const { payableWithoutFee } = logic;
    const current = [
        { key: 'old', mode: 'direct', name: 'เก่า', fee: 0, status: 'ตกลงแล้ว' },       // ข้อมูลเก่าที่เป็นแบบนี้อยู่แล้ว
        { key: 'b', mode: 'direct', name: 'บี', fee: 0, status: 'ทาบทาม' },
        { key: 'c', mode: 'direct', name: 'ซี', fee: 800, status: 'ตกลงแล้ว' },
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 0, headcount: 2, filled: 1, status: 'กำลังหา',
          candidates: [{ key: 'k1', name: 'รอคิว', status: 'เลือกแล้ว' }] },
        { key: 'p1', mode: 'direct', name: 'รอคิว', fee: 0, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'k1', booking: { state: 'pending' } }
    ];
    const edit = (key, patch) => current.map(it => (it.key === key ? { ...it, ...patch } : it));
    const add = row => [...current, row];

    // บันทึกซ้ำโดยไม่แตะอะไร (รวมแถวเก่าที่ตกลงแล้วแต่ค่าตัว 0) → ผ่าน
    assert.equal(payableWithoutFee(current, structuredClone(current)), null);
    assert.equal(payableWithoutFee(current, edit('old', { note: 'แก้หมายเหตุ', fee: '' })), null, 'ค่าตัวว่างกับ 0 คือค่าเดียวกัน');
    // เปลี่ยนเป็นตกลงแล้วโดยไม่มีค่าตัว → ติด · ใส่ค่าตัวแล้ว → ผ่าน
    assert.equal(payableWithoutFee(current, edit('b', { status: 'ตกลงแล้ว' })).key, 'b');
    assert.equal(payableWithoutFee(current, edit('b', { status: 'ตกลงแล้ว', fee: 1500 })), null);
    // แถวเก่าเลื่อนขั้นต่อ (ถ่ายเสร็จ) ทั้งที่ยังไม่มีค่าตัว → ติด
    assert.equal(payableWithoutFee(current, edit('old', { status: 'ถ่ายเสร็จ' })).key, 'old');
    // ล้างค่าตัวของคนที่ตกลงแล้ว → ติด
    assert.equal(payableWithoutFee(current, edit('c', { fee: 0 })).key, 'c');
    // แถวใหม่: ไม่มี key / key ใหม่ / key ซ้ำในก้อนเดียวกัน
    assert.equal(payableWithoutFee(current, add({ mode: 'direct', name: 'ใหม่', status: 'ส่งงานแล้ว', fee: 0 })).name, 'ใหม่');
    assert.equal(payableWithoutFee(current, add({ key: 'n1', mode: 'direct', name: 'ใหม่', status: 'ตกลงแล้ว' })).key, 'n1');
    assert.equal(payableWithoutFee(current, add({ ...current[0], name: 'ซ้ำ key' })).name, 'ซ้ำ key');
    assert.equal(payableWithoutFee(current, add({ key: 'n2', mode: 'direct', name: 'คุยอยู่', status: 'ทาบทาม', fee: 0 })), null);
    // ใบขอให้หาไม่ใช่คน (งบต่อคน 0 ได้)
    assert.equal(payableWithoutFee([], [{ key: 'x', mode: 'casting', kind: 'x', fee: 0, status: 'ตกลงแล้ว' }]), null);
    // คนที่รอยืนยันคิว: สถานะเดินตามขั้นตอน (merge ไม่รับสถานะที่ส่งมา) → ไม่นับว่าตั้งเป็นตกลงแล้ว
    assert.equal(payableWithoutFee(current, edit('p1', { status: 'ตกลงแล้ว' })), null);
    // ใบต้นทางหายไปแล้ว → ไม่ล็อก ตั้งเองได้ จึงต้องมีค่าตัว
    const orphan = current.filter(it => it.key !== 'r1');
    assert.equal(payableWithoutFee(orphan, orphan.map(it => (it.key === 'p1' ? { ...it, status: 'ตกลงแล้ว' } : it))).key, 'p1');
    assert.equal(payableWithoutFee(null, null), null);
    assert.equal(payableWithoutFee(current, 'ไม่ใช่ array'), null);
});

test('bookingConfirm refuses to agree a booking when the fee would be 0', () => {
    const job = () => ([
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 0, headcount: 1, filled: 1, candidates: [{ key: 'c1', name: 'มะลิ', status: 'เลือกแล้ว' }] },
        { key: 'p0', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 0, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c1',
          booking: { state: 'pending' } }
    ]);
    const who = { actor: 'ฟ้า', at: '2026-09-18T00:00:00.000Z' };
    for (const body of [{}, { fee: 0 }, { fee: '' }, { fee: -1 }, undefined]) {
        assert.deepEqual(logic.bookingConfirm(job(), 'r1', 'p0', body, who),
            { error: { code: 400, message: 'ใส่ค่าตัวที่ตกลงจริงก่อนยืนยันคิว' } }, JSON.stringify(body));
    }
    // ใส่ค่าตัวจริงมา: ตอนเลือกไม่มีค่าตัวที่ตกลงไว้ → เป็นค่าตัวใหม่ ให้ทีมแบรนด์ตัดสิน (ยังไม่ตกลงแล้ว)
    const typed = logic.bookingConfirm(job(), 'r1', 'p0', { fee: 3000 }, who).row;
    assert.equal(typed.status, 'ทาบทาม');
    assert.equal(typed.booking.state, 'fee_review');
    assert.equal(typed.booking.requested_fee, 3000);
    // มีค่าตัวที่ตกลงไว้แล้ว → "ยืนยันตามนี้" คลิกเดียวได้เหมือนเดิม
    const ok = logic.bookingConfirm(job().map(it => (it.key === 'p0' ? { ...it, fee: 4000 } : it)), 'r1', 'p0', {}, who).row;
    assert.equal(ok.status, 'ตกลงแล้ว');
    assert.equal(ok.fee, 4000);
    // ขั้นผิดยังได้ 409 ก่อนเรื่องค่าตัว
    const done = job().map(it => (it.key === 'p0' ? { ...it, booking: { state: 'confirmed' } } : it));
    assert.equal(logic.bookingConfirm(done, 'r1', 'p0', {}, who).error.code, 409);
});

// ---------------------------------------------------------------- store (ฐานจำลอง)

test('request list shows who asked and when, without loading password hashes', async () => {
    const R = (key, extra) => ({ key, mode: 'casting', kind: 'นางแบบ', fee: 1000, headcount: 1, filled: 0, candidates: [], assignee_id: 7, ...extra });
    FIXTURE.other_projects = [{ id: 90, name: 'ถ่ายแบบ', brand: 'Jdent', status: 'Active', campaign_type: 'other', hire_items: [
        R('r1', { requested_by_id: 3, requested_at: '2026-09-17T02:00:00.000Z' }),
        R('r2', { requested_by_id: 5, requested_at: '2026-09-17T03:00:00.000Z' }),
        R('r3', { requested_by_id: '6' }),
        R('r4', { requested_by_id: 404 }),       // ผู้ใช้ถูกลบไปแล้ว
        R('r5', {}),                             // ใบเก่าที่ไม่มีคนขอ
        { key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000, status: 'ตกลงแล้ว' }
    ] }];
    FIXTURE.user_names = [
        { id: 3, username: 'praew', full_name: 'แพรวพรรณ', nickname: 'แพรว', password_hash: 'SECRET-HASH' },
        { id: 5, username: 'somchai', full_name: 'สมชาย ใจดี', nickname: null },
        { id: 6, username: 'beam', full_name: '  ', nickname: '' }
    ];
    snapCalls.length = 0;
    try {
        const out = await realTasks.call(pgHires, { userId: 3, scopeBrands: ['Jdent'] });
        const by = Object.fromEntries(out.rows.map(r => [r.key, r]));
        assert.equal(by.r1.requested_by_name, 'แพรว', 'ชื่อเล่นก่อน');
        assert.equal(by.r1.requested_at, '2026-09-17T02:00:00.000Z');
        assert.equal(by.r2.requested_by_name, 'สมชาย ใจดี', 'ไม่มีชื่อเล่น ใช้ชื่อจริง');
        assert.equal(by.r3.requested_by_name, 'beam', 'ไม่มีทั้งสอง ใช้ username');
        assert.equal(by.r3.requested_at, null);
        assert.equal(by.r4.requested_by_name, null);
        assert.equal(by.r5.requested_by_name, null);
        assert.equal(by.r5.requested_at, null);
        assert.ok(!JSON.stringify(out).includes('SECRET-HASH'), 'ข้อมูลผู้ใช้อื่นไม่หลุดออกไป');
        assert.deepEqual(snapCalls, [['other_projects', 'user_names']], 'ชื่ออ่านจากคิวรีเบา ไม่ใช่ users ทั้งแถว');

        // เส้นนับเลขแดง: ไม่โหลดชื่อเลย แต่ตัวเลขเท่าเดิม
        snapCalls.length = 0;
        const light = await realTasks.call(pgHires, { userId: 3, scopeBrands: ['Jdent'], withNames: false });
        assert.deepEqual(snapCalls, [['other_projects']]);
        assert.ok(light.rows.every(r => r.requested_by_name === null));
        assert.equal(light.rows.find(r => r.key === 'r1').requested_at, '2026-09-17T02:00:00.000Z');
        assert.deepEqual(light.counts, out.counts);
    } finally {
        FIXTURE.other_projects = [];
        FIXTURE.user_names = [];
    }

    // คิวรีชื่อของจริง: เลือกเฉพาะช่องชื่อ (ไม่มี password_hash และไม่ใช่ SELECT *)
    const seen = [];
    const realQuery = pool.query;
    pool.query = async text => { seen.push(text); return { rows: [{ id: 3, username: 'praew', full_name: 'แพรวพรรณ', nickname: 'แพรว' }] }; };
    try {
        const snap = await realLoadSnapshot(['user_names']);
        assert.deepEqual(snap.user_names, [{ id: 3, username: 'praew', full_name: 'แพรวพรรณ', nickname: 'แพรว' }]);
        assert.equal(seen.length, 1);
        assert.match(seen[0], /FROM users/);
        assert.doesNotMatch(seen[0], /password|\*/i);
    } finally {
        pool.query = realQuery;
    }
});

test('adding one hire row locks the job, keeps keys unique, recomputes the budget and widens the job dates', async () => {
    const realConnect = pool.connect;
    let row = null;
    const sql = [];
    // client จำลองของทรานแซกชัน — จดทุกคำสั่งไว้ตรวจ ไม่มีการต่อฐานจริง
    pool.connect = async () => ({
        query: async (text, params) => {
            const t = String(text).trim();
            sql.push({ text: t, params });
            if (t.startsWith('SELECT')) return { rows: row ? [structuredClone(row)] : [] };
            if (t.startsWith('UPDATE')) return { rows: [{ updated_at: params[4] }] };
            return { rows: [] };
        },
        release() {}
    });
    const update = () => sql.find(s => s.text.startsWith('UPDATE'));
    try {
        row = { status: 'Active', campaign_type: 'other', start_date: '2026-09-10', end_date: '2026-09-12', hire_items: [
            { key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000, status: 'ตกลงแล้ว' },
            { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 500, headcount: 3, filled: 1 }
        ] };
        let seenJob = null;
        const out = await realAddHireItem.call(pgProjects, 72, { key: 'h1', mode: 'direct', name: 'กุหลาบ', fee: 2500, use_date: '2026-09-20' },
            { userId: 7, guard: job => { seenJob = job; return null; } });
        assert.deepEqual(seenJob, { status: 'Active', campaign_type: 'other' }, 'guard ตัดสินจากค่าที่ล็อกไว้');
        assert.deepEqual(sql.map(s => s.text.split(/\s/)[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
        assert.match(sql[1].text, /FOR UPDATE/);
        assert.notEqual(out.item.key, 'h1', 'key ชนกับแถวเดิม = ได้ key ใหม่');
        assert.deepEqual(out.items.map(it => it.name || it.kind), ['มะลิ', 'นางแบบ', 'กุหลาบ']);
        assert.equal(out.items[2].key, out.item.key);
        const p = update().params;
        assert.deepEqual(JSON.parse(p[0]), out.items);
        assert.equal(p[1], 1000 + 500 * 2 + 2500, 'งบ = ค่าตัวทุกคน + งบของคนที่ยังต้องหา');
        assert.equal(p[2], '2026-09-10');
        assert.equal(p[3], '2026-09-20', 'ช่วงงานขยายให้ครอบวันใช้งาน');
        assert.equal(p[5], 7, 'แก้ล่าสุดโดยคนที่เพิ่ม');
        assert.equal(p[6], 72);
        assert.equal(out.updated_at, p[4]);

        // งานที่ยังไม่มีช่วงวัน + ไม่มีรายการเลย · ไม่รู้ว่าใครเพิ่ม = คง updated_by เดิม
        sql.length = 0;
        row = { status: 'Draft', campaign_type: 'other', start_date: null, end_date: null, hire_items: null };
        const first = await realAddHireItem.call(pgProjects, '72', { mode: 'casting', kind: 'x', fee: 0, headcount: 1, filled: 0, use_date: '2026-09-01' }, {});
        assert.equal(first.items.length, 1);
        assert.deepEqual(update().params.slice(2, 4), ['2026-09-01', '2026-09-01']);
        assert.equal(update().params[5], null);
        // วันใช้งานก่อนวันเริ่ม → ขยายวันเริ่ม · ไม่มีวันใช้งาน → ช่วงเดิม
        sql.length = 0;
        row = { status: 'Active', campaign_type: 'other', start_date: '2026-09-10', end_date: '2026-09-12', hire_items: [] };
        await realAddHireItem.call(pgProjects, 72, { mode: 'direct', name: 'x', fee: 1, use_date: '2026-09-02' }, {});
        assert.deepEqual(update().params.slice(2, 4), ['2026-09-02', '2026-09-12']);
        sql.length = 0;
        await realAddHireItem.call(pgProjects, 72, { mode: 'direct', name: 'x', fee: 1 }, {});
        assert.deepEqual(update().params.slice(2, 4), ['2026-09-10', '2026-09-12']);

        // guard ตีกลับ → คืน error ตามนั้น ไม่มีการเขียน
        sql.length = 0;
        const refused = await realAddHireItem.call(pgProjects, 72, { mode: 'direct', name: 'x' },
            { guard: () => ({ error: { code: 409, message: 'ปิดแล้ว' } }) });
        assert.deepEqual(refused, { error: { code: 409, message: 'ปิดแล้ว' } });
        assert.equal(update(), undefined);
        // ไม่มีงานนี้ / id ผิดรูป
        row = null;
        assert.equal(await realAddHireItem.call(pgProjects, 72, { mode: 'direct', name: 'x' }, {}), null);
        sql.length = 0;
        assert.equal(await realAddHireItem.call(pgProjects, 'abc', { mode: 'direct', name: 'x' }, {}), null);
        assert.equal(sql.length, 0, 'id ผิดรูปไม่แตะฐานเลย');
    } finally {
        pool.connect = realConnect;
    }
});

// ---------------------------------------------------------------- เส้น API

// งาน Talent จำลอง 1 งาน + addHireItem ในหน่วยความจำ (guard ใช้ค่า "ใต้ล็อก" ซึ่งตั้งให้ต่างจากค่าที่ route อ่านไว้ได้)
function talentJob(extra = {}) {
    const db = { id: 63, name: 'ถ่ายแบบ Sep', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active',
        hire_items: [{ key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000, status: 'ตกลงแล้ว' }], ...extra };
    const calls = { add: 0, logs: [], userId: undefined };
    store.projects.findByIdFull = async id => (String(id) === String(db.id) ? structuredClone(db) : null);
    store.activity.log = async entry => { calls.logs.push(entry); };
    store.projects.addHireItem = async (id, item, { userId, guard } = {}) => {
        calls.add++;
        if (String(id) !== String(db.id)) return null;
        const bad = guard ? guard({ status: db.lockedStatus || db.status, campaign_type: db.lockedType || db.campaign_type }) : null;
        if (bad && bad.error) return bad;
        const row = structuredClone(item);
        db.hire_items = [...db.hire_items, row];
        calls.userId = userId;
        return { item: row, items: structuredClone(db.hire_items), updated_at: '2026-09-18T05:00:00.000Z' };
    };
    return { db, calls };
}

test('POST /api/projects/:id/hires adds one person or one request through the same rules as the full form', async () => {
    user();
    const { db, calls } = talentJob();
    const post = body => send('POST', '/api/projects/63/hires', body);

    // มีคนแล้ว + ตกลงแล้ว + ค่าตัว → 201 พร้อมแถวที่ server ตั้งช่องของระบบให้แล้ว
    let res = await post({ mode: 'direct', kind: 'นางแบบ', name: 'กุหลาบ', fee: 2500, status: 'ตกลงแล้ว', use_date: '2026-09-20',
        image: { filename: '../.env' }, booking: { state: 'confirmed' }, requested_by_id: 99 });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.status, 'success');
    const added = json.data.item;
    assert.equal(added.name, 'กุหลาบ');
    assert.equal(added.status, 'ตกลงแล้ว');
    assert.equal(added.fee, 2500);
    assert.equal(added.image, null);
    assert.equal(added.booking, null);
    assert.equal(added.requested_by_id, null);
    assert.equal(json.data.items.length, 2);
    assert.equal(json.data.items[1].key, added.key);
    assert.equal(json.data.updated_at, '2026-09-18T05:00:00.000Z');
    assert.equal(calls.userId, 7);
    assert.equal(calls.logs.length, 1);
    assert.equal(calls.logs[0].action, 'update');
    assert.equal(calls.logs[0].project_id, 63);
    assert.equal(calls.logs[0].project_name, 'ถ่ายแบบ Sep');
    assert.equal(calls.logs[0].summary, 'เพิ่มคน กุหลาบ (นางแบบ) ค่าตัว ฿2,500');

    // ยังไม่รู้ค่าตัว = กำลังคุย บันทึกได้
    res = await post({ mode: 'direct', kind: 'พิธีกร', name: 'ชบา' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.item.status, 'ทาบทาม');
    assert.equal(calls.logs[1].summary, 'เพิ่มคน ชบา (พิธีกร) (ยังไม่ใส่ค่าตัว)');

    // ตกลงแล้วแต่ไม่มีค่าตัว → 400 ไม่เขียนอะไร
    res = await post({ mode: 'direct', kind: 'พิธีกร', name: 'ชบา', status: 'ตกลงแล้ว' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { status: 'error', message: 'ใส่ค่าตัวก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้' });
    assert.equal(calls.add, 2);

    // ขอให้ช่วยหา + มอบให้คนช่วยหาที่มีตัวจริง (ชื่อจากฐาน ไม่ใช่จากหน้าเว็บ)
    lookups['55'] = { id: 55, username: 'beam', nickname: 'บีม', role: 'member', is_active: true, status: 'active' };
    try {
        res = await post({ mode: 'casting', kind: 'นักแสดง', headcount: 2, fee: 3000, spec: 'ชาย 25-30 ปี', deadline: '2026-09-25',
            assignee_id: 55, assignee_name: 'ปลอม', name: 'ปลอม', status: 'ตกลงแล้ว' });
        assert.equal(res.status, 201);
        const req1 = (await res.json()).data.item;
        assert.equal(req1.mode, 'casting');
        assert.equal(req1.name, null);
        assert.equal(req1.status, 'กำลังหา');
        assert.equal(req1.headcount, 2);
        assert.equal(req1.requested_by_id, 7);
        assert.ok(!Number.isNaN(Date.parse(req1.requested_at)));
        assert.equal(req1.assignee_id, 55);
        assert.equal(req1.assignee_name, 'บีม');
        assert.equal(calls.logs[2].summary, 'ขอให้ช่วยหานักแสดง 2 คน — มอบให้ บีม');
    } finally {
        delete lookups['55'];
    }
    // ยังไม่เลือกคนช่วยหา (งบต่อคน 0 ได้)
    res = await post({ mode: 'casting', kind: 'นางแบบ', headcount: 1, fee: 0, assignee_id: '' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.item.assignee_id, null);
    assert.equal(calls.logs[3].summary, 'ขอให้ช่วยหานางแบบ 1 คน — ยังไม่ได้เลือกคนช่วยหา');

    // งานจบแล้ว: คนที่มีตัวแล้วยังบันทึกเพิ่มได้ (เก็บตกหลังงาน)
    db.status = 'Completed';
    assert.equal((await post({ mode: 'direct', kind: 'ช่างภาพ', name: 'ต้น', fee: 1000, status: 'ส่งงานแล้ว' })).status, 201);

    // member ของแบรนด์นี้ทำได้เหมือนทีม
    db.status = 'Active';
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    assert.equal((await post({ mode: 'direct', kind: 'นางแบบ', name: 'ส้ม' })).status, 201);
    assert.equal(calls.add, 6);
    assert.equal(calls.logs.length, 6, 'บันทึกประวัติครั้งละ 1 รายการ เฉพาะครั้งที่สำเร็จ');
    assert.equal(db.hire_items.length, 7);
});

test('POST /api/projects/:id/hires refuses the wrong job, closed jobs, bad finders and users outside the brand', async () => {
    user();
    const { db, calls } = talentJob();
    const post = (body, id = 63) => send('POST', `/api/projects/${id}/hires`, body);
    const casting = { mode: 'casting', kind: 'นางแบบ', headcount: 1, fee: 1000 };
    const message = async res => (await res.json()).message;

    // ไม่มีงานนี้ → 404
    assert.equal((await post(casting, 64)).status, 404);
    // คนช่วยหาที่ไม่มีสิทธิ์แบรนด์เลย / member แบรนด์อื่น → 403 ก่อนถึง store
    user({ role: 'member', team_id: 2, brands: [] });
    assert.equal((await post(casting)).status, 403);
    user({ role: 'member', team_id: 2, brands: ['Jdent'] });
    assert.equal((await post(casting)).status, 403);
    assert.equal(calls.add, 0);
    user();

    // body ต้องเป็น object · ช่องที่ต้องมี
    assert.equal((await post([casting])).status, 400);
    let res = await post({ mode: 'casting', headcount: 2 });
    assert.equal(res.status, 400);
    assert.equal(await message(res), 'กรุณาระบุประเภทงาน');
    res = await post({ mode: 'direct', kind: 'นางแบบ' });
    assert.equal(res.status, 400);
    assert.equal(await message(res), 'กรุณาระบุชื่อคน');

    // คนช่วยหาไม่ถูกต้อง: ไม่มีผู้ใช้นี้ / บัญชีเอเจนซี่ / ปิดบัญชีแล้ว
    lookups['123'] = null;
    lookups['124'] = { id: 124, username: 'ag', role: 'agency', is_active: true, status: 'active' };
    lookups['125'] = { id: 125, username: 'off', role: 'member', is_active: false, status: 'active' };
    try {
        for (const id of [123, '124', 125]) {
            res = await post({ ...casting, assignee_id: id });
            assert.equal(res.status, 400, String(id));
            assert.equal(await message(res), 'เลือกคนช่วยหาไม่ถูกต้อง');
        }
    } finally {
        delete lookups['123']; delete lookups['124']; delete lookups['125'];
    }
    assert.equal(calls.add, 0);

    // งาน KOL → 400
    db.campaign_type = 'kol';
    res = await post({ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ' });
    assert.equal(res.status, 400);
    assert.equal(await message(res), 'เพิ่มรายการจ้างได้เฉพาะงาน Talent');
    // งานจบแล้ว / ยกเลิก → ขอให้ช่วยหาเพิ่มไม่ได้
    db.campaign_type = 'other';
    for (const status of ['Completed', 'Cancelled']) {
        db.status = status;
        res = await post(casting);
        assert.equal(res.status, 409, status);
        assert.equal(await message(res), 'งานนี้จบแล้ว — ขอให้ช่วยหาเพิ่มไม่ได้');
    }
    assert.equal(calls.add, 0, 'ตีกลับก่อนเปิดทรานแซกชัน');

    // ด่านใต้ล็อก: งานเปลี่ยนระหว่างที่ route อ่านกับตอนล็อก → guard ตีกลับด้วยกติกาเดียวกัน
    db.status = 'Active';
    db.lockedStatus = 'Completed';
    assert.equal((await post(casting)).status, 409);
    db.lockedStatus = null;
    db.lockedType = 'kol';
    assert.equal((await post(casting)).status, 400);
    db.lockedType = null;
    // งานถูกลบระหว่างนั้น → 404
    store.projects.addHireItem = async () => null;
    assert.equal((await post(casting)).status, 404);
    assert.equal(calls.logs.length, 0, 'ไม่มีประวัติจากคำขอที่ไม่สำเร็จ');
});

test('saving the job form cannot mark a person agreed without a fee, but old rows stay saveable', async () => {
    user();
    const U = '2026-09-18T01:00:00.000Z';
    const stored = [
        { key: 'old', mode: 'direct', name: 'เก่า', fee: 0, status: 'ตกลงแล้ว' },   // ข้อมูลเก่าก่อนมีกติกานี้
        { key: 'b', mode: 'direct', name: 'บี', fee: 0, status: 'ทาบทาม' }
    ];
    const project = { id: 66, name: 'งานเดิม', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active', updated_at: U, hire_items: stored };
    let locked = structuredClone(stored);      // ค่าที่ทรานแซกชันเห็นใต้ล็อก
    let lockedAt = U;                          // updated_at ของแถวใต้ล็อก
    let calls = 0, written = null, writes = 0;
    store.projects.findByIdFull = async () => structuredClone(project);
    store.activity.log = async () => {};
    store.projects.updateWithHireItems = async (id, fields, expected, build) => {
        calls++;
        if (expected !== lockedAt) return { conflict: true };   // เหมือนของจริง: เช็คเวลาก่อนเรียก build
        const items = build(structuredClone(locked));
        if (!Array.isArray(items)) return null;
        written = items; writes++;
        return { row: { ...project, ...fields, hire_items: items }, items };
    };
    const put = hire_items => send('PUT', '/api/projects/66', { name: 'งานเดิม', expected_updated_at: U, hire_items });
    const edit = (key, patch) => stored.map(it => (it.key === key ? { ...it, ...patch } : it));

    // แถวเก่าที่ตกลงแล้วแต่ค่าตัว 0 ไม่ได้แตะ → บันทึกงานได้ตามปกติ
    assert.equal((await put(edit('b', { note: 'โทรแล้ว' }))).status, 200);
    // ตั้งบีเป็นตกลงแล้วโดยไม่มีค่าตัว → 400 ไม่เขียนอะไรลงฐาน
    let res = await put(edit('b', { status: 'ตกลงแล้ว' }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'ใส่ค่าตัวของ "บี" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้');
    // เพิ่มคนใหม่ที่ส่งงานแล้วแต่ไม่มีค่าตัว → 400
    res = await put([...stored, { mode: 'direct', kind: 'นางแบบ', name: 'ใหม่', status: 'ส่งงานแล้ว' }]);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'ใส่ค่าตัวของ "ใหม่" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้');
    assert.equal(writes, 1);
    // ใส่ค่าตัวแล้ว → ผ่าน
    assert.equal((await put(edit('b', { status: 'ตกลงแล้ว', fee: 1500 }))).status, 200);
    assert.equal(written.find(it => it.key === 'b').status, 'ตกลงแล้ว');
    assert.equal(writes, 2);

    // หน้าที่เปิดค้าง (ถือข้อมูลเก่า) ต้องได้ 409 ให้โหลดใหม่ ไม่ใช่ 400 เรื่องแถวที่ตัวเองไม่ได้แตะ
    // (คนอื่นเพิ่งใส่ค่าตัวให้ "เก่า" ไปแล้ว หน้านี้ยังเห็นเป็น 0 แล้วแก้แค่หมายเหตุของบี)
    lockedAt = '2026-09-18T02:00:00.000Z';
    locked = stored.map(it => (it.key === 'old' ? { ...it, fee: 3000 } : it));
    project.hire_items = structuredClone(locked);
    res = await put(edit('b', { note: 'แก้หมายเหตุ' }));
    assert.equal(res.status, 409);
    assert.equal(writes, 2);
    lockedAt = U;
    locked = structuredClone(stored);
    project.hire_items = stored;

    // ตรวจซ้ำใต้ล็อก: ค่าที่ route อ่านไว้บอกว่าบี "ตกลงแล้ว ค่าตัว 0" อยู่แล้ว (ผ่านด่านแรก)
    // แต่ของล่าสุดใต้ล็อกบีเป็นกำลังคุย → ครั้งนี้คือการตั้งเป็นตกลงแล้วจริง ต้องไม่ผ่าน
    project.hire_items = edit('b', { status: 'ตกลงแล้ว' });
    locked = edit('b', { status: 'ทาบทาม' });
    res = await put(edit('b', { status: 'ตกลงแล้ว' }));
    assert.equal(res.status, 400);
    assert.equal(writes, 2);
});

test('creating a Talent job with an agreed person needs a fee', async () => {
    user();
    let created = 0;
    store.projects.create = async fields => { created++; return { id: 70, ...fields }; };
    store.activity.log = async () => {};
    const create = hire_items => send('POST', '/api/projects', {
        name: 'งานใหม่', brand: 'Beauterry', campaign_type: 'other', status: 'Active', creator: 'แพรว', hire_items });

    let res = await create([{ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', status: 'ตกลงแล้ว', fee: 0 }]);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'ใส่ค่าตัวของ "มะลิ" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้');
    assert.equal(created, 0);

    res = await create([{ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', status: 'ตกลงแล้ว', fee: 4000 }]);
    assert.equal(res.status, 201);
    const data = (await res.json()).data;
    assert.equal(data.status, 'Active', 'ฟอร์มสั้นส่งสถานะงานมาได้');
    assert.equal(data.creator, 'แพรว', 'ผู้ดูแลงานที่เลือกในฟอร์มสั้น');
    assert.equal(data.budget, 4000);

    // กำลังคุยไม่มีค่าตัว + ขอให้ช่วยหางบ 0 → สร้างได้
    res = await create([{ mode: 'direct', kind: 'นางแบบ', name: 'มะลิ' }, { mode: 'casting', kind: 'นักแสดง', headcount: 2, fee: 0 }]);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.hire_items[1].requested_by_id, 7);
    assert.equal(created, 2);
});

test('one-click booking confirm on a person with no fee is refused with a clear message', async () => {
    user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
    let saved = [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 0, headcount: 1, filled: 1, assignee_id: 55,
          candidates: [{ key: 'c1', name: 'มะลิ', status: 'เลือกแล้ว' }] },
        { key: 'p0', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 0, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c1',
          booking: { state: 'pending' } }
    ];
    const logs = [];
    store.projects.findByIdFull = async () => ({ id: 65, name: 'งานจ้าง', brand: 'Beauterry', team_id: 1, campaign_type: 'other',
        status: 'Active', hire_items: saved });
    store.projects.patchHireItems = async (id, key, fn) => {
        const row = saved.find(it => it.key === key);
        if (!row) return null;
        const next = fn(structuredClone(row), structuredClone(saved));
        if (!Array.isArray(next)) return null;
        saved = next;
        return structuredClone(next);
    };
    store.activity.log = async entry => { logs.push(entry); };
    const confirm = body => send('POST', '/api/projects/65/hires/r1/bookings/p0/confirm', body);

    let res = await confirm({});
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { status: 'error', message: 'ใส่ค่าตัวที่ตกลงจริงก่อนยืนยันคิว' });
    assert.equal(saved[1].booking.state, 'pending');
    assert.equal(saved[1].status, 'ทาบทาม');
    assert.equal(logs.length, 0);

    // ใส่ค่าตัวจริงมา → รอทีมตัดสินค่าตัวใหม่ (ตอนเลือกไม่มีค่าตัวที่ตกลงไว้)
    res = await confirm({ fee: 3000 });
    assert.equal(res.status, 200);
    assert.equal(saved[1].booking.state, 'fee_review');
    assert.equal(logs[0].summary, 'ยืนยันคิว มะลิ — ขอค่าตัวใหม่ ฿3,000 (ตกลงไว้ ฿0) รอทีมตัดสิน');
});

test('the menu badge count skips user names, and job status history uses the new words', async () => {
    user();
    const seen = [];
    const origTasks = store.hires.tasks;
    store.hires.tasks = async opts => { seen.push(opts); return { counts: { total: 2 }, rows: [] }; };
    try {
        const count = await send('GET', '/api/hires/tasks/count');
        assert.equal(count.status, 200);
        assert.deepEqual((await count.json()).data, { total: 2 });
        assert.equal(seen[0].withNames, false, 'เรียกทุก 60 วินาที — ไม่ต้องโหลดชื่อ');
        assert.equal((await send('GET', '/api/hires/tasks')).status, 200);
        assert.notEqual(seen[1].withNames, false, 'หน้ารายการใบต้องมีชื่อคนขอ');
    } finally {
        store.hires.tasks = origTasks;
    }

    const logs = [];
    store.projects.findByIdFull = async () => ({ id: 67, name: 'งาน', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active' });
    store.projects.update = async (id, fields) => ({ id: 67, name: 'งาน', team_id: 1, ...fields });
    store.activity.log = async entry => { logs.push(entry); };
    for (const [status, label] of [['Completed', 'จบแล้ว'], ['Active', 'กำลังทำ'], ['Draft', 'กำลังทำ'], ['Cancelled', 'ยกเลิก']]) {
        assert.equal((await send('PUT', '/api/projects/67', { status })).status, 200);
        assert.equal(logs.pop().summary, `เปลี่ยนสถานะเป็น ${label}`);
    }
    // แคมเปญ KOL ยังใช้คำเดิม (หน้า KOL มีตัวเลือก ร่าง / เสร็จสิ้น)
    store.projects.findByIdFull = async () => ({ id: 67, name: 'งาน', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', status: 'Active' });
    for (const [status, label] of [['Completed', 'เสร็จสิ้น'], ['Draft', 'ร่าง']]) {
        assert.equal((await send('PUT', '/api/projects/67', { status })).status, 200);
        assert.equal(logs.pop().summary, `เปลี่ยนสถานะเป็น ${label}`);
    }
});
