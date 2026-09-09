/**
 * พื้นฐานร่วมของ pgStore ทุกโมดูล
 *
 * หน้าที่สำคัญที่สุดของไฟล์นี้คือ "ทำให้ค่าที่อ่านจาก PostgreSQL หน้าตาเหมือนที่ jsonStore เคยคืน"
 * ถ้าไม่ทำ ระบบจะเพี้ยนแบบเงียบ ๆ ในหลายที่:
 *   • NUMERIC ไดรเวอร์ pg คืนเป็น "สตริง" ไม่ใช่ตัวเลข → บวกเลขกลายเป็นต่อสตริง ("30000"+"5000" = "300005000")
 *   • TIMESTAMPTZ คืนเป็น Date object → โค้ดเรียงลำดับใช้ .localeCompare() ซึ่งใช้กับ Date ไม่ได้ (มี 20 จุดในระบบ)
 *   • DATE คืนเป็น Date object → วันที่เพี้ยนตาม timezone ของเครื่อง
 * จึงตั้ง type parser ให้คืนค่าแบบเดิมเป๊ะ: ตัวเลขเป็น number, เวลาเป็น ISO string, วันที่เป็น 'YYYY-MM-DD'
 */
const { types } = require('pg');
const { pool, query, withTransaction } = require('../../config/db');

// --- type parsers (ต้องตั้งก่อน query แรกเสมอ) ---
const OID = { NUMERIC: 1700, INT8: 20, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };

types.setTypeParser(OID.NUMERIC, v => (v === null ? null : Number(v)));
types.setTypeParser(OID.INT8,    v => (v === null ? null : Number(v)));
// วันที่ล้วน: คืนสตริงดิบ 'YYYY-MM-DD' — ห้ามแปลงเป็น Date เพราะจะโดน timezone เลื่อนวัน
types.setTypeParser(OID.DATE,    v => v);
// เวลา: คืน ISO string ลงท้าย Z เหมือน new Date().toISOString() ที่ jsonStore ใช้
types.setTypeParser(OID.TIMESTAMPTZ, v => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(OID.TIMESTAMP,   v => (v === null ? null : new Date(v + 'Z').toISOString()));

// --- ตัวช่วยแปลงค่า "ขาเข้า" ก่อนเขียนลง DB ---

// ช่องวันที่: ฟอร์มส่ง '' มาเวลาไม่ได้กรอก ซึ่ง DATE ของ Postgres รับไม่ได้ ต้องเป็น NULL
const asDate = v => (v === '' || v === undefined || v === null ? null : v);
// ช่องตัวเลข: รับทั้ง number และสตริงตัวเลข ('' = ไม่ได้กรอก)
const asNum = (v, d = 0) => {
    if (v === '' || v === undefined || v === null) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};
const asNumOrNull = v => {
    if (v === '' || v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const asText = v => (v === undefined || v === '' ? null : v);
const asBool = v => !!v;
// JSONB: ส่งเป็นสตริง JSON เพื่อไม่ให้ไดรเวอร์เดาชนิดผิดเวลาเจอ array
const asJson = (v, d = null) => {
    if (v === undefined || v === null) return d === null ? null : JSON.stringify(d);
    return JSON.stringify(v);
};

// --- ตัวช่วยสร้างคำสั่ง SQL ---

/** INSERT ... RETURNING * จาก object {คอลัมน์: ค่า} */
async function insertRow(table, data, client) {
    const cols = Object.keys(data);
    const vals = cols.map(c => data[c]);
    const ph = cols.map((_, i) => `$${i + 1}`);
    const q = `INSERT INTO ${table} (${cols.map(quoteCol).join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`;
    const r = await (client ? client.query(q, vals) : query(q, vals));
    return r.rows[0];
}

/** UPDATE ... WHERE id = $n RETURNING * — ไม่มีอะไรให้อัปเดตก็อ่านแถวเดิมคืนไป */
async function updateRow(table, id, data, client) {
    const cols = Object.keys(data);
    if (!cols.length) {
        const r = await (client ? client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
                                : query(`SELECT * FROM ${table} WHERE id = $1`, [id]));
        return r.rows[0] || null;
    }
    const sets = cols.map((c, i) => `${quoteCol(c)} = $${i + 1}`);
    const q = `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${cols.length + 1} RETURNING *`;
    const r = await (client ? client.query(q, [...cols.map(c => data[c]), id])
                            : query(q, [...cols.map(c => data[c]), id]));
    return r.rows[0] || null;
}

// คอลัมน์ที่ชนคำสงวนของ SQL ต้องใส่เครื่องหมายคำพูด (เช่น "of" ในตาราง installments)
const RESERVED = new Set(['of', 'from', 'to', 'order', 'group', 'user', 'end', 'default']);
const quoteCol = c => (RESERVED.has(c) ? `"${c}"` : c);

/**
 * ตั้งค่า sequence ของทุกตารางให้เลยเลข id ล่าสุด
 *
 * seq = ตัวนับ _seq จาก db.json (ถ้ามี) — ต้องใช้ค่านี้ ไม่ใช่ MAX(id)
 * เพราะตัวนับเดิม "ไม่ถอยกลับเมื่อลบแถว" เช่นเคยมี 5 แถวแล้วลบทิ้ง 2 MAX(id) จะเป็น 3
 * แต่แถวถัดไปต้องได้ 6 ไม่ใช่ 4 ถ้าตั้งจาก MAX(id) เลข id จะถูกใช้ซ้ำ ซึ่งของเดิมไม่เคยทำ
 */
async function resyncSequences(client, seq = {}) {
    const tables = ['teams', 'users', 'kols', 'projects', 'project_kols', 'agency_links',
                    'submissions', 'payments', 'installments', 'pay_batches',
                    'rate_requests', 'activity_logs'];
    const run = (q, p) => (client ? client.query(q, p) : query(q, p));
    for (const t of tables) {
        const want = Number(seq[t]) || 0;
        await run(
            `SELECT setval(pg_get_serial_sequence($1, 'id'),
                           GREATEST($2::bigint, (SELECT COALESCE(MAX(id), 0) FROM ${t}), 1),
                           GREATEST($2::bigint, (SELECT COALESCE(MAX(id), 0) FROM ${t})) > 0)`,
            [t, want]);
    }
}

module.exports = {
    pool, query, withTransaction,
    asDate, asNum, asNumOrNull, asText, asBool, asJson,
    insertRow, updateRow, quoteCol, resyncSequences
};
