// คอลัมน์ภายในที่ห้ามส่งให้เบราว์เซอร์เลย ไม่ว่าเส้นไหน บทบาทไหน (19 ต.ค. 2026 · รูปปกโพสต์จาก WeBoostX)
//   weboostx_thumbnail_path = path บนเครื่อง WeBoostX (ดึงรูปได้ด้วย key ฝั่ง server เท่านั้น)
//   thumbnail_local = ชื่อไฟล์สำเนาในเครื่องเรา · thumbnail_error = สาเหตุที่ดาวน์โหลดไม่ได้ (ข้อมูลภายใน)
// หลายเส้นส่งแถว submissions แบบ SELECT * ออกไปตรง ๆ — ตัดที่ JSON ของทุกคำตอบ (app.set('json replacer')) ทีเดียว
// แทนการไล่ตัดทีละเส้น (เส้นใหม่ในอนาคตก็ไม่หลุด) · หน้าเว็บได้รูปผ่าน row.thumb (/ads/:id/thumb?v=...) อย่างเดียว
// thumbnail_fetched_at ตัดด้วย — หน้าเว็บไม่ได้ใช้ และบอกเอเจนซี่ได้ว่าโพสต์ไหนอยู่ใน KOL Studio ของ WeBoostX
const PRIVATE_KEYS = new Set(['weboostx_thumbnail_path', 'thumbnail_local', 'thumbnail_error', 'thumbnail_fetched_at']);
const privateFieldReplacer = (key, value) => (PRIVATE_KEYS.has(key) ? undefined : value);

module.exports = { PRIVATE_KEYS, privateFieldReplacer };
