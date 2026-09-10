const jwt = require('jsonwebtoken');
const store = require('../store');
const authenticated = Symbol('authenticated');

const JWT_SECRET = process.env.JWT_SECRET;

// ตรวจ JWT token จาก header "Authorization: Bearer <token>"
// ถ้าถูกต้อง → แนบ req.user = { id, username, role, team_id }
async function authenticate(req, res, next) {
    // Repeated router middleware must keep the fresh database identity.
    if (req[authenticated]) return next();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'ไม่พบ token กรุณาเข้าสู่ระบบ' });
    }

    let claims;
    try {
        claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
        return res.status(401).json({ status: 'error', message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }
    try {
        const account = await store.users.findById(claims.id);
        if (!account || account.is_active === false) {
            return res.status(401).json({ status: 'error', message: 'บัญชีนี้ไม่สามารถใช้งานได้' });
        }
        req.account = account;
        req.user = { ...claims, role: account.role, team_id: account.team_id, username: account.username };
        req[authenticated] = true;
        return next();
    } catch (error) { return next(error); }
}

// จำกัดเฉพาะบาง role (เช่น requireRole('admin'))
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.account || (req.account.status || 'active') !== 'active' || !allowedRoles.includes(req.account.role)) {
            return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์ทำรายการนี้' });
        }
        next();
    };
}

module.exports = { authenticate, requireRole };
