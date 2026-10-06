const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// หน้า Ads: แถว TikTok ล็อกไม่ให้กดสถานะ "ยิงแล้ว" เอง (ผู้ใช้สั่ง 2 ต.ค. 2026) — สถานะมาจากระบบ PFM อัตโนมัติ
// ใช้ข้อมูลจำลองในหน่วยความจำ — ฐานข้อมูลของระบบคือ production ห้ามแตะ
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ads-tiktok-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ads-tiktok-status test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const { adStatusAuto } = require(path.join(SRC, 'store/logic'));
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = { 1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] } };
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const SUBS = {
    1: { id: 1, platform: 'TikTok', ad_status: 'ยังไม่ยิง', account_name: 'tt_girl', post_url: 'https://www.tiktok.com/@tt_girl/video/1' },
    2: { id: 2, platform: 'Instagram', ad_status: 'ยังไม่ยิง', account_name: 'ig_girl', post_url: 'https://www.instagram.com/reel/abc/' },
    3: { id: 3, platform: 'Facebook', ad_status: 'ยิงแล้ว', account_name: 'fb_girl', post_url: 'https://www.facebook.com/x' },
    4: { id: 4, platform: 'TikTok', ad_status: 'ยิงแล้ว', account_name: 'tt_old', post_url: 'https://www.tiktok.com/@tt_old/video/2' },
    // 6 ต.ค. 2026: TikTok ของแบรนด์ที่ยังไม่ต่อ PFM (Jula's Herb) กดสถานะ / กรอกค่าแอดเองได้
    5: { id: 5, platform: 'TikTok', ad_status: 'ยังไม่ยิง', account_name: 'luvjennerr', post_url: 'https://www.tiktok.com/@luvjennerr/video/3', id_post: '7693136943999175988', ad_spend: 0, brand: "Jula's Herb" },
    6: { id: 6, platform: 'TikTok', ad_status: 'ยังไม่ยิง', account_name: 'tt_spend', post_url: 'https://www.tiktok.com/@tt_spend/video/4', id_post: '7600000000000000006', ad_spend: 0 }
};
store.ads.subContext = async id => {
    const s = SUBS[Number(id)];
    return s ? { submission: { ...s }, project_id: 5, team_id: 1, brand: s.brand || 'Beauterry', project_name: 'KOL Oct', account_name: s.account_name } : null;
};
const writes = [];
store.submissions.update = async (id, _p, fields) => { writes.push({ id: Number(id), fields }); Object.assign(SUBS[Number(id)], fields); return { ...SUBS[Number(id)], sub_id: Number(id) }; };
store.activity.log = async e => e;

let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = 'http://127.0.0.1:' + server.address().port; });
after(async () => {
    if (server) await new Promise(r => server.close(r));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
const token = jwt.sign({ id: 1, username: 'admin1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const put = async (id, body) => {
    const res = await fetch(base + '/api/ads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};

test('adStatusAuto: TikTok (ทุกแบบตัวพิมพ์) ของแบรนด์ที่ต่อ PFM = สถานะอัตโนมัติ · Platform อื่น / ว่าง / แบรนด์อื่น = กดเองได้', () => {
    for (const p of ['TikTok', 'tiktok', ' TIKTOK', 'TikTok Shop']) assert.equal(adStatusAuto({ platform: p }, 'Beauterry'), true, p);
    for (const p of ['Instagram', 'Facebook', 'Lemon8', 'YouTube', '', null]) assert.equal(adStatusAuto({ platform: p }, 'Beauterry'), false, String(p));
    assert.equal(adStatusAuto(null, 'Beauterry'), false);
    // 6 ต.ค. 2026: แบรนด์ที่ยังไม่ต่อ PFM (Jula's Herb) / ไม่รู้แบรนด์ = กดเองได้
    assert.equal(adStatusAuto({ platform: 'TikTok' }, "Jula's Herb"), false);
    assert.equal(adStatusAuto({ platform: 'TikTok' }), false);
});

test('PUT /api/ads/:id — TikTok กดยิงแล้ว / กลับเป็นยังไม่ยิง ไม่ได้ (409) · ไม่เขียนอะไรลงฐาน', async () => {
    const n = writes.length;
    const a = await put(1, { ad_status: 'ยิงแล้ว', ad_end: '2026-10-02' });
    assert.equal(a.status, 409);
    assert.match(a.body.message, /TikTok ยิงแอดผ่านระบบ PFM/);
    const b = await put(4, { ad_status: 'ยังไม่ยิง', ad_end: null });
    assert.equal(b.status, 409, 'แถวเก่าที่เคยกดไว้ ก็กดกลับไม่ได้');
    assert.equal(writes.length, n, 'ไม่มีอะไรถูกเขียน');
    assert.deepEqual([SUBS[1].ad_status, SUBS[4].ad_status], ['ยังไม่ยิง', 'ยิงแล้ว']);
});

test('PUT /api/ads/:id — TikTok ยังแก้ช่องอื่นได้ (หมายเหตุ / Reach) · Instagram / Facebook กดสถานะเองได้เหมือนเดิม', async () => {
    const note = await put(1, { ad_note: 'Gencode ใช้ไม่ได้' });
    assert.equal(note.status, 200);
    assert.equal(SUBS[1].ad_note, 'Gencode ใช้ไม่ได้');
    const reach = await put(1, { ad_reach: 1200 });
    assert.equal(reach.status, 200);
    const ig = await put(2, { ad_status: 'ยิงแล้ว', ad_end: '2026-10-02' });
    assert.equal(ig.status, 200);
    assert.equal(SUBS[2].ad_status, 'ยิงแล้ว');
    const fb = await put(3, { ad_status: 'ยังไม่ยิง', ad_end: null });
    assert.equal(fb.status, 200);
    assert.equal(SUBS[3].ad_status, 'ยังไม่ยิง');
});

test('หน้าเว็บ (Ads.jsx) ใช้ status_auto ที่ server ตัดสินต่อแถว · server รุ่นก่อน (ไม่ส่ง) ใช้ regex เดียวกับ server', () => {
    const RE = '/^\\s*tiktok/i.test(';
    const src = fs.readFileSync(path.join(__dirname, '../client/src/pages/Ads.jsx'), 'utf8');
    assert.ok(src.includes("const adStatusAuto = row => (typeof row.status_auto === 'boolean' ? row.status_auto : " + RE + "String(row.platform || '')));"), 'Ads.jsx');
    const logic = fs.readFileSync(path.join(SRC, 'store/logic.js'), 'utf8');
    assert.ok(logic.includes('const isTikTokPost = s => ' + RE + "String((s && s.platform) || ''));"));
    assert.ok(logic.includes('return isTikTokPost(s) && isPfmBrand(brand);'));
});

test("PUT /api/ads/:id — TikTok ของแบรนด์ที่ยังไม่ต่อ PFM (Jula's Herb) กดยิงแล้ว + กรอกค่าแอดเองได้ · Beauterry ที่มี ID Post กรอกค่าแอดไม่ได้ (409) (6 ต.ค. 2026)", async () => {
    const a = await put(5, { ad_status: 'ยิงแล้ว', ad_end: '2026-10-06' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(SUBS[5].ad_status, 'ยิงแล้ว');
    const b = await put(5, { ad_spend: 1500, ad_spend_from: 0 });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(Number(SUBS[5].ad_spend), 1500);
    const c = await put(6, { ad_spend: 900, ad_spend_from: 0 });
    assert.equal(c.status, 409);
    assert.match(c.body.message, /ซิงก์จากระบบ PFM/);
});
