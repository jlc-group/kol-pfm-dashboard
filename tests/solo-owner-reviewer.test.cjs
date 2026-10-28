const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// KOL รายคน: คนตรวจ = ผู้ดูแลที่เลือกตอนเพิ่มรายชื่อ (ผู้ใช้สั่ง 28 ต.ค. 2026) · server จริง + store จำลอง (ไม่ต่อฐาน)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-solo-owner-reviewer-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in solo-owner-reviewer test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const U = (id, over) => ({ id, status: 'active', is_active: true, agency_tokens: [], brands: ['Beauterry'], role: 'member', full_name: null, nickname: null, ...over });
const ACCOUNTS = {
    1: U(1, { username: 'praewpraew', role: 'admin', team_id: 1, team_name: 'Admin', brands: [] }),
    2: U(2, { username: 'sai', nickname: 'Sai', team_id: 2, team_name: 'Reviewer' }),
    3: U(3, { username: 'mook', full_name: 'Mook', team_id: 2, team_name: 'Reviewer', brands: ['Jernis'] }),   // ไม่เห็น Beauterry
    4: U(4, { username: 'adsguy', nickname: 'เอ็ม', team_id: 3, team_name: 'Ads' }),
    5: U(5, { username: 'bewty', team_id: 2, team_name: 'Reviewer' }),
    6: U(6, { username: 'Bewty', team_id: 2, team_name: 'Reviewer' }),
    7: U(7, { username: 'ag', role: 'agency', nickname: 'Sai2', team_id: null, team_name: null })
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
store.users.listWithTeam = async () => Object.values(ACCOUNTS).map(u => ({ ...u }));
store.activity.log = async e => e;
let PROJ, ASSIGNS;
beforeEach(() => {
    ASSIGNS = [];
    PROJ = { id: 50, name: 'KOL รายคน', brand: 'Beauterry', team_id: 2, campaign_type: 'solo', owner: 'Sai', review_assign: {},
        ad_groups: [{ key: 'g1', platform: 'TikTok', platforms: ['TikTok'], blocks: [{ platform: 'TikTok' }], solo: {} }] };
});
store.projects.createSolo = async fields => ({ project: { id: 50, name: fields.name, brand: fields.brand, owner: fields.owner, review_assign: {} }, rows: [] });
store.projects.findByIdFull = async id => (Number(id) === 50 ? structuredClone(PROJ) : null);
store.projects.updateSolo = async (id, { fields }) => { Object.assign(PROJ, fields); return { project: structuredClone(PROJ) }; };
store.projects.setReviewAssign = async (id, patch) => {
    ASSIGNS.push({ id: Number(id), patch });
    PROJ.review_assign = { default: patch.default || null, groups: {} };
    return PROJ.review_assign;
};

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
const call = (method, url, body) => fetch(base + '/api' + url, { method, headers: { Authorization: `Bearer ${tokenOf(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const TT = { platform: 'TikTok', account_name: '@ppp', link_account: 'https://www.tiktok.com/@ppp', followers: 5000, tier: 'Nano 1k - 10k', fee: 0,
    content_type: 'Review', campaign: 'VDO View', media_type: 'VDO', content_format: 'Review', target: [] };
const body = owner => ({ contact_mode: 'self', brand: 'Beauterry', products: ['BTA4-01'], clips: 1, owner, code_expire: 60, platforms: [TT] });

test('เพิ่ม KOL รายคน: คนตรวจทั้งรายการ = ผู้ดูแล (เก็บเป็น id) · Admin เป็นผู้ดูแลก็ได้ (มีหน้า My Work)', async () => {
    let r = await call('POST', '/projects/solo', body('Sai'));
    assert.equal(r.status, 201);
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 2 } }]);
    assert.equal((await r.json()).data.project.review_assign.default, 2);
    ASSIGNS = [];
    r = await call('POST', '/projects/solo', body('praewpraew'));
    assert.equal(r.status, 201);
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 1 } }]);
    ASSIGNS = [];
    await call('POST', '/projects/solo', body('sai'));   // ตัวพิมพ์ไม่ตรง → ไม่สนตัวพิมพ์ (คนเดียว)
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 2 } }]);
});

test('เพิ่ม KOL รายคน: ผู้ดูแลทีมอื่น / ไม่เห็นแบรนด์ / ชื่อซ้ำหลายคน / ไม่พบ = ไม่ตั้ง (ยังเพิ่มได้ตามปกติ)', async () => {
    for (const owner of ['เอ็ม', 'Mook', 'BEWTY', 'ไม่มีคนนี้', 'Sai2']) {
        ASSIGNS = [];
        const r = await call('POST', '/projects/solo', body(owner));
        assert.equal(r.status, 201, owner);
        assert.deepEqual(ASSIGNS, [], owner);
    }
    // ชื่อตรงตัวเจอคนเดียว (bewty) แม้ไม่สนตัวพิมพ์จะเจอ 2 คน
    ASSIGNS = [];
    await call('POST', '/projects/solo', body('bewty'));
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 5 } }]);
});

test('แก้ไข KOL รายคน: เปลี่ยนผู้ดูแล → คนตรวจตาม · ไม่เปลี่ยน = ไม่แตะ · ตั้งเองเป็นคนอื่น = ไม่แตะ · รายการเก่าที่ยังไม่มีคนตรวจ = ตั้งให้', async () => {
    // รายการเก่า (ก่อน 28 ต.ค.) ยังไม่มีคนตรวจ · กดแก้ไข-บันทึก (ผู้ดูแลเดิม) → ตั้งตามผู้ดูแล
    let r = await call('PUT', '/projects/50/solo', body('Sai'));
    assert.equal(r.status, 200);
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 2 } }]);
    // แก้อย่างอื่น ผู้ดูแลเดิม → ไม่เขียนซ้ำ
    ASSIGNS = [];
    await call('PUT', '/projects/50/solo', body('Sai'));
    assert.deepEqual(ASSIGNS, []);
    // เปลี่ยนผู้ดูแล Sai → praewpraew → คนตรวจตาม
    await call('PUT', '/projects/50/solo', body('praewpraew'));
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: 1 } }]);
    // เปลี่ยนเป็นคนที่ตั้งไม่ได้ (ทีม Ads) → ล้าง (คนตรวจเดิมคือผู้ดูแลเดิม ไม่ใช่คนที่ตั้งเอง)
    ASSIGNS = [];
    await call('PUT', '/projects/50/solo', body('เอ็ม'));
    assert.deepEqual(ASSIGNS, [{ id: 50, patch: { default: null } }]);
    // ตั้งคนตรวจเองเป็นคนอื่น (Sai) ทั้งที่ผู้ดูแลคือ praewpraew → เปลี่ยนผู้ดูแลแล้วไม่ทับคนที่ตั้งเอง
    PROJ.owner = 'praewpraew'; PROJ.review_assign = { default: 2, groups: {} };
    ASSIGNS = [];
    await call('PUT', '/projects/50/solo', body('bewty'));
    assert.deepEqual(ASSIGNS, []);
    assert.equal(PROJ.review_assign.default, 2);
});
