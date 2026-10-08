const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// หน้าทำจ่าย: ทำจ่ายอัตโนมัติ (ผู้ใช้สั่ง 8 ต.ค. 2026)
// แนบใบแจ้งหนี้แล้วขึ้น "รอทำจ่าย" ทันที · เลยวันทำจ่าย 1 วัน ระบบย้ายเป็น "จ่ายแล้ว" เอง (รอบละ 1 เอเจนซี่ + 1 วัน)
// ยกเลิกรอบของงวดที่เลยวันแล้ว = พักไว้ (hold) ไม่นับซ้ำ · ข้อมูลจำลองทั้งหมด ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-payauto-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.AUTO_PAY_ENABLED = 'true';   // นอก production ตัวจ่ายอัตโนมัติปิดเองถ้าไม่ตั้งค่า — เทสต์เปิดไว้ (ตัวสวิตช์ทดสอบแยกด้านล่าง)
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in pay-auto test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ต้องสลับ query / withTransaction / loadSnapshot ก่อน require โมดูล store (หยิบไปเก็บตอนโหลด)
const base = require(path.join(SRC, 'store/pg/_base'));
let onQuery = async () => ({ rows: [], rowCount: 0 });
const SQL = [];
base.query = async (text, params) => { SQL.push({ text: String(text), params }); return onQuery(String(text), params); };
base.withTransaction = async fn => fn({ query: async (text, params) => { SQL.push({ text: String(text), params, tx: true }); return onQuery(String(text), params); } });
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
let SNAP = { installments: [], projects: [], pay_batches: [] };
snapshot.loadSnapshot = async (only = []) => Object.fromEntries(only.map(t => [t, structuredClone(SNAP[t] || [])]));

const store = require(path.join(SRC, 'store'));
const { payBatches, AUTO_PAY_BY, AUTO_PAY_NOTE, payableNow } = require(path.join(SRC, 'store/pg/payBatches'));
const REAL = { ...payBatches };
const REAL_LIST = store.installments.list;
const REAL_UPDATE = store.installments.update;
const autoPay = require(path.join(SRC, 'services/autoPay'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;
before(async () => { web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/payAuto.js')).href); });
after(() => {
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    return pool.end().catch(() => {});
});
beforeEach(() => { SQL.length = 0; onQuery = async () => ({ rows: [], rowCount: 0 }); autoPay._reset(); });

const INV = { filename: 'inst1_invoice.pdf', original: 'INV-001.pdf', size: 10 };
const inst = (id, over = {}) => ({ id, project_id: 1, agency: 'Mesaran', no: 1, of: 1, amount: 1000, due_date: '2026-10-07',
    status: 'pending', batch_id: null, invoice: INV, invoice_link: null, title: null, ...over });

// ---------------------------------------------------------------- หน้าเว็บ (data/payAuto.js)
test('หน้าเว็บ: ขึ้นรอทำจ่ายเฉพาะงวดที่มีใบแจ้งหนี้ (ไฟล์หรือลิงก์) · สถานะ รอถึงวัน / กำลังย้าย / ยังไม่ตั้งวัน / พักไว้', () => {
    assert.equal(web.hasInvoice(inst(1)), true);
    assert.equal(web.hasInvoice(inst(1, { invoice: null, invoice_link: 'https://drive/x' })), true);
    assert.equal(web.hasInvoice(inst(1, { invoice: null, invoice_link: '   ' })), false);
    assert.equal(web.hasInvoice(inst(1, { invoice: null })), false);
    assert.equal(web.inPendingTab(inst(1)), true);
    assert.equal(web.inPendingTab(inst(1, { status: 'hold' })), true);
    assert.equal(web.inPendingTab(inst(1, { status: 'paid' })), false);
    assert.equal(web.inPendingTab(inst(1, { invoice: null })), false, 'ไม่มีใบแจ้งหนี้ = ไม่ขึ้น');
    const today = '2026-10-08';
    assert.equal(web.pendingState(inst(1, { due_date: '2026-10-08' }), today), 'waiting', 'วันนี้คือวันทำจ่าย = ยังไม่ย้าย');
    assert.equal(web.pendingState(inst(1, { due_date: '2026-10-07' }), today), 'moving', 'เลยวันมา 1 วัน = ย้าย');
    assert.equal(web.pendingState(inst(1, { due_date: null }), today), 'nodate');
    assert.equal(web.pendingState(inst(1, { status: 'hold', due_date: '2026-10-01' }), today), 'hold');
    assert.equal(web.dayAfter('2026-10-31'), '2026-11-01');
    assert.equal(web.dayAfter('2026-12-31'), '2027-01-01');
    assert.equal(web.dayAfter(''), null);
    // เวลาไทย: 17:30 UTC = 00:30 ของวันถัดไปที่ไทย
    assert.equal(web.todayTH(Date.parse('2026-10-07T17:30:00Z')), '2026-10-08');
    assert.equal(web.todayTH(Date.parse('2026-10-07T16:30:00Z')), '2026-10-07');
    assert.equal(web.AUTO_PAY_BY, AUTO_PAY_BY, 'ชื่อผู้สร้างรอบอัตโนมัติตรงกับ server');
});

// ---------------------------------------------------------------- ชั้น SQL (store/pg/payBatches.js)
test('autoPayDue: เลือกเฉพาะงวด pending + มีใบแจ้งหนี้ + due_date < วันนี้ · ล็อกแบบ SKIP LOCKED · มัด 1 เอเจนซี่ + 1 วัน = 1 รอบ', async () => {
    const due = [inst(1), inst(2, { project_id: 2, amount: 2500 }), inst(3, { agency: 'Star', amount: 400 }), inst(4, { due_date: '2026-10-05', amount: 100 })];
    let nextId = 50;
    onQuery = async (text) => {
        if (/FROM installments\s+WHERE status = 'pending'/.test(text)) return { rows: structuredClone(due) };
        if (/SELECT id, name FROM projects/.test(text)) return { rows: [{ id: 1, name: 'Beauterry My Home' }, { id: 2, name: 'Jula Sun' }] };
        if (/SELECT \* FROM pay_batches/.test(text)) return { rows: [] };
        if (/INSERT INTO pay_batches/.test(text)) return { rows: [{ id: ++nextId, total: 0 }] };
        if (/SUM\(amount\)/.test(text)) return { rows: [{ t: 0 }] };
        if (/UPDATE pay_batches SET total/.test(text)) return { rows: [{ id: nextId, total: 0 }] };
        return { rows: [], rowCount: 0 };
    };
    const r = await REAL.autoPayDue('2026-10-08');
    assert.ok(SQL.every(q => q.tx), 'ทุกคำสั่งอยู่ใน transaction เดียว');
    assert.equal(SQL[0].text, "SET LOCAL lock_timeout = '5s'", 'รอล็อกไม่เกิน 5 วิ (หน้าทำจ่ายไม่ค้าง)');
    assert.equal(SQL[1].text, "SET LOCAL statement_timeout = '20s'");
    const sel = SQL.find(q => /FROM installments\s+WHERE status = 'pending'/.test(q.text));
    assert.match(sel.text, /status = 'pending'/);
    assert.match(sel.text, /due_date < \$1::date/);
    assert.match(sel.text, /jsonb_typeof\(invoice\) = 'object'/);
    assert.match(sel.text, /invoice_link/);
    assert.match(sel.text, /FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(sel.params, ['2026-10-08']);
    assert.equal(r.count, 4);
    assert.equal(r.total, 4000);
    assert.deepEqual(r.batches.map(b => [b.agency, b.pay_date, b.added, b.amount]),
        [['Mesaran', '2026-10-07', 2, 3500], ['Star', '2026-10-07', 1, 400], ['Mesaran', '2026-10-05', 1, 100]]);
    assert.deepEqual(r.batches[0].projects, ['Beauterry My Home', 'Jula Sun']);
    const ins = SQL.filter(q => /INSERT INTO pay_batches/.test(q.text));
    assert.equal(ins.length, 3, 'สร้าง 3 รอบ (คนละเอเจนซี่ / คนละวัน)');
    assert.deepEqual(ins[0].params.slice(0, 5), ['Mesaran', '2026-10-07', 3500, AUTO_PAY_NOTE, AUTO_PAY_BY]);
    const upd = SQL.filter(q => /UPDATE installments SET status = 'paid'/.test(q.text));
    assert.equal(upd.length, 3);
    assert.match(upd[0].text, /AND status = 'pending'/, 'ไม่ทับงวดที่ถูกจ่าย/พักไปแล้วระหว่างทาง');
    assert.deepEqual(upd[0].params[2], [1, 2]);
    // ยอดรอบ = ยอดงวดที่ย้ายในรอบนั้น (ใส่ตั้งแต่สร้าง)
    assert.equal(ins[0].params[2], 3500);
    assert.deepEqual(r.batches.map(b => b.total), [3500, 400, 100]);
});

test('autoPayDue: ไม่เติมเข้ารอบเดิมเลย (รอบเดิมอาจโอนเงินไปแล้ว — งวดที่ใบแจ้งหนี้มาช้าได้สลิปของตัวเอง) · ไม่มีงวดถึงเวลา = ไม่เขียนอะไร · วันที่ผิดรูป = error', async () => {
    onQuery = async (text) => {
        if (/FROM installments\s+WHERE status = 'pending'/.test(text)) return { rows: [inst(7)] };
        if (/INSERT INTO pay_batches/.test(text)) return { rows: [{ id: 21 }] };
        return { rows: [] };
    };
    const r = await REAL.autoPayDue('2026-10-08');
    assert.equal(SQL.some(q => /FROM pay_batches/.test(q.text) && /SELECT/.test(q.text)), false, 'ไม่ค้นหารอบเดิม');
    assert.equal(SQL.some(q => /UPDATE pay_batches/.test(q.text)), false, 'ไม่แก้รอบที่มีอยู่');
    assert.equal(SQL.filter(q => /INSERT INTO pay_batches/.test(q.text)).length, 1);
    assert.equal(r.batches[0].id, 21);
    assert.equal(r.batches[0].total, 1000);

    SQL.length = 0;
    onQuery = async () => ({ rows: [] });
    assert.deepEqual(await REAL.autoPayDue('2026-10-08'), { count: 0, total: 0, batches: [] });
    assert.equal(SQL.filter(q => /INSERT INTO|UPDATE \w+ SET/.test(q.text)).length, 0, 'อ่านอย่างเดียว');
    await assert.rejects(REAL.autoPayDue('8/10/2026'), /YYYY-MM-DD/);
    await assert.rejects(REAL.autoPayDue(undefined), /YYYY-MM-DD/);
});

test('ยกเลิกรอบ: งวดที่เลยวันแล้ว (มีใบแจ้งหนี้) = พักไว้ (hold) ไม่ให้ระบบนับซ้ำ · ที่ยังไม่ถึงวัน = กลับไป pending', async () => {
    onQuery = async (text) => {
        if (/SELECT \* FROM pay_batches WHERE id/.test(text)) return { rows: [{ id: 5, agency: 'Mesaran', pay_date: '2026-10-07', total: 3000 }] };
        if (/UPDATE installments/.test(text)) return { rows: [{ status: 'hold' }, { status: 'hold' }, { status: 'pending' }] };
        return { rows: [] };
    };
    const gone = await REAL.remove(5, { today: '2026-10-08' });
    assert.match(SQL[0].text, /SELECT \* FROM pay_batches WHERE id = \$1 FOR UPDATE/, 'ล็อกรอบก่อน — ไม่ชนกับตัวจ่ายอัตโนมัติที่กำลังเติมงวด');
    const upd = SQL.find(q => /UPDATE installments/.test(q.text));
    assert.match(upd.text, /CASE WHEN \(due_date IS NOT NULL AND due_date < \$3::date AND/);
    assert.match(upd.text, /THEN 'hold' ELSE 'pending' END/);
    assert.equal(upd.params[2], '2026-10-08');
    assert.equal(gone.held, 2);
    assert.ok(SQL.some(q => /DELETE FROM pay_batches WHERE id = \$1/.test(q.text)));
});

test('สร้างรอบเอง (เส้นเดิม) ใช้กติกาเดียวกัน: ต้องมีใบแจ้งหนี้ + เลยวันทำจ่ายแล้ว · ไม่งั้นไม่บันทึกอะไร', async () => {
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const future = '2999-01-01';
    assert.equal(payableNow(inst(1, { due_date: '2026-01-01' }), today), true);
    assert.equal(payableNow(inst(1, { due_date: today }), today), false, 'วันนี้คือวันทำจ่าย ยังไม่ได้');
    assert.equal(payableNow(inst(1, { due_date: null }), today), false);
    assert.equal(payableNow(inst(1, { due_date: '2026-01-01', invoice: null }), today), false);
    for (const row of [inst(1, { due_date: future }), inst(1, { due_date: '2026-01-01', invoice: null, invoice_link: '' })]) {
        SQL.length = 0;
        onQuery = async (text) => (/FROM installments WHERE id = ANY/.test(text) ? { rows: [row] } : { rows: [] });
        const r = await REAL.create({ agency: 'Mesaran', pay_date: '2026-10-07', installment_ids: [1] });
        assert.match(r.error, /เลยวันทำจ่าย/);
        assert.equal(SQL.some(q => /INSERT INTO|UPDATE \w+ SET/.test(q.text)), false);
        assert.match(SQL[0].text, /FROM installments WHERE id = ANY\(\$1::int\[\]\) ORDER BY id FOR UPDATE/, 'ล็อกงวดที่เลือกก่อนตัดสิน');
    }
    onQuery = async (text) => {
        if (/FROM pay_batches WHERE id/.test(text)) return { rows: [{ id: 3, agency: 'Mesaran' }] };
        if (/FROM installments WHERE id = ANY/.test(text)) return { rows: [inst(1, { due_date: future })] };
        return { rows: [] };
    };
    const r2 = await REAL.addItems(3, [1]);
    assert.match(r2.error, /เลยวันทำจ่าย/);
});

test('รายการงวด: status ส่งหลายค่าคั่น , ได้ (pending,hold) · ค่าเดียวเหมือนเดิม', async () => {
    SNAP = { projects: [{ id: 1, name: 'A', brand: 'Beauterry', ad_groups: [] }], pay_batches: [],
        installments: [inst(1), inst(2, { status: 'hold' }), inst(3, { status: 'paid' }), inst(4, { status: null })] };
    assert.deepEqual((await REAL_LIST({ status: 'pending,hold' })).map(i => i.id).sort(), [1, 2, 4]);
    assert.deepEqual((await REAL_LIST({ status: 'pending' })).map(i => i.id).sort(), [1, 4]);
    assert.deepEqual((await REAL_LIST({ status: null })).map(i => i.id).sort(), [1, 2, 3, 4]);
});

test('แก้งวดทีละงวด (ใช้ได้แม้แผนถูกล็อก): งวดที่พักไว้แก้วันทำจ่าย หรือ release = กลับเป็น pending · วันเดิมไม่ release = ยังพักไว้ · จ่ายแล้วแก้ไม่ได้', async () => {
    let cur;
    onQuery = async (text, params) => {
        if (/FROM installments WHERE id = \$1 FOR UPDATE/.test(text)) return { rows: [structuredClone(cur)] };
        if (/^UPDATE installments SET/.test(text)) return { rows: [{ ...cur }] };
        return { rows: [] };
    };
    const upd = () => SQL.find(q => /^UPDATE installments SET/.test(q.text));
    const setsStatus = () => /"?status"? = \$/.test(upd().text) && upd().params.includes('pending');
    for (const [label, row, fields, want] of [
        ['พักไว้ + เลื่อนวัน', { status: 'hold', due_date: '2026-10-01' }, { due_date: '2026-10-20' }, true],
        ['พักไว้ + release', { status: 'hold', due_date: '2026-10-01' }, { release: true }, true],
        ['พักไว้ + วันเดิม', { status: 'hold', due_date: '2026-10-01' }, { due_date: '2026-10-01' }, false],
        ['รอจ่าย + release', { status: 'pending', due_date: '2026-10-01' }, { release: true }, false]
    ]) {
        SQL.length = 0;
        cur = inst(7, row);
        const r = await REAL_UPDATE(7, fields);
        assert.ok(!r.error, label + ': ' + r.error);
        assert.equal(setsStatus(), want, label);
    }
    SQL.length = 0;
    cur = inst(7, { status: 'paid', batch_id: 3 });
    assert.match((await REAL_UPDATE(7, { due_date: '2026-10-20' })).error, /ทำจ่ายไปแล้ว/);
    assert.equal(SQL.some(q => /^UPDATE/.test(q.text)), false);
});

// ---------------------------------------------------------------- services/autoPay.js
test('สวิตช์ตัวจ่ายอัตโนมัติ: production เปิดเอง · ที่อื่นปิดเว้นตั้ง true · false ปิดได้ทุกที่ · ปิดแล้วไม่แตะฐาน · ช้าเกินไม่ขวางหน้า', async () => {
    assert.equal(autoPay.enabled({ NODE_ENV: 'production' }), true);
    assert.equal(autoPay.enabled({ NODE_ENV: 'production', AUTO_PAY_ENABLED: 'false' }), false);
    assert.equal(autoPay.enabled({ NODE_ENV: 'development' }), false, 'เครื่อง dev ต่อฐานจริง = ปิดเอง');
    assert.equal(autoPay.enabled({}), false);
    assert.equal(autoPay.enabled({ NODE_ENV: 'development', AUTO_PAY_ENABLED: 'true' }), true);
    for (const v of ['no', 'disabled', 'n', 'OFF', '0']) {
        assert.equal(autoPay.enabled({ NODE_ENV: 'production', AUTO_PAY_ENABLED: v }), false, 'สวิตช์ฉุกเฉินปิดได้เสมอ: ' + v);
    }
    let calls = 0;
    const fake = { payBatches: { autoPayDue: async () => { calls++; return { count: 0, total: 0, batches: [] }; } }, activity: { log: async () => {} } };
    assert.equal(await autoPay.ensureFresh({ storeImpl: fake, env: { NODE_ENV: 'development' } }), null);
    assert.equal(calls, 0, 'ปิดสวิตช์ = ไม่เรียกฐานเลย');
    const logs = [];
    const stop = autoPay.startScheduler({ env: { NODE_ENV: 'development' }, logger: { log: m => logs.push(m), error() {} } });
    assert.match(logs[0], /disabled/);
    stop();
    // ตรวจช้าเกิน waitMs = หน้าทำจ่ายเปิดต่อเลย งานทำต่อเบื้องหลัง
    autoPay._reset();
    let finish;
    const slow = { payBatches: { autoPayDue: () => new Promise(r => { finish = () => r({ count: 0, total: 0, batches: [] }); }) }, activity: { log: async () => {} } };
    const t0 = Date.now();
    assert.equal(await autoPay.ensureFresh({ storeImpl: slow, waitMs: 50 }), null);
    assert.ok(Date.now() - t0 < 1000, 'ไม่รอจนเสร็จ');
    assert.equal(autoPay.getStatus().running, true, 'ยังทำต่อเบื้องหลัง');
    finish();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(autoPay.getStatus().running, false);
    // รอบค้างนานเกิน STUCK_MS (เช่น เน็ตหลุดเงียบ) → รอบใหม่เริ่มได้ · รอบเก่าที่เพิ่งจบไม่ไปล้างรอบใหม่
    autoPay._reset();
    let stuckDone, newDone, n = 0;
    const two = { payBatches: { autoPayDue: () => new Promise(r => { n++; if (n === 1) stuckDone = () => r({ count: 0, total: 0, batches: [] }); else newDone = () => r({ count: 0, total: 0, batches: [] }); }) }, activity: { log: async () => {} } };
    const p1 = autoPay.runOnce({ storeImpl: two });
    assert.equal(autoPay.runOnce({ storeImpl: two }), p1, 'ยังไม่ค้างนาน = รอบเดิม');
    autoPay._ageRunning(autoPay.STUCK_MS + 1000);
    const p2 = autoPay.runOnce({ storeImpl: two });
    assert.notEqual(p2, p1, 'ค้างนานเกิน = เริ่มรอบใหม่');
    stuckDone();
    await p1;
    assert.equal(autoPay.getStatus().running, true, 'รอบเก่าจบแล้วไม่ล้างรอบใหม่');
    newDone();
    await p2;
    assert.equal(autoPay.getStatus().running, false);
});

test('ตัวรันอัตโนมัติ: ลง Activity Log ในชื่อระบบอัตโนมัติ · ensureFresh เว้น 30 วิ · markStale ตรวจใหม่ทันที · ล้มไม่ขวาง', async () => {
    const LOG = [];
    let calls = 0, fail = null;
    const fake = {
        payBatches: { autoPayDue: async today => { calls++; assert.match(today, /^\d{4}-\d{2}-\d{2}$/); if (fail) throw fail;
            return { count: 2, total: 3500, batches: [{ id: 1, agency: 'Mesaran', pay_date: '2026-10-07', added: 2, amount: 3500, total: 3500, projects: ['Beauterry My Home'] }] }; } },
        activity: { log: async e => { LOG.push(e); } }
    };
    const r = await autoPay.ensureFresh({ storeImpl: fake });
    assert.equal(r.count, 2);
    assert.equal(LOG.length, 1);
    assert.equal(LOG[0].user_id, null);
    assert.equal(LOG[0].user_name, AUTO_PAY_BY);
    assert.equal(LOG[0].action, 'auto_pay_batch');
    assert.match(LOG[0].summary, /ย้ายเป็นจ่ายแล้วอัตโนมัติ \(เลยวันทำจ่าย 1 วัน\): Mesaran วันที่ 2026-10-07 · 2 งวด 3,500 บาท \(Beauterry My Home\)/);
    assert.equal(await autoPay.ensureFresh({ storeImpl: fake }), null, 'ภายใน 30 วิ ไม่ตรวจซ้ำ');
    assert.equal(calls, 1);
    autoPay.markStale();
    await autoPay.ensureFresh({ storeImpl: fake });
    assert.equal(calls, 2, 'เพิ่งแก้งวด = ตรวจใหม่ทันที');
    autoPay.markStale();
    fail = new Error('boom');
    const errs = [];
    assert.equal(await autoPay.ensureFresh({ storeImpl: fake, logger: { error: m => errs.push(m) } }), null, 'ล้มแล้วคืน null ไม่โยน');
    assert.match(errs[0], /boom/);
    assert.equal(autoPay.getStatus().last_run.status, 'error');
    // เรียกซ้อนกัน = รอบเดียว
    autoPay._reset();
    fail = null;
    const [a, b] = await Promise.all([autoPay.runOnce({ storeImpl: fake }), autoPay.runOnce({ storeImpl: fake })]);
    assert.equal(a, b);
    assert.equal(calls, 4);
});

// ---------------------------------------------------------------- เส้น API
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'member1', full_name: 'Member', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Beauterry'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const ACT = [];
store.activity.log = async e => { ACT.push(e); return e; };
let AUTO_CALLS = 0;
store.payBatches.autoPayDue = async () => { AUTO_CALLS++; return { count: 0, total: 0, batches: [] }; };
store.payments.listWithProjects = async () => [];
store.installments.list = async ({ status }) => [{ id: 1, status: status }];
store.payBatches.list = async () => [];
store.installments.listManual = async () => [];
let REMOVE_ARGS = null;
store.payBatches.remove = async (id, opts) => { REMOVE_ARGS = [id, opts]; return { id: 5, agency: 'Mesaran', pay_date: '2026-10-07', total: 3000, item_count: 3, items: [{ project_name: 'A' }], held: 2 }; };

let server, baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = 'http://127.0.0.1:' + server.address().port; });
// ปิดให้เรียบร้อยก่อนจบ — deploy รันเทสต์ด้วย --test-force-exit บน Windows: ถ้าโปรเซสถูกสั่งจบตอน socket ของ fetch
// ยังปิดไม่เสร็จ หรืองานเบื้องหลังของ Node ยังค้าง = libuv แครช (UV_HANDLE_CLOSING) ทั้งที่เทสต์ผ่านหมด (ลองซ้ำแล้วเป็นทุกครั้ง)
// → ตัดการเชื่อมต่อฝั่ง server · รอ socket ฝั่ง fetch ปิดจริง (ไม่เกิน 3 วิ) · พักอีกนิดให้งานเบื้องหลังจบ
after(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
});
const call = async (uid, method, url, body) => {
    const token = jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/payments' + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
};
let UPD_ARGS = null;
store.installments.update = async (id, f) => {
    UPD_ARGS = [id, f];
    return { data: { id: Number(id), project_id: 1, project_name: 'Beauterry My Home', agency: 'Mesaran', no: 2, of: 3, amount: 5000, due_date: '2026-10-07' },
        released: f.release === true || f.due_date === '2026-10-20' };
};

test('เส้นแก้งวด: ส่ง release (นับจ่ายใหม่) ต่อให้ store เฉพาะค่า true · ปลดงวดที่พักไว้ = ลงประวัติว่าใครปลด', async () => {
    ACT.length = 0;
    assert.equal((await call(1, 'PUT', '/installments/7', { release: true })).status, 200);
    assert.equal(UPD_ARGS[1].release, true);
    assert.equal(ACT.at(-1).action, 'release_hold_installment');
    assert.equal(ACT.at(-1).user_id, 1);
    assert.match(ACT.at(-1).summary, /นับจ่ายใหม่งวด 2\/3 \(Mesaran\) ยอด 5,000 บาท · วันทำจ่าย 2026-10-07 \(วันเดิม\)/);
    await call(1, 'PUT', '/installments/7', { release: 'yes', due_date: '2026-10-20' });
    assert.equal(UPD_ARGS[1].release, false);
    assert.equal(UPD_ARGS[1].due_date, '2026-10-20');
    assert.match(ACT.at(-1).summary, /\(แก้วันใหม่\)/);
    const n = ACT.length;
    await call(1, 'PUT', '/installments/7', { amount: 100 });
    assert.equal(ACT.length, n, 'แก้งวดทั่วไป (ไม่ได้ปลด) ไม่ลงประวัตินี้');
});

test('เส้นอ่านของหน้าทำจ่ายตรวจงวดที่ถึงเวลาก่อนตอบ (เว้น 30 วิ) · ส่ง status=pending,hold ผ่าน · สมาชิกเข้าไม่ได้', async () => {
    AUTO_CALLS = 0;
    const r = await call(1, 'GET', '/installments?status=pending,hold');
    assert.equal(r.status, 200);
    assert.equal(r.body.data[0].status, 'pending,hold');
    assert.equal(AUTO_CALLS, 1);
    for (const u of ['', '/batches', '/manual']) assert.equal((await call(1, 'GET', u)).status, 200);
    assert.equal(AUTO_CALLS, 1, 'ภายใน 30 วิ ตรวจครั้งเดียว');
    assert.equal((await call(2, 'GET', '/installments')).status, 403);
});

test('ยกเลิกรอบ: ส่งวันนี้ (เวลาไทย) ให้ store · ตอบจำนวนงวดที่พักไว้ · ลงประวัติ · คำขอแก้ = ตรวจใหม่ครั้งถัดไป', async () => {
    autoPay._reset();
    await call(1, 'GET', '/installments');
    const before = AUTO_CALLS;
    ACT.length = 0;
    const token = jwt.sign({ id: 1, username: 'admin1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/payments/batches/5?reason=' + encodeURIComponent('เลื่อนจ่าย'), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.held, 2);
    assert.equal(REMOVE_ARGS[0], '5');
    assert.match(REMOVE_ARGS[1].today, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(ACT.at(-1).summary, /เหตุผล: เลื่อนจ่าย · พักไว้ 2 งวด/);
    await call(1, 'GET', '/installments');
    assert.equal(AUTO_CALLS, before + 1, 'หลังมีการแก้ ตรวจใหม่ทันทีไม่ต้องรอ 30 วิ');
});

test('server เริ่มตัวรันอัตโนมัติตอนเปิด และหยุดตอนปิด (index.js) · ตัวจับเวลาไม่ค้างโปรเซส', () => {
    const idx = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
    assert.match(idx, /stopAutoPay = require\('\.\/services\/autoPay'\)\.startScheduler\(\);/);
    assert.match(idx, /stopAutoPay\(\);/);
    const stop = autoPay.startScheduler({ logger: { log() {}, error() {} }, intervalMs: 3600000 });
    assert.equal(typeof stop, 'function');
    stop();
});
