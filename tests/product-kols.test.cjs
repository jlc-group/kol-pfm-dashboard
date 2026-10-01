const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// จำนวน KOL แยกต่อสินค้า (ต่อ Platform): kol_split + product_kols { รหัส: คน } — ผลรวมต้องเท่าจำนวนคนจากแถว Tier พอดี
// ตรรกะล้วน ไม่มีฐานข้อมูล
const { carryProductKols } = require(path.join(__dirname, '../server/src/store/logic.js'));

let web; // client/src/data/adGroups.js (ESM)
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

// TikTok 10 คน (Review 6 + Sale 4) แบ่ง L3 5 · L8A 3 · L10 2
const tiers = (...n) => n.map(k => ({ tier: 'Nano 1k - 10k', kols: String(k) }));
const kolBlock = (over = {}) => ({
    platform: 'TikTok', products: ['L3', 'L8A', 'L10'], kol_split: true,
    product_kols: { L3: '5', L8A: '3', L10: '2' },
    sets: [{ content_type: 'Review', tiers: tiers(4, 2) }, { content_type: 'Sale', tiers: tiers(4) }], ...over
});

test('kol split: sum counts only products still in the block and compares with the tier total', () => {
    assert.equal(web.isKolSplit(kolBlock()), true);
    assert.equal(web.isKolSplit({ kol_split: 'true' }), false);
    assert.equal(web.isKolSplit(null), false);
    assert.equal(web.productKolOf(kolBlock(), 'L8A'), 3);
    assert.equal(web.productKolOf(kolBlock(), 'X1'), 0);
    assert.equal(web.productKolOf({ product_kols: null }, 'L3'), 0);
    assert.equal(web.productKolSum(kolBlock()), 10);
    // สินค้าที่ถูกเอาออกแล้วไม่นับ แม้ยังมีตัวเลขค้างใน product_kols
    assert.equal(web.productKolSum(kolBlock({ products: ['L3', 'L8A'] })), 8);
    const st = web.kolSplitState(kolBlock());
    assert.deepEqual(st, { total: 10, sum: 10, missing: [], count: 3, filled: 3, ok: true });
    assert.equal(web.kolSplitState({ ...kolBlock(), kol_split: false }), null);
});

test('kol split problems say how many people are missing or over', () => {
    assert.equal(web.kolSplitProblem(kolBlock(), 'TikTok'), null);
    assert.equal(web.kolSplitProblem({ ...kolBlock(), kol_split: false }, 'TikTok'), null);
    // ขาด 2 คน
    assert.equal(web.kolSplitProblem(kolBlock({ product_kols: { L3: 3, L8A: 3, L10: 2 } }), 'TikTok'),
        'จำนวน KOL ต่อสินค้า (TikTok) รวมได้ 8 / 10 คน — ขาด 2 คน');
    // เกิน 3 คน · ใช้ชื่อกลุ่มที่ส่งมาในวงเล็บ
    assert.equal(web.kolSplitProblem(kolBlock({ product_kols: { L3: 8, L8A: 3, L10: 2 } }), 'กลุ่มที่ 2 · TikTok'),
        'จำนวน KOL ต่อสินค้า (กลุ่มที่ 2 · TikTok) รวมได้ 13 / 10 คน — เกิน 3 คน');
    // ยังไม่ใส่บางสินค้า (0 = ยังไม่ใส่) + ยอดยังไม่ครบ
    assert.equal(web.kolSplitProblem(kolBlock({ product_kols: { L3: 5, L8A: '0' } })),
        'จำนวน KOL ต่อสินค้า (TikTok) ยังไม่ใส่จำนวนของ L8A, L10 (อย่างน้อย 1 คน) · รวมได้ 5 / 10 คน — ขาด 5 คน');
    // ยอดตรงแต่มีสินค้าที่ไม่ได้ใส่ — ทุกสินค้าต้องได้อย่างน้อย 1 คน
    assert.equal(web.kolSplitProblem(kolBlock({ product_kols: { L3: 7, L8A: 3, L10: '' } })),
        'จำนวน KOL ต่อสินค้า (TikTok) ยังไม่ใส่จำนวนของ L10 (อย่างน้อย 1 คน)');
    // เปิดแยกแต่ยังไม่มีสินค้า
    assert.equal(web.kolSplitProblem(kolBlock({ products: [] }), 'Instagram'), 'จำนวน KOL ต่อสินค้า (Instagram) ยังไม่ได้เลือกสินค้า');
    // แถว Tier เปลี่ยนทีหลัง (เพิ่มคน) ตัวเลขต่อสินค้าต้องตามไปด้วย
    const more = kolBlock({ sets: [{ content_type: 'Review', tiers: tiers(12) }] });
    assert.equal(web.kolSplitState(more).ok, false);
    assert.match(web.kolSplitProblem(more, 'TikTok'), /รวมได้ 10 \/ 12 คน — ขาด 2 คน$/);
});

test('saving a split block keeps only current products as numbers; an unsplit block drops product_kols', () => {
    const packed = web.packKols(kolBlock({ products: ['L8A', 'L3'], product_kols: { L3: '5', L8A: '03', L10: '2', GONE: 9 } }));
    assert.equal(packed.kol_split, true);
    assert.deepEqual(packed.product_kols, { L8A: 3, L3: 5 });
    // ช่องที่ยังว่าง / 0 ไม่ถูกเก็บ (ฟอร์มไม่ให้บันทึกแบบนี้อยู่แล้ว)
    assert.deepEqual(web.packKols(kolBlock({ product_kols: { L3: '', L8A: '0', L10: 2 } })).product_kols, { L10: 2 });
    const off = web.packKols({ ...kolBlock(), kol_split: false });
    assert.equal(off.kol_split, false);
    assert.ok(!('product_kols' in off), 'ไม่แยก = ไม่ส่ง product_kols');
    // บล็อกเก่าที่ไม่มีช่องนี้ = ไม่แยก
    const old = web.packKols({ platform: 'TikTok', products: ['L3'], sets: [] });
    assert.equal(old.kol_split, false);
    assert.ok(!('product_kols' in old));
    // ช่องอื่นของบล็อกไม่ถูกแตะ
    assert.deepEqual(packed.sets, kolBlock().sets);
    assert.equal(packed.platform, 'TikTok');
});

test('toBlocks carries kol_split / product_kols; old blocks and new blocks are not split', () => {
    const [b] = web.toBlocks({ platforms: ['TikTok'], blocks: [kolBlock()] }, 'TikTok');
    assert.equal(b.kol_split, true);
    assert.deepEqual(b.product_kols, kolBlock().product_kols);
    assert.notEqual(b.product_kols, kolBlock().product_kols);
    const [old] = web.toBlocks({ platforms: ['TikTok'], blocks: [{ platform: 'TikTok', products: ['L3'], budget: '5' }] }, 'TikTok');
    assert.equal(old.kol_split, false);
    assert.deepEqual(old.product_kols, {});
    const [legacy] = web.toBlocks({ platform: 'TikTok', allocations: [{ tier: 'Nano 1k - 10k', kols: 3 }] }, 'TikTok');
    assert.equal(legacy.kol_split, false);
    assert.deepEqual(legacy.product_kols, {});
    assert.equal(web.emptyBlock('TikTok').kol_split, false);
    assert.deepEqual(web.emptyBlock('TikTok').product_kols, {});
    // จำนวนคนรวม / allocations ยังมาจากแถว Tier เหมือนเดิม
    assert.equal(web.blockKol(web.packKols(kolBlock())), 10);
    assert.equal(web.flattenBlocks([web.packKols(kolBlock())]).reduce((n, a) => n + a.kols, 0), 10);
});

// ---------- ส่งแล้ว / ต้องการ ต่อสินค้า (หน้าเอเจนซี่ / แท็บรายชื่อ / On Process) ----------
const group = (over = {}) => ({
    key: 'g1', platforms: ['TikTok', 'Instagram'],
    blocks: [
        kolBlock({ product_kols: { L3: 5, L8A: 3, L10: 2 } }),
        { platform: 'Instagram', products: ['L3'], sets: [{ tiers: tiers(2) }] }
    ], ...over
});
let sid = 0;
const sub = (person, product, over = {}) => ({ id: ++sid, person_key: person, group_key: 'g1', platform: 'TikTok', product, status: 'submitted', ...over });

test('per-product progress counts people (not clips) per Platform block, skipping rejected rows', () => {
    const subs = [
        sub('p1', 'L3'), sub('p1', 'L3', { clip_no: 2 }),               // คนเดียว 2 คลิป = 1 คน
        sub('p2', 'L3 - ดีดีครีมแตงโม, L8A'),                          // หลายรหัส = นับให้ทุกรหัส
        sub('p3', 'L8A', { status: 'confirmed' }),
        sub('p4', 'L8A', { status: 'rejected' }),                       // ไม่ถูกเลือก = ไม่นับ
        sub(null, 'L10', { status: 'confirmed' }),                      // ไม่มี person_key = นับแถวละคน
        sub('p6', 'L3', { platform: 'Instagram' }),                     // คนละ Platform
        sub('p7', 'L3', { group_key: 'g2' }),                           // คนละกลุ่ม
        sub('p8', 'L1')                                                 // สินค้านอกบล็อก (L1 ไม่จับ L10)
    ];
    const out = web.productKolProgress(group(), subs);
    assert.equal(out.length, 1, 'เฉพาะบล็อกที่แยกจำนวนคน');
    assert.equal(out[0].platform, 'TikTok');
    assert.deepEqual(out[0].rows, [
        { code: 'L3', need: 5, sent: 2, over: false, full: false },
        { code: 'L8A', need: 3, sent: 2, over: false, full: false },
        { code: 'L10', need: 2, sent: 1, over: false, full: false }
    ]);
});

test('per-product progress flags over-quota and full products, and respects the Platform scope', () => {
    const subs = [sub('a', 'L10'), sub('b', 'L10'), sub('c', 'L10'), sub('d', 'L8A'), sub('e', 'L8A'), sub('f', 'L8A')];
    const [tt] = web.productKolProgress(group(), subs, ['TikTok']);
    assert.deepEqual(tt.rows.find(r => r.code === 'L10'), { code: 'L10', need: 2, sent: 3, over: true, full: false });
    assert.deepEqual(tt.rows.find(r => r.code === 'L8A'), { code: 'L8A', need: 3, sent: 3, over: false, full: true });
    // ขอบเขตเฉพาะ Instagram (ไม่ได้แยก) = ไม่มีอะไรให้โชว์
    assert.deepEqual(web.productKolProgress(group(), subs, ['Instagram']), []);
    // ทั้งสอง Platform แยก → ได้สองบล็อก ตามลำดับในกลุ่ม
    const both = group({ blocks: [kolBlock(), { platform: 'Instagram', products: ['L3'], kol_split: true, product_kols: { L3: 2 }, sets: [{ tiers: tiers(2) }] }] });
    assert.deepEqual(web.productKolProgress(both, [sub('x', 'L3', { platform: 'Instagram' })]).map(p => [p.platform, p.rows.map(r => r.sent)]),
        [['TikTok', [0, 0, 0]], ['Instagram', [1]]]);
});

test('groups without a split (old data, solo, no blocks) have no per-product progress', () => {
    assert.deepEqual(web.productKolProgress({ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3'], sets: [] }] }, [sub('a', 'L3')]), []);
    assert.deepEqual(web.productKolProgress({ key: 'g1', allocations: [{ platform: 'TikTok', kols: 3 }] }, [sub('a', 'L3')]), []);
    assert.deepEqual(web.productKolProgress(null, []), []);
    assert.deepEqual(web.productKolProgress(group({ blocks: [kolBlock({ products: [] })] }), []), []);
    // ยังไม่มีรายชื่อ = ส่งแล้ว 0 ทุกสินค้า
    assert.deepEqual(web.productKolProgress(group(), undefined)[0].rows.map(r => r.sent), [0, 0, 0]);
});

// ---------- server: แท็บที่เปิดค้างจากก่อน deploy ----------
const stored = () => [{ key: 'g1', blocks: [web.packKols(kolBlock())] }];
// ฟอร์มรุ่นเก่า: ไม่รู้จัก kol_split / product_kols เลย
const stale = (over = {}) => [{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3', 'L8A', 'L10'], sets: kolBlock().sets, ...over }] }];

test('a stale form that did not touch products or tiers keeps the per-product counts', () => {
    const [g] = carryProductKols(stale(), stored());
    assert.equal(g.blocks[0].kol_split, true);
    assert.deepEqual(g.blocks[0].product_kols, { L3: 5, L8A: 3, L10: 2 });
    // บล็อกที่ส่งมาไม่มีชุด (ข้อมูลเก่ามาก) → เทียบกับ allocations ของ Platform นั้น
    const flat = [{ key: 'g1', allocations: [{ platform: 'TikTok', kols: 6 }, { platform: 'TikTok', kols: 4 }, { platform: 'Instagram', kols: 9 }],
        blocks: [{ platform: 'TikTok', products: ['L3', 'L8A', 'L10'] }] }];
    assert.equal(carryProductKols(flat, stored())[0].blocks[0].kol_split, true);
});

test('carry-over steps aside when products or the KOL total changed, or the new form sent kol_split', () => {
    // แก้จำนวนคนในแถว Tier
    assert.equal(carryProductKols(stale({ sets: [{ tiers: tiers(11) }] }), stored())[0].blocks[0].kol_split, undefined);
    // เอาสินค้าออก → ผลรวมไม่เท่าจำนวนคน
    assert.equal(carryProductKols(stale({ products: ['L3', 'L8A'] }), stored())[0].blocks[0].kol_split, undefined);
    // เพิ่มสินค้าที่ไม่มีจำนวนเดิม
    assert.equal(carryProductKols(stale({ products: ['L3', 'L8A', 'L10', 'L4'] }), stored())[0].blocks[0].kol_split, undefined);
    // ฟอร์มรุ่นใหม่ปิดแยกเอง ห้ามยกกลับมา · ฟอร์มรุ่นใหม่แยกอยู่ = ใช้ตามที่ส่งมา
    const off = carryProductKols(stale({ kol_split: false }), stored())[0].blocks[0];
    assert.equal(off.kol_split, false);
    assert.ok(!('product_kols' in off));
    const mine = carryProductKols(stale({ kol_split: true, product_kols: { L3: 4, L8A: 4, L10: 2 } }), stored())[0].blocks[0];
    assert.deepEqual(mine.product_kols, { L3: 4, L8A: 4, L10: 2 });
    // ของในฐานไม่ได้แยก / กลุ่มใหม่ / ไม่มีของเดิม
    assert.equal(carryProductKols(stale(), [{ key: 'g1', blocks: [{ platform: 'TikTok', products: ['L3'] }] }])[0].blocks[0].kol_split, undefined);
    assert.equal(carryProductKols([{ key: 'new', blocks: stale()[0].blocks }], stored())[0].blocks[0].kol_split, undefined);
    assert.equal(carryProductKols(null, stored()), null);
    assert.deepEqual(carryProductKols(stale(), null), stale());
    // Platform อื่นในกลุ่มเดียวกันไม่ถูกแตะ
    const two = carryProductKols([{ key: 'g1', blocks: [...stale()[0].blocks, { platform: 'Instagram', products: ['L3'], sets: [{ tiers: tiers(2) }] }] }], stored());
    assert.equal(two[0].blocks[1].kol_split, undefined);
});

test('what the new form saves passes the server carry-over untouched', () => {
    const saved = [{ key: 'g1', blocks: [web.packKols(kolBlock()), web.packKols({ platform: 'Instagram', products: ['L3'], sets: [] })] }];
    assert.deepEqual(carryProductKols(saved, stored()), saved);
});
