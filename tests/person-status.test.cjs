const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// เลือก / ไม่เลือก / คืนสถานะ "ทั้งคน" ทีเดียว (ผู้ใช้สั่ง 27 ต.ค. 2026 — คนทำ 10 คลิปเดิมต้องกดชื่อเดิม 10 รอบ)
// ชั้น store บนฐานจำลอง: เปลี่ยนทุกคลิปของคนนี้ที่อยู่สถานะเดียวกับที่หน้าเว็บเห็น · คลิปสถานะอื่นไม่แตะ · ล็อกเรียง id
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
after(() => pool.end());

const base = require(path.join(SRC, 'store/pg/_base'));
let rows = new Map();
const sqls = [];
const fakeClient = {
    async query(q, vals = []) {
        sqls.push(q);
        if (/^SELECT id, person_key FROM submissions WHERE id = \$1 AND project_id = \$2$/.test(q)) {
            const r = rows.get(vals[0]);
            return { rows: r && r.project_id === vals[1] ? [{ id: r.id, person_key: r.person_key }] : [] };
        }
        if (/^SELECT id, status FROM submissions WHERE person_key = \$1 AND project_id = \$2 ORDER BY id FOR UPDATE$/.test(q)) {
            return { rows: [...rows.values()].filter(r => r.person_key === vals[0] && r.project_id === vals[1]).sort((a, b) => a.id - b.id).map(r => ({ id: r.id, status: r.status })) };
        }
        if (/^SELECT id, status FROM submissions WHERE id = \$1 AND project_id = \$2 FOR UPDATE$/.test(q)) {
            const r = rows.get(vals[0]);
            return { rows: r ? [{ id: r.id, status: r.status }] : [] };
        }
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: rows.has(vals[0]) ? [structuredClone(rows.get(vals[0]))] : [] };
        if (/FROM projects WHERE id = \$1/.test(q)) return { rows: [{ brand: 'Jernis', campaign_type: 'kol' }] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            const patch = Object.fromEntries(cols);
            const id = vals[vals.length - 1];
            const r = rows.get(id);
            Object.assign(r, patch);
            return { rows: [{ ...r }] };
        }
        throw new Error('unexpected SQL: ' + q.slice(0, 100));
    }
};
base.withTransaction = async fn => fn(fakeClient);
const subs = require(path.join(SRC, 'store/pg/submissions'));

const clip = (id, status, over = {}) => [id, { id, project_id: 9, person_key: 'pA', clip_no: id - 100, account_name: 'reviewafter6pm', status, ad_status: 'ยังไม่ยิง', ad_spend: 0, post_check: null, ...over }];

test('เลือกทั้งคน: ทุกคลิปที่ยังรอคัดเลือก → คัดเลือก ในคำขอเดียว · คลิปที่ไม่เลือกไปแล้วไม่แตะ · ลงเวลา/คนตัดสิน · ล็อกเรียง id', async () => {
    rows = new Map([clip(103, 'submitted'), clip(101, 'submitted'), clip(102, 'rejected'), clip(104, 'submitted'), clip(105, 'confirmed'),
        [201, { id: 201, project_id: 9, person_key: 'pB', status: 'submitted', account_name: 'อีกคน' }]]);
    sqls.length = 0;
    const out = await subs.setPersonStatus(103, 9, 'confirmed', 'submitted', 'ฝน', { actor: 'team' });
    assert.deepEqual(out.map(r => r.id), [101, 103, 104]);
    assert.deepEqual([...rows.values()].filter(r => r.person_key === 'pA').sort((a, b) => a.id - b.id).map(r => [r.id, r.status]),
        [[101, 'confirmed'], [102, 'rejected'], [103, 'confirmed'], [104, 'confirmed'], [105, 'confirmed']]);
    assert.equal(rows.get(201).status, 'submitted', 'คนอื่นไม่โดน');
    assert.equal(rows.get(101).decided_by, 'ฝน');
    assert.ok(rows.get(101).decided_at);
    assert.ok(sqls.some(q => /person_key = \$1 AND project_id = \$2 ORDER BY id FOR UPDATE/.test(q)), 'ล็อกทุกคลิปเรียง id');
});

test('ยกเลิก / คืนกลับทั้งคน · ไม่มีคลิปในสถานะที่หน้าเว็บเห็นแล้ว (มีคนกดไปก่อน) = 409 ไม่เขียน · ไม่พบ = null · แถวเก่าที่ไม่มี person_key = คลิปเดียว', async () => {
    rows = new Map([clip(101, 'confirmed'), clip(102, 'confirmed'), clip(103, 'rejected')]);
    let out = await subs.setPersonStatus(101, 9, 'submitted', 'confirmed', 'ฝน', { actor: 'team' });
    assert.deepEqual(out.map(r => r.id), [101, 102]);
    assert.equal(rows.get(103).status, 'rejected');
    out = await subs.setPersonStatus(103, 9, 'submitted', 'rejected', 'ฝน', { actor: 'team' });
    assert.deepEqual(out.map(r => r.id), [103]);
    await assert.rejects(subs.setPersonStatus(101, 9, 'confirmed', 'rejected', 'ฝน', { actor: 'team' }), e => e.status === 409);
    assert.equal(await subs.setPersonStatus(999, 9, 'confirmed', 'submitted', 'ฝน'), null);
    assert.equal(await subs.setPersonStatus(101, 8, 'confirmed', 'submitted', 'ฝน'), null, 'คนละแคมเปญ');
    assert.equal(await subs.setPersonStatus('x', 9, 'confirmed', 'submitted', 'ฝน'), null);
    rows = new Map([[301, { id: 301, project_id: 9, person_key: null, status: 'submitted', account_name: 'เก่า' }]]);
    out = await subs.setPersonStatus(301, 9, 'confirmed', 'submitted', 'ฝน', { actor: 'team' });
    assert.deepEqual(out.map(r => [r.id, r.status]), [[301, 'confirmed']]);
});
