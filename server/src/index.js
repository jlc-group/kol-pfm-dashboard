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
    const server = app.listen(port, host, () => {
        console.log(`KOL Dashboard listening on http://${host}:${port}`);
        if (process.send) process.send('ready');
    });
    let stopping = false;
    function shutdown() {
        if (stopping) return;
        stopping = true;
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
        await pool.end();
        process.exitCode = 1;
    });
    return server;
}

if (require.main === module) {
    start().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
module.exports = { start };
