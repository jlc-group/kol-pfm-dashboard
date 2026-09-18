const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ตัวกรองรายชื่อตามสินค้า (แท็บรายชื่อ KOL / On Process ฝั่งทีมและเอเจนซี่) — ตรรกะล้วน ไม่มีฐานข้อมูล
let pf;
before(async () => {
    pf = await import(pathToFileURL(path.join(__dirname, '../client/src/data/productFilter.js')).href);
});

const groups = [
    { key: 'g1', products: ['L3', 'L4'], blocks: [{ platform: 'TikTok', products: ['L3', 'L4'] }, { platform: 'Instagram', products: ['L10'] }] },
    { key: 'g2', products: ['L1'] }
];
const subs = [
    { id: 1, person_key: 'p1', product: 'L3' },
    { id: 2, person_key: 'p1', product: 'L4' },           // คนเดียวกันอีกคลิป
    { id: 3, person_key: 'p2', product: 'L3,L10' },
    { id: 4, person_key: 'p3', product: 'L10 - กันแดด 3D' },
    { id: 5, person_key: 'p4', product: '' },
    { id: 6, person_key: 'p5', product: 'X9' }            // สินค้านอกกลุ่ม
];
const people = list => new Set(list.map(s => s.person_key)).size;

test('known codes follow the campaign order, then codes found only on submissions', () => {
    assert.deepEqual(pf.knownProductCodes(groups, subs), ['L3', 'L4', 'L10', 'L1', 'X9']);
    assert.deepEqual(pf.knownProductCodes(null, null), []);
});

test('a row passes when it has any selected product; L1 never matches L10', () => {
    const known = pf.knownProductCodes(groups, subs);
    const pick = sel => subs.filter(s => pf.matchProducts(s, sel, known)).map(s => s.id);
    assert.deepEqual(pick([]), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(pick(['L3']), [1, 3]);
    assert.deepEqual(pick(['L10', 'L4']), [2, 3, 4]);
    assert.deepEqual(pick(['L1']), []);
    assert.deepEqual(pick([pf.NO_PRODUCT]), [5]);
    assert.deepEqual(pick(['X9', pf.NO_PRODUCT]), [5, 6]);
});

test('options list only products that appear, with counts (people or rows), plus "no product"', () => {
    const known = pf.knownProductCodes(groups, subs);
    assert.deepEqual(pf.productFilterOptions(subs, known, people), [
        { code: 'L3', count: 2 }, { code: 'L4', count: 1 }, { code: 'L10', count: 2 }, { code: 'X9', count: 1 },
        { code: pf.NO_PRODUCT, count: 1 }
    ]);
    // นับเป็นแถว (On Process) = ค่าเริ่มต้น
    assert.equal(pf.productFilterOptions(subs, known).find(o => o.code === 'L3').count, 2);
    assert.deepEqual(pf.productFilterOptions([], known), []);
});
