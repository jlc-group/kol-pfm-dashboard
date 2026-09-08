/**
 * ที่เก็บข้อมูลชั่วคราวแบบไฟล์ JSON (ใช้ระหว่างยังไม่ขึ้น PostgreSQL)
 * - เก็บทุกอย่างไว้ที่ data/db.json
 * - ออกแบบ interface ให้เหมือน repository เพื่อสลับไป PostgreSQL ภายหลังได้ง่าย
 * - method เป็น async ทั้งหมด (ให้ signature ตรงกับเวอร์ชัน DB จริง)
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
    _seq: { teams: 0, users: 0, kols: 0, projects: 0, project_kols: 0, payments: 0, activity_logs: 0, submissions: 0, rate_requests: 0, installments: 0, pay_batches: 0 },
    teams: [], users: [], kols: [], projects: [], project_kols: [], payments: [], activity_logs: [], submissions: [], rate_requests: [],
    // งวดการจ่ายของแต่ละแคมเปญ+เอเจนซี่ · รอบทำจ่าย (สลิป 1 ใบ = 1 รอบ ครอบได้หลายงวดหลายแคมเปญ)
    installments: [], pay_batches: []
};

function load() {
    try {
        if (!fs.existsSync(DATA_FILE)) return structuredClone(EMPTY);
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        // เติม key ที่อาจยังไม่มีในไฟล์เดิม (รองรับ schema เพิ่มภายหลัง)
        data._seq = data._seq || {};
        for (const k of Object.keys(EMPTY)) {
            if (k === '_seq') continue;
            if (!data[k]) data[k] = [];
        }
        for (const k of Object.keys(EMPTY._seq)) {
            if (data._seq[k] == null) data._seq[k] = 0;
        }
        return data;
    } catch (err) {
        console.error('⚠️  อ่าน db.json ไม่ได้ ใช้ค่าว่างแทน:', err.message);
        return structuredClone(EMPTY);
    }
}

let db = load();

function persist() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(coll) {
    db._seq[coll] = (db._seq[coll] || 0) + 1;
    return db._seq[coll];
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

// เกณฑ์ตัดสินว่า KOL คนนี้ "คุ้มค่า" ไหม — ใช้ที่หน้า Report และ Influencer
// (หน้า Dashboard ใช้คะแนนไล่ระดับแทน ไม่ใช้เกณฑ์ผ่าน/ไม่ผ่านนี้)
// ต้นทุนที่ใช้คิดคือ ค่าตัว + ค่ายิงแอด และยอดวิว/engagement มาจากคอนเทนต์จริง
const GOOD_CPM = 28;
const GOOD_CPE = 1.5;
const now = () => new Date().toISOString();

// จำลอง error รหัส '23505' (unique violation) ให้ route จัดการเหมือน PostgreSQL
function duplicateError(msg) {
    const e = new Error(msg || 'duplicate key value violates unique constraint');
    e.code = '23505';
    return e;
}

// ============================ teams ============================
const teams = {
    async listWithMemberCount() {
        return db.teams
            .map(t => ({ ...t, member_count: db.users.filter(u => u.team_id === t.id).length }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(clone);
    },
    async findById(id) {
        return clone(db.teams.find(t => t.id === Number(id)) || null);
    },
    async create({ name, description }) {
        if (db.teams.some(t => t.name === name)) throw duplicateError('มีชื่อทีมนี้อยู่แล้ว');
        const row = { id: nextId('teams'), name, description: description || null, created_at: now(), updated_at: now() };
        db.teams.push(row); persist();
        return clone(row);
    },
    async update(id, { name, description }) {
        const t = db.teams.find(t => t.id === Number(id));
        if (!t) return null;
        if (name != null) t.name = name;
        if (description != null) t.description = description;
        t.updated_at = now(); persist();
        return clone(t);
    },
    async remove(id) {
        const idx = db.teams.findIndex(t => t.id === Number(id));
        if (idx === -1) return false;
        db.teams.splice(idx, 1);
        // users.team_id -> null (ON DELETE SET NULL)
        db.users.forEach(u => { if (u.team_id === Number(id)) u.team_id = null; });
        // projects ของทีมนี้ถูกลบ (ON DELETE CASCADE) พร้อม project_kols
        const removedProjects = db.projects.filter(p => p.team_id === Number(id)).map(p => p.id);
        db.projects = db.projects.filter(p => p.team_id !== Number(id));
        db.project_kols = db.project_kols.filter(pk => !removedProjects.includes(pk.project_id));
        persist();
        return true;
    }
};

// ============================ users ============================
function attachTeamName(u) {
    const team = db.teams.find(t => t.id === u.team_id);
    return { ...u, team_name: team ? team.name : null };
}


// ===== ตัวกรองสิทธิ์กลาง =====
// scope = null/undefined  -> เห็นทุกแบรนด์ (admin / manager)
// scope = []              -> ยังไม่ได้รับแบรนด์ = ไม่เห็นอะไรเลย
// scope = [ชื่อแบรนด์...]  -> เห็นเฉพาะแคมเปญของแบรนด์นั้น
// เขียนไว้ที่เดียวเพราะเดิมเงื่อนไขนี้ถูกก็อปไว้ 17 จุด พลาดจุดเดียว = ข้อมูลข้ามแบรนด์หลุด
function inScope(project, scope) {
    if (!Array.isArray(scope)) return true;
    return scope.includes(project && project.brand);
}
function scopeProjects(list, scope) {
    if (!Array.isArray(scope)) return list;
    return list.filter(p => scope.includes(p.brand));
}

const users = {
    async findByUsername(username) {
        const u = db.users.find(u => u.username === username);
        return u ? clone(attachTeamName(u)) : null;
    },
    async findById(id) {
        const u = db.users.find(u => u.id === Number(id));
        return u ? clone(attachTeamName(u)) : null;
    },
    async listWithTeam() {
        return db.users
            .slice()
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(u => {
                const { password_hash, ...safe } = attachTeamName(u);
                return clone(safe);
            });
    },
    async create({ username, password_hash, full_name, nickname, role, team_id, brands, agency_tokens, status }) {
        if (db.users.some(u => u.username === username)) throw duplicateError('มี username นี้อยู่แล้ว');
        const row = {
            id: nextId('users'), username, password_hash,
            full_name: full_name || null, nickname: nickname || null,
            role: role || 'member',
            // pending = สมัครเองแล้วรออนุมัติ · active = ใช้งานได้ · rejected = ปฏิเสธ
            status: status || 'active',
            // แบรนด์ที่ member คนนี้ดูได้ (admin/manager ไม่ใช้ค่านี้ เห็นทุกแบรนด์อยู่แล้ว)
            brands: Array.isArray(brands) ? brands.filter(Boolean) : [],
            // เฉพาะ role agency — ลิงก์เอเจนซี่ที่บัญชีนี้เข้าได้ (1 เจ้าอาจมีหลายแคมเปญ)
            agency_tokens: Array.isArray(agency_tokens) ? agency_tokens.filter(Boolean) : [],
            team_id: team_id || null, is_active: true, created_at: now(), updated_at: now()
        };
        db.users.push(row); persist();
        const { password_hash: _, ...safe } = row;
        return clone(safe);
    },
    async update(id, fields) {
        const u = db.users.find(u => u.id === Number(id));
        if (!u) return null;
        // เปลี่ยนชื่อผู้ใช้ได้ แต่ห้ามซ้ำกับคนอื่น (ชื่อนี้ใช้เข้าสู่ระบบ)
        if (fields.username && fields.username !== u.username) {
            if (db.users.some(x => x.username === fields.username && x.id !== u.id)) {
                throw duplicateError('มี username นี้อยู่แล้ว');
            }
            u.username = fields.username;
        }
        for (const key of ['full_name', 'nickname', 'role', 'team_id', 'is_active', 'status', 'password_hash']) {
            if (fields[key] !== undefined && fields[key] !== null) u[key] = fields[key];
        }
        // brands เป็น array — ต้องยอมให้เซ็ตเป็น [] ได้ (ถอดแบรนด์ออกทั้งหมด)
        if (Array.isArray(fields.brands)) u.brands = fields.brands.filter(Boolean);
        if (Array.isArray(fields.agency_tokens)) u.agency_tokens = fields.agency_tokens.filter(Boolean);
        u.updated_at = now(); persist();
        const { password_hash, ...safe } = u;
        return clone(safe);
    },
    // บัญชีเอเจนซี่ทั้งหมด — ไว้ทำ dropdown ตอนสร้างลิงก์ในหน้าแคมเปญ
    async listAgencies() {
        return db.users
            .filter(u => u.role === 'agency' && u.is_active !== false)
            .map(u => ({ id: u.id, username: u.username, agency_tokens: (u.agency_tokens || []).slice() }))
            .sort((a, b) => a.username.localeCompare(b.username, 'th'));
    },
    // ผูกลิงก์งานเข้ากับบัญชีเอเจนซี่ (1 บัญชีถือได้หลายลิงก์ = หลายแคมเปญ)
    async bindAgencyToken(id, token) {
        const u = db.users.find(u => u.id === Number(id) && u.role === 'agency');
        if (!u || !token) return false;
        if (!Array.isArray(u.agency_tokens)) u.agency_tokens = [];
        if (!u.agency_tokens.includes(token)) {
            u.agency_tokens.push(token);
            u.updated_at = now();
            persist();
        }
        return true;
    },
    // ถอนลิงก์ออกจากทุกบัญชี — ใช้ตอนลบลิงก์ ไม่งั้นจะเหลือ token ตายค้างในบัญชี
    async unbindAgencyToken(token) {
        let n = 0;
        for (const u of db.users) {
            if (Array.isArray(u.agency_tokens) && u.agency_tokens.includes(token)) {
                u.agency_tokens = u.agency_tokens.filter(t => t !== token);
                u.updated_at = now();
                n++;
            }
        }
        if (n) persist();
        return n;
    },
    async countPending() {
        return db.users.filter(u => (u.status || 'active') === 'pending').length;
    },
    async remove(id) {
        const idx = db.users.findIndex(u => u.id === Number(id));
        if (idx === -1) return false;
        db.users.splice(idx, 1); persist();
        return true;
    }
};

// ============================ kols ============================
const kols = {
    async list({ search, platform, category, limit = 100, offset = 0 } = {}) {
        let rows = db.kols.slice();
        if (search) {
            const s = search.toLowerCase();
            rows = rows.filter(k =>
                (k.name || '').toLowerCase().includes(s) ||
                (k.username || '').toLowerCase().includes(s));
        }
        if (platform) rows = rows.filter(k => k.platform === platform);
        if (category) rows = rows.filter(k => k.category === category);
        rows.sort((a, b) => (Number(b.followers) || 0) - (Number(a.followers) || 0));
        return rows.slice(Number(offset), Number(offset) + Number(limit)).map(clone);
    },
    async findById(id) {
        return clone(db.kols.find(k => k.id === Number(id)) || null);
    },
    async create(fields) {
        if (fields.kol_code && db.kols.some(k => k.kol_code === fields.kol_code)) {
            throw duplicateError('มี kol_code นี้อยู่แล้ว');
        }
        const row = {
            id: nextId('kols'),
            kol_code: fields.kol_code || null, name: fields.name,
            username: fields.username || null, platform: fields.platform || null,
            avatar: fields.avatar || null, followers: fields.followers || 0,
            engagement_rate: fields.engagement_rate ?? null, category: fields.category || null,
            tags: fields.tags || null, contact_info: fields.contact_info || null,
            extra_data: fields.extra_data || null, created_at: now(), updated_at: now()
        };
        db.kols.push(row); persist();
        return clone(row);
    },
    async update(id, fields) {
        const k = db.kols.find(k => k.id === Number(id));
        if (!k) return null;
        for (const key of ['kol_code', 'name', 'username', 'platform', 'avatar', 'followers',
            'engagement_rate', 'category', 'tags', 'contact_info', 'extra_data']) {
            if (fields[key] !== undefined && fields[key] !== null) k[key] = fields[key];
        }
        k.updated_at = now(); persist();
        return clone(k);
    },
    async remove(id) {
        const idx = db.kols.findIndex(k => k.id === Number(id));
        if (idx === -1) return false;
        db.kols.splice(idx, 1);
        db.project_kols = db.project_kols.filter(pk => pk.kol_id !== Number(id));
        persist();
        return true;
    },
    async count() { return db.kols.length; },

    // ดึง Influencer ที่ "ถูกใช้ในแคมเปญ" — รวมชื่อซ้ำเป็นรายเดียว + แนบแคมเปญ (ผลงาน) แต่ละอัน
    // scopeBrands = null (admin/manager เห็นทุกแบรนด์) หรือ array ชื่อแบรนด์ (member เห็นเฉพาะแบรนด์ตัวเอง)
    async usedWithCampaigns(scopeBrands = null) {
        let projs = db.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));

        const byKol = {};
        db.project_kols
            .filter(pk => projIds.has(pk.project_id))
            .forEach(pk => {
                if (!byKol[pk.kol_id]) byKol[pk.kol_id] = [];
                const p = projById[pk.project_id];
                const team = db.teams.find(t => t.id === p.team_id);
                byKol[pk.kol_id].push({
                    project_id: p.id, project_name: p.name, brand: p.brand,
                    team_name: team ? team.name : null, status: pk.status,
                    fee: pk.fee, views: pk.views, link_id: pk.id
                });
            });

        return Object.entries(byKol).map(([kolId, usages]) => {
            const k = db.kols.find(x => x.id === Number(kolId)) || { id: Number(kolId) };
            return clone({ ...k, usages, campaign_count: usages.length });
        }).sort((a, b) => (Number(b.followers) || 0) - (Number(a.followers) || 0));
    },

    // รายละเอียด Influencer 1 คน + ประวัติการใช้งานในแคมเปญ (งบ/วิว/ลิงก์ผลงาน/วันที่ลงงาน)
    async detailWithUsages(kolId, scopeBrands = null) {
        const k = db.kols.find(x => x.id === Number(kolId));
        if (!k) return null;
        let projs = db.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));

        const usages = db.project_kols
            .filter(pk => pk.kol_id === Number(kolId) && projIds.has(pk.project_id))
            .map(pk => {
                const p = projById[pk.project_id];
                const team = db.teams.find(t => t.id === p.team_id);
                return {
                    link_id: pk.id, project_id: p.id, project_name: p.name, brand: p.brand,
                    team_name: team ? team.name : null, fee: pk.fee, views: pk.views,
                    likes: pk.likes || 0, comments: pk.comments || 0, shares: pk.shares || 0,
                    post_link: pk.post_link || null, posted_date: pk.posted_date || null,
                    status: pk.status, notes: pk.notes || null
                };
            })
            .sort((a, b) => (b.posted_date || '').localeCompare(a.posted_date || ''));

        return clone({ ...k, usages });
    },

    // จำนวน KOL แยกตามแพลตฟอร์ม (สำหรับกราฟเล็ก)
    async platformCounts() {
        const map = {};
        db.kols.forEach(k => { const p = k.platform || 'อื่นๆ'; map[p] = (map[p] || 0) + 1; });
        return Object.entries(map).map(([label, value]) => ({ label, value }));
    },

    // KOL Analytics — รวม KOL ที่คัดเลือกแล้วจากทุกแคมเปญ (ตามสิทธิ์ทีม)
    async analytics(scopeBrands = null) {
        const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let projs = db.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));
        const today = new Date();

        const rows = db.submissions
            .filter(s => s.status === 'confirmed' && projIds.has(s.project_id))
            .map(s => {
                const p = projById[s.project_id];
                const refDate = s.post_date || s.gen_date || (p ? p.start_date : null);
                let month = null, year = null;
                if (refDate) { const [y, m] = refDate.split('-').map(Number); month = MONTHS_EN[m - 1]; year = y; }
                const days = Number(s.code_expire) || 0;
                // วันที่เริ่ม Gen = วันยิงแอด (ad_end จากหน้า Ads) ถ้ามี, ถ้ายังไม่ยิงค่อยใช้ค่าที่กรอกเอง
                const genStart = s.ad_end || s.gen_date || null;
                // Day Left = จำนวนวัน Gencode ที่เหลือ = (วันที่ลงงาน + Days) − วันนี้ (นับจากวันที่ลงงาน)
                let day_left = null;
                if (s.post_date && days) {
                    const expire = new Date(s.post_date + 'T00:00:00').getTime() + days * 86400000;
                    day_left = Math.ceil((expire - today.getTime()) / 86400000);
                }
                // ผลงานคอนเทนต์ + เกณฑ์ผ่าน/ไม่ผ่าน (ต้นทุน = ค่าตัว + ค่ายิงแอด)
                const views = Number(s.views) || 0;
                const likes = Number(s.likes) || 0, comments = Number(s.comments) || 0;
                const saves = Number(s.saves) || 0, shares = Number(s.shares) || 0;
                const reposts = Number(s.reposts) || 0;   // IG เท่านั้น อันอื่นเป็น 0 อยู่แล้ว
                const engagement = likes + comments + saves + shares + reposts;
                const totalCost = (Number(s.budget) || 0) + (Number(s.ad_spend) || 0);
                const cpm = views > 0 ? Number((totalCost / (views / 1000)).toFixed(2)) : 0;
                const cpe = engagement > 0 ? Number((totalCost / engagement).toFixed(2)) : 0;
                const er = views > 0 ? Number(((engagement / views) * 100).toFixed(2)) : 0;
                const spendNow = Number(s.ad_spend) || 0;
                const perf = {
                    views, likes, comments, saves, shares, reposts, engagement, er,
                    ad_spend: spendNow, total_cost: totalCost, cpm, cpe,
                    performance: views > 0
                        ? ((cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Good' : 'Improve')
                        : null,  // ยังไม่กรอกผลงาน = ยังตัดสินไม่ได้
                    // ผลที่ล็อกไว้ตอนค่าแอดถึงเกณฑ์ (ถ้ายังไม่ถึงจะเป็น null)
                    perf_stamp: s.perf_stamp ? clone(s.perf_stamp) : null,
                    // ถึงเกณฑ์แล้วแต่ยังไม่มีผลงานให้ตัดสิน — รอสแตมป์อยู่
                    stamp_waiting: !s.perf_stamp && spendNow >= AD_STAMP_AT && views <= 0
                };
                return {
                    sub_id: s.id, project_id: s.project_id, project_name: p ? p.name : null,
                    brand: p ? (p.brand || null) : null, month, year,
                    product: s.product || null, kol_name: s.account_name, link_account: s.link_account || null,
                    concept: s.concept || null, platform: s.platform || null,
                    owner: p ? (p.owner || null) : null, agency: s.agency || null,
                    cost: Number(s.budget) || 0,
                    ...perf,
                    post_date: s.post_date || null, gen_date: genStart, days, day_left,
                    post_url: s.post_url || null, gencode: s.gencode || null, id_post: s.id_post || null
                };
            })
            .sort((a, b) => (b.post_date || '').localeCompare(a.post_date || ''));

        const budget = rows.reduce((a, r) => a + r.cost, 0);
        // ER เฉลี่ยนับเฉพาะคนที่กรอกผลงานแล้ว ไม่งั้นคนที่ยังไม่กรอกจะดึงค่าเฉลี่ยลง
        const measured = rows.filter(r => r.views > 0);
        const avg_engagement = measured.length
            ? Number((measured.reduce((a, r) => a + r.er, 0) / measured.length).toFixed(2))
            : 0;
        return clone({ summary: { total_kols: rows.length, budget, avg_engagement }, rows });
    }
};

// ============================ projects ============================
function enrichProject(p) {
    const team = db.teams.find(t => t.id === p.team_id);
    const creator = db.users.find(u => u.id === p.created_by);
    const editor = db.users.find(u => u.id === p.updated_by);
    const kol_count = db.project_kols.filter(pk => pk.project_id === p.id).length;
    const subs = db.submissions.filter(s => s.project_id === p.id);
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

// id ของไฟล์ report — สั้นแต่เดาไม่ได้ ใช้อ้างอิงตอนเปิด/ลบ
const genReportId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Platform ของกลุ่ม — รองรับทั้ง platforms[] แบบใหม่ และ platform เดี่ยว/ที่ติดอยู่กับ allocation แบบเดิม
function linkGroupPlatforms(g) {
    const set = new Set();
    (g.platforms || []).forEach(p => { if (p) set.add(p); });
    if (g.platform) set.add(g.platform);
    (g.allocations || []).forEach(a => { if (a.platform) set.add(a.platform); });
    return [...set];
}
const projects = {
    // scopeBrands = null (เห็นทุกแบรนด์) หรือ array ชื่อแบรนด์
    async list(scopeBrands = null) {
        let rows = db.projects.slice();
        rows = scopeProjects(rows, scopeBrands);
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return rows.map(p => clone(enrichProject(p)));
    },
    async findTeamId(id) {
        const p = db.projects.find(p => p.id === Number(id));
        return p ? p.team_id : undefined;
    },
    async findByIdFull(id) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const enriched = enrichProject(p);
        const kolsInProject = db.project_kols
            .filter(pk => pk.project_id === p.id)
            .sort((a, b) => (a.added_at || '').localeCompare(b.added_at || ''))
            .map(pk => {
                const kol = db.kols.find(k => k.id === pk.kol_id) || {};
                return { link_id: pk.id, fee: pk.fee, status: pk.status, notes: pk.notes, added_at: pk.added_at, ...kol };
            });
        return clone({ ...enriched, kols: kolsInProject });
    },
    async create(fields) {
        const row = {
            id: nextId('projects'),
            team_id: fields.team_id, created_by: fields.created_by,
            name: fields.name, brand: fields.brand || null,
            objective: fields.objective || null,
            product: fields.product || null,
            products: Array.isArray(fields.products) ? fields.products : [],
            ad_groups: Array.isArray(fields.ad_groups) ? fields.ad_groups : [],
            owner: fields.owner || null,
            creator: fields.creator || null,   // ชื่อคนสร้างโปรเจค (ทีมใช้บัญชีร่วมกัน created_by จึงบอกไม่ได้ว่าใคร)
            brief_link: fields.brief_link || null,
            brief_file: fields.brief_file || null,
            product_briefs: fields.product_briefs || {},   // บรีฟต่อสินค้า { code: { link, file } }
            platform_briefs: fields.platform_briefs || {}, // บรีฟหลักต่อ Platform { platform: { link, file } }
            platform_budgets: fields.platform_budgets || {}, // งบต่อ Platform { platform: number }
            kol_target: fields.kol_target || 0,
            budget: fields.budget || 0, start_date: fields.start_date || null,
            end_date: fields.end_date || null, status: fields.status || 'Draft',
            description: fields.description || null, created_at: now(), updated_at: now()
        };
        db.projects.push(row); persist();
        return clone(row);
    },
    async update(id, fields) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        for (const key of ['name', 'brand', 'objective', 'product', 'products', 'ad_groups', 'owner', 'creator', 'brief_link', 'product_briefs', 'platform_briefs', 'platform_budgets', 'kol_target', 'budget', 'start_date', 'end_date', 'status', 'description', 'updated_by']) {
            // null = ผู้ใช้ล้างค่าออกจริง ๆ (route ส่งเฉพาะคีย์ที่ client ส่งมา คีย์ที่ไม่ได้แก้จะเป็น undefined)
            if (fields[key] !== undefined) p[key] = fields[key];
        }
        p.updated_at = now(); persist();
        return clone(p);
    },
    // บันทึกไฟล์บรีฟของสินค้าหนึ่งตัว (เก็บใน product_briefs[code].file)
    async setProductBriefFile(id, code, meta) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        if (!p.product_briefs || typeof p.product_briefs !== 'object') p.product_briefs = {};
        const cur = p.product_briefs[code] || {};
        p.product_briefs[code] = { link: cur.link || null, file: meta };
        p.updated_at = now(); persist();
        return clone(p.product_briefs[code]);
    },
    // บันทึกไฟล์บรีฟหลักของ Platform หนึ่งตัว (เก็บใน platform_briefs[platform].file)
    async setPlatformBriefFile(id, platform, meta) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        if (!p.platform_briefs || typeof p.platform_briefs !== 'object') p.platform_briefs = {};
        const cur = p.platform_briefs[platform] || {};
        p.platform_briefs[platform] = { link: cur.link || null, file: meta };
        p.updated_at = now(); persist();
        return clone(p.platform_briefs[platform]);
    },
    async remove(id) {
        const idx = db.projects.findIndex(p => p.id === Number(id));
        if (idx === -1) return false;
        db.projects.splice(idx, 1);
        db.project_kols = db.project_kols.filter(pk => pk.project_id !== Number(id));
        // งวดการจ่ายกับข้อมูลการจ่ายต้องหายตามไปด้วย ไม่งั้นจะค้างเป็นงวดกำพร้าในหน้ารอบทำจ่าย
        db.installments = db.installments.filter(i => i.project_id !== Number(id));
        db.payments = db.payments.filter(x => x.project_id !== Number(id));
        // รอบทำจ่ายที่ไม่เหลืองวดอยู่เลย ก็ไม่มีความหมายแล้ว
        db.pay_batches = db.pay_batches.filter(b => db.installments.some(i => i.batch_id === b.id));
        persist();
        return true;
    },
    // ลิงก์แชร์ให้ Agency (สร้างถ้ายังไม่มี)
    async setShareToken(id, token) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        if (!p.share_token) { p.share_token = token; persist(); }
        return p.share_token;
    },
    async findByToken(token) {
        const p = db.projects.find(p => p.share_token === token);
        return p ? clone(p) : null;
    },
    // ===== ลิงก์เอเจนซี่แบบแยกต่อเจ้า (แต่ละเจ้าเห็นเฉพาะ KOL ของตัวเอง) =====
    async addAgencyLink(id, name, token, opts = {}) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        if (!Array.isArray(p.agency_links)) p.agency_links = [];
        const link = {
            token,
            name: (name && String(name).trim()) || `เอเจนซี่ ${p.agency_links.length + 1}`,
            groups: Array.isArray(opts.groups) ? opts.groups.filter(Boolean) : [],   // กลุ่มที่รับผิดชอบ (ว่าง = ใช้ Platform/สินค้ากรองแทน)
            products: Array.isArray(opts.products) ? opts.products : [],   // สินค้าที่รับผิดชอบ
            platforms: Array.isArray(opts.platforms) ? opts.platforms : [], // Platform ที่รับผิดชอบ
            kol_count: Number(opts.kol_count) || 0,                         // จำนวน KOL ที่ต้องส่ง
            created_at: now()
        };
        p.agency_links.push(link);
        persist();
        return clone(link);
    },
    // รวมห้องแชททุกแคมเปญที่ทีมนี้มองเห็น — ใช้ทำรายการห้องในกล่องแชทลอย
    // scopeBrands = null คือเห็นทุกแบรนด์
    async listTeamChats(scopeBrands) {
        const out = [];
        for (const p of db.projects) {
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
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link) return null;
        if (!Array.isArray(link.messages)) link.messages = [];
        const row = { id: genReportId(), at: now(), ...msg };
        link.messages.push(row);
        persist();
        return clone(row);
    },
    // หาข้อความ 1 อัน พร้อมลิงก์ที่มันสังกัด (ใช้ร่วมกันตอนแก้/ลบ)
    _findMessage(id, token, msgId) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link) return null;
        const m = (link.messages || []).find(x => x.id === msgId);
        return m ? { link, m } : null;
    },

    // แก้ข้อความ — ได้เฉพาะข้อความของฝั่งตัวเอง และที่ยังไม่ถูกลบ
    async editAgencyMessage(id, token, msgId, side, text) {
        const found = this._findMessage(id, token, msgId);
        if (!found) return { error: 404 };
        const { m } = found;
        if (m.from !== side) return { error: 403 };
        if (m.deleted_at) return { error: 410 };
        m.text = text;
        m.edited_at = now();
        persist();
        return { data: clone(m) };
    },

    // ลบข้อความ — เก็บร่องรอยไว้ว่าเคยมีข้อความตรงนี้ แต่เนื้อหาและรูปหายไป
    // (ทำแบบเดียวกับไลน์ เพราะแชทนี้ใช้อ้างอิงตอนตกลงงานกัน ลบหายทั้งดุ้นจะดูย้อนไม่ได้ว่าเคยคุยอะไร)
    async deleteAgencyMessage(id, token, msgId, side) {
        const found = this._findMessage(id, token, msgId);
        if (!found) return { error: 404 };
        const { m } = found;
        if (m.from !== side) return { error: 403 };
        const files = [m.image, m.thumb].filter(Boolean).map(f => f.filename);
        m.text = '';
        m.image = null;
        m.thumb = null;
        m.deleted_at = now();
        persist();
        return { data: clone(m), files };   // ผู้เรียกเอา files ไปลบไฟล์จริงต่อ
    },
    async listAgencyMessages(id, token) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link) return null;
        return {
            messages: clone(link.messages || []),
            team_read_at: link.team_read_at || null,
            agency_read_at: link.agency_read_at || null
        };
    },
    // จำว่าอ่านถึงเมื่อไหร่ ใช้คิดจำนวนที่ยังไม่ได้อ่านของอีกฝั่ง
    async markAgencyRead(id, token, side) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link) return null;
        link[side === 'team' ? 'team_read_at' : 'agency_read_at'] = now();
        persist();
        return true;
    },
    // ไฟล์รูปในข้อความ — หาโดยไม่ต้องรู้ว่าอยู่ข้อความไหน
    // which = 'image' (รูปเต็ม) หรือ 'thumb' (รูปย่อที่ใช้โชว์ในแชท)
    // ข้อความเก่าไม่มี thumb ให้ถอยไปใช้รูปเต็มแทน
    async getAgencyMessageImage(id, token, msgId, which = 'image') {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        const m = link && (link.messages || []).find(x => x.id === msgId);
        if (!m) return null;
        const pick = which === 'thumb' ? (m.thumb || m.image) : m.image;
        return pick ? clone(pick) : null;
    },
    // ---------- ไฟล์/ลิงก์ Report ที่เอเจนซี่ส่งเข้ามา (เก็บผูกกับลิงก์ของแต่ละเจ้า) ----------
    // meta = { kind: "file"|"link", original, filename?, size?, url?, note?, uploaded_at }
    async addAgencyReport(id, token, meta) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link) return null;
        if (!Array.isArray(link.reports)) link.reports = [];
        const row = { id: genReportId(), uploaded_at: now(), ...meta };
        link.reports.push(row);
        persist();
        return clone(row);
    },
    async listAgencyReports(id, token) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return [];
        const link = (p.agency_links || []).find(l => l.token === token);
        return link && Array.isArray(link.reports) ? link.reports.map(clone) : [];
    },
    async getAgencyReport(id, token, reportId) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        const r = link && (link.reports || []).find(x => x.id === reportId);
        return r ? clone(r) : null;
    },
    async removeAgencyReport(id, token, reportId) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        const link = (p.agency_links || []).find(l => l.token === token);
        if (!link || !Array.isArray(link.reports)) return null;
        const i = link.reports.findIndex(x => x.id === reportId);
        if (i < 0) return null;
        const [gone] = link.reports.splice(i, 1);
        persist();
        return clone(gone);
    },
    async listAgencyLinks(id) {
        const p = db.projects.find(p => p.id === Number(id));
        return p && Array.isArray(p.agency_links) ? p.agency_links.map(clone) : [];
    },
    // แก้ขอบเขตงานของลิงก์ (ชื่อ/สินค้า/Platform/จำนวน KOL) — token เดิมไม่เปลี่ยน ลิงก์ที่ส่งไปแล้วยังใช้ได้
    async updateAgencyLink(id, token, fields) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p || !Array.isArray(p.agency_links)) return null;
        const link = p.agency_links.find(l => l.token === token);
        if (!link) return null;
        if (fields.name !== undefined && String(fields.name).trim()) link.name = String(fields.name).trim();
        if (Array.isArray(fields.groups)) link.groups = fields.groups.filter(Boolean);
        if (Array.isArray(fields.products)) link.products = fields.products.filter(Boolean);
        if (Array.isArray(fields.platforms)) link.platforms = fields.platforms.filter(Boolean);
        if (fields.kol_count !== undefined) link.kol_count = Number(fields.kol_count) || 0;
        link.updated_at = now();
        persist();
        return clone(link);
    },
    async removeAgencyLink(id, token) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p || !Array.isArray(p.agency_links)) return false;
        const before = p.agency_links.length;
        p.agency_links = p.agency_links.filter(l => l.token !== token);
        persist();
        return p.agency_links.length < before;
    },
    // resolve token → { project, link }; link.scoped=true = ลิงก์แยกต่อเจ้า (กรองเฉพาะของตัวเอง)
    async resolveToken(token) {
        for (const p of db.projects) {
            if (Array.isArray(p.agency_links)) {
                const link = p.agency_links.find(l => l.token === token);
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
        const p = db.projects.find(p => p.share_token === token);   // ลิงก์รวมเดิม → เห็นทั้งหมด (backward compat)
        if (p) return { project: clone(p), link: { token, name: null, products: [], platforms: [], kol_count: 0, reports: [], scoped: false } };
        return null;
    },
    // บันทึกไฟล์บรีฟ
    async setBriefFile(id, meta) {
        const p = db.projects.find(p => p.id === Number(id));
        if (!p) return null;
        p.brief_file = meta;
        p.updated_at = now();
        persist();
        return clone(p);
    },
    async count(scopeBrands = null) {
        return scopeProjects(db.projects, scopeBrands).length;
    },
    // จำนวน Project แยกตามสถานะ (สำหรับกราฟเล็ก)
    async statusCounts(scopeBrands = null) {
        let rows = db.projects;
        rows = scopeProjects(rows, scopeBrands);
        const order = ['Draft', 'Active', 'Completed', 'Cancelled'];
        const map = {};
        rows.forEach(p => { map[p.status] = (map[p.status] || 0) + 1; });
        return order.map(s => ({ label: s, value: map[s] || 0 }));
    }
};

// ============================ project_kols ============================
const projectKols = {
    async add({ project_id, kol_id, fee, views, likes, comments, shares, post_link, posted_date, status, notes }) {
        const exists = db.project_kols.some(pk => pk.project_id === Number(project_id) && pk.kol_id === Number(kol_id));
        if (exists) throw duplicateError('KOL นี้อยู่ใน Project แล้ว');
        const row = {
            id: nextId('project_kols'), project_id: Number(project_id), kol_id: Number(kol_id),
            fee: fee || 0, views: views || 0, likes: likes || 0, comments: comments || 0, shares: shares || 0,
            post_link: post_link || null, posted_date: posted_date || null,
            status: status || 'Pending', notes: notes || null, added_at: now()
        };
        db.project_kols.push(row); persist();
        return clone(row);
    },
    // แก้ข้อมูลการใช้งาน KOL ในแคมเปญ (งบ/วิว/engagement/ลิงก์ผลงาน/วันที่ลงงาน/สถานะ)
    async update(linkId, projectId, fields) {
        const pk = db.project_kols.find(x => x.id === Number(linkId) && x.project_id === Number(projectId));
        if (!pk) return null;
        for (const key of ['fee', 'views', 'likes', 'comments', 'shares', 'post_link', 'posted_date', 'status', 'notes']) {
            if (fields[key] !== undefined) pk[key] = fields[key];
        }
        persist();
        return clone(pk);
    },
    async remove(linkId, projectId) {
        const idx = db.project_kols.findIndex(pk => pk.id === Number(linkId) && pk.project_id === Number(projectId));
        if (idx === -1) return false;
        db.project_kols.splice(idx, 1); persist();
        return true;
    }
};

// ============================ misc ============================
// จำนวนสมาชิกแต่ละทีม (สำหรับกราฟเล็ก)
teams.memberCounts = async function () {
    return db.teams.map(t => ({
        label: t.name,
        value: db.users.filter(u => u.team_id === t.id).length
    }));
};

// ============================ dashboard (สรุปตามตัวกรอง) ============================
const dashboard = {
    // filters: { scopeBrands, brand, from, to, projectId }
    async overview(filters = {}) {
        const { scopeBrands = null, brand, from, to, projectId } = filters;

        // 1) คัดกรอง projects ตามสิทธิ์ + ตัวกรอง (แบรนด์/แคมเปญ) — ไม่กรองด้วยวันที่ตรงนี้ (ไปกรองที่ตัว KOL แทน)
        let projects = db.projects.slice();
        projects = scopeProjects(projects, scopeBrands);
        if (brand) projects = projects.filter(p => p.brand === brand);
        if (projectId) projects = projects.filter(p => p.id === Number(projectId));

        const projectIds = new Set(projects.map(p => p.id));
        const projById = {}; projects.forEach(p => { projById[p.id] = p; });

        // 2) KOL ที่คัดเลือกแล้ว (จาก submissions = ข้อมูลจริงที่เอเจนซี่ส่ง/ทีมคัดเลือก)
        //    ช่วงเวลา: กรองตามวันลงงาน (post_date) ถ้ามี — ยังไม่ลงงาน = นับรวม (คอมมิตแล้ว)
        const inRange = s => {
            const d = s.post_date;
            if (!d) return true;
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        };
        const subs = db.submissions.filter(s => s.status === 'confirmed' && projectIds.has(s.project_id) && inRange(s));

        // 3) ตัวเลขรวม
        const totalBudget = projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);   // งบที่วางไว้รวม
        const totalFee = subs.reduce((a, s) => a + (Number(s.budget) || 0), 0);           // ค่าใช้จ่ายจริงของ KOL
        // 1 แถว = 1 คลิป — คนเดียวกันอาจมีหลายคลิป จึงนับ "คน" จาก person_key
        const totalKols = new Set(subs.map(s => s.person_key || ('sub:' + s.id))).size;
        const totalClips = subs.length;
        // งบเก็บต่อคลิป ค่าเฉลี่ยหลักจึงเป็น "ต่อคลิป" ส่วน "ต่อคน" ไว้ดูค่าตัวรวมของคนหนึ่ง
        const avgCostPerClip = totalClips > 0 ? Math.round(totalFee / totalClips) : 0;
        const avgCostPerKol = totalKols > 0 ? Math.round(totalFee / totalKols) : 0;
        const totalViews = subs.reduce((a, s) => a + (Number(s.ad_reach) || 0), 0);       // ยอดวิว = Reach จากแอด

        // 4) แยกตามแพลตฟอร์ม
        const byPlatform = {};
        subs.forEach(s => {
            const p = s.platform || 'อื่นๆ';
            if (!byPlatform[p]) byPlatform[p] = { platform: p, count: 0, people: new Set(), views: 0, feeSum: 0 };
            const b = byPlatform[p];
            b.count += 1; b.people.add(s.person_key || ('sub:' + s.id));
            b.views += Number(s.ad_reach) || 0; b.feeSum += Number(s.budget) || 0;
        });
        const platforms = Object.values(byPlatform).map(b => ({
            platform: b.platform, kols_count: b.people.size, clips_count: b.count, views: b.views,
            engagement: null, avg_cost: b.count ? Math.round(b.feeSum / b.count) : 0
        }));
        const platformSet = new Set(subs.map(s => s.platform).filter(Boolean));

        // 5) ตัวชี้วัดความคุ้มค่า
        const cpm = totalViews > 0 ? Math.round(totalFee / (totalViews / 1000)) : 0;
        const cpe = 0; // ยังไม่มีข้อมูล engagement ราย KOL จาก submissions

        // 6) Top KOLs — ส่ง 20 อันดับ (หน้าเว็บโชว์ 5 อันดับแรก ที่เหลือกดดูเพิ่มได้)
        //
        // ยอดทั้งหมดมาจาก "คอนเทนต์จริงของคลิป" (กรอกที่แท็บ On Process)
        // ไม่ใช่จากการยิงแอด — จึงวัดได้ทั้งคนที่ยิงแอดแล้วและยังไม่ยิง
        //   CPM = ค่าตัว / (ยอดวิว / 1000)      ยิ่งต่ำยิ่งคุ้ม
        //   CPE = ค่าตัว / engagement รวม        ยิ่งต่ำยิ่งคุ้ม
        // (ไม่เดา engagement เป็น % ของ reach แบบที่หน้า Report ทำอยู่ เพราะมีตัวเลขจริงแล้ว)
        //
        // เกณฑ์จัดอันดับ = คะแนนรวม 0-100 (ไล่ระดับ ไม่ใช่ผ่าน/ไม่ผ่าน)
        //   Engagement Rate 35% · Views 25% · CPM 20% · CPE 20%
        //   CPM/CPE ยิ่งต่ำยิ่งได้คะแนนมาก · เทียบกันเองในกลุ่มที่แสดงอยู่
        //   คนที่ยังไม่กรอกผลงาน (views = 0) ไม่มีคะแนน และตกไปท้ายสุด
        // หมายเหตุ: เกณฑ์ผ่าน/ไม่ผ่าน (Good/Improve) ย้ายไปอยู่หน้า Report กับ Influencer
        const SCORE_W = { er: 0.35, views: 0.25, cpm: 0.20, cpe: 0.20 };
        const kolRows = [...subs].map(s => {
            const views = Number(s.views) || 0;        // ยอดวิวคอนเทนต์
            const likes = Number(s.likes) || 0;
            const comments = Number(s.comments) || 0;
            const saves = Number(s.saves) || 0;
            const shares = Number(s.shares) || 0;
            const reposts = Number(s.reposts) || 0;
            const engagementTotal = likes + comments + saves + shares + reposts;
            const fee = Number(s.budget) || 0;
            const adSpend = Number(s.ad_spend) || 0;
            const cost = fee + adSpend;                // ต้นทุนรวม = ค่าตัว + ค่ายิงแอด
            const cpm = views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0;
            const cpe = engagementTotal > 0 ? Number((cost / engagementTotal).toFixed(2)) : 0;
            return {
                kol_id: s.id, name: s.account_name, platform: s.platform || null,
                brand: (projById[s.project_id] || {}).brand || null,   // แบรนด์มาจากแคมเปญที่ KOL คนนี้สังกัด
                product: s.product || null,
                post_url: s.post_url || null,
                fee, ad_spend: adSpend, cost,
                views,                                  // ยอดวิวคอนเทนต์ ไม่ใช่ reach จากแอด
                ad_reach: Number(s.ad_reach) || 0,      // เก็บไว้เทียบ ไม่ได้ใช้จัดอันดับ
                likes, comments, saves, shares, reposts,
                engagement_total: engagementTotal,
                engagement: views > 0 ? Number(((engagementTotal / views) * 100).toFixed(2)) : null,
                cpm, cpe,
                measured: views > 0                     // กรอกผลงานแล้วหรือยัง
            };
        });

        // ให้คะแนนโดยเทียบกันเองเฉพาะคนที่มีข้อมูลแล้ว
        const scored = kolRows.filter(k => k.measured);
        const spread = (arr, pick) => {
            const v = arr.map(pick);
            return { min: Math.min(...v), max: Math.max(...v) };
        };
        const norm = (val, r, lowerIsBetter) => {
            if (r.max === r.min) return 1;              // ทุกคนเท่ากัน ตัวนี้ไม่ช่วยตัดสิน
            const t = (val - r.min) / (r.max - r.min);
            return lowerIsBetter ? 1 - t : t;
        };
        if (scored.length) {
            const rEr = spread(scored, k => k.engagement || 0);
            const rVw = spread(scored, k => k.views);
            const rCpm = spread(scored, k => k.cpm);
            const withEng = scored.filter(k => k.engagement_total > 0);
            const rCpe = withEng.length ? spread(withEng, k => k.cpe) : { min: 0, max: 0 };
            // บอกว่าค่านี้ดีสุด/แย่สุดในกลุ่มไหม (ไว้อธิบายที่มาของคะแนน)
            const edge = (val, r, lowerIsBetter) => {
                if (r.max === r.min) return 'เท่ากันทั้งกลุ่ม';
                if (val === (lowerIsBetter ? r.min : r.max)) return 'ดีที่สุดในกลุ่ม';
                if (val === (lowerIsBetter ? r.max : r.min)) return 'แย่ที่สุดในกลุ่ม';
                return null;
            };
            kolRows.forEach(k => {
                if (!k.measured) { k.score = null; k.score_parts = null; return; }
                // ไม่มี engagement เลย = แย่สุดของแกน CPE (ไม่ใช่ดีสุด แม้ตัวเลข cpe จะเป็น 0)
                const nEr = norm(k.engagement || 0, rEr);
                const nVw = norm(k.views, rVw);
                const nCpm = norm(k.cpm, rCpm, true);
                const nCpe = k.engagement_total > 0 ? norm(k.cpe, rCpe, true) : 0;
                const pct = w => Math.round(w * 100);
                k.score_parts = [
                    { key: 'er', label: 'Engagement Rate', value: k.engagement || 0, unit: '%', weight: pct(SCORE_W.er), earned: Number((SCORE_W.er * nEr * 100).toFixed(1)), better: 'สูง', note: edge(k.engagement || 0, rEr, false) },
                    { key: 'views', label: 'ยอดวิว', value: k.views, unit: '', weight: pct(SCORE_W.views), earned: Number((SCORE_W.views * nVw * 100).toFixed(1)), better: 'สูง', note: edge(k.views, rVw, false) },
                    { key: 'cpm', label: 'CPM', value: k.cpm, unit: '฿', weight: pct(SCORE_W.cpm), earned: Number((SCORE_W.cpm * nCpm * 100).toFixed(1)), better: 'ต่ำ', note: edge(k.cpm, rCpm, true) },
                    { key: 'cpe', label: 'CPE', value: k.cpe, unit: '฿', weight: pct(SCORE_W.cpe), earned: Number((SCORE_W.cpe * nCpe * 100).toFixed(1)), better: 'ต่ำ', note: k.engagement_total > 0 ? edge(k.cpe, rCpe, true) : 'ยังไม่มี engagement' }
                ];
                k.score = Number(k.score_parts.reduce((a, p) => a + p.earned, 0).toFixed(1));
            });
        } else {
            kolRows.forEach(k => { k.score = null; k.score_parts = null; });
        }

        const topKols = kolRows
            .sort((a, b) =>
                (b.measured - a.measured) ||            // คนที่กรอกผลงานแล้วขึ้นก่อน
                ((b.score || 0) - (a.score || 0)) ||    // คะแนนรวมสูงกว่า
                (b.views - a.views)                     // ตัดเสมอด้วยยอดวิว
            )
            .slice(0, 20);
        // อันดับในกลุ่มที่เอามาเทียบคะแนนกัน (ใช้บอกในหน้าอธิบายคะแนน)
        let rank = 0;
        topKols.forEach(k => { k.score_rank = k.measured ? ++rank : null; });
        topKols.forEach(k => { k.score_pool = scored.length; });

        // 7) สรุปตามแบรนด์ (งบที่วางไว้ + จำนวน KOL ที่คัดเลือก)
        const brandMap = {};
        projects.forEach(p => {
            const b = p.brand || 'อื่นๆ';
            if (!brandMap[b]) brandMap[b] = { brand: b, budget: 0, projectIds: new Set() };
            brandMap[b].budget += Number(p.budget) || 0;
            brandMap[b].projectIds.add(p.id);
        });
        const brandSummary = Object.values(brandMap).map(b => ({
            brand: b.brand, budget: b.budget,
            kols_count: new Set(subs.filter(s => b.projectIds.has(s.project_id)).map(s => s.person_key || ('sub:' + s.id))).size
        })).sort((a, b) => b.budget - a.budget);

        // 8) รายการ campaign (project) สำหรับ dropdown — ตามสิทธิ์ (ไม่ผูกกับตัวกรองอื่น)
        let campaignScope = db.projects.slice();
        campaignScope = scopeProjects(campaignScope, scopeBrands);
        const campaigns = campaignScope
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => ({ id: p.id, name: p.name, brand: p.brand }));

        return {
            total_kols: totalKols,
            total_clips: totalClips,
            total_campaigns: projects.length,   // จำนวนแคมเปญที่เอางบมารวมกัน
            total_budget: totalBudget,
            total_spent: totalFee,
            total_views: totalViews,
            avg_cost_per_kol: avgCostPerKol,
            avg_cost_per_clip: avgCostPerClip,
            cpm, cpe,
            platform_count: platformSet.size,
            platform_list: [...platformSet],
            platforms,
            top_kols: topKols,
            brand_summary: brandSummary,
            campaigns
        };
    }
};

// ============================ payments (รอบทำจ่ายเอเจนซี่ — admin เท่านั้น) ============================
function findPayment(projectId) {
    return db.payments.find(p => p.project_id === Number(projectId));
}
function ensurePayment(projectId) {
    let pay = findPayment(projectId);
    if (!pay) {
        pay = {
            project_id: Number(projectId), agency_name: null, payment_date: null,
            status: 'รอทำจ่าย', quotation: null, invoice: null, notes: null, updated_at: now()
        };
        db.payments.push(pay);
    }
    return pay;
}

const payments = {
    // รวมทุก Project + ข้อมูลการจ่าย (admin เห็นทุกทีม)
    async listWithProjects() {
        return db.projects
            .slice()
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => {
                const team = db.teams.find(t => t.id === p.team_id);
                const pay = findPayment(p.id) || {};
                // สรุปงวดของแคมเปญนี้ — สถานะการจ่ายมาจากงวด ไม่ได้ตั้งมือแล้ว
                const its = db.installments.filter(i => i.project_id === p.id);
                const paidAmt = its.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.amount) || 0), 0);
                const planAmt = its.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                return clone({
                    project_id: p.id,
                    project_name: p.name,
                    brand: p.brand,
                    budget: p.budget,
                    team_name: team ? team.name : null,
                    agency_name: pay.agency_name || null,
                    payment_date: pay.payment_date || null,
                    status: pay.status || 'รอทำจ่าย',
                    quotation: pay.quotation || null,
                    invoice: pay.invoice || null,
                    notes: pay.notes || null,
                    quotation_link: pay.quotation_link || null,
                    agencies: projectAgencies(p),          // เอเจนซี่ของแคมเปญนี้ (จากบัญชีที่ผูกกับลิงก์)
                    // กลุ่มในแคมเปญ + งบของกลุ่ม + เจ้าที่รับผิดชอบ (ไว้ตั้งแผนจ่ายแยกกลุ่ม)
                    ad_groups: (p.ad_groups || []).map(g => ({
                        key: g.key, concept: g.concept || null, budget: Number(g.budget) || 0,
                        agencies: projectAgencies(p, g.key)
                    })),
                    installments: its.map(decorateInstallment),
                    planned_amount: planAmt,
                    paid_amount: paidAmt,
                    updated_at: pay.updated_at || null
                });
            });
    },
    async get(projectId) {
        return clone(findPayment(projectId) || null);
    },
    // แก้ข้อมูลข้อความ (ชื่อเอเจนซี่ / รอบวันจ่าย / สถานะ / โน้ต)
    async update(projectId, fields) {
        if (!db.projects.some(p => p.id === Number(projectId))) return null;
        const pay = ensurePayment(projectId);
        for (const key of ['agency_name', 'payment_date', 'status', 'notes', 'quotation_link']) {
            if (fields[key] !== undefined) pay[key] = fields[key];
        }
        pay.updated_at = now();
        persist();
        return clone(pay);
    },
    // บันทึกไฟล์ (type = 'quotation' | 'invoice')
    async setFile(projectId, type, meta) {
        if (!db.projects.some(p => p.id === Number(projectId))) return null;
        const pay = ensurePayment(projectId);
        pay[type] = meta; // { filename, original, size, uploaded_at }
        pay.updated_at = now();
        persist();
        return clone(pay);
    }
};

// ============================ budget (งบที่ใช้ไป + CPM/CPE) ============================
const cpmOf = (spent, views) => (views > 0 ? Math.round(spent / (views / 1000)) : 0);
const cpeOf = (spent, eng) => (eng > 0 ? Math.round(spent / eng) : 0);

// รวม fee/views/engagement ต่อ project (ใช้ร่วมกัน)
function spendMaps() {
    const fee = {}, views = {}, eng = {};
    db.project_kols.forEach(pk => {
        const k = db.kols.find(x => x.id === pk.kol_id);
        fee[pk.project_id] = (fee[pk.project_id] || 0) + (Number(pk.fee) || 0);
        const v = Number(pk.views) || 0;
        views[pk.project_id] = (views[pk.project_id] || 0) + v;
        eng[pk.project_id] = (eng[pk.project_id] || 0) + v * ((Number(k?.engagement_rate) || 0) / 100);
    });
    return { fee, views, eng };
}

const budget = {
    async overview({ scopeBrands = null, brand, from, to } = {}) {
        let projs = db.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);
        if (from) projs = projs.filter(p => !p.start_date || p.start_date >= from);
        if (to) projs = projs.filter(p => !p.start_date || p.start_date <= to);

        const { fee, views, eng } = spendMaps();

        const rows = projs.map(p => {
            const team = db.teams.find(t => t.id === p.team_id);
            const spent = fee[p.id] || 0, v = views[p.id] || 0, e = eng[p.id] || 0;
            return {
                project_id: p.id, name: p.name, brand: p.brand || 'อื่นๆ',
                team_name: team ? team.name : null, status: p.status, start_date: p.start_date,
                spent, views: v, cpm: cpmOf(spent, v), cpe: cpeOf(spent, e)
            };
        });

        const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
        const totalViews = rows.reduce((s, r) => s + r.views, 0);
        const totalEng = projs.reduce((s, p) => s + (eng[p.id] || 0), 0);

        // สรุปตามแบรนด์
        const bm = {};
        projs.forEach(p => {
            const b = p.brand || 'อื่นๆ';
            if (!bm[b]) bm[b] = { brand: b, spent: 0, views: 0, eng: 0, projects: 0 };
            bm[b].spent += fee[p.id] || 0;
            bm[b].views += views[p.id] || 0;
            bm[b].eng += eng[p.id] || 0;
            bm[b].projects += 1;
        });
        const byBrand = Object.values(bm).map(b => ({
            brand: b.brand, projects: b.projects, spent: b.spent, views: b.views,
            cpm: cpmOf(b.spent, b.views), cpe: cpeOf(b.spent, b.eng)
        })).sort((a, b) => b.spent - a.spent);

        return {
            total_spent: totalSpent,
            total_views: totalViews,
            cpm: cpmOf(totalSpent, totalViews),
            cpe: cpeOf(totalSpent, totalEng),
            by_brand: byBrand,
            by_project: rows.sort((a, b) => b.spent - a.spent)
        };
    },

    // เทรนด์รายเดือน (ใช้ไป + CPM/CPE ต่อเดือน)
    async trend({ scopeBrands = null, brand, year } = {}) {
        let projs = db.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);

        const { fee, views, eng } = spendMaps();
        const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, spent: 0, views: 0, eng: 0 }));
        projs.forEach(p => {
            if (!p.start_date) return;
            const [y, m] = p.start_date.split('-').map(Number);
            if (String(y) !== String(year)) return;
            months[m - 1].spent += fee[p.id] || 0;
            months[m - 1].views += views[p.id] || 0;
            months[m - 1].eng += eng[p.id] || 0;
        });
        return months.map(m => ({
            month: m.month, spent: m.spent, views: m.views,
            cpm: cpmOf(m.spent, m.views), cpe: cpeOf(m.spent, m.eng)
        }));
    }
};

// ============================ activity (บันทึกประวัติใครทำอะไร) ============================
const activity = {
    async log({ user_id, team_id, action, project_id, project_name, summary }) {
        const u = db.users.find(x => x.id === Number(user_id));
        const row = {
            id: nextId('activity_logs'),
            user_id: Number(user_id) || null,
            user_name: u ? (u.full_name || u.username) : 'ไม่ทราบ',
            team_id: team_id ?? null,
            action: action || 'update',
            project_id: project_id ?? null,
            project_name: project_name ?? null,
            summary: summary || '',
            created_at: now()
        };
        db.activity_logs.push(row); persist();
        return clone(row);
    },
    async list({ scopeBrands = null, user_id, project_id, from, to, limit = 300 } = {}) {
        let rows = db.activity_logs.slice();
        rows = scopeProjects(rows, scopeBrands);
        if (user_id) rows = rows.filter(r => r.user_id === Number(user_id));
        if (project_id) rows = rows.filter(r => r.project_id === Number(project_id));
        if (from) rows = rows.filter(r => (r.created_at || '') >= from);
        if (to) rows = rows.filter(r => (r.created_at || '') <= to + 'T23:59:59');
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return rows.slice(0, limit).map(clone);
    },
    // รายชื่อผู้ใช้ที่เคยมีประวัติ (สำหรับ dropdown ฟิลเตอร์)
    async actors(scopeBrands = null) {
        let rows = db.activity_logs;
        rows = scopeProjects(rows, scopeBrands);
        const map = {};
        rows.forEach(r => { if (r.user_id) map[r.user_id] = r.user_name; });
        return Object.entries(map).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name));
    }
};

// ===== สแตมป์ Performance ตอนค่าแอดถึงเกณฑ์ =====
// ค่าแอดสะสมถึง 10,000 เมื่อไหร่ ให้เก็บภาพนิ่งของผลงาน ณ ตอนนั้นไว้ถาวร
// แก้ไม่ได้ ล้างไม่ได้ ไม่มีทางเขียนทับจาก API — เป็นหลักฐานว่าตอนถึงเกณฑ์ผลเป็นอย่างไร
const AD_STAMP_AT = 10000;

function engagementOf(s) {
    return (Number(s.likes) || 0) + (Number(s.comments) || 0) + (Number(s.saves) || 0)
        + (Number(s.shares) || 0) + (Number(s.reposts) || 0);
}

// คืนค่า stamp ถ้าเพิ่งสแตมป์รอบนี้ / null ถ้ายังไม่ถึงเงื่อนไข
function maybeStamp(s) {
    if (!s || s.perf_stamp) return null;                       // สแตมป์แล้วห้ามแตะซ้ำ
    const spend = Number(s.ad_spend) || 0;
    if (spend < AD_STAMP_AT) return null;
    const views = Number(s.views) || 0;
    // ถึงเกณฑ์แล้วแต่ยังไม่มีผลงาน -> รอไว้ก่อน ไม่งั้นจะล็อกค่าว่างค้างถาวร
    if (views <= 0) return null;
    const engagement = engagementOf(s);
    const totalCost = (Number(s.budget) || 0) + spend;
    const cpm = Number((totalCost / (views / 1000)).toFixed(2));
    const cpe = engagement > 0 ? Number((totalCost / engagement).toFixed(2)) : 0;
    s.perf_stamp = {
        at: now(),
        ad_spend: spend,
        views, engagement,
        er: Number(((engagement / views) * 100).toFixed(2)),
        total_cost: totalCost,
        cpm, cpe,
        verdict: (cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Pass' : 'Fail'
    };
    return s.perf_stamp;
}

// ============================ submissions (รายชื่อ KOL ที่ Agency ส่งเข้ามา) ============================
const submissions = {
    async listByProject(projectId) {
        return db.submissions
            .filter(s => s.project_id === Number(projectId))
            .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))
            .map(clone);
    },
    async get(subId) {
        const s = db.submissions.find(x => x.id === Number(subId));
        return s ? clone(s) : null;
    },
    async add({ project_id, account_name, followers, platform, product, budget, agency, link_account, group_key, tier, agency_token, code_expire, person_key, clip_no, clip_name }) {
        const row = {
            id: nextId('submissions'),
            project_id: Number(project_id),
            account_name, followers: followers || 0, platform: platform || null,
            product: product || null, budget: budget || 0,
            agency: agency || null, link_account: link_account || null,
            group_key: group_key || null, tier: tier || null,
            // แถวพี่น้อง = คนเดียวกัน แต่คนละคลิป (ผูกกันด้วย person_key)
            person_key, clip_no: Number(clip_no) || 1, clip_name: clip_name || null,
            agency_token: agency_token || null,   // เจ้าของ (ลิงก์เอเจนซี่ที่ส่งเข้ามา)
            status: 'submitted', // submitted | confirmed | rejected
            draft_link: null, draft_link2: null, draft_link3: null, draft_link4: null, draft_link5: null,
            gencode: null, feedback: null, feedback2: null, feedback3: null, feedback4: null, feedback5: null,
            approved: false, draft_status: null,
            post_url: null, post_date: null, id_post: null, code_expire: Number(code_expire) || 60,
            ad_status: 'ยังไม่ยิง', ad_spend: 0, ad_reach: 0, ad_start: null, ad_end: null, ad_note: null,
            team_note: null,   // หมายเหตุจากทีมถึงเอเจนซี่ (เช่น ขอย้ายไปสินค้าอื่น)
            agency_note: null, // หมายเหตุจากเอเจนซี่ถึงทีม (คนละช่องกับ team_note ต่างฝ่ายต่างเขียนของตัวเอง)
            // ผลงานคอนเทนต์ (กรอกมือ หรือดึงจาก TikTok API ภายหลัง)
            views: 0, likes: 0, comments: 0, saves: 0, shares: 0,
            reposts: 0,   // เฉพาะ Instagram (แพลตฟอร์มอื่นไม่มีช่องนี้ให้กรอก)
            content_format: null, perf_synced_at: null,
            concept: null, gen_date: null,
            submitted_at: now(), decided_at: null, decided_by: null,
            list_updated_at: now(), work_updated_at: null, draft_updated_at: null  // ใช้ทำแจ้งเตือนแท็บ + per-KOL ดราฟใหม่
        };
        db.submissions.push(row); persist();
        return clone(row);
    },
    // เพิ่ม KOL 1 คน = สร้างแถวให้ครบทุกคลิปที่กลุ่มนั้นกำหนดไว้
    // (ช่อง Gencode / โพสต์ / ยอดวิว / แอด ผูกกับคลิป จึงต้องแยกแถว)
    async addPerson(fields, clipNames = []) {
        const names = Array.isArray(clipNames) ? clipNames.filter(c => c && String(c).trim()) : [];
        const personKey = 'p' + Math.random().toString(36).slice(2, 10);
        if (names.length < 2) {
            return [await submissions.add({ ...fields, person_key: personKey, clip_no: 1, clip_name: names[0] || null })];
        }
        const out = [];
        for (let i = 0; i < names.length; i++) {
            out.push(await submissions.add({ ...fields, person_key: personKey, clip_no: i + 1, clip_name: names[i] }));
        }
        return out;
    },
    // ลบทั้งคน (ทุกคลิปของ person_key เดียวกัน)
    async removePerson(subId, projectId) {
        const target = db.submissions.find(x => x.id === Number(subId) && x.project_id === Number(projectId));
        if (!target) return null;
        const key = target.person_key;
        const gone = key
            ? db.submissions.filter(x => x.person_key === key && x.project_id === Number(projectId))
            : [target];
        const ids = new Set(gone.map(x => x.id));
        db.submissions = db.submissions.filter(x => !ids.has(x.id));
        persist();
        return { removed: gone.length, account_name: target.account_name };
    },
    // แก้ข้อมูล "ตัวคน" ให้ทุกคลิปพร้อมกัน (ชื่อ/ยอดฟอล/Platform/สินค้า/ลิงก์ช่อง/ผู้ติดต่อ)
    async updatePerson(subId, projectId, fields, byName) {
        const target = db.submissions.find(x => x.id === Number(subId) && x.project_id === Number(projectId));
        if (!target) return null;
        const sibs = target.person_key
            ? db.submissions.filter(x => x.person_key === target.person_key && x.project_id === Number(projectId))
            : [target];
        let head = null;
        for (const sib of sibs) {
            const r = await submissions.update(sib.id, projectId, fields, byName);
            if (sib.id === target.id) head = r;
        }
        return head;
    },
    // อัปเดตได้ทั้งสถานะคัดเลือก + ข้อมูลดราฟงาน
    async update(subId, projectId, fields, byName) {
        const s = db.submissions.find(x => x.id === Number(subId) && (projectId == null || x.project_id === Number(projectId)));
        if (!s) return null;
        // ช่องที่บันทึกว่าใครแก้ล่าสุดเมื่อไหร่
        // post_date อยู่ในนี้ด้วย เพราะต้องรู้ว่า "แจ้งวันลงงานเข้าระบบตอนไหน"
        // เทียบกับวันที่ลงงานจริง จะได้แยกออกว่ายิงแอดช้าเพราะเราช้า หรือเพราะเพิ่งได้รับแจ้ง
        const STAMP_F = ['post_url', 'gencode', 'id_post', 'post_date'];
        // ล็อกหลังยิงแอดเฉพาะ 3 ช่องนี้ — post_date ไม่ล็อก เผื่อแจ้งวันผิดแล้วต้องแก้ให้ตรงความจริง
        const LOCK_F = ['post_url', 'gencode', 'id_post'];
        const filled = v => !!(v !== null && v !== undefined && String(v).trim());
        const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

        // ยิงแอดไปแล้ว = ล็อกข้อมูลชุดนี้ ห้ามแก้ เพราะเป็นข้อมูลที่ใช้อ้างอิงกับแอดที่ยิงไปแล้ว
        if (s.ad_status === 'ยิงแล้ว') {
            const blocked = LOCK_F.filter(f => fields[f] !== undefined && !same(fields[f], s[f]));
            if (blocked.length) {
                const LABEL = { post_url: 'ลิงก์คลิป', gencode: 'Gencode', id_post: 'ID Post' };
                const e = new Error(`ยิงแอดไปแล้ว จึงแก้ ${blocked.map(f => LABEL[f]).join(' / ')} ไม่ได้ — ถ้าต้องแก้จริง ให้กดสถานะกลับเป็น "ยังไม่ยิง" ก่อน`);
                e.status = 409;
                throw e;
            }
        }
        // perf_stamp ห้ามเซ็ตจากภายนอกเด็ดขาด ระบบเป็นคนสแตมป์เองเท่านั้น
        delete fields.perf_stamp;
        const before = {};
        STAMP_F.forEach(f => { before[f] = s[f]; });
        for (const k of ['account_name', 'followers', 'platform', 'product', 'agency', 'budget', 'link_account', 'concept', 'gen_date', 'group_key', 'tier', 'clip_name', 'status', 'draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'gencode', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', 'approved', 'draft_status', 'post_url', 'post_date', 'id_post', 'code_expire', 'ad_status', 'ad_spend', 'ad_reach', 'ad_start', 'ad_end', 'ad_note', 'team_note', 'agency_note', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts', 'content_format', 'perf_synced_at']) {
            if (fields[k] !== undefined) s[k] = fields[k];
        }
        // บันทึกว่า "ใครแก้ล่าสุดเมื่อไหร่" ของลิงก์คลิป / Gencode / ID Post
        // ขยับทุกครั้งที่ค่าเปลี่ยนจริง (ส่งค่าเดิมมาซ้ำไม่นับ) — ล้างทิ้งเมื่อลบค่าออก
        STAMP_F.forEach(f => {
            if (fields[f] === undefined) return;
            if (same(before[f], s[f])) return;          // ค่าไม่ได้เปลี่ยน ไม่ต้องขยับเวลา
            if (filled(s[f])) {
                s[f + '_at'] = now();
                s[f + '_by'] = byName || null;
            } else {
                s[f + '_at'] = null;
                s[f + '_by'] = null;
            }
        });

        // ปรับ timestamp ตามหมวดของข้อมูลที่แก้ (ใช้ทำแจ้งเตือนแท็บ)
        const LIST_F = ['account_name', 'followers', 'platform', 'product', 'agency', 'budget', 'link_account', 'tier', 'group_key', 'status'];
        const WORK_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', 'gencode', 'post_url', 'post_date', 'id_post', 'code_expire', 'approved', 'concept', 'gen_date'];
        const DRAFT_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5'];
        const keys = Object.keys(fields).filter(k => fields[k] !== undefined); // นับเฉพาะ field ที่ส่งมาจริง
        if (keys.some(k => LIST_F.includes(k))) s.list_updated_at = now();
        if (keys.some(k => WORK_F.includes(k))) s.work_updated_at = now();
        if (keys.some(k => DRAFT_F.includes(k))) s.draft_updated_at = now();
        if (fields.status !== undefined) { s.decided_at = now(); s.decided_by = byName || s.decided_by; }
        // เช็คทุกครั้งที่ข้อมูลขยับ — ค่าแอดถึงเกณฑ์แล้วและมีผลงานให้ตัดสิน ก็สแตมป์ทันที
        // (กรอกผลงานทีหลังก็สแตมป์ตอนนั้น ไม่ต้องรอให้ค่าแอดขยับอีกรอบ)
        maybeStamp(s);
        persist();
        return clone(s);
    },
    async countPending(projectId) {
        return db.submissions.filter(s => s.project_id === Number(projectId) && s.status === 'submitted').length;
    },
    // ลบรายชื่อทั้งหมดที่ส่งเข้ามาผ่านลิงก์เอเจนซี่หนึ่ง ๆ (ใช้ตอนลบลิงก์)
    async removeByAgencyToken(token, projectId) {
        const before = db.submissions.length;
        db.submissions = db.submissions.filter(
            s => !(s.agency_token === token && s.project_id === Number(projectId)));
        const n = before - db.submissions.length;
        if (n > 0) persist();
        return n;
    },
    // ลบทิ้งถาวร — ใช้ตอนเอารายชื่อออกจากแคมเปญ (ยกเลิก/ไม่เลือก แค่เปลี่ยนสถานะ แถวยังอยู่)
    async remove(subId, projectId) {
        const idx = db.submissions.findIndex(s => s.id === Number(subId) && s.project_id === Number(projectId));
        if (idx === -1) return null;
        const [gone] = db.submissions.splice(idx, 1); persist();
        return clone(gone);
    }
};

// ============================ ads (ติดตามการยิงแอด + สรุปค่าแอด) ============================
// รับข้อมูลจากระบบยิงแอดของบริษัท — จับคู่ด้วย Gencode หรือ ID Post
// ค่าแอดไม่ถูกแสดงที่ไหนในหน้าเว็บ ใช้เป็นตัวจุดชนวนสแตมป์อย่างเดียว
const adsSync = {
    async apply(rows) {
        const out = { updated: 0, stamped: 0, not_found: [], skipped: 0 };
        for (const r of (rows || [])) {
            const key = String(r.gencode || r.id_post || r.submission_id || '').trim();
            if (!key) { out.skipped++; continue; }
            const s = db.submissions.find(x =>
                (r.submission_id && x.id === Number(r.submission_id))
                || (r.gencode && String(x.gencode || '').trim() === String(r.gencode).trim())
                || (r.id_post && String(x.id_post || '').trim() === String(r.id_post).trim()));
            if (!s) { out.not_found.push(key); continue; }
            // ค่าแอดเดินหน้าอย่างเดียว กันข้อมูลย้อนหลังมาลบยอดสะสม
            if (r.ad_spend !== undefined) {
                const next = Number(r.ad_spend) || 0;
                if (next > (Number(s.ad_spend) || 0)) s.ad_spend = next;
            }
            if (r.ad_reach !== undefined) s.ad_reach = Number(r.ad_reach) || 0;
            for (const k of ['views', 'likes', 'comments', 'saves', 'shares', 'reposts']) {
                if (r[k] !== undefined) s[k] = Number(r[k]) || 0;
            }
            s.ad_synced_at = now();
            s.updated_at = now();
            out.updated++;
            if (maybeStamp(s)) out.stamped++;
        }
        persist();
        return out;
    }
};

const adCpm = (spend, reach) => (reach > 0 ? Math.round(spend / (reach / 1000)) : 0);

const ads = {
    // หา project ของ submission (สำหรับตรวจสิทธิ์ทีม + logging)
    async subContext(subId) {
        const s = db.submissions.find(x => x.id === Number(subId));
        if (!s) return null;
        const p = db.projects.find(pr => pr.id === s.project_id) || null;
        return { submission: clone(s), project_id: s.project_id, team_id: p ? p.team_id : null, brand: p ? p.brand : null, project_name: p ? p.name : null, account_name: s.account_name };
    },

    // รายการโพสต์ที่ "มีลิงก์โพสต์แล้ว" + ข้อมูลแอด พร้อมสรุปภาพรวม
    // filters: { scopeBrands, brand, status, from, to }
    async list({ scopeBrands = null, brand, status, from, to } = {}) {
        const projById = {};
        db.projects.forEach(p => { projById[p.id] = p; });

        let rows = db.submissions
            .filter(s => s.post_url && String(s.post_url).trim())     // เฉพาะโพสต์ที่มีลิงก์แล้ว
            .map(s => {
                const p = projById[s.project_id];
                const team = p ? db.teams.find(t => t.id === p.team_id) : null;
                const spend = Number(s.ad_spend) || 0;
                const reach = Number(s.ad_reach) || 0;
                // กลุ่มโฆษณาที่ KOL คนนี้สังกัด (ผูก Target/Content Type จาก Project อัตโนมัติ)
                const grp = (p && Array.isArray(p.ad_groups)) ? p.ad_groups.find(g => g.key === s.group_key) : null;
                return {
                    sub_id: s.id,
                    account_name: s.account_name,
                    platform: s.platform || null,
                    product: s.product || (grp && grp.products && grp.products.length ? grp.products.join(', ') : null),
                    target: grp ? (grp.target || null) : null,
                    content_type: grp ? (grp.content_type || null) : null,
                    media_type: grp ? (grp.media_type || null) : null,
                    group_format: grp ? (grp.content_format || null) : null,
                    gencode: s.gencode || null,
                    id_post: s.id_post || null,
                    post_url: s.post_url,
                    post_date: s.post_date || null,
                    // ใครแก้ล่าสุดเมื่อไหร่ (ว่าง = ข้อมูลเก่าก่อนมีฟีเจอร์นี้)
                    post_url_at: s.post_url_at || null, post_url_by: s.post_url_by || null,
                    gencode_at: s.gencode_at || null, gencode_by: s.gencode_by || null,
                    id_post_at: s.id_post_at || null, id_post_by: s.id_post_by || null,
                    post_date_at: s.post_date_at || null, post_date_by: s.post_date_by || null,
                    project_id: s.project_id,
                    project_name: p ? p.name : null,
                    brand: p ? (p.brand || 'อื่นๆ') : 'อื่นๆ',
                    team_id: p ? p.team_id : null,
                    team_name: team ? team.name : null,
                    ad_status: s.ad_status || 'ยังไม่ยิง',
                    ad_spend: spend,
                    ad_reach: reach,
                    ad_start: s.ad_start || null,
                    ad_end: s.ad_end || null,
                    ad_note: s.ad_note || null,
                    cpm: adCpm(spend, reach)
                };
            });

        rows = scopeProjects(rows, scopeBrands);
        if (brand) rows = rows.filter(r => r.brand === brand);
        if (status) rows = rows.filter(r => r.ad_status === status);
        if (from) rows = rows.filter(r => !r.post_date || r.post_date >= from);
        if (to) rows = rows.filter(r => !r.post_date || r.post_date <= to);

        rows.sort((a, b) => (b.post_date || '').localeCompare(a.post_date || ''));

        // สรุปภาพรวม
        const totalSpend = rows.reduce((s, r) => s + r.ad_spend, 0);
        const totalReach = rows.reduce((s, r) => s + r.ad_reach, 0);
        const doneCount = rows.filter(r => r.ad_status === 'ยิงแล้ว').length;

        // สรุปตามแบรนด์
        const bm = {};
        rows.forEach(r => {
            if (!bm[r.brand]) bm[r.brand] = { brand: r.brand, spend: 0, reach: 0, posts: 0 };
            bm[r.brand].spend += r.ad_spend;
            bm[r.brand].reach += r.ad_reach;
            bm[r.brand].posts += 1;
        });
        const byBrand = Object.values(bm)
            .map(b => ({ ...b, cpm: adCpm(b.spend, b.reach) }))
            .sort((a, b) => b.spend - a.spend);

        return {
            summary: {
                total_posts: rows.length,
                done_count: doneCount,
                pending_count: rows.length - doneCount,
                total_spend: totalSpend,
                total_reach: totalReach,
                cpm: adCpm(totalSpend, totalReach),
                by_brand: byBrand
            },
            rows
        };
    }
};

// ============================ reports (Campaign Reports) ============================
const reports = {
    // รายการแคมเปญ + ตัวเลขสรุปสำหรับหน้ารายงาน (KOLS / BUDGET / USED / POST RATE)
    async campaigns({ scopeBrands = null, brand } = {}) {
        let projs = db.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);

        return projs
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => {
                const subs = db.submissions.filter(s => s.project_id === p.id && s.status === 'confirmed');
                const kols = subs.length;
                const used = subs.reduce((sum, s) => sum + (Number(s.budget) || 0), 0);
                const posted = subs.filter(s => s.post_url && String(s.post_url).trim()).length;
                const post_rate = kols > 0 ? Math.round((posted / kols) * 100) : 0;
                const team = db.teams.find(t => t.id === p.team_id);
                return {
                    id: p.id, name: p.name, brand: p.brand || null, status: p.status,
                    start_date: p.start_date || null, end_date: p.end_date || null,
                    team_name: team ? team.name : null,
                    kols, budget: Number(p.budget) || 0, used, post_rate
                };
            });
    },

    // รายงานเชิงลึกของ 1 แคมเปญ (Report Analysis)
    async detail(projectId, scopeBrands = null) {
        const p = db.projects.find(x => x.id === Number(projectId));
        if (!p) return null;
        if (!inScope(p, scopeBrands)) return null;

        const subs = db.submissions.filter(s => s.project_id === p.id && s.status === 'confirmed');
        const rows = subs.map((s, i) => {
            // กลุ่มโฆษณาที่ KOL คนนี้สังกัด — เอา Content Format ที่บรีฟไว้มาใช้
            const grp = Array.isArray(p.ad_groups) ? p.ad_groups.find(g => g.key === s.group_key) : null;
            // ผลงานคอนเทนต์ — ตัวเลขจริงจากคลิป ไม่ใช่จากการยิงแอด
            const views = Number(s.views) || 0;
            const likes = Number(s.likes) || 0, comments = Number(s.comments) || 0, saves = Number(s.saves) || 0, shares = Number(s.shares) || 0;
            const engagement = likes + comments + saves + shares;
            const er = views > 0 ? Number(((engagement / views) * 100).toFixed(2)) : 0;

            const fee = Number(s.budget) || 0;
            const adSpend = Number(s.ad_spend) || 0;
            const cost = fee + adSpend;                 // ต้นทุนรวม = ค่าตัว + ค่ายิงแอด
            const reach = Number(s.ad_reach) || 0;
            // CPM/CPE คิดจากยอดคอนเทนต์จริง (เดิมใช้ reach และเดา engagement เป็น 2% ของ reach)
            const cpm = views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0;
            const cpe = engagement > 0 ? Number((cost / engagement).toFixed(2)) : 0;
            const posted = !!(s.post_url && String(s.post_url).trim());
            const boosted = s.ad_status === 'ยิงแล้ว';
            // เกณฑ์ผ่าน/ไม่ผ่าน อยู่ที่หน้านี้กับหน้า Influencer (หน้า Dashboard ใช้คะแนนไล่ระดับแทน)
            const good = views > 0 && cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE;
            return {
                idx: i + 1, name: s.account_name, platform: s.platform || null,
                product: s.product || null, agency: s.agency || null,
                cost: fee, ad_spend: adSpend, total_cost: cost, reach,
                link: s.post_url || s.link_account || null,
                cpm, cpe, performance: good ? 'Good' : 'Improve', posted, boosted,
                views, likes, comments, saves, shares, engagement, er,
                // Content Format ยึดจากที่บรีฟไว้ตอนตั้งแคมเปญ
                // s.content_format คือของเก่าที่เคยกรอกมือก่อนเปลี่ยนวิธี เก็บไว้เป็น fallback
                format: (grp && grp.content_format) || s.content_format || null
            };
        });

        // ---------- คะแนน Performance ต่อคน (สูตรเดียวกับ Top Influencer หน้า Dashboard) ----------
        // ให้น้ำหนัก ER มากสุด เพราะวัดว่าคนดูมีส่วนร่วมจริงแค่ไหน ไม่ใช่แค่ยอดวิวเยอะ
        // เทียบกันเองภายในแคมเปญ (ดีสุดในกลุ่ม = เต็ม, แย่สุด = 0) ไม่ได้เทียบกับเกณฑ์ตายตัว
        const RW = { er: 0.35, views: 0.25, cpm: 0.20, cpe: 0.20 };
        // "มีข้อมูล" = กรอกยอดวิว หรือ engagement มาแล้วอย่างน้อยอย่างหนึ่ง
        // คนที่ยังไม่กรอกอะไรเลยจะไม่มีคะแนน และตกไปอยู่ท้ายรายการเสมอ
        rows.forEach(r => { r.measured = r.views > 0 || r.engagement > 0; });
        const rated = rows.filter(r => r.measured);
        if (rated.length) {
            const span = (arr, f) => {
                const v = arr.map(f);
                return { min: Math.min(...v), max: Math.max(...v) };
            };
            const nrm = (val, r, lowerIsBetter) => {
                if (r.max === r.min) return 1;   // ทุกคนเท่ากัน แกนนี้ไม่ช่วยตัดสิน
                const t = (val - r.min) / (r.max - r.min);
                return lowerIsBetter ? 1 - t : t;
            };
            const rEr = span(rated, r => r.er);
            const rVw = span(rated, r => r.views);
            const withCpm = rated.filter(r => r.cpm > 0);
            const withCpe = rated.filter(r => r.cpe > 0);
            const rCpm = withCpm.length ? span(withCpm, r => r.cpm) : { min: 0, max: 0 };
            const rCpe = withCpe.length ? span(withCpe, r => r.cpe) : { min: 0, max: 0 };
            rows.forEach(r => {
                if (!r.measured) { r.score = null; return; }
                // ยังไม่มี CPM/CPE (เพราะยังไม่มีวิว/engagement) = แย่สุดของแกนนั้น ไม่ใช่ดีสุด
                const nCpm = r.cpm > 0 ? nrm(r.cpm, rCpm, true) : 0;
                const nCpe = r.cpe > 0 ? nrm(r.cpe, rCpe, true) : 0;
                r.score = Number(((RW.er * nrm(r.er, rEr) + RW.views * nrm(r.views, rVw)
                    + RW.cpm * nCpm + RW.cpe * nCpe) * 100).toFixed(1));
            });
        } else {
            rows.forEach(r => { r.score = null; });
        }
        const kols = rows.length;
        const kol_cost = rows.reduce((a, r) => a + r.cost, 0);
        const ads_cost = rows.reduce((a, r) => a + r.ad_spend, 0);
        const withReach = rows.filter(r => r.reach > 0);
        const avg_cpm = withReach.length ? Number((withReach.reduce((a, r) => a + r.cpm, 0) / withReach.length).toFixed(2)) : 0;
        const avg_cpe = withReach.length ? Number((withReach.reduce((a, r) => a + r.cpe, 0) / withReach.length).toFixed(2)) : 0;
        const postedCount = rows.filter(r => r.posted).length;

        const platOrder = ['TikTok', 'Instagram', 'Facebook', 'Lemon8'];
        const platforms = platOrder.map(pl => ({ platform: pl, count: rows.filter(r => r.platform === pl).length }));

        const groupBy = (key) => {
            const m = {};
            rows.forEach(r => { const k = r[key] || '—'; (m[k] = m[k] || []).push(r); });
            return m;
        };
        // ===== ผลงานคอนเทนต์ (Views/Engagement) =====
        const total_views = rows.reduce((a, r) => a + r.views, 0);
        const total_engagement = rows.reduce((a, r) => a + r.engagement, 0);
        const measured = rows.filter(r => r.views > 0);
        const avg_views = measured.length ? Math.round(total_views / measured.length) : 0;
        const engagement_rate = total_views > 0 ? Number(((total_engagement / total_views) * 100).toFixed(2)) : 0;
        const pctV = v => (total_views > 0 ? Number(((v / total_views) * 100).toFixed(1)) : 0);
        const erOf = (v, e) => (v > 0 ? Number(((e / v) * 100).toFixed(2)) : 0);

        const pm = groupBy('product');
        const by_product = Object.entries(pm).map(([product, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            const meas = rs.filter(r => r.views > 0).length;
            return {
                product, kols: rs.length, contents: rs.length, budget: rs.reduce((a, r) => a + r.cost, 0),
                posted: rs.filter(r => r.posted).length, total: rs.length, ads: rs.filter(r => r.boosted).length,
                views: v, share: pctV(v), avg_views: meas ? Math.round(v / meas) : 0,
                likes: rs.reduce((a, r) => a + r.likes, 0), engagement: e, er: erOf(v, e)
            };
        }).sort((a, b) => b.views - a.views || b.budget - a.budget);

        // แยกตาม Content Format
        const fm = groupBy('format');
        const by_format = Object.entries(fm).filter(([f]) => f && f !== '—').map(([format, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            const meas = rs.filter(r => r.views > 0).length;
            return {
                format, videos: rs.length, channels: new Set(rs.map(r => r.name)).size,
                views: v, share: pctV(v), avg_views: meas ? Math.round(v / meas) : 0, er: erOf(v, e)
            };
        }).sort((a, b) => b.avg_views - a.avg_views);

        // Top คลิป + Top channel — เอาอันดับ 1 อย่างละอัน
        const top_videos = [...rows].filter(r => r.views > 0).sort((a, b) => b.views - a.views).slice(0, 1)
            .map(r => ({ name: r.name, product: r.product, format: r.format, views: r.views, likes: r.likes, saves: r.saves, shares: r.shares, link: r.link }));
        const cm = groupBy('name');
        const top_channels = Object.entries(cm).map(([name, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            return { name, videos: rs.length, views: v, er: erOf(v, e), products: [...new Set(rs.map(r => r.product).filter(Boolean))] };
        }).filter(c => c.views > 0).sort((a, b) => b.views - a.views).slice(0, 1);

        // Engagement breakdown + View distribution
        const engagement_breakdown = {
            likes: rows.reduce((a, r) => a + r.likes, 0), comments: rows.reduce((a, r) => a + r.comments, 0),
            saves: rows.reduce((a, r) => a + r.saves, 0), shares: rows.reduce((a, r) => a + r.shares, 0)
        };
        const buckets = [
            { label: '1M+', min: 1000000, max: Infinity }, { label: '500K–999K', min: 500000, max: 999999 },
            { label: '100K–499K', min: 100000, max: 499999 }, { label: 'ต่ำกว่า 100K', min: 1, max: 99999 }
        ];
        const view_distribution = buckets.map(b => {
            const rs = rows.filter(r => r.views >= b.min && r.views <= b.max);
            const v = rs.reduce((a, r) => a + r.views, 0);
            return { label: b.label, videos: rs.length, views: v, share: pctV(v) };
        });

        const am = groupBy('agency');
        const by_agency = Object.entries(am).map(([agency, rs]) => ({
            agency, kols: rs.length, budget: rs.reduce((a, r) => a + r.cost, 0),
            posted: rs.filter(r => r.posted).length, total: rs.length
        }));

        const products = Array.isArray(p.products) ? p.products.map(x => (typeof x === 'string' ? x : x.name)) : [];

        return clone({
            campaign: {
                id: p.id, name: p.name, brand: p.brand || null, budget: Number(p.budget) || 0, used: kol_cost,
                product: products.join(', ') || '—', total_kols: kols,
                start_date: p.start_date || null, end_date: p.end_date || null, status: p.status
            },
            platforms, all_count: kols,
            post_rate: { rate: kols > 0 ? Math.round((postedCount / kols) * 100) : 0, posted: postedCount, total: kols },
            ads_boosted: rows.filter(r => r.boosted).length,
            good_performance: { good: rows.filter(r => r.performance === 'Good').length, total: kols },
            cost: { kol_cost, ads_cost, avg_cpm, avg_cpe, total: kol_cost + ads_cost },
            // ผลงานคอนเทนต์
            performance: {
                total_views, total_engagement, avg_views, engagement_rate,
                measured_count: measured.length, contents: kols
            },
            by_format, top_videos, top_channels, engagement_breakdown, view_distribution,
            by_product, by_agency, kols: rows
        });
    }
};

const meta = {
    async teamCount() { return db.teams.length; },
    reload() { db = load(); }
};

// ============================ งวดการจ่าย + รอบทำจ่าย ============================
// installment = 1 งวดของแคมเปญหนึ่ง ให้เอเจนซี่เจ้าหนึ่ง (เช่น งวด 1/2 · 50% · 400,000)
// pay_batch   = 1 รอบทำจ่าย = สลิป 1 ใบ = เอเจนซี่ 1 เจ้า + วันที่ 1 วัน แต่รวมได้หลายงวดหลายแคมเปญ

// เอเจนซี่ของแคมเปญ — เอาจากบัญชีที่ผูกกับลิงก์ ถ้าไม่มีค่อยใช้ชื่อบนลิงก์
function projectAgencies(p, groupKey) {
    const out = [];
    for (const l of (p.agency_links || [])) {
        // ระบุกลุ่มมา = เอาเฉพาะเจ้าที่รับผิดชอบกลุ่มนั้น (ลิงก์เก่าที่ไม่ได้เลือกกลุ่มถือว่ารับทุกกลุ่ม)
        if (groupKey && Array.isArray(l.groups) && l.groups.length && !l.groups.includes(groupKey)) continue;
        const acc = db.users.find(u => u.role === 'agency' && (u.agency_tokens || []).includes(l.token));
        const name = (acc && acc.username) || l.name;
        if (name && !out.includes(name)) out.push(name);
    }
    return out;
}

function decorateInstallment(it) {
    const p = db.projects.find(x => x.id === it.project_id);
    const batch = it.batch_id ? db.pay_batches.find(b => b.id === it.batch_id) : null;
    const gi = it.group_key && p ? (p.ad_groups || []).findIndex(g => g.key === it.group_key) : -1;
    const g = gi >= 0 ? p.ad_groups[gi] : null;
    return clone({
        ...it,
        group_no: gi >= 0 ? gi + 1 : null,
        group_concept: g ? g.concept : null,
        // รายการนอกแคมเปญ (ตั้งเอง) ใช้ชื่อที่พิมพ์ไว้แทนชื่อแคมเปญ
        manual: !it.project_id,
        project_name: p ? p.name : (it.title || null),
        brand: p ? p.brand : null,
        project_budget: p ? p.budget : null,
        batch_date: batch ? batch.pay_date : null
    });
}

const installments = {
    // งวดของแคมเปญหนึ่ง (ทุกเอเจนซี่) เรียงตามเจ้าแล้วตามเลขงวด
    async listByProject(projectId) {
        return db.installments
            .filter(i => i.project_id === Number(projectId))
            .sort((a, b) => (a.agency || '').localeCompare(b.agency || '', 'th')
                || (a.group_key || '').localeCompare(b.group_key || '') || a.no - b.no)
            .map(decorateInstallment);
    },
    // ทุกงวดในระบบ (ไว้ทำหน้ารอบทำจ่าย) — pending = ยังไม่เข้ารอบไหน
    async list({ status } = {}) {
        let rows = db.installments.slice();
        if (status) rows = rows.filter(i => (i.status || 'pending') === status);
        return rows
            .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id)
            .map(decorateInstallment);
    },
    // ตั้ง/แก้แผนการจ่ายของ (แคมเปญ + เอเจนซี่) — แทนที่ของเดิมทั้งชุด
    // งวดที่จ่ายไปแล้วห้ามยุ่ง ไม่งั้นยอดในสลิปที่ออกไปแล้วจะเพี้ยน
    async setPlan(projectId, agency, groupKey, plan) {
        const p = db.projects.find(x => x.id === Number(projectId));
        if (!p) return { error: 'ไม่พบแคมเปญ' };
        const gk = groupKey || null;
        if (gk && !(p.ad_groups || []).some(g => g.key === gk)) return { error: 'ไม่พบกลุ่มนี้ในแคมเปญ' };
        // แผนแยกกันตาม (แคมเปญ + เอเจนซี่ + กลุ่ม) — คนละกลุ่มไม่ทับกัน
        const same = i => i.project_id === p.id && i.agency === agency && (i.group_key || null) === gk;
        // ห้ามมีทั้ง "ทั้งแคมเปญ" และ "รายกลุ่ม" ของเจ้าเดียวกันพร้อมกัน ยอดจะถูกนับซ้ำ
        const others = db.installments.filter(i => i.project_id === p.id && i.agency === agency && !same(i));
        if (gk && others.some(i => !i.group_key)) {
            return { error: 'เจ้านี้มีแผนแบบ "ทั้งแคมเปญ" อยู่แล้ว — ลบแผนนั้นก่อนถึงจะตั้งแยกรายกลุ่มได้ ไม่งั้นยอดจะนับซ้ำ' };
        }
        if (!gk && others.some(i => i.group_key)) {
            return { error: 'เจ้านี้ตั้งแผนแยกรายกลุ่มไว้แล้ว — ลบแผนรายกลุ่มก่อนถึงจะตั้งแบบทั้งแคมเปญได้ ไม่งั้นยอดจะนับซ้ำ' };
        }
        const mine = db.installments.filter(same);
        if (mine.some(i => i.status === 'paid')) {
            return { error: 'มีงวดที่ทำจ่ายไปแล้ว แก้แผนไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
        }
        // บันทึกแผนซ้ำต้องไม่ทำใบแจ้งหนี้ที่แนบไว้แล้วหาย — ยกของงวดเดิมตำแหน่งเดียวกันมาใช้ต่อ
        const old = mine.slice().sort((a, b) => a.no - b.no);
        db.installments = db.installments.filter(i => !same(i));
        const rows = plan.map((x, idx) => {
            const prev = old[idx] || null;
            return {
                id: prev ? prev.id : nextId('installments'),
                project_id: p.id,
                agency,
                group_key: gk,
                no: idx + 1,
                of: plan.length,
                percent: Number(x.percent) || 0,
                amount: Number(x.amount) || 0,
                due_date: x.due_date || null,
                note: x.note || null,
                // เอกสารของงวดเดิมยังใช้ได้ ไม่ต้องแนบใหม่
                invoice: prev ? prev.invoice : null,
                invoice_link: prev ? prev.invoice_link : null,
                status: 'pending',
                batch_id: null,
                created_at: prev ? prev.created_at : now(),
                updated_at: now()
            };
        });
        db.installments.push(...rows);
        persist();
        return { data: rows.map(decorateInstallment) };
    },
    // แก้ยอด/วันครบกำหนดของงวดเดียว (งวดที่จ่ายแล้วแก้ไม่ได้)
    async update(id, fields) {
        const it = db.installments.find(i => i.id === Number(id));
        if (!it) return { error: 'ไม่พบงวดนี้' };
        if (it.status === 'paid') return { error: 'งวดนี้ทำจ่ายไปแล้ว แก้ไม่ได้' };
        if (fields.amount !== undefined) it.amount = Number(fields.amount) || 0;
        if (fields.percent !== undefined) it.percent = Number(fields.percent) || 0;
        if (fields.due_date !== undefined) it.due_date = fields.due_date || null;
        if (fields.note !== undefined) it.note = fields.note || null;
        it.updated_at = now();
        persist();
        return { data: decorateInstallment(it) };
    },
    // ===== รายการจ่ายนอกแคมเปญ (ตั้งเอง ไม่ผูกกับ project) =====
    // ทั้งชุดอ้างอิงด้วย manual_id เดียวกัน แก้/ลบทีเดียวทั้งชุด
    async listManual() {
        const byId = {};
        for (const i of db.installments) {
            if (i.project_id || !i.manual_id) continue;
            (byId[i.manual_id] = byId[i.manual_id] || []).push(i);
        }
        return Object.keys(byId).map(id => {
            const rows = byId[id].slice().sort((a, b) => a.no - b.no);
            const paid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0);
            return clone({
                manual_id: id,
                title: rows[0].title || null,
                agency: rows[0].agency || null,
                planned_amount: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
                paid_amount: paid,
                installments: rows.map(decorateInstallment)
            });
        }).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'th'));
    },
    // สร้าง/แก้ทั้งชุด — ส่ง manual_id มาด้วยคือแก้ของเดิม ไม่ส่งคือสร้างใหม่
    async setManualPlan({ manual_id, title, agency, plan }) {
        const id = manual_id || 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const same = i => !i.project_id && i.manual_id === id;
        const old = db.installments.filter(same).sort((a, b) => a.no - b.no);
        if (old.some(i => i.status === 'paid')) {
            return { error: 'มีงวดที่ทำจ่ายไปแล้ว แก้ไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
        }
        db.installments = db.installments.filter(i => !same(i));
        const rows = plan.map((x, idx) => {
            const prev = old[idx] || null;
            return {
                id: prev ? prev.id : nextId('installments'),
                project_id: null,
                manual_id: id,
                title: String(title || '').trim() || 'รายการจ่าย',
                agency,
                group_key: null,
                no: idx + 1,
                of: plan.length,
                percent: Number(x.percent) || 0,
                amount: Number(x.amount) || 0,
                due_date: x.due_date || null,
                note: x.note || null,
                invoice: prev ? prev.invoice : null,
                invoice_link: prev ? prev.invoice_link : null,
                status: 'pending',
                batch_id: null,
                created_at: prev ? prev.created_at : now(),
                updated_at: now()
            };
        });
        db.installments.push(...rows);
        persist();
        return { data: { manual_id: id, installments: rows.map(decorateInstallment) } };
    },
    async removeManual(manualId) {
        const same = i => !i.project_id && i.manual_id === manualId;
        const mine = db.installments.filter(same);
        if (!mine.length) return { error: 'ไม่พบรายการนี้' };
        if (mine.some(i => i.status === 'paid')) {
            return { error: 'มีงวดที่ทำจ่ายไปแล้ว ลบไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
        }
        db.installments = db.installments.filter(i => !same(i));
        persist();
        return { data: { removed: mine.length } };
    },
    // ลบแผนของ (แคมเปญ + เอเจนซี่ + กลุ่ม) ทั้งชุด — งวดที่จ่ายแล้วลบไม่ได้
    async removePlan(projectId, agency, groupKey) {
        const gk = groupKey || null;
        const same = i => i.project_id === Number(projectId) && i.agency === agency && (i.group_key || null) === gk;
        const mine = db.installments.filter(same);
        if (!mine.length) return { error: 'ไม่พบแผนนี้' };
        if (mine.some(i => i.status === 'paid')) {
            return { error: 'มีงวดที่ทำจ่ายไปแล้ว ลบแผนไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
        }
        db.installments = db.installments.filter(i => !same(i));
        persist();
        return { data: { removed: mine.length } };
    },
    // แนบใบแจ้งหนี้ของงวด — งวดที่จ่ายแล้วก็ยังแนบ/เปลี่ยนได้ เพราะเอกสารมักตามมาทีหลัง
    async setInvoice(id, meta) {
        const it = db.installments.find(i => i.id === Number(id));
        if (!it) return null;
        it.invoice = meta;
        it.updated_at = now();
        persist();
        return decorateInstallment(it);
    },
    // ลิงก์ใบแจ้งหนี้ — งวดที่จ่ายแล้วก็แก้ได้ เหมือนไฟล์
    async setInvoiceLink(id, link) {
        const it = db.installments.find(i => i.id === Number(id));
        if (!it) return null;
        it.invoice_link = (link && String(link).trim()) ? String(link).trim() : null;
        it.updated_at = now();
        persist();
        return decorateInstallment(it);
    },
    async get(id) {
        const it = db.installments.find(i => i.id === Number(id));
        return it ? decorateInstallment(it) : null;
    },
    async removeByProject(projectId) {
        const before = db.installments.length;
        db.installments = db.installments.filter(i => i.project_id !== Number(projectId));
        if (before !== db.installments.length) persist();
        return before - db.installments.length;
    }
};

function decorateBatch(b) {
    const items = db.installments.filter(i => i.batch_id === b.id).map(decorateInstallment);
    return clone({ ...b, items, item_count: items.length });
}

const payBatches = {
    async list() {
        return db.pay_batches
            .slice()
            .sort((a, b) => (b.pay_date || '').localeCompare(a.pay_date || '') || b.id - a.id)
            .map(decorateBatch);
    },
    async get(id) {
        const b = db.pay_batches.find(x => x.id === Number(id));
        return b ? decorateBatch(b) : null;
    },
    // สร้างรอบทำจ่าย = จับงวดหลายงวดมัดเป็นสลิปใบเดียว
    async create({ agency, pay_date, installment_ids, note, created_by }) {
        const ids = (installment_ids || []).map(Number);
        const rows = db.installments.filter(i => ids.includes(i.id));
        if (!rows.length) return { error: 'ยังไม่ได้เลือกงวดที่จะจ่าย' };
        if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
        if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
        // สลิปใบเดียวโอนให้เจ้าเดียว — ปนเจ้าไม่ได้
        const names = [...new Set(rows.map(i => i.agency))];
        if (names.length > 1) return { error: 'รวมงวดข้ามเอเจนซี่ในสลิปใบเดียวไม่ได้' };
        const b = {
            id: nextId('pay_batches'),
            agency: agency || names[0] || null,
            pay_date: pay_date || null,
            total: rows.reduce((s, i) => s + (Number(i.amount) || 0), 0),
            slip: null,
            note: note || null,
            created_by: created_by || null,
            created_at: now(), updated_at: now()
        };
        db.pay_batches.push(b);
        rows.forEach(i => { i.status = 'paid'; i.batch_id = b.id; i.updated_at = now(); });
        persist();
        return { data: decorateBatch(b) };
    },
    // เติมงวดเข้ารอบที่มีอยู่แล้ว — สลิปยังเป็นใบเดียว ยอดรวมขยับตาม
    async addItems(id, installment_ids) {
        const b = db.pay_batches.find(x => x.id === Number(id));
        if (!b) return { error: 'ไม่พบรอบทำจ่ายนี้' };
        const ids = (installment_ids || []).map(Number);
        const rows = db.installments.filter(i => ids.includes(i.id));
        if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
        if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
        if (rows.some(i => i.agency !== b.agency)) {
            return { error: 'งวดที่เลือกไม่ใช่ของ ' + b.agency + ' — สลิปใบเดียวโอนให้เจ้าเดียว' };
        }
        rows.forEach(i => { i.status = 'paid'; i.batch_id = b.id; i.updated_at = now(); });
        b.total = db.installments.filter(i => i.batch_id === b.id).reduce((s, i) => s + (Number(i.amount) || 0), 0);
        b.updated_at = now();
        persist();
        return { data: decorateBatch(b) };
    },
    async update(id, fields) {
        const b = db.pay_batches.find(x => x.id === Number(id));
        if (!b) return null;
        if (fields.pay_date !== undefined) b.pay_date = fields.pay_date || null;
        if (fields.note !== undefined) b.note = fields.note || null;
        b.updated_at = now();
        persist();
        return decorateBatch(b);
    },
    async setSlip(id, meta) {
        const b = db.pay_batches.find(x => x.id === Number(id));
        if (!b) return null;
        b.slip = meta;
        b.updated_at = now();
        persist();
        return decorateBatch(b);
    },
    // ยกเลิกรอบ — งวดข้างในกลับไปเป็นรอทำจ่ายเหมือนเดิม ไม่ได้หายไปไหน
    // คืนข้อมูลรอบที่ลบออกไปด้วย เพื่อให้ route เอาไปบันทึกประวัติพร้อมเหตุผล
    async remove(id) {
        const idx = db.pay_batches.findIndex(x => x.id === Number(id));
        if (idx === -1) return null;
        const gone = decorateBatch(db.pay_batches[idx]);
        db.installments.forEach(i => {
            if (i.batch_id === Number(id)) { i.status = 'pending'; i.batch_id = null; i.updated_at = now(); }
        });
        db.pay_batches.splice(idx, 1);
        persist();
        return gone;
    }
};

// ============================ rate requests (สอบถาม Rate Card) ============================
const rateRequests = {
    async create(fields) {
        const row = {
            id: nextId('rate_requests'),
            kol_name: fields.kol_name || null,
            link_account: fields.link_account || null,
            brand: fields.brand || null,
            products: Array.isArray(fields.products) ? fields.products : [],
            platforms: Array.isArray(fields.platforms) ? fields.platforms : [],
            scope: fields.scope || null,
            budget: fields.no_budget ? null : (Number(fields.budget) || 0),
            no_budget: !!fields.no_budget,
            brief_link: fields.brief_link || null,
            brief_note: fields.brief_note || null,
            status: 'open',
            created_by: fields.created_by || null,
            team_id: fields.team_id ?? null,
            created_at: now()
        };
        db.rate_requests.push(row); persist();
        return clone(row);
    },
    async list({ scopeBrands = null } = {}) {
        let rows = db.rate_requests.slice();
        rows = scopeProjects(rows, scopeBrands);
        return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(clone);
    }
};

module.exports = { teams, users, kols, projects, projectKols, dashboard, payments, installments, payBatches, budget, activity, submissions, ads, adsSync, reports, rateRequests, meta, _duplicateError: duplicateError };
