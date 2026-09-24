const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// กลุ่ม "-" (ไม่ใช้ Gencode) ในฟอร์มแคมเปญ — เก็บเป็น no_gencode: true ใน projects.ad_groups
// · นับเฉพาะ true ตรงตัว ห้ามเดาจาก code_expire (มีโค้ด `|| 60` หลายจุดที่กลบ 0 / ว่าง เงียบ ๆ)
// · โพสต์ที่มี Gencode อยู่แล้วทำงานเหมือนเดิมทุกอย่าง · submissions.code_expire ไม่ถูกแตะ
// · ฟอร์มแท็บเก่าไม่ส่งคีย์นี้มา → server ยกค่าเดิมในฐานไว้ (carryNoGencode)
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-no-gencode-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in no-gencode test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// วันที่ลงงาน = 10 วันก่อน (เวลาท้องถิ่น ตรงกับที่ kols.analytics แปลง 'YYYY-MM-DD' + 'T00:00:00')
const pad = n => String(n).padStart(2, '0');
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const POSTED = daysAgo(10);
// สูตรเดียวกับ kols.analytics — ใช้เทียบว่าแถวปกติยังได้ Day Left ตามเดิม
const dayLeftOf = (postDate, days) => Math.ceil((new Date(postDate + 'T00:00:00').getTime() + days * 86400000 - Date.now()) / 86400000);

// snapshot จำลอง — ต้องสลับก่อนโหลด store เพราะ pg/kols และ pg/ads หยิบ loadSnapshot ออกไปตอน require
const BLOCKS = [{ platform: 'TikTok', products: ['L3'] }];
const SUB = fields => ({
    project_id: 51, person_key: null, clip_no: 1, platform: 'TikTok', product: 'L3', agency: 'Agency A',
    status: 'confirmed', budget: 5000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0, post_check: null,
    post_url: 'https://example.test/p', link_account: null, post_date: POSTED, gen_date: null, ad_end: null,
    group_key: null, gencode: null, id_post: null, code_expire: 60, content_type: null, content_format: null, ...fields
});
const FIXTURE = {
    teams: [{ id: 1, name: 'ทีม A' }],
    projects: [{
        id: 51, name: 'แคมเปญ Gencode', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active',
        start_date: '2026-09-01', products: ['L3'],
        ad_groups: [
            // กลุ่ม "-" — code_expire ของกลุ่มยังเก็บจำนวนวันไว้
            { key: 'g-none', name: 'กลุ่มไม่ใช้โค้ด', code_expire: 60, no_gencode: true, blocks: BLOCKS },
            { key: 'g-norm', name: 'กลุ่มปกติ', code_expire: 60, blocks: BLOCKS },
            // ค่าที่ห้ามนับเป็น "-": สตริง 'true' / code_expire 0
            { key: 'g-str', name: 'สตริง', code_expire: 0, no_gencode: 'true', blocks: BLOCKS }
        ]
    }],
    submissions: [
        SUB({ id: 1, account_name: 'ไม่ใช้โค้ด', group_key: 'g-none' }),
        SUB({ id: 2, account_name: 'มีโค้ดเดิม', group_key: 'g-none', gencode: 'ABC123' }),
        SUB({ id: 3, account_name: 'โค้ดช่องว่าง', group_key: 'g-none', gencode: '   ' }),
        SUB({ id: 4, account_name: 'กลุ่มปกติ', group_key: 'g-norm' }),
        SUB({ id: 5, account_name: 'สตริงจริง', group_key: 'g-str', code_expire: 30 }),
        SUB({ id: 6, account_name: 'ไม่มีกลุ่ม', group_key: null })
    ]
};
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};

const logic = require(path.join(SRC, 'store/logic'));
const { groupNoGencode, postNoGencode, carryNoGencode, carryProductConcepts, carryProductBudgets, carryProductTargets } = logic;
const kols = require(path.join(SRC, 'store/pg/kols'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web; // client/src/data/adGroups.js (ESM)
let server, base;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
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

// ---------------------------------------------------------------- ตรรกะล้วน

test('groupNoGencode: only a literal true counts — never guessed from code_expire', () => {
    for (const g of [null, undefined, {}, { code_expire: 0 }, { code_expire: '' }, { code_expire: null },
        { no_gencode: 'true' }, { no_gencode: 1 }, { no_gencode: false }, { no_gencode: null }]) {
        assert.equal(groupNoGencode(g), false, JSON.stringify(g));
    }
    assert.equal(groupNoGencode({ no_gencode: true }), true);
    assert.equal(groupNoGencode({ no_gencode: true, code_expire: 60 }), true, 'จำนวนวันที่เก็บไว้ไม่ทำให้หลุดจาก "-"');
});

test('postNoGencode: a post that already has a gencode keeps behaving as today', () => {
    const none = { key: 'g1', no_gencode: true, code_expire: 60 };
    assert.equal(postNoGencode({ gencode: 'ABC123' }, none), false, 'มี Gencode อยู่แล้ว = ใช้ตามเดิม');
    assert.equal(postNoGencode({ gencode: '  ABC  ' }, none), false);
    for (const s of [{ gencode: null }, { gencode: '' }, { gencode: '  ' }, {}, null, undefined]) {
        assert.equal(postNoGencode(s, none), true, JSON.stringify(s));
    }
    // กลุ่มที่ไม่ใช่ "-" ไม่ว่าแถวจะว่างแค่ไหนก็ไม่นับ
    for (const g of [null, {}, { code_expire: 0 }, { no_gencode: 'true' }]) {
        assert.equal(postNoGencode({ gencode: '' }, g), false, JSON.stringify(g));
    }
});

test('carryNoGencode: a stale form (no key) keeps what is stored; a new form decides with a real boolean', () => {
    const stored = [{ key: 'g1', no_gencode: true, code_expire: 60 }, { key: 'g2', no_gencode: false }, { key: 'g3' }];
    // แท็บเก่า: ในฐานเป็น true → true · false หรือไม่มีคีย์ → false
    assert.deepEqual(carryNoGencode([{ key: 'g1', code_expire: 60 }, { key: 'g2' }, { key: 'g3' }], stored).map(g => g.no_gencode),
        [true, false, false]);
    // ฟอร์มใหม่ส่ง false ทั้งที่ในฐานเป็น true → ผู้ใช้ปลดเอง
    assert.equal(carryNoGencode([{ key: 'g1', no_gencode: false }], stored)[0].no_gencode, false);
    assert.equal(carryNoGencode([{ key: 'g3', no_gencode: true }], stored)[0].no_gencode, true);
    // สตริง 'true' / ตัวเลข 1 ไม่นับ (แม้ในฐานเป็น true)
    assert.equal(carryNoGencode([{ key: 'g1', no_gencode: 'true' }], stored)[0].no_gencode, false);
    assert.equal(carryNoGencode([{ key: 'g1', no_gencode: 1 }], stored)[0].no_gencode, false);
    // null = ส่งคีย์มาแล้ว (ไม่ใช่แท็บเก่า) → false
    assert.equal(carryNoGencode([{ key: 'g1', no_gencode: null }], stored)[0].no_gencode, false);
    // กลุ่มใหม่ที่ key ไม่ตรงในฐาน / ไม่มี key เลย → false
    assert.equal(carryNoGencode([{ key: 'new' }], stored)[0].no_gencode, false);
    assert.equal(carryNoGencode([{ name: 'ไม่มี key' }], [{ no_gencode: true }])[0].no_gencode, false);
    // code_expire ของกลุ่มไม่ถูกแตะ
    assert.equal(carryNoGencode([{ key: 'g1', code_expire: 90 }], stored)[0].code_expire, 90);
});

test('carryNoGencode: odd inputs pass through; stored that is not an array still yields a boolean', () => {
    const stored = [{ key: 'g1', no_gencode: true }];
    assert.equal(carryNoGencode(null, stored), null);
    assert.equal(carryNoGencode(undefined, stored), undefined);
    const obj = { key: 'g1' };
    assert.equal(carryNoGencode(obj, stored), obj);
    assert.deepEqual(carryNoGencode([null, 'x', { key: 'g1' }], stored), [null, 'x', { key: 'g1', no_gencode: true }]);
    for (const bad of [null, undefined, {}, 'x']) {
        assert.deepEqual(carryNoGencode([{ key: 'g1' }, { key: 'g2', no_gencode: true }], bad).map(g => g.no_gencode), [false, true],
            JSON.stringify(bad));
    }
    // ไม่แก้ของที่ส่งเข้ามา
    const incoming = [{ key: 'g1' }];
    const storedCopy = structuredClone(stored);
    carryNoGencode(incoming, stored);
    assert.deepEqual(incoming, [{ key: 'g1' }]);
    assert.deepEqual(stored, storedCopy);
});

test('carryNoGencode chained after carryProductConcepts keeps both carry-overs of a stale form', () => {
    const stored = [{ key: 'g1', concept: 'กันแดด', no_gencode: true,
        blocks: [{ platform: 'TikTok', products: ['L3', 'L4'], concept_split: true, product_concepts: { L3: 'ไม่วอก', L4: 'ฝ้าจาง' } }] }];
    // แท็บเก่า: ไม่มีทั้ง concept_split และ no_gencode
    const stale = [{ key: 'g1', concept: 'กันแดด', blocks: [{ platform: 'TikTok', products: ['L3', 'L4'] }] }];
    const chain = (incoming, s) => carryNoGencode(carryProductConcepts(carryProductBudgets(carryProductTargets(incoming, s), s), s), s);
    const [g] = chain(stale, stored);
    assert.equal(g.no_gencode, true);
    assert.equal(g.blocks[0].concept_split, true);
    assert.deepEqual(g.blocks[0].product_concepts, { L3: 'ไม่วอก', L4: 'ฝ้าจาง' });
    // ฟอร์มใหม่ปลด "-" แต่ยังเป็นแท็บเก่าเรื่อง Concept → Concept ยังถูกยกมา
    const [g2] = chain([{ ...stale[0], no_gencode: false }], stored);
    assert.equal(g2.no_gencode, false);
    assert.equal(g2.blocks[0].concept_split, true);
});

// ---------------------------------------------------------------- หน้าเว็บต้องตัดสินเหมือน server

test('client adGroups.js groupNoGencode / postNoGencode match the server exactly', () => {
    assert.equal(typeof web.groupNoGencode, 'function', 'client/src/data/adGroups.js ต้อง export groupNoGencode');
    assert.equal(typeof web.postNoGencode, 'function', 'client/src/data/adGroups.js ต้อง export postNoGencode');
    // "ทุกตัวอักษร" — โค้ดสองฝั่งต้องเหมือนกัน
    assert.equal(String(web.groupNoGencode), String(groupNoGencode));
    assert.equal(String(web.postNoGencode), String(postNoGencode));
    const groups = [null, undefined, {}, [], 'x', 0, true, { code_expire: 0 }, { code_expire: '' }, { code_expire: null },
        { no_gencode: true }, { no_gencode: 'true' }, { no_gencode: 1 }, { no_gencode: false }, { no_gencode: null },
        { no_gencode: true, code_expire: 0 }, { no_gencode: true, code_expire: 60 }];
    const posts = [null, undefined, {}, { gencode: null }, { gencode: undefined }, { gencode: '' }, { gencode: '  ' },
        { gencode: '\t\n' }, { gencode: 'ABC' }, { gencode: ' ABC ' }, { gencode: 0 }, { gencode: 123 }, { gencode: false }];
    for (const g of groups) {
        assert.equal(web.groupNoGencode(g), groupNoGencode(g), `group ${JSON.stringify(g)}`);
        for (const s of posts) {
            assert.equal(web.postNoGencode(s, g), postNoGencode(s, g), `post ${JSON.stringify(s)} · group ${JSON.stringify(g)}`);
        }
    }
});

// ---------------------------------------------------------------- store (snapshot จำลอง)

test('Influencer page: a no-gencode post has no_gencode true and no Day Left; other posts keep theirs', async () => {
    const { rows } = await kols.analytics(null);
    const by = name => rows.find(r => r.kol_name === name);
    const none = by('ไม่ใช้โค้ด');
    assert.equal(none.no_gencode, true);
    assert.equal(none.day_left, null, 'ไม่มีวันหมดอายุให้นับ (ไม่ขึ้น "หมดอายุแล้ว")');
    assert.equal(none.days, 0);
    assert.equal(by('โค้ดช่องว่าง').no_gencode, true);
    assert.equal(by('โค้ดช่องว่าง').day_left, null);
    // มี Gencode อยู่แล้วในกลุ่ม "-" → เหมือนเดิม
    const kept = by('มีโค้ดเดิม');
    assert.deepEqual([kept.no_gencode, kept.days, kept.day_left, kept.gencode], [false, 60, dayLeftOf(POSTED, 60), 'ABC123']);
    // กลุ่มปกติ / สตริง 'true' / ไม่มีกลุ่ม → นับ Day Left ตามเดิมจาก code_expire ของแถว
    assert.deepEqual([by('กลุ่มปกติ').no_gencode, by('กลุ่มปกติ').day_left], [false, dayLeftOf(POSTED, 60)]);
    assert.deepEqual([by('สตริงจริง').no_gencode, by('สตริงจริง').days, by('สตริงจริง').day_left], [false, 30, dayLeftOf(POSTED, 30)]);
    assert.deepEqual([by('ไม่มีกลุ่ม').no_gencode, by('ไม่มีกลุ่ม').day_left], [false, dayLeftOf(POSTED, 60)]);
    assert.ok(rows.every(r => typeof r.no_gencode === 'boolean'));
});

test('Ads page: each row carries no_gencode (empty gencode in a "-" group only)', async () => {
    const { rows } = await ads.list({});
    const by = name => rows.find(r => r.account_name === name);
    assert.equal(rows.length, 6);
    assert.deepEqual([by('ไม่ใช้โค้ด').no_gencode, by('ไม่ใช้โค้ด').gencode], [true, null]);
    assert.equal(by('โค้ดช่องว่าง').no_gencode, true);
    assert.deepEqual([by('มีโค้ดเดิม').no_gencode, by('มีโค้ดเดิม').gencode], [false, 'ABC123']);
    for (const name of ['กลุ่มปกติ', 'สตริงจริง', 'ไม่มีกลุ่ม']) assert.equal(by(name).no_gencode, false, name);
    assert.ok(rows.every(r => typeof r.no_gencode === 'boolean'));
});

test('ads.list and kols.analytics flag the same posts', async () => {
    const a = (await ads.list({})).rows.filter(r => r.no_gencode).map(r => r.sub_id).sort();
    const k = (await kols.analytics(null)).rows.filter(r => r.no_gencode).map(r => r.sub_id).sort();
    assert.deepEqual(a, [1, 3]);
    assert.deepEqual(k, a);
});

// ---------------------------------------------------------------- PUT /api/projects/:id (store จำลอง)

test('PUT /api/projects/:id: an old form keeps a stored "-"; a new form sending false clears it', async () => {
    const U = '2026-09-22T01:00:00.000Z';
    let project = { id: 80, name: 'แคมเปญ', brand: 'Jdent', team_id: 1, campaign_type: 'kol', status: 'Active', updated_at: U,
        ad_groups: [
            { key: 'g1', name: 'กลุ่ม 1', code_expire: 60, no_gencode: true, concept: 'กันแดด', blocks: BLOCKS },
            { key: 'g2', name: 'กลุ่ม 2', code_expire: 30, blocks: BLOCKS }
        ] };
    const updates = [];
    store.projects.findByIdFull = async id => (String(id) === '80' ? structuredClone(project) : null);
    store.projects.update = async (id, fields) => {
        updates.push(structuredClone(fields));
        project = { ...project, ...fields };
        return structuredClone(project);
    };
    store.activity.log = async () => {};
    const put = body => fetch(`${base}/api/projects/80`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    // ฟอร์มรุ่นเก่า: ส่งกลุ่มครบแต่ไม่มีคีย์ no_gencode
    const oldGroups = () => project.ad_groups.map(({ no_gencode, ...g }) => g);

    let res = await put({ name: 'แคมเปญ', ad_groups: oldGroups() });
    assert.equal(res.status, 200);
    let saved = updates.at(-1).ad_groups;
    assert.deepEqual(saved.map(g => g.no_gencode), [true, false], 'แท็บเก่าบันทึกแล้ว "-" ต้องไม่หาย');
    assert.deepEqual(saved.map(g => g.code_expire), [60, 30], 'จำนวนวันของกลุ่มไม่ถูกแตะ');

    // แท็บเก่าเพิ่มกลุ่มใหม่ (ยังไม่มี key ในฐาน) → false
    res = await put({ name: 'แคมเปญ', ad_groups: [...oldGroups(), { key: 'g3', name: 'กลุ่มใหม่', code_expire: 60, blocks: BLOCKS }] });
    assert.equal(res.status, 200);
    assert.deepEqual(updates.at(-1).ad_groups.map(g => g.no_gencode), [true, false, false]);

    // ฟอร์มใหม่ส่ง false → ปลด "-" · ตั้งกลุ่มอื่นเป็น "-" ได้
    res = await put({ name: 'แคมเปญ', ad_groups: project.ad_groups.map(g => ({ ...g, no_gencode: g.key === 'g2' })) });
    assert.equal(res.status, 200);
    saved = updates.at(-1).ad_groups;
    assert.deepEqual(saved.map(g => [g.key, g.no_gencode]), [['g1', false], ['g2', true], ['g3', false]]);
    assert.equal(saved[0].code_expire, 60);

    // สตริง 'true' ที่ยิงตรงมาไม่นับ
    res = await put({ name: 'แคมเปญ', ad_groups: project.ad_groups.map(g => ({ ...g, no_gencode: 'true' })) });
    assert.equal(res.status, 200);
    assert.ok(updates.at(-1).ad_groups.every(g => g.no_gencode === false));

    // คำขอที่ไม่ส่ง ad_groups (เปลี่ยนสถานะ) ไม่แตะกลุ่ม
    res = await put({ status: 'Completed' });
    assert.equal(res.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(updates.at(-1), 'ad_groups'), false);
});

// กลุ่มที่ไม่ใช้ Gencode ไม่ได้ยิงแอด → ฟอร์มปิดช่อง Campaign / Content Type
// ตัวตรวจฟอร์มจึงต้องไม่บังคับสองช่องนี้ ไม่งั้นสร้างแคมเปญใหม่ไม่ได้เลย (ไม่มีช่องให้กรอก)
test('setTypeOk: กลุ่มที่ไม่ใช้ Gencode ไม่บังคับ Campaign / Content Type', () => {
    const on = { no_gencode: true };
    const off = { no_gencode: false };
    const empty = { campaign: '', content_type: '' };

    // ปกติ: TikTok และ Platform อื่นบังคับ Content Type
    assert.equal(web.setTypeOk(off, 'TikTok', empty), false);
    assert.equal(web.setTypeOk(off, 'TikTok', { content_type: 'Review' }), true);
    assert.equal(web.setTypeOk(off, 'Lemon8', empty), false);
    // TikTok ไม่เคยบังคับ Campaign (ของเดิมเป็นแบบนี้อยู่แล้ว)
    assert.equal(web.setTypeOk(off, 'TikTok', { content_type: 'Review', campaign: '' }), true);
    // Facebook / Instagram บังคับที่ช่อง Campaign แทน
    assert.equal(web.setTypeOk(off, 'Facebook', { content_type: 'Review' }), false);
    assert.equal(web.setTypeOk(off, 'Facebook', { campaign: 'Awareness' }), true);
    assert.equal(web.setTypeOk(off, 'Instagram', { campaign: 'Reels' }), true);

    // ไม่ใช้ Gencode: ผ่านหมดทุก Platform แม้ไม่กรอกอะไรเลย
    ['TikTok', 'Facebook', 'Instagram', 'Lemon8', 'X', ''].forEach(p => {
        assert.equal(web.setTypeOk(on, p, empty), true, 'ไม่ใช้ Gencode + ' + p);
        assert.equal(web.setTypeOk(on, p, {}), true, 'ไม่ใช้ Gencode (ชุดว่าง) + ' + p);
    });

    // ค่าที่เคยกรอกไว้ยังอยู่ — ปิดช่องไม่ได้แปลว่าล้างค่า
    assert.equal(web.setTypeOk(on, 'TikTok', { content_type: 'Review' }), true);

    // ชุดที่ไม่มีข้อมูลเลย / กลุ่มไม่ถูกต้อง ต้องไม่ระเบิด
    assert.equal(web.setTypeOk(null, 'TikTok', null), false);
    assert.equal(web.setTypeOk(undefined, 'Facebook', undefined), false);
    // เดาจาก code_expire ไม่ได้ ต้องเป็น no_gencode: true ตรงตัวเท่านั้น (กติกาเดียวกับ groupNoGencode)
    assert.equal(web.setTypeOk({ code_expire: 0 }, 'TikTok', empty), false);
    assert.equal(web.setTypeOk({ no_gencode: 'true' }, 'TikTok', empty), false);
});

// ตัวตรวจในฟอร์มต้องเรียก setTypeOk จริง ไม่ใช่ก๊อปเงื่อนไขไปเขียนเองจนหลุดกัน
test('ProjectForm ใช้ setTypeOk ในตัวตรวจฟอร์ม', () => {
    const form = fs.readFileSync(path.join(__dirname, '../client/src/components/ProjectForm.jsx'), 'utf8');
    assert.ok(form.includes('setTypeOk(g, b.platform, s)'), 'validate() ต้องเรียก setTypeOk');
    assert.ok(!form.includes('campaignIsCtype(b.platform) ? s.campaign : s.content_type'), 'ต้องไม่เหลือเงื่อนไขเก่าที่ก๊อปไว้');
});
