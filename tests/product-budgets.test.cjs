const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// งบของ Platform: ก้อนเดียว ('total') หรือแยกต่อสินค้า ('split' → product_budgets และ budget = ผลรวม) — ตรรกะล้วน ไม่มีฐานข้อมูล
const { carryProductBudgets } = require(path.join(__dirname, '../server/src/store/logic.js'));

let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

const splitBlock = (over = {}) => ({
    platform: 'TikTok', products: ['L3', 'L8A', 'L10'], budget: '600000', budget_mode: 'split',
    product_budgets: { L3: '300000', L8A: '200000', L10: '100000' }, sets: [], ...over
});

test('split budget: block budget is the sum of the products still in the block', () => {
    assert.equal(web.isSplitBudget(splitBlock()), true);
    assert.equal(web.isSplitBudget({ budget: '5' }), false);
    assert.equal(web.productBudgetSum(splitBlock()), 600000);
    // สินค้าที่ถูกเอาออกแล้วไม่นับ แม้ยังมีงบค้างใน product_budgets
    assert.equal(web.productBudgetSum(splitBlock({ products: ['L3', 'L8A'] })), 500000);
    assert.equal(web.productBudgetSum({ products: ['L3'], product_budgets: null }), 0);
});

test('saving a split block keeps only current products, stores numbers and rewrites budget as the sum', () => {
    const packed = web.packBudgets(splitBlock({ products: ['L8A', 'L3'], budget: '1', budget_before_split: '999',
        product_budgets: { L3: '300,000', L8A: '200000', L10: '100000' } }));
    assert.deepEqual(packed.product_budgets, { L8A: 200000, L3: 300000 });
    assert.equal(packed.budget, '500000');
    assert.equal(packed.budget_mode, 'split');
    assert.ok(!('budget_before_split' in packed));
    // ยังไม่ได้ใส่งบเลย = งบ Platform ว่าง (ฟอร์มจะไม่ให้บันทึกแบบนี้ในโหมดสร้าง)
    assert.equal(web.packBudgets(splitBlock({ product_budgets: {} })).budget, '');
});

test('saving a one-total block marks it total and drops any per-product numbers', () => {
    const packed = web.packBudgets({ platform: 'Facebook', products: ['L3'], budget: '800000', budget_mode: 'total',
        product_budgets: { L3: '1000' }, budget_before_split: '800000' });
    assert.equal(packed.budget_mode, 'total');
    assert.equal(packed.budget, '800000');
    assert.ok(!('product_budgets' in packed));
    assert.ok(!('budget_before_split' in packed));
    // ข้อมูลเก่าที่ไม่มี budget_mode = ก้อนเดียว
    assert.equal(web.packBudgets({ platform: 'TikTok', products: [], budget: '5' }).budget_mode, 'total');
});

test('toBlocks carries the budget mode; old blocks and new blocks are one-total', () => {
    const [b] = web.toBlocks({ platforms: ['TikTok'], blocks: [splitBlock()] }, 'TikTok');
    assert.equal(b.budget_mode, 'split');
    assert.deepEqual(b.product_budgets, splitBlock().product_budgets);
    const [old] = web.toBlocks({ platforms: ['TikTok'], blocks: [{ platform: 'TikTok', products: ['L3'], budget: '5' }] }, 'TikTok');
    assert.equal(old.budget_mode, 'total');
    assert.deepEqual(old.product_budgets, {});
    assert.equal(web.emptyBlock('TikTok').budget_mode, 'total');
    // งบกลุ่ม/งบ Platform ที่หน้าอื่นอ่าน = budget ของบล็อก (ผลรวม) เหมือนเดิม
    assert.equal(web.blocksBudget([web.packBudgets(splitBlock()), { budget: '800000' }]), 1400000);
});

// ---------- server: แท็บที่เปิดค้างจากก่อน deploy ----------
const stored = () => [{ key: 'g1', blocks: [splitBlock({ product_budgets: { L3: 300000, L8A: 200000, L10: 100000 } })] }];
const stale = (over = {}) => [{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3', 'L8A', 'L10'], budget: '600000', sets: [], ...over }] }];

test('a stale form that did not touch the budget keeps the per-product budgets', () => {
    const [g] = carryProductBudgets(stale(), stored());
    assert.equal(g.blocks[0].budget_mode, 'split');
    assert.deepEqual(g.blocks[0].product_budgets, { L3: 300000, L8A: 200000, L10: 100000 });
});

test('carry-over steps aside when the budget or products changed, or the new form sent a mode', () => {
    // แก้งบรวมในแท็บเก่า
    assert.equal(carryProductBudgets(stale({ budget: '700000' }), stored())[0].blocks[0].budget_mode, undefined);
    // เอาสินค้าออก → ผลรวมไม่เท่างบที่ส่งมา
    assert.equal(carryProductBudgets(stale({ products: ['L3', 'L8A'] }), stored())[0].blocks[0].budget_mode, undefined);
    // เพิ่มสินค้าที่ไม่มีงบเดิม
    assert.equal(carryProductBudgets(stale({ products: ['L3', 'L8A', 'L10', 'L4'] }), stored())[0].blocks[0].budget_mode, undefined);
    // ฟอร์มรุ่นใหม่เปลี่ยนเป็นก้อนเดียวเอง ห้ามยกงบแยกกลับมา
    const mine = carryProductBudgets(stale({ budget_mode: 'total' }), stored())[0].blocks[0];
    assert.equal(mine.budget_mode, 'total');
    assert.equal(mine.product_budgets, undefined);
    // ในฐานเป็นก้อนเดียว / กลุ่มใหม่ / ข้อมูลผิดรูป = ไม่แตะ
    assert.equal(carryProductBudgets(stale(), [{ key: 'g1', blocks: [{ platform: 'TikTok', budget: '600000' }] }])[0].blocks[0].budget_mode, undefined);
    assert.equal(carryProductBudgets([{ key: 'new', blocks: stale()[0].blocks }], stored())[0].blocks[0].budget_mode, undefined);
    assert.equal(carryProductBudgets(null, stored()), null);
    assert.deepEqual(carryProductBudgets(stale(), null), stale());
});
