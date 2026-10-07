// Additive migration for KOL only. Default is a read-only preview.
const { pool } = require('../server/src/config/db');
(async () => {
    const meta = (await pool.query('SELECT current_database() AS database')).rows[0];
    const existing = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='submissions' AND column_name='perf_sources'");
    console.log(JSON.stringify({ database: meta.database, columnExists: existing.rowCount > 0, apply: process.argv.includes('--apply') }));
    if (process.argv.includes('--apply')) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout = '5s'");
            await client.query('ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS perf_sources JSONB');
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        console.log('Performance source column ready; existing metrics and stamps unchanged.');
    }
})().catch(e => { console.error(e.code || e.name); process.exitCode = 1; }).finally(() => pool.end());
