const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// PUT /api/auth/profile — เจ้าของบัญชีแก้ชื่อที่แสดง + ชื่อล็อกอินของตัวเอง (28 ต.ค. 2026) · server จริง + store จำลอง (ไม่ต่อฐาน)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-self-profile-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in self-profile test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const HASH = bcrypt.hashSync('right-pass-1', 4);
const base0 = { status: 'active', is_active: true, team_id: 2, team_name: 'Reviewer', brands: ['Jernis'], agency_tokens: [], password_hash: HASH };
let ACCOUNTS;
const reset = () => {
    ACCOUNTS = {
        1: { ...base0, id: 1, username: 'praewpraew', full_name: null, nickname: null, role: 'admin', team_id: 1, team_name: 'Admin' },
        2: { ...base0, id: 2, username: 'Sai', full_name: null, nickname: null, role: 'member' },
        3: { ...base0, id: 3, username: 'mook', full_name: 'Mook', nickname: null, role: 'member' },
        4: { ...base0, id: 4, username: 'agencyA', full_name: null, nickname: 'Fern', role: 'agency', team_id: null, team_name: null },
        5: { ...base0, id: 5, username: 'oldguy', full_name: null, nickname: 'Oum', role: 'member', is_active: false },
        6: { ...base0, id: 6, username: 'newbie', full_name: null, nickname: null, role: 'member', status: 'pending' }
    };
};
reset();
const UPDATES = [], LOGS = [];
let failUpdate = null;
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
store.users.listWithTeam = async () => Object.values(ACCOUNTS).map(({ password_hash, ...u }) => ({ ...u }));
store.users.update = async (id, fields) => {
    if (failUpdate) { const e = failUpdate; failUpdate = null; throw e; }
    UPDATES.push({ id, fields });
    Object.assign(ACCOUNTS[Number(id)], fields);
    const { password_hash, ...safe } = ACCOUNTS[Number(id)];
    return safe;
};
store.activity.log = async e => { LOGS.push(e); return e; };
const CREATED = [];
store.users.create = async u => { CREATED.push(u); const { password_hash, ...safe } = { ...u, id: 90 + CREATED.length }; return safe; };

let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const tokenOf = id => jwt.sign({ id, username: ACCOUNTS[id].username, role: ACCOUNTS[id].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const put = (uid, body) => fetch(base + '/api/auth/profile', {
    method: 'PUT',
    headers: { ...(uid ? { Authorization: `Bearer ${tokenOf(uid)}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});
const msg = async r => (await r.json()).message;

test('แก้ชื่อที่แสดงอย่างเดียว ไม่ต้องใส่รหัส · ช่องว่างซ้อนถูกรวบ · ตอบข้อมูลบัญชีใหม่ (ไม่มี password_hash) · ลงประวัติ', async () => {
    reset(); UPDATES.length = 0; LOGS.length = 0;
    const r = await put(1, { nickname: '  แพรว    ส. ' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.user.nickname, 'แพรว ส.');
    assert.equal(j.user.username, 'praewpraew');
    assert.equal(j.user.password_hash, undefined);
    assert.deepEqual(UPDATES, [{ id: 1, fields: { nickname: 'แพรว ส.' } }]);
    assert.equal(LOGS.length, 1);
    assert.equal(LOGS[0].user_id, 1);
    assert.equal(LOGS[0].summary, 'แก้บัญชีของตัวเอง: ชื่อที่แสดง "praewpraew" → "แพรว ส."');
});

test('เปลี่ยนชื่อล็อกอิน: ไม่ใส่รหัส = 400 · รหัสผิด = 401 · ถูก = 200 (ล็อกอินด้วยชื่อใหม่ได้ทันที)', async () => {
    reset(); UPDATES.length = 0; LOGS.length = 0;
    let r = await put(2, { username: 'sai.k' });
    assert.equal(r.status, 400);
    assert.match(await msg(r), /รหัสผ่านปัจจุบัน/);
    r = await put(2, { username: 'sai.k', current_password: 'wrong-pass' });
    assert.equal(r.status, 401);
    assert.equal(UPDATES.length, 0);
    r = await put(2, { username: '  sai.k ', current_password: 'right-pass-1' });
    assert.equal(r.status, 200);
    assert.deepEqual(UPDATES, [{ id: 2, fields: { username: 'sai.k' } }]);
    // ไม่มีชื่อเล่น/ชื่อเต็ม = ชื่อที่แสดงเปลี่ยนตาม username
    assert.equal(LOGS.at(-1).summary, 'แก้บัญชีของตัวเอง: ชื่อที่แสดง "Sai" → "sai.k" · ชื่อล็อกอิน Sai → sai.k');
    // token เดิมยังใช้ได้ (server อ่านบัญชีจาก id ทุกคำขอ)
    const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${jwt.sign({ id: 2, username: 'Sai', role: 'member' }, process.env.JWT_SECRET)}` } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.username, 'sai.k');
});

test('ชื่อล็อกอินซ้ำคนอื่น (ไม่สนตัวพิมพ์) = 409 · รหัสผิดตอบ 401 ก่อน (ไล่ลองชื่อที่มีในระบบไม่ได้) · ชนจังหวะพอดีในฐาน = 409', async () => {
    reset(); UPDATES.length = 0;
    let r = await put(2, { username: 'MOOK', current_password: 'wrong-pass' });
    assert.equal(r.status, 401);
    r = await put(2, { username: 'MOOK', current_password: 'right-pass-1' });
    assert.equal(r.status, 409);
    assert.match(await msg(r), /ชื่อล็อกอินนี้/);
    r = await put(2, { username: 'AgencyA', current_password: 'right-pass-1' });
    assert.equal(r.status, 409, 'username ของเอเจนซี่ก็ห้ามซ้ำ');
    failUpdate = Object.assign(new Error('dup'), { code: '23505' });
    r = await put(2, { username: 'brand-new', current_password: 'right-pass-1' });
    assert.equal(r.status, 409);
    assert.equal(UPDATES.length, 0);
});

test('ชื่อที่แสดงซ้ำคนในทีมที่ใช้งานอยู่ = 409 · ซ้ำเอเจนซี่ / บัญชีที่ปิดแล้ว ได้ · เปลี่ยนตัวพิมพ์ชื่อตัวเองได้', async () => {
    reset(); UPDATES.length = 0;
    let r = await put(2, { nickname: 'mook' });
    assert.equal(r.status, 409, 'ชนชื่อเต็ม Mook');
    assert.match(await msg(r), /มีคนใช้ชื่อ "mook" แล้ว/);
    r = await put(2, { nickname: 'PRAEWPRAEW' });
    assert.equal(r.status, 409, 'ชน username ที่ใช้เป็นชื่อที่แสดง');
    // เปลี่ยน username จนชื่อที่แสดงไปชนคนอื่น ก็ไม่ได้
    ACCOUNTS[3].full_name = null; ACCOUNTS[3].nickname = 'saiko';
    r = await put(2, { username: 'saiko', current_password: 'right-pass-1' });
    assert.equal(r.status, 409);
    reset();
    assert.equal((await put(2, { nickname: 'Fern' })).status, 200, 'เอเจนซี่ชื่อ Fern ไม่นับ');
    assert.equal((await put(3, { nickname: 'oum' })).status, 200, 'บัญชีที่ปิดแล้วไม่นับ');
    assert.equal((await put(3, { nickname: 'OUM' })).status, 200, 'เปลี่ยนตัวพิมพ์ชื่อตัวเอง');
    assert.equal(ACCOUNTS[3].nickname, 'OUM');
});

test('ตัวที่มองไม่เห็น / ตัวเต็มความกว้าง / ช่องว่างซ้อน ใช้หลบกติกาชื่อซ้ำไม่ได้ (ผลรีวิว 28 ต.ค.)', async () => {
    reset(); UPDATES.length = 0;
    // ชื่อที่แสดง: ตัด zero-width ทิ้งก่อนเก็บ → ชนชื่อ Mook
    let r = await put(2, { nickname: 'Mo​ok⁠' });
    assert.equal(r.status, 409);
    assert.match(await msg(r), /มีคนใช้ชื่อ "Mook" แล้ว/);
    assert.equal((await put(2, { nickname: 'Ｍｏｏｋ' })).status, 409, 'Ｍｏｏｋ ตัวเต็มความกว้าง');
    assert.equal((await put(2, { nickname: '‮Mook' })).status, 409, 'ตัวกลับทิศ');
    r = await put(2, { nickname: '​‍' });
    assert.equal(r.status, 400, 'มีแต่ตัวมองไม่เห็น = ว่าง');
    // ชื่อของคนอื่นที่เก็บไว้มีช่องว่างซ้อน ก็ยังนับว่าซ้ำ
    ACCOUNTS[3].nickname = 'Som  Chai';
    assert.equal((await put(2, { nickname: 'som chai' })).status, 409);
    assert.equal(UPDATES.length, 0);
    // เก็บแบบตัดตัวมองไม่เห็นแล้ว
    assert.equal((await put(2, { nickname: 'ฝน​ ส.' })).status, 200);
    assert.equal(ACCOUNTS[2].nickname, 'ฝน ส.');
    // ชื่อล็อกอิน: ตัวมองไม่เห็น = 400 (พิมพ์ตอนล็อกอินไม่ได้) · ตัวเต็มความกว้างชนคนอื่น = 409
    r = await put(2, { username: 'sai​', current_password: 'right-pass-1' });
    assert.equal(r.status, 400);
    assert.match(await msg(r), /มองไม่เห็น/);
    assert.equal((await put(2, { username: 'ｍｏｏｋ', current_password: 'right-pass-1' })).status, 409);
    // รอบ 2: ตัวที่ระบบไม่วาด (ตัวเติมเกาหลี / CGJ / variation selector / ช่องว่างเบรลล์) ก็ใช้หลบไม่ได้
    reset(); UPDATES.length = 0;
    for (const v of ['Mookㅤ', 'Mook͏', 'Mook️', 'Mook⠀', 'Mookﾠ']) {
        assert.equal((await put(2, { nickname: v })).status, 409, JSON.stringify(v));
    }
    for (const v of ['ㅤ', '⠀', '͏', '🌸', '...']) {
        r = await put(2, { nickname: v });
        assert.equal(r.status, 400, JSON.stringify(v));
    }
    assert.match(await msg(r), /ตัวอักษรหรือตัวเลข/);
    assert.equal(UPDATES.length, 0);
    // อีโมจิที่ต่อกันด้วย ZWJ ไม่แตก · ไทยสระบน/ล่างไม่เพี้ยน
    assert.equal((await put(2, { nickname: 'น้ำ 👩‍💻' })).status, 200);
    assert.equal(ACCOUNTS[2].nickname, 'น้ำ 👩‍💻');
});

test('keep_name: เปลี่ยนแค่ username → server เก็บ username เดิมเป็นชื่อที่แสดง เฉพาะตอนในฐานยังไม่มีชื่อที่แสดง / ชื่อเต็ม', async () => {
    reset(); UPDATES.length = 0; LOGS.length = 0;
    let r = await put(2, { username: 'sai.k', current_password: 'right-pass-1', keep_name: true });
    assert.equal(r.status, 200);
    assert.deepEqual(UPDATES.at(-1), { id: 2, fields: { username: 'sai.k', nickname: 'Sai' } });
    assert.equal((await r.json()).user.nickname, 'Sai');
    assert.equal(LOGS.at(-1).summary, 'แก้บัญชีของตัวเอง: ชื่อล็อกอิน Sai → sai.k');
    // โมดัลเปิดค้าง ระหว่างนั้นมีชื่อที่แสดงแล้ว (ตั้งจากอีกแท็บ / Admin) → ไม่เขียนทับ
    reset(); ACCOUNTS[2].nickname = 'ฝน';
    r = await put(2, { username: 'sai.k', current_password: 'right-pass-1', keep_name: true });
    assert.equal(r.status, 200);
    assert.deepEqual(UPDATES.at(-1), { id: 2, fields: { username: 'sai.k' } });
    assert.equal(ACCOUNTS[2].nickname, 'ฝน');
    // มีชื่อเต็ม = เมนูโชว์ชื่อเต็มอยู่แล้ว ไม่ต้องเก็บ
    reset();
    await put(3, { username: 'mook.k', current_password: 'right-pass-1', keep_name: true });
    assert.deepEqual(UPDATES.at(-1), { id: 3, fields: { username: 'mook.k' } });
});

test('เปลี่ยนแค่ชื่อล็อกอิน พร้อมเก็บชื่อเดิมเป็นชื่อที่แสดง (หน้าเว็บส่งมา) = ชื่อที่โชว์ไม่เปลี่ยน ไม่ชนกติกาชื่อซ้ำ', async () => {
    reset(); UPDATES.length = 0; LOGS.length = 0;
    const r = await put(1, { nickname: 'praewpraew', username: 'praew', current_password: 'right-pass-1' });
    assert.equal(r.status, 200);
    assert.deepEqual(UPDATES.at(-1), { id: 1, fields: { nickname: 'praewpraew', username: 'praew' } });
    assert.equal(LOGS.at(-1).summary, 'แก้บัญชีของตัวเอง: ชื่อล็อกอิน praewpraew → praew');
    // คนอื่นจะเอา username เดิมไปใช้ แล้วชื่อที่โชว์ (= username) ไปชนชื่อที่แสดงของคนนี้ ไม่ได้
    assert.equal((await put(2, { username: 'PraewPraew', current_password: 'right-pass-1' })).status, 409);
});

test('Admin แก้ผู้ใช้: ไม่ส่ง username / nickname = ไม่แตะ (ฟอร์มค้างไม่เขียนทับชื่อที่เจ้าของแก้เอง) · ตั้ง / ล้าง / ห้ามซ้ำ', async () => {
    reset(); UPDATES.length = 0;
    const adminPut = (id, body) => fetch(base + '/api/users/' + id, {
        method: 'PUT', headers: { Authorization: `Bearer ${tokenOf(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    ACCOUNTS[2].nickname = 'ฝน';
    assert.equal((await adminPut(2, { role: 'member', team_id: 2, brands: ['Jernis'] })).status, 200);
    assert.equal(UPDATES.at(-1).fields.username, undefined);
    assert.equal(UPDATES.at(-1).fields.nickname, undefined);
    assert.equal(ACCOUNTS[2].nickname, 'ฝน');
    assert.equal(ACCOUNTS[2].username, 'Sai');
    assert.equal((await adminPut(2, { nickname: '  ฝน   ก. ' })).status, 200);
    assert.equal(ACCOUNTS[2].nickname, 'ฝน ก.');
    assert.equal((await adminPut(2, { nickname: '' })).status, 200);
    assert.equal(ACCOUNTS[2].nickname, '', 'ล้าง = กลับไปโชว์ชื่อเต็ม / username');
    assert.equal((await adminPut(2, { nickname: 'mook' })).status, 409);
    assert.equal((await adminPut(2, { nickname: 'ก'.repeat(41) })).status, 400);
    // รอบ 2: ล้างชื่อที่แสดงจนชื่อที่โชว์ (ชื่อเต็ม) ไปชนคนอื่น = 409 · อนุมัติ / เปลี่ยนทีม ไม่ตรวจ
    reset(); ACCOUNTS[2].nickname = 'mook'; ACCOUNTS[3].nickname = 'Mook3';
    let r2 = await adminPut(3, { nickname: '' });
    assert.equal(r2.status, 409);
    assert.match(await msg(r2), /มีคนใช้ชื่อ "Mook"/);
    assert.equal(ACCOUNTS[3].nickname, 'Mook3');
    assert.equal((await adminPut(3, { team_id: 2 })).status, 200, 'ไม่ได้แก้ชื่อ = ไม่ตรวจ');
    // สร้างผู้ใช้ใหม่: ชื่อที่จะโชว์ (username) ชนคนอื่น = 409 · ใส่ชื่อที่แสดงต่างกัน = ได้
    reset();
    const adminPost = body => fetch(base + '/api/users', { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    r2 = await adminPost({ username: 'SAI', password: 'pass-12345', role: 'member' });
    assert.equal(r2.status, 409);
    assert.match(await msg(r2), /ใส่ชื่อที่แสดงให้ต่างกัน/);
    assert.equal(CREATED.length, 0);
    assert.equal((await adminPost({ username: 'SAI', password: 'pass-12345', role: 'member', nickname: ' ไซ  ใหม่ ' })).status, 201);
    assert.equal(CREATED.at(-1).nickname, 'ไซ ใหม่');
    assert.equal((await adminPost({ username: 'mook', password: 'pass-12345', role: 'agency' })).status, 201, 'เอเจนซี่ไม่นับชื่อซ้ำ');
    // ผู้ใช้ที่ไม่ใช่ Admin เรียกเส้นนี้ไม่ได้
    const r = await fetch(base + '/api/users/3', { method: 'PUT', headers: { Authorization: `Bearer ${tokenOf(2)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'x' }) });
    assert.equal(r.status, 403);
});

test('displayName: ชื่อที่แสดง → ชื่อเต็ม → username (ใช้ทุกที่ที่บันทึกชื่อคน)', () => {
    const { displayName } = require(path.join(SRC, 'data/userNames'));
    assert.equal(displayName({ nickname: 'แพรว', full_name: 'Praew K', username: 'praewpraew' }), 'แพรว');
    assert.equal(displayName({ nickname: '  ', full_name: ' Praew K ', username: 'praewpraew' }), 'Praew K');
    assert.equal(displayName({ nickname: '', full_name: null, username: 'praewpraew' }), 'praewpraew');
    assert.equal(displayName(null), null);
});

test('ค่าไม่ถูกต้อง = 400 · ไม่ได้เปลี่ยนอะไร = 400', async () => {
    reset(); UPDATES.length = 0;
    const bad = [
        [{ nickname: '   ' }, /กรุณาใส่ชื่อที่แสดง/],
        [{ nickname: 123 }, /กรุณาใส่ชื่อที่แสดง/],
        [{ nickname: 'ก'.repeat(41) }, /ไม่เกิน 40/],
        [{ nickname: 'a\u0000b' }, /ใช้ไม่ได้/],
        [{ username: 'sa i', current_password: 'right-pass-1' }, /ช่องว่าง/],
        [{ username: 'ab', current_password: 'right-pass-1' }, /3-40/],
        [{ username: 'a'.repeat(41), current_password: 'right-pass-1' }, /3-40/],
        [{ username: '' }, /ชื่อล็อกอิน/],
        [{}, /ยังไม่ได้เปลี่ยน/],
        [{ username: 'Sai', nickname: undefined }, /ยังไม่ได้เปลี่ยน/]
    ];
    for (const [body, re] of bad) {
        const r = await put(2, body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match(await msg(r), re, JSON.stringify(body));
    }
    assert.equal(UPDATES.length, 0);
});

test('เอเจนซี่ / บัญชีรออนุมัติ = 403 · ไม่ล็อกอิน = 401', async () => {
    reset(); UPDATES.length = 0;
    assert.equal((await put(4, { nickname: 'Agency A' })).status, 403);
    assert.equal((await put(6, { nickname: 'Newbie' })).status, 403);
    assert.equal((await put(null, { nickname: 'x' })).status, 401);
    assert.equal(UPDATES.length, 0);
});
