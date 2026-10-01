const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// Talent Book: คนที่ทีมเพิ่มเอง ไม่ต้องมีงาน (ตาราง talents · ผู้ใช้สั่ง 29 ก.ย. 2026)
// เส้น /api/hires/talents (เพิ่ม / ดู / แก้ / ลบ / รูป / คลิป) + การรวมการ์ดใน GET /api/hires/book
// กติกา: ทุกคนในทีมเห็น · แก้/ลบได้เฉพาะคนที่เพิ่มและ admin · ชื่อ + ประเภทงานซ้ำไม่ได้ · ตรงกับคนในงาน = การ์ดเดียว
// ทั้งหมดใช้ข้อมูลจำลองในหน่วยความจำ — ฐานข้อมูลของระบบคือ production ห้ามแตะ
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-own-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-own test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ---------------------------------------------------------------- ข้อมูลจำลอง
// งานหนึ่งงานของ Jdent ที่มี "มะลิ" (นางแบบ) ตกลงแล้ว — ไว้ทดสอบการรวมการ์ดกับคนที่เพิ่มเอง
const P90 = {
    id: 90, name: 'ถ่ายแบบ Oct', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: 'Miw',
    start_date: '2026-10-01', hire_items: [
        { key: 'd1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 15000, status: 'ตกลงแล้ว', use_date: '2026-10-05' }
    ]
};
const rows = new Map();
let seq = 0;
const FIXTURE = { other_projects: [P90], user_names: [] };

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
const realLoadSnapshot = snapshot.loadSnapshot;
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = t === 'talents' ? [...rows.values()].map(r => structuredClone(r)) : structuredClone(FIXTURE[t] || []);
    return snap;
};

const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

// store.talents จำลอง — พฤติกรรมเดียวกับ pg/talents.js (ชื่อ + ประเภทงาน เทียบแบบไม่สนตัวพิมพ์ / ช่องว่างหัวท้าย)
const norm = v => String(v ?? '').trim().toLowerCase();
const iso = () => new Date().toISOString();
store.talents.list = async () => [...rows.values()].map(r => ({ ...r }));
store.talents.findById = async id => { const r = rows.get(Number(id)); return r ? { ...r } : null; };
store.talents.findByKey = async (name, kind, exceptId = null) =>
    [...rows.values()].find(r => norm(r.name) === norm(name) && norm(r.kind) === norm(kind) && r.id !== Number(exceptId)) || null;
store.talents.create = async (fields, { byId = null, byName = null } = {}) => {
    const r = { id: ++seq, name: null, kind: null, link: null, brands: [], contact_mode: null, contact_name: null, contact: null, agency: null, rate: null, rate_unit: null, scope: null,
        image: null, image_link: null, clip: null, clip_link: null, note: null,
        ...fields, created_by_id: byId, created_by: byName, created_at: iso(), updated_at: iso() };
    rows.set(r.id, r);
    return { ...r };
};
store.talents.update = async (id, fields) => {
    const r = rows.get(Number(id));
    if (!r) return null;
    Object.assign(r, fields, { updated_at: iso() });
    return { ...r };
};
store.talents.remove = async id => { const r = rows.get(Number(id)); if (!r) return null; rows.delete(Number(id)); return { ...r }; };
store.talents.setFile = async (id, field, meta) => {
    const r = rows.get(Number(id));
    if (!r) return null;
    const old = r[field];
    r[field] = meta;
    r.updated_at = iso();
    return { row: { ...r }, old };
};
// งานที่จ้าง (talent_jobs · 1 ต.ค. 2026) — ไฟล์นี้ไม่ได้ทดสอบงาน (ดู tests/talent-jobs.test.cjs) แค่ไม่ให้ไปถามฐานจริง
store.talentJobs.listByTalent = async () => [];
const logged = [];
store.activity.log = async entry => { logged.push(entry); return entry; };

const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: null, role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'praew', full_name: 'Praew Team', nickname: 'แพรว', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Jdent'] },
    3: { id: 3, username: 'fon', full_name: 'Fon', nickname: 'ฝน', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Beauterry'] },
    4: { id: 4, username: 'ag', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['t1'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);

let server, base;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
beforeEach(() => { rows.clear(); seq = 0; logged.length = 0; });

const tokenOf = uid => jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
async function call(uid, method, url, body) {
    const res = await fetch(base + '/api' + url, {
        method,
        headers: { Authorization: `Bearer ${tokenOf(uid)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* ไฟล์ */ }
    return { status: res.status, body: json, res };
}
async function upload(uid, url, name, bytes, type) {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    const res = await fetch(base + '/api' + url, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(uid)}` }, body: fd });
    let json = null;
    try { json = await res.json(); } catch { /* */ }
    return { status: res.status, body: json };
}
const uploadsNow = () => fs.readdirSync(process.env.UPLOAD_DIR).filter(n => n.startsWith('talent'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex');
const talentPath = (id, field) => new RegExp('^/hires/talents/' + id + '/' + field + '\\?v=\\d+$');

// ---------------------------------------------------------------- เพิ่ม
test('เพิ่มคน: ตรวจช่องบังคับ / อื่น ๆ ที่ยังไม่พิมพ์ / ลิงก์ / เรท / หน่วย', async () => {
    const bad = async (body, re) => {
        const r = await call(2, 'POST', '/hires/talents', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match(r.body.message, re);
    };
    await bad({ kind: 'นางแบบ' }, /ใส่ชื่อ/);
    await bad({ name: '   ', kind: 'นางแบบ' }, /ใส่ชื่อ/);
    await bad({ name: 'ต้น' }, /เลือกประเภทงาน/);
    await bad({ name: 'ต้น', kind: 'อื่น ๆ' }, /ระบุว่าเป็นงานอะไร/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', image_link: 'javascript:alert(1)' }, /ลิงก์รูปต้องขึ้นต้น/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', clip_link: 'www.tiktok.com/x' }, /ลิงก์คลิปต้องขึ้นต้น/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', rate: -5 }, /เรทราคา/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', rate: 'ห้าพัน' }, /เรทราคา/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', rate: 2e9 }, /สูงเกินไป/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', rate: 5000, rate_unit: 'ต่อปี' }, /หน่วยเรท/);
    await bad({ name: 'x'.repeat(201), kind: 'นางแบบ' }, /ชื่อยาวเกิน 200/);
    // แบรนด์ (30 ก.ย. 2026): บังคับอย่างน้อย 1 · ต้องเป็นรายการ · ไม่เกิน 20 แบรนด์ / ชื่อละ 60 ตัวอักษร
    await bad({ name: 'ต้น', kind: 'นางแบบ' }, /หน้าเว็บนี้เป็นรุ่นเก่า — กดรีเฟรชหน้า/);   // ไม่ส่ง brands เลย = ฟอร์มรุ่นเก่า
    await bad({ name: 'ต้น', kind: 'นางแบบ', brands: [] }, /เลือกแบรนด์อย่างน้อย 1 แบรนด์/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', brands: ['  ', ''] }, /เลือกแบรนด์อย่างน้อย 1 แบรนด์/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', brands: 'Jdent' }, /แบรนด์ไม่ถูกต้อง/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', brands: ['x'.repeat(61)] }, /แบรนด์ไม่ถูกต้อง/);
    await bad({ name: 'ต้น', kind: 'นางแบบ', brands: Array.from({ length: 21 }, (_, i) => 'B' + i) }, /แบรนด์ไม่ถูกต้อง/);
    assert.equal(rows.size, 0, 'ไม่มีอะไรถูกเพิ่ม');
});

test('แบรนด์: หลายแบรนด์ · ตัดช่องว่าง/ซ้ำ · แก้ได้ · ล้างจนว่างไม่ได้ · ขึ้นบนการ์ดและตัวกรอง Brand · คนอื่นแบรนด์อื่นก็เห็น', async () => {
    const a = await call(2, 'POST', '/hires/talents', { name: 'ต้น', kind: 'นางแบบ', brands: [' Jdent ', 'Beauterry', 'Jdent'] });
    assert.equal(a.status, 201);
    assert.deepEqual(a.body.data.brands, ['Jdent', 'Beauterry']);
    const up = await call(2, 'PUT', `/hires/talents/${a.body.data.id}`, { brands: ['Dermiq'] });
    assert.deepEqual(up.body.data.brands, ['Dermiq']);
    const empty = await call(2, 'PUT', `/hires/talents/${a.body.data.id}`, { brands: [] });
    assert.equal(empty.status, 400);
    assert.deepEqual(rows.get(a.body.data.id).brands, ['Dermiq'], 'ล้างจนว่างไม่ได้');
    const keep = await call(2, 'PUT', `/hires/talents/${a.body.data.id}`, { note: 'x' });
    assert.deepEqual(keep.body.data.brands, ['Dermiq'], 'แก้ช่องอื่น แบรนด์คงเดิม');
    // ฝนดูแลแค่ Beauterry — ยังเห็นการ์ดที่ติดแบรนด์ Dermiq (แบรนด์ไม่ผูกสิทธิ์การเห็น)
    const forFon = (await call(3, 'GET', '/hires/book')).body.data;
    const c = forFon.cards.find(x => x.name === 'ต้น');
    assert.ok(c, 'คนแบรนด์อื่นก็เห็น');
    assert.deepEqual(c.brands, ['Dermiq']);
    assert.ok(forFon.brands.includes('Dermiq'), 'แบรนด์ขึ้นในตัวกรอง Brand');
});

test('แบรนด์: การ์ดที่รวมกับคนในงาน = แบรนด์จากงาน + แบรนด์ที่ทีมเลือก ไม่ซ้ำ', async () => {
    await call(2, 'POST', '/hires/talents', { name: 'มะลิ', kind: 'นางแบบ', brands: ['Jdent', 'Minimii'] });
    const c = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.key === 'มะลิ|นางแบบ');
    assert.deepEqual([...c.brands].sort(), ['Jdent', 'Minimii']);
});

test('เพิ่มคนสำเร็จ: ตัดช่องว่าง · เรทรับคอมมา · ผู้เพิ่ม = ชื่อเล่นของบัญชี · ไม่ส่ง id ผู้ใช้ออกไป · บันทึกประวัติ', async () => {
    const r = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'],
        name: '  ใบเตย ', kind: 'ช่างแต่งหน้า', link: ' https://instagram.com/baitoey ', contact: '081-111-2222',
        rate: '5,000', rate_unit: 'ต่อวัน', note: ' ถนัดงานผิว '
    });
    assert.equal(r.status, 201);
    const d = r.body.data;
    assert.equal(d.name, 'ใบเตย');
    assert.equal(d.kind, 'ช่างแต่งหน้า');
    assert.equal(d.link, 'https://instagram.com/baitoey');
    assert.equal(d.rate, 5000);
    assert.equal(d.rate_unit, 'ต่อวัน');
    assert.equal(d.note, 'ถนัดงานผิว');
    assert.equal(d.added_by, 'แพรว');
    assert.equal(d.editable, true);
    assert.equal(d.image, null);
    assert.equal('created_by_id' in d, false, 'ไม่ส่ง id ผู้ใช้');
    assert.equal(rows.get(d.id).created_by_id, 2);
    assert.match(logged.at(-1).summary, /Talent Book: เพิ่ม "ใบเตย"/);
});

test('คนเดียวกัน (ชื่อ + ประเภทงาน ไม่สนตัวพิมพ์/ช่องว่าง) เพิ่มซ้ำไม่ได้ · ประเภทต่างกันเพิ่มได้', async () => {
    assert.equal((await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'Mali', kind: 'นางแบบ' })).status, 201);
    const dup = await call(3, 'POST', '/hires/talents', { brands: ['Jdent'], name: '  mali ', kind: 'นางแบบ' });
    assert.equal(dup.status, 409);
    assert.match(dup.body.message, /มี "Mali" \(นางแบบ\) ใน Talent Book แล้ว/);
    assert.equal((await call(3, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'Mali', kind: 'พิธีกร' })).status, 201);
    assert.equal(rows.size, 2);
});

test('ข้อความชื่อซ้ำ: คนที่แก้การ์ดเดิมได้ → กดแก้ไข · คนอื่น → ค้นหาการ์ดเดิม', async () => {
    await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' });
    assert.match((await call(3, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.message, /ค้นชื่อในแท็บนี้/);
    assert.match((await call(1, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.message, /กดแก้ไขที่การ์ดเดิม/);
});

test('กดเพิ่ม/แก้พร้อมกันจนชน unique index (23505) → 409 ไม่ใช่ 500', async () => {
    await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' });
    const realCreate = store.talents.create, realUpdate = store.talents.update, realFind = store.talents.findByKey;
    let calls = 0;
    // ด่าน findByKey ครั้งแรกไม่เจอ (อีกคนยังไม่ commit) แล้ว INSERT ชน index
    store.talents.findByKey = async (...args) => (calls++ === 0 ? null : realFind(...args));
    store.talents.create = async () => { const e = new Error('duplicate key value violates unique constraint "talents_person_key"'); e.code = '23505'; throw e; };
    try {
        const r = await call(3, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' });
        assert.equal(r.status, 409);
        assert.match(r.body.message, /มี "ต้น" \(นางแบบ\) ใน Talent Book แล้ว/);
        const b = await realCreate({ name: 'ฟ้า', kind: 'นางแบบ' }, { byId: 2, byName: 'แพรว' });
        calls = 0;
        store.talents.update = async () => { const e = new Error('dup'); e.code = '23505'; throw e; };
        const r2 = await call(2, 'PUT', `/hires/talents/${b.id}`, { name: 'ต้น' });
        assert.equal(r2.status, 409);
    } finally {
        store.talents.create = realCreate; store.talents.update = realUpdate; store.talents.findByKey = realFind;
    }
    assert.equal([...rows.values()].filter(r => r.name === 'ต้น').length, 1);
});

test('เอเจนซี่เพิ่มไม่ได้ (เส้น /api/hires ปิดให้บัญชีเอเจนซี่)', async () => {
    const r = await call(4, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' });
    assert.notEqual(r.status, 201);
    assert.equal(rows.size, 0);
});

// ---------------------------------------------------------------- ช่องทางติดต่อ (ผู้ใช้สั่ง 30 ก.ย. 2026)
test('ช่องทางติดต่อ: ผ่าน Agency = ชื่อเอเจนซี่ + ผู้ติดต่อ ไม่เก็บเบอร์ · ติดต่อเอง = ชื่อผู้ติดต่อ + เบอร์ ไม่เก็บสังกัด', async () => {
    const ag = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', contact_mode: 'agency',
        agency: ' Star Model ', contact_name: ' พี่นก ', contact: '081-ซ่อนอยู่' });
    assert.equal(ag.status, 201);
    assert.equal(ag.body.data.contact_mode, 'agency');
    assert.equal(ag.body.data.agency, 'Star Model');
    assert.equal(ag.body.data.contact_name, 'พี่นก');
    assert.equal(ag.body.data.contact, null, 'ผ่านเอเจนซี่ไม่มีช่องเบอร์ — ค่าที่หลุดมาไม่ถูกเก็บ');

    const me = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ฟ้า', kind: 'นางแบบ', contact_mode: 'self',
        contact_name: 'ฟ้าเอง', contact: 'line: fah', agency: 'ค้างจากแบบเดิม' });
    assert.equal(me.status, 201);
    assert.equal(me.body.data.contact_mode, 'self');
    assert.equal(me.body.data.contact_name, 'ฟ้าเอง');
    assert.equal(me.body.data.contact, 'line: fah');
    assert.equal(me.body.data.agency, null, 'ติดต่อเองไม่เก็บชื่อเอเจนซี่');

    // สลับแบบตอนแก้ → ช่องของแบบเดิมถูกล้าง
    const sw = await call(2, 'PUT', `/hires/talents/${ag.body.data.id}`, { contact_mode: 'self', contact: '099-000-1111', contact_name: 'ต้นเอง' });
    assert.equal(sw.status, 200);
    assert.deepEqual([sw.body.data.contact_mode, sw.body.data.agency, sw.body.data.contact, sw.body.data.contact_name],
        ['self', null, '099-000-1111', 'ต้นเอง']);
    // ยังไม่เลือก (ค่าว่าง) = ว่าง ไม่ล้างช่องอื่น
    const none = await call(2, 'PUT', `/hires/talents/${me.body.data.id}`, { contact_mode: '' });
    assert.equal(none.body.data.contact_mode, null);
    assert.equal(none.body.data.contact, 'line: fah');
});

test('ช่องทางติดต่อ: แก้บางช่องโดยไม่ส่งแบบ (หน้าเว็บรุ่นเก่า) → ยึดแบบที่บันทึกไว้ ช่องของอีกแบบไม่กลับเข้ามา', async () => {
    const ag = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', contact_mode: 'agency', agency: 'Star Model' })).body.data;
    const me = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ฟ้า', kind: 'นางแบบ', contact_mode: 'self', contact: '081' })).body.data;
    const r1 = await call(2, 'PUT', `/hires/talents/${ag.id}`, { contact: '099-แอบใส่', note: 'x' });
    assert.equal(r1.status, 200);
    assert.deepEqual([r1.body.data.contact_mode, r1.body.data.contact, r1.body.data.agency, r1.body.data.note], ['agency', null, 'Star Model', 'x']);
    const r2 = await call(2, 'PUT', `/hires/talents/${me.id}`, { agency: 'แอบใส่ Co' });
    assert.deepEqual([r2.body.data.contact_mode, r2.body.data.agency, r2.body.data.contact], ['self', null, '081']);
    // แถวเก่าที่ยังไม่มีแบบ: แก้ได้ตามเดิม ไม่ล้างอะไร
    const old = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ดาว', kind: 'นางแบบ', contact: '080', agency: 'Old Co' })).body.data;
    const r3 = await call(2, 'PUT', `/hires/talents/${old.id}`, { contact: '080-ใหม่' });
    assert.deepEqual([r3.body.data.contact_mode, r3.body.data.contact, r3.body.data.agency], [null, '080-ใหม่', 'Old Co']);
});

test('Scope of work: เก็บ / แก้ / ล้างได้ · ยาวเกิน 2000 → 400 · ส่งไปกับการ์ด (card.talent.scope)', async () => {
    const scope = ' ถ่ายภาพนิ่ง 1 วัน\nคลิปสั้น 2 ชิ้น ';
    const a = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', rate: 650000, rate_unit: 'ต่องาน', scope });
    assert.equal(a.status, 201);
    assert.equal(a.body.data.scope, 'ถ่ายภาพนิ่ง 1 วัน\nคลิปสั้น 2 ชิ้น', 'ตัดช่องว่างหัวท้าย เก็บการขึ้นบรรทัด');
    const card = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.name === 'ต้น');
    assert.equal(card.talent.scope, 'ถ่ายภาพนิ่ง 1 วัน\nคลิปสั้น 2 ชิ้น');
    const long = await call(2, 'PUT', `/hires/talents/${a.body.data.id}`, { scope: 'ก'.repeat(2001) });
    assert.equal(long.status, 400);
    assert.match(long.body.message, /Scope of work ยาวเกิน 2000/);
    const cleared = await call(2, 'PUT', `/hires/talents/${a.body.data.id}`, { scope: '' });
    assert.equal(cleared.body.data.scope, null);
    assert.equal(cleared.body.data.rate, 650000, 'ช่องอื่นคงเดิม');
});

test('ช่องทางติดต่อ: ค่าแปลก / ชื่อผู้ติดต่อยาวเกิน → 400 ไม่บันทึก', async () => {
    const r1 = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', contact_mode: 'phone' });
    assert.equal(r1.status, 400);
    assert.match(r1.body.message, /ช่องทางติดต่อไม่ถูกต้อง/);
    const r2 = await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', contact_mode: 'self', contact_name: 'ก'.repeat(201) });
    assert.equal(r2.status, 400);
    assert.match(r2.body.message, /ชื่อผู้ติดต่อยาวเกิน 200/);
    assert.equal(rows.size, 0);
});

test('การ์ด Talent Book ส่งช่องทางติดต่อ + ชื่อผู้ติดต่อ · คนที่มาจากงานอย่างเดียวเป็น null', async () => {
    await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'พิธีกร', contact_mode: 'agency', agency: 'Star Model', contact_name: 'พี่นก' });
    const cards = (await call(2, 'GET', '/hires/book')).body.data.cards;
    const c = cards.find(x => x.name === 'ต้น');
    assert.deepEqual([c.contact_mode, c.contact_name, c.agency, c.contact], ['agency', 'พี่นก', 'Star Model', null]);
    const fromJob = cards.find(x => x.key === 'มะลิ|นางแบบ');
    assert.deepEqual([fromJob.contact_mode, fromJob.contact_name], [null, null]);
});

// ---------------------------------------------------------------- แก้ / ลบ
test('แก้: คนที่เพิ่มแก้ได้ · คนอื่นไม่ได้ · admin ได้ · แก้บางช่องที่เหลือคงเดิม · เปลี่ยนชื่อไปชนคนอื่นไม่ได้', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ', agency: 'Model Co', rate: 3000, rate_unit: 'ต่องาน' })).body.data;
    const b = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ฟ้า', kind: 'นางแบบ' })).body.data;

    const other = await call(3, 'PUT', `/hires/talents/${a.id}`, { rate: 1 });
    assert.equal(other.status, 403);
    assert.equal(rows.get(a.id).rate, 3000);

    const mine = await call(2, 'PUT', `/hires/talents/${a.id}`, { rate: 3500 });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.rate, 3500);
    assert.equal(mine.body.data.agency, 'Model Co', 'ช่องที่ไม่ได้ส่งคงเดิม');
    assert.equal(mine.body.data.rate_unit, 'ต่องาน');

    const admin = await call(1, 'PUT', `/hires/talents/${a.id}`, { agency: '' });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.agency, null, 'ส่งค่าว่าง = ล้างช่อง');

    const clash = await call(2, 'PUT', `/hires/talents/${b.id}`, { name: ' ต้น ' });
    assert.equal(clash.status, 409);
    assert.equal(rows.get(b.id).name, 'ฟ้า');

    const noKind = await call(2, 'PUT', `/hires/talents/${a.id}`, { kind: 'อื่น ๆ' });
    assert.equal(noKind.status, 400);
    assert.equal((await call(2, 'PUT', '/hires/talents/999', { rate: 1 })).status, 404);
});

test('ดูข้อมูลเต็ม (ฟอร์มแก้ไข): ทุกคนในทีมดูได้ · editable บอกตามคนที่ดู · id ไม่ถูกต้อง = ไม่พบ', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.data;
    assert.equal((await call(2, 'GET', `/hires/talents/${a.id}`)).body.data.editable, true);
    assert.equal((await call(3, 'GET', `/hires/talents/${a.id}`)).body.data.editable, false);
    assert.equal((await call(1, 'GET', `/hires/talents/${a.id}`)).body.data.editable, true);
    assert.equal((await call(3, 'GET', '/hires/talents/abc')).status, 404);
    // id เกินช่วง int4 ต้องไม่ถูกส่งไปถาม PostgreSQL (ตอบ error 22003 → 500) — pg/talents.js ตอบ null เอง
    const { talents } = require(path.join(SRC, 'store/pg/talents'));
    assert.equal(await talents.findById('3000000000'), null, 'ไม่ยิง query (ถ้ายิงจะเจอ noRealDb)');
    assert.equal(await talents.update('99999999999', { rate: 1 }), null);
    assert.equal(await talents.remove('2147483648'), null);
});

test('ลบ: คนอื่นไม่ได้ · คนที่เพิ่มได้ + ไฟล์ถูกลบตาม', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.data;
    assert.equal((await upload(2, `/hires/talents/${a.id}/image`, 'a.png', PNG, 'image/png')).status, 200);
    assert.equal(uploadsNow().length, 1);
    assert.equal((await call(3, 'DELETE', `/hires/talents/${a.id}`)).status, 403);
    assert.equal(rows.has(a.id), true);
    const del = await call(2, 'DELETE', `/hires/talents/${a.id}`);
    assert.equal(del.status, 200);
    assert.equal(rows.has(a.id), false);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(uploadsNow().length, 0, 'ไฟล์รูปถูกลบตาม');
});

// ---------------------------------------------------------------- ไฟล์
test('ไฟล์: คนไม่มีสิทธิ์ส่งไฟล์มาไม่ได้ (ไม่เขียนลงเครื่อง) · นามสกุลผิดไม่รับ · อัปใหม่แทนไฟล์เดิม · เปิดดูได้ทุกคน · เอาออกได้', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.data;

    const denied = await upload(3, `/hires/talents/${a.id}/image`, 'a.png', PNG, 'image/png');
    assert.equal(denied.status, 403);
    assert.equal(uploadsNow().length, 0, 'ด่านสิทธิ์อยู่หน้า multer');

    const wrong = await upload(2, `/hires/talents/${a.id}/image`, 'a.exe', Buffer.from('MZ'), 'application/octet-stream');
    assert.equal(wrong.status, 400);
    assert.equal(uploadsNow().length, 0);

    const first = await upload(2, `/hires/talents/${a.id}/image`, 'รูปแรก.png', PNG, 'image/png');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.image.original, 'รูปแรก.png');
    const oldName = rows.get(a.id).image.filename;
    const second = await upload(2, `/hires/talents/${a.id}/image`, 'b.png', PNG, 'image/png');
    assert.equal(second.status, 200);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(uploadsNow(), [rows.get(a.id).image.filename], 'ไฟล์เดิมถูกลบ เหลือไฟล์ใหม่ไฟล์เดียว');
    assert.notEqual(oldName, rows.get(a.id).image.filename);

    const view = await fetch(`${base}/api/hires/talents/${a.id}/image`, { headers: { Authorization: `Bearer ${tokenOf(3)}` } });
    assert.equal(view.status, 200, 'คนอื่นในทีมเปิดรูปได้');
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), PNG);

    const clipWrong = await upload(2, `/hires/talents/${a.id}/clip`, 'x.png', PNG, 'image/png');
    assert.equal(clipWrong.status, 400, 'คลิปรับเฉพาะวิดีโอ');

    assert.equal((await call(3, 'DELETE', `/hires/talents/${a.id}/image`)).status, 403);
    const gone = await call(2, 'DELETE', `/hires/talents/${a.id}/image`);
    assert.equal(gone.status, 200);
    assert.equal(gone.body.data.image, null);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(uploadsNow().length, 0);
    assert.equal((await fetch(`${base}/api/hires/talents/${a.id}/image`, { headers: { Authorization: `Bearer ${tokenOf(2)}` } })).status, 404);
});

// ---------------------------------------------------------------- การ์ดใน Talent Book
test('Talent Book: คนที่เพิ่มเองขึ้นเป็นการ์ด Saved ทุกคนในทีมเห็น (ไม่ผูกแบรนด์) · แก้ได้เฉพาะคนที่เพิ่ม/admin', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ใบเตย', kind: 'ช่างแต่งหน้า', rate: 5000, rate_unit: 'ต่อวัน', note: 'ถนัดงานผิว' })).body.data;
    await upload(2, `/hires/talents/${a.id}/image`, 'a.png', PNG, 'image/png');

    const forFon = (await call(3, 'GET', '/hires/book')).body.data;   // ฝนดูแลแค่ Beauterry
    const c = forFon.cards.find(x => x.name === 'ใบเตย');
    assert.ok(c, 'คนต่างแบรนด์ก็เห็น');
    assert.equal(c.group, 'saved');
    assert.equal(c.sub, null);
    assert.equal(c.jobs, 0);
    assert.deepEqual(c.projects, []);
    assert.deepEqual(c.fees, [], 'เรทที่ใส่เองไม่ใช่ราคาจากงาน');
    assert.equal(c.photo.type, 'image');
    assert.match(c.photo.path, talentPath(a.id, 'image'), 'path มีเวอร์ชันไฟล์ — เปลี่ยนรูปแล้วการ์ดโหลดใหม่');
    assert.deepEqual(c.talent, { id: a.id, rate: 5000, rate_unit: 'ต่อวัน', scope: null, note: 'ถนัดงานผิว', added_by: 'แพรว', editable: false, jobs_count: 0 });
    assert.equal(forFon.counts.saved, 1);

    const forPraew = (await call(2, 'GET', '/hires/book')).body.data;
    assert.equal(forPraew.cards.find(x => x.name === 'ใบเตย').talent.editable, true);
    const forAdmin = (await call(1, 'GET', '/hires/book')).body.data;
    assert.equal(forAdmin.cards.find(x => x.name === 'ใบเตย').talent.editable, true);
});

test('เปลี่ยนรูปแล้ว path บนการ์ดเปลี่ยน (หน้าเว็บจำรูปตาม path — ไม่งั้นการ์ดโชว์รูปเก่า) · server เปิดไฟล์ได้แม้มี ?v=', async () => {
    const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'ต้น', kind: 'นางแบบ' })).body.data;
    await upload(2, `/hires/talents/${a.id}/image`, 'a.png', PNG, 'image/png');
    const p1 = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.name === 'ต้น').photo.path;
    await new Promise(r => setTimeout(r, 5));
    await upload(2, `/hires/talents/${a.id}/image`, 'b.png', PNG, 'image/png');
    const p2 = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.name === 'ต้น').photo.path;
    assert.notEqual(p1, p2);
    const view = await fetch(`${base}/api${p2}`, { headers: { Authorization: `Bearer ${tokenOf(3)}` } });
    assert.equal(view.status, 200);
});

test('Talent Book: ชื่อ + ประเภทงานตรงกับคนในงาน = การ์ดเดียว (สถานะตามงาน · มีเรทและปุ่มแก้ของที่เพิ่มเอง)', async () => {
    await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: ' มะลิ ', kind: 'นางแบบ', rate: 12000, rate_unit: 'ต่องาน' });
    const data = (await call(2, 'GET', '/hires/book')).body.data;
    const mali = data.cards.filter(x => x.key === 'มะลิ|นางแบบ');
    assert.equal(mali.length, 1, 'รวมเป็นใบเดียว');
    const c = mali[0];
    assert.equal(c.group, 'booked', 'สถานะตามงานที่ตกลงแล้ว');
    assert.equal(c.jobs, 1);
    assert.deepEqual(c.projects, [{ id: 90, name: 'ถ่ายแบบ Oct' }]);
    assert.equal(c.fees.length, 1);
    assert.equal(c.fees[0].fee, 15000);
    assert.equal(c.talent.rate, 12000);
    assert.equal(c.talent.editable, true);
    assert.equal(data.counts.saved, 0, 'ใบนี้ไม่ใช่ Saved แล้ว');
    assert.equal(data.counts.booked, 1);

    // คนที่ไม่มีสิทธิ์แบรนด์ของงานนั้น เห็นแต่ส่วนที่เพิ่มเอง (Saved) — ไม่เห็นงานของ Jdent
    const forFon = (await call(3, 'GET', '/hires/book')).body.data;
    const f = forFon.cards.find(x => x.key === 'มะลิ|นางแบบ');
    assert.equal(f.group, 'saved');
    assert.deepEqual(f.projects, []);
    assert.deepEqual(f.fees, []);
});

test('การ์ดที่รวมกับคนในงาน: รูป/ติดต่อ/สังกัด ใช้ของที่ทีมเพิ่มเองก่อน (วันในงานอยู่ในอนาคตก็ตาม)', async () => {
    const saved = FIXTURE.other_projects;
    FIXTURE.other_projects = [{ ...P90, hire_items: [{ ...P90.hire_items[0], contact: '080-OLD', agency: 'Old Co',
        image: { filename: 'hire_90_d1.jpg', original: 'old.jpg' }, use_date: '2027-01-01' }] }];
    try {
        const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'มะลิ', kind: 'นางแบบ', contact: '099-NEW', agency: 'New Co' })).body.data;
        await upload(2, `/hires/talents/${a.id}/image`, 'new.png', PNG, 'image/png');
        const c = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.key === 'มะลิ|นางแบบ');
        assert.equal(c.contact, '099-NEW');
        assert.equal(c.agency, 'New Co');
        assert.match(c.photo.path, talentPath(a.id, 'image'));
        assert.equal(c.group, 'booked', 'สถานะยังมาจากงาน');
    } finally { FIXTURE.other_projects = saved; }
});

test('การ์ดที่รวมกับคนในงาน + ทีมเลือกช่องทางติดต่อแล้ว: เบอร์/สังกัดเอาจากที่เพิ่มเองเท่านั้น ไม่เติมจากงาน', async () => {
    const saved = FIXTURE.other_projects;
    FIXTURE.other_projects = [{ ...P90, hire_items: [{ ...P90.hire_items[0], contact: '081-JOB', agency: 'Job Co' }] }];
    try {
        const a = (await call(2, 'POST', '/hires/talents', { brands: ['Jdent'], name: 'มะลิ', kind: 'นางแบบ', contact_mode: 'agency', agency: 'New Co', contact_name: 'พี่นก' })).body.data;
        let c = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.key === 'มะลิ|นางแบบ');
        assert.deepEqual([c.contact_mode, c.agency, c.contact, c.contact_name], ['agency', 'New Co', null, 'พี่นก'], 'ผ่านเอเจนซี่ = ไม่มีเบอร์จากงานโผล่');
        await call(2, 'PUT', `/hires/talents/${a.id}`, { contact_mode: 'self', contact: '', agency: '', contact_name: 'มะลิเอง' });
        c = (await call(2, 'GET', '/hires/book')).body.data.cards.find(x => x.key === 'มะลิ|นางแบบ');
        assert.deepEqual([c.contact_mode, c.agency, c.contact, c.contact_name], ['self', null, null, 'มะลิเอง'], 'ติดต่อเอง = ไม่มีสังกัด/เบอร์จากงานมาคู่ชื่อ');
    } finally { FIXTURE.other_projects = saved; }
});

// ---------------------------------------------------------------- ลำดับ deploy
test('ตาราง talents ยังไม่มีในฐาน (โค้ดขึ้นก่อนรัน setup-db) — แท็บ Talent Book ยังเปิดได้ การ์ดจากงานยังอยู่', async () => {
    const saved = pool.query;
    pool.query = async q => {
        if (/FROM talents/.test(String(q))) { const e = new Error('relation "talents" does not exist'); e.code = '42P01'; throw e; }
        return { rows: [] };
    };
    try {
        const snap = await realLoadSnapshot(['talents']);
        assert.deepEqual(snap.talents, []);
    } finally { pool.query = saved; }
    // error อื่น (ไม่ใช่ตารางหาย) ต้องไม่ถูกกลืน
    pool.query = async () => { const e = new Error('boom'); e.code = 'XX000'; throw e; };
    try {
        await assert.rejects(() => realLoadSnapshot(['talents']), /boom/);
    } finally { pool.query = saved; }
});

test('ด่านความพร้อมของ production ไม่บังคับตาราง talents (โค้ดขึ้นก่อน setup-db ทั้งเว็บต้องไม่ล่ม)', async () => {
    const saved = pool.query;
    let asked = null;
    pool.query = async q => { asked = q.values[0]; return { rows: [] }; };
    try {
        const { checkDatabase } = require(path.join(SRC, 'services/readiness'));
        await checkDatabase();
        assert.ok(Array.isArray(asked) && asked.includes('projects'), 'ตารางหลักยังถูกตรวจ');
        assert.equal(asked.includes('talents'), false);
    } finally { pool.query = saved; }
});
