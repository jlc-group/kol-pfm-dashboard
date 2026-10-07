// Opt-in integration check: creates an empty disposable database, never copies production rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
require('../server/src/config/env');
const { Client } = require('../server/node_modules/pg');
const name = `kol_perf_test_${crypto.randomBytes(8).toString('hex')}`;
if (!/^kol_perf_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid test database name');
const admin = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'postgres' });
let pool, blocker, created = false;
(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    process.env.DB_NAME = name;
    process.env.NODE_ENV = 'test';
    ({ pool } = require('../server/src/config/db'));
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, name);
    await pool.query(fs.readFileSync(path.join(__dirname, '../server/src/models/schema.sql'), 'utf8'));
    await pool.query("INSERT INTO teams (id,name) VALUES (1,'Integration fixture')");
    await pool.query("INSERT INTO projects (id,team_id,name,brand) VALUES (1,1,'Integration fixture','Beauterry')");
    await pool.query("INSERT INTO submissions (id,project_id,account_name,platform,id_post,budget,views) VALUES (1,1,'fixture','TikTok','7600000000000000001',3000,1000)");
    const { adsSync } = require('../server/src/store/pg/ads');
    const submissions = require('../server/src/store/pg/submissions');
    const { metricsOf } = require('../server/src/store/performanceSources');
    blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM submissions WHERE id=1 FOR UPDATE');
    const manual = { mode: 'manual', manual: { metrics: { views: 9000, likes: 0, comments: 0, saves: 0, shares: 0, reposts: 0 }, saved_at: new Date().toISOString(), by: 'fixture' } };
    const stamp = { at: '2026-10-07T12:00:00Z', views: 9000, engagement: 100, ad_spend: 3000 };
    await blocker.query('UPDATE submissions SET views=9000, perf_sources=$1, perf_stamp=$2 WHERE id=1', [manual, stamp]);
    const api = { id_post: '7600000000000000001', pfm_source: 'beauterry-pfm',
        views: 12000, likes: 100, comments: 10, saves: 5, shares: 5,
        ad_spend: 5000, ad_reach: 3000, organic_metrics_status: 'available', source_updated_at: new Date().toISOString() };
    let finished = false;
    const sync = adsSync.apply([api]).then(value => { finished = true; return value; });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
        const state = await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'", [name]);
        if (state.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, 'sync must wait for the manual transaction row lock');
    assert.equal(finished, false);
    await blocker.query('COMMIT');
    blocker.release(); blocker = null;
    await sync;
    let row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    assert.equal(Number(row.views), 9000);
    assert.deepEqual(row.perf_stamp, stamp);
    assert.equal(row.perf_sources.api.metrics.views, 12000);
    assert.equal(Number(row.ad_spend), 5000);
    assert.equal(Number(row.ad_reach), 3000);
    const baseline = metricsOf(row);
    await submissions.update(1,1,{ views: 15000, perf_from: baseline },'fixture');
    await assert.rejects(submissions.update(1,1,{ views: 17000, perf_from: baseline },'fixture'), {status:409});
    row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    await submissions.update(1,1,{ perf_mode: 'api', perf_from: metricsOf(row) },'fixture');
    row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    assert.equal(Number(row.views),12000);
    assert.equal(row.perf_sources.manual.metrics.views,15000);
    assert.deepEqual(row.perf_stamp,stamp);
    const { tiktokEvidence } = require('../server/src/store/pg/tiktokEvidence');
    const isolated = { id_post: api.id_post, status: 'available', collected_at: new Date(Date.now() - 1000).toISOString(),
        metrics: { views: 19000, likes: 190, comments: 19, saves: 0, shares: 0 } };
    const beforeIsolated = structuredClone(row);
    blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM submissions WHERE id=1 FOR UPDATE');
    let evidenceFinished = false;
    const collecting = tiktokEvidence.apply([isolated]).then(result => { evidenceFinished = true; return result; });
    let evidenceWaiting = false;
    for (let i = 0; i < 100; i++) {
        const state = await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'", [name]);
        if (state.rowCount) { evidenceWaiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(evidenceWaiting, true); assert.equal(evidenceFinished, false);
    await blocker.query('COMMIT'); blocker.release(); blocker = null;
    await collecting;
    row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    for (const key of Object.keys(row).filter(k => k !== 'perf_sources')) assert.deepEqual(row[key], beforeIsolated[key], key);
    await submissions.update(1,1,{ perf_mode: 'isolated', perf_evidence_from: row.perf_sources.tiktok_evidence.evidence_id,
        perf_from: metricsOf(row) },'fixture');
    row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    assert.equal(Number(row.views),19000); assert.equal(row.perf_sources.mode,'manual');
    assert.equal(row.perf_sources.manual.origin.source,'kol-tiktok-evidence'); assert.deepEqual(row.perf_stamp,stamp);
    await adsSync.apply([{ ...api, views: 29000 }]);
    row = (await pool.query('SELECT * FROM submissions WHERE id=1')).rows[0];
    assert.equal(Number(row.views),19000);
    console.log(JSON.stringify({database:name, realRowLock:true, manualPreserved:true, stampPreserved:true,
        paidSyncContinues:true, staleFormRejected:true, explicitApiSelection:true, isolatedEvidenceOnly:true, isolatedEvidenceRowLock:true, selectedIsolatedCopyFrozen:true}));
})().catch(error => { console.error(error.code || error.message); process.exitCode=1; }).finally(async () => {
    if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
    if (pool) await pool.end();
    if (created) { await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); console.log('Disposable test database removed.'); }
    await admin.end();
});
