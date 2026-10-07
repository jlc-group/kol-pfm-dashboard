// KOL-only evidence. Collecting it never changes effective counters or stamps.
const crypto = require('node:crypto');
const KEYS = ['views', 'likes', 'comments', 'saves', 'shares'];
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const STATUSES = new Set(['available', 'pending', 'source_not_found', 'source_unavailable', 'fetch_failed']);
const isoTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));

function normalize(row, now = Date.now()) {
    const fail = message => { const e = new Error(message); e.status = 400; throw e; };
    if (!row || !/^\d{1,50}$/.test(String(row.id_post || ''))) fail('ID Post ไม่ถูกต้อง');
    if (!STATUSES.has(row.status)) fail('สถานะยอด TikTok ไม่ถูกต้อง');
    const clean = { id_post: String(row.id_post), status: row.status, source: 'kol-tiktok-evidence' };
    if (row.status !== 'available') return clean;
    if (!isoTime(row.collected_at) || Date.parse(row.collected_at) > now) fail('ต้องระบุเวลาที่ดึงยอดสำเร็จจริงพร้อม timezone');
    clean.collected_at = new Date(row.collected_at).toISOString();
    clean.metrics = {};
    for (const key of KEYS) {
        const value = row.metrics?.[key];
        if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
            || !Number.isSafeInteger(Number(value)) || Number(value) < 0) fail('ยอด TikTok ต้องครบทั้ง 5 ช่องและเป็นจำนวนเต็มตั้งแต่ 0');
        clean.metrics[key] = Number(value);
    }
    clean.evidence_id = crypto.createHash('sha256').update(JSON.stringify([clean.id_post, clean.collected_at, clean.metrics])).digest('hex');
    return clean;
}

function record(previous, incoming, observedAt) {
    const old = previous || {};
    const evidence = old.tiktok_evidence;
    if (evidence?.id_post === incoming.id_post && incoming.status === 'available'
        && Date.parse(incoming.collected_at) <= Date.parse(evidence.collected_at)) return null;
    const retained = evidence?.id_post === incoming.id_post ? evidence : {};
    return { ...old, tiktok_evidence: { ...retained, ...incoming, observed_at: observedAt } };
}

function selectable(row, evidenceId, now = Date.now()) {
    const e = row.perf_sources?.tiktok_evidence;
    const collected = Date.parse(e?.collected_at || '');
    const received = Date.parse(e?.observed_at || '');
    return Boolean(/^tiktok/i.test(String(row.platform || '').trim()) && e?.status === 'available'
        && e.id_post === String(row.id_post || '').trim() && e.evidence_id === evidenceId
        && Number.isFinite(collected) && Number.isFinite(received) && collected <= received && received <= now
        && now - collected <= MAX_AGE_MS && now - received <= MAX_AGE_MS
        && KEYS.every(k => Number.isSafeInteger(e.metrics?.[k]) && e.metrics[k] >= 0) && e.metrics.views > 0);
}

module.exports = { KEYS, MAX_AGE_MS, normalize, record, selectable };
