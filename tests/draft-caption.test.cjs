const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// Caption ของ KOL (ผู้ใช้สั่ง 30 ต.ค. 2026 "ในหน้าส่งดราฟ ขอเพิ่มช่องสำหรับใส่ Caption ของ KOL" · "ช่องเดียวพอ แยกออกมาจากดราฟ")
// 1 ช่องต่อคลิป (kol_caption) ไม่ผูกกับดราฟ · ทีมและเอเจนซี่กรอกได้ทั้งคู่ · ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-draft-caption-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in draft-caption test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ทรานแซกชันจำลองของ store.submissions.update — ต้องสลับก่อนโหลด store (pg/submissions.js ดึง withTransaction ไปตอนโหลด)
const base = require(path.join(SRC, 'store/pg/_base'));
const fake = { row: null, sets: [] };
const fakeClient = {
    async query(q, vals = []) {
        if (/^SELECT \* FROM submissions WHERE id = \$1 AND project_id = \$2 FOR UPDATE/.test(q)) return { rows: fake.row ? [structuredClone(fake.row)] : [] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = /SET (.+) WHERE/.exec(q)[1].split(', ').map(s => s.split(' = ')[0].replace(/"/g, ''));
            const set = Object.fromEntries(cols.map((c, k) => [c, vals[k]]));
            fake.sets.push(set);
            return { rows: [{ ...fake.row, ...set }] };
        }
        throw new Error('unexpected SQL in fake client: ' + q.slice(0, 80));
    }
};
base.withTransaction = async fn => fn(fakeClient);
// คำสั่งนอกทรานแซกชัน (reviewRows ของหน้างานของฉัน) — fake.noCaption = ฐานที่ยังไม่ setup-db (อ่าน kol_caption แล้ว error 42703)
const realQuery = base.query;
base.query = async (q, vals = []) => {
    fake.queries = [...(fake.queries || []), q];
    if (/^SELECT p\.id, p\.name/.test(q)) return { rows: [{ id: 80, name: 'แคมเปญ', brand: 'Jdent', campaign_type: 'kol', review_assign: {}, group_keys: [] }] };
    if (/information_schema\.columns/.test(q)) return { rows: ['id', 'project_id', 'status', 'group_key', 'draft_link', 'reviewer_id'].map(column_name => ({ column_name })) };
    if (/FROM submissions s/.test(q)) {
        if (fake.noCaption && /kol_caption/.test(q)) throw Object.assign(new Error('column s.kol_caption does not exist'), { code: '42703' });
        return { rows: [{ id: 55, project_id: 80, status: 'confirmed', group_key: null, draft_link: 'x', ...(fake.noCaption ? {} : { kol_caption: 'c' }) }] };
    }
    return realQuery(q, vals);
};

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));
const realUpdate = store.submissions.update;

let web, server, base0;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/drafts.js')).href);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base0 = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------- ตรรกะหน้าเว็บ (client/src/data/drafts.js)

test('draftPayload: Caption ช่องเดียวต่อคลิป (opts.caption) · ไม่อยู่ในดราฟ · ว่าง = ล้าง · ไม่ส่ง = ไม่แตะ', () => {
    const ds = [{ link: 'a', fb: '', rm: '' }, { link: 'b', fb: 'แก้', rm: '' }];
    assert.equal(web.draftPayload(ds, 'revise', { caption: 'รีวิว #คุชั่น' }).kol_caption, 'รีวิว #คุชั่น', 'ฝั่งทีม');
    assert.equal(web.draftPayload(ds, '', { canRemark: true, canDecide: false, caption: 'จากเอเจนซี่' }).kol_caption, 'จากเอเจนซี่', 'ฝั่งเอเจนซี่');
    assert.equal(web.draftPayload(ds, '', { caption: '   ' }).kol_caption, null, 'ว่างล้วน = ล้าง');
    assert.equal('kol_caption' in web.draftPayload(ds, ''), false, 'ไม่ส่ง caption = ไม่แตะของเดิม');
    // ไม่มีช่อง Caption ต่อดราฟแล้ว (ผู้ใช้สั่ง "ช่องเดียวพอ แยกออกมาจากดราฟ")
    const p = web.draftPayload(ds, '', { caption: 'x' });
    assert.equal(Object.keys(p).some(k => /^kol_caption\d|^draft_caption/.test(k)), false);
    assert.deepEqual(web.buildDrafts({ draft_link: 'a', kol_caption: 'x' }), [{ link: 'a', fb: '', rm: '' }], 'Caption ไม่ทำให้เกิดดราฟ');
});

test('ลบดราฟ ไม่แตะ Caption (อยู่นอกดราฟ)', () => {
    const ds = [{ link: 'a', fb: '', rm: '' }, { link: 'b', fb: '', rm: '' }, { link: 'c', fb: '', rm: '' }];
    const team = web.draftPayload(ds.filter((_, i) => i !== 1), '', { caption: 'แคปชั่นเดิม' });
    assert.deepEqual([team.draft_link, team.draft_link2, team.draft_link3], ['a', 'c', null]);
    assert.equal(team.kol_caption, 'แคปชั่นเดิม');
});

// ---------------------------------------------------------------- ชั้นเก็บข้อมูล (ทรานแซกชันจำลอง)

test('store: เขียน Caption ได้ + ขยับเวลาอัปเดตดราฟ · ฐานที่ยังไม่มีคอลัมน์ (ยังไม่ setup-db) = ข้ามช่อง Caption ไม่ error', async () => {
    fake.row = { id: 55, project_id: 80, account_name: 'น้องเอ', status: 'confirmed', ad_status: 'ยังไม่ยิง', ad_spend: 0, draft_link: null, kol_caption: null };
    fake.sets = [];
    await realUpdate.call(store.submissions, 55, 80, { kol_caption: 'รีวิว #คุชั่น' }, 'ทีม', { actor: 'team' });
    const set = fake.sets.at(-1);
    assert.equal(set.kol_caption, 'รีวิว #คุชั่น');
    assert.ok(set.draft_updated_at, 'แก้ Caption = อัปเดตดราฟ (ป้ายดราฟใหม่ / งานของฉัน)');
    // ยังไม่ได้รัน setup-db: แถวไม่มีคอลัมน์ kol_caption → ไม่เขียนช่อง Caption (ช่องอื่นยังเขียนได้)
    fake.row = { id: 55, project_id: 80, account_name: 'น้องเอ', status: 'confirmed', ad_status: 'ยังไม่ยิง', ad_spend: 0, draft_link: null };
    fake.sets = [];
    await realUpdate.call(store.submissions, 55, 80, { draft_link: 'https://x.invalid/d2', kol_caption: 'x' }, 'ทีม', { actor: 'team' });
    const set2 = fake.sets.at(-1);
    assert.equal(set2.draft_link, 'https://x.invalid/d2');
    assert.equal('kol_caption' in set2, false);
});

test('หน้างานของฉัน (reviewRows): อ่าน Caption ได้ · ฐานที่ยังไม่มีคอลัมน์ = ตัดคอลัมน์ที่ไม่มีแล้วอ่านใหม่ ไม่ล่ม', async () => {
    const cols = ['reviewer_id', 'draft_link', 'kol_caption'];
    fake.noCaption = false; fake.queries = [];
    let out = await store.submissions.reviewRows(cols);
    assert.equal(out.rows[0].kol_caption, 'c');
    fake.noCaption = true; fake.queries = [];
    out = await store.submissions.reviewRows(cols);
    assert.equal(out.rows.length, 1, 'ยังได้รายการครบ');
    assert.equal('kol_caption' in out.rows[0], false);
    assert.ok(fake.queries.some(q => /information_schema/.test(q)), 'ถามรายชื่อคอลัมน์ที่มีจริง');
    assert.equal(/kol_caption/.test(fake.queries.at(-1)), false, 'รอบสองไม่อ่านคอลัมน์ที่ไม่มี');
    fake.noCaption = false;
});

// ---------------------------------------------------------------- เส้น API

test('PUT ของทีม: รับ Caption · ตัดช่องว่างหัวท้าย · ว่างล้วน = null · ไม่ส่งมา = ไม่แตะ · ยาวเกิน 4,000 ตัด', async () => {
    const sub = { id: 55, project_id: 80, account_name: 'น้องเอ', status: 'confirmed', ad_status: 'ยังไม่ยิง' };
    store.projects.findByIdFull = async id => (String(id) === '80' ? { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active' } : null);
    store.users.findById = async () => ({ id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active' });
    const written = [];
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.activity.log = async () => {};
    const put = body => fetch(`${base0}/api/projects/80/submissions/55`, { method: 'PUT', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let r = await put({ draft_link: 'https://x.invalid/d', kol_caption: '  รีวิว #คุชั่น \n' });
    assert.equal(r.status, 200);
    assert.equal(written.at(-1).kol_caption, 'รีวิว #คุชั่น');
    r = await put({ kol_caption: '   ' });
    assert.equal(written.at(-1).kol_caption, null);
    r = await put({ kol_caption: 'ก'.repeat(4100) });
    assert.equal(written.at(-1).kol_caption.length, 4000);
    r = await put({ gencode: 'ABC' });
    assert.equal(written.at(-1).kol_caption, undefined, 'ไม่ส่งมา = ไม่แตะ');
});

test('PUT ของเอเจนซี่: รับ Caption · ตัดช่องว่าง · ว่างล้วน = null · Caption + budget จากแท็บเก่าไม่โดน 409', async () => {
    const sub = { id: 55, project_id: 80, agency_token: 'tok1', account_name: 'น้องเอ', status: 'confirmed' };
    const project = { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [] };
    store.projects.resolveToken = async token => (token === 'tok1'
        ? { project: structuredClone(project), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: false } }
        : null);
    store.submissions.get = async () => structuredClone(sub);
    const written = [];
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.submissions.updatePerson = store.submissions.update;
    store.users.findById = async () => ({ id: 9, username: 'ag', role: 'agency', status: 'active', is_active: true, agency_tokens: ['tok1'] });
    const agToken = jwt.sign({ id: 9, role: 'agency' }, process.env.JWT_SECRET);
    const put = body => fetch(`${base0}/api/agency/tok1/submissions/55`, { method: 'PUT', headers: { Authorization: `Bearer ${agToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let r = await put({ kol_caption: '  แคปชั่น #รีวิว  ' });
    assert.equal(r.status, 200);
    assert.equal(written.at(-1).kol_caption, 'แคปชั่น #รีวิว');
    r = await put({ kol_caption: '  ' });
    assert.equal(written.at(-1).kol_caption, null);
    r = await put({ kol_caption: 'x', budget: 500 });
    assert.equal(r.status, 200, 'มีช่อง Caption มาด้วย = ไม่ใช่คำขอค่าตัวล้วน');
    assert.equal(written.at(-1).budget, undefined, 'ค่าตัวไม่ถูกส่งต่อ');
});

test('Caption อยู่ครบทุกชั้น: schema (1 คอลัมน์) · store · หน้างานของฉัน', () => {
    const sql = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    const myWork = fs.readFileSync(path.join(SRC, 'routes/myWork.js'), 'utf8');
    const subs = fs.readFileSync(path.join(SRC, 'store/pg/submissions.js'), 'utf8');
    assert.ok(/ADD COLUMN IF NOT EXISTS\s+kol_caption\s+TEXT/.test(sql), 'schema.sql ต้องมี kol_caption');
    assert.equal(/draft_caption|kol_caption\d/.test(sql + myWork + subs), false, 'ไม่มี Caption ต่อดราฟแล้ว');
    assert.ok(myWork.includes("'kol_caption'"), 'หน้างานของฉันต้องส่ง kol_caption ให้หน้าต่างดราฟ');
    assert.ok(subs.includes("'kol_caption'"), 'store ต้องรู้จัก kol_caption');
});
