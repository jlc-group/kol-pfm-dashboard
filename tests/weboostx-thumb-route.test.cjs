const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// รูปปก IG / FB จาก WeBoostX ฝั่งเบราว์เซอร์ (19 ต.ค. 2026): เสิร์ฟสำเนาของเราผ่าน GET /api/ads/:id/thumb (ล็อกอิน + สิทธิ์แบรนด์)
// + ตรวจว่าไม่มี key / URL / path ของ WeBoostX หลุดไปใน response, หน้าเว็บ (client/src) หรือ HTML
// ไม่เรียก WeBoostX จริง ไม่ต่อฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-wx-route-test-'));
const KEY = 'fixture-key-' + crypto.randomBytes(8).toString('hex');
process.env.WEBOOSTX_PFM_EXPORT_KEY = KEY;
process.env.WEBOOSTX_PFM_BASE_URL = 'http://127.0.0.1:8201';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in weboostx-thumb-route test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const wx = require(path.join(SRC, 'services/weboostxThumbs'));
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const THUMB_PATH = '/api/v1/integrations/kol-pfm/thumbnail/4321';
const LOCAL = wx.keyOf(THUMB_PATH) + '.jpg';
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), crypto.randomBytes(256)]);
const WX_DIR = path.join(process.env.UPLOAD_DIR, 'weboostx-thumbs');
fs.mkdirSync(WX_DIR, { recursive: true });
fs.writeFileSync(path.join(WX_DIR, LOCAL), JPEG);

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'fon', full_name: 'Fon', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Jernis'] },
    3: { id: 3, username: 'praew', full_name: 'Praew', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jdent'] },
    4: { id: 4, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tok1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
// แถว submissions ตามที่อยู่ในฐาน (SELECT *) — มีคอลัมน์ภายในครบ
const SUBS = {
    11: { id: 11, project_id: 5, platform: 'Instagram', post_url: 'https://www.instagram.com/reel/abc/', id_post: '1789', account_name: 'ig_girl',
        agency_token: 'tok1', status: 'confirmed', budget: 3000, ad_spend: 500,
        weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: THUMB_PATH, thumbnail_local: LOCAL, thumbnail_error: null, thumbnail_fetched_at: new Date().toISOString() },
    12: { id: 12, project_id: 5, platform: 'Facebook', post_url: 'https://www.facebook.com/p/posts/1', id_post: '1_2', account_name: 'fb_guy',
        agency_token: 'tok1', status: 'confirmed', budget: 0, ad_spend: 0,
        weboostx_pfm: null, weboostx_pfm_grade: null, weboostx_thumbnail_path: '/api/v1/integrations/kol-pfm/thumbnail/9', thumbnail_local: null, thumbnail_error: 'http_404' },
    13: { id: 13, project_id: 5, platform: 'Instagram', post_url: 'https://www.instagram.com/p/zz/', account_name: 'escape',
        thumbnail_local: '../../outside.jpg', weboostx_thumbnail_path: null }
};
const PROJECT = { id: 5, name: 'Jernis Oct', brand: 'Jernis', team_id: 2, campaign_type: 'kol', status: 'Active', ad_groups: [] };
store.ads.subContext = async id => {
    const s = SUBS[Number(id)];
    return s ? { submission: { ...s }, project_id: 5, team_id: 2, brand: 'Jernis', project_name: PROJECT.name, account_name: s.account_name } : null;
};
// แถวที่ pg/ads.js ส่งให้ route (ตามที่โค้ดจริงสร้าง: weboostx_pfm / grade / thumbnail_local)
store.ads.list = async () => ({
    summary: { total_posts: 2, total_spend: 0, cpm: 0, by_brand: [] },
    rows: [SUBS[11], SUBS[12]].map(s => ({ sub_id: s.id, account_name: s.account_name, platform: s.platform, post_url: s.post_url, brand: 'Jernis',
        ad_spend: s.ad_spend, weboostx_pfm: s.weboostx_pfm == null ? null : Number(s.weboostx_pfm), weboostx_pfm_grade: s.weboostx_pfm_grade,
        thumbnail_local: s.thumbnail_local }))
});
store.projects.findByIdFull = async id => (Number(id) === 5 ? { ...PROJECT } : null);
store.submissions.listByProject = async () => [SUBS[11], SUBS[12]].map(s => ({ ...s }));
store.projects.resolveToken = async token => (token === 'tok1'
    ? { project: { ...PROJECT }, link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: true } }
    : null);

const realFetch = globalThis.fetch;
const outbound = [];
globalThis.fetch = (url, opts) => {
    if (!String(url).startsWith('http://127.0.0.1:' + (server && server.address().port))) outbound.push(String(url));
    return realFetch(url, opts);
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
const get = (uid, url) => realFetch(base + '/api' + url, { headers: uid ? { Authorization: `Bearer ${tokenOf(uid)}` } : {} });
// สิ่งที่ห้ามโผล่ในอะไรก็ตามที่ส่งให้เบราว์เซอร์
const LEAKS = [KEY, '8201', 'weboostx2', 'kol-pfm/thumbnail', 'X-PFM-API-Key', 'weboostx_thumbnail_path', 'thumbnail_local', 'thumbnail_error', 'thumbnail_fetched_at', LOCAL];
const noLeak = (text, where) => LEAKS.forEach(s => assert.equal(text.includes(s), false, `${where} มี "${s}" หลุดออกไป`));

test('GET /api/ads: แถว IG ที่มีสำเนามี thumb เส้นของเรา · เกรด PFM มา · ไม่มี path / ชื่อไฟล์ / key ของ WeBoostX', async () => {
    const res = await get(2, '/ads');
    assert.equal(res.status, 200);
    const text = await res.text();
    noLeak(text, 'GET /api/ads');
    const rows = JSON.parse(text).data.rows;
    const ig = rows.find(r => r.sub_id === 11), fb = rows.find(r => r.sub_id === 12);
    assert.equal(ig.thumb, `/ads/11/thumb?v=${wx.keyOf(THUMB_PATH)}`);
    assert.equal(fb.thumb, null, 'ยังไม่มีสำเนา = ไม่มีรูป (หน้าเว็บขึ้นไอคอนเดิม)');
    assert.deepEqual([ig.weboostx_pfm, ig.weboostx_pfm_grade], [7.7, 'A']);
    assert.deepEqual([fb.weboostx_pfm, fb.weboostx_pfm_grade], [null, null]);
    assert.equal(outbound.length, 0, 'ไม่เรียกออกไปข้างนอก');
});

test('GET /api/ads/:id/thumb: ส่งสำเนาของเรา · cache เฉพาะเครื่อง · nosniff · ไม่เรียก WeBoostX', async () => {
    const res = await get(2, '/ads/11/thumb?v=' + wx.keyOf(THUMB_PATH));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=604800');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
    assert.equal(outbound.length, 0);
});

test('GET /api/ads/:id/thumb: แบรนด์อื่น 403 · เอเจนซี่ 403 · ไม่ล็อกอิน 401 · ยังไม่มีสำเนา / ชื่อไฟล์หลุดโฟลเดอร์ 404 no-store', async () => {
    const cases = [[3, '/ads/11/thumb', 403], [4, '/ads/11/thumb', 403], [null, '/ads/11/thumb', 401], [2, '/ads/12/thumb', 404], [2, '/ads/13/thumb', 404], [2, '/ads/999/thumb', 404]];
    for (const [uid, url, code] of cases) {
        const res = await get(uid, url);
        assert.equal(res.status, code, `${uid} ${url}`);
        const text = await res.text();
        noLeak(text, url);
        if (code === 404) assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    assert.equal(outbound.length, 0, 'ไม่เรียก WeBoostX ระหว่างตอบเบราว์เซอร์');
});

test('ทุกคำตอบ JSON ตัดคอลัมน์ภายในออก (เส้นรายชื่อฝั่งทีมที่ส่งแถวแบบ SELECT *) · ทีมยังเห็นเกรด', async () => {
    const res = await get(1, '/projects/5/submissions');
    assert.equal(res.status, 200);
    const text = await res.text();
    noLeak(text, 'GET /api/projects/:id/submissions');
    const rows = JSON.parse(text).data;
    assert.equal(rows[0].weboostx_pfm, '7.70');
    assert.equal(rows[0].weboostx_pfm_grade, 'A');
});

test('หน้าเอเจนซี่: ไม่เห็นเกรด PFM และคอลัมน์ภายใน (ข้อมูลภายใน ตามสัญญา WeBoostX)', async () => {
    const res = await get(4, '/agency/tok1');
    assert.equal(res.status, 200);
    const text = await res.text();
    noLeak(text, 'GET /api/agency/:token');
    for (const s of JSON.parse(text).data.submissions) {
        assert.equal('weboostx_pfm' in s, false);
        assert.equal('weboostx_pfm_grade' in s, false);
    }
});

test('โค้ดหน้าเว็บ (client/src) และ index.html ไม่มี key / ที่อยู่ WeBoostX / header key', () => {
    const root = path.join(__dirname, '../client');
    const files = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp); else if (/\.(jsx?|css|html)$/.test(e.name)) files.push(fp);
    });
    walk(path.join(root, 'src'));
    files.push(path.join(root, 'index.html'));
    for (const fp of files) {
        const t = fs.readFileSync(fp, 'utf8');
        for (const s of ['weboostx2.wejlc.com', '127.0.0.1:8201', 'X-PFM-API-Key', 'kol-pfm/thumbnail', 'WEBOOSTX_PFM_EXPORT_KEY'])
            assert.equal(t.includes(s), false, `${path.relative(root, fp)} มี ${s}`);
    }
});
