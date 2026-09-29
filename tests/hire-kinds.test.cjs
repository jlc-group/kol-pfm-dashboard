const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ประเภทงาน Talent — รายการใหม่ + ตัวเลือก "อื่น ๆ" ที่พิมพ์เองได้ · ตรรกะล้วน ไม่มีฐานข้อมูล
let k;
before(async () => {
    k = await import(pathToFileURL(path.join(__dirname, '../client/src/data/hireKinds.js')).href);
});

test('รายการประเภทงาน: เอา ช่างภาพ/ช่างวิดีโอ/เสียงพากย์ ออก · Event เป็น งาน Event · อื่น ๆ อยู่ท้าย', () => {
    assert.deepEqual(k.HIRE_KINDS, ['นางแบบ', 'นายแบบ', 'นักแสดง', 'Live สด', 'พิธีกร', 'งาน Event', 'อื่น ๆ']);
    for (const gone of ['ช่างภาพ', 'ช่างวิดีโอ', 'เสียงพากย์', 'Event']) assert.equal(k.HIRE_KINDS.includes(gone), false, gone);
});

test('ตัวเลือกที่ติ๊ก: ในรายการ = ตัวมันเอง · ว่าง = ยังไม่เลือก · ข้อความอื่น/ของเก่า = อื่น ๆ', () => {
    assert.equal(k.kindChoiceOf('นางแบบ'), 'นางแบบ');
    assert.equal(k.kindChoiceOf('งาน Event'), 'งาน Event');
    assert.equal(k.kindChoiceOf(''), '');
    assert.equal(k.kindChoiceOf(null), '');
    assert.equal(k.kindChoiceOf('อื่น ๆ'), 'อื่น ๆ');
    assert.equal(k.kindChoiceOf('ช่างแต่งหน้า'), 'อื่น ๆ');
    assert.equal(k.kindChoiceOf('ช่างภาพ'), 'อื่น ๆ', 'ของเก่าที่เอาออกจากรายการ');
    assert.equal(k.kindChoiceOf('Event'), 'อื่น ๆ', 'Event แบบเก่า');
});

test('ข้อความในช่องระบุงาน', () => {
    assert.equal(k.kindOtherText('อื่น ๆ'), '', 'ยังไม่ได้พิมพ์');
    assert.equal(k.kindOtherText('ช่างแต่งหน้า'), 'ช่างแต่งหน้า');
    assert.equal(k.kindOtherText('นางแบบ'), '', 'ตัวเลือกในรายการไม่มีช่องพิมพ์');
    assert.equal(k.kindOtherText(''), '');
});

test('เตือนก่อนบันทึก: ยังไม่เลือก / เลือกอื่น ๆ แต่ไม่พิมพ์ / พิมพ์แต่ช่องว่าง', () => {
    assert.equal(k.kindError(''), 'เลือกประเภทงาน');
    assert.equal(k.kindError(undefined), 'เลือกประเภทงาน');
    assert.match(k.kindError('อื่น ๆ'), /ระบุว่าเป็นงานอะไร/);
    assert.match(k.kindError('   '), /ระบุว่าเป็นงานอะไร/);
    assert.match(k.kindError(' อื่น ๆ '), /ระบุว่าเป็นงานอะไร/);
    assert.equal(k.kindError('นางแบบ'), '');
    assert.equal(k.kindError('ช่างแต่งหน้า'), '');
});

test('ค่าที่ส่งไปบันทึก = ตัดช่องว่างหัวท้าย', () => {
    assert.equal(k.kindValue('  ช่างแต่งหน้า '), 'ช่างแต่งหน้า');
    assert.equal(k.kindValue('งาน Event'), 'งาน Event');
    assert.equal(k.kindValue(null), '');
    assert.equal(k.KIND_MAXLEN, 100);
});
