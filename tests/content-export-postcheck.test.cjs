const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ฟีด content-candidates ไม่ส่งคลิปที่ข้อมูลโพสต์ยังรอทีมตรวจ (ผู้ใช้สั่ง 12 พ.ย. 2026 "ทำเลย")
// ที่มา: คลิป Beauterry ที่เอเจนซี่เพิ่งส่งลิงก์ (ยังไม่กดยืนยันถูกต้อง) ถูกระบบยิงแอดดึงไปยิง แล้ว PFM ซิงก์กลับมาเป็น "ยิงแล้ว"
// กติกาเดียวกับหน้า Ads (logic.js postCheckWaiting = pending / returned) · ยืนยันแล้วต้องถูกส่งให้ระบบที่ดึงแบบ updated_since ด้วย
// ตรวจคำสั่ง SQL ที่ส่งไปฐาน (ฐานจำลอง ไม่แตะฐานจริง) — ลองกับฐานจริงแบบอ่านอย่างเดียวแล้ว (scratchpad read-feed-postcheck.cjs)
const SRC = path.join(__dirname, '../server/src');
const base = require(path.join(SRC, 'store/pg/_base'));
const SQL = [];
let ROWS = [];
base.query = async (text, params) => {
    SQL.push({ text: String(text), params });
    if (/FROM catalog_products/.test(text)) return { rows: [] };
    return { rows: ROWS };
};
const { contentExport } = require(path.join(SRC, 'store/pg/contentExport'));
const logic = require(path.join(SRC, 'store/logic'));
beforeEach(() => { SQL.length = 0; ROWS = []; });
const feedSql = () => SQL.find(q => /FROM submissions s/.test(q.text));

test('ไม่ส่งคลิปที่รอตรวจโพสต์ (pending / returned) — ส่งรายการเดียวกับ postCheckWaiting ของหน้า Ads เป็นพารามิเตอร์', async () => {
    await contentExport.listCandidates({ brand: 'Beauterry', limit: 10 });
    const q = feedSql();
    assert.match(q.text, /\(s\.post_check IS NULL OR NOT \(s\.post_check = ANY\(\$4::text\[\]\)\)\)/);
    assert.deepEqual(q.params, ['Beauterry', 'ยังไม่ยิง', 10, ['pending', 'returned']]);
    assert.deepEqual(q.params[3], logic.POST_CHECK_WAITING);
    for (const s of ['pending', 'returned']) assert.equal(logic.postCheckWaiting({ post_check: s }), true);
    for (const s of [null, 'ok', 'changed']) assert.equal(logic.postCheckWaiting({ post_check: s }), false, 'ยืนยันแล้ว / แก้หลังยิง / ไม่มีการตรวจ = ส่งตามเดิม');
});

test('updated_since: นับเวลาตรวจโพสต์ด้วย — กดยืนยันทีหลังแล้วคลิปถูกส่งให้ระบบที่ดึงต่อจากรอบก่อน · ลำดับ / updated_at ใช้เวลาเดียวกัน', async () => {
    await contentExport.listCandidates({ brand: 'Jernis', limit: 5, updatedSince: '2026-11-10T00:00:00.000Z' });
    const q = feedSql();
    const changed = 'GREATEST(COALESCE(s.updated_at, s.submitted_at), s.post_check_at)';
    assert.ok(q.text.includes(`${changed} > $5`), 'ตัวกรอง updated_since');
    assert.ok(q.text.includes(`${changed} AS updated_at`), 'updated_at ที่ส่งออก (ระบบปลายทางใช้เป็นจุดเริ่มรอบหน้า)');
    assert.ok(q.text.includes(`ORDER BY BTRIM(s.id_post), ${changed} DESC`), 'แถวล่าสุดต่อ ID Post');
    assert.deepEqual(q.params, ['Jernis', 'ยังไม่ยิง', 5, ['pending', 'returned'], '2026-11-10T00:00:00.000Z']);
});

test('แถวที่ได้จากฐานส่งออกรูปเดิม (post_check / updated_at ตามที่ฐานคืน)', async () => {
    ROWS = [{ submission_id: 7, id_post: '7706496352397708564', gencode: 'G', brand: 'Beauterry', platform: 'TikTok', status: 'confirmed',
        ad_status: 'ยังไม่ยิง', post_check: 'ok', post_url: 'u', post_date: '2026-11-10', product: 'BTA2-01', group_key: null, ad_groups: [],
        updated_at: '2026-11-12T09:00:00.000Z' }];
    const [item] = await contentExport.listCandidates({ brand: 'Beauterry', limit: 10 });
    assert.equal(item.post_check, 'ok');
    assert.equal(item.updated_at, '2026-11-12T09:00:00.000Z');
    assert.equal(item.id_post, '7706496352397708564');
});
