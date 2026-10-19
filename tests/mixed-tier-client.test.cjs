const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// "คละ Tier" (19 ต.ค. 2026): ทีมตั้ง Tier ของ Platform เป็นคละ → ตอนกรอกรายชื่อเลือกได้ทุก Tier (tiersOf ขยายเป็น 4 Tier)
// ตรรกะล้วน ไม่มีฐานข้อมูล
let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

const block = (platform, tierNames, sets = [{ content_type: 'Review' }]) => ({
    platform, products: ['L3'],
    sets: sets.map(s => ({ ...s, tiers: tierNames.map((tier, k) => ({ tier, kols: k === 0 ? '10' : '' })) }))
});
const groupOf = (...blocks) => ({ allocations: web.flattenBlocks(blocks) });

test('ค่าคงที่: 4 Tier ปกติเรียงเล็ก → ใหญ่ · คละ Tier ไม่ใช่หนึ่งใน 4 Tier', () => {
    assert.deepEqual(web.KOL_TIERS, ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+']);
    assert.equal(web.MIXED_TIER, 'คละ Tier');
    assert.equal(web.KOL_TIERS.includes(web.MIXED_TIER), false);
});

test('tiersOf: คละ Tier = เลือกได้ทั้ง 4 Tier ตามลำดับปกติ', () => {
    const g = groupOf(block('TikTok', [web.MIXED_TIER]));
    assert.deepEqual(web.tiersOf(g, 'TikTok', 'Review'), web.KOL_TIERS);
    assert.deepEqual(web.tiersOf(g, 'TikTok'), web.KOL_TIERS, 'ไม่ระบุ Content Type ก็ได้ครบ');
    assert.equal(web.tiersOf(g, 'TikTok', 'Review').includes(web.MIXED_TIER), false, 'ห้ามมี "คละ Tier" เป็นตัวเลือกให้เก็บลงแถวรายชื่อ');
});

test('tiersOf: คละ Tier ปนกับ Tier อื่น = ยังครบ 4 Tier ไม่ซ้ำ ลำดับปกติ · ชื่อนอกรายการต่อท้าย', () => {
    const g = groupOf(block('TikTok', ['Mega 1M+', web.MIXED_TIER, 'Nano 1k - 10k']));
    assert.deepEqual(web.tiersOf(g, 'TikTok', 'Review'), web.KOL_TIERS);
    const odd = groupOf(block('TikTok', ['Celeb', web.MIXED_TIER]));
    assert.deepEqual(web.tiersOf(odd, 'TikTok', 'Review'), [...web.KOL_TIERS, 'Celeb']);
});

test('tiersOf: คละ Tier ของ Platform หนึ่งไม่ลามไป Platform อื่น · ไม่มีคละ = แบบเดิมทุกอย่าง', () => {
    const g = groupOf(block('TikTok', [web.MIXED_TIER]), block('Instagram', ['Micro 10k - 100k']));
    assert.deepEqual(web.tiersOf(g, 'Instagram', 'Review'), ['Micro 10k - 100k'], 'Instagram ล็อก Tier เดียวเหมือนเดิม');
    assert.deepEqual(web.tiersOf(g, 'TikTok', 'Review'), web.KOL_TIERS);
    const plain = groupOf(block('TikTok', ['Macro 100k - 1M', 'Nano 1k - 10k']));
    assert.deepEqual(web.tiersOf(plain, 'TikTok', 'Review'), ['Macro 100k - 1M', 'Nano 1k - 10k'], 'ลำดับตามที่ทีมตั้งเหมือนเดิม');
    assert.deepEqual(web.tiersOf({}, 'TikTok', 'Review'), []);
});

test('คละ Tier ไม่กระทบเป้าจำนวนคน (quotaOf) และนับเป็น Tier ที่ใส่แล้ว', () => {
    const b = block('TikTok', [web.MIXED_TIER], [{ content_type: 'Review' }, { content_type: 'Sale' }]);
    const g = groupOf(b);
    assert.equal(web.quotaOf(g, 'TikTok', 'Review'), 10);
    assert.equal(web.quotaOf(g, 'TikTok'), 20);
    assert.deepEqual(web.blockTierNames(b), [web.MIXED_TIER]);
    assert.ok(b.sets.every(s => s.tiers.every(t => t.tier)), 'ฟอร์มนับว่าเลือก Tier แล้ว (ไม่ขึ้นว่าขาด Tier)');
});
