// Paid engagement must never become organic metrics.
function platformOf(value) {
    const p = String(value || '').trim().toLowerCase();
    return ['facebook', 'instagram'].includes(p) ? p : null;
}
function itemIdFor(row) {
    const platform = platformOf(row.platform);
    if (!platform) return null;
    const link = String(row.post_url || '').trim();
    try {
        const url = new URL(link);
        const host = url.hostname.toLowerCase();
        const valid = platform === 'instagram'
            ? /^(www\.)?instagram\.com$/.test(host) && /^\/(p|reel|tv)\/[^/]+/.test(url.pathname)
            : /^(www\.|m\.|web\.)?facebook\.com$/.test(host)
                && (/\/(posts|videos|permalink)\//.test(url.pathname) || url.searchParams.has('story_fbid'));
        if (valid && url.protocol === 'https:' && link.length <= 500) return link;
    } catch { /* Prefer a supported ID/code when no post URL is available. */ }
    const id = String(row.id_post || '').trim();
    if (/^\d{1,50}(?:_\d{1,50})?$/.test(id)) return id;
    const code = String(row.gencode || '').trim();
    return code && code.length <= 500 ? code : null;
}
function metricNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function sanitizeRow(row) {
    if (!row || typeof row.item_id !== 'string' || !platformOf(row.platform)) return null;
    const id = String(row.id_post || '');
    if (!/^\d{1,50}(?:_\d{1,50})?$/.test(id)) return null;
    const clean = { item_id: row.item_id, platform: platformOf(row.platform), id_post: id };
    for (const field of ['ad_spend', 'ad_reach']) {
        const value = metricNumber(row[field]);
        if (value !== undefined) clean[field] = value;
    }
    // WeBoostX fired means actual spend, unlike Beauterry's attached-ad flag.
    if (row.ad_launched === true && clean.ad_spend > 0) clean.ad_launched = true;
    const day = String(row.first_ad_date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))
        && new Date(day).toISOString().slice(0, 10) === day) clean.first_ad_date = day;
    return clean;
}
function patchFor(current, row) {
    const patch = {};
    if (row.ad_spend !== undefined && row.ad_spend > Number(current.ad_spend || 0)) patch.ad_spend = row.ad_spend;
    // Null is unknown, not zero. Never erase measured lifetime unique reach.
    if (row.ad_reach !== undefined && row.ad_reach > Number(current.ad_reach || 0)) patch.ad_reach = row.ad_reach;
    if (!String(current.id_post || '').trim()) patch.id_post = row.id_post;
    if (!current.ad_end && row.first_ad_date) patch.ad_end = row.first_ad_date;
    if (row.ad_launched === true && current.ad_status !== 'ยิงแล้ว') patch.ad_status = 'ยิงแล้ว';
    return patch;
}
module.exports = { platformOf, itemIdFor, sanitizeRow, patchFor };
