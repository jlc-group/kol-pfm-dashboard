const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// PUT /api/projects/:id/fee-free — KOL ที่ได้มาฟรี / ไม่มีค่าตัว (27 ต.ค. 2026) · server จริง + store จำลอง (ไม่ต่อฐาน)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-fee-free-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in fee-free-route test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = {
    1: { id: 1, username: 'fon', full_name: 'Fon', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jernis'], agency_tokens: [] },
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
store.submissions.setFeeFree = async (pid, items, free, byName) => {
    CALLS.push({ pid, items, free, byName });
    return { rows: items.map(it => ({ id: it.sub_id, budget: 0, fee_free: free })),
        changed: items.map((it, i) => ({ id: it.sub_id, account_name: 'bbboleyn', clip_no: i + 1, from: i === 0 ? 1500 : 0 })) };
};
store.activity.log = async e => { LOGS.push(e); return e; };
// ลิงก์เอเจนซี่: บัญชีเอเจนซี่ไม่เห็นค่าตัว / ได้ฟรี
store.projects.resolveToken = async token => (token === 'tok1'
    ? { project: structuredClone(PROJECTS[5]), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: false } } : null);
store.submissions.listByProject = async () => [{ id: 11, project_id: 5, status: 'confirmed', agency_token: 'tok1', account_name: 'bbboleyn', budget: 0, fee_free: true }];

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
const call = (uid, url, method = 'GET', body) => fetch(base + '/api' + url, { method, headers: { Authorization: `Bearer ${tokenOf(uid)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('ยืนยันได้ฟรีทั้งคน · ลงประวัติ "ได้มาฟรี" พร้อมค่าตัวเดิมที่ถูกเปลี่ยนเป็น 0 · ยกเลิกฟรีก็ลงประวัติ', async () => {
    const r = await call(1, '/projects/5/fee-free', 'PUT', { free: true, items: [{ sub_id: 11, from: 1500 }, { sub_id: 12, from: 0 }] });
    assert.equal(r.status, 200);
    assert.deepEqual(CALLS.at(-1), { pid: '5', items: [{ sub_id: 11, from: 1500 }, { sub_id: 12, from: 0 }], free: true, byName: 'Fon' });
    assert.equal(LOGS.at(-1).action, 'fee');
    assert.equal(LOGS.at(-1).summary, 'ได้มาฟรี (ไม่มีค่าตัว): bbboleyn (2 คลิป) · ค่าตัวเดิม ฿1,500 → ฿0');
    await call(1, '/projects/5/fee-free', 'PUT', { free: false, items: [{ sub_id: 11 }] });
    assert.match(LOGS.at(-1).summary, /^ยกเลิกได้มาฟรี: bbboleyn/);
});

test('ค่าไม่ถูกต้อง = 400 · KOL รายคนไม่ใช้เส้นนี้ · แบรนด์อื่น / เอเจนซี่ = 403', async () => {
    const n = CALLS.length;
    for (const body of [{ items: [{ sub_id: 11 }] }, { free: 'yes', items: [{ sub_id: 11 }] }, { free: true, items: [] }, { free: true, items: [{ sub_id: 'x' }] }, { free: true, items: [{ sub_id: 11, from: 'a' }] }]) {
        assert.equal((await call(1, '/projects/5/fee-free', 'PUT', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(1, '/projects/6/fee-free', 'PUT', { free: true, items: [{ sub_id: 11 }] })).status, 400, 'KOL รายคน');
    assert.equal((await call(2, '/projects/5/fee-free', 'PUT', { free: true, items: [{ sub_id: 11 }] })).status, 403);
    assert.equal((await call(3, '/projects/5/fee-free', 'PUT', { free: true, items: [{ sub_id: 11 }] })).status, 403);
    assert.equal(CALLS.length, n);
});

test('ลิงก์เอเจนซี่: บัญชีเอเจนซี่ไม่ได้รับทั้งค่าตัวและป้ายได้ฟรี · ทีมที่เปิดลิงก์เห็น', async () => {
    let r = await (await call(3, '/agency/tok1')).json();
    assert.deepEqual([r.data.submissions[0].budget, r.data.submissions[0].fee_free], [null, null]);
    r = await (await call(1, '/agency/tok1')).json();
    assert.equal(r.data.submissions[0].fee_free, true);
});
