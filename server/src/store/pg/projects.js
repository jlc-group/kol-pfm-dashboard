/**
 * projects (เวอร์ชัน PostgreSQL)
 *
 * พอร์ตมาจาก jsonStore.projects (บรรทัด 488-832) พร้อมตัวช่วย enrichProject / genReportId
 * ยึด "หน้าตาค่าที่คืน" ให้เหมือนเดิมเป๊ะทุกเมธอด รวมถึงกรณีไม่เจอข้อมูล
 * (null / undefined / [] / false — ของเดิมคืนอะไรก็ต้องคืนอย่างนั้น)
 *
 * จุดที่ต้องระวังและทำไมเขียนแบบนี้
 *   • ของเดิม agency_links / messages / reports ซ้อนอยู่ใน projects[] — ตอนนี้เป็นตารางลูกจริง
 *     เมธอดที่คืน "แคมเปญทั้งก้อน" (list, findByIdFull, findByToken, resolveToken, setBriefFile)
 *     จึงต้องแปะ agency_links กลับเข้าไปให้เหมือนเดิม ไม่งั้นหน้าเว็บที่อ่าน p.agency_links จะพัง
 *   • ส่วนที่คำนวณ/รวมข้อมูลหลายตาราง (list, findByIdFull, listTeamChats) ใช้ loadSnapshot()
 *     แล้วรันอัลกอริทึมเดิมทับ snapshot ตรง ๆ — ไม่เขียนใหม่เป็น SQL aggregate เพื่อกันสูตรเพี้ยน
 *   • เรียงลำดับยังใช้ .localeCompare() ใน JS เหมือนเดิม ไม่พึ่ง ORDER BY ของ Postgres
 *     เพราะ collation ของฐานข้อมูลอาจเรียงไม่ตรงกับ Node
 *   • คอลัมน์ agency_messages.image / .thumb เป็น TEXT แต่ค่าที่เก็บจริงคือ object
 *     ({filename, original, size}) ซึ่ง pg แปลงเป็นสตริง JSON ให้ตอนเขียน
 *     ขาอ่านจึง parse กลับเป็น object เสมอ ไม่งั้น getAgencyMessageImage จะหา .filename ไม่เจอ
 *   • id ที่ค้นไม่ได้ (NaN, ทศนิยม, เกินช่วง INTEGER) ต้อง "ไม่เจอ" เฉย ๆ ไม่ใช่ให้ Postgres โยน error
 *     เพราะของเดิมเทียบ p.id === Number(id)
 */
const {
    query, withTransaction, insertRow, updateRow,
    asDate, asNum, asNumOrNull, asJson
} = require('./_base');
const {
    loadSnapshot, loadAgencyLinks, messageOut, reportOut, linkOut
} = require('./_snapshot');
const { now, clone, inScope, scopeProjects, linkGroupPlatforms } = require('../logic');

// ช่วง INTEGER ของ Postgres — เกินนี้ส่งเข้า query ไม่ได้ (เดิมก็หาไม่เจออยู่แล้ว)
const INT_MAX = 2147483647;

/** id ที่ใช้ค้นได้จริง — เลียนแบบ p.id === Number(id) ของ jsonStore (ไม่ตรง = ไม่เจอ) */
function intId(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n > INT_MAX || n < -INT_MAX - 1) return null;
    return n;
}

// id ของไฟล์ report/ข้อความ — สั้นแต่เดาไม่ได้ (คงสูตรเดิมของ jsonStore ไว้ทั้งดุ้น)
const genReportId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// รูปในแชทถูกเก็บลงคอลัมน์ TEXT เป็นสตริง JSON — อ่านออกมาต้องแปลงกลับเป็น object
function parseImg(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
        try { return JSON.parse(s); } catch (e) { return v; }
    }
    return v;
}

// แถว agency_messages → รูปเดิม (from/by) + รูปภาพที่ parse แล้ว
function msgOut(r) {
    const m = messageOut(r);
    m.image = parseImg(m.image);
    m.thumb = parseImg(m.thumb);
    return m;
}

/** หาแถว agency_links ของแคมเปญ+token (คืน undefined ถ้าไม่มี — ครอบกรณีแคมเปญหายไปด้วย) */
async function findLinkRow(projectId, token, client) {
    const q = 'SELECT * FROM agency_links WHERE project_id = $1 AND token = $2';
    const r = await (client ? client.query(q, [projectId, token]) : query(q, [projectId, token]));
    return r.rows[0];
}

/** แปะ agency_links (พร้อมข้อความ/ไฟล์รายงาน) กลับเข้าไปในแถวแคมเปญ ให้เหมือนรูปเดิมใน db.json */
async function attachLinks(p) {
    if (!p) return p;
    const links = (await loadAgencyLinks([p.id])).get(p.id);
    if (links) p.agency_links = links;
    return p;
}

// ============================ projects ============================
// enrichProject เดิมอ่านจาก db.* — ที่นี่รับ snapshot เข้ามาแทน (ตรรกะเหมือนเดิมบรรทัดต่อบรรทัด)
function enrichProject(snap, p) {
    const team = snap.teams.find(t => t.id === p.team_id);
    const creator = snap.users.find(u => u.id === p.created_by);
    const editor = snap.users.find(u => u.id === p.updated_by);
    const kol_count = snap.project_kols.filter(pk => pk.project_id === p.id).length;
    const subs = snap.submissions.filter(s => s.project_id === p.id);
    const sub_confirmed = subs.filter(s => s.status === 'confirmed').length;
    return {
        ...p,
        team_name: team ? team.name : null,
        created_by_name: creator ? (creator.full_name || creator.username) : null,
        updated_by_name: editor ? (editor.full_name || editor.username) : null,
        kol_count,
        sub_count: subs.length,
        sub_confirmed
    };
}

const projects = {
    // scopeBrands = null (เห็นทุกแบรนด์) หรือ array ชื่อแบรนด์
    async list(scopeBrands = null) {
        const snap = await loadSnapshot(['projects', 'teams', 'users', 'project_kols', 'submissions']);
        let rows = snap.projects.slice();
        rows = scopeProjects(rows, scopeBrands);
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return rows.map(p => clone(enrichProject(snap, p)));
    },

    // ไม่เจอ = undefined (ไม่ใช่ null) — ของเดิมคืน p ? p.team_id : undefined
    async findTeamId(id) {
        const n = intId(id);
        if (n === null) return undefined;
        const { rows } = await query('SELECT team_id FROM projects WHERE id = $1', [n]);
        return rows[0] ? rows[0].team_id : undefined;
    },

    async findByIdFull(id) {
        const n = intId(id);
        if (n === null) return null;
        const snap = await loadSnapshot(['projects', 'teams', 'users', 'project_kols', 'submissions', 'kols']);
        const p = snap.projects.find(x => x.id === n);
        if (!p) return null;
        const enriched = enrichProject(snap, p);
        const kolsInProject = snap.project_kols
            .filter(pk => pk.project_id === p.id)
            .sort((a, b) => (a.added_at || '').localeCompare(b.added_at || ''))
            .map(pk => {
                const kol = snap.kols.find(k => k.id === pk.kol_id) || {};
                return { link_id: pk.id, fee: pk.fee, status: pk.status, notes: pk.notes, added_at: pk.added_at, ...kol };
            });
        return clone({ ...enriched, kols: kolsInProject });
    },

    async create(fields) {
        const stamp = now();
        return await insertRow('projects', {
            team_id: fields.team_id,
            created_by: fields.created_by,
            name: fields.name,
            brand: fields.brand || null,
            objective: fields.objective || null,
            product: fields.product || null,
            products: asJson(Array.isArray(fields.products) ? fields.products : [], []),
            ad_groups: asJson(Array.isArray(fields.ad_groups) ? fields.ad_groups : [], []),
            owner: fields.owner || null,
            creator: fields.creator || null,   // ชื่อคนสร้างโปรเจค (ทีมใช้บัญชีร่วมกัน created_by จึงบอกไม่ได้ว่าใคร)
            brief_link: fields.brief_link || null,
            brief_file: fields.brief_file ? asJson(fields.brief_file) : null,
            product_briefs: asJson(fields.product_briefs || {}, {}),   // บรีฟต่อสินค้า { code: { link, file } }
            platform_briefs: asJson(fields.platform_briefs || {}, {}), // บรีฟหลักต่อ Platform { platform: { link, file } }
            platform_budgets: asJson(fields.platform_budgets || {}, {}), // งบต่อ Platform { platform: number }
            kol_target: asNum(fields.kol_target || 0, 0),
            budget: asNum(fields.budget || 0, 0),
            start_date: asDate(fields.start_date || null),
            end_date: asDate(fields.end_date || null),
            status: fields.status || 'Draft',
            description: fields.description || null,
            created_at: stamp,
            updated_at: stamp
        });
    },

    async update(id, fields) {
        const n = intId(id);
        if (n === null) return null;
        const data = {};
        // null = ผู้ใช้ล้างค่าออกจริง ๆ (route ส่งเฉพาะคีย์ที่ client ส่งมา คีย์ที่ไม่ได้แก้จะเป็น undefined)
        const put = (key, val) => { if (fields[key] !== undefined) data[key] = val(fields[key]); };
        for (const key of ['name', 'brand', 'objective', 'product', 'owner', 'creator', 'brief_link', 'status', 'description']) {
            put(key, v => v);
        }
        put('products', v => asJson(v, []));
        put('ad_groups', v => asJson(v, []));
        put('product_briefs', v => asJson(v, {}));
        put('platform_briefs', v => asJson(v, {}));
        put('platform_budgets', v => asJson(v, {}));
        put('kol_target', v => asNum(v, 0));
        put('budget', v => asNum(v, 0));
        put('start_date', v => asDate(v));
        put('end_date', v => asDate(v));
        put('updated_by', v => v);
        data.updated_at = now();
        return await updateRow('projects', n, data);
    },

    // บันทึกไฟล์บรีฟของสินค้าหนึ่งตัว (เก็บใน product_briefs[code].file)
    async setProductBriefFile(id, code, meta) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT product_briefs FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            let briefs = r.rows[0].product_briefs;
            if (!briefs || typeof briefs !== 'object') briefs = {};
            const cur = briefs[code] || {};
            briefs[code] = { link: cur.link || null, file: meta };
            await c.query('UPDATE projects SET product_briefs = $1, updated_at = $2 WHERE id = $3',
                [asJson(briefs, {}), now(), n]);
            return clone(briefs[code]);
        });
    },

    // บันทึกไฟล์บรีฟหลักของ Platform หนึ่งตัว (เก็บใน platform_briefs[platform].file)
    async setPlatformBriefFile(id, platform, meta) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT platform_briefs FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            let briefs = r.rows[0].platform_briefs;
            if (!briefs || typeof briefs !== 'object') briefs = {};
            const cur = briefs[platform] || {};
            briefs[platform] = { link: cur.link || null, file: meta };
            await c.query('UPDATE projects SET platform_briefs = $1, updated_at = $2 WHERE id = $3',
                [asJson(briefs, {}), now(), n]);
            return clone(briefs[platform]);
        });
    },

    async remove(id) {
        const n = intId(id);
        if (n === null) return false;
        return await withTransaction(async (c) => {
            // FK ON DELETE CASCADE ลาก project_kols / submissions / payments / installments /
            // agency_links (→ messages, reports) ตามไปเองแล้ว
            const r = await c.query('DELETE FROM projects WHERE id = $1 RETURNING id', [n]);
            if (!r.rowCount) return false;
            // รอบทำจ่ายที่ไม่เหลืองวดอยู่เลย ก็ไม่มีความหมายแล้ว
            await c.query(`DELETE FROM pay_batches b
                            WHERE NOT EXISTS (SELECT 1 FROM installments i WHERE i.batch_id = b.id)`);
            return true;
        });
    },

    // ลิงก์แชร์ให้ Agency (สร้างถ้ายังไม่มี)
    async setShareToken(id, token) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT share_token FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            if (r.rows[0].share_token) return r.rows[0].share_token;
            const u = await c.query('UPDATE projects SET share_token = $1 WHERE id = $2 RETURNING share_token',
                [token, n]);
            return u.rows[0].share_token;
        });
    },

    async findByToken(token) {
        const { rows } = await query('SELECT * FROM projects WHERE share_token = $1', [token]);
        return rows[0] ? clone(await attachLinks(rows[0])) : null;
    },

    // ===== ลิงก์เอเจนซี่แบบแยกต่อเจ้า (แต่ละเจ้าเห็นเฉพาะ KOL ของตัวเอง) =====
    async addAgencyLink(id, name, token, opts = {}) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const p = await c.query('SELECT id FROM projects WHERE id = $1', [n]);
            if (!p.rows.length) return null;
            const cnt = await c.query('SELECT COUNT(*)::int AS c FROM agency_links WHERE project_id = $1', [n]);
            const link = {
                token,
                name: (name && String(name).trim()) || `เอเจนซี่ ${cnt.rows[0].c + 1}`,
                groups: Array.isArray(opts.groups) ? opts.groups.filter(Boolean) : [],   // กลุ่มที่รับผิดชอบ (ว่าง = ใช้ Platform/สินค้ากรองแทน)
                products: Array.isArray(opts.products) ? opts.products : [],   // สินค้าที่รับผิดชอบ
                platforms: Array.isArray(opts.platforms) ? opts.platforms : [], // Platform ที่รับผิดชอบ
                kol_count: Number(opts.kol_count) || 0,                         // จำนวน KOL ที่ต้องส่ง
                created_at: now()
            };
            await insertRow('agency_links', {
                project_id: n,
                token: link.token,
                name: link.name,
                groups: asJson(link.groups, []),
                products: asJson(link.products, []),
                platforms: asJson(link.platforms, []),
                kol_count: link.kol_count,
                created_at: link.created_at
            }, c);
            return clone(link);
        });
    },

    // รวมห้องแชททุกแคมเปญที่ทีมนี้มองเห็น — ใช้ทำรายการห้องในกล่องแชทลอย
    // scopeBrands = null คือเห็นทุกแบรนด์
    async listTeamChats(scopeBrands) {
        const snap = await loadSnapshot(['projects']);
        const out = [];
        for (const p of snap.projects) {
            if (!inScope(p, scopeBrands)) continue;
            for (const l of (p.agency_links || [])) {
                const msgs = l.messages || [];
                const readAt = l.team_read_at ? new Date(l.team_read_at).getTime() : 0;
                const unread = msgs.filter(m => m.from !== 'team' && new Date(m.at).getTime() > readAt).length;
                const last = msgs.length ? msgs[msgs.length - 1] : null;
                out.push({
                    project_id: p.id, project_name: p.name, token: l.token,
                    agency_name: l.name, unread,
                    last: last ? { text: last.text || (last.image ? '[รูปภาพ]' : ''), at: last.at, from: last.from } : null
                });
            }
        }
        // ห้องที่มีข้อความใหม่ขึ้นก่อน แล้วเรียงตามข้อความล่าสุด ห้องที่ยังไม่เคยคุยไปท้าย
        out.sort((a, b) => (b.unread - a.unread)
            || (new Date(b.last?.at || 0) - new Date(a.last?.at || 0)));
        return clone(out);
    },

    // ---------- ข้อความคุยกันระหว่างทีมกับเอเจนซี่ (ห้องละ 1 ลิงก์เอเจนซี่) ----------
    // msg = { id, from: "team"|"agency", by, text, image?: {filename,original,size}, at }
    async addAgencyMessage(id, token, msg) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const row = { id: genReportId(), at: now(), ...msg };
        await insertRow('agency_messages', {
            id: row.id,
            link_id: link.id,
            msg_from: row.from === undefined ? null : row.from,
            by_name: row.by === undefined ? null : row.by,
            text: row.text === undefined ? null : row.text,
            image: row.image === undefined || row.image === null ? null : JSON.stringify(row.image),
            thumb: row.thumb === undefined || row.thumb === null ? null : JSON.stringify(row.thumb),
            at: row.at,
            edited_at: row.edited_at === undefined ? null : row.edited_at,
            deleted_at: row.deleted_at === undefined ? null : row.deleted_at
        });
        return clone(row);
    },

    // หาข้อความ 1 อัน พร้อมลิงก์ที่มันสังกัด (ใช้ร่วมกันตอนแก้/ลบ)
    // หมายเหตุ: ของเดิมเป็น sync — ที่นี่ต้องเป็น async เพราะต้องอ่านฐานข้อมูล (ผู้เรียกทั้งสองที่ await ให้แล้ว)
    async _findMessage(id, token, msgId) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const { rows } = await query('SELECT * FROM agency_messages WHERE link_id = $1 AND id = $2',
            [link.id, msgId]);
        return rows[0] ? { link: linkOut(link, [], []), m: msgOut(rows[0]) } : null;
    },

    // แก้ข้อความ — ได้เฉพาะข้อความของฝั่งตัวเอง และที่ยังไม่ถูกลบ
    async editAgencyMessage(id, token, msgId, side, text) {
        const found = await this._findMessage(id, token, msgId);
        if (!found) return { error: 404 };
        const { m } = found;
        if (m.from !== side) return { error: 403 };
        if (m.deleted_at) return { error: 410 };
        const at = now();
        await query('UPDATE agency_messages SET text = $1, edited_at = $2 WHERE id = $3', [text, at, m.id]);
        m.text = text;
        m.edited_at = at;
        return { data: clone(m) };
    },

    // ลบข้อความ — เก็บร่องรอยไว้ว่าเคยมีข้อความตรงนี้ แต่เนื้อหาและรูปหายไป
    // (ทำแบบเดียวกับไลน์ เพราะแชทนี้ใช้อ้างอิงตอนตกลงงานกัน ลบหายทั้งดุ้นจะดูย้อนไม่ได้ว่าเคยคุยอะไร)
    async deleteAgencyMessage(id, token, msgId, side) {
        const found = await this._findMessage(id, token, msgId);
        if (!found) return { error: 404 };
        const { m } = found;
        if (m.from !== side) return { error: 403 };
        const files = [m.image, m.thumb].filter(Boolean).map(f => f.filename);
        const at = now();
        await query('UPDATE agency_messages SET text = $1, image = NULL, thumb = NULL, deleted_at = $2 WHERE id = $3',
            ['', at, m.id]);
        m.text = '';
        m.image = null;
        m.thumb = null;
        m.deleted_at = at;
        return { data: clone(m), files };   // ผู้เรียกเอา files ไปลบไฟล์จริงต่อ
    },

    async listAgencyMessages(id, token) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const { rows } = await query('SELECT * FROM agency_messages WHERE link_id = $1 ORDER BY at, id', [link.id]);
        return {
            messages: rows.map(msgOut),
            team_read_at: link.team_read_at || null,
            agency_read_at: link.agency_read_at || null
        };
    },

    // จำว่าอ่านถึงเมื่อไหร่ ใช้คิดจำนวนที่ยังไม่ได้อ่านของอีกฝั่ง
    async markAgencyRead(id, token, side) {
        const n = intId(id);
        if (n === null) return null;
        const col = side === 'team' ? 'team_read_at' : 'agency_read_at';
        const r = await query(
            `UPDATE agency_links SET ${col} = $1 WHERE project_id = $2 AND token = $3 RETURNING id`,
            [now(), n, token]);
        return r.rowCount ? true : null;
    },

    // ไฟล์รูปในข้อความ — หาโดยไม่ต้องรู้ว่าอยู่ข้อความไหน
    // which = 'image' (รูปเต็ม) หรือ 'thumb' (รูปย่อที่ใช้โชว์ในแชท)
    // ข้อความเก่าไม่มี thumb ให้ถอยไปใช้รูปเต็มแทน
    async getAgencyMessageImage(id, token, msgId, which = 'image') {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const { rows } = await query('SELECT image, thumb FROM agency_messages WHERE link_id = $1 AND id = $2',
            [link.id, msgId]);
        const m = rows[0];
        if (!m) return null;
        const image = parseImg(m.image);
        const thumb = parseImg(m.thumb);
        const pick = which === 'thumb' ? (thumb || image) : image;
        return pick ? clone(pick) : null;
    },

    // ---------- ไฟล์/ลิงก์ Report ที่เอเจนซี่ส่งเข้ามา (เก็บผูกกับลิงก์ของแต่ละเจ้า) ----------
    // meta = { kind: "file"|"link", original, filename?, size?, url?, note?, uploaded_at }
    async addAgencyReport(id, token, meta) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const row = { id: genReportId(), uploaded_at: now(), ...meta };
        await insertRow('agency_reports', {
            id: row.id,
            link_id: link.id,
            kind: row.kind === undefined ? null : row.kind,
            filename: row.filename === undefined ? null : row.filename,
            original: row.original === undefined ? null : row.original,
            url: row.url === undefined ? null : row.url,
            size: asNumOrNull(row.size),
            note: row.note === undefined ? null : row.note,
            uploaded_at: row.uploaded_at
        });
        return clone(row);
    },

    async listAgencyReports(id, token) {
        const n = intId(id);
        if (n === null) return [];
        const link = await findLinkRow(n, token);
        if (!link) return [];
        const { rows } = await query('SELECT * FROM agency_reports WHERE link_id = $1 ORDER BY uploaded_at, id',
            [link.id]);
        return rows.map(reportOut);
    },

    async getAgencyReport(id, token, reportId) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const { rows } = await query('SELECT * FROM agency_reports WHERE link_id = $1 AND id = $2',
            [link.id, reportId]);
        return rows[0] ? reportOut(rows[0]) : null;
    },

    async removeAgencyReport(id, token, reportId) {
        const n = intId(id);
        if (n === null) return null;
        const link = await findLinkRow(n, token);
        if (!link) return null;
        const { rows } = await query('DELETE FROM agency_reports WHERE link_id = $1 AND id = $2 RETURNING *',
            [link.id, reportId]);
        return rows[0] ? reportOut(rows[0]) : null;
    },

    async listAgencyLinks(id) {
        const n = intId(id);
        if (n === null) return [];
        return (await loadAgencyLinks([n])).get(n) || [];
    },

    // แก้ขอบเขตงานของลิงก์ (ชื่อ/สินค้า/Platform/จำนวน KOL) — token เดิมไม่เปลี่ยน ลิงก์ที่ส่งไปแล้วยังใช้ได้
    async updateAgencyLink(id, token, fields) {
        const n = intId(id);
        if (n === null) return null;
        const updated = await withTransaction(async (c) => {
            const r = await c.query(
                'SELECT * FROM agency_links WHERE project_id = $1 AND token = $2 FOR UPDATE', [n, token]);
            const link = r.rows[0];
            if (!link) return null;
            const data = {};
            if (fields.name !== undefined && String(fields.name).trim()) data.name = String(fields.name).trim();
            if (Array.isArray(fields.groups)) data.groups = asJson(fields.groups.filter(Boolean), []);
            if (Array.isArray(fields.products)) data.products = asJson(fields.products.filter(Boolean), []);
            if (Array.isArray(fields.platforms)) data.platforms = asJson(fields.platforms.filter(Boolean), []);
            if (fields.kol_count !== undefined) data.kol_count = Number(fields.kol_count) || 0;
            data.updated_at = now();
            return await updateRow('agency_links', link.id, data, c);
        });
        if (!updated) return null;
        // ของเดิมคืน "ลิงก์ทั้งก้อน" ซึ่งมี messages/reports ติดมาด้วย
        const same = ((await loadAgencyLinks([n])).get(n) || []).find(l => l.token === token);
        return same || linkOut(updated, [], []);
    },

    async removeAgencyLink(id, token) {
        const n = intId(id);
        if (n === null) return false;
        const r = await query('DELETE FROM agency_links WHERE project_id = $1 AND token = $2', [n, token]);
        return r.rowCount > 0;
    },

    // resolve token → { project, link }; link.scoped=true = ลิงก์แยกต่อเจ้า (กรองเฉพาะของตัวเอง)
    async resolveToken(token) {
        const found = (await query('SELECT project_id FROM agency_links WHERE token = $1', [token])).rows[0];
        if (found) {
            const p = (await query('SELECT * FROM projects WHERE id = $1', [found.project_id])).rows[0];
            if (p) {
                await attachLinks(p);
                const link = (p.agency_links || []).find(l => l.token === token);
                if (link) {
                    const picked = (link.groups || []).filter(Boolean);
                    // เลือกกลุ่มไว้แล้ว = ขอบเขตยึดตามกลุ่ม ถ้าไม่ได้ระบุ Platform/สินค้าเองก็เติมจากกลุ่มให้
                    const gs = picked.length ? (p.ad_groups || []).filter(g => picked.includes(g.key)) : [];
                    const gPlats = [...new Set(gs.flatMap(g => linkGroupPlatforms(g)))];
                    const gProds = [...new Set(gs.flatMap(g => g.products || []))];
                    return {
                        project: clone(p),
                        link: {
                            token: link.token, name: link.name,
                            groups: picked,
                            products: (link.products && link.products.length) ? link.products : gProds,
                            platforms: (link.platforms && link.platforms.length) ? link.platforms : gPlats,
                            kol_count: link.kol_count || 0,
                            reports: clone(link.reports || []), scoped: true
                        }
                    };
                }
            }
        }
        // ลิงก์รวมเดิม → เห็นทั้งหมด (backward compat)
        const p = (await query('SELECT * FROM projects WHERE share_token = $1', [token])).rows[0];
        if (p) {
            await attachLinks(p);
            return { project: clone(p), link: { token, name: null, products: [], platforms: [], kol_count: 0, reports: [], scoped: false } };
        }
        return null;
    },

    // บันทึกไฟล์บรีฟ
    async setBriefFile(id, meta) {
        const n = intId(id);
        if (n === null) return null;
        const { rows } = await query(
            'UPDATE projects SET brief_file = $1, updated_at = $2 WHERE id = $3 RETURNING *',
            [asJson(meta), now(), n]);
        return rows[0] ? clone(await attachLinks(rows[0])) : null;
    },

    async count(scopeBrands = null) {
        // เดิมกรองใน JS ด้วย scope.includes(p.brand) — คงไว้เหมือนเดิม
        // (SQL `brand = ANY(...)` จะให้ผลต่างเมื่อ brand เป็น NULL หรือ scope มี null ปนอยู่)
        const { rows } = await query('SELECT brand FROM projects ORDER BY id');
        return scopeProjects(rows, scopeBrands).length;
    },

    // จำนวน Project แยกตามสถานะ (สำหรับกราฟเล็ก)
    async statusCounts(scopeBrands = null) {
        const { rows } = await query('SELECT brand, status FROM projects ORDER BY id');
        const scoped = scopeProjects(rows, scopeBrands);
        const order = ['Draft', 'Active', 'Completed', 'Cancelled'];
        const map = {};
        scoped.forEach(p => { map[p.status] = (map[p.status] || 0) + 1; });
        return order.map(s => ({ label: s, value: map[s] || 0 }));
    }
};

module.exports = { projects, enrichProject, genReportId };
