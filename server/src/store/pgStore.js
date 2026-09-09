/**
 * ชั้นเก็บข้อมูลบน PostgreSQL — หน้าตาเหมือน jsonStore ทุกประการ
 *
 * route ทั้ง 102 เส้นเรียกผ่าน interface เดียวกัน จึงสลับไดรเวอร์ได้โดยไม่ต้องแก้ route แม้แต่บรรทัดเดียว
 * ตัวจริงของแต่ละหมวดอยู่ในโฟลเดอร์ pg/ แยกไฟล์ตามโดเมน
 *
 * ตรรกะคำนวณ (CPM/CPE/การจัดกลุ่ม) ใช้ของกลางจาก logic.js ร่วมกับ jsonStore
 * เพื่อไม่ให้สองไดรเวอร์คำนวณต่างกัน
 */
const logic = require('./logic');

const { teams, meta } = require('./pg/teams');
const { users } = require('./pg/users');
const kols = require('./pg/kols');
const { projects } = require('./pg/projects');
const { projectKols, activity } = require('./pg/projectKols');
const submissions = require('./pg/submissions');
const { dashboard, budget } = require('./pg/dashboard');
const { payments, installments } = require('./pg/payments');
const { payBatches, rateRequests } = require('./pg/payBatches');
const { ads, adsSync } = require('./pg/ads');
const { reports } = require('./pg/reports');

module.exports = {
    // helper บริสุทธิ์ที่ route เรียกใช้ตรง ๆ (ใช้ชุดเดียวกับ jsonStore)
    resolveGroupClips: logic.resolveGroupClips,
    resolveGroupTarget: logic.resolveGroupTarget,
    resolveGroupProducts: logic.resolveGroupProducts,

    teams, users, kols, projects, projectKols, dashboard, payments,
    installments, payBatches, budget, activity, submissions,
    ads, adsSync, reports, rateRequests, meta,

    _duplicateError: logic.duplicateError
};
