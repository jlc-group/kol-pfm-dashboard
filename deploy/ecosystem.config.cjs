// Reference entry for we-platform's shared ecosystem. PORT is supplied by production .env.
// Do not start until the port/domain and database have been confirmed.
module.exports = {
    apps: [{
        name: 'kol-pfm-dashboard-prod',
        cwd: 'D:/AI_WORKSPACE/Production/kol-pfm-dashboard',
        script: 'server/src/index.js',
        interpreter: 'node',
        env: {
            NODE_ENV: 'production', HOST: '127.0.0.1',
            UPLOAD_DIR: 'D:/AI_WORKSPACE/Persistent/kol-pfm-dashboard/uploads'
        },
        instances: 1, exec_mode: 'fork', watch: false, time: true,
        wait_ready: true, listen_timeout: 20000, kill_timeout: 12000,
        shutdown_with_message: true, min_uptime: '30s', max_restarts: 5,
        exp_backoff_restart_delay: 1000
    }, {
        name: 'kol-pfm-dashboard-tunnel',
        script: 'C:/Program Files (x86)/cloudflared/cloudflared.exe',
        args: '--config C:/Users/ADMIN/.cloudflared/kol-pfm-dashboard.yml --no-autoupdate tunnel run',
        cwd: 'C:/Users/ADMIN/.cloudflared',
        interpreter: 'none',
        instances: 1,
        watch: false,
        time: true,
        min_uptime: '30s',
        max_restarts: 5,
        exp_backoff_restart_delay: 1000
    }]
};
