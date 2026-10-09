const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ฟีดคลิปให้ Beauterry PFM แยกต่อแบรนด์ (9 ต.ค. 2026 · สเปก beauterry-pfm docs/kol-content-sync.md "Multiple brands")
// GET /api/integrations/<beauterry|jarvit|jernis>/content-candidates · รหัสลับเดียวกัน · รหัสไม่รู้จัก = 404 (หลังตรวจรหัสลับ)
// ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
const express = require('../server/node_modules/express');
const route = require('../server/src/routes/contentExport');
const store = require('../server/src/store');

const CALLS = [];
const original = store.contentExport.listCandidates;
let server, base;
before(async () => {
    store.contentExport.listCandidates = async args => {
        CALLS.push(args);
        return [{ submission_id: 1, id_post: '7600000000000000001', brand: args.brand, platform: 'TikTok', ad_status: 'ยังไม่ยิง' }];
    };
    const app = express();
    app.use('/api/integrations/:brand', route);   // ผูกแบบเดียวกับ server/src/app.js
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/integrations`;
});
// ปิดการเชื่อมต่อให้หมดก่อนจบไฟล์ — deploy รันเทสต์แบบ --test-force-exit บน Windows แล้ว libuv แครชถ้ายังมี socket ค้าง
after(async () => {
    store.contentExport.listCandidates = original;
    for (const k of ['KOL_CONTENT_EXPORT_ENABLED', 'KOL_CONTENT_EXPORT_KEY', 'KOL_CONTENT_EXPORT_BRAND']) delete process.env[k];
    if (!server) return;
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
});
const get = async (p, key = 'content-key') => {
    const res = await fetch(base + p, { headers: key ? { 'X-KOL-Content-Key': key, Connection: 'close' } : { Connection: 'close' } });
    return { status: res.status, body: await res.json() };
};
const enable = () => {
    process.env.KOL_CONTENT_EXPORT_ENABLED = 'true';
    process.env.KOL_CONTENT_EXPORT_KEY = 'content-key';
    process.env.KOL_CONTENT_EXPORT_BRAND = 'Beauterry';
};

test('app.js ผูกฟีดไว้ที่ /api/integrations/:brand (ทางเดิมของ Beauterry ยังใช้ได้)', () => {
    const app = fs.readFileSync(path.join(__dirname, '../server/src/app.js'), 'utf8');
    assert.match(app, /app\.use\('\/api\/integrations\/:brand', require\('\.\/routes\/contentExport'\)\);/);
    assert.doesNotMatch(app, /app\.use\('\/api\/integrations\/beauterry'/);
});

test('ปิดฟีดอยู่ = 503 ทุกแบรนด์ · ไม่อ่านข้อมูล', async () => {
    CALLS.length = 0;
    for (const code of ['beauterry', 'jarvit', 'jernis']) assert.equal((await get(`/${code}/content-candidates`)).status, 503, code);
    assert.equal(CALLS.length, 0);
});

test('beauterry = แบรนด์จาก KOL_CONTENT_EXPORT_BRAND เหมือนเดิม · jarvit / jernis = แบรนด์ของตัวเอง (รูปแบบเดียวกัน)', async () => {
    enable();
    CALLS.length = 0;
    const b = await get('/beauterry/content-candidates?limit=5');
    assert.equal(b.status, 200);
    assert.deepEqual(CALLS.at(-1), { brand: 'Beauterry', limit: 6, updatedSince: null });
    assert.deepEqual(b.body.data.filters, { brand: 'Beauterry', platform: 'TikTok', ad_status: 'ยังไม่ยิง' });
    for (const [p, brand] of [['/jarvit', 'Jarvit'], ['/jernis', 'Jernis'], ['/JERNIS', 'Jernis']]) {
        const r = await get(p + '/content-candidates?updated_since=2026-10-09T03:00:00Z');
        assert.equal(r.status, 200, p);
        assert.deepEqual(CALLS.at(-1), { brand, limit: 101, updatedSince: '2026-10-09T03:00:00.000Z' }, p);
        assert.equal(r.body.status, 'success');
        assert.equal(r.body.data.count, 1);
        assert.equal(r.body.data.items[0].brand, brand);
        assert.deepEqual(r.body.data.filters, { brand, platform: 'TikTok', ad_status: 'ยังไม่ยิง' });
    }
});

test('แบรนด์ที่ไม่รู้จัก = 404 UNKNOWN_BRAND ไม่ถอยไปส่งข้อมูล Beauterry · ตรวจรหัสลับก่อน (ไม่มีรหัสเดารายชื่อแบรนด์ไม่ได้)', async () => {
    enable();
    CALLS.length = 0;
    for (const code of ['julaherb', 'jula%27s%20herb', 'dermiq', 'constructor', '__proto__', 'beauterry2']) {
        const r = await get(`/${code}/content-candidates`);
        assert.equal(r.status, 404, code);
        assert.equal(r.body.code, 'UNKNOWN_BRAND', code);
    }
    assert.equal((await get('/julaherb/content-candidates', 'wrong')).status, 401);
    assert.equal((await get('/julaherb/content-candidates', null)).status, 401);
    assert.equal((await get('/jarvit/content-candidates', 'wrong')).status, 401);
    assert.equal(CALLS.length, 0, 'ไม่อ่านข้อมูลเลย');
});

test('ตรวจค่าขาเข้าเหมือนฟีด Beauterry: limit / updated_since ผิด = 400', async () => {
    enable();
    CALLS.length = 0;
    assert.equal((await get('/jarvit/content-candidates?limit=0')).body.code, 'INVALID_LIMIT');
    assert.equal((await get('/jernis/content-candidates?updated_since=nope')).body.code, 'INVALID_UPDATED_SINCE');
    assert.equal(CALLS.length, 0);
});
