process.env.NODE_ENV = 'production';
require('../server/src/config/env');
const { validateRuntime } = require('../server/src/config/runtime');

(async () => {
    let pool;
    try {
        validateRuntime();
        ({ pool } = require('../server/src/config/db'));
        await require('../server/src/services/readiness').checkDatabase();
        console.log('Production config, frontend build and database tables: ready');
    } catch (error) {
        // Never print connection strings or driver errors containing credentials.
        console.error('Production preflight failed. Check required settings, build and database schema.');
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
    }
})();
