const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('../store');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register — สมัครเอง แล้วรอ admin อนุมัติ
// สมัครแล้วยังเข้าใช้อะไรไม่ได้เลยจนกว่าจะอนุมัติ (status = pending)
router.post('/register', async (req, res, next) => {
    try {
        const { username, password, full_name } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ status: 'error', message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
        }
        const password_hash = await bcrypt.hash(password, 10);
        // สมัครเองได้แค่ member และยังไม่มีแบรนด์ — admin เป็นคนกำหนดทีหลัง
        await store.users.create({
            username: String(username).trim(), password_hash,
            full_name: full_name || null,
            role: 'member', brands: [], agency_tokens: [], status: 'pending'
        });
        res.status(201).json({ status: 'success', message: 'สมัครเรียบร้อย รอผู้ดูแลระบบอนุมัติ' });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ status: 'error', message: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });
        next(err);
    }
});

// POST /api/auth/login — เข้าสู่ระบบ คืน JWT token
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'กรุณากรอก username และ password' });
        }

        const user = await store.users.findByUsername(username);
        if (!user || !user.is_active) {
            return res.status(401).json({ status: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, team_id: user.team_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            status: 'success',
            token,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                nickname: user.nickname || null,
                role: user.role,
                status: user.status || 'active',
                brands: user.brands || [],
                agency_tokens: user.agency_tokens || [],
                team_id: user.team_id,
                team_name: user.team_name
            }
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/me — ดูข้อมูลผู้ใช้ปัจจุบันจาก token
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const user = await store.users.findById(req.user.id);
        if (!user) return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
        const { password_hash, ...safe } = user;
        res.json({ status: 'success', user: safe });
    } catch (err) {
        next(err);
    }
});

// PUT /api/auth/password — เปลี่ยนรหัสผ่านของตัวเอง (ต้องยืนยันรหัสเดิมก่อน)
router.put('/password', authenticate, async (req, res, next) => {
    try {
        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password) {
            return res.status(400).json({ status: 'error', message: 'กรุณากรอกทั้งรหัสผ่านเดิมและรหัสผ่านใหม่' });
        }
        if (String(new_password).length < 8) {
            return res.status(400).json({ status: 'error', message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
        }
        if (current_password === new_password) {
            return res.status(400).json({ status: 'error', message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });
        }

        const user = await store.users.findById(req.user.id);
        if (!user || !user.is_active) {
            return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
        }

        // ยืนยันรหัสเดิมก่อนเสมอ — กันคนอื่นมาเปลี่ยนรหัสตอนเจ้าของลุกจากเครื่อง
        const ok = await bcrypt.compare(current_password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ status: 'error', message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
        }

        const password_hash = await bcrypt.hash(new_password, 10);
        await store.users.update(user.id, { password_hash });

        // token เดิมยังใช้ได้จนหมดอายุ (ระบบไม่ได้เก็บ session ฝั่งเซิร์ฟเวอร์)
        res.json({ status: 'success', message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
