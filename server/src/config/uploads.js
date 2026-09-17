const fs = require('node:fs');
const { uploadDirectory } = require('./runtime');
const UPLOAD_DIR = uploadDirectory();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const { resolveInside } = require('../store/logic');
// path จริงของไฟล์ที่ชื่อเก็บอยู่ในฐาน — null = ชื่อไม่ปลอดภัย ห้ามเอาไปอ่านหรือลบ
const uploadPath = name => resolveInside(UPLOAD_DIR, name);
module.exports = { UPLOAD_DIR, uploadPath };
