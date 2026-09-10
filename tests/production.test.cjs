const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

// Never connect tests to an operator's database, even when a local .env exists.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-deploy-test-'));
const store = require('../server/src/store');
const { pool } = require('../server/src/config/db');
pool.query = async () => { throw new Error('Unexpected database query in isolated test'); };
pool.connect = async () => { throw new Error('Unexpected database connection in isolated test'); };
const jwt = require('../server/node_modules/jsonwebtoken');
const { uploadDirectory, validateRuntime, root } = require('../server/src/config/runtime');
const app = require('../server/src/app');
let server, base, account, accountReads, listed;
const adminToken = jwt.sign({ id: 7, role: 'admin', team_id: 1 }, process.env.JWT_SECRET);

before(async () => {
    store.users.findById = async () => { accountReads++; return account; };
    store.users.listWithTeam = async () => { listed++; return []; };
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

function user(fields = {}) {
    accountReads = 0; listed = 0;
    account = { id: 7, username: 'fixture', role: 'admin', team_id: 1, is_active: true, status: 'active', ...fields };
}
function request(url, token = adminToken, options = {}) {
    return fetch(`${base}${url}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
}

test('built frontend serves root and deep links from the API process', async () => {
    for (const url of ['/', '/login', '/projects/123', '/agency/example']) {
        const res = await fetch(base + url, { headers: { Accept: 'text/html' } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/html/);
        const html = await res.text();
        assert.match(html, /id="root"/);
        const asset = html.match(/src="([^\"]+\.js)"/)[1];
        assert.equal((await fetch(base + asset)).status, 200);
    }
});

test('missing API and missing assets return 404, not the SPA', async () => {
    assert.equal((await fetch(base + '/api/does-not-exist')).status, 404);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(base + '/server/.env')).status, 404);
});

test('health stays live while readiness reports database failure without leaking details', async () => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const res = await fetch(base + '/api/ready');
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'error', message: 'Database is not ready' });
});

test('a demoted admin cannot use its old token on admin routes', async () => {
    user({ role: 'member', team_id: 2 });
    assert.equal((await request('/api/users')).status, 403);
    assert.equal(listed, 0);
    assert.equal(accountReads, 1);
});

test('active admin succeeds and nested auth does not reset the current identity', async () => {
    user();
    assert.equal((await request('/api/users')).status, 200);
    assert.equal(listed, 1);
    assert.equal(accountReads, 1);
});

test('disabled and deleted accounts cannot use existing tokens', async () => {
    user({ is_active: false });
    assert.equal((await request('/api/users')).status, 401);
    account = null;
    assert.equal((await request('/api/auth/me')).status, 401);
});

test('pending accounts retain status page access but cannot enter dashboard or agency', async () => {
    user({ status: 'pending', role: 'member' });
    assert.equal((await request('/api/auth/me')).status, 200);
    assert.equal((await request('/api/users')).status, 403);
    assert.equal((await request('/api/agency/fixture')).status, 403);
});

test('old staff token cannot bypass changed agency role and assigned links', async () => {
    user({ role: 'agency', agency_tokens: [] });
    assert.equal((await request('/api/users')).status, 403);
    assert.equal((await request('/api/agency/fixture')).status, 403);
});

test('missing or forged tokens cannot access user data', async () => {
    assert.equal((await fetch(base + '/api/users')).status, 401);
    assert.equal((await request('/api/users', 'invalid')).status, 401);
});

test('production uploads must be absolute and outside the synced source', () => {
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production' }), /UPLOAD_DIR/);
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: 'uploads' }), /absolute/);
    assert.throws(() => uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: path.join(root, 'server/uploads') }), /outside/);
    assert.equal(uploadDirectory({ NODE_ENV: 'production', UPLOAD_DIR: process.env.UPLOAD_DIR }), process.env.UPLOAD_DIR);
});

test('multipart upload and authenticated download use the external upload directory', async () => {
    user();
    const project = { id: 23, name: 'fixture', team_id: 1, brand: 'fixture' };
    store.projects.findByIdFull = async () => project;
    store.projects.setBriefFile = async (id, meta) => { project.brief_file = meta; return project; };
    store.activity.log = async () => {};
    const payload = '%PDF-1.4\nfixture brief';
    const form = new FormData();
    form.append('file', new Blob([payload], { type: 'application/pdf' }), 'brief.pdf');
    const uploaded = await request('/api/projects/23/brief/upload', adminToken, { method: 'POST', body: form });
    assert.equal(uploaded.status, 200);
    const stored = path.join(process.env.UPLOAD_DIR, project.brief_file.filename);
    assert.equal(fs.readFileSync(stored, 'utf8'), payload);
    const downloaded = await request('/api/projects/23/brief/file');
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), payload);
    assert.equal((await fetch(base + '/api/projects/23/brief/file')).status, 401);
    assert.equal((await fetch(base + '/uploads/' + project.brief_file.filename)).status, 404);
    user({ role: 'member', brands: [] });
    assert.equal((await request('/api/projects/23/brief/file')).status, 403);
});

test('production refuses missing settings, sample secrets and invalid ports', () => {
    assert.throws(() => validateRuntime({ NODE_ENV: 'production' }), /Missing production settings/);
    const env = { NODE_ENV: 'production', JWT_SECRET: process.env.JWT_SECRET, DB_HOST: 'fixture', DB_PORT: '5432',
        DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASSWORD: 'fixture', PORT: '3080', UPLOAD_DIR: process.env.UPLOAD_DIR };
    assert.doesNotThrow(() => validateRuntime(env));
    assert.throws(() => validateRuntime({ ...env, JWT_SECRET: 'change_this_to_a_long_random_secret' }), /JWT_SECRET/);
    assert.throws(() => validateRuntime({ ...env, PORT: '0' }), /PORT/);
});
