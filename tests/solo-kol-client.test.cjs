const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// KOL รายคน — ตรรกะฝั่งหน้าเว็บ (client/src/data/soloKol.js) + ตัวเลือกต้องตรงกับ server (server/src/store/soloKol.js)
const server = require(path.join(__dirname, '../server/src/store/soloKol'));
let c;
before(async () => {
    c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/soloKol.js')).href);
});

test('ตัวเลือกฝั่งหน้าเว็บตรงกับ server (Platform / Tier / อายุ Gencode / จำนวนคลิป / ขั้นงาน)', () => {
    assert.deepEqual(c.SOLO_PLATFORMS, server.SOLO_PLATFORMS);
    assert.deepEqual(c.SOLO_TIERS, server.SOLO_TIERS);
    assert.deepEqual(c.SOLO_CODE_EXPIRE, server.SOLO_CODE_EXPIRE);
    assert.equal(c.SOLO_MAX_CLIPS, server.SOLO_MAX_CLIPS);
    assert.deepEqual(Object.keys(c.SOLO_STEP_LABEL).sort(), [...server.SOLO_STEPS].sort(), 'ทุกขั้นที่ server ส่งมามีป้าย');
    const covered = c.SOLO_STEP_FILTERS.flatMap(f => f.steps).sort();
    assert.deepEqual(covered, [...server.SOLO_STEPS].sort(), 'ตัวกรองครอบทุกขั้น ไม่มีแถวหลุด');
});

test('tierFromFollowers: แนะนำ Tier ตามผู้ติดตาม', () => {
    assert.equal(c.tierFromFollowers(''), '');
    assert.equal(c.tierFromFollowers(0), '');
    assert.equal(c.tierFromFollowers(9999), 'Nano 1k - 10k');
    assert.equal(c.tierFromFollowers(10000), 'Micro 10k - 100k');
    assert.equal(c.tierFromFollowers(85000), 'Micro 10k - 100k');
    assert.equal(c.tierFromFollowers(100000), 'Macro 100k - 1M');
    assert.equal(c.tierFromFollowers(2500000), 'Mega 1M+');
    assert.equal(c.tierShort('Micro 10k - 100k'), 'Micro');
});

const row = (id, over = {}, sum = {}) => ({
    id, name: `KOL รายคน · @a${id} (TikTok)`, brand: 'Beauterry', owner: 'แพรว', status: 'Active', end_date: '2026-10-10', ...over,
    solo_summary: { account_name: 'a' + id, payee: 'a' + id, products: ['BTA4-01'], clips: 1, posted: 0, ad_fired: 0, fee_total: 5000, next_step: 'todo', due_date: '2026-10-10', ...sum }
});

test('ค้นหา / กรองขั้นงาน / สรุปยอด', () => {
    const list = [row(1), row(2, { brand: 'Jdent' }, { payee: 'Star Model', agency: 'Star Model', next_step: 'gencode' }), row(3, {}, { next_step: 'idpost', clips: 2, posted: 2, fee_total: 12000 })];
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, '@A2')).map(p => p.id), [2], 'ชื่อบัญชี (มี @ นำหน้าก็เจอ)');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'star')).map(p => p.id), [2], 'Agency');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'jdent')).map(p => p.id), [2], 'แบรนด์');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'bta4-01')).map(p => p.id), [1, 2, 3], 'สินค้า');
    assert.deepEqual(list.filter(p => c.matchStepFilter(p, 'code')).map(p => p.id), [2, 3], 'Gencode + ID Post รวมปุ่มเดียว');
    assert.deepEqual(list.filter(p => c.matchStepFilter(p, 'all')).map(p => p.id), [1, 2, 3]);
    assert.deepEqual(c.soloTotals(list), { people: 3, clips: 4, fee: 22000, posted: 2, ad: 0 });
});

test('overdueDays: เลยกำหนดลงงาน เฉพาะที่ยังลงไม่ครบและยังเปิดอยู่', () => {
    assert.equal(c.overdueDays(row(1), '2026-10-13'), 3);
    assert.equal(c.overdueDays(row(1), '2026-10-10'), 0);
    assert.equal(c.overdueDays(row(1, {}, { posted: 1, clips: 1 }), '2026-10-13'), 0, 'ลงครบแล้ว');
    assert.equal(c.overdueDays(row(1, { status: 'Completed' }), '2026-10-13'), 0, 'ปิดงานแล้ว');
    assert.equal(c.overdueDays(row(1, {}, { due_date: null }), '2026-10-13'), 0, 'ไม่มีกำหนด');
    // server ตั้ง end_date = วันจ้างเมื่อไม่ใส่กำหนด — ต้องไม่ขึ้นเลยกำหนดจาก end_date
    assert.equal(c.overdueDays(row(1, { end_date: '2026-09-30' }, { due_date: null }), '2026-10-13'), 0, 'ไม่ใช้ end_date');
    assert.equal(c.soloDueOf(row(1)), '2026-10-10');
});

test('ตัวเลขบนหน้า: ค่าตัว / ผู้ติดตาม', () => {
    assert.equal(c.baht(10000), '฿10,000');
    assert.equal(c.followersText(85000), '85K');
    assert.equal(c.followersText(1500), '1.5K');
    assert.equal(c.followersText(2500000), '2.5M');
    assert.equal(c.followersText(0), '');
});
