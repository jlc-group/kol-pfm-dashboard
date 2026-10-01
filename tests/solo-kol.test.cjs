const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026)
// ตรรกะล้วน (soloKol.js) + เส้น API ด้วย store จำลอง — ไม่แตะฐานข้อมูล (ฐานของระบบคือ production)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-solo-test-'));
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in solo-kol test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// ทรานแซกชันจำลอง — เก็บคำสั่ง SQL ไว้ตรวจ createSolo / syncSoloBudget (ต้องสลับก่อนโหลด pg/projects.js)
const base = require(path.join(SRC, 'store/pg/_base'));
const fake = { sql: [], rows: {}, seq: 100, sums: {} };
const fakeClient = {
    async query(q, vals = []) {
        fake.sql.push({ q, vals });
        const ins = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(q);
        if (ins) {
            const cols = ins[2].split(',').map(s => s.trim().replace(/"/g, ''));
            const row = { id: ++fake.seq };
            cols.forEach((c, i) => { row[c] = vals[i]; });
            (fake.rows[ins[1]] = fake.rows[ins[1]] || []).push(row);
            return { rows: [row], rowCount: 1 };
        }
        if (/^SELECT campaign_type, ad_groups FROM projects/.test(q)) return { rows: fake.lock ? [fake.lock] : [] };
        if (/^SELECT \* FROM projects WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: fake.proj ? [structuredClone(fake.proj)] : [] };
        if (/^SELECT \* FROM submissions WHERE project_id = \$1 ORDER BY clip_no/.test(q)) return { rows: structuredClone(fake.clips || []) };
        if (/^DELETE FROM submissions WHERE id = \$1/.test(q)) return { rows: [], rowCount: 1 };
        if (/^UPDATE submissions SET/.test(q)) return { rows: [{ id: vals[vals.length - 1] }] };
        if (/^SELECT id, status, batch_id FROM installments/.test(q)) return { rows: structuredClone((fake.its || []).filter(i => i.agency === vals[1])) };
        if (/^UPDATE installments SET agency/.test(q)) return { rows: [], rowCount: 1 };
        if (/SUM\(budget\)/.test(q)) return { rows: [{ total: fake.sums[vals[0]] || 0 }] };
        if (/^UPDATE projects SET/.test(q)) return { rows: [{ id: vals[vals.length - 1], updated: true }] };
        throw new Error('unexpected SQL in fake client: ' + q.slice(0, 80));
    }
};
base.withTransaction = async fn => fn(fakeClient);

const solo = require(path.join(SRC, 'store/soloKol'));
const logic = require(path.join(SRC, 'store/logic'));

const GOOD = {
    account_name: '@flow3rgurrl', platform: 'TikTok', link_account: 'https://www.tiktok.com/@flow3rgurrl', followers: 85000,
    tier: 'Micro 10k - 100k', contact_mode: 'self', brand: 'Beauterry', products: ['BTA4-01', 'BTA4-02'],
    content_type: 'Review', campaign: 'VDO View', media_type: 'VDO', content_format: 'Review',
    clips: 1, fee: 5000, owner: 'แพรว', hire_date: '2026-10-01', due_date: '2026-10-10',
    target: ['F_Beauty-Make up_18-44'], code_expire: 60
};
const inputOf = over => { const r = solo.soloInput({ ...GOOD, ...over }); assert.ok(r.input, JSON.stringify(r)); return r.input; };
const errOf = over => solo.soloInput({ ...GOOD, ...over }).error;

// ---------------------------------------------------------------- ตรวจค่า
test('soloInput: ช่องบังคับ · ค่าตัวบังคับมากกว่า 0 · Agency ต้องมีชื่อ · ลิงก์ต้องเป็น http', () => {
    assert.match(errOf({ account_name: '  ' }), /ชื่อบัญชี KOL/);
    assert.match(errOf({ account_name: '@@@' }), /ชื่อบัญชี KOL/);
    assert.match(errOf({ platform: 'MySpace' }), /Platform/);
    assert.match(errOf({ tier: '' }), /Tier/);
    assert.match(errOf({ contact_mode: 'phone' }), /ช่องทางติดต่อ/);
    assert.match(errOf({ contact_mode: 'agency', agency: ' ' }), /ชื่อ Agency/);
    assert.match(errOf({ brand: '' }), /แบรนด์/);
    assert.match(errOf({ products: [] }), /สินค้าอย่างน้อย 1/);
    assert.match(errOf({ products: 'BTA4-01' }), /สินค้าอย่างน้อย 1/);
    assert.match(errOf({ content_type: '' }), /Content Type/);
    for (const fee of [0, -1, '', null, 'ห้าพัน', undefined, 0.004]) assert.match(errOf({ fee }), /ค่าตัวต่อคลิป/, String(fee));
    assert.match(errOf({ fee: 10000001 }), /สูงเกินไป/, 'เพดานเดียวกับเส้นแก้ค่าตัว (10 ล้าน/คลิป)');
    assert.equal(inputOf({ fee: 10000000 }).fee, 10000000);
    assert.match(errOf({ clips: 0 }), /1-5/);
    assert.match(errOf({ clips: 6 }), /1-5/);
    assert.match(errOf({ clips: 1.5 }), /1-5/);
    assert.match(errOf({ owner: '' }), /ผู้ดูแล/);
    assert.match(errOf({ hire_date: '1/10/2026' }), /วันที่จ้าง/);
    assert.match(errOf({ due_date: '2026-09-01' }), /ไม่ก่อนวันที่จ้าง/);
    assert.match(errOf({ link_account: 'www.tiktok.com/x' }), /ลิงก์ช่อง/);
    assert.match(errOf({ brief_link: 'javascript:alert(1)' }), /ลิงก์บรีฟ/);
    assert.match(errOf({ code_expire: 45 }), /อายุ Gencode/);
    assert.match(errOf({ followers: -5 }), /ผู้ติดตาม/);
    assert.match(errOf({ campaign: 'Awareness' }), /Campaign ไม่ถูกต้อง/);
});

test('soloInput: ตัด @ หน้าชื่อ · ค่าตัวรับคอมมา · Agency เก็บชื่อ · ชื่อคลิปว่าง = คลิป n · ชื่อคลิปซ้ำไม่ได้', () => {
    const a = inputOf({ fee: '5,000.50', contact_mode: 'agency', agency: ' Star Model ' });
    assert.equal(a.account_name, 'flow3rgurrl');
    assert.equal(a.fee, 5000.5);
    assert.equal(a.agency, 'Star Model');
    const b = inputOf({ clips: 3, clip_names: ['ถ่ายรีวิว', '', ' '] });
    assert.deepEqual(b.clip_names, ['ถ่ายรีวิว', 'คลิป 2', 'คลิป 3']);
    assert.deepEqual(inputOf({ clips: 1, clip_names: ['x'] }).clip_names, [], '1 คลิปไม่มีชื่อคลิป');
    assert.match(errOf({ clips: 2, clip_names: ['A', 'A'] }), /ชื่อคลิปซ้ำ/);
    assert.equal(inputOf({ contact_mode: 'self', agency: 'ไม่ควรเก็บ' }).agency, null, 'ติดต่อเองไม่เก็บชื่อ Agency');
});

test('soloInput: Facebook/Instagram ใช้ Campaign เป็น Content Type · Platform อื่นไม่มี Target/Campaign', () => {
    assert.match(errOf({ platform: 'Instagram', content_type: 'Review' }), /Awareness \/ Engagement \/ Reels/);
    const ig = inputOf({ platform: 'Instagram', content_type: 'Reels', campaign: 'VDO View' });
    assert.equal(ig.campaign, 'Reels');
    assert.deepEqual(ig.target, [], 'IG ไม่มี Target');
    const l8 = inputOf({ platform: 'Lemon8', campaign: 'Reach' });
    assert.equal(l8.campaign, null, 'Lemon8 ไม่มี Campaign');
});

// ---------------------------------------------------------------- กลุ่มโฆษณา (อ่านด้วยตัวอ่านเดิมของระบบได้)
test('buildSoloGroup: ตัวอ่านกลุ่มของ server (หน้า Ads / ฟีด) อ่านค่าได้ครบ', () => {
    const i = inputOf({ clips: 2, clip_names: ['A', 'B'], contact_mode: 'agency', agency: 'Star Model' });
    const g = solo.buildSoloGroup(i, 'gX');
    assert.deepEqual(logic.resolveGroupClips(g, 'TikTok'), ['A', 'B']);
    assert.deepEqual(logic.resolveGroupTarget(g, 'TikTok', 'BTA4-01'), ['F_Beauty-Make up_18-44']);
    assert.deepEqual(logic.resolveGroupProducts(g, 'TikTok'), ['BTA4-01', 'BTA4-02']);
    assert.equal(logic.resolveGroupCtype(g, 'TikTok'), 'Review');
    assert.deepEqual(logic.resolveGroupMedia(g, 'TikTok', 'Review'), { media_type: 'VDO', content_format: 'Review' });
    assert.equal(logic.resolveGroupCampaign(g, 'TikTok', 'Review'), 'VDO View');
    assert.equal(logic.groupNoGencode(g), false);
    assert.equal(g.budget, 10000, 'งบ = ค่าตัว × คลิป');
    assert.deepEqual(g.solo, { contact_mode: 'agency', payee: 'Star Model', account_name: 'flow3rgurrl', due_date: '2026-10-10' });
    assert.equal(solo.buildSoloGroup(inputOf({ due_date: '' }), 'gd').solo.due_date, null, 'ไม่ใส่กำหนด = ไม่มีกำหนด');
    const one = solo.buildSoloGroup(inputOf({ clips: 1 }), 'g1');
    assert.deepEqual(logic.resolveGroupClips(one, 'TikTok'), [], '1 คลิป = ไม่มีชื่อคลิป (แถวเดียว)');
    const ig = solo.buildSoloGroup(inputOf({ platform: 'Instagram', content_type: 'Engagement' }), 'g2');
    assert.equal(logic.resolveGroupCampaign(ig, 'Instagram', 'Engagement'), 'Engagement');
    assert.equal(logic.resolveGroupTarget(ig, 'Instagram', 'BTA4-01'), null);
    assert.equal(solo.buildSoloGroup(inputOf({ no_gencode: true }), 'g3').no_gencode, true);
    assert.equal(solo.buildSoloGroup(inputOf({}), 'g3').solo.payee, 'flow3rgurrl', 'ติดต่อเอง = จ่ายตัว KOL');
});

test('buildSoloGroup: ตัวอ่านกลุ่มของหน้าเว็บนับเป้าคลิปตรง (quotaOf × clipCountFor) · หารจำนวนคนได้ 1', async () => {
    const c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    for (const n of [1, 2, 5]) {
        const i = inputOf({ clips: n, clip_names: Array.from({ length: n }, (_, k) => 'c' + k) });
        const g = solo.buildSoloGroup(i, 'g');
        assert.equal(c.quotaOf(g, 'TikTok') * c.clipCountFor(g, 'TikTok'), n, 'คลิป ' + n);
        assert.deepEqual(c.contentTypesOf(g, 'TikTok'), ['Review']);
        assert.deepEqual(c.targetFor(g, 'TikTok', 'BTA4-02'), ['F_Beauty-Make up_18-44']);
    }
});

// ---------------------------------------------------------------- ขั้นงาน + สรุป
test('soloSummary: ขั้นถัดไป = คลิปที่ช้าสุด (ดราฟ → ลงงาน → Gencode → ID Post → ยิงแอด) · ค่าตัวรวม', () => {
    const g = solo.buildSoloGroup(inputOf({ clips: 2, clip_names: ['A', 'B'] }), 'g');
    const clip = over => ({ id: 1, clip_no: 1, status: 'confirmed', platform: 'TikTok', account_name: 'flow3rgurrl', budget: 5000, ...over });
    const step = s => solo.soloClipStep(s, g);
    assert.equal(step(clip({})), 'todo');
    assert.equal(step(clip({ draft_link: 'https://d' })), 'review');
    assert.equal(step(clip({ draft_link: 'https://d', draft_status: 'approve' })), 'approved');
    assert.equal(step(clip({ post_url: 'https://p' })), 'gencode');
    assert.equal(step(clip({ post_url: 'https://p', gencode: '#x' })), 'idpost');
    assert.equal(step(clip({ post_url: 'https://p', gencode: '#x', id_post: '123' })), 'ad');
    assert.equal(step(clip({ post_url: 'https://p', gencode: '#x', id_post: '123', ad_spend: 10 })), 'done');
    assert.equal(step(clip({ post_url: 'https://p', gencode: '#x', platform: 'Instagram' })), 'ad', 'IG ไม่ต้องมี ID Post');
    const noGen = solo.buildSoloGroup(inputOf({ no_gencode: true }), 'g');
    assert.equal(solo.soloClipStep(clip({ post_url: 'https://p' }), noGen), 'idpost', 'ไม่ใช้ Gencode = ข้ามขั้น');

    const sum = solo.soloSummary([
        clip({ id: 2, clip_no: 2, post_url: 'https://p', gencode: '#x', id_post: '1', ad_status: 'ยิงแล้ว' }),
        clip({ id: 1, clip_no: 1, draft_link: 'https://d' }),
        clip({ id: 3, clip_no: 3, status: 'rejected' })
    ], g);
    assert.equal(sum.next_step, 'review', 'คลิปที่ช้าสุด');
    assert.deepEqual(sum.steps, ['review', 'done']);
    assert.deepEqual([sum.clips, sum.posted, sum.ad_fired, sum.fee_per_clip, sum.fee_total, sum.fee_missing], [2, 1, 1, 5000, 10000, false]);
    assert.equal(sum.payee, 'flow3rgurrl');
    assert.equal(solo.soloSummary([], g).next_step, 'todo');
});

test('soloDeleteBlock: ลงงาน / ยิงแอด / สแตมป์ / ตั้งงวดจ่ายแล้ว = ห้ามลบ', () => {
    assert.equal(solo.soloDeleteBlock([{ draft_link: 'x' }], []), null);
    assert.match(solo.soloDeleteBlock([{ post_url: 'x' }], []), /ลงงานแล้ว/);
    assert.match(solo.soloDeleteBlock([{ ad_spend: 5 }], []), /ยิงแอดแล้ว/);
    assert.match(solo.soloDeleteBlock([{ perf_stamp: { at: 'x' } }], []), /สแตมป์/);
    assert.match(solo.soloDeleteBlock([{}], [{ id: 1 }]), /งวดจ่าย/);
});

test('soloInput ตอนแก้ไข: ไม่รับค่าตัว (แก้ที่ช่องค่าตัว) · กลุ่มงบ 0 รอคิดใหม่ · คลิปเริ่มงาน/ว่าง', () => {
    const e = solo.soloInput({ ...GOOD, fee: '' }, { editing: true });
    assert.ok(e.input, JSON.stringify(e));
    assert.equal(e.input.fee, null);
    assert.equal(solo.soloInput({ ...GOOD, fee: 99 }, { editing: true }).input.fee, null, 'ส่งค่าตัวมาก็ไม่ใช้');
    assert.equal(solo.buildSoloGroup(e.input, 'g').budget, 0);
    assert.match(solo.soloInput({ ...GOOD, fee: '' }).error, /ค่าตัว/, 'ตอนเพิ่มยังบังคับ');
    assert.equal(solo.soloClipLive({ post_url: 'x' }), true);
    assert.equal(solo.soloClipLive({ ad_spend: 3 }), true);
    assert.equal(solo.soloClipLive({ perf_stamp: {} }), true);
    assert.equal(solo.soloClipLive({ draft_link: 'x' }), false);
    assert.equal(solo.soloClipEmpty({}), true);
    for (const s of [{ draft_link3: 'x' }, { gencode: '#a' }, { id_post: '1' }, { views: 5 }, { ad_status: 'ยิงแล้ว' }]) {
        assert.equal(solo.soloClipEmpty(s), false, JSON.stringify(s));
    }
});

test('normCampaignType: other / solo / kol · ค่าอื่นถอยเป็น kol', () => {
    for (const [v, want] of [['other', 'other'], ['solo', 'solo'], ['kol', 'kol'], ['SOLO', 'kol'], [undefined, 'kol'], ['', 'kol'], [{}, 'kol']]) {
        assert.equal(logic.normCampaignType(v), want, JSON.stringify(v));
    }
});

// ---------------------------------------------------------------- ชั้นเก็บข้อมูล (ทรานแซกชันจำลอง)
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
// ตัวจริงของชั้นเก็บข้อมูล — beforeEach ของเทสต์เส้น API สลับเป็นตัวจำลอง
const realCreateSolo = store.projects.createSolo;
const realSyncSoloBudget = store.projects.syncSoloBudget;

test('createSolo: แถวแคมเปญ solo + แถวคลิป confirmed ครบทุกคลิป ในทรานแซกชันเดียว (person_key / เวลาเดียวกัน)', async () => {
    fake.sql = []; fake.rows = {};
    const { project, rows } = await realCreateSolo(
        { team_id: 1, created_by: 7, name: 'KOL รายคน · @a (TikTok)', brand: 'Beauterry', ad_groups: [{ key: 'g1' }], budget: 10000, status: 'Active', campaign_type: 'kol' },
        { account_name: 'a', platform: 'TikTok', budget: 5000, group_key: 'g1', code_expire: 30 }, ['A', 'B'], 'แพรว');
    assert.equal(project.campaign_type, 'solo', 'ประเภทเป็น solo เสมอ');
    assert.equal(project.status, 'Active');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => [r.status, r.clip_no, r.clip_name, r.decided_by, r.budget, r.code_expire]),
        [['confirmed', 1, 'A', 'แพรว', 5000, 30], ['confirmed', 2, 'B', 'แพรว', 5000, 30]]);
    assert.ok(rows.every(r => r.project_id === project.id && r.person_key === rows[0].person_key && r.submitted_at === rows[0].submitted_at && r.decided_at === rows[0].submitted_at));
    assert.equal(fake.sql.filter(x => x.q.startsWith('INSERT')).length, 3);
    const single = await realCreateSolo({ team_id: 1, name: 'x', brand: 'Jdent' }, { account_name: 'b', platform: 'Lemon8' }, []);
    assert.equal(single.rows.length, 1);
    assert.equal(single.rows[0].clip_name, null);
});

test('syncSoloBudget: งบ = ผลรวมค่าตัว (ไม่นับที่ถูกปฏิเสธ) · อัปเดตงบกลุ่ม/บล็อก/ต่อ Platform · ไม่ใช่ solo = ไม่ทำอะไร', async () => {
    fake.sql = [];
    fake.lock = { campaign_type: 'solo', ad_groups: [{ key: 'g1', platform: 'TikTok', budget: 1, blocks: [{ platform: 'TikTok', budget: 1 }] }] };
    fake.sums['55'] = '12345.5';
    const out = await realSyncSoloBudget(55);
    assert.ok(out);
    const upd = fake.sql.find(x => x.q.startsWith('UPDATE projects'));
    const cols = /SET (.+) WHERE/.exec(upd.q)[1].split(', ').map(s => s.split(' = ')[0]);
    const val = k => upd.vals[cols.indexOf(k)];
    assert.equal(val('budget'), 12345.5);
    const groups = JSON.parse(val('ad_groups'));
    assert.equal(groups[0].budget, 12345.5);
    assert.equal(groups[0].blocks[0].budget, 12345.5);
    assert.deepEqual(JSON.parse(val('platform_budgets')), { TikTok: 12345.5 });
    assert.match(fake.sql.find(x => /SUM\(budget\)/.test(x.q)).q, /status <> 'rejected'/);
    fake.sql = [];
    fake.lock = { campaign_type: 'kol', ad_groups: [] };
    assert.equal(await realSyncSoloBudget(55), null);
    assert.equal(fake.sql.some(x => x.q.startsWith('UPDATE')), false, 'แคมเปญปกติไม่แตะงบ');
    fake.lock = null;
});

test('updateSolo: แบรนด์/Platform ล็อกเมื่อมีคลิปลงงาน · ลดคลิปได้เฉพาะคลิปว่าง · เพิ่มคลิปค่าตัวเท่าคลิปแรก · Gencode ใหม่เฉพาะคลิปที่ยังไม่มี · งบใหม่', async () => {
    const realUpdate = store.projects.updateSolo;
    const g0 = { key: 'gK', platform: 'TikTok', budget: 10000, blocks: [{ platform: 'TikTok', budget: 10000 }] };
    fake.proj = { id: 80, campaign_type: 'solo', brand: 'Beauterry', ad_groups: [g0] };
    const clip = (no, over = {}) => ({ id: 800 + no, project_id: 80, clip_no: no, person_key: 'pX', budget: 5000, status: 'confirmed', group_key: 'gK', ...over });
    const input = solo.soloInput({ ...GOOD, clips: 3, clip_names: ['A', 'B', 'C'], code_expire: 30 }, { editing: true }).input;
    const args = (over = {}) => ({
        fields: { name: 'n', brand: 'Beauterry', products: ['BTA4-01'], owner: 'แพรว', start_date: '2026-10-01', end_date: '2026-10-01', ...over.fields },
        group: { ...solo.buildSoloGroup(input, 'NEW'), ...(over.group || {}) },
        person: { account_name: 'flow3rgurrl', platform: 'TikTok', product: 'BTA4-01', agency: null, tier: 'Micro 10k - 100k', content_type: 'Review' },
        clipNames: over.clipNames || ['A', 'B', 'C'], codeExpire: 30
    });

    // แบรนด์ / Platform ล็อก
    fake.clips = [clip(1, { post_url: 'https://p' })];
    assert.deepEqual((await realUpdate(80, args({ fields: { brand: 'Jdent' } }))).error.code, 409);
    assert.match((await realUpdate(80, args({ group: { platform: 'Instagram' } }))).error.message, /Platform/);

    // ลดคลิป: คลิปท้ายมีดราฟแล้ว = ห้าม · ว่าง = ลบ
    fake.clips = [clip(1), clip(2), clip(3, { draft_link: 'https://d' })];
    const busy = await realUpdate(80, args({ clipNames: ['A', 'B'] }));
    assert.equal(busy.error.code, 409);
    assert.match(busy.error.message, /คลิปที่ 3/);
    fake.sql = [];
    fake.clips = [clip(1, { gencode: '#keep' }), clip(2), clip(3)];
    fake.sums['80'] = 10000;
    const less = await realUpdate(80, args({ clipNames: [] }));
    assert.ok(less.project, JSON.stringify(less));
    assert.deepEqual([less.removed, less.added], [2, 0]);
    assert.equal(fake.sql.filter(x => x.q.startsWith('DELETE FROM submissions')).length, 2);
    const updSub = fake.sql.find(x => x.q.startsWith('UPDATE submissions'));
    assert.doesNotMatch(updSub.q, /code_expire/, 'คลิปที่มี Gencode แล้วไม่เปลี่ยนอายุ');
    assert.match(updSub.q, /clip_name/);

    // เพิ่มคลิป: ค่าตัว / person_key / ชื่อคลิป / confirmed
    fake.sql = [];
    fake.rows = {};
    fake.clips = [clip(1, { budget: 7000 })];
    fake.sums['80'] = 21000;
    const more = await realUpdate(80, args(), 'แพรว');
    assert.deepEqual([more.removed, more.added], [0, 2]);
    assert.deepEqual(fake.rows.submissions.map(x => [x.clip_no, x.clip_name, x.budget, x.person_key, x.status, x.decided_by, x.code_expire]),
        [[2, 'B', 7000, 'pX', 'confirmed', 'แพรว', 30], [3, 'C', 7000, 'pX', 'confirmed', 'แพรว', 30]]);
    const updFirst = fake.sql.find(x => x.q.startsWith('UPDATE submissions'));
    assert.match(updFirst.q, /code_expire/, 'คลิปที่ยังไม่มี Gencode ได้อายุใหม่');
    const upd = fake.sql.find(x => x.q.startsWith('UPDATE projects'));
    const cols = /SET (.+) WHERE/.exec(upd.q)[1].split(', ').map(s => s.split(' = ')[0]);
    const val = k => upd.vals[cols.indexOf(k)];
    assert.equal(val('budget'), 21000, 'งบ = ผลรวมค่าตัวจริง');
    const saved = JSON.parse(val('ad_groups'));
    assert.equal(saved[0].key, 'gK', 'คงคีย์กลุ่มเดิม (แถวคลิปผูกอยู่)');
    assert.equal(saved[0].budget, 21000);
    assert.deepEqual(JSON.parse(val('platform_budgets')), { TikTok: 21000 });

    // ผู้รับเงินเปลี่ยน: งวดที่รอจ่ายย้ายตาม · มีงวดจ่ายแล้ว/เข้ารอบแล้ว = ห้าม
    fake.proj = { id: 80, campaign_type: 'solo', brand: 'Beauterry', ad_groups: [{ ...g0, solo: { contact_mode: 'agency', payee: 'Old Agency', account_name: 'flow3rgurrl' } }] };
    fake.clips = [clip(1)];
    fake.sql = [];
    fake.its = [{ id: 1, agency: 'Old Agency', status: 'pending', batch_id: null }];
    const moved = await realUpdate(80, args({ clipNames: [] }));   // input = ติดต่อเอง → ผู้รับเงินใหม่ = flow3rgurrl
    assert.ok(moved.project, JSON.stringify(moved));
    const mv = fake.sql.find(x => x.q.startsWith('UPDATE installments SET agency'));
    assert.deepEqual(mv && mv.vals, ['flow3rgurrl', 80, 'Old Agency']);
    fake.its = [{ id: 1, agency: 'Old Agency', status: 'paid', batch_id: 3 }];
    const blocked = await realUpdate(80, args({ clipNames: [] }));
    assert.equal(blocked.error.code, 409);
    assert.match(blocked.error.message, /ผู้รับเงิน.*Old Agency/);
    fake.sql = [];
    fake.proj.ad_groups = [{ ...g0, solo: { contact_mode: 'self', payee: 'flow3rgurrl', account_name: 'flow3rgurrl' } }];
    assert.ok((await realUpdate(80, args({ clipNames: [] }))).project);
    assert.equal(fake.sql.some(x => /installments/.test(x.q)), false, 'ผู้รับเงินเดิม = ไม่แตะงวด');
    fake.its = [];

    fake.proj = { id: 81, campaign_type: 'kol', ad_groups: [] };
    assert.equal((await realUpdate(81, args())).error.code, 400, 'ไม่ใช่ KOL รายคน');
    fake.proj = null;
    assert.equal((await realUpdate(82, args())).error.code, 404);
});

// ---------------------------------------------------------------- เส้น API
const app = require(path.join(SRC, 'app'));
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: 'แอดมิน', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'praew', full_name: 'Praew', nickname: 'แพรว', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ['Beauterry'] },
    3: { id: 3, username: 'fon', full_name: 'Fon', nickname: 'ฝน', role: 'member', status: 'active', is_active: true, team_id: 2, brands: ['Jdent'] },
    4: { id: 4, username: 'noteam', full_name: 'NoTeam', role: 'member', status: 'active', is_active: true, team_id: null, brands: ['Beauterry'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const logged = [];
store.activity.log = async e => { logged.push(e); return e; };

let created = null;
let projectsById = {};
let subsById = {};
let itsById = {};
let feeCalls = [], syncCalls = [], updates = [], removed = [];

let server, baseUrl;
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    store.projects.createSolo = realCreateSolo;
    if (server) await new Promise(r => server.close(r));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
beforeEach(() => {
    created = null; logged.length = 0; feeCalls = []; syncCalls = []; updates = []; removed = [];
    projectsById = {
        70: { id: 70, name: 'KOL รายคน · @a (TikTok)', brand: 'Beauterry', team_id: 1, campaign_type: 'solo', status: 'Active', ad_groups: [{ key: 'g1', platform: 'TikTok', solo: { payee: 'a' } }] },
        71: { id: 71, name: 'KOL Oct', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', status: 'Active', ad_groups: [] }
    };
    subsById = { 70: [{ id: 700, project_id: 70, account_name: 'a', budget: 5000, status: 'confirmed' }], 71: [] };
    itsById = { 70: [], 71: [] };
    store.projects.createSolo = async (fields, person, clips, by) => {
        created = { fields, person, clips, by };
        return { project: { id: 99, name: fields.name, team_id: fields.team_id, campaign_type: 'solo' },
            rows: (clips.length < 2 ? [null] : clips).map((c, i) => ({ id: 900 + i, clip_no: i + 1, clip_name: c })) };
    };
    store.projects.findByIdFull = async id => (projectsById[Number(id)] ? structuredClone(projectsById[Number(id)]) : null);
    store.projects.update = async (id, f) => { updates.push({ id: Number(id), f }); return { ...projectsById[Number(id)], ...f }; };
    store.projects.remove = async id => { removed.push(Number(id)); return true; };
    store.projects.syncSoloBudget = async id => { syncCalls.push(Number(id)); return {}; };
    store.submissions.listByProject = async id => structuredClone(subsById[Number(id)] || []);
    store.submissions.setFees = async (pid, items) => { feeCalls.push({ pid: Number(pid), items });
        return { rows: [], changed: items.map(it => ({ id: it.sub_id, from: 5000, to: it.budget, account_name: 'a', clip_no: 1 })) }; };
    store.submissions.addPerson = async () => { throw new Error('ห้ามเพิ่มคนในรายการ KOL รายคน'); };
    store.installments.listByProject = async id => structuredClone(itsById[Number(id)] || []);
});

const tokenOf = uid => jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
async function call(uid, method, url, body) {
    const res = await fetch(baseUrl + '/api' + url, {
        method, headers: { Authorization: `Bearer ${tokenOf(uid)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* */ }
    return { status: res.status, body: json };
}

test('POST /api/projects/solo: สร้างรายการ + กลุ่มที่ server สร้างเอง (ไม่รับ ad_groups จากหน้าเว็บ) + ประวัติบอกค่าตัว', async () => {
    const r = await call(2, 'POST', '/projects/solo', { ...GOOD, clips: 2, clip_names: ['A', 'B'], fee: 5000,
        ad_groups: [{ key: 'hack', budget: 1 }], budget: 1, campaign_type: 'kol', status: 'Completed' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const f = created.fields;
    assert.equal(f.name, 'KOL รายคน · @flow3rgurrl (TikTok)');
    assert.deepEqual([f.team_id, f.created_by, f.brand, f.owner, f.creator, f.status, f.kol_target, f.budget],
        [1, 2, 'Beauterry', 'แพรว', 'แพรว', 'Active', 1, 10000]);
    assert.deepEqual([f.start_date, f.end_date], ['2026-10-01', '2026-10-10']);
    assert.equal(f.ad_groups.length, 1);
    assert.notEqual(f.ad_groups[0].key, 'hack');
    assert.equal(f.ad_groups[0].budget, 10000);
    assert.deepEqual(f.platform_budgets, { TikTok: 10000 });
    assert.deepEqual(created.clips, ['A', 'B']);
    assert.deepEqual([created.person.account_name, created.person.budget, created.person.group_key, created.person.product, created.person.agency],
        ['flow3rgurrl', 5000, f.ad_groups[0].key, 'BTA4-01, BTA4-02', null]);
    assert.equal(created.by, 'แพรว');
    assert.match(logged.at(-1).summary, /เพิ่ม KOL รายคน: @flow3rgurrl \(TikTok · 2 คลิป · ฿5,000\/คลิป · รวม ฿10,000\)/);
    // ไม่มีกำหนดลงงาน = วันจบ = วันจ้าง (ตัวกรองปี/เดือนหน้าแคมเปญใช้วันที่)
    await call(2, 'POST', '/projects/solo', { ...GOOD, due_date: '' });
    assert.equal(created.fields.end_date, '2026-10-01');
});

test('POST /api/projects/solo: ข้อมูลไม่ครบ 400 · แบรนด์นอกสิทธิ์ 403 · ไม่มีทีม 400 — ไม่สร้างอะไร', async () => {
    const bad = await call(2, 'POST', '/projects/solo', { ...GOOD, fee: 0 });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /ค่าตัว/);
    assert.equal((await call(3, 'POST', '/projects/solo', GOOD)).status, 403);
    const noTeam = await call(4, 'POST', '/projects/solo', GOOD);
    assert.equal(noTeam.status, 400);
    assert.match(noTeam.body.message, /ทีม/);
    assert.equal(created, null);
});

test('PUT /api/projects/:id บน KOL รายคน: แก้ได้แค่สถานะ (กันฟอร์มแคมเปญ/หน้าเว็บเก่าทับกลุ่ม) · แคมเปญปกติแก้ได้ตามเดิม', async () => {
    const r1 = await call(2, 'PUT', '/projects/70', { name: 'x', ad_groups: [] });
    assert.equal(r1.status, 400);
    assert.match(r1.body.message, /KOL รายคน/);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Completed', name: 'x' })).status, 400);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Draft' })).status, 400);
    assert.equal(updates.length, 0);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Completed' })).status, 200);
    assert.deepEqual(updates.map(u => [u.id, u.f.status]), [[70, 'Completed']]);
    assert.equal((await call(2, 'PUT', '/projects/71', { name: 'KOL Oct 2', campaign_type: 'kol' })).status, 200);
    assert.equal((await call(2, 'PUT', '/projects/71', { campaign_type: 'solo' })).status, 400, 'เปลี่ยนแคมเปญเป็น solo ไม่ได้');
});

test('หน้าเว็บรุ่นเก่า: เปลี่ยนสถานะ/ลบรายคลิป · ล้างค่าตัวเป็น 0 · ลิงก์แชร์ · สร้าง solo ผ่านเส้นทั่วไป — ใช้กับ KOL รายคนไม่ได้', async () => {
    let updated = 0, removedPeople = 0;
    store.submissions.update = async () => { updated++; return {}; };
    store.submissions.get = async id => ({ id: Number(id), project_id: 70, agency_token: null });
    store.submissions.removePerson = async () => { removedPeople++; return true; };
    const st = await call(2, 'PUT', '/projects/70/submissions/700', { status: 'submitted' });
    assert.equal(st.status, 400);
    assert.match(st.body.message, /KOL รายคน/);
    assert.equal((await call(2, 'PUT', '/projects/70/submissions/700', { status: 'rejected' })).status, 400);
    assert.equal(updated, 0);
    const del = await call(2, 'DELETE', '/projects/70/submissions/700');
    assert.equal(del.status, 400);
    assert.equal(removedPeople, 0, 'ไม่ลบคลิป (ลบทั้งคนจะล้างทุกคลิป)');
    const zero = await call(2, 'PUT', '/projects/70/fees', { items: [{ sub_id: 700, budget: 0, from: 5000 }], reason: 'clear' });
    assert.equal(zero.status, 400);
    assert.match(zero.body.message, /มากกว่า 0/);
    assert.equal(feeCalls.length, 0);
    assert.equal((await call(2, 'POST', '/projects/70/share')).status, 400);
    const gen = await call(2, 'POST', '/projects', { name: 'x', brand: 'Beauterry', campaign_type: 'solo', budget: 500000 });
    assert.equal(gen.status, 400);
    assert.match(gen.body.message, /เพิ่ม KOL รายคน/);
    // แคมเปญปกติยังเปลี่ยนสถานะรายคลิปได้ตามเดิม
    store.submissions.update = async () => ({ id: 710 });
    const kolSt = await call(2, 'PUT', '/projects/71/submissions/710', { status: 'rejected' });
    assert.notEqual(kolSt.status, 400, JSON.stringify(kolSt.body));
});

test('PUT /api/projects/:id/solo: แก้ข้อมูล (ไม่ใช่ solo 400 · ข้อมูลผิด 400 · แบรนด์นอกสิทธิ์ 403 · ผลจาก store ส่งต่อ) + ประวัติ', async () => {
    let got = null;
    store.projects.updateSolo = async (id, a, by) => { got = { id: Number(id), a, by };
        return a.fields.brand === 'Beauterry' && a.clipNames.length === 3 ? { error: { code: 409, message: 'ลดจำนวนคลิปไม่ได้ — คลิปที่ 3 มีงานแล้ว' } }
            : { project: { id: 70, name: a.fields.name, team_id: 1 }, removed: 0, added: 1 }; };
    assert.equal((await call(2, 'PUT', '/projects/71/solo', GOOD)).status, 400, 'แคมเปญปกติ');
    assert.equal(got, null);
    const bad = await call(2, 'PUT', '/projects/70/solo', { ...GOOD, account_name: '' });
    assert.equal(bad.status, 400);
    assert.equal((await call(2, 'PUT', '/projects/70/solo', { ...GOOD, brand: 'Jdent' })).status, 403);
    const ok = await call(2, 'PUT', '/projects/70/solo', { ...GOOD, clips: 2, clip_names: ['A', 'B'], fee: 99999 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(got.id, 70);
    assert.equal(got.by, 'แพรว');
    assert.equal(got.a.group.key, 'g1', 'คงคีย์กลุ่มเดิม');
    assert.equal(got.a.group.budget, 0, 'งบคิดใหม่จากค่าตัวจริงใน store (ไม่ใช้ค่าตัวที่ส่งมา)');
    assert.deepEqual(got.a.clipNames, ['A', 'B']);
    assert.deepEqual([got.a.fields.name, got.a.fields.end_date, got.a.person.product], ['KOL รายคน · @flow3rgurrl (TikTok)', '2026-10-10', 'BTA4-01, BTA4-02']);
    assert.match(logged.at(-1).summary, /แก้ข้อมูล KOL รายคน: @flow3rgurrl \(เพิ่ม 1 คลิป\)/);
    const conflict = await call(2, 'PUT', '/projects/70/solo', { ...GOOD, clips: 3, clip_names: ['A', 'B', 'C'] });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.message, /คลิปที่ 3/);
});

test('เส้นเพิ่มคน / สร้างลิงก์ Agency ใช้กับ KOL รายคนไม่ได้', async () => {
    const add = await call(2, 'POST', '/projects/70/submissions', { account_name: 'b' });
    assert.equal(add.status, 400);
    assert.match(add.body.message, /KOL รายคน/);
    const link = await call(2, 'POST', '/projects/70/agency-links', { name: 'X', groups: ['g1'] });
    assert.equal(link.status, 400);
    assert.match(link.body.message, /KOL รายคน/);
});

test('DELETE KOL รายคน: มีงานแล้ว (ลงงาน / งวดจ่าย) = 409 ให้ยกเลิกแทน · ยังไม่มีงาน = ลบได้ · แคมเปญปกติไม่เช็ค', async () => {
    subsById[70][0].post_url = 'https://p';
    const r1 = await call(2, 'DELETE', '/projects/70');
    assert.equal(r1.status, 409);
    assert.match(r1.body.message, /ลงงานแล้ว.*ยกเลิก/);
    delete subsById[70][0].post_url;
    itsById[70] = [{ id: 5 }];
    assert.equal((await call(2, 'DELETE', '/projects/70')).status, 409);
    itsById[70] = [];
    assert.equal((await call(2, 'DELETE', '/projects/70')).status, 200);
    assert.deepEqual(removed, [70]);
    assert.equal((await call(2, 'DELETE', '/projects/71')).status, 200);
});

test('PUT /:id/fees บน KOL รายคน → งบของรายการตามค่าตัวทันที · แคมเปญปกติไม่เรียก', async () => {
    const r = await call(2, 'PUT', '/projects/70/fees', { items: [{ sub_id: 700, budget: 6000, from: 5000 }], reason: 'manual' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(syncCalls, [70]);
    subsById[71] = [{ id: 710, project_id: 71, budget: 1 }];
    assert.equal((await call(2, 'PUT', '/projects/71/fees', { items: [{ sub_id: 710, budget: 2, from: 1 }], reason: 'manual' })).status, 200);
    assert.deepEqual(syncCalls, [70]);
});

test('หน้าทำจ่าย: ผู้รับเงินของ KOL รายคน = Agency ที่ระบุ หรือตัว KOL (ติดต่อเอง) · แคมเปญปกติยังมาจากลิงก์เอเจนซี่', () => {
    const { projectAgencies } = require(path.join(SRC, 'store/pg/payments'));
    const soloAg = { campaign_type: 'solo', ad_groups: [{ key: 'g1', solo: { contact_mode: 'agency', payee: 'Star Model', account_name: 'a' } }], agency_links: [{ token: 't', name: 'ห้ามใช้' }] };
    assert.deepEqual(projectAgencies(soloAg, undefined, []), ['Star Model']);
    assert.deepEqual(projectAgencies(soloAg, 'g1', []), ['Star Model']);
    const soloSelf = { campaign_type: 'solo', ad_groups: [{ key: 'g2', solo: { contact_mode: 'self', payee: 'b', account_name: 'b' } }] };
    assert.deepEqual(projectAgencies(soloSelf, undefined, []), ['b']);
    assert.deepEqual(projectAgencies({ campaign_type: 'solo', ad_groups: [] }, undefined, []), []);
    const kol = { campaign_type: 'kol', agency_links: [{ token: 't1', name: 'Agency A', groups: [] }] };
    assert.deepEqual(projectAgencies(kol, undefined, []), ['Agency A']);
});
