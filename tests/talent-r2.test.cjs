const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Talent รอบ 2 "หน้างานและเงิน" (ฝั่ง server)
// · แก้คน 1 คนในงาน (PATCH /api/projects/:id/hires/:key/person) — ปุ่ม "ถัดไป" / เลิกทำ / ลิ้นชักคน
// · การ์ดงานได้ความคืบหน้า (progress) และกล่องสรุปเงิน/ตำแหน่งจาก GET /api/hires/jobs
// · หน้างานโหลดเฉพาะใบขอให้หาของงานตัวเอง (GET /api/hires/tasks?project=)
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-r2-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-r2 test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
const noConnect = pool.connect;

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
const { projects: pgProjects } = require(path.join(SRC, 'store/pg/projects'));
const { hires: pgHires } = require(path.join(SRC, 'store/pg/hires'));
// เก็บตัวจริงไว้ก่อน — เทสต์ของ route สลับเมธอดบน store (เป็น object เดียวกัน)
const realUpdateHireRow = pgProjects.updateHireRow;
const realTasks = pgHires.tasks;
const realJobs = pgHires.jobs;
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let server, base, account;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);
// วันนี้ตามเวลาไทย — สูตรเดียวกับ todayTH ใน store/pg/hires.js
const todayTH = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

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

// แถวคน 1 แถวแบบที่ฟอร์มสั้นสร้าง (newHireRow)
const P = (extra = {}) => ({
    key: 'p1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 0, status: 'ทาบทาม',
    contact: null, agency: null, qty: null, use_date: null, use_time: null, place: null, link: null, note: null,
    image: null, booking: null, from_request: null, from_candidate: null, ...extra
});
const needFee = name => ({ error: { code: 400, message: `ใส่ค่าตัวของ "${name}" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้` } });

// ---------------------------------------------------------------- ตรรกะล้วน (personPatch)

test('personPatch: moving a person to agreed needs a fee, but old agreed rows with no fee can still be edited', () => {
    const { personPatch } = logic;
    // กำลังคุย → ตกลงแล้ว / ขั้นหลังจากนั้น โดยไม่มีค่าตัว → ติด
    assert.deepEqual(personPatch(P(), { status: 'ตกลงแล้ว' }, { status: 'ทาบทาม' }), needFee('มะลิ'));
    for (const fee of [0, '', null, -1, 'abc']) {
        assert.deepEqual(personPatch(P(), { status: 'ถ่ายเสร็จ', fee }, {}), needFee('มะลิ'), String(fee));
    }
    // ใส่ค่าตัวพร้อมกัน → ผ่าน · เขียนเฉพาะช่องที่เปลี่ยน ช่องอื่นคงเดิม
    const ok = personPatch(P({ note: 'เดิม' }), { status: 'ตกลงแล้ว', fee: '3000' }, { status: 'ทาบทาม', fee: 0 });
    assert.deepEqual(ok.changed, ['fee', 'status']);
    assert.equal(ok.row.status, 'ตกลงแล้ว');
    assert.equal(ok.row.fee, 3000);
    assert.equal(ok.row.note, 'เดิม');
    assert.equal(ok.row.key, 'p1');

    // ตกลงแล้ว (มีค่าตัว) → ถ่ายเสร็จ · ย้อนกลับ (เลิกทำ) ได้
    const agreed = P({ status: 'ตกลงแล้ว', fee: 3000 });
    assert.equal(personPatch(agreed, { status: 'ถ่ายเสร็จ' }, { status: 'ตกลงแล้ว' }).row.status, 'ถ่ายเสร็จ');
    assert.equal(personPatch(agreed, { status: 'ทาบทาม' }, { status: 'ตกลงแล้ว' }).row.status, 'ทาบทาม');
    // ล้างค่าตัวของคนที่ตกลงแล้ว → ติด
    assert.deepEqual(personPatch(agreed, { fee: 0 }, { fee: 3000 }), needFee('มะลิ'));
    // กำลังคุยไม่มีค่าตัว แก้ค่าตัวเป็น 0 ได้ (ยังไม่ตกลง)
    assert.ok(personPatch(P({ fee: 500 }), { fee: 0 }, {}).row);

    // แถวเก่า: ตกลงแล้วแต่ค่าตัว 0 อยู่ก่อนแล้ว → แก้ช่องอื่นได้ · ส่งค่าตัวเดิม (0 / ว่าง) มาด้วยก็ไม่นับว่าเปลี่ยน
    const legacy = P({ status: 'ตกลงแล้ว', fee: 0 });
    const note = personPatch(legacy, { note: 'โทรแล้ว', fee: '' }, { note: null, fee: 0 });
    assert.deepEqual(note.changed, ['note']);
    assert.equal(note.row.note, 'โทรแล้ว');
    assert.equal(note.row.status, 'ตกลงแล้ว');
    // แต่เลื่อนขั้นต่อทั้งที่ยังไม่มีค่าตัว → ติด
    assert.deepEqual(personPatch(legacy, { status: 'ถ่ายเสร็จ' }, {}), needFee('มะลิ'));
    // ข้อความบอกชื่อหลังแก้ · ไม่มีชื่อเลยใช้ประเภทงาน
    assert.deepEqual(personPatch(P(), { name: 'ชบา', status: 'ตกลงแล้ว' }, {}), needFee('ชบา'));
    assert.deepEqual(personPatch(P({ name: null }), { status: 'ตกลงแล้ว' }, {}), needFee('นางแบบ'));
});

test('personPatch: a page that saw old values gets STALE before any other check', () => {
    const { personPatch } = logic;
    const row = P({ fee: 1500, status: 'ทาบทาม', place: 'สตูดิโอ A' });
    const stale = { error: { code: 409, stale: true, message: 'ข้อมูลของ มะลิ เพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว ตรวจแล้วบันทึกอีกครั้ง' } };
    assert.deepEqual(personPatch(row, { status: 'ถ่ายเสร็จ' }, { status: 'ตกลงแล้ว' }), stale);
    assert.deepEqual(personPatch(row, { fee: 2000 }, { fee: 1000 }), stale);
    // expect ของช่องที่ไม่ได้แก้ก็เทียบด้วย (หน้าเว็บส่งค่าที่เห็นมา = ต้องเป็นของล่าสุด)
    assert.deepEqual(personPatch(row, { note: 'x' }, { note: null, place: 'สตูดิโอ B' }), stale);
    // หน้าที่ถือข้อมูลเก่าต้องได้ 409 ให้โหลดใหม่ ไม่ใช่ 400 เรื่องค่าที่ส่งมา
    assert.deepEqual(personPatch(row, { status: 'อะไร', name: '' }, { status: 'ถ่ายเสร็จ' }), stale);
    // ต่างแค่รูปแบบ = ค่าเดียวกัน: ค่าตัว '1500.00' · ข้อความว่าง = null · ช่องว่างหัวท้าย · สถานะว่าง/ไม่รู้จัก = กำลังคุย
    assert.ok(personPatch(row, { fee: 1600 }, { fee: '1500.00' }).row);
    assert.ok(personPatch(row, { note: 'x' }, { note: '   ' }).row);
    assert.ok(personPatch(row, { note: 'x' }, { place: '  สตูดิโอ A ' }).row);
    assert.ok(personPatch(P({ status: '' }), { note: 'x' }, { status: 'ทาบทาม' }).row);
    assert.ok(personPatch(P({ status: 'อะไรไม่รู้' }), { note: 'x' }, { status: '' }).row);
    assert.ok(personPatch(P({ use_date: '2026-09-20' }), { note: 'x' }, { use_date: '2026-09-20' }).row);
    assert.deepEqual(personPatch(P({ use_date: '2026-09-20' }), { note: 'x' }, { use_date: '2026-09-21' }), stale);
    // ไม่ส่ง expect / ช่องที่ไม่รู้จักใน expect = ไม่เทียบ
    assert.ok(personPatch(row, { note: 'x' }).row);
    assert.ok(personPatch(row, { note: 'x' }, { image: 'อะไรก็ได้', updated_at: 'เก่า' }).row);
});

test('personPatch: while a booking is open only the status is locked, and only if the request still exists', () => {
    const { personPatch } = logic;
    const booked = P({ fee: 5000, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c1',
        booking: { state: 'pending', approved_by: 'แพรว' } });
    const lock = { error: { code: 409, message: 'คนนี้ยังรอยืนยันคิวในใบขอให้หา — ยืนยันคิวในใบก่อน' } };
    for (const status of ['ตกลงแล้ว', 'ถ่ายเสร็จ']) {
        assert.deepEqual(personPatch(booked, { status }, { status: 'ทาบทาม' }, { requestExists: true }), lock, status);
    }
    assert.deepEqual(personPatch({ ...booked, booking: { state: 'fee_review', requested_fee: 6000 } },
        { status: 'ตกลงแล้ว' }, {}, { requestExists: true }), lock);
    // ช่องอื่นแก้ได้ระหว่างรอ (รวมค่าตัว) — booking คงเดิม
    const edit = personPatch(booked, { place: 'สตูดิโอ B', use_time: '10:00', note: 'มาเช้า', fee: 5500 }, {}, { requestExists: true });
    assert.deepEqual(edit.changed, ['use_time', 'place', 'note', 'fee']);
    assert.deepEqual(edit.row.booking, booked.booking);
    assert.equal(edit.row.status, 'ทาบทาม');
    // ส่งสถานะเดิมมา = ไม่ได้เปลี่ยน → ไม่ติดล็อก
    assert.deepEqual(personPatch(booked, { status: 'ทาบทาม', note: 'x' }, {}, { requestExists: true }).changed, ['note']);
    // ไม่บอกว่าใบยังอยู่ = ถือว่าใบหายไปแล้ว · ใบหายไปแล้วตั้งสถานะเองได้ และปิดขั้นยืนยันคิวไปด้วย
    const orphan = personPatch(booked, { status: 'ตกลงแล้ว' }, { status: 'ทาบทาม' }, { requestExists: false });
    assert.equal(orphan.row.status, 'ตกลงแล้ว');
    assert.equal(orphan.row.booking.state, 'confirmed');
    assert.equal(orphan.row.booking.approved_by, 'แพรว');
    assert.equal(logic.jobProgress([orphan.row], 'Active').people.agreed, 1, 'ไม่ค้างรอยืนยันในความคืบหน้า');
    assert.equal(personPatch(booked, { status: 'ตกลงแล้ว' }, {}).row.status, 'ตกลงแล้ว');
    // ใบหายไปแล้วแต่ไม่มีค่าตัว → ยังติดกติกาค่าตัว
    assert.deepEqual(personPatch({ ...booked, fee: 0 }, { status: 'ตกลงแล้ว' }, {}), needFee('มะลิ'));
});

test('personPatch: validates every field and ignores what the page cannot set', () => {
    const { personPatch } = logic;
    const nothing = { error: { code: 400, message: 'ไม่มีอะไรให้บันทึก' } };
    for (const set of [undefined, null, {}, [], 'status', { status: undefined },
        { image: { filename: 'x.jpg' }, booking: { state: 'confirmed' }, key: 'zz', from_request: 'r9', mode: 'casting' }]) {
        assert.deepEqual(personPatch(P(), set, {}), nothing, JSON.stringify(set));
    }
    // ช่องของระบบที่ส่งปนมากับช่องจริงถูกทิ้ง
    const mixed = personPatch(P({ image: { filename: 'a.jpg' } }),
        { note: 'x', image: null, key: 'zz', booking: { state: 'confirmed' }, mode: 'casting', from_request: 'r9', candidates: [] }, {});
    assert.deepEqual(mixed.changed, ['note']);
    assert.equal(mixed.row.key, 'p1');
    assert.deepEqual(mixed.row.image, { filename: 'a.jpg' });
    assert.equal(mixed.row.booking, null);
    assert.equal(mixed.row.mode, 'direct');
    assert.equal(mixed.row.from_request, null);
    assert.equal(mixed.row.candidates, undefined);

    // สถานะต้องเป็นของคน (ไม่ใช่ของใบ / ภาษาอังกฤษ / ว่าง)
    for (const status of ['กำลังหา', 'เสนอชื่อแล้ว', 'Agreed', '', null, { x: 1 }]) {
        assert.deepEqual(personPatch(P(), { status }, {}), { error: { code: 400, message: 'สถานะไม่ถูกต้อง' } }, String(status));
    }
    // ชื่อ / ประเภทงานล้างเป็นว่างไม่ได้
    for (const name of ['', '   ', null, { a: 1 }]) {
        assert.deepEqual(personPatch(P(), { name }, {}), { error: { code: 400, message: 'กรุณาระบุชื่อคน' } }, String(name));
    }
    assert.deepEqual(personPatch(P(), { kind: ' ' }, {}), { error: { code: 400, message: 'กรุณาระบุประเภทงาน' } });
    // วันที่: ว่าง = ล้าง · ผิดรูป / ไม่มีจริง = ตีกลับ (ไม่ล้างวันเดิมเงียบ ๆ)
    assert.equal(personPatch(P({ use_date: '2026-09-20' }), { use_date: '' }, {}).row.use_date, null);
    assert.equal(personPatch(P({ use_date: '2026-09-20' }), { use_date: null }, {}).row.use_date, null);
    assert.equal(personPatch(P(), { use_date: ' 2026-09-25 ' }, {}).row.use_date, '2026-09-25');
    for (const d of ['2026-02-31', '25/09/2026', '2026-9-5', 20260925, { d: 1 }]) {
        assert.equal(personPatch(P({ use_date: '2026-09-20' }), { use_date: d }, {}).error.code, 400, String(d));
    }
    // ข้อความ: ตัดช่องว่าง + ความยาวเท่ากับตอนสร้าง · ว่าง = null · object ไม่กลายเป็น "[object Object]" · ตัวเลขเป็นข้อความ
    const t = personPatch(P({ note: 'เดิม', place: 'เดิม' }),
        { name: `  ${'ก'.repeat(250)}  `, note: '   ', place: { x: 1 }, contact: 812345678, link: 'x'.repeat(1200), qty: ' 2 วัน ' }, {}).row;
    assert.equal(t.name.length, 200);
    assert.equal(t.note, null);
    assert.equal(t.place, null);
    assert.equal(t.contact, '812345678');
    assert.equal(t.link.length, 1000);
    assert.equal(t.qty, '2 วัน');
    // ค่าตัวผ่าน cleanFee (ปัด 2 ตำแหน่ง / เพดาน 100 ล้าน)
    assert.equal(personPatch(P(), { fee: '1234.567' }, {}).row.fee, 1234.57);
    assert.equal(personPatch(P(), { fee: 1e12 }, {}).row.fee, 100000000);
    // ใบขอให้หาแก้ทางนี้ไม่ได้
    assert.deepEqual(personPatch({ key: 'r1', mode: 'casting', kind: 'x' }, { note: 'x' }, {}),
        { error: { code: 400, message: 'แก้ได้เฉพาะคนในงาน — ใบขอให้หาแก้ในใบ' } });
    // ส่งค่าเดิมทั้งหมด = ไม่มีอะไรเปลี่ยน แถวเหมือนเดิมทุกช่อง (ค่าในฐานไม่ถูกแปลงรูป)
    const same = personPatch(P({ fee: '1500', place: 'A', status: '' }), { fee: 1500, place: ' A ', status: 'ทาบทาม' }, {});
    assert.deepEqual(same.changed, []);
    assert.deepEqual(same.row, P({ fee: '1500', place: 'A', status: '' }));
});

// ---------------------------------------------------------------- store (ทรานแซกชันจำลอง)

test('updateHireRow edits one row under a row lock, recomputes the budget and only widens the job dates', async () => {
    let locked = null;
    const sql = [];
    // client จำลองของทรานแซกชัน — จดทุกคำสั่งไว้ตรวจ ไม่มีการต่อฐานจริง
    pool.connect = async () => ({
        query: async (text, params) => {
            const t = String(text).trim();
            sql.push({ text: t, params });
            if (t.startsWith('SELECT')) return { rows: locked ? [structuredClone(locked)] : [] };
            if (t.startsWith('UPDATE')) return { rows: [{ updated_at: params[4] }] };
            return { rows: [] };
        },
        release() {}
    });
    const update = () => sql.find(s => s.text.startsWith('UPDATE'));
    const job = extra => ({
        status: 'Active', campaign_type: 'other', start_date: '2026-09-10', end_date: '2026-09-12', updated_at: '2026-09-18T01:00:00.000Z',
        hire_items: [
            { key: 'h1', mode: 'direct', name: 'มะลิ', fee: 1000, status: 'ตกลงแล้ว' },
            { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 500, headcount: 3, filled: 1 },
            { key: 'h2', mode: 'direct', name: 'ชบา', fee: 0, status: 'ทาบทาม' }
        ],
        ...extra
    });
    const setRow = patch => (row => ({ row: { ...row, ...patch } }));
    try {
        locked = job();
        let seen = null;
        const out = await realUpdateHireRow.call(pgProjects, 72, 'h2', (row, items, info) => {
            seen = { row: structuredClone(row), count: items.length, info };
            items.splice(0);                                  // แก้สำเนาที่ได้มา ต้องไม่กระทบของที่เขียน
            return { row: { ...row, fee: 2500, status: 'ตกลงแล้ว', use_date: '2026-09-20', key: 'forged' } };
        }, { userId: 7 });
        assert.deepEqual(seen.info, { status: 'Active', campaign_type: 'other' }, 'ตัดสินจากค่าที่ล็อกไว้');
        assert.equal(seen.row.name, 'ชบา');
        assert.equal(seen.count, 3);
        assert.deepEqual(sql.map(s => s.text.split(/\s/)[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
        assert.match(sql[1].text, /FOR UPDATE/);
        assert.equal(sql[1].params[0], 72);
        assert.equal(out.item.key, 'h2', 'key ของแถวเปลี่ยนไม่ได้');
        assert.deepEqual(out.items.map(it => it.key), ['h1', 'r1', 'h2']);
        assert.deepEqual(out.items[2], out.item);
        assert.equal(out.item.fee, 2500);
        const p = update().params;
        assert.deepEqual(JSON.parse(p[0]), out.items);
        assert.equal(p[1], 1000 + 500 * 2 + 2500, 'งบ = ค่าตัวทุกคน + งบของคนที่ยังต้องหา');
        assert.deepEqual(p.slice(2, 4), ['2026-09-10', '2026-09-20'], 'ช่วงงานขยายให้ครอบวันใหม่');
        assert.equal(p[5], 7, 'แก้ล่าสุดโดยคนที่กด');
        assert.equal(p[6], 72);
        assert.equal(out.updated_at, p[4]);
        assert.ok(!Number.isNaN(Date.parse(p[4])));

        // วันก่อนวันเริ่ม → ขยายวันเริ่ม · ไม่มีวัน / วันผิดรูป → ช่วงเดิม · งานที่ยังไม่มีช่วง → ช่วงเท่ากับวันนั้น
        // ไม่รู้ว่าใครแก้ → คง updated_by เดิม
        for (const [extra, use_date, range] of [
            [{}, '2026-09-02', ['2026-09-02', '2026-09-12']],
            [{}, null, ['2026-09-10', '2026-09-12']],
            [{}, '20/09/2026', ['2026-09-10', '2026-09-12']],
            [{ start_date: null, end_date: null }, '2026-09-05', ['2026-09-05', '2026-09-05']]
        ]) {
            sql.length = 0;
            locked = job(extra);
            await realUpdateHireRow.call(pgProjects, '72', 'h1', setRow({ use_date, note: 'x' }), {});
            assert.deepEqual(update().params.slice(2, 4), range, String(use_date));
            assert.equal(update().params[5], null);
        }

        // build ตีกลับ → คืน error ตามนั้นทั้งก้อน ไม่มีการเขียน
        sql.length = 0;
        locked = job();
        const refused = { error: { code: 409, stale: true, message: 'เพิ่งเปลี่ยน' } };
        assert.deepEqual(await realUpdateHireRow.call(pgProjects, 72, 'h1', () => refused, {}), refused);
        assert.equal(update(), undefined);
        // แถวเหมือนเดิมทุกช่อง → ไม่เขียน ไม่ขยับ updated_at
        sql.length = 0;
        const same = await realUpdateHireRow.call(pgProjects, 72, 'h1', row => ({ row }), { userId: 7 });
        assert.equal(update(), undefined);
        assert.equal(same.updated_at, '2026-09-18T01:00:00.000Z');
        assert.deepEqual(same.items, job().hire_items);
        // build คืนอย่างอื่น → null ไม่เขียน
        for (const bad of [() => null, () => ({}), () => ({ row: [1] }), 'ไม่ใช่ฟังก์ชัน']) {
            sql.length = 0;
            assert.equal(await realUpdateHireRow.call(pgProjects, 72, 'h1', bad, {}), null);
            assert.equal(update(), undefined);
        }
        // ไม่มีแถวนี้ → null โดยไม่เรียก build
        let called = false;
        assert.equal(await realUpdateHireRow.call(pgProjects, 72, 'nope', () => { called = true; return null; }, {}), null);
        assert.equal(called, false);
        // ไม่มีงานนี้ / รายการจ้างว่าง / id ผิดรูป
        locked = null;
        assert.equal(await realUpdateHireRow.call(pgProjects, 72, 'h1', setRow({}), {}), null);
        locked = job({ hire_items: null });
        assert.equal(await realUpdateHireRow.call(pgProjects, 72, 'h1', setRow({}), {}), null);
        sql.length = 0;
        assert.equal(await realUpdateHireRow.call(pgProjects, 'abc', 'h1', setRow({}), {}), null);
        assert.equal(sql.length, 0, 'id ผิดรูปไม่แตะฐานเลย');
    } finally {
        pool.connect = noConnect;
    }
});

// ---------------------------------------------------------------- เส้น API: PATCH .../person

// งาน Talent จำลอง 1 งาน: ค่าที่ route อ่าน (findByIdFull) + ทรานแซกชันจำลองที่ updateHireRow ตัวจริงใช้
// calls.locked = ค่าใต้ล็อก (ตั้งให้ต่างจากที่ route อ่านไว้ได้ เหมือนมีคนแก้ระหว่างนั้น)
function talentJob(items) {
    const db = {
        id: 63, name: 'ถ่ายแบบ Sep', brand: 'Beauterry', team_id: 1, campaign_type: 'other', status: 'Active',
        start_date: '2026-09-10', end_date: '2026-09-12', updated_at: '2026-09-18T01:00:00.000Z', updated_by: 3, budget: 0,
        hire_items: structuredClone(items)
    };
    const calls = { connect: 0, sql: [], logs: [], locked: null };
    store.projects.findByIdFull = async id => (String(id) === String(db.id) ? structuredClone(db) : null);
    store.activity.log = async entry => { calls.logs.push(entry); };
    store.projects.updateHireRow = realUpdateHireRow;
    pool.connect = async () => {
        calls.connect++;
        return {
            query: async (text, params) => {
                const t = String(text).trim();
                calls.sql.push({ text: t, params });
                if (t.startsWith('SELECT')) {
                    if (Number(params[0]) !== db.id) return { rows: [] };
                    const src = calls.locked || db;
                    return { rows: [structuredClone({ hire_items: src.hire_items, status: src.status, campaign_type: src.campaign_type,
                        start_date: db.start_date, end_date: db.end_date, updated_at: db.updated_at })] };
                }
                if (t.startsWith('UPDATE')) {
                    db.hire_items = JSON.parse(params[0]);
                    db.budget = params[1];
                    db.start_date = params[2];
                    db.end_date = params[3];
                    db.updated_at = params[4];
                    if (params[5] != null) db.updated_by = params[5];
                    return { rows: [{ updated_at: params[4] }] };
                }
                return { rows: [] };
            },
            release() {}
        };
    };
    const writes = () => calls.sql.filter(s => s.text.startsWith('UPDATE')).length;
    return { db, calls, writes };
}

test('PATCH /api/projects/:id/hires/:key/person saves one person, logs once and answers with the fresh rows', async () => {
    user();
    const { db, calls, writes } = talentJob([
        P({ key: 'h1', name: 'มะลิ', fee: 0, status: 'ทาบทาม' }),
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 500, headcount: 2, filled: 0, candidates: [] },
        P({ key: 'h2', name: 'ชบา', kind: 'พิธีกร', fee: 2000, status: 'ตกลงแล้ว' })
    ]);
    const patch = (key, body) => send('PATCH', `/api/projects/63/hires/${key}/person`, body);
    try {
        // ปุ่ม "ใส่ค่าตัวแล้วตกลง": สถานะ + ค่าตัวพร้อมกัน
        let res = await patch('h1', { set: { status: 'ตกลงแล้ว', fee: 3000 }, expect: { status: 'ทาบทาม', fee: 0 } });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.status, 'success');
        assert.deepEqual(Object.keys(json.data).sort(), ['item', 'items', 'updated_at']);
        assert.equal(json.data.item.key, 'h1');
        assert.equal(json.data.item.status, 'ตกลงแล้ว');
        assert.equal(json.data.item.fee, 3000);
        assert.deepEqual(json.data.items, db.hire_items);
        assert.equal(json.data.updated_at, db.updated_at);
        assert.notEqual(db.updated_at, '2026-09-18T01:00:00.000Z');
        assert.equal(db.budget, 3000 + 500 * 2 + 2000, 'งบของงานคิดใหม่');
        assert.equal(db.updated_by, 7);
        assert.equal(calls.logs.length, 1);
        assert.equal(calls.logs[0].action, 'update');
        assert.equal(calls.logs[0].project_id, 63);
        assert.equal(calls.logs[0].project_name, 'ถ่ายแบบ Sep');
        assert.equal(calls.logs[0].team_id, 1);
        assert.equal(calls.logs[0].summary, 'อัปเดต มะลิ: สถานะ กำลังคุย → ตกลงแล้ว · ค่าตัว ฿0 → ฿3,000');

        // เลิกทำ: ส่งกลับโดย expect = ค่าใหม่ที่เพิ่งบันทึก (ค่าตัวคงอยู่)
        res = await patch('h1', { set: { status: 'ทาบทาม' }, expect: { status: 'ตกลงแล้ว' } });
        assert.equal(res.status, 200);
        assert.equal(db.hire_items[0].status, 'ทาบทาม');
        assert.equal(db.hire_items[0].fee, 3000);
        assert.equal(calls.logs[1].summary, 'อัปเดต มะลิ: สถานะ ตกลงแล้ว → กำลังคุย');

        // กดซ้ำด้วยค่าเดิม → 200 ไม่เขียน ไม่ลงประวัติ updated_at เดิม
        const at = db.updated_at;
        const n = writes();
        res = await patch('h1', { set: { status: 'ทาบทาม' }, expect: { status: 'ทาบทาม' } });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).data.updated_at, at);
        assert.equal(writes(), n);
        assert.equal(calls.logs.length, 2);

        // ลิ้นชักคน: หลายช่องพร้อมกัน · วันใหม่ขยายช่วงงาน · เบอร์ไม่ไปค้างในประวัติ
        res = await patch('h2', {
            set: { name: 'ชบาไพร', use_date: '2026-09-25', place: 'สตูดิโอ B', contact: '081-111-2222', note: 'มาเช้า' },
            expect: { name: 'ชบา', use_date: null, place: null, contact: null, note: null }
        });
        assert.equal(res.status, 200);
        const h2 = db.hire_items.find(it => it.key === 'h2');
        assert.equal(h2.name, 'ชบาไพร');
        assert.equal(h2.contact, '081-111-2222');
        assert.equal(h2.status, 'ตกลงแล้ว');
        assert.deepEqual([db.start_date, db.end_date], ['2026-09-10', '2026-09-25']);
        assert.equal(calls.logs[2].summary,
            'อัปเดต ชบาไพร: ชื่อ ชบา → ชบาไพร · วันที่ — → 2026-09-25 · สถานที่ — → สตูดิโอ B · แก้เบอร์/LINE · แก้หมายเหตุ');
        assert.ok(!calls.logs[2].summary.includes('081'));
        assert.equal(calls.logs.length, 3);
    } finally {
        pool.connect = noConnect;
    }
});

test('PATCH .../person refuses other brands, missing rows, requests, stale pages, no-fee agreements and locked bookings', async () => {
    user();
    const { db, calls } = talentJob([
        P({ key: 'h1', name: 'มะลิ', fee: 0, status: 'ทาบทาม' }),
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', fee: 500, headcount: 1, filled: 1, assignee_id: 55,
          candidates: [{ key: 'c1', name: 'กุหลาบ', status: 'เลือกแล้ว' }] },
        P({ key: 'p1', name: 'กุหลาบ', fee: 500, status: 'ทาบทาม', from_request: 'r1', from_candidate: 'c1', booking: { state: 'pending' } })
    ]);
    const patch = (key, body, id = 63) => send('PATCH', `/api/projects/${id}/hires/${key}/person`, body);
    const fail = async (res, status, message, code) => {
        assert.equal(res.status, status);
        const j = await res.json();
        assert.equal(j.status, 'error');
        if (message) assert.equal(j.message, message);
        assert.equal(j.code, code);
    };
    try {
        // คนช่วยหาที่ไม่มีสิทธิ์แบรนด์เลย / member แบรนด์อื่น → 403 ไม่เปิดทรานแซกชันเลย
        user({ role: 'member', team_id: 2, brands: [] });
        await fail(await patch('h1', { set: { note: 'x' } }), 403, 'ไม่มีสิทธิ์แก้ไขแคมเปญของแบรนด์อื่น');
        user({ role: 'member', team_id: 2, brands: ['Jdent'] });
        await fail(await patch('h1', { set: { note: 'x' } }), 403);
        assert.equal(calls.connect, 0);
        // member ของแบรนด์นี้ทำได้เหมือนทีม
        user({ role: 'member', team_id: 2, brands: ['Beauterry'] });
        assert.equal((await patch('h1', { set: { note: 'ทีมแบรนด์' }, expect: { note: null } })).status, 200);
        assert.equal(db.hire_items[0].note, 'ทีมแบรนด์');
        user();

        // ไม่มีงาน / ไม่มีแถว / เป็นใบขอให้หา
        await fail(await patch('h1', { set: { note: 'x' } }, 64), 404, 'ไม่พบ Project');
        await fail(await patch('nope', { set: { note: 'x' } }), 404, 'ไม่พบรายการนี้');
        await fail(await patch('r1', { set: { note: 'x' } }), 400, 'แก้ได้เฉพาะคนในงาน — ใบขอให้หาแก้ในใบ');
        // body / set ว่าง
        await fail(await patch('h1', [{ set: { note: 'x' } }]), 400, 'ข้อมูลไม่ถูกต้อง');
        for (const body of [{}, { set: {} }, { set: { image: null, booking: null, key: 'x' } }, { set: 'note' }, { set: [1] }]) {
            await fail(await patch('h1', body), 400, 'ไม่มีอะไรให้บันทึก');
        }
        const opened = calls.connect;
        // สถานะไม่ถูกต้อง / ตกลงแล้วไม่มีค่าตัว / รอยืนยันคิวในใบ
        await fail(await patch('h1', { set: { status: 'กำลังหา' } }), 400, 'สถานะไม่ถูกต้อง');
        await fail(await patch('h1', { set: { status: 'ตกลงแล้ว' }, expect: { status: 'ทาบทาม' } }), 400,
            'ใส่ค่าตัวของ "มะลิ" ก่อน จึงจะตั้งเป็น "ตกลงแล้ว" ได้');
        await fail(await patch('p1', { set: { status: 'ตกลงแล้ว' }, expect: { status: 'ทาบทาม' } }), 409,
            'คนนี้ยังรอยืนยันคิวในใบขอให้หา — ยืนยันคิวในใบก่อน');
        await fail(await patch('h1', { set: { use_date: '2026-02-31' } }), 400, 'วันที่ไม่ถูกต้อง (ต้องเป็น ปี-เดือน-วัน)');
        // หน้าที่เห็นค่าเก่า → 409 code STALE
        await fail(await patch('h1', { set: { fee: 2000 }, expect: { fee: 1500 } }), 409,
            'ข้อมูลของ มะลิ เพิ่งเปลี่ยน — โหลดค่าล่าสุดให้แล้ว ตรวจแล้วบันทึกอีกครั้ง', 'STALE');
        assert.ok(calls.connect > opened, 'กติกาตัดสินใต้ล็อก');
        // ตัดสินจากค่าใต้ล็อก: route อ่านว่ายังกำลังคุย แต่ของล่าสุดมีคนตั้งเป็นตกลงแล้วไปก่อน
        calls.locked = { ...structuredClone(db),
            hire_items: db.hire_items.map(it => (it.key === 'h1' ? { ...it, status: 'ตกลงแล้ว', fee: 3000 } : it)) };
        await fail(await patch('h1', { set: { status: 'ตกลงแล้ว', fee: 3000 }, expect: { status: 'ทาบทาม', fee: 0 } }), 409, undefined, 'STALE');
        // ใบต้นทางถูกลบไปแล้วใต้ล็อก → ปลดล็อกสถานะ (ตั้งเองได้)
        calls.locked = { ...structuredClone(db), hire_items: db.hire_items.filter(it => it.key !== 'r1') };
        const freed = await patch('p1', { set: { status: 'ตกลงแล้ว' }, expect: { status: 'ทาบทาม' } });
        assert.equal(freed.status, 200);
        assert.equal((await freed.json()).data.item.booking.state, 'confirmed');
        // แถวหายระหว่างนั้น (ลบไปแล้วใต้ล็อก) → 404
        calls.locked = { ...structuredClone(db), hire_items: db.hire_items.filter(it => it.key !== 'h1') };
        await fail(await patch('h1', { set: { note: 'x' } }), 404, 'ไม่พบรายการนี้');
        // งาน KOL (ตั้งแต่แรก / ใต้ล็อก)
        calls.locked = { ...structuredClone(db), campaign_type: 'kol' };
        await fail(await patch('h1', { set: { note: 'x' } }), 400, 'แก้คนในงานได้เฉพาะงาน Talent');
        calls.locked = null;
        db.campaign_type = 'kol';
        await fail(await patch('h1', { set: { note: 'x' } }), 400, 'แก้คนในงานได้เฉพาะงาน Talent');
        db.campaign_type = 'other';
        assert.equal(calls.logs.length, 2, 'ลงประวัติเฉพาะครั้งที่สำเร็จ');
        assert.equal(db.hire_items.find(it => it.key === 'h1').status, 'ทาบทาม');
    } finally {
        pool.connect = noConnect;
    }
});

// ---------------------------------------------------------------- GET /hires/jobs (progress) · /hires/tasks?project=

const JOB_FIXTURE = () => ([
    { id: 81, name: 'งานเปิด A', brand: 'Jdent', status: 'Active', campaign_type: 'other', created_at: '2026-09-10T00:00:00.000Z', hire_items: [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', headcount: 3, filled: 1, fee: 1000, assignee_id: 7,
          candidates: [{ key: 'c1', name: 'รอเลือก', fee: 1000, status: 'เสนอ' }] },
        { key: 'p1', mode: 'direct', name: 'พี', fee: 2000, status: 'ทาบทาม', from_request: 'r1', booking: { state: 'pending' } },
        { key: 'd1', mode: 'direct', name: 'ดี', fee: 5000, status: 'ตกลงแล้ว' },
        { key: 'd2', mode: 'direct', name: 'ดีสอง', fee: 3000, status: 'ส่งงานแล้ว' },
        { key: 't1', mode: 'direct', name: 'ที', fee: 0, status: 'ทาบทาม' }
    ] },
    { id: 82, name: 'งานเปิด B', brand: 'Code Lab', status: 'Draft', campaign_type: 'other', created_at: '2026-09-11T00:00:00.000Z', hire_items: [
        { key: 'a', mode: 'direct', name: 'เอ', fee: 1500, status: 'ถ่ายเสร็จ' },
        { key: 'r9', mode: 'casting', kind: 'พิธีกร', headcount: 1, filled: 1, fee: 800, assignee_id: 7, candidates: [] }
    ] },
    { id: 83, name: 'งานจบแล้ว', brand: 'Jdent', status: 'Completed', campaign_type: 'other', created_at: '2026-09-12T00:00:00.000Z', hire_items: [
        { key: 'z', mode: 'direct', name: 'แซด', fee: 9000, status: 'ตกลงแล้ว' },
        { key: 'zr', mode: 'casting', kind: 'นางแบบ', headcount: 2, filled: 0, fee: 700, assignee_id: 7, candidates: [] }
    ] },
    { id: 84, name: 'แคมเปญ KOL', brand: 'Jdent', status: 'Active', campaign_type: 'kol', hire_items: [
        { key: 'k', mode: 'casting', kind: 'x', headcount: 1, filled: 0, fee: 1, assignee_id: 7 }
    ] }
]);

test('job list rows carry the same progress the job page computes, and the summary adds money and slots of open jobs', async () => {
    FIXTURE.other_projects = JOB_FIXTURE();
    try {
        const out = await realJobs.call(pgHires, {});
        const today = todayTH();
        assert.deepEqual(out.rows.map(r => r.id).sort(), [81, 82, 83]);
        for (const r of out.rows) {
            const p = FIXTURE.other_projects.find(x => x.id === r.id);
            assert.deepEqual(r.progress, logic.jobProgress(p.hire_items, p.status, today), `job ${r.id}`);
        }
        const a = out.rows.find(r => r.id === 81);
        assert.deepEqual(a.progress.money, { agreed: 8000, pending: 2000, unfilled: 2000 });
        assert.deepEqual(a.progress.todo.map(t => t.code), ['decide', 'confirm', 'finding', 'talking']);
        assert.deepEqual(a.progress.next, { code: 'decide', n: 1, keys: ['r1'] });
        assert.equal(out.rows.find(r => r.id === 83).progress.next.code, 'closed');
        // ช่องเดิมยังอยู่ครบ
        assert.equal(a.people_count, 4);
        assert.equal(a.remaining, 2);
        assert.equal(a.booking_pending, 1);
        assert.equal(out.summary.jobs, 3);
        assert.equal(out.summary.open_jobs, 2);
        assert.equal(out.summary.remaining, 2);
        assert.equal(out.summary.total_fee, (1000 * 2 + 2000 + 5000 + 3000) + (1500 + 0));
        // สรุปนับเฉพาะงานที่ยังไม่จบ (งานจบแล้ว ฿9,000 ไม่อยู่ในนี้)
        assert.deepEqual(out.summary.money, { agreed: 8000 + 1500, pending: 2000, unfilled: 2000 });
        assert.deepEqual(out.summary.slots, { agreed: 2 + 1, pending: 2, need: 2 });
        // สิทธิ์แบรนด์: เห็นเฉพาะ Jdent · ไม่มีแบรนด์ = ว่างและสรุปเป็น 0
        const scoped = await realJobs.call(pgHires, { scopeBrands: ['Jdent'] });
        assert.deepEqual(scoped.summary.money, { agreed: 8000, pending: 2000, unfilled: 2000 });
        assert.deepEqual(scoped.summary.slots, { agreed: 2, pending: 2, need: 2 });
        const none = await realJobs.call(pgHires, { scopeBrands: [] });
        assert.deepEqual(none.summary.money, { agreed: 0, pending: 0, unfilled: 0 });
        assert.deepEqual(none.summary.slots, { agreed: 0, pending: 0, need: 0 });

        // ผ่านเส้น API
        user();
        const res = await send('GET', '/api/hires/jobs');
        assert.equal(res.status, 200);
        const data = (await res.json()).data;
        assert.deepEqual(data.rows.find(r => r.id === 81).progress, a.progress);
        assert.deepEqual(data.summary.slots, out.summary.slots);
    } finally {
        FIXTURE.other_projects = [];
    }
});

test('the request list can be narrowed to one job while the badge counts still cover every request', async () => {
    FIXTURE.other_projects = JOB_FIXTURE();
    try {
        const all = await realTasks.call(pgHires, { userId: 7, scopeBrands: null });
        assert.deepEqual(all.rows.map(r => r.key).sort(), ['r1', 'r9', 'zr']);
        const one = await realTasks.call(pgHires, { userId: 7, scopeBrands: null, project: 81 });
        assert.deepEqual(one.rows.map(r => r.key), ['r1']);
        assert.deepEqual(one.rows[0], all.rows.find(r => r.key === 'r1'), 'แถวหน้าตาเดิม');
        assert.deepEqual(one.counts, all.counts, 'ตัวเลขแดงยังนับทุกใบ');
        assert.equal(one.summary.requests, 1);
        assert.equal(one.summary.people_needed, 2);
        assert.deepEqual((await realTasks.call(pgHires, { userId: 7, scopeBrands: null, project: '83' })).rows.map(r => r.key), ['zr']);
        assert.deepEqual((await realTasks.call(pgHires, { userId: 7, scopeBrands: null, project: 84 })).rows, [], 'งาน KOL ไม่มีใบ');
        assert.deepEqual((await realTasks.call(pgHires, { userId: 7, scopeBrands: null, project: 999 })).rows, []);
        assert.equal((await realTasks.call(pgHires, { userId: 7, scopeBrands: null, project: null })).rows.length, 3);
        // สิทธิ์เดิมยังใช้: คนช่วยหาที่ไม่มีแบรนด์เห็นเฉพาะใบที่ถูกมอบให้ แม้ขอทั้งงาน
        const finder = await realTasks.call(pgHires, { userId: 55, scopeBrands: [], project: 81 });
        assert.deepEqual(finder.rows, []);
    } finally {
        FIXTURE.other_projects = [];
    }

    // เส้น API: project ต้องเป็นตัวเลข · ว่าง = ไม่กรอง
    user();
    const seen = [];
    const origTasks = store.hires.tasks;
    store.hires.tasks = async opts => { seen.push(opts); return { summary: {}, counts: { total: 0 }, brands: [], rows: [] }; };
    try {
        assert.equal((await send('GET', '/api/hires/tasks?project=81')).status, 200);
        assert.equal(seen[0].project, 81);
        assert.equal((await send('GET', '/api/hires/tasks?project=')).status, 200);
        assert.equal(seen[1].project, null);
        assert.equal((await send('GET', '/api/hires/tasks')).status, 200);
        assert.equal(seen[2].project, null);
        for (const bad of ['abc', '1.5', '-3', '99999999999', '81&project=82', '0x10']) {
            const res = await send('GET', `/api/hires/tasks?project=${bad}`);
            assert.equal(res.status, 400, bad);
            assert.equal((await res.json()).message, 'รหัสงานไม่ถูกต้อง');
        }
        assert.equal(seen.length, 3, 'ค่าที่ไม่ถูกต้องไม่ถึง store');
        // เส้นนับเลขแดงไม่เปลี่ยน
        assert.equal((await send('GET', '/api/hires/tasks/count?project=abc')).status, 200);
        assert.equal(seen[3].project, undefined);
    } finally {
        store.hires.tasks = origTasks;
    }
});

// ---------------------------------------------------------------- เส้นเปิดรูป/คลิป (อ่านแค่งานเดียว)

test('opening comp cards reads only that job, keeps the brand / finder permissions, and never loads the whole database', async () => {
    const file = 'r2-thumb-test.png';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, file), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const job = {
        id: 81, brand: 'Beauterry', campaign_type: 'other', hire_items: [
            P({ key: 'd1', image: { filename: file, original: 'a.png' } }),
            P({ key: 'd2' }),
            { key: 'r1', mode: 'casting', kind: 'นางแบบ', headcount: 1, filled: 0, fee: 1000, assignee_id: 55,
              candidates: [{ key: 'c1', name: 'ชบา', status: 'เสนอ', by_id: 55, image: { filename: file }, video: { filename: file } }] }
        ]
    };
    const origFull = store.projects.findByIdFull;
    const origFiles = store.projects.findHireFiles;
    let lite = 0;
    store.projects.findByIdFull = async () => { throw new Error('image routes must not load the whole database'); };
    store.projects.findHireFiles = async id => { lite++; return Number(id) === 81 ? structuredClone(job) : null; };
    const get = (url, token = adminToken) => fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` } });
    try {
        user();
        assert.equal((await get('/api/projects/81/hires/d1/image')).status, 200);
        assert.equal((await get('/api/projects/81/hires/d2/image')).status, 404);          // ยังไม่มีรูป
        assert.equal((await get('/api/projects/99/hires/d1/image')).status, 404);          // ไม่มีงานนี้
        assert.equal((await get('/api/projects/81/hires/r1/candidates/c1/image')).status, 200);
        assert.equal((await get('/api/projects/81/hires/r1/candidates/c1/video')).status, 200);
        // แบรนด์อื่น: รูปของงานนี้ 403 ทั้งสองแบบ
        user({ role: 'member', team_id: 2, brands: ['Jdent'] });
        assert.equal((await get('/api/projects/81/hires/d1/image')).status, 403);
        assert.equal((await get('/api/projects/81/hires/r1/candidates/c1/image')).status, 403);
        // คนช่วยหาที่ไม่มีแบรนด์: ดูรูปชื่อที่เสนอในใบที่ตัวเองได้รับมอบหมายได้ แต่รูปคนในงานไม่ได้
        const finder = jwt.sign({ id: 55, role: 'member', team_id: 2 }, process.env.JWT_SECRET);
        user({ id: 55, role: 'member', team_id: 2, brands: [] });
        assert.equal((await get('/api/projects/81/hires/r1/candidates/c1/image', finder)).status, 200);
        assert.equal((await get('/api/projects/81/hires/d1/image', finder)).status, 403);
        const stranger = jwt.sign({ id: 56, role: 'member', team_id: 2 }, process.env.JWT_SECRET);
        user({ id: 56, role: 'member', team_id: 2, brands: [] });
        assert.equal((await get('/api/projects/81/hires/r1/candidates/c1/image', stranger)).status, 403);
        assert.ok(lite >= 10);
    } finally {
        store.projects.findByIdFull = origFull;
        store.projects.findHireFiles = origFiles;
    }
});
