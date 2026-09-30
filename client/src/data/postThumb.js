// คอลัมน์ IMAGE หน้า Ads — ตรรกะล้วน (ทดสอบได้โดยไม่ต้องเปิดเบราว์เซอร์)
// server ส่ง row.thumb มาเป็น path รูปปก (เฉพาะโพสต์ TikTok — ดู server/src/services/adThumbs.js thumbPath)

// path รูปต้องเป็นเส้นรูปปกของหน้า Ads เท่านั้น — fileBlobUrl แนบ token ให้ ไม่ยอมให้ข้อมูลพาไปเส้นอื่น
export const okThumbPath = p => typeof p === 'string' && /^\/ads\/\d+\/thumb\?v=[a-z0-9]{3,40}$/.test(p);

// ลิงก์โพสต์ที่กดเปิดได้ — เฉพาะ http/https (กัน javascript: / data: ที่แฝงมากับข้อมูล)
export function postHref(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch { return ''; }
}

// ชื่อแพลตฟอร์มสั้น ๆ บนกล่องที่ไม่มีรูป
const PLAT = [
    [/tiktok/i, 'TikTok'],
    [/instagram|^\s*ig\b/i, 'IG'],
    [/facebook|^\s*fb\b/i, 'FB'],
    [/youtube|^\s*yt\b/i, 'YouTube'],
    [/lemon/i, 'Lemon8'],
    [/twitter|^\s*x\s*$/i, 'X']
];
export function platformShort(platform) {
    const s = String(platform == null ? '' : platform);
    const hit = PLAT.find(([re]) => re.test(s));
    return hit ? hit[1] : s.trim().slice(0, 8);
}
