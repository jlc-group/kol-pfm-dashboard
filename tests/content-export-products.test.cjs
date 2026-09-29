const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

// Stub the pg layer so listCandidates runs without a database.
const basePath = require.resolve(path.join(__dirname, '../server/src/store/pg/_base.js'));
let rows = [];
require.cache[basePath] = { id: basePath, filename: basePath, loaded: true, exports: { query: async () => ({ rows }) } };
const { contentExport } = require('../server/src/store/pg/contentExport');

const group = {
    key: 'g1',
    blocks: [{
        platform: 'TikTok',
        products: ['BTA4-00', 'BTA4-01'],
        target: ['F_Beauty-Make up_18-44'],
        product_targets: { 'BTA2-01': ['F_BLUSH_18_44'] }
    }]
};
const row = over => ({ submission_id: 1, id_post: '1', platform: 'TikTok', group_key: 'g1', ad_groups: [group], product: null, ...over });

// product กางเป็นทุกสีของสินค้านั้น (ระบบยิงแอดยิงครอบทุกสี) — ดู server/src/store/productFamilies.js
const ALL_BTA4 = 'BTA4-00, BTA4-01, BTA4-02, BTA4-03, BTA4-04, BTA4-05, BTA4-06, BTA4-07';

test('feed falls back to the group products and target', async () => {
    rows = [row()];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, ALL_BTA4);
    assert.deepEqual(item.target, ['F_Beauty-Make up_18-44']);
    assert.equal(item.ad_groups, undefined);
});

test('feed uses the clip product and its per-product target', async () => {
    rows = [row({ product: 'BTA2-01 บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)' })];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, 'BTA2-01, BTA2-02, BTA2-03');
    // Target ยังเลือกจากรหัสที่ KOL รีวิวจริง ไม่ใช่จากสีที่กางออก
    assert.deepEqual(item.target, ['F_BLUSH_18_44']);
});

test('feed sends every shade of the clip product family', async () => {
    rows = [row({ product: 'BTA4-01' })];
    let [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, ALL_BTA4);

    // สองสีในกลุ่มเดียวกัน = กางครั้งเดียว ไม่ซ้ำ
    rows = [row({ product: 'BTA1-03,BTA1-04' })];
    [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, 'BTA1-01, BTA1-02, BTA1-03, BTA1-04, BTA1-05, BTA1-06');

    // สินค้าที่ไม่มีหลายสีส่งตามเดิม
    rows = [row({ product: 'X9 สินค้าทดสอบ' })];
    [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, 'X9 สินค้าทดสอบ');

    // คั่นด้วย ， หรือช่องว่าง — รหัสตัวหลังต้องไม่หายไปจากฟีด
    for (const product of ['BTA4-01，BTA2-01', 'BTA4-01 BTA2-01']) {
        rows = [row({ product })];
        [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
        assert.equal(item.product, ALL_BTA4 + ', BTA2-01, BTA2-02, BTA2-03', product);
    }
});

test('feed without an ad group sends empty product/target', async () => {
    rows = [row({ group_key: null })];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, null);
    assert.deepEqual(item.target, []);
});
