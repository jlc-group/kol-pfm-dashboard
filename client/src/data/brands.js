// รายชื่อแบรนด์ — ตอนนี้ยังถูกก็อปไว้อีกหลายไฟล์ (Dashboard/Ads/Projects/...)
// จะย้ายมาใช้ที่นี่ให้ครบตอนขั้นเปลี่ยนตัวกรองจากทีมเป็นแบรนด์
export const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];

// ป้ายบทบาท — ต้องตรงกับ server/src/data/roles.js
export const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', manager: 'Manager', member: 'Member' };
export const seesAllBrands = user => !!user && (user.role === 'admin' || user.role === 'manager');

// แบรนด์ที่ผู้ใช้คนนี้เห็นได้ — admin/manager เห็นทุกแบรนด์
// member ที่ยังไม่ได้รับแบรนด์จะได้ [] (ไม่มีอะไรให้เลือก)
export function visibleBrands(user) {
    if (seesAllBrands(user)) return BRANDS;
    const own = Array.isArray(user?.brands) ? user.brands.filter(Boolean) : [];
    return BRANDS.filter(b => own.includes(b));
}
