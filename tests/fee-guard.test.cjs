const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ด่านกันค่าตัว KOL (submissions.budget) — รันโค้ดจริงของ server/src/store/pg/submissions.js
// ทางเดียวที่เขียนค่าตัวได้คือ setFees · update / updatePerson ส่ง budget มาก็ต้องไม่เขียน
//
// ไม่มีฐานข้อมูล: pool.connect คืน client ปลอมที่จด SQL ทุกคำสั่งไว้
// withTransaction ตัวจริง (BEGIN/COMMIT/ROLLBACK/release) จึงถูกรันด้วย
// ส่วนการต่อฐานจริงทุกทาง (pool.query / Pool / Client) โยน error ทันที ไม่ขึ้นกับค่าใน .env
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in fee-guard test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();

// ---------- ตาราง submissions ปลอม ----------
let rows, sql, released;

const row = fields => ({
    project_id: 41, person_key: null, clip_no: 1, account_name: 'น้องเอ', status: 'confirmed',
    budget: 5000, ad_status: 'ยังไม่ยิง', ad_spend: 0, ad_reach: 0,
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0, perf_stamp: null,
    post_url: null, gencode: null, id_post: null, post_date: null,
    team_note: null, list_updated_at: null, ...fields
});

function reset() {
    rows = new Map([
        // น้องเอ 2 คลิป (person_key เดียวกัน) ค่าตัวคลิปละ 5,000
        [5, row({ id: 5, person_key: 'p1', clip_no: 1 })],
        [6, row({ id: 6, person_key: 'p1', clip_no: 2 })],
        // น้องบี: ค่าแอดถึงเกณฑ์และมียอดวิวแล้ว รอค่าตัวอย่างเดียวก็สแตมป์ผลงานได้
        [7, row({ id: 7, person_key: 'p2', account_name: 'น้องบี', budget: 0, ad_spend: 12000, views: 100000, likes: 1000, comments: 100, saves: 50, shares: 50 })]
    ]);
    sql = [];
    released = 0;
}

// UPDATE submissions SET a = $1, b = $2 WHERE id = $3 RETURNING *  ->  { id, set: { a, b } }
function parseUpdate(text, params) {
    const m = text.match(/^UPDATE submissions SET (.+) WHERE id = \$(\d+) RETURNING \*$/);
    if (!m) throw new Error('fee-guard test: unexpected UPDATE shape ' + text);
    const set = {};
    m[1].split(', ').forEach(part => {
        const [col, ph] = part.split(' = ');
        set[col.replace(/"/g, '')] = params[Number(ph.slice(1)) - 1];
    });
    return { id: params[Number(m[2]) - 1], set };
}

const result = list => ({ rows: list.map(r => structuredClone(r)), rowCount: list.length });
const byId = (a, b) => a.id - b.id;

const fakeClient = {
    async query(text, params = []) {
        sql.push({ text, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return result([]);
        if (/^UPDATE\b/.test(text)) {
            const { id, set } = parseUpdate(text, params);
            const cur = rows.get(id);
            if (!cur) return result([]);
            Object.assign(cur, set);
            return result([cur]);
        }
        if (text === 'SELECT * FROM submissions WHERE id = $1 AND project_id = $2 FOR UPDATE'
            || text === 'SELECT * FROM submissions WHERE id = $1 AND project_id = $2') {
            const r = rows.get(params[0]);
            return result(r && r.project_id === params[1] ? [r] : []);
        }
        if (text === 'SELECT * FROM submissions WHERE id = $1') {
            return result(rows.has(params[0]) ? [rows.get(params[0])] : []);
        }
        if (text === 'SELECT * FROM submissions WHERE person_key = $1 AND project_id = $2 ORDER BY id') {
            return result([...rows.values()].filter(r => r.person_key === params[0] && r.project_id === params[1]).sort(byId));
        }
        if (text === 'SELECT * FROM submissions WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE') {
            return result([...rows.values()].filter(r => r.project_id === params[0] && params[1].includes(r.id)).sort(byId));
        }
        throw new Error('fee-guard test: unhandled SQL ' + text);
    },
    release() { released++; }
};
pool.connect = async () => fakeClient;

const submissions = require(path.join(SRC, 'store/pg/submissions'));
const updates = () => sql.filter(q => /^UPDATE\b/.test(q.text)).map(q => parseUpdate(q.text, q.params));

after(() => pool.end());

test('the real database is unreachable from this file', async () => {
    await assert.rejects(pool.query('SELECT 1'), /Unexpected real database/);
    await assert.rejects(new pg.Client().connect(), /Unexpected real database/);
});

test('update() saves other fields but never the budget column, and leaves the caller object alone', async () => {
    reset();
    const fields = { budget: 9999, team_note: 'x' };
    const out = await submissions.update(5, 41, fields, 'tester');
    assert.deepEqual(fields, { budget: 9999, team_note: 'x' });
    const ups = updates();
    assert.equal(ups.length, 1);
    assert.deepEqual(ups[0], { id: 5, set: { team_note: 'x' } });
    assert.equal(rows.get(5).budget, 5000);
    assert.equal(out.budget, 5000);
    assert.equal(out.team_note, 'x');
    // withTransaction ตัวจริง: ล็อกแถวก่อนแก้ แล้ว COMMIT และคืน client
    assert.deepEqual(sql.map(q => q.text.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    assert.match(sql[1].text, /FOR UPDATE$/);
    assert.deepEqual(sql[1].params, [5, 41]);
    assert.equal(released, 1);
});

test('a budget-only update() issues no UPDATE of budget at all', async () => {
    reset();
    for (const fields of [{ budget: 9999 }, { budget: '9999' }, { budget: 0 }, { budget: 9999, perf_stamp: { verdict: 'Pass' } }]) {
        const out = await submissions.update(5, 41, fields, 'tester');
        assert.equal(out.budget, 5000, JSON.stringify(fields));
    }
    // คลิปที่รอค่าตัวอยู่: ค่าตัวที่แอบส่งมาทางนี้ต้องไม่ถูกเขียน และต้องไม่พาสแตมป์ผลงานล็อกตามไปด้วย
    await submissions.update(7, 41, { budget: 3000 }, 'tester');
    assert.deepEqual(updates(), []);
    assert.equal(sql.some(q => /\bbudget\b/.test(q.text)), false);
    assert.equal(rows.get(5).budget, 5000);
    assert.equal(rows.get(7).budget, 0);
    assert.equal(rows.get(7).perf_stamp, null);
});

test('updatePerson() updates every sibling clip without budget', async () => {
    reset();
    const fields = { account_name: 'น้องเอ (ชื่อใหม่)', budget: 7000 };
    const head = await submissions.updatePerson(5, 41, fields, 'tester');
    assert.deepEqual(fields, { account_name: 'น้องเอ (ชื่อใหม่)', budget: 7000 });
    const ups = updates();
    assert.deepEqual(ups.map(u => u.id), [5, 6]);
    for (const u of ups) {
        assert.equal(u.set.account_name, 'น้องเอ (ชื่อใหม่)');
        assert.equal(typeof u.set.list_updated_at, 'string');
        assert.equal('budget' in u.set, false);
    }
    assert.equal(rows.get(5).budget, 5000);
    assert.equal(rows.get(6).budget, 5000);
    assert.equal(rows.get(7).account_name, 'น้องบี');
    assert.equal(head.id, 5);
    assert.equal(released, 1);
});

test('setFees() is the path that writes budget', async () => {
    reset();
    const out = await submissions.setFees(41, [
        { sub_id: 6, budget: 5000, from: 5000 },   // เท่าเดิม ไม่ต้องเขียน
        { sub_id: 5, budget: 7000, from: 5000 }
    ], 'tester');
    assert.deepEqual(updates(), [{ id: 5, set: { budget: 7000 } }]);
    assert.equal(rows.get(5).budget, 7000);
    assert.equal(rows.get(6).budget, 5000);
    assert.deepEqual(out.changed, [{ id: 5, account_name: 'น้องเอ', clip_no: 1, from: 5000, to: 7000 }]);
    assert.deepEqual(out.rows.map(r => [r.id, r.budget]), [[6, 5000], [5, 7000]]);
    assert.match(sql[1].text, /id = ANY\(\$2::int\[\]\) ORDER BY id FOR UPDATE$/);
    assert.deepEqual(sql[1].params, [41, [6, 5]]);
    assert.equal(released, 1);

    // ใส่ค่าตัวให้คลิปที่รอค่าตัวอยู่ -> สแตมป์ผลงานล็อกในคำสั่งเดียวกัน
    reset();
    await submissions.setFees(41, [{ sub_id: 7, budget: 3000, from: 0 }], 'tester');
    const [stamped] = updates();
    assert.deepEqual(Object.keys(stamped.set), ['budget', 'perf_stamp']);
    assert.equal(stamped.set.budget, 3000);
    assert.equal(JSON.parse(stamped.set.perf_stamp).total_cost, 15000);
});

test('setFees() with a stale "from" rolls back and writes nothing', async () => {
    reset();
    await assert.rejects(
        submissions.setFees(41, [{ sub_id: 5, budget: 8000, from: 4000 }], 'tester'),
        e => e.status === 409);
    assert.deepEqual(updates(), []);
    assert.equal(sql.at(-1).text, 'ROLLBACK');
    assert.equal(rows.get(5).budget, 5000);
    assert.equal(released, 1);
});
