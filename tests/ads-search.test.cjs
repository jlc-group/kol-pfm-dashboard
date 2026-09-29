const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ช่องค้นหาในหน้า Ads — ตรรกะล้วน ไม่มีฐานข้อมูล
let s;
before(async () => {
    s = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adsSearch.js')).href);
});

const ROWS = [
    { sub_id: 1, account_name: 'flow3rgurrl', project_name: 'KOL Sep.2026', product: 'BTA4-01', gencode: '#M9XyqvF6jINpH', id_post: '7690488609664748807' },
    { sub_id: 2, account_name: 'youveneverseenn', project_name: 'KOL Sep.2026', product: 'BTA4-01', gencode: null, id_post: null },
    { sub_id: 3, account_name: 'paanlrrg', project_name: 'Review Watson', product: 'BTA1-01, BTA1-02', gencode: '', id_post: '' }
];
const ids = q => ROWS.filter(r => s.matchAdsSearch(r, q)).map(r => r.sub_id);

test('ช่องว่าง / มีแต่ช่องว่าง / มีแต่ @ = เห็นทุกแถว', () => {
    for (const q of ['', '   ', undefined, null, '@']) assert.deepEqual(ids(q), [1, 2, 3], JSON.stringify(q));
});

test('หาชื่อ KOL ได้บางส่วน และไม่สนตัวพิมพ์เล็ก-ใหญ่', () => {
    assert.deepEqual(ids('flow'), [1]);
    assert.deepEqual(ids('FLOW3R'), [1]);
    assert.deepEqual(ids('  never  '), [2], 'ตัดช่องว่างหัวท้าย');
});

test('พิมพ์ @ นำหน้าชื่อ (ก๊อปมาจาก TikTok) ก็เจอ', () => {
    assert.deepEqual(ids('@flow3rgurrl'), [1]);
    assert.deepEqual(ids('@@youve'), [2]);
});

test('หาจากแคมเปญ สินค้า Gencode และ ID Post ได้ด้วย', () => {
    assert.deepEqual(ids('watson'), [3]);
    assert.deepEqual(ids('sep.2026'), [1, 2]);
    assert.deepEqual(ids('bta1-02'), [3], 'สินค้าหลายตัวในช่องเดียว');
    assert.deepEqual(ids('m9xyq'), [1], 'Gencode');
    assert.deepEqual(ids('66474880'), [1], 'ID Post บางส่วน');
});

test('ไม่เจอ = ไม่มีแถว · ค่าว่าง/null ในแถวไม่ทำให้พัง', () => {
    assert.deepEqual(ids('ไม่มีชื่อนี้'), []);
    assert.equal(s.matchAdsSearch({}, 'x'), false);
    assert.equal(s.matchAdsSearch(null, 'x'), false);
    assert.equal(s.matchAdsSearch(null, ''), true);
});

test('ไม่ค้นแบรนด์ / Platform (มีปุ่มกรองของตัวเองแล้ว)', () => {
    assert.equal(s.matchAdsSearch({ account_name: 'a', brand: 'Beauterry', platform: 'TikTok' }, 'beauterry'), false);
    assert.equal(s.matchAdsSearch({ account_name: 'a', brand: 'Beauterry', platform: 'TikTok' }, 'tiktok'), false);
});
