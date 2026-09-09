/**
 * Connection pool ไปยัง PostgreSQL (ฐานข้อมูลหลักของระบบ)
 *
 * อ่านค่าจาก server/.env — ดู .env.example ประกอบ
 * ใช้ร่วมกันทั้ง pgStore, สคริปต์ย้ายข้อมูล และสคริปต์สร้างตาราง
 */
const path = require('path');
const { Pool } = require('pg');
// ระบุ path ของ .env ตายตัว — ไม่งั้นสคริปต์ที่รันจากโฟลเดอร์อื่นจะหาไฟล์ไม่เจอ
// แล้วไปต่อ DB ด้วยค่าว่าง ซึ่ง error ที่ได้ ('password must be a string') ชี้ต้นเหตุไม่ตรงจุด
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    ssl: false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
});

// idle client พังเงียบ ๆ ได้ (เช่นเน็ตหลุด/DB restart) — ต้องดักไว้ ไม่งั้น process ตายทั้งตัว
pool.on('error', (err) => {
    console.error('❌ PostgreSQL idle client error:', err.message);
});

async function testConnection() {
    try {
        const r = await pool.query('SELECT NOW()');
        console.log('✅ เชื่อมต่อ PostgreSQL แล้ว:', r.rows[0].now);
        return true;
    } catch (err) {
        console.error('❌ เชื่อมต่อ PostgreSQL ไม่ได้:', err.message);
        return false;
    }
}

function query(text, params) {
    return pool.query(text, params);
}

/**
 * รันหลายคำสั่งใน transaction เดียว — ใช้กับงานที่ต้อง "สำเร็จทั้งหมด หรือไม่สำเร็จเลย"
 * เช่น สร้างรอบทำจ่ายพร้อมรายการย่อย หรือลบแคมเปญพร้อมข้อมูลลูก
 * นี่คือสิ่งที่ไฟล์ JSON ทำไม่ได้ ถ้าดับกลางคันข้อมูลจะค้างครึ่ง ๆ กลาง ๆ
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ถ้า rollback ไม่ได้ก็ปล่อย error เดิมขึ้นไป */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction, testConnection };
