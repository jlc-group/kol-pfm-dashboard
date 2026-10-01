const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// งานที่จ้างของคนใน Talent Book + วางรูป (Ctrl+V) — ตรรกะฝั่งหน้าเว็บ (client/src/data/talentJobs.js) · ผู้ใช้สั่ง 1 ต.ค. 2026
// การ์ดโชว์ "จ้างแล้ว N งาน" · หน้ารายละเอียดเรียงงานใหม่สุดก่อน โชว์เดือน/ปี · ฟอร์มงานตรวจก่อนส่งแบบเดียวกับ server
let J;
before(async () => {
    J = await import(pathToFileURL(path.join(__dirname, '../client/src/data/talentJobs.js')).href);
});

test('monthYear / validYmd: วันที่จ้าง → "ต.ค. 2026" · วันที่ไม่มีจริงไม่ผ่าน', () => {
    assert.equal(J.monthYear('2026-10-05'), 'ต.ค. 2026');
    assert.equal(J.monthYear('2026-01-31'), 'ม.ค. 2026');
    assert.equal(J.monthYear('2025-12'), 'ธ.ค. 2025');
    for (const bad of ['', null, undefined, '2026-13-01', '2026-00-10', 'ต.ค. 2026', 20261005]) assert.equal(J.monthYear(bad), '', String(bad));
    assert.equal(J.validYmd('2026-10-05'), true);
    assert.equal(J.validYmd('2028-02-29'), true, 'ปีอธิกสุรทิน');
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-5', '05/10/2026', '1999-12-31', '2101-01-01', '', null]) {
        assert.equal(J.validYmd(bad), false, String(bad));
    }
});

test('sortJobs: ใหม่สุดก่อน (วันที่จ้าง → วันเดียวกันงานที่เพิ่มทีหลัง) · ไม่แก้ array เดิม · ข้อมูลเสียข้ามไป', () => {
    const list = [
        { id: 1, hired_on: '2026-08-01' }, { id: 4, hired_on: '2026-10-05' }, null,
        { id: 2, hired_on: '2026-10-05' }, { id: 3, hired_on: '2025-12-20' }, 'x'
    ];
    const copy = list.slice();
    assert.deepEqual(J.sortJobs(list).map(j => j.id), [4, 2, 1, 3]);
    assert.deepEqual(list, copy);
    assert.deepEqual(J.sortJobs(null), []);
});

test('jobsCountOf: ตัวเลข "จ้างแล้ว N งาน" จาก talent.jobs_count (หรือ jobs_count ของการ์ด)', () => {
    assert.equal(J.jobsCountOf({ talent: { jobs_count: 3 } }), 3);
    assert.equal(J.jobsCountOf({ jobs_count: '2' }), 2);
    assert.equal(J.jobsCountOf({ talent: { jobs_count: 0 }, jobs_count: 5 }), 0, 'ของคนที่เพิ่มเองมาก่อน');
    for (const c of [null, {}, { talent: null }, { talent: { jobs_count: -1 } }, { talent: { jobs_count: 'abc' } }]) {
        assert.equal(J.jobsCountOf(c), 0, JSON.stringify(c));
    }
    // jobs ของการ์ดจากงานเก่า (จำนวนงาน Talent เดิม) ไม่ใช่งานที่จ้าง
    assert.equal(J.jobsCountOf({ jobs: 4 }), 0);
});

test('jobErrors: แบรนด์ + วันที่จ้างบังคับ · ค่าตัว ≥ 0 · ลิงก์ http/https · ความยาว', () => {
    const ok = { brand: 'Jdent', hired_on: '2026-10-05', fee: '', scope: '', work_link: '', note: '' };
    assert.deepEqual(J.jobErrors(ok, ['Jdent']), {});
    assert.deepEqual(J.jobErrors({ ...ok, fee: '15,000.50', work_link: 'https://www.tiktok.com/@a/video/1' }), {});
    assert.deepEqual(J.jobErrors({ ...ok, fee: '0' }), {}, 'ค่าตัว 0 = ได้ฟรี');
    const e = J.jobErrors({ brand: '', hired_on: '', fee: '-5', work_link: 'javascript:alert(1)', scope: 'x'.repeat(2001), note: 'y'.repeat(1001) });
    assert.deepEqual(Object.keys(e).sort(), ['brand', 'fee', 'hired_on', 'note', 'scope', 'work_link']);
    assert.match(e.brand, /แบรนด์/);
    assert.match(e.hired_on, /วันที่/);
    assert.match(e.work_link, /http/);
    assert.match(J.jobErrors({ ...ok, brand: 'Beauterry' }, ['Jdent']).brand, /ดูแล/, 'แบรนด์ที่ไม่มีสิทธิ์');
    assert.match(J.jobErrors({ ...ok, hired_on: '2026-02-30' }).hired_on, /ไม่ถูกต้อง/);
    for (const fee of ['abc', ',', '1e10', '2000000000']) assert.ok(J.jobErrors({ ...ok, fee }).fee, fee);
    assert.ok(J.jobErrors({ ...ok, work_link: 'drive.google.com/x' }).work_link, 'โดเมนทั่วไปต้องมี https://');
});

test('jobBody / jobForm: ค่าที่ส่ง server · ค่าตัวว่าง = null · โหลดกลับมาแก้ได้ครบ', () => {
    assert.deepEqual(J.jobBody({ brand: ' Jdent ', hired_on: '2026-10-05', fee: '15,000.555', scope: ' ถ่าย 1 วัน ', work_link: 'tiktok.com/@a/video/1', note: '' }), {
        brand: 'Jdent', hired_on: '2026-10-05', fee: 15000.56, scope: 'ถ่าย 1 วัน', work_link: 'https://tiktok.com/@a/video/1', note: ''
    });
    assert.equal(J.jobBody({ ...J.JOB_EMPTY, fee: '' }).fee, null);
    assert.equal(J.jobBody({ ...J.JOB_EMPTY, fee: '0' }).fee, 0);
    const saved = { id: 9, brand: 'Jdent', hired_on: '2026-10-05', fee: 0, scope: null, work_link: 'https://x.com/a', note: 'ดี', added_by: 'แพรว' };
    const f = J.jobForm(saved);
    assert.deepEqual(f, { brand: 'Jdent', hired_on: '2026-10-05', fee: '0', scope: '', work_link: 'https://x.com/a', note: 'ดี' });
    assert.deepEqual(J.jobErrors(f, ['Jdent']), {});
    assert.equal(J.jobForm({ fee: null }).fee, '');
    assert.equal(J.jobForm(null).brand, '');
});

test('วางรูป (Ctrl+V): หารูปในคลิปบอร์ด · ตั้งชื่อไฟล์ตามชนิด · ชนิดที่ server ไม่รับ = ไม่ตั้งชื่อ', () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' });
    assert.equal(J.clipboardImage({ files: [png], items: [] }), png);
    // บางเบราว์เซอร์ให้มาแค่ items
    const viaItem = J.clipboardImage({ files: [], items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/jpeg', getAsFile: () => png }] });
    assert.equal(viaItem, png);
    assert.equal(J.clipboardImage({ files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }), null, 'ข้อความ = วางตามปกติ');
    assert.equal(J.clipboardImage({ files: [new File(['x'], 'a.txt', { type: 'text/plain' })] }), null);
    assert.equal(J.clipboardImage(null), null);
    const at = new Date(2026, 9, 1, 9, 5, 7);
    assert.equal(J.pasteFileName('image/png', at), 'pasted-20261001-090507.png');
    assert.equal(J.pasteFileName('image/jpeg', at), 'pasted-20261001-090507.jpg');
    assert.equal(J.pasteFileName('IMAGE/WEBP', at), 'pasted-20261001-090507.webp');
    for (const t of ['image/gif', 'image/bmp', 'image/svg+xml', '', undefined]) assert.equal(J.pasteFileName(t, at), '', String(t));
    // นามสกุลที่ได้ต้องอยู่ในชุดที่เส้นอัปรูปของ Talent Book รับ (.png / .jpg / .jpeg / .webp / .pdf)
    for (const ext of Object.values(J.PASTE_TYPES)) assert.ok(['.png', '.jpg', '.jpeg', '.webp'].includes(ext), ext);
});
