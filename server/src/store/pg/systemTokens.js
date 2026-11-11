const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('./_base');

// ===== Token ระบบต่อระบบ (11 พ.ย. 2026 · มาตรฐาน token ของ JLC) =====
// ตาราง system_tokens เก็บเฉพาะ SHA-256 ของ token — ชั้นนี้ไม่เคยเห็น token ตัวจริง (services/systemTokens.js แฮชก่อนส่งมา)
// และไม่มีเส้นไหน SELECT token_hash กลับออกไป (รายการของหน้า admin ใช้ LIST_COLS)
// ตารางยังไม่ถูกสร้าง: อ่านรายการ = ready:false · ออก / เพิกถอน = 503 · ประตูระบบ = 503 (โยน error ต่อ)
// สร้างได้สองทาง: admin กดปุ่ม "สร้างตาราง" ในหน้า Token ระบบ (createTable ข้างล่าง) หรือผู้ดูแลเซิร์ฟเวอร์รัน setup-db

const noTable = e => !!e && e.code === '42P01';
const noRight = e => !!e && e.code === '42501';
const fail = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};
const notReady = () => fail(503,
    'ยังไม่ได้สร้างตาราง system_tokens ในฐานข้อมูล — กดปุ่ม "สร้างตาราง" ในหน้า Token ระบบ (หรือรัน setup-db) ก่อน ถึงจะออก token ได้');

// ----- คำสั่งสร้างตาราง: อ่านจาก schema.sql ที่เดียว (ไม่มีสำเนาในโค้ด) และหยิบแค่ 2 คำสั่งของ system_tokens -----
// ปุ่มในหน้าเว็บรันได้เท่านี้ — ไม่ใช่ setup-db ทั้งไฟล์ (ไฟล์นั้นมี ALTER / trigger ของตารางอื่น ซึ่งต้องมีคนตรวจก่อนรันบน prod)
// [^;]* = หยุดที่ ; ตัวแรก คำสั่งเดียวจึงไม่มีทางลากไปถึงคำสั่งของตารางอื่น
const SCHEMA_FILE = path.join(__dirname, '../../models/schema.sql');
const TABLE_RE = /CREATE TABLE IF NOT EXISTS system_tokens \([^;]*\);/;
const INDEX_RE = /CREATE INDEX IF NOT EXISTS idx_system_tokens_scope ON system_tokens\([^;]*;/;
// คำที่การ "สร้างตารางเปล่า 1 ตาราง" ไม่ต้องใช้ — ถ้าวันหนึ่ง schema.sql ถูกแก้จนมีคำพวกนี้ในสองคำสั่งนี้ ปุ่มจะไม่รัน
const NOT_ALLOWED = /\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|TRIGGER|REFERENCES)\b/i;

function tableSql(schema) {
    const text = typeof schema === 'string' ? schema : fs.readFileSync(SCHEMA_FILE, 'utf8');
    const found = [TABLE_RE.exec(text), INDEX_RE.exec(text)];
    if (found.some(m => !m)) throw new Error('schema.sql: ไม่พบคำสั่งสร้างตาราง system_tokens');
    const statements = found.map(m => m[0].replace(/\r\n/g, '\n'));
    if (statements.some(s => NOT_ALLOWED.test(s))) {
        throw new Error('schema.sql: คำสั่งของ system_tokens มีมากกว่าการสร้างตาราง — ไม่รันจากหน้าเว็บ');
    }
    return statements;
}
const intId = id => { const n = Number(id); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

const LIST_COLS = 'id, name, scope, token_hint, created_by, created_at, last_used_at, revoked_at, revoked_by';
const TOUCH_MINUTES = 10;

const systemTokens = {
    // สร้างตาราง system_tokens กับ index ของมัน (ปุ่มในหน้า Token ระบบ) — สองคำสั่งใน transaction เดียว: ได้ทั้งคู่หรือไม่ได้เลย
    // IF NOT EXISTS ทั้งคู่: มีตารางอยู่แล้วก็ไม่เกิดอะไร · created = ก่อนกดยังไม่มีตาราง
    // บัญชีฐานข้อมูลของแอปไม่มีสิทธิ์สร้างตาราง (42501) = 503 บอกให้ใช้ setup-db แทน
    async createTable() {
        const statements = tableSql();
        try {
            return await withTransaction(async client => {
                const seen = await client.query("SELECT to_regclass('system_tokens') IS NOT NULL AS present");
                for (const sql of statements) await client.query(sql);
                return { created: !(seen.rows[0] && seen.rows[0].present) };
            });
        } catch (e) {
            if (noRight(e)) {
                throw fail(503, 'บัญชีฐานข้อมูลของแอปไม่มีสิทธิ์สร้างตาราง — ให้ผู้ดูแลเซิร์ฟเวอร์รัน npm run setup-db ในโฟลเดอร์ server หนึ่งครั้งแทน');
            }
            throw e;
        }
    },

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
    // ทุก parameter ระบุชนิดเอง: $2 ใช้สองที่ (ค่าที่ใส่ในคอลัมน์ varchar + เทียบ scope = ซึ่งเป็น text) ถ้าไม่ระบุ
    // Postgres เดาได้สองชนิดแล้วไม่รันเลย (42P08 inconsistent types deduced for parameter $2) — ออก token ไม่ได้สักตัว
    async issue({ name, scope, tokenHash, tokenHint, byId, byName, maxActive }) {
        let r;
        try {
            r = await query(
                `INSERT INTO system_tokens (name, scope, token_hash, token_hint, created_by_id, created_by)
                 SELECT $1::text, $2::text, $3::text, $4::text, $5::int, $6::text
                  WHERE (SELECT COUNT(*) FROM system_tokens WHERE scope = $2::text AND revoked_at IS NULL) < $7::int
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

module.exports = { systemTokens, tableSql, TOUCH_MINUTES };
