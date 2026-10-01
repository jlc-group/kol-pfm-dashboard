/**
 * Talent Book — คนที่ทีมเพิ่มเข้า Talent Book เอง ไม่ต้องมีงาน (ตาราง talents · ผู้ใช้สั่ง 29 ก.ย. 2026)
 *
 * การ์ดในแท็บ Talent Book รวมคนพวกนี้กับคนที่มาจากงาน (ชื่อ + ประเภทงานเดียวกัน = การ์ดเดียว) ที่ hires.book()
 * คนเดียวกัน = ชื่อ + ประเภทงาน (ไม่สนตัวพิมพ์ / ช่องว่างหัวท้าย) กติกาเดียวกับ personKey ใน pg/hires.js
 * — ในตารางนี้ห้ามมีคนซ้ำ (เส้น API เช็คด้วย findByKey ก่อนเพิ่ม/แก้) ไม่งั้นการ์ดเดียวจะมีหลายแถวให้แก้
 */
const { query, withTransaction, insertRow, updateRow, asJson } = require('./_base');

// ช่องที่แก้ได้จากฟอร์ม — id / ผู้เพิ่ม / เวลา / ไฟล์ ไม่รับจากตรงนี้ (ไฟล์มีเส้นของตัวเอง)
const EDITABLE = ['name', 'kind', 'link', 'socials', 'contact_mode', 'contact_name', 'contact', 'agency', 'rate', 'rate_unit', 'scope', 'brands', 'image_link', 'clip_link', 'note'];
const pick = fields => {
    const out = {};
    for (const k of EDITABLE) if (fields && fields[k] !== undefined) out[k] = fields[k];
    // brands / socials เป็น JSONB (array) — socials = [{ platform, handle, url }] (data/talentSocials.js · 1 ต.ค. 2026)
    if (out.brands !== undefined) out.brands = asJson(Array.isArray(out.brands) ? out.brands : [], []);
    if (out.socials !== undefined) out.socials = asJson(Array.isArray(out.socials) ? out.socials : [], []);
    return out;
};
// id ของตาราง (SERIAL = int4) — เกินช่วงถือว่าไม่พบ ไม่ส่งไปให้ PostgreSQL ตอบ error 22003 (กลายเป็น 500)
const intId = id => { const n = Number(id); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const nowIso = () => new Date().toISOString();

const talents = {
    async list() {
        return (await query('SELECT * FROM talents ORDER BY id')).rows;
    },

    async findById(id) {
        const n = intId(id);
        if (n === null) return null;
        return (await query('SELECT * FROM talents WHERE id = $1', [n])).rows[0] || null;
    },

    // คนเดียวกันที่มีอยู่แล้ว (ชื่อ + ประเภทงาน) — exceptId = ตัวที่กำลังแก้อยู่เอง
    async findByKey(name, kind, exceptId = null) {
        const r = await query(
            `SELECT id, name, kind, created_by_id FROM talents
              WHERE lower(btrim(name)) = lower(btrim($1)) AND lower(btrim(kind)) = lower(btrim($2))
                AND ($3::int IS NULL OR id <> $3::int)
              ORDER BY id LIMIT 1`,
            [String(name ?? ''), String(kind ?? ''), intId(exceptId)]);
        return r.rows[0] || null;
    },

    async create(fields, { byId = null, byName = null } = {}) {
        const at = nowIso();
        return insertRow('talents', { ...pick(fields), created_by_id: intId(byId), created_by: byName || null, created_at: at, updated_at: at });
    },

    async update(id, fields) {
        const n = intId(id);
        if (n === null) return null;
        return updateRow('talents', n, { ...pick(fields), updated_at: nowIso() });
    },

    // ลบแถว คืนแถวเดิม (ไว้ลบไฟล์ต่อ) · ไม่พบ = null
    async remove(id) {
        const n = intId(id);
        if (n === null) return null;
        return (await query('DELETE FROM talents WHERE id = $1 RETURNING *', [n])).rows[0] || null;
    },

    // ตั้ง / ล้างไฟล์ (field = 'image' | 'clip') — ล็อกแถวในทรานแซกชัน คืน { row, old } (old = ไฟล์เดิมไว้ลบทิ้ง)
    // keepUserFile = รูปที่ดึงอัตโนมัติจากลิงก์ (services/talentAvatar.js): ถ้ามีไฟล์ที่ผู้ใช้อัป/วางเองอยู่แล้ว (ไม่ใช่ source 'auto')
    //   ไม่แทนที่ คืน { row, old: null, kept: true } — เช็คในล็อกเดียวกัน กันผู้ใช้อัปรูประหว่างที่กำลังดึง
    // stillWanted(cur) = งานดึงรูปที่ช้ากว่ายังควรเขียนไหม (ลิงก์ยังเป็นอันเดิม / รูปยังไม่ถูกเปลี่ยน) — เช็คในล็อกเดียวกัน
    //   false = ไม่เขียน คืน { row, old: null, kept: true, stale: true } (ตัวดึงลบไฟล์ที่ดึงมาทิ้ง)
    async setFile(id, field, meta, { keepUserFile = false, stillWanted = null } = {}) {
        if (field !== 'image' && field !== 'clip') throw new Error('bad talent file field');
        const n = intId(id);
        if (n === null) return null;
        return withTransaction(async client => {
            const cur = (await client.query(`SELECT * FROM talents WHERE id = $1 FOR UPDATE`, [n])).rows[0];
            if (!cur) return null;
            const have = cur[field];
            if (keepUserFile && have && have.source !== 'auto') return { row: cur, old: null, kept: true };
            if (typeof stillWanted === 'function' && !stillWanted(cur)) return { row: cur, old: null, kept: true, stale: true };
            const row = (await client.query(
                `UPDATE talents SET ${field} = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
                [meta ? JSON.stringify(meta) : null, nowIso(), n])).rows[0];
            return { row, old: cur[field] || null };
        });
    }
};

module.exports = { talents };
