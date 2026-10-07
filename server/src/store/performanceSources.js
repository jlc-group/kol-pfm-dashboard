// Effective metrics remain in submissions; evidence from manual entry and API is separate.
const METRIC_KEYS = ['views', 'likes', 'comments', 'saves', 'shares', 'reposts'];
const API_KEYS = METRIC_KEYS.filter(k => k !== 'reposts');
const metricsOf = row => Object.fromEntries(METRIC_KEYS.map(k => [k, Number(row[k]) || 0]));
const sourceUnavailable = row => {
    if (row.perf_sources?.mode === 'manual') {
        const recorded = row.perf_sources.manual?.id_post;
        return Boolean(recorded && recorded !== String(row.id_post || '').trim());
    }
    const api = row.perf_sources?.api;
    if (!api) return false;
    const observed = Date.parse(api.observed_at || '');
    return (api.id_post !== undefined && api.id_post !== String(row.id_post || '').trim())
        || ['snapshot_only', 'source_unavailable', 'pending', 'source_not_found'].includes(api.status)
        || !Number.isFinite(observed) || Date.now() - observed > 2 * 60 * 60 * 1000;
};

function recordApi(previous, row, at) {
    const old = previous || {};
    const sameSource = old.api?.source === row.pfm_source && old.api?.id_post === String(row.id_post || '').trim();
    const metrics = sameSource ? { ...old.api.metrics } : {};
    for (const k of METRIC_KEYS) {
        if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
            const value = Number(row[k]);
            if (Number.isFinite(value) && value >= 0) metrics[k] = value;
        }
    }
    return { ...old, mode: old.mode || 'legacy', api: {
        source: row.pfm_source, id_post: String(row.id_post || '').trim(), metrics, observed_at: at,
        // This is upstream record time, not proof that counters were fetched then.
        source_updated_at: row.source_updated_at || null,
        status: row.organic_metrics_status || (sameSource ? old.api.status : null) || 'unknown'
    } };
}

function manualEvidence(row, fields, byName, at) {
    const state = { ...(row.perf_sources || {}) };
    state.mode = 'manual';
    const supplied = Object.fromEntries(METRIC_KEYS.filter(k => fields[k] !== undefined).map(k => [k, fields[k]]));
    state.manual = { id_post: String(row.id_post || '').trim(), metrics: metricsOf({ ...row, ...supplied }), saved_at: at, by: byName || null };
    return state;
}

function apiSelection(row, at = Date.now()) {
    const api = row.perf_sources?.api;
    const observed = Date.parse(api?.observed_at || '');
    if (!api || !/^tiktok/i.test(String(row.platform || '').trim())
        || api.id_post !== String(row.id_post || '').trim()
        || api.status !== 'available' || !Number.isFinite(observed)
        || at - observed > 2 * 60 * 60 * 1000 || observed > at
        || !API_KEYS.every(k => Number.isFinite(api.metrics?.[k]) && api.metrics[k] >= 0)
        || !(api.metrics.views > 0)) return null;
    return Object.fromEntries(API_KEYS.map(k => [k, api.metrics[k]]));
}

module.exports = { METRIC_KEYS, metricsOf, recordApi, manualEvidence, apiSelection, sourceUnavailable };
