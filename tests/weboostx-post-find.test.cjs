const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// หาโพสต์ IG / FB จากรายการโพสต์ KOL ของ WeBoostX ให้แถวที่ยังไม่มี ID POST (26 ต.ค. 2026 — สัญญาข้อ 2 docs/KOL_DASHBOARD_API.md ของ WeBoostX2)
// + ซิงก์ส่งทุกคีย์ของแถว (ลิงก์ → ID POST → Gencode) ใช้ตัวแรกที่เจอ · เติม ID POST ได้เฉพาะตอนยังว่าง (fillEmpty)
// ไม่เรียก WeBoostX จริง ไม่ต่อฐานจริง
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
after(() => pool.end());

const base = require(path.join(SRC, 'store/pg/_base'));
let current = null;
const writes = [];
const fakeClient = {
    async query(q, vals = []) {
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: current ? [structuredClone(current)] : [] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            writes.push(Object.fromEntries(cols));
            return { rows: [{ ...current, ...Object.fromEntries(cols) }] };
        }
        if (/FROM projects/.test(q)) return { rows: [{ brand: 'Beauterry', campaign_type: 'kol' }] };
        throw new Error('unexpected SQL: ' + q.slice(0, 90));
    }
};
base.withTransaction = async fn => fn(fakeClient);
const subs = require(path.join(SRC, 'store/pg/submissions'));
const { itemKeysFor, itemIdFor } = require(path.join(SRC, 'services/weboostxMetrics'));
const sync = require(path.join(SRC, 'services/weboostxPfmSync'));
const P = require(path.join(SRC, 'services/weboostxPosts'));

const IG = 'https://www.instagram.com/reel/DeI-YpaS2Yf/?stkn=MWVqb3g4OXhvMWY2aw==';
const ENV = { WEBOOSTX_PFM_SYNC_ENABLED: 'true', WEBOOSTX_PFM_EXPORT_KEY: 'k-test', WEBOOSTX_PFM_BASE_URL: 'http://wx.test' };

test('คีย์ของแถว: ลิงก์ → ID POST → Gencode (ไม่ซ้ำ) · คีย์หลักเหมือนเดิม · ไม่ใช่ IG/FB = ไม่มีคีย์', () => {
    assert.deepEqual(itemKeysFor({ platform: 'Instagram', post_url: IG, id_post: '181', gencode: 'adcode-x' }), [IG, '181', 'adcode-x']);
    assert.deepEqual(itemKeysFor({ platform: 'Facebook', id_post: '111_222', gencode: '111_222' }), ['111_222']);
    assert.deepEqual(itemKeysFor({ platform: 'Instagram', post_url: 'https://instagram.com/person/', id_post: 'abc', gencode: '' }), []);
    assert.deepEqual(itemKeysFor({ platform: 'TikTok', id_post: '1' }), []);
    assert.equal(itemIdFor({ platform: 'Instagram', post_url: IG, id_post: '181' }), IG);
    assert.equal(itemIdFor({ platform: 'Instagram', id_post: '181', gencode: 'x' }), '181');
    assert.equal(itemIdFor({ platform: 'Instagram' }), null);
});

test('ID POST ที่ซิงก์เติมเอง (ไม่มีชื่อคน + เคยจับได้) ไม่ใช้เป็นคีย์สำรองของแถวที่มีลิงก์ · ID ที่คนกรอก/ยืนยัน หรือแถวที่ไม่มีลิงก์ = ใช้ · คีย์มีช่องว่าง/อักขระควบคุม = ไม่ส่ง (ผลรีวิว)', () => {
    const synced = { platform: 'Instagram', post_url: IG, id_post: '181', gencode: 'adcode-x', id_post_by: null, ad_synced_at: '2026-10-20T00:00:00Z' };
    assert.deepEqual(itemKeysFor(synced), [IG, 'adcode-x'], 'แก้ลิงก์แล้ว ID ของโพสต์เก่าต้องไม่ถูกใช้');
    assert.deepEqual(itemKeysFor({ ...synced, id_post_by: 'Fon' }), [IG, '181', 'adcode-x'], 'คนยืนยัน/กรอกเอง = ใช้');
    assert.deepEqual(itemKeysFor({ ...synced, ad_synced_at: null }), [IG, '181', 'adcode-x'], 'ยังไม่เคยจับได้ = ใช้');
    assert.deepEqual(itemKeysFor({ ...synced, post_url: null }), ['181', 'adcode-x'], 'ไม่มีลิงก์ = ID เป็นคีย์หลักเหมือนเดิม');
    const { idKeyOf } = require(path.join(SRC, 'services/weboostxMetrics'));
    assert.equal(idKeyOf(synced), null);
    assert.equal(idKeyOf({ ...synced, id_post_by: 'Fon' }), '181');
    assert.deepEqual(itemKeysFor({ platform: 'Instagram', post_url: IG, gencode: 'adcode-\u001fx' }), [IG], 'Gencode มีอักขระควบคุม = ไม่ส่ง');
    assert.deepEqual(itemKeysFor({ platform: 'Instagram', gencode: 'adcode x' }), []);
    assert.deepEqual(itemKeysFor({ platform: 'Instagram', gencode: '  adcode-ok  ' }), ['adcode-ok']);
});

test('แบ่งชุด: คีย์ทุกตัวของแถวเดียวกันอยู่ชุดเดียวกัน · ชุดละไม่เกิน 2000 คีย์ · คีย์ซ้ำนับครั้งเดียว', () => {
    const items = Array.from({ length: 1500 }, (_, i) => ({ submission_id: i, platform: 'instagram', item_id: 'L' + i, item_ids: ['L' + i, 'I' + i] }));
    items.push({ submission_id: 9999, platform: 'instagram', item_id: 'L0', item_ids: ['L0'] });   // คีย์ซ้ำกับแถว 0
    const batches = sync.batchItems(items);
    assert.ok(batches.length >= 2);
    for (const b of batches) {
        assert.ok(b.ids.length <= 2000, 'ชุดละไม่เกิน 2000 คีย์');
        for (const it of b.items) it.item_ids.forEach(k => assert.ok(b.ids.includes(k), `คีย์ ${k} ของแถว ${it.submission_id} อยู่ชุดเดียวกัน`));
    }
    assert.equal(batches.reduce((n, b) => n + b.items.length, 0), items.length);
    // store รุ่นเก่าที่ส่งแค่ item_id ยังใช้ได้
    assert.deepEqual(sync.batchItems([{ submission_id: 1, item_id: 'A' }]), [{ items: [{ submission_id: 1, item_id: 'A' }], ids: ['A'] }]);
});

test('ซิงก์: ลิงก์จับไม่ได้ → ใช้ผลของ ID POST · ลิงก์จับได้ → ใช้ลิงก์ (เหมือนเดิม) · ไม่เจอทุกคีย์ = source_not_found', async () => {
    const items = [
        { submission_id: 1, platform: 'instagram', item_id: IG, item_ids: [IG, '181'] },          // ลิงก์ไม่เจอ ID เจอ
        { submission_id: 2, platform: 'instagram', item_id: 'https://www.instagram.com/p/OK/', item_ids: ['https://www.instagram.com/p/OK/', '999'] },
        { submission_id: 3, platform: 'instagram', item_id: 'https://www.instagram.com/p/NO/', item_ids: ['https://www.instagram.com/p/NO/', 'adcode-zz'] }
    ];
    const asked = [];
    const fetchImpl = async (url, opts) => {
        const ids = JSON.parse(opts.body).item_ids;
        asked.push(...ids);
        const row = (item_id, id_post, spend) => ({ item_id, id_post, platform: 'instagram', ad_spend: spend, ad_launched: true });
        const rows = [];
        if (ids.includes('181')) rows.push(row('181', '181', 50));
        if (ids.includes('https://www.instagram.com/p/OK/')) rows.push(row('https://www.instagram.com/p/OK/', '555', 70));
        if (ids.includes('999')) rows.push(row('999', '999', 1));
        return { ok: true, json: async () => ({ status: 'success', data: { rows, not_found: [] } }) };
    };
    const applied = [];
    const storeImpl = { items: async () => items, apply: async rows => { applied.push(...rows); return { updated: rows.length }; } };
    const r = await sync.runSync({ storeImpl, fetchImpl, env: ENV });
    assert.deepEqual(asked.sort(), [IG, '181', 'https://www.instagram.com/p/OK/', '999', 'https://www.instagram.com/p/NO/', 'adcode-zz'].sort());
    assert.deepEqual(applied.map(a => [a.submission_id, a.item_id, a.ad_spend]), [[1, '181', 50], [2, 'https://www.instagram.com/p/OK/', 70]]);
    assert.deepEqual(r.source_not_found, [3]);
});

test('แถวจาก /posts: ID ผิดรูป = ทิ้งทั้งแถว · ลิงก์ที่ไม่ใช่ https IG/FB = null · SKU กรอง · FB เก็บ story', () => {
    assert.equal(P.sanitizePost({ platform: 'instagram', id_post: '12a' }), null);
    assert.equal(P.sanitizePost({ platform: 'tiktok', id_post: '12' }), null);
    const ig = P.sanitizePost({ platform: 'instagram', id_post: '181', permalink: 'javascript:alert(1)', creator: '  beiieo ', post_date: '2026-10-06',
        sku_codes: ['bta4-02', '<b>', 'BTA4-02', 5], first_ad_date: '2026-13-40', ad_spend: -3, ad_reach: 1200 });
    assert.deepEqual([ig.permalink, ig.creator, ig.post_date, ig.sku_codes, ig.first_ad_date, ig.ad_spend, ig.ad_reach],
        [null, 'beiieo', '2026-10-06', ['BTA4-02'], null, null, 1200]);
    assert.equal(P.sanitizePost({ platform: 'instagram', id_post: '1', permalink: 'https://evil.example/p/x' }).permalink, null);
    assert.equal(P.sanitizePost({ platform: 'instagram', id_post: '1', permalink: 'https://www.instagram.com/p/x/' }).permalink, 'https://www.instagram.com/p/x/');
    const fb = P.sanitizePost({ platform: 'facebook', id_post: '887205877244964', fb_story_id: '100458169258987_887205877244964' });
    assert.equal(fb.fb_story_id, '100458169258987_887205877244964');
    assert.equal(P.sanitizePost({ platform: 'instagram', id_post: '1', fb_story_id: '1_2' }).fb_story_id, null);
});

test('เรียงตัวเลือก: ชื่อตรง + วันตรง + สินค้าตรง = ใกล้เคียงมาก · สะกดต่าง 2 ตัว (belleo / beiieo) ยังขึ้น · คนละแบรนด์โดนหัก · ไม่ใกล้เลยไม่ขึ้น', () => {
    const clip = { platform: 'Instagram', brand: 'Beauterry', account_name: 'belleo', link_account: 'https://www.instagram.com/beiieo/?hl=th', post_date: '2026-10-06', product: 'BTA4-02' };
    const post = (id, over) => ({ platform: 'instagram', id_post: id, fb_story_id: null, brand: 'Beauterry', brand_code: 'BEAUTERRY', creator: null, post_date: null, first_ad_date: null, last_ad_date: '2026-10-20', sku_codes: [], ...over });
    const posts = [
        post('1', { creator: 'beiieo', post_date: '2026-10-06', sku_codes: ['BTA4-02'] }),        // ตรงกับชื่อในลิงก์โปรไฟล์
        post('7', { creator: 'beiieo', post_date: '2026-10-06', brand: null, brand_code: null }),     // ไม่รู้แบรนด์ = ไม่ขึ้น
        post('2', { creator: 'beIIeo ', post_date: '2026-10-08', sku_codes: ['BTA4-02', 'BTA4-03'] }),
        post('3', { creator: 'someone', post_date: '2026-09-01', sku_codes: ['BTA1-01'] }),
        post('4', { creator: 'beiieo', post_date: '2026-10-06', brand: 'Jernis', brand_code: 'JERNIS' }),
        post('5', { creator: 'bellao', post_date: null, first_ad_date: '2026-10-09' }),              // สะกดต่าง 1 ตัวจากชื่อในระบบ
        { ...post('6', { creator: 'beiieo' }), platform: 'facebook' }
    ];
    const r = P.rankPosts(clip, posts);
    assert.deepEqual(r.map(p => p.id_post), ['1', '2', '5'], 'คนละแบรนด์ (4) / ไม่รู้แบรนด์ (7) ไม่ขึ้นเลย — ห้ามเห็นโพสต์ของแบรนด์อื่น');
    assert.equal(r[0].level, 'high');
    assert.ok(r[0].reasons.some(x => x.ok && x.text === 'ชื่อ KOL ตรง'));
    assert.ok(r.find(p => p.id_post === '5').reasons.some(x => x.text.startsWith('ชื่อ KOL ใกล้เคียง')));
    assert.equal(P.brandMatches("Jula's Herb", { brand: 'JULAS HERB' }), true);
    assert.equal(P.brandMatches('Beauterry', { brand: null, brand_code: 'BEAUTERRY' }), true);
    assert.equal(P.brandMatches('Beauterry', { brand: 'Jernis', brand_code: 'JERNIS' }), false);
    assert.equal(P.brandMatches('', { brand: '' }), false);
    // ค้นด้วยชื่อในแอด / ID — เจอแม้คะแนนต่ำ
    assert.deepEqual(P.rankPosts(clip, posts, { q: 'some' }).map(p => p.id_post), ['3']);
    assert.deepEqual(P.rankPosts(clip, posts, { q: '4' }).map(p => p.id_post), [], 'ค้นด้วย ID ก็ไม่เห็นโพสต์ของแบรนด์อื่น');
    assert.deepEqual(P.rankPosts(clip, posts, { q: '6' }).map(p => p.id_post), [], 'คนละ Platform ไม่ขึ้น');
    assert.deepEqual(P.rankPosts(clip, posts, { q: '2' }).map(p => p.id_post), ['2']);
    assert.equal(P.handleOf('https://www.instagram.com/manowps.m?stkn=x'), 'manowps.m');
    assert.equal(P.handleOf('https://www.instagram.com/reel/AAA/'), null);
    assert.equal(P.handleOf('https://evil.example/x'), null);
});

test('ช่วงวันที่ดึง: 180 วันก่อน หรือ 14 วันก่อนวันลงโพสต์ (ที่เก่ากว่า)', () => {
    const today = new Date('2026-10-26T05:00:00Z');
    assert.equal(P.sinceFor('2026-10-06', today), '2026-04-29');
    assert.equal(P.sinceFor('2026-01-10', today), '2025-12-27');
    assert.equal(P.sinceFor('ไม่ใช่วันที่', today), '2026-04-29');
});

test('ดึง /posts: ส่ง key ใน header · platform / since / limit · อ่านทุกหน้า · ตอบผิดรูป = ล้ม', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url: String(url), key: opts.headers['X-PFM-API-Key'], redirect: opts.redirect });
        const u = new URL(url);
        const offset = Number(u.searchParams.get('offset'));
        const rows = offset === 0
            ? [{ platform: 'instagram', id_post: '1' }, { platform: 'instagram', id_post: '2' }, { platform: 'facebook', id_post: '3' }]
            : [{ platform: 'instagram', id_post: '2' }, { platform: 'instagram', id_post: '4' }];
        return { ok: true, json: async () => ({ status: 'success', data: { rows, has_more: offset === 0 } }) };
    };
    const posts = await P.fetchPosts({ platform: 'instagram', since: '2026-04-29' }, { fetchImpl, env: ENV });
    assert.deepEqual(posts.map(p => p.id_post), ['1', '2', '4'], 'ไม่ซ้ำ · เฉพาะ Platform ที่ขอ');
    assert.equal(calls.length, 2);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, 'http://wx.test/api/v1/integrations/kol-pfm/posts');
    assert.deepEqual([u.searchParams.get('platform'), u.searchParams.get('since'), u.searchParams.get('limit'), u.searchParams.get('offset')], ['instagram', '2026-04-29', '2000', '0']);
    assert.equal(new URL(calls[1].url).searchParams.get('offset'), '2000');
    assert.ok(calls.every(c => c.key === 'k-test' && c.redirect === 'manual'));
    await assert.rejects(P.fetchPosts({ platform: 'instagram' }, { fetchImpl: async () => ({ ok: false, status: 401 }), env: ENV }), /HTTP 401/);
    await assert.rejects(P.fetchPosts({ platform: 'instagram' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'success', data: {} }) }), env: ENV }), /invalid/);
    await assert.rejects(P.fetchPosts({ platform: 'instagram' }, { env: { ...ENV, WEBOOSTX_PFM_EXPORT_KEY: '' } }), /not configured/);
});

test('แคช: ภายในเวลาที่กำหนดไม่ถามซ้ำ · หมดเวลาถามใหม่ · ล้มแล้วไม่จำ · ของหมดเวลาถูกทิ้ง', async () => {
    let t = 0, n = 0;
    const cache = P.createPostsCache({ ttlMs: 1000, now: () => t });
    let m = 0;
    await cache.get('old', async () => { m++; return []; });
    t = 1200; await cache.get('new', async () => []);
    t = 0; await cache.get('old', async () => { m++; return []; });
    assert.equal(m, 2, 'คีย์เก่าที่หมดเวลาถูกทิ้งไปแล้ว ต้องโหลดใหม่');
    cache.clear(); t = 0;
    const load = async () => { n++; return ['x']; };
    await cache.get('k', load); await cache.get('k', load);
    assert.equal(n, 1);
    t = 1500; await cache.get('k', load);
    assert.equal(n, 2);
    await assert.rejects(cache.get('bad', async () => { throw new Error('down'); }));
    await new Promise(r => setImmediate(r));
    assert.deepEqual(await cache.get('bad', async () => ['ok']), ['ok'], 'ครั้งที่ล้มไม่ถูกจำ');
});

test('เติม ID POST แบบ fillEmpty: ช่องว่าง → เติมได้แม้ยิงแอดแล้ว + ลงชื่อคนเติม · มีค่าแล้ว → 409 ไม่เขียน · ไม่แตะสถานะตรวจโพสต์', async () => {
    current = { id: 21, project_id: 9, platform: 'Instagram', post_url: IG, id_post: null, gencode: 'adcode-x', ad_status: 'ยิงแล้ว',
        ad_spend: 300, status: 'confirmed', post_check: 'ok', post_check_by: 'ทีม', weboostx_pfm: null };
    writes.length = 0;
    await subs.update(21, null, { id_post: '18100000000000001' }, 'Fon', { fillEmpty: ['id_post'] });
    assert.equal(writes[0].id_post, '18100000000000001');
    assert.equal(writes[0].id_post_by, 'Fon');
    assert.ok(writes[0].id_post_at);
    assert.equal('post_check' in writes[0], false, 'ไม่เปลี่ยนสถานะตรวจโพสต์');
    // ยิงแอดแล้ว + แก้ปกติ (ไม่ใช่ fillEmpty) ยังโดนล็อกเหมือนเดิม
    writes.length = 0;
    await assert.rejects(subs.update(21, null, { id_post: '18100000000000001' }, 'Fon', { actor: 'team' }), e => e.status === 409 && /🔓/.test(e.message));
    // มีค่าอยู่แล้ว (มีคนกรอก / ซิงก์เติมระหว่างเปิดหน้าต่าง) → 409 ไม่เขียนทับ
    current = { ...current, id_post: '999' };
    await assert.rejects(subs.update(21, null, { id_post: '18100000000000001' }, 'Fon', { fillEmpty: ['id_post'] }), e => e.status === 409 && /มี ID POST แล้ว/.test(e.message));
    assert.equal(writes.length, 0);
    // fillEmpty ไม่ปลดล็อกช่องอื่น
    current = { ...current, id_post: null };
    await assert.rejects(subs.update(21, null, { id_post: '1', post_url: 'https://www.instagram.com/p/X/' }, 'Fon', { fillEmpty: ['id_post'] }), e => e.status === 409 && /ลิงก์คลิป/.test(e.message));
});

test('ตัวตนโพสต์: แก้ ID POST ของแถวที่มีลิงก์ → ล้างคะแนน/รูปของโพสต์เดิม (ข้อมูลอาจมาจาก ID) · เติม Gencode = ไม่แตะ · ล้าง ID ที่ซิงก์เติมเอง = ไม่แตะ', async () => {
    const studio = { weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: '/api/v1/integrations/kol-pfm/thumbnail/12',
        thumbnail_local: 'wx0123456789abcdef.jpg', thumbnail_fetched_at: '2026-10-19T08:00:00Z', thumbnail_error: null };
    current = { id: 5, project_id: 9, platform: 'Instagram', post_url: IG, id_post: '181', gencode: null, ad_status: 'ยังไม่ยิง', ad_spend: 0, status: 'confirmed', ...studio };
    writes.length = 0;
    await subs.update(5, 9, { id_post: '182' }, 'ทีม', { actor: 'team' });
    assert.equal(writes[0].weboostx_pfm, null);
    current = { id: 5, project_id: 9, platform: 'Instagram', post_url: IG, id_post: '181', gencode: null, ad_status: 'ยังไม่ยิง', ad_spend: 0, status: 'confirmed', ...studio };
    writes.length = 0;
    await subs.update(5, 9, { gencode: 'adcode-new' }, 'ทีม', { actor: 'team' });
    assert.equal('weboostx_pfm' in writes[0], false);
    // FB ที่ลิงก์จับได้ + ID ที่ซิงก์เติมเอง: ล้าง ID (หน้าเว็บรุ่นเก่าส่ง null) ไม่ใช่ตัวตนเปลี่ยน — ข้อมูลมาจากลิงก์
    current = { id: 5, project_id: 9, platform: 'Facebook', post_url: 'https://www.facebook.com/page/posts/887205877244964', id_post: '887205877244964',
        id_post_by: null, ad_synced_at: '2026-10-20T00:00:00Z', ad_status: 'ยังไม่ยิง', ad_spend: 0, status: 'confirmed', ...studio };
    writes.length = 0;
    await subs.update(5, 9, { id_post: null, post_date: '2026-10-11' }, 'ทีม', { actor: 'team' });
    assert.equal('weboostx_pfm' in writes[0], false);
});
