// รายชื่อแบรนด์ — ตอนนี้ยังถูกก็อปไว้อีกหลายไฟล์ (Dashboard/Ads/Projects/...)
// จะย้ายมาใช้ที่นี่ให้ครบตอนขั้นเปลี่ยนตัวกรองจากทีมเป็นแบรนด์
export const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];

// ป้ายบทบาท — ต้องตรงกับ server/src/data/roles.js
export const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', manager: 'Manager', member: 'Member' };
export const seesAllBrands = user => !!user && (user.role === 'admin' || user.role === 'manager');
