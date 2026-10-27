const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// KOL ที่ได้มาฟรี / ไม่มีค่าตัว (27 ต.ค. 2026) — แคมเปญ KOL: ค่าตัว 0 + fee_free = ได้ฟรี ไม่ใช่ "ยังไม่ใส่ค่าตัว"
// กติกาเดียวกับ KOL รายคนที่ได้ฟรี · ชั้น logic + store (ฐานจำลอง)
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
after(() => pool.end());

const L = require(path.join(SRC, 'store/logic'));

test('กฎกลาง: ค่าตัว 0 + fee_free = ไม่ใช่ยังไม่ใส่ · CPM/CPE ไม่มีตัวเลขให้ตัดสิน (เหมือน KOL รายคนได้ฟรี) · ไม่ส่ง = แบบเดิม', () => {
    assert.equal(L.feeMissing(0, 'kol'), true);
    assert.equal(L.feeMissing(0, 'kol', true), false);
    assert.equal(L.feeMissing(0, 'kol', 'true'), true, 'ต้องเป็น boolean จริง');
    assert.equal(L.feeMissing(0, 'solo'), false);
    const free = L.clipCostMetrics({ fee: 0, adSpend: 500, views: 10000, engagement: 300, campaignType: 'kol', feeFree: true });
    assert.deepEqual(free, { fee_missing: false, fee_free: true, cost: 500, cpm: null, cpe: null });
    const missing = L.clipCostMetrics({ fee: 0, adSpend: 500, views: 10000, engagement: 300, campaignType: 'kol' });
    assert.equal(missing.fee_missing, true);
    assert.equal('fee_free' in missing, false, 'แคมเปญที่ไม่ได้ยืนยันฟรี ไม่มีคีย์ fee_free (แบบเดิม)');
    const paid = L.clipCostMetrics({ fee: 1000, adSpend: 0, views: 10000, engagement: 500, campaignType: 'kol', feeFree: true });
    assert.deepEqual([paid.fee_free, paid.cpm, paid.cpe], [false, 100, 2], 'ค่าตัว > 0 = คิดปกติ (ป้ายฟรีค้างไม่มีผล)');
    assert.equal(L.perfVerdict({ ...free, views: 10000 }), null, 'ได้ฟรี = ยังไม่ตัดสิน');
});

test('สแตมป์ผล: คลิปได้ฟรีไม่ล็อกผล และไม่ขึ้นว่า "รอค่าตัว" · คลิปที่ยังไม่ใส่ยังรอค่าตัวเหมือนเดิม · CPE รวมข้ามคลิปฟรี', () => {
    const base = { ad_spend: 5000, views: 20000, likes: 500, budget: 0 };
    assert.equal(L.stampWaitReason({ ...base }, 3000, 'kol'), 'fee');
    assert.equal(L.stampWaitReason({ ...base, fee_free: true }, 3000, 'kol'), null);
    const s = { ...base, fee_free: true };
    assert.equal(L.maybeStamp(s, 3000, 'kol'), null);
    assert.equal(s.perf_stamp, undefined, 'ไม่ล็อกผลค่าว่างค้างถาวร');
    const pooled = L.pooledCpe([{ fee: 0, engagement: 100, campaignType: 'kol', feeFree: true }, { fee: 1000, engagement: 500, campaignType: 'kol' }]);
    assert.deepEqual([pooled.cpe, pooled.clips], [2, 1]);
});

// ---- store: setFeeFree / setFees / updateOne บนฐานจำลอง ----
const base = require(path.join(SRC, 'store/pg/_base'));
let rows = new Map();
const writes = [];
const fakeClient = {
    async query(q, vals = []) {
        if (/^SELECT \* FROM submissions WHERE project_id = \$1 AND id = ANY\(\$2::int\[\]\) ORDER BY id FOR UPDATE/.test(q)) {
            return { rows: vals[1].filter(id => rows.has(id) && rows.get(id).project_id === vals[0]).sort((a, b) => a - b).map(id => structuredClone(rows.get(id))) };
        }
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: rows.has(vals[0]) ? [structuredClone(rows.get(vals[0]))] : [] };
        if (/FROM projects WHERE id = \$1/.test(q)) return { rows: [{ brand: 'Jernis', campaign_type: 'kol' }] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            const patch = Object.fromEntries(cols);
            const id = vals[vals.length - 1];
            writes.push({ id, ...patch });
            Object.assign(rows.get(id), patch);
            return { rows: [{ ...rows.get(id) }] };
        }
        throw new Error('unexpected SQL: ' + q.slice(0, 100));
    }
};
base.withTransaction = async fn => fn(fakeClient);
const subs = require(path.join(SRC, 'store/pg/submissions'));
const clip = (id, over = {}) => [id, { id, project_id: 9, person_key: 'pA', account_name: 'bbboleyn', clip_no: id - 100, status: 'confirmed', budget: 0, fee_free: false,
    ad_status: 'ยังไม่ยิง', ad_spend: 0, post_check: null, ...over }];

test('ยืนยันได้ฟรีทั้งคน: ค่าตัว 0 + fee_free ทุกคลิป · ค่าตัวเดิมที่ใส่ไว้กลายเป็น 0 · ยกเลิกฟรี = กลับเป็นยังไม่ใส่ · กดซ้ำไม่เขียน', async () => {
    rows = new Map([clip(101), clip(102, { budget: 1500 }), clip(103)]);
    writes.length = 0;
    let r = await subs.setFeeFree(9, [{ sub_id: 101, from: 0 }, { sub_id: 102, from: 1500 }, { sub_id: 103, from: 0 }], true, 'ฝน');
    assert.deepEqual([...rows.values()].map(x => [x.id, Number(x.budget), x.fee_free]), [[101, 0, true], [102, 0, true], [103, 0, true]]);
    assert.deepEqual(r.changed.map(c => [c.id, c.from]), [[101, 0], [102, 1500], [103, 0]]);
    writes.length = 0;
    r = await subs.setFeeFree(9, [{ sub_id: 101 }, { sub_id: 102 }, { sub_id: 103 }], true, 'ฝน');
    assert.equal(writes.length, 0, 'ฟรีอยู่แล้ว ไม่เขียนซ้ำ');
    assert.equal(r.changed.length, 0);
    r = await subs.setFeeFree(9, [{ sub_id: 101 }, { sub_id: 102 }], false, 'ฝน');
    assert.deepEqual([rows.get(101).fee_free, rows.get(102).fee_free, Number(rows.get(102).budget)], [false, false, 0]);
});

test('กันเขียนทับ: ค่าตัวในฐานไม่ตรงกับที่หน้าเว็บเห็น = 409 · คลิปนอกแคมเปญ = 400 · ฐานที่ยังไม่มีคอลัมน์ = 503', async () => {
    rows = new Map([clip(101, { budget: 2000 }), clip(102)]);
    await assert.rejects(subs.setFeeFree(9, [{ sub_id: 101, from: 0 }, { sub_id: 102, from: 0 }], true, 'ฝน'), e => e.status === 409);
    assert.equal(Number(rows.get(101).budget), 2000);
    await assert.rejects(subs.setFeeFree(9, [{ sub_id: 999 }], true, 'ฝน'), e => e.status === 400);
    await assert.rejects(subs.setFeeFree(9, [{ sub_id: 101 }], 'yes', 'ฝน'), e => e.status === 400);
    const old = clip(201)[1]; delete old.fee_free; rows = new Map([[201, old]]);
    await assert.rejects(subs.setFeeFree(9, [{ sub_id: 201 }], true, 'ฝน'), e => e.status === 503);
});

test('ใส่ค่าตัว > 0 ให้คนที่ได้ฟรี = ไม่ฟรีแล้วเอง · ค่าตัว 0 เท่าเดิมไม่แตะ · แก้ทางอื่น (ทีม/เอเจนซี่ PUT) ตั้ง fee_free ไม่ได้', async () => {
    rows = new Map([clip(101, { fee_free: true }), clip(102, { fee_free: true })]);
    await subs.setFees(9, [{ sub_id: 101, budget: 800, from: 0 }, { sub_id: 102, budget: 0, from: 0 }], 'ฝน');
    assert.deepEqual([Number(rows.get(101).budget), rows.get(101).fee_free], [800, false]);
    assert.equal(rows.get(102).fee_free, true, 'ค่าตัว 0 เท่าเดิม = ยังฟรี');
    rows = new Map([clip(301)]);
    writes.length = 0;
    await subs.update(301, 9, { fee_free: true, budget: 0, team_note: 'x' }, 'ฝน', { actor: 'team' });
    assert.equal('fee_free' in writes[0], false);
    assert.equal(rows.get(301).fee_free, false);
});

test('หาร / ล้างค่าตัวจากหน้าเว็บที่เปิดค้าง (ยังไม่เห็นว่าฟรี) ทับคนที่ได้ฟรีไม่ได้ = 409 · พิมพ์ค่าตัวเองที่ช่องของคนนั้นได้ (ผลรีวิว)', async () => {
    rows = new Map([clip(101, { fee_free: true }), clip(102)]);
    await assert.rejects(subs.setFees(9, [{ sub_id: 101, budget: 2500, from: 0 }, { sub_id: 102, budget: 2500, from: 0 }], 'ฝน', { protectFree: true }), e => e.status === 409);
    assert.deepEqual([Number(rows.get(101).budget), rows.get(101).fee_free, Number(rows.get(102).budget)], [0, true, 0], 'ไม่เขียนอะไรเลย');
    await subs.setFees(9, [{ sub_id: 101, budget: 900, from: 0 }], 'ฝน');
    assert.deepEqual([Number(rows.get(101).budget), rows.get(101).fee_free], [900, false]);
});

test('หน้าเว็บ: หารค่าตัว — คนจ้างเองที่ได้ฟรีไม่นับว่า "ยังไม่ใส่"', async () => {
    const F = await import(pathToFileURL(path.join(__dirname, '../client/src/data/feeSplit.js')).href);
    const rows = [
        { id: 1, person_key: 'own1', budget: 0, fee_free: true },             // จ้างเอง ได้ฟรี
        { id: 2, person_key: 'own2', budget: 0 },                             // จ้างเอง ยังไม่ใส่
        { id: 3, person_key: 'ag1', budget: 0, agency_token: 't' }
    ];
    const plan = F.splitPlan({ budget: 10000, quota: 5, clips: 1, rows });
    assert.equal(plan.ownMissing, 1);
});
