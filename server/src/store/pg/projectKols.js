/**
 * pgStore: project_kols (KOL ที่ผูกกับแคมเปญ) + activity_logs (ประวัติใครทำอะไร)
 *
 * พอร์ตตรงจาก jsonStore บรรทัด 833-873 (projectKols) และ 1238-1309 (activity)
 * กฎเหล็ก: รูปแบบค่าที่คืนต้องเหมือนเดิมเป๊ะ — รวมถึงกรณีไม่พบ (null / false)
 *
 * ส่วนเขียน  -> ยิง SQL ตรง (add ใช้ transaction เพราะเช็คซ้ำแล้วค่อย insert)
 * ส่วนอ่านรวม -> loadSnapshot(['activity_logs']) แล้วใช้อัลกอริทึมเดิมทั้งดุ้น
 *   (list/actors กรองด้วยการ "เทียบสตริง" ของ created_at และเรียงด้วย localeCompare
 *    ถ้าแปลงเป็น SQL WHERE/ORDER BY จะได้ผลไม่ตรงเดิมในกรณี from/to เป็นสตริงไม่เต็มรูป)
 */
const { query, withTransaction, insertRow, asDate, asNum } = require('./_base');
const { loadSnapshot } = require('./_snapshot');
const { now, clone, duplicateError, scopeProjects } = require('../logic');

// ---- ตัวช่วยจัดลำดับคีย์ให้ตรงกับที่ jsonStore เคยคืน ----
// แถวจาก PostgreSQL เรียงคีย์ตามลำดับคอลัมน์ในตาราง ซึ่ง activity_logs สลับที่ action/project_id
const logOut = r => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    team_id: r.team_id,
    action: r.action,
    project_id: r.project_id,
    project_name: r.project_name,
    summary: r.summary,
    created_at: r.created_at
});

// ============================ project_kols ============================
const projectKols = {
    async add({ project_id, kol_id, fee, views, likes, comments, shares, post_link, posted_date, status, notes }) {
        const pid = Number(project_id), kid = Number(kol_id);
        try {
            return await withTransaction(async (client) => {
                const dup = await client.query(
                    'SELECT 1 FROM project_kols WHERE project_id = $1 AND kol_id = $2 LIMIT 1', [pid, kid]);
                if (dup.rowCount) throw duplicateError('KOL นี้อยู่ใน Project แล้ว');
                return await insertRow('project_kols', {
                    project_id: pid, kol_id: kid,
                    fee: asNum(fee, 0), views: asNum(views, 0), likes: asNum(likes, 0),
                    comments: asNum(comments, 0), shares: asNum(shares, 0),
                    post_link: post_link || null, posted_date: asDate(posted_date || null),
                    status: status || 'Pending', notes: notes || null, added_at: now()
                }, client);
            });
        } catch (err) {
            // ชนกันพอดีสองคำขอพร้อมกัน -> UNIQUE (project_id, kol_id) ยิงกลับมา
            // แปลงเป็น error ก้อนเดียวกับกรณีเช็คเจอ เพื่อให้ route ตอบข้อความไทยเดิม
            if (err.code === '23505' && err.constraint) throw duplicateError('KOL นี้อยู่ใน Project แล้ว');
            throw err;
        }
    },
    // แก้ข้อมูลการใช้งาน KOL ในแคมเปญ (งบ/วิว/engagement/ลิงก์ผลงาน/วันที่ลงงาน/สถานะ)
    async update(linkId, projectId, fields) {
        const id = Number(linkId), pid = Number(projectId);
        const cur = await query(
            'SELECT * FROM project_kols WHERE id = $1 AND project_id = $2', [id, pid]);
        if (!cur.rowCount) return null;

        const NUMS = ['fee', 'views', 'likes', 'comments', 'shares'];
        const data = {};
        for (const key of ['fee', 'views', 'likes', 'comments', 'shares', 'post_link', 'posted_date', 'status', 'notes']) {
            if (fields[key] === undefined) continue;
            if (NUMS.includes(key)) data[key] = asNum(fields[key], 0);
            else if (key === 'posted_date') data[key] = asDate(fields[key]);
            else data[key] = fields[key];
        }
        if (!Object.keys(data).length) return clone(cur.rows[0]);

        const cols = Object.keys(data);
        const sets = cols.map((c, i) => `${c} = $${i + 1}`);
        const r = await query(
            `UPDATE project_kols SET ${sets.join(', ')} WHERE id = $${cols.length + 1} AND project_id = $${cols.length + 2} RETURNING *`,
            [...cols.map(c => data[c]), id, pid]);
        return r.rows[0] || null;
    },
    async remove(linkId, projectId) {
        const r = await query(
            'DELETE FROM project_kols WHERE id = $1 AND project_id = $2', [Number(linkId), Number(projectId)]);
        return r.rowCount > 0;
    }
};

// ============================ activity (บันทึกประวัติใครทำอะไร) ============================
const activity = {
    async log({ user_id, team_id, action, project_id, project_name, summary }) {
        const u = (await query('SELECT full_name, username FROM users WHERE id = $1', [Number(user_id)])).rows[0];
        const row = await insertRow('activity_logs', {
            user_id: Number(user_id) || null,
            user_name: u ? (u.full_name || u.username) : 'ไม่ทราบ',
            team_id: team_id ?? null,
            action: action || 'update',
            project_id: project_id ?? null,
            project_name: project_name ?? null,
            summary: summary || '',
            created_at: now()
        });
        return logOut(row);
    },
    async list({ scopeBrands = null, user_id, project_id, from, to, limit = 300 } = {}) {
        const snap = await loadSnapshot(['activity_logs']);
        let rows = snap.activity_logs.slice();
        rows = scopeProjects(rows, scopeBrands);
        if (user_id) rows = rows.filter(r => r.user_id === Number(user_id));
        if (project_id) rows = rows.filter(r => r.project_id === Number(project_id));
        if (from) rows = rows.filter(r => (r.created_at || '') >= from);
        if (to) rows = rows.filter(r => (r.created_at || '') <= to + 'T23:59:59');
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return rows.slice(0, limit).map(logOut);
    },
    // รายชื่อผู้ใช้ที่เคยมีประวัติ (สำหรับ dropdown ฟิลเตอร์)
    async actors(scopeBrands = null) {
        const snap = await loadSnapshot(['activity_logs']);
        let rows = snap.activity_logs;
        rows = scopeProjects(rows, scopeBrands);
        const map = {};
        rows.forEach(r => { if (r.user_id) map[r.user_id] = r.user_name; });
        return Object.entries(map).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name));
    }
};

module.exports = { projectKols, activity };
