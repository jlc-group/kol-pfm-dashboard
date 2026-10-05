const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ตรรกะล้วนของการสแตมป์ผลงาน — ไม่มีฐานข้อมูล ไม่มีเซิร์ฟเวอร์
const logicPath = require.resolve(path.join(__dirname, '../server/src/store/logic.js'));
const { maybeStamp, stampWaitReason, AD_STAMP_AT } = require(logicPath);

// คลิปที่ค่าแอดถึงเกณฑ์แล้ว มียอดวิวและค่าตัวครบ (แก้ทีละช่องได้ด้วย fields)
const clip = (fields = {}) => ({
    ad_spend: 12000, views: 100000, likes: 1000, comments: 100, saves: 50, shares: 50, reposts: 0,
    budget: 5000, perf_stamp: null, ...fields
});

test('requiring logic.js pulls in no database driver or pool', () => {
    // ตรวจเฉพาะโมดูลฐานข้อมูล — เครื่อง deploy อาจโหลดโมดูลอื่นไว้ก่อนผ่าน NODE_OPTIONS ห้ามให้เทสต์ล้มเพราะเรื่องนั้น
    const loaded = Object.keys(require.cache);
    assert.ok(loaded.includes(logicPath));
    const dbModules = loaded.filter(f => /[\\/]node_modules[\\/]pg(-[a-z]+)?[\\/]/.test(f)
        || /[\\/]server[\\/]src[\\/](config[\\/]db\.js|store[\\/]pg[\\/])/.test(f));
    assert.deepEqual(dbModules, []);
});

test('no fee yet: maybeStamp waits and leaves perf_stamp empty', () => {
    for (const budget of [0, '0', '', null, undefined, -100]) {
        const s = clip({ budget });
        assert.equal(maybeStamp(s), null);
        assert.equal(s.perf_stamp, null);
    }
});

test('fee + ad spend + views: stamp locks total cost as fee plus ad spend · CPM/CPE from the fee only', () => {
    const s = clip();
    const stamp = maybeStamp(s);
    assert.ok(stamp);
    assert.equal(s.perf_stamp, stamp);
    assert.equal(stamp.total_cost, 17000);
    assert.equal(stamp.ad_spend, 12000);
    assert.equal(stamp.views, 100000);
    assert.equal(stamp.engagement, 1200);
    // CPM/CPE คิดจากค่าตัวอย่างเดียว (5 ต.ค. 2026): 5000 ÷ 100 = 50 (เกิน 28) · 5000 ÷ 1200 = 4.17
    assert.equal(stamp.cpm, 50);
    assert.equal(stamp.cpe, 4.17);
    assert.equal(stamp.verdict, 'Fail');
    assert.equal(typeof stamp.at, 'string');
    // NUMERIC ที่มาเป็นสตริงก็ต้องบวกเป็นตัวเลข ไม่ใช่ต่อสตริง
    assert.equal(maybeStamp(clip({ budget: '5000.00', ad_spend: '12000.00' })).total_cost, 17000);
});

test('views 0 or ad spend below the threshold: no stamp', () => {
    const noViews = clip({ views: 0 });
    assert.equal(maybeStamp(noViews), null);
    assert.equal(noViews.perf_stamp, null);
    assert.equal(maybeStamp(clip({ ad_spend: AD_STAMP_AT - 1 })), null);
    assert.ok(maybeStamp(clip({ ad_spend: AD_STAMP_AT })));
    assert.equal(maybeStamp(null), null);
});

test('an existing stamp is never touched, even when the fee changes later', () => {
    const locked = { at: '2026-01-01T00:00:00.000Z', total_cost: 12000, verdict: 'Pass' };
    const s = clip({ perf_stamp: locked, budget: 9000 });
    assert.equal(maybeStamp(s), null);
    assert.equal(s.perf_stamp, locked);
    assert.deepEqual(s.perf_stamp, { at: '2026-01-01T00:00:00.000Z', total_cost: 12000, verdict: 'Pass' });
});

test('fee set later: the stamp locks on that update', () => {
    const s = clip({ budget: 0 });
    assert.equal(maybeStamp(s), null);
    s.budget = 8000;
    assert.equal(maybeStamp(s).total_cost, 20000);
    assert.equal(stampWaitReason(s), null);
});

test('KOL รายคน (solo): fee 0 means free — never waits for a fee, and ad spend is the basis so it does stamp', () => {
    // แคมเปญ KOL (ไม่ส่งประเภท / 'kol') ยังรอค่าตัวเหมือนเดิม
    assert.equal(maybeStamp(clip({ budget: 0 })), null);
    assert.equal(maybeStamp(clip({ budget: 0 }), AD_STAMP_AT, 'kol'), null);
    assert.equal(stampWaitReason(clip({ budget: 0 })), 'fee');
    for (const budget of [0, '0', '', null]) {
        assert.equal(stampWaitReason(clip({ budget }), AD_STAMP_AT, 'solo'), null, String(budget));
    }
    // ได้ฟรีถึงเกณฑ์ค่าแอดแล้ว = สแตมป์ · ค่าแอดคือต้นทุนทั้งหมดที่มี จึงเป็นฐานของ CPM/CPE
    const s = clip({ budget: 0 });
    const st = maybeStamp(s, AD_STAMP_AT, 'solo');
    assert.ok(st);
    assert.equal(s.perf_stamp, st);
    assert.equal(st.total_cost, 12000);          // ค่าตัว 0 + ค่าแอด 12,000
    assert.equal(st.cpm, 120);                   // 12,000 / (100,000 / 1,000)
    assert.equal(st.cpe, 10);                    // 12,000 / 1,200
    // ยังรอยอดวิว / ค่าแอดยังไม่ถึงเกณฑ์ = ยังไม่สแตมป์เหมือนเดิม
    assert.equal(maybeStamp(clip({ budget: 0, views: 0 }), AD_STAMP_AT, 'solo'), null);
    assert.equal(stampWaitReason(clip({ budget: 0, views: 0 }), AD_STAMP_AT, 'solo'), 'views');
    assert.equal(maybeStamp(clip({ budget: 0, ad_spend: AD_STAMP_AT - 1 }), AD_STAMP_AT, 'solo'), null);
    // KOL รายคนที่มีค่าตัว = ต้นทุนค่าตัว + ค่าแอด ตามเดิม
    assert.equal(maybeStamp(clip(), AD_STAMP_AT, 'solo').total_cost, 17000);
});

test('stampWaitReason says what a stamp is waiting for', () => {
    assert.equal(stampWaitReason(clip({ budget: 0 })), 'fee');
    assert.equal(stampWaitReason(clip({ views: 0 })), 'views');
    // ขาดทั้งคู่ บอกยอดวิวก่อน (ลำดับเดียวกับ maybeStamp)
    assert.equal(stampWaitReason(clip({ views: 0, budget: 0 })), 'views');
    assert.equal(stampWaitReason(clip({ budget: 0, ad_spend: AD_STAMP_AT - 1 })), null);
    assert.equal(stampWaitReason(clip({ budget: 0, perf_stamp: { verdict: 'Pass' } })), null);
    assert.equal(stampWaitReason(clip()), null);
    assert.equal(stampWaitReason(null), null);
    // รออะไรอยู่ = ต้องยังสแตมป์ไม่ได้จริง
    for (const fields of [{ budget: 0 }, { views: 0 }, { views: 0, budget: 0 }]) {
        assert.notEqual(stampWaitReason(clip(fields)), null);
        assert.equal(maybeStamp(clip(fields)), null);
    }
});
