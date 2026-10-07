const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const SRC = path.join(__dirname, '../server/src');
const evidence = require(path.join(SRC, 'store/performanceSources'));
const { maybeStamp, stampWaitReason } = require(path.join(SRC, 'store/logic'));
let row, writes, beforeLock;
const basePath = path.join(SRC, 'store/pg/_base.js');
const snapshotPath = path.join(SRC, 'store/pg/_snapshot.js');
const query = async (sql, params) => {
    if (/FOR UPDATE OF s/.test(sql)) {
        assert.match(sql, /ORDER BY s.id FOR UPDATE OF s/);
        if (beforeLock) { beforeLock(); beforeLock = null; }
        return { rows: [{ ...structuredClone(row), sync_brand: 'Beauterry', sync_campaign_type: 'kol' }] };
    }
    if (/SELECT \* FROM submissions.*FOR UPDATE/.test(sql)) return { rows: [structuredClone(row)] };
    if (/SELECT brand, campaign_type FROM projects/.test(sql)) return { rows: [{ brand: 'Beauterry', campaign_type: 'kol' }] };
    throw new Error('Unexpected SQL in isolated test: ' + sql);
};
require.cache[basePath] = { id: basePath, filename: basePath, loaded: true, exports: {
    query: async () => { throw new Error('Unmocked query'); },
    withTransaction: async fn => fn({ query }),
    updateRow: async (table, id, patch) => {
        writes.push(structuredClone(patch));
        Object.assign(row, patch);
        for (const k of ['perf_sources', 'perf_stamp']) if (typeof row[k] === 'string') row[k] = JSON.parse(row[k]);
        return structuredClone(row);
    },
    asJson: v => JSON.stringify(v), asNum: (v, fallback) => Number(v) || fallback,
    asBool: Boolean, asText: v => v || null
} };
require.cache[snapshotPath] = { id: snapshotPath, filename: snapshotPath, loaded: true, exports: {
    loadSnapshot: async () => { throw new Error('Sync must not read a pre-lock snapshot'); }
} };
const { adsSync } = require(path.join(SRC, 'store/pg/ads'));
const submissions = require(path.join(SRC, 'store/pg/submissions'));
const apiRow = (over = {}) => ({ id_post: '7600000000000000001', pfm_source: 'beauterry-pfm',
    views: 2000, likes: 200, comments: 10, saves: 5, shares: 5,
    source_updated_at: new Date().toISOString(), organic_metrics_status: 'available', ...over });
beforeEach(() => {
    row = { id: 1, project_id: 1, platform: 'TikTok', id_post: '7600000000000000001',
        budget: 3000, ad_spend: 0, ad_reach: 0, views: 1000, likes: 100, comments: 10,
        saves: 0, shares: 0, reposts: 0, perf_stamp: null, perf_sources: null };
    writes = []; beforeLock = null;
});

test('manual save committed before sync acquires its lock is preserved with its original stamp', async () => {
    beforeLock = () => {
        row.views = 9000;
        row.perf_sources = evidence.manualEvidence(row, {}, 'editor', new Date().toISOString());
        row.perf_stamp = { at: 'existing-manual-stamp', views: 9000 };
    };
    await adsSync.apply([apiRow({ views: 12000, ad_spend: 5000, ad_reach: 3000 })]);
    assert.equal(row.views, 9000, 'even a larger incoming API counter must not replace selected manual data');
    assert.equal(row.ad_spend, 5000);
    assert.equal(row.ad_reach, 3000);
    assert.deepEqual(row.perf_stamp, { at: 'existing-manual-stamp', views: 9000 });
    assert.equal(row.perf_sources.manual.metrics.views, 9000);
    assert.equal(row.perf_sources.api.metrics.views, 12000);
});

test('snapshot-only or unavailable counters do not replace values or create a stamp', async () => {
    for (const status of ['snapshot_only', 'source_unavailable', 'pending', 'source_not_found']) {
        row.perf_sources = null;
        const result = await adsSync.apply([apiRow({ organic_metrics_status: status, ad_spend: 5000 })]);
        assert.equal(row.views, 1000);
        assert.equal(row.perf_stamp, null);
        assert.equal(result.stamped, 0);
        assert.equal(stampWaitReason(row, 3000, 'kol'), 'source');
    }
});

test('missing clip evidence persists without synthesizing zero counters', async () => {
    await adsSync.apply([{ id_post: row.id_post, pfm_source: 'beauterry-pfm', organic_metrics_status: 'source_not_found' }]);
    assert.equal(row.perf_sources.api.status, 'source_not_found');
    assert.deepEqual(row.perf_sources.api.metrics, {});
    assert.equal(row.views, 1000);
});

test('manual form rejects a changed baseline under the same row lock', async () => {
    const before = evidence.metricsOf(row);
    row.views = 3000;
    await assert.rejects(submissions.update(1, 1, { views: 9000, perf_from: before }, 'editor'), { status: 409 });
    assert.equal(writes.length, 0);
    assert.equal(row.views, 3000);
});

test('manual entry records its own timestamp and leaves API evidence and source time separate', async () => {
    await adsSync.apply([apiRow()]);
    const api = structuredClone(row.perf_sources.api);
    const synced = row.perf_synced_at;
    await submissions.update(1, 1, { views: 9000, likes: undefined, perf_from: evidence.metricsOf(row) }, 'editor');
    assert.equal(row.perf_sources.mode, 'manual');
    assert.equal(row.perf_sources.manual.metrics.views, 9000);
    assert.equal(row.perf_sources.manual.by, 'editor');
    assert.equal(row.perf_sources.manual.metrics.likes, 200, 'undefined route fields preserve current counters');
    assert.equal(row.perf_synced_at, synced);
    assert.deepEqual(row.perf_sources.api, api);
});

test('explicit selection uses API counters even if lower, keeps manual evidence and existing stamp', async () => {
    await adsSync.apply([apiRow()]);
    await submissions.update(1, 1, { views: 9000 }, 'editor');
    row.perf_stamp = { at: 'historical', views: 9000 };
    const original = structuredClone(row.perf_stamp);
    await submissions.update(1, 1, { perf_mode: 'api', perf_from: evidence.metricsOf(row) }, 'editor');
    assert.equal(row.views, 2000);
    assert.equal(row.perf_sources.mode, 'api');
    assert.equal(row.perf_sources.manual.metrics.views, 9000);
    assert.deepEqual(row.perf_stamp, original);
});

test('API selection refuses missing, incomplete, unavailable and expired evidence', async () => {
    assert.equal(evidence.apiSelection(row), null);
    await adsSync.apply([apiRow()]);
    for (const state of [
        { ...row.perf_sources.api, status: 'snapshot_only' },
        { ...row.perf_sources.api, metrics: { views: 100 } },
        { ...row.perf_sources.api, observed_at: new Date(Date.now() - 3 * 3600000).toISOString() }
    ]) {
        row.perf_sources.api = state;
        await assert.rejects(submissions.update(1, 1, { perf_mode: 'api' }), { status: 409 });
    }
});

test('API evidence for a different post cannot be selected after an identity edit', async () => {
    await adsSync.apply([apiRow()]);
    row.id_post = '7600000000000000002';
    assert.equal(evidence.apiSelection(row), null);
    await assert.rejects(submissions.update(1, 1, { perf_mode: 'api' }), { status: 409 });
});

test('negative or invalid manual counters do not save or stamp', async () => {
    for (const views of [-1, NaN, 1.5]) await assert.rejects(submissions.update(1, 1, { views }), { status: 400 });
    assert.equal(writes.length, 0);
});

test('Reach optimistic comparison also runs inside the write lock', async () => {
    row.ad_reach = 3000;
    await assert.rejects(submissions.update(1, null, { ad_reach: 2000, ad_reach_from: 1000 }), { status: 409 });
    assert.equal(row.ad_reach, 3000);
    assert.equal(writes.length, 0);
});

test('an expired API observation blocks a new stamp, an explicit manual observation can stamp', () => {
    row.ad_spend = 5000;
    row.perf_sources = evidence.recordApi(null, apiRow(), new Date(Date.now() - 3 * 3600000).toISOString());
    assert.equal(maybeStamp(row, 3000, 'kol'), null);
    row.perf_sources = evidence.manualEvidence(row, {}, 'editor', new Date().toISOString());
    assert.equal(maybeStamp(row, 3000, 'kol').metric_source, 'manual');
});

test('client labels missing counters, manual overrides and source-record timestamps accurately', async () => {
    const web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/performanceSources.js')).href);
    row.perf_sources = evidence.recordApi(null, apiRow({ organic_metrics_status: 'snapshot_only' }), new Date().toISOString());
    assert.equal(web.performanceSourceInfo(row).label, 'ยอดเดิมจากต้นทาง');
    assert.equal(web.canSelectApi(row.perf_sources), false);
    row.perf_sources = evidence.manualEvidence(row, {}, 'editor', new Date().toISOString());
    assert.equal(web.performanceSourceInfo(row).label, 'ใช้ค่ากรอกเอง');
    assert.deepEqual(web.performanceBaseline(row), evidence.metricsOf(row));
    row.perf_sources.api.status = 'available';
    assert.equal(web.canSelectApi(row.perf_sources), Boolean(evidence.apiSelection(row)));
});

test('isolated collection updates evidence only and explicit review freezes the selected copy', async () => {
    const { tiktokEvidence } = require(path.join(SRC, 'store/pg/tiktokEvidence'));
    row.perf_stamp = { at: 'historical', views: 1000 };
    row.perf_sources = evidence.manualEvidence(row, {}, 'editor', new Date().toISOString());
    const original = structuredClone(row);
    const incoming = { id_post: row.id_post, status: 'available', collected_at: new Date(Date.now() - 1000).toISOString(),
        metrics: { views: 2000, likes: 20, comments: 0, saves: 0, shares: 5 }, ad_spend: 99999 };
    await tiktokEvidence.apply([incoming]);
    assert.deepEqual(Object.keys(writes[0]), ['perf_sources']);
    for (const key of ['views', 'likes', 'comments', 'saves', 'shares', 'ad_spend', 'ad_reach', 'perf_stamp']) assert.deepEqual(row[key], original[key]);
    assert.deepEqual(row.perf_sources.manual, original.perf_sources.manual);
    const chosenId = row.perf_sources.tiktok_evidence.evidence_id;
    await assert.rejects(submissions.update(1, 1, { perf_mode: 'isolated', perf_evidence_from: 'changed', perf_from: evidence.metricsOf(row) }), { status: 409 });
    await submissions.update(1, 1, { perf_mode: 'isolated', perf_evidence_from: chosenId, perf_from: evidence.metricsOf(row) }, 'editor');
    assert.equal(row.views, 2000); assert.equal(row.perf_sources.mode, 'manual');
    assert.equal(row.perf_sources.manual.origin.evidence_id, chosenId);
    assert.deepEqual(row.perf_stamp, original.perf_stamp);
    await adsSync.apply([apiRow({ views: 5000, ad_spend: 5000 })]);
    assert.equal(row.views, 2000); assert.equal(row.ad_spend, 5000);
    assert.equal(row.perf_sources.tiktok_evidence.evidence_id, chosenId);
});
