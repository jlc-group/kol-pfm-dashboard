const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ทีมตรวจข้อมูลโพสต์ที่เอเจนซี่กรอก ก่อนขึ้นหน้า Ads — ตรรกะล้วน ไม่มีฐานข้อมูล
const { nextPostCheck, postCheckDecision, postCheckWaiting } = require(path.join(__dirname, '../server/src/store/logic.js'));

const AT = '2026-09-18T10:00:00.000Z';
const row = (over = {}) => ({
    post_url: 'https://www.tiktok.com/@a/video/111', post_date: '2026-09-10', gencode: 'G1', id_post: '111',
    code_expire: 60, ad_status: 'ยังไม่ยิง', post_check: null, post_check_note: null, post_check_changes: null, ...over
});

test('agency edits need a team check; team edits count as checked', () => {
    // เอเจนซี่กรอกครั้งแรก (ยังไม่มีข้อมูลโพสต์เลย) = รอตรวจ ไม่มีรายการ "แก้หลังยืนยัน"
    const first = nextPostCheck(row({ post_url: null, post_date: null, gencode: null, id_post: null }), row(), 'agency', 'เอ (เอเจนซี่)', AT);
    assert.deepEqual(first, { post_check: 'pending', post_check_by: 'เอ (เอเจนซี่)', post_check_at: AT, post_check_note: null, post_check_changes: null });
    // ทีมแก้เอง = ตรวจแล้ว และล้างเหตุผล/รายการแก้ที่ค้างอยู่
    const team = nextPostCheck(row({ post_check: 'returned', post_check_note: 'ID ผิด' }), row({ id_post: '222' }), 'team', 'นุ่น', AT);
    assert.deepEqual(team, { post_check: 'ok', post_check_by: 'นุ่น', post_check_at: AT, post_check_note: null, post_check_changes: null });
});

test('an agency edit after the team check records which fields changed, from → to', () => {
    const next = nextPostCheck(row({ post_check: 'ok' }), row({ id_post: '222', code_expire: '30' }), 'agency', 'เอ', AT);
    assert.equal(next.post_check, 'pending');
    assert.deepEqual(next.post_check_changes, { id_post: { from: '111', to: '222' }, code_expire: { from: '60', to: '30' } });
    // ข้อมูลเดิมก่อนมีฟีเจอร์ (post_check ว่าง) ถือเป็นค่าที่ผ่านแล้วเหมือนกัน
    assert.deepEqual(nextPostCheck(row(), row({ gencode: 'G2' }), 'agency', 'เอ', AT).post_check_changes, { gencode: { from: 'G1', to: 'G2' } });
});

test('repeated agency edits keep the original value and drop fields changed back', () => {
    const pending = row({ post_check: 'pending', id_post: '222', post_check_changes: { id_post: { from: '111', to: '222' } } });
    const more = nextPostCheck(pending, { ...pending, id_post: '333', gencode: 'G9' }, 'agency', 'เอ', AT);
    assert.deepEqual(more.post_check_changes, { id_post: { from: '111', to: '333' }, gencode: { from: 'G1', to: 'G9' } });
    // แก้ ID Post กลับเป็นค่าเดิม → เอาออกจากรายการ เหลือแค่ Gencode
    const back = nextPostCheck({ ...pending, ...more, id_post: '333', gencode: 'G9' }, { ...pending, ...more, id_post: '111', gencode: 'G9' }, 'agency', 'เอ', AT);
    assert.deepEqual(back.post_check_changes, { gencode: { from: 'G1', to: 'G9' } });
    // ส่งกลับให้แก้แล้วเอเจนซี่แก้ → กลับไปรอตรวจ เหตุผลของทีมยังอยู่ให้เทียบ
    const fixed = nextPostCheck(row({ post_check: 'returned', post_check_note: 'ID ไม่ตรงลิงก์' }), row({ id_post: '999' }), 'agency', 'เอ', AT);
    assert.equal(fixed.post_check, 'pending');
    assert.equal(fixed.post_check_note, 'ID ไม่ตรงลิงก์');
});

test('nothing changes when post fields stay the same or the editor is unknown', () => {
    assert.equal(nextPostCheck(row(), row({ code_expire: '60', gencode: ' G1 ' }), 'agency', 'เอ', AT), null);
    assert.equal(nextPostCheck(row(), row({ id_post: '2' }), undefined, 'เอ', AT), null);
    // ช่องที่ไม่ใช่ข้อมูลโพสต์ไม่เกี่ยว
    assert.equal(nextPostCheck(row(), row({ agency_note: 'x' }), 'agency', 'เอ', AT), null);
});

test('an agency edit after the ad went live is flagged but the row stays on the Ads page', () => {
    const live = row({ ad_status: 'ยิงแล้ว', post_check: 'ok' });
    const next = nextPostCheck(live, { ...live, post_date: '2026-09-11' }, 'agency', 'เอ', AT);
    assert.equal(next.post_check, 'changed');
    assert.equal(postCheckWaiting(next), false, 'แอดวิ่งอยู่ ไม่ดึงออกจากหน้า Ads');
    assert.deepEqual(next.post_check_changes, { post_date: { from: '2026-09-10', to: '2026-09-11' } });
    // แก้ต่อ = จดต่อจากค่าเดิม · แก้กลับเป็นค่าเดิมหมด = ล้างป้าย
    const flagged = { ...live, ...next, post_date: '2026-09-11' };
    const more = nextPostCheck(flagged, { ...flagged, code_expire: 30 }, 'agency', 'เอ', AT);
    assert.deepEqual(more.post_check_changes, { post_date: { from: '2026-09-10', to: '2026-09-11' }, code_expire: { from: '60', to: '30' } });
    const back = nextPostCheck({ ...flagged, ...more, code_expire: 30 }, { ...flagged, ...more, post_date: '2026-09-10', code_expire: 60 }, 'agency', 'เอ', AT);
    assert.equal(back.post_check, null);
    assert.equal(back.post_check_changes, null);
    // ทีมแก้เองหลังยิงแอด = ตรวจแล้ว
    assert.equal(nextPostCheck(flagged, { ...flagged, post_date: '2026-09-12' }, 'team', 'นุ่น', AT).post_check, 'ok');
});

test('an agency edit that leaves no link, Gencode or ID Post has nothing to check', () => {
    const empty = { post_url: null, post_date: null, gencode: null, id_post: null };
    // แจ้งแค่วันลงงาน ยังไม่มีโพสต์ = ไม่ต้องตรวจ (ยังไม่ขึ้นหน้า Ads อยู่แล้ว)
    assert.equal(nextPostCheck(row(empty), row({ ...empty, post_date: '2026-09-20' }), 'agency', 'เอ', AT), null);
    // ลบข้อมูลโพสต์ทิ้งหมดขณะรอตรวจ = ล้างสถานะ ไม่ค้าง "รอตรวจ" ทั้งที่ไม่มีอะไรให้ตรวจ
    const cleared = nextPostCheck(row({ post_check: 'pending', post_check_note: 'x' }), row({ ...empty, post_date: '2026-09-10' }), 'agency', 'เอ', AT);
    assert.deepEqual(cleared, { post_check: null, post_check_by: null, post_check_at: null, post_check_note: null, post_check_changes: null });
});

test('team decisions and the waiting helper', () => {
    assert.deepEqual(postCheckDecision('ok', null, 'นุ่น', AT),
        { post_check: 'ok', post_check_by: 'นุ่น', post_check_at: AT, post_check_note: null, post_check_changes: null });
    assert.deepEqual(postCheckDecision('return', 'ลิงก์เปิดไม่ได้', 'นุ่น', AT),
        { post_check: 'returned', post_check_by: 'นุ่น', post_check_at: AT, post_check_note: 'ลิงก์เปิดไม่ได้' });
    assert.equal(postCheckDecision('delete', null, 'x', AT), null);
    assert.equal(postCheckWaiting({ post_check: 'pending' }), true);
    assert.equal(postCheckWaiting({ post_check: 'returned' }), true);
    assert.equal(postCheckWaiting({ post_check: 'ok' }), false);
    assert.equal(postCheckWaiting({ post_check: 'changed' }), false);
    assert.equal(postCheckWaiting({ post_check: null }), false);
});
