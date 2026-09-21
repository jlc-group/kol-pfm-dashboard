const crypto = require('node:crypto');

const DEFAULT_BRAND = 'Beauterry';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function enabledValue(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function config(env = process.env) {
    const requestedLimit = Number(env.KOL_CONTENT_EXPORT_MAX_LIMIT || MAX_LIMIT);
    return {
        enabled: enabledValue(env.KOL_CONTENT_EXPORT_ENABLED),
        key: String(env.KOL_CONTENT_EXPORT_KEY || ''),
        brand: String(env.KOL_CONTENT_EXPORT_BRAND || DEFAULT_BRAND).trim(),
        maxLimit: Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, MAX_LIMIT) : MAX_LIMIT
    };
}

function authenticate(request, env = process.env) {
    const settings = config(env);
    if (!settings.enabled) {
        return { ok: false, status: 503, code: 'CONTENT_EXPORT_DISABLED', message: 'Content export is disabled.' };
    }
    if (!settings.key) {
        return { ok: false, status: 503, code: 'CONTENT_EXPORT_NOT_CONFIGURED', message: 'Content export is not configured.' };
    }

    const supplied = String(request.get('X-KOL-Content-Key') || '');
    const expected = Buffer.from(settings.key);
    const got = Buffer.from(supplied);
    const valid = got.length === expected.length && crypto.timingSafeEqual(got, expected);
    if (!valid) {
        return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid API key.' };
    }
    return { ok: true, settings };
}

function parseLimit(value, maxLimit) {
    if (value === undefined || value === '') return DEFAULT_LIMIT;
    if (!/^\d+$/.test(String(value))) return null;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) return null;
    return limit;
}

module.exports = { config, authenticate, parseLimit, DEFAULT_LIMIT, MAX_LIMIT };
