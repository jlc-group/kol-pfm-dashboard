/**
 * ชื่อของผู้ใช้ — ชื่อที่แสดง (nickname) + ชื่อล็อกอิน (username)
 * เจ้าของบัญชีแก้เองได้ (routes/auth.js PUT /profile · ผู้ใช้สั่ง 28 ต.ค. 2026) · Admin แก้ให้ได้ (routes/users.js)
 * กติกาชุดเดียวกันทุกที่ — ต้องตรงกับหน้าเว็บ (client/src/components/ProfileModal.jsx)
 */
const NAME_MAX = 40;
const USERNAME_MIN = 3;
const USERNAME_MAX = 40;
// ตัวที่มองไม่เห็น — zero-width / bidi / soft hyphen (Cf) + ตัวที่ระบบไม่วาด (Default_Ignorable: ตัวเติมเกาหลี / CGJ / variation selector) + ช่องว่างอักษรเบรลล์
// ไม่งั้นตั้งชื่อให้หน้าตาเหมือนคนอื่นได้ทั้งที่ผ่านกติกาห้ามซ้ำ หรือตั้งชื่อว่างเปล่า (ผลรีวิว 28 ต.ค. 2 รอบ) · ข้อความไทยที่ก๊อปจากเว็บมักติด U+200B มาด้วย
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;   // ตัดทั้งหมด — ใช้ในกุญแจเทียบชื่อซ้ำ
// ตอนเก็บชื่อที่แสดง: คงตัวที่อีโมจิต้องใช้ (ZWJ 👩‍💻 · variation selector · tag ธงย่อย) ไม่งั้นอีโมจิแตกเป็นหลายตัว — กุญแจเทียบยังตัดทิ้งเหมือนเดิม
const HIDDEN = /(?![‍︎️\u{E0020}-\u{E007F}])[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;
const NAME_BAD = /(?![‍\u{E0020}-\u{E007F}])\p{C}/u;   // ตัวควบคุม / ยังไม่มีในมาตรฐาน ฯลฯ ที่เหลือหลังตัดแล้ว — ห้ามมีในชื่อที่แสดง
const VISIBLE = /[\p{L}\p{N}]/u;   // ชื่อที่แสดงต้องมีตัวอักษร / ตัวเลขอย่างน้อย 1 ตัว (ไม่ใช่แค่อีโมจิ / สัญลักษณ์)
const OTHER = /\p{C}/u;   // ชื่อล็อกอิน: ห้ามมีตัวควบคุม / ตัวมองไม่เห็นเลย (พิมพ์ตอนเข้าระบบไม่ได้)

// ชื่อที่โชว์ทุกที่ (เมนู · ช่องเลือกคน · ผู้บันทึก · ประวัติ): ชื่อที่แสดง → ชื่อเต็ม → username
const displayName = u => (u && (String(u.nickname || '').trim() || String(u.full_name || '').trim() || u.username)) || null;

// กุญแจเทียบชื่อซ้ำ: NFKC (ตัวเต็มความกว้าง / ตัวหน้าตาพิเศษ = ตัวปกติ) + ตัดตัวมองไม่เห็น + รวบช่องว่าง + ไม่สนตัวพิมพ์
// ใช้เทียบอย่างเดียว ไม่ใช้เก็บ — NFKC แยกสระอำ (U+0E33) เป็น 2 ตัว
const nameKey = v => String(v || '').normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();
const userKey = v => String(v || '').normalize('NFKC').trim().toLowerCase();

// ชื่อที่แสดง → { value } | { error } · allowEmpty = ล้างได้ (Admin · กลับไปโชว์ชื่อเต็ม / username)
function cleanNickname(v, { allowEmpty = false } = {}) {
    if (v === null && allowEmpty) return { value: '' };
    if (typeof v !== 'string') return { error: 'กรุณาใส่ชื่อที่แสดง' };
    const name = v.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
    if (!name) return allowEmpty ? { value: '' } : { error: 'กรุณาใส่ชื่อที่แสดง' };
    if (name.length > NAME_MAX) return { error: `ชื่อที่แสดงยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร` };
    if (NAME_BAD.test(name)) return { error: 'ชื่อที่แสดงมีตัวอักษรที่ใช้ไม่ได้' };
    if (!VISIBLE.test(name.replace(INVISIBLE, ''))) return { error: 'ชื่อที่แสดงต้องมีตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว' };
    return { value: name };
}

// ชื่อล็อกอิน → { value } | { error } · ไม่มีช่องว่าง / ตัวมองไม่เห็น (พิมพ์ตอนเข้าระบบไม่ได้ = ล็อกอินไม่ได้) · ตัวพิมพ์เล็ก/ใหญ่ต้องตรงตอนล็อกอิน
function cleanUsername(v) {
    if (typeof v !== 'string' || !v.trim()) return { error: 'กรุณาใส่ชื่อล็อกอิน (Username)' };
    const name = v.trim();
    if (/\s/.test(name)) return { error: 'ชื่อล็อกอินห้ามมีช่องว่าง' };
    if (OTHER.test(name)) return { error: 'ชื่อล็อกอินมีตัวอักษรที่ใช้ไม่ได้ (รวมตัวที่มองไม่เห็น)' };
    if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return { error: `ชื่อล็อกอินต้องยาว ${USERNAME_MIN}-${USERNAME_MAX} ตัวอักษร` };
    return { value: name };
}

// ชื่อที่แสดงซ้ำคนอื่นไหม — เทียบกับคนในทีมที่ใช้งานอยู่ (ไม่นับเอเจนซี่ / บัญชีปิด / รออนุมัติ / ตัวเอง)
// ช่องเลือกคนตรวจ / Owner แยกคนจากชื่อ ชื่อซ้ำ = เลือกผิดคน
const nameTaken = (users, selfId, name) => {
    const key = nameKey(name);
    return !!key && (users || []).some(u => u && Number(u.id) !== Number(selfId) && u.role !== 'agency'
        && u.is_active !== false && (u.status || 'active') === 'active' && nameKey(displayName(u)) === key);
};
// ชื่อล็อกอินซ้ำไหม — ทุกบัญชี (รวมเอเจนซี่ / บัญชีปิด) · ไม่สนตัวพิมพ์
const usernameTaken = (users, selfId, name) => (users || []).some(u => u && Number(u.id) !== Number(selfId) && userKey(u.username) === userKey(name));

module.exports = { NAME_MAX, USERNAME_MIN, USERNAME_MAX, displayName, nameKey, cleanNickname, cleanUsername, nameTaken, usernameTaken };
