const store = require('../store');
const { pfmSourceBrands } = require('../store/logic');
const { normalize } = require('../store/tiktokEvidence');
let running = false, lastRun = null;

function config(env = process.env) {
    let endpoint = null;
    try {
        const url = new URL(env.KOL_TIKTOK_EVIDENCE_URL || '');
        if (!url.username && !url.password && !url.hash && !url.search
            && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) endpoint = url.href;
    } catch { /* Unconfigured is explicit, never fall back to the old scraper. */ }
    const interval = Number(env.KOL_TIKTOK_EVIDENCE_INTERVAL_SECONDS || 3600);
    return { enabled: env.KOL_TIKTOK_EVIDENCE_ENABLED === 'true', endpoint,
        key: env.KOL_TIKTOK_EVIDENCE_KEY || '', intervalMs: Number.isFinite(interval) && interval >= 300 ? interval * 1000 : 3600000 };
}

async function fetchBatch(ids, { env = process.env, fetchImpl = fetch } = {}) {
    const settings = config(env);
    if (!settings.endpoint || !settings.key) {
        const e = new Error('ยังไม่มีบริการดึงยอด TikTok แยกสำหรับ KOL ที่ตั้งค่าไว้'); e.status = 503; throw e;
    }
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^\d{1,50}$/.test(id))) {
        throw new Error('ชุด ID Post สำหรับดึงยอด TikTok ไม่ถูกต้อง');
    }
    const url = new URL(settings.endpoint);
    url.searchParams.set('item_ids', ids.join(','));
    let response;
    try {
        response = await fetchImpl(url.href, { method: 'GET', redirect: 'error',
            headers: { 'X-KOL-TikTok-Key': settings.key }, signal: AbortSignal.timeout(20000) });
    } catch { throw new Error('บริการดึงยอด TikTok ติดต่อไม่ได้หรือหมดเวลา'); }
    if (!response.ok) throw new Error(`บริการดึงยอด TikTok ตอบ HTTP ${response.status}`);
    // Bound the response without printing upstream bodies, URLs or credentials.
    const chunks = []; let bytes = 0;
    try {
        for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) throw new Error('Response limit');
            chunks.push(Buffer.from(chunk));
        }
    } catch { throw new Error('บริการส่งยอด TikTok ไม่ครบหรือใหญ่เกินกำหนด'); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('บริการดึงยอด TikTok ส่งข้อมูลไม่ถูกต้อง'); }
    if (payload.status !== 'success' || !Array.isArray(payload.rows)) throw new Error('บริการดึงยอด TikTok ส่งข้อมูลไม่ถูกต้อง');
    const rows = payload.rows.map(r => normalize(r));
    const requested = new Set(ids), seen = new Set();
    for (const row of rows) {
        if (!requested.has(row.id_post) || seen.has(row.id_post)) throw new Error('ข้อมูลยอด TikTok จับคู่โพสต์ไม่ได้หรือซ้ำ');
        seen.add(row.id_post);
    }
    if (seen.size !== requested.size) throw new Error('บริการดึงยอด TikTok ส่งผลลัพธ์ไม่ครบ');
    return rows;
}

async function runSync({ env = process.env, fetchImpl = fetch, storeImpl = store } = {}) {
    if (running) return { skipped: true, reason: 'already_running' };
    const settings = config(env);
    if (!settings.endpoint || !settings.key) {
        const e = new Error('ยังไม่มีบริการดึงยอด TikTok แยกสำหรับ KOL ที่ตั้งค่าไว้'); e.status = 503; throw e;
    }
    running = true;
    const result = { started_at: new Date().toISOString(), requested: 0, available: 0, stored: 0, stale: 0, not_found: [] };
    try {
        const candidates = await storeImpl.adsSync.itemIds(pfmSourceBrands('beauterry-pfm'));
        const ids = [...new Set(candidates.filter(id => /^\d{1,50}$/.test(id)))];
        result.requested = ids.length;
        for (let offset = 0; offset < ids.length; offset += 100) {
            const rows = await fetchBatch(ids.slice(offset, offset + 100), { env, fetchImpl });
            result.available += rows.filter(r => r.status === 'available').length;
            const applied = await storeImpl.tiktokEvidence.apply(rows);
            result.stored += applied.stored; result.stale += applied.stale; result.not_found.push(...applied.not_found);
        }
        lastRun = { ...result, status: 'success', finished_at: new Date().toISOString() };
        return lastRun;
    } catch (error) {
        // Never expose a transport exception containing the configured secret endpoint.
        lastRun = { ...result, status: 'error', finished_at: new Date().toISOString(), message: error.message };
        throw error;
    } finally { running = false; }
}

function getStatus(env = process.env) {
    const settings = config(env);
    return { enabled: settings.enabled, configured: Boolean(settings.endpoint && settings.key),
        reason: settings.endpoint && settings.key ? null : 'ยังไม่มีบริการดึงยอด TikTok แยกสำหรับ KOL ที่ตั้งค่าไว้', running, last_run: lastRun };
}
function startScheduler({ env = process.env, logger = console } = {}) {
    const settings = config(env);
    if (!settings.enabled || !settings.endpoint || !settings.key) return () => {};
    const execute = () => runSync({ env }).then(r => logger.log(`KOL TikTok evidence: ${r.stored}/${r.requested} stored separately`))
        .catch(() => logger.error('KOL TikTok evidence collection failed; effective metrics unchanged'));
    const initial = setTimeout(execute, 30000), interval = setInterval(execute, settings.intervalMs);
    initial.unref(); interval.unref();
    return () => { clearTimeout(initial); clearInterval(interval); };
}
module.exports = { config, fetchBatch, runSync, getStatus, startScheduler };
