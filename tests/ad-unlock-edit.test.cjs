const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// คลิปที่ยิงแอดแล้ว: แก้ลิงก์โพสต์ / Gencode / ID Post ได้เมื่อกดปลดล็อก + ยืนยันคำเตือน (ผู้ใช้สั่ง 22 ต.ค. 2026 — ทุกคนรวมเอเจนซี่ · ทั้ง 3 ช่อง)
// • ไม่ส่ง ad_unlock = ปฏิเสธเหมือนเดิม (409) · ส่ง ad_unlock: true เท่านั้นที่ผ่าน (ค่าอื่น เช่น "true" / 1 ไม่นับ)
// • เอเจนซี่แก้ = ป้าย "แก้หลังยิงแอด" (post_check 'changed') พร้อมรายการเดิม→ใหม่ ให้ทีมตรวจ · ทีมแก้ = ตรวจแล้ว + ลงประวัติแคมเปญ
// ฐานจำลองทั้งหมด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ad-unlock-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };

const base = require(path.join(SRC, 'store/pg/_base'));
let current = null;
const writes = [];
const fakeClient = {
    async query(q, vals = []) {
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: current ? [structuredClone(current)] : [] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            const w = Object.fromEntries(cols);
            writes.push(w);
            return { rows: [{ ...current, ...w }] };
        }
        if (/FROM projects/.test(q)) return { rows: [{ brand: 'Jernis', campaign_type: 'kol' }] };
        throw new Error('unexpected SQL: ' + q.slice(0, 90));
    }
};
base.withTransaction = async fn => fn(fakeClient);
const subsStore = require(path.join(SRC, 'store/pg/submissions'));
// ตัวจริงเก็บไว้ก่อน — ส่วนเทสต์เส้น API ด้านล่างแทน store.submissions.update (อ็อบเจกต์เดียวกัน) ด้วยตัวจำลอง
const realUpdate = subsStore.update.bind(subsStore);
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const tt = (over = {}) => ({ id: 5, project_id: 9, platform: 'TikTok', post_url: 'https://www.tiktok.com/@a/video/111', id_post: '7696453754509364488',
    gencode: '#TQoOu7', post_date: '2026-10-10', code_expire: 60, ad_status: 'ยิงแล้ว', ad_spend: 1500, status: 'confirmed', post_check: 'ok',
    account_name: 'kol_a', person_key: 'pk-a', agency_token: 'tk1', ...over });

test('store: คลิปยิงแอดแล้ว ไม่ปลดล็อก = 409 เหมือนเดิม · ปลดล็อก (adUnlock true) = แก้ได้ทั้ง 3 ช่อง', async () => {
    for (const fields of [{ gencode: '#NEW1' }, { id_post: '7690000000000000001' }, { post_url: 'https://www.tiktok.com/@a/video/222' }]) {
        current = tt(); writes.length = 0;
        await assert.rejects(realUpdate(5, 9, fields, 'ทีม', { actor: 'team' }), e => e.status === 409 && /ยิงแอดไปแล้ว/.test(e.message), JSON.stringify(fields));
        await assert.rejects(realUpdate(5, 9, fields, 'ทีม', { actor: 'team', adUnlock: 'true' }), e => e.status === 409, 'ต้องเป็น true จริง ๆ');
        assert.equal(writes.length, 0);
        const r = await realUpdate(5, 9, fields, 'ทีม', { actor: 'team', adUnlock: true });
        const [k, v] = Object.entries(fields)[0];
        assert.equal(writes[0][k], v, 'บันทึกค่าใหม่');
        assert.equal(r[k], v);
    }
    // คลิปที่ยังไม่ยิง: แก้ได้ตามปกติไม่ต้องปลดล็อก · ส่งค่าเดิม (ไม่เปลี่ยน) ของคลิปที่ยิงแล้วก็ไม่ติด
    current = tt({ ad_status: 'ยังไม่ยิง' }); writes.length = 0;
    await realUpdate(5, 9, { gencode: '#X' }, 'ทีม', { actor: 'team' });
    assert.equal(writes[0].gencode, '#X');
    current = tt(); writes.length = 0;
    await realUpdate(5, 9, { gencode: '#TQoOu7', post_date: '2026-10-11' }, 'ทีม', { actor: 'team' });
    assert.equal(writes[0].post_date, '2026-10-11');
});

test('store: เอเจนซี่ปลดล็อกแก้ = ป้าย "แก้หลังยิงแอด" (changed) พร้อมเดิม→ใหม่ · ทีมแก้ = ตรวจแล้ว (ok)', async () => {
    current = tt(); writes.length = 0;
    await realUpdate(5, 9, { gencode: '#NEW1', id_post: '7690000000000000001' }, 'Mesaran (เอเจนซี่)', { actor: 'agency', adUnlock: true });
    assert.equal(writes[0].post_check, 'changed', 'ยังอยู่หน้า Ads แต่มีป้ายให้ทีมตรวจ');
    const ch = typeof writes[0].post_check_changes === 'string' ? JSON.parse(writes[0].post_check_changes) : writes[0].post_check_changes;
    assert.deepEqual(ch.gencode, { from: '#TQoOu7', to: '#NEW1' });
    assert.deepEqual(ch.id_post, { from: '7696453754509364488', to: '7690000000000000001' });
    current = tt(); writes.length = 0;
    await realUpdate(5, 9, { gencode: '#NEW1' }, 'ทีม', { actor: 'team', adUnlock: true });
    assert.equal(writes[0].post_check, 'ok');
});

// ---------------------------------------------------------------- เส้น API (ทีม + เอเจนซี่ ส่ง ad_unlock ต่อให้ store)
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    3: { id: 3, username: 'agency1', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tk1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const ACT = [];
store.activity.log = async e => { ACT.push(e); return e; };
const project = { id: 9, name: 'KOL ต.ค.', brand: 'Jernis', team_id: 1, campaign_type: 'kol', ad_groups: [] };
store.projects.findByIdFull = async () => ({ ...project });
store.projects.findById = store.projects.findByIdFull;
store.projects.resolveToken = async t => (t === 'tk1' ? { project: { ...project }, link: { token: 'tk1', name: 'Mesaran', scoped: true, groups: [], products: [], platforms: [] } } : null);
store.submissions.get = async () => tt();
const CALLS = [];
store.submissions.update = async (subId, pid, fields, byName, opts) => { CALLS.push({ fields, opts }); return { ...tt(), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) }; };

let server, baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = 'http://127.0.0.1:' + server.address().port; });
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const call = async (uid, method, url, body) => {
    const a = ACCOUNTS[uid];
    const token = jwt.sign({ id: a.id, username: a.username, role: a.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
};

test('เส้น API: ส่ง ad_unlock: true ต่อให้ store (ทีม + เอเจนซี่) · ไม่ส่ง / ค่าอื่น = ไม่ปลดล็อก · ทีมปลดล็อกแก้ = ลงประวัติแคมเปญ', async () => {
    CALLS.length = 0; ACT.length = 0;
    assert.equal((await call(1, 'PUT', '/projects/9/submissions/5', { gencode: '#NEW1', ad_unlock: true })).status, 200);
    assert.equal(CALLS.at(-1).opts.adUnlock, true);
    assert.equal(CALLS.at(-1).fields.ad_unlock, undefined, 'ธงไม่ถูกเขียนลงแถว');
    assert.ok(ACT.some(e => /แก้ข้อมูลโพสต์หลังยิงแอด: kol_a/.test(e.summary) && /#NEW1/.test(e.summary)), 'ลงประวัติแคมเปญ');
    await call(1, 'PUT', '/projects/9/submissions/5', { gencode: '#NEW1' });
    assert.equal(CALLS.at(-1).opts.adUnlock, false);
    await call(1, 'PUT', '/projects/9/submissions/5', { gencode: '#NEW1', ad_unlock: 'true' });
    assert.equal(CALLS.at(-1).opts.adUnlock, false);
    // เอเจนซี่ (ลิงก์ของตัวเอง)
    assert.equal((await call(3, 'PUT', '/agency/tk1/submissions/5', { gencode: '#NEW2', ad_unlock: true })).status, 200);
    assert.deepEqual([CALLS.at(-1).opts.actor, CALLS.at(-1).opts.adUnlock], ['agency', true]);
    await call(3, 'PUT', '/agency/tk1/submissions/5', { gencode: '#NEW2' });
    assert.equal(CALLS.at(-1).opts.adUnlock, false);
});
