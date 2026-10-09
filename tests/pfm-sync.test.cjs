const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { config, sanitizeRow, fetchBatch, runSync, getOrganicMetricStatus } = require('../server/src/services/beauterryPfmSync');
const { shouldApplyOrganicMetrics, shouldApplyCumulativeMetric } = require('../server/src/store/metricSync');

test('Beauterry rows are limited to fields accepted by the dashboard', () => {
    assert.deepEqual(sanitizeRow({
        id_post: '7412345678901234567', views: '100', likes: 12, ad_spend: '500.25',
        paid_impressions: 999, ad_reach: 888, source_updated_at: '2026-09-15T00:00:00Z',
        unknown: 'drop me'
    }), {
        id_post: '7412345678901234567', views: 100, likes: 12, ad_spend: 500.25, ad_reach: 888,
        source_updated_at: '2026-09-15T00:00:00Z', pfm_source: 'beauterry-pfm'
    });
    assert.equal(sanitizeRow({ id_post: 'not-numeric', views: 1 }), null);
});

test('first_ad_date passes through only as a YYYY-MM-DD date', () => {
    assert.equal(sanitizeRow({ id_post: '1', first_ad_date: '2026-09-25' }).first_ad_date, '2026-09-25');
    assert.equal(sanitizeRow({ id_post: '1', first_ad_date: '25/09/2026' }).first_ad_date, undefined);
    assert.equal(sanitizeRow({ id_post: '1', first_ad_date: '2026-13-45' }).first_ad_date, undefined);
    assert.equal(sanitizeRow({ id_post: '1' }).first_ad_date, undefined);
});

test('organic source diagnostics accept only known statuses and do not invent metrics', async () => {
    const row = sanitizeRow({ id_post: '123', ad_spend: 462.15, organic_metrics_status: 'source_unavailable' });
    assert.equal(row.organic_metrics_status, 'source_unavailable');
    assert.equal(row.views, undefined);
    assert.equal(sanitizeRow({ id_post: '123', organic_metrics_status: 'unknown' }).organic_metrics_status, undefined);
    await runSync({
        env: { BEAUTERRY_PFM_EXPORT_KEY: 'fixture' },
        storeImpl: { adsSync: { itemIds: async () => ['123'], apply: async () => ({ updated: 1 }) } },
        fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'success', data: { rows: [row], not_found: [] } }) })
    });
    assert.equal(getOrganicMetricStatus('123'), 'source_unavailable');
    assert.equal(getOrganicMetricStatus('not-exported'), null);
});

test('paid reach preserves unknown values and never uses impressions as reach', () => {
    for (const value of [null, undefined, '', -1, 'NaN']) {
        assert.equal(sanitizeRow({ id_post: '1', ad_reach: value }).ad_reach, undefined);
    }
    assert.equal(sanitizeRow({ id_post: '1', ad_reach: '11691' }).ad_reach, 11691);
    assert.equal(sanitizeRow({ id_post: '1', paid_impressions: 12043 }).ad_reach, undefined);
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

test('Beauterry PFM sync never reuses the dashboard inbound key', () => {
    assert.equal(config({ ADS_SYNC_KEY: 'legacy-only' }).apiKey, '');
    assert.equal(config({ BEAUTERRY_PFM_EXPORT_KEY: 'pfm-key' }).apiKey, 'pfm-key');
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
        env: { BEAUTERRY_PFM_EXPORT_KEY: 'fixture', BEAUTERRY_PFM_BASE_URL: 'http://pfm.local/' }
    });
    assert.equal(request.url, 'http://pfm.local/api/v1/integrations/kol-pfm/metrics');
    assert.equal(request.options.headers['X-PFM-API-Key'], 'fixture');
    assert.deepEqual(JSON.parse(request.options.body), { item_ids: ['123', '456'] });
    assert.deepEqual(result.notFound, ['456']);
    assert.equal(result.rows[0].id_post, '123');
});

test('runSync requests known IDs and applies normalized rows', async () => {
    const calls = [];
    // 9 ต.ค. 2026 ถามทีละแบรนด์ — fixture นี้มีแต่คลิป Beauterry (Jarvit / Jernis ว่าง = ไม่ยิงคำขอ)
    const storeImpl = { adsSync: {
        itemIds: async brands => (brands[0] === 'Beauterry' ? ['123'] : []),
        apply: async (rows, opts) => { calls.push(rows); assert.deepEqual(opts, { brands: ['Beauterry'] }); return { updated: 1, stale: 0, stamped: 0 }; }
    } };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'success',
        data: { rows: [{ id_post: '123', views: 42 }], not_found: [] } }) });
    const result = await runSync({ storeImpl, fetchImpl, env: {
        BEAUTERRY_PFM_EXPORT_KEY: 'fixture',
        BEAUTERRY_PFM_BASE_URL: 'http://pfm.local'
    } });
    assert.equal(result.requested, 1);
    assert.equal(result.updated, 1);
    assert.equal(calls[0][0].views, 42);
});

test('ad_launched passes through only as true', () => {
    assert.equal(sanitizeRow({ id_post: '1', ad_launched: true }).ad_launched, true);
    assert.equal(sanitizeRow({ id_post: '1', ad_launched: 'true' }).ad_launched, undefined);
    assert.equal(sanitizeRow({ id_post: '1', ad_launched: false }).ad_launched, undefined);
});

test('fetchBatch rejects unsolicited, duplicate, contradictory or incomplete post identities', async () => {
    for (const data of [
        { rows: [{ id_post: '2' }], not_found: [] },
        { rows: [{ id_post: '1' }, { id_post: '1' }], not_found: [] },
        { rows: [{ id_post: '1' }], not_found: ['1'] },
        { rows: [], not_found: [] }
    ]) {
        await assert.rejects(fetchBatch(['1'], {
            env: { BEAUTERRY_PFM_EXPORT_KEY: 'fixture' },
            fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'success', data }) })
        }), /response/);
    }
});

// ===== PFM หลายแบรนด์ (9 ต.ค. 2026 · สเปก beauterry-pfm docs/kol-pfm-integration-api.md "Choosing the brand") =====
const ENV = { BEAUTERRY_PFM_EXPORT_KEY: 'fixture', BEAUTERRY_PFM_BASE_URL: 'http://pfm.local' };
const okJson = (payload) => ({ ok: true, json: async () => payload });
const { getStatus, syncSummaryLine } = require('../server/src/services/beauterryPfmSync');

test('fetchBatch: Beauterry ไม่ใส่ ?brand (เหมือนเดิม) · แบรนด์อื่นใส่ ?brand=<รหัส> · คำตอบต้องบอกแบรนด์ตรง', async () => {
    const urls = [];
    const fetchImpl = brand => async url => { urls.push(url); return okJson({ status: 'success', ...(brand === undefined ? {} : { brand }), data: { rows: [{ id_post: '1', views: 1 }], not_found: [] } }); };
    // Beauterry: PFM รุ่นก่อนไม่ส่ง brand ก็ยังรับ · ส่ง 'beauterry' (ตัวพิมพ์ใดก็ได้) ก็รับ
    await fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl(undefined) });
    await fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl('Beauterry'), brandCode: 'beauterry' });
    assert.deepEqual(urls, ['http://pfm.local/api/v1/integrations/kol-pfm/metrics', 'http://pfm.local/api/v1/integrations/kol-pfm/metrics']);
    // แบรนด์อื่น: ใส่ ?brand · ต้องได้ brand ตรง
    const r = await fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl('jarvit'), brandCode: 'jarvit' });
    assert.equal(urls.at(-1), 'http://pfm.local/api/v1/integrations/kol-pfm/metrics?brand=jarvit');
    assert.equal(r.rows[0].views, 1);
    // ไม่บอกแบรนด์ (PFM รุ่นก่อนไม่รู้จัก ?brand จะส่งข้อมูล Beauterry มา) / บอกแบรนด์อื่น = ไม่รับอะไรเลย
    await assert.rejects(fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl(undefined), brandCode: 'jarvit' }), /brand "\(none\)" for "jarvit"/);
    await assert.rejects(fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl('beauterry'), brandCode: 'jernis' }), /brand "beauterry" for "jernis"/);
    await assert.rejects(fetchBatch(['1'], { env: ENV, fetchImpl: fetchImpl('jarvit') }), /brand "jarvit" for "beauterry"/, 'Beauterry ได้ข้อมูลแบรนด์อื่นก็ไม่รับ');
    // รหัสแปลก ๆ ไม่ถูกส่งออกไปเลย
    for (const bad of ['a b', 'x&brand=beauterry', 'จาร์วิท', '']) {
        if (bad === '') continue;   // ค่าว่าง = beauterry
        await assert.rejects(fetchBatch(['1'], { env: ENV, brandCode: bad, fetchImpl: async () => { throw new Error('must not call PFM'); } }), /brand code is invalid/);
    }
});

test('runSync หลายแบรนด์: ถามทีละแบรนด์ · ลงเฉพาะคลิปแบรนด์นั้น · แบรนด์หนึ่งพังไม่ลาก Beauterry (partial) · พังหมด = error', async () => {
    const IDS = { Beauterry: ['11', '12'], Jarvit: ['21'], Jernis: ['31'] };
    const applied = [];
    const storeImpl = { adsSync: {
        itemIds: async brands => { assert.equal(brands.length, 1, 'ถามทีละแบรนด์'); return IDS[brands[0]] || []; },
        apply: async (rows, opts) => { applied.push({ ids: rows.map(r => r.id_post), brands: opts.brands }); return { updated: rows.length, stale: 0, stamped: 0 }; }
    } };
    const asked = [];
    // Jarvit: PFM ยังไม่รู้จักแบรนด์ (ตอบ Beauterry ไม่มี brand) · Beauterry / Jernis ปกติ
    const fetchImpl = async (url, options) => {
        const code = (String(url).match(/[?&]brand=([a-z]+)/) || [])[1] || 'beauterry';
        const ids = JSON.parse(options.body).item_ids;
        asked.push([code, ids]);
        if (code === 'jarvit') return okJson({ status: 'success', data: { rows: ids.map(id => ({ id_post: id, views: 9 })), not_found: [] } });
        return okJson({ status: 'success', brand: code, data: { rows: ids.map(id => ({ id_post: id, views: 5, organic_metrics_status: 'available' })), not_found: [] } });
    };
    const result = await runSync({ storeImpl, fetchImpl, env: ENV });
    assert.deepEqual(asked, [['beauterry', ['11', '12']], ['jarvit', ['21']], ['jernis', ['31']]], 'ส่งเฉพาะ ID ของแบรนด์นั้น');
    assert.deepEqual(applied, [{ ids: ['11', '12'], brands: ['Beauterry'] }, { ids: ['31'], brands: ['Jernis'] }], 'Jarvit ไม่ถูกบันทึกเลย');
    assert.equal(result.requested, 4);
    assert.equal(result.updated, 3);
    assert.deepEqual(result.brands.jarvit.error.includes('(none)'), true);
    assert.deepEqual(result.brand_errors.map(e => e.brand), ['jarvit']);
    assert.equal(getStatus(ENV).last_run.status, 'partial');
    const line = syncSummaryLine(result);
    assert.match(line, /^Beauterry PFM sync completed: 3\/4 updated/);
    assert.match(line, /แบรนด์ beauterry 2\/2, jarvit 0\/1 ล้มเหลว, jernis 1\/1/);
    assert.match(line, /ดึงไม่ได้: jarvit/);
    assert.equal(getOrganicMetricStatus('31'), 'available');

    // ทุกแบรนด์ที่มีคลิปล้มหมด = ทั้งรอบ error (โยนต่อ เหมือนตอนมีแบรนด์เดียว) · สถานะยอด organic เดิมไม่หาย
    applied.length = 0;
    await assert.rejects(runSync({ storeImpl, env: ENV, fetchImpl: async () => ({ ok: false, status: 502 }) }), /beauterry: .*HTTP 502.*jarvit: .*jernis: /);
    assert.equal(getStatus(ENV).last_run.status, 'error');
    assert.deepEqual(applied, []);
    assert.equal(getOrganicMetricStatus('31'), 'available', 'รอบที่ล้มไม่ล้างสถานะเดิม');

    // ล้มบางแบรนด์: สถานะ organic เดิมของคลิปแบรนด์ที่ล้มยังอยู่
    const partialFetch = async (url, options) => {
        const code = (String(url).match(/[?&]brand=([a-z]+)/) || [])[1] || 'beauterry';
        if (code === 'jernis') return { ok: false, status: 500 };
        const ids = JSON.parse(options.body).item_ids;
        return okJson({ status: 'success', brand: code, data: { rows: ids.map(id => ({ id_post: id, views: 1 })), not_found: [] } });
    };
    await runSync({ storeImpl, env: ENV, fetchImpl: partialFetch });
    assert.equal(getOrganicMetricStatus('31'), 'available', 'Jernis ดึงไม่ได้รอบนี้ — คงสถานะเดิม');
    assert.equal(getStatus(ENV).last_run.status, 'partial');
});

test('runSync: ไม่มีคลิปของแบรนด์ไหนเลย = ไม่ยิงคำขอ · สำเร็จ requested 0', async () => {
    const storeImpl = { adsSync: { itemIds: async () => [], apply: async () => { throw new Error('must not apply'); } } };
    const result = await runSync({ storeImpl, env: ENV, fetchImpl: async () => { throw new Error('must not call PFM'); } });
    assert.equal(result.requested, 0);
    assert.deepEqual(result.brand_errors, []);
    assert.equal(getStatus(ENV).last_run.status, 'success');
});

test('runSync: แบรนด์ที่เพิ่งต่อ (Jarvit / Jernis) ส่งเฉพาะ ID Post ตัวเลขล้วน · Beauterry ส่งเหมือนเดิมทุกตัว', async () => {
    const IDS = { Beauterry: ['11', 'bad-1'], Jarvit: ['21', 'https://www.tiktok.com/@a/video/22', '7600 1'], Jernis: ['abc'] };
    const asked = [];
    const storeImpl = { adsSync: { itemIds: async brands => IDS[brands[0]] || [], apply: async rows => ({ updated: rows.length }) } };
    const fetchImpl = async (url, options) => {
        const code = (String(url).match(/[?&]brand=([a-z]+)/) || [])[1] || 'beauterry';
        const ids = JSON.parse(options.body).item_ids;
        asked.push([code, ids]);
        return okJson({ status: 'success', brand: code, data: { rows: ids.filter(id => /^\d+$/.test(id)).map(id => ({ id_post: id })), not_found: ids.filter(id => !/^\d+$/.test(id)) } });
    };
    const result = await runSync({ storeImpl, fetchImpl, env: ENV });
    assert.deepEqual(asked, [['beauterry', ['11', 'bad-1']], ['jarvit', ['21']]], 'Jernis มีแต่ ID ผิดรูป = ไม่ยิงคำขอ');
    assert.deepEqual([result.brands.beauterry.requested, result.brands.jarvit.requested, result.brands.jernis.requested], [2, 1, 0]);
    assert.deepEqual(result.brand_errors, []);
});

test('logSyncResult: ดึงไม่ได้บางแบรนด์ = บรรทัด completed ตามปกติ + ขึ้น error log ด้วย · ไม่มีปัญหา = ไม่มี error', () => {
    const { logSyncResult } = require('../server/src/services/beauterryPfmSync');
    const logs = [], errors = [];
    const logger = { log: m => logs.push(m), error: m => errors.push(m) };
    logSyncResult({ requested: 3, updated: 1, brands: { beauterry: { requested: 2, updated: 0, error: 'HTTP 502' }, jernis: { requested: 1, updated: 1 } },
        brand_errors: [{ brand: 'beauterry', message: 'Beauterry PFM returned HTTP 502' }] }, logger);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^Beauterry PFM sync completed/);
    assert.deepEqual(errors, ['Beauterry PFM sync failed: beauterry: Beauterry PFM returned HTTP 502']);
    logSyncResult({ requested: 1, updated: 1, brands: { beauterry: { requested: 1, updated: 1 } }, brand_errors: [] }, logger);
    assert.equal(errors.length, 1, 'รอบปกติไม่ขึ้น error');
});
