const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
process.env.NODE_ENV = 'test';
const evidence = require('../server/src/store/tiktokEvidence');
const sync = require('../server/src/services/tiktokEvidenceSync');
const at = Date.now();
const id = '7600000000000000001';
const fixture = extra => ({ id_post: id, status: 'available', collected_at: new Date(at - 1000).toISOString(),
    metrics: { views: 1000, likes: 100, comments: 0, saves: 0, shares: 5 }, ...extra });
const env = { KOL_TIKTOK_EVIDENCE_URL: 'https://metrics.example/kol', KOL_TIKTOK_EVIDENCE_KEY: 'fixture' };
const response = (rows, extra = {}) => new Response(JSON.stringify({ status: 'success', rows }), { status: 200, ...extra });

test('evidence rejects incomplete, invalid, negative and imprecise counters rather than inventing zero', () => {
    for (const value of [undefined, null, '', true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.5']) {
        assert.throws(() => evidence.normalize(fixture({ metrics: { ...fixture().metrics, saves: value } }), at));
    }
    assert.equal(evidence.normalize(fixture(), at).metrics.saves, 0);
    assert.equal(evidence.normalize(fixture({ metrics: { ...fixture().metrics, saves: '42' } }), at).metrics.saves, 42);
});
test('actual counter timestamp is mandatory; receipt and source record timestamps are not substitutes', () => {
    for (const collected_at of [undefined, 'garbage', '2026-10-07T14:00:00', new Date(at + 60000).toISOString()]) {
        assert.throws(() => evidence.normalize(fixture({ collected_at, source_updated_at: new Date(at).toISOString() }), at));
    }
});
test('unavailable evidence omits counters and every paid/budget/status field', () => {
    const clean = evidence.normalize(fixture({ status: 'source_unavailable', ad_spend: 99, ad_status: 'ยิงแล้ว', budget: 88 }), at);
    assert.deepEqual(clean, { id_post: id, status: 'source_unavailable', source: 'kol-tiktok-evidence' });
});
test('recording separate evidence preserves manual selection, PFM evidence and historical stamp', () => {
    const old = { mode: 'manual', manual: { metrics: { views: 9000 } }, api: { source: 'beauterry-pfm', metrics: { views: 500 } } };
    const original = structuredClone(old);
    const state = evidence.record(old, evidence.normalize(fixture(), at), new Date(at).toISOString());
    assert.deepEqual(old, original);
    assert.deepEqual(state.manual, old.manual); assert.deepEqual(state.api, old.api); assert.equal(state.mode, 'manual');
});
test('repeated receipt cannot refresh an old collected timestamp, and post identity changes clear old evidence', () => {
    const clean = evidence.normalize(fixture(), at);
    const old = evidence.record(null, clean, new Date(at).toISOString());
    assert.equal(evidence.record(old, clean, new Date(at + 1000).toISOString()), null);
    assert.equal(evidence.record(old, evidence.normalize(fixture({ collected_at: new Date(at - 2000).toISOString() }), at), new Date(at).toISOString()), null);
    const changed = evidence.record(old, { id_post: '2', status: 'pending', source: clean.source }, new Date(at).toISOString());
    assert.equal(changed.tiktok_evidence.metrics, undefined);
});
test('selection requires actual fresh collection, matching identity, complete counters and reviewed evidence ID', async () => {
    const clean = evidence.normalize(fixture(), at);
    const row = { platform: 'TikTok', id_post: id, perf_sources: evidence.record(null, clean, new Date(at).toISOString()) };
    const web = await import(pathToFileURL(require.resolve('../client/src/data/performanceSources.js')).href);
    assert.equal(evidence.selectable(row, clean.evidence_id, at), true);
    assert.equal(web.canSelectIsolated(row, at), true);
    for (const change of [ { platform: 'Instagram' }, { id_post: '2' },
        { perf_sources: { tiktok_evidence: { ...row.perf_sources.tiktok_evidence, status: 'fetch_failed' } } },
        { perf_sources: { tiktok_evidence: { ...row.perf_sources.tiktok_evidence, collected_at: new Date(at - 3 * 3600000).toISOString() } } },
        { perf_sources: { tiktok_evidence: { ...row.perf_sources.tiktok_evidence, metrics: { views: 1 } } } }
    ]) {
        const changed = { ...row, ...change };
        assert.equal(evidence.selectable(changed, clean.evidence_id, at), false);
        assert.equal(web.canSelectIsolated(changed, at), false);
    }
    assert.equal(evidence.selectable(row, 'changed', at), false);
});
test('consumer has no legacy fallback and cannot be enabled with an unsafe or secret URL', async () => {
    assert.equal(sync.getStatus({}).configured, false);
    for (const url of ['http://remote.example/metrics', 'https://user:secret@metrics.example/', 'https://metrics.example/?key=secret', 'file:///tmp/x']) {
        assert.equal(sync.config({ ...env, KOL_TIKTOK_EVIDENCE_URL: url }).endpoint, null);
    }
    const status = sync.getStatus(env); assert.equal(status.configured, true); assert.equal(status.enabled, false);
    assert.ok(!JSON.stringify(status).includes('fixture'));
    let fetched = false, queried = false;
    await assert.rejects(sync.runSync({ env: {}, fetchImpl: async () => { fetched = true; },
        storeImpl: { adsSync: { itemIds: async () => { queried = true; } } } }), { status: 503 });
    assert.equal(fetched, false); assert.equal(queried, false);
    let scheduled = false;
    sync.startScheduler({ env: {}, logger: { log: () => { scheduled = true; } } })();
    assert.equal(scheduled, false);
});
test('read-only provider contract authenticates without following redirects and validates identity', async () => {
    let call;
    const rows = await sync.fetchBatch([id], { env, fetchImpl: async (url, options) => { call = { url, options }; return response([fixture()]); } });
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers['X-KOL-TikTok-Key'], 'fixture');
    assert.equal(new URL(call.url).searchParams.get('item_ids'), id); assert.equal(rows[0].metrics.comments, 0);
    for (const invalid of [[], [fixture(), fixture()], [fixture({ id_post: '2' })]]) {
        await assert.rejects(sync.fetchBatch([id], { env, fetchImpl: async () => response(invalid) }));
    }
});
test('consumer fails safely on malformed, oversized, HTTP and credential-bearing transport errors', async () => {
    for (const fetchImpl of [
        async () => new Response('not json'), async () => new Response('failure', { status: 401 }),
        async () => new Response('x'.repeat(1024 * 1024 + 1)),
        async () => { throw new Error('secret fixture https://metrics.example'); }
    ]) {
        await assert.rejects(sync.fetchBatch([id], { env, fetchImpl }), e => !e.message.includes('fixture') && !e.message.includes('metrics.example'));
    }
});

test('invalid requested identity never calls the provider', async () => {
    for (const ids of [[], ['bad'], Array(101).fill(id), [123]]) {
        await assert.rejects(sync.fetchBatch(ids, { env, fetchImpl: async () => { throw new Error('Provider must not be called'); } }), /ID Post/);
    }
});
test('collection calls only evidence storage; no paid or effective-counter store is invoked', async () => {
    let stored;
    const result = await sync.runSync({ env, fetchImpl: async () => response([fixture()]), storeImpl: {
        // แบรนด์ที่ PFM ดูแล (9 ต.ค. 2026 เพิ่ม Jarvit / Jernis) — ยังไม่รวมแบรนด์อื่น
        adsSync: { itemIds: async brands => { assert.deepEqual(brands, ['Beauterry', 'Jarvit', 'Jernis']); return [id]; },
            apply: async () => { throw new Error('Must not apply effective metrics'); } },
        tiktokEvidence: { apply: async rows => { stored = rows; return { stored: 1, stale: 0, not_found: [] }; } }
    } });
    assert.equal(result.available, 1); assert.equal(result.stored, 1); assert.equal(stored[0].ad_spend, undefined);
});
