const { query } = require('./_base');

// ===== Token ระบบต่อระบบ (11 พ.ย. 2026 · มาตรฐาน token ของ JLC) =====
// ตาราง system_tokens เก็บเฉพาะ SHA-256 ของ token — ชั้นนี้ไม่เคยเห็น token ตัวจริง (services/systemTokens.js แฮชก่อนส่งมา)
// และไม่มีเส้นไหน SELECT token_hash กลับออกไป (รายการของหน้า admin ใช้ LIST_COLS)
// ตารางยังไม่ถูกสร้าง (prod ยังไม่รัน setup-db): อ่านรายการ = ready:false · ออก / เพิกถอน = 503 · ประตูระบบ = 503 (โยน error ต่อ)

const noTable = e => !!e && e.code === '42P01';
const notReady = () => {
    const e = new Error('ยังไม่ได้สร้างตาราง system_tokens ในฐานข้อมูล — ต้องรัน setup-db ก่อน ถึงจะออก token ได้');
    e.status = 503;
    return e;
};
const fail = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};
const intId = id => { const n = Number(id); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

const LIST_COLS = 'id, name, scope, token_hint, created_by, created_at, last_used_at, revoked_at, revoked_by';
const TOUCH_MINUTES = 10;

const systemTokens = {
    // รายการทั้งหมด (ที่ใช้งานอยู่ขึ้นก่อน แล้วใหม่ → เก่า) · ready:false = ยังไม่มีตาราง
    async list() {
        try {
            const r = await query(
                `SELECT ${LIST_COLS}
                   FROM system_tokens
                  ORDER BY (revoked_at IS NOT NULL), created_at DESC, id DESC`
            );
            return { ready: true, rows: r.rows };
        } catch (e) {
            if (noTable(e)) return { ready: false, rows: [] };
            throw e;
        }
    },

    // ออก token: บันทึกแฮช + 4 ตัวท้าย · เกิน maxActive ตัวที่ใช้งานอยู่ในประตูเดียวกัน = ไม่ออก (คำสั่งเดียว นับกับเพิ่มไปด้วยกัน)
    async issue({ name, scope, tokenHash, tokenHint, byId, byName, maxActive }) {
        let r;
        try {
            r = await query(
                `INSERT INTO system_tokens (name, scope, token_hash, token_hint, created_by_id, created_by)
                 SELECT $1, $2, $3, $4, $5, $6
                  WHERE (SELECT COUNT(*) FROM system_tokens WHERE scope = $2 AND revoked_at IS NULL) < $7
                 RETURNING ${LIST_COLS}`,
                [name, scope, tokenHash, tokenHint, intId(byId), byName || null, maxActive]
            );
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
        if (!r.rows.length) {
            throw fail(400, `ประตู ${scope} มี token ที่ใช้งานอยู่ครบ ${maxActive} ตัวแล้ว — เพิกถอนตัวที่ไม่ใช้ก่อน แล้วค่อยออกใหม่`);
        }
        return r.rows[0];
    },

    // เพิกถอน = ใส่เวลา + ชื่อคนเพิกถอน ไม่ลบแถว · เพิกถอนซ้ำ / ไม่มีแถว = บอกชัด
    async revoke(id, byName) {
        const tokenId = intId(id);
        if (!tokenId) throw fail(404, 'ไม่พบ token นี้');
        try {
            const r = await query(
                `UPDATE system_tokens
                    SET revoked_at = now(), revoked_by = $2
                  WHERE id = $1 AND revoked_at IS NULL
                 RETURNING ${LIST_COLS}`,
                [tokenId, byName || null]
            );
            if (r.rows.length) return r.rows[0];
            const seen = await query('SELECT id FROM system_tokens WHERE id = $1', [tokenId]);
            throw seen.rows.length ? fail(400, 'token นี้ถูกเพิกถอนไปแล้ว') : fail(404, 'ไม่พบ token นี้');
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    },

    // ประตูระบบถามทุกคำขอ (ไม่ cache — เพิกถอนแล้วมีผลตั้งแต่คำขอถัดไป) · แฮชต้องตรง + ประตูต้องตรง + ยังไม่ถูกเพิกถอน
    // ไม่จับ error: ฐานขัดข้อง / ยังไม่มีตาราง = โยนต่อ ให้ประตูตอบ 503 (ไม่ใช่ 401)
    async findActive(tokenHash, scope) {
        const r = await query(
            `SELECT id, name, scope, last_used_at
               FROM system_tokens
              WHERE token_hash = $1 AND scope = $2 AND revoked_at IS NULL`,
            [tokenHash, scope]
        );
        return r.rows[0] || null;
    },

    // "ใช้ล่าสุด" — เขียนไม่ถี่กว่า 10 นาทีครั้ง (เงื่อนไขอยู่ใน SQL ด้วย กันหลายคำขอพร้อมกันเขียนซ้ำ)
    async touch(id) {
        const tokenId = intId(id);
        if (!tokenId) return false;
        const r = await query(
            `UPDATE system_tokens
                SET last_used_at = now()
              WHERE id = $1
                AND (last_used_at IS NULL OR last_used_at < now() - make_interval(mins => $2::int))`,
            [tokenId, TOUCH_MINUTES]
        );
        return r.rowCount > 0;
    }
};

module.exports = { systemTokens, TOUCH_MINUTES };
