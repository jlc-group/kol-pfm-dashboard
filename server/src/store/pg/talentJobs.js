/**
 * งานที่จ้างของคนใน Talent Book (ตาราง talent_jobs · ผู้ใช้สั่ง 1 ต.ค. 2026)
 * คนหนึ่ง (แถว talents) มีได้หลายงาน — แบรนด์ / เดือนที่จ้าง / ค่าตัวที่จ่ายจริง / Scope / ลิงก์ผลงาน / หมายเหตุ
 * ลบคนออกจาก Talent Book = งานของคนนั้นหายตาม (ON DELETE CASCADE)
 *
 * เห็นตามสิทธิ์แบรนด์ (scopeBrands: null = ทุกแบรนด์ · [] = ไม่เห็นเลย) แบบเดียวกับงานในแท็บอื่น
 * โค้ดขึ้นก่อนรัน setup-db (ยังไม่มีตาราง 42P01) = อ่านได้ว่างเปล่า หน้า Talent Book ไม่พัง · เพิ่ม/แก้ error จนกว่าจะสร้างตาราง
 */
const { query, insertRow } = require('./_base');

// ช่องที่แก้ได้จากฟอร์ม — talent_id / ผู้เพิ่ม / เวลา ไม่รับจากตรงนี้
const EDITABLE = ['brand', 'hired_on', 'fee', 'scope', 'work_link', 'note'];
const pick = fields => {
    const out = {};
    for (const k of EDITABLE) if (fields && fields[k] !== undefined) out[k] = fields[k];
    return out;
};
// id ของตาราง (SERIAL = int4) — เกินช่วงถือว่าไม่พบ (กติกาเดียวกับ pg/talents.js)
const intId = id => { const n = Number(id); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const nowIso = () => new Date().toISOString();
const noTable = e => e && e.code === '42P01';
// เงื่อนไขสิทธิ์แบรนด์ต่อท้าย WHERE — null = ไม่กรอง
const scopeSql = (scopeBrands, at) => (Array.isArray(scopeBrands) ? ` AND brand = ANY($${at}::text[])` : '');
const scopeArgs = scopeBrands => (Array.isArray(scopeBrands) ? [scopeBrands] : []);

const talentJobs = {
    // งานของคนหนึ่งคน ใหม่สุดก่อน (เดือนที่จ้างใหม่กว่า → เพิ่มทีหลัง)
    async listByTalent(talentId, { scopeBrands = null } = {}) {
        const n = intId(talentId);
        if (n === null || (Array.isArray(scopeBrands) && !scopeBrands.length)) return [];
        try {
            return (await query(
                `SELECT * FROM talent_jobs WHERE talent_id = $1${scopeSql(scopeBrands, 2)} ORDER BY hired_on DESC, id DESC`,
                [n, ...scopeArgs(scopeBrands)])).rows;
        } catch (e) { if (noTable(e)) return []; throw e; }
    },

    // งานหนึ่งงานของคนนั้น (งานของคนอื่น = ไม่พบ)
    async findById(talentId, jobId) {
        const t = intId(talentId), j = intId(jobId);
        if (t === null || j === null) return null;
        return (await query('SELECT * FROM talent_jobs WHERE id = $1 AND talent_id = $2', [j, t])).rows[0] || null;
    },

    async create(talentId, fields, { byId = null, byName = null } = {}) {
        const t = intId(talentId);
        if (t === null) return null;
        const at = nowIso();
        return insertRow('talent_jobs', { ...pick(fields), talent_id: t, created_by_id: intId(byId), created_by: byName || null, created_at: at, updated_at: at });
    },

    async update(talentId, jobId, fields) {
        const t = intId(talentId), j = intId(jobId);
        if (t === null || j === null) return null;
        const data = { ...pick(fields), updated_at: nowIso() };
        const cols = Object.keys(data);
        const sets = cols.map((c, i) => `${c} = $${i + 1}`);
        const r = await query(
            `UPDATE talent_jobs SET ${sets.join(', ')} WHERE id = $${cols.length + 1} AND talent_id = $${cols.length + 2} RETURNING *`,
            [...cols.map(c => data[c]), j, t]);
        return r.rows[0] || null;
    },

    // ลบ คืนแถวเดิม · ไม่พบ = null
    async remove(talentId, jobId) {
        const t = intId(talentId), j = intId(jobId);
        if (t === null || j === null) return null;
        return (await query('DELETE FROM talent_jobs WHERE id = $1 AND talent_id = $2 RETURNING *', [j, t])).rows[0] || null;
    }
};

module.exports = { talentJobs };
