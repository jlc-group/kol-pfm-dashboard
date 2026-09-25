const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// เกณฑ์ค่าแอดที่ระบบจะล็อกผล PFM (สแตมป์) — แยกตามแบรนด์ได้ · ตรรกะล้วน ไม่มีฐานข้อมูล
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { AD_STAMP_AT, AD_STAMP_BY_BRAND, stampAtFor, maybeStamp, stampWaitReason } = require(path.join(SRC, 'store/logic.js'));

let web;
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/stamp.js')).href);
});

// คลิปที่ข้อมูลครบทุกอย่างแล้ว เหลือแค่ค่าแอดว่าถึงเกณฑ์ไหม
const clip = (over = {}) => ({ ad_spend: 3000, budget: 5000, views: 100000, likes: 1000, perf_stamp: null, ...over });

test('Beauterry ใช้เกณฑ์ 3,000 · แบรนด์อื่นยังเป็น 10,000 เหมือนเดิม', () => {
    assert.equal(AD_STAMP_AT, 10000);
    assert.equal(stampAtFor('Beauterry'), 3000);
    assert.equal(stampAtFor("Jula's Herb"), 10000);
    assert.equal(stampAtFor('Dermiq'), 10000);
    // แคมเปญที่ไม่ได้ใส่แบรนด์ / ค่าที่หน้าเว็บเติมให้เมื่อไม่มีแบรนด์ ต้องได้ค่ากลาง ไม่ใช่ undefined
    assert.equal(stampAtFor(null), 10000);
    assert.equal(stampAtFor(undefined), 10000);
    assert.equal(stampAtFor(''), 10000);
    assert.equal(stampAtFor('อื่นๆ'), 10000);
    // ชื่อแบรนด์ที่มีช่องว่างติดมาจากการกรอก ต้องยังเจอเกณฑ์ของแบรนด์
    assert.equal(stampAtFor('  Beauterry  '), 3000);
    // ตัวพิมพ์ต้องตรง — ชื่อแบรนด์ในฐานเป็นค่าที่ทีมกรอกเอง ถ้าเดาให้จะเงียบและผิดยากตรวจ
    assert.equal(stampAtFor('beauterry'), 10000);
});

test('ค่าแอดถึงเกณฑ์ของแบรนด์แล้วสแตมป์ทันที ต่ำกว่านั้นยังไม่สแตมป์', () => {
    const at = stampAtFor('Beauterry');
    assert.equal(maybeStamp(clip({ ad_spend: at - 1 }), at), null);
    const stamped = maybeStamp(clip({ ad_spend: at }), at);
    assert.ok(stamped, 'ค่าแอด 3,000 ต้องสแตมป์');
    assert.equal(stamped.ad_spend, 3000);
    assert.equal(stamped.total_cost, 8000);          // ค่าตัว 5,000 + ค่าแอด 3,000
});

test('ไม่ส่งเกณฑ์มา = ใช้ค่ากลาง 10,000 เหมือนเดิม (ทางเรียกเก่าไม่เปลี่ยนพฤติกรรม)', () => {
    assert.equal(maybeStamp(clip({ ad_spend: 3000 })), null);
    assert.equal(maybeStamp(clip({ ad_spend: AD_STAMP_AT - 1 })), null);
    assert.ok(maybeStamp(clip({ ad_spend: AD_STAMP_AT })));
    assert.equal(stampWaitReason(clip({ ad_spend: 3000, views: 0 })), null);
});

test('เกณฑ์ต่ำลงแล้ว เงื่อนไขอื่นยังเหมือนเดิม — ไม่มียอดวิว/ไม่มีค่าตัว ยังไม่สแตมป์', () => {
    const at = 3000;
    // ผู้ใช้เลือกไว้: ยังไม่มียอดวิวให้รอก่อน ห้ามล็อกค่าว่างค้างถาวร
    assert.equal(maybeStamp(clip({ views: 0 }), at), null);
    assert.equal(maybeStamp(clip({ budget: 0 }), at), null);
    // และต้องบอกได้ว่ารออะไรอยู่ ด้วยเกณฑ์เดียวกัน
    assert.equal(stampWaitReason(clip({ views: 0 }), at), 'views');
    assert.equal(stampWaitReason(clip({ budget: 0 }), at), 'fee');
    assert.equal(stampWaitReason(clip(), at), null);
    assert.equal(stampWaitReason(clip({ ad_spend: at - 1, views: 0 }), at), null);
});

test('สแตมป์แล้วห้ามแตะซ้ำ แม้เกณฑ์จะเปลี่ยน', () => {
    const old = { verdict: 'Pass', ad_spend: 12000 };
    const s = clip({ perf_stamp: old, ad_spend: 50000 });
    assert.equal(maybeStamp(s, 3000), null);
    assert.equal(s.perf_stamp, old);
});

test('สำเนาฝั่งหน้าเว็บต้องตรงกับฝั่ง server ทุกตัวอักษร', () => {
    assert.equal(web.AD_STAMP_AT, AD_STAMP_AT);
    assert.deepEqual(web.AD_STAMP_BY_BRAND, AD_STAMP_BY_BRAND);
    Object.keys(AD_STAMP_BY_BRAND).concat(['Dermiq', '', null, '  Beauterry  ', 'beauterry'])
        .forEach(b => assert.equal(web.stampAtFor(b), stampAtFor(b), 'แบรนด์ ' + JSON.stringify(b)));
    // เทียบข้อความในไฟล์ด้วย — แก้ฝั่งเดียวแล้วลืมอีกฝั่ง เทสต์ต้องแดงทันที
    const mapOf = file => {
        const m = fs.readFileSync(path.join(__dirname, file), 'utf8').match(/AD_STAMP_BY_BRAND = (\{[^}]*\})/);
        assert.ok(m, 'หา AD_STAMP_BY_BRAND ไม่เจอใน ' + file);
        return m[1].replace(/\s+/g, ' ').trim();
    };
    assert.equal(mapOf('../client/src/data/stamp.js'), mapOf('../server/src/store/logic.js'));
});

test('หน้าเว็บอ่านเกณฑ์จากแถวที่ server ส่งมา ไม่ใช่เดาเอง', () => {
    assert.equal(web.stampAtOf({ stamp_at: 3000 }), 3000);
    // แท็บที่เปิดค้างจากรุ่นก่อนหน้ายังไม่มีช่องนี้ — ต้องถอยไปใช้ค่ากลาง ไม่ใช่ 0 (0 จะทำให้กล่องยืนยันไม่ขึ้นเลย)
    assert.equal(web.stampAtOf({}), AD_STAMP_AT);
    assert.equal(web.stampAtOf(null), AD_STAMP_AT);
    assert.equal(web.stampAtOf({ stamp_at: 0 }), AD_STAMP_AT);
    assert.equal(web.stampAtText(3000), '3,000');
});
