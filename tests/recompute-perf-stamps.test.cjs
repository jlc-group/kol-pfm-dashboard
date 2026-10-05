const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// สคริปต์คิดผลที่ล็อกไว้ (perf_stamp 🔒) ใหม่ ตามสูตรค่าตัวอย่างเดียว (ผู้ใช้สั่ง 5 ต.ค. 2026)
// เทสต์เฉพาะส่วนคิดเลข (ไม่ต่อฐาน) — ตัวต่อฐานทำงานเมื่อรันสคริปต์ตรง ๆ เท่านั้น (require.main)
const { recomputeStamp, planAll } = require(path.join(__dirname, '../scripts/recompute-perf-stamps.cjs'));
const { clipCostMetrics } = require(path.join(__dirname, '../server/src/store/logic'));

// ผลที่ล็อกด้วยสูตรเดิม: ค่าตัว 5,000 + ค่าแอด 12,000 · วิว 100,000 · engagement 1,200 → CPM 170 · CPE 14.17
const OLD = { at: '2026-09-25T10:00:00.000Z', ad_spend: 12000, views: 100000, engagement: 1200, er: 1.2,
    total_cost: 17000, cpm: 170, cpe: 14.17, verdict: 'Fail' };

test('recomputeStamp: ใช้ค่าตัว ณ วันล็อก (total_cost − ad_spend) · ตรงกับ clipCostMetrics ทุกตัวเลข', () => {
    const r = recomputeStamp(OLD);
    assert.deepEqual(r, { cpm: 50, cpe: 4.17, verdict: 'Fail', fee: 5000 });
    const live = clipCostMetrics({ fee: 5000, adSpend: 12000, views: 100000, engagement: 1200 });
    assert.deepEqual([r.cpm, r.cpe], [live.cpm, live.cpe]);
    // ถูกพอ = Pass (เกณฑ์ ≤ 28 / ≤ 1.5)
    assert.equal(recomputeStamp({ ...OLD, total_cost: 14000, ad_spend: 12000, views: 200000, engagement: 2000 }).verdict, 'Pass');
    // engagement 0 = CPE 0 = Fail (แบบเดียวกับตอนล็อก)
    assert.deepEqual(recomputeStamp({ ...OLD, engagement: 0 }), { cpm: 50, cpe: 0, verdict: 'Fail', fee: 5000 });
    // ตัวเลขที่เก็บเป็นสตริง (NUMERIC จาก JSON) ก็คิดได้
    assert.equal(recomputeStamp({ ...OLD, total_cost: '17000', ad_spend: '12000' }).cpm, 50);
});

test('recomputeStamp: ได้ฟรี (ค่าตัว ณ วันล็อก 0) / ไม่มียอดวิว / ข้อมูลเสีย = คิดไม่ได้ (null)', () => {
    assert.equal(recomputeStamp({ ...OLD, total_cost: 12000 }), null);
    assert.equal(recomputeStamp({ ...OLD, views: 0 }), null);
    assert.equal(recomputeStamp(null), null);
    assert.equal(recomputeStamp('x'), null);
});

test('planAll: เปลี่ยนเฉพาะ cpm / cpe / verdict · ช่องอื่นของผลที่ล็อกคงเดิม · แถวที่ตรงสูตรใหม่แล้วไม่เขียนซ้ำ · ได้ฟรีข้ามพร้อมเหตุผล', () => {
    const rows = [
        { id: 1, perf_stamp: OLD },
        { id: 2, perf_stamp: { ...OLD, cpm: 50, cpe: 4.17 } },                // คิดด้วยสูตรใหม่แล้ว
        { id: 3, perf_stamp: { ...OLD, total_cost: 12000 } },                 // ได้ฟรี
        { id: 4, perf_stamp: { at: 'x', verdict: 'Pass' } }                   // ข้อมูลไม่ครบ
    ];
    const { plan, skipped } = planAll(rows);
    assert.deepEqual(plan.map(p => p.id), [1]);
    assert.deepEqual(plan[0].before, { cpm: 170, cpe: 14.17, verdict: 'Fail' });
    assert.deepEqual(plan[0].after, { cpm: 50, cpe: 4.17, verdict: 'Fail' });
    const { cpm, cpe, verdict, ...rest } = plan[0].stamp;
    const { cpm: c0, cpe: e0, verdict: v0, ...restOld } = OLD;
    assert.deepEqual(rest, restOld, 'at / ad_spend / views / engagement / er / total_cost ไม่แตะ');
    assert.deepEqual(skipped, [{ id: 3, reason: 'ค่าตัว ณ วันล็อกเป็น 0 (ได้ฟรี)' }, { id: 4, reason: 'ข้อมูลในผลที่ล็อกไม่ครบ' }]);
    // ข้อมูลเดิมไม่ถูกแก้ทับ (planAll ไม่แตะ object ต้นฉบับ)
    assert.equal(rows[0].perf_stamp.cpm, 170);
});
