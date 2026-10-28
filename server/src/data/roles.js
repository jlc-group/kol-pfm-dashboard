/**
 * บทบาทผู้ใช้ — 3 ระดับ
 *   admin   = ผู้ดูแลระบบ เห็นทุกแบรนด์ + เข้าเมนูฝั่งผู้ดูแลระบบได้ (รอบทำจ่าย/ประวัติ/ผู้ใช้งาน/ทีม)
 *   manager = เห็นเฉพาะแบรนด์ที่ admin กำหนดให้ (เหมือน member — ผู้ใช้สั่ง 21 ต.ค. 2026 เดิมเห็นทุกแบรนด์)
 *             + เห็นตัวเลขต้นทุน (CPM / CPE / ค่าแอด) · เข้าเมนูฝั่งผู้ดูแลระบบไม่ได้
 *   member  = เห็นเฉพาะแบรนด์ที่ admin กำหนดให้ (เก็บได้หลายแบรนด์)
 *   agency  = เอเจนซี่ภายนอก ไม่เห็น dashboard เลย เข้าได้แค่หน้าลิงก์ของตัวเอง
 *
 * แยกไฟล์ไว้เพราะทั้ง route / store / หน้าจอ ต้องตัดสินด้วยกติกาชุดเดียวกัน
 * ถ้าเขียนกระจายจะเพี้ยนกันเองตอนแก้
 */
const ROLES = ['admin', 'manager', 'member', 'agency'];
const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', manager: 'Manager', member: 'Member', agency: 'Agency' };

// เห็นข้อมูลได้ทุกแบรนด์ไหม — admin เท่านั้น (Manager ไม่เห็นทุกแบรนด์แล้วตั้งแต่ 21 ต.ค. 2026)
function seesAllBrands(user) {
    return !!user && user.role === 'admin';
}

// แก้หน้า Products & Targets ได้: admin (ทุกแบรนด์) + คนในทีม Ads (เฉพาะแบรนด์ที่ตัวเองมีสิทธิ์ — routes/catalog.js ตรวจแบรนด์ของสินค้า)
// ผู้ใช้สั่ง 21 ต.ค. 2026 "หน้านี้ขอให้ฝั่ง Ads เข้าถึงได้" · ดูทีมจากชื่อทีม (team_name จาก users JOIN teams) — ย้ายเข้า/ออกทีม Ads = ได้/เสียสิทธิ์ทันที
// ต้องตรงกับ canManageCatalog ฝั่งหน้าเว็บ (client/src/data/brands.js)
const isAdsTeam = user => !!user && user.role !== 'agency' && String(user.team_name || '').trim().toLowerCase() === 'ads';
const canManageCatalog = user => !!user && (user.role === 'admin' || isAdsTeam(user));

// ทีม Reviewer (เดิมชื่อ KOL · เปลี่ยน 28 ต.ค. 2026) = คนตรวจคลิป — ตั้งเป็นคนตรวจได้เฉพาะคนในทีมนี้ + มีหน้า "งานของฉัน" (My Work)
// ผู้ใช้สั่ง 28 ต.ค. 2026 "หน้า My Work ให้ขึ้นแค่คนที่ตั้งเป็น Reviewer เท่านั้น" · Admin ยังเข้าได้ (ดูงานของทุกคน)
// ดูจากชื่อทีมเหมือนทีม Ads — ต้องตรงกับ canUseMyWork ฝั่งหน้าเว็บ (client/src/data/brands.js)
const isReviewerTeam = user => !!user && user.role !== 'agency' && String(user.team_name || '').trim().toLowerCase() === 'reviewer';
const canUseMyWork = user => !!user && (user.role === 'admin' || isReviewerTeam(user));

// บทบาทที่เก็บรายการแบรนด์ที่ดูได้ (admin กำหนดให้) — member + manager · admin เห็นทุกแบรนด์ / agency ไม่ใช้
// ต้องตรงกับ hasBrandList ฝั่งหน้าเว็บ (client/src/data/brands.js)
const hasBrandList = role => role === 'member' || role === 'manager';

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

module.exports = { ROLES, ROLE_LABEL, seesAllBrands, hasBrandList, allowedBrands, canSeeBrand, canSeeCostMetrics, canManageCatalog, isReviewerTeam, canUseMyWork, normalizeRole, isAgency, STATUSES, isApproved };
