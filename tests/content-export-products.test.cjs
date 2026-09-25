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

test('feed falls back to the group products and target', async () => {
    rows = [row()];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, 'BTA4-00, BTA4-01');
    assert.deepEqual(item.target, ['F_Beauty-Make up_18-44']);
    assert.equal(item.ad_groups, undefined);
});

test('feed uses the clip product and its per-product target', async () => {
    rows = [row({ product: 'BTA2-01 บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)' })];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, 'BTA2-01 บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)');
    assert.deepEqual(item.target, ['F_BLUSH_18_44']);
});

test('feed without an ad group sends empty product/target', async () => {
    rows = [row({ group_key: null })];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry' });
    assert.equal(item.product, null);
    assert.deepEqual(item.target, []);
});
