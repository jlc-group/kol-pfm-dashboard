// ช่องค้นหาในหน้า Ads — พิมพ์ทีเดียวหาได้หลายช่อง ไม่สนตัวพิมพ์เล็ก-ใหญ่
// แยกไว้ในไฟล์ .js ให้เทสต์ import ได้ (ไฟล์ .jsx มี JSX เทสต์อ่านไม่ได้)
//
// ช่องที่ค้น: ชื่อ KOL, ชื่อแคมเปญ, รหัสสินค้า, Gencode, ID Post
// ไม่รวมแบรนด์/Platform เพราะมีปุ่มกรองของตัวเองอยู่แล้วด้านบน
export const ADS_SEARCH_FIELDS = ['account_name', 'project_name', 'product', 'gencode', 'id_post'];

// ตัดช่องว่างหัวท้าย + ตัด @ ข้างหน้า (ทีมมักก๊อปชื่อมาจาก TikTok / IG พร้อม @)
export function normalizeAdsQuery(query) {
    return String(query ?? '').trim().replace(/^@+/, '').toLowerCase();
}

// ช่องค้นหาว่าง = ผ่านทุกแถว
export function matchAdsSearch(row, query) {
    const q = normalizeAdsQuery(query);
    if (!q) return true;
    if (!row) return false;
    return ADS_SEARCH_FIELDS.some(k => String(row[k] ?? '').toLowerCase().includes(q));
}
