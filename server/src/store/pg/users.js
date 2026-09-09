/**
 * pgStore · โมดูล users
 *
 * พอร์ตมาจาก jsonStore บรรทัด 129-228 แบบตรงตัว
 * กติกาเดียวที่ยอมรับได้คือ "พฤติกรรมเหมือนเดิมเป๊ะ" — ทั้งรูปแบบค่าที่คืน
 * กรณีไม่เจอข้อมูล (null / false / 0) ลำดับการเรียง และข้อความ error ภาษาไทย
 *
 * จุดที่ต้องระวังและเหตุผลที่ทำแบบนี้:
 *  • การเรียงลำดับใช้ .localeCompare() ใน JS เหมือนเดิม ไม่ยก ORDER BY ไปให้ SQL
 *    เพราะ collation ของฐานข้อมูลอาจตัดสินเสมอ/ตัวพิมพ์ไม่เหมือน localeCompare
 *  • brands / agency_tokens เป็น JSONB — ขาเข้าต้องผ่าน asJson() ขาออกไดรเวอร์แปลงให้แล้ว
 *  • attachTeamName เดิมค้นจาก db.teams — ที่นี่ใช้ LEFT JOIN teams แทน (ไม่เจอทีม = null)
 *  • id ที่ไม่ใช่จำนวนเต็ม เดิมจะหาไม่เจอแล้วคืน null/false เงียบ ๆ
 *    แต่ถ้าส่งเข้า SQL ตรง ๆ จะกลายเป็น error — จึงกันไว้ก่อนยิง query
 */
const { query, withTransaction, insertRow, updateRow, asJson } = require('./_base');
const { now, clone, duplicateError } = require('../logic');

// Number(id) แบบ jsonStore: ค่าที่ไม่ใช่จำนวนเต็มจะไม่มีทางตรงกับ id ในตาราง
// คืน null เพื่อให้ผู้เรียกตัดจบเองโดยไม่ต้องยิง query (และไม่เจอ error จาก Postgres)
function intId(id) {
    const n = Number(id);
    return Number.isInteger(n) ? n : null;
}

// เดิม: throw duplicateError('มี username นี้อยู่แล้ว')
// ถ้าชนกันจังหวะพอดี (race) Postgres จะโยน 23505 ขึ้นมาเอง ต้องแปลงข้อความให้ตรงของเดิม
function asDuplicate(err, msg) {
    if (err && err.code === '23505') return duplicateError(msg);
    return err;
}

const SELECT_WITH_TEAM = `
    SELECT u.*, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id`;

const users = {
    async findByUsername(username) {
        const r = await query(`${SELECT_WITH_TEAM} WHERE u.username = $1`, [username]);
        const u = r.rows[0];
        return u ? clone({ ...u }) : null;
    },

    async findById(id) {
        const n = intId(id);
        if (n === null) return null;
        const r = await query(`${SELECT_WITH_TEAM} WHERE u.id = $1`, [n]);
        const u = r.rows[0];
        return u ? clone({ ...u }) : null;
    },

    async listWithTeam() {
        const r = await query(SELECT_WITH_TEAM);
        return r.rows
            .map(u => ({ ...u }))
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(u => {
                const { password_hash, ...safe } = u;
                return clone(safe);
            });
    },

    async create({ username, password_hash, full_name, nickname, role, team_id, brands, agency_tokens, status }) {
        const dup = await query(`SELECT 1 FROM users WHERE username = $1`, [username]);
        if (dup.rows.length) throw duplicateError('มี username นี้อยู่แล้ว');
        const at = now();
        let row;
        try {
            row = await insertRow('users', {
                username,
                password_hash,
                full_name: full_name || null,
                nickname: nickname || null,
                role: role || 'member',
                // pending = สมัครเองแล้วรออนุมัติ · active = ใช้งานได้ · rejected = ปฏิเสธ
                status: status || 'active',
                // แบรนด์ที่ member คนนี้ดูได้ (admin/manager ไม่ใช้ค่านี้ เห็นทุกแบรนด์อยู่แล้ว)
                brands: asJson(Array.isArray(brands) ? brands.filter(Boolean) : []),
                // เฉพาะ role agency — ลิงก์เอเจนซี่ที่บัญชีนี้เข้าได้ (1 เจ้าอาจมีหลายแคมเปญ)
                agency_tokens: asJson(Array.isArray(agency_tokens) ? agency_tokens.filter(Boolean) : []),
                team_id: team_id || null,
                is_active: true,
                created_at: at,
                updated_at: at
            });
        } catch (err) {
            throw asDuplicate(err, 'มี username นี้อยู่แล้ว');
        }
        const { password_hash: _, ...safe } = { ...row };
        return clone(safe);
    },

    async update(id, fields) {
        const n = intId(id);
        if (n === null) return null;
        return withTransaction(async (client) => {
            const cur = (await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [n])).rows[0];
            if (!cur) return null;

            const patch = {};
            // เปลี่ยนชื่อผู้ใช้ได้ แต่ห้ามซ้ำกับคนอื่น (ชื่อนี้ใช้เข้าสู่ระบบ)
            if (fields.username && fields.username !== cur.username) {
                const dup = await client.query(
                    `SELECT 1 FROM users WHERE username = $1 AND id <> $2`, [fields.username, cur.id]);
                if (dup.rows.length) throw duplicateError('มี username นี้อยู่แล้ว');
                patch.username = fields.username;
            }
            for (const key of ['full_name', 'nickname', 'role', 'team_id', 'is_active', 'status', 'password_hash']) {
                if (fields[key] !== undefined && fields[key] !== null) patch[key] = fields[key];
            }
            // brands เป็น array — ต้องยอมให้เซ็ตเป็น [] ได้ (ถอดแบรนด์ออกทั้งหมด)
            if (Array.isArray(fields.brands)) patch.brands = asJson(fields.brands.filter(Boolean));
            if (Array.isArray(fields.agency_tokens)) patch.agency_tokens = asJson(fields.agency_tokens.filter(Boolean));
            patch.updated_at = now();

            let row;
            try {
                row = await updateRow('users', cur.id, patch, client);
            } catch (err) {
                throw asDuplicate(err, 'มี username นี้อยู่แล้ว');
            }
            if (!row) return null;
            const { password_hash, ...safe } = { ...row };
            return clone(safe);
        });
    },

    // บัญชีเอเจนซี่ทั้งหมด — ไว้ทำ dropdown ตอนสร้างลิงก์ในหน้าแคมเปญ
    async listAgencies() {
        const r = await query(
            `SELECT id, username, agency_tokens
               FROM users
              WHERE role = 'agency' AND is_active IS DISTINCT FROM false`);
        return r.rows
            .map(u => ({ id: u.id, username: u.username, agency_tokens: (u.agency_tokens || []).slice() }))
            .sort((a, b) => a.username.localeCompare(b.username, 'th'));
    },

    // ผูกลิงก์งานเข้ากับบัญชีเอเจนซี่ (1 บัญชีถือได้หลายลิงก์ = หลายแคมเปญ)
    async bindAgencyToken(id, token) {
        const n = intId(id);
        if (n === null || !token) return false;
        return withTransaction(async (client) => {
            const u = (await client.query(
                `SELECT id, agency_tokens FROM users WHERE id = $1 AND role = 'agency' FOR UPDATE`, [n])).rows[0];
            if (!u) return false;
            const list = Array.isArray(u.agency_tokens) ? u.agency_tokens : [];
            if (!list.includes(token)) {
                await client.query(
                    `UPDATE users SET agency_tokens = $1, updated_at = $2 WHERE id = $3`,
                    [asJson([...list, token]), now(), u.id]);
            }
            return true;
        });
    },

    // ถอนลิงก์ออกจากทุกบัญชี — ใช้ตอนลบลิงก์ ไม่งั้นจะเหลือ token ตายค้างในบัญชี
    async unbindAgencyToken(token) {
        return withTransaction(async (client) => {
            const rows = (await client.query(
                `SELECT id, agency_tokens FROM users ORDER BY id FOR UPDATE`)).rows;
            let n = 0;
            const at = now();
            for (const u of rows) {
                if (Array.isArray(u.agency_tokens) && u.agency_tokens.includes(token)) {
                    const left = u.agency_tokens.filter(t => t !== token);
                    await client.query(
                        `UPDATE users SET agency_tokens = $1, updated_at = $2 WHERE id = $3`,
                        [asJson(left), at, u.id]);
                    n++;
                }
            }
            return n;
        });
    },

    async countPending() {
        const r = await query(`SELECT COUNT(*) AS n FROM users WHERE COALESCE(status, 'active') = 'pending'`);
        return r.rows[0].n;
    },

    async remove(id) {
        const n = intId(id);
        if (n === null) return false;
        const r = await query(`DELETE FROM users WHERE id = $1`, [n]);
        return r.rowCount > 0;
    }
};

module.exports = { users };
