const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// หน้า Ads: เรียงตามคะแนน PFM (22 ต.ค. 2026 — "กดทีเดียวเรียงทั้ง CPM และ CPE" · คอลัมน์ STAMPED PFM 🔒 และ PFM)
// คะแนน = (CPM ÷ เกณฑ์ + CPE ÷ เกณฑ์) ÷ 2 · ต่ำ = ดี · ไม่มีตัวเลข = เรียงตามผล · ไม่มีผล = ท้ายเสมอ · ค่าเท่ากันคงลำดับเดิม
let P;
before(async () => { P = await import(pathToFileURL(path.join(__dirname, '../client/src/data/pfmSort.js')).href); });
const GOOD = { cpm: 28, cpe: 1.5 };
const stamp = (id, cpm, cpe, verdict) => ({ id, perf_stamp: { cpm, cpe, verdict: verdict || 'Pass' } });
const live = (id, cpm, cpe, perf) => ({ id, content_cpm: cpm, content_cpe: cpe, performance: perf || 'Good' });
const ids = list => list.map(r => r.id);

test('คะแนน = CPM และ CPE เทียบเกณฑ์เฉลี่ยกัน (น้ำหนักเท่ากัน) · มีตัวเดียวใช้ตัวนั้น · ไม่มีเลย = null', () => {
    assert.equal(P.pfmScore(28, 1.5, GOOD), 1);
    assert.equal(P.pfmScore(14, 3, GOOD), (0.5 + 2) / 2);
    assert.equal(P.pfmScore(56, null, GOOD), 2);
    assert.equal(P.pfmScore(null, 0.75, GOOD), 0.5);
    assert.equal(P.pfmScore(null, undefined, GOOD), null);
    assert.equal(P.pfmScore('', 'x', GOOD), null);
    assert.equal(P.pfmScore(0, 0, GOOD), 0, 'ศูนย์ = ดีสุด ไม่ใช่ไม่มีค่า');
});

test('STAMPED PFM: น้อย→มาก ดีสุดก่อน · มาก→น้อย แย่สุดก่อน · CPM ต่ำแต่ CPE สูงมาก ไม่ได้ชนะเพราะ CPM อย่างเดียว · ยังไม่สแตมป์อยู่ท้ายเสมอ', () => {
    const rows = [
        { id: 'none1' },
        stamp('a', 10, 3.0, 'Fail'),     // (0.357 + 2) / 2 = 1.18
        stamp('b', 20, 0.5),             // (0.714 + 0.333) / 2 = 0.52
        stamp('c', 30, 1.0, 'Fail'),     // (1.071 + 0.667) / 2 = 0.87
        { id: 'none2', perf_stamp: null },
        stamp('d', 20, 0.5)              // เท่ากับ b → คงลำดับเดิม (b ก่อน d)
    ];
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'stamp', dir: 'asc' }, GOOD)), ['b', 'd', 'c', 'a', 'none1', 'none2']);
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'stamp', dir: 'desc' }, GOOD)), ['a', 'c', 'b', 'd', 'none1', 'none2']);
    assert.deepEqual(ids(P.sortByPfm(rows, { key: '', dir: '' }, GOOD)), ids(rows), 'ไม่เรียง = ลำดับเดิม');
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'stamp', dir: 'x' }, GOOD)), ids(rows));
    assert.deepEqual(ids(rows), ['none1', 'a', 'b', 'c', 'none2', 'd'], 'ไม่แก้อาเรย์เดิม');
    assert.equal(P.pfmRatedCount(rows, 'stamp', GOOD), 4);
});

test('PFM (ผลตอนนี้): ใช้ content_cpm / content_cpe · ยังไม่มีผล (Not rated) อยู่ท้าย', () => {
    const rows = [live('x', 40, 2), { id: 'nr', performance: null }, live('y', 10, 0.5), live('z', 28, 1.5, 'Bad')];
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'live', dir: 'asc' }, GOOD)), ['y', 'z', 'x', 'nr']);
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'live', dir: 'desc' }, GOOD)), ['x', 'z', 'y', 'nr']);
    assert.equal(P.pfmRatedCount(rows, 'live', GOOD), 3);
});

test('ไม่มีตัวเลข (บัญชีที่ไม่เห็นต้นทุน / ได้ฟรี) = เรียงตามผล ผ่านก่อนไม่ผ่าน และอยู่หลังแถวที่มีตัวเลข', () => {
    const rows = [
        { id: 'f', perf_stamp: { cpm: null, cpe: null, verdict: 'Fail' } },
        { id: 'p', perf_stamp: { cpm: null, cpe: null, verdict: 'Pass' } },
        stamp('n', 50, 2, 'Fail'),
        { id: 'z' }
    ];
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'stamp', dir: 'asc' }, GOOD)), ['n', 'p', 'f', 'z']);
    assert.deepEqual(ids(P.sortByPfm(rows, { key: 'stamp', dir: 'desc' }, GOOD)), ['n', 'f', 'p', 'z']);
    const lv = [{ id: 'bad', performance: 'Bad' }, { id: 'good', performance: 'Good' }];
    assert.deepEqual(ids(P.sortByPfm(lv, { key: 'live', dir: 'asc' }, GOOD)), ['good', 'bad']);
});
