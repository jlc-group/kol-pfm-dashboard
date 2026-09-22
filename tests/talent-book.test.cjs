const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// Talent Book (แท็บ "คอมการ์ดทั้งหมด") — GET /api/hires/book → store.hires.book()
// 1 การ์ด = ชื่อ + ประเภทงาน · Booked = มีงานที่คอนเฟิร์มแล้ว · Casting = ที่เหลือ (ชื่อที่เสนอในใบขอให้หา + คนที่ยังไม่คอนเฟิร์ม)
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-book-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in talent-book test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ---------------------------------------------------------------- ข้อมูลจำลอง
const P72 = {
    id: 72, name: 'ถ่ายแบบ Sep', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: '  Miw ', owner: null,
    start_date: '2026-09-05', end_date: null,
    hire_items: [
        { key: 'd1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', agency: 'Model Co', contact: '080-000-0001',
          link: 'https://instagram.com/mali', fee: 15000, status: 'ตกลงแล้ว', use_date: '2026-09-10',
          image: { filename: 'hire_72_1.jpg', original: 'มะลิ.jpg' }, note: 'โน้ตภายในทีม' },
        { key: 'd2', mode: 'direct', kind: 'นางแบบ', name: 'กุหลาบ', agency: 'Model Co', contact: null,
          fee: 12000, status: 'ทาบทาม', use_date: '2026-09-10' },
        // แถวที่ยังไม่ใส่ชื่อ = ยังไม่ใช่คน
        { key: 'd3', mode: 'direct', kind: 'ช่างภาพ', name: '', fee: 0, status: 'ทาบทาม' },
        // ใบขอให้หา นางแบบ 2 คน ได้แล้ว 1 (ดาว) → ยังว่าง 1 ที่
        { key: 'r1', mode: 'casting', kind: 'นางแบบ', name: null, fee: 6000, headcount: 2, filled: 1, use_date: '2026-09-18',
          assignee_id: 7, requested_by_id: 3, status: 'เสนอชื่อแล้ว',
          candidates: [
              { key: 'c1', name: 'ต้นน้ำ', fee: 5000, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า',
                image: { filename: 'hire_72_c1.pdf', original: 'comp.pdf' }, at: '2026-09-11T02:00:00.000Z' },
              { key: 'c2', name: 'ปลายฟ้า', fee: 4000, status: 'ไม่เอา', by_id: 7, by_name: 'ฟ้า',
                image_link: 'https://drive.test/p', decided_note: 'เกินงบลับมาก', note: 'โน้ตคนเสนอ', at: '2026-09-11T03:00:00.000Z' },
              { key: 'c3', name: 'ดาว', fee: 6000, status: 'เลือกแล้ว', by_id: 8, by_name: 'ฝน', agency: 'Star Co', contact: '081-000-0003',
                link: 'https://www.tiktok.com/@dao', image: { filename: 'hire_72_c3.png' }, video: { filename: 'hirevid_72_1.mp4' },
                at: '2026-09-12T02:00:00.000Z' },
              { key: 'c4', name: '   ', fee: 1000, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า' },
              // มะลิ (เคยจ้างแล้ว) ถูกเสนอซ้ำในใบนี้ → การ์ดเดียวกับของมะลิ · PDF ใหม่กว่ารูปของมะลิ แต่รูปจริงยังได้เป็นรูปการ์ด
              { key: 'c5', name: 'มะลิ', fee: 9000, status: 'เสนอ', by_id: 8, by_name: 'ฝน',
                image: { filename: 'hire_72_c5.pdf' }, at: '2026-09-12T03:00:00.000Z' }
          ] },
        // ดาวที่ทีมเลือกจากใบ r1 แล้ว รอคนช่วยหายืนยันคิว (ค่าตัวในแถวคนต่างจากที่เสนอ)
        { key: 'h9', mode: 'direct', kind: 'นางแบบ', name: 'ดาว', agency: 'Star Co', contact: '081-000-0003',
          link: 'https://www.tiktok.com/@dao', fee: 6500, status: 'ทาบทาม', use_date: '2026-09-18',
          image: { filename: 'hire_72_c3.png' }, from_request: 'r1', from_candidate: 'c3',
          booking: { state: 'pending', approved_by: 'แพรว' } },
        // ใบที่ได้คนครบแล้ว — ชื่อที่ยังรอเลือกเป็นตัวสำรอง · ใบมีชื่อหลุดมา (ข้อมูลเสีย) ก็ต้องไม่เป็นการ์ด
        { key: 'r2', mode: 'casting', kind: 'นักแสดง', name: 'ชื่อหลุด', fee: 3000, headcount: 1, filled: 1, use_date: '2026-09-12',
          candidates: [
              { key: 'c6', name: 'เมฆ', fee: 0, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า',
                image_link: 'javascript:alert(1)', video_link: 'https://youtu.be/x' }
          ] }
    ]
};
const P73 = {
    id: 73, name: 'ถ่ายแบบแบรนด์อื่น', brand: 'Code Lab', status: 'Active', campaign_type: 'other', creator: 'โอ๊ต', owner: null,
    start_date: '2026-09-06', end_date: null,
    hire_items: [
        // แถวเก่าไม่มี mode = คนในงาน
        { key: 'x1', kind: 'นักแสดง', name: 'ต้นกล้า', fee: 9000, use_date: '2026-09-12', status: 'ตกลงแล้ว' },
        { key: 'x2', mode: 'casting', kind: 'นางแบบ', headcount: 1, filled: 0,
          candidates: [{ key: 'cx', name: 'ลับ', fee: 7000, status: 'เสนอ', by_id: 9, by_name: 'ใครสักคน' }] }
    ]
};
// แคมเปญ KOL ที่หลุดมาในชุดข้อมูล — ไม่ใช่งาน Talent ต้องไม่มีการ์ด
const P74 = {
    id: 74, name: 'แคมเปญ KOL', brand: 'Jdent', status: 'Active', campaign_type: 'kol', creator: 'Miw',
    start_date: '2026-09-01', hire_items: [{ key: 'k1', mode: 'direct', kind: 'นางแบบ', name: 'คนKOL', fee: 1, status: 'ตกลงแล้ว' }]
};
const P75 = {
    id: 75, name: 'งานเก่า', brand: 'Jdent', status: 'Completed', campaign_type: 'other', creator: null, owner: 'สมชาย',
    start_date: '2026-08-01', end_date: null,
    hire_items: [
        { key: 'o1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 14000, status: 'ส่งงานแล้ว', use_date: '2026-08-02',
          image: { filename: 'hire_75_old.webp' } },
        // ใบยังว่าง 3 ที่ แต่งานจบแล้ว — ไม่มีใครเลือกต่อ = ตัวสำรอง
        { key: 'r3', mode: 'casting', kind: 'นางแบบ', headcount: 3, filled: 0, use_date: null,
          candidates: [{ key: 'c7', name: 'ฟ้าใส', fee: 2000, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า', at: '2026-07-31T18:00:00.000Z' }] }
    ]
};
const P76 = {
    id: 76, name: 'Live สด', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: 'Miw', owner: null,
    start_date: null, end_date: null,
    hire_items: [
        // ใบไม่มีวัน + งานไม่มีวันเริ่ม → ใช้วันที่เสนอชื่อตามเวลาไทย (01:30 ของวันที่ 21)
        { key: 'r4', mode: 'casting', kind: 'พิธีกร', headcount: 1, filled: 0, use_date: null,
          candidates: [{ key: 'c8', name: 'ชบา', fee: 3000, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า', at: '2026-09-20T18:30:00.000Z' }] },
        // ตกลงแล้ว แต่ค่าตัวใหม่ยังรอทีมตัดสิน = ยังไม่คอนเฟิร์ม
        { key: 'j1', mode: 'direct', kind: 'พิธีกร', name: 'เจ', fee: 3500, status: 'ตกลงแล้ว', use_date: '2026-09-22',
          from_request: 'r4', from_candidate: 'zz', booking: { state: 'fee_review' } }
    ]
};
const P77 = {
    id: 77, name: 'ถ่ายแบบ Oct', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: 'แพรว', owner: 'ไม่ใช้',
    start_date: '2026-09-24', end_date: null,
    hire_items: [
        { key: 'm1', mode: 'direct', kind: 'นางแบบ', name: 'มะลิ', fee: 8000, status: 'ถ่ายเสร็จ', use_date: '2026-09-25' },
        // รายการล่าสุดของมะลิยังคุยอยู่ (฿0) — มะลิยังเป็น Booked และ ฿0 ไม่ขึ้นเป็นราคา
        { key: 'm2', mode: 'direct', kind: 'นางแบบ', name: ' มะลิ ', fee: 0, status: 'ทาบทาม', use_date: '2026-09-30' },
        { key: 'r5', mode: 'casting', kind: 'นางแบบ', headcount: 1, filled: 0, use_date: '2026-09-28',
          candidates: [{ key: 'c9', name: 'กุหลาบ', fee: 0, contact: 'LINE: kulab', status: 'ไม่เอา', by_id: 8, by_name: 'ฝน' }] }
    ]
};

const BASE = [P72, P73, P74, P75, P76, P77];
const FIXTURE = { other_projects: structuredClone(BASE), user_names: [] };

// snapshot จำลอง — ต้องสลับก่อนโหลด store เพราะ pg/hires หยิบ loadSnapshot ออกไปตอน require
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};

const store = require(path.join(SRC, 'store'));
const { hires } = require(path.join(SRC, 'store/pg/hires'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let server, base, account;
before(async () => {
    store.users.findById = async () => account;
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

const card = (data, key) => data.cards.find(c => c.key === key);
async function withProjects(list, fn) {
    const saved = FIXTURE.other_projects;
    FIXTURE.other_projects = structuredClone(list);
    try { return await fn(); } finally { FIXTURE.other_projects = saved; }
}

// ---------------------------------------------------------------- store

test('book: one card per name + kind, Booked vs Casting, never casting rows / nameless rows / KOL campaigns', async () => {
    const all = await hires.book({});
    assert.deepEqual(all.cards.map(c => c.key), [
        'มะลิ|นางแบบ',      // 30/9
        'กุหลาบ|นางแบบ',    // 28/9
        'เจ|พิธีกร',         // 22/9
        'ชบา|พิธีกร',        // 21/9 (วันที่เสนอตามเวลาไทย)
        'ดาว|นางแบบ',        // 18/9 — วันเดียวกันเรียงตามชื่อ
        'ต้นน้ำ|นางแบบ',
        'ปลายฟ้า|นางแบบ',
        'ต้นกล้า|นักแสดง',   // 12/9
        'เมฆ|นักแสดง',
        'ลับ|นางแบบ',        // 6/9 (วันเริ่มงาน)
        'ฟ้าใส|นางแบบ'       // 1/8
    ], 'เรียงวันล่าสุดใหม่สุดก่อน แล้วตามชื่อ');
    // ใบขอให้หาไม่เป็นการ์ดแม้มีชื่อหลุดมา · แถว/ชื่อที่เสนอที่ไม่มีชื่อ ข้าม · แคมเปญ KOL ข้าม
    const names = all.cards.map(c => c.name);
    for (const gone of ['ชื่อหลุด', '', 'คนKOL']) assert.ok(!names.includes(gone), gone);

    const group = key => card(all, key).group;
    // Booked: มีงานตกลงแล้ว/ถ่ายเสร็จ/ส่งงานแล้ว ที่ไม่ค้างยืนยันคิว
    assert.equal(group('มะลิ|นางแบบ'), 'booked');
    assert.equal(group('ต้นกล้า|นักแสดง'), 'booked');
    // ตกลงแล้วแต่ค่าตัวใหม่รอตัดสิน / เลือกแล้วรอยืนยันคิว / กำลังคุย = Casting
    assert.equal(group('เจ|พิธีกร'), 'casting');
    assert.equal(group('ดาว|นางแบบ'), 'casting');
    assert.equal(group('กุหลาบ|นางแบบ'), 'casting');
    assert.deepEqual(all.counts, { all: 11, booked: 2, casting: 9 });
    assert.deepEqual(all.kinds, ['นักแสดง', 'นางแบบ', 'พิธีกร'].sort());
    assert.deepEqual(all.brands, ['Code Lab', 'Jdent']);
});

test('book: Casting sub-state comes from the newest entry; Booked has none', async () => {
    const all = await hires.book({});
    const sub = key => card(all, key).sub;
    assert.equal(sub('ต้นน้ำ|นางแบบ'), 'waiting');   // ใบยังว่าง
    assert.equal(sub('เมฆ|นักแสดง'), 'spare');       // ใบได้ครบแล้ว
    assert.equal(sub('ฟ้าใส|นางแบบ'), 'spare');      // ใบยังว่างแต่งานจบแล้ว
    assert.equal(sub('ปลายฟ้า|นางแบบ'), 'dropped');
    assert.equal(sub('ดาว|นางแบบ'), 'booking');      // เลือกแล้ว รอยืนยันคิว (มาจากแถวคน ไม่ใช่ชื่อที่เสนอ)
    assert.equal(sub('เจ|พิธีกร'), 'booking');       // ค่าตัวใหม่รอตัดสิน
    assert.equal(sub('ชบา|พิธีกร'), 'waiting');
    // กุหลาบ: กำลังคุย (10/9) แล้วถูกเสนอใหม่และไม่ได้เลือก (28/9) → เอาของล่าสุด
    assert.equal(sub('กุหลาบ|นางแบบ'), 'dropped');
    // มะลิ: รายการล่าสุดยังคุยอยู่ แต่มีงานคอนเฟิร์มแล้ว → Booked ไม่มี sub
    assert.equal(sub('มะลิ|นางแบบ'), null);

    // กำลังคุยล้วน
    await withProjects([{ id: 90, name: 'ง', brand: 'Jdent', status: 'Active', campaign_type: 'other', start_date: '2026-09-01',
        hire_items: [{ key: 'a', mode: 'direct', kind: 'นางแบบ', name: 'แพท', fee: 0, status: 'ทาบทาม' },
            { key: 'b', mode: 'direct', kind: 'นางแบบ', name: 'พลอย', fee: 1000 }] }], async () => {
        const out = await hires.book({});
        assert.equal(card(out, 'แพท|นางแบบ').sub, 'talking');
        assert.equal(card(out, 'พลอย|นางแบบ').sub, 'talking', 'ไม่มีสถานะ = กำลังคุย');
        assert.deepEqual(out.counts, { all: 2, booked: 0, casting: 2 });
    });
});

test('book: a picked candidate and the person row it became are one card (even after a rename)', async () => {
    const all = await hires.book({});
    // ดาว: ชื่อที่เสนอ (c3) + แถวคน (h9) = การ์ดเดียว · ค่าตัวเอาจากแถวคน ไม่นับราคาที่เสนอซ้ำ
    assert.deepEqual(card(all, 'ดาว|นางแบบ'), {
        key: 'ดาว|นางแบบ', name: 'ดาว', kind: 'นางแบบ', group: 'casting', sub: 'booking',
        agency: 'Star Co', contact: '081-000-0003', link: 'https://www.tiktok.com/@dao',
        photo: { type: 'image', path: '/projects/72/hires/h9/image' },
        clip: { type: 'file', path: '/projects/72/hires/r1/candidates/c3/video' },
        fees: [{ fee: 6500, kind: 'proposed', project_id: 72, project_name: 'ถ่ายแบบ Sep', brand: 'Jdent', date: '2026-09-18' }],
        team_contacts: ['Miw'], proposed_by: ['ฝน'],
        jobs: 1, projects: [{ id: 72, name: 'ถ่ายแบบ Sep' }], brands: ['Jdent'], last_date: '2026-09-18'
    });

    await withProjects([{
        id: 80, name: 'ถ่ายแบบ Nov', brand: 'Jdent', status: 'Active', campaign_type: 'other', creator: 'แพรว', start_date: '2026-10-01',
        hire_items: [
            { key: 'r1', mode: 'casting', kind: 'นางแบบ', headcount: 3, filled: 3, use_date: '2026-10-05', candidates: [
                { key: 'a1', name: 'แอน', fee: 5000, status: 'เลือกแล้ว', by_name: 'ฟ้า', video_link: 'https://youtu.be/ann' },
                { key: 'a2', name: 'บี', fee: 4000, status: 'เลือกแล้ว', by_name: 'ฝน' },
                { key: 'a3', name: 'ซี', fee: 4500, status: 'เลือกแล้ว', by_name: 'ฝน' },
                { key: 'a4', name: 'ดี', fee: 4200, status: 'เสนอ', by_name: 'ฟ้า' }
            ] },
            // แอนถูกเลือก ยืนยันคิวแล้ว และทีมแก้ชื่อเป็น "แอนนา" — ผูกกันด้วย from_candidate
            { key: 'k/1 x', mode: 'direct', kind: 'นางแบบ', name: 'แอนนา', fee: 5500, status: 'ตกลงแล้ว', use_date: '2026-10-05',
              from_request: 'r1', from_candidate: 'a1', booking: { state: 'confirmed' }, image: { filename: 'hire_80_a.png' } },
            // แถวเก่าก่อนมี from_candidate — ผูกด้วยชื่อ
            { key: 'h2', mode: 'direct', kind: 'นางแบบ', name: 'บี', fee: 4000, status: 'ส่งงานแล้ว', use_date: '2026-10-05', from_request: 'r1' }
        ]
    }], async () => {
        const out = await hires.book({});
        assert.deepEqual(out.cards.map(c => c.key).sort(), ['ซี|นางแบบ', 'ดี|นางแบบ', 'บี|นางแบบ', 'แอนนา|นางแบบ'].sort(),
            'ไม่มีการ์ด "แอน" ซ้ำ');
        const ann = card(out, 'แอนนา|นางแบบ');
        assert.equal(ann.group, 'booked');
        assert.equal(ann.sub, null);
        assert.deepEqual(ann.proposed_by, ['ฟ้า']);
        assert.deepEqual(ann.fees, [{ fee: 5500, kind: 'hired', project_id: 80, project_name: 'ถ่ายแบบ Nov', brand: 'Jdent', date: '2026-10-05' }]);
        assert.deepEqual(ann.photo, { type: 'image', path: '/projects/80/hires/k%2F1%20x/image' }, 'key ถูก encode ใน path');
        assert.deepEqual(ann.clip, { type: 'link', url: 'https://youtu.be/ann' }, 'คลิปของชื่อที่เสนอติดมาที่การ์ดแถวคน');
        const bee = card(out, 'บี|นางแบบ');
        assert.equal(bee.group, 'booked');
        assert.equal(bee.fees.length, 1);
        assert.deepEqual(bee.proposed_by, ['ฝน']);
        // เลือกแล้วแต่ไม่มีแถวคน (ข้อมูลเก่า) = ยังไม่ใช่งานที่ตกลง
        assert.equal(card(out, 'ซี|นางแบบ').group, 'casting');
        assert.equal(card(out, 'ซี|นางแบบ').sub, 'booking');
        assert.equal(card(out, 'ซี|นางแบบ').fees[0].kind, 'proposed');
        assert.equal(card(out, 'ดี|นางแบบ').sub, 'spare', 'ใบได้ครบ 3/3 แล้ว ชื่อที่ยังรอเลือก = ตัวสำรอง');
    });
});

test('book: brand scope hides other brands\' people and proposed names', async () => {
    const jdent = await hires.book({ scopeBrands: ['Jdent'] });
    assert.ok(!jdent.cards.some(c => c.key === 'ต้นกล้า|นักแสดง'));
    assert.ok(!jdent.cards.some(c => c.key === 'ลับ|นางแบบ'), 'ชื่อที่เสนอในใบของแบรนด์อื่นก็ไม่เห็น');
    assert.ok(!jdent.cards.some(c => c.brands.includes('Code Lab')));
    assert.deepEqual(jdent.brands, ['Jdent']);
    assert.deepEqual(jdent.counts, { all: 9, booked: 1, casting: 8 });
    const codeLab = await hires.book({ scopeBrands: ['Code Lab'] });
    assert.deepEqual(codeLab.cards.map(c => c.key), ['ต้นกล้า|นักแสดง', 'ลับ|นางแบบ']);
    const none = await hires.book({ scopeBrands: [] });
    assert.deepEqual(none, { counts: { all: 0, booked: 0, casting: 0 }, kinds: [], brands: [], cards: [] });
});

test('book: newest non-empty details, team contacts, proposed-by, jobs and brands', async () => {
    const all = await hires.book({});
    const mali = card(all, 'มะลิ|นางแบบ');
    assert.equal(mali.name, 'มะลิ', 'ชื่อตัดช่องว่างแล้ว');
    assert.equal(mali.agency, 'Model Co');
    assert.equal(mali.contact, '080-000-0001');
    assert.equal(mali.link, 'https://instagram.com/mali');
    // creator ก่อน owner · ตัดช่องว่าง · ไม่ซ้ำ · ใหม่สุดก่อน
    assert.deepEqual(mali.team_contacts, ['แพรว', 'Miw', 'สมชาย']);
    assert.deepEqual(mali.proposed_by, ['ฝน']);
    assert.equal(mali.jobs, 3);
    assert.deepEqual(mali.projects, [{ id: 77, name: 'ถ่ายแบบ Oct' }, { id: 72, name: 'ถ่ายแบบ Sep' }, { id: 75, name: 'งานเก่า' }]);
    assert.deepEqual(mali.brands, ['Jdent']);
    assert.equal(mali.last_date, '2026-09-30');

    // กุหลาบ: รายการล่าสุด (ชื่อที่เสนอ) ไม่มีสังกัด → ใช้สังกัดล่าสุดที่มี · เบอร์/LINE เอาของล่าสุด
    const kulab = card(all, 'กุหลาบ|นางแบบ');
    assert.equal(kulab.agency, 'Model Co');
    assert.equal(kulab.contact, 'LINE: kulab');
    assert.equal(kulab.link, null);
    assert.equal(kulab.jobs, 2);
    assert.deepEqual(kulab.team_contacts, ['แพรว', 'Miw']);
    assert.deepEqual(kulab.proposed_by, ['ฝน']);

    // ชื่อที่เสนอในใบที่ไม่มีวัน → วันที่เสนอตามเวลาไทย
    assert.equal(card(all, 'ชบา|พิธีกร').last_date, '2026-09-21');
    assert.equal(card(all, 'ฟ้าใส|นางแบบ').last_date, '2026-08-01', 'ใบไม่มีวัน ใช้วันเริ่มงานก่อนวันที่เสนอ');
    assert.deepEqual(card(all, 'ต้นกล้า|นักแสดง').team_contacts, ['โอ๊ต']);
    assert.deepEqual(card(all, 'ต้นกล้า|นักแสดง').proposed_by, []);
});

test('book: fees are newest first, only > 0, at most 3, hired only when confirmed', async () => {
    const all = await hires.book({});
    // มะลิ: 30/9 ฿0 (ข้าม) → 25/9 8,000 → 18/9 เสนอ 9,000 → 10/9 15,000 · 2/8 14,000 เกิน 3 บรรทัด
    assert.deepEqual(card(all, 'มะลิ|นางแบบ').fees, [
        { fee: 8000, kind: 'hired', project_id: 77, project_name: 'ถ่ายแบบ Oct', brand: 'Jdent', date: '2026-09-25' },
        { fee: 9000, kind: 'proposed', project_id: 72, project_name: 'ถ่ายแบบ Sep', brand: 'Jdent', date: '2026-09-18' },
        { fee: 15000, kind: 'hired', project_id: 72, project_name: 'ถ่ายแบบ Sep', brand: 'Jdent', date: '2026-09-10' }
    ]);
    // กำลังคุย = ราคาที่เสนอ ไม่ใช่ค่าตัว · ชื่อที่เสนอ ฿0 ไม่ขึ้น
    assert.deepEqual(card(all, 'กุหลาบ|นางแบบ').fees.map(f => [f.fee, f.kind]), [[12000, 'proposed']]);
    assert.deepEqual(card(all, 'เจ|พิธีกร').fees.map(f => [f.fee, f.kind]), [[3500, 'proposed']]);
    assert.deepEqual(card(all, 'เมฆ|นักแสดง').fees, []);
});

test('book: photo = newest image, else PDF, else an http(s) image link; clip = file, else link', async () => {
    const all = await hires.book({});
    // รูปจริงชนะ PDF ที่ใหม่กว่า · รูปใหม่สุดชนะรูปเก่า (งานเก่า .webp)
    assert.deepEqual(card(all, 'มะลิ|นางแบบ').photo, { type: 'image', path: '/projects/72/hires/d1/image' });
    assert.deepEqual(card(all, 'ต้นน้ำ|นางแบบ').photo, { type: 'pdf', path: '/projects/72/hires/r1/candidates/c1/image' });
    assert.deepEqual(card(all, 'ปลายฟ้า|นางแบบ').photo, { type: 'link', url: 'https://drive.test/p' });
    assert.equal(card(all, 'เมฆ|นักแสดง').photo, null, 'ลิงก์ที่ไม่ใช่ http/https ไม่ส่งออก');
    assert.equal(card(all, 'ชบา|พิธีกร').photo, null);
    assert.deepEqual(card(all, 'เมฆ|นักแสดง').clip, { type: 'link', url: 'https://youtu.be/x' });
    assert.deepEqual(card(all, 'ดาว|นางแบบ').clip, { type: 'file', path: '/projects/72/hires/r1/candidates/c3/video' });
    assert.equal(card(all, 'มะลิ|นางแบบ').clip, null);

    // ไฟล์ใหม่กว่า + ลิงก์คลิปใหม่กว่า: ไฟล์ชนะ · แถวที่ไม่มี key เปิดรูปไม่ได้ → ไม่ใช้
    await withProjects([{ id: 91, name: 'ง', brand: 'Jdent', status: 'Active', campaign_type: 'other', start_date: '2026-09-01',
        hire_items: [
            { mode: 'direct', kind: 'นางแบบ', name: 'นิว', fee: 0, status: 'ทาบทาม', use_date: '2026-09-30', image: { filename: 'hire_91_x.jpg' } },
            { key: 'r', mode: 'casting', kind: 'นางแบบ', headcount: 1, filled: 0, use_date: '2026-09-20', candidates: [
                { key: 'n1', name: 'นิว', status: 'เสนอ', video_link: 'https://youtu.be/new', image_link: 'https://img.test/new' },
                { key: 'n2', name: 'นิว', status: 'ไม่เอา', video: { filename: 'hirevid_91.mov' } }
            ] }
        ] }], async () => {
        const niw = card(await hires.book({}), 'นิว|นางแบบ');
        assert.deepEqual(niw.photo, { type: 'link', url: 'https://img.test/new' });
        assert.deepEqual(niw.clip, { type: 'file', path: '/projects/91/hires/r/candidates/n2/video' });
    });
});

test('book: only the listed fields leave the server (no notes, no user ids)', async () => {
    const all = await hires.book({});
    const json = JSON.stringify(all);
    for (const secret of ['โน้ตภายในทีม', 'เกินงบลับมาก', 'โน้ตคนเสนอ', 'by_id', 'assignee', 'requested_by', 'filename', 'hire_72_1.jpg']) {
        assert.ok(!json.includes(secret), secret);
    }
    const KEYS = ['key', 'name', 'kind', 'group', 'sub', 'agency', 'contact', 'link', 'photo', 'clip', 'fees',
        'team_contacts', 'proposed_by', 'jobs', 'projects', 'brands', 'last_date'].sort();
    all.cards.forEach(c => assert.deepEqual(Object.keys(c).sort(), KEYS, c.key));
});

// ---------------------------------------------------------------- เส้น API

function send(url, claims) {
    const headers = claims ? { Authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}` } : {};
    return fetch(`${base}${url}`, { headers });
}

test('GET /api/hires/book returns counts / kinds / brands / cards within the caller\'s brands', async () => {
    assert.equal((await send('/api/hires/book')).status, 401);

    account = { id: 7, username: 'admin', role: 'admin', team_id: 1, is_active: true, status: 'active' };
    let res = await send('/api/hires/book', { id: 7, role: 'admin', team_id: 1 });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.status, 'success');
    assert.deepEqual(Object.keys(body.data).sort(), ['brands', 'cards', 'counts', 'kinds']);
    assert.deepEqual(body.data.counts, { all: 11, booked: 2, casting: 9 });
    assert.deepEqual(body.data, await hires.book({}));

    // member เห็นเฉพาะแบรนด์ที่ได้รับ — รวมชื่อที่เสนอในใบ
    account = { id: 8, username: 'm', role: 'member', team_id: 1, brands: ['Jdent'], is_active: true, status: 'active' };
    res = await send('/api/hires/book', { id: 8, role: 'member', team_id: 1 });
    body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.data.brands, ['Jdent']);
    assert.ok(!body.data.cards.some(c => c.key === 'ลับ|นางแบบ' || c.key === 'ต้นกล้า|นักแสดง'));
    assert.equal(body.data.counts.all, 9);

    // ยังไม่ได้รับแบรนด์ = ว่าง
    account = { ...account, brands: [] };
    body = await (await send('/api/hires/book', { id: 8, role: 'member', team_id: 1 })).json();
    assert.deepEqual(body.data.cards, []);
    assert.deepEqual(body.data.counts, { all: 0, booked: 0, casting: 0 });

    // เส้นเดิม GET /api/hires ยังเป็นรายชื่อคนที่คอนเฟิร์มแล้วเหมือนเดิม
    account = { id: 7, username: 'admin', role: 'admin', team_id: 1, is_active: true, status: 'active' };
    body = await (await send('/api/hires', { id: 7, role: 'admin', team_id: 1 })).json();
    assert.deepEqual(body.data.rows.map(r => r.name).sort(), ['ต้นกล้า', 'มะลิ'].sort());
});

test('book: undated person rows use the queue-confirm / job-created date, not "oldest"', async () => {
    // มีนา: ถูกเสนอแล้วไม่ได้เลือก · วันนี้: บันทึกตรงในงานใหม่แบบไม่ใส่วัน (ฟอร์มมีคนแล้วข้ามวันได้) ยังคุยอยู่
    await withProjects([
        { id: 91, name: 'Lookbook มี.ค.', brand: 'Jdent', status: 'Completed', campaign_type: 'other', start_date: '2026-03-01',
          created_at: '2026-02-20T03:00:00.000Z',
          hire_items: [{ key: 'r1', mode: 'casting', kind: 'นางแบบ', headcount: 1, filled: 0, fee: 9000,
            candidates: [{ key: 'c1', name: 'ดาว', fee: 9000, status: 'ไม่เอา', at: '2026-02-25T03:00:00.000Z' }] }] },
        { id: 92, name: 'งานใหม่ไม่ใส่วัน', brand: 'Jdent', status: 'Active', campaign_type: 'other', start_date: null,
          created_at: '2026-09-21T03:00:00.000Z',
          hire_items: [{ key: 'h1', mode: 'direct', kind: 'นางแบบ', name: 'ดาว', fee: 12000, status: 'ทาบทาม' }] }
    ], async () => {
        const c = card(await hires.book({}), 'ดาว|นางแบบ');
        assert.equal(c.sub, 'talking');
        assert.deepEqual(c.fees.map(x => x.fee), [12000, 9000]);
        assert.equal(c.last_date, '2026-09-21');
    });
});

test('book: a picked person the finder reported unavailable is "unavailable", not "dropped"', async () => {
    await withProjects([{ id: 93, name: 'Live', brand: 'Jdent', status: 'Active', campaign_type: 'other', start_date: '2026-09-10',
        hire_items: [{ key: 'r1', mode: 'casting', kind: 'พิธีกร', headcount: 1, filled: 0, fee: 3000, candidates: [
            { key: 'c1', name: 'เอ', fee: 3000, status: 'ไม่เอา', decided_note: 'คิวไม่ว่าง: ติดงานอื่น', at: '2026-09-05T03:00:00.000Z' },
            { key: 'c2', name: 'บี', fee: 3000, status: 'ไม่เอา', decided_note: 'คิวไม่ว่าง', at: '2026-09-05T03:00:00.000Z' },
            { key: 'c3', name: 'ซี', fee: 3000, status: 'ไม่เอา', decided_note: 'แพงไป', at: '2026-09-05T03:00:00.000Z' }] }] }], async () => {
        const out = await hires.book({});
        assert.equal(card(out, 'เอ|พิธีกร').sub, 'unavailable');
        assert.equal(card(out, 'บี|พิธีกร').sub, 'unavailable');
        assert.equal(card(out, 'ซี|พิธีกร').sub, 'dropped');
    });
});
