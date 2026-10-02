const store = require('../store/pg/weboostxSync');
const { sanitizeRow } = require('./weboostxMetrics');
let running = false;
let lastRun = null;
function config(env = process.env) {
    const interval = Number(env.WEBOOSTX_PFM_SYNC_INTERVAL_SECONDS || 3600);
    const delay = Number(env.WEBOOSTX_PFM_SYNC_INITIAL_DELAY_SECONDS || 30);
    return {
        enabled: String(env.WEBOOSTX_PFM_SYNC_ENABLED || 'false').toLowerCase() === 'true',
        apiKey: env.WEBOOSTX_PFM_EXPORT_KEY || '',
        baseUrl: String(env.WEBOOSTX_PFM_BASE_URL || 'http://127.0.0.1:8201').replace(/\/+$/, ''),
        intervalMs: Number.isFinite(interval) && interval >= 60 ? interval * 1000 : 3600000,
        initialDelayMs: Number.isFinite(delay) && delay >= 0 ? delay * 1000 : 30000
    };
}
async function fetchBatch(ids, { fetchImpl = fetch, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.apiKey) throw new Error('WeBoostX PFM sync key is not configured');
    const response = await fetchImpl(`${settings.baseUrl}/api/v1/integrations/kol-pfm/metrics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PFM-API-Key': settings.apiKey },
        body: JSON.stringify({ item_ids: ids }), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`WeBoostX PFM returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'success' || !Array.isArray(payload.data?.rows)) throw new Error('WeBoostX PFM returned an invalid response');
    const requested = new Set(ids), seen = new Set();
    const rows = [];
    for (const raw of payload.data.rows) {
        const row = sanitizeRow(raw);
        if (!row || !requested.has(row.item_id) || seen.has(row.item_id)) throw new Error('WeBoostX PFM returned an invalid or ambiguous row');
        seen.add(row.item_id);
        rows.push(row);
    }
    return rows;
}
async function runSync({ storeImpl = store, fetchImpl = fetch, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.apiKey) return { skipped: true, reason: 'disabled_or_unconfigured' };
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const startedAt = new Date().toISOString();
    try {
        const items = await storeImpl.items();
        const ids = [...new Set(items.map(item => item.item_id))];
        const result = { requested: items.length, received: 0, updated: 0, stamped: 0, skipped: 0,
            source_not_found: [], started_at: startedAt };
        for (let offset = 0; offset < ids.length; offset += 2000) {
            const batch = ids.slice(offset, offset + 2000);
            const rows = await fetchBatch(batch, { fetchImpl, env });
            const mapped = [];
            for (const item of items.filter(item => batch.includes(item.item_id))) {
                const row = rows.find(row => row.item_id === item.item_id && row.platform === item.platform);
                if (row) mapped.push({ ...row, submission_id: item.submission_id });
                else result.source_not_found.push(item.submission_id);
            }
            result.received += mapped.length;
            const applied = await storeImpl.apply(mapped);
            for (const key of ['updated', 'stamped', 'skipped']) result[key] += applied[key] || 0;
        }
        result.finished_at = new Date().toISOString();
        lastRun = { status: 'success', ...result };
        return result;
    } catch (error) {
        lastRun = { status: 'error', started_at: startedAt, finished_at: new Date().toISOString(), message: error.message };
        throw error;
    } finally { running = false; }
}
function getStatus(env = process.env) {
    const settings = config(env);
    return { enabled: settings.enabled, configured: Boolean(settings.apiKey), running, last_run: lastRun };
}
function startScheduler({ logger = console, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.apiKey) return () => {};
    const execute = () => runSync({ env }).then(result => {
        logger.log(`WeBoostX PFM sync completed: ${result.updated}/${result.requested} updated`);
    }).catch(error => logger.error(`WeBoostX PFM sync failed: ${error.message}`));
    const initial = setTimeout(execute, settings.initialDelayMs);
    const interval = setInterval(execute, settings.intervalMs);
    initial.unref(); interval.unref();
    return () => { clearTimeout(initial); clearInterval(interval); };
}
module.exports = { config, fetchBatch, runSync, getStatus, startScheduler };
