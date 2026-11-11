const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// ติดตะกร้า / ไม่ติดตะกร้า (ผู้ใช้สั่ง 11 พ.ย. 2026) — ตั้งต่อชุด Content Type ในฟอร์มแคมเปญ · TikTok อย่างเดียว · บังคับเลือก
// เก็บใน projects.ad_groups (set.cart / allocation.cart = true | false) · หน้า Ads ขึ้นป้ายตาม (Platform + Content Type) ของคลิป
// แท็บที่เปิดค้างก่อนมีช่องนี้ไม่ส่งคีย์ → server ยกค่าเดิม (carryCart) · KOL รายคนมีช่องเดียวกัน
// ทั้งหมดใช้ข้อมูลจำลอง — ฐานข้อมูลของระบบคือ production ห้ามแตะเด็ดขาด
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-cart-tag-test-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
process.env.WEBOOSTX_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in cart-tag test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

// กลุ่มตัวอย่าง: TikTok 2 ชุด (Review ติดตะกร้า · Sale ไม่ติด) + Instagram 1 ชุด
const tiers = [{ tier: 'Micro 10k - 100k', kols: 1 }];
const GROUP = () => ({
    key: 'g1', platform: 'TikTok', platforms: ['TikTok', 'Instagram'],
    blocks: [
        { platform: 'TikTok', products: ['BTA4-01'], sets: [
            { campaign: 'VDO View', content_type: 'Review', media_type: 'VDO', content_format: '', cart: true, tiers },
            { campaign: 'Reach', content_type: 'Sale', media_type: 'VDO', content_format: '', cart: false, tiers }] },
        { platform: 'Instagram', products: ['BTA4-01'], sets: [
            { campaign: 'Reels', content_type: 'Reels', media_type: 'VDO', content_format: '', cart: null, tiers }] }
    ],
    allocations: [
        { platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 1, campaign: 'VDO View', content_type: 'Review', media_type: 'VDO', content_format: null, cart: true },
        { platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 1, campaign: 'Reach', content_type: 'Sale', media_type: 'VDO', content_format: null, cart: false },
        { platform: 'Instagram', tier: 'Micro 10k - 100k', kols: 1, campaign: 'Reels', content_type: 'Reels', media_type: 'VDO', content_format: null, cart: null }
    ]
});

// snapshot จำลองของหน้า Ads — ต้องสลับก่อนโหลด store (pg/ads หยิบ loadSnapshot ไปตอน require)
const SUB = over => ({
    project_id: 91, group_key: 'g1', person_key: null, clip_no: 1, platform: 'TikTok', product: 'BTA4-01', agency: 'A', status: 'confirmed',
    budget: 1000, fee_free: false, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง', views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    post_url: 'https://example.invalid/p', post_date: '2026-11-01', content_type: 'Review', gencode: '#G', id_post: null, code_expire: 60,
    perf_stamp: null, ad_synced_at: null, post_check: null, ...over
});
const FIXTURE = {
    projects: [
        { id: 91, name: 'KOL Nov', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [GROUP()] },
        // แคมเปญที่บันทึกก่อนมีช่องนี้ (ไม่มีคีย์ cart เลย)
        { id: 92, name: 'KOL เก่า', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', ad_groups: [{ key: 'g0', platform: 'TikTok',
            blocks: [{ platform: 'TikTok', sets: [{ content_type: 'Review', tiers }] }],
            allocations: [{ platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 1, content_type: 'Review' }] }] }
    ],
    teams: [{ id: 1, name: 'ทีม' }],
    submissions: [
        SUB({ id: 1, content_type: 'Review' }),                        // ติดตะกร้า
        SUB({ id: 2, content_type: 'Sale' }),                          // ไม่ติด
        SUB({ id: 3, content_type: null }),                            // ไม่มี Content Type = ชุดแรกที่เลือกไว้
        SUB({ id: 4, platform: 'Instagram', content_type: 'Reels' }),  // ไม่ใช่ TikTok
        SUB({ id: 5, project_id: 92, group_key: 'g0' })                // แคมเปญเก่า
    ]
};
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
const pgBase = require(path.join(SRC, 'store/pg/_base'));
pgBase.query = async () => ({ rows: [] });

const logic = require(path.join(SRC, 'store/logic'));
const solo = require(path.join(SRC, 'store/soloKol'));
const { ads } = require(path.join(SRC, 'store/pg/ads'));
const store = require(path.join(SRC, 'store'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web; // client/src/data/adGroups.js (ESM)
let server, base;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    store.users.findById = async () => ({ id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active', brands: [] });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) {
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    // รอ socket ปิดครบ — deploy รันเทสต์แบบ --test-force-exit (บน Windows ปิดค้างแล้วแครช UV_HANDLE_CLOSING)
    for (let i = 0; i < 40 && process._getActiveHandles().some(h => h && h.constructor && h.constructor.name === 'Socket'); i++) {
        await new Promise(r => setTimeout(r, 25));
    }
    await new Promise(r => setTimeout(r, 300));
    await pool.end().catch(() => {});
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------- ตรรกะล้วน (server + หน้าเว็บ)

test('CART_PLATFORMS ฝั่ง server = ฝั่งหน้าเว็บ (TikTok อย่างเดียว)', () => {
    assert.deepEqual(logic.CART_PLATFORMS, ['TikTok']);
    assert.deepEqual(web.CART_PLATFORMS, logic.CART_PLATFORMS);
    assert.deepEqual(['TikTok', 'Instagram', 'Facebook'].map(web.needCart), [true, false, false]);
});

test('resolveGroupCart / cartFor: Content Type ตรงตัว · ไม่รู้ = ชุดแรกที่เลือก · ไม่ใช่ TikTok / แคมเปญเก่า = null · ทั้งสองฝั่งได้ค่าเดียวกัน', () => {
    const g = GROUP();
    const cases = [
        [g, 'TikTok', 'Review', true],
        [g, 'TikTok', 'Sale', false],
        [g, 'TikTok', null, true],
        [g, 'TikTok', 'Branding', null],          // ไม่มีชุดนี้ — ไม่ยืมชุดอื่น
        [g, 'Instagram', 'Reels', null],
        [g, 'Facebook', null, null],
        [FIXTURE.projects[1].ad_groups[0], 'TikTok', 'Review', null],
        [null, 'TikTok', 'Review', null],
        // allocations ข้ามชุดที่ยังไม่มี Tier → อ่านจาก blocks
        [{ ...g, allocations: [] }, 'TikTok', 'Sale', false],
        // กลุ่มรุ่นเก่าที่มีแต่ allocations
        [{ allocations: g.allocations }, 'TikTok', 'Sale', false],
        // สตริง 'true' ไม่นับ
        [{ blocks: [{ platform: 'TikTok', sets: [{ content_type: 'Review', cart: 'true' }] }] }, 'TikTok', 'Review', null]
    ];
    for (const [grp, p, ct, want] of cases) {
        assert.equal(logic.resolveGroupCart(grp, p, ct), want, `server ${p} ${ct}`);
        assert.equal(web.cartFor(grp, p, ct), want, `web ${p} ${ct}`);
    }
});

test('ฟอร์มแคมเปญ: emptySet ยังไม่เลือก · toBlocks เก็บค่าไว้ · flattenBlocks / packCart ส่ง true / false / null (Platform อื่น = null)', () => {
    assert.equal(web.emptySet().cart, null);
    const blocks = web.toBlocks(GROUP());
    assert.deepEqual(blocks.map(b => b.sets.map(s => s.cart)), [[true, false], [null]]);
    // แคมเปญเก่าที่ไม่มีคีย์ = null (ฟอร์มให้เลือกก่อนบันทึก)
    assert.deepEqual(web.toBlocks(FIXTURE.projects[1].ad_groups[0]).map(b => b.sets.map(s => s.cart)), [[null]]);
    // ค่าค้างบน Platform อื่น (เปลี่ยน Platform ของบล็อก) ถูกล้าง
    const dirty = { platform: 'Instagram', sets: [{ content_type: 'Reels', cart: true, tiers }] };
    assert.deepEqual(web.packCart(dirty).sets.map(s => s.cart), [null]);
    assert.deepEqual(web.packCart({ platform: 'TikTok', sets: [{ cart: 'true' }, { cart: false }, {}] }).sets.map(s => s.cart), [null, false, null]);
    assert.deepEqual(web.flattenBlocks([dirty, ...blocks]).map(a => [a.platform, a.content_type, a.cart]),
        [['Instagram', 'Reels', null], ['TikTok', 'Review', true], ['TikTok', 'Sale', false], ['Instagram', 'Reels', null]]);
    // ตัวตรวจ: TikTok ต้องเลือก · Platform อื่นผ่านเสมอ · ร่างที่บันทึกก่อนมีช่องนี้ (undefined) = ยังไม่เลือก
    assert.deepEqual([web.setCartOk('TikTok', { cart: true }), web.setCartOk('TikTok', { cart: false }), web.setCartOk('TikTok', {}),
        web.setCartOk('TikTok', { cart: null }), web.setCartOk('Instagram', {})], [true, true, false, false, true]);
});

test('ฟอร์ม: ชุดที่หน้าอื่นแยกไม่ออก (Content Type ซ้ำ / กลุ่มไม่ใช้ Gencode) เลือกตะกร้าพร้อมกัน · เลือกต่างกัน = ตัวตรวจไม่ให้บันทึก', () => {
    const g = { key: 'g', no_gencode: false };
    const b = { platform: 'TikTok', sets: [
        { content_type: 'Review', campaign: 'VDO View', cart: null }, { content_type: 'Review', campaign: 'Reach', cart: null },
        { content_type: 'Sale', cart: null }] };
    // เลือกที่ชุดแรก → ชุด Review อีกชุดได้ค่าเดียวกัน · Sale ไม่โดน
    let nb = web.withSetCart(g, b, 0, true);
    assert.deepEqual(nb.sets.map(s => s.cart), [true, true, null]);
    nb = web.withSetCart(g, nb, 2, false);
    assert.deepEqual(nb.sets.map(s => s.cart), [true, true, false]);
    assert.deepEqual(web.cartConflicts(g, nb), []);
    // เปลี่ยน Content Type ของ Sale เป็น Review ทีหลัง → ค่าขัดกัน
    const clash = { ...nb, sets: nb.sets.map((s, j) => (j === 2 ? { ...s, content_type: 'Review' } : s)) };
    assert.deepEqual(web.cartConflicts(g, clash), ['Review']);
    // กลุ่มไม่ใช้ Gencode: ทุกชุดเป็นกล่องเดียว
    const ng = { key: 'n', no_gencode: true };
    assert.deepEqual(web.withSetCart(ng, b, 1, false).sets.map(s => s.cart), [false, false, false]);
    assert.deepEqual(web.cartConflicts(ng, nb), [''], 'ค่าเดิมต่างกันในกลุ่มไม่ใช้ Gencode = ขัดกัน');
    // Platform อื่นไม่ตรวจ
    assert.deepEqual(web.cartConflicts(g, { ...clash, platform: 'Instagram' }), []);
});

test('carryCart: แท็บเก่าที่ไม่ส่งคีย์ = ยกค่าเดิม (กลุ่ม → Platform → Content Type) · ฟอร์มใหม่ใช้ค่าที่ส่ง · Platform อื่นไม่เก็บ', () => {
    const stored = [GROUP()];
    const strip = g => ({
        ...g,
        blocks: g.blocks.map(b => ({ ...b, sets: b.sets.map(({ cart, ...s }) => s) })),
        allocations: g.allocations.map(({ cart, ...a }) => a)
    });
    // แท็บเก่า: ไม่มีคีย์ cart เลย
    const [old] = logic.carryCart([strip(GROUP())], stored);
    assert.deepEqual(old.blocks[0].sets.map(s => s.cart), [true, false]);
    assert.deepEqual(old.allocations.map(a => a.cart), [true, false, undefined]);
    assert.equal('cart' in old.blocks[1].sets[0], false, 'Instagram ไม่มีคีย์ cart');
    // แท็บเก่าสลับ Content Type ของชุด → ยกตามชื่อ Content Type
    const swapped = strip(GROUP());
    swapped.blocks[0].sets[0].content_type = 'Sale';
    assert.equal(logic.carryCart([swapped], stored)[0].blocks[0].sets[0].cart, false);
    // กลุ่มใหม่ (key ไม่มีในฐาน) = null
    assert.equal(logic.carryCart([{ ...strip(GROUP()), key: 'g9' }], stored)[0].blocks[0].sets[0].cart, null);
    // ฟอร์มใหม่: ค่าที่ส่งชนะเสมอ (รวม null = ผู้ใช้ยังไม่เลือก) · สตริงไม่นับ · ค่าค้างบน Instagram ถูกตัด
    const fresh = GROUP();
    fresh.blocks[0].sets[0].cart = false;
    fresh.blocks[0].sets[1].cart = 'true';
    fresh.blocks[1].sets[0].cart = true;
    const [n] = logic.carryCart([fresh], stored);
    assert.deepEqual(n.blocks[0].sets.map(s => s.cart), [false, null]);
    assert.equal('cart' in n.blocks[1].sets[0], false);
    assert.equal('cart' in n.allocations[2], false);
    // กลุ่มที่ไม่มี blocks / allocations ไม่พัง และไม่เพิ่มคีย์
    assert.deepEqual(logic.carryCart([{ key: 'x', name: 'n' }], stored), [{ key: 'x', name: 'n' }]);
    assert.equal(logic.carryCart(null, stored), null);
});

test('ads.list: แถวมี cart ตาม (Platform + Content Type) ของคลิป · ไม่ใช่ TikTok / แคมเปญเก่า = null', async () => {
    const { rows } = await ads.list({});
    const by = Object.fromEntries(rows.map(r => [r.sub_id, r.cart]));
    assert.deepEqual(by, { 1: true, 2: false, 3: true, 4: null, 5: null });
});

// ---------------------------------------------------------------- เส้นบันทึกแคมเปญ (store จำลอง)

test('PUT /api/projects/:id: แท็บเก่าไม่ทำค่าตะกร้าหาย · ฟอร์มใหม่เปลี่ยนได้ · POST จัดค่าให้ตรงตัว', async () => {
    const U = '2026-11-11T01:00:00.000Z';
    let project = { id: 80, name: 'แคมเปญ', brand: 'Beauterry', team_id: 1, campaign_type: 'kol', status: 'Active', updated_at: U, ad_groups: [GROUP()] };
    const updates = [];
    store.projects.findByIdFull = async id => (String(id) === '80' ? structuredClone(project) : null);
    store.projects.update = async (id, fields) => {
        updates.push(structuredClone(fields));
        project = { ...project, ...fields };
        return structuredClone(project);
    };
    const created = [];
    store.projects.create = async fields => { created.push(structuredClone(fields)); return { id: 81, ...structuredClone(fields) }; };
    store.activity.log = async () => {};
    const call = (method, url, body) => fetch(`${base}/api${url}`, {
        method, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const oldForm = () => project.ad_groups.map(g => ({
        ...g, blocks: g.blocks.map(b => ({ ...b, sets: b.sets.map(({ cart, ...s }) => s) })), allocations: g.allocations.map(({ cart, ...a }) => a)
    }));

    let res = await call('PUT', '/projects/80', { name: 'แคมเปญ', ad_groups: oldForm() });
    assert.equal(res.status, 200);
    let saved = updates.at(-1).ad_groups[0];
    assert.deepEqual(saved.blocks[0].sets.map(s => s.cart), [true, false], 'แท็บเก่าบันทึกแล้วค่าตะกร้าไม่หาย');
    assert.deepEqual(saved.allocations.slice(0, 2).map(a => a.cart), [true, false]);

    // ฟอร์มใหม่สลับค่า
    const next = structuredClone(project.ad_groups);
    next[0].blocks[0].sets[0].cart = false;
    next[0].allocations[0].cart = false;
    res = await call('PUT', '/projects/80', { name: 'แคมเปญ', ad_groups: next });
    assert.equal(res.status, 200);
    saved = updates.at(-1).ad_groups[0];
    assert.equal(saved.blocks[0].sets[0].cart, false);
    assert.equal(logic.resolveGroupCart(saved, 'TikTok', 'Review'), false);

    // เปลี่ยนสถานะอย่างเดียว ไม่แตะกลุ่ม
    res = await call('PUT', '/projects/80', { status: 'Completed' });
    assert.equal(res.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(updates.at(-1), 'ad_groups'), false);

    // สร้างใหม่: ค่าค้างบน Instagram ถูกตัด · สตริงไม่นับ
    const g = GROUP();
    g.blocks[0].sets[1].cart = 'false';
    g.blocks[1].sets[0].cart = true;
    res = await call('POST', '/projects', { name: 'ใหม่', brand: 'Beauterry', ad_groups: [g] });
    assert.equal(res.status, 201, await res.text());
    const cg = created.at(-1).ad_groups[0];
    assert.deepEqual(cg.blocks[0].sets.map(s => s.cart), [true, null]);
    assert.equal('cart' in cg.blocks[1].sets[0], false);
});

// ---------------------------------------------------------------- KOL รายคน

const TT = {
    platform: 'TikTok', account_name: '@cart_kol', followers: 5000, tier: 'Nano 1k - 10k', fee: 1000,
    content_type: 'Review', campaign: 'VDO View', media_type: 'VDO', content_format: '', target: []
};
const IG = { platform: 'Instagram', account_name: 'cart.ig', followers: 5000, tier: 'Nano 1k - 10k', fee: 0, content_type: 'Reels' };
const SOLO = { contact_mode: 'self', brand: 'Beauterry', products: ['BTA4-01'], clips: 1, owner: 'แพรว', code_expire: 60 };

test('KOL รายคน soloInput: TikTok บังคับเลือกตอนเพิ่ม (ขึ้นต้น "TikTok:") · ค่าแปลกไม่รับ · แก้ไขไม่ส่ง = null · Platform อื่นไม่มีคีย์', () => {
    const miss = solo.soloInput({ ...SOLO, platforms: [TT] });
    assert.match(miss.error, /^TikTok: เลือก ติดตะกร้า \/ ไม่ติดตะกร้า/);
    assert.match(solo.soloInput({ ...SOLO, platforms: [{ ...TT, cart: 'yes' }] }).error, /^TikTok: ตะกร้าไม่ถูกต้อง/);
    const ok = solo.soloInput({ ...SOLO, platforms: [{ ...TT, cart: false }, { ...IG, cart: true }] });
    assert.equal(ok.error, undefined, ok.error);
    assert.deepEqual(ok.input.platforms.map(p => ['cart' in p, p.cart]), [[true, false], [false, undefined]]);
    const edit = solo.soloInput({ ...SOLO, platforms: [TT] }, { editing: true });
    assert.equal(edit.error, undefined, edit.error);
    assert.equal(edit.input.platforms[0].cart, null);
});

test('KOL รายคน buildSoloGroup: ชุด + allocation ของ TikTok มี cart · แก้ไขจากแท็บเก่า (ไม่ส่ง) = ค่าเดิม · หน้า Ads อ่านได้', () => {
    const i = solo.soloInput({ ...SOLO, platforms: [{ ...TT, cart: true }, IG] }).input;
    const g = solo.buildSoloGroup(i, 'g1');
    assert.deepEqual(g.blocks.map(b => b.sets[0].cart), [true, undefined]);
    assert.deepEqual(g.allocations.map(a => a.cart), [true, undefined]);
    assert.equal(logic.resolveGroupCart(g, 'TikTok', 'Review'), true);
    assert.equal(web.cartFor(g, 'TikTok', 'Review'), true);
    assert.equal(logic.resolveGroupCart(g, 'Instagram', 'Reels'), null);
    // แก้ไข: ไม่ส่ง cart (แท็บเก่า) → ยกจากกลุ่มเดิม · ส่ง false → เปลี่ยน
    const e1 = solo.soloInput({ ...SOLO, platforms: [TT, IG] }, { editing: true }).input;
    assert.equal(solo.buildSoloGroup(e1, 'g1', g).blocks[0].sets[0].cart, true);
    const e2 = solo.soloInput({ ...SOLO, platforms: [{ ...TT, cart: false }, IG] }, { editing: true }).input;
    assert.equal(solo.buildSoloGroup(e2, 'g1', g).allocations[0].cart, false);
    // การจ้างเก่าที่ไม่มีค่าเลย = null
    assert.equal(solo.buildSoloGroup(e1, 'g1', { blocks: [{ platform: 'TikTok', sets: [{}] }] }).blocks[0].sets[0].cart, null);
});
