const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('../server/node_modules/express');
const route = require('../server/src/routes/contentExport');
const store = require('../server/src/store');
const { authenticate, config, parseLimit } = require('../server/src/services/kolContentExport');

test('content export is disabled by default', () => {
    assert.equal(config({}).enabled, false);
    assert.equal(authenticate({ get: () => '' }, {}).status, 503);
});

test('content export authenticates with its own key', () => {
    const request = { get: name => name === 'X-KOL-Content-Key' ? 'content-key' : '' };
    const env = { KOL_CONTENT_EXPORT_ENABLED: 'true', KOL_CONTENT_EXPORT_KEY: 'content-key', KOL_CONTENT_EXPORT_BRAND: 'Beauterry' };
    assert.equal(authenticate(request, env).ok, true);
    assert.equal(authenticate({ get: () => 'wrong' }, env).status, 401);
});

test('content export parses safe limits', () => {
    assert.equal(parseLimit(undefined, 500), 100);
    assert.equal(parseLimit('500', 500), 500);
    assert.equal(parseLimit('501', 500), null);
    assert.equal(parseLimit('nope', 500), null);
});

test('content export route returns the filtered read-only feed', async () => {
    const original = store.contentExport.listCandidates;
    store.contentExport.listCandidates = async args => {
        assert.deepEqual(args, { brand: 'Beauterry', limit: 3, updatedSince: null });
        return [
            { submission_id: 7, id_post: '123', brand: 'Beauterry', platform: 'TikTok', ad_status: 'ยังไม่ยิง' },
            { submission_id: 8, id_post: '456', brand: 'Beauterry', platform: 'TikTok', ad_status: 'ยังไม่ยิง' },
            { submission_id: 9, id_post: '789', brand: 'Beauterry', platform: 'TikTok', ad_status: 'ยังไม่ยิง' }
        ];
    };
    const app = express();
    app.use('/api/integrations/beauterry', route);
    try {
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const url = `http://127.0.0.1:${server.address().port}/api/integrations/beauterry/content-candidates?limit=2`;
        const response = await fetch(url, { headers: { 'X-KOL-Content-Key': 'content-key' } });
        assert.equal(response.status, 503);
        server.close();

        process.env.KOL_CONTENT_EXPORT_ENABLED = 'true';
        process.env.KOL_CONTENT_EXPORT_KEY = 'content-key';
        process.env.KOL_CONTENT_EXPORT_BRAND = 'Beauterry';
        const enabledServer = app.listen(0, '127.0.0.1');
        await new Promise(resolve => enabledServer.once('listening', resolve));
        const enabledUrl = `http://127.0.0.1:${enabledServer.address().port}/api/integrations/beauterry/content-candidates?limit=2`;
        const enabledResponse = await fetch(enabledUrl, { headers: { 'X-KOL-Content-Key': 'content-key' } });
        assert.equal(enabledResponse.status, 200);
        const payload = await enabledResponse.json();
        assert.equal(payload.data.count, 2);
        assert.equal(payload.data.has_more, true);
        assert.deepEqual(payload.data.filters, { brand: 'Beauterry', platform: 'TikTok', ad_status: 'ยังไม่ยิง' });
        enabledServer.close();
    } finally {
        store.contentExport.listCandidates = original;
        delete process.env.KOL_CONTENT_EXPORT_ENABLED;
        delete process.env.KOL_CONTENT_EXPORT_KEY;
        delete process.env.KOL_CONTENT_EXPORT_BRAND;
    }
});
