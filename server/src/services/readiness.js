const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');
const schema = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
// ตารางของฟีเจอร์เสริมที่ขาดได้โดยเว็บยังทำงาน — ไม่นับในด่านความพร้อม
// talents (Talent Book เพิ่มคนเอง 29 ก.ย. 2026): ถ้าโค้ดขึ้นก่อนรัน setup-db ทั้งเว็บต้องไม่ล่ม
// (แท็บ Talent Book ยังเปิดได้ — _snapshot กัน 42P01 · เส้นเพิ่มคนจะ error จนกว่าจะสร้างตาราง)
// talent_jobs (งานที่จ้างของคนใน Talent Book 1 ต.ค. 2026): กติกาเดียวกัน — อ่านได้ว่าง เส้นเพิ่มงานจะ error จนกว่าจะรัน setup-db
// catalog_products / catalog_targets (หน้า Products & Targets 7 ต.ค. 2026): ไม่มีตาราง = ใช้รายการสินค้า/Target ตั้งต้นในโค้ด
// (เส้นอ่านคืนค่าว่าง · เส้นบันทึกตอบ 503 บอกให้รัน setup-db)
const OPTIONAL_TABLES = new Set(['talents', 'talent_jobs', 'catalog_products', 'catalog_targets']);
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(match => match[1])
    .filter(name => !OPTIONAL_TABLES.has(name));

async function checkDatabase() {
    // A connection alone is insufficient: a fresh empty DB must fail readiness.
    const result = await pool.query({
        text: 'SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NULL',
        values: [tables], query_timeout: 5000
    });
    if (result.rows.length) throw new Error('Database schema is not ready');
}

module.exports = { checkDatabase };
