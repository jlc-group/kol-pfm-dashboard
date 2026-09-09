/**
 * kols — เวอร์ชัน PostgreSQL (พอร์ตมาจาก jsonStore.js บรรทัด 229–487)
 *
 * หลักการ:
 *   • อ่าน/เขียนแถวเดี่ยว (list / findById / create / update / remove / count) = ยิง SQL ตรง
 *   • ส่วนคำนวณ (usedWithCampaigns / detailWithUsages / platformCounts / analytics)
 *     = โหลด snapshot แล้วใช้ "อัลกอริทึมเดิมทุกบรรทัด" คำนวณต่อ (แค่เปลี่ยน db. เป็น snap.)
 *     ห้ามเขียนใหม่เป็น SQL aggregation เพราะสูตร CPM/CPE/เกณฑ์คุ้มค่าละเอียดมาก เพี้ยนแล้วไม่มีใครรู้
 */
const { query, insertRow, updateRow, asNum, asNumOrNull, asJson } = require('./_base');
const { loadSnapshot } = require('./_snapshot');
const { now, clone, duplicateError, scopeProjects, GOOD_CPM, GOOD_CPE } = require('../logic');

// เกณฑ์ค่าแอดที่ระบบจะล็อกผลงาน (สแตมป์)
// หมายเหตุ: jsonStore ประกาศค่านี้ไว้ที่บรรทัด 1278 (const AD_STAMP_AT = 10000) และใช้ข้ามมาที่ analytics
// ส่วน logic.js อ้างถึง AD_STAMP_AT แต่ไม่ได้ประกาศ/ส่งออก จึงต้องประกาศซ้ำที่นี่ให้ค่าตรงกันเป๊ะ
const AD_STAMP_AT = 10000;

// id ที่ส่งมาเป็นสตริงจาก URL — jsonStore ใช้ Number(id) เทียบตรง ๆ
// ค่าที่แปลงไม่ได้ (NaN) จะหาไม่เจอเสมอ ต้องดักไว้ก่อนยิง SQL ไม่งั้น Postgres จะ error แทนที่จะคืน null
const numId = (id) => {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
};

const kols = {
    async list({ search, platform, category, limit = 100, offset = 0 } = {}) {
        const where = [];
        const vals = [];
        if (search) {
            // jsonStore ใช้ String.includes() = ค้นสตริงตรง ๆ ไม่ใช่ pattern
            // จึงใช้ position() แทน LIKE เพื่อไม่ให้ % หรือ _ ในคำค้นกลายเป็น wildcard
            vals.push(String(search).toLowerCase());
            const p = `$${vals.length}`;
            where.push(`(position(${p} in lower(coalesce(name, ''))) > 0
                      OR position(${p} in lower(coalesce(username, ''))) > 0)`);
        }
        if (platform) { vals.push(platform); where.push(`platform = $${vals.length}`); }
        if (category) { vals.push(category); where.push(`category = $${vals.length}`); }

        // เรียงตามผู้ติดตามมาก→น้อย · เท่ากันให้เรียงตาม id (เทียบเท่าการ sort แบบ stable ของเดิม)
        const base = `SELECT * FROM kols${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                      ORDER BY followers DESC, id ASC`;

        const off = Number(offset), lim = Number(limit);
        if (Number.isInteger(off) && off >= 0 && Number.isInteger(lim) && lim >= 0) {
            const r = await query(`${base} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
                [...vals, lim, off]);
            return r.rows;
        }
        // ค่าแปลก ๆ (เช่น limit=abc → NaN, ค่าติดลบ, ทศนิยม) — ทำแบบเดียวกับ Array.slice ของเดิมเป๊ะ
        const r = await query(base, vals);
        return r.rows.slice(off, off + lim);
    },

    async findById(id) {
        const n = numId(id);
        if (n === null) return null;
        const r = await query('SELECT * FROM kols WHERE id = $1', [n]);
        return r.rows[0] || null;
    },

    async create(fields) {
        if (fields.kol_code) {
            const dup = await query('SELECT 1 FROM kols WHERE kol_code = $1', [fields.kol_code]);
            if (dup.rows.length) throw duplicateError('มี kol_code นี้อยู่แล้ว');
        }
        const data = {
            kol_code: fields.kol_code || null,
            name: fields.name,
            username: fields.username || null,
            platform: fields.platform || null,
            avatar: fields.avatar || null,
            followers: asNum(fields.followers, 0),
            engagement_rate: asNumOrNull(fields.engagement_rate),
            category: fields.category || null,
            tags: asJson(fields.tags || null),
            contact_info: asJson(fields.contact_info || null),
            extra_data: asJson(fields.extra_data || null),
            created_at: now(),
            updated_at: now()
        };
        try {
            return await insertRow('kols', data);
        } catch (err) {
            // แข่งกันเพิ่มพร้อมกันจนชน unique constraint — ให้ข้อความเหมือนเดิม
            if (err && err.code === '23505') throw duplicateError('มี kol_code นี้อยู่แล้ว');
            throw err;
        }
    },

    async update(id, fields) {
        const n = numId(id);
        if (n === null) return null;
        const data = {};
        for (const key of ['kol_code', 'name', 'username', 'platform', 'avatar', 'followers',
            'engagement_rate', 'category', 'tags', 'contact_info', 'extra_data']) {
            if (fields[key] !== undefined && fields[key] !== null) {
                if (key === 'followers') data[key] = asNum(fields[key], 0);
                else if (key === 'engagement_rate') data[key] = asNumOrNull(fields[key]);
                else if (key === 'tags' || key === 'contact_info' || key === 'extra_data') data[key] = asJson(fields[key]);
                else data[key] = fields[key];
            }
        }
        data.updated_at = now();
        try {
            return await updateRow('kols', n, data);
        } catch (err) {
            if (err && err.code === '23505') throw duplicateError('มี kol_code นี้อยู่แล้ว');
            throw err;
        }
    },

    async remove(id) {
        const n = numId(id);
        if (n === null) return false;
        // project_kols ตามไปด้วยเองผ่าน FK ON DELETE CASCADE (คำสั่งเดียว = atomic อยู่แล้ว)
        const r = await query('DELETE FROM kols WHERE id = $1', [n]);
        return r.rowCount > 0;
    },

    async count() {
        const r = await query('SELECT COUNT(*)::int AS n FROM kols');
        return Number(r.rows[0].n);
    },

    // ดึง Influencer ที่ "ถูกใช้ในแคมเปญ" — รวมชื่อซ้ำเป็นรายเดียว + แนบแคมเปญ (ผลงาน) แต่ละอัน
    // scopeBrands = null (admin/manager เห็นทุกแบรนด์) หรือ array ชื่อแบรนด์ (member เห็นเฉพาะแบรนด์ตัวเอง)
    async usedWithCampaigns(scopeBrands = null) {
        const snap = await loadSnapshot(['projects', 'project_kols', 'teams', 'kols']);
        let projs = snap.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));

        const byKol = {};
        snap.project_kols
            .filter(pk => projIds.has(pk.project_id))
            .forEach(pk => {
                if (!byKol[pk.kol_id]) byKol[pk.kol_id] = [];
                const p = projById[pk.project_id];
                const team = snap.teams.find(t => t.id === p.team_id);
                byKol[pk.kol_id].push({
                    project_id: p.id, project_name: p.name, brand: p.brand,
                    team_name: team ? team.name : null, status: pk.status,
                    fee: pk.fee, views: pk.views, link_id: pk.id
                });
            });

        return Object.entries(byKol).map(([kolId, usages]) => {
            const k = snap.kols.find(x => x.id === Number(kolId)) || { id: Number(kolId) };
            return clone({ ...k, usages, campaign_count: usages.length });
        }).sort((a, b) => (Number(b.followers) || 0) - (Number(a.followers) || 0));
    },

    // รายละเอียด Influencer 1 คน + ประวัติการใช้งานในแคมเปญ (งบ/วิว/ลิงก์ผลงาน/วันที่ลงงาน)
    async detailWithUsages(kolId, scopeBrands = null) {
        const snap = await loadSnapshot(['projects', 'project_kols', 'teams', 'kols']);
        const k = snap.kols.find(x => x.id === Number(kolId));
        if (!k) return null;
        let projs = snap.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));

        const usages = snap.project_kols
            .filter(pk => pk.kol_id === Number(kolId) && projIds.has(pk.project_id))
            .map(pk => {
                const p = projById[pk.project_id];
                const team = snap.teams.find(t => t.id === p.team_id);
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
        const snap = await loadSnapshot(['kols']);
        const map = {};
        snap.kols.forEach(k => { const p = k.platform || 'อื่นๆ'; map[p] = (map[p] || 0) + 1; });
        return Object.entries(map).map(([label, value]) => ({ label, value }));
    },

    // KOL Analytics — รวม KOL ที่คัดเลือกแล้วจากทุกแคมเปญ (ตามสิทธิ์ทีม)
    async analytics(scopeBrands = null) {
        const snap = await loadSnapshot(['projects', 'submissions']);
        const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let projs = snap.projects;
        projs = scopeProjects(projs, scopeBrands);
        const projById = {};
        projs.forEach(p => { projById[p.id] = p; });
        const projIds = new Set(projs.map(p => p.id));
        const today = new Date();

        const rows = snap.submissions
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

module.exports = kols;
