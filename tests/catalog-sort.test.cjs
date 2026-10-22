const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// หน้า Products & Targets: เรียงตามรหัส / ชื่อ + กรองตัวอักษรนำหน้ารหัส (22 ต.ค. 2026)
let S;
before(async () => { S = await import(pathToFileURL(path.join(__dirname, '../client/src/data/catalogSort.js')).href); });
const P = (code, name) => ({ code, name });
const codes = list => list.map(p => p.code);

test('รหัสเรียงแบบตัวเลขตามค่า: L8A ก่อน L10 · BTA4-01 ก่อน BTA10-01 · ตัวเล็กใหญ่ไม่มีผล', () => {
    const list = [P('L10'), P('C2'), P('L8A'), P('BTA10-01'), P('l9'), P('BTA4-01'), P('A1')];
    assert.deepEqual(codes(S.sortProducts(list, 'code-asc')), ['A1', 'BTA4-01', 'BTA10-01', 'C2', 'L8A', 'l9', 'L10']);
    assert.deepEqual(codes(S.sortProducts(list, 'code-desc')), ['L10', 'l9', 'L8A', 'C2', 'BTA10-01', 'BTA4-01', 'A1']);
    assert.deepEqual(codes(list), ['L10', 'C2', 'L8A', 'BTA10-01', 'l9', 'BTA4-01', 'A1'], 'ไม่แก้อาเรย์เดิม');
});

test('ชื่อสินค้าเรียง ก → ฮ / ฮ → ก · ชื่อซ้ำเรียงตามรหัส · ไม่มีชื่ออยู่หน้าสุด (ไม่พัง)', () => {
    const list = [P('X2', 'เซรั่ม'), P('X1', 'กันแดด'), P('X3', 'Body lotion'), P('X10', 'กันแดด'), P('X4')];
    const asc = codes(S.sortProducts(list, 'name-asc'));
    assert.equal(asc[0], 'X4');
    assert.ok(asc.indexOf('X1') < asc.indexOf('X10') && asc.indexOf('X10') < asc.indexOf('X2'), asc.join());
    const desc = codes(S.sortProducts(list, 'name-desc'));
    assert.deepEqual(desc, [...asc].reverse());
});

test('ลำดับเดิม / ค่าที่ไม่รู้จัก = ตามคลัง · isSortMode กันค่าเพี้ยนจาก localStorage', () => {
    const list = [P('L10'), P('A1')];
    assert.deepEqual(codes(S.sortProducts(list, '')), ['L10', 'A1']);
    assert.deepEqual(codes(S.sortProducts(list, 'hack')), ['L10', 'A1']);
    assert.deepEqual(S.sortProducts(null, 'code-asc'), []);
    assert.equal(S.isSortMode('code-asc'), true);
    assert.equal(S.isSortMode('hack'), false);
    assert.equal(S.isSortMode(''), true);
});

test('ตัวอักษรนำหน้า: L8A → L · BTA4-01 → BTA · JNPSET1 → JNPSET · 123 → # · ตัวเลือกเรียง A → Z พร้อมจำนวน', () => {
    assert.equal(S.codePrefix('L8A'), 'L');
    assert.equal(S.codePrefix('bta4-01'), 'BTA');
    assert.equal(S.codePrefix('JNPSET1'), 'JNPSET');
    assert.equal(S.codePrefix('123'), '#');
    assert.equal(S.codePrefix(''), '#');
    const opts = S.prefixOptions([P('L8A'), P('C2'), P('L10'), P('A1'), P('9X')]);
    assert.deepEqual(opts.map(o => [o.value, o.count]), [['#', 1], ['A', 1], ['C', 1], ['L', 2]]);
    assert.equal(opts.find(o => o.value === 'L').label, 'ขึ้นต้นด้วย L');
});
