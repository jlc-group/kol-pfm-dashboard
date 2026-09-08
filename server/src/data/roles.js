/**
 * บทบาทผู้ใช้ — 3 ระดับ
 *   admin   = ผู้ดูแลระบบ เห็นทุกแบรนด์ + เข้าเมนูฝั่งผู้ดูแลระบบได้ (รอบทำจ่าย/ประวัติ/ผู้ใช้งาน/ทีม)
 *   manager = เห็นทุกแบรนด์ แต่เข้าเมนูฝั่งผู้ดูแลระบบไม่ได้
 *   member  = เห็นเฉพาะแบรนด์ที่ admin กำหนดให้ (เก็บได้หลายแบรนด์)
 *   agency  = เอเจนซี่ภายนอก ไม่เห็น dashboard เลย เข้าได้แค่หน้าลิงก์ของตัวเอง
 *
 * แยกไฟล์ไว้เพราะทั้ง route / store / หน้าจอ ต้องตัดสินด้วยกติกาชุดเดียวกัน
 * ถ้าเขียนกระจายจะเพี้ยนกันเองตอนแก้
 */
const ROLES = ['admin', 'manager', 'member', 'agency'];
const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', manager: 'Manager', member: 'Member', agency: 'Agency' };

// เห็นข้อมูลได้ทุกแบรนด์ไหม
function seesAllBrands(user) {
    return !!user && (user.role === 'admin' || user.role === 'manager');
}

// แบรนด์ที่ผู้ใช้คนนี้ดูได้ — null = ทุกแบรนด์, [] = ยังไม่ได้รับแบรนด์ (ยังไม่เห็นอะไร)
function allowedBrands(user) {
    if (seesAllBrands(user)) return null;
    return Array.isArray(user && user.brands) ? user.brands.filter(Boolean) : [];
}

function canSeeBrand(user, brand) {
    const allow = allowedBrands(user);
    return allow === null || allow.includes(brand);
}

function normalizeRole(role) {
    return ROLES.includes(role) ? role : 'member';
}

// เอเจนซี่ห้ามแตะข้อมูลฝั่ง dashboard ทุกชนิด (เข้าได้แค่ /api/agency ที่ใช้ token)
const isAgency = user => !!user && user.role === 'agency';
// ตัวเลขต้นทุน (CPM / CPE / ค่าแอด) เห็นได้เฉพาะ admin กับ manager
// เพราะ CPM ถอดกลับเป็นค่ายิงแอดได้ด้วยเลขคณิตชั้นเดียว ซึ่งเป็นข้อมูลลับ
const canSeeCostMetrics = user => !!user && (user.role === 'admin' || user.role === 'manager');

// สถานะบัญชี: pending = สมัครแล้วรอ admin อนุมัติ (ยังไม่เห็นข้อมูลใด ๆ)
const STATUSES = ['pending', 'active', 'rejected'];
const isApproved = user => !!user && (user.status || 'active') === 'active' && user.is_active !== false;

module.exports = { ROLES, ROLE_LABEL, seesAllBrands, allowedBrands, canSeeBrand, canSeeCostMetrics, normalizeRole, isAgency, STATUSES, isApproved };
