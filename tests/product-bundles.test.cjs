const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ชุดสินค้า (bundles) ต่อ Platform — สินค้าที่ KOL 1 คนรีวิวรวมในคลิปเดียว (เช่น L8A + L8B)
// ชุด = 1 แถว: งบ / จำนวนคน / Concept เก็บที่หัวชุด (รหัสแรก) ตัวเดียว · Target เก็บต่อสินค้า (ทุกรหัสได้ชุดเดียวกัน)
// ตรรกะล้วน ไม่มีฐานข้อมูล
const logic = require(path.join(__dirname, '../server/src/store/logic.js'));
const { carryProductBundles, carryProductKols, carryProductBudgets, carryProductConcepts, carryProductTargets } = logic;

let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

// TikTok 6 คน: L3 3 · L8A 2 · L8B 1 · ยังไม่มีชุด
const tiers = (...n) => n.map(k => ({ tier: 'Nano 1k - 10k', kols: String(k) }));
const blk = (over = {}) => ({
    platform: 'TikTok', products: ['L3', 'L8A', 'L8B'],
    budget_mode: 'split', budget: '17000', product_budgets: { L3: '10000', L8A: '5000', L8B: '2000' },
    kol_split: true, product_kols: { L3: '3', L8A: '2', L8B: '1' },
    concept_split: true, product_concepts: { L8A: 'ผิวฉ่ำ', L8B: 'ผิวฉ่ำ\nติดทน' },
    product_targets: { L3: ['T1'], L8A: ['M1'], L8B: ['M2'] },
    bundles: [],
    sets: [{ content_type: 'Review', tiers: tiers(6) }], ...over
});
// บล็อกที่รวม L8A + L8B แล้ว (หน้าตาที่ฟอร์มบันทึก)
const bundled = (over = {}) => blk({
    bundles: [['L8A', 'L8B']], budget: '17000',
    product_budgets: { L3: 10000, L8A: 7000 }, product_kols: { L3: 3, L8A: 3 },
    product_concepts: { L8A: 'ผิวฉ่ำ\nติดทน' },
    product_targets: { L3: ['T1'], L8A: ['M1', 'M2'], L8B: ['M1', 'M2'] }, ...over
});

test('bundles: normalised to codes still in the block, each code in one bundle, at least 2 codes', () => {
    const b = blk({ products: ['L3', 'L8A', 'L8B', 'L10'], bundles: [['L8A', 'X9', 'L8B'], ['L8B', 'L10'], ['L3'], 'L10', null] });
    assert.deepEqual(web.blockBundles(b), [['L8A', 'L8B']], 'X9 ไม่อยู่ในบล็อก · L8B อยู่ชุดแรกแล้ว → ชุดที่สองเหลือรหัสเดียว = ไม่นับ');
    assert.deepEqual(web.blockBundles({ products: ['L3'] }), [], 'ข้อมูลเก่าไม่มี bundles');
    assert.deepEqual(web.blockBundles(null), []);
    assert.deepEqual(web.productRows(blk({ products: ['L3', 'L8A', 'L8B', 'L10'], bundles: [['L8B', 'L10']] })).map(r => [r.head, r.label, r.bundle]),
        [['L3', 'L3', false], ['L8A', 'L8A', false], ['L8B', 'L8B + L10', true]]);
    assert.equal(web.rowHeadOf(bundled(), 'L8B'), 'L8A');
    assert.equal(web.rowHeadOf(bundled(), 'L3'), 'L3');
    // ไม่มีชุด = 1 สินค้า 1 แถวเหมือนเดิม
    assert.deepEqual(web.productRows(blk()).map(r => r.label), ['L3', 'L8A', 'L8B']);
});

test('make bundle: one row, values summed under the head, concepts merged, targets unioned for every code', () => {
    const m = web.makeBundle(blk(), ['L8B', 'L8A']);
    assert.deepEqual(m.bundles, [['L8A', 'L8B']], 'เรียงตามลำดับสินค้าในบล็อก → หัวชุด = L8A');
    assert.deepEqual(m.product_budgets, { L3: '10000', L8A: '7000' });
    assert.deepEqual(m.product_kols, { L3: '3', L8A: '3' });
    assert.deepEqual(m.product_concepts, { L8A: 'ผิวฉ่ำ\nติดทน' }, 'Concept ไม่ซ้ำ ต่อบรรทัด');
    assert.deepEqual(m.product_targets, { L3: ['T1'], L8A: ['M1', 'M2'], L8B: ['M1', 'M2'] });
    assert.equal(m.budget, '17000', 'งบรวมของ Platform เท่าเดิม');
    assert.deepEqual(web.productRows(m).map(r => r.label), ['L3', 'L8A + L8B']);
    // ติ๊กแถวเดียว = ไม่รวม
    const one = blk();
    assert.equal(web.makeBundle(one, ['L8A']), one);
    // ติ๊กแถวชุดที่มีอยู่ + อีกสินค้า = ชุดใหญ่ชุดเดียว (ค่ารวมกัน)
    const big = web.makeBundle(m, ['L8B', 'L3']);
    assert.deepEqual(big.bundles, [['L3', 'L8A', 'L8B']]);
    assert.deepEqual([big.product_budgets, big.product_kols], [{ L3: '17000' }, { L3: '6' }]);
    assert.deepEqual(big.product_targets.L8B, ['T1', 'M1', 'M2']);
    // ยังไม่ได้ใส่อะไร = ไม่มีค่าค้าง
    const empty = web.makeBundle(blk({ product_budgets: {}, product_kols: {}, product_concepts: {}, budget: '' }), ['L8A', 'L8B']);
    assert.deepEqual([empty.product_budgets, empty.product_kols, empty.product_concepts, empty.budget], [{}, {}, {}, '']);
});

test('split bundle: the head keeps the values, other codes start empty, targets stay', () => {
    const s = web.splitBundle(bundled(), 'L8A');
    assert.deepEqual(s.bundles, []);
    assert.deepEqual([s.product_budgets, s.product_kols], [{ L3: 10000, L8A: 7000 }, { L3: 3, L8A: 3 }]);
    assert.deepEqual(s.product_targets.L8B, ['M1', 'M2']);
    assert.equal(web.productBudgetSum(s), 17000, 'ยอดรวมไม่เปลี่ยน');
    const st = web.kolSplitState(s);
    assert.deepEqual([st.missing, st.sum, st.total, st.ok], [['L8B'], 6, 6, false], 'L8B ต้องใส่จำนวนเอง');
});

test('removing a product leaves its bundle; removing the head moves the bundle values to the next code', () => {
    const three = web.makeBundle(blk({ products: ['L3', 'L8A', 'L8B', 'L10'] }), ['L8A', 'L8B', 'L10']);
    assert.deepEqual(three.bundles, [['L8A', 'L8B', 'L10']]);
    const noHead = web.dropFromBundle(three, 'L8A');
    assert.deepEqual(noHead.bundles, [['L8B', 'L10']]);
    assert.deepEqual([noHead.product_budgets, noHead.product_kols, noHead.product_concepts], [{ L3: '10000', L8B: '7000' }, { L3: '3', L8B: '3' }, { L8B: 'ผิวฉ่ำ\nติดทน' }]);
    const noTail = web.dropFromBundle(three, 'L10');
    assert.deepEqual([noTail.bundles, noTail.product_kols], [[['L8A', 'L8B']], three.product_kols]);
    // ชุด 2 รหัสเหลือรหัสเดียว = แถวปกติ และได้ค่าของชุดไป · เรียกหลังเอาออกจาก products แล้วก็ได้
    const two = bundled();
    const after = web.dropFromBundle({ ...two, products: ['L3', 'L8B'] }, 'L8A');
    assert.deepEqual([after.bundles, after.product_kols, after.product_budgets], [[], { L3: 3, L8B: 3 }, { L3: 10000, L8B: 7000 }]);
    assert.deepEqual(web.productRows(after).map(r => r.label), ['L3', 'L8B']);
    // ไม่อยู่ในชุด = ไม่แตะอะไร
    assert.equal(web.dropFromBundle(two, 'L3'), two);
});

test('sums and validation count a bundle as one row (no missing warning for the non-head code, no double count)', () => {
    const b = bundled();
    assert.equal(web.productBudgetSum(b), 17000);
    assert.equal(web.productKolSum(b), 6);
    assert.deepEqual(web.kolSplitState(b), { total: 6, sum: 6, missing: [], count: 2, filled: 2, ok: true });
    assert.equal(web.kolSplitProblem(b), null);
    const short = bundled({ product_kols: { L3: 3 } });
    assert.equal(web.kolSplitProblem(short), 'จำนวน KOL ต่อสินค้า (TikTok) ยังไม่ใส่จำนวนของ L8A + L8B (อย่างน้อย 1 คน) · รวมได้ 3 / 6 คน — ขาด 3 คน');
    // ค่าที่ค้างที่รหัสท้ายชุด (ไม่ควรมี) ไม่ถูกนับซ้ำ
    assert.equal(web.productKolSum(bundled({ product_kols: { L3: 3, L8A: 3, L8B: 9 } })), 6);
});

test('pack: bundles always written, budgets / counts / concepts under the head only, targets shared', () => {
    const raw = bundled({ bundles: [['L8A', 'L8B'], ['X1', 'L3']], product_kols: { L3: '3', L8A: '3', L8B: '9' }, product_budgets: { L3: '10000', L8A: '7000', L8B: '1' },
        product_concepts: { L8A: 'ผิวฉ่ำ', L8B: 'ค้าง' }, product_targets: { L3: ['T1'], L8A: ['M1'], L8B: ['M2'] } });
    const p = web.packCampaigns(web.packProductTargets(web.packBudgets(web.packConcepts(web.packKols(web.packBundles(raw))))));
    assert.deepEqual(p.bundles, [['L8A', 'L8B']]);
    assert.deepEqual(p.product_budgets, { L3: 10000, L8A: 7000 });
    assert.equal(p.budget, '17000');
    assert.deepEqual(p.product_kols, { L3: 3, L8A: 3 });
    assert.deepEqual(p.product_concepts, { L8A: 'ผิวฉ่ำ' });
    assert.deepEqual(p.product_targets, { L3: ['T1'], L8A: ['M1', 'M2'], L8B: ['M1', 'M2'] });
    assert.deepEqual([...p.target].sort(), ['M1', 'M2', 'T1']);
    assert.deepEqual(web.packBundles(blk({ bundles: undefined })).bundles, [], 'ไม่มีชุด = อาเรย์ว่าง (server ใช้แยกแท็บเก่า)');
    // Target ของคลิปที่ช่องสินค้ามีรหัสท้ายชุด = Target ของชุด (อ่านต่อสินค้าเหมือนเดิม)
    const g = { blocks: [p] };
    assert.deepEqual(web.targetFor(g, 'TikTok', 'L8B'), ['M1', 'M2']);
    assert.deepEqual(logic.resolveGroupTarget(g, 'TikTok', 'L8B'), ['M1', 'M2']);
});

test('toBlocks keeps bundles; old data without bundles reads as no bundles', () => {
    const g = { key: 'g1', platforms: ['TikTok'], blocks: [bundled()] };
    assert.deepEqual(web.toBlocks(g, 'TikTok')[0].bundles, [['L8A', 'L8B']]);
    const old = { key: 'g1', platforms: ['TikTok'], blocks: [{ ...blk(), bundles: undefined }] };
    assert.deepEqual(web.toBlocks(old, 'TikTok')[0].bundles, []);
    assert.deepEqual(web.emptyBlock('TikTok').bundles, []);
});

test('concept display: every code of a bundle shows the bundle concept', () => {
    const g = { concept: 'หลัก', blocks: [bundled()] };
    const rows = web.conceptRows(g);
    assert.deepEqual(rows.map(r => [r.concept, r.items.map(i => i.label), r.main]), [['หลัก', ['L3'], true], ['ผิวฉ่ำ\nติดทน', ['L8A', 'L8B'], false]]);
    // หน้าเอเจนซี่ที่เห็นแค่ L8B ก็ได้ Concept ของชุด
    assert.equal(web.conceptText(g, false, ['L8B']), 'L8B = ผิวฉ่ำ / ติดทน');
    // ไม่มีชุด = เหมือนเดิม (L8B ไม่มี Concept ของตัวเอง → Concept หลัก)
    const plain = { concept: 'หลัก', blocks: [blk({ product_concepts: { L8A: 'ผิวฉ่ำ' } })] };
    assert.deepEqual(web.conceptRows(plain).map(r => r.items.map(i => i.label)), [['L3', 'L8B'], ['L8A']]);
});

test('progress: a bundle is one entry, a person counts once if their product has any code of the bundle', () => {
    const g = { key: 'g1', blocks: [bundled({ products: ['L3', 'L8A', 'L8B', 'L10'], product_kols: { L3: 3, L8A: 2, L10: 1 } })] };
    let id = 0;
    const sub = (person, product, over = {}) => ({ id: ++id, group_key: 'g1', platform: 'TikTok', person_key: person, product, status: 'submitted', ...over });
    const subs = [
        sub('p1', 'L8A'),
        sub('p1', 'L8B', { clip_no: 2 }),          // คนเดิมอีกคลิป = ยัง 1 คน
        sub('p2', 'L8A, L8B'),                      // 2 รหัสของชุดเดียวกัน = นับชุดนั้นครั้งเดียว
        sub('p3', 'L8B - อีอีคูชั่นแตงโม เบอร์ 02, L3'), // นับทั้ง L3 และชุด
        sub('p4', 'L8B', { status: 'rejected' }),   // ไม่ถูกเลือก = ไม่นับ
        sub('p5', 'L10')
    ];
    const out = web.productKolProgress(g, subs);
    assert.deepEqual(out[0].rows.map(r => [r.code, r.need, r.sent, r.over, r.full]), [
        ['L3', 3, 1, false, false],
        ['L8A + L8B', 2, 3, true, false],
        ['L10', 1, 1, false, true]
    ]);
    assert.deepEqual(out[0].rows[1].codes, ['L8A', 'L8B']);
    // ไม่มีชุด = เหมือนเดิม
    const plain = web.productKolProgress({ key: 'g1', blocks: [blk()] }, subs);
    assert.deepEqual(plain[0].rows.map(r => [r.code, r.sent]), [['L3', 1], ['L8A', 2], ['L8B', 3]]);
});

test('server blockBundles matches the web helper', () => {
    const cases = [
        blk({ products: ['L3', 'L8A', 'L8B', 'L10'], bundles: [['L8A', 'X9', 'L8B'], ['L8B', 'L10'], ['L3'], 'L10', null] }),
        bundled(), blk(), { products: ['A', 'B', 'C'], bundles: [['C', 'A'], ['B']] }, { products: ['A'] }
    ];
    cases.forEach(b => assert.deepEqual(logic.blockBundles(b), web.blockBundles(b)));
});

// ---------- แท็บเก่าที่เปิดค้างจากก่อน deploy (ไม่รู้จัก bundles) ----------
const stored = () => [{ key: 'g1', concept: 'หลัก', blocks: [bundled()] }];
const oldTabBlock = (over = {}) => {
    const b = bundled(over);
    delete b.bundles;
    return b;
};

test('carry bundles: old tab with the same products keeps the stored bundles', () => {
    const out = carryProductBundles([{ key: 'g1', blocks: [oldTabBlock({ product_budgets: { L3: 10000, L8A: 7000, L8B: 0 } })] }], stored());
    assert.deepEqual(out[0].blocks[0].bundles, [['L8A', 'L8B']], 'งบ 0 ของรหัสท้ายชุด (ฟอร์มเก่าเขียน 0 ให้) ไม่นับว่าแยกค่า');
    // ส่ง bundles มา (ฟอร์มรุ่นใหม่ — รวมว่าง = ผู้ใช้แยกชุดเอง) = ใช้ตามที่ส่ง
    const fresh = carryProductBundles([{ key: 'g1', blocks: [bundled({ bundles: [] })] }], stored());
    assert.deepEqual(fresh[0].blocks[0].bundles, []);
    // สินค้าเปลี่ยน = ไม่ยก
    const changed = carryProductBundles([{ key: 'g1', blocks: [oldTabBlock({ products: ['L3', 'L8A', 'L8B', 'L10'] })] }], stored());
    assert.equal(changed[0].blocks[0].bundles, undefined);
    // แท็บเก่าใส่จำนวนให้รหัสท้ายชุดแยก (ใช้ค่าแยกต่อสินค้า) = ไม่ยกชุด
    const split = carryProductBundles([{ key: 'g1', blocks: [oldTabBlock({ product_kols: { L3: 3, L8A: 2, L8B: 1 } })] }], stored());
    assert.equal(split[0].blocks[0].bundles, undefined);
    // ไม่มีของเดิม / กลุ่มใหม่ = ไม่แตะ
    const none = [{ key: 'g9', blocks: [oldTabBlock()] }];
    assert.equal(carryProductBundles(none, stored())[0], none[0]);
});

test('carry chain: a pre-split old tab keeps budgets, counts and concepts of a bundle under its head', () => {
    // แท็บเก่ามาก: ไม่รู้จัก budget_mode / kol_split / concept_split / bundles
    const b = bundled();
    ['bundles', 'budget_mode', 'product_budgets', 'kol_split', 'product_kols', 'concept_split', 'product_concepts'].forEach(k => delete b[k]);
    const incoming = [{ key: 'g1', concept: 'หลัก', blocks: [b] }];
    const st = stored();
    const out = carryProductKols(carryProductConcepts(carryProductBudgets(carryProductTargets(carryProductBundles(incoming, st), st), st), st), st);
    const ob = out[0].blocks[0];
    assert.deepEqual(ob.bundles, [['L8A', 'L8B']]);
    assert.deepEqual([ob.budget_mode, ob.product_budgets], ['split', { L3: 10000, L8A: 7000 }]);
    assert.deepEqual([ob.kol_split, ob.product_kols], [true, { L3: 3, L8A: 3 }]);
    assert.deepEqual([ob.concept_split, ob.product_concepts], [true, { L8A: 'ผิวฉ่ำ\nติดทน' }]);
    // ไม่มีชุดในฐาน (ข้อมูลก่อนมีชุด) = ยกแบบเดิมทุกสินค้า
    const plainStored = [{ key: 'g1', concept: 'หลัก', blocks: [blk({ product_kols: { L3: 3, L8A: 2, L8B: 1 } })] }];
    const pb = blk();
    ['bundles', 'kol_split', 'product_kols'].forEach(k => delete pb[k]);
    const plainOut = carryProductKols(carryProductBundles([{ key: 'g1', blocks: [pb] }], plainStored), plainStored);
    assert.deepEqual(plainOut[0].blocks[0].product_kols, { L3: 3, L8A: 2, L8B: 1 });
    assert.equal(plainOut[0].blocks[0].bundles, undefined);
});
