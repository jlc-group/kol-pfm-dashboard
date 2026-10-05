const store = require('../store');

const SOURCE = 'beauterry-pfm';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8202';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const MAX_BATCH_SIZE = 2000;
const ALLOWED_FIELDS = [
    'id_post', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts',
    'ad_spend', 'source_updated_at', 'paid_updated_at', 'first_ad_date', 'ad_launched'
];

let running = false;
let lastRun = null;

function config(env = process.env) {
    const intervalSeconds = Number(env.BEAUTERRY_PFM_SYNC_INTERVAL_SECONDS || 3600);
    const initialDelaySeconds = Number(env.BEAUTERRY_PFM_SYNC_INITIAL_DELAY_SECONDS || 30);
    return {
        enabled: String(env.BEAUTERRY_PFM_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
        baseUrl: String(env.BEAUTERRY_PFM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        // This is a separate service-to-service credential. Never fall back to
        // ADS_SYNC_KEY: that key controls the dashboard's own inbound endpoint.
        apiKey: env.BEAUTERRY_PFM_EXPORT_KEY || '',
        intervalMs: Number.isFinite(intervalSeconds) && intervalSeconds >= 60
            ? intervalSeconds * 1000 : DEFAULT_INTERVAL_MS,
        initialDelayMs: Number.isFinite(initialDelaySeconds) && initialDelaySeconds >= 0
            ? initialDelaySeconds * 1000 : DEFAULT_INITIAL_DELAY_MS
    };
}

function metricNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function sanitizeRow(row) {
    if (!row || !/^\d{1,50}$/.test(String(row.id_post || ''))) return null;
    const clean = { id_post: String(row.id_post) };
    for (const field of ALLOWED_FIELDS) {
        if (field === 'id_post') continue;
        if (field.endsWith('_at')) {
            if (row[field] && Number.isFinite(Date.parse(row[field]))) clean[field] = row[field];
            continue;
        }
        // ad_launched = Beauterry มี ad เกาะคลิปนี้แล้ว (ยังไม่ต้องมีค่าแอด) — รับเฉพาะ true
        if (field === 'ad_launched') {
            if (row[field] === true) clean[field] = true;
            continue;
        }
        // first_ad_date = วันที่ยิงแอดครั้งแรก (YYYY-MM-DD) ใช้ลง "วันยิงแอด"
        if (field.endsWith('_date')) {
            const v = String(row[field] || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))) clean[field] = v;
            continue;
        }
        const value = metricNumber(row[field]);
        if (value !== undefined) clean[field] = value;
    }
    clean.pfm_source = SOURCE;
    return clean;
}

async function fetchBatch(itemIds, { fetchImpl = fetch, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.apiKey) throw new Error('Beauterry PFM sync key is not configured');
    const response = await fetchImpl(`${settings.baseUrl}/api/v1/integrations/kol-pfm/metrics`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-PFM-API-Key': settings.apiKey
        },
        body: JSON.stringify({ item_ids: itemIds }),
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Beauterry PFM returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'success' || !Array.isArray(payload.data?.rows)) {
        throw new Error('Beauterry PFM returned an invalid response');
    }
    return {
        rows: payload.data.rows.map(sanitizeRow).filter(Boolean),
        notFound: Array.isArray(payload.data.not_found) ? payload.data.not_found : []
    };
}

async function runSync({ storeImpl = store, fetchImpl = fetch, env = process.env } = {}) {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const startedAt = new Date().toISOString();
    try {
        const itemIds = await storeImpl.adsSync.itemIds();
        const result = { requested: itemIds.length, received: 0, source_not_found: [], updated: 0,
            stale: 0, stale_raised: 0, regressed_metrics: 0, stamped: 0, not_found: [], skipped: 0,
            started_at: startedAt };
        for (let offset = 0; offset < itemIds.length; offset += MAX_BATCH_SIZE) {
            const batch = itemIds.slice(offset, offset + MAX_BATCH_SIZE);
            const exported = await fetchBatch(batch, { fetchImpl, env });
            result.received += exported.rows.length;
            result.source_not_found.push(...exported.notFound);
            const applied = await storeImpl.adsSync.apply(exported.rows);
            for (const key of ['updated', 'stale', 'stale_raised', 'regressed_metrics', 'stamped', 'skipped']) {
                result[key] += applied[key] || 0;
            }
            result.not_found.push(...(applied.not_found || []));
        }
        result.finished_at = new Date().toISOString();
        lastRun = { status: 'success', ...result };
        return result;
    } catch (error) {
        lastRun = { status: 'error', started_at: startedAt, finished_at: new Date().toISOString(),
            message: error.message };
        throw error;
    } finally {
        running = false;
    }
}

// สรุปผลรอบซิงก์เป็นบรรทัดเดียวสำหรับ log ของ server
function syncSummaryLine(r) {
    // รอบที่ถูกข้าม (รอบก่อนยังไม่จบ) — runSync คืน { skipped: true, reason }
    if (r && r.skipped === true) return `Beauterry PFM sync skipped: ${r.reason || 'unknown'}`;
    const n = v => (Array.isArray(v) ? v.length : Number(v) || 0);
    return `Beauterry PFM sync completed: ${n(r.updated)}/${n(r.requested)} updated`
        + ` · received ${n(r.received)} · PFM ไม่มี ${n(r.source_not_found)} · จับคู่ไม่ได้ ${n(r.not_found)}`
        + ` · เวลาต้นทางไม่ขยับ ${n(r.stale)} (รับยอดที่สูงขึ้น ${n(r.stale_raised)})`
        + ` · ยอดต่ำกว่าเดิมไม่รับ ${n(r.regressed_metrics)} · ข้าม ${n(r.skipped)} · สแตมป์ ${n(r.stamped)}`;
}

function getStatus(env = process.env) {
    const settings = config(env);
    return { enabled: settings.enabled, configured: Boolean(settings.apiKey), running, last_run: lastRun };
}

function startScheduler({ logger = console, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.apiKey) {
        logger.warn('Beauterry PFM auto sync is disabled or not configured');
        return () => {};
    }
    // 2 ต.ค. 2026: บอกด้วยว่ามีข้อมูลถูกทิ้ง/ข้ามกี่แถว — เดิมพิมพ์แค่ updated ดูเหมือนครบทั้งที่ยอดวิวไม่เข้า
    const execute = () => runSync({ env }).then(result => {
        logger.log(syncSummaryLine(result));
    }).catch(error => logger.error(`Beauterry PFM sync failed: ${error.message}`));
    const initial = setTimeout(execute, settings.initialDelayMs);
    const interval = setInterval(execute, settings.intervalMs);
    initial.unref();
    interval.unref();
    return () => {
        clearTimeout(initial);
        clearInterval(interval);
    };
}

module.exports = { config, sanitizeRow, fetchBatch, runSync, getStatus, startScheduler, syncSummaryLine };
