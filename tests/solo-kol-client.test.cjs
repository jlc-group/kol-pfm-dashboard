const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// KOL รายคน — ตรรกะฝั่งหน้าเว็บ (client/src/data/soloKol.js) + ตัวเลือกต้องตรงกับ server (server/src/store/soloKol.js)
// รอบ 4 (1 ต.ค. 2026): หลาย Platform — สรุปมีบัญชีต่อ Platform (solo_summary.accounts) · ไม่มีกำหนดลงงาน/เลยกำหนดแล้ว
const server = require(path.join(__dirname, '../server/src/store/soloKol'));
let c;
let ad;
before(async () => {
    c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/soloKol.js')).href);
    ad = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
});

test('ตัวเลือกฝั่งหน้าเว็บตรงกับ server (Platform / Tier / Photo-VDO / Campaign / อายุ Gencode / จำนวนคลิป / ขั้นงาน)', () => {
    assert.deepEqual(c.SOLO_PLATFORMS, server.SOLO_PLATFORMS);
    assert.deepEqual(c.SOLO_TIERS, server.SOLO_TIERS);
    assert.deepEqual(c.SOLO_MEDIA, server.SOLO_MEDIA);
    // ฟอร์มใช้ CAMPAIGN_TYPES (TikTok) ของ adGroups — server ตรวจกับ SOLO_CAMPAIGNS
    assert.deepEqual(ad.CAMPAIGN_TYPES, server.SOLO_CAMPAIGNS);
    assert.deepEqual(c.SOLO_CODE_EXPIRE, server.SOLO_CODE_EXPIRE);
    assert.equal(c.SOLO_MAX_CLIPS, server.SOLO_MAX_CLIPS);
    assert.deepEqual(Object.keys(c.SOLO_STEP_LABEL).sort(), [...server.SOLO_STEPS].sort(), 'ทุกขั้นที่ server ส่งมามีป้าย');
    const covered = c.SOLO_STEP_FILTERS.flatMap(f => f.steps).sort();
    assert.deepEqual(covered, [...server.SOLO_STEPS].sort(), 'ตัวกรองครอบทุกขั้น ไม่มีแถวหลุด');
});

test('tierFromFollowers: แนะนำ Tier ตามผู้ติดตาม', () => {
    assert.equal(c.tierFromFollowers(''), '');
    assert.equal(c.tierFromFollowers(0), '');
    assert.equal(c.tierFromFollowers(9999), 'Nano 1k - 10k');
    assert.equal(c.tierFromFollowers(10000), 'Micro 10k - 100k');
    assert.equal(c.tierFromFollowers(85000), 'Micro 10k - 100k');
    assert.equal(c.tierFromFollowers(100000), 'Macro 100k - 1M');
    assert.equal(c.tierFromFollowers(2500000), 'Mega 1M+');
    assert.equal(c.tierShort('Micro 10k - 100k'), 'Micro');
});

// บัญชีต่อ Platform ตามรูป solo_summary.accounts ของ server
const acct = (platform, account_name, over = {}) => ({ platform, account_name, link_account: null, followers: 0, tier: 'Micro 10k - 100k', ...over });
const row = (id, over = {}, sum = {}) => ({
    id, name: `KOL รายคน · @a${id} (TikTok)`, brand: 'Beauterry', owner: 'แพรว', status: 'Active', ...over,
    solo_summary: {
        account_name: 'a' + id, platform: 'TikTok', platforms: ['TikTok'], accounts: [acct('TikTok', 'a' + id)],
        payee: 'a' + id, products: ['BTA4-01'], clip_count: 1, clips: 1, posted: 0, ad_fired: 0,
        fee_per_clip: 5000, fee_total: 5000, fee_missing: false, fee_free: false, next_step: 'todo', ...sum
    }
});

test('ค้นหา / กรองขั้นงาน / สรุปยอด', () => {
    const list = [
        row(1),
        row(2, { brand: 'Jdent' }, { payee: 'Star Model', agency: 'Star Model', next_step: 'gencode' }),
        // 2 Platform × 2 คลิป = 4 โพสต์ · บัญชี Instagram ชื่อไม่เหมือนบัญชีหลัก
        row(3, {}, {
            platforms: ['TikTok', 'Instagram'], accounts: [acct('TikTok', 'a3'), acct('Instagram', 'a3.ig')],
            next_step: 'idpost', clip_count: 2, clips: 4, posted: 2, fee_per_clip: null, fee_total: 12000
        })
    ];
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, '@A2')).map(p => p.id), [2], 'ชื่อบัญชี (มี @ นำหน้าก็เจอ)');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'a3.ig')).map(p => p.id), [3], 'ชื่อบัญชีของ Platform อื่น (ไม่ใช่บัญชีหลัก)');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'star')).map(p => p.id), [2], 'Agency');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'jdent')).map(p => p.id), [2], 'แบรนด์');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, 'bta4-01')).map(p => p.id), [1, 2, 3], 'สินค้า');
    assert.deepEqual(list.filter(p => c.matchSoloSearch(p, '')).map(p => p.id), [1, 2, 3], 'ไม่พิมพ์ = ทั้งหมด');
    assert.deepEqual(list.filter(p => c.matchStepFilter(p, 'code')).map(p => p.id), [2, 3], 'Gencode + ID Post รวมปุ่มเดียว');
    assert.deepEqual(list.filter(p => c.matchStepFilter(p, 'all')).map(p => p.id), [1, 2, 3]);
    assert.deepEqual(c.soloTotals(list), { people: 3, clips: 6, fee: 22000, posted: 2, ad: 0 }, 'clips = จำนวนโพสต์ทั้งหมด (คลิป × Platform)');
});

test('soloAccountsOf / soloPlatformsOf: บัญชีและ Platform ของการจ้าง (มีของเดิมรุ่นก่อนรอบ 4 ก็อ่านได้)', () => {
    const multi = row(1, {}, { platforms: ['Instagram', 'TikTok'], accounts: [acct('TikTok', 'a1'), acct('Instagram', 'b1')] });
    assert.deepEqual(c.soloAccountsOf(multi).map(a => a.account_name), ['a1', 'b1']);
    assert.deepEqual(c.soloPlatformsOf(multi), ['TikTok', 'Instagram'], 'เรียงตาม SOLO_PLATFORMS เสมอ (ตัวแรก = Platform หลัก)');
    // สรุปรุ่นเก่า: บัญชีเดียวที่ระดับบนสุด ไม่มี accounts / platforms
    const old = { id: 9, solo_summary: { account_name: 'old', platform: 'Lemon8', followers: 1200, tier: 'Nano 1k - 10k', link_account: 'https://x.y' } };
    assert.deepEqual(c.soloAccountsOf(old), [{ platform: 'Lemon8', account_name: 'old', link_account: 'https://x.y', followers: 1200, tier: 'Nano 1k - 10k' }]);
    assert.deepEqual(c.soloPlatformsOf(old), ['Lemon8']);
    // ไม่มีสรุป — ถอยไปอ่านบล็อกในกลุ่มโฆษณา แล้วจึง Platform ของกลุ่ม
    assert.deepEqual(c.soloPlatformsOf({ ad_groups: [{ platform: 'YouTube', blocks: [{ platform: 'YouTube' }, { platform: 'TikTok' }] }] }), ['TikTok', 'YouTube']);
    assert.deepEqual(c.soloPlatformsOf({ ad_groups: [{ platform: 'X' }] }), ['X']);
    assert.deepEqual(c.soloPlatformsOf({}), []);
    assert.deepEqual(c.soloAccountsOf({}), []);
    assert.deepEqual(c.soloPlatformOrder(['YouTube', 'Other', 'TikTok', 'TikTok', '']), ['TikTok', 'YouTube', 'Other'], 'ค่าที่ไม่อยู่ในลิสต์ต่อท้าย ไม่ทิ้ง · ตัดซ้ำ/ค่าว่าง');
});

test('ตัวเลขบนหน้า: ค่าตัว / ผู้ติดตาม', () => {
    assert.equal(c.baht(10000), '฿10,000');
    assert.equal(c.baht(0), '฿0');
    assert.equal(c.followersText(85000), '85K');
    assert.equal(c.followersText(1500), '1.5K');
    assert.equal(c.followersText(2500000), '2.5M');
    assert.equal(c.followersText(0), '');
});

test('clipEmpty ตรงกับ soloClipEmpty ของ server ทุกแถวตัวอย่าง (ล็อก Platform / จำนวนคลิปในฟอร์มแก้ไขใช้เกณฑ์เดียวกับ updateSolo)', () => {
    const rows = [
        null, undefined, {}, { platform: 'TikTok', clip_no: 1, status: 'confirmed', budget: 5000 },
        { draft_link: 'https://d' }, { draft_link2: 'x' }, { draft_link3: 'x' }, { draft_link4: 'x' }, { draft_link5: 'x' },
        { draft_link: '   ' }, { draft_link: '' }, { draft_link: null },
        { post_url: 'https://p' }, { post_url: ' ' }, { gencode: '#abc' }, { gencode: '' }, { id_post: '7400000000000000000' }, { id_post: 0 },
        { ad_spend: 1 }, { ad_spend: '0.01' }, { ad_spend: 0 }, { ad_spend: '0' }, { ad_spend: -5 }, { ad_spend: 'abc' },
        { views: 10 }, { views: '3' }, { views: 0 }, { views: null },
        { perf_stamp: { at: '2026-10-01' } }, { perf_stamp: null }, { perf_stamp: '' },
        { ad_status: 'ยิงแล้ว' }, { ad_status: 'ยังไม่ยิง' }, { ad_status: 'ยิงแล้ว ' },
        { draft_status: 'approve' }, { likes: 500 }, { budget: 0 }, { status: 'rejected' }
    ];
    for (const s of rows) assert.equal(c.clipEmpty(s), server.soloClipEmpty(s), JSON.stringify(s));
    assert.equal(c.clipEmpty({}), true);
    assert.equal(c.clipEmpty({ draft_link: 'https://d' }), false, 'มีดราฟแล้ว = ไม่ว่าง (ลงงาน/ยิงแอดยังไม่มี ก็ล็อก)');
});

test('soloEditLimits: Platform ที่เอาออกไม่ได้ + จำนวนคลิปต่ำสุด จากคลิปที่ไม่ว่าง', () => {
    const clip = (platform, clip_no, over = {}) => ({ id: clip_no, platform, clip_no, status: 'confirmed', budget: 0, ...over });
    assert.deepEqual(c.soloEditLimits([]), { lockedPlatforms: [], minClips: 1 });
    assert.deepEqual(c.soloEditLimits(undefined), { lockedPlatforms: [], minClips: 1 });
    assert.deepEqual(c.soloEditLimits([clip('TikTok', 1), clip('TikTok', 2), clip('Instagram', 1), clip('Instagram', 2)]),
        { lockedPlatforms: [], minClips: 1 }, 'ทุกคลิปว่าง');
    // ดราฟอย่างเดียวก็ล็อกแล้ว (server ไม่ยอมลบคลิปที่มีดราฟ) · ลำดับ Platform ตาม SOLO_PLATFORMS
    assert.deepEqual(c.soloEditLimits([clip('Instagram', 3, { draft_link: 'https://d' }), clip('TikTok', 1, { gencode: '#g' }), clip('Facebook', 2)]),
        { lockedPlatforms: ['TikTok', 'Instagram'], minClips: 3 });
    assert.deepEqual(c.soloEditLimits([clip('X', 2, { id_post: '1' }), clip('X', 1)]), { lockedPlatforms: ['X'], minClips: 2 });
});

test('server รุ่นเก่า: 404 นับเป็น "ยังไม่มีเส้นนี้" เฉพาะ API route not found · ข้อความแยกรุ่นอื่นตามเดิม', () => {
    const err = (status, message) => Object.assign(new Error(message), { status });
    assert.equal(c.isOldServerError(err(404, 'API route not found')), true);
    assert.equal(c.isOldServerError(err(404, 'ไม่พบ Project')), false, 'รายการถูกลบไปแล้ว — โชว์ข้อความของ server');
    assert.equal(c.isOldServerError(err(404, 'ไม่พบรายการ')), false);
    for (const m of c.OLD_SERVER_MSGS) assert.equal(c.isOldServerError(err(400, m)), true, m);
    assert.deepEqual(c.OLD_SERVER_MSGS, ['ใส่Platformก่อนนะ', 'ใส่ชื่อบัญชี KOLก่อนนะ']);
    assert.equal(c.isOldServerError(err(409, 'หน้าเว็บนี้เป็นรุ่นเก่า — กด F5 แล้วแก้อีกครั้ง')), false);
    assert.equal(c.isOldServerError(err(400, 'TikTok: ใส่ชื่อบัญชี KOL ก่อนนะ')), false, 'ข้อความของ server รุ่นใหม่ (มีชื่อ Platform นำ)');
    assert.equal(c.isOldServerError(null), false);
    assert.equal(c.OLD_SERVER_FEE_MSG, 'ค่าตัวของ KOL รายคนต้องมากกว่า 0', 'ข้อความของ server ก่อนรอบ 4 ตอนตั้งค่าตัว 0');
    assert.match(c.OLD_SERVER_TEXT, /F5/);
    // server รุ่นนี้ไม่คืนข้อความแยกรุ่นจากการตรวจค่าเลย (ทั้งตอนเพิ่มและแก้ไข)
    for (const opts of [{}, { editing: true }]) {
        for (const body of [{}, { platform: '' }, { platforms: [{}] }, { platforms: [{ platform: 'TikTok' }] }, { platform: 'TikTok' }]) {
            const e = server.soloInput(body, opts).error;
            assert.ok(!c.OLD_SERVER_MSGS.includes(e) && e !== c.OLD_SERVER_FEE_MSG, JSON.stringify(body) + ' → ' + e);
        }
    }
});

test('+ Account (หลาย KOL ในฟอร์มเดียว): soloDuplicateAccounts จับชื่อบัญชีซ้ำใน Platform เดียวกัน · ไม่สน @ / ช่องว่าง / ตัวพิมพ์', () => {
    const kol = acc => ({ acc });
    const kols = [
        kol({ TikTok: { account_name: '@Mintty' }, Instagram: { account_name: 'mint.ig' } }),
        kol({ TikTok: { account_name: ' mintty ' }, Instagram: { account_name: 'other' } }),   // TikTok ซ้ำกับคนแรก
        kol({ TikTok: { account_name: '' }, Instagram: { account_name: '@@MINT.IG' } }),         // ว่างไม่นับ · IG ซ้ำกับคนแรก
        kol({ TikTok: { account_name: 'MINTTY' } })                                              // ซ้ำคนแรก (ไม่ใช่คนที่ 2)
    ];
    assert.deepEqual(c.soloDuplicateAccounts(kols, ['TikTok', 'Instagram']), { '1|TikTok': 0, '2|Instagram': 0, '3|TikTok': 0 });
    // Platform ที่ไม่ได้เลือกไม่ตรวจ (ค่าค้างในการ์ดตอนเอาติ๊กออก)
    assert.deepEqual(c.soloDuplicateAccounts(kols, ['Instagram']), { '2|Instagram': 0 });
    // ชื่อเดียวกันคนละ Platform ไม่ถือว่าซ้ำ
    assert.deepEqual(c.soloDuplicateAccounts([kol({ TikTok: { account_name: 'a' } }), kol({ Instagram: { account_name: 'a' } })], ['TikTok', 'Instagram']), {});
    assert.deepEqual(c.soloDuplicateAccounts(null, ['TikTok']), {});
    assert.deepEqual(c.soloDuplicateAccounts([null, kol({})], ['TikTok']), {});
    // เลือก Platform ในการ์ดของแต่ละคน: ค่าค้างของ Platform ที่คนนั้นเอาติ๊กออกไม่นับ
    const perKol = [
        { platforms: ['TikTok'], acc: { TikTok: { account_name: 'a' } } },
        { platforms: ['Instagram'], acc: { TikTok: { account_name: 'a' }, Instagram: { account_name: 'a' } } },   // TikTok ค้าง (ไม่ได้เลือก)
        { platforms: ['TikTok', 'Instagram'], acc: { TikTok: { account_name: '@A' }, Instagram: { account_name: 'b' } } }
    ];
    assert.deepEqual(c.soloDuplicateAccounts(perKol, ['TikTok', 'Instagram']), { '2|TikTok': 0 });
});

test('ฟอร์มไม่มีช่องทางติดต่อแล้ว (5 ต.ค. 2026): ค่าที่ฟอร์มส่ง (self / agency เดิม) server ยังรับ · บรีฟลิงก์ + รายละเอียดเก็บได้', () => {
    const base = {
        platforms: [{ platform: 'TikTok', account_name: '@a', tier: 'Nano 1k - 10k', fee: 1000, content_type: ad.contentTypesFor('TikTok')[0], cart: false }],
        brand: 'B', products: ['P1'], clips: 1, owner: 'o', code_expire: 60
    };
    const self = server.soloInput({ ...base, contact_mode: 'self', agency: '', brief_link: 'https://drive.google.com/x', note: 'บรรทัด 1\nบรรทัด 2' });
    assert.equal(self.error, undefined, self.error);
    assert.equal(self.input.contact_mode, 'self');
    assert.equal(self.input.brief_link, 'https://drive.google.com/x');
    assert.equal(self.input.note, 'บรรทัด 1\nบรรทัด 2');
    const ag = server.soloInput({ ...base, contact_mode: 'agency', agency: 'Ag Co' }, { editing: true });
    assert.equal(ag.error, undefined, ag.error);
    assert.equal(ag.input.agency, 'Ag Co');
    assert.match(server.soloInput({ ...base, contact_mode: 'self', brief_link: 'drive.google.com/x' }).error, /ลิงก์บรีฟ/);
});

test('ใส่ลิงก์ช่อง → เติมชื่อบัญชีให้ (3 พ.ย. 2026): อ่านจากลิงก์ · เฉพาะ Platform ของช่อง · ไม่ทับชื่อที่พิมพ์เอง', () => {
    const empty = { account_name: '', link_account: '', followers: '', tier: '', tierTouched: false, autoName: '' };
    // ลิงก์โปรไฟล์ / ลิงก์คลิปที่มี @ / มี query ต่อท้าย → ชื่อบัญชี
    let a = c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@aom_chr?is_from_webapp=1&sender_device=pc');
    assert.equal(a.account_name, 'aom_chr');
    assert.equal(a.link_account, 'https://www.tiktok.com/@aom_chr?is_from_webapp=1&sender_device=pc', 'ช่องลิงก์เก็บตามที่ใส่');
    assert.equal(c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@nam.wan/video/7412345678901234567').account_name, 'nam.wan');
    assert.equal(c.accWithLink(empty, 'Instagram', 'https://www.instagram.com/aom.chr/?igsh=abc').account_name, 'aom.chr');
    assert.equal(c.accWithLink(empty, 'Facebook', 'https://www.facebook.com/aomchr').account_name, 'aomchr');
    assert.equal(c.accWithLink(empty, 'YouTube', 'https://www.youtube.com/@aomchannel').account_name, 'aomchannel');
    assert.equal(c.accWithLink(empty, 'X', 'https://x.com/aom_x').account_name, 'aom_x');
    assert.equal(c.accWithLink(empty, 'Lemon8', 'https://www.lemon8-app.com/@aom8').account_name, 'aom8');
    assert.equal(c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@%E0%B8%AD%E0%B8%AD%E0%B8%A1').account_name, 'ออม', 'ชื่อภาษาไทยในลิงก์ถอดรหัสให้');
    // พิมพ์ลิงก์ทีละตัว: ชื่อตามลิงก์ล่าสุด (ชื่อที่เติมให้เองเปลี่ยนตามได้)
    a = c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@ao');
    a = c.accWithLink(a, 'TikTok', 'https://www.tiktok.com/@aom');
    assert.equal(a.account_name, 'aom');
    // ลิงก์ของ Platform อื่น → ไม่เติม (ช่องลิงก์ยังเก็บค่า)
    const ig = c.accWithLink(empty, 'TikTok', 'https://www.instagram.com/aom.chr');
    assert.equal(ig.account_name, '');
    assert.equal(ig.link_account, 'https://www.instagram.com/aom.chr');
    // ชื่อที่พิมพ์เอง / ชื่อเดิมของรายการที่แก้ไข (ไม่มี autoName) → ไม่ทับ
    assert.equal(c.accWithLink({ ...empty, account_name: 'ชื่อที่พิมพ์' }, 'TikTok', 'https://www.tiktok.com/@other').account_name, 'ชื่อที่พิมพ์');
    assert.equal(c.accWithLink({ account_name: 'saved', link_account: 'https://www.tiktok.com/@saved' }, 'TikTok', 'https://www.tiktok.com/@other').account_name, 'saved');
    // เติมให้แล้วผู้ใช้แก้ชื่อเอง → เปลี่ยนลิงก์ทีหลังไม่ทับ
    a = c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@aom');
    a = { ...a, account_name: 'aom_official' };
    assert.equal(c.accWithLink(a, 'TikTok', 'https://www.tiktok.com/@zzz').account_name, 'aom_official');
    // ลบชื่อออกหมดแล้วใส่ลิงก์ใหม่ → เติมใหม่ได้
    assert.equal(c.accWithLink({ ...a, account_name: '  ' }, 'TikTok', 'https://www.tiktok.com/@zzz').account_name, 'zzz');
    // ลิงก์ที่อ่านชื่อไม่ได้ (ลิงก์ย่อ / ลิงก์โพสต์ IG) → ล้างชื่อที่เคยเติมให้ (ไม่ค้างชื่อของลิงก์เก่า)
    a = c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@aom');
    assert.equal(c.accWithLink(a, 'TikTok', 'https://vt.tiktok.com/ZSabc123/').account_name, '');
    assert.equal(c.accWithLink(empty, 'Instagram', 'https://www.instagram.com/reel/C0abc/').account_name, '');
    // ไม่ใช่ลิงก์ / ลบลิงก์ออก → ไม่แตะชื่อ
    assert.equal(c.accWithLink(a, 'TikTok', '').account_name, 'aom');
    assert.equal(c.accWithLink(a, 'TikTok', 'aom chr').account_name, 'aom');
    // ACC ที่ยังไม่มี (undefined) ใช้ได้
    assert.equal(c.accWithLink(undefined, 'TikTok', 'https://www.tiktok.com/@new').account_name, 'new');
    // ชื่อที่เติมให้ผ่านเกณฑ์ server (ตัด @ · ไม่ว่าง)
    const r = server.soloInput({
        platforms: [{ platform: 'TikTok', ...c.accWithLink(empty, 'TikTok', 'https://www.tiktok.com/@aom_chr'), tier: 'Nano 1k - 10k', fee: 1000, content_type: ad.contentTypesFor('TikTok')[0], cart: true }],
        brand: 'B', products: ['P1'], clips: 1, owner: 'o', code_expire: 60, contact_mode: 'self', agency: ''
    });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.input.platforms[0].account_name, 'aom_chr');
    assert.equal(r.input.platforms[0].link_account, 'https://www.tiktok.com/@aom_chr');
});

test('คำใต้ช่องลิงก์ช่อง: ว่าง = วิธีใช้ · ลิงก์ Platform อื่น / อ่านชื่อไม่ได้ = บอกเหตุ · ลิงก์ปกติ = ไม่มีคำ', () => {
    assert.match(c.soloLinkHint('TikTok', ''), /ชื่อบัญชีขึ้นให้เอง/);
    assert.match(c.soloLinkHint('TikTok', '   '), /ชื่อบัญชีขึ้นให้เอง/);
    assert.equal(c.soloLinkHint('TikTok', 'https://www.tiktok.com/@aom'), '');
    assert.equal(c.soloLinkHint('TikTok', 'https://www.instagram.com/aom'), 'ลิงก์นี้เป็นของ Instagram ไม่ใช่ TikTok');
    assert.match(c.soloLinkHint('TikTok', 'https://vt.tiktok.com/ZSabc123/'), /อ่านชื่อบัญชีจากลิงก์นี้ไม่ได้/);
    assert.match(c.soloLinkHint('Facebook', 'https://www.facebook.com/profile.php?id=1000123'), /อ่านชื่อบัญชีจากลิงก์นี้ไม่ได้/);
    assert.equal(c.soloLinkHint('TikTok', 'https://linktr.ee/aom'), '', 'เว็บอื่น (linktree) ไม่เตือน');
    assert.equal(c.soloLinkHint('TikTok', 'ไม่ใช่ลิงก์'), '', 'ไม่ใช่ลิงก์ — ให้ตัวตรวจ http:// ของฟอร์มเตือนแทน');
});
