const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function npm(args, cwd) {
    // Use npm's JS entrypoint so Windows does not need shell command interpolation.
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
        cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: args[0] === 'ci' ? 'development' : 'production' }
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

for (const part of ['server', 'client']) {
    npm(['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(root, part));
}
npm(['run', 'build'], path.join(root, 'client'));
npm(['test'], root);
// we-platform loads production environment before build. Fail before its PM2 restart.
if (process.env.NODE_ENV === 'production') npm(['run', 'check:production'], root);
