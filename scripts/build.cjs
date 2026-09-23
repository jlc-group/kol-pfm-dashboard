const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function npm(args, cwd, env = process.env) {
    // Use npm's JS entrypoint so Windows does not need shell command interpolation.
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
        cwd, stdio: 'inherit', env
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`npm ${args.join(' ')} failed (status ${result.status ?? 'unknown'}${result.signal ? `, signal ${result.signal}` : ''})`);
    }
}

for (const part of ['server', 'client']) {
    npm(['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(root, part), {
        ...process.env,
        NODE_ENV: 'development'
    });
}
npm(['run', 'build'], path.join(root, 'client'), {
    ...process.env,
    NODE_ENV: 'production'
});

// The deploy validator loads Production's .env before starting this build.
// Tests must never inherit those DB credentials, integrations, or upload paths.
const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-pfm-dashboard-test-'));
const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_NAME: 'kol_pfm_test_only',
    DB_USER: 'kol_pfm_test_only',
    DB_PASSWORD: 'kol_pfm_test_only',
    PGHOST: '127.0.0.1',
    PGPORT: '1',
    PGDATABASE: 'kol_pfm_test_only',
    PGUSER: 'kol_pfm_test_only',
    PGPASSWORD: 'kol_pfm_test_only',
    UPLOAD_DIR: testUploadDir,
    JWT_SECRET: 'isolated-kol-pfm-tests-only-secret',
    BEAUTERRY_PFM_SYNC_ENABLED: 'false',
    KOL_CONTENT_EXPORT_ENABLED: 'false'
};
for (const key of ['DATABASE_URL', 'PGSSLMODE', 'BEAUTERRY_PFM_EXPORT_KEY', 'KOL_CONTENT_EXPORT_KEY']) {
    delete testEnv[key];
}
try {
    // A stuck test should fail with its test name instead of holding deploy for 15 minutes.
    npm(['test', '--', '--test-timeout=60000'], root, testEnv);
} finally {
    fs.rmSync(testUploadDir, { recursive: true, force: true });
}

// we-platform loads production environment before build. Fail before its PM2 restart.
if (process.env.NODE_ENV === 'production') npm(['run', 'check:production'], root);
