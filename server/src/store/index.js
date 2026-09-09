/**
 * เลือกชั้นเก็บข้อมูลตามค่า DATA_DRIVER ใน .env
 *
 * ที่เก็บจริงของระบบคือ PostgreSQL เท่านั้น — ข้อมูลย้ายเข้าฐานครบแล้ว
 * และไฟล์ data/db.json ถูกลบทิ้งไปแล้ว
 *
 * ไดรเวอร์ 'json' ยังมีโค้ดเหลืออยู่ (jsonStore.js) แต่ "ห้ามใช้เป็นที่เก็บ"
 * เพราะ jsonStore จะสร้างไฟล์เปล่าขึ้นมาใหม่เองถ้าหาไฟล์ไม่เจอ
 * ผลคือแอปจะเปิดติดตามปกติแต่ข้อมูลว่างเปล่า ซึ่งดูเหมือนข้อมูลหายทั้งระบบ
 * จึงตัดจบตรงนี้ด้วยการโยน error ให้รู้ตัวทันที ดีกว่าปล่อยให้เข้าใจผิด
 */
const driver = (process.env.DATA_DRIVER || 'postgres').toLowerCase();

if (driver !== 'postgres' && driver !== 'pg') {
    throw new Error(
        `DATA_DRIVER='${driver}' ใช้ไม่ได้แล้ว — ที่เก็บข้อมูลของระบบคือ PostgreSQL เท่านั้น\n` +
        `   ข้อมูลทั้งหมดย้ายเข้าฐาน kol_dashboard เรียบร้อยแล้ว และไฟล์ data/db.json ถูกลบทิ้งไปแล้ว\n` +
        `   แก้ที่ server/.env → DATA_DRIVER=postgres`
    );
}

const store = require('./pgStore');
console.log('🗄️  Data driver: PostgreSQL');

module.exports = store;
