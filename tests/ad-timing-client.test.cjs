const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// หน้า Ads คอลัมน์ "ระยะเวลายิง" (client/src/data/adTiming.js · ผู้ใช้สั่ง 1 ต.ค. 2026)
// นับจากวันพร้อมยิง (ข้อมูลครบชิ้นสุดท้าย) · ภายใน 3 วัน = ตรงเวลา · เกินนับเฉพาะส่วนที่เกิน
let t;
before(async () => {
    t = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adTiming.js')).href);
});

const row = over => ({ post_date: '2026-10-01', platform: 'Instagram', gencode: null, no_gencode: false, ...over });

test('ตัวอย่างของผู้ใช้: เอเจนซี่ใส่ Gencode ช้าไป 3 วัน แต่ยิงทันทีวันนั้น = ตรงเวลา', () => {
    const r = row({ gencode: 'GEN123', gencode_at: '2026-10-04T03:00:00.000Z' });
    const x = t.adTiming(r, '2026-10-04');
    assert.equal(x.ready.date, '2026-10-04');
    assert.equal(x.ready.by, 'gencode');
    assert.deepEqual([x.waited, x.late], [0, 0]);
    assert.equal(t.timingLevel(x.late), 'ontime');
});

test('ภายใน 3 วันนับจากวันพร้อมยิง = ตรงเวลา · เกินนับเฉพาะส่วนที่เกิน', () => {
    assert.equal(t.adTiming(row(), '2026-10-04').late, 0, '3 วันพอดี');
    const x = t.adTiming(row(), '2026-10-06');
    assert.deepEqual([x.waited, x.late], [5, 2], 'พร้อม 1 ต.ค. ยิง 6 ต.ค. = ช้า 2 วัน');
    assert.equal(t.timingLevel(2), 'warn');
    assert.equal(t.timingLevel(3), 'bad');
    assert.equal(t.timingLevel(0), 'ontime');
});

test('วันพร้อมยิง = วันที่ช้าที่สุดของ ลงคลิป / Gencode / ID Post (TikTok) / ทีมอนุมัติ', () => {
    const r = row({
        platform: 'TikTok', gencode: 'G', gencode_at: '2026-10-02T02:00:00Z',
        id_post: '769', id_post_at: '2026-10-05T02:00:00Z',
        post_check: 'ok', post_check_at: '2026-10-03T02:00:00Z'
    });
    assert.deepEqual(t.adReadyDate(r), { by: 'idpost', date: '2026-10-05', label: 'ใส่ ID Post' });
    assert.equal(t.adTiming(r, '2026-10-08').late, 0);
    assert.equal(t.adTiming(r, '2026-10-09').late, 1);
    // ID Post นับเฉพาะ TikTok · อนุมัตินับเฉพาะสถานะ ok · กลุ่มไม่ใช้ Gencode ไม่นับ Gencode
    assert.equal(t.adReadyDate({ ...r, platform: 'Instagram' }).by, 'check');
    assert.equal(t.adReadyDate({ ...r, platform: 'Instagram', post_check: 'pending' }).by, 'gencode');
    assert.equal(t.adReadyDate({ ...r, platform: 'Instagram', post_check: null, no_gencode: true }).by, 'post');
});

test('เวลาในฐานเป็น UTC → แปลงเป็นวันที่ไทยก่อนเทียบ', () => {
    assert.equal(t.thDay('2026-10-03T18:30:00.000Z'), '2026-10-04', 'ตี 1 ครึ่งวันที่ 4 ตามเวลาไทย');
    assert.equal(t.thDay('2026-10-03T16:59:59Z'), '2026-10-03');
    assert.equal(t.thDay('2026-10-03'), '2026-10-03');
    assert.equal(t.thDay(''), null);
    assert.equal(t.thDay('ไม่ใช่วันที่'), null);
    const r = row({ gencode: 'G', gencode_at: '2026-10-03T18:30:00.000Z' });
    assert.equal(t.adReadyDate(r).date, '2026-10-04');
});

test('ยิงก่อนข้อมูลครบ = ตรงเวลา · ข้อมูลไม่ครบ = null · ข้อมูลเก่าไม่มีเวลา = ใช้วันลงคลิป', () => {
    const r = row({ gencode: 'G', gencode_at: '2026-10-10T02:00:00Z' });
    assert.deepEqual([t.adTiming(r, '2026-10-05').waited, t.adTiming(r, '2026-10-05').late], [0, 0]);
    assert.equal(t.adTiming(row({ post_date: null }), '2026-10-05'), null);
    assert.equal(t.adTiming(row(), null), null);
    assert.equal(t.adTiming(row(), ''), null);
    const old = row({ gencode: 'G', gencode_at: null });
    assert.equal(t.adReadyDate(old).by, 'post');
    assert.equal(t.adTiming(old, '2026-10-07').late, 3);
});

test('คำอธิบายเวลาชี้บอกวันพร้อมยิง / วันยิง / จำนวนวันที่เกิน', () => {
    const x = t.adTiming(row({ gencode: 'G', gencode_at: '2026-10-02T02:00:00Z' }), '2026-10-08');
    assert.match(t.timingTip(x), /พร้อมยิง 2026-10-02 \(ใส่ Gencode\) · ยิง 2026-10-08 · รอ 6 วัน — เกินกำหนด 3 วันไป 3 วัน/);
    assert.match(t.timingTip(t.adTiming(row(), '2026-10-02')), /ภายในกำหนด 3 วัน/);
    assert.equal(t.TIMING_OPTS.length, 3);
});
