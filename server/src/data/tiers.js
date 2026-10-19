// "คละ Tier" (19 ต.ค. 2026) — ค่าที่ทีมตั้งเป็น Tier ของ Platform ในกลุ่ม แปลว่าไม่ล็อก Tier
// ตอนกรอกรายชื่อต้องเลือก Tier จริงของแต่ละคน (Nano / Micro / Macro / Mega) — ค่านี้ห้ามลงเป็น Tier ของคน
// หน้าเว็บรุ่นใหม่ไม่ส่งมาอยู่แล้ว (client/src/data/adGroups.js tiersOf ขยายเป็น 4 Tier)
// แต่แท็บที่เปิดค้างไว้ก่อน deploy (tiersOf รุ่นเก่า) จะเห็น "คละ Tier" เป็นตัวเลือกเดียว ล็อกช่องแล้วส่งมา → ตอบ 400 ให้รีเฟรช
const MIXED_TIER = 'คละ Tier';
const MIXED_TIER_MSG = 'กลุ่มนี้ตั้ง "คละ Tier" — ต้องเลือก Tier ของคนนี้ (Nano / Micro / Macro / Mega) ถ้าไม่มีให้เลือก กรุณารีเฟรชหน้า (กด F5)';
const isMixedTier = t => typeof t === 'string' && t.trim() === MIXED_TIER;
const mixedTierError = res => res.status(400).json({ status: 'error', code: 'MIXED_TIER', message: MIXED_TIER_MSG });

module.exports = { MIXED_TIER, MIXED_TIER_MSG, isMixedTier, mixedTierError };
