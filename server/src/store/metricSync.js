function validTimestamp(value) {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : null;
}

function shouldApplyOrganicMetrics(sourceUpdatedAt, currentSyncedAt) {
    const source = validTimestamp(sourceUpdatedAt);
    const current = validTimestamp(currentSyncedAt);
    if (source === null) return current === null;
    return current === null || source > current;
}

function shouldApplyCumulativeMetric(sourceValue, currentValue, protectedSource) {
    if (!protectedSource) return true;
    const incoming = Number(sourceValue);
    const current = Number(currentValue) || 0;
    return Number.isFinite(incoming) && incoming >= current;
}

module.exports = { validTimestamp, shouldApplyOrganicMetrics, shouldApplyCumulativeMetric };
