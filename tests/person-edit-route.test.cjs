const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// PUT /api/projects/:id/submissions/:subId/person — ทีมแก้ข้อมูล Account ครบทุกคลิปของคนนั้น (ปุ่มแก้ไขในตารางรายชื่อ · 16 พ.ย. 2026)
// server จริง + store จำลอง (ไม่ต่อฐาน)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-person-edit-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in person-edit-route test'); };
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
// กลุ่ม g1: TikTok ทำคนละ 2 คลิป · Instagram คนละ 1 คลิป
const G1 = { key: 'g1', platforms: ['TikTok', 'Instagram'], products: ['JNP1', 'JNP2'],
    blocks: [{ platform: 'TikTok', clips: ['คลิป 1', 'คลิป 2'] }, { platform: 'Instagram', clips: ['คลิป 1'] }],
    allocations: [{ platform: 'TikTok', content_type: 'Review', tier: 'Nano 1k - 10k', kols: 5 }, { platform: 'Instagram', content_type: 'Reels', tier: 'Nano 1k - 10k', kols: 3 }] };
const PROJECTS = {
    5: { id: 5, name: 'Jernis Nov', brand: 'Jernis', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [G1] },
    6: { id: 6, name: 'KOL รายคน', brand: 'Jernis', team_id: 1, campaign_type: 'solo', status: 'Active', ad_groups: [] }
};
store.projects.findByIdFull = async id => (PROJECTS[Number(id)] ? structuredClone(PROJECTS[Number(id)]) : null);
const SUB = f => ({ project_id: 5, group_key: 'g1', platform: 'TikTok', content_type: 'Review', tier: 'Nano 1k - 10k', followers: 12000,
    product: 'JNP1', agency: 'ป้อมข้าว', link_account: 'https://tiktok.com/@a', status: 'confirmed', ad_status: 'ยังไม่ยิง', post_url: null, id_post: null, budget: 32000, ...f });
let SUBS = [];
const reset = () => {
    SUBS = [
        // emmaemmy 2 คลิป ยังไม่ลงโพสต์
        SUB({ id: 101, account_name: 'emmaemmy', person_key: 'pa', clip_no: 1 }),
        SUB({ id: 102, account_name: 'emmaemmy', person_key: 'pa', clip_no: 2 }),
        // ลงโพสต์แล้ว / ยิงแอดแล้ว
        SUB({ id: 103, account_name: 'posted', person_key: 'pb', post_url: 'https://tiktok.com/v/1' }),
        SUB({ id: 104, account_name: 'shot', person_key: 'pc', ad_status: 'ยิงแล้ว' }),
        // คลิปเดียว ไม่มี person_key (Instagram ทำ 1 คลิป)
        SUB({ id: 105, account_name: 'single', person_key: null, platform: 'Instagram', content_type: 'Reels' })
    ];
};
reset();
store.submissions.listByProject = async pid => SUBS.filter(s => s.project_id === Number(pid)).map(s => ({ ...s }));
const CALLS = [], LOGS = [];
store.submissions.updatePerson = async (subId, pid, fields, byName, opts) => {
    CALLS.push({ subId, pid, fields: { ...fields }, byName, opts });
    const t = SUBS.find(s => s.id === Number(subId));
    const sibs = t.person_key ? SUBS.filter(s => s.person_key === t.person_key) : [t];
    sibs.forEach(s => Object.assign(s, fields, (opts && opts.perRow && opts.perRow[s.id]) || {}));
    return { ...t };
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

test('แก้ข้อมูลตัวคน: เขียนครบทุกคลิป (updatePerson) · ส่งเฉพาะช่องที่รู้จัก ไม่มีค่าตัว · ลงประวัติเดิม → ใหม่ + จำนวนคลิป', async () => {
    reset(); CALLS.length = 0; LOGS.length = 0;
    const r = await put(1, '/projects/5/submissions/101/person', {
        account_name: '  emmaemmy_new ', followers: '25000', tier: 'Micro 10k - 100k', product: 'JNP1,JNP2',
        agency: 'แพรวแพรว', link_account: 'https://tiktok.com/@new', budget: 1, status: 'rejected', post_url: 'x'
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.data.map(s => s.id), [101, 102], 'คืนทุกคลิปของคนนี้');
    assert.ok(j.data.every(s => s.account_name === 'emmaemmy_new' && s.followers === 25000));
    assert.equal(CALLS.length, 1);
    assert.deepEqual(CALLS[0].fields, { account_name: 'emmaemmy_new', followers: 25000, tier: 'Micro 10k - 100k', product: 'JNP1,JNP2', agency: 'แพรวแพรว', link_account: 'https://tiktok.com/@new' },
        'ไม่ส่ง budget / status / post_url ต่อ');
    assert.deepEqual(CALLS[0].opts, { actor: 'team' });
    assert.equal(CALLS[0].byName, 'ฝน');
    assert.equal(LOGS.length, 1);
    assert.equal(LOGS[0].action, 'update_kol');
    assert.match(LOGS[0].summary, /^แก้ข้อมูล KOL: emmaemmy \(2 คลิป\) · /);
    assert.match(LOGS[0].summary, /ชื่อ emmaemmy → emmaemmy_new/);
    assert.match(LOGS[0].summary, /ยอดฟอล 12000 → 25000/);
    assert.match(LOGS[0].summary, /KOL Contact ป้อมข้าว → แพรวแพรว/);
    assert.doesNotMatch(LOGS[0].summary, /Platform/);
});

test('ค่าเดิมทั้งหมด = บันทึกได้แต่ไม่ลงประวัติ · ช่องว่าง = ล้างเป็น null', async () => {
    reset(); CALLS.length = 0; LOGS.length = 0;
    assert.equal((await put(1, '/projects/5/submissions/101/person', { account_name: 'emmaemmy', product: 'JNP1' })).status, 200);
    assert.equal(LOGS.length, 0);
    assert.equal((await put(1, '/projects/5/submissions/101/person', { link_account: '  ', agency: '' })).status, 200);
    assert.deepEqual(CALLS.at(-1).fields, { link_account: null, agency: null });
});

test('ตรวจค่า: ชื่อว่าง / ยอดฟอลติดลบ / ลิงก์ไม่ใช่ http / คละ Tier / ไม่มีอะไรให้แก้ = 400 และไม่ถึง store', async () => {
    reset(); CALLS.length = 0;
    for (const body of [{ account_name: '  ' }, { followers: -5 }, { followers: 'abc' }, { link_account: 'javascript:alert(1)' }, { link_account: 'tiktok.com/@a' },
        { tier: 'คละ Tier' }, {}, { budget: 5000 }, { platform: '' }]) {
        const r = await put(1, '/projects/5/submissions/101/person', body);
        assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(CALLS.length, 0);
});

test('เปลี่ยน Platform: ลงโพสต์ / ยิงแอดแล้ว = ไม่ได้ · ไม่มีในกลุ่ม = ไม่ได้ · จำนวนคลิปไม่เท่า = ไม่ได้ · เท่ากัน = ได้', async () => {
    reset(); CALLS.length = 0;
    let r = await put(1, '/projects/5/submissions/103/person', { platform: 'Instagram' });
    assert.equal(r.status, 400); assert.match((await r.json()).message, /ลงโพสต์หรือยิงแอดแล้ว/);
    r = await put(1, '/projects/5/submissions/104/person', { platform: 'Instagram' });
    assert.equal(r.status, 400); assert.match((await r.json()).message, /ลงโพสต์หรือยิงแอดแล้ว/);
    r = await put(1, '/projects/5/submissions/101/person', { platform: 'Facebook' });
    assert.equal(r.status, 400); assert.match((await r.json()).message, /กลุ่มนี้ไม่มี Facebook/);
    r = await put(1, '/projects/5/submissions/101/person', { platform: 'Instagram' });
    assert.equal(r.status, 400); assert.match((await r.json()).message, /ตั้งไว้ 1 คลิป แต่คนนี้มี 2 คลิป/);
    r = await put(1, '/projects/5/submissions/105/person', { platform: 'TikTok', content_type: 'Review' });
    assert.equal(r.status, 400, 'Instagram 1 คลิป → TikTok 2 คลิป ไม่ได้');
    assert.equal(CALLS.length, 0);
    // ช่องอื่นของคนที่ลงโพสต์แล้วยังแก้ได้ (ส่ง Platform เดิมมาด้วยก็ไม่ติด)
    r = await put(1, '/projects/5/submissions/103/person', { platform: 'TikTok', account_name: 'posted2' });
    assert.equal(r.status, 200);
    // ช่องอื่นอย่างเดียว (ไม่ย้าย Platform) = ไม่แตะชื่อคลิป
    assert.deepEqual(CALLS.at(-1).opts, { actor: 'team' });
    // คลิปเท่ากัน: Instagram ตั้ง 2 คลิปชื่อของตัวเอง → คนที่มี 2 คลิปย้ายได้ และชื่อคลิปเปลี่ยนเป็นของ Instagram ตามลำดับคลิป
    PROJECTS[5].ad_groups[0].blocks[1].clips = ['Reel', 'Story'];
    try {
        r = await put(1, '/projects/5/submissions/101/person', { platform: 'Instagram', content_type: 'Reels' });
        assert.equal(r.status, 200);
        assert.deepEqual(CALLS.at(-1).fields, { platform: 'Instagram', content_type: 'Reels' });
        assert.deepEqual(CALLS.at(-1).opts, { actor: 'team', perRow: { 101: { clip_name: 'Reel' }, 102: { clip_name: 'Story' } } });
        assert.deepEqual(SUBS.filter(s => s.person_key === 'pa').map(s => [s.platform, s.clip_name]), [['Instagram', 'Reel'], ['Instagram', 'Story']]);
    } finally { PROJECTS[5].ad_groups[0].blocks[1].clips = ['คลิป 1']; }
    // คลิปเดียว: ชื่อคลิปเดียวของ Platform ใหม่ (ไม่มีชื่อ = null) — กติกาเดียวกับตอนเพิ่มคน
    PROJECTS[5].ad_groups[0].blocks[0].clips = [];
    try {
        r = await put(1, '/projects/5/submissions/105/person', { platform: 'TikTok', content_type: 'Review' });
        assert.equal(r.status, 200);
        assert.deepEqual(CALLS.at(-1).opts.perRow, { 105: { clip_name: null } });
    } finally { PROJECTS[5].ad_groups[0].blocks[0].clips = ['คลิป 1', 'คลิป 2']; }
});

test('สิทธิ์: KOL รายคน = 400 · แบรนด์อื่น / เอเจนซี่ = 403 · ไม่อยู่ในแคมเปญ = 404', async () => {
    reset(); CALLS.length = 0;
    assert.equal((await put(1, '/projects/6/submissions/101/person', { account_name: 'x' })).status, 400);
    assert.equal((await put(2, '/projects/5/submissions/101/person', { account_name: 'x' })).status, 403);
    assert.equal((await put(3, '/projects/5/submissions/101/person', { account_name: 'x' })).status, 403);
    assert.equal((await put(1, '/projects/5/submissions/999/person', { account_name: 'x' })).status, 404);
    assert.equal(CALLS.length, 0);
});
