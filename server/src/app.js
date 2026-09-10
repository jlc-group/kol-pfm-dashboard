require('./config/env');
const express = require('express');
const path = require('node:path');
const { root } = require('./config/runtime');
const { checkDatabase } = require('./services/readiness');
const cors = require('cors');
const store = require('./store');
const { authenticate } = require('./middleware/auth');
const { allowedBrands } = require('./data/roles');

// บัญชี role "agency" ห้ามแตะข้อมูลฝั่ง dashboard ทุกเส้น
// ประกาศไว้บนสุดเพราะ /api/stats/* อยู่เหนือจุด mount ของ routes อื่น
// ยังไม่อนุมัติ (หรือถูกปฏิเสธ/ถูกปิด) = ห้ามแตะข้อมูลใด ๆ
// ต้องอ่านสถานะจากฐานข้อมูลทุกครั้ง ไม่ใช่จาก token —
// token อายุ 7 วัน ถ้าเชื่อ token คนที่โดนปฏิเสธจะยังใช้ได้ต่ออีก 7 วัน
const blockPending = async (req, res, next) => {
    try {
        if (!req.user) return next();
        const u = req.account;
        const st = (u && u.status) || 'active';
        if (!u || u.is_active === false || st !== 'active') {
            return res.status(403).json({ status: 'error', message: 'บัญชียังไม่ได้รับอนุมัติให้ใช้งาน', code: 'PENDING' });
        }
        req.account = u;              // route ที่ต้องใช้ brands/agency_tokens อ่านต่อได้เลย
        next();
    } catch (err) { next(err); }
};
const blockAgency = (req, res, next) => {
    if (req.user && req.user.role === 'agency') {
        return res.status(403).json({ status: 'error', message: 'บัญชีเอเจนซี่เข้าส่วนนี้ไม่ได้ — ใช้ลิงก์งานของคุณแทน' });
    }
    next();
};

const app = express();
app.disable('x-powered-by');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'KOL Dashboard v2 API', timestamp: new Date().toISOString() });
});

app.get('/api/ready', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        await checkDatabase();
        res.json({ status: 'OK', service: 'KOL Dashboard v2 API' });
    } catch {
        res.status(503).json({ status: 'error', message: 'Database is not ready' });
    }
});

// สรุปตัวเลขภาพรวมสำหรับหน้า Dashboard (ตามแบรนด์ที่ผู้ใช้ดูได้)
app.get('/api/stats/overview', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scope = allowedBrands(req.account || req.user);
        const [total_kols, total_projects, total_teams,
               kols_by_platform, projects_by_status, members_by_team] = await Promise.all([
            store.kols.count(),
            store.projects.count(scope),
            store.meta.teamCount(),
            store.kols.platformCounts(),
            store.projects.statusCounts(scope),
            store.teams.memberCounts()
        ]);
        res.json({
            status: 'success',
            data: {
                total_kols, total_projects, total_teams,
                kols_by_platform, projects_by_status, members_by_team
            }
        });
    } catch (err) { next(err); }
});

// สรุปข้อมูลหน้า Dashboard Overview ตามตัวกรอง (แบรนด์/วันที่/campaign)
app.get('/api/stats/dashboard', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { brand, from, to, project_id } = req.query;
        const data = await store.dashboard.overview({
            scopeBrands,
            brand: brand || undefined,
            from: from || undefined,
            to: to || undefined,
            projectId: project_id || undefined
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// สรุปงบประมาณ ตามตัวกรอง (เดือน/แบรนด์) + เคารพสิทธิ์ทีม
app.get('/api/stats/budget', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { brand, from, to } = req.query;
        const data = await store.budget.overview({
            scopeBrands, brand: brand || undefined, from: from || undefined, to: to || undefined
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// เทรนด์งบรายเดือน
app.get('/api/stats/budget/trend', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { brand, year } = req.query;
        const data = await store.budget.trend({
            scopeBrands, brand: brand || undefined, year: year || String(new Date().getFullYear())
        });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// รายงานแคมเปญ (Campaign Reports) — KOLS/BUDGET/USED/POST RATE ต่อแคมเปญ
app.get('/api/stats/reports', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const { brand } = req.query;
        const data = await store.reports.campaigns({ scopeBrands, brand: brand || undefined });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// รายงานเชิงลึกของ 1 แคมเปญ (Report Analysis)
app.get('/api/stats/reports/:id', authenticate, blockPending, blockAgency, async (req, res, next) => {
    try {
        const scopeBrands = allowedBrands(req.account || req.user);
        const data = await store.reports.detail(req.params.id, scopeBrands);
        if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบแคมเปญ' });
        res.json({ status: 'success', data });
    } catch (err) { next(err); }
});

// routes
app.use('/api/auth', require('./routes/auth'));

app.use('/api/teams', authenticate, blockPending, blockAgency, require('./routes/teams'));
app.use('/api/users', authenticate, blockPending, blockAgency, require('./routes/users'));
app.use('/api/kols', authenticate, blockPending, blockAgency, require('./routes/kols'));
app.use('/api/projects', authenticate, blockPending, blockAgency, require('./routes/projects'));
app.use('/api/payments', authenticate, blockPending, blockAgency, require('./routes/payments'));
app.use('/api/activity', authenticate, blockPending, blockAgency, require('./routes/activity'));
// ระบบยิงแอดของบริษัทยิงเข้ามาเอง ใช้ API key ไม่ใช่บัญชีคน จึงต้องอยู่นอกเส้นที่บังคับล็อกอิน
app.use('/api/ads-sync', require('./routes/adsSync'));
app.use('/api/ads', authenticate, blockPending, blockAgency, require('./routes/ads'));
app.use('/api/rate-requests', authenticate, blockPending, blockAgency, require('./routes/rateRequests'));
app.use('/api/agency', require('./routes/agency')); // สาธารณะ (Agency ใช้ลิงก์)

// Missing API routes and missing assets must not return successful HTML.
app.use('/api', (req, res) => res.status(404).json({ status: 'error', message: 'API route not found' }));
const frontend = path.join(root, 'client', 'dist');
app.use(express.static(frontend, { index: false, setHeaders(res, filename) {
    if (filename.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
} }));
app.get('*', (req, res, next) => {
    if (req.path.split('/').some(segment => segment.startsWith('.')) || path.extname(req.path) || !req.accepts('html')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontend, 'index.html'));
});

// error handler
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    // err.status = ข้อผิดพลาดที่ตั้งใจให้เกิด (เช่น 409 ข้อมูลถูกล็อก) ไม่ใช่บั๊กของระบบ
    const status = err.status || 500;
    res.status(status).json({ status: 'error', message: status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal server error' : err.message || 'Internal server error' });
});

module.exports = app;
