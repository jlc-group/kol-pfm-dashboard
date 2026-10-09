const store = require('../store');
const { pfmSourceBrands, pfmBrandCode } = require('../store/logic');

const SOURCE = 'beauterry-pfm';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8202';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const MAX_BATCH_SIZE = 2000;
const ALLOWED_FIELDS = [
    'id_post', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts',
    'ad_spend', 'ad_reach', 'source_updated_at', 'paid_updated_at', 'first_ad_date', 'ad_launched', 'organic_metrics_status'
];

let running = false;
let lastRun = null;
let organicStatus = new Map();
const ORGANIC_STATUSES = new Set(['available', 'pending', 'snapshot_only', 'source_unavailable']);

function getOrganicMetricStatus(idPost) {
    return organicStatus.get(String(idPost || '').trim()) || null;
}

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
        if (field === 'organic_metrics_status') {
            if (ORGANIC_STATUSES.has(row[field])) clean[field] = row[field];
            continue;
        }
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

// brandCode = รหัสแบรนด์ที่ PFM ใช้ (logic.js PFM_BRAND_CODES) — 9 ต.ค. 2026 PFM ดูแลหลายแบรนด์ (สเปก "Choosing the brand")
// beauterry / ไม่ส่ง = ไม่ใส่ ?brand (คำขอเหมือนเดิมทุกตัวอักษร · PFM ถือว่าไม่ระบุ = Beauterry)
// แบรนด์อื่น = ?brand=<รหัส> · 1 คำขอต่อแบรนด์ · คำตอบต้องบอก brand ตรงกับที่ถาม ไม่งั้นไม่รับอะไรเลย
// (Beauterry ยอมคำตอบที่ไม่มีช่อง brand — PFM รุ่นก่อนหลายแบรนด์ไม่ส่งมา จะได้ไม่พังถ้า PFM ยังไม่ขึ้นรุ่นใหม่)
async function fetchBatch(itemIds, { fetchImpl = fetch, env = process.env, brandCode = 'beauterry' } = {}) {
    const settings = config(env);
    if (!settings.apiKey) throw new Error('Beauterry PFM sync key is not configured');
    const want = String(brandCode || 'beauterry').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(want)) throw new Error('Beauterry PFM brand code is invalid');
    const query = want === 'beauterry' ? '' : `?brand=${encodeURIComponent(want)}`;
    const response = await fetchImpl(`${settings.baseUrl}/api/v1/integrations/kol-pfm/metrics${query}`, {
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
    const got = payload.brand === undefined || payload.brand === null ? null : String(payload.brand).trim().toLowerCase();
    if (got !== want && !(got === null && want === 'beauterry')) {
        throw new Error(`Beauterry PFM returned brand "${got === null ? '(none)' : got.slice(0, 40)}" for "${want}"`);
    }
    const requested = new Set(itemIds.map(String));
    const seen = new Set();
    const rows = payload.data.rows.map(sanitizeRow);
    const notFound = Array.isArray(payload.data.not_found) ? payload.data.not_found.map(String) : [];
    for (const row of rows) {
        if (!row || !requested.has(row.id_post) || seen.has(row.id_post)) {
            throw new Error('Beauterry PFM returned an invalid or ambiguous response');
        }
        seen.add(row.id_post);
    }
    for (const id of notFound) {
        if (!requested.has(id) || seen.has(id)) throw new Error('Beauterry PFM returned an invalid or ambiguous response');
        seen.add(id);
    }
    if (seen.size !== requested.size) throw new Error('Beauterry PFM returned an incomplete response');
    return { rows, notFound };
}

async function runSync({ storeImpl = store, fetchImpl = fetch, env = process.env } = {}) {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const startedAt = new Date().toISOString();
    try {
        // ถามเฉพาะคลิปของแบรนด์ที่ PFM ตัวนี้ดูแล (logic.js PFM_SOURCES) — แบรนด์อื่นไม่ถูกส่งมาถาม (6 ต.ค. 2026)
        // 9 ต.ค. 2026 หลายแบรนด์ (Beauterry / Jarvit / Jernis): ถามทีละแบรนด์ — ส่งเฉพาะ ID Post ของแบรนด์นั้น + ?brand=<รหัส>
        // แล้วรับยอดลงได้เฉพาะคลิปของแบรนด์นั้น (apply brands) · แบรนด์หนึ่งดึงไม่ได้ (เช่น PFM ยังไม่เปิดแบรนด์นั้น) ไม่ลากแบรนด์อื่น
        // ทุกแบรนด์ที่ต้องถามล้มหมด = ทั้งรอบล้มเหลว (เหมือนเดิมตอนมีแบรนด์เดียว) · ล้มบางแบรนด์ = status 'partial' + brand_errors
        const nextOrganicStatus = new Map();
        const result = { requested: 0, received: 0, source_not_found: [], updated: 0,
            stale: 0, stale_raised: 0, regressed_metrics: 0, stamped: 0, not_found: [], skipped: 0, other_brand: 0,
            brands: {}, brand_errors: [], started_at: startedAt };
        let succeeded = 0;
        for (const brand of pfmSourceBrands(SOURCE) || []) {
            const code = pfmBrandCode(brand);
            if (!code) continue;
            const per = { requested: 0, received: 0, updated: 0 };
            result.brands[code] = per;
            let itemIds = [];
            try {
                itemIds = await storeImpl.adsSync.itemIds([brand]);
                // แบรนด์ที่เพิ่งต่อ (Jarvit / Jernis) ID Post เคยกรอกมือโดยไม่มีการตรวจ — ส่งเฉพาะตัวเลขล้วน (สเปก: IDs must contain digits only)
                // กัน ID ผิดรูปตัวเดียวทำให้ PFM ปฏิเสธทั้งชุดทุกชั่วโมง (ตัวที่ผิดรูปขึ้นป้าย "ID Post ผิดรูปแบบ" ในหน้า Ads อยู่แล้ว)
                // Beauterry ส่งเหมือนเดิมทุกตัวอักษร
                if (code !== 'beauterry') itemIds = itemIds.filter(id => /^\d{1,50}$/.test(String(id)));
                per.requested = itemIds.length;
                result.requested += itemIds.length;
                if (!itemIds.length) continue;
                for (let offset = 0; offset < itemIds.length; offset += MAX_BATCH_SIZE) {
                    const batch = itemIds.slice(offset, offset + MAX_BATCH_SIZE);
                    const exported = await fetchBatch(batch, { fetchImpl, env, brandCode: code });
                    result.received += exported.rows.length;
                    per.received += exported.rows.length;
                    for (const row of exported.rows) {
                        if (row.organic_metrics_status) nextOrganicStatus.set(row.id_post, row.organic_metrics_status);
                    }
                    result.source_not_found.push(...exported.notFound);
                    const missingRows = exported.notFound.map(id_post => ({ id_post: String(id_post), pfm_source: SOURCE, organic_metrics_status: 'source_not_found' }));
                    const applied = await storeImpl.adsSync.apply([...exported.rows, ...missingRows], { brands: [brand] });
                    for (const key of ['updated', 'stale', 'stale_raised', 'regressed_metrics', 'stamped', 'skipped', 'other_brand']) {
                        result[key] += applied[key] || 0;
                    }
                    per.updated += applied.updated || 0;
                    result.not_found.push(...(applied.not_found || []));
                }
                succeeded++;
            } catch (error) {
                per.error = error.message;
                result.brand_errors.push({ brand: code, message: error.message });
                // แบรนด์นี้ไม่ได้ข้อมูลใหม่ — คงสถานะยอด organic เดิมของคลิปแบรนด์นี้ไว้ (เหมือนรอบที่ล้มเหลวแบบเดิม)
                for (const id of itemIds) {
                    if (!nextOrganicStatus.has(id) && organicStatus.has(id)) nextOrganicStatus.set(id, organicStatus.get(id));
                }
            }
        }
        if (result.brand_errors.length && !succeeded) {
            throw new Error(result.brand_errors.map(e => `${e.brand}: ${e.message}`).join(' · '));
        }
        result.finished_at = new Date().toISOString();
        organicStatus = nextOrganicStatus;
        result.organic_unavailable = [...organicStatus.values()].filter(v => v === 'source_unavailable').length;
        result.organic_snapshot_only = [...organicStatus.values()].filter(v => v === 'snapshot_only').length;
        lastRun = { status: result.brand_errors.length ? 'partial' : 'success', ...result };
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
        + ` · ยอดต่ำกว่าเดิมไม่รับ ${n(r.regressed_metrics)} · ข้าม ${n(r.skipped)} · สแตมป์ ${n(r.stamped)}`
        + (n(r.other_brand) ? ` · คลิปแบรนด์อื่นไม่รับ ${n(r.other_brand)}` : '')
        // 9 ต.ค. 2026 หลายแบรนด์: แยกต่อแบรนด์ (อัปเดต/ถาม) + แบรนด์ที่ดึงไม่ได้
        + (r.brands && Object.keys(r.brands).length
            ? ' · แบรนด์ ' + Object.entries(r.brands).map(([c, v]) => `${c} ${n(v.updated)}/${n(v.requested)}${v.error ? ' ล้มเหลว' : ''}`).join(', ') : '')
        + (Array.isArray(r.brand_errors) && r.brand_errors.length
            ? ' · ดึงไม่ได้: ' + r.brand_errors.map(e => `${e.brand} (${e.message})`).join(' · ') : '');
}

// เขียนผลรอบซิงก์ลง log ของ server — ดึงไม่ได้บางแบรนด์ (status partial · 9 ต.ค. 2026) ต้องขึ้นใน error log ด้วย
// ไม่งั้นความล้มของ Beauterry (เมื่ออีกแบรนด์ดึงได้) จะหายไปกับบรรทัด completed ที่เป็น log ปกติ
function logSyncResult(result, logger = console) {
    logger.log(syncSummaryLine(result));
    if (result && Array.isArray(result.brand_errors) && result.brand_errors.length) {
        logger.error(`Beauterry PFM sync failed: ${result.brand_errors.map(e => `${e.brand}: ${e.message}`).join(' · ')}`);
    }
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
    const execute = () => runSync({ env }).then(result => logSyncResult(result, logger))
        .catch(error => logger.error(`Beauterry PFM sync failed: ${error.message}`));
    const initial = setTimeout(execute, settings.initialDelayMs);
    const interval = setInterval(execute, settings.intervalMs);
    initial.unref();
    interval.unref();
    return () => {
        clearTimeout(initial);
        clearInterval(interval);
    };
}

module.exports = { config, sanitizeRow, fetchBatch, runSync, getStatus, startScheduler, syncSummaryLine, logSyncResult, getOrganicMetricStatus };
