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
const { now, clone, inScope, scopeProjects, linkGroupPlatforms, hireRowFee, sameInstant, normCampaignType, updateLatest } = require('../logic');
const { soloSummary, soloClipLive, soloClipEmpty, withSoloBudgets } = require('../soloKol');

// KOL รายคน: ผลรวมค่าตัวต่อ Platform ของคลิปที่ไม่ถูกปฏิเสธ (งบของแต่ละบล็อกในกลุ่ม)
const SOLO_SUMS_SQL = "SELECT platform, COALESCE(SUM(budget), 0) AS total FROM submissions WHERE project_id = $1 AND status <> 'rejected' GROUP BY platform";
const soloSums = rows => {
    const per = {};
    (rows || []).forEach(r => { if (r.platform) per[r.platform] = Number(r.total) || 0; });
    return per;
};
// updateSolo ตีกลับ (ข้อมูลไม่ผ่าน) — โยนจากในทรานแซกชันให้ ROLLBACK เสมอ แล้วแปลงเป็น { error } ข้างนอก
// (withTransaction COMMIT เมื่อ callback คืนค่าปกติ ถ้าคืน { error } เฉย ๆ หลังเขียนอะไรไปแล้ว ส่วนนั้นจะค้างในฐาน)
class SoloReject extends Error {
    constructor(httpCode, message) { super(message); this.httpCode = httpCode; }
}

// ช่องของ projects ที่แก้ได้จากฟอร์ม → ค่าที่พร้อมเขียนลงฐาน
// null = ผู้ใช้ล้างค่าออกจริง ๆ (route ส่งเฉพาะคีย์ที่ client ส่งมา คีย์ที่ไม่ได้แก้จะเป็น undefined)
function projectPatchData(fields) {
    const data = {};
    const put = (key, val) => { if (fields[key] !== undefined) data[key] = val(fields[key]); };
    for (const key of ['name', 'brand', 'objective', 'product', 'owner', 'creator', 'brief_link', 'status', 'description']) {
        put(key, v => v);
    }
    put('products', v => asJson(v, []));
    put('ad_groups', v => asJson(v, []));
    put('campaign_type', v => normCampaignType(v));
    put('hire_items', v => asJson(v, []));
    put('product_briefs', v => asJson(v, {}));
    put('platform_briefs', v => asJson(v, {}));
    put('platform_budgets', v => asJson(v, {}));
    put('kol_target', v => asNum(v, 0));
    put('budget', v => asNum(v, 0));
    put('start_date', v => asDate(v));
    put('end_date', v => asDate(v));
    put('updated_by', v => v);
    return data;
}

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
    const out = {
        ...p,
        team_name: team ? team.name : null,
        created_by_name: creator ? (creator.full_name || creator.username) : null,
        updated_by_name: editor ? (editor.full_name || editor.username) : null,
        kol_count,
        sub_count: subs.length,
        sub_confirmed,
        // เวลาอัปเดตล่าสุดของแท็บรายชื่อ KOL / On Process — ป้าย "อัปเดตใหม่" บนการ์ดแคมเปญ (2 ต.ค. 2026)
        ...updateLatest(subs)
    };
    // KOL รายคน: สรุปของแถวในแท็บ KOL รายคน (ชื่อบัญชี / ค่าตัว / คลิปลงแล้ว / ขั้นถัดไป) — คิดจาก snapshot ที่โหลดมาแล้ว ไม่ยิง query เพิ่ม
    if (p.campaign_type === 'solo') out.solo_summary = soloSummary(subs, (p.ad_groups || [])[0] || null);
    return out;
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

    // อ่านแค่แบรนด์ + รายการจ้างของงานเดียว — เส้นเปิดรูป/คลิปถูกเรียกทีละหลายรูปตอนเปิดหน้างาน
    // (findByIdFull โหลดทุกตารางทั้งฐาน ถ้าใช้กับทุกรูปฐานกลางจะรับไม่ไหว)
    async findHireFiles(id) {
        const n = intId(id);
        if (n === null) return null;
        const { rows } = await query('SELECT id, brand, campaign_type, hire_items FROM projects WHERE id = $1', [n]);
        return rows[0] ? clone(rows[0]) : null;
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

    // client = ทรานแซกชันที่เปิดค้างไว้ (createSolo) · ไม่ส่ง = เขียนตรง
    async create(fields, client) {
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
            // ค่าที่ไม่รู้จักถอยไปเป็น 'kol' เสมอ — แคมเปญที่หลุดเป็นประเภทประหลาดจะหายจากหน้าโฆษณา/รายงานโดยไม่มีใครรู้
            campaign_type: normCampaignType(fields.campaign_type),
            hire_items: asJson(Array.isArray(fields.hire_items) ? fields.hire_items : [], []),
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
        }, client);
    },

    // KOL รายคน: แถวแคมเปญ (campaign_type 'solo') + แถวคลิปทั้งหมด ในทรานแซกชันเดียว — สำเร็จทั้งชุดหรือไม่เกิดอะไรเลย
    // persons = ข้อมูลแถวคลิปต่อ Platform ตามลำดับ (soloPersons: ชื่อบัญชี / ลิงก์ / ผู้ติดตาม / Tier / Content Type / fee
    //   + สินค้า / Agency / group_key / อายุ Gencode ที่ใช้ร่วมกัน) · clipNames = ชื่อคลิป (1 คลิป = []) ใช้ร่วมทุก Platform
    // แถว = Platform × คลิป · person_key เดียวทุกแถว (1 การจ้าง = 1 คนใน Dashboard) · ทุกแถวใช้เวลาเดียวกัน
    // แถวคลิปเกิดมาเป็น confirmed (จ้างแล้ว ไม่มีขั้นคัดเลือก) — On Process / Dashboard / รายงานนับเฉพาะ confirmed
    async createSolo(fields, persons, clipNames = [], decidedBy = null) {
        const { newRow } = require('./submissions');
        const people = Array.isArray(persons) ? persons.filter(Boolean) : [];
        if (!people.length) throw new Error('createSolo: ต้องมีอย่างน้อย 1 Platform');
        const names = Array.isArray(clipNames) ? clipNames.filter(c => c && String(c).trim()) : [];
        return await withTransaction(async (c) => {
            const project = await projects.create({ ...fields, campaign_type: 'solo' }, c);
            const personKey = 'p' + Math.random().toString(36).slice(2, 10);
            const at = now();   // ทุกคลิปของการจ้างใช้เวลาเดียวกัน (รายการเรียงตามเวลา — ไม่งั้นคลิป 2 ขึ้นก่อนคลิป 1)
            const count = names.length < 2 ? 1 : names.length;
            const rows = [];
            for (const p of people) {
                const { fee, ...cols } = p;
                for (let i = 0; i < count; i++) {
                    rows.push(await insertRow('submissions', newRow({
                        ...cols, budget: fee, project_id: project.id, person_key: personKey,
                        clip_no: i + 1, clip_name: names.length < 2 ? (names[0] || null) : names[i],
                        status: 'confirmed', decided_by: decidedBy
                    }, at), c));
                }
            }
            return { project, rows };
        });
    },

    // KOL รายคน: แก้ข้อมูลการจ้าง (ช่วง 3 · รอบ 4 หลาย Platform) — ทั้งหมดในทรานแซกชันเดียว ล็อกรายการและทุกคลิปก่อน
    // ตรวจทุกข้อก่อนเขียนอะไรเลย (ตีกลับ = โยน SoloReject ให้ ROLLBACK):
    //  • แบรนด์เปลี่ยนไม่ได้เมื่อมีคลิปเริ่มงานแล้ว (เกณฑ์สแตมป์ / ฟีดยิงแอด / ค่าแอดผูกอยู่)
    //  • เอา Platform ออกได้เมื่อทุกคลิปของ Platform นั้นยังว่าง · ลดจำนวนคลิป = ลบคลิปท้าย ๆ ได้เฉพาะคลิปที่ยังว่าง
    //  • Platform ที่เพิ่มใหม่ (ยังไม่มีคลิป) ต้องมีค่าตัว (0 = ได้ฟรี)
    //  • ผู้รับเงินเปลี่ยน: งวดที่รอจ่ายย้ายตาม · มีงวดจ่ายแล้ว/เข้ารอบทำจ่ายแล้ว = ห้าม
    // แล้วค่อยเขียน: แถวเดิมได้ข้อมูลของ Platform ตัวเอง (ไม่เปลี่ยน Platform ของแถว) · คลิปที่ขาด (Platform × คลิป) เพิ่มให้
    //   ค่าตัวเท่าคลิปแรกของ Platform นั้น (Platform ใหม่ = ค่าตัวที่ส่งมา) · อายุ Gencode ใหม่ใช้กับคลิปที่ยังไม่มี Gencode
    //   งบ = ผลรวมค่าตัวจริงต่อ Platform · ไม่แตะ start_date / end_date (วันที่สร้างรายการ)
    // persons = soloPersons (fee: null = ไม่ได้ส่งค่าตัวมา) · คืน { project, removed, added, platforms_added, platforms_removed } หรือ { error: { code, message } }
    async updateSolo(id, { fields, group, persons = [], clipNames = [], codeExpire }, decidedBy = null) {
        const n = intId(id);
        if (n === null) return { error: { code: 404, message: 'ไม่พบรายการ' } };
        const { newRow } = require('./submissions');
        const reject = (code, message) => { throw new SoloReject(code, message); };
        try {
            return await withTransaction(async (c) => {
                const cur = (await c.query('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [n])).rows[0];
                if (!cur) reject(404, 'ไม่พบรายการ');
                if (cur.campaign_type !== 'solo') reject(400, 'รายการนี้ไม่ใช่ KOL รายคน');
                const subs = (await c.query('SELECT * FROM submissions WHERE project_id = $1 ORDER BY clip_no, id FOR UPDATE', [n])).rows;
                const g0 = (Array.isArray(cur.ad_groups) ? cur.ad_groups[0] : null) || {};
                const people = (Array.isArray(persons) ? persons : []).filter(p => p && p.platform);
                if (!people.length) reject(400, 'เลือก Platform อย่างน้อย 1 ตัว');
                const plats = people.map(p => p.platform);
                const names = Array.isArray(clipNames) ? clipNames : [];
                const want = names.length < 2 ? 1 : names.length;
                const clipLabel = s => `${s.platform} คลิปที่ ${s.clip_no}${s.clip_name ? ` (${s.clip_name})` : ''}`;

                // ---- ตรวจทั้งหมดก่อนเขียน ----
                if (fields.brand !== cur.brand && subs.some(soloClipLive)) reject(409, 'เปลี่ยนแบรนด์ไม่ได้ — มีคลิปที่ลงงาน/ยิงแอดแล้ว');
                const gone = subs.filter(s => !plats.includes(s.platform));
                const goneBusy = gone.find(s => !soloClipEmpty(s));
                if (goneBusy) reject(409, `เอา ${goneBusy.platform} ออกไม่ได้ — ${clipLabel(goneBusy)} มีงานแล้ว`);
                const kept = subs.filter(s => plats.includes(s.platform));
                const drop = kept.filter(s => (Number(s.clip_no) || 1) > want);
                const busy = drop.find(s => !soloClipEmpty(s));
                if (busy) reject(409, `ลดจำนวนคลิปไม่ได้ — ${clipLabel(busy)} มีงานแล้ว`);
                const had = new Set(kept.map(s => s.platform));
                const noFee = people.find(p => !had.has(p.platform) && p.fee == null);
                if (noFee) reject(400, `${noFee.platform}: ใส่ค่าตัวต่อคลิป (ได้ฟรีใส่ 0)`);
                // ผู้รับเงินเปลี่ยน (แก้ชื่อบัญชี / ชื่อ Agency / สลับติดต่อเอง-ผ่าน Agency) — งวดจ่ายผูกกับชื่อผู้รับเงิน (installments.agency)
                // งวดที่ยังรอจ่ายย้ายตามชื่อใหม่ · มีงวดที่จ่ายแล้วหรือเข้ารอบทำจ่ายแล้ว = ห้ามเปลี่ยน (สลิป/รอบออกไปแล้วในชื่อเดิม)
                const s0 = g0.solo || {};
                const oldPayee = String(s0.payee || s0.account_name || '').trim();
                const newPayee = String((group.solo && group.solo.payee) || '').trim();
                let its = [];
                if (oldPayee && newPayee && oldPayee !== newPayee) {
                    its = (await c.query('SELECT id, status, batch_id FROM installments WHERE project_id = $1 AND agency = $2 FOR UPDATE', [n, oldPayee])).rows;
                    if (its.some(it => it.status === 'paid' || it.batch_id != null)) {
                        reject(409, `เปลี่ยนผู้รับเงินไม่ได้ — มีงวดจ่ายของ "${oldPayee}" ที่จ่ายแล้วหรืออยู่ในรอบทำจ่ายแล้ว`);
                    }
                }

                // ---- เขียน ----
                if (its.length) await c.query('UPDATE installments SET agency = $1 WHERE project_id = $2 AND agency = $3', [newPayee, n, oldPayee]);
                for (const s of [...gone, ...drop]) await c.query('DELETE FROM submissions WHERE id = $1', [s.id]);
                const at = now();
                const key = g0.key || group.key;
                const byPlat = new Map(people.map(p => [p.platform, p]));
                const keep = kept.filter(s => (Number(s.clip_no) || 1) <= want);
                for (const s of keep) {
                    const p = byPlat.get(s.platform);
                    const i = (Number(s.clip_no) || 1) - 1;
                    const patch = {
                        account_name: p.account_name, link_account: p.link_account || null, followers: asNum(p.followers || 0, 0),
                        tier: p.tier || null, agency: p.agency || null, product: p.product,
                        content_type: p.content_type, group_key: key || s.group_key,
                        clip_name: names.length < 2 ? null : names[i], list_updated_at: at
                    };
                    if (!String(s.gencode || '').trim()) patch.code_expire = Number(codeExpire) || 60;
                    await updateRow('submissions', s.id, patch, c);
                }
                const personKey = (subs.find(s => s.person_key) || {}).person_key || ('p' + Math.random().toString(36).slice(2, 10));
                let added = 0;
                for (const p of people) {
                    const prior = kept.filter(s => s.platform === p.platform);
                    const fee = prior.length ? Number(prior[0].budget) || 0 : p.fee;
                    const nos = new Set(keep.filter(s => s.platform === p.platform).map(s => Number(s.clip_no) || 1));
                    for (let k = 1; k <= want; k++) {
                        if (nos.has(k)) continue;
                        await insertRow('submissions', newRow({
                            project_id: n, account_name: p.account_name, followers: p.followers, platform: p.platform,
                            product: p.product, budget: fee, agency: p.agency, link_account: p.link_account,
                            group_key: key, tier: p.tier, content_type: p.content_type, code_expire: codeExpire,
                            person_key: personKey, clip_no: k, clip_name: names.length < 2 ? null : names[k - 1],
                            status: 'confirmed', decided_by: decidedBy
                        }, at), c);
                        if (had.has(p.platform)) added++;
                    }
                }
                const sums = soloSums((await c.query(SOLO_SUMS_SQL, [n])).rows);
                const { group: g, total, platform_budgets } = withSoloBudgets({ ...group, key }, sums);
                const row = await updateRow('projects', n, {
                    name: fields.name, brand: fields.brand, objective: fields.objective || null, brief_link: fields.brief_link || null,
                    products: asJson(fields.products || [], []), ad_groups: asJson([g], []),
                    owner: fields.owner || null, creator: fields.owner || null,
                    budget: total, platform_budgets: asJson(platform_budgets, {}),
                    updated_by: fields.updated_by || null, updated_at: now()
                }, c);
                return {
                    project: row, removed: drop.length, added,
                    platforms_added: plats.filter(p => !had.has(p)),
                    platforms_removed: [...new Set(gone.map(s => s.platform))]
                };
            });
        } catch (e) {
            if (e instanceof SoloReject) return { error: { code: e.httpCode, message: e.message } };
            throw e;
        }
    },

    // KOL รายคน: งบของรายการ = ผลรวมค่าตัวของคลิปที่ยังไม่ถูกปฏิเสธ (แยกต่อ Platform ลงบล็อกของ Platform นั้น) — เรียกหลังแก้ค่าตัวทุกครั้ง
    // (ไม่งั้น Dashboard เห็นงบเก่าแล้วขึ้น "เกินงบ" ปลอม และฐานของแผนจ่ายเงินผิด) · ไม่ใช่ KOL รายคน = ไม่ทำอะไร
    async syncSoloBudget(id) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT campaign_type, ad_groups FROM projects WHERE id = $1 FOR UPDATE', [n]);
            const p = r.rows[0];
            if (!p || p.campaign_type !== 'solo') return null;
            const sums = soloSums((await c.query(SOLO_SUMS_SQL, [n])).rows);
            const groups = Array.isArray(p.ad_groups) ? p.ad_groups.map(g => ({ ...g })) : [];
            const out = withSoloBudgets(groups[0] || {}, sums);
            if (groups[0]) groups[0] = out.group;
            return await updateRow('projects', n, {
                budget: out.total,
                ad_groups: asJson(groups, []),
                platform_budgets: asJson(out.platform_budgets, {}),
                updated_at: now()
            }, c);
        });
    },

    async update(id, fields) {
        const n = intId(id);
        if (n === null) return null;
        const data = projectPatchData(fields);
        data.updated_at = now();
        return await updateRow('projects', n, data);
    },

    // แก้ข้อมูลงาน + รายการจ้างที่ฟอร์มส่งมาทั้งก้อน ในทรานแซกชันเดียว
    // เดิมบันทึกรายการจ้างก่อนแล้วค่อยแก้ช่องอื่นแยกอีกคำขอ — ถ้าพังระหว่างนั้นจะได้ข้อมูลครึ่ง ๆ กลาง ๆ
    // ล็อกแถว แล้วเช็คว่าไม่มีใคร (หรืองานจัดหา) แก้ระหว่างที่หน้าเว็บเปิดค้างไว้ — expectedUpdatedAt ไม่ตรง → { conflict }
    // build(current) คืนรายการจ้างชุดใหม่ทั้งชุด · งบของงานคำนวณใหม่จากชุดนั้นเสมอ (งบที่ส่งมาในฟอร์มไม่ใช้)
    async updateWithHireItems(id, fields, expectedUpdatedAt, build) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT hire_items, updated_at FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            const cur = r.rows[0];
            if (!sameInstant(cur.updated_at, expectedUpdatedAt)) return { conflict: true };
            const next = build(Array.isArray(cur.hire_items) ? cur.hire_items : []);
            if (!Array.isArray(next)) return null;
            const data = projectPatchData({ ...fields, hire_items: undefined, budget: undefined });
            data.hire_items = asJson(next, []);
            data.budget = next.reduce((s, it) => s + hireRowFee(it), 0);
            data.updated_at = now();
            const row = await updateRow('projects', n, data, c);
            return { row, items: clone(next) };
        });
    },

    // แก้ hire_items ทีละแถวแบบล็อกแถวไว้ — งานจัดหามีสองฝั่งแตะงานเดียวกันคนละเวลา
    // (คนขอแก้แคมเปญอยู่ / คนจัดหาเสนอชื่อเข้ามา) ถ้าต่างคนต่างส่งทั้งก้อนแบบหน้าเว็บ ฝั่งที่บันทึกทีหลังจะทับอีกฝั่ง
    // fn(row, items) ต้องคืน "อาเรย์ใหม่ทั้งชุด" หรือ null ถ้าไม่ให้แก้ · งบของแคมเปญคำนวณใหม่จากอาเรย์นั้นเสมอ
    async patchHireItems(id, key, fn) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query('SELECT hire_items FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            const items = Array.isArray(r.rows[0].hire_items) ? r.rows[0].hire_items : [];
            const row = items.find(it => String(it.key) === String(key));
            if (!row) return null;
            const next = fn(clone(row), clone(items));
            if (!Array.isArray(next)) return null;
            const budget = next.reduce((s, it) => s + hireRowFee(it), 0);
            await c.query('UPDATE projects SET hire_items = $1, budget = $2, updated_at = $3 WHERE id = $4',
                [asJson(next, []), budget, now(), n]);
            return clone(next);
        });
    },

    // เพิ่มรายการจ้าง 1 แถวต่อท้าย (ฟอร์มสั้นหน้า Talent) — ล็อกแถว อ่านของล่าสุด ต่อท้าย คิดงบใหม่ ในทรานแซกชันเดียว
    // ไม่แตะแถวอื่นเลย และไม่เช็ค expected_updated_at: การเพิ่มแถวไม่ทับงานของใคร (แบบเดียวกับเส้นที่ใช้ patchHireItems)
    // guard({ status, campaign_type }) ตัดสินจากค่าที่ล็อกไว้ — คืน { error } เพื่อตีกลับ (ส่งต่อให้ route ตามนั้น)
    // item = แถวที่ผ่าน newHireRow แล้ว · ไม่เจองาน = null · สำเร็จ = { item, items, updated_at }
    async addHireItem(id, item, { userId = null, guard } = {}) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query(
                'SELECT hire_items, status, campaign_type, start_date, end_date FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            const cur = r.rows[0];
            const bad = typeof guard === 'function' ? guard({ status: cur.status, campaign_type: cur.campaign_type || 'kol' }) : null;
            if (bad && bad.error) return bad;
            const items = Array.isArray(cur.hire_items) ? cur.hire_items : [];
            // key ต้องไม่ชนกับแถวที่มีอยู่ ไม่งั้นรูป/การยืนยันคิวของแถวเดิมจะถูกหยิบผิดแถว (เส้นอื่นหาแถวด้วย key)
            const row = clone(item);
            const keys = new Set(items.filter(Boolean).map(it => String(it.key)));
            while (!row.key || keys.has(String(row.key))) row.key = 'h' + Math.random().toString(36).slice(2, 9);
            const next = [...items, row];
            const budget = next.reduce((s, it) => s + hireRowFee(it), 0);
            // ช่วงวันของงานต้องครอบวันใช้งานเสมอ (ฟอร์มเต็มคิดใหม่ทุกครั้งที่บันทึก) ไม่งั้นงานหายจากตัวกรองเดือน
            // ขยายอย่างเดียว ไม่หด — แถวเดิมยังอยู่ครบ
            const d = typeof row.use_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.use_date) ? row.use_date : null;
            const start = d && (!cur.start_date || d < cur.start_date) ? d : (cur.start_date || null);
            const end = d && (!cur.end_date || d > cur.end_date) ? d : (cur.end_date || null);
            // updated_by = คนที่เพิ่มคนล่าสุด (เหมือน PUT /projects/:id) · ไม่รู้ว่าใคร = คงค่าเดิม
            const u = await c.query(
                `UPDATE projects SET hire_items = $1, budget = $2, start_date = $3, end_date = $4, updated_at = $5,
                        updated_by = COALESCE($6, updated_by)
                  WHERE id = $7 RETURNING updated_at`,
                [asJson(next, []), budget, start, end, now(), userId == null ? null : intId(userId), n]);
            return { item: clone(row), items: clone(next), updated_at: u.rows[0] ? u.rows[0].updated_at : null };
        });
    },

    // แก้รายการจ้าง 1 แถว (คนในงาน — หน้างาน Talent) — ล็อกแถว อ่านของล่าสุด แก้เฉพาะแถวนั้น คิดงบใหม่ ในทรานแซกชันเดียว
    // build(row, items, job) ตัดสินใต้ล็อก: คืน { row: แถวใหม่ } หรือ { error } (ส่งต่อให้ route ตามนั้น ไม่เขียนอะไร)
    //   job = { status, campaign_type } ของงานตอนล็อก · key ของแถวเปลี่ยนไม่ได้ (เส้นอื่นหาแถวด้วย key)
    // แถวใหม่เหมือนเดิมทุกช่อง = ไม่เขียน (ไม่ขยับ updated_at — หน้าอื่นที่เปิดค้างไม่ต้องโหลดใหม่เพราะคำขอที่ไม่ได้เปลี่ยนอะไร)
    // ไม่เจองาน / ไม่เจอแถว = null · สำเร็จ = { item, items, updated_at }
    async updateHireRow(id, key, build, { userId = null } = {}) {
        const n = intId(id);
        if (n === null) return null;
        return await withTransaction(async (c) => {
            const r = await c.query(
                'SELECT hire_items, status, campaign_type, start_date, end_date, updated_at FROM projects WHERE id = $1 FOR UPDATE', [n]);
            if (!r.rows.length) return null;
            const cur = r.rows[0];
            const items = Array.isArray(cur.hire_items) ? cur.hire_items : [];
            const idx = items.findIndex(it => it && String(it.key) === String(key));
            if (idx < 0) return null;
            const out = typeof build === 'function'
                ? build(clone(items[idx]), clone(items), { status: cur.status, campaign_type: cur.campaign_type || 'kol' })
                : null;
            if (!out || typeof out !== 'object') return null;
            if (out.error) return out;
            if (!out.row || typeof out.row !== 'object' || Array.isArray(out.row)) return null;
            const row = { ...clone(out.row), key: items[idx].key };
            if (JSON.stringify(row) === JSON.stringify(items[idx])) {
                return { item: clone(row), items: clone(items), updated_at: cur.updated_at || null };
            }
            const next = items.slice();
            next[idx] = row;
            const budget = next.reduce((s, it) => s + hireRowFee(it), 0);
            // ช่วงวันของงานต้องครอบวันใช้งานเสมอ (แบบเดียวกับ addHireItem) — ขยายอย่างเดียว ไม่หด แถวอื่นยังใช้ช่วงเดิมอยู่
            const d = typeof row.use_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.use_date) ? row.use_date : null;
            const start = d && (!cur.start_date || d < cur.start_date) ? d : (cur.start_date || null);
            const end = d && (!cur.end_date || d > cur.end_date) ? d : (cur.end_date || null);
            const u = await c.query(
                `UPDATE projects SET hire_items = $1, budget = $2, start_date = $3, end_date = $4, updated_at = $5,
                        updated_by = COALESCE($6, updated_by)
                  WHERE id = $7 RETURNING updated_at`,
                [asJson(next, []), budget, start, end, now(), userId == null ? null : intId(userId), n]);
            return { item: clone(row), items: clone(next), updated_at: u.rows[0] ? u.rows[0].updated_at : null };
        });
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
