const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// สถานะ "ยิงแล้ว" ที่คำนวณจากค่าแอด — ตรรกะล้วน ไม่มีฐานข้อมูล
// ad_status เป็นค่าที่คนกดเอง แต่ค่าแอดมาจาก PFM อัตโนมัติ พอไม่มีใครกด
// แถวที่เงินเดินแล้วจะค้างเป็น "ยังไม่ยิง" ทั้งที่แอดวิ่งจริง
const { effectiveAdStatus, adRanBySpend } = require(path.join(__dirname, '../server/src/store/logic.js'));

test('มีค่าแอด = ถือว่ายิงแล้ว แม้ยังไม่มีใครกดยืนยัน', () => {
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: 204.86 }), 'ยิงแล้ว');
    // เงินระดับสตางค์ก็ยังนับ — แอดวิ่งแล้วคือวิ่งแล้ว
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: 0.01 }), 'ยิงแล้ว');
    // ค่าที่ซิงก์เข้ามาเป็น string ได้ (numeric ของ pg) ต้องอ่านออกเหมือนกัน
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: '7004.32' }), 'ยิงแล้ว');
});

test('ไม่มีค่าแอด = ยังไม่ยิงตามเดิม', () => {
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: 0 }), 'ยังไม่ยิง');
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: null }), 'ยังไม่ยิง');
    assert.equal(effectiveAdStatus({ ad_status: 'ยังไม่ยิง', ad_spend: '' }), 'ยังไม่ยิง');
});

test('คนกดยืนยันแล้ว ยังเป็นยิงแล้วเสมอ ต่อให้ค่าแอดยังไม่เข้า', () => {
    // ยิงแอดวันนี้ ค่าแอดกว่าจะซิงก์มาอีกหลายชั่วโมง — ห้ามเด้งกลับเป็นยังไม่ยิง
    assert.equal(effectiveAdStatus({ ad_status: 'ยิงแล้ว', ad_spend: 0 }), 'ยิงแล้ว');
});

test('ข้อมูลไม่ครบต้องไม่ระเบิด', () => {
    assert.equal(effectiveAdStatus({}), 'ยังไม่ยิง');
    assert.equal(effectiveAdStatus(null), 'ยังไม่ยิง');
    assert.equal(effectiveAdStatus(undefined), 'ยังไม่ยิง');
    assert.equal(adRanBySpend(undefined), false);
    // แถวเก่าที่ไม่มี ad_status แต่มีเงินแล้ว
    assert.equal(effectiveAdStatus({ ad_spend: 50 }), 'ยิงแล้ว');
});
