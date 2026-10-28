const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('../store');
const { authenticate } = require('../middleware/auth');
const { displayName, nameKey, cleanNickname, cleanUsername, nameTaken, usernameTaken } = require('../data/userNames');

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

// ---- แก้ชื่อของตัวเอง (ผู้ใช้สั่ง 28 ต.ค. 2026 "เจ้าของ Account แก้ชื่อและรหัสของตัวเองได้") ----
// ชื่อที่แสดงเก็บที่ nickname — ทุกหน้าโชว์ nickname ก่อน full_name / username (เมนูซ้าย · ช่องเลือกคนตรวจ / Owner · ประวัติ)
// กติกาชื่อ (ความยาว / ตัวมองไม่เห็น / ชื่อซ้ำ) อยู่ที่ data/userNames.js — ใช้ร่วมกับหน้า Users ของ Admin

// PUT /api/auth/profile — { nickname?, username?, current_password?, keep_name? } แก้ชื่อที่แสดง / ชื่อล็อกอินของตัวเอง
// เปลี่ยนชื่อล็อกอินต้องยืนยันรหัสผ่านปัจจุบัน (เหมือนเปลี่ยนรหัส) · ชื่อที่แสดงไม่ต้อง
// ชื่อล็อกอินห้ามซ้ำใคร (ไม่สนตัวพิมพ์) · ชื่อที่แสดงห้ามซ้ำคนในทีมที่ใช้งานอยู่ (ช่องเลือกคนแยกคนจากชื่อ)
// เอเจนซี่ / บัญชีที่ยังไม่อนุมัติ แก้ไม่ได้ (ให้ Admin แก้ในหน้า Users) · ลงประวัติทุกครั้ง
router.put('/profile', authenticate, async (req, res, next) => {
    try {
        const me = await store.users.findById(req.user.id);
        if (!me || me.is_active === false) return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้' });
        if (me.role === 'agency' || (me.status || 'active') !== 'active') {
            return res.status(403).json({ status: 'error', message: 'บัญชีนี้แก้ชื่อเองไม่ได้ — ติดต่อผู้ดูแลระบบ' });
        }
        const body = req.body || {};
        const fields = {};
        if (body.nickname !== undefined) {
            const n = cleanNickname(body.nickname);
            if (n.error) return res.status(400).json({ status: 'error', message: n.error });
            if (n.value !== (me.nickname || '')) fields.nickname = n.value;
        }
        if (body.username !== undefined) {
            const u = cleanUsername(body.username);
            if (u.error) return res.status(400).json({ status: 'error', message: u.error });
            if (u.value !== me.username) fields.username = u.value;
        }
        // keep_name: เปลี่ยนแค่ username ตอนที่ยังไม่มีชื่อที่แสดง / ชื่อเต็ม (เมนูโชว์ username อยู่) → เก็บ username เดิมเป็นชื่อที่แสดง
        // ชื่อที่โชว์จะได้ไม่เปลี่ยนตามเงียบ ๆ · ตัดสินจากข้อมูลในฐาน ไม่ใช่ค่าที่หน้าเว็บถือไว้ (อาจเก่า · ผลรีวิว 28 ต.ค. รอบ 2)
        if (fields.username && body.keep_name === true && body.nickname === undefined
            && !String(me.nickname || '').trim() && !String(me.full_name || '').trim()) {
            const k = cleanNickname(me.username);
            if (k.value) fields.nickname = k.value;
        }
        if (!Object.keys(fields).length) return res.status(400).json({ status: 'error', message: 'ยังไม่ได้เปลี่ยนอะไร' });

        // ยืนยันรหัสก่อนตรวจชื่อซ้ำ — คนที่ไม่รู้รหัสจะไล่ลองว่ามีชื่อล็อกอินไหนอยู่ในระบบไม่ได้
        if (fields.username) {
            if (!body.current_password) {
                return res.status(400).json({ status: 'error', message: 'กรุณาใส่รหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนชื่อล็อกอิน' });
            }
            if (!(await bcrypt.compare(String(body.current_password), me.password_hash))) {
                return res.status(401).json({ status: 'error', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
            }
        }

        const users = await store.users.listWithTeam();
        if (fields.username && usernameTaken(users, me.id, fields.username)) {
            return res.status(409).json({ status: 'error', message: 'มีคนใช้ชื่อล็อกอินนี้แล้ว' });
        }
        // ตรวจเฉพาะตอนชื่อที่แสดงเปลี่ยนจริง (ไม่สนตัวพิมพ์ / ช่องว่าง) — ชื่อเดิมที่บังเอิญซ้ำอยู่แล้วไม่ขวางการแก้ช่องอื่น
        const before = displayName(me);
        const after = displayName({ ...me, ...fields });
        if (nameKey(after) !== nameKey(before) && nameTaken(users, me.id, after)) {
            return res.status(409).json({ status: 'error', message: `มีคนใช้ชื่อ "${after}" แล้ว — เติมให้ต่างกันหน่อย เช่น ตัวย่อนามสกุล` });
        }

        try {
            await store.users.update(me.id, fields);
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ status: 'error', message: 'มีคนใช้ชื่อล็อกอินนี้แล้ว' });
            throw err;
        }
        const changes = [];
        if (after !== before) changes.push(`ชื่อที่แสดง "${before}" → "${after}"`);
        if (fields.username) changes.push(`ชื่อล็อกอิน ${me.username} → ${fields.username}`);
        try {
            if (changes.length) {
                await store.activity.log({
                    user_id: me.id, team_id: me.team_id, action: 'update',
                    project_id: null, project_name: null, summary: `แก้บัญชีของตัวเอง: ${changes.join(' · ')}`
                });
            }
        } catch { /* บันทึกประวัติพลาดไม่ขวางงานหลัก */ }

        const fresh = await store.users.findById(me.id);
        const { password_hash, ...safe } = fresh || {};
        res.json({ status: 'success', user: safe });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
