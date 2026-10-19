const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// ตัวดาวน์โหลดรูปปกโพสต์ IG / FB จาก WeBoostX (19 ต.ค. 2026 · services/weboostxThumbs.js)
// 200 เก็บไฟล์ · 404 จด error แล้วลองใหม่ · path เดิมไม่โหลดซ้ำ · path เปลี่ยนโหลดใหม่ · ไม่ใช่รูปไม่เก็บ · ใหญ่เกินไม่เก็บ
// ไม่ตาม redirect · key ไปแค่ BASE · ล้มแล้วผลซิงก์ค่าแอดยังสำเร็จ
// HTTP จำลองทั้งหมด (ไม่เรียก WeBoostX จริง) · ไม่ต่อฐานจริง
process.env.NODE_ENV = 'test';
const { pool } = require('../server/src/config/db');
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
const wx = require('../server/src/services/weboostxThumbs');
const sync = require('../server/src/services/weboostxPfmSync');

const KEY = 'fixture-key-' + crypto.randomBytes(6).toString('hex');
const BASE = 'http://wx.fixture.invalid:8201';
const settings = { apiKey: KEY, baseUrl: BASE };
const P = id => `/api/v1/integrations/kol-pfm/thumbnail/${id}`;
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), crypto.randomBytes(300)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(100)]);

const dirs = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-wx-thumbs-')); dirs.push(d); return d; };
after(async () => { dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })); await pool.end(); });

// ฐานจำลอง: แถว submissions ที่มี path รูป
function memStore(rows) {
    const calls = { saved: [], failed: [] };
    return {
        rows, calls,
        thumbRows: async () => rows.filter(r => r.weboostx_thumbnail_path).map(r => ({ ...r })),
        thumbSaved: async (p, name) => {
            calls.saved.push([p, name]);
            rows.filter(r => r.weboostx_thumbnail_path === p).forEach(r => { r.thumbnail_local = name; r.thumbnail_fetched_at = 'now'; r.thumbnail_error = null; });
            return 1;
        },
        thumbFailed: async (p, code) => {
            calls.failed.push([p, code]);
            rows.filter(r => r.weboostx_thumbnail_path === p).forEach(r => { r.thumbnail_error = code; });
            return 1;
        }
    };
}
// WeBoostX จำลอง: path → { status, type, body, length }
function fakeWx(map = {}, { delayMs = 0 } = {}) {
    const calls = [];
    let inFlight = 0, maxInFlight = 0;
    const impl = async (url, opts = {}) => {
        calls.push({ url: String(url), key: opts.headers && opts.headers['X-PFM-API-Key'], redirect: opts.redirect, hasSignal: !!opts.signal });
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            if (delayMs) await new Promise(r => setTimeout(r, delayMs));
            const u = new URL(String(url));
            const spec = map[u.pathname] || { status: 404 };
            if (spec.throws) throw Object.assign(new Error('boom'), { name: spec.throws });
            const headers = { 'content-type': spec.type || 'image/jpeg' };
            if (spec.length != null) headers['content-length'] = String(spec.length);
            if (spec.location) headers.location = spec.location;
            if (spec.status && spec.status !== 200) return new Response(spec.body || null, { status: spec.status, headers });
            return new Response(spec.body || JPEG, { status: 200, headers });
        } finally { inFlight--; }
    };
    return { impl, calls, max: () => maxInFlight };
}
const row = (id, p, extra = {}) => ({ id, weboostx_thumbnail_path: p, thumbnail_local: null, thumbnail_error: null, ...extra });

test('ชื่อไฟล์: path เดียวกันได้ชื่อเดียวกัน · ต่าง path ต่างชื่อ · ชื่อแปลก/หลุดโฟลเดอร์ไม่ใช่สำเนาของเรา', () => {
    assert.match(wx.keyOf(P(1)), /^wx[0-9a-f]{16}$/);
    assert.equal(wx.keyOf(P(1)), wx.keyOf(P(1)));
    assert.notEqual(wx.keyOf(P(1)), wx.keyOf(P(2)));
    assert.equal(wx.localKeyOf(wx.keyOf(P(1)) + '.jpg'), wx.keyOf(P(1)));
    for (const bad of [null, '', '../x.jpg', 'wx0123456789abcdef.exe', 'wx0123.jpg', '/etc/passwd', 'wx0123456789abcdef.jpg/..', 'tt123.jpg'])
        assert.equal(wx.localKeyOf(bad), null, String(bad));
    assert.equal(wx.thumbPathFor({ sub_id: 9, thumbnail_local: wx.keyOf(P(1)) + '.png' }), `/ads/9/thumb?v=${wx.keyOf(P(1))}`);
    assert.equal(wx.thumbPathFor({ sub_id: 9, thumbnail_local: null }), null);
    assert.equal(wx.thumbPathFor({ sub_id: 9, thumbnail_local: '../../secret.jpg' }), null);
});

test('URL รูป = BASE + path ที่ผ่านรูปแบบเท่านั้น (ข้อมูลจาก WeBoostX พา key ไปเครื่องอื่นไม่ได้)', () => {
    assert.equal(wx.thumbUrl(BASE, P(12)).href, BASE + P(12));
    assert.equal(wx.thumbUrl(BASE + '/', P(12)).href, BASE + P(12));
    assert.equal(wx.thumbUrl('https://weboostx2.wejlc.com', P(5)).href, 'https://weboostx2.wejlc.com' + P(5));
    for (const p of ['https://evil.example' + P(1), '//evil.example' + P(1), P(1) + '?x=1', '/api/v1/other', P('1/../2'), '', null])
        assert.equal(wx.thumbUrl(BASE, p), null, String(p));
    assert.equal(wx.thumbUrl('ftp://x' , P(1)), null);
    assert.equal(wx.thumbUrl('http://user:pw@host', P(1)), null);
    assert.equal(wx.thumbUrl('not a url', P(1)), null);
});

test('200 → เก็บไฟล์ + บันทึกฐาน · ส่ง key แค่ BASE · ไม่ตาม redirect · มี timeout', async () => {
    const dir = tmpDir();
    const st = memStore([row(1, P(10)), row(2, P(10)), row(3, P(11))]);
    const f = fakeWx({ [P(10)]: {}, [P(11)]: { type: 'image/png', body: PNG } });
    const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.saved, 2);
    assert.equal(r.failed, 0);
    assert.equal(f.calls.length, 2, 'โพสต์เดียวกัน 2 คลิป (path เดียว) โหลดครั้งเดียว');
    for (const c of f.calls) {
        assert.ok(c.url.startsWith(BASE + '/api/v1/integrations/kol-pfm/thumbnail/'));
        assert.equal(c.key, KEY);
        assert.equal(c.redirect, 'manual');
        assert.equal(c.hasSignal, true);
    }
    assert.equal(st.rows[0].thumbnail_local, wx.keyOf(P(10)) + '.jpg');
    assert.equal(st.rows[1].thumbnail_local, wx.keyOf(P(10)) + '.jpg');
    assert.equal(st.rows[2].thumbnail_local, wx.keyOf(P(11)) + '.png', 'นามสกุลตามหัวไฟล์จริง');
    assert.deepEqual(fs.readFileSync(path.join(dir, wx.keyOf(P(10)) + '.jpg')), JPEG);
    assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')).length, 0, 'ไม่มีไฟล์ชั่วคราวค้าง');
    assert.ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(r).includes(BASE), 'ผลสรุปไม่มี key / URL');
    assert.ok(!wx.thumbSummaryLine(r).includes(KEY) && !wx.thumbSummaryLine(r).includes('fixture.invalid'));
});

test('path ไม่เปลี่ยน = ไม่โหลดซ้ำ · path เปลี่ยน = โหลดรูปใหม่ (สำเนาเดิมไม่ถูกลบ)', async () => {
    const dir = tmpDir();
    const st = memStore([row(1, P(20))]);
    const f = fakeWx({ [P(20)]: {}, [P(21)]: { type: 'image/png', body: PNG } });
    await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    const first = st.rows[0].thumbnail_local;
    let r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.attempted, 0);
    assert.equal(f.calls.length, 1, 'รอบสองไม่เรียก WeBoostX');
    st.rows[0].weboostx_thumbnail_path = P(21);   // รอบซิงก์ได้ path ใหม่
    r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.saved, 1);
    assert.equal(f.calls.length, 2);
    assert.equal(st.rows[0].thumbnail_local, wx.keyOf(P(21)) + '.png');
    assert.ok(fs.existsSync(path.join(dir, first)), 'ไฟล์ของ path เดิมยังอยู่');
});

test('404 → จด error แล้วลองใหม่รอบหน้า · ไม่ลบสำเนาเดิม · ที่ยังไม่เคยลองได้คิวก่อน', async () => {
    const dir = tmpDir();
    const old = wx.keyOf(P(30)) + '.jpg';
    fs.writeFileSync(path.join(dir, old), JPEG);
    const st = memStore([row(1, P(31), { thumbnail_local: old })]);   // path เปลี่ยนเป็น 31 แต่ WeBoostX ยังไม่มีรูป
    const f = fakeWx({});
    let r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.failed, 1);
    assert.deepEqual(r.errors, { http_404: 1 });
    assert.equal(st.rows[0].thumbnail_error, 'http_404');
    assert.equal(st.rows[0].thumbnail_local, old, 'สำเนาเดิมยังใช้แสดงได้');
    assert.ok(fs.existsSync(path.join(dir, old)));
    r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(f.calls.length, 2, 'รอบหน้าลองใหม่');
    // มีรูปแล้ว → ได้ไฟล์ใหม่ · error หาย
    const f2 = fakeWx({ [P(31)]: {} });
    r = await wx.runThumbs({ storeImpl: st, fetchImpl: f2.impl, settings, dir });
    assert.equal(r.saved, 1);
    assert.equal(st.rows[0].thumbnail_error, null);
    assert.equal(st.rows[0].thumbnail_local, wx.keyOf(P(31)) + '.jpg');
    // คิว: path ที่ยังไม่เคยลองมาก่อน path ที่เคยล้ม
    const st2 = memStore([row(1, P(40), { thumbnail_error: 'http_404' }), row(2, P(41))]);
    const f3 = fakeWx({});
    await wx.runThumbs({ storeImpl: st2, fetchImpl: f3.impl, settings, dir });
    assert.equal(new URL(f3.calls[0].url).pathname, P(41));
});

test('ไม่ใช่รูป / หัวไฟล์ไม่ใช่รูป / ใหญ่เกิน / redirect / timeout / เครือข่ายล่ม → ไม่เก็บ · จดสาเหตุ', async () => {
    const dir = tmpDir();
    const st = memStore([row(1, P(50)), row(2, P(51)), row(3, P(52)), row(4, P(53)), row(5, P(54)), row(6, P(55)), row(7, P(56)), row(8, P(57))]);
    const big = Buffer.concat([JPEG, Buffer.alloc(wx.MAX_BYTES)]);
    const f = fakeWx({
        [P(50)]: { type: 'text/html', body: '<html>login</html>' },
        [P(51)]: { type: 'image/jpeg', body: Buffer.from('not really an image') },
        [P(52)]: { length: wx.MAX_BYTES + 1 },
        [P(53)]: { body: big },
        [P(54)]: { status: 302, location: 'http://127.0.0.1/steal' },
        [P(55)]: { throws: 'TimeoutError' },
        [P(56)]: { throws: 'TypeError' },
        [P(57)]: { status: 503 }
    });
    const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.saved, 0);
    assert.equal(r.failed, 8);
    assert.deepEqual(Object.fromEntries(st.rows.map(x => [x.id, x.thumbnail_error])),
        { 1: 'not_image', 2: 'unsupported_image', 3: 'too_large', 4: 'too_large', 5: 'http_302', 6: 'timeout', 7: 'network', 8: 'http_503' });
    assert.equal(f.calls.length, 8, 'redirect ไม่ถูกตาม (ไม่มีคำขอไปปลายทางอื่น)');
    assert.ok(f.calls.every(c => c.url.startsWith(BASE)));
    assert.equal(fs.readdirSync(dir).length, 0, 'ไม่มีไฟล์ถูกเก็บ');
    assert.ok(st.rows.every(x => x.thumbnail_local === null));
});

test('พร้อมกันไม่เกิน 4 · ไม่เกิน 200 path ต่อรอบ (ที่เหลือรอรอบหน้า)', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 205 }, (_, i) => row(i + 1, P(1000 + i)));
    const st = memStore(many);
    const map = Object.fromEntries(many.map(x => [x.weboostx_thumbnail_path, {}]));
    const f = fakeWx(map, { delayMs: 2 });
    const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.attempted, 200);
    assert.equal(r.pending, 205);
    assert.equal(r.saved, 200);
    assert.ok(f.max() <= wx.MAX_PARALLEL && f.max() >= 2, 'พร้อมกันสูงสุด ' + f.max());
    const r2 = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r2.attempted, 5);
});

test('ฐานบอกว่ามีสำเนาแต่ไฟล์หายจากเครื่อง (ย้ายเครื่อง / กู้ข้อมูล) → โหลดใหม่ ไม่ปล่อยช่องรูปว่างถาวร', async () => {
    const dir = tmpDir();
    const st = memStore([row(1, P(90), { thumbnail_local: wx.keyOf(P(90)) + '.jpg' })]);   // ชื่อตรง path แต่ไม่มีไฟล์
    const f = fakeWx({ [P(90)]: {} });
    const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.saved, 1);
    assert.equal(f.calls.length, 1);
    assert.ok(fs.existsSync(path.join(dir, wx.keyOf(P(90)) + '.jpg')));
    const again = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(again.attempted, 0, 'มีไฟล์แล้ว รอบต่อไปไม่โหลดซ้ำ');
});

test('path ที่ล้มถาวรเกิน 200 ตัวไม่บังตัวอื่นตลอดไป — ที่เคยล้มสลับลำดับทุกรอบ', async () => {
    const dir = tmpDir();
    const failing = Array.from({ length: 230 }, (_, i) => row(i + 1, P(5000 + i), { thumbnail_error: 'http_404' }));
    const st = memStore(failing);
    const f = fakeWx({});
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
        const before = f.calls.length;
        const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
        assert.equal(r.attempted, 200);
        f.calls.slice(before).forEach(c => seen.add(new URL(c.url).pathname));
    }
    assert.ok(seen.size > 200, `3 รอบต้องได้ลองมากกว่า 200 path (ได้ ${seen.size})`);
});

test('ไฟล์ของ path นี้มีอยู่แล้วในเครื่อง → ใช้ซ้ำไม่โหลดใหม่ · ฐานยังไม่มีคอลัมน์ / ไม่มี key → ข้ามรอบ', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, wx.keyOf(P(60)) + '.webp'), Buffer.from('RIFF0000WEBPVP8 '));
    const st = memStore([row(1, P(60))]);
    const f = fakeWx({});
    const r = await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings, dir });
    assert.equal(r.reused, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(st.rows[0].thumbnail_local, wx.keyOf(P(60)) + '.webp');
    assert.deepEqual(await wx.runThumbs({ storeImpl: { thumbRows: async () => null }, fetchImpl: f.impl, settings, dir }), { skipped: true, reason: 'columns_missing' });
    assert.deepEqual(await wx.runThumbs({ storeImpl: st, fetchImpl: f.impl, settings: { baseUrl: BASE, apiKey: '' }, dir }), { skipped: true, reason: 'unconfigured' });
    assert.equal(f.calls.length, 0);
});

test('localFile: เปิดได้เฉพาะไฟล์ชื่อแบบสำเนาของเราในโฟลเดอร์รูป', () => {
    const dir = tmpDir();
    const name = wx.keyOf(P(70)) + '.jpg';
    fs.writeFileSync(path.join(dir, name), JPEG);
    assert.equal(wx.localFile(name, dir), path.join(dir, name));
    assert.equal(wx.localFile(wx.keyOf(P(71)) + '.jpg', dir), null, 'ไม่มีไฟล์');
    for (const bad of ['../' + name, name + '/', '..\\' + name, 'x.jpg', null]) assert.equal(wx.localFile(bad, dir), null, String(bad));
});

// ---------------------------------------------------------------- รอบของตัวตั้งเวลา: ซิงก์ค่าแอด → โหลดรูป
const env = { WEBOOSTX_PFM_SYNC_ENABLED: 'true', WEBOOSTX_PFM_EXPORT_KEY: KEY, WEBOOSTX_PFM_BASE_URL: BASE };
const igLink = 'https://www.instagram.com/reel/Example/';
const quiet = { log: () => {}, error: () => {} };
function cycleStore({ thumbsThrow = false } = {}) {
    const applied = [];
    const st = memStore([row(1, P(80))]);
    return {
        applied, st,
        items: async () => [{ submission_id: 1, platform: 'instagram', item_id: igLink }],
        apply: async rows => { applied.push(...rows); return { updated: rows.length }; },
        thumbRows: thumbsThrow ? async () => { throw new Error('db down'); } : st.thumbRows,
        thumbSaved: st.thumbSaved, thumbFailed: st.thumbFailed
    };
}
const metricsReply = () => new Response(JSON.stringify({ status: 'success', data: { rows: [
    { item_id: igLink, id_post: '123', platform: 'instagram', ad_spend: 10, pfm: 7.7, pfm_grade: 'A', thumbnail_url: P(80) }] } }),
    { status: 200, headers: { 'content-type': 'application/json' } });

test('ดาวน์โหลดรูปล้ม (WeBoostX ตอบ 503 / timeout) → ผลซิงก์ค่าแอดยังสำเร็จ', async () => {
    const dir = tmpDir();
    const cs = cycleStore();
    const fetchImpl = async url => (String(url).endsWith('/metrics') ? metricsReply() : new Response(null, { status: 503 }));
    const out = await sync.runCycle({ env, logger: quiet, storeImpl: cs, fetchImpl, thumbDir: dir });
    assert.equal(out.sync.updated, 1);
    assert.equal(cs.applied[0].ad_spend, 10);
    assert.equal(out.thumbs.failed, 1);
    assert.equal(sync.getStatus(env).last_run.status, 'success');
    const timeoutFetch = async url => { if (String(url).endsWith('/metrics')) return metricsReply(); throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
    const out2 = await sync.runCycle({ env, logger: quiet, storeImpl: cycleStore(), fetchImpl: timeoutFetch, thumbDir: dir });
    assert.equal(out2.sync.updated, 1);
    assert.deepEqual(out2.thumbs.errors, { timeout: 1 });
});

test('ตัวดาวน์โหลดพังทั้งรอบ (ฐานล่มตอนอ่านแถวรูป) → ซิงก์ค่าแอดยังสำเร็จ · log ไม่มี key', async () => {
    const dir = tmpDir();
    const logs = [];
    const logger = { log: m => logs.push(m), error: m => logs.push(m) };
    const cs = cycleStore({ thumbsThrow: true });
    const out = await sync.runCycle({ env, logger, storeImpl: cs, fetchImpl: async () => metricsReply(), thumbDir: dir });
    assert.equal(out.sync.updated, 1);
    assert.equal(out.thumbsError, 'db down');
    assert.equal(sync.getStatus(env).last_run.status, 'success');
    assert.ok(logs.every(l => !l.includes(KEY)), 'log ไม่มี key');
});

test('ซิงก์ค่าแอดล้ม (WeBoostX ล่ม) → ยังลองโหลดรูปของ path ที่มีอยู่ · สถานะไม่มี key', async () => {
    const dir = tmpDir();
    const cs = cycleStore();
    const fetchImpl = async url => (String(url).endsWith('/metrics') ? new Response(null, { status: 500 }) : new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const out = await sync.runCycle({ env, logger: quiet, storeImpl: cs, fetchImpl, thumbDir: dir });
    assert.match(out.syncError, /HTTP 500/);
    assert.equal(out.thumbs.saved, 1);
    const status = JSON.stringify(sync.getStatus(env));
    assert.ok(!status.includes(KEY) && !status.includes('wx.fixture.invalid'), 'สถานะไม่มี key / URL');
    assert.equal(sync.getStatus(env).thumbnails.last_run.saved, 1);
});
