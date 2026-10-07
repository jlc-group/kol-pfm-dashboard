const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADS_SYNC_KEY = crypto.randomBytes(32).toString('hex');
process.env.KOL_TIKTOK_EVIDENCE_ENABLED = 'false';
delete process.env.KOL_TIKTOK_EVIDENCE_URL;
delete process.env.KOL_TIKTOK_EVIDENCE_KEY;
const { pool } = require('../server/src/config/db');
pool.query = async () => { throw new Error('Must not query real database'); };
pool.connect = async () => { throw new Error('Must not connect to real database'); };
const store = require('../server/src/store');
const sync = require('../server/src/services/tiktokEvidenceSync');
const jwt = require('../server/node_modules/jsonwebtoken');
const app = require('../server/src/app');
const user = { id: 77, role: 'admin', status: 'active', is_active: true };
store.users.findById = async () => user;
let project, row, fetched = 0, applied = 0, server, base;
store.projects.findByIdFull = async () => project;
store.submissions.get = async () => row;
store.submissions.update = async () => { throw new Error('Fetching evidence must never change effective counters'); };
store.tiktokEvidence.apply = async () => { applied++; return { stored: 1, stale: 0, not_found: [] }; };
const token = jwt.sign({ id: user.id, role: 'admin' }, process.env.JWT_SECRET);
const request = (url, options = {}) => fetch(base + url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
before(async () => {
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => server.close(r)); await pool.end(); });
test('internal status and pull require the sync credential; public status requires login', async () => {
    assert.equal((await fetch(base + '/api/ads-sync/tiktok-evidence-status')).status, 401);
    assert.equal((await fetch(base + '/api/ads-sync/pull-tiktok-evidence', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/api/ads/tiktok-evidence-status')).status, 401);
    const res = await request('/api/ads/tiktok-evidence-status'); assert.equal(res.status, 200);
    assert.deepEqual(Object.keys((await res.json()).data).sort(), ['configured', 'reason']);
    const pull = await fetch(base + '/api/ads-sync/pull-tiktok-evidence', { method: 'POST', headers: { 'X-Ads-Sync-Key': process.env.ADS_SYNC_KEY } });
    assert.equal(pull.status, 503); assert.equal(applied, 0);
});
test('project fetch rejects wrong project, unsupported brands/platforms and missing post IDs before provider access', async () => {
    const original = sync.fetchBatch;
    sync.fetchBatch = async () => { fetched++; return []; };
    try {
        project = { id: 1, brand: 'Beauterry' };
        row = { id: 2, project_id: 2, platform: 'TikTok', id_post: '123' };
        assert.equal((await request('/api/projects/1/submissions/2/fetch-tiktok', { method: 'POST' })).status, 404);
        row.project_id = 1; project.brand = "Jula's Herb";
        assert.equal((await request('/api/projects/1/submissions/2/fetch-tiktok', { method: 'POST' })).status, 409);
        project.brand = 'Beauterry'; row.platform = 'Instagram';
        assert.equal((await request('/api/projects/1/submissions/2/fetch-tiktok', { method: 'POST' })).status, 400);
        row.platform = 'TikTok'; row.id_post = '';
        assert.equal((await request('/api/projects/1/submissions/2/fetch-tiktok', { method: 'POST' })).status, 400);
        assert.equal(fetched, 0); assert.equal(applied, 0);
    } finally { sync.fetchBatch = original; }
});
test('project fetch stores separate evidence only and never calls the old effective-counter update', async () => {
    const original = sync.fetchBatch;
    project = { id: 1, brand: 'Beauterry' }; row = { id: 2, project_id: 1, platform: 'TikTok', id_post: '123', views: 9000 };
    sync.fetchBatch = async ids => { assert.deepEqual(ids, ['123']); return [{ id_post: '123', status: 'pending' }]; };
    try {
        const res = await request('/api/projects/1/submissions/2/fetch-tiktok', { method: 'POST' });
        assert.equal(res.status, 200); assert.equal((await res.json()).data.views, 9000); assert.equal(applied, 1);
    } finally { sync.fetchBatch = original; }
});
