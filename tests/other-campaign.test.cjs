const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// แคมเปญ "งานจ้างอื่น ๆ" (campaign_type = 'other') — จ้างนางแบบ/นักแสดง/Live สด
// กติกา: ไม่เข้าหน้าโฆษณา / รายงานแคมเปญ / อินฟลูเอนเซอร์ · ยังนับรวมในงบภาพรวม (แต่แยกตัวเลขให้ติดป้ายได้)
// · รายชื่อผู้รับงานรวมอยู่ในเส้น /api/hires — ทั้งหมดทดสอบด้วยข้อมูลจำลอง ไม่แตะฐานข้อมูลจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in other-campaign test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const SUB = fields => ({
    project_id: 71, person_key: null, clip_no: 1, platform: 'TikTok', product: 'สินค้า A', agency: 'Agency A',
    status: 'confirmed', budget: 5000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 100000, likes: 1000, comments: 10, saves: 5, shares: 5, reposts: 0,
    link_account: null, post_date: '2026-09-02', group_key: null, content_type: null, ...fields
});

const HIRES = [
    { key: 'h1', kind: 'นางแบบ', name: 'มะลิ', contact: '080-000-0001', agency: 'Model Co', qty: '1 วัน',
      fee: 15000, use_date: '2026-09-10', place: 'สตูดิโอ A', deliverable: 'ภาพนิ่ง 10 ภาพ', link: null, status: 'ตกลงแล้ว', note: null },
    { key: 'h2', kind: 'นางแบบ', name: 'กุหลาบ', contact: null, agency: 'Model Co', qty: '1 วัน',
      fee: 12000, use_date: '2026-09-10', place: 'สตูดิโอ A', deliverable: 'ภาพนิ่ง 10 ภาพ', link: null, status: 'ทาบทาม', note: null },
    { key: 'h3', kind: 'Live สด', name: 'มะลิ', contact: '080-000-0001', agency: null, qty: '2 ชม.',
      fee: 8000, use_date: '2026-09-20', place: 'ออฟฟิศ', deliverable: 'Live 1 รอบ', link: null, status: 'ถ่ายเสร็จ', note: null },
    // แถวที่ยังไม่ได้ใส่ชื่อ — ยังไม่ถือว่าเป็นคน ต้องไม่โผล่ในหน้ารวม
    { key: 'h4', kind: 'ช่างภาพ', name: '', contact: null, agency: null, qty: null,
      fee: 0, use_date: null, place: null, deliverable: null, link: null, status: 'ทาบทาม', note: null },
    // ใบขอจัดหา — ยังไม่มีตัวคน ขอ 3 คน งบคนละ 5,000 (นับเป็น 3 คนที่ต้องหา แต่ยังไม่ใช่รายชื่อผู้รับงาน)
    // เป็นงานที่มอบหมายให้ user 7 หา โดย user 3 เป็นคนขอ · มีชื่อเสนอเข้ามาแล้ว 2 ชื่อ ตัดสินไป 1
    { key: 'h5', mode: 'casting', kind: 'นักแสดง', name: null, contact: null, agency: null, qty: null,
      fee: 5000, headcount: 3, filled: 0, spec: 'ชาย 25-30 ปี', deadline: '2026-09-08',
      use_date: '2026-09-18', place: 'สตูดิโอ A', link: null, status: 'เสนอชื่อแล้ว', note: null,
      assignee_id: 7, assignee_name: 'ฟ้า', requested_by_id: 3,
      candidates: [
          { key: 'c1', name: 'ต้นน้ำ', fee: 5000, status: 'เสนอ', by_id: 7, by_name: 'ฟ้า' },
          { key: 'c2', name: 'ปลายฟ้า', fee: 5000, status: 'ไม่เอา', by_id: 7, by_name: 'ฟ้า' }
      ] }
];

const FIXTURE = {
    projects: [
        { id: 71, name: 'แคมเปญ KOL', brand: 'Jdent', budget: 100000, status: 'Active', team_id: 1, campaign_type: 'kol',
          created_at: '2026-09-01T00:00:00.000Z', start_date: '2026-09-01', end_date: '2026-09-30', products: [], ad_groups: [], hire_items: [] },
        { id: 72, name: 'ถ่ายแบบ Sep', brand: 'Jdent', budget: 35000, status: 'Active', team_id: 1, campaign_type: 'other',
          created_at: '2026-09-02T00:00:00.000Z', start_date: '2026-09-05', end_date: '2026-09-25', products: [], ad_groups: [], hire_items: HIRES },
        { id: 73, name: 'ถ่ายแบบแบรนด์อื่น', brand: 'Code Lab', budget: 9000, status: 'Active', team_id: 2, campaign_type: 'other',
          created_at: '2026-09-03T00:00:00.000Z', start_date: '2026-09-06', end_date: null, products: [], ad_groups: [],
          hire_items: [{ key: 'x1', kind: 'นักแสดง', name: 'ต้นกล้า', fee: 9000, use_date: '2026-09-12', status: 'ตกลงแล้ว' }] },
        // แคมเปญเก่าที่บันทึกก่อนมีคอลัมน์ประเภท — ไม่มีคีย์ campaign_type เลย ต้องถือเป็น KOL
        { id: 74, name: 'แคมเปญเก่า', brand: 'Jdent', budget: 50000, status: 'Active', team_id: 1,
          created_at: '2026-08-01T00:00:00.000Z', start_date: '2026-08-01', end_date: '2026-08-31', products: [], ad_groups: [] }
    ],
    submissions: [
        SUB({ id: 1, account_name: 'kolหนึ่ง', post_url: 'https://example.test/k1' }),
        SUB({ id: 2, project_id: 74, account_name: 'kolสอง', post_url: 'https://example.test/k2' }),
        // แถวนี้ไม่ควรมีในชีวิตจริง (งานจ้างอื่น ๆ ไม่มีรายชื่อ KOL) — ใส่ไว้เพื่อพิสูจน์ว่าด่านกันทำงาน
        SUB({ id: 3, project_id: 72, account_name: 'หลุดมาได้ไง', post_url: 'https://example.test/x' })
    ],
    teams: [{ id: 1, name: 'ทีม A' }, { id: 2, name: 'ทีม B' }]
};

// หน้างานจ้างอื่น ๆ / งานจัดหา อ่านจาก other_projects (คิวรีเบาเฉพาะงานจ้างอื่น ๆ) แทน projects ทั้งก้อน
FIXTURE.other_projects = FIXTURE.projects.filter(p => p.campaign_type === 'other');

const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
// ทุกโมดูลหยิบ loadSnapshot ออกไปตอน require — ต้องสลับก่อนโหลด
const { reports } = require(path.join(SRC, 'store/pg/reports'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const kols = require(path.join(SRC, 'store/pg/kols'));
const { dashboard } = require(path.join(SRC, 'store/pg/dashboard'));
const { hires } = require(path.join(SRC, 'store/pg/hires'));

test('campaign report list and detail skip Other campaigns', async () => {
    const list = await reports.campaigns({});
    assert.deepEqual(list.map(r => r.id).sort((a, b) => a - b), [71, 74]);
    // แคมเปญเก่าที่ไม่มีคอลัมน์ประเภทต้องยังอยู่ (ถือเป็น KOL)
    assert.ok(list.some(r => r.id === 74));
    assert.equal(await reports.detail(72, null), null);     // งานจ้างอื่น ๆ = ไม่มีรายงาน (route ตอบ 404)
    assert.ok(await reports.detail(71, null));
});

test('Ads page skips posts that belong to an Other campaign', async () => {
    const { rows } = await ads.list({});
    const names = rows.map(r => r.account_name).sort();
    assert.deepEqual(names, ['kolสอง', 'kolหนึ่ง']);
    assert.ok(!rows.some(r => r.project_id === 72));
});

test('Influencer analytics skips Other campaigns', async () => {
    const { rows, summary } = await kols.analytics(null);
    assert.deepEqual(rows.map(r => r.kol_name).sort(), ['kolสอง', 'kolหนึ่ง']);
    assert.equal(summary.total_kols, 2);
});

test('Dashboard keeps Other budget in the totals but reports it separately', async () => {
    const d = await dashboard.overview({});
    // งบรวม = ทุกแคมเปญเหมือนเดิม (100,000 + 35,000 + 9,000 + 50,000)
    assert.equal(d.total_budget, 194000);
    assert.equal(d.total_campaigns, 4);
    assert.equal(d.other_projects, 2);
    assert.equal(d.other_budget, 44000);
    // นับเป็น "คน": ระบุคนเอง 4 แถว (h1-h4) + ใบขอจัดหาอีก 3 คน + งานของ Code Lab 1 คน = 8
    assert.equal(d.other_hires, 8);
    // ตามสิทธิ์แบรนด์: เห็นเฉพาะ Jdent = งานจ้างอื่น ๆ ใบเดียว
    const scoped = await dashboard.overview({ scopeBrands: ['Jdent'] });
    assert.equal(scoped.other_projects, 1);
    assert.equal(scoped.other_budget, 35000);
    assert.equal(scoped.other_hires, 7);
});

test('hires list groups people across Other campaigns and respects brand scope', async () => {
    const all = await hires.list({});
    const by = name => all.rows.find(r => r.name === name && r.kind === 'นางแบบ');
    // มะลิ ถูกจ้าง 2 ครั้งแต่คนละประเภทงาน = คนละแถว (นางแบบ / Live สด)
    assert.deepEqual(all.rows.map(r => `${r.name}·${r.kind}`).sort(),
        ['กุหลาบ·นางแบบ', 'ต้นกล้า·นักแสดง', 'มะลิ·Live สด', 'มะลิ·นางแบบ'].sort());
    assert.equal(all.summary.people, 4);
    assert.equal(all.summary.jobs, 4);          // แถวที่ยังไม่ใส่ชื่อไม่ถูกนับ
    assert.equal(all.summary.total_fee, 44000);
    assert.equal(all.summary.projects, 2);
    assert.deepEqual(by('มะลิ').campaigns, [{ id: 72, name: 'ถ่ายแบบ Sep' }]);
    assert.equal(by('มะลิ').last_fee, 15000);
    assert.equal(by('มะลิ').last_date, '2026-09-10');
    assert.equal(by('มะลิ').agency, 'Model Co');
    // ตัวเลือกประเภทงานมีเฉพาะประเภทที่มีคนจริง — "ช่างภาพ" ยังไม่ได้ใส่ชื่อ จึงไม่ขึ้นเป็นตัวเลือกที่กดแล้วได้ตารางว่าง
    assert.deepEqual(all.kinds, ['Live สด', 'นักแสดง', 'นางแบบ']);

    // สิทธิ์แบรนด์: เห็นเฉพาะ Jdent → ไม่เห็นคนของ Code Lab
    const scoped = await hires.list({ scopeBrands: ['Jdent'] });
    assert.ok(!scoped.rows.some(r => r.name === 'ต้นกล้า'));
    assert.equal(scoped.summary.people, 3);
});

test('casting requests are counted as people to find but never as a hired person', async () => {
    // ใบขอจัดหายังไม่มีชื่อคน → ต้องไม่โผล่ในหน้า "งานจ้างอื่น ๆ" และไม่ถูกนับเป็นครั้งที่จ้าง
    const all = await hires.list({});
    assert.deepEqual(all.rows.filter(r => r.kind === 'นักแสดง').map(r => r.name), ['ต้นกล้า']);
    assert.equal(all.summary.people, 4);
    assert.equal(all.summary.jobs, 4);
    assert.equal(all.summary.total_fee, 44000);   // งบใบขอจัดหาไม่ปนเข้ามาในค่าตัวที่จ่ายจริง
    // แต่ในภาพรวมของ Dashboard ต้องเห็นว่ามีคนรออีก 3 คน
    const d = await dashboard.overview({ scopeBrands: ['Jdent'] });
    assert.equal(d.other_hires, 7);
});


test('casting requests become tasks that reach both the assignee and the requester', async () => {
    // คนที่ถูกมอบหมายต้องเห็นงานของตัวเอง แม้ไม่มีสิทธิ์แบรนด์นั้น (scopeBrands = [] คือไม่เห็นแบรนด์ไหนเลย)
    const forFinder = await hires.tasks({ userId: 7, scopeBrands: [] });
    assert.deepEqual(forFinder.rows.map(r => r.key), ['h5']);
    assert.equal(forFinder.counts.to_find, 1);
    assert.equal(forFinder.counts.to_decide, 0);
    assert.equal(forFinder.rows[0].remaining, 3);
    assert.equal(forFinder.rows[0].budget, 15000);          // งบต่อคน 5,000 × 3 คน

    // คนขอเห็นใบของตัวเอง และถูกนับว่ามีชื่อรอตัดสิน (ต้องยังมีสิทธิ์แบรนด์ของแคมเปญนั้นอยู่)
    const forAsker = await hires.tasks({ userId: 3, scopeBrands: ['Jdent'] });
    assert.equal(forAsker.counts.to_decide, 1);
    assert.equal(forAsker.counts.to_find, 0);
    assert.equal(forAsker.rows[0].waiting_count, 1);        // เสนอมา 2 ชื่อ แต่ตัดสินไปแล้ว 1

    // คนขอที่หลุดสิทธิ์แบรนด์ไปแล้ว ต้องไม่เห็นรายชื่อ/ค่าตัวของใบเก่าอีก (ทางข้ามแบรนด์มีแค่ฝั่งคนจัดหา)
    const lostAccess = await hires.tasks({ userId: 3, scopeBrands: [] });
    assert.equal(lostAccess.rows.length, 0);
    assert.equal(lostAccess.counts.to_decide, 0);

    // คนอื่นที่ไม่มีสิทธิ์แบรนด์ไม่เห็นอะไรเลย · admin (scope = null) เห็นทุกใบ
    assert.equal((await hires.tasks({ userId: 99, scopeBrands: [] })).rows.length, 0);
    assert.equal((await hires.tasks({ userId: 99, scopeBrands: null })).rows.length, 1);

    // ตัวกรอง mine: find = งานที่ต้องหา · ask = ใบที่ตัวเองขอไว้
    assert.equal((await hires.tasks({ userId: 7, scopeBrands: null, mine: 'ask' })).rows.length, 0);
    assert.equal((await hires.tasks({ userId: 7, scopeBrands: null, mine: 'find' })).rows.length, 1);
});

test('people already found stop being counted as still needed', async () => {
    const { hireRemaining, hireRowFee } = require(path.join(SRC, 'store/logic'));
    // หาได้ครบแล้ว = ไม่ต้องหาอีก และงบไม่ถูกนับซ้ำ (คนที่ได้แล้วกลายเป็นแถวของตัวเองที่มีค่าตัวจริง)
    assert.equal(hireRemaining({ mode: 'casting', fee: 5000, headcount: 3, filled: 3 }), 0);
    assert.equal(hireRowFee({ mode: 'casting', fee: 5000, headcount: 3, filled: 3 }), 0);
    assert.equal(hireRowFee({ mode: 'casting', fee: 5000, headcount: 3, filled: 1 }), 10000);
    assert.equal(hireRowFee({ mode: 'direct', fee: 9000 }), 9000);
    // แถวเก่าที่ไม่มี headcount ถือว่าขอ 1 คน
    assert.equal(hireRowFee({ mode: 'casting', fee: 4000 }), 4000);
});


test('uploaded file names from stored JSON can never escape the upload folder', () => {
    const { resolveInside } = require(path.join(SRC, 'store/logic'));
    const dir = path.join(__dirname, 'fake-uploads');
    // ชื่อไฟล์ปกติที่ระบบสร้างเอง ต้องผ่าน
    assert.equal(resolveInside(dir, 'hire_76_1789546271946.jpg'), path.resolve(dir, 'hire_76_1789546271946.jpg'));
    // ชื่อที่ปลอมมาเพื่อไต่ออกนอกโฟลเดอร์ ต้องได้ null ทุกแบบ (ห้ามอ่าน ห้ามลบ)
    for (const bad of ['../.env', '..\\..\\server\\.env', 'sub/file.jpg', 'C:/Windows/win.ini', '/etc/passwd', '..', '.', '', null, 42]) {
        assert.equal(resolveInside(dir, bad), null, 'ต้องปฏิเสธ: ' + String(bad));
    }
});

test('saving hire rows from the form cannot forge server-owned fields', () => {
    const { mergeHireItems, hireRowFee } = require(path.join(SRC, 'store/logic'));
    const current = [
        { key: 'r1', mode: 'casting', kind: 'นักแสดง', fee: 5000, headcount: 3, filled: 2,
          candidates: [{ key: 'c1', name: 'ต้นน้ำ', status: 'เลือกแล้ว' }], requested_by_id: 3, requested_at: '2026-09-01T00:00:00.000Z',
          assignee_id: 7, assignee_name: 'ฟ้า', assigned_at: '2026-09-02T00:00:00.000Z',
          image: { filename: 'hire_72_1.jpg' } },
        { key: 'r2', mode: 'direct', name: 'มะลิ', fee: 12000, image: { filename: 'hire_72_2.jpg' }, from_request: 'r1' }
    ];
    // หน้าเว็บ (ที่ถือข้อมูลเก่า หรือจงใจปลอม) ส่งมาทั้งก้อน
    const incoming = [
        { key: 'r1', mode: 'casting', kind: 'นักแสดง', fee: 6000, headcount: 1, filled: 0, candidates: [],
          requested_by_id: 99, assignee_id: 7, image: { filename: '../../server/.env' } },
        { key: 'r2', mode: 'direct', name: 'มะลิ', fee: 12000, image: { filename: '../.env' }, from_request: null },
        { key: 'new1', mode: 'casting', kind: 'นางแบบ', fee: 3000, headcount: 2, filled: 5,
          candidates: [{ key: 'x', name: 'ปลอม', status: 'เลือกแล้ว' }], assignee_id: 55, image: { filename: 'evil.jpg' } },
        { key: 'r2', mode: 'direct', name: 'ซ้ำ key', fee: 1, image: { filename: 'x.jpg' } }
    ];
    const users = { 55: { id: 55, name: 'บีม' } };
    const out = mergeHireItems(current, incoming, { userId: 3, at: '2026-09-17T00:00:00.000Z', users });

    // แถวเดิม: ฟิลด์ฝั่งระบบยึดจากฐาน ไม่ใช่จากหน้าเว็บ
    assert.deepEqual(out[0].candidates, current[0].candidates);
    assert.equal(out[0].filled, 2);
    assert.equal(out[0].requested_by_id, 3);
    assert.equal(out[0].image.filename, 'hire_72_1.jpg');
    assert.equal(out[0].headcount, 2, 'ลดจำนวนต่ำกว่าคนที่หาได้แล้วไม่ได้');
    assert.equal(out[0].assignee_name, 'ฟ้า');
    assert.equal(out[0].fee, 6000, 'ฟิลด์ที่ฟอร์มแก้ได้จริงต้องเปลี่ยนตาม');
    assert.equal(out[1].image.filename, 'hire_72_2.jpg');
    assert.equal(out[1].from_request, 'r1');

    // แถวใหม่: ล้างของปลอมทิ้งทั้งหมด แต่ประทับคนขอ และรับคนจัดหาที่ตรวจกับฐานแล้ว
    assert.equal(out[2].image, null);
    assert.deepEqual(out[2].candidates, []);
    assert.equal(out[2].filled, 0);
    assert.equal(out[2].requested_by_id, 3);
    assert.equal(out[2].assignee_id, 55);
    assert.equal(out[2].assignee_name, 'บีม');

    // key ซ้ำในก้อนเดียวกัน = แถวใหม่ ห้ามได้ไฟล์ของแถวเดิมไป
    assert.notEqual(out[3].key, 'r2');
    assert.equal(out[3].image, null);

    // คนจัดหาที่ไม่ผ่านการตรวจกับฐาน (ปลอม/ถูกปิดบัญชี) ถูกถอดออก
    const forged = mergeHireItems([], [{ key: 'n', mode: 'casting', kind: 'x', fee: 1, headcount: 1, assignee_id: 123 }], { users: {} });
    assert.equal(forged[0].assignee_id, null);

    // งบคิดจากแถวที่รวมแล้ว: ใบขอจัดหาเหลือหาอีก 0 คน (2 จาก 2) + มะลิ 12,000 + ใบใหม่ 3,000 × 2 + ซ้ำ key 1
    assert.equal(out.reduce((s, it) => s + hireRowFee(it), 0), 0 + 12000 + 6000 + 1);
});

test('stale saves are detected by comparing the exact update time', () => {
    const { sameInstant } = require(path.join(SRC, 'store/logic'));
    assert.equal(sameInstant('2026-09-17T03:12:45.123Z', new Date('2026-09-17T03:12:45.123Z')), true);
    assert.equal(sameInstant('2026-09-17T03:12:45.123Z', '2026-09-17T03:12:45.124Z'), false);
    assert.equal(sameInstant(null, null), false, 'ไม่มีค่าให้เทียบ = ถือว่าเก่า ห้ามบันทึกทับ');
    assert.equal(sameInstant('2026-09-17T03:12:45.123Z', undefined), false);
});


test('brief file names from the campaign form are never trusted', () => {
    const { mergeBriefFiles } = require(path.join(SRC, 'store/logic'));
    const current = { A1: { link: 'x', file: { filename: 'brief_71_1.pdf', original: 'a.pdf' } } };
    const incoming = {
        A1: { link: 'ลิงก์ใหม่', file: { filename: '../../.pm2/dump.pm2' } },   // ปลอมชื่อไฟล์ของแถวเดิม
        B2: { link: null, file: { filename: 'brief_99_9.pdf' } },               // แถวใหม่อ้างไฟล์ของแคมเปญอื่น
        C3: { link: 'y', file: null }                                         // ส่ง null = เอาไฟล์ออก
    };
    const out = mergeBriefFiles(current, incoming);
    assert.deepEqual(out.A1, { link: 'ลิงก์ใหม่', file: current.A1.file }, 'แถวเดิมยึดไฟล์จากฐาน ลิงก์แก้ได้');
    assert.equal(out.B2.file, null, 'แถวใหม่ห้ามได้ไฟล์จากหน้าเว็บ');
    assert.equal(out.C3.file, null);
    assert.equal(mergeBriefFiles({ A1: current.A1 }, { A1: { link: 'x', file: null } }).A1.file, null, 'เอาไฟล์ออกได้');
    assert.deepEqual(mergeBriefFiles(current, 'ไม่ใช่ object'), {});
});

test('fees and headcounts from the browser are clamped to sane values', () => {
    const { cleanFee, cleanHeadcount, mergeHireItems, hireRowFee, safeId, safeSlug } = require(path.join(SRC, 'store/logic'));
    assert.equal(cleanFee(-5000), 0);
    assert.equal(cleanFee('abc'), 0);
    assert.equal(cleanFee(Infinity), 0);
    assert.equal(cleanFee('3500.456'), 3500.46);
    assert.equal(cleanFee(1e15), 100000000);
    assert.equal(cleanHeadcount(0), 1);
    assert.equal(cleanHeadcount(-3), 1);
    assert.equal(cleanHeadcount(2.9), 2);
    assert.equal(cleanHeadcount(1e9), 999);
    // งบรวมของแคมเปญต้องไม่ติดลบ แม้หน้าเว็บส่งค่าตัวติดลบมา
    const rows = mergeHireItems([], [
        { key: 'a', mode: 'direct', name: 'x', fee: -9999 },
        { key: 'b', mode: 'casting', kind: 'y', fee: 1000, headcount: -5 }
    ], {});
    assert.equal(rows.reduce((s, it) => s + hireRowFee(it), 0), 1000);
    // ชื่อไฟล์จาก route param
    assert.equal(safeId('76'), '76');
    assert.equal(safeId('..%2F..%2Fx'), '0');
    assert.equal(safeId('../x'), '0');
    assert.equal(safeSlug('quotation'), 'quotation');
    assert.equal(safeSlug('../../etc'), 'file');
});

test('hires list filters by kind, brand, search and date range', async () => {
    assert.deepEqual((await hires.list({ kind: 'Live สด' })).rows.map(r => r.name), ['มะลิ']);
    assert.deepEqual((await hires.list({ brand: 'Code Lab' })).rows.map(r => r.name), ['ต้นกล้า']);
    assert.deepEqual((await hires.list({ search: 'model co' })).rows.map(r => r.name).sort(), ['กุหลาบ', 'มะลิ']);
    // ช่วงวัน: เอาเฉพาะงานวันที่ 20 ขึ้นไป — เหลือ Live สด ของมะลิ
    const late = await hires.list({ from: '2026-09-15' });
    assert.deepEqual(late.rows.map(r => `${r.name}·${r.kind}`), ['มะลิ·Live สด']);
    assert.equal(late.summary.jobs, 1);
    // ค่าเฉลี่ยคิดจากจำนวนครั้งที่จ้างของคนนั้น
    const mali = (await hires.list({ kind: 'นางแบบ' })).rows.find(r => r.name === 'มะลิ');
    assert.equal(mali.jobs, 1);
    assert.equal(mali.avg_fee, 15000);
});
