// รายชื่อแบรนด์ — ตอนนี้ยังถูกก็อปไว้อีกหลายไฟล์ (Dashboard/Ads/Projects/...)
// จะย้ายมาใช้ที่นี่ให้ครบตอนขั้นเปลี่ยนตัวกรองจากทีมเป็นแบรนด์
export const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];

// ป้ายบทบาท — ต้องตรงกับ server/src/data/roles.js
export const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', manager: 'Manager', member: 'Member', agency: 'Agency' };
// เห็นทุกแบรนด์ = admin เท่านั้น (Manager เห็นเฉพาะแบรนด์ที่กำหนดเหมือน Member ตั้งแต่ 21 ต.ค. 2026) — ต้องตรงกับ server/src/data/roles.js
export const seesAllBrands = user => !!user && user.role === 'admin';
// บทบาทที่ admin ต้องกำหนดแบรนด์ให้ (หน้า Users) — ต้องตรงกับ hasBrandList ฝั่ง server
export const hasBrandList = role => role === 'member' || role === 'manager';
// ตัวเลขต้นทุน (CPM / CPE / ค่าแอด) — admin + manager · ต้องตรงกับ canSeeCostMetrics ฝั่ง server (ไม่เกี่ยวกับแบรนด์)
export const canSeeCostMetrics = user => !!user && (user.role === 'admin' || user.role === 'manager');

// แก้หน้า Products & Targets ได้: admin + คนในทีม Ads (ผู้ใช้สั่ง 21 ต.ค. 2026 · ทีม Ads แก้ได้เฉพาะแบรนด์ที่ตัวเองมีสิทธิ์)
// ดูจากชื่อทีม (team_name ที่ /auth/me ส่งมา) — ต้องตรงกับ canManageCatalog ฝั่ง server (server/src/data/roles.js)
export const canManageCatalog = user => !!user && (user.role === 'admin'
    || (user.role !== 'agency' && String(user.team_name || '').trim().toLowerCase() === 'ads'));

// แบรนด์ที่ผู้ใช้คนนี้เห็นได้ — admin เห็นทุกแบรนด์
// member / manager ที่ยังไม่ได้รับแบรนด์จะได้ [] (ไม่มีอะไรให้เลือก)
export function visibleBrands(user) {
    if (seesAllBrands(user)) return BRANDS;
    const own = Array.isArray(user?.brands) ? user.brands.filter(Boolean) : [];
    return BRANDS.filter(b => own.includes(b));
}
