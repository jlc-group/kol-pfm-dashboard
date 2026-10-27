const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// คนตรวจคลิป (27 ต.ค. 2026) — ชั้น store บนฐานจำลอง: ใครตัดสินดราฟ (draft_checked_*) · คนตรวจทั้งแคมเปญ/กลุ่ม (review_assign) · รายคลิป (reviewer_id)
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
after(() => pool.end());

const base = require(path.join(SRC, 'store/pg/_base'));
let current = null, project = null, subsInProject = [];
const writes = [], sqls = [];
const fakeClient = {
    async query(q, vals = []) {
        sqls.push(q);
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: current ? [structuredClone(current)] : [] };
        if (/^UPDATE submissions SET "?\w+"? = \$1/.test(q) && !/reviewer_id = \$1 WHERE project_id/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            writes.push(Object.fromEntries(cols));
            return { rows: [{ ...current, ...Object.fromEntries(cols) }] };
        }
        if (/FROM projects WHERE id = \$1$/.test(q) && /brand, campaign_type/.test(q)) return { rows: [{ brand: 'Jernis', campaign_type: 'kol' }] };
        if (/^SELECT review_assign FROM projects WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: project ? [{ review_assign: structuredClone(project.review_assign) }] : [] };
        if (/^UPDATE projects SET review_assign = \$1 WHERE id = \$2/.test(q)) { project.review_assign = JSON.parse(vals[0]); return { rows: [] }; }
        if (/^SELECT id FROM submissions WHERE project_id = \$1 AND id = ANY/.test(q)) return { rows: vals[1].filter(id => subsInProject.includes(id)).map(id => ({ id })) };
        if (/^UPDATE submissions SET reviewer_id = \$1 WHERE project_id = \$2 AND id = ANY/.test(q)) {
            writes.push({ reviewer_id: vals[0], ids: vals[2] });
            return { rows: vals[2].map(id => ({ id, reviewer_id: vals[0], account_name: 'kol' + id })) };
        }
        throw new Error('unexpected SQL: ' + q.slice(0, 100));
    }
};
base.withTransaction = async fn => fn(fakeClient);
base.query = async () => ({ rows: [] });
const subs = require(path.join(SRC, 'store/pg/submissions'));
const { projects } = require(path.join(SRC, 'store/pg/projects'));

const row = over => ({ id: 5, project_id: 9, platform: 'TikTok', draft_link: 'https://d/1', draft_status: null, approved: false, status: 'confirmed',
    ad_status: 'ยังไม่ยิง', ad_spend: 0, post_check: null, draft_checked_by_id: null, draft_checked_by: null, draft_checked_at: null, ...over });

test('ทีมกด Approve / ขอแก้ไข = จดว่าใครตรวจ (id + ชื่อ + เวลา) · บันทึกผลเดิมซ้ำ / เอเจนซี่ล้างผล / ฐานที่ยังไม่มีคอลัมน์ = ไม่จด', async () => {
    current = row(); writes.length = 0;
    await subs.update(5, 9, { draft_status: 'approve', approved: true }, 'แนน', { actor: 'team', actorId: 12 });
    assert.equal(writes[0].draft_checked_by_id, 12);
    assert.equal(writes[0].draft_checked_by, 'แนน');
    assert.ok(writes[0].draft_checked_at);
    // ผลเดิมซ้ำ (แก้แค่ Feedback) = ไม่ขยับคนตรวจ
    current = row({ draft_status: 'approve', draft_checked_by_id: 12, draft_checked_by: 'แนน' }); writes.length = 0;
    await subs.update(5, 9, { draft_status: 'approve', feedback: 'ok' }, 'ฝน', { actor: 'team', actorId: 13 });
    assert.equal('draft_checked_by_id' in writes[0], false);
    // เปลี่ยนเป็นขอแก้ไขโดยอีกคน = จดคนใหม่
    current = row({ draft_status: 'approve', draft_checked_by_id: 12 }); writes.length = 0;
    await subs.update(5, 9, { draft_status: 'revise' }, 'ฝน', { actor: 'team', actorId: 13 });
    assert.equal(writes[0].draft_checked_by_id, 13);
    // เอเจนซี่ส่งดราฟใหม่ (ล้างผล) = ไม่จด
    current = row({ draft_status: 'revise' }); writes.length = 0;
    await subs.update(5, 9, { draft_status: null, draft_link2: 'https://d/2' }, 'เอเจนซี่ A (เอเจนซี่)', { actor: 'agency' });
    assert.equal('draft_checked_by_id' in writes[0], false);
    // ฐานที่ยังไม่ได้ setup-db (ไม่มีคอลัมน์) = ไม่เขียนคอลัมน์ที่ไม่มี
    const old = row(); delete old.draft_checked_by_id; delete old.draft_checked_by; delete old.draft_checked_at;
    current = old; writes.length = 0;
    await subs.update(5, 9, { draft_status: 'approve' }, 'แนน', { actor: 'team', actorId: 12 });
    assert.equal('draft_checked_by' in writes[0], false);
});

test('คนตรวจทั้งแคมเปญ / รายกลุ่ม: ส่งเฉพาะส่วนที่เปลี่ยน · null = ล้าง · ไม่แตะ updated_at', async () => {
    project = { review_assign: { default: 7, groups: { g1: 3 } } };
    let r = await projects.setReviewAssign(9, { groups: { g2: 4 } });
    assert.deepEqual(r, { default: 7, groups: { g1: 3, g2: 4 } });
    r = await projects.setReviewAssign(9, { default: null, groups: { g1: null } });
    assert.deepEqual(r, { default: null, groups: { g2: 4 } });
    assert.deepEqual(project.review_assign, { default: null, groups: { g2: 4 } });
    assert.equal(sqls.some(q => /UPDATE projects SET review_assign[^;]*updated_at/.test(q)), false);
    project = null;
    assert.equal(await projects.setReviewAssign(404, { default: 1 }), null);
    assert.equal(await projects.setReviewAssign('abc', { default: 1 }), null);
});

test('คนตรวจรายคลิป: เขียนเฉพาะ reviewer_id ของคลิปในแคมเปญนี้ · มีคลิปนอกแคมเปญ / id เพี้ยน / ซ้ำ = 400', async () => {
    subsInProject = [5, 6];
    writes.length = 0;
    const rows = await subs.setReviewer(9, [5, 6], 12);
    assert.deepEqual(rows.map(x => [x.id, x.reviewer_id]), [[5, 12], [6, 12]]);
    assert.deepEqual(writes[0], { reviewer_id: 12, ids: [5, 6] });
    await subs.setReviewer(9, [5], null);
    assert.equal(writes[1].reviewer_id, null, 'null = กลับไปตามกลุ่ม / แคมเปญ');
    await assert.rejects(subs.setReviewer(9, [5, 99], 12), e => e.status === 400);
    await assert.rejects(subs.setReviewer(9, [5, 5], 12), e => e.status === 400);
    await assert.rejects(subs.setReviewer(9, [], 12), e => e.status === 400);
    await assert.rejects(subs.setReviewer(9, ['x'], 12), e => e.status === 400);
});
