const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { sanitizeRow, fetchBatch, runSync } = require('../server/src/services/beauterryPfmSync');
const { shouldApplyOrganicMetrics, shouldApplyCumulativeMetric } = require('../server/src/store/metricSync');

test('Beauterry rows are limited to fields accepted by the dashboard', () => {
    assert.deepEqual(sanitizeRow({
        id_post: '7412345678901234567', views: '100', likes: 12, ad_spend: '500.25',
        paid_impressions: 999, ad_reach: 888, source_updated_at: '2026-09-15T00:00:00Z',
        unknown: 'drop me'
    }), {
        id_post: '7412345678901234567', views: 100, likes: 12, ad_spend: 500.25,
        source_updated_at: '2026-09-15T00:00:00Z', pfm_source: 'beauterry-pfm'
    });
    assert.equal(sanitizeRow({ id_post: 'not-numeric', views: 1 }), null);
});

test('source timestamps prevent old organic metrics from overwriting newer values', () => {
    assert.equal(shouldApplyOrganicMetrics('2026-09-15T00:00:00Z', null), true);
    assert.equal(shouldApplyOrganicMetrics('2026-09-15T00:00:00Z', '2026-09-14T00:00:00Z'), true);
    assert.equal(shouldApplyOrganicMetrics('2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z'), false);
    assert.equal(shouldApplyOrganicMetrics(null, '2026-09-15T00:00:00Z'), false);
});

test('PFM cumulative metrics cannot move backwards', () => {
    assert.equal(shouldApplyCumulativeMetric(100, 90, true), true);
    assert.equal(shouldApplyCumulativeMetric(90, 100, true), false);
    assert.equal(shouldApplyCumulativeMetric(0, 100, true), false);
    assert.equal(shouldApplyCumulativeMetric(90, 100, false), true);
});

test('fetchBatch authenticates and validates the Beauterry response', async () => {
    let request;
    const fetchImpl = async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ status: 'success', data: {
            rows: [{ id_post: '123', views: 42 }], not_found: ['456']
        } }) };
    };
    const result = await fetchBatch(['123', '456'], {
        fetchImpl,
        env: { ADS_SYNC_KEY: 'fixture', BEAUTERRY_PFM_BASE_URL: 'http://pfm.local/' }
    });
    assert.equal(request.url, 'http://pfm.local/api/v1/integrations/kol-pfm/metrics');
    assert.equal(request.options.headers['X-PFM-API-Key'], 'fixture');
    assert.deepEqual(JSON.parse(request.options.body), { item_ids: ['123', '456'] });
    assert.deepEqual(result.notFound, ['456']);
    assert.equal(result.rows[0].id_post, '123');
});

test('runSync requests known IDs and applies normalized rows', async () => {
    const calls = [];
    const storeImpl = { adsSync: {
        itemIds: async () => ['123'],
        apply: async rows => { calls.push(rows); return { updated: 1, stale: 0, stamped: 0 }; }
    } };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'success',
        data: { rows: [{ id_post: '123', views: 42 }], not_found: [] } }) });
    const result = await runSync({ storeImpl, fetchImpl, env: { ADS_SYNC_KEY: 'fixture' } });
    assert.equal(result.requested, 1);
    assert.equal(result.updated, 1);
    assert.equal(calls[0][0].views, 42);
});
