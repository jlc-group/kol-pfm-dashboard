const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ผลที่ล็อกไว้ (perf_stamp 🔒) สูตรเดิม (ค่าตัว + ค่าแอด) → คิดใหม่ตอนส่งไปหน้าเว็บด้วยสูตรค่าตัวอย่างเดียว (5 ต.ค. 2026)
// ลูกศร ↑↓ / ผ่าน-ไม่ผ่าน ในหน้า Ads / Influencer List เทียบผลที่ล็อกกับตัวเลขสด — ต้องเป็นสูตรเดียวกัน ไม่งั้นเทียบข้ามสูตร
const { stampFeeOnly, normalizeStamp, clipCostMetrics, maybeStamp } = require(path.join(__dirname, '../server/src/store/logic'));

// ล็อกด้วยสูตรเดิม: ค่าตัว 5,000 + ค่าแอด 12,000 · วิว 100,000 · engagement 1,200 → CPM 170 · CPE 14.17
const OLD = { at: '2026-09-25T10:00:00.000Z', ad_spend: 12000, views: 100000, engagement: 1200, er: 1.2,
    total_cost: 17000, cpm: 170, cpe: 14.17, verdict: 'Fail' };

test('normalizeStamp: ผลสูตรเดิม → CPM/CPE/ผลตัดสิน สูตรค่าตัวอย่างเดียว (ค่าตัว ณ วันล็อก) · ช่องอื่นไม่แตะ · ไม่แก้ตัวต้นฉบับ', () => {
    const out = normalizeStamp(OLD);
    assert.deepEqual(out, { ...OLD, cpm: 50, cpe: 4.17, verdict: 'Fail' });
    assert.notEqual(out, OLD, 'คืน object ใหม่');
    assert.equal(OLD.cpm, 170, 'ต้นฉบับไม่ถูกแก้');
    // ตรงกับตัวเลขสดของคลิปเดียวกัน (ค่าตัวเท่าเดิม) — เทียบสูตรเดียวกันแล้ว
    const live = clipCostMetrics({ fee: 5000, adSpend: 15000, views: 100000, engagement: 1200 });
    assert.deepEqual([out.cpm, out.cpe], [live.cpm, live.cpe]);
});

test('normalizeStamp: ผลตัดสินพลิกได้ตามสูตรใหม่ (เดิม Fail เพราะรวมค่าแอด → ตอนนี้ Pass)', () => {
    const cheap = { ...OLD, total_cost: 14000, ad_spend: 12000, views: 200000, engagement: 2000, cpm: 70, cpe: 7, verdict: 'Fail' };
    assert.deepEqual(normalizeStamp(cheap), { ...cheap, cpm: 10, cpe: 1, verdict: 'Pass' });
});

test('normalizeStamp: ตรงสูตรใหม่อยู่แล้ว = ตัวเดิม (ผลที่ล็อกหลัง 5 ต.ค. / รันสคริปต์แก้ในฐานแล้ว) · รันซ้ำได้ผลเดิม', () => {
    const fresh ={ budget: 5000, ad_spend: 12000, views: 100000, likes: 1000, comments: 200, perf_stamp: null };
    const stamped = maybeStamp(fresh);
    assert.equal(normalizeStamp(stamped), stamped, 'ผลที่ maybeStamp ล็อกตอนนี้ไม่ต้องคิดใหม่');
    const once = normalizeStamp(OLD);
    assert.equal(normalizeStamp(once), once, 'idempotent');
});

test('normalizeStamp: คิดไม่ได้ = ตัวเดิม (ได้ฟรี ค่าตัว ณ วันล็อก 0 / ไม่มียอดวิว / ข้อมูลไม่ครบ / ไม่ใช่ object)', () => {
    const free = { ...OLD, total_cost: 12000 };
    assert.equal(normalizeStamp(free), free);
    const noViews = { ...OLD, views: 0 };
    assert.equal(normalizeStamp(noViews), noViews);
    const partial = { at: 'x', verdict: 'Pass' };
    assert.equal(normalizeStamp(partial), partial);
    assert.equal(normalizeStamp(null), null);
    assert.equal(normalizeStamp('x'), 'x');
});

test('stampFeeOnly: ตัวเลขเป็นสตริง (NUMERIC จาก JSON) ได้ · เศษทศนิยมจากการลบไม่ทำให้ปัดผิด', () => {
    assert.deepEqual(stampFeeOnly({ ...OLD, total_cost: '17000', ad_spend: '12000' }), { cpm: 50, cpe: 4.17, verdict: 'Fail', fee: 5000 });
    // 0.1 + 0.2 แบบทศนิยม: ค่าตัว 1234.56 + ค่าแอด 3000.3 → ลบกลับต้องได้ 1234.56 พอดี
    const r = stampFeeOnly({ total_cost: 4234.86, ad_spend: 3000.3, views: 10000, engagement: 100 });
    assert.equal(r.fee, 1234.56);
    assert.deepEqual([r.cpm, r.cpe], [123.46, 12.35]);
    assert.equal(stampFeeOnly({ ...OLD, engagement: 0 }).cpe, 0, 'engagement 0 = CPE 0 (Fail) แบบเดียวกับตอนล็อก');
});
