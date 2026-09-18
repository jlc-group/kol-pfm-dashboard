const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Target แยกต่อสินค้า (ad_groups[].blocks[].product_targets) — ตรรกะล้วน ไม่มีฐานข้อมูล
const { resolveGroupTarget, productCodesIn, carryProductTargets } = require(path.join(__dirname, '../server/src/store/logic.js'));

let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

// กลุ่มที่ตั้ง Target ต่อสินค้าแล้ว: TikTok ขาย L3 (กันแดด) + L4 (ฝ้า) · Facebook ไม่ใช้ Target
const perProduct = () => ({
    platforms: ['TikTok', 'Facebook'],
    blocks: [
        { platform: 'TikTok', products: ['L3', 'L4'], target: ['sun-a', 'mel-a', 'mel-b'],
            product_targets: { L3: ['sun-a'], L4: ['mel-a', 'mel-b'] } },
        { platform: 'Facebook', products: ['L3'], target: [], product_targets: { L3: [] } }
    ]
});
// กลุ่มที่บันทึกก่อนมี Target ต่อสินค้า — มีแต่ Target รวม
const legacy = () => ({
    platforms: ['TikTok'],
    blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], target: ['sun-a', 'mel-a'] }]
});

test('productCodesIn matches whole codes only, in order, without duplicates', () => {
    const known = ['L1', 'L10', 'L3', 'BTA3-01'];
    assert.deepEqual(productCodesIn('L10', known), ['L10']);
    assert.deepEqual(productCodesIn('L1', known), ['L1']);
    assert.deepEqual(productCodesIn('L3, L1 - กันแดด ,L3', known), ['L3', 'L1']);
    assert.deepEqual(productCodesIn('BTA3-01', known), ['BTA3-01']);
    assert.deepEqual(productCodesIn('BTA3', known), []);
    assert.deepEqual(productCodesIn('', known), []);
    assert.deepEqual(productCodesIn(null, known), []);
});

test('clip product picks only that product\'s targets', () => {
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', 'L3'), ['sun-a']);
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', 'L4'), ['mel-a', 'mel-b']);
    // คลิปที่ขายหลายสินค้า = รวม Target ของสินค้าในคลิป (ไม่ซ้ำ)
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', 'L4,L3'), ['mel-a', 'mel-b', 'sun-a']);
});

test('unknown product, product outside the block, or no product falls back to the platform union', () => {
    const all = ['sun-a', 'mel-a', 'mel-b'];
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', null), all);
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', ''), all);
    assert.deepEqual(resolveGroupTarget(perProduct(), 'TikTok', 'S9'), all);
    // สินค้าในคลิปมีอยู่แต่ยังไม่ได้ตั้ง Target → ใช้ Target รวม ไม่ใช่ว่างเปล่า
    const g = perProduct();
    g.blocks[0].product_targets.L3 = [];
    assert.deepEqual(resolveGroupTarget(g, 'TikTok', 'L3'), all);
});

test('platforms without targets and legacy groups keep their old results', () => {
    assert.equal(resolveGroupTarget(perProduct(), 'Facebook', 'L3'), null);
    assert.deepEqual(resolveGroupTarget(legacy(), 'TikTok', 'L3'), ['sun-a', 'mel-a']);
    assert.equal(resolveGroupTarget({ platform: 'TikTok', target: 'old' }, 'TikTok', 'L3'), 'old');
    assert.equal(resolveGroupTarget(null, 'TikTok', 'L3'), null);
    // product_targets ผิดรูป (array) ต้องไม่ทำให้พัง — ใช้ Target รวม
    const bad = legacy();
    bad.blocks[0].product_targets = ['sun-a'];
    assert.deepEqual(resolveGroupTarget(bad, 'TikTok', 'L3'), ['sun-a', 'mel-a']);
});

test('the web page resolves targets exactly like the server', () => {
    const cases = [
        [perProduct(), 'TikTok', 'L3'], [perProduct(), 'TikTok', 'L4'], [perProduct(), 'TikTok', 'L3,L4'],
        [perProduct(), 'TikTok', 'S9'], [perProduct(), 'TikTok', undefined], [legacy(), 'TikTok', 'L4']
    ];
    for (const [g, p, prod] of cases) {
        assert.deepEqual(web.targetFor(g, p, prod), resolveGroupTarget(g, p, prod) || [], `${p} ${prod}`);
        assert.deepEqual(web.productCodesIn(prod, ['L3', 'L4']), productCodesIn(prod, ['L3', 'L4']));
    }
    assert.deepEqual(web.targetFor(perProduct(), 'Facebook', 'L3'), []);
});

test('toBlocks keeps product_targets and marks older blocks as not split yet', () => {
    const [b] = web.toBlocks(perProduct(), 'TikTok');
    assert.deepEqual(b.product_targets, { L3: ['sun-a'], L4: ['mel-a', 'mel-b'] });
    assert.equal(web.toBlocks(legacy(), 'TikTok')[0].product_targets, null);
    assert.deepEqual(web.emptyBlock('TikTok').product_targets, {});
});

test('legacy union target is split per product by each product\'s own options', () => {
    // L3 = กันแดด, L4 = ฝ้า (TARGET_MAP ใน client/src/data/products.js)
    const sun = web.withProductTargets({ platform: 'TikTok', products: ['L3'], target: [] });
    assert.deepEqual(sun.product_targets, { L3: [] });
    return import(pathToFileURL(path.join(__dirname, '../client/src/data/products.js')).href).then(({ targetsForProduct }) => {
        const [s1] = targetsForProduct('L3');
        const [m1, m2] = targetsForProduct('L4');
        const b = web.withProductTargets({ platform: 'TikTok', products: ['L3', 'L4'], target: [s1, m2, 'ไม่มีในรายการ'] });
        assert.deepEqual(b.product_targets, { L3: [s1], L4: [m2] });
        assert.deepEqual(b.legacy_orphans, ['ไม่มีในรายการ']);
        assert.ok(!b.product_targets.L4.includes(m1));
        // บันทึกแบบใหม่แล้ว = เชื่อค่าที่บันทึก ไม่แบ่งซ้ำ และไม่มีคำเตือน
        const saved = web.withProductTargets({ platform: 'TikTok', products: ['L3', 'L4'], target: [s1, m1], product_targets: { L3: [], L4: [m1] } });
        assert.deepEqual(saved.product_targets, { L3: [], L4: [m1] });
        assert.deepEqual(saved.legacy_orphans, []);
    });
});

test('saving keeps only products still in the block and rebuilds the union target', () => {
    const packed = web.packProductTargets({
        platform: 'TikTok', products: ['L4', 'L3'], target: ['stale'], legacy_orphans: ['x'],
        product_targets: { L3: ['sun-a'], L4: ['mel-a', 'sun-a'], L9: ['gone'] }
    });
    assert.deepEqual(packed.product_targets, { L4: ['mel-a', 'sun-a'], L3: ['sun-a'] });
    assert.deepEqual(packed.target, ['mel-a', 'sun-a']);
    assert.ok(!('legacy_orphans' in packed));
    const fb = web.packProductTargets({ platform: 'Facebook', products: ['L3'], target: ['x'], product_targets: { L3: ['x'] } });
    assert.deepEqual(fb.product_targets, { L3: [] });
    assert.deepEqual(fb.target, []);
});

// ฟอร์มรุ่นเก่า (แท็บที่เปิดค้างจากก่อน deploy) ส่ง ad_groups มาโดยไม่มี product_targets
const stale = (over = {}) => ([{ key: 'g1', blocks: [
    { platform: 'TikTok', products: ['L3', 'L4'], target: ['mel-b', 'sun-a', 'mel-a'], ...over },
    { platform: 'Facebook', products: ['L3'], target: [] }
] }]);
const storedGroups = () => [{ key: 'g1', ...perProduct() }];

test('a stale form that did not touch Targets keeps the saved per-product Targets', () => {
    const [g] = carryProductTargets(stale(), storedGroups());
    assert.deepEqual(g.blocks[0].product_targets, { L3: ['sun-a'], L4: ['mel-a', 'mel-b'] });
    assert.equal(g.blocks[1].product_targets, undefined);
    // สินค้าที่ถูกเอาออกในแท็บเก่าไม่ติดมา · สินค้าใหม่ไม่มีค่า (หน้าอื่นใช้ Target รวม / ฟอร์มใหม่ให้เลือก)
    const [g2] = carryProductTargets(stale({ products: ['L4', 'L9'] }), storedGroups());
    assert.deepEqual(g2.blocks[0].product_targets, { L4: ['mel-a', 'mel-b'] });
});

test('carry-over steps aside when Targets changed, the new form sent its own, or nothing matches', () => {
    // Target รวมเปลี่ยน = แก้ Target จริงในแท็บเก่า
    assert.equal(carryProductTargets(stale({ target: ['sun-a'] }), storedGroups())[0].blocks[0].product_targets, undefined);
    // ฟอร์มรุ่นใหม่ส่ง product_targets มาเอง = ใช้ของที่ส่งมา
    const mine = { L3: [], L4: ['mel-a'] };
    assert.deepEqual(carryProductTargets(stale({ product_targets: mine }), storedGroups())[0].blocks[0].product_targets, mine);
    // กลุ่มใหม่ / ในฐานยังเป็นแบบเก่า / ข้อมูลผิดรูป = ไม่แตะ
    assert.equal(carryProductTargets([{ key: 'new', blocks: stale()[0].blocks }], storedGroups())[0].blocks[0].product_targets, undefined);
    assert.equal(carryProductTargets(stale(), [{ key: 'g1', ...legacy() }])[0].blocks[0].product_targets, undefined);
    assert.equal(carryProductTargets(null, storedGroups()), null);
    assert.deepEqual(carryProductTargets(stale(), null), stale());
});
