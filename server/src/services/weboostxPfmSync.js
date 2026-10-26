const store = require('../store/pg/weboostxSync');
const { sanitizeRow } = require('./weboostxMetrics');
const thumbs = require('./weboostxThumbs');
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
// คีย์ทุกตัวของแถว (store รุ่นก่อน / ตัวทดสอบที่ส่งแค่ item_id = คีย์เดียว)
const keysOf = item => (Array.isArray(item.item_ids) && item.item_ids.length ? item.item_ids : [item.item_id]).filter(Boolean);
// แบ่งชุดละไม่เกิน MAX_KEYS คีย์ — คีย์ทุกตัวของแถวเดียวกันอยู่ชุดเดียวกันเสมอ (ไม่งั้นแถวที่ลิงก์อยู่ชุดหนึ่ง ID อยู่อีกชุดจะตัดสินผิด)
const MAX_KEYS = 2000;
function batchItems(items) {
    const batches = [];
    let cur = null;
    for (const item of items) {
        const keys = keysOf(item);
        if (!keys.length) continue;
        const fresh = cur ? keys.filter(k => !cur.set.has(k)).length : keys.length;
        if (!cur || (cur.items.length && cur.set.size + fresh > MAX_KEYS)) {
            cur = { items: [], set: new Set() };
            batches.push(cur);
        }
        cur.items.push(item);
        keys.forEach(k => cur.set.add(k));
    }
    return batches.map(b => ({ items: b.items, ids: [...b.set] }));
}
async function runSync({ storeImpl = store, fetchImpl = fetch, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.apiKey) return { skipped: true, reason: 'disabled_or_unconfigured' };
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const startedAt = new Date().toISOString();
    try {
        const items = await storeImpl.items();
        const result = { requested: items.length, received: 0, updated: 0, stamped: 0, skipped: 0,
            source_not_found: [], started_at: startedAt };
        for (const batch of batchItems(items)) {
            const rows = await fetchBatch(batch.ids, { fetchImpl, env });
            const mapped = [];
            for (const item of batch.items) {
                // คีย์แรกที่ WeBoostX เจอ (ลิงก์ก่อน แล้ว ID POST แล้ว Gencode) — 26 ต.ค. 2026
                const row = keysOf(item).map(key => rows.find(r => r.item_id === key && r.platform === item.platform)).find(Boolean);
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
    return { enabled: settings.enabled, configured: Boolean(settings.apiKey), running, last_run: lastRun,
        thumbnails: thumbs.getThumbStatus() };
}
// 1 รอบของตัวตั้งเวลา: ซิงก์ค่าแอดก่อน แล้วค่อยดาวน์โหลดรูปปก (services/weboostxThumbs.js · 19 ต.ค. 2026)
// รูปปกเป็นงานแยก — ล้มยังไงผลซิงก์ค่าแอดก็ไม่เปลี่ยน (บันทึกลงฐานไปแล้ว) · ซิงก์ล้มก็ยังลองโหลดรูปของ path ที่มีอยู่
async function runCycle({ logger = console, env = process.env, storeImpl, fetchImpl, thumbDir } = {}) {
    const out = { sync: null, thumbs: null };
    try {
        out.sync = await runSync({ env, ...(storeImpl ? { storeImpl } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
        if (!out.sync.skipped) logger.log(`WeBoostX PFM sync completed: ${out.sync.updated}/${out.sync.requested} updated`);
    } catch (error) {
        out.syncError = error.message;
        logger.error(`WeBoostX PFM sync failed: ${error.message}`);
    }
    try {
        out.thumbs = await thumbs.runThumbs({ settings: config(env), storeImpl, ...(fetchImpl ? { fetchImpl } : {}), dir: thumbDir });
        logger.log(thumbs.thumbSummaryLine(out.thumbs));
    } catch (error) {
        out.thumbsError = error.message;
        logger.error(`WeBoostX thumbnails failed: ${error.message}`);
    }
    return out;
}
function startScheduler({ logger = console, env = process.env } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.apiKey) return () => {};
    const execute = () => runCycle({ logger, env });
    const initial = setTimeout(execute, settings.initialDelayMs);
    const interval = setInterval(execute, settings.intervalMs);
    initial.unref(); interval.unref();
    return () => { clearTimeout(initial); clearInterval(interval); };
}
module.exports = { config, fetchBatch, batchItems, runSync, runCycle, getStatus, startScheduler };
