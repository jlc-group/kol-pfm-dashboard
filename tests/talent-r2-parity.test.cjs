const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ความคืบหน้าของงาน Talent คิดสองที่: server (การ์ดงานในแท็บงานทั้งหมด) กับหน้าเว็บ (หน้างาน)
// ถ้าสองฝั่งคิดต่างกัน ตัวเลขในการ์ดกับในหน้างานจะไม่ตรงกัน — เทสต์นี้เทียบผลทุกกรณีให้เท่ากันเป๊ะ
const server = require(path.join(__dirname, '../server/src/store/logic.js'));
let client;
before(async () => {
    client = await import(pathToFileURL(path.join(__dirname, '../client/src/data/hireProgress.js')).href);
});

const TODAY = '2026-09-21';
const cand = (key, status = 'เสนอ') => ({ key, name: key, fee: 1000, status, by_id: 5 });
const JOBS = {
    empty: [],
    onlyTalking: [
        { key: 'a', mode: 'direct', name: 'เอ', fee: 0, status: 'ทาบทาม' },
        { key: 'b', mode: 'direct', name: 'บี', fee: 3000, status: 'ทาบทาม' }
    ],
    mixed: [
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', headcount: 4, filled: 2, fee: 5000, deadline: '2026-09-16', assignee_id: 7,
            candidates: [cand('c1'), cand('c2'), cand('c3', 'ไม่เอา')] },
        { key: 'p1', mode: 'direct', name: 'พี', fee: 5000, status: 'ทาบทาม', from_request: 'r1', booking: { state: 'pending' } },
        { key: 'p2', mode: 'direct', name: 'พีสอง', fee: 5000, status: 'ทาบทาม', from_request: 'r1', booking: { state: 'fee_review', requested_fee: 6500 } },
        { key: 'd1', mode: 'direct', name: 'ดี', fee: 8000, status: 'ตกลงแล้ว', use_date: '2026-09-10' },
        { key: 'd2', mode: 'direct', name: 'ดีสอง', fee: 2000, status: 'ถ่ายเสร็จ', use_date: '2026-09-10' },
        { key: 'd3', mode: 'direct', name: 'ดีสาม', fee: 1000, status: 'ส่งงานแล้ว' }
    ],
    unassignedOverdue: [
        { key: 'r2', mode: 'casting', kind: 'พิธีกร', headcount: 1, filled: 0, fee: 3000, deadline: '2026-09-01', assignee_id: null, candidates: [] },
        { key: 'r3', mode: 'casting', kind: 'Live สด', headcount: 2, filled: 0, fee: 4000, deadline: '2026-09-30', assignee_id: 9, candidates: [] }
    ],
    allAgreedFuture: [
        { key: 'a', mode: 'direct', name: 'เอ', fee: 100, status: 'ตกลงแล้ว', use_date: '2026-10-05' },
        { key: 'b', mode: 'direct', name: 'บี', fee: 200, status: 'ตกลงแล้ว', use_date: '2026-10-01' },
        { key: 'r', mode: 'casting', headcount: 1, filled: 1, fee: 500, candidates: [cand('x', 'เลือกแล้ว')] }
    ],
    allShot: [
        { key: 'a', mode: 'direct', name: 'เอ', fee: 100, status: 'ถ่ายเสร็จ', use_date: '2026-09-01' },
        { key: 'b', mode: 'direct', name: 'บี', fee: 200, status: 'ส่งงานแล้ว' }
    ],
    allDelivered: [
        { key: 'a', mode: 'direct', name: 'เอ', fee: 100, status: 'ส่งงานแล้ว' }
    ],
    legacyWeird: [
        { key: 'x', name: 'ไม่มีโหมด', fee: '1500', status: '' },                    // แถวเก่าไม่มี mode = direct
        { key: 'y', mode: 'direct', name: 'สถานะแปลก', fee: null, status: 'อะไรไม่รู้' },
        null,
        { key: 'z', mode: 'casting', headcount: '3', filled: '1', fee: '700', assignee_id: '' }
    ]
};

test('job progress is identical on the server and in the browser for every kind of job', () => {
    for (const [name, items] of Object.entries(JOBS)) {
        for (const status of ['Draft', 'Active', 'Completed', 'Cancelled']) {
            for (const today of [TODAY, undefined]) {
                assert.deepEqual(client.jobProgress(items, status, today), server.jobProgress(items, status, today), `${name} / ${status} / ${today}`);
            }
        }
        assert.deepEqual(client.hireBreakdown(items), server.hireBreakdown(items), `breakdown ${name}`);
    }
});

test('job progress picks the most urgent thing first and counts people by stage', () => {
    const p = server.jobProgress(JOBS.mixed, 'Active', TODAY);
    assert.deepEqual(p.people, { total: 7, talking: 0, no_fee: 0, booking: 2, agreed: 1, shot: 1, delivered: 1, need: 2 });
    assert.deepEqual(p.money, { agreed: 11000, pending: 10000, unfilled: 10000 });
    // ค่าตัวใหม่มาก่อนชื่อรอเลือก → ชื่อรอเลือก → เลยกำหนด → รอยืนยันคิว → เลยวันงาน
    assert.deepEqual(p.todo.map(t => t.code), ['fee', 'decide', 'confirm', 'past']);
    assert.deepEqual(p.next, { code: 'fee', n: 1, keys: ['r1'] });
    assert.deepEqual(p.todo.find(t => t.code === 'past').keys, ['d1']);

    const q = server.jobProgress(JOBS.unassignedOverdue, 'Active', TODAY);
    assert.deepEqual(q.todo.map(t => `${t.code}:${t.n}`), ['assign:1', 'overdue:1', 'finding:2']);
    assert.equal(q.people.need, 3);

    assert.deepEqual(server.jobProgress(JOBS.onlyTalking, 'Active', TODAY).next, { code: 'talking', n: 2, keys: ['a', 'b'] });
    assert.equal(server.jobProgress(JOBS.onlyTalking, 'Active', TODAY).people.no_fee, 1);
    assert.deepEqual(server.jobProgress(JOBS.allAgreedFuture, 'Active', TODAY).next, { code: 'ready', n: 2, keys: [], date: '2026-10-01' });
    assert.equal(server.jobProgress(JOBS.allShot, 'Active', TODAY).next.code, 'deliver');
    assert.equal(server.jobProgress(JOBS.allDelivered, 'Active', TODAY).next.code, 'close');
    assert.equal(server.jobProgress(JOBS.empty, 'Active', TODAY).next.code, 'empty');
    // งานปิดแล้ว: ไม่มีเรื่องค้าง ไม่นับตำแหน่งที่ยังต้องหา
    const c = server.jobProgress(JOBS.mixed, 'Completed', TODAY);
    assert.deepEqual(c.todo, []);
    assert.equal(c.next.code, 'closed');
    assert.equal(c.people.need, 0);
});

test('the next button of one person follows the steps and never skips the fee rule', () => {
    assert.deepEqual(client.personNext({ status: 'ทาบทาม', fee: 0 }), { status: 'ตกลงแล้ว', needFee: true, label: 'ใส่ค่าตัวแล้วตกลง' });
    assert.equal(client.personNext({ status: 'ทาบทาม', fee: 3000 }).status, 'ตกลงแล้ว');
    assert.equal(client.personNext({ status: 'ตกลงแล้ว', fee: 3000 }).status, 'ถ่ายเสร็จ');
    assert.equal(client.personNext({ status: 'ถ่ายเสร็จ', fee: 3000 }).status, 'ส่งงานแล้ว');
    assert.equal(client.personNext({ status: 'ส่งงานแล้ว', fee: 3000 }), null);
    assert.equal(client.personNext({ status: 'ทาบทาม', fee: 3000, booking: { state: 'pending' } }).locked, true);
    assert.equal(client.personNext({ status: 'อะไรก็ไม่รู้', fee: 1 }).status, 'ตกลงแล้ว');   // ข้อมูลเก่า = กำลังคุย
    assert.deepEqual(['ทาบทาม', 'ตกลงแล้ว', 'ถ่ายเสร็จ', 'ส่งงานแล้ว'].map(s => client.personGroup({ status: s })), ['pending', 'agreed', 'done', 'done']);
    assert.equal(client.personGroup({ status: 'ตกลงแล้ว', booking: { state: 'fee_review' } }), 'pending');
});

test('next-step sentences exist for every code the progress can produce', () => {
    for (const code of ['fee', 'decide', 'assign', 'overdue', 'confirm', 'finding', 'talking', 'past', 'deliver', 'close', 'ready', 'empty', 'closed']) {
        const t = client.todoText({ code, n: 2, date: '2026-10-01' }, { no_fee: 1 });
        assert.ok(t.text && t.button && t.target, code);
    }
    assert.equal(client.moneyLine({ agreed: 1000, pending: 0, unfilled: 500 }), 'ตกลงแล้ว ฿1,000 · งบที่กันไว้ ฿500');
    assert.equal(client.moneyLine({}), 'ยังไม่มีค่าใช้จ่าย');
});
