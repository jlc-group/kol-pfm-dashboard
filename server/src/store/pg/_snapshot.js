/**
 * โหลดข้อมูลจาก PostgreSQL ออกมาเป็นก้อนหน้าตาเดียวกับ db.json เดิม
 *
 * ทำไมต้องมี: ส่วนคำนวณสถิติ (Dashboard / Report / Budget / Ads / Analytics) เป็นอัลกอริทึมยาว
 * และมีกฎธุรกิจละเอียดมาก (CPM, CPE, เกณฑ์คุ้มค่า, การจัดกลุ่มตาม Platform/สินค้า)
 * ถ้าเขียนใหม่เป็น SQL ทั้งหมด โอกาสคำนวณเพี้ยนโดยไม่มีใครรู้สูงมาก
 * จึงอ่านแถวจริงจาก PostgreSQL ขึ้นมาแล้วใช้ "ตรรกะเดิมชุดเดียวกัน" คำนวณต่อ
 * → ข้อมูลอยู่ในฐานข้อมูลจริง 100% แต่ผลลัพธ์ตรงกับของเดิมเป๊ะ
 *
 * ส่วนการ "เขียน" (สร้าง/แก้/ลบ) ไม่ใช้ไฟล์นี้ — ยิง SQL ตรงทีละแถวตามปกติ
 */
const { query } = require('./_base');

// แปลงแถว agency_messages กลับเป็นรูปเดิม (คอลัมน์ msg_from/by_name ชนคำสงวน SQL เลยต้องเปลี่ยนชื่อ)
function messageOut(r) {
    const m = {
        id: r.id, from: r.msg_from, by: r.by_name,
        text: r.text, image: r.image, thumb: r.thumb, at: r.at
    };
    if (r.edited_at) m.edited_at = r.edited_at;
    if (r.deleted_at) m.deleted_at = r.deleted_at;
    return m;
}

function reportOut(r) {
    return {
        id: r.id, kind: r.kind, filename: r.filename, original: r.original,
        url: r.url, size: r.size, note: r.note, uploaded_at: r.uploaded_at
    };
}

function linkOut(l, messages, reports) {
    const out = {
        token: l.token, name: l.name,
        groups: l.groups || [], products: l.products || [], platforms: l.platforms || [],
        kol_count: l.kol_count || 0,
        created_at: l.created_at
    };
    if (l.team_read_at) out.team_read_at = l.team_read_at;
    if (l.agency_read_at) out.agency_read_at = l.agency_read_at;
    if (l.updated_at) out.updated_at = l.updated_at;
    if (messages.length) out.messages = messages;
    if (reports.length) out.reports = reports;
    return out;
}

/** ประกอบ agency_links (พร้อมข้อความ/ไฟล์รายงาน) ให้กับแคมเปญที่ระบุ */
async function loadAgencyLinks(projectIds) {
    if (!projectIds.length) return new Map();
    const links = (await query(
        `SELECT * FROM agency_links WHERE project_id = ANY($1::int[]) ORDER BY id`, [projectIds])).rows;
    if (!links.length) return new Map();

    const linkIds = links.map(l => l.id);
    const msgs = (await query(
        `SELECT * FROM agency_messages WHERE link_id = ANY($1::int[]) ORDER BY at, id`, [linkIds])).rows;
    const reps = (await query(
        `SELECT * FROM agency_reports WHERE link_id = ANY($1::int[]) ORDER BY uploaded_at, id`, [linkIds])).rows;

    const byLinkMsg = new Map(), byLinkRep = new Map();
    for (const m of msgs) {
        if (!byLinkMsg.has(m.link_id)) byLinkMsg.set(m.link_id, []);
        byLinkMsg.get(m.link_id).push(messageOut(m));
    }
    for (const r of reps) {
        if (!byLinkRep.has(r.link_id)) byLinkRep.set(r.link_id, []);
        byLinkRep.get(r.link_id).push(reportOut(r));
    }

    const byProject = new Map();
    for (const l of links) {
        if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
        byProject.get(l.project_id).push(
            linkOut(l, byLinkMsg.get(l.id) || [], byLinkRep.get(l.id) || []));
    }
    return byProject;
}

/** แคมเปญพร้อม agency_links ซ้อนอยู่ข้างใน (รูปเดียวกับที่ jsonStore เคยเก็บ) */
async function loadProjects() {
    const rows = (await query('SELECT * FROM projects ORDER BY id')).rows;
    const byProject = await loadAgencyLinks(rows.map(p => p.id));
    for (const p of rows) {
        const links = byProject.get(p.id);
        if (links) p.agency_links = links;
    }
    return rows;
}

/**
 * โหลดทุกตารางที่ส่วนคำนวณต้องใช้
 * only = ระบุเฉพาะตารางที่ต้องการ เพื่อไม่ต้องดึงทั้งฐานข้อมูลเวลาใช้แค่บางส่วน
 */
async function loadSnapshot(only) {
    const want = t => !only || only.includes(t);
    const snap = {
        teams: [], users: [], kols: [], projects: [], project_kols: [],
        submissions: [], payments: [], installments: [], pay_batches: [],
        rate_requests: [], activity_logs: []
    };
    const simple = {
        teams: 'SELECT * FROM teams ORDER BY id',
        users: 'SELECT * FROM users ORDER BY id',
        kols: 'SELECT * FROM kols ORDER BY id',
        project_kols: 'SELECT * FROM project_kols ORDER BY id',
        submissions: 'SELECT * FROM submissions ORDER BY id',
        payments: 'SELECT * FROM payments ORDER BY id',
        installments: 'SELECT *, "of" AS of FROM installments ORDER BY id',
        pay_batches: 'SELECT * FROM pay_batches ORDER BY id',
        rate_requests: 'SELECT * FROM rate_requests ORDER BY id',
        activity_logs: 'SELECT * FROM activity_logs ORDER BY id'
    };
    const jobs = [];
    if (want('projects')) jobs.push(loadProjects().then(r => { snap.projects = r; }));
    for (const [k, q] of Object.entries(simple)) {
        if (want(k)) jobs.push(query(q).then(r => { snap[k] = r.rows; }));
    }
    await Promise.all(jobs);
    return snap;
}

module.exports = { loadSnapshot, loadProjects, loadAgencyLinks, messageOut, reportOut, linkOut };
