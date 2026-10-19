const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// KOL PFM + เกรด + path รูปปก จาก WeBoostX (19 ต.ค. 2026 · สัญญา WeBoostX2 docs/KOL_DASHBOARD_API.md ข้อ 4)
// mapping ฟิลด์ใหม่: มีค่า / null / ผิดรูป (ทิ้งเฉพาะช่อง ไม่ล้มทั้งรอบ) / ไม่ส่งมา (ไม่แตะ) · ad_* เหมือนเดิมทุกอย่าง
// ไม่ต่อฐานจริง ไม่เรียก WeBoostX จริง
process.env.NODE_ENV = 'test';
const { pool } = require('../server/src/config/db');
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
const base = require('../server/src/store/pg/_base');
let currentRows = [], writes = [];
base.query = async () => ({ rows: [] });
base.withTransaction = async fn => fn({ query: async (sql, args) => ({ rows: currentRows.filter(row => row.id === args[0]) }) });
base.updateRow = async (table, id, patch) => { writes.push({ table, id, patch }); };
const dbStore = require('../server/src/store/pg/weboostxSync');
const { sanitizeRow, patchFor, studioFields, STUDIO_COLUMNS } = require('../server/src/services/weboostxMetrics');
const sync = require('../server/src/services/weboostxPfmSync');
after(() => pool.end());

const igLink = 'https://www.instagram.com/reel/Example/';
const THUMB = '/api/v1/integrations/kol-pfm/thumbnail/1234';
const row = extra => ({ item_id: igLink, id_post: '123', platform: 'instagram', ad_spend: 10, ...extra });
const env = { WEBOOSTX_PFM_SYNC_ENABLED: 'true', WEBOOSTX_PFM_EXPORT_KEY: 'fixture-only', WEBOOSTX_PFM_BASE_URL: 'http://fixture.invalid' };
const reply = rows => ({ ok: true, json: async () => ({ status: 'success', data: { rows } }) });

test('sanitizeRow: pfm / pfm_grade / thumbnail_url มีค่า → เก็บ · ad_* เหมือนเดิม', () => {
    assert.deepEqual(sanitizeRow(row({ pfm: 7.7, pfm_grade: 'A', thumbnail_url: THUMB })),
        { item_id: igLink, platform: 'instagram', id_post: '123', ad_spend: 10, pfm: 7.7, pfm_grade: 'A', thumbnail_url: THUMB });
    assert.equal(sanitizeRow(row({ pfm: 0 })).pfm, 0);
    assert.equal(sanitizeRow(row({ pfm: 10 })).pfm, 10);
    assert.equal(sanitizeRow(row({ pfm: 7.12345 })).pfm, 7.12, 'ปัด 2 ตำแหน่งเหมือนที่ WeBoostX ส่ง');
    assert.equal(sanitizeRow(row({ pfm_grade: ' s ' })).pfm_grade, 'S');
});

test('sanitizeRow: null = เก็บ null (โพสต์ที่ยังไม่อยู่ใน KOL Studio)', () => {
    const r = sanitizeRow(row({ pfm: null, pfm_grade: null, thumbnail_url: null }));
    assert.equal(r.pfm, null);
    assert.equal(r.pfm_grade, null);
    assert.equal(r.thumbnail_url, null);
});

test('sanitizeRow: ไม่ส่งช่องใหม่มา (WeBoostX รุ่นก่อน) = ไม่มีคีย์ · รูปร่างเดิมทุกตัวอักษร', () => {
    assert.deepEqual(sanitizeRow(row()), { item_id: igLink, platform: 'instagram', id_post: '123', ad_spend: 10 });
    assert.deepEqual(studioFields({}), {});
});

test('sanitizeRow: ค่าผิดรูป = ทิ้งเฉพาะช่องนั้น แถวยังใช้ได้ (ไม่ทำให้ทั้งรอบล้ม)', () => {
    for (const pfm of [11, -1, '7.7', NaN, Infinity, true, {}, []]) {
        const r = sanitizeRow(row({ pfm }));
        assert.ok(r, 'แถวต้องยังผ่าน: ' + String(pfm));
        assert.equal('pfm' in r, false, 'pfm ' + String(pfm));
        assert.equal(r.ad_spend, 10);
    }
    for (const g of ['E', 'AA', '', 7, true]) assert.equal('pfm_grade' in sanitizeRow(row({ pfm_grade: g })), false, 'grade ' + g);
    for (const t of [
        'https://weboostx2.wejlc.com' + THUMB, '//evil.example' + THUMB, THUMB + '?x=1', THUMB + '#a',
        '/api/v1/integrations/kol-pfm/thumbnail/abc', '/api/v1/integrations/kol-pfm/thumbnail/../status',
        '/api/v1/integrations/kol-pfm/thumbnail/', 'api/v1/integrations/kol-pfm/thumbnail/1', 12, true
    ]) assert.equal('thumbnail_url' in sanitizeRow(row({ thumbnail_url: t })), false, 'thumb ' + t);
});

test('fetchBatch: แถวที่มีช่องใหม่ผิดรูปไม่ทำให้ทั้งชุดล้ม', async () => {
    const rows = await sync.fetchBatch([igLink], { env, fetchImpl: async () => reply([row({ pfm: 'bad', pfm_grade: 'Z', thumbnail_url: 'http://x' })]) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ad_spend, 10);
});

test('patchFor: เขียนลงคอลัมน์ weboostx_* · ค่าเท่าเดิมไม่เขียนซ้ำ · เปลี่ยน = เขียนทับ (ขึ้นลงได้) · null = เก็บ null', () => {
    const r = sanitizeRow(row({ pfm: 7.7, pfm_grade: 'A', thumbnail_url: THUMB }));
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10 }, r),
        { weboostx_pfm: 7.7, weboostx_pfm_grade: 'A', weboostx_thumbnail_path: THUMB });
    // NUMERIC ในฐานมาเป็นสตริง '7.70' = ค่าเดียวกัน ไม่ต้องเขียน
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10, weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: THUMB }, r), {});
    // คะแนนลดลง / เกรดเปลี่ยน / path ใหม่ — เขียนทับ (ไม่ใช่แบบค่าแอดที่รับเฉพาะค่าที่สูงขึ้น)
    const down = sanitizeRow(row({ pfm: 3.1, pfm_grade: 'C', thumbnail_url: '/api/v1/integrations/kol-pfm/thumbnail/99' }));
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10, weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: THUMB }, down),
        { weboostx_pfm: 3.1, weboostx_pfm_grade: 'C', weboostx_thumbnail_path: '/api/v1/integrations/kol-pfm/thumbnail/99' });
    // null จาก WeBoostX = เก็บ null
    const gone = sanitizeRow(row({ pfm: null, pfm_grade: null, thumbnail_url: null }));
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10, weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: THUMB }, gone),
        { weboostx_pfm: null, weboostx_pfm_grade: null, weboostx_thumbnail_path: null });
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10, weboostx_pfm: null, weboostx_pfm_grade: null, weboostx_thumbnail_path: null }, gone), {});
    // ไม่ส่งมาเลย = ไม่แตะของเดิม
    assert.deepEqual(patchFor({ id_post: '123', ad_spend: 10, weboostx_pfm: '7.70' }, sanitizeRow(row())), {});
});

test('patchFor: path รูปเปลี่ยนไม่ล้างสำเนาเดิม (thumbnail_local) — รูปเก่าโชว์ต่อจนได้รูปใหม่', () => {
    const p = patchFor({ id_post: '123', weboostx_thumbnail_path: THUMB, thumbnail_local: 'wx0123456789abcdef.jpg' },
        sanitizeRow(row({ thumbnail_url: '/api/v1/integrations/kol-pfm/thumbnail/77' })));
    assert.equal('thumbnail_local' in p, false);
    assert.equal('thumbnail_error' in p, false);
});

test('patchFor: ad_* ไม่เปลี่ยนความหมาย และไม่ map ad_* ลงช่อง organic ต่อให้มีช่องใหม่มาด้วย', () => {
    const r = sanitizeRow(row({ ad_spend: 20, ad_reach: 900, ad_launched: true, first_ad_date: '2026-10-01', ad_likes: 50, ad_video_views: 9000,
        pfm: 6.2, pfm_grade: 'A', thumbnail_url: THUMB }));
    const p = patchFor({ id_post: '', ad_spend: 25, ad_reach: 100, ad_status: 'ยังไม่ยิง' }, r);
    assert.equal('ad_spend' in p, false, 'ค่าแอดลดลงไม่รับ (เหมือนเดิม)');
    assert.equal(p.ad_reach, 900);
    assert.equal(p.id_post, '123');
    assert.equal(p.ad_end, '2026-10-01');
    assert.equal(p.ad_status, 'ยิงแล้ว');
    for (const k of ['views', 'likes', 'comments', 'shares', 'saves', 'perf_synced_at']) assert.equal(k in p, false, k);
});

test('apply: ฐานยังไม่มีคอลัมน์ใหม่ (ยังไม่ setup-db) = ตัดช่องใหม่ทิ้ง ค่าแอดยังเขียนได้ · มีคอลัมน์ = เขียนครบ', async () => {
    const r = { ...sanitizeRow(row({ ad_spend: 30, pfm: 8.4, pfm_grade: 'S', thumbnail_url: THUMB })), submission_id: 1 };
    currentRows = [{ id: 1, platform: 'Instagram', post_url: igLink, ad_spend: 5, sync_brand: 'Jernis', sync_campaign_type: 'kol', budget: 0 }];
    writes = [];
    let res = await dbStore.apply([r]);
    assert.equal(res.updated, 1);
    assert.equal(writes[0].patch.ad_spend, 30);
    for (const k of STUDIO_COLUMNS) assert.equal(k in writes[0].patch, false, k);
    currentRows = [{ ...currentRows[0], weboostx_pfm: null, weboostx_pfm_grade: null, weboostx_thumbnail_path: null, thumbnail_local: null }];
    writes = [];
    res = await dbStore.apply([r]);
    assert.equal(writes[0].patch.weboostx_pfm, 8.4);
    assert.equal(writes[0].patch.weboostx_pfm_grade, 'S');
    assert.equal(writes[0].patch.weboostx_thumbnail_path, THUMB);
    assert.equal(writes[0].patch.ad_spend, 30);
});

test('runSync: ช่องใหม่ไปถึง store.apply ครบ (จับคู่ด้วย item_id + platform เหมือนเดิม) · แบรนด์ใหม่ไม่ต้อง hardcode', async () => {
    const applied = [];
    const result = await sync.runSync({ env,
        storeImpl: { items: async () => [{ submission_id: 7, platform: 'instagram', item_id: igLink }, { submission_id: 8, platform: 'instagram', item_id: igLink }],
            apply: async rows => { applied.push(...rows); return { updated: rows.length }; } },
        fetchImpl: async () => reply([row({ pfm: 5, pfm_grade: 'B', thumbnail_url: THUMB, brand_code: 'JERNIS' })]) });
    assert.equal(result.updated, 2);
    assert.deepEqual(applied.map(a => [a.submission_id, a.pfm, a.pfm_grade, a.thumbnail_url]), [[7, 5, 'B', THUMB], [8, 5, 'B', THUMB]]);
    assert.equal('brand_code' in applied[0], false, 'ไม่ได้ใช้ brand_code จับคู่');
});
