const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.NODE_ENV = 'test';
const { pool } = require('../server/src/config/db');
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
const base = require('../server/src/store/pg/_base');
let currentRows = [], writes = [], itemRows = [];
base.query = async () => ({ rows: itemRows });
base.withTransaction = async fn => fn({ query: async (sql, args) => {
    assert.match(sql, /FOR UPDATE OF s/);
    return { rows: currentRows.filter(row => row.id === args[0]) };
} });
base.updateRow = async (table, id, patch) => { writes.push({ table, id, patch }); };
const dbStore = require('../server/src/store/pg/weboostxSync');
const { itemIdFor, sanitizeRow, patchFor } = require('../server/src/services/weboostxMetrics');
const sync = require('../server/src/services/weboostxPfmSync');
const env = { WEBOOSTX_PFM_SYNC_ENABLED: 'true', WEBOOSTX_PFM_EXPORT_KEY: 'fixture-only',
    WEBOOSTX_PFM_BASE_URL: 'http://fixture.invalid' };
const reply = rows => ({ ok: true, json: async () => ({ status: 'success', data: { rows } }) });
const igLink = 'https://www.instagram.com/reel/Example/';
const metric = extra => ({ item_id: igLink, id_post: '123', platform: 'instagram', ad_spend: 10, ...extra });
after(() => pool.end());

test('identity accepts IG posts and FB compound IDs, not TikTok or profile links', () => {
    assert.equal(itemIdFor({ platform: 'Instagram', post_url: igLink }), igLink);
    assert.equal(itemIdFor({ platform: 'Facebook', id_post: '111_222' }), '111_222');
    assert.equal(itemIdFor({ platform: 'Facebook', post_url: 'https://www.facebook.com/permalink.php?story_fbid=222&id=111' }), 'https://www.facebook.com/permalink.php?story_fbid=222&id=111');
    assert.equal(itemIdFor({ platform: 'TikTok', id_post: '123' }), null);
    assert.equal(itemIdFor({ platform: 'Instagram', post_url: 'https://instagram.com/person/' }), null);
    assert.equal(itemIdFor({ platform: 'Instagram', post_url: 'https://instagram.com.attacker.invalid/p/x/' }), null);
});
test('Instagram plural reels and username post URLs retain the original link', () => {
    for (const link of ['https://www.instagram.com/reels/Dd0row-P0Up/',
        'https://instagram.com/creator/reel/Example/?igsh=abc', 'https://instagram.com/creator/p/Example/']) {
        assert.equal(itemIdFor({ platform: 'Instagram', post_url: link }), link);
    }
    assert.equal(itemIdFor({ platform: 'Instagram', post_url: 'https://instagram.com/reels/Example/extra' }), null);
});
test('paid metrics omit organic and paid-engagement fields; null reach stays unknown', () => {
    const row = sanitizeRow(metric({ views: 999, likes: 555, ad_likes: 444, ad_reach: null, ad_launched: true }));
    assert.deepEqual(row, { item_id: igLink, platform: 'instagram', id_post: '123', ad_spend: 10, ad_launched: true });
    assert.equal(sanitizeRow(metric({ ad_spend: -1 })).ad_spend, undefined);
    assert.equal(sanitizeRow(metric({ id_post: 'bad' })), null);
    assert.equal(sanitizeRow(metric({ first_ad_date: '2026-02-30' })).first_ad_date, undefined);
});
test('attached ads with zero spend do not mean fired', () => {
    assert.equal(sanitizeRow(metric({ ad_spend: 0, ad_created: true, ad_launched: true })).ad_launched, undefined);
});
test('patch preserves lifetime totals, existing post ID, dates and organic fields', () => {
    const old = { id_post: '789', ad_spend: 50, ad_reach: 100, ad_end: '2026-09-01', views: 700 };
    assert.deepEqual(patchFor(old, sanitizeRow(metric({ ad_reach: 90, first_ad_date: '2026-10-01' }))), {});
    assert.deepEqual(patchFor({ ad_spend: 0, ad_reach: 0 }, sanitizeRow(metric({ ad_reach: 70 }))),
        { ad_spend: 10, ad_reach: 70, id_post: '123' });
});
test('disabled by default; never falls back to other service credentials', () => {
    assert.equal(sync.config({}).enabled, false);
    assert.equal(sync.config({ ADS_SYNC_KEY: 'a', BEAUTERRY_PFM_EXPORT_KEY: 'b' }).apiKey, '');
    assert.equal(sync.config({ WEBOOSTX_PFM_SYNC_INTERVAL_SECONDS: 'bad' }).intervalMs, 3600000);
});
test('fetch uses machine header, original identifiers and bounded timeout', async () => {
    let request;
    const rows = await sync.fetchBatch([igLink], { env, fetchImpl: async (url, options) => {
        request = { url, options }; return reply([metric()]);
    } });
    assert.equal(request.url, 'http://fixture.invalid/api/v1/integrations/kol-pfm/metrics');
    assert.equal(request.options.headers['X-PFM-API-Key'], env.WEBOOSTX_PFM_EXPORT_KEY);
    assert.deepEqual(JSON.parse(request.options.body), { item_ids: [igLink] });
    assert.ok(request.options.signal);
    assert.equal(rows.length, 1);
});
test('fetch rejects HTTP errors, unexpected IDs, duplicate rows and malformed payloads', async () => {
    for (const response of [ { ok: false, status: 401 }, reply([metric({ item_id: 'unexpected' })]),
        reply([metric(), metric()]), reply([metric({ platform: 'tiktok' })]),
        { ok: true, json: async () => ({ status: 'success', data: {} }) } ]) {
        await assert.rejects(sync.fetchBatch([igLink], { env, fetchImpl: async () => response }));
    }
});
test('runSync matches original item_id AND platform, and maps to exact submission IDs', async () => {
    let applied;
    const storeImpl = { items: async () => [
        { submission_id: 1, platform: 'instagram', item_id: igLink },
        { submission_id: 2, platform: 'facebook', item_id: igLink },
        { submission_id: 3, platform: 'instagram', item_id: 'missing' }
    ], apply: async rows => { applied = rows; return { updated: rows.length }; } };
    const result = await sync.runSync({ env, storeImpl, fetchImpl: async () => reply([metric()]) });
    assert.equal(applied.length, 1);
    assert.equal(applied[0].submission_id, 1);
    assert.deepEqual(result.source_not_found, [2, 3]);
    assert.equal(result.updated, 1);
});
test('unconfigured sync does not access the database or network', async () => {
    const result = await sync.runSync({ env: {}, storeImpl: { items: async () => assert.fail('must not query') } });
    assert.equal(result.reason, 'disabled_or_unconfigured');
});
test('single-flight skips overlapping runs and recovers after failure', async () => {
    let release;
    const pending = sync.runSync({ env, storeImpl: { items: () => new Promise(resolve => { release = resolve; }) } });
    assert.equal((await sync.runSync({ env })).reason, 'already_running');
    release([]); await pending;
    await assert.rejects(sync.runSync({ env, storeImpl: { items: async () => { throw new Error('fixture failure'); } } }));
    assert.equal(sync.getStatus(env).running, false);
    assert.equal(sync.getStatus(env).last_run.status, 'error');
    assert.equal('apiKey' in sync.getStatus(env), false);
});
test('candidate query excludes rows without a supported identity', async () => {
    itemRows = [{ id: 1, platform: 'Instagram', post_url: igLink }, { id: 2, platform: 'Instagram' }];
    assert.deepEqual(await dbStore.items(), [{ submission_id: 1, platform: 'instagram', item_id: igLink }]);
});
test('store locks current row and does not write if a person changed the link/platform', async () => {
    currentRows = [{ id: 1, platform: 'Instagram', post_url: 'https://instagram.com/p/Changed/' },
        { id: 2, platform: 'TikTok', id_post: '123' }]; writes = [];
    const result = await dbStore.apply([{ ...metric(), submission_id: 1 }, { ...metric(), submission_id: 2 }]);
    assert.equal(result.skipped, 2); assert.equal(writes.length, 0);
});
test('store writes only paid fields and never overwrites original organic metrics', async () => {
    currentRows = [{ id: 1, platform: 'Instagram', post_url: igLink, ad_spend: 5, ad_reach: 90,
        views: 500, likes: 20, sync_brand: 'Beauterry', sync_campaign_type: 'kol', budget: 0 }]; writes = [];
    const result = await dbStore.apply([{ ...sanitizeRow(metric({ ad_reach: null })), submission_id: 1 }]);
    assert.equal(result.updated, 1);
    assert.equal(writes[0].patch.ad_spend, 10);
    assert.equal(writes[0].patch.id_post, '123');
    for (const field of ['views', 'likes', 'comments', 'shares', 'saves', 'perf_synced_at', 'ad_reach']) {
        assert.equal(field in writes[0].patch, false);
    }
});
test('new status/manual-pull endpoints require the dashboard inbound key', async () => {
    const express = require('../server/node_modules/express');
    const app = express(); app.use('/api/ads-sync', require('../server/src/routes/adsSync'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/ads-sync`;
    const oldKey = process.env.ADS_SYNC_KEY;
    try {
        delete process.env.ADS_SYNC_KEY;
        assert.equal((await fetch(url + '/weboostx-status')).status, 503);
        process.env.ADS_SYNC_KEY = 'inbound-fixture';
        assert.equal((await fetch(url + '/weboostx-status')).status, 401);
        assert.equal((await fetch(url + '/pull-weboostx', { method: 'POST' })).status, 401);
        assert.equal((await fetch(url + '/weboostx-status', { headers: { 'X-Ads-Sync-Key': 'inbound-fixture' } })).status, 200);
    } finally {
        if (oldKey === undefined) delete process.env.ADS_SYNC_KEY; else process.env.ADS_SYNC_KEY = oldKey;
        await new Promise(resolve => server.close(resolve));
    }
});
