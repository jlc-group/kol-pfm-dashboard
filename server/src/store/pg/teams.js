/**
 * teams + meta (เวอร์ชัน PostgreSQL)
 *
 * พอร์ตมาจาก jsonStore.teams (บรรทัด 69-128), jsonStore.teams.memberCounts (บรรทัด 866)
 * และ jsonStore.meta (บรรทัด 1849-1852) โดยยึด "หน้าตาค่าที่คืน" ให้เหมือนเดิมเป๊ะ
 *
 * จุดที่ต้องระวังและทำไมเขียนแบบนี้
 *   • listWithMemberCount: เดิมนับสมาชิกใน JS แล้วค่อย sort ด้วย name.localeCompare()
 *     ที่นี่ให้ SQL นับ (LEFT JOIN + COUNT → ตัวเลขจริง เพราะ _base ตั้ง type parser ของ BIGINT ไว้)
 *     แต่ "เรียงลำดับใน JS ด้วย localeCompare เหมือนเดิม" ไม่ใช้ ORDER BY ของ Postgres
 *     เพราะ collation ของฐานข้อมูลอาจเรียงไทย/อังกฤษไม่ตรงกับ localeCompare ของ Node
 *   • memberCounts: เดิมไม่ได้ sort → ลำดับคือลำดับที่อยู่ในไฟล์ = ลำดับ id → ORDER BY t.id
 *   • findById/update/remove: เดิมเทียบ t.id === Number(id) ดังนั้นค่าที่ไม่ใช่จำนวนเต็ม
 *     (NaN, '1.5', เกินช่วง INTEGER) ต้อง "ไม่เจอ" เฉย ๆ ไม่ใช่ให้ Postgres โยน error
 *   • remove: FK ในสคีมาจัดการลูกให้แล้ว (users.team_id ON DELETE SET NULL,
 *     projects ON DELETE CASCADE ซึ่งลาก project_kols ตามไปด้วย) — แต่ยังห่อ transaction ไว้
 *     เพราะคำสั่งเดียวนี้แตะหลายตาราง ถ้าพังกลางทางต้องไม่เหลือข้อมูลค้างครึ่ง ๆ กลาง ๆ
 */
const { query, withTransaction, insertRow, updateRow, asText } = require('./_base');
const { now, duplicateError } = require('../logic');

// ช่วง INTEGER ของ Postgres — เกินนี้ส่งเข้า query ไม่ได้ (เดิมก็หาไม่เจออยู่แล้ว)
const INT_MAX = 2147483647;

/** id ที่ใช้ค้นได้จริง — เลียนแบบ t.id === Number(id) ของ jsonStore (ไม่ตรง = ไม่เจอ) */
function intId(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n > INT_MAX || n < -INT_MAX - 1) return null;
    return n;
}

// ============================ teams ============================
const teams = {
    // เดิม: db.teams.map(t => ({...t, member_count})).sort(ตามชื่อ)
    // ลำดับคอลัมน์ที่คืน: id, name, description, created_at, updated_at, member_count (เท่าของเดิม)
    async listWithMemberCount() {
        const { rows } = await query(
            `SELECT t.*, COUNT(u.id) AS member_count
               FROM teams t
               LEFT JOIN users u ON u.team_id = t.id
              GROUP BY t.id
              ORDER BY t.id`);
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    },

    // ไม่เจอ = null (ไม่ใช่ undefined)
    async findById(id) {
        const n = intId(id);
        if (n === null) return null;
        const { rows } = await query('SELECT * FROM teams WHERE id = $1', [n]);
        return rows[0] || null;
    },

    // ชื่อซ้ำ = โยน error code '23505' ข้อความไทยเดิม (route แปลงเป็น HTTP 409)
    // ที่นี่ปล่อยให้ UNIQUE constraint เป็นคนตัดสินแล้วค่อยแปลงข้อความ — ปลอดภัยกว่าเช็คก่อนแล้วค่อย insert
    // เพราะสองคนกด "สร้างทีม" ชื่อเดียวกันพร้อมกันจะไม่หลุดผ่านทั้งคู่
    async create({ name, description }) {
        try {
            return await insertRow('teams', {
                name,
                description: asText(description),   // เดิม description || null
                created_at: now(),
                updated_at: now()
            });
        } catch (err) {
            if (err && err.code === '23505') throw duplicateError('มีชื่อทีมนี้อยู่แล้ว');
            throw err;
        }
    },

    // ไม่เจอ = null · ส่ง null/undefined มาในช่องไหน = ไม่แตะช่องนั้น (แต่ '' ถือว่าตั้งค่าว่าง เหมือนเดิม)
    // ถึงไม่มีอะไรเปลี่ยน updated_at ก็ต้องขยับ (ของเดิมขยับทุกครั้ง)
    async update(id, { name, description }) {
        const n = intId(id);
        if (n === null) return null;
        const data = {};
        if (name != null) data.name = name;
        if (description != null) data.description = description;
        data.updated_at = now();   // ใส่ไว้เสมอ เพื่อให้มี UPDATE จริงแม้ไม่ได้แก้ช่องอื่นเลย
        try {
            return await updateRow('teams', n, data);
        } catch (err) {
            if (err && err.code === '23505') throw duplicateError('มีชื่อทีมนี้อยู่แล้ว');
            throw err;
        }
    },

    // ลบทีม → users.team_id เป็น null, แคมเปญของทีมนี้ถูกลบพร้อม project_kols (FK จัดการให้)
    // คืน true/false เหมือนเดิม (ไม่เจอ = false)
    async remove(id) {
        const n = intId(id);
        if (n === null) return false;
        return withTransaction(async (client) => {
            const r = await client.query('DELETE FROM teams WHERE id = $1', [n]);
            return r.rowCount > 0;
        });
    },

    // จำนวนสมาชิกแต่ละทีม (กราฟเล็กหน้า Dashboard) — ไม่เรียงตามชื่อ ใช้ลำดับ id เหมือนของเดิม
    async memberCounts() {
        const { rows } = await query(
            `SELECT t.name AS label, COUNT(u.id) AS value
               FROM teams t
               LEFT JOIN users u ON u.team_id = t.id
              GROUP BY t.id, t.name
              ORDER BY t.id`);
        return rows;
    }
};

// ============================ meta ============================
const meta = {
    async teamCount() {
        const { rows } = await query('SELECT COUNT(*) AS c FROM teams');
        return rows[0].c;
    },
    // เดิมใช้โหลด db.json กลับเข้าหน่วยความจำใหม่ — ฝั่ง PostgreSQL ไม่มีสำเนาในหน่วยความจำ จึงไม่ต้องทำอะไร
    async reload() { /* no-op */ }
};

module.exports = { teams, meta };
