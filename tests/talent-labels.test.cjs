const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// คำศัพท์ชุดเดียวของหน้า Talent (client/src/data/talentLabels.js) — ตรรกะล้วน ไม่มีฐานข้อมูล ไม่มี DOM
// ค่าในฐานต้องไม่เปลี่ยน (ทาบทาม / Draft / pending ...) เปลี่ยนแค่ป้ายที่โชว์ — เทสต์ผูกทั้งสองฝั่งไว้
let L;
before(async () => {
    L = await import(pathToFileURL(path.join(__dirname, '../client/src/data/talentLabels.js')).href);
});

// เวลาคงที่ของเทสต์: 18 ก.ย. 2026 12:00 น. เวลาไทย (= 05:00 UTC)
const NOW = Date.UTC(2026, 8, 18, 5, 0, 0);

test('feeMissing: ว่าง / 0 / ตัวอักษรล้วน = ยังไม่มีค่าตัว · ตัวเลขที่มีคอมมาหรือ ฿ ปนก็นับได้', () => {
    for (const v of [null, undefined, '', 0, '0', 'abc', '฿0']) assert.equal(L.feeMissing(v), true, String(v));
    for (const v of [1, 1500, '1500', '1,500', '฿1,500', '0.5']) assert.equal(L.feeMissing(v), false, String(v));
});

test('needsFee: บล็อกเฉพาะสถานะที่จ่ายเงินได้ (ตกลงแล้ว ขึ้นไป) ที่ยังไม่มีค่าตัว', () => {
    assert.deepEqual(L.PAYABLE_STATUS, ['ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว']);
    assert.equal(L.needsFee('ตกลงแล้ว', 0), true);
    assert.equal(L.needsFee('ถ่ายเสร็จ', ''), true);
    assert.equal(L.needsFee('ส่งงานแล้ว', null), true);
    assert.equal(L.needsFee('ตกลงแล้ว', 500), false);
    assert.equal(L.needsFee('ตกลงแล้ว', '1,200'), false);
    // กำลังคุย (ทาบทาม) บันทึกได้โดยไม่มีค่าตัว
    assert.equal(L.needsFee('ทาบทาม', 0), false);
    assert.equal(L.needsFee('ทาบทาม', ''), false);
    assert.equal(L.needsFee('', 0), false);
    assert.match(L.NEED_FEE_MSG, /ค่าตัว/);
});

test('jobStatusLabel: Draft กับ Active ใช้ป้ายเดียวกัน · ค่าแปลก/ว่าง ถือเป็นกำลังทำ', () => {
    assert.equal(L.jobStatusLabel('Draft'), 'กำลังทำ');
    assert.equal(L.jobStatusLabel('Active'), 'กำลังทำ');
    assert.equal(L.jobStatusLabel('Completed'), 'จบแล้ว');
    assert.equal(L.jobStatusLabel('Cancelled'), 'ยกเลิก');
    assert.equal(L.jobStatusLabel(undefined), 'กำลังทำ');
    assert.equal(L.jobStatusLabel('Weird'), 'กำลังทำ');
});

test('jobStatusValue: งาน Draft / ไม่มีสถานะ เลือกค้างที่ Active ในช่องเลือก · ที่เหลือคงค่าเดิม', () => {
    assert.equal(L.jobStatusValue('Draft'), 'Active');
    assert.equal(L.jobStatusValue(null), 'Active');
    assert.equal(L.jobStatusValue(''), 'Active');
    assert.equal(L.jobStatusValue('Active'), 'Active');
    assert.equal(L.jobStatusValue('Completed'), 'Completed');
    assert.equal(L.jobStatusValue('Cancelled'), 'Cancelled');
    // ตัวเลือกไม่มี Draft และทุกค่าที่ jobStatusValue คืนต้องอยู่ในตัวเลือก (ไม่งั้น select ว่าง)
    assert.deepEqual(L.JOB_STATUS_OPTIONS, ['Active', 'Completed', 'Cancelled']);
    for (const v of ['Draft', 'Active', 'Completed', 'Cancelled', null]) {
        assert.ok(L.JOB_STATUS_OPTIONS.includes(L.jobStatusValue(v)), String(v));
    }
});

test('hireStatusLabel: ทาบทาม → กำลังคุย · เสนอชื่อแล้ว → ส่งชื่อมาแล้ว · ค่าอื่นผ่านตรง', () => {
    assert.equal(L.hireStatusLabel('ทาบทาม'), 'กำลังคุย');
    assert.equal(L.hireStatusLabel('ตกลงแล้ว'), 'ตกลงแล้ว');
    assert.equal(L.hireStatusLabel('ถ่ายเสร็จ'), 'ถ่ายเสร็จ');
    assert.equal(L.hireStatusLabel('ส่งงานแล้ว'), 'ส่งงานแล้ว');
    assert.equal(L.hireStatusLabel('กำลังหา'), 'กำลังหา');
    assert.equal(L.hireStatusLabel('เสนอชื่อแล้ว'), 'ส่งชื่อมาแล้ว');
    assert.equal(L.hireStatusLabel('อะไรก็ได้'), 'อะไรก็ได้');
    assert.equal(L.hireStatusLabel(null), '');
    assert.equal(L.hireStatusLabel(undefined), '');
});

test('STAGE_LABEL กับ BOOKING_LABEL ต้องเป็นข้อความเดียวกัน (ชิปกรองในหน้างานเทียบเป็นข้อความ)', () => {
    assert.equal(L.STAGE_LABEL.booking, L.BOOKING_LABEL.pending);
    assert.equal(L.STAGE_LABEL.fee, L.BOOKING_LABEL.fee_review);
    for (const k of ['unassigned', 'finding', 'deciding', 'booking', 'fee', 'full', 'closed']) {
        assert.ok(L.STAGE_LABEL[k], k);
    }
    // ค่าในฐานของชื่อที่เสนอยังเป็นคำเดิม ครบทั้งสามค่า
    assert.deepEqual(Object.keys(L.CAND_LABEL).sort(), ['ไม่เอา', 'เลือกแล้ว', 'เสนอ'].sort());
    assert.equal(L.CAND_LABEL['เสนอ'], 'รอเลือก');
    assert.ok(Array.isArray(L.REJECT_REASONS) && L.REJECT_REASONS.length > 0);
    for (const r of L.REJECT_REASONS) assert.ok(typeof r === 'string' && r.trim() === r && r.length > 0);
});

test('ป้ายที่โชว์ไม่มีคำเก่าหลุดกลับมา', () => {
    const OLD = ['ใบขอจัดหา', 'คอนเฟิร์ม', 'อนุมัติ', 'ไม่ผ่าน', 'ตัวสำรอง', 'ดึงกลับ', 'เสร็จสิ้น', 'ทาบทาม', 'ถอนตัว', 'มอบหมาย', 'ผู้รับผิดชอบ', 'ช่องทางติดต่อ', 'โน้ต'];
    const shown = [
        ...Object.values(L.T), ...Object.values(L.JOB_STATUS_LABEL), ...Object.values(L.HIRE_STATUS_LABEL),
        ...Object.values(L.STAGE_LABEL), ...Object.values(L.BOOKING_LABEL), ...Object.values(L.CAND_LABEL),
        ...L.REJECT_REASONS, L.NEED_FEE_MSG
    ];
    for (const s of shown) for (const w of OLD) assert.ok(!s.includes(w), `"${s}" มีคำเก่า "${w}"`);
    // "คนหา" (คำเก่า) ต้องไม่อยู่ในป้าย — "คนช่วยหา" ไม่นับ
    for (const s of shown) assert.ok(!/คนหา/.test(s), s);
});

test('requestLink / parseOpen: รูปแบบลิงก์เดิม (tab=requests&open=pid~key) และอ่านกลับได้ตรง', () => {
    const link = L.requestLink('https://talent.example.com', 42, 'hab12cd');
    assert.equal(link, 'https://talent.example.com/hires?tab=requests&open=42~hab12cd');
    const u = new URL(link);
    assert.equal(u.pathname, '/hires');
    assert.equal(u.searchParams.get('tab'), 'requests');
    assert.deepEqual(L.parseOpen(u.searchParams.get('open')), { project_id: '42', key: 'hab12cd' });
    // ลิงก์เสีย / ครึ่งเดียว = null (ไม่เปิดอะไร)
    assert.equal(L.parseOpen(''), null);
    assert.equal(L.parseOpen(null), null);
    assert.equal(L.parseOpen('42'), null);
    assert.equal(L.parseOpen('42~'), null);
    assert.equal(L.parseOpen('~hab12cd'), null);
});

test('baht / feeDiff: ส่วนต่างพร้อมเปอร์เซ็นต์ · ของเดิม 0 ไม่มีเปอร์เซ็นต์ · ลดลงใช้เครื่องหมายลบ', () => {
    assert.equal(L.baht(1500), '฿1,500');
    assert.equal(L.baht(null), '฿0');
    assert.deepEqual(L.feeDiff(5000, 6500), { diff: 1500, pct: 30, text: '+฿1,500 / +30%' });
    assert.deepEqual(L.feeDiff(0, 1000), { diff: 1000, pct: null, text: '+฿1,000' });
    assert.deepEqual(L.feeDiff(2000, 1500), { diff: -500, pct: -25, text: '−฿500 / −25%' });
    assert.deepEqual(L.feeDiff('3000', '3000'), { diff: 0, pct: 0, text: '+฿0 / +0%' });
});

test('timeAgo: ใช้เวลาที่ส่งเข้ามา (ผลคงที่) · ค่าเสีย = ว่าง · อนาคตถือเป็นเมื่อสักครู่', () => {
    const ago = sec => new Date(NOW - sec * 1000).toISOString();
    assert.equal(L.timeAgo(ago(30), NOW), 'เมื่อสักครู่');
    assert.equal(L.timeAgo(ago(5 * 60), NOW), '5 นาทีก่อน');
    assert.equal(L.timeAgo(ago(2 * 3600), NOW), '2 ชม.ก่อน');
    assert.equal(L.timeAgo(ago(3 * 86400), NOW), '3 วันก่อน');
    assert.equal(L.timeAgo(new Date(NOW + 3600 * 1000).toISOString(), NOW), 'เมื่อสักครู่');
    assert.equal(L.timeAgo(null, NOW), '');
    assert.equal(L.timeAgo('ไม่ใช่วันที่', NOW), '');
});

test('todayTH: ตัดวันตามเวลาไทย (UTC+7) ไม่ใช่ UTC', () => {
    assert.equal(L.todayTH(NOW), '2026-09-18');
    // 16:59 UTC = 23:59 ไทย ยังเป็นวันเดิม · 17:00 UTC = เที่ยงคืนไทย ขึ้นวันใหม่
    assert.equal(L.todayTH(Date.UTC(2026, 8, 18, 16, 59)), '2026-09-18');
    assert.equal(L.todayTH(Date.UTC(2026, 8, 18, 17, 0)), '2026-09-19');
});

test('addDays: ข้ามเดือน / ข้ามปี / ปีอธิกสุรทิน / ถอยหลัง', () => {
    assert.equal(L.addDays('2026-09-18', 1), '2026-09-19');
    assert.equal(L.addDays('2026-09-18', 3), '2026-09-21');
    assert.equal(L.addDays('2026-09-18', 7), '2026-09-25');
    assert.equal(L.addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(L.addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(L.addDays(L.todayTH(NOW), 1), '2026-09-19');
});

test('daysLate: นับวันที่เลยกำหนดส่งรายชื่อตามวันไทย · ยังไม่ถึง/วันนี้/ไม่มีกำหนด = 0', () => {
    assert.equal(L.daysLate('2026-09-18', NOW), 0);
    assert.equal(L.daysLate('2026-09-25', NOW), 0);
    assert.equal(L.daysLate('2026-09-17', NOW), 1);
    assert.equal(L.daysLate('2026-09-11', NOW), 7);
    assert.equal(L.daysLate('2026-08-31', NOW), 18);
    assert.equal(L.daysLate(null, NOW), 0);
    assert.equal(L.daysLate('', NOW), 0);
    // หลังเที่ยงคืนไทย (ยังเป็นวันที่ 18 ตาม UTC) กำหนดวันที่ 18 ถือว่าเลยแล้ว 1 วัน
    assert.equal(L.daysLate('2026-09-18', Date.UTC(2026, 8, 18, 17, 30)), 1);
});
