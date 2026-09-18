const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Concept แยกต่อสินค้า (ต่อ Platform): g.concept = หลัก · b.concept_split · b.product_concepts — ตรรกะล้วน ไม่มีฐานข้อมูล
const { carryProductConcepts } = require(path.join(__dirname, '../server/src/store/logic.js'));

let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

// TikTok แยก Concept (L3 มีของตัวเอง, L4 ว่าง) · Instagram ไม่แยก
const group = (over = {}, tiktok = {}, ig = {}) => ({
    key: 'g1', concept: 'กันแดดสู้แดดจัด',
    blocks: [
        { platform: 'TikTok', products: ['L3', 'L4'], concept_split: true, product_concepts: { L3: 'กันแดดไม่วอก', L4: '  ' }, ...tiktok },
        { platform: 'Instagram', products: ['L3', 'L10'], concept_split: false, ...ig }
    ],
    ...over
});

test('a group splits concepts when any platform does; the check can be limited to platforms', () => {
    assert.equal(web.isSplitConcept(group()), true);
    assert.equal(web.isSplitConcept(group(), ['Instagram']), false);
    assert.equal(web.isSplitConcept(group({}, { concept_split: false })), false);
    assert.equal(web.isBlockSplitConcept({ concept_split: 'yes' }), false);
});

test('rows group products by concept; a product with different concepts per platform is labelled with the platform', () => {
    assert.deepEqual(web.conceptRows(group()), [
        { concept: 'กันแดดไม่วอก', items: [{ code: 'L3', label: 'L3 · TikTok' }], main: false },
        { concept: 'กันแดดสู้แดดจัด', items: [{ code: 'L4', label: 'L4' }, { code: 'L3', label: 'L3 · Instagram' }, { code: 'L10', label: 'L10' }], main: true }
    ]);
    // Concept เดียวกันทุก Platform = ไม่ต้องกำกับ Platform
    const same = web.conceptRows(group({}, {}, { concept_split: true, product_concepts: { L3: 'กันแดดไม่วอก' } }));
    assert.deepEqual(same[0], { concept: 'กันแดดไม่วอก', items: [{ code: 'L3', label: 'L3' }], main: false });
    // จำกัดเฉพาะ Platform/สินค้าที่ลิงก์เอเจนซี่เห็น
    assert.deepEqual(web.conceptRows(group(), null, ['TikTok']).map(r => r.items.map(it => it.label)), [['L3'], ['L4']]);
    assert.deepEqual(web.conceptRows(group(), ['L10']), [{ concept: 'กันแดดสู้แดดจัด', items: [{ code: 'L10', label: 'L10' }], main: true }]);
    // Concept หลักว่าง + L3 มี Concept แค่ TikTok → ต้องกำกับ Platform (Instagram ของ L3 ยังไม่มี Concept)
    const noMain = web.conceptRows(group({ concept: '' }));
    assert.deepEqual(noMain, [{ concept: 'กันแดดไม่วอก', items: [{ code: 'L3', label: 'L3 · TikTok' }], main: false }]);
    assert.equal(web.conceptText(group({ concept: '' })), 'L3 · TikTok = กันแดดไม่วอก');
    // เปิดแยกแต่ยังไม่ได้ใส่ของใครเลย = ไม่นับว่ามี Concept ต่อสินค้า (แสดงแบบ Concept เดียว)
    assert.equal(web.hasOwnConcepts(group()), true);
    assert.equal(web.hasOwnConcepts(group({}, { product_concepts: {} })), false);
    assert.equal(web.hasOwnConcepts(group(), null, ['Instagram']), false);
    // ไม่มี Concept หลักและสินค้าไม่ได้ใส่ = ไม่มีแถว
    assert.deepEqual(web.conceptRows(group({ concept: '' }, { product_concepts: {} })), []);
});

test('the one-line text lists own concepts, folds the rest into "สินค้าอื่น", and non-split groups stay as before', () => {
    assert.equal(web.conceptText(group()), 'L3 · TikTok = กันแดดไม่วอก · สินค้าอื่น = กันแดดสู้แดดจัด');
    assert.equal(web.conceptText(group(), true), 'L3 · TikTok = กันแดดไม่วอก · L4, L3 · Instagram, L10 = กันแดดสู้แดดจัด (Concept หลัก)');
    assert.equal(web.conceptText(group({}, { concept_split: false })), 'กันแดดสู้แดดจัด');
    assert.equal(web.conceptText(group({}, { product_concepts: {} })), 'กันแดดสู้แดดจัด');
    assert.equal(web.conceptText({ concept: null }), '');
    // หน้าเอเจนซี่: เห็นแค่ Instagram (ไม่ได้แยก) = Concept หลักอย่างเดียว ไม่เห็น Concept ของ TikTok
    assert.equal(web.conceptText(group(), false, ['L3', 'L10'], ['Instagram']), 'กันแดดสู้แดดจัด');
    assert.equal(web.conceptText(group(), false, ['L3', 'L4'], ['TikTok']), 'L3 = กันแดดไม่วอก · สินค้าอื่น = กันแดดสู้แดดจัด');
    const many = group({}, { products: ['L3', 'L4', 'L10', 'L11'], product_concepts: { L3: 'x', L4: 'x', L10: 'x', L11: 'x' } }, { products: [] });
    assert.equal(web.conceptText(many), 'L3, L4, L10 +1 = x');
});

test('saving a block keeps only filled concepts of products still there and always states the mode', () => {
    const packed = web.packConcepts({ platform: 'TikTok', products: ['L3', 'L4'], concept_split: true, product_concepts: { L3: ' กันแดด ', L4: '', L9: 'gone' } });
    assert.equal(packed.concept_split, true);
    assert.deepEqual(packed.product_concepts, { L3: 'กันแดด' });
    const off = web.packConcepts({ platform: 'TikTok', products: ['L3'], concept_split: false, product_concepts: { L3: 'x' } });
    assert.equal(off.concept_split, false);
    assert.ok(!('product_concepts' in off));
    assert.deepEqual(web.packConcepts({ products: ['L3'], concept_split: true, product_concepts: null }).product_concepts, {});
});

test('toBlocks and new blocks carry the per-platform concept fields', () => {
    const [b] = web.toBlocks(group(), 'TikTok');
    assert.equal(b.concept_split, true);
    assert.deepEqual(b.product_concepts, { L3: 'กันแดดไม่วอก', L4: '  ' });
    const [old] = web.toBlocks({ platforms: ['TikTok'], blocks: [{ platform: 'TikTok', products: ['L3'] }] }, 'TikTok');
    assert.equal(old.concept_split, false);
    assert.deepEqual(old.product_concepts, {});
    assert.equal(web.emptyBlock('TikTok').concept_split, false);
});

// ---------- server: แท็บที่เปิดค้างจากก่อน deploy ----------
const stored = () => [group({}, { product_concepts: { L3: 'กันแดดไม่วอก', L4: 'ฝ้าจาง' } })];
const stale = (over = {}, tiktok = {}) => [{ key: 'g1', concept: 'กันแดดสู้แดดจัด',
    blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], ...tiktok }, { platform: 'Instagram', products: ['L3', 'L10'] }], ...over }];

test('a stale form that kept the main concept keeps the per-product concepts of each platform', () => {
    const [g] = carryProductConcepts(stale(), stored());
    assert.equal(g.blocks[0].concept_split, true);
    assert.deepEqual(g.blocks[0].product_concepts, { L3: 'กันแดดไม่วอก', L4: 'ฝ้าจาง' });
    // Instagram ในฐานไม่ได้แยก = ไม่แตะ
    assert.equal(g.blocks[1].concept_split, undefined);
    // เอา L4 ออกในแท็บเก่า → ไม่ยก Concept ของ L4 มา
    assert.deepEqual(carryProductConcepts(stale({}, { products: ['L3'] }), stored())[0].blocks[0].product_concepts, { L3: 'กันแดดไม่วอก' });
});

test('carry-over steps aside when the main concept changed or the new form sent a mode', () => {
    assert.equal(carryProductConcepts(stale({ concept: 'Concept ใหม่' }), stored())[0].blocks[0].concept_split, undefined);
    const mine = carryProductConcepts(stale({}, { concept_split: false }), stored())[0].blocks[0];
    assert.equal(mine.concept_split, false);
    assert.equal(mine.product_concepts, undefined);
    assert.equal(carryProductConcepts([{ ...stale()[0], key: 'new' }], stored())[0].blocks[0].concept_split, undefined);
    assert.equal(carryProductConcepts(null, stored()), null);
    assert.deepEqual(carryProductConcepts(stale(), null), stale());
});
