const express = require('express');
const store = require('../store');
const { authenticate, parseLimit } = require('../services/kolContentExport');

const router = express.Router();

// GET /api/integrations/beauterry/content-candidates
// Read-only feed for Beauterry's content importer. It never changes KOL data.
router.get('/content-candidates', async (req, res, next) => {
    const auth = authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ status: 'error', code: auth.code, message: auth.message });

    const limit = parseLimit(req.query.limit, auth.settings.maxLimit);
    if (limit === null) {
        return res.status(400).json({ status: 'error', code: 'INVALID_LIMIT', message: `limit must be an integer between 1 and ${auth.settings.maxLimit}.` });
    }

    let updatedSince = null;
    if (req.query.updated_since) {
        const parsed = new Date(String(req.query.updated_since));
        if (!Number.isFinite(parsed.getTime())) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UPDATED_SINCE', message: 'updated_since must be a valid ISO datetime.' });
        }
        updatedSince = parsed.toISOString();
    }

    try {
        const rows = await store.contentExport.listCandidates({
            brand: auth.settings.brand,
            limit: limit + 1,
            updatedSince
        });
        const items = rows.slice(0, limit);
        res.json({
            status: 'success',
            data: {
                count: items.length,
                has_more: rows.length > limit,
                items,
                filters: {
                    brand: auth.settings.brand,
                    platform: 'TikTok',
                    ad_status: 'ยังไม่ยิง'
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
