const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// Remark ต่อดราฟ — เอเจนซี่เขียนบอกทีมว่าดราฟรอบนั้นมีอะไรเพิ่มเติม (คนละช่องกับ feedback ที่ทีมเขียน)
// กติกา: ทีมอ่านได้อย่างเดียว — เส้น PUT ของทีมต้องไม่เขียนช่องนี้ ต่อให้หน้าเว็บส่งมา
// ทั้งหมดใช้ข้อมูลจำลอง ไม่แตะฐานข้อมูลจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-draft-remark-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in draft-remark test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;            // client/src/data/drafts.js (ESM)
let server, base;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/drafts.js')).href);
    store.users.findById = async () => ({ id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------- ตรรกะล้วน (ฝั่งหน้าเว็บ)

test('buildDrafts: อ่าน Remark ของแต่ละดราฟ และรอบที่มีแต่ Remark ต้องไม่หายไป', () => {
    assert.deepEqual(web.buildDrafts({ draft_link: 'a', feedback: 'f', draft_remark: 'r' }),
        [{ link: 'a', fb: 'f', rm: 'r' }]);
    // ดราฟ 2 มีแต่หมายเหตุ ยังไม่ได้ส่งลิงก์ — ต้องยังขึ้นเป็นดราฟ 2
    assert.deepEqual(web.buildDrafts({ draft_link: 'a', draft_remark2: 'ถ่ายใหม่' }),
        [{ link: 'a', fb: '', rm: '' }, { link: '', fb: '', rm: 'ถ่ายใหม่' }]);
    // ข้อมูลเก่าที่ยังไม่มีคอลัมน์นี้ อ่านได้เหมือนเดิม
    assert.deepEqual(web.buildDrafts({ draft_link: 'a', feedback2: 'แก้หน่อย', draft_link2: 'b' }),
        [{ link: 'a', fb: '', rm: '' }, { link: 'b', fb: 'แก้หน่อย', rm: '' }]);
    assert.deepEqual(web.buildDrafts({}), [{ link: '', fb: '', rm: '' }]);
    assert.deepEqual(web.buildDrafts(null), [{ link: '', fb: '', rm: '' }]);
});

const DRAFTS = [{ link: 'a', fb: 'f', rm: 'r' }, { link: 'b', fb: '', rm: 'r2' }];

test('draftPayload ฝั่งทีม: ส่งผลตรวจได้ · ไม่ส่ง Remark', () => {
    const team = web.draftPayload(DRAFTS, 'revise');
    assert.equal(Object.keys(team).some(k => k.startsWith('draft_remark')), false, 'ทีมต้องไม่ส่ง Remark');
    assert.equal(team.draft_link, 'a');
    assert.equal(team.feedback, 'f');
    assert.equal(team.draft_status, 'revise');
    assert.equal(team.approved, false);
    assert.equal(web.draftPayload(DRAFTS, 'approve').approved, true);
});

test('draftPayload ฝั่งเอเจนซี่: ส่ง Remark ได้ แต่ไม่ส่งผลตรวจเลย (อนุมัติตัวเองไม่ได้)', () => {
    const ag = web.draftPayload(DRAFTS, 'revise', { canRemark: true, canDecide: false });
    assert.equal(ag.draft_remark, 'r');
    assert.equal(ag.draft_remark2, 'r2');
    // ดราฟที่ยังไม่มีต้องส่ง null เพื่อล้างของเดิม (กติกาเดียวกับ draft_link / feedback)
    assert.equal(ag.draft_remark3, null);
    assert.equal(ag.draft_remark4, null);
    assert.equal(ag.draft_remark5, null);
    assert.equal('draft_status' in ag, false, 'เอเจนซี่ต้องไม่ส่งผลตรวจ');
    assert.equal('approved' in ag, false, 'เอเจนซี่ต้องไม่ส่ง approved');
    // ต่อให้สถานะที่โหลดมาเป็น approve ก็ต้องไม่ส่งกลับไป
    const asApprove = web.draftPayload(DRAFTS, 'approve', { canRemark: true, canDecide: false });
    assert.equal('approved' in asApprove, false);
});

test('draftPayload: เพิ่มดราฟรอบใหม่ เอเจนซี่ล้างผลตรวจรอบก่อนได้ แต่ตั้งเป็น approve ไม่ได้', () => {
    const reset = web.draftPayload(DRAFTS, '', { canRemark: true, canDecide: false, resetReview: true });
    assert.equal(reset.draft_status, null, 'ล้างผลตรวจรอบก่อน');
    assert.equal(reset.approved, false);
    // แม้สถานะที่ค้างอยู่จะเป็น approve ตอนล้างก็ต้องได้ null/false เสมอ ไม่ใช่ค่าที่ส่งเข้ามา
    const resetFromApprove = web.draftPayload(DRAFTS, 'approve', { canRemark: true, canDecide: false, resetReview: true });
    assert.equal(resetFromApprove.draft_status, null);
    assert.equal(resetFromApprove.approved, false);
});

// ---------------------------------------------------------------- เส้น API

test('PUT ของทีมไม่เขียน Remark ต่อให้ส่งมา (ทีมอ่านอย่างเดียว)', async () => {
    const sub = { id: 55, project_id: 80, account_name: 'น้องเอ', status: 'confirmed', ad_status: 'ยังไม่ยิง' };
    const project = { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active' };
    store.projects.findByIdFull = async id => (String(id) === '80' ? structuredClone(project) : null);
    store.submissions.get = async () => structuredClone(sub);
    const written = [];
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.submissions.updatePerson = store.submissions.update;
    store.activity.log = async () => {};

    const res = await fetch(`${base}/api/projects/80/submissions/55`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_link: 'https://example.invalid/d1', feedback: 'แก้ตรงนี้', draft_remark: 'ทีมแอบเขียน' })
    });
    assert.equal(res.status, 200);
    const f = written.at(-1);
    assert.equal(f.draft_link, 'https://example.invalid/d1', 'ช่องปกติต้องยังเขียนได้');
    assert.equal(f.feedback, 'แก้ตรงนี้');
    assert.equal('draft_remark' in f, false, 'เส้นของทีมต้องไม่ส่ง Remark ต่อให้ store เลย');
});

test('PUT ของเอเจนซี่เขียน Remark ได้ · ตัดช่องว่าง · ว่างล้วนเก็บเป็น null · ไม่ส่งมาก็ไม่แตะของเดิม', async () => {
    const sub = { id: 55, project_id: 80, agency_token: 'tok1', account_name: 'น้องเอ', status: 'confirmed' };
    const project = { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active',
        agency_links: [{ token: 'tok1', name: 'เอเจนซี่ A', active: true }], ad_groups: [] };
    store.projects.findByIdFull = async () => structuredClone(project);
    // เส้นของเอเจนซี่หาแคมเปญจาก token (resolveToken ยิง SQL ตรง จึงต้องสตับ)
    store.projects.resolveToken = async token => (token === 'tok1'
        ? { project: structuredClone(project), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: false } }
        : null);
    store.submissions.get = async () => structuredClone(sub);
    const written = [];
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.submissions.updatePerson = store.submissions.update;
    store.activity.log = async () => {};

    // บัญชีเอเจนซี่ที่ถูกผูก token นี้ไว้ (เส้นนี้ต้องล็อกอิน ไม่ใช่ลิงก์สาธารณะ)
    store.users.findById = async () => ({ id: 9, username: 'ag', role: 'agency', status: 'active', is_active: true, agency_tokens: ['tok1'] });
    const agToken = jwt.sign({ id: 9, role: 'agency' }, process.env.JWT_SECRET);
    const put = body => fetch(`${base}/api/agency/tok1/submissions/55`, {
        method: 'PUT', headers: { Authorization: `Bearer ${agToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });

    let res = await put({ draft_remark: '  เพลงติดลิขสิทธิ์เลยเปลี่ยนให้  ' });
    assert.equal(res.status, 200, 'เส้นของเอเจนซี่ต้องรับคำขอนี้');
    assert.equal(written.at(-1).draft_remark, 'เพลงติดลิขสิทธิ์เลยเปลี่ยนให้', 'ต้องตัดช่องว่างหัวท้าย');

    res = await put({ draft_remark2: '   ' });
    assert.equal(res.status, 200);
    assert.equal(written.at(-1).draft_remark2, null, 'ว่างล้วนต้องเก็บเป็น null');

    res = await put({ draft_link: 'https://example.invalid/x' });
    assert.equal(res.status, 200);
    assert.equal(written.at(-1).draft_remark, undefined, 'ไม่ส่งมาต้องไม่แตะคอลัมน์เดิม');
});

test('ช่อง Remark อยู่ใน UPDATABLE ของ store และอยู่ในชุดเวลาอัปเดตดราฟ', () => {
    const src = fs.readFileSync(path.join(SRC, 'store/pg/submissions.js'), 'utf8');
    for (let i = 1; i <= 5; i++) {
        const col = 'draft_remark' + (i === 1 ? '' : i);
        assert.ok(src.includes(`'${col}'`), 'store ต้องรู้จักคอลัมน์ ' + col);
    }
    assert.ok(src.includes('DRAFT_REMARK_F'), 'ต้องรวม Remark เข้าชุดเวลาอัปเดตดราฟ');
    // ถ้าลืมเพิ่มในเส้นของเอเจนซี่ คำขอที่มี Remark + budget จะโดนตอบ 409 (มีคอมเมนต์เตือนไว้ในไฟล์นั้น)
    const ag = fs.readFileSync(path.join(SRC, 'routes/agency.js'), 'utf8');
    assert.ok(ag.includes("'draft_remark'"), 'AGENCY_PUT_FIELDS ต้องมี draft_remark');
    // เส้นของทีมต้องไม่รู้จักช่องนี้เลย
    const pj = fs.readFileSync(path.join(SRC, 'routes/projects.js'), 'utf8');
    assert.equal(pj.includes('draft_remark'), false, 'เส้นของทีมต้องไม่รับ Remark');
    // คอลัมน์ต้องมีใน schema (ต้องรัน setup-db ก่อน deploy)
    const sql = fs.readFileSync(path.join(SRC, 'models/schema.sql'), 'utf8');
    for (let i = 1; i <= 5; i++) {
        const col = 'draft_remark' + (i === 1 ? '' : i);
        assert.ok(new RegExp('ADD COLUMN IF NOT EXISTS\\s+' + col + '\\b').test(sql), 'schema.sql ต้องมี ' + col);
    }
});

test('PUT ของเอเจนซี่: ตั้ง Approve เองไม่ได้ · ล้างผลตรวจได้ · ทีมที่เปิดลิงก์เดียวกันยังตรวจได้', async () => {
    const sub = { id: 55, project_id: 80, agency_token: 'tok1', account_name: 'น้องเอ', status: 'confirmed' };
    const project = { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [] };
    store.projects.findByIdFull = async () => structuredClone(project);
    store.projects.resolveToken = async token => (token === 'tok1'
        ? { project: structuredClone(project), link: { token: 'tok1', name: 'เอเจนซี่ A', groups: [], products: [], platforms: [], kol_count: 0, reports: [], scoped: false } }
        : null);
    store.submissions.get = async () => structuredClone(sub);
    const written = [];
    store.submissions.update = async (subId, pid, fields) => { written.push(structuredClone(fields)); return { ...sub, ...fields }; };
    store.submissions.updatePerson = store.submissions.update;
    store.activity.log = async () => {};

    const accounts = {
        9: { id: 9, username: 'ag', role: 'agency', status: 'active', is_active: true, agency_tokens: ['tok1'] },
        7: { id: 7, username: 'team', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] }
    };
    store.users.findById = async id => accounts[Number(id)] || null;
    const tokenOf = id => jwt.sign({ id, role: accounts[id].role }, process.env.JWT_SECRET);
    const put = (id, body) => fetch(`${base}/api/agency/tok1/submissions/55`, {
        method: 'PUT', headers: { Authorization: `Bearer ${tokenOf(id)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    // เอเจนซี่ยิงตรงมาขออนุมัติเอง — ต้องไม่ถูกเขียน (และไม่ตอบ error เพราะแท็บเก่ายังส่งสถานะเดิมกลับมา)
    let res = await put(9, { draft_link: 'https://example.invalid/d', draft_status: 'approve', approved: true });
    assert.equal(res.status, 200);
    let f = written.at(-1);
    assert.equal(f.draft_link, 'https://example.invalid/d', 'ลิงก์ดราฟต้องยังบันทึกได้');
    assert.equal(f.approved, undefined, 'เอเจนซี่ตั้ง approved ไม่ได้');
    assert.equal(f.draft_status, undefined, 'เอเจนซี่ตั้งผลตรวจไม่ได้');

    // ขอ revise เองก็ไม่ได้เหมือนกัน — ผลตรวจเป็นของทีม
    res = await put(9, { draft_status: 'revise' });
    assert.equal(res.status, 200);
    assert.equal(written.at(-1).draft_status, undefined);

    // ล้างผลตรวจได้ (ส่งดราฟรอบใหม่)
    res = await put(9, { draft_status: null, approved: false });
    assert.equal(res.status, 200);
    f = written.at(-1);
    assert.equal(f.draft_status, null);
    assert.equal(f.approved, false);

    // ทีมที่เปิดลิงก์เอเจนซี่เดียวกันยังตรวจได้ตามปกติ
    res = await put(7, { draft_status: 'approve', approved: true });
    assert.equal(res.status, 200);
    f = written.at(-1);
    assert.equal(f.draft_status, 'approve');
    assert.equal(f.approved, true);
});

test('หน้าเว็บซ่อนปุ่มตัดสินให้เอเจนซี่ และตัดสินจาก role ไม่ใช่หน้าที่เปิด', () => {
    const modal = fs.readFileSync(path.join(__dirname, '../client/src/components/DraftModal.jsx'), 'utf8');
    assert.ok(modal.includes('canDecide'), 'โมดัลต้องรู้ว่าใครตัดสินได้');
    assert.ok(modal.includes('draft-status-read'), 'ฝั่งที่ตัดสินไม่ได้ต้องเห็นผลตรวจแบบอ่านอย่างเดียว');
    const portal = fs.readFileSync(path.join(__dirname, '../client/src/pages/AgencyPortal.jsx'), 'utf8');
    assert.ok(portal.includes("canDecide={user.role !== 'agency'}"), 'ต้องตัดสินจาก role ของบัญชี');
    assert.ok(portal.includes("canRemark={user.role === 'agency'}"), 'Remark ก็ตัดสินจาก role เหมือนกัน');
});

// ---------------------------------------------------------------- Remark ต้องไม่หลุดจากดราฟของมัน
// บั๊กที่รีวิวจับได้: ทีมบันทึกแล้วลิงก์เลื่อนตำแหน่ง แต่ Remark (ทีมไม่ส่ง) ค้างที่เดิม
// จำลองการบันทึกแบบเดียวกับ store จริง: เขียนเฉพาะช่องที่ส่งมา (undefined = ไม่แตะคอลัมน์นั้น)
const saveAs = (sub, drafts, opts) => {
    const out = { ...sub };
    for (const [k, v] of Object.entries(web.draftPayload(drafts, '', opts))) if (v !== undefined) out[k] = v;
    return out;
};
const pairs = sub => web.buildDrafts(sub).map(d => [d.link || '-', d.rm || '-']);
const TEAM = { canRemark: false, canDecide: true };
const AGENCY = { canRemark: true, canDecide: false };

test('ทีมลบดราฟที่มี Remark ไม่ได้ (ต้นเหตุดราฟผี) · ลบดราฟที่ไม่มี Remark ได้ตามปกติ', () => {
    const ds = web.buildDrafts({ draft_link: 'A', draft_link2: 'B', draft_remark2: 'r2' });
    assert.equal(web.canRemoveDraft(ds, 1, false), false, 'ทีมต้องลบดราฟ 2 ที่มี Remark ไม่ได้');
    assert.equal(web.canRemoveDraft(ds, 1, true), true, 'เอเจนซี่ลบได้ เพราะส่ง Remark ไปเลื่อนตามด้วย');

    // Remark อยู่ดราฟถัดไป — ลบดราฟก่อนหน้าก็ไม่ได้ เพราะดราฟถัดไปจะเลื่อนขึ้นมาแทน
    const three = web.buildDrafts({ draft_link: 'A', draft_link2: 'B', draft_link3: 'C', draft_remark3: 'r3' });
    assert.equal(web.canRemoveDraft(three, 1, false), false, 'ลบดราฟ 2 แล้วดราฟ 3 (มี Remark) จะเลื่อน');
    assert.equal(web.canRemoveDraft(three, 2, false), false);

    // ไม่มี Remark เลย — ทีมลบได้เหมือนเดิม (ไม่เปลี่ยนพฤติกรรมของแถวทั่วไป)
    const plain = web.buildDrafts({ draft_link: 'A', draft_link2: 'B', draft_link3: 'C' });
    assert.equal(web.canRemoveDraft(plain, 1, false), true);
    assert.equal(web.canRemoveDraft(plain, 2, false), true);
    // Remark อยู่ก่อนหน้า ลบดราฟหลังได้ — ดราฟก่อนหน้าไม่เลื่อน
    const before = web.buildDrafts({ draft_link: 'A', draft_remark: 'r1', draft_link2: 'B' });
    assert.equal(web.canRemoveDraft(before, 1, false), true);

    // ดราฟ 1 ลบไม่ได้ทั้งสองฝั่ง · ตำแหน่งนอกช่วงไม่พัง
    assert.equal(web.canRemoveDraft(plain, 0, true), false);
    assert.equal(web.canRemoveDraft(plain, 9, true), false);
    assert.equal(web.canRemoveDraft(null, 1, true), false);
});

test('ทีมบันทึกแถวที่มี Remark โดยไม่ลบอะไร — Remark อยู่กับลิงก์เดิมทุกดราฟ', () => {
    const sub = { draft_link: 'A', draft_remark: 'r1', draft_link2: 'B', draft_remark2: 'r2', draft_link3: 'C', draft_remark3: 'r3' };
    const ds = web.buildDrafts(sub);
    ds[2] = { ...ds[2], fb: 'แก้ตรงนี้' };                       // ทีมเขียน Feedback ดราฟล่าสุด
    const after = saveAs(sub, ds, TEAM);
    assert.deepEqual(pairs(after), [['A', 'r1'], ['B', 'r2'], ['C', 'r3']]);
    assert.equal(after.feedback3, 'แก้ตรงนี้');
});

test('เอเจนซี่ปล่อยดราฟว่างคั่นกลาง — บันทึกแล้วในฐานไม่มีช่องว่าง Remark เลื่อนไปพร้อมลิงก์', () => {
    // เอเจนซี่กดเพิ่มดราฟ 2 แต่ไม่กรอก แล้วไปกรอกดราฟ 3 แทน
    const sub = { draft_link: 'A' };
    const ds = [{ link: 'A', fb: '', rm: '' }, { link: '', fb: '', rm: '' }, { link: 'C', fb: '', rm: 'r3' }];
    const saved = saveAs(sub, ds, AGENCY);
    assert.equal(saved.draft_link2, 'C', 'ดราฟว่างต้องถูกตัด ดราฟ 3 เลื่อนมาเป็นดราฟ 2');
    assert.equal(saved.draft_remark2, 'r3', 'Remark ต้องเลื่อนไปพร้อมลิงก์');
    assert.equal(saved.draft_link3, null);
    assert.equal(saved.draft_remark3, null);

    // ต่อมาทีมเปิดแถวนี้แล้วบันทึก (เคสที่รีวิวเจอว่าทำ Remark หลุด) — ตอนนี้ต้องไม่หลุดแล้ว
    const teamDs = web.buildDrafts(saved);
    teamDs[1] = { ...teamDs[1], fb: 'ขอแก้' };
    assert.deepEqual(pairs(saveAs(saved, teamDs, TEAM)), [['A', '-'], ['C', 'r3']]);
});

test('ฝั่งทีมไม่ตัดดราฟ — เขียนกลับตำแหน่งเดิมเป๊ะ (ดราฟที่มีแต่ Remark ยังอยู่ช่องเดิม)', () => {
    // ดราฟ 2 มีแต่ Remark ยังไม่ได้ใส่ลิงก์ — ทีมบันทึกต้องไม่ทำให้ดราฟนี้หายหรือย้ายช่อง
    const sub = { draft_link: 'A', draft_remark2: 'จะส่งลิงก์พรุ่งนี้', draft_link3: 'C' };
    const ds = web.buildDrafts(sub);
    assert.deepEqual(pairs(sub), [['A', '-'], ['-', 'จะส่งลิงก์พรุ่งนี้'], ['C', '-']]);
    const after = saveAs(sub, ds, TEAM);
    assert.deepEqual(pairs(after), [['A', '-'], ['-', 'จะส่งลิงก์พรุ่งนี้'], ['C', '-']]);
});

test('เอเจนซี่ลบดราฟกลางได้ Remark เลื่อนตามครบ ไม่เกิดดราฟผี', () => {
    const sub = { draft_link: 'A', draft_remark: 'r1', draft_link2: 'B', draft_remark2: 'r2', draft_link3: 'C', draft_remark3: 'r3' };
    const ds = web.buildDrafts(sub);
    assert.equal(web.canRemoveDraft(ds, 1, true), true);
    ds.splice(1, 1);
    assert.deepEqual(pairs(saveAs(sub, ds, AGENCY)), [['A', 'r1'], ['C', 'r3']]);
});
