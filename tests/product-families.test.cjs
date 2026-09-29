const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// กลุ่มสินค้าหลายสี — หน้าเว็บ (ช่อง PRODUCTS หน้า Ads) กับ server (ฟีดที่ระบบยิงแอดดึง) ต้องกางออกมาเหมือนกันเป๊ะ
// ตรรกะล้วน ไม่มีฐานข้อมูล
const server = require('../server/src/store/productFamilies');
let web;
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/products.js')).href);
});

const byFirst = fams => [...fams].map(f => [...f]).sort((a, b) => a[0].localeCompare(b[0]));
const BTA4 = ['BTA4-00', 'BTA4-01', 'BTA4-02', 'BTA4-03', 'BTA4-04', 'BTA4-05', 'BTA4-06', 'BTA4-07'];

test('กลุ่มสีฝั่ง server ตรงกับที่หน้าเว็บคิดจากคลังสินค้า (เพิ่มสีใหม่ต้องแก้สองที่)', () => {
    assert.deepEqual(byFirst(server.PRODUCT_FAMILIES), byFirst(web.PRODUCT_FAMILIES));
});

test('กลุ่มที่ได้ = Beauterry 4 กลุ่ม + Jula\'s Herb 2 กลุ่ม ตามที่ผู้ใช้เลือก', () => {
    const keys = byFirst(web.PRODUCT_FAMILIES).map(f => f[0] + '×' + f.length);
    assert.deepEqual(keys, ['BTA1-01×6', 'BTA2-01×3', 'BTA3-01×3', 'BTA4-00×8', 'L8A×2', 'T5A×3']);
});

const CASES = [
    ['BTA4-01', BTA4],
    ['bta4-05', BTA4],
    ['BTA1-03,BTA1-04', ['BTA1-01', 'BTA1-02', 'BTA1-03', 'BTA1-04', 'BTA1-05', 'BTA1-06']],
    ['BTA2-01 บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)', ['BTA2-01', 'BTA2-02', 'BTA2-03']],
    ['L8B', ['L8A', 'L8B']],
    ['T5C', ['T5A', 'T5B', 'T5C']],
    ['T6A', ['T6A']],
    ['L3', ['L3']],
    ['JNP1', ['JNP1']],
    ['BTA4-01, L3', [...BTA4, 'L3']],
    ['L3, BTA4-01, L3', ['L3', ...BTA4]],
    [['BTA4-00', 'BTA4-01'], BTA4],
    ['', []],
    [null, []],
    [' , ,', []],
    // คั่นด้วย ， (จุลภาคเต็มความกว้าง) / ช่องว่าง / ขึ้นบรรทัด — ต้องไม่มีรหัสไหนหาย
    ['BTA4-01，BTA2-01', [...BTA4, 'BTA2-01', 'BTA2-02', 'BTA2-03']],
    ['BTA4-01 BTA2-01', [...BTA4, 'BTA2-01', 'BTA2-02', 'BTA2-03']],
    ['BTA4-01\nBTA2-01', [...BTA4, 'BTA2-01', 'BTA2-02', 'BTA2-03']],
    ['L3 L4', ['L3', 'L4']],
    // ข้อความที่พิมพ์เอง (แบรนด์ที่ไม่มีคลัง) ส่งตามที่พิมพ์ ไม่ถูกตัด
    ['Minimii ครีมกันแดด', ['Minimii ครีมกันแดด']],
    ['Vit C Serum, Vit C Serum Mini', ['Vit C Serum', 'Vit C Serum Mini']]
];

test('กางทุกสี: รหัสเดียว / หลายรหัส / มีชื่อต่อท้าย / ตัวพิมพ์เล็ก / สินค้าที่ไม่มีหลายสี / ค่าว่าง', () => {
    for (const [input, want] of CASES) {
        assert.deepEqual(web.expandProductFamilies(input), want, 'web ' + JSON.stringify(input));
        assert.deepEqual(server.expandProductFamilies(input), want, 'server ' + JSON.stringify(input));
    }
});

test('ทุกรหัสในคลังกางออกมาเหมือนกันทั้งสองฝั่ง', () => {
    for (const p of web.PRODUCT_CATALOG) {
        assert.deepEqual(server.expandProductFamilies(p.code), web.expandProductFamilies(p.code), p.code);
    }
    const all = web.PRODUCT_CATALOG.map(p => p.code).join(',');
    assert.deepEqual(server.expandProductFamilies(all), web.expandProductFamilies(all));
});

test('ป้ายใต้ชื่อ KOL: รหัสในคลังโชว์แค่รหัส · ชื่อที่พิมพ์เองโชว์ทั้งข้อความ (ไม่ตัดเหลือคำแรก)', () => {
    const cases = [
        ['BTA4-01', ['BTA4-01']],
        ['bta4-01', ['BTA4-01']],
        ['BTA1-03,BTA1-04', ['BTA1-03', 'BTA1-04']],
        ['BTA2-01 บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)', ['BTA2-01']],
        ['BTA4-01 BTA2-01', ['BTA4-01', 'BTA2-01']],
        ['BTA4-01，BTA4-01', ['BTA4-01']],
        ['Dermiq Serum Vit C', ['Dermiq Serum Vit C']],
        ['เซรั่ม ขิงดำ', ['เซรั่ม ขิงดำ']],
        ['Vit C Serum, Vit C Serum Mini', ['Vit C Serum', 'Vit C Serum Mini']],
        ['', []]
    ];
    for (const [input, want] of cases) assert.deepEqual(web.clipProductLabels(input), want, JSON.stringify(input));
});

test('แถวงานอีเวนต์ที่ใส่ครบ 20 รหัสอยู่แล้ว — กางแล้วยังเป็น 20 รหัสเดิม', () => {
    const twenty = byFirst(server.PRODUCT_FAMILIES).filter(f => f[0].startsWith('BTA')).flat();
    assert.equal(twenty.length, 20);
    assert.deepEqual(server.expandProductFamilies(twenty.join(', ')), twenty);
});
