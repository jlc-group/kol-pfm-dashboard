// ประตูระบบ /api/integrations/ad-rights (11 พ.ย. 2026) — WeBoostX ดึงวันสุดท้ายที่ยิงแอดโพสต์ KOL ได้
// เทสต์ชุดนี้ไม่แตะฐานข้อมูลจริง: สลับ query ของ store/pg/_base ก่อนโหลด store · token ที่ใช้สุ่มขึ้นในเทสต์ ไม่เคยพิมพ์ออก
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ad-rights-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ad-rights test'); };
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
const { toFeedRow, PLATFORMS } = require(path.join(SRC, 'store/pg/adRights'));
const logic = require(path.join(SRC, 'store/logic'));
const app = require(path.join(SRC, 'app'));

const HEADER = 'X-KOL-Ad-Rights-Key';
const DOOR = '/api/integrations/ad-rights';

store.users.findById = async id => (Number(id) === 1
    ? { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] }
    : null);

// ----- ตาราง system_tokens จำลอง: เก็บแฮชเหมือนของจริง -----
let TOKENS = [];
const addToken = (over = {}) => {
    const fresh = tokens.generate();
    TOKENS.push({ id: TOKENS.length + 1, name: 'WeBoostX', scope: 'ad-rights', token_hash: fresh.hash, last_used_at: null, revoked_at: null, ...over });
    return fresh.token;
};

// ----- แถว submissions จำลอง (รูปเดียวกับที่ SQL ของฟีดคืน) -----
const AD_GROUPS = [{ key: 'g1', name: 'กลุ่มปกติ' }, { key: 'g2', name: 'ไม่ใช้ Gencode', no_gencode: true }];
const dbRow = (over = {}) => ({
    id: 101, platform: 'Instagram', brand: 'Beauterry', account_name: 'creator.one', product: 'BTA1',
    post_url: 'https://www.instagram.com/p/AAA/', id_post: '17900000000000001', gencode: 'CODE-1',
    post_date: '2026-09-11', post_date_by: 'แอดมิน', code_expire: 60, group_key: 'g1', ad_groups: AD_GROUPS,
    feed_updated_at: new Date('2026-11-10T02:00:00.000Z'), ...over
});
let FEED = [];
let TOTAL = null;

const tableQuery = async (text, params) => {
    if (/FROM system_tokens/.test(text) && /token_hash = \$1/.test(text)) {
        const row = TOKENS.find(t => t.token_hash === params[0] && t.scope === params[1] && !t.revoked_at);
        return { rows: row ? [{ id: row.id, name: row.name, scope: row.scope, last_used_at: row.last_used_at }] : [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE system_tokens/.test(text) && /last_used_at = now\(\)/.test(text)) return { rows: [], rowCount: 1 };
    if (/SELECT COUNT\(\*\)::int AS n/.test(text)) return { rows: [{ n: TOTAL === null ? FEED.length : TOTAL }], rowCount: 1 };
    if (/FROM submissions s JOIN projects p/.test(text)) return { rows: FEED, rowCount: FEED.length };
    return { rows: [], rowCount: 0 };
};

beforeEach(() => {
    SQL.length = 0;
    TOKENS = [];
    FEED = [dbRow()];
    TOTAL = null;
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

const get = async (url, headers = {}) => {
    const res = await fetch(baseUrl + url, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ }
    return { status: res.status, body, text, cache: res.headers.get('cache-control') };
};
const withKey = (token, url = DOOR) => get(url, { [HEADER]: token });
const tick = () => new Promise(r => setTimeout(r, 20));
const sqlText = () => SQL.map(q => q.text).join('\n');
const sqlParams = () => JSON.stringify(SQL.map(q => q.params));
const denied = r => {
    assert.equal(r.status, 401);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.code, 'INVALID_TOKEN');
    assert.equal(r.cache, 'no-store');
};

// ===================== ประตู: ใครเปิดได้ =====================

test('token ที่ออกให้ประตูนี้เปิดได้ และคำตอบมีรูปตามสัญญา', async () => {
    const token = addToken();
    const r = await withKey(token);
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.equal(r.body.status, 'success');
    const d = r.body.data;
    assert.deepEqual(Object.keys(d), ['count', 'total', 'has_more', 'generated_at', 'rows']);
    assert.equal(d.count, 1);
    assert.equal(d.total, 1);
    assert.equal(d.has_more, false);
    assert.match(d.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(d.rows[0], {
        row_id: 101, platform: 'instagram', brand: 'Beauterry', creator: 'creator.one', product: 'BTA1',
        post_url: 'https://www.instagram.com/p/AAA/', id_post: '17900000000000001', gencode: 'CODE-1',
        post_date: '2026-09-11', days: 60, ad_rights_end: '2026-11-10', no_end_reason: null,
        updated_at: '2026-11-10T02:00:00.000Z', post_date_by: 'แอดมิน'
    });
});

test('ไม่ส่ง header = 401 และไม่แตะฐานข้อมูล', async () => {
    addToken();
    denied(await get(DOOR));
    denied(await get(DOOR + '/status'));
    assert.equal(SQL.length, 0);
});

test('รูปแบบไม่ใช่ token ของเรา = 401 โดยไม่ถามฐานข้อมูล', async () => {
    const token = addToken();
    const body = token.slice(4);
    const bad = [
        'kol_short', body, 'wbx_' + body, 'ahx_' + body, 'KOL_' + body,
        token + 'A', token.slice(0, -1), token.slice(0, -1) + '!', 'Bearer ' + token, token + ', ' + token
    ];
    for (const sent of bad) denied(await withKey(sent));
    assert.equal(SQL.length, 0);
});

test('header ซ้ำสองตัว = 401 (ไม่เลือกตัวใดตัวหนึ่งมาใช้)', async () => {
    const token = addToken();
    const headers = new Headers();
    headers.append(HEADER, token);
    headers.append(HEADER, token);
    const res = await fetch(baseUrl + DOOR, { headers });
    assert.equal(res.status, 401);
    await res.text();
    assert.equal(SQL.length, 0);
});

test('token รูปแบบถูกแต่ไม่มีในระบบ = 401 · ถามฐานด้วยแฮช ไม่ใช่ตัวจริง', async () => {
    addToken();
    const stranger = tokens.generate().token;
    denied(await withKey(stranger));
    assert.equal(SQL.length, 1);
    assert.match(SQL[0].text, /WHERE token_hash = \$1 AND scope = \$2 AND revoked_at IS NULL/);
    assert.deepEqual(SQL[0].params, [crypto.createHash('sha256').update(stranger).digest('hex'), 'ad-rights']);
    assert.ok(!sqlParams().includes(stranger));
    assert.ok(!sqlText().includes(stranger));
});

test('token ที่ถูกเพิกถอน = 401 ตั้งแต่คำขอถัดไป (ไม่มี cache)', async () => {
    const token = addToken();
    assert.equal((await withKey(token)).status, 200);
    TOKENS[0].revoked_at = new Date();
    denied(await withKey(token));
    denied(await withKey(token, DOOR + '/status'));
});

test('token ของประตูอื่น = 401', async () => {
    const token = addToken({ scope: 'kol-pfm' });
    denied(await withKey(token));
    assert.equal(SQL.at(-1).params[1], 'ad-rights');
});

test('ล็อกอินของคน (Authorization: Bearer) เปิดประตูระบบไม่ได้', async () => {
    const token = addToken();
    const session = jwt.sign({ id: 1, username: 'admin1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    denied(await get(DOOR, { Authorization: 'Bearer ' + session }));
    // token ระบบที่ใส่ผิดช่อง (Bearer) ก็เปิดไม่ได้
    denied(await get(DOOR, { Authorization: 'Bearer ' + token }));
    denied(await get(DOOR, { Authorization: token }));
    assert.equal(SQL.length, 0);
});

test('token ใน query string หรือ header ชื่ออื่น เปิดไม่ได้', async () => {
    const token = addToken();
    for (const name of ['token', 'key', 'api_key', 'access_token', HEADER, HEADER.toLowerCase()]) {
        denied(await get(`${DOOR}?${encodeURIComponent(name)}=${token}`));
    }
    for (const name of ['X-KOL-Content-Key', 'X-API-Key', 'X-PFM-API-Key', 'X-KOL-Ad-Rights']) {
        denied(await get(DOOR, { [name]: token }));
    }
    assert.equal(SQL.length, 0);
});

test('ตรวจ token ไม่ได้ (ฐานขัดข้อง / ยังไม่มีตาราง) = 503 ไม่ใช่ 401 และไม่พิมพ์ token', async () => {
    const token = addToken();
    const printed = [];
    const realError = console.error;
    console.error = (...a) => { printed.push(a.map(String).join(' ')); };
    try {
        for (const err of [Object.assign(new Error('relation "system_tokens" does not exist'), { code: '42P01' }), new Error('connection terminated')]) {
            onQuery = async () => { throw err; };
            const r = await withKey(token);
            assert.equal(r.status, 503);
            assert.equal(r.body.status, 'error');
            assert.equal(r.body.code, 'TOKEN_CHECK_UNAVAILABLE');
            assert.equal(r.cache, 'no-store');
            assert.ok(!r.text.includes('system_tokens') && !r.text.includes('connection terminated'));
        }
    } finally {
        console.error = realError;
    }
    assert.equal(printed.length, 2);
    assert.ok(printed.every(line => !line.includes(token)));
});

test('log ของคำขอไม่มี token (พิมพ์แค่ method กับ path)', async () => {
    const token = addToken();
    const printed = [];
    const realLog = console.log, realError = console.error;
    console.log = (...a) => { printed.push(a.map(String).join(' ')); };
    console.error = (...a) => { printed.push(a.map(String).join(' ')); };
    try {
        assert.equal((await withKey(token)).status, 200);
        denied(await withKey(tokens.generate().token));
        denied(await get(`${DOOR}?token=${token}`));
    } finally {
        console.log = realLog;
        console.error = realError;
    }
    assert.ok(printed.some(line => line.includes('GET ' + DOOR)));
    assert.ok(printed.every(line => !line.includes(token) && !line.includes('token=')));
});

// ===================== "ใช้ล่าสุด" =====================

test('"ใช้ล่าสุด" เขียนเมื่อยังไม่เคยใช้ หรือครั้งก่อนเกิน 10 นาที — ไม่เขียนทุกคำขอ', async () => {
    const touches = () => SQL.filter(q => /UPDATE system_tokens/.test(q.text));
    const token = addToken();

    assert.equal((await withKey(token)).status, 200);
    await tick();
    assert.equal(touches().length, 1);
    assert.deepEqual(touches()[0].params, [1, 10]);
    assert.match(touches()[0].text, /last_used_at IS NULL OR last_used_at < now\(\) - make_interval\(mins => \$2::int\)/);

    SQL.length = 0;
    TOKENS[0].last_used_at = new Date(Date.now() - 9 * 60 * 1000);
    assert.equal((await withKey(token)).status, 200);
    await tick();
    assert.equal(touches().length, 0);

    TOKENS[0].last_used_at = new Date(Date.now() - 11 * 60 * 1000);
    assert.equal((await withKey(token)).status, 200);
    await tick();
    assert.equal(touches().length, 1);
});

test('เขียน "ใช้ล่าสุด" ไม่ได้ ไม่ทำให้การดึงข้อมูลพลาด', async () => {
    const token = addToken();
    onQuery = async (text, params) => {
        if (/UPDATE system_tokens/.test(text)) throw new Error('deadlock detected');
        return tableQuery(text, params);
    };
    const r = await withKey(token);
    await tick();
    assert.equal(r.status, 200);
    assert.equal(r.body.data.count, 1);
});

// ===================== รายการ: SQL และตัวกรอง =====================

test('แถวที่ส่ง = ยืนยันแล้ว + มีลิงก์โพสต์ + Instagram / Facebook เท่านั้น + ไม่ใช่แคมเปญ other', async () => {
    const token = addToken();
    await withKey(token);
    const [count, page] = SQL.filter(q => /FROM submissions s JOIN projects p/.test(q.text));
    for (const q of [count, page]) {
        assert.match(q.text, /s\.status = 'confirmed'/);
        assert.match(q.text, /NULLIF\(BTRIM\(s\.post_url\), ''\) IS NOT NULL/);
        assert.match(q.text, /LOWER\(BTRIM\(s\.platform\)\) IN \('instagram', 'facebook'\)/);
        assert.match(q.text, /COALESCE\(p\.campaign_type, 'kol'\) <> 'other'/);
        assert.ok(!/tiktok/i.test(q.text));
    }
    assert.match(count.text, /^SELECT COUNT\(\*\)::int AS n/);
    assert.deepEqual(count.params, []);
    assert.match(page.text, /ORDER BY feed_updated_at, s\.id\s+LIMIT \$1 OFFSET \$2/);
    assert.deepEqual(page.params, [500, 0]);
    // เวลาแก้ล่าสุด = ล่าสุดของทุกตราเวลาของแถว + ของแคมเปญ
    for (const col of ['s.submitted_at', 's.updated_at', 's.work_updated_at', 's.list_updated_at', 's.decided_at',
        's.post_date_at', 's.gencode_at', 's.id_post_at', 's.post_url_at', 'p.updated_at']) {
        assert.ok(page.text.includes(col), col);
    }
    assert.match(page.text, /GREATEST\(/);
    assert.deepEqual(PLATFORMS, ['instagram', 'facebook']);
});

test('platform / updated_since / limit / offset ไปถึง SQL เป็นพารามิเตอร์', async () => {
    const token = addToken();
    await withKey(token, `${DOOR}?platform=Facebook&updated_since=2026-11-10T09:00:00%2B07:00&limit=50&offset=100`);
    const [count, page] = SQL.filter(q => /FROM submissions s JOIN projects p/.test(q.text));
    assert.match(page.text, /LOWER\(BTRIM\(s\.platform\)\) = \$1/);
    // updated_since เทียบแบบ "หลังจาก" (>) — แถวที่เวลาเท่ากันพอดีไม่ส่งซ้ำ
    assert.match(page.text, /p\.updated_at\) > \$2/);
    assert.ok(!/>= \$2/.test(page.text));
    assert.match(page.text, /LIMIT \$3 OFFSET \$4/);
    assert.deepEqual(count.params, ['facebook', '2026-11-10T02:00:00.000Z']);
    assert.deepEqual(page.params, ['facebook', '2026-11-10T02:00:00.000Z', 50, 100]);
});

test('ค่าที่ส่งมาผิด = 400 พร้อม code บอกว่าผิดตัวไหน (ตรวจหลังผ่านประตูแล้ว)', async () => {
    const token = addToken();
    const cases = [
        ['platform=tiktok', 'INVALID_PLATFORM'], ['platform=ig', 'INVALID_PLATFORM'], ['platform=instagram&platform=facebook', 'INVALID_PLATFORM'],
        ['limit=0', 'INVALID_LIMIT'], ['limit=2001', 'INVALID_LIMIT'], ['limit=abc', 'INVALID_LIMIT'], ['limit=1.5', 'INVALID_LIMIT'],
        ['limit=-1', 'INVALID_LIMIT'], ['limit=10abc', 'INVALID_LIMIT'], ['limit=1&limit=2', 'INVALID_LIMIT'],
        ['offset=-1', 'INVALID_OFFSET'], ['offset=x', 'INVALID_OFFSET'], ['offset=1.5', 'INVALID_OFFSET'],
        ['updated_since=yesterday', 'INVALID_UPDATED_SINCE'], ['updated_since=2026-13-45', 'INVALID_UPDATED_SINCE'],
        ['updated_since=a&updated_since=b', 'INVALID_UPDATED_SINCE']
    ];
    for (const [qs, code] of cases) {
        const r = await withKey(token, `${DOOR}?${qs}`);
        assert.equal(r.status, 400, qs);
        assert.equal(r.body.status, 'error', qs);
        assert.equal(r.body.code, code, qs);
        assert.ok(r.body.message, qs);
    }
    assert.ok(!SQL.some(q => /FROM submissions/.test(q.text)));
    // ไม่มี token = 401 ก่อนเสมอ ไม่บอกว่าค่าไหนผิด
    denied(await get(`${DOOR}?limit=abc`));
});

test('limit 1 และ 2000 ใช้ได้ · ค่าว่าง = ค่าเริ่ม', async () => {
    const token = addToken();
    for (const [qs, params] of [['limit=1', [1, 0]], ['limit=2000', [2000, 0]], ['limit=&offset=&platform=&updated_since=', [500, 0]], ['offset=7', [500, 7]]]) {
        SQL.length = 0;
        const r = await withKey(token, `${DOOR}?${qs}`);
        assert.equal(r.status, 200, qs);
        assert.deepEqual(SQL.find(q => /LIMIT/.test(q.text)).params, params, qs);
    }
});

test('count / total / has_more บอกว่ายังมีหน้าถัดไปไหม', async () => {
    const token = addToken();
    FEED = [dbRow({ id: 1 }), dbRow({ id: 2 })];
    TOTAL = 5;
    let d = (await withKey(token, `${DOOR}?limit=2`)).body.data;
    assert.deepEqual([d.count, d.total, d.has_more], [2, 5, true]);
    d = (await withKey(token, `${DOOR}?limit=2&offset=2`)).body.data;
    assert.deepEqual([d.count, d.total, d.has_more], [2, 5, true]);
    FEED = [dbRow({ id: 5 })];
    d = (await withKey(token, `${DOOR}?limit=2&offset=4`)).body.data;
    assert.deepEqual([d.count, d.total, d.has_more], [1, 5, false]);
    FEED = [];
    TOTAL = 0;
    d = (await withKey(token)).body.data;
    assert.deepEqual([d.count, d.total, d.has_more, d.rows], [0, 0, false, []]);
});

test('ดึงรายการพลาด = 500 ไม่ใช่ข้อมูลว่าง', async () => {
    const token = addToken();
    const realError = console.error;
    console.error = () => {};
    try {
        onQuery = async (text, params) => {
            if (/FROM submissions/.test(text)) throw new Error('boom');
            return tableQuery(text, params);
        };
        const r = await withKey(token);
        assert.equal(r.status, 500);
        assert.equal(r.body.status, 'error');
        assert.equal((await withKey(token, DOOR + '/status')).status, 500);
    } finally {
        console.error = realError;
    }
});

// ===================== สถานะ =====================

test('สถานะ: จำนวนแถว · แถวที่ยังไม่มีวันหมดสิทธิ์ · แถวที่ยังไม่มี ID Post · แก้ล่าสุด', async () => {
    const token = addToken();
    FEED = [
        dbRow({ id: 1, feed_updated_at: new Date('2026-11-01T00:00:00Z') }),
        dbRow({ id: 2, post_date: null, feed_updated_at: new Date('2026-11-10T05:30:00Z') }),
        dbRow({ id: 3, id_post: '  ', feed_updated_at: new Date('2026-11-05T00:00:00Z') }),
        dbRow({ id: 4, group_key: 'g2', gencode: '', id_post: null, feed_updated_at: null })
    ];
    const r = await withKey(token, DOOR + '/status');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.body, {
        status: 'success',
        data: { rows: 4, rows_without_end: 2, rows_without_post_id: 2, last_updated_at: '2026-11-10T05:30:00.000Z' }
    });
    const q = SQL.find(s => /FROM submissions/.test(s.text));
    assert.match(q.text, /s\.status = 'confirmed'/);
    assert.match(q.text, /COALESCE\(p\.campaign_type, 'kol'\) <> 'other'/);

    FEED = [];
    assert.deepEqual((await withKey(token, DOOR + '/status')).body.data,
        { rows: 0, rows_without_end: 0, rows_without_post_id: 0, last_updated_at: null });
});

// ===================== วันหมดสิทธิ์ =====================

test('วันหมดสิทธิ์ = วันลงโพสต์ + จำนวนวันของ Gencode (ยิงได้ถึงสิ้นวันนั้น)', () => {
    assert.equal(toFeedRow(dbRow({ post_date: '2026-09-11', code_expire: 60 })).ad_rights_end, '2026-11-10');
    assert.equal(toFeedRow(dbRow({ post_date: '2026-11-10', code_expire: 60 })).ad_rights_end, '2027-01-09');
    assert.equal(toFeedRow(dbRow({ post_date: '2026-09-12', code_expire: 60 })).ad_rights_end, '2026-11-11');
    assert.equal(toFeedRow(dbRow({ post_date: '2028-02-28', code_expire: 1 })).ad_rights_end, '2028-02-29');
    assert.equal(toFeedRow(dbRow({ post_date: '2026-12-31', code_expire: 1 })).ad_rights_end, '2027-01-01');
    assert.equal(toFeedRow(dbRow({ post_date: '2026-11-10', code_expire: '30' })).ad_rights_end, '2026-12-10');
    // วันลงโพสต์ที่เก็บมาพร้อมเวลา ใช้เฉพาะส่วนวันที่
    const r = toFeedRow(dbRow({ post_date: '2026-09-11T17:00:00.000Z' }));
    assert.deepEqual([r.post_date, r.ad_rights_end], ['2026-09-11', '2026-11-10']);
});

test('ยังไม่มีวันหมดสิทธิ์ บอกเหตุผล: no_gencode / no_post_date / no_days', () => {
    const end = over => { const r = toFeedRow(dbRow(over)); return [r.ad_rights_end, r.no_end_reason, r.days, r.post_date]; };
    // กลุ่ม "ไม่ใช้ Gencode" และโพสต์ไม่มีรหัส → ไม่มีวันหมดสิทธิ์ จำนวนวันเป็น 0
    assert.deepEqual(end({ group_key: 'g2', gencode: '' }), [null, 'no_gencode', 0, '2026-09-11']);
    assert.deepEqual(end({ group_key: 'g2', gencode: null, post_date: null }), [null, 'no_gencode', 0, null]);
    // กลุ่ม "ไม่ใช้ Gencode" แต่โพสต์มีรหัสจริง → นับวันตามปกติ
    assert.deepEqual(end({ group_key: 'g2', gencode: 'CODE-9' }), ['2026-11-10', null, 60, '2026-09-11']);
    for (const post_date of [null, '', '   ', 'เร็ว ๆ นี้', '11/09/2026', '2026-02-30', '2026-13-01', '2026-00-10']) {
        assert.deepEqual(end({ post_date }), [null, 'no_post_date', 60, null], String(post_date));
    }
    for (const code_expire of [null, 0, '', 'abc', -5]) {
        const [e, reason] = end({ code_expire });
        assert.deepEqual([e, reason], [null, 'no_days'], String(code_expire));
    }
    // ไม่มีกลุ่ม / กลุ่มหาย / ad_groups ไม่ใช่ array → ถือว่าใช้ Gencode ตามปกติ
    assert.equal(toFeedRow(dbRow({ group_key: null })).ad_rights_end, '2026-11-10');
    assert.equal(toFeedRow(dbRow({ group_key: 'gone' })).ad_rights_end, '2026-11-10');
    assert.equal(toFeedRow(dbRow({ ad_groups: null })).ad_rights_end, '2026-11-10');
});

test('ช่องข้อความ: ตัดช่องว่าง · ว่าง = null · platform เป็นตัวเล็ก', () => {
    const r = toFeedRow(dbRow({
        platform: '  FaceBook ', brand: ' Jula ', account_name: '', product: '   ', id_post: ' 123_456 ',
        gencode: '', post_date_by: null, post_url: ' https://www.facebook.com/x/posts/1 '
    }));
    assert.deepEqual(
        [r.platform, r.brand, r.creator, r.product, r.id_post, r.gencode, r.post_date_by, r.post_url],
        ['facebook', 'Jula', null, null, '123_456', null, null, 'https://www.facebook.com/x/posts/1']
    );
    assert.deepEqual(Object.keys(r), ['row_id', 'platform', 'brand', 'creator', 'product', 'post_url', 'id_post', 'gencode',
        'post_date', 'days', 'ad_rights_end', 'no_end_reason', 'updated_at', 'post_date_by']);
});

test('สูตรวันครบอายุฝั่ง server ตรงกับป้าย DAY LEFT ของหน้าเว็บทุกกรณี', async () => {
    const client = await import(pathToFileURL(path.join(ROOT, 'client/src/data/dayLeft.js')).href);
    const dates = ['2026-09-11', '2026-11-10', '2026-12-31', '2028-02-28', '2026-02-30', '2026-09-11T17:00:00Z', '', null, undefined, 'x', '11/09/2026'];
    const days = [60, 30, 1, 0, -1, '45', '', null, undefined, 'abc', 365, 1.5];
    for (const d of dates) {
        for (const n of days) {
            assert.equal(logic.gencodeExpireDate(d, n), client.gencodeExpireDate(d, n), `${d} + ${n}`);
        }
    }
    assert.equal(logic.gencodeExpireDate('2026-09-11', 60), '2026-11-10');
    assert.equal(logic.gencodeExpireDate('2026-11-10', 60), '2027-01-09');
});

// ===================== การผูกเส้นทาง =====================

test('ประตู ad-rights ผูกก่อน /api/integrations/:brand และไม่ผ่านด่านล็อกอินของคน', () => {
    const src = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
    const door = src.indexOf("app.use('/api/integrations/ad-rights', require('./routes/adRights'));");
    const brand = src.indexOf("app.use('/api/integrations/:brand'");
    assert.ok(door > 0 && brand > 0 && door < brand);
    // log ของคำขอพิมพ์แค่ method + path
    assert.ok(src.includes('console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);'));
    const route = fs.readFileSync(path.join(SRC, 'routes/adRights.js'), 'utf8');
    assert.match(route, /router\.use\(machineDoor\('ad-rights'\)\);/);
    assert.ok(!/authenticate|req\.query\.(token|key)|authorization/i.test(route.replace(/\/\/.*$/gm, '')));
});

test('ประตูที่ประกาศไว้: scope ad-rights · header X-KOL-Ad-Rights-Key · ไม่มี key ใน env', () => {
    assert.deepEqual(tokens.DOORS.map(d => [d.scope, d.header, d.path]), [['ad-rights', HEADER, DOOR]]);
    assert.throws(() => tokens.machineDoor('nope'), /unknown machine door/);
    for (const file of ['services/systemTokens.js', 'routes/adRights.js', 'store/pg/adRights.js', 'store/pg/systemTokens.js', 'routes/systemTokens.js']) {
        assert.ok(!fs.readFileSync(path.join(SRC, file), 'utf8').includes('process.env'), file);
    }
});
