const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

function within(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function uploadDirectory(env = process.env) {
    const configured = env.UPLOAD_DIR;
    if (env.NODE_ENV === 'production') {
        if (!configured || !path.isAbsolute(configured)) {
            throw new Error('Production requires an absolute UPLOAD_DIR outside the deployment folder');
        }
        if (within(root, path.resolve(configured))) {
            throw new Error('UPLOAD_DIR must be outside the deployment folder to survive auto deploy');
        }
        if (!fs.existsSync(configured) || !fs.statSync(configured).isDirectory()) {
            throw new Error('Production UPLOAD_DIR must be provisioned before deployment');
        }
        if (within(fs.realpathSync(root), fs.realpathSync(configured))) {
            throw new Error('UPLOAD_DIR must not link into the deployment folder');
        }
        fs.accessSync(configured, fs.constants.R_OK | fs.constants.W_OK);
    }
    return configured ? path.resolve(configured) : path.join(root, 'server', 'uploads');
}

function validateRuntime(env = process.env) {
    if (env.NODE_ENV !== 'production') return;
    const missing = ['JWT_SECRET', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'PORT']
        .filter(key => !env[key]);
    if (missing.length) throw new Error(`Missing production settings: ${missing.join(', ')}`);
    if (env.JWT_SECRET.length < 32 || /change_this|your_secret|example/i.test(env.JWT_SECRET)) {
        throw new Error('Production requires a non-example JWT_SECRET of at least 32 characters');
    }
    for (const key of ['PORT', 'DB_PORT']) {
        if (!/^\d+$/.test(String(env[key])) || Number(env[key]) < 1 || Number(env[key]) > 65535) {
            throw new Error(`${key} must be an integer between 1 and 65535`);
        }
    }
    uploadDirectory(env);
    if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
        throw new Error('Frontend build missing; run npm run build before starting production');
    }
}

module.exports = { root, uploadDirectory, validateRuntime };
