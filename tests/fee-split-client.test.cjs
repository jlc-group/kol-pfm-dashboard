const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// หารค่าตัวเฉลี่ย: แยกคนที่ทีมจ้างเองออกจากฝั่งเอเจนซี่ (client/src/data/feeSplit.js · ผู้ใช้สั่ง 15 ต.ค. 2026)
// กลุ่มที่มีทั้งสองฝั่ง: (งบ − ค่าตัวคนจ้างเอง) ÷ ((โควตา − คนจ้างเอง) × คลิปต่อคน) · แตะเฉพาะคลิปจากเอเจนซี่
// กลุ่มที่ไม่มีเอเจนซี่เลย / ไม่มีคนจ้างเอง = หารแบบเดิม
let f;
before(async () => {
    f = await import(pathToFileURL(path.join(__dirname, '../client/src/data/feeSplit.js')).href);
});

let seq = 0;
const own = budget => ({ id: ++seq, person_key: 'own' + seq, agency_token: null, budget });
const ag = (budget = 0, token = 'tok-mesaran') => ({ id: ++seq, person_key: 'ag' + seq, agency_token: token, budget });

test('เคสจริง Jernis กลุ่มที่ 2 TikTok: งบ 291,938 · 30 คน · ทีมจ้างเอง 7 คน 256,000 → เอเจนซี่ 23 คน คนละ 1,563', () => {
    const mine = [18000, 40000, 40000, 32000, 37000, 40000, 49000].map(own);
    const agency = [...Array(11).fill(9731), ...Array(12).fill(0)].map(b => ag(b));
    const p = f.splitPlan({ budget: 291938, quota: 30, clips: 1, rows: [...mine, ...agency] });
    assert.equal(p.mixed, true);
    assert.deepEqual([p.ownPeople, p.ownFees, p.ownMissing, p.budgetLeft, p.quotaLeft, p.divisor], [7, 256000, 0, 35938, 23, 23]);
    assert.equal(p.perClip, 1563);
    assert.equal(p.targetRows.length, 23);
    assert.ok(p.targetRows.every(s => s.agency_token), 'แตะเฉพาะคลิปจากเอเจนซี่');
    assert.equal(p.rounding, 1563 * 23 - 35938);
});

test('ไม่มีคนจ้างเอง = แบบเดิมทุกอย่าง (291,938 ÷ 30 = 9,731)', () => {
    const p = f.splitPlan({ budget: 291938, quota: 30, clips: 1, rows: [ag(), ag()] });
    assert.equal(p.mixed, false);
    assert.equal(p.perClip, 9731);
    assert.equal(p.targetRows.length, 2);
});

test('ทีมจ้างเองทั้งกลุ่ม (ไม่มีเอเจนซี่ เช่น Review Watson) = หารแบบเดิมให้คนจ้างเองเหมือนเดิม', () => {
    const rows = [own(0), own(0), own(5000)];
    const p = f.splitPlan({ budget: 30000, quota: 10, clips: 1, rows });
    assert.equal(p.mixed, false);
    assert.equal(p.perClip, 3000);
    assert.deepEqual(p.targetRows, rows);
    assert.deepEqual(f.feeTargets(rows), rows);
});

test('คลิปต่อคนมากกว่า 1 · คนจ้างเองคนเดียวหลายคลิปนับเป็น 1 คน', () => {
    const a = own(10000), b = { ...own(10000), person_key: a.person_key };   // คนเดียวกัน 2 คลิป
    const p = f.splitPlan({ budget: 100000, quota: 10, clips: 2, rows: [a, b, ag(), ag()] });
    assert.deepEqual([p.ownPeople, p.ownFees, p.quotaLeft, p.divisor], [1, 20000, 9, 18]);
    assert.equal(p.perClip, Math.round(80000 / 18));
});

test('คนจ้างเองยังไม่ใส่ค่าตัว = นับไว้เตือน (ยอดเอเจนซี่จะสูงเกินจริง)', () => {
    const p = f.splitPlan({ budget: 50000, quota: 10, clips: 1, rows: [own(0), own(10000), ag()] });
    assert.equal(p.ownMissing, 1);
    assert.equal(p.perClip, Math.round(40000 / 8));
});

test('ค่าตัวคนจ้างเองใช้งบหมด / ครบโควตา = หารไม่ได้ (0) ไม่ติดลบ', () => {
    assert.equal(f.splitPlan({ budget: 20000, quota: 10, clips: 1, rows: [own(25000), ag()] }).perClip, 0);
    assert.equal(f.splitPlan({ budget: 20000, quota: 10, clips: 1, rows: [own(20000), ag()] }).perClip, 0);
    const full = f.splitPlan({ budget: 99999, quota: 1, clips: 1, rows: [own(100), ag()] });
    assert.deepEqual([full.quotaLeft, full.divisor, full.perClip], [0, 0, 0]);
    assert.equal(full.targetRows.length, 1, 'ปุ่มล้างยังแตะได้เฉพาะฝั่งเอเจนซี่');
});

test('แยกฝั่งด้วย agency_token: ว่าง/ช่องว่าง = จ้างเอง · ลิงก์ถูกลบแล้ว (token ค้าง) = ยังเป็นเอเจนซี่', () => {
    assert.equal(f.isSelfHired({ agency_token: null }), true);
    assert.equal(f.isSelfHired({ agency_token: '   ' }), true);
    assert.equal(f.isSelfHired({}), true);
    assert.equal(f.isSelfHired({ agency_token: 'dead-link-token' }), false);
    const rows = [own(1000), ag(500, 'dead-link-token')];
    assert.deepEqual(f.feeTargets(rows).map(s => s.agency_token), ['dead-link-token']);
});
