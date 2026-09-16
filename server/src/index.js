require('./config/env');
const { validateRuntime } = require('./config/runtime');

async function start() {
    validateRuntime();
    const { pool } = require('./config/db');
    if (process.env.NODE_ENV === 'production') {
        try {
            await require('./services/readiness').checkDatabase();
        } catch {
            await pool.end();
            throw new Error('Database is not ready; verify connection settings and schema before starting');
        }
    }
    const app = require('./app');
    const port = Number(process.env.PORT || 4000);
    const host = process.env.HOST || '127.0.0.1';
    let stopPfmSync = () => {};
    const server = app.listen(port, host, () => {
        console.log(`KOL Dashboard listening on http://${host}:${port}`);
        stopPfmSync = require('./services/beauterryPfmSync').startScheduler();
        if (process.send) process.send('ready');
    });
    let stopping = false;
    function shutdown() {
        if (stopping) return;
        stopping = true;
        stopPfmSync();
        const deadline = setTimeout(() => process.exit(1), 10000);
        deadline.unref();
        server.close(async () => {
            await pool.end();
            clearTimeout(deadline);
            process.exit(0);
        });
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('message', message => { if (message === 'shutdown') shutdown(); });
    server.on('error', async error => {
        console.error(`Server failed to listen (${error.code || 'unknown'})`);
        try {
            await pool.end();
        } finally {
            // Exit explicitly so PM2 can restart the service. Merely setting
            // exitCode can leave the instrumented process alive without a port.
            process.exit(1);
        }
    });
    return server;
}

if (require.main === module) {
    start().catch(error => {
        console.error(error.message);
        // PM2 must see a real process exit when PostgreSQL is not ready during
        // boot; otherwise it may report "online" while nothing listens on PORT.
        process.exit(1);
    });
}
module.exports = { start };
