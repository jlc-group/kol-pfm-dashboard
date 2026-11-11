// หน้า Token ระบบ (เมนู ADMIN · 11 พ.ย. 2026) — admin ออก / เพิกถอน token ให้ระบบอื่นมาดึงข้อมูลทางประตูระบบ
// เทสต์ชุดนี้ไม่แตะฐานข้อมูลจริง: ตาราง system_tokens จำลองในหน่วยความจำ · token ที่ออกในเทสต์ไม่เคยถูกพิมพ์ออก
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-system-tokens-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in system-tokens test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// สลับ query ก่อนโหลด store (โมดูล store ดึง query ไปตอนโหลด)
const base = require(path.join(SRC, 'store/pg/_base'));
let onQuery = async () => ({ rows: [], rowCount: 0 });
const SQL = [];
base.query = async (text, params) => { SQL.push({ text: String(text), params }); return onQuery(String(text), params); };
base.withTransaction = async fn => fn({ query: base.query });

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const tokens = require(path.join(SRC, 'services/systemTokens'));
const { tableSql } = require(path.join(SRC, 'store/pg/systemTokens'));
const { PRIVATE_KEYS } = require(path.join(SRC, 'data/privateFields'));
const app = require(path.join(SRC, 'app'));

const TOKEN_SHAPE = /^kol_[A-Za-z0-9_-]{43}$/;
const DOOR = '/api/integrations/ad-rights';
const HEADER = 'X-KOL-Ad-Rights-Key';
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: 'แอดมิน', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'member1', full_name: 'Member', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jernis'] },
    3: { id: 3, username: 'agency1', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tk'] },
    4: { id: 4, username: 'pending1', full_name: 'Pending', role: 'member', status: 'pending', is_active: true, team_id: null, brands: [] },
    5: { id: 5, username: 'admin2', full_name: 'Second Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const LOG = [];
store.activity.log = async e => { LOG.push(e); return e; };

// ----- ตาราง system_tokens จำลอง: ทำตามที่ SQL ของ store/pg/systemTokens.js สั่ง -----
let TABLE = [];
let SEQ = 0;
let CLOCK = 0;
let BROKEN = null;      // error ที่ฐานจะโยนทุกคำสั่ง (เช่น ฐานขัดข้อง)
let MISSING = false;    // ยังไม่มีตาราง system_tokens — ทุกคำสั่งได้ 42P01 จนกว่าจะมี CREATE TABLE
let CREATE_ERROR = null; // error ที่ฐานจะโยนตอน CREATE TABLE (เช่น บัญชีฐานไม่มีสิทธิ์)
let LEAK_HASH = false;  // ให้รายการพา token_hash ติดมาด้วย — ใช้ทดสอบว่าตัวกรอง JSON ตัดทิ้ง
const noTableError = () => Object.assign(new Error('relation "system_tokens" does not exist'), { code: '42P01' });
const pub = r => ({
    id: r.id, name: r.name, scope: r.scope, token_hint: r.token_hint, created_by: r.created_by,
    created_at: r.created_at, last_used_at: r.last_used_at, revoked_at: r.revoked_at, revoked_by: r.revoked_by
});
const tick = () => new Date(Date.UTC(2026, 10, 11, 3, 0, CLOCK++));

const tableQuery = async (text, params = []) => {
    if (/FROM submissions/.test(text)) {
        return /SELECT COUNT\(\*\)::int AS n/.test(text) ? { rows: [{ n: 0 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (!/system_tokens/.test(text)) return { rows: [], rowCount: 0 };
    if (BROKEN) throw BROKEN;
    // ปุ่ม "สร้างตาราง": ถามว่ามีตารางหรือยัง → CREATE TABLE → CREATE INDEX (จำลองไม่มี rollback — เทสต์ที่ CREATE พลาดจึงไม่มีอะไรให้ย้อน)
    if (/^SELECT to_regclass\('system_tokens'\) IS NOT NULL AS present$/.test(text)) {
        return { rows: [{ present: !MISSING }], rowCount: 1 };
    }
    if (/^CREATE TABLE IF NOT EXISTS system_tokens \(/.test(text)) {
        if (CREATE_ERROR) throw CREATE_ERROR;
        MISSING = false;
        return { rows: [], rowCount: 0 };
    }
    if (/^CREATE INDEX IF NOT EXISTS idx_system_tokens_scope ON system_tokens\(/.test(text)) {
        if (MISSING) throw noTableError();
        return { rows: [], rowCount: 0 };
    }
    if (MISSING) throw noTableError();
    if (/^\s*INSERT INTO system_tokens/.test(text)) {
        const [name, scope, token_hash, token_hint, created_by_id, created_by, max] = params;
        if (TABLE.filter(t => t.scope === scope && !t.revoked_at).length >= max) return { rows: [], rowCount: 0 };
        if (TABLE.some(t => t.token_hash === token_hash)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
        const row = {
            id: ++SEQ, name, scope, token_hash, token_hint, created_by_id, created_by,
            created_at: tick(), last_used_at: null, revoked_at: null, revoked_by: null
        };
        TABLE.push(row);
        return { rows: [pub(row)], rowCount: 1 };
    }
    if (/SET revoked_at = now\(\)/.test(text)) {
        const row = TABLE.find(t => t.id === params[0] && !t.revoked_at);
        if (!row) return { rows: [], rowCount: 0 };
        row.revoked_at = tick();
        row.revoked_by = params[1];
        return { rows: [pub(row)], rowCount: 1 };
    }
    if (/SET last_used_at = now\(\)/.test(text)) {
        const row = TABLE.find(t => t.id === params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.last_used_at = new Date();
        return { rows: [], rowCount: 1 };
    }
    if (/^SELECT id FROM system_tokens WHERE id = \$1/.test(text)) {
        const row = TABLE.find(t => t.id === params[0]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }
    if (/WHERE token_hash = \$1 AND scope = \$2 AND revoked_at IS NULL/.test(text)) {
        const row = TABLE.find(t => t.token_hash === params[0] && t.scope === params[1] && !t.revoked_at);
        return { rows: row ? [{ id: row.id, name: row.name, scope: row.scope, last_used_at: row.last_used_at }] : [], rowCount: row ? 1 : 0 };
    }
    if (/ORDER BY \(revoked_at IS NOT NULL\), created_at DESC, id DESC/.test(text)) {
        const rows = [...TABLE]
            .sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || (b.created_at - a.created_at) || (b.id - a.id))
            .map(r => (LEAK_HASH ? { ...pub(r), token_hash: r.token_hash } : pub(r)));
        return { rows, rowCount: rows.length };
    }
    throw new Error('system-tokens test: SQL ที่ไม่รู้จัก — ' + text.slice(0, 80));
};

beforeEach(() => {
    SQL.length = 0;
    LOG.length = 0;
    TABLE = [];
    SEQ = 0;
    CLOCK = 0;
    BROKEN = null;
    MISSING = false;
    CREATE_ERROR = null;
    LEAK_HASH = false;
    onQuery = tableQuery;
});

let server, baseUrl;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});
// บน Windows libuv แครชถ้ายังมี socket ค้างตอนจบไฟล์ — ปิดทุกการเชื่อมต่อแล้วรอให้ socket หมด (แบบ tests/content-export.test.cjs)
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end().catch(() => {});
});

const sessionOf = uid => jwt.sign(
    { id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' }
);
const raw = async (method, url, headers = {}, body) => {
    const res = await fetch(baseUrl + url, {
        method, headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ }
    return { status: res.status, body: json, text, cache: res.headers.get('cache-control') };
};
const call = (uid, method, url = '', body) => raw(method, '/api/system-tokens' + url, { Authorization: 'Bearer ' + sessionOf(uid) }, body);
const issue = (body = { name: 'WeBoostX', scope: 'ad-rights' }, uid = 1) => call(uid, 'POST', '', body);
const door = (token, url = DOOR) => raw('GET', url, { [HEADER]: token });
const settle = () => new Promise(r => setTimeout(r, 20));
const quiet = async fn => {
    const realError = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = realError; }
};
const inserts = () => SQL.filter(q => /INSERT INTO system_tokens/.test(q.text));

// ===================== ใครเข้าได้ =====================

test('admin เปิดรายการได้: ประตูที่ออกได้ + เพดานต่อประตู + ready', async () => {
    const r = await call(1, 'GET');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.body, {
        status: 'success', data: [],
        doors: [{ scope: 'ad-rights', label: tokens.DOORS[0].label, header: HEADER, path: DOOR }],
        max_active_per_scope: 20, ready: true
    });
    assert.ok(r.body.doors[0].label);
});

test('ไม่ใช่ admin = ทำอะไรไม่ได้เลย และไม่มีคำสั่งไปถึงฐาน', async () => {
    await issue();
    SQL.length = 0;
    LOG.length = 0;
    for (const [method, url, body] of [['GET', ''], ['POST', '', { name: 'X', scope: 'ad-rights' }], ['POST', '/1/revoke'], ['POST', '/setup']]) {
        const member = await call(2, method, url, body);
        assert.equal(member.status, 403, `${method} ${url}`);
        assert.deepEqual(member.body, { status: 'error', message: 'ไม่มีสิทธิ์ทำรายการนี้' });

        const agency = await call(3, method, url, body);
        assert.equal(agency.status, 403);
        assert.equal(agency.body.status, 'error');

        const pending = await call(4, method, url, body);
        assert.equal(pending.status, 403);
        assert.equal(pending.body.code, 'PENDING');

        const nobody = await raw(method, '/api/system-tokens' + url, {}, body);
        assert.equal(nobody.status, 401);
        assert.equal(nobody.body.status, 'error');
    }
    assert.equal(SQL.length, 0);
    assert.equal(LOG.length, 0);
    assert.equal(TABLE.length, 1);
    assert.equal(TABLE[0].revoked_at, null);
});

test('token ระบบเปิดหน้า admin ไม่ได้ — ทั้งใน header ของประตู และใส่เป็น Bearer', async () => {
    const { token } = (await issue()).body;
    SQL.length = 0;
    for (const headers of [{ [HEADER]: token }, { Authorization: 'Bearer ' + token }, { Authorization: token }]) {
        for (const [method, url] of [['GET', ''], ['POST', ''], ['POST', '/1/revoke'], ['POST', '/setup']]) {
            const r = await raw(method, '/api/system-tokens' + url, headers, method === 'POST' && !url ? { name: 'X', scope: 'ad-rights' } : undefined);
            assert.equal(r.status, 401);
            assert.equal(r.body.status, 'error');
        }
    }
    assert.equal(SQL.length, 0);
    assert.equal(TABLE.length, 1);
});

// ===================== ออก token =====================

test('ออก token: ตัวจริงอยู่ในคำตอบครั้งเดียว · ฐานเก็บแค่แฮชกับ 4 ตัวท้าย', async () => {
    const r = await issue({ name: '  WeBoostX  ', scope: 'ad-rights' });
    assert.equal(r.status, 201);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(Object.keys(r.body), ['status', 'data', 'token']);
    const { token, data } = r.body;
    assert.match(token, TOKEN_SHAPE);
    assert.ok(tokens.TOKEN_SHAPE.test(token));
    assert.deepEqual(Object.keys(data), ['id', 'name', 'scope', 'token_hint', 'created_by', 'created_at', 'last_used_at', 'revoked_at', 'revoked_by']);
    assert.equal(data.name, 'WeBoostX');
    assert.equal(data.scope, 'ad-rights');
    assert.equal(data.token_hint, token.slice(-4));
    assert.equal(data.created_by, 'แอดมิน');
    assert.equal(data.last_used_at, null);
    assert.equal(data.revoked_at, null);

    // ฐาน: แฮช SHA-256 ของ token — ไม่มีตัวจริงในพารามิเตอร์หรือในข้อความ SQL
    assert.equal(inserts().length, 1);
    assert.deepEqual(inserts()[0].params, ['WeBoostX', 'ad-rights', sha256(token), token.slice(-4), 1, 'แอดมิน', 20]);
    assert.equal(TABLE[0].token_hash, sha256(token));
    assert.match(TABLE[0].token_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(SQL).includes(token));
    assert.ok(!JSON.stringify(TABLE).includes(token));

    // Activity Log: บอกว่าออกให้ใคร ประตูไหน ลงท้ายอะไร — ไม่มีตัวจริง
    assert.equal(LOG.length, 1);
    assert.deepEqual(LOG[0], {
        user_id: 1, team_id: 1, action: 'create', project_id: null, project_name: 'Token ระบบ',
        summary: `ออก token ระบบให้ WeBoostX (ประตู ad-rights · ลงท้าย …${token.slice(-4)})`
    });
    assert.ok(!JSON.stringify(LOG).includes(token));

    // รายการ: ไม่มีตัวจริง ไม่มีแฮช
    const list = await call(1, 'GET');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].token_hint, token.slice(-4));
    assert.ok(!list.text.includes(token));
    assert.ok(!list.text.includes(sha256(token)));
    assert.ok(!list.text.includes('token_hash'));
});

test('token แต่ละตัวไม่ซ้ำกัน และชื่อคนออกตามบัญชีที่ล็อกอิน', async () => {
    const a = (await issue()).body;
    const b = (await issue({ name: 'WeBoostX', scope: 'ad-rights' }, 5)).body;
    assert.notEqual(a.token, b.token);
    assert.notEqual(TABLE[0].token_hash, TABLE[1].token_hash);
    assert.equal(b.data.created_by, 'Second Admin');
    assert.equal(inserts()[1].params[4], 5);
    const made = new Set(Array.from({ length: 50 }, () => tokens.generate().token));
    assert.equal(made.size, 50);
    for (const t of made) assert.match(t, TOKEN_SHAPE);
});

test('ถึงแถวจะพาแฮชติดมา คำตอบ JSON ก็ไม่มี token_hash', async () => {
    const { token } = (await issue()).body;
    LEAK_HASH = true;
    const list = await call(1, 'GET');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.ok(!('token_hash' in list.body.data[0]));
    assert.ok(!list.text.includes('token_hash'));
    assert.ok(!list.text.includes(sha256(token)));
    assert.ok(PRIVATE_KEYS.has('token_hash'));
});

test('ชื่อระบบ: ต้องมี · ไม่เกิน 100 ตัว · บรรทัดเดียว', async () => {
    const need = 'กรุณาใส่ชื่อระบบที่จะใช้ token นี้ เช่น WeBoostX';
    const cases = [
        [undefined, need], [null, need], ['', need], ['    ', need], ['\n\t', need], [123, need], [['WeBoostX'], need], [{ a: 1 }, need], [true, need],
        ['ก'.repeat(101), 'ชื่อระบบยาวเกิน 100 ตัวอักษร'],
        ['Wee\nBoostX', 'ชื่อระบบต้องเป็นบรรทัดเดียว'], ['Wee\r\nBoostX', 'ชื่อระบบต้องเป็นบรรทัดเดียว']
    ];
    for (const [name, message] of cases) {
        const r = await issue({ name, scope: 'ad-rights' });
        assert.equal(r.status, 400, JSON.stringify(name));
        assert.deepEqual(r.body, { status: 'error', message }, JSON.stringify(name));
    }
    assert.equal((await call(1, 'POST', '')).status, 400);
    assert.equal(inserts().length, 0);
    assert.equal(LOG.length, 0);

    const ok = await issue({ name: 'ก'.repeat(100), scope: 'ad-rights' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.name.length, 100);
});

test('ประตู: ต้องเป็นประตูที่ระบบมี', async () => {
    for (const scope of [undefined, null, '', 'kol-pfm', 'cpas', 'AD-RIGHTS', ' ad-rights', ['ad-rights'], 123, { scope: 'ad-rights' }]) {
        const r = await issue({ name: 'WeBoostX', scope });
        assert.equal(r.status, 400, JSON.stringify(scope));
        assert.deepEqual(r.body, { status: 'error', message: 'กรุณาเลือกประตูที่จะออก token ให้' });
    }
    assert.equal(inserts().length, 0);
    assert.equal(TABLE.length, 0);
});

test('ประตูหนึ่งมี token ที่ใช้งานอยู่ได้ไม่เกิน 20 ตัว — ตัวที่เพิกถอนแล้วไม่นับ', async () => {
    for (let i = 1; i <= 20; i++) assert.equal((await issue({ name: 'ระบบ ' + i, scope: 'ad-rights' })).status, 201);
    LOG.length = 0;
    const over = await issue({ name: 'ระบบ 21', scope: 'ad-rights' });
    assert.equal(over.status, 400);
    assert.deepEqual(over.body, {
        status: 'error',
        message: 'ประตู ad-rights มี token ที่ใช้งานอยู่ครบ 20 ตัวแล้ว — เพิกถอนตัวที่ไม่ใช้ก่อน แล้วค่อยออกใหม่'
    });
    assert.ok(!('token' in over.body));
    assert.equal(TABLE.length, 20);
    assert.equal(LOG.length, 0);
    // นับกับเพิ่มอยู่ในคำสั่งเดียว (สองคนกดพร้อมกันไม่ทะลุเพดาน)
    assert.match(inserts().at(-1).text, /WHERE \(SELECT COUNT\(\*\) FROM system_tokens WHERE scope = \$2 AND revoked_at IS NULL\) < \$7/);

    assert.equal((await call(1, 'POST', '/3/revoke')).status, 200);
    assert.equal((await issue({ name: 'ระบบ 21', scope: 'ad-rights' })).status, 201);
    assert.equal(TABLE.filter(t => !t.revoked_at).length, 20);
});

// ===================== เพิกถอน =====================

test('เพิกถอน: ใส่เวลา + ชื่อคนเพิกถอน แถวยังอยู่ · ซ้ำ = 400 · ไม่มี = 404', async () => {
    const { token, data } = (await issue()).body;
    LOG.length = 0;
    const r = await call(5, 'POST', `/${data.id}/revoke`);
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.equal(r.body.status, 'success');
    assert.ok(r.body.data.revoked_at);
    assert.equal(r.body.data.revoked_by, 'Second Admin');
    assert.equal(r.body.data.token_hint, token.slice(-4));
    assert.ok(!('token' in r.body));
    assert.equal(TABLE.length, 1);
    assert.deepEqual(LOG, [{
        user_id: 5, team_id: 1, action: 'update', project_id: null, project_name: 'Token ระบบ',
        summary: `เพิกถอน token ระบบของ WeBoostX (ประตู ad-rights · ลงท้าย …${token.slice(-4)})`
    }]);

    const again = await call(1, 'POST', `/${data.id}/revoke`);
    assert.equal(again.status, 400);
    assert.deepEqual(again.body, { status: 'error', message: 'token นี้ถูกเพิกถอนไปแล้ว' });
    assert.equal(TABLE[0].revoked_by, 'Second Admin');

    const missing = await call(1, 'POST', '/999/revoke');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { status: 'error', message: 'ไม่พบ token นี้' });
    assert.equal(LOG.length, 1);
});

test('เพิกถอนด้วย id ที่ไม่ใช่เลข = 404 โดยไม่ถามฐาน', async () => {
    await issue();
    SQL.length = 0;
    for (const id of ['abc', '0', '-1', '1.5', '99999999999', '1;DROP', '%20']) {
        const r = await call(1, 'POST', `/${id}/revoke`);
        assert.equal(r.status, 404, id);
        assert.deepEqual(r.body, { status: 'error', message: 'ไม่พบ token นี้' });
    }
    assert.equal(SQL.length, 0);
    assert.equal(TABLE[0].revoked_at, null);
});

test('รายการ: ตัวที่ใช้งานอยู่ขึ้นก่อน แล้วใหม่ → เก่า', async () => {
    await issue({ name: 'A', scope: 'ad-rights' });
    await issue({ name: 'B', scope: 'ad-rights' });
    await issue({ name: 'C', scope: 'ad-rights' });
    await call(1, 'POST', '/3/revoke');
    const list = await call(1, 'GET');
    assert.deepEqual(list.body.data.map(t => [t.name, !!t.revoked_at]), [['B', false], ['A', false], ['C', true]]);
});

// ===================== ฐานยังไม่พร้อม =====================

test('ยังไม่มีตาราง: รายการบอก ready:false · ออก / เพิกถอน = 503 บอกให้กดปุ่ม "สร้างตาราง" (หรือรัน setup-db)', async () => {
    MISSING = true;
    const list = await call(1, 'GET');
    assert.equal(list.status, 200);
    assert.equal(list.body.ready, false);
    assert.deepEqual(list.body.data, []);
    assert.equal(list.body.doors.length, 1);

    const message = 'ยังไม่ได้สร้างตาราง system_tokens ในฐานข้อมูล — กดปุ่ม "สร้างตาราง" ในหน้า Token ระบบ (หรือรัน setup-db) ก่อน ถึงจะออก token ได้';
    const made = await issue();
    assert.equal(made.status, 503);
    assert.deepEqual(made.body, { status: 'error', message });
    assert.ok(!('token' in made.body));
    const revoked = await call(1, 'POST', '/1/revoke');
    assert.equal(revoked.status, 503);
    assert.deepEqual(revoked.body, { status: 'error', message });
    assert.equal(LOG.length, 0);

    // ประตูระบบ: ตรวจ token ไม่ได้ = 503 (ไม่ใช่ 401)
    const r = await quiet(() => door(tokens.generate().token));
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'TOKEN_CHECK_UNAVAILABLE');
    // ไม่มีเส้นไหนข้างบนสร้างตารางให้เอง — มีแต่ปุ่มของ admin
    assert.ok(!SQL.some(q => /\b(CREATE|ALTER|DROP)\b/i.test(q.text)));
    assert.equal(MISSING, true);
});

// ===================== ปุ่ม "สร้างตาราง" =====================

test('ปุ่มสร้างตาราง: คำสั่งมาจาก schema.sql — แค่ 2 คำสั่งของ system_tokens ไม่มีตารางอื่นปน', () => {
    const schema = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    const sql = tableSql();
    assert.equal(sql.length, 2);
    assert.match(sql[0], /^CREATE TABLE IF NOT EXISTS system_tokens \(\n/);
    assert.match(sql[0], /\n\);$/);
    assert.equal(sql[1], 'CREATE INDEX IF NOT EXISTS idx_system_tokens_scope ON system_tokens(scope) WHERE revoked_at IS NULL;');
    const cols = sql[0].split('\n').slice(1, -1).map(l => l.trim().split(/\s+/)[0]);
    assert.deepEqual(cols, ['id', 'name', 'scope', 'token_hash', 'token_hint', 'created_by_id', 'created_by',
        'created_at', 'last_used_at', 'revoked_at', 'revoked_by']);
    for (const s of sql) {
        assert.equal(s.indexOf(';'), s.length - 1);          // คำสั่งเดียว จบที่ ; ตัวเดียว
        assert.ok(!s.includes('\r'));
        assert.ok(schema.replace(/\r\n/g, '\n').includes(s)); // ตัวอักษรเดียวกับใน schema.sql — ไม่มีสำเนาในโค้ด
        assert.ok(!/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|TRIGGER|REFERENCES|FUNCTION)\b/i.test(s));
    }
    // ตารางอื่นของระบบ (มีข้อมูลจริง) ไม่ถูกเอ่ยถึงเลย
    const others = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]).filter(n => n !== 'system_tokens');
    assert.ok(others.length >= 15);
    for (const name of others) for (const s of sql) assert.ok(!new RegExp('\\b' + name + '\\b').test(s), name);

    // schema.sql ถูกแก้จนไม่ใช่ "สร้างตารางเปล่า 1 ตาราง" = ไม่ให้คำสั่งออกมา (ปุ่มไม่รัน)
    const index = 'CREATE INDEX IF NOT EXISTS idx_system_tokens_scope ON system_tokens(scope) WHERE revoked_at IS NULL;';
    assert.throws(() => tableSql('CREATE TABLE IF NOT EXISTS users (id SERIAL);'), /ไม่พบคำสั่งสร้างตาราง system_tokens/);
    assert.throws(() => tableSql('CREATE TABLE IF NOT EXISTS system_tokens (id SERIAL);'), /ไม่พบคำสั่งสร้างตาราง system_tokens/);
    assert.throws(() => tableSql(index), /ไม่พบคำสั่งสร้างตาราง system_tokens/);
    assert.throws(
        () => tableSql('CREATE TABLE IF NOT EXISTS system_tokens (id SERIAL, by_id INTEGER REFERENCES users(id));\n' + index),
        /ไม่รันจากหน้าเว็บ/
    );
    assert.throws(
        () => tableSql('CREATE TABLE IF NOT EXISTS system_tokens (id SERIAL);\n' + index.replace(';', ' AND id IN (DELETE FROM users RETURNING id);')),
        /ไม่รันจากหน้าเว็บ/
    );
    // คำสั่งที่ตามหลังในไฟล์ไม่ติดมาด้วย (หยุดที่ ; ตัวแรก)
    assert.deepEqual(
        tableSql('CREATE TABLE IF NOT EXISTS system_tokens (id SERIAL); DROP TABLE users;\r\n' + index + ' TRUNCATE kols;'),
        ['CREATE TABLE IF NOT EXISTS system_tokens (id SERIAL);', index]
    );
});

test('ปุ่มสร้างตาราง: admin กดแล้วได้ตาราง + index เท่านั้น · ออก token ได้ทันที · ลง Activity Log · กดซ้ำไม่มีผล', async () => {
    MISSING = true;
    assert.equal((await call(1, 'GET')).body.ready, false);
    SQL.length = 0;

    const r = await call(1, 'POST', '/setup');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.body, { status: 'success', created: true, ready: true });
    // ฐานได้รับ 3 คำสั่ง: ถามว่ามีตารางหรือยัง + สองคำสั่งจาก schema.sql — ไม่มีอย่างอื่น ไม่มีพารามิเตอร์จากคำขอ
    assert.deepEqual(SQL.map(q => q.text), ["SELECT to_regclass('system_tokens') IS NOT NULL AS present", ...tableSql()]);
    assert.ok(SQL.every(q => q.params === undefined));
    assert.deepEqual(LOG, [{
        user_id: 1, team_id: 1, action: 'create', project_id: null, project_name: 'Token ระบบ',
        summary: 'สร้างตาราง system_tokens ในฐานข้อมูล (ปุ่มในหน้า Token ระบบ)'
    }]);

    const list = await call(1, 'GET');
    assert.equal(list.body.ready, true);
    assert.deepEqual(list.body.data, []);
    const made = await issue();
    assert.equal(made.status, 201);
    assert.match(made.body.token, TOKEN_SHAPE);
    assert.equal((await door(made.body.token)).status, 200);

    // กดซ้ำ (หรือ admin อีกคนกด): ไม่สร้างใหม่ ไม่ลง log ซ้ำ token ที่ออกไปแล้วยังอยู่และยังใช้ได้
    LOG.length = 0;
    SQL.length = 0;
    const again = await call(5, 'POST', '/setup', { drop: true, table: 'users' });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { status: 'success', created: false, ready: true });
    assert.deepEqual(SQL.map(q => q.text), ["SELECT to_regclass('system_tokens') IS NOT NULL AS present", ...tableSql()]);
    assert.equal(LOG.length, 0);
    assert.equal(TABLE.length, 1);
    assert.equal(TABLE[0].revoked_at, null);
    assert.equal((await door(made.body.token)).status, 200);
});

test('ปุ่มสร้างตาราง: บัญชีฐานของแอปไม่มีสิทธิ์สร้างตาราง = 503 บอกให้ใช้ setup-db · ฐานขัดข้อง = 500 · ไม่ลง log', async () => {
    MISSING = true;
    CREATE_ERROR = Object.assign(new Error('permission denied for schema public'), { code: '42501' });
    const denied = await call(1, 'POST', '/setup');
    assert.equal(denied.status, 503);
    assert.deepEqual(denied.body, {
        status: 'error',
        message: 'บัญชีฐานข้อมูลของแอปไม่มีสิทธิ์สร้างตาราง — ให้ผู้ดูแลเซิร์ฟเวอร์รัน npm run setup-db ในโฟลเดอร์ server หนึ่งครั้งแทน'
    });
    assert.ok(!denied.text.includes('permission denied'));
    assert.equal((await call(1, 'GET')).body.ready, false);
    assert.equal((await issue()).status, 503);

    CREATE_ERROR = new Error('connection terminated unexpectedly');
    const down = await quiet(() => call(1, 'POST', '/setup'));
    assert.equal(down.status, 500);
    assert.equal(down.body.status, 'error');
    assert.ok(!('created' in down.body));

    BROKEN = new Error('connection terminated unexpectedly');
    assert.equal((await quiet(() => call(1, 'POST', '/setup'))).status, 500);
    assert.equal(LOG.length, 0);
    assert.equal(MISSING, true);
});

test('ปุ่มสร้างตาราง: บันทึก Activity Log พลาด ไม่ทำให้การสร้างตารางพลาด', async () => {
    MISSING = true;
    const realLog = store.activity.log;
    store.activity.log = async () => { throw new Error('activity down'); };
    try {
        const r = await call(1, 'POST', '/setup');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, { status: 'success', created: true, ready: true });
    } finally {
        store.activity.log = realLog;
    }
    assert.equal((await call(1, 'GET')).body.ready, true);
});

test('ฐานขัดข้องแบบอื่น = 500 และไม่มี token ในคำตอบ', async () => {
    BROKEN = new Error('connection terminated unexpectedly');
    await quiet(async () => {
        for (const r of [await call(1, 'GET'), await issue(), await call(1, 'POST', '/1/revoke')]) {
            assert.equal(r.status, 500);
            assert.equal(r.body.status, 'error');
            assert.ok(!('token' in r.body));
            assert.ok(!/kol_[A-Za-z0-9_-]{43}/.test(r.text));
        }
    });
    assert.equal(LOG.length, 0);
});

test('บันทึก Activity Log พลาด ไม่ทำให้การออก / เพิกถอนพลาด', async () => {
    const realLog = store.activity.log;
    store.activity.log = async () => { throw new Error('activity down'); };
    try {
        const made = await issue();
        assert.equal(made.status, 201);
        assert.match(made.body.token, TOKEN_SHAPE);
        assert.equal((await call(1, 'POST', `/${made.body.data.id}/revoke`)).status, 200);
    } finally {
        store.activity.log = realLog;
    }
});

// ===================== ออกจากหน้า admin → ใช้ที่ประตู → เพิกถอน =====================

test('token ที่ออกจากหน้านี้เปิดประตู ad-rights ได้ทันที · "ใช้ล่าสุด" ขยับ · เพิกถอนแล้วปิดตั้งแต่คำขอถัดไป', async () => {
    const { token, data } = (await issue()).body;
    assert.equal((await call(1, 'GET')).body.data[0].last_used_at, null);

    const first = await door(token);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'success');
    assert.equal((await door(token, DOOR + '/status')).status, 200);
    await settle();
    assert.ok((await call(1, 'GET')).body.data[0].last_used_at);

    // token อีกตัวของประตูเดียวกันยังใช้ได้หลังเพิกถอนตัวแรก (หมุน token ได้โดยระบบปลายทางไม่สะดุด)
    const second = (await issue({ name: 'WeBoostX (ตัวใหม่)', scope: 'ad-rights' })).body.token;
    assert.equal((await call(1, 'POST', `/${data.id}/revoke`)).status, 200);
    const closed = await door(token);
    assert.equal(closed.status, 401);
    assert.equal(closed.body.code, 'INVALID_TOKEN');
    assert.equal((await door(token, DOOR + '/status')).status, 401);
    assert.equal((await door(second)).status, 200);
});

// ===================== ของที่ต้องอยู่ในโค้ด =====================

test('schema: ตาราง system_tokens เก็บแฮช (ไม่มีช่องเก็บ token ตัวจริง) และไม่นับในด่านความพร้อม', async () => {
    const schema = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    const block = /CREATE TABLE IF NOT EXISTS system_tokens \(([\s\S]*?)\);/.exec(schema);
    assert.ok(block);
    const cols = block[1].split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('--')).map(l => l.split(/\s+/)[0]);
    assert.deepEqual(cols, ['id', 'name', 'scope', 'token_hash', 'token_hint', 'created_by_id', 'created_by',
        'created_at', 'last_used_at', 'revoked_at', 'revoked_by']);
    assert.match(block[1], /token_hash\s+CHAR\(64\)\s+NOT NULL\s+UNIQUE/);
    assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_system_tokens_scope ON system_tokens\(scope\) WHERE revoked_at IS NULL;/);

    // โค้ดขึ้นก่อนรัน setup-db ได้: ด่านความพร้อมไม่ถามหาตารางนี้
    const { checkDatabase } = require(path.join(SRC, 'services/readiness'));
    const asked = [];
    const realQuery = pool.query;
    pool.query = async q => { asked.push(q); return { rows: asked.length === 1 ? [] : [{ ok: 1 }] }; };
    try { await checkDatabase(); } finally { pool.query = realQuery; }
    assert.ok(asked[0].values[0].includes('submissions'));
    assert.ok(!asked[0].values[0].includes('system_tokens'));
});

test('โค้ดฝั่ง server: ไม่มีเส้นไหนอ่านแฮชกลับออกไป ไม่พิมพ์ token และไม่มี key ใน env', () => {
    const storeSrc = fs.readFileSync(path.join(SRC, 'store/pg/systemTokens.js'), 'utf8');
    const listCols = /const LIST_COLS = '([^']+)'/.exec(storeSrc)[1];
    assert.ok(!listCols.includes('token_hash'));
    assert.ok(!/SELECT \*|RETURNING \*/.test(storeSrc));
    assert.ok(!/SELECT[^;`]*token_hash[^;`]*FROM/.test(storeSrc));

    const service = fs.readFileSync(path.join(SRC, 'services/systemTokens.js'), 'utf8');
    const route = fs.readFileSync(path.join(SRC, 'routes/systemTokens.js'), 'utf8');
    for (const [name, src] of [['service', service], ['route', route], ['store', storeSrc]]) {
        assert.ok(!src.includes('process.env'), name);
        assert.ok(!/console\.log/.test(src), name);
    }
    // ที่เดียวที่พิมพ์ลง log คือ "ตรวจ token ไม่ได้" — บอกแค่ประตู
    const prints = service.match(/console\.\w+\([^)]*\)/g) || [];
    assert.equal(prints.length, 1);
    assert.ok(!/sent|token\b|hash/i.test(prints[0].replace('system token check failed', '')));
    assert.match(route, /router\.use\(requireRole\('admin'\)\);/);
    // ปุ่มสร้างตาราง: เส้นเดียว อยู่หลังด่าน admin · คำสั่ง CREATE ไม่ได้เขียนไว้ในโค้ด (อ่านจาก schema.sql) และไม่มีทางรัน setup-db ทั้งไฟล์
    assert.ok(route.indexOf("router.post('/setup'") > route.indexOf("router.use(requireRole('admin'));"));
    assert.equal(storeSrc.split('readFileSync').length, 2);
    assert.ok(storeSrc.includes("path.join(__dirname, '../../models/schema.sql')"));
    for (const [name, src] of [['route', route], ['store', storeSrc]]) {
        assert.ok(!/child_process|setupDb|setup-db\.js|exec\(|spawn\(/.test(src.replace(/TABLE_RE\.exec\(|INDEX_RE\.exec\(/g, '')), name);
    }

    const appSrc = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
    assert.ok(appSrc.includes("app.use('/api/system-tokens', authenticate, blockPending, blockAgency, require('./routes/systemTokens'));"));
});

test('หน้าเว็บ: เมนู ADMIN + เส้นทางเฉพาะ admin · token ตัวจริงไม่ลง storage / URL / console', () => {
    const read = f => fs.readFileSync(path.join(ROOT, 'client/src', f), 'utf8');
    const lazy = read('pages/lazyPages.js');
    assert.ok(lazy.includes("export const SystemTokens = lazyPage(() => import('./SystemTokens.jsx'));"));
    assert.match(lazy, /const ADMIN_PAGES = \[[^\]]*\bSystemTokens\b[^\]]*\];/);
    assert.ok(read('App.jsx').includes('<Route path="system-tokens" element={<AdminRoute><SystemTokens /></AdminRoute>} />'));
    assert.ok(read('components/Layout.jsx').includes("{ to: '/system-tokens', label: 'Token ระบบ', icon: 'key' }"));

    const page = read('pages/SystemTokens.jsx');
    // โค้ดจริง (ตัดบรรทัดคอมเมนต์ออก — คอมเมนต์หัวไฟล์เขียนว่า "ไม่ลง localStorage")
    const code = page.split(/\r?\n/).filter(l => !/^\s*(\/\/|\{\/\*)/.test(l)).join('\n');
    for (const banned of ['localStorage', 'sessionStorage', 'console.', 'document.cookie', 'location.', 'history.', 'URLSearchParams']) {
        assert.ok(!code.includes(banned), banned);
    }
    assert.ok(page.includes("api('/system-tokens', { method: 'POST', body: { name: clean, scope } })"));
    assert.ok(page.includes('`/system-tokens/${t.id}/revoke`'));
    assert.ok(page.includes('แสดงครั้งเดียว'));
    assert.ok(page.includes('npm run setup-db'));
    // ปุ่ม "สร้างตาราง": ถามยืนยันก่อน แล้วเรียกเส้น setup — แสดงเฉพาะตอนยังไม่มีตาราง
    assert.ok(page.includes("api('/system-tokens/setup', { method: 'POST' })"));
    assert.match(page, /if \(!confirm\(ask\)\) return;/);
    assert.match(page, /\{!ready && \(!loading \|\| creating\) && \(/);
    assert.ok(page.includes("{creating ? 'กำลังสร้าง...' : 'สร้างตาราง'}"));
});
