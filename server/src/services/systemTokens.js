const crypto = require('node:crypto');
const store = require('../store');

// ===== Token ระบบต่อระบบ (11 พ.ย. 2026 · มาตรฐาน token ของ JLC — ชุดเดียวกับ Affiliate Hub ahx_ / WeBoostX wbx_) =====
// admin ออก token จากหน้า "Token ระบบ" ให้ระบบอื่นมาดึงข้อมูล — ไม่มี key ใน .env ไม่ต้อง restart
//   รูปแบบ  kol_ + สุ่ม 32 ไบต์ base64url (43 ตัว) · prefix บอกว่า token มาจาก KOL dashboard
//   เก็บ    SHA-256 เท่านั้น (+ 4 ตัวท้ายไว้ให้คนดู) — ตัวจริงแสดงครั้งเดียวตอนออก ไม่เก็บ ไม่ log
//   ขอบเขต  token เปิดได้เฉพาะประตู (scope) ที่ออกให้ · ส่งทาง header ของประตูนั้นเท่านั้น
//           ไม่อ่าน Authorization: Bearer (นั่นคือล็อกอินของคน) และไม่อ่าน query string
//   รหัสตอบ 401 = ไม่ส่ง / รูปแบบผิด / ไม่รู้จัก / ถูกเพิกถอน / ผิดประตู · 503 = ตรวจ token ไม่ได้ชั่วคราว (ฐานข้อมูลขัดข้อง / ยังไม่มีตาราง)
const PREFIX = 'kol_';
const TOKEN_SHAPE = /^kol_[A-Za-z0-9_-]{43}$/;
const MAX_ACTIVE_PER_SCOPE = 20;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

// ประตูระบบที่ออก token ได้ — เพิ่มประตูใหม่ = เพิ่มแถวที่นี่ + ผูก machineDoor(scope) ที่ route ของประตูนั้น
const DOORS = [
    {
        scope: 'ad-rights',
        label: 'วันหมดอายุ Gencode ของโพสต์ KOL (WeBoostX)',
        header: 'X-KOL-Ad-Rights-Key',
        path: '/api/integrations/ad-rights'
    }
];
const doorOf = scope => DOORS.find(d => d.scope === scope) || null;

const hashOf = token => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

// token ใหม่ 1 ตัว — ผู้เรียกส่ง token ให้ admin ครั้งเดียว แล้วเก็บแค่ hash + hint
function generate() {
    const token = PREFIX + crypto.randomBytes(32).toString('base64url');
    return { token, hash: hashOf(token), hint: token.slice(-4) };
}

const deny = res => res.status(401).json({
    status: 'error', code: 'INVALID_TOKEN',
    message: 'token ไม่ถูกต้อง ถูกเพิกถอน หรือไม่ได้ออกให้ประตูนี้'
});
const unavailable = res => res.status(503).json({
    status: 'error', code: 'TOKEN_CHECK_UNAVAILABLE',
    message: 'ตรวจ token ไม่ได้ชั่วคราว — ลองใหม่ภายหลัง'
});

// middleware ของประตูระบบ: ผ่านได้เฉพาะ token ของ scope นี้ที่ยังไม่ถูกเพิกถอน
// ถามฐานข้อมูลทุกคำขอ (ไม่ cache) — เพิกถอนแล้วมีผลตั้งแต่คำขอถัดไป
function machineDoor(scope) {
    const door = doorOf(scope);
    if (!door) throw new Error(`unknown machine door: ${scope}`);
    const headerName = door.header.toLowerCase();

    return async function machineDoorGuard(req, res, next) {
        res.set('Cache-Control', 'no-store');
        const sent = req.headers[headerName];
        // header ซ้ำ (array) / ว่าง / รูปแบบไม่ใช่ token ของเรา = 401 โดยไม่แตะฐานข้อมูล
        if (typeof sent !== 'string' || !TOKEN_SHAPE.test(sent)) return deny(res);

        let row;
        try {
            row = await store.systemTokens.findActive(hashOf(sent), scope);
        } catch {
            // ไม่พิมพ์ error ดิบ (ไม่มี token อยู่ในนั้น แต่ไม่จำเป็นต้องเสี่ยง) — ผู้เรียกลองใหม่รอบถัดไป
            console.error(`❌ system token check failed (door ${scope})`);
            return unavailable(res);
        }
        if (!row) return deny(res);

        // "ใช้ล่าสุด": เขียนไม่ถี่กว่า 10 นาที · ไม่รอ ไม่ให้พลาดแล้วขวางคำขอ
        const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
        if (!last || !Number.isFinite(last) || Date.now() - last >= TOUCH_EVERY_MS) {
            Promise.resolve()
                .then(() => store.systemTokens.touch(row.id))
                .catch(() => { /* อัปเดต "ใช้ล่าสุด" พลาดไม่ขวางการดึงข้อมูล */ });
        }

        req.systemToken = { id: row.id, name: row.name, scope: row.scope };
        return next();
    };
}

module.exports = {
    PREFIX, TOKEN_SHAPE, MAX_ACTIVE_PER_SCOPE, TOUCH_EVERY_MS, DOORS,
    doorOf, hashOf, generate, machineDoor
};
