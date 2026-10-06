// เกณฑ์ค่าแอดสะสมที่ระบบจะล็อกผล PFM (สแตมป์) — สำเนาของ server/src/store/logic.js
// ต้องตรงกับฝั่ง server ทุกตัวอักษร (tests/stamp-threshold.test.cjs เทียบข้อความสองฝั่งให้)
// หน้าเว็บใช้แค่ตอนถามยืนยัน/บอกตัวเลขในคำอธิบาย — คนสแตมป์จริงคือ server เท่านั้น
export const AD_STAMP_AT = 10000;
export const AD_STAMP_BY_BRAND = { Beauterry: 3000 };
export const stampAtFor = brand => AD_STAMP_BY_BRAND[String(brand == null ? '' : brand).trim()] || AD_STAMP_AT;

// เกณฑ์ของแถวหนึ่งในหน้า Ads / Influencers — server ส่ง stamp_at มาให้แล้ว
// (ถอยไปใช้ค่ากลางเมื่อเปิดหน้าค้างจากรุ่นก่อนหน้าที่ยังไม่ส่งช่องนี้)
export const stampAtOf = row => Number(row && row.stamp_at) || AD_STAMP_AT;

// เลขไว้โชว์ในข้อความ เช่น "3,000 บาท"
export const stampAtText = at => (Number(at) || AD_STAMP_AT).toLocaleString('th-TH');
// ===== เหตุที่คลิปยังไม่มียอดวิว (ป้าย Not rated / Awaiting data · 2 ต.ค. 2026) =====
// server ส่ง views_reason มากับแถว (server/src/store/logic.js viewsMissingReason) → { short: บรรทัดเล็กใต้ป้าย, long: คำอธิบายเต็ม }
// ไม่รู้จัก reason (server รุ่นก่อน) = null → หน้าเว็บใช้ข้อความเดิม
export function viewsReasonText(reason, row = {}) {
    const plat = String((row && row.platform) || '').trim() || 'Platform นี้';
    const idPost = String((row && row.id_post) || '').trim();
    switch (reason) {
        // Facebook / Instagram: WeBoostX ส่งแค่ค่าแอด / Reach (ไม่ส่งยอดวิว organic) — ยอดวิวยังต้องกรอกเอง
        case 'not_tiktok': return { short: plat + ' · กรอกเอง', long: `ยอดวิว/engagement ของคลิป ${plat} ไม่มีระบบส่งมาให้ (PFM ส่งเฉพาะ TikTok · WeBoostX ส่งแค่ค่าแอด/Reach ของ Facebook/Instagram) — กรอกยอดเองที่ปุ่ม 📊 ในหน้า On Process ของแคมเปญ` };
        // TikTok ของแบรนด์ที่ยังไม่ต่อ PFM (ตอนนี้ต่อแค่ Beauterry · 6 ต.ค. 2026) — ระบบไม่ส่งไปถามยอด
        case 'no_pfm_brand': return { short: 'แบรนด์นี้ยังไม่มี PFM · กรอกเอง', long: `แบรนด์ ${String((row && row.brand) || '').trim() || 'นี้'} ยังไม่ได้ต่อระบบ PFM (ตอนนี้ต่อแค่ Beauterry) — ระบบจึงไม่ดึงยอดวิว/ค่าแอดให้ กรอกยอดเองที่ปุ่ม 📊 ในหน้า On Process ของแคมเปญ · สถานะยิงแล้วกดเองได้ที่หน้า Ads (ค่าแอดกรอกได้เฉพาะ Admin / Manager) · พอแบรนด์นี้ต่อ PFM ของตัวเองแล้ว ยอดจะเข้ามาเอง` };
        case 'no_id_post': return { short: 'ยังไม่มี ID Post', long: 'ยังไม่ได้ใส่ ID Post ของคลิปนี้ ระบบเลยยังไม่ได้ถามยอดจาก PFM — ใส่ ID Post แล้ว ถ้า PFM มีคลิปนี้ ยอดจะเข้ามาในรอบซิงก์ถัดไป (ปกติทุกชั่วโมง)' };
        case 'bad_id_post': return { short: 'ID Post ผิดรูปแบบ', long: `ID Post "${idPost}" ไม่ใช่ตัวเลขล้วน PFM จึงจับคู่คลิปไม่ได้ — แก้เป็นเลข ID ของคลิป (ตัวเลขท้ายลิงก์ TikTok)` };
        case 'dup_id_post': return { short: 'ID Post ซ้ำ', long: 'ID Post นี้ซ้ำกับโพสต์อื่น — ยอดจาก PFM ลงที่โพสต์แรกที่ใช้ ID นี้โพสต์เดียว · แก้ ID Post ให้ตรงกับคลิปของโพสต์นี้ หรือกรอกยอดเองที่ปุ่ม 📊' };
        case 'pfm_no_clip': return { short: 'ยังไม่ได้ยอดจาก PFM', long: 'ระบบส่ง ID Post ไปถาม PFM แล้ว แต่ยังไม่เคยได้ข้อมูลคลิปนี้กลับมา — ถ้าเพิ่งใส่ ID Post ให้รอรอบซิงก์ถัดไป (ปกติทุกชั่วโมง) · ถ้าค้างนาน แปลว่า PFM ไม่มีคลิปนี้ (PFM มีเฉพาะคลิปที่อยู่ในระบบ PFM) เช็ค ID Post ว่าตรงกับคลิปจริงไหม หรือกรอกยอดเองที่ปุ่ม 📊' };
        case 'pfm_no_views': return { short: 'ยังไม่มียอดวิว', long: 'ระบบซิงก์ได้ข้อมูลคลิปนี้แล้ว (เช่น ค่าแอด) แต่ยังไม่มียอดวิว/engagement — จะอัปเดตเองเมื่อต้นทางมียอด (ซิงก์ปกติทุกชั่วโมง)' };
        default: return null;
    }
}
