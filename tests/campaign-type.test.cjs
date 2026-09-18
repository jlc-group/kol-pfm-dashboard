const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ช่อง Campaign (VDO View / Reach / Consideration Ads) ตั้งต่อชุด Content Type ในฟอร์มแคมเปญ
// หน้า Ads อ่านค่านี้จาก allocations ของกลุ่ม ตาม Platform + Content Type ของ KOL — ไม่มีฐานข้อมูล
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { resolveGroupCampaign } = require(path.join(SRC, 'store/logic.js'));

const GROUP = {
    key: 'g1', platform: 'TikTok', platforms: ['TikTok', 'Facebook'],
    allocations: [
        { platform: 'TikTok', tier: 'Nano 1k - 10k', kols: 2, content_type: 'Review', media_type: 'VDO', content_format: 'Review', campaign: 'Reach' },
        { platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 1, content_type: 'Branding', media_type: 'VDO', content_format: 'Tie-in', campaign: 'Consideration Ads' },
        { platform: 'Facebook', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Awareness', media_type: 'Photo', content_format: null, campaign: null }
    ]
};

test('resolveGroupCampaign picks the campaign of the matching Platform + Content Type', () => {
    assert.equal(resolveGroupCampaign(GROUP, 'TikTok', 'Review'), 'Reach');
    assert.equal(resolveGroupCampaign(GROUP, 'TikTok', 'Branding'), 'Consideration Ads');
    // ชุดที่ไม่ได้เลือก Campaign = null ห้ามไปหยิบของ Platform อื่นมาแทน
    assert.equal(resolveGroupCampaign(GROUP, 'Facebook', 'Awareness'), null);
    assert.equal(resolveGroupCampaign(GROUP, 'Instagram', 'Review'), null);
});

test('Campaign is TikTok-only: other platforms give null even when old data carries a value', () => {
    const g = { key: 'g3', allocations: [
        { platform: 'Facebook', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Awareness', campaign: 'Reach' },
        { platform: 'Instagram', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Review', campaign: 'VDO View' },
        { platform: 'TikTok', tier: 'Nano 1k - 10k', kols: 1, content_type: 'Review', campaign: 'Reach' }
    ] };
    assert.equal(resolveGroupCampaign(g, 'Facebook', 'Awareness'), null);
    assert.equal(resolveGroupCampaign(g, 'Instagram', 'Review'), null);
    assert.equal(resolveGroupCampaign(g, 'TikTok', 'Review'), 'Reach');
});

test('the campaign form clears Campaign on non-TikTok blocks when saving', async () => {
    const { pathToFileURL } = require('node:url');
    const web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adGroups.js')).href);
    assert.equal(web.needCampaign('TikTok'), true);
    assert.equal(web.needCampaign('Facebook'), false);
    const sets = [{ campaign: 'Reach', content_type: 'Review', tiers: [] }, { campaign: '', content_type: 'Sale', tiers: [] }];
    const tik = { platform: 'TikTok', sets };
    assert.equal(web.packCampaigns(tik), tik);
    const fb = web.packCampaigns({ platform: 'Facebook', sets });
    assert.deepEqual(fb.sets.map(s => s.campaign), ['', '']);
    assert.deepEqual(fb.sets.map(s => s.content_type), ['Review', 'Sale']);
    assert.equal(sets[0].campaign, 'Reach'); // ไม่แก้ของเดิมในที่
    // allocations ที่แบนออกมาจึงไม่มี Campaign ของ Facebook
    assert.deepEqual(web.flattenBlocks([{ platform: 'Facebook', sets: [{ campaign: '', content_type: 'Awareness', tiers: [{ tier: 'Nano 1k - 10k', kols: 1 }] }] }])[0].campaign, null);
});

test('resolveGroupCampaign: no group or a group saved before the field existed gives null', () => {
    assert.equal(resolveGroupCampaign(null, 'TikTok', 'Review'), null);
    assert.equal(resolveGroupCampaign({ key: 'old', allocations: [{ platform: 'TikTok', content_type: 'Review', media_type: 'VDO' }] }, 'TikTok', 'Review'), null);
    assert.equal(resolveGroupCampaign({ key: 'older', content_type: 'Review' }, 'TikTok', 'Review'), null);
});

test('resolveGroupCampaign: a set without a Content Type does not hand its Campaign to other Content Types', () => {
    // เช่น แก้แคมเปญเก่า กดเพิ่มชุด เลือก Campaign + Tier แต่ลืมเลือก Content Type (โหมดแก้ไขไม่บังคับกรอก)
    const g = { key: 'g2', allocations: [
        { platform: 'TikTok', tier: 'Nano 1k - 10k', kols: 1, content_type: null, campaign: 'VDO View' },
        { platform: 'TikTok', tier: 'Micro 10k - 100k', kols: 2, content_type: 'Review', campaign: null }
    ] };
    assert.equal(resolveGroupCampaign(g, 'TikTok', 'Review'), null);
    assert.equal(resolveGroupCampaign(g, 'TikTok', 'Sale'), null);
    // KOL ที่ไม่มี Content Type เลย ยังหยิบของ Platform นั้นได้
    assert.equal(resolveGroupCampaign(g, 'TikTok', null), 'VDO View');
});

// ==================== โค้ดจริงของ ads.list กับ snapshot ปลอม ====================
// ต่อฐานจริงทุกทางโยน error ทันที · loadSnapshot ถูกสลับเป็นข้อมูลชุดทดสอบ
const pg = require(require.resolve('pg', { paths: [SRC] }));
const noRealDb = () => { throw new Error('Unexpected real database connection in campaign-type test'); };
pg.Pool.prototype.connect = async function () { noRealDb(); };
pg.Client.prototype.connect = async function () { noRealDb(); };
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = async () => noRealDb();
pool.connect = async () => noRealDb();
after(() => pool.end());

const SUB = fields => ({
    project_id: 61, person_key: null, clip_no: 1, platform: 'TikTok', product: 'สินค้า A', agency: 'Agency A',
    status: 'confirmed', budget: 3000, ad_spend: 0, ad_reach: 0, ad_status: 'ยังไม่ยิง',
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0,
    link_account: null, post_date: '2026-09-01', group_key: null, content_type: null, ...fields
});
const FIXTURE = {
    projects: [
        { id: 61, name: 'แคมเปญทดสอบ Campaign', brand: 'Jdent', budget: 50000, status: 'Active', team_id: 1,
          created_at: '2026-09-01T00:00:00.000Z', start_date: '2026-09-01', end_date: null, products: ['สินค้า A'], ad_groups: [GROUP] }
    ],
    submissions: [
        SUB({ id: 1, account_name: 'รีวิว', group_key: 'g1', content_type: 'Review', post_url: 'https://example.test/r' }),
        SUB({ id: 2, account_name: 'แบรนดิ้ง', group_key: 'g1', content_type: 'Branding', post_url: 'https://example.test/b' }),
        SUB({ id: 3, account_name: 'เฟซบุ๊ก', group_key: 'g1', platform: 'Facebook', content_type: 'Awareness', post_url: 'https://example.test/f' }),
        SUB({ id: 4, account_name: 'ไม่มีกลุ่ม', post_url: 'https://example.test/n' }),
        // ตรวจข้อมูลโพสต์: รอตรวจ / ส่งกลับให้แก้ ยังไม่ขึ้นหน้า Ads · ตรวจแล้วขึ้นตามปกติ
        SUB({ id: 5, account_name: 'รอตรวจ', post_url: 'https://example.test/p', post_check: 'pending' }),
        SUB({ id: 6, account_name: 'ส่งกลับ', post_url: 'https://example.test/x', post_check: 'returned' }),
        SUB({ id: 7, account_name: 'ตรวจแล้ว', post_url: 'https://example.test/o', post_check: 'ok' })
    ],
    teams: []
};
const snapshot = require(path.join(SRC, 'store/pg/_snapshot'));
snapshot.loadSnapshot = async (only = Object.keys(FIXTURE)) => {
    const snap = {};
    for (const t of only) snap[t] = structuredClone(FIXTURE[t] || []);
    return snap;
};
// ads.js หยิบ loadSnapshot ออกไปตอน require — ต้องสลับก่อนโหลด
const { ads } = require(path.join(SRC, 'store/pg/ads'));

test('Ads page rows carry the campaign set on the group for that Platform + Content Type', async () => {
    const { rows } = await ads.list({ scopeBrands: ['Jdent'] });
    const by = name => rows.find(r => r.account_name === name);
    assert.deepEqual([by('รีวิว').campaign, by('รีวิว').content_type, by('รีวิว').media_type], ['Reach', 'Review', 'VDO']);
    assert.deepEqual([by('แบรนดิ้ง').campaign, by('แบรนดิ้ง').group_format], ['Consideration Ads', 'Tie-in']);
    assert.equal(by('เฟซบุ๊ก').campaign, null);
    assert.equal(by('ไม่มีกลุ่ม').campaign, null);
});

test('posts waiting for the team check stay off the Ads page and are counted per campaign', async () => {
    const { rows, summary } = await ads.list({ scopeBrands: ['Jdent'] });
    const names = rows.map(r => r.account_name);
    assert.ok(!names.includes('รอตรวจ') && !names.includes('ส่งกลับ'));
    assert.ok(names.includes('ตรวจแล้ว') && names.includes('ไม่มีกลุ่ม'));
    assert.equal(summary.check_waiting, 2);
    assert.equal(summary.check_pending, 1);
    assert.equal(summary.check_returned, 1);
    assert.deepEqual(summary.check_waiting_projects, [{ project_id: 61, project_name: 'แคมเปญทดสอบ Campaign', count: 2, pending: 1, returned: 1 }]);
    assert.equal(summary.total_posts, rows.length);
    // แบรนด์อื่นไม่เห็นตัวเลขรอตรวจของแบรนด์นี้
    assert.equal((await ads.list({ scopeBrands: ['Code Lab'] })).summary.check_waiting, 0);
});
