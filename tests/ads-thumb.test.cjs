const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// คอลัมน์ IMAGE หน้า Ads (ผู้ใช้สั่ง 30 ก.ย. 2026): รูปปกคลิป TikTok ดึงผ่าน oEmbed แล้วเก็บไว้ใน UPLOAD_DIR/ads-thumbs
// ไม่เรียก TikTok จริง และไม่แตะฐานข้อมูล (ฐานของระบบคือ production) — ทุกอย่างจำลองในหน่วยความจำ
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-ads-thumb-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in ads-thumb test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const { thumbKey, thumbPath, cdnOk, createThumbCache, MAX_BYTES, FAIL_TTL_MS } = require(path.join(SRC, 'services/adThumbs'));

// ---------------------------------------------------------------- TikTok จำลอง
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), crypto.randomBytes(200)]);
const CDN = 'https://p16-common-sign.tiktokcdn.com/tos-alisg-p-0037/abc~tplv-tiktokx-origin.image?x-expires=1790000000&x-signature=zz';
function fakeTikTok({ thumb = CDN, oembedStatus = 200, image = {} } = {}) {
    const calls = { oembed: 0, image: 0, urls: [] };
    const impl = async (url, opts = {}) => {
        calls.urls.push(String(url));
        if (String(url).startsWith('https://www.tiktok.com/oembed?url=')) {
            calls.oembed++;
            return new Response(JSON.stringify({ title: 'x', thumbnail_url: thumb }), { status: oembedStatus, headers: { 'content-type': 'application/json' } });
        }
        calls.image++;
        calls.redirect = opts.redirect;
        const headers = { 'content-type': image.type || 'image/jpeg' };
        if (image.length != null) headers['content-length'] = String(image.length);
        if (image.status && image.status !== 200) return new Response(null, { status: image.status, headers: { location: 'http://127.0.0.1/secret' } });
        return new Response(image.body || JPEG, { status: 200, headers });
    };
    return { impl, calls };
}
const made = [];   // โฟลเดอร์แคชชั่วคราวของเทสต์ — ลบทิ้งตอนจบ
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-thumb-cache-')); made.push(d); return d; };
const POST = 'https://www.tiktok.com/@flow3rgurrl/video/7690488609664748807';

// ---------------------------------------------------------------- ตรรกะล้วน
test('thumbKey: ลิงก์ TikTok ทุกแบบได้ชื่อจากเลขคลิป · ลิงก์ย่อใช้แฮช · ไม่ใช่ TikTok = null', () => {
    const id = '7690488609664748807';
    for (const u of [
        POST,
        POST + '?is_from_webapp=1&sender_device=pc',
        POST + '/',
        `https://tiktok.com/@a.b_c/video/${id}`,
        `https://m.tiktok.com/v/${id}.html`,
        `https://www.tiktok.com/@shop/photo/${id}`,
        `  ${POST}  `
    ]) assert.equal(thumbKey(u), 'tt' + id, u);
    assert.match(thumbKey('https://vt.tiktok.com/ZSabc123/'), /^tu[0-9a-f]{24}$/);
    assert.notEqual(thumbKey('https://vt.tiktok.com/ZSabc123/'), thumbKey('https://vt.tiktok.com/ZSxyz999/'));
    for (const u of [
        null, '', 'ไม่ใช่ลิงก์', 'www.tiktok.com/@a/video/123456789',
        'https://www.instagram.com/p/Cxyz/', 'https://tiktok.com.evil.example/@a/video/7690488609664748807',
        'https://eviltiktok.com/@a/video/7690488609664748807', 'javascript:alert(1)//tiktok.com/video/7690488609664748807',
        'ftp://www.tiktok.com/@a/video/7690488609664748807'
    ]) assert.equal(thumbKey(u), null, String(u));
});

test('thumbPath: เฉพาะแถว TikTok · ?v= ตามชื่อแคช (เปลี่ยนลิงก์ = path ใหม่)', () => {
    assert.equal(thumbPath({ sub_id: 12, post_url: POST }), '/ads/12/thumb?v=tt7690488609664748807');
    assert.equal(thumbPath({ sub_id: 12, post_url: 'https://www.instagram.com/reel/abc/' }), null);
    assert.equal(thumbPath({ sub_id: null, post_url: POST }), null);
    assert.equal(thumbPath(null), null);
});

test('cdnOk: รับเฉพาะ https บนโดเมนรูปของ TikTok', () => {
    assert.ok(cdnOk(CDN));
    assert.ok(cdnOk('https://p19-common-sign.tiktokcdn-us.com/x.image'));
    assert.ok(cdnOk('https://p16-sign-sg.ibyteimg.com/x.jpeg'));
    for (const u of ['http://p16-common-sign.tiktokcdn.com/x', 'https://127.0.0.1/x', 'https://tiktokcdn.com.evil.example/x',
        'https://eviltiktokcdn.com/x', 'https://www.tiktok.com/x', 'file:///etc/passwd', '', null]) assert.equal(cdnOk(u), false, String(u));
});

test('หน้าเว็บรับ path ที่ server ส่งมาได้ทุกแบบ และไม่รับเส้นอื่น', async () => {
    const c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/postThumb.js')).href);
    for (const u of [POST, 'https://vt.tiktok.com/ZSabc123/', `https://m.tiktok.com/v/7690488609664748807.html`]) {
        assert.ok(c.okThumbPath(thumbPath({ sub_id: 987, post_url: u })), u);
    }
    for (const p of ['/ads/1/thumb', '/ads/1/thumb?v=', '/ads/x/thumb?v=tt1', '/payments/1/slip', '/ads/1/../../users?v=tt1',
        '/ads/1/thumb?v=tt1&x=1', 'https://evil.example/ads/1/thumb?v=tt1', null, 7]) assert.equal(c.okThumbPath(p), false, String(p));
    assert.equal(c.postHref('javascript:alert(1)'), '');
    assert.equal(c.postHref(' https://www.instagram.com/p/x/ '), 'https://www.instagram.com/p/x/');
    assert.equal(c.platformShort('Instagram'), 'IG');
    assert.equal(c.platformShort('TikTok'), 'TikTok');
    assert.equal(c.platformShort('Facebook'), 'FB');
});

// ---------------------------------------------------------------- แคช
test('ดึงครั้งแรกเก็บเป็นไฟล์ · ครั้งต่อไปไม่เรียก TikTok อีก · ไม่ตาม redirect ของรูป', async () => {
    const dir = tmpDir();
    const tk = fakeTikTok();
    const cache = createThumbCache({ dir, fetchImpl: tk.impl });
    const fp = await cache.get(POST);
    assert.equal(fp, path.join(dir, 'tt7690488609664748807.jpg'));
    assert.deepEqual(fs.readFileSync(fp), JPEG);
    assert.equal(tk.calls.urls[0], 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(POST));
    assert.equal(tk.calls.redirect, 'manual');
    assert.equal(await cache.get(POST + '?lang=th'), fp);   // คลิปเดียวกัน
    assert.deepEqual([tk.calls.oembed, tk.calls.image], [1, 1]);
    assert.deepEqual(fs.readdirSync(dir), ['tt7690488609664748807.jpg']);   // ไม่มีไฟล์ .tmp ค้าง
    // server เริ่มใหม่ (แคชในหน่วยความจำหาย) ยังใช้ไฟล์เดิม
    const tk2 = fakeTikTok();
    assert.equal(await createThumbCache({ dir, fetchImpl: tk2.impl }).get(POST), fp);
    assert.equal(tk2.calls.urls.length, 0);
});

test('หลายคนขอคลิปเดียวกันพร้อมกัน = ดึงครั้งเดียว', async () => {
    const tk = fakeTikTok();
    const cache = createThumbCache({ dir: tmpDir(), fetchImpl: tk.impl });
    const out = await Promise.all(Array.from({ length: 6 }, () => cache.get(POST)));
    assert.equal(new Set(out).size, 1);
    assert.ok(out[0]);
    assert.deepEqual([tk.calls.oembed, tk.calls.image], [1, 1]);
});

test('ดึงพร้อมกันไม่เกิน 3 คลิป', async () => {
    let live = 0, peak = 0;
    const tk = fakeTikTok();
    const slow = async (url, opts) => {
        live++; peak = Math.max(peak, live);
        await new Promise(r => setTimeout(r, 15));
        try { return await tk.impl(url, opts); } finally { live--; }
    };
    const cache = createThumbCache({ dir: tmpDir(), fetchImpl: slow });
    const posts = Array.from({ length: 8 }, (_, i) => `https://www.tiktok.com/@a/video/76904886096647488${10 + i}`);
    const out = await Promise.all(posts.map(p => cache.get(p)));
    assert.ok(out.every(Boolean));
    assert.ok(peak <= 3, 'peak ' + peak);
    assert.equal(tk.calls.oembed, 8);
});

test('รูปจากโดเมนอื่น / redirect / ไม่ใช่รูป / ใหญ่เกิน / oEmbed พัง → null และไม่เขียนไฟล์', async () => {
    const cases = [
        [{ thumb: 'https://127.0.0.1/internal.jpg' }, 0],
        [{ thumb: 'http://p16-common-sign.tiktokcdn.com/x.image' }, 0],
        [{ oembedStatus: 404 }, 0],
        [{ image: { status: 302 } }, 1],
        [{ image: { type: 'text/html', body: '<html>' } }, 1],
        [{ image: { length: MAX_BYTES + 1 } }, 1],
        [{ image: { body: Buffer.alloc(MAX_BYTES + 1) } }, 1],
        [{ image: { body: Buffer.alloc(0) } }, 1]
    ];
    for (const [opt, imageCalls] of cases) {
        const dir = tmpDir();
        const tk = fakeTikTok(opt);
        assert.equal(await createThumbCache({ dir, fetchImpl: tk.impl }).get(POST), null, JSON.stringify(opt));
        assert.equal(tk.calls.image, imageCalls, JSON.stringify(opt));
        assert.deepEqual(fs.readdirSync(dir).filter(n => !n.startsWith('.')), [], JSON.stringify(opt));
    }
});

test('เปลี่ยนชื่อไฟล์ไม่ได้ (Windows: แอนตี้ไวรัสจับไฟล์) → ลบไฟล์ .tmp ทิ้ง ไม่ค้างสะสม · รอบถัดไปสำเร็จได้', async () => {
    const dir = tmpDir();
    let t = 1_000_000;
    const cache = createThumbCache({ dir, fetchImpl: fakeTikTok().impl, now: () => t });
    const realRename = fs.promises.rename;
    fs.promises.rename = async () => { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; };
    try {
        assert.equal(await cache.get(POST), null);
    } finally {
        fs.promises.rename = realRename;
    }
    assert.deepEqual(fs.readdirSync(dir), []);
    t += FAIL_TTL_MS + 1;
    assert.ok(await cache.get(POST));
    assert.deepEqual(fs.readdirSync(dir), ['tt7690488609664748807.jpg']);
});

test('ดึงไม่ได้ = พัก 20 นาทีก่อนลองใหม่ (ไม่ยิง TikTok รัว ๆ) · ไม่ใช่ TikTok ไม่เรียกออกไปเลย', async () => {
    let t = 1_000_000;
    let failing = true;
    const calls = { n: 0 };
    const impl = async (url, opts) => {
        calls.n++;
        if (failing) throw new Error('network');
        return fakeTikTok().impl(url, opts);
    };
    const cache = createThumbCache({ dir: tmpDir(), fetchImpl: impl, now: () => t });
    assert.equal(await cache.get(POST), null);
    assert.equal(await cache.get(POST), null);
    assert.equal(calls.n, 1);
    t += FAIL_TTL_MS - 1;
    assert.equal(await cache.get(POST), null);
    assert.equal(calls.n, 1);
    t += 2;
    failing = false;
    assert.ok(await cache.get(POST));
    assert.equal(await cache.get('https://www.instagram.com/p/abc/'), null);
    assert.equal(calls.n, 3);   // oEmbed + รูป ของรอบที่ลองใหม่ · IG ไม่เรียก
});

// ---------------------------------------------------------------- เส้น API
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'fon', full_name: 'Fon', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Beauterry'] },
    3: { id: 3, username: 'praew', full_name: 'Praew', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jdent'] },
    4: { id: 4, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['t1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const SUBS = {
    1: { id: 1, post_url: POST, id_post: '7690488609664748807', account_name: 'flow3rgurrl', brand: 'Beauterry' },
    2: { id: 2, post_url: 'https://www.instagram.com/reel/abc/', id_post: null, account_name: 'ig_girl', brand: 'Beauterry' }
};
store.ads.subContext = async id => {
    const s = SUBS[Number(id)];
    return s ? { submission: { ...s }, project_id: 5, team_id: 2, brand: s.brand, project_name: 'KOL Sep', account_name: s.account_name } : null;
};
store.ads.list = async () => ({
    summary: { total_posts: 2, total_spend: 0, cpm: 0, by_brand: [] },
    rows: Object.values(SUBS).map(s => ({ sub_id: s.id, account_name: s.account_name, platform: s.id === 1 ? 'TikTok' : 'Instagram', post_url: s.post_url, brand: s.brand, ad_spend: 0 }))
});

// TikTok จำลองสำหรับ server — คำขออื่น (เทสต์เรียก server เอง) ผ่าน fetch จริง
const realFetch = globalThis.fetch;
let tiktok = fakeTikTok();
globalThis.fetch = (url, opts) => (/^https:\/\/(www\.tiktok\.com|[^/]*tiktokcdn\.com)\//.test(String(url)) ? tiktok.impl(url, opts) : realFetch(url, opts));

let server, base;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    globalThis.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    made.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});
beforeEach(() => { tiktok = fakeTikTok(); });

const tokenOf = uid => jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const get = (uid, url) => realFetch(base + '/api' + url, { headers: uid ? { Authorization: `Bearer ${tokenOf(uid)}` } : {} });

test('GET /api/ads: แถว TikTok มี thumb · IG เป็น null', async () => {
    const res = await get(2, '/ads');
    assert.equal(res.status, 200);
    const rows = (await res.json()).data.rows;
    assert.equal(rows.find(r => r.sub_id === 1).thumb, '/ads/1/thumb?v=tt7690488609664748807');
    assert.equal(rows.find(r => r.sub_id === 2).thumb, null);
});

test('GET /api/ads/:id/thumb: ได้รูป + แคชเฉพาะเครื่อง · เก็บไฟล์ใน UPLOAD_DIR/ads-thumbs', async () => {
    const res = await get(2, '/ads/1/thumb?v=tt7690488609664748807');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=604800');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
    assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'ads-thumbs', 'tt7690488609664748807.jpg')));
    const again = await get(1, '/ads/1/thumb');
    assert.equal(again.status, 200);
    await again.arrayBuffer();
    assert.equal(tiktok.calls.urls.length, 2);   // oEmbed + รูป ครั้งแรกครั้งเดียว
});

test('GET /api/ads/:id/thumb: แบรนด์อื่น 403 · IG / ไม่มีโพสต์ 404 · เอเจนซี่ 403 · ไม่ล็อกอิน 401 — ไม่เรียก TikTok', async () => {
    const cases = [[3, '/ads/1/thumb', 403], [2, '/ads/2/thumb', 404], [2, '/ads/999/thumb', 404], [2, '/ads/abc/thumb', 404], [4, '/ads/1/thumb', 403], [null, '/ads/1/thumb', 401]];
    for (const [uid, url, code] of cases) {
        const res = await get(uid, url);
        assert.equal(res.status, code, `${uid} ${url}`);
        if (code === 404) assert.equal(res.headers.get('cache-control'), 'no-store');
        await res.arrayBuffer();
    }
    assert.equal(tiktok.calls.urls.length, 0);
});
