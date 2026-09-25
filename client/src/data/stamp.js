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
