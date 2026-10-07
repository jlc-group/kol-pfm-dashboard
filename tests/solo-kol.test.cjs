const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026) · รอบ 4 (1 ต.ค.): หลาย Platform / ได้ฟรี / ไม่มีวันที่
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

// ทรานแซกชันจำลอง — เก็บคำสั่ง SQL ไว้ตรวจ createSolo / updateSolo / syncSoloBudget (ต้องสลับก่อนโหลด pg/projects.js)
// sums[project_id] = { Platform: ผลรวมค่าตัว } (คำตอบของ SELECT platform, SUM(budget) ... GROUP BY platform)
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
        if (/^SELECT platform, COALESCE\(SUM\(budget\), 0\) AS total FROM submissions WHERE project_id = \$1 AND status <> 'rejected' GROUP BY platform$/.test(q)) {
            return { rows: Object.entries(fake.sums[vals[0]] || {}).map(([platform, total]) => ({ platform, total })) };
        }
        if (/^UPDATE projects SET/.test(q)) return { rows: [{ id: vals[vals.length - 1], updated: true }] };
        throw new Error('unexpected SQL in fake client: ' + q.slice(0, 80));
    }
};
base.withTransaction = async fn => fn(fakeClient);

const solo = require(path.join(SRC, 'store/soloKol'));
const logic = require(path.join(SRC, 'store/logic'));

// ข้อมูลต่อ Platform — TikTok มีค่าตัว · Instagram ได้ฟรี (0)
const TT = {
    platform: 'TikTok', account_name: '@flow3rgurrl', link_account: 'https://www.tiktok.com/@flow3rgurrl', followers: 85000,
    tier: 'Micro 10k - 100k', fee: 5000, content_type: 'Review', campaign: 'VDO View', media_type: 'VDO', content_format: 'Review',
    target: ['F_Beauty-Make up_18-44']
};
const IG = {
    platform: 'Instagram', account_name: 'flow.ig', link_account: '', followers: 12000, tier: 'Micro 10k - 100k',
    fee: 0, content_type: 'Reels', campaign: 'VDO View', media_type: 'Photo', content_format: 'Unbox', target: ['ห้ามเก็บ']
};
const BASE = { contact_mode: 'self', brand: 'Beauterry', products: ['BTA4-01', 'BTA4-02'], clips: 1, owner: 'แพรว', code_expire: 60 };
const GOOD = { ...BASE, platforms: [TT] };
// ส่ง Instagram ก่อน TikTok — server เรียงตามลำดับมาตรฐาน (TikTok ขึ้นก่อน = Platform หลัก)
const MULTI = { ...BASE, clips: 2, clip_names: ['A', 'B'], platforms: [IG, TT] };
// หน้าเว็บก่อนรอบ 4 (แท็บที่เปิดค้าง): Platform เดียวแบบแบน + วันที่จ้าง/กำหนดลงงาน
const FLAT = {
    ...BASE, account_name: '@flow3rgurrl', platform: 'TikTok', link_account: TT.link_account, followers: 85000, tier: TT.tier,
    fee: 5000, content_type: 'Review', campaign: 'VDO View', media_type: 'VDO', content_format: 'Review', target: TT.target,
    hire_date: '2020-01-01', due_date: '2020-01-10'
};
const withPlat = (p, over) => ({ ...GOOD, platforms: [{ ...p, ...over }] });
const inputOf = (body, opts) => { const r = solo.soloInput(body, opts); assert.ok(r.input, JSON.stringify(r)); return r.input; };
const errOf = (body, opts) => solo.soloInput(body, opts).error;
// ข้อความของ server รุ่นเก่า — หน้าเว็บรุ่นใหม่ใช้ดูว่า server ยังไม่รีสตาร์ต ห้าม server รุ่นนี้คืนข้อความนี้เด็ดขาด
const OLD_SERVER_MSG = 'ใส่Platformก่อนนะ';

// ---------------------------------------------------------------- ตรวจค่า
test('soloInput: เลือกหลาย Platform · เรียงตามลำดับมาตรฐาน (ตัวแรก = หลัก) · ข้อมูลแยกต่อ Platform · ค่าตัว 0 = ได้ฟรี', () => {
    const i = inputOf(MULTI);
    assert.deepEqual(i.platforms.map(p => p.platform), ['TikTok', 'Instagram']);
    const [t, g] = i.platforms;
    assert.deepEqual([t.account_name, t.fee, t.content_type, t.campaign, t.media_type, t.content_format, t.target],
        ['flow3rgurrl', 5000, 'Review', 'VDO View', 'VDO', 'Review', ['F_Beauty-Make up_18-44']]);
    assert.deepEqual([g.account_name, g.fee, g.content_type, g.campaign, g.link_account, g.followers, g.target],
        ['flow.ig', 0, 'Reels', 'Reels', null, 12000, []], 'IG: Campaign = Content Type · ไม่มี Target · ได้ฟรี');
    assert.deepEqual([i.clips, i.clip_names, i.contact_mode, i.agency, i.brand, i.products, i.owner, i.code_expire, i.no_gencode],
        [2, ['A', 'B'], 'self', null, 'Beauterry', ['BTA4-01', 'BTA4-02'], 'แพรว', 60, false]);
    assert.equal('hire_date' in i || 'due_date' in i, false, 'ไม่มีวันที่จ้าง/กำหนดลงงานแล้ว');
    // ครบทั้ง 6 Platform เรียงตาม SOLO_PLATFORMS เสมอ
    const all = inputOf({ ...GOOD, platforms: [...solo.SOLO_PLATFORMS].reverse().map(platform => ({ ...TT, platform,
        content_type: ['Facebook', 'Instagram'].includes(platform) ? 'Awareness' : 'Review' })) });
    assert.deepEqual(all.platforms.map(p => p.platform), solo.SOLO_PLATFORMS);
    assert.deepEqual(all.platforms.map(p => p.campaign), ['VDO View', 'Awareness', 'Awareness', null, null, null], 'Campaign เฉพาะ TikTok / FB / IG');
    assert.deepEqual(all.platforms.map(p => p.target.length), [1, 0, 0, 0, 0, 0], 'Target เฉพาะ TikTok');
});

test('soloInput: ข้อผิดพลาดของช่องต่อ Platform ขึ้นต้นด้วยชื่อ Platform · ช่องร่วมใช้ข้อความเดิม', () => {
    assert.equal(errOf({ ...MULTI, platforms: [TT, { ...IG, content_type: 'Review' }] }), 'Instagram: เลือก Campaign (Awareness / Engagement / Reels)');
    assert.match(errOf(withPlat(TT, { account_name: '  ' })), /^TikTok: .*ชื่อบัญชี KOL/);
    assert.match(errOf(withPlat(TT, { account_name: '@@@' })), /^TikTok: .*ชื่อบัญชี KOL/);
    assert.match(errOf(withPlat(TT, { tier: '' })), /^TikTok: .*Tier/);
    assert.match(errOf(withPlat(TT, { content_type: '' })), /^TikTok: .*Content Type/);
    assert.match(errOf(withPlat(TT, { link_account: 'www.tiktok.com/x' })), /^TikTok: ลิงก์ช่อง/);
    assert.match(errOf(withPlat(TT, { followers: -5 })), /^TikTok: .*ผู้ติดตาม/);
    assert.match(errOf(withPlat(TT, { campaign: 'Awareness' })), /^TikTok: Campaign ไม่ถูกต้อง/);
    assert.match(errOf(withPlat(TT, { media_type: 'GIF' })), /^TikTok: Photo\/VDO/);
    assert.match(errOf(withPlat(TT, { target: 'x' })), /^TikTok: Target/);
    assert.equal(inputOf(withPlat({ ...TT, platform: 'Lemon8' }, { campaign: 'Reach' })).platforms[0].campaign, null, 'Lemon8 ไม่มี Campaign');
    // ช่องร่วมของการจ้าง
    assert.match(errOf({ ...GOOD, contact_mode: 'phone' }), /ช่องทางติดต่อ/);
    assert.match(errOf({ ...GOOD, contact_mode: 'agency', agency: ' ' }), /ชื่อ Agency/);
    assert.match(errOf({ ...GOOD, brand: '' }), /แบรนด์/);
    assert.match(errOf({ ...GOOD, products: [] }), /สินค้าอย่างน้อย 1/);
    assert.match(errOf({ ...GOOD, products: 'BTA4-01' }), /สินค้าอย่างน้อย 1/);
    for (const clips of [0, 6, 1.5]) assert.match(errOf({ ...GOOD, clips }), /1-5/, String(clips));
    assert.match(errOf({ ...GOOD, owner: '' }), /ผู้ดูแล/);
    assert.match(errOf({ ...GOOD, brief_link: 'javascript:alert(1)' }), /ลิงก์บรีฟ/);
    assert.match(errOf({ ...GOOD, code_expire: 45 }), /อายุ Gencode/);
    assert.match(errOf({ ...GOOD, clips: 2, clip_names: ['A', 'A'] }), /ชื่อคลิปซ้ำ/);
    // Concept / บรีฟ / หมายเหตุ ไม่บังคับ
    const opt = inputOf({ ...GOOD, concept: '', brief_link: '', note: '' });
    assert.deepEqual([opt.concept, opt.brief_link, opt.note], [null, null, null]);
});

test('soloInput: Platform ไม่ครบ / ไม่รู้จัก / ซ้ำ — และไม่มีวันคืนข้อความของ server รุ่นเก่า', () => {
    for (const body of [{ ...BASE }, { ...BASE, platform: '' }, { ...BASE, platform: null }, { ...BASE, platforms: [] }, { ...BASE, platforms: 'TikTok' }]) {
        assert.equal(errOf(body), 'เลือก Platform อย่างน้อย 1 ตัว', JSON.stringify(body));
    }
    assert.equal(errOf({ ...BASE, platforms: [{}] }), 'เลือก Platform');
    assert.equal(errOf({ ...BASE, platforms: [{ ...TT, platform: 'MySpace' }] }), 'เลือก Platform');
    assert.equal(errOf({ ...BASE, platform: 'MySpace' }), 'เลือก Platform', 'แบบแบนก็ตรวจชื่อ Platform');
    assert.equal(errOf({ ...BASE, platforms: [TT, TT] }), 'เลือก TikTok ซ้ำกัน');
    const bodies = [{}, { ...BASE }, { ...BASE, platform: '' }, { ...BASE, platforms: [{}] }, { ...BASE, platforms: [{ platform: '' }] },
        { ...FLAT, platform: '' }, { ...FLAT, platform: '   ' }];
    for (const body of bodies) {
        for (const opts of [{}, { editing: true }]) assert.notEqual(errOf(body, opts), OLD_SERVER_MSG, JSON.stringify(body));
    }
});

test('soloInput: ค่าตัวบังคับทุก Platform ตอนเพิ่ม · 0 = ได้ฟรี · ว่างไม่ได้ ("ได้ฟรีใส่ 0") · รับคอมมา · เพดาน 10 ล้าน', () => {
    for (const fee of ['', null, undefined, '  ']) {
        const e = errOf({ ...MULTI, platforms: [TT, { ...IG, fee }] });
        assert.match(e, /^Instagram: /, String(fee));
        assert.match(e, /ได้ฟรีใส่ 0/, String(fee));
    }
    for (const fee of ['ห้าพัน', -1, '-0.5', {}, true]) {
        const e = errOf(withPlat(TT, { fee }));
        assert.match(e, /^TikTok: /, String(fee));
        assert.match(e, /ได้ฟรีใส่ 0/, String(fee));
    }
    for (const fee of [0, '0', '0.00', 0.004]) assert.equal(inputOf(withPlat(TT, { fee })).platforms[0].fee, 0, 'ได้ฟรี ' + fee);
    assert.equal(inputOf(withPlat(TT, { fee: '5,000.50' })).platforms[0].fee, 5000.5);
    assert.equal(inputOf(withPlat(TT, { fee: 1234.567 })).platforms[0].fee, 1234.57, 'ปัดเป็นสตางค์');
    assert.equal(inputOf(withPlat(TT, { fee: 10000000 })).platforms[0].fee, 10000000);
    assert.match(errOf(withPlat(TT, { fee: 10000001 })), /^TikTok: ค่าตัวสูงเกินไป/);
    assert.ok(Object.is(inputOf(withPlat(TT, { fee: -0 })).platforms[0].fee, 0), 'ไม่มี -0');
});

test('soloInput ตอนแก้ไข: ค่าตัวไม่บังคับ (ว่าง = null) · ส่งมาต้องถูกต้อง · 0 ได้', () => {
    const e = inputOf({ ...MULTI, platforms: [{ ...TT, fee: '' }, { ...IG, fee: undefined }] }, { editing: true });
    assert.deepEqual(e.platforms.map(p => p.fee), [null, null]);
    assert.equal(inputOf({ ...MULTI, platforms: [{ ...TT, fee: null }, { ...IG, fee: '0' }] }, { editing: true }).platforms[1].fee, 0);
    assert.match(errOf(withPlat(TT, { fee: 'abc' }), { editing: true }), /^TikTok: .*ได้ฟรีใส่ 0/);
    assert.match(errOf(withPlat(TT, { fee: '' })), /ได้ฟรีใส่ 0/, 'ตอนเพิ่มยังบังคับ');
});

test('soloInput: หน้าเว็บรุ่นเก่า (ข้อมูลแบบแบน Platform เดียว) ยังส่งได้ — วันที่ที่ส่งมาไม่ใช้', () => {
    const i = inputOf(FLAT);
    assert.equal(i.platforms.length, 1);
    assert.deepEqual([i.platforms[0].platform, i.platforms[0].account_name, i.platforms[0].fee, i.platforms[0].target], ['TikTok', 'flow3rgurrl', 5000, TT.target]);
    assert.equal('hire_date' in i || 'due_date' in i, false);
    assert.match(errOf({ ...FLAT, fee: '' }), /^TikTok: .*ได้ฟรีใส่ 0/);
    // แก้ไขจากแท็บเก่า: ไม่ส่งค่าตัว (หน้าเว็บเก่าลบ fee ทิ้งก่อนส่ง)
    const { fee, ...noFee } = FLAT;
    assert.equal(fee, 5000);
    assert.equal(inputOf(noFee, { editing: true }).platforms[0].fee, null);
    // ส่ง platforms มาเป็นอาเรย์ = ใช้อาเรย์ ไม่สนช่องแบบแบน
    assert.deepEqual(inputOf({ ...FLAT, platforms: [IG] }).platforms.map(p => p.platform), ['Instagram']);
    // Agency + ติดต่อเอง
    assert.equal(inputOf({ ...FLAT, contact_mode: 'agency', agency: ' Star Model ' }).agency, 'Star Model');
    assert.equal(inputOf({ ...FLAT, contact_mode: 'self', agency: 'ไม่ควรเก็บ' }).agency, null, 'ติดต่อเองไม่เก็บชื่อ Agency');
    assert.deepEqual(inputOf({ ...FLAT, clips: 3, clip_names: ['ถ่ายรีวิว', '', ' '] }).clip_names, ['ถ่ายรีวิว', 'คลิป 2', 'คลิป 3']);
    assert.deepEqual(inputOf({ ...FLAT, clips: 1, clip_names: ['x'] }).clip_names, [], '1 คลิปไม่มีชื่อคลิป');
});

// ---------------------------------------------------------------- กลุ่มโฆษณา (อ่านด้วยตัวอ่านเดิมของระบบได้ ทุก Platform)
const ALL6 = () => inputOf({ ...BASE, clips: 2, clip_names: ['A', 'B'], contact_mode: 'agency', agency: 'Star Model',
    platforms: solo.SOLO_PLATFORMS.map((platform, k) => ({
        ...TT, platform, account_name: 'acc' + k, fee: k * 1000,
        content_type: { Facebook: 'Awareness', Instagram: 'Reels' }[platform] || 'Review',
        media_type: k % 2 ? 'Photo' : 'VDO', content_format: 'F' + k
    })) });

test('buildSoloGroup: 1 บล็อก / Platform — ตัวอ่านกลุ่มของ server (หน้า Ads / ฟีด) อ่านค่าแต่ละ Platform ได้ครบ', () => {
    const i = ALL6();
    const g = solo.buildSoloGroup(i, 'gX');
    assert.equal(g.key, 'gX');
    assert.equal(g.platform, 'TikTok');
    assert.deepEqual(g.platforms, solo.SOLO_PLATFORMS);
    assert.deepEqual(g.blocks.map(b => b.platform), solo.SOLO_PLATFORMS);
    i.platforms.forEach((p, k) => {
        const P = p.platform;
        assert.deepEqual(logic.resolveGroupClips(g, P), ['A', 'B'], P);
        assert.deepEqual(logic.resolveGroupProducts(g, P), ['BTA4-01', 'BTA4-02'], P);
        assert.equal(logic.resolveGroupCtype(g, P), p.content_type, P);
        assert.deepEqual(logic.resolveGroupMedia(g, P, p.content_type), { media_type: p.media_type, content_format: 'F' + k }, P);
        assert.equal(g.blocks[k].budget, k * 1000 * 2, P + ': งบบล็อก = ค่าตัว × คลิป');
        assert.deepEqual(g.allocations[k], { platform: P, tier: p.tier, kols: 1, campaign: p.campaign, content_type: p.content_type,
            media_type: p.media_type, content_format: 'F' + k }, P);
    });
    assert.deepEqual(solo.SOLO_PLATFORMS.map((P, k) => logic.resolveGroupCampaign(g, P, i.platforms[k].content_type)),
        ['VDO View', 'Reels', 'Awareness', null, null, null]);
    assert.deepEqual(logic.resolveGroupTarget(g, 'TikTok', 'BTA4-01'), ['F_Beauty-Make up_18-44']);
    for (const P of solo.SOLO_PLATFORMS.slice(1)) assert.equal(logic.resolveGroupTarget(g, P, 'BTA4-01'), null, P);
    assert.deepEqual(g.blocks[1].product_targets, { 'BTA4-01': [], 'BTA4-02': [] });
    assert.equal(logic.groupNoGencode(g), false);
    // ค่าระดับกลุ่มแบบเดิม — จากบล็อก/ชุดแรก · งบรวม · จำนวน = ผลรวม allocations
    // Photo/VDO + Format ระดับกลุ่ม: หลาย Platform = null (ไม่งั้น Platform ที่เว้นว่างได้ค่าของ Platform แรกไป)
    assert.deepEqual([g.content_type, g.media_type, g.content_format, g.clips, g.target, g.brief, g.concept],
        ['Review', null, null, ['A', 'B'], ['F_Beauty-Make up_18-44'], null, null]);
    assert.equal(g.budget, (0 + 1 + 2 + 3 + 4 + 5) * 1000 * 2);
    assert.equal(g.kol_count, 6);
    assert.deepEqual(g.solo, { contact_mode: 'agency', payee: 'Star Model', payee_platform: null, account_name: 'acc0',
        accounts: solo.SOLO_PLATFORMS.map((platform, k) => ({ platform, account_name: 'acc' + k })) });
    assert.equal('due_date' in g.solo, false);
    // ไม่มี TikTok = Target ระดับกลุ่มว่าง · ติดต่อเอง = จ่ายบัญชีของ Platform หลัก
    const noTT = solo.buildSoloGroup(inputOf({ ...MULTI, platforms: [IG, { ...TT, platform: 'Lemon8', account_name: 'l8' }] }), 'g2');
    assert.deepEqual([noTT.platform, noTT.target, noTT.solo.payee, noTT.solo.payee_platform], ['Instagram', [], 'flow.ig', 'Instagram']);
    assert.equal(solo.buildSoloGroup(inputOf({ ...GOOD, no_gencode: true }), 'g3').no_gencode, true);
    const one = solo.buildSoloGroup(inputOf(GOOD), 'g1');
    assert.deepEqual(logic.resolveGroupClips(one, 'TikTok'), [], '1 คลิป = ไม่มีชื่อคลิป (แถวเดียว)');
    assert.deepEqual([one.media_type, one.content_format], ['VDO', 'Review'], 'Platform เดียว = ค่าระดับกลุ่มของ Platform นั้นตามเดิม');
    // แก้ไข (ค่าตัว null) = งบ 0 รอคิดใหม่จากค่าตัวจริง
    assert.equal(solo.buildSoloGroup(inputOf({ ...MULTI, platforms: [{ ...TT, fee: '' }, { ...IG, fee: '' }] }, { editing: true }), 'g').budget, 0);
});

test('buildSoloGroup: ตัวอ่านกลุ่มของหน้าเว็บนับเป้าคลิปตรงทุก Platform (quotaOf × clipCountFor) · Content Type / Target ต่อ Platform', async () => {
    const c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    for (const n of [1, 2, 5]) {
        const i = inputOf({ ...ALL6(), platforms: ALL6().platforms, clips: n, clip_names: Array.from({ length: n }, (_, k) => 'c' + k) });
        const g = solo.buildSoloGroup(i, 'g');
        for (const p of i.platforms) {
            assert.equal(c.quotaOf(g, p.platform) * c.clipCountFor(g, p.platform), n, `${p.platform} ${n} คลิป`);
            assert.deepEqual(c.contentTypesOf(g, p.platform), [p.content_type], p.platform);
            assert.deepEqual(c.targetFor(g, p.platform, 'BTA4-02'), p.platform === 'TikTok' ? ['F_Beauty-Make up_18-44'] : [], p.platform);
        }
    }
});

test('buildSoloGroup: Platform ที่ไม่ได้เลือก Photo/VDO + Format ได้ null — ไม่ยืมค่าของ Platform แรก (server resolveGroupMedia / หน้าเว็บ mediaFor)', async () => {
    const c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    // TikTok เลือก VDO / Review · Instagram เว้นว่างทั้งสองช่อง
    const g = solo.buildSoloGroup(inputOf({ ...MULTI, platforms: [TT, { ...IG, media_type: '', content_format: '' }] }), 'g');
    assert.deepEqual([g.media_type, g.content_format], [null, null], 'หลาย Platform = ไม่มีค่าระดับกลุ่ม');
    const none = { media_type: null, content_format: null };
    assert.deepEqual(logic.resolveGroupMedia(g, 'Instagram', 'Reels'), none, 'server');
    assert.deepEqual(c.mediaFor(g, 'Instagram', 'Reels'), none, 'หน้าเว็บ');
    assert.deepEqual(logic.resolveGroupMedia(g, 'Instagram'), none, 'ไม่ระบุ Content Type');
    assert.deepEqual(c.mediaFor(g, 'Instagram'), none);
    // Platform ที่เลือกไว้ยังอ่านค่าของตัวเองได้ครบ
    const tt = { media_type: 'VDO', content_format: 'Review' };
    assert.deepEqual(logic.resolveGroupMedia(g, 'TikTok', 'Review'), tt);
    assert.deepEqual(c.mediaFor(g, 'TikTok', 'Review'), tt);
    // เลือกแค่ช่องเดียว — อีกช่องเป็น null ไม่ใช่ของ TikTok
    const half = solo.buildSoloGroup(inputOf({ ...MULTI, platforms: [TT, { ...IG, media_type: 'Photo', content_format: '' }] }), 'g');
    assert.deepEqual(logic.resolveGroupMedia(half, 'Instagram', 'Reels'), { media_type: 'Photo', content_format: null });
    assert.deepEqual(c.mediaFor(half, 'Instagram', 'Reels'), { media_type: 'Photo', content_format: null });
    // Platform เดียวที่เว้นว่าง = null เหมือนเดิม
    const single = solo.buildSoloGroup(inputOf(withPlat(IG, { media_type: '', content_format: '' })), 'g');
    assert.deepEqual(logic.resolveGroupMedia(single, 'Instagram', 'Reels'), none);
});

test('buildSoloGroup(prev): ผู้รับเงิน (ติดต่อเอง) คง Platform เดิมตอนแก้ไข — เพิ่ม Platform ที่เรียงมาก่อนไม่ย้ายผู้รับเงิน', () => {
    const IGP = { ...IG, account_name: 'b.ig' };
    const igOnly = solo.buildSoloGroup(inputOf({ ...BASE, platforms: [IGP] }), 'gI');
    assert.deepEqual([igOnly.solo.payee, igOnly.solo.payee_platform], ['b.ig', 'Instagram']);
    const edit = (body, prev) => solo.buildSoloGroup(inputOf(body, { editing: true }), 'gI', prev).solo;
    // เพิ่ม TikTok (เรียงก่อน Instagram · ชื่อบัญชีต่างกัน) — ผู้รับเงินยังเป็นบัญชี IG
    const added = edit({ ...BASE, platforms: [{ ...TT, account_name: '@aaa' }, IGP] }, igOnly);
    assert.deepEqual([added.payee, added.payee_platform, added.account_name], ['b.ig', 'Instagram', 'aaa'], 'บัญชีหลัก (ตัวอ่านเก่า) เปลี่ยนได้ แต่ผู้รับเงินไม่เปลี่ยน');
    // แก้ชื่อบัญชี IG = ผู้รับเงินตามชื่อใหม่ของ Platform เดิม
    assert.equal(edit({ ...BASE, platforms: [TT, { ...IGP, account_name: 'b.ig2' }] }, igOnly).payee, 'b.ig2');
    // เอา IG ออก = ถอยไป Platform แรก
    const gone = edit({ ...BASE, platforms: [{ ...TT, account_name: '@aaa' }] }, igOnly);
    assert.deepEqual([gone.payee, gone.payee_platform], ['aaa', 'TikTok']);
    // เดิมผ่าน Agency → เปลี่ยนเป็นติดต่อเอง = Platform แรก · ติดต่อเอง → Agency = ชื่อ Agency (payee_platform null)
    const agencyPrev = { ...igOnly, solo: { ...igOnly.solo, contact_mode: 'agency', payee: 'Star', payee_platform: null } };
    const toSelf = edit({ ...BASE, platforms: [TT, IGP] }, agencyPrev);
    assert.deepEqual([toSelf.payee, toSelf.payee_platform], ['flow3rgurrl', 'TikTok']);
    const toAgency = edit({ ...BASE, contact_mode: 'agency', agency: 'Star', platforms: [TT, IGP] }, igOnly);
    assert.deepEqual([toAgency.payee, toAgency.payee_platform], ['Star', null]);
    // กลุ่มที่ยังไม่มี payee_platform: ดูจากบัญชีที่ชื่อตรงกับ payee → Platform ของกลุ่ม (รุ่นก่อนรอบ 4 มี Platform เดียว)
    const noPP = { ...igOnly, platform: 'X', solo: { contact_mode: 'self', payee: 'b.ig', account_name: 'b.ig', accounts: [{ platform: 'Instagram', account_name: 'b.ig' }] } };
    assert.equal(edit({ ...BASE, platforms: [TT, IGP] }, noPP).payee_platform, 'Instagram');
    const round3 = { key: 'gI', platform: 'Instagram', solo: { contact_mode: 'self', payee: 'b.ig', account_name: 'b.ig' } };
    assert.deepEqual([edit({ ...BASE, platforms: [TT, IGP] }, round3).payee, solo.soloPayeePlatform(inputOf({ ...BASE, platforms: [TT, IGP] }), round3)],
        ['b.ig', 'Instagram']);
    // ไม่มีกลุ่มเดิม (เพิ่มใหม่) = Platform แรก
    assert.equal(solo.buildSoloGroup(inputOf({ ...BASE, platforms: [TT, IGP] }), 'g').solo.payee, 'flow3rgurrl');
});

test('soloPersons / withSoloBudgets: ข้อมูลแถวต่อ Platform · งบต่อ Platform จากค่าตัวจริง', () => {
    const i = inputOf({ ...MULTI, contact_mode: 'agency', agency: 'Star Model' });
    assert.deepEqual(solo.soloPersons(i, 'gK'), [
        { platform: 'TikTok', account_name: 'flow3rgurrl', link_account: TT.link_account, followers: 85000, tier: TT.tier, content_type: 'Review',
          fee: 5000, product: 'BTA4-01, BTA4-02', agency: 'Star Model', group_key: 'gK', code_expire: 60 },
        { platform: 'Instagram', account_name: 'flow.ig', link_account: null, followers: 12000, tier: IG.tier, content_type: 'Reels',
          fee: 0, product: 'BTA4-01, BTA4-02', agency: 'Star Model', group_key: 'gK', code_expire: 60 }
    ]);
    const g = solo.buildSoloGroup(i, 'gK');
    const out = solo.withSoloBudgets(g, { TikTok: 12345.555, Instagram: 0 });
    assert.deepEqual(out.platform_budgets, { TikTok: 12345.56, Instagram: 0 });
    assert.equal(out.total, 12345.56);
    assert.deepEqual(out.group.blocks.map(b => b.budget), [12345.56, 0]);
    assert.equal(out.group.budget, 12345.56);
    assert.equal(g.blocks[0].budget, 10000, 'ไม่แก้กลุ่มเดิม');
    // Platform ที่ยังไม่มีคลิป = 0 · แถวที่ Platform ไม่อยู่ในกลุ่ม (ข้อมูลเพี้ยน) ยังนับรวมในงบ
    assert.deepEqual(solo.withSoloBudgets(g, { TikTok: 100, X: 50 }).platform_budgets, { TikTok: 100, Instagram: 0, X: 50 });
    assert.equal(solo.withSoloBudgets(g, { TikTok: 100, X: 50 }).total, 150);
    assert.deepEqual(solo.withSoloBudgets({}, { TikTok: 7 }), { group: { budget: 7 }, total: 7, platform_budgets: { TikTok: 7 } });
});

// ---------------------------------------------------------------- ขั้นงาน + สรุป
test('soloClipStep: ดราฟ → ลงงาน → Gencode → ID Post (TikTok) → ยิงแอด', () => {
    const g = solo.buildSoloGroup(inputOf(MULTI), 'g');
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
    const noGen = solo.buildSoloGroup(inputOf({ ...GOOD, no_gencode: true }), 'g');
    assert.equal(solo.soloClipStep(clip({ post_url: 'https://p' }), noGen), 'idpost', 'ไม่ใช้ Gencode = ข้ามขั้น');
});

test('soloSummary: บัญชีต่อ Platform · คลิปต่อ Platform / ทั้งหมด · ค่าตัวรวม · ได้ฟรีไม่ใช่รอค่าตัว · ไม่มีกำหนดลงงาน', () => {
    const g = solo.buildSoloGroup(inputOf(MULTI), 'g');
    const row = over => ({ status: 'confirmed', platform: 'TikTok', account_name: 'flow3rgurrl', link_account: TT.link_account,
        followers: 85000, tier: TT.tier, budget: 5000, ...over });
    const ig = over => row({ platform: 'Instagram', account_name: 'flow.ig', link_account: null, followers: 12000, budget: 0, ...over });
    const sum = solo.soloSummary([
        ig({ id: 4, clip_no: 2 }),
        row({ id: 2, clip_no: 2, draft_link: 'https://d' }),
        ig({ id: 5, clip_no: 3, status: 'rejected' }),
        ig({ id: 3, clip_no: 1 }),
        row({ id: 1, clip_no: 1, post_url: 'https://p', gencode: '#x', id_post: '1', ad_status: 'ยิงแล้ว' })
    ], g);
    assert.deepEqual(sum.platforms, ['TikTok', 'Instagram']);
    assert.deepEqual(sum.steps, ['done', 'review', 'todo', 'todo'], 'เรียงตาม Platform แล้วตามคลิป');
    assert.equal(sum.next_step, 'todo', 'คลิปที่ช้าสุด');
    assert.deepEqual([sum.clip_count, sum.clips, sum.posted, sum.ad_fired], [2, 4, 1, 1]);
    assert.deepEqual([sum.fee_per_clip, sum.fee_total, sum.fee_missing, sum.fee_free], [null, 10000, false, false]);
    assert.deepEqual(sum.accounts, [
        { platform: 'TikTok', account_name: 'flow3rgurrl', link_account: TT.link_account, followers: 85000, tier: TT.tier,
          clips: 2, posted: 1, ad_fired: 1, fee_per_clip: 5000, fee_total: 10000, fee_uneven: false },
        { platform: 'Instagram', account_name: 'flow.ig', link_account: null, followers: 12000, tier: TT.tier,
          clips: 2, posted: 0, ad_fired: 0, fee_per_clip: 0, fee_total: 0, fee_uneven: false }
    ]);
    // บัญชีหลัก (Platform แรก) คงช่องเดิมไว้ให้ตัวอ่านรุ่นก่อน
    assert.deepEqual([sum.account_name, sum.platform, sum.followers, sum.tier, sum.link_account],
        ['flow3rgurrl', 'TikTok', 85000, TT.tier, TT.link_account]);
    assert.deepEqual([sum.contact_mode, sum.payee, sum.agency, sum.products], ['self', 'flow3rgurrl', null, ['BTA4-01', 'BTA4-02']]);
    assert.equal('due_date' in sum, false);

    // ได้ฟรีทุกคลิป = fee_free · ไม่ใช่ fee_missing
    const free = solo.soloSummary([ig({ id: 3, clip_no: 1 }), ig({ id: 4, clip_no: 2 })], g);
    assert.deepEqual([free.fee_free, free.fee_missing, free.fee_per_clip, free.fee_total], [true, false, 0, 0]);
    // ค่าตัวไม่เท่ากันใน Platform เดียว
    const uneven = solo.soloSummary([row({ id: 1, clip_no: 1 }), row({ id: 2, clip_no: 2, budget: '6000.00' })], g);
    assert.deepEqual([uneven.accounts[0].fee_per_clip, uneven.accounts[0].fee_uneven, uneven.accounts[0].fee_total, uneven.fee_per_clip],
        [null, true, 11000, null]);
    // ยังไม่มีคลิป: ชื่อบัญชีจากกลุ่ม · ไม่ได้ฟรี (ยังไม่มีอะไรให้บอก)
    const empty = solo.soloSummary([], g);
    assert.deepEqual([empty.next_step, empty.clips, empty.clip_count, empty.fee_free, empty.fee_per_clip, empty.fee_total],
        ['todo', 0, 0, false, null, 0]);
    assert.deepEqual(empty.accounts.map(a => [a.platform, a.account_name, a.clips]), [['TikTok', 'flow3rgurrl', 0], ['Instagram', 'flow.ig', 0]]);
    // กลุ่มรุ่นก่อนรอบ 4 (Platform เดียว ไม่มี platforms / accounts)
    const old = solo.soloSummary([row({ id: 1, clip_no: 1 })], { platform: 'TikTok', products: [], solo: { contact_mode: 'agency', payee: 'Star' } });
    assert.deepEqual([old.platforms, old.accounts.length, old.payee, old.contact_mode, old.fee_per_clip], [['TikTok'], 1, 'Star', 'agency', 5000]);
});

test('soloName: ชื่อเดียวกันทุก Platform / ต่างกัน · ตัดที่ 500 ตัวอักษรไม่ผ่าครึ่งอีโมจิ', () => {
    assert.equal(solo.soloName(inputOf(GOOD)), 'KOL รายคน · @flow3rgurrl (TikTok)');
    assert.equal(solo.soloName(inputOf({ ...MULTI, platforms: [TT, { ...IG, account_name: 'flow3rgurrl' }] })), 'KOL รายคน · @flow3rgurrl (TikTok, Instagram)');
    assert.equal(solo.soloName(inputOf(MULTI)), 'KOL รายคน · @flow3rgurrl (TikTok) · @flow.ig (Instagram)');
    assert.equal(solo.soloAccountsText(inputOf(MULTI).platforms), '@flow3rgurrl (TikTok) · @flow.ig (Instagram)');
    const long = inputOf({ ...ALL6(), platforms: ALL6().platforms.map((p, k) => ({ ...p, account_name: String(k) + 'x'.repeat(199) })) });
    const n1 = solo.soloName(long);
    assert.equal(Array.from(n1).length, 500);
    assert.ok(n1.endsWith('…'));
    const emoji = inputOf({ ...ALL6(), platforms: ALL6().platforms.map((p, k) => ({ ...p, account_name: String(k) + '😀'.repeat(99) })) });
    const n2 = solo.soloName(emoji);
    assert.ok(Array.from(n2).length <= 500);
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(n2), false, 'ไม่มีครึ่งอีโมจิค้าง');
});

test('soloDeleteBlock / soloClipLive / soloClipEmpty', () => {
    assert.equal(solo.soloDeleteBlock([{ draft_link: 'x' }], []), null);
    assert.match(solo.soloDeleteBlock([{ post_url: 'x' }], []), /ลงงานแล้ว/);
    assert.match(solo.soloDeleteBlock([{ ad_spend: 5 }], []), /ยิงแอดแล้ว/);
    assert.match(solo.soloDeleteBlock([{ perf_stamp: { at: 'x' } }], []), /สแตมป์/);
    assert.match(solo.soloDeleteBlock([{}], [{ id: 1 }]), /งวดจ่าย/);
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

test('todayTH: วันที่ตามเวลาไทย (YYYY-MM-DD) — เที่ยงคืนไทยขึ้นวันใหม่ก่อน UTC', () => {
    const real = Date.now;
    try {
        Date.now = () => Date.parse('2026-09-30T17:00:00.000Z');   // 00:00 วันที่ 1 ต.ค. เวลาไทย
        assert.equal(logic.todayTH(), '2026-10-01');
        Date.now = () => Date.parse('2026-09-30T16:59:59.999Z');
        assert.equal(logic.todayTH(), '2026-09-30');
    } finally {
        Date.now = real;
    }
    assert.match(logic.todayTH(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------- ชั้นเก็บข้อมูล (ทรานแซกชันจำลอง)
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
// ตัวจริงของชั้นเก็บข้อมูล — beforeEach ของเทสต์เส้น API สลับเป็นตัวจำลอง
const realCreateSolo = store.projects.createSolo;
const realSyncSoloBudget = store.projects.syncSoloBudget;
const realUpdateSolo = store.projects.updateSolo;
// คอลัมน์ / ค่าของคำสั่ง UPDATE ที่ updateRow สร้าง
const setOf = x => {
    const cols = /SET (.+) WHERE/.exec(x.q)[1].split(', ').map(s => s.split(' = ')[0].replace(/"/g, ''));
    return Object.fromEntries(cols.map((c, k) => [c, x.vals[k]]));
};
const writes = () => fake.sql.filter(x => /^(INSERT|UPDATE|DELETE)/.test(x.q));

test('createSolo: แถว = Platform × คลิป · person_key เดียว · เวลาเดียวกัน · ข้อมูล/ค่าตัวของ Platform ตัวเอง ในทรานแซกชันเดียว', async () => {
    fake.sql = []; fake.rows = {};
    const i = inputOf({ ...MULTI, contact_mode: 'agency', agency: 'Star Model', code_expire: 30 });
    const { project, rows } = await realCreateSolo(
        { team_id: 1, created_by: 7, name: solo.soloName(i), brand: 'Beauterry', ad_groups: [{ key: 'g1' }], budget: 10000, status: 'Active', campaign_type: 'kol' },
        solo.soloPersons(i, 'g1'), i.clip_names, 'แพรว');
    assert.equal(project.campaign_type, 'solo', 'ประเภทเป็น solo เสมอ');
    assert.equal(project.status, 'Active');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(r => [r.platform, r.clip_no, r.clip_name, r.account_name, r.budget, r.content_type, r.followers]), [
        ['TikTok', 1, 'A', 'flow3rgurrl', 5000, 'Review', 85000], ['TikTok', 2, 'B', 'flow3rgurrl', 5000, 'Review', 85000],
        ['Instagram', 1, 'A', 'flow.ig', 0, 'Reels', 12000], ['Instagram', 2, 'B', 'flow.ig', 0, 'Reels', 12000]
    ]);
    assert.ok(rows.every(r => r.status === 'confirmed' && r.decided_by === 'แพรว' && r.product === 'BTA4-01, BTA4-02'
        && r.agency === 'Star Model' && r.group_key === 'g1' && r.code_expire === 30));
    assert.ok(rows.every(r => r.project_id === project.id && r.person_key === rows[0].person_key && r.submitted_at === rows[0].submitted_at && r.decided_at === rows[0].submitted_at));
    assert.ok(rows[0].person_key, '1 การจ้าง = 1 คน (person_key เดียว)');
    assert.equal(fake.sql.filter(x => x.q.startsWith('INSERT')).length, 5);
    const single = await realCreateSolo({ team_id: 1, name: 'x', brand: 'Jdent' }, solo.soloPersons(inputOf(withPlat(TT, { platform: 'Lemon8' })), 'g2'), []);
    assert.equal(single.rows.length, 1);
    assert.deepEqual([single.rows[0].clip_name, single.rows[0].platform], [null, 'Lemon8']);
    await assert.rejects(realCreateSolo({ name: 'x' }, [], []), /อย่างน้อย 1 Platform/);
});

test('syncSoloBudget: งบต่อ Platform = ผลรวมค่าตัว (ไม่นับที่ถูกปฏิเสธ) ลงบล็อกของ Platform นั้น · ไม่ใช่ solo = ไม่ทำอะไร', async () => {
    fake.sql = [];
    fake.lock = { campaign_type: 'solo', ad_groups: [{ key: 'g1', platform: 'TikTok', platforms: ['TikTok', 'Instagram'], budget: 1,
        blocks: [{ platform: 'TikTok', budget: 1 }, { platform: 'Instagram', budget: 1 }] }] };
    fake.sums['55'] = { TikTok: '12345.5', Instagram: '0' };
    const out = await realSyncSoloBudget(55);
    assert.ok(out);
    const set = setOf(fake.sql.find(x => x.q.startsWith('UPDATE projects')));
    assert.equal(set.budget, 12345.5);
    const groups = JSON.parse(set.ad_groups);
    assert.equal(groups[0].budget, 12345.5);
    assert.deepEqual(groups[0].blocks.map(b => b.budget), [12345.5, 0]);
    assert.deepEqual(JSON.parse(set.platform_budgets), { TikTok: 12345.5, Instagram: 0 });
    assert.match(fake.sql.find(x => /SUM\(budget\)/.test(x.q)).q, /status <> 'rejected' GROUP BY platform/);
    fake.sql = [];
    fake.lock = { campaign_type: 'kol', ad_groups: [] };
    assert.equal(await realSyncSoloBudget(55), null);
    assert.equal(fake.sql.some(x => x.q.startsWith('UPDATE')), false, 'แคมเปญปกติไม่แตะงบ');
    fake.lock = null;
});

// ---- updateSolo ----
const G0 = { key: 'gK', platform: 'TikTok', platforms: ['TikTok'], budget: 10000, blocks: [{ platform: 'TikTok', budget: 10000 }],
    solo: { contact_mode: 'self', payee: 'flow3rgurrl', account_name: 'flow3rgurrl' } };
const clipRow = (platform, no, over = {}) => ({ id: (platform === 'TikTok' ? 800 : 900) + no, project_id: 80, platform, clip_no: no,
    person_key: 'pX', budget: platform === 'TikTok' ? 5000 : 0, status: 'confirmed', group_key: 'gK', ...over });
// อาร์กิวเมนต์แบบที่ route ส่ง (ฟอร์มแก้ไข: ค่าตัวส่งมาเฉพาะ Platform ใหม่)
const editArgs = (body, over = {}) => {
    const i = inputOf(body, { editing: true });
    return {
        fields: { name: solo.soloName(i), brand: i.brand, products: i.products, owner: i.owner, ...(over.fields || {}) },
        group: solo.buildSoloGroup(i, 'NEW'), persons: solo.soloPersons(i, 'NEW'),
        clipNames: i.clip_names, codeExpire: i.code_expire
    };
};
const EDIT_TT = { ...BASE, code_expire: 30, platforms: [{ ...TT, fee: '' }] };
const EDIT_BOTH = { ...EDIT_TT, platforms: [{ ...TT, fee: '' }, { ...IG, fee: 0 }] };
const resetEdit = (clips, proj = {}) => {
    fake.sql = []; fake.rows = {}; fake.its = [];
    fake.proj = { id: 80, campaign_type: 'solo', brand: 'Beauterry', ad_groups: [structuredClone(G0)], ...proj };
    fake.clips = clips;
};

test('updateSolo: แบรนด์ล็อกเมื่อมีคลิปเริ่มงาน · ตีกลับก่อนเขียนอะไรเลย', async () => {
    resetEdit([clipRow('TikTok', 1, { post_url: 'https://p' })]);
    const r = await realUpdateSolo(80, editArgs({ ...EDIT_TT, brand: 'Jdent' }));
    assert.deepEqual(r.error, { code: 409, message: 'เปลี่ยนแบรนด์ไม่ได้ — มีคลิปที่ลงงาน/ยิงแอดแล้ว' });
    assert.deepEqual(writes(), []);
    // แบรนด์เดิม = แก้ส่วนอื่นได้แม้ลงงานแล้ว
    fake.sums['80'] = { TikTok: 5000 };
    assert.ok((await realUpdateSolo(80, editArgs(EDIT_TT))).project);
});

test('updateSolo: เพิ่ม Platform ต้องมีค่าตัว (0 = ได้ฟรี) · แถวใหม่ person_key เดิม · แถวเดิมไม่เปลี่ยน Platform · งบต่อ Platform · ไม่แตะวันที่', async () => {
    resetEdit([clipRow('TikTok', 1, { post_url: 'https://p', gencode: '#keep' })]);
    const noFee = await realUpdateSolo(80, editArgs({ ...EDIT_TT, platforms: [{ ...TT, fee: '' }, { ...IG, fee: '' }] }));
    assert.equal(noFee.error.code, 400);
    assert.match(noFee.error.message, /^Instagram: .*ได้ฟรีใส่ 0/);
    assert.deepEqual(writes(), [], 'ไม่เขียนอะไร');

    resetEdit([clipRow('TikTok', 1, { post_url: 'https://p', gencode: '#keep' })]);
    fake.sums['80'] = { TikTok: 5000, Instagram: 0 };
    const out = await realUpdateSolo(80, editArgs(EDIT_BOTH), 'แพรว');
    assert.ok(out.project, JSON.stringify(out));
    assert.deepEqual([out.added, out.removed, out.platforms_added, out.platforms_removed], [0, 0, ['Instagram'], []]);
    assert.deepEqual(fake.rows.submissions.map(x => [x.platform, x.clip_no, x.account_name, x.budget, x.person_key, x.content_type, x.status, x.decided_by, x.group_key, x.code_expire]),
        [['Instagram', 1, 'flow.ig', 0, 'pX', 'Reels', 'confirmed', 'แพรว', 'gK', 30]]);
    const upd = setOf(fake.sql.find(x => x.q.startsWith('UPDATE submissions')));
    assert.equal('platform' in upd, false, 'แถวเดิมไม่เปลี่ยน Platform');
    assert.equal('code_expire' in upd, false, 'คลิปที่มี Gencode แล้วไม่เปลี่ยนอายุ');
    assert.deepEqual([upd.account_name, upd.content_type, upd.group_key], ['flow3rgurrl', 'Review', 'gK']);
    const proj = setOf(fake.sql.find(x => x.q.startsWith('UPDATE projects')));
    assert.equal('start_date' in proj || 'end_date' in proj, false, 'ไม่แตะวันที่ของรายการ');
    assert.equal(proj.budget, 5000);
    assert.deepEqual(JSON.parse(proj.platform_budgets), { TikTok: 5000, Instagram: 0 });
    const saved = JSON.parse(proj.ad_groups)[0];
    assert.equal(saved.key, 'gK', 'คงคีย์กลุ่มเดิม (แถวคลิปผูกอยู่)');
    assert.deepEqual(saved.platforms, ['TikTok', 'Instagram']);
    assert.deepEqual(saved.blocks.map(b => [b.platform, b.budget]), [['TikTok', 5000], ['Instagram', 0]]);
    assert.equal(saved.budget, 5000);
    assert.deepEqual(saved.solo.accounts, [{ platform: 'TikTok', account_name: 'flow3rgurrl' }, { platform: 'Instagram', account_name: 'flow.ig' }]);
});

test('updateSolo: เอา Platform ออกได้เมื่อทุกคลิปของ Platform นั้นยังว่าง · มีงานแล้ว = 409 บอกชื่อ Platform', async () => {
    resetEdit([clipRow('TikTok', 1), clipRow('Instagram', 1, { draft_link: 'https://d' })]);
    const busy = await realUpdateSolo(80, editArgs(EDIT_TT));
    assert.equal(busy.error.code, 409);
    assert.match(busy.error.message, /^เอา Instagram ออกไม่ได้ — Instagram คลิปที่ 1 มีงานแล้ว/);
    assert.deepEqual(writes(), []);

    resetEdit([clipRow('TikTok', 1), clipRow('Instagram', 1)]);
    fake.sums['80'] = { TikTok: 5000 };
    const out = await realUpdateSolo(80, editArgs(EDIT_TT));
    assert.ok(out.project, JSON.stringify(out));
    assert.deepEqual([out.platforms_removed, out.platforms_added, out.removed], [['Instagram'], [], 0]);
    assert.deepEqual(fake.sql.filter(x => x.q.startsWith('DELETE')).map(x => x.vals[0]), [901]);
    assert.deepEqual(JSON.parse(setOf(fake.sql.find(x => x.q.startsWith('UPDATE projects'))).platform_budgets), { TikTok: 5000 });
    // สลับ Platform (ยังไม่เริ่มงาน) = เอาของเดิมออก + เพิ่มใหม่ (ต้องมีค่าตัว) — person_key เดิม
    resetEdit([clipRow('TikTok', 1)]);
    fake.sums['80'] = { Instagram: 0 };
    const sw = await realUpdateSolo(80, editArgs({ ...EDIT_TT, platforms: [{ ...IG, fee: 0 }] }));
    assert.deepEqual([sw.platforms_added, sw.platforms_removed], [['Instagram'], ['TikTok']]);
    assert.deepEqual(fake.rows.submissions.map(x => [x.platform, x.person_key, x.budget]), [['Instagram', 'pX', 0]]);
});

test('updateSolo: ลด/เพิ่มคลิปทีละ Platform — ลดได้เฉพาะคลิปว่าง · เพิ่มใช้ค่าตัวคลิปแรกของ Platform นั้น · ชื่อคลิปใช้ร่วมกัน', async () => {
    resetEdit([clipRow('TikTok', 1), clipRow('Instagram', 1), clipRow('TikTok', 2, { gencode: '#g' }), clipRow('Instagram', 2)]);
    const busy = await realUpdateSolo(80, editArgs(EDIT_BOTH));
    assert.equal(busy.error.code, 409);
    assert.match(busy.error.message, /^ลดจำนวนคลิปไม่ได้ — TikTok คลิปที่ 2 มีงานแล้ว/);
    assert.deepEqual(writes(), []);

    resetEdit([clipRow('TikTok', 1, { gencode: '#keep' }), clipRow('Instagram', 1), clipRow('TikTok', 2), clipRow('Instagram', 2)]);
    fake.sums['80'] = { TikTok: 5000, Instagram: 0 };
    const less = await realUpdateSolo(80, editArgs(EDIT_BOTH));
    assert.ok(less.project, JSON.stringify(less));
    assert.deepEqual([less.removed, less.added], [2, 0]);
    assert.deepEqual(fake.sql.filter(x => x.q.startsWith('DELETE')).map(x => x.vals[0]).sort(), [802, 902]);
    assert.ok(fake.sql.filter(x => x.q.startsWith('UPDATE submissions')).every(x => setOf(x).clip_name === null), '1 คลิป = ไม่มีชื่อคลิป');

    resetEdit([clipRow('TikTok', 1, { budget: 7000 }), clipRow('Instagram', 1)]);
    fake.sums['80'] = { TikTok: 21000, Instagram: 0 };
    const more = await realUpdateSolo(80, editArgs({ ...EDIT_BOTH, clips: 3, clip_names: ['A', 'B', 'C'] }), 'แพรว');
    assert.deepEqual([more.removed, more.added, more.platforms_added], [0, 4, []]);
    assert.deepEqual(fake.rows.submissions.map(x => [x.platform, x.clip_no, x.clip_name, x.budget, x.person_key, x.code_expire]), [
        ['TikTok', 2, 'B', 7000, 'pX', 30], ['TikTok', 3, 'C', 7000, 'pX', 30],
        ['Instagram', 2, 'B', 0, 'pX', 30], ['Instagram', 3, 'C', 0, 'pX', 30]
    ]);
    assert.deepEqual(fake.sql.filter(x => x.q.startsWith('UPDATE submissions')).map(x => [setOf(x).clip_name, setOf(x).code_expire]),
        [['A', 30], ['A', 30]], 'คลิปที่ยังไม่มี Gencode ได้อายุใหม่ · ชื่อคลิปตามลำดับ');
    const proj = setOf(fake.sql.find(x => x.q.startsWith('UPDATE projects')));
    assert.equal(proj.budget, 21000, 'งบ = ผลรวมค่าตัวจริง');
    assert.deepEqual(JSON.parse(proj.platform_budgets), { TikTok: 21000, Instagram: 0 });
});

test('updateSolo: ผู้รับเงินเปลี่ยน — งวดที่รอจ่ายย้ายตาม · จ่ายแล้ว/เข้ารอบแล้ว = 409 · ตีกลับข้ออื่นทีหลังก็ไม่ย้ายงวดค้างไว้', async () => {
    const agencyG0 = { ...G0, solo: { contact_mode: 'agency', payee: 'Old Agency', account_name: 'flow3rgurrl' } };
    resetEdit([clipRow('TikTok', 1)], { ad_groups: [agencyG0] });
    fake.its = [{ id: 1, agency: 'Old Agency', status: 'pending', batch_id: null }];
    fake.sums['80'] = { TikTok: 5000 };
    const moved = await realUpdateSolo(80, editArgs(EDIT_TT));   // ติดต่อเอง → ผู้รับเงินใหม่ = บัญชี TikTok
    assert.ok(moved.project, JSON.stringify(moved));
    const mv = fake.sql.find(x => x.q.startsWith('UPDATE installments SET agency'));
    assert.deepEqual(mv && mv.vals, ['flow3rgurrl', 80, 'Old Agency']);

    resetEdit([clipRow('TikTok', 1)], { ad_groups: [agencyG0] });
    fake.its = [{ id: 1, agency: 'Old Agency', status: 'paid', batch_id: 3 }];
    const blocked = await realUpdateSolo(80, editArgs(EDIT_TT));
    assert.equal(blocked.error.code, 409);
    assert.match(blocked.error.message, /ผู้รับเงิน.*Old Agency/);
    assert.deepEqual(writes(), []);

    // งวดรอจ่าย (ย้ายได้) แต่คลิปที่จะลดมีงานแล้ว → 409 และต้องไม่มี UPDATE installments ค้างในทรานแซกชัน
    resetEdit([clipRow('TikTok', 1), clipRow('TikTok', 2, { draft_link: 'https://d' })], { ad_groups: [agencyG0] });
    fake.its = [{ id: 1, agency: 'Old Agency', status: 'pending', batch_id: null }];
    const late = await realUpdateSolo(80, editArgs(EDIT_TT));
    assert.equal(late.error.code, 409);
    assert.match(late.error.message, /คลิปที่ 2/);
    assert.deepEqual(writes(), [], 'ตรวจครบทุกข้อก่อนเขียน — ไม่มีอะไรถูก COMMIT ครึ่ง ๆ');

    // ผู้รับเงินเดิม = ไม่แตะงวด
    resetEdit([clipRow('TikTok', 1)]);
    fake.sums['80'] = { TikTok: 5000 };
    assert.ok((await realUpdateSolo(80, editArgs(EDIT_TT))).project);
    assert.equal(fake.sql.some(x => /installments/.test(x.q)), false);
});

test('updateSolo: ไม่ใช่ KOL รายคน 400 · ไม่เจอ 404 · ไม่มี Platform 400 · ตีกลับในทรานแซกชันโยนแล้วแปลงเป็น { error } (ROLLBACK)', async () => {
    resetEdit([], { campaign_type: 'kol', ad_groups: [] });
    assert.deepEqual((await realUpdateSolo(81, editArgs(EDIT_TT))).error, { code: 400, message: 'รายการนี้ไม่ใช่ KOL รายคน' });
    fake.proj = null;
    assert.equal((await realUpdateSolo(82, editArgs(EDIT_TT))).error.code, 404);
    assert.equal((await realUpdateSolo('abc', editArgs(EDIT_TT))).error.code, 404);
    resetEdit([clipRow('TikTok', 1)]);
    assert.equal((await realUpdateSolo(80, { ...editArgs(EDIT_TT), persons: [] })).error.code, 400);
    // ตีกลับต้องโยนออกจาก callback ของ withTransaction (ตัวจริง ROLLBACK) — ไม่ใช่คืนค่าปกติที่จะ COMMIT
    const realTx = base.withTransaction;
    let threw = null;
    base.withTransaction = async fn => { try { return await fn(fakeClient); } catch (e) { threw = e; throw e; } };
    try {
        delete require.cache[require.resolve(path.join(SRC, 'store/pg/projects'))];
        const { projects: fresh } = require(path.join(SRC, 'store/pg/projects'));
        resetEdit([clipRow('TikTok', 1, { post_url: 'https://p' })]);
        const r = await fresh.updateSolo(80, editArgs({ ...EDIT_TT, brand: 'Jdent' }));
        assert.equal(r.error.code, 409);
        assert.ok(threw && /เปลี่ยนแบรนด์ไม่ได้/.test(threw.message), 'โยนจากในทรานแซกชัน');
    } finally {
        base.withTransaction = realTx;
    }
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
    store.projects.updateSolo = realUpdateSolo;
    store.projects.syncSoloBudget = realSyncSoloBudget;
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
    store.projects.createSolo = async (fields, persons, clips, by) => {
        created = { fields, persons, clips, by };
        const count = clips.length < 2 ? 1 : clips.length;
        return { project: { id: 99, name: fields.name, team_id: fields.team_id, campaign_type: 'solo' },
            rows: persons.flatMap((p, k) => Array.from({ length: count }, (_, c) => ({ id: 900 + k * 10 + c, platform: p.platform, clip_no: c + 1 }))) };
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

test('POST /api/projects/solo: หลาย Platform — กลุ่มที่ server สร้างเอง · แถวต่อ Platform · วันที่ = วันนี้ (ไทย) · ประวัติบอกค่าตัวทุก Platform', async () => {
    const r = await call(2, 'POST', '/projects/solo', { ...MULTI, ad_groups: [{ key: 'hack', budget: 1 }], budget: 1, campaign_type: 'kol',
        status: 'Completed', platform_budgets: { X: 1 }, hire_date: '2020-01-01', due_date: '2020-01-10' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const f = created.fields;
    assert.equal(f.name, 'KOL รายคน · @flow3rgurrl (TikTok) · @flow.ig (Instagram)');
    assert.deepEqual([f.team_id, f.created_by, f.brand, f.owner, f.creator, f.status, f.kol_target, f.budget],
        [1, 2, 'Beauterry', 'แพรว', 'แพรว', 'Active', 1, 10000]);
    const today = logic.todayTH();
    assert.deepEqual([f.start_date, f.end_date], [today, today], 'ไม่ใช้วันที่ที่ส่งมา');
    assert.equal(f.ad_groups.length, 1);
    assert.notEqual(f.ad_groups[0].key, 'hack');
    assert.deepEqual(f.ad_groups[0].platforms, ['TikTok', 'Instagram']);
    assert.equal(f.ad_groups[0].budget, 10000);
    assert.deepEqual(f.platform_budgets, { TikTok: 10000, Instagram: 0 });
    assert.deepEqual(created.clips, ['A', 'B']);
    assert.deepEqual(created.persons.map(p => [p.platform, p.account_name, p.fee, p.content_type, p.group_key, p.product, p.agency]), [
        ['TikTok', 'flow3rgurrl', 5000, 'Review', f.ad_groups[0].key, 'BTA4-01, BTA4-02', null],
        ['Instagram', 'flow.ig', 0, 'Reels', f.ad_groups[0].key, 'BTA4-01, BTA4-02', null]
    ]);
    assert.equal(created.by, 'แพรว');
    assert.equal(r.body.data.rows.length, 4);
    assert.equal(logged.at(-1).summary,
        'เพิ่ม KOL รายคน: @flow3rgurrl (TikTok · 2 คลิป · ฿5,000/คลิป) · @flow.ig (Instagram · 2 คลิป · ได้ฟรี) · รวม ฿10,000');
});

test('POST /api/projects/solo: แท็บเก่า (ข้อมูลแบบแบน) ยังเพิ่มได้ · ได้ฟรีทั้งรายการ', async () => {
    const r = await call(2, 'POST', '/projects/solo', FLAT);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(created.fields.name, 'KOL รายคน · @flow3rgurrl (TikTok)');
    assert.deepEqual([created.fields.start_date, created.fields.end_date], [logic.todayTH(), logic.todayTH()]);
    assert.deepEqual(created.persons.map(p => [p.platform, p.fee]), [['TikTok', 5000]]);
    const free = await call(2, 'POST', '/projects/solo', withPlat(TT, { fee: 0 }));
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal(created.fields.budget, 0);
    assert.match(logged.at(-1).summary, /ได้ฟรี\) · รวม ฿0$/);
});

test('POST /api/projects/solo: ข้อมูลไม่ครบ 400 · แบรนด์นอกสิทธิ์ 403 · ไม่มีทีม 400 — ไม่สร้างอะไร', async () => {
    const bad = await call(2, 'POST', '/projects/solo', { ...MULTI, platforms: [TT, { ...IG, fee: '' }] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /^Instagram: .*ได้ฟรีใส่ 0/);
    const none = await call(2, 'POST', '/projects/solo', { ...BASE, platform: '' });
    assert.equal(none.status, 400);
    assert.equal(none.body.message, 'เลือก Platform อย่างน้อย 1 ตัว');
    assert.notEqual(none.body.message, OLD_SERVER_MSG);
    assert.equal((await call(3, 'POST', '/projects/solo', GOOD)).status, 403);
    const noTeam = await call(4, 'POST', '/projects/solo', GOOD);
    assert.equal(noTeam.status, 400);
    assert.match(noTeam.body.message, /ทีม/);
    assert.equal(created, null);
});

test('PUT /api/projects/:id บน KOL รายคน: แก้ได้แค่สถานะ (กันฟอร์มแคมเปญ/หน้าเว็บเก่าทับกลุ่ม) · ยังรับ Completed ของแถวเก่า · แคมเปญปกติแก้ได้ตามเดิม', async () => {
    const r1 = await call(2, 'PUT', '/projects/70', { name: 'x', ad_groups: [] });
    assert.equal(r1.status, 400);
    assert.match(r1.body.message, /KOL รายคน/);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Completed', name: 'x' })).status, 400);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Draft' })).status, 400);
    assert.equal(updates.length, 0);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Cancelled' })).status, 200);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Active' })).status, 200);
    assert.equal((await call(2, 'PUT', '/projects/70', { status: 'Completed' })).status, 200);
    assert.deepEqual(updates.map(u => [u.id, u.f.status]), [[70, 'Cancelled'], [70, 'Active'], [70, 'Completed']]);
    assert.equal((await call(2, 'PUT', '/projects/71', { name: 'KOL Oct 2', campaign_type: 'kol' })).status, 200);
    assert.equal((await call(2, 'PUT', '/projects/71', { campaign_type: 'solo' })).status, 400, 'เปลี่ยนแคมเปญเป็น solo ไม่ได้');
});

test('หน้าเว็บรุ่นเก่า: เปลี่ยนสถานะ/ลบรายคลิป · ลิงก์แชร์ · สร้าง solo ผ่านเส้นทั่วไป — ใช้กับ KOL รายคนไม่ได้', async () => {
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
    assert.equal((await call(2, 'POST', '/projects/70/share')).status, 400);
    const gen = await call(2, 'POST', '/projects', { name: 'x', brand: 'Beauterry', campaign_type: 'solo', budget: 500000 });
    assert.equal(gen.status, 400);
    assert.match(gen.body.message, /เพิ่ม KOL รายคน/);
    // แคมเปญปกติยังเปลี่ยนสถานะรายคลิปได้ตามเดิม
    store.submissions.update = async () => ({ id: 710 });
    const kolSt = await call(2, 'PUT', '/projects/71/submissions/710', { status: 'rejected' });
    assert.notEqual(kolSt.status, 400, JSON.stringify(kolSt.body));
});

test('PUT /:id/fees บน KOL รายคน: พิมพ์ 0 เอง (manual) = ได้ฟรี · ล้างค่าตัว / หารเฉลี่ยเป็น 0 = ไม่ได้ · งบตามค่าตัวทันที', async () => {
    for (const reason of ['clear', 'divide']) {
        const r = await call(2, 'PUT', '/projects/70/fees', { items: [{ sub_id: 700, budget: 0, from: 5000 }], reason });
        assert.equal(r.status, 400, reason);
        assert.match(r.body.message, /ล้างค่าตัวของ KOL รายคนไม่ได้ — ถ้าได้ฟรีให้พิมพ์ 0/, reason);
    }
    assert.equal(feeCalls.length, 0);
    assert.deepEqual(syncCalls, []);
    const free = await call(2, 'PUT', '/projects/70/fees', { items: [{ sub_id: 700, budget: 0, from: 5000 }], reason: 'manual' });
    assert.equal(free.status, 200, JSON.stringify(free.body));
    assert.deepEqual(feeCalls.map(c => c.items), [[{ sub_id: 700, budget: 0, from: 5000 }]]);
    assert.deepEqual(syncCalls, [70]);
    // หารเฉลี่ยค่าที่มากกว่า 0 ยังได้ตามเดิม
    assert.equal((await call(2, 'PUT', '/projects/70/fees', { items: [{ sub_id: 700, budget: 2500, from: 0 }], reason: 'divide' })).status, 200);
    // แคมเปญปกติ: ล้างค่าตัวเป็น 0 ได้ตามเดิม และไม่คิดงบ solo
    subsById[71] = [{ id: 710, project_id: 71, budget: 1 }];
    assert.equal((await call(2, 'PUT', '/projects/71/fees', { items: [{ sub_id: 710, budget: 0, from: 1 }], reason: 'clear' })).status, 200);
    assert.deepEqual(syncCalls, [70, 70]);
});

test('PUT /api/projects/:id/solo: แก้ข้อมูล (ไม่ใช่ solo 400 · ข้อมูลผิด 400 · แบรนด์นอกสิทธิ์ 403 · ผลจาก store ส่งต่อ) + ประวัติ', async () => {
    let got = null;
    store.projects.updateSolo = async (id, a, by) => { got = { id: Number(id), a, by };
        return a.clipNames.length === 3 ? { error: { code: 409, message: 'ลดจำนวนคลิปไม่ได้ — TikTok คลิปที่ 3 มีงานแล้ว' } }
            : { project: { id: 70, name: a.fields.name, team_id: 1 }, removed: 0, added: 2, platforms_added: ['Instagram'], platforms_removed: ['Lemon8'] }; };
    assert.equal((await call(2, 'PUT', '/projects/71/solo', GOOD)).status, 400, 'แคมเปญปกติ');
    assert.equal(got, null);
    const bad = await call(2, 'PUT', '/projects/70/solo', withPlat(TT, { account_name: '' }));
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /^TikTok: /);
    assert.equal((await call(2, 'PUT', '/projects/70/solo', { ...GOOD, brand: 'Jdent' })).status, 403);
    assert.equal(got, null);
    // ค่าตัวส่งมาเฉพาะ Platform ใหม่ (Instagram) · TikTok ไม่ส่ง = null · วันที่ที่ส่งมาไม่ใช้
    const ok = await call(2, 'PUT', '/projects/70/solo', { ...MULTI, platforms: [{ ...TT, fee: undefined }, { ...IG, fee: 0 }], hire_date: '2020-01-01', due_date: '2020-01-02' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([got.id, got.by], [70, 'แพรว']);
    assert.equal(got.a.group.key, 'g1', 'คงคีย์กลุ่มเดิม');
    assert.deepEqual(got.a.group.platforms, ['TikTok', 'Instagram']);
    assert.deepEqual(got.a.persons.map(p => [p.platform, p.fee, p.group_key]), [['TikTok', null, 'g1'], ['Instagram', 0, 'g1']]);
    assert.deepEqual(got.a.clipNames, ['A', 'B']);
    assert.equal(got.a.fields.name, 'KOL รายคน · @flow3rgurrl (TikTok) · @flow.ig (Instagram)');
    assert.equal('start_date' in got.a.fields || 'end_date' in got.a.fields, false, 'ไม่ส่งวันที่ไปแก้');
    assert.equal(got.a.fields.updated_by, 2);
    assert.equal(logged.at(-1).summary, 'แก้ข้อมูล KOL รายคน: @flow3rgurrl (TikTok) · @flow.ig (Instagram) (เพิ่ม Instagram · เอา Lemon8 ออก · เพิ่ม 2 คลิป)');
    // แท็บเก่า (แบบแบน ไม่มีค่าตัว) ยังแก้ได้
    const { fee, ...flatNoFee } = FLAT;
    assert.equal(fee, 5000);
    assert.equal((await call(2, 'PUT', '/projects/70/solo', flatNoFee)).status, 200);
    assert.deepEqual(got.a.persons.map(p => [p.platform, p.fee]), [['TikTok', null]]);
    const conflict = await call(2, 'PUT', '/projects/70/solo', { ...MULTI, clips: 3, clip_names: ['A', 'B', 'C'] });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.message, /TikTok คลิปที่ 3/);
});

test('PUT /api/projects/:id/solo จากแท็บเก่า (แบบแบน): การจ้างหลาย Platform / สลับ Platform = 409 ให้กด F5 (ไม่เรียก updateSolo) · Platform เดียวเดิมยังแก้ได้', async () => {
    let calls = 0;
    store.projects.updateSolo = async (id, a) => { calls++;
        return { project: { id: Number(id), name: a.fields.name, team_id: 1 }, removed: 0, added: 0, platforms_added: [], platforms_removed: [] }; };
    const STALE = 'หน้าเว็บนี้เป็นรุ่นเก่า — กด F5 แล้วแก้อีกครั้ง';
    const { fee, ...flatNoFee } = FLAT;   // แท็บเก่าไม่ส่งค่าตัวตอนแก้ไข
    assert.equal(fee, 5000);
    // การจ้างหลาย Platform — ฟอร์มเก่าเห็นแค่ Platform เดียว ถ้าส่งต่อไป Platform ที่มองไม่เห็นจะถูกลบคลิปทิ้ง
    projectsById[70].ad_groups = [{ key: 'g1', platform: 'TikTok', platforms: ['TikTok', 'Instagram'], solo: { payee: 'a' } }];
    for (const body of [flatNoFee, { ...flatNoFee, platform: 'Instagram' }, { ...flatNoFee, platform: '' }]) {
        const r = await call(2, 'PUT', '/projects/70/solo', body);
        assert.equal(r.status, 409, JSON.stringify(body.platform));
        assert.equal(r.body.message, STALE);
        assert.ok(![OLD_SERVER_MSG, 'ใส่ชื่อบัญชี KOLก่อนนะ'].includes(r.body.message), 'ไม่ใช้ข้อความที่หน้าเว็บใช้แยก server รุ่นเก่า');
    }
    // กลุ่มที่มีแค่ blocks (ไม่มี platforms) ก็นับ Platform จากบล็อก
    projectsById[70].ad_groups = [{ key: 'g1', platform: 'TikTok', blocks: [{ platform: 'TikTok' }, { platform: 'Lemon8' }], solo: { payee: 'a' } }];
    assert.equal((await call(2, 'PUT', '/projects/70/solo', flatNoFee)).status, 409);
    // Platform เดียว แต่ส่ง Platform อื่นมา (สลับ Platform จากแท็บเก่า) = 409
    projectsById[70].ad_groups = [{ key: 'g1', platform: 'TikTok', platforms: ['TikTok'], solo: { payee: 'a' } }];
    const sw = await call(2, 'PUT', '/projects/70/solo', { ...flatNoFee, platform: 'Instagram', content_type: 'Reels' });
    assert.deepEqual([sw.status, sw.body.message], [409, STALE]);
    // กลุ่มรุ่นก่อนรอบ 4 (มีแค่ platform) ก็เทียบได้
    projectsById[70].ad_groups = [{ key: 'g1', platform: 'TikTok', solo: { payee: 'a' } }];
    assert.equal((await call(2, 'PUT', '/projects/70/solo', { ...flatNoFee, platform: 'Lemon8' })).status, 409);
    assert.equal(calls, 0, 'ไม่เรียก updateSolo เลย');
    // Platform เดียวกัน = แก้ได้ตามเดิม
    const ok = await call(2, 'PUT', '/projects/70/solo', flatNoFee);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(calls, 1);
    // หน้าเว็บรุ่นใหม่ (platforms[]) ไม่ผ่านด่านนี้ — เปลี่ยน Platform ได้ตามปกติ (store ตัดสินเรื่องคลิปที่มีงานเอง)
    projectsById[70].ad_groups = [{ key: 'g1', platform: 'TikTok', platforms: ['TikTok', 'Instagram'], solo: { payee: 'a' } }];
    assert.equal((await call(2, 'PUT', '/projects/70/solo', { ...GOOD, platforms: [{ ...IG, fee: 0 }] })).status, 200);
    assert.equal(calls, 2);
});

test('PUT /api/projects/:id/solo: เพิ่ม TikTok ให้การจ้าง IG (ติดต่อเอง · มีงวดจ่ายแล้ว) — บันทึกได้ · ผู้รับเงินยังเป็นบัญชี IG · ไม่แตะงวดจ่าย', async () => {
    const igInput = inputOf({ ...BASE, platforms: [{ ...IG, account_name: 'b.ig', fee: 2000 }] });
    const gI = solo.buildSoloGroup(igInput, 'gI');
    projectsById[72] = { id: 72, name: solo.soloName(igInput), brand: 'Beauterry', team_id: 1, campaign_type: 'solo', status: 'Active', ad_groups: [structuredClone(gI)] };
    store.projects.updateSolo = realUpdateSolo;   // ชั้นเก็บข้อมูลตัวจริงบนทรานแซกชันจำลอง
    fake.sql = []; fake.rows = {};
    fake.proj = structuredClone(projectsById[72]);
    fake.clips = [{ id: 920, project_id: 72, platform: 'Instagram', account_name: 'b.ig', clip_no: 1, person_key: 'pI', budget: 2000,
        status: 'confirmed', group_key: 'gI', post_url: 'https://www.instagram.com/p/1' }];
    fake.its = [{ id: 1, agency: 'b.ig', status: 'paid', batch_id: 3 }];
    fake.sums['72'] = { Instagram: 2000, TikTok: 3000 };
    // TikTok เรียงก่อน Instagram (กลายเป็น Platform หลัก) และชื่อบัญชีไม่เหมือนกัน
    const r = await call(2, 'PUT', '/projects/72/solo', { ...BASE, platforms: [{ ...TT, account_name: '@aaa', fee: 3000 }, { ...IG, account_name: 'b.ig', fee: undefined }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(fake.sql.some(x => /installments/.test(x.q)), false, 'ไม่ SELECT / UPDATE installments เลย');
    const saved = JSON.parse(setOf(fake.sql.find(x => x.q.startsWith('UPDATE projects'))).ad_groups)[0];
    assert.deepEqual(saved.platforms, ['TikTok', 'Instagram']);
    assert.deepEqual([saved.solo.payee, saved.solo.payee_platform, saved.solo.account_name], ['b.ig', 'Instagram', 'aaa']);
    assert.deepEqual(fake.rows.submissions.map(x => [x.platform, x.account_name, x.budget, x.person_key]), [['TikTok', 'aaa', 3000, 'pI']]);
    assert.match(logged.at(-1).summary, /เพิ่ม TikTok/);
    // เอา IG ออกไม่ได้อยู่แล้ว (ลงงานแล้ว) — ผู้รับเงินจึงไม่มีทางถอยไป TikTok โดยไม่ตั้งใจ
    fake.sql = []; fake.rows = {};
    const rm = await call(2, 'PUT', '/projects/72/solo', { ...BASE, platforms: [{ ...TT, account_name: '@aaa', fee: 3000 }] });
    assert.equal(rm.status, 409);
    assert.deepEqual(writes(), []);
});

test('PUT /:id/fees บน KOL รายคน: แท็บเก่าส่งค่าตัวหลาย Platform ในคำขอเดียว = 400 ให้กด F5 · ทีละ Platform ได้ตามปกติ · แคมเปญปกติไม่เช็ค', async () => {
    subsById[70] = [
        { id: 700, project_id: 70, platform: 'TikTok', account_name: 'a', clip_no: 1, budget: 5000, status: 'confirmed' },
        { id: 701, project_id: 70, platform: 'TikTok', account_name: 'a', clip_no: 2, budget: 5000, status: 'confirmed' },
        { id: 702, project_id: 70, platform: 'Instagram', account_name: 'a.ig', clip_no: 1, budget: 0, status: 'confirmed' }
    ];
    // ช่องค่าตัวช่องเดียวของหน้าเว็บก่อนรอบ 4 — ทุกคลิปเป็นยอดเดียว (ทับ Instagram ที่ได้ฟรี)
    const stale = await call(2, 'PUT', '/projects/70/fees', { items: [700, 701, 702].map(id => ({ sub_id: id, budget: 6000 })), reason: 'manual' });
    assert.equal(stale.status, 400, 'ไม่ใช่ 409 — หน้าเว็บเก่าจะขึ้นข้อความนี้ตรง ๆ');
    assert.equal(stale.body.message, 'ค่าตัวของ KOL รายคนแก้ทีละ Platform — กด F5 แล้วลองใหม่');
    assert.deepEqual([feeCalls.length, syncCalls.length], [0, 0], 'ไม่เขียนอะไร');
    const one = await call(2, 'PUT', '/projects/70/fees', { items: [700, 701].map(id => ({ sub_id: id, budget: 6000, from: 5000 })), reason: 'manual' });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.deepEqual(feeCalls.map(c => c.items.map(i => i.sub_id)), [[700, 701]]);
    assert.deepEqual(syncCalls, [70]);
    subsById[71] = [{ id: 710, project_id: 71, platform: 'TikTok', budget: 1 }, { id: 711, project_id: 71, platform: 'Instagram', budget: 1 }];
    assert.equal((await call(2, 'PUT', '/projects/71/fees', { items: [{ sub_id: 710, budget: 500 }, { sub_id: 711, budget: 500 }], reason: 'divide' })).status, 200);
});

test('เส้นเพิ่มคน / สร้างลิงก์ Agency ใช้กับ KOL รายคนไม่ได้', async () => {
    const add = await call(2, 'POST', '/projects/70/submissions', { account_name: 'b' });
    assert.equal(add.status, 400);
    assert.match(add.body.message, /KOL รายคน/);
    const link = await call(2, 'POST', '/projects/70/agency-links', { name: 'X', groups: ['g1'] });
    assert.equal(link.status, 400);
    assert.match(link.body.message, /KOL รายคน/);
});

test('DELETE แคมเปญ: ลบได้เฉพาะ Admin (ผู้ใช้สั่ง 7 ต.ค. 2026) — สมาชิกทีมเดียวกัน = 403 ไม่ถึงขั้นลบ', async () => {
    const before = removed.length;
    for (const id of [70, 71]) {
        const r = await call(2, 'DELETE', `/projects/${id}`);
        assert.equal(r.status, 403);
        assert.equal(r.body.status, 'error');
    }
    assert.equal(removed.length, before);
    assert.ok(!logged.some(e => e && e.action === 'delete'), 'ไม่มี Activity Log การลบ');
});

test('DELETE KOL รายคน (Admin): มีงานแล้ว (ลงงาน / งวดจ่าย) = 409 ให้ยกเลิกแทน · ยังไม่มีงาน = ลบได้ · แคมเปญปกติไม่เช็ค', async () => {
    subsById[70][0].post_url = 'https://p';
    const r1 = await call(1, 'DELETE', '/projects/70');
    assert.equal(r1.status, 409);
    assert.match(r1.body.message, /ลงงานแล้ว.*ยกเลิก/);
    delete subsById[70][0].post_url;
    itsById[70] = [{ id: 5 }];
    assert.equal((await call(1, 'DELETE', '/projects/70')).status, 409);
    itsById[70] = [];
    assert.equal((await call(1, 'DELETE', '/projects/70')).status, 200);
    assert.deepEqual(removed, [70]);
    assert.equal((await call(1, 'DELETE', '/projects/71')).status, 200);
});

test('หน้าทำจ่าย: ผู้รับเงินของ KOL รายคน = Agency ที่ระบุ หรือบัญชีของ Platform หลัก (ติดต่อเอง) · แคมเปญปกติยังมาจากลิงก์เอเจนซี่', () => {
    const { projectAgencies } = require(path.join(SRC, 'store/pg/payments'));
    const ag = solo.buildSoloGroup(inputOf({ ...MULTI, contact_mode: 'agency', agency: 'Star Model' }), 'g1');
    const soloAg = { campaign_type: 'solo', ad_groups: [ag], agency_links: [{ token: 't', name: 'ห้ามใช้' }] };
    assert.deepEqual(projectAgencies(soloAg, undefined, []), ['Star Model']);
    assert.deepEqual(projectAgencies(soloAg, 'g1', []), ['Star Model']);
    const self = solo.buildSoloGroup(inputOf({ ...MULTI, platforms: [{ ...IG, account_name: 'ig.main' }, { ...TT, platform: 'Lemon8', account_name: 'l8' }] }), 'g2');
    assert.deepEqual(projectAgencies({ campaign_type: 'solo', ad_groups: [self] }, undefined, []), ['ig.main'], 'Platform หลัก = ตัวแรกตามลำดับมาตรฐาน');
    assert.deepEqual(projectAgencies({ campaign_type: 'solo', ad_groups: [] }, undefined, []), []);
    const kol = { campaign_type: 'kol', agency_links: [{ token: 't1', name: 'Agency A', groups: [] }] };
    assert.deepEqual(projectAgencies(kol, undefined, []), ['Agency A']);
});
