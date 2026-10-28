const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// PUT /api/projects/:id/submissions/:subId/person-status — เลือก / ไม่เลือก / คืนสถานะทั้งคนทีเดียว (27 ต.ค. 2026)
// server จริง + store จำลอง (ไม่ต่อฐาน)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-person-status-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in person-status-route test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = {
    1: { id: 1, username: 'fon', full_name: 'Fon', nickname: 'ฝน', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jernis'], agency_tokens: [] },
    2: { id: 2, username: 'praew', full_name: 'Praew', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Beauterry'], agency_tokens: [] },
    3: { id: 3, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tok1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const PROJECTS = {
    5: { id: 5, name: 'Jernis Oct', brand: 'Jernis', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [] },
    6: { id: 6, name: 'KOL รายคน', brand: 'Jernis', team_id: 1, campaign_type: 'solo', status: 'Active', ad_groups: [] }
};
store.projects.findByIdFull = async id => (PROJECTS[Number(id)] ? structuredClone(PROJECTS[Number(id)]) : null);
const CALLS = [], LOGS = [];
let NEXT = null;
store.submissions.setPersonStatus = async (subId, pid, status, from, byName, opts) => {
    CALLS.push({ subId, pid, status, from, byName, opts });
    if (NEXT) { const e = NEXT; NEXT = null; throw e; }
    if (String(subId) === '404') return null;
    return [1, 2, 3].map(i => ({ id: 100 + i, account_name: 'reviewafter6pm', status }));
};
store.activity.log = async e => { LOGS.push(e); return e; };

let server, base;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const tokenOf = id => jwt.sign({ id, username: ACCOUNTS[id].username, role: ACCOUNTS[id].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const put = (uid, url, body) => fetch(base + '/api' + url, { method: 'PUT', headers: { Authorization: `Bearer ${tokenOf(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('เลือกทั้งคน: ส่งสถานะที่เห็นไปด้วย · ลงประวัติครั้งเดียวพร้อมจำนวนคลิป · ชื่อคนกด', async () => {
    const r = await put(1, '/projects/5/submissions/101/person-status', { status: 'confirmed', from_status: 'submitted' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.length, 3);
    // ชื่อคนกด = ชื่อที่แสดง (nickname) ก่อนชื่อเต็ม — เจ้าของบัญชีตั้งเองได้ตั้งแต่ 28 ต.ค. 2026 (data/userNames.js displayName)
    assert.deepEqual(CALLS.at(-1), { subId: '101', pid: '5', status: 'confirmed', from: 'submitted', byName: 'ฝน', opts: { actor: 'team' } });
    assert.equal(LOGS.length, 1);
    assert.equal(LOGS[0].action, 'select_kol');
    assert.equal(LOGS[0].summary, 'คัดเลือก KOL: reviewafter6pm (3 คลิป)');
    await put(1, '/projects/5/submissions/101/person-status', { status: 'submitted', from_status: 'confirmed' });
    assert.equal(LOGS.at(-1).summary, 'รีเซ็ตสถานะ KOL: reviewafter6pm (3 คลิป)');
});

test('ค่าไม่ถูกต้อง = 400 · KOL รายคนเปลี่ยนสถานะรายคลิปไม่ได้ · แบรนด์อื่น / เอเจนซี่ = 403 · ไม่พบ = 404 · มีคนกดไปก่อน = 409', async () => {
    const n = CALLS.length;
    for (const body of [{ status: 'confirmed' }, { status: 'confirmed', from_status: 'confirmed' }, { status: 'hack', from_status: 'submitted' }, { status: 'confirmed', from_status: 'x' }]) {
        assert.equal((await put(1, '/projects/5/submissions/101/person-status', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await put(1, '/projects/6/submissions/101/person-status', { status: 'rejected', from_status: 'submitted' })).status, 400, 'KOL รายคน');
    assert.equal((await put(2, '/projects/5/submissions/101/person-status', { status: 'confirmed', from_status: 'submitted' })).status, 403);
    assert.equal((await put(3, '/projects/5/submissions/101/person-status', { status: 'confirmed', from_status: 'submitted' })).status, 403);
    assert.equal(CALLS.length, n, 'ไม่ถึง store');
    assert.equal((await put(1, '/projects/5/submissions/404/person-status', { status: 'confirmed', from_status: 'submitted' })).status, 404);
    const e = new Error('สถานะของคนนี้เพิ่งถูกเปลี่ยน'); e.status = 409; NEXT = e;
    const r = await put(1, '/projects/5/submissions/101/person-status', { status: 'confirmed', from_status: 'submitted' });
    assert.equal(r.status, 409);
    assert.match((await r.json()).message, /เพิ่งถูกเปลี่ยน/);
});
