const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ตัวกรองรายชื่อตามกลุ่มสินค้า (แท็บรายชื่อ KOL ฝั่งทีม) — ตรรกะล้วน ไม่มีฐานข้อมูล
let gf, countPeople;
before(async () => {
    gf = await import(pathToFileURL(path.join(__dirname, '../client/src/data/groupFilter.js')).href);
    ({ countPeople } = await import(pathToFileURL(path.join(__dirname, '../client/src/data/clips.js')).href));
});

const groups = [
    { key: 'g1', concept: 'ครีมกันแดด', products: ['L3', 'L4'] },
    { key: 'g2', products: ['L1'] },
    { key: 'g3' }                                          // กลุ่มที่ยังไม่มีรายชื่อเลย
];
const subs = [
    { id: 1, person_key: 'p1', group_key: 'g1' },
    { id: 2, person_key: 'p1', group_key: 'g1' },          // คนเดียวกันอีกคลิป
    { id: 3, person_key: 'p2', group_key: 'g1' },
    { id: 4, person_key: 'p3', group_key: 'g2' },
    { id: 5, person_key: 'p4', group_key: '' },            // ไม่ระบุกลุ่ม
    { id: 6, person_key: 'p5', group_key: 'gX' }           // ชี้กลุ่มที่ถูกลบไปแล้ว
];

test('เลือก "ทั้งหมด" ผ่านทุกแถว', () => {
    const keys = gf.groupKeySet(groups);
    assert.ok(subs.every(s => gf.matchGroup(s, 'all', keys)));
});

test('เลือกกลุ่มหนึ่ง ได้เฉพาะรายชื่อของกลุ่มนั้น', () => {
    const keys = gf.groupKeySet(groups);
    assert.deepEqual(subs.filter(s => gf.matchGroup(s, 'g1', keys)).map(s => s.id), [1, 2, 3]);
    assert.deepEqual(subs.filter(s => gf.matchGroup(s, 'g3', keys)).map(s => s.id), []);
});

test('"ไม่ระบุกลุ่ม" = ทั้งคนที่ไม่มี group_key และคนที่ชี้กลุ่มที่ถูกลบไปแล้ว', () => {
    const keys = gf.groupKeySet(groups);
    assert.deepEqual(subs.filter(s => gf.matchGroup(s, gf.NO_GROUP, keys)).map(s => s.id), [5, 6]);
});

test('ชิปที่เลือกไว้ยังอยู่ → คงค่าเดิม', () => {
    const opts = gf.groupFilterOptions(groups, subs, countPeople);
    assert.equal(gf.normalizeGroupSel('g2', opts), 'g2');
    assert.equal(gf.normalizeGroupSel(gf.NO_GROUP, opts), gf.NO_GROUP);
    assert.equal(gf.normalizeGroupSel('all', opts), 'all');
});

test('กลุ่มที่เลือกไว้ถูกลบ → ถอยกลับเป็น "ทั้งหมด" ไม่ใช่หน้าว่างที่กดคืนไม่ได้', () => {
    const opts = gf.groupFilterOptions(groups, subs, countPeople);
    assert.equal(gf.normalizeGroupSel('gX', opts), 'all');
});

test('เลือก "ไม่ระบุกลุ่ม" ไว้แล้วคนตกกลุ่มคนสุดท้ายหายไป → ถอยเป็น "ทั้งหมด" ไม่ใช่ค้างไว้จนไม่มีชิปไหนติด', () => {
    // ชิป "ไม่ระบุกลุ่ม" หายเพราะไม่มีใครตกกลุ่มแล้ว แต่กลุ่มจริงยังอยู่ แถบจึงยังขึ้น
    const opts = gf.groupFilterOptions(groups, subs.filter(s => s.group_key === 'g1' || s.group_key === 'g2'), countPeople);
    assert.ok(!opts.some(o => o.key === gf.NO_GROUP));
    assert.equal(gf.normalizeGroupSel(gf.NO_GROUP, opts), 'all');
});

test('แถบไม่ขึ้น (ตัวเลือกเหลือ 0-1) → ตัวกรองต้องไม่ทำงานค้างเงียบ ๆ', () => {
    assert.equal(gf.normalizeGroupSel('g1', [{ key: 'g1' }]), 'all');
    assert.equal(gf.normalizeGroupSel('g1', []), 'all');
    assert.equal(gf.normalizeGroupSel('g1', null), 'all');
});

test('ชิปมีครบทุกกลุ่มในแคมเปญแม้กลุ่มนั้นยังไม่มีรายชื่อ และนับเป็นคนไม่ใช่คลิป', () => {
    const opts = gf.groupFilterOptions(groups, subs, countPeople);
    assert.deepEqual(opts.map(o => o.key), ['g1', 'g2', 'g3', gf.NO_GROUP]);
    assert.deepEqual(opts.map(o => o.no), [1, 2, 3, 0]);
    // g1 มี 3 แถวแต่เป็น 2 คน (p1 ส่ง 2 คลิป) — ต้องตรงกับชิปแพลตฟอร์มที่นับเป็นคนเหมือนกัน
    assert.deepEqual(opts.map(o => o.count), [2, 1, 0, 2]);
    assert.equal(opts[0].concept, 'ครีมกันแดด');
    assert.deepEqual(opts[0].products, ['L3', 'L4']);
});

test('ไม่มีคนตกกลุ่ม → ไม่มีชิป "ไม่ระบุกลุ่ม"', () => {
    const opts = gf.groupFilterOptions(groups, subs.filter(s => s.group_key === 'g1'), countPeople);
    assert.deepEqual(opts.map(o => o.key), ['g1', 'g2', 'g3']);
});

test('กลุ่มเดียวและไม่มีคนตกกลุ่ม → ตัวเลือกเหลือ 1 (แถบไม่ต้องขึ้น)', () => {
    const one = [{ key: 'g1' }];
    const opts = gf.groupFilterOptions(one, [{ id: 1, person_key: 'p1', group_key: 'g1' }], countPeople);
    assert.equal(opts.length, 1);
});

test('ข้อมูลเก่าที่กลุ่มไม่มี key → ไม่ให้ตัวเลือกเลย ดีกว่ากรองผิดไปปนกับคนที่ไม่ระบุกลุ่ม', () => {
    assert.deepEqual(gf.groupFilterOptions([{ key: 'g1' }, { concept: 'ไม่มี key' }], subs, countPeople), []);
    assert.deepEqual(gf.groupFilterOptions([], subs, countPeople), []);
    assert.deepEqual(gf.groupFilterOptions(null, subs, countPeople), []);
});
