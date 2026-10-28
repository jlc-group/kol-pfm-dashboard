const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// คนตรวจคลิป + หน้า "งานของฉัน" (27 ต.ค. 2026) — เส้น API บน server จริง + store จำลอง (ไม่ต่อฐาน)
// ผู้ใช้สั่ง: งานของฉันเห็นเฉพาะเจ้าของบัญชี ยกเว้น Admin เห็นของทุกคน · ข้อมูลคนตรวจห้ามถึงบัญชีเอเจนซี่
// 28 ต.ค. 2026: หน้า My Work + ตั้งเป็นคนตรวจได้ เฉพาะทีม Reviewer (Admin ยังเข้าหน้า My Work ได้ แต่ตั้งเป็นคนตรวจไม่ได้)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-reviewer-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in reviewer-routes test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const u = (id, username, nickname, role, brands, over = {}) => ({ id, username, full_name: username, nickname, role, status: 'active', is_active: true, team_id: 1, brands, agency_tokens: [], ...over });
const REV = { team_name: 'Reviewer' };
const ACCOUNTS = {
    1: u(1, 'admin1', 'บอส', 'admin', [], { team_name: 'Admin' }),
    2: u(2, 'fon', 'ฝน', 'member', ['Jernis'], REV),
    3: u(3, 'praew', 'แพรว', 'member', ['Beauterry'], REV),
    4: u(4, 'mgr', 'แนน', 'manager', ['Jernis'], REV),
    5: u(5, 'ag', 'เอเจนซี่', 'agency', [], { agency_tokens: ['tok1'], team_name: 'Reviewer' }),
    6: u(6, 'old', 'คนเก่า', 'member', ['Jernis'], { is_active: false, team_name: 'Reviewer' }),
    7: u(7, 'adsguy', 'เอ็ม', 'member', ['Jernis'], { team_id: 3, team_name: 'Ads' })
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
store.users.listWithTeam = async () => Object.values(ACCOUNTS).map(a => ({ ...a }));

const PROJECTS = {
    5: { id: 5, name: 'Jernis Oct', brand: 'Jernis', team_id: 1, campaign_type: 'kol', status: 'Active',
        ad_groups: [{ key: 'g1', products: ['JNP1'] }, { key: 'g2', products: ['JNP2'] }], review_assign: {} },
    6: { id: 6, name: 'Beauterry Oct', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [], review_assign: { default: 3 } }
};
store.projects.findByIdFull = async id => (PROJECTS[Number(id)] ? structuredClone(PROJECTS[Number(id)]) : null);
const ASSIGN_CALLS = [];
store.projects.setReviewAssign = async (id, patch) => {
    ASSIGN_CALLS.push({ id, patch });
    const p = PROJECTS[Number(id)];
    const a = { default: p.review_assign.default || null, groups: { ...(p.review_assign.groups || {}) } };
    if (patch.default !== undefined) a.default = patch.default;
    Object.entries(patch.groups || {}).forEach(([k, v]) => { if (v) a.groups[k] = v; else delete a.groups[k]; });
    p.review_assign = a;
    return a;
};
const CLIP_CALLS = [];
store.submissions.setReviewer = async (pid, ids, rid) => { CLIP_CALLS.push({ pid, ids, rid }); return ids.map(id => ({ id, reviewer_id: rid, account_name: 'kol' + id })); };
const LOGS = [];
store.activity.log = async e => { LOGS.push(e); return e; };

const iso = days => new Date(Date.now() - days * 86400000).toISOString();
// ข้อมูลสำหรับหน้า "งานของฉัน" ตามที่ pg/submissions.js reviewRows คืน: แคมเปญ (รหัสกลุ่มตามลำดับ) + เฉพาะช่องของคลิปที่ขอ
const RP = [
    { id: 5, name: 'Jernis Oct', brand: 'Jernis', campaign_type: 'kol', review_assign: { default: 4, groups: { g1: 2 } }, group_keys: ['g1', 'g2'] },
    { id: 7, name: 'Jernis ไม่มีคนตรวจ', brand: 'Jernis', campaign_type: 'kol', review_assign: { groups: { g1: 2 } }, group_keys: ['g1', 'g2'] },
    { id: 6, name: 'Beauterry Oct', brand: 'Beauterry', campaign_type: 'kol', review_assign: { default: 3 }, group_keys: [] }
];
const R = (id, pid, over) => ({ id, project_id: pid, status: 'confirmed', account_name: 'kol' + id, platform: 'TikTok', product: 'JNP1', group_key: 'g1',
    draft_link: 'https://d/' + id, draft_status: null, post_url: null, post_url_at: null, draft_updated_at: iso(1), budget: 9999, ad_spend: 555,
    reviewer_id: null, ...over });
const ROWS = [
    R(11, 5, {}),                                              // กลุ่ม g1 → ฝน · รอตรวจ
    R(12, 5, { draft_status: 'revise' }),                      // ฝน · รอเอเจนซี่แก้
    R(13, 5, { group_key: 'g2' }),                             // ตามแคมเปญ → แนน
    R(14, 5, { group_key: 'g2', reviewer_id: 2 }),             // เฉพาะคลิป → ฝน
    R(15, 5, { draft_status: 'approve' }),                     // ฝน · Approve
    R(16, 5, { post_url: 'https://p', post_url_at: iso(2) }),  // ฝน · ลงงาน 2 วันก่อน
    R(17, 5, { post_url: 'https://p', post_url_at: iso(20) }), // ฝน · ลงงานนานแล้ว = ไม่นับ
    R(18, 5, { draft_link: null }),                            // ฝน · ยังไม่ส่งดราฟ = ไม่นับ
    R(19, 7, { group_key: 'g2' }),                             // ไม่มีคนตรวจ
    R(21, 6, { reviewer_id: 2 }),                              // แบรนด์อื่น (Beauterry) ตั้งให้ฝน — ฝนไม่มีสิทธิ์ = ไม่เห็น
    R(22, 404, { reviewer_id: 2 }),                            // แคมเปญที่ไม่อยู่ในรายการ (ยกเลิก / งานจ้างอื่น) = ไม่นับ
    R(23, 5, { group_key: 'g2', reviewer_id: 6 }),             // คนตรวจปิดบัญชีไปแล้ว = นับเป็นยังไม่มีคนตรวจ (ผลรีวิว)
    R(24, 5, { group_key: 'g2', reviewer_id: 99 }),            // คนตรวจถูกลบไปแล้ว = ยังไม่มีคนตรวจ
    R(25, 5, { group_key: 'g2', reviewer_id: 7 })              // ตั้งให้ทีม Ads ไว้ก่อนจำกัดทีม (28 ต.ค.) = ยังไม่มีคนตรวจ (Admin ตามเก็บได้)
];
const ASKED_COLS = [];
store.submissions.reviewRows = async columns => { ASKED_COLS.push(columns); return { projects: structuredClone(RP), rows: ROWS.map(r => structuredClone(r)) }; };

// ลิงก์เอเจนซี่ — ข้อมูลคนตรวจห้ามถึงบัญชีเอเจนซี่
store.projects.resolveToken = async token => (token === 'tok1'
    ? { project: structuredClone(PROJECTS[5]), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: false } }
    : null);
store.submissions.listByProject = async () => [{ id: 11, project_id: 5, status: 'confirmed', agency_token: 'tok1', account_name: 'kol11', budget: 100,
    reviewer_id: 2, draft_checked_by_id: 4, draft_checked_by: 'แนน', draft_checked_at: iso(1), draft_status: 'approve' }];

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
const call = (id, url, method = 'GET', body) => fetch(base + '/api' + url, {
    method, headers: { Authorization: `Bearer ${tokenOf(id)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
});
const json = async res => ({ status: res.status, body: await res.json() });

test('รายชื่อคนตรวจ = คนที่เห็นแบรนด์ของแคมเปญ (ไม่รวมเอเจนซี่ / ปิดบัญชี / แบรนด์อื่น) · เลือกได้ (pick) เฉพาะทีม Reviewer · ทีมอื่นส่งแค่ชื่อไว้โชว์', async () => {
    const r = await json(await call(2, '/projects/5/reviewer-options'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.map(x => [x.id, x.pick]).sort((a, b) => a[0] - b[0]), [[1, false], [2, true], [4, true], [7, false]]);
    assert.ok(r.body.data.every(x => Object.keys(x).sort().join() === 'id,name,pick'), 'ส่งแค่ id + ชื่อ + เลือกได้ไหม');
    assert.equal((await call(3, '/projects/5/reviewer-options')).status, 403, 'แบรนด์อื่น');
    assert.equal((await call(5, '/projects/5/reviewer-options')).status, 403, 'เอเจนซี่');
});

test('ตั้งคนตรวจทั้งแคมเปญ / รายกลุ่ม: ตรวจคนที่เลือกได้ · กลุ่มต้องมีจริง · ลงประวัติเป็นชื่อ', async () => {
    let r = await json(await call(2, '/projects/5/review-assign', 'PUT', { default: 4 }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { default: 4, groups: {} });
    r = await json(await call(2, '/projects/5/review-assign', 'PUT', { groups: { g1: 2, g2: null } }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { default: 4, groups: { g1: 2 } });
    assert.match(LOGS.at(-1).summary, /กลุ่มที่ 1 = ฝน · กลุ่มที่ 2 = ตามแคมเปญ/);
    assert.equal(LOGS.at(-1).action, 'assign_reviewer');
    for (const [body, why] of [[{ default: 3 }, 'แพรวไม่เห็นแบรนด์ Jernis'], [{ default: 5 }, 'เอเจนซี่'], [{ default: 6 }, 'ปิดบัญชี'],
        [{ default: 7 }, 'ทีม Ads ไม่ใช่ Reviewer'], [{ default: 1 }, 'Admin ไม่อยู่ทีม Reviewer'], [{ groups: { g1: 7 } }, 'กลุ่ม = ทีม Ads'],
        [{ groups: { nope: 2 } }, 'กลุ่มไม่มีจริง'], [{ groups: [1] }, 'groups ผิดรูป'], [{}, 'ไม่มีอะไรให้บันทึก']]) {
        assert.equal((await call(2, '/projects/5/review-assign', 'PUT', body)).status, 400, why);
    }
    assert.equal((await call(3, '/projects/5/review-assign', 'PUT', { default: 2 })).status, 403);
    assert.equal((await call(5, '/projects/5/review-assign', 'PUT', { default: 2 })).status, 403);
    r = await json(await call(1, '/projects/5/review-assign', 'PUT', { default: null }));
    assert.equal(r.body.data.default, null, 'null = ล้าง');
});

test('ตั้งคนตรวจรายคลิป: ตรวจคนที่เลือกได้ · null = กลับไปตามกลุ่ม / แคมเปญ', async () => {
    CLIP_CALLS.length = 0;
    let r = await json(await call(2, '/projects/5/clip-reviewer', 'PUT', { sub_ids: [11, 12], reviewer_id: 4 }));
    assert.equal(r.status, 200);
    assert.deepEqual(CLIP_CALLS[0], { pid: '5', ids: [11, 12], rid: 4 });
    assert.match(LOGS.at(-1).summary, /kol11, kol12 = แนน/);
    r = await json(await call(2, '/projects/5/clip-reviewer', 'PUT', { sub_ids: [11], reviewer_id: null }));
    assert.equal(CLIP_CALLS[1].rid, null);
    assert.match(LOGS.at(-1).summary, /ตามกลุ่ม \/ แคมเปญ/);
    assert.equal((await call(2, '/projects/5/clip-reviewer', 'PUT', { sub_ids: [11], reviewer_id: 3 })).status, 400);
    const bad = await json(await call(2, '/projects/5/clip-reviewer', 'PUT', { sub_ids: [11], reviewer_id: 7 }));
    assert.equal(bad.status, 400, 'ทีม Ads');
    assert.match(bad.body.message, /ทีม Reviewer/);
    assert.equal(CLIP_CALLS.length, 2);
});

test('งานของฉัน: เห็นเฉพาะคลิปที่ตัวเองเป็นคนตรวจ (กลุ่ม / รายคลิป) · ไม่นับยังไม่ส่งดราฟ / ลงงานเกิน 7 วัน · ไม่เห็นแบรนด์ที่ไม่มีสิทธิ์ · ไม่มีข้อมูลเงิน', async () => {
    const r = await json(await call(2, '/my-work'));
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.equal(d.user, 2);
    assert.deepEqual(d.rows.map(x => x.id).sort((a, b) => a - b), [11, 12, 14, 15, 16]);
    assert.deepEqual(d.counts, { review: 2, revise: 1, approved: 1, posted: 1 });
    const own = d.rows.find(x => x.id === 14);
    assert.equal(own.reviewer_from, 'clip');
    assert.equal(d.rows.find(x => x.id === 11).group_no, 1);
    assert.equal(d.rows.find(x => x.id === 11).draft_no, 1);
    const text = JSON.stringify(r.body);
    assert.equal(/"budget"|"ad_spend"|9999|555/.test(text), false, 'ไม่มีค่าตัว / ค่าแอด');
    const c = await json(await call(2, '/my-work/count'));
    assert.deepEqual(c.body.data, { review: 2 });
    assert.ok(!ASKED_COLS.at(-1).includes('feedback') && ASKED_COLS.at(-1).includes('reviewer_id'), 'เลขแดงเมนูอ่านเฉพาะช่องที่ใช้');
    assert.ok(ASKED_COLS.at(-2).includes('draft_remark5'), 'หน้ารายการอ่านช่องที่หน้าต่างดราฟใช้');
});

test('งานของฉัน: คนที่ไม่ใช่ Admin ดูของคนอื่นไม่ได้ (รวม Manager) · Admin ดูของทุกคน + คลิปที่ยังไม่มีคนตรวจได้ · เอเจนซี่เข้าไม่ได้', async () => {
    assert.equal((await call(2, '/my-work?user=4')).status, 403);
    assert.equal((await call(4, '/my-work?user=2')).status, 403, 'Manager ก็ดูของคนอื่นไม่ได้');
    assert.equal((await call(2, '/my-work?user=unassigned')).status, 403);
    assert.equal((await call(2, '/my-work?user=2')).status, 200, 'ส่ง id ตัวเองมาได้');
    let r = await json(await call(1, '/my-work?user=2'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.rows.map(x => x.id).sort((a, b) => a - b), [11, 12, 14, 15, 16, 21], 'Admin เห็นทุกแบรนด์ รวมคลิป Beauterry ที่ตั้งให้ฝน');
    r = await json(await call(1, '/my-work?user=unassigned'));
    assert.deepEqual(r.body.data.rows.map(x => x.id), [19, 23, 24, 25], 'คนตรวจปิดบัญชี / ถูกลบ / เข้า My Work ไม่ได้แล้ว (ทีม Ads) = ยังไม่มีคนตรวจ (Admin ตามเก็บได้)');
    assert.equal((await json(await call(1, '/my-work?user=7'))).body.data.rows.length, 0, 'ไม่ค้างเป็นงานของคนทีม Ads ที่เปิดหน้านี้ไม่ได้');
    assert.equal((await json(await call(1, '/my-work?user=6'))).body.data.rows.length, 0);
    r = await json(await call(4, '/my-work'));
    assert.deepEqual(r.body.data.rows.map(x => x.id), [13], 'แนน (Manager) เห็นงานของตัวเอง');
    assert.equal((await call(1, '/my-work?user=abc')).status, 400);
    assert.equal((await call(5, '/my-work')).status, 403, 'เอเจนซี่');
    assert.equal((await call(5, '/my-work/count')).status, 403);
});

test('หน้า My Work: เฉพาะทีม Reviewer + Admin (28 ต.ค. 2026) · ทีมอื่น / ไม่มีทีม = 403 ทั้งรายการและเลขแดง', async () => {
    const r7 = await json(await call(7, '/my-work'));
    assert.equal(r7.status, 403, 'ทีม Ads');
    assert.match(r7.body.message, /Reviewer/);
    assert.equal((await call(7, '/my-work/count')).status, 403);
    ACCOUNTS[8] = u(8, 'noteam', 'ไม่มีทีม', 'member', ['Jernis'], { team_id: null, team_name: null });
    try {
        assert.equal((await call(8, '/my-work/count')).status, 403, 'ไม่มีทีม');
    } finally { delete ACCOUNTS[8]; }
    ACCOUNTS[9] = u(9, 'case', 'ตัวเล็ก', 'member', ['Jernis'], { team_name: ' reviewer ' });
    try {
        assert.equal((await call(9, '/my-work/count')).status, 200, 'ชื่อทีมตัวเล็ก / มีช่องว่าง ก็นับเป็น Reviewer');
    } finally { delete ACCOUNTS[9]; }
    assert.equal((await call(1, '/my-work/count')).status, 200, 'Admin (ทีม Admin) ยังเข้าได้');
    assert.equal((await call(2, '/my-work/count')).status, 200, 'ทีม Reviewer');
});

test('ลิงก์เอเจนซี่: บัญชีเอเจนซี่ไม่ได้รับคนตรวจ / ใครตรวจดราฟ · ทีมที่เปิดลิงก์เดียวกันยังเห็น', async () => {
    let r = await json(await call(5, '/agency/tok1'));
    assert.equal(r.status, 200);
    const s = r.body.data.submissions[0];
    for (const k of ['reviewer_id', 'draft_checked_by_id', 'draft_checked_by', 'draft_checked_at']) assert.equal(k in s, false, k);
    assert.equal(s.draft_status, 'approve', 'ผลตรวจยังเห็นตามเดิม');
    r = await json(await call(1, '/agency/tok1'));
    assert.equal(r.body.data.submissions[0].draft_checked_by, 'แนน');
});
