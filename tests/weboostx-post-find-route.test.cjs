const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Ads: หาโพสต์ IG / FB จาก WeBoostX ให้แถวที่ยังไม่มี ID POST (26 ต.ค. 2026)
// GET /api/ads/:id/wx-posts (ตัวเลือก) · POST /api/ads/:id/wx-confirm (คนยืนยัน → ถาม WeBoostX ซ้ำ → เก็บ ID POST → ลงค่าแอด)
// WeBoostX จำลองผ่าน fetch · ไม่ต่อฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-wx-find-test-'));
const KEY = 'fixture-key-' + crypto.randomBytes(8).toString('hex');
process.env.WEBOOSTX_PFM_EXPORT_KEY = KEY;
process.env.WEBOOSTX_PFM_BASE_URL = 'http://127.0.0.1:8201';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in weboostx-post-find-route test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const wxStore = require(path.join(SRC, 'store/pg/weboostxSync'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'fon', full_name: 'Fon', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Beauterry'] },
    3: { id: 3, username: 'praew', full_name: 'Praew', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jernis'] },
    4: { id: 4, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tok1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const IG_LINK = 'https://www.instagram.com/reel/DeI-YpaS2Yf/?stkn=MWVqb3g4OXhvMWY2aw==';
const SUBS = {
    21: { id: 21, project_id: 5, platform: 'Instagram', account_name: 'beiieo', link_account: 'https://www.instagram.com/beiieo/', post_date: '2026-10-06',
        product: 'BTA4-02', post_url: IG_LINK, id_post: null, gencode: 'adcode-x', ad_status: 'ยิงแล้ว', post_check: 'ok' },
    22: { id: 22, project_id: 5, platform: 'Facebook', account_name: 'fbkol', post_date: '2026-10-10', product: 'BTA2-02',
        post_url: 'https://www.facebook.com/share/p/abc/', id_post: '', ad_status: 'ยังไม่ยิง', post_check: null },
    23: { id: 23, project_id: 5, platform: 'Instagram', account_name: 'has_id', post_url: IG_LINK, id_post: '177', ad_status: 'ยิงแล้ว' },
    24: { id: 24, project_id: 5, platform: 'TikTok', account_name: 'tt', post_url: 'https://www.tiktok.com/@a/video/1', id_post: null },
    25: { id: 25, project_id: 5, platform: 'Instagram', account_name: 'old', post_date: '2025-01-01', post_url: IG_LINK, id_post: null },
    26: { id: 26, project_id: 5, platform: 'Instagram', account_name: 'waiting', post_url: IG_LINK, id_post: null, post_check: 'pending' }
};
store.ads.subContext = async id => {
    const s = SUBS[Number(id)];
    return s ? { submission: { ...s }, project_id: 5, team_id: 1, brand: 'Beauterry', project_name: 'Beauterry Oct', account_name: s.account_name } : null;
};
const updates = [], applied = [], logs = [];
store.submissions.update = async (id, pid, fields, byName, opts) => { updates.push({ id, pid, fields, byName, opts }); return { ...SUBS[id], ...fields }; };
store.activity.log = async e => { logs.push(e); return e; };
wxStore.apply = async rows => { applied.push(...rows); return { updated: rows.length, stamped: 0, skipped: 0 }; };
wxStore.idPostUsers = async ids => (ids.includes('18100000000000002') ? [{ id: 99, id_post: '18100000000000002', account_name: 'other_kol', brand: 'Beauterry' },
    { id: 98, id_post: '18100000000000002', account_name: 'secret_jernis', brand: 'Jernis' }] : []);

const P = (id, over) => ({ platform: 'instagram', id_post: id, fb_story_id: null, permalink: `https://www.instagram.com/reel/P${id.slice(-3)}/`,
    brand: 'Beauterry', brand_code: 'BEAUTERRY', creator: null, post_date: null, sku_codes: [], ads_count: 2, active_ads: 1,
    ad_spend: 250.5, ad_reach: 1288, first_ad_date: '2026-10-07', last_ad_date: '2026-10-20', ...over });
const POSTS = {
    instagram: [
        P('18100000000000001', { creator: 'beiieo', post_date: '2026-10-06', sku_codes: ['BTA4-02'] }),
        P('18100000000000002', { creator: 'belleo', post_date: '2026-10-05', sku_codes: ['BTA4-02'] }),
        P('18100000000000003', { creator: 'someoneelse', post_date: '2026-09-01', sku_codes: ['BTA1-01'] }),
        P('18100000000000005', { creator: 'beiieo', post_date: '2026-10-06', permalink: 'javascript:alert(1)' }),
        P('18100000000000008', { creator: 'beiieo', post_date: '2026-10-06', sku_codes: ['BTA4-02'], brand: 'Jernis', brand_code: 'JERNIS', ad_spend: 9999 }),
        P('18100000000000009', { creator: 'beiieo', post_date: '2026-10-06', brand: null, brand_code: null })
    ],
    facebook: [P('887205877244964', { platform: 'facebook', fb_story_id: '100458169258987_887205877244964', creator: 'fbkol', post_date: '2026-10-10',
        permalink: 'https://www.facebook.com/100458169258987_887205877244964' })]
};
const METRIC = {
    '18100000000000001': { platform: 'instagram', id_post: '18100000000000001' },
    '18100000000000008': { platform: 'instagram', id_post: '18100000000000008' },
    '100458169258987_887205877244964': { platform: 'facebook', id_post: '887205877244964' }
};
const wxCalls = [];
let wxDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.origin !== 'http://127.0.0.1:8201') return realFetch(url, opts);
    wxCalls.push({ path: u.pathname, qs: Object.fromEntries(u.searchParams), key: opts.headers && opts.headers['X-PFM-API-Key'], body: opts.body });
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (wxDown) return { ok: false, status: 500, json: async () => ({}) };
    if (u.pathname === '/api/v1/integrations/kol-pfm/posts') {
        if (u.searchParams.get('since') === '2024-12-18') return { ok: false, status: 500, json: async () => ({}) };
        const rows = POSTS[u.searchParams.get('platform')] || [];
        return json({ status: 'success', data: { count: rows.length, total: rows.length, has_more: false, rows } });
    }
    if (u.pathname === '/api/v1/integrations/kol-pfm/metrics') {
        const ids = JSON.parse(opts.body).item_ids;
        const rows = ids.filter(i => METRIC[i]).map(i => ({ item_id: i, ...METRIC[i], ad_spend: 250.5, ad_reach: 1288, ad_launched: true, first_ad_date: '2026-10-07' }));
        return json({ status: 'success', data: { rows, not_found: ids.filter(i => !METRIC[i]) } });
    }
    return { ok: false, status: 404, json: async () => ({}) };
};

let server, base;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    globalThis.fetch = realFetch;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

const tokenOf = uid => jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const call = (uid, url, body) => realFetch(base + '/api' + url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${tokenOf(uid)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
});
const LEAKS = [KEY, '8201', 'X-PFM-API-Key', 'javascript:'];
const noLeak = (text, where) => LEAKS.forEach(s => assert.equal(text.includes(s), false, `${where} มี "${s}" หลุดออกไป`));

test('ตัวเลือก: ชื่อ/วัน/สินค้าตรงขึ้นก่อน · สะกดใกล้เคียงขึ้นด้วย · ไม่ใกล้ไม่ขึ้น · member ไม่เห็นค่าแอด · ไม่มี key/ลิงก์อันตรายหลุด · ผูกคลิปอื่นบอกชื่อเฉพาะแบรนด์ที่มีสิทธิ์', async () => {
    const res = await call(2, '/ads/21/wx-posts');
    assert.equal(res.status, 200);
    const text = await res.text();
    noLeak(text, 'wx-posts');
    const d = JSON.parse(text).data;
    const ids = d.candidates.map(c => c.id_post);
    assert.equal(ids[0], '18100000000000001');
    assert.equal(d.candidates[0].level, 'high');
    assert.ok(ids.includes('18100000000000002'), 'belleo (สะกดต่าง 2 ตัว) ขึ้นด้วย');
    assert.ok(!ids.includes('18100000000000003'), 'ชื่อ/วัน/สินค้าไม่ใกล้ = ไม่ขึ้น');
    assert.ok(!ids.includes('18100000000000008') && !ids.includes('18100000000000009'), 'โพสต์แบรนด์อื่น / ไม่รู้แบรนด์ ไม่ขึ้น');
    assert.equal(text.includes('9999'), false, 'ค่าแอดของแบรนด์อื่นไม่หลุด');
    assert.ok(d.candidates.every(c => c.ad_spend === null), 'member ไม่เห็นค่าแอด');
    assert.equal(d.candidates.find(c => c.id_post === '18100000000000005').permalink, null);
    assert.deepEqual(d.candidates.find(c => c.id_post === '18100000000000002').used_by, [{ sub_id: 99, account_name: 'other_kol' }, { sub_id: 98, account_name: null }], 'คลิปของแบรนด์ที่ไม่มีสิทธิ์ไม่บอกชื่อ');
    assert.equal(d.total, 4);
    const posts = wxCalls.filter(c => c.path.endsWith('/posts'));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].key, KEY);
    assert.equal(posts[0].qs.platform, 'instagram');
    // admin เห็นค่าแอด · ครั้งที่สองใช้แคช (ไม่ถาม WeBoostX ซ้ำ)
    const a = (await (await call(1, '/ads/21/wx-posts')).json()).data;
    assert.equal(a.candidates[0].ad_spend, 250.5);
    assert.equal(wxCalls.filter(c => c.path.endsWith('/posts')).length, 1, 'ใช้แคช');
    // ค้นด้วยชื่อในแอด
    const s = (await (await call(2, '/ads/21/wx-posts?q=someone')).json()).data;
    assert.deepEqual(s.candidates.map(c => c.id_post), ['18100000000000003']);
});

test('ใครหาได้: เอเจนซี่ไม่ได้ · แบรนด์อื่นไม่ได้ · มี ID POST แล้ว / ไม่ใช่ IG-FB / รอทีมตรวจ = ไม่ได้', async () => {
    assert.equal((await call(4, '/ads/21/wx-posts')).status, 403);
    assert.equal((await call(3, '/ads/21/wx-posts')).status, 403);
    assert.equal((await call(2, '/ads/23/wx-posts')).status, 409);
    assert.equal((await call(2, '/ads/24/wx-posts')).status, 400);
    assert.equal((await call(2, '/ads/26/wx-posts')).status, 409);
    assert.equal((await call(2, '/ads/404/wx-posts')).status, 404);
    assert.equal((await call(4, '/ads/21/wx-confirm', { id_post: '18100000000000001' })).status, 403);
    assert.equal((await call(3, '/ads/21/wx-confirm', { id_post: '18100000000000001' })).status, 403);
    assert.equal((await call(2, '/ads/23/wx-confirm', { id_post: '18100000000000001' })).status, 409);
    assert.equal(updates.length, 0);
});

test('ยืนยัน IG: ถาม WeBoostX ซ้ำด้วย ID ที่เลือก → เก็บ ID POST แบบเติมเฉพาะช่องว่าง + ชื่อคนกด → ลงค่าแอดทันที → ลงประวัติ', async () => {
    updates.length = 0; applied.length = 0; logs.length = 0;
    const before = wxCalls.length;
    const res = await call(2, '/ads/21/wx-confirm', { id_post: '18100000000000001' });
    assert.equal(res.status, 200);
    const text = await res.text();
    noLeak(text, 'wx-confirm');
    assert.deepEqual(JSON.parse(text).data, { id_post: '18100000000000001', synced: true });
    const m = wxCalls.slice(before).find(c => c.path.endsWith('/metrics'));
    assert.deepEqual(JSON.parse(m.body).item_ids, ['18100000000000001']);
    assert.equal(m.key, KEY);
    assert.deepEqual(updates.map(u => [u.id, u.fields, u.byName, u.opts]), [[21, { id_post: '18100000000000001' }, 'Fon', { fillEmpty: ['id_post'] }]]);
    assert.deepEqual(applied.map(a => [a.submission_id, a.item_id, a.ad_spend, a.platform]), [[21, '18100000000000001', 250.5, 'instagram']]);
    assert.match(logs[0].summary, /เก็บ ID POST จากรายการโพสต์ WeBoostX: beiieo · 18100000000000001/);
});

test('ยืนยัน FB: เก็บแบบ <page>_<post> · story กับ ID ไม่ตรงกัน / ID ผิดรูป = 400 · WeBoostX ไม่รู้จัก = 409 ไม่บันทึก', async () => {
    updates.length = 0;
    const ok = await call(2, '/ads/22/wx-confirm', { id_post: '887205877244964', fb_story_id: '100458169258987_887205877244964' });
    assert.equal(ok.status, 200);
    assert.deepEqual(updates[0].fields, { id_post: '100458169258987_887205877244964' });
    updates.length = 0;
    assert.equal((await call(2, '/ads/22/wx-confirm', { id_post: '1', fb_story_id: '100458169258987_887205877244964' })).status, 400);
    assert.equal((await call(2, '/ads/21/wx-confirm', { id_post: '1', fb_story_id: '2_1' })).status, 400, 'IG ส่ง story มาไม่ได้');
    assert.equal((await call(2, '/ads/21/wx-confirm', { id_post: '18100abc' })).status, 400);
    assert.equal((await call(2, '/ads/21/wx-confirm', { id_post: '18100000000000002' })).status, 409, 'WeBoostX ไม่ยืนยันโพสต์นี้');
    const other = await call(2, '/ads/21/wx-confirm', { id_post: '18100000000000008' });
    assert.equal(other.status, 409, 'โพสต์ของแบรนด์อื่น (WeBoostX รู้จัก) ก็เก็บไม่ได้');
    assert.match((await other.json()).message, /ไม่อยู่ในรายการโพสต์ของ Beauterry/);
    assert.equal(updates.length, 0);
});

test('WeBoostX ล่ม = 502 (ไม่จำผลที่ล้ม ลองใหม่ได้) · ยืนยันตอนล่ม = 502 ไม่บันทึก · ยังไม่ตั้ง key = 503', async () => {
    const n0 = wxCalls.filter(c => c.path.endsWith('/posts')).length;
    assert.equal((await call(2, '/ads/25/wx-posts')).status, 502);
    assert.equal((await call(2, '/ads/25/wx-posts')).status, 502);
    assert.equal(wxCalls.filter(c => c.path.endsWith('/posts')).length, n0 + 2, 'ครั้งที่ล้มไม่ถูกจำ — ถามใหม่');
    updates.length = 0;
    wxDown = true;
    assert.equal((await call(2, '/ads/21/wx-confirm', { id_post: '18100000000000001' })).status, 502);
    wxDown = false;
    assert.equal(updates.length, 0);
    const saved = process.env.WEBOOSTX_PFM_EXPORT_KEY;
    process.env.WEBOOSTX_PFM_EXPORT_KEY = '';
    try {
        const r = await call(2, '/ads/21/wx-posts');
        assert.equal(r.status, 503);
    } finally { process.env.WEBOOSTX_PFM_EXPORT_KEY = saved; }
});
