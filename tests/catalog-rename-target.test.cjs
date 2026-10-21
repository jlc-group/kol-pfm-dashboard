const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

// แก้ไขชื่อ Target ในหน้า Products & Targets (ผู้ใช้สั่ง 21 ต.ค. 2026) — แคมเปญเดิมที่ใช้ชื่อเดิมเปลี่ยนตามด้วย ("เปลี่ยนตามด้วย")
// ตรรกะล้วน + store (transaction จำลอง) + เส้น API + คลังฝั่งหน้าเว็บ · ไม่แตะฐานจริง
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-catalog-rename-'));
process.env.BEAUTERRY_PFM_SYNC_ENABLED = 'false';
const SRC = path.join(__dirname, '../server/src');

const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in catalog-rename test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();

const base = require(path.join(SRC, 'store/pg/_base'));
let onQuery = async () => ({ rows: [], rowCount: 0 });
const SQL = [];
base.query = async (text, params) => { SQL.push({ text: String(text), params }); return onQuery(String(text), params); };
base.withTransaction = async fn => fn({ query: async (text, params) => { SQL.push({ text: String(text), params, tx: true }); return onQuery(String(text), params); } });

const store = require(path.join(SRC, 'store'));
const { catalog } = require(path.join(SRC, 'store/pg/catalog'));
const REAL = { renameTarget: catalog.renameTarget, targetUsage: catalog.targetUsage };
const { renameTargetInGroups, usesTarget, previewRename } = require(path.join(SRC, 'store/targetRename'));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SRC] }));
const app = require(path.join(SRC, 'app'));

let web;
before(async () => { web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/products.js')).href); });
after(() => {
    if (web) web.applyCatalogOverlay({ products: [], targets: [] });
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    return pool.end().catch(() => {});
});
beforeEach(() => { SQL.length = 0; onQuery = async () => ({ rows: [], rowCount: 0 }); });

const OLD = 'MF_SUN_MASS_18_54', NEW = 'MF_SUN_MASS_18_55';
// แคมเปญ: TikTok มี L3 + L10 ใช้ชื่อเดิมทั้งคู่ · Instagram ไม่มี product_targets (แบบเก่า) · กลุ่มมี target รวม
const camp = () => ([{
    key: 'g1', products: ['L3', 'L10'], target: [OLD, 'F_SUN_MASS_18_54'], concept: 'x',
    blocks: [
        { platform: 'TikTok', products: ['L3', 'L10'], target: [OLD, 'F_SUN_MASS_18_54'], budget: 1000,
            product_targets: { L3: [OLD, 'F_SUN_MASS_18_54'], L10: [OLD] }, sets: [{ content_type: 'Review', tiers: [{ tier: 'Nano 1k - 10k', kols: 5 }] }] },
        { platform: 'Instagram', products: ['L3'], target: [OLD], budget: 500, sets: [] }
    ],
    allocations: [{ platform: 'TikTok', tier: 'Nano 1k - 10k', kols: 5 }]
}]);

// ---------------------------------------------------------------- ตรรกะล้วน
test('แก้ทุกสินค้า: ต่อสินค้า + รวมทั้ง Platform + ระดับกลุ่ม เปลี่ยนหมด · ช่องอื่นไม่แตะ · ไม่แก้ของเดิม (คืนก้อนใหม่)', () => {
    const g = camp();
    const before = JSON.stringify(g);
    const r = renameTargetInGroups(g, ['L3', 'L10'], OLD, NEW);
    assert.equal(r.changed, true);
    const [tt, ig] = r.groups[0].blocks;
    assert.deepEqual(tt.product_targets, { L3: [NEW, 'F_SUN_MASS_18_54'], L10: [NEW] });
    assert.deepEqual(tt.target, [NEW, 'F_SUN_MASS_18_54']);
    assert.deepEqual(ig.target, [NEW], 'บล็อกแบบเก่า (ไม่มี product_targets) ที่มีสินค้าที่เลือก = แก้ด้วย');
    assert.deepEqual(r.groups[0].target, [NEW, 'F_SUN_MASS_18_54']);
    assert.equal(JSON.stringify(g), before, 'ไม่แก้ก้อนเดิม');
    // ช่องอื่นเหมือนเดิมทุกตัวอักษร
    const strip = x => JSON.parse(JSON.stringify(x).split(NEW).join(OLD));
    assert.deepEqual(strip(r.groups), camp());
});

test('แก้แค่บางสินค้า: สินค้าอื่นที่ยังใช้ชื่อเดิมคงไว้ · รายการรวมมีทั้งชื่อเดิม + ชื่อใหม่', () => {
    const r = renameTargetInGroups(camp(), ['L3'], OLD, NEW);
    const tt = r.groups[0].blocks[0];
    assert.deepEqual(tt.product_targets, { L3: [NEW, 'F_SUN_MASS_18_54'], L10: [OLD] });
    assert.deepEqual(tt.target, [OLD, 'F_SUN_MASS_18_54', NEW]);
    assert.deepEqual(r.groups[0].blocks[1].target, [NEW], 'บล็อก IG มีแต่ L3');
    assert.deepEqual(r.groups[0].target, [OLD, 'F_SUN_MASS_18_54', NEW], 'ระดับกลุ่ม: L10 ยังใช้ชื่อเดิม');
    // แก้ L10 ทีหลัง → ชื่อเดิมหายจากทุกชั้น ไม่ซ้ำ
    const r2 = renameTargetInGroups(r.groups, ['L10'], OLD, NEW);
    assert.deepEqual(r2.groups[0].blocks[0].target, [NEW, 'F_SUN_MASS_18_54'], 'ชื่อใหม่แทนที่ตำแหน่งชื่อเดิม ไม่ซ้ำ');
    assert.deepEqual(r2.groups[0].target, [NEW, 'F_SUN_MASS_18_54']);
});

test('ชื่อใหม่มีอยู่แล้ว = รวมเป็นอันเดียว · เทียบตัดช่องว่าง · แก้ตัวพิมพ์อย่างเดียวได้', () => {
    const g = [{ key: 'g', blocks: [{ platform: 'TikTok', products: ['L3'], target: [OLD, NEW], product_targets: { L3: [' ' + OLD + ' ', NEW] } }] }];
    const r = renameTargetInGroups(g, ['L3'], OLD, NEW);
    assert.deepEqual(r.groups[0].blocks[0].product_targets.L3, [NEW]);
    assert.deepEqual(r.groups[0].blocks[0].target, [NEW]);
    const low = 'mf_x', up = 'MF_X';
    const r2 = renameTargetInGroups([{ blocks: [{ products: ['C1'], target: [low], product_targets: { C1: [low] } }] }], ['C1'], low, up);
    assert.deepEqual(r2.groups[0].blocks[0].product_targets.C1, [up]);
    assert.deepEqual(r2.groups[0].blocks[0].target, [up]);
});

test('ไม่เกี่ยว = ไม่เปลี่ยน (คืนก้อนเดิม) · สินค้าอื่น / ชื่ออื่น / ข้อมูลแปลก ไม่พัง', () => {
    const g = camp();
    for (const [codes, from] of [[['C1'], OLD], [['L3'], 'NOPE'], [[], OLD]]) {
        const r = renameTargetInGroups(g, codes, from, NEW);
        assert.equal(r.changed, false);
        assert.equal(r.groups, g);
    }
    for (const weird of [null, undefined, 'x', [null, 1, 'str'], [{ blocks: 'x' }], [{ blocks: [null, { product_targets: [] }] }]]) {
        assert.equal(renameTargetInGroups(weird, ['L3'], OLD, NEW).changed, false);
    }
    assert.equal(renameTargetInGroups(g, ['L3'], OLD, OLD).changed, false, 'ชื่อเดียวกัน');
});

test('ข้อมูลเก่า: Target เป็นสตริงเดี่ยว · กลุ่มที่ไม่มี blocks ใช้ products ของกลุ่ม · KOL รายคน (ทุกสินค้าใช้ชุดเดียวกัน)', () => {
    const r = renameTargetInGroups([{ products: ['L3'], target: OLD }], ['L3'], OLD, NEW);
    assert.equal(r.groups[0].target, NEW);
    const r2 = renameTargetInGroups([{ blocks: [{ products: ['L3'], target: OLD, product_targets: { L3: OLD } }] }], ['L3'], OLD, NEW);
    assert.equal(r2.groups[0].blocks[0].product_targets.L3, NEW);
    assert.equal(r2.groups[0].blocks[0].target, NEW);
    const solo = [{ key: 's', target: [OLD], products: ['L3', 'L10'], solo: { payee: 'x' },
        blocks: [{ platform: 'TikTok', products: ['L3', 'L10'], target: [OLD], product_targets: { L3: [OLD], L10: [OLD] } }] }];
    const r3 = renameTargetInGroups(solo, ['L3', 'L10'], OLD, NEW);
    assert.deepEqual(r3.groups[0].target, [NEW]);
    assert.deepEqual(r3.groups[0].blocks[0].target, [NEW]);
    assert.deepEqual(r3.groups[0].solo, { payee: 'x' });
});

test('บล็อก/กลุ่มแบบเก่า (ไม่มี product_targets) เลือกไม่ครบ: คงชื่อเดิม + เติมชื่อใหม่ · keep บอกว่าสินค้าไหนยังใช้ชื่อเดิม', () => {
    const legacyBlock = () => [{ key: 'g', blocks: [{ platform: 'TikTok', products: ['L3', 'L10', 'X1'], target: [OLD, 'T_X1'] }] }];
    // ไม่ส่ง keep = ถือว่าสินค้าที่ไม่ได้เลือกยังใช้ชื่อเดิม (L10 / X1 ไม่เสีย Target ตอนฟอร์มแบ่งให้แต่ละสินค้า)
    let r = renameTargetInGroups(legacyBlock(), ['L3'], OLD, NEW);
    assert.deepEqual(r.groups[0].blocks[0].target, [OLD, 'T_X1', NEW]);
    assert.equal(r.places, 1);
    // keep มี L10 = ยังมีคนใช้ → คงไว้
    r = renameTargetInGroups(legacyBlock(), ['L3'], OLD, NEW, { keep: ['L10', 'C1'] });
    assert.deepEqual(r.groups[0].blocks[0].target, [OLD, 'T_X1', NEW]);
    // keep ไม่มีสินค้าในบล็อก (L10 / X1 ไม่มีชื่อเดิมในคลัง) → เปลี่ยนทั้งก้อน
    r = renameTargetInGroups(legacyBlock(), ['L3'], OLD, NEW, { keep: ['C1'] });
    assert.deepEqual(r.groups[0].blocks[0].target, [NEW, 'T_X1']);
    // keep เทียบรหัสไม่สนตัวพิมพ์ · เลือกครบทุกตัวที่ใช้ → เปลี่ยนทั้งก้อน
    r = renameTargetInGroups(legacyBlock(), ['L3'], OLD, NEW, { keep: ['l10'] });
    assert.deepEqual(r.groups[0].blocks[0].target, [OLD, 'T_X1', NEW]);
    r = renameTargetInGroups(legacyBlock(), ['L3', 'L10'], OLD, NEW, { keep: [] });
    assert.deepEqual(r.groups[0].blocks[0].target, [NEW, 'T_X1']);
    // บล็อกไม่มีรายการสินค้า = ใช้ของกลุ่ม · ไม่มีสินค้าที่เลือก = ไม่แตะ
    r = renameTargetInGroups([{ products: ['L3'], blocks: [{ platform: 'TikTok', target: [OLD] }] }], ['L3'], OLD, NEW);
    assert.deepEqual(r.groups[0].blocks[0].target, [NEW]);
    assert.equal(renameTargetInGroups([{ products: ['C1'], blocks: [{ platform: 'TikTok', target: [OLD] }] }], ['L3'], OLD, NEW).changed, false);
    // กลุ่มที่ไม่มี blocks · Target สตริงเดี่ยว + เลือกไม่ครบ = กลายเป็นรายการ 2 ชื่อ
    r = renameTargetInGroups([{ products: ['L3', 'L10'], target: OLD }], ['L3'], OLD, NEW);
    assert.deepEqual(r.groups[0].target, [OLD, NEW]);
    r = renameTargetInGroups([{ products: ['L3', 'L10'], target: OLD }], ['L3'], OLD, NEW, { keep: [] });
    assert.equal(r.groups[0].target, NEW);
    // ระดับกลุ่มเหนือบล็อกแบบเก่าที่ยังมีชื่อเดิม = คงไว้ + เติม
    r = renameTargetInGroups([{ target: [OLD], products: ['L3', 'L10'], blocks: [{ platform: 'TikTok', products: ['L3', 'L10'], target: [OLD] }] }], ['L3'], OLD, NEW);
    assert.deepEqual(r.groups[0].target, [OLD, NEW]);
    assert.deepEqual(r.groups[0].blocks[0].target, [OLD, NEW]);
});

test('ชุดสินค้า: เลือกสินค้าในชุด 1 ตัว = เปลี่ยนทั้งชุด (Target ชุดเดียวกัน) · บอกรหัสที่โดนเพราะอยู่ในชุด', () => {
    const g = () => [{ key: 'g', blocks: [{ platform: 'TikTok', products: ['L8A', 'L8B', 'L3'], bundles: [['L8A', 'L8B']],
        target: [OLD], product_targets: { L8A: [OLD], L8B: [OLD], L3: [OLD] } }] }];
    const r = renameTargetInGroups(g(), ['L8A'], OLD, NEW);
    assert.deepEqual(r.groups[0].blocks[0].product_targets, { L8A: [NEW], L8B: [NEW], L3: [OLD] });
    assert.deepEqual(r.groups[0].blocks[0].target, [OLD, NEW]);
    assert.deepEqual(r.bundled, ['L8B']);
    assert.deepEqual(previewRename(g(), ['L8A'], OLD), { changed: true, bundled: ['L8B'] });
    assert.deepEqual(previewRename(g(), ['L8A', 'L8B'], OLD), { changed: true, bundled: [] }, 'เลือกครบชุดเอง = ไม่ต้องบอก');
    assert.deepEqual(previewRename(g(), ['L3'], OLD), { changed: true, bundled: [] }, 'สินค้าเดี่ยวไม่ลากชุด');
    // ชุดที่สินค้าไม่อยู่ในบล็อกแล้ว / มีตัวเดียว = ไม่ใช่ชุด
    const odd = [{ blocks: [{ products: ['L8A', 'L3'], bundles: [['L8A', 'L8B'], 'x'], target: [OLD], product_targets: { L8A: [OLD], L8B: [OLD], L3: [OLD] } }] }];
    assert.deepEqual(renameTargetInGroups(odd, ['L8A'], OLD, NEW).groups[0].blocks[0].product_targets, { L8A: [NEW], L8B: [OLD], L3: [OLD] });
});

test('ชื่อใหม่มีอยู่แล้วแต่ตัวพิมพ์ต่าง = ใช้ตัวสะกดที่มีอยู่ ไม่ให้มีทั้งสองแบบ', () => {
    const g = [{ target: [OLD, 'F_SUN_MASS_18_54'], products: ['L3'],
        blocks: [{ products: ['L3'], target: [OLD, 'F_SUN_MASS_18_54'], product_targets: { L3: [OLD, 'F_SUN_MASS_18_54'] } }] }];
    const r = renameTargetInGroups(g, ['L3'], OLD, 'f_sun_mass_18_54');
    assert.deepEqual(r.groups[0].blocks[0].product_targets.L3, ['F_SUN_MASS_18_54']);
    assert.deepEqual(r.groups[0].blocks[0].target, ['F_SUN_MASS_18_54']);
    assert.deepEqual(r.groups[0].target, ['F_SUN_MASS_18_54']);
});

test('usesTarget = กติกาเดียวกับตอนแก้จริง (นับแคมเปญก่อนบันทึก)', () => {
    assert.equal(usesTarget(camp(), ['L10'], OLD), true);
    assert.equal(usesTarget(camp(), ['C1'], OLD), false);
    assert.equal(usesTarget(camp(), ['L3'], 'F_SUN_MASS_18_54'), true);
    assert.equal(usesTarget(null, ['L3'], OLD), false);
});

// ---------------------------------------------------------------- store (transaction จำลอง)
test('store.renameTarget: ชื่อใหม่ = ซ่อนชื่อเดิม + เพิ่มชื่อใหม่ · แก้แคมเปญที่ใช้ (ล็อกก่อนเขียน) ใน transaction เดียว', async () => {
    const projects = [{ id: 7, name: 'แคมเปญ A', brand: "Jula's Herb", team_id: 2, ad_groups: camp() },
        { id: 9, name: 'แคมเปญไม่เกี่ยว', brand: 'Jernis', team_id: 1, ad_groups: [{ blocks: [{ products: ['JNP1'], target: ['F_X'], product_targets: { JNP1: ['F_X'] } }] }] }];
    const written = [];
    onQuery = async (text, params) => {
        if (/^SELECT id, ad_groups FROM projects/.test(text)) return { rows: projects.map(p => ({ id: p.id, ad_groups: p.ad_groups })) };
        if (/FROM projects WHERE id = \$1 FOR UPDATE/.test(text)) return { rows: projects.filter(p => p.id === params[0]) };
        if (/^UPDATE projects SET ad_groups/.test(text)) { written.push({ id: params[2], groups: JSON.parse(params[0]), by: params[1] }); return { rows: [], rowCount: 1 }; }
        if (/INSERT INTO catalog_targets/.test(text)) return { rows: [{ product_code: params[0], target: params[1], hidden: params[2] }] };
        return { rows: [] };
    };
    const out = await REAL.renameTarget.call(catalog, ['L3', 'L10'], OLD, NEW, { byId: 1, byName: 'แอดมิน', keep: ['C1'] });
    assert.deepEqual(out.campaigns.map(c => [c.id, c.name, c.places]), [[7, 'แคมเปญ A', 3]]);
    assert.ok(SQL.every(s => s.tx), 'ทุกคำสั่งอยู่ใน transaction');
    const cat = SQL.filter(s => /INSERT INTO catalog_targets/.test(s.text)).map(s => [s.params[0], s.params[1], s.params[2]]);
    assert.deepEqual(cat, [['L3', OLD, true], ['L3', NEW, false], ['L10', OLD, true], ['L10', NEW, false]]);
    const lockAt = SQL.findIndex(s => /FOR UPDATE/.test(s.text)), writeAt = SQL.findIndex(s => /^UPDATE projects/.test(s.text));
    assert.ok(lockAt >= 0 && lockAt < writeAt, 'ล็อกแคมเปญก่อนเขียน');
    assert.equal(written.length, 1);
    assert.equal(written[0].id, 7);
    assert.equal(written[0].by, 1);
    assert.deepEqual(written[0].groups[0].blocks[0].product_targets, { L3: [NEW, 'F_SUN_MASS_18_54'], L10: [NEW] });
    assert.ok(!SQL.some(s => /UPDATE projects/.test(s.text) && s.params && s.params[2] === 9), 'แคมเปญที่ไม่เกี่ยวไม่ถูกเขียน');
});

test('store.renameTarget: แก้แค่ตัวพิมพ์ = แก้ตัวสะกดแถวเดิม (ไม่ซ่อน) · ยังไม่ setup-db = 503', async () => {
    onQuery = async () => ({ rows: [] });
    await REAL.renameTarget.call(catalog, ['C1'], 'mf_acne_13-34', 'MF_ACNE_13-34', { byId: 1, byName: 'a' });
    const ins = SQL.filter(s => /INSERT INTO catalog_targets/.test(s.text));
    assert.equal(ins.length, 1);
    assert.match(ins[0].text, /DO UPDATE SET target = EXCLUDED\.target, hidden = false/);
    assert.deepEqual(ins[0].params.slice(0, 2), ['C1', 'MF_ACNE_13-34']);
    onQuery = async () => { const e = new Error('no table'); e.code = '42P01'; throw e; };
    await assert.rejects(REAL.renameTarget.call(catalog, ['C1'], 'A', 'B', {}), e => e.status === 503 && /setup-db/.test(e.message));
});

test('store.targetUsage: อ่านอย่างเดียว คืนเฉพาะแคมเปญที่ใช้ชื่อนี้กับสินค้าที่เลือก', async () => {
    onQuery = async () => ({ rows: [{ id: 7, name: 'A', brand: "Jula's Herb", ad_groups: camp() }, { id: 8, name: 'B', brand: 'x', ad_groups: [] }] });
    assert.deepEqual(await REAL.targetUsage.call(catalog, ['L10'], OLD), { campaigns: [{ id: 7, name: 'A', brand: "Jula's Herb" }], bundled: [] });
    assert.ok(SQL.every(s => /^SELECT/.test(s.text) && !s.tx));
});

// ---------------------------------------------------------------- คลังฝั่งหน้าเว็บ
test('คลังหน้าเว็บ: แถวที่ตรงกับ Target ตั้งต้น (ไม่สนตัวพิมพ์) ใช้ตัวสะกดที่แก้ล่าสุด · แถวซ่อนใช้แค่ธงซ่อน', () => {
    const base0 = web.targetsForProduct('L3');
    assert.ok(base0.includes(OLD), 'L3 มี ' + OLD + ' ในรายการตั้งต้น');
    const low = OLD.toLowerCase();
    web.applyCatalogOverlay({ products: [], targets: [{ product_code: 'L3', target: low, hidden: false }] });
    assert.ok(web.targetsForProduct('L3').includes(low));
    assert.ok(!web.targetsForProduct('L3').includes(OLD));
    assert.equal(web.targetsForProduct('L3').length, base0.length, 'ไม่เพิ่มแถวซ้ำ');
    web.applyCatalogOverlay({ products: [], targets: [{ product_code: 'L3', target: low, hidden: true }] });
    const e = web.targetEntriesOf('L3').find(x => x.target.toLowerCase() === low);
    assert.deepEqual([e.target, e.hidden], [OLD, true], 'ซ่อน = ตัวสะกดตั้งต้น (แบบเดิมของหน้า Products & Targets)');
    web.applyCatalogOverlay({ products: [], targets: [] });
    assert.deepEqual(web.targetsForProduct('L3'), base0);
});

// ---------------------------------------------------------------- เส้น API
const ACCOUNTS = {
    1: { id: 1, username: 'admin1', full_name: 'Admin', nickname: 'แอดมิน', role: 'admin', status: 'active', is_active: true, team_id: 1, brands: [] },
    2: { id: 2, username: 'member1', full_name: 'Member', role: 'member', status: 'active', is_active: true, team_id: 1, brands: ["Jula's Herb"] },
    3: { id: 3, username: 'agency1', full_name: 'Agency', role: 'agency', status: 'active', is_active: true, team_id: null, brands: [], agency_tokens: ['tk'] }
};
store.users.findById = async id => (ACCOUNTS[Number(id)] ? { ...ACCOUNTS[Number(id)] } : null);
const LOG = [];
store.activity.log = async e => { LOG.push(e); return e; };
const CALLS = [];
store.catalog.overlay = async () => ({ ready: true, products: [], targets: [{ product_code: 'L3', target: NEW, hidden: false }] });
store.catalog.renameTarget = async (...a) => { CALLS.push(['renameTarget', ...a]); return { campaigns: [{ id: 7, name: 'แคมเปญ A', brand: "Jula's Herb", team_id: 2, places: 3 }] }; };
store.catalog.targetUsage = async (...a) => { CALLS.push(['targetUsage', ...a]); return { campaigns: [{ id: 7, name: 'แคมเปญ A', brand: "Jula's Herb" }], bundled: ['L8B'] }; };

let server, baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = 'http://127.0.0.1:' + server.address().port; });
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    // รอซ็อกเก็ตปิดจริง — กัน --test-force-exit (build.cjs) บน Windows แครช libuv
    const until = Date.now() + 3000;
    while (process.getActiveResourcesInfo().includes('TCPSocketWrap') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 300));
});
const call = async (uid, method, url, body) => {
    const token = jwt.sign({ id: uid, username: ACCOUNTS[uid].username, role: ACCOUNTS[uid].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(baseUrl + '/api/catalog' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
};
const reset = () => { CALLS.length = 0; LOG.length = 0; };

test('POST /targets/rename: แก้ได้เฉพาะ admin · ตรวจชื่อ / รหัส · บันทึกประวัติคลัง + ประวัติของแต่ละแคมเปญที่โดน', async () => {
    reset();
    for (const uid of [2, 3]) assert.equal((await call(uid, 'POST', '/targets/rename', { from: OLD, to: NEW, codes: ['L3'] })).status, 403);
    assert.deepEqual(CALLS, []);
    const ok = await call(1, 'POST', '/targets/rename', { from: ' ' + OLD + ' ', to: ' ' + NEW + ' ', codes: ['l3', 'L10', 'L3'] });
    assert.equal(ok.status, 200);
    assert.deepEqual(CALLS[0].slice(1, 4), [['L3', 'L10'], OLD, NEW]);
    assert.equal(CALLS[0][4].keep, undefined, 'ไม่ส่ง keep = ไม่มี (server ถือว่าทุกตัวยังใช้ชื่อเดิม)');
    assert.deepEqual(ok.body.campaigns, [{ id: 7, name: 'แคมเปญ A', brand: "Jula's Herb" }], 'ไม่ส่ง team_id / places ออกไป');
    assert.equal(ok.body.data.targets[0].target, NEW);
    assert.match(LOG[0].summary, new RegExp(`แก้ชื่อ Target ${OLD} → ${NEW} ของ L3, L10 · เปลี่ยนในแคมเปญเดิม 1 แคมเปญ`));
    assert.equal(LOG[0].project_id, null);
    assert.deepEqual([LOG[1].project_id, LOG[1].project_name, LOG[1].team_id], [7, 'แคมเปญ A', 2]);
    reset();
    for (const body of [{ from: OLD, to: OLD, codes: ['L3'] }, { from: OLD, to: 'A,B', codes: ['L3'] }, { from: OLD, to: '', codes: ['L3'] },
        { from: '', to: NEW, codes: ['L3'] }, { from: OLD, to: NEW, codes: [] }, { from: OLD, to: NEW, codes: ['bad code'] }]) {
        assert.equal((await call(1, 'POST', '/targets/rename', body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(CALLS, [], 'ค่าผิด = ไม่เรียก store');
    await call(1, 'POST', '/targets/rename', { from: OLD, to: NEW, codes: ['L3'], keep: ['l10', 'bad code', 5, 'C1'] });
    assert.deepEqual(CALLS[0][4].keep, ['L10', 'C1'], 'keep: ตัวพิมพ์ใหญ่ · ทิ้งค่าที่ไม่ใช่รหัส');
});

test('GET /targets/usage: admin อย่างเดียว · นับแคมเปญตามรหัสที่ส่ง', async () => {
    reset();
    assert.equal((await call(2, 'GET', `/targets/usage?target=${encodeURIComponent(OLD)}&codes=L3`)).status, 403);
    const r = await call(1, 'GET', `/targets/usage?target=${encodeURIComponent(OLD)}&codes=L3,l10`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { count: 1, campaigns: [{ id: 7, name: 'แคมเปญ A', brand: "Jula's Herb" }], bundled: ['L8B'] });
    assert.deepEqual(CALLS[0].slice(1), [['L3', 'L10'], OLD]);
    assert.equal((await call(1, 'GET', `/targets/usage?target=&codes=L3`)).status, 400);
    assert.equal((await call(1, 'GET', `/targets/usage?target=X&codes=`)).status, 400);
});
